import type { EdgeKind, Project, Signal, Step, TimingRule } from './types';
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
