import { describe, expect, it } from 'vitest';
import { parseProgram, detectDialect } from '../src/plc/program';
import { applySimulation, defaultWatch, newAxisModel, OUTPUT_STEPS, runSimulation } from '../src/plc/simulator';
import { swapToRealIo } from '../src/plc/alias';
import { plcSamples } from '../src/plc/samples';
import { defaultSimSettings, type PlcDialect, type SimSettings, type Stimulus } from '../src/plc/types';
import { parseDeviceComments } from '../src/plc/comments';
import { createProject } from '../src/model/project';
import type { WavePoint } from '../src/model/types';

function sim(dialect: PlcDialect, src: string, s: Partial<SimSettings>) {
  const prog = parseProgram(src, dialect);
  const settings = { ...defaultSimSettings(), ...s };
  return { prog, res: runSimulation(prog, settings) };
}

const vals = (pts: WavePoint[]) => pts.map((p) => p.v);
const trace = (res: ReturnType<typeof runSimulation>, d: string) => res.traces.find((t) => t.device === d)!.points;

describe('mitsubishi IL', () => {
  it('self-holding circuit with ANB/ORB and timer', () => {
    const src = `
      LD X0
      OR Y0
      ANI X1
      OUT Y0
      LD Y0
      OUT T0 K5
      LD T0
      OUT Y1
      LD X2
      LD X3
      OR X4
      ANB
      OUT Y2
    `;
    const { prog, res } = sim('mitsubishi', src, {
      duration: 2000,
      scanTime: 10,
      stimuli: [
        { device: 'X0', mode: 'pulse', pulses: [{ start: 100, end: 200 }] },
        { device: 'X1', mode: 'pulse', pulses: [{ start: 1500, end: 1600 }] },
        { device: 'X2', mode: 'const', value: 1 },
        { device: 'X4', mode: 'pulse', pulses: [{ start: 300, end: 400 }] },
      ],
      watch: ['Y0', 'T0', 'Y1', 'Y2'],
    });
    expect(prog.messages.filter((m) => m.severity === 'error')).toEqual([]);
    expect(trace(res, 'Y0')).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 1500, v: 0 },
    ]);
    // T0 K5 (100ms 단위) = 500ms
    expect(trace(res, 'T0')).toEqual([
      { t: 0, v: 0 },
      { t: 600, v: 1 },
      { t: 1500, v: 0 },
    ]);
    expect(trace(res, 'Y2')).toEqual([
      { t: 0, v: 0 },
      { t: 300, v: 1 },
      { t: 400, v: 0 },
    ]);
  });

  it('MPS/MRD/MPP branches and edge contacts', () => {
    const src = `
      LD X0
      MPS
      AND X1
      OUT Y0
      MRD
      AND X2
      OUT Y1
      MPP
      OUT Y2
      LDP X3
      OUT M0
      LD X3
      PLF M1
    `;
    const { res } = sim('mitsubishi', src, {
      duration: 1000,
      stimuli: [
        { device: 'X0', mode: 'const', value: 1 },
        { device: 'X1', mode: 'pulse', pulses: [{ start: 100, end: 200 }] },
        { device: 'X3', mode: 'pulse', pulses: [{ start: 500, end: 600 }] },
      ],
      watch: ['Y0', 'Y1', 'Y2', 'M0', 'M1'],
    });
    expect(vals(trace(res, 'Y0'))).toEqual([0, 1, 0]);
    expect(vals(trace(res, 'Y1'))).toEqual([0]);
    expect(vals(trace(res, 'Y2'))).toEqual([1]);
    expect(trace(res, 'M0')).toEqual([
      { t: 0, v: 0 },
      { t: 500, v: 1 },
      { t: 510, v: 0 },
    ]);
    expect(trace(res, 'M1')).toEqual([
      { t: 0, v: 0 },
      { t: 600, v: 1 },
      { t: 610, v: 0 },
    ]);
  });

  it('parses GX Works CSV export with continuation rows', () => {
    const csv = [
      '"MAIN"',
      '"Step No."\t"Line Statement"\t"Instruction"\t"I/O(Device)"\t"Blank"\t"PI Statement"\t"Note"',
      '"0"\t""\t"LD"\t"X000"\t""\t""\t""',
      '"1"\t""\t"OUT"\t"T0"\t""\t""\t""',
      '""\t""\t""\t"K10"\t""\t""\t""',
      '"4"\t""\t"LD"\t"T0"\t""\t""\t""',
      '"5"\t""\t"OUT"\t"Y000"\t""\t""\t""',
    ].join('\n');
    expect(detectDialect(csv)).toBe('mitsubishi');
    const { prog, res } = sim('mitsubishi', csv, {
      duration: 2000,
      stimuli: [{ device: 'X0', mode: 'pulse', pulses: [{ start: 0, end: 1500 }] }],
      watch: ['Y0'],
    });
    expect(prog.messages).toEqual([]);
    expect(prog.devices.map((d) => d.name).sort()).toEqual(['T0', 'X0', 'Y0']);
    expect(trace(res, 'Y0')).toEqual([
      { t: 0, v: 0 },
      { t: 1000, v: 1 },
      { t: 1500, v: 0 },
    ]);
  });
});

describe('samples', () => {
  for (const s of plcSamples()) {
    it(`${s.id} parses without errors and runs`, () => {
      const comments = parseDeviceComments(s.comments, s.dialect);
      const prog = parseProgram(s.source, s.dialect, comments);
      expect(prog.messages.filter((m) => m.severity === 'error')).toEqual([]);
      expect(detectDialect(s.source)).toBe(s.dialect);
      const res = runSimulation(prog, s.sim);
      expect(res.traces.length).toBe(s.sim.watch.length);
      const project = applySimulation(createProject(), prog, s.sim, res);
      expect(project.signals.length).toBeGreaterThanOrEqual(s.sim.watch.length);
      expect(res.warnings).toEqual([]);
    });
  }

  it('mitsubishi drill sequence steps through D0', () => {
    const s = plcSamples().find((x) => x.id === 'mitsubishi-drill')!;
    const prog = parseProgram(s.source, s.dialect, parseDeviceComments(s.comments, 'mitsubishi'));
    expect(prog.stepCandidates[0]).toBe('D0');
    const res = runSimulation(prog, s.sim);
    expect(vals(res.stepTrace!.points)).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '0']);
    const y0 = trace(res, 'Y0');
    expect(y0[1]).toEqual({ t: 100, v: 1 });
    // 클램프 300ms (+1스캔) 후 전진단
    const x1 = trace(res, 'X1');
    expect(x1[1].t).toBeGreaterThanOrEqual(400);
    expect(x1[1].t).toBeLessThanOrEqual(420);
    const project = applySimulation(createProject(), prog, s.sim, res);
    expect(project.steps.map((st) => st.label)).toEqual(['S10', 'S20', 'S30', 'S40', 'S50', 'S60', 'S70']);
    expect(project.signals.find((x) => x.address === 'X0')!.name).toBe('자동 시작 PB');
    const cyl = project.signals.find((x) => x.role === 'actuator')!;
    expect(cyl.points[1].ramp).toBe(300);
    expect(project.settings.duration).toBeLessThanOrEqual(3500);
  });

  it('mitsubishi STL transfers steps and clears outputs', () => {
    const s = plcSamples().find((x) => x.id === 'mitsubishi-stl')!;
    const prog = parseProgram(s.source, s.dialect);
    const res = runSimulation(prog, s.sim);
    const y0 = trace(res, 'Y0');
    expect(vals(y0)).toEqual([0, 1, 0]);
    const y1 = trace(res, 'Y1');
    expect(vals(y1)).toEqual([0, 1, 0]);
    // STL: 전이 다음 스캔에 이전 스텝 출력 OFF → 1500ms + 1스캔
    expect(y1[2].t - y1[1].t).toBe(1510);
    expect(vals(trace(res, 'S0'))).toEqual([1, 0, 1]);
    const project = applySimulation(createProject(), prog, s.sim, res);
    expect(project.steps.map((x) => x.label)).toEqual(['S0 초기 스텝', 'S20 리프터 상승', 'S21 컨베이어 반출', 'S22 리프터 하강', 'S0 초기 스텝']);
  });

  it('LS pick & place visits all 8 steps', () => {
    const s = plcSamples().find((x) => x.id === 'ls-pickplace')!;
    const prog = parseProgram(s.source, s.dialect);
    expect(prog.devices.find((d) => d.name === 'P00040')!.role).toBe('output');
    expect(prog.devices.find((d) => d.name === 'P00001')!.role).toBe('input');
    expect(prog.devices.find((d) => d.name === 'P00000')!.comment).toBe('시작 PB');
    const res = runSimulation(prog, s.sim);
    for (let i = 1; i <= 8; i++) expect(vals(trace(res, `M0000${i}`))).toEqual([0, 1, 0]);
    expect(vals(trace(res, 'P00040'))).toEqual([0, 1, 0, 1, 0]);
  });

  it('siemens STL: parentheses, SD timer, counter', () => {
    const s = plcSamples().find((x) => x.id === 'siemens-pusher')!;
    const prog = parseProgram(s.source, s.dialect);
    const res = runSimulation(prog, s.sim);
    const q40 = trace(res, 'Q4.0');
    expect(q40).toEqual([
      { t: 0, v: 0 },
      { t: 200, v: 1 },
      { t: 8000, v: 0 },
    ]);
    const t1 = trace(res, 'T1');
    expect(t1[1].t).toBe(3000);
    expect(vals(trace(res, 'Q4.1'))).toEqual([0, 1, 0, 1, 0]);
    const mw = trace(res, 'MW10');
    expect(mw[mw.length - 1].v).toBe('2');
  });

  it('ST CASE sequence runs two cycles', () => {
    const s = plcSamples().find((x) => x.id === 'st-press')!;
    const prog = parseProgram(s.source, s.dialect);
    expect(prog.stepCandidates).toEqual(['Step']);
    expect(prog.devices.find((d) => d.name === 'Start_PB')!.role).toBe('input');
    expect(prog.devices.find((d) => d.name === 'Clamp_SOL')!.role).toBe('output');
    expect(prog.devices.find((d) => d.name === 'Clamp_SOL')!.comment).toBe('클램프 SOL');
    const res = runSimulation(prog, s.sim);
    const steps = vals(res.stepTrace!.points);
    expect(steps).toEqual(['0', '10', '20', '30', '40', '50', '60', '0', '10', '20', '30', '40', '50', '60', '0']);
    const cc = trace(res, 'CycleCount');
    expect(cc[cc.length - 1].v).toBe('2');
    const project = applySimulation(createProject(), prog, s.sim, res);
    const clamp = project.signals.find((x) => x.comment === 'Clamp_SOL')!;
    expect(clamp.address).toBe('%QX0.0');
    expect(project.steps[0].label).toBe('S10 클램프');
    expect(project.steps[2].description).toBe('가압 유지 1.2s (Step = 30)');
  });
});

describe('siemens STL logic', () => {
  it('O without operand = OR of AND groups', () => {
    const src = `
      A I0.0
      A I0.1
      O
      A I0.2
      A I0.3
      = Q0.0
      A I0.0
      O I0.2
      A I0.3
      = Q0.1
    `;
    const cases: [number[], number, number][] = [
      [[1, 1, 0, 0], 1, 0],
      [[0, 0, 1, 1], 1, 1],
      [[1, 0, 0, 1], 0, 1],
      [[1, 0, 1, 0], 0, 0],
    ];
    for (const [ins, q0, q1] of cases) {
      const { res } = sim('siemens', src, {
        duration: 20,
        stimuli: ins.map((v, i) => ({ device: `I0.${i}`, mode: 'const' as const, value: v as 0 | 1 })),
        watch: ['Q0.0', 'Q0.1'],
      });
      expect([trace(res, 'Q0.0')[0].v, trace(res, 'Q0.1')[0].v]).toEqual([q0, q1]);
    }
  });

  it('german mnemonics', () => {
    const src = `U E 0.0\nUN E 0.1\n= A 4.0`;
    const { res } = sim('siemens', src, {
      duration: 20,
      stimuli: [{ device: 'I0.0', mode: 'const', value: 1 }],
      watch: ['Q4.0'],
    });
    expect(trace(res, 'Q4.0')[0].v).toBe(1);
  });
});

describe('ST', () => {
  it('precedence, functions, loops, TOF, CTU', () => {
    const src = `
      VAR a : BOOL; b : BOOL; c : BOOL; x : INT; y : INT; i : INT; t1 : TOF; cnt : CTU; END_VAR
      c := a OR b AND NOT b;   (* OR < AND  → c = a *)
      x := 2 + 3 * 4 - MAX(1, 2) ** 2;
      y := 0;
      FOR i := 1 TO 5 DO
        IF i = 4 THEN EXIT; END_IF
        y := y + i;
      END_FOR;
      t1(IN := a, PT := T#300ms);
      cnt(CU := a, PV := 3);
    `;
    const { prog, res } = sim('st', src, {
      duration: 1000,
      stimuli: [
        { device: 'a', mode: 'pulse', pulses: [{ start: 100, end: 200 }] },
        { device: 'b', mode: 'const', value: 1 },
      ],
      watch: ['c', 'x', 'y', 't1.Q', 'cnt.CV'],
    });
    expect(prog.messages).toEqual([]);
    expect(trace(res, 'c')).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 200, v: 0 },
    ]);
    expect(trace(res, 'x')[0].v).toBe('10');
    expect(trace(res, 'y')[0].v).toBe('6');
    expect(trace(res, 't1.Q')).toEqual([
      { t: 0, v: 0 },
      { t: 100, v: 1 },
      { t: 500, v: 0 },
    ]);
    expect(trace(res, 'cnt.CV').map((p) => p.v)).toEqual(['0', '1']);
  });

  it('reports syntax errors with line numbers', () => {
    const prog = parseProgram('x := ;\ny := 1;\nIF x THEN\n', 'st');
    const errs = prog.messages.filter((m) => m.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].line).toBe(1);
  });
});

describe('device comments', () => {
  it('parses XG5000 style variable export', () => {
    const txt = '변수,타입,디바이스,사용 유무,설명문\nSTART_PB,BIT,P00000,사용,시작 버튼\nMOTOR,BIT,P00040,사용,\n';
    const m = parseDeviceComments(txt, 'ls');
    expect(m.get('P00000')).toBe('시작 버튼');
    expect(m.get('P00040')).toBe('MOTOR');
  });
  it('parses simple text', () => {
    const m = parseDeviceComments('X000 시작 버튼\nY0 모터', 'mitsubishi');
    expect(m.get('X0')).toBe('시작 버튼');
    expect(m.get('Y0')).toBe('모터');
  });
});

describe('XG5000 variable list (변수명 / 타입 / 디바이스 / 사용 / 0 / 설명문)', () => {
  // XG5000 변수 목록 복사본과 같은 배치 (내용은 테스트용)
  const list = [
    'M_10\tBIT\tM0000A\t1\t0\t자동운전',
    'M_11\tBIT\tM0000B\t0\t0\t',
    'X10\tBIT\tP00008\t1\t0\t운전준비.ON',
    'Y41\tBIT\tP00081\t1\t0\t컨베이어 전진',
    'START_PB\tBIT\tP00009\t1\t0\t',
    'M_12\tBIT\tM0000C\t1\t0\t이송RIGHT센서?',
    '\tBIT/WORD\tC0251\t1\t0\t이송카운터',
    '\tWORD\tD00230\t1\t0\t위치값',
    '\t\t\t0\t0',
  ].join('\n');
  it('maps the device column, not address-like variable names', () => {
    const m = parseDeviceComments(list, 'ls');
    expect(Object.fromEntries(m)).toEqual({
      M0000A: '자동운전',
      P00008: '운전준비.ON',
      P00081: '컨베이어 전진',
      P00009: 'START_PB',
      M0000C: '이송RIGHT센서',
      C0251: '이송카운터',
      D00230: '위치값',
    });
  });
});

describe('axis model (motor + encoder / limit switches)', () => {
  // 크레인처럼: 카운터는 항상 ON CTU(하드웨어 엔코더 값), 위치 비교로 감속, 리밋 스위치로 정지
  const src = [
    'LOAD F00099',
    'CTU C0001 30000',
    'LOAD P00000',
    'OR M00001',
    'AND NOT P00001',
    'OUT M00001',
    'LOAD M00001',
    'OUT P00040',
    'LOAD>= C0001 3000',
    'OUT M00010',
    'LOAD P00002',
    'DMOVP 0 C0001',
  ].join('\n');
  const run = (stimuli: Stimulus[]) => {
    const prog = parseProgram(src, 'ls');
    const settings = {
      ...defaultSimSettings(),
      duration: 8000,
      stimuli,
      models: [newAxisModel({ name: '주행 위치', fwd: 'P00040', speed: 1000, min: 0, max: 10000, counter: 'C0001', sensors: [{ device: 'P00001', from: 5000, to: 10000 }] })],
      watch: ['P00040', 'M00010', 'P00001', 'C0001'],
    };
    return { res: runSimulation(prog, settings), prog, settings };
  };

  it('moves while the output is on, writes the encoder and trips the limit switch', () => {
    const { res, prog, settings } = run([{ device: 'P00000', mode: 'pulse', pulses: [{ start: 100, end: 200 }] }]);
    expect(res.warnings).toEqual([]);
    const m10 = trace(res, 'M00010');
    expect(m10[1].v).toBe(1);
    expect(m10[1].t).toBeGreaterThanOrEqual(3100);
    expect(m10[1].t).toBeLessThanOrEqual(3130);
    const out = trace(res, 'P00040');
    expect(out[1]).toEqual({ t: 100, v: 1 });
    expect(out[2].t).toBeGreaterThanOrEqual(5100);
    expect(out[2].t).toBeLessThanOrEqual(5130);
    const pos = res.axes[0].points;
    expect(pos[pos.length - 1].v).toBeGreaterThanOrEqual(5000);
    expect(pos[pos.length - 1].v).toBeLessThanOrEqual(5040);
    // 차트: 아날로그 위치 행이 출력 바로 뒤에 생김
    const project = applySimulation(createProject(), prog, settings, res);
    const i = project.signals.findIndex((s) => s.address === 'P00040');
    expect(project.signals[i + 1].name).toBe('주행 위치');
    expect(project.signals[i + 1].kind).toBe('analog');
  });

  it('follows a program reset of the counter (encoder reset)', () => {
    const { res } = run([
      { device: 'P00000', mode: 'pulse', pulses: [{ start: 100, end: 200 }] },
      { device: 'P00002', mode: 'pulse', pulses: [{ start: 2000, end: 2100 }] },
    ]);
    // 1.9 s 이동 후 0 으로 리셋 → 다시 3000 도달은 약 5.0 s
    const m10 = trace(res, 'M00010');
    expect(m10[1].t).toBeGreaterThanOrEqual(4980);
    expect(m10[1].t).toBeLessThanOrEqual(5040);
  });
});

describe('I/O mapping trace (M relays that copy real I/O)', () => {
  const src = [
    'LOAD F00099', 'OUT M00667', // 설비 선택 = 항상 ON
    'LOAD P00019', 'OUT M00629', // 1단계: 입력 복사
    'LOAD NOT P00040', 'OUT M00631', // 반전 복사
    'LOAD M00629', 'AND M00667', 'OUT M00440', // 2단계: 항상 ON 조건을 거친 복사
    'LOAD M00631', 'AND M00667', 'OUT M00445',
    'LOAD M00440', 'OR M00001', 'OUT M00001', // 자기유지 → 매핑 아님
    'LOAD M00440', 'AND P00010', 'OUT M00002', // 실제 조건이 있음 → 매핑 아님
    'LOAD P00008', 'OUT M00628', 'LOAD P00009', 'OUT M00628', // 두 번 쓰는 코일 → 매핑 아님
  ].join('\n');
  it('resolves chains back to the physical input', () => {
    const prog = parseProgram(src, 'ls', new Map([['P00019', 'UP'], ['P00040', '수동모드']]));
    const a = (d: string) => prog.aliases.get(d);
    expect(a('M00629')).toEqual({ source: 'P00019', invert: false, chain: ['M00629'] });
    expect(a('M00440')).toEqual({ source: 'P00019', invert: false, chain: ['M00629', 'M00440'] });
    expect(a('M00445')).toEqual({ source: 'P00040', invert: true, chain: ['M00631', 'M00445'] });
    expect(a('M00001')).toBeUndefined();
    expect(a('M00002')).toBeUndefined();
    expect(a('M00628')).toBeUndefined();
    expect(a('M00667')).toBeUndefined();
    const dev = prog.devices.find((d) => d.name === 'M00440')!;
    expect(dev.alias).toBe('P00019');
    expect(dev.comment).toBe('UP');
    expect(prog.devices.find((d) => d.name === 'M00445')!.alias).toBe('NOT P00040');
  });

  const withOutputs = [
    src,
    'LOAD M00440', 'AND NOT P00010', 'OUT M00004', // 프로그램 로직: UP 운전
    'LOAD M00004', 'OUT P00021', // 출력 매핑: M00004 → P00021
    'LOAD M00004', 'OUT M00100',
    'LOAD M00100', 'OUT P00022', // M00100 = M00004 → P00022
  ].join('\n');

  it('links relays to the real outputs they drive and the inputs they copy', () => {
    const prog = parseProgram(withOutputs, 'ls', new Map([['P00019', 'UP'], ['M00004', 'UP 운전']]));
    const dev = (n: string) => prog.devices.find((d) => d.name === n)!;
    expect(dev('M00004').drives).toBe('P00021');
    expect(dev('P00021').alias).toBeUndefined(); // 실제 출력 자신에는 "= M…" 을 달지 않음
    expect(dev('P00021').comment).toBe('UP 운전'); // 켜 주는 릴레이 설명을 물려받음
    expect(dev('P00019').relays).toEqual(expect.arrayContaining(['M00629', 'M00440']));
    const outs = prog.ioLinks.filter((l) => l.dir === 'out').map((l) => `${l.relay}>${l.io}`).sort();
    expect(outs).toEqual(['M00004>P00021', 'M00004>P00022', 'M00100>P00022']);
    // 표시 목록의 매핑 릴레이 → 실제 I/O (중복 제거, 순서 유지)
    const r = swapToRealIo(['M00440', 'P00019', 'M00445', 'M00004', 'M00002'], prog.ioLinks);
    expect(r.watch).toEqual(['P00019', 'P00040', 'P00021', 'M00002']);
    expect(r.swapped).toBe(3);
    // 기본 표시 목록에는 매핑 릴레이 대신 실제 I/O
    const w = defaultWatch(prog);
    expect(w).toContain('P00019');
    expect(w).toContain('P00021');
    expect(w).not.toContain('M00440');
    expect(w).not.toContain('M00629');
    expect(w).not.toContain('M00004');
    expect(w).toContain('M00002');
  });

  it('builds process steps from which outputs are ON and notes mappings on chart rows', () => {
    const prog = parseProgram(withOutputs, 'ls', new Map([['P00019', 'UP'], ['P00021', '권상 UP'], ['P00022', '브레이크']]));
    const settings: SimSettings = {
      ...defaultSimSettings(),
      duration: 3000,
      stimuli: [{ device: 'P00019', mode: 'pulse', pulses: [{ start: 500, end: 1500 }] }],
      watch: ['P00019', 'P00021', 'M00440'],
      stepDevice: OUTPUT_STEPS,
      autoTrim: false,
    };
    const res = runSimulation(prog, settings);
    const project = applySimulation(createProject(), prog, settings, res, { keepExisting: false });
    expect(project.steps.map((s) => s.label)).toEqual(['권상 UP + 브레이크']);
    expect(project.steps[0].start).toBe(500);
    expect(project.steps[0].end).toBe(1500);
    const row = (a: string) => project.signals.find((s) => s.address === a)!;
    expect(row('M00440').comment).toBe('= P00019');
    expect(row('P00019').comment).toContain('M00440');
  });
});
