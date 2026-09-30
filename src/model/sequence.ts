/**
 * 실무 작성 순서대로 타임차트 만들기:
 *   ① 설비 사양(목표 사이클 타임) → ② 동작 기기(실린더·모터·흡착)와 동작 시간
 *   → ③ I/O 목록(출력 솔레노이드, 끝 위치 센서, PLC 주소) → ④ 동작 순서 → ⑤ 타임차트 + 검토
 * 이 파일은 입력(SeqSpec)으로 시간표를 계산하고 차트(Project)를 만든다.
 */
import type { Annotation, Project, Signal, Step, TimingRule, WavePoint } from './types';
import { createProject, createSignal, createStep, ROLE_COLORS, STEP_COLORS } from './project';
import { formatTime } from './format';
import { uid } from './wave';

/** cyl2 = 실린더 + 더블 솔레노이드, cyl1 = 실린더 + 싱글 솔레노이드(스프링 복귀), motor = 모터 운전, vacuum = 흡착·척 */
export type DeviceKind = 'cyl2' | 'cyl1' | 'motor' | 'vacuum';

export interface SeqDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  /** 가는 동작 이름 (전진, 하강, 흡착, 기동) */
  fwdLabel: string;
  /** 돌아오는 동작 이름 (후진, 상승, 해제, 정지) */
  retLabel: string;
  /** 가는 데 걸리는 시간 (ms) */
  fwdTime: number;
  /** 돌아오는 데 걸리는 시간 (ms) */
  retTime: number;
  /** 끝 위치 센서 (실린더: 양쪽 끝, 흡착: 흡착 확인) */
  sensors: boolean;
}

export interface SeqAction {
  id: string;
  /** 기기 id. '' 이면 대기(타이머) */
  device: string;
  dir: 'fwd' | 'ret';
  /** 대기 시간 (ms) - 대기 동작만 */
  wait: number;
  /** 대기 이름 (가공, 건조 …) */
  label: string;
  /** 앞 동작과 동시에 시작 (아니면 앞 동작이 끝난 뒤) */
  withPrev: boolean;
}

export type AddrStyle = 'mitsubishi' | 'ls' | 'siemens' | 'none';

export interface SeqSpec {
  title: string;
  machine: string;
  drawingNo: string;
  author: string;
  /** 목표 사이클 타임 (ms, 0 = 정하지 않음) */
  targetCycle: number;
  startButton: boolean;
  devices: SeqDevice[];
  addrStyle: AddrStyle;
  /** I/O 목록에서 고친 주소·이름 */
  ioEdits: Record<string, { address?: string; name?: string }>;
  actions: SeqAction[];
}

export type IoKind = 'start' | 'fwdOut' | 'retOut' | 'fwdSen' | 'retSen';

export interface IoPoint {
  key: string;
  dir: 'in' | 'out';
  kind: IoKind;
  device: string;
  name: string;
  address: string;
}

/** 기기 종류별 기본값 */
export function kindDefaults(kind: DeviceKind): Pick<SeqDevice, 'fwdLabel' | 'retLabel' | 'fwdTime' | 'retTime' | 'sensors'> {
  switch (kind) {
    case 'cyl2':
      return { fwdLabel: '전진', retLabel: '후진', fwdTime: 500, retTime: 500, sensors: true };
    case 'cyl1':
      return { fwdLabel: '전진', retLabel: '후진', fwdTime: 500, retTime: 400, sensors: true };
    case 'motor':
      return { fwdLabel: '기동', retLabel: '정지', fwdTime: 0, retTime: 0, sensors: false };
    case 'vacuum':
      return { fwdLabel: '흡착', retLabel: '해제', fwdTime: 300, retTime: 200, sensors: true };
  }
}

/** 자주 쓰는 동작 이름 쌍 */
export const LABEL_PAIRS: [string, string][] = [
  ['전진', '후진'],
  ['하강', '상승'],
  ['상승', '하강'],
  ['클램프', '언클램프'],
  ['잡기', '놓기'],
  ['흡착', '해제'],
  ['좌', '우'],
  ['기동', '정지'],
];

export function newDevice(kind: DeviceKind, name: string, partial: Partial<SeqDevice> = {}): SeqDevice {
  return { id: uid('dev'), name, kind, ...kindDefaults(kind), ...partial };
}

export function newAction(partial: Partial<SeqAction> = {}): SeqAction {
  return { id: uid('act'), device: '', dir: 'fwd', wait: 1000, label: '', withPrev: false, ...partial };
}

/** 처음 열었을 때 보여 줄 예시 (고쳐서 쓰도록) */
export function defaultSpec(): SeqSpec {
  const clamp = newDevice('cyl2', '클램프');
  const press = newDevice('cyl2', '프레스', { fwdLabel: '하강', retLabel: '상승', fwdTime: 800, retTime: 800 });
  const spec: SeqSpec = {
    title: '',
    machine: '',
    drawingNo: '',
    author: '',
    targetCycle: 0,
    startButton: true,
    devices: [clamp, press],
    addrStyle: 'mitsubishi',
    ioEdits: {},
    actions: [],
  };
  spec.actions = suggestActions(spec.devices);
  return spec;
}

/** 동작 이름: "클램프 전진", "대기: 가공 1s" */
export function actionText(a: SeqAction, devices: SeqDevice[]): string {
  if (!a.device) return `대기${a.label ? ': ' + a.label : ''} ${formatTime(a.wait, 'auto')}`;
  const d = devices.find((x) => x.id === a.device);
  if (!d) return '(지워진 기기)';
  return `${d.name} ${a.dir === 'fwd' ? d.fwdLabel : d.retLabel}`;
}

/** 기본 순서 제안: 기기 순서대로 가는 동작 → 작업 대기 → 거꾸로 돌아오기 */
export function suggestActions(devices: SeqDevice[]): SeqAction[] {
  if (!devices.length) return [];
  return [
    ...devices.map((d) => newAction({ device: d.id, dir: 'fwd' })),
    newAction({ device: '', wait: 1000, label: '작업' }),
    ...[...devices].reverse().map((d) => newAction({ device: d.id, dir: 'ret' })),
  ];
}

// ───────────────────────── I/O 목록 ─────────────────────────

function addr(style: AddrStyle, dir: 'in' | 'out', n: number): string {
  switch (style) {
    case 'mitsubishi':
      return `${dir === 'in' ? 'X' : 'Y'}${n.toString(8)}`;
    case 'ls':
      return `P${((dir === 'in' ? 0 : 0x40) + n).toString(16).toUpperCase().padStart(5, '0')}`;
    case 'siemens':
      return `${dir === 'in' ? 'I' : 'Q'}${Math.floor(n / 8)}.${n % 8}`;
    case 'none':
      return '';
  }
}

export function addrStyleName(s: AddrStyle): string {
  return { mitsubishi: '미쓰비시 (X0 / Y0, 8진수)', ls: 'LS XGK (P00000 / P00040)', siemens: '지멘스 (I0.0 / Q0.0)', none: '주소 없이' }[s];
}

/** 기기 → I/O 점 (입력은 입력끼리, 출력은 출력끼리 차례로 주소) */
export function ioPoints(spec: SeqSpec): IoPoint[] {
  const raw: Omit<IoPoint, 'address'>[] = [];
  if (spec.startButton) raw.push({ key: 'start', dir: 'in', kind: 'start', device: '', name: '시작 버튼' });
  for (const d of spec.devices) {
    const n = d.name || '기기';
    if (d.kind === 'cyl2') {
      raw.push({ key: `${d.id}:fwdOut`, dir: 'out', kind: 'fwdOut', device: d.id, name: `${n} ${d.fwdLabel} SOL` });
      raw.push({ key: `${d.id}:retOut`, dir: 'out', kind: 'retOut', device: d.id, name: `${n} ${d.retLabel} SOL` });
    } else if (d.kind === 'cyl1' || d.kind === 'vacuum') {
      raw.push({ key: `${d.id}:fwdOut`, dir: 'out', kind: 'fwdOut', device: d.id, name: `${n} ${d.fwdLabel} SOL` });
    } else {
      raw.push({ key: `${d.id}:fwdOut`, dir: 'out', kind: 'fwdOut', device: d.id, name: `${n} 운전` });
    }
    if (d.sensors && d.kind !== 'motor') {
      if (d.kind === 'vacuum') raw.push({ key: `${d.id}:fwdSen`, dir: 'in', kind: 'fwdSen', device: d.id, name: `${n} ${d.fwdLabel} 확인` });
      else {
        raw.push({ key: `${d.id}:fwdSen`, dir: 'in', kind: 'fwdSen', device: d.id, name: `${n} ${d.fwdLabel}단` });
        raw.push({ key: `${d.id}:retSen`, dir: 'in', kind: 'retSen', device: d.id, name: `${n} ${d.retLabel}단` });
      }
    }
  }
  let ni = 0;
  let no = 0;
  return raw.map((p) => {
    const auto = addr(spec.addrStyle, p.dir, p.dir === 'in' ? ni++ : no++);
    const e = spec.ioEdits[p.key];
    return { ...p, address: e?.address ?? auto, name: e?.name || p.name };
  });
}

// ───────────────────────── 시간표 ─────────────────────────

export interface TimedAction {
  action: SeqAction;
  start: number;
  end: number;
  group: number;
}

export interface Timeline {
  items: TimedAction[];
  /** 동시에 움직이는 동작 묶음 */
  groups: { start: number; end: number; items: TimedAction[] }[];
  cycleStart: number;
  cycleEnd: number;
  /** 검토할 점 (이미 그 위치인 동작, 원위치로 안 돌아온 기기 …) */
  notes: string[];
}

/** 시작 버튼이 눌리는 시각 */
export const START_AT = 100;

/** 도착 즉시 되돌아갈 때 끝 위치 센서가 켜져 있는 최소 시간 (ms) */
const MIN_SENSOR_ON = 20;

export function actionDuration(a: SeqAction, devices: SeqDevice[]): number {
  if (!a.device) return Math.max(0, a.wait);
  const d = devices.find((x) => x.id === a.device);
  if (!d) return 0;
  return Math.max(0, a.dir === 'fwd' ? d.fwdTime : d.retTime);
}

export function computeTimeline(spec: SeqSpec): Timeline {
  const devices = spec.devices;
  const t0 = spec.startButton ? START_AT : 0;
  const items: TimedAction[] = [];
  const groups: Timeline['groups'] = [];
  const notes: string[] = [];
  const at = new Map<string, 'fwd' | 'ret'>(devices.map((d) => [d.id, 'ret']));
  let prevEnd = t0;
  spec.actions.forEach((a, i) => {
    const d = devices.find((x) => x.id === a.device);
    if (a.device && !d) return;
    const cur = groups[groups.length - 1];
    const joins = a.withPrev && cur;
    const start = joins ? cur.start : prevEnd;
    const end = start + actionDuration(a, devices);
    if (!joins) groups.push({ start, end, items: [] });
    const g = groups[groups.length - 1];
    const item = { action: a, start, end, group: groups.length - 1 };
    g.items.push(item);
    g.end = Math.max(g.end, end);
    items.push(item);
    prevEnd = g.end;
    if (d) {
      if (at.get(d.id) === a.dir) notes.push(`${i + 1}번 동작: ${d.name}은(는) 이미 ${a.dir === 'fwd' ? d.fwdLabel : d.retLabel} 상태입니다.`);
      at.set(d.id, a.dir);
    }
  });
  for (const d of devices) {
    if (!spec.actions.some((a) => a.device === d.id)) notes.push(`${d.name}: 동작 순서에 한 번도 나오지 않습니다.`);
    else if (at.get(d.id) === 'fwd') notes.push(`사이클이 끝날 때 ${d.name}이(가) ${d.retLabel} 위치로 돌아오지 않습니다. 다음 사이클을 시작할 수 없습니다.`);
  }
  const cycleEnd = groups.length ? groups[groups.length - 1].end : t0;
  return { items, groups, cycleStart: t0, cycleEnd, notes };
}

// ───────────────────────── 차트 만들기 ─────────────────────────

function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function niceGrid(duration: number): number {
  const raw = duration / 60;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.001))));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** ON 구간 목록 → 파형 점 */
function pulses(ivs: [number, number][], initial: 0 | 1 = 0): WavePoint[] {
  const pts: WavePoint[] = [{ t: 0, v: initial }];
  for (const [a, b] of [...ivs].sort((x, y) => x[0] - y[0])) {
    if (b <= a) continue;
    pts.push({ t: a, v: 1 }, { t: b, v: 0 });
  }
  // 겹치거나 맞닿은 구간 정리
  const out: WavePoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.t === p.t) last.v = p.v;
    else if (!last || last.v !== p.v) out.push({ ...p });
  }
  return out;
}

export function buildProject(spec: SeqSpec): Project {
  const tl = computeTimeline(spec);
  const io = ioPoints(spec);
  const ioOf = (dev: string, kind: IoKind) => io.find((p) => p.device === dev && p.kind === kind);
  const signals: Signal[] = [];
  const sigByKey = new Map<string, Signal>();
  const add = (key: string, s: Signal) => {
    signals.push(s);
    sigByKey.set(key, s);
    return s;
  };
  const ioSignal = (p: IoPoint, points: WavePoint[], group: string, role: Signal['role']) =>
    add(p.key, createSignal({ name: p.name, address: p.address, role, color: ROLE_COLORS[role], group, points }));

  const startP = io.find((p) => p.kind === 'start');
  if (startP) ioSignal(startP, pulses([[START_AT, START_AT + 200]]), '조작', 'input');

  for (const d of spec.devices) {
    const moves = tl.items.filter((it) => it.action.device === d.id);
    const fwd = moves.filter((m) => m.action.dir === 'fwd');
    const ret = moves.filter((m) => m.action.dir === 'ret');
    // 위치(0 = 원위치, 1 = 간 위치)가 바뀌는 구간: [가기 시작, 다음 돌아오기 시작)
    const held: [number, number][] = [];
    let since: number | null = null;
    for (const m of moves) {
      if (m.action.dir === 'fwd' && since === null) since = m.start;
      if (m.action.dir === 'ret' && since !== null) {
        held.push([since, m.start]);
        since = null;
      }
    }
    const endOfChart = Math.max(tl.cycleEnd * 2, tl.cycleEnd + 1000);
    if (since !== null) held.push([since, endOfChart]);
    // 도착 구간: [가기 끝, 돌아오기 시작)
    const arrived: [number, number][] = [];
    let arr: number | null = null;
    for (const m of moves) {
      if (m.action.dir === 'fwd' && arr === null) arr = m.end;
      if (m.action.dir === 'ret' && arr !== null) {
        arrived.push([arr, m.start]);
        arr = null;
      }
    }
    if (arr !== null) arrived.push([arr, endOfChart]);
    // 도착하자마자 되돌아가도 센서는 잠깐 켜진다 (출력이 바뀌고 실린더가 떠나기까지 걸리는 시간)
    for (const iv of arrived) if (iv[1] - iv[0] < MIN_SENSOR_ON) iv[1] = iv[0] + MIN_SENSOR_ON;
    const g = d.name || '기기';
    const fo = ioOf(d.id, 'fwdOut');
    const ro = ioOf(d.id, 'retOut');
    if (d.kind === 'cyl2') {
      // 더블 솔레노이드: 움직이는 동안만 ON (도착 센서 확인 후 OFF, 위치는 유지)
      if (fo) ioSignal(fo, pulses(fwd.map((m) => [m.start, Math.max(m.end, m.start + 1)])), g, 'output');
      if (ro) ioSignal(ro, pulses(ret.map((m) => [m.start, Math.max(m.end, m.start + 1)])), g, 'output');
    } else if (fo) {
      // 싱글 솔레노이드·모터·흡착: 켜 두는 동안 그 위치
      ioSignal(fo, pulses(held), g, 'output');
    }
    if (d.kind === 'cyl1' || d.kind === 'cyl2') {
      // 실린더 동작선: 경사 = 움직이는 시간
      const pts: WavePoint[] = [{ t: 0, v: 0 }];
      for (const m of moves) {
        const v = m.action.dir === 'fwd' ? 1 : 0;
        if (pts[pts.length - 1].v === v) continue;
        const p: WavePoint = { t: m.start, v };
        const dur = m.end - m.start;
        if (dur > 0) p.ramp = dur;
        pts.push(p);
      }
      add(`${d.id}:motion`, createSignal({ name: `${g} 실린더`, address: '', role: 'actuator', color: ROLE_COLORS.actuator, group: g, onLabel: d.fwdLabel, offLabel: d.retLabel, defaultRamp: d.fwdTime, points: pts }));
    }
    const fs = ioOf(d.id, 'fwdSen');
    const rs = ioOf(d.id, 'retSen');
    if (fs) ioSignal(fs, pulses(arrived), g, 'sensor');
    if (rs) {
      // 원위치 센서: 처음엔 ON, 떠나는 순간 OFF, 돌아와 도착하면 ON
      const offs: [number, number][] = [];
      let leave: number | null = null;
      for (const m of moves) {
        if (m.action.dir === 'fwd' && leave === null) leave = m.start;
        if (m.action.dir === 'ret' && leave !== null) {
          offs.push([leave, m.end]);
          leave = null;
        }
      }
      if (leave !== null) offs.push([leave, endOfChart]);
      const pts: WavePoint[] = [{ t: 0, v: 1 }];
      for (const [a, b] of offs) pts.push({ t: a, v: 0 }, { t: b, v: 1 });
      ioSignal(rs, pts.filter((p, i) => i === 0 || p.t !== pts[i - 1].t || p.v !== pts[i - 1].v), g, 'sensor');
    }
  }

  // 대기(타이머): 기다리는 동안 ON
  tl.items
    .filter((it) => !it.action.device)
    .forEach((it, k) => {
      const a = it.action;
      add(
        `wait:${a.id}`,
        createSignal({
          name: `${a.label || '대기'} 타이머 (${formatTime(a.wait, 'auto').replace(' ', '')})`,
          address: spec.addrStyle === 'none' ? '' : spec.addrStyle === 'siemens' ? `T${k + 1}` : spec.addrStyle === 'ls' ? `T${String(k).padStart(4, '0')}` : `T${k}`,
          role: 'timer',
          color: ROLE_COLORS.timer,
          group: '타이머',
          points: pulses([[it.start, it.end]]),
        }),
      );
    });

  // 파형이 시작하는 신호 (다음 동작을 일으키는 출력)
  const outOf = (it: TimedAction): Signal | undefined => {
    const a = it.action;
    if (!a.device) return sigByKey.get(`wait:${a.id}`);
    const d = spec.devices.find((x) => x.id === a.device);
    if (d?.kind === 'cyl2') return sigByKey.get(`${a.device}:${a.dir === 'fwd' ? 'fwdOut' : 'retOut'}`);
    return sigByKey.get(`${a.device}:fwdOut`);
  };
  // 동작이 끝났음을 알려 주는 신호 (센서, 타이머)
  const doneOf = (it: TimedAction): Signal | undefined => {
    const a = it.action;
    if (!a.device) return sigByKey.get(`wait:${a.id}`);
    return sigByKey.get(`${a.device}:${a.dir === 'fwd' ? 'fwdSen' : 'retSen'}`);
  };

  // 공정 스텝: 동시에 움직이는 묶음 하나가 스텝 하나
  const steps: Step[] = tl.groups.map((g, i) =>
    createStep({
      label: `S${(i + 1) * 10} ${g.items.map((it) => actionText(it.action, spec.devices)).join(' + ')}`,
      start: g.start,
      end: g.end > g.start ? g.end : g.start + 1,
      description: g.items.map((it) => `${actionText(it.action, spec.devices)} ${formatTime(it.end - it.start, 'auto')}`).join(', '),
      color: STEP_COLORS[i % STEP_COLORS.length],
    }),
  );

  // 인과 화살표: 시작 버튼 → 첫 동작, 앞 묶음의 완료 신호 → 다음 동작
  const annotations: Annotation[] = [];
  const first = tl.groups[0];
  const startSig = sigByKey.get('start');
  if (first && startSig) {
    const to = outOf(first.items[0]);
    if (to) annotations.push({ id: uid('ann'), type: 'arrow', from: { signalId: startSig.id, t: START_AT }, to: { signalId: to.id, t: first.start }, label: '시작' });
  }
  for (let i = 1; i < tl.groups.length; i++) {
    const prev = tl.groups[i - 1];
    const last = prev.items.reduce((a, b) => (b.end >= a.end ? b : a));
    const from = doneOf(last);
    const next = tl.groups[i];
    const to = outOf(next.items[0]);
    if (from && to && from.id !== to.id) annotations.push({ id: uid('ann'), type: 'arrow', from: { signalId: from.id, t: prev.end }, to: { signalId: to.id, t: next.start }, label: '' });
  }
  annotations.push({ id: uid('ann'), type: 'marker', t: tl.cycleEnd, label: '사이클 완료', color: '#16a34a' });

  // 검토 규칙: 목표 사이클 타임, 더블 솔레노이드 양쪽 동시 ON 금지
  const rules: TimingRule[] = [];
  if (spec.targetCycle > 0) rules.push({ id: uid('rule'), type: 'cycle', name: '목표 사이클 타임', max: spec.targetCycle });
  for (const d of spec.devices) {
    if (d.kind !== 'cyl2') continue;
    const a = sigByKey.get(`${d.id}:fwdOut`);
    const b = sigByKey.get(`${d.id}:retOut`);
    if (a && b) rules.push({ id: uid('rule'), type: 'exclusive', name: `${d.name} ${d.fwdLabel}/${d.retLabel} SOL 동시 ON 금지`, a: a.id, b: b.id });
  }

  const duration = niceCeil(Math.max(tl.cycleEnd * 1.12, tl.cycleEnd + 300));
  const p = createProject();
  p.meta = {
    ...p.meta,
    title: spec.title || (spec.machine ? `${spec.machine} 동작 타임차트` : '동작 타임차트'),
    machine: spec.machine,
    drawingNo: spec.drawingNo,
    author: spec.author,
    description: `동작 ${tl.groups.length}단계, 사이클 타임 ${formatTime(tl.cycleEnd - tl.cycleStart, 'auto')}${spec.targetCycle > 0 ? ` (목표 ${formatTime(spec.targetCycle, 'auto')})` : ''}`,
  };
  p.settings = { ...p.settings, duration, grid: niceGrid(duration), timeUnit: duration >= 10000 ? 's' : 'ms' };
  p.signals = signals;
  p.steps = steps;
  p.annotations = annotations;
  p.rules = rules;
  p.sequence = JSON.parse(JSON.stringify(spec)) as SeqSpec;
  return p;
}
