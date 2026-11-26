import { describe, expect, it } from 'vitest';
import type { Circuit, OpStep, Part, PartType, Pole } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { verifyWiring } from '../src/circuit/verify';
import { wirePlan } from '../src/circuit/realize';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { applyCircuit } from '../src/circuit/chart';
import { createProject } from '../src/model/project';
import { partPins } from '../src/circuit/parts';

const pts = (res: ScenarioResult, key: string) => res.tracks.find((t) => t.key === key)!.points.map((p) => [Math.round(p.t * 1000) / 1000, p.v] as [number, number | string]);
const changes = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [Math.round(p.t), p.v]);

describe('인버터 (VFD) 예제: 정 · 역 운전', () => {
  const c = circuitExamples().find((e) => e.id === 'vfd-fwd-rev')!.build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);

  it('가 · 감속: 0 → 10 Hz 0.83 초, 10 → 60 Hz 4.17 초, 60 → 0 Hz 5 초 (0 ↔ 60 Hz 를 5 초에), 고장이면 바로 0', () => {
    expect(pts(res, 'hz:INV1')).toEqual([
      [0, 0],
      [1000, 0],
      [1833.333, 10],
      [6000, 10],
      [10166.667, 60],
      [14000, 60],
      [19000, 0],
      [24000, 0],
      [29000, 60],
      [29999.999, 60],
      [30000, 0],
    ]);
  });

  it('전동기는 정회전 (1~19 초) · 역회전 (24~30 초), 고장이면 멈추고 A-C 로 경보등이 켜진다. [검사] 는 깨끗하다', () => {
    expect(changes(res, 'mot:M1')).toEqual([
      [0, '0'],
      [1000, 'FWD'],
      [19000, '0'],
      [24000, 'REV'],
      [30000, '0'],
    ]);
    expect(changes(res, 'load:RL1')).toEqual([
      [0, 0],
      [30000, 1],
      [36000, 0],
    ]);
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('돌고 있을 때 반대 방향을 주면 먼저 0 Hz 까지 감속한 뒤 반대로 돈다', () => {
    const ops: OpStep[] = [
      { id: 'a', wait: 0, tag: 'SS2', action: 'on', hold: 0 },
      { id: 'b', wait: 1000, tag: 'SS1', action: 'left', hold: 0 },
      { id: 'c', wait: 7000, tag: 'SS1', action: 'right', hold: 0 },
    ];
    const r = runScenario({ ...c, ops, duration: 20000 }, new CircuitModel({ ...c, ops }));
    expect(pts(r, 'hz:INV1').filter(([t]) => t >= 6000)).toEqual([
      [6000, 60],
      [8000, 60],
      [13000, 0],
      [18000, 60],
    ]);
    expect(changes(r, 'mot:M1')).toEqual([
      [0, '0'],
      [1000, 'FWD'],
      [13000, 'REV'],
    ]);
  });

  it('전원 (차단기) 이 끊기면 출력이 바로 끊기고, 다시 들어오면 운전 입력대로 처음부터 가속', () => {
    const sim = new CircuitSim(model);
    sim.setAct('SS2', true);
    sim.setPos('SS1', -1);
    sim.advanceTo(10000);
    expect(sim.vfdView(c.parts.find((p) => p.tag === 'INV1')!.id)).toMatchObject({ hz: 60, dir: 1, run: true });
    sim.setAct('MCCB', false);
    sim.advanceTo(10001);
    const id = c.parts.find((p) => p.tag === 'INV1')!.id;
    expect(sim.vfdView(id)).toMatchObject({ hz: 0, run: false, powered: false });
    sim.setAct('MCCB', true);
    sim.advanceTo(12500);
    expect(sim.vfdView(id)!.hz).toBeCloseTo(30, 1);
  });

  it('타임차트에 인버터 출력 주파수 (Hz) 아날로그 줄이 생기고, 설정은 저장해도 남는다', () => {
    const p = applyCircuit({ ...createProject(), circuit: c });
    const row = p.signals.find((s) => s.name.includes('출력 주파수'))!;
    expect(row.kind).toBe('analog');
    expect(row.group).toBe('인버터');
    const inv = c.parts.find((q) => q.tag === 'INV1')!;
    const back = sanitizeCircuit(JSON.parse(JSON.stringify({ ...c, parts: c.parts.map((q) => (q.id === inv.id ? { ...q, hz: 50, hzH: 55, hzM: 25, hzL: 5, acc: 2, dec: 8, ph1: true } : q)) })))!;
    expect(back.parts.find((q) => q.id === inv.id)).toMatchObject({ hz: 50, hzH: 55, hzM: 25, hzL: 5, acc: 2, dec: 8, ph1: true });
  });
});

describe('인버터 배선 검사', () => {
  /** 넷 목록으로 회로를 만들고 [배선 잇기] 로 선을 긋는다 */
  function build(nets: [string, number][][], ph1 = false, poles: Pole[] = ['L1', 'L2', 'L3', 'PE']): Circuit {
    const parts: Part[] = poles.map((pole, i) => ({ id: `t${pole}`, type: 'r_term' as PartType, x: 2 + 3 * i, y: 0, rot: 0, tag: '', pole }));
    parts.push({ id: 'cb', type: 'r_mcb3', x: 6, y: 6, rot: 0, tag: 'CB1' });
    parts.push({ id: 'inv', type: 'r_vfd', x: 14, y: 20, rot: 0, tag: 'INV1', ...(ph1 ? { ph1: true } : {}) });
    parts.push({ id: 'm', type: 'r_motor3', x: 8, y: 38, rot: 0, tag: 'M1' });
    parts.push({ id: 'ss', type: 'r_ss', x: 24, y: 36, rot: 0, tag: 'SS1' });
    const c = { parts, wires: [], ops: [], plan: [...(ph1 ? [] : feed), ...nets].map((pins) => ({ pins })) } as unknown as Circuit;
    const w = wirePlan(c);
    expect(w.failed).toBe(0);
    return w.circuit;
  }
  const label = (id: string, name: string): [string, number] => {
    const type: PartType = id === 'inv' ? 'r_vfd' : id === 'm' ? 'r_motor3' : id === 'cb' ? 'r_mcb3' : 'r_ss';
    return [id, partPins({ id, type, x: 0, y: 0, rot: 0, tag: '' }).findIndex((p) => p.label === name)];
  };
  // 전원 → 차단기 CB1 (1 3 5 → 2 4 6) → 인버터
  const feed: [string, number][][] = [
    [['tL1', 0], label('cb', '1')],
    [['tL2', 0], label('cb', '3')],
    [['tL3', 0], label('cb', '5')],
  ];
  const ok: [string, number][][] = [
    [label('cb', '2'), label('inv', 'R/L1')],
    [label('cb', '4'), label('inv', 'S/L2')],
    [label('cb', '6'), label('inv', 'T/L3')],
    [['tPE', 0], label('inv', 'PE'), label('m', 'PE')],
    [label('inv', 'U'), label('m', 'U')],
    [label('inv', 'V'), label('m', 'V')],
    [label('inv', 'W'), label('m', 'W')],
    [label('inv', 'SD'), label('ss', '23')],
    [label('ss', '24'), label('inv', 'STF')],
  ];
  const msgs = (c: Circuit) => verifyWiring(c, new CircuitModel(c)).map((i) => i.msg);

  it('바르게 이으면 문제가 없고, 셀렉터를 켜면 돈다', () => {
    const c = build(ok);
    expect(msgs(c)).toEqual([]);
    const r = runScenario({ ...c, ops: [{ id: 'o', wait: 500, tag: 'SS1', action: 'on', hold: 0 }], duration: 8000 }, new CircuitModel(c));
    expect(changes(r, 'mot:M1')).toEqual([
      [0, '0'],
      [500, 'FWD'],
    ]);
  });

  it('전원을 U V W 에 물리면 오류 (인버터가 탐)', () => {
    const bad = ok.map((n, i) => (i === 0 ? [label('cb', '2'), label('inv', 'R/L1'), label('inv', 'U')] : i === 4 ? [label('m', 'U')] : n)).filter((n) => n.length > 1) as [string, number][][];
    expect(msgs(build(bad)).some((m) => m.includes('출력 U · V · W 에 전원 (L1)'))).toBe(true);
  });

  it('입력 단자에 전원이 닿으면 오류, 세 상이 다 오지 않으면 · 접지가 없으면 경고', () => {
    const hot = [...ok.filter((_, i) => i !== 8 && i !== 0), [label('cb', '2'), label('inv', 'R/L1'), label('inv', 'STF')]] as [string, number][][];
    expect(msgs(build(hot)).some((m) => m.includes('입력 단자') && m.includes('L1'))).toBe(true);
    const two = ok.filter((_, i) => i !== 2);
    expect(msgs(build(two)).some((m) => m.includes('3상이 다 오지 않습니다'))).toBe(true);
    const noPe = ok.filter((_, i) => i !== 3);
    expect(msgs(build(noPe)).some((m) => m.includes('접지 (PE)'))).toBe(true);
  });

  it('단상 입력 기종: R · S 에 L · N 이면 돈다 (출력은 3상)', () => {
    const one: [string, number][][] = [[['tL', 0], label('cb', '1')], [['tN', 0], label('cb', '3')], [label('cb', '2'), label('inv', 'R/L1')], [label('cb', '4'), label('inv', 'S/L2')], ...ok.slice(3)];
    const c = build(one, true, ['L', 'N', 'PE']);
    const r = runScenario({ ...c, system: '1p2w', ops: [{ id: 'o', wait: 500, tag: 'SS1', action: 'on', hold: 0 }], duration: 3000 }, new CircuitModel({ ...c, system: '1p2w' }));
    expect(changes(r, 'mot:M1')).toEqual([
      [0, '0'],
      [500, 'FWD'],
    ]);
  });
});
