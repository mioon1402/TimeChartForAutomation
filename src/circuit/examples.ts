import type { Circuit, OpStep, Part, PartType, Wire } from './types';
import { uid } from '../model/wave';
import { tr } from '../i18n';
import { defaultSimSettings, type PlcConfig } from '../plc/types';

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

  op(wait: number, tag: string, action: OpStep['action'] = 'press', note = '', hold = 300): void {
    this.ops.push({ id: uid('op'), wait, tag, action, hold, ...(note ? { note } : {}) });
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
  return { dialect: 'mitsubishi', source, comments, sim: { ...defaultSimSettings(), watch: ['X0', 'X1', 'Y0', 'T0', 'Y1'] } };
}

export interface CircuitExample {
  id: string;
  name: string;
  desc: string;
  build: () => Circuit;
  /** PLC 가 있는 회로: PLC 탭에 넣을 프로그램 */
  plc?: () => PlcConfig;
}

export function circuitExamples(): CircuitExample[] {
  return [
    { id: 'self-hold', name: tr('자기유지 (전동기 기동·정지)', 'Self-holding (motor start/stop)'), desc: tr('기동 PB로 MC1 자기유지, 정지 PB로 해제. 주회로와 표시등 포함', 'Start latches MC1, stop releases it; power circuit and lamps'), build: selfHold },
    { id: 'reversing', name: tr('정역 운전 (인터록)', 'Forward / reverse (interlock)'), desc: tr('MC1·MC2 서로 b접점 인터록, 주회로에서 L1·L3 교체', 'MC1/MC2 interlocked, L1 and L3 swapped'), build: reversing },
    { id: 'timer', name: tr('타이머 지연 동작', 'Timer delay'), desc: tr('기동 3초 뒤 운전, 기다리는 동안 대기 표시', 'Run 3 s after start, waiting lamp meanwhile'), build: timerDelay },
    { id: 'cylinder', name: tr('공압 실린더 1사이클', 'Cylinder one cycle'), desc: tr('기동 → 전진 → 전진단 → 후진 → 후진단', 'Start → advance → end → return'), build: cylinderCycle },
    { id: 'plc', name: tr('PLC 자기유지 + 타이머', 'PLC self-hold + timer'), desc: tr('푸시버튼 → PLC 입력, PLC 출력 → 램프. 프로그램은 PLC 탭에서 고칩니다', 'Buttons to PLC inputs, outputs to lamps; edit the program in the PLC tab'), build: plcSelfHold, plc: plcSelfHoldProgram },
  ];
}
