import type { DeviceInfo, Instr, ParseMessage, PlcDialect, SimSettings } from './types';
import { parseIl } from './il';
import { parseStl } from './stl';
import { analyzeSt, parseSt, StRuntime } from './st';
import { IlRuntime, StlRuntime, type PlcRuntime } from './runtime';
import { resolveAliases, aliasText, ioLinks, type Alias, type IoLink } from './alias';
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
  /** I/O 매핑 릴레이 → 원본 (M00440 → P00019) */
  aliases: Map<string, Alias>;
  /** 내부 릴레이 ↔ 실제 I/O 연결 (입력 매핑 / 출력 매핑) */
  ioLinks: IoLink[];
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
  /** 써 넣는 0 아닌 상수 값들 (스텝 레지스터는 MOV K10 D100, MOV K20 D100 처럼 여러 스텝 번호를 쓴다) */
  const movVals = new Map<string, Set<string>>();
  const movConst = (src: string | undefined, dst: string | undefined) => {
    if (!dst || !src || !isConstant(src)) return;
    cmpCount.set(dst, (cmpCount.get(dst) ?? 0) + 1);
    const v = src.replace(/^[A-Za-z]+#/, '').replace(/^[KkHh]/, '');
    if (!/^0+$/.test(v)) movVals.set(dst, (movVals.get(dst) ?? new Set()).add(v));
  };
  /** 상수와 비교한 횟수 */
  const cmpConst = new Map<string, number>();
  const cmpWith = (d: string) => {
    cmpCount.set(d, (cmpCount.get(d) ?? 0) + 1);
    cmpConst.set(d, (cmpConst.get(d) ?? 0) + 1);
  };
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
          if (isConstant(a[1] ?? '') && !isConstant(a[0])) cmpWith(a[0]);
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
        movConst(a[0], a[1]);
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
          cmpWith(a[0]);
        }
        break;
      }
      case 'T':
        touch(a[0], 'w', I.line);
        if (i > 0 && instrs[i - 1].op === 'L') movConst(instrs[i - 1].args[0], a[0]);
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
  // 스텝 후보: 상수와 여러 번 비교/대입하고, 0 아닌 스텝 번호를 써 넣는 워드
  //  (서로 다른 값 2개 이상, 또는 값 1개 + 상수 비교) - 엔코더 비교만 있거나 설정값 한 개만 쓰는 워드는 제외
  const isStepWord = (d: string) => {
    const vals = movVals.get(d)?.size ?? 0;
    return vals >= 2 || (vals >= 1 && (cmpConst.get(d) ?? 0) >= 1);
  };
  const steps = [...cmpCount.entries()].filter(([d, n]) => n >= 2 && isStepWord(d)).sort((x, y) => y[1] - x[1]).map(([d]) => d);
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
      aliases: new Map(),
      ioLinks: [],
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
      aliases: new Map(),
      ioLinks: [],
      size: r.instrs.length,
      createRuntime: () => new StlRuntime(r.instrs, r.labels),
    };
  }
  const r = parseIl(text, dialect);
  const { devices, steps } = analyzeIl(r.instrs, dialect);
  if (!r.instrs.length && text.trim()) r.messages.push({ line: 1, message: '인식된 명령이 없습니다. PLC 종류를 확인하세요.', severity: 'error' });
  const aliases = resolveAliases(r.instrs, dialect);
  const mapped = withAliases(applyComments(devices, r.inlineComments), aliases);
  return {
    dialect,
    messages: r.messages,
    devices: sortDevices(mapped.devices),
    stepCandidates: steps,
    stepNames: new Map(),
    aliases,
    ioLinks: mapped.links,
    size: r.instrs.length,
    createRuntime: (settings) => new IlRuntime(r.instrs, r.labels, dialect, settings),
  };
}

/** 실제 I/O (입력/출력 역할의 비트) */
function isRealIo(d: DeviceInfo | undefined): boolean {
  return !!d && d.type === 'bit' && (d.role === 'input' || d.role === 'output');
}

/** 매핑 릴레이에 원본 표시, 설명이 비어 있으면 서로 채워 준다 */
function withAliases(devices: DeviceInfo[], aliases: Map<string, Alias>): { devices: DeviceInfo[]; links: IoLink[] } {
  if (!aliases.size) return { devices, links: [] };
  const byName = new Map(devices.map((d) => [d.name, d]));
  // 타이머/카운터 접점은 릴레이로 보지 않음 (T0051 → 램프 같은 연결은 제외)
  const links = ioLinks(aliases, (n) => isRealIo(byName.get(n)), (n) => byName.get(n)?.type === 'bit');
  const drives = new Map<string, string>();
  const relays = new Map<string, string[]>();
  for (const l of links) {
    if (l.dir === 'out' && !drives.has(l.relay)) drives.set(l.relay, `${l.invert ? 'NOT ' : ''}${l.io}`);
    if (l.dir === 'in') relays.set(l.io, [...(relays.get(l.io) ?? []), l.relay]);
  }
  const out = devices.map((d) => {
    const a = aliases.get(d.name);
    const next: DeviceInfo = { ...d };
    // 실제 I/O 자체의 "= M…" 은 표시하지 않음 (출력은 drives 로 반대편에 표시)
    if (a && !isRealIo(d)) {
      next.alias = aliasText(a);
      next.comment = d.comment || byName.get(a.source)?.comment || '';
    }
    const dv = drives.get(d.name);
    if (dv) {
      next.drives = dv;
      next.comment = next.comment || byName.get(dv.replace(/^NOT /, ''))?.comment || '';
    }
    const rs = relays.get(d.name);
    if (rs) next.relays = rs;
    return next;
  });
  // 출력의 설명이 비어 있으면 켜 주는 릴레이 설명으로
  for (const d of out) {
    if (d.comment || !isRealIo(d) || d.role !== 'output') continue;
    const l = links.find((x) => x.dir === 'out' && x.io === d.name && byName.get(x.relay)?.comment);
    if (l) d.comment = byName.get(l.relay)!.comment;
  }
  return { devices: out, links };
}

export { isStepRelay };
