import type { Circuit } from './types';
import { octalLayout, setSocketLayout, type OctalLayout } from './parts';
import { sameConnections } from './netlist';

/**
 * 8핀 소켓의 단자 배열을 바꾸고, 그 뒤에도 단자끼리 이어진 모양이 그대로인지 확인한다.
 * 옮겨진 선이 비스듬해지면서 다른 단자 위를 지나가면 그 단자에 닿은 것이 되므로 (same = false) 화면에서 알려 준다.
 */
export function changeSocketLayout(c: Circuit, partId: string, layout: OctalLayout): { circuit: Circuit; moved: number; same: boolean } {
  const part = c.parts.find((p) => p.id === partId);
  if (!part || octalLayout(part) === layout) return { circuit: c, moved: 0, same: true };
  const next = setSocketLayout(c, partId, layout);
  const at = new Map(c.wires.map((w) => [w.id, w]));
  const moved = next.wires.filter((w) => {
    const o = at.get(w.id)!;
    return o.a[0] !== w.a[0] || o.a[1] !== w.a[1] || o.b[0] !== w.b[0] || o.b[1] !== w.b[1];
  }).length;
  return { circuit: next, moved, same: sameConnections(c, next) };
}
