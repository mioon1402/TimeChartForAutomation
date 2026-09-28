import type { EdgeKind, Project, Signal, Step, TimingRule, WavePoint } from './types';
import { createStep, STEP_COLORS } from './project';
import { edgeTimes, effectivePoints, lastChange, levelIntervals, type Interval } from './wave';
import { formatTime } from './format';

export interface SignalStats {
  onCount: number;
  onTotal: number;
  firstOn: number | null;
  lastOff: number | null;
  minOn: number | null;
  maxOn: number | null;
  avgOn: number | null;
  duty: number;
  changes: number;
}

export function signalStats(sig: Signal, duration: number): SignalStats {
  const pts = effectivePoints(sig, duration);
  const on = sig.kind === 'bit' || sig.kind === 'clock' ? levelIntervals(pts, duration, 1) : [];
  const widths = on.map((i) => i.end - i.start);
  const onTotal = widths.reduce((a, b) => a + b, 0);
  const falls = edgeTimes(pts, 'fall').filter((t) => t <= duration);
  return {
    onCount: on.length,
    onTotal,
    firstOn: on.length ? on[0].start : null,
    lastOff: falls.length ? falls[falls.length - 1] : null,
    minOn: widths.length ? Math.min(...widths) : null,
    maxOn: widths.length ? Math.max(...widths) : null,
    avgOn: widths.length ? onTotal / widths.length : null,
    duty: duration > 0 ? onTotal / duration : 0,
    changes: Math.max(0, pts.filter((p) => p.t < duration).length - 1),
  };
}

export interface DelayMeasure {
  from: number;
  to: number | null;
  delay: number | null;
}

/** from 신호의 각 에지 → 이후 처음 나타나는 to 신호 에지까지의 지연 */
export function measureDelays(
  project: Project,
  fromId: string,
  fromEdge: EdgeKind,
  toId: string,
  toEdge: EdgeKind,
): DelayMeasure[] {
  const d = project.settings.duration;
  const a = project.signals.find((s) => s.id === fromId);
  const b = project.signals.find((s) => s.id === toId);
  if (!a || !b) return [];
  const fromTimes = edgeTimes(effectivePoints(a, d), fromEdge).filter((t) => t <= d);
  const toTimes = edgeTimes(effectivePoints(b, d), toEdge).filter((t) => t <= d);
  return fromTimes.map((f) => {
    const hit = toTimes.find((t) => t >= f - 1e-6 && !(a.id === b.id && t === f));
    return { from: f, to: hit ?? null, delay: hit !== undefined ? hit - f : null };
  });
}

export interface Violation {
  t0: number;
  t1: number;
  message: string;
  signalIds: string[];
}

export interface RuleResult {
  rule: TimingRule;
  status: 'ok' | 'fail' | 'na';
  measured: string;
  violations: Violation[];
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].start, b[j].start);
    const e = Math.min(a[i].end, b[j].end);
    if (e > s + 1e-6) out.push({ start: s, end: e });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

export function sigLabel(s: Signal | undefined): string {
  if (!s) return '?';
  return s.address ? `${s.name}(${s.address})` : s.name;
}

export function checkRule(project: Project, rule: TimingRule): RuleResult {
  const d = project.settings.duration;
  const unit = project.settings.timeUnit;
  const find = (id: string) => project.signals.find((s) => s.id === id);
  const fmt = (t: number) => formatTime(t, unit);

  switch (rule.type) {
    case 'delay': {
      const a = find(rule.fromSignal);
      const b = find(rule.toSignal);
      if (!a || !b) return { rule, status: 'na', measured: '-', violations: [] };
      const ms = measureDelays(project, a.id, rule.fromEdge, b.id, rule.toEdge);
      if (ms.length === 0) return { rule, status: 'na', measured: '에지 없음', violations: [] };
      const violations: Violation[] = [];
      for (const m of ms) {
        if (m.delay === null) {
          violations.push({ t0: m.from, t1: d, message: `${fmt(m.from)}: ${sigLabel(b)} 응답 없음`, signalIds: [a.id, b.id] });
        } else if ((rule.min !== undefined && m.delay < rule.min) || (rule.max !== undefined && m.delay > rule.max)) {
          violations.push({
            t0: m.from,
            t1: m.to!,
            message: `${fmt(m.from)}: 지연 ${fmt(m.delay)} (허용 ${rule.min !== undefined ? fmt(rule.min) : '-'} ~ ${rule.max !== undefined ? fmt(rule.max) : '-'})`,
            signalIds: [a.id, b.id],
          });
        }
      }
      const delays = ms.filter((m) => m.delay !== null).map((m) => m.delay!) as number[];
      const measured = delays.length
        ? delays.length === 1
          ? fmt(delays[0])
          : `${fmt(Math.min(...delays))} ~ ${fmt(Math.max(...delays))}`
        : '응답 없음';
      return { rule, status: violations.length ? 'fail' : 'ok', measured, violations };
    }
    case 'exclusive': {
      const a = find(rule.a);
      const b = find(rule.b);
      if (!a || !b) return { rule, status: 'na', measured: '-', violations: [] };
      const ia = levelIntervals(effectivePoints(a, d), d, 1);
      const ib = levelIntervals(effectivePoints(b, d), d, 1);
      const both = intersect(ia, ib);
      return {
        rule,
        status: both.length ? 'fail' : 'ok',
        measured: both.length ? `동시 ON ${both.length}회` : '동시 ON 없음',
        violations: both.map((iv) => ({
          t0: iv.start,
          t1: iv.end,
          message: `${fmt(iv.start)} ~ ${fmt(iv.end)}: ${sigLabel(a)} / ${sigLabel(b)} 동시 ON`,
          signalIds: [a.id, b.id],
        })),
      };
    }
    case 'pulse': {
      const s = find(rule.signal);
      if (!s) return { rule, status: 'na', measured: '-', violations: [] };
      // 차트 시작/끝에 걸친 구간은 완전한 펄스가 아니므로 제외
      const ivs = levelIntervals(effectivePoints(s, d), d, rule.level).filter((iv) => iv.start > 0 && iv.end < d);
      if (!ivs.length) return { rule, status: 'na', measured: '펄스 없음', violations: [] };
      const violations: Violation[] = [];
      for (const iv of ivs) {
        const w = iv.end - iv.start;
        if ((rule.min !== undefined && w < rule.min) || (rule.max !== undefined && w > rule.max)) {
          violations.push({ t0: iv.start, t1: iv.end, message: `${fmt(iv.start)}: 폭 ${fmt(w)}`, signalIds: [s.id] });
        }
      }
      const ws = ivs.map((iv) => iv.end - iv.start);
      const measured = ws.length === 1 ? fmt(ws[0]) : `${fmt(Math.min(...ws))} ~ ${fmt(Math.max(...ws))}`;
      return { rule, status: violations.length ? 'fail' : 'ok', measured, violations };
    }
    case 'cycle': {
      const c = cycleSummary(project);
      const ok = c.total <= rule.max;
      return {
        rule,
        status: ok ? 'ok' : 'fail',
        measured: fmt(c.total),
        violations: ok ? [] : [{ t0: c.start, t1: c.end, message: `사이클 ${fmt(c.total)} > 목표 ${fmt(rule.max)}`, signalIds: [] }],
      };
    }
  }
}

export function checkRules(project: Project): RuleResult[] {
  return project.rules.map((r) => checkRule(project, r));
}

export interface CycleSummary {
  start: number;
  end: number;
  total: number;
  basis: 'steps' | 'activity';
  steps: { step: Step; duration: number; share: number }[];
  longest: Step | null;
}

/** 사이클 타임 요약: 스텝이 있으면 스텝 기준, 없으면 신호 변화 구간 기준 */
export function cycleSummary(project: Project): CycleSummary {
  const steps = [...project.steps].sort((a, b) => a.start - b.start);
  if (steps.length) {
    const start = Math.min(...steps.map((s) => s.start));
    const end = Math.max(...steps.map((s) => s.end));
    const total = end - start;
    const rows = steps.map((s) => ({ step: s, duration: s.end - s.start, share: total > 0 ? (s.end - s.start) / total : 0 }));
    const longest = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.duration > m.duration ? r : m), null);
    return { start, end, total, basis: 'steps', steps: rows, longest: longest?.step ?? null };
  }
  const d = project.settings.duration;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const s of project.signals) {
    if (s.kind === 'clock') continue;
    const pts = s.points;
    if (pts.length > 1) {
      start = Math.min(start, pts[1].t);
      end = Math.max(end, Math.min(lastChange(pts), d));
    }
  }
  if (!Number.isFinite(start)) start = 0;
  return { start, end: Math.max(end, start), total: Math.max(0, end - start), basis: 'activity', steps: [], longest: null };
}

export interface SeqEvent {
  t: number;
  signal: Signal;
  /** bit: ON/OFF, bus: 새 값 */
  kind: 'on' | 'off' | 'value';
  value: string;
  /** 직전 이벤트부터 걸린 시간 */
  dt: number | null;
  step: Step | null;
}

/** 동작 순서표: 모든 신호 변화를 시간 순으로 (디지털 ON/OFF, 워드 값 변화) */
export function sequenceEvents(project: Project, include: (s: Signal) => boolean = () => true): SeqEvent[] {
  const d = project.settings.duration;
  const steps = [...project.steps].sort((a, b) => a.start - b.start);
  // 꺼지는 변화는 그 순간 끝나는 스텝에 속함 (BACK 이 꺼지면서 BACK 스텝이 끝남)
  const stepAt = (t: number, off = false) =>
    (off ? steps.find((s) => t > s.start + 1e-9 && t <= s.end + 1e-9) : undefined) ?? steps.find((s) => t >= s.start - 1e-9 && t < s.end - 1e-9) ?? null;
  const raw: Omit<SeqEvent, 'dt'>[] = [];
  project.signals.forEach((s) => {
    if (s.hidden || s.kind === 'analog' || s.kind === 'clock' || !include(s)) return;
    const pts = effectivePoints(s, d);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.t <= 0 || p.t > d) continue;
      if (s.kind === 'bit') {
        const on = p.v === 1 || p.v === '1';
        const wasOn = pts[i - 1].v === 1 || pts[i - 1].v === '1';
        if (on === wasOn || p.v === 'x') continue;
        raw.push({ t: p.t, signal: s, kind: on ? 'on' : 'off', value: on ? s.onLabel || 'ON' : s.offLabel || 'OFF', step: stepAt(p.t, !on) });
      } else {
        raw.push({ t: p.t, signal: s, kind: 'value', value: String(p.v), step: stepAt(p.t) });
      }
    }
  });
  const order = new Map(project.signals.map((s, i) => [s.id, i]));
  // 같은 시각이면 꺼짐(끝나는 스텝) → 켜짐(시작하는 스텝) 순
  const rank = (e: Omit<SeqEvent, 'dt'>) => (e.kind === 'off' ? 0 : 1);
  raw.sort((a, b) => a.t - b.t || rank(a) - rank(b) || order.get(a.signal.id)! - order.get(b.signal.id)!);
  let prev: number | null = null;
  return raw.map((e) => {
    const dt = prev === null ? null : e.t - prev;
    prev = e.t;
    return { ...e, dt };
  });
}

/** 입출력(실제 I/O·설비) 신호만 */
export function isIoSignal(s: Signal): boolean {
  return s.role === 'input' || s.role === 'output' || s.role === 'sensor' || s.role === 'actuator';
}

/** 공정 스텝을 만들 출력 한 개 */
export interface OutputTrack {
  id: string;
  points: WavePoint[];
  name: string;
  address?: string;
  /** 0 = 동작 출력 (전진/후진, 정/역), 1 = 속도 선택 출력, 없음 = 그 밖 */
  rank?: 0 | 1;
}

/** 표시등, 부저 같은 알림 출력 */
const INDICATOR_RE = /램프|LAMP|RUNLA|LED|부저|BUZZ|\bBZ\b|경광|표시등|\bPL\d*\b/i;

/**
 * 출력 조합 → 공정 스텝: "지금 어떤 출력이 켜져 있나" 가 바뀔 때마다 스텝을 나눈다.
 *  - 뺀다: 한 번도 안 켜진 출력, 대부분 켜져 있는 출력(전원 MC 등), 깜빡이는 출력,
 *          램프·부저, 도중에 켜져서 끝까지 유지되는 상태 출력 (단, 설비 모델의 동작 출력은 항상 사용)
 *  - 아주 짧은 구간(브레이크가 모터보다 먼저 풀리는 등)은 옆의 긴 구간에 합친다
 *  - 스텝 이름은 동작 출력 → 속도 출력 → 설명 있는 출력 순으로 두 개까지, 아무것도 없으면 "대기"
 */
export function stepsFromOutputs(tracks: OutputTrack[], until: number): Step[] {
  if (until <= 0) return [];
  const eps = 1e-9;
  const info = new Map<string, { total: number; on: Interval[] }>();
  const used = tracks.filter((tr) => {
    const on = levelIntervals(tr.points, until, 1);
    const total = on.reduce((a, iv) => a + iv.end - iv.start, 0);
    info.set(tr.id, { total, on });
    if (total <= 0) return false;
    if (tr.rank !== undefined) return true;
    if (total > until * 0.6) return false;
    if (on.length > 12 && total / on.length < until / 50) return false; // 깜빡임
    if (INDICATOR_RE.test(tr.name)) return false;
    const last = on[on.length - 1];
    if (on.length === 1 && last.start > eps && last.end >= until - eps) return false; // 켜진 뒤 끝까지 유지 = 상태
    return true;
  });
  if (!used.length) return [];
  const times = new Set<number>([0]);
  for (const tr of used) for (const iv of info.get(tr.id)!.on) for (const t of [iv.start, iv.end]) if (t > 0 && t < until) times.add(t);
  const cuts = [...times].sort((a, b) => a - b);
  const onAt = (tr: OutputTrack, t: number) => info.get(tr.id)!.on.find((iv) => t >= iv.start - eps && t < iv.end - eps);
  const commented = (tr: OutputTrack) => !!tr.name && tr.name !== tr.address && tr.name !== tr.id;

  const labelOf = (on: OutputTrack[], t: number): string => {
    if (!on.length) return '대기';
    const key = (tr: OutputTrack) => [tr.rank ?? 2, commented(tr) ? 0 : 1, onAt(tr, t)?.start ?? 0, info.get(tr.id)!.total];
    const sorted = [...on].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    let pick = sorted.filter((tr) => tr.rank !== undefined);
    if (!pick.length) pick = sorted.filter(commented);
    if (!pick.length) pick = sorted;
    return pick
      .slice(0, 2)
      .map((tr) => tr.name || tr.id)
      .join(' + ');
  };

  interface Seg {
    start: number;
    end: number;
    on: OutputTrack[];
    label: string;
  }
  let segs: Seg[] = cuts.map((t, i) => {
    const on = used.filter((tr) => onAt(tr, t));
    return { start: t, end: cuts[i + 1] ?? until, on, label: labelOf(on, t) };
  });
  const mergeSame = () => {
    const out: Seg[] = [];
    for (const sg of segs) {
      const last = out[out.length - 1];
      if (last && last.label === sg.label) {
        last.end = sg.end;
        for (const tr of sg.on) if (!last.on.includes(tr)) last.on.push(tr);
      } else out.push({ ...sg, on: [...sg.on] });
    }
    segs = out;
  };
  mergeSame();
  // 짧은 구간은 더 긴 이웃에 흡수
  const minLen = until * 0.012;
  for (let guard = 0; guard < 1000 && segs.length > 1; guard++) {
    let k = -1;
    for (let i = 0; i < segs.length; i++) {
      const len = segs[i].end - segs[i].start;
      if (len < minLen && (k < 0 || len < segs[k].end - segs[k].start)) k = i;
    }
    if (k < 0) break;
    const prev = segs[k - 1];
    const next = segs[k + 1];
    // 출력이 꺼지는 중이면 앞 스텝, 켜지는 중이면 뒤 스텝, 아니면 더 긴 쪽에 붙인다
    const sub = (a: Seg, b: Seg | undefined) => !!b && b.on.length > 0 && a.on.every((tr) => b.on.includes(tr));
    const into = !prev ? next : !next ? prev : sub(segs[k], prev) ? prev : sub(segs[k], next) ? next : next.end - next.start >= prev.end - prev.start ? next : prev;
    into.start = Math.min(into.start, segs[k].start);
    into.end = Math.max(into.end, segs[k].end);
    for (const tr of segs[k].on) if (!into.on.includes(tr)) into.on.push(tr);
    segs.splice(k, 1);
    mergeSame();
  }
  // 처음과 끝의 대기 구간은 사이클에 넣지 않음
  while (segs.length > 1 && !segs[0].on.length) segs.shift();
  while (segs.length > 1 && !segs[segs.length - 1].on.length) segs.pop();
  return segs.map((sg, i) => {
    const description = sg.on.length ? sg.on.map((tr) => [tr.address, commented(tr) ? tr.name : ''].filter(Boolean).join(' ') || tr.id).join(', ') + ' ON' : '출력 없음';
    return createStep({ label: sg.label, start: sg.start, end: sg.end, description, color: STEP_COLORS[i % STEP_COLORS.length] });
  });
}
