import type { CmpOp, Instr, ParseMessage, PlcDialect } from './types';
import { csvInstructionListToLines, tokenizeMnemonic, type SourceLine } from './text';
import { normDevice } from './devices';
import { lsStreamLines } from './lsStream';

export interface IlParseResult {
  instrs: Instr[];
  labels: Map<string, number>;
  messages: ParseMessage[];
  /** 줄 끝 주석에서 얻은 디바이스 설명 */
  inlineComments: Map<string, string>;
}

const CMP_RE = /^(LD|AND|OR|LOAD)D?(=|<>|>=|<=|>|<)$/;

const WORD_OPS = new Set(['MOV', 'DMOV', 'INC', 'DINC', 'DEC', 'DDEC', 'ADD', 'DADD', 'SUB', 'DSUB', 'MUL', 'DMUL', 'DIV', 'DDIV', 'ZRST', 'FMOV', 'ALT', 'FF', '+', '-', '*', '/', 'D+', 'D-', 'D*', 'D/', 'BSET', 'BRST']);

function stripStepNumber(tokens: string[]): string[] {
  // 선두 스텝 번호 (0, 0001, 12 ...) 제거
  if (tokens.length > 1 && /^\d+$/.test(tokens[0])) return tokens.slice(1);
  return tokens;
}

/** LS 다단어 명령 결합: LOAD NOT, AND LOAD, OUT NOT ... */
function joinLsOp(tokens: string[]): string[] {
  if (tokens.length >= 2) {
    const a = tokens[0].toUpperCase();
    const b = tokens[1].toUpperCase();
    if (['LOAD', 'AND', 'OR', 'OUT'].includes(a) && b === 'NOT') return [`${a} NOT`, ...tokens.slice(2)];
    if (['AND', 'OR'].includes(a) && b === 'LOAD') return [`${a} LOAD`, ...tokens.slice(2)];
    // LOAD = D0 K10 처럼 비교 기호가 분리된 경우
    if (['LOAD', 'AND', 'OR', 'LD'].includes(a) && /^(D?)(=|<>|>=|<=|>|<)$/.test(b)) return [`${a}${b}`, ...tokens.slice(2)];
  }
  return tokens;
}

function mapMitsubishi(op: string, args: string[], base: Omit<Instr, 'op' | 'args'>): Instr | 'label' | null {
  const u = op.toUpperCase();
  const I = (o: string, extra: Partial<Instr> = {}): Instr => ({ ...base, op: o, args, ...extra });
  const cm = CMP_RE.exec(u);
  if (cm) return I(cm[1] === 'LOAD' ? 'LD' : cm[1], { cmp: cm[2] as CmpOp });
  switch (u) {
    case 'LD':
      return I('LD');
    case 'LDI':
      return I('LD', { neg: true });
    case 'LDP':
      return I('LD', { edge: 'P' });
    case 'LDF':
      return I('LD', { edge: 'F' });
    case 'AND':
      return I('AND');
    case 'ANI':
      return I('AND', { neg: true });
    case 'ANDP':
      return I('AND', { edge: 'P' });
    case 'ANDF':
      return I('AND', { edge: 'F' });
    case 'OR':
      return I('OR');
    case 'ORI':
      return I('OR', { neg: true });
    case 'ORP':
      return I('OR', { edge: 'P' });
    case 'ORF':
      return I('OR', { edge: 'F' });
    case 'ANB':
    case 'ORB':
    case 'MPS':
    case 'MRD':
    case 'MPP':
    case 'INV':
    case 'MEP':
    case 'MEF':
    case 'SET':
    case 'RST':
    case 'PLS':
    case 'PLF':
    case 'END':
    case 'FEND':
    case 'RET':
    case 'STL':
    case 'NOP':
      return I(u);
    case 'OUT':
    case 'OUTH': {
      const d = args[0]?.toUpperCase() ?? '';
      if (/^T\d+$/.test(d) || /^ST\d+$/.test(d)) {
        return I('TMR', { timer: /^ST/.test(d) ? 'TMR' : 'TON', timerBase: u === 'OUTH' ? 10 : undefined });
      }
      if (/^C\d+$/.test(d)) return I('CTU');
      return I('OUT');
    }
    case 'MC':
      return I('MC');
    case 'MCR':
      return I('MCR');
    case 'CJ':
    case 'CJP':
    case 'JMP':
      return I('JMP', { pulse: u === 'CJP' });
  }
  if (/^P\d+$/.test(u) && args.length === 0) return 'label';
  // 워드 명령 (P 접미사 = 펄스 실행)
  const w = u.endsWith('P') && WORD_OPS.has(u.slice(0, -1)) ? u.slice(0, -1) : u;
  if (WORD_OPS.has(w)) {
    const pulse = w !== u;
    const norm = w.replace(/^D(?=MOV|INC|DEC|ADD|SUB|MUL|DIV|[+\-*/])/, '');
    const map: Record<string, string> = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV' };
    return I(map[norm] ?? (norm === 'FF' ? 'ALT' : norm), { pulse });
  }
  return null;
}

function mapLs(op: string, args: string[], base: Omit<Instr, 'op' | 'args'>): Instr | 'label' | null {
  const u = op.toUpperCase();
  const I = (o: string, extra: Partial<Instr> = {}): Instr => ({ ...base, op: o, args, ...extra });
  const cm = CMP_RE.exec(u);
  if (cm) return I(cm[1] === 'LOAD' ? 'LD' : cm[1], { cmp: cm[2] as CmpOp });
  switch (u) {
    case 'LOAD':
      return I('LD');
    case 'LOAD NOT':
      return I('LD', { neg: true });
    case 'LOADP':
      return I('LD', { edge: 'P' });
    case 'LOADN':
      return I('LD', { edge: 'F' });
    case 'AND':
      return I('AND');
    case 'AND NOT':
      return I('AND', { neg: true });
    case 'ANDP':
      return I('AND', { edge: 'P' });
    case 'ANDN':
      return I('AND', { edge: 'F' });
    case 'OR':
      return I('OR');
    case 'OR NOT':
      return I('OR', { neg: true });
    case 'ORP':
      return I('OR', { edge: 'P' });
    case 'ORN':
      return I('OR', { edge: 'F' });
    case 'AND LOAD':
      return I('ANB');
    case 'OR LOAD':
      return I('ORB');
    case 'MPUSH':
      return I('MPS');
    case 'MLOAD':
      return I('MRD');
    case 'MPOP':
      return I('MPP');
    case 'NOT':
      return I('INV');
    case 'OUT':
      return I('OUT');
    case 'OUT NOT':
      return I('OUT', { neg: true });
    case 'OUTP':
      return I('PLS');
    case 'OUTN':
      return I('PLF');
    case 'SET':
    case 'RST':
    case 'END':
    case 'NOP':
      return I(u);
    case 'TON':
    case 'TOFF':
    case 'TMR':
    case 'TMON':
    case 'TRTG':
      return I('TMR', { timer: u === 'TOFF' ? 'TOF' : (u as Instr['timer']) });
    case 'CTU':
      return I('CTU');
    case 'CTD':
      return I('CTD');
    case 'MCS':
      return I('MC');
    case 'MCSCLR':
      return I('MCR');
    case 'JMP':
      return I('JMP');
    case 'LABEL':
      return 'label';
  }
  const w = u.endsWith('P') && WORD_OPS.has(u.slice(0, -1)) ? u.slice(0, -1) : u;
  if (WORD_OPS.has(w)) {
    const pulse = w !== u;
    const norm = w.replace(/^D(?=MOV|INC|DEC|ADD|SUB|MUL|DIV)/, '');
    return I(norm === 'FF' ? 'ALT' : norm, { pulse });
  }
  return null;
}

/** 미쓰비시 / LS 니모닉(IL) 파싱 */
export function parseIl(text: string, dialect: 'mitsubishi' | 'ls'): IlParseResult {
  // LS: XG5000 은 IL 을 PDF 로만 내보낼 수 있으므로 PDF 추출 텍스트에 강한 토큰 흐름 해석기 사용
  const src: SourceLine[] = csvInstructionListToLines(text) ?? (dialect === 'ls' ? lsStreamLines(text).lines : tokenizeMnemonic(text));
  const instrs: Instr[] = [];
  const labels = new Map<string, number>();
  const messages: ParseMessage[] = [];
  const inlineComments = new Map<string, string>();

  for (const sl of src) {
    let tokens = stripStepNumber(sl.tokens);
    if (!tokens.length) continue;
    if (dialect === 'ls') tokens = joinLsOp(tokens);
    else if (tokens.length >= 2 && /^(LD|AND|OR)$/i.test(tokens[0]) && /^D?(=|<>|>=|<=|>|<)$/.test(tokens[1])) {
      tokens = [tokens[0] + tokens[1], ...tokens.slice(2)];
    }
    // 포인터 라벨이 명령 앞에 붙은 경우 (P0 LD X0)
    if (dialect === 'mitsubishi' && tokens.length > 1 && /^P\d+$/i.test(tokens[0]) && !/^\d/.test(tokens[1])) {
      labels.set(tokens[0].toUpperCase(), instrs.length);
      tokens = tokens.slice(1);
    }
    // LS 라벨 "LABEL 0" 또는 미쓰비시 "P0" 단독
    const op = tokens[0];
    const rawArgs = tokens.slice(1);
    const args = rawArgs.map((a) => normDevice(a, dialect));
    const base = { line: sl.line, text: sl.text };
    const mapped = dialect === 'mitsubishi' ? mapMitsubishi(op, args, base) : mapLs(op, args, base);
    if (mapped === 'label') {
      const name = dialect === 'ls' ? `L${args[0] ?? ''}` : op.toUpperCase();
      labels.set(name, instrs.length);
      continue;
    }
    if (!mapped) {
      if (/^[A-Z$+\-*/<>=]/i.test(op)) {
        messages.push({ line: sl.line, message: `지원하지 않는 명령 "${op}" - 무시됨`, severity: 'warning' });
      } else {
        messages.push({ line: sl.line, message: `해석할 수 없는 줄: ${sl.text}`, severity: 'warning' });
      }
      continue;
    }
    if (mapped.op === 'JMP' && dialect === 'ls') mapped.args = [`L${args[0] ?? ''}`];
    // 필수 오퍼랜드 확인
    const need: Record<string, number> = { LD: 1, AND: 1, OR: 1, OUT: 1, SET: 1, RST: 1, PLS: 1, PLF: 1, TMR: 2, CTU: 2, CTD: 2, MOV: 2, STL: 1, ALT: 1, INC: 1, DEC: 1 };
    const n = mapped.cmp ? 2 : need[mapped.op] ?? 0;
    if (mapped.args.length < n) {
      messages.push({ line: sl.line, message: `"${op}" 명령의 오퍼랜드가 부족합니다`, severity: 'error' });
      continue;
    }
    if (sl.comment && mapped.args.length >= 1 && !mapped.cmp && ['LD', 'AND', 'OR', 'OUT', 'SET', 'RST', 'TMR', 'CTU', 'PLS', 'STL', 'MOV'].includes(mapped.op)) {
      const d = mapped.args[0];
      if (!inlineComments.has(d)) inlineComments.set(d, sl.comment);
    }
    instrs.push(mapped);
  }
  return { instrs, labels, messages, inlineComments };
}

export function isDialectIl(d: PlcDialect): d is 'mitsubishi' | 'ls' {
  return d === 'mitsubishi' || d === 'ls';
}
