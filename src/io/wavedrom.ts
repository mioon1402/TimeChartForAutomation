import type { Annotation, Project, Signal, SignalKind, WavePoint, WaveValue } from '../model/types';
import { createProject, createSignal, PALETTE } from '../model/project';
import { normalize, uid, valueAt, effectivePoints, isHigh } from '../model/wave';
import { parseLooseJson } from './json5';

interface WdSignal {
  name?: string;
  wave?: string;
  data?: string[] | string;
  period?: number;
  phase?: number;
  node?: string;
}

const CLOCK_CHARS = new Set(['p', 'P', 'n', 'N']);
const DATA_CHARS = new Set(['=', '2', '3', '4', '5', '6', '7', '8', '9']);

function flatten(items: unknown[], group: string, out: { sig: WdSignal; group: string }[]) {
  for (const it of items) {
    if (Array.isArray(it)) {
      const [label, ...rest] = it;
      const g = typeof label === 'string' ? (group ? `${group}/${label}` : label) : group;
      flatten(typeof label === 'string' ? rest : it, g, out);
    } else if (it && typeof it === 'object') {
      const s = it as WdSignal;
      if (s.wave !== undefined || s.name !== undefined) out.push({ sig: s, group });
    }
  }
}

/** WaveDrom wave 문자열 → 파형 */
export function waveToPoints(sig: WdSignal, tick: number): { kind: SignalKind; points: WavePoint[]; clockPeriod?: number } {
  const wave = (sig.wave ?? '').replace(/\s/g, '');
  const period = (sig.period ?? 1) * tick;
  const phase = (sig.phase ?? 0) * tick;
  const data = Array.isArray(sig.data) ? sig.data : typeof sig.data === 'string' ? sig.data.split(/\s+/) : [];
  const chars = [...wave].filter((c) => c !== '|');
  const isClockOnly = chars.length > 0 && chars.every((c) => CLOCK_CHARS.has(c) || c === '.') && CLOCK_CHARS.has(chars[0]);
  const isBus = chars.some((c) => DATA_CHARS.has(c));
  if (isClockOnly && !isBus && new Set(chars.filter((c) => c !== '.')).size === 1) {
    return { kind: 'clock', points: [{ t: 0, v: 0 }], clockPeriod: period };
  }
  const kind: SignalKind = isBus ? 'bus' : 'bit';
  const pts: WavePoint[] = [];
  let di = 0;
  let prev = '';
  chars.forEach((c0, i) => {
    let c = c0;
    const t = i * period - phase;
    if (c === '.') {
      if (!CLOCK_CHARS.has(prev)) return;
      c = prev;
    }
    prev = c;
    const push = (tt: number, v: WaveValue) => pts.push({ t: Math.max(0, tt), v });
    if (CLOCK_CHARS.has(c)) {
      const first = c === 'p' || c === 'P' ? 1 : 0;
      push(t, kind === 'bus' ? String(first) : first);
      push(t + period / 2, kind === 'bus' ? String(1 - first) : 1 - first);
      return;
    }
    let v: WaveValue;
    if (DATA_CHARS.has(c)) v = data[di++] ?? '';
    else if (c === '1' || c === 'h' || c === 'H' || c === 'u') v = kind === 'bus' ? '1' : 1;
    else if (c === '0' || c === 'l' || c === 'L' || c === 'd') v = kind === 'bus' ? '0' : 0;
    else if (c === 'z') v = 'z';
    else v = 'x';
    // 같은 데이터 값이 연속으로 나오면 경계를 보존하기 위해 전환 표시
    if (kind === 'bus' && DATA_CHARS.has(c) && pts.length && pts[pts.length - 1].v === v) v = `${v}​`;
    push(t, v);
  });
  if (!pts.length) pts.push({ t: 0, v: kind === 'bus' ? 'x' : 0 });
  return { kind, points: normalize(pts, kind, pts[0].v) };
}

export interface WaveDromImportResult {
  project: Project;
  warnings: string[];
}

/** WaveDrom 소스 → 프로젝트 */
export function importWaveDrom(src: string, tick = 100): WaveDromImportResult {
  const warnings: string[] = [];
  const raw = parseLooseJson(src) as { signal?: unknown[]; head?: { text?: unknown }; edge?: string[] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.signal)) throw new Error('WaveDrom 형식이 아닙니다 ("signal" 배열 없음)');
  const flat: { sig: WdSignal; group: string }[] = [];
  flatten(raw.signal, '', flat);
  const project = createProject();
  let maxLen = 0;
  const nodes = new Map<string, { signalId: string; t: number }>();
  project.signals = flat.map(({ sig, group }, i) => {
    const { kind, points, clockPeriod } = waveToPoints(sig, tick);
    const len = [...(sig.wave ?? '')].filter((c) => c !== '|').length * (sig.period ?? 1);
    maxLen = Math.max(maxLen, len);
    const s: Signal = createSignal({
      name: sig.name ?? `signal${i + 1}`,
      kind,
      role: 'other',
      color: PALETTE[i % PALETTE.length],
      points,
      group: group || undefined,
    });
    if (kind === 'clock') s.clockPeriod = clockPeriod;
    if (sig.node) {
      [...sig.node].forEach((ch, k) => {
        if (ch !== '.' && ch !== ' ') nodes.set(ch, { signalId: s.id, t: k * (sig.period ?? 1) * tick });
      });
    }
    return s;
  });
  project.settings = { ...project.settings, duration: Math.max(maxLen * tick, tick), grid: tick };
  const head = raw.head?.text;
  if (typeof head === 'string') project.meta.title = head;
  else if (Array.isArray(head)) project.meta.title = head.filter((x) => typeof x === 'string').join(' ');
  if (Array.isArray(raw.edge)) {
    for (const e of raw.edge) {
      const m = /^\s*(\S)\s*([-~|<>]+)\s*(\S)\s*(.*)$/.exec(String(e));
      if (!m) continue;
      const a = nodes.get(m[1]);
      const b = nodes.get(m[3]);
      if (!a || !b) {
        warnings.push(`엣지 "${e}" 의 노드를 찾을 수 없습니다`);
        continue;
      }
      const reversed = m[2].startsWith('<') && !m[2].endsWith('>');
      const ann: Annotation = {
        id: uid('ann'),
        type: 'arrow',
        from: reversed ? b : a,
        to: reversed ? a : b,
        label: m[4].trim(),
        dashed: m[2].includes('~'),
      };
      project.annotations.push(ann);
    }
  }
  return { project, warnings };
}

/** 프로젝트 → WaveDrom JSON (tick 단위로 샘플링) */
export function exportWaveDrom(project: Project, tick = project.settings.grid): { source: string; warnings: string[] } {
  const warnings: string[] = [];
  const d = project.settings.duration;
  const n = Math.max(1, Math.ceil(d / tick - 1e-9));
  if (n > 400) warnings.push(`틱 수가 ${n}개로 많습니다. 그리드를 늘리면 WaveDrom 에서 보기 좋습니다.`);
  const visible = project.signals.filter((s) => !s.hidden);
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nodeMap = new Map<string, string[]>(); // signalId → node 문자열 배열
  const edges: string[] = [];
  let li = 0;
  const nodeAt = (signalId: string, t: number): string | null => {
    if (li >= letters.length) return null;
    const idx = Math.min(n - 1, Math.max(0, Math.round(t / tick)));
    let arr = nodeMap.get(signalId);
    if (!arr) {
      arr = Array(n).fill('.');
      nodeMap.set(signalId, arr);
    }
    if (arr[idx] !== '.') return arr[idx];
    arr[idx] = letters[li++];
    return arr[idx];
  };
  for (const a of project.annotations) {
    if (a.type !== 'arrow') continue;
    const x = nodeAt(a.from.signalId, a.from.t);
    const y = nodeAt(a.to.signalId, a.to.t);
    if (x && y) edges.push(`${x}${a.dashed ? '~>' : '->'}${y}${a.label ? ' ' + a.label : ''}`);
  }
  let misaligned = 0;
  const toWd = (s: Signal): WdSignal => {
    const label = s.address ? `${s.name} (${s.address})` : s.name;
    if (s.kind === 'clock') {
      const per = (s.clockPeriod ?? tick) / tick;
      const cycles = Math.max(1, Math.round(d / (s.clockPeriod ?? tick)));
      const out: WdSignal = { name: label, wave: 'p' + '.'.repeat(cycles - 1) };
      if (per !== 1) out.period = per;
      return out;
    }
    const pts = effectivePoints(s, d);
    for (const p of pts) if (Math.abs(p.t / tick - Math.round(p.t / tick)) > 1e-6) misaligned++;
    let wave = '';
    const data: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const t = i * tick;
      const v = valueAt(pts, t + 1e-6, s.kind);
      let key: string;
      let ch: string;
      if (s.kind === 'bit') {
        ch = isHigh(v) ? '1' : v === 'x' ? 'x' : v === 'z' ? 'z' : '0';
        key = ch;
      } else {
        const sv = s.kind === 'analog' ? String(Math.round(Number(v) * 100) / 100) : String(v).replace(/​/g, '');
        key = `=${sv}`;
        ch = sv === 'x' ? 'x' : sv === 'z' ? 'z' : '=';
        // 버스 값 변화 경계를 보존
        const idx = pts.findIndex((p) => p.t > t - tick + 1e-6 && p.t <= t + 1e-6 && p.t > 0);
        if (idx >= 0 && prev === key && i > 0) prev = null;
      }
      if (key === prev) wave += '.';
      else {
        wave += ch;
        if (ch === '=') data.push(key.slice(1));
      }
      prev = key;
    }
    const out: WdSignal = { name: label, wave };
    if (data.length) out.data = data;
    const node = nodeMap.get(s.id);
    if (node) out.node = node.join('').replace(/\.+$/, '');
    return out;
  };

  const signal: unknown[] = [];
  let curGroup: string | undefined;
  let bucket: unknown[] | null = null;
  for (const s of visible) {
    const g = s.group || undefined;
    if (g !== curGroup) {
      if (bucket) signal.push(bucket);
      bucket = g ? [g] : null;
      curGroup = g;
    }
    if (bucket) bucket.push(toWd(s));
    else signal.push(toWd(s));
  }
  if (bucket) signal.push(bucket);
  if (misaligned) warnings.push(`그리드(${tick}ms)에 맞지 않는 전환 ${misaligned}개는 가까운 틱으로 표시됩니다.`);
  const obj: Record<string, unknown> = { signal, head: { text: project.meta.title, tick: 0 }, config: { hscale: 1 } };
  if (edges.length) obj.edge = edges;
  return { source: stringifyWaveDrom(obj), warnings };
}

/** 한 신호를 한 줄에 쓰는 보기 좋은 JSON */
function stringifyWaveDrom(obj: Record<string, unknown>): string {
  const line = (v: unknown) => JSON.stringify(v);
  const sig = obj.signal as unknown[];
  const body = sig
    .map((s) => {
      if (Array.isArray(s)) return `    [${line(s[0])},\n${s.slice(1).map((x) => `      ${line(x)}`).join(',\n')}\n    ]`;
      return `    ${line(s)}`;
    })
    .join(',\n');
  const rest = Object.entries(obj)
    .filter(([k]) => k !== 'signal')
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${line(v)}`)
    .join(',\n');
  return `{\n  "signal": [\n${body}\n  ],\n${rest}\n}\n`;
}
