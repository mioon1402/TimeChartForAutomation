import type { CableMethod, CableSpec, Circuit, Part, PartType, Wire } from './types';
import { panelSize, partKindName, partPins, pinPositions, PARTS, POLE_IDENTITY } from './parts';
import { CircuitModel, runScenario, type CircuitSim, type Conductor } from './engine';
import { tr } from '../i18n';

/**
 * 전기 해석: 회로의 그 순간 상태 (어느 접점이 붙어 있는가) 에서 전선마다 흐르는 전류와 부하의 단자 전압을 계산하고,
 * 허용전류 (KEC 232.5, KS C IEC 60364-5-52 부속서 B) · 전압강하 (KEC 232.3.9) · 차단기 정격 (IB ≤ In ≤ Iz) 을 검토한다.
 *
 *  - 전원은 이상적인 전압원 (L1 · L2 · L3 = 상전압, 120° 차, N · PE = 0, +24V = 24 V).
 *  - 부하는 정격 전압에서 정격 용량을 쓰는 임피던스 (정임피던스). 3상 부하는 Y 결선 (중성점은 떠 있음).
 *  - 케이블 규격이 있는 전선만 임피던스를 가진다: R = ρ·L/S (ρ = 0.0225 Ω·mm²/m, 사용 온도의 구리), X = 0.08 mΩ/m
 *    (KS C IEC 60364-5-52 부속서 G 의 전압강하 식과 같은 값). 규격이 없는 선과 닫힌 접점은 임피던스 0.
 *  - 임피던스 0 으로 이어진 점들은 한 마디로 묶어 복소 마디 해석을 하고, 묶음 안의 전선 전류는
 *    나무 (전원에서 퍼지는 순서) 를 따라 아래쪽 전류를 더해서 구한다. 임피던스 0 인 선이 고리를 이루면
 *    어느 쪽으로 흐르는지 정해지지 않으므로 한쪽으로만 흐르는 것으로 본다.
 */

type Pt = [number, number];
type C = [number, number]; // 복소수 [실수, 허수]

const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cinv = (a: C): C => {
  const d = a[0] * a[0] + a[1] * a[1];
  return [a[0] / d, -a[1] / d];
};
const cabs = (a: C) => Math.hypot(a[0], a[1]);

// ───────────────────────── 허용전류 표 ─────────────────────────

/** 도체 공칭 단면적 (mm²) */
export const CABLE_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

type Table = Partial<Record<CableMethod, number[]>>;

/**
 * 허용전류 (A), 구리 도체. 줄 = 공사방법, 칸 = CABLE_SIZES 순서 (0 = 표에 없음).
 * KS C IEC 60364-5-52 표 B.52.2 (PVC 2개) · B.52.3 (XLPE 2개) · B.52.4 (PVC 3개) · B.52.5 (XLPE 3개): 주위온도 기중 30℃, 지중 20℃.
 * E · F (케이블 트레이) 는 XLPE 만, 기준 주위온도 40℃ 인 표.
 */
const IZ: Record<'pvc' | 'xlpe', Record<2 | 3, Table>> = {
  pvc: {
    2: {
      A1: [14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210],
      A2: [14, 18.5, 25, 32, 43, 57, 75, 92, 110, 139, 167, 192],
      B1: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269],
      B2: [16.5, 23, 30, 38, 52, 69, 90, 111, 133, 168, 201, 232],
      C: [19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258, 299],
      D1: [22, 29, 37, 46, 60, 78, 99, 119, 140, 173, 204, 231],
      D2: [22, 28, 38, 48, 64, 83, 110, 132, 156, 192, 230, 261],
    },
    3: {
      A1: [13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188],
      A2: [13, 17.5, 23, 29, 39, 52, 68, 83, 99, 125, 150, 172],
      B1: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239],
      B2: [15, 20, 27, 34, 46, 62, 80, 99, 118, 149, 179, 206],
      C: [17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259],
      D1: [18, 24, 30, 38, 50, 64, 82, 98, 116, 143, 169, 192],
      D2: [19, 24, 33, 41, 54, 70, 92, 110, 130, 162, 193, 220],
    },
  },
  xlpe: {
    2: {
      A1: [19, 26, 35, 45, 61, 81, 106, 131, 158, 200, 241, 278, 318, 362, 424, 486],
      A2: [18.5, 25, 33, 42, 57, 76, 99, 121, 145, 183, 220, 253, 290, 329, 386, 442],
      B1: [23, 31, 42, 54, 75, 100, 133, 164, 198, 253, 306, 354, 393, 449, 528, 603],
      B2: [22, 30, 40, 51, 69, 91, 119, 146, 175, 221, 265, 305, 334, 384, 459, 532],
      C: [24, 33, 45, 58, 80, 107, 138, 171, 209, 269, 328, 382, 441, 506, 599, 693],
      D1: [25, 33, 43, 53, 71, 91, 116, 139, 164, 203, 239, 271, 306, 343, 395, 446],
      D2: [27, 35, 46, 58, 77, 100, 129, 155, 183, 225, 270, 306, 343, 387, 448, 502],
      E: [0, 0, 45, 57, 78, 105, 135, 168, 205, 263, 320, 373, 430, 493, 583, 674],
      F: [0, 0, 0, 0, 0, 0, 146, 182, 220, 282, 343, 398, 459, 523, 618, 712],
    },
    3: {
      A1: [17, 23, 31, 40, 54, 73, 95, 117, 141, 179, 216, 249, 285, 324, 380, 435],
      A2: [16.5, 22, 30, 38, 51, 68, 89, 109, 130, 164, 197, 227, 259, 295, 346, 396],
      B1: [20, 28, 37, 48, 66, 88, 117, 144, 175, 222, 269, 312, 342, 384, 450, 514],
      B2: [19.5, 26, 35, 44, 60, 80, 105, 128, 154, 194, 233, 268, 300, 340, 398, 455],
      C: [22, 30, 40, 52, 71, 96, 119, 147, 179, 229, 278, 322, 371, 424, 500, 576],
      D1: [21, 28, 36, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324, 365],
      D2: [23, 30, 39, 49, 65, 84, 107, 129, 153, 188, 226, 257, 287, 324, 375, 419],
      E: [0, 0, 38, 49, 68, 91, 116, 144, 175, 224, 271, 315, 363, 415, 490, 565],
      F: [0, 0, 0, 0, 0, 0, 123, 154, 188, 244, 298, 348, 404, 464, 552, 640],
    },
  },
};

/** 주위온도 보정계수 (표 B.52.14, 기준 30℃): [온도, PVC, XLPE·EPR] */
const TEMP_K: [number, number, number][] = [
  [10, 1.22, 1.15],
  [15, 1.17, 1.12],
  [20, 1.12, 1.08],
  [25, 1.06, 1.04],
  [30, 1.0, 1.0],
  [35, 0.94, 0.96],
  [40, 0.87, 0.91],
  [45, 0.79, 0.87],
  [50, 0.71, 0.82],
  [55, 0.61, 0.76],
  [60, 0.5, 0.71],
  [65, 0, 0.65],
];

/** 복수회로 감소계수 (표 B.52.17): 항 1 = 묶음 · 전선관 (방법 A~D), 항 5 = 사다리 · 클리트의 단일층 (방법 E · F) */
const GROUP_1: [number, number][] = [
  [1, 1.0],
  [2, 0.8],
  [3, 0.7],
  [4, 0.65],
  [5, 0.6],
  [6, 0.57],
  [7, 0.54],
  [8, 0.52],
  [9, 0.5],
  [12, 0.45],
  [16, 0.41],
  [20, 0.38],
];
const GROUP_5: [number, number][] = [
  [1, 1.0],
  [2, 0.87],
  [3, 0.82],
  [4, 0.8],
  [5, 0.8],
  [6, 0.79],
  [7, 0.79],
  [8, 0.78],
  [9, 0.78],
];

const TRAY = (m: CableMethod) => m === 'E' || m === 'F';
const BURIED = (m: CableMethod) => m === 'D1' || m === 'D2';

function tempK(ins: 'pvc' | 'xlpe', t: number): number {
  const col = ins === 'pvc' ? 1 : 2;
  const rows = TEMP_K.filter((r) => r[col] > 0);
  if (t <= rows[0][0]) return rows[0][col];
  for (let i = 1; i < rows.length; i++) {
    if (t <= rows[i][0]) {
      const [t0, t1] = [rows[i - 1][0], rows[i][0]];
      return rows[i - 1][col] + ((rows[i][col] - rows[i - 1][col]) * (t - t0)) / (t1 - t0);
    }
  }
  return 0;
}

/** 주위온도 보정계수. 트레이 표 (E · F) 는 기준이 40℃, 지중 (D) 은 지중 온도 표가 따로라 적용하지 않는다 */
export function tempFactor(spec: CableSpec): number {
  if (BURIED(spec.method)) return 1;
  const t = spec.amb ?? (TRAY(spec.method) ? 40 : 30);
  const k = tempK(spec.ins, t);
  return TRAY(spec.method) ? k / tempK(spec.ins, 40) : k;
}

/** 복수회로 감소계수: 표에 없는 회로 수는 그보다 많은 쪽 값 (안전 쪽) */
export function groupFactor(spec: CableSpec): number {
  const n = Math.max(1, Math.round(spec.group ?? 1));
  const tab = TRAY(spec.method) ? GROUP_5 : GROUP_1;
  for (const [k, f] of tab) if (n <= k) return f;
  return tab[tab.length - 1][1];
}

/** 표의 허용전류 (보정 전). 표에 없는 조합이면 null */
export function tableIz(spec: CableSpec): number | null {
  if (spec.kind === 'bus') return spec.iz ?? null;
  const i = CABLE_SIZES.indexOf(spec.mm2);
  const v = i < 0 ? 0 : IZ[spec.ins][spec.cores][spec.method]?.[i] ?? 0;
  return v > 0 ? v : null;
}

/** 허용전류 Iz (A) = 표 값 × 주위온도 보정 × 복수회로 감소. 부스바는 적어 넣은 값 */
export function cableIz(spec: CableSpec): number | null {
  const base = tableIz(spec);
  if (base === null) return null;
  if (spec.kind === 'bus') return base;
  return Math.round(base * tempFactor(spec) * groupFactor(spec) * 10) / 10;
}

/** 그 조합에서 고를 수 있는 굵기 */
export function cableSizes(ins: 'pvc' | 'xlpe', cores: 2 | 3, method: CableMethod): number[] {
  const row = IZ[ins][cores][method] ?? [];
  return CABLE_SIZES.filter((_, i) => (row[i] ?? 0) > 0);
}

export function cableMethods(ins: 'pvc' | 'xlpe'): CableMethod[] {
  return Object.keys(IZ[ins][3]) as CableMethod[];
}

/** 구리의 저항률 (사용 온도, Ω·mm²/m) 과 전선 1 m 의 리액턴스 (Ω) - KS C IEC 60364-5-52 부속서 G */
export const RHO_CU = 0.0225;
export const X_PER_M = 0.00008;

/** 전선 한 가닥 전체의 임피던스 [R, X] (Ω) */
export function cableZ(spec: CableSpec): C {
  const len = Math.max(0, spec.len);
  return [(RHO_CU * len) / Math.max(0.01, spec.mm2), spec.kind === 'bus' ? 0 : X_PER_M * len];
}

export function cableText(spec: CableSpec): string {
  if (spec.kind === 'bus') return tr(`부스바 ${spec.mm2} mm² · ${spec.len} m`, `Busbar ${spec.mm2} mm² · ${spec.len} m`);
  const ins = spec.ins === 'pvc' ? 'PVC' : 'XLPE';
  return `${ins} ${spec.mm2} mm² · ${spec.method} · ${spec.cores === 3 ? tr('3상', '3-ph') : tr('단상', '1-ph')} · ${spec.len} m`;
}

// ───────────────────────── 부하 · 차단기 ─────────────────────────

/** 용량을 적지 않았을 때의 가정값 (W). 제어 기기는 작게 */
const DEFAULT_W: Partial<Record<PartType, number>> = {
  r_load1: 2000,
  r_load3: 7500,
  r_motor3: 3700,
  motor3: 3700,
  motor: 200,
  r_light: 100,
  lamp: 2,
  r_lamp: 2,
  buzzer: 3,
  coil: 5,
  timer: 3,
  r_relay8: 3,
  r_timer8: 3,
  r_mc: 10,
  sol: 6,
};

const THREE: ReadonlySet<PartType> = new Set(['motor3', 'r_motor3', 'r_load3']);
const MOTOR: ReadonlySet<PartType> = new Set(['motor3', 'r_motor3', 'motor']);
const BREAKER: ReadonlySet<PartType> = new Set(['r_mcb1', 'r_mcb2', 'r_mcb3', 'mcb', 'mcb3', 'fuse', 'fuse3']);

/** 해석에서 부하로 보는 부품의 용량: 유효 전력 (W), 역률, 피상 전력 (VA) */
export function loadRating(p: Part): { w: number; pf: number; va: number; out: number } | null {
  const base = p.watt ?? DEFAULT_W[p.type];
  if (base === undefined || base <= 0) return null;
  const motor = MOTOR.has(p.type);
  const pf = Math.min(1, Math.max(0.05, p.pf ?? (motor ? 0.85 : p.type === 'r_load3' ? 0.9 : 1)));
  const eff = Math.min(1, Math.max(0.05, p.eff ?? (motor ? 0.88 : 1)));
  // 전동기는 적은 값이 축 출력이라 입력은 효율로 나눈다
  const w = base / eff;
  return { w, pf, va: w / pf, out: base };
}

export function isLightingLoad(p: Part): boolean {
  return p.lighting === true || p.type === 'r_light';
}

/** 차단기 · 퓨즈의 정격 전류 (A): 속성에 적은 값, 없으면 사양 글자에서 (AC/25A) */
export function breakerAmps(p: Part): number | null {
  if (!BREAKER.has(p.type)) return null;
  if (p.amps && p.amps > 0) return p.amps;
  const m = /(\d+(?:\.\d+)?)\s*A\b/i.exec(p.spec ?? '');
  return m ? Number(m[1]) : null;
}

export function isBreaker(p: Part): boolean {
  return BREAKER.has(p.type);
}

// ───────────────────────── 그래프 ─────────────────────────

interface Seg {
  wire: string;
  a: number;
  b: number;
  drawn: number;
  /** 케이블 번호 (-1 = 임피던스 없는 선) */
  cable: number;
}

interface Cable {
  spec: CableSpec;
  wires: string[];
  drawn: number;
  z: C;
  /** 양 끝 점 */
  ends: number[];
}

interface LoadDef {
  part: Part;
  nodes: number[];
  three: boolean;
  /** 한 갈래의 어드미턴스 */
  y: C;
  /** 전원이 정상일 때 단자 사이 전압 (전압강하의 기준) */
  vSup: number;
  rating: { w: number; pf: number; va: number; out: number };
}

export interface LoadState {
  /** 단자 전압 (3상은 선간) */
  v: number;
  /** 전류 (3상은 가장 큰 상) */
  i: number;
  /** 유효 전력 (W) */
  p: number;
}

export interface PowerState {
  shorted: boolean;
  /** 전선 (그린 선) 마다 전류 (A) */
  wireI: Map<string, number>;
  /** 접점이 있는 부품마다 가장 큰 극의 전류 (A) */
  partI: Map<string, number>;
  loads: Map<string, LoadState>;
  /** 전원 극마다 내보내는 전류 (A) */
  supply: Map<string, number>;
  /** 점의 전압 (기준 0 V 에 대한 크기) */
  voltAt: (x: number, y: number) => number | null;
}

const key = (p: Pt) => `${p[0]},${p[1]}`;

export class PowerModel {
  readonly vln: number;
  readonly vll: number;
  private readonly nodeOf = new Map<string, number>();
  readonly pts: Pt[] = [];
  readonly segs: Seg[] = [];
  readonly cables: Cable[] = [];
  readonly poles: { c: Conductor; a: number; b: number }[] = [];
  readonly loads: LoadDef[] = [];
  private readonly srcs: { node: number; pole: string }[] = [];
  private readonly smps: { part: Part; p: number; m: number }[] = [];
  /** 점마다: 전원에서 오는 길의 마지막 차단기, 케이블 길이 합 (m), 전원에서의 거리 (칸 수) */
  readonly prot: (Part | null)[] = [];
  readonly pathLen: number[] = [];
  readonly depth: number[] = [];
  /** 점에 있는 단자 이름 (기기 기호 + 단자 번호) 과 기기 기호 */
  readonly pinName = new Map<number, string>();
  readonly pinDev = new Map<number, string>();
  private readonly phasor: Record<string, C>;

  constructor(
    readonly circuit: Circuit,
    readonly model: CircuitModel,
  ) {
    // 선간 전압을 따로 적지 않으면 380/220 V 계통 (상전압 220 V 기준)
    this.vln = circuit.vll && circuit.vll > 0 ? circuit.vll / Math.sqrt(3) : 220;
    this.vll = this.vln * Math.sqrt(3);
    const v = this.vln;
    const s = Math.sqrt(3) / 2;
    this.phasor = { L1: [v, 0], L2: [-v / 2, -v * s], L3: [-v / 2, v * s], N: [0, 0], PE: [0, 0], '+24V': [24, 0], '0V': [0, 0] };

    const node = (p: Pt): number => {
      const k = key(p);
      let i = this.nodeOf.get(k);
      if (i === undefined) {
        i = this.pts.length;
        this.nodeOf.set(k, i);
        this.pts.push(p);
      }
      return i;
    };
    const pinNode = new Map<string, number>();
    const pinsAt = new Set<number>();
    for (const p of circuit.parts) {
      if (p.type === 'text' || p.type === 'r_panel') continue;
      const defs = partPins(p);
      pinPositions(p).forEach((pt, i) => {
        if (defs[i]?.air) return;
        const n = node(pt);
        pinNode.set(`${p.id}:${i}`, n);
        pinsAt.add(n);
        const dev = p.tag.trim() || (p.type === 'src' || p.type === 'r_term' ? p.pole ?? 'L' : partKindName(p.type));
        if (!this.pinName.has(n)) {
          this.pinName.set(n, [dev, p.type === 'src' || p.type === 'r_term' ? '' : defs[i]?.label ?? ''].filter(Boolean).join(' '));
          // 전원 단자는 극마다 다른 기기로 보지 않고 '전원' 하나로 (3상 세 가닥을 한 줄로 묶기 위해)
          this.pinDev.set(n, p.type === 'src' || p.type === 'r_term' || p.type === 'src3' ? tr('전원', 'Supply') : dev);
        }
      });
    }
    // 공압 배관은 뺀다
    const wires = circuit.wires.filter((w) => {
      const n = model.net.wireNet.get(w.id);
      return n === undefined || !model.airNets.has(n);
    });
    const ends = new Map<number, Wire[]>();
    for (const w of wires) for (const e of [w.a, w.b]) ends.set(node(e), [...(ends.get(node(e)) ?? []), w]);
    const all = this.pts.map((p, i) => ({ p, i }));
    const onInterior = new Set<number>();
    const cuts = new Map<string, number[]>();
    for (const w of wires) {
      const horiz = w.a[1] === w.b[1];
      const lo = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
      const hi = horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      const fixed = horiz ? w.a[1] : w.a[0];
      const list = [node(w.a), node(w.b)];
      for (const { p, i } of all) {
        if (horiz ? p[1] === fixed && p[0] > lo && p[0] < hi : p[0] === fixed && p[1] > lo && p[1] < hi) {
          list.push(i);
          onInterior.add(i);
        }
      }
      const pos = (i: number) => (horiz ? this.pts[i][0] : this.pts[i][1]);
      cuts.set(w.id, list.sort((x, y) => pos(x) - pos(y)));
    }
    // 케이블: 규격이 같은 선이 모퉁이 (선 끝 둘만 만나는 점) 로 이어진 한 가닥
    const group = new Map<string, string>();
    const find = (id: string): string => {
      const p = group.get(id) ?? id;
      if (p === id) return id;
      const r = find(p);
      group.set(id, r);
      return r;
    };
    const live = (w: Wire) => !!w.cable && w.cable.len > 0 && w.cable.mm2 > 0;
    for (const [n, ws] of ends) {
      if (ws.length !== 2 || pinsAt.has(n) || onInterior.has(n)) continue;
      const [a, b] = ws;
      if (a.id !== b.id && live(a) && live(b) && JSON.stringify(a.cable) === JSON.stringify(b.cable)) group.set(find(a.id), find(b.id));
    }
    const cableOf = new Map<string, number>();
    for (const w of wires) {
      if (!live(w)) continue;
      const root = find(w.id);
      let ci = cableOf.get(root);
      if (ci === undefined) {
        ci = this.cables.length;
        cableOf.set(root, ci);
        this.cables.push({ spec: w.cable!, wires: [], drawn: 0, z: cableZ(w.cable!), ends: [] });
      }
      cableOf.set(w.id, ci);
      const c = this.cables[ci];
      c.wires.push(w.id);
      c.drawn += Math.abs(w.a[0] - w.b[0]) + Math.abs(w.a[1] - w.b[1]);
    }
    for (const w of wires) {
      const list = cuts.get(w.id)!;
      const ci = cableOf.get(w.id) ?? -1;
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1], list[i]];
        const drawn = Math.abs(this.pts[a][0] - this.pts[b][0]) + Math.abs(this.pts[a][1] - this.pts[b][1]);
        if (drawn > 0) this.segs.push({ wire: w.id, a, b, drawn, cable: ci });
      }
    }
    for (const c of this.cables) {
      const count = new Map<number, number>();
      for (const w of wires.filter((x) => c.wires.includes(x.id))) for (const e of [w.a, w.b]) count.set(node(e), (count.get(node(e)) ?? 0) + 1);
      c.ends = [...count].filter(([, k]) => k === 1).map(([n]) => n);
    }

    // 접점 (극), 전원, 부하
    for (const c of model.conductors) {
      const a = pinNode.get(`${c.part.id}:${c.ia}`);
      const b = pinNode.get(`${c.part.id}:${c.ib}`);
      if (a !== undefined && b !== undefined && a !== b) this.poles.push({ c, a, b });
    }
    for (const p of circuit.parts) {
      const pin = (i: number) => pinNode.get(`${p.id}:${i}`)!;
      if (p.type === 'src' || p.type === 'r_term') this.srcs.push({ node: pin(0), pole: POLE_IDENTITY[p.pole ?? 'L'] });
      else if (p.type === 'src3') ['L1', 'L2', 'L3'].forEach((id, i) => this.srcs.push({ node: pin(i), pole: id }));
      else if (p.type === 'smps') this.smps.push({ part: p, p: pin(2), m: pin(3) });
    }
    const hasAc = this.srcs.some((s) => s.pole !== '+24V' && s.pole !== '0V');
    const reach = this.staticPoles();
    for (const p of circuit.parts) {
      const def = PARTS[p.type];
      if (!def.load) continue;
      const rating = loadRating(p);
      if (!rating) continue;
      const three = THREE.has(p.type);
      const idx = three ? [0, 1, 2] : def.selfCoil ?? [0, 1];
      const nodes = idx.map((i) => pinNode.get(`${p.id}:${i}`)!);
      if (nodes.some((n) => n === undefined)) continue;
      let vSup = three ? this.vll : hasAc ? this.vln : 24;
      if (!three) {
        // 두 단자가 닿는 전원 극으로 정상 전압을 정한다 (L-N 220, L-L 380, 직류 24)
        const [A, B] = idx.map((i) => reach(model.net.pinNet.get(`${p.id}:${i}`)!));
        // 한쪽이 중성선 (N · 0V) 인 짝을 먼저 본다 (정역 회로처럼 여러 상이 닿을 수 있는 단자)
        let toNeutral = 0;
        let between = 0;
        for (const a of A) {
          for (const b of B) {
            if (a === b) continue;
            const v = cabs(csub(this.phasor[a] ?? [0, 0], this.phasor[b] ?? [0, 0]));
            if (a === 'N' || b === 'N' || a === '0V' || b === '0V') toNeutral = Math.max(toNeutral, v);
            else between = Math.max(between, v);
          }
        }
        if (toNeutral > 0 || between > 0) vSup = toNeutral > 0 ? toNeutral : between;
      }
      const vRated = p.volt && p.volt > 0 ? p.volt : vSup;
      // S = V²/|Z| (3상 Y 는 선간 전압으로), 뒤진 역률이면 유도성
      const yAbs = rating.va / (vRated * vRated);
      const sin = Math.sqrt(Math.max(0, 1 - rating.pf * rating.pf));
      this.loads.push({ part: p, nodes, three, y: [yAbs * rating.pf, -yAbs * sin], vSup, rating });
    }
    this.buildPaths();
  }

  /** 접점을 모두 닫힌 것으로 볼 때, 넷이 닿는 전원 극 */
  private staticPoles(): (net: number) => string[] {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      const p = parent.get(i);
      if (p === undefined || p === i) return i;
      const r = find(p);
      parent.set(i, r);
      return r;
    };
    for (const k of this.model.conductors) {
      const [a, b] = [find(k.a), find(k.b)];
      if (a !== b) parent.set(a, b);
    }
    const poles = new Map<number, Set<string>>();
    for (const s of this.model.sources) {
      const g = find(s.net);
      poles.set(g, (poles.get(g) ?? new Set()).add(s.id));
    }
    if (this.smps.length) {
      for (const s of this.model.smpsList) {
        poles.set(find(s.outP), (poles.get(find(s.outP)) ?? new Set()).add('+24V'));
        poles.set(find(s.outM), (poles.get(find(s.outM)) ?? new Set()).add('0V'));
      }
    }
    return (net) => [...(poles.get(find(net)) ?? [])];
  }

  /** 전원에서 퍼져 나가며: 지나온 마지막 차단기, 케이블 길이 */
  private buildPaths(): void {
    const n = this.pts.length;
    const adj: { to: number; part?: Part; len: number }[][] = Array.from({ length: n }, () => []);
    for (const s of this.segs) {
      const len = s.cable >= 0 ? (this.cables[s.cable].spec.len * s.drawn) / Math.max(1e-9, this.cables[s.cable].drawn) : 0;
      adj[s.a].push({ to: s.b, len });
      adj[s.b].push({ to: s.a, len });
    }
    for (const p of this.poles) {
      adj[p.a].push({ to: p.b, part: p.c.part, len: 0 });
      adj[p.b].push({ to: p.a, part: p.c.part, len: 0 });
    }
    for (let i = 0; i < n; i++) {
      this.prot.push(null);
      this.pathLen.push(0);
      this.depth.push(Infinity);
    }
    // N · PE · 0V 쪽에서 거슬러 오는 길은 차단기 판정에 쓰지 않도록 상 (L · +24V) 에서 먼저 퍼진다
    const order = [...this.srcs].sort((a, b) => Number(a.pole === 'N' || a.pole === 'PE' || a.pole === '0V') - Number(b.pole === 'N' || b.pole === 'PE' || b.pole === '0V'));
    const queue: number[] = [];
    for (const s of order) {
      if (this.depth[s.node] !== Infinity) continue;
      this.depth[s.node] = 0;
      queue.push(s.node);
    }
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      for (const e of adj[u]) {
        if (this.depth[e.to] !== Infinity) continue;
        this.depth[e.to] = this.depth[u] + 1;
        this.prot[e.to] = e.part && BREAKER.has(e.part.type) ? e.part : this.prot[u];
        this.pathLen[e.to] = this.pathLen[u] + e.len;
        queue.push(e.to);
      }
    }
  }

  /** 케이블을 보호하는 차단기 (전원 쪽 끝에서 가장 가까운 것) */
  cableBreaker(ci: number): Part | null {
    const c = this.cables[ci];
    const nodes = this.segs.filter((s) => s.cable === ci).flatMap((s) => [s.a, s.b]);
    let best = -1;
    for (const nd of nodes.length ? nodes : c.ends) if (best < 0 || this.depth[nd] < this.depth[best]) best = nd;
    return best < 0 ? null : this.prot[best];
  }

  /** 케이블 양 끝: [단자 이름, 기기 기호] (전원 쪽이 먼저) */
  cableEnds(ci: number): { name: string; dev: string }[] {
    const c = this.cables[ci];
    const ends = [...c.ends].sort((a, b) => this.depth[a] - this.depth[b]);
    const end = (n: number | undefined) => ({ name: n === undefined ? '' : this.pinName.get(n) ?? tr('분기점', 'junction'), dev: n === undefined ? '' : this.pinDev.get(n) ?? tr('분기점', 'junction') });
    return [end(ends[0]), end(ends[ends.length - 1])];
  }

  /** 그 순간의 상태에서 전류 · 전압을 푼다 */
  solve(sim: CircuitSim): PowerState {
    const n = this.pts.length;
    const out: PowerState = { shorted: false, wireI: new Map(), partI: new Map(), loads: new Map(), supply: new Map(), voltAt: () => null };
    // 1) 임피던스 0 으로 이어진 점 묶기
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    interface Ideal {
      a: number;
      b: number;
      seg: number;
      pole: number;
    }
    const ideal: Ideal[] = [];
    this.segs.forEach((s, i) => s.cable < 0 && ideal.push({ a: s.a, b: s.b, seg: i, pole: -1 }));
    this.poles.forEach((p, i) => sim.conductorClosed(p.c) && ideal.push({ a: p.a, b: p.b, seg: -1, pole: i }));
    for (const e of ideal) {
      const [ra, rb] = [find(e.a), find(e.b)];
      if (ra !== rb) parent[ra] = rb;
    }
    // 2) 전압이 정해진 묶음 (전원). 한 묶음에 서로 다른 전압이 닿으면 단락
    const srcs = [...this.srcs];
    for (const s of this.smps) if (sim.powered.get(s.part.id)) srcs.push({ node: s.p, pole: '+24V' }, { node: s.m, pole: '0V' });
    const fixed = new Map<number, C>();
    for (const s of srcs) {
      const r = find(s.node);
      const v = this.phasor[s.pole] ?? [0, 0];
      const cur = fixed.get(r);
      if (cur && cabs(csub(cur, v)) > 1e-6) {
        out.shorted = true;
        return out;
      }
      fixed.set(r, v);
    }
    // 3) 임피던스 요소: 케이블 토막, 부하. 미지수 = 전압이 정해지지 않은 묶음 + 3상 부하의 중성점
    const unknown = new Map<number, number>();
    const idx = (r: number) => {
      if (fixed.has(r)) return -1;
      let i = unknown.get(r);
      if (i === undefined) {
        i = unknown.size;
        unknown.set(r, i);
      }
      return i;
    };
    interface El {
      a: number;
      b: number;
      y: C;
    }
    const els: El[] = [];
    const segEl = new Map<number, number>();
    this.segs.forEach((s, i) => {
      if (s.cable < 0) return;
      const c = this.cables[s.cable];
      const f = s.drawn / Math.max(1e-9, c.drawn);
      const z: C = [Math.max(1e-9, c.z[0] * f), c.z[1] * f];
      const [a, b] = [find(s.a), find(s.b)];
      if (a === b) return;
      segEl.set(i, els.length);
      els.push({ a, b, y: cinv(z) });
    });
    const loadEl: number[][] = [];
    let star = n;
    for (const l of this.loads) {
      const roots = l.nodes.map(find);
      if (l.three) {
        const s = star++;
        loadEl.push(roots.map((r) => els.push({ a: r, b: s, y: l.y }) - 1));
      } else if (roots[0] !== roots[1]) loadEl.push([els.push({ a: roots[0], b: roots[1], y: l.y }) - 1]);
      else loadEl.push([]);
    }
    for (const e of els) {
      idx(e.a);
      idx(e.b);
    }
    const m = unknown.size;
    const A: Float64Array[] = Array.from({ length: m }, () => new Float64Array(2 * (m + 1)));
    const addY = (i: number, j: number, y: C) => {
      A[i][2 * j] += y[0];
      A[i][2 * j + 1] += y[1];
    };
    const volt = (r: number): C => fixed.get(r) ?? [0, 0];
    for (const e of els) {
      const [i, j] = [idx(e.a), idx(e.b)];
      if (i >= 0) addY(i, i, e.y);
      if (j >= 0) addY(j, j, e.y);
      if (i >= 0 && j >= 0) {
        addY(i, j, [-e.y[0], -e.y[1]]);
        addY(j, i, [-e.y[0], -e.y[1]]);
      } else if (i >= 0) addY(i, m, cmul(e.y, volt(e.b)));
      else if (j >= 0) addY(j, m, cmul(e.y, volt(e.a)));
    }
    // 어디에도 닿지 않은 마디가 행렬을 깨지 않도록 아주 작은 누설
    for (let i = 0; i < m; i++) A[i][2 * i] += 1e-9;
    const x = solveComplex(A, m);
    const V = (r: number): C => {
      const f = fixed.get(r);
      if (f) return f;
      const i = unknown.get(r);
      return i === undefined ? [0, 0] : x[i];
    };
    // 4) 요소 전류, 점마다 임피던스 요소로 나가는 전류
    const demand: C[] = Array.from({ length: n }, () => [0, 0] as C);
    const segI = new Float64Array(this.segs.length);
    for (const [si, ei] of segEl) {
      const s = this.segs[si];
      const e = els[ei];
      const cur = cmul(csub(V(e.a), V(e.b)), e.y);
      segI[si] = cabs(cur);
      demand[s.a] = cadd(demand[s.a], cur);
      demand[s.b] = csub(demand[s.b], cur);
    }
    this.loads.forEach((l, li) => {
      const el = loadEl[li];
      if (!el.length) {
        out.loads.set(l.part.id, { v: 0, i: 0, p: 0 });
        return;
      }
      let iMax = 0;
      let p = 0;
      el.forEach((ei, k) => {
        const e = els[ei];
        const dv = csub(V(e.a), V(e.b));
        const cur = cmul(dv, e.y);
        iMax = Math.max(iMax, cabs(cur));
        p += dv[0] * cur[0] + dv[1] * cur[1];
        const nd = l.nodes[k];
        demand[nd] = cadd(demand[nd], cur);
        if (!l.three) demand[l.nodes[1]] = csub(demand[l.nodes[1]], cur);
      });
      const tv = l.nodes.map((nd) => V(find(nd)));
      const v = l.three ? (cabs(csub(tv[0], tv[1])) + cabs(csub(tv[1], tv[2])) + cabs(csub(tv[2], tv[0]))) / 3 : cabs(csub(tv[0], tv[1]));
      out.loads.set(l.part.id, { v, i: iMax, p });
    });
    // 5) 임피던스 0 인 선 · 접점의 전류: 전원에서 퍼지는 나무를 따라 아래쪽 전류의 합
    const adj: { to: number; e: number }[][] = Array.from({ length: n }, () => []);
    ideal.forEach((e, i) => {
      adj[e.a].push({ to: e.b, e: i });
      adj[e.b].push({ to: e.a, e: i });
    });
    const seen = new Uint8Array(n);
    const order: number[] = [];
    const up = new Int32Array(n).fill(-1);
    const upEdge = new Int32Array(n).fill(-1);
    const rootPole = new Map<number, string>();
    const bfs = (root: number) => {
      seen[root] = 1;
      let q = order.length;
      order.push(root);
      for (; q < order.length; q++) {
        const u = order[q];
        for (const a of adj[u]) {
          if (seen[a.to]) continue;
          seen[a.to] = 1;
          up[a.to] = u;
          upEdge[a.to] = a.e;
          order.push(a.to);
        }
      }
    };
    for (const s of srcs) {
      if (seen[s.node]) continue;
      rootPole.set(s.node, s.pole);
      bfs(s.node);
    }
    for (let i = 0; i < n; i++) if (!seen[i] && adj[i].length) bfs(i);
    const sub: C[] = demand.map((d) => [d[0], d[1]] as C);
    const flow = new Float64Array(ideal.length);
    for (let q = order.length - 1; q >= 0; q--) {
      const u = order[q];
      if (up[u] >= 0) {
        flow[upEdge[u]] = cabs(sub[u]);
        sub[up[u]] = cadd(sub[up[u]], sub[u]);
      } else if (rootPole.has(u)) out.supply.set(rootPole.get(u)!, (out.supply.get(rootPole.get(u)!) ?? 0) + cabs(sub[u]));
    }
    ideal.forEach((e, i) => {
      if (e.seg >= 0) segI[e.seg] = flow[i];
      else {
        const id = this.poles[e.pole].c.part.id;
        out.partI.set(id, Math.max(out.partI.get(id) ?? 0, flow[i]));
      }
    });
    this.segs.forEach((s, i) => out.wireI.set(s.wire, Math.max(out.wireI.get(s.wire) ?? 0, segI[i])));
    out.voltAt = (px, py) => {
      const nd = this.nodeOf.get(`${px},${py}`);
      return nd === undefined ? null : cabs(V(find(nd)));
    };
    return out;
  }

  /** 상태가 같으면 다시 풀지 않도록: 닫힌 접점과 전원 상태의 서명 */
  signature(sim: CircuitSim): string {
    let s = '';
    for (const p of this.poles) s += sim.conductorClosed(p.c) ? '1' : '0';
    for (const p of this.smps) s += sim.powered.get(p.part.id) ? 'P' : 'p';
    return s;
  }
}

/** 복소 연립방정식 (부분 피벗 가우스 소거). A 는 m × (m+1) 확대 행렬, 한 칸이 [실수, 허수] */
function solveComplex(A: Float64Array[], m: number): C[] {
  for (let col = 0; col < m; col++) {
    let piv = col;
    let best = 0;
    for (let r = col; r < m; r++) {
      const mag = Math.hypot(A[r][2 * col], A[r][2 * col + 1]);
      if (mag > best) {
        best = mag;
        piv = r;
      }
    }
    if (best < 1e-300) continue;
    if (piv !== col) [A[piv], A[col]] = [A[col], A[piv]];
    const inv = cinv([A[col][2 * col], A[col][2 * col + 1]]);
    for (let r = col + 1; r < m; r++) {
      const f = cmul([A[r][2 * col], A[r][2 * col + 1]], inv);
      if (f[0] === 0 && f[1] === 0) continue;
      for (let k = col; k <= m; k++) {
        const a = A[col][2 * k];
        const b = A[col][2 * k + 1];
        A[r][2 * k] -= f[0] * a - f[1] * b;
        A[r][2 * k + 1] -= f[0] * b + f[1] * a;
      }
    }
  }
  const x: C[] = Array.from({ length: m }, () => [0, 0] as C);
  for (let r = m - 1; r >= 0; r--) {
    let s: C = [A[r][2 * m], A[r][2 * m + 1]];
    for (let k = r + 1; k < m; k++) s = csub(s, cmul([A[r][2 * k], A[r][2 * k + 1]], x[k]));
    const d: C = [A[r][2 * r], A[r][2 * r + 1]];
    x[r] = cabs(d) < 1e-300 ? [0, 0] : cmul(s, cinv(d));
  }
  return x;
}

// ───────────────────────── 검토 (조작 순서 전체에서 가장 나쁜 값) ─────────────────────────

export interface CableRow {
  id: number;
  /** 같은 규격으로 같은 두 기기를 잇는 가닥 수 (3상 급전선은 3) */
  count: number;
  wires: string[];
  from: string;
  to: string;
  spec: CableSpec;
  text: string;
  /** 허용전류 (보정 후), 표 값, 보정계수 */
  iz: number | null;
  /** 가장 클 때의 전류 */
  ib: number;
  /** 이 케이블에서 떨어지는 전압 (V, 한 가닥) */
  dv: number;
  breaker: string;
  breakerAmps: number | null;
}

export interface LoadRow {
  partId: string;
  tag: string;
  name: string;
  /** 정격 (W), 역률 */
  watt: number;
  pf: number;
  three: boolean;
  lighting: boolean;
  /** 정상 전압, 가장 낮을 때의 단자 전압, 가장 클 때의 전류 */
  vSup: number;
  v: number | null;
  i: number;
  dropPct: number | null;
  limit: number;
  /** 전원에서 오는 케이블 길이 합 (m) */
  len: number;
}

export interface BreakerRow {
  partId: string;
  tag: string;
  amps: number | null;
  i: number;
}

export interface PowerIssue {
  level: 'error' | 'warn' | 'info';
  msg: string;
  partIds: string[];
  wireIds: string[];
}

export interface PowerAnalysis {
  shorted: boolean;
  cables: CableRow[];
  loads: LoadRow[];
  breakers: BreakerRow[];
  issues: PowerIssue[];
  /** 전원 극마다 가장 클 때의 전류 */
  supply: { pole: string; i: number }[];
  /** 가장 클 때의 유효 전력 합 (kW) */
  peakKw: number;
  panels: { partId: string; name: string; kw: number; loads: number }[];
  wireI: Map<string, number>;
  vll: number;
  vln: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 전압강하 허용값 (%) - KEC 232.3.9 표: 저압 수전 조명 3 · 기타 5, 고압 이상 수전 조명 6 · 기타 8. 100 m 를 넘는 부분은 m 당 0.005%, 0.5% 까지 */
export function dropLimit(supply: 'lv' | 'hv' | undefined, lighting: boolean, len: number): number {
  const base = supply === 'hv' ? (lighting ? 6 : 8) : lighting ? 3 : 5;
  return base + Math.min(0.5, Math.max(0, len - 100) * 0.005);
}

export function analyzePower(c: Circuit, model: CircuitModel = new CircuitModel(c)): PowerAnalysis {
  const pm = new PowerModel(c, model);
  const wireI = new Map<string, number>();
  const partI = new Map<string, number>();
  const loadMax = new Map<string, { i: number; v: number | null }>();
  const supply = new Map<string, number>();
  let shorted = false;
  let peak = 0;
  let last: string | null = null;
  const up = (m: Map<string, number>, k: string, v: number) => v > (m.get(k) ?? 0) && m.set(k, v);
  const useful = pm.loads.length > 0;
  if (useful) {
    runScenario(c, model, (sim) => {
      const sig = pm.signature(sim);
      if (sig === last) return;
      last = sig;
      if (sim.shorted) {
        shorted = true;
        return;
      }
      const st = pm.solve(sim);
      if (st.shorted) {
        shorted = true;
        return;
      }
      for (const [k, v] of st.wireI) up(wireI, k, v);
      for (const [k, v] of st.partI) up(partI, k, v);
      for (const [k, v] of st.supply) up(supply, k, v);
      let p = 0;
      for (const l of pm.loads) {
        const s = st.loads.get(l.part.id);
        if (!s) continue;
        p += s.p;
        const cur = loadMax.get(l.part.id) ?? { i: 0, v: null };
        cur.i = Math.max(cur.i, s.i);
        // 켜져 있을 때 (정상 전압의 절반 이상) 가장 낮은 전압
        if (s.v > 0.5 * l.vSup) cur.v = cur.v === null ? s.v : Math.min(cur.v, s.v);
        loadMax.set(l.part.id, cur);
      }
      peak = Math.max(peak, p);
    });
  }
  const issues: PowerIssue[] = [];
  // 같은 규격으로 같은 두 기기를 잇는 가닥 (3상 급전선의 세 가닥) 은 한 줄로 묶어 가장 큰 전류로 본다
  const grouped = new Map<string, CableRow & { ends: { name: string; dev: string }[] }>();
  pm.cables.forEach((cb, id) => {
    const ib = Math.max(0, ...cb.wires.map((w) => wireI.get(w) ?? 0));
    const br = pm.cableBreaker(id);
    const ends = pm.cableEnds(id);
    const k = `${ends[0].dev}\u0000${ends[1].dev}\u0000${JSON.stringify(cb.spec)}\u0000${br?.id ?? ''}`;
    const row = grouped.get(k);
    if (row) {
      row.count++;
      row.wires.push(...cb.wires);
      row.ib = Math.max(row.ib, ib);
    } else grouped.set(k, { id, count: 1, wires: [...cb.wires], from: '', to: '', ends, spec: cb.spec, text: cableText(cb.spec), iz: cableIz(cb.spec), ib, dv: 0, breaker: br?.tag ?? '', breakerAmps: br ? breakerAmps(br) : null });
  });
  const cables: CableRow[] = [...grouped.values()].map(({ ends, ...row }) => {
    const z = cableZ(row.spec);
    const many = row.count > 1;
    // 부스바는 양 끝이 분기점이라 이름 대신 '부스바 (위쪽 차단기)' 로
    if (row.spec.kind === 'bus') return { ...row, from: tr('부스바', 'Busbar'), to: `${row.breaker ? tr(`${row.breaker} 아래`, `below ${row.breaker}`) : ''}${many ? ` (${tr(`${row.count}가닥`, `×${row.count}`)})` : ''}`.trim(), ib: r2(row.ib), dv: r2(row.ib * Math.hypot(z[0], z[1])) };
    return { ...row, from: many ? ends[0].dev : ends[0].name, to: many ? `${ends[1].dev} (${tr(`${row.count}가닥`, `×${row.count}`)})` : ends[1].name, ib: r2(row.ib), dv: r2(row.ib * Math.hypot(z[0], z[1])) };
  });
  for (const cb of cables) {
    const name = `${cb.from || '?'} → ${cb.to || '?'}`;
    const br = cb.breaker ? c.parts.filter((p) => p.tag === cb.breaker && isBreaker(p)).map((p) => p.id) : [];
    if (cb.iz === null) {
      issues.push({ level: 'info', msg: tr(`${name}: 허용전류 표에 없는 규격입니다 (${cb.text})`, `${name}: no ampacity table entry (${cb.text})`), partIds: [], wireIds: cb.wires });
      continue;
    }
    if (cb.ib > cb.iz + 1e-6) issues.push({ level: 'error', msg: tr(`${name}: 전류 ${r1(cb.ib)} A 가 허용전류 ${cb.iz} A 를 넘습니다 (${cb.text}). 더 굵은 전선이 필요합니다`, `${name}: ${r1(cb.ib)} A exceeds the ampacity ${cb.iz} A (${cb.text})`), partIds: [], wireIds: cb.wires });
    if (cb.breakerAmps !== null && cb.breakerAmps > cb.iz + 1e-6)
      issues.push({
        level: 'error',
        msg: tr(`${name}: 차단기 ${cb.breaker} 정격 ${cb.breakerAmps} A 가 전선 허용전류 ${cb.iz} A 보다 큽니다. 과부하 때 전선이 먼저 탑니다 (In ≤ Iz 가 되게)`, `${name}: breaker ${cb.breaker} ${cb.breakerAmps} A is above the cable ampacity ${cb.iz} A (need In ≤ Iz)`),
        partIds: br,
        wireIds: cb.wires,
      });
  }
  const breakers: BreakerRow[] = c.parts
    .filter(isBreaker)
    .map((p) => ({ partId: p.id, tag: p.tag, amps: breakerAmps(p), i: r2(partI.get(p.id) ?? 0) }))
    .filter((b) => b.i > 0.005 || b.amps !== null);
  for (const b of breakers) {
    if (b.amps !== null && b.i > b.amps + 1e-6) issues.push({ level: 'error', msg: tr(`${b.tag}: 흐르는 전류 ${r1(b.i)} A 가 차단기 정격 ${b.amps} A 를 넘습니다 (과부하로 트립)`, `${b.tag}: ${r1(b.i)} A exceeds the breaker rating ${b.amps} A`), partIds: [b.partId], wireIds: [] });
  }
  const loads: LoadRow[] = pm.loads
    .filter((l) => l.rating.w >= 20 || l.part.watt !== undefined)
    .map((l) => {
      const mx = loadMax.get(l.part.id) ?? { i: 0, v: null };
      const len = Math.max(...l.nodes.map((nd) => pm.pathLen[nd] ?? 0));
      const lighting = isLightingLoad(l.part);
      const dropPct = mx.v === null ? null : r2(((l.vSup - mx.v) / l.vSup) * 100);
      return { partId: l.part.id, tag: l.part.tag, name: l.part.name ?? '', watt: l.rating.out, pf: l.rating.pf, three: l.three, lighting, vSup: l.vSup, v: mx.v === null ? null : r1(mx.v), i: r2(mx.i), dropPct, limit: dropLimit(c.supply, lighting, len), len: r1(len) };
    });
  for (const l of loads) {
    if (l.dropPct !== null && l.dropPct > l.limit + 1e-6)
      issues.push({
        level: 'error',
        msg: tr(`${l.tag}: 전압강하 ${l.dropPct}% 가 허용값 ${r2(l.limit)}% (${l.lighting ? '조명' : '기타'}) 를 넘습니다. 단자 전압 ${l.v} V`, `${l.tag}: voltage drop ${l.dropPct}% exceeds ${r2(l.limit)}% (${l.lighting ? 'lighting' : 'other'}); ${l.v} V at the terminals`),
        partIds: [l.partId],
        wireIds: [],
      });
  }
  if (shorted) issues.unshift({ level: 'error', msg: tr('단락이 있어 그 순간의 전류는 계산하지 않았습니다', 'A short circuit was found; currents were not computed for that state'), partIds: [], wireIds: [] });
  if (loads.length && !pm.cables.length) issues.push({ level: 'info', msg: tr('전선을 누르고 케이블 규격 (굵기 · 공사방법 · 길이) 을 정하면 허용전류와 전압강하를 검토합니다', 'Select a wire and set its cable spec to check ampacity and voltage drop'), partIds: [], wireIds: [] });
  const panels = c.parts
    .filter((p) => p.type === 'r_panel')
    .map((p) => {
      const [w, h] = panelSize(p);
      const inside = pm.loads.filter((l) => l.part.x >= p.x && l.part.x <= p.x + w && l.part.y >= p.y && l.part.y <= p.y + h && (l.rating.w >= 20 || l.part.watt !== undefined));
      return { partId: p.id, name: [p.tag, p.name].filter(Boolean).join(' '), kw: r2(inside.reduce((s, l) => s + l.rating.out, 0) / 1000), loads: inside.length };
    });
  const order = ['L1', 'L2', 'L3', 'N', 'PE', '+24V', '0V'];
  return {
    shorted,
    cables,
    loads,
    breakers,
    issues,
    supply: [...supply].map(([pole, i]) => ({ pole, i: r2(i) })).sort((a, b) => order.indexOf(a.pole) - order.indexOf(b.pole)),
    peakKw: r2(peak / 1000),
    panels,
    wireI,
    vll: pm.vll,
    vln: pm.vln,
  };
}
