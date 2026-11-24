/** 배선 계획 (`Circuit.plan`): 기기만 놓은 실물 배선도에서 아직 긋지 않은 연결 */
import type { Circuit, WireColor } from './types';
import { CircuitModel } from './engine';
import { pinPositions } from './parts';

/** 계획의 넷마다 단자 자리를 지금 그린 선으로 이미 이어진 묶음 (덩어리) 으로 나눈다. 덩어리가 둘 이상이면 아직 이을 것이 있다 */
export function planGroups(c: Circuit, model: CircuitModel = new CircuitModel(c)): { color?: WireColor; groups: [number, number][][] }[] {
  const byId = new Map(c.parts.map((p) => [p.id, p]));
  return (c.plan ?? []).flatMap((pn) => {
    const groups = new Map<number, [number, number][]>();
    let solo = -1;
    for (const [id, i] of pn.pins) {
      const p = byId.get(id);
      const at = p && pinPositions(p)[i];
      if (!p || !at) continue;
      const n = model.net.pinNet.get(`${id}:${i}`) ?? solo--;
      groups.set(n, [...(groups.get(n) ?? []), at]);
    }
    return groups.size > 1 ? [{ color: pn.color, groups: [...groups.values()] }] : [];
  });
}

/** 아직 이을 연결 수 (넷마다 덩어리 수 − 1) */
export function planLeft(c: Circuit, model?: CircuitModel): number {
  if (!c.plan?.length) return 0;
  return planGroups(c, model).reduce((s, g) => s + g.groups.length - 1, 0);
}
