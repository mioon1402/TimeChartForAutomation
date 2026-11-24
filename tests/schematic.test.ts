import { describe, expect, it } from 'vitest';
import type { Circuit, OpStep, Part, PartType, Wire } from '../src/circuit/types';
import { circuitExamples } from '../src/circuit/examples';
import { runScenario } from '../src/circuit/engine';
import { toSchematic } from '../src/circuit/schematic';
import { pinPositions, REAL } from '../src/circuit/parts';
import { sanitizeCircuit } from '../src/circuit/sanitize';

const KINDS = new Set(['coil', 'timerCoil', 'timerOut', 'load', 'motor', 'operator', 'selector', 'sensor']);
const tracks = (c: Circuit) =>
  Object.fromEntries(
    runScenario(c)
      .tracks.filter((t) => KINDS.has(t.kind))
      .map((t) => [t.key, t.points.map((p) => `${p.t}:${p.v}`).join(' ')]),
  );
const diff = (a: Circuit, b: Circuit) => {
  const x = tracks(a);
  const y = tracks(b);
  return Object.keys(x)
    .filter((k) => x[k] !== y[k])
    .map((k) => `${k}: ${x[k]}  ≠  ${y[k] ?? '(none)'}`);
};

const realExamples = circuitExamples().filter((e) => e.build().parts.some((p) => REAL.has(p.type) && p.type !== 'r_panel'));

describe('wiring diagram → schematic', () => {
  for (const ex of realExamples) {
    it(`${ex.id}: drawn with symbols and simulates to the same timing chart`, () => {
      const c = ex.build();
      const s = toSchematic(c);
      if (s.notes.length) return;
      expect(diff(c, s.circuit)).toEqual([]);
      // 회로도는 회로 기호로 (기호가 없는 6단자 전동기 · 3상 부하만 실물 그대로)
      expect(s.circuit.parts.filter((p) => REAL.has(p.type) && p.type !== 'r_motor6' && p.type !== 'r_load3').map((p) => p.type)).toEqual([]);
    });
  }

  it('says what it could not draw (devices without a schematic symbol)', () => {
    const noted = realExamples.filter((ex) => toSchematic(ex.build()).notes.length).map((ex) => ex.id);
    expect(noted.sort()).toEqual(['blower-timer', 'counter', 'earth-fault', 'oven-pid', 'plc-panel', 'sol-alternate', 'substation', 'tc-heater', 'tsw-light', 'tsw-panel']);
    expect(toSchematic(circuitExamples().find((e) => e.id === 'counter')!.build()).notes[0]).toContain('카운터 (C1)');
  });

  it('keeps the real terminal numbers and selector positions, and they survive saving', () => {
    const s = toSchematic(circuitExamples().find((e) => e.id === 'pump-manual-auto')!.build()).circuit;
    const sel = s.parts.filter((p) => p.type === 'sw_no' && p.tag === 'SS');
    expect(sel.map((p) => [p.sel, p.term]).sort()).toEqual([
      [-1, '13-14'],
      [1, '23-24'],
    ]);
    const coil = s.parts.find((p) => p.type === 'coil' && p.tag === 'MC1')!;
    expect(coil.term).toBe('A1-A2');
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(s)))!;
    expect(back.parts.filter((p) => p.type === 'sw_no' && p.tag === 'SS').map((p) => p.sel).sort()).toEqual([-1, 1]);
    expect(diff(s, back)).toEqual([]);
  });

  it('draws the main circuit with the phase swap of a reversing starter', () => {
    const c = circuitExamples().find((e) => e.id === 'motor-fwd-rev')!.build();
    const s = toSchematic(c).circuit;
    expect(s.parts.filter((p) => p.type === 'km3').map((p) => p.tag).sort()).toEqual(['MC1', 'MC2']);
    expect(s.parts.filter((p) => p.type === 'motor3')).toHaveLength(1);
    const t = tracks(s);
    expect(t['mot:M1']).toBe('0:0 500:FWD 2500:REV 5500:0');
  });

  it('a bridge network (not series-parallel) is drawn path by path and still behaves the same', () => {
    // 접점 5개로 된 브리지: H-A (S1), H-B (S2), A-B (S3), A-T (S4), B-T (S5), T 에 코일 X1
    let n = 0;
    const parts: Part[] = [];
    const wires: Wire[] = [];
    const part = (type: PartType, x: number, y: number, tag = '', extra: Partial<Part> = {}) => {
      const p: Part = { id: `p${n++}`, type, x, y, rot: 0, tag, ...extra };
      parts.push(p);
      return p;
    };
    const wire = (a: [number, number], b: [number, number]) => wires.push({ id: `w${n++}`, a, b });
    // 넷마다 위 · 아래 가로선, 왼쪽 끝 세로선으로 위아래를 잇는다
    const nets = ['H', 'A', 'B', 'T', 'R'];
    const up = (k: number) => -4 - 2 * k;
    const down = (k: number) => 20 + 2 * k;
    nets.forEach((_, k) => {
      wire([-10 - k, up(k)], [40, up(k)]);
      wire([-10 - k, down(k)], [40, down(k)]);
      wire([-10 - k, up(k)], [-10 - k, down(k)]);
    });
    const edge = (type: PartType, x: number, from: string, to: string, tag: string) => {
      part(type, x, 8, tag);
      const [a, b] = pinPositions(parts[parts.length - 1]);
      wire(a, [a[0], up(nets.indexOf(from))]);
      wire(b, [b[0], down(nets.indexOf(to))]);
    };
    edge('sw_no', 0, 'H', 'A', 'S1');
    edge('sw_no', 4, 'H', 'B', 'S2');
    edge('sw_no', 8, 'A', 'B', 'S3');
    edge('sw_no', 12, 'A', 'T', 'S4');
    edge('sw_no', 16, 'B', 'T', 'S5');
    edge('coil', 20, 'T', 'R', 'X1');
    part('src', -30, up(0), '', { pole: 'L' });
    wire([-30, up(0)], [-10, up(0)]);
    part('src', -30, down(4), '', { pole: 'N' });
    wire([-30, down(4)], [-14, down(4)]);
    const op = (wait: number, tag: string, action: OpStep['action']): OpStep => ({ id: `o${n++}`, wait, tag, action, hold: 0 });
    const c: Circuit = {
      parts,
      wires,
      ops: [op(100, 'S1', 'on'), op(100, 'S5', 'on'), op(100, 'S3', 'on'), op(100, 'S1', 'off'), op(100, 'S2', 'on'), op(100, 'S5', 'off'), op(100, 'S4', 'on')],
    };
    // 원래 회로: S1·S3·S5 (300 ms) 로 붙고, S1 을 끄면 떨어졌다가 S2·S5 로 다시 (500 ms), S5 를 끄면 S2·S3·S4 로 이어짐 (700 ms)
    const t = tracks(c);
    expect(t['coil:X1']).toBe('0:0 300:1 400:0 500:1 600:0 700:1');
    const s = toSchematic(c);
    expect(s.notes.join()).toContain('직렬 · 병렬로 정리되지 않아');
    expect(diff(c, s.circuit)).toEqual([]);
  });
});
