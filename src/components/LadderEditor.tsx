import { useEffect, useRef, useState, type JSX } from 'react';
import type { CmpOp } from '../plc/types';
import { addRow, addRung, deleteRow, deleteRung, moveRung, setCell, setNote, setOut, setRungComment, toggleVl, type Ladder, type LdCell, type LdContactKind, type LdDialect, type LdOut, type LdOutKind, type LdRung } from '../plc/ladder';
import { tr } from '../i18n';

/** 칸 크기 (px) */
const CW = 74;
const RH = 48;
const OW = 160;
const LM = 30;

interface Sel {
  rung: number;
  row: number;
  /** cols = 출력 칸 */
  col: number;
}

const OUT_LABEL: Record<LdOutKind, string> = { out: '', set: 'S', rst: 'R', pls: 'P', plf: 'N', ton: 'TON', tof: 'TOFF', ctu: 'CTU', app: '' };

/**
 * 래더 편집기 (XG5000 · GX Works 처럼 칸에 접점 · 코일을 놓는다).
 * readOnly 면 보기만, monitor 가 있으면 켜진 접점 · 코일을 칠한다 (시뮬레이션 모니터)
 */
export function LadderEditor({
  ladder,
  dialect,
  comments: extComments,
  onChange,
  monitor,
  readOnly,
  errors,
  devices,
  scale = 1,
}: {
  ladder: Ladder;
  dialect: LdDialect;
  comments: Map<string, string>;
  onChange?: (ld: Ladder, key?: string) => void;
  monitor?: (dev: string) => boolean | null;
  readOnly?: boolean;
  errors?: { rung: number; message: string }[];
  /** 자동 완성에 쓸 디바이스 */
  devices?: string[];
  /** 그림 크기 배율 (좁은 곳의 모니터) */
  scale?: number;
}) {
  const [sel, setSel] = useState<Sel | null>(readOnly ? null : { rung: 0, row: 0, col: 0 });
  const devRef = useRef<HTMLInputElement>(null);
  /** 접점 · 코일을 놓은 바로 뒤 치는 글자는 디바이스 이름으로 (입력 칸에 초점이 가기 전에 친 것도 잃지 않게) */
  const typingBuf = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cols = ladder.cols;
  // 보기만 할 때는 쓰인 칸까지만 그리고 출력을 바로 옆에 (좁은 곳의 모니터)
  const drawCols = readOnly
    ? Math.max(
        1,
        ...ladder.rungs.flatMap((r) => [
          ...Object.entries(r.cells)
            .filter(([, c]) => c.k !== 'h')
            .map(([k]) => Number(k.split(',')[1]) + 1),
          ...r.vl.map((v) => Number(v.split(',')[1])),
        ]),
      )
    : cols;
  const rung = sel ? ladder.rungs[sel.rung] : null;
  const cell = sel && rung && sel.col < cols ? rung.cells[`${sel.row},${sel.col}`] : undefined;
  const out = sel && rung && sel.col === cols ? rung.outs[String(sel.row)] : undefined;
  const change = (ld: Ladder, key?: string) => onChange?.(ld, key);
  const lsTimer = dialect === 'ls';
  // 디바이스 설명: 래더에 적은 것 > 바깥 (코멘트 파일 · 니모닉)
  const comments = new Map(extComments);
  for (const [d, c] of Object.entries(ladder.notes ?? {})) comments.set(d, c);
  const noteInput = (dev: string) =>
    dev.trim() ? (
      <input
        className="input ld-note"
        value={comments.get(dev.toUpperCase()) ?? ''}
        placeholder={tr('디바이스 설명', 'Device comment')}
        title={tr('디바이스 설명 (니모닉에서는 처음 쓰인 줄 끝의 ; 설명)', 'Device comment (written after the first use in the mnemonics)')}
        onChange={(e) => change(setNote(ladder, dev, e.target.value), `ld-note-${dev.toUpperCase()}`)}
      />
    ) : null;
  const bad = new Set((errors ?? []).map((e) => e.rung));

  useEffect(() => {
    if (sel && sel.rung >= ladder.rungs.length) setSel({ rung: ladder.rungs.length - 1, row: 0, col: 0 });
    else if (sel && rung && sel.row >= rung.rows) setSel({ ...sel, row: rung.rows - 1 });
  }, [ladder, sel, rung]);

  const focusDev = () => {
    typingBuf.current = '';
    setTimeout(() => devRef.current?.focus(), 0);
  };
  const place = (k: LdContactKind) => {
    if (!sel || !rung || rung.raw) return;
    if (sel.col >= cols) return;
    const keep = cell && cell.k !== 'h' ? { dev: cell.dev, ...(k === 'cmp' ? { op: cell.op ?? '=', b: cell.b ?? '' } : {}) } : k === 'cmp' ? { op: '=' as CmpOp, b: '' } : {};
    change(setCell(ladder, sel.rung, sel.row, sel.col, k === 'h' ? { k: 'h' } : { k, ...keep }));
    if (k === 'h') setSel({ ...sel, col: Math.min(cols, sel.col + 1) });
    else focusDev();
  };
  const placeOut = (k: LdOutKind) => {
    if (!sel || !rung || rung.raw) return;
    const cur = rung.outs[String(sel.row)];
    change(setOut(ladder, sel.rung, sel.row, { k, dev: cur && cur.k !== 'app' && k !== 'app' ? cur.dev : '', ...(k === 'ton' || k === 'tof' || k === 'ctu' ? { arg: cur?.arg ?? (k === 'ctu' ? '5' : '30') } : {}) }));
    setSel({ ...sel, col: cols });
    focusDev();
  };
  const remove = () => {
    if (!sel || !rung || rung.raw) return;
    if (sel.col === cols) change(setOut(ladder, sel.rung, sel.row, null));
    else change(setCell(ladder, sel.rung, sel.row, sel.col, null));
  };
  const vline = (left: boolean) => {
    if (!sel || !rung || rung.raw) return;
    const x = left ? sel.col : sel.col + 1;
    if (sel.row + 1 >= rung.rows) {
      // 아래 줄이 없으면 하나 만들고 잇는다
      const grown = addRow(ladder, sel.rung, sel.row);
      change(toggleVl(grown, sel.rung, sel.row, x));
    } else change(toggleVl(ladder, sel.rung, sel.row, x));
  };
  const move = (dr: number, dc: number) => {
    typingBuf.current = null;
    if (!sel) return;
    let { rung: ri, row, col } = sel;
    col = Math.max(0, Math.min(cols, col + dc));
    row += dr;
    if (row < 0) {
      if (ri > 0) {
        ri--;
        row = ladder.rungs[ri].rows - 1;
      } else row = 0;
    } else if (row >= ladder.rungs[ri].rows) {
      if (ri < ladder.rungs.length - 1) {
        ri++;
        row = 0;
      } else row = ladder.rungs[ri].rows - 1;
    }
    setSel({ rung: ri, row, col });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const t = e.target as HTMLElement;
    const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
    const key = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'F3') return handled(), place(e.shiftKey ? 'p' : 'no');
    if (key === 'F4') return handled(), place(e.shiftKey ? 'n' : 'nc');
    if (key === 'F5') return handled(), place('h');
    if (key === 'F6') return handled(), vline(e.shiftKey);
    if (key === 'F9') return handled(), placeOut(e.shiftKey ? 'set' : 'out');
    if (key === 'F10') return handled(), placeOut('app');
    if (typing) {
      if (key === 'Enter') {
        handled();
        typingBuf.current = null;
        boxRef.current?.focus();
        move(0, 1);
      }
      return;
    }
    // 놓자마자 친 글자: 디바이스 이름으로 이어 붙인다
    if (typingBuf.current !== null && key.length === 1 && /[\w.%=<>]/.test(key) && !e.ctrlKey && !e.metaKey) {
      handled();
      typingBuf.current += key.toUpperCase();
      const v = typingBuf.current;
      if (sel && sel.col === cols && out) change(setOut(ladder, sel.rung, sel.row, { ...out, dev: v }), 'ld-dev');
      else if (sel && cell && cell.k !== 'h') change(setCell(ladder, sel.rung, sel.row, sel.col, { ...cell, dev: v }), 'ld-dev');
      setTimeout(() => devRef.current?.focus(), 0);
      return;
    }
    if (key === 'ArrowLeft') return handled(), move(0, -1);
    if (key === 'ArrowRight') return handled(), move(0, 1);
    if (key === 'ArrowUp') return handled(), move(-1, 0);
    if (key === 'ArrowDown') return handled(), move(1, 0);
    if (key === 'Delete' || key === 'Backspace') return handled(), remove();
    if (key === 'Enter') {
      handled();
      // 놓고 이름을 친 뒤 (입력 칸에 초점이 가기 전) Enter: 끝내고 오른쪽으로
      if (typingBuf.current) return move(0, 1);
      return focusDev();
    }
  };

  const setCellPatch = (patch: Partial<LdCell>) => sel && cell && change(setCell(ladder, sel.rung, sel.row, sel.col, { ...cell, ...patch }), 'ld-dev');
  const setOutPatch = (patch: Partial<LdOut>) => sel && out && change(setOut(ladder, sel.rung, sel.row, { ...out, ...patch }), 'ld-dev');

  return (
    <div className="ld" ref={boxRef} tabIndex={readOnly ? undefined : 0} onKeyDown={onKey}>
      {!readOnly && (
        <>
          <div className="ld-tools">
            <button type="button" className="btn small" onClick={() => place('no')} title="F3">
              <ContactIcon k="no" /> {tr('a접점', 'NO')}
            </button>
            <button type="button" className="btn small" onClick={() => place('nc')} title="F4">
              <ContactIcon k="nc" /> {tr('b접점', 'NC')}
            </button>
            <button type="button" className="btn small" onClick={() => place('p')} title="Shift+F3">
              <ContactIcon k="p" /> {tr('상승', 'Rise')}
            </button>
            <button type="button" className="btn small" onClick={() => place('n')} title="Shift+F4">
              <ContactIcon k="n" /> {tr('하강', 'Fall')}
            </button>
            <button type="button" className="btn small" onClick={() => place('cmp')} title={tr('비교 접점 (D0 = 10 …)', 'Compare contact')}>
              [=] {tr('비교', 'Cmp')}
            </button>
            <button type="button" className="btn small" onClick={() => place('h')} title="F5">
              ─ {tr('가로선', 'Line')}
            </button>
            <button type="button" className="btn small" onClick={() => vline(false)} title={tr('F6: 칸 오른쪽에서 아래 줄로 (병렬 닫기)', 'F6: from the right edge down to the next row')}>
              ┤ {tr('세로선', 'V-line')}
            </button>
            <button type="button" className="btn small" onClick={() => vline(true)} title={tr('Shift+F6: 칸 왼쪽에서 아래 줄로 (병렬 열기)', 'Shift+F6: from the left edge down')}>
              ├ {tr('세로선 (왼쪽)', 'V-line (left)')}
            </button>
            <span className="sep" />
            <button type="button" className="btn small" onClick={() => placeOut('out')} title="F9">
              ( ) {tr('코일', 'Coil')}
            </button>
            <button type="button" className="btn small" onClick={() => placeOut('set')} title="Shift+F9">
              (S)
            </button>
            <button type="button" className="btn small" onClick={() => placeOut('rst')}>
              (R)
            </button>
            <button type="button" className="btn small" onClick={() => placeOut('ton')}>
              [TON]
            </button>
            <button type="button" className="btn small" onClick={() => placeOut('ctu')}>
              [CTU]
            </button>
            <button type="button" className="btn small" onClick={() => placeOut('app')} title={tr('F10: 응용 명령 (MOV K10 D0 …)', 'F10: instruction (MOV K10 D0 …)')}>
              [ ] {tr('명령', 'Instr')}
            </button>
            <button type="button" className="btn small" onClick={remove} title="Delete">
              {tr('지우기', 'Delete')}
            </button>
          </div>
          <div className="ld-tools">
            <button type="button" className="btn small" onClick={() => sel && change(addRow(ladder, sel.rung, sel.row))} disabled={!sel || !!rung?.raw}>
              {tr('줄 추가 (병렬)', 'Add row')}
            </button>
            <button type="button" className="btn small" onClick={() => sel && change(deleteRow(ladder, sel.rung, sel.row))} disabled={!sel || !rung || rung.rows <= 1}>
              {tr('줄 삭제', 'Delete row')}
            </button>
            <span className="sep" />
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const at = sel?.rung ?? ladder.rungs.length - 1;
                change(addRung(ladder, at));
                setSel({ rung: at + 1, row: 0, col: 0 });
              }}
            >
              {tr('렁 추가', 'Add rung')}
            </button>
            <button type="button" className="btn small" onClick={() => sel && change(deleteRung(ladder, sel.rung))} disabled={!sel}>
              {tr('렁 삭제', 'Delete rung')}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (!sel) return;
                change(moveRung(ladder, sel.rung, -1));
                setSel({ ...sel, rung: Math.max(0, sel.rung - 1) });
              }}
              disabled={!sel || sel.rung === 0}
            >
              ▲
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (!sel) return;
                change(moveRung(ladder, sel.rung, 1));
                setSel({ ...sel, rung: Math.min(ladder.rungs.length - 1, sel.rung + 1) });
              }}
              disabled={!sel || sel.rung === ladder.rungs.length - 1}
            >
              ▼
            </button>
          </div>
          <div className="ld-edit">
            {sel && rung && !rung.raw && sel.col < cols && cell && cell.k !== 'h' && (
              <>
                <select className="input" value={cell.k} onChange={(e) => setCellPatch({ k: e.target.value as LdContactKind })}>
                  <option value="no">{tr('a접점', 'NO')}</option>
                  <option value="nc">{tr('b접점', 'NC')}</option>
                  <option value="p">{tr('상승 접점 ↑', 'Rising ↑')}</option>
                  <option value="n">{tr('하강 접점 ↓', 'Falling ↓')}</option>
                  <option value="cmp">{tr('비교 접점', 'Compare')}</option>
                </select>
                <input ref={devRef} className="input mono" list="ld-devs" value={cell.dev ?? ''} placeholder={dialect === 'ls' ? 'P00000' : 'X0'} onChange={(e) => setCellPatch({ dev: e.target.value.toUpperCase() })} />
                {cell.k === 'cmp' && (
                  <>
                    <select className="input" value={cell.op ?? '='} onChange={(e) => setCellPatch({ op: e.target.value as CmpOp })}>
                      {(['=', '<>', '>', '<', '>=', '<='] as CmpOp[]).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <input className="input mono" value={cell.b ?? ''} placeholder={dialect === 'ls' ? '10' : 'K10'} onChange={(e) => setCellPatch({ b: e.target.value.toUpperCase() })} />
                  </>
                )}
                {cell.k !== 'cmp' && noteInput(cell.dev ?? '')}
              </>
            )}
            {sel && rung && !rung.raw && sel.col === cols && out && (
              <>
                <select className="input" value={out.k} onChange={(e) => setOutPatch({ k: e.target.value as LdOutKind, ...(e.target.value === 'ton' || e.target.value === 'tof' || e.target.value === 'ctu' ? { arg: out.arg ?? '30' } : {}) })}>
                  <option value="out">{tr('코일 ( )', 'Coil ( )')}</option>
                  <option value="set">SET (S)</option>
                  <option value="rst">RST (R)</option>
                  <option value="pls">{tr('상승 펄스 (PLS)', 'Pulse (PLS)')}</option>
                  <option value="plf">{tr('하강 펄스 (PLF)', 'Pulse (PLF)')}</option>
                  <option value="ton">{tr('ON 딜레이 타이머', 'On-delay timer')}</option>
                  {lsTimer && <option value="tof">{tr('OFF 딜레이 타이머', 'Off-delay timer')}</option>}
                  <option value="ctu">{tr('카운터 (업)', 'Counter (up)')}</option>
                  <option value="app">{tr('응용 명령', 'Instruction')}</option>
                </select>
                <input
                  ref={devRef}
                  className={`input mono ${out.k === 'app' ? 'wide' : ''}`}
                  list={out.k === 'app' ? undefined : 'ld-devs'}
                  value={out.dev}
                  placeholder={out.k === 'app' ? (dialect === 'ls' ? 'MOV 10 D00000' : 'MOV K10 D0') : out.k === 'ton' || out.k === 'tof' ? (dialect === 'ls' ? 'T0000' : 'T0') : out.k === 'ctu' ? (dialect === 'ls' ? 'C0000' : 'C0') : dialect === 'ls' ? 'P00040' : 'Y0'}
                  onChange={(e) => setOutPatch({ dev: e.target.value.toUpperCase() })}
                />
                {(out.k === 'ton' || out.k === 'tof' || out.k === 'ctu') && (
                  <label className="small">
                    {out.k === 'ctu' ? tr('설정 수', 'Preset') : tr('설정 (×100ms)', 'Preset (×100 ms)')} <input className="input mono num" value={out.arg ?? ''} onChange={(e) => setOutPatch({ arg: e.target.value })} />
                  </label>
                )}
                {out.k !== 'app' && noteInput(out.dev)}
              </>
            )}
            {sel && rung && !rung.raw && !(sel.col < cols && cell && cell.k !== 'h') && !(sel.col === cols && out) && (
              <span className="muted small">{tr('칸을 고르고 F3 a접점 · F4 b접점 · F5 가로선 · F6 세로선 · F9 코일 · F10 명령. 방향키로 움직이고 Delete 로 지웁니다', 'Pick a cell: F3 NO · F4 NC · F5 line · F6 vertical · F9 coil · F10 instruction. Arrows move, Delete removes')}</span>
            )}
            {rung?.raw && <span className="muted small">{tr('이 렁은 래더로 그릴 수 없는 명령 (STL · 점프 등) 이라 니모닉 그대로 둡니다', 'This rung uses instructions that have no ladder form; it is kept as mnemonics')}</span>}
          </div>
          <datalist id="ld-devs">
            {(devices ?? []).map((d) => (
              <option key={d} value={d}>
                {comments.get(d) ?? ''}
              </option>
            ))}
          </datalist>
        </>
      )}
      <div className="ld-rungs">
        {ladder.rungs.map((r, ri) => (
          <div key={r.id} className={`ld-rung ${bad.has(ri + 1) ? 'bad' : ''}`}>
            <div className="ld-rung-head">
              <span className="ld-no">{ri + 1}</span>
              {readOnly ? (
                r.comment && <span className="muted small">{r.comment}</span>
              ) : (
                <input className="input ld-comment" value={r.comment ?? ''} placeholder={tr('렁 설명 (설명문)', 'Rung comment')} onChange={(e) => change(setRungComment(ladder, ri, e.target.value), `ld-cm-${r.id}`)} />
              )}
            </div>
            {r.raw ? (
              <pre className="ld-raw">{r.raw.join('\n')}</pre>
            ) : (
              <RungSvg rung={r} ri={ri} cols={Math.min(cols, drawCols)} sel={sel} onSel={readOnly ? undefined : (s) => ((typingBuf.current = null), setSel(s), boxRef.current?.focus())} comments={comments} monitor={monitor} scale={scale} dialect={dialect} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactIcon({ k }: { k: 'no' | 'nc' | 'p' | 'n' }) {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden>
      <path d="M0,6H8M8,1V11M14,1V11M14,6H22" stroke="currentColor" fill="none" strokeWidth="1.4" />
      {k === 'nc' && <path d="M7,11L15,1" stroke="currentColor" strokeWidth="1.4" />}
      {k === 'p' && <path d="M11,9V3M9,5L11,3L13,5" stroke="currentColor" fill="none" strokeWidth="1.2" />}
      {k === 'n' && <path d="M11,3V9M9,7L11,9L13,7" stroke="currentColor" fill="none" strokeWidth="1.2" />}
    </svg>
  );
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 렁 하나를 SVG 로 */
function RungSvg({ rung, ri, cols, sel, onSel, comments, monitor, scale, dialect }: { rung: LdRung; ri: number; cols: number; sel: Sel | null; onSel?: (s: Sel) => void; comments: Map<string, string>; monitor?: (dev: string) => boolean | null; scale: number; dialect: LdDialect }) {
  const W = LM + cols * CW + OW + 6;
  const H = rung.rows * RH + 4;
  const ym = (r: number) => r * RH + 28;
  const on = (dev?: string) => (monitor && dev ? monitor(dev.toUpperCase()) : null);
  const items: JSX.Element[] = [];
  for (let r = 0; r < rung.rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = LM + c * CW;
      const y = r * RH;
      const isSel = sel && sel.rung === ri && sel.row === r && sel.col === c;
      if (onSel)
        items.push(
          <rect key={`hit${r},${c}`} x={x} y={y} width={c === cols ? OW : CW} height={RH} fill={isSel ? 'var(--ld-sel)' : 'transparent'} stroke={isSel ? 'var(--accent)' : 'none'} strokeDasharray="4 3" onMouseDown={(e) => (e.preventDefault(), onSel({ rung: ri, row: r, col: c }))} />,
        );
      else if (isSel) items.push(<rect key={`sel${r},${c}`} x={x} y={y} width={CW} height={RH} fill="var(--ld-sel)" />);
      if (c === cols) continue;
      const cell = rung.cells[`${r},${c}`];
      if (!cell) continue;
      const m = ym(r);
      if (cell.k === 'h') {
        items.push(<path key={`c${r},${c}`} d={`M${x},${m}H${x + CW}`} className="ld-wire" />);
        continue;
      }
      const v = on(cell.dev);
      const closed = v === null ? null : cell.k === 'nc' ? !v : cell.k === 'cmp' ? null : v;
      const dev = cell.dev ?? '';
      const cm = comments.get(dev.toUpperCase()) ?? '';
      if (cell.k === 'cmp') {
        items.push(
          <g key={`c${r},${c}`}>
            <path d={`M${x},${m}H${x + 4}M${x + CW - 4},${m}H${x + CW}`} className="ld-wire" />
            <rect x={x + 4} y={m - 11} width={CW - 8} height={22} className="ld-box" />
            <text x={x + CW / 2} y={m + 4} className="ld-dev small" textAnchor="middle">
              {short(`${dev}${cell.op ?? '='}${cell.b ?? ''}`, 12)}
            </text>
          </g>,
        );
        continue;
      }
      const a = x + CW * 0.4;
      const b = x + CW * 0.6;
      items.push(
        <g key={`c${r},${c}`}>
          {closed && <rect x={a - 1} y={m - 10} width={b - a + 2} height={20} className="ld-on" />}
          <path d={`M${x},${m}H${a}M${a},${m - 10}V${m + 10}M${b},${m - 10}V${m + 10}M${b},${m}H${x + CW}`} className="ld-wire" />
          {cell.k === 'nc' && <path d={`M${a - 3},${m + 10}L${b + 3},${m - 10}`} className="ld-wire" />}
          {cell.k === 'p' && <path d={`M${(a + b) / 2},${m + 6}V${m - 6}M${(a + b) / 2 - 4},${m - 2}L${(a + b) / 2},${m - 6}L${(a + b) / 2 + 4},${m - 2}`} className="ld-wire thin" />}
          {cell.k === 'n' && <path d={`M${(a + b) / 2},${m - 6}V${m + 6}M${(a + b) / 2 - 4},${m + 2}L${(a + b) / 2},${m + 6}L${(a + b) / 2 + 4},${m + 2}`} className="ld-wire thin" />}
          <text x={x + CW / 2} y={m - 14} className={`ld-dev ${dev ? '' : 'missing'}`} textAnchor="middle">
            {dev || '?'}
          </text>
          {cm && (
            <text x={x + CW / 2} y={m + 22} className="ld-cm" textAnchor="middle">
              {short(cm, 9)}
            </text>
          )}
        </g>,
      );
    }
    // 출력
    const o = rung.outs[String(r)];
    if (o) {
      const x = LM + cols * CW;
      const m = ym(r);
      const v = on(o.k === 'app' ? undefined : o.dev);
      const cm = o.k === 'app' ? '' : comments.get(o.dev.toUpperCase()) ?? '';
      if (o.k === 'ton' || o.k === 'tof' || o.k === 'ctu' || o.k === 'app') {
        // 미쓰비시는 OUT T0 K30 (GX Works 처럼 T0 K30), LS 는 TON T0000 30
        const label = o.k === 'app' ? o.dev : dialect === 'mitsubishi' ? `${o.dev} K${o.arg ?? ''}` : `${OUT_LABEL[o.k]} ${o.dev} ${o.arg ?? ''}`;
        items.push(
          <g key={`o${r}`}>
            <path d={`M${x},${m}H${x + 12}M${x + OW - 12},${m}H${x + OW}`} className="ld-wire" />
            <rect x={x + 12} y={m - 12} width={OW - 24} height={24} className={`ld-box ${v ? 'on' : ''}`} />
            <text x={x + OW / 2} y={m + 4} className="ld-dev" textAnchor="middle">
              {short(label || '?', 20)}
            </text>
            {cm && (
              <text x={x + OW / 2} y={m + 23} className="ld-cm" textAnchor="middle">
                {short(cm, 18)}
              </text>
            )}
          </g>,
        );
      } else {
        const cx = x + 44;
        items.push(
          <g key={`o${r}`}>
            <path d={`M${x},${m}H${cx - 12}M${cx + 12},${m}H${x + OW}`} className="ld-wire" />
            {v && <circle cx={cx} cy={m} r={10} className="ld-on" />}
            <path d={`M${cx - 6},${m - 11}Q${cx - 14},${m} ${cx - 6},${m + 11}M${cx + 6},${m - 11}Q${cx + 14},${m} ${cx + 6},${m + 11}`} className="ld-wire" fill="none" />
            {OUT_LABEL[o.k] && (
              <text x={cx} y={m + 4} className="ld-dev small" textAnchor="middle">
                {OUT_LABEL[o.k]}
              </text>
            )}
            <text x={cx} y={m - 15} className={`ld-dev ${o.dev ? '' : 'missing'}`} textAnchor="middle">
              {o.dev || '?'}
            </text>
            {cm && (
              <text x={cx + 16} y={m + 19} className="ld-cm" textAnchor="start">
                {short(cm, 12)}
              </text>
            )}
          </g>,
        );
      }
    }
  }
  // 세로선
  for (const v of rung.vl) {
    const [r, x] = v.split(',').map(Number);
    const px = LM + x * CW;
    items.push(<path key={`v${v}`} d={`M${px},${ym(r)}V${ym(r + 1)}`} className="ld-wire" />);
  }
  return (
    <svg className="ld-svg" width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: '100%', height: 'auto' }}>
      <path d={`M${LM},2V${H - 2}`} className="ld-rail" />
      <path d={`M${W - 6},2V${H - 2}`} className="ld-rail" />
      {items}
    </svg>
  );
}
