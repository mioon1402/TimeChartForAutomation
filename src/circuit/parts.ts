import type { LampColor, Part, PartType, Pole, Rot } from './types';
import { tr } from '../i18n';

export type PartCategory = 'power' | 'protect' | 'switch' | 'relay' | 'output' | 'pneumatic' | 'misc';

export interface PinDef {
  x: number;
  y: number;
  /** 단자 번호 (13, 14, A1, U …) */
  label: string;
}

export interface PartDef {
  type: PartType;
  cat: PartCategory;
  pins: PinDef[];
  /** 서로 이어지는 단자 쌍 (접점·퓨즈·차단기) */
  poles?: [number, number][];
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
const BOX2: [number, number, number, number] = [-1, -2, 1, 2];
const BOX2W: [number, number, number, number] = [-1.6, -2, 1, 2];
const BOX3: [number, number, number, number] = [-3, -2, 3, 2];

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
  cyl: { type: 'cyl', cat: 'pneumatic', pins: [], box: [0, -1.6, 12, 1.8], prefix: 'CYL' },
  text: { type: 'text', cat: 'misc', pins: [], box: [0, -0.8, 4, 0.4], prefix: '' },
};

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
}

export function palette(): PaletteGroup[] {
  const it = (type: PartType, label: string, init?: Partial<Part>, key?: string, prefix?: string): PaletteItem => ({ key: key ?? type, type, label, init, prefix });
  return [
    {
      title: tr('전원', 'Supply'),
      items: [
        it('src', 'L (220V)', { pole: 'L' }, 'src-L'),
        it('src', 'N', { pole: 'N' }, 'src-N'),
        it('src', '+24V', { pole: '+24V' }, 'src-p'),
        it('src', '0V', { pole: '0V' }, 'src-0'),
        it('src3', tr('3상 L1 L2 L3', '3-ph L1 L2 L3')),
      ],
    },
    {
      title: tr('보호 기기', 'Protection'),
      items: [it('mcb3', 'MCCB 3P'), it('mcb', tr('차단기 1P', 'Breaker 1P')), it('fuse', tr('퓨즈', 'Fuse')), it('fuse3', tr('퓨즈 3P', 'Fuse 3P')), it('ol3', 'THR 3P')],
    },
    {
      title: tr('조작 스위치', 'Switches'),
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
      title: tr('릴레이 · 타이머', 'Relays & timers'),
      items: [
        it('coil', tr('릴레이 코일 X', 'Relay coil'), undefined, 'coil-x'),
        it('coil', tr('전자접촉기 코일 MC', 'Contactor coil'), undefined, 'coil-mc', 'MC'),
        it('timer', tr('타이머 (ON 딜레이)', 'Timer (on-delay)'), { timerMode: 'on', preset: 3000 }),
        it('no', tr('a접점', 'NO contact')),
        it('nc', tr('b접점', 'NC contact')),
        it('km3', tr('MC 주접점 3P', 'Contactor 3P')),
      ],
    },
    {
      title: tr('출력', 'Outputs'),
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
      items: [it('sol', tr('솔레노이드 밸브', 'Solenoid valve')), it('cyl', tr('공압 실린더', 'Cylinder'), { stroke: 1000, strokeBack: 1000 })],
    },
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
  return PARTS[p.type].pins.map((pin) => {
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
  const corners = [rotate(x0, y0, p.rot), rotate(x1, y1, p.rot)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [p.x + Math.min(...xs), p.y + Math.min(...ys), p.x + Math.max(...xs), p.y + Math.max(...ys)];
}

export const POLE_IDENTITY: Record<Pole, string> = { '+24V': '+24V', '0V': '0V', L: 'L1', N: 'N', L1: 'L1', L2: 'L2', L3: 'L3' };
export const POLE_SYSTEM: Record<string, 'dc' | 'ac'> = { '+24V': 'dc', '0V': 'dc', L1: 'ac', L2: 'ac', L3: 'ac', N: 'ac' };

/** 기호를 따라 움직이는 접점 (코일·타이머·THR·스위치) */
export const FOLLOWER: ReadonlySet<PartType> = new Set(['no', 'nc', 'km3']);
export const OPERATOR: ReadonlySet<PartType> = new Set(['pb_no', 'pb_nc', 'sw_no', 'sw_nc', 'estop', 'ls_no', 'ls_nc', 'mcb', 'mcb3', 'ol3']);
export const CONTACT_A: ReadonlySet<PartType> = new Set(['no', 'pb_no', 'sw_no', 'ls_no']);
export const CONTACT_B: ReadonlySet<PartType> = new Set(['nc', 'pb_nc', 'sw_nc', 'ls_nc', 'estop']);

export function isLinkedSensor(p: Part): boolean {
  return (p.type === 'ls_no' || p.type === 'ls_nc') && !!p.cyl;
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
