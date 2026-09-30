import { describe, expect, it } from 'vitest';
import { buildProject, computeTimeline, defaultSpec, ioPoints, newAction, newDevice, START_AT, suggestActions, type SeqSpec } from '../src/model/sequence';
import { checkRules, cycleSummary } from '../src/model/analysis';
import { migrateProject } from '../src/model/project';
import { valueAt } from '../src/model/wave';

function spec(partial: Partial<SeqSpec> = {}): SeqSpec {
  const clamp = newDevice('cyl2', '클램프', { fwdTime: 500, retTime: 400 });
  const press = newDevice('cyl1', '프레스', { fwdLabel: '하강', retLabel: '상승', fwdTime: 800, retTime: 600 });
  const s: SeqSpec = { ...defaultSpec(), devices: [clamp, press], actions: [] };
  s.actions = [
    newAction({ device: clamp.id, dir: 'fwd' }),
    newAction({ device: press.id, dir: 'fwd' }),
    newAction({ device: '', wait: 1000, label: '가압' }),
    newAction({ device: press.id, dir: 'ret' }),
    newAction({ device: clamp.id, dir: 'ret' }),
  ];
  return { ...s, ...partial };
}

describe('sequence wizard model', () => {
  it('assigns I/O addresses per PLC style', () => {
    const s = spec();
    const mit = ioPoints(s);
    expect(mit.filter((p) => p.dir === 'in').map((p) => `${p.address} ${p.name}`)).toEqual(['X0 시작 버튼', 'X1 클램프 전진단', 'X2 클램프 후진단', 'X3 프레스 하강단', 'X4 프레스 상승단']);
    expect(mit.filter((p) => p.dir === 'out').map((p) => `${p.address} ${p.name}`)).toEqual(['Y0 클램프 전진 SOL', 'Y1 클램프 후진 SOL', 'Y2 프레스 하강 SOL']);
    const ls = ioPoints({ ...s, addrStyle: 'ls' });
    expect(ls[0].address).toBe('P00000');
    expect(ls.find((p) => p.dir === 'out')!.address).toBe('P00040');
    const sie = ioPoints({ ...s, addrStyle: 'siemens' });
    expect(sie.find((p) => p.dir === 'out')!.address).toBe('Q0.0');
    // 사용자가 고친 주소·이름은 유지
    const edited = ioPoints({ ...s, ioEdits: { start: { address: 'X10', name: '자동 시작' } } });
    expect(edited[0]).toMatchObject({ address: 'X10', name: '자동 시작' });
    // 8진수: 9번째 입력은 X10
    const many = { ...s, devices: [...s.devices, newDevice('cyl2', 'A'), newDevice('cyl2', 'B')] };
    expect(ioPoints(many).filter((p) => p.dir === 'in')[8].address).toBe('X10');
  });

  it('times actions: one after another, or together', () => {
    const s = spec();
    const tl = computeTimeline(s);
    expect(tl.groups.map((g) => [g.start, g.end])).toEqual([
      [100, 600],
      [600, 1400],
      [1400, 2400],
      [2400, 3000],
      [3000, 3400],
    ]);
    expect(tl.notes).toEqual([]);
    // 프레스 하강을 클램프 전진과 동시에 → 두 동작 중 긴 쪽이 끝나야 다음 단계
    const par = spec();
    par.actions[1].withPrev = true;
    const t2 = computeTimeline(par);
    expect(t2.groups[0]).toMatchObject({ start: 100, end: 900 });
    expect(t2.groups[1]).toMatchObject({ start: 900, end: 1900 });
    expect(t2.cycleEnd).toBe(2900);
  });

  it('flags motions that do not return home or repeat', () => {
    const s = spec();
    s.actions = s.actions.slice(0, 3);
    const tl = computeTimeline(s);
    expect(tl.notes.some((n) => n.includes('클램프') && n.includes('후진 위치로 돌아오지'))).toBe(true);
    s.actions.push(newAction({ device: s.devices[0].id, dir: 'fwd' }));
    expect(computeTimeline(s).notes.some((n) => n.includes('이미 전진'))).toBe(true);
  });

  it('draws solenoids, cylinder motion, sensors, steps, arrows and checks', () => {
    const s = spec({ targetCycle: 3000, machine: '프레스 설비' });
    const p = buildProject(s);
    const sig = (name: string) => p.signals.find((x) => x.name === name)!;
    const at = (name: string, t: number) => valueAt(sig(name).points, t);
    // 더블 솔레노이드: 움직이는 동안만 ON
    expect(at('클램프 전진 SOL', 300)).toBe(1);
    expect(at('클램프 전진 SOL', 700)).toBe(0);
    expect(at('클램프 후진 SOL', 3200)).toBe(1);
    // 싱글 솔레노이드: 하강해 있는 동안 계속 ON
    expect(at('프레스 하강 SOL', 2000)).toBe(1);
    expect(at('프레스 하강 SOL', 2500)).toBe(0);
    // 센서: 도착하면 ON, 원위치 센서는 떠나는 순간 OFF
    expect(at('클램프 전진단', 550)).toBe(0);
    expect(at('클램프 전진단', 650)).toBe(1);
    expect(at('클램프 후진단', 50)).toBe(1);
    expect(at('클램프 후진단', 150)).toBe(0);
    expect(at('클램프 후진단', 3450)).toBe(1);
    // 실린더 동작선: 경사 = 동작 시간
    const cyl = sig('클램프 실린더');
    expect(cyl.points[1]).toMatchObject({ t: 100, v: 1, ramp: 500 });
    expect(cyl.onLabel).toBe('전진');
    // 대기 타이머 행, 주소
    expect(at('가압 타이머 (1s)', 1500)).toBe(1);
    expect(sig('시작 버튼').address).toBe('X0');
    // 공정 스텝 5개, 화살표(시작 + 단계 사이 4개), 사이클 완료 마커
    expect(p.steps.map((x) => x.label)).toEqual(['S10 클램프 전진', 'S20 프레스 하강', 'S30 대기: 가압 1 s', 'S40 프레스 상승', 'S50 클램프 후진']);
    expect(p.annotations.filter((a) => a.type === 'arrow')).toHaveLength(5);
    const c = cycleSummary(p);
    expect(c.total).toBe(3300);
    // 목표 3.0초 초과 → NG, 클램프 SOL 동시 ON 금지 → OK
    const res = checkRules(p);
    expect(res.find((r) => r.rule.type === 'cycle')!.status).toBe('fail');
    expect(res.find((r) => r.rule.type === 'exclusive')!.status).toBe('ok');
    expect(p.meta.title).toBe('프레스 설비 동작 타임차트');
    // 저장 → 다시 열기 해도 작성 순서가 남아 있음
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back.sequence?.actions).toHaveLength(5);
  });

  it('suggests going out in order and coming back in reverse', () => {
    const s = spec();
    const text = suggestActions(s.devices).map((a) => (a.device ? `${s.devices.find((d) => d.id === a.device)!.name}:${a.dir}` : 'wait'));
    expect(text).toEqual(['클램프:fwd', '프레스:fwd', 'wait', '프레스:ret', '클램프:ret']);
    expect(START_AT).toBe(100);
  });
});
