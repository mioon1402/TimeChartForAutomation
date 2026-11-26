import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Pole } from '../src/circuit/types';
import { CircuitModel, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit, partsList } from '../src/circuit/bom';
import { verifyWiring } from '../src/circuit/verify';
import { wirePlan } from '../src/circuit/realize';
import { toSchematic } from '../src/circuit/schematic';
import { applyCircuit } from '../src/circuit/chart';
import { createProject } from '../src/model/project';
import { partPins } from '../src/circuit/parts';

const S = 1000;
const changes = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [Math.round(p.t), p.v]);
const run = (id: string) => {
  const c = circuitExamples().find((e) => e.id === id)!.build();
  const model = new CircuitModel(c);
  return { c, model, res: runScenario(c, model) };
};
const L = (id: string, type: PartType, name: string): [string, number] => [id, partPins({ id, type, x: 0, y: 0, rot: 0, tag: '' }).findIndex((p) => p.label === name)];

describe('2단 속도 전동기 · 모터 보호 차단기 · 경광등 (예제)', () => {
  it('저속 1초 → 고속 4초 (버튼 b접점으로 바로 전환) → 고속 차단기 트립 7초 → 복귀 10초 → 저속 11초 → 정지 14초', () => {
    const { c, model, res } = run('motor-2speed');
    expect(changes(res, 'mot:M1')).toEqual([
      [0, '0'],
      [1 * S, 'LOW'],
      [4 * S, 'HIGH'],
      [7 * S, '0'],
      [11 * S, 'LOW'],
      [14 * S, '0'],
    ]);
    // 고속 단락 MC3 는 고속 MC2 와 함께
    expect(changes(res, 'coil:MC3')).toEqual(changes(res, 'coil:MC2'));
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('경광등: 녹색 = 저속, 황색 = 고속, 적색 + 부저 = 차단기 트립 (보조 21-22)', () => {
    const { res } = run('motor-2speed');
    expect(changes(res, 'tw:TL1:2')).toEqual([
      [0, 0],
      [1 * S, 1],
      [4 * S, 0],
      [11 * S, 1],
      [14 * S, 0],
    ]);
    expect(changes(res, 'tw:TL1:1')).toEqual([
      [0, 0],
      [4 * S, 1],
      [7 * S, 0],
    ]);
    expect(changes(res, 'tw:TL1:0')).toEqual([
      [0, 0],
      [7 * S, 1],
      [10 * S, 0],
    ]);
    expect(changes(res, 'tw:TL1:3')).toEqual(changes(res, 'tw:TL1:0'));
  });

  it('타임차트: 전동기는 저속 · 고속 칸, 경광등은 단마다, 부품 리스트에 MPCB 보조 1a1b', () => {
    const { c } = run('motor-2speed');
    const p = applyCircuit({ ...createProject(), circuit: c });
    const m = p.signals.find((s) => s.address === 'M1')!;
    expect(m.kind).toBe('bus');
    expect(new Set(m.points.map((q) => q.v))).toEqual(new Set(['0', '저속', '고속']));
    expect(p.signals.filter((s) => s.address.startsWith('TL1.')).map((s) => s.name)).toEqual(['운전 상태 적색', '운전 상태 황색', '운전 상태 녹색', '운전 상태 부저']);
    expect(partsList(c).find((r) => r.tag === 'MPCB1')!.spec).toContain('1a1b');
  });

  it('경광등 정격 (사양, 비우면 DC 24V) 과 걸리는 전압이 다르면 [검사] 오류', () => {
    const { c } = run('motor-2speed');
    const dc = { ...c, parts: c.parts.map((q) => (q.type === 'r_tower' ? { ...q, spec: undefined } : q)) };
    expect(verifyWiring(dc, new CircuitModel(dc)).some((i) => i.msg.includes('정격은 DC 24V'))).toBe(true);
  });

  it('모터 보호 차단기를 3P 차단기 자리에 쓰면 회로도로 바꿀 때 3P 차단기 기호가 되고 차트가 같다', () => {
    const c = circuitExamples().find((e) => e.id === 'motor-jog')!.build();
    const mp: Circuit = { ...c, parts: c.parts.map((q) => (q.type === 'r_mcb3' ? { ...q, type: 'r_mpcb' as PartType, amps: 8 } : q)) };
    const a = runScenario(mp);
    const s = toSchematic(mp);
    expect(s.notes).toEqual([]);
    expect(s.circuit.parts.filter((q) => q.type === 'mcb3').map((q) => q.tag)).toEqual(['MCB1']);
    const b = runScenario(s.circuit);
    expect(b.tracks.find((t) => t.key === 'mot:M1')!.points).toEqual(a.tracks.find((t) => t.key === 'mot:M1')!.points);
  });
});

describe('2단 속도 전동기 결선 판정', () => {
  /** 전원 단자 L1 L2 L3 → 차단기 → 전동기 단자에 바로 (넷 목록) */
  function motor(nets: [string, number][][]): Circuit {
    const parts: Part[] = (['L1', 'L2', 'L3'] as Pole[]).map((pole, i) => ({ id: `t${pole}`, type: 'r_term' as PartType, x: 2 + 3 * i, y: 0, rot: 0, tag: '', pole }));
    parts.push({ id: 'cb', type: 'r_mcb3', x: 6, y: 8, rot: 0, tag: 'CB1' }, { id: 'm', type: 'r_motor2s', x: 8, y: 30, rot: 0, tag: 'M1' });
    const feed: [string, number][][] = [
      [['tL1', 0], L('cb', 'r_mcb3', '1')],
      [['tL2', 0], L('cb', 'r_mcb3', '3')],
      [['tL3', 0], L('cb', 'r_mcb3', '5')],
    ];
    const w = wirePlan({ parts, wires: [], ops: [], plan: [...feed, ...nets].map((pins) => ({ pins })) } as unknown as Circuit);
    expect(w.failed).toBe(0);
    return w.circuit;
  }
  const out = (k: string): [string, number] => L('cb', 'r_mcb3', k);
  const M = (k: string): [string, number] => L('m', 'r_motor2s', k);
  const sim = (c: Circuit) => runScenario({ ...c, duration: 1000 });

  it('1U 1V 1W 에 세 상 = 저속, 2U 2V 2W 에 세 상 + 1U 1V 1W 묶음 = 고속', () => {
    const low = sim(motor([[out('2'), M('1U')], [out('4'), M('1V')], [out('6'), M('1W')]]));
    expect(changes(low, 'mot:M1')).toEqual([[0, 'LOW']]);
    const high = sim(motor([[out('2'), M('2U')], [out('4'), M('2V')], [out('6'), M('2W')], [M('1U'), M('1V'), M('1W')]]));
    expect(changes(high, 'mot:M1')).toEqual([[0, 'HIGH']]);
  });

  it('고속인데 1U 1V 1W 를 묶지 않으면 · 저속 고속에 함께 전원이 들어가면 돌지 않고 알린다', () => {
    const open = sim(motor([[out('2'), M('2U')], [out('4'), M('2V')], [out('6'), M('2W')]]));
    expect(changes(open, 'mot:M1')).toEqual([[0, '0']]);
    expect(open.warnings.some((w) => w.includes('한데 묶이지 않아'))).toBe(true);
    const both = sim(motor([[out('2'), M('1U'), M('2U')], [out('4'), M('1V'), M('2V')], [out('6'), M('1W'), M('2W')]]));
    expect(changes(both, 'mot:M1')).toEqual([[0, '0']]);
    expect(both.warnings.some((w) => w.includes('함께 전원이 들어갔습니다'))).toBe(true);
  });
});

describe('단상 가역 모터 (예제: 정 · 역 운전)', () => {
  it('정회전 1초, 2초 뒤 역 버튼은 인터록으로 무시, 5초 정지, 7초 역회전, 10초 정지', () => {
    const { c, model, res } = run('motor1-rev');
    expect(changes(res, 'mot:M1')).toEqual([
      [0, '0'],
      [1 * S, 'FWD'],
      [5 * S, '0'],
      [7 * S, 'REV'],
      [10 * S, '0'],
    ]);
    expect(changes(res, 'coil:MC2')).toEqual([
      [0, 0],
      [7 * S, 1],
      [10 * S, 0],
    ]);
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('A · B 에 함께 전원이 들어가면 돌지 않고 알린다 (인터록 없이 두 접촉기를 함께 켬)', () => {
    const { c } = run('motor1-rev');
    // 인터록 b접점을 빼고 (MC1 · MC2 코일을 버튼 a접점에 바로) 두 버튼을 함께 누른 것처럼: 두 접촉기를 강제로 켠 회로
    const both: Circuit = { ...c, ops: [{ id: 'a', wait: 500, tag: 'PB1', action: 'on', hold: 0 }] };
    const sim = runScenario(both);
    expect(changes(sim, 'mot:M1')).toEqual([
      [0, '0'],
      [500, 'FWD'],
    ]);
    // 엔진 판정만: C · A · B 에 L · L · L 이 닿으면 경고
    const parts: Part[] = [
      { id: 'tL', type: 'r_term', x: 2, y: 0, rot: 0, tag: '', pole: 'L' },
      { id: 'tN', type: 'r_term', x: 5, y: 0, rot: 0, tag: '', pole: 'N' },
      { id: 'cb', type: 'r_mcb2', x: 4, y: 8, rot: 0, tag: 'CB1' },
      { id: 'm', type: 'r_motor1', x: 6, y: 26, rot: 0, tag: 'M1' },
    ];
    const plan: [string, number][][] = [
      [['tL', 0], L('cb', 'r_mcb2', '1')],
      [['tN', 0], L('cb', 'r_mcb2', '3')],
      [L('cb', 'r_mcb2', '2'), L('m', 'r_motor1', 'A'), L('m', 'r_motor1', 'B')],
      [L('cb', 'r_mcb2', '4'), L('m', 'r_motor1', 'C')],
    ];
    const w = wirePlan({ parts, wires: [], ops: [], plan: plan.map((pins) => ({ pins })), system: '1p2w' } as unknown as Circuit);
    const r = runScenario({ ...w.circuit, system: '1p2w', duration: 500 });
    expect(changes(r, 'mot:M1')).toEqual([[0, '0']]);
    expect(r.warnings.some((x) => x.includes('A · B 에 함께 전원'))).toBe(true);
  });
});
