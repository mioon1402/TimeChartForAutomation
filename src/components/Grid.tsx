/**
 * 엑셀처럼 쓰는 표.
 *  - 방향키·Enter·Tab 으로 칸 이동, 글자를 치면 바로 입력 (한글 입력 포함), F2·더블클릭으로 고치기, Esc 취소
 *  - Ctrl+C / Ctrl+V 로 엑셀·구글 시트와 여러 칸 복사·붙여넣기, 한 칸 값을 여러 칸에 붙이면 모두 채움
 *  - 마우스 끌기·Shift+방향키로 범위 선택, 줄 번호를 누르면 줄 선택 (Delete 로 줄 삭제)
 *  - Alt+↑/↓ 줄 이동, Ctrl+D 줄 복제, Ctrl+- 줄 삭제, Ctrl+Z / Ctrl+Y 실행 취소·다시 실행
 *  - 마지막 빈 줄에 적으면 줄이 늘어난다
 * 값은 모두 글자로 주고받고, 뜻은 부모가 정한다 (onEdit).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { parseTable, toTsv } from '../io/tsv';
import { useStore } from '../store/store';
import { tr } from '../i18n';
import { Icon } from './ui';

export interface GridCol {
  key: string;
  title: string;
  width?: number;
  mono?: boolean;
  /** 숫자: 오른쪽 정렬 */
  num?: boolean;
  readOnly?: boolean;
  /** 입력할 때 보여 줄 후보 */
  options?: string[];
  tip?: string;
}

export interface GridEdit {
  row: number;
  col: string;
  text: string;
}

export interface GridProps {
  label: string;
  cols: GridCol[];
  rows: number;
  text(row: number, col: string): string;
  /** 편집 중이 아닐 때 칸 모양 (없으면 글자) */
  view?(row: number, col: string): ReactNode;
  onEdit(edits: GridEdit[]): void;
  /** 표 붙여 넣기를 대신 처리하면 true */
  onPasteTable?(matrix: string[][], row: number, col: number): boolean;
  onDelete?(rows: number[]): void;
  onMove?(row: number, dir: -1 | 1): void;
  onDuplicate?(row: number): void;
  /** 마지막 빈 줄 안내 (없으면 줄을 늘릴 수 없음) */
  appendHint?: string;
  rowClass?(row: number): string | undefined;
  /** 칸마다 다른 입력 후보 */
  optionsFor?(row: number, col: string): string[] | undefined;
  /** 오른쪽에 붙는 읽기 전용 칸 (시간 흐름 막대 등) */
  extra?: { title: string; render(row: number): ReactNode; width?: number };
}

interface Cell {
  r: number;
  c: number;
}

type Pending = 'enter' | 'shiftEnter' | 'tab' | 'shiftTab' | null;

export function Grid(props: GridProps) {
  const { cols, rows, text, onEdit, appendHint } = props;
  const uid = useId().replace(/:/g, '');
  const total = rows + (appendHint ? 1 : 0);
  const [act, setAct] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [editing, setEditingState] = useState(false);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const editingRef = useRef(false);
  const wantFocus = useRef(false);
  const caretEnd = useRef(false);
  const dragging = useRef(false);
  const pending = useRef<Pending>(null);
  const lastCommitAt = useRef(0);
  const tools = !!(props.onMove || props.onDelete || props.onDuplicate);

  const setEditing = (v: boolean) => {
    editingRef.current = v;
    setEditingState(v);
  };

  // 줄 수가 바뀌어 선택 칸이 표 밖으로 나가면 안으로
  useEffect(() => {
    if (!act) return;
    const r = Math.min(act.r, Math.max(total - 1, 0));
    if (total === 0) setAct(null);
    else if (r !== act.r) setAct({ r, c: act.c });
  }, [act, total]);

  // 입력 칸 하나를 선택한 칸 위에 올린다 (칸을 옮겨도 포커스·한글 입력이 끊기지 않게)
  useLayoutEffect(() => {
    const el = inputRef.current;
    const wrap = wrapRef.current;
    const td = act ? tableRef.current?.tBodies[0]?.rows[act.r]?.cells[act.c + 1] : undefined;
    if (!el || !wrap || !td) return;
    const w = wrap.getBoundingClientRect();
    const t = td.getBoundingClientRect();
    el.style.left = `${t.left - w.left + wrap.scrollLeft}px`;
    el.style.top = `${t.top - w.top + wrap.scrollTop}px`;
    el.style.width = `${t.width}px`;
    el.style.height = `${t.height}px`;
  });

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !wantFocus.current) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (!editingRef.current) el.select();
    else if (caretEnd.current) {
      el.setSelectionRange(el.value.length, el.value.length);
      caretEnd.current = false;
    }
    const td = act ? tableRef.current?.tBodies[0]?.rows[act.r]?.cells[act.c + 1] : undefined;
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [act, editing]);

  // 창 크기가 바뀌면 칸 폭이 바뀌므로 입력 칸 위치를 다시 잡는다
  const [, relayout] = useState(0);
  useEffect(() => {
    const up = () => (dragging.current = false);
    const resize = () => relayout((n) => n + 1);
    window.addEventListener('mouseup', up);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const cellText = (r: number, c: number) => (r < rows && cols[c] ? text(r, cols[c].key) : '');

  const rangeOf = (): { r0: number; r1: number; c0: number; c1: number } | null => {
    if (!act) return null;
    const a = anchor ?? act;
    return { r0: Math.min(a.r, act.r), r1: Math.max(a.r, act.r), c0: Math.min(a.c, act.c), c1: Math.max(a.c, act.c) };
  };
  const rg = rangeOf();
  const inRange = (r: number, c: number) => !!rg && r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1;
  const wholeRows = !!rg && rg.c0 === 0 && rg.c1 === cols.length - 1 && (rg.r1 > rg.r0 || anchor !== null);

  const go = (r: number, c: number, extend = false) => {
    const cc = Math.max(0, Math.min(c, cols.length - 1));
    const rr = Math.max(0, Math.min(r, Math.max(total - 1, 0) + (appendHint && r === total ? 1 : 0)));
    wantFocus.current = true;
    setAnchor(extend ? (anchor ?? act) : null);
    setAct({ r: rr, c: cc });
  };

  /** 편집 중인 글자를 반영. 반영했으면 true */
  const commit = (): boolean => {
    if (!editingRef.current || !act) return false;
    const value = inputRef.current?.value ?? draft;
    setEditing(false);
    lastCommitAt.current = Date.now();
    const col = cols[act.c];
    if (col && !col.readOnly && value !== cellText(act.r, act.c)) onEdit([{ row: act.r, col: col.key, text: value }]);
    return true;
  };

  const startEdit = () => {
    if (!act || cols[act.c]?.readOnly) return;
    setDraft(cellText(act.r, act.c));
    caretEnd.current = true;
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft('');
  };

  const move = (how: Exclude<Pending, null>) => {
    if (!act) return;
    if (how === 'enter') go(act.r + 1, act.c);
    else if (how === 'shiftEnter') go(act.r - 1, act.c);
    else if (how === 'tab') {
      if (act.c < cols.length - 1) go(act.r, act.c + 1);
      else go(act.r + 1, 0);
    } else if (act.c > 0) go(act.r, act.c - 1);
    else go(act.r - 1, cols.length - 1);
  };

  const rangeTexts = (): string[][] => {
    if (!rg) return [];
    const out: string[][] = [];
    for (let r = rg.r0; r <= Math.min(rg.r1, rows - 1); r++) {
      const row: string[] = [];
      for (let c = rg.c0; c <= rg.c1; c++) row.push(cellText(r, c));
      out.push(row);
    }
    return out;
  };

  const selectedRows = (): number[] => {
    if (!rg) return [];
    const out: number[] = [];
    for (let r = rg.r0; r <= Math.min(rg.r1, rows - 1); r++) out.push(r);
    return out;
  };

  const clearRange = () => {
    if (!rg) return;
    if (wholeRows && props.onDelete) {
      const del = selectedRows();
      if (del.length) {
        props.onDelete(del);
        setAnchor(null);
        go(Math.min(rg.r0, rows - del.length), 0);
      }
      return;
    }
    const edits: GridEdit[] = [];
    for (let r = rg.r0; r <= Math.min(rg.r1, rows - 1); r++) for (let c = rg.c0; c <= rg.c1; c++) if (!cols[c].readOnly && cellText(r, c) !== '') edits.push({ row: r, col: cols[c].key, text: '' });
    if (edits.length) onEdit(edits);
  };

  const pasteMatrix = (m: string[][]) => {
    if (!m.length || !act) return;
    const r0 = rg ? rg.r0 : act.r;
    const c0 = rg ? rg.c0 : act.c;
    if (props.onPasteTable?.(m, r0, c0)) return;
    const edits: GridEdit[] = [];
    const single = m.length === 1 && m[0].length === 1;
    if (single && rg && (rg.r1 > rg.r0 || rg.c1 > rg.c0)) {
      for (let r = rg.r0; r <= Math.min(rg.r1, rows - 1); r++) for (let c = rg.c0; c <= rg.c1; c++) if (!cols[c].readOnly) edits.push({ row: r, col: cols[c].key, text: m[0][0] });
    } else {
      m.forEach((line, i) => {
        const r = r0 + i;
        if (r >= rows && !appendHint) return;
        line.forEach((v, j) => {
          const c = c0 + j;
          if (c >= cols.length || cols[c].readOnly) return;
          edits.push({ row: r, col: cols[c].key, text: v });
        });
      });
    }
    if (!edits.length) return;
    onEdit(edits);
    if (!single) {
      wantFocus.current = true;
      setAnchor({ r: r0, c: c0 });
      setAct({ r: r0 + m.length - 1, c: Math.min(c0 + Math.max(...m.map((l) => l.length)) - 1, cols.length - 1) });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!act) return;
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (composing) {
      // 한글 조합 중 Enter/Tab: 조합이 끝난 뒤 칸 반영·이동
      if (e.key === 'Enter') pending.current = e.shiftKey ? 'shiftEnter' : 'enter';
      else if (e.key === 'Tab') {
        e.preventDefault();
        pending.current = e.shiftKey ? 'shiftTab' : 'tab';
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (editingRef.current) {
      if (k === 'Enter' || k === 'Tab') {
        e.preventDefault();
        commit();
        move(k === 'Enter' ? (e.shiftKey ? 'shiftEnter' : 'enter') : e.shiftKey ? 'shiftTab' : 'tab');
      } else if (k === 'Escape') {
        e.preventDefault();
        cancelEdit();
      } else if ((k === 'ArrowUp' || k === 'ArrowDown') && !listFor(act)) {
        e.preventDefault();
        commit();
        go(act.r + (k === 'ArrowUp' ? -1 : 1), act.c);
      }
      return;
    }
    // 방금 조합 끝 Enter 로 이동했으면 뒤따르는 Enter 는 무시 (일부 브라우저)
    if ((k === 'Enter' || k === 'Tab') && Date.now() - lastCommitAt.current < 60) {
      e.preventDefault();
      return;
    }
    const lastR = Math.max(total - 1, 0);
    const lastC = cols.length - 1;
    const handled = () => e.preventDefault();
    if (mod && (k === 'z' || k === 'Z') && !e.shiftKey) return handled(), useStore.getState().undo();
    if (mod && (k === 'y' || ((k === 'z' || k === 'Z') && e.shiftKey))) return handled(), useStore.getState().redo();
    if (mod && k === 'a') return handled(), setAnchor({ r: 0, c: 0 }), setAct({ r: Math.max(rows - 1, 0), c: lastC });
    if (mod && (k === 'd' || k === 'D') && props.onDuplicate && act.r < rows) return handled(), props.onDuplicate(act.r), go(act.r + 1, act.c);
    if (mod && k === '-' && props.onDelete) {
      handled();
      const del = selectedRows();
      if (del.length) props.onDelete(del);
      setAnchor(null);
      return;
    }
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && props.onMove && act.r < rows) {
      handled();
      const dir = k === 'ArrowUp' ? -1 : 1;
      const to = act.r + dir;
      if (to < 0 || to >= rows) return;
      props.onMove(act.r, dir);
      go(to, act.c);
      return;
    }
    switch (k) {
      case 'ArrowUp':
        return handled(), go(mod ? 0 : act.r - 1, act.c, e.shiftKey);
      case 'ArrowDown':
        return handled(), go(mod ? lastR : act.r + 1, act.c, e.shiftKey);
      case 'ArrowLeft':
        return handled(), go(act.r, mod ? 0 : act.c - 1, e.shiftKey);
      case 'ArrowRight':
        return handled(), go(act.r, mod ? lastC : act.c + 1, e.shiftKey);
      case 'PageUp':
        return handled(), go(act.r - 10, act.c, e.shiftKey);
      case 'PageDown':
        return handled(), go(act.r + 10, act.c, e.shiftKey);
      case 'Home':
        return handled(), go(mod ? 0 : act.r, 0, e.shiftKey);
      case 'End':
        return handled(), go(mod ? lastR : act.r, lastC, e.shiftKey);
      case 'Tab':
        return handled(), move(e.shiftKey ? 'shiftTab' : 'tab');
      case 'Enter':
        return handled(), move(e.shiftKey ? 'shiftEnter' : 'enter');
      case 'F2':
        return handled(), startEdit();
      case 'Delete':
      case 'Backspace':
        return handled(), clearRange();
      case 'Escape':
        if (anchor) return handled(), setAnchor(null);
        return;
    }
  };

  // 한글 조합 중 누른 Enter/Tab: 조합이 끝난 순간 바로 반영하고 이동 (뒤따르는 Enter 는 lastCommitAt 으로 무시)
  const onCompositionEnd = () => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    commit();
    move(p);
  };

  const onCopy = (e: ClipboardEvent<HTMLInputElement>) => {
    if (editingRef.current) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', toTsv(rangeTexts()));
  };

  const onCut = (e: ClipboardEvent<HTMLInputElement>) => {
    if (editingRef.current) return;
    onCopy(e);
    if (!wholeRows) clearRange();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData('text/plain');
    if (editingRef.current && !/[\t\n]/.test(txt.replace(/[\r\n]+$/, ''))) return;
    e.preventDefault();
    if (editingRef.current) cancelEdit();
    pasteMatrix(parseTable(txt));
  };

  const listFor = (cell: Cell): string[] | undefined => {
    const col = cols[cell.c];
    if (!col || col.readOnly) return undefined;
    const o = props.optionsFor?.(cell.r, col.key) ?? col.options;
    return o && o.length ? o : undefined;
  };

  const onCellDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (act && act.r === r && act.c === c && editingRef.current) return; // 편집 중 칸 안 클릭: 커서 이동
    e.preventDefault();
    commit();
    wantFocus.current = true;
    dragging.current = true;
    if (e.shiftKey && act) setAnchor(anchor ?? act);
    else setAnchor({ r, c });
    setAct({ r, c });
  };

  const onCellEnter = (r: number, c: number) => {
    if (!dragging.current) return;
    setAct({ r, c });
  };

  const onRowHead = (r: number, e: React.MouseEvent) => {
    if (e.button !== 0 || r >= rows) return;
    e.preventDefault();
    commit();
    wantFocus.current = true;
    const from = e.shiftKey && anchor ? anchor.r : r;
    setAnchor({ r: from, c: 0 });
    setAct({ r, c: cols.length - 1 });
  };

  const opts = act ? listFor(act) : undefined;
  // 폭을 정하지 않은 칸도 좁은 화면에서 0 이 되지 않게 (넘치면 가로 스크롤)
  const minWidth = 34 + cols.reduce((w, c) => w + (c.width ?? 150), 0) + (props.extra ? props.extra.width ?? 180 : 0) + (tools ? 84 : 0);

  return (
    <div
      ref={wrapRef}
      className={`grid-wrap ${focused ? 'focus' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFocused(false);
          wantFocus.current = false;
        }
      }}
    >
      <table ref={tableRef} className="grid" role="grid" aria-label={props.label} style={{ minWidth }}>
        <colgroup>
          <col style={{ width: 34 }} />
          {cols.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
          {props.extra && <col style={props.extra.width ? { width: props.extra.width } : undefined} />}
          {tools && <col style={{ width: 84 }} />}
        </colgroup>
        <thead>
          <tr>
            <th className="grid-rh" aria-label={tr('줄', 'Row')} />
            {cols.map((c) => (
              <th key={c.key} title={c.tip} className={c.num ? 'num' : undefined}>
                {c.title}
                {c.tip && <span className="grid-tip">?</span>}
              </th>
            ))}
            {props.extra && <th>{props.extra.title}</th>}
            {tools && <th aria-label={tr('줄 도구', 'Row tools')} />}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: total }, (_, r) => {
            const append = r >= rows;
            return (
              <tr key={r} className={`${append ? 'grid-append' : ''} ${props.rowClass?.(r) ?? ''} ${act?.r === r ? 'cur' : ''}`}>
                <th className={`grid-rh ${rg && r >= rg.r0 && r <= rg.r1 ? 'on' : ''}`} onMouseDown={(e) => onRowHead(r, e)} title={append ? undefined : tr('줄 선택 (Delete: 줄 삭제)', 'Select row (Delete removes it)')}>
                  {append ? <Icon name="plus" size={11} /> : r + 1}
                </th>
                {cols.map((col, c) => {
                  const isAct = !!act && act.r === r && act.c === c;
                  const cls = ['gc', col.mono ? 'mono' : '', col.num ? 'num' : '', col.readOnly ? 'ro' : '', inRange(r, c) && !isAct ? 'sel' : '', isAct ? 'act' : ''].filter(Boolean).join(' ');
                  const content = append ? (c === firstEditable(cols) && !editing ? <span className="grid-hint">{appendHint}</span> : null) : props.view ? props.view(r, col.key) : cellText(r, c);
                  return (
                    <td key={col.key} className={cls} onMouseDown={(e) => onCellDown(r, c, e)} onMouseEnter={() => onCellEnter(r, c)}>
                      {content}
                    </td>
                  );
                })}
                {props.extra && <td className="gc ro extra">{append ? null : props.extra.render(r)}</td>}
                {tools && (
                  <td className="gc tools">
                    {!append && (
                      <span className="grid-tools">
                        {props.onMove && (
                          <>
                            <button type="button" className="mini-btn" tabIndex={-1} title={tr('위로 (Alt+↑)', 'Up (Alt+↑)')} disabled={r === 0} onClick={() => props.onMove!(r, -1)}>
                              ▲
                            </button>
                            <button type="button" className="mini-btn" tabIndex={-1} title={tr('아래로 (Alt+↓)', 'Down (Alt+↓)')} disabled={r === rows - 1} onClick={() => props.onMove!(r, 1)}>
                              ▼
                            </button>
                          </>
                        )}
                        {props.onDuplicate && (
                          <button type="button" className="mini-btn" tabIndex={-1} title={tr('아래에 복제 (Ctrl+D)', 'Duplicate (Ctrl+D)')} onClick={() => props.onDuplicate!(r)}>
                            <Icon name="copy" size={12} />
                          </button>
                        )}
                        {props.onDelete && (
                          <button type="button" className="mini-btn danger" tabIndex={-1} title={tr('줄 삭제 (Ctrl+-)', 'Delete row (Ctrl+-)')} onClick={() => props.onDelete!([r])}>
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {act && cols[act.c] && (
        <input
          ref={inputRef}
          className={`grid-input ${cols[act.c].mono ? 'mono' : ''} ${cols[act.c].num ? 'num' : ''} ${editing ? 'editing' : ''}`}
          value={editing ? draft : cellText(act.r, act.c)}
          readOnly={cols[act.c].readOnly}
          list={opts ? `${uid}-opts` : undefined}
          aria-label={`${cols[act.c].title} ${act.r + 1}`}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            if (!editingRef.current) setEditing(true);
            setDraft(e.target.value);
          }}
          onMouseDown={(e) => {
            // 입력 중이 아니면 글자 전체 선택을 유지 (바로 쳐서 바꾸기)
            if (!editingRef.current) {
              e.preventDefault();
              dragging.current = true;
              setAnchor(act);
            }
          }}
          onDoubleClick={() => !editingRef.current && startEdit()}
          onKeyDown={onKey}
          onCompositionEnd={onCompositionEnd}
          onBlur={() => commit()}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
        />
      )}
      {/* 입력 중에 list 를 붙였다 떼면 한글 조합이 끊기므로 선택한 칸에는 늘 붙여 둔다 */}
      {opts && (
        <datalist id={`${uid}-opts`}>
          {opts.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </div>
  );
}

function firstEditable(cols: GridCol[]): number {
  const i = cols.findIndex((c) => !c.readOnly);
  return i < 0 ? 0 : i;
}
