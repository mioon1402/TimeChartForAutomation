/**
 * 동작 순서 페이지: 실무 작성 순서(① 설비 → ② 동작 기기 → ③ I/O → ④ 동작 순서 → ⑤ 확인)를 한 페이지에 위에서 아래로.
 * 표는 엑셀처럼 입력하고 엑셀 표를 그대로 붙여 넣을 수 있다. 고친 내용은 프로젝트에 바로 저장되고(실행 취소 가능),
 * 차트는 [차트에 적용]을 눌렀을 때만 다시 만든다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { actionText, addrStyleName, computeTimeline, ioPoints, LABEL_PAIRS, newDevice, suggestActions, type AddrStyle, type DeviceKind, type IoPoint, type SeqSpec } from '../model/sequence';
import {
  applySequence,
  autoTitle,
  chartEditedSinceApply,
  detectActionHeader,
  deviceText,
  duplicateAction,
  editActions,
  editDevices,
  emptySpec,
  fmtSec,
  KIND_LABEL,
  moveAction,
  moveItem,
  pasteActionTable,
  pasteDeviceTable,
  pasteIoTable,
  removeActions,
  removeDevices,
  sensorOptions,
  sequenceStatus,
  startText,
  unusedDevices,
  withSequence,
  type DevCol,
  type EditResult,
} from '../model/seqEdit';
import { formatTime } from '../model/format';
import { ChartSvg } from '../render/ChartSvg';
import { SCREEN_COLORS } from '../render/layout';
import { parseTable, toTsv } from '../io/tsv';
import { defaultSimSettings } from '../plc/types';
import { tr } from '../i18n';
import { storageGet, storageRemove } from '../storage';
import { Grid, type GridCol, type GridEdit } from './Grid';
import { askConfirm, askText, Check, Field, Icon, Select, TextInput } from './ui';
import { copyText, newSequenceChart } from './fileActions';
import { endPractice } from './Practice';
import { seqExamples } from '../model/seqExamples';

/** 이전 버전의 작성 도우미가 남긴 작성 중 입력 */
const OLD_DRAFT_KEY = 'timechart-studio.wizard-draft.v1';

function oldDraft(): SeqSpec | null {
  try {
    const raw = storageGet(OLD_DRAFT_KEY);
    const s = raw ? (JSON.parse(raw) as SeqSpec) : null;
    return s && Array.isArray(s.devices) && Array.isArray(s.actions) ? s : null;
  } catch {
    return null;
  }
}

export function SequencePanel() {
  const project = useStore((s) => s.project);
  const practice = useStore((s) => !!s.practice);
  if (practice) {
    return (
      <div className="seq-page">
        <div className="seq-start">
          <h2>{tr('연습 문제를 푸는 중입니다', 'A practice problem is open')}</h2>
          <p>{tr('연습 중에는 동작 순서표를 쓸 수 없습니다. 연습을 끝내면 원래 차트로 돌아옵니다.', 'The sequence table is not available during practice. End practice to return to your chart.')}</p>
          <div className="seq-start-btns">
            <button type="button" className="btn" onClick={() => useStore.getState().setTab('editor')}>
              {tr('연습으로 돌아가기', 'Back to practice')}
            </button>
            <button type="button" className="btn" onClick={endPractice}>
              {tr('연습 끝내기', 'End practice')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!project.sequence) return <SequenceStart title={project.meta.title} />;
  return <SequenceEditor />;
}

/** 동작 순서로 만든 차트가 아닐 때: 새로 시작 */
function SequenceStart({ title }: { title: string }) {
  const draft = useMemo(oldDraft, []);
  const steps: [string, string][] = [
    [tr('설비', 'Machine'), tr('설비 이름, 목표 사이클 타임', 'name, target cycle time')],
    [tr('동작 기기', 'Devices'), tr('실린더·모터·흡착과 동작 시간', 'cylinders, motors, vacuum, motion times')],
    [tr('I/O 목록', 'I/O list'), tr('SOL·센서 주소 (자동으로 뽑음)', 'SOL and sensor addresses (derived)')],
    [tr('동작 순서', 'Sequence'), tr('한 사이클 동안 움직이는 순서', 'motions in one cycle')],
    [tr('확인', 'Review'), tr('사이클 타임, 인터록, 차트 미리보기', 'cycle time, interlocks, preview')],
  ];
  return (
    <div className="seq-page">
      <div className="seq-start">
        <h2>
          <Icon name="table" size={20} /> {tr('동작 순서표로 타임차트 만들기', 'Build a timing chart from a sequence table')}
        </h2>
        <p>
          {tr(
            '실무에서 타임차트를 만드는 순서 그대로, 한 페이지에서 위에서 아래로 적어 내려가면 차트가 만들어집니다. 표는 엑셀처럼 입력하고, 엑셀에 정리해 둔 동작 순서표나 I/O 리스트를 복사해 붙여 넣을 수 있습니다.',
            'Fill in one page from top to bottom, the way charts are made in practice. Tables work like a spreadsheet, and you can paste your Excel sequence table or I/O list.',
          )}
        </p>
        <ol className="seq-start-steps">
          {steps.map(([a, b], i) => (
            <li key={a}>
              <span className="seq-n">{'①②③④⑤'[i]}</span>
              <b>{a}</b>
              <span>{b}</span>
            </li>
          ))}
        </ol>
        <h3 className="seq-start-sub">{tr('예시로 시작하기 (고쳐서 쓰세요)', 'Start from an example (then edit it)')}</h3>
        <div className="seq-examples">
          {seqExamples().map((ex, i) => (
            <button type="button" key={ex.id} className={`seq-example ${i === 0 ? 'first' : ''}`} onClick={() => newSequenceChart(ex.build())}>
              <b>{ex.name}</b>
              <span>{ex.note}</span>
            </button>
          ))}
        </div>
        <div className="seq-start-btns">
          <button type="button" className="btn" onClick={() => newSequenceChart(emptySpec())}>
            <Icon name="table" size={15} /> {tr('빈 표로 시작하기', 'Start with empty tables')}
          </button>
          {draft && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (await newSequenceChart(draft)) storageRemove(OLD_DRAFT_KEY);
              }}
            >
              <Icon name="open" size={15} /> {tr('작성하던 순서 이어서 하기', 'Continue your unfinished sequence')}
            </button>
          )}
        </div>
        <p className="muted small">
          {tr(
            `지금 열린 차트("${title}")는 동작 순서표로 만든 차트가 아닙니다. 시작하면 새 차트가 열립니다. 저장하지 않은 변경이 있으면 먼저 묻습니다.`,
            `The open chart ("${title}") was not built from a sequence table. Starting opens a new chart; you will be asked first if there are unsaved changes.`,
          )}
        </p>
      </div>
    </div>
  );
}

/** 초 단위 입력 (값은 ms) */
function SecInput({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const [v, setV] = useState(fmtSec(value));
  useEffect(() => setV(fmtSec(value)), [value]);
  const commit = () => {
    const n = parseFloat(v.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) {
      const ms = Math.round(n * 1000);
      if (ms !== value) onChange(ms);
    } else setV(fmtSec(value));
  };
  return (
    <span className="sec-input">
      <input className="input mono" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span>{tr('초', 's')}</span>
    </span>
  );
}

function Sec({ id, n, title, why, right, children }: { id: string; n: string; title: string; why?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="seq-sec" id={id}>
      <header className="seq-sec-head">
        <span className="seq-n">{n}</span>
        <h3>{title}</h3>
        <span className="grow" />
        {right}
      </header>
      {why && <p className="seq-why">{why}</p>}
      {children}
    </section>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const DEV_GRID: { key: DevCol; ko: string; en: string; width: number; num?: boolean; tip?: [string, string] }[] = [
  { key: 'name', ko: '이름', en: 'Name', width: 130 },
  { key: 'kind', ko: '종류', en: 'Type', width: 140 },
  { key: 'fwd', ko: '가는 동작', en: 'Go motion', width: 96 },
  { key: 'ret', ko: '돌아오는 동작', en: 'Return motion', width: 108 },
  { key: 'fwdT', ko: '가는 시간(초)', en: 'Go time (s)', width: 104, num: true, tip: ['한쪽 끝에서 반대쪽 끝까지 가는 시간. 예: 0.5, 500ms', 'End-to-end travel time, e.g. 0.5 or 500ms'] },
  { key: 'retT', ko: '돌아오는 시간(초)', en: 'Return time (s)', width: 122, num: true },
  { key: 'sen', ko: '끝 센서', en: 'Sensors', width: 96, tip: ['끝 위치 센서: 있음(양쪽 끝, 흡착은 흡착 확인) / 없음 / 전진단만 / 후진단만', 'End sensors: both / none / go end only / return end only'] },
];

function SequenceEditor() {
  const project = useStore((s) => s.project);
  const spec = project.sequence!;
  const meta = project.meta;
  const { commit, setMeta, toast, setTab, setBottom } = useStore.getState();
  const tl = useMemo(() => computeTimeline(spec), [spec]);
  const io = useMemo(() => ioPoints(spec), [spec]);
  const status = sequenceStatus(project);
  const edited = chartEditedSinceApply(project);
  const preview = useMemo(() => applySequence(project, spec), [spec, project.meta, project.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewRef, previewW] = useWidth<HTMLDivElement>();
  const cycle = tl.cycleEnd - tl.cycleStart;
  const unused = unusedDevices(spec);
  const inputs = io.filter((p) => p.dir === 'in');
  const outputs = io.filter((p) => p.dir === 'out');
  const timeOf = new Map(tl.items.map((it) => [it.action.id, it]));
  const maxEnd = Math.max(tl.cycleEnd, 1);

  const set = (next: SeqSpec) => commit(withSequence(useStore.getState().project, next));
  const report = (r: EditResult) => {
    set(r.spec);
    r.notes.slice(0, 3).forEach((n) => toast(n, 'info'));
    r.warnings.slice(0, 3).forEach((w) => toast(w, 'warn'));
  };
  const cur = () => useStore.getState().project.sequence ?? spec;

  const view = () => setTab('editor');
  const apply = async () => {
    const p = useStore.getState().project;
    if (!p.sequence) return;
    if (chartEditedSinceApply(p)) {
      const ok = await askConfirm(
        tr('차트 다시 만들기', 'Rebuild chart'),
        tr(
          '차트에서 직접 고친 파형·화살표·주석이 있습니다. 동작 순서표로 차트를 다시 만들면 그 수정은 사라집니다. 적용한 뒤에도 Ctrl+Z 로 되돌릴 수 있습니다. 계속할까요?',
          'The chart has manual edits (waveforms, arrows, notes). Rebuilding from the sequence replaces them. You can undo with Ctrl+Z. Continue?',
        ),
        tr('다시 만들기', 'Rebuild'),
      );
      if (!ok) return;
    }
    const next = applySequence(p, p.sequence);
    commit(next);
    setTab('editor');
    setBottom('steps');
    setTimeout(() => useStore.getState().fitZoom(), 0);
    toast(tr(`차트에 적용했습니다: ${tl.groups.length}단계, 사이클 타임 ${formatTime(cycle, 'auto')} (Ctrl+Z 로 되돌리기)`, `Applied: ${tl.groups.length} steps, cycle ${formatTime(cycle, 'auto')} (Ctrl+Z to undo)`), 'ok');
  };

  // 표 밖(아무 칸도 고르지 않은 상태)에서 Ctrl+V: 동작 순서표로 붙여 넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-back')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const m = parseTable(text);
      if (!m.length || (m.length === 1 && m[0].length === 1)) return;
      e.preventDefault();
      pasteWholeSequence(m, false);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  /** 엑셀 표 → 동작 순서. 제목 줄이 없으면 칸 수로 짐작 (기기 · 동작 · 시간 · 시작) */
  const pasteWholeSequence = (m: string[][], replace: boolean) => {
    const s = cur();
    let matrix = m;
    if (!detectActionHeader(m[0])) {
      // 첫 칸이 순서 번호(1, 2, S10 …)면 뺀다
      const numbered = m.every((r) => /^(s?\d+|\d+\.)$/i.test(r[0] ?? ''));
      const body = numbered ? m.map((r) => r.slice(1)) : m;
      const width = Math.max(...body.map((r) => r.length));
      const head = [tr('기기', 'device'), '동작', '시간', '시작'];
      const guess = width === 1 ? ['동작'] : head.slice(0, Math.min(width, 4));
      matrix = [guess, ...body];
    }
    const r = pasteActionTable(s, matrix, replace ? 0 : s.actions.length);
    if (r) report(r);
  };

  // ── ② 동작 기기 ──
  const devCols: GridCol[] = DEV_GRID.map((c) => ({
    key: c.key,
    title: tr(c.ko, c.en),
    width: c.width,
    num: c.num,
    tip: c.tip ? tr(c.tip[0], c.tip[1]) : undefined,
    options: c.key === 'kind' ? Object.values(KIND_LABEL) : c.key === 'fwd' ? LABEL_PAIRS.map((p) => p[0]) : c.key === 'ret' ? LABEL_PAIRS.map((p) => p[1]) : c.key === 'sen' ? ['있음', '없음'] : undefined,
  }));

  // ── ④ 동작 순서 ──
  const devNames = spec.devices.map((d) => d.name);
  const actCols: GridCol[] = [
    { key: 'step', title: tr('스텝', 'Step'), width: 58, readOnly: true, mono: true, tip: tr('동시에 움직이는 동작은 같은 스텝입니다', 'Motions that run together share a step') },
    { key: 'dev', title: tr('기기', 'Device'), width: 130, options: [...devNames, '대기'], tip: tr('② 에 없는 이름을 적으면 새 기기가 생깁니다. 기다리기만 할 때는 "대기"', 'A new name adds a device; use "대기" (wait) for a timer') },
    { key: 'mot', title: tr('동작', 'Motion'), width: 110 },
    { key: 'time', title: tr('시간(초)', 'Time (s)'), width: 82, num: true, tip: tr('기기 동작 시간은 ② 기기 표와 같은 값입니다 (같은 동작이 여러 번 나오면 함께 바뀜)', 'Device motion time is shared with the device table') },
    { key: 'start', title: tr('시작', 'Starts'), width: 170, options: ['앞 동작이 끝난 뒤', '앞 동작과 동시에', '앞 동작이 끝난 뒤 +0.2초', '앞 동작과 동시에 +0.3초'], tip: tr('끝에 +0.2 처럼 초를 붙이면 그만큼 늦게 시작합니다 (센서 확인 후 안정화, 출발하고 0.3초 뒤 블로우 등)', 'Add +0.2 to start that many seconds later') },
    { key: 'span', title: tr('시각(초)', 'At (s)'), width: 96, readOnly: true, mono: true, num: true, tip: tr('차트에서의 시작 ~ 끝 시각 (시작 버튼 0.1초)', 'Start ~ end on the chart') },
  ];
  const actText = (r: number, col: string): string => {
    const a = spec.actions[r];
    if (!a) return '';
    const d = spec.devices.find((x) => x.id === a.device);
    const it = timeOf.get(a.id);
    switch (col) {
      case 'step':
        return it ? `S${(it.group + 1) * 10}` : '';
      case 'dev':
        return a.device ? d?.name ?? '' : '대기';
      case 'mot':
        return a.device ? (d ? (a.dir === 'fwd' ? d.fwdLabel : d.retLabel) : '') : a.label;
      case 'time':
        return a.device ? (d ? fmtSec(a.dir === 'fwd' ? d.fwdTime : d.retTime) : '') : fmtSec(a.wait);
      case 'start':
        return startText(a, r === 0, spec.startButton);
      case 'span':
        return it ? `${fmtSec(it.start)} – ${fmtSec(it.end)}` : '';
    }
    return '';
  };
  const actView = (r: number, col: string): ReactNode => {
    const a = spec.actions[r];
    const t = actText(r, col);
    if (col === 'dev' && a && !a.device) return <span className="seq-wait">{t}</span>;
    if (col === 'start' && r === 0 && !a?.delay) return <span className="muted">{t}</span>;
    if (col === 'start' && a?.withPrev) return <span className="seq-with">↳ {t}</span>;
    if (col === 'step' && r > 0 && a?.withPrev) return <span className="muted">{t}</span>;
    return t;
  };

  // ── ③ I/O ──
  const ioGrid = (list: IoPoint[], label: string) => {
    const cols: GridCol[] = [
      { key: 'address', title: tr('주소', 'Address'), width: 96, mono: true },
      { key: 'name', title: tr('이름', 'Name') },
    ];
    return (
      <Grid
        label={label}
        cols={cols}
        rows={list.length}
        text={(r, c) => (c === 'address' ? list[r]?.address ?? '' : list[r]?.name ?? '')}
        onEdit={(edits: GridEdit[]) => {
          const s = cur();
          const ioEdits = { ...s.ioEdits };
          for (const e of edits) {
            const p = list[e.row];
            if (!p) continue;
            const prev = { ...ioEdits[p.key] };
            if (e.col === 'address') {
              if (e.text.trim()) prev.address = e.text.trim();
              else delete prev.address;
            } else if (e.text.trim()) prev.name = e.text.trim();
            else delete prev.name;
            if (prev.address === undefined && prev.name === undefined) delete ioEdits[p.key];
            else ioEdits[p.key] = prev;
          }
          set({ ...s, ioEdits });
        }}
        onPasteTable={(m) => {
          const r = pasteIoTable(cur(), m);
          if (!r) return false;
          report(r);
          return true;
        }}
      />
    );
  };

  const sendToPlc = () => {
    const p = useStore.getState().project;
    const lines = io.filter((x) => x.address).map((x) => `${x.address}\t${x.name}`);
    if (!lines.length) {
      toast(tr('주소가 있는 I/O 가 없습니다. 주소 방식을 먼저 고르세요.', 'No addressed I/O. Pick an address style first.'), 'warn');
      return;
    }
    const dialect = spec.addrStyle === 'ls' ? 'ls' : spec.addrStyle === 'siemens' ? 'siemens' : 'mitsubishi';
    const plc = p.plc ?? { dialect, source: '', comments: '', sim: defaultSimSettings() };
    const have = new Set(plc.comments.split(/\r?\n/).map((l) => l.split(/[\t,]/)[0]?.trim()).filter(Boolean));
    const add = lines.filter((l) => !have.has(l.split('\t')[0]));
    commit({ ...p, plc: { ...plc, comments: [plc.comments.trim(), ...add].filter(Boolean).join('\n') } });
    toast(tr(`PLC 탭 디바이스 코멘트에 I/O ${add.length}개를 넣었습니다. PLC 프로그램을 열면 이 이름으로 보입니다.`, `Added ${add.length} I/O names to the PLC tab's device comments.`), 'ok');
  };

  const copySequence = () => {
    const head = ['스텝', '기기', '동작', '시간(초)', '시작', '시각(초)'];
    const rows = spec.actions.map((_, r) => ['step', 'dev', 'mot', 'time', 'start', 'span'].map((c) => actText(r, c)));
    void copyText(toTsv([head, ...rows]), tr('동작 순서표를 복사했습니다. 엑셀에 붙여 넣으세요.', 'Sequence copied. Paste it into Excel.'));
  };
  const copyDevices = () => {
    const head = DEV_GRID.map((c) => c.ko);
    const rows = spec.devices.map((d) => DEV_GRID.map((c) => deviceText(d, c.key)));
    void copyText(toTsv([head, ...rows]), tr('동작 기기 표를 복사했습니다. 엑셀에 붙여 넣으세요.', 'Devices copied.'));
  };
  const copyIo = () => {
    const rows = io.map((p) => [p.dir === 'in' ? '입력' : '출력', p.address, p.name]);
    void copyText(toTsv([['구분', '주소', '이름'], ...rows]), tr('I/O 목록을 복사했습니다. 엑셀에 붙여 넣으세요.', 'I/O list copied.'));
  };

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const nav: [string, string][] = [
    ['seq-machine', tr('① 설비', '① Machine')],
    ['seq-devices', tr('② 기기', '② Devices')],
    ['seq-io', tr('③ I/O', '③ I/O')],
    ['seq-actions', tr('④ 순서', '④ Sequence')],
    ['seq-review', tr('⑤ 확인', '⑤ Review')],
  ];
  const targetOk = spec.targetCycle > 0 ? cycle <= spec.targetCycle : null;

  return (
    <div className="seq-page">
      <div className="seq-bar">
        <nav className="seq-nav" aria-label={tr('동작 순서 페이지 목차', 'Sections')}>
          {nav.map(([id, label]) => (
            <button type="button" key={id} className="seq-nav-btn" onClick={() => jump(id)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="grow" />
        <span className="seq-kpi-mini" title={tr('예상 사이클 타임', 'Estimated cycle time')}>
          <Icon name="step" size={14} /> {formatTime(cycle, 's')}
          {targetOk !== null && <b className={targetOk ? 'ok' : 'ng'}>{targetOk ? `≤ ${formatTime(spec.targetCycle, 's')} OK` : `> ${formatTime(spec.targetCycle, 's')} NG`}</b>}
        </span>
        <span className={`seq-status ${status}`}>
          {status === 'changed' ? tr('● 차트에 아직 적용 안 함', '● Not applied yet') : edited ? tr('✓ 적용됨 · 차트를 직접 고침', '✓ Applied · chart edited') : tr('✓ 차트와 같음', '✓ Chart is up to date')}
        </span>
        {status === 'changed' ? (
          <button type="button" className="btn small primary" onClick={apply} disabled={!tl.groups.length} data-tour="seq-apply">
            <Icon name="chart" size={14} /> {tr('차트에 적용', 'Apply to chart')}
          </button>
        ) : (
          <button type="button" className="btn small" onClick={view} data-tour="seq-apply">
            <Icon name="chart" size={14} /> {tr('타임차트 보기', 'View chart')}
          </button>
        )}
      </div>

      <div className="seq-inner">
        <p className="seq-keys">
          <Icon name="table" size={14} />{' '}
          {tr(
            '표는 엑셀처럼: 칸을 누르고 바로 입력 · Enter/Tab/방향키 이동 · F2 고치기 · Ctrl+C/V 로 엑셀과 복사·붙여넣기 · Alt+↑↓ 줄 이동 · Ctrl+D 복제 · Ctrl+- 줄 삭제 · Ctrl+Z 되돌리기',
            'Tables work like a spreadsheet: click and type · Enter/Tab/arrows move · F2 edit · Ctrl+C/V with Excel · Alt+↑↓ move row · Ctrl+D duplicate · Ctrl+- delete row · Ctrl+Z undo',
          )}
        </p>

        <Sec
          id="seq-machine"
          n="①"
          title={tr('설비', 'Machine')}
          why={tr(
            '어떤 설비이고 한 사이클을 몇 초 안에 끝내야 하는지 적습니다. 설비 이름·제목·도면 번호·작성자는 차트 제목과 보고서 표제란에 바로 들어갑니다.',
            'What machine this is and the cycle time it must meet. Name, title, drawing no. and author go straight into the chart title and report title block.',
          )}
        >
          <div className="seq-fields">
            <Field label={tr('설비 이름', 'Machine')}>
              <TextInput
                value={meta.machine}
                placeholder={tr('예: 프레스 압입 설비', 'e.g. Press-fit machine')}
                onChange={(v) => setMeta(meta.title === autoTitle(meta.machine) || !meta.title ? { machine: v, title: autoTitle(v) } : { machine: v })}
              />
            </Field>
            <Field label={tr('차트 제목', 'Chart title')}>
              <TextInput value={meta.title} placeholder={autoTitle(meta.machine)} onChange={(v) => setMeta({ title: v || autoTitle(meta.machine) })} />
            </Field>
            <Field label={tr('도면 번호', 'Drawing no.')}>
              <TextInput value={meta.drawingNo} onChange={(v) => setMeta({ drawingNo: v })} />
            </Field>
            <Field label={tr('작성자', 'Author')}>
              <TextInput value={meta.author} onChange={(v) => setMeta({ author: v })} />
            </Field>
            <Field label={tr('목표 사이클 타임', 'Target cycle time')} hint={tr('고객·공정이 요구하는 한 사이클 시간. 0 이면 검토하지 않습니다.', 'Required cycle (tact) time. 0 skips the check.')}>
              <SecInput value={spec.targetCycle} onChange={(ms) => set({ ...cur(), targetCycle: ms })} />
            </Field>
          </div>
        </Sec>

        <Sec
          id="seq-devices"
          n="②"
          title={tr('동작 기기', 'Moving devices')}
          why={tr(
            '설비에서 움직이는 것(실린더, 모터, 흡착)과 한쪽 끝에서 반대쪽 끝까지 가는 시간을 적습니다. 모르면 0.5초로 두고 나중에 실측값으로 고치세요. ④ 동작 순서에 새 이름을 적어도 여기에 자동으로 생깁니다.',
            'List what moves and its end-to-end travel time. Use 0.5 s if unsure and correct it later. Typing a new name in ④ also adds it here.',
          )}
          right={
            <button type="button" className="btn small" onClick={copyDevices} title={tr('엑셀에 붙여 넣을 수 있게 복사', 'Copy for Excel')}>
              <Icon name="copy" size={13} /> {tr('엑셀로 복사', 'Copy for Excel')}
            </button>
          }
        >
          <Grid
            label={tr('동작 기기', 'Devices')}
            cols={devCols}
            rows={spec.devices.length}
            text={(r, c) => (spec.devices[r] ? deviceText(spec.devices[r], c as DevCol) : '')}
            optionsFor={(r, c) => (c === 'sen' && spec.devices[r] ? sensorOptions(spec.devices[r]) : undefined)}
            view={(r, c) => {
              const d = spec.devices[r];
              if (!d) return '';
              if ((c === 'retT' || c === 'sen') && d.kind === 'motor') return <span className="muted">—</span>;
              if (c === 'name' && unused.includes(d)) return <span title={tr('동작 순서에 한 번도 나오지 않습니다', 'Not used in the sequence')}>{d.name} <span className="seq-unused">{tr('안 씀', 'unused')}</span></span>;
              return deviceText(d, c as DevCol);
            }}
            onEdit={(edits) => report(editDevices(cur(), edits))}
            onPasteTable={(m, row) => {
              const r = pasteDeviceTable(cur(), m, row);
              if (!r) return false;
              report(r);
              return true;
            }}
            onDelete={(rows) => {
              const r = removeDevices(cur(), rows);
              set(r.spec);
              if (r.removedActions) toast(tr(`기기와 함께 그 기기의 동작 ${r.removedActions}줄도 지웠습니다 (Ctrl+Z 로 되돌리기)`, `Also removed ${r.removedActions} motions of that device (Ctrl+Z to undo)`), 'info');
            }}
            onMove={(row, dir) => set({ ...cur(), devices: moveItem(cur().devices, row, dir) })}
            appendHint={tr('+ 이름을 적으면 기기가 늘어납니다 · 엑셀에서 복사한 표를 Ctrl+V', '+ Type a name to add a device · paste from Excel')}
          />
          <div className="seq-row-btns">
            {(Object.keys(KIND_LABEL) as DeviceKind[]).map((k) => (
              <button
                type="button"
                key={k}
                className="btn small"
                onClick={() => {
                  const s = cur();
                  const base = k === 'motor' ? tr('모터', 'Motor') : k === 'vacuum' ? tr('흡착', 'Vacuum') : tr('실린더', 'Cylinder');
                  let n = s.devices.length + 1;
                  while (s.devices.some((d) => d.name === `${base} ${n}`)) n++;
                  set({ ...s, devices: [...s.devices, newDevice(k, `${base} ${n}`)] });
                }}
              >
                <Icon name="plus" size={13} /> {KIND_LABEL[k]}
              </button>
            ))}
            {unused.length > 0 && (
              <button type="button" className="btn small" onClick={() => set(removeDevices(cur(), unused.map((d) => cur().devices.indexOf(d))).spec)}>
                <Icon name="trash" size={13} /> {tr(`안 쓰는 기기 ${unused.length}개 지우기`, `Remove ${unused.length} unused`)}
              </button>
            )}
          </div>
          <details className="seq-legend">
            <summary>{tr('기기 종류 설명', 'About device types')}</summary>
            <ul>
              <li>
                <b>{KIND_LABEL.cyl2}</b> {tr('전진 SOL, 후진 SOL 두 개. 신호를 끊어도 그 자리에 머뭅니다.', 'Two solenoids; stays in place when both are off.')}
              </li>
              <li>
                <b>{KIND_LABEL.cyl1}</b> {tr('SOL 하나. 켜면 전진하고, 끄면 스프링으로 돌아옵니다.', 'One solenoid; spring return when off.')}
              </li>
              <li>
                <b>{KIND_LABEL.motor}</b> {tr('운전 출력 하나. 기동부터 정지까지 켜져 있습니다.', 'One run output, on from start to stop.')}
              </li>
              <li>
                <b>{KIND_LABEL.vacuum}</b> {tr('SOL 하나와 흡착(잡힘) 확인 센서.', 'One solenoid and a grip-confirm sensor.')}
              </li>
            </ul>
          </details>
        </Sec>

        <Sec
          id="seq-io"
          n="③"
          title={tr('I/O 목록', 'I/O list')}
          why={tr(
            '기기에서 PLC 입력(버튼·센서)과 출력(SOL·모터)을 자동으로 뽑았습니다. 주소 방식을 고르고 실제 배선과 다른 주소·이름만 고치세요. 엑셀 I/O 리스트를 제목 줄(주소, 이름)과 함께 붙여 넣으면 이름이 같은 I/O 를 찾아 주소를 넣습니다.',
            'Inputs (buttons, sensors) and outputs (solenoids, motors) derived from the devices. Pick the address style and fix what differs from the wiring. Paste an Excel I/O list with a header row (address, name) to fill addresses by name.',
          )}
          right={
            <>
              <button type="button" className="btn small" onClick={sendToPlc} title={tr('PLC 탭의 디바이스 코멘트에 I/O 이름을 넣습니다', 'Put I/O names into the PLC tab device comments')}>
                <Icon name="cpu" size={13} /> {tr('PLC 탭 코멘트로 보내기', 'Send to PLC comments')}
              </button>
              <button type="button" className="btn small" onClick={copyIo}>
                <Icon name="copy" size={13} /> {tr('엑셀로 복사', 'Copy for Excel')}
              </button>
            </>
          }
        >
          <div className="seq-io-top">
            <Field label={tr('주소 방식', 'Address style')}>
              <Select value={spec.addrStyle} onChange={(v: AddrStyle) => set({ ...cur(), addrStyle: v })} options={(['mitsubishi', 'ls', 'siemens', 'none'] as AddrStyle[]).map((s) => ({ value: s, label: tr(addrStyleName(s), addrStyleName(s)) }))} />
            </Field>
            <Check checked={spec.startButton} onChange={(v) => set({ ...cur(), startButton: v })} label={tr('시작 버튼 넣기', 'Include a start button')} />
            {Object.keys(spec.ioEdits).length > 0 && (
              <button type="button" className="btn small" onClick={() => set({ ...cur(), ioEdits: {} })} title={tr('직접 고친 주소와 이름을 지우고 자동 번호로', 'Discard edits and renumber')}>
                {tr('자동 번호로 되돌리기', 'Renumber')}
              </button>
            )}
          </div>
          <div className="seq-io-cols">
            <div>
              <h4>
                {tr('입력 (버튼 · 센서)', 'Inputs (buttons, sensors)')} · {inputs.length}
              </h4>
              {ioGrid(inputs, tr('입력', 'Inputs'))}
            </div>
            <div>
              <h4>
                {tr('출력 (SOL · 모터)', 'Outputs (SOL, motors)')} · {outputs.length}
              </h4>
              {ioGrid(outputs, tr('출력', 'Outputs'))}
            </div>
          </div>
        </Sec>

        <Sec
          id="seq-actions"
          n="④"
          title={tr('동작 순서', 'Sequence')}
          why={tr(
            '한 사이클 동안 움직이는 순서입니다. 한 줄에 기기와 동작을 적습니다 (예: 클램프 · 전진). 보통 앞 동작이 끝난 것을 센서로 확인하고 다음 동작을 시작합니다. 서로 부딪히지 않는 동작은 "앞 동작과 동시에"로 바꾸면 사이클 타임이 줄어듭니다. 마지막에는 모든 기기가 처음 위치로 돌아와야 다음 사이클을 시작할 수 있습니다.',
            'The motions in one cycle, one per row (device · motion). Normally the next motion starts after a sensor confirms the previous one. Motions that cannot collide can run "together" to shorten the cycle. Every device must be home at the end.',
          )}
          right={
            <>
              <button
                type="button"
                className="btn small"
                data-tour="seq-paste"
                onClick={async () => {
                  const t = await askText(
                    tr('엑셀 표 붙여넣기', 'Paste an Excel table'),
                    tr('엑셀에서 동작 순서표를 복사해 여기에 붙여 넣으세요. 첫 줄이 제목(기기, 동작, 시간, 시작)이면 제목으로 칸을 맞추고, 없으면 기기 · 동작 · 시간 · 시작 순서로 읽습니다. "클램프 전진"처럼 한 칸에 적어도 됩니다. 지금 동작 순서는 붙여 넣은 표로 바뀝니다.', 'Paste a sequence table copied from Excel. A header row (device, motion, time, start) maps columns; otherwise columns are read as device · motion · time · start. The current sequence is replaced.'),
                    '',
                    true,
                  );
                  if (!t?.trim()) return;
                  pasteWholeSequence(parseTable(t), true);
                }}
              >
                <Icon name="table" size={13} /> {tr('엑셀 표 붙여넣기…', 'Paste Excel table…')}
              </button>
              <button type="button" className="btn small" onClick={copySequence}>
                <Icon name="copy" size={13} /> {tr('엑셀로 복사', 'Copy for Excel')}
              </button>
            </>
          }
        >
          <Grid
            label={tr('동작 순서', 'Sequence')}
            cols={actCols}
            rows={spec.actions.length}
            text={actText}
            view={actView}
            optionsFor={(r, col) => {
              if (col !== 'mot') return undefined;
              const a = spec.actions[r];
              const d = a && spec.devices.find((x) => x.id === a.device);
              if (d) return [d.fwdLabel, d.retLabel];
              return ['가공', '가압', '검사', '냉각', '건조', '안정화'];
            }}
            rowClass={(r) => (spec.actions[r]?.withPrev ? 'par' : undefined)}
            onEdit={(edits) => report(editActions(cur(), edits))}
            onPasteTable={(m, row) => {
              const r = pasteActionTable(cur(), m, row);
              if (!r) return false;
              report(r);
              return true;
            }}
            onDelete={(rows) => set(removeActions(cur(), rows))}
            onMove={(row, dir) => set(moveAction(cur(), row, dir))}
            onDuplicate={(row) => set(duplicateAction(cur(), row))}
            appendHint={tr('+ 기기와 동작을 적으면 줄이 늘어납니다 (예: 클램프 · 전진, 대기 · 가공) · 엑셀 표를 Ctrl+V', '+ Type a device and motion to add a row · paste from Excel')}
            extra={{
              title: tr('시간 흐름', 'Timeline'),
              render: (r) => {
                const it = timeOf.get(spec.actions[r]?.id ?? '');
                if (!it) return null;
                const left = (it.start / maxEnd) * 100;
                const width = Math.max(0.8, ((it.end - it.start) / maxEnd) * 100);
                return (
                  <span className="seq-track">
                    <span className={`seq-bar-fill ${spec.actions[r].device ? '' : 'wait'}`} style={{ left: `${left}%`, width: `${width}%` }} />
                  </span>
                );
              },
            }}
          />
          <div className="seq-row-btns">
            <button
              type="button"
              className="btn small"
              disabled={!spec.devices.length}
              title={tr('기기 순서대로 가고 → 작업 대기 → 거꾸로 돌아오는 순서', 'Go out in order, wait, come back in reverse')}
              onClick={async () => {
                const s = cur();
                if (s.actions.length && !(await askConfirm(tr('기본 순서 넣기', 'Default sequence'), tr('지금 동작 순서를 지우고 기본 순서(기기 순서대로 가기 → 작업 대기 → 거꾸로 돌아오기)로 바꿀까요?', 'Replace the sequence with a default one?'), tr('바꾸기', 'Replace')))) return;
                set({ ...s, actions: suggestActions(s.devices) });
              }}
            >
              <Icon name="wand" size={13} /> {tr('기본 순서 넣기', 'Default sequence')}
            </button>
            {spec.actions.length > 0 && (
              <button
                type="button"
                className="btn small"
                onClick={async () => {
                  if (await askConfirm(tr('동작 순서 비우기', 'Clear sequence'), tr('동작 순서를 모두 지울까요? (Ctrl+Z 로 되돌릴 수 있습니다)', 'Clear all motions? (Ctrl+Z to undo)'), tr('비우기', 'Clear'))) set({ ...cur(), actions: [] });
                }}
              >
                <Icon name="trash" size={13} /> {tr('비우기', 'Clear')}
              </button>
            )}
          </div>
          <Notes notes={tl.notes} />
        </Sec>

        <Sec
          id="seq-review"
          n="⑤"
          title={tr('확인', 'Review')}
          why={tr(
            '위를 고치면 여기가 바로 바뀝니다. 괜찮으면 [차트에 적용]을 누르세요. 적용한 뒤 타임차트 탭에서 파형을 다듬고, 보고서 탭에서 인쇄합니다.',
            'This updates as you edit. When it looks right, apply it to the chart, then polish it in the Chart tab and print from the Report tab.',
          )}
        >
          <div className="seq-kpis">
            <div className="seq-kpi">
              <span>{tr('예상 사이클 타임', 'Estimated cycle time')}</span>
              <b>{formatTime(cycle, 's')}</b>
            </div>
            {spec.targetCycle > 0 && (
              <div className={`seq-kpi ${targetOk ? 'ok' : 'ng'}`}>
                <span>
                  {tr('목표', 'Target')} {formatTime(spec.targetCycle, 's')}
                </span>
                <b>{targetOk ? `OK (${tr('여유', 'margin')} ${formatTime(spec.targetCycle - cycle, 's')})` : `NG (+${formatTime(cycle - spec.targetCycle, 's')})`}</b>
              </div>
            )}
            <div className="seq-kpi">
              <span>{tr('구성', 'Contents')}</span>
              <b>
                {tr(`${tl.groups.length}단계 · 기기 ${spec.devices.length} · 입력 ${inputs.length} · 출력 ${outputs.length}`, `${tl.groups.length} steps · ${spec.devices.length} devices · ${inputs.length} in · ${outputs.length} out`)}
              </b>
            </div>
            {tl.groups.length > 0 && (
              <div className="seq-kpi">
                <span>{tr('가장 긴 스텝', 'Longest step')}</span>
                <b>
                  {(() => {
                    const g = tl.groups.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
                    const i = tl.groups.indexOf(g);
                    return `S${(i + 1) * 10} ${g.items.map((it) => actionText(it.action, spec.devices)).join(' + ')} · ${formatTime(g.end - g.start, 's')}`;
                  })()}
                </b>
              </div>
            )}
            {tl.notes.length > 0 && (
              <button type="button" className="seq-kpi warn" onClick={() => jump('seq-actions')} title={tr('④ 동작 순서 아래에 자세히 있습니다', 'Details under ④')}>
                <span>{tr('검토할 점', 'To check')}</span>
                <b>
                  {tl.notes.length}
                  {tr('개 → ④', ' → ④')}
                </b>
              </button>
            )}
          </div>
          <div className="seq-preview" ref={previewRef}>
            {tl.groups.length ? <ChartSvg project={preview} width={previewW} colors={SCREEN_COLORS} idp="seqp" /> : <p className="muted">{tr('동작 순서가 비어 있습니다. ④ 에 동작을 적으면 미리보기가 나옵니다.', 'The sequence is empty. Add motions in ④ to see a preview.')}</p>}
          </div>
          <div className="seq-apply">
            {status === 'changed' ? (
              <button type="button" className="btn primary" onClick={apply} disabled={!tl.groups.length}>
                <Icon name="chart" size={15} /> {tr('차트에 적용', 'Apply to chart')}
              </button>
            ) : (
              <button type="button" className="btn" onClick={apply} disabled={!tl.groups.length} title={tr('동작 순서표로 차트를 새로 만듭니다', 'Rebuild the chart from the sequence')}>
                <Icon name="undo" size={15} /> {tr('차트 다시 만들기', 'Rebuild chart')}
              </button>
            )}
            <span className="muted small">{tr('다음 단계:', 'Next:')}</span>
            <button type="button" className="btn small" onClick={view}>
              <Icon name="chart" size={13} /> {tr('타임차트에서 다듬기', 'Polish in the chart')}
            </button>
            <button type="button" className="btn small" onClick={() => setTab('report')}>
              <Icon name="print" size={13} /> {tr('보고서 · 인쇄', 'Report & print')}
            </button>
            <button type="button" className="btn small" onClick={() => setTab('plc')} title={tr('PLC 프로그램을 시뮬레이션해 이 차트와 비교', 'Simulate the PLC program and compare')}>
              <Icon name="cpu" size={13} /> {tr('PLC 프로그램과 비교', 'Compare with PLC')}
            </button>
          </div>
        </Sec>
      </div>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="seq-notes">
      <b>
        <Icon name="warn" size={14} /> {tr('검토할 점', 'To check')}
      </b>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
