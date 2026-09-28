import type { DeviceInfo, Instr, ParseMessage, PlcDialect, SimSettings } from './types';
import { parseIl } from './il';
import { parseStl } from './stl';
import { analyzeSt, parseSt, StRuntime } from './st';
import { IlRuntime, StlRuntime, type PlcRuntime } from './runtime';
import { compareDevices, deviceRole, deviceType, isConstant, isSpecialDevice, isStepRelay } from './devices';

export interface ParsedProgram {
  dialect: PlcDialect;
  messages: ParseMessage[];
  devices: DeviceInfo[];
  /** 스텝 번호 디바이스 후보 */
  stepCandidates: string[];
  /** 명령/문장 수 */
  size: number;
  /** 스텝 디바이스 → 값 → 이름 (코드 주석에서) */
  stepNames: Map<string, Map<string, string>>;
  createRuntime(settings: SimSettings): PlcRuntime;
}

const DIALECT_NAMES: Record<PlcDialect, string> = {
  mitsubishi: '미쓰비시 (GX Works 니모닉/CSV)',
  ls: 'LS ELECTRIC (XG5000 니모닉)',
  siemens: '지멘스 STL (AWL)',
  st: 'IEC 61131-3 ST / SCL',
};

export function dialectName(d: PlcDialect): string {
  return DIALECT_NAMES[d];
}

/** 소스 텍스트로 PLC 언어 추정 */
export function detectDialect(text: string): PlcDialect {
  const t = text.slice(0, 20000);
  const score: Record<PlcDialect, number> = { mitsubishi: 0, ls: 0, siemens: 0, st: 0 };
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  score.st += count(/:=/g) * 2 + count(/\b(END_IF|END_CASE|END_VAR|THEN|ELSIF)\b/gi) * 3;
  score.siemens += count(/^\s*(?:\w+:\s*)?(A|AN|O|ON|U|UN|X|XN)\s+("[^"]+"|[IEQAMT]\s?\d+(\.\d)?|%?[IQM]\d+\.\d)/gim) * 2;
  score.siemens += count(/^\s*(A\(|O\(|U\(|\)|=\s+\S)/gm) * 2 + count(/\bNETWORK\b|S5T#/gi) * 3;
  score.ls += count(/\b(LOAD NOT|AND NOT|OR NOT|AND LOAD|OR LOAD|MPUSH|MPOP|MLOAD|TOFF|OUT NOT)\b/gi) * 3;
  score.ls += count(/^\s*(\d+\s+)?LOAD\b/gim) * 3 + count(/\bP[0-9]{4}[0-9A-F]\b/g) + count(/\bTON\s+T\d+/gi) * 2;
  score.mitsubishi += count(/^\s*"?(\d+"?\s*[\t,]?\s*"?"?\s*[\t,]?\s*"?)?(LD|LDI|ANI|ORI|ANB|ORB|MPS|MRD|MPP|LDP|LDF)\b/gim) * 3;
  score.mitsubishi += count(/\b[XY]0*[0-9A-F]{1,4}\b/g) + count(/\bOUT\s+T\d+\s+K\d+/gi) * 3 + count(/"(Instruction|命令|명령)"/g) * 10;
  let best: PlcDialect = 'mitsubishi';
  for (const k of Object.keys(score) as PlcDialect[]) if (score[k] > score[best]) best = k;
  return best;
}

function analyzeIl(instrs: Instr[], dialect: PlcDialect): { devices: DeviceInfo[]; steps: string[] } {
  const map = new Map<string, DeviceInfo>();
  const touch = (d: string | undefined, mode: 'r' | 'w', line: number) => {
    if (!d || isConstant(d) || isSpecialDevice(d, dialect) || /^N\d+$/.test(d)) return;
    let info = map.get(d);
    if (!info) {
      const type = deviceType(d, dialect);
      info = { name: d, type, read: false, written: false, role: deviceRole(d, dialect, type), comment: '', line };
      map.set(d, info);
    }
    if (mode === 'r') info.read = true;
    else info.written = true;
  };
  const cmpCount = new Map<string, number>();
  let hasStl = false;
  for (let i = 0; i < instrs.length; i++) {
    const I = instrs[i];
    const a = I.args;
    switch (I.op) {
      case 'LD':
      case 'AND':
      case 'OR':
        if (I.cmp) {
          touch(a[0], 'r', I.line);
          touch(a[1], 'r', I.line);
          if (isConstant(a[1] ?? '') && !isConstant(a[0])) cmpCount.set(a[0], (cmpCount.get(a[0]) ?? 0) + 1);
        } else touch(a[0], 'r', I.line);
        break;
      case 'OUT':
      case 'SET':
      case 'RST':
      case 'PLS':
      case 'PLF':
      case 'ALT':
        touch(a[0], 'w', I.line);
        break;
      case 'TMR':
      case 'CTU':
      case 'CTD':
        touch(a[0], 'w', I.line);
        touch(a[1], 'r', I.line);
        break;
      case 'MOV':
        touch(a[0], 'r', I.line);
        touch(a[1], 'w', I.line);
        if (isConstant(a[0])) cmpCount.set(a[1], (cmpCount.get(a[1]) ?? 0) + 1);
        break;
      case 'INC':
      case 'DEC':
        touch(a[0], 'w', I.line);
        break;
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV':
        a.slice(0, -1).forEach((x) => touch(x, 'r', I.line));
        touch(a[a.length - 1], 'w', I.line);
        break;
      case 'ZRST':
        break;
      case 'FMOV':
        touch(a[0], 'r', I.line);
        touch(a[1], 'w', I.line);
        break;
      case 'STL':
        hasStl = true;
        touch(a[0], 'r', I.line);
        break;
      case 'MC':
        touch(a[1], 'w', I.line);
        break;
      // 지멘스 STL
      case 'A':
      case 'AN':
      case 'O':
      case 'ON':
      case 'X':
      case 'XN':
        touch(a[0], 'r', I.line);
        break;
      case '=':
      case 'S':
      case 'R':
      case 'SD':
      case 'SE':
      case 'SP':
      case 'SS':
      case 'SF':
      case 'CU':
      case 'CD':
        touch(a[0], 'w', I.line);
        break;
      case 'L': {
        touch(a[0], 'r', I.line);
        const n1 = instrs[i + 1];
        const n2 = instrs[i + 2];
        if (n1?.op === 'L' && n2 && /^(==|<>|>=|<=|>|<)[IDR]$/.test(n2.op) && isConstant(n1.args[0]) && !isConstant(a[0])) {
          cmpCount.set(a[0], (cmpCount.get(a[0]) ?? 0) + 1);
        }
        break;
      }
      case 'T':
        touch(a[0], 'w', I.line);
        if (i > 0 && instrs[i - 1].op === 'L' && isConstant(instrs[i - 1].args[0])) cmpCount.set(a[0], (cmpCount.get(a[0]) ?? 0) + 1);
        break;
    }
  }
  const devices = [...map.values()].map((d) => {
    // LS P 영역 / 역할 미정: 쓰이면 출력, 읽기만 하면 입력
    if (dialect === 'ls' && d.type === 'bit' && /^P/.test(d.name)) return { ...d, role: d.written ? ('output' as const) : ('input' as const) };
    if (dialect === 'ls' && d.type === 'bit' && /^[MKLF]/.test(d.name)) return { ...d, role: 'internal' as const };
    if (dialect === 'siemens' && d.role === 'internal' && !/^[MLDV]/.test(d.name) && d.type === 'bit') {
      // 심볼릭 이름: 읽기 전용이면 입력, 쓰이면 출력으로 가정
      return { ...d, role: d.written ? ('output' as const) : ('input' as const) };
    }
    return d;
  });
  const steps = [...cmpCount.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).map(([d]) => d);
  if (hasStl) steps.unshift('@STL');
  return { devices, steps };
}

export function roleOrder(d: DeviceInfo): number {
  const order: Record<string, number> = { input: 0, sensor: 1, output: 2, actuator: 3, internal: 4, timer: 5, counter: 6, data: 7, other: 8 };
  return order[d.role] ?? 9;
}

export function sortDevices(ds: DeviceInfo[]): DeviceInfo[] {
  return [...ds].sort((a, b) => roleOrder(a) - roleOrder(b) || compareDevices(a.name, b.name));
}

/** PLC 프로그램 파싱 */
export function parseProgram(text: string, dialect: PlcDialect, comments?: Map<string, string>): ParsedProgram {
  const applyComments = (devices: DeviceInfo[], inline: Map<string, string>) =>
    devices.map((d) => ({
      ...d,
      comment: comments?.get(d.name) ?? comments?.get(d.name.toUpperCase()) ?? (d.address ? comments?.get(d.address) : undefined) ?? (d.comment || inline.get(d.name) || ''),
    }));

  if (dialect === 'st') {
    const prog = parseSt(text);
    const { devices, caseSelectors, stepNames } = analyzeSt(prog);
    return {
      dialect,
      messages: prog.messages,
      devices: sortDevices(applyComments(devices, new Map())),
      stepCandidates: caseSelectors,
      stepNames,
      size: prog.body.length,
      createRuntime: () => new StRuntime(prog),
    };
  }
  if (dialect === 'siemens') {
    const r = parseStl(text);
    const { devices, steps } = analyzeIl(r.instrs, 'siemens');
    const messages = [...r.messages];
    let depth = 0;
    for (const I of r.instrs) {
      if (I.op.endsWith('(')) depth++;
      if (I.op === ')') depth--;
      if (depth < 0) {
        messages.push({ line: I.line, message: '짝이 맞지 않는 ")"', severity: 'error' });
        depth = 0;
      }
    }
    return {
      dialect,
      messages,
      devices: sortDevices(applyComments(devices, r.inlineComments)),
      stepCandidates: steps,
      stepNames: new Map(),
      size: r.instrs.length,
      createRuntime: () => new StlRuntime(r.instrs, r.labels),
    };
  }
  const r = parseIl(text, dialect);
  const { devices, steps } = analyzeIl(r.instrs, dialect);
  if (!r.instrs.length && text.trim()) r.messages.push({ line: 1, message: '인식된 명령이 없습니다. PLC 종류를 확인하세요.', severity: 'error' });
  return {
    dialect,
    messages: r.messages,
    devices: sortDevices(applyComments(devices, r.inlineComments)),
    stepCandidates: steps,
    stepNames: new Map(),
    size: r.instrs.length,
    createRuntime: (settings) => new IlRuntime(r.instrs, r.labels, dialect, settings),
  };
}

export { isStepRelay };
