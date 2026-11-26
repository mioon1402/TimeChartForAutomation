import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { toWiring } from '../src/circuit/realize';
import { toSchematic } from '../src/circuit/schematic';
import { contactNumbers } from '../src/circuit/contacts';

const changes = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [Math.round(p.t), p.v]);

/** 기호 회로: 줄 1 = L → 버튼 PB1 → 임펄스 코일 LR1 → N, 줄 2 = L → LR1 a접점 → 램프 PL1 → N */
function symbolCircuit(): Circuit {
  let n = 0;
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const rung = (x: number, items: [PartType, string][]) => {
    parts.push({ id: `p${n++}`, type: 'src', x, y: 0, rot: 0, tag: '', pole: 'L' });
    let prev: [number, number] = [x, 0];
    items.forEach(([type, tag], i) => {
      const y = 5 + 6 * i;
      parts.push({ id: `p${n++}`, type, x, y, rot: 0, tag });
      wires.push({ id: `w${n++}`, a: prev, b: [x, y - 2] });
      prev = [x, y + 2];
    });
    const yN = 5 + 6 * items.length;
    parts.push({ id: `p${n++}`, type: 'src', x, y: yN, rot: 0, tag: '', pole: 'N' });
    wires.push({ id: `w${n++}`, a: prev, b: [x, yN] });
  };
  rung(0, [
    ['pb_no', 'PB1'],
    ['imp', 'LR1'],
  ]);
  rung(6, [
    ['no', 'LR1'],
    ['lamp', 'PL1'],
  ]);
  return {
    parts,
    wires,
    ops: [
      { id: 'a', wait: 1000, tag: 'PB1', action: 'press', hold: 300 },
      { id: 'b', wait: 2000, tag: 'PB1', action: 'press', hold: 300 },
      { id: 'c', wait: 2000, tag: 'PB1', action: 'press', hold: 300 },
    ],
  } as unknown as Circuit;
}

describe('임펄스 릴레이 (래칭)', () => {
  it('예제 계단 조명: 1 · 2 · 3층 버튼을 누를 때마다 전등이 켜짐 ↔ 꺼짐, 코일은 누르는 동안만', () => {
    const c = circuitExamples().find((e) => e.id === 'stair-impulse')!.build();
    const m = new CircuitModel(c);
    const r = runScenario(c, m);
    expect(changes(r, 'lr:LR1')).toEqual([
      [0, 0],
      [1000, 1],
      [4000, 0],
      [7000, 1],
      [10000, 0],
    ]);
    expect(changes(r, 'load:EL1')).toEqual(changes(r, 'lr:LR1'));
    expect(changes(r, 'coil:LR1').length).toBe(9);
    expect(checkCircuit(c, m).map((i) => i.msg)).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('회로 기호: 같은 기호의 a접점이 누를 때마다 바뀌고 번호는 13-14 (코일 A1-A2)', () => {
    const c = symbolCircuit();
    const m = new CircuitModel(c);
    const r = runScenario(c, m);
    expect(changes(r, 'load:PL1')).toEqual([
      [0, 0],
      [1000, 1],
      [3000, 0],
      [5000, 1],
    ]);
    const nums = contactNumbers(c, m);
    const id = (t: PartType) => c.parts.find((p) => p.type === t)!.id;
    expect(nums.terms.get(id('no'))).toEqual(['13', '14']);
    expect(nums.terms.get(id('imp'))).toEqual(['A1', 'A2']);
  });

  it('전원이 끊겨도 접점은 그대로 (기계식 래치)', () => {
    const c = symbolCircuit();
    const sim = new CircuitSim(new CircuitModel(c));
    sim.setAct('PB1', true);
    sim.advanceTo(100);
    sim.setAct('PB1', false);
    sim.advanceTo(200);
    expect(sim.on('LR1')).toBe(true);
    // 코일에 전압이 다시 걸리기 전까지는 바뀌지 않는다
    sim.advanceTo(5000);
    expect(sim.on('LR1')).toBe(true);
  });

  it('회로도 → 실물: 임펄스 릴레이 한 대 (13-14 에 램프), 실물 → 회로도: 임펄스 코일 기호로', () => {
    const c = symbolCircuit();
    const w = toWiring(c);
    const lr = w.circuit.parts.find((p) => p.type === 'r_imp')!;
    expect(lr.tag).toBe('LR1');
    expect(w.notes.filter((x) => x.includes('LR1'))).toEqual([]);
    const lamp = w.circuit.parts.find((p) => p.type === 'r_lamp')!;
    expect(w.pinNets.get(`${lr.id}:4`)).toBe(w.pinNets.get(`${lamp.id}:0`));
    const real = circuitExamples().find((e) => e.id === 'stair-impulse')!.build();
    const s = toSchematic(real).circuit;
    expect(s.parts.filter((p) => p.type === 'imp').map((p) => p.tag)).toEqual(['LR1']);
    expect(s.parts.some((p) => p.type === 'no' && p.tag === 'LR1')).toBe(true);
  });
});
