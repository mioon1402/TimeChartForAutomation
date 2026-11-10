import type { TimeUnit } from './types';

function trimNum(n: number, maxDigits: number): string {
  if (!Number.isFinite(n)) return '-';
  const s = n.toFixed(maxDigits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

/** 하루 안의 시각 (ms) → "18:30" */
export function formatClock(ms: number): string {
  const m = Math.round((((ms % DAY) + DAY) % DAY) / MINUTE) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "18:30" → 하루 안의 시각 (ms) */
export function parseClock(s: string): number | null {
  const m = /^\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return (h % 24) * HOUR + min * MINUTE;
}

/** 시간 표시 (ms 기준 값을 단위에 맞게) */
export function formatTime(ms: number, unit: TimeUnit = 'auto', withUnit = true): string {
  if (!Number.isFinite(ms)) return '-';
  // 긴 시간 (타임 스위치의 하루 등): 시 · 분
  if (unit === 'h' || (unit === 'auto' && Math.abs(ms) >= HOUR)) return trimNum(ms / HOUR, 3) + (withUnit ? ' h' : '');
  if (unit === 'min') return trimNum(ms / MINUTE, 3) + (withUnit ? ' min' : '');
  const useS = unit === 's' || (unit === 'auto' && Math.abs(ms) >= 1000);
  if (useS) return trimNum(ms / 1000, 3) + (withUnit ? ' s' : '');
  return trimNum(ms, 2) + (withUnit ? ' ms' : '');
}

/**
 * 시간 문자열 해석 → ms
 * "500", "500ms", "1.5s", "2 s", "T#1s500ms", "S5T#2S", "1m30s", "90min", "6h", "100us"
 */
export function parseTime(input: string | number, defaultUnit: 'ms' | 's' | 'min' | 'h' = 'ms'): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim().toLowerCase().replace(/_/g, '');
  if (!s) return null;
  s = s.replace(/^(s5t|time|t|lt|ltime)#/, '');
  const plain = /^-?\d+(\.\d+)?$/.test(s);
  if (plain) {
    const n = parseFloat(s);
    return defaultUnit === 'h' ? n * HOUR : defaultUnit === 'min' ? n * MINUTE : defaultUnit === 's' ? n * 1000 : n;
  }
  const re = /(-?\d+(?:\.\d+)?)\s*(ms|us|ns|min|d|h|m|s)/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = parseFloat(m[1]);
    const u = m[2];
    const mult = u === 'ms' ? 1 : u === 'us' ? 0.001 : u === 'ns' ? 1e-6 : u === 's' ? 1000 : u === 'm' || u === 'min' ? 60000 : u === 'h' ? 3600000 : 86400000;
    total += n * mult;
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, '') !== s.replace(/\s/g, '')) return null;
  return total;
}

/** 1-2-5 계열로 적당한 눈금 간격 선택 */
export function niceStep(pxPerMs: number, minPx = 60): number {
  const raw = minPx / Math.max(pxPerMs, 1e-9);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

/** 눈금자: 큰 눈금 간격과 작은 눈금 간격 (시 · 분 단위는 15분 · 1시간 · 3시간 … 처럼 시계에 맞게) */
export function tickSteps(pxPerMs: number, unit: 'ms' | 's' | 'min' | 'h', minPx = 64): { major: number; minor: number } {
  if (unit === 'h' || unit === 'min') {
    // [큰 눈금 (분), 나누는 수]
    const table: [number, number][] = [
      [1, 4],
      [2, 4],
      [5, 5],
      [10, 5],
      [15, 3],
      [30, 6],
      [60, 4],
      [120, 4],
      [180, 3],
      [360, 6],
      [720, 4],
      [1440, 4],
      [2880, 2],
      [7200, 5],
    ];
    for (const [min, div] of table) if (min * MINUTE * pxPerMs >= minPx) return { major: min * MINUTE, minor: (min * MINUTE) / div };
  }
  const major = niceStep(pxPerMs, minPx);
  const div = major * pxPerMs >= 120 ? 10 : major * pxPerMs >= 50 ? 5 : 2;
  return { major, minor: major / div };
}

export function todayString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
