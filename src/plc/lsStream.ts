/**
 * LS XG5000 (XGK/XGB) 니모닉 - "지저분한 텍스트" 해석기.
 *
 * XG5000 은 IL(니모닉)을 인쇄/PDF 로만 내보낼 수 있어서, PDF 에서 뽑은 텍스트에는
 * 페이지 머리말, 표 제목, 렁 설명문, 줄바꿈이 섞이고 열이 한 칸씩 줄로 쪼개지기도 한다.
 * 줄 단위가 아니라 토큰 흐름으로 읽고, 명령마다 오퍼랜드 개수를 알고 있으므로
 * 명령어와 오퍼랜드만 골라내고 나머지(스텝 번호, 설명문, 머리말)는 버린다.
 */
import type { SourceLine } from './text';
import { splitLines } from './text';

/** 명령 → 오퍼랜드 수 (-1 = 알 수 없음: 오퍼랜드처럼 보이는 토큰을 다음 명령 전까지 읽음) */
const ARITY: Record<string, number> = {
  LOAD: 1, 'LOAD NOT': 1, LOADP: 1, LOADN: 1,
  AND: 1, 'AND NOT': 1, ANDP: 1, ANDN: 1,
  OR: 1, 'OR NOT': 1, ORP: 1, ORN: 1,
  'AND LOAD': 0, 'OR LOAD': 0, MPUSH: 0, MLOAD: 0, MPOP: 0, NOT: 0, END: 0, NOP: 0, RET: 0,
  OUT: 1, 'OUT NOT': 1, OUTP: 1, OUTN: 1, SET: 1, RST: 1, FF: 1,
  TON: 2, TOFF: 2, TMR: 2, TMON: 2, TRTG: 2, CTU: 2, CTD: 2,
  MCS: 1, MCSCLR: 1, JMP: 1, LABEL: 1, CALL: 1, SBRT: 1,
  MOV: 2, MOVP: 2, DMOV: 2, DMOVP: 2, FMOV: 3, FMOVP: 3,
  INC: 1, INCP: 1, DEC: 1, DECP: 1, DINC: 1, DINCP: 1, DDEC: 1, DDECP: 1,
  ADD: 3, ADDP: 3, SUB: 3, SUBP: 3, MUL: 3, MULP: 3, DIV: 3, DIVP: 3,
  DADD: 3, DADDP: 3, DSUB: 3, DSUBP: 3, DMUL: 3, DMULP: 3, DDIV: 3, DDIVP: 3,
  BSET: 2, BSETP: 2, BRST: 2, BRSTP: 2,
};

/** 첫 오퍼랜드가 반드시 디바이스여야 하는 명령 (숫자면 다음 스텝 번호로 본다) */
const FIRST_IS_DEVICE = new Set([
  'LOAD', 'LOAD NOT', 'LOADP', 'LOADN', 'AND', 'AND NOT', 'ANDP', 'ANDN', 'OR', 'OR NOT', 'ORP', 'ORN',
  'OUT', 'OUT NOT', 'OUTP', 'OUTN', 'SET', 'RST', 'FF', 'TON', 'TOFF', 'TMR', 'TMON', 'TRTG', 'CTU', 'CTD',
  'INC', 'INCP', 'DEC', 'DECP', 'DINC', 'DINCP', 'DDEC', 'DDECP', 'BSET', 'BSETP', 'BRST', 'BRSTP',
]);

/** 결과를 디바이스에 쓰는 명령: 해당 위치 오퍼랜드는 디바이스여야 함 */
const DEST_INDEX: Record<string, number> = { MOV: 1, MOVP: 1, DMOV: 1, DMOVP: 1, FMOV: 1, FMOVP: 1 };
for (const k of ['ADD', 'SUB', 'MUL', 'DIV', 'DADD', 'DSUB', 'DMUL', 'DDIV']) {
  DEST_INDEX[k] = 2;
  DEST_INDEX[k + 'P'] = 2;
}

/** 지원하지 않지만 명령어로 알아봐야 하는 XGK 명령 (오퍼랜드로 오인 방지) */
const OTHER_OPS = new Set([
  'CTUD', 'CTR', 'BMOV', 'BMOVP', 'GMOV', 'CMP', 'TCMP', 'FOR', 'NEXT', 'BREAK', 'INIT_DONE', 'SBRT', 'ESCAPE',
  'WAND', 'WOR', 'WXOR', 'BCD', 'BIN', 'SEG', 'ROL', 'ROR', 'BSFT', 'WSFT', 'SR', 'DI', 'EI', 'STOP', 'ADDB', 'SUBB',
  'LOADB', 'ANDB', 'ORB', 'BOUT', 'MEP', 'MEF', 'INV', 'LOAD$=', 'EJMP', 'ECALL',
]);

const CMP_RE = /^(LOAD|AND|OR)(D|R|L|\$)?(=|<>|>=|<=|>|<)$/;
const CMP_SYM = /^(D|R|L|\$)?(=|<>|>=|<=|>|<)$/;

export function isLsMnemonic(t: string): boolean {
  const u = t.toUpperCase();
  return u in ARITY || OTHER_OPS.has(u) || CMP_RE.test(u);
}

/** XGK 디바이스: P00020, M0010F, T0000, D00100.3, ZR100, U01.02, _ON */
export function isLsDevice(t: string): boolean {
  return /^(ZR|P|M|K|L|F|T|C|S|D|U|Z|R|N|W)\d[0-9A-F]*(\.[0-9A-F]+){0,2}$/i.test(t) || /^_[A-Z0-9_]+$/i.test(t) || /^#(ZR|D|R|M|P|U)\d/i.test(t);
}

export function isLsOperand(t: string): boolean {
  return isLsDevice(t) || /^-?\d+(\.\d+)?$/.test(t) || /^[hH][0-9A-Fa-f]+$/.test(t) || /^[kK]\d+$/.test(t);
}

interface Tok {
  v: string;
  line: number;
  /** 줄의 첫 토큰인가 */
  first: boolean;
  comment?: boolean;
}

/** XG5000 인쇄본의 "비실행문" = 실행하지 않도록 막아 둔 렁 → 그 줄은 통째로 제외 */
const DISABLED_MARK = '비실행문';
/** "설명문" = 렁 설명문 줄 → 그 뒤의 글자는 설명이므로 무시 */
const COMMENT_MARK = '설명문';

function tokenize(text: string): { toks: Tok[]; lines: string[]; disabled: number[] } {
  const lines = splitLines(text);
  const toks: Tok[] = [];
  const disabled: number[] = [];
  lines.forEach((raw, i) => {
    let s = raw;
    let comment = '';
    const sl = s.indexOf('//');
    if (sl >= 0) {
      comment = s.slice(sl + 2).trim();
      s = s.slice(0, sl);
    }
    const sc = s.indexOf(';');
    if (sc >= 0) {
      comment = s.slice(sc + 1).trim() || comment;
      s = s.slice(0, sc);
    }
    const words = s.split(/[\s,|]+/).filter(Boolean);
    if (words.includes(DISABLED_MARK)) {
      disabled.push(i + 1);
      return;
    }
    const cm = words.indexOf(COMMENT_MARK);
    if (cm >= 0) words.length = cm;
    let first = true;
    for (let w of words) {
      // "0LOAD" → "0" "LOAD"  (스텝 번호와 명령이 붙은 경우)
      const glued = /^(\d+)([A-Za-z].*)$/.exec(w);
      if (glued && isLsMnemonic(glued[2])) {
        toks.push({ v: glued[1], line: i + 1, first });
        first = false;
        w = glued[2];
      }
      // "P00000시작버튼" → 디바이스 + 설명
      const devCmt = /^([A-Za-z]{1,2}\d[0-9A-Fa-f.]*)([가-힣].*)$/.exec(w);
      if (devCmt && isLsDevice(devCmt[1])) {
        toks.push({ v: devCmt[1], line: i + 1, first });
        toks.push({ v: devCmt[2], line: i + 1, first: false });
        first = false;
        continue;
      }
      toks.push({ v: w, line: i + 1, first });
      first = false;
    }
    if (comment) toks.push({ v: comment, line: i + 1, first: false, comment: true });
  });
  return { toks, lines, disabled };
}

export interface StreamResult {
  lines: SourceLine[];
  /** 명령으로 해석하지 않고 버린 토큰 수 */
  skipped: number;
  /** "비실행문" 으로 제외한 줄 번호 */
  disabled: number[];
}

/** 텍스트 → 명령 줄 목록 ("OP ARG..." 형태, 원본 줄 번호 유지) */
export function lsStreamLines(text: string): StreamResult {
  const { toks, lines, disabled } = tokenize(text);
  const out: SourceLine[] = [];
  let skipped = 0;
  const n = toks.length;

  // i 위치에서 명령어 인식 → [명령, 소비 토큰 수]
  const mnemonicAt = (i: number): [string, number] | null => {
    const t = toks[i];
    if (!t || t.comment) return null;
    const u = t.v.toUpperCase();
    const nx = toks[i + 1] && !toks[i + 1].comment ? toks[i + 1].v.toUpperCase() : '';
    if ((u === 'LOAD' || u === 'AND' || u === 'OR' || u === 'OUT') && nx === 'NOT') return [`${u} NOT`, 2];
    if ((u === 'AND' || u === 'OR') && nx === 'LOAD') return [`${u} LOAD`, 2];
    if ((u === 'LOAD' || u === 'AND' || u === 'OR') && CMP_SYM.test(nx)) return [u + nx, 2];
    if (isLsMnemonic(u)) return [u, 1];
    return null;
  };

  // 명령이 시작될 수 있는 위치: 줄 첫머리 또는 스텝 번호 바로 뒤.
  // (명령 뒤에 같은 줄로 이어지는 "SET 버튼" 같은 설명문을 명령으로 오인하지 않기 위해)
  const canStart = (i: number, prevWasStep: boolean) => toks[i].first || prevWasStep;

  let i = 0;
  let prevWasStep = false;
  let lastDone = -1; // 직전 명령의 마지막 토큰 인덱스
  while (i < n) {
    const t = toks[i];
    if (t.comment) {
      const last = out[out.length - 1];
      if (last && last.line === t.line && !last.comment) last.comment = t.v;
      i++;
      continue;
    }
    const m = canStart(i, prevWasStep) ? mnemonicAt(i) : null;
    if (!m) {
      prevWasStep = /^\d+$/.test(t.v);
      // 같은 줄에서 명령 바로 뒤에 오는 오퍼랜드가 아닌 글자 = 설명문
      const last = out[out.length - 1];
      if (!prevWasStep && last && last.line === t.line && lastDone >= 0 && !isLsOperand(t.v)) {
        last.comment = last.comment ? `${last.comment} ${t.v}` : t.v;
      } else skipped++;
      i++;
      continue;
    }
    const [op, used] = m;
    const arity = ARITY[op] ?? (CMP_RE.test(op) ? 2 : -1);
    const args: string[] = [];
    let j = i + used;
    while (j < n && (arity < 0 || args.length < arity)) {
      const a = toks[j];
      if (a.comment || !isLsOperand(a.v)) break;
      if (mnemonicAt(j)) break;
      const mustBeDevice = (args.length === 0 && FIRST_IS_DEVICE.has(op)) || DEST_INDEX[op] === args.length;
      if (mustBeDevice && !isLsDevice(a.v)) break;
      // 오퍼랜드 수를 모를 때: 숫자 뒤에 명령이 오면 그 숫자는 다음 스텝 번호
      if (arity < 0 && /^\d+$/.test(a.v) && mnemonicAt(j + 1)) break;
      args.push(a.v);
      j++;
    }
    out.push({ line: t.line, tokens: [op, ...args], comment: '', text: (lines[t.line - 1] ?? '').trim() });
    lastDone = j - 1;
    prevWasStep = false;
    i = j;
  }
  return { lines: out, skipped, disabled };
}
