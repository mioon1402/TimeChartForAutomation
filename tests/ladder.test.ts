import { describe, expect, it } from 'vitest';
import { plcSamples } from '../src/plc/samples';
import { parseProgram } from '../src/plc/program';
import { runSimulation } from '../src/plc/simulator';
import { defaultSimSettings } from '../src/plc/types';
import { addRow, addRung, compileLadder, deleteRow, emptyLadder, ilToLadder, ladderDevices, moveRung, readLadder, setCell, setNote, setOut, setRungComment, toggleVl, type Ladder } from '../src/plc/ladder';

/** 같은 입력 조합마다 두 프로그램의 출력이 같은지 (입력 모든 조합, 한 스캔씩) */
function sameLogic(a: string, b: string, ins: string[], outs: string[], dialect: 'mitsubishi' | 'ls' = 'mitsubishi'): number {
  const ra = parseProgram(a, dialect).createRuntime(defaultSimSettings());
  const rb = parseProgram(b, dialect).createRuntime(defaultSimSettings());
  let bad = 0;
  for (let m = 0; m < 1 << ins.length; m++) {
    ins.forEach((d, i) => {
      ra.writeBit(d, !!(m & (1 << i)));
      rb.writeBit(d, !!(m & (1 << i)));
    });
    ra.scan(m, m);
    rb.scan(m, m);
    for (const o of outs) if (ra.readBit(o) !== rb.readBit(o)) bad++;
  }
  return bad;
}

describe('래더 ↔ 니모닉', () => {
  it('내장 예제: 래더로 바꿨다가 다시 니모닉으로 만들어도 시뮬레이션 결과가 같다', () => {
    for (const s of plcSamples()) {
      if (s.dialect !== 'mitsubishi' && s.dialect !== 'ls') continue;
      const { ladder } = ilToLadder(s.source, s.dialect);
      const c = compileLadder(ladder, s.dialect);
      expect(c.errors, s.id).toEqual([]);
      const p2 = parseProgram(c.text, s.dialect);
      expect(p2.messages.filter((m) => m.severity === 'error'), s.id).toEqual([]);
      const a = runSimulation(parseProgram(s.source, s.dialect), s.sim);
      const b = runSimulation(p2, s.sim);
      for (const t of a.traces) expect(JSON.stringify(b.traces.find((x) => x.device === t.device)), `${s.id} ${t.device}`).toBe(JSON.stringify(t));
      // 한 번 더 돌려도 같은 니모닉
      expect(compileLadder(ilToLadder(c.text, s.dialect).ladder, s.dialect).text, s.id).toBe(c.text);
    }
  });

  it('래더로 그릴 수 없는 명령 (STL) 은 렁을 니모닉 그대로 둔다', () => {
    const s = plcSamples().find((x) => x.id === 'mitsubishi-stl')!;
    const { ladder, raw } = ilToLadder(s.source, 'mitsubishi');
    expect(raw).toBeGreaterThan(0);
    const rawText = ladder.rungs.filter((r) => r.raw).flatMap((r) => r.raw!);
    expect(rawText.some((l) => /^STL\s/.test(l))).toBe(true);
    expect(compileLadder(ladder, 'mitsubishi').text).toContain('RET');
  });

  it('ANB · ORB · MPS/MRD/MPP 가 섞인 렁도 논리가 그대로다', () => {
    const SRC = `LD X0
OR X1
LD X2
OR X3
ANB
MPS
AND X4
OUT Y0
MRD
LD X5
OR X6
ANB
OUT Y1
MPP
OUT Y2
LD X6
AND X7
LD X10
ANI X11
ORB
OR X12
OUT Y3
LD X0
OUT Y4
AND X1
OUT Y5
END
`;
    const { ladder, raw } = ilToLadder(SRC, 'mitsubishi');
    expect(raw).toBe(0);
    const c = compileLadder(ladder, 'mitsubishi');
    expect(c.errors).toEqual([]);
    expect(sameLogic(SRC, c.text, ['X0', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X10', 'X11', 'X12'], ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5'])).toBe(0);
  });

  it('설명문은 렁 설명으로, 줄 끝 설명은 디바이스 설명으로 남는다', () => {
    const s = plcSamples().find((x) => x.id === 'ls-pickplace')!;
    const { ladder } = ilToLadder(s.source, 'ls');
    expect(ladder.rungs[0].comment).toMatch(/픽앤플레이스/);
    expect(ladder.notes?.P00000).toBe('시작 PB');
    const text = compileLadder(ladder, 'ls').text;
    expect(text).toMatch(/^; 픽앤플레이스/);
    expect(text).toMatch(/LOAD P00000 ; 시작 PB/);
    const devs = parseProgram(text, 'ls').devices;
    expect(devs.find((d) => d.name === 'P00000')?.comment).toBe('시작 PB');
    expect(devs.find((d) => d.name === 'T0000')?.comment).toBe('그립 대기 0.5s');
    // 설명을 고치면 처음 쓰인 줄에만 붙는다
    const t2 = compileLadder(setNote(ladder, 'm00010', '운전 중'), 'ls').text;
    expect(t2.split('\n').filter((l) => l.includes('운전 중'))).toEqual(['AND NOT M00010 ; 운전 중']);
  });
});

describe('래더 편집', () => {
  /** 자기유지: X0 (시작) · Y0 (자기유지) 병렬 → X1 (정지) b접점 → Y0 */
  function selfHold(): Ladder {
    let ld = emptyLadder();
    ld = setCell(ld, 0, 0, 0, { k: 'no', dev: 'X0' });
    ld = setCell(ld, 0, 0, 1, { k: 'nc', dev: 'X1' });
    ld = setOut(ld, 0, 0, { k: 'out', dev: 'Y0' });
    ld = addRow(ld, 0, 0);
    ld = setCell(ld, 0, 1, 0, { k: 'no', dev: 'Y0' });
    ld = toggleVl(ld, 0, 0, 1);
    return ld;
  }

  it('자기유지 회로를 칸으로 그리면 LD · OR · ANI · OUT 이 된다', () => {
    const c = compileLadder(selfHold(), 'mitsubishi');
    expect(c.errors).toEqual([]);
    expect(c.text).toBe('LD X0\nOR Y0\nANI X1\nOUT Y0\nEND\n');
    expect(compileLadder(selfHold(), 'ls').text).toBe('LOAD X0\nOR Y0\nAND NOT X1\nOUT Y0\nEND\n');
    // 설정한 출력 뒤로는 가로선이 이어진다
    expect(selfHold().rungs[0].cells['0,7']).toEqual({ k: 'h' });
  });

  it('줄 · 렁 추가 · 삭제 · 순서 · 설명, 렁 번호 찾기', () => {
    let ld = selfHold();
    ld = addRung(ld, 0);
    ld = setCell(ld, 1, 0, 0, { k: 'p', dev: 'X2' });
    ld = setOut(ld, 1, 0, { k: 'ton', dev: 'T0', arg: '30' });
    ld = setRungComment(ld, 1, '지연');
    let c = compileLadder(ld, 'mitsubishi');
    expect(c.text).toBe('LD X0\nOR Y0\nANI X1\nOUT Y0\n; 지연\nLDP X2\nOUT T0 K30\nEND\n');
    expect(c.rungOfLine).toEqual([1, 1, 1, 1, 2, 2, 2, 0]);
    expect(compileLadder(ld, 'ls').text).toContain('LOADP X2\nTON T0 30');
    ld = moveRung(ld, 1, -1);
    expect(compileLadder(ld, 'mitsubishi').text.startsWith('; 지연\nLDP X2')).toBe(true);
    expect(ladderDevices(ld).sort()).toEqual(['T0', 'X0', 'X1', 'X2', 'Y0']);
    // 병렬 줄을 지우면 자기유지가 빠진다
    ld = deleteRow(ld, 1, 1);
    expect(compileLadder(ld, 'mitsubishi').text).toContain('LD X0\nANI X1\nOUT Y0');
  });

  it('출력 둘 (MPS · MPP) 과 바로 갈라지는 출력', () => {
    let ld = emptyLadder();
    ld = setCell(ld, 0, 0, 0, { k: 'no', dev: 'X0' });
    ld = setCell(ld, 0, 0, 1, { k: 'no', dev: 'X1' });
    ld = setOut(ld, 0, 0, { k: 'out', dev: 'Y0' });
    ld = addRow(ld, 0, 0);
    ld = toggleVl(ld, 0, 0, 1);
    ld = setCell(ld, 0, 1, 1, { k: 'nc', dev: 'X2' });
    ld = setOut(ld, 0, 1, { k: 'set', dev: 'M0' });
    const c = compileLadder(ld, 'mitsubishi');
    expect(c.errors).toEqual([]);
    expect(c.text).toBe('LD X0\nMPS\nAND X1\nOUT Y0\nMPP\nANI X2\nSET M0\nEND\n');
    expect(sameLogic('LD X0\nAND X1\nOUT Y0\nLD X0\nANI X2\nSET M0\nRST M0\nEND\n', c.text.replace('END', 'RST M0\nEND'), ['X0', 'X1', 'X2'], ['Y0'])).toBe(0);
  });

  it('잘못 그린 렁은 렁 번호와 함께 알린다', () => {
    let ld = emptyLadder();
    ld = setCell(ld, 0, 0, 0, { k: 'no' });
    ld = setOut(ld, 0, 0, { k: 'ton', dev: 'T0', arg: '' });
    ld = addRung(ld, 0);
    ld = setCell(ld, 1, 0, 0, { k: 'no', dev: 'X0' });
    ld = addRung(ld, 1);
    ld = setCell(ld, 2, 0, 0, { k: 'no', dev: 'X0' });
    ld = setOut(ld, 2, 0, { k: 'tof', dev: 'T1', arg: '10' });
    const msgs = compileLadder(ld, 'mitsubishi').errors.map((e) => `${e.rung} ${e.message}`);
    expect(msgs.some((m) => m.startsWith('1 ') && m.includes('디바이스'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('1 ') && m.includes('설정값'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('2 ') && m.includes('출력'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('3 ') && m.includes('OFF 딜레이'))).toBe(true);
    // LS 에는 TOFF 가 있다
    expect(compileLadder(ld, 'ls').errors.some((e) => e.rung === 3)).toBe(false);
  });

  it('저장 값 읽기: 모양이 틀린 칸은 버리고 설명은 대문자 디바이스로', () => {
    const ld = readLadder({ cols: 6, rungs: [{ rows: 1, cells: { '0,0': { k: 'no', dev: 'X0' }, bad: { k: 'no' }, '0,1': { k: 'zz' } }, vl: ['0,1', 'x'], outs: { 0: { k: 'out', dev: 'Y0' } } }], notes: { x0: '시작', y0: 5 } });
    expect(ld?.cols).toBe(6);
    expect(Object.keys(ld!.rungs[0].cells)).toEqual(['0,0']);
    expect(ld!.rungs[0].vl).toEqual(['0,1']);
    expect(ld!.notes).toEqual({ X0: '시작' });
    expect(readLadder({ rungs: 'no' })).toBeNull();
  });
});
