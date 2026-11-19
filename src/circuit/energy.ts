import type { Circuit, Part } from './types';
import type { ScenarioResult, Track } from './engine';
import { loadRating } from './power';

/** 전력량 단가 기본값 (원/kWh): 2025년 산업용 평균 판매단가 어림 (보도 기준). 계약 종별 · 계절 · 시간대 요금으로 바꿔 쓴다 */
export const DEFAULT_PRICE = 182;

export interface EnergyRow {
  tag: string;
  name: string;
  parts: Part[];
  /** 들어가는 전력 (kW, 전동기는 효율로 나눈 값) */
  kw: number;
  /** 켜져 있던 시간 (ms) */
  onMs: number;
  kwh: number;
  /** 전력량 요금 (원) */
  cost: number;
}

export interface EnergyUse {
  /** 계산한 구간 (ms) */
  period: number;
  /** 하루 (타임 스위치가 있어 24시간을 돌린 것) 인가 */
  day: boolean;
  price: number;
  basePrice: number;
  /** 계약 전력 (kW) */
  contractKw: number;
  rows: EnergyRow[];
  kwh: number;
  cost: number;
  /** 하루 기준이면 한 달 (30일) 어림: 전력량 · 전력량 요금 · 기본요금 */
  month: { kwh: number; energy: number; base: number; total: number } | null;
}

const isOn = (v: number | string) => v !== 0 && v !== '0' && v !== '';

/** 기록 (계단 값) 에서 켜져 있던 시간 */
function onTime(tr: Track, end: number): number {
  let total = 0;
  const pts = tr.points.filter((p) => p.t <= end + 1e-9);
  for (let i = 0; i < pts.length; i++) {
    if (!isOn(pts[i].v)) continue;
    const next = i + 1 < pts.length ? pts[i + 1].t : end;
    total += Math.max(0, Math.min(next, end) - pts[i].t);
  }
  return total;
}

/**
 * 시뮬레이션 기록으로 부하마다 켜져 있던 시간 → 전력량 (kWh) → 요금 (원).
 * 온도 조절처럼 켜졌다 꺼졌다 하는 것도 실제 켜진 시간만큼만 센다
 */
export function energyUse(c: Circuit, res: ScenarioResult): EnergyUse {
  const price = c.price !== undefined && c.price >= 0 ? c.price : DEFAULT_PRICE;
  const basePrice = c.basePrice && c.basePrice > 0 ? c.basePrice : 0;
  const end = res.end;
  const rows: EnergyRow[] = [];
  for (const [tag, ids] of res.model.loadParts) {
    const parts = ids.map((id) => c.parts.find((p) => p.id === id)).filter((p): p is Part => !!p);
    const kw = parts.reduce((s, p) => s + (loadRating(p)?.w ?? 0), 0) / 1000;
    if (kw <= 0) continue;
    const tr = res.tracks.find((t) => (t.kind === 'load' || t.kind === 'motor' || t.kind === 'coil' || t.kind === 'timerCoil') && t.key.slice(t.key.indexOf(':') + 1) === tag);
    if (!tr) continue;
    const onMs = onTime(tr, end);
    const kwh = (kw * onMs) / 3.6e6;
    rows.push({ tag: res.model.label(tag), name: parts.find((p) => p.name)?.name ?? '', parts, kw, onMs, kwh, cost: kwh * price });
  }
  rows.sort((a, b) => b.kwh - a.kwh || b.kw - a.kw);
  const kwh = rows.reduce((s, r) => s + r.kwh, 0);
  const cost = kwh * price;
  // 계약 전력: 비우면 부하 설비 합 (kW, 1 kW 미만은 반올림, 최소 1 kW)
  const contractKw = c.contractKw && c.contractKw > 0 ? c.contractKw : Math.max(1, Math.round(rows.reduce((s, r) => s + r.kw, 0)));
  const day = res.model.tswDef.size > 0 && Math.abs(end - 86400000) < 1000;
  const month = day ? { kwh: kwh * 30, energy: cost * 30, base: basePrice * contractKw, total: cost * 30 + basePrice * contractKw } : null;
  return { period: end, day, price, basePrice, contractKw, rows, kwh, cost, month };
}
