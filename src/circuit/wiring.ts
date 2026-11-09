import type { Circuit, Part, WireColor } from './types';
import { partKindName, partPins, partPoles, pinPositions } from './parts';
import type { CircuitModel } from './engine';
import { tr } from '../i18n';

/**
 * 결선표 (배선 목록): 회로도의 선을 "단자 → 단자" 실제 전선 한 가닥씩으로 풀어 쓴다.
 *  - 그림의 선은 꺾이고 갈라지지만, 실제 전선은 단자 나사에서 나사로만 간다.
 *    그래서 같은 넷(같은 전위)의 단자들을 그림의 선을 따라 가장 가까운 것끼리 이어
 *    (넷마다 단자 수 - 1 가닥) 한 가닥씩 목록으로 만든다. 갈라지는 곳은 한 나사에 두 가닥을 물리는 것.
 *  - 선번호는 넷마다 하나 (같은 번호 = 같은 전위), 위에서 아래 · 왼쪽에서 오른쪽 순서.
 */

type Pt = [number, number];

export interface WireTerm {
  partId: string;
  pin: number;
  /** 기기 기호 (TB1, X1, L …) */
  dev: string;
  /** 단자 번호 (A1, 13, 3 …) */
  label: string;
  at: Pt;
}

export interface WiringRow {
  /** 체크 표시를 저장하는 키 (두 단자, 순서 무관) */
  key: string;
  /** 선번호 (넷마다) */
  no: number;
  from: WireTerm;
  to: WireTerm;
  color?: WireColor;
  /** 그림에서 이 전선이 지나는 토막 (강조 표시용) */
  segs: [Pt, Pt][];
  /** 길이 (격자 칸) */
  length: number;
}

const k = (p: Pt) => `${p[0]},${p[1]}`;

function devName(p: Part): string {
  if (p.tag.trim()) return p.tag.trim();
  if (p.type === 'src' || p.type === 'r_term') return p.pole ?? 'L';
  return partKindName(p.type);
}

function pinName(p: Part, i: number): string {
  if (p.type === 'r_term' || p.type === 'src') return '';
  const label = partPins(p)[i]?.label ?? String(i + 1);
  // 단자대: 번호마다 위·아래 나사
  if (p.type === 'r_tb') return `${label} ${i % 2 === 0 ? tr('위', 'top') : tr('아래', 'btm')}`;
  return label;
}

/** 단자 이름 한 줄 ("X1 3", "TB1 2 위", "L") */
export function termText(t: WireTerm): string {
  return t.label ? `${t.dev} ${t.label}` : t.dev;
}

export const WIRE_COLOR_NAME: Record<WireColor, [string, string]> = {
  brown: ['갈색', 'Brown'],
  black: ['검정', 'Black'],
  grey: ['회색', 'Grey'],
  blue: ['파랑', 'Blue'],
  gy: ['녹황', 'Green-yellow'],
  red: ['빨강', 'Red'],
  yellow: ['노랑', 'Yellow'],
  white: ['흰색', 'White'],
  orange: ['주황', 'Orange'],
};

export function wireColorName(c?: WireColor): string {
  return c ? tr(...WIRE_COLOR_NAME[c]) : '';
}

export function wiringList(c: Circuit, model: CircuitModel): WiringRow[] {
  // 1) 그래프: 점 = 선 끝·꺾임·갈림·단자, 변 = 그 사이 선 토막
  const termsAt = new Map<string, WireTerm[]>();
  for (const p of c.parts) {
    if (p.type === 'text') continue;
    const defs = partPins(p);
    pinPositions(p).forEach((pt, i) => {
      if (defs[i]?.air) return;
      const t: WireTerm = { partId: p.id, pin: i, dev: devName(p), label: pinName(p, i), at: pt };
      termsAt.set(k(pt), [...(termsAt.get(k(pt)) ?? []), t]);
    });
  }
  const nodeSet = new Set<string>(termsAt.keys());
  const wires = c.wires.filter((w) => {
    const n = model.net.wireNet.get(w.id);
    return n === undefined || !model.airNets.has(n);
  });
  for (const w of wires) {
    nodeSet.add(k(w.a));
    nodeSet.add(k(w.b));
  }
  interface Edge {
    to: string;
    a: Pt;
    b: Pt;
    color?: WireColor;
    len: number;
  }
  const adj = new Map<string, Edge[]>();
  const addEdge = (a: Pt, b: Pt, color?: WireColor) => {
    const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (!len) return;
    adj.set(k(a), [...(adj.get(k(a)) ?? []), { to: k(b), a, b, color, len }]);
    adj.set(k(b), [...(adj.get(k(b)) ?? []), { to: k(a), a: b, b: a, color, len }]);
  };
  const nodes = [...nodeSet].map((s) => s.split(',').map(Number) as Pt);
  for (const w of wires) {
    // 선 안쪽에 놓인 점(갈림, 단자)에서 토막을 나눈다
    const horiz = w.a[1] === w.b[1];
    const lo = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const hi = horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    const fixed = horiz ? w.a[1] : w.a[0];
    const cuts = new Set<number>([lo, hi]);
    for (const [x, y] of nodes) {
      if (horiz ? y === fixed && x > lo && x < hi : x === fixed && y > lo && y < hi) cuts.add(horiz ? x : y);
    }
    const sorted = [...cuts].sort((m, n) => m - n);
    for (let i = 1; i < sorted.length; i++) {
      const a: Pt = horiz ? [sorted[i - 1], fixed] : [fixed, sorted[i - 1]];
      const b: Pt = horiz ? [sorted[i], fixed] : [fixed, sorted[i]];
      addEdge(a, b, w.color);
    }
  }

  // 2) 이어진 덩어리마다 단자 모으기
  const seen = new Set<string>();
  const groups: { terms: WireTerm[] }[] = [];
  for (const start of [...termsAt.keys()].sort(byPos)) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const terms: WireTerm[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      terms.push(...(termsAt.get(n) ?? []));
      for (const e of adj.get(n) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    if (terms.length > 1) groups.push({ terms });
  }

  // 3) 덩어리마다: 전원 단자(없으면 맨 위 왼쪽)부터, 이미 이은 단자에서 그림의 선을 따라 가장 가까운 단자를 잇는다
  const srcIds = new Set(c.parts.filter((p) => p.type === 'r_term' || p.type === 'src' || p.type === 'src3').map((p) => p.id));
  const rows: WiringRow[] = [];
  const groupFirst = (g: { terms: WireTerm[] }) => {
    const src = g.terms.find((t) => srcIds.has(t.partId));
    return src ?? [...g.terms].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])[0];
  };
  // 전원 단자가 있는 넷부터 (왼쪽부터: L1 L2 L3 N 처럼), 나머지는 위에서 아래로
  const hasSrc = (g: { terms: WireTerm[] }) => g.terms.some((t) => srcIds.has(t.partId));
  groups.sort((g, h) => {
    const a = groupFirst(g).at;
    const b = groupFirst(h).at;
    if (hasSrc(g) !== hasSrc(h)) return hasSrc(g) ? -1 : 1;
    return hasSrc(g) ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0];
  });
  // 선번호: 단자대 위·아래는 같은 전위라 같은 번호
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.terms.forEach((t) => groupOf.set(`${t.partId}:${t.pin}`, gi)));
  for (const p of c.parts) {
    if (p.type !== 'r_tb') continue;
    for (const [i, j] of partPoles(p) ?? []) {
      const a = groupOf.get(`${p.id}:${i}`);
      const b = groupOf.get(`${p.id}:${j}`);
      if (a !== undefined && b !== undefined && find(a) !== find(b)) parent[Math.max(find(a), find(b))] = Math.min(find(a), find(b));
    }
  }
  const numbers = new Map<number, number>();
  groups.forEach((_, gi) => {
    const r = find(gi);
    if (!numbers.has(r)) numbers.set(r, numbers.size + 1);
  });
  groups.forEach((g, gi) => {
    const first = groupFirst(g);
    const done: WireTerm[] = [first];
    const left = g.terms.filter((t) => t !== first);
    while (left.length) {
      // 이은 단자들에서 동시에 퍼지는 최단 경로 (다익스트라)
      const dist = new Map<string, number>();
      const prev = new Map<string, { from: string; e: Edge }>();
      const origin = new Map<string, WireTerm>();
      const queue: string[] = [];
      for (const t of done) {
        const key = k(t.at);
        if (!dist.has(key)) {
          dist.set(key, 0);
          origin.set(key, t);
          queue.push(key);
        }
      }
      while (queue.length) {
        queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
        const n = queue.shift()!;
        for (const e of adj.get(n) ?? []) {
          const d = dist.get(n)! + e.len;
          if (d < (dist.get(e.to) ?? Infinity)) {
            dist.set(e.to, d);
            prev.set(e.to, { from: n, e });
            origin.set(e.to, origin.get(n)!);
            queue.push(e.to);
          }
        }
      }
      let best = -1;
      for (let i = 0; i < left.length; i++) {
        const d = dist.get(k(left[i].at)) ?? Infinity;
        const bd = best < 0 ? Infinity : dist.get(k(left[best].at)) ?? Infinity;
        if (d < bd) best = i;
      }
      if (best < 0) break;
      const to = left.splice(best, 1)[0];
      const segs: [Pt, Pt][] = [];
      const colorLen = new Map<WireColor, number>();
      let n = k(to.at);
      while (prev.has(n)) {
        const { from, e } = prev.get(n)!;
        segs.push([e.a, e.b]);
        if (e.color) colorLen.set(e.color, (colorLen.get(e.color) ?? 0) + e.len);
        n = from;
      }
      const from = origin.get(k(to.at))!;
      const color = [...colorLen].sort((a, b) => b[1] - a[1])[0]?.[0];
      rows.push({ key: rowKey(from, to), no: numbers.get(find(gi))!, from, to, color, segs, length: dist.get(k(to.at)) ?? 0 });
      done.push(to);
    }
  });
  // 같은 선번호끼리 모아서 (번호 순서대로 배선하기 좋게)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.no - b.r.no || a.i - b.i).map((x) => x.r);
}

function byPos(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  return ay - by || ax - bx;
}

function rowKey(a: WireTerm, b: WireTerm): string {
  const x = `${a.partId}:${a.pin}`;
  const y = `${b.partId}:${b.pin}`;
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function wiringCsv(rows: WiringRow[], done: ReadonlySet<string> = new Set()): string {
  const line = (cells: unknown[]) => cells.map(csvCell).join(',');
  const out = [line(['No', tr('선번호', 'Wire no.'), tr('출발 기기', 'From device'), tr('단자', 'Terminal'), tr('도착 기기', 'To device'), tr('단자', 'Terminal'), tr('전선 색', 'Colour'), tr('완료', 'Done')])];
  rows.forEach((r, i) => out.push(line([i + 1, r.no, r.from.dev, r.from.label, r.to.dev, r.to.label, wireColorName(r.color), done.has(r.key) ? 'O' : ''])));
  return '﻿' + out.join('\r\n') + '\r\n';
}
