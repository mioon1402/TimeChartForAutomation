import { describe, expect, it } from 'vitest';
import type { Circuit, Part, PartType, Wire } from '../src/circuit/types';
import { CircuitModel, runScenario } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { buildNetlist, sameConnections } from '../src/circuit/netlist';
import { pinPositions, REAL } from '../src/circuit/parts';
import { rerouteWiring, toWiring, wireLength } from '../src/circuit/realize';
import { verifyWiring } from '../src/circuit/verify';
import { checkCircuit } from '../src/circuit/bom';

/** 만든 그림의 넷이 의도한 넷과 꼭 같은가: 단자 두 개가 같은 넷이면 의도도 같고, 의도가 같으면 같은 넷 */
function netsExact(r: ReturnType<typeof toWiring>): { shorts: number; broken: number } {
  const nl = buildNetlist(r.circuit);
  const byReal = new Map<number, Set<number | string>>();
  for (const [k, n] of nl.pinNet) {
    const want = r.pinNets.get(k);
    byReal.set(n, (byReal.get(n) ?? new Set()).add(want === undefined ? `free:${k}` : want));
  }
  const split = new Map<number, Set<number>>();
  for (const [k, want] of r.pinNets) split.set(want, (split.get(want) ?? new Set()).add(nl.pinNet.get(k)!));
  return { shorts: [...byReal.values()].filter((s) => s.size > 1).length, broken: [...split.values()].filter((s) => s.size > 1).length };
}

const timeline = (c: Circuit) => {
  const res = runScenario(c);
  return new Map(res.tracks.filter((t) => !t.key.startsWith('plc')).map((t) => [t.key, JSON.stringify(t.points.map((p) => [p.t, p.v]))]));
};

describe('schematic → wiring diagram', () => {
  it('every built-in example: all wires routed, nets exactly as drawn, same timing chart, wiring check clean', () => {
    for (const ex of circuitExamples()) {
      const c = ex.build();
      const r = toWiring(c);
      expect(r.failed, ex.id).toBe(0);
      expect(netsExact(r), ex.id).toEqual({ shorts: 0, broken: 0 });
      const a = timeline(c);
      const b = timeline(r.circuit);
      for (const [key, pts] of a) expect(b.get(key), `${ex.id} ${key}`).toBe(pts);
      expect(verifyWiring(r.circuit, new CircuitModel(r.circuit)).map((i) => i.msg), ex.id).toEqual([]);
      expect(checkCircuit(r.circuit).filter((i) => i.level === 'error').map((i) => i.msg), ex.id).toEqual([]);
      expect(r.circuit.parts.every((p) => REAL.has(p.type) || ['text', 'plc', 'cyl', 'v32', 'v52', 'v52d', 'v53', 'air', 'frl', 'fc'].includes(p.type)), ex.id).toBe(true);
      expect(r.length).toBe(wireLength(r.circuit));
    }
  }, 30000);

  it('self-holding: contactor, THR, buttons, lamps, motor with PE, and a control breaker in front of the control circuit', () => {
    const r = toWiring(circuitExamples().find((e) => e.id === 'self-hold')!.build());
    const types = (t: PartType) => r.circuit.parts.filter((p) => p.type === t).map((p) => p.tag);
    expect(types('r_mc')).toEqual(['MC1']);
    expect(types('r_thr')).toEqual(['THR']);
    expect(types('r_pb').sort()).toEqual(['PB0', 'PB1']);
    expect(types('r_motor3')).toEqual(['M1']);
    expect(types('r_mcb1')).toEqual(['CB0']);
    expect(r.circuit.parts.filter((p) => p.type === 'r_term').map((p) => p.pole).sort()).toEqual(['L1', 'L2', 'L3', 'N', 'PE']);
    expect(r.notes.some((n) => n.includes('제어 전원 차단기 CB0'))).toBe(true);
    // 전동기 PE 는 PE 단자에, 녹황 전선
    const nl = buildNetlist(r.circuit);
    const pe = r.circuit.parts.find((p) => p.type === 'r_term' && p.pole === 'PE')!;
    const m = r.circuit.parts.find((p) => p.type === 'r_motor3')!;
    expect(nl.pinNet.get(`${m.id}:3`)).toBe(nl.pinNet.get(`${pe.id}:0`));
    expect(r.circuit.wires.filter((w) => nl.wireNet.get(w.id) === nl.pinNet.get(`${pe.id}:0`)).every((w) => w.color === 'gy')).toBe(true);
  });

  /** L · N 사이 렁: 접점들 → 코일 X1, X1 의 접점은 a · b 몇 개 */
  const relayCircuit = (contacts: { type: 'no' | 'nc'; shareTop: boolean }[]) => {
    let n = 0;
    const parts: Part[] = [];
    const wires: Wire[] = [];
    const P = (type: PartType, x: number, y: number, tag = '', e: Partial<Part> = {}) => parts.push({ id: `p${n++}`, type, x, y, rot: 0, tag, ...e });
    const W = (a: [number, number], b: [number, number]) => wires.push({ id: `w${n++}`, a, b });
    P('src', 0, 0, '', { pole: 'L' });
    P('src', 0, 30, '', { pole: 'N' });
    W([0, 0], [40, 0]);
    W([0, 30], [40, 30]);
    P('sw_no', 4, 4, 'S1');
    P('coil', 4, 24, 'X1');
    W([4, 0], [4, 2]);
    W([4, 6], [4, 22]);
    W([4, 26], [4, 30]);
    contacts.forEach((k, i) => {
      const x = 10 + 6 * i;
      P(k.type, x, 4, 'X1');
      P('lamp', x, 24, `PL${i}`);
      W([x, k.shareTop ? 0 : 2], [x, 2]);
      if (!k.shareTop) {
        // 위 끝을 따로: S1 뒤 (스위치를 거친 L) 에서
        W([4, 8], [x, 8]);
      }
      W([x, 6], [x, 22]);
      W([x, 26], [x, 30]);
    });
    // shareTop 이 아니면 접점 위 끝을 S1 뒤 넷에 잇는다
    for (const w of wires) if (w.a[1] === 2 && w.b[1] === 2 && w.a[0] === w.b[0]) w.a = [w.a[0], 8];
    return { parts, wires, ops: [{ id: 'o', wait: 500, tag: 'S1', action: 'on' as const, hold: 0 }] } as Circuit;
  };

  it('a and b contacts that share a common use one changeover of an 8-pin relay (8-6 a, 8-5 b)', () => {
    const c = relayCircuit([
      { type: 'no', shareTop: true },
      { type: 'nc', shareTop: true },
    ]);
    const r = toWiring(c);
    const x1 = r.circuit.parts.find((p) => p.tag === 'X1')!;
    expect(x1.type).toBe('r_relay8');
    const used = [...r.pinNets.keys()].filter((k) => k.startsWith(`${x1.id}:`)).map((k) => Number(k.split(':')[1])).sort((a, b) => a - b);
    // 코일 2 · 7 (1, 6) + 8 (7) 공통 · 6 (5) a · 5 (4) b
    expect(used).toEqual([1, 4, 5, 6, 7]);
    expect(netsExact(r)).toEqual({ shorts: 0, broken: 0 });
    expect(timeline(r.circuit).get('load:PL0')).toBe(timeline(c).get('load:PL0'));
  });

  it('three separate contacts need a 4-pole relay; more than four add a parallel auxiliary relay', () => {
    const three = toWiring(relayCircuit([0, 1, 2].map(() => ({ type: 'no' as const, shareTop: false }))));
    expect(three.circuit.parts.find((p) => p.tag === 'X1')!.type).toBe('r_my4');
    const six = toWiring(relayCircuit([0, 1, 2, 3, 4, 5].map(() => ({ type: 'no' as const, shareTop: false }))));
    expect(six.circuit.parts.filter((p) => p.type === 'r_my4').map((p) => p.tag)).toEqual(['X1', 'X1-2']);
    expect(six.notes.some((n) => n.includes('보조 릴레이 X1-2'))).toBe(true);
    expect(netsExact(six)).toEqual({ shorts: 0, broken: 0 });
    for (let i = 0; i < 6; i++) expect(timeline(six.circuit).get(`load:PL${i}`)).toBe('[[0,0],[500,1]]');
  });
});

describe('re-route after moving devices', () => {
  /** 편집기처럼: 기기를 옮기면 그 단자에 물린 선 끝도 함께 옮긴다 */
  const move = (c: Circuit, tag: string, dx: number, dy: number): Circuit => {
    const p = c.parts.find((q) => q.tag === tag)!;
    const old = new Set(pinPositions(p).map(([x, y]) => `${x},${y}`));
    const shift = (pt: [number, number]): [number, number] => (old.has(`${pt[0]},${pt[1]}`) ? [pt[0] + dx, pt[1] + dy] : pt);
    return { ...c, parts: c.parts.map((q) => (q === p ? { ...q, x: q.x + dx, y: q.y + dy } : q)), wires: c.wires.map((w) => ({ ...w, a: shift(w.a), b: shift(w.b) })) };
  };

  it('keeps every connection, redraws square wires and reports the length', () => {
    const gen = toWiring(circuitExamples().find((e) => e.id === 'timer')!.build()).circuit;
    const moved = move(gen, 'GL', 12, 6);
    expect(sameConnections(gen, moved)).toBe(true);
    const r = rerouteWiring(moved);
    expect(r.failed).toBe(0);
    expect(sameConnections(gen, r.circuit)).toBe(true);
    expect(r.circuit.wires.every((w) => w.a[0] === w.b[0] || w.a[1] === w.b[1])).toBe(true);
    expect(r.after).toBe(wireLength(r.circuit));
    expect(r.before).toBe(wireLength(moved));
  });

  it('works on hand-drawn wiring diagrams too (same connections, colours kept); busbar drawings are left alone', () => {
    for (const id of ['panel', 'motor-fwd-rev', 'pneumatic', 'tc-heater']) {
      const c = circuitExamples().find((e) => e.id === id)!.build();
      const r = rerouteWiring(c);
      expect(r.failed, id).toBe(0);
      expect(sameConnections(c, r.circuit), id).toBe(true);
      expect(timeline(r.circuit), id).toEqual(timeline(c));
    }
    const bus = circuitExamples().find((e) => e.id === 'busbar')!.build();
    expect(rerouteWiring(bus).skipped).toBeTruthy();
  });
});
