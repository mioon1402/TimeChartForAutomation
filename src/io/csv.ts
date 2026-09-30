import type { Project, Signal, SignalKind, WavePoint } from '../model/types';
import { createProject, createSignal, guessRole, PALETTE, ROLE_COLORS } from '../model/project';
import { effectivePoints, normalize, valueAt, isHigh } from '../model/wave';
import { signalStats, cycleSummary } from '../model/analysis';
import { formatTime } from '../model/format';
import { detectDelimiter, splitCsvLine, splitLines } from '../plc/text';

const BOM = '﻿';

function cell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(cells: unknown[]): string {
  return cells.map(cell).join(',');
}

export function signalLabel(s: Signal): string {
  return s.address ? `${s.name} (${s.address})` : s.name;
}

/** 변화 시점 테이블 (엑셀용, UTF-8 BOM) */
export function exportChangeTable(project: Project): string {
  const d = project.settings.duration;
  const sigs = project.signals.filter((s) => !s.hidden);
  const times = new Set<number>([0]);
  for (const s of sigs) for (const p of effectivePoints(s, d)) if (p.t <= d) times.add(p.t);
  const sorted = [...times].sort((a, b) => a - b);
  const lines = [row(['Time(ms)', ...sigs.map(signalLabel)])];
  for (const t of sorted) {
    lines.push(
      row([
        t,
        ...sigs.map((s) => {
          const v = valueAt(effectivePoints(s, d), t, s.kind);
          if (s.kind === 'bit' || s.kind === 'clock') return isHigh(v) ? 1 : v === 'x' || v === 'z' ? v : 0;
          if (s.kind === 'analog') return Math.round(Number(v) * 1000) / 1000;
          return v;
        }),
      ]),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

const ROLE_KO: Record<string, string> = {
  input: '입력',
  output: '출력',
  internal: '내부',
  actuator: '액추에이터',
  sensor: '센서',
  timer: '타이머',
  counter: '카운터',
  data: '데이터',
  other: '기타',
};

export function roleLabelKo(role: string): string {
  return ROLE_KO[role] ?? role;
}

/** 신호(I/O) 목록 */
export function exportSignalList(project: Project): string {
  const d = project.settings.duration;
  const u = project.settings.timeUnit;
  const lines = [row(['No', '주소', '신호명', '설명', '종류', '역할', 'ON 횟수', 'ON 합계', '최초 ON', '최소 ON폭', '최대 ON폭'])];
  project.signals.forEach((s, i) => {
    const st = signalStats(s, d);
    const bit = s.kind === 'bit' || s.kind === 'clock';
    lines.push(
      row([
        i + 1,
        s.address,
        s.name,
        s.comment,
        s.kind,
        roleLabelKo(s.role),
        bit ? st.onCount : '',
        bit ? formatTime(st.onTotal, u) : '',
        bit && st.firstOn !== null ? formatTime(st.firstOn, u) : '',
        bit && st.minOn !== null ? formatTime(st.minOn, u) : '',
        bit && st.maxOn !== null ? formatTime(st.maxOn, u) : '',
      ]),
    );
  });
  return BOM + lines.join('\r\n') + '\r\n';
}

/** 공정 스텝 표 */
export function exportStepTable(project: Project): string {
  const c = cycleSummary(project);
  const lines = [row(['No', '스텝', '시작(ms)', '종료(ms)', '시간(ms)', '비율(%)', '설명'])];
  c.steps.forEach((r, i) => lines.push(row([i + 1, r.step.label, r.step.start, r.step.end, r.duration, (r.share * 100).toFixed(1), r.step.description])));
  lines.push(row(['', '합계', c.start, c.end, c.total, '100.0', '']));
  return BOM + lines.join('\r\n') + '\r\n';
}

// ───────────────────────── CSV 로그 가져오기 ─────────────────────────

export interface CsvImportOptions {
  /** 시간 열 단위 (auto: 헤더/값으로 추정) */
  timeUnit: 'auto' | 'ms' | 's';
  /** 동일 값 반복 행 무시 등 샘플 수 제한 */
  maxRows: number;
}

export interface CsvImportResult {
  project: Project;
  warnings: string[];
  timeUnit: 'ms' | 's' | 'datetime';
}

const BOOL_WORDS: Record<string, 0 | 1> = { '0': 0, '1': 1, TRUE: 1, FALSE: 0, ON: 1, OFF: 0, T: 1, F: 0 };

function parseDateTime(s: string): number | null {
  // 2024/01/02 12:34:56.789, 2024-01-02T12:34:56.789, 12:34:56.789
  const m = /^(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T])?(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac] = m;
  const ms = frac ? parseFloat('0.' + frac) * 1000 : 0;
  const base = y ? Date.UTC(+y, +mo - 1, +d) : 0;
  return base + ((+h * 60 + +mi) * 60 + +se) * 1000 + ms;
}

/** 데이터 로거 / 트렌드 CSV → 프로젝트. 첫 열 = 시간 */
export function importCsvLog(text: string, opts: Partial<CsvImportOptions> = {}): CsvImportResult {
  const o: CsvImportOptions = { timeUnit: 'auto', maxRows: 200000, ...opts };
  const warnings: string[] = [];
  const lines = splitLines(text).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('데이터 행이 없습니다.');
  const delim = detectDelimiter(lines);
  const rows = lines.map((l) => splitCsvLine(l, delim));
  // 헤더: 첫 열이 시간으로 해석되지 않는 마지막 행 (데이터 시작 직전)
  let header = -1;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const first = rows[i][0] ?? '';
    const isData = /^-?\d+(\.\d+)?$/.test(first) || parseDateTime(first) !== null;
    if (isData) break;
    header = i;
  }
  if (header < 0) warnings.push('헤더 행이 없어 열 이름을 자동으로 붙였습니다.');
  const names = header >= 0 ? rows[header] : rows[0].map((_, i) => (i === 0 ? 'time' : `CH${i}`));
  const data = rows.slice(header + 1).filter((r) => r.length >= 2);
  if (data.length > o.maxRows) {
    warnings.push(`행이 많아 처음 ${o.maxRows.toLocaleString()}행만 가져옵니다.`);
    data.length = o.maxRows;
  }
  const timeHeader = (names[0] ?? '').toLowerCase();
  let unit: CsvImportResult['timeUnit'] = 'ms';
  let times: number[];
  if (parseDateTime(data[0][0]) !== null && !/^-?\d+(\.\d+)?$/.test(data[0][0])) {
    unit = 'datetime';
    const t0 = parseDateTime(data[0][0])!;
    times = data.map((r) => (parseDateTime(r[0]) ?? t0) - t0);
  } else {
    const raw = data.map((r) => parseFloat(r[0]));
    if (o.timeUnit !== 'auto') unit = o.timeUnit;
    else if (/\(s\)|\[s\]|\bsec|초/.test(timeHeader) && !/ms/.test(timeHeader)) unit = 's';
    else if (/ms|msec/.test(timeHeader)) unit = 'ms';
    else unit = raw.some((v) => !Number.isInteger(v)) && Math.max(...raw) < 1000 ? 's' : 'ms';
    const t0 = raw[0];
    times = raw.map((v) => (v - t0) * (unit === 's' ? 1000 : 1));
  }
  const project = createProject();
  project.meta.title = 'CSV 로그 타임차트';
  const signals: Signal[] = [];
  for (let c = 1; c < names.length; c++) {
    const col = data.map((r) => (r[c] ?? '').trim());
    if (col.every((v) => v === '')) continue;
    const upper = col.map((v) => v.toUpperCase());
    const allBool = upper.every((v) => v === '' || v in BOOL_WORDS);
    const nums = col.map((v) => parseFloat(v));
    const allNum = col.every((v, i) => v === '' || Number.isFinite(nums[i]));
    const distinct = new Set(col).size;
    let kind: SignalKind = 'bus';
    if (allBool) kind = 'bit';
    else if (allNum && distinct > 16) kind = 'analog';
    const pts: WavePoint[] = [];
    let last: string | null = null;
    for (let i = 0; i < col.length; i++) {
      if (col[i] === '') continue;
      const key = upper[i];
      if (key === last && kind !== 'analog') continue;
      last = key;
      const v = kind === 'bit' ? BOOL_WORDS[key] : kind === 'analog' ? nums[i] : col[i];
      pts.push({ t: Math.max(0, times[i]), v });
    }
    const header = names[c] || `CH${c}`;
    const devMatch = /^([A-Z%][A-Z0-9.%]*\d)(?:\s+|[:_-])?(.*)$/i.exec(header);
    const address = devMatch && /\d/.test(devMatch[1]) && devMatch[1].length <= 12 ? devMatch[1].toUpperCase() : '';
    const name = address ? devMatch![2]?.trim() || address : header;
    const role = address ? guessRole(address) : kind === 'analog' ? 'data' : 'other';
    const sig = createSignal({
      name,
      address,
      kind,
      role,
      color: role === 'other' ? PALETTE[signals.length % PALETTE.length] : ROLE_COLORS[role],
      points: normalize(pts, kind, pts[0]?.v ?? 0),
    });
    if (kind === 'analog') {
      const valid = nums.filter((x) => Number.isFinite(x));
      sig.analogMin = Math.min(...valid);
      sig.analogMax = Math.max(...valid);
      if (sig.analogMax === sig.analogMin) sig.analogMax = sig.analogMin + 1;
      sig.heightScale = 1.6;
    }
    signals.push(sig);
  }
  project.signals = signals;
  const end = times.length ? times[times.length - 1] : 1000;
  project.settings.duration = Math.max(end, 1);
  const raw = end / 60;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.001))));
  project.settings.grid = [1, 2, 5, 10].map((m) => m * pow).find((g) => g >= raw) ?? pow * 10;
  project.settings.timeUnit = end >= 10000 ? 's' : 'ms';
  return { project, warnings, timeUnit: unit };
}
