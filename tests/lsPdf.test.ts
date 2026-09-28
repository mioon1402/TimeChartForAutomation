import { describe, expect, it } from 'vitest';
import { parseProgram } from '../src/plc/program';
import { runSimulation } from '../src/plc/simulator';
import { plcSamples } from '../src/plc/samples';
import { lsStreamLines } from '../src/plc/lsStream';

const sample = plcSamples().find((s) => s.id === 'ls-pickplace')!;

/** 깨끗한 니모닉 → [명령, 오퍼랜드..., 설명] 목록 */
function cleanRows(): { op: string; args: string[]; cmt: string }[] {
  return sample.source
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith(';'))
    .map((l) => {
      const [code, cmt = ''] = l.split(';');
      const tk = code.trim().split(/\s+/);
      const two = ['NOT', 'LOAD'].includes(tk[1] ?? '') && ['LOAD', 'AND', 'OR', 'OUT'].includes(tk[0]);
      return { op: two ? `${tk[0]} ${tk[1]}` : tk[0], args: tk.slice(two ? 2 : 1), cmt: cmt.trim() };
    });
}

/** XG5000 IL 인쇄 → PDF → 텍스트 추출 결과를 흉내 낸 텍스트 */
function pdfLikeText(): string {
  const rows = cleanRows();
  const out: string[] = [];
  const header = (page: number) => {
    out.push('XG5000   프로젝트 : 픽앤플레이스   프로그램 : NewProgram', `인쇄일 2026-09-28   페이지 ${page}`, '스텝   명령어   오퍼랜드1   오퍼랜드2   설명문');
  };
  let page = 1;
  header(page);
  rows.forEach((r, i) => {
    if (i && i % 25 === 0) {
      out.push(`- ${page} -`, '');
      header(++page);
    }
    if (i === 5) out.push('[렁 설명문] 스텝 1 : Z축 하강 완료 확인');
    out.push(`${String(i).padStart(5, ' ')}   ${r.op}   ${r.args.join('   ')}   ${r.cmt}`);
  });
  out.push(`- ${page} -`);
  return out.join('\n');
}

function traces(src: string) {
  const prog = parseProgram(src, 'ls');
  expect(prog.messages.filter((m) => m.severity === 'error')).toEqual([]);
  return runSimulation(prog, sample.sim).traces.map((t) => JSON.stringify(t.points));
}

describe('LS mnemonic from PDF text', () => {
  const expected = traces(sample.source);

  it('handles page headers, footers, rung comments and trailing Korean comments', () => {
    const txt = pdfLikeText();
    expect(traces(txt)).toEqual(expected);
    const prog = parseProgram(txt, 'ls');
    expect(prog.devices.find((d) => d.name === 'P00000')!.comment).toBe('시작 PB');
    expect(prog.size).toBe(cleanRows().length);
  });

  it('handles one cell per line (copied table)', () => {
    const txt = pdfLikeText()
      .split('\n')
      .flatMap((l) => l.split(/\s{2,}/).map((c) => c.trim()))
      .filter(Boolean)
      .join('\n');
    expect(traces(txt)).toEqual(expected);
  });

  it('handles step numbers glued to instructions and split comparators', () => {
    const txt = ['0LOAD P00000', '1OUT P00040', '2 LOAD = D00000 10', '3 OUT M00001', '4 AND NOT P00001', '5 OUT M00002'].join('\n');
    const r = lsStreamLines(txt);
    expect(r.lines.map((l) => l.tokens.join(' '))).toEqual(['LOAD P00000', 'OUT P00040', 'LOAD= D00000 10', 'OUT M00001', 'AND NOT P00001', 'OUT M00002']);
  });

  it('does not treat comment words as instructions', () => {
    const txt = ['0 LOAD P00000 SET 버튼', '1 OUT P00040 NOT 사용', '2 TON T0000 100 END 대기', '3 END'].join('\n');
    const r = lsStreamLines(txt);
    expect(r.lines.map((l) => l.tokens.join(' '))).toEqual(['LOAD P00000', 'OUT P00040', 'TON T0000 100', 'END']);
  });

  it('warns about unsupported XGK instructions without breaking the rest', () => {
    const prog = parseProgram(['0 LOAD P00000', '1 BMOV D00000 D00100 5', '2 OUT P00040'].join('\n'), 'ls');
    expect(prog.messages.map((m) => m.message).join()).toMatch(/BMOV/);
    expect(prog.size).toBe(2);
  });
});

describe('PDF text item → lines', () => {
  it('groups by baseline and separates columns', async () => {
    const { itemsToLines } = await import('../src/io/pdfLines');
    const it = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 5, h: 10 });
    const lines = itemsToLines([
      it('LOAD', 60, 700),
      it('0', 20, 700.4),
      it('P00000', 120, 699.8),
      { str: '시작', x: 200, y: 700, w: 20, h: 10 },
      it('PB', 222, 700),
      it('1', 20, 686),
      it('AND', 60, 686),
      it('NOT', 81, 686),
      it('M00010', 120, 686),
    ]);
    expect(lines).toEqual(['0   LOAD   P00000   시작 PB', '1   AND NOT   M00010']);
    expect(lsStreamLines(lines.join('\n')).lines.map((l) => l.tokens.join(' '))).toEqual(['LOAD P00000', 'AND NOT M00010']);
  });
});
