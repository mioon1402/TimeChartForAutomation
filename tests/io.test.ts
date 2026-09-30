import { describe, expect, it } from 'vitest';
import { parseLooseJson } from '../src/io/json5';
import { exportWaveDrom, importWaveDrom, waveToPoints } from '../src/io/wavedrom';
import { exportChangeTable, exportSignalList, exportStepTable, importCsvLog } from '../src/io/csv';
import { parseDsl, serializeDsl } from '../src/io/dsl';
import { sampleProject } from '../src/model/project';
import { checkRules } from '../src/model/analysis';

describe('loose json', () => {
  it('parses wavedrom-style sources', () => {
    const v = parseLooseJson(`{ signal: [ {name: 'clk', wave: 'p...'}, // comment
      { name: "d", wave: "x=.", data: ['A',], }, ], }`);
    expect(v).toEqual({ signal: [{ name: 'clk', wave: 'p...' }, { name: 'd', wave: 'x=.', data: ['A'] }] });
  });
  it('reports errors with line', () => {
    expect(() => parseLooseJson('{\n a: [1, 2\n')).toThrow(/줄/);
  });
});

describe('wavedrom', () => {
  it('converts waves', () => {
    expect(waveToPoints({ wave: '01.0' }, 100).points).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 300, v: 0 },
    ]);
    const bus = waveToPoints({ wave: 'x=.=x', data: ['A', 'B'] }, 10);
    expect(bus.kind).toBe('bus');
    expect(bus.points.map((p) => p.v)).toEqual(['x', 'A', 'B', 'x']);
    const clk = waveToPoints({ wave: 'p....', period: 2 }, 50);
    expect(clk.kind).toBe('clock');
    expect(clk.clockPeriod).toBe(100);
  });

  it('imports groups, head and edges', () => {
    const src = `{signal: [
      {name: 'req', wave: '0.1..0', node: '..a'},
      ['grp', {name: 'ack', wave: '0...10', node: '....b'}],
    ], edge: ['a~>b 응답'], head: {text: '핸드셰이크'}}`;
    const { project, warnings } = importWaveDrom(src, 100);
    expect(warnings).toEqual([]);
    expect(project.meta.title).toBe('핸드셰이크');
    expect(project.signals[1].group).toBe('grp');
    expect(project.settings.duration).toBe(600);
    const arrow = project.annotations[0];
    expect(arrow.type).toBe('arrow');
    if (arrow.type === 'arrow') {
      expect(arrow.from.t).toBe(200);
      expect(arrow.to.t).toBe(400);
      expect(arrow.label).toBe('응답');
      expect(arrow.dashed).toBe(true);
    }
  });

  it('round-trips through export', () => {
    const p = sampleProject();
    const { source } = exportWaveDrom(p, 50);
    const back = importWaveDrom(source, 50).project;
    expect(back.signals.length).toBe(p.signals.length);
    const y0 = back.signals.find((s) => s.name.includes('(Y0)'))!;
    expect(y0.points.map((x) => [x.t, x.v])).toEqual([
      [0, 0],
      [300, 1],
      [2400, 0],
    ]);
    const d0 = back.signals.find((s) => s.name.includes('(D0)'))!;
    expect(d0.kind).toBe('bus');
    expect(d0.points.map((x) => x.v)).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '0']);
    expect(back.annotations.filter((a) => a.type === 'arrow').length).toBe(4);
  });
});

describe('csv', () => {
  it('exports change table with BOM', () => {
    const txt = exportChangeTable(sampleProject());
    expect(txt.startsWith('﻿')).toBe(true);
    const lines = txt.trim().split('\r\n');
    expect(lines[0]).toContain('자동 시작 PB (X0)');
    expect(lines[1].startsWith('0,')).toBe(true);
    expect(exportSignalList(sampleProject())).toContain('클램프 SOL');
    expect(exportStepTable(sampleProject())).toContain('S40 가공');
  });

  it('imports data logger CSV', () => {
    const csv = ['Time(s),X0 시작,Y0 모터,D0,압력', '0.00,0,0,0,0.0', '0.10,1,0,0,0.5', '0.20,1,1,10,1.1', '0.30,0,1,10,2.2', '0.40,0,0,20,3.1']
      .concat(Array.from({ length: 20 }, (_, i) => `${(0.5 + i * 0.1).toFixed(2)},0,0,20,${(3 + i * 0.37).toFixed(2)}`))
      .join('\n');
    const { project, timeUnit } = importCsvLog(csv);
    expect(timeUnit).toBe('s');
    const [x0, y0, d0, pr] = project.signals;
    expect(x0.address).toBe('X0');
    expect(x0.name).toBe('시작');
    expect(x0.role).toBe('input');
    expect(x0.points).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 300, v: 0 },
    ]);
    expect(y0.kind).toBe('bit');
    expect(d0.kind).toBe('bus');
    expect(pr.kind).toBe('analog');
    expect(project.settings.duration).toBeCloseTo(2400);
  });

  it('imports datetime-stamped logs', () => {
    const csv = 'Date Time,M0\n2024/01/01 10:00:00.000,0\n2024/01/01 10:00:00.250,1\n2024/01/01 10:00:01.000,0\n';
    const { project, timeUnit } = importCsvLog(csv);
    expect(timeUnit).toBe('datetime');
    expect(project.signals[0].points.map((p) => p.t)).toEqual([0, 250, 1000]);
  });
});

describe('text dsl', () => {
  it('round-trips the sample project', () => {
    const p = sampleProject();
    const text = serializeDsl(p);
    const { project: q, errors } = parseDsl(text);
    expect(errors).toEqual([]);
    expect(q.meta.title).toBe(p.meta.title);
    expect(q.settings.duration).toBe(p.settings.duration);
    expect(q.signals.length).toBe(p.signals.length);
    for (let i = 0; i < p.signals.length; i++) {
      expect(q.signals[i].name).toBe(p.signals[i].name);
      expect(q.signals[i].points).toEqual(p.signals[i].points);
      expect(q.signals[i].kind).toBe(p.signals[i].kind);
      expect(q.signals[i].group).toBe(p.signals[i].group);
    }
    expect(q.steps.map((s) => [s.label, s.start, s.end])).toEqual(p.steps.map((s) => [s.label, s.start, s.end]));
    expect(q.annotations.length).toBe(p.annotations.length);
    expect(q.rules.length).toBe(p.rules.length);
    expect(checkRules(q).map((r) => r.status)).toEqual(checkRules(p).map((r) => r.status));
    // 두 번째 직렬화 결과가 같아야 한다 (안정성)
    expect(serializeDsl(q)).toBe(text);
  });

  it('parses hand-written text with units and errors', () => {
    const { project, errors } = parseDsl(`
title: 테스트
duration: 2s
grid: 100ms
sig X0 "시작" input : 0 | 100 1 | 0.3s 0
sig - "실린더" actuator on=전진 off=후진 : 0 | 300 1~200 | 1s 0 ~ 200
sig D0 "스텝" bus : 0 | 300 "STEP 10" | 1000 20
arrow X0@100 -> "실린더"@300 "기동"
rule pulse X0 1 max=150 "PB 폭"
bogus line
arrow Y9@1 -> X0@2
`);
    expect(project.settings.duration).toBe(2000);
    expect(project.signals[0].points).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 300, v: 0 },
    ]);
    expect(project.signals[1].points[1]).toEqual({ t: 300, v: 1, ramp: 200 });
    expect(project.signals[1].points[2]).toEqual({ t: 1000, v: 0, ramp: 200 });
    expect(project.signals[2].points[1].v).toBe('STEP 10');
    expect(project.annotations.length).toBe(1);
    expect(checkRules(project)[0].status).toBe('fail');
    expect(errors.map((e) => e.line)).toEqual([10, 11]);
  });
});

describe('templates', () => {
  it('build without DSL errors and pass their own rules', async () => {
    const { templates } = await import('../src/model/templates');
    const { parseDsl } = await import('../src/io/dsl');
    for (const t of templates()) {
      const p = t.build();
      expect(p.format).toBe('timechart-studio');
      if (t.id === 'robot' || t.id === 'inverter') {
        expect(parseDsl(serializeDsl(p)).errors).toEqual([]);
        expect(p.signals.length).toBeGreaterThan(5);
        expect(checkRules(p).every((r) => r.status === 'ok')).toBe(true);
      }
    }
  });
});
