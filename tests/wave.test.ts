import { describe, expect, it } from 'vitest';
import {
  clockPoints,
  deleteTime,
  edgesOf,
  insertTime,
  levelIntervals,
  moveEdge,
  normalize,
  pulsesToPoints,
  setRange,
  valueAt,
} from '../src/model/wave';
import { formatTime, parseTime } from '../src/model/format';
import { checkRules, cycleSummary, measureDelays, sequenceEvents, signalStats, stepsFromOutputs } from '../src/model/analysis';
import { migrateProject, sampleProject } from '../src/model/project';
import type { WavePoint } from '../src/model/types';

describe('wave ops', () => {
  it('normalizes: sorts, dedupes, ensures t=0', () => {
    const p = normalize([
      { t: 300, v: 0 },
      { t: 100, v: 1 },
      { t: 200, v: 1 },
    ]);
    expect(p).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 300, v: 0 },
    ]);
  });

  it('setRange restores the following value', () => {
    let p = pulsesToPoints([{ start: 100, end: 500 }]);
    p = setRange(p, 200, 300, 0);
    expect(p.map((x) => [x.t, x.v])).toEqual([
      [0, 0],
      [100, 1],
      [200, 0],
      [300, 1],
      [500, 0],
    ]);
    expect(valueAt(p, 250)).toBe(0);
    expect(valueAt(p, 350)).toBe(1);
  });

  it('keeps ramps on transitions', () => {
    const p = pulsesToPoints([{ start: 100, end: 500 }], 0, 50);
    expect(p[1].ramp).toBe(50);
    expect(p[2].ramp).toBe(50);
    expect(p[0].ramp).toBeUndefined();
  });

  it('moves an edge within neighbours', () => {
    const p = pulsesToPoints([{ start: 100, end: 500 }]);
    const m = moveEdge(p, 1, 700);
    expect(m.map((x) => x.t)).toEqual([0]); // 상승 에지를 하강 에지 너머로 끌면 펄스가 사라짐
    const m2 = moveEdge(p, 1, 150);
    expect(m2[1].t).toBe(150);
  });

  it('inserts and deletes time', () => {
    const p = pulsesToPoints([{ start: 100, end: 500 }]);
    expect(insertTime(p, 200, 100).map((x) => x.t)).toEqual([0, 100, 600]);
    expect(deleteTime(p, 200, 300).map((x) => x.t)).toEqual([0, 100, 400]);
  });

  it('computes edges and intervals', () => {
    const p = pulsesToPoints([
      { start: 100, end: 200 },
      { start: 400, end: 700 },
    ]);
    expect(edgesOf(p).map((e) => e.kind)).toEqual(['rise', 'fall', 'rise', 'fall']);
    expect(levelIntervals(p, 1000, 1)).toEqual([
      { start: 100, end: 200 },
      { start: 400, end: 700 },
    ]);
    expect(levelIntervals(p, 1000, 0)[0]).toEqual({ start: 0, end: 100 });
  });

  it('generates clocks', () => {
    const c = clockPoints({ clockPeriod: 100, clockDuty: 0.5 }, 300);
    expect(c.map((x) => [x.t, x.v])).toEqual([
      [0, 1],
      [50, 0],
      [100, 1],
      [150, 0],
      [200, 1],
      [250, 0],
    ]);
  });
});

describe('format', () => {
  it('parses times', () => {
    expect(parseTime('500')).toBe(500);
    expect(parseTime('1.5s')).toBe(1500);
    expect(parseTime('T#1s500ms')).toBe(1500);
    expect(parseTime('S5T#2S')).toBe(2000);
    expect(parseTime('abc')).toBeNull();
  });
  it('formats times', () => {
    expect(formatTime(1500, 'auto')).toBe('1.5 s');
    expect(formatTime(250, 'auto')).toBe('250 ms');
    expect(formatTime(250, 's')).toBe('0.25 s');
  });
});

describe('analysis', () => {
  const p = sampleProject();
  it('sample rules pass', () => {
    const res = checkRules(p);
    expect(res.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });
  it('measures delays', () => {
    const y2 = p.signals.find((s) => s.address === 'Y2')!;
    const x3 = p.signals.find((s) => s.address === 'X3')!;
    const d = measureDelays(p, y2.id, 'rise', x3.id, 'rise');
    expect(d[0].delay).toBe(500);
  });
  it('detects exclusive violation', () => {
    const q = structuredClone(p);
    const x1 = q.signals.find((s) => s.address === 'X1')!;
    const x2 = q.signals.find((s) => s.address === 'X2')!;
    x2.points = setRange(x2.points, 1000, 1100, 1);
    q.rules = [{ id: 'r', type: 'exclusive', name: 'x', a: x1.id, b: x2.id }];
    const res = checkRules(q);
    expect(res[0].status).toBe('fail');
    expect(res[0].violations[0].t0).toBe(1000);
  });
  it('summarizes cycle by steps', () => {
    const c = cycleSummary(p);
    expect(c.basis).toBe('steps');
    expect(c.total).toBe(2500);
    expect(c.longest?.label).toBe('S40 가공');
  });
  it('signal stats', () => {
    const y0 = p.signals.find((s) => s.address === 'Y0')!;
    const st = signalStats(y0, p.settings.duration);
    expect(st.onCount).toBe(1);
    expect(st.onTotal).toBe(2100);
  });
  it('round-trips project json', () => {
    const q = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(q.signals.length).toBe(p.signals.length);
    expect(q.signals[2].points).toEqual(p.signals[2].points);
  });
});

describe('process view', () => {
  const on = (a: number, b: number): WavePoint[] => [{ t: 0, v: 0 }, { t: a, v: 1 }, { t: b, v: 0 }];
  it('splits steps by output combinations, absorbing short overlaps', () => {
    const t = (id: string, name: string, points: WavePoint[], rank?: 0 | 1) => ({ id, name, address: id, points, rank });
    const tracks = [
      t('P20', '전원 MC', [{ t: 0, v: 0 }, { t: 100, v: 1 }]), // 거의 항상 ON → 제외
      t('P21', 'UP', on(1000, 10000)),
      t('P22', '브레이크 해제', on(950, 10100)), // 브레이크가 모터보다 조금 먼저 풀리고 늦게 잠김
      t('P23', 'SLOW', on(8000, 10000)),
      t('P24', 'LEFT', on(12000, 17000)),
      t('P25', '운전 램프', on(1000, 17000)), // 램프 → 제외
      t('P26', '센터 도착', [{ t: 0, v: 0 }, { t: 17000, v: 1 }]), // 도중에 켜져 끝까지 = 상태 → 제외
      t('P27', '', [{ t: 0, v: 0 }]), // 한 번도 안 켜짐
    ];
    const steps = stepsFromOutputs(tracks, 20000);
    // 먼저 켜진 출력 두 개로 이름 → SLOW 가 더해져도 이름이 같으므로 한 스텝
    expect(steps.map((s) => [s.label, s.start, s.end])).toEqual([
      ['브레이크 해제 + UP', 950, 10100],
      ['대기', 10100, 12000],
      ['LEFT', 12000, 17000],
    ]);
    // 설비 모델의 동작/속도 출력이 있으면 그 이름으로
    const ranked = stepsFromOutputs(tracks.map((x) => (x.id === 'P21' || x.id === 'P24' ? { ...x, rank: 0 as const } : x.id === 'P23' ? { ...x, rank: 1 as const } : x)), 20000);
    expect(ranked.map((s) => s.label)).toEqual(['UP', 'UP + SLOW', '대기', 'LEFT']);
    expect(ranked[1].description).toContain('P22 브레이크 해제');
  });

  it('lists signal changes in time order with the step they belong to', () => {
    const p = sampleProject();
    const evs = sequenceEvents(p);
    expect(evs.length).toBeGreaterThan(3);
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i].t).toBeGreaterThanOrEqual(evs[i - 1].t);
      expect(evs[i].dt).toBeCloseTo(evs[i].t - evs[i - 1].t, 6);
    }
    expect(evs[0].dt).toBeNull();
    const bitEv = evs.find((e) => e.signal.kind === 'bit')!;
    expect(['on', 'off']).toContain(bitEv.kind);
  });
});
