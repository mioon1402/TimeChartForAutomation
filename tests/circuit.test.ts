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

describe('sensors, power supply, flicker', () => {
  const rails = (): Part[] => [part('src', 0, 0, '', { pole: '+24V' }), part('src', 0, 14, '', { pole: '0V' })];
  const railWires = (): Wire[] => [wire([0, 0], [10, 0]), wire([0, 14], [10, 14])];

  it('3-wire PNP sensor switches its load only when powered', () => {
    const c: Circuit = {
      parts: [...rails(), part('prox', 2, 4, 'PX1', { sense: 'inductive' }), part('lamp', 2, 10, 'GL')],
      wires: [...railWires(), wire([2, 0], [2, 2]), wire([4, 6], [4, 14]), wire([2, 6], [2, 8]), wire([2, 12], [2, 14])],
      ops: [
        { id: 'a', wait: 500, tag: 'PX1', action: 'on', hold: 0 },
        { id: 'b', wait: 1000, tag: 'PX1', action: 'off', hold: 0 },
      ],
    };
    expect(edges(runScenario(c), 'load:GL').map((e) => e.t)).toEqual([0, 500, 1500]);
    // 파랑(0V) 선을 빼면 감지해도 출력이 없다
    const unpowered = { ...c, wires: c.wires.filter((w) => !(w.a[0] === 4 && w.a[1] === 6)) };
    expect(edges(runScenario(unpowered), 'load:GL')).toEqual([{ t: 0, v: 0 }]);
  });

  it('SMPS makes 24 V DC only while its AC input is on', () => {
    const c: Circuit = {
      parts: [part('src', 4, -3, '', { pole: 'L' }), part('src', 6, 1, '', { pole: 'N' }), part('sw_no', 4, -1, 'SS1'), part('smps', 5, 5, 'SMPS1'), part('lamp', 4, 9, 'GL')],
      wires: [wire([4, 1], [4, 3]), wire([6, 1], [6, 3]), wire([4, 11], [6, 11]), wire([6, 11], [6, 7])],
      ops: [{ id: 'a', wait: 500, tag: 'SS1', action: 'on', hold: 0 }],
    };
    expect(edges(runScenario(c), 'load:GL').map((e) => e.t)).toEqual([0, 500]);
  });

  it('flicker relay blinks while its coil is on', () => {
    const c: Circuit = {
      parts: [...rails(), part('sw_no', 2, 3, 'SS1'), part('timer', 2, 7, 'FR1', { timerMode: 'flicker', preset: 500 }), part('no', 6, 3, 'FR1'), part('lamp', 6, 7, 'RL')],
      wires: [...railWires(), wire([2, 0], [2, 1]), wire([2, 9], [2, 14]), wire([6, 0], [6, 1]), wire([6, 9], [6, 14])],
      ops: [
        { id: 'a', wait: 100, tag: 'SS1', action: 'on', hold: 0 },
        { id: 'b', wait: 1700, tag: 'SS1', action: 'off', hold: 0 },
      ],
    };
    expect(edges(runScenario(c), 'load:RL').map((e) => e.t)).toEqual([0, 100, 600, 1100, 1600]);
  });
});

describe('pneumatic circuit', () => {
  /** 스위치 → 솔레노이드 (전기), 공압원 → 밸브 → 실린더 (배관) */
  function rig(valve: PartType, cyl: Partial<Part>, extra: { parts?: Part[]; wires?: Wire[] } = {}): Circuit {
    const parts: Part[] = [
      part('src', 0, 0, '', { pole: '+24V' }),
      part('src', 0, 10, '', { pole: '0V' }),
      part('sw_no', 2, 3, 'SS1'),
      part('sol', 2, 7, 'SOL1'),
      part('sw_no', 6, 3, 'SS2'),
      part('sol', 6, 7, 'SOL2'),
      part('cyl', 20, 0, 'CYL1', { stroke: 1000, strokeBack: 800, ...cyl }),
      part(valve, 23, 8, 'V1', { solA: 'SOL1', solB: 'SOL2' }),
      part('air', 23, 13),
      ...(extra.parts ?? []),
    ];
    const wires: Wire[] = [
      wire([0, 0], [6, 0]),
      wire([0, 10], [6, 10]),
      wire([2, 0], [2, 1]),
      wire([2, 9], [2, 10]),
      wire([6, 0], [6, 1]),
      wire([6, 9], [6, 10]),
      wire([23, 14], [23, 10]),
      ...(extra.wires ?? []),
    ];
    return { parts, wires, ops: [] };
  }
  const cap = (): Wire[] => [wire([22, 6], [22, 4]), wire([22, 4], [21, 4]), wire([21, 4], [21, 2])];
  const rod = (): Wire[] => [wire([24, 6], [24, 4]), wire([24, 4], [25, 4]), wire([25, 4], [25, 2])];
  const cylRamps = (res: ScenarioResult) => res.tracks.find((t) => t.key === 'cyl:CYL1')!.points.filter((p) => p.t > 0);

  it('5/2 single-solenoid valve: air drives the cylinder out and the spring-returned valve brings it back', () => {
    const c = rig('v52', {}, { wires: [...cap(), ...rod()] });
    c.ops = [
      { id: 'a', wait: 500, tag: 'SS1', action: 'on', hold: 0 },
      { id: 'b', wait: 2500, tag: 'SS1', action: 'off', hold: 0 },
    ];
    expect(cylRamps(runScenario(c))).toEqual([
      { t: 500, v: 1, ramp: 1000 },
      { t: 3000, v: 0, ramp: 800 },
    ]);
  });

  it('5/2 double-solenoid valve keeps its position after a short pulse', () => {
    const c = rig('v52d', {}, { wires: [...cap(), ...rod()] });
    c.ops = [
      { id: 'a', wait: 500, tag: 'SS1', action: 'press', hold: 100 },
      { id: 'b', wait: 2500, tag: 'SS2', action: 'press', hold: 100 },
    ];
    expect(cylRamps(runScenario(c))).toEqual([
      { t: 500, v: 1, ramp: 1000 },
      { t: 3000, v: 0, ramp: 800 },
    ]);
  });

  it('flow control on the exhaust side slows that stroke (meter-out)', () => {
    // 속도 제어 밸브를 로드 쪽 배관에: 전진할 때 로드 쪽이 배기되므로 전진이 50% 빠르기
    const c = rig('v52', {}, {
      parts: [part('fc', 25, 4, 'SC1', { speed: 50 })],
      wires: [...cap(), wire([25, 2], [25, 2]), wire([25, 6], [24, 6])],
    });
    c.ops = [
      { id: 'a', wait: 500, tag: 'SS1', action: 'on', hold: 0 },
      { id: 'b', wait: 3000, tag: 'SS1', action: 'off', hold: 0 },
    ];
    expect(cylRamps(runScenario(c))).toEqual([
      { t: 500, v: 1, ramp: 2000 },
      { t: 3500, v: 0, ramp: 800 },
    ]);
  });

  it('3/2 valve with a single-acting cylinder: air out, spring back', () => {
    const c = rig('v32', {}, { wires: [wire([22, 6], [22, 4]), wire([22, 4], [21, 4]), wire([21, 4], [21, 2]), wire([23, 10], [22, 10])] });
    c.ops = [
      { id: 'a', wait: 500, tag: 'SS1', action: 'on', hold: 0 },
      { id: 'b', wait: 2000, tag: 'SS1', action: 'off', hold: 0 },
    ];
    expect(cylRamps(runScenario(c))).toEqual([
      { t: 500, v: 1, ramp: 1000 },
      { t: 2500, v: 0, ramp: 800 },
    ]);
  });

  it('5/3 closed-centre valve stops the cylinder where it is', () => {
    const c = rig('v53', {}, { wires: [...cap(), ...rod()] });
    c.ops = [{ id: 'a', wait: 500, tag: 'SS1', action: 'press', hold: 400 }];
    const model = new CircuitModel(c);
    const sim = new CircuitSim(model);
    sim.advanceTo(500);
    sim.setAct('SS1', true);
    sim.advanceTo(900);
    sim.setAct('SS1', false);
    sim.advanceTo(3000);
    expect(sim.cylPos('CYL1')).toBeCloseTo(0.4, 5);
    expect(sim.valvePos.get(c.parts.find((p) => p.type === 'v53')!.id)).toBe('c');
  });

  it('parts list names valves with their solenoids and leaves the solenoid coils out', () => {
    const rows = partsList(rig('v52d', {}, { wires: [...cap(), ...rod()] }));
    expect(rows.find((r) => r.tag === 'V1')).toMatchObject({ kind: '5/2 솔레노이드 밸브 (양솔)', spec: 'SOL1 (14), SOL2 (12)' });
    expect(rows.some((r) => r.tag === 'SOL1')).toBe(false);
  });
});

describe('electro-pneumatic example', () => {
  it('cycles the cylinder with proximity sensors until stop, extension slowed by the flow control', () => {
    const c = circuitExamples().find((e) => e.id === 'pneumatic')!.build();
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    const ramps = res.tracks.find((t) => t.key === 'cyl:CYL1')!.points.filter((p) => p.t > 0);
    expect(ramps).toEqual([
      { t: 500, v: 1, ramp: 2000 },
      { t: 2500, v: 0, ramp: 800 },
      { t: 3300, v: 1, ramp: 2000 },
      { t: 5300, v: 0, ramp: 800 },
      { t: 6100, v: 1, ramp: 2000 },
      { t: 8100, v: 0, ramp: 800 },
    ]);
    // 전진단 센서 → X3 → SOL2, 후진단을 떠나면 X2 가 꺼진다 (스트로크 3%)
    expect(edges(res, 'sen:PX2').map((e) => e.t).slice(0, 3)).toEqual([0, 2500, 2524]);
    expect(edges(res, 'sen:PX1').map((e) => e.t).slice(0, 3)).toEqual([0, 560, 3300]);
    expect(res.warnings).toEqual([]);
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'PX1')).toMatchObject({ kind: '근접 센서 (유도형)', spec: 'DC 24V 3선식 PNP, CYL1 후진단' });
    expect(rows.find((r) => r.tag === 'V1')?.spec).toBe('SOL1 (14), SOL2 (12)');
    expect(rows.find((r) => r.tag === 'SC1')?.kind).toBe('속도 제어 밸브');
  });
});

describe('real wiring diagram devices', () => {
  it('runs the wiring-diagram example: one contactor body holds its own coil, main poles and aux contact', () => {
    const c = circuitExamples().find((e) => e.id === 'real')!.build();
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    expect(res.warnings).toEqual([]);
    expect(edges(res, 'coil:MC1').map((e) => e.t)).toEqual([0, 500, 3500]);
    expect(edges(res, 'mot:M1')).toEqual([
      { t: 0, v: '0' },
      { t: 500, v: 'FWD' },
      { t: 3500, v: '0' },
    ]);
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'MC1')).toMatchObject({ kind: '전자접촉기', spec: '코일 AC 220V' });
    expect(rows.find((r) => r.tag === 'PB0')).toMatchObject({ kind: '푸시버튼', spec: '적색 1a1b' });
    expect(rows.find((r) => r.tag === 'MCB1')).toMatchObject({ kind: '배선용 차단기', spec: 'AC/25A' });
  });

  it('opening the breaker lever stops everything, tripping is an operator action', () => {
    const c = circuitExamples().find((e) => e.id === 'real')!.build();
    c.ops = [
      { id: 'a', wait: 500, tag: 'PB1', action: 'press', hold: 300 },
      { id: 'b', wait: 1000, tag: 'MCB2', action: 'off', hold: 0 },
    ];
    expect(edges(runScenario(c), 'coil:MC1').map((e) => e.t)).toEqual([0, 500, 1500]);
  });

  it('reports an earth fault when a live wire touches PE', () => {
    const c: Circuit = {
      parts: [part('r_term', 0, 0, '', { pole: 'L1' }), part('r_term', 6, 0, '', { pole: 'PE' }), part('r_mcb1', 3, 4, 'MCB1')],
      wires: [wire([0, 0], [3, 0]), wire([3, 8], [6, 8]), wire([6, 8], [6, 0])],
      ops: [],
    };
    expect(runScenario(c).warnings.some((w) => w.includes('단락') && w.includes('PE'))).toBe(true);
  });

  it('keeps wire colours through saving', () => {
    const c = circuitExamples().find((e) => e.id === 'real')!.build();
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.wires.filter((w) => w.color === 'gy')).toHaveLength(1);
    expect(back.wires.every((w) => w.color)).toBe(true);
  });
});

describe('wire colours when drawing', () => {
  it('follows the phase through a breaker, and leaves schematic wires plain', async () => {
    const { autoWireColor } = await import('../src/circuit/wires');
    const c: Circuit = {
      parts: [part('r_term', 0, 0, '', { pole: 'L2' }), part('r_mcb1', 0, 6, 'MCB1'), part('r_lamp', 0, 14, 'PL1', { color: 'red' })],
      wires: [{ id: 'w1', a: [0, 0], b: [0, 2], color: 'black' }],
      ops: [],
    };
    // 차단기 아래 단자 (0,10) 에서 램프 X1 (-1,15) 로: 차단기 극을 따라가면 L2 → 검정
    expect(autoWireColor(c, new CircuitModel(c), [0, 10], [-1, 15])).toBe('black');
    const plain: Circuit = { parts: [part('src', 0, 0, '', { pole: 'L' }), part('pb_no', 0, 4, 'PB1')], wires: [], ops: [] };
    expect(autoWireColor(plain, new CircuitModel(plain), [0, 0], [0, 2])).toBeUndefined();
  });
});

describe('control panel devices (8-pin relay & timer, selector, E-stop, terminal block)', () => {
  const pinAt = (p: Part, i: number) => pinPositions(p)[i];

  /** 8핀 타이머: SS 로 2-7 에 전원, 1-3 → LA, 8-6 → LB, 1-4 → LC */
  function timerBench(inst13: boolean): Circuit {
    const L = part('src', -10, -10, '', { pole: 'L' });
    const N = part('src', 10, 10, '', { pole: 'N' });
    const ss = part('r_ss', -10, 0, 'SS');
    const t = part('r_timer8', 0, 0, 'T1', { timerMode: 'on', preset: 1000, ...(inst13 ? { inst13: true } : {}) });
    const la = part('lamp', 6, -6, 'LA');
    const lb = part('lamp', 9, -6, 'LB');
    const lc = part('lamp', 12, -6, 'LC');
    const w = (a: [number, number], b: [number, number]) => wire(a, b);
    return {
      parts: [L, N, ss, t, la, lb, lc],
      wires: [
        w(pinAt(L, 0), pinAt(ss, 2)),
        w(pinAt(ss, 3), pinAt(t, 1)),
        w(pinAt(t, 6), pinAt(N, 0)),
        w(pinAt(L, 0), pinAt(t, 0)),
        w(pinAt(L, 0), pinAt(t, 7)),
        w(pinAt(t, 2), pinAt(la, 0)),
        w(pinAt(t, 5), pinAt(lb, 0)),
        w(pinAt(t, 3), pinAt(lc, 0)),
        w(pinAt(la, 1), pinAt(N, 0)),
        w(pinAt(lb, 1), pinAt(N, 0)),
        w(pinAt(lc, 1), pinAt(N, 0)),
      ],
      ops: [
        { id: 'a', wait: 500, tag: 'SS', action: 'on', hold: 0 },
        { id: 'b', wait: 2500, tag: 'SS', action: 'off', hold: 0 },
      ],
    };
  }

  it('8-pin timer: 2-7 power, 8-6 timed, 1-3 / 1-4 timed or instantaneous', () => {
    const timed = runScenario(timerBench(false));
    expect(edges(timed, 'tq:T1').map((e) => [e.t, e.v])).toEqual([[0, 0], [1500, 1], [3000, 0]]);
    expect(edges(timed, 'load:LA').map((e) => e.t)).toEqual([0, 1500, 3000]);
    expect(edges(timed, 'load:LB').map((e) => e.t)).toEqual([0, 1500, 3000]);
    expect(edges(timed, 'load:LC').map((e) => [e.t, e.v])).toEqual([[0, 1], [1500, 0], [3000, 1]]);
    const inst = runScenario(timerBench(true));
    // 순시 접점은 전원이 들어오는 순간 바뀐다
    expect(edges(inst, 'load:LA').map((e) => e.t)).toEqual([0, 500, 3000]);
    expect(edges(inst, 'load:LB').map((e) => e.t)).toEqual([0, 1500, 3000]);
    expect(edges(inst, 'load:LC').map((e) => [e.t, e.v])).toEqual([[0, 1], [500, 0], [3000, 1]]);
  });

  it('runs the control panel example through the terminal block', () => {
    const c = example('panel');
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    expect(res.warnings).toEqual([]);
    expect(edges(res, 'coil:X1').map((e) => e.t)).toEqual([0, 1000, 6000, 7000, 8500]);
    expect(edges(res, 'tc:T1').map((e) => e.t)).toEqual([0, 1000, 6000, 7000, 8500]);
    // 기동 3초 뒤 운전 램프, 그동안 대기 램프
    expect(edges(res, 'load:GL').map((e) => e.t)).toEqual([0, 4000, 6000]);
    expect(edges(res, 'load:YL').map((e) => e.t)).toEqual([0, 1000, 4000, 7000, 8500]);
    // 정지 램프: 운전 선택 뒤 X1 이 꺼져 있을 때 (비상정지 중에는 꺼짐)
    expect(edges(res, 'load:RL').map((e) => e.t)).toEqual([0, 500, 1000, 6300, 7000, 9500]);
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'X1')).toMatchObject({ kind: '릴레이 (8핀) + 소켓', a: 2, b: 2 });
    expect(rows.find((r) => r.tag === 'T1')?.spec).toContain('한시 2a2b');
    expect(rows.find((r) => r.tag === 'TB1')).toMatchObject({ kind: '단자대', spec: '8P' });
    expect(rows.find((r) => r.tag === 'EMS')).toMatchObject({ kind: '비상정지 스위치', a: 1, b: 1 });
    expect(rows.find((r) => r.tag === 'SS')).toMatchObject({ kind: '셀렉터 스위치 (2단)' });
  });

  it('terminal blocks have two screws per number and keep their size and ticks through saving', async () => {
    const { partPins } = await import('../src/circuit/parts');
    const tb = part('r_tb', 0, 0, 'TB1', { n: 12 });
    expect(partPins(tb)).toHaveLength(24);
    expect(pinPositions(tb)[23]).toEqual([22, 2]);
    const c: Circuit = { parts: [tb, part('r_timer8', 0, 10, 'T1', { inst13: true })], wires: [], ops: [], wired: ['a|b'] };
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.parts[0].n).toBe(12);
    expect(back.parts[1].inst13).toBe(true);
    expect(back.wired).toEqual(['a|b']);
  });
});

describe('wiring list', () => {
  it('turns the drawing into terminal-to-terminal wires with wire numbers', async () => {
    const { wiringList, wiringCsv, termText } = await import('../src/circuit/wiring');
    const c = example('panel');
    const rows = wiringList(c, new CircuitModel(c));
    expect(rows).toHaveLength(26);
    const text = rows.map((r) => [r.no, termText(r.from), termText(r.to), r.color]);
    // 전원부터: 1 = L, 2 = N
    expect(text[0]).toEqual([1, 'L', 'MCB1 1', 'brown']);
    expect(text.filter((r) => r[0] === 2).every((r) => r[3] === 'blue')).toBe(true);
    // 단자대 위(문 쪽)와 아래(판넬 쪽)는 같은 선번호
    const no = (a: string, b: string) => text.find((r) => (r[1] === a && r[2] === b) || (r[1] === b && r[2] === a))?.[0];
    expect(no('EMS 11', 'TB1 1 위')).toBeDefined();
    expect(no('EMS 11', 'TB1 1 위')).toBe(no('TB1 1 아래', 'X1 8'));
    // 릴레이 소켓의 점퍼 (2-3), 타이머 공통 (1-2)
    expect(no('X1 2', 'X1 3')).toBeDefined();
    expect(no('T1 1', 'T1 2')).toBeDefined();
    // 넷마다 (단자 수 - 1) 가닥: 같은 단자 쌍이 두 번 나오지 않는다
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.segs.length > 0 && r.length > 0)).toBe(true);
    const csv = wiringCsv(rows, new Set([rows[0].key]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trim().split('\r\n')).toHaveLength(27);
    expect(csv.split('\r\n')[1]).toBe('1,1,L,,MCB1,1,갈색,O');

    const real = example('real');
    const realRows = wiringList(real, new CircuitModel(real));
    expect(realRows.map((r) => `${termText(r.from)}-${termText(r.to)}`)).toContain('MCB1 2-MC1 1/L1');
    expect(realRows.map((r) => `${termText(r.from)}-${termText(r.to)}`)).toContain('MC1 2/T1-M1 U');
  });
});

describe('24-hour dial time switch and lighting', () => {
  const H = 3600000;
  const hours = (res: ScenarioResult, key: string) => edges(res, key).map((e) => [e.t / H, e.v]);

  it('switches the lights at the set times over one day', () => {
    const c = example('tsw-light');
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    expect(res.warnings).toEqual([]);
    expect(res.end).toBe(24 * H);
    // 05:00~07:00, 18:00~23:00
    expect(hours(res, 'ts:TS1')).toEqual([[0, 0], [5, 1], [7, 0], [18, 1], [23, 0]]);
    expect(hours(res, 'load:EL1')).toEqual([[0, 0], [5, 1], [7, 0], [18, 1], [23, 0]]);
    expect(hours(res, 'load:EL2')).toEqual(hours(res, 'load:EL1'));
    // 차트는 0~24시, 시간 단위
    const p = applyCircuit({ ...createProject(), circuit: c });
    expect(p.settings.duration).toBe(24 * H);
    expect(p.settings.timeUnit).toBe('h');
    expect(p.signals.find((s) => s.address === 'TS1')?.name).toBe('전등 타이머 접점');
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'TS1')?.kind).toBe('24시간 타임 스위치 (다이얼식)');
    expect(rows.find((r) => r.tag === 'TS1')?.spec).toContain('ON 18:00~23:00, 05:00~07:00');
    expect(rows.find((r) => r.tag === 'EL1')?.kind).toBe('전등');
  });

  it('runs past midnight, starts from the chosen clock time and stops while the supply is off', () => {
    const c = example('tsw-light');
    c.parts.find((p) => p.type === 'r_tsw')!.sched = [[22 * H, 2 * H]];
    // 21:00 에 시작: 1시간 뒤(22:00) 켜지고, 5시간 뒤(02:00) 꺼진다
    c.clock = 21 * H;
    expect(hours(runScenario(c), 'load:EL1')).toEqual([[0, 0], [1, 1], [5, 0]]);
    // 23:00 (t = 2h) 에 차단기를 1시간 내리면 시계가 1시간 늦어진다: 꺼지는 것은 t = 6h
    c.ops = [
      { id: 'a', wait: 2 * H, tag: 'MCB1', action: 'off', hold: 0 },
      { id: 'b', wait: 1 * H, tag: 'MCB1', action: 'on', hold: 0 },
    ];
    const res = runScenario(c);
    expect(hours(res, 'load:EL1')).toEqual([[0, 0], [1, 1], [2, 0], [3, 1], [6, 0]]);
    expect(hours(res, 'ts:TS1')).toEqual([[0, 0], [1, 1], [6, 0]]);
  });

  it('time switch + auto/manual selector + contactor', () => {
    const c = example('tsw-panel');
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    expect(res.warnings).toEqual([]);
    // 자동: 18:00 ~ 다음 날 06:00, 수동: 10시부터 1시간
    expect(hours(res, 'coil:MC1')).toEqual([[0, 1], [6, 0], [10, 1], [11, 0], [18, 1]]);
    expect(hours(res, 'load:EL3')).toEqual(hours(res, 'coil:MC1'));
  });

  it('3-way switches control one light from two places', () => {
    const c = example('stair');
    expect(checkCircuit(c)).toEqual([]);
    const res = runScenario(c);
    expect(edges(res, 'load:EL1')).toEqual([
      { t: 0, v: 1 },
      { t: 1000, v: 0 },
      { t: 3000, v: 1 },
      { t: 5000, v: 0 },
    ]);
  });

  it('keeps the schedule and start clock through saving, and warns about a missing clock supply', () => {
    const ts = part('r_tsw', 0, 0, 'TS1', { sched: [[18 * H, 23 * H]] });
    const c: Circuit = { parts: [ts, part('src', -10, -10, '', { pole: 'L' })], wires: [], ops: [], clock: 6 * H };
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.parts[0].sched).toEqual([[18 * H, 23 * H]]);
    expect(back.clock).toBe(6 * H);
    expect(checkCircuit(c).some((i) => i.msg.includes('시계 전원'))).toBe(true);
  });
});

describe('time formatting for long charts', () => {
  it('formats and parses hours, minutes and clock times', async () => {
    const { formatTime, parseTime, formatClock, parseClock, tickSteps } = await import('../src/model/format');
    expect(formatTime(6 * 3600000, 'h')).toBe('6 h');
    expect(formatTime(90 * 60000, 'min')).toBe('90 min');
    expect(formatTime(86400000, 'auto')).toBe('24 h');
    expect(formatTime(1500, 'auto')).toBe('1.5 s');
    expect(parseTime('6h')).toBe(6 * 3600000);
    expect(parseTime('30min')).toBe(30 * 60000);
    expect(parseTime('1m30s')).toBe(90000);
    expect(parseTime('2', 'h')).toBe(2 * 3600000);
    expect(formatClock(18.5 * 3600000)).toBe('18:30');
    expect(formatClock(25 * 3600000)).toBe('01:00');
    expect(parseClock('18:30')).toBe(18.5 * 3600000);
    expect(parseClock('25:00')).toBeNull();
    // 하루를 1000px 에: 큰 눈금 2시간
    expect(tickSteps(1000 / 86400000, 'h').major).toBe(2 * 3600000);
    expect(tickSteps(0.1, 'ms').major).toBe(1000);
  });
});

describe('device guide and wire numbers', () => {
  it('explains every part and points to examples that exist', async () => {
    const { partGuide } = await import('../src/circuit/guide');
    const { PARTS } = await import('../src/circuit/parts');
    const ids = new Set(circuitExamples().map((e) => e.id));
    for (const type of Object.keys(PARTS) as PartType[]) {
      const g = partGuide(type);
      if (type === 'text') {
        expect(g).toBeNull();
        continue;
      }
      expect(g, type).not.toBeNull();
      expect(g!.what.length, type).toBeGreaterThan(10);
      expect(g!.pins.length, type).toBeGreaterThan(0);
      expect(g!.steps.length, type).toBeGreaterThan(0);
      if (g!.example) expect(ids.has(g!.example), `${type} → ${g!.example}`).toBe(true);
    }
    // 예제가 그 부품을 실제로 쓴다
    for (const type of ['r_mc', 'r_tsw', 'r_relay8', 'r_sw3'] as PartType[]) {
      const ex = circuitExamples().find((e) => e.id === partGuide(type)!.example)!;
      expect(ex.build().parts.some((p) => p.type === type), type).toBe(true);
    }
  });

  it('places one wire number per wire on the drawing', async () => {
    const { wiringList, wireNoLabels } = await import('../src/circuit/wiring');
    const c = example('tsw-light');
    const rows = wiringList(c, new CircuitModel(c));
    const labels = wireNoLabels(rows);
    expect(labels).toHaveLength(rows.length);
    expect(new Set(labels.map((l) => l.no))).toEqual(new Set(rows.map((r) => r.no)));
    // L 은 1번, N 은 2번
    expect(rows[0].no).toBe(1);
    expect(rows[0].from.dev).toBe('L');
  });
});
