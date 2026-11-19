import { describe, expect, it } from 'vitest';
import type { Circuit, Part } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { verifyWiring } from '../src/circuit/verify';
import { applyCircuit } from '../src/circuit/chart';
import { createProject } from '../src/model/project';
import { earthFault, earthStudy, earthingOf } from '../src/circuit/earth';

/** 값이 바뀌는 점만 (지락 전류는 계단으로 그리려고 바뀌기 바로 앞에 이전 값을 한 번 더 찍는다) */
const pts = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [p.t, p.v]);
const brk = (o: Partial<Part>): Part => ({ id: 'b', type: 'r_mcb3', x: 0, y: 0, rot: 0, tag: 'CB', amps: 20, ...o });

describe('지락 계산 (손계산과 같은가)', () => {
  const TN = earthingOf({});
  const TT = earthingOf({ earthing: 'TT' });

  it('TN: 완전 지락은 단락처럼 커서 (220 / 0.4 Ω = 550 A) 일반 차단기가 순시 트립', () => {
    const r = earthFault(220, true, 0, TN, [brk({})]);
    expect(r.ifA).toBeCloseTo(550, 5);
    expect(r.trip?.why).toBe('oc');
    expect(r.level).toBe('ok');
  });

  it('TT: 220 / (Ra 100 + Rb 10) = 2 A 뿐이라 차단기는 안 떨어지고 외함에 200 V → 누전차단기가 끊는다', () => {
    const plain = earthFault(220, true, 0, TT, [brk({})]);
    expect(plain.ifA).toBeCloseTo(2, 5);
    expect(plain.touchV).toBeCloseTo(200, 5);
    expect(plain.trip).toBeNull();
    expect(plain.level).toBe('danger');
    const rcd = earthFault(220, true, 0, TT, [brk({ elb: true })]);
    expect(rcd.trip?.why).toBe('rcd');
    expect(rcd.level).toBe('ok');
    // 감도 100 mA 누전차단기도 2 A 면 끊는다
    expect(earthFault(220, true, 0, TT, [brk({ elb: true, idn: 100 })]).trip?.why).toBe('rcd');
  });

  it('절연이 10 kΩ 으로 나빠지면 약 22 mA: 30 mA 누전차단기는 안 떨어지고 15 mA 는 떨어진다', () => {
    const r = earthFault(220, true, 10000, TT, [brk({ elb: true })]);
    expect(r.ifA * 1000).toBeCloseTo(21.78, 1);
    expect(r.trip).toBeNull();
    expect(r.level).toBe('leak');
    expect(earthFault(220, true, 10000, TT, [brk({ elb: true, idn: 15 })]).trip?.part.tag).toBe('CB');
  });

  it('외함이 접지되지 않으면 전류는 흐르지 않다가, 사람이 만지면 몸으로 약 220 mA (220 V ÷ 1010 Ω)', () => {
    const r = earthFault(220, false, 0, TT, [brk({})]);
    expect(r.ifA).toBe(0);
    expect(r.bodyMa).toBeCloseTo(217.8, 0);
    expect(r.level).toBe('danger');
    const rcd = earthFault(220, false, 0, TT, [brk({ elb: true })]);
    expect(rcd.touchTrip?.tag).toBe('CB');
    expect(rcd.level).toBe('ok');
  });

  it('가까운 차단기가 먼저 끊는다', () => {
    const near = brk({ id: 'n', tag: 'ELB1', elb: true });
    const far = brk({ id: 'f', tag: 'MAIN', elb: true });
    expect(earthFault(220, true, 0, TT, [near, far]).trip?.part.tag).toBe('ELB1');
  });
});

describe('예제: 누전 · 지락 (TT, 접지와 누전차단기)', () => {
  const ex = circuitExamples().find((e) => e.id === 'earth-fault')!;
  const c = ex.build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);

  it('절연 10 kΩ 은 22 mA 로 안 떨어지고, 완전 지락은 2 A → 0.03 초에 ELB 트립, 고치지 않고 다시 넣으면 또 떨어진다', () => {
    expect(pts(res, 'ie:M1')).toEqual([
      [0, 0],
      [1000, 0.022],
      [4000, 0],
      [5000, 2],
      [5030, 0],
      [7000, 2],
      [7030, 0],
    ]);
    expect(pts(res, 'op:ELB1')).toEqual([
      [0, 1],
      [5030, 0],
      [7000, 1],
      [7030, 0],
    ]);
    expect(pts(res, 'op:ELB2')).toEqual([
      [0, 1],
      [9030, 0],
    ]);
    expect(res.warnings.some((w) => w.includes('22 mA') && w.includes('끊지 않습니다'))).toBe(true);
    expect(res.warnings.some((w) => w.includes('누전차단기 ELB1 트립'))).toBe(true);
  });

  it('[검사] 가 깨끗하고, [해석] 의 지락 검토는 두 기기 모두 누전차단기가 끊는다', () => {
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    const st = earthStudy(c, model);
    expect(st.kind).toBe('TT');
    expect(st.rows.map((r) => [r.name, r.r.earthed, Math.round(r.r.ifA * 10) / 10, r.r.trip?.part.tag])).toEqual([
      ['M1', true, 2, 'ELB1'],
      ['CON1', true, 2, 'ELB2'],
    ]);
    expect(st.leaks.map((l) => [l.part.tag, l.ma, l.idnMa])).toEqual([
      ['ELB1', 1, 30],
      ['ELB2', 1, 30],
    ]);
  });

  it('누전차단기를 일반 차단기로 바꾸면 [검사] 가 알리고, PE 선을 빼면 외함이 접지되지 않는다', () => {
    const plain: Circuit = { ...c, parts: c.parts.map((p) => (p.tag === 'ELB1' ? { ...p, elb: undefined } : p)) };
    expect(verifyWiring(plain, new CircuitModel(plain)).some((i) => i.msg.startsWith('TT 계통인데 M1'))).toBe(true);
    const r = runScenario(plain, new CircuitModel(plain));
    expect(r.warnings.some((w) => w.includes('외함에 약 200 V 가 계속 남습니다'))).toBe(true);
    // M1 의 PE 단자에서 나가는 선을 지움
    const m1 = c.parts.find((p) => p.tag === 'M1')!;
    const pe: [number, number] = [m1.x + 4, m1.y + 1];
    const cut: Circuit = { ...c, wires: c.wires.filter((w) => !(w.a[0] === pe[0] && w.a[1] === pe[1]) && !(w.b[0] === pe[0] && w.b[1] === pe[1])) };
    const sim = new CircuitSim(new CircuitModel(cut));
    sim.setLeak('M1', 0);
    const v = sim.faultView.get('M1')!;
    expect(v.earthed).toBe(false);
    expect(v.bodyMa).toBeCloseTo(217.8, 0);
    expect(v.touchTrip?.tag).toBe('ELB1');
  });

  it('누전을 없애면 다시 넣은 누전차단기가 그대로 붙어 있다', () => {
    const sim = new CircuitSim(model);
    sim.setLeak('M1', 0);
    sim.advanceTo(100);
    expect(sim.on('ELB1')).toBe(false);
    sim.setLeak('M1', null);
    sim.setAct('ELB1', true);
    sim.advanceTo(300);
    expect(sim.on('ELB1')).toBe(true);
    expect(sim.energized.has(c.parts.find((p) => p.tag === 'M1')!.id)).toBe(true);
  });

  it('타임차트에 누전 · 지락 전류 행, 저장해도 접지 방식 · 감도 · 누전 조작이 남는다', () => {
    const p = applyCircuit({ ...createProject(), circuit: c });
    const rows = p.signals.filter((s) => s.group === '누전 · 지락').map((s) => s.name);
    expect(rows).toEqual(['펌프 누전', '펌프 지락 전류 (A)', '콘센트 (세척기) 누전', '콘센트 (세척기) 지락 전류 (A)']);
    const back = sanitizeCircuit(JSON.parse(JSON.stringify({ ...c, ra: 50, rb: 5 })))!;
    expect([back.earthing, back.ra, back.rb]).toEqual(['TT', 50, 5]);
    expect(back.parts.find((q) => q.tag === 'ELB1')?.idn).toBe(30);
    expect(back.ops[0]).toMatchObject({ action: 'leak', value: 10000, hold: 3000 });
  });
});
