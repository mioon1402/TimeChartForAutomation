/**
 * 동작 순서 페이지(엑셀형 표)의 편집 규칙.
 *  - 칸에 적은 글자 → 기기·동작·시간 (없는 기기 이름은 새로 만들고, "하강"처럼 처음 쓰는 동작 이름은 그 기기의 동작 이름이 된다)
 *  - 엑셀에서 붙여 넣은 표: 첫 줄이 제목(기기, 동작, 시간 …)이면 제목으로 칸을 맞춘다
 *  - 차트에 적용: 동작 순서로 차트를 다시 만들고, 적용한 순간의 서명을 남겨 "고친 뒤 아직 적용 안 함", "차트를 손으로 고침"을 알아낸다
 */
import type { Project } from './types';
import { createProject } from './project';
import { buildProject, defaultSpec, ioPoints, kindDefaults, LABEL_PAIRS, newAction, newDevice, type DeviceKind, type SeqAction, type SeqDevice, type SeqSpec } from './sequence';

// ───────────────────────── 시간 ─────────────────────────

/** "0.5", "0,5", "0.5s", "500ms", "1.2초" → ms. 단위가 없으면 초 (defaultMs 면 ms) */
export function parseSec(text: string, defaultMs = false): number | null {
  const t = text.replace(/\s+/g, '').replace(',', '.').toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d*\.?\d+)(ms|msec|밀리초|s|sec|초)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  const ms = unit === 'ms' || unit === 'msec' || unit === '밀리초' || (!unit && defaultMs) ? n : n * 1000;
  return Math.round(ms);
}

/** ms → 초 글자 ("0.5", "1.25") */
export function fmtSec(ms: number): string {
  return String(Math.round(ms) / 1000);
}

// ───────────────────────── 적용 서명 ─────────────────────────

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 차트 모양을 정하는 동작 순서 내용 (제목·설비 이름 같은 표제 정보는 빼고) */
export function specSig(s: SeqSpec): string {
  return hash(stable({ targetCycle: s.targetCycle, startButton: s.startButton, devices: s.devices, addrStyle: s.addrStyle, ioEdits: s.ioEdits, actions: s.actions }));
}

/** 차트에서 손으로 고칠 수 있는 것 (파형, 스텝, 화살표·주석, 규칙) */
export function chartSig(p: Project): string {
  return hash(
    stable({
      signals: p.signals.map((s) => [s.id, s.name, s.address, s.points.map((pt) => [pt.t, pt.v, pt.ramp ?? 0])]),
      steps: p.steps.map((s) => [s.id, s.label, s.start, s.end]),
      annotations: p.annotations,
      rules: p.rules,
    }),
  );
}

export type SeqStatus = 'none' | 'applied' | 'changed';

/** none = 동작 순서로 만든 차트가 아님, applied = 차트가 지금 표와 같음, changed = 표를 고친 뒤 아직 적용 안 함 */
export function sequenceStatus(p: Project): SeqStatus {
  const s = p.sequence;
  if (!s) return 'none';
  if (!s.applied) return 'applied'; // 이전 작성 도우미로 만든 차트
  return s.applied.spec === specSig(s) ? 'applied' : 'changed';
}

/** 적용한 뒤 차트를 손으로 고쳤는가 (알 수 없으면 true) */
export function chartEditedSinceApply(p: Project): boolean {
  const a = p.sequence?.applied;
  if (!a || !a.chart) return p.signals.length > 0;
  return a.chart !== chartSig(p);
}

/** 표를 고친 결과를 프로젝트에 넣는다 (예전 파일은 이때 "적용한 상태"를 기준으로 잡는다) */
export function withSequence(p: Project, next: SeqSpec): Project {
  const prev = p.sequence;
  const applied = next.applied ?? (prev ? prev.applied ?? { spec: specSig(prev), chart: '' } : undefined);
  return { ...p, sequence: { ...next, applied } };
}

export function autoTitle(machine: string): string {
  return machine ? `${machine} 동작 타임차트` : '동작 타임차트';
}

const AUTO_DESC = /^동작 \d+단계, 사이클 타임/;

/** 동작 순서로 차트를 다시 만든다. 표제(제목, 설비, 작성자 …), 보고서 설정, PLC 설정은 그대로 둔다. */
export function applySequence(p: Project, spec: SeqSpec): Project {
  const { applied: _old, ...clean } = spec;
  void _old;
  const s: SeqSpec = { ...clean, title: p.meta.title, machine: p.meta.machine, drawingNo: p.meta.drawingNo, author: p.meta.author };
  const built = buildProject(s);
  const next: Project = {
    ...p,
    meta: {
      ...p.meta,
      title: p.meta.title || built.meta.title,
      description: !p.meta.description || AUTO_DESC.test(p.meta.description) ? built.meta.description : p.meta.description,
    },
    settings: { ...p.settings, duration: built.settings.duration, grid: built.settings.grid, timeUnit: built.settings.timeUnit },
    signals: built.signals,
    steps: built.steps,
    annotations: built.annotations,
    rules: built.rules,
  };
  next.sequence = { ...s, applied: { spec: specSig(s), chart: '' } };
  next.sequence.applied!.chart = chartSig(next);
  return next;
}

/** 동작 순서로 새 차트 */
export function newSequenceProject(spec: SeqSpec = defaultSpec()): Project {
  const p = createProject();
  p.meta = { ...p.meta, title: spec.title || autoTitle(spec.machine), machine: spec.machine, drawingNo: spec.drawingNo, author: spec.author };
  return applySequence(p, spec);
}

export function emptySpec(): SeqSpec {
  return { ...defaultSpec(), devices: [], actions: [] };
}

// ───────────────────────── 공통 ─────────────────────────

export interface CellEdit {
  row: number;
  col: string;
  text: string;
}

export interface EditResult {
  spec: SeqSpec;
  /** 알려 줄 일 (새 기기를 만들었다 등) */
  notes: string[];
  /** 읽지 못한 칸 */
  warnings: string[];
}

function byRow(edits: CellEdit[]): Map<number, Map<string, string>> {
  const m = new Map<number, Map<string, string>>();
  for (const e of [...edits].sort((a, b) => a.row - b.row)) {
    if (!m.has(e.row)) m.set(e.row, new Map());
    m.get(e.row)!.set(e.col, e.text);
  }
  return m;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 첫 동작은 "앞 동작과 동시에"일 수 없다 */
function fixFirst(actions: SeqAction[]): SeqAction[] {
  return actions.map((a, k) => (k === 0 && a.withPrev ? { ...a, withPrev: false } : a));
}

// ───────────────────────── 동작 기기 표 ─────────────────────────

export const KIND_LABEL: Record<DeviceKind, string> = {
  cyl2: '실린더 (더블 SOL)',
  cyl1: '실린더 (싱글 SOL)',
  motor: '모터',
  vacuum: '흡착 · 척',
};

export function parseKind(t: string): DeviceKind | null {
  const s = t.toLowerCase();
  if (!s.trim()) return null;
  if (/싱글|single|스프링|spring|1\s*sol|편솔/.test(s)) return 'cyl1';
  if (/모터|motor|컨베이어|conveyor|인버터|펌프/.test(s)) return 'motor';
  if (/흡착|진공|vac|척|chuck|그리퍼|gripper|패드/.test(s)) return 'vacuum';
  if (/더블|double|양솔|2\s*sol|실린더|cyl|에어/.test(s)) return 'cyl2';
  return null;
}

function guessKind(name: string): DeviceKind {
  const k = parseKind(name);
  return k === 'cyl1' ? 'cyl2' : k ?? 'cyl2';
}

export function parseYesNo(t: string): boolean | null {
  const s = t.trim().toLowerCase();
  if (/^(있음|있|유|o|y|yes|예|1|true|on|✓|✔|v|사용|○|●)$/.test(s)) return true;
  if (/^(없음|없|무|x|n|no|아니오|0|false|off|-|미사용|×)$/.test(s)) return false;
  return null;
}

export type DevCol = 'name' | 'kind' | 'fwd' | 'ret' | 'fwdT' | 'retT' | 'sen';
export const DEV_COLS: DevCol[] = ['name', 'kind', 'fwd', 'ret', 'fwdT', 'retT', 'sen'];

export function deviceText(d: SeqDevice, col: DevCol): string {
  switch (col) {
    case 'name':
      return d.name;
    case 'kind':
      return KIND_LABEL[d.kind];
    case 'fwd':
      return d.fwdLabel;
    case 'ret':
      return d.retLabel;
    case 'fwdT':
      return fmtSec(d.fwdTime);
    case 'retT':
      return d.kind === 'motor' ? '' : fmtSec(d.retTime);
    case 'sen':
      return d.kind === 'motor' ? '' : d.sensors ? '있음' : '없음';
  }
}

function changeKind(d: SeqDevice, kind: DeviceKind): SeqDevice {
  if (d.kind === kind) return d;
  const oldDef = kindDefaults(d.kind);
  const def = kindDefaults(kind);
  const labelsDefault = d.fwdLabel === oldDef.fwdLabel && d.retLabel === oldDef.retLabel;
  const next: SeqDevice = { ...d, kind, ...(labelsDefault ? { fwdLabel: def.fwdLabel, retLabel: def.retLabel } : {}) };
  if (kind === 'motor') return { ...next, sensors: false, fwdTime: 0, retTime: 0 };
  if (d.kind === 'motor') return { ...next, sensors: def.sensors, fwdTime: def.fwdTime, retTime: def.retTime };
  return next;
}

function setDeviceCell(d: SeqDevice, col: string, text: string, warnings: string[], others: SeqDevice[]): SeqDevice {
  const t = text.trim();
  switch (col) {
    case 'name':
      if (!t) return d;
      if (others.some((o) => o.id !== d.id && norm(o.name) === norm(t))) warnings.push(`같은 이름의 기기 "${t}"가 이미 있습니다. 동작 순서에서 구분하려면 이름을 다르게 하세요.`);
      return { ...d, name: t };
    case 'kind': {
      const k = parseKind(t);
      if (!k) {
        if (t) warnings.push(`"${t}": 종류는 더블 SOL, 싱글 SOL, 모터, 흡착 중에서 적어 주세요.`);
        return d;
      }
      return changeKind(d, k);
    }
    case 'fwd':
      return t ? { ...d, fwdLabel: t } : d;
    case 'ret':
      return t ? { ...d, retLabel: t } : d;
    case 'fwdT':
    case 'retT': {
      if (!t) return d;
      const ms = parseSec(t);
      if (ms === null) {
        warnings.push(`"${t}": 시간은 초로 적어 주세요 (예: 0.5, 500ms).`);
        return d;
      }
      return col === 'fwdT' ? { ...d, fwdTime: ms } : { ...d, retTime: ms };
    }
    case 'sen': {
      const v = parseYesNo(t);
      if (v === null) {
        if (t) warnings.push(`"${t}": 끝 센서는 있음/없음 (O/X)으로 적어 주세요.`);
        return d;
      }
      return d.kind === 'motor' ? d : { ...d, sensors: v };
    }
  }
  return d;
}

/** 기기 표 칸 고치기. row 가 기기 수 이상이면 새 기기 */
export function editDevices(spec: SeqSpec, edits: CellEdit[]): EditResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  let devices = [...spec.devices];
  for (const [row, cells] of byRow(edits)) {
    if (row < devices.length) {
      let d = devices[row];
      for (const col of DEV_COLS) if (cells.has(col)) d = setDeviceCell(d, col, cells.get(col)!, warnings, devices);
      devices[row] = d;
      continue;
    }
    if ([...cells.values()].every((v) => !v.trim())) continue;
    const name = cells.get('name')?.trim() || `기기 ${devices.length + 1}`;
    const kind = parseKind(cells.get('kind') ?? '') ?? guessKind(name);
    let d = newDevice(kind, name);
    for (const col of DEV_COLS) if (col !== 'name' && col !== 'kind' && cells.has(col)) d = setDeviceCell(d, col, cells.get(col)!, warnings, devices);
    devices = [...devices, d];
  }
  return { spec: { ...spec, devices }, notes, warnings };
}

/** 기기를 지우면 그 기기의 동작과 I/O 수정도 지운다 */
export function removeDevices(spec: SeqSpec, rows: number[]): { spec: SeqSpec; removedActions: number } {
  const ids = new Set(rows.map((r) => spec.devices[r]?.id).filter(Boolean) as string[]);
  const actions = fixFirst(spec.actions.filter((a) => !ids.has(a.device)));
  const ioEdits = Object.fromEntries(Object.entries(spec.ioEdits).filter(([k]) => !ids.has(k.split(':')[0])));
  return { spec: { ...spec, devices: spec.devices.filter((d) => !ids.has(d.id)), actions, ioEdits }, removedActions: spec.actions.length - actions.length };
}

/** 동작 순서에 한 번도 안 나오는 기기 */
export function unusedDevices(spec: SeqSpec): SeqDevice[] {
  return spec.devices.filter((d) => !spec.actions.some((a) => a.device === d.id));
}

// ───────────────────────── 동작 순서 표 ─────────────────────────

/** 반대 동작 이름 */
const OPPOSITE: Record<string, string> = (() => {
  const o: Record<string, string> = {};
  const pairs: [string, string][] = [
    ...LABEL_PAIRS,
    ['열림', '닫힘'],
    ['오픈', '클로즈'],
    ['올림', '내림'],
    ['업', '다운'],
    ['진입', '후퇴'],
    ['회전', '복귀'],
    ['이송', '복귀'],
    ['푸시', '복귀'],
    ['척', '언척'],
    ['그립', '언그립'],
    ['ON', 'OFF'],
    ['운전', '정지'],
    ['정회전', '역회전'],
  ];
  for (const [a, b] of pairs) {
    o[a] ??= b;
    o[b] ??= a;
  }
  return o;
})();

const WAIT_RE = /^(대기|타이머|딜레이|wait|timer|delay)/i;

export function isWaitText(t: string): boolean {
  return WAIT_RE.test(t.trim());
}

export function parseWith(t: string): boolean {
  return /동시|같이|함께|병렬|with|parallel|together|^[=&]/i.test(t.trim());
}

/** 시작 칸의 지연: "+0.2", "뒤 0.5초", "동시 +300ms" → ms (없으면 0) */
export function parseDelay(t: string): number {
  const m = t.replace(',', '.').match(/(\d*\.?\d+)\s*(ms|msec|밀리초|s|sec|초)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = /^(ms|msec|밀리초)$/i.test(m[2] ?? '') ? n : n * 1000;
  return Math.round(ms);
}

/** 시작 칸 글자 */
export function startText(a: SeqAction, first: boolean, startButton: boolean): string {
  const base = first ? (startButton ? '시작 버튼' : '처음') : a.withPrev ? '앞 동작과 동시에' : '앞 동작이 끝난 뒤';
  return a.delay ? `${base} +${fmtSec(a.delay)}초` : base;
}

export type ActCol = 'step' | 'dev' | 'mot' | 'time' | 'start' | 'span';

function patchDevice(spec: SeqSpec, id: string, patch: Partial<SeqDevice>): SeqSpec {
  return { ...spec, devices: spec.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

/** 이름으로 기기 찾기 (없으면 만든다) */
export function ensureDevice(spec: SeqSpec, name: string, notes: string[]): { spec: SeqSpec; id: string } {
  const t = name.trim();
  const found = spec.devices.find((d) => d.name === t) ?? spec.devices.find((d) => norm(d.name) === norm(t));
  if (found) return { spec, id: found.id };
  const d = newDevice(guessKind(t), t);
  notes.push(`새 기기 "${t}"를 ② 동작 기기에 넣었습니다 (${KIND_LABEL[d.kind]}). 종류와 시간은 기기 표에서 고치세요.`);
  return { spec: { ...spec, devices: [...spec.devices, d] }, id: d.id };
}

/** 그 줄 앞까지 움직인 뒤 기기의 위치로 다음 동작 방향을 짐작 (간 상태면 돌아오기) */
function nextDir(spec: SeqSpec, id: string, before: number): 'fwd' | 'ret' {
  const last = spec.actions
    .slice(0, before)
    .filter((a) => a.device === id)
    .pop();
  return last?.dir === 'fwd' ? 'ret' : 'fwd';
}

/** 동작 이름 → 방향. 처음 쓰는 기기면 적은 이름을 그 기기의 동작 이름으로 삼는다 */
export function resolveMotion(spec: SeqSpec, id: string, text: string, row: number, warnings: string[]): { spec: SeqSpec; dir: 'fwd' | 'ret' } {
  const d = spec.devices.find((x) => x.id === id);
  const t = text.trim();
  if (!d || !t) return { spec, dir: d ? nextDir(spec, id, row) : 'fwd' };
  if (norm(t) === norm(d.fwdLabel)) return { spec, dir: 'fwd' };
  if (norm(t) === norm(d.retLabel)) return { spec, dir: 'ret' };
  if (/^(가기|fwd|forward|go|on|작동|운전|출발)$/i.test(t)) return { spec, dir: 'fwd' };
  if (/^(돌아오기|ret|return|back|off|원위치|복귀)$/i.test(t) && norm(d.fwdLabel) !== norm(t)) return { spec, dir: 'ret' };
  const def = kindDefaults(d.kind);
  const others = spec.actions.filter((a, k) => a.device === id && k !== row);
  const labelsDefault = d.fwdLabel === def.fwdLabel && d.retLabel === def.retLabel;
  if (labelsDefault && !others.length) return { spec: patchDevice(spec, id, { fwdLabel: t, retLabel: OPPOSITE[t] ?? '복귀' }), dir: 'fwd' };
  const retUsed = others.some((a) => a.dir === 'ret');
  if (!retUsed && (d.retLabel === '복귀' || d.retLabel === def.retLabel)) return { spec: patchDevice(spec, id, { retLabel: t }), dir: 'ret' };
  warnings.push(`"${t}": ${d.name}의 동작은 "${d.fwdLabel}" 또는 "${d.retLabel}"입니다.`);
  return { spec, dir: nextDir(spec, id, row) };
}

export interface ActionRecord {
  dev?: string;
  mot?: string;
  time?: string;
  start?: string;
  /** time 칸이 ms 단위 */
  ms?: boolean;
}

function setTime(spec: SeqSpec, a: SeqAction, text: string, ms: boolean | undefined, warnings: string[]): { spec: SeqSpec; a: SeqAction } {
  if (!text.trim()) return { spec, a };
  const v = parseSec(text, ms);
  if (v === null) {
    warnings.push(`"${text.trim()}": 시간은 초로 적어 주세요 (예: 0.5, 500ms).`);
    return { spec, a };
  }
  if (!a.device) return { spec, a: { ...a, wait: v } };
  return { spec: patchDevice(spec, a.device, a.dir === 'fwd' ? { fwdTime: v } : { retTime: v }), a };
}

/** 한 줄 기록 → 동작 (없는 기기는 만든다). "클램프 전진"처럼 한 칸에 적어도 나눈다. */
export function actionFromRecord(spec: SeqSpec, rec: ActionRecord, row: number, notes: string[], warnings: string[]): { spec: SeqSpec; action: SeqAction } | null {
  let dev = rec.dev?.trim() ?? '';
  let mot = rec.mot?.trim() ?? '';
  if (!dev && mot) {
    const w = mot.match(/^(대기|타이머|딜레이|wait|timer|delay)\s*[:：]?\s*(.*)$/i) ?? mot.match(/^()(.*?)\s*(?:대기|타이머)$/);
    if (w) {
      dev = '대기';
      mot = w[2].trim();
    } else {
      const hit = spec.devices
        .map((d) => d.name)
        .filter((n) => n && mot.startsWith(n) && mot.length > n.length)
        .sort((a, b) => b.length - a.length)[0];
      if (hit) {
        dev = hit;
        mot = mot.slice(hit.length).trim();
      } else {
        const k = mot.lastIndexOf(' ');
        if (k > 0) {
          dev = mot.slice(0, k).trim();
          mot = mot.slice(k + 1).trim();
        } else {
          dev = mot;
          mot = '';
        }
      }
    }
  }
  if (!dev && !mot && !rec.time?.trim()) return null;
  const withPrev = row > 0 && parseWith(rec.start ?? '');
  const delay = parseDelay(rec.start ?? '') || undefined;
  if (!dev || isWaitText(dev)) {
    let a = newAction({ device: '', wait: 1000, label: mot.replace(/^[:：]\s*/, ''), withPrev, delay });
    const r = setTime(spec, a, rec.time ?? '', rec.ms, warnings);
    a = r.a;
    return { spec: r.spec, action: a };
  }
  const e = ensureDevice(spec, dev, notes);
  let s = e.spec;
  const m = resolveMotion({ ...s, actions: [...s.actions.slice(0, row), newAction({ device: e.id })] }, e.id, mot, row, warnings);
  s = { ...m.spec, actions: s.actions };
  const a = newAction({ device: e.id, dir: m.dir, withPrev, delay });
  const r = setTime(s, a, rec.time ?? '', rec.ms, warnings);
  return { spec: r.spec, action: r.a };
}

/** 동작 순서 표 칸 고치기. row 가 동작 수 이상이면 새 줄 */
export function editActions(spec: SeqSpec, edits: CellEdit[]): EditResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  let s = spec;
  for (const [row, cells] of byRow(edits)) {
    if (row >= s.actions.length) {
      const r = actionFromRecord(s, { dev: cells.get('dev'), mot: cells.get('mot'), time: cells.get('time'), start: cells.get('start') }, s.actions.length, notes, warnings);
      if (r) s = { ...r.spec, actions: [...r.spec.actions, r.action] };
      continue;
    }
    let a = s.actions[row];
    const dev = cells.get('dev')?.trim();
    if (dev) {
      if (isWaitText(dev)) a = { ...a, device: '', label: a.device ? '' : a.label };
      else {
        const e = ensureDevice(s, dev, notes);
        s = e.spec;
        if (a.device !== e.id) a = { ...a, device: e.id, dir: cells.has('mot') ? a.dir : nextDir(s, e.id, row) };
      }
    }
    if (cells.has('mot')) {
      const t = cells.get('mot')!;
      if (!a.device) a = { ...a, label: t.trim().replace(/^(대기|타이머)\s*[:：]?\s*/, '') };
      else if (t.trim()) {
        const r = resolveMotion({ ...s, actions: s.actions.map((x, k) => (k === row ? a : x)) }, a.device, t, row, warnings);
        s = { ...r.spec, actions: s.actions };
        a = { ...a, dir: r.dir };
      }
    }
    if (cells.has('time')) {
      const r = setTime(s, a, cells.get('time')!, false, warnings);
      s = r.spec;
      a = r.a;
    }
    if (cells.has('start')) {
      const t = cells.get('start')!;
      a = { ...a, withPrev: row > 0 && parseWith(t), delay: parseDelay(t) || undefined };
    }
    s = { ...s, actions: s.actions.map((x, k) => (k === row ? a : x)) };
  }
  return { spec: { ...s, actions: fixFirst(s.actions) }, notes, warnings };
}

export function removeActions(spec: SeqSpec, rows: number[]): SeqSpec {
  const del = new Set(rows);
  return { ...spec, actions: fixFirst(spec.actions.filter((_, k) => !del.has(k))) };
}

export function moveAction(spec: SeqSpec, row: number, dir: -1 | 1): SeqSpec {
  return { ...spec, actions: fixFirst(moveItem(spec.actions, row, dir)) };
}

export function duplicateAction(spec: SeqSpec, row: number): SeqSpec {
  const a = spec.actions[row];
  if (!a) return spec;
  const actions = [...spec.actions];
  actions.splice(row + 1, 0, newAction({ ...a, id: undefined }));
  return { ...spec, actions };
}

type HeaderField = keyof ActionRecord | 'skip';

/** 엑셀 표 제목 줄 → 칸별 뜻. 제목 줄이 아니면 null */
export function detectActionHeader(row: string[]): { fields: HeaderField[]; ms: boolean } | null {
  let ms = false;
  const fields = row.map((c): HeaderField => {
    const s = c.toLowerCase();
    if (!s.trim()) return 'skip';
    if (/시간|time|\bsec\b|\bms\b|소요|\(s\)|\[s\]|\(초\)|\[초\]/.test(s)) {
      if (/\bms\b|msec|밀리/.test(s)) ms = true;
      return 'time';
    }
    if (/시작|조건|동시|병렬|start|구분|트리거/.test(s)) return 'start';
    if (/기기|장치|디바이스|device|유닛|unit|대상|기구|액추에이터|actuator/.test(s)) return 'dev';
    if (/동작|motion|action|내용|작업|operation/.test(s)) return 'mot';
    return 'skip';
  });
  const known = fields.filter((f) => f !== 'skip');
  if (known.length < 2 && !(row.length === 1 && known.length === 1)) return null;
  // 시간 칸에 숫자가 있으면 제목 줄이 아니다
  if (row.some((c, k) => fields[k] === 'time' && parseSec(c) !== null)) return null;
  return { fields, ms };
}

/** 제목 줄이 있는 표 붙여 넣기. 첫 줄에서 붙이면 동작 순서 전체를 바꾸고, 중간이면 그 자리부터 덮어쓴다 */
export function pasteActionTable(spec: SeqSpec, matrix: string[][], at: number): EditResult | null {
  const h = detectActionHeader(matrix[0] ?? []);
  if (!h) return null;
  const notes: string[] = [];
  const warnings: string[] = [];
  const recs: ActionRecord[] = matrix.slice(1).map((r) => {
    const rec: ActionRecord = { ms: h.ms };
    h.fields.forEach((f, k) => {
      if (f === 'skip' || f === 'ms') return;
      const v = r[k] ?? '';
      if (v) rec[f] = rec[f] ? `${rec[f]} ${v}` : v;
    });
    return rec;
  });
  const replaceAll = at === 0;
  const tail = replaceAll ? [] : spec.actions.slice(at + recs.length);
  let s: SeqSpec = { ...spec, actions: spec.actions.slice(0, Math.min(at, spec.actions.length)) };
  for (const rec of recs) {
    const r = actionFromRecord(s, rec, s.actions.length, notes, warnings);
    if (r) s = { ...r.spec, actions: [...r.spec.actions, r.action] };
  }
  const added = s.actions.length - Math.min(at, spec.actions.length);
  s = { ...s, actions: fixFirst([...s.actions, ...tail]) };
  notes.unshift(replaceAll ? `붙여 넣은 표로 동작 순서 ${added}줄을 만들었습니다.` : `동작 ${added}줄을 붙여 넣었습니다.`);
  return { spec: s, notes, warnings };
}

/** 기기 표 제목 줄 → 칸별 뜻 */
export function detectDeviceHeader(row: string[]): DevCol[] | null {
  const fields = row.map((c): DevCol | 'skip' => {
    const s = c.toLowerCase().replace(/\s+/g, '');
    if (!s) return 'skip';
    if (/센서|sensor|리드|근접/.test(s)) return 'sen';
    if (/종류|형식|타입|type|솔레노이드|sol$/.test(s)) return 'kind';
    const time = /시간|time|초|sec|\bms\b/.test(s);
    const back = /돌아|후진|상승|복귀|ret|back|언클램프|해제|닫/.test(s);
    if (time) return back ? 'retT' : 'fwdT';
    if (/동작/.test(s)) return back ? 'ret' : 'fwd';
    if (/기기|장치|디바이스|device|유닛|unit|이름|명칭|name|실린더/.test(s)) return 'name';
    return 'skip';
  });
  const known = fields.filter((f) => f !== 'skip');
  if (known.length < 2 || !known.includes('name')) return null;
  return fields.map((f) => (f === 'skip' ? ('' as DevCol) : f));
}

export function pasteDeviceTable(spec: SeqSpec, matrix: string[][], at: number): EditResult | null {
  const fields = detectDeviceHeader(matrix[0] ?? []);
  if (!fields) return null;
  const edits: CellEdit[] = [];
  matrix.slice(1).forEach((r, k) => {
    fields.forEach((f, c) => {
      if (f && r[c] !== undefined) edits.push({ row: at + k, col: f, text: r[c] });
    });
  });
  const r = editDevices(spec, edits);
  r.notes.unshift(`기기 ${matrix.length - 1}줄을 붙여 넣었습니다.`);
  return r;
}

// ───────────────────────── I/O 표 ─────────────────────────

/** I/O 리스트 붙여 넣기: 제목 줄(주소, 이름)이 있으면 이름으로 짝을 맞춰 주소를 넣는다 */
export function pasteIoTable(spec: SeqSpec, matrix: string[][]): EditResult | null {
  const head = matrix[0] ?? [];
  const ai = head.findIndex((c) => /주소|address|디바이스|device|접점|i\/?o/i.test(c));
  const ni = head.findIndex((c, k) => k !== ai && /이름|명칭|name|코멘트|comment|설명|신호/i.test(c));
  if (ai < 0 || ni < 0) return null;
  const io = ioPoints(spec);
  const notes: string[] = [];
  const warnings: string[] = [];
  const ioEdits = { ...spec.ioEdits };
  let matched = 0;
  const loose = (s: string) => norm(s).replace(/(sol|솔레노이드|밸브|센서|확인|lamp|단)$/i, '');
  const dirOf = (addr: string): 'in' | 'out' | null => (/^%?[xi]/i.test(addr) ? 'in' : /^%?[yq]/i.test(addr) ? 'out' : null);
  for (const r of matrix.slice(1)) {
    const addr = r[ai]?.trim();
    const name = r[ni]?.trim();
    if (!addr || !name) continue;
    const dir = dirOf(addr);
    const cand = io.filter((x) => !dir || x.dir === dir);
    const exact = cand.find((x) => norm(x.name) === norm(name));
    const near = cand.filter((x) => loose(x.name) === loose(name));
    const p = exact ?? (near.length === 1 ? near[0] : undefined);
    if (!p) continue;
    ioEdits[p.key] = { ...ioEdits[p.key], address: addr };
    matched++;
  }
  if (!matched) warnings.push('붙여 넣은 I/O 이름 중 이 설비의 I/O 와 같은 이름이 없습니다. 이름을 맞추거나 주소 칸에 차례로 붙여 넣으세요.');
  else notes.push(`I/O ${matched}개의 주소를 이름으로 찾아 넣었습니다.`);
  return { spec: { ...spec, ioEdits }, notes, warnings };
}
