import type { Annotation, Project, Signal, SignalRole, Step, WavePoint } from '../model/types';
import { createSignal, createStep, ROLE_COLORS, STEP_COLORS } from '../model/project';
import { normalize, uid } from '../model/wave';
import { formatTime } from '../model/format';
import { niceCeil, niceGrid } from '../plc/simulator';
import type { Circuit, Part } from './types';
import { CircuitModel, normTag, runScenario, type ScenarioResult, type Track } from './engine';
import { compareTags, partKindName } from './parts';
import { tr as t_ } from '../i18n';

/** 대표 부품이 전자접촉기인가 (MC/KM 기호이거나 주접점이 있음) */
export function isContactor(c: Circuit, tag: string): boolean {
  const t = normTag(tag);
  return /^(MC|KM)/.test(t) || c.parts.some((p) => p.type === 'km3' && normTag(p.tag) === t);
}

interface RowSpec {
  tr: Track;
  address: string;
  name: string;
  role: SignalRole;
  group: string;
  kind: 'bit' | 'bus';
  points: WavePoint[];
  onLabel?: string;
  offLabel?: string;
  defaultRamp?: number;
  /** 타이머 지연 치수선 [시작, 끝] */
  dim?: [number, number];
}

function defaultName(p: Part): string {
  switch (p.type) {
    case 'pb_no':
    case 'pb_nc':
      return t_('푸시버튼', 'Push button');
    case 'sw_no':
    case 'sw_nc':
      return t_('셀렉터 스위치', 'Selector switch');
    case 'estop':
      return t_('비상정지', 'E-stop');
    case 'ls_no':
    case 'ls_nc':
      return p.sense === 'reed' ? t_('리드 스위치', 'Reed switch') : p.sense === 'float' ? t_('플로트 스위치', 'Float switch') : p.sense === 'pressure' ? t_('압력 스위치', 'Pressure switch') : t_('리밋 스위치', 'Limit switch');
    case 'prox':
      return p.sense === 'photo' ? t_('광전 센서', 'Photo sensor') : t_('근접 센서', 'Proximity sensor');
    case 'mcb':
    case 'mcb3':
      return t_('차단기', 'Breaker');
    case 'ol3':
      return t_('THR 트립', 'THR trip');
    case 'coil':
      return t_('릴레이', 'Relay');
    case 'timer':
      return t_('타이머', 'Timer');
    case 'lamp':
      return t_('표시등', 'Lamp');
    case 'buzzer':
      return t_('부저', 'Buzzer');
    case 'motor':
    case 'motor3':
      return t_('전동기', 'Motor');
    case 'sol':
      return t_('솔레노이드', 'Solenoid');
    case 'cyl':
      return t_('실린더', 'Cylinder');
    default:
      return partKindName(p.type);
  }
}

/** 기호마다 처음 적힌 설명 */
function nameOf(c: Circuit, tag: string, fallback: Part): string {
  const t = normTag(tag);
  const named = c.parts.find((p) => normTag(p.tag) === t && p.name?.trim());
  return named?.name?.trim() || defaultName(fallback);
}

/** 시뮬레이션 기록 → 차트 행 (조작 → 센서 → 릴레이·MC → 타이머 → 출력 → 공압) */
function rows(c: Circuit, res: ScenarioResult): RowSpec[] {
  const until = res.end;
  const opTags = c.ops.map((o) => normTag(o.tag));
  const firstOp = (tag: string) => {
    const i = opTags.indexOf(tag);
    return i < 0 ? Infinity : i;
  };
  const keyTag = (tr: Track) => tr.key.slice(tr.key.indexOf(':') + 1);
  const pts = (tr: Track) => normalize(tr.points.filter((p) => p.t <= until + 1e-9), tr.kind === 'motor' ? 'bus' : 'bit', tr.kind === 'motor' ? '0' : 0);
  const out: RowSpec[] = [];
  const bit = (tr: Track, role: SignalRole, group: string, extra: Partial<RowSpec> = {}): RowSpec => ({ tr, address: tr.tag, name: nameOf(c, keyTag(tr), tr.part), role, group, kind: 'bit', points: pts(tr), ...extra });

  // 조작: 조작 순서에 나온 순서, 그 밖에 바뀐 것
  const ops = res.tracks.filter((t) => t.kind === 'operator' && (firstOp(keyTag(t)) < Infinity || pts(t).length > 1));
  ops.sort((a, b) => firstOp(keyTag(a)) - firstOp(keyTag(b)) || compareTags(a.tag, b.tag));
  const G = { plcIn: t_('PLC 입력', 'PLC inputs'), plcOut: t_('PLC 출력', 'PLC outputs'), op: t_('조작', 'Operation'), mc: t_('전자접촉기', 'Contactors'), relay: t_('릴레이', 'Relays'), timer: t_('타이머', 'Timers'), pneu: t_('공압', 'Pneumatics'), sensor: t_('센서', 'Sensors'), out: t_('출력', 'Outputs') };
  for (const tr of ops) out.push(bit(tr, 'input', G.op));

  // PLC 입출력 (주소 = 디바이스, 이름 = 코멘트)
  for (const tr of res.tracks.filter((t) => t.kind === 'plcIn' || t.kind === 'plcOut')) {
    const b = res.model.plcs.find((x) => x.part.id === tr.part.id);
    const input = tr.kind === 'plcIn';
    const name = (input ? b?.inName : b?.outName)?.[tr.idx!] || (input ? t_('PLC 입력', 'PLC input') : t_('PLC 출력', 'PLC output'));
    out.push(bit(tr, input ? 'input' : 'output', input ? G.plcIn : G.plcOut, { name }));
  }

  // 릴레이·전자접촉기 (그린 순서)
  for (const tr of res.tracks.filter((t) => t.kind === 'coil')) {
    const mc = isContactor(c, tr.tag);
    out.push(bit(tr, mc ? 'output' : 'internal', mc ? G.mc : G.relay));
  }
  // 타이머: 코일과 한시 접점 (+ 처음 한 번의 지연 치수선)
  for (const tr of res.tracks.filter((t) => t.kind === 'timerCoil' || t.kind === 'timerOut')) {
    const p = tr.part;
    const time = formatTime(p.preset ?? 3000, 's');
    const name = nameOf(c, keyTag(tr), p);
    if (tr.kind === 'timerCoil') {
      out.push(bit(tr, 'timer', G.timer, { name: `${name} ${t_('코일', 'coil')} (${p.timerMode === 'off' ? 'OFF' : p.timerMode === 'flicker' ? t_('점멸', 'flicker') : 'ON'} ${time})` }));
      continue;
    }
    const row = bit(tr, 'timer', G.timer, { address: `${tr.tag}.Q`, name: `${name} ${t_('한시 접점', 'timed contact')}` });
    const coil = out[out.length - 1]?.points ?? [];
    const edge = (pp: WavePoint[], v: number, after: number) => pp.find((q) => q.t >= after && q.v === v && pp.indexOf(q) > 0)?.t;
    const off = p.timerMode === 'off';
    if (p.timerMode === 'flicker') {
      out.push(row);
      continue;
    }
    const t1 = off ? edge(coil, 0, edge(coil, 1, 0) ?? Infinity) : edge(coil, 1, 0);
    const t2 = t1 === undefined ? undefined : edge(row.points, off ? 0 : 1, t1);
    if (t1 !== undefined && t2 !== undefined && t2 > t1) row.dim = [t1, t2];
    out.push(row);
  }

  // 공압: 실린더마다 전진 SOL → 후진 SOL → 실린더 → 전진단 → 후진단
  const used = new Set<Track>();
  const pneu: RowSpec[] = [];
  const loadByTag = new Map(res.tracks.filter((t) => t.kind === 'load').map((t) => [keyTag(t), t]));
  const sensors = res.tracks.filter((t) => t.kind === 'sensor');
  for (const tr of res.tracks.filter((t) => t.kind === 'cyl')) {
    const p = tr.part;
    for (const s of [p.solPlus, p.solMinus]) {
      const st = s ? loadByTag.get(normTag(s)) : undefined;
      if (st && !used.has(st)) {
        used.add(st);
        pneu.push(bit(st, 'output', G.pneu));
      }
    }
    pneu.push(bit(tr, 'actuator', G.pneu, { address: tr.tag, onLabel: t_('전진', 'ADV'), offLabel: t_('후진', 'RET'), defaultRamp: p.stroke ?? 1000, points: normalize(tr.points.filter((q) => q.t <= until + 1e-9), 'bit', 0) }));
    const mine = sensors.filter((s) => res.model.sensorDef.get(keyTag(s))?.cyl === keyTag(tr));
    mine.sort((a, b) => (res.model.sensorDef.get(keyTag(a))!.end === '+' ? 0 : 1) - (res.model.sensorDef.get(keyTag(b))!.end === '+' ? 0 : 1));
    for (const s of mine) {
      used.add(s);
      pneu.push(bit(s, 'sensor', G.pneu));
    }
  }
  for (const s of sensors) if (!used.has(s)) out.push(bit(s, 'sensor', G.sensor));

  // 출력: 램프·부저·솔레노이드, 전동기 (정·역이 다 나오면 정/역 칸)
  for (const tr of res.tracks.filter((t) => (t.kind === 'load' || t.kind === 'motor') && !used.has(t))) {
    if (tr.kind === 'motor') {
      const p = pts(tr);
      const both = p.some((q) => q.v === 'REV') && p.some((q) => q.v === 'FWD');
      const fwd = t_('정회전', 'FWD');
      const rev = t_('역회전', 'REV');
      if (both) out.push({ ...bit(tr, 'output', G.out), kind: 'bus', points: normalize(p.map((q) => ({ t: q.t, v: q.v === 'FWD' ? fwd : q.v === 'REV' ? rev : '0' })), 'bus', '0') });
      else out.push(bit(tr, 'output', G.out, { points: normalize(p.map((q) => ({ t: q.t, v: q.v === '0' ? 0 : 1 })), 'bit', 0), onLabel: p.some((q) => q.v === 'REV') ? rev : t_('운전', 'RUN'), offLabel: t_('정지', 'STOP') }));
    } else out.push(bit(tr, 'output', G.out, tr.part.type === 'lamp' ? { onLabel: t_('점등', 'ON'), offLabel: t_('소등', 'OFF') } : {}));
  }
  out.push(...pneu);
  return out;
}

/** 조작 순서의 메모 → 공정 스텝 */
function opSteps(c: Circuit, res: ScenarioResult, until: number): Step[] {
  const marks = c.ops.map((o, i) => ({ note: o.note?.trim() ?? '', t: res.times[i] })).filter((m) => m.note && m.t < until);
  return marks.map((m, i) =>
    createStep({ label: m.note, start: m.t, end: i + 1 < marks.length ? marks[i + 1].t : until, description: '', color: STEP_COLORS[i % STEP_COLORS.length] }),
  );
}

/** 회로가 바뀌었는지 보는 서명 (차트에 영향을 주는 것만) */
export function circuitSig(c: Circuit, plcSource = ''): string {
  const plc = c.parts.some((p) => p.type === 'plc') ? plcSource : '';
  const s = JSON.stringify([c.parts.filter((p) => p.type !== 'text'), c.wires.map((w) => [w.a, w.b]), c.ops, c.duration ?? 0, plc]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export const AUTO_DESC = /^회로 시뮬레이션: /;

/**
 * 시뮬레이션 결과 → 타임차트. 같은 주소(기호)의 기존 신호는 이름·색·그룹 등 손으로 고친 것을 유지하고
 * 파형만 바꾼다. 화살표·치수선·규칙은 남은 신호에 걸린 것만 둔다. 타이머 지연 치수선은 자동으로 다시 그린다.
 */
export function circuitToProject(base: Project, c: Circuit, res: ScenarioResult = runScenario(c)): Project {
  const existing = new Map<string, Signal>();
  for (const s of base.signals) existing.set(s.address || s.name, s);
  const duration = c.duration && c.duration > 0 ? c.duration : niceCeil(Math.max(res.lastChange * 1.1, res.lastChange + 500, 1000));
  const specs = rows(c, res);
  const signals: Signal[] = specs.map((r) => {
    const prev = existing.get(r.address);
    if (prev && prev.kind === r.kind) return { ...prev, points: r.points };
    return createSignal({
      name: r.name,
      address: r.address,
      kind: r.kind,
      role: r.role,
      color: ROLE_COLORS[r.role],
      group: r.group,
      points: r.points,
      ...(r.onLabel ? { onLabel: r.onLabel, offLabel: r.offLabel } : {}),
      ...(r.defaultRamp ? { defaultRamp: r.defaultRamp } : {}),
    });
  });

  const ids = new Set(signals.map((s) => s.id));
  const annotations: Annotation[] = base.annotations.filter((a) => {
    if (a.type === 'dimension' && a.auto) return false;
    if (a.type === 'arrow') return ids.has(a.from.signalId) && ids.has(a.to.signalId);
    if (a.type === 'dimension' || a.type === 'note') return a.signalId === null || ids.has(a.signalId);
    return true;
  });
  specs.forEach((r, i) => {
    if (r.dim) annotations.push({ id: uid('ann'), type: 'dimension', signalId: signals[i].id, t1: r.dim[0], t2: r.dim[1], label: '', auto: true });
  });
  const rules = base.rules.filter((r) => {
    if (r.type === 'delay') return ids.has(r.fromSignal) && ids.has(r.toSignal);
    if (r.type === 'exclusive') return ids.has(r.a) && ids.has(r.b);
    if (r.type === 'pulse') return ids.has(r.signal);
    return true;
  });
  const steps = c.ops.some((o) => o.note?.trim()) ? opSteps(c, res, duration) : [];
  const desc = `회로 시뮬레이션: 조작 ${c.ops.length}단계, 마지막 변화 ${formatTime(res.lastChange, 's')}`;
  return {
    ...base,
    meta: { ...base.meta, description: !base.meta.description || AUTO_DESC.test(base.meta.description) ? desc : base.meta.description },
    settings: { ...base.settings, duration, grid: niceGrid(duration, 10), timeUnit: base.settings.timeUnit === 'ms' && duration >= 10000 ? 's' : base.settings.timeUnit },
    signals,
    steps,
    annotations,
    rules,
    circuit: { ...c, applied: circuitSig(c, base.plc?.source) },
  };
}

/** 회로를 시뮬레이션해서 차트에 넣는다 (회로가 없으면 그대로) */
export function applyCircuit(p: Project): Project {
  if (!p.circuit) return p;
  return circuitToProject(p, p.circuit, runScenario(p.circuit, new CircuitModel(p.circuit, p.plc)));
}

export type CircuitStatus = 'none' | 'applied' | 'changed';

export function circuitStatus(p: Project): CircuitStatus {
  const c = p.circuit;
  if (!c || !c.parts.length) return 'none';
  return c.applied === circuitSig(c, p.plc?.source) ? 'applied' : 'changed';
}

/**
 * 회로를 고치면 차트도 바로 다시 만드는가: 자동 적용이 켜져 있고,
 * 차트가 비었거나 이미 회로로 만든 차트일 때만 (손으로 그린 차트를 덮어쓰지 않게)
 */
export function autoChartOn(p: Project): boolean {
  const c = p.circuit;
  if (!c || c.autoChart === false || !c.parts.length) return false;
  return c.applied !== undefined || p.signals.length === 0;
}
