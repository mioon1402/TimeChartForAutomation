/**
 * IEC 61131-3 Structured Text 파서 & 인터프리터
 * (CODESYS, TwinCAT, Siemens SCL, LS XG5000 ST, GX Works3 ST 공통 문법 대부분 지원)
 */
import type { DeviceInfo, ParseMessage } from './types';
import type { SignalRole } from '../model/types';
import { parseTime } from '../model/format';
import { newTimer, resetTimer, runTimer, timerElapsed, type PlcRuntime, type TimerState } from './runtime';

// ───────────────────────────── Lexer ─────────────────────────────

type TokKind = 'id' | 'num' | 'time' | 'str' | 'op' | 'kw' | 'eof';
interface Tok {
  k: TokKind;
  v: string;
  line: number;
  num?: number;
}

const KEYWORDS = new Set(
  (
    'IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT ' +
    'AND OR XOR NOT MOD TRUE FALSE RETURN EXIT CONTINUE VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_GLOBAL VAR_TEMP VAR_STAT ' +
    'VAR_EXTERNAL VAR_CONFIG END_VAR PROGRAM END_PROGRAM FUNCTION_BLOCK END_FUNCTION_BLOCK FUNCTION END_FUNCTION AT CONSTANT ' +
    'RETAIN NON_RETAIN PERSISTENT ORGANIZATION_BLOCK END_ORGANIZATION_BLOCK BEGIN REGION END_REGION DATA_BLOCK END_DATA_BLOCK'
  ).split(' '),
);

const OPS = [':=', '=>', '<>', '<=', '>=', '**', '..', '=', '<', '>', '+', '-', '*', '/', '(', ')', '[', ']', ',', ';', ':', '.', '&', '{', '}'];

export interface LexResult {
  toks: Tok[];
  lineComments: Map<number, string>;
  errors: ParseMessage[];
}

export function lex(src: string): LexResult {
  const toks: Tok[] = [];
  const lineComments = new Map<number, string>();
  const errors: ParseMessage[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const addComment = (ln: number, text: string) => {
    const t = text.trim();
    if (t && !lineComments.has(ln)) lineComments.set(ln, t);
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      addComment(line, src.slice(i + 2, e < 0 ? n : e));
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '(' && src[i + 1] === '*') {
      const e = src.indexOf('*)', i + 2);
      const body = src.slice(i + 2, e < 0 ? n : e);
      addComment(line, body.split('\n')[0]);
      line += (body.match(/\n/g) ?? []).length;
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const body = src.slice(i + 2, e < 0 ? n : e);
      addComment(line, body.split('\n')[0]);
      line += (body.match(/\n/g) ?? []).length;
      i = e < 0 ? n : e + 2;
      continue;
    }
    // 시간 리터럴 T#1s500ms, TIME#.., LT#.., S5T#..
    const tm = /^(?:T|TIME|LT|LTIME|S5T)#[-+]?[0-9A-Za-z_.]+/i.exec(src.slice(i, i + 64));
    if (tm) {
      const ms = parseTime(tm[0]);
      if (ms === null) errors.push({ line, message: `잘못된 시간 상수 ${tm[0]}`, severity: 'error' });
      toks.push({ k: 'time', v: tm[0], num: ms ?? 0, line });
      i += tm[0].length;
      continue;
    }
    // 타입 접두 리터럴 INT#5, BOOL#TRUE
    const typed = /^(?:INT|DINT|SINT|LINT|UINT|UDINT|USINT|WORD|DWORD|BYTE|REAL|LREAL|BOOL)#/i.exec(src.slice(i, i + 8));
    if (typed) {
      i += typed[0].length;
      continue;
    }
    // 숫자 (16#FF, 2#1010, 1.5E3)
    const based = /^(2|8|16)#([0-9A-Fa-f_]+)/.exec(src.slice(i, i + 40));
    if (based) {
      toks.push({ k: 'num', v: based[0], num: parseInt(based[2].replace(/_/g, ''), parseInt(based[1], 10)), line });
      i += based[0].length;
      continue;
    }
    // 정수부 → (소수부: '.' 뒤에 숫자일 때만, "1..5" 범위 연산자 보호) → 지수부
    const intPart = /^\d[\d_]*/.exec(src.slice(i, i + 40));
    if (intPart) {
      let text = intPart[0];
      const frac = /^\.\d[\d_]*/.exec(src.slice(i + text.length, i + text.length + 40));
      if (frac) text += frac[0];
      const exp = /^[eE][-+]?\d+/.exec(src.slice(i + text.length, i + text.length + 10));
      if (exp) text += exp[0];
      toks.push({ k: 'num', v: text, num: parseFloat(text.replace(/_/g, '')), line });
      i += text.length;
      continue;
    }
    // 직접 주소 %IX0.0, %QW10, %M0.0
    const addr = /^%[IQM][XBWDL]?\d+(\.\d+)*/i.exec(src.slice(i, i + 32));
    if (addr) {
      toks.push({ k: 'id', v: addr[0].toUpperCase(), line });
      i += addr[0].length;
      continue;
    }
    if (c === '"') {
      const e = src.indexOf('"', i + 1);
      const name = src.slice(i + 1, e < 0 ? n : e);
      toks.push({ k: 'id', v: name, line });
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + 1);
      toks.push({ k: 'str', v: src.slice(i + 1, e < 0 ? n : e), line });
      i = e < 0 ? n : e + 1;
      continue;
    }
    const id = /^#?[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i, i + 128));
    if (id) {
      const raw = id[0].replace(/^#/, '');
      const up = raw.toUpperCase();
      if (KEYWORDS.has(up)) toks.push({ k: 'kw', v: up, line });
      else toks.push({ k: 'id', v: raw, line });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ k: 'op', v: op, line });
      i += op.length;
      continue;
    }
    errors.push({ line, message: `알 수 없는 문자 '${c}'`, severity: 'error' });
    i++;
  }
  toks.push({ k: 'eof', v: '', line });
  return { toks, lineComments, errors };
}

// ───────────────────────────── AST ─────────────────────────────

export type Designator = (string | Expr)[]; // 이름, .필드, [인덱스]

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'str'; v: string }
  | { k: 'var'; d: Designator }
  | { k: 'un'; op: 'NOT' | '-'; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'call'; name: string; args: Expr[] };

export interface FbArg {
  name: string | null;
  e?: Expr;
  out?: Designator;
}

export type Stmt =
  | { k: 'assign'; d: Designator; e: Expr; mode: ':=' | 'S' | 'R'; line: number }
  | { k: 'call'; d: Designator; args: FbArg[]; line: number }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; els: Stmt[] | null; line: number }
  | { k: 'case'; sel: Expr; cases: { labels: (number | [number, number])[]; body: Stmt[]; line: number }[]; els: Stmt[] | null; line: number }
  | { k: 'for'; v: Designator; from: Expr; to: Expr; by: Expr | null; body: Stmt[]; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'repeat'; body: Stmt[]; until: Expr; line: number }
  | { k: 'exit'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; line: number };

export interface VarDecl {
  name: string;
  type: string;
  section: string;
  addr?: string;
  init?: Expr;
  comment: string;
  line: number;
}

export interface StProgram {
  decls: VarDecl[];
  body: Stmt[];
  messages: ParseMessage[];
  lineComments: Map<number, string>;
}

class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
  }
}

// ───────────────────────────── Parser ─────────────────────────────

export function parseSt(src: string): StProgram {
  const { toks, lineComments, errors } = lex(src);
  const messages: ParseMessage[] = [...errors];
  const decls: VarDecl[] = [];
  const body: Stmt[] = [];
  let p = 0;
  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
  const next = () => toks[p++ < toks.length - 1 ? p - 1 : toks.length - 1];
  const isOp = (v: string, o = 0) => peek(o).k === 'op' && peek(o).v === v;
  const isKw = (v: string, o = 0) => peek(o).k === 'kw' && peek(o).v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ParseError(`'${v}' 가 필요합니다 (발견: '${peek().v || 'EOF'}')`, peek().line);
    p++;
  };
  const expectKw = (v: string) => {
    if (!isKw(v)) throw new ParseError(`${v} 가 필요합니다 (발견: '${peek().v || 'EOF'}')`, peek().line);
    p++;
  };
  const skipSemis = () => {
    while (isOp(';')) p++;
  };
  const skipBraces = () => {
    while (isOp('{')) {
      let depth = 0;
      do {
        if (isOp('{')) depth++;
        else if (isOp('}')) depth--;
        p++;
      } while (depth > 0 && peek().k !== 'eof');
    }
  };

  function parseDesignator(): Designator {
    const t = next();
    if (t.k !== 'id') throw new ParseError(`변수 이름이 필요합니다 (발견: '${t.v || 'EOF'}')`, t.line);
    const d: Designator = [t.v];
    for (;;) {
      if (isOp('.') && (peek(1).k === 'id' || peek(1).k === 'num')) {
        p++;
        d.push('.' + next().v);
      } else if (isOp('[')) {
        p++;
        d.push(parseExpr());
        while (isOp(',')) {
          p++;
          d.push(parseExpr());
        }
        expectOp(']');
      } else break;
    }
    return d;
  }

  function parseArgs(): FbArg[] {
    const args: FbArg[] = [];
    expectOp('(');
    while (!isOp(')')) {
      if (peek().k === 'id' && (isOp(':=', 1) || isOp('=>', 1))) {
        const name = next().v;
        if (isOp(':=')) {
          p++;
          args.push({ name, e: parseExpr() });
        } else {
          p++;
          args.push({ name, out: parseDesignator() });
        }
      } else if (isKw('NOT') && peek(1).k === 'id' && isOp('=>', 2)) {
        // NOT Q => x (출력 반전) - 단순화: 무시하고 일반 출력 처리
        p++;
        const name = next().v;
        p++;
        args.push({ name, out: parseDesignator() });
      } else args.push({ name: null, e: parseExpr() });
      if (isOp(',')) p++;
      else break;
    }
    expectOp(')');
    return args;
  }

  function parsePrimary(): Expr {
    const t = peek();
    if (t.k === 'num' || t.k === 'time') {
      p++;
      return { k: 'num', v: t.num ?? 0 };
    }
    if (t.k === 'str') {
      p++;
      return { k: 'str', v: t.v };
    }
    if (t.k === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) {
      p++;
      return { k: 'bool', v: t.v === 'TRUE' };
    }
    if (isOp('(')) {
      p++;
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    if (t.k === 'id') {
      const d = parseDesignator();
      if (isOp('(') && d.length === 1) {
        const args = parseArgs();
        return { k: 'call', name: String(d[0]).toUpperCase(), args: args.map((a) => a.e ?? { k: 'num', v: 0 }) };
      }
      return { k: 'var', d };
    }
    throw new ParseError(`식이 필요합니다 (발견: '${t.v || 'EOF'}')`, t.line);
  }

  function parseUnary(): Expr {
    if (isKw('NOT')) {
      p++;
      return { k: 'un', op: 'NOT', e: parseUnary() };
    }
    if (isOp('-')) {
      p++;
      return { k: 'un', op: '-', e: parseUnary() };
    }
    if (isOp('+')) {
      p++;
      return parseUnary();
    }
    return parsePrimary();
  }

  const binLevel = (sub: () => Expr, ops: string[], kws: string[] = []) => (): Expr => {
    let a = sub();
    for (;;) {
      const t = peek();
      const op = t.k === 'op' && ops.includes(t.v) ? t.v : t.k === 'kw' && kws.includes(t.v) ? t.v : null;
      if (!op) return a;
      p++;
      a = { k: 'bin', op: op === '&' ? 'AND' : op, a, b: sub() };
    }
  };
  const parsePow = binLevel(parseUnary, ['**']);
  const parseMul = binLevel(parsePow, ['*', '/'], ['MOD']);
  const parseAdd = binLevel(parseMul, ['+', '-']);
  const parseCmp = binLevel(parseAdd, ['=', '<>', '<', '>', '<=', '>=']);
  const parseAnd = binLevel(parseCmp, ['&'], ['AND']);
  const parseXor = binLevel(parseAnd, [], ['XOR']);
  const parseExpr: () => Expr = binLevel(parseXor, [], ['OR']);

  function parseBlock(terms: string[]): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      skipSemis();
      const t = peek();
      if (t.k === 'eof') throw new ParseError(`${terms.join('/')} 가 필요합니다`, t.line);
      if (t.k === 'kw' && terms.includes(t.v)) return out;
      // CASE 라벨 감지 (정수 뒤 ':' 또는 ',' 또는 '..')
      const s = parseStatement();
      if (s) out.push(s);
    }
  }

  function isCaseLabelAhead(): boolean {
    let o = 0;
    for (;;) {
      if (isOp('-', o)) o++;
      const t = peek(o);
      if (t.k !== 'num' && t.k !== 'id') return false;
      o++;
      if (isOp('..', o)) {
        o++;
        if (isOp('-', o)) o++;
        o++;
      }
      if (isOp(':', o)) return true;
      if (isOp(',', o)) {
        o++;
        continue;
      }
      return false;
    }
  }

  function parseCaseLabels(): (number | [number, number])[] {
    const labels: (number | [number, number])[] = [];
    const num = (): number => {
      let neg = false;
      if (isOp('-')) {
        p++;
        neg = true;
      }
      const t = next();
      if (t.k === 'num') return neg ? -(t.num ?? 0) : t.num ?? 0;
      // 상수 이름은 선언의 초기값으로 해석
      const decl = decls.find((d) => d.name.toUpperCase() === t.v.toUpperCase());
      if (decl?.init?.k === 'num') return decl.init.v;
      throw new ParseError(`CASE 라벨에는 정수가 필요합니다 (${t.v})`, t.line);
    };
    for (;;) {
      const a = num();
      if (isOp('..')) {
        p++;
        labels.push([a, num()]);
      } else labels.push(a);
      if (isOp(',')) p++;
      else break;
    }
    expectOp(':');
    return labels;
  }

  function parseStatement(): Stmt | null {
    const t = peek();
    const line = t.line;
    if (t.k === 'kw') {
      switch (t.v) {
        case 'IF': {
          p++;
          const branches: { cond: Expr; body: Stmt[] }[] = [];
          const cond = parseExpr();
          expectKw('THEN');
          branches.push({ cond, body: parseBlock(['ELSIF', 'ELSE', 'END_IF']) });
          let els: Stmt[] | null = null;
          for (;;) {
            if (isKw('ELSIF')) {
              p++;
              const c = parseExpr();
              expectKw('THEN');
              branches.push({ cond: c, body: parseBlock(['ELSIF', 'ELSE', 'END_IF']) });
            } else if (isKw('ELSE')) {
              p++;
              els = parseBlock(['END_IF']);
            } else break;
          }
          expectKw('END_IF');
          return { k: 'if', branches, els, line };
        }
        case 'CASE': {
          p++;
          const sel = parseExpr();
          expectKw('OF');
          const cases: { labels: (number | [number, number])[]; body: Stmt[]; line: number }[] = [];
          let els: Stmt[] | null = null;
          for (;;) {
            skipSemis();
            if (isKw('END_CASE')) break;
            if (isKw('ELSE')) {
              p++;
              els = parseBlock(['END_CASE']);
              break;
            }
            if (peek().k === 'eof') throw new ParseError('END_CASE 가 필요합니다', peek().line);
            const labelLine = peek().line;
            const labels = parseCaseLabels();
            const stmts: Stmt[] = [];
            for (;;) {
              skipSemis();
              if (isKw('END_CASE') || isKw('ELSE') || isCaseLabelAhead() || peek().k === 'eof') break;
              const s = parseStatement();
              if (s) stmts.push(s);
            }
            cases.push({ labels, body: stmts, line: labelLine });
          }
          expectKw('END_CASE');
          return { k: 'case', sel, cases, els, line };
        }
        case 'FOR': {
          p++;
          const v = parseDesignator();
          expectOp(':=');
          const from = parseExpr();
          expectKw('TO');
          const to = parseExpr();
          let by: Expr | null = null;
          if (isKw('BY')) {
            p++;
            by = parseExpr();
          }
          expectKw('DO');
          const b = parseBlock(['END_FOR']);
          expectKw('END_FOR');
          return { k: 'for', v, from, to, by, body: b, line };
        }
        case 'WHILE': {
          p++;
          const cond = parseExpr();
          expectKw('DO');
          const b = parseBlock(['END_WHILE']);
          expectKw('END_WHILE');
          return { k: 'while', cond, body: b, line };
        }
        case 'REPEAT': {
          p++;
          const b = parseBlock(['UNTIL']);
          expectKw('UNTIL');
          const until = parseExpr();
          expectKw('END_REPEAT');
          return { k: 'repeat', body: b, until, line };
        }
        case 'EXIT':
          p++;
          return { k: 'exit', line };
        case 'CONTINUE':
          p++;
          return { k: 'continue', line };
        case 'RETURN':
          p++;
          return { k: 'return', line };
        case 'REGION': {
          p++;
          while (peek().line === line && peek().k !== 'eof' && !isOp(';')) p++;
          return null;
        }
        case 'END_REGION':
          p++;
          return null;
      }
      throw new ParseError(`예상하지 못한 키워드 ${t.v}`, t.line);
    }
    if (t.k === 'id') {
      const d = parseDesignator();
      if (isOp(':=')) {
        p++;
        const e = parseExpr();
        return { k: 'assign', d, e, mode: ':=', line };
      }
      // CODESYS  x S= cond;  x R= cond;
      if (peek().k === 'id' && /^[SR]$/i.test(peek().v) && isOp('=', 1)) {
        const mode = next().v.toUpperCase() as 'S' | 'R';
        p++;
        return { k: 'assign', d, e: parseExpr(), mode, line };
      }
      if (isOp('(')) {
        const args = parseArgs();
        return { k: 'call', d, args, line };
      }
      throw new ParseError(`':=' 또는 '(' 가 필요합니다 (발견: '${peek().v || 'EOF'}')`, peek().line);
    }
    throw new ParseError(`문장을 해석할 수 없습니다: '${t.v}'`, t.line);
  }

  function parseVarSection(section: string) {
    skipBraces();
    while (isKw('CONSTANT') || isKw('RETAIN') || isKw('NON_RETAIN') || isKw('PERSISTENT')) p++;
    for (;;) {
      skipSemis();
      skipBraces();
      if (isKw('END_VAR')) {
        p++;
        return;
      }
      if (peek().k === 'eof') throw new ParseError('END_VAR 가 필요합니다', peek().line);
      const line = peek().line;
      const names: string[] = [];
      const t0 = next();
      if (t0.k !== 'id') throw new ParseError(`변수 이름이 필요합니다 (발견: '${t0.v}')`, t0.line);
      names.push(t0.v);
      skipBraces();
      while (isOp(',')) {
        p++;
        names.push(next().v);
      }
      let addr: string | undefined;
      if (isKw('AT')) {
        p++;
        addr = next().v.toUpperCase();
      }
      expectOp(':');
      // 타입: 이름 | ARRAY[..] OF 타입 | STRING[n] | STRUCT ... END_STRUCT
      let type = '';
      let depth = 0;
      while (peek().k !== 'eof') {
        if (depth === 0 && (isOp(';') || isOp(':='))) break;
        if (isKw('END_VAR')) break;
        const tk = next();
        if (tk.k === 'op' && tk.v === '[') depth++;
        if (tk.k === 'op' && tk.v === ']') depth--;
        type += (type && tk.k !== 'op' ? ' ' : '') + tk.v;
      }
      let init: Expr | undefined;
      if (isOp(':=')) {
        p++;
        try {
          init = parseExpr();
        } catch {
          while (!isOp(';') && peek().k !== 'eof' && !isKw('END_VAR')) p++;
        }
      }
      skipSemis();
      const comment = lineComments.get(line) ?? '';
      for (const nm of names) decls.push({ name: nm, type: type.toUpperCase().trim(), section, addr, init, comment, line });
    }
  }

  while (peek().k !== 'eof') {
    const t = peek();
    try {
      if (t.k === 'kw' && t.v.startsWith('VAR')) {
        p++;
        parseVarSection(t.v);
        continue;
      }
      if (t.k === 'kw' && ['PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION', 'ORGANIZATION_BLOCK', 'DATA_BLOCK'].includes(t.v)) {
        p++;
        if (peek().k === 'id') p++;
        if (isOp(':')) {
          p++;
          p++;
        }
        // SCL 헤더 (TITLE = ..., VERSION : 0.1, {..})
        while (peek().k === 'id' && /^(TITLE|VERSION|AUTHOR|FAMILY|NAME)$/i.test(peek().v)) {
          const ln = peek().line;
          while (peek().line === ln && peek().k !== 'eof') p++;
        }
        skipBraces();
        continue;
      }
      if (t.k === 'kw' && ['END_PROGRAM', 'END_FUNCTION_BLOCK', 'END_FUNCTION', 'END_ORGANIZATION_BLOCK', 'END_DATA_BLOCK', 'BEGIN'].includes(t.v)) {
        p++;
        continue;
      }
      if (isOp(';')) {
        p++;
        continue;
      }
      if (isOp('{')) {
        skipBraces();
        continue;
      }
      const s = parseStatement();
      if (s) body.push(s);
      skipSemis();
    } catch (e) {
      if (e instanceof ParseError) {
        messages.push({ line: e.line, message: e.message, severity: 'error' });
        // 다음 ';' 까지 건너뛰고 계속
        const ln = peek().line;
        while (peek().k !== 'eof' && !isOp(';') && !(peek().line > ln && peek().k === 'kw')) p++;
        if (isOp(';')) p++;
      } else throw e;
    }
  }
  return { decls, body, messages, lineComments };
}

// ───────────────────────────── 런타임 ─────────────────────────────

type Val = boolean | number;

const FB_TYPES = new Set(['TON', 'TOF', 'TP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD', 'RS', 'SR']);

function fbTypeOf(type: string): string | null {
  const t = type.toUpperCase().replace(/\s/g, '');
  if (FB_TYPES.has(t)) return t;
  const m = /^(TON|TOF|TP)_(L?TIME)$/.exec(t);
  if (m) return m[1];
  if (t === 'IEC_TIMER' || t === 'IEC_LTIMER') return 'TON';
  if (/^CT(U|D|UD)_(INT|DINT|UINT|UDINT|LINT)$/.test(t)) return t.split('_')[0];
  return null;
}

interface FbInst {
  type: string;
  inputs: Record<string, Val>;
  timer?: TimerState;
  q: boolean;
  q2: boolean; // CTUD QD
  cv: number;
  m: boolean;
  prevCu: boolean;
  prevCd: boolean;
}

class LoopCtl {
  constructor(public kind: 'exit' | 'continue' | 'return') {}
}

function isBoolType(type: string): boolean {
  return /^(BOOL|BIT)$/.test(type);
}

export class StRuntime implements PlcRuntime {
  vars = new Map<string, Val>();
  fbs = new Map<string, FbInst>();
  types = new Map<string, string>();
  /** 대문자 키 → 표시 이름 */
  display = new Map<string, string>();
  /** 주소 → 변수 키 (%IX0.0 → START) */
  alias = new Map<string, string>();
  warnings: string[] = [];
  private warned = new Set<string>();
  private t = 0;

  constructor(private prog: StProgram) {
    for (const d of prog.decls) {
      const key = d.name.toUpperCase();
      this.display.set(key, d.name);
      this.types.set(key, d.type);
      if (d.addr) this.alias.set(d.addr, key);
      const fb = fbTypeOf(d.type);
      if (fb) this.fbs.set(key, this.newFb(fb));
      else if (d.init) this.vars.set(key, this.eval(d.init));
      else this.vars.set(key, isBoolType(d.type) ? false : 0);
    }
  }

  private warn(msg: string) {
    if (!this.warned.has(msg) && this.warned.size < 50) {
      this.warned.add(msg);
      this.warnings.push(msg);
    }
  }

  private newFb(type: string): FbInst {
    const inst: FbInst = { type, inputs: {}, q: false, q2: false, cv: 0, m: false, prevCu: false, prevCd: false };
    if (type === 'TON' || type === 'TOF' || type === 'TP') inst.timer = newTimer(type, 1);
    return inst;
  }

  private key(name: string): string {
    const up = name.toUpperCase();
    return this.alias.get(up) ?? up;
  }

  private resolve(d: Designator): string {
    let s = '';
    for (const part of d) {
      if (typeof part === 'string') s += part;
      else s += `[${Math.trunc(Number(this.eval(part)))}]`;
    }
    const dot = s.indexOf('.');
    const head = dot < 0 ? s : s.slice(0, dot);
    const tail = dot < 0 ? '' : s.slice(dot);
    return this.key(head) + tail.toUpperCase();
  }

  valueType(d: string): 'bit' | 'word' {
    const k = this.lookupKey(d);
    const ty = this.types.get(k);
    if (ty !== undefined) return isBoolType(ty) ? 'bit' : 'word';
    if (/\.(Q|QU|QD|Q1|IN|CU|CD|CLK)$/.test(k)) return 'bit';
    if (/\.(ET|CV|PT|PV)$/.test(k)) return 'word';
    const v = this.vars.get(k);
    return typeof v === 'number' ? 'word' : 'bit';
  }

  private lookupKey(d: string): string {
    const dot = d.indexOf('.');
    if (dot > 0 && !d.startsWith('%')) return this.key(d.slice(0, dot)) + d.slice(dot).toUpperCase();
    return this.key(d);
  }

  readValue(d: string): Val {
    return this.get(this.lookupKey(d));
  }

  readBit(d: string): boolean {
    return Boolean(this.readValue(d));
  }

  readWord(d: string): number {
    return Number(this.readValue(d));
  }

  writeBit(d: string, v: boolean): void {
    this.set(this.lookupKey(d), v);
  }

  private get(k: string): Val {
    const dot = k.indexOf('.');
    if (dot > 0 && !k.startsWith('%')) {
      const inst = this.fbs.get(k.slice(0, dot));
      if (inst) return this.fbField(inst, k.slice(dot + 1));
    }
    const v = this.vars.get(k);
    if (v === undefined) {
      this.vars.set(k, false);
      return false;
    }
    return v;
  }

  private set(k: string, v: Val) {
    const dot = k.indexOf('.');
    if (dot > 0 && !k.startsWith('%')) {
      const inst = this.fbs.get(k.slice(0, dot));
      if (inst) {
        inst.inputs[k.slice(dot + 1)] = v;
        return;
      }
    }
    const ty = this.types.get(k);
    if (ty && isBoolType(ty)) v = Boolean(v);
    else if (ty && /INT|WORD|BYTE|TIME/.test(ty) && typeof v === 'boolean') v = v ? 1 : 0;
    else if (ty && /INT|WORD|BYTE/.test(ty) && typeof v === 'number') v = Math.trunc(v);
    this.vars.set(k, v);
  }

  private fbField(inst: FbInst, f: string): Val {
    switch (f) {
      case 'Q':
      case 'Q1':
      case 'QU':
        return inst.q;
      case 'QD':
        return inst.q2;
      case 'ET':
        return inst.timer ? timerElapsed(inst.timer, this.t) : 0;
      case 'CV':
        return inst.cv;
      default:
        return inst.inputs[f] ?? false;
    }
  }

  private runFb(inst: FbInst) {
    const I = inst.inputs;
    const b = (n: string) => Boolean(I[n]);
    const num = (n: string) => Number(I[n] ?? 0);
    switch (inst.type) {
      case 'TON':
      case 'TOF':
      case 'TP':
        runTimer(inst.timer!, b('IN'), num('PT'), this.t);
        inst.q = inst.timer!.q;
        break;
      case 'R_TRIG':
        inst.q = b('CLK') && !inst.m;
        inst.m = b('CLK');
        break;
      case 'F_TRIG':
        inst.q = !b('CLK') && inst.m;
        inst.m = b('CLK');
        break;
      case 'CTU':
        if (b('R') || b('RESET')) inst.cv = 0;
        else if (b('CU') && !inst.prevCu) inst.cv++;
        inst.prevCu = b('CU');
        inst.q = inst.cv >= num('PV');
        break;
      case 'CTD':
        if (b('LD') || b('LOAD')) inst.cv = num('PV');
        else if (b('CD') && !inst.prevCd) inst.cv--;
        inst.prevCd = b('CD');
        inst.q = inst.cv <= 0;
        break;
      case 'CTUD':
        if (b('R')) inst.cv = 0;
        else if (b('LD')) inst.cv = num('PV');
        else {
          if (b('CU') && !inst.prevCu) inst.cv++;
          if (b('CD') && !inst.prevCd) inst.cv--;
        }
        inst.prevCu = b('CU');
        inst.prevCd = b('CD');
        inst.q = inst.cv >= num('PV');
        inst.q2 = inst.cv <= 0;
        break;
      case 'RS':
        inst.q = !b('R1') && (b('S') || inst.q);
        break;
      case 'SR':
        inst.q = b('S1') || (!b('R') && inst.q);
        break;
    }
  }

  private inferFb(args: FbArg[]): string {
    const names = new Set(args.map((a) => (a.name ?? '').toUpperCase()));
    if (names.has('PT')) return 'TON';
    if (names.has('CLK')) return 'R_TRIG';
    if (names.has('CU') && names.has('CD')) return 'CTUD';
    if (names.has('CU')) return 'CTU';
    if (names.has('CD')) return 'CTD';
    if (names.has('S1')) return 'SR';
    if (names.has('R1')) return 'RS';
    return 'TON';
  }

  private callFb(d: Designator, args: FbArg[], line: number) {
    let name = this.resolve(d);
    let type: string | null = null;
    // SCL 멀티 인스턴스: "Timer_DB".TON(...)
    const mm = /^(.*)\.(TON|TOF|TP|CTU|CTD|CTUD|R_TRIG|F_TRIG)$/.exec(name);
    if (mm) {
      name = mm[1];
      type = mm[2];
    }
    let inst = this.fbs.get(name);
    if (!inst) {
      type = type ?? fbTypeOf(this.types.get(name) ?? '') ?? this.inferFb(args);
      if (!this.types.has(name)) this.warn(`줄 ${line}: 선언되지 않은 FB 인스턴스 ${name} → ${type} 로 가정`);
      inst = this.newFb(type);
      this.fbs.set(name, inst);
      if (!this.display.has(name)) this.display.set(name, String(d[0]));
    }
    const inputOrder: Record<string, string[]> = {
      TON: ['IN', 'PT'],
      TOF: ['IN', 'PT'],
      TP: ['IN', 'PT'],
      R_TRIG: ['CLK'],
      F_TRIG: ['CLK'],
      CTU: ['CU', 'R', 'PV'],
      CTD: ['CD', 'LD', 'PV'],
      CTUD: ['CU', 'CD', 'R', 'LD', 'PV'],
      RS: ['S', 'R1'],
      SR: ['S1', 'R'],
    };
    let pos = 0;
    for (const a of args) {
      if (a.e) {
        const nm = a.name ? a.name.toUpperCase() : inputOrder[inst.type]?.[pos++];
        if (nm) inst.inputs[nm] = this.eval(a.e);
      }
    }
    this.runFb(inst);
    for (const a of args) {
      if (a.out && a.name) this.set(this.resolve(a.out), this.fbField(inst, a.name.toUpperCase()));
    }
  }

  private callFn(name: string, args: Expr[]): Val {
    const v = args.map((a) => this.eval(a));
    const n = (i: number) => Number(v[i] ?? 0);
    switch (name) {
      case 'ABS':
        return Math.abs(n(0));
      case 'MIN':
        return Math.min(...v.map(Number));
      case 'MAX':
        return Math.max(...v.map(Number));
      case 'LIMIT':
        return Math.min(Math.max(n(1), n(0)), n(2));
      case 'SEL':
        return v[0] ? v[2] : v[1];
      case 'MUX':
        return v[1 + Math.trunc(n(0))] ?? 0;
      case 'MOVE':
        return v[0];
      case 'SQRT':
        return Math.sqrt(n(0));
      case 'TRUNC':
        return Math.trunc(n(0));
      case 'ROUND':
        return Math.round(n(0));
    }
    if (/_TO_/.test(name) || /^TO_/.test(name)) {
      const target = name.split('_TO_').pop()!.replace(/^TO_/, '');
      if (target === 'BOOL') return Boolean(v[0]);
      if (/INT|WORD|BYTE/.test(target)) return Math.trunc(Number(v[0]));
      return Number(v[0]);
    }
    this.warn(`지원하지 않는 함수 ${name}`);
    return 0;
  }

  eval(e: Expr): Val {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'bool':
        return e.v;
      case 'str':
        return 0;
      case 'var':
        return this.get(this.resolve(e.d));
      case 'un': {
        const v = this.eval(e.e);
        if (e.op === 'NOT') return typeof v === 'boolean' ? !v : ~v;
        return -Number(v);
      }
      case 'call':
        return this.callFn(e.name, e.args);
      case 'bin': {
        const op = e.op;
        if (op === 'AND' || op === 'OR' || op === 'XOR') {
          const a = this.eval(e.a);
          if (op === 'AND' && a === false) return false;
          if (op === 'OR' && a === true) return true;
          const b = this.eval(e.b);
          if (typeof a === 'boolean' || typeof b === 'boolean') {
            const x = Boolean(a);
            const y = Boolean(b);
            return op === 'AND' ? x && y : op === 'OR' ? x || y : x !== y;
          }
          return op === 'AND' ? a & b : op === 'OR' ? a | b : a ^ b;
        }
        const a = Number(this.eval(e.a));
        const b = Number(this.eval(e.b));
        switch (op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            if (b === 0) {
              this.warn('0 으로 나누기');
              return 0;
            }
            return a / b;
          case 'MOD':
            return b === 0 ? 0 : a % b;
          case '**':
            return Math.pow(a, b);
          case '=':
            return a === b;
          case '<>':
            return a !== b;
          case '<':
            return a < b;
          case '>':
            return a > b;
          case '<=':
            return a <= b;
          case '>=':
            return a >= b;
        }
        return 0;
      }
    }
  }

  private exec(stmts: Stmt[]): void {
    for (const s of stmts) this.execOne(s);
  }

  private execOne(s: Stmt): void {
    switch (s.k) {
      case 'assign': {
        const k = this.resolve(s.d);
        const v = this.eval(s.e);
        if (s.mode === ':=') this.set(k, this.coerce(k, v));
        else if (v) this.set(k, s.mode === 'S');
        break;
      }
      case 'call': {
        const name = String(s.d[0]).toUpperCase();
        if (s.d.length === 1 && !this.fbs.has(this.key(name)) && !this.types.has(this.key(name)) && /^(SET|RESET|RST)$/.test(name)) break;
        this.callFb(s.d, s.args, s.line);
        break;
      }
      case 'if': {
        for (const b of s.branches) {
          if (this.eval(b.cond)) {
            this.exec(b.body);
            return;
          }
        }
        if (s.els) this.exec(s.els);
        break;
      }
      case 'case': {
        const v = Math.trunc(Number(this.eval(s.sel)));
        for (const c of s.cases) {
          if (c.labels.some((l) => (Array.isArray(l) ? v >= l[0] && v <= l[1] : v === l))) {
            this.exec(c.body);
            return;
          }
        }
        if (s.els) this.exec(s.els);
        break;
      }
      case 'for': {
        const k = this.resolve(s.v);
        const to = Number(this.eval(s.to));
        const by = s.by ? Number(this.eval(s.by)) : 1;
        if (by === 0) {
          this.warn(`줄 ${s.line}: FOR BY 0`);
          break;
        }
        let guard = 0;
        for (let i = Number(this.eval(s.from)); by > 0 ? i <= to : i >= to; i += by) {
          if (++guard > 10000) {
            this.warn(`줄 ${s.line}: FOR 반복 한도 초과`);
            break;
          }
          this.set(k, i);
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof LoopCtl && e.kind === 'exit') break;
            if (e instanceof LoopCtl && e.kind === 'continue') continue;
            throw e;
          }
          i = Number(this.get(k));
        }
        break;
      }
      case 'while':
      case 'repeat': {
        let guard = 0;
        for (;;) {
          if (s.k === 'while' && !this.eval(s.cond)) break;
          if (++guard > 10000) {
            this.warn(`줄 ${s.line}: 반복 한도 초과`);
            break;
          }
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof LoopCtl && e.kind === 'exit') break;
            if (!(e instanceof LoopCtl && e.kind === 'continue')) throw e;
          }
          if (s.k === 'repeat' && this.eval(s.until)) break;
        }
        break;
      }
      case 'exit':
        throw new LoopCtl('exit');
      case 'continue':
        throw new LoopCtl('continue');
      case 'return':
        throw new LoopCtl('return');
    }
  }

  private coerce(k: string, v: Val): Val {
    const ty = this.types.get(k);
    if (!ty) return v;
    if (isBoolType(ty)) return Boolean(v);
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }

  scan(t: number, _scanIndex: number): void {
    this.t = t;
    try {
      this.exec(this.prog.body);
    } catch (e) {
      if (!(e instanceof LoopCtl)) {
        this.warn(`실행 오류: ${(e as Error).message}`);
      }
    }
  }

  /** 스텝 등에 사용하는 FB 타이머 리셋 (외부 사용) */
  resetTimers() {
    for (const f of this.fbs.values()) if (f.timer) resetTimer(f.timer);
  }

  displayName(k: string): string {
    const dot = k.indexOf('.');
    if (dot > 0) return (this.display.get(k.slice(0, dot)) ?? k.slice(0, dot)) + k.slice(dot);
    return this.display.get(k) ?? k;
  }
}

// ─────────────────────── 디바이스(변수) 분석 ───────────────────────

export function analyzeSt(prog: StProgram): { devices: DeviceInfo[]; caseSelectors: string[]; stepNames: Map<string, Map<string, string>> } {
  const info = new Map<string, DeviceInfo>();
  const declByKey = new Map(prog.decls.map((d) => [d.name.toUpperCase(), d]));
  const aliasToKey = new Map(prog.decls.filter((d) => d.addr).map((d) => [d.addr!, d.name.toUpperCase()]));
  const caseSelectors: string[] = [];
  const stepNames = new Map<string, Map<string, string>>();
  const displayOf = (k: string) => declByKey.get(k)?.name ?? k;

  const nameOf = (d: Designator): string | null => {
    const parts: string[] = [];
    for (const p of d) {
      if (typeof p !== 'string') return null;
      parts.push(p);
    }
    const head = parts[0].toUpperCase();
    const key = aliasToKey.get(head) ?? head;
    const tail = parts.slice(1).join('').toUpperCase();
    return key + tail;
  };

  const touch = (key: string, mode: 'r' | 'w', line: number) => {
    const dot = key.indexOf('.');
    const base = dot > 0 ? key.slice(0, dot) : key;
    const decl = declByKey.get(base);
    const fb = decl ? fbTypeOf(decl.type) : null;
    let name = displayOf(base) + (dot > 0 ? key.slice(dot) : '');
    let type: DeviceInfo['type'] = 'bit';
    if (fb) {
      if (dot < 0) return; // 인스턴스 자체는 제외
      const field = key.slice(dot + 1);
      if (/^(Q|QU|QD|Q1)$/.test(field)) type = /^CT/.test(fb) ? 'counter' : /^T/.test(fb) ? 'timer' : 'bit';
      else if (/^(ET|CV)$/.test(field)) type = 'word';
      else return;
      name = displayOf(base) + '.' + field;
    } else if (!decl && dot > 0) {
      // 선언 없는 FB 인스턴스 필드 (T1.Q 등)
      const field = key.slice(dot + 1);
      type = /^(ET|CV)$/.test(field) ? 'word' : 'timer';
    } else if (decl && !isBoolType(decl.type)) type = 'word';
    const k = name.toUpperCase();
    let d = info.get(k);
    if (!d) {
      d = { name, address: decl?.addr, type, read: false, written: false, role: 'internal', comment: decl?.comment ?? '', line };
      info.set(k, d);
    }
    if (mode === 'r') d.read = true;
    else d.written = true;
  };

  const walkExpr = (e: Expr, line: number) => {
    switch (e.k) {
      case 'var': {
        const n = nameOf(e.d);
        if (n) touch(n, 'r', line);
        for (const p of e.d) if (typeof p !== 'string') walkExpr(p, line);
        break;
      }
      case 'un':
        walkExpr(e.e, line);
        break;
      case 'bin':
        walkExpr(e.a, line);
        walkExpr(e.b, line);
        break;
      case 'call':
        e.args.forEach((a) => walkExpr(a, line));
        break;
    }
  };
  const walk = (ss: Stmt[]) => {
    for (const s of ss) {
      switch (s.k) {
        case 'assign': {
          const n = nameOf(s.d);
          if (n) touch(n, 'w', s.line);
          walkExpr(s.e, s.line);
          break;
        }
        case 'call': {
          const inst = nameOf(s.d);
          for (const a of s.args) {
            if (a.e) walkExpr(a.e, s.line);
            if (a.out) {
              const n = nameOf(a.out);
              if (n) touch(n, 'w', s.line);
            }
          }
          if (inst) {
            const base = inst.replace(/\.(TON|TOF|TP|CTU|CTD|CTUD|R_TRIG|F_TRIG)$/, '');
            const decl = declByKey.get(base);
            const fb = (decl && fbTypeOf(decl.type)) || /\.(TON|TOF|TP)$/.exec(inst)?.[1];
            if (fb && /^(TON|TOF|TP)$/.test(fb)) touch(base + '.Q', 'w', s.line);
          }
          break;
        }
        case 'if':
          s.branches.forEach((b) => {
            walkExpr(b.cond, s.line);
            walk(b.body);
          });
          if (s.els) walk(s.els);
          break;
        case 'case': {
          walkExpr(s.sel, s.line);
          if (s.sel.k === 'var') {
            const n = nameOf(s.sel.d);
            if (n && !caseSelectors.includes(displayOf(n))) caseSelectors.push(displayOf(n));
            // CASE 라벨 줄의 주석을 스텝 이름으로 (10: (* 클램프 *))
            if (n) {
              const names = stepNames.get(displayOf(n)) ?? new Map<string, string>();
              for (const c of s.cases) {
                const cm = prog.lineComments.get(c.line);
                if (!cm) continue;
                for (const l of c.labels) if (!Array.isArray(l) && !names.has(String(l))) names.set(String(l), cm);
              }
              stepNames.set(displayOf(n), names);
            }
          }
          s.cases.forEach((c) => walk(c.body));
          if (s.els) walk(s.els);
          break;
        }
        case 'for':
          walkExpr(s.from, s.line);
          walkExpr(s.to, s.line);
          walk(s.body);
          break;
        case 'while':
          walkExpr(s.cond, s.line);
          walk(s.body);
          break;
        case 'repeat':
          walk(s.body);
          walkExpr(s.until, s.line);
          break;
      }
    }
  };
  walk(prog.body);

  const roleFor = (d: DeviceInfo): SignalRole => {
    if (d.type === 'timer') return 'timer';
    if (d.type === 'counter') return 'counter';
    const decl = declByKey.get(d.name.toUpperCase());
    const addr = d.address ?? (d.name.startsWith('%') ? d.name : '');
    if (/^%I/.test(addr) || decl?.section === 'VAR_INPUT') return d.type === 'word' ? 'data' : 'input';
    if (/^%Q/.test(addr) || decl?.section === 'VAR_OUTPUT') return d.type === 'word' ? 'data' : 'output';
    if (d.type === 'word') return 'data';
    if (!d.written && d.read) return 'input';
    return 'internal';
  };
  const devices = [...info.values()].map((d) => ({ ...d, role: roleFor(d) }));
  return { devices, caseSelectors, stepNames };
}
