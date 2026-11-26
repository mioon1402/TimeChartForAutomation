import type { CableSpec, Circuit, OpStep, Part, PartType, Wire, WireColor } from './types';
import { uid } from '../model/wave';
import { tr } from '../i18n';
import { defaultSimSettings, type PlcConfig } from '../plc/types';
import { ilToLadder } from '../plc/ladder';
import { partPins } from './parts';
import { routeAll, type RouteDev } from './realize';

/** 예제 회로를 좌표로 적기 위한 도우미 */
class Builder {
  parts: Part[] = [];
  wires: Wire[] = [];
  ops: OpStep[] = [];

  part(type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}): Part {
    const p: Part = { id: uid('cp'), type, x, y, rot: 0, tag, ...extra };
    this.parts.push(p);
    return p;
  }

  /** 꺾인 선: 점을 차례로 잇는다 */
  wire(...pts: [number, number][]): void {
    for (let i = 1; i < pts.length; i++) this.wires.push({ id: uid('cw'), a: pts[i - 1], b: pts[i] });
  }

  /** 색이 있는 실제 전선 */
  cable(color: WireColor, ...pts: [number, number][]): void {
    for (let i = 1; i < pts.length; i++) this.wires.push({ id: uid('cw'), a: pts[i - 1], b: pts[i], color });
  }

  /** 케이블 규격이 있는 전선 (꺾인 한 가닥 전체가 그 규격 · 길이) */
  run(color: WireColor, spec: CableSpec | undefined, ...pts: [number, number][]): void {
    for (let i = 1; i < pts.length; i++) this.wires.push({ id: uid('cw'), a: pts[i - 1], b: pts[i], color, ...(spec ? { cable: { ...spec } } : {}) });
  }

  op(wait: number, tag: string, action: OpStep['action'] = 'press', note = '', hold = 300): void {
    this.ops.push({ id: uid('op'), wait, tag, action, hold, ...(note ? { note } : {}) });
  }

  /** 온도 기기의 온도를 value ℃ 로 (over ms 동안 일정하게, 0 이면 바로) */
  temp(wait: number, tag: string, value: number, over = 0, note = ''): void {
    this.ops.push({ id: uid('op'), wait, tag, action: 'temp', value, hold: over, ...(note ? { note } : {}) });
  }

  done(): Circuit {
    return { parts: this.parts, wires: this.wires, ops: this.ops };
  }
}

/** 3상 주회로: 전원 → MCCB → MC 주접점 → THR → 전동기 (x 2,4,6) */
function powerCircuit(b: Builder): void {
  b.part('src3', 4, 1);
  b.part('mcb3', 4, 5, 'MCCB', { name: tr('주 차단기', 'Main breaker') });
  b.part('km3', 4, 11, 'MC1');
  b.part('ol3', 4, 17, 'THR', { name: tr('과부하 보호', 'Overload') });
  b.part('motor3', 4, 22, 'M1', { name: tr('전동기', 'Motor') });
  for (const x of [2, 4, 6]) {
    b.wire([x, 2], [x, 3]);
    b.wire([x, 7], [x, 9]);
    b.wire([x, 13], [x, 15]);
    b.wire([x, 19], [x, 20]);
  }
}

/**
 * 센서 감지 → 솔밸브 3초만 (인터벌 타이머): 감지하면 T1 이 바로 켜지고 3초 뒤 꺼진다 (계속 감지하고 있어도).
 * 감지가 3초보다 짧으면 그때 꺼진다. 다시 감지하면 처음부터.
 */
function sensorOneShot(): Circuit {
  const b = new Builder();
  b.part('src', 1, 2, '', { pole: '+24V' });
  b.part('src', 1, 27, '', { pole: '0V' });
  b.wire([1, 2], [12, 2]);
  b.wire([1, 27], [12, 27]);
  // 렁 1: PX1 (2선식 근접) → T1 (인터벌 3초)
  b.part('ls_no', 4, 8, 'PX1', { name: tr('제품 감지', 'Part present'), sense: 'inductive' });
  b.part('timer', 4, 23, 'T1', { name: tr('분사 시간', 'Blow time'), timerMode: 'interval', preset: 3000 });
  b.wire([4, 2], [4, 6]);
  b.wire([4, 10], [4, 21]);
  b.wire([4, 25], [4, 27]);
  // 렁 2: T1 a → SOL1
  b.part('no', 12, 8, 'T1');
  b.part('sol', 12, 23, 'SOL1', { name: tr('에어 블로', 'Air blow') });
  b.wire([12, 2], [12, 6]);
  b.wire([12, 10], [12, 21]);
  b.wire([12, 25], [12, 27]);
  b.part('text', 1, -1, '', { text: tr('센서 감지 → 솔밸브 3초만: 인터벌 (원샷) 타이머. 계속 감지해도 3초 뒤 꺼지고, 다시 감지하면 처음부터', 'Sensor → solenoid for 3 s with an interval (one-shot) timer') });
  b.op(1000, 'PX1', 'on', tr('감지 (계속)', 'Detects (held)'));
  b.op(5000, 'PX1', 'off', tr('해제', 'Clear'));
  b.op(2000, 'PX1', 'on', tr('짧게 감지', 'Short detection'));
  b.op(1000, 'PX1', 'off', tr('해제', 'Clear'));
  return b.done();
}

/** 자기유지: 기동 PB → MC1 자기유지 → 전동기 운전, 운전·정지 표시등 */
function selfHold(): Circuit {
  const b = new Builder();
  powerCircuit(b);
  // 제어 회로: L(위) ~ N(아래)
  b.part('src', 11, 2, '', { pole: 'L' });
  b.part('src', 11, 27, '', { pole: 'N' });
  b.wire([11, 2], [27, 2]);
  b.wire([11, 27], [27, 27]);
  // 렁 1: THR b → 정지 PB0 → 기동 PB1 (∥ MC1 a) → MC1 코일
  b.part('nc', 14, 5, 'THR');
  b.part('pb_nc', 14, 10, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('pb_no', 14, 15, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('no', 18, 15, 'MC1');
  b.part('coil', 14, 23, 'MC1', { name: tr('전동기 운전', 'Motor run') });
  b.wire([14, 2], [14, 3]);
  b.wire([14, 7], [14, 8]);
  b.wire([14, 12], [14, 13]);
  b.wire([14, 13], [18, 13]);
  b.wire([14, 17], [18, 17]);
  b.wire([14, 17], [14, 21]);
  b.wire([14, 25], [14, 27]);
  // 렁 2: MC1 a → 운전 표시등 GL
  b.part('no', 22, 15, 'MC1');
  b.part('lamp', 22, 23, 'GL', { name: tr('운전 표시', 'Running'), color: 'green' });
  b.wire([22, 2], [22, 13]);
  b.wire([22, 17], [22, 21]);
  b.wire([22, 25], [22, 27]);
  // 렁 3: MC1 b → 정지 표시등 RL
  b.part('nc', 27, 15, 'MC1');
  b.part('lamp', 27, 23, 'RL', { name: tr('정지 표시', 'Stopped'), color: 'red' });
  b.wire([27, 2], [27, 13]);
  b.wire([27, 17], [27, 21]);
  b.wire([27, 25], [27, 27]);
  b.part('text', 11, -1, '', { text: tr('자기유지 회로 (기동 · 정지)', 'Self-holding circuit (start / stop)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/** 정역 운전: MC1 정회전 · MC2 역회전, 서로 b접점 인터록, 주회로 L1↔L3 교체 */
function reversing(): Circuit {
  const b = new Builder();
  b.part('src3', 4, 1);
  b.part('mcb3', 4, 5, 'MCCB', { name: tr('주 차단기', 'Main breaker') });
  b.part('km3', 4, 13, 'MC1', { name: tr('정회전', 'Forward') });
  b.part('km3', 12, 13, 'MC2', { name: tr('역회전', 'Reverse') });
  b.part('ol3', 4, 21, 'THR');
  b.part('motor3', 4, 26, 'M1', { name: tr('전동기', 'Motor') });
  for (const x of [2, 4, 6]) b.wire([x, 2], [x, 3]);
  b.wire([2, 7], [2, 11]);
  b.wire([4, 7], [4, 11]);
  b.wire([6, 7], [6, 11]);
  // MC2 로 가는 분기 (높이를 달리해 엇갈림)
  b.wire([2, 8], [10, 8], [10, 11]);
  b.wire([4, 9], [12, 9], [12, 11]);
  b.wire([6, 10], [14, 10], [14, 11]);
  // MC1 → THR 바로, MC2 → THR 는 L1 과 L3 을 바꿔서
  for (const x of [2, 4, 6]) b.wire([x, 15], [x, 19]);
  b.wire([10, 15], [10, 16], [6, 16]);
  b.wire([12, 15], [12, 17], [4, 17]);
  b.wire([14, 15], [14, 18], [2, 18]);
  for (const x of [2, 4, 6]) b.wire([x, 23], [x, 24]);

  b.part('src', 19, 2, '', { pole: 'L' });
  b.part('src', 19, 34, '', { pole: 'N' });
  b.wire([19, 2], [42, 2]);
  b.wire([19, 34], [42, 34]);
  // 공통: THR b → 정지 PB0
  b.part('nc', 22, 5, 'THR');
  b.part('pb_nc', 22, 10, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.wire([22, 2], [22, 3]);
  b.wire([22, 7], [22, 8]);
  // 정회전 렁
  b.part('pb_no', 22, 15, 'PB1', { name: tr('정회전', 'Forward'), color: 'green' });
  b.part('no', 25, 15, 'MC1');
  b.part('nc', 22, 22, 'MC2');
  b.part('coil', 22, 29, 'MC1', { name: tr('정회전', 'Forward') });
  b.wire([22, 12], [22, 13]);
  b.wire([22, 13], [25, 13]);
  b.wire([22, 17], [25, 17]);
  b.wire([22, 17], [22, 20]);
  b.wire([22, 24], [22, 27]);
  b.wire([22, 31], [22, 34]);
  // 역회전 렁
  b.wire([22, 12], [30, 12], [30, 13]);
  b.part('pb_no', 30, 15, 'PB2', { name: tr('역회전', 'Reverse'), color: 'green' });
  b.part('no', 33, 15, 'MC2');
  b.part('nc', 30, 22, 'MC1');
  b.part('coil', 30, 29, 'MC2', { name: tr('역회전', 'Reverse') });
  b.wire([30, 13], [33, 13]);
  b.wire([30, 17], [33, 17]);
  b.wire([30, 17], [30, 20]);
  b.wire([30, 24], [30, 27]);
  b.wire([30, 31], [30, 34]);
  // 표시등
  b.part('no', 37, 15, 'MC1');
  b.part('lamp', 37, 29, 'GL', { name: tr('정회전 표시', 'Forward'), color: 'green' });
  b.wire([37, 2], [37, 13]);
  b.wire([37, 17], [37, 27]);
  b.wire([37, 31], [37, 34]);
  b.part('no', 42, 15, 'MC2');
  b.part('lamp', 42, 29, 'YL', { name: tr('역회전 표시', 'Reverse'), color: 'yellow' });
  b.wire([42, 2], [42, 13]);
  b.wire([42, 17], [42, 27]);
  b.wire([42, 31], [42, 34]);
  b.part('text', 19, -1, '', { text: tr('정역 운전 회로 (인터록)', 'Forward / reverse with interlock') });
  b.op(500, 'PB1', 'press', tr('정회전', 'Forward'));
  b.op(2000, 'PB2', 'press', tr('인터록 확인', 'Interlock'));
  b.op(1500, 'PB0', 'press', tr('정지', 'Stop'));
  b.op(1000, 'PB2', 'press', tr('역회전', 'Reverse'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/** 타이머: 기동하면 X1 자기유지, T1(3초) 뒤 운전 표시, 기다리는 동안 대기 표시 */
function timerDelay(): Circuit {
  const b = new Builder();
  b.part('src', 1, 2, '', { pole: '+24V' });
  b.part('src', 1, 27, '', { pole: '0V' });
  b.wire([1, 2], [24, 2]);
  b.wire([1, 27], [24, 27]);
  // 렁 1: PB0 → PB1 ∥ X1 a → X1
  b.part('pb_nc', 4, 6, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('pb_no', 4, 12, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('no', 8, 12, 'X1');
  b.part('coil', 4, 23, 'X1', { name: tr('운전 기억', 'Run memory') });
  b.wire([4, 2], [4, 4]);
  b.wire([4, 8], [4, 10]);
  b.wire([4, 10], [8, 10]);
  b.wire([4, 14], [8, 14]);
  b.wire([4, 14], [4, 21]);
  b.wire([4, 25], [4, 27]);
  // 렁 2: X1 a → T1 (ON 딜레이 3초)
  b.part('no', 12, 12, 'X1');
  b.part('timer', 12, 23, 'T1', { name: tr('기동 지연', 'Start delay'), timerMode: 'on', preset: 3000 });
  b.wire([12, 2], [12, 10]);
  b.wire([12, 14], [12, 21]);
  b.wire([12, 25], [12, 27]);
  // 렁 3: T1 a (한시) → GL 운전
  b.part('no', 18, 12, 'T1');
  b.part('lamp', 18, 23, 'GL', { name: tr('운전', 'Run'), color: 'green' });
  b.wire([18, 2], [18, 10]);
  b.wire([18, 14], [18, 21]);
  b.wire([18, 25], [18, 27]);
  // 렁 4: X1 a → T1 b → YL 대기
  b.part('no', 24, 9, 'X1');
  b.part('nc', 24, 15, 'T1');
  b.part('lamp', 24, 23, 'YL', { name: tr('대기', 'Waiting'), color: 'yellow' });
  b.wire([24, 2], [24, 7]);
  b.wire([24, 11], [24, 13]);
  b.wire([24, 17], [24, 21]);
  b.wire([24, 25], [24, 27]);
  b.part('text', 1, -1, '', { text: tr('타이머 지연 동작 (ON 딜레이 3초)', 'On-delay timer (3 s)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(5500, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/** 공압 실린더 1사이클: 기동 → SOL1 전진 → LS2(전진단) → SOL2 후진 → LS1(후진단) */
function cylinderCycle(): Circuit {
  const b = new Builder();
  b.part('src', 1, 2, '', { pole: '+24V' });
  b.part('src', 1, 30, '', { pole: '0V' });
  b.wire([1, 2], [21, 2]);
  b.wire([1, 30], [21, 30]);
  // 렁 1: PB0 → (PB1 + LS1) ∥ X1 a → LS2 b → X1
  b.part('pb_nc', 4, 6, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('pb_no', 4, 12, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('ls_no', 4, 17, 'LS1', { name: tr('후진단', 'Retracted'), cyl: 'CYL1', end: '-' });
  b.part('no', 8, 14, 'X1');
  b.part('ls_nc', 4, 22, 'LS2', { name: tr('전진단', 'Extended'), cyl: 'CYL1', end: '+' });
  b.part('coil', 4, 27, 'X1', { name: tr('전진 기억', 'Advance memory') });
  b.wire([4, 2], [4, 4]);
  b.wire([4, 8], [4, 10]);
  b.wire([4, 14], [4, 15]);
  b.wire([4, 10], [8, 10], [8, 12]);
  b.wire([4, 19], [8, 19], [8, 16]);
  b.wire([4, 19], [4, 20]);
  b.wire([4, 24], [4, 25]);
  b.wire([4, 29], [4, 30]);
  // 렁 2: X1 a → SOL1 (전진)
  b.part('no', 12, 14, 'X1');
  b.part('sol', 12, 27, 'SOL1', { name: tr('전진', 'Advance') });
  b.wire([12, 2], [12, 12]);
  b.wire([12, 16], [12, 25]);
  b.wire([12, 29], [12, 30]);
  // 렁 3: X1 b → LS1 b → SOL2 (후진)
  b.part('nc', 17, 14, 'X1');
  b.part('ls_nc', 17, 20, 'LS1', { cyl: 'CYL1', end: '-' });
  b.part('sol', 17, 27, 'SOL2', { name: tr('후진', 'Return') });
  b.wire([17, 2], [17, 12]);
  b.wire([17, 16], [17, 18]);
  b.wire([17, 22], [17, 25]);
  b.wire([17, 29], [17, 30]);
  b.part('cyl', 24, 10, 'CYL1', { name: tr('클램프 실린더', 'Clamp cylinder'), solPlus: 'SOL1', solMinus: 'SOL2', stroke: 1000, strokeBack: 800 });
  b.part('text', 1, -1, '', { text: tr('공압 실린더 1사이클 (A+ A-)', 'Cylinder one cycle (A+ A-)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  return b.done();
}

/**
 * 전공압 자동 왕복: 공압원 → FRL → 5/2 양솔 밸브 → 속도 제어(로드 쪽, 전진 50%) → 복동 실린더.
 * 근접 센서 PX1(후진단)·PX2(전진단) → 릴레이 X2·X3, 기동 X1 이 켜져 있는 동안 왕복을 되풀이한다.
 */
function electroPneumatic(): Circuit {
  const b = new Builder();
  b.part('src', 1, 2, '', { pole: '+24V' });
  b.part('src', 1, 26, '', { pole: '0V' });
  b.wire([1, 2], [29, 2]);
  b.wire([1, 26], [29, 26]);
  // 렁 1: 정지 PB0 → 기동 PB1 ∥ X1 → X1 (운전)
  b.part('pb_nc', 4, 6, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('pb_no', 4, 12, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('no', 7, 12, 'X1');
  b.part('coil', 4, 22, 'X1', { name: tr('운전', 'Run') });
  b.wire([4, 2], [4, 4]);
  b.wire([4, 8], [4, 10]);
  b.wire([4, 10], [7, 10]);
  b.wire([4, 14], [7, 14]);
  b.wire([4, 14], [4, 20]);
  b.wire([4, 24], [4, 26]);
  // 렁 2·3: 근접 센서(PNP) → 릴레이
  b.part('prox', 11, 6, 'PX1', { name: tr('후진단', 'Retracted'), sense: 'inductive', cyl: 'CYL1', end: '-' });
  b.part('coil', 11, 22, 'X2', { name: tr('후진 확인', 'Retracted') });
  b.wire([11, 2], [11, 4]);
  b.wire([13, 8], [13, 26]);
  b.wire([11, 8], [11, 20]);
  b.wire([11, 24], [11, 26]);
  b.part('prox', 17, 6, 'PX2', { name: tr('전진단', 'Extended'), sense: 'inductive', cyl: 'CYL1', end: '+' });
  b.part('coil', 17, 22, 'X3', { name: tr('전진 확인', 'Extended') });
  b.wire([17, 2], [17, 4]);
  b.wire([19, 8], [19, 26]);
  b.wire([17, 8], [17, 20]);
  b.wire([17, 24], [17, 26]);
  // 렁 4: 운전 중 후진단이면 SOL1 (전진), 렁 5: 전진단이면 SOL2 (후진)
  b.part('no', 23, 8, 'X1');
  b.part('no', 23, 14, 'X2');
  b.part('sol', 23, 22, 'SOL1', { name: tr('전진', 'Advance') });
  b.wire([23, 2], [23, 6]);
  b.wire([23, 10], [23, 12]);
  b.wire([23, 16], [23, 20]);
  b.wire([23, 24], [23, 26]);
  b.part('no', 29, 8, 'X3');
  b.part('sol', 29, 22, 'SOL2', { name: tr('후진', 'Return') });
  b.wire([29, 2], [29, 6]);
  b.wire([29, 10], [29, 20]);
  b.wire([29, 24], [29, 26]);
  // 공압
  b.part('cyl', 40, 6, 'CYL1', { name: tr('이송 실린더', 'Transfer cylinder'), stroke: 1000, strokeBack: 800 });
  b.part('v52d', 43, 16, 'V1', { solA: 'SOL1', solB: 'SOL2' });
  b.part('fc', 45, 11, 'SC1', { speed: 50 });
  b.part('frl', 43, 21, 'FRL');
  b.part('air', 43, 25);
  b.wire([41, 8], [41, 11], [42, 11], [42, 14]);
  b.wire([45, 8], [45, 9]);
  b.wire([45, 13], [44, 13], [44, 14]);
  b.wire([43, 18], [43, 19]);
  b.wire([43, 26], [43, 23]);
  b.part('text', 1, -1, '', { text: tr('전공압 자동 왕복 (5/2 양솔 밸브 · 근접 센서 · 속도 제어)', 'Electro-pneumatic auto cycle (5/2 double valve, proximity sensors, flow control)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(7500, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 실물 배선도: 3상 전원 → 차단기 3P → 전자접촉기 → 전동기(PE 접지),
 * 제어는 L3 · N 을 차단기 2P 로 받아 정지(11-12 b) → 기동(23-24 a) ∥ MC 13-14 → A2, A1 은 N.
 */
function realWiring(): Circuit {
  const b = new Builder();
  b.part('r_term', 6, 0, '', { pole: 'L1' });
  b.part('r_term', 8, 0, '', { pole: 'L2' });
  b.part('r_term', 10, 0, '', { pole: 'L3' });
  b.part('r_term', 13, 0, '', { pole: 'N' });
  b.part('r_mcb3', 8, 6, 'MCB1', { name: tr('주 차단기', 'Main breaker'), spec: 'AC/25A' });
  b.part('r_mcb2', 17, 6, 'MCB2', { name: tr('조작 회로', 'Control'), spec: 'AC/25A' });
  b.cable('brown', [6, 0], [6, 2]);
  b.cable('black', [8, 0], [8, 2]);
  b.cable('grey', [10, 0], [10, 2]);
  b.cable('blue', [13, 0], [18, 0], [18, 2]);
  b.cable('grey', [10, 2], [16, 2]);
  b.part('r_mc', 9, 19, 'MC1', { name: tr('전동기 운전', 'Motor run'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.cable('brown', [6, 10], [6, 15]);
  b.cable('black', [8, 10], [8, 15]);
  b.cable('grey', [10, 10], [10, 15]);
  b.cable('blue', [18, 10], [18, 12], [7, 12], [7, 13]);
  // 조작: 정지 PB0 (11-12 b) → 기동 PB1 (23-24 a) ∥ MC1 13-14 → A2
  b.part('r_pb', 24, 18, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 24, 26, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.cable('grey', [16, 10], [16, 18], [23, 18]);
  b.cable('grey', [25, 18], [27, 18], [27, 28], [25, 28]);
  b.cable('grey', [12, 15], [12, 13], [27, 13], [27, 18]);
  b.cable('grey', [23, 28], [23, 30], [11, 30], [11, 25]);
  b.cable('grey', [12, 23], [12, 30]);
  // 전동기 U V W, PE 접지
  b.part('r_motor3', 8, 35, 'M1', { name: tr('3상 전동기', '3-phase motor'), spec: 'AC 380V' });
  b.cable('brown', [6, 23], [6, 32]);
  b.cable('black', [8, 23], [8, 32]);
  b.cable('grey', [10, 23], [10, 32]);
  b.part('r_term', 18, 36, '', { pole: 'PE' });
  b.cable('gy', [12, 36], [18, 36]);
  b.part('text', 1, -3, '', { text: tr('실물 배선도: 전동기 기동 · 정지 (자기유지)', 'Wiring diagram: motor start / stop (self-hold)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 제어반 실물 배선: 문(도어)에 붙는 기기 ↔ 단자대 TB1 ↔ 판넬 안 기기.
 *  - 비상정지 EMS (11-12 b) → 셀렉터 SS (23-24 a, 운전 선택) → 정지 PB0 (11-12 b) → 기동 PB1 (23-24 a) ∥ X1 1-3 → X1 코일 2-7
 *  - X1 8-6 a → T1 전원 2 · 공통 1 (타이머가 돌기 시작), T1 1-3 한시 a → 운전 GL, T1 1-4 한시 b → 대기 YL
 *  - X1 1-4 b → 정지 RL, N 은 TB1-8 로 램프 X2 에 이어 돌린다
 * 전선 색: 전원 L 갈색, N 파랑, 교류 제어선 빨강 (KS C IEC 60204-1)
 */
function controlPanel(): Circuit {
  const b = new Builder();
  // ── 문 (도어): 위 줄
  b.part('r_estop', 4, 3, 'EMS', { name: tr('비상정지', 'E-stop') });
  b.part('r_ss', 10, 3, 'SS', { name: tr('운전 선택', 'Run select') });
  b.part('r_pb', 17, 3, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 24, 3, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('r_lamp', 30, 4, 'RL', { name: tr('정지', 'Stopped'), color: 'red' });
  b.part('r_lamp', 36, 4, 'GL', { name: tr('운전', 'Running'), color: 'green' });
  b.part('r_lamp', 42, 4, 'YL', { name: tr('대기', 'Waiting'), color: 'yellow' });
  // ── 단자대 TB1: 1 L · 2 기동 앞 · 3 기동 뒤 · 4 예비 · 5 RL · 6 GL · 7 YL · 8 N
  b.part('r_tb', 11, 14, 'TB1', { name: tr('도어 단자', 'Door terminals'), n: 8 });
  // 문 쪽 배선 (단자대 위 나사 → 문 기기)
  b.cable('red', [11, 12], [11, 8], [1, 8], [1, 3], [3, 3]);
  b.cable('red', [5, 3], [7, 3], [7, 5], [9, 5]);
  b.cable('red', [11, 5], [14, 5], [14, 3], [16, 3]);
  b.cable('red', [18, 3], [21, 3], [21, 5], [23, 5]);
  b.cable('red', [13, 12], [13, 6], [21, 6], [21, 5]);
  b.cable('red', [15, 12], [15, 7], [25, 7], [25, 5]);
  b.cable('red', [19, 12], [19, 8], [29, 8], [29, 5]);
  b.cable('red', [21, 12], [21, 9], [35, 9], [35, 5]);
  b.cable('red', [23, 12], [23, 10], [41, 10], [41, 5]);
  b.cable('blue', [25, 12], [25, 11], [46, 11], [46, 0], [33, 0]);
  b.cable('blue', [33, 0], [33, 5], [31, 5]);
  b.cable('blue', [39, 0], [39, 5], [37, 5]);
  b.cable('blue', [43, 5], [46, 5]);
  // ── 판넬 안: 차단기 1P, 8핀 릴레이 X1, 8핀 타이머 T1
  b.part('r_term', 6, 14, '', { pole: 'L' });
  b.part('r_term', 42, 13, '', { pole: 'N' });
  b.part('r_mcb1', 6, 22, 'MCB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC/10A' });
  // 릴레이 · 타이머는 소켓에 꽂는다: 전선은 소켓의 나사 단자에 (위 줄 6 5 4 3 · 아래 줄 7 8 1 2)
  b.part('r_relay8', 18, 25, 'X1', { name: tr('운전 기억', 'Run memory'), spec: 'AC 220V', sock: 'pf' });
  b.part('r_timer8', 32, 25, 'T1', { name: tr('기동 지연', 'Start delay'), timerMode: 'on', preset: 3000, sock: 'pf' });
  b.cable('brown', [6, 14], [6, 18]);
  // L: 차단기 2 → 아래 모선 → X1 8 (공통), TB1-1 (문으로)
  b.cable('red', [6, 26], [6, 32], [17, 32], [17, 28]);
  b.cable('red', [11, 16], [11, 32]);
  // 단자대 아래 나사 → X1 소켓: 2 = 1 (공통, 기동 앞), 3 = 3 (a) 에 물리고 3 → 2 (코일) 점퍼, 5 = 4 (b → RL)
  b.cable('red', [13, 16], [13, 30], [19, 30], [19, 28]);
  b.cable('red', [15, 16], [15, 18], [21, 18], [21, 22]);
  b.cable('red', [21, 22], [23, 22], [23, 28], [21, 28]);
  b.cable('red', [19, 16], [19, 22]);
  // TB1 6 · 7 → T1 3 (한시 a, GL), T1 4 (한시 b, YL)
  b.cable('red', [21, 16], [21, 17], [35, 17], [35, 22]);
  b.cable('red', [23, 16], [23, 19], [33, 19], [33, 22]);
  // X1 8-6 (a) → T1 전원 2, 2 → 1 (공통) 점퍼
  b.cable('red', [15, 22], [15, 20], [26, 20], [26, 31], [35, 31], [35, 28]);
  b.cable('red', [33, 31], [33, 28]);
  // N: 오른쪽 단자 → TB1-8, 아래 모선 → X1 7, T1 7
  b.cable('blue', [42, 13], [42, 16], [25, 16]);
  b.cable('blue', [42, 16], [42, 33], [15, 33], [15, 28]);
  b.cable('blue', [29, 28], [29, 33]);
  b.part('text', 1, -3, '', { text: tr('제어반 실물 배선: 비상정지 · 셀렉터 · 8핀 릴레이 · 타이머 · 단자대', 'Control panel wiring: E-stop, selector, 8-pin relay & timer, terminal block') });
  b.op(500, 'SS', 'on', tr('운전 선택', 'Select run'));
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(5000, 'PB0', 'press', tr('정지', 'Stop'));
  b.op(1000, 'PB1', 'press', tr('다시 기동', 'Restart'));
  b.op(1500, 'EMS', 'on', tr('비상정지', 'E-stop'));
  b.op(1000, 'EMS', 'off', tr('비상정지 해제', 'Release E-stop'));
  return b.done();
}

/**
 * 릴레이 소켓 배선 (각형 릴레이 MY2N + 소켓 PYF08A 꼴): 자기유지와 운전 · 정지 램프.
 * 전선은 릴레이가 아니라 소켓의 나사 단자에 물린다: 위 바깥 단 4 1 (b), 안쪽 단 8 5 (a), 아래 안쪽 단 12 9 (공통), 바깥 단 14 13 (코일).
 *  - L → 정지 PB0 11-12 → 기동 PB1 23-24 → 코일 14, 코일 13 → N
 *  - 자기유지: 9 (기동 앞) → 5 (기동 뒤, 코일 14 와 같은 선)
 *  - 12 (L) → 8 (a) → GL 운전 램프, 12 → 4 (b) → RL 정지 램프
 */
function relaySocket(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 30, 0, '', { pole: 'N' });
  b.part('r_mcb1', 2, 7, 'MCB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC/10A' });
  b.part('r_pb', 8, 6, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 14, 6, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('r_lamp', 22, 6, 'GL', { name: tr('운전', 'Running'), color: 'green' });
  b.part('r_lamp', 27, 6, 'RL', { name: tr('정지', 'Stopped'), color: 'red' });
  b.part('r_my2', 12, 20, 'X1', { name: tr('운전 기억', 'Run memory'), spec: 'AC 220V' });
  b.cable('brown', [2, 0], [2, 3]);
  // L: 차단기 2 → 소켓 12 (둘째 접점 공통), 정지 버튼 11
  b.cable('red', [2, 11], [2, 27], [10, 27], [10, 23]);
  b.cable('red', [2, 12], [5, 12], [5, 6], [7, 6]);
  // 정지 12 → 기동 23, 소켓 9 (첫째 접점 공통 = 기동 버튼 앞)
  b.cable('red', [9, 6], [11, 6], [11, 8], [13, 8]);
  b.cable('red', [11, 8], [11, 10], [7, 10], [7, 28], [12, 28], [12, 23]);
  // 기동 24 → 소켓 14 (코일), 소켓 5 (a: 자기유지)
  b.cable('red', [15, 8], [15, 29], [11, 29], [11, 25]);
  b.cable('red', [15, 13], [12, 13], [12, 17]);
  // 소켓 8 (a) → GL, 소켓 4 (b) → RL
  b.cable('red', [10, 17], [10, 11], [21, 11], [21, 7]);
  b.cable('red', [11, 15], [11, 14], [26, 14], [26, 7]);
  // N: 코일 13, 램프
  b.cable('blue', [13, 25], [13, 31], [30, 31], [30, 0]);
  b.cable('blue', [23, 7], [23, 9], [30, 9]);
  b.cable('blue', [28, 7], [28, 9]);
  b.part('text', 1, -4, '', { text: tr('릴레이 소켓 배선: 각형 릴레이 (MY2N) 는 소켓 (PYF08A) 에 꽂고, 전선은 소켓 나사 단자에', 'Relay socket wiring: the relay plugs into the socket, wires land on the socket screws') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 전동기 주회로 한 벌 (실물 배선): L1 L2 L3 → MCB1 3P → MC1 → THR1 → M1, 전동기 접지.
 * 조작 전원은 L1 에서 퓨즈 F1 을 거쳐 THR 95-96 (b) 을 지난 선으로 주고 (ctlTo 까지), 코일 A1 은 조작 회로의 끝 (coilFrom) 에서 받는다.
 * A2 와 램프의 N 은 x = 14 기둥 (N 단자) 으로 돌아간다. 조작 기기는 x ≥ 20 에 놓는다.
 */
function motorKit(b: Builder, o: { ctlTo: [number, number]; coilFrom: [number, number]; hold?: boolean; motor?: string }): void {
  const COL: WireColor[] = ['brown', 'black', 'grey'];
  [4, 6, 8].forEach((x, k) => {
    b.part('r_term', x, 0, '', { pole: (['L1', 'L2', 'L3'] as const)[k] });
    b.cable(COL[k], [x, 0], [x, 2]);
    b.cable(COL[k], [x, 10], [x, 16]);
    b.cable(COL[k], [x, 24], [x, 32]);
    b.cable(COL[k], [x, 38], [x, 42]);
  });
  b.part('r_term', 14, 0, '', { pole: 'N' });
  b.part('r_mcb3', 6, 6, 'MCB1', { name: tr('주 차단기', 'Main breaker'), spec: 'AC/20A' });
  b.part('r_mc', 7, 20, 'MC1', { name: tr('전동기 운전', 'Motor run'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_thr', 6, 35, 'THR1', { name: tr('과부하', 'Overload') });
  b.part('r_motor3', 6, 45, 'M1', { name: o.motor ?? tr('3상 전동기', '3-phase motor'), spec: 'AC 380V' });
  b.part('r_term', 14, 46, '', { pole: 'PE' });
  b.cable('gy', [10, 46], [14, 46]);
  // 조작 전원: L1 (차단기 아래) → 퓨즈 F1 → THR 95, THR 96 → 조작 회로
  b.part('r_fuse', 0, 16, 'F1', { name: tr('조작 회로', 'Control'), amps: 5 });
  b.cable('red', [4, 12], [0, 12], [0, 13]);
  b.cable('red', [0, 19], [0, 30], [10, 30], [10, 32]);
  b.cable('red', [10, 38], [10, 40], [18, 40], [18, o.ctlTo[1]], o.ctlTo);
  // 코일 A1 ← 조작 회로 끝 (아래 모선 y = 28), 자기유지면 14 도 같은 선에. A2 → N
  b.cable('red', o.coilFrom, [o.coilFrom[0] + 2, o.coilFrom[1]], [o.coilFrom[0] + 2, 28], [2, 28], [2, 13], [5, 13], [5, 14]);
  if (o.hold) b.cable('red', [10, 28], [10, 24]);
  b.cable('blue', [9, 26], [9, 27], [14, 27], [14, 0]);
}

/** 조그 (인칭) 운전: 버튼을 누르고 있는 동안만 전동기가 돈다. L1 → F1 → THR 95-96 → PB1 23-24 → MC1 A1, A2 → N */
function motorJog(): Circuit {
  const b = new Builder();
  b.part('r_pb', 21, 20, 'PB1', { name: tr('조그', 'Jog'), color: 'yellow' });
  motorKit(b, { ctlTo: [20, 22], coilFrom: [22, 22] });
  b.part('text', -2, -4, '', { text: tr('조그 (인칭) 운전: 버튼을 누르고 있는 동안만 운전 (위치 맞춤 · 시운전)', 'Jog: the motor runs only while the button is held') });
  b.op(500, 'PB1', 'press', tr('조그 (2초 동안 누름)', 'Jog for 2 s'), 2000);
  b.op(3000, 'PB1', 'press', tr('짧게 한 번 더', 'A short jog'), 500);
  return b.done();
}

/**
 * 표시등 부착 자기유지: 정지 PB0 (b) → 기동 PB1 (a) ∥ MC1 13-14 → 코일.
 *  - GL 운전등: 코일과 나란히, RL 정지등: MC1 21-22 (b), YL 과부하등: THR 97-98 (a)
 */
function motorLamps(): Circuit {
  const b = new Builder();
  b.part('r_pb', 21, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 29, 20, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('r_lamp', 22, 6, 'GL', { name: tr('운전', 'Running'), color: 'green' });
  b.part('r_lamp', 28, 6, 'RL', { name: tr('정지', 'Stopped'), color: 'red' });
  b.part('r_lamp', 34, 6, 'YL', { name: tr('과부하', 'Overload'), color: 'yellow' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [30, 22], hold: true });
  // 정지 12 → 기동 23, MC1 13 (자기유지)
  b.cable('red', [22, 20], [25, 20], [25, 22], [28, 22]);
  b.cable('red', [25, 20], [25, 11], [10, 11], [10, 16]);
  // 운전등: 코일과 나란히
  b.cable('red', [21, 7], [21, 10], [34, 10], [34, 24], [32, 24]);
  // 정지등: 조작 전원 → MC1 21-22 (b) → RL
  b.cable('red', [18, 20], [18, 14], [12, 14], [12, 16]);
  b.cable('red', [27, 7], [27, 12], [16, 12], [16, 26], [12, 26], [12, 24]);
  // 과부하등: 퓨즈 뒤 → THR 97-98 (a) → YL
  b.cable('red', [10, 30], [12, 30], [12, 32]);
  b.cable('red', [12, 38], [12, 41], [36, 41], [36, 13], [33, 13], [33, 7]);
  // 램프 N
  b.cable('blue', [35, 7], [35, 9], [14, 9]);
  b.cable('blue', [29, 7], [29, 9]);
  b.cable('blue', [23, 7], [23, 9]);
  b.part('text', -2, -4, '', { text: tr('표시등 부착 자기유지: 운전 GL · 정지 RL · 과부하 YL (THR 트립)', 'Self-holding with run, stop and overload lamps') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  b.op(1000, 'PB1', 'press', tr('다시 기동', 'Restart'));
  b.op(1500, 'THR1', 'on', tr('과부하 트립', 'Overload trip'));
  b.op(1500, 'THR1', 'off', tr('복귀', 'Reset'));
  return b.done();
}

/** 2개소 (다점) 제어: 정지 버튼은 직렬로, 기동 버튼은 병렬로. 현장과 조작반 어디서나 기동 · 정지 */
function motorTwoPlace(): Circuit {
  const b = new Builder();
  b.part('r_pb', 21, 20, 'PB0', { name: tr('정지 (조작반)', 'Stop (panel)'), color: 'red' });
  b.part('r_pb', 29, 20, 'PB2', { name: tr('정지 (현장)', 'Stop (local)'), color: 'red' });
  b.part('r_pb', 37, 20, 'PB1', { name: tr('기동 (조작반)', 'Start (panel)'), color: 'green' });
  b.part('r_pb', 45, 20, 'PB3', { name: tr('기동 (현장)', 'Start (local)'), color: 'green' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [46, 22], hold: true });
  // 정지 두 개 직렬
  b.cable('red', [22, 20], [28, 20]);
  // 기동 두 개 병렬: 앞쪽 (23) 끼리, MC1 13 도 같은 선
  b.cable('red', [30, 20], [33, 20], [33, 22], [36, 22]);
  b.cable('red', [33, 22], [33, 24], [41, 24], [41, 22], [44, 22]);
  b.cable('red', [33, 20], [33, 11], [10, 11], [10, 16]);
  // 뒤쪽 (24) 끼리 → 코일
  b.cable('red', [38, 22], [40, 22], [40, 28]);
  b.part('text', -2, -4, '', { text: tr('2개소 제어: 정지는 직렬 · 기동은 병렬 (조작반과 현장 어디서나)', 'Two-place control: stops in series, starts in parallel') });
  b.op(500, 'PB1', 'press', tr('조작반에서 기동', 'Start at the panel'));
  b.op(2500, 'PB2', 'press', tr('현장에서 정지', 'Stop locally'));
  b.op(1000, 'PB3', 'press', tr('현장에서 기동', 'Start locally'));
  b.op(2000, 'PB0', 'press', tr('조작반에서 정지', 'Stop at the panel'));
  return b.done();
}

/**
 * 조그 + 연속 운전 (보조 릴레이 X1): 기동 PB1 은 X1 을 자기유지시키고 X1 12-8 이 MC1 을 붙인다.
 * 조그 PB2 는 X1 을 거치지 않고 MC1 코일만 직접 붙여서, 손을 떼면 바로 멈춘다 (자기유지가 걸리지 않는다).
 *  - F1 → THR 95-96 → 정지 PB0 → [기동 PB1 ∥ X1 9-5] → X1 코일 14
 *  - 정지 뒤 같은 선 → X1 12-8 → MC1 A1, 조그 PB2 23-24 → MC1 A1
 */
function motorJogRun(): Circuit {
  const b = new Builder();
  b.part('r_pb', 21, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 29, 20, 'PB1', { name: tr('연속 운전', 'Run'), color: 'green' });
  b.part('r_pb', 37, 20, 'PB2', { name: tr('조그', 'Jog'), color: 'yellow' });
  b.part('r_my2', 46, 22, 'X1', { name: tr('운전 기억', 'Run memory'), spec: 'AC 220V' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [38, 22] });
  // 정지 12 → 기동 23 · 조그 23 · X1 공통 9 · 12
  b.cable('red', [22, 20], [25, 20], [25, 22], [28, 22]);
  b.cable('red', [25, 22], [25, 24], [33, 24], [33, 22], [36, 22]);
  b.cable('red', [33, 24], [33, 31], [46, 31], [46, 25]);
  b.cable('red', [44, 31], [44, 25]);
  // 기동 24 → X1 5 (a: 자기유지) → X1 코일 14
  b.cable('yellow', [30, 22], [32, 22], [32, 13], [46, 13], [46, 19]);
  b.cable('yellow', [46, 13], [49, 13], [49, 29], [45, 29], [45, 27]);
  // X1 8 (a) → MC1 코일 (조그 버튼 뒤와 같은 선)
  b.cable('red', [44, 19], [44, 15], [42, 15], [42, 26], [40, 26]);
  // X1 코일 13 → N
  b.cable('blue', [47, 27], [47, 33], [14, 33], [14, 27]);
  b.part('text', -2, -4, '', { text: tr('조그 + 연속 운전: 기동은 보조 릴레이 X1 이 기억하고, 조그는 누르는 동안만', 'Jog and run: an auxiliary relay holds the run, jog works only while pressed') });
  b.op(500, 'PB2', 'press', tr('조그 (1초)', 'Jog for 1 s'), 1000);
  b.op(2500, 'PB1', 'press', tr('연속 운전', 'Run'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/** 리밋 스위치 자동 정지: 기동하면 자기유지로 돌다가, 끝에서 리밋 스위치 LS1 (11-12 b) 이 밀리면 스스로 멈춘다 */
function motorLimitStop(): Circuit {
  const b = new Builder();
  b.part('r_pb', 21, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_ls', 29, 20, 'LS1', { name: tr('끝 위치', 'End position') });
  b.part('r_pb', 37, 20, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [38, 22], hold: true });
  b.cable('red', [22, 20], [28, 20]);
  b.cable('red', [30, 20], [33, 20], [33, 22], [36, 22]);
  b.cable('red', [33, 20], [33, 11], [10, 11], [10, 16]);
  b.part('text', -2, -4, '', { text: tr('리밋 스위치 자동 정지: 끝 위치에서 LS1 (b접점) 이 열려 스스로 멈춘다', 'Limit switch stop: LS1 (NC) opens at the end position') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(2500, 'LS1', 'press', tr('끝에 닿음 → 정지', 'End reached: stop'), 500);
  b.op(1500, 'PB1', 'press', tr('다시 기동', 'Start again'));
  b.op(2000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 정 · 역 운전 이중 인터록 (실물 배선): MC1 정회전, MC2 는 L1 · L3 을 바꿔 역회전.
 *  - 버튼 인터록: 정회전 버튼의 b접점이 역회전 회로에, 역회전 버튼의 b접점이 정회전 회로에 직렬
 *  - 접촉기 인터록: MC1 21-22 가 MC2 코일 앞에, MC2 21-22 가 MC1 코일 앞에 직렬
 * 돌고 있을 때 반대 버튼을 누르면 먼저 떨어지고 나서 반대로 붙는다 (두 접촉기가 함께 붙으면 상간 단락).
 */
function motorReversing(): Circuit {
  const b = new Builder();
  const COL: WireColor[] = ['brown', 'black', 'grey'];
  [4, 6, 8].forEach((x, k) => {
    b.part('r_term', x, 0, '', { pole: (['L1', 'L2', 'L3'] as const)[k] });
    b.cable(COL[k], [x, 0], [x, 2]);
    b.cable(COL[k], [x, 10], [x, 16]);
    b.cable(COL[k], [x, 24], [x, 32]);
    b.cable(COL[k], [x, 38], [x, 42]);
    // MC2 전원 쪽: 같은 상 순서로
    b.cable(COL[k], [x, 11 + k], [24 + 2 * k, 11 + k], [24 + 2 * k, 16]);
    // MC2 부하 쪽: L1 은 W 줄로, L3 은 U 줄로 (두 상을 바꾼다)
    b.cable(COL[k], [24 + 2 * k, 24], [24 + 2 * k, 30 - k], [8 - 2 * k, 30 - k]);
  });
  b.part('r_term', 14, 0, '', { pole: 'N' });
  b.part('r_mcb3', 6, 6, 'MCB1', { name: tr('주 차단기', 'Main breaker'), spec: 'AC/20A' });
  b.part('r_mc', 7, 20, 'MC1', { name: tr('정회전', 'Forward'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_mc', 27, 20, 'MC2', { name: tr('역회전', 'Reverse'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_thr', 6, 35, 'THR1', { name: tr('과부하', 'Overload') });
  b.part('r_motor3', 6, 45, 'M1', { name: tr('3상 전동기', '3-phase motor'), spec: 'AC 380V' });
  b.part('r_term', 14, 46, '', { pole: 'PE' });
  b.cable('gy', [10, 46], [14, 46]);
  b.part('r_fuse', 0, 16, 'F1', { name: tr('조작 회로', 'Control'), amps: 5 });
  b.part('r_pb', 41, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 49, 20, 'PB1', { name: tr('정회전', 'Forward'), color: 'green' });
  b.part('r_pb', 57, 20, 'PB2', { name: tr('역회전', 'Reverse'), color: 'yellow' });
  // 조작 전원: L1 → F1 → THR 95-96 → 정지 PB0
  b.cable('red', [4, 12], [0, 12], [0, 13]);
  b.cable('red', [0, 19], [0, 31], [10, 31], [10, 32]);
  b.cable('red', [10, 38], [10, 40], [36, 40], [36, 20], [40, 20]);
  // 정지 12 → 정회전 버튼 11 (b) · 역회전 버튼 11 (b)
  b.cable('red', [42, 20], [48, 20]);
  b.cable('red', [45, 20], [45, 13], [54, 13], [54, 20], [56, 20]);
  // 정회전: 역회전 버튼 12 → 정회전 버튼 23 · MC1 13
  b.cable('yellow', [58, 20], [60, 20], [60, 25], [46, 25], [46, 22], [48, 22]);
  b.cable('yellow', [10, 16], [10, 7], [62, 7], [62, 20], [60, 20]);
  //          정회전 버튼 24 · MC1 14 → MC2 21 (b) → MC2 22 → MC1 A1
  b.cable('yellow', [32, 16], [32, 9], [52, 9], [52, 22], [50, 22]);
  b.cable('yellow', [10, 24], [10, 26], [16, 26], [16, 9], [32, 9]);
  b.cable('yellow', [32, 24], [32, 27], [38, 27], [38, -2], [2, -2], [2, 13], [5, 13], [5, 14]);
  // 역회전: 정회전 버튼 12 → 역회전 버튼 23 · MC2 13
  b.cable('orange', [50, 20], [53, 20], [53, 22], [56, 22]);
  b.cable('orange', [30, 16], [30, 10], [53, 10], [53, 20]);
  //          역회전 버튼 24 · MC2 14 → MC1 21 (b) → MC1 22 → MC2 A1
  b.cable('orange', [12, 16], [12, 6], [64, 6], [64, 22], [58, 22]);
  b.cable('orange', [30, 24], [30, 25], [35, 25], [35, 34], [64, 34], [64, 22]);
  b.cable('orange', [12, 24], [12, 25], [20, 25], [20, 8], [25, 8], [25, 14]);
  // N: 코일 A2
  b.cable('blue', [9, 26], [9, 27], [14, 27], [14, 0]);
  b.cable('blue', [29, 26], [34, 26], [34, 5], [14, 5]);
  b.part('text', -2, -6, '', { text: tr('정 · 역 운전 이중 인터록: 버튼 b접점 + 접촉기 b접점 (MC2 는 L1 · L3 을 바꿔 역회전)', 'Forward / reverse with double interlock (MC2 swaps L1 and L3)') });
  b.op(500, 'PB1', 'press', tr('정회전', 'Forward'));
  b.op(2000, 'PB2', 'press', tr('바로 역회전 (정회전이 먼저 떨어진다)', 'Reverse directly: forward drops first'));
  b.op(3000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/** 타이머 지연 점등: 스위치를 켜면 타이머 T1 이 돌기 시작하고 3초 뒤 한시 a접점 (8-6) 으로 램프가 켜진다 */
function lampDelay(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 32, 0, '', { pole: 'N' });
  b.part('r_mcb1', 2, 6, 'MCB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC/10A' });
  b.part('r_sw', 9, 10, 'S1', { name: tr('운전 스위치', 'Run switch') });
  b.part('r_timer8', 18, 20, 'T1', { name: tr('점등 지연', 'On delay'), timerMode: 'on', preset: 3000, sock: 'pf' });
  b.part('r_lamp', 28, 12, 'PL1', { name: tr('표시등', 'Indicator'), color: 'green' });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('brown', [2, 10], [2, 14], [8, 14], [8, 12]);
  // 스위치 2 → 타이머 전원 2 · 공통 8
  b.cable('red', [10, 12], [10, 26], [21, 26], [21, 23]);
  b.cable('red', [17, 26], [17, 23]);
  // 한시 a (8-6) → 램프
  b.cable('red', [15, 17], [15, 15], [27, 15], [27, 13]);
  // N: 타이머 7, 램프 X2
  b.cable('blue', [32, 0], [32, 28], [15, 28], [15, 23]);
  b.cable('blue', [29, 13], [29, 16], [32, 16]);
  b.part('text', 1, -4, '', { text: tr('타이머 지연 점등: 스위치를 켜고 3초 뒤에 표시등이 켜진다 (8핀 타이머 한시 a접점)', 'Delayed lamp: on 3 s after the switch (timed NO contact)') });
  b.op(1000, 'S1', 'on', tr('스위치 켬', 'Switch on'));
  b.op(4000, 'S1', 'off', tr('스위치 끔', 'Switch off'));
  return b.done();
}

/** 솔레노이드 밸브 2개 교번 동작: 플리커 타이머 T1 의 8-6 (a) 과 8-5 (b) 가 번갈아 SOL1 · SOL2 를 여자한다 */
function solAlternate(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 38, 0, '', { pole: 'N' });
  b.part('r_mcb1', 2, 6, 'MCB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC/10A' });
  b.part('r_sw', 9, 10, 'S1', { name: tr('운전 스위치', 'Run switch') });
  b.part('r_timer8', 18, 20, 'T1', { name: tr('교번 (1초)', 'Alternate (1 s)'), timerMode: 'flicker', preset: 1000, sock: 'pf' });
  b.part('r_sol', 28, 10, 'SOL1', { name: tr('밸브 A', 'Valve A'), spec: 'AC 220V' });
  b.part('r_sol', 28, 22, 'SOL2', { name: tr('밸브 B', 'Valve B'), spec: 'AC 220V' });
  // 스파크 킬러: 교류 SOL 코일의 두 단자에 나란히 (끊을 때의 서지를 흡수해 타이머 접점을 보호)
  b.part('r_sk', 33, 11, 'SK1', { name: tr('SOL1 서지 흡수', 'SOL1 surge') });
  b.part('r_sk', 33, 23, 'SK2', { name: tr('SOL2 서지 흡수', 'SOL2 surge') });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('brown', [2, 10], [2, 14], [8, 14], [8, 12]);
  b.cable('red', [10, 12], [10, 28], [21, 28], [21, 23]);
  b.cable('red', [17, 28], [17, 23]);
  // 8-6 (a) → SOL1, 8-5 (b) → SOL2
  b.cable('yellow', [15, 17], [15, 14], [27, 14], [27, 12]);
  b.cable('orange', [17, 17], [17, 13], [24, 13], [24, 26], [27, 26], [27, 24]);
  // N
  b.cable('blue', [38, 0], [38, 30], [15, 30], [15, 23]);
  b.cable('blue', [29, 12], [29, 15], [38, 15]);
  b.cable('blue', [29, 24], [29, 27], [38, 27]);
  // 스파크 킬러 리드선: 1 → SOL 의 1 쪽 선, 2 → N
  b.cable('yellow', [32, 13], [32, 14], [27, 14]);
  b.cable('blue', [34, 13], [34, 15]);
  b.cable('orange', [32, 25], [32, 26], [27, 26]);
  b.cable('blue', [34, 25], [34, 27]);
  b.part('text', 1, -4, '', { text: tr('솔레노이드 밸브 2개 교번: 플리커 타이머의 a · b 접점이 1초마다 번갈아 여자 (교류 SOL 코일마다 스파크 킬러)', 'Two solenoid valves alternating on a flicker timer (a spark killer across each AC coil)') });
  b.op(1000, 'S1', 'on', tr('운전', 'Run'));
  b.op(4500, 'S1', 'off', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 급수 펌프 수동 · 정지 · 자동 (3단 셀렉터): 조작 전원 → SS 13 · 23 (점퍼).
 *  - 수동 (왼쪽, 13-14): 정지 PB0 (b) → 기동 PB1 (a) ∥ MC1 13-14 → 코일
 *  - 자동 (오른쪽, 23-24): 플로트 FLS1 11-12 (b, 저수위에서 닫힘) → 코일
 *  - 가운데: 둘 다 열려 정지
 */
function pumpManualAuto(): Circuit {
  const b = new Builder();
  b.part('r_ss3', 21, 20, 'SS', { name: tr('수동 · 정지 · 자동', 'Manual / off / auto') });
  b.part('r_pb', 29, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 37, 20, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('r_float', 45, 20, 'FLS1', { name: tr('수조 수위', 'Tank level') });
  b.part('r_lamp', 22, 6, 'GL', { name: tr('펌프 운전', 'Pump running'), color: 'green' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [38, 22], hold: true, motor: tr('급수 펌프', 'Feed pump') });
  // 13 · 23 점퍼 (조작 전원)
  b.cable('red', [18, 22], [20, 22]);
  // 수동: SS 14 → 정지 → 기동 ∥ MC1 13-14
  b.cable('red', [22, 20], [28, 20]);
  b.cable('red', [30, 20], [33, 20], [33, 22], [36, 22]);
  b.cable('red', [33, 20], [33, 11], [10, 11], [10, 16]);
  // 자동: SS 24 → 플로트 11-12 (b) → 코일
  b.cable('yellow', [22, 22], [24, 22], [24, 25], [41, 25], [41, 20], [44, 20]);
  b.cable('yellow', [46, 20], [48, 20], [48, 26], [40, 26]);
  // 운전등: 코일과 나란히
  b.cable('red', [21, 7], [21, 9], [40, 9], [40, 22]);
  b.cable('blue', [23, 7], [23, 8], [14, 8]);
  b.part('text', -2, -4, '', { text: tr('급수 펌프 수동 · 정지 · 자동: 3단 셀렉터. 수동은 기동 · 정지 버튼 (자기유지), 자동은 플로트 스위치, 가운데는 정지', 'Feed pump with a 3-position selector: buttons in manual, float switch in auto, off in the centre') });
  b.op(500, 'SS', 'left', tr('수동', 'Manual'));
  b.op(1000, 'PB1', 'press', tr('기동', 'Start'));
  b.op(2500, 'PB0', 'press', tr('정지', 'Stop'));
  b.op(1500, 'SS', 'right', tr('자동 → 저수위라 운전', 'Auto: level low, runs'));
  b.op(2500, 'FLS1', 'on', tr('만수 → 정지', 'Tank full: stop'));
  b.op(2000, 'FLS1', 'off', tr('저수위 → 운전', 'Level low: run'));
  b.op(2000, 'SS', 'off', tr('가운데 (정지)', 'Centre: off'));
  return b.done();
}

/**
 * 생산 수량 카운터: 리밋 스위치 LS1 이 눌릴 때마다 카운터 C1 이 하나씩 세고 (CP-COM, 무전압 입력),
 * 설정 수 3 에 닿으면 C-NO 로 완료등 YL, C-NC 의 진행등 GL 은 꺼진다. 리셋 버튼 PB1 (RST-COM) 으로 0.
 */
function counterBasic(): Circuit {
  const b = new Builder();
  b.part('r_term', 3, 0, '', { pole: 'L' });
  b.part('r_term', 5, 0, '', { pole: 'N' });
  b.part('r_mcb2', 4, 6, 'MCB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC/10A' });
  b.part('r_counter', 20, 24, 'C1', { name: tr('생산 수량', 'Production count'), count: 3 });
  b.part('r_ls', 13, 14, 'LS1', { name: tr('제품 감지', 'Product detect') });
  b.part('r_pb', 27, 14, 'PB1', { name: tr('리셋', 'Reset'), color: 'yellow' });
  b.part('r_lamp', 30, 24, 'GL', { name: tr('진행 중', 'Counting'), color: 'green' });
  b.part('r_lamp', 38, 24, 'YL', { name: tr('완료', 'Done'), color: 'yellow' });
  b.cable('brown', [3, 0], [3, 2]);
  b.cable('blue', [5, 0], [5, 2]);
  // 입력 (무전압): CP ─ LS1 23-24 ─ COM ─ PB1 23-24 ─ RST
  b.cable('orange', [18, 19], [18, 18], [12, 18], [12, 16]);
  b.cable('orange', [20, 19], [20, 17], [14, 17], [14, 16]);
  b.cable('orange', [20, 17], [26, 17], [26, 16]);
  b.cable('orange', [22, 19], [22, 18], [28, 18], [28, 16]);
  // 전원: L → A1 · C, N → A2
  b.cable('brown', [3, 10], [3, 32], [20, 32], [20, 29]);
  b.cable('brown', [16, 29], [16, 30], [3, 30]);
  b.cable('blue', [5, 10], [5, 31], [18, 31], [18, 29]);
  // 출력: C-NC → 진행등, C-NO → 완료등, 램프 → N
  b.cable('red', [24, 29], [24, 30], [29, 30], [29, 25]);
  b.cable('red', [22, 29], [22, 31], [37, 31], [37, 25]);
  b.cable('blue', [5, 31], [5, 34], [39, 34], [39, 25]);
  b.cable('blue', [31, 25], [31, 34]);
  b.part('text', 1, -4, '', { text: tr('생산 수량 카운터: LS1 이 3번 눌리면 완료등 (C-NO), 진행등 (C-NC) 은 꺼짐. PB1 로 리셋', 'Production counter: after 3 counts the done lamp lights; PB1 resets') });
  b.op(1000, 'LS1', 'press', tr('제품 1', 'Product 1'));
  b.op(1000, 'LS1', 'press', tr('제품 2', 'Product 2'));
  b.op(1000, 'LS1', 'press', tr('제품 3 → 완료', 'Product 3: done'));
  b.op(2000, 'PB1', 'press', tr('리셋', 'Reset'));
  b.op(1500, 'LS1', 'press', tr('다시 세기', 'Counting again'));
  return b.done();
}

/**
 * SSR 로 히터 켜기: DC 24V 쪽 스위치 S1 → SSR 입력 3 (+) · 4 (-), 교류 쪽 L → SSR 1-2 → 히터 → N.
 * 히터처럼 자주 켜고 끄는 부하는 접점이 닳지 않는 SSR 로 바꿔 쓴다 (온도 조절기 · PLC 의 DC 출력으로 바로 구동).
 */
function ssrHeater(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 4, 0, '', { pole: 'N' });
  b.part('r_mcb2', 3, 6, 'MCB1', { name: tr('히터 전원', 'Heater supply'), spec: 'AC/20A' });
  b.part('r_ssr', 12, 8, 'SSR1', { name: tr('히터 개폐', 'Heater switching') });
  b.part('r_load1', 22, 8, 'H1', { name: tr('히터', 'Heater'), watt: 2000, pf: 1 });
  b.part('r_sw', 5, 18, 'S1', { name: tr('히터 운전 (DC)', 'Heater on (DC)') });
  b.part('r_term', 4, 27, '', { pole: '+24V' });
  b.part('r_term', 13, 27, '', { pole: '0V' });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('blue', [4, 0], [4, 2]);
  // 교류: L → SSR 1, SSR 2 → 히터, 히터 → N
  b.cable('brown', [2, 10], [2, 13], [8, 13], [8, 3], [11, 3], [11, 5]);
  b.cable('brown', [13, 5], [13, 3], [21, 3], [21, 5]);
  b.cable('blue', [4, 10], [4, 12], [6, 12], [6, 1], [23, 1], [23, 5]);
  // 직류: +24V → S1 → SSR 3 (+), SSR 4 (-) → 0V
  b.cable('red', [4, 27], [4, 20]);
  b.cable('red', [6, 20], [6, 23], [11, 23], [11, 11]);
  b.cable('blue', [13, 11], [13, 27]);
  b.part('text', 0, -4, '', { text: tr('SSR 로 히터 켜기: 입력 DC 24V (3 + · 4 -) 로 교류 히터 (1-2) 를 개폐', 'Heater on an SSR: a 24 V DC input (3 +, 4 -) switches the AC heater (1-2)') });
  b.op(1000, 'S1', 'on', tr('히터 켬', 'Heater on'));
  b.op(3000, 'S1', 'off', tr('히터 끔', 'Heater off'));
  return b.done();
}

/**
 * 히터 온도 제어: 운전 스위치 S1 → 온도 조절기 TC1 (A1 · A2 전원), C1-OUT → 전자접촉기 MC1 코일 → 주접점 → 히터 H1 (2 kW).
 * 경보 C2-AL → 과열 경보등 RL. 히터가 켜지면 2℃/초로 오르고 꺼지면 1℃/초로 내려간다 (설정 60℃, 히스테리시스 3℃).
 */
function tcHeater(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 4, 0, '', { pole: 'N' });
  b.part('r_mcb2', 3, 6, 'MCB1', { name: tr('히터 전원', 'Heater supply'), spec: 'AC/20A' });
  b.part('r_sw', 9, 18, 'S1', { name: tr('운전', 'Run') });
  b.part('r_tc', 20, 18, 'TC1', { name: tr('히터 온도', 'Heater temp.'), sv: 60, hys: 3, alarm: 80, tLoad: 'H1', amb: 20, rise: 2, fall: 1 });
  b.part('r_mc', 36, 20, 'MC1', { name: tr('히터 개폐', 'Heater contactor') });
  b.part('r_load1', 34, 34, 'H1', { name: tr('히터', 'Heater'), watt: 2000, pf: 1 });
  b.part('r_lamp', 27, 32, 'RL', { name: tr('과열 경보', 'Overheat'), color: 'red' });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('blue', [4, 0], [4, 2]);
  // L: 차단기 → S1, 차단기 → MC1 1/L1 → 2/T1 → 히터
  b.cable('brown', [2, 10], [2, 12], [2, 26], [8, 26], [8, 20]);
  b.cable('brown', [2, 12], [33, 12], [33, 16]);
  b.cable('brown', [33, 24], [33, 31]);
  // S1 뒤: 조절기 전원 A1, 출력 공통 C1 · C2
  b.cable('brown', [10, 20], [10, 27], [23, 27], [23, 23]);
  b.cable('brown', [15, 27], [15, 23]);
  b.cable('brown', [19, 27], [19, 23]);
  // OUT → MC1 코일 A1
  b.cable('brown', [21, 23], [21, 28], [29, 28], [29, 11], [34, 11], [34, 14]);
  // AL → 경보등
  b.cable('brown', [25, 23], [25, 35], [26, 35], [26, 33]);
  // N: 조절기 A2, MC1 A2, 히터, 경보등
  b.cable('blue', [4, 10], [4, 38], [38, 38], [38, 26]);
  b.cable('blue', [17, 23], [17, 38]);
  b.cable('blue', [28, 33], [28, 38]);
  b.cable('blue', [35, 31], [35, 38]);
  b.part('text', 0, -4, '', { text: tr('히터 온도 제어: 온도 조절기 OUT 이 전자접촉기를 켜고 끄며 60℃ 를 유지, 80℃ 이상이면 AL 로 과열 경보', 'Heater control: the controller OUT switches the contactor to hold 60℃; AL lights the overheat lamp at 80℃') });
  b.op(1000, 'S1', 'on', tr('운전', 'Run'));
  b.temp(39000, 'TC1', 85, 0, tr('과열 시험 (85℃)', 'Overheat test (85℃)'));
  return { ...b.done(), duration: 75000 };
}

/**
 * 판넬 온도 관리: 같은 판넬 안의 서모스탯 두 개 (온도 묶음 '판넬').
 *  - TS1 (NO, 35℃): 오르면 닫혀 판넬 팬 FAN1 운전, 30℃ 로 내려가면 정지
 *  - TS2 (NC, 10℃): 5℃ 로 내려가면 닫혀 결로 방지 히터 HT1, 10℃ 가 되면 정지
 * 판넬 온도는 조작 순서의 [온도 →] 로 여름 낮 · 겨울 밤처럼 천천히 바꾼다
 */
function panelThermo(): Circuit {
  const b = new Builder();
  const zone = tr('판넬', 'Panel');
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 4, 0, '', { pole: 'N' });
  b.part('r_mcb2', 3, 6, 'MCB1', { name: tr('판넬 팬 · 히터', 'Panel fan, heater'), spec: 'AC/10A' });
  b.part('r_thermo', 12, 10, 'TS1', { name: tr('팬 온도', 'Fan thermostat'), sv: 35, hys: 5, zone, amb: 25 });
  b.part('r_thermo', 30, 10, 'TS2', { name: tr('히터 온도', 'Heater thermostat'), ncOut: true, sv: 10, hys: 5, zone });
  b.part('r_fan', 20, 22, 'FAN1', { name: tr('판넬 팬', 'Panel fan') });
  b.part('r_load1', 38, 22, 'HT1', { name: tr('결로 방지 히터', 'Anti-condensation heater'), watt: 100, pf: 1 });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('blue', [4, 0], [4, 2]);
  // L → 서모스탯 1 번 단자
  b.cable('brown', [2, 10], [2, 16], [29, 16], [29, 13]);
  b.cable('brown', [11, 16], [11, 13]);
  // 서모스탯 2 번 → 팬 · 히터
  b.cable('brown', [13, 13], [13, 27], [19, 27], [19, 25]);
  b.cable('brown', [31, 13], [31, 14], [37, 14], [37, 19]);
  // N
  b.cable('blue', [4, 10], [4, 29], [43, 29], [43, 17], [39, 17], [39, 19]);
  b.cable('blue', [21, 25], [21, 29]);
  b.part('text', 0, -4, '', { text: tr('판넬 온도 관리: 35℃ 면 팬 (NO 서모스탯), 5℃ 면 결로 방지 히터 (NC 서모스탯). 두 서모스탯은 같은 판넬 온도를 잰다', 'Panel climate: fan at 35℃ (NO thermostat), anti-condensation heater at 5℃ (NC thermostat); both read the same panel temperature') });
  b.temp(1000, 'TS1', 40, 15000, tr('여름 낮', 'Summer day'));
  b.temp(17000, 'TS1', 25, 15000, tr('저녁', 'Evening'));
  b.temp(17000, 'TS1', 0, 25000, tr('겨울 밤', 'Winter night'));
  b.temp(27000, 'TS1', 15, 15000, tr('아침', 'Morning'));
  return { ...b.done(), duration: 80000 };
}

/**
 * 2선식 근접 센서: 갈색 · 파랑 두 선을 부하와 직렬로 (스위치처럼).
 *  - 직류 (왼쪽): +24V → PX1 갈색, 파랑 → 램프 PL1 → 0V
 *  - 교류 (오른쪽): L → 차단기 → PX2 → 램프 PL2 → N (교류용은 극성 없음)
 */
function prox2Wire(): Circuit {
  const b = new Builder();
  // 직류
  b.part('r_term', 0, 0, '', { pole: '+24V' });
  b.part('r_term', 14, 0, '', { pole: '0V' });
  b.part('r_prox2', 3, 8, 'PX1', { name: tr('제품 감지 (DC)', 'Part present (DC)'), sense: 'inductive' });
  b.part('r_lamp', 11, 12, 'PL1', { name: tr('감지 표시', 'Detected'), color: 'green', spec: 'DC 24V' });
  b.cable('red', [0, 0], [0, 13], [2, 13], [2, 11]);
  b.cable('yellow', [4, 11], [4, 15], [10, 15], [10, 13]);
  b.cable('blue', [12, 13], [12, 16], [14, 16], [14, 0]);
  // 교류
  b.part('r_term', 20, 0, '', { pole: 'L' });
  b.part('r_term', 32, 0, '', { pole: 'N' });
  b.part('r_mcb1', 20, 6, 'MCB1', { name: tr('센서 회로', 'Sensor circuit'), spec: 'AC/10A' });
  b.part('r_prox2', 24, 16, 'PX2', { name: tr('제품 감지 (AC)', 'Part present (AC)'), sense: 'inductive', ac: true });
  b.part('r_lamp', 29, 20, 'PL2', { name: tr('감지 표시', 'Detected'), color: 'yellow' });
  b.cable('brown', [20, 0], [20, 2]);
  b.cable('brown', [20, 10], [20, 21], [23, 21], [23, 19]);
  b.cable('red', [25, 19], [25, 23], [28, 23], [28, 21]);
  b.cable('blue', [30, 21], [30, 24], [32, 24], [32, 0]);
  b.part('text', 0, -4, '', { text: tr('2선식 근접 센서: 갈색 · 파랑을 부하와 직렬로 (직류는 갈색이 + 쪽, 교류는 극성 없음)', '2-wire proximity sensors in series with their loads (DC: brown on the + side; AC: no polarity)') });
  b.op(1000, 'PX1', 'on', tr('PX1 감지', 'PX1 detects'));
  b.op(1000, 'PX2', 'on', tr('PX2 감지', 'PX2 detects'));
  b.op(1000, 'PX1', 'off', tr('PX1 해제', 'PX1 clear'));
  b.op(1000, 'PX2', 'off', tr('PX2 해제', 'PX2 clear'));
  return b.done();
}

/**
 * 급수 펌프 자동 운전: 셀렉터 SS (자동 11-12 / 수동 23-24) 와 플로트 스위치 FLS1.
 *  - 자동: 저수위면 FLS1 11-12 (b) 가 닫혀 펌프 운전, 만수가 되면 열려 정지
 *  - 수동: 수위와 상관없이 운전
 */
function pumpFloat(): Circuit {
  const b = new Builder();
  b.part('r_ss', 21, 20, 'SS', { name: tr('자동 0 / 수동 1', 'Auto 0 / manual 1') });
  b.part('r_float', 29, 20, 'FLS1', { name: tr('수조 수위', 'Tank level') });
  b.part('r_lamp', 22, 6, 'GL', { name: tr('펌프 운전', 'Pump running'), color: 'green' });
  motorKit(b, { ctlTo: [20, 20], coilFrom: [30, 20], motor: tr('급수 펌프', 'Feed pump') });
  b.cable('red', [18, 22], [20, 22]);
  // 자동: SS 12 → 플로트 11, 플로트 12 → 코일. 수동: SS 24 → 코일
  b.cable('red', [22, 20], [28, 20]);
  b.cable('red', [22, 22], [24, 22], [24, 28]);
  b.cable('red', [21, 7], [21, 10], [34, 10], [34, 24], [32, 24]);
  b.cable('blue', [23, 7], [23, 9], [14, 9]);
  b.part('text', -2, -4, '', { text: tr('급수 펌프: 자동은 플로트 스위치 (저수위에서 운전 · 만수에서 정지), 수동은 바로 운전', 'Feed pump: float switch in auto, direct run in manual') });
  b.op(2000, 'FLS1', 'on', tr('만수 → 정지', 'Tank full: stop'));
  b.op(3000, 'FLS1', 'off', tr('저수위 → 운전', 'Level low: run'));
  b.op(2000, 'SS', 'on', tr('수동으로', 'Manual'));
  b.op(1000, 'FLS1', 'on', tr('만수여도 수동은 계속 운전', 'Full, but manual keeps running'));
  b.op(1500, 'SS', 'off', tr('자동으로 → 만수라 정지', 'Back to auto: stops'));
  return b.done();
}

/**
 * 직류 24V 센서 회로 (실물): L → 퓨즈 F1 → SMPS → +24V · 0V 모선 (덕트 안).
 *  - 근접 센서 PX1 (PNP): 갈색 +24V, 파랑 0V, 검정 → 릴레이 X1 코일 14, 13 → 0V
 *  - X1 9-5 (a) → 솔레노이드 밸브 SOL1, X1 12-8 (a) → 부저 BZ1
 *  - 전압계 V1 이 24V 를 보여 준다
 */
function dcSensor(): Circuit {
  const b = new Builder();
  b.part('r_term', -2, 0, '', { pole: 'PE' });
  b.part('r_term', 0, 0, '', { pole: 'L' });
  b.part('r_term', 2, 0, '', { pole: 'N' });
  b.part('r_fuse', 0, 6, 'F1', { name: tr('SMPS 입력', 'SMPS input'), amps: 3 });
  b.part('r_smps', 10, 10, 'PS1', { name: tr('직류 전원', 'DC supply') });
  b.cable('brown', [0, 0], [0, 3]);
  b.cable('brown', [0, 9], [0, 17], [6, 17], [6, 14]);
  b.cable('blue', [2, 0], [2, 18], [8, 18], [8, 14]);
  b.cable('gy', [-2, 0], [-2, 19], [10, 19], [10, 14]);
  // 직류 모선: +24V (y = 22), 0V (y = 24). 덕트가 덮는다
  b.cable('red', [14, 14], [14, 22], [32, 22]);
  b.cable('blue', [12, 14], [12, 24], [49, 24]);
  b.part('r_duct', 13, 21, '', { w: 37, h: 4 });
  b.part('r_prox', 22, 6, 'PX1', { name: tr('제품 감지', 'Part present'), sense: 'inductive' });
  b.part('r_my2', 32, 12, 'X1', { name: tr('감지 릴레이', 'Detect relay'), spec: 'DC 24V' });
  b.part('r_sol', 42, 8, 'SOL1', { name: tr('스토퍼 전진', 'Stopper out') });
  b.part('r_buzzer', 48, 8, 'BZ1', { name: tr('감지 알림', 'Detect alert') });
  // 센서: 갈색 → +24V, 파랑 → 0V, 검정 → X1 14
  b.cable('red', [20, 9], [20, 22]);
  b.cable('blue', [24, 9], [24, 24]);
  b.cable('yellow', [22, 9], [22, 19], [31, 19], [31, 17]);
  b.cable('blue', [33, 17], [33, 24]);
  // X1 공통 9 · 12 ← +24V, 5 → SOL1, 8 → BZ1
  b.cable('red', [32, 15], [32, 22]);
  b.cable('red', [30, 15], [30, 22]);
  b.cable('yellow', [32, 9], [32, 4], [38, 4], [38, 13], [41, 13], [41, 10]);
  b.cable('blue', [43, 10], [43, 24]);
  b.cable('yellow', [30, 9], [30, 3], [46, 3], [46, 12], [47, 12], [47, 9]);
  b.cable('blue', [49, 9], [49, 24]);
  // 전압계
  b.part('r_vm', 18, 30, 'V1', { name: tr('직류 전압', 'DC voltage') });
  b.cable('red', [17, 33], [17, 36], [14, 36], [14, 22]);
  b.cable('blue', [19, 33], [19, 37], [12, 37], [12, 24]);
  b.part('text', -3, -4, '', { text: tr('직류 24V 센서 회로: SMPS → 근접 센서 (PNP) → 릴레이 → 솔레노이드 밸브 · 부저', '24 V DC sensor circuit: SMPS, PNP proximity sensor, relay, solenoid valve and buzzer') });
  b.op(1000, 'PX1', 'on', tr('제품 감지', 'Part detected'));
  b.op(2000, 'PX1', 'off', tr('제품 지나감', 'Part gone'));
  return b.done();
}

/**
 * 자동 Y-Δ 기동 (6단자 전동기): 기동하면 주 접촉기 MC1 과 Y 접촉기 MC2 가 붙어 Y 결선으로 돌고,
 * 타이머 T1 (3초) 뒤 MC2 가 떨어지고 Δ 접촉기 MC3 이 붙어 Δ 결선으로 운전한다.
 *  - 주회로: MCB1 → MC1 → U1 V1 W1. MC3 은 L1 → W2, L2 → U2, L3 → V2 (Δ). MC2 는 W2 · U2 · V2 를 한데 묶는다 (Y)
 *  - 조작: F1 → 정지 PB0 → 기동 PB1 ∥ MC1 13-14 → MC1 코일 · T1 전원
 *    T1 8-5 (한시 b) → MC3 21-22 → MC2 코일 (Y), T1 8-6 (한시 a) → MC2 21-22 → MC3 코일 (Δ). MC2 · MC3 은 서로 b접점 인터록
 */
function starDelta(): Circuit {
  const b = new Builder();
  const COL: WireColor[] = ['brown', 'black', 'grey'];
  [4, 6, 8].forEach((x, k) => {
    b.part('r_term', x, 0, '', { pole: (['L1', 'L2', 'L3'] as const)[k] });
    b.cable(COL[k], [x, 0], [x, 2]);
    b.cable(COL[k], [x, 10], [x, 16]);
    b.cable(COL[k], [x, 24], [x, 32]);
    // Δ 접촉기 전원 쪽: 차단기 아래에서 갈라서 MC3 1 · 3 · 5 로
    b.cable(COL[k], [x, 11 + k], [24 + 2 * k, 11 + k], [24 + 2 * k, 16]);
    // MC3 아래 → 전동기 W2 · U2 · V2
    b.cable(COL[k], [24 + 2 * k, 24], [24 + 2 * k, 46 - k], [x, 46 - k], [x, 40]);
    // Y 접촉기 위 단자로 (세 선에서 갈라서)
    b.cable(COL[k], [14 + 2 * k, 46 - k], [14 + 2 * k, 50]);
  });
  b.part('r_term', 34, 0, '', { pole: 'N' });
  b.part('r_mcb3', 6, 6, 'MCB1', { name: tr('주 차단기', 'Main breaker'), spec: 'AC/30A' });
  b.part('r_mc', 7, 20, 'MC1', { name: tr('주 (Main)', 'Main'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_mc', 27, 20, 'MC3', { name: tr('Δ 운전', 'Delta'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_mc', 17, 54, 'MC2', { name: tr('Y 기동', 'Star'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  b.part('r_motor6', 6, 36, 'M1', { name: tr('3상 전동기 (Y-Δ)', '3-phase motor (Y-Δ)') });
  b.part('r_term', 14, 36, '', { pole: 'PE' });
  b.cable('gy', [11, 36], [14, 36]);
  // Y 접촉기 아래 세 단자를 한데 묶는다 (중성점)
  b.cable('black', [14, 58], [14, 61], [18, 61], [18, 58]);
  b.cable('black', [16, 58], [16, 61]);
  // 조작: F1 → 정지 PB0 → 기동 PB1 ∥ MC1 13-14
  b.part('r_fuse', 0, 16, 'F1', { name: tr('조작 회로', 'Control'), amps: 5 });
  b.part('r_pb', 41, 20, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.part('r_pb', 49, 20, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('r_timer8', 44, 34, 'T1', { name: tr('Y → Δ 전환', 'Star to delta'), timerMode: 'on', preset: 3000, sock: 'pf' });
  b.cable('red', [4, 12], [0, 12], [0, 13]);
  b.cable('red', [0, 19], [0, 29], [36, 29], [36, 20], [40, 20]);
  b.cable('red', [42, 20], [45, 20], [45, 22], [48, 22]);
  b.cable('red', [45, 20], [45, 9], [10, 9], [10, 16]);
  // 기동 뒤: MC1 코일 A1 · 자기유지 14, T1 전원 2 · 공통 8
  b.cable('red', [50, 22], [52, 22], [52, 27], [2, 27], [2, 13], [5, 13], [5, 14]);
  b.cable('red', [10, 27], [10, 24]);
  b.cable('red', [52, 27], [52, 40], [43, 40], [43, 37]);
  b.cable('red', [47, 40], [47, 37]);
  // Y: T1 5 (한시 b) → MC3 21-22 (인터록) → MC2 A1
  b.cable('yellow', [43, 31], [43, 30], [38, 30], [38, 14], [32, 14], [32, 16]);
  b.cable('yellow', [32, 24], [32, 47], [15, 47], [15, 48]);
  // Δ: T1 6 (한시 a) → MC2 21-22 (인터록) → MC3 A1
  b.cable('orange', [41, 31], [41, 28], [39, 28], [39, 42], [22, 42], [22, 50]);
  b.cable('orange', [22, 58], [22, 63], [54, 63], [54, 7], [25, 7], [25, 14]);
  // N: 코일 A2 · 타이머 7
  b.cable('blue', [34, 0], [34, 65], [19, 65], [19, 60]);
  b.cable('blue', [9, 26], [9, 28], [34, 28]);
  b.cable('blue', [29, 28], [29, 26]);
  b.cable('blue', [41, 37], [41, 39], [34, 39]);
  b.part('text', -2, -4, '', { text: tr('자동 Y-Δ 기동: Y 결선으로 기동 → 3초 뒤 Δ 결선 운전 (MC2 · MC3 인터록)', 'Automatic star-delta start: star first, delta after 3 s (interlocked)') });
  b.op(500, 'PB1', 'press', tr('기동 (Y)', 'Start (star)'));
  b.op(7000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

/**
 * 주거 배선: 누전차단기 → 스위치 → 전등, 콘센트. 중성선 바 · 접지 바에서 회로마다 한 가닥씩.
 */
function homeOutlet(): Circuit {
  const b = new Builder();
  b.part('r_term', 2, 0, '', { pole: 'L' });
  b.part('r_term', 4, 0, '', { pole: 'N' });
  b.part('r_term', 8, 0, '', { pole: 'PE' });
  b.part('r_mcb2', 3, 6, 'ELB1', { name: tr('전등 · 콘센트', 'Lights & outlets'), amps: 20, elb: true });
  b.part('r_nbar', 12, 14, 'NB1', { n: 4, pole: 'N' });
  b.part('r_nbar', 12, 18, 'PEB1', { n: 3, pole: 'PE' });
  b.part('r_sw', 24, 6, 'S1', { name: tr('거실 스위치', 'Living room switch') });
  b.part('r_light', 32, 6, 'EL1', { name: tr('거실등', 'Living room light') });
  b.part('r_outlet', 42, 8, 'CON1', { name: tr('거실 콘센트', 'Living room outlet') });
  b.cable('brown', [2, 0], [2, 2]);
  b.cable('blue', [4, 0], [4, 2]);
  // L: 차단기 2 → 스위치 1, 콘센트 L
  b.cable('brown', [2, 10], [2, 12], [40, 12], [40, 10]);
  b.cable('brown', [23, 12], [23, 8]);
  b.cable('red', [25, 8], [25, 10], [31, 10], [31, 8]);
  // N: 차단기 4 → 중성선 바, 바에서 전등 · 콘센트로 한 가닥씩
  b.cable('blue', [4, 10], [4, 14], [12, 14]);
  b.cable('blue', [14, 14], [14, 16], [33, 16], [33, 8]);
  b.cable('blue', [16, 14], [16, 15], [44, 15], [44, 10]);
  // PE: 접지 바 → 콘센트
  b.cable('gy', [8, 0], [8, 18], [12, 18]);
  b.cable('gy', [14, 18], [14, 20], [42, 20], [42, 10]);
  b.part('text', 1, -4, '', { text: tr('주거 배선: 누전차단기 → 스위치 → 전등, 콘센트 (중성선 바 · 접지 바)', 'Home wiring: ELB, switch, light and outlet with neutral and earth bars') });
  b.op(1000, 'S1', 'on', tr('스위치 켬', 'Switch on'));
  b.op(3000, 'S1', 'off', tr('스위치 끔', 'Switch off'));
  return b.done();
}

const H = 3600000;

/**
 * 타임 스위치로 전등 자동 점멸 (기본): 차단기 2P → 타임 스위치 시계 전원 L · N,
 * L 을 COM 에 점퍼, NO → 전등 L, 전등 N → N. 18:00~23:00 과 05:00~07:00 에 켜진다.
 */
function timeSwitchLight(): Circuit {
  const b = new Builder();
  b.part('r_term', 5, 0, '', { pole: 'L' });
  b.part('r_term', 7, 0, '', { pole: 'N' });
  b.part('r_mcb2', 6, 7, 'MCB1', { name: tr('전등 회로', 'Lighting'), spec: 'AC/20A' });
  b.cable('brown', [5, 0], [5, 3]);
  b.cable('blue', [7, 0], [7, 3]);
  b.part('r_tsw', 16, 9, 'TS1', {
    name: tr('전등 타이머', 'Light timer'),
    sched: [
      [18 * H, 23 * H],
      [5 * H, 7 * H],
    ],
  });
  // 시계 전원 L · N, L → COM 점퍼
  b.cable('brown', [5, 11], [5, 18], [12, 18], [12, 14]);
  b.cable('brown', [12, 18], [16, 18], [16, 14]);
  b.cable('blue', [7, 11], [7, 20], [28, 20], [28, 10]);
  b.cable('blue', [14, 14], [14, 20]);
  b.cable('blue', [28, 20], [34, 20], [34, 10]);
  // NO → 전등
  b.part('r_light', 27, 8, 'EL1', { name: tr('현관등', 'Porch light') });
  b.part('r_light', 33, 8, 'EL2', { name: tr('간판등', 'Sign light') });
  b.cable('red', [18, 14], [18, 16], [26, 16], [26, 10]);
  b.cable('red', [26, 16], [32, 16], [32, 10]);
  b.part('text', 1, -3, '', { text: tr('타임 스위치로 전등 자동 점멸: 18:00 켜짐 → 23:00 꺼짐, 05:00 켜짐 → 07:00 꺼짐', 'Lights on a 24-hour time switch: on 18:00–23:00 and 05:00–07:00') });
  return b.done();
}

/**
 * 타임 스위치 + 자동/수동 셀렉터 + 전자접촉기: 전등이 많으면 타임 스위치 접점으로 직접 켜지 않고 MC 코일만 움직인다.
 *  - 자동 (SS = 0): L → SS 11-12 → TS1 COM-NO → MC1 A1, A2 → N
 *  - 수동 (SS = 1): L → SS 23-24 → MC1 A1 (시각과 관계없이 점등)
 *  - 전등: L → MC1 1/L1-2/T1 → 전등 → N
 */
function timeSwitchPanel(): Circuit {
  const b = new Builder();
  b.part('r_term', 5, 0, '', { pole: 'L' });
  b.part('r_term', 7, 0, '', { pole: 'N' });
  b.part('r_mcb2', 6, 7, 'MCB1', { name: tr('전등 회로', 'Lighting'), spec: 'AC/30A' });
  b.cable('brown', [5, 0], [5, 3]);
  b.cable('blue', [7, 0], [7, 3]);
  b.part('r_tsw', 16, 9, 'TS1', { name: tr('가로등 타이머', 'Street light timer'), sched: [[18 * H, 6 * H]] });
  b.part('r_ss', 27, 8, 'SS', { name: tr('0 자동 · 1 수동', '0 auto · 1 manual') });
  b.part('r_mc', 12, 30, 'MC1', { name: tr('전등 점멸', 'Lights'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  // L: 차단기 2 → MC 1/L1, 타임 스위치 L, 셀렉터 11 · 23
  b.cable('brown', [5, 11], [5, 22], [9, 22], [9, 26]);
  b.cable('brown', [12, 14], [12, 18], [5, 18]);
  b.cable('red', [12, 18], [22, 18], [22, 8], [26, 8]);
  b.cable('red', [22, 10], [26, 10]);
  // N: 차단기 4 → 타임 스위치 N, MC A2, 전등 N
  b.cable('blue', [7, 11], [7, 40], [37, 40], [37, 32]);
  b.cable('blue', [14, 14], [14, 16], [7, 16]);
  b.cable('blue', [14, 36], [14, 40]);
  b.cable('blue', [25, 32], [25, 40]);
  b.cable('blue', [31, 32], [31, 40]);
  // 자동: SS 12 → TS COM, TS NO → MC A1.  수동: SS 24 → MC A1
  b.cable('red', [28, 8], [30, 8], [30, 16], [16, 16], [16, 14]);
  b.cable('red', [18, 14], [18, 20], [10, 20], [10, 24]);
  b.cable('red', [28, 10], [29, 10], [29, 20], [18, 20]);
  // 전등: MC 2/T1 → 전등 L
  b.part('r_light', 24, 30, 'EL1', { name: tr('가로등 1', 'Light 1') });
  b.part('r_light', 30, 30, 'EL2', { name: tr('가로등 2', 'Light 2') });
  b.part('r_light', 36, 30, 'EL3', { name: tr('가로등 3', 'Light 3') });
  b.cable('black', [9, 34], [9, 38], [35, 38], [35, 32]);
  b.cable('black', [23, 32], [23, 38]);
  b.cable('black', [29, 32], [29, 38]);
  b.part('text', 1, -3, '', { text: tr('타임 스위치 + 자동/수동 + 전자접촉기: 18:00 ~ 다음 날 06:00 점등, 수동으로 강제 점등', 'Time switch + auto/manual + contactor: on 18:00–06:00, manual override') });
  b.op(10 * H, 'SS', 'on', tr('수동 점등 (점검)', 'Manual on (check)'));
  b.op(1 * H, 'SS', 'off', tr('자동으로', 'Back to auto'));
  return b.done();
}

/** 3로 스위치 2개로 계단등: L → S1 0, S1 1-S2 1, S1 3-S2 3, S2 0 → 전등 → N. 어느 쪽에서 눌러도 바뀐다 */
function stairLight(): Circuit {
  const b = new Builder();
  b.part('r_term', 3, -5, '', { pole: 'L' });
  b.part('r_term', 31, 11, '', { pole: 'N' });
  b.part('r_mcb1', 3, 1, 'MCB1', { name: tr('전등 회로', 'Lighting'), spec: 'AC/16A' });
  b.cable('brown', [3, -5], [3, -3]);
  b.part('r_sw3', 8, 8, 'S1', { name: tr('아래층', 'Downstairs') });
  b.part('r_sw3', 18, 8, 'S2', { name: tr('위층', 'Upstairs') });
  b.part('r_light', 26, 6, 'EL1', { name: tr('계단등', 'Stair light') });
  b.cable('brown', [3, 5], [8, 5]);
  b.cable('red', [7, 10], [7, 14], [17, 14], [17, 10]);
  b.cable('black', [9, 10], [9, 12], [19, 12], [19, 10]);
  b.cable('red', [18, 5], [18, 2], [23, 2], [23, 11], [25, 11], [25, 8]);
  b.cable('blue', [27, 8], [27, 11], [31, 11]);
  b.part('text', 1, -9, '', { text: tr('3로 스위치 계단등: 아래층 · 위층 어디서나 켜고 끈다', '3-way stair light: switch from either floor') });
  b.op(1000, 'S1', 'on', tr('아래층에서 끔', 'Off from downstairs'));
  b.op(2000, 'S2', 'on', tr('위층에서 켬', 'On from upstairs'));
  b.op(2000, 'S1', 'off', tr('아래층에서 끔', 'Off from downstairs'));
  return b.done();
}

/**
 * 분전반 급전 해석: MAIN (메인 차단기 100 A → 부스바 → 분기 차단기) 에서 급전선으로 LP-1 · LP-2 로.
 *  - LP-1: 생산 라인 15 kW (10 mm² 40 m 급전, 6 mm² 15 m 분기) → 문제 없음
 *  - LP-2: 급전선이 2.5 mm² (허용 28 A) 인데 분기 차단기는 30 A → In > Iz
 *  - LP-2 조명 2 kW 를 1.5 mm² 80 m 로 → 전압강하가 3% 를 넘는다
 * 일부러 문제를 넣어 둔 연습용 회로다 (LP-2 급전선 6 mm², 조명 회로 10 mm² 로 키우면 해결).
 */
function feederAnalysis(): Circuit {
  const b = new Builder();
  const COL: WireColor[] = ['brown', 'black', 'grey'];
  const xl = (mm2: number, len: number, cores: 2 | 3 = 3): CableSpec => ({ ins: 'xlpe', mm2, method: 'B1', cores, len });
  // 부스바 허용전류 200 A 는 예로 적은 값 (실제로는 제조사 표)
  const bus: CableSpec = { kind: 'bus', ins: 'xlpe', mm2: 60, method: 'C', cores: 3, len: 0.5, iz: 200 };
  // ── MAIN: 수전 → 메인 차단기 → 부스바 → 분기 차단기 2개
  b.part('r_panel', 0, -4, 'MAIN', { name: tr('메인 분전반 380/220 V', 'Main panel 380/220 V'), w: 24, h: 31 });
  b.part('r_term', 4, 0, '', { pole: 'L1' });
  b.part('r_term', 6, 0, '', { pole: 'L2' });
  b.part('r_term', 8, 0, '', { pole: 'L3' });
  b.part('r_term', 21, 0, '', { pole: 'N' });
  b.part('r_mcb3', 6, 6, 'MCB0', { name: tr('메인', 'Main'), amps: 100 });
  b.part('r_mcb3', 6, 20, 'MCB1', { name: 'LP-1', amps: 50 });
  b.part('r_mcb3', 16, 20, 'MCB2', { name: 'LP-2', amps: 30 });
  [4, 6, 8].forEach((x, k) => {
    b.cable(COL[k], [x, 0], [x, 2]);
    b.cable(COL[k], [x, 10], [x, 12 + k]);
    // 부스바 (가로) 와 분기 차단기로 내려가는 선
    b.run(COL[k], bus, [x, 12 + k], [x + 10, 12 + k]);
    b.cable(COL[k], [x, 12 + k], [x, 16]);
    b.cable(COL[k], [x + 10, 12 + k], [x + 10, 16]);
  });
  // ── LP-1: 급전 10 mm² 40 m → 차단기 40 A → 생산 라인 15 kW
  b.part('r_panel', 0, 31, 'LP-1', { name: tr('1라인 분전반', 'Line 1 panel'), w: 12, h: 27 });
  b.part('r_mcb3', 6, 40, 'MCB11', { amps: 40 });
  b.part('r_load3', 6, 51, 'LD1', { name: tr('생산 라인 1', 'Production line 1'), watt: 15000, pf: 0.9 });
  [4, 6, 8].forEach((x, k) => {
    b.run(COL[k], xl(10, 40), [x, 24], [x, 36]);
    b.run(COL[k], xl(6, 15), [x, 44], [x, 48]);
  });
  // ── LP-2: 급전 2.5 mm² 60 m → 차단기 20 A → 컴프레서 3.7 kW, 조명 2 kW (L3 · N)
  b.part('r_panel', 13, 31, 'LP-2', { name: tr('2라인 분전반', 'Line 2 panel'), w: 19, h: 27 });
  b.part('r_mcb3', 16, 40, 'MCB21', { amps: 20 });
  b.part('r_load3', 16, 51, 'M1', { name: tr('공기 압축기', 'Air compressor'), watt: 3700, pf: 0.85 });
  [14, 16, 18].forEach((x, k) => {
    b.run(COL[k], xl(2.5, 60), [x, 24], [x, 36]);
    b.run(COL[k], xl(2.5, 10), [x, 44], [x, 48]);
  });
  b.part('r_mcb1', 26, 42, 'MCB22', { name: tr('조명', 'Lighting'), amps: 16 });
  b.part('r_load1', 27, 53, 'LD2', { name: tr('작업장 조명', 'Workshop lighting'), watt: 2000, pf: 1, lighting: true });
  b.cable('grey', [18, 45], [22, 45], [22, 37], [26, 37], [26, 38]);
  const light: CableSpec = { ins: 'pvc', mm2: 1.5, method: 'B1', cores: 2, len: 80 };
  b.run('grey', light, [26, 46], [26, 50]);
  b.run('blue', light, [21, 0], [21, 48], [28, 48], [28, 50]);
  b.part('text', 1, -7, '', { text: tr('분전반 급전 해석: MAIN → LP-1 · LP-2 (일부러 넣은 문제 2개를 [해석] 탭에서 찾아 고쳐 보세요)', 'Feeder analysis: MAIN → LP-1, LP-2 (find and fix the two problems in the Analysis tab)') });
  b.op(3000, 'MCB1', 'off', tr('LP-1 차단', 'LP-1 off'));
  b.op(3000, 'MCB1', 'on', tr('LP-1 투입', 'LP-1 on'));
  return b.done();
}

/**
 * 분전반 (부스바 · 누전차단기 분기): 수전 → 메인 4P 125 A → 세로 부스바 L1 L2 L3 N →
 * 왼쪽 · 오른쪽으로 옆으로 돌린 분기 차단기 (전원 쪽 단자가 부스바를 본다) → 판넬 밖 부하.
 *  - 3상 분기 3개 (공조기 · 히터 · 컨베이어), 단상 2P 분기 2개 (조명 L1-N, 콘센트 L2-N)
 *  - 분기선은 부스바 위로 지나가서 자기 상 막대에만 볼트로 물린다 (점이 찍힌 곳)
 * 직접 만든 예이며 굵기 · 정격은 문제가 없게 골라 두었다.
 */
function busPanel(): Circuit {
  const b = new Builder();
  const COL: WireColor[] = ['brown', 'black', 'grey', 'blue'];
  const xl = (mm2: number, len: number, cores: 2 | 3 = 3, method: CableSpec['method'] = 'B1'): CableSpec => ({ ins: 'xlpe', mm2, method, cores, len });
  b.part('r_panel', 3, -2, 'LP-1', { name: tr('동력 · 전등 분전반', 'Power & lighting panel'), w: 34, h: 48 });
  // 수전 · 메인 4P · 부스바 (막대 x = 17 · 19 · 21 · 23)
  [17, 19, 21, 23].forEach((x, k) => {
    b.part('r_term', x, -6, '', { pole: (['L1', 'L2', 'L3', 'N'] as const)[k] });
    b.run(COL[k], xl(35, 20, 3), [x, -6], [x, 2]);
    b.run(COL[k], xl(35, 0.3, 3, 'C'), [x, 10], [x, 12]);
  });
  b.part('r_mcb4', 20, 6, 'MCB0', { name: tr('메인', 'Main'), amps: 125 });
  b.part('r_bus', 17, 12, 'BUS1', { bars: 4, h: 30, mm2: 100, amps: 250 });
  // 분기 차단기 (옆으로): 왼쪽은 90° (전원 쪽이 오른쪽), 오른쪽은 270° (전원 쪽이 왼쪽)
  const branch3 = (x: number, y: number, rot: 90 | 270, tag: string, name: string, amps: number, elb = true) => {
    b.part('r_mcb3', x, y, tag, { name, amps, rot, ...(elb ? { elb: true } : {}) });
  };
  branch3(9, 16, 90, 'ELB1', tr('공조기', 'Air handler'), 30);
  branch3(9, 26, 90, 'ELB2', tr('히터', 'Heater'), 40);
  branch3(31, 17, 270, 'MCB3', tr('컨베이어', 'Conveyor'), 20, false);
  b.part('r_mcb2', 31, 31, 'ELB4', { name: tr('조명', 'Lighting'), amps: 20, rot: 270, elb: true });
  b.part('r_mcb2', 31, 37, 'ELB5', { name: tr('콘센트', 'Outlets'), amps: 20, rot: 270, elb: true });
  // 탭 (분기선): 차단기 전원 쪽 단자 → 자기 상 막대
  const tap = (color: WireColor, mm2: number, from: [number, number], barX: number, cores: 2 | 3 = 3) => b.run(color, xl(mm2, 0.3, cores, 'C'), from, [barX, from[1]]);
  [0, 1, 2].forEach((k) => {
    tap(COL[k], 6, [13, 14 + 2 * k], 17 + 2 * k);
    tap(COL[k], 10, [13, 24 + 2 * k], 17 + 2 * k);
    tap(COL[k], 4, [27, 19 - 2 * k], 17 + 2 * k);
  });
  tap('brown', 2.5, [27, 32], 17, 2);
  tap('blue', 2.5, [27, 30], 23, 2);
  tap('black', 2.5, [27, 38], 19, 2);
  tap('blue', 2.5, [27, 36], 23, 2);
  // 판넬 밖 부하 (아래 줄): 위 차단기의 선이 바깥쪽 기둥으로 (엇갈리지 않게 계단처럼)
  b.part('r_load3', -10, 56, 'AHU1', { name: tr('공조기', 'Air handler'), watt: 11000, pf: 0.85 });
  b.part('r_load3', -1, 56, 'HT1', { name: tr('히터', 'Heater'), watt: 15000, pf: 1 });
  b.part('r_load3', 58, 56, 'CV1', { name: tr('컨베이어', 'Conveyor'), watt: 5500, pf: 0.85 });
  b.part('r_load1', 49, 56, 'EL1', { name: tr('조명', 'Lighting'), watt: 2000, pf: 1, lighting: true });
  b.part('r_load1', 40, 56, 'OUT1', { name: tr('콘센트', 'Outlets'), watt: 2200, pf: 0.95 });
  [0, 1, 2].forEach((k) => {
    b.run(COL[k], xl(6, 30), [5, 14 + 2 * k], [-12 + 2 * k, 14 + 2 * k], [-12 + 2 * k, 53]);
    b.run(COL[k], xl(10, 40), [5, 24 + 2 * k], [-3 + 2 * k, 24 + 2 * k], [-3 + 2 * k, 53]);
    b.run(COL[k], xl(4, 25), [35, 19 - 2 * k], [56 + 2 * k, 19 - 2 * k], [56 + 2 * k, 53]);
  });
  b.run('brown', xl(2.5, 30, 2), [35, 32], [48, 32], [48, 53]);
  b.run('blue', xl(2.5, 30, 2), [35, 30], [50, 30], [50, 53]);
  b.run('black', xl(2.5, 20, 2), [35, 38], [39, 38], [39, 53]);
  b.run('blue', xl(2.5, 20, 2), [35, 36], [41, 36], [41, 53]);
  b.part('text', 3, -9, '', { text: tr('분전반: 메인 4P → 부스바 → 누전차단기 분기 (옆으로 놓고 자기 상 막대에 탭)', 'Panelboard: 4P main → busbar → ELB branches tapped onto their bars') });
  b.op(2000, 'ELB2', 'off', tr('히터 끔', 'Heater off'));
  b.op(2000, 'ELB2', 'on', tr('히터 켬', 'Heater on'));
  return b.done();
}

/**
 * 수전 설비 (계통 해석): 한전 22.9 kV 수전 → VCB → 변압기 500 kVA (Δ-Y, %Z 5) → 저압 메인 4P 800 A →
 * 부스바 → 분기 차단기 4개 → 부하. 변압기 부하율 · 전압 변동, 차단기마다 설치점 단락 전류와 차단 용량을 검토한다.
 * 일부러 넣은 문제 1개: 조명 누전차단기의 차단 용량 (5 kA) 이 설치점 단락 전류보다 작다.
 * 직접 만든 예이며 이름은 일반 이름만 쓴다.
 */
function substation(): Circuit {
  const b = new Builder();
  const COL: WireColor[] = ['brown', 'black', 'grey', 'blue'];
  const xl = (mm2: number, len: number, cores: 2 | 3 = 3, method: CableSpec['method'] = 'B1'): CableSpec => ({ ins: 'xlpe', mm2, method, cores, len });
  const bus = (len: number): CableSpec => ({ kind: 'bus', ins: 'xlpe', mm2: 500, method: 'C', cores: 3, len, iz: 1000 });
  b.part('r_panel', 13, 4, 'HV-1', { name: tr('수전반 (특고압)', 'HV receiving panel'), w: 14, h: 24 });
  b.part('r_panel', 3, 29, 'LV-1', { name: tr('저압 배전반', 'LV switchboard'), w: 34, h: 36 });
  // 특고압: 한전 → VCB → 변압기 1차
  b.part('r_kepco', 20, -8, 'KEPCO', { name: tr('한전 22.9 kV', 'Utility 22.9 kV'), kv: 22.9, ka: 12.5 });
  [18, 20, 22].forEach((x) => {
    b.run('black', undefined, [x, -5], [x, 6]);
    b.run('black', undefined, [x, 14], [x, 16]);
  });
  b.part('r_vcb', 20, 10, 'VCB', { name: tr('수전 차단기', 'Incoming VCB'), amps: 630, ka: 25 });
  b.part('r_tr3', 20, 21, 'TR1', { name: tr('주 변압기', 'Main transformer'), kva: 500, kv: 22.9, z: 5, xr: 5 });
  // 저압: 변압기 2차 → 메인 → 부스바 (막대 x = 17 · 19 · 21 · 23)
  [17, 19, 21, 23].forEach((x, k) => {
    b.run(COL[k], bus(2), [x, 26], [x, 28]);
    b.run(COL[k], bus(0.5), [x, 36], [x, 38]);
  });
  b.part('r_mcb4', 20, 32, 'ACB', { name: tr('저압 메인', 'LV main'), amps: 800, ka: 50 });
  b.part('r_bus', 17, 38, 'BUS1', { bars: 4, h: 24, mm2: 500, amps: 1000 });
  // 분기 (옆으로): 왼쪽 90°, 오른쪽 270°
  b.part('r_mcb3', 9, 42, 'MCB1', { name: tr('공조 설비', 'HVAC'), amps: 250, ka: 35, rot: 90 });
  b.part('r_mcb3', 9, 52, 'MCB2', { name: tr('냉동기', 'Chiller'), amps: 150, ka: 35, rot: 90 });
  b.part('r_mcb3', 31, 43, 'MCB3', { name: tr('컨베이어 라인', 'Conveyor line'), amps: 125, ka: 35, rot: 270 });
  b.part('r_mcb2', 31, 55, 'ELB4', { name: tr('조명', 'Lighting'), amps: 30, ka: 5, rot: 270, elb: true });
  const tap = (color: WireColor, mm2: number, from: [number, number], barX: number, cores: 2 | 3 = 3) => b.run(color, xl(mm2, 0.3, cores, 'C'), from, [barX, from[1]]);
  [0, 1, 2].forEach((k) => {
    tap(COL[k], 95, [13, 40 + 2 * k], 17 + 2 * k);
    tap(COL[k], 50, [13, 50 + 2 * k], 17 + 2 * k);
    tap(COL[k], 35, [27, 45 - 2 * k], 17 + 2 * k);
  });
  tap('brown', 6, [27, 56], 17, 2);
  tap('blue', 6, [27, 54], 23, 2);
  // 부하 (판넬 밖 아래 줄)
  b.part('r_load3', -10, 70, 'AHU1', { name: tr('공조기', 'Air handler'), watt: 110000, pf: 0.85 });
  b.part('r_load3', -1, 70, 'CH1', { name: tr('냉동기', 'Chiller'), watt: 75000, pf: 0.85 });
  b.part('r_load3', 58, 70, 'CV1', { name: tr('컨베이어', 'Conveyor'), watt: 55000, pf: 0.85 });
  b.part('r_load1', 49, 70, 'EL1', { name: tr('조명', 'Lighting'), watt: 5000, pf: 1, lighting: true });
  [0, 1, 2].forEach((k) => {
    b.run(COL[k], xl(95, 40), [5, 40 + 2 * k], [-12 + 2 * k, 40 + 2 * k], [-12 + 2 * k, 67]);
    b.run(COL[k], xl(50, 30), [5, 50 + 2 * k], [-3 + 2 * k, 50 + 2 * k], [-3 + 2 * k, 67]);
    b.run(COL[k], xl(35, 60), [35, 45 - 2 * k], [56 + 2 * k, 45 - 2 * k], [56 + 2 * k, 67]);
  });
  b.run('brown', xl(6, 50, 2), [35, 56], [48, 56], [48, 67]);
  b.run('blue', xl(6, 50, 2), [35, 54], [50, 54], [50, 67]);
  b.part('text', 3, -15, '', { text: tr('수전 설비: 한전 22.9 kV → VCB → 변압기 500 kVA → 저압 메인 → 부스바 → 분기 (해석 탭: 변압기 부하율 · 단락 전류)', 'Substation: utility 22.9 kV → VCB → 500 kVA transformer → LV main → busbar → branches') });
  b.op(2000, 'VCB', 'off', tr('수전 차단', 'Incoming off'));
  b.op(2000, 'VCB', 'on', tr('수전 투입', 'Incoming on'));
  const c = b.done();
  // 고압 수전: 전압강하 허용값 조명 6% · 기타 8%
  return { ...c, supply: 'hv' };
}

/** PLC 자기유지: 기동 PB → X0, 정지 PB → X1, Y0 운전 램프, T0(3초) 뒤 Y1 램프 */
function plcSelfHold(): Circuit {
  const b = new Builder();
  b.part('src', 1, 2, '', { pole: '+24V' });
  b.part('src', 1, 23, '', { pole: '0V' });
  b.wire([1, 2], [21, 2]);
  b.wire([1, 23], [21, 23]);
  b.part('plc', 12, 12, 'PLC1', { name: tr('미쓰비시 FX', 'Mitsubishi FX'), inBase: 'X0', outBase: 'Y0' });
  b.part('pb_no', 5, 5, 'PB1', { name: tr('기동', 'Start'), color: 'green' });
  b.part('pb_no', 9, 5, 'PB0', { name: tr('정지', 'Stop'), color: 'red' });
  b.wire([5, 2], [5, 3]);
  b.wire([5, 7], [5, 9]);
  b.wire([9, 2], [9, 3]);
  b.wire([9, 7], [9, 8], [7, 8], [7, 9]);
  // 출력 공통 C 는 +24V, 출력 → 램프 → 0V
  b.wire([3, 15], [3, 2]);
  b.part('lamp', 5, 19, 'GL', { name: tr('운전', 'Run'), color: 'green' });
  b.wire([5, 15], [5, 17]);
  b.wire([5, 21], [5, 23]);
  b.part('lamp', 11, 19, 'YL', { name: tr('3초 뒤', 'After 3 s'), color: 'yellow' });
  b.wire([7, 15], [7, 16], [11, 16], [11, 17]);
  b.wire([11, 21], [11, 23]);
  b.part('text', 1, -1, '', { text: tr('PLC 자기유지 + 타이머 (미쓰비시 FX)', 'PLC self-hold + timer (Mitsubishi FX)') });
  b.op(500, 'PB1', 'press', tr('기동', 'Start'));
  b.op(5000, 'PB0', 'press', tr('정지', 'Stop'));
  return b.done();
}

function plcSelfHoldProgram(): PlcConfig {
  const source = ['LD X0', 'OR Y0', 'ANI X1', 'OUT Y0', 'LD Y0', 'OUT T0 K30', 'LD T0', 'OUT Y1', 'END'].join('\n');
  const comments = [
    ['X0', tr('기동 PB', 'Start PB')],
    ['X1', tr('정지 PB', 'Stop PB')],
    ['Y0', tr('운전 램프', 'Run lamp')],
    ['T0', tr('3초 타이머', '3 s timer')],
    ['Y1', tr('3초 뒤 램프', 'Lamp after 3 s')],
  ]
    .map(([k, v]) => `${k}\t${v}`)
    .join('\n');
  // PLC 탭에서 래더로 열린다 (래더를 고치면 니모닉이 다시 만들어진다)
  return { dialect: 'mitsubishi', source, comments, sim: { ...defaultSimSettings(), watch: ['X0', 'X1', 'Y0', 'T0', 'Y1'] }, view: 'ladder', ladder: ilToLadder(source, 'mitsubishi').ladder };
}

// ───────────────────── 넷 목록으로 선 긋기 (설계한 연결 그대로) ─────────────────────

/** 단자: [기기, 단자 이름 또는 차례] */
type NetPin = [Part, string | number];
type NetList = [WireColor, NetPin[]][];

/** 라우터가 그은 선 (예제마다 그림은 늘 같으므로 한 번만 긋고, 부를 때마다 새 id 로) */
const routedWires = new Map<string, Omit<Wire, 'id'>[]>();

/** 넷마다 단자를 잇는 선을 라우터로 긋는다 (다른 넷과 엉뚱하게 이어지지 않게) */
function routeNets(b: Builder, key: string, nets: () => NetList): void {
  if (!routedWires.has(key)) {
    const devs = new Map<string, RouteDev>();
    const colors: WireColor[] = [];
    nets().forEach(([color, pins], id) => {
      colors[id] = color;
      for (const [part, at] of pins) {
        const i = typeof at === 'number' ? at : partPins(part).findIndex((q) => q.label === at);
        if (i < 0 || i >= partPins(part).length) throw new Error(`${key}: ${part.tag} 에 ${at} 단자가 없습니다`);
        const d = devs.get(part.id) ?? { part, pins: new Map<number, number>() };
        d.pins.set(i, id);
        devs.set(part.id, d);
      }
    });
    const r = routeAll([...devs.values()], (n) => colors[n]);
    routedWires.set(
      key,
      r.wires.map(({ id: _id, ...w }) => w),
    );
  }
  for (const w of routedWires.get(key)!) b.wires.push({ ...w, id: uid('cw') });
}

// ───────────────────── 열풍기 온도 제어 + 24시간 타이머 (T3S 꼴 조절기 · Pt100) ─────────────────────

/**
 * 단상 220 V 열풍기 5 kW: 누전차단기 → 전자접촉기 → 열풍기 (외함 접지). 조작은 퓨즈 F1 뒤에서
 *  - 온도 조절기 TC1 (8핀, T3S 꼴): 측온저항체 Pt100 (3선식) 로 작업장 온도를 재서 20℃ 아래면 출력 (COM-NO) → MC1 코일
 *  - 운전 선택 SS1: 자동 = 24시간 타이머 (08~18시) 를 거쳐서, 수동 = 바로 (잔업), 가운데 = 정지
 *  - 운전등 GL1 = MC1 보조 a접점
 * 온도: 주위 5℃, 열풍기가 켜지면 분당 0.6℃ 오르고 꺼지면 분당 0.2℃ 내림 → 켜진 시간만큼 전력량 · 요금 ([해석] 탭)
 */
function blowerTimer(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 2, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 4, 0, '', { pole: 'N' });
  const tPE = b.part('r_term', 7, 0, '', { pole: 'PE' });
  const elb = b.part('r_mcb2', 3, 6, 'ELB1', { name: tr('주 차단기', 'Main RCD'), spec: 'AC 220V 30A', amps: 30, elb: true, idn: 30 });
  const f1 = b.part('r_fuse', 10, 6, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const tsw = b.part('r_tsw', 18, 7, 'TSW1', { name: tr('운전 시간 08~18시', 'Run 08:00–18:00'), sched: [[8 * 3600000, 18 * 3600000]] });
  const ss1 = b.part('r_ss3', 28, 8, 'SS1', { name: tr('운전 선택', 'Mode'), pos3: tr('수동/정지/자동', 'Manual/Off/Auto'), pos0: 1 });
  const mc = b.part('r_mc', 5, 25, 'MC1', { name: tr('열풍기 개폐', 'Blower contactor'), spec: tr('코일 AC 220V, 주접점 AC-1 32A', 'coil AC 220V, AC-1 32 A') });
  const tc = b.part('r_tc8', 38, 8, 'TC1', { name: tr('작업장 온도', 'Workshop temp.'), spec: 'T3S-B4RP2C-N', sv: 20, hys: 2, tLoad: 'HT1', zone: tr('작업장', 'Workshop'), amb: 5, tmax: 35, rise: 0.01, fall: 0.0033 });
  const rtd = b.part('r_rtd', 53, -4, 'PT1', { name: 'Pt100 Ω' });
  const ht = b.part('r_load1', 3, 39, 'HT1', { name: tr('열풍기 5 kW', 'Hot-air blower 5 kW'), watt: 5000, pf: 1, pe: true });
  const gl = b.part('r_lamp', 14, 39, 'GL1', { name: tr('운전', 'Running'), color: 'green' });
  const peb = b.part('r_nbar', 8, 47, 'PEB', { n: 3, pole: 'PE', name: tr('접지 바', 'Earth bar') });
  b.part('text', 0, -5, '', { text: tr('열풍기 온도 제어: 측온저항체 → 온도 조절기 (T3S 꼴) → 전자접촉기 → 열풍기 5 kW, 24시간 타이머로 08~18시만 자동 운전', 'Hot-air blower: RTD → controller (T3S type) → contactor → 5 kW blower, 24-h timer runs it 08:00–18:00') });
  [
    tr('▶ [해석] 탭 아래 [전력량 · 전기 요금]: 하루 사용량 · 요금과 한 달 어림', '▶ Analysis tab → Energy & cost: daily use, cost and a monthly estimate'),
    tr('SS1 자동 = 타이머 시간에만, 수동 = 시간과 상관없이 온도로만, 가운데 = 정지', 'SS1 Auto = timer hours only, Manual = temperature only, centre = off'),
    tr('측온저항체 선을 하나 빼면 TC1 이 oPEn 으로 출력을 끕니다', 'Remove an RTD lead and TC1 shows oPEn with its output off'),
  ].forEach((x, k) => b.part('text', 24, 28 + k * 2, '', { text: x }));
  routeNets(b, 'blower-timer', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [elb, '1']);
    net('blue', [tN, ''], [elb, '3']);
    net('brown', [elb, '2'], [mc, '1/L1'], [f1, '1']);
    net('blue', [elb, '4'], [mc, '3/L2'], [mc, 'A2'], [tc, 'N'], [tsw, 'N'], [gl, 'X2']);
    net('brown', [mc, '2/T1'], [ht, 'L']);
    net('blue', [mc, '4/T2'], [ht, 'N']);
    // 조작 (퓨즈 뒤, 노랑): 조절기 · 타이머 전원, 타이머 COM, 수동 13, MC1 보조 13
    net('yellow', [f1, '2'], [tc, 'L'], [tsw, 'L'], [tsw, 'COM'], [ss1, '13'], [mc, '13NO']);
    net('yellow', [tsw, 'NO'], [ss1, '23']);
    net('yellow', [ss1, '14'], [ss1, '24'], [tc, 'COM']);
    net('yellow', [tc, 'NO'], [mc, 'A1']);
    net('yellow', [mc, '14NO'], [gl, 'X1']);
    // 측온저항체: A (빨강) · B · B' (흰색 두 가닥)
    net('red', [rtd, 'A'], [tc, 'A']);
    net('white', [rtd, 'B'], [tc, 'B']);
    net('white', [rtd, "B'"], [tc, "B'"]);
    net('gy', [tPE, ''], [peb, '1']);
    net('gy', [ht, 'PE'], [peb, '2']);
    return nets;
  });
  const c = b.done();
  c.system = '1p2w';
  // 19시에 잔업으로 수동 운전, 20시에 다시 자동 (타이머 시간이 지나 꺼짐)
  c.ops = [
    { id: uid('op'), wait: 19 * 3600000, tag: 'SS1', action: 'left', hold: 0, note: tr('잔업: 수동 운전', 'Overtime: manual') },
    { id: uid('op'), wait: 3600000, tag: 'SS1', action: 'right', hold: 0, note: tr('자동으로 (타이머 밖이라 꺼짐)', 'Back to auto (outside the timer)') },
  ];
  return c;
}

// ───────────────────── 인버터 정 · 역 운전 (다단속 · 가감속 · 고장 경보) ─────────────────────

/**
 * 3상 380 V → 배선용 차단기 → 인버터 INV1 → 전동기 M1.
 *  - 운전 셀렉터 SS1 (정회전 · 정지 · 역회전): 공통 SD, 왼쪽 → STF, 오른쪽 → STR
 *  - 속도 셀렉터 SS2 (저속 · 고속): b접점 → RL (10 Hz), a접점 → RH (60 Hz)
 *  - 고장 릴레이 A-C → 적색 경보등 RL1 (조작 전원 L1 · N, 퓨즈 F1)
 * 가 · 감속 5 초 (0 ↔ 60 Hz), 30 초에 고장 (트립) 을 일으켜 본다
 */
function vfdFwdRev(): Circuit {
  const b = new Builder();
  const T = (pole: 'L1' | 'L2' | 'L3' | 'N' | 'PE', x: number) => b.part('r_term', x, 0, '', { pole });
  const [t1, t2, t3, tN, tPE] = [T('L1', 2), T('L2', 4), T('L3', 6), T('N', 8), T('PE', 10)];
  const mccb = b.part('r_mcb3', 4, 6, 'MCCB', { name: tr('인버터 전원', 'Inverter supply'), amps: 10 });
  const f1 = b.part('r_fuse', 14, 6, 'F1', { name: tr('경보 회로', 'Alarm circuit'), amps: 2 });
  const inv = b.part('r_vfd', 14, 22, 'INV1', { name: tr('컨베이어', 'Conveyor'), spec: tr('3상 380V 0.75kW', '3-phase 380V 0.75kW') });
  const m1 = b.part('r_motor3', 8, 38, 'M1', { name: tr('컨베이어 전동기', 'Conveyor motor') });
  const ss1 = b.part('r_ss3', 16, 40, 'SS1', { name: tr('운전', 'Run'), pos3: tr('정회전/정지/역회전', 'FWD/STOP/REV') });
  const ss2 = b.part('r_ss', 24, 40, 'SS2', { name: tr('속도 (저속 · 고속)', 'Speed (low / high)') });
  const rl = b.part('r_lamp', 32, 12, 'RL1', { name: tr('인버터 고장', 'Inverter fault'), color: 'red' });
  b.part('text', 0, -5, '', { text: tr('인버터 정 · 역 운전: 셀렉터로 정회전 · 역회전, 저속 (RL 10 Hz) · 고속 (RH 60 Hz), 가감속 5초, 고장 경보 (A-C)', 'Inverter forward / reverse: selector for direction, low (RL 10 Hz) / high (RH 60 Hz), 5 s ramps, fault alarm (A–C)') });
  routeNets(b, 'vfd-fwd-rev', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [t1, ''], [mccb, '1']);
    net('black', [t2, ''], [mccb, '3']);
    net('grey', [t3, ''], [mccb, '5']);
    net('brown', [mccb, '2'], [inv, 'R/L1'], [f1, '1']);
    net('black', [mccb, '4'], [inv, 'S/L2']);
    net('grey', [mccb, '6'], [inv, 'T/L3']);
    net('brown', [inv, 'U'], [m1, 'U']);
    net('black', [inv, 'V'], [m1, 'V']);
    net('grey', [inv, 'W'], [m1, 'W']);
    net('red', [f1, '2'], [inv, 'C']);
    net('red', [inv, 'A'], [rl, 'X1']);
    net('blue', [rl, 'X2'], [tN, '']);
    // 입력: 모두 SD 공통 (무전압 접점)
    net('white', [inv, 'SD'], [ss1, '13'], [ss1, '23'], [ss2, '11'], [ss2, '23']);
    net('white', [ss1, '14'], [inv, 'STF']);
    net('white', [ss1, '24'], [inv, 'STR']);
    net('white', [ss2, '12'], [inv, 'RL']);
    net('white', [ss2, '24'], [inv, 'RH']);
    net('gy', [tPE, ''], [inv, 'PE'], [m1, 'PE']);
    return nets;
  });
  b.op(1000, 'SS1', 'left', tr('정회전 (저속 10 Hz)', 'Forward (low 10 Hz)'));
  b.op(5000, 'SS2', 'on', tr('고속 60 Hz', 'High 60 Hz'));
  b.op(8000, 'SS1', 'off', tr('정지 (5초 감속)', 'Stop (5 s ramp)'));
  b.op(10000, 'SS1', 'right', tr('역회전 (고속)', 'Reverse (high)'));
  b.op(6000, 'INV1', 'on', tr('고장 (트립)', 'Fault (trip)'));
  b.op(4000, 'SS1', 'off', tr('운전 끔', 'Run off'));
  b.op(2000, 'INV1', 'off', tr('리셋', 'Reset'));
  const c = b.done();
  c.duration = 40000;
  return c;
}

// ───────────────────── 급수 펌프: 플로트리스 릴레이 + 수조 전극봉 ─────────────────────

/**
 * 물탱크 급수: 수조 전극봉 E1 (상한 80%) · E2 (하한 40%) · E3 (공통) → 플로트리스 릴레이 FLR1.
 * 물이 E2 아래면 FLR1 이 꺼져 Tc-Tb 가 닫힘 → 자동 운전 SS1 → THR 95-96 → MC1 코일 → 펌프 M1 운전 (초당 5% 급수).
 * 물이 E1 에 닿으면 FLR1 이 켜져 펌프 정지, E2 아래로 내려갈 때까지 유지 (그동안 초당 1% 사용). 만수등 GL1 = Tc-Ta, 운전등 RL1 = MC1 13-14
 */
function waterSupply(): Circuit {
  const b = new Builder();
  const T = (pole: 'L1' | 'L2' | 'L3' | 'N' | 'PE', x: number) => b.part('r_term', x, 0, '', { pole });
  const [t1, t2, t3, tN, tPE] = [T('L1', 2), T('L2', 4), T('L3', 6), T('N', 8), T('PE', 10)];
  const mccb = b.part('r_mcb3', 4, 6, 'MCCB', { name: tr('펌프 전원', 'Pump supply'), amps: 15 });
  const f1 = b.part('r_fuse', 14, 6, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const mc = b.part('r_mc', 5, 20, 'MC1', { name: tr('펌프 운전', 'Pump run'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  const thr = b.part('r_thr', 4, 34, 'THR1', { name: tr('과부하', 'Overload') });
  const m1 = b.part('r_motor3', 4, 46, 'M1', { name: tr('급수 펌프', 'Feed pump'), spec: 'AC 380V 2.2kW' });
  const ss = b.part('r_ss', 22, 8, 'SS1', { name: tr('자동 운전', 'Auto run') });
  const flr = b.part('r_flr', 26, 22, 'FLR1', { name: tr('수위 제어', 'Level control') });
  const rl = b.part('r_lamp', 36, 10, 'RL1', { name: tr('펌프 운전', 'Pump running'), color: 'red' });
  const gl = b.part('r_lamp', 42, 10, 'GL1', { name: tr('만수', 'Tank full'), color: 'green' });
  const tank = b.part('r_tank', 44, 32, 'TANK1', { name: tr('물탱크', 'Water tank'), fillTag: 'M1', fillRate: 5, useRate: 1, lv0: 45 });
  b.part('text', 0, -5, '', { text: tr('급수 펌프 자동 운전: 수조 전극봉 → 플로트리스 릴레이 → 물이 E2 (40%) 아래면 펌프 운전, E1 (80%) 에 닿으면 정지', 'Automatic feed pump: tank electrodes → floatless relay → pump runs below E2 (40%), stops at E1 (80%)') });
  routeNets(b, 'water-supply', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [t1, ''], [mccb, '1']);
    net('black', [t2, ''], [mccb, '3']);
    net('grey', [t3, ''], [mccb, '5']);
    net('brown', [mccb, '2'], [mc, '1/L1'], [f1, '1']);
    net('black', [mccb, '4'], [mc, '3/L2']);
    net('grey', [mccb, '6'], [mc, '5/L3']);
    net('brown', [mc, '2/T1'], [thr, '1/L1']);
    net('black', [mc, '4/T2'], [thr, '3/L2']);
    net('grey', [mc, '6/T3'], [thr, '5/L3']);
    net('brown', [thr, '2/T1'], [m1, 'U']);
    net('black', [thr, '4/T2'], [m1, 'V']);
    net('grey', [thr, '6/T3'], [m1, 'W']);
    // 조작: F1 → FLR 전원 S1 · 출력 공통 Tc · MC1 보조 13, Tb (물이 적음) → SS1 → THR 95-96 → MC1 코일
    net('red', [f1, '2'], [flr, 'S1'], [flr, 'Tc'], [mc, '13NO']);
    net('red', [flr, 'Tb'], [ss, '23']);
    net('red', [ss, '24'], [thr, '95']);
    net('red', [thr, '96'], [mc, 'A1']);
    net('red', [mc, '14NO'], [rl, 'X1']);
    net('red', [flr, 'Ta'], [gl, 'X1']);
    net('blue', [tN, ''], [mc, 'A2'], [flr, 'S2'], [rl, 'X2'], [gl, 'X2']);
    net('gy', [tPE, ''], [m1, 'PE']);
    // 전극봉: 같은 이름 단자끼리
    net('white', [flr, 'E1'], [tank, 'E1']);
    net('white', [flr, 'E2'], [tank, 'E2']);
    net('white', [flr, 'E3'], [tank, 'E3']);
    return nets;
  });
  b.op(1000, 'SS1', 'on', tr('자동 운전', 'Auto run'));
  const c = b.done();
  c.duration = 70000;
  return c;
}

// ───────────────────── 계단 조명: 세 곳의 푸시버튼 + 임펄스 릴레이 ─────────────────────

/**
 * 계단 · 복도 조명: 1층 · 2층 · 3층 푸시버튼 (a접점) 을 나란히 임펄스 릴레이 LR1 코일에. 누를 때마다 LR1 13-14 가 켜짐 ↔ 꺼짐으로 바뀌어 전등이 켜지고 꺼진다.
 * 3로 · 4로 스위치 배선보다 선이 적고, 버튼을 늘리기 쉽다
 */
function stairImpulse(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 2, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 4, 0, '', { pole: 'N' });
  const mcb = b.part('r_mcb2', 3, 6, 'MCB1', { name: tr('전등 회로', 'Lighting circuit'), spec: 'AC 220V 16A', amps: 16 });
  const pbs = [1, 2, 3].map((k) => b.part('r_pb', 12 + 7 * (k - 1), 8, `PB${k}`, { name: tr(`${k}층`, `Floor ${k}`), color: 'green' }));
  const lr = b.part('r_imp', 12, 20, 'LR1', { name: tr('계단 조명', 'Stair light') });
  const lt = b.part('r_light', 26, 21, 'EL1', { name: tr('계단 전등', 'Stair lamp') });
  b.part('text', 0, -5, '', { text: tr('계단 조명: 1 · 2 · 3층 푸시버튼 → 임펄스 릴레이 → 전등 (누를 때마다 켜짐 ↔ 꺼짐)', 'Stair lighting: push buttons on three floors → impulse relay → lamp (each press toggles)') });
  routeNets(b, 'stair-impulse', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [mcb, '1']);
    net('blue', [tN, ''], [mcb, '3']);
    net('brown', [mcb, '2'], ...pbs.map((pb): NetPin => [pb, '23']), [lr, '13']);
    net('black', ...pbs.map((pb): NetPin => [pb, '24']), [lr, 'A1']);
    net('blue', [mcb, '4'], [lr, 'A2'], [lt, 'N']);
    net('black', [lr, '14'], [lt, 'L']);
    return nets;
  });
  b.op(1000, 'PB1', 'press', tr('1층에서 켬', 'On from floor 1'));
  b.op(3000, 'PB2', 'press', tr('2층에서 끔', 'Off from floor 2'));
  b.op(3000, 'PB3', 'press', tr('3층에서 켬', 'On from floor 3'));
  b.op(3000, 'PB1', 'press', tr('1층에서 끔', 'Off from floor 1'));
  const c = b.done();
  c.system = '1p2w';
  return c;
}

// ───────────────────── 건조로 PID 온도 제어 (TK4S 꼴 · 더블 Pt100 · 과열 차단) ─────────────────────

/**
 * 단상 220 V 건조로 히터 3 kW: 누전차단기 → 전자접촉기 → 히터. 조작은 퓨즈 F1 뒤에서
 *  - PID 조절기 TK1 (TK4S 꼴): 더블 Pt100 의 1번 소자로 재서 120℃ 를 PID (제어 주기 20초) 로 유지, OUT1 → MC1 코일
 *  - 과열 차단 TS1 (T3S 꼴): 같은 보호관의 2번 소자로 따로 재서 150℃ 이상이면 COM-NO 가 열려 MC1 을 끊는다
 *  - 경보 AL1 (135℃ 이상) → 적색등 RL1, 히터 동작 → 녹색등 GL1 (MC1 보조 a)
 * 40분에 조절기가 고장 난 것처럼 온도를 160℃ 까지 올려 보면 AL1 이 켜지고 TS1 이 히터를 끊는다
 */
function ovenPid(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 2, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 4, 0, '', { pole: 'N' });
  const tPE = b.part('r_term', 7, 0, '', { pole: 'PE' });
  const elb = b.part('r_mcb2', 3, 6, 'ELB1', { name: tr('주 차단기', 'Main RCD'), spec: 'AC 220V 20A', amps: 20, elb: true, idn: 30 });
  const f1 = b.part('r_fuse', 10, 6, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const ss1 = b.part('r_ss', 16, 7, 'SS1', { name: tr('운전', 'Run') });
  const zone = { zone: tr('건조로', 'Oven'), tLoad: 'HT1', amb: 20, tmax: 200, rise: 0.1, fall: 0.03 };
  const tk = b.part('r_tk4', 28, 9, 'TK1', { name: tr('건조로 온도', 'Oven temp.'), spec: 'TK4S-T4RN', sv: 120, hys: 2, alarm: 135, ...zone });
  const ts = b.part('r_tc8', 51, 9, 'TS1', { name: tr('과열 차단', 'Over-temp cut-off'), spec: 'T3S-B4RP2C-N', sv: 150, hys: 5, zone: zone.zone });
  const pt = b.part('r_rtd2', 42, -4, 'PT1', { name: tr('Pt100 더블', 'Pt100 duplex') });
  const mc = b.part('r_mc', 5, 25, 'MC1', { name: tr('히터 개폐', 'Heater contactor'), spec: tr('코일 AC 220V, 주접점 AC-1 25A', 'coil AC 220V, AC-1 25 A') });
  const ht = b.part('r_load1', 3, 39, 'HT1', { name: tr('건조로 히터 3 kW', 'Oven heater 3 kW'), watt: 3000, pf: 1, pe: true });
  const gl = b.part('r_lamp', 14, 39, 'GL1', { name: tr('히터 동작', 'Heating'), color: 'green' });
  const rl = b.part('r_lamp', 20, 39, 'RL1', { name: tr('과열 경보', 'Over-temp alarm'), color: 'red' });
  const peb = b.part('r_nbar', 8, 47, 'PEB', { n: 3, pole: 'PE', name: tr('접지 바', 'Earth bar') });
  b.part('text', 0, -14, '', { text: tr('건조로 PID 온도 제어: 더블 Pt100 → 1번 소자 PID 조절기 (TK4S 꼴) · 2번 소자 과열 차단 (T3S 꼴) → 전자접촉기 → 히터 3 kW', 'Oven PID control: duplex Pt100 → element 1 PID controller (TK4S type), element 2 over-temp cut-off (T3S type) → contactor → 3 kW heater') });
  [
    tr('▶ TK1 은 PID: 120℃ 근처에서 20초마다 켜 둘 비율 (MV) 을 바꿔 온도가 거의 흔들리지 않습니다', '▶ TK1 runs PID: every 20 s it sets the on-ratio (MV), so the temperature hardly swings'),
    tr('한 소자를 두 기기에 같이 물리면 측정 전류가 섞여 둘 다 틀립니다 → 더블 Pt100 의 소자를 하나씩', 'Never share one element between two instruments; use one element of the duplex each'),
    tr('40분: 온도를 160℃ 까지 올려 봄 → 135℃ AL1 경보, 150℃ TS1 이 히터를 끊음', '40 min: temperature forced to 160℃ → AL1 at 135℃, TS1 cuts the heater at 150℃'),
  ].forEach((x, k) => b.part('text', 26, 26 + k * 2, '', { text: x }));
  routeNets(b, 'oven-pid', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [elb, '1']);
    net('blue', [tN, ''], [elb, '3']);
    net('brown', [elb, '2'], [mc, '1/L1'], [f1, '1']);
    net('blue', [elb, '4'], [mc, '3/L2'], [mc, 'A2'], [tk, 'N'], [ts, 'N'], [gl, 'X2'], [rl, 'X2']);
    net('brown', [mc, '2/T1'], [ht, 'L']);
    net('blue', [mc, '4/T2'], [ht, 'N']);
    // 조작 (퓨즈 뒤): 조절기 전원, 운전 스위치, 경보 공통, MC1 보조 13
    net('yellow', [f1, '2'], [tk, 'L'], [ts, 'L'], [ss1, '23'], [tk, 'C2'], [mc, '13NO']);
    net('yellow', [ss1, '24'], [ts, 'COM']);
    net('yellow', [ts, 'NO'], [tk, 'C1']);
    net('yellow', [tk, 'OUT1'], [mc, 'A1']);
    net('yellow', [tk, 'AL1'], [rl, 'X1']);
    net('yellow', [mc, '14NO'], [gl, 'X1']);
    // 더블 Pt100: 1번 소자 (빨강 · 흰색 두 가닥) → TK1 10 · 11 · 12, 2번 소자 (예: 검정 · 회색 두 가닥) → TS1
    net('red', [pt, 'A1'], [tk, 'A']);
    net('white', [pt, 'B1'], [tk, 'B']);
    net('white', [pt, "B1'"], [tk, "B'"]);
    net('black', [pt, 'A2'], [ts, 'A']);
    net('grey', [pt, 'B2'], [ts, 'B']);
    net('grey', [pt, "B2'"], [ts, "B'"]);
    net('gy', [tPE, ''], [peb, '1']);
    net('gy', [ht, 'PE'], [peb, '2']);
    return nets;
  });
  const c = b.done();
  c.system = '1p2w';
  c.duration = 60 * 60000;
  c.ops = [
    { id: uid('op'), wait: 10000, tag: 'SS1', action: 'on', hold: 0, note: tr('운전', 'Run') },
    { id: uid('op'), wait: 40 * 60000 - 10000, tag: 'TK1', action: 'temp', value: 160, hold: 120000, note: tr('조절기 고장 가정: 160℃ 까지', 'Assume a controller fault: up to 160℃') },
  ];
  return c;
}

// ───────────────────── PID 배우기: 같은 오븐 4대를 ON/OFF · P · PI · PID 로 ─────────────────────

/**
 * 같은 오븐 4대 (히터 500 W, 데울 때 초당 0.2℃ · 식을 때 0.05℃, 열이 센서까지 30초 지연) 를 설정 100℃ 로 제어해 차트로 비교한다.
 *  ① ON/OFF (히스테리시스 2℃): 끄고 나서도 30초 동안 계속 올라 106℃ 까지 넘치고 96.5~106℃ 로 계속 흔들림
 *  ② P 만 (비례대 10℃): 흔들림은 잦아들지만 98℃ 근처에서 멈춤 (잔류 편차: 100℃ 를 지키려면 MV 20% 가 필요한데 P 는 편차가 있어야만 출력을 냄)
 *  ③ PI (P 10℃ · I 180초): 적분이 편차를 없애 100℃ 에 맞지만 처음 · 문을 연 뒤 넘침이 큼
 *  ④ PID (P 10℃ · I 180초 · D 20초): 빨리 오를 때 미리 줄여 (D) 넘침이 작다
 * 20분에 네 오븐의 문을 열어 80℃ 로 떨어뜨려 (외란) 되돌아오는 모양도 본다. 조절기는 릴레이 출력으로 작은 히터를 바로 켠다
 */
function pidLearn(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 0, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 2, 0, '', { pole: 'N' });
  const cb = b.part('r_mcb2', 1, 8, 'CB1', { name: tr('오븐 전원', 'Oven supply'), spec: 'AC 220V 15A', amps: 15 });
  const plant = { amb: 20, tmax: 200, rise: 0.2, fall: 0.05, lag: 30 };
  const cases: { label: string; title: string; set: Partial<Part>; why: string }[] = [
    { label: tr('① ON/OFF', '① ON/OFF'), title: 'ON/OFF', set: { ctrl: 'onoff', hys: 2 }, why: tr('넘침 · 흔들림', 'overshoot, hunting') },
    { label: tr('② P 만', '② P only'), title: 'P', set: { pb: 10, ti: 0, td: 0 }, why: tr('잔류 편차 (98℃)', 'offset (98℃)') },
    { label: tr('③ PI', '③ PI'), title: 'PI', set: { pb: 10, ti: 180, td: 0 }, why: tr('편차 0, 넘침 큼', 'no offset, big overshoot') },
    { label: tr('④ PID', '④ PID'), title: 'PID', set: { pb: 10, ti: 180, td: 20 }, why: tr('넘침 작음', 'small overshoot') },
  ];
  const cols = cases.map((k, i) => {
    const x = 14 + i * 26;
    const n = i + 1;
    const tk = b.part('r_tk4', x, 16, `TK${n}`, { name: `${k.label} ${tr('오븐', 'oven')}`, spec: 'TK4S-T4RN', sv: 100, zone: k.label, tLoad: `HT${n}`, ...plant, ...k.set });
    const pt = b.part('r_rtd', x + 3, 0, `PT${n}`, { name: 'Pt100' });
    const ht = b.part('r_load1', x - 2, 32, `HT${n}`, { name: tr('히터 500 W', 'Heater 500 W'), watt: 500, pf: 1 });
    b.part('text', x - 6, -10, '', { text: `${k.label}: ${k.why}` });
    return { tk, pt, ht };
  });
  b.part('text', 0, -16, '', { text: tr('PID 배우기: 같은 오븐 4대 (설정 100℃, 열이 센서까지 30초 지연) 를 ON/OFF · P · PI · PID 로 제어해 비교. 20분에 문을 열어 80℃ 로 (외란)', 'Learn PID: four identical ovens (set 100℃, 30 s dead time) under ON/OFF, P, PI and PID. At 20 min the doors are opened (drop to 80℃)') });
  b.part('text', 0, -14, '', { text: tr('▶ 조절기를 골라 [속성] 의 P · I · D 를 바꾸고 다시 돌려 보세요 (P 를 줄이면 빨라지지만 흔들림, I 를 줄이면 편차가 빨리 없어지지만 넘침, D 는 넘침을 줄임)', '▶ Pick a controller and change P, I, D in Properties: smaller P is faster but swings, shorter I removes the offset faster but overshoots, D brakes the overshoot') });
  routeNets(b, 'pid-learn', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [cb, '1']);
    net('blue', [tN, ''], [cb, '3']);
    // 조절기 전원 L · N 과 출력 공통 C1 은 차단기 뒤에서, OUT1 → 히터 L, 히터 N → N
    net('brown', [cb, '2'], ...cols.flatMap(({ tk }): NetPin[] => [[tk, 'L'], [tk, 'C1']]));
    net('blue', [cb, '4'], ...cols.flatMap(({ tk, ht }): NetPin[] => [[tk, 'N'], [ht, 'N']]));
    for (const { tk, pt, ht } of cols) {
      net('black', [tk, 'OUT1'], [ht, 'L']);
      net('red', [pt, 'A'], [tk, 'A']);
      net('white', [pt, 'B'], [tk, 'B']);
      net('white', [pt, "B'"], [tk, "B'"]);
    }
    return nets;
  });
  const c = b.done();
  c.system = '1p2w';
  c.duration = 40 * 60000;
  c.ops = cols.map((_, i) => ({ id: uid('op'), wait: i ? 0 : 20 * 60000, tag: `TK${i + 1}`, action: 'temp' as const, value: 80, hold: 0, ...(i ? {} : { note: tr('문 열림 (80℃ 로)', 'Doors opened (to 80℃)') }) }));
  return c;
}

// ───────────────────── 온도 유지 회로 모음 ─────────────────────

/**
 * 냉동 창고: 온도 조절기 (TK4S 꼴, 냉각 ON/OFF · Pt100 영하 측정) 가 -18℃ 이상이면 C1-OUT1 을 닫아 압축기 전자접촉기를 켜고 -20℃ 에서 끈다.
 * 제상 타이머 T1 (트윈 타이머: 12분 냉각 · 3분 제상) 의 한시 a접점 8-6 이 냉각을 허락하고, b접점 1-4 가 제상 히터 · 제상등을 켠다.
 * 냉동실: 처음 10℃, 압축기가 돌면 초당 0.1℃ 내려가고 (끝 -25℃) 멈추면 0.03℃ 오른다 (끝 15℃), 냉기가 센서까지 10초 늦다
 */
function freezerDefrost(): Circuit {
  const b = new Builder();
  const T = (pole: 'L1' | 'L2' | 'L3' | 'N' | 'PE', x: number) => b.part('r_term', x, 0, '', { pole });
  const [t1, t2, t3, tN, tPE] = [T('L1', 2), T('L2', 4), T('L3', 6), T('N', 8), T('PE', 10)];
  const mccb = b.part('r_mcb3', 4, 6, 'MCCB', { name: tr('냉동기 전원', 'Refrigeration supply'), amps: 20 });
  const f1 = b.part('r_fuse', 14, 6, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const mc = b.part('r_mc', 5, 20, 'MC1', { name: tr('압축기 운전', 'Compressor run'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  const thr = b.part('r_thr', 4, 34, 'THR1', { name: tr('과부하', 'Overload') });
  const m1 = b.part('r_motor3', 4, 46, 'M1', { name: tr('압축기', 'Compressor'), spec: 'AC 380V 3.7kW' });
  const ss = b.part('r_ss', 22, 8, 'SS1', { name: tr('운전', 'Run') });
  const t1m = b.part('r_timer8', 30, 24, 'T1', { name: tr('제상 타이머 (냉각 12분 · 제상 3분)', 'Defrost timer (12 min cool, 3 min defrost)'), sock: 'pf', timerMode: 'flicker', preset: 12 * 60000, presetOff: 3 * 60000 });
  const tc = b.part('r_tk4', 46, 24, 'TC1', { name: tr('냉동실 온도 (냉각 ON/OFF)', 'Freezer temp. (cooling ON/OFF)'), spec: 'TK4S-T4RN', ctrl: 'onoff', sv: -18, hys: 2, tcMode: 'cool', zone: tr('냉동실', 'Freezer'), tLoad: 'M1', tLoadCool: true, amb: -25, tmax: 15, t0: 10, rise: 0.03, fall: 0.1, lag: 10 });
  const pt = b.part('r_rtd', 47, 8, 'PT1', { name: 'Pt100' });
  const ht = b.part('r_load1', 62, 40, 'HT1', { name: tr('제상 히터 500 W', 'Defrost heater 500 W'), watt: 500, pf: 1 });
  const gl = b.part('r_lamp', 58, 12, 'GL1', { name: tr('냉각 운전', 'Cooling'), color: 'green' });
  const yl = b.part('r_lamp', 64, 12, 'YL1', { name: tr('제상 중', 'Defrosting'), color: 'yellow' });
  b.part('text', 0, -5, '', { text: tr('냉동 창고: 온도 조절기 (냉각) → 압축기, 제상 타이머 (12분 냉각 · 3분 제상) 가 제상 중에는 압축기를 멈추고 제상 히터를 켠다', 'Freezer: controller (cooling) → compressor; the defrost timer (12 min cool, 3 min defrost) stops the compressor and runs the defrost heater') });
  routeNets(b, 'freezer-defrost', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [t1, ''], [mccb, '1']);
    net('black', [t2, ''], [mccb, '3']);
    net('grey', [t3, ''], [mccb, '5']);
    net('brown', [mccb, '2'], [mc, '1/L1'], [f1, '1']);
    net('black', [mccb, '4'], [mc, '3/L2']);
    net('grey', [mccb, '6'], [mc, '5/L3']);
    net('brown', [mc, '2/T1'], [thr, '1/L1']);
    net('black', [mc, '4/T2'], [thr, '3/L2']);
    net('grey', [mc, '6/T3'], [thr, '5/L3']);
    net('brown', [thr, '2/T1'], [m1, 'U']);
    net('black', [thr, '4/T2'], [m1, 'V']);
    net('grey', [thr, '6/T3'], [m1, 'W']);
    // 조작: F1 → 조절기 전원 · 운전 SS1 · MC1 보조 13, SS1 → 제상 타이머 코일 2 와 공통 8 · 1
    net('red', [f1, '2'], [tc, 'L'], [ss, '23'], [mc, '13NO']);
    net('red', [ss, '24'], [t1m, '2'], [t1m, '8'], [t1m, '1']);
    // 냉각: 타이머 8-6 (a) → 조절기 C1-OUT1 → THR 95-96 → MC1 코일
    net('red', [t1m, '6'], [tc, 'C1']);
    net('red', [tc, 'OUT1'], [thr, '95']);
    net('red', [thr, '96'], [mc, 'A1']);
    // 제상: 타이머 1-4 (b) → 제상 히터 · 제상등
    net('red', [t1m, '4'], [ht, 'L'], [yl, 'X1']);
    net('red', [mc, '14NO'], [gl, 'X1']);
    net('blue', [tN, ''], [t1m, '7'], [tc, 'N'], [mc, 'A2'], [ht, 'N'], [gl, 'X2'], [yl, 'X2']);
    net('gy', [tPE, ''], [m1, 'PE']);
    net('red', [pt, 'A'], [tc, 'A']);
    net('white', [pt, 'B'], [tc, 'B']);
    net('white', [pt, "B'"], [tc, "B'"]);
    return nets;
  });
  b.op(1000, 'SS1', 'on', tr('운전', 'Run'));
  const c = b.done();
  c.duration = 30 * 60000;
  return c;
}

/**
 * 전기 온수기 (보온 탱크): 물탱크 전극봉 → 플로트리스 릴레이 FLR1.
 *  - 물이 E2 (40%) 아래면 Tc-Tb 로 급수 밸브 SOL1 (급수등 YL1) 이 열리고 E1 (80%) 에서 닫힘
 *  - 물이 있을 때만 (Tc-Ta) 히터 회로가 살아 있음 (공가열 방지) → 과열 방지 서모스탯 TH1 (90℃ 에서 열림) → 온도 조절기 COM-NO (60℃ 유지) → MC1 → 히터 3 kW
 * 온수: 15℃ 에서 히터가 켜지면 초당 0.3℃ 오르고 꺼지면 0.05℃ 식음 (5초 지연). 탱크는 늘 초당 1% 씀
 */
function waterHeater(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 0, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 2, 0, '', { pole: 'N' });
  const tPE = b.part('r_term', 5, 0, '', { pole: 'PE' });
  const elb = b.part('r_mcb2', 1, 8, 'ELB1', { name: tr('온수기 전원', 'Water heater supply'), spec: 'AC 220V 30A', amps: 30, elb: true, idn: 30 });
  const f1 = b.part('r_fuse', 10, 8, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const ss = b.part('r_ss', 18, 8, 'SS1', { name: tr('운전', 'Run') });
  const mc = b.part('r_mc', 8, 26, 'MC1', { name: tr('히터 개폐', 'Heater contactor'), spec: tr('코일 AC 220V, 주접점 AC-1 25A', 'coil AC 220V, AC-1 25 A') });
  const ht = b.part('r_load1', 6, 42, 'HT1', { name: tr('온수 히터 3 kW', 'Immersion heater 3 kW'), watt: 3000, pf: 1, pe: true });
  const flr = b.part('r_flr', 28, 26, 'FLR1', { name: tr('수위 (급수 · 공가열 방지)', 'Level (fill, dry-fire guard)') });
  const sol = b.part('r_sol', 44, 10, 'SOL1', { name: tr('급수 밸브', 'Fill valve'), spec: 'AC 220V' });
  const yl = b.part('r_lamp', 50, 10, 'YL1', { name: tr('급수 중', 'Filling'), color: 'yellow' });
  const zone = tr('온수', 'Water');
  const th = b.part('r_thermo', 40, 30, 'TH1', { name: tr('과열 방지 (90℃)', 'Over-temp cut-out (90℃)'), ncOut: true, sv: 90, hys: 10, zone });
  const tc = b.part('r_tc8', 52, 30, 'TC1', { name: tr('온수 온도', 'Water temp.'), spec: 'T3S-B4RP2C-N', sv: 60, hys: 3, zone, tLoad: 'HT1', amb: 15, rise: 0.3, fall: 0.05, lag: 5 });
  const pt = b.part('r_rtd', 53, 16, 'PT1', { name: 'Pt100' });
  const gl = b.part('r_lamp', 62, 22, 'GL1', { name: tr('가열 중', 'Heating'), color: 'green' });
  const tank = b.part('r_tank', 74, 44, 'TANK1', { name: tr('온수 탱크', 'Hot water tank'), fillTag: 'SOL1', fillRate: 5, useRate: 1, lv0: 31 });
  b.part('text', 0, -5, '', { text: tr('전기 온수기: 물이 적으면 급수 밸브를 열고, 물이 있을 때만 히터를 켜 (공가열 방지) 60℃ 유지, 90℃ 면 과열 방지 서모스탯이 끊음', 'Water heater: fills when low, heats only with water present (dry-fire guard) to hold 60℃, over-temp thermostat cuts at 90℃') });
  routeNets(b, 'water-heater', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [elb, '1']);
    net('blue', [tN, ''], [elb, '3']);
    net('brown', [elb, '2'], [mc, '1/L1'], [f1, '1']);
    net('blue', [elb, '4'], [mc, '3/L2'], [mc, 'A2'], [flr, 'S2'], [tc, 'N'], [sol, '2'], [yl, 'X2'], [gl, 'X2']);
    net('brown', [mc, '2/T1'], [ht, 'L']);
    net('blue', [mc, '4/T2'], [ht, 'N']);
    net('gy', [tPE, ''], [ht, 'PE']);
    // 조작: F1 → FLR 전원 · 조절기 전원 · 운전 SS1 · MC1 보조 13, SS1 → FLR 출력 공통 Tc
    net('red', [f1, '2'], [flr, 'S1'], [tc, 'L'], [ss, '23'], [mc, '13NO']);
    net('red', [ss, '24'], [flr, 'Tc']);
    net('red', [flr, 'Tb'], [sol, '1'], [yl, 'X1']);
    net('red', [flr, 'Ta'], [th, '1']);
    net('red', [th, '2'], [tc, 'COM']);
    net('red', [tc, 'NO'], [mc, 'A1']);
    net('red', [mc, '14NO'], [gl, 'X1']);
    net('white', [flr, 'E1'], [tank, 'E1']);
    net('white', [flr, 'E2'], [tank, 'E2']);
    net('white', [flr, 'E3'], [tank, 'E3']);
    net('red', [pt, 'A'], [tc, 'A']);
    net('white', [pt, 'B'], [tc, 'B']);
    net('white', [pt, "B'"], [tc, "B'"]);
    return nets;
  });
  b.op(1000, 'SS1', 'on', tr('운전', 'Run'));
  b.temp(299000, 'TC1', 95, 20000, tr('조절기 고장 가정: 95℃ 까지', 'Assume a controller fault: up to 95℃'));
  const c = b.done();
  c.system = '1p2w';
  c.duration = 6 * 60000;
  return c;
}

/**
 * 온도 경보 회로 (부저 정지 · 경보등 유지): 온도 조절기 TC1 이 히터를 60℃ 로 유지하고, 80℃ 이상이면 AL → 경보 릴레이 X1 · 경보등 RL1.
 * 부저 BZ1 = X1 8-6 (a) → 확인 릴레이 X2 8-5 (b). 확인 버튼 PB1 을 누르면 X2 가 X1 1-3 을 지나 자기유지 → 부저만 멈추고 경보등은 온도가 내려갈 때까지 켜짐.
 * 온도가 경보 아래로 돌아오면 X1 이 떨어져 X2 도 풀리므로 다음 과열에는 다시 부저가 운다
 */
function tempAlarm(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 2, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 4, 0, '', { pole: 'N' });
  const mcb = b.part('r_mcb2', 3, 8, 'MCB1', { name: tr('히터 전원', 'Heater supply'), spec: 'AC 220V 20A', amps: 20 });
  const f1 = b.part('r_fuse', 12, 8, 'F1', { name: tr('조작 회로', 'Control'), amps: 2 });
  const ss = b.part('r_ss', 20, 8, 'SS1', { name: tr('운전', 'Run') });
  const tc = b.part('r_tc', 32, 14, 'TC1', { name: tr('히터 온도', 'Heater temp.'), sv: 60, hys: 3, alarm: 80, tLoad: 'H1', amb: 20, rise: 0.5, fall: 0.2 });
  const mc = b.part('r_mc', 6, 26, 'MC1', { name: tr('히터 개폐', 'Heater contactor'), spec: tr('코일 AC 220V', 'coil AC 220V') });
  const h1 = b.part('r_load1', 5, 42, 'H1', { name: tr('히터 2 kW', 'Heater 2 kW'), watt: 2000, pf: 1 });
  const x1 = b.part('r_relay8', 28, 32, 'X1', { name: tr('경보 릴레이', 'Alarm relay'), sock: 'pf' });
  const x2 = b.part('r_relay8', 42, 32, 'X2', { name: tr('확인 (부저 정지)', 'Acknowledge'), sock: 'pf' });
  const pb = b.part('r_pb', 44, 14, 'PB1', { name: tr('부저 정지 (확인)', 'Silence (acknowledge)'), color: 'yellow' });
  const bz = b.part('r_buzzer', 56, 30, 'BZ1', { name: tr('경보 부저', 'Alarm buzzer') });
  const rl = b.part('r_lamp', 56, 20, 'RL1', { name: tr('과열 경보', 'Over-temp alarm'), color: 'red' });
  b.part('text', 0, -5, '', { text: tr('온도 경보: 80℃ 이상이면 경보등 + 부저. 확인 버튼을 누르면 부저만 멈추고 경보등은 온도가 내려갈 때까지 켜짐 (다음 과열에는 다시 울림)', 'Temperature alarm: lamp + buzzer above 80℃; the acknowledge button silences the buzzer, the lamp stays until the temperature drops (sounds again on the next alarm)') });
  routeNets(b, 'temp-alarm', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [mcb, '1']);
    net('blue', [tN, ''], [mcb, '3']);
    net('brown', [mcb, '2'], [mc, '1/L1'], [f1, '1']);
    net('blue', [mcb, '4'], [mc, '3/L2'], [mc, 'A2'], [tc, 'A2'], [x1, '7'], [x2, '7'], [bz, 'X2'], [rl, 'X2']);
    net('brown', [mc, '2/T1'], [h1, 'L']);
    net('blue', [mc, '4/T2'], [h1, 'N']);
    // 경보 회로는 운전 스위치와 상관없이 F1 뒤에서
    net('red', [f1, '2'], [ss, '23'], [tc, 'C2'], [x1, '1'], [x1, '8']);
    net('red', [ss, '24'], [tc, 'A1'], [tc, 'C1']);
    net('red', [tc, 'OUT'], [mc, 'A1']);
    net('red', [tc, 'AL'], [x1, '2'], [rl, 'X1']);
    // 확인: X1 1-3 (경보 중) → PB1 ∥ X2 1-3 (자기유지) → X2 코일
    net('red', [x1, '3'], [pb, '23'], [x2, '1']);
    net('red', [pb, '24'], [x2, '3'], [x2, '2']);
    // 부저: X1 8-6 (경보 중) → X2 8-5 (확인 전) → 부저
    net('red', [x1, '6'], [x2, '8']);
    net('red', [x2, '5'], [bz, 'X1']);
    return nets;
  });
  b.op(1000, 'SS1', 'on', tr('운전', 'Run'));
  b.temp(119000, 'TC1', 90, 0, tr('과열 (90℃)', 'Over-temperature (90℃)'));
  b.op(10000, 'PB1', 'press', tr('부저 정지 (확인)', 'Acknowledge'));
  b.temp(170000, 'TC1', 85, 0, tr('다시 과열 (85℃)', 'Over-temperature again (85℃)'));
  const c = b.done();
  c.system = '1p2w';
  c.duration = 360000;
  return c;
}

/**
 * 배관 동파 방지 열선: 누전차단기 → 서모스탯 TS1 (NC, 3℃ 이하면 닫힘 · 8℃ 에서 열림) → 자기 제어형 열선 600 W (외함 접지), 운전등.
 * 배관: 처음 6℃, 밤공기 -10℃ 쪽으로 초당 0.02℃ 식고, 열선이 켜지면 초당 0.03℃ 오름. 20분에 해가 들어 30분 동안 12℃ 까지 오름
 */
function pipeFreeze(): Circuit {
  const b = new Builder();
  const tL = b.part('r_term', 2, 0, '', { pole: 'L' });
  const tN = b.part('r_term', 4, 0, '', { pole: 'N' });
  const tPE = b.part('r_term', 7, 0, '', { pole: 'PE' });
  const elb = b.part('r_mcb2', 3, 8, 'ELB1', { name: tr('열선 전원', 'Heat trace supply'), spec: 'AC 220V 15A', amps: 15, elb: true, idn: 30 });
  const ts = b.part('r_thermo', 14, 14, 'TS1', { name: tr('동파 방지 (3 ↔ 8℃)', 'Frost protection (3 ↔ 8℃)'), ncOut: true, sv: 8, hys: 5, zone: tr('배관', 'Pipe'), tLoad: 'HT1', amb: -10, t0: 6, rise: 0.03, fall: 0.02 });
  const ht = b.part('r_load1', 22, 28, 'HT1', { name: tr('배관 열선 600 W (자기 제어형)', 'Pipe heat trace 600 W (self-regulating)'), watt: 600, pf: 1, pe: true });
  const gl = b.part('r_lamp', 30, 18, 'GL1', { name: tr('열선 운전', 'Heat trace on'), color: 'green' });
  b.part('text', 0, -5, '', { text: tr('배관 동파 방지: 누전차단기 → 서모스탯 (3℃ 이하면 닫힘, 8℃ 에서 열림) → 열선 (외함 접지). 밤 -10℃ 에서 배관을 3~8℃ 로 지킴', 'Pipe frost protection: RCD → thermostat (closes below 3℃, opens at 8℃) → heat trace (earthed); keeps the pipe at 3–8℃ on a -10℃ night') });
  routeNets(b, 'pipe-freeze', () => {
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    net('brown', [tL, ''], [elb, '1']);
    net('blue', [tN, ''], [elb, '3']);
    net('brown', [elb, '2'], [ts, '1']);
    net('brown', [ts, '2'], [ht, 'L'], [gl, 'X1']);
    net('blue', [elb, '4'], [ht, 'N'], [gl, 'X2']);
    net('gy', [tPE, ''], [ht, 'PE']);
    return nets;
  });
  b.temp(20 * 60000, 'TS1', 12, 30 * 60000, tr('아침: 햇볕 (30분 동안 12℃ 까지)', 'Morning sun (up to 12℃ over 30 min)'));
  const c = b.done();
  c.system = '1p2w';
  c.duration = 60 * 60000;
  return c;
}

// ───────────────────── 누전 · 지락: 접지와 누전차단기 (TT 계통) ─────────────────────

/**
 * TT 계통 (저압 수전, 기기를 따로 접지) 의 작은 공장: 주 차단기 → 누전차단기 ELB1 → 전동기 M1, ELB2 → 콘센트 CON1.
 * 전동기 · 콘센트 외함은 접지 바 PEB 로 접지 (PE). 조작 순서로 누전 (절연 불량) 을 일으켜 본다:
 *  - 절연이 10 kΩ 으로 나빠짐 → 접지로 약 22 mA 가 새지만 감도 30 mA 보다 작아 ELB1 은 안 떨어짐
 *  - 완전 지락 → 약 2 A (220 V ÷ (Ra 100 Ω + Rb 10 Ω)). 일반 차단기는 못 끊는 크기 → ELB1 이 0.03 초에 끊음
 *  - 고치지 않고 ELB1 을 다시 넣으면 또 떨어짐, 콘센트에 꽂은 기기의 누전 → ELB2
 */
function earthFaultDemo(): Circuit {
  const b = new Builder();
  const T = (pole: 'L1' | 'L2' | 'L3' | 'N' | 'PE', x: number) => b.part('r_term', x, 0, '', { pole });
  const t = [T('L1', 4), T('L2', 6), T('L3', 8), T('N', 10)];
  const tPE = T('PE', 30);
  const main = b.part('r_mcb4', 7, 6, 'MCCB', { name: tr('주 차단기', 'Main breaker'), spec: 'AC 380V 30A' });
  const elb1 = b.part('r_mcb3', 6, 17, 'ELB1', { name: tr('전동기 누전차단기', 'Motor RCD'), spec: 'AC 380V 20A', elb: true, idn: 30 });
  const m1 = b.part('r_motor3', 6, 28, 'M1', { name: tr('펌프', 'Pump'), spec: 'AC 380V 2.2kW' });
  const elb2 = b.part('r_mcb2', 20, 17, 'ELB2', { name: tr('콘센트 누전차단기', 'Outlet RCD'), spec: 'AC 220V 20A', elb: true, idn: 30 });
  const con = b.part('r_outlet', 20, 27, 'CON1', { name: tr('콘센트 (세척기)', 'Outlet (washer)') });
  const peb = b.part('r_nbar', 24, 36, 'PEB', { n: 4, pole: 'PE', name: tr('접지 바', 'Earth bar') });
  b.part('text', 0, -5, '', { text: tr('누전 · 지락: TT 계통 (기기 접지 Ra 100 Ω · 계통 접지 Rb 10 Ω). 외함은 접지하고 누전차단기가 끊는다', 'Earth faults on a TT system (Ra 100 Ω, Rb 10 Ω): frames earthed, RCDs disconnect') });
  [
    tr('▶ 시뮬레이션 중 전동기 · 콘센트를 Shift+클릭하면 누전', '▶ While simulating, Shift+click the motor or outlet for an earth fault'),
    tr('[해석] 탭 아래 [누전 · 지락 검토]: 기기마다 지락 전류 · 외함 전압 · 끊는 차단기', 'Analysis tab → Earth faults: current, frame voltage and the breaker that clears it'),
    tr('PE 선을 지우거나 ELB 를 일반 차단기로 바꿔 보면 위험이 보입니다', 'Delete a PE wire or untick ELB to see the danger'),
  ].forEach((x, k) => b.part('text', 32, 14 + k * 2, '', { text: x }));
  routeNets(b, 'earth-fault', () => {
    const PH: WireColor[] = ['brown', 'black', 'grey'];
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    // 전원 → 주 차단기 (4P: 1 3 5 N / 2 4 6 N)
    t.forEach((x, k) => net(k < 3 ? PH[k] : 'blue', [x, ''], [main, k]));
    // 주 차단기 → ELB1 (3상), L3 · N → ELB2 (단상 220 V)
    net('brown', [main, 4], [elb1, '1']);
    net('black', [main, 5], [elb1, '3']);
    net('grey', [main, 6], [elb1, '5'], [elb2, '1']);
    net('blue', [main, 7], [elb2, '3']);
    net('brown', [elb1, '2'], [m1, 'U']);
    net('black', [elb1, '4'], [m1, 'V']);
    net('grey', [elb1, '6'], [m1, 'W']);
    net('grey', [elb2, '2'], [con, 'L']);
    net('blue', [elb2, '4'], [con, 'N']);
    // 접지: 접지 바의 나사 하나에 기기 하나씩
    net('gy', [tPE, ''], [peb, '1']);
    net('gy', [m1, 'PE'], [peb, '2']);
    net('gy', [con, 'PE'], [peb, '3']);
    return nets;
  });
  const c = b.done();
  c.earthing = 'TT';
  c.ops = [
    { id: uid('op'), wait: 1000, tag: 'M1', action: 'leak', value: 10000, hold: 3000, note: tr('M1 절연 나빠짐 (10 kΩ, 3초)', 'M1 insulation down to 10 kΩ (3 s)') },
    { id: uid('op'), wait: 4000, tag: 'M1', action: 'leak', value: 0, hold: 0, note: tr('M1 완전 지락', 'M1 solid earth fault') },
    { id: uid('op'), wait: 2000, tag: 'ELB1', action: 'on', hold: 0, note: tr('고치지 않고 다시 넣음', 'Reclosed without repair') },
    { id: uid('op'), wait: 2000, tag: 'CON1', action: 'leak', value: 0, hold: 0, note: tr('콘센트 기기 누전', 'Appliance fault on the outlet') },
  ];
  return c;
}

// ───────────────────── PLC 제어반: 급수 펌프 2대 (로컬 · HMI 원격) ─────────────────────

/**
 * 실제 설계처럼 그린 PLC 제어반 (펌프 2대).
 *  - 주회로: 주 차단기 MCCB → 펌프마다 MCB → MC → THR → 전동기
 *  - 조작 전원: CB1 (2P, AC 220V) → SMPS (DC 24V) → 퓨즈 F1 (PLC · HMI 전원) · F2 (입력 · 현장 신호) · F3 (출력 공통 COM0)
 *  - PLC 를 지키는 배선: 입력은 DC 24V 만 (정지 · 과부하는 접점으로), 출력은 퓨즈 F3 를 거친 공통에서
 *    DC 24V 보조 릴레이 RY1 · RY2 (인터포징) 만 켜고, AC 220V 전자접촉기 코일은 릴레이 접점이 켠다
 *  - PLC 가 고장 나도 멈추게: 비상정지 EMG (11-12) 와 THR (95-96) 이 MC 코일 회로를 직접 끊는다 (PLC 는 상태만 읽음)
 *  - 운전 장소: 문의 COS (로컬 · 정지 · 원격). 로컬 = 문 버튼, 원격 = HMI. 정지는 어디서나
 */
function plcPanel(): Circuit {
  const b = new Builder();
  const T = (pole: 'L1' | 'L2' | 'L3' | 'N' | 'PE', x: number) => b.part('r_term', x, 0, '', { pole });
  const tL1 = T('L1', 4);
  const tL2 = T('L2', 6);
  const tL3 = T('L3', 8);
  const tN = T('N', 10);
  const tPE = T('PE', 12);
  // 주회로
  const mccb = b.part('r_mcb3', 6, 6, 'MCCB', { name: tr('주 차단기', 'Main breaker'), spec: 'AC 380V 50A' });
  const branch = (k: 1 | 2, x: number) => ({
    mcb: b.part('r_mcb3', x, 18, `MCB${k}`, { name: tr(`P${k} 차단기`, `P${k} breaker`), spec: 'AC 380V 20A' }),
    mc: b.part('r_mc', x + 1, 30, `MC${k}`, { name: tr(`P${k} 운전`, `P${k} run`), spec: tr('코일 AC 220V, 서지킬러 (CR) 부착', 'coil AC 220V with RC surge suppressor') }),
    thr: b.part('r_thr', x, 41, `THR${k}`, { name: tr(`P${k} 과부하`, `P${k} overload`) }),
    m: b.part('r_motor3', x, 51, `M${k}`, { name: tr(`급수 펌프 P${k}`, `Feed pump P${k}`), spec: 'AC 380V 3.7kW' }),
  });
  const p1 = branch(1, 6);
  const p2 = branch(2, 18);
  // 조작 전원 · DC 24V
  const cb1 = b.part('r_mcb2', 31, 6, 'CB1', { name: tr('조작 전원', 'Control supply'), spec: 'AC 220V 10A' });
  const smps = b.part('r_smps', 40, 6, 'SMPS', { name: 'DC 24V 5A' });
  const f1 = b.part('r_fuse', 48, 6, 'F1', { name: tr('PLC · HMI 전원', 'PLC & HMI supply'), amps: 2 });
  const f2 = b.part('r_fuse', 51, 6, 'F2', { name: tr('입력 · 현장 신호', 'Inputs & field signals'), amps: 2 });
  const f3 = b.part('r_fuse', 54, 6, 'F3', { name: tr('출력 공통 COM0', 'Output common COM0'), amps: 4 });
  // 문: 운전 선택 · 버튼 · 비상정지 (입력은 PLC 위 단자로)
  const ss1 = b.part('r_ss3', 52, 16, 'SS1', { name: tr('운전 선택 (COS)', 'Mode (COS)'), pos3: tr('로컬/정지/원격', 'Local/Off/Remote'), pos0: -1 });
  const pb11 = b.part('r_pb', 57, 16, 'PB11', { name: tr('P1 기동', 'P1 start'), color: 'green' });
  const pb10 = b.part('r_pb', 62, 16, 'PB10', { name: tr('P1 정지', 'P1 stop'), color: 'red' });
  const pb21 = b.part('r_pb', 67, 16, 'PB21', { name: tr('P2 기동', 'P2 start'), color: 'green' });
  const pb20 = b.part('r_pb', 72, 16, 'PB20', { name: tr('P2 정지', 'P2 stop'), color: 'red' });
  const pbr = b.part('r_pb', 77, 16, 'PBR', { name: tr('고장 리셋', 'Fault reset'), color: 'yellow' });
  const emg = b.part('r_estop', 84, 16, 'EMG', { name: tr('비상정지', 'E-stop') });
  // PLC · 보조 릴레이 · 표시
  const plc = b.part('r_plc', 62, 32, 'PLC', { name: 'CPU 32점 (DC 24V)', inBase: 'P00000', outBase: 'P00040' });
  const ry1 = b.part('r_my2', 50, 46, 'RY1', { name: tr('P1 운전 지령', 'P1 run command'), spec: tr('코일 DC 24V (다이오드 내장)', 'coil DC 24V with diode') });
  const ry2 = b.part('r_my2', 57, 46, 'RY2', { name: tr('P2 운전 지령', 'P2 run command'), spec: tr('코일 DC 24V (다이오드 내장)', 'coil DC 24V with diode') });
  const gl1 = b.part('r_lamp', 66, 46, 'GL1', { name: tr('P1 운전', 'P1 run'), color: 'green', spec: 'LED DC 24V', watt: 0.5 });
  const gl2 = b.part('r_lamp', 70, 46, 'GL2', { name: tr('P2 운전', 'P2 run'), color: 'green', spec: 'LED DC 24V', watt: 0.5 });
  const rl = b.part('r_lamp', 74, 46, 'RL', { name: tr('고장 (점멸)', 'Fault (flashing)'), color: 'red', spec: 'LED DC 24V', watt: 0.5 });
  const bz = b.part('r_buzzer', 78, 46, 'BZ', { name: tr('경보', 'Alarm'), spec: 'DC 24V', watt: 1.5 });
  const hmi = b.part('r_hmi', 94, 30, 'HMI1', {
    name: tr('운전 화면', 'Main screen'),
    hmi: [
      { kind: 'btn', label: tr('P1 기동', 'P1 start'), dev: 'M00100', color: 'green' },
      { kind: 'btn', label: tr('P1 정지', 'P1 stop'), dev: 'M00101', color: 'red' },
      { kind: 'lamp', label: tr('P1 운전', 'P1 run'), dev: 'P00008', color: 'green' },
      { kind: 'btn', label: tr('P2 기동', 'P2 start'), dev: 'M00102', color: 'green' },
      { kind: 'btn', label: tr('P2 정지', 'P2 stop'), dev: 'M00103', color: 'red' },
      { kind: 'lamp', label: tr('P2 운전', 'P2 run'), dev: 'P0000A', color: 'green' },
      { kind: 'btn', label: tr('고장 리셋', 'Reset'), dev: 'M00104', color: 'yellow' },
      { kind: 'lamp', label: tr('로컬 (문)', 'Local (door)'), dev: 'P00000', color: 'white' },
      { kind: 'lamp', label: tr('원격 (HMI)', 'Remote (HMI)'), dev: 'P00001', color: 'blue' },
      { kind: 'lamp', label: tr('P1 고장', 'P1 fault'), dev: 'M00010', color: 'red' },
      { kind: 'lamp', label: tr('P2 고장', 'P2 fault'), dev: 'M00011', color: 'red' },
      { kind: 'lamp', label: tr('비상정지', 'E-stop'), dev: 'M00012', color: 'red' },
    ],
  });
  const peBar = b.part('r_nbar', 30, 56, 'PEB', { n: 6, pole: 'PE', name: tr('접지 바', 'Earth bar') });
  b.part('text', 0, -5, '', { text: tr('PLC 제어반: 급수 펌프 2대 (COS 로컬 = 문 버튼 · 원격 = HMI, 비상정지 · THR 은 MC 코일을 직접 끊음)', 'PLC panel: two feed pumps (COS local = door buttons, remote = HMI; E-stop and THR break the MC coils directly)') });
  // 시뮬레이션 하는 법 (HMI 오른쪽 빈 곳)
  [
    tr('▶ 시뮬레이션: 먼저 SS1 (COS) 자리를 보세요', '▶ Simulation: check SS1 (COS) first'),
    tr('왼쪽 = 로컬 → 문 버튼 PB11 · PB21 로 기동 (처음 자리)', 'Left = local → start with door buttons PB11 / PB21 (initial)'),
    tr('오른쪽 = 원격 → HMI 화면 버튼으로 기동', 'Right = remote → start from the HMI screen'),
    tr('가운데 = 정지 (모두 멈춤, 어떤 기동도 안 받음)', 'Centre = off (all stop, no start accepted)'),
    tr('정지 버튼 · HMI 정지 · 비상정지는 어느 자리에서나', 'Stop buttons, HMI stop and the E-stop work in any position'),
  ].forEach((t, k) => b.part('text', 105, 23 + k * 2, '', { text: t }));
  b.part('text', 0, 61, '', { text: tr('전선 색: 주회로 L1 갈색 · L2 검정 · L3 회색 / N · 0V 파랑 / AC 220V 조작 노랑 / DC 24V 빨강 / 접지 녹황', 'Wire colours: L1 brown · L2 black · L3 grey / N and 0 V blue / 220 V AC control yellow / 24 V DC red / earth green-yellow') });
  b.part('text', 0, 63, '', { text: tr('PLC 보호: 입력 DC 24V 만 · 출력 공통 COM0 퓨즈 F3 · 출력은 DC 24V 보조 릴레이 RY1 · RY2 만 켜고 MC 는 릴레이 접점이 켬 · PLC · HMI 전원 퓨즈 F1 · FG 접지', 'PLC protection: 24 V DC inputs only · fused output common (F3) · outputs drive 24 V DC interposing relays only · PLC/HMI supply fused (F1) · FG earthed') });

  routeNets(b, 'plc-panel', () => {
    // 넷: [색, 단자 …]. 단자는 [기기, 단자 이름]
    const nets: NetList = [];
    const net = (color: WireColor, ...pins: NetPin[]) => nets.push([color, pins]);
    const PH: WireColor[] = ['brown', 'black', 'grey'];
    const MAIN = ['1', '3', '5'];
    const LOADSIDE = ['2', '4', '6'];
    const MCL = ['1/L1', '3/L2', '5/L3'];
    const MCT = ['2/T1', '4/T2', '6/T3'];
    [tL1, tL2, tL3].forEach((t, k) => net(PH[k], [t, ''], [mccb, MAIN[k]]));
    [0, 1, 2].forEach((k) => net(PH[k], [mccb, LOADSIDE[k]], [p1.mcb, MAIN[k]], [p2.mcb, MAIN[k]], ...(k === 0 ? ([[cb1, '1']] as [Part, string][]) : [])));
    net('blue', [tN, ''], [cb1, '3']);
    for (const q of [p1, p2]) {
      [0, 1, 2].forEach((k) => {
        net(PH[k], [q.mcb, LOADSIDE[k]], [q.mc, MCL[k]]);
        net(PH[k], [q.mc, MCT[k]], [q.thr, MCL[k]]);
        net(PH[k], [q.thr, MCT[k]], [q.m, ['U', 'V', 'W'][k]]);
      });
    }
    // AC 220V 조작 회로: CB1 → (SMPS) · 비상정지 11-12 → RY 접점 9-5 → THR 95-96 → MC 코일 → N
    net('yellow', [cb1, '2'], [smps, 'L'], [emg, '11']);
    net('blue', [cb1, '4'], [smps, 'N'], [p1.mc, 'A2'], [p2.mc, 'A2']);
    net('yellow', [emg, '12'], [ry1, '9'], [ry2, '9']);
    net('yellow', [ry1, '5'], [p1.thr, '95']);
    net('yellow', [p1.thr, '96'], [p1.mc, 'A1']);
    net('yellow', [ry2, '5'], [p2.thr, '95']);
    net('yellow', [p2.thr, '96'], [p2.mc, 'A1']);
    // DC 24V
    net('red', [smps, '+V'], [f1, '1'], [f2, '1'], [f3, '1']);
    net('red', [f1, '2'], [plc, '+'], [hmi, '+']);
    net('red', [f2, '2'], [ss1, '13'], [ss1, '23'], [pb11, '23'], [pb10, '11'], [pb21, '23'], [pb20, '11'], [pbr, '23'], [emg, '23'], [p1.mc, '13NO'], [p1.thr, '97'], [p2.mc, '13NO'], [p2.thr, '97']);
    net('red', [f3, '2'], [plc, 'COM0']);
    net('blue', [smps, '-V'], [plc, '−'], [plc, 'COM'], [ry1, '14'], [ry2, '14'], [gl1, 'X2'], [gl2, 'X2'], [rl, 'X2'], [bz, 'X2'], [hmi, '−']);
    // PLC 입력 (싱크: COM = 0V, 신호 = +24V)
    const IN: [Part, string][] = [
      [ss1, '14'],
      [ss1, '24'],
      [pb11, '24'],
      [pb10, '12'],
      [pb21, '24'],
      [pb20, '12'],
      [pbr, '24'],
      [emg, '24'],
      [p1.mc, '14NO'],
      [p1.thr, '98'],
      [p2.mc, '14NO'],
      [p2.thr, '98'],
    ];
    IN.forEach((pin, n) => net('red', pin, [plc, `P0000${n.toString(16).toUpperCase()}`]));
    // PLC 출력 → 보조 릴레이 코일 · 램프 · 부저
    const OUT: [Part, string][] = [
      [ry1, '13'],
      [ry2, '13'],
      [gl1, 'X1'],
      [gl2, 'X1'],
      [rl, 'X1'],
      [bz, 'X1'],
    ];
    OUT.forEach((pin, n) => net('red', [plc, `P0004${n}`], pin));
    // 접지: 기기마다 접지 바의 나사 하나씩
    [
      [tPE, ''],
      [p1.m, 'PE'],
      [p2.m, 'PE'],
      [smps, 'FG'],
      [plc, 'FG'],
      [hmi, 'FG'],
    ].forEach((pin, k) => net('gy', pin as [Part, string], [peBar, String(k + 1)]));

    return nets;
  });


  // 조작 순서: 로컬 운전 → HMI 는 막힘 → 원격 (HMI) → 과부하 · 리셋 → 비상정지 · 리셋
  // SS1 은 로컬 자리에서 시작
  b.op(1000, 'PB11', 'press', tr('로컬: P1 기동 (문)', 'Local: P1 start (door)'));
  b.op(1500, 'PB21', 'press', tr('P2 기동 (문)', 'P2 start (door)'));
  b.op(1500, 'PB10', 'press', tr('P1 정지 (문)', 'P1 stop (door)'));
  b.op(1500, 'HMI1-1', 'press', tr('로컬에서 HMI 기동 → 무시', 'HMI start in local → ignored'));
  b.op(1500, 'SS1', 'right', tr('원격 (HMI)', 'Remote (HMI)'));
  b.op(1000, 'HMI1-1', 'press', tr('P1 기동 (HMI)', 'P1 start (HMI)'));
  b.op(1500, 'THR2', 'on', tr('P2 과부하 트립', 'P2 overload trip'));
  b.op(2000, 'HMI1-7', 'press', tr('리셋 → 부저만 꺼짐', 'Reset → buzzer off only'));
  b.op(1500, 'THR2', 'off', tr('THR2 복귀', 'THR2 reset'));
  b.op(1000, 'HMI1-7', 'press', tr('리셋 → 고장 풀림', 'Reset → fault cleared'));
  b.op(1500, 'EMG', 'on', tr('비상정지', 'E-stop'));
  b.op(2000, 'EMG', 'off', tr('비상정지 해제 (재기동 안 함)', 'E-stop released (no restart)'));
  b.op(1000, 'PBR', 'press', tr('리셋 (문)', 'Reset (door)'));
  b.op(1000, 'HMI1-1', 'press', tr('P1 기동 (HMI)', 'P1 start (HMI)'));
  b.op(1000, 'HMI1-4', 'press', tr('P2 기동 (HMI)', 'P2 start (HMI)'));
  b.op(1500, 'HMI1-5', 'press', tr('P2 정지 (HMI)', 'P2 stop (HMI)'));
  b.op(1500, 'SS1', 'off', tr('COS 정지 → 모두 정지', 'COS off → all stop'));
  return b.done();
}

/** PLC 제어반 프로그램 (LS XGK 니모닉, 래더로 열림) */
function plcPanelProgram(): PlcConfig {
  const source = [
    '; 운전 장소: COS 로컬 (P00000) = 문 버튼, 원격 (P00001) = HMI. 기동은 고른 곳에서만, 정지는 어디서나',
    'LOAD P00000',
    'AND P00002',
    'LOAD P00001',
    'AND M00100',
    'OR LOAD',
    'OR P00040',
    'LOAD P00000',
    'OR P00001',
    'AND LOAD',
    'AND P00003',
    'AND NOT M00101',
    'AND NOT M00010',
    'AND NOT M00012',
    'OUT P00040',
    '; P2 운전 지령 (P1 과 같은 꼴)',
    'LOAD P00000',
    'AND P00004',
    'LOAD P00001',
    'AND M00102',
    'OR LOAD',
    'OR P00041',
    'LOAD P00000',
    'OR P00001',
    'AND LOAD',
    'AND P00005',
    'AND NOT M00103',
    'AND NOT M00011',
    'AND NOT M00012',
    'OUT P00041',
    '; 지령을 냈는데 2초 안에 MC 보조 접점이 안 들어오면 MC 이상',
    'LOAD P00040',
    'AND NOT P00008',
    'TON T0001 20',
    'LOAD P00041',
    'AND NOT P0000A',
    'TON T0002 20',
    '; 고장 기억: 과부하 · MC 이상 · 비상정지',
    'LOAD P00009',
    'OR T0001',
    'SET M00010',
    'LOAD P0000B',
    'OR T0002',
    'SET M00011',
    'LOAD P00007',
    'SET M00012',
    '; 리셋 (문 버튼 · HMI): 원인이 없어진 고장만 풀린다',
    'LOAD P00006',
    'OR M00104',
    'OUT M00030',
    'LOAD M00030',
    'AND NOT P00009',
    'RST M00010',
    'LOAD M00030',
    'AND NOT P0000B',
    'RST M00011',
    'LOAD M00030',
    'AND NOT P00007',
    'RST M00012',
    'LOAD M00010',
    'OR M00011',
    'OR M00012',
    'OUT M00020',
    '; 부저 정지: 원인이 남아 있어도 리셋을 누르면 부저만 끈다',
    'LOAD M00030',
    'AND M00020',
    'SET M00021',
    'LOAD NOT M00020',
    'RST M00021',
    '; 운전 램프 = MC 보조 접점 (실제로 붙었는가)',
    'LOAD P00008',
    'OUT P00042',
    'LOAD P0000A',
    'OUT P00043',
    '; 고장 램프 점멸 (0.5초 켜짐 · 0.5초 꺼짐) 과 부저',
    'LOAD M00020',
    'AND NOT T0004',
    'TON T0003 5',
    'LOAD T0003',
    'TON T0004 5',
    'LOAD M00020',
    'AND NOT T0003',
    'OUT P00044',
    'LOAD M00020',
    'AND NOT M00021',
    'OUT P00045',
    'END',
  ].join('\n');
  const comments = (
    [
      ['P00000', tr('COS 로컬', 'COS local')],
      ['P00001', tr('COS 원격', 'COS remote')],
      ['P00002', tr('P1 기동 PB', 'P1 start PB')],
      ['P00003', tr('P1 정지 PB (b)', 'P1 stop PB (NC)')],
      ['P00004', tr('P2 기동 PB', 'P2 start PB')],
      ['P00005', tr('P2 정지 PB (b)', 'P2 stop PB (NC)')],
      ['P00006', tr('리셋 PB', 'Reset PB')],
      ['P00007', tr('비상정지', 'E-stop')],
      ['P00008', tr('MC1 운전 확인', 'MC1 feedback')],
      ['P00009', tr('THR1 과부하', 'THR1 overload')],
      ['P0000A', tr('MC2 운전 확인', 'MC2 feedback')],
      ['P0000B', tr('THR2 과부하', 'THR2 overload')],
      ['P00040', tr('RY1 P1 운전', 'RY1 P1 run')],
      ['P00041', tr('RY2 P2 운전', 'RY2 P2 run')],
      ['P00042', tr('GL1 P1 운전등', 'GL1 P1 run lamp')],
      ['P00043', tr('GL2 P2 운전등', 'GL2 P2 run lamp')],
      ['P00044', tr('RL 고장등', 'RL fault lamp')],
      ['P00045', tr('BZ 부저', 'BZ buzzer')],
      ['M00100', tr('HMI P1 기동', 'HMI P1 start')],
      ['M00101', tr('HMI P1 정지', 'HMI P1 stop')],
      ['M00102', tr('HMI P2 기동', 'HMI P2 start')],
      ['M00103', tr('HMI P2 정지', 'HMI P2 stop')],
      ['M00104', tr('HMI 리셋', 'HMI reset')],
      ['M00010', tr('P1 고장', 'P1 fault')],
      ['M00011', tr('P2 고장', 'P2 fault')],
      ['M00012', tr('비상정지 기억', 'E-stop latched')],
      ['M00020', tr('고장 합계', 'Any fault')],
      ['M00021', tr('부저 정지', 'Buzzer silenced')],
      ['M00030', tr('리셋', 'Reset')],
      ['T0001', tr('MC1 확인 2초', 'MC1 check 2 s')],
      ['T0002', tr('MC2 확인 2초', 'MC2 check 2 s')],
      ['T0003', tr('점멸 켜짐', 'Flash on')],
      ['T0004', tr('점멸 꺼짐', 'Flash off')],
    ] as const
  )
    .map(([k, v]) => `${k}\t${v}`)
    .join('\n');
  return { dialect: 'ls', source, comments, sim: { ...defaultSimSettings(), watch: [] }, view: 'ladder', ladder: ilToLadder(source, 'ls').ladder };
}

export type ExampleGroup = 'motor' | 'panel' | 'temp' | 'home' | 'power' | 'basic';

/** 예제 메뉴의 묶음 (차례대로) */
export function exampleGroups(): { key: ExampleGroup; title: string }[] {
  return [
    { key: 'motor', title: tr('전동기 제어 (실물 배선)', 'Motor control (real wiring)') },
    { key: 'panel', title: tr('제어반 · 릴레이 · 센서 (실물 배선)', 'Panels, relays, sensors (real wiring)') },
    { key: 'temp', title: tr('온도 유지 · 제어 (실물 배선)', 'Temperature control (real wiring)') },
    { key: 'home', title: tr('전등 · 주거 (실물 배선)', 'Lighting & home (real wiring)') },
    { key: 'power', title: tr('분전반 · 계통 해석', 'Panelboards & system analysis') },
    { key: 'basic', title: tr('기호 회로 (시퀀스 · 공압 · PLC)', 'Schematics (sequence, pneumatics, PLC)') },
  ];
}

const EXAMPLE_GROUP: Record<string, ExampleGroup> = {
  real: 'motor',
  'motor-jog': 'motor',
  'motor-lamps': 'motor',
  'motor-2place': 'motor',
  'star-delta': 'motor',
  'motor-jog-run': 'motor',
  'motor-ls-stop': 'motor',
  'motor-fwd-rev': 'motor',
  'sol-alternate': 'panel',
  'lamp-delay': 'home',
  'pump-manual-auto': 'motor',
  'counter': 'panel',
  'ssr-heater': 'temp',
  prox2: 'panel',
  'sensor-oneshot': 'basic',
  'tc-heater': 'temp',
  'panel-thermo': 'temp',
  'pump-float': 'motor',
  panel: 'panel',
  'relay-socket': 'panel',
  'dc-sensor': 'panel',
  'home-outlet': 'home',
  stair: 'home',
  'tsw-light': 'home',
  'tsw-panel': 'home',
  busbar: 'power',
  feeders: 'power',
  substation: 'power',
  'plc-panel': 'panel',
  'earth-fault': 'power',
  'blower-timer': 'temp',
  'oven-pid': 'temp',
  'stair-impulse': 'home',
  'vfd-fwd-rev': 'motor',
  'water-supply': 'motor',
  'pid-learn': 'temp',
  'freezer-defrost': 'temp',
  'water-heater': 'temp',
  'temp-alarm': 'temp',
  'pipe-freeze': 'temp',
};

export interface CircuitExample {
  id: string;
  name: string;
  desc: string;
  /** 메뉴에서의 묶음 */
  group: ExampleGroup;
  build: () => Circuit;
  /** PLC 가 있는 회로: PLC 탭에 넣을 프로그램 */
  plc?: () => PlcConfig;
}

export function circuitExamples(): CircuitExample[] {
  const list: Omit<CircuitExample, 'group'>[] = [
    { id: 'substation', name: tr('수전 설비: 한전 → 변압기 → 분전반 (계통 해석)', 'Substation: utility → transformer → LV panel'), desc: tr('한전 22.9 kV → VCB → 변압기 500 kVA → 저압 메인 → 부스바 → 분기 4개. 변압기 부하율 · 전압 변동 · 단락 전류 검토. 일부러 넣은 문제 1개 (차단 용량)', 'Utility, VCB, transformer, LV main, busbar and branches; transformer loading and fault currents. One deliberate problem'), build: substation },
    { id: 'busbar', name: tr('분전반: 부스바 · 누전차단기 분기', 'Panelboard: busbar and ELB branches'), desc: tr('메인 4P → 세로 부스바 L1 L2 L3 N → 옆으로 놓은 분기 차단기 (3상 · 단상) → 부하. 탭이 자기 상 막대에만 물리는 것을 확인', 'Main 4P breaker, vertical busbar, sideways branch breakers tapped onto their bars'), build: busPanel },
    { id: 'feeders', name: tr('분전반 급전 해석 (케이블 · 전압강하)', 'Feeder analysis (cables, voltage drop)'), desc: tr('메인 분전반 → 부스바 → 급전선 → 분전반 2개. 케이블 규격으로 허용전류 · 전압강하 · 차단기 정격을 검토', 'Main panel, busbars and feeders to two panels; ampacity, voltage drop and breaker checks'), build: feederAnalysis },
    { id: 'tsw-light', name: tr('타임 스위치로 전등 자동 점멸 (기본)', 'Lights on a time switch (basic)'), desc: tr('24시간 다이얼 타임 스위치 하나로 전등 2개를 정해진 시각에 켜고 끕니다', 'One 24-hour dial time switch turns two lights on and off'), build: timeSwitchLight },
    { id: 'tsw-panel', name: tr('타임 스위치 + 자동/수동 + 전자접촉기', 'Time switch + auto/manual + contactor'), desc: tr('전등이 많을 때: 타임 스위치는 MC 코일만 움직이고, 셀렉터로 수동 점등', 'Many lights: the time switch drives a contactor coil, selector for manual on'), build: timeSwitchPanel },
    { id: 'stair', name: tr('3로 스위치 계단등', '3-way stair light'), desc: tr('3로 스위치 2개로 두 곳에서 전등 하나를 켜고 끕니다', 'Two 3-way switches control one light'), build: stairLight },
    { id: 'panel', name: tr('제어반 실물 배선: 릴레이 · 타이머 · 단자대', 'Control panel: relay, timer, terminal block'), desc: tr('비상정지 · 셀렉터 · 푸시버튼 · 램프 (문) ↔ 단자대 ↔ 8핀 릴레이 · 타이머 (판넬). 결선표를 따라 배선 연습', 'Door devices ↔ terminal block ↔ 8-pin relay and timer; follow the wiring list'), build: controlPanel },
    { id: 'relay-socket', name: tr('릴레이 소켓 배선: 각형 릴레이 자기유지', 'Relay socket wiring: self-holding'), desc: tr('각형 릴레이 (MY2N) 를 소켓 (PYF08A) 에 꽂고 소켓 나사 단자 13-14 · 9-5 · 12-8 · 12-4 에 배선. 기동 · 정지 버튼과 운전 · 정지 램프', 'A blade relay on its socket: wires on the socket screws 13-14, 9-5, 12-8, 12-4'), build: relaySocket },
    { id: 'motor-jog', name: tr('전동기: 조그 (인칭) 운전', 'Motor: jog'), desc: tr('버튼을 누르고 있는 동안만 운전. 차단기 → 전자접촉기 → 열동 계전기 → 전동기, 조작 회로 퓨즈', 'Runs only while the button is held; breaker, contactor, overload relay, motor'), build: motorJog },
    { id: 'motor-lamps', name: tr('전동기: 표시등 부착 자기유지', 'Motor: self-holding with lamps'), desc: tr('기동 · 정지 자기유지에 운전등 GL · 정지등 RL (MC 21-22) · 과부하등 YL (THR 97-98)', 'Start/stop with run, stop and overload lamps'), build: motorLamps },
    { id: 'motor-2place', name: tr('전동기: 2개소 (다점) 제어', 'Motor: two-place control'), desc: tr('조작반과 현장 두 곳에서 기동 · 정지. 정지 버튼은 직렬, 기동 버튼은 병렬', 'Start and stop from two places: stops in series, starts in parallel'), build: motorTwoPlace },
    { id: 'motor-jog-run', name: tr('전동기: 조그 + 연속 운전 (보조 릴레이)', 'Motor: jog and run (auxiliary relay)'), desc: tr('기동은 보조 릴레이가 기억해 연속 운전, 조그 버튼은 누르는 동안만. 각형 릴레이 소켓 배선', 'Run is held by an auxiliary relay; jog works only while pressed'), build: motorJogRun },
    { id: 'motor-ls-stop', name: tr('전동기: 리밋 스위치 자동 정지', 'Motor: limit switch stop'), desc: tr('자기유지로 돌다가 끝 위치의 리밋 스위치 (b접점) 가 열리면 스스로 정지', 'Self-holding run that stops when the limit switch (NC) opens'), build: motorLimitStop },
    { id: 'motor-fwd-rev', name: tr('전동기: 정 · 역 운전 이중 인터록', 'Motor: forward / reverse, double interlock'), desc: tr('접촉기 2개로 두 상을 바꿔 역회전. 버튼 b접점과 접촉기 b접점으로 이중 인터록, 돌던 중에 반대 버튼을 눌러도 안전', 'Two contactors swap two phases; button and contactor interlocks'), build: motorReversing },
    { id: 'star-delta', name: tr('전동기: 자동 Y-Δ 기동', 'Motor: automatic star-delta start'), desc: tr('6단자 전동기를 Y 결선으로 기동하고 타이머 3초 뒤 Δ 결선으로 전환. 접촉기 3개 · 타이머 · 인터록', 'A 6-lead motor starts in star and switches to delta after 3 s; three contactors, timer, interlock'), build: starDelta },
    { id: 'pump-manual-auto', name: tr('급수 펌프: 수동 · 정지 · 자동 (3단 셀렉터)', 'Feed pump: manual / off / auto (3-position selector)'), desc: tr('3단 셀렉터로 수동 (기동 · 정지 버튼 자기유지) · 정지 · 자동 (플로트 스위치) 선택', 'A 3-position selector picks buttons, off or the float switch'), build: pumpManualAuto },
    { id: 'pump-float', name: tr('급수 펌프: 플로트 스위치 자동 / 수동', 'Feed pump: float switch auto / manual'), desc: tr('자동은 저수위에서 운전 · 만수에서 정지, 수동은 바로 운전. 셀렉터 · 플로트 스위치 · 운전등', 'Float switch in auto, direct run in manual'), build: pumpFloat },
    { id: 'dc-sensor', name: tr('직류 24V: SMPS · 근접 센서 · 릴레이 · 솔레노이드', '24 V DC: SMPS, proximity sensor, relay, solenoid'), desc: tr('퓨즈 → SMPS → 근접 센서 (PNP 3선식) → 각형 릴레이 → 솔레노이드 밸브 · 부저. 덕트 · 전압계', 'Fuse, SMPS, PNP sensor, blade relay, solenoid valve and buzzer; duct and voltmeter'), build: dcSensor },
    { id: 'sol-alternate', name: tr('솔레노이드 밸브 2개 교번 (플리커 타이머)', 'Two solenoid valves alternating (flicker timer)'), desc: tr('플리커 타이머의 a접점과 b접점이 1초마다 번갈아 밸브 A · B 를 여자', 'A flicker timer energises valve A and valve B in turn'), build: solAlternate },
    { id: 'counter', name: tr('생산 수량 카운터 (완료등 · 리셋)', 'Production counter (done lamp, reset)'), desc: tr('리밋 스위치가 3번 눌리면 완료등, 리셋 버튼으로 0. 카운터의 무전압 입력 CP · COM · RST 와 출력 C · NO · NC', 'Three counts light the done lamp; reset button. Dry-contact inputs and the c/o output'), build: counterBasic },
    { id: 'prox2', name: tr('2선식 근접 센서 (DC · AC)', '2-wire proximity sensors (DC, AC)'), desc: tr('갈색 · 파랑 두 선을 램프와 직렬로. 직류는 갈색이 + 쪽, 교류는 극성 없음', 'Brown and blue in series with a lamp; DC brown on +, AC unpolarised'), build: prox2Wire },
    { id: 'tc-heater', name: tr('히터 온도 제어 (온도 조절기 · 전자접촉기)', 'Heater temperature control (controller, contactor)'), desc: tr('온도 조절기 OUT 이 접촉기로 히터를 켜고 꺼서 60℃ 유지, 80℃ 이상이면 과열 경보', 'The controller OUT switches the heater contactor to hold 60℃; overheat alarm at 80℃'), build: tcHeater },
    { id: 'panel-thermo', name: tr('판넬 온도 관리 (서모스탯: 팬 · 히터)', 'Panel climate (thermostats: fan, heater)'), desc: tr('35℃ 면 판넬 팬, 5℃ 면 결로 방지 히터. 판넬 온도를 여름 · 겨울처럼 바꿔 봄', 'Fan at 35℃, anti-condensation heater at 5℃; the panel temperature follows summer and winter'), build: panelThermo },
    { id: 'ssr-heater', name: tr('SSR 로 히터 켜기', 'Heater on an SSR'), desc: tr('DC 24V 스위치로 SSR 입력 (3 + · 4 -) 을 넣어 교류 히터 2 kW 를 개폐', 'A 24 V DC switch drives the SSR input; the SSR switches a 2 kW AC heater'), build: ssrHeater },
    { id: 'lamp-delay', name: tr('타이머 지연 점등 (표시등)', 'Delayed lamp on a timer'), desc: tr('스위치를 켜고 3초 뒤에 표시등이 켜진다. 8핀 타이머의 전원 2-7 과 한시 a접점 8-6', 'The lamp lights 3 s after the switch; 8-pin timer power 2-7 and timed NO 8-6'), build: lampDelay },
    { id: 'home-outlet', name: tr('주거 배선: 누전차단기 · 스위치 · 전등 · 콘센트', 'Home wiring: ELB, switch, light, outlet'), desc: tr('누전차단기에서 스위치 → 전등, 콘센트. 중성선 바와 접지 바에서 회로마다 한 가닥씩', 'ELB to switch, light and outlet; neutral and earth bars'), build: homeOutlet },
    { id: 'real', name: tr('실물 배선도: 전동기 기동·정지', 'Wiring diagram: motor start/stop'), desc: tr('차단기 3P·2P, 전자접촉기, 푸시버튼 유닛, 전동기를 실제 단자 번호와 전선 색으로', 'Real devices with terminal numbers and wire colours'), build: realWiring },
    { id: 'self-hold', name: tr('자기유지 (전동기 기동·정지)', 'Self-holding (motor start/stop)'), desc: tr('기동 PB로 MC1 자기유지, 정지 PB로 해제. 주회로와 표시등 포함', 'Start latches MC1, stop releases it; power circuit and lamps'), build: selfHold },
    { id: 'reversing', name: tr('정역 운전 (인터록)', 'Forward / reverse (interlock)'), desc: tr('MC1·MC2 서로 b접점 인터록, 주회로에서 L1·L3 교체', 'MC1/MC2 interlocked, L1 and L3 swapped'), build: reversing },
    { id: 'sensor-oneshot', name: tr('센서 감지 → 솔밸브 3초만 (인터벌 타이머)', 'Sensor → solenoid for 3 s (interval timer)'), desc: tr('감지하면 바로 켜지고 3초 뒤 꺼짐 (계속 감지해도). 감지가 짧으면 그때 꺼짐', 'On at once, off after 3 s even if still detecting'), build: sensorOneShot },
    { id: 'timer', name: tr('타이머 지연 동작', 'Timer delay'), desc: tr('기동 3초 뒤 운전, 기다리는 동안 대기 표시', 'Run 3 s after start, waiting lamp meanwhile'), build: timerDelay },
    { id: 'cylinder', name: tr('공압 실린더 1사이클', 'Cylinder one cycle'), desc: tr('기동 → 전진 → 전진단 → 후진 → 후진단', 'Start → advance → end → return'), build: cylinderCycle },
    { id: 'pneumatic', name: tr('전공압 자동 왕복 (밸브 · 근접 센서)', 'Electro-pneumatic auto cycle'), desc: tr('공압원 → FRL → 5/2 양솔 밸브 → 속도 제어 → 실린더, 근접 센서로 왕복', 'Air supply, FRL, 5/2 valve, flow control, cylinder, proximity sensors'), build: electroPneumatic },
    {
      id: 'blower-timer',
      name: tr('열풍기 온도 제어 + 24시간 타이머 (전기 요금)', 'Hot-air blower: temperature control + 24-h timer (energy cost)'),
      desc: tr('측온저항체 Pt100 → 온도 조절기 (T3S 꼴) → 전자접촉기 → 열풍기 5 kW, 08~18시 자동 운전과 하루 전력량 · 요금', 'Pt100 RTD → controller (T3S type) → contactor → 5 kW blower, timer 08:00–18:00, daily energy and cost'),
      build: blowerTimer,
    },
    {
      id: 'vfd-fwd-rev',
      name: tr('인버터 정 · 역 운전 (다단속 · 가감속 · 고장 경보)', 'Inverter forward / reverse (preset speeds, ramps, fault alarm)'),
      desc: tr('3상 → 차단기 → 인버터 → 전동기. 셀렉터로 정 · 역회전과 저속 · 고속, 가감속 5초, 고장 릴레이 → 경보등', '3-phase → breaker → inverter → motor; selectors for direction and speed, 5 s ramps, fault relay → alarm lamp'),
      build: vfdFwdRev,
    },
    {
      id: 'water-supply',
      name: tr('급수 펌프: 플로트리스 릴레이 (전극봉 수위 자동)', 'Feed pump: floatless relay (electrode level control)'),
      desc: tr('물탱크 전극봉 E1 · E2 · E3 → 플로트리스 릴레이 → 하한 아래면 펌프 운전 · 상한에서 정지, 만수등 · 운전등. 수위가 타임차트에 % 로', 'Tank electrodes → floatless relay → pump runs below the low electrode and stops at the high one; level shown in % on the chart'),
      build: waterSupply,
    },
    {
      id: 'stair-impulse',
      name: tr('계단 조명: 세 곳에서 켜고 끄기 (임펄스 릴레이)', 'Stair lighting from three places (impulse relay)'),
      desc: tr('푸시버튼 3개를 나란히 임펄스 릴레이 코일에, 누를 때마다 전등이 켜짐 ↔ 꺼짐', 'Three push buttons in parallel on an impulse relay; each press toggles the lamp'),
      build: stairImpulse,
    },
    {
      id: 'freezer-defrost',
      name: tr('냉동 창고: 냉각 온도 조절 + 압축기 + 제상 타이머', 'Freezer: cooling control, compressor, defrost timer'),
      desc: tr('온도 조절기 (냉각) 가 -18 ↔ -20℃ 로 압축기를 켜고 끄고, 트윈 타이머가 12분마다 3분 제상 (압축기 정지 · 제상 히터)', 'A cooling controller cycles the compressor between -18 and -20℃; a twin timer defrosts 3 min every 12 min (compressor off, defrost heater on)'),
      build: freezerDefrost,
    },
    {
      id: 'water-heater',
      name: tr('전기 온수기: 급수 · 60℃ 유지 · 공가열 방지 · 과열 차단', 'Electric water heater: fill, hold 60℃, dry-fire guard, over-temp cut-out'),
      desc: tr('전극봉 → 플로트리스 릴레이: 물이 적으면 급수 밸브, 물이 있을 때만 히터. 온도 조절기 60℃, 과열 방지 서모스탯 90℃', 'Electrodes → floatless relay: fill valve when low, heater only with water; controller 60℃, over-temp thermostat 90℃'),
      build: waterHeater,
    },
    {
      id: 'temp-alarm',
      name: tr('온도 경보 회로: 부저 정지 (확인) · 경보등 유지', 'Temperature alarm: silence button, lamp stays on'),
      desc: tr('80℃ 이상이면 경보 릴레이 → 경보등 + 부저. 확인 버튼을 누르면 확인 릴레이가 자기유지해 부저만 멈춤, 온도가 내려가면 풀림', 'Above 80℃ the alarm relay lights the lamp and sounds the buzzer; the acknowledge relay latches to silence it until the temperature drops'),
      build: tempAlarm,
    },
    {
      id: 'pipe-freeze',
      name: tr('배관 동파 방지 열선 (서모스탯 · 누전차단기)', 'Pipe frost protection (thermostat, RCD)'),
      desc: tr('서모스탯이 3℃ 이하면 열선을 켜고 8℃ 에서 끔. 밤 -10℃ 에서 배관 온도를 지키고, 아침 햇볕에 꺼진 채로', 'The thermostat runs the heat trace below 3℃ and stops at 8℃, holding the pipe on a -10℃ night'),
      build: pipeFreeze,
    },
    {
      id: 'pid-learn',
      name: tr('PID 배우기: 같은 오븐 4대를 ON/OFF · P · PI · PID 로 비교', 'Learn PID: four identical ovens under ON/OFF, P, PI and PID'),
      desc: tr('설정 100℃, 열이 센서까지 30초 지연. ON/OFF 의 넘침 · 흔들림, P 의 잔류 편차, PI 의 넘침, PID 의 D 효과를 한 차트에서. 20분에 문 열림 (외란)', 'Set 100℃, 30 s dead time: ON/OFF overshoot and hunting, P offset, PI overshoot and the effect of D on one chart; doors opened at 20 min'),
      build: pidLearn,
    },
    {
      id: 'oven-pid',
      name: tr('건조로 PID 온도 제어 (TK4S 꼴 · 더블 Pt100 · 과열 차단)', 'Oven PID temperature control (TK4S type, duplex Pt100, over-temp cut-off)'),
      desc: tr('더블 Pt100 의 1번 소자 → PID 조절기 (120℃), 2번 소자 → 과열 차단 (150℃), 경보 AL1 → 적색등', 'Duplex Pt100: element 1 → PID controller (120℃), element 2 → over-temp cut-off (150℃), AL1 → red lamp'),
      build: ovenPid,
    },
    {
      id: 'earth-fault',
      name: tr('누전 · 지락: 접지와 누전차단기 (TT)', 'Earth faults: earthing and RCDs (TT)'),
      desc: tr('전동기 · 콘센트에 누전을 일으켜 지락 전류 · 외함 전압 · 누전차단기 트립을 봅니다', 'Earth faults on a motor and an outlet: earth current, frame voltage and RCD trips'),
      build: earthFaultDemo,
    },
    {
      id: 'plc-panel',
      name: tr('PLC 제어반: 펌프 2대 (로컬 · HMI)', 'PLC panel: two pumps (local / HMI)'),
      desc: tr('실물 PLC · HMI · 보조 릴레이 · MC · THR. 비상정지와 THR 은 MC 코일을 직접 끊고, PLC 출력은 DC 24V 릴레이만 켭니다', 'Real PLC, HMI, interposing relays, contactors and overloads; the E-stop and overloads break the coils directly'),
      build: plcPanel,
      plc: plcPanelProgram,
    },
    { id: 'plc', name: tr('PLC 자기유지 + 타이머', 'PLC self-hold + timer'), desc: tr('푸시버튼 → PLC 입력, PLC 출력 → 램프. 프로그램은 PLC 탭에서 고칩니다', 'Buttons to PLC inputs, outputs to lamps; edit the program in the PLC tab'), build: plcSelfHold, plc: plcSelfHoldProgram },
  ];
  return list.map((e) => ({ ...e, group: EXAMPLE_GROUP[e.id] ?? 'basic' }));
}
