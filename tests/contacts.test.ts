import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { CircuitModel } from '../src/circuit/engine';
import { contactNumbers, parseTerm } from '../src/circuit/contacts';
import { toWiring } from '../src/circuit/realize';
import { toSchematic } from '../src/circuit/schematic';
import { checkCircuit } from '../src/circuit/bom';
import { circuitExamples } from '../src/circuit/examples';
import { REAL } from '../src/circuit/parts';

type Item = [PartType, string, Partial<Part>?];

/** 사다리 회로: 줄마다 L 전원 → 기호들 (위에서 아래로) → N 전원 */
function ladder(...rungs: Item[][]): Circuit {
  let n = 0;
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const wire = (a: [number, number], b: [number, number]) => wires.push({ id: `w${n++}`, a, b });
  rungs.forEach((items, k) => {
    const x = 6 * k;
    parts.push({ id: `p${n++}`, type: 'src', x, y: 0, rot: 0, tag: '', pole: 'L' });
    let prev: [number, number] = [x, 0];
    items.forEach(([type, tag, extra], i) => {
      const y = 5 + 6 * i;
      parts.push({ id: `p${n++}`, type, x, y, rot: 0, tag, ...extra });
      wire(prev, [x, y - 2]);
      prev = [x, y + 2];
    });
    const yN = 5 + 6 * items.length;
    parts.push({ id: `p${n++}`, type: 'src', x, y: yN, rot: 0, tag: '', pole: 'N' });
    wire(prev, [x, yN]);
  });
  return { parts, wires, ops: [] } as unknown as Circuit;
}
const lamp = (t: string): Item => ['lamp', t];
const byTag = (c: Circuit, type: PartType, tag: string) => c.parts.filter((p) => p.type === type && p.tag === tag);
const numbers = (c: Circuit) => {
  const m = new CircuitModel(c);
  return { m, nums: contactNumbers(c, m) };
};
const termOf = (c: Circuit, p: Part) => numbers(c).nums.terms.get(p.id)?.join('-');

describe('접점 번호: 자동 (실물 배선도에서 쓸 단자)', () => {
  it('릴레이 X1 의 a접점 두 개는 번호가 겹치지 않는다 (8핀 8-6 · 1-3), 코일은 2-7', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1'], lamp('PL1')], [['no', 'X1'], lamp('PL2')]);
    const [a1, a2] = byTag(c, 'no', 'X1');
    expect([termOf(c, a1), termOf(c, a2)]).toEqual(['8-6', '1-3']);
    expect(termOf(c, byTag(c, 'coil', 'X1')[0])).toBe('2-7');
  });

  it('공통 (L) 을 같이 쓰는 a · b 는 한 벌의 전환 접점 (8-6 · 8-5)', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1'], lamp('PL1')], [['nc', 'X1'], lamp('PL2')]);
    expect([termOf(c, byTag(c, 'no', 'X1')[0]), termOf(c, byTag(c, 'nc', 'X1')[0])]).toEqual(['8-6', '8-5']);
  });

  it('8핀 2c 로 모자라면 각형 4c (9-5 · 10-6 · 11-7), 전자접촉기는 13-14 · 21-22 · 코일 A1-A2', () => {
    const c = ladder([['coil', 'X1']], ...[1, 2, 3].map((k): Item[] => [['no', 'X1'], lamp(`PL${k}`)]));
    expect(byTag(c, 'no', 'X1').map((p) => termOf(c, p))).toEqual(['9-5', '10-6', '11-7']);
    expect(termOf(c, byTag(c, 'coil', 'X1')[0])).toBe('13-14');
    const mc = ladder([['coil', 'MC1']], [['no', 'MC1'], lamp('PL1')], [['nc', 'MC1'], lamp('PL2')]);
    expect([termOf(mc, byTag(mc, 'no', 'MC1')[0]), termOf(mc, byTag(mc, 'nc', 'MC1')[0]), termOf(mc, byTag(mc, 'coil', 'MC1')[0])]).toEqual(['13-14', '21-22', 'A1-A2']);
  });

  it('타이머: 한시 8-6 · 8-5, 순시 (inst13) 1-3, 코일 2-7. THR 은 95-96', () => {
    const t = ladder([['timer', 'T1']], [['no', 'T1'], lamp('PL1')], [['no', 'T1', { inst13: true }], lamp('PL2')]);
    const [timed, inst] = byTag(t, 'no', 'T1');
    expect([termOf(t, timed), termOf(t, inst), termOf(t, byTag(t, 'timer', 'T1')[0])]).toEqual(['8-6', '1-3', '2-7']);
    const thr = ladder([['nc', 'THR1'], ['coil', 'MC1']], [['ol3', 'THR1']]);
    expect(termOf(thr, byTag(thr, 'nc', 'THR1')[0])).toBe('95-96');
  });

  it('내장 회로도 예제는 접점마다 번호가 하나씩이고 [검사] 에 번호 문제가 없다', () => {
    for (const ex of circuitExamples()) {
      const c = ex.build();
      if (c.parts.some((p) => REAL.has(p.type))) continue;
      const { m, nums } = numbers(c);
      const seen = new Set<string>();
      for (const p of c.parts) {
        if (p.type !== 'no' && p.type !== 'nc') continue;
        const t = nums.terms.get(p.id);
        if (!t) continue;
        const key = `${nums.where.get(p.id)!.tag}|${t.join('-')}`;
        expect(seen.has(key), `${ex.id} ${p.tag} ${key}`).toBe(false);
        seen.add(key);
      }
      expect(checkCircuit(c, m).filter((i) => i.msg.includes('접점 번호')), ex.id).toEqual([]);
    }
  });
});

describe('접점 번호를 적으면', () => {
  it('[실물 배선도 만들기] 가 그 단자에 물리고, 적지 않은 접점은 남은 단자로 간다', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1'], lamp('PL1')], [['no', 'X1', { term: '8-6' }], lamp('PL2')]);
    const [auto, fixed] = byTag(c, 'no', 'X1');
    expect([termOf(c, auto), termOf(c, fixed)]).toEqual(['1-3', '8-6']);
    const r = toWiring(c);
    const at = (type: PartType, tag: string, pin: number) => r.pinNets.get(`${r.circuit.parts.find((q) => q.type === type && q.tag === tag && (type !== 'r_term' || q.pole === tag))!.id}:${pin}`);
    // 단자 차례: 1 → 0, 2 → 1, 3 → 2, 6 → 5, 8 → 7. 위 (8) 는 조작 L (코일 2 와 같은 선, 제어 차단기 CB0 뒤), 아래 (6) 는 PL2, 남은 1-3 의 3 은 PL1
    const ctrlL = at('r_relay8', 'X1', 1);
    expect(at('r_relay8', 'X1', 7)).toBe(ctrlL);
    expect(at('r_relay8', 'X1', 5)).toBe(at('r_lamp', 'PL2', 0));
    expect(at('r_relay8', 'X1', 0)).toBe(ctrlL);
    expect(at('r_relay8', 'X1', 2)).toBe(at('r_lamp', 'PL1', 0));
    expect(r.failed).toBe(0);
  });

  it('위-아래를 거꾸로 적어도 (6-8) 그 차례대로 물린다', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1', { term: '6-8' }], lamp('PL1')]);
    const p = byTag(c, 'no', 'X1')[0];
    expect(termOf(c, p)).toBe('6-8');
    const r = toWiring(c);
    const relay = r.circuit.parts.find((q) => q.type === 'r_relay8')!;
    const pl = r.circuit.parts.find((q) => q.type === 'r_lamp')!;
    // 위 (조작 L, 코일 2 와 같은 선) 가 6, 아래 (램프) 가 8
    expect(r.pinNets.get(`${relay.id}:5`)).toBe(r.pinNets.get(`${relay.id}:1`));
    expect(r.pinNets.get(`${relay.id}:7`)).toBe(r.pinNets.get(`${pl.id}:0`));
  });

  it('각형 4c 번호 (9-5) 를 적으면 각형 릴레이를 고른다', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1', { term: '9-5' }], lamp('PL1')]);
    const { nums } = numbers(c);
    expect(nums.plans.get('X1')!.type).toBe('r_my4');
    expect(toWiring(c).circuit.parts.some((p) => p.type === 'r_my4' && p.tag === 'X1')).toBe(true);
  });

  it('a접점에 b 번호 (1-4), 기기에 없는 번호는 [검사] 가 알리고 자동으로 정한다', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1', { term: '1-4' }], lamp('PL1')]);
    const { m, nums } = numbers(c);
    expect(nums.plans.get('X1')!.bad.map((p) => p.term)).toEqual(['1-4']);
    const msg = checkCircuit(c, m).find((i) => i.msg.includes('접점 번호 1-4'))!.msg;
    expect(msg).toContain('a접점 8-6 · 1-3');
    expect(toWiring(c).notes.some((x) => x.includes('자동으로 정했습니다'))).toBe(true);
    // 전자접촉기에 21-22 를 a접점으로
    const mc = ladder([['coil', 'MC1']], [['no', 'MC1', { term: '21-22' }], lamp('PL1')]);
    expect(numbers(mc).nums.plans.get('MC1')!.bad.length).toBe(1);
  });

  it('같은 번호를 두 접점에 적으면 [검사] 가 알린다', () => {
    const c = ladder([['coil', 'X1']], [['no', 'X1', { term: '8-6' }], lamp('PL1')], [['no', 'X1', { term: '8-6' }], lamp('PL2')]);
    const { m } = numbers(c);
    expect(checkCircuit(c, m).some((i) => i.msg.includes('두 접점에 적었습니다'))).toBe(true);
  });

  it('번호 글 읽기: 8-6 · 8 - 6 · 8~6 · 13/14', () => {
    expect(['8-6', '8 - 6', '8~6', '13/14', 'a-b', '', undefined].map((t) => parseTerm(t))).toEqual([['8', '6'], ['8', '6'], ['8', '6'], ['13', '14'], null, null, null]);
  });

  it('실물 배선도 → 회로도 → 실물 배선도: 회로도에 붙은 실물 번호가 그대로 맞는다', () => {
    let checked = 0;
    for (const ex of circuitExamples()) {
      const real = ex.build();
      if (!real.parts.some((p) => p.type === 'r_relay8' || p.type === 'r_my4' || p.type === 'r_timer8')) continue;
      const s = toSchematic(real).circuit;
      const { nums } = numbers(s);
      for (const plan of nums.plans.values()) expect(plan.bad.map((p) => `${plan.tag} ${p.term}`), ex.id).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });
});
