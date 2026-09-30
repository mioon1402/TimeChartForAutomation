import type { SignalRole } from '../model/types';
import { parseTime } from '../model/format';
import type { DeviceType, PlcDialect } from './types';

/** 디바이스 주소 정규화 */
export function normDevice(raw: string, dialect: PlcDialect): string {
  let s = raw.trim();
  if (!s) return s;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1); // 지멘스 심볼
  if (dialect === 'st') return s.replace(/^#/, '');
  s = s.toUpperCase().replace(/\s+/g, '');
  if (dialect === 'mitsubishi') {
    // X000 → X0, M0100 → M100, SM0400 → SM400 (접두어 + 숫자/16진)
    const m = /^([A-Z]+?)(0+)([0-9A-F]+)((?:\.[0-9A-F]+)?)$/.exec(s);
    if (m && !/^[KH]$/.test(m[1])) return m[1] + m[3] + m[4];
    const z = /^([A-Z]+?)0+(\.[0-9A-F]+)?$/.exec(s);
    if (z && !/^[KH]$/.test(z[1])) return z[1] + '0' + (z[2] ?? '');
  }
  if (dialect === 'siemens') {
    // 독일어 니모닉 주소 → 영어 (E→I, A→Q, Z→C)
    s = s.replace(/^E(\d)/, 'I$1').replace(/^A(\d)/, 'Q$1').replace(/^Z(\d)/, 'C$1').replace(/^EB/, 'IB').replace(/^EW/, 'IW').replace(/^AB/, 'QB').replace(/^AW/, 'QW');
  }
  return s;
}

/** 상수인가? K10, H1F, 10, 16#FF, S5T#2S, T#2S, C#5, TRUE/FALSE */
export function isConstant(s: string): boolean {
  const u = s.trim().toUpperCase();
  return (
    /^K-?\d+$/.test(u) ||
    /^H[0-9A-F]+$/.test(u) ||
    /^-?\d+(\.\d+)?$/.test(u) ||
    /^(16|8|2)#[0-9A-F_]+$/.test(u) ||
    /^(S5T|T|TIME|LT)#/.test(u) ||
    /^C#\d+$/.test(u) ||
    /^[BW]#16#[0-9A-F]+$/.test(u) ||
    /^E-?\d+$/.test(u) ||
    u === 'TRUE' ||
    u === 'FALSE'
  );
}

/** 상수 값. 시간 상수는 ms 로 반환 (isTime=true) */
export function constValue(s: string): { value: number; isTime: boolean } | null {
  const u = s.trim().toUpperCase();
  let m: RegExpExecArray | null;
  if ((m = /^K(-?\d+)$/.exec(u))) return { value: parseInt(m[1], 10), isTime: false };
  if ((m = /^H([0-9A-F]+)$/.exec(u))) return { value: parseInt(m[1], 16), isTime: false };
  if ((m = /^(-?\d+(?:\.\d+)?)$/.exec(u))) return { value: parseFloat(m[1]), isTime: false };
  if ((m = /^16#([0-9A-F_]+)$/.exec(u))) return { value: parseInt(m[1].replace(/_/g, ''), 16), isTime: false };
  if ((m = /^8#([0-7_]+)$/.exec(u))) return { value: parseInt(m[1].replace(/_/g, ''), 8), isTime: false };
  if ((m = /^2#([01_]+)$/.exec(u))) return { value: parseInt(m[1].replace(/_/g, ''), 2), isTime: false };
  if ((m = /^[BW]#16#([0-9A-F]+)$/.exec(u))) return { value: parseInt(m[1], 16), isTime: false };
  if ((m = /^C#(\d+)$/.exec(u))) return { value: parseInt(m[1], 10), isTime: false };
  if (/^(S5T|T|TIME|LT)#/.test(u)) {
    const ms = parseTime(u);
    return ms === null ? null : { value: ms, isTime: true };
  }
  if (u === 'TRUE') return { value: 1, isTime: false };
  if (u === 'FALSE') return { value: 0, isTime: false };
  return null;
}

export function isTimerDevice(d: string, dialect: PlcDialect): boolean {
  if (dialect === 'st') return false;
  return /^(T|TS|TC)\d+$/.test(d) || (dialect === 'ls' && /^T\d+$/.test(d));
}

export function isCounterDevice(d: string, dialect: PlcDialect): boolean {
  if (dialect === 'st') return false;
  if (dialect === 'siemens') return /^C\d+$/.test(d);
  return /^(C|CS|CN)\d+$/.test(d);
}

export function isStepRelay(d: string): boolean {
  return /^S\d+$/.test(d);
}

/** 워드 디바이스인가 (IL 기준) */
export function isWordDevice(d: string, dialect: PlcDialect): boolean {
  if (dialect === 'siemens') return /^(M|I|Q|P?I|P?Q|L)[BWD]\d+|^DB\d+\.DB[BWD]\d+/.test(d);
  if (dialect === 'mitsubishi') return /^(D|W|R|ZR|SD|SW|Z|V)\d+$/.test(d) && !/\.\w+$/.test(d);
  if (dialect === 'ls') {
    if (/^(D|R|ZR|U|N|W)\d+/.test(d) && !/\.\w+$/.test(d)) return true;
    // P/M/K/L/F 영역: 4자리 이하 = 워드, 5자리 = 비트
    const m = /^([PMKLF])([0-9]+)$/.exec(d);
    if (m && m[2].length <= 4) return true;
  }
  return false;
}

export function deviceType(d: string, dialect: PlcDialect): DeviceType {
  if (isTimerDevice(d, dialect)) return 'timer';
  if (isCounterDevice(d, dialect)) return 'counter';
  if (isWordDevice(d, dialect)) return 'word';
  return 'bit';
}

/** 입출력 역할 추정 */
export function deviceRole(d: string, dialect: PlcDialect, type: DeviceType): SignalRole {
  if (type === 'timer') return 'timer';
  if (type === 'counter') return 'counter';
  if (type === 'word') return 'data';
  const u = d.toUpperCase();
  switch (dialect) {
    case 'mitsubishi':
      if (/^X/.test(u)) return 'input';
      if (/^Y/.test(u)) return 'output';
      return 'internal';
    case 'ls':
      // XGK P 영역은 입출력 공용 - 사용 방식으로 판단 (호출 측에서 보정)
      if (/^P/.test(u)) return 'input';
      return 'internal';
    case 'siemens':
      if (/^I|^PI/.test(u)) return 'input';
      if (/^Q|^PQ/.test(u)) return 'output';
      return 'internal';
    case 'st':
      if (/^%I/.test(u)) return 'input';
      if (/^%Q/.test(u)) return 'output';
      return 'internal';
  }
}

/** 특수 릴레이 (항상 ON, 최초 1스캔, 클럭) */
export function specialBit(d: string, dialect: PlcDialect, scan: number, t: number): boolean | undefined {
  const clock = (period: number) => t % period < period / 2;
  if (dialect === 'mitsubishi') {
    switch (d) {
      case 'M8000':
      case 'SM400':
        return true;
      case 'M8001':
      case 'SM401':
        return false;
      case 'M8002':
      case 'SM402':
        return scan === 0;
      case 'M8003':
      case 'SM403':
        return scan !== 0;
      case 'M8011':
        return clock(10);
      case 'M8012':
      case 'SM410':
        return clock(100);
      case 'SM411':
        return clock(200);
      case 'M8013':
      case 'SM412':
        return clock(1000);
      case 'SM413':
        return clock(2000);
      case 'M8014':
      case 'SM414':
        return clock(60000);
    }
  }
  if (dialect === 'ls') {
    switch (d) {
      case '_ON':
      case 'F00099':
      case 'F0099':
        return true;
      case '_OFF':
      case 'F0009A':
      case 'F009A':
        return false;
      case '_1ON':
      case 'F0009B':
      case 'F009B':
        return scan === 0;
      case '_1OFF':
      case 'F0009C':
      case 'F009C':
        return scan !== 0;
      case '_T100MS':
      case 'F00090':
      case 'F0090':
        return clock(100);
      case '_T200MS':
      case 'F00091':
      case 'F0091':
        return clock(200);
      case '_T1S':
      case 'F00092':
      case 'F0092':
        return clock(1000);
      case '_T2S':
      case 'F00093':
      case 'F0093':
        return clock(2000);
    }
  }
  if (dialect === 'siemens') {
    if (d === 'FIRSTSCAN' || d === 'FIRST_SCAN') return scan === 0;
    if (d === 'ALWAYSTRUE' || d === 'ALWAYS_TRUE') return true;
    if (d === 'ALWAYSFALSE' || d === 'ALWAYS_FALSE') return false;
  }
  return undefined;
}

export function isSpecialDevice(d: string, dialect: PlcDialect): boolean {
  return specialBit(d, dialect, 1, 0) !== undefined || /^(M8\d{3}|SM\d+|SD\d+|D8\d{3}|F\d{4,5}|_\w+)$/.test(d);
}

/** 미쓰비시 타이머 단위 (ms) */
export function mitsubishiTimerBase(d: string, series: 'FX' | 'Q', base: number): number {
  if (series === 'FX') {
    const n = parseInt(d.replace(/^\D+/, ''), 10);
    if (n >= 200 && n <= 245) return 10;
    if (n >= 246 && n <= 249) return 1;
    if (n >= 250 && n <= 255) return 100;
    if (n >= 256 && n <= 511) return 1;
  }
  return base;
}

/** 자연 정렬 키 (X2 < X10) */
export function deviceSortKey(d: string): [string, number, string] {
  const m = /^([^\d]*)(\d+)(.*)$/.exec(d);
  if (!m) return [d, 0, ''];
  return [m[1], parseInt(m[2], 10), m[3]];
}

export function compareDevices(a: string, b: string): number {
  const ka = deviceSortKey(a);
  const kb = deviceSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
}
