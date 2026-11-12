import type { CableSpec, Circuit, LampColor, Part, PartType, Pole, Rot, Wire, WireColor } from './types';
import type { PlcDialect } from '../plc/types';
import { tr } from '../i18n';

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
/** 8핀 소켓 단자: 번호 순서대로 (2-7 코일, 1 공통 → 3 a · 4 b, 8 공통 → 6 a · 5 b) */
const OCTAL: PinDef[] = [pin(-3, -3, '1'), pin(-1, -3, '2'), pin(1, -3, '3'), pin(3, -3, '4'), pin(3, 3, '5'), pin(1, 3, '6'), pin(-1, 3, '7'), pin(-3, 3, '8')];
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
  r_ss: { type: 'r_ss', cat: 'switch', pins: [pin(-1, 0, '11'), pin(1, 0, '12'), pin(-1, 2, '23'), pin(1, 2, '24')], poles: PB_POLES, polesNc: [true, false], operate: 'toggle', box: [-2.2, -4, 2.2, 3], prefix: 'SS' },
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
  r_load3: { type: 'r_load3', cat: 'output', pins: [pin(-2, -3, 'L1'), pin(0, -3, 'L2'), pin(2, -3, 'L3')], load: true, box: [-3.6, -3.8, 3.6, 3], prefix: 'LD' },
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
export const REAL: ReadonlySet<PartType> = new Set(['r_term', 'r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mc', 'r_thr', 'r_pb', 'r_lamp', 'r_motor3', 'r_relay8', 'r_timer8', 'r_ss', 'r_estop', 'r_tb', 'r_tsw', 'r_light', 'r_sw', 'r_sw3', 'r_load1', 'r_load3', 'r_panel', 'r_mcb4', 'r_bus']);

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
export function tbSize(p: Part): number {
  return Math.min(40, Math.max(1, Math.round(p.n ?? 6)));
}

/** 부품의 단자 (단자대는 극수만큼) */
export function partPins(p: Part): PinDef[] {
  if (p.type === 'r_bus') return BUS_PHASES.slice(0, busSize(p).bars).map((ph, k) => pin(2 * k, 0, ph));
  if (p.type !== 'r_tb') return PARTS[p.type].pins;
  const out: PinDef[] = [];
  for (let k = 0; k < tbSize(p); k++) out.push(pin(2 * k, -2, String(k + 1)), pin(2 * k, 2, String(k + 1)));
  return out;
}

/** 서로 이어지는 단자 쌍 */
export function partPoles(p: Part): [number, number][] | undefined {
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

export function plcAddresses(p: Part): { ins: string[]; outs: string[] } {
  const ins = Array.from({ length: PLC_IO }, (_, n) => plcAddress(p.inBase || 'X0', n));
  const outs = Array.from({ length: PLC_IO }, (_, n) => plcAddress(p.outBase || 'Y0', n));
  return { ins, outs };
}

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
    case 'r_ss':
      return tr('셀렉터 스위치 (1a1b)', 'Selector switch (1 NO 1 NC)');
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
      title: tr('차단기 · 계전기', 'Breakers & relays'),
      mode: 'real',
      items: [
        it('r_mcb4', tr('차단기 4P', 'Breaker 4P')),
        it('r_mcb3', tr('차단기 3P', 'Breaker 3P')),
        it('r_mcb2', tr('차단기 2P', 'Breaker 2P')),
        it('r_mcb1', tr('차단기 1P', 'Breaker 1P')),
        it('r_mcb4', tr('누전차단기 4P', 'ELB 4P'), { elb: true }, 'elb4', 'ELB'),
        it('r_mcb3', tr('누전차단기 3P', 'ELB 3P'), { elb: true }, 'elb3', 'ELB'),
        it('r_mcb2', tr('누전차단기 2P', 'ELB 2P'), { elb: true }, 'elb2', 'ELB'),
        it('r_mc', tr('전자접촉기', 'Contactor')),
        it('r_thr', tr('열동 계전기 THR', 'Overload THR')),
      ],
    },
    {
      title: tr('릴레이 · 타이머 (8핀)', '8-pin relay & timer'),
      mode: 'real',
      items: [it('r_relay8', tr('8핀 릴레이 + 소켓', '8-pin relay + socket')), it('r_timer8', tr('8핀 타이머 + 소켓', '8-pin timer + socket'), { timerMode: 'on', preset: 3000 })],
    },
    {
      title: tr('전등 · 타임 스위치', 'Lighting & time switch'),
      mode: 'real',
      items: [
        it('r_tsw', tr('24시간 타임 스위치', '24-h time switch'), { sched: [[18 * 3600000, 23 * 3600000]] }),
        it('r_light', tr('전등', 'Light')),
        it('r_sw', tr('스위치 (단로)', 'Switch (1-way)')),
        it('r_sw3', tr('3로 스위치', '3-way switch')),
      ],
    },
    {
      title: tr('조작 · 표시', 'Buttons & lamps'),
      mode: 'real',
      items: [
        it('r_pb', tr('푸시버튼 (녹 · 기동)', 'Push button (green)'), { color: 'green' }, 'rpb-g'),
        it('r_pb', tr('푸시버튼 (적 · 정지)', 'Push button (red)'), { color: 'red' }, 'rpb-r'),
        it('r_pb', tr('푸시버튼 (황)', 'Push button (yellow)'), { color: 'yellow' }, 'rpb-y'),
        it('r_ss', tr('셀렉터 스위치', 'Selector switch')),
        it('r_estop', tr('비상정지', 'E-stop')),
        it('r_lamp', tr('램프 (녹)', 'Lamp (green)'), { color: 'green' }, 'rl-g'),
        it('r_lamp', tr('램프 (적)', 'Lamp (red)'), { color: 'red' }, 'rl-r'),
        it('r_lamp', tr('램프 (황)', 'Lamp (yellow)'), { color: 'yellow' }, 'rl-y'),
      ],
    },
    { title: tr('전동기', 'Motors'), mode: 'real', items: [it('r_motor3', tr('3상 전동기', '3-ph motor'))] },
    {
      title: tr('분전반 · 부하 (해석)', 'Panels & loads (analysis)'),
      mode: 'real',
      items: [
        it('r_panel', tr('분전반 · 변전함 (테두리)', 'Panel box'), { w: 20, h: 24, name: tr('분전반', 'Panel') }),
        it('r_bus', tr('부스바 4극 (L1 L2 L3 N)', 'Busbar 4-pole'), { bars: 4, h: 20, mm2: 100, amps: 250 }, 'bus4'),
        it('r_bus', tr('부스바 3극 (L1 L2 L3)', 'Busbar 3-pole'), { bars: 3, h: 20, mm2: 100, amps: 250 }, 'bus3'),
        it('r_load3', tr('부하 3상 (kW)', '3-phase load (kW)'), { watt: 7500, pf: 0.9 }),
        it('r_load1', tr('부하 단상 (kW)', '1-phase load (kW)'), { watt: 2000, pf: 1 }),
      ],
    },
    { title: tr('단자대', 'Terminal blocks'), mode: 'real', items: [it('r_tb', tr('단자대 6P', 'Terminal block 6P'), { n: 6 }, 'tb6'), it('r_tb', tr('단자대 12P', 'Terminal block 12P'), { n: 12 }, 'tb12')] },
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
      items: [it('mcb3', 'MCCB 3P'), it('mcb', tr('차단기 1P', 'Breaker 1P')), it('fuse', tr('퓨즈', 'Fuse')), it('fuse3', tr('퓨즈 3P', 'Fuse 3P')), it('ol3', 'THR 3P')],
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
        it('ls_no', tr('리드 스위치 (실린더 센서)', 'Reed switch (cylinder)'), { sense: 'reed' }, 'reed', 'RS'),
        it('ls_no', tr('플로트 스위치', 'Float switch'), { sense: 'float' }, 'float', 'FLS'),
        it('ls_no', tr('압력 스위치', 'Pressure switch'), { sense: 'pressure' }, 'press', 'PS'),
      ],
    },
    {
      title: tr('릴레이 · 타이머', 'Relays & timers'),
      mode: 'symbol',
      items: [
        it('coil', tr('릴레이 코일 X', 'Relay coil'), undefined, 'coil-x'),
        it('coil', tr('전자접촉기 코일 MC', 'Contactor coil'), undefined, 'coil-mc', 'MC'),
        it('timer', tr('타이머 (ON 딜레이)', 'Timer (on-delay)'), { timerMode: 'on', preset: 3000 }),
        it('timer', tr('플리커 릴레이 (점멸)', 'Flicker relay'), { timerMode: 'flicker', preset: 500 }, 'flicker', 'FR'),
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
        it('cyl', tr('공압 실린더', 'Cylinder'), { stroke: 1000, strokeBack: 1000 }),
      ],
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
  if (p.type === 'r_tb') x1 = 2 * (tbSize(p) - 1) + 1.2;
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
export const POLE_SYSTEM: Record<string, 'dc' | 'ac' | 'pe'> = { '+24V': 'dc', '0V': 'dc', L1: 'ac', L2: 'ac', L3: 'ac', N: 'ac', PE: 'pe' };

/** 기호를 따라 움직이는 접점 (코일·타이머·THR·스위치) */
export const FOLLOWER: ReadonlySet<PartType> = new Set(['no', 'nc', 'km3']);
export const OPERATOR: ReadonlySet<PartType> = new Set(['pb_no', 'pb_nc', 'sw_no', 'sw_nc', 'estop', 'ls_no', 'ls_nc', 'mcb', 'mcb3', 'ol3', 'prox', 'r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mcb4', 'r_pb', 'r_thr', 'r_ss', 'r_estop', 'r_sw', 'r_sw3']);
export const VALVES: ReadonlySet<PartType> = new Set(['v32', 'v52', 'v52d', 'v53']);
export const CONTACT_A: ReadonlySet<PartType> = new Set(['no', 'pb_no', 'sw_no', 'ls_no']);
export const CONTACT_B: ReadonlySet<PartType> = new Set(['nc', 'pb_nc', 'sw_nc', 'ls_nc', 'estop']);

export function isLinkedSensor(p: Part): boolean {
  return (p.type === 'ls_no' || p.type === 'ls_nc' || p.type === 'prox') && !!p.cyl;
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
