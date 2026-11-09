import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { buildNetlist } from '../src/circuit/netlist';
import { CircuitModel, CircuitSim, opsToEvents, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { applyCircuit, autoChartOn, circuitStatus, circuitToProject } from '../src/circuit/chart';
import { bomCsv, bomSummary, checkCircuit, partsList } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { pinPositions } from '../src/circuit/parts';
import { createProject, migrateProject } from '../src/model/project';
import { valueAt } from '../src/model/wave';

let n = 0;
const part = (type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}): Part => ({ id: `p${n++}`, type, x, y, rot: 0, tag, ...extra });
const wire = (a: [number, number], b: [number, number]): Wire => ({ id: `w${n++}`, a, b });
const example = (id: string): Circuit => circuitExamples().find((e) => e.id === id)!.build();

/** 기록에서 어떤 기호가 켜지고 꺼진 시각 */
function edges(res: ScenarioResult, key: string): { t: number; v: number | string }[] {
  const tr = res.tracks.find((t) => t.key === key);
  if (!tr) throw new Error(`no track ${key}`);
  const out: { t: number; v: number | string }[] = [];
  let last: number | string | null = null;
  for (const p of tr.points) {
    if (p.v !== last) out.push({ t: p.t, v: p.v });
    last = p.v;
  }
  return out;
}

describe('netlist', () => {
  it('connects wire ends, T-junctions and pins but not crossings', () => {
    const c = {
      parts: [part('lamp', 0, 2), part('lamp', 6, 2)],
      wires: [wire([0, 0], [6, 0]), wire([3, -2], [3, 2]), wire([0, 0], [0, 0]), wire([6, -1], [6, 0])],
    };
    const net = buildNetlist(c);
    const [a, b] = c.parts;
    // 두 램프 윗단자 (0,0) 과 (6,0) 은 같은 선의 양 끝
    expect(net.pinNet.get(`${a.id}:0`)).toBe(net.pinNet.get(`${b.id}:0`));
    // 세로선 (3,-2)-(3,2) 은 가로선과 엇갈리기만 함
    expect(net.wireNet.get(c.wires[1].id)).not.toBe(net.wireNet.get(c.wires[0].id));
  });

  it('joins a wire end that lands on the middle of another wire', () => {
    const c = { parts: [] as Part[], wires: [wire([0, 0], [10, 0]), wire([4, 0], [4, 5])] };
    const net = buildNetlist(c);
    expect(net.wireNet.get(c.wires[0].id)).toBe(net.wireNet.get(c.wires[1].id));
    expect(net.junctions).toContainEqual([4, 0]);
  });

  it('rotates pins with the part', () => {
    const p = part('coil', 5, 5, 'X1', { rot: 90 });
    expect(pinPositions(p)).toEqual([
      [7, 5],
      [3, 5],
    ]);
  });
});

describe('simulation', () => {
  it('self-holding circuit: start latches, stop releases, motor runs', () => {
    const res = runScenario(example('self-hold'));
    expect(edges(res, 'coil:MC1')).toEqual([
      { t: 0, v: 0 },
      { t: 500, v: 1 },
      { t: 3500, v: 0 },
    ]);
    expect(edges(res, 'mot:M1')).toEqual([
      { t: 0, v: '0' },
      { t: 500, v: 'FWD' },
      { t: 3500, v: '0' },
    ]);
    expect(edges(res, 'load:GL').map((e) => e.t)).toEqual([0, 500, 3500]);
    expect(edges(res, 'load:RL')).toEqual([
      { t: 0, v: 1 },
      { t: 500, v: 0 },
      { t: 3500, v: 1 },
    ]);
    expect(res.warnings).toEqual([]);
  });

  it('reversing circuit: interlock blocks the other direction, phase swap reverses the motor', () => {
    const res = runScenario(example('reversing'));
    expect(edges(res, 'mot:M1')).toEqual([
      { t: 0, v: '0' },
      { t: 500, v: 'FWD' },
      { t: 4000, v: '0' },
      { t: 5000, v: 'REV' },
      { t: 8000, v: '0' },
    ]);
    // 정회전 중 PB2 (2.5초) 는 인터록으로 무시
    expect(edges(res, 'coil:MC2').map((e) => e.t)).toEqual([0, 5000, 8000]);
  });

  it('on-delay timer switches its timed contact after the preset', () => {
    const res = runScenario(example('timer'));
    expect(edges(res, 'tc:T1').map((e) => e.t)).toEqual([0, 500, 6000]);
    expect(edges(res, 'tq:T1').map((e) => e.t)).toEqual([0, 3500, 6000]);
    expect(edges(res, 'load:YL').map((e) => e.t)).toEqual([0, 500, 3500]);
    expect(edges(res, 'load:GL').map((e) => e.t)).toEqual([0, 3500, 6000]);
  });

  it('off-delay timer keeps its contact for the preset after the coil drops', () => {
    const c: Circuit = {
      parts: [part('src', 0, 0, '', { pole: '+24V' }), part('src', 0, 10, '', { pole: '0V' }), part('sw_no', 2, 3, 'SS1'), part('timer', 2, 7, 'T1', { timerMode: 'off', preset: 2000 })],
      wires: [wire([0, 0], [2, 0]), wire([2, 0], [2, 1]), wire([0, 10], [2, 10]), wire([2, 9], [2, 10])],
      ops: [
        { id: 'a', wait: 100, tag: 'SS1', action: 'on', hold: 0 },
        { id: 'b', wait: 1000, tag: 'SS1', action: 'off', hold: 0 },
      ],
    };
    const res = runScenario(c);
    expect(edges(res, 'tq:T1').map((e) => e.t)).toEqual([0, 100, 3100]);
  });

  it('cylinder cycle: sensors follow stroke times, end sensor releases after a short travel', () => {
    const res = runScenario(example('cylinder'));
    expect(edges(res, 'load:SOL1').map((e) => e.t)).toEqual([0, 500, 1500]);
    expect(edges(res, 'load:SOL2').map((e) => e.t)).toEqual([0, 1500, 2300]);
    expect(edges(res, 'sen:LS2')).toEqual([
      { t: 0, v: 0 },
      { t: 1500, v: 1 },
      { t: 1524, v: 0 },
    ]);
    expect(edges(res, 'sen:LS1')).toEqual([
      { t: 0, v: 1 },
      { t: 530, v: 0 },
      { t: 2300, v: 1 },
    ]);
    const cyl = res.tracks.find((t) => t.key === 'cyl:CYL1')!;
    expect(cyl.points.filter((p) => p.ramp)).toEqual([
      { t: 500, v: 1, ramp: 1000 },
      { t: 1500, v: 0, ramp: 800 },
    ]);
  });

  it('reports a short circuit when a switch ties L to N', () => {
    const c: Circuit = {
      parts: [part('src', 0, 0, '', { pole: 'L' }), part('src', 0, 6, '', { pole: 'N' }), part('pb_no', 2, 3, 'PB1')],
      wires: [wire([0, 0], [2, 0]), wire([2, 0], [2, 1]), wire([0, 6], [2, 6]), wire([2, 5], [2, 6])],
      ops: [{ id: 'a', wait: 100, tag: 'PB1', action: 'press', hold: 200 }],
    };
    const res = runScenario(c);
    expect(res.warnings.some((w) => w.includes('단락'))).toBe(true);
  });

  it('simultaneous presses of interlocked buttons: one direction wins, no oscillation', () => {
    const c = example('reversing');
    const sim = new CircuitSim(new CircuitModel(c));
    sim.act.set('PB1', true);
    sim.act.set('PB2', true);
    sim.settle();
    expect([sim.coilOn.get('MC1'), sim.coilOn.get('MC2')].filter(Boolean)).toHaveLength(1);
    expect(sim.warnings).toEqual([]);
  });

  it('turns operation steps into timed events', () => {
    const ev = opsToEvents([
      { id: 'a', wait: 500, tag: 'pb1', action: 'press', hold: 300 },
      { id: 'b', wait: 1000, tag: 'SS1', action: 'on', hold: 0 },
    ]);
    expect(ev).toEqual([
      { t: 500, tag: 'PB1', on: true },
      { t: 800, tag: 'PB1', on: false },
      { t: 1500, tag: 'SS1', on: true },
    ]);
  });
});

describe('timechart from the circuit', () => {
  it('builds rows by role, with steps from operation notes and a timer dimension', () => {
    const c = example('timer');
    const p = circuitToProject(createProject(), c);
    const addr = p.signals.map((s) => s.address);
    expect(addr).toEqual(['PB1', 'PB0', 'X1', 'T1', 'T1.Q', 'GL', 'YL']);
    expect(p.signals.find((s) => s.address === 'PB1')!.role).toBe('input');
    expect(p.steps.map((s) => [s.label, s.start])).toEqual([
      ['기동', 500],
      ['정지', 6000],
    ]);
    const dim = p.annotations.find((a) => a.type === 'dimension');
    expect(dim).toMatchObject({ t1: 500, t2: 3500, auto: true });
    expect(p.settings.duration).toBeGreaterThanOrEqual(6300);
    expect(circuitStatus(p)).toBe('applied');
  });

  it('places solenoids, cylinder (sloped) and its sensors together', () => {
    const p = applyCircuit({ ...createProject(), circuit: example('cylinder') });
    const addr = p.signals.map((s) => s.address);
    expect(addr.slice(-5)).toEqual(['SOL1', 'SOL2', 'CYL1', 'LS2', 'LS1']);
    const cyl = p.signals.find((s) => s.address === 'CYL1')!;
    expect(cyl.role).toBe('actuator');
    expect(cyl.points.find((q) => q.t === 500)?.ramp).toBe(1000);
  });

  it('shows a reversing motor as forward / reverse values', () => {
    const p = applyCircuit({ ...createProject(), circuit: example('reversing') });
    const m = p.signals.find((s) => s.address === 'M1')!;
    expect(m.kind).toBe('bus');
    expect(valueAt(m.points, 1000, 'bus')).toBe('정회전');
    expect(valueAt(m.points, 6000, 'bus')).toBe('역회전');
  });

  it('keeps hand edits (name, colour) of existing rows when re-applied', () => {
    const first = applyCircuit({ ...createProject(), circuit: example('self-hold') });
    const edited = { ...first, signals: first.signals.map((s) => (s.address === 'MC1' ? { ...s, name: '메인 MC', color: '#000000' } : s)) };
    const again = applyCircuit({ ...edited, circuit: { ...edited.circuit!, ops: [{ id: 'x', wait: 200, tag: 'PB1', action: 'press', hold: 300 }] } });
    const mc = again.signals.find((s) => s.address === 'MC1')!;
    expect(mc.name).toBe('메인 MC');
    expect(mc.color).toBe('#000000');
    expect(valueAt(mc.points, 300)).toBe(1);
  });

  it('auto-applies only to charts made from the circuit or empty charts', () => {
    const c = example('self-hold');
    expect(autoChartOn({ ...createProject(), circuit: c })).toBe(true);
    const hand = { ...createProject(), circuit: c, signals: applyCircuit({ ...createProject(), circuit: c }).signals };
    expect(autoChartOn(hand)).toBe(false);
    expect(autoChartOn({ ...hand, circuit: { ...c, applied: 'x' } })).toBe(true);
    expect(autoChartOn({ ...createProject(), circuit: { ...c, autoChart: false } })).toBe(false);
  });
});

describe('parts list and checks', () => {
  it('lists one row per tag with contacts counted', () => {
    const rows = partsList(example('reversing'));
    const mc1 = rows.find((r) => r.tag === 'MC1')!;
    expect(mc1.kind).toBe('전자접촉기');
    expect([mc1.main, mc1.a, mc1.b]).toEqual([3, 2, 1]);
    expect(mc1.spec).toBe('주접점 3P, 보조 2a1b');
    expect(rows.find((r) => r.tag === 'PB0')).toMatchObject({ kind: '푸시버튼', name: '정지', spec: '적색 1b' });
    expect(rows.map((r) => r.tag)).toEqual(['MCCB', 'THR', 'MC1', 'MC2', 'PB0', 'PB1', 'PB2', 'GL', 'YL', 'M1']);
    const sum = bomSummary(rows);
    expect(sum.find((s) => s.kind === '푸시버튼' && s.spec === '녹색 1a')).toMatchObject({ qty: 2, tags: ['PB1', 'PB2'] });
    expect(bomCsv(example('reversing')).startsWith('﻿기호,품명')).toBe(true);
  });

  it('flags contacts without a coil, duplicate coils and floating terminals', () => {
    const c: Circuit = {
      parts: [part('src', 0, 0, '', { pole: '+24V' }), part('no', 2, 3, 'X9'), part('coil', 6, 3, 'X1'), part('coil', 9, 3, 'X1')],
      wires: [wire([0, 0], [2, 0]), wire([2, 0], [2, 1])],
      ops: [],
    };
    const msgs = checkCircuit(c).map((i) => i.msg);
    expect(msgs.some((m) => m.includes('X9'))).toBe(true);
    expect(msgs.some((m) => m.includes('X1') && m.includes('2개'))).toBe(true);
    expect(msgs.some((m) => m.includes('이어지지 않은 단자'))).toBe(true);
  });

  it('examples have no drawing problems', () => {
    for (const e of circuitExamples()) {
      const c = e.build();
      const issues = checkCircuit(c, new CircuitModel(c, e.plc?.()));
      expect(issues, e.id).toEqual([]);
    }
  });
});

describe('saving', () => {
  it('keeps the circuit through project migration and drops unknown parts', () => {
    const c = example('cylinder');
    const raw = JSON.parse(JSON.stringify({ ...createProject(), circuit: { ...c, parts: [...c.parts, { id: 'z', type: 'warp-drive', x: 0, y: 0 }] } }));
    const p = migrateProject(raw);
    expect(p.circuit!.parts).toHaveLength(c.parts.length);
    expect(p.circuit!.wires).toHaveLength(c.wires.length);
    expect(p.circuit!.ops).toEqual(c.ops);
    expect(sanitizeCircuit(null)).toBeUndefined();
    expect(migrateProject(JSON.parse(JSON.stringify(createProject()))).circuit).toBeUndefined();
  });
});

describe('PLC block', () => {
  it('numbers PLC terminals per maker', async () => {
    const { plcAddress } = await import('../src/circuit/parts');
    expect([0, 7, 8].map((n) => plcAddress('X0', n))).toEqual(['X0', 'X7', 'X10']);
    expect([0, 7, 15, 16].map((n) => plcAddress('P00040', n))).toEqual(['P00040', 'P00047', 'P0004F', 'P00050']);
    expect([0, 7, 8].map((n) => plcAddress('I0.0', n))).toEqual(['I0.0', 'I0.7', 'I1.0']);
    expect(plcAddress('%QX0.6', 3)).toBe('%QX1.1');
  });

  it('runs the PLC tab program against the wired buttons and lamps', () => {
    const ex = circuitExamples().find((e) => e.id === 'plc')!;
    const c = ex.build();
    const res = runScenario(c, new CircuitModel(c, ex.plc!()));
    expect(res.warnings).toEqual([]);
    // 버튼은 500 ms 에 눌림 → 다음 스캔(510 ms)에 Y0, T0 3초 뒤 Y1, 정지 5.5 s → 다음 스캔에 모두 OFF
    expect(edges(res, 'load:GL').map((e) => e.t)).toEqual([0, 510, 5510]);
    expect(edges(res, 'load:YL').map((e) => e.t)).toEqual([0, 3510, 5510]);
    const p = applyCircuit({ ...createProject(), circuit: c, plc: ex.plc!() });
    expect(p.signals.filter((s) => s.group === 'PLC 입력').map((s) => [s.address, s.name])).toEqual([
      ['X0', '기동 PB'],
      ['X1', '정지 PB'],
    ]);
    expect(p.signals.filter((s) => s.group === 'PLC 출력').map((s) => s.address)).toEqual(['Y0', 'Y1']);
    expect(partsList(c).find((r) => r.tag === 'PLC1')).toMatchObject({ kind: 'PLC' });
  });

  it('warns when the circuit has a PLC but no program', () => {
    const ex = circuitExamples().find((e) => e.id === 'plc')!;
    const c = ex.build();
    expect(checkCircuit(c).some((i) => i.msg.includes('PLC 프로그램이 없습니다'))).toBe(true);
    const res = runScenario(c);
    expect(edges(res, 'load:GL')).toEqual([{ t: 0, v: 0 }]);
  });
});
