import { describe, expect, it } from 'vitest';
import type { Circuit, Part, Wire } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { verifyWiring } from '../src/circuit/verify';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { partPins, pidSetting, pinPositions } from '../src/circuit/parts';

const MIN = 60000;
const pts = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [p.t, p.v] as [number, number | string]);
/** 기록에서 그 시각의 값 */
const valueAt = (res: ScenarioResult, key: string, t: number) => {
  let v: number | string = 0;
  for (const p of res.tracks.find((x) => x.key === key)!.points) if (p.t <= t) v = p.v;
  return v;
};
/** 구간 [a, b) 동안 켜져 있던 비율 */
const duty = (res: ScenarioResult, key: string, a: number, b: number) => {
  const ch = pts(res, key);
  let on = 0;
  ch.forEach(([t, v], i) => {
    const t1 = Math.min(b, ch[i + 1]?.[0] ?? b);
    const t0 = Math.max(a, t);
    if (v === 1 && t1 > t0) on += t1 - t0;
  });
  return on / (b - a);
};

describe('PID 온도 조절기 (TK4S 꼴) 예제: 건조로', () => {
  const c = circuitExamples().find((e) => e.id === 'oven-pid')!.build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);
  const tv = (t: number) => Number(valueAt(res, 'tv:건조로', t));

  it('더블 Pt100 의 두 소자가 TK1 · TS1 에 하나씩 이어지고 [검사] 가 깨끗하다', () => {
    const tk = model.tempDef.get('TK1')!;
    const ts = model.tempDef.get('TS1')!;
    expect([tk.sensorOk, ts.sensorOk]).toEqual([true, true]);
    expect(tk.rtdEl).not.toBe(ts.rtdEl);
    expect(tk.pid).toEqual({ pb: 10, ti: 240, td: 60, cycle: 20 });
    expect(ts.pid).toBeNull();
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('처음엔 MV 100% 로 계속 켜고 (3분까지 끊김 없음), 약 19분에 120℃, 넘침은 3℃ 안, 그 뒤 120 ± 1℃', () => {
    const coil = pts(res, 'coil:MC1');
    // 10초 운전 → 첫 제어 주기는 MV 100%
    expect(coil[1]).toEqual([10000, 1]);
    expect(coil[2][0]).toBeGreaterThan(3 * MIN);
    const reach = res.tracks.find((t) => t.key === 'tv:건조로')!.points.find((p) => Number(p.v) >= 120)!.t;
    expect(reach / MIN).toBeGreaterThan(17);
    expect(reach / MIN).toBeLessThan(21);
    const steady = res.tracks.find((t) => t.key === 'tv:건조로')!.points.filter((p) => p.t >= 15 * MIN && p.t < 40 * MIN).map((p) => Number(p.v));
    expect(Math.max(...steady)).toBeLessThan(123);
    expect(Math.min(...steady.filter((_, i) => i > steady.length / 3))).toBeGreaterThan(119);
    expect(Math.abs(tv(39 * MIN) - 120)).toBeLessThan(1);
  });

  it('머무를 때 켜 두는 비율은 열이 빠지는 만큼: 내리는 속도 / (오르는 + 내리는) = 0.03 / 0.13 ≈ 23%, 20초 주기로 켜졌다 꺼짐', () => {
    expect(duty(res, 'coil:MC1', 30 * MIN, 40 * MIN)).toBeCloseTo(0.03 / 0.13, 1);
    const ons = pts(res, 'coil:MC1').filter(([t, v]) => v === 1 && t >= 30 * MIN && t < 40 * MIN);
    // 20초마다 한 번 (10분에 30번 안팎)
    expect(ons.length).toBeGreaterThanOrEqual(28);
    expect(ons.length).toBeLessThanOrEqual(31);
    for (let i = 1; i < ons.length; i++) expect(ons[i][0] - ons[i - 1][0]).toBeCloseTo(20000, 0);
  });

  it('40분에 160℃ 까지 올리면 135℃ 에서 AL1 → 적색등, 150℃ 에서 TS1 이 히터를 끊는다', () => {
    const al = pts(res, 'ta:TK1');
    const cut = pts(res, 'to:TS1');
    // 135℃ 에서 켜지고, 식어서 133℃ (경보 − 히스테리시스 2℃) 로 내려가면 꺼진다
    expect(al.map(([, v]) => v)).toEqual([0, 1, 0]);
    expect(tv(al[1][0])).toBeCloseTo(135, 1);
    expect(tv(al[2][0])).toBeCloseTo(133, 1);
    expect(pts(res, 'load:RL1')[1]).toEqual(al[1]);
    // TS1 (가열 동작 COM-NO) 은 150℃ 에서 열리고, 식어서 145℃ (히스테리시스 5℃) 아래로 내려가면 다시 닫힌다
    const off = cut.find(([t, v]) => t > 40 * MIN && v === 0)!;
    const back = cut.find(([t, v]) => t > off[0] && v === 1)!;
    expect(tv(off[0])).toBeCloseTo(150, 1);
    expect(tv(back[0])).toBeCloseTo(145, 1);
    // 그 뒤 끝까지 히터는 꺼져 있다 (TS1 이 다시 닫혀도 TK1 은 120℃ 위라 MV 0%)
    expect(pts(res, 'coil:MC1').filter(([t, v]) => t > 41 * MIN && v === 1)).toEqual([]);
  });

  it('제어 방식을 ON/OFF 로 바꾸면 T3S 처럼 118 ↔ 120℃ 를 오가고 접촉기는 훨씬 덜 붙는다', () => {
    const onoff: Circuit = { ...c, parts: c.parts.map((p) => (p.tag === 'TK1' ? { ...p, ctrl: 'onoff' } : p)) };
    const r = runScenario(onoff, new CircuitModel(onoff));
    const band = r.tracks.find((t) => t.key === 'tv:건조로')!.points.filter((p) => p.t > 25 * MIN && p.t < 40 * MIN).map((p) => Number(p.v));
    expect(Math.min(...band)).toBeCloseTo(118, 1);
    expect(Math.max(...band)).toBeCloseTo(120, 1);
    const n = (x: ScenarioResult) => pts(x, 'coil:MC1').filter(([t, v]) => v === 1 && t >= 30 * MIN && t < 40 * MIN).length;
    expect(n(r)).toBeLessThan(n(res) / 3);
  });

  it('측온저항체가 빠지면 두 조절기 모두 oPEn 으로 출력을 끈다 (히터는 한 번도 켜지지 않음)', () => {
    const cut: Circuit = { ...c, parts: c.parts.filter((p) => p.tag !== 'PT1') };
    const m2 = new CircuitModel(cut);
    expect([m2.tempDef.get('TK1')!.sensorOk, m2.tempDef.get('TS1')!.sensorOk]).toEqual([false, false]);
    expect(pts(runScenario(cut, m2), 'coil:MC1')).toEqual([[0, 0]]);
    const msgs = checkCircuit(cut, m2).map((i) => i.msg);
    expect(msgs.filter((m) => m.includes('oPEn')).length).toBe(2);
  });

  it('PID 는 전원이 끊기면 처음부터 (적분이 지워짐), 시뮬레이션 중 MV % 를 보여 준다', () => {
    const sim = new CircuitSim(model);
    sim.setAct('SS1', true);
    sim.advanceTo(25 * MIN);
    const v = sim.tempView('TK1')!;
    expect(v.mv).toBeGreaterThan(0);
    expect(v.mv).toBeLessThan(100);
    expect(sim.temps.get('TK1')!.integ).toBeGreaterThan(0);
    sim.setAct('ELB1', false);
    sim.advanceTo(25 * MIN + 1000);
    expect(sim.temps.get('TK1')).toMatchObject({ integ: 0, cycleAt: null, out: false });
  });

  it('PID 값 · 제어 방식은 저장해도 남는다', () => {
    const back = sanitizeCircuit(JSON.parse(JSON.stringify({ ...c, parts: c.parts.map((p) => (p.tag === 'TK1' ? { ...p, pb: 5, ti: 120, td: 0, cycle: 2 } : p)) })))!;
    const tk = back.parts.find((p) => p.tag === 'TK1')!;
    expect(pidSetting(tk)).toEqual({ pb: 5, ti: 120, td: 0, cycle: 2 });
    expect(sanitizeCircuit(JSON.parse(JSON.stringify({ ...c, parts: c.parts.map((p) => (p.tag === 'TK1' ? { ...p, ctrl: 'onoff' } : p)) })))!.parts.find((p) => p.tag === 'TK1')!.ctrl).toBe('onoff');
    expect(partPins(tk).map((p) => p.label)).toEqual(['L', 'N', 'C1', 'OUT1', 'C2', 'AL1', '485+', '485-', 'A', 'B', "B'"]);
  });
});

describe('측온저항체 소자 하나를 두 기기가 같이 쓰면', () => {
  /** 조절기 둘 (TK4S 꼴 · T3S 꼴) 의 A · B · B' 를 측온저항체 하나 (단일 소자) 에 함께 물린 회로 */
  function shared(): Circuit {
    const part = (id: string, type: Part['type'], x: number, y: number, tag: string): Part => ({ id, type, x, y, rot: 0, tag, zone: 'Z' });
    const tk = part('tk', 'r_tk4', 0, 0, 'TK1');
    const ts = part('ts', 'r_tc8', 20, 0, 'TS1');
    const pt = part('pt', 'r_rtd', 40, -24, 'PT1');
    const [pa, pb, pb2] = pinPositions(pt);
    const wires: Wire[] = [];
    const add = (pts: [number, number][]) => pts.slice(1).forEach((q, i) => wires.push({ id: `w${wires.length}`, a: pts[i], b: q }));
    // 측온저항체 다리 → 높이 yl 의 꺾이는 점 → 각 조절기 단자 (꺾이는 점에서 서로 이어진다)
    const legs: [[number, number], number][] = [
      [pa, -16],
      [pb, -14],
      [pb2, -12],
    ];
    const tkIn = pinPositions(tk).slice(8, 11);
    const tsIn = pinPositions(ts).slice(5, 8);
    legs.forEach(([p, yl], k) => {
      add([p, [p[0], yl], [tkIn[k][0], yl], tkIn[k]]);
      add([[tsIn[k][0], tsIn[k][1]], [tsIn[k][0], yl], [p[0], yl]]);
    });
    return { parts: [tk, ts, pt], wires, ops: [] } as unknown as Circuit;
  }

  it('둘 다 센서는 이어졌다고 보지만 [검사] 가 측정 전류가 섞인다고 알린다', () => {
    const c = shared();
    const m = new CircuitModel(c);
    expect([m.tempDef.get('TK1')!.sensorOk, m.tempDef.get('TS1')!.sensorOk]).toEqual([true, true]);
    expect(m.tempDef.get('TK1')!.rtdEl).toBe(m.tempDef.get('TS1')!.rtdEl);
    const msgs = verifyWiring(c, m).filter((i) => i.msg.includes('소자 하나를 같이'));
    expect(msgs.length).toBe(1);
    expect(msgs[0].msg).toContain('더블 Pt100');
  });
});
