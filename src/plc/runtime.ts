import type { CmpOp, DeviceType, Instr, PlcDialect, SimSettings } from './types';
import { constValue, deviceType, isCounterDevice, isStepRelay, isTimerDevice, isWordDevice, mitsubishiTimerBase, specialBit } from './devices';

/** 시뮬레이터가 사용하는 PLC 런타임 공통 인터페이스 */
export interface PlcRuntime {
  readBit(d: string): boolean;
  writeBit(d: string, v: boolean): void;
  readWord(d: string): number;
  /** 설비 모델이 워드/카운터 현재값을 쓸 때 (엔코더 등) */
  writeWord(d: string, v: number): void;
  /** 트레이스용 값 (비트 → boolean, 워드 → number) */
  readValue(d: string): boolean | number;
  valueType(d: string): 'bit' | 'word';
  scan(t: number, scanIndex: number): void;
  warnings: string[];
}

export interface TimerState {
  kind: NonNullable<Instr['timer']> | 'TP';
  /** 계측 시작 시각 */
  since: number;
  /** 누적 시간 (적산 타이머) */
  acc: number;
  q: boolean;
  running: boolean;
  prevIn: boolean;
  lastT: number;
  presetMs: number;
  baseMs: number;
}

export function newTimer(kind: TimerState['kind'], baseMs = 100): TimerState {
  return { kind, since: 0, acc: 0, q: false, running: false, prevIn: false, lastT: 0, presetMs: 0, baseMs };
}

/** 타이머 1회 평가 (스캔 시각 t) */
export function runTimer(st: TimerState, input: boolean, presetMs: number, t: number): void {
  st.presetMs = presetMs;
  const rising = input && !st.prevIn;
  const falling = !input && st.prevIn;
  switch (st.kind) {
    case 'TON':
    case 'SD':
      if (input) {
        if (rising) st.since = t;
        st.q = t - st.since >= presetMs - 1e-9;
        st.running = !st.q;
      } else {
        st.q = false;
        st.running = false;
        st.since = t;
      }
      break;
    case 'TOF':
    case 'SF':
      if (input) {
        st.q = true;
        st.running = false;
        st.since = t;
      } else {
        if (falling) {
          st.running = true;
          st.since = t;
        }
        if (st.running && t - st.since >= presetMs - 1e-9) {
          st.running = false;
          st.q = false;
        }
      }
      break;
    case 'TMR': // 적산 타이머 (RST 로만 리셋)
      if (input && st.prevIn) st.acc += t - st.lastT;
      st.q = st.acc >= presetMs - 1e-9;
      st.running = input && !st.q;
      break;
    case 'SS': // 지멘스 적산 온딜레이 (상승 시 시작, R 로만 리셋)
      if (rising) {
        st.running = true;
        st.since = t;
      }
      if (st.running && t - st.since >= presetMs - 1e-9) {
        st.q = true;
        st.running = false;
      }
      break;
    case 'TMON':
    case 'TP': // 비재트리거 단안정 펄스
      if (rising && !st.running) {
        st.running = true;
        st.since = t;
      }
      if (st.running && t - st.since >= presetMs - 1e-9) st.running = false;
      st.q = st.running;
      break;
    case 'TRTG':
    case 'SE': // 재트리거 단안정 (확장 펄스)
      if (rising) {
        st.running = true;
        st.since = t;
      }
      if (st.running && t - st.since >= presetMs - 1e-9) st.running = false;
      st.q = st.running;
      break;
    case 'SP': // 펄스 타이머: 입력이 유지되는 동안만 최대 preset
      if (rising) {
        st.running = true;
        st.since = t;
      }
      if (!input) st.running = false;
      if (st.running && t - st.since >= presetMs - 1e-9) st.running = false;
      st.q = st.running;
      break;
  }
  st.prevIn = input;
  st.lastT = t;
}

export function timerElapsed(st: TimerState, t: number): number {
  if (st.kind === 'TMR') return Math.min(st.acc, st.presetMs || st.acc);
  if (st.kind === 'TON' || st.kind === 'SD') return st.prevIn ? Math.min(t - st.since, st.presetMs) : 0;
  if (st.running) return Math.min(t - st.since, st.presetMs);
  return st.q && (st.kind === 'SS') ? st.presetMs : 0;
}

export function resetTimer(st: TimerState): void {
  st.q = false;
  st.running = false;
  st.acc = 0;
  st.since = st.lastT;
}

export interface CounterState {
  cv: number;
  q: boolean;
  prevIn: boolean;
  preset: number;
  init: boolean;
}

function cmp(a: number, b: number, op: CmpOp): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
  }
}

/** 비트/워드 메모리 */
export class Memory {
  bits = new Map<string, boolean>();
  words = new Map<string, number>();
  scanIndex = 0;
  t = 0;
  constructor(public dialect: PlcDialect) {}

  private bitOfWord(d: string): [string, number] | null {
    if (this.dialect !== 'mitsubishi' && this.dialect !== 'ls') return null;
    const m = /^(.+)\.([0-9A-F])$/.exec(d);
    if (!m || !isWordDevice(m[1], this.dialect)) return null;
    return [m[1], parseInt(m[2], 16)];
  }

  getBit(d: string): boolean {
    const sp = specialBit(d, this.dialect, this.scanIndex, this.t);
    if (sp !== undefined) return sp;
    const bw = this.bitOfWord(d);
    if (bw) return ((this.getWord(bw[0]) >> bw[1]) & 1) === 1;
    return this.bits.get(d) ?? false;
  }

  setBit(d: string, v: boolean): void {
    const bw = this.bitOfWord(d);
    if (bw) {
      const w = this.getWord(bw[0]);
      this.setWord(bw[0], v ? w | (1 << bw[1]) : w & ~(1 << bw[1]));
      return;
    }
    this.bits.set(d, v);
  }

  getWord(d: string): number {
    return this.words.get(d) ?? 0;
  }

  setWord(d: string, v: number): void {
    this.words.set(d, Number.isFinite(v) ? v : 0);
  }
}

/** 디바이스 범위 전개 (ZRST M0 M10 → M0..M10) */
function expandRange(a: string, b: string): string[] {
  const ma = /^([A-Z]+)(\d+)$/.exec(a);
  const mb = /^([A-Z]+)(\d+)$/.exec(b);
  if (!ma || !mb || ma[1] !== mb[1]) return [a, b];
  const s = parseInt(ma[2], 10);
  const e = parseInt(mb[2], 10);
  const out: string[] = [];
  for (let i = Math.min(s, e); i <= Math.max(s, e) && out.length < 4096; i++) out.push(ma[1] + i);
  return out;
}

/**
 * 미쓰비시 / LS 니모닉 실행기 (래더 스택 머신)
 */
export class IlRuntime implements PlcRuntime {
  mem: Memory;
  timers = new Map<string, TimerState>();
  counters = new Map<string, CounterState>();
  edgeMem = new Map<number, boolean>();
  stlWasActive = new Map<number, boolean>();
  warnings: string[] = [];
  private warned = new Set<string>();
  private t = 0;

  constructor(
    private instrs: Instr[],
    private labels: Map<string, number>,
    private dialect: 'mitsubishi' | 'ls',
    private settings: Pick<SimSettings, 'timerBase' | 'mitsubishiSeries'>,
  ) {
    this.mem = new Memory(dialect);
  }

  private warn(msg: string) {
    if (!this.warned.has(msg) && this.warned.size < 50) {
      this.warned.add(msg);
      this.warnings.push(msg);
    }
  }

  valueType(d: string): 'bit' | 'word' {
    const ty: DeviceType = deviceType(d, this.dialect);
    return ty === 'word' ? 'word' : 'bit';
  }

  readValue(d: string): boolean | number {
    return this.valueType(d) === 'word' ? this.readWord(d) : this.readBit(d);
  }

  readBit(d: string): boolean {
    if (isTimerDevice(d, this.dialect)) return this.timers.get(d)?.q ?? false;
    if (isCounterDevice(d, this.dialect)) return this.counters.get(d)?.q ?? false;
    return this.mem.getBit(d);
  }

  writeBit(d: string, v: boolean): void {
    this.mem.setBit(d, v);
  }

  writeWord(d: string, v: number): void {
    if (isCounterDevice(d, this.dialect)) {
      let c = this.counters.get(d);
      if (!c) {
        c = { cv: 0, q: false, prevIn: false, preset: 0, init: true };
        this.counters.set(d, c);
      }
      c.cv = Math.trunc(v);
      return;
    }
    if (isTimerDevice(d, this.dialect)) return;
    this.mem.setWord(d, Math.trunc(v));
  }

  readWord(d: string): number {
    const c = constValue(d);
    if (c) return c.value;
    if (isTimerDevice(d, this.dialect)) {
      const st = this.timers.get(d);
      return st ? Math.floor(timerElapsed(st, this.t) / st.baseMs) : 0;
    }
    if (isCounterDevice(d, this.dialect)) return this.counters.get(d)?.cv ?? 0;
    return this.mem.getWord(d);
  }

  private timerBaseFor(d: string, ins: Instr): number {
    if (ins.timerBase) return ins.timerBase;
    if (this.dialect === 'mitsubishi') return mitsubishiTimerBase(d, this.settings.mitsubishiSeries, this.settings.timerBase);
    return this.settings.timerBase;
  }

  private presetMs(arg: string | undefined, base: number): number {
    if (!arg) return 0;
    const c = constValue(arg);
    if (c) return c.isTime ? c.value : c.value * base;
    return this.readWord(arg) * base;
  }

  private edge(pc: number, v: boolean, kind: 'P' | 'F'): boolean {
    const prev = this.edgeMem.get(pc) ?? false;
    this.edgeMem.set(pc, v);
    return kind === 'P' ? v && !prev : !v && prev;
  }

  scan(t: number, scanIndex: number): void {
    this.t = t;
    this.mem.t = t;
    this.mem.scanIndex = scanIndex;
    const ins = this.instrs;
    let acc = false;
    let blockStack: boolean[] = [];
    const mps: boolean[] = [];
    let lastWasOut = true;
    const mc: { level: string; prev: boolean }[] = [];
    let mcEnable = true;
    let stlDev: string | null = null;
    let stlIndex = -1;
    let stlOn = true;
    let skip = false;
    let guard = 0;
    const enabled = () => mcEnable && stlOn;

    for (let pc = 0; pc < ins.length; pc++) {
      if (++guard > 200000) {
        this.warn('스캔당 명령 실행 한도 초과 (무한 점프 의심)');
        break;
      }
      const I = ins[pc];
      const op = I.op;
      if (skip && op !== 'STL' && op !== 'RET' && op !== 'END' && op !== 'FEND') continue;

      switch (op) {
        case 'LD':
        case 'AND':
        case 'OR': {
          let v: boolean;
          if (I.cmp) v = cmp(this.readWord(I.args[0]), this.readWord(I.args[1]), I.cmp);
          else {
            v = this.readBit(I.args[0]);
            if (I.edge) v = this.edge(pc, v, I.edge);
          }
          if (I.neg) v = !v;
          if (op === 'LD') {
            if (lastWasOut && mps.length === 0) blockStack = [];
            blockStack.push(acc);
            acc = v;
          } else if (op === 'AND') acc = acc && v;
          else acc = acc || v;
          lastWasOut = false;
          break;
        }
        case 'ANB':
          acc = (blockStack.pop() ?? true) && acc;
          break;
        case 'ORB':
          acc = (blockStack.pop() ?? false) || acc;
          break;
        case 'MPS':
          mps.push(acc);
          break;
        case 'MRD':
          acc = mps[mps.length - 1] ?? acc;
          break;
        case 'MPP':
          acc = mps.pop() ?? acc;
          break;
        case 'INV':
          acc = !acc;
          break;
        case 'MEP':
          acc = this.edge(pc, acc, 'P');
          break;
        case 'MEF':
          acc = this.edge(pc, acc, 'F');
          break;
        case 'OUT': {
          const d = I.args[0];
          let v = enabled() ? acc : false;
          if (I.neg && enabled()) v = !v;
          if (isStepRelay(d) && stlDev) {
            // STL 블록 내 OUT S = 스텝 전이 (조건 OFF 시 아무 동작 안 함)
            if (v) {
              this.mem.setBit(d, true);
              if (d !== stlDev) this.mem.setBit(stlDev, false);
            }
          } else this.mem.setBit(d, v);
          lastWasOut = true;
          break;
        }
        case 'SET': {
          const d = I.args[0];
          if (enabled() && acc) {
            this.mem.setBit(d, true);
            if (stlDev && isStepRelay(d) && d !== stlDev) this.mem.setBit(stlDev, false);
          }
          lastWasOut = true;
          break;
        }
        case 'RST': {
          const d = I.args[0];
          if (enabled() && acc) {
            if (isTimerDevice(d, this.dialect)) {
              const st = this.timers.get(d);
              if (st) resetTimer(st);
            } else if (isCounterDevice(d, this.dialect)) {
              const c = this.counters.get(d);
              if (c) {
                c.cv = this.isCtd(d) ? c.preset : 0;
                c.q = false;
              }
            } else if (isWordDevice(d, this.dialect)) this.mem.setWord(d, 0);
            else this.mem.setBit(d, false);
          }
          lastWasOut = true;
          break;
        }
        case 'PLS':
        case 'PLF': {
          const v = enabled() && acc;
          this.mem.setBit(I.args[0], this.edge(pc, v, op === 'PLS' ? 'P' : 'F'));
          lastWasOut = true;
          break;
        }
        case 'ALT': {
          const v = enabled() && acc;
          if (this.edge(pc, v, 'P')) this.mem.setBit(I.args[0], !this.mem.getBit(I.args[0]));
          lastWasOut = true;
          break;
        }
        case 'TMR': {
          const d = I.args[0];
          const base = this.timerBaseFor(d, I);
          let st = this.timers.get(d);
          if (!st) {
            st = newTimer(I.timer ?? 'TON', base);
            this.timers.set(d, st);
          }
          runTimer(st, enabled() && acc, this.presetMs(I.args[1], base), t);
          lastWasOut = true;
          break;
        }
        case 'CTU':
        case 'CTD': {
          const d = I.args[0];
          const preset = this.readWord(I.args[1]);
          let c = this.counters.get(d);
          if (!c) {
            c = { cv: op === 'CTD' ? preset : 0, q: false, prevIn: false, preset, init: true };
            this.counters.set(d, c);
            if (op === 'CTD') this.ctd.add(d);
          }
          c.preset = preset;
          const input = enabled() && acc;
          if (input && !c.prevIn) {
            if (op === 'CTU') c.cv = Math.min(c.cv + 1, 2147483647);
            else c.cv = Math.max(c.cv - 1, 0);
          }
          c.prevIn = input;
          c.q = op === 'CTU' ? c.cv >= preset : c.cv <= 0;
          lastWasOut = true;
          break;
        }
        case 'MOV':
        case 'INC':
        case 'DEC':
        case 'ADD':
        case 'SUB':
        case 'MUL':
        case 'DIV':
        case 'ZRST':
        case 'FMOV': {
          let run = enabled() && acc;
          if (I.pulse) run = this.edge(pc, run, 'P');
          lastWasOut = true;
          if (!run) break;
          this.execWord(I);
          break;
        }
        case 'MC': {
          mc.push({ level: I.args[0] ?? '', prev: mcEnable });
          if (I.args[1]) this.mem.setBit(I.args[1], acc && mcEnable);
          mcEnable = mcEnable && acc;
          lastWasOut = true;
          break;
        }
        case 'MCR': {
          const level = I.args[0] ?? '';
          while (mc.length) {
            const top = mc.pop()!;
            mcEnable = top.prev;
            if (top.level === level) break;
          }
          lastWasOut = true;
          break;
        }
        case 'STL': {
          if (stlIndex >= 0) this.stlWasActive.set(stlIndex, stlOn);
          stlDev = I.args[0];
          stlIndex = pc;
          stlOn = this.mem.getBit(stlDev);
          // 비활성 스텝: 직전 스캔에 활성이었으면 한 번 실행(출력 OFF), 아니면 건너뜀
          skip = !stlOn && !(this.stlWasActive.get(pc) ?? false);
          acc = true;
          blockStack = [];
          mps.length = 0;
          lastWasOut = true;
          break;
        }
        case 'RET':
          if (stlIndex >= 0) this.stlWasActive.set(stlIndex, stlOn);
          stlDev = null;
          stlIndex = -1;
          stlOn = true;
          skip = false;
          lastWasOut = true;
          break;
        case 'JMP': {
          let run = enabled() && acc;
          if (I.pulse) run = this.edge(pc, run, 'P');
          if (run) {
            const target = this.labels.get(I.args[0]);
            if (target === undefined) this.warn(`점프 대상 라벨 ${I.args[0]} 없음`);
            else pc = target - 1;
          }
          lastWasOut = true;
          break;
        }
        case 'END':
        case 'FEND':
          pc = ins.length;
          break;
        case 'NOP':
          break;
        default:
          this.warn(`실행할 수 없는 명령: ${op}`);
      }
    }
    if (stlIndex >= 0) this.stlWasActive.set(stlIndex, stlOn);
  }

  private ctd = new Set<string>();
  private isCtd(d: string): boolean {
    return this.ctd.has(d);
  }

  private writeWordDest(d: string, v: number) {
    if (isTimerDevice(d, this.dialect) || isCounterDevice(d, this.dialect)) {
      const c = this.counters.get(d);
      if (c) c.cv = v;
      return;
    }
    this.mem.setWord(d, Math.trunc(v));
  }

  private execWord(I: Instr) {
    const a = I.args;
    const r = (i: number) => this.readWord(a[i]);
    switch (I.op) {
      case 'MOV':
        this.writeWordDest(a[1], r(0));
        break;
      case 'INC':
        this.writeWordDest(a[0], r(0) + 1);
        break;
      case 'DEC':
        this.writeWordDest(a[0], r(0) - 1);
        break;
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV': {
        // 3 오퍼랜드: S1 S2 D, 2 오퍼랜드: S D (D = D op S)
        const [x, y, dest] = a.length >= 3 ? [r(0), r(1), a[2]] : [r(1), r(0), a[1]];
        const v = I.op === 'ADD' ? x + y : I.op === 'SUB' ? x - y : I.op === 'MUL' ? x * y : y === 0 ? 0 : Math.trunc(x / y);
        if (I.op === 'DIV' && y === 0) this.warn('0 으로 나누기');
        this.writeWordDest(dest, v);
        break;
      }
      case 'ZRST':
        for (const d of expandRange(a[0], a[1] ?? a[0])) {
          if (isWordDevice(d, this.dialect)) this.mem.setWord(d, 0);
          else if (isTimerDevice(d, this.dialect)) {
            const st = this.timers.get(d);
            if (st) resetTimer(st);
          } else if (isCounterDevice(d, this.dialect)) {
            const c = this.counters.get(d);
            if (c) {
              c.cv = 0;
              c.q = false;
            }
          } else this.mem.setBit(d, false);
        }
        break;
      case 'FMOV': {
        const v = r(0);
        const m = /^([A-Z]+)(\d+)$/.exec(a[1] ?? '');
        const n = r(2);
        if (m) for (let i = 0; i < Math.min(n, 4096); i++) this.mem.setWord(m[1] + (parseInt(m[2], 10) + i), v);
        break;
      }
    }
  }
}

/**
 * 지멘스 STL 실행기 (RLO / First-Check / 괄호 스택 / 누산기)
 */
export class StlRuntime implements PlcRuntime {
  mem = new Memory('siemens');
  timers = new Map<string, TimerState>();
  counters = new Map<string, CounterState & { prevCu: boolean; prevCd: boolean; prevS: boolean }>();
  edgeMem = new Map<number, boolean>();
  warnings: string[] = [];
  private warned = new Set<string>();
  private t = 0;

  constructor(
    private instrs: Instr[],
    private labels: Map<string, number>,
  ) {}

  private warn(msg: string) {
    if (!this.warned.has(msg) && this.warned.size < 50) {
      this.warned.add(msg);
      this.warnings.push(msg);
    }
  }

  valueType(d: string): 'bit' | 'word' {
    return /^(M|I|Q|PI|PQ|L)[BWD]\d+|\.DB[BWD]\d+$/.test(d) ? 'word' : 'bit';
  }

  readValue(d: string): boolean | number {
    return this.valueType(d) === 'word' ? this.readWord(d) : this.readBit(d);
  }

  readBit(d: string): boolean {
    if (/^T\d+$/.test(d)) return this.timers.get(d)?.q ?? false;
    if (/^C\d+$/.test(d)) return (this.counters.get(d)?.cv ?? 0) > 0;
    return this.mem.getBit(d);
  }

  writeBit(d: string, v: boolean): void {
    this.mem.setBit(d, v);
  }

  writeWord(d: string, v: number): void {
    if (/^C\d+$/.test(d)) this.counter(d).cv = Math.trunc(v);
    else if (!/^T\d+$/.test(d)) this.mem.setWord(d, Math.trunc(v));
  }

  readWord(d: string): number {
    const c = constValue(d);
    if (c) return c.value;
    if (/^T\d+$/.test(d)) {
      const st = this.timers.get(d);
      return st ? Math.max(0, st.presetMs - timerElapsed(st, this.t)) : 0;
    }
    if (/^C\d+$/.test(d)) return this.counters.get(d)?.cv ?? 0;
    return this.mem.getWord(d);
  }

  private counter(d: string) {
    let c = this.counters.get(d);
    if (!c) {
      c = { cv: 0, q: false, prevIn: false, preset: 0, init: true, prevCu: false, prevCd: false, prevS: false };
      this.counters.set(d, c);
    }
    return c;
  }

  scan(t: number, scanIndex: number): void {
    this.t = t;
    this.mem.t = t;
    this.mem.scanIndex = scanIndex;
    let fc = false; // First Check: true 이면 논리 연산이 이어지는 중
    let andAcc = false;
    let orAcc = false;
    let pendingOr = false;
    let acc1 = 0;
    let acc2 = 0;
    const nest: { op: string; andAcc: boolean; orAcc: boolean; fc: boolean; pendingOr: boolean }[] = [];
    const rlo = () => orAcc || andAcc;
    const logic = (op: string, v: boolean) => {
      const neg = op.endsWith('N');
      if (neg) v = !v;
      const base = neg ? op.slice(0, -1) : op;
      if (!fc) {
        if (!pendingOr) orAcc = false;
        pendingOr = false;
        andAcc = v;
        fc = true;
        return;
      }
      if (base === 'A') andAcc = andAcc && v;
      else if (base === 'O') {
        andAcc = rlo() || v;
        orAcc = false;
      } else if (base === 'X') {
        andAcc = rlo() !== v;
        orAcc = false;
      }
    };
    const setRlo = (v: boolean) => {
      andAcc = v;
      orAcc = false;
    };
    let guard = 0;
    const ins = this.instrs;
    for (let pc = 0; pc < ins.length; pc++) {
      if (++guard > 200000) {
        this.warn('스캔당 명령 실행 한도 초과 (무한 점프 의심)');
        break;
      }
      const I = ins[pc];
      const a0 = I.args[0];
      switch (I.op) {
        case 'NET':
          fc = false;
          pendingOr = false;
          nest.length = 0;
          break;
        case 'A':
        case 'AN':
        case 'O':
        case 'ON':
        case 'X':
        case 'XN':
          logic(I.op, this.readBit(a0));
          break;
        case 'A(':
        case 'AN(':
        case 'O(':
        case 'ON(':
        case 'X(':
        case 'XN(':
          nest.push({ op: I.op.slice(0, -1), andAcc, orAcc, fc, pendingOr });
          fc = false;
          pendingOr = false;
          orAcc = false;
          andAcc = false;
          break;
        case ')': {
          const inner = rlo();
          const f = nest.pop();
          if (!f) {
            this.warn(`줄 ${I.line}: 여는 괄호 없는 ")"`);
            break;
          }
          andAcc = f.andAcc;
          orAcc = f.orAcc;
          fc = f.fc;
          pendingOr = f.pendingOr;
          logic(f.op, inner);
          break;
        }
        case 'O_':
          orAcc = rlo();
          andAcc = false;
          fc = false;
          pendingOr = true;
          break;
        case 'NOT':
          setRlo(!rlo());
          break;
        case 'SET':
          setRlo(true);
          fc = false;
          break;
        case 'CLR':
          setRlo(false);
          fc = false;
          break;
        case 'SAVE':
        case 'NOP':
          break;
        case 'FP':
        case 'FN': {
          const r = rlo();
          const prev = this.mem.getBit(a0);
          this.mem.setBit(a0, r);
          setRlo(I.op === 'FP' ? r && !prev : !r && prev);
          fc = true;
          break;
        }
        case '=':
          this.mem.setBit(a0, rlo());
          fc = false;
          break;
        case 'S':
          if (/^C\d+$/.test(a0)) {
            const c = this.counter(a0);
            if (rlo() && !c.prevS) c.cv = acc1;
            c.prevS = rlo();
          } else if (rlo()) this.mem.setBit(a0, true);
          fc = false;
          break;
        case 'R':
          if (rlo()) {
            if (/^T\d+$/.test(a0)) {
              const st = this.timers.get(a0);
              if (st) resetTimer(st);
            } else if (/^C\d+$/.test(a0)) this.counter(a0).cv = 0;
            else this.mem.setBit(a0, false);
          }
          fc = false;
          break;
        case 'SD':
        case 'SE':
        case 'SP':
        case 'SS':
        case 'SF': {
          let st = this.timers.get(a0);
          if (!st || st.kind !== I.op) {
            st = newTimer(I.op as TimerState['kind'], 10);
            this.timers.set(a0, st);
          }
          runTimer(st, rlo(), acc1, t);
          fc = false;
          break;
        }
        case 'CU':
        case 'CD': {
          const c = this.counter(a0);
          const r = rlo();
          if (I.op === 'CU') {
            if (r && !c.prevCu) c.cv = Math.min(c.cv + 1, 999);
            c.prevCu = r;
          } else {
            if (r && !c.prevCd) c.cv = Math.max(c.cv - 1, 0);
            c.prevCd = r;
          }
          fc = false;
          break;
        }
        case 'L':
          acc2 = acc1;
          acc1 = this.readWord(a0);
          break;
        case 'T':
          this.mem.setWord(a0, acc1);
          break;
        case 'INC':
          acc1 += Number(a0) || 1;
          break;
        case 'DEC':
          acc1 -= Number(a0) || 1;
          break;
        case 'JU':
        case 'JMP':
        case 'JC':
        case 'JCN': {
          const r = rlo();
          const go = I.op === 'JU' || I.op === 'JMP' || (I.op === 'JC' ? r : !r);
          if (I.op !== 'JU' && I.op !== 'JMP') {
            fc = false;
            setRlo(true);
          }
          if (go) {
            const target = this.labels.get(a0);
            if (target === undefined) this.warn(`점프 대상 라벨 ${a0} 없음`);
            else pc = target - 1;
          }
          break;
        }
        case 'BE':
        case 'BEU':
          pc = ins.length;
          break;
        case 'BEC':
          if (rlo()) pc = ins.length;
          fc = false;
          setRlo(true);
          break;
        default: {
          const cm = /^(==|<>|>=|<=|>|<)([IDR])$/.exec(I.op);
          if (cm) {
            const op = (cm[1] === '==' ? '=' : cm[1]) as CmpOp;
            logic('A', cmp(acc2, acc1, op));
            break;
          }
          const ar = /^([+\-*/])([IDR])$/.exec(I.op);
          if (ar) {
            const x = acc2;
            const y = acc1;
            acc1 = ar[1] === '+' ? x + y : ar[1] === '-' ? x - y : ar[1] === '*' ? x * y : y === 0 ? 0 : ar[2] === 'R' ? x / y : Math.trunc(x / y);
            break;
          }
          this.warn(`실행할 수 없는 명령: ${I.op}`);
        }
      }
    }
  }
}
