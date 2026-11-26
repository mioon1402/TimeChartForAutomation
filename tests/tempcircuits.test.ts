import { describe, expect, it } from 'vitest';
import { CircuitModel, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples, exampleGroups } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';

const run = (id: string) => {
  const c = circuitExamples().find((e) => e.id === id)!.build();
  const model = new CircuitModel(c);
  return { c, model, res: runScenario(c, model) };
};
const changes = (res: ScenarioResult, key: string) =>
  res.tracks
    .find((t) => t.key === key)!
    .points.filter((p, i, a) => i === 0 || p.v !== a[i - 1].v)
    .map((p) => [Math.round(p.t), p.v]);
const temps = (res: ScenarioResult) => res.tracks.find((t) => t.kind === 'tempVal')!.points.map((p) => [p.t, p.v as number] as const);
const at = (pts: (readonly [number, number])[], t: number) => pts.find(([x]) => Math.abs(x - t) < 1)?.[1];
const S = 1000;

describe('온도 유지 회로 모음', () => {
  it('메뉴의 "온도 유지 · 제어" 묶음에 온도 예제가 모여 있다', () => {
    expect(exampleGroups().map((g) => g.key)).toContain('temp');
    const ids = circuitExamples()
      .filter((e) => e.group === 'temp')
      .map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['tc-heater', 'panel-thermo', 'ssr-heater', 'blower-timer', 'oven-pid', 'pid-learn', 'freezer-defrost', 'water-heater', 'temp-alarm', 'pipe-freeze']));
  });

  for (const id of ['freezer-defrost', 'water-heater', 'temp-alarm', 'pipe-freeze'])
    it(`${id}: [검사] · 시뮬레이션 경고가 없다`, () => {
      const { c, model, res } = run(id);
      expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
      expect(res.warnings).toEqual([]);
    });

  it('냉동 창고: 10℃ 에서 냉각 (10초 지연) → -20℃ 에서 압축기 정지, 지연만큼 -21℃ 까지 더 내려가고 -18℃ 에서 다시 운전', () => {
    const { res } = run('freezer-defrost');
    const tv = temps(res);
    const mc = changes(res, 'coil:MC1');
    expect(mc.slice(0, 2)).toEqual([
      [0, 0],
      [1 * S, 1],
    ]);
    // 1초 운전, 11초부터 초당 0.1℃ (그동안 0.03℃ 씩 오름): 10.33 → -20 은 303.3초 뒤
    expect(mc[2][0]).toBeCloseTo(314300, -1);
    expect(mc[2][1]).toBe(0);
    expect(at(tv, mc[2][0] as number)).toBeCloseTo(-20, 6);
    const steady = tv.filter(([t]) => t > 330 * S && t < 720 * S).map(([, v]) => v);
    expect(Math.min(...steady)).toBeCloseTo(-20 - 0.1 * 10, 6);
    expect(Math.max(...steady)).toBeCloseTo(-18 + 0.03 * 10, 6);
  });

  it('냉동 창고: 제상 타이머가 12분마다 3분 제상 — 그동안 압축기 정지 · 제상 히터 · 제상등', () => {
    const { res } = run('freezer-defrost');
    expect(changes(res, 'tq:T1')).toEqual([
      [0, 0],
      [1 * S, 1],
      [721 * S, 0],
      [901 * S, 1],
      [1621 * S, 0],
    ]);
    expect(changes(res, 'load:HT1')).toEqual([
      [0, 0],
      [721 * S, 1],
      [901 * S, 0],
      [1621 * S, 1],
    ]);
    expect(changes(res, 'load:YL1')).toEqual(changes(res, 'load:HT1'));
    const mc = changes(res, 'coil:MC1');
    expect(mc.filter(([t, v]) => (t as number) > 721 * S && (t as number) < 901 * S && v === 1)).toEqual([]);
    // 제상 동안 냉동실이 조금 데워짐
    expect(Math.max(...temps(res).filter(([t]) => t > 721 * S && t < 1000 * S).map(([, v]) => v))).toBeGreaterThan(-16);
  });

  it('전기 온수기: 물이 E2 아래면 급수 밸브, 히터는 물이 있을 때 (플로트리스 Ta) 만 — 공가열 방지', () => {
    const { res } = run('water-heater');
    const ht = changes(res, 'load:HT1');
    expect(ht.slice(0, 9)).toEqual([
      [0, 0],
      [13.5 * S, 1],
      [53.5 * S, 0],
      [63.5 * S, 1],
      [103.5 * S, 0],
      [113.5 * S, 1],
      [153.5 * S, 0],
      [163.5 * S, 1],
      [203.5 * S, 0],
    ]);
    // 히터가 켜진 순간마다 플로트리스 릴레이가 켜져 있다
    const flr = res.tracks.find((t) => t.key === 'fr:FLR1')!.points;
    const flrAt = (t: number) => [...flr].reverse().find((p) => p.t <= t + 1e-6)!.v;
    for (const [t, v] of ht) if (v === 1) expect(flrAt(t as number)).toBe(1);
    // 급수 밸브는 Tb (물이 적을 때)
    expect(changes(res, 'load:SOL1').slice(0, 4)).toEqual([
      [0, 0],
      [1 * S, 1],
      [13.5 * S, 0],
      [53.5 * S, 1],
    ]);
  });

  it('전기 온수기: 60℃ 에 닿으면 조절기가 끊고, 조절기 고장으로 95℃ 까지 올리면 90℃ 에서 과열 방지 서모스탯이 열린다', () => {
    const { res } = run('water-heater');
    const tv = temps(res);
    expect(at(tv, 203.5 * S)).toBeCloseTo(60, 6);
    const th = changes(res, 'tt:TH1');
    expect(th[0]).toEqual([0, 1]);
    expect(th[1][1]).toBe(0);
    expect(at(tv, th[1][0] as number) ?? tv.find(([t]) => t >= (th[1][0] as number))![1]).toBeCloseTo(90, 0);
    expect(Math.max(...tv.map(([, v]) => v))).toBeCloseTo(95, 6);
  });

  it('온도 경보: 80℃ 이상이면 경보등 + 부저, 확인 버튼에 부저만 멈추고 경보등은 77℃ 로 내려갈 때까지, 다음 과열에 다시 울림', () => {
    const { res } = run('temp-alarm');
    expect(changes(res, 'load:RL1')).toEqual([
      [0, 0],
      [120 * S, 1],
      [185 * S, 0],
      [300 * S, 1],
      [340 * S, 0],
    ]);
    expect(changes(res, 'load:BZ1')).toEqual([
      [0, 0],
      [120 * S, 1],
      [130 * S, 0],
      [300 * S, 1],
      [340 * S, 0],
    ]);
    expect(changes(res, 'coil:X2')).toEqual([
      [0, 0],
      [130 * S, 1],
      [185 * S, 0],
    ]);
    // 90℃ 에서 초당 0.2℃ 식어 77℃ (80 − 히스테리시스 3) 는 65초 뒤
    expect(at(temps(res), 185 * S)).toBeCloseTo(77, 6);
  });

  it('배관 동파 방지: 밤 (-10℃) 동안 배관이 3 ~ 8℃ 사이에 머물고, 해가 들면 열선이 쉰다', () => {
    const { res } = run('pipe-freeze');
    const tv = temps(res);
    const night = tv.filter(([t]) => t < 20 * 60 * S).map(([, v]) => v);
    expect(Math.min(...night)).toBeCloseTo(3, 6);
    expect(Math.max(...night)).toBeCloseTo(8, 6);
    const hs = changes(res, 'load:HT1');
    // 처음 6℃ (8℃ 아래) 라 바로 켜지고, 8℃ 에서 꺼짐 (초당 0.03℃ → 66.7초)
    expect(hs[0]).toEqual([0, 1]);
    expect(hs[1][0]).toBeCloseTo(66667, -1);
    // 아침 (20분~50분, 12℃ 까지 오름) 에 8℃ 를 넘긴 뒤로는 50분이 지날 때까지 꺼져 있음
    const morning = hs.filter(([t]) => (t as number) > 34 * 60 * S && (t as number) < 50 * 60 * S);
    expect(morning.every(([, v]) => v === 0)).toBe(true);
  });

  it('처음 온도 (t0) 는 저장해도 남고, 없으면 주위 온도에서 시작한다', () => {
    const { c } = run('freezer-defrost');
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.parts.find((p) => p.tag === 'TC1')).toMatchObject({ t0: 10, amb: -25, tmax: 15, lag: 10, tLoadCool: true });
    const noT0 = { ...c, parts: c.parts.map((p) => (p.tag === 'TC1' ? { ...p, t0: undefined } : p)) };
    expect(temps(runScenario(noT0, new CircuitModel(noT0)))[0][1]).toBe(-25);
  });
});
