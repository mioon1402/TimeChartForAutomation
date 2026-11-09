import type { Circuit, Wire } from './types';
import { pinPositions } from './parts';

/**
 * 선과 단자를 이어서 "같은 전선(넷)" 을 찾는다.
 *  - 끝점이 같은 곳에 있으면 연결
 *  - 선 끝이나 단자가 다른 선의 중간에 닿으면 T 분기로 연결
 *  - 선끼리 중간에서 엇갈리기만 하면 연결 안 됨
 */
export interface Netlist {
  /** `${partId}:${pin}` → 넷 번호 */
  pinNet: Map<string, number>;
  wireNet: Map<string, number>;
  count: number;
  /** 세 갈래 이상 만나는 점 (점 표시) */
  junctions: [number, number][];
  /** 넷마다 연결된 단자 수 (단자 하나뿐이면 떠 있는 단자) */
  pinCount: number[];
  /** 넷마다 선이 하나라도 있는가 */
  hasWire: boolean[];
}

const key = (x: number, y: number) => `${x},${y}`;

/** 점이 선의 양 끝을 뺀 중간에 있는가 */
export function onWireInterior(w: Wire, x: number, y: number): boolean {
  const [ax, ay] = w.a;
  const [bx, by] = w.b;
  if ((x === ax && y === ay) || (x === bx && y === by)) return false;
  const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(ax, bx) - 1e-9 && x <= Math.max(ax, bx) + 1e-9 && y >= Math.min(ay, by) - 1e-9 && y <= Math.max(ay, by) + 1e-9;
}

export function buildNetlist(c: Pick<Circuit, 'parts' | 'wires'>): Netlist {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = parent.get(k);
    if (r === undefined) {
      parent.set(k, k);
      return k;
    }
    if (r === k) return k;
    r = find(r);
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const wires = c.wires.filter((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]);
  const degree = new Map<string, number>();
  const bump = (k: string, n = 1) => degree.set(k, (degree.get(k) ?? 0) + n);

  const pinPts: { id: string; k: string; x: number; y: number }[] = [];
  for (const p of c.parts) {
    pinPositions(p).forEach(([x, y], i) => {
      const k = key(x, y);
      find(k);
      bump(k);
      pinPts.push({ id: `${p.id}:${i}`, k, x, y });
    });
  }
  for (const w of wires) {
    const ka = key(...w.a);
    const kb = key(...w.b);
    union(ka, kb);
    bump(ka);
    bump(kb);
  }
  // T 분기: 선 끝·단자가 다른 선 중간에 닿음
  const points = new Map<string, [number, number]>();
  for (const w of wires) {
    points.set(key(...w.a), w.a);
    points.set(key(...w.b), w.b);
  }
  for (const pp of pinPts) points.set(pp.k, [pp.x, pp.y]);
  for (const [k, [x, y]] of points) {
    for (const w of wires) {
      if (onWireInterior(w, x, y)) {
        union(k, key(...w.a));
        bump(k, 2);
      }
    }
  }

  const ids = new Map<string, number>();
  const netOf = (k: string) => {
    const r = find(k);
    let n = ids.get(r);
    if (n === undefined) {
      n = ids.size;
      ids.set(r, n);
    }
    return n;
  };
  const pinNet = new Map<string, number>();
  for (const pp of pinPts) pinNet.set(pp.id, netOf(pp.k));
  const wireNet = new Map<string, number>();
  for (const w of wires) wireNet.set(w.id, netOf(key(...w.a)));
  const count = ids.size;
  const pinCount = new Array<number>(count).fill(0);
  for (const n of pinNet.values()) pinCount[n]++;
  const hasWire = new Array<boolean>(count).fill(false);
  for (const n of wireNet.values()) hasWire[n] = true;

  const wireEnds = new Set<string>();
  for (const w of wires) {
    wireEnds.add(key(...w.a));
    wireEnds.add(key(...w.b));
  }
  const junctions: [number, number][] = [];
  for (const [k, d] of degree) {
    if (d >= 3 && (wireEnds.has(k) || pinPts.some((pp) => pp.k === k && wires.some((w) => onWireInterior(w, pp.x, pp.y))))) junctions.push(points.get(k)!);
  }
  return { pinNet, wireNet, count, junctions, pinCount, hasWire };
}
