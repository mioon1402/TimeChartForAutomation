import { describe, expect, it } from 'vitest';
import type { Circuit, Part, Pole, Wire } from '../src/circuit/types';
import { CircuitModel, runScenario } from '../src/circuit/engine';
import { circuitExamples } from '../src/circuit/examples';
import { checkCircuit } from '../src/circuit/bom';
import { verifyWiring } from '../src/circuit/verify';
import { toWiring } from '../src/circuit/realize';
import { sanitizeCircuit } from '../src/circuit/sanitize';
import { skLeakMa } from '../src/circuit/parts';

/**
 * 기호 회로: 전원 a → 스위치 S1 → SOL1 → 전원 b (세로 한 줄) 와 스파크 킬러 SK1.
 * at = 'coil' 이면 SOL1 양단, 'contact' 면 S1 양단, 'supply' 면 전원 양단
 */
function circuit(at: 'coil' | 'contact' | 'supply', poles: [Pole, Pole] = ['L', 'N'], sk: Partial<Part> = {}): Circuit {
  const parts: Part[] = [
    { id: 'L', type: 'src', x: 0, y: 0, rot: 0, tag: '', pole: poles[0] },
    { id: 'S1', type: 'sw_no', x: 0, y: 5, rot: 0, tag: 'S1' },
    { id: 'SOL1', type: 'sol', x: 0, y: 11, rot: 0, tag: 'SOL1' },
    { id: 'N', type: 'src', x: 0, y: 17, rot: 0, tag: '', pole: poles[1] },
    { id: 'SK1', type: 'sk', x: 4, y: 11, rot: 0, tag: 'SK1', ...sk },
  ];
  let n = 0;
  const wires: Wire[] = [];
  const w = (...pts: [number, number][]) => pts.slice(1).forEach((b, i) => wires.push({ id: `w${n++}`, a: pts[i], b }));
  w([0, 0], [0, 3]);
  w([0, 7], [0, 9]);
  w([0, 13], [0, 17]);
  // SK1 단자: 위 (4, 9) · 아래 (4, 13). 선 중간에 끝을 대면 T 로 이어진다
  if (at === 'coil') {
    w([4, 9], [4, 8], [0, 8]);
    w([4, 13], [4, 15], [0, 15]);
  } else if (at === 'contact') {
    w([4, 9], [4, 1], [0, 1]);
    w([4, 13], [4, 12], [6, 12], [6, 8], [0, 8]);
  } else {
    w([4, 9], [4, 1], [0, 1]);
    w([4, 13], [4, 15], [0, 15]);
  }
  return { parts, wires, ops: [] } as unknown as Circuit;
}
const msgs = (c: Circuit) => verifyWiring(c, new CircuitModel(c)).map((i) => i.msg);

describe('스파크 킬러 (CR)', () => {
  it('0.1 µF + 120 Ω 은 220 V · 60 Hz 에서 약 8.3 mA (Xc = 1 / (2π · 60 · 0.1 µF) ≈ 26.5 kΩ)', () => {
    expect(skLeakMa({}, 220)).toBeCloseTo(220 / Math.hypot(120, 1e6 / (2 * Math.PI * 60 * 0.1)) * 1000, 6);
    expect(skLeakMa({}, 220)).toBeCloseTo(8.29, 2);
    // 0.5 µF + 50 Ω 은 다섯 배쯤
    expect(skLeakMa({ uf: 0.5, ohm: 50 }, 220)).toBeCloseTo(41.5, 1);
  });

  it('교류 SOL 코일 양단이면 [검사] 가 조용하고, 시뮬레이션에는 영향이 없다', () => {
    const c = circuit('coil');
    expect(msgs(c)).toEqual([]);
    const plain: Circuit = { ...c, parts: c.parts.filter((p) => p.id !== 'SK1'), wires: c.wires.filter((w) => !(w.a[0] >= 4 || w.b[0] >= 4)) };
    const ops = [{ id: 'o1', wait: 1000, tag: 'S1', action: 'on' as const, hold: 0 }];
    const run = (x: Circuit) => runScenario({ ...x, ops }, new CircuitModel({ ...x, ops })).tracks.find((t) => t.key === 'load:SOL1')!.points;
    expect(run(c)).toEqual(run(plain));
  });

  it('접점 양단이면 열려도 약 8.3 mA 가 SOL1 쪽으로 샌다고 알린다', () => {
    const m = msgs(circuit('contact')).find((x) => x.includes('접점 S1 의 양단'))!;
    expect(m).toContain('약 8.3 mA');
    expect(m).toContain('SOL1');
    expect(m).toContain('코일 (부하) 양단에 다세요');
  });

  it('전원 양단 · 직류 회로 · 정격 초과 (선간 약 381 V) 를 알린다', () => {
    expect(msgs(circuit('supply')).some((x) => x.includes('전원 (L1 · N) 양단') || x.includes('전원 (L · N) 양단'))).toBe(true);
    expect(msgs(circuit('coil', ['+24V', '0V'])).some((x) => x.includes('다이오드'))).toBe(true);
    const hv = msgs(circuit('coil', ['L1', 'L2']));
    expect(hv.some((x) => /약 38\d V/.test(x) && x.includes('정격 250 V'))).toBe(true);
    // AC 440V 용이면 괜찮다
    expect(msgs(circuit('coil', ['L1', 'L2'], { spec: 'AC 440V' })).some((x) => x.includes('정격'))).toBe(false);
  });

  it('예제 "솔레노이드 밸브 2개 교번" 은 SOL 마다 코일 양단에 달려 있고 [검사] 가 깨끗하다', () => {
    const c = circuitExamples().find((e) => e.id === 'sol-alternate')!.build();
    const m = new CircuitModel(c);
    expect(c.parts.filter((p) => p.type === 'r_sk').map((p) => p.tag)).toEqual(['SK1', 'SK2']);
    expect(checkCircuit(c, m).map((i) => i.msg)).toEqual([]);
    // SK1 은 SOL1 의 두 단자 넷에, SK2 는 SOL2 의 두 단자 넷에
    const nets = (tag: string) => {
      const p = c.parts.find((q) => q.tag === tag)!;
      return [0, 1].map((i) => m.net.pinNet.get(`${p.id}:${i}`)).sort();
    };
    expect(nets('SK1')).toEqual(nets('SOL1'));
    expect(nets('SK2')).toEqual(nets('SOL2'));
  });

  it('회로도 → 실물 배선도에서 실물 스파크 킬러로 바뀌고, 값 · 사양은 저장해도 남는다', () => {
    const c = circuit('coil', ['L', 'N'], { uf: 0.5, ohm: 50, spec: 'AC 250V' });
    const r = toWiring(c);
    expect(r.circuit.parts.find((p) => p.type === 'r_sk')).toMatchObject({ tag: 'SK1', uf: 0.5, ohm: 50, spec: 'AC 250V' });
    const back = sanitizeCircuit(JSON.parse(JSON.stringify(c)))!;
    expect(back.parts.find((p) => p.id === 'SK1')).toMatchObject({ uf: 0.5, ohm: 50 });
  });
});
