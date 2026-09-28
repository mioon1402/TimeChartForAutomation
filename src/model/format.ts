import type { TimeUnit } from './types';

function trimNum(n: number, maxDigits: number): string {
  if (!Number.isFinite(n)) return '-';
  const s = n.toFixed(maxDigits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 시간 표시 (ms 기준 값을 단위에 맞게) */
export function formatTime(ms: number, unit: TimeUnit = 'auto', withUnit = true): string {
  if (!Number.isFinite(ms)) return '-';
  const useS = unit === 's' || (unit === 'auto' && Math.abs(ms) >= 1000);
  if (useS) return trimNum(ms / 1000, 3) + (withUnit ? ' s' : '');
  return trimNum(ms, 2) + (withUnit ? ' ms' : '');
}

/**
 * 시간 문자열 해석 → ms
 * "500", "500ms", "1.5s", "2 s", "T#1s500ms", "S5T#2S", "1m30s", "100us"
 */
export function parseTime(input: string | number, defaultUnit: 'ms' | 's' = 'ms'): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim().toLowerCase().replace(/_/g, '');
  if (!s) return null;
  s = s.replace(/^(s5t|time|t|lt|ltime)#/, '');
  const plain = /^-?\d+(\.\d+)?$/.test(s);
  if (plain) {
    const n = parseFloat(s);
    return defaultUnit === 's' ? n * 1000 : n;
  }
  const re = /(-?\d+(?:\.\d+)?)\s*(ms|us|ns|d|h|m|s)/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = parseFloat(m[1]);
    const u = m[2];
    const mult = u === 'ms' ? 1 : u === 'us' ? 0.001 : u === 'ns' ? 1e-6 : u === 's' ? 1000 : u === 'm' ? 60000 : u === 'h' ? 3600000 : 86400000;
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
