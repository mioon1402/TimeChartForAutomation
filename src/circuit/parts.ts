import type { CableSpec, Circuit, LampColor, Part, PartType, Pole, Rot, Wire, WireColor } from './types';
import type { PlcDialect } from '../plc/types';
import { tr } from '../i18n';
import { formatTime } from '../model/format';

export type PartCategory = 'power' | 'protect' | 'switch' | 'relay' | 'output' | 'pneumatic' | 'plc' | 'misc';

export interface PinDef {
  x: number;
  y: number;
  /** 단자 번호 (13, 14, A1, U …) */
  label: string;
  /** 공압 포트 (배관을 잇는 곳) */
  air?: boolean;
}

export interface PartDef {
  type: PartType;
  cat: PartCategory;
  pins: PinDef[];
  /** 서로 이어지는 단자 쌍 (접점·퓨즈·차단기) */
  poles?: [number, number][];
  /** 단자 쌍마다 b접점인가 (없으면 nc 를 따름) - 실물 기기의 a·b 접점이 섞일 때 */
  polesNc?: boolean[];
  /** 기기 안의 코일 단자 (A1, A2) - 이 기기의 접점이 이 코일을 따른다 */
  selfCoil?: [number, number];
  /** 부하: 두 단자 사이에 전압이 걸리면 동작 */
  load?: boolean;
  /** 부하 단자가 처음 두 개가 아닐 때 (조광형 버튼의 램프 X1 · X2). 코일과 달리 접점을 움직이지 않는다 */
  loadPins?: [number, number];
  /** 접점이 평상시 닫혀 있음 (b접점) */
  nc?: boolean;
  /** 사람이 조작: 누르는 동안 / 눌러서 유지 */
  operate?: 'momentary' | 'toggle';
  /** 조작하지 않았을 때 눌린(켜진) 상태 - 차단기는 ON 이 기본 */
  defaultOn?: boolean;
  /** 클릭·이동을 받는 영역 (격자, 회전 전) */
  box: [number, number, number, number];
  prefix: string;
}

const V2: PinDef[] = [
  { x: 0, y: -2, label: '' },
  { x: 0, y: 2, label: '' },
];
const P3: PinDef[] = [
  { x: -2, y: -2, label: '1' },
  { x: 0, y: -2, label: '3' },
  { x: 2, y: -2, label: '5' },
  { x: -2, y: 2, label: '2' },
  { x: 0, y: 2, label: '4' },
  { x: 2, y: 2, label: '6' },
];
const POLES3: [number, number][] = [
  [0, 3],
  [1, 4],
  [2, 5],
];
const VALVE5: PinDef[] = [
  { x: -1, y: -2, label: '4', air: true },
  { x: 1, y: -2, label: '2', air: true },
  { x: 0, y: 2, label: '1', air: true },
];
const BOX2: [number, number, number, number] = [-1, -2, 1, 2];
const BOX2W: [number, number, number, number] = [-1.6, -2, 1, 2];
const BOX3: [number, number, number, number] = [-3, -2, 3, 2];

const pin = (x: number, y: number, label: string): PinDef => ({ x, y, label });

/**
 * PLC (실물) 단자 차례: 0~15 입력, 16 입력 공통 COM, 17~32 출력, 33 COM0 (출력 0~7 공통), 34 COM1 (출력 8~15 공통), 35 +, 36 −, 37 FG.
 * 위 단자대: 전원 + · − · FG, COM, 입력 16. 아래 단자대: COM0, 출력 8, COM1, 출력 8
 */
export const RPLC = { nIn: 16, nOut: 16, com: 16, out0: 17, com0: 33, com1: 34, plus: 35, minus: 36, fg: 37 } as const;
function rplcPins(ins: string[], outs: string[]): PinDef[] {
  return [
    ...ins.map((a, n) => pin(-13 + 2 * n, -5, a)),
    pin(-15, -5, 'COM'),
    ...outs.map((a, n) => pin(n < 8 ? -13 + 2 * n : 5 + 2 * (n - 8), 5, a)),
    pin(-15, 5, 'COM0'),
    pin(3, 5, 'COM1'),
    pin(-22, -5, '+'),
    pin(-20, -5, '−'),
    pin(-18, -5, 'FG'),
  ];
}
/** 8핀 소켓 단자: 번호 순서대로 (2-7 코일, 1 공통 → 3 a · 4 b, 8 공통 → 6 a · 5 b) */
const OCTAL: PinDef[] = [pin(-3, -3, '1'), pin(-1, -3, '2'), pin(1, -3, '3'), pin(3, -3, '4'), pin(3, 3, '5'), pin(1, 3, '6'), pin(-1, 3, '7'), pin(-3, 3, '8')];

/**
 * 8핀 원형 소켓 (PF083A · 8PFA 꼴) 의 나사 단자 자리. 소켓을 위에서 보면 핀 번호가 릴레이 밑면 그림의 거울상이라
 * 홈 (키) 을 아래로 두면 위 줄 6 5 4 3, 아래 줄 7 8 1 2 가 된다. 같은 소켓을 돌려 달면 위 2 1 8 7, 아래 3 4 5 6.
 * seq 는 예전 그림 (번호순) 으로, 소켓 배열이 저장되지 않은 옛 파일이 그대로 읽히게 남겨 둔다.
 */
export type OctalLayout = 'seq' | 'pf' | 'pfr';
export const OCTAL_ROWS: Record<OctalLayout, { top: number[]; bottom: number[] }> = {
  seq: { top: [1, 2, 3, 4], bottom: [8, 7, 6, 5] },
  pf: { top: [6, 5, 4, 3], bottom: [7, 8, 1, 2] },
  pfr: { top: [2, 1, 8, 7], bottom: [3, 4, 5, 6] },
};
export function octalLayout(p: Pick<Part, 'sock'>): OctalLayout {
  return p.sock === 'pf' || p.sock === 'pfr' ? p.sock : 'seq';
}
/** 단자 번호 1~8 순서로 단자 자리 (칸) */
function octalPins(layout: OctalLayout): PinDef[] {
  const rows = OCTAL_ROWS[layout];
  const out: PinDef[] = [];
  for (let n = 1; n <= 8; n++) {
    const t = rows.top.indexOf(n);
    const k = t >= 0 ? t : rows.bottom.indexOf(n);
    out.push(pin(-3 + 2 * k, t >= 0 ? -3 : 3, String(n)));
  }
  return out;
}
const OCTAL_PINS: Record<OctalLayout, PinDef[]> = { seq: OCTAL, pf: octalPins('pf'), pfr: octalPins('pfr') };

/**
 * 각형 릴레이 소켓 (PYF08A · PYF14A 꼴, 위에서 본 그림): 위쪽 바깥 단 b 접점 (4 3 2 1), 안쪽 단 a 접점 (8 7 6 5),
 * 아래쪽 안쪽 단 공통 (12 11 10 9), 바깥 단 코일 (14 · 13). 2극은 가운데 두 줄이 빠진다 (4 1 / 8 5 / 12 9 / 14 13).
 * 실물은 위아래 단이 같은 줄에 있지만, 그림에서는 안쪽 단의 선이 바깥 단 나사 사이로 지나가도록 한 칸 옆에 둔다.
 */
export const MY_COLS: Record<'r_my2' | 'r_my4', number[]> = { r_my2: [4, 1], r_my4: [4, 3, 2, 1] };
function myPins(type: 'r_my2' | 'r_my4'): PinDef[] {
  const cols = MY_COLS[type];
  const x0 = -(cols.length - 1);
  const at = new Map<number, [number, number]>();
  cols.forEach((n, k) => {
    at.set(n, [x0 + 2 * k, -5]);
    at.set(n + 4, [x0 + 2 * k - 1, -3]);
    at.set(n + 8, [x0 + 2 * k - 1, 3]);
  });
  at.set(14, [x0, 5]);
  at.set(13, [x0 + 2 * (cols.length - 1), 5]);
  return [...at.keys()].sort((a, b) => a - b).map((n) => pin(at.get(n)![0], at.get(n)![1], String(n)));
}
/** 단자 번호 → 단자 목록에서의 차례 */
function myPoles(type: 'r_my2' | 'r_my4'): [number, number][] {
  const nums = myPins(type).map((q) => Number(q.label));
  const i = (n: number) => nums.indexOf(n);
  // 극마다 공통 → a (5~8), 공통 → b (1~4). 1번 극부터
  return [...MY_COLS[type]].sort((a, b) => a - b).flatMap((n) => [[i(n + 8), i(n + 4)], [i(n + 8), i(n)]] as [number, number][]);
}
const MY2 = myPins('r_my2');
const MY4 = myPins('r_my4');
const OCTAL_POLES: [number, number][] = [
  [0, 2],
  [0, 3],
  [7, 5],
  [7, 4],
];
const PB_POLES: [number, number][] = [
  [0, 1],
  [2, 3],
];

const pins2 = (a: string, b: string): PinDef[] => [
  { ...V2[0], label: a },
  { ...V2[1], label: b },
];

export const PARTS: Record<PartType, PartDef> = {
  src: { type: 'src', cat: 'power', pins: [{ x: 0, y: 0, label: '' }], box: [-1, -1.6, 1, 0.5], prefix: '' },
  src3: {
    type: 'src3',
    cat: 'power',
    pins: [
      { x: -2, y: 1, label: 'L1' },
      { x: 0, y: 1, label: 'L2' },
      { x: 2, y: 1, label: 'L3' },
    ],
    box: [-3, -1.2, 3, 1],
    prefix: '',
  },
  fuse: { type: 'fuse', cat: 'protect', pins: V2, poles: [[0, 1]], box: BOX2, prefix: 'F' },
  // 임펄스 릴레이 (래칭) 코일: 코일에 펄스가 들어올 때마다 같은 기호의 접점이 바뀌어 유지된다
  imp: { type: 'imp', cat: 'relay', pins: pins2('A1', 'A2'), load: true, box: BOX2, prefix: 'LR' },
  // 스파크 킬러 (CR): 시뮬레이션에서는 아무것도 하지 않는다 (서지 흡수 · 누설은 [검사] 가 본다)
  sk: { type: 'sk', cat: 'protect', pins: V2, box: BOX2, prefix: 'SK' },
  // 다이오드 (직류 코일 서지 흡수, 환류): 위 K (띠) 를 + 쪽, 아래 A 를 0V 쪽으로 코일 양단에. 시뮬레이션은 아무것도 하지 않는다 ([검사] 가 방향을 본다)
  diode: { type: 'diode', cat: 'protect', pins: pins2('K', 'A'), box: BOX2, prefix: 'D' },
  fuse3: { type: 'fuse3', cat: 'protect', pins: P3, poles: POLES3, box: BOX3, prefix: 'F' },
  mcb: { type: 'mcb', cat: 'protect', pins: pins2('1', '2'), poles: [[0, 1]], operate: 'toggle', defaultOn: true, box: BOX2W, prefix: 'CB' },
  mcb3: { type: 'mcb3', cat: 'protect', pins: P3, poles: POLES3, operate: 'toggle', defaultOn: true, box: BOX3, prefix: 'MCCB' },
  ol3: { type: 'ol3', cat: 'protect', pins: P3, poles: POLES3, nc: true, operate: 'toggle', box: BOX3, prefix: 'THR' },
  pb_no: { type: 'pb_no', cat: 'switch', pins: pins2('3', '4'), poles: [[0, 1]], operate: 'momentary', box: BOX2W, prefix: 'PB' },
  pb_nc: { type: 'pb_nc', cat: 'switch', pins: pins2('1', '2'), poles: [[0, 1]], nc: true, operate: 'momentary', box: BOX2W, prefix: 'PB' },
  sw_no: { type: 'sw_no', cat: 'switch', pins: pins2('3', '4'), poles: [[0, 1]], operate: 'toggle', box: BOX2W, prefix: 'SS' },
  sw_nc: { type: 'sw_nc', cat: 'switch', pins: pins2('1', '2'), poles: [[0, 1]], nc: true, operate: 'toggle', box: BOX2W, prefix: 'SS' },
  estop: { type: 'estop', cat: 'switch', pins: pins2('1', '2'), poles: [[0, 1]], nc: true, operate: 'toggle', box: BOX2W, prefix: 'EMS' },
  ls_no: { type: 'ls_no', cat: 'switch', pins: pins2('3', '4'), poles: [[0, 1]], operate: 'toggle', box: BOX2W, prefix: 'LS' },
  ls_nc: { type: 'ls_nc', cat: 'switch', pins: pins2('1', '2'), poles: [[0, 1]], nc: true, operate: 'toggle', box: BOX2W, prefix: 'LS' },
  no: { type: 'no', cat: 'relay', pins: pins2('13', '14'), poles: [[0, 1]], box: BOX2W, prefix: 'X' },
  nc: { type: 'nc', cat: 'relay', pins: pins2('21', '22'), poles: [[0, 1]], nc: true, box: BOX2W, prefix: 'X' },
  km3: { type: 'km3', cat: 'relay', pins: P3, poles: POLES3, box: BOX3, prefix: 'MC' },
  coil: { type: 'coil', cat: 'relay', pins: pins2('A1', 'A2'), load: true, box: BOX2, prefix: 'X' },
  timer: { type: 'timer', cat: 'relay', pins: pins2('A1', 'A2'), load: true, box: BOX2, prefix: 'T' },
  lamp: { type: 'lamp', cat: 'output', pins: pins2('X1', 'X2'), load: true, box: BOX2, prefix: 'PL' },
  buzzer: { type: 'buzzer', cat: 'output', pins: pins2('1', '2'), load: true, box: BOX2, prefix: 'BZ' },
  motor3: {
    type: 'motor3',
    cat: 'output',
    pins: [
      { x: -2, y: -2, label: 'U' },
      { x: 0, y: -2, label: 'V' },
      { x: 2, y: -2, label: 'W' },
    ],
    load: true,
    box: [-3, -2, 3, 2.8],
    prefix: 'M',
  },
  motor: { type: 'motor', cat: 'output', pins: pins2('1', '2'), load: true, box: BOX2, prefix: 'M' },
  sol: { type: 'sol', cat: 'pneumatic', pins: pins2('1', '2'), load: true, box: BOX2, prefix: 'SOL' },
  load: { type: 'load', cat: 'output', pins: pins2('1', '2'), load: true, box: BOX2, prefix: 'H' },
  // 헤드 쪽 포트(전진용)와 로드 쪽 포트(후진용). 배관이 없으면 솔레노이드 기호로 움직인다
  cyl: {
    type: 'cyl',
    cat: 'pneumatic',
    pins: [
      { x: 1, y: 2, label: '', air: true },
      { x: 5, y: 2, label: '', air: true },
    ],
    box: [0, -1.6, 12, 2.2],
    prefix: 'CYL',
  },
  prox: {
    type: 'prox',
    cat: 'switch',
    pins: [
      { x: 0, y: -2, label: 'BN' },
      { x: 0, y: 2, label: 'BK' },
      { x: 2, y: 2, label: 'BU' },
    ],
    operate: 'toggle',
    box: [-1.4, -2, 2.4, 2],
    prefix: 'PX',
  },
  smps: {
    type: 'smps',
    cat: 'power',
    pins: [
      { x: -1, y: -2, label: 'L' },
      { x: 1, y: -2, label: 'N' },
      { x: -1, y: 2, label: '+V' },
      { x: 1, y: 2, label: '-V' },
    ],
    box: [-1.8, -2, 1.8, 2],
    prefix: 'SMPS',
  },
  air: { type: 'air', cat: 'pneumatic', pins: [{ x: 0, y: 1, label: '', air: true }], box: [-1, -0.8, 1, 1], prefix: '' },
  frl: {
    type: 'frl',
    cat: 'pneumatic',
    pins: [
      { x: 0, y: -2, label: '', air: true },
      { x: 0, y: 2, label: '', air: true },
    ],
    box: [-1.4, -2, 1.4, 2],
    prefix: 'FRL',
  },
  fc: {
    type: 'fc',
    cat: 'pneumatic',
    pins: [
      { x: 0, y: -2, label: '', air: true },
      { x: 0, y: 2, label: '', air: true },
    ],
    box: [-1, -2, 1.6, 2],
    prefix: 'SC',
  },
  // 밸브: 가운데 칸(-2~2)에 지금 위치의 칸이 오고, 포트는 그 칸의 위(4·2)와 아래(1)
  v32: {
    type: 'v32',
    cat: 'pneumatic',
    pins: [
      { x: -1, y: -2, label: '2', air: true },
      { x: -1, y: 2, label: '1', air: true },
    ],
    box: [-7.5, -2, 7.5, 2],
    prefix: 'V',
  },
  v52: { type: 'v52', cat: 'pneumatic', pins: VALVE5, box: [-7.5, -2, 7.5, 2], prefix: 'V' },
  v52d: { type: 'v52d', cat: 'pneumatic', pins: VALVE5, box: [-7.5, -2, 7.5, 2], prefix: 'V' },
  v53: { type: 'v53', cat: 'pneumatic', pins: VALVE5, box: [-11.5, -2, 11.5, 2], prefix: 'V' },
  // 입력 I0~I7 (위), 출력 공통 C 와 Q0~Q7 (아래)
  plc: {
    type: 'plc',
    cat: 'plc',
    pins: [
      ...Array.from({ length: 8 }, (_, n) => ({ x: -7 + 2 * n, y: -3, label: `I${n}` })),
      { x: -9, y: 3, label: 'C' },
      ...Array.from({ length: 8 }, (_, n) => ({ x: -7 + 2 * n, y: 3, label: `Q${n}` })),
    ],
    box: [-10, -3, 9, 3],
    prefix: 'PLC',
  },
  // ── 실물 배선도 기기 ──
  // PLC (실물, 입력 16 · 릴레이 출력 16): DC 24V 전원이 + · − 에 들어와야 돈다. 입력은 COM 과 반대 극이 닿으면 ON (싱크 · 소스)
  r_plc: {
    type: 'r_plc',
    cat: 'plc',
    pins: rplcPins(
      Array.from({ length: 16 }, (_, n) => `X${n.toString(8)}`),
      Array.from({ length: 16 }, (_, n) => `Y${n.toString(8)}`),
    ),
    load: true,
    loadPins: [RPLC.plus, RPLC.minus],
    box: [-23.5, -6, 20.5, 6],
    prefix: 'PLC',
  },
  // HMI (터치 판넬): 아래 전원 단자 + · − · FG. 화면 버튼 · 램프는 PLC 디바이스와 통신으로 이어진다
  r_hmi: { type: 'r_hmi', cat: 'plc', pins: [pin(-2, 6, '+'), pin(0, 6, '−'), pin(2, 6, 'FG')], load: true, box: [-9, -7.5, 9, 7], prefix: 'HMI' },
  r_term: { type: 'r_term', cat: 'power', pins: [{ x: 0, y: 0, label: '' }], box: [-1, -2, 1, 1], prefix: '' },
  r_mcb1: { type: 'r_mcb1', cat: 'protect', pins: [pin(0, -4, '1'), pin(0, 4, '2')], poles: [[0, 1]], operate: 'toggle', defaultOn: true, box: [-1.3, -5, 1.3, 5], prefix: 'MCB' },
  r_mcb2: {
    type: 'r_mcb2',
    cat: 'protect',
    pins: [pin(-1, -4, '1'), pin(1, -4, '3'), pin(-1, 4, '2'), pin(1, 4, '4')],
    poles: [
      [0, 2],
      [1, 3],
    ],
    operate: 'toggle',
    defaultOn: true,
    box: [-2.3, -5, 2.3, 5],
    prefix: 'MCB',
  },
  r_mcb3: {
    type: 'r_mcb3',
    cat: 'protect',
    pins: [pin(-2, -4, '1'), pin(0, -4, '3'), pin(2, -4, '5'), pin(-2, 4, '2'), pin(0, 4, '4'), pin(2, 4, '6')],
    poles: POLES3,
    operate: 'toggle',
    defaultOn: true,
    box: [-3.3, -5, 3.3, 5],
    prefix: 'MCB',
  },
  r_mc: {
    type: 'r_mc',
    cat: 'relay',
    pins: [
      pin(-2, -6, 'A1'),
      pin(2, 6, 'A2'),
      pin(-3, -4, '1/L1'),
      pin(-1, -4, '3/L2'),
      pin(1, -4, '5/L3'),
      pin(3, -4, '13NO'),
      pin(5, -4, '21NC'),
      pin(-3, 4, '2/T1'),
      pin(-1, 4, '4/T2'),
      pin(1, 4, '6/T3'),
      pin(3, 4, '14NO'),
      pin(5, 4, '22NC'),
    ],
    poles: [
      [2, 7],
      [3, 8],
      [4, 9],
      [5, 10],
      [6, 11],
    ],
    polesNc: [false, false, false, false, true],
    selfCoil: [0, 1],
    load: true,
    box: [-4.3, -6.8, 6.3, 6.8],
    prefix: 'MC',
  },
  r_thr: {
    type: 'r_thr',
    cat: 'protect',
    pins: [pin(-2, -3, '1/L1'), pin(0, -3, '3/L2'), pin(2, -3, '5/L3'), pin(-2, 3, '2/T1'), pin(0, 3, '4/T2'), pin(2, 3, '6/T3'), pin(4, -3, '95'), pin(4, 3, '96'), pin(6, -3, '97'), pin(6, 3, '98')],
    poles: [
      [0, 3],
      [1, 4],
      [2, 5],
      [6, 7],
      [8, 9],
    ],
    polesNc: [true, true, true, true, false],
    operate: 'toggle',
    box: [-3.3, -3.8, 7.3, 3.8],
    prefix: 'THR',
  },
  r_pb: {
    type: 'r_pb',
    cat: 'switch',
    pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')],
    poles: [
      [0, 1],
      [2, 3],
    ],
    polesNc: [true, false],
    operate: 'momentary',
    box: [-2.2, -4, 2.2, 3],
    prefix: 'PB',
  },
  r_lamp: { type: 'r_lamp', cat: 'output', pins: [pin(-1, 1, 'X1'), pin(1, 1, 'X2')], load: true, box: [-1.8, -2.8, 1.8, 1.8], prefix: 'PL' },
  r_motor3: { type: 'r_motor3', cat: 'output', pins: [pin(-2, -3, 'U'), pin(0, -3, 'V'), pin(2, -3, 'W'), pin(4, 1, 'PE')], load: true, box: [-6.5, -3.8, 5, 4.8], prefix: 'M' },
  // 8핀 소켓 (PTF08A 꼴): 위 1 2 3 4, 아래 8 7 6 5
  r_relay8: { type: 'r_relay8', cat: 'relay', pins: OCTAL, poles: OCTAL_POLES, polesNc: [false, true, false, true], selfCoil: [1, 6], load: true, box: [-4.3, -4.5, 4.3, 4.5], prefix: 'X' },
  r_timer8: { type: 'r_timer8', cat: 'relay', pins: OCTAL, poles: OCTAL_POLES, polesNc: [false, true, false, true], selfCoil: [1, 6], load: true, box: [-4.3, -4.5, 4.3, 4.5], prefix: 'T' },
  // 현장 기기 (실물)
  r_fuse: { type: 'r_fuse', cat: 'protect', pins: [pin(0, -3, '1'), pin(0, 3, '2')], poles: [[0, 1]], box: [-1.3, -4, 1.3, 4], prefix: 'F' },
  r_smps: { type: 'r_smps', cat: 'power', pins: [pin(-4, 4, 'L'), pin(-2, 4, 'N'), pin(4, 4, '+V'), pin(2, 4, '-V'), pin(0, 4, 'FG')], box: [-5.2, -4, 5.2, 5.2], prefix: 'PS' },
  r_prox: { type: 'r_prox', cat: 'switch', pins: [pin(-2, 3, 'BN'), pin(0, 3, 'BK'), pin(2, 3, 'BU')], operate: 'toggle', box: [-3, -4.2, 3, 3.6], prefix: 'PX' },
  // 2선식: 갈색 · 파랑 두 선이 접점처럼 (엔진이 직접 접점을 만든다: NO/NC 는 Part.ncOut, 직류 극성은 Part.ac 가 없을 때)
  r_prox2: { type: 'r_prox2', cat: 'switch', pins: [pin(-1, 3, 'BN'), pin(1, 3, 'BU')], operate: 'toggle', box: [-3, -4.2, 3, 3.6], prefix: 'PX' },
  r_ls: {
    type: 'r_ls',
    cat: 'switch',
    pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')],
    poles: PB_POLES,
    polesNc: [true, false],
    operate: 'momentary',
    box: [-2.2, -4.4, 2.8, 3],
    prefix: 'LS',
  },
  r_buzzer: { type: 'r_buzzer', cat: 'output', pins: [pin(-1, 1, 'X1'), pin(1, 1, 'X2')], load: true, box: [-1.8, -2.8, 1.8, 1.8], prefix: 'BZ' },
  // 솔레노이드 밸브 (5포트 공압 밸브 + 코일). 단자 이름은 partPins 가 결선 방식에 따라 (리드선 + · - / DIN 1 · 2 · 접지)
  // 인버터 (VFD, 미쓰비시 FR 꼴 단자 이름): 위 전원 R/L1 · S/L2 · T/L3 · 접지 PE · 고장 릴레이 A · B · C (C 공통, A 는 고장 때 닫힘),
  // 아래 출력 U · V · W 와 무전압 입력 STF (정회전) · STR (역회전) · RH · RM · RL (다단속) · SD (공통). 단자 번호는 기종마다 다르니 기능 이름으로
  r_vfd: {
    type: 'r_vfd',
    cat: 'output',
    pins: [
      pin(-8, -6, 'R/L1'),
      pin(-6, -6, 'S/L2'),
      pin(-4, -6, 'T/L3'),
      pin(-2, -6, 'PE'),
      pin(4, -6, 'A'),
      pin(6, -6, 'B'),
      pin(8, -6, 'C'),
      pin(-8, 6, 'U'),
      pin(-6, 6, 'V'),
      pin(-4, 6, 'W'),
      pin(0, 6, 'STF'),
      pin(2, 6, 'STR'),
      pin(4, 6, 'RH'),
      pin(6, 6, 'RM'),
      pin(8, 6, 'RL'),
      pin(10, 6, 'SD'),
    ],
    poles: [
      [6, 4],
      [6, 5],
    ],
    polesNc: [false, true],
    operate: 'toggle',
    box: [-9.6, -7, 11.4, 7],
    prefix: 'INV',
  },
  // 임펄스 릴레이 (래칭 · 텔레럽터, DIN 레일 모듈): 위 A1 · 13 · 21, 아래 A2 · 14 · 22. 코일 펄스마다 13-14 a · 21-22 b 가 바뀌고 전원이 없어도 유지
  r_imp: {
    type: 'r_imp',
    cat: 'relay',
    pins: [pin(-2, -3, 'A1'), pin(0, -3, '13'), pin(2, -3, '21'), pin(-2, 3, 'A2'), pin(0, 3, '14'), pin(2, 3, '22')],
    poles: [
      [1, 4],
      [2, 5],
    ],
    polesNc: [false, true],
    selfCoil: [0, 3],
    load: true,
    box: [-3, -4, 3, 4],
    prefix: 'LR',
  },
  // 스파크 킬러 (CR 서지 흡수기, 오카야 CRE 꼴): 몸통 아래 리드선 1 · 2 를 코일 양단에
  r_sk: { type: 'r_sk', cat: 'protect', pins: [pin(-1, 2, '1'), pin(1, 2, '2')], box: [-1.8, -1.8, 1.8, 2.4], prefix: 'SK' },
  // 다이오드 (리드선 K · A, 1N4007 꼴): 직류 코일 양단에 K (띠) 를 + 쪽으로
  r_diode: { type: 'r_diode', cat: 'protect', pins: [pin(-1, 2, 'K'), pin(1, 2, 'A')], box: [-1.8, -1.8, 1.8, 2.4], prefix: 'D' },
  // 플로트리스 릴레이 (61F 꼴): 위 전극 E1 (상한) · E2 (하한) · E3 (공통, 접지), 아래 전원 S1 · S2 와 출력 Tc → Ta (a) · Tb (b).
  // E1-E3 이 물로 통하면 켜지고, E2-E3 이 통하는 동안 유지 (E2 아래로 내려가면 꺼짐). 급수는 Tb, 배수는 Ta 로 펌프를 돌린다
  r_flr: {
    type: 'r_flr',
    cat: 'relay',
    pins: [pin(-4, 5, 'S1'), pin(-2, 5, 'S2'), pin(-2, -5, 'E1'), pin(0, -5, 'E2'), pin(2, -5, 'E3'), pin(0, 5, 'Tc'), pin(2, 5, 'Ta'), pin(4, 5, 'Tb')],
    poles: [
      [5, 6],
      [5, 7],
    ],
    polesNc: [false, true],
    load: true,
    loadPins: [0, 1],
    box: [-5, -6, 5, 6],
    prefix: 'FLR',
  },
  // 수조 (물탱크) + 전극봉 홀더: 위 단자 E1 · E2 · E3. 물에 잠긴 전극끼리 통한다 (엔진이 수위로 정함)
  r_tank: { type: 'r_tank', cat: 'switch', pins: [pin(-2, -7, 'E1'), pin(0, -7, 'E2'), pin(2, -7, 'E3')], box: [-6, -8, 6, 7], prefix: 'TANK' },
  r_sol: { type: 'r_sol', cat: 'output', pins: [pin(-1, 2, '1'), pin(1, 2, '2')], load: true, box: [-2.9, -3.4, 2.9, 2.9], prefix: 'SOL' },
  r_fan: { type: 'r_fan', cat: 'output', pins: [pin(-1, 3, 'L'), pin(1, 3, 'N')], load: true, box: [-3, -3, 3, 3.8], prefix: 'FAN' },
  r_pbl: {
    type: 'r_pbl',
    cat: 'switch',
    pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24'), pin(-1, 4, 'X1'), pin(1, 4, 'X2')],
    poles: PB_POLES,
    polesNc: [true, false],
    operate: 'momentary',
    load: true,
    loadPins: [4, 5],
    box: [-2.2, -4, 2.2, 5],
    prefix: 'PBL',
  },
  r_nbar: { type: 'r_nbar', cat: 'misc', pins: Array.from({ length: 6 }, (_, k) => pin(2 * k, 0, String(k + 1))), poles: Array.from({ length: 5 }, (_, k) => [k, k + 1] as [number, number]), box: [-1.2, -1.4, 11.2, 1.4], prefix: 'NB' },
  r_vm: { type: 'r_vm', cat: 'output', pins: [pin(-1, 3, 'V1'), pin(1, 3, 'V2')], box: [-2.6, -2.6, 2.6, 3.8], prefix: 'V' },
  r_am: { type: 'r_am', cat: 'output', pins: [pin(-1, 3, '1'), pin(1, 3, '2')], poles: [[0, 1]], box: [-2.6, -2.6, 2.6, 3.8], prefix: 'A' },
  r_fsw: { type: 'r_fsw', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'momentary', box: [-3.4, -3.6, 3.4, 3], prefix: 'FS' },
  r_float: { type: 'r_float', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'toggle', box: [-2.4, -5, 2.4, 3], prefix: 'FLS' },
  r_psw: { type: 'r_psw', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'toggle', box: [-2.6, -5, 2.6, 3], prefix: 'PSW' },
  r_outlet: { type: 'r_outlet', cat: 'output', pins: [pin(-2, 2, 'L'), pin(2, 2, 'N'), pin(0, 2, 'PE')], box: [-3, -3, 3, 3], prefix: 'CON' },
  r_motor6: { type: 'r_motor6', cat: 'output', pins: [pin(-2, -4, 'U1'), pin(0, -4, 'V1'), pin(2, -4, 'W1'), pin(-2, 4, 'W2'), pin(0, 4, 'U2'), pin(2, 4, 'V2'), pin(5, 0, 'PE')], load: true, box: [-6.5, -5, 6, 5], prefix: 'M' },
  r_duct: { type: 'r_duct', cat: 'misc', pins: [], box: [0, 0, 16, 2], prefix: '' },
  r_rail: { type: 'r_rail', cat: 'misc', pins: [], box: [0, -0.7, 16, 0.7], prefix: '' },
  r_my2: { type: 'r_my2', cat: 'relay', pins: MY2, poles: myPoles('r_my2'), polesNc: [false, true, false, true], selfCoil: [MY2.length - 2, MY2.length - 1], load: true, box: [-3.4, -6.4, 2.4, 6.4], prefix: 'X' },
  r_my4: { type: 'r_my4', cat: 'relay', pins: MY4, poles: myPoles('r_my4'), polesNc: [false, true, false, true, false, true, false, true], selfCoil: [MY4.length - 2, MY4.length - 1], load: true, box: [-5.4, -6.4, 4.4, 6.4], prefix: 'X' },
  r_ss: { type: 'r_ss', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'toggle', box: [-2.2, -4, 2.2, 3], prefix: 'SS' },
  // 3단 셀렉터: 왼쪽에서 13-14, 오른쪽에서 23-24 가 닫힌다 (가운데는 둘 다 열림)
  r_ss3: { type: 'r_ss3', cat: 'switch', pins: [pin(-1, 0, '13'), pin(1, 0, '14'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [false, false], operate: 'toggle', box: [-2.2, -4, 2.2, 3], prefix: 'SS' },
  // 프리셋 카운터: 위 무전압 입력 CP · COM · RST (공통이 가운데), 아래 전원 A1 · A2 와 출력 C → NO · NC
  r_counter: {
    type: 'r_counter',
    cat: 'relay',
    pins: [pin(-4, 5, 'A1'), pin(-2, 5, 'A2'), pin(-2, -5, 'CP'), pin(2, -5, 'RST'), pin(0, -5, 'COM'), pin(0, 5, 'C'), pin(2, 5, 'NO'), pin(4, 5, 'NC')],
    poles: [
      [5, 6],
      [5, 7],
    ],
    polesNc: [false, true],
    load: true,
    loadPins: [0, 1],
    box: [-5, -6, 5, 6],
    prefix: 'C',
  },
  // 온도 조절기 (48×48): 아래 단자 A1 · A2 (전원), C1-OUT (제어 출력 a접점), C2-AL (경보 출력 a접점). 센서 (열전대 · 측온저항체) 는 그림만
  r_tc: {
    type: 'r_tc',
    cat: 'relay',
    pins: [pin(-5, 5, 'A1'), pin(-3, 5, 'A2'), pin(-1, 5, 'C1'), pin(1, 5, 'OUT'), pin(3, 5, 'C2'), pin(5, 5, 'AL')],
    poles: [
      [2, 3],
      [4, 5],
    ],
    polesNc: [false, false],
    load: true,
    loadPins: [0, 1],
    box: [-6, -5.4, 6, 6],
    prefix: 'TC',
  },
  // 온도 조절기 8핀 (T3S 꼴, 48×48 썸휠 설정): 위 측온저항체 입력 A · B · B', 아래 전원 L · N 과 릴레이 출력 COM → NO · NC.
  // 단자 번호는 기종마다 달라 기능 이름으로 적는다 (실물은 옆면 결선도)
  r_tc8: {
    type: 'r_tc8',
    cat: 'relay',
    pins: [pin(-4, 6, 'L'), pin(-2, 6, 'N'), pin(0, 6, 'COM'), pin(2, 6, 'NO'), pin(4, 6, 'NC'), pin(-2, -6, 'A'), pin(0, -6, 'B'), pin(2, -6, "B'")],
    poles: [
      [2, 3],
      [2, 4],
    ],
    polesNc: [false, true],
    load: true,
    loadPins: [0, 1],
    box: [-6, -6.6, 6, 6.6],
    prefix: 'TC',
  },
  // 측온저항체 Pt100 3선식 (보호관 · 나사 고정 · 편조 케이블): 리드선 A (한 가닥) · B · B' (같은 색 두 가닥)
  r_rtd: { type: 'r_rtd', cat: 'switch', pins: [pin(-2, 4, 'A'), pin(0, 4, 'B'), pin(2, 4, "B'")], box: [-3, -7, 3, 4.6], prefix: 'RTD' },
  // 측온저항체 Pt100 더블: 한 보호관에 소자 두 개, 소자마다 A · B · B' (1 · 2 소자는 리드선 색이 다르다)
  r_rtd2: {
    type: 'r_rtd2',
    cat: 'switch',
    pins: [pin(-5, 4, 'A1'), pin(-3, 4, 'B1'), pin(-1, 4, "B1'"), pin(1, 4, 'A2'), pin(3, 4, 'B2'), pin(5, 4, "B2'")],
    box: [-6, -7, 6, 4.6],
    prefix: 'RTD',
  },
  // PID 온도 조절기 (TK4S 꼴, 48×48 나사 단자 · 소켓 없음): 아래 전원 L · N, 제어 출력 C1-OUT1 (릴레이 a), 경보 C2-AL1 (릴레이 a).
  // 위 RS485 (+ · −, 시뮬레이션은 안 함), 센서 A · B · B' = 단자 10 · 11 · 12 (오토닉스 FAQ). 나머지 단자 번호는 기능 이름으로 적는다
  r_tk4: {
    type: 'r_tk4',
    cat: 'relay',
    pins: [pin(-5, 6, 'L'), pin(-3, 6, 'N'), pin(-1, 6, 'C1'), pin(1, 6, 'OUT1'), pin(3, 6, 'C2'), pin(5, 6, 'AL1'), pin(-5, -6, '485+'), pin(-3, -6, '485-'), pin(1, -6, 'A'), pin(3, -6, 'B'), pin(5, -6, "B'")],
    poles: [
      [2, 3],
      [4, 5],
    ],
    polesNc: [false, false],
    load: true,
    loadPins: [0, 1],
    box: [-6.6, -6.6, 6.6, 6.6],
    prefix: 'TC',
  },
  // 판넬 서모스탯 (바이메탈): 아래 단자 1 · 2. NC 는 온도가 오르면 열리고 (히터), NO 는 닫힌다 (팬)
  r_thermo: { type: 'r_thermo', cat: 'switch', pins: [pin(-1, 3, '1'), pin(1, 3, '2')], poles: [[0, 1]], box: [-2.4, -4, 2.4, 3.6], prefix: 'TS' },
  // SSR: 위 1 · 2 출력 (교류 부하), 아래 3 (+) · 4 (-) 입력 (직류)
  r_ssr: { type: 'r_ssr', cat: 'relay', pins: [pin(-1, -3, '1'), pin(1, -3, '2'), pin(-1, 3, '3+'), pin(1, 3, '4-')], poles: [[0, 1]], selfCoil: [2, 3], load: true, box: [-2.6, -4.2, 2.6, 4.2], prefix: 'SSR' },
  r_estop: { type: 'r_estop', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'toggle', box: [-2.6, -4.4, 2.6, 3], prefix: 'EMS' },
  // 단자대: 극마다 위·아래 나사 (극수는 부품마다, partPins 참고)
  r_tb: { type: 'r_tb', cat: 'misc', pins: [], box: [-1.2, -2.6, 11.2, 2.6], prefix: 'TB' },
  // 24시간 타임 스위치: 아래 단자 L · N (시계 전원), COM · NO · NC (접점)
  r_tsw: {
    type: 'r_tsw',
    cat: 'relay',
    pins: [pin(-4, 5, 'L'), pin(-2, 5, 'N'), pin(0, 5, 'COM'), pin(2, 5, 'NO'), pin(4, 5, 'NC')],
    poles: [
      [2, 3],
      [2, 4],
    ],
    polesNc: [false, true],
    box: [-4.8, -5.8, 4.8, 5.8],
    prefix: 'TS',
  },
  r_light: { type: 'r_light', cat: 'output', pins: [pin(-1, 2, 'L'), pin(1, 2, 'N')], load: true, box: [-2.2, -3.6, 2.2, 2.8], prefix: 'EL' },
  r_sw: { type: 'r_sw', cat: 'switch', pins: [pin(-1, 2, '1'), pin(1, 2, '2')], poles: [[0, 1]], operate: 'toggle', box: [-2, -2.6, 2, 2.8], prefix: 'S' },
  // 부하 (용량으로 전류를 계산): 단상 L · N, 3상 L1 · L2 · L3
  r_load1: { type: 'r_load1', cat: 'output', pins: [pin(-1, -3, 'L'), pin(1, -3, 'N')], load: true, box: [-3.2, -3.8, 3.2, 3], prefix: 'LD' },
  r_load3: { type: 'r_load3', cat: 'output', pins: [pin(-2, -3, 'L1'), pin(0, -3, 'L2'), pin(2, -3, 'L3')], load: true, box: [-3.6, -3.8, 4, 3], prefix: 'LD' },
  // 수전 · 변압기 (계통 해석): 한전 수전점 (특고압 A B C), 진공차단기, 3상 변압기 (Δ-Y, 2차 X0 = N)
  r_kepco: { type: 'r_kepco', cat: 'power', pins: [pin(-2, 3, 'A'), pin(0, 3, 'B'), pin(2, 3, 'C')], box: [-3.6, -4.2, 3.6, 3], prefix: 'UT' },
  r_vcb: {
    type: 'r_vcb',
    cat: 'protect',
    pins: [pin(-2, -4, '1'), pin(0, -4, '3'), pin(2, -4, '5'), pin(-2, 4, '2'), pin(0, 4, '4'), pin(2, 4, '6')],
    poles: [
      [0, 3],
      [1, 4],
      [2, 5],
    ],
    operate: 'toggle',
    defaultOn: true,
    box: [-3.6, -5, 3.6, 5],
    prefix: 'VCB',
  },
  r_tr3: { type: 'r_tr3', cat: 'power', pins: [pin(-2, -5, 'H1'), pin(0, -5, 'H2'), pin(2, -5, 'H3'), pin(-3, 5, 'X1'), pin(-1, 5, 'X2'), pin(1, 5, 'X3'), pin(3, 5, 'X0')], box: [-4.6, -6, 4.6, 6], prefix: 'TR' },
  // 차단기 4P: 1 3 5 N → 2 4 6 N
  r_mcb4: {
    type: 'r_mcb4',
    cat: 'protect',
    pins: [pin(-3, -4, '1'), pin(-1, -4, '3'), pin(1, -4, '5'), pin(3, -4, 'N'), pin(-3, 4, '2'), pin(-1, 4, '4'), pin(1, 4, '6'), pin(3, 4, 'N')],
    poles: [
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ],
    operate: 'toggle',
    defaultOn: true,
    box: [-4.3, -5, 4.3, 5],
    prefix: 'MCB',
  },
  // 부스바: 막대마다 위 끝에 단자 하나 (단자 목록은 busPins), 막대는 선처럼 이어진다 (partWires)
  r_bus: { type: 'r_bus', cat: 'misc', pins: [], box: [-0.6, -0.9, 6.6, 22.4], prefix: 'BUS' },
  // 분전반 · 변전함 테두리 (왼쪽 위가 기준점, 크기는 부품마다)
  r_panel: { type: 'r_panel', cat: 'misc', pins: [], box: [0, 0, 20, 20], prefix: 'PNL' },
  r_sw3: {
    type: 'r_sw3',
    cat: 'switch',
    pins: [pin(0, -3, '0'), pin(-1, 2, '1'), pin(1, 2, '3')],
    poles: [
      [0, 1],
      [0, 2],
    ],
    polesNc: [true, false],
    operate: 'toggle',
    box: [-2, -3.8, 2, 2.8],
    prefix: 'S',
  },
  text: { type: 'text', cat: 'misc', pins: [], box: [0, -0.8, 4, 0.4], prefix: '' },
};

/** 실물 배선도 기기 */
export const REAL: ReadonlySet<PartType> = new Set(['r_term', 'r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mc', 'r_thr', 'r_pb', 'r_lamp', 'r_motor3', 'r_relay8', 'r_timer8', 'r_my2', 'r_my4', 'r_fuse', 'r_smps', 'r_prox', 'r_ls', 'r_buzzer', 'r_sol', 'r_fan', 'r_pbl', 'r_nbar', 'r_vm', 'r_am', 'r_duct', 'r_rail', 'r_fsw', 'r_float', 'r_psw', 'r_outlet', 'r_motor6', 'r_ss', 'r_estop', 'r_tb', 'r_tsw', 'r_light', 'r_sw', 'r_sw3', 'r_load1', 'r_load3', 'r_panel', 'r_mcb4', 'r_bus', 'r_kepco', 'r_vcb', 'r_tr3', 'r_ss3', 'r_counter', 'r_ssr', 'r_prox2', 'r_tc', 'r_thermo', 'r_plc', 'r_hmi', 'r_tc8', 'r_rtd', 'r_rtd2', 'r_tk4', 'r_sk', 'r_imp', 'r_vfd', 'r_diode', 'r_flr', 'r_tank']);

/** 부스바: 막대 수, 길이 (칸) */
export function busSize(p: Part): { bars: number; len: number } {
  return { bars: p.bars === 3 ? 3 : 4, len: Math.min(400, Math.max(2, Math.round(p.h ?? 20))) };
}

export const BUS_PHASES = ['L1', 'L2', 'L3', 'N'];
const BUS_COLORS: WireColor[] = ['brown', 'black', 'grey', 'blue'];

/** 부스바 막대 1 m 의 길이로 보는 칸 수 (판넬 안 배치: 1칸 = 5 cm) */
export const BUS_CELL_M = 0.05;

/**
 * 부품 안에서 선처럼 동작하는 도체: 부스바 막대. 선 끝이나 단자가 막대 중간에 닿으면 T 분기로 이어지고,
 * 다른 선이 그냥 지나가면 이어지지 않는다 (판넬의 분기 부스바가 주 부스바 위로 지나가는 것처럼).
 * 넷 · 전기 해석 · 결선표가 그린 선과 똑같이 다룬다. 선 번호는 `${부품}~bar${k}`.
 */
export function partWires(p: Part): Wire[] {
  if (p.type !== 'r_bus') return [];
  const { bars, len } = busSize(p);
  const spec: CableSpec = { kind: 'bus', ins: 'xlpe', mm2: p.mm2 ?? 100, method: 'C', cores: 3, len: Math.round(len * BUS_CELL_M * 100) / 100, ...(p.amps ? { iz: p.amps } : {}) };
  const at = (x: number, y: number): [number, number] => {
    const [dx, dy] = rotate(x, y, p.rot);
    return [p.x + dx, p.y + dy];
  };
  // 막대 간격 2칸: 4P 차단기 단자 (2칸 간격) 와 곧게 이어진다
  return Array.from({ length: bars }, (_, k) => ({ id: `${p.id}~bar${k}`, a: at(2 * k, 0), b: at(2 * k, len), color: BUS_COLORS[k], cable: spec }));
}

/** 그린 선 + 부품 안의 도체 (부스바 막대) */
export function circuitWires(c: Pick<Circuit, 'parts' | 'wires'>): Wire[] {
  const extra = c.parts.flatMap(partWires);
  return extra.length ? [...c.wires, ...extra] : c.wires;
}

/** 선 번호가 부스바 막대인가 */
export function isPartWire(id: string): boolean {
  return id.includes('~bar');
}

/** 분전반 테두리의 크기 (격자 칸) */
export function panelSize(p: Part): [number, number] {
  return [Math.max(4, p.w ?? 20), Math.max(4, p.h ?? 20)];
}

/** 타임 스위치: 기본 설정 (18:00 켜짐 ~ 23:00 꺼짐) */
export const DEFAULT_SCHED: [number, number][] = [[18 * 3600000, 23 * 3600000]];

const DAY_MS = 86400000;

/** 타임 스위치가 그 시각(하루 안의 ms)에 켜져 있는가. 꺼짐이 켜짐보다 이르면 자정을 넘기는 구간 */
export function schedOn(sched: [number, number][], dial: number): boolean {
  const e = 1e-6;
  return sched.some(([a, b]) => (a < b ? dial >= a - e && dial < b - e : a > b ? dial >= a - e || dial < b - e : false));
}

/** 타임 스위치의 설정 (없으면 기본) */
export function tswSched(p: Part): [number, number][] {
  return (p.sched ?? DEFAULT_SCHED).map(([a, b]) => [((a % DAY_MS) + DAY_MS) % DAY_MS, ((b % DAY_MS) + DAY_MS) % DAY_MS] as [number, number]);
}

/** 단자대 극수 */
/** 덕트 · DIN 레일의 크기 (칸): 덕트는 가로 × 세로, 레일은 길이 */
export function stripSize(p: Part): [number, number] {
  return p.type === 'r_rail' ? [Math.max(2, p.w ?? 16), 1.4] : [Math.max(1, p.w ?? 16), Math.max(1, p.h ?? 2)];
}

/** 선으로 이은 것과 같은 기기: 단자대 · 퓨즈 · 바 · 전류계는 늘 통한다 */
export const ALWAYS_ON: ReadonlySet<PartType> = new Set(['fuse', 'fuse3', 'r_tb', 'r_fuse', 'r_nbar', 'r_am']);
export const PROX_TYPES: ReadonlySet<PartType> = new Set(['prox', 'r_prox']);
export const SMPS_TYPES: ReadonlySet<PartType> = new Set(['smps', 'r_smps']);
export const SOL_TYPES: ReadonlySet<PartType> = new Set(['sol', 'r_sol']);

/** 솔레노이드 밸브 코일이 교류인가 (사양에 AC 가 적혀 있으면). 비우면 DC 24V */
export function solAc(p: Pick<Part, 'spec'>): boolean {
  return /\bAC\b/i.test(p.spec ?? '');
}

/** 3단 셀렉터의 세 자리 이름 (왼쪽 · 가운데 · 오른쪽) */
export function pos3Labels(p: Pick<Part, 'pos3'>): [string, string, string] {
  const d: [string, string, string] = [tr('수동', 'MAN'), tr('정지', 'OFF'), tr('자동', 'AUTO')];
  const got = (p.pos3 ?? '').split('/').map((x) => x.trim());
  return [got[0] || d[0], got[1] || d[1], got[2] || d[2]];
}

/** 조작 순서의 동작 이름 (3단 셀렉터는 자리 이름) */
export function opActionLabel(action: 'press' | 'on' | 'off' | 'left' | 'right' | 'temp' | 'leak' | 'level', part?: Part, op?: { value?: number; hold?: number }): string {
  if (action === 'temp') return `${tr('온도', 'Temp.')} → ${op?.value ?? 0}℃${op?.hold ? ` (${formatTime(op.hold, 's')})` : ''}`;
  if (action === 'level') return `${tr('수위', 'Level')} → ${op?.value ?? 0}%${op?.hold ? ` (${formatTime(op.hold, 's')})` : ''}`;
  if (action === 'leak') {
    const rf = op?.value ?? 0;
    const ins = rf > 0 ? `${tr('절연', 'insulation')} ${rf >= 1000 ? `${rf / 1000} kΩ` : `${rf} Ω`}` : tr('완전 지락', 'solid fault');
    return `${tr('누전', 'Earth fault')} (${ins})${op?.hold ? ` ${formatTime(op.hold, 's')}` : ''}`;
  }
  if (part?.type === 'r_ss3') {
    const [l, m, r] = pos3Labels(part);
    return action === 'left' ? `← ${l}` : action === 'right' || action === 'on' ? `${r} →` : m;
  }
  return action === 'press' ? tr('누름 → 뗌', 'Press') : action === 'on' ? 'ON' : action === 'off' ? 'OFF' : action === 'left' ? tr('왼쪽', 'Left') : tr('오른쪽', 'Right');
}

/** 인버터 설정: 주파수 (Hz) 와 가속 · 감속 기울기 (Hz/ms, 0 ↔ 60 Hz 를 acc · dec 초에) */
export function vfdSetting(p: Pick<Part, 'hz' | 'hzH' | 'hzM' | 'hzL' | 'acc' | 'dec'>): { hz: number; hzH: number; hzM: number; hzL: number; acc: number; dec: number; up: number; down: number } {
  const f = (v: number | undefined, d: number) => (typeof v === 'number' && v >= 0 && v <= 400 ? v : d);
  const acc = typeof p.acc === 'number' && p.acc >= 0.1 ? p.acc : 5;
  const dec = typeof p.dec === 'number' && p.dec >= 0.1 ? p.dec : 5;
  return { hz: f(p.hz, 60), hzH: f(p.hzH, 60), hzM: f(p.hzM, 30), hzL: f(p.hzL, 10), acc, dec, up: 60 / (acc * 1000), down: 60 / (dec * 1000) };
}

/** 수조 설정: 처음 수위, 전극봉 높이 E1 · E2 · E3 (%), 급수 · 배수 · 사용 속도 (%/s) */
export function tankSetting(p: Pick<Part, 'lv0' | 'e1' | 'e2' | 'e3' | 'fillRate' | 'drainRate' | 'useRate'>): { lv0: number; e: [number, number, number]; fill: number; drain: number; use: number } {
  const pct = (v: number | undefined, d: number) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : d);
  return { lv0: pct(p.lv0, 50), e: [pct(p.e1, 80), pct(p.e2, 40), pct(p.e3, 10)], fill: pct(p.fillRate, 5), drain: pct(p.drainRate, 5), use: pct(p.useRate, 0) };
}

/** 스파크 킬러 값 (없으면 0.1 µF + 120 Ω) */
export function skValues(p: Pick<Part, 'uf' | 'ohm'>): { uf: number; ohm: number } {
  return { uf: p.uf && p.uf > 0 ? p.uf : 0.1, ohm: p.ohm && p.ohm > 0 ? p.ohm : 120 };
}

/** 스파크 킬러를 지나는 교류 전류 (mA): volts / √(R² + Xc²), Xc = 1 / (2π f C). 접점 양단에 달면 접점이 열려도 이만큼 샌다 */
export function skLeakMa(p: Pick<Part, 'uf' | 'ohm'>, volts: number, hz = 60): number {
  const { uf, ohm } = skValues(p);
  const xc = 1e6 / (2 * Math.PI * hz * uf);
  return (volts / Math.hypot(ohm, xc)) * 1000;
}

/** 온도 조절기 (전원이 있어야 출력): 48×48 · 8핀 (T3S 꼴) · PID (TK4S 꼴) */
export function isTempCtrl(p: Pick<Part, 'type'>): boolean {
  return p.type === 'r_tc' || p.type === 'r_tc8' || p.type === 'r_tk4';
}

/** 측온저항체 센서 단자 (A · B · B') 를 가진 조절기: 단자 차례 */
export function rtdInputPins(p: Pick<Part, 'type'>): [number, number, number] | null {
  return p.type === 'r_tc8' ? [5, 6, 7] : p.type === 'r_tk4' ? [8, 9, 10] : null;
}

/** 측온저항체의 소자마다 리드선 A · B · B' 단자 차례 (더블은 소자 두 개) */
export function rtdElements(p: Pick<Part, 'type'>): [number, number, number][] {
  return p.type === 'r_rtd'
    ? [[0, 1, 2]]
    : p.type === 'r_rtd2'
      ? [
          [0, 1, 2],
          [3, 4, 5],
        ]
      : [];
}

/** PID 조절기 (TK4S 꼴) 의 PID 값: 없으면 ON/OFF 동작 */
export function pidSetting(p: Pick<Part, 'type' | 'ctrl' | 'pb' | 'ti' | 'td' | 'cycle'>): { pb: number; ti: number; td: number; cycle: number } | null {
  if (p.type !== 'r_tk4' || p.ctrl === 'onoff') return null;
  const num = (v: number | undefined, d: number, min: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : d);
  return { pb: num(p.pb, 10, 0.1), ti: num(p.ti, 240, 0), td: num(p.td, 60, 0), cycle: num(p.cycle, 20, 0.5) };
}

/** 온도 기기인가: 온도 조절기 · 판넬 서모스탯 · 온도 스위치 기호 */
export function isTempDevice(p: Pick<Part, 'type' | 'sense'>): boolean {
  return isTempCtrl(p) || p.type === 'r_thermo' || ((p.type === 'ls_no' || p.type === 'ls_nc') && p.sense === 'temp');
}

/** 온도 기기의 설정 온도 · 히스테리시스 (℃) */
export function tempSetting(p: Pick<Part, 'sv' | 'hys' | 'type'>): { sv: number; hys: number } {
  const tc = isTempCtrl(p);
  return { sv: typeof p.sv === 'number' ? p.sv : tc ? 60 : 40, hys: Math.max(0.1, typeof p.hys === 'number' ? p.hys : tc ? 2 : 5) };
}

/** 카운터 설정 수 */
/** 타이머 설정 글: "3 s", 켜짐 · 꺼짐 시간이 다른 플리커 (트윈 타이머) 는 "ON 1 s · OFF 3 s" */
export function timerText(p: Pick<Part, 'preset' | 'presetOff' | 'timerMode'>, def = 3000): string {
  const on = p.preset ?? def;
  const off = p.timerMode === 'flicker' && p.presetOff && p.presetOff > 0 ? p.presetOff : on;
  return off === on ? formatTime(on, 's') : `ON ${formatTime(on, 's')} · OFF ${formatTime(off, 's')}`;
}

export function counterPreset(p: Pick<Part, 'count'>): number {
  return Math.max(1, Math.round(p.count ?? 5));
}

export function tbSize(p: Part): number {
  return Math.min(40, Math.max(1, Math.round(p.n ?? 6)));
}

/** 부품의 단자 (단자대는 극수만큼) */
export function partPins(p: Part): PinDef[] {
  if (p.type === 'r_plc') {
    const { ins, outs } = plcAddresses(p);
    return rplcPins(ins, outs);
  }
  // 부하 상자: 금속 외함이면 접지 단자 PE (끝에 붙여 예전 그림의 단자 차례는 그대로)
  if ((p.type === 'r_load1' || p.type === 'r_load3') && p.pe) return [...PARTS[p.type].pins, pin(p.type === 'r_load1' ? 2 : 3, -3, 'PE')];
  if (p.type === 'r_bus') return BUS_PHASES.slice(0, busSize(p).bars).map((ph, k) => pin(2 * k, 0, ph));
  // 8핀 소켓은 단자 배열에 따라 자리가 다르다 (차례는 늘 단자 번호 1~8)
  if (p.type === 'r_relay8' || p.type === 'r_timer8') return OCTAL_PINS[octalLayout(p)];
  if (p.type === 'r_nbar') return Array.from({ length: tbSize(p) }, (_, k) => pin(2 * k, 0, String(k + 1)));
  // 솔레노이드 밸브: 리드선이면 직류는 + · - (빨강 · 검정), DIN 커넥터면 1 · 2 와 접지
  if (p.type === 'r_sol') return p.conn === 'din' ? [pin(-1, 2, '1'), pin(1, 2, '2'), pin(0, 2, 'PE')] : solAc(p) ? [pin(-1, 2, '1'), pin(1, 2, '2')] : [pin(-1, 2, '+'), pin(1, 2, '-')];
  if (p.type !== 'r_tb') return PARTS[p.type].pins;
  const out: PinDef[] = [];
  for (let k = 0; k < tbSize(p); k++) out.push(pin(2 * k, -2, String(k + 1)), pin(2 * k, 2, String(k + 1)));
  return out;
}

/**
 * 8핀 소켓의 단자 배열을 바꾼다. 단자에 물려 있던 선 끝은 그 단자 번호를 따라 새 자리로 옮긴다
 * (자리를 그대로 두면 다른 번호 단자에 물린 것이 되어 회로가 바뀐다). 옮겨진 선은 비스듬해질 수 있다.
 */
export function setSocketLayout(c: Circuit, partId: string, layout: OctalLayout): Circuit {
  const part = c.parts.find((p) => p.id === partId);
  if (!part || (part.type !== 'r_relay8' && part.type !== 'r_timer8') || octalLayout(part) === layout) return c;
  const next: Part = { ...part };
  if (layout === 'seq') delete next.sock;
  else next.sock = layout;
  const from = pinPositions(part);
  const to = pinPositions(next);
  const move = (q: [number, number]): [number, number] => {
    const i = from.findIndex((f) => f[0] === q[0] && f[1] === q[1]);
    return i < 0 ? q : to[i];
  };
  return { ...c, parts: c.parts.map((p) => (p.id === partId ? next : p)), wires: c.wires.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })).filter((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]) };
}

/** 서로 이어지는 단자 쌍 */
export function partPoles(p: Part): [number, number][] | undefined {
  if (p.type === 'r_nbar') return Array.from({ length: tbSize(p) - 1 }, (_, k) => [k, k + 1] as [number, number]);
  if (p.type !== 'r_tb') return PARTS[p.type].poles;
  return Array.from({ length: tbSize(p) }, (_, k) => [2 * k, 2 * k + 1] as [number, number]);
}

export const PLC_IO = 8;

/** PLC 종류별 기본 첫 주소 */
export function plcBases(d: PlcDialect | undefined): { in: string; out: string } {
  switch (d) {
    case 'ls':
      return { in: 'P00000', out: 'P00040' };
    case 'siemens':
      return { in: 'I0.0', out: 'Q0.0' };
    case 'st':
      return { in: '%IX0.0', out: '%QX0.0' };
    default:
      return { in: 'X0', out: 'Y0' };
  }
}

/** 첫 주소에서 n 번째 주소: X0→X7(8진), P00040→P00047(16진 비트), I0.0→I0.7→I1.0, 그 밖은 끝 숫자 + n */
export function plcAddress(base: string, n: number): string {
  const b = base.trim();
  let m = /^(.*?)(\d+)\.(\d+)$/.exec(b);
  if (m) {
    const bit = Number(m[3]) + n;
    return `${m[1]}${Number(m[2]) + Math.floor(bit / 8)}.${bit % 8}`;
  }
  if ((m = /^([XY])([0-7]+)$/i.exec(b))) return m[1].toUpperCase() + (parseInt(m[2], 8) + n).toString(8);
  if ((m = /^(P|M|K|L)(\d{4})([0-9A-F])$/i.exec(b))) {
    const v = parseInt(m[2], 10) * 16 + parseInt(m[3], 16) + n;
    return `${m[1].toUpperCase()}${String(Math.floor(v / 16)).padStart(4, '0')}${(v % 16).toString(16).toUpperCase()}`;
  }
  if ((m = /^(.*?)(\d+)$/.exec(b))) return `${m[1]}${String(Number(m[2]) + n).padStart(m[2].length, '0')}`;
  return `${b}${n}`;
}

/** PLC 블록의 입력 · 출력 수 (기호 PLC 는 8 · 8, 실물 PLC 는 16 · 16) */
export function plcIo(p: Part): { nIn: number; nOut: number } {
  return p.type === 'r_plc' ? { nIn: RPLC.nIn, nOut: RPLC.nOut } : { nIn: PLC_IO, nOut: PLC_IO };
}

/** PLC 블록인가 (기호 · 실물) */
export const isPlcPart = (p: Part) => p.type === 'plc' || p.type === 'r_plc';

export function plcAddresses(p: Part): { ins: string[]; outs: string[] } {
  const { nIn, nOut } = plcIo(p);
  const ins = Array.from({ length: nIn }, (_, n) => plcAddress(p.inBase || 'X0', n));
  const outs = Array.from({ length: nOut }, (_, n) => plcAddress(p.outBase || 'Y0', n));
  return { ins, outs };
}

/** HMI 화면 칸의 자리 (기기 기준 격자, 회전 전): 3열 × 4줄 */
export const HMI_MAX = 12;
export function hmiCells(p: Part): { n: number; x: number; y: number; w: number; h: number }[] {
  return (p.hmi ?? []).slice(0, HMI_MAX).map((_, n) => ({ n, x: -8.2 + (n % 3) * 5.6, y: -5 + Math.floor(n / 3) * 2.45, w: 5.2, h: 2 }));
}

/** HMI 버튼 · 스위치의 조작 기호 (HMI1-3 = HMI1 의 셋째 칸) */
export const hmiTag = (p: Part, n: number) => `${p.tag.trim().toUpperCase() || 'HMI'}-${n + 1}`;

export const LAMP_PREFIX: Record<LampColor, string> = { red: 'RL', green: 'GL', yellow: 'YL', white: 'WL', blue: 'BL' };
export const LAMP_HEX: Record<LampColor, string> = { red: '#ef4444', green: '#22c55e', yellow: '#facc15', white: '#e5e7eb', blue: '#3b82f6' };

export function lampColorName(c: LampColor | undefined): string {
  switch (c ?? 'red') {
    case 'red':
      return tr('적색', 'red');
    case 'green':
      return tr('녹색', 'green');
    case 'yellow':
      return tr('황색', 'yellow');
    case 'white':
      return tr('백색', 'white');
    case 'blue':
      return tr('청색', 'blue');
  }
}

/** 품명 (부품 리스트·속성 창) */
export function partKindName(type: PartType): string {
  switch (type) {
    case 'src':
      return tr('전원 단자', 'Supply terminal');
    case 'src3':
      return tr('3상 전원', '3-phase supply');
    case 'fuse':
    case 'fuse3':
      return tr('퓨즈', 'Fuse');
    case 'mcb':
      return tr('배선용 차단기', 'Circuit breaker');
    case 'mcb3':
      return tr('배선용 차단기 (MCCB)', 'Circuit breaker (MCCB)');
    case 'ol3':
      return tr('열동형 과부하 계전기 (THR)', 'Thermal overload relay');
    case 'pb_no':
      return tr('푸시버튼 a접점', 'Push button NO');
    case 'pb_nc':
      return tr('푸시버튼 b접점', 'Push button NC');
    case 'sw_no':
      return tr('셀렉터 스위치 a접점', 'Selector switch NO');
    case 'sw_nc':
      return tr('셀렉터 스위치 b접점', 'Selector switch NC');
    case 'estop':
      return tr('비상정지 스위치', 'Emergency stop');
    case 'ls_no':
      return tr('리밋 스위치 a접점', 'Limit switch NO');
    case 'ls_nc':
      return tr('리밋 스위치 b접점', 'Limit switch NC');
    case 'no':
      return tr('a접점 (릴레이·타이머)', 'NO contact');
    case 'nc':
      return tr('b접점 (릴레이·타이머)', 'NC contact');
    case 'km3':
      return tr('전자접촉기 주접점 3P', 'Contactor main poles');
    case 'coil':
      return tr('코일 (릴레이·전자접촉기)', 'Coil (relay / contactor)');
    case 'timer':
      return tr('타이머', 'Timer');
    case 'lamp':
      return tr('파일럿 램프', 'Pilot lamp');
    case 'buzzer':
      return tr('부저', 'Buzzer');
    case 'motor3':
      return tr('3상 유도 전동기', '3-phase motor');
    case 'motor':
      return tr('전동기 (단상·직류)', 'Motor (1-ph / DC)');
    case 'sol':
      return tr('솔레노이드 밸브', 'Solenoid valve');
    case 'load':
      return tr('부하 (히터 · 팬 등)', 'Load (heater, fan …)');
    case 'cyl':
      return tr('공압 실린더', 'Pneumatic cylinder');
    case 'plc':
      return tr('PLC (입력 8 · 릴레이 출력 8)', 'PLC (8 in / 8 relay out)');
    case 'prox':
      return tr('3선식 센서 (근접 · 광전)', '3-wire sensor (proximity / photo)');
    case 'smps':
      return tr('SMPS (AC 220V → DC 24V)', 'Power supply (AC → DC 24V)');
    case 'air':
      return tr('공압원', 'Air supply');
    case 'frl':
      return tr('에어 서비스 유닛 (FRL)', 'Air service unit (FRL)');
    case 'fc':
      return tr('속도 제어 밸브', 'Flow control valve');
    case 'v32':
      return tr('3/2 밸브 (NC, 편솔)', '3/2 valve (NC, single solenoid)');
    case 'v52':
      return tr('5/2 밸브 (편솔)', '5/2 valve (single solenoid)');
    case 'v52d':
      return tr('5/2 밸브 (양솔)', '5/2 valve (double solenoid)');
    case 'v53':
      return tr('5/3 밸브 (올포트 블록)', '5/3 valve (closed centre)');
    case 'r_term':
      return tr('전원 단자', 'Supply terminal');
    case 'r_mcb1':
      return tr('차단기 1P', 'Circuit breaker 1P');
    case 'r_mcb2':
      return tr('차단기 2P', 'Circuit breaker 2P');
    case 'r_mcb3':
      return tr('차단기 3P', 'Circuit breaker 3P');
    case 'r_mc':
      return tr('전자접촉기 (코일 · 주접점 · 보조 1a1b)', 'Magnetic contactor');
    case 'r_thr':
      return tr('열동형 과부하 계전기 (THR)', 'Thermal overload relay');
    case 'r_pb':
      return tr('푸시버튼 (1a1b)', 'Push button (1 NO 1 NC)');
    case 'r_lamp':
      return tr('파일럿 램프', 'Pilot lamp');
    case 'r_motor3':
      return tr('3상 유도 전동기', '3-phase motor');
    case 'r_relay8':
      return tr('8핀 릴레이 (소켓)', '8-pin relay (socket)');
    case 'r_timer8':
      return tr('8핀 타이머 (소켓)', '8-pin timer (socket)');
    case 'r_my2':
      return tr('각형 릴레이 2c (소켓)', 'Blade relay 2-pole (socket)');
    case 'r_my4':
      return tr('각형 릴레이 4c (소켓)', 'Blade relay 4-pole (socket)');
    case 'r_fuse':
      return tr('퓨즈 홀더', 'Fuse holder');
    case 'r_sk':
    case 'sk':
      return tr('스파크 킬러 (CR 서지 흡수기)', 'Spark killer (RC snubber)');
    case 'r_imp':
    case 'imp':
      return tr('임펄스 릴레이 (래칭)', 'Impulse relay (latching)');
    case 'r_vfd':
      return tr('인버터 (VFD)', 'Inverter (VFD)');
    case 'r_diode':
    case 'diode':
      return tr('다이오드 (서지 흡수)', 'Diode (surge suppression)');
    case 'r_flr':
      return tr('플로트리스 릴레이 (전극식 수위)', 'Floatless level relay (electrodes)');
    case 'r_tank':
      return tr('수조 (전극봉)', 'Water tank (electrodes)');
    case 'r_smps':
      return tr('SMPS (DC 24V 전원)', 'SMPS (24 V DC supply)');
    case 'r_prox':
      return tr('근접 · 광전 센서 (3선식)', 'Proximity / photo sensor (3-wire)');
    case 'r_prox2':
      return tr('근접 센서 (2선식)', 'Proximity sensor (2-wire)');
    case 'r_ls':
      return tr('리밋 스위치 (1a1b)', 'Limit switch (1 NO 1 NC)');
    case 'r_buzzer':
      return tr('부저', 'Buzzer');
    case 'r_sol':
      return tr('솔레노이드 밸브 (코일)', 'Solenoid valve (coil)');
    case 'r_fan':
      return tr('판넬 팬', 'Panel fan');
    case 'r_pbl':
      return tr('조광형 푸시버튼 (1a1b + 램프)', 'Illuminated push button');
    case 'r_nbar':
      return tr('중성선 · 접지 바', 'Neutral / earth bar');
    case 'r_vm':
      return tr('전압계', 'Voltmeter');
    case 'r_am':
      return tr('전류계', 'Ammeter');
    case 'r_fsw':
      return tr('풋 스위치 (1a1b)', 'Foot switch (1 NO 1 NC)');
    case 'r_float':
      return tr('플로트 스위치 (1a1b)', 'Float switch (1 NO 1 NC)');
    case 'r_psw':
      return tr('압력 스위치 (1a1b)', 'Pressure switch (1 NO 1 NC)');
    case 'r_outlet':
      return tr('콘센트', 'Socket outlet');
    case 'r_motor6':
      return tr('3상 전동기 6단자 (Y-Δ)', '3-phase motor, 6 leads (Y-Δ)');
    case 'r_duct':
      return tr('배선 덕트', 'Wire duct');
    case 'r_rail':
      return tr('DIN 레일', 'DIN rail');
    case 'r_ss':
      return tr('셀렉터 스위치 (1a1b)', 'Selector switch (1 NO 1 NC)');
    case 'r_ss3':
      return tr('3단 셀렉터 스위치 (2a)', '3-position selector (2 NO)');
    case 'r_counter':
      return tr('프리셋 카운터', 'Preset counter');
    case 'r_tc':
      return tr('온도 조절기', 'Temperature controller');
    case 'r_tc8':
      return tr('온도 조절기 (8핀, 측온저항체)', 'Temperature controller (8-pin, RTD)');
    case 'r_rtd':
      return tr('측온저항체 Pt100 (3선식)', 'RTD Pt100 (3-wire)');
    case 'r_rtd2':
      return tr('측온저항체 Pt100 더블 (3선식 × 2)', 'RTD Pt100 duplex (2 × 3-wire)');
    case 'r_tk4':
      return tr('PID 온도 조절기 (TK4S 꼴)', 'PID temperature controller (TK4S type)');
    case 'r_thermo':
      return tr('판넬 서모스탯', 'Panel thermostat');
    case 'r_plc':
      return tr('PLC (입력 16 · 릴레이 출력 16)', 'PLC (16 in / 16 relay out)');
    case 'r_hmi':
      return tr('HMI (터치 판넬)', 'HMI (touch panel)');
    case 'r_ssr':
      return tr('SSR (무접점 릴레이)', 'Solid-state relay');
    case 'r_estop':
      return tr('비상정지 스위치 (1a1b)', 'Emergency stop (1 NO 1 NC)');
    case 'r_tb':
      return tr('단자대', 'Terminal block');
    case 'r_tsw':
      return tr('24시간 타임 스위치 (다이얼식)', '24-hour dial time switch');
    case 'r_light':
      return tr('전등', 'Light');
    case 'r_sw':
      return tr('스위치 (단로)', 'Switch (1-way)');
    case 'r_sw3':
      return tr('3로 스위치', '3-way switch');
    case 'r_load1':
      return tr('부하 (단상)', 'Load (1-phase)');
    case 'r_load3':
      return tr('부하 (3상)', 'Load (3-phase)');
    case 'r_panel':
      return tr('분전반 · 변전함', 'Panel / switchboard');
    case 'r_mcb4':
      return tr('배선용 차단기 4P', 'Circuit breaker 4P');
    case 'r_bus':
      return tr('부스바', 'Busbar');
    case 'r_kepco':
      return tr('한전 수전점', 'Utility supply');
    case 'r_vcb':
      return tr('진공차단기 (VCB)', 'Vacuum circuit breaker (VCB)');
    case 'r_tr3':
      return tr('변압기 (3상)', 'Transformer (3-phase)');
    case 'text':
      return tr('글자', 'Text');
  }
}

export interface PaletteItem {
  key: string;
  type: PartType;
  label: string;
  init?: Partial<Part>;
  /** 기호 앞글자 (없으면 부품 기본값) */
  prefix?: string;
}

export interface PaletteGroup {
  title: string;
  items: PaletteItem[];
  /** real = 실물 배선도 목록에만, symbol = 회로 기호 목록에만, 없으면 둘 다 */
  mode?: 'real' | 'symbol';
}

export function palette(): PaletteGroup[] {
  const it = (type: PartType, label: string, init?: Partial<Part>, key?: string, prefix?: string): PaletteItem => ({ key: key ?? type, type, label, init, prefix });
  return [
    {
      title: tr('전원 단자', 'Supply terminals'),
      mode: 'real',
      items: (['L1', 'L2', 'L3', 'N', 'PE', '+24V', '0V'] as Pole[]).map((pole) => it('r_term', pole, { pole }, `rt-${pole}`)),
    },
    {
      title: tr('보호 장치', 'Protection'),
      mode: 'real',
      items: [
        it('r_mcb4', tr('차단기 4P', 'Breaker 4P')),
        it('r_mcb3', tr('차단기 3P', 'Breaker 3P')),
        it('r_mcb2', tr('차단기 2P', 'Breaker 2P')),
        it('r_mcb1', tr('차단기 1P', 'Breaker 1P')),
        it('r_mcb4', tr('누전차단기 4P', 'ELB 4P'), { elb: true }, 'elb4', 'ELB'),
        it('r_mcb3', tr('누전차단기 3P', 'ELB 3P'), { elb: true }, 'elb3', 'ELB'),
        it('r_mcb2', tr('누전차단기 2P', 'ELB 2P'), { elb: true }, 'elb2', 'ELB'),
        it('r_fuse', tr('퓨즈 홀더', 'Fuse holder'), { amps: 10 }),
        it('r_sk', tr('스파크 킬러 (CR)', 'Spark killer (RC)')),
        it('r_diode', tr('다이오드 (직류 코일 서지)', 'Diode (DC coil surge)')),
        it('r_thr', tr('열동 계전기 THR', 'Overload THR')),
      ],
    },
    {
      title: tr('제어 기기 (접촉기 · 릴레이 · 타이머)', 'Control (contactor, relays, timers)'),
      mode: 'real',
      items: [
        it('r_mc', tr('전자접촉기', 'Contactor')),
        it('r_relay8', tr('8핀 릴레이 + 소켓', '8-pin relay + socket'), { sock: 'pf' }),
        it('r_imp', tr('임펄스 릴레이 (래칭)', 'Impulse relay (latching)')),
        it('r_my2', tr('각형 릴레이 2c + 소켓', 'Blade relay 2-pole + socket')),
        it('r_my4', tr('각형 릴레이 4c + 소켓', 'Blade relay 4-pole + socket')),
        it('r_timer8', tr('8핀 타이머 + 소켓', '8-pin timer + socket'), { sock: 'pf', timerMode: 'on', preset: 3000 }),
        it('r_timer8', tr('OFF 딜레이 타이머', 'Off-delay timer'), { sock: 'pf', timerMode: 'off', preset: 3000 }, 'rt8-off'),
        it('r_timer8', tr('플리커 (점멸) 타이머', 'Flicker timer'), { sock: 'pf', timerMode: 'flicker', preset: 1000 }, 'rt8-flk'),
        it('r_timer8', tr('인터벌 (원샷) 타이머', 'Interval (one-shot) timer'), { sock: 'pf', timerMode: 'interval', preset: 3000 }, 'rt8-int'),
        it('r_counter', tr('카운터 (프리셋)', 'Counter (preset)'), { count: 5 }),
        it('r_flr', tr('플로트리스 릴레이 (수위)', 'Floatless level relay')),
        it('r_tc', tr('온도 조절기 (48×48)', 'Temperature controller (48×48)'), { sv: 60, hys: 2, alarm: 80 }),
        it('r_tc8', tr('온도 조절기 8핀 (T3S 꼴 · Pt100)', 'Temp. controller 8-pin (T3S type, Pt100)'), { sv: 60, hys: 2 }),
        it('r_tk4', tr('PID 온도 조절기 (TK4S 꼴)', 'PID temp. controller (TK4S type)'), { sv: 60, hys: 2, alarm: 80 }),
        it('r_ssr', tr('SSR (무접점 릴레이)', 'SSR (solid-state relay)')),
        it('r_tsw', tr('24시간 타임 스위치', '24-h time switch'), { sched: [[18 * 3600000, 23 * 3600000]] }),
        it('r_sol', tr('솔레노이드 밸브', 'Solenoid valve')),
        it('r_vfd', tr('인버터 (VFD)', 'Inverter (VFD)')),
      ],
    },
    {
      title: tr('스위치 · 푸시버튼', 'Switches & push buttons'),
      mode: 'real',
      items: [
        it('r_pb', tr('푸시버튼 (녹 · 기동)', 'Push button (green)'), { color: 'green' }, 'rpb-g'),
        it('r_pb', tr('푸시버튼 (적 · 정지)', 'Push button (red)'), { color: 'red' }, 'rpb-r'),
        it('r_pb', tr('푸시버튼 (황)', 'Push button (yellow)'), { color: 'yellow' }, 'rpb-y'),
        it('r_pbl', tr('조광형 푸시버튼 (녹)', 'Illuminated button (green)'), { color: 'green' }, 'rpbl-g'),
        it('r_pbl', tr('조광형 푸시버튼 (적)', 'Illuminated button (red)'), { color: 'red' }, 'rpbl-r'),
        it('r_ss', tr('셀렉터 스위치', 'Selector switch')),
        it('r_ss3', tr('3단 셀렉터 (수동 · 정지 · 자동)', '3-position selector (man / off / auto)')),
        it('r_estop', tr('비상정지', 'E-stop')),
        it('r_fsw', tr('풋 스위치', 'Foot switch')),
        it('r_ls', tr('리밋 스위치', 'Limit switch')),
        it('r_sw', tr('스위치 (단로)', 'Switch (1-way)')),
        it('r_sw3', tr('3로 스위치', '3-way switch')),
      ],
    },
    {
      title: tr('센서 (근접 · 광전 · 수위 · 압력)', 'Sensors (proximity, photo, level, pressure)'),
      mode: 'real',
      items: [
        it('r_prox', tr('근접 센서 PNP (3선식)', 'Proximity PNP (3-wire)'), { sense: 'inductive' }, 'rprox-p'),
        it('r_prox', tr('근접 센서 NPN (3선식)', 'Proximity NPN (3-wire)'), { sense: 'inductive', npn: true }, 'rprox-n'),
        it('r_prox', tr('광전 센서 (3선식)', 'Photo sensor (3-wire)'), { sense: 'photo' }, 'rprox-ph', 'PH'),
        it('r_prox2', tr('근접 센서 DC 2선식', 'Proximity DC 2-wire'), { sense: 'inductive' }, 'rprox2-dc'),
        it('r_prox2', tr('근접 센서 AC 2선식', 'Proximity AC 2-wire'), { sense: 'inductive', ac: true }, 'rprox2-ac'),
        it('r_float', tr('플로트 스위치 (수위)', 'Float switch')),
        it('r_tank', tr('수조 + 전극봉 (E1 · E2 · E3)', 'Tank + electrodes (E1, E2, E3)')),
        it('r_psw', tr('압력 스위치', 'Pressure switch')),
        it('r_rtd', tr('측온저항체 Pt100 (3선식)', 'RTD Pt100 (3-wire)')),
        it('r_rtd2', tr('측온저항체 Pt100 더블 (3선식 × 2)', 'RTD Pt100 duplex (2 × 3-wire)')),
        it('r_thermo', tr('판넬 서모스탯 (히터 · NC)', 'Panel thermostat (heater, NC)'), { ncOut: true, sv: 10, hys: 5 }, 'rthermo-nc'),
        it('r_thermo', tr('판넬 서모스탯 (팬 · NO)', 'Panel thermostat (fan, NO)'), { sv: 35, hys: 5 }, 'rthermo-no'),
      ],
    },
    {
      title: tr('표시 · 부하', 'Indicators & loads'),
      mode: 'real',
      items: [
        it('r_lamp', tr('램프 (녹)', 'Lamp (green)'), { color: 'green' }, 'rl-g'),
        it('r_lamp', tr('램프 (적)', 'Lamp (red)'), { color: 'red' }, 'rl-r'),
        it('r_lamp', tr('램프 (황)', 'Lamp (yellow)'), { color: 'yellow' }, 'rl-y'),
        it('r_buzzer', tr('부저', 'Buzzer')),
        it('r_light', tr('전등', 'Light')),
        it('r_outlet', tr('콘센트', 'Socket outlet')),
        it('r_fan', tr('판넬 팬', 'Panel fan')),
        it('r_motor3', tr('3상 전동기', '3-ph motor')),
        it('r_motor6', tr('3상 전동기 6단자 (Y-Δ)', '3-ph motor, 6 leads (Y-Δ)')),
      ],
    },
    {
      title: tr('전원 · 계측기', 'Power supply & meters'),
      mode: 'real',
      items: [it('r_smps', tr('SMPS (DC 24V)', 'SMPS (24 V DC)')), it('r_vm', tr('전압계', 'Voltmeter')), it('r_am', tr('전류계', 'Ammeter'))],
    },
    {
      title: tr('배선 자재', 'Wiring accessories'),
      mode: 'real',
      items: [
        it('r_tb', tr('단자대 6P', 'Terminal block 6P'), { n: 6 }, 'tb6'),
        it('r_tb', tr('단자대 12P', 'Terminal block 12P'), { n: 12 }, 'tb12'),
        it('r_nbar', tr('중성선 바 (N)', 'Neutral bar'), { n: 6, pole: 'N' }, 'nbar-n', 'NB'),
        it('r_nbar', tr('접지 바 (PE)', 'Earth bar'), { n: 6, pole: 'PE' }, 'nbar-pe', 'PEB'),
        it('r_duct', tr('배선 덕트', 'Wire duct'), { w: 16, h: 2 }),
        it('r_rail', tr('DIN 레일', 'DIN rail'), { w: 16 }),
      ],
    },
    {
      title: tr('수전 · 변압기 (계통 해석)', 'Utility & transformer (system analysis)'),
      mode: 'real',
      items: [
        it('r_kepco', tr('한전 수전 22.9 kV', 'Utility 22.9 kV'), { kv: 22.9, ka: 12.5 }),
        it('r_vcb', tr('진공차단기 VCB', 'VCB'), { amps: 630, ka: 25 }),
        it('r_tr3', tr('변압기 3상 (Δ-Y)', 'Transformer 3-phase'), { kva: 500, kv: 22.9, z: 5 }),
      ],
    },
    {
      title: tr('분전반 · 부하 (해석)', 'Panels & loads (analysis)'),
      mode: 'real',
      items: [
        it('r_panel', tr('분전반 · 변전함 (테두리)', 'Panel box'), { w: 20, h: 24, name: tr('분전반', 'Panel') }),
        it('r_bus', tr('부스바 4극 (L1 L2 L3 N)', 'Busbar 4-pole'), { bars: 4, h: 20, mm2: 100, amps: 250 }, 'bus4'),
        it('r_bus', tr('부스바 3극 (L1 L2 L3)', 'Busbar 3-pole'), { bars: 3, h: 20, mm2: 100, amps: 250 }, 'bus3'),
        it('r_load3', tr('부하 3상 (kW)', '3-phase load (kW)'), { watt: 7500, pf: 0.9, pe: true }),
        it('r_load1', tr('부하 단상 (kW)', '1-phase load (kW)'), { watt: 2000, pf: 1, pe: true }),
      ],
    },
    {
      title: tr('전원', 'Supply'),
      mode: 'symbol',
      items: [
        it('src', 'L (220V)', { pole: 'L' }, 'src-L'),
        it('src', 'N', { pole: 'N' }, 'src-N'),
        it('src', '+24V', { pole: '+24V' }, 'src-p'),
        it('src', '0V', { pole: '0V' }, 'src-0'),
        it('src3', tr('3상 L1 L2 L3', '3-ph L1 L2 L3')),
        it('smps', tr('SMPS (AC→DC 24V)', 'SMPS (AC→DC 24V)')),
      ],
    },
    {
      title: tr('보호 기기', 'Protection'),
      mode: 'symbol',
      items: [it('mcb3', 'MCCB 3P'), it('mcb', tr('차단기 1P', 'Breaker 1P')), it('fuse', tr('퓨즈', 'Fuse')), it('fuse3', tr('퓨즈 3P', 'Fuse 3P')), it('ol3', 'THR 3P'), it('sk', tr('스파크 킬러 (CR)', 'Spark killer (RC)')), it('diode', tr('다이오드 (서지 흡수)', 'Diode (surge)'))],
    },
    {
      title: tr('조작 스위치', 'Switches'),
      mode: 'symbol',
      items: [
        it('pb_no', tr('푸시버튼 a (기동)', 'Push button NO'), { color: 'green' }),
        it('pb_nc', tr('푸시버튼 b (정지)', 'Push button NC'), { color: 'red' }),
        it('sw_no', tr('셀렉터 a', 'Selector NO')),
        it('sw_nc', tr('셀렉터 b', 'Selector NC')),
        it('estop', tr('비상정지', 'E-stop')),
        it('ls_no', tr('리밋 스위치 a', 'Limit switch NO')),
        it('ls_nc', tr('리밋 스위치 b', 'Limit switch NC')),
      ],
    },
    {
      title: tr('센서', 'Sensors'),
      items: [
        it('prox', tr('근접 센서 (유도형)', 'Proximity (inductive)'), { sense: 'inductive' }, 'prox-i', 'PX'),
        it('prox', tr('근접 센서 (정전용량형)', 'Proximity (capacitive)'), { sense: 'capacitive' }, 'prox-c', 'PX'),
        it('prox', tr('광전 센서', 'Photoelectric sensor'), { sense: 'photo' }, 'prox-p', 'PE'),
        it('ls_no', tr('근접 센서 (2선식)', 'Proximity (2-wire)'), { sense: 'inductive' }, 'prox2', 'PX'),
        it('ls_no', tr('리드 스위치 (실린더 센서)', 'Reed switch (cylinder)'), { sense: 'reed' }, 'reed', 'RS'),
        it('ls_no', tr('플로트 스위치', 'Float switch'), { sense: 'float' }, 'float', 'FLS'),
        it('ls_no', tr('압력 스위치', 'Pressure switch'), { sense: 'pressure' }, 'press', 'PS'),
        it('ls_no', tr('온도 스위치 (오르면 닫힘)', 'Temperature switch (closes on rise)'), { sense: 'temp', sv: 40, hys: 5 }, 'temp-no', 'TS'),
        it('ls_nc', tr('온도 스위치 (오르면 열림)', 'Temperature switch (opens on rise)'), { sense: 'temp', sv: 10, hys: 5 }, 'temp-nc', 'TS'),
      ],
    },
    {
      title: tr('릴레이 · 타이머', 'Relays & timers'),
      mode: 'symbol',
      items: [
        it('coil', tr('릴레이 코일 X', 'Relay coil'), undefined, 'coil-x'),
        it('coil', tr('전자접촉기 코일 MC', 'Contactor coil'), undefined, 'coil-mc', 'MC'),
        it('imp', tr('임펄스 릴레이 (래칭) 코일', 'Impulse relay coil'), undefined, 'imp'),
        it('timer', tr('타이머 (ON 딜레이)', 'Timer (on-delay)'), { timerMode: 'on', preset: 3000 }),
        it('timer', tr('플리커 릴레이 (점멸)', 'Flicker relay'), { timerMode: 'flicker', preset: 500 }, 'flicker', 'FR'),
        it('timer', tr('인터벌 타이머 (원샷)', 'Interval timer (one-shot)'), { timerMode: 'interval', preset: 3000 }, 'interval'),
        it('no', tr('a접점', 'NO contact')),
        it('nc', tr('b접점', 'NC contact')),
        it('km3', tr('MC 주접점 3P', 'Contactor 3P')),
      ],
    },
    {
      title: tr('출력', 'Outputs'),
      mode: 'symbol',
      items: [
        it('lamp', tr('램프 (적색)', 'Lamp (red)'), { color: 'red' }, 'lamp-r'),
        it('lamp', tr('램프 (녹색)', 'Lamp (green)'), { color: 'green' }, 'lamp-g'),
        it('lamp', tr('램프 (황색)', 'Lamp (yellow)'), { color: 'yellow' }, 'lamp-y'),
        it('buzzer', tr('부저', 'Buzzer')),
        it('motor3', tr('3상 전동기', '3-ph motor')),
        it('motor', tr('전동기 (단상·DC)', 'Motor (1-ph/DC)')),
      ],
    },
    {
      title: tr('공압', 'Pneumatics'),
      items: [
        it('air', tr('공압원', 'Air supply')),
        it('frl', tr('에어 서비스 유닛 (FRL)', 'Service unit (FRL)')),
        it('v52', tr('5/2 밸브 편솔', '5/2 valve single')),
        it('v52d', tr('5/2 밸브 양솔', '5/2 valve double')),
        it('v53', tr('5/3 밸브 (올포트 블록)', '5/3 valve closed')),
        it('v32', tr('3/2 밸브 (NC)', '3/2 valve NC')),
        it('fc', tr('속도 제어 밸브', 'Flow control'), { speed: 50 }),
        it('sol', tr('솔레노이드 (코일)', 'Solenoid (coil)')),
        it('load', tr('부하 (히터 · 팬)', 'Load (heater, fan)')),
        it('cyl', tr('공압 실린더', 'Cylinder'), { stroke: 1000, strokeBack: 1000 }),
      ],
    },
    {
      title: tr('PLC · HMI (제어반)', 'PLC & HMI (panel)'),
      mode: 'real',
      items: [it('r_plc', tr('PLC (입력 16 · 릴레이 출력 16)', 'PLC (16 in / 16 relay out)')), it('r_hmi', tr('HMI (터치 판넬)', 'HMI (touch panel)'))],
    },
    { title: 'PLC', items: [it('plc', tr('PLC (입력 8 · 출력 8)', 'PLC (8 in / 8 out)'))] },
    { title: tr('기타', 'Other'), items: [it('text', tr('글자', 'Text'), { text: tr('글자', 'Text') })] },
  ];
}

// ───────────────────────── 기하 ─────────────────────────

export function rotate(x: number, y: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
  }
}

/** 단자의 절대 좌표 */
export function pinPositions(p: Part): [number, number][] {
  return partPins(p).map((pin) => {
    const [dx, dy] = rotate(pin.x, pin.y, p.rot);
    return [p.x + dx, p.y + dy];
  });
}

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 0.75 : 0.42;
  return Math.max(1, w);
}

/** 클릭 영역 (절대 좌표) */
export function partBox(p: Part): [number, number, number, number] {
  let [x0, y0, x1, y1] = PARTS[p.type].box;
  if (p.type === 'text') x1 = textWidth(p.text ?? '') + 0.2;
  if (p.type === 'r_tb' || p.type === 'r_nbar') x1 = 2 * (tbSize(p) - 1) + 1.2;
  if (p.type === 'r_duct') [x1, y1] = stripSize(p);
  if (p.type === 'r_rail') x1 = stripSize(p)[0];
  if (p.type === 'r_panel') [x1, y1] = panelSize(p);
  if (p.type === 'r_bus') {
    const { bars, len } = busSize(p);
    [x1, y1] = [2 * (bars - 1) + 0.6, len + 2.4];
  }
  const corners = [rotate(x0, y0, p.rot), rotate(x1, y1, p.rot)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [p.x + Math.min(...xs), p.y + Math.min(...ys), p.x + Math.max(...xs), p.y + Math.max(...ys)];
}

export const POLE_IDENTITY: Record<Pole, string> = { '+24V': '+24V', '0V': '0V', L: 'L1', N: 'N', L1: 'L1', L2: 'L2', L3: 'L3', PE: 'PE' };
/** PE(보호 접지)는 혼자인 계통이라 부하를 움직이지 않고, L 과 닿으면 단락(지락)으로 잡힌다 */
export const POLE_SYSTEM: Record<string, 'dc' | 'ac' | 'pe' | 'hv'> = { '+24V': 'dc', '0V': 'dc', L1: 'ac', L2: 'ac', L3: 'ac', N: 'ac', PE: 'pe', H1: 'hv', H2: 'hv', H3: 'hv' };

/** 기호를 따라 움직이는 접점 (코일·타이머·THR·스위치) */
export const FOLLOWER: ReadonlySet<PartType> = new Set(['no', 'nc', 'km3']);
export const OPERATOR: ReadonlySet<PartType> = new Set(['pb_no', 'pb_nc', 'sw_no', 'sw_nc', 'estop', 'ls_no', 'ls_nc', 'mcb', 'mcb3', 'ol3', 'prox', 'r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mcb4', 'r_vcb', 'r_pb', 'r_thr', 'r_ss', 'r_estop', 'r_sw', 'r_sw3', 'r_prox', 'r_ls', 'r_pbl', 'r_fsw', 'r_float', 'r_psw', 'r_ss3', 'r_prox2', 'r_vfd']);
export const VALVES: ReadonlySet<PartType> = new Set(['v32', 'v52', 'v52d', 'v53']);
export const CONTACT_A: ReadonlySet<PartType> = new Set(['no', 'pb_no', 'sw_no', 'ls_no']);
export const CONTACT_B: ReadonlySet<PartType> = new Set(['nc', 'pb_nc', 'sw_nc', 'ls_nc', 'estop']);

export function isLinkedSensor(p: Part): boolean {
  return (p.type === 'ls_no' || p.type === 'ls_nc' || p.type === 'prox' || p.type === 'r_ls' || p.type === 'r_prox' || p.type === 'r_prox2') && !!p.cyl;
}

/** 기호 순서 비교: PB2 < PB10 */
export function compareTags(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** 같은 앞글자의 다음 기호 (PB1, PB2 …) */
export function nextTag(parts: Part[], prefix: string): string {
  if (!prefix) return '';
  const used = new Set(parts.map((p) => p.tag.toUpperCase()));
  for (let n = 1; n < 1000; n++) if (!used.has(`${prefix}${n}`.toUpperCase())) return `${prefix}${n}`;
  return prefix;
}
