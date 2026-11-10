import type { WavePoint } from '../model/types';
import type { Circuit, OpStep, Part, PartType } from './types';
import { buildNetlist, type Netlist } from './netlist';
import { isLinkedSensor, OPERATOR, partPins, partPoles, PARTS, plcAddresses, PLC_IO, POLE_IDENTITY, POLE_SYSTEM, schedOn, tswSched, VALVES } from './parts';
import { formatTime } from '../model/format';
import type { PlcConfig, SimSettings } from '../plc/types';
import { parseProgram, type ParsedProgram } from '../plc/program';
import { parseDeviceComments } from '../plc/comments';
import { normDevice } from '../plc/devices';
import type { PlcRuntime } from '../plc/runtime';

/**
 * 회로 시뮬레이션 (사건 구동)
 *  - 닫힌 접점·퓨즈·차단기로 이어진 넷을 묶고, 묶음마다 닿은 전원 극을 본다.
 *  - 부하(코일·램프·전동기·솔레노이드)는 두 단자가 같은 계통의 서로 다른 극에 닿으면 동작.
 *    (+24V 와 0V, L 과 N, L1 과 L2 …) 부하를 거쳐서만 닿는 단자는 극이 없는 것으로 본다.
 *  - 한 묶음에 서로 다른 극이 둘 이상 닿으면 단락.
 *  - 코일은 한 번에 하나씩 바꾸며 안정될 때까지 반복 (동시에 누른 정역 버튼은 앞 렁이 이김).
 *  - 타이머 만료, 실린더 도착 시각을 다음 사건으로 잡아서 시간을 건너뛴다.
 */

export type TagKind = 'coil' | 'timer' | 'tsw' | 'thr' | 'sensor' | 'operator';

const DAY = 86400000;

/** 부품이 따르는 기호 (대소문자 무시, 기호 없는 조작 기기는 부품마다 따로) */
export function tagKey(p: Pick<Part, 'id' | 'tag'>): string {
  const t = p.tag.trim();
  return t ? t.toUpperCase() : `#${p.id}`;
}

export function normTag(tag: string): string {
  return tag.trim().toUpperCase();
}

export interface Conductor {
  part: Part;
  a: number;
  b: number;
  /** 두 단자의 번호 (부품의 단자 목록에서) */
  ia: number;
  ib: number;
  tag: string;
  nc: boolean;
  always: boolean;
  /** PLC 릴레이 출력 번호 (공통 C ↔ Qn) */
  plcOut?: number;
  /** 3선식 센서: 이 부품에 전원이 있어야 닫힌다 */
  power?: string;
  /** 타이머의 순시 접점: 한시 출력이 아니라 코일을 따른다 */
  inst?: boolean;
}

/** 공압 포트 상태: P = 압력, E = 배기(대기), X = 막힘 */
export type AirState = 'P' | 'E' | 'X';

/** 두 극 사이에 전압이 걸리는가 (같은 계통의 다른 극, 직류는 +24V 쪽이 a) */
function powerBetween(a: string | null, b: string | null, dcPolarity = false): boolean {
  if (!a || !b || a === b || a === 'short' || b === 'short' || POLE_SYSTEM[a] !== POLE_SYSTEM[b]) return false;
  return !dcPolarity || POLE_SYSTEM[a] !== 'dc' || a === '+24V';
}

/** 회로 안의 PLC: 입력 단자 넷과 프로그램 디바이스 */
export interface PlcBlock {
  part: Part;
  inNets: number[];
  /** 런타임에 쓰는 디바이스 이름 */
  inDev: string[];
  outDev: string[];
  /** 화면에 보이는 주소 */
  inAddr: string[];
  outAddr: string[];
  /** 디바이스 설명 (코멘트) */
  inName: string[];
  outName: string[];
}

export type TrackKind = 'operator' | 'sensor' | 'coil' | 'timerCoil' | 'timerOut' | 'tsw' | 'load' | 'motor' | 'cyl' | 'plcIn' | 'plcOut';

export interface Track {
  key: string;
  /** 화면에 쓰는 기호 */
  tag: string;
  kind: TrackKind;
  /** 대표 부품 */
  part: Part;
  points: WavePoint[];
  last: number | string | null;
  /** PLC 입출력 번호 */
  idx?: number;
}

/** 회로에서 바뀌지 않는 정보 (기호 연결, 넷) */
export class CircuitModel {
  readonly net: Netlist;
  readonly tagKind = new Map<string, TagKind>();
  /** 기호 → 화면용 기호 */
  readonly tagLabel = new Map<string, string>();
  readonly coilParts = new Map<string, string[]>();
  readonly timerParts = new Map<string, string[]>();
  readonly timerDef = new Map<string, { mode: 'on' | 'off' | 'flicker'; preset: number }>();
  /** 24시간 타임 스위치: 시계 전원 넷 (L · N) 과 켜지는 구간 */
  readonly tswDef = new Map<string, { part: Part; l: number; n: number; sched: [number, number][] }>();
  readonly cylDef = new Map<string, Part>();
  readonly sensorDef = new Map<string, { cyl: string; end: '+' | '-' }>();
  readonly operatorDefault = new Map<string, boolean>();
  readonly loads: Part[] = [];
  readonly loadParts = new Map<string, string[]>();
  readonly conductors: Conductor[] = [];
  readonly sources: { net: number; id: string }[] = [];
  /** 대표 부품 (기호마다 처음 나온 것, 코일이 있으면 코일) */
  readonly mainPart = new Map<string, Part>();
  readonly plcs: PlcBlock[] = [];
  /** PLC 탭의 프로그램 (회로에 PLC 가 있을 때만) */
  readonly prog: ParsedProgram | null = null;
  readonly plcSim: SimSettings | null = null;
  readonly plcIssues: string[] = [];
  /** 3선식 센서: 갈색(+) · 검정(출력) · 파랑(0V) 넷 */
  readonly proxs: { part: Part; bn: number; bu: number }[] = [];
  /** SMPS: 입력 L·N, 출력 +V·-V 넷 */
  readonly smpsList: { part: Part; inL: number; inN: number; outP: number; outM: number }[] = [];
  /** 공압: 공압원 넷, 늘 통하는 쌍(FRL·속도 제어), 속도 제어, 밸브, 실린더 포트 */
  readonly airNets = new Set<number>();
  readonly airSrc: number[] = [];
  readonly airAlways: [number, number][] = [];
  readonly flowCtrls: { part: Part; net: number; speed: number }[] = [];
  readonly valves: { part: Part; ports: number[]; solA: string; solB: string }[] = [];
  readonly cylPorts = new Map<string, { cap: number; rod: number; capTubed: boolean; rodTubed: boolean }>();

  constructor(
    readonly circuit: Circuit,
    plc?: PlcConfig,
  ) {
    this.net = buildNetlist(circuit);
    const rank: Record<TagKind, number> = { coil: 5, timer: 5, tsw: 5, thr: 4, sensor: 3, operator: 2 };
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
      if (p.type === 'timer' || p.type === 'r_timer8') {
        setKind(tag, 'timer', p);
        push(this.timerParts, tag, p.id);
        if (!this.timerDef.has(tag)) this.timerDef.set(tag, { mode: p.timerMode ?? 'on', preset: Math.max(0, p.preset ?? 3000) });
      } else if (p.type === 'r_tsw') {
        setKind(tag, 'tsw', p);
        if (!this.tswDef.has(tag)) this.tswDef.set(tag, { part: p, l: this.net.pinNet.get(`${p.id}:0`)!, n: this.net.pinNet.get(`${p.id}:1`)!, sched: tswSched(p) });
      } else if (p.type === 'coil' || def.selfCoil) {
        setKind(tag, 'coil', p);
        push(this.coilParts, tag, p.id);
      } else if (p.type === 'ol3' || p.type === 'r_thr') setKind(tag, 'thr', p);
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
      const poles = partPoles(p);
      if (poles) {
        // 단자대는 늘 통한다. 8핀 타이머의 1-3 · 1-4 는 순시로 고를 수 있다
        const always = p.type === 'fuse' || p.type === 'fuse3' || p.type === 'r_tb';
        poles.forEach(([i, j], k) => {
          const a = this.net.pinNet.get(`${p.id}:${i}`)!;
          const b = this.net.pinNet.get(`${p.id}:${j}`)!;
          this.conductors.push({ part: p, a, b, ia: i, ib: j, tag, nc: def.polesNc?.[k] ?? !!def.nc, always, inst: p.type === 'r_timer8' && !!p.inst13 && k < 2 });
        });
      }
      if (p.type === 'src' || p.type === 'r_term') this.sources.push({ net: this.net.pinNet.get(`${p.id}:0`)!, id: POLE_IDENTITY[p.pole ?? 'L'] });
      if (p.type === 'src3') ['L1', 'L2', 'L3'].forEach((id, i) => this.sources.push({ net: this.net.pinNet.get(`${p.id}:${i}`)!, id }));
      const pin = (i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
      partPins(p).forEach((pd, i) => pd.air && this.airNets.add(pin(i)));
      const tubed = (n: number) => this.net.pinCount[n] > 1 || this.net.hasWire[n];
      if (p.type === 'prox') {
        // PNP: 감지하면 출력이 + 에, NPN: 출력이 0V 에 이어진다
        this.proxs.push({ part: p, bn: pin(0), bu: pin(2) });
        this.conductors.push({ part: p, a: p.npn ? pin(1) : pin(0), b: p.npn ? pin(2) : pin(1), ia: p.npn ? 1 : 0, ib: p.npn ? 2 : 1, tag, nc: false, always: false, power: p.id });
      } else if (p.type === 'smps') this.smpsList.push({ part: p, inL: pin(0), inN: pin(1), outP: pin(2), outM: pin(3) });
      else if (p.type === 'air') this.airSrc.push(pin(0));
      else if (p.type === 'frl' || p.type === 'fc') {
        this.airAlways.push([pin(0), pin(1)]);
        if (p.type === 'fc') this.flowCtrls.push({ part: p, net: pin(0), speed: Math.min(100, Math.max(5, p.speed ?? 50)) });
      } else if (VALVES.has(p.type)) this.valves.push({ part: p, ports: def.pins.map((_, i) => pin(i)), solA: normTag(p.solA ?? ''), solB: normTag(p.solB ?? '') });
      else if (p.type === 'cyl' && p.tag.trim() && !this.cylPorts.has(tag)) this.cylPorts.set(tag, { cap: pin(0), rod: pin(1), capTubed: tubed(pin(0)), rodTubed: tubed(pin(1)) });
    }
    // PLC: 입력은 단자 넷의 극으로 읽고, 출력은 공통 C ↔ Qn 접점
    const blocks = circuit.parts.filter((p) => p.type === 'plc');
    if (blocks.length) {
      const dialect = plc?.dialect ?? 'mitsubishi';
      if (plc?.source.trim()) {
        try {
          this.prog = parseProgram(plc.source, plc.dialect, parseDeviceComments(plc.comments, plc.dialect));
          this.plcSim = plc.sim;
          const errs = this.prog.messages.filter((m) => m.severity === 'error');
          if (errs.length) this.plcIssues.push(`PLC 프로그램 오류 ${errs.length}개 (줄 ${errs[0].line}: ${errs[0].message})`);
        } catch (e) {
          this.plcIssues.push(`PLC 프로그램을 읽지 못했습니다: ${(e as Error).message}`);
        }
      } else this.plcIssues.push('PLC 프로그램이 없습니다. PLC 시뮬레이션 탭에서 넣으세요');
      const byAddr = new Map((this.prog?.devices ?? []).filter((d) => d.address).map((d) => [d.address!.toUpperCase(), d.name]));
      const info = new Map((this.prog?.devices ?? []).map((d) => [d.name, d]));
      const dev = (a: string) => (dialect === 'st' ? byAddr.get(a.toUpperCase()) ?? a : normDevice(a, dialect));
      const net = (p: Part, i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
      for (const p of blocks) {
        const { ins, outs } = plcAddresses(p);
        const inDev = ins.map(dev);
        const outDev = outs.map(dev);
        this.plcs.push({
          part: p,
          inNets: ins.map((_, n) => net(p, n)),
          inDev,
          outDev,
          inAddr: ins,
          outAddr: outs,
          inName: inDev.map((d) => info.get(d)?.comment ?? ''),
          outName: outDev.map((d) => info.get(d)?.comment ?? ''),
        });
        for (let n = 0; n < PLC_IO; n++) this.conductors.push({ part: p, a: net(p, PLC_IO), b: net(p, PLC_IO + 1 + n), ia: PLC_IO, ib: PLC_IO + 1 + n, tag: tagKey(p), nc: false, always: false, plcOut: n });
      }
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

/** 배관으로 움직이는 실린더인가 (포트에 배관이 하나라도 있음) */
export function airDriven(m: CircuitModel, tag: string): boolean {
  const c = m.cylPorts.get(tag);
  return !!c && (c.capTubed || c.rodTubed);
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
  /** 배관이 막혀(5/3 가운데 등) 그 자리에 멈춤 */
  hold: boolean;
}

export class CircuitSim {
  t = 0;
  readonly act = new Map<string, boolean>();
  readonly coilOn = new Map<string, boolean>();
  readonly timers = new Map<string, { coil: boolean; out: boolean; since: number }>();
  /** 타임 스위치: 다이얼이 가리키는 시각 (하루 안의 ms), 접점, 시계가 도는 중 (전원이 있을 때만 돈다) */
  readonly tsw = new Map<string, { dial: number; out: boolean; run: boolean }>();
  readonly cyl = new Map<string, CylState>();
  /** 넷마다 닿은 극 ('short' = 단락, null = 전압 없음) */
  netPole: (string | null)[] = [];
  readonly energized = new Set<string>();
  readonly motorDir = new Map<string, 1 | -1>();
  readonly openPhase = new Set<string>();
  shorted = false;
  readonly plcIn = new Map<string, boolean[]>();
  readonly plcOut = new Map<string, boolean[]>();
  /** 3선식 센서·SMPS 에 전원이 들어와 있는가 */
  readonly powered = new Map<string, boolean>();
  /** 밸브 위치: a = 14쪽 솔레노이드, b = 12쪽(또는 스프링), c = 가운데 */
  readonly valvePos = new Map<string, 'a' | 'b' | 'c'>();
  /** 공압 넷마다 상태 (공압이 아닌 넷은 null) */
  airState: (AirState | null)[] = [];
  /** 속도 제어 밸브로 느려진 비율 (1 = 그대로) */
  readonly cylFactor = new Map<string, { ext: number; ret: number }>();
  private rt: PlcRuntime | null = null;
  private nextScan: number | null = null;
  private scanK = 0;
  /** 기록이 마지막으로 바뀐 시각 */
  lastChangeT = 0;
  readonly warnings: string[] = [];
  private readonly warned = new Set<string>();
  readonly tracks: Track[] = [];
  /** 상태를 기록할 때마다 불린다 (전기 해석이 그때의 전류를 계산) */
  onRecord?: () => void;

  constructor(readonly m: CircuitModel) {
    for (const [tag, k] of m.tagKind) if (k === 'operator' || k === 'thr') this.act.set(tag, m.operatorDefault.get(tag) ?? false);
    for (const tag of m.coilParts.keys()) this.coilOn.set(tag, false);
    for (const tag of m.timerParts.keys()) this.timers.set(tag, { coil: false, out: false, since: 0 });
    for (const [tag, d] of m.tswDef) this.tsw.set(tag, { dial: this.clock0, out: schedOn(d.sched, this.clock0), run: false });
    for (const tag of m.cylDef.keys()) this.cyl.set(tag, { pos: 0, target: 0, atPlus: false, atMinus: true, hold: false });
    for (const v of m.valves) this.valvePos.set(v.part.id, v.part.type === 'v53' ? 'c' : 'b');
    for (const b of m.plcs) {
      this.plcIn.set(b.part.id, new Array<boolean>(PLC_IO).fill(false));
      this.plcOut.set(b.part.id, new Array<boolean>(PLC_IO).fill(false));
    }
    m.plcIssues.forEach((w) => this.warn(w));
    if (m.prog && m.plcSim && m.plcs.length) {
      try {
        this.rt = m.prog.createRuntime(m.plcSim);
        this.nextScan = 0;
      } catch (e) {
        this.warn(`PLC 를 시작하지 못했습니다: ${(e as Error).message}`);
      }
    }
    this.buildTracks();
    this.settle();
    if (this.rt) {
      this.scanPlc();
      this.settle();
    }
    this.record();
  }

  /** 시뮬레이션을 시작한 시각 (하루 안의 ms) */
  get clock0(): number {
    const c = this.m.circuit.clock ?? 0;
    return ((c % DAY) + DAY) % DAY;
  }

  /** 지금 시각 (하루 안의 ms) */
  get clock(): number {
    return (this.clock0 + this.t) % DAY;
  }

  get hasPlc(): boolean {
    return this.rt !== null;
  }

  get scanTime(): number {
    return Math.max(0.1, this.m.plcSim?.scanTime ?? 10);
  }

  /** PLC 한 스캔: 입력 단자 전압 → 프로그램 → 출력 접점 */
  private scanPlc(): void {
    const rt = this.rt!;
    for (const b of this.m.plcs) {
      const ins = b.inNets.map((n) => {
        const p = this.netPole[n];
        return p === '+24V' || p === 'L1' || p === 'L2' || p === 'L3';
      });
      this.plcIn.set(b.part.id, ins);
      ins.forEach((v, i) => rt.writeBit(b.inDev[i], v));
    }
    rt.scan(this.t, this.scanK++);
    for (const b of this.m.plcs) this.plcOut.set(b.part.id, b.outDev.map((d) => rt.readBit(d)));
    this.nextScan = this.t + this.scanTime;
  }

  // ───────────── 상태 읽기 ─────────────

  /** 기호가 동작 중인가 (코일 여자, 타이머 출력, 스위치 눌림, 센서 감지) */
  on(tag: string): boolean {
    switch (this.m.tagKind.get(tag)) {
      case 'coil':
        return this.coilOn.get(tag) ?? false;
      case 'timer':
        return this.timers.get(tag)?.out ?? false;
      case 'tsw':
        return this.tsw.get(tag)?.out ?? false;
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
    if (p.type === 'fuse' || p.type === 'fuse3' || p.type === 'r_tb') return true;
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
    const pending = def.mode === 'on' ? st.coil && !st.out : def.mode === 'flicker' ? st.coil : !st.coil && st.out;
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

  /** 이 접점 (극) 이 지금 통하는가 */
  conductorClosed(c: Conductor): boolean {
    const closed = c.plcOut !== undefined ? !!this.plcOut.get(c.part.id)?.[c.plcOut] : c.always || (c.inst ? !!this.timers.get(c.tag)?.coil : this.on(c.tag)) !== c.nc;
    return closed && !(c.power && !this.powered.get(c.power));
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
      if (this.conductorClosed(c)) {
        const ra = find(c.a);
        const rb = find(c.b);
        if (ra !== rb) parent[ra] = rb;
      }
    }
    const poles = new Map<number, Set<string>>();
    const sources = [...this.m.sources];
    for (const s of this.m.smpsList) {
      if (!this.powered.get(s.part.id)) continue;
      sources.push({ net: s.outP, id: '+24V' }, { net: s.outM, id: '0V' });
    }
    for (const s of sources) {
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
      const def = PARTS[p.type];
      let nets = def.pins.map((_, i) => this.m.net.pinNet.get(`${p.id}:${i}`));
      if (def.selfCoil) nets = def.selfCoil.map((i) => nets[i]);
      if (p.type === 'motor3' || p.type === 'r_motor3' || p.type === 'r_load3') {
        const ph = nets.slice(0, 3).map(live);
        const idx = ph.map((x) => (x === 'L1' ? 0 : x === 'L2' ? 1 : x === 'L3' ? 2 : -1));
        const distinct = new Set(idx.filter((i) => i >= 0));
        if (distinct.size === 3) {
          this.energized.add(p.id);
          const [u, v] = idx;
          this.motorDir.set(p.id, (v - u + 3) % 3 === 1 ? 1 : -1);
        } else if (distinct.size === 2) {
          this.openPhase.add(p.id);
          this.warn(p.type === 'r_load3' ? `${p.tag || 'LD'}: 결상 - 두 상만 이어졌습니다` : `${p.tag || 'M'}: 결상 - 두 상만 이어져서 돌지 않습니다`, `open:${p.id}`);
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
      } else if (def.mode === 'flicker') st.out = want;
      else if (want) st.out = true;
      else if (def.preset <= 0) st.out = false;
      return true;
    }
    // 타임 스위치: 시계 전원, 다이얼 위치에 따른 접점
    for (const [tag, d] of this.m.tswDef) {
      const st = this.tsw.get(tag)!;
      const run = powerBetween(this.netPole[d.l], this.netPole[d.n]);
      if (run !== st.run) {
        st.run = run;
        return true;
      }
      const out = schedOn(d.sched, st.dial);
      if (out !== st.out) {
        st.out = out;
        return true;
      }
    }
    // 3선식 센서·SMPS 전원
    for (const s of this.m.proxs) {
      const want = powerBetween(this.netPole[s.bn], this.netPole[s.bu], true);
      if (want !== (this.powered.get(s.part.id) ?? false)) {
        this.powered.set(s.part.id, want);
        return true;
      }
    }
    for (const s of this.m.smpsList) {
      const want = powerBetween(this.netPole[s.inL], this.netPole[s.inN]);
      if (want !== (this.powered.get(s.part.id) ?? false)) {
        this.powered.set(s.part.id, want);
        return true;
      }
    }
    // 밸브 위치 (양솔은 마지막 위치 유지, 5/3 은 둘 다 꺼지면 가운데)
    for (const v of this.m.valves) {
      const a = !!v.solA && this.loadOn(v.solA);
      const b = !!v.solB && this.loadOn(v.solB);
      const cur = this.valvePos.get(v.part.id)!;
      let pos = cur;
      if (v.part.type === 'v32' || v.part.type === 'v52') pos = a ? 'a' : 'b';
      else if (a && !b) pos = 'a';
      else if (b && !a) pos = 'b';
      else if (v.part.type === 'v53' && !a && !b) pos = 'c';
      this.valvePos.set(v.part.id, pos);
    }
    const groupOf = this.evaluateAir();
    let jumped = false;
    for (const [tag, def] of this.m.cylDef) {
      const st = this.cyl.get(tag)!;
      let target = st.target;
      const ports = this.m.cylPorts.get(tag);
      if (ports && (ports.capTubed || ports.rodTubed)) {
        // 배관: 헤드 쪽 압력 → 전진, 로드 쪽 압력 → 후진. 로드 쪽 배관이 없으면 단동(스프링 복귀)
        const cap = ports.capTubed ? this.airState[ports.cap] : 'E';
        const rod = ports.rodTubed ? this.airState[ports.rod] : 'E';
        let drive: 0 | 1 | null = null;
        if (!ports.rodTubed) drive = cap === 'P' ? 1 : cap === 'E' ? 0 : null;
        else if (cap === 'P' && rod !== 'P') drive = 1;
        else if (rod === 'P' && cap !== 'P') drive = 0;
        // 양쪽이 막혔거나 양쪽에 압력: 그 자리에 멈춤
        st.hold = drive === null && st.pos !== st.target;
        if (drive !== null) target = drive;
        // 속도 제어(미터 아웃): 배기되는 쪽 배관에 있으면 그 방향이 느려진다
        const slow = (net: number, tubed: boolean) => {
          if (!tubed) return 1;
          const g = groupOf(net);
          return Math.min(1, ...this.m.flowCtrls.filter((f) => groupOf(f.net) === g).map((f) => f.speed / 100));
        };
        this.cylFactor.set(tag, { ext: rod !== 'P' ? slow(ports.rod, ports.rodTubed) : 1, ret: cap !== 'P' ? slow(ports.cap, ports.capTubed) : 1 });
      } else {
        const plus = def.solPlus ? this.loadOn(normTag(def.solPlus)) : false;
        const minus = def.solMinus ? this.loadOn(normTag(def.solMinus)) : false;
        if (def.solMinus?.trim()) {
          if (plus && !minus) target = 1;
          else if (minus && !plus) target = 0;
        } else target = plus ? 1 : 0;
      }
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
    const base = Math.max(0, target ? def.stroke ?? 1000 : def.strokeBack ?? def.stroke ?? 1000);
    const f = this.cylFactor.get(tagKey(def));
    return f ? base / Math.max(0.05, target ? f.ext : f.ret) : base;
  }

  /** 공압: 공압원에서 밸브 통로를 따라 압력이 닿는 곳, 밸브 배기구로 빠지는 곳 */
  private evaluateAir(): (net: number) => number {
    const m = this.m;
    const n = m.net.count;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const [a, b] of m.airAlways) union(a, b);
    const vents: number[] = [];
    for (const v of m.valves) {
      const pos = this.valvePos.get(v.part.id)!;
      if (v.part.type === 'v32') {
        // 2 = A, 1 = P: 켜지면 P→A, 꺼지면 A→배기
        if (pos === 'a') union(v.ports[1], v.ports[0]);
        else vents.push(v.ports[0]);
      } else {
        // 4 = A, 2 = B, 1 = P: a 위치 1→4 · 2 배기, b 위치 1→2 · 4 배기, c 모두 막힘
        if (pos === 'a') {
          union(v.ports[2], v.ports[0]);
          vents.push(v.ports[1]);
        } else if (pos === 'b') {
          union(v.ports[2], v.ports[1]);
          vents.push(v.ports[0]);
        }
      }
    }
    const press = new Set(m.airSrc.map(find));
    const vent = new Set(vents.map(find));
    this.airState = Array.from({ length: n }, (_, i) => {
      if (!m.airNets.has(i)) return null;
      const r = find(i);
      if (press.has(r)) {
        if (vent.has(r)) this.warn(`${formatTime(this.t, 's')}: 공압이 밸브 배기구로 새고 있습니다 (배관 확인)`, 'airleak');
        return 'P';
      }
      return vent.has(r) ? 'E' : 'X';
    });
    return find;
  }

  settle(): void {
    for (let i = 0; i < 400; i++) {
      this.evaluate();
      if (!this.stepOnce()) return;
    }
    this.warn(`${formatTime(this.t, 's')}: 릴레이가 계속 켜졌다 꺼졌다 합니다 (발진)`, 'osc');
  }

  /** 다음 사건 시각 (타이머 만료, 실린더 도착·끝 센서 벗어남, PLC 스캔) */
  nextEvent(withScan = true): number | null {
    let best = withScan && this.nextScan !== null ? this.nextScan : Infinity;
    for (const [tag, st] of this.timers) {
      const def = this.m.timerDef.get(tag)!;
      if ((def.mode === 'on' && st.coil && !st.out) || (def.mode === 'off' && !st.coil && st.out) || (def.mode === 'flicker' && st.coil && def.preset > 0)) best = Math.min(best, st.since + def.preset);
    }
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target || st.hold) continue;
      const time = this.strokeTime(this.m.cylDef.get(tag)!, st.target);
      best = Math.min(best, this.t + Math.abs(st.target - st.pos) * time);
      if (st.atPlus && st.target === 0) best = Math.min(best, this.t + Math.max(0, st.pos - (1 - SENSOR_BAND)) * time);
      if (st.atMinus && st.target === 1) best = Math.min(best, this.t + Math.max(0, SENSOR_BAND - st.pos) * time);
    }
    // 타임 스위치: 다이얼이 다음 켜짐·꺼짐 시각에 닿을 때
    for (const [tag, st] of this.tsw) {
      if (!st.run) continue;
      for (const b of this.m.tswDef.get(tag)!.sched.flat()) {
        const d = (b - st.dial + DAY) % DAY;
        if (d > 1e-3) best = Math.min(best, this.t + d);
      }
    }
    return best === Infinity ? null : Math.max(best, this.t);
  }

  private moveTo(t2: number): void {
    const dt = t2 - this.t;
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target || st.hold) continue;
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
    if (dt > 0) {
      for (const [tag, st] of this.tsw) {
        if (!st.run) continue;
        st.dial = (st.dial + dt) % DAY;
        // 켜짐·꺼짐 시각에 딱 맞춘다 (소수 오차로 한 사건을 놓치지 않게)
        for (const b of this.m.tswDef.get(tag)!.sched.flat()) if (Math.abs(st.dial - b) < 1e-3 || Math.abs(st.dial - b - DAY) < 1e-3) st.dial = b;
      }
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
        else if (def.mode === 'flicker' && st.coil && def.preset > 0) {
          st.out = !st.out;
          st.since += def.preset;
        }
      }
      if (this.nextScan !== null && this.nextScan <= this.t + EPS) {
        this.settle();
        this.scanPlc();
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
      } else if (k === 'tsw') add(`ts:${tag}`, tag, 'tsw');
    }
    for (const [tag, ids] of m.loadParts) {
      const k = m.tagKind.get(tag);
      if (k === 'coil' || k === 'timer') continue;
      const types = new Set(ids.map((id) => m.circuit.parts.find((p) => p.id === id)!.type));
      const motor = types.has('motor3') || types.has('motor') || types.has('r_motor3');
      const t = this.tracks.length;
      add(`${motor ? 'mot' : 'load'}:${tag}`, tag, motor ? 'motor' : 'load');
      this.tracks[t].part = m.circuit.parts.find((p) => p.id === ids[0])!;
    }
    for (const [tag, p] of m.cylDef) {
      this.tracks.push({ key: `cyl:${tag}`, tag: m.label(tag), kind: 'cyl', part: p, points: [], last: null });
    }
    // PLC: 선이 이어진 입출력 단자만
    const wired = (p: Part, i: number) => {
      const n = m.net.pinNet.get(`${p.id}:${i}`)!;
      return m.net.pinCount[n] > 1 || m.net.hasWire[n];
    };
    for (const b of m.plcs) {
      b.inAddr.forEach((a, n) => wired(b.part, n) && this.tracks.push({ key: `plcIn:${b.part.id}:${n}`, tag: a, kind: 'plcIn', part: b.part, points: [], last: null, idx: n }));
      b.outAddr.forEach((a, n) => wired(b.part, PLC_IO + 1 + n) && this.tracks.push({ key: `plcOut:${b.part.id}:${n}`, tag: a, kind: 'plcOut', part: b.part, points: [], last: null, idx: n }));
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
      case 'tsw':
        return this.tsw.get(tag)?.out ? 1 : 0;
      case 'load':
        return this.loadOn(tag) ? 1 : 0;
      case 'motor': {
        const ids = this.m.loadParts.get(tag) ?? [];
        const dir = ids.map((id) => this.motorDir.get(id)).find((d) => d !== undefined);
        return dir === undefined ? '0' : dir > 0 ? 'FWD' : 'REV';
      }
      case 'cyl':
        return this.cyl.get(tag)?.target ?? 0;
      case 'plcIn':
        return this.plcIn.get(tr.part.id)?.[tr.idx!] ? 1 : 0;
      case 'plcOut':
        return this.plcOut.get(tr.part.id)?.[tr.idx!] ? 1 : 0;
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
      if (tr.last !== null) this.lastChangeT = Math.max(this.lastChangeT, t);
      tr.last = v;
    }
    this.onRecord?.();
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
export function runScenario(c: Circuit, model: CircuitModel = new CircuitModel(c), hook?: (sim: CircuitSim) => void): ScenarioResult {
  const sim = new CircuitSim(model);
  if (hook) {
    hook(sim);
    sim.onRecord = () => hook(sim);
  }
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
  // 타임 스위치가 있으면 하루 단위로 (조작이 하루를 넘으면 그만큼 더)
  const days = model.tswDef.size && fixed === null ? Math.max(1, Math.ceil(lastOp / DAY + 1e-9)) * DAY : null;
  if (fixed !== null) sim.advanceTo(fixed);
  else if (days !== null) sim.advanceTo(days);
  else {
    // 마지막 조작 뒤: 타이머·실린더가 멈출 때까지 (최대 60초). PLC 는 늘 스캔하므로 20초 동안 바뀐 것이 없으면 멈춤
    const limit = lastOp + 60000;
    for (let i = 0; i < 200000; i++) {
      const next = sim.nextEvent();
      if (next === null || next > limit) break;
      if (sim.hasPlc && sim.nextEvent(false) === null && next > Math.max(lastOp, sim.lastChangeT) + 20000) break;
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
  return { model, tracks: sim.tracks, end: fixed ?? days ?? Math.max(sim.t, last), lastChange: last, warnings, times: opTimes(c.ops) };
}

/** 대표 부품의 종류 */
export function trackType(tr: Track): PartType {
  return tr.part.type;
}
