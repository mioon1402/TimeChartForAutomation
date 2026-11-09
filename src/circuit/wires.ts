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
