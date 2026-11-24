import { describe, expect, it } from 'vitest';
import type { Circuit } from '../src/circuit/types';
import { CircuitModel, runScenario } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { toWiring, wirePlan } from '../src/circuit/realize';
import { planLeft } from '../src/circuit/plan';
import { checkCircuit } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { REAL } from '../src/circuit/parts';

const symbolExamples = () => circuitExamples().filter((ex) => !ex.build().parts.some((p) => REAL.has(p.type)));

/** 계획의 넷마다: 그 단자들이 그림에서 한 넷이고, 다른 계획 넷과는 다른 넷인가 */
function matchesPlan(plan: NonNullable<Circuit['plan']>, wired: Circuit): boolean {
  const m = new CircuitModel(wired);
  const seen = new Set<number>();
  for (const pn of plan) {
    const nets = new Set(pn.pins.map(([id, i]) => m.net.pinNet.get(`${id}:${i}`)));
    if (nets.size !== 1) return false;
    const n = [...nets][0]!;
    if (seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

/** 바뀐 값만 (차트 비교용, 칸 이름의 부품 id 는 만들 때마다 달라서 지움) */
const changes = (c: Circuit) =>
  runScenario(c, new CircuitModel(c))
    .tracks.map((t) => [t.key.replace(/cp_[a-z0-9]+/, 'id'), t.points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v).map((p) => [Math.round(p.t), p.v])] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

describe('실물 배선도: 기기만 놓기 → 배치 → [배선 잇기]', () => {
  it('기기만 놓으면 선은 없고 이을 연결이 계획으로 남는다 ([검사] 는 안내 하나)', () => {
    for (const ex of symbolExamples()) {
      const r = toWiring(ex.build(), { wires: false });
      expect(r.circuit.wires, ex.id).toEqual([]);
      expect(r.circuit.plan!.length, ex.id).toBeGreaterThan(2);
      const left = planLeft(r.circuit);
      expect(left, ex.id).toBe(r.circuit.plan!.reduce((s, pn) => s + pn.pins.length - 1, 0));
      const issues = checkCircuit(r.circuit);
      expect(issues.length, ex.id).toBe(1);
      expect(issues[0].msg, ex.id).toContain(`이을 연결 ${left}개`);
    }
  });

  it('[배선 잇기] 는 계획대로 잇고 계획을 지운다: 자동으로 그은 실물 배선도와 시뮬레이션이 같다', () => {
    for (const ex of symbolExamples()) {
      const src = ex.build();
      const placed = toWiring(src, { wires: false }).circuit;
      const w = wirePlan(placed);
      expect(w.failed, ex.id).toBe(0);
      expect(w.circuit.plan, ex.id).toBeUndefined();
      expect(matchesPlan(placed.plan!, w.circuit), ex.id).toBe(true);
      expect(planLeft(w.circuit), ex.id).toBe(0);
      expect(changes(w.circuit), ex.id).toEqual(changes(toWiring(src).circuit));
    }
  });

  it('기기를 옮긴 뒤 이어도 연결은 그대로 (옮긴 자리에서 긋는다)', () => {
    const ex = symbolExamples().find((e) => e.id === 'self-hold') ?? symbolExamples()[0];
    const placed = toWiring(ex.build(), { wires: false }).circuit;
    // 문 (버튼 · 램프) 줄을 오른쪽 아래로 옮긴다
    const moved: Circuit = { ...placed, parts: placed.parts.map((p) => (p.type === 'r_pb' || p.type === 'r_lamp' ? { ...p, x: p.x + 30, y: p.y + 12 } : p)) };
    const w = wirePlan(moved);
    expect(w.failed).toBe(0);
    expect(matchesPlan(placed.plan!, w.circuit)).toBe(true);
    const pb = w.circuit.parts.find((p) => p.type === 'r_pb')!;
    expect(w.circuit.wires.some((x) => x.a[0] === pb.x - 1 || x.b[0] === pb.x - 1 || x.a[0] === pb.x + 1 || x.b[0] === pb.x + 1)).toBe(true);
  });

  it('직접 이은 연결은 남은 수에서 빠지고, 지운 기기의 단자는 건너뛴다', () => {
    const placed = toWiring(symbolExamples()[0].build(), { wires: false }).circuit;
    const before = planLeft(placed);
    // 한 넷만 먼저 이어 둔다 ([배선 잇기] 결과에서 그 넷의 선만 가져옴): 그 넷의 연결 수만큼 줄어든다
    const all = wirePlan(placed).circuit;
    const m = new CircuitModel(all);
    const pn = placed.plan!.find((x) => x.pins.length >= 3) ?? placed.plan![0];
    const n = m.net.pinNet.get(`${pn.pins[0][0]}:${pn.pins[0][1]}`);
    const hand: Circuit = { ...placed, wires: all.wires.filter((w) => m.net.wireNet.get(w.id) === n) };
    expect(hand.wires.length).toBeGreaterThan(0);
    expect(planLeft(hand)).toBe(before - (pn.pins.length - 1));
    // 기기를 하나 지우면 그 단자는 빼고 잇는다
    const lamp = placed.parts.find((p) => p.type === 'r_lamp')!;
    const w = wirePlan({ ...placed, parts: placed.parts.filter((p) => p.id !== lamp.id) });
    expect(w.dropped).toBeGreaterThan(0);
    expect(w.failed).toBe(0);
  });

  it('저장해도 계획이 남고, 없는 부품 · 단자 하나뿐인 넷은 버린다', () => {
    const placed = toWiring(symbolExamples()[0].build(), { wires: false }).circuit;
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(placed)))!;
    expect(back.plan).toEqual(placed.plan);
    const bad = sanitizeCircuit(JSON.parse(JSON.stringify({ ...placed, plan: [{ pins: [['nope', 0], ['x', 1]] }, { pins: [[placed.parts[1].id, 0]] }, 'junk'] })))!;
    expect(bad.plan).toBeUndefined();
  });
});
