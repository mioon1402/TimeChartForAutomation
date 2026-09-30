import { describe, expect, it } from 'vitest';
import { EXERCISES, exerciseById, practiceProject } from '../src/learn/exercises';
import { gradeChart, sigKey } from '../src/learn/grade';
import { levelIntervals } from '../src/model/wave';
import type { Project } from '../src/model/types';

const on = (p: Project, key: string) => {
  const s = p.signals.find((x) => sigKey(x) === key)!;
  return levelIntervals(s.points, p.settings.duration, 1).map((iv) => [Math.round(iv.start / 10) * 10, Math.round(iv.end / 10) * 10]);
};

describe('practice exercises', () => {
  it('has a good set of exercises, each fully explained', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.problem.length).toBeGreaterThan(80);
      expect(e.explanation.length).toBeGreaterThan(80);
      expect(e.hints.length).toBeGreaterThanOrEqual(2);
      const b = e.build();
      expect(b.draw.length).toBeGreaterThan(0);
      for (const k of b.draw) {
        const s = b.answer.signals.find((x) => sigKey(x) === k);
        expect(s, `${e.id}: ${k}`).toBeTruthy();
        // 그릴 신호는 한 번 이상 바뀐다 (그리기 연습이 되도록)
        expect(levelIntervals(s!.points, b.answer.settings.duration, 1).length, `${e.id}: ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('PLC answers match the explanations', () => {
    const a = (id: string) => exerciseById(id)!.build().answer;
    const end = (id: string) => a(id).settings.duration;
    expect(on(a('plc-selfhold'), 'Y0')).toEqual([[500, 2000], [3000, end('plc-selfhold')]]);
    expect(on(a('plc-ton'), 'Y0')).toEqual([[2500, 3500]]);
    expect(on(a('plc-toggle'), 'Y0')).toEqual([[500, 1800], [3100, end('plc-toggle')]]);
    expect(on(a('plc-interlock'), 'Y0')).toEqual([[500, 2500]]);
    expect(on(a('plc-interlock'), 'Y1')).toEqual([[3200, end('plc-interlock')]]);
    const cnt = on(a('plc-counter'), 'Y0');
    expect(cnt).toHaveLength(1);
    expect(cnt[0][0]).toBe(1900);
    expect(Math.abs(cnt[0][1] - 3000)).toBeLessThanOrEqual(20);
    const fl = on(a('plc-flicker'), 'Y0');
    expect(fl).toHaveLength(3);
    fl.forEach(([s, e], i) => {
      expect(Math.abs(s - (500 + i * 1000))).toBeLessThanOrEqual(40);
      expect(Math.abs(e - (1000 + i * 1000))).toBeLessThanOrEqual(40);
    });
    const sq = a('plc-sequence');
    expect(on(sq, 'Y0')).toEqual([[500, 4000]]);
    expect(Math.abs(on(sq, 'Y1')[0][0] - 1500)).toBeLessThanOrEqual(20);
    expect(Math.abs(on(sq, 'Y2')[0][0] - 2500)).toBeLessThanOrEqual(30);
    expect(on(sq, 'Y2')[0][1]).toBe(4000);
    const od = on(a('plc-offdelay'), 'Y0');
    expect(od).toHaveLength(1);
    expect(od[0][0]).toBe(500);
    expect(Math.abs(od[0][1] - 6000)).toBeLessThanOrEqual(20);
    // 타임아웃: 첫 번째는 0.8초 만에 도착해 알람 없음, 두 번째는 3.0 + 2초에 알람 → 한 스캔 뒤 SOL OFF
    const to = a('plc-timeout');
    const toY0 = on(to, 'Y0');
    expect(toY0).toHaveLength(2);
    expect(toY0[0]).toEqual([500, 2000]);
    expect(toY0[1][0]).toBe(3000);
    expect(Math.abs(toY0[1][1] - 5000)).toBeLessThanOrEqual(20);
    expect(on(to, 'Y1')).toEqual([[5000, 6000]]);
  });

  it('machine answers match the problem text', () => {
    const a = (id: string) => exerciseById(id)!.build().answer;
    const p = a('mc-pusher');
    expect(on(p, 'Y0')).toEqual([[100, 700]]);
    expect(on(p, 'Y1')).toEqual([[1000, 1500]]);
    expect(on(p, 'X1')).toEqual([[700, 1000]]);
    expect(on(p, 'T0')).toEqual([[700, 1000]]);
    const st = a('mc-stopper');
    expect(on(st, 'Y0')).toEqual([[100, 2500]]);
    expect(on(st, 'T0')).toEqual([[500, 2500]]);
    const pp = a('mc-pick-place');
    expect(on(pp, 'Y2')).toEqual([[500, 2400]]);
    expect(on(pp, 'X3')).toEqual([[800, 2400]]);
    const dr = a('mc-drill');
    expect(on(dr, 'Y2')).toEqual([[600, 2800]]);
    const two = a('mc-two-clamps');
    expect(on(two, 'T0')).toEqual([[800, 1800]]);
  });

  it('grades a drawing signal by signal', () => {
    const ex = exerciseById('plc-interlock')!;
    const b = ex.build();
    const blank = practiceProject(b, ex);
    // 비어 있는 연습 차트: 입력은 주어지고, 그릴 신호는 비어 있음
    expect(on(blank, 'X0')).toEqual([[500, 700]]);
    expect(on(blank, 'Y0')).toEqual([]);
    expect(blank.steps).toHaveLength(0);
    const r0 = gradeChart(blank, b.answer, b.draw);
    expect(r0).toMatchObject({ correct: 0, total: 2 });
    expect(r0.items[0].message).toContain('아직 그리지');
    // 정답을 그대로 그리면 만점
    expect(gradeChart(b.answer, b.answer, b.draw)).toMatchObject({ correct: 2, total: 2 });
    // 한 칸(100ms) 안의 오차는 정답, 그보다 크면 어디가 틀렸는지 알려 줌
    const near = structuredClone(b.answer);
    const y0 = near.signals.find((s) => s.address === 'Y0')!;
    y0.points = [{ t: 0, v: 0 }, { t: 550, v: 1 }, { t: 2500, v: 0 }];
    expect(gradeChart(near, b.answer, b.draw).items[0].ok).toBe(true);
    y0.points = [{ t: 0, v: 0 }, { t: 500, v: 1 }, { t: 3000, v: 0 }];
    const r = gradeChart(near, b.answer, b.draw).items[0];
    expect(r.ok).toBe(false);
    expect(r.message).toContain('2.5초에 OFF');
    y0.points = [{ t: 0, v: 0 }, { t: 500, v: 1 }, { t: 1000, v: 0 }, { t: 1500, v: 1 }, { t: 2500, v: 0 }];
    expect(gradeChart(near, b.answer, b.draw).items[0].message).toContain('ON 구간이 1번');
    // "끝까지 ON" 을 그리다 차트 끝에서 꺼진 것은 괜찮음
    const y1 = near.signals.find((s) => s.address === 'Y1')!;
    y1.points = [{ t: 0, v: 0 }, { t: 3200, v: 1 }, { t: near.settings.duration, v: 0 }];
    expect(gradeChart(near, b.answer, b.draw).items[1].ok).toBe(true);
  });

  it('checks the starting level (home sensors start ON)', () => {
    const ex = exerciseById('mc-pusher')!;
    const b = ex.build();
    const blank = practiceProject(b, ex);
    const r = gradeChart(blank, b.answer, b.draw);
    const home = r.items.find((i) => i.key === 'X2')!;
    expect(home.message).toContain('시작할 때(0초) ON');
  });
});
