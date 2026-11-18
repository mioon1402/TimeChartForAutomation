import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { CircuitModel, CircuitSim, runScenario, type ScenarioResult } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { applyCircuit } from '../src/circuit/chart';
import { checkCircuit, partsList } from '../src/circuit/bom';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { partPins, pinPositions } from '../src/circuit/parts';
import { verifyWiring } from '../src/circuit/verify';
import { createProject } from '../src/model/project';
import { defaultSimSettings, type PlcConfig } from '../src/plc/types';

let n = 0;
const part = (type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}): Part => ({ id: `p${n++}`, type, x, y, rot: 0, tag, ...extra });
const wire = (a: [number, number], b: [number, number]): Wire => ({ id: `w${n++}`, a, b });

function edges(res: ScenarioResult, key: string): { t: number; v: number | string }[] {
  const tr = res.tracks.find((t) => t.key === key);
  if (!tr) throw new Error(`no track ${key}`);
  const out: { t: number; v: number | string }[] = [];
  let last: number | string | null = null;
  for (const p of tr.points) {
    if (p.v !== last) out.push({ t: p.t, v: p.v });
    last = p.v;
  }
  return out;
}
const times = (res: ScenarioResult, key: string) => edges(res, key).map((e) => e.t);

describe('PLC 제어반 예제 (펌프 2대, 로컬 · HMI)', () => {
  const ex = circuitExamples().find((e) => e.id === 'plc-panel')!;
  const c = ex.build();
  const plc = ex.plc!();
  const model = new CircuitModel(c, plc);
  const res = runScenario(c, model);

  it('로컬 = 문 버튼, 원격 = HMI, 정지는 어디서나, COS 정지면 모두 멈춘다', () => {
    expect(res.warnings).toEqual([]);
    // COS 는 로컬 자리에서 시작한다 (가운데면 아무 버튼도 듣지 않아 고장처럼 보임), 저장해도 남는다
    expect(edges(res, 'sel:SS1')[0]).toEqual({ t: 0, v: 'L' });
    expect(sanitizeCircuit(JSON.parse(JSON.stringify(c)))!.parts.find((p) => p.tag === 'SS1')!.pos0).toBe(-1);
    // 1 s 문 기동 · 4 s 문 정지 · 5.5 s 로컬에서 HMI 기동 (무시) · 8 s HMI 기동 · 15.5 s 비상정지 · 19.5 s HMI 기동 · 23.5 s COS 정지
    expect(times(res, 'coil:MC1')).toEqual([0, 1010, 4010, 8010, 15500, 19510, 23510]);
    // 2.5 s 문 기동 · 9.5 s THR2 트립 · 20.5 s HMI 기동 · 22 s HMI 정지
    expect(times(res, 'coil:MC2')).toEqual([0, 2510, 9500, 20510, 22010]);
  });

  it('비상정지 · THR 는 PLC 를 기다리지 않고 MC 코일을 바로 끊는다 (PLC 는 다음 스캔에 지령을 내림)', () => {
    expect(times(res, 'coil:MC1')).toContain(15500);
    expect(times(res, 'coil:RY1')).toContain(15520);
    expect(times(res, 'coil:MC2')).toContain(9500);
    expect(times(res, 'coil:RY2')).toContain(9520);
    // 비상정지를 풀어도 다시 돌지 않는다 (리셋 뒤 기동해야)
    expect(times(res, 'coil:MC1').filter((t) => t > 15500 && t < 19500)).toEqual([]);
  });

  it('고장: 램프는 0.5 s 점멸, 리셋은 원인이 남아 있으면 부저만 끈다', () => {
    const rl = edges(res, 'load:RL');
    expect(rl.slice(1, 4)).toEqual([
      { t: 9510, v: 1 },
      { t: 10010, v: 0 },
      { t: 10520, v: 1 },
    ]);
    // 11.5 s 리셋 (THR2 아직 트립) → 부저만, 13 s 복귀 → 14 s 리셋으로 고장 풀림
    expect(times(res, 'load:BZ')).toEqual([0, 9510, 11510, 15510, 18510]);
    expect(rl.filter((e) => e.t > 11510 && e.t < 14000).length).toBeGreaterThan(2);
    expect(rl.find((e) => e.t >= 14000)).toEqual({ t: 14010, v: 0 });
  });

  it('배선 검사 · PLC 보호 검사가 깨끗하고, PLC 프로그램은 래더로 열린다', () => {
    expect(checkCircuit(c, model).map((i) => i.msg)).toEqual([]);
    expect(plc.view).toBe('ladder');
    expect(plc.ladder?.rungs.some((r) => r.raw)).toBe(false);
  });

  it('타임차트: HMI 조작은 한 묶음, PLC 입출력은 코멘트 이름', () => {
    const p = applyCircuit({ ...createProject(), circuit: c, plc });
    const groups = p.signals.map((s) => s.group);
    expect(groups.indexOf('HMI 조작')).toBeGreaterThan(groups.lastIndexOf('조작'));
    expect(p.signals.filter((s) => s.group === 'HMI 조작').map((s) => s.name)).toEqual(['HMI P1 기동', 'HMI 고장 리셋', 'HMI P2 기동', 'HMI P2 정지']);
    expect(p.signals.find((s) => s.address === 'P00040')?.name).toBe('RY1 P1 운전');
    const rows = partsList(c);
    expect(rows.find((r) => r.tag === 'PLC')?.kind).toBe('PLC (CPU 일체형)');
    expect(rows.find((r) => r.tag === 'HMI1')?.spec).toContain('버튼 5 · 램프 7');
  });
});

/**
 * 시험대: +24V (y = 0) · 0V (y = -3) 모선, 실물 PLC (입력 X0 ← 버튼, 출력 Y0 → 램프).
 * 전원 + 는 스위치 S1 을 거친다 (끊어 보려고)
 */
function rig(opts: { program: string; com?: '0V' | '+24V' | 'none'; inputFrom?: 'plus' | 'ac'; hmi?: boolean; outLoad?: 'lamp' | 'mc' }): { c: Circuit; plc: PlcConfig } {
  const plc = part('r_plc', 30, 10, 'PLC', { inBase: 'X0', outBase: 'Y0' });
  const pos = pinPositions(plc);
  const at = (label: string) => pos[partPins(plc).findIndex((q) => q.label === label)];
  const parts: Part[] = [part('src', -2, 0, '', { pole: '+24V' }), part('src', -2, -3, '', { pole: '0V' }), plc];
  const wires: Wire[] = [wire([-2, 0], [60, 0]), wire([-2, -3], [60, -3])];
  // 전원: + ← S1 (b접점, 누르면 끊김) ← +24V, − → 0V
  const [px] = at('+');
  parts.push(part('sw_nc', px, 2, 'S1'));
  wires.push(wire([px, 4], at('+')));
  wires.push(wire(at('−'), [at('−')[0], -3]));
  // 입력 공통 COM
  if (opts.com !== 'none') wires.push(wire(at('COM'), [at('COM')[0], opts.com === '+24V' ? 0 : -3]));
  // 입력 X0 ← 버튼 PB1 ← +24V (또는 AC L)
  const [ix] = at('X0');
  if (opts.inputFrom === 'ac') {
    parts.push(part('src', ix, -6, '', { pole: 'L' }), part('pb_no', ix, 3, 'PB1'));
    wires.push(wire([ix, -6], [ix, 1]), wire([ix, 5], at('X0')));
  } else {
    parts.push(part('pb_no', ix, 2, 'PB1'));
    wires.push(wire([ix, 4], at('X0')));
  }
  // 출력: COM0 ← 퓨즈 ← +24V (아래 따로 놓은 전원), Y0 → 램프 (또는 MC 코일) → 0V
  const [cx, cy] = at('COM0');
  parts.push(part('src', cx, cy + 9, '', { pole: '+24V' }), part('fuse', cx, cy + 5, 'F1'));
  wires.push(wire([cx, cy], [cx, cy + 3]), wire([cx, cy + 7], [cx, cy + 9]));
  const [yx, yy] = at('Y0');
  parts.push(part(opts.outLoad === 'mc' ? 'coil' : 'lamp', yx, yy + 4, opts.outLoad === 'mc' ? 'MC1' : 'GL'), part('src', yx, yy + 8, '', { pole: '0V' }));
  wires.push(wire([yx, yy], [yx, yy + 2]), wire([yx, yy + 6], [yx, yy + 8]));
  if (opts.hmi) {
    const hmi = part('r_hmi', 80, 20, 'HMI1', {
      hmi: [
        { kind: 'btn', label: '기동', dev: 'M10' },
        { kind: 'btn', label: '정지', dev: 'M11' },
        { kind: 'lamp', label: '운전', dev: 'Y0' },
        { kind: 'btn', label: '잘못', dev: 'X1' },
      ],
    });
    parts.push(hmi, part('src', 78, 30, '', { pole: '+24V' }), part('src', 80, 30, '', { pole: '0V' }));
    const hp = pinPositions(hmi);
    wires.push(wire(hp[0], [78, 30]), wire(hp[1], [80, 30]));
  }
  const c: Circuit = { parts, wires, ops: [] };
  const cfg: PlcConfig = { dialect: 'mitsubishi', source: opts.program, comments: '', sim: defaultSimSettings() };
  return { c, plc: cfg };
}

const sim = (r: { c: Circuit; plc: PlcConfig }) => new CircuitSim(new CircuitModel(r.c, r.plc));
const lamp = (s: CircuitSim, r: { c: Circuit }) => s.energized.has(r.c.parts.find((p) => p.tag === 'GL')!.id);

describe('실물 PLC (입력 16 · 릴레이 출력 16)', () => {
  const HOLD = 'LD X0\nOR M10\nOR Y0\nANI M11\nOUT Y0\nEND\n';

  it('싱크 입력 (COM = 0V): 버튼을 누르면 다음 스캔에 출력, 자기유지', () => {
    const r = rig({ program: HOLD });
    const s = sim(r);
    expect(s.plcRunning(r.c.parts[2].id)).toBe(true);
    s.advanceTo(100);
    s.setAct('PB1', true);
    s.advanceTo(130);
    expect(s.plcIn.get(r.c.parts[2].id)?.[0]).toBe(true);
    expect(lamp(s, r)).toBe(true);
    s.setAct('PB1', false);
    s.advanceTo(300);
    expect(lamp(s, r)).toBe(true);
  });

  it('소스 입력 (COM = +24V) 은 0V 가 와야 ON, COM 이 빠지면 입력이 안 들어온다', () => {
    const src = sim(rig({ program: HOLD, com: '+24V' }));
    src.advanceTo(100);
    src.setAct('PB1', true);
    src.advanceTo(130);
    expect([...src.plcIn.values()][0][0]).toBe(false);
    const none = rig({ program: HOLD, com: 'none' });
    const s = sim(none);
    s.setAct('PB1', true);
    s.advanceTo(130);
    expect([...s.plcIn.values()][0][0]).toBe(false);
    expect(verifyWiring(none.c, new CircuitModel(none.c, none.plc)).some((i) => i.msg.includes('입력 공통 COM 이 이어지지 않아'))).toBe(true);
  });

  it('전원이 끊기면 출력이 모두 꺼지고, 다시 들어오면 처음부터 돈다 (자기유지가 풀림)', () => {
    const r = rig({ program: HOLD });
    const s = sim(r);
    const id = r.c.parts[2].id;
    s.setAct('PB1', true);
    s.advanceTo(100);
    s.setAct('PB1', false);
    s.advanceTo(200);
    expect(lamp(s, r)).toBe(true);
    s.setAct('S1', true);
    expect(s.plcRunning(id)).toBe(false);
    expect(lamp(s, r)).toBe(false);
    s.advanceTo(500);
    s.setAct('S1', false);
    s.advanceTo(600);
    expect(s.plcRunning(id)).toBe(true);
    expect(lamp(s, r)).toBe(false);
  });

  it('HMI 버튼은 PLC 의 M 에 쓰고, HMI 전원이 없으면 듣지 않는다', () => {
    const r = rig({ program: HOLD, hmi: true });
    const s = sim(r);
    const hmi = r.c.parts.find((p) => p.type === 'r_hmi')!;
    expect(s.hmiOnline(hmi.id)).toBe(true);
    s.advanceTo(100);
    s.setAct('HMI1-1', true);
    s.advanceTo(130);
    s.setAct('HMI1-1', false);
    s.advanceTo(200);
    expect(lamp(s, r)).toBe(true);
    expect(s.hmiView(hmi).bits[2]).toBe(true);
    s.setAct('HMI1-2', true);
    s.advanceTo(230);
    s.setAct('HMI1-2', false);
    s.advanceTo(300);
    expect(lamp(s, r)).toBe(false);
    // HMI 전원 없음
    const dark = { ...r.c, wires: r.c.wires.filter((w) => !(w.b[0] === 78 && w.b[1] === 30)) };
    const d = new CircuitSim(new CircuitModel(dark, r.plc));
    expect(d.hmiOnline(hmi.id)).toBe(false);
    d.setAct('HMI1-1', true);
    d.advanceTo(200);
    expect(d.energized.has(dark.parts.find((p) => p.tag === 'GL')!.id)).toBe(false);
    // 조작 순서에서도 쓸 수 있다 (HMI1-1 …), 저장해도 화면 칸이 남는다
    const res = runScenario({ ...r.c, ops: [{ id: 'o', wait: 500, tag: 'HMI1-1', action: 'press', hold: 300 }] }, new CircuitModel(r.c, r.plc));
    expect(times(res, `load:GL`)).toEqual([0, 510]);
    expect(sanitizeCircuit(JSON.parse(JSON.stringify(r.c)))!.parts.find((p) => p.type === 'r_hmi')!.hmi).toEqual(hmi.hmi);
  });

  it('PLC 가 상하는 배선을 알린다: 입력에 교류, 출력으로 MC 코일을 바로, 공통에 퓨즈 없음, HMI 가 입력에 씀', () => {
    const msgs = (r: { c: Circuit; plc: PlcConfig }) => verifyWiring(r.c, new CircuitModel(r.c, r.plc)).map((i) => i.msg);
    expect(msgs(rig({ program: HOLD, inputFrom: 'ac' })).some((m) => m.includes('입력 X0 에 교류') && m.includes('DC 24V 용'))).toBe(true);
    expect(msgs(rig({ program: HOLD, outLoad: 'mc' })).some((m) => m.includes('출력 Y0 이 MC1') && m.includes('인터포징'))).toBe(true);
    expect(msgs(rig({ program: HOLD })).some((m) => m.includes('인터포징') || m.includes('입력 X0 에 교류'))).toBe(false);
    // 퓨즈를 빼고 공통을 전원에 바로
    const r = rig({ program: HOLD });
    const f = r.c.parts.find((p) => p.tag === 'F1')!;
    const bare = { ...r, c: { ...r.c, parts: r.c.parts.filter((p) => p !== f), wires: [...r.c.wires, wire([f.x, f.y - 2], [f.x, f.y + 2])] } };
    expect(msgs(bare).some((m) => m.includes('COM0 이 퓨즈 · 차단기 없이'))).toBe(true);
    expect(msgs(rig({ program: HOLD, hmi: true })).some((m) => m.includes('HMI1-4') && m.includes('PLC 입력 X1'))).toBe(true);
  });
});
