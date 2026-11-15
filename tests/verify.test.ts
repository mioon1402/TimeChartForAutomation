import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire, WireColor } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario } from '../src/circuit/engine';
import { PARTS, palette, pinPositions } from '../src/circuit/parts';
import { ratedVoltage, verifyWiring } from '../src/circuit/verify';
import { checkCircuit } from '../src/circuit/bom';
import { PowerModel } from '../src/circuit/power';
import { circuitExamples } from '../src/circuit/examples';
import { partGuide } from '../src/circuit/guide';
import { sanitizeCircuit } from '../src/circuit/sanitize';

let n = 0;
const part = (type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}): Part => ({ id: `p${n++}`, type, x, y, rot: 0, tag, ...extra });
const wire = (a: [number, number], b: [number, number], color?: WireColor): Wire => ({ id: `w${n++}`, a, b, ...(color ? { color } : {}) });
const term = (pole: Part['pole'], x: number, y: number) => part('r_term', x, y, '', { pole });
/** 다른 부품의 단자 자리에 전원 단자를 겹쳐 놓는다 (선 없이 물린 것과 같다) */
const at = (p: Part, pin: number, pole: Part['pole']) => term(pole, ...pinPositions(p)[pin]);
const msgs = (c: Circuit) => verifyWiring(c, new CircuitModel(c)).map((i) => `${i.level}: ${i.msg}`);
const has = (c: Circuit, text: string) => msgs(c).some((m) => m.includes(text));

/** L → 차단기 → 램프 → N (문제 없는 회로) */
function lampCircuit(o: { breaker?: boolean; nWire?: boolean; lColor?: WireColor; nColor?: WireColor } = {}): Circuit {
  const lamp = part('r_lamp', 1, 14, 'PL1', { color: 'red' });
  const parts = [term('L', 0, 0), term('N', 2, 20), lamp];
  const wires: Wire[] = [];
  if (o.breaker === false) wires.push(wire([0, 0], [0, 15], o.lColor ?? 'brown'));
  else {
    parts.push(part('r_mcb1', 0, 6, 'MCB1'));
    wires.push(wire([0, 0], [0, 2], 'brown'), wire([0, 10], [0, 15], o.lColor ?? 'brown'));
  }
  if (o.nWire !== false) wires.push(wire([2, 15], [2, 20], o.nColor ?? 'blue'));
  return { parts, wires, ops: [] };
}

describe('wiring checks: loads that can never work', () => {
  it('a correctly wired lamp has no findings', () => {
    expect(msgs(lampCircuit())).toEqual([]);
  });

  it('reports the terminal that never reaches the supply', () => {
    const c = lampCircuit({ nWire: false });
    expect(has(c, 'PL1: X2 단자가 전원까지 이어지지 않습니다')).toBe(true);
    expect(verifyWiring(c, new CircuitModel(c)).find((i) => i.msg.includes('X2'))).toMatchObject({ level: 'error' });
  });

  it('reports a load with both terminals on the same pole, and AC mixed with DC', () => {
    const lamp = part('r_lamp', 1, 14, 'PL1');
    const both: Circuit = { parts: [lamp, at(lamp, 0, 'L'), at(lamp, 1, 'L')], wires: [], ops: [] };
    expect(has(both, '두 단자가 모두 L1 쪽에만')).toBe(true);
    const mixed: Circuit = { parts: [lamp, at(lamp, 0, 'L'), at(lamp, 1, '0V')], wires: [], ops: [] };
    expect(has(mixed, '교류와 직류가 섞였습니다')).toBe(true);
  });

  it('reports loads wired in series', () => {
    const a = part('r_lamp', 1, 4, 'PL1');
    const b = part('r_lamp', 3, 4, 'PL2');
    const c: Circuit = { parts: [a, b, at(a, 0, 'L'), at(b, 1, 'N')], wires: [], ops: [] };
    expect(msgs(c).filter((m) => m.includes('직렬 연결'))).toHaveLength(2);
  });

  it('reports an open phase and two terminals on the same phase of a motor', () => {
    const m = part('r_motor3', 0, 0, 'M1');
    const open: Circuit = { parts: [m, at(m, 0, 'L1'), at(m, 1, 'L2')], wires: [], ops: [] };
    expect(has(open, 'M1: W 단자에 상이 닿지 않습니다 (결상)')).toBe(true);
    const same: Circuit = { parts: [m, at(m, 0, 'L1'), at(m, 1, 'L1'), at(m, 2, 'L3')], wires: [], ops: [] };
    expect(has(same, '서로 다른 세 상')).toBe(true);
    const ok: Circuit = { parts: [m, at(m, 0, 'L1'), at(m, 1, 'L2'), at(m, 2, 'L3'), at(m, 3, 'PE')], wires: [], ops: [] };
    expect(msgs(ok).filter((x) => x.startsWith('error'))).toEqual([]);
  });

  it('does not nag about a device that is not wired yet beyond one warning', () => {
    const c: Circuit = { parts: [term('L', 0, 0), part('r_lamp', 10, 10, 'PL1')], wires: [], ops: [] };
    expect(msgs(c)).toEqual(['warn: PL1: 아직 배선되지 않았습니다']);
  });
});

describe('wiring checks: voltage', () => {
  it('reads the rated voltage from the spec text', () => {
    const p = (spec?: string, type: PartType = 'r_lamp') => ratedVoltage(part(type, 0, 0, 'X', spec ? { spec } : {}));
    expect(p('AC 220V')).toMatchObject({ kind: 'ac', lo: 220, hi: 220 });
    expect(p('DC24V')).toMatchObject({ kind: 'dc', lo: 24, hi: 24 });
    expect(p('AC/DC 24V')).toMatchObject({ kind: 'any', lo: 24 });
    expect(p('AC 100~240V')).toMatchObject({ kind: 'ac', lo: 100, hi: 240 });
    expect(p()).toBeNull();
    // 덮개에 AC 220V 가 적혀 나오는 릴레이는 사양을 비워도 그 전압
    expect(p(undefined, 'r_my2')).toMatchObject({ kind: 'ac', lo: 220 });
  });

  it('an AC 220 V relay on DC 24 V is an error; marking it DC 24 V clears it', () => {
    const x = part('r_relay8', 10, 10, 'X1');
    const c: Circuit = { parts: [x, at(x, 1, '+24V'), at(x, 6, '0V')], wires: [], ops: [] };
    expect(has(c, 'X1: 정격은 AC 220V 인데 DC 24V 에 이어져 있습니다')).toBe(true);
    const fixed: Circuit = { ...c, parts: c.parts.map((p) => (p.id === x.id ? { ...p, spec: 'DC 24V' } : p)) };
    expect(msgs(fixed).filter((m) => m.includes('정격'))).toEqual([]);
  });

  it('reports over- and under-voltage', () => {
    const lamp = part('r_lamp', 1, 14, 'PL1', { spec: 'AC 110V' });
    expect(has({ parts: [lamp, at(lamp, 0, 'L'), at(lamp, 1, 'N')], wires: [], ops: [] }, '과전압')).toBe(true);
    const coil = part('r_relay8', 10, 10, 'X1', { spec: 'AC 380V' });
    expect(has({ parts: [coil, at(coil, 1, 'L'), at(coil, 6, 'N')], wires: [], ops: [] }, '밖에 걸리지 않습니다')).toBe(true);
    // 넓은 입력 범위 (AC 100~240V) 는 220 V 에서 문제없다
    const wide = part('r_lamp', 1, 14, 'PL1', { spec: 'AC 100~240V' });
    expect(msgs({ parts: [wide, at(wide, 0, 'L'), at(wide, 1, 'N')], wires: [], ops: [] }).filter((m) => m.includes('정격'))).toEqual([]);
  });
});

describe('wiring checks: wiring practice', () => {
  it('reports a dead short between supply poles', () => {
    const c: Circuit = { parts: [term('L', 0, 0), part('r_mcb1', 0, 6, 'MCB1'), term('N', 0, 20)], wires: [wire([0, 0], [0, 2], 'brown'), wire([0, 10], [0, 20], 'brown')], ops: [] };
    const short = verifyWiring(c, new CircuitModel(c)).find((i) => i.msg.startsWith('단락'))!;
    expect(short).toMatchObject({ level: 'error' });
    expect(short.msg).toContain('L1');
    expect(short.msg).toContain('N');
    expect(short.wireIds!.length).toBeGreaterThan(0);
  });

  it('reports a device fed straight from the supply; a fuse or breaker clears it', () => {
    expect(has(lampCircuit({ breaker: false }), '전원 L1 이 차단기 · 퓨즈를 거치지 않고 PL1 에 바로')).toBe(true);
    expect(msgs(lampCircuit()).some((m) => m.includes('거치지 않고'))).toBe(false);
    const lamp = part('r_lamp', 1, 14, 'PL1');
    const fused: Circuit = { parts: [term('L', 0, 0), part('r_fuse', 0, 5, 'F1'), lamp, term('N', 2, 20)], wires: [wire([0, 0], [0, 2], 'brown'), wire([0, 8], [0, 15], 'brown'), wire([2, 15], [2, 20], 'blue')], ops: [] };
    expect(msgs(fused)).toEqual([]);
  });

  it('reports switching on the neutral side', () => {
    const base = lampCircuit({ nWire: false });
    const sw = part('r_sw', 3, 18, 'S1');
    const c: Circuit = { ...base, parts: [...base.parts.filter((p) => p.pole !== 'N'), sw, term('N', 4, 24)], wires: [...base.wires, wire([2, 15], [2, 20], 'blue'), wire([4, 20], [4, 24], 'blue')] };
    expect(has(c, 'PL1: X1 단자가 상 (L) 에 바로 물려 있고 접점이 N 쪽에 있습니다')).toBe(true);
    // 스위치를 L 쪽에 두면 문제없다
    const lamp = part('r_lamp', 7, 14, 'PL2');
    const s2 = part('r_sw', 1, 10, 'S2');
    const good: Circuit = {
      parts: [term('L', 0, 0), part('r_mcb1', 0, 6, 'MCB1'), s2, lamp, term('N', 8, 20)],
      wires: [wire([0, 0], [0, 2], 'brown'), wire([0, 10], [0, 12], 'brown'), wire([2, 12], [6, 12], 'red'), wire([6, 12], [6, 15], 'red'), wire([8, 15], [8, 20], 'blue')],
      ops: [],
    };
    expect(msgs(good)).toEqual([]);
  });

  it('reports loose wire ends and three wires on one screw', () => {
    const base = lampCircuit();
    const loose = wire([5, 5], [8, 5], 'red');
    const withLoose: Circuit = { ...base, wires: [...base.wires, loose] };
    const a = verifyWiring(withLoose, new CircuitModel(withLoose));
    expect(a.find((i) => i.msg.includes('끝이 어디에도 물리지 않은 선 1가닥'))).toMatchObject({ level: 'warn', wireIds: [loose.id] });
    const crowded: Circuit = { ...base, wires: [...base.wires, wire([0, 15], [-3, 15], 'red'), wire([0, 15], [0, 18], 'red')] };
    expect(has(crowded, 'PL1 X1: 나사 단자 하나에 전선 3가닥')).toBe(true);
  });

  it('reports a missing earth on a motor', () => {
    const m = part('r_motor3', 0, 30, 'M1');
    const feed = [at(m, 0, 'L1'), at(m, 1, 'L2'), at(m, 2, 'L3')];
    expect(has({ parts: [m, ...feed], wires: [], ops: [] }, 'M1: 접지 (PE) 가 없습니다')).toBe(true);
    expect(has({ parts: [m, ...feed, term('PE', 20, 20)], wires: [], ops: [] }, 'M1: 접지 (PE) 단자가 접지에 이어지지 않았습니다')).toBe(true);
    expect(msgs({ parts: [m, ...feed, at(m, 3, 'PE')], wires: [], ops: [] }).some((x) => x.includes('접지'))).toBe(false);
  });

  it('reports wire colours that do not match the pole', () => {
    expect(has(lampCircuit({ nColor: 'brown' }), '중성선 (N) 인데 파랑이 아닌 전선 1가닥')).toBe(true);
    const gyCircuit = lampCircuit({ lColor: 'gy' });
    const gy = verifyWiring(gyCircuit, new CircuitModel(gyCircuit)).find((i) => i.msg.includes('녹황 전선은 접지 전용'))!;
    expect(gy.level).toBe('error');
    expect(has(lampCircuit({ lColor: 'blue' }), '파랑은 중성선 (N) 색인데 L1')).toBe(true);
    expect(has(lampCircuit({ lColor: 'black' }), 'L1 선인데 검정')).toBe(true);
    // 제어선 색 (빨강 · 노랑 …) 은 자유
    expect(msgs(lampCircuit({ lColor: 'red' }))).toEqual([]);
  });

  it('reports reversed or missing sensor supply and a dead SMPS input', () => {
    const px = part('r_prox', 0, 0, 'PX1');
    expect(has({ parts: [px, at(px, 0, '0V'), at(px, 2, '+24V')], wires: [], ops: [] }, 'PX1: 전원 극성이 반대입니다')).toBe(true);
    expect(has({ parts: [px, at(px, 0, '+24V')], wires: [], ops: [] }, 'PX1: 센서 전원이 이어지지 않았습니다')).toBe(true);
    expect(msgs({ parts: [px, at(px, 0, '+24V'), at(px, 2, '0V')], wires: [], ops: [] })).toEqual([]);
    const ps = part('r_smps', 0, 0, 'PS1');
    expect(has({ parts: [ps, at(ps, 1, 'N')], wires: [], ops: [] }, 'PS1: 입력 전원 (L · N) 이 이어지지 않았습니다')).toBe(true);
  });

  it('the check tab shows the wiring findings, and every built-in example is clean', () => {
    const c = lampCircuit({ nWire: false });
    expect(checkCircuit(c).some((i) => i.msg.includes('전원까지 이어지지 않습니다'))).toBe(true);
    for (const e of circuitExamples()) {
      const ex = e.build();
      expect(verifyWiring(ex, new CircuitModel(ex, e.plc?.())), e.id).toEqual([]);
    }
  });
});

describe('new field devices', () => {
  const on = (c: Circuit, key: string) => runScenario(c).tracks.find((t) => t.key === key)!.points.map((p) => [p.t, p.v]);

  it('fuse holder, bar and ammeter conduct like a wire', () => {
    for (const type of ['r_fuse', 'r_am'] as PartType[]) {
      const f = part(type, 0, 0, 'F1');
      const lamp = part('lamp', 10, 10, 'LA');
      const [a, b] = pinPositions(f);
      const [x1, x2] = pinPositions(lamp);
      const c: Circuit = { parts: [f, lamp, term('L', ...a), term('N', ...x2)], wires: [wire(b, [b[0], x1[1]]), wire([b[0], x1[1]], x1)], ops: [] };
      expect(on(c, 'load:LA'), type).toEqual([[0, 1]]);
    }
    const bar = part('r_nbar', 0, 0, 'NB1', { n: 5, pole: 'N' });
    expect(pinPositions(bar)).toHaveLength(5);
    const lamp = part('lamp', 8, 2, 'LA');
    const c: Circuit = { parts: [bar, lamp, at(bar, 0, 'N'), term('L', ...pinPositions(lamp)[1])], wires: [], ops: [] };
    // 램프의 위 단자를 다섯째 나사에 겹쳐 놓았다
    expect(pinPositions(lamp)[0]).toEqual(pinPositions(bar)[4]);
    expect(on(c, 'load:LA')).toEqual([[0, 1]]);
  });

  it('SMPS makes 24 V DC when its input is live; a PNP sensor switches its black wire', () => {
    const ps = part('r_smps', 0, 0, 'PS1');
    const px = part('r_prox', 20, 0, 'PX1');
    const lamp = part('lamp', 30, 10, 'LA');
    const [bn, bk, bu] = pinPositions(px);
    const [pl, pn, plus, minus] = pinPositions(ps);
    const [x1, x2] = pinPositions(lamp);
    const c: Circuit = {
      parts: [ps, px, lamp, term('L', ...pl), term('N', ...pn)],
      wires: [wire(plus, [plus[0], 20]), wire([plus[0], 20], [bn[0], 20]), wire([bn[0], 20], bn), wire(minus, [minus[0], 22]), wire([minus[0], 22], [bu[0], 22]), wire([bu[0], 22], bu), wire(bk, [bk[0], x1[1]]), wire([bk[0], x1[1]], x1), wire(x2, [x2[0], 22]), wire([x2[0], 22], [bu[0], 22])],
      ops: [
        { id: 'a', wait: 500, tag: 'PX1', action: 'on', hold: 0 },
        { id: 'b', wait: 1000, tag: 'PX1', action: 'off', hold: 0 },
      ],
    };
    expect(on(c, 'load:LA')).toEqual([[0, 0], [500, 1], [1500, 0]]);
    // 입력이 없으면 출력도 없다
    const dead: Circuit = { ...c, parts: c.parts.filter((p) => p.pole !== 'L') };
    expect(on(dead, 'load:LA')).toEqual([[0, 0]]);
  });

  it('illuminated push button: the lamp follows X1-X2, the contacts follow the press', () => {
    const pb = part('r_pbl', 0, 0, 'PBL1', { color: 'green' });
    const lit: Circuit = { parts: [pb, at(pb, 4, 'L'), at(pb, 5, 'N')], wires: [], ops: [] };
    const sim = new CircuitSim(new CircuitModel(lit));
    sim.settle();
    expect(sim.energized.has(pb.id)).toBe(true);
    expect(sim.on('PBL1')).toBe(false);
    // 23-24 (a) 로 다른 램프를 켠다
    const lamp = part('lamp', 1, 4, 'LA');
    expect(pinPositions(lamp)[0]).toEqual(pinPositions(pb)[3]);
    const c: Circuit = { parts: [pb, lamp, at(pb, 2, 'L'), term('N', ...pinPositions(lamp)[1])], wires: [], ops: [{ id: 'a', wait: 500, tag: 'PBL1', action: 'press', hold: 400 }] };
    expect(on(c, 'load:LA')).toEqual([[0, 0], [500, 1], [900, 0]]);
  });

  it('limit, foot, float and pressure switches have 11-12 (b) and 23-24 (a)', () => {
    for (const type of ['r_ls', 'r_fsw', 'r_float', 'r_psw'] as PartType[]) {
      const def = PARTS[type];
      expect(def.pins.map((q) => q.label), type).toEqual(['11', '12', '23', '24']);
      expect(def.polesNc, type).toEqual([true, false]);
      expect(def.operate, type).toBe(type === 'r_ls' || type === 'r_fsw' ? 'momentary' : 'toggle');
    }
  });

  it('6-lead motor runs in star when the far ends are tied and in delta when they get the next phase', () => {
    const m = part('r_motor6', 0, 0, 'M1');
    const feed = [at(m, 0, 'L1'), at(m, 1, 'L2'), at(m, 2, 'L3')];
    const far = pinPositions(m).slice(3, 6); // W2 U2 V2
    const mode = (c: Circuit) => {
      const sim = new CircuitSim(new CircuitModel(c));
      sim.settle();
      return [sim.energized.has(m.id), sim.motorMode.get(m.id), sim.shorted];
    };
    expect(mode({ parts: [m, ...feed], wires: [], ops: [] })).toEqual([false, undefined, false]);
    // 아래 세 단자를 한 선으로 묶으면 Y
    expect(mode({ parts: [m, ...feed], wires: [wire(far[0], far[2])], ops: [] })).toEqual([true, 'Y', false]);
    // W2 → L1, U2 → L2, V2 → L3 이면 Δ (권선마다 서로 다른 두 상)
    expect(mode({ parts: [m, ...feed, term('L1', ...far[0]), term('L2', ...far[1]), term('L3', ...far[2])], wires: [], ops: [] })).toEqual([true, 'D', false]);
    // 권선 양 끝이 같은 상이면 돌지 않는다
    expect(mode({ parts: [m, ...feed, term('L3', ...far[0]), term('L1', ...far[1]), term('L2', ...far[2])], wires: [], ops: [] })[0]).toBe(false);
  });

  it('voltmeter reads the voltage between its terminals', () => {
    const vm = part('r_vm', 0, 0, 'V1');
    const lamp = part('r_lamp', 10, 10, 'PL1');
    const c: Circuit = { parts: [vm, lamp, at(vm, 0, 'L'), at(vm, 1, 'N'), at(lamp, 0, 'L'), at(lamp, 1, 'N')], wires: [], ops: [] };
    const model = new CircuitModel(c);
    const st = new PowerModel(c, model).solve(new CircuitSim(model));
    const [a, b] = pinPositions(vm);
    expect(st.voltBetween(a, b)).toBeCloseTo(220, 6);
    // 전압이 없는 곳은 0
    expect(st.voltBetween([50, 50], [51, 50])).toBeNull();
  });

  it('every palette item is unique, has a guide, and survives saving', () => {
    const items = palette().flatMap((g) => g.items);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const i of items) if (i.type !== 'text') expect(partGuide(i.type), i.type).not.toBeNull();
    const parts = items.filter((i) => i.type.startsWith('r_')).map((i, k) => part(i.type, k * 20, 0, `T${k}`, i.init));
    const back = sanitizeCircuit(JSON.parse(JSON.stringify({ parts, wires: [], ops: [] })))!;
    expect(back.parts.map((p) => p.type)).toEqual(parts.map((p) => p.type));
    const bar = back.parts.find((p) => p.type === 'r_nbar')!;
    expect(bar).toMatchObject({ n: 6, pole: 'N' });
  });
});
