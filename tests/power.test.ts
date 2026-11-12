import { describe, expect, it } from 'vitest';
import type { CableSpec, Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { CircuitModel, CircuitSim } from '../src/circuit/engine';
import { pinPositions } from '../src/circuit/parts';
import { analyzePower, cableIz, cableSizes, dropLimit, groupFactor, PowerModel, RHO_CU, tableIz, tempFactor, X_PER_M } from '../src/circuit/power';
import { sanitizeCircuit } from '../src/circuit/sanitize';

let n = 0;
const part = (type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}): Part => ({ id: `p${n++}`, type, x, y, rot: 0, tag, ...extra });
const pinAt = (p: Part, i: number) => pinPositions(p)[i];
/** 두 단자를 ㄱ 자로 잇는다 (세로 → 가로). 규격을 주면 꺾인 선 전체가 한 가닥 */
function link(a: [number, number], b: [number, number], cable?: CableSpec): Wire[] {
  const mid: [number, number] = [a[0], b[1]];
  const out: Wire[] = [];
  if (a[1] !== b[1]) out.push({ id: `w${n++}`, a, b: mid, ...(cable ? { cable } : {}) });
  if (a[0] !== b[0]) out.push({ id: `w${n++}`, a: mid, b, ...(cable ? { cable } : {}) });
  return out;
}
const spec = (o: Partial<CableSpec> = {}): CableSpec => ({ ins: 'xlpe', mm2: 2.5, method: 'B1', cores: 2, len: 20, ...o });
const solve = (c: Circuit) => {
  const model = new CircuitModel(c);
  return new PowerModel(c, model).solve(new CircuitSim(model));
};

describe('ampacity tables (KS C IEC 60364-5-52)', () => {
  it('reads the tables as printed', () => {
    // 표 B.52.2 · B.52.3 (2개 부하 도체)
    expect(tableIz(spec({ ins: 'pvc', mm2: 2.5, method: 'C' }))).toBe(27);
    expect(tableIz(spec({ ins: 'pvc', mm2: 120, method: 'D2' }))).toBe(261);
    expect(tableIz(spec({ ins: 'xlpe', mm2: 1.5, method: 'A1' }))).toBe(19);
    expect(tableIz(spec({ ins: 'xlpe', mm2: 300, method: 'C' }))).toBe(693);
    // 표 B.52.5 (XLPE 3개 부하 도체)
    expect(tableIz(spec({ mm2: 6, cores: 3 }))).toBe(48);
    expect(tableIz(spec({ mm2: 25, cores: 3, method: 'C' }))).toBe(119);
    expect(tableIz(spec({ mm2: 300, cores: 3, method: 'D2' }))).toBe(419);
    // 케이블 트레이 (40℃ 기준 표): 작은 굵기는 없다
    expect(tableIz(spec({ mm2: 25, cores: 3, method: 'E' }))).toBe(116);
    expect(tableIz(spec({ mm2: 25, cores: 3, method: 'F' }))).toBe(123);
    expect(tableIz(spec({ mm2: 2.5, cores: 3, method: 'E' }))).toBeNull();
    expect(cableSizes('xlpe', 3, 'F')[0]).toBe(25);
    expect(cableSizes('pvc', 2, 'B1')).toHaveLength(12);
    // 표에 없는 굵기
    expect(tableIz(spec({ mm2: 3 }))).toBeNull();
  });

  it('applies ambient temperature and grouping factors', () => {
    expect(tempFactor(spec())).toBe(1);
    expect(tempFactor(spec({ amb: 40 }))).toBe(0.91);
    expect(tempFactor(spec({ ins: 'pvc', amb: 40 }))).toBe(0.87);
    expect(tempFactor(spec({ ins: 'pvc', amb: 50 }))).toBe(0.71);
    // 트레이 표는 40℃ 가 기준
    expect(tempFactor(spec({ method: 'E', mm2: 25 }))).toBe(1);
    expect(tempFactor(spec({ method: 'E', mm2: 25, amb: 30 }))).toBeCloseTo(1 / 0.91, 6);
    expect(groupFactor(spec({ group: 3 }))).toBe(0.7);
    expect(groupFactor(spec({ group: 10 }))).toBe(0.45);
    expect(groupFactor(spec({ method: 'E', group: 4 }))).toBe(0.8);
    expect(cableIz(spec({ mm2: 6, cores: 3 }))).toBe(48);
    expect(cableIz(spec({ mm2: 6, cores: 3, amb: 40 }))).toBe(43.7);
    expect(cableIz(spec({ mm2: 6, cores: 3, amb: 40, group: 3 }))).toBe(30.6);
    expect(cableIz({ kind: 'bus', ins: 'xlpe', mm2: 60, method: 'C', cores: 3, len: 1, iz: 215 })).toBe(215);
  });

  it('voltage drop limits follow the supply type', () => {
    expect(dropLimit('lv', true, 30)).toBe(3);
    expect(dropLimit('lv', false, 30)).toBe(5);
    expect(dropLimit('hv', true, 30)).toBe(6);
    expect(dropLimit('hv', false, 30)).toBe(8);
    // 100 m 를 넘는 부분: m 당 0.005%, 0.5% 까지
    expect(dropLimit('lv', false, 150)).toBeCloseTo(5.25, 6);
    expect(dropLimit('lv', false, 400)).toBeCloseTo(5.5, 6);
  });
});

describe('currents and voltages', () => {
  /** 단상: L · N → 차단기 2P → 부하 2.2 kW. L 선과 N 선의 규격을 따로 준다 */
  function single(l?: CableSpec, nn?: CableSpec, watt = 2200): Circuit {
    const L = part('r_term', 0, 0, '', { pole: 'L' });
    const N = part('r_term', 2, 0, '', { pole: 'N' });
    const br = part('r_mcb2', 1, 8, 'MCB1', { amps: 20 });
    const ld = part('r_load1', 1, 30, 'LD1', { watt, pf: 1 });
    return {
      parts: [L, N, br, ld],
      wires: [...link(pinAt(L, 0), pinAt(br, 0)), ...link(pinAt(N, 0), pinAt(br, 1)), ...link(pinAt(br, 2), pinAt(ld, 0), l), ...link(pinAt(br, 3), pinAt(ld, 1), nn)],
      ops: [],
    };
  }

  it('single-phase load: rated current with ideal wires', () => {
    const c = single();
    const st = solve(c);
    const ld = st.loads.get(c.parts[3].id)!;
    expect(ld.v).toBeCloseTo(220, 6);
    expect(ld.i).toBeCloseTo(10, 6);
    expect(ld.p).toBeCloseTo(2200, 4);
    // 차단기 · 전원에도 같은 전류
    expect(st.partI.get(c.parts[2].id)).toBeCloseTo(10, 6);
    expect(st.supply.get('L1')).toBeCloseTo(10, 6);
    expect(st.supply.get('N')).toBeCloseTo(10, 6);
    for (const w of c.wires) expect(st.wireI.get(w.id)).toBeCloseTo(10, 6);
  });

  it('single-phase voltage drop matches the hand calculation', () => {
    const cb = spec({ mm2: 2.5, len: 20 });
    // 한 가닥: R = ρL/S, X = λL
    const R = (RHO_CU * 20) / 2.5;
    const X = X_PER_M * 20;
    expect(R).toBeCloseTo(0.18, 9);
    const Zl = (220 * 220) / 2200;
    // L 선만 규격이 있을 때
    let st = solve(single(cb));
    let i = 220 / Math.hypot(Zl + R, X);
    let ld = [...st.loads.values()][0];
    expect(ld.i).toBeCloseTo(i, 6);
    expect(ld.v).toBeCloseTo(i * Zl, 6);
    // L · N 둘 다: 왕복이라 두 배
    st = solve(single(cb, cb));
    i = 220 / Math.hypot(Zl + 2 * R, 2 * X);
    ld = [...st.loads.values()][0];
    expect(ld.i).toBeCloseTo(i, 6);
    expect(ld.v).toBeCloseTo(i * Zl, 6);
    expect(((220 - ld.v) / 220) * 100).toBeCloseTo(1.61, 1);
  });

  it('balanced 3-phase load: line current, voltage drop and an idle neutral', () => {
    const cb = spec({ mm2: 4, len: 50, cores: 3 });
    const src = ['L1', 'L2', 'L3'].map((pole, k) => part('r_term', 2 * k, 0, '', { pole: pole as Part['pole'] }));
    const br = part('r_mcb3', 2, 8, 'MCB1', { amps: 30 });
    const ld = part('r_load3', 2, 30, 'LD1', { watt: 7500, pf: 0.9 });
    const c: Circuit = { parts: [...src, br, ld], wires: [0, 1, 2].flatMap((k) => [...link(pinAt(src[k], 0), pinAt(br, k)), ...link(pinAt(br, 3 + k), pinAt(ld, k), cb)]), ops: [] };
    const st = solve(c);
    const vll = 220 * Math.sqrt(3);
    const S = 7500 / 0.9;
    const zAbs = (vll * vll) / S;
    const [zr, zx] = [zAbs * 0.9, zAbs * Math.sqrt(1 - 0.81)];
    const R = (RHO_CU * 50) / 4;
    const X = X_PER_M * 50;
    const i = 220 / Math.hypot(zr + R, zx + X);
    const res = st.loads.get(ld.id)!;
    expect(res.i).toBeCloseTo(i, 6);
    expect(res.v).toBeCloseTo(i * zAbs * Math.sqrt(3), 5);
    expect(res.p).toBeCloseTo(3 * i * i * zr, 3);
    expect(st.partI.get(br.id)).toBeCloseTo(i, 6);
    for (const pole of ['L1', 'L2', 'L3']) expect(st.supply.get(pole)).toBeCloseTo(i, 6);
    // 전압강하 약 1.45%
    expect(((vll - res.v) / vll) * 100).toBeCloseTo(1.45, 1);
  });

  it('adds the currents of loads behind one breaker as phasors, and nothing flows when it is off', () => {
    const L = part('r_term', 0, 0, '', { pole: 'L' });
    const N = part('r_term', 2, 0, '', { pole: 'N' });
    const br = part('r_mcb2', 1, 8, 'MCB1', { amps: 20 });
    const a = part('r_load1', 1, 30, 'LD1', { watt: 2200, pf: 1 });
    const b = part('r_load1', 12, 24, 'LD2', { watt: 2200, pf: 0.8 });
    const w = (p: [number, number], q: [number, number]): Wire => ({ id: `w${n++}`, a: p, b: q });
    // 차단기 아래 두 선에서 T 로 갈라 둘째 부하로 (L 은 y=20, N 은 y=18 에서 갈라 서로 닿지 않게)
    const c: Circuit = {
      parts: [L, N, br, a, b],
      wires: [...link(pinAt(L, 0), pinAt(br, 0)), ...link(pinAt(N, 0), pinAt(br, 1)), w([0, 12], [0, 27]), w([2, 12], [2, 27]), w([0, 20], [11, 20]), w([11, 20], [11, 21]), w([2, 18], [13, 18]), w([13, 18], [13, 21])],
      ops: [],
    };
    expect(pinAt(a, 0)).toEqual([0, 27]);
    expect(pinAt(b, 1)).toEqual([13, 21]);
    const model = new CircuitModel(c);
    const pm = new PowerModel(c, model);
    const sim = new CircuitSim(model);
    let st = pm.solve(sim);
    // 10 A (역률 1) + 12.5 A (역률 0.8): 10 + 12.5·(0.8 − j0.6) = 20 − j7.5
    expect(st.loads.get(b.id)!.i).toBeCloseTo(12.5, 6);
    expect(st.partI.get(br.id)).toBeCloseTo(Math.hypot(20, 7.5), 6);
    const sig = pm.signature(sim);
    sim.setAct('MCB1', false);
    expect(pm.signature(sim)).not.toBe(sig);
    st = pm.solve(sim);
    expect(st.loads.get(a.id)!.i).toBeCloseTo(0, 9);
    expect(st.partI.get(br.id) ?? 0).toBeCloseTo(0, 9);
  });

  it('reports a short instead of numbers', () => {
    const L = part('r_term', 0, 0, '', { pole: 'L' });
    const N = part('r_term', 4, 0, '', { pole: 'N' });
    const c: Circuit = { parts: [L, N, part('r_load1', 10, 10, 'LD1')], wires: link(pinAt(L, 0), pinAt(N, 0)), ops: [] };
    expect(solve(c).shorted).toBe(true);
    expect(analyzePower(c).shorted).toBe(true);
  });
});

describe('design checks', () => {
  /** 3상: 전원 → MCB (정격) → 케이블 → 부하 */
  function feeder(amps: number, cb: CableSpec, watt: number, lighting = false): Circuit {
    const src = ['L1', 'L2', 'L3'].map((pole, k) => part('r_term', 2 * k, 0, '', { pole: pole as Part['pole'] }));
    const br = part('r_mcb3', 2, 8, 'MCB1', { amps });
    const ld = part('r_load3', 2, 30, 'LD1', { watt, pf: 1, ...(lighting ? { lighting: true } : {}) });
    return { parts: [...src, br, ld], wires: [0, 1, 2].flatMap((k) => [...link(pinAt(src[k], 0), pinAt(br, k)), ...link(pinAt(br, 3 + k), pinAt(ld, k), cb)]), ops: [] };
  }

  it('passes a correctly sized feeder', () => {
    // 7.5 kW → 11.4 A, 차단기 20 A, XLPE 4 mm² B1 3상 (37 A), 30 m
    const a = analyzePower(feeder(20, spec({ mm2: 4, cores: 3, len: 30 }), 7500));
    expect(a.issues.filter((i) => i.level !== 'info')).toEqual([]);
    // 3상 세 가닥은 한 줄로
    expect(a.cables).toHaveLength(1);
    expect(a.cables[0]).toMatchObject({ iz: 37, breaker: 'MCB1', breakerAmps: 20, from: 'MCB1', to: 'LD1 (3가닥)', count: 3 });
    expect(a.cables[0].wires.length).toBeGreaterThanOrEqual(3);
    expect(a.cables[0].ib).toBeCloseTo(11.3, 1);
    expect(a.breakers[0]).toMatchObject({ tag: 'MCB1', amps: 20 });
    expect(a.loads[0].dropPct).toBeGreaterThan(0.5);
    expect(a.loads[0].dropPct).toBeLessThan(1);
    expect(a.loads[0].len).toBe(30);
    expect(a.peakKw).toBeCloseTo(7.4, 1);
    expect(a.supply.map((s) => s.pole)).toEqual(['L1', 'L2', 'L3']);
  });

  it('flags a cable that is too thin, a breaker above the ampacity and an overloaded breaker', () => {
    // 22 kW → 약 33 A: PVC 2.5 mm² (21 A) 로는 부족, 차단기 30 A 는 전선 허용전류보다 크고 전류도 넘는다
    const a = analyzePower(feeder(30, spec({ ins: 'pvc', mm2: 2.5, cores: 3, len: 10 }), 22000));
    const msgs = a.issues.map((i) => i.msg).join('\n');
    expect(msgs).toContain('허용전류 21 A 를 넘습니다');
    expect(msgs).toContain('차단기 MCB1 정격 30 A 가 전선 허용전류 21 A 보다 큽니다');
    expect(msgs).toContain('차단기 정격 30 A 를 넘습니다');
    expect(a.issues.filter((i) => i.level === 'error')).toHaveLength(3);
    // 문제를 누르면 전선과 차단기를 가리킬 수 있다
    expect(a.issues.find((i) => i.msg.includes('보다 큽니다'))!.partIds).toHaveLength(1);
    expect(a.issues.find((i) => i.msg.includes('넘습니다'))!.wireIds.length).toBeGreaterThan(0);
  });

  it('flags voltage drop: lighting is stricter than other loads', () => {
    // 6 kW, 1.5 mm² 120 m: 약 9 A 로 허용전류 안이지만 전압강하가 크다
    const cb = spec({ mm2: 1.5, cores: 3, len: 120 });
    const other = analyzePower(feeder(16, cb, 6000));
    expect(other.loads[0].dropPct).toBeGreaterThan(5.1);
    expect(other.loads[0].limit).toBeCloseTo(5.1, 6);
    expect(other.issues.some((i) => i.msg.includes('전압강하'))).toBe(true);
    const thick = analyzePower(feeder(16, spec({ mm2: 4, cores: 3, len: 120 }), 6000));
    expect(thick.issues.filter((i) => i.level !== 'info')).toEqual([]);
    // 같은 굵기라도 조명이면 3% (+ 100 m 초과분) 를 넘는다
    const light = analyzePower(feeder(16, spec({ mm2: 2.5, cores: 3, len: 120 }), 6000, true));
    expect(light.loads[0].dropPct).toBeGreaterThan(3.1);
    expect(light.loads[0].dropPct).toBeLessThan(5);
    expect(light.issues.some((i) => i.msg.includes('조명'))).toBe(true);
  });

  it('takes the worst case over the operation sequence', () => {
    // 전동기는 기동 버튼을 눌러야 돈다: 조작 순서가 없으면 전류 0, 있으면 정격 전류
    const L = ['L1', 'L2', 'L3'].map((pole, k) => part('r_term', 2 * k, 0, '', { pole: pole as Part['pole'] }));
    const ss = part('r_ss', 20, 10, 'SS');
    const N = part('r_term', 30, 0, '', { pole: 'N' });
    const mc = part('r_mc', 3, 20, 'MC1');
    const m = part('r_motor3', 2, 40, 'M1', { watt: 3700 });
    const cb = spec({ mm2: 2.5, cores: 3, len: 25 });
    const c: Circuit = {
      parts: [...L, N, ss, mc, m],
      wires: [
        ...[0, 1, 2].flatMap((k) => [...link(pinAt(L[k], 0), pinAt(mc, 2 + k)), ...link(pinAt(mc, 7 + k), pinAt(m, k), cb)]),
        ...link(pinAt(L[0], 0), pinAt(ss, 2)),
        ...link(pinAt(ss, 3), pinAt(mc, 0)),
        ...link(pinAt(mc, 1), pinAt(N, 0)),
      ],
      ops: [],
    };
    expect(analyzePower(c).loads.find((l) => l.tag === 'M1')!.i).toBe(0);
    c.ops = [{ id: 'a', wait: 500, tag: 'SS', action: 'on', hold: 0 }];
    const a = analyzePower(c);
    // 3.7 kW, 역률 0.85, 효율 0.88: I = P / (√3 · V · pf · η)
    const rated = 3700 / (Math.sqrt(3) * 220 * Math.sqrt(3) * 0.85 * 0.88);
    const motor = a.loads.find((l) => l.tag === 'M1')!;
    expect(motor.i).toBeGreaterThan(rated * 0.98);
    expect(motor.i).toBeLessThan(rated);
    expect(motor.watt).toBe(3700);
    expect(a.cables.every((r) => r.ib > 7)).toBe(true);
  });

  it('keeps cable specs, ratings and supply settings through saving', () => {
    const c = feeder(20, spec({ mm2: 4, cores: 3, len: 30, amb: 40, group: 2 }), 7500, true);
    c.supply = 'hv';
    c.vll = 440;
    c.parts.push(part('r_panel', -5, -5, 'PNL1', { name: 'MAIN', w: 30, h: 50 }));
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.wires.find((w) => w.cable)!.cable).toEqual({ ins: 'xlpe', mm2: 4, method: 'B1', cores: 3, len: 30, amb: 40, group: 2 });
    expect(back.parts.find((p) => p.type === 'r_mcb3')!.amps).toBe(20);
    expect(back.parts.find((p) => p.type === 'r_load3')).toMatchObject({ watt: 7500, pf: 1, lighting: true });
    expect(back.parts.find((p) => p.type === 'r_panel')).toMatchObject({ w: 30, h: 50 });
    expect(back.supply).toBe('hv');
    expect(back.vll).toBe(440);
    const a = analyzePower(back);
    expect(a.vll).toBeCloseTo(440, 6);
    expect(a.panels[0]).toMatchObject({ name: 'PNL1 MAIN', kw: 7.5, loads: 1 });
    // 고압 수전 조명 6%
    expect(a.loads[0].limit).toBe(6);
  });
});

describe('feeder analysis example (main panel, busbars, two sub-panels)', () => {
  it('finds exactly the two problems that were put in on purpose', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const { checkCircuit, partsList } = await import('../src/circuit/bom');
    const c = circuitExamples().find((e) => e.id === 'feeders')!.build();
    expect(checkCircuit(c)).toEqual([]);
    const a = analyzePower(c);
    expect(a.shorted).toBe(false);
    const errs = a.issues.filter((i) => i.level === 'error').map((i) => i.msg);
    expect(errs).toHaveLength(2);
    // LP-2 급전선 2.5 mm² (28 A) 를 30 A 차단기로 보호할 수 없다
    expect(errs[0]).toContain('차단기 MCB2 정격 30 A 가 전선 허용전류 28 A 보다 큽니다');
    // 조명 2 kW 를 1.5 mm² 80 m 로: 3% 를 훌쩍 넘는다
    expect(errs[1]).toContain('LD2: 전압강하');
    const row = (from: string) => a.cables.find((r) => r.from === from)!;
    expect(row('MCB1')).toMatchObject({ to: 'MCB11 (3가닥)', iz: 66, breakerAmps: 50, count: 3 });
    expect(row('MCB11')).toMatchObject({ to: 'LD1 (3가닥)', iz: 48, breakerAmps: 40 });
    expect(row('부스바')).toMatchObject({ iz: 200, breaker: 'MCB0' });
    // 15 kW, 역률 0.9: 정격 약 25.3 A (전압강하만큼 조금 덜 흐른다)
    const ld1 = a.loads.find((l) => l.tag === 'LD1')!;
    expect(ld1.i).toBeGreaterThan(24.5);
    expect(ld1.i).toBeLessThan(25.3);
    expect(ld1.dropPct).toBeGreaterThan(1);
    expect(ld1.dropPct).toBeLessThan(2);
    expect(ld1.len).toBe(55);
    const ld2 = a.loads.find((l) => l.tag === 'LD2')!;
    expect(ld2.lighting).toBe(true);
    expect(ld2.dropPct).toBeGreaterThan(10);
    // 100 m 를 넘는 43 m 만큼 허용값이 늘어난다
    expect(ld2.limit).toBeCloseTo(3.215, 3);
    // 메인 차단기에는 두 분전반의 전류가 벡터로 더해진다. 조명이 물린 L3 가 가장 크고, N 에는 조명 전류만
    const main = a.breakers.find((b) => b.tag === 'MCB0')!;
    const sup = Object.fromEntries(a.supply.map((s) => [s.pole, s.i]));
    expect(main.i).toBeCloseTo(sup.L3, 2);
    expect(sup.L3).toBeGreaterThan(sup.L1 + 5);
    expect(sup.L1).toBeCloseTo(sup.L2, 1);
    expect(sup.N).toBeCloseTo(ld2.i, 2);
    expect(a.panels.map((p) => [p.name.split(' ')[0], p.kw])).toEqual([['MAIN', 0], ['LP-1', 15], ['LP-2', 5.7]]);
    // 굵기를 키우면 문제가 없어진다: 급전선 6 mm² (48 A), 조명 회로 10 mm².
    // 급전선을 4 mm² (37 A) 로만 키우면 차단기 문제는 풀리지만 조명 전압강하는 급전선 몫이 남아 3% 를 넘는다
    for (const w of c.wires) {
      if (w.cable?.len === 60) w.cable = { ...w.cable, mm2: 6 };
      if (w.cable?.len === 80) w.cable = { ...w.cable, ins: 'xlpe', mm2: 10 };
    }
    const fixed = analyzePower(c);
    expect(fixed.issues.filter((i) => i.level !== 'info')).toEqual([]);
    expect(fixed.loads.find((l) => l.tag === 'LD2')!.dropPct).toBeLessThan(3.2);
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'LD1')).toMatchObject({ kind: '부하', spec: '3상 15 kW, pf 0.9' });
    expect(rows.find((r) => r.tag === 'MCB0')?.spec).toBe('3P 100A');
    expect(rows.find((r) => r.tag === 'LP-1')?.kind).toBe('분전반 · 변전함');
  });

  it('follows the wire chain through corners when a cable spec is applied', async () => {
    const { wireChain } = await import('../src/circuit/wires');
    const { circuitExamples } = await import('../src/circuit/examples');
    const c = circuitExamples().find((e) => e.id === 'feeders')!.build();
    // N 선: (21,0) → (21,48) → (28,48) → (28,50) 세 토막이 한 가닥
    const first = c.wires.find((w) => w.a[0] === 21 && w.a[1] === 0)!;
    expect(wireChain(c, [first.id])).toHaveLength(3);
    // 단자에서 끝나는 급전선은 한 토막
    const feeder = c.wires.find((w) => w.a[0] === 4 && w.a[1] === 24)!;
    expect(wireChain(c, [feeder.id])).toEqual([feeder.id]);
  });
});

describe('analysis on any circuit, automatic sizing', () => {
  it('reports every load and the wires without a spec, also for circuits that have no cable specs', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    for (const id of ['real', 'panel', 'self-hold', 'tsw-light', 'timer']) {
      const ex = circuitExamples().find((e) => e.id === id)!;
      const c = ex.build();
      const a = analyzePower(c, new CircuitModel(c, ex.plc?.()));
      expect(a.loads.length, id).toBeGreaterThan(0);
      // 조작 순서에서 켜진 부하가 하나는 있고, 그 전류가 흐르는 규격 없는 전선이 표에 나온다
      expect(a.loads.some((l) => l.on), id).toBe(true);
      expect(a.issues.some((i) => i.level === 'info' && i.msg.includes('케이블 규격이 하나도 없어서')), id).toBe(id !== 'panel');
    }
    // 제어반 예제: 릴레이 · 타이머 · 램프 같은 작은 부하도 빠지지 않는다 (작은 부하로 표시)
    const panel = circuitExamples().find((e) => e.id === 'panel')!.build();
    const pa = analyzePower(panel);
    expect(pa.loads.map((l) => l.tag).sort()).toEqual(['GL', 'RL', 'T1', 'X1', 'YL']);
    expect(pa.loads.every((l) => l.minor)).toBe(true);
    // 전동기 예제: 전동기까지 가는 세 가닥이 한 줄로, 권장 굵기와 함께
    const real = circuitExamples().find((e) => e.id === 'real')!.build();
    const ra = analyzePower(real);
    const motor = ra.loads.find((l) => l.tag === 'M1')!;
    expect(motor.minor).toBe(false);
    expect(motor.i).toBeGreaterThan(7);
    const lead = ra.bare.find((r) => r.to === 'M1')!;
    expect(lead).toMatchObject({ from: 'MC1', count: 3, cores: 3, breaker: 'MCB1', breakerAmps: 25 });
    // 차단기 25 A 를 감당하는 XLPE B1 3상: 2.5 mm² (28 A)
    expect(lead.suggest).toBe(2.5);
    expect(ra.bare[0].ib).toBeGreaterThanOrEqual(ra.bare[ra.bare.length - 1].ib);
  });

  it('suggests the smallest size that carries the current', async () => {
    const { suggestSize } = await import('../src/circuit/power');
    expect(suggestSize({ ins: 'xlpe', method: 'B1', cores: 3 }, 30)).toBe(4);
    expect(suggestSize({ ins: 'xlpe', method: 'B1', cores: 3 }, 28)).toBe(2.5);
    expect(suggestSize({ ins: 'pvc', method: 'B1', cores: 2 }, 20)).toBe(2.5);
    // 보정계수가 있으면 더 굵게: 4 mm² 는 37 × 0.91 × 0.7 = 23.6 A, 6 mm² 는 48 × 0.637 = 30.6 A
    expect(suggestSize({ ins: 'xlpe', method: 'B1', cores: 3, amb: 40, group: 3 }, 30)).toBe(6);
    expect(suggestSize({ ins: 'pvc', method: 'B1', cores: 3 }, 1000)).toBeNull();
  });

  it('auto-sizing fixes the feeder example without touching breakers or loads', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const { autoSize } = await import('../src/circuit/power');
    const c = circuitExamples().find((e) => e.id === 'feeders')!.build();
    const before = analyzePower(c);
    expect(before.issues.filter((i) => i.level === 'error')).toHaveLength(2);
    // 굵기 권장이 문제 문구에 들어 있다: 30 A 차단기 → 4 mm² (37 A)
    expect(before.issues[0].msg).toContain('→ 4 mm² 이상');
    const res = autoSize(c);
    expect(res.left).toBe(0);
    expect(res.assigned).toBe(0);
    expect(res.resized).toBeGreaterThanOrEqual(2);
    const after = analyzePower(res.circuit);
    expect(after.issues.filter((i) => i.level === 'error')).toEqual([]);
    for (const l of after.loads) if (l.dropPct !== null) expect(l.dropPct, l.tag).toBeLessThanOrEqual(l.limit);
    for (const r of after.cables) if (r.iz !== null) expect(Math.max(r.ib, r.breakerAmps ?? 0), r.from).toBeLessThanOrEqual(r.iz);
    // 원래 회로와 차단기 · 부하는 그대로
    expect(c.wires.find((w) => w.cable?.len === 60)!.cable!.mm2).toBe(2.5);
    expect(res.circuit.parts).toEqual(c.parts);
    expect(res.circuit.wires.find((w) => w.cable?.len === 60)!.cable!.mm2).toBeGreaterThanOrEqual(4);
    // 문제 없던 LP-1 쪽은 그대로
    expect(res.circuit.wires.find((w) => w.cable?.len === 40)!.cable!.mm2).toBe(10);
  });

  it('assigns specs to bare wires from the current and the breaker above, with lengths estimated from the drawing', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const { autoSize, drawnLength } = await import('../src/circuit/power');
    expect(drawnLength(12)).toBe(0.12);
    expect(drawnLength(3)).toBe(0.1);
    const c = circuitExamples().find((e) => e.id === 'real')!.build();
    expect(c.wires.some((w) => w.cable)).toBe(false);
    const res = autoSize(c, undefined, { assign: true });
    expect(res.assigned).toBeGreaterThanOrEqual(3);
    expect(res.left).toBe(0);
    const a = analyzePower(res.circuit);
    expect(a.bare).toEqual([]);
    expect(a.issues).toEqual([]);
    const lead = a.cables.find((r) => r.to.startsWith('M1'))!;
    expect(lead).toMatchObject({ from: 'MC1', count: 3, breakerAmps: 25, iz: 28 });
    expect(lead.spec).toMatchObject({ ins: 'xlpe', mm2: 2.5, method: 'B1', cores: 3 });
    // 판넬 안 선은 그림 길이로 어림해서 짧다 (전압강하에 거의 영향 없음)
    expect(lead.spec.len).toBeLessThan(1);
    expect(a.loads.find((l) => l.tag === 'M1')!.dropPct).toBeLessThan(0.1);
  });
});

describe('ease of use helpers', () => {
  it('selects the parallel conductors between the same two devices', async () => {
    const { parallelWires, wireChain } = await import('../src/circuit/wires');
    const { circuitExamples } = await import('../src/circuit/examples');
    const c = circuitExamples().find((e) => e.id === 'feeders')!.build();
    // LP-1 급전선의 L1 한 가닥 → L2 · L3 까지 세 가닥
    const l1 = c.wires.find((w) => w.a[0] === 4 && w.a[1] === 24)!;
    const all = parallelWires(c, [l1.id]);
    expect(wireChain(c, [l1.id])).toHaveLength(1);
    expect(all).toHaveLength(3);
    expect(all.map((id) => c.wires.find((w) => w.id === id)!.a[0]).sort((a, b) => a - b)).toEqual([4, 6, 8]);
    // 분기점에서 끝나는 가닥 (부스바) 은 혼자
    const bus = c.wires.find((w) => w.cable?.kind === 'bus')!;
    expect(parallelWires(c, [bus.id])).toEqual([bus.id]);
  });

  it('sizes the line in front of the main breaker for that breaker', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const real = circuitExamples().find((e) => e.id === 'real')!.build();
    const incoming = analyzePower(real).bare.find((r) => r.from === '전원')!;
    // 위쪽에 차단기는 없지만 끝에 물린 MCB1 (25 A) 이 전류를 제한한다 → 2.5 mm² (28 A)
    expect(incoming).toMatchObject({ to: 'MCB1', count: 3, breaker: 'MCB1', breakerAmps: 25, suggest: 2.5 });
  });

  it('auto-sizing keeps the L and N of one load the same size', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const { autoSize } = await import('../src/circuit/power');
    const res = autoSize(circuitExamples().find((e) => e.id === 'feeders')!.build());
    const a = analyzePower(res.circuit);
    const legs = a.cables.filter((r) => r.to.startsWith('LD2 '));
    expect(legs).toHaveLength(2);
    expect(legs[0].spec.mm2).toBe(legs[1].spec.mm2);
    expect(a.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('busbar, 4-pole breakers, taps', () => {
  it('a branch wire connects only to the bar it ends on, not to the bars it crosses', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const c = circuitExamples().find((e) => e.id === 'busbar')!.build();
    const bus = c.parts.find((p) => p.type === 'r_bus')!;
    const net = new CircuitModel(c).net.wireNet;
    const bar = (k: number) => net.get(`${bus.id}~bar${k}`)!;
    expect(new Set([0, 1, 2, 3].map(bar)).size).toBe(4);
    // ELB1 의 탭 (x 13 → 17 · 19 · 21): 각자 끝나는 막대의 상에만 물린다
    const taps = c.wires.filter((w) => w.a[0] === 13 && w.a[1] >= 14 && w.a[1] <= 18 && w.b[1] === w.a[1]);
    expect(taps).toHaveLength(3);
    for (const w of taps) expect(net.get(w.id)).toBe(bar((w.b[0] - 17) / 2));
    // L3 탭은 L1 · L2 막대 위를 지나가지만 붙지 않는다
    const l3 = taps.find((w) => w.b[0] === 21)!;
    expect(net.get(l3.id)).not.toBe(bar(0));
  });

  it('checks the busbar and the taps (3 m tap rule) without false alarms', async () => {
    const { circuitExamples } = await import('../src/circuit/examples');
    const c = circuitExamples().find((e) => e.id === 'busbar')!.build();
    const a = analyzePower(c);
    expect(a.issues.filter((i) => i.level !== 'info')).toEqual([]);
    const bus = a.cables.find((r) => r.spec.kind === 'bus')!;
    expect(bus).toMatchObject({ from: 'BUS1', count: 4, iz: 250, breaker: 'MCB0', breakerAmps: 125 });
    // 수전 전류: 3상 부하 + 단상 두 회로 (L1 · L2) → L2 가 가장 크다
    expect(bus.ib).toBeGreaterThan(55);
    expect(bus.ib).toBeLessThan(65);
    // 부스바 → 분기 차단기 0.3 m 탭: 위쪽 125 A 가 아니라 끝의 분기 차단기로 검토
    const tap = a.cables.find((r) => r.from === 'BUS1' && r.to.startsWith('ELB1'))!;
    expect(tap).toMatchObject({ count: 3, breaker: 'ELB1', breakerAmps: 30, tap: true });
    expect(a.cables.find((r) => r.from === 'ELB1')!.tap).toBeUndefined();
    // 단상 분기 (L1-N, L2-N) 는 2가닥
    expect(a.cables.find((r) => r.to.startsWith('ELB4'))!.count).toBe(2);
  });

  it('applies the tap rule only within 3 m and only below another breaker', () => {
    const build = (len: number): Circuit => {
      const src = part('src', 0, 0, 'L1', { pole: 'L' });
      const neu = part('src', 20, 0, 'N', { pole: 'N' });
      const main = part('r_mcb1', 0, 6, 'MCB0', { amps: 63 });
      const br = part('r_mcb1', 0, 16, 'MCB1', { amps: 16 });
      const ld = part('r_load1', 0, 26, 'LD1', { watt: 2000, pf: 1 });
      const wires: Wire[] = [
        ...link(pinAt(src, 0), pinAt(main, 0)),
        ...link(pinAt(main, 1), pinAt(br, 0), spec({ mm2: 2.5, len, method: 'C' })),
        ...link(pinAt(br, 1), pinAt(ld, 0), spec({ mm2: 2.5 })),
        ...link(pinAt(ld, 1), pinAt(neu, 0)),
      ];
      return { parts: [src, neu, main, br, ld], wires, ops: [] };
    };
    const short = analyzePower(build(0.5));
    expect(short.cables.find((r) => r.to.startsWith('MCB1'))).toMatchObject({ breaker: 'MCB1', breakerAmps: 16, tap: true });
    expect(short.issues.filter((i) => i.level === 'error')).toEqual([]);
    // 5 m 면 위쪽 63 A 가 보호 → 2.5 mm² 로는 In ≤ Iz 가 안 된다
    const long = analyzePower(build(5));
    expect(long.cables.find((r) => r.to.startsWith('MCB1'))).toMatchObject({ breaker: 'MCB0', breakerAmps: 63 });
    expect(long.issues.some((i) => i.level === 'error' && i.msg.includes('MCB0'))).toBe(true);
  });

  it('a 4-pole breaker switches all three phases and N', () => {
    const p = part('r_mcb4', 0, 0, 'MCB1', { amps: 100 });
    const pins = pinPositions(p);
    expect(pins).toHaveLength(8);
    const c: Circuit = { parts: [p], wires: [], ops: [] };
    const model = new CircuitModel(c);
    const sim = new CircuitSim(model);
    const poles = model.conductors.filter((k) => k.part.id === p.id);
    expect(poles).toHaveLength(4);
    expect(poles.every((k) => sim.conductorClosed(k))).toBe(true);
  });

  it('keeps busbar and ELB settings when a file is loaded', () => {
    const c = sanitizeCircuit({
      parts: [
        { id: 'a', type: 'r_bus', x: 0, y: 0, rot: 0, tag: 'BUS1', bars: 3, h: 24, mm2: 60, amps: 200 },
        { id: 'b', type: 'r_mcb4', x: 10, y: 0, rot: 90, tag: 'ELB1', elb: true, amps: 40 },
      ],
      wires: [],
      ops: [],
    })!;
    expect(c.parts[0]).toMatchObject({ bars: 3, h: 24, mm2: 60, amps: 200 });
    expect(c.parts[1]).toMatchObject({ type: 'r_mcb4', elb: true, rot: 90 });
  });
});

describe('editing a busbar', () => {
  it('moving the busbar keeps the branch taps on their bars and square', async () => {
    const { moveSelection } = await import('../src/components/CircuitCanvas');
    const { circuitExamples } = await import('../src/circuit/examples');
    const c = circuitExamples().find((e) => e.id === 'busbar')!.build();
    const bus = c.parts.find((p) => p.type === 'r_bus')!;
    const taps = (x: Circuit) => x.wires.filter((w) => w.a[0] === 13 && w.a[1] >= 14 && w.a[1] <= 18).map((w) => [w.a, w.b]);
    // 막대 방향 (아래로) 으로 밀면 탭은 그 자리
    expect(taps(moveSelection(c, new Set([bus.id]), new Set(), 0, 2))).toEqual(taps(c));
    // 옆으로 밀면 탭 끝이 막대를 따라 옆으로만
    const side = moveSelection(c, new Set([bus.id]), new Set(), 2, 0);
    expect(taps(side)).toEqual(taps(c).map(([a, b]) => [a, [b[0] + 2, b[1]]]));
    const net = new CircuitModel(side).net.wireNet;
    const l3 = side.wires.find((w) => w.a[0] === 13 && w.a[1] === 18)!;
    expect(net.get(l3.id)).toBe(net.get(`${bus.id}~bar2`));
  });
});

describe('supply systems (3-phase 4/3-wire, single-phase 3/2-wire)', () => {
  it('sets the voltage and phase of each pole by the system', async () => {
    const { systemVolts, systemLabel } = await import('../src/circuit/supply');
    const mag = (v: [number, number]) => Math.hypot(v[0], v[1]);
    const d = (a: [number, number], b: [number, number]) => mag([a[0] - b[0], a[1] - b[1]]);
    // 3상 4선식: 상전압 = 선간 ÷ √3
    const a = systemVolts({});
    expect(a.vln).toBe(220);
    expect(d(a.phasor.L1, a.phasor.L2)).toBeCloseTo(381.05, 1);
    expect(systemLabel(a)).toBe('3상 4선식 380/220 V');
    // 3상 3선식 220 V: 선간 220, 중성선 없음
    const b = systemVolts({ system: '3p3w', vll: 220 });
    expect(d(b.phasor.L1, b.phasor.L3)).toBeCloseTo(220, 6);
    expect(b.phasor.N).toBeUndefined();
    expect(systemLabel(b)).toBe('3상 3선식 220 V');
    // 단상 3선식 220/110: L1 · L2 반대 위상
    const c = systemVolts({ system: '1p3w' });
    expect(d(c.phasor.L1, c.phasor.N)).toBeCloseTo(110, 6);
    expect(d(c.phasor.L2, c.phasor.N)).toBeCloseTo(110, 6);
    expect(d(c.phasor.L1, c.phasor.L2)).toBeCloseTo(220, 6);
    expect(c.phasor.L3).toBeUndefined();
    expect(systemLabel(c)).toBe('단상 3선식 220/110 V');
    // 단상 2선식
    const e = systemVolts({ system: '1p2w' });
    expect(d(e.phasor.L1, e.phasor.N)).toBeCloseTo(220, 6);
    expect(systemLabel(e)).toBe('단상 2선식 220 V');
  });

  /** L1 · L2 모선 (왼쪽), N 모선 (오른쪽), 부하 셋: LA = L1-N 1.1 kW, LB = L2-N 1.1 kW, LC = L1-L2 2.2 kW */
  const threeWire = (extra: Partial<Circuit> = {}, volt?: number): Circuit => {
    const l1 = part('src', 0, 0, 'L1', { pole: 'L1' });
    const l2 = part('src', 2, 0, 'L2', { pole: 'L2' });
    const nn = part('src', 40, 0, 'N', { pole: 'N' });
    const a = part('r_load1', 20, 20, 'LA', { watt: 1100, pf: 1, ...(volt ? { volt } : {}) });
    const b = part('r_load1', 20, 40, 'LB', { watt: 1100, pf: 1 });
    const c = part('r_load1', 20, 60, 'LC', { watt: 2200, pf: 1 });
    const w = (a: [number, number], b: [number, number]): Wire => ({ id: `w${n++}`, a, b });
    const bus = (p: Part) => w(pinAt(p, 0), [pinAt(p, 0)[0], 70]);
    const [x1, x2, xn] = [pinAt(l1, 0)[0], pinAt(l2, 0)[0], pinAt(nn, 0)[0]];
    const wires = [
      bus(l1),
      bus(l2),
      bus(nn),
      w([x1, pinAt(a, 0)[1]], pinAt(a, 0)),
      w([xn, pinAt(a, 1)[1]], pinAt(a, 1)),
      w([x2, pinAt(b, 0)[1]], pinAt(b, 0)),
      w([xn, pinAt(b, 1)[1]], pinAt(b, 1)),
      w([x1, pinAt(c, 0)[1]], pinAt(c, 0)),
      w([x2, pinAt(c, 1)[1] - 2], [pinAt(c, 1)[0], pinAt(c, 1)[1] - 2]),
      w([pinAt(c, 1)[0], pinAt(c, 1)[1] - 2], pinAt(c, 1)),
    ];
    return { parts: [l1, l2, nn, a, b, c], wires, ops: [], ...extra };
  };

  it('single-phase 3-wire 220/110 V: 110 V to N, 220 V between L1 and L2, no neutral current when balanced', () => {
    const r = analyzePower(threeWire({ system: '1p3w' }));
    const load = (t: string) => r.loads.find((l) => l.tag === t)!;
    expect(load('LA')).toMatchObject({ v: 110, i: 10 });
    expect(load('LB')).toMatchObject({ v: 110, i: 10 });
    expect(load('LC')).toMatchObject({ v: 220, i: 10 });
    // L1 · L2 는 반대 위상이라 N 으로 돌아오는 전류가 서로 지운다
    expect(r.supply.find((s) => s.pole === 'N')?.i ?? 0).toBeLessThan(0.01);
    expect(r.supply.find((s) => s.pole === 'L1')!.i).toBeCloseTo(20, 1);
    expect(r.systemText).toBe('단상 3선식 220/110 V');
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('the same drawing on 3-phase 4-wire gives 220 V to N and 381 V between lines', () => {
    const r = analyzePower(threeWire());
    expect(r.loads.find((l) => l.tag === 'LA')!.v).toBe(220);
    expect(r.loads.find((l) => l.tag === 'LC')!.v).toBeCloseTo(381, 0);
  });

  it('warns when a device rated for one voltage is wired to another', () => {
    // 정격 220 V 부하를 단상 3선식의 L1-N (110 V) 에
    const r = analyzePower(threeWire({ system: '1p3w' }, 220));
    expect(r.issues.some((i) => i.level === 'error' && i.msg.includes('LA') && i.msg.includes('110 V'))).toBe(true);
  });

  it('3-phase 3-wire has no neutral: an L-N lamp stays off and the check says why', async () => {
    const { checkCircuit } = await import('../src/circuit/bom');
    const { runScenario } = await import('../src/circuit/engine');
    const c = threeWire({ system: '3p3w' });
    const res = runScenario(c);
    const on = (t: string) => res.tracks.find((k) => k.key === `load:${t}`)!.points.some((p) => p.v === 1);
    expect(on('LA')).toBe(false);
    expect(on('LC')).toBe(true);
    expect(checkCircuit(c).some((i) => i.level === 'error' && i.msg.startsWith('N 단자'))).toBe(true);
    const a = analyzePower(c);
    expect(a.loads.find((l) => l.tag === 'LC')!.v).toBeCloseTo(380, 0);
    // N 이 전원이 아니라서 LA · LB 는 떠 있는 N 선을 거쳐 L1-L2 사이에 직렬로 걸린다 (정격보다 작은 전류)
    expect(a.loads.find((l) => l.tag === 'LA')!.i).toBeLessThan(5);
  });

  it('keeps the system when a file is loaded and the timechart follows a change', async () => {
    const { circuitSig } = await import('../src/circuit/chart');
    const c = sanitizeCircuit({ parts: [], wires: [], ops: [], system: '1p3w', vll: 230 })!;
    expect(c).toMatchObject({ system: '1p3w', vll: 230 });
    expect(sanitizeCircuit({ parts: [], wires: [], ops: [], system: 'x' })!.system).toBeUndefined();
    const base = threeWire();
    expect(circuitSig({ ...base, system: '3p3w' })).not.toBe(circuitSig(base));
  });
});
