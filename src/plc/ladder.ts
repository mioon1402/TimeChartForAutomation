/**
 * 래더 (LD) 프로그램: 렁마다 접점 칸 (줄 × 열) 과 세로선, 줄 끝의 출력 (코일 · SET/RST · 타이머 · 카운터 · 응용 명령).
 *  - compileLadder: 래더 → 니모닉 (미쓰비시 · LS). 칸을 마디 그래프로 보고 직렬 · 병렬로 줄여 LD/AND/OR/ANB/ORB 로,
 *    출력이 여러 갈래로 나뉘면 MPS/MRD/MPP 로. 그래서 PLC 블록 · PLC 시뮬레이션은 지금처럼 니모닉을 실행한다
 *  - ilToLadder: 니모닉 → 래더 (불러온 프로그램을 래더로 보기). 래더로 그릴 수 없는 부분 (STL, 반전 등) 은
 *    "니모닉 렁" 으로 원문을 그대로 두어 되돌려도 같은 프로그램이 된다
 * 마디 (r, x): r 줄의 x 번째 경계 (x = 0 이 왼쪽 모선, x = cols 가 출력 앞). 칸 (r, c) 는 (r, c) → (r, c + 1).
 * 세로선 `${r},${x}` 은 (r, x) 와 (r + 1, x) 를 잇는다.
 */
import type { CmpOp, Instr } from './types';
import { ilCommentLines, parseIl } from './il';

export type LdContactKind = 'no' | 'nc' | 'p' | 'n' | 'cmp' | 'h';
/** 접점 칸: a · b · 상승 · 하강 접점, 비교 접점 (dev op b), 가로선 */
export interface LdCell {
  k: LdContactKind;
  dev?: string;
  op?: CmpOp;
  b?: string;
}

export type LdOutKind = 'out' | 'set' | 'rst' | 'ton' | 'tof' | 'ctu' | 'pls' | 'plf' | 'app';
/** 출력: 코일 · SET · RST · 타이머 (설정값 arg) · 카운터 · 펄스 · 응용 명령 (dev 에 명령 전체) */
export interface LdOut {
  k: LdOutKind;
  dev: string;
  arg?: string;
}

export interface LdRung {
  id: string;
  rows: number;
  /** `${r},${c}` → 칸 */
  cells: Record<string, LdCell>;
  /** 세로선 `${r},${x}` */
  vl: string[];
  /** 줄 → 출력 */
  outs: Record<string, LdOut>;
  comment?: string;
  /** 래더로 그리지 못한 렁: 니모닉 원문 줄 */
  raw?: string[];
}

export interface Ladder {
  cols: number;
  rungs: LdRung[];
  /** 디바이스 설명 (대문자 디바이스 → 글). 니모닉에는 처음 쓰인 줄 끝에 `; 설명` 으로 들어간다 */
  notes?: Record<string, string>;
}

export type LdDialect = 'mitsubishi' | 'ls';

let seq = 0;
export const rungId = () => `rg${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyRung(): LdRung {
  return { id: rungId(), rows: 1, cells: {}, vl: [], outs: {} };
}

export function emptyLadder(): Ladder {
  return { cols: 8, rungs: [emptyRung()] };
}

/** 저장된 값 → 래더 (모양이 틀리면 null) */
export function readLadder(raw: unknown): Ladder | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.rungs)) return null;
  const cols = typeof o.cols === 'number' && o.cols >= 2 && o.cols <= 40 ? Math.round(o.cols) : 8;
  const KINDS = new Set(['no', 'nc', 'p', 'n', 'cmp', 'h']);
  const OUTS = new Set(['out', 'set', 'rst', 'ton', 'tof', 'ctu', 'pls', 'plf', 'app']);
  const rungs: LdRung[] = [];
  for (const r of o.rungs) {
    if (!r || typeof r !== 'object') continue;
    const q = r as Record<string, unknown>;
    const rows = typeof q.rows === 'number' && q.rows >= 1 && q.rows <= 64 ? Math.round(q.rows) : 1;
    const rung: LdRung = { id: typeof q.id === 'string' ? q.id : rungId(), rows, cells: {}, vl: [], outs: {} };
    if (q.cells && typeof q.cells === 'object')
      for (const [k, v] of Object.entries(q.cells as Record<string, unknown>)) {
        const c = v as Record<string, unknown>;
        if (!/^\d+,\d+$/.test(k) || !c || !KINDS.has(c.k as string)) continue;
        rung.cells[k] = { k: c.k as LdContactKind, ...(typeof c.dev === 'string' ? { dev: c.dev } : {}), ...(typeof c.op === 'string' ? { op: c.op as CmpOp } : {}), ...(typeof c.b === 'string' ? { b: c.b } : {}) };
      }
    if (Array.isArray(q.vl)) rung.vl = q.vl.filter((v): v is string => typeof v === 'string' && /^\d+,\d+$/.test(v));
    if (q.outs && typeof q.outs === 'object')
      for (const [k, v] of Object.entries(q.outs as Record<string, unknown>)) {
        const c = v as Record<string, unknown>;
        if (!/^\d+$/.test(k) || !c || !OUTS.has(c.k as string)) continue;
        rung.outs[k] = { k: c.k as LdOutKind, dev: typeof c.dev === 'string' ? c.dev : '', ...(typeof c.arg === 'string' ? { arg: c.arg } : {}) };
      }
    if (typeof q.comment === 'string' && q.comment) rung.comment = q.comment;
    if (Array.isArray(q.raw)) rung.raw = q.raw.filter((v): v is string => typeof v === 'string');
    rungs.push(rung);
  }
  const notes: Record<string, string> = {};
  if (o.notes && typeof o.notes === 'object')
    for (const [k, v] of Object.entries(o.notes as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) notes[k.toUpperCase()] = v;
  return { cols, rungs, ...(Object.keys(notes).length ? { notes } : {}) };
}

// ───────────────────────── 식 (직렬 · 병렬) ─────────────────────────

export type Expr = { t: 'lit'; c: LdCell } | { t: 'and'; xs: Expr[] } | { t: 'or'; xs: Expr[] };

const lit = (c: LdCell): Expr => ({ t: 'lit', c });
function join(t: 'and' | 'or', a: Expr, b: Expr): Expr {
  const xs = [...(a.t === t ? a.xs : [a]), ...(b.t === t ? b.xs : [b])];
  return { t, xs };
}

// ───────────────────────── 래더 → 니모닉 ─────────────────────────

interface Spell {
  ld(c: LdCell): string;
  and(c: LdCell): string;
  or(c: LdCell): string;
  anb: string;
  orb: string;
  mps: string;
  mrd: string;
  mpp: string;
  always: string;
  out(o: LdOut): string | null;
}

const MIT_CONTACT = { ld: { no: 'LD', nc: 'LDI', p: 'LDP', n: 'LDF' }, and: { no: 'AND', nc: 'ANI', p: 'ANDP', n: 'ANDF' }, or: { no: 'OR', nc: 'ORI', p: 'ORP', n: 'ORF' } } as const;
const LS_CONTACT = { ld: { no: 'LOAD', nc: 'LOAD NOT', p: 'LOADP', n: 'LOADN' }, and: { no: 'AND', nc: 'AND NOT', p: 'ANDP', n: 'ANDN' }, or: { no: 'OR', nc: 'OR NOT', p: 'ORP', n: 'ORN' } } as const;

/** 상수: 미쓰비시는 K 를 붙인다 (숫자만 적었으면) */
const kConst = (v: string) => (/^-?\d+$/.test(v.trim()) ? `K${v.trim()}` : v.trim());

function spelling(d: LdDialect): Spell {
  const table = d === 'ls' ? LS_CONTACT : MIT_CONTACT;
  const word = (head: 'ld' | 'and' | 'or', c: LdCell) => {
    if (c.k === 'cmp') return `${d === 'ls' ? (head === 'ld' ? 'LOAD' : head.toUpperCase()) : head.toUpperCase()}${c.op ?? '='} ${c.dev ?? ''} ${d === 'ls' ? (c.b ?? '') : kConst(c.b ?? '')}`;
    return `${table[head][c.k as 'no' | 'nc' | 'p' | 'n']} ${c.dev ?? ''}`;
  };
  return {
    ld: (c) => word('ld', c),
    and: (c) => word('and', c),
    or: (c) => word('or', c),
    anb: d === 'ls' ? 'AND LOAD' : 'ANB',
    orb: d === 'ls' ? 'OR LOAD' : 'ORB',
    mps: d === 'ls' ? 'MPUSH' : 'MPS',
    mrd: d === 'ls' ? 'MLOAD' : 'MRD',
    mpp: d === 'ls' ? 'MPOP' : 'MPP',
    always: d === 'ls' ? 'LOAD F00099' : 'LD M8000',
    out: (o) => {
      const dev = o.dev.trim();
      const arg = (o.arg ?? '').trim();
      switch (o.k) {
        case 'out':
          return `OUT ${dev}`;
        case 'set':
          return `SET ${dev}`;
        case 'rst':
          return `RST ${dev}`;
        case 'pls':
          return d === 'ls' ? `OUTP ${dev}` : `PLS ${dev}`;
        case 'plf':
          return d === 'ls' ? `OUTN ${dev}` : `PLF ${dev}`;
        case 'ton':
          return d === 'ls' ? `TON ${dev} ${arg}` : `OUT ${dev} ${kConst(arg)}`;
        case 'tof':
          return d === 'ls' ? `TOFF ${dev} ${arg}` : null;
        case 'ctu':
          return d === 'ls' ? `CTU ${dev} ${arg}` : `OUT ${dev} ${kConst(arg)}`;
        case 'app':
          return dev;
      }
    },
  };
}

/** 식을 니모닉으로: first 이면 LD 로 시작 */
function emitExpr(e: Expr, S: Spell, out: string[], first: boolean): void {
  if (e.t === 'lit') {
    out.push(first ? S.ld(e.c) : S.and(e.c));
    return;
  }
  if (e.t === 'and') {
    emitExpr(e.xs[0], S, out, first);
    for (const x of e.xs.slice(1)) emitFactor(x, S, out);
    return;
  }
  // OR 덩어리: 첫 갈래를 LD 로, 접점 하나짜리는 OR, 여러 개짜리는 블록 + ORB
  emitExpr(e.xs[0], S, out, true);
  for (const x of e.xs.slice(1)) {
    if (x.t === 'lit') out.push(S.or(x.c));
    else {
      emitExpr(x, S, out, true);
      out.push(S.orb);
    }
  }
}

/** 직렬로 하나 더: 접점이면 AND, 병렬 덩어리면 블록 + ANB */
function emitFactor(x: Expr, S: Spell, out: string[]): void {
  if (x.t === 'lit') out.push(S.and(x.c));
  else if (x.t === 'and') for (const y of x.xs) emitFactor(y, S, out);
  else {
    emitExpr(x, S, out, true);
    out.push(S.anb);
  }
}

interface Edge {
  a: number;
  b: number;
  e: Expr;
  row: number;
}

/** 렁 → 마디 그래프 (모선 = 0 번 마디로 묶음) */
function rungGraph(rung: LdRung, cols: number) {
  const W = cols + 1;
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const id = (r: number, x: number) => r * W + x;
  for (let r = 0; r < rung.rows; r++) union(id(r, 0), id(0, 0));
  for (const [k, c] of Object.entries(rung.cells)) {
    const [r, col] = k.split(',').map(Number);
    if (c.k === 'h' && r < rung.rows && col < cols) union(id(r, col), id(r, col + 1));
  }
  for (const v of rung.vl) {
    const [r, x] = v.split(',').map(Number);
    if (r + 1 < rung.rows && x > 0 && x <= cols) union(id(r, x), id(r + 1, x));
  }
  const edges: Edge[] = [];
  for (const [k, c] of Object.entries(rung.cells)) {
    const [r, col] = k.split(',').map(Number);
    if (c.k === 'h' || r >= rung.rows || col >= cols) continue;
    edges.push({ a: find(id(r, col)), b: find(id(r, col + 1)), e: lit(c), row: r * 1000 + col });
  }
  return { edges, rail: find(0), node: (r: number, x: number) => find(id(r, x)) };
}

/** 병렬 덩어리의 갈래마다 그린 줄 (차례를 그림대로) */
const orRows = new WeakMap<Expr, number[]>();

/** L 에서 T 까지의 식 (직렬 · 병렬로 줄인다). 못 줄이면 오류 글 */
function reduce(all: Edge[], L: number, T: number): Expr | null | string {
  if (L === T) return null;
  // 가는 길에 드는 선만: L 에서 앞으로 닿고, T 로 뒤로 닿는 것
  const fwd = new Set([L]);
  const bwd = new Set([T]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of all) {
      if (fwd.has(e.a) && !fwd.has(e.b)) {
        fwd.add(e.b);
        changed = true;
      }
      if (bwd.has(e.b) && !bwd.has(e.a)) {
        bwd.add(e.a);
        changed = true;
      }
    }
  }
  let es = all.filter((e) => e.a !== e.b && fwd.has(e.a) && bwd.has(e.b) && e.a !== T && e.b !== L).map((e) => ({ ...e }));
  if (!es.length) return '출력까지 이어진 접점이 없습니다 (가로선 · 세로선을 확인하세요)';
  for (let guard = 0; guard < 10000; guard++) {
    if (es.length === 1 && es[0].a === L && es[0].b === T) return es[0].e;
    let did = false;
    // 병렬: 같은 두 마디 사이 (위 줄부터)
    const groups = new Map<string, Edge[]>();
    for (const e of es) groups.set(`${e.a}>${e.b}`, [...(groups.get(`${e.a}>${e.b}`) ?? []), e]);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // 그린 순서 (위 줄부터) 대로: 이미 합친 병렬 덩어리도 갈래마다 줄을 기억해 둔다
      const items = g.flatMap((e) => (e.e.t === 'or' && orRows.has(e.e) ? e.e.xs.map((x, i) => ({ x, row: orRows.get(e.e)![i] })) : [{ x: e.e, row: e.row }]));
      items.sort((p, q) => p.row - q.row);
      const merged: Expr = { t: 'or', xs: items.map((i) => i.x) };
      orRows.set(merged, items.map((i) => i.row));
      const row = Math.min(...items.map((i) => i.row));
      es = [...es.filter((e) => !g.includes(e)), { a: g[0].a, b: g[0].b, e: merged, row }];
      did = true;
    }
    if (did) continue;
    // 직렬: 들어오는 선 하나 · 나가는 선 하나인 마디
    const ins = new Map<number, Edge[]>();
    const outs = new Map<number, Edge[]>();
    for (const e of es) {
      ins.set(e.b, [...(ins.get(e.b) ?? []), e]);
      outs.set(e.a, [...(outs.get(e.a) ?? []), e]);
    }
    for (const [v, iv] of ins) {
      if (v === L || v === T) continue;
      const ov = outs.get(v) ?? [];
      if (iv.length === 1 && ov.length === 1) {
        const [p] = iv;
        const [q] = ov;
        es = [...es.filter((e) => e !== p && e !== q), { a: p.a, b: q.b, e: join('and', p.e, q.e), row: Math.min(p.row, q.row) }];
        did = true;
        break;
      }
    }
    if (!did) return '직렬 · 병렬로 풀리지 않는 모양 (브리지 · 거꾸로 가는 선) 입니다';
  }
  return '렁이 너무 복잡합니다';
}

/** 모든 출력 마디가 지나는 가장 뒤의 마디 (갈라지는 점) */
function splitNode(all: Edge[], L: number, targets: number[]): number {
  if (targets.every((t) => t === targets[0])) return targets[0];
  const reach = (from: number, skip: number) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const v = stack.pop()!;
      for (const e of all) if (e.a === v && e.b !== skip && !seen.has(e.b)) {
        seen.add(e.b);
        stack.push(e.b);
      }
    }
    return seen;
  };
  const nodes = new Set(all.flatMap((e) => [e.a, e.b]));
  // 출력 마디 자신도 갈라지는 점이 될 수 있다 (그 출력은 갈라진 뒤 접점 없이 바로)
  const doms = [...nodes].filter((v) => v !== L && targets.every((t) => !reach(L, v).has(t)));
  // 지배 마디는 한 줄로 늘어선다: 다른 모든 지배 마디에서 닿는 것이 가장 뒤
  const last = doms.find((v) => doms.every((u) => u === v || reach(u, -1).has(v)));
  return last ?? L;
}

export interface CompileResult {
  text: string;
  errors: { rung: number; message: string }[];
  /** 니모닉 줄 (0 부터) → 렁 번호 (1 부터, 0 = END) */
  rungOfLine: number[];
}

/** 래더 → 니모닉 */
export function compileLadder(ld: Ladder, dialect: LdDialect): CompileResult {
  const S = spelling(dialect);
  const lines: string[] = [];
  const errors: CompileResult['errors'] = [];
  const rungOfLine: number[] = [];
  const notes = ld.notes ?? {};
  const noted = new Set<string>();
  ld.rungs.forEach((rung, ri) => {
    const n = ri + 1;
    const mark = () => {
      while (rungOfLine.length < lines.length) rungOfLine.push(n);
    };
    if (rung.comment?.trim()) lines.push(...rung.comment.trim().split(/\r?\n/).map((c) => `; ${c.trim()}`));
    if (rung.raw) {
      lines.push(...rung.raw);
      mark();
      return;
    }
    for (const c of Object.values(rung.cells)) {
      if (c.k !== 'h' && !c.dev?.trim()) errors.push({ rung: n, message: `렁 ${n}: 디바이스를 적지 않은 접점이 있습니다` });
      if (c.k === 'cmp' && !c.b?.trim()) errors.push({ rung: n, message: `렁 ${n}: 비교 접점의 비교 값이 없습니다` });
    }
    const outRows = Object.keys(rung.outs)
      .map(Number)
      .filter((r) => r < rung.rows)
      .sort((a, b) => a - b);
    if (!outRows.length) {
      if (Object.keys(rung.cells).length) errors.push({ rung: n, message: `렁 ${n}: 출력 (코일 · 명령) 이 없습니다` });
      return;
    }
    const body: string[] = [];
    /** 응용 명령 줄 (첫 오퍼랜드가 디바이스가 아닐 수 있어 설명을 붙이지 않는다) */
    const appAt = new Set<number>();
    const outText = (o: LdOut) => {
      if (!o.dev.trim()) {
        errors.push({ rung: n, message: `렁 ${n}: 출력에 디바이스를 적지 않았습니다` });
        return null;
      }
      if ((o.k === 'ton' || o.k === 'tof' || o.k === 'ctu') && !(o.arg ?? '').trim()) errors.push({ rung: n, message: `렁 ${n}: ${o.dev} 의 설정값이 없습니다` });
      const t = S.out(o);
      if (t === null) errors.push({ rung: n, message: `렁 ${n}: 미쓰비시에는 OFF 딜레이 타이머 명령이 없습니다 (ON 딜레이와 b접점으로 만드세요)` });
      if (o.k === 'app') appAt.add(body.length);
      return t;
    };
    const g = rungGraph(rung, ld.cols);
    const targets = outRows.map((r) => g.node(r, ld.cols));
    const sp = splitNode(g.edges, g.rail, targets);
    const prefix = reduce(g.edges, g.rail, sp);
    if (typeof prefix === 'string') {
      errors.push({ rung: n, message: `렁 ${n}: ${prefix}` });
      return;
    }
    const suffix = targets.map((t) => reduce(g.edges, sp, t));
    const bad = suffix.find((x) => typeof x === 'string');
    if (typeof bad === 'string') {
      errors.push({ rung: n, message: `렁 ${n}: ${bad}` });
      return;
    }
    const sx = suffix as (Expr | null)[];
    if (prefix === null && sp === g.rail) {
      // 모선에서 바로 갈라짐: 출력마다 따로
      outRows.forEach((r, i) => {
        if (sx[i]) emitExpr(sx[i]!, S, body, true);
        else body.push(S.always);
        const t = outText(rung.outs[r]);
        if (t) body.push(t);
      });
    } else {
      if (prefix) emitExpr(prefix, S, body, true);
      else body.push(S.always);
      const branch = sx.some((x) => x !== null) && outRows.length > 1;
      outRows.forEach((r, i) => {
        if (branch) body.push(i === 0 ? S.mps : i < outRows.length - 1 ? S.mrd : S.mpp);
        if (sx[i]) emitFactor(sx[i]!, S, body);
        const t = outText(rung.outs[r]);
        if (t) body.push(t);
      });
    }
    // 디바이스 설명: 처음 쓰인 줄 끝에 (파서가 그 줄의 첫 오퍼랜드 설명으로 읽는다)
    body.forEach((l, i) => {
      const tk = l.split(/\s+/);
      if (appAt.has(i) || /[=<>]/.test(tk[0])) return;
      const dev = tk.slice(1).find((t) => /\d/.test(t))?.toUpperCase();
      const note = dev && !noted.has(dev) ? notes[dev]?.replace(/[\r\n]+/g, ' ').trim() : '';
      if (!dev || noted.has(dev)) return;
      noted.add(dev);
      if (note) body[i] = `${l} ; ${note}`;
    });
    lines.push(...body);
    mark();
  });
  lines.push('END');
  rungOfLine.push(0);
  return { text: lines.join('\n') + '\n', errors, rungOfLine };
}

// ───────────────────────── 니모닉 → 래더 ─────────────────────────

/** 식의 크기 (칸) */
function measure(e: Expr): { w: number; h: number } {
  if (e.t === 'lit') return { w: 1, h: 1 };
  const ms = e.xs.map(measure);
  return e.t === 'and' ? { w: ms.reduce((s, m) => s + m.w, 0), h: Math.max(...ms.map((m) => m.h)) } : { w: Math.max(...ms.map((m) => m.w)), h: ms.reduce((s, m) => s + m.h, 0) };
}

/** 식을 (r0, x0) 부터 칸에 놓는다 */
function place(e: Expr, r0: number, x0: number, rung: LdRung): { w: number; h: number } {
  if (e.t === 'lit') {
    rung.cells[`${r0},${x0}`] = { ...e.c };
    return { w: 1, h: 1 };
  }
  if (e.t === 'and') {
    let x = x0;
    let h = 1;
    for (const c of e.xs) {
      const m = place(c, r0, x, rung);
      x += m.w;
      h = Math.max(h, m.h);
    }
    return { w: x - x0, h };
  }
  const W = measure(e).w;
  let r = r0;
  const tops: number[] = [];
  for (const c of e.xs) {
    const m = place(c, r, x0, rung);
    for (let x = x0 + m.w; x < x0 + W; x++) rung.cells[`${r},${x}`] = { k: 'h' };
    tops.push(r);
    r += m.h;
  }
  for (let rr = r0; rr < tops[tops.length - 1]; rr++) {
    if (x0 > 0) rung.vl.push(`${rr},${x0}`);
    rung.vl.push(`${rr},${x0 + W}`);
  }
  return { w: W, h: r - r0 };
}

interface Piece {
  /** 갈라지기 전 (공통) 식, 없으면 모선에서 바로 */
  prefix: Expr | null;
  /** 출력마다 갈라진 뒤의 식과 출력 */
  branches: { suffix: Expr | null; out: LdOut }[];
}

/** 렁 하나를 칸에 놓는다 (가로 cols 칸) */
function layoutPiece(p: Piece, cols: number): LdRung {
  const rung = emptyRung();
  const pm = p.prefix ? place(p.prefix, 0, 0, rung) : { w: 0, h: 1 };
  let r = 0;
  const tops: number[] = [];
  for (const b of p.branches) {
    const m = b.suffix ? place(b.suffix, r, pm.w, rung) : { w: 0, h: 1 };
    for (let x = pm.w + m.w; x < cols; x++) rung.cells[`${r},${x}`] = { k: 'h' };
    rung.outs[String(r)] = b.out;
    tops.push(r);
    r += m.h;
  }
  const split = p.branches.some((b) => b.suffix) ? pm.w : cols;
  for (let rr = 0; rr < tops[tops.length - 1]; rr++) if (split > 0) rung.vl.push(`${rr},${split}`);
  rung.rows = Math.max(pm.h, r);
  rung.vl = [...new Set(rung.vl)];
  return rung;
}

const pieceWidth = (p: Piece) => (p.prefix ? measure(p.prefix).w : 0) + Math.max(0, ...p.branches.map((b) => (b.suffix ? measure(b.suffix).w : 0)));

/** 니모닉 → 래더. 래더로 그리지 못한 렁 수도 알려 준다 */
export function ilToLadder(text: string, dialect: LdDialect): { ladder: Ladder; raw: number } {
  const { instrs, labels, inlineComments } = parseIl(text, dialect);
  const labelAt = new Map<number, string[]>();
  for (const [name, at] of labels) labelAt.set(at, [...(labelAt.get(at) ?? []), dialect === 'ls' ? `LABEL ${name.replace(/^L/, '')}` : name]);
  const src = (I: Instr) => I.src ?? I.text;
  const pieces: (Piece | { raw: string[] })[] = [];

  // 렁 나누기: 출력 뒤에 (MPS 가 비어 있을 때) LD 가 오면 새 렁
  const segs: Instr[][] = [];
  let cur: Instr[] = [];
  let mps = 0;
  let afterOut = false;
  instrs.forEach((I, i) => {
    if (labelAt.has(i)) {
      if (cur.length) segs.push(cur);
      cur = [];
      segs.push([{ op: 'LABEL', args: labelAt.get(i)!, line: I.line, text: labelAt.get(i)!.join('\n') }]);
      mps = 0;
      afterOut = false;
    }
    if (I.op === 'END' || I.op === 'FEND' || I.op === 'NOP') return;
    if (I.op === 'LD' && afterOut && mps === 0 && cur.length) {
      segs.push(cur);
      cur = [];
      afterOut = false;
    }
    if (I.op === 'MPS') mps++;
    if (I.op === 'MPP') mps = Math.max(0, mps - 1);
    cur.push(I);
    if (!['LD', 'AND', 'OR', 'ANB', 'ORB', 'MPS', 'MRD', 'MPP'].includes(I.op)) afterOut = true;
  });
  if (cur.length) segs.push(cur);

  const CONTACT = new Set(['LD', 'AND', 'OR', 'ANB', 'ORB', 'MPS', 'MRD', 'MPP']);
  const NO_LADDER = new Set(['INV', 'MEP', 'MEF', 'STL', 'RET', 'MCR', 'LABEL', 'JMP', 'MC', 'CTD']);
  for (const seg of segs) {
    const raw = () => pieces.push({ raw: seg.map((I) => (I.op === 'LABEL' ? I.text : src(I))) });
    if (seg.some((I) => NO_LADDER.has(I.op))) {
      raw();
      continue;
    }
    const cell = (I: Instr): LdCell => (I.cmp ? { k: 'cmp', dev: I.args[0], op: I.cmp, b: I.args[1] } : { k: I.edge === 'P' ? 'p' : I.edge === 'F' ? 'n' : I.neg ? 'nc' : 'no', dev: I.args[0] });
    const stack: Expr[] = [];
    const saved: Expr[] = [];
    const outs: { expr: Expr | undefined; out: LdOut }[] = [];
    let ok = true;
    for (const I of seg) {
      const top = stack[stack.length - 1];
      if (CONTACT.has(I.op)) {
        if (I.op === 'LD') stack.push(lit(cell(I)));
        else if (I.op === 'AND' || I.op === 'OR') {
          if (!top) ok = false;
          else stack[stack.length - 1] = { t: I.op === 'AND' ? 'and' : 'or', xs: [top, lit(cell(I))] };
        } else if (I.op === 'ANB' || I.op === 'ORB') {
          const b = stack.pop();
          const a = stack.pop();
          if (!a || !b) ok = false;
          else stack.push({ t: I.op === 'ANB' ? 'and' : 'or', xs: [a, b] });
        } else if (I.op === 'MPS') {
          if (!top) ok = false;
          else saved.push(top);
        } else if (I.op === 'MRD' || I.op === 'MPP') {
          const s = I.op === 'MRD' ? saved[saved.length - 1] : saved.pop();
          if (!s) ok = false;
          else stack[stack.length - 1] = s;
        }
        continue;
      }
      // 출력
      let out: LdOut;
      const a0 = I.args[0] ?? '';
      if (I.op === 'OUT' && !I.neg) out = { k: 'out', dev: a0 };
      else if (I.op === 'SET' || I.op === 'RST') out = { k: I.op === 'SET' ? 'set' : 'rst', dev: a0 };
      else if (I.op === 'PLS' || I.op === 'PLF') out = { k: I.op === 'PLS' ? 'pls' : 'plf', dev: a0 };
      else if (I.op === 'TMR' && (I.timer === 'TON' || I.timer === 'TOF') && !I.timerBase) out = { k: I.timer === 'TON' ? 'ton' : 'tof', dev: a0, arg: (I.args[1] ?? '').replace(/^K/i, '') };
      else if (I.op === 'CTU') out = { k: 'ctu', dev: a0, arg: (I.args[1] ?? '').replace(/^K/i, '') };
      else out = { k: 'app', dev: src(I) };
      if (out.k === 'tof' && dialect !== 'ls') out = { k: 'app', dev: src(I) };
      outs.push({ expr: top, out });
    }
    if (!ok || !outs.length || outs.some((o) => !o.expr)) {
      raw();
      continue;
    }
    // 출력들의 공통 바탕 (MPS 로 저장한 식): 왼쪽 등뼈를 따라가며 모두에 있는 가장 바깥 것
    const spine = (e: Expr): Expr[] => {
      const out: Expr[] = [e];
      for (let x = e; x.t === 'and'; x = x.xs[0]) out.push(x.xs[0]);
      return out;
    };
    const spines = outs.map((o) => spine(o.expr!));
    const base = spines[0].find((x) => spines.every((s) => s.includes(x)));
    if (!base) {
      raw();
      continue;
    }
    const rest = (e: Expr): Expr | null => {
      if (e === base) return null;
      if (e.t !== 'and') return e;
      const head = rest(e.xs[0]);
      const tail = e.xs.slice(1);
      const all = head ? [head, ...tail] : tail;
      return all.length === 1 ? all[0] : all.reduce((acc, x) => join('and', acc, x));
    };
    const flat = (e: Expr): Expr => (e.t === 'lit' ? e : (e.xs.map(flat).reduce((acc, x) => join(e.t, acc, x)) as Expr));
    pieces.push({ prefix: flat(base), branches: outs.map((o) => ({ suffix: (() => { const r = rest(o.expr!); return r ? flat(r) : null; })(), out: o.out })) });
  }
  const cols = Math.max(8, ...pieces.map((p) => ('raw' in p ? 0 : pieceWidth(p) + 1)));
  const rungs = pieces.map((p) => ('raw' in p ? { ...emptyRung(), raw: p.raw } : layoutPiece(p, cols)));
  // 설명만 있는 줄 → 그 뒤 (또는 안) 의 렁 설명
  const cms = ilCommentLines(text);
  let prev = 0;
  segs.forEach((seg, i) => {
    const last = Math.max(...seg.map((I) => I.line));
    const mine = cms.filter((c) => c.line > prev && c.line < last).map((c) => c.comment);
    if (mine.length && rungs[i]) rungs[i].comment = mine.join(' / ');
    prev = last;
  });
  const notes: Record<string, string> = {};
  for (const [d, c] of inlineComments) if (c) notes[d.toUpperCase()] = c;
  return { ladder: { cols, rungs: rungs.length ? rungs : [emptyRung()], ...(Object.keys(notes).length ? { notes } : {}) }, raw: rungs.filter((r) => r.raw).length };
}

/** 디바이스 설명을 바꾼다 (빈 글이면 지움) */
export function setNote(ld: Ladder, dev: string, text: string): Ladder {
  const d = dev.trim().toUpperCase();
  if (!d) return ld;
  const notes = { ...(ld.notes ?? {}) };
  if (text.trim()) notes[d] = text;
  else delete notes[d];
  return { ...ld, notes };
}

/** 렁의 칸이 cols 를 넘지 않게 (열 수를 줄일 때) */
export function ladderFits(ld: Ladder, cols: number): boolean {
  return ld.rungs.every((r) => Object.keys(r.cells).every((k) => Number(k.split(',')[1]) < cols));
}

// ───────────────────────── 편집 (새 래더를 돌려준다) ─────────────────────────

const mapRung = (ld: Ladder, i: number, f: (r: LdRung) => LdRung): Ladder => ({ ...ld, rungs: ld.rungs.map((r, k) => (k === i ? f(r) : r)) });

/** 칸에 접점 · 가로선을 놓거나 (null) 지운다 */
export function setCell(ld: Ladder, i: number, row: number, col: number, cell: LdCell | null): Ladder {
  return mapRung(ld, i, (r) => {
    const cells = { ...r.cells };
    if (cell) cells[`${row},${col}`] = cell;
    else delete cells[`${row},${col}`];
    return { ...r, cells };
  });
}

/** 세로선 (row 줄과 아래 줄의 x 마디) 을 켜고 끈다 */
export function toggleVl(ld: Ladder, i: number, row: number, x: number): Ladder {
  return mapRung(ld, i, (r) => {
    if (row + 1 >= r.rows || x <= 0 || x > ld.cols) return r;
    const k = `${row},${x}`;
    return { ...r, vl: r.vl.includes(k) ? r.vl.filter((v) => v !== k) : [...r.vl, k] };
  });
}

/** 출력을 놓는다 (null 이면 지움). 그 줄에 접점이 있으면 마지막 접점 뒤부터 출력까지 가로선을 채운다 */
export function setOut(ld: Ladder, i: number, row: number, out: LdOut | null): Ladder {
  return mapRung(ld, i, (r) => {
    const outs = { ...r.outs };
    const cells = { ...r.cells };
    if (out) {
      outs[String(row)] = out;
      const used = Object.keys(cells)
        .map((k) => k.split(',').map(Number))
        .filter(([rr]) => rr === row)
        .map(([, c]) => c);
      if (used.length) for (let c = Math.max(...used) + 1; c < ld.cols; c++) cells[`${row},${c}`] = { k: 'h' };
    } else delete outs[String(row)];
    return { ...r, outs, cells };
  });
}

/** row 아래에 빈 줄을 끼운다 */
export function addRow(ld: Ladder, i: number, row: number): Ladder {
  return mapRung(ld, i, (r) => shiftRows(r, row + 1, 1));
}

/** 줄을 지운다 (렁에 줄이 하나뿐이면 그대로) */
export function deleteRow(ld: Ladder, i: number, row: number): Ladder {
  return mapRung(ld, i, (r) => (r.rows <= 1 ? r : shiftRows(r, row, -1)));
}

/** from 줄부터 by 만큼 줄을 밀거나 (by > 0) 당긴다 (by = -1: from 줄을 없앰) */
function shiftRows(r: LdRung, from: number, by: 1 | -1): LdRung {
  const mv = (row: number) => (row < from ? row : by < 0 && row === from ? -1 : row + by);
  const cells: Record<string, LdCell> = {};
  for (const [k, c] of Object.entries(r.cells)) {
    const [row, col] = k.split(',').map(Number);
    const n = mv(row);
    if (n >= 0) cells[`${n},${col}`] = c;
  }
  const outs: Record<string, LdOut> = {};
  for (const [k, o] of Object.entries(r.outs)) {
    const n = mv(Number(k));
    if (n >= 0) outs[String(n)] = o;
  }
  const vl = r.vl
    .map((v) => v.split(',').map(Number))
    .map(([row, x]) => [by < 0 && row === from ? -1 : row < from ? row : row + by, x])
    .filter(([row]) => row >= 0)
    .map(([row, x]) => `${row},${x}`);
  return { ...r, rows: r.rows + by, cells, outs, vl: [...new Set(vl)] };
}

export function addRung(ld: Ladder, after: number): Ladder {
  const rungs = [...ld.rungs];
  rungs.splice(after + 1, 0, emptyRung());
  return { ...ld, rungs };
}

export function deleteRung(ld: Ladder, i: number): Ladder {
  const rungs = ld.rungs.filter((_, k) => k !== i);
  return { ...ld, rungs: rungs.length ? rungs : [emptyRung()] };
}

export function moveRung(ld: Ladder, i: number, dir: -1 | 1): Ladder {
  const j = i + dir;
  if (j < 0 || j >= ld.rungs.length) return ld;
  const rungs = [...ld.rungs];
  [rungs[i], rungs[j]] = [rungs[j], rungs[i]];
  return { ...ld, rungs };
}

/** 렁 설명 */
export function setRungComment(ld: Ladder, i: number, comment: string): Ladder {
  return mapRung(ld, i, (r) => ({ ...r, ...(comment ? { comment } : { comment: undefined }) }));
}

/** 접점 · 출력의 디바이스 (모니터 · 목록용) */
export function ladderDevices(ld: Ladder): string[] {
  const s = new Set<string>();
  for (const r of ld.rungs) {
    for (const c of Object.values(r.cells)) if (c.dev && c.k !== 'cmp') s.add(c.dev.toUpperCase());
    for (const o of Object.values(r.outs)) if (o.k !== 'app' && o.dev) s.add(o.dev.toUpperCase());
  }
  return [...s];
}
