import { describe, expect, it } from 'vitest';
import { CircuitModel, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { applyCircuit } from '../src/circuit/chart';
import { createProject } from '../src/model/project';

const MIN = 60000;
const temps = (res: ScenarioResult, zone: string) => res.tracks.find((t) => t.key === `tv:${zone.toUpperCase()}`)!.points.map((p) => [p.t, p.v as number] as const);
const peak = (pts: (readonly [number, number])[], from: number, to: number) => Math.max(...pts.filter(([t]) => t >= from && t < to).map(([, v]) => v));
const low = (pts: (readonly [number, number])[], from: number, to: number) => Math.min(...pts.filter(([t]) => t >= from && t < to).map(([, v]) => v));

describe('PID 배우기: 같은 오븐 4대를 ON/OFF · P · PI · PID 로', () => {
  const c = circuitExamples().find((e) => e.id === 'pid-learn')!.build();
  const model = new CircuitModel(c);
  const res = runScenario(c, model);
  const [onoff, p, pi, pid] = ['① ON/OFF', '② P 만', '③ PI', '④ PID'].map((z) => temps(res, z));

  it('① ON/OFF: 히터를 끈 뒤에도 30초 지연 동안 초당 0.2℃ 씩 올라 106℃ 까지 넘치고, 96.5~106℃ 로 계속 흔들린다', () => {
    expect(peak(onoff, 0, 20 * MIN)).toBeCloseTo(100 + 0.2 * 30, 6);
    // 98℃ (100 − 히스테리시스 2) 에서 켜도 30초 동안 초당 0.05℃ 씩 더 내려감
    expect(low(onoff, 10 * MIN, 20 * MIN)).toBeCloseTo(98 - 0.05 * 30, 6);
  });

  it('② P 만: 잔류 편차 — 100℃ 를 지키는 데 MV 20% (식는 속도 ÷ (오르는 + 식는)) 가 필요해 약 2℃ (비례대 10℃ × 20%) 아래에서 멈춘다', () => {
    const v = p.filter(([t]) => t > 15 * MIN && t < 20 * MIN).map(([, x]) => x);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean).toBeGreaterThan(97.3);
    expect(mean).toBeLessThan(98.5);
  });

  it('③ PI 는 편차가 없어지고 (15~20분 100℃ ± 1), ④ PID 는 D 덕분에 처음 · 문을 연 뒤 넘침이 PI 보다 작다', () => {
    for (const z of [pi, pid]) {
      expect(low(z, 15 * MIN, 20 * MIN)).toBeGreaterThan(99);
      expect(peak(z, 15 * MIN, 20 * MIN)).toBeLessThan(101);
    }
    expect(peak(pi, 0, 20 * MIN)).toBeGreaterThan(103);
    expect(peak(pid, 0, 20 * MIN)).toBeLessThan(101.5);
    expect(peak(pi, 20 * MIN, 40 * MIN)).toBeGreaterThan(105);
    expect(peak(pid, 20 * MIN, 40 * MIN)).toBeLessThan(102);
  });

  it('20분에 네 오븐 모두 80℃ 로 떨어지고 (외란), [검사] · 경고가 없다', () => {
    for (const z of [onoff, p, pi, pid]) expect(z.some(([t, v]) => t === 20 * MIN && v === 80)).toBe(true);
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('타임차트에 오븐마다 온도 (아날로그) 와 출력 줄이 생기고, 지연 시간은 저장해도 남는다', () => {
    const pr = applyCircuit({ ...createProject(), circuit: c });
    expect(pr.signals.filter((s) => s.kind === 'analog' && s.group === '온도').map((s) => s.name)).toEqual(['① ON/OFF 온도', '② P 만 온도', '③ PI 온도', '④ PID 온도']);
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.parts.filter((q) => q.type === 'r_tk4').map((q) => [q.lag, q.pb, q.ti, q.td, q.ctrl])).toEqual([
      [30, undefined, undefined, undefined, 'onoff'],
      [30, 10, 0, 0, undefined],
      [30, 10, 180, 0, undefined],
      [30, 10, 180, 20, undefined],
    ]);
  });

  it('지연 시간이 없으면 ON/OFF 도 설정에서 바로 멈춘다 (넘침 = 오르는 속도 × 지연 시간)', () => {
    const noLag = { ...c, parts: c.parts.map((q) => (q.type === 'r_tk4' ? { ...q, lag: undefined } : q)) };
    const r = runScenario(noLag, new CircuitModel(noLag));
    expect(peak(temps(r, '① ON/OFF'), 0, 20 * MIN)).toBeCloseTo(100, 6);
  });
});
