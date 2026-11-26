import { describe, expect, it } from 'vitest';
import type { Circuit, Part, Pole, Wire } from '../src/circuit/types';
import { CircuitModel, CircuitSim } from '../src/circuit/engine';
import { PowerModel } from '../src/circuit/power';
import { pinPositions } from '../src/circuit/parts';

/** 전원 a → 스위치 S1 → 코일 X1 → 전원 b (세로 한 줄) */
function rung(poles: [Pole, Pole], load = true): Circuit {
  const parts: Part[] = [
    { id: 'A', type: 'src', x: 0, y: 0, rot: 0, tag: '', pole: poles[0] },
    { id: 'S1', type: 'sw_no', x: 0, y: 5, rot: 0, tag: 'S1' },
    ...(load ? [{ id: 'X1', type: 'coil', x: 0, y: 11, rot: 0, tag: 'X1' } as Part] : []),
    { id: 'B', type: 'src', x: 0, y: 17, rot: 0, tag: '', pole: poles[1] },
  ];
  const wires: Wire[] = [
    { id: 'w1', a: [0, 0], b: [0, 3] },
    { id: 'w2', a: [0, 7], b: [0, load ? 9 : 17] },
    ...(load ? [{ id: 'w3', a: [0, 13], b: [0, 17] } as Wire] : []),
  ];
  return { parts, wires, ops: [] } as unknown as Circuit;
}
const pin = (c: Circuit, id: string, i: number) => pinPositions(c.parts.find((p) => p.id === id)!)[i];

describe('테스터: 시뮬레이션 중 두 점 사이 전압', () => {
  it('교류 220 V: 열린 접점 양단은 220 V (코일을 거쳐 N 이 옴), 코일 양단은 0 V. 닫으면 반대', () => {
    const c = rung(['L', 'N']);
    const m = new CircuitModel(c);
    const sim = new CircuitSim(m);
    const pm = new PowerModel(c, m);
    const [s1a, s1b, x1a, x1b] = [pin(c, 'S1', 0), pin(c, 'S1', 1), pin(c, 'X1', 0), pin(c, 'X1', 1)];
    let st = pm.solve(sim);
    expect(st.voltBetween(s1a, s1b)).toBeCloseTo(220, 0);
    expect(st.voltBetween(x1a, x1b)).toBeCloseTo(0, 3);
    sim.setAct('S1', true);
    st = pm.solve(sim);
    expect(st.voltBetween(s1a, s1b)).toBeCloseTo(0, 3);
    expect(st.voltBetween(x1a, x1b)).toBeCloseTo(220, 0);
    // L ↔ N 전원 단자끼리
    expect(st.voltBetween([0, 0], [0, 17])).toBeCloseTo(220, 0);
  });

  it('직류 24 V 와 3상 선간 (L1 ↔ L2 = 220 × √3 ≈ 381 V)', () => {
    const dc = rung(['+24V', '0V']);
    const mdc = new CircuitModel(dc);
    expect(new PowerModel(dc, mdc).solve(new CircuitSim(mdc)).voltBetween(pin(dc, 'S1', 0), pin(dc, 'S1', 1))).toBeCloseTo(24, 1);
    const ll = rung(['L1', 'L2']);
    const mll = new CircuitModel(ll);
    expect(new PowerModel(ll, mll).solve(new CircuitSim(mll)).voltBetween([0, 0], [0, 17])).toBeCloseTo(220 * Math.sqrt(3), 1);
  });

  it('부하가 없는 회로에서도 잴 수 있다 (전원 단자끼리), 어디에도 이어지지 않은 점은 0 V', () => {
    const c = rung(['L', 'N'], false);
    const m = new CircuitModel(c);
    const pm = new PowerModel(c, m);
    expect(pm.loads.length).toBe(0);
    const sim = new CircuitSim(m);
    expect(pm.solve(sim).voltBetween([0, 0], [0, 17])).toBeCloseTo(220, 0);
    // 열린 스위치 아래쪽 (선 끝 0,17 은 N) ↔ 위쪽: 스위치가 열려 있으면 220 V
    expect(pm.solve(sim).voltBetween(pin(c, 'S1', 0), pin(c, 'S1', 1))).toBeCloseTo(220, 0);
  });
});
