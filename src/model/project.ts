import type {
  Annotation,
  Project,
  ProjectMeta,
  ProjectSettings,
  Signal,
  SignalKind,
  SignalRole,
  Step,
  TimingRule,
  WavePoint,
} from './types';
import { normalize, pulsesToPoints, uid } from './wave';
import { todayString } from './format';

export const ROLE_COLORS: Record<SignalRole, string> = {
  input: '#2563eb',
  output: '#dc2626',
  internal: '#7c3aed',
  actuator: '#ea580c',
  sensor: '#059669',
  timer: '#0891b2',
  counter: '#0d9488',
  data: '#475569',
  other: '#334155',
};

export const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#475569',
  '#65a30d',
];

export const STEP_COLORS = ['#dbeafe', '#fef3c7', '#dcfce7', '#fce7f3', '#e0e7ff', '#ffedd5', '#ccfbf1', '#f3e8ff'];

export function defaultSettings(): ProjectSettings {
  return {
    duration: 3000,
    grid: 50,
    timeUnit: 'ms',
    rowHeight: 36,
    fillHigh: true,
    showAddress: true,
    showLevelLabels: true,
    showEdgeTimes: false,
  };
}

export function defaultMeta(): ProjectMeta {
  return {
    title: '새 타임차트',
    machine: '',
    drawingNo: '',
    company: '',
    author: '',
    checker: '',
    approver: '',
    revision: 'A',
    date: todayString(),
    description: '',
  };
}

export function createProject(partial: Partial<Project> = {}): Project {
  return {
    format: 'timechart-studio',
    version: 1,
    id: uid('prj'),
    meta: defaultMeta(),
    revisions: [],
    settings: defaultSettings(),
    signals: [],
    steps: [],
    annotations: [],
    rules: [],
    ...partial,
  };
}

export function createSignal(partial: Partial<Signal> = {}): Signal {
  const role = partial.role ?? 'other';
  const kind: SignalKind = partial.kind ?? 'bit';
  const initial = kind === 'bus' ? '0' : 0;
  return {
    id: uid('sig'),
    name: '새 신호',
    address: '',
    comment: '',
    kind,
    role,
    color: ROLE_COLORS[role],
    points: [{ t: 0, v: initial }],
    ...partial,
  };
}

export function createStep(partial: Partial<Step> = {}): Step {
  return { id: uid('stp'), label: 'STEP', start: 0, end: 500, description: '', ...partial };
}

/** 주소로 역할 추정 (X/I/P입력, Y/Q출력, M/L 내부, T 타이머, C 카운터, D 데이터) */
export function guessRole(address: string): SignalRole {
  const a = address.trim().toUpperCase();
  if (/^%?I[XBWD]?\d|^X[0-9A-F]|^E\s?\d/.test(a)) return 'input';
  if (/^%?Q[XBWD]?\d|^Y[0-9A-F]|^A\s?\d/.test(a)) return 'output';
  if (/^P\d/.test(a)) return 'input';
  if (/^T\s?\d|^TC\d|^TS\d/.test(a)) return 'timer';
  if (/^C\s?\d|^Z\s?\d|^CN\d/.test(a)) return 'counter';
  if (/^D\d|^%M[WD]|^MW|^DB|^W\d|^R\d|^ZR/.test(a)) return 'data';
  if (/^M\d|^L\d|^%MX|^K\d|^F\d|^S\d|^B\d|^SM\d/.test(a)) return 'internal';
  return 'other';
}

function sanitizePoints(raw: unknown, kind: SignalKind): WavePoint[] {
  if (!Array.isArray(raw)) return [{ t: 0, v: kind === 'bus' ? '0' : 0 }];
  const pts: WavePoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const t = Number(o.t);
    if (!Number.isFinite(t)) continue;
    let v = o.v as WavePoint['v'];
    if (kind === 'bit' || kind === 'clock') v = v === 'x' || v === 'z' ? v : Number(v) ? 1 : 0;
    else if (kind === 'analog') v = Number(v) || 0;
    else v = String(v ?? '');
    const q: WavePoint = { t, v };
    const ramp = Number(o.ramp);
    if (Number.isFinite(ramp) && ramp > 0) q.ramp = ramp;
    pts.push(q);
  }
  return normalize(pts, kind, kind === 'bus' ? '0' : 0);
}

/** 불러온 JSON 을 검증하고 누락된 필드를 채운다 */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('프로젝트 파일 형식이 아닙니다.');
  const o = raw as Record<string, unknown>;
  if (o.format !== 'timechart-studio') throw new Error('TimeChart Studio 프로젝트 파일이 아닙니다.');
  const base = createProject();
  const settings = { ...base.settings, ...((o.settings as object) ?? {}) } as ProjectSettings;
  const meta = { ...base.meta, ...((o.meta as object) ?? {}) } as ProjectMeta;
  const signals: Signal[] = Array.isArray(o.signals)
    ? (o.signals as Record<string, unknown>[]).map((s) => {
        const kind = (['bit', 'bus', 'analog', 'clock'].includes(s.kind as string) ? s.kind : 'bit') as SignalKind;
        const sig = createSignal({ ...(s as Partial<Signal>), kind });
        sig.id = typeof s.id === 'string' && s.id ? s.id : uid('sig');
        sig.points = sanitizePoints(s.points, kind);
        return sig;
      })
    : [];
  const steps: Step[] = Array.isArray(o.steps)
    ? (o.steps as Partial<Step>[]).map((s) => createStep({ ...s, id: s.id || uid('stp') }))
    : [];
  return {
    ...base,
    id: typeof o.id === 'string' ? o.id : base.id,
    meta,
    settings,
    revisions: Array.isArray(o.revisions) ? (o.revisions as Project['revisions']) : [],
    signals,
    steps,
    annotations: Array.isArray(o.annotations) ? (o.annotations as Annotation[]) : [],
    rules: Array.isArray(o.rules) ? (o.rules as TimingRule[]) : [],
    plc: o.plc as Project['plc'],
    sequence: o.sequence && typeof o.sequence === 'object' ? (o.sequence as Project['sequence']) : undefined,
    sheet: typeof o.sheet === 'string' && o.sheet ? o.sheet : undefined,
  };
}

/** 예제: 드릴 가공기 (클램프 → 드릴 하강 → 가공 → 상승 → 언클램프) */
export function sampleProject(): Project {
  const p = createProject();
  p.meta = {
    ...p.meta,
    title: '드릴 가공 유닛 사이클 타임차트',
    machine: 'DRL-01 드릴 가공 유닛',
    drawingNo: 'TC-DRL-001',
    company: '(주)오토메이션',
    author: '홍길동',
    checker: '',
    approver: '',
    revision: 'A',
    description: '클램프 → 드릴 모터 기동 → 하강 → 가공(드웰 700ms) → 상승 → 언클램프 1사이클',
  };
  p.revisions = [{ rev: 'A', date: p.meta.date, description: '최초 작성', author: '홍길동' }];
  p.settings = { ...p.settings, duration: 3200, grid: 50 };

  const mk = (partial: Partial<Signal>, pulses: [number, number][], base: 0 | 1 = 0, ramp?: number): Signal =>
    createSignal({
      ...partial,
      points: pulsesToPoints(
        pulses.map(([start, end]) => ({ start, end })),
        base,
        ramp,
      ),
    });

  const x0 = mk({ name: '자동 시작 PB', address: 'X0', role: 'input', group: '조작' }, [[250, 450]]);
  const y0 = mk({ name: '클램프 SOL', address: 'Y0', role: 'output', group: '클램프' }, [[300, 2400]]);
  const clamp = mk(
    { name: '클램프 실린더', address: 'CYL1', role: 'actuator', group: '클램프', onLabel: '전진', offLabel: '후진', defaultRamp: 300 },
    [[300, 2400]],
    0,
    300,
  );
  const x1 = mk({ name: '클램프 전진단', address: 'X1', role: 'sensor', group: '클램프' }, [[600, 2420]]);
  const x2 = mk({ name: '클램프 후진단', address: 'X2', role: 'sensor', group: '클램프' }, [[320, 2700]], 1);
  const y1 = mk({ name: '드릴 모터', address: 'Y1', role: 'output', group: '드릴' }, [[600, 2400]]);
  const y2 = mk({ name: '드릴 하강 SOL', address: 'Y2', role: 'output', group: '드릴' }, [[700, 1900]]);
  const drill = mk(
    { name: '드릴 실린더', address: 'CYL2', role: 'actuator', group: '드릴', onLabel: '하강', offLabel: '상승', defaultRamp: 500 },
    [[700, 1900]],
    0,
    500,
  );
  const x3 = mk({ name: '드릴 하강단', address: 'X3', role: 'sensor', group: '드릴' }, [[1200, 1920]]);
  const x4 = mk({ name: '드릴 상승단', address: 'X4', role: 'sensor', group: '드릴' }, [[720, 2400]], 1);
  const t0 = mk({ name: '가공 타이머 (0.7s)', address: 'T0', role: 'timer', group: '드릴' }, [[1900, 1920]]);
  const d0 = createSignal({
    name: '스텝 번호',
    address: 'D0',
    role: 'data',
    kind: 'bus',
    group: '시퀀스',
    points: normalize(
      [
        { t: 0, v: '0' },
        { t: 300, v: '10' },
        { t: 600, v: '20' },
        { t: 700, v: '30' },
        { t: 1200, v: '40' },
        { t: 1900, v: '50' },
        { t: 2400, v: '60' },
        { t: 2700, v: '70' },
        { t: 2800, v: '0' },
      ],
      'bus',
    ),
  });
  const m10 = mk({ name: '사이클 완료', address: 'M10', role: 'internal', group: '시퀀스' }, [[2700, 2800]]);
  p.signals = [x0, y0, clamp, x1, x2, y1, y2, drill, x3, x4, t0, d0, m10];

  const stepDefs: [string, number, number, string][] = [
    ['S10 클램프', 300, 600, '클램프 SOL ON → 전진단 확인'],
    ['S20 모터', 600, 700, '드릴 모터 기동 (안정화 100ms)'],
    ['S30 하강', 700, 1200, '드릴 하강 SOL ON → 하강단 확인'],
    ['S40 가공', 1200, 1900, '드웰 타이머 T0 0.7s'],
    ['S50 상승', 1900, 2400, '하강 SOL OFF → 상승단 확인'],
    ['S60 언클램프', 2400, 2700, '모터 정지, 클램프 후진'],
    ['S70 완료', 2700, 2800, '사이클 완료 신호'],
  ];
  p.steps = stepDefs.map(([label, start, end, description], i) =>
    createStep({ label, start, end, description, color: STEP_COLORS[i % STEP_COLORS.length] }),
  );

  p.annotations = [
    { id: uid('ann'), type: 'arrow', from: { signalId: x0.id, t: 250 }, to: { signalId: y0.id, t: 300 }, label: '시작' },
    { id: uid('ann'), type: 'arrow', from: { signalId: x1.id, t: 600 }, to: { signalId: y1.id, t: 600 }, label: '' },
    { id: uid('ann'), type: 'arrow', from: { signalId: x3.id, t: 1200 }, to: { signalId: t0.id, t: 1200 }, label: '', dashed: true },
    { id: uid('ann'), type: 'arrow', from: { signalId: x4.id, t: 2400 }, to: { signalId: y0.id, t: 2400 }, label: '상승 확인' },
    { id: uid('ann'), type: 'dimension', signalId: drill.id, t1: 700, t2: 1200, label: '' },
    { id: uid('ann'), type: 'dimension', signalId: t0.id, t1: 1200, t2: 1900, label: '드웰 0.7s' },
    { id: uid('ann'), type: 'marker', t: 2800, label: '사이클 완료', color: '#16a34a' },
  ];

  p.rules = [
    { id: uid('rul'), type: 'delay', name: '클램프 전진 응답', fromSignal: y0.id, fromEdge: 'rise', toSignal: x1.id, toEdge: 'rise', max: 400 },
    { id: uid('rul'), type: 'delay', name: '드릴 하강 응답', fromSignal: y2.id, fromEdge: 'rise', toSignal: x3.id, toEdge: 'rise', max: 600 },
    { id: uid('rul'), type: 'exclusive', name: '클램프 센서 동시 ON 금지', a: x1.id, b: x2.id },
    { id: uid('rul'), type: 'cycle', name: '목표 사이클 타임', max: 3000 },
  ];
  return p;
}
