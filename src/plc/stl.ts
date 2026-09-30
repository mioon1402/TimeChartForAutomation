import type { Instr, ParseMessage } from './types';
import { normDevice } from './devices';
import { splitLines } from './text';

export interface StlParseResult {
  instrs: Instr[];
  labels: Map<string, number>;
  messages: ParseMessage[];
  inlineComments: Map<string, string>;
  german: boolean;
}

/** 독일어 니모닉 → 영어 */
const GERMAN: Record<string, string> = {
  U: 'A',
  UN: 'AN',
  'U(': 'A(',
  'UN(': 'AN(',
  SPA: 'JU',
  SPB: 'JC',
  SPBN: 'JCN',
  BEA: 'BEU',
  BEB: 'BEC',
  SI: 'SP',
  SV: 'SE',
  SE: 'SD',
  SA: 'SF',
  ZV: 'CU',
  ZR: 'CD',
};

const KNOWN = new Set([
  'A', 'AN', 'O', 'ON', 'X', 'XN', 'A(', 'AN(', 'O(', 'ON(', 'X(', 'XN(', ')', '=', 'S', 'R', 'NOT', 'SET', 'CLR', 'SAVE',
  'FP', 'FN', 'L', 'T', 'SD', 'SE', 'SP', 'SS', 'SF', 'CU', 'CD', 'JU', 'JC', 'JCN', 'JMP', 'BE', 'BEU', 'BEC', 'NOP',
  '==I', '<>I', '>I', '<I', '>=I', '<=I', '==D', '<>D', '>D', '<D', '>=D', '<=D', '==R', '<>R', '>R', '<R', '>=R', '<=R',
  '+I', '-I', '*I', '/I', '+D', '-D', '*D', '/D', '+R', '-R', '*R', '/R', 'INC', 'DEC',
]);

/** 지멘스 STL(AWL) 파싱 */
export function parseStl(text: string): StlParseResult {
  const lines = splitLines(text);
  const instrs: Instr[] = [];
  const labels = new Map<string, number>();
  const messages: ParseMessage[] = [];
  const inlineComments = new Map<string, string>();

  // 독일어 니모닉 여부 판단
  const german = lines.some((l) => /^\s*(?:\w{1,4}:\s*)?(U|UN|U\(|UN\(|SPA|SPB|ZV)\b/i.test(l.replace(/\/\/.*$/, '')));
  let inBlockComment = false;

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let s = raw;
    if (inBlockComment) {
      const e = s.indexOf('*)');
      if (e < 0) return;
      s = s.slice(e + 2);
      inBlockComment = false;
    }
    const bs = s.indexOf('(*');
    if (bs >= 0) {
      const be = s.indexOf('*)', bs);
      if (be < 0) {
        inBlockComment = true;
        s = s.slice(0, bs);
      } else s = s.slice(0, bs) + s.slice(be + 2);
    }
    let comment = '';
    const sl = s.indexOf('//');
    if (sl >= 0) {
      comment = s.slice(sl + 2).trim();
      s = s.slice(0, sl);
    }
    s = s.replace(/;\s*$/, '').trim();
    if (!s) return;
    if (/^(NETWORK|NETZWERK|TITLE|TITEL|ORGANIZATION_BLOCK|FUNCTION|FUNCTION_BLOCK|BEGIN|END_ORGANIZATION_BLOCK|END_FUNCTION|END_FUNCTION_BLOCK|VERSION|VAR|END_VAR|AUTHOR|FAMILY|NAME)\b/i.test(s)) {
      if (/^(NETWORK|NETZWERK)\b/i.test(s)) instrs.push({ op: 'NET', args: [], line: lineNo, text: raw.trim() });
      return;
    }
    // 라벨 "M001: A I0.0"
    const lm = /^([A-Za-z_][A-Za-z0-9_]{0,7}):\s*(.*)$/.exec(s);
    if (lm && !/^(A|O|X|U|L|T|S|R)$/i.test(lm[1])) {
      labels.set(lm[1].toUpperCase(), instrs.length);
      s = lm[2].trim();
      if (!s) return;
    }
    const m = /^(\S+)\s*(.*)$/.exec(s)!;
    let op = m[1].toUpperCase();
    let rest = m[2].trim();
    // "A (" 처럼 괄호가 떨어진 경우
    if (rest === '(' && /^(A|AN|O|ON|X|XN|U|UN)$/.test(op)) {
      op += '(';
      rest = '';
    }
    if (german && GERMAN[op]) op = GERMAN[op];
    if (!KNOWN.has(op)) {
      messages.push({ line: lineNo, message: `지원하지 않는 STL 명령 "${m[1]}" - 무시됨`, severity: 'warning' });
      return;
    }
    let args: string[] = [];
    if (rest) {
      if (['JU', 'JC', 'JCN', 'JMP'].includes(op)) args = [rest.toUpperCase()];
      else if (rest.startsWith('"')) args = [rest.replace(/^"(.*)"$/, '$1')];
      else args = [normDevice(rest.replace(/^%/, '').replace(/^#/, ''), 'siemens')];
    }
    if (['A', 'AN', 'O', 'ON', 'X', 'XN', '=', 'S', 'R', 'FP', 'FN', 'L', 'T', 'SD', 'SE', 'SP', 'SS', 'SF', 'CU', 'CD', 'JU', 'JC', 'JCN'].includes(op) && !args.length) {
      if (op === 'O') {
        instrs.push({ op: 'O_', args: [], line: lineNo, text: raw.trim() });
        return;
      }
      messages.push({ line: lineNo, message: `"${op}" 명령의 오퍼랜드가 없습니다`, severity: 'error' });
      return;
    }
    if (comment && args[0] && !inlineComments.has(args[0]) && ['A', 'AN', 'O', 'ON', '=', 'S', 'R'].includes(op)) inlineComments.set(args[0], comment);
    instrs.push({ op, args, line: lineNo, text: raw.trim() });
  });
  return { instrs, labels, messages, inlineComments, german };
}
