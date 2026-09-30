import { describe, expect, it } from 'vitest';
import { parseTable, toTsv } from '../src/io/tsv';
import { defaultSpec, ioPoints, newDevice, type SeqSpec } from '../src/model/sequence';
import {
  applySequence,
  chartEditedSinceApply,
  detectActionHeader,
  editActions,
  editDevices,
  emptySpec,
  newSequenceProject,
  parseSec,
  pasteActionTable,
  pasteDeviceTable,
  pasteIoTable,
  removeDevices,
  sequenceStatus,
  unusedDevices,
  withSequence,
} from '../src/model/seqEdit';
import { migrateProject } from '../src/model/project';

const names = (s: SeqSpec) =>
  s.actions.map((a) => {
    const d = s.devices.find((x) => x.id === a.device);
    return d ? `${d.name} ${a.dir === 'fwd' ? d.fwdLabel : d.retLabel}${a.withPrev ? ' (동시)' : ''}` : `대기 ${a.label} ${a.wait}`;
  });

describe('clipboard tables', () => {
  it('reads Excel cells with quotes, tabs and line breaks', () => {
    const text = '기기\t동작\t비고\r\n클램프\t전진\t"두 줄\r\n메모"\r\n"따옴표 ""A"""\t후진\t\r\n\r\n';
    expect(parseTable(text)).toEqual([
      ['기기', '동작', '비고'],
      ['클램프', '전진', '두 줄\r\n메모'],
      ['따옴표 "A"', '후진', ''],
    ]);
    const back = parseTable(toTsv(parseTable(text)));
    expect(back).toEqual(parseTable(text));
  });

  it('reads CSV when there are no tabs', () => {
    expect(parseTable('a,b\n1,"2,5"')).toEqual([
      ['a', 'b'],
      ['1', '2,5'],
    ]);
  });

  it('parses seconds and milliseconds', () => {
    expect(parseSec('0.5')).toBe(500);
    expect(parseSec('0,5')).toBe(500);
    expect(parseSec('1.2초')).toBe(1200);
    expect(parseSec('350ms')).toBe(350);
    expect(parseSec('350', true)).toBe(350);
    expect(parseSec('빠름')).toBeNull();
  });
});

describe('sequence table editing', () => {
  it('creates a device from a new name and learns its motion names', () => {
    const r = editActions(emptySpec(), [
      { row: 0, col: 'dev', text: '리프터' },
      { row: 0, col: 'mot', text: '상승' },
      { row: 0, col: 'time', text: '0.6' },
    ]);
    expect(r.notes[0]).toContain('리프터');
    const d = r.spec.devices[0];
    expect(d).toMatchObject({ name: '리프터', fwdLabel: '상승', retLabel: '하강', fwdTime: 600 });
    // 다음 줄에 이름만 적으면 반대 동작
    const r2 = editActions(r.spec, [{ row: 1, col: 'dev', text: '리프터' }]);
    expect(names(r2.spec)).toEqual(['리프터 상승', '리프터 하강']);
    // 모르는 동작 이름은 알려 준다
    const r3 = editActions(r2.spec, [{ row: 1, col: 'mot', text: '회전' }]);
    expect(r3.warnings[0]).toContain('리프터');
  });

  it('splits "device motion" typed in one cell and reads waits', () => {
    const r = editActions(emptySpec(), [
      { row: 0, col: 'mot', text: '클램프 전진' },
      { row: 1, col: 'mot', text: '가공 대기' },
      { row: 1, col: 'time', text: '2' },
      { row: 2, col: 'mot', text: '클램프 후진' },
      { row: 2, col: 'start', text: '동시' },
    ]);
    expect(names(r.spec)).toEqual(['클램프 전진', '대기 가공 2000', '클램프 후진 (동시)']);
  });

  it('pastes an Excel sequence table by its header row', () => {
    const m = parseTable('No\t기기\t동작\t소요시간(ms)\t시작 조건\n1\t클램프\t전진\t400\t\n2\t프레스\t하강\t900\t\n3\t진공\t흡착\t300\t동시\n4\t대기\t가압\t1500\t\n5\t프레스\t상승\t900\t\n6\t진공\t해제\t200\t\n7\t클램프\t후진\t400\t');
    expect(detectActionHeader(m[0])).toMatchObject({ ms: true });
    const r = pasteActionTable(defaultSpec(), m, 0)!;
    expect(names(r.spec)).toEqual(['클램프 전진', '프레스 하강', '진공 흡착 (동시)', '대기 가압 1500', '프레스 상승', '진공 해제', '클램프 후진']);
    const vac = r.spec.devices.find((d) => d.name === '진공')!;
    expect(vac).toMatchObject({ kind: 'vacuum', fwdTime: 300, retTime: 200 });
    expect(r.spec.devices.find((d) => d.name === '클램프')!.fwdTime).toBe(400);
    expect(unusedDevices(r.spec)).toEqual([]);
  });

  it('does not treat data rows as a header', () => {
    expect(detectActionHeader(['클램프', '전진', '0.5'])).toBeNull();
  });

  it('edits and pastes the device table', () => {
    let s = editDevices(emptySpec(), [
      { row: 0, col: 'name', text: '컨베이어' },
      { row: 0, col: 'kind', text: '모터' },
      { row: 1, col: 'name', text: '스토퍼' },
      { row: 1, col: 'kind', text: '싱글' },
      { row: 1, col: 'fwdT', text: '300ms' },
      { row: 1, col: 'sen', text: 'X' },
    ]).spec;
    expect(s.devices.map((d) => [d.name, d.kind, d.fwdLabel, d.fwdTime, d.sensors])).toEqual([
      ['컨베이어', 'motor', '기동', 0, false],
      ['스토퍼', 'cyl1', '전진', 300, false],
    ]);
    const r = pasteDeviceTable(s, parseTable('기기명\t종류\t전진시간\t후진시간\t센서\n푸셔\t더블\t0.4\t0.3\tO'), 2)!;
    s = r.spec;
    expect(s.devices[2]).toMatchObject({ name: '푸셔', kind: 'cyl2', fwdTime: 400, retTime: 300, sensors: true });
    // 기기를 지우면 그 기기의 동작도 지운다
    const withAct = editActions(s, [{ row: 0, col: 'dev', text: '푸셔' }]).spec;
    const del = removeDevices(withAct, [2]);
    expect(del.removedActions).toBe(1);
    expect(del.spec.devices).toHaveLength(2);
  });

  it('fills I/O addresses from a pasted I/O list by name', () => {
    const s = defaultSpec();
    const r = pasteIoTable(s, parseTable('주소\t코멘트\nX10\t시작 버튼\nX11\t클램프 전진 센서\nY20\t클램프 전진 SOL\nY21\t없는 신호'))!;
    const io = ioPoints(r.spec);
    const by = (n: string) => io.find((p) => p.name === n)!.address;
    expect(by('시작 버튼')).toBe('X10');
    expect(by('클램프 전진단')).toBe('X11');
    expect(by('클램프 전진 SOL')).toBe('Y20');
    expect(r.notes[0]).toContain('3');
  });
});

describe('apply to chart', () => {
  it('tracks whether the chart matches the table and whether it was edited by hand', () => {
    const p = newSequenceProject(defaultSpec());
    expect(sequenceStatus(p)).toBe('applied');
    expect(chartEditedSinceApply(p)).toBe(false);
    // 표를 고치면 "아직 적용 안 함"
    const s = p.sequence!;
    const changed = withSequence(p, { ...s, devices: s.devices.map((d, i) => (i === 0 ? { ...d, fwdTime: 900 } : d)) });
    expect(sequenceStatus(changed)).toBe('changed');
    // 제목·설비 이름은 차트 모양과 상관없다
    expect(sequenceStatus({ ...p, meta: { ...p.meta, machine: '압입기' } })).toBe('applied');
    const applied = applySequence(changed, changed.sequence!);
    expect(sequenceStatus(applied)).toBe('applied');
    // 파일로 저장했다 읽어도 그대로
    const reloaded = migrateProject(JSON.parse(JSON.stringify(applied)));
    expect(sequenceStatus(reloaded)).toBe('applied');
    expect(chartEditedSinceApply(reloaded)).toBe(false);
    // 차트를 손으로 고치면 알아챈다
    const hand = { ...applied, signals: applied.signals.map((x, i) => (i === 1 ? { ...x, points: [...x.points, { t: 5000, v: 1 }] } : x)) };
    expect(chartEditedSinceApply(hand)).toBe(true);
  });

  it('keeps the title block, report settings and PLC config when rebuilding', () => {
    const p = newSequenceProject(defaultSpec());
    const custom = { ...p, meta: { ...p.meta, title: '압입기 자동 사이클', company: '(주)예시', checker: '김검토' }, plc: { dialect: 'ls' as const, source: 'LOAD P0', comments: '', sim: p.plc?.sim as never } };
    const again = applySequence(custom, custom.sequence!);
    expect(again.meta).toMatchObject({ title: '압입기 자동 사이클', company: '(주)예시', checker: '김검토' });
    expect(again.plc?.source).toBe('LOAD P0');
    expect(again.id).toBe(p.id);
  });

  it('treats charts from the old wizard as applied until the table changes', () => {
    const p = newSequenceProject(defaultSpec());
    const { applied: _, ...oldSpec } = p.sequence!;
    void _;
    const old = { ...p, sequence: oldSpec as SeqSpec };
    expect(sequenceStatus(old)).toBe('applied');
    const edited = withSequence(old, { ...oldSpec, devices: [...oldSpec.devices, newDevice('motor', '컨베이어')] } as SeqSpec);
    expect(sequenceStatus(edited)).toBe('changed');
    // 예전 파일은 차트를 손으로 고쳤는지 알 수 없으니 다시 만들 때 묻는다
    expect(chartEditedSinceApply(edited)).toBe(true);
  });
});

describe('sequence examples', () => {
  it('every example builds a chart with no review notes and meets its target', async () => {
    const { seqExamples } = await import('../src/model/seqExamples');
    const { computeTimeline } = await import('../src/model/sequence');
    for (const ex of seqExamples()) {
      const s = ex.build();
      const tl = computeTimeline(s);
      expect(tl.notes, ex.id).toEqual([]);
      if (s.targetCycle) expect(tl.cycleEnd - tl.cycleStart, ex.id).toBeLessThanOrEqual(s.targetCycle);
      const p = newSequenceProject(s);
      expect(p.signals.length, ex.id).toBeGreaterThan(2);
      expect(sequenceStatus(p)).toBe('applied');
    }
  });
});

describe('start delay', () => {
  it('reads "+0.2" in the start cell and shifts the motion', async () => {
    const { computeTimeline } = await import('../src/model/sequence');
    const { parseDelay, startText } = await import('../src/model/seqEdit');
    expect(parseDelay('앞 동작이 끝난 뒤 +0.2초')).toBe(200);
    expect(parseDelay('동시 300ms')).toBe(300);
    expect(parseDelay('앞 동작이 끝난 뒤')).toBe(0);
    let s = editActions(emptySpec(), [
      { row: 0, col: 'mot', text: '클램프 전진' },
      { row: 1, col: 'mot', text: '블로우 기동' },
      { row: 1, col: 'start', text: '동시 +0.3' },
      { row: 2, col: 'mot', text: '프레스 하강' },
      { row: 2, col: 'start', text: '+0.2' },
    ]).spec;
    const tl = computeTimeline(s);
    const [clamp, blow, press] = tl.items;
    expect(blow.start - clamp.start).toBe(300);
    expect(blow.group).toBe(clamp.group);
    expect(press.start - Math.max(clamp.end, blow.end)).toBe(200);
    expect(startText(s.actions[1], false, true)).toBe('앞 동작과 동시에 +0.3초');
    // 지연을 지우면 원래대로
    s = editActions(s, [{ row: 2, col: 'start', text: '앞 동작이 끝난 뒤' }]).spec;
    expect(s.actions[2].delay).toBeUndefined();
    // 차트 화살표는 센서 확인 시각에서 지연된 출력으로
    const p = newSequenceProject({ ...s, actions: s.actions.map((a, i) => (i === 2 ? { ...a, delay: 200 } : a)) });
    const arrows = p.annotations.filter((a) => a.type === 'arrow');
    expect(arrows.some((a) => a.type === 'arrow' && a.to.t - a.from.t === 200)).toBe(true);
  });
});

describe('one-end sensors', () => {
  it('a cylinder with only the forward-end sensor gets one input and a chart without the return sensor', async () => {
    const { ioPoints } = await import('../src/model/sequence');
    let s = editDevices(emptySpec(), [
      { row: 0, col: 'name', text: '스토퍼' },
      { row: 0, col: 'sen', text: '전진단만' },
      { row: 1, col: 'name', text: '리프트' },
      { row: 1, col: 'fwd', text: '상승' },
      { row: 1, col: 'ret', text: '하강' },
      { row: 1, col: 'sen', text: '하강단만' },
    ]).spec;
    expect(s.devices.map((d) => d.sensors)).toEqual(['fwd', 'ret']);
    const io = ioPoints(s).filter((p) => p.dir === 'in').map((p) => p.name);
    expect(io).toEqual(['시작 버튼', '스토퍼 전진단', '리프트 하강단']);
    s = editActions(s, [
      { row: 0, col: 'dev', text: '스토퍼' },
      { row: 1, col: 'dev', text: '스토퍼' },
    ]).spec;
    const p = newSequenceProject(s);
    expect(p.signals.some((x) => x.name === '스토퍼 후진단')).toBe(false);
    expect(p.signals.some((x) => x.name === '스토퍼 전진단')).toBe(true);
    // 다시 양쪽으로
    s = editDevices(s, [{ row: 0, col: 'sen', text: '있음' }]).spec;
    expect(s.devices[0].sensors).toBe(true);
  });
});
