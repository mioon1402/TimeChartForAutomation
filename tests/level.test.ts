import { describe, expect, it } from 'vitest';
import type { Circuit, OpStep, Part, PartType, Pole, Wire } from '../src/circuit/types';
import { CircuitModel, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { verifyWiring } from '../src/circuit/verify';
import { toWiring, wirePlan } from '../src/circuit/realize';
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

describe('플로트리스 릴레이 + 수조 (예제: 급수 펌프)', () => {
  const c = circuitExamples().find((e) => e.id === 'water-supply')!.build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);

  it('수위: 45% 에서 초당 1% 씀 → 1초 자동 운전 → 초당 4% 오름 → 10초에 E1 (80%) 정지 → 50초에 E2 (40%) 재기동 → 60초 정지', () => {
    expect(pts(res, 'lv:TANK1')).toEqual([
      [0, 45],
      [1000, 44],
      [10000, 80],
      [50000, 40],
      [60000, 80],
      [70000, 70],
    ]);
    expect(changes(res, 'fr:FLR1')).toEqual([
      [0, 0],
      [10000, 1],
      [50000, 0],
      [60000, 1],
    ]);
    expect(changes(res, 'mot:M1')).toEqual([
      [0, '0'],
      [1000, 'FWD'],
      [10000, '0'],
      [50000, 'FWD'],
      [60000, '0'],
    ]);
    // 만수등 = Tc-Ta (릴레이가 켜져 있는 동안)
    expect(changes(res, 'load:GL1')).toEqual(changes(res, 'fr:FLR1'));
  });

  it('[검사] · 경고가 없고, 타임차트에 수위 (%) 아날로그 줄과 릴레이 출력이 생긴다', () => {
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
    const p = applyCircuit({ ...createProject(), circuit: c });
    const lv = p.signals.find((s) => s.group === '수위' && s.kind === 'analog')!;
    expect(lv.name).toContain('E1 80');
    expect([lv.analogMin, lv.analogMax, lv.unit]).toEqual([0, 100, '%']);
    expect(p.signals.some((s) => s.group === '수위' && s.kind === 'bit' && s.name.includes('Ta'))).toBe(true);
  });

  it('조작 순서의 [수위 →]: 20초에 30% 로 떨어뜨리면 E2 아래라 바로 펌프 운전, 32.5초에 다시 80%', () => {
    const ops: OpStep[] = [...c.ops, { id: 'lv', wait: 19000, tag: 'TANK1', action: 'level', value: 30, hold: 0 }];
    const r = runScenario({ ...c, ops, duration: 40000 }, new CircuitModel({ ...c, ops }));
    expect(pts(r, 'lv:TANK1').filter(([t]) => t >= 10000)).toEqual([
      [10000, 80],
      [19999.999, 70],
      [20000, 30],
      // E2 (40%) 를 지나는 순간도 사건 (같은 직선 위의 점)
      [22500, 40],
      [32500, 80],
      [40000, 72.5],
    ]);
    expect(changes(r, 'mot:M1').filter(([t]) => (t as number) >= 10000)).toEqual([
      [10000, '0'],
      [20000, 'FWD'],
      [32500, '0'],
    ]);
    // 걸리는 시간이 있으면 그동안 일정하게
    const ramp: OpStep[] = [...c.ops, { id: 'lv', wait: 19000, tag: 'TANK1', action: 'level', value: 30, hold: 4000 }];
    const r2 = runScenario({ ...c, ops: ramp, duration: 40000 }, new CircuitModel({ ...c, ops: ramp }));
    // 70% → 30% 를 4초에 (초당 10%): 40% (E2) 를 지나는 23초에 펌프 기동, 24초에 30% 에서 다시 급수
    expect(changes(r2, 'mot:M1').filter(([t]) => (t as number) >= 10000)).toEqual([
      [10000, '0'],
      [23000, 'FWD'],
      [36500, '0'],
    ]);
  });

  it('저장해도 수조 설정 · 수위 조작이 남는다', () => {
    const tank = c.parts.find((p) => p.type === 'r_tank')!;
    const ops: OpStep[] = [{ id: 'lv', wait: 100, tag: 'TANK1', action: 'level', value: 25, hold: 500 }];
    const back = sanitizeCircuit(JSON.parse(JSON.stringify({ ...c, ops, parts: c.parts.map((q) => (q.id === tank.id ? { ...q, e1: 90, e2: 30, e3: 5, drainTag: 'M2', drainRate: 3, lv0: 60 } : q)) })))!;
    expect(back.parts.find((q) => q.id === tank.id)).toMatchObject({ fillTag: 'M1', fillRate: 5, useRate: 1, e1: 90, e2: 30, e3: 5, drainTag: 'M2', drainRate: 3, lv0: 60 });
    expect(back.ops[0]).toMatchObject({ action: 'level', value: 25, hold: 500 });
  });

  it('실물 → 회로도: 플로트리스 릴레이 · 수조는 기호가 없다고 알린다', async () => {
    const { toSchematic } = await import('../src/circuit/schematic');
    const notes = toSchematic(c).notes.join('\n');
    expect(notes).toContain('플로트리스 릴레이');
    expect(notes).toContain('수조 전극봉');
  });
});

describe('수조 · 플로트리스 릴레이 배선', () => {
  /** 넷 목록으로 회로를 만들고 [배선 잇기] 로 선을 긋는다 (램프 PL1 = 펌프 대신) */
  const L = (id: string, type: PartType, name: string): [string, number] => [id, partPins({ id, type, x: 0, y: 0, rot: 0, tag: '' }).findIndex((p) => p.label === name)];
  function build(elec: [string, number][][], tank: Partial<Part> = {}, extra: [string, number][][] = []): Circuit {
    const parts: Part[] = [
      { id: 'tL', type: 'r_term', x: 2, y: 0, rot: 0, tag: '', pole: 'L' },
      { id: 'tN', type: 'r_term', x: 5, y: 0, rot: 0, tag: '', pole: 'N' },
      { id: 'cb', type: 'r_mcb2', x: 4, y: 6, rot: 0, tag: 'CB1' },
      { id: 'flr', type: 'r_flr', x: 12, y: 20, rot: 0, tag: 'FLR1' },
      { id: 'tank', type: 'r_tank', x: 32, y: 34, rot: 0, tag: 'TANK1', fillTag: 'PL1', useRate: 1, ...tank },
      { id: 'pl', type: 'r_lamp', x: 22, y: 34, rot: 0, tag: 'PL1' },
    ];
    const plan = [
      [['tL', 0], L('cb', 'r_mcb2', '1')],
      [['tN', 0], L('cb', 'r_mcb2', '3')],
      [L('cb', 'r_mcb2', '2'), L('flr', 'r_flr', 'S1'), L('flr', 'r_flr', 'Tc')],
      [L('cb', 'r_mcb2', '4'), L('flr', 'r_flr', 'S2'), L('pl', 'r_lamp', 'X2')],
      [L('flr', 'r_flr', 'Tb'), L('pl', 'r_lamp', 'X1')],
      ...elec,
      ...extra,
    ].map((pins) => ({ pins }));
    const w = wirePlan({ parts, wires: [], ops: [], plan, system: '1p2w' } as unknown as Circuit);
    expect(w.failed).toBe(0);
    return { ...w.circuit, system: '1p2w', duration: 30000 };
  }
  const E = (a: string, b: string): [string, number][] => [L('flr', 'r_flr', a), L('tank', 'r_tank', b)];
  const ok = [E('E1', 'E1'), E('E2', 'E2'), E('E3', 'E3')];
  const msgs = (c: Circuit) => verifyWiring(c, new CircuitModel(c)).map((i) => i.msg);

  it('바르게 이으면 [검사] 가 조용하다', () => {
    expect(msgs(build(ok))).toEqual([]);
  });

  it('E1 을 잇지 않으면: [검사] 경고, 시뮬레이션은 가득 차도 급수가 계속돼 넘침을 알린다', () => {
    const c = build([E('E2', 'E2'), E('E3', 'E3')]);
    expect(msgs(c).some((m) => m.includes('E1 이(가) 수조 전극봉에 이어지지 않아'))).toBe(true);
    const r = runScenario(c, new CircuitModel(c));
    // 50% → 초당 4% → 12.5초에 100%
    expect(r.warnings.some((w) => w.startsWith('12.5') && w.includes('넘침'))).toBe(true);
  });

  it('E1 · E2 를 바꿔 이으면 경고, E2 가 없으면 유지가 없다고 경고', () => {
    expect(msgs(build([E('E1', 'E2'), E('E2', 'E1'), E('E3', 'E3')])).some((m) => m.includes('전극이 바뀌어'))).toBe(true);
    expect(msgs(build([E('E1', 'E1'), E('E3', 'E3')])).some((m) => m.includes('E2 (하한) 가 수조에 이어지지 않아'))).toBe(true);
  });

  it('전극 단자에 전원이 닿으면 오류', () => {
    const hot = [E('E1', 'E1'), E('E2', 'E2'), [L('flr', 'r_flr', 'E3'), L('tank', 'r_tank', 'E3'), L('cb', 'r_mcb2', '4')]];
    expect(msgs(build(hot as [string, number][][])).some((m) => m.includes('전극 단자 (E1 · E2 · E3) 에 전원 (N)'))).toBe(true);
  });

  it('배수 기기가 빈 수조에서 계속 돌면 공운전을 알린다', () => {
    const c = build(ok, { fillTag: undefined, drainTag: 'PL1', lv0: 20, useRate: 0 });
    const r = runScenario(c, new CircuitModel(c));
    // 20% 에서 초당 5% 배수 → 4초에 0%
    expect(r.warnings.some((w) => w.startsWith('4') && w.includes('공운전'))).toBe(true);
    expect(changes(r, 'lv:TANK1')).toEqual([
      [0, 20],
      [2000, 10],
      [4000, 0],
    ]);
  });

  it('수조의 급수 기기 기호가 회로에 없으면 오류', () => {
    const c = build(ok, { fillTag: 'P9' });
    expect(checkCircuit(c).some((i) => i.msg.includes('급수 기기 P9'))).toBe(true);
  });
});

describe('다이오드 (직류 코일 서지 흡수)', () => {
  /** 기호 회로: + → S1 → 코일 X1 → − 와 다이오드 D1. at = 코일 양단 (바름 · 거꾸로) · 전원 양단 · 접점 양단 */
  function circuit(at: 'coil' | 'reverse' | 'supply' | 'contact', poles: [Pole, Pole] = ['+24V', '0V']): Circuit {
    const parts: Part[] = [
      { id: 'P', type: 'src', x: 0, y: 0, rot: 0, tag: '', pole: poles[0] },
      { id: 'S1', type: 'sw_no', x: 0, y: 5, rot: 0, tag: 'S1' },
      { id: 'X1', type: 'coil', x: 0, y: 11, rot: 0, tag: 'X1' },
      { id: 'M', type: 'src', x: 0, y: 17, rot: 0, tag: '', pole: poles[1] },
      { id: 'D1', type: 'diode', x: 4, y: 11, rot: at === 'reverse' ? 180 : 0, tag: 'D1' },
    ];
    let n = 0;
    const wires: Wire[] = [];
    const w = (...p: [number, number][]) => p.slice(1).forEach((b, i) => wires.push({ id: `w${n++}`, a: p[i], b }));
    w([0, 0], [0, 3]);
    w([0, 7], [0, 9]);
    w([0, 13], [0, 17]);
    // D1 단자: 위 K (4, 9) · 아래 A (4, 13) (거꾸로 돌리면 반대)
    if (at === 'coil' || at === 'reverse') {
      w([4, 9], [4, 8], [0, 8]);
      w([4, 13], [4, 15], [0, 15]);
    } else if (at === 'supply') {
      // A 를 + 에, K 를 0V 에 (순방향)
      w([4, 13], [4, 14], [6, 14], [6, 1], [0, 1]);
      w([4, 9], [4, 8], [2, 8], [2, 16], [0, 16]);
    } else {
      w([4, 9], [4, 1], [0, 1]);
      w([4, 13], [4, 12], [6, 12], [6, 8], [0, 8]);
    }
    return { parts, wires, ops: [{ id: 'o', wait: 500, tag: 'S1', action: 'on', hold: 0 }] } as unknown as Circuit;
  }
  const msgs = (c: Circuit) => verifyWiring(c, new CircuitModel(c)).map((i) => i.msg);

  it('코일 양단에 K 를 + 쪽으로 달면 조용하고, 시뮬레이션에는 영향이 없다', () => {
    const c = circuit('coil');
    expect(msgs(c)).toEqual([]);
    expect(changes(runScenario(c), 'coil:X1')).toEqual([
      [0, 0],
      [500, 1],
    ]);
  });

  it('거꾸로 (A 가 + 쪽) 면 단락 오류, 전원 양단 순방향도 단락 오류', () => {
    expect(msgs(circuit('reverse')).some((m) => m.includes('방향이 거꾸로'))).toBe(true);
    expect(msgs(circuit('supply')).some((m) => m.includes('순방향으로 바로 물려'))).toBe(true);
  });

  it('접점 양단이면 경고, 교류 회로면 오류', () => {
    expect(msgs(circuit('contact')).some((m) => m.includes('접점 S1 의 양단'))).toBe(true);
    expect(msgs(circuit('coil', ['L', 'N'])).some((m) => m.includes('교류 회로에 달려'))).toBe(true);
  });

  it('회로도 → 실물 배선도에서 실물 다이오드로 바뀌고 방향 (K · A) 이 그대로다', () => {
    const c = circuit('coil');
    const r = toWiring(c);
    const d = r.circuit.parts.find((p) => p.type === 'r_diode')!;
    expect(d.tag).toBe('D1');
    const coil = r.circuit.parts.find((p) => p.tag === 'X1' && p.type !== 'r_diode')!;
    const m = new CircuitModel(r.circuit);
    expect(verifyWiring(r.circuit, m).filter((i) => i.msg.includes('D1'))).toEqual([]);
    expect(coil).toBeTruthy();
  });
});
