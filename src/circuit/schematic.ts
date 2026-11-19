import type { Circuit, Part, PartType, Rot, Wire } from './types';
import { CircuitModel, type Conductor } from './engine';
import { PARTS, POLE_SYSTEM, partPins, partPoles, PROX_TYPES, REAL, tempSetting } from './parts';
import { tr } from '../i18n';

/**
 * 실물 배선도 → 회로도 (전개 접속도).
 *
 * 그림의 선이 아니라 넷 (어느 단자끼리 이어졌나) 만 보고 다시 그린다.
 *  - 조작 회로: 부하 (코일 · 램프 …) 마다 걸리는 두 극 (L1-N, +24V-0V …) 으로 묶고, 묶음마다 전원 H 와 귀선 R 사이의 접점 · 부하를
 *    직렬 · 병렬 식으로 줄인 뒤 (`reduce`) 위 → 아래로 세운 사다리로 그린다. 직렬 · 병렬로 줄지 않는 회로 (브리지) 는
 *    부하마다 H 에서 오는 길을 모두 나란히 그린다 (같은 기호의 접점이 여러 번 나올 수 있다).
 *  - 주회로 (3상): 전원 → 차단기 → 전자접촉기 → THR → 전동기를 줄 (row) 로 놓고, 줄 사이를 넷마다 가로 선 (lane) 으로 잇는다.
 * 기호가 같으면 실물과 같이 움직이므로 (코일 MC1 ↔ 접점 MC1) 같은 조작 순서로 시뮬레이션한 타임차트가 실물 배선도와 같아야 한다.
 */

export interface SchematicResult {
  circuit: Circuit;
  /** 그리지 못했거나 바꿔 그린 것 */
  notes: string[];
}

/** 열 하나의 폭 (칸) */
const COL = 6;

interface Sym {
  type: PartType;
  tag: string;
  extra: Partial<Part>;
}

type Kind = 'contact' | 'load' | 'prox' | 'smps';

interface Elem {
  id: number;
  a: number;
  b: number;
  kind: Kind;
  sym: Sym;
  /** 원래 부품 (정렬 · 이름) */
  src: Part;
  /** 3선식 센서: 0V (BU) 단자의 넷 */
  bu?: number;
  /** 실물 단자 번호 (a 쪽, b 쪽) */
  ta?: string;
  tb?: string;
}

/** 실물 단자 이름에서 번호만 (13NO → 13, 1/L1 → 1) */
const termNo = (label: string | undefined) => (label ?? '').replace(/(NO|NC)$/, '').replace(/\/.*$/, '');

type Expr = { t: 'e'; e: Elem; rev: boolean } | { t: 's'; xs: Expr[] } | { t: 'p'; xs: Expr[] };

const H = -1;
const R = -2;

const live = (id: string) => POLE_SYSTEM[id] === 'ac' || POLE_SYSTEM[id] === 'dc';
const neutral = (id: string) => id === 'N' || id === '0V';

class Uf {
  readonly p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.p[x] = y;
  }
}

// ───────────────────────── 식 ─────────────────────────

function reverse(x: Expr): Expr {
  if (x.t === 'e') return { ...x, rev: !x.rev };
  if (x.t === 's') return { t: 's', xs: x.xs.map(reverse).reverse() };
  return { t: 'p', xs: x.xs.map(reverse) };
}

function ser(xs: Expr[]): Expr {
  const flat = xs.flatMap((x) => (x.t === 's' ? x.xs : [x]));
  return flat.length === 1 ? flat[0] : { t: 's', xs: flat };
}

function par(xs: Expr[]): Expr {
  const flat = xs.flatMap((x) => (x.t === 'p' ? x.xs : [x]));
  return flat.length === 1 ? flat[0] : { t: 'p', xs: flat };
}

function elems(x: Expr): Elem[] {
  return x.t === 'e' ? [x.e] : x.xs.flatMap(elems);
}

const hasKind = (x: Expr, k: Kind | Kind[]) => elems(x).some((e) => (Array.isArray(k) ? k.includes(e.kind) : e.kind === k));
const hasLoad = (x: Expr) => hasKind(x, ['load', 'smps']);

/** 두 끝 (H, R) 사이의 그래프를 직렬 · 병렬로 줄인다. 다 줄지 않으면 null */
function reduce(edges: { u: number; v: number; x: Expr }[]): Expr | null {
  let es = edges.filter((e) => e.u !== e.v);
  for (let guard = 0; guard < 10000; guard++) {
    let changed = false;
    // 병렬: 같은 두 마디 사이
    const byPair = new Map<string, number[]>();
    es.forEach((e, i) => {
      const k = e.u < e.v ? `${e.u},${e.v}` : `${e.v},${e.u}`;
      byPair.set(k, [...(byPair.get(k) ?? []), i]);
    });
    for (const idx of byPair.values()) {
      if (idx.length < 2) continue;
      const first = es[idx[0]];
      const xs = idx.map((i) => (es[i].u === first.u ? es[i].x : reverse(es[i].x)));
      const keep = new Set(idx.slice(1));
      es = es.filter((_, i) => !keep.has(i));
      es[es.indexOf(first)] = { u: first.u, v: first.v, x: par(xs) };
      changed = true;
      break;
    }
    if (changed) continue;
    // 직렬: 끝이 아닌 마디에 선이 둘
    const deg = new Map<number, number[]>();
    es.forEach((e, i) => {
      deg.set(e.u, [...(deg.get(e.u) ?? []), i]);
      deg.set(e.v, [...(deg.get(e.v) ?? []), i]);
    });
    for (const [n, idx] of deg) {
      if (n === H || n === R) continue;
      if (idx.length === 1) {
        es = es.filter((_, i) => i !== idx[0]);
        changed = true;
        break;
      }
      if (idx.length !== 2) continue;
      const [e1, e2] = [es[idx[0]], es[idx[1]]];
      const a = e1.v === n ? e1 : { u: e1.v, v: e1.u, x: reverse(e1.x) };
      const b = e2.u === n ? e2 : { u: e2.v, v: e2.u, x: reverse(e2.x) };
      const merged = { u: a.u, v: b.v, x: ser([a.x, b.x]) };
      es = es.filter((_, i) => i !== idx[0] && i !== idx[1]);
      if (merged.u !== merged.v) es.push(merged);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  if (es.length !== 1) return null;
  const e = es[0];
  if (e.u === H && e.v === R) return e.x;
  if (e.u === R && e.v === H) return reverse(e.x);
  return null;
}

/** 끝점 (terminals) 사이의 단순 경로에 들어가는 선만 남긴다 (블록 · 절단점 나무에서 끝점이 없는 잎을 떼어 냄) */
function useful(edges: { u: number; v: number }[], terminals: Set<number>): Set<number> {
  const adj = new Map<number, { to: number; e: number }[]>();
  edges.forEach((e, i) => {
    if (e.u === e.v) return;
    adj.set(e.u, [...(adj.get(e.u) ?? []), { to: e.v, e: i }]);
    adj.set(e.v, [...(adj.get(e.v) ?? []), { to: e.u, e: i }]);
  });
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const stack: number[] = [];
  const blocks: number[][] = [];
  let time = 0;
  const dfs = (u: number, pe: number) => {
    disc.set(u, ++time);
    low.set(u, time);
    for (const { to, e } of adj.get(u) ?? []) {
      if (e === pe) continue;
      if (!disc.has(to)) {
        stack.push(e);
        dfs(to, e);
        low.set(u, Math.min(low.get(u)!, low.get(to)!));
        if (low.get(to)! >= disc.get(u)!) {
          const b: number[] = [];
          for (;;) {
            const x = stack.pop()!;
            b.push(x);
            if (x === e) break;
          }
          blocks.push(b);
        }
      } else if (disc.get(to)! < disc.get(u)!) {
        stack.push(e);
        low.set(u, Math.min(low.get(u)!, disc.get(to)!));
      }
    }
  };
  for (const v of adj.keys()) if (!disc.has(v)) dfs(v, -1);
  const verts = blocks.map((b) => new Set(b.flatMap((i) => [edges[i].u, edges[i].v])));
  const count = new Map<number, number>();
  for (const vs of verts) for (const v of vs) count.set(v, (count.get(v) ?? 0) + 1);
  const art = new Set([...count].filter(([, n]) => n > 1).map(([v]) => v));
  // 나무: 블록 i ↔ 절단점 v
  const tree = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    tree.set(a, (tree.get(a) ?? new Set()).add(b));
    tree.set(b, (tree.get(b) ?? new Set()).add(a));
  };
  verts.forEach((vs, i) => {
    tree.set(`b${i}`, tree.get(`b${i}`) ?? new Set());
    for (const v of vs) if (art.has(v)) link(`b${i}`, `a${v}`);
  });
  const marked = (k: string) => (k[0] === 'a' ? terminals.has(Number(k.slice(1))) : [...verts[Number(k.slice(1))]].some((v) => terminals.has(v) && !art.has(v)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [k, nb] of tree) {
      if (nb.size <= 1 && !marked(k)) {
        for (const o of nb) tree.get(o)!.delete(k);
        tree.delete(k);
        changed = true;
      }
    }
  }
  const out = new Set<number>();
  blocks.forEach((b, i) => tree.has(`b${i}`) && b.forEach((e) => out.add(e)));
  return out;
}

// ───────────────────────── 그리기 ─────────────────────────

class Drawer {
  readonly parts: Part[] = [];
  readonly wires: Wire[] = [];
  private n = 0;
  part(type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}, rot: Rot = 0): Part {
    const p: Part = { id: `sp${this.n++}`, type, x, y, rot, tag, ...extra };
    this.parts.push(p);
    return p;
  }
  wire(a: [number, number], b: [number, number]): void {
    if (a[0] === b[0] && a[1] === b[1]) return;
    this.wires.push({ id: `sw${this.n++}`, a, b });
  }
  /** 꺾인 선 */
  path(...pts: [number, number][]): void {
    for (let i = 1; i < pts.length; i++) this.wire(pts[i - 1], pts[i]);
  }
}

function size(x: Expr): { w: number; h: number } {
  if (x.t === 'e') return { w: 1, h: 5 };
  const s = x.xs.map(size);
  if (x.t === 's') return { w: Math.max(...s.map((q) => q.w)), h: s.reduce((a, q) => a + q.h, 0) };
  return { w: s.reduce((a, q) => a + q.w, 0), h: Math.max(...s.map((q) => q.h)) + 2 };
}

interface Placed {
  /** 3선식 센서의 BU: 귀선 레일로 내릴 점 */
  drops: [number, number][];
  /** SMPS 출력 (+V, -V) */
  smps: { plus: [number, number]; minus: [number, number] }[];
}

function place(x: Expr, cx: number, cy: number, H0: number, d: Drawer, out: Placed): void {
  if (x.t === 'e') {
    const e = x.e;
    if (e.kind === 'smps') {
      // 90° 돌려 L · N 이 이 열에, +V · -V 가 왼쪽으로 나오게
      d.wire([cx, cy], [cx, cy + 1]);
      d.part(e.sym.type, cx - 2, cy + 2, e.sym.tag, e.sym.extra, 90);
      d.wire([cx, cy + 3], [cx, cy + H0]);
      out.smps.push({ plus: [cx - 4, cy + 1], minus: [cx - 4, cy + 3] });
      return;
    }
    const top = e.kind === 'load' ? cy + H0 - 5 : cy;
    d.wire([cx, cy], [cx, top + 1]);
    const [ta, tb] = x.rev ? [e.tb, e.ta] : [e.ta, e.tb];
    d.part(e.sym.type, cx, top + 3, e.sym.tag, { ...e.sym.extra, ...(ta && tb && e.kind !== 'prox' ? { term: `${ta}-${tb}` } : {}) });
    d.wire([cx, top + 5], [cx, cy + H0]);
    if (e.kind === 'prox') out.drops.push([cx + 2, top + 5]);
    return;
  }
  if (x.t === 's') {
    const ss = x.xs.map(size);
    const total = ss.reduce((a, q) => a + q.h, 0);
    let j = x.xs.findIndex(hasLoad);
    if (j < 0) j = x.xs.length - 1;
    let y = cy;
    x.xs.forEach((c, i) => {
      const h = ss[i].h + (i === j ? H0 - total : 0);
      place(c, cx, y, h, d, out);
      y += h;
    });
    return;
  }
  const ss = x.xs.map(size);
  let col = cx;
  const xs: number[] = [];
  x.xs.forEach((c, i) => {
    xs.push(col);
    d.wire([col, cy], [col, cy + 1]);
    place(c, col, cy + 1, H0 - 2, d, out);
    d.wire([col, cy + H0 - 1], [col, cy + H0]);
    col += ss[i].w * COL;
  });
  d.wire([cx, cy], [xs[xs.length - 1], cy]);
  d.wire([cx, cy + H0], [xs[xs.length - 1], cy + H0]);
}

/** 병렬 가지의 차례: SMPS 가 든 가지는 맨 왼쪽, 부하가 든 가지는 원래 그림의 왼쪽부터, 접점만 있으면 조작 기기 먼저 */
function order(x: Expr, operators: Set<string>): Expr {
  if (x.t === 'e') return x;
  const xs = x.xs.map((c) => order(c, operators));
  if (x.t === 's') return { t: 's', xs };
  const key = (c: Expr) => {
    const es = elems(c);
    if (es.some((e) => e.kind === 'smps')) return -1e9;
    const loads = es.filter((e) => e.kind === 'load');
    if (loads.length) return Math.min(...loads.map((e) => e.src.x)) + 1e6;
    const op = es.some((e) => operators.has(e.sym.tag.toUpperCase()));
    return (op ? 0 : 1e5) + Math.min(...es.map((e) => e.src.x));
  };
  return { t: 'p', xs: [...xs].sort((a, b) => key(a) - key(b)) };
}

// ───────────────────────── 기호 고르기 ─────────────────────────

const MAIN_PART = new Set<PartType>(['r_mcb3', 'r_mcb4', 'r_mc', 'r_thr', 'mcb3', 'km3', 'ol3', 'fuse3']);
const THREE_LOAD = new Set<PartType>(['r_motor3', 'r_motor6', 'r_load3', 'motor3']);
/** 회로도로 바꾸지 않는 기기 */
const UNSUPPORTED: Partial<Record<PartType, string>> = {
  plc: 'PLC',
  r_plc: 'PLC',
  r_hmi: 'HMI',
  r_tsw: tr('타임 스위치', 'time switch'),
  r_counter: tr('카운터', 'counter'),
  r_tc: tr('온도 조절기', 'temperature controller'),
  r_kepco: tr('한전 수전점', 'utility supply'),
  r_vcb: 'VCB',
  r_tr3: tr('변압기', 'transformer'),
  v32: tr('공압 밸브', 'pneumatic valve'),
  v52: tr('공압 밸브', 'pneumatic valve'),
  v52d: tr('공압 밸브', 'pneumatic valve'),
  v53: tr('공압 밸브', 'pneumatic valve'),
  air: tr('공압원', 'air supply'),
};
/** 온도 기기의 온도 변화 설정 (묶음 · 연결 부하 · 속도) */
const TEMP_KEYS = ['zone', 'tLoad', 'tLoadCool', 'amb', 'tmax', 'rise', 'fall'] as const;
/** 선과 같은 것 (단자대 · 바 · 전류계) */
const WIRE_LIKE = new Set<PartType>(['r_tb', 'r_nbar', 'r_am']);

function poleIndex(k: Conductor): number {
  return (partPoles(k.part) ?? []).findIndex(([i, j]) => i === k.ia && j === k.ib);
}

/** 접점 하나를 회로 기호로 */
function contactSym(k: Conductor): Sym | null {
  const p = k.part;
  const tag = p.tag.trim();
  const idx = poleIndex(k);
  const nc = k.nc;
  const keep = <K extends keyof Part>(...keys: K[]) => Object.fromEntries(keys.filter((x) => p[x] !== undefined).map((x) => [x, p[x]])) as Partial<Part>;
  switch (p.type) {
    case 'r_pb':
    case 'r_pbl':
    case 'r_fsw':
      return { type: nc ? 'pb_nc' : 'pb_no', tag, extra: keep('color') };
    case 'r_ss':
    case 'r_sw':
    case 'r_sw3':
      return { type: nc ? 'sw_nc' : 'sw_no', tag, extra: {} };
    case 'r_ss3':
      return { type: 'sw_no', tag, extra: { sel: idx === 0 ? -1 : 1, ...keep('pos3') } };
    case 'r_estop':
      return { type: nc ? 'estop' : 'sw_no', tag, extra: {} };
    case 'r_ls':
      return { type: nc ? 'ls_nc' : 'ls_no', tag, extra: keep('cyl', 'end') };
    case 'r_float':
      return { type: nc ? 'ls_nc' : 'ls_no', tag, extra: { sense: 'float' } };
    case 'r_thermo':
      return { type: nc ? 'ls_nc' : 'ls_no', tag, extra: { sense: 'temp', sv: tempSetting(p).sv, hys: tempSetting(p).hys, ...keep('name', ...TEMP_KEYS) } };
    case 'r_prox2':
      return { type: nc ? 'ls_nc' : 'ls_no', tag, extra: { sense: p.sense ?? 'inductive', ...keep('cyl', 'end') } };
    case 'r_psw':
      return { type: nc ? 'ls_nc' : 'ls_no', tag, extra: { sense: 'pressure' } };
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
    case 'r_mcb4':
      return { type: 'mcb', tag, extra: keep('elb', 'idn', 'amps', 'spec') };
    case 'r_fuse':
      return { type: 'fuse', tag, extra: {} };
    case 'r_mc':
    case 'r_thr':
    case 'r_relay8':
    case 'r_my2':
    case 'r_my4':
    case 'r_ssr':
      return { type: nc ? 'nc' : 'no', tag, extra: {} };
    case 'r_timer8':
      return { type: nc ? 'nc' : 'no', tag, extra: k.inst ? { inst13: true } : {} };
    case 'pb_no':
    case 'pb_nc':
    case 'sw_no':
    case 'sw_nc':
    case 'estop':
    case 'ls_no':
    case 'ls_nc':
    case 'no':
    case 'nc':
    case 'mcb':
    case 'fuse':
      return { type: p.type, tag, extra: keep('color', 'sense', 'cyl', 'end', 'inst13', 'sel', 'pos3', 'sv', 'hys', ...TEMP_KEYS) };
    default:
      return null;
  }
}

/** 부하 하나를 회로 기호로 */
function loadSym(p: Part): Sym | null {
  const tag = p.tag.trim();
  const keep = <K extends keyof Part>(...keys: K[]) => Object.fromEntries(keys.filter((x) => p[x] !== undefined).map((x) => [x, p[x]])) as Partial<Part>;
  switch (p.type) {
    case 'r_mc':
    case 'r_relay8':
    case 'r_my2':
    case 'r_my4':
    case 'r_ssr':
      return { type: 'coil', tag, extra: keep('name') };
    case 'r_timer8':
      return { type: 'timer', tag, extra: keep('name', 'timerMode', 'preset', 'presetOff') };
    case 'r_lamp':
    case 'r_pbl':
    case 'r_light':
      return { type: 'lamp', tag, extra: { ...keep('name'), color: p.color ?? (p.type === 'r_light' ? 'yellow' : 'red') } };
    case 'r_buzzer':
      return { type: 'buzzer', tag, extra: keep('name') };
    case 'r_sol':
      return { type: 'sol', tag, extra: keep('name') };
    case 'r_fan':
    case 'r_load1':
      return { type: 'load', tag, extra: keep('name', 'watt', 'pf') };
    case 'coil':
    case 'timer':
    case 'lamp':
    case 'buzzer':
    case 'sol':
    case 'motor':
    case 'load':
      return { type: p.type, tag, extra: keep('name', 'timerMode', 'preset', 'presetOff', 'color', 'watt', 'pf') };
    default:
      return null;
  }
}

// ───────────────────────── 바꾸기 ─────────────────────────

/** 실물 배선도를 회로도 (회로 기호) 로 다시 그린다 */
export function toSchematic(c: Circuit): SchematicResult {
  const notes: string[] = [];
  const m = new CircuitModel(c);
  const n = m.net.count;
  const pinNet = (p: Part, i: number) => m.net.pinNet.get(`${p.id}:${i}`)!;

  for (const [type, name] of Object.entries(UNSUPPORTED)) {
    const ids = c.parts.filter((p) => p.type === type).map((p) => p.tag || name);
    if (ids.length) notes.push(tr(`${name} (${[...new Set(ids)].join(', ')}) 은(는) 회로도 기호가 없어 그리지 않았습니다`, `${name} (${[...new Set(ids)].join(', ')}) has no schematic symbol and was left out`));
  }

  // 단자대 · 바 · 전류계는 선과 같다
  const wf = new Uf(n);
  for (const k of m.conductors) if (WIRE_LIKE.has(k.part.type)) wf.union(k.a, k.b);
  const node = (net: number) => wf.find(net);

  // 마디마다 닿은 전원 극 (SMPS 출력 포함)
  const srcPoles = new Map<number, Set<string>>();
  const addSrc = (x: number, id: string) => srcPoles.set(node(x), (srcPoles.get(node(x)) ?? new Set()).add(id));
  for (const s of m.sources) addSrc(s.net, s.id);
  for (const s of m.smpsList) {
    addSrc(s.outP, '+24V');
    addSrc(s.outM, '0V');
  }
  // 원래 전원 단자의 극 표기 (L / L1 …)
  const poleLabel = new Map<string, string>();
  for (const p of c.parts) if ((p.type === 'r_term' || p.type === 'src') && p.pole) poleLabel.set(p.pole === 'L' ? 'L1' : p.pole, p.pole);

  // 요소
  let eid = 0;
  const contacts: Elem[] = [];
  const loads: Elem[] = [];
  for (const k of m.conductors) {
    if (WIRE_LIKE.has(k.part.type) || k.plcOut !== undefined || UNSUPPORTED[k.part.type]) continue;
    if (PROX_TYPES.has(k.part.type)) {
      const p = k.part;
      const sym: Sym = { type: 'prox', tag: p.tag.trim(), extra: { ...(p.sense ? { sense: p.sense } : {}), ...(p.npn ? { npn: true } : {}), ...(p.cyl ? { cyl: p.cyl, end: p.end } : {}) } };
      if (p.npn) {
        notes.push(tr(`${p.tag}: NPN 센서는 회로도에서 PNP 처럼 그렸습니다 (출력이 0V 쪽)`, `${p.tag}: NPN sensor drawn like a PNP`));
        continue;
      }
      contacts.push({ id: eid++, a: node(k.a), b: node(k.b), kind: 'prox', sym, src: p, bu: node(pinNet(p, 2)) });
      continue;
    }
    const sym = contactSym(k);
    if (!sym) continue;
    const pp = partPins(k.part);
    contacts.push({ id: eid++, a: node(k.a), b: node(k.b), kind: 'contact', sym, src: k.part, ...(REAL.has(k.part.type) ? { ta: termNo(pp[k.ia]?.label), tb: termNo(pp[k.ib]?.label) } : {}) });
  }
  const three: Part[] = [];
  for (const p of m.loads) {
    if (THREE_LOAD.has(p.type)) {
      three.push(p);
      continue;
    }
    const sym = loadSym(p);
    if (!sym) continue;
    const def = PARTS[p.type];
    const [i, j] = def.selfCoil ?? def.loadPins ?? [0, 1];
    const pp = partPins(p);
    loads.push({ id: eid++, a: node(pinNet(p, i)), b: node(pinNet(p, j)), kind: 'load', sym, src: p, ...(REAL.has(p.type) ? { ta: termNo(pp[i]?.label), tb: termNo(pp[j]?.label) } : {}) });
  }
  for (const s of m.smpsList) {
    const p = s.part;
    loads.push({ id: eid++, a: node(s.inL), b: node(s.inN), kind: 'smps', sym: { type: 'smps', tag: p.tag.trim(), extra: p.name ? { name: p.name } : {} }, src: p });
  }

  // 모든 접점을 닫았을 때 닿는 극 → 부하마다 (H, R)
  const all = new Uf(n);
  for (const e of contacts) all.union(e.a, e.b);
  const reach = new Map<number, Set<string>>();
  for (const [x, ids] of srcPoles) for (const id of ids) reach.set(all.find(x), (reach.get(all.find(x)) ?? new Set()).add(id));
  const poles = (x: number) => reach.get(all.find(x)) ?? new Set<string>();
  const groups = new Map<string, { h: string; r: string; loads: Elem[] }>();
  for (const e of loads) {
    const [A, B] = [poles(e.a), poles(e.b)];
    let best: [string, string] | null = null;
    let score = -1;
    for (const [P, Q] of [
      [A, B],
      [B, A],
    ])
      for (const h of P)
        for (const r of Q) {
          if (h === r || !live(h) || !live(r) || POLE_SYSTEM[h] !== POLE_SYSTEM[r] || neutral(h)) continue;
          const s = (neutral(r) ? 2 : 1) + (h < r ? 0.1 : 0);
          if (s > score) [best, score] = [[h, r], s];
        }
    if (!best) {
      notes.push(tr(`${e.src.tag || PARTS[e.src.type].prefix}: 전원 두 극 사이에 이어지지 않아 빠졌습니다`, `${e.src.tag}: not connected across the supply, left out`));
      continue;
    }
    const k = best.join('|');
    const g = groups.get(k) ?? { h: best[0], r: best[1], loads: [] };
    g.loads.push(e);
    groups.set(k, g);
  }

  const operators = new Set([...m.tagKind].filter(([, k]) => k === 'operator' || k === 'thr').map(([t]) => t));
  const d = new Drawer();
  const usedTags = new Set<string>();
  const named = new Set<string>();
  /** 조작 기기 · 부하의 설명은 기호마다 한 번만 */
  const withName = (e: Elem): Sym => {
    const t = e.sym.tag.toUpperCase();
    usedTags.add(t);
    if (e.kind === 'contact' && operators.has(t) && !named.has(t) && e.src.name) {
      named.add(t);
      return { ...e.sym, extra: { ...e.sym.extra, name: e.src.name } };
    }
    if (e.kind !== 'contact' && e.src.name && !named.has(`L:${e.id}`)) return { ...e.sym, extra: { ...e.sym.extra, name: e.src.name } };
    return e.sym;
  };

  // ── 조작 회로: 묶음마다 식
  interface Ladder {
    h: string;
    r: string;
    x: Expr;
    dc: boolean;
    /** SMPS 출력으로 먹는 직류 */
    fed: boolean;
  }
  const ladders: Ladder[] = [];
  for (const g of groups.values()) {
    const Hn = new Set([...srcPoles].filter(([, ids]) => ids.has(g.h)).map(([x]) => x));
    const Rn = new Set([...srcPoles].filter(([, ids]) => ids.has(g.r)).map(([x]) => x));
    const other = new Set([...srcPoles].filter(([x, ids]) => !Hn.has(x) && !Rn.has(x) && [...ids].some((id) => id !== g.h && id !== g.r)).map(([x]) => x));
    const map = (x: number) => (Hn.has(x) ? H : Rn.has(x) ? R : x);
    const cand = [...contacts, ...g.loads].filter((e) => !other.has(e.a) && !other.has(e.b));
    const es = cand.map((e) => ({ u: map(e.a), v: map(e.b), e }));
    const keep = useful(es, new Set([H, R]));
    const kept = es.filter((_, i) => keep.has(i));
    let x = reduce(kept.map((q) => ({ u: q.u, v: q.v, x: { t: 'e', e: q.e, rev: false } as Expr })));
    if (!x) {
      // 브리지: 부하마다 H → 부하 → R 길을 모두 나란히
      notes.push(tr(`${g.h}-${g.r} 회로가 직렬 · 병렬로 정리되지 않아, 부하마다 길을 나란히 그렸습니다 (같은 접점이 여러 번 나옴)`, `The ${g.h}-${g.r} circuit is not series-parallel; each load is drawn with all its paths`));
      x = bridgeFallback(kept, g.loads);
    }
    if (!x) {
      notes.push(tr(`${g.h}-${g.r} 회로를 그리지 못했습니다`, `Could not draw the ${g.h}-${g.r} circuit`));
      continue;
    }
    const got = new Set(elems(x).map((e) => e.id));
    const lost = g.loads.filter((e) => !got.has(e.id));
    if (lost.length) notes.push(tr(`${lost.map((e) => e.src.tag).join(', ')}: 전원까지 가는 길을 찾지 못해 빠졌습니다`, `${lost.map((e) => e.src.tag).join(', ')}: no path to the supply`));
    for (const e of elems(x)) if (e.kind === 'prox' && map(e.bu!) !== R) notes.push(tr(`${e.src.tag}: 센서 0V (BU) 가 이 회로의 ${g.r} 에 바로 이어지지 않아 ${g.r} 로 그렸습니다`, `${e.src.tag}: sensor 0V drawn on ${g.r}`));
    const fed = g.h === '+24V' && [...Hn].some((x2) => m.smpsList.some((s) => node(s.outP) === x2));
    ladders.push({ h: g.h, r: g.r, x: order(x, operators), dc: POLE_SYSTEM[g.h] === 'dc', fed });
  }

  // ── 주회로
  const main = drawMain(m, node, srcPoles, three, d, notes);
  for (const t of main.tags) usedTags.add(t);

  // ── 배치: 주회로 → 직류 (SMPS 로 먹는 것) → 교류 · 그 밖
  const Y0 = 3;
  let x0 = main.right + 6;
  const placedDc: { ladder: Ladder; x: number; top: number; bottom: number; railEnd: number }[] = [];
  const sorted = [...ladders].sort((a, b) => Number(b.fed) - Number(a.fed) || Number(b.dc) - Number(a.dc));
  const smpsOuts: Placed['smps'] = [];
  for (const L of sorted) {
    const sz = size(L.x);
    // SMPS 를 품은 교류 사다리는 왼쪽에 SMPS 몸통과 출력 선 자리를 둔다
    const hasSmps = hasKind(L.x, 'smps');
    if (hasSmps) x0 += 8;
    const out: Placed = { drops: [], smps: [] };
    const rename = (x: Expr): Expr => (x.t === 'e' ? { ...x, e: { ...x.e, sym: withName(x.e) } } : { ...x, xs: x.xs.map(rename) });
    place(rename(L.x), x0, Y0, sz.h, d, out);
    const bottom = Y0 + sz.h;
    const railEnd = x0 + (sz.w - 1) * COL + 3;
    d.wire([x0, bottom], [railEnd, bottom]);
    for (const [x, y] of out.drops) d.wire([x, y], [x, bottom]);
    if (!L.fed) {
      d.part('src', x0, Y0, '', { pole: (poleLabel.get(L.h) ?? L.h) as Part['pole'] });
      d.part('src', railEnd, bottom, '', { pole: (poleLabel.get(L.r) ?? L.r) as Part['pole'] });
    }
    if (L.fed) placedDc.push({ ladder: L, x: x0, top: Y0, bottom, railEnd });
    smpsOuts.push(...out.smps);
    x0 = railEnd + 6;
  }
  // SMPS 출력 → 직류 사다리 (위: +V → 맨 위 왼쪽, 아래: -V → 레일 오른쪽 끝)
  if (smpsOuts.length && placedDc.length) {
    const s = smpsOuts[0];
    const dc = placedDc[0];
    const xb = s.plus[0] - 2;
    const xa = s.plus[0] - 3;
    d.path(s.plus, [xb, s.plus[1]], [xb, dc.top - 2], [dc.x, dc.top - 2], [dc.x, dc.top]);
    d.path(s.minus, [xa, s.minus[1]], [xa, dc.bottom + 2], [dc.railEnd, dc.bottom + 2], [dc.railEnd, dc.bottom]);
    if (smpsOuts.length > 1 || placedDc.length > 1) notes.push(tr('SMPS 가 여럿이면 첫 번째만 직류 회로에 이었습니다', 'Only the first SMPS is connected to the DC circuit'));
  } else
    for (const dc of placedDc) {
      d.part('src', dc.x, dc.top, '', { pole: '+24V' });
      d.part('src', dc.railEnd, dc.bottom, '', { pole: '0V' });
    }

  // 조작 순서에 나오는데 회로도에 없는 조작 기기는 따로 놓는다 (조작이 그대로 먹게)
  let sx = x0;
  for (const o of c.ops) {
    const t = o.tag.trim().toUpperCase();
    if (!t || usedTags.has(t)) continue;
    const p = c.parts.find((q) => q.tag.trim().toUpperCase() === t && (operators.has(t) || q.type === 'r_thr'));
    if (!p) continue;
    usedTags.add(t);
    const type: PartType = PARTS[p.type].operate === 'momentary' ? 'pb_no' : 'sw_no';
    d.part(type, sx, Y0 + 4, p.tag.trim(), p.name ? { name: p.name } : {});
    sx += COL;
  }

  const title = c.parts.find((p) => p.type === 'text' && p.text?.trim())?.text?.trim();
  d.part('text', 0, -2, '', { text: tr(`회로도 (실물 배선도에서 자동 생성)${title ? `: ${title}` : ''}`, `Schematic (generated from the wiring diagram)${title ? `: ${title}` : ''}`) });
  const out: Circuit = { parts: d.parts, wires: d.wires, ops: c.ops.map((o) => ({ ...o })) };
  if (c.duration) out.duration = c.duration;
  if (c.clock) out.clock = c.clock;
  if (c.system) out.system = c.system;
  if (c.vll) out.vll = c.vll;
  if (c.supply) out.supply = c.supply;
  if (c.relayMs) out.relayMs = c.relayMs;
  if (c.earthing) out.earthing = c.earthing;
  if (c.ra) out.ra = c.ra;
  if (c.rb) out.rb = c.rb;
  // 회로도에 그리지 않는 콘센트에 누전 조작이 있으면 알린다
  for (const o of c.ops) {
    if (o.action !== 'leak') continue;
    const p = c.parts.find((q) => q.tag.trim().toUpperCase() === o.tag.trim().toUpperCase());
    if (p?.type === 'r_outlet') notes.push(tr(`콘센트 ${p.tag} 는 회로도에 그리지 않아 그 누전 조작은 빠집니다`, `Outlet ${p.tag} is not drawn in the schematic; its earth-fault step is dropped`));
  }
  return { circuit: out, notes: [...new Set(notes)] };
}

/** 직렬 · 병렬로 줄지 않을 때: 부하마다 H → 부하 앞, 부하 뒤 → R 의 단순 경로를 모두 나란히 */
function bridgeFallback(es: { u: number; v: number; e: Elem }[], loads: Elem[]): Expr | null {
  const contacts = es.filter((q) => q.e.kind !== 'load' && q.e.kind !== 'smps');
  const adj = new Map<number, { to: number; x: Expr }[]>();
  for (const q of contacts) {
    const x: Expr = { t: 'e', e: q.e, rev: false };
    adj.set(q.u, [...(adj.get(q.u) ?? []), { to: q.v, x }]);
    adj.set(q.v, [...(adj.get(q.v) ?? []), { to: q.u, x: reverse(x) }]);
  }
  const paths = (from: number, to: number): Expr[] => {
    const res: Expr[] = [];
    const seen = new Set([from]);
    const walk = (u: number, acc: Expr[]) => {
      if (res.length >= 24) return;
      if (u === to) {
        res.push(acc.length ? ser(acc) : { t: 's', xs: [] });
        return;
      }
      for (const { to: v, x } of adj.get(u) ?? []) {
        if (seen.has(v) || (v !== to && (v === H || v === R))) continue;
        seen.add(v);
        walk(v, [...acc, x]);
        seen.delete(v);
      }
    };
    walk(from, []);
    return res;
  };
  const rungs: Expr[] = [];
  for (const q of es.filter((q) => q.e.kind === 'load' || q.e.kind === 'smps')) {
    if (!loads.some((l) => l.id === q.e.id) && q.e.kind !== 'smps') continue;
    for (const [a, b, rev] of [
      [q.u, q.v, false],
      [q.v, q.u, true],
    ] as const) {
      const up = paths(H, a).filter((p) => p.t !== 's' || p.xs.length);
      const down = paths(b, R).filter((p) => p.t !== 's' || p.xs.length);
      const upOk = a === H || up.length;
      const downOk = b === R || down.length;
      if (!upOk || !downOk) continue;
      const parts: Expr[] = [];
      if (a !== H) parts.push(par(up));
      parts.push({ t: 'e', e: q.e, rev });
      if (b !== R) parts.push(par(down));
      rungs.push(ser(parts));
      break;
    }
  }
  return rungs.length ? par(rungs) : null;
}

// ───────────────────────── 주회로 ─────────────────────────

interface Dev {
  part: Part;
  /** 그릴 기호 */
  type: PartType;
  /** 극마다 [전원 쪽 넷, 부하 쪽 넷] (부하 쪽이 없으면 -1) */
  poles: [number, number][];
  row: number;
  x: number;
  y: number;
}

function drawMain(m: CircuitModel, node: (n: number) => number, srcPoles: Map<number, Set<string>>, three: Part[], d: Drawer, notes: string[]): { right: number; tags: Set<string> } {
  const tags = new Set<string>();
  if (!three.length) return { right: 0, tags };
  const phases = ['L1', 'L2', 'L3'];
  const srcNode = new Map<string, number>();
  for (const [x, ids] of srcPoles) for (const id of ids) if (phases.includes(id) && !srcNode.has(id)) srcNode.set(id, x);
  if (phases.some((p) => !srcNode.has(p))) {
    notes.push(tr('3상 전원 (L1 · L2 · L3) 이 다 있지 않아 주회로를 그리지 않았습니다', 'No complete 3-phase supply: main circuit left out'));
    return { right: 0, tags };
  }
  const pinNet = (p: Part, i: number) => node(m.net.pinNet.get(`${p.id}:${i}`)!);
  // 주회로 후보: 3극 기기의 상 극 + 3상 부하
  const cand: { u: number; v: number; part: Part; k: number }[] = [];
  for (const k of m.conductors) {
    if (!MAIN_PART.has(k.part.type)) continue;
    const idx = (partPoles(k.part) ?? []).findIndex(([i, j]) => i === k.ia && j === k.ib);
    if (idx < 0 || idx > 2) continue;
    cand.push({ u: node(k.a), v: node(k.b), part: k.part, k: idx });
  }
  const loadPins = (p: Part): number[] => (p.type === 'r_motor6' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]);
  // 3상 부하의 단자끼리 (권선) 도 길로 친다
  const windings: { u: number; v: number }[] = [];
  for (const p of three) {
    const ns = loadPins(p).map((i) => pinNet(p, i));
    if (p.type === 'r_motor6') windings.push({ u: ns[0], v: ns[4] }, { u: ns[1], v: ns[5] }, { u: ns[2], v: ns[3] });
    else windings.push({ u: ns[0], v: ns[1] }, { u: ns[1], v: ns[2] });
  }
  const terms = new Set<number>([...srcNode.values(), ...three.flatMap((p) => loadPins(p).map((i) => pinNet(p, i)))]);
  const graph = [...cand.map((q) => ({ u: q.u, v: q.v })), ...windings];
  const keep = useful(graph, terms);
  const mainPoles = cand.filter((_, i) => keep.has(i));
  // 전원에서 떨어진 거리 (넷)
  const dist = new Map<number, number>();
  const queue = [...srcNode.values()];
  queue.forEach((x) => dist.set(x, 0));
  const adj = new Map<number, number[]>();
  for (const e of [...mainPoles, ...windings]) {
    adj.set(e.u, [...(adj.get(e.u) ?? []), e.v]);
    adj.set(e.v, [...(adj.get(e.v) ?? []), e.u]);
  }
  for (let i = 0; i < queue.length; i++) for (const v of adj.get(queue[i]) ?? []) if (!dist.has(v)) dist.set(v, dist.get(queue[i])! + 1) && queue.push(v);
  // 기기
  const devs: Dev[] = [];
  const byPart = new Map<string, typeof mainPoles>();
  for (const q of mainPoles) byPart.set(q.part.id, [...(byPart.get(q.part.id) ?? []), q]);
  const symOf: Partial<Record<PartType, PartType>> = { r_mcb3: 'mcb3', r_mcb4: 'mcb3', mcb3: 'mcb3', r_mc: 'km3', km3: 'km3', r_thr: 'ol3', ol3: 'ol3', fuse3: 'fuse3' };
  for (const [, qs] of byPart) {
    const p = qs[0].part;
    if (qs.length !== 3) {
      notes.push(tr(`${p.tag}: 주회로에서 세 극이 다 쓰이지 않아 그리지 않았습니다`, `${p.tag}: not all three poles are used in the main circuit`));
      continue;
    }
    const poles = [...qs].sort((a, b) => a.k - b.k).map((q) => ((dist.get(q.u) ?? 1e9) <= (dist.get(q.v) ?? 1e9) ? [q.u, q.v] : [q.v, q.u]) as [number, number]);
    devs.push({ part: p, type: symOf[p.type]!, poles, row: 0, x: 0, y: 0 });
  }
  for (const p of three) {
    const ns = loadPins(p).map((i) => pinNet(p, i));
    const poles: [number, number][] = p.type === 'r_motor6' ? [0, 1, 2].map((k) => [ns[k], ns[[4, 5, 3][k]]]) : ns.map((x) => [x, -1]);
    devs.push({ part: p, type: p.type === 'r_motor3' || p.type === 'motor3' ? 'motor3' : p.type, poles, row: 0, x: 0, y: 0 });
  }
  // 줄: 전원 쪽 넷을 먹이는 기기의 다음 줄 (가장 긴 길)
  const feeds = (a: Dev, b: Dev) => a.poles.some(([, o]) => o >= 0 && b.poles.some(([i]) => i === o));
  const src: Dev = { part: { id: 'src', type: 'src3', x: 0, y: 0, rot: 0, tag: '' }, type: 'src3', poles: phases.map((ph) => [-1, srcNode.get(ph)!]), row: 0, x: 0, y: 0 };
  const rowOf = new Map<Dev, number>([[src, 0]]);
  const all = [src, ...devs];
  for (let it = 0; it < all.length + 2; it++)
    for (const dv of devs) {
      const prev = all.filter((o) => o !== dv && rowOf.has(o) && feeds(o, dv));
      if (prev.length) rowOf.set(dv, Math.max(...prev.map((o) => rowOf.get(o)!)) + 1);
    }
  if (devs.some((dv) => !rowOf.has(dv)) || devs.some((dv) => (rowOf.get(dv) ?? 0) > devs.length + 1)) {
    notes.push(tr('주회로의 연결을 줄로 정리하지 못해 그리지 않았습니다', 'Could not arrange the main circuit'));
    return { right: 0, tags };
  }
  const rows: Dev[][] = [];
  for (const dv of all) {
    dv.row = rowOf.get(dv)!;
    (rows[dv.row] ??= []).push(dv);
  }
  // 줄을 건너뛰는 넷은 사이 줄에 지나가는 선 (dummy) 을 둔다
  const origin = new Map<number, number[]>();
  const consumer = new Map<number, number[]>();
  for (const dv of all)
    for (const [i, o] of dv.poles) {
      if (i >= 0) consumer.set(i, [...(consumer.get(i) ?? []), dv.row]);
      if (o >= 0) origin.set(o, [...(origin.get(o) ?? []), dv.row]);
    }
  for (const [net, os] of origin) {
    const cs = consumer.get(net) ?? [];
    const first = Math.min(...os);
    if (cs.some((r) => r <= first)) {
      notes.push(tr('주회로에 거꾸로 올라가는 연결이 있어 그리지 않았습니다', 'The main circuit feeds back upwards; left out'));
      return { right: 0, tags };
    }
    const last = Math.max(...cs, Math.max(...os) + 1);
    for (let r = first + 1; r < last; r++) if (rows[r]) rows[r].push({ part: { id: `pass${net}:${r}`, type: 'text', x: 1e6, y: 0, rot: 0, tag: '' }, type: 'text', poles: [[net, net]], row: r, x: 0, y: 0 });
  }
  const isPass = (dv: Dev) => dv.type === 'text';
  // 기기의 단자 자리 (기호 기준, 회전 없음). 지나가는 선은 줄 높이만큼
  const rowSpan = new Map<number, number>();
  const pinsOf = (dv: Dev): { line: [number, number][]; load: [number, number][] } => {
    if (isPass(dv)) return { line: [[0, 0]], load: [[0, rowSpan.get(dv.row) ?? 4]] };
    if (dv.type === 'src3') return { line: [], load: [-2, 0, 2].map((x) => [x, 1]) };
    if (dv.type === 'r_motor6') {
      const pp = partPins({ ...dv.part, x: 0, y: 0 });
      return { line: [0, 1, 2].map((i) => [pp[i].x, pp[i].y]), load: [4, 5, 3].map((i) => [pp[i].x, pp[i].y]) };
    }
    if (dv.type === 'r_load3') return { line: [-2, 0, 2].map((x) => [x, -3]), load: [] };
    if (dv.type === 'motor3') return { line: [-2, 0, 2].map((x) => [x, -2]), load: [] };
    return { line: [-2, 0, 2].map((x) => [x, -2]), load: [-2, 0, 2].map((x) => [x, 2]) };
  };
  for (const row of rows) {
    const real = row.filter((dv) => !isPass(dv) && dv.type !== 'src3');
    const spans = real.map((dv) => {
      const p = pinsOf(dv);
      return Math.max(...[...p.load, ...p.line].map(([, y]) => y)) - Math.min(...p.line.map(([, y]) => y));
    });
    if (real.length) rowSpan.set(real[0].row, Math.max(4, ...spans));
  }
  const boxOf = (dv: Dev): readonly number[] => (dv.type === 'src3' ? [-3, -1.2, 3, 1] : isPass(dv) ? [0, 0, 0, 0] : PARTS[dv.type].box);
  // 가로 자리: 원래 그림의 왼쪽부터. 지나가는 선은 위 줄의 같은 넷 단자 x 에 (기기와 겹치면 오른쪽으로)
  let right = 0;
  const loadX = new Map<number, number>();
  for (const row of rows) {
    const real = row.filter((dv) => !isPass(dv)).sort((a, b) => a.part.x - b.part.x);
    let x = 4;
    const taken: [number, number][] = [];
    for (const dv of real) {
      const [l, , r2] = boxOf(dv);
      x = Math.max(x, Math.ceil(-l) + 1);
      dv.x = x;
      taken.push([dv.x + Math.floor(l) - 1, dv.x + Math.ceil(r2) + 1]);
      x += Math.ceil(r2 - l) + 3;
      right = Math.max(right, dv.x + Math.ceil(r2) + 4);
    }
    for (const dv of row.filter(isPass)) {
      let px = loadX.get(dv.poles[0][0]) ?? right;
      while (taken.some(([a, b]) => px >= a && px <= b)) px += 1;
      dv.x = px;
      taken.push([px - 1, px + 1]);
      right = Math.max(right, px + 3);
    }
    rows[rows.indexOf(row)] = [...real, ...row.filter(isPass)];
    for (const dv of row) pinsOf(dv).load.forEach(([px], k) => dv.poles[k][1] >= 0 && loadX.set(dv.poles[k][1], dv.x + px));
  }
  // 세로: 줄의 전원 쪽 단자를 한 높이에, 줄 사이는 넷마다 가로 선
  src.y = 0;
  let bottomPins = 1;
  // 마지막 줄 아래도 한 번 더 (Y 결선의 중성점처럼 같은 넷끼리 묶는 선)
  for (let r = 1; r <= rows.length; r++) {
    const top: { x: number; y: number; net: number }[] = [];
    for (const dv of rows[r - 1]) pinsOf(dv).load.forEach(([px, py], k) => dv.poles[k][1] >= 0 && top.push({ x: dv.x + px, y: dv.y + py, net: dv.poles[k][1] }));
    const bot: { x: number; net: number; dy: number; dv: Dev }[] = [];
    for (const dv of rows[r] ?? []) pinsOf(dv).line.forEach(([px, py], k) => bot.push({ x: dv.x + px, net: dv.poles[k][0], dy: py, dv }));
    const nets = [...new Set([...top.map((q) => q.net), ...bot.map((q) => q.net)])];
    if (bot.some((b) => !top.some((t) => t.net === b.net))) {
      notes.push(tr('주회로의 한 넷이 바로 위 줄과 이어지지 않아 주회로를 그리지 않았습니다', 'A main-circuit net does not come from the row above; left out'));
      d.parts.length = 0;
      d.wires.length = 0;
      return { right: 0, tags: new Set() };
    }
    const xsOf = (net: number) => new Set([...top.filter((q) => q.net === net).map((q) => q.x), ...bot.filter((q) => q.net === net).map((q) => q.x)]);
    const lane = nets.filter((net) => xsOf(net).size > 1);
    // 같은 x 에서 위 단자의 넷이 아래 단자의 넷보다 위 가로 선
    const before = new Map<number, Set<number>>(lane.map((x) => [x, new Set()]));
    for (const t of top)
      for (const b of bot)
        if (t.x === b.x && t.net !== b.net && lane.includes(t.net) && lane.includes(b.net)) before.get(b.net)!.add(t.net);
    const orderL: number[] = [];
    const left = new Set(lane);
    while (left.size) {
      const next = [...left].find((x) => [...before.get(x)!].every((y) => !left.has(y)));
      if (next === undefined) {
        notes.push(tr('주회로의 선이 엇갈려 정리하지 못해 주회로를 그리지 않았습니다', 'Main circuit wiring could not be untangled; left out'));
        d.parts.length = 0;
        d.wires.length = 0;
        return { right: 0, tags: new Set() };
      }
      orderL.push(next);
      left.delete(next);
    }
    const start = Math.max(...top.map((q) => q.y), bottomPins);
    const laneY = new Map(orderL.map((net, i) => [net, start + 1 + i]));
    const rowTop = start + Math.max(1, orderL.length) + 1;
    for (const dv of rows[r] ?? []) dv.y = rowTop - Math.min(...pinsOf(dv).line.map(([, py]) => py));
    for (const net of nets) {
      const ts = top.filter((q) => q.net === net);
      const bs = bot.filter((q) => q.net === net).map((q) => ({ x: q.x, y: q.dv.y + q.dy }));
      const ly = laneY.get(net);
      if (ly === undefined) {
        for (const t of ts) for (const b of bs) d.wire([t.x, t.y], [b.x, b.y]);
        continue;
      }
      const xs = [...xsOf(net)];
      d.wire([Math.min(...xs), ly], [Math.max(...xs), ly]);
      for (const t of ts) d.wire([t.x, t.y], [t.x, ly]);
      for (const b of bs) d.wire([b.x, ly], [b.x, b.y]);
    }
    if (rows[r]) bottomPins = Math.max(...rows[r].map((dv) => dv.y + Math.max(0, ...pinsOf(dv).load.map(([, py]) => py), ...pinsOf(dv).line.map(([, py]) => py))));
  }
  // 위로 올려 조작 회로 (y = 3) 와 맞춘다
  const shift = 3;
  d.part('src3', src.x, shift + src.y);
  for (const row of rows) for (const dv of row) if (isPass(dv)) d.wire([dv.x, dv.y], [dv.x, dv.y + (rowSpan.get(dv.row) ?? 4)]);
  for (const dv of devs) {
    const p = dv.part;
    const extra: Partial<Part> = {};
    if (p.name) extra.name = p.name;
    // 차단기의 누전 (ELB) · 정격: 누전 계산이 그대로 되게
    for (const k of ['elb', 'idn', 'amps', 'spec'] as const) if ((dv.type === 'mcb3' || dv.type === 'mcb') && p[k] !== undefined) Object.assign(extra, { [k]: p[k] });
    if (dv.type === 'r_motor6' || dv.type === 'r_load3') Object.assign(extra, Object.fromEntries((['spec', 'watt', 'pf', 'eff'] as const).filter((k) => p[k] !== undefined).map((k) => [k, p[k]])));
    d.part(dv.type, dv.x, dv.y + shift, p.tag.trim(), extra);
    tags.add(p.tag.trim().toUpperCase());
  }
  for (const w of d.wires) {
    // 주회로 선만 아래로 옮긴다 (조작 회로는 아직 없다)
    w.a = [w.a[0], w.a[1] + shift];
    w.b = [w.b[0], w.b[1] + shift];
  }
  return { right, tags };
}
