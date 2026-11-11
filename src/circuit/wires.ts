import type { Circuit, WireColor } from './types';
import { onWireInterior } from './netlist';
import { pinPositions, REAL } from './parts';
import type { CircuitModel } from './engine';

type Pt = [number, number];

/** 전원 극의 표준 전선 색 (KS C IEC 60445: L1 갈색, L2 검정, L3 회색, N 파랑, PE 녹황) */
export const POLE_WIRE: Record<string, WireColor> = { L1: 'brown', L2: 'black', L3: 'grey', N: 'blue', PE: 'gy', '+24V': 'red', '0V': 'blue' };

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/**
 * 새로 긋는 전선의 색 (실물 배선도일 때만):
 *  1) 닿는 전선에 색이 있으면 그 색을 잇는다
 *  2) 차단기·접점을 모두 닫힌 것으로 보고 따라가 닿는 전원 극의 표준 색 (L1 갈색, L2 검정, L3 회색, N 파랑, PE 녹황)
 *  3) 극을 모르면 제어선 회색
 * 회로 기호끼리 잇는 선은 색 없이 (검은 선) 둔다.
 */
export function autoWireColor(c: Circuit, model: CircuitModel, from: Pt, to: Pt): WireColor | undefined {
  for (const pt of [from, to]) {
    const w = c.wires.find((x) => x.color && (same(x.a, pt) || same(x.b, pt) || onWireInterior(x, pt[0], pt[1])));
    if (w) return w.color;
  }
  const pins: { net: number; real: boolean }[] = [];
  for (const p of c.parts) {
    pinPositions(p).forEach((q, i) => {
      if (same(q, from) || same(q, to)) pins.push({ net: model.net.pinNet.get(`${p.id}:${i}`)!, real: REAL.has(p.type) });
    });
  }
  if (!pins.some((x) => x.real)) return undefined;
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    const p = parent.get(i);
    if (p === undefined || p === i) return i;
    const r = find(p);
    parent.set(i, r);
    return r;
  };
  for (const k of model.conductors) {
    const a = find(k.a);
    const b = find(k.b);
    if (a !== b) parent.set(a, b);
  }
  for (const pin of pins) {
    const g = find(pin.net);
    const ids = new Set(model.sources.filter((s) => find(s.net) === g).map((s) => s.id));
    if (ids.size === 1) return POLE_WIRE[[...ids][0]] ?? 'grey';
  }
  return 'grey';
}

/**
 * 꺾여 이어진 한 가닥: 고른 선에서 모퉁이 (선 끝 둘만 만나고 단자 · 분기가 없는 점) 를 따라 이어진 선 전부.
 * 케이블 규격은 이 한 가닥에 같은 값을 준다 (길이는 한 가닥 전체의 길이).
 */
export function wireChain(c: Circuit, ids: string[]): string[] {
  const k = (p: Pt) => `${p[0]},${p[1]}`;
  const ends = new Map<string, Circuit['wires']>();
  for (const w of c.wires) for (const e of [w.a, w.b]) ends.set(k(e), [...(ends.get(k(e)) ?? []), w]);
  const pins = new Set<string>();
  for (const p of c.parts) for (const q of pinPositions(p)) pins.add(k(q));
  const out = new Set(ids);
  const stack = c.wires.filter((w) => out.has(w.id));
  while (stack.length) {
    const w = stack.pop()!;
    for (const e of [w.a, w.b]) {
      const ws = ends.get(k(e)) ?? [];
      if (ws.length !== 2 || pins.has(k(e)) || c.wires.some((x) => onWireInterior(x, e[0], e[1]))) continue;
      for (const x of ws) {
        // 규격이 다른 선 (부스바에서 내려오는 선 등) 은 다른 가닥이다
        if (out.has(x.id) || JSON.stringify(x.cable) !== JSON.stringify(w.cable)) continue;
        out.add(x.id);
        stack.push(x);
      }
    }
  }
  return [...out];
}

/**
 * 같은 두 기기를 잇는 나란한 가닥: 3상 급전선의 한 가닥을 고르면 나머지 두 가닥 (과 N) 도 함께.
 * 양 끝이 모두 단자인 가닥만 따진다 (분기점에서 끝나는 가닥은 그대로).
 */
export function parallelWires(c: Circuit, ids: string[]): string[] {
  const k = (p: Pt) => `${p[0]},${p[1]}`;
  const partAt = new Map<string, string>();
  for (const p of c.parts) for (const q of pinPositions(p)) if (!partAt.has(k(q))) partAt.set(k(q), p.id);
  const byId = new Map(c.wires.map((w) => [w.id, w]));
  /** 가닥의 양 끝에 있는 기기 (둘 다 단자일 때만) */
  const endsKey = (chain: string[]): string | null => {
    const count = new Map<string, number>();
    for (const id of chain) for (const e of [byId.get(id)!.a, byId.get(id)!.b]) count.set(k(e), (count.get(k(e)) ?? 0) + 1);
    const ends = [...count].filter(([, n]) => n === 1).map(([pt]) => partAt.get(pt));
    if (ends.length !== 2 || !ends[0] || !ends[1] || ends[0] === ends[1]) return null;
    return [ends[0], ends[1]].sort().join('|');
  };
  const chosen = new Set(wireChain(c, ids));
  const keys = new Set<string>();
  const seen = new Set<string>();
  const chains: { key: string | null; wires: string[] }[] = [];
  for (const w of c.wires) {
    if (seen.has(w.id)) continue;
    const chain = wireChain(c, [w.id]);
    chain.forEach((id) => seen.add(id));
    const key = endsKey(chain);
    chains.push({ key, wires: chain });
    if (key && chain.some((id) => chosen.has(id))) keys.add(key);
  }
  for (const ch of chains) if (ch.key && keys.has(ch.key)) ch.wires.forEach((id) => chosen.add(id));
  return [...chosen];
}
