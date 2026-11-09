import type { WavePoint } from '../model/types';
import type { Circuit, OpStep, Part, PartType } from './types';
import { buildNetlist, type Netlist } from './netlist';
import { isLinkedSensor, OPERATOR, PARTS, POLE_IDENTITY, POLE_SYSTEM } from './parts';
import { formatTime } from '../model/format';

/**
 * 회로 시뮬레이션 (사건 구동)
 *  - 닫힌 접점·퓨즈·차단기로 이어진 넷을 묶고, 묶음마다 닿은 전원 극을 본다.
 *  - 부하(코일·램프·전동기·솔레노이드)는 두 단자가 같은 계통의 서로 다른 극에 닿으면 동작.
 *    (+24V 와 0V, L 과 N, L1 과 L2 …) 부하를 거쳐서만 닿는 단자는 극이 없는 것으로 본다.
 *  - 한 묶음에 서로 다른 극이 둘 이상 닿으면 단락.
 *  - 코일은 한 번에 하나씩 바꾸며 안정될 때까지 반복 (동시에 누른 정역 버튼은 앞 렁이 이김).
 *  - 타이머 만료, 실린더 도착 시각을 다음 사건으로 잡아서 시간을 건너뛴다.
 */

export type TagKind = 'coil' | 'timer' | 'thr' | 'sensor' | 'operator';

/** 부품이 따르는 기호 (대소문자 무시, 기호 없는 조작 기기는 부품마다 따로) */
export function tagKey(p: Pick<Part, 'id' | 'tag'>): string {
  const t = p.tag.trim();
  return t ? t.toUpperCase() : `#${p.id}`;
}

export function normTag(tag: string): string {
  return tag.trim().toUpperCase();
}

interface Conductor {
  part: Part;
  a: number;
  b: number;
  tag: string;
  nc: boolean;
  always: boolean;
}

export type TrackKind = 'operator' | 'sensor' | 'coil' | 'timerCoil' | 'timerOut' | 'load' | 'motor' | 'cyl';

export interface Track {
  key: string;
  /** 화면에 쓰는 기호 */
  tag: string;
  kind: TrackKind;
  /** 대표 부품 */
  part: Part;
  points: WavePoint[];
  last: number | string | null;
}

/** 회로에서 바뀌지 않는 정보 (기호 연결, 넷) */
export class CircuitModel {
  readonly net: Netlist;
  readonly tagKind = new Map<string, TagKind>();
  /** 기호 → 화면용 기호 */
  readonly tagLabel = new Map<string, string>();
  readonly coilParts = new Map<string, string[]>();
  readonly timerParts = new Map<string, string[]>();
  readonly timerDef = new Map<string, { mode: 'on' | 'off'; preset: number }>();
  readonly cylDef = new Map<string, Part>();
  readonly sensorDef = new Map<string, { cyl: string; end: '+' | '-' }>();
  readonly operatorDefault = new Map<string, boolean>();
  readonly loads: Part[] = [];
  readonly loadParts = new Map<string, string[]>();
  readonly conductors: Conductor[] = [];
  readonly sources: { net: number; id: string }[] = [];
  /** 대표 부품 (기호마다 처음 나온 것, 코일이 있으면 코일) */
  readonly mainPart = new Map<string, Part>();

  constructor(readonly circuit: Circuit) {
    this.net = buildNetlist(circuit);
    const rank: Record<TagKind, number> = { coil: 5, timer: 5, thr: 4, sensor: 3, operator: 2 };
    const setKind = (tag: string, k: TagKind, p: Part) => {
      const cur = this.tagKind.get(tag);
      if (!cur || rank[k] > rank[cur]) {
        this.tagKind.set(tag, k);
        this.mainPart.set(tag, p);
      }
    };
    const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
    for (const p of circuit.parts) {
      const tag = tagKey(p);
      if (!this.tagLabel.has(tag)) this.tagLabel.set(tag, p.tag.trim() || PARTS[p.type].prefix || '?');
      if (!this.mainPart.has(tag)) this.mainPart.set(tag, p);
      const def = PARTS[p.type];
      if (p.type === 'coil') {
        setKind(tag, 'coil', p);
        push(this.coilParts, tag, p.id);
      } else if (p.type === 'timer') {
        setKind(tag, 'timer', p);
        push(this.timerParts, tag, p.id);
        if (!this.timerDef.has(tag)) this.timerDef.set(tag, { mode: p.timerMode ?? 'on', preset: Math.max(0, p.preset ?? 3000) });
      } else if (p.type === 'ol3') setKind(tag, 'thr', p);
      else if (isLinkedSensor(p)) {
        setKind(tag, 'sensor', p);
        if (!this.sensorDef.has(tag)) this.sensorDef.set(tag, { cyl: normTag(p.cyl!), end: p.end ?? '+' });
      } else if (OPERATOR.has(p.type)) {
        setKind(tag, 'operator', p);
        if (def.defaultOn) this.operatorDefault.set(tag, true);
      } else if (p.type === 'cyl') {
        if (p.tag.trim() && !this.cylDef.has(tag)) this.cylDef.set(tag, p);
      }
      if (def.load) {
        this.loads.push(p);
        push(this.loadParts, tag, p.id);
      }
      if (def.poles) {
        for (const [i, j] of def.poles) {
          const a = this.net.pinNet.get(`${p.id}:${i}`)!;
          const b = this.net.pinNet.get(`${p.id}:${j}`)!;
          this.conductors.push({ part: p, a, b, tag, nc: !!def.nc, always: p.type === 'fuse' || p.type === 'fuse3' });
        }
      }
      if (p.type === 'src') this.sources.push({ net: this.net.pinNet.get(`${p.id}:0`)!, id: POLE_IDENTITY[p.pole ?? 'L'] });
      if (p.type === 'src3') ['L1', 'L2', 'L3'].forEach((id, i) => this.sources.push({ net: this.net.pinNet.get(`${p.id}:${i}`)!, id }));
    }
    // 실린더 기호가 없는 리밋 스위치 연결은 조작 기기로
    for (const [tag, s] of this.sensorDef) {
      if (!this.cylDef.has(s.cyl)) {
        this.sensorDef.delete(tag);
        this.tagKind.set(tag, 'operator');
      }
    }
  }

  /** 사람이 조작하는 기호 (조작 순서에서 고를 수 있는 것) */
  operable(): string[] {
    return [...this.tagKind].filter(([, k]) => k === 'operator' || k === 'thr').map(([t]) => t);
  }

  label(tag: string): string {
    return this.tagLabel.get(tag) ?? tag;
  }
}

export interface TimerView {
  coil: boolean;
  out: boolean;
  /** 진행 중이면 지난 시간 (ms) */
  elapsed: number | null;
  preset: number;
}

const EPS = 1e-6;
/** 끝 센서가 꺼지기까지 실린더가 움직이는 거리 (스트로크의 3%) */
export const SENSOR_BAND = 0.03;

interface CylState {
  pos: number;
  target: 0 | 1;
  atPlus: boolean;
  atMinus: boolean;
}

export class CircuitSim {
  t = 0;
  readonly act = new Map<string, boolean>();
  readonly coilOn = new Map<string, boolean>();
  readonly timers = new Map<string, { coil: boolean; out: boolean; since: number }>();
  readonly cyl = new Map<string, CylState>();
  /** 넷마다 닿은 극 ('short' = 단락, null = 전압 없음) */
  netPole: (string | null)[] = [];
  readonly energized = new Set<string>();
  readonly motorDir = new Map<string, 1 | -1>();
  readonly openPhase = new Set<string>();
  shorted = false;
  readonly warnings: string[] = [];
  private readonly warned = new Set<string>();
  readonly tracks: Track[] = [];

  constructor(readonly m: CircuitModel) {
    for (const [tag, k] of m.tagKind) if (k === 'operator' || k === 'thr') this.act.set(tag, m.operatorDefault.get(tag) ?? false);
    for (const tag of m.coilParts.keys()) this.coilOn.set(tag, false);
    for (const tag of m.timerParts.keys()) this.timers.set(tag, { coil: false, out: false, since: 0 });
    for (const tag of m.cylDef.keys()) this.cyl.set(tag, { pos: 0, target: 0, atPlus: false, atMinus: true });
    this.buildTracks();
    this.settle();
    this.record();
  }

  // ───────────── 상태 읽기 ─────────────

  /** 기호가 동작 중인가 (코일 여자, 타이머 출력, 스위치 눌림, 센서 감지) */
  on(tag: string): boolean {
    switch (this.m.tagKind.get(tag)) {
      case 'coil':
        return this.coilOn.get(tag) ?? false;
      case 'timer':
        return this.timers.get(tag)?.out ?? false;
      case 'thr':
      case 'operator':
        return this.act.get(tag) ?? false;
      case 'sensor': {
        const s = this.m.sensorDef.get(tag)!;
        const c = this.cyl.get(s.cyl);
        if (!c) return false;
        return s.end === '+' ? c.atPlus : c.atMinus;
      }
      default:
        return false;
    }
  }

  /** 접점 (부품) 이 닫혀 있는가 */
  closed(p: Part): boolean {
    if (p.type === 'fuse' || p.type === 'fuse3') return true;
    const v = this.on(tagKey(p));
    return PARTS[p.type].nc ? !v : v;
  }

  loadOn(tag: string): boolean {
    return (this.m.loadParts.get(tag) ?? []).some((id) => this.energized.has(id));
  }

  timerView(tag: string): TimerView | null {
    const st = this.timers.get(tag);
    const def = this.m.timerDef.get(tag);
    if (!st || !def) return null;
    const pending = def.mode === 'on' ? st.coil && !st.out : !st.coil && st.out;
    return { coil: st.coil, out: st.out, elapsed: pending ? this.t - st.since : null, preset: def.preset };
  }

  cylPos(tag: string): number {
    return this.cyl.get(tag)?.pos ?? 0;
  }

  // ───────────── 조작 ─────────────

  setAct(tag: string, on: boolean): boolean {
    const k = this.m.tagKind.get(tag);
    if (k !== 'operator' && k !== 'thr') return false;
    if ((this.act.get(tag) ?? false) === on) return false;
    this.act.set(tag, on);
    this.settle();
    this.record();
    return true;
  }

  // ───────────── 계산 ─────────────

  private warn(msg: string, key = msg): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(msg);
  }

  private evaluate(): void {
    const n = this.m.net.count;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (const c of this.m.conductors) {
      if (c.always || this.on(c.tag) !== c.nc) {
        const ra = find(c.a);
        const rb = find(c.b);
        if (ra !== rb) parent[ra] = rb;
      }
    }
    const poles = new Map<number, Set<string>>();
    for (const s of this.m.sources) {
      const r = find(s.net);
      const set = poles.get(r) ?? new Set<string>();
      set.add(s.id);
      poles.set(r, set);
    }
    this.shorted = false;
    const groupPole = new Map<number, string>();
    for (const [r, set] of poles) {
      if (set.size > 1) {
        groupPole.set(r, 'short');
        this.shorted = true;
        this.warn(`${formatTime(this.t, 's')}: 단락 - ${[...set].join(', ')} 이(가) 바로 이어졌습니다`, `short:${[...set].sort().join()}`);
      } else groupPole.set(r, [...set][0]);
    }
    this.netPole = Array.from({ length: n }, (_, i) => groupPole.get(find(i)) ?? null);

    this.energized.clear();
    this.motorDir.clear();
    this.openPhase.clear();
    const live = (net: number | undefined) => {
      const p = net === undefined ? null : this.netPole[net];
      return p && p !== 'short' ? p : null;
    };
    for (const p of this.m.loads) {
      const nets = PARTS[p.type].pins.map((_, i) => this.m.net.pinNet.get(`${p.id}:${i}`));
      if (p.type === 'motor3') {
        const ph = nets.map(live);
        const idx = ph.map((x) => (x === 'L1' ? 0 : x === 'L2' ? 1 : x === 'L3' ? 2 : -1));
        const distinct = new Set(idx.filter((i) => i >= 0));
        if (distinct.size === 3) {
          this.energized.add(p.id);
          const [u, v] = idx;
          this.motorDir.set(p.id, (v - u + 3) % 3 === 1 ? 1 : -1);
        } else if (distinct.size === 2) {
          this.openPhase.add(p.id);
          this.warn(`${p.tag || 'M'}: 결상 - 두 상만 이어져서 돌지 않습니다`, `open:${p.id}`);
        }
        continue;
      }
      const a = live(nets[0]);
      const b = live(nets[1]);
      if (a && b && a !== b && POLE_SYSTEM[a] === POLE_SYSTEM[b]) {
        this.energized.add(p.id);
        // 직류 전동기만 극성으로 방향이 바뀐다
        if (p.type === 'motor') this.motorDir.set(p.id, a === '0V' ? -1 : 1);
      }
    }
  }

  /** 코일·타이머·실린더 하나를 바꾸면 true */
  private stepOnce(): boolean {
    for (const [tag, ids] of this.m.coilParts) {
      const want = ids.some((id) => this.energized.has(id));
      if (want !== this.coilOn.get(tag)) {
        this.coilOn.set(tag, want);
        return true;
      }
    }
    for (const [tag, ids] of this.m.timerParts) {
      const want = ids.some((id) => this.energized.has(id));
      const st = this.timers.get(tag)!;
      if (want === st.coil) continue;
      const def = this.m.timerDef.get(tag)!;
      st.coil = want;
      st.since = this.t;
      if (def.mode === 'on') {
        if (!want) st.out = false;
        else if (def.preset <= 0) st.out = true;
      } else if (want) st.out = true;
      else if (def.preset <= 0) st.out = false;
      return true;
    }
    let jumped = false;
    for (const [tag, def] of this.m.cylDef) {
      const st = this.cyl.get(tag)!;
      const plus = def.solPlus ? this.loadOn(normTag(def.solPlus)) : false;
      const minus = def.solMinus ? this.loadOn(normTag(def.solMinus)) : false;
      let target = st.target;
      if (def.solMinus?.trim()) {
        if (plus && !minus) target = 1;
        else if (minus && !plus) target = 0;
      } else target = plus ? 1 : 0;
      if (target === st.target) continue;
      st.target = target;
      if (this.strokeTime(def, target) <= 0) {
        st.pos = target;
        st.atPlus = target === 1;
        st.atMinus = target === 0;
        jumped = true;
      }
    }
    return jumped;
  }

  private strokeTime(def: Part, target: 0 | 1): number {
    return Math.max(0, target ? def.stroke ?? 1000 : def.strokeBack ?? def.stroke ?? 1000);
  }

  settle(): void {
    for (let i = 0; i < 400; i++) {
      this.evaluate();
      if (!this.stepOnce()) return;
    }
    this.warn(`${formatTime(this.t, 's')}: 릴레이가 계속 켜졌다 꺼졌다 합니다 (발진)`, 'osc');
  }

  /** 다음 사건 시각 (타이머 만료, 실린더 도착·끝 센서 벗어남) */
  nextEvent(): number | null {
    let best = Infinity;
    for (const [tag, st] of this.timers) {
      const def = this.m.timerDef.get(tag)!;
      if ((def.mode === 'on' && st.coil && !st.out) || (def.mode === 'off' && !st.coil && st.out)) best = Math.min(best, st.since + def.preset);
    }
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target) continue;
      const time = this.strokeTime(this.m.cylDef.get(tag)!, st.target);
      best = Math.min(best, this.t + Math.abs(st.target - st.pos) * time);
      if (st.atPlus && st.target === 0) best = Math.min(best, this.t + Math.max(0, st.pos - (1 - SENSOR_BAND)) * time);
      if (st.atMinus && st.target === 1) best = Math.min(best, this.t + Math.max(0, SENSOR_BAND - st.pos) * time);
    }
    return best === Infinity ? null : Math.max(best, this.t);
  }

  private moveTo(t2: number): void {
    const dt = t2 - this.t;
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target) continue;
      if (dt > 0) {
        const time = this.strokeTime(this.m.cylDef.get(tag)!, st.target);
        const step = time > 0 ? dt / time : 1;
        st.pos = st.target === 1 ? Math.min(1, st.pos + step) : Math.max(0, st.pos - step);
        if (Math.abs(st.pos - st.target) < EPS) st.pos = st.target;
      }
      if (st.pos >= 1 - EPS) st.atPlus = true;
      else if (st.pos <= 1 - SENSOR_BAND + EPS) st.atPlus = false;
      if (st.pos <= EPS) st.atMinus = true;
      else if (st.pos >= SENSOR_BAND - EPS) st.atMinus = false;
    }
    this.t = Math.max(this.t, t2);
  }

  /** to 까지 시간을 진행 (사이의 사건을 차례로 처리) */
  advanceTo(to: number): void {
    for (let guard = 0; guard < 200000; guard++) {
      const next = this.nextEvent();
      if (next === null || next > to + EPS) {
        this.moveTo(to);
        return;
      }
      this.moveTo(next);
      for (const [tag, st] of this.timers) {
        const def = this.m.timerDef.get(tag)!;
        if (st.since + def.preset > this.t + EPS) continue;
        if (def.mode === 'on' && st.coil && !st.out) st.out = true;
        else if (def.mode === 'off' && !st.coil && st.out) st.out = false;
      }
      this.settle();
      this.record();
    }
    this.warn('사건이 너무 많아 시뮬레이션을 멈췄습니다', 'guard');
    this.moveTo(to);
  }

  // ───────────── 기록 (타임차트) ─────────────

  private buildTracks(): void {
    const m = this.m;
    const add = (key: string, tag: string, kind: TrackKind) => this.tracks.push({ key, tag: m.label(tag), kind, part: m.mainPart.get(tag)!, points: [], last: null });
    for (const [tag, k] of m.tagKind) {
      if (k === 'operator' || k === 'thr') add(`op:${tag}`, tag, 'operator');
      else if (k === 'sensor') add(`sen:${tag}`, tag, 'sensor');
      else if (k === 'coil') add(`coil:${tag}`, tag, 'coil');
      else if (k === 'timer') {
        add(`tc:${tag}`, tag, 'timerCoil');
        add(`tq:${tag}`, tag, 'timerOut');
      }
    }
    for (const [tag, ids] of m.loadParts) {
      const k = m.tagKind.get(tag);
      if (k === 'coil' || k === 'timer') continue;
      const types = new Set(ids.map((id) => m.circuit.parts.find((p) => p.id === id)!.type));
      const motor = types.has('motor3') || types.has('motor');
      const t = this.tracks.length;
      add(`${motor ? 'mot' : 'load'}:${tag}`, tag, motor ? 'motor' : 'load');
      this.tracks[t].part = m.circuit.parts.find((p) => p.id === ids[0])!;
    }
    for (const [tag, p] of m.cylDef) {
      this.tracks.push({ key: `cyl:${tag}`, tag: m.label(tag), kind: 'cyl', part: p, points: [], last: null });
    }
  }

  private trackValue(tr: Track): number | string {
    const tag = tr.key.slice(tr.key.indexOf(':') + 1);
    switch (tr.kind) {
      case 'operator':
      case 'sensor':
      case 'coil':
        return this.on(tag) ? 1 : 0;
      case 'timerCoil':
        return this.timers.get(tag)?.coil ? 1 : 0;
      case 'timerOut':
        return this.timers.get(tag)?.out ? 1 : 0;
      case 'load':
        return this.loadOn(tag) ? 1 : 0;
      case 'motor': {
        const ids = this.m.loadParts.get(tag) ?? [];
        const dir = ids.map((id) => this.motorDir.get(id)).find((d) => d !== undefined);
        return dir === undefined ? '0' : dir > 0 ? 'FWD' : 'REV';
      }
      case 'cyl':
        return this.cyl.get(tag)?.target ?? 0;
    }
  }

  record(): void {
    const t = Math.round(this.t * 1000) / 1000;
    for (const tr of this.tracks) {
      const v = this.trackValue(tr);
      if (tr.last !== null && tr.last === v) continue;
      const pt: WavePoint = { t, v };
      if (tr.kind === 'cyl') {
        const tag = tr.key.slice(4);
        const st = this.cyl.get(tag)!;
        const remain = Math.abs(st.target - st.pos) * this.strokeTime(this.m.cylDef.get(tag)!, st.target);
        if (remain > 0) pt.ramp = Math.round(remain * 1000) / 1000;
      }
      tr.points.push(pt);
      tr.last = v;
    }
  }
}

// ───────────────────────── 조작 순서 → 시뮬레이션 ─────────────────────────

export interface OpEvent {
  t: number;
  tag: string;
  on: boolean;
}

/** 조작 순서의 각 줄 시각 (앞 줄 조작 시각 + 대기) */
export function opTimes(ops: OpStep[]): number[] {
  let t = 0;
  return ops.map((o) => (t += Math.max(0, o.wait)));
}

export function opsToEvents(ops: OpStep[]): OpEvent[] {
  const times = opTimes(ops);
  const ev: OpEvent[] = [];
  ops.forEach((o, i) => {
    const tag = normTag(o.tag);
    if (!tag) return;
    const t = times[i];
    if (o.action === 'press') {
      ev.push({ t, tag, on: true });
      ev.push({ t: t + Math.max(0, o.hold), tag, on: false });
    } else ev.push({ t, tag, on: o.action === 'on' });
  });
  return ev.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
}

export interface ScenarioResult {
  model: CircuitModel;
  tracks: Track[];
  /** 시뮬레이션한 끝 시각 */
  end: number;
  /** 마지막으로 무언가 바뀐 시각 (조작 포함) */
  lastChange: number;
  warnings: string[];
  times: number[];
}

/** 조작 순서대로 회로를 돌려 신호 기록을 얻는다 */
export function runScenario(c: Circuit, model: CircuitModel = new CircuitModel(c)): ScenarioResult {
  const sim = new CircuitSim(model);
  const events = opsToEvents(c.ops);
  const fixed = c.duration && c.duration > 0 ? c.duration : null;
  const missing = new Set<string>();
  for (const ev of events) {
    if (fixed !== null && ev.t > fixed) break;
    sim.advanceTo(ev.t);
    const k = model.tagKind.get(ev.tag);
    if (k !== 'operator' && k !== 'thr') {
      missing.add(ev.tag);
      continue;
    }
    sim.setAct(ev.tag, ev.on);
  }
  const lastOp = events.length ? events[events.length - 1].t : 0;
  if (fixed !== null) sim.advanceTo(fixed);
  else {
    // 마지막 조작 뒤: 타이머·실린더가 멈출 때까지 (최대 60초)
    const limit = lastOp + 60000;
    for (let i = 0; i < 10000; i++) {
      const next = sim.nextEvent();
      if (next === null || next > limit) break;
      sim.advanceTo(next);
    }
  }
  let last = lastOp;
  for (const tr of sim.tracks) {
    const p = tr.points[tr.points.length - 1];
    if (p && tr.points.length > 1) last = Math.max(last, p.t + (p.ramp ?? 0));
  }
  const warnings = [...sim.warnings];
  for (const t of missing) warnings.push(`조작 순서의 ${t}: 회로에 그런 조작 기기가 없습니다`);
  return { model, tracks: sim.tracks, end: fixed ?? Math.max(sim.t, last), lastChange: last, warnings, times: opTimes(c.ops) };
}

/** 대표 부품의 종류 */
export function trackType(tr: Track): PartType {
  return tr.part.type;
}
