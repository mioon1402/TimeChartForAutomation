import type { EdgeKind, Signal, SignalKind, WavePoint, WaveValue } from './types';

const EPS = 1e-6;

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

export function isHigh(v: WaveValue): boolean {
  return v === 1 || v === '1';
}

export function isLow(v: WaveValue): boolean {
  return v === 0 || v === '0';
}

export function sameValue(a: WaveValue, b: WaveValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < EPS;
  return String(a) === String(b);
}

/**
 * 정규화: 시간순 정렬, 같은 시각 중복 제거(나중 값 유지), t=0 시작점 보장,
 * (analog 이외) 같은 값의 연속 점 제거.
 */
export function normalize(points: WavePoint[], kind: SignalKind = 'bit', initial: WaveValue = 0): WavePoint[] {
  const sorted = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Number.isFinite(p.t))
    .sort((a, b) => a.p.t - b.p.t || a.i - b.i)
    .map(({ p }) => ({ ...p, t: Math.max(0, roundT(p.t)) }));

  const byTime: WavePoint[] = [];
  for (const p of sorted) {
    const last = byTime[byTime.length - 1];
    if (last && Math.abs(last.t - p.t) < EPS) byTime[byTime.length - 1] = p;
    else byTime.push(p);
  }
  if (byTime.length === 0 || byTime[0].t > EPS) {
    byTime.unshift({ t: 0, v: initial });
  }
  const out: WavePoint[] = [];
  for (const p of byTime) {
    const last = out[out.length - 1];
    if (last && kind !== 'analog' && sameValue(last.v, p.v)) continue;
    const q: WavePoint = { t: p.t, v: p.v };
    if (kind === 'bit' && p.ramp && p.ramp > 0 && out.length > 0) q.ramp = p.ramp;
    out.push(q);
  }
  out[0] = { t: 0, v: out[0].v };
  return out;
}

/** 부동소수 오차 정리 (0.001ms 단위) */
export function roundT(t: number): number {
  return Math.round(t * 1000) / 1000;
}

export function indexAt(points: WavePoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t + EPS) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 시각 t 에서의 값 (analog 는 선형 보간) */
export function valueAt(points: WavePoint[], t: number, kind: SignalKind = 'bit'): WaveValue {
  if (points.length === 0) return 0;
  const i = indexAt(points, t);
  const p = points[i];
  if (kind === 'analog' && i < points.length - 1) {
    const n = points[i + 1];
    const a = Number(p.v);
    const b = Number(n.v);
    if (Number.isFinite(a) && Number.isFinite(b) && n.t > p.t) {
      return a + ((b - a) * (t - p.t)) / (n.t - p.t);
    }
  }
  return p.v;
}

/** [t0, t1) 구간을 값 v 로 설정. t1 이후는 원래 값이 이어진다. */
export function setRange(
  points: WavePoint[],
  t0: number,
  t1: number,
  v: WaveValue,
  kind: SignalKind = 'bit',
  ramp?: number,
): WavePoint[] {
  if (t1 < t0) [t0, t1] = [t1, t0];
  if (t1 - t0 < EPS) return points;
  const after = valueAt(points, t1, kind === 'analog' ? 'bit' : kind);
  const atT1 = points.find((p) => Math.abs(p.t - t1) < EPS);
  const kept = points.filter((p) => p.t < t0 - EPS || p.t > t1 + EPS);
  const startPt: WavePoint = { t: t0, v };
  if (ramp && ramp > 0) startPt.ramp = ramp;
  const endPt: WavePoint = { t: t1, v: after };
  const endRamp = atT1?.ramp ?? ramp;
  if (endRamp && endRamp > 0) endPt.ramp = endRamp;
  return normalize([...kept, startPt, endPt], kind, points[0]?.v ?? 0);
}

/** 시각 t 이후 전체를 값 v 로 */
export function setFrom(points: WavePoint[], t: number, v: WaveValue, kind: SignalKind = 'bit', ramp?: number): WavePoint[] {
  const kept = points.filter((p) => p.t < t - EPS);
  const pt: WavePoint = { t, v };
  if (ramp && ramp > 0) pt.ramp = ramp;
  return normalize([...kept, pt], kind, points[0]?.v ?? 0);
}

export function invertBit(v: WaveValue): WaveValue {
  return isHigh(v) ? 0 : 1;
}

/** 비트 파형 반전 */
export function invertWave(points: WavePoint[]): WavePoint[] {
  return points.map((p) => ({ ...p, v: invertBit(p.v) }));
}

/** 한 전환(인덱스 i, i>=1)의 시각을 이동 - 앞뒤 전환 사이로 제한 */
export function moveEdge(points: WavePoint[], i: number, t: number, kind: SignalKind = 'bit'): WavePoint[] {
  if (i <= 0 || i >= points.length) return points;
  const prev = points[i - 1];
  const next = points[i + 1];
  const minT = prev.t;
  const maxT = next ? next.t : Number.POSITIVE_INFINITY;
  const nt = Math.min(Math.max(t, minT), maxT);
  const copy = points.map((p, j) => (j === i ? { ...p, t: nt } : p));
  return normalize(copy, kind, points[0].v);
}

/** 전환점 삭제 (이전 값이 이어짐) */
export function removePoint(points: WavePoint[], i: number, kind: SignalKind = 'bit'): WavePoint[] {
  if (i <= 0 || i >= points.length) return points;
  return normalize(
    points.filter((_, j) => j !== i),
    kind,
    points[0].v,
  );
}

export function setRamp(points: WavePoint[], i: number, ramp: number): WavePoint[] {
  return points.map((p, j) => {
    if (j !== i || j === 0) return p;
    const q: WavePoint = { t: p.t, v: p.v };
    if (ramp > 0) q.ramp = ramp;
    return q;
  });
}

/** at 시점에 dt 만큼 시간 삽입 (이후 전환이 뒤로 밀림) */
export function insertTime(points: WavePoint[], at: number, dt: number): WavePoint[] {
  return points.map((p) => (p.t >= at - EPS && p.t > 0 ? { ...p, t: roundT(p.t + dt) } : p));
}

/** [t0, t1) 구간 삭제 (이후 전환이 앞당겨짐) */
export function deleteTime(points: WavePoint[], t0: number, t1: number, kind: SignalKind = 'bit'): WavePoint[] {
  if (t1 < t0) [t0, t1] = [t1, t0];
  const dt = t1 - t0;
  const vAtT1 = valueAt(points, t1, kind === 'analog' ? 'bit' : kind);
  const before = points.filter((p) => p.t < t0 - EPS);
  const after = points.filter((p) => p.t >= t1 - EPS).map((p) => ({ ...p, t: roundT(p.t - dt) }));
  const bridge: WavePoint[] = after.length && Math.abs(after[0].t - t0) < EPS ? [] : [{ t: t0, v: vAtT1 }];
  return normalize([...before, ...bridge, ...after], kind, points[0]?.v ?? 0);
}

/** 시간 스케일 (factor 배) */
export function scaleTime(points: WavePoint[], factor: number): WavePoint[] {
  return points.map((p) => {
    const q: WavePoint = { t: roundT(p.t * factor), v: p.v };
    if (p.ramp) q.ramp = roundT(p.ramp * factor);
    return q;
  });
}

export function shiftWave(points: WavePoint[], dt: number, kind: SignalKind = 'bit'): WavePoint[] {
  const initial = points[0]?.v ?? 0;
  const moved = points.map((p, i) => (i === 0 ? p : { ...p, t: roundT(p.t + dt) }));
  return normalize(
    moved.filter((p) => p.t >= 0),
    kind,
    initial,
  );
}

/** 그리드에 스냅 */
export function snap(t: number, grid: number): number {
  if (!grid || grid <= 0) return roundT(t);
  return roundT(Math.round(t / grid) * grid);
}

export interface Edge {
  index: number;
  t: number;
  from: WaveValue;
  to: WaveValue;
  kind: EdgeKind | 'change';
  ramp: number;
}

export function edgesOf(points: WavePoint[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1].v;
    const to = points[i].v;
    let kind: Edge['kind'] = 'change';
    if (isLow(from) && isHigh(to)) kind = 'rise';
    else if (isHigh(from) && isLow(to)) kind = 'fall';
    out.push({ index: i, t: points[i].t, from, to, kind, ramp: points[i].ramp ?? 0 });
  }
  return out;
}

export function edgeTimes(points: WavePoint[], kind: EdgeKind | 'any'): number[] {
  return edgesOf(points)
    .filter((e) => kind === 'any' || e.kind === kind)
    .map((e) => e.t);
}

export interface Interval {
  start: number;
  end: number;
}

/** 값이 level(1 또는 0)인 구간 목록 (duration 에서 잘림) */
export function levelIntervals(points: WavePoint[], duration: number, level: 0 | 1 = 1): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t >= duration) break;
    const match = level === 1 ? isHigh(p.v) : isLow(p.v);
    if (!match) continue;
    const end = Math.min(i + 1 < points.length ? points[i + 1].t : duration, duration);
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - p.t) < EPS) last.end = end;
    else out.push({ start: p.t, end });
  }
  return out;
}

/** 클럭 신호의 파형 생성 */
export function clockPoints(sig: Pick<Signal, 'clockPeriod' | 'clockDuty' | 'clockPhase'>, duration: number): WavePoint[] {
  const period = Math.max(sig.clockPeriod ?? 100, 0.001);
  const duty = Math.min(Math.max(sig.clockDuty ?? 0.5, 0.01), 0.99);
  const phase = sig.clockPhase ?? 0;
  const pts: WavePoint[] = [{ t: 0, v: 0 }];
  const maxEdges = 20000;
  let n = 0;
  for (let t = phase; t < duration && n < maxEdges; t += period, n += 2) {
    if (t >= 0) pts.push({ t: roundT(t), v: 1 });
    const f = t + period * duty;
    if (f >= 0 && f < duration) pts.push({ t: roundT(f), v: 0 });
  }
  return normalize(pts, 'bit', 0);
}

/** 신호의 실제 파형 (클럭은 생성) */
export function effectivePoints(sig: Signal, duration: number): WavePoint[] {
  if (sig.kind === 'clock') return clockPoints(sig, duration);
  return sig.points;
}

/** 파형의 마지막 변화 시각 */
export function lastChange(points: WavePoint[]): number {
  if (points.length <= 1) return 0;
  const p = points[points.length - 1];
  return p.t + (p.ramp ?? 0);
}

/** 한 번에 여러 개의 [start,end) 펄스로 파형 생성 */
export function pulsesToPoints(pulses: Interval[], base: 0 | 1 = 0, ramp?: number): WavePoint[] {
  let pts: WavePoint[] = [{ t: 0, v: base }];
  for (const p of pulses) pts = setRange(pts, p.start, p.end, base === 0 ? 1 : 0, 'bit', ramp);
  return pts;
}
