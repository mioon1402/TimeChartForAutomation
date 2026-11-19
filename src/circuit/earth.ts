import type { Circuit, Part, PartType } from './types';
import { partPins, REAL } from './parts';
import { systemVolts } from './supply';
import type { CircuitModel, Conductor } from './engine';
import { tr } from '../i18n';

/**
 * 누전 · 지락: 기기의 절연이 나빠져 충전부 (L) 가 외함에 닿았을 때 흐르는 전류를 어림한다.
 *  - 외함이 접지 (PE) 에 이어져 있으면 지락 전류가 접지로 흐른다
 *      TN (TN-C-S): 접지선이 변압기 중성점으로 돌아가 단락처럼 큰 전류 → 차단기 (MCB) 가 순시 트립
 *      TT: 기기 접지 저항 Ra + 계통 접지 저항 Rb 를 거쳐 작은 전류 (220 V / 110 Ω ≈ 2 A) → MCB 는 안 떨어지고
 *          외함에 Ra 만큼의 전압 (≈ 200 V) 이 남는다 → 누전차단기 (30 mA) 가 끊어야 한다
 *  - 외함이 접지되지 않았으면 전류가 흐르지 않다가, 사람이 만지면 몸 (약 1000 Ω) 을 거쳐 흐른다 (감전)
 *  - 누전차단기는 들어간 전류와 나온 전류의 차이 (접지로 샌 전류) 가 정격 감도 (30 mA) 이상이면 끊는다
 */

export type Earthing = 'TN' | 'TT';

/** 사람 몸의 저항 (손 → 발, 신발 포함 어림, Ω) — IEC 60479 의 220 V 부근 값 */
export const BODY_OHM = 1000;
/** TN 계통의 지락 고장 루프 임피던스 어림 (Ω): 변압기 + 상선 + 접지선 */
export const ZLOOP_TN = 0.4;
/** 접촉 전압 한도 (V): 이보다 높은 전압이 외함에 남으면 위험 (KEC 211.2) */
export const TOUCH_LIMIT = 50;
/** 감전 위험 전류 (mA): 이 이상이 몸으로 흐르면 심실세동 위험 */
export const BODY_LIMIT_MA = 30;

/** 누전이 날 수 있는 기기 (충전부와 외함이 있는 부하) */
export const FAULTABLE: ReadonlySet<PartType> = new Set(['r_motor3', 'r_motor6', 'motor3', 'motor', 'r_outlet', 'r_load1', 'r_load3', 'load', 'r_fan', 'r_light', 'r_smps', 'smps', 'r_sol', 'sol']);

/** 기기가 평상시 접지로 흘리는 누설 전류 어림 (mA): 전동기 · 케이블의 정전 용량, SMPS 의 노이즈 필터 */
export const LEAK_MA: Partial<Record<PartType, number>> = {
  r_motor3: 1,
  r_motor6: 1,
  motor3: 1,
  motor: 0.5,
  r_outlet: 1,
  r_load1: 0.5,
  r_load3: 1,
  load: 0.5,
  r_fan: 0.25,
  r_light: 0.25,
  r_smps: 0.75,
  smps: 0.75,
  r_sol: 0.1,
  sol: 0.1,
};

/** 계통 접지 방식과 접지 저항 */
export function earthingOf(c: Pick<Circuit, 'earthing' | 'ra' | 'rb'>): { kind: Earthing; ra: number; rb: number } {
  return { kind: c.earthing === 'TT' ? 'TT' : 'TN', ra: c.ra && c.ra > 0 ? c.ra : 100, rb: c.rb && c.rb > 0 ? c.rb : 10 };
}

/** 외함 접지 단자 (PE · FG) 의 차례, 없으면 -1 */
export function frameEarthPin(p: Part): number {
  return partPins(p).findIndex((d) => d.label === 'PE' || d.label === 'FG');
}

/** 충전부 단자 (접지 단자를 뺀 것) */
export function livePins(p: Part): number[] {
  return partPins(p)
    .map((d, i) => (d.label === 'PE' || d.label === 'FG' ? -1 : i))
    .filter((i) => i >= 0);
}

/** 차단기 (과전류 · 누전) 인가 */
export const isProtector = (p: Part) => p.type === 'r_mcb1' || p.type === 'r_mcb2' || p.type === 'r_mcb3' || p.type === 'r_mcb4' || p.type === 'mcb' || p.type === 'mcb3';

/** 누전차단기 정격 감도 전류 (A) */
export const idnOf = (p: Part) => (p.idn && p.idn > 0 ? p.idn : 30) / 1000;

/** 차단기 정격 전류 (A): 속성, 사양 글, 없으면 20 A */
function ampsOf(p: Part): number {
  if (p.amps && p.amps > 0) return p.amps;
  const m = /(\d+(?:\.\d+)?)\s*A\b/i.exec(p.spec ?? '');
  return m ? Number(m[1]) : 20;
}

/** 순시 트립 전류: 정격의 10 배 (C 형 특성의 위쪽 끝) */
export const instantTrip = (p: Part) => 10 * ampsOf(p);

export interface FaultResult {
  /** 대지 전압 (V): 고장 난 상의 상전압 */
  u0: number;
  /** 외함이 접지에 이어져 있는가 */
  earthed: boolean;
  /** 절연 저항 (Ω) */
  rf: number;
  /** 접지로 흐르는 지락 전류 (A). 외함이 접지되지 않았으면 0 */
  ifA: number;
  /** 외함 전압 = 사람이 만지면 걸리는 전압 (V) */
  touchV: number;
  /** 접지되지 않은 외함을 사람이 만지면 몸으로 흐르는 전류 (mA) */
  bodyMa: number | null;
  /** 지락 전류로 끊는 차단기 (가장 가까운 것) 와 이유 */
  trip: { part: Part; why: 'rcd' | 'oc' } | null;
  /** 접지되지 않은 외함: 사람이 만졌을 때 끊는 누전차단기 */
  touchTrip: Part | null;
  /** ok = 차단기가 끊음, leak = 새지만 위험하지 않음, danger = 외함에 위험한 전압이 남거나 감전 */
  level: 'ok' | 'leak' | 'danger';
}

/**
 * 지락 계산. path = 고장 난 기기에서 전원 쪽으로 지나는 차단기 (가까운 것부터)
 */
export function earthFault(u0: number, earthed: boolean, rf: number, cfg: { kind: Earthing; ra: number; rb: number }, path: Part[]): FaultResult {
  rf = Math.max(0, rf);
  if (u0 <= 0) return { u0, earthed, rf, ifA: 0, touchV: 0, bodyMa: null, trip: null, touchTrip: null, level: 'ok' };
  if (earthed) {
    const tn = cfg.kind === 'TN';
    const ifA = tn ? u0 / (rf + ZLOOP_TN) : u0 / (rf + cfg.ra + cfg.rb);
    // 외함 전압: TN 은 접지선 몫 (루프의 절반 어림), TT 는 기기 접지 저항 Ra 에 걸리는 전압
    const touchV = tn ? (ifA * ZLOOP_TN) / 2 : ifA * cfg.ra;
    let trip: FaultResult['trip'] = null;
    for (const p of path) {
      if (p.elb && ifA >= idnOf(p)) trip = { part: p, why: 'rcd' };
      else if (ifA >= instantTrip(p)) trip = { part: p, why: 'oc' };
      if (trip) break;
    }
    const level = trip ? 'ok' : touchV > TOUCH_LIMIT ? 'danger' : 'leak';
    return { u0, earthed, rf, ifA, touchV, bodyMa: null, trip, touchTrip: null, level };
  }
  // 접지 안 된 외함: 만지면 몸 → 대지 → 계통 접지 (Rb) 로 돌아간다
  const ib = u0 / (rf + BODY_OHM + cfg.rb);
  const touchV = ib * BODY_OHM;
  const touchTrip = path.find((p) => p.elb && ib >= idnOf(p)) ?? null;
  const bodyMa = ib * 1000;
  const level = touchV <= TOUCH_LIMIT && bodyMa < BODY_LIMIT_MA ? 'leak' : touchTrip ? 'ok' : 'danger';
  return { u0, earthed, rf, ifA: 0, touchV, bodyMa, trip: null, touchTrip, level };
}

/** 고장 결과를 한 줄 글로 */
export function faultText(name: string, r: FaultResult, cfg: { kind: Earthing; ra: number; rb: number }): string {
  const a = (x: number) => (x >= 1 ? `${x.toFixed(x >= 100 ? 0 : 1)} A` : `${(x * 1000).toFixed(x * 1000 >= 10 ? 0 : 1)} mA`);
  const sys = cfg.kind === 'TN' ? 'TN' : `TT, Ra ${cfg.ra} Ω · Rb ${cfg.rb} Ω`;
  const ins = r.rf > 0 ? tr(` (절연 저항 ${r.rf >= 1000 ? `${r.rf / 1000} kΩ` : `${r.rf} Ω`})`, ` (insulation ${r.rf >= 1000 ? `${r.rf / 1000} kΩ` : `${r.rf} Ω`})`) : '';
  if (r.u0 <= 0) return tr(`${name} 누전${ins}: 지금은 전원이 없어 흐르지 않습니다`, `${name} earth fault${ins}: not energised now`);
  if (r.earthed) {
    const head = tr(`${name} 누전${ins} → 접지로 ${a(r.ifA)} (${sys})`, `${name} earth fault${ins} → ${a(r.ifA)} to earth (${sys})`);
    if (r.trip) return `${head}, ${r.trip.why === 'rcd' ? tr(`누전차단기 ${r.trip.part.tag} 트립 (감도 ${Math.round(idnOf(r.trip.part) * 1000)} mA)`, `RCD ${r.trip.part.tag} trips (${Math.round(idnOf(r.trip.part) * 1000)} mA)`) : tr(`차단기 ${r.trip.part.tag} 순시 트립 (정격의 10 배 이상)`, `breaker ${r.trip.part.tag} trips instantly`)}`;
    if (r.level === 'danger') return tr(`${head}. 차단기가 떨어지지 않아 외함에 약 ${Math.round(r.touchV)} V 가 계속 남습니다 (위험: ${TOUCH_LIMIT} V 넘음) → 누전차단기가 필요합니다`, `${head}; no breaker trips and about ${Math.round(r.touchV)} V stays on the frame (danger) — an RCD is needed`);
    return tr(`${head}. 누전차단기 감도보다 작아 끊지 않습니다 (외함 ${r.touchV.toFixed(1)} V). 절연 저항을 재 보세요`, `${head}; below the RCD sensitivity, nothing trips (frame ${r.touchV.toFixed(1)} V)`);
  }
  const head = tr(`${name} 누전${ins}: 외함이 접지되지 않아 외함에 약 ${Math.round(r.touchV)} V. 사람이 만지면 몸으로 약 ${Math.round(r.bodyMa ?? 0)} mA`, `${name} earth fault${ins}: frame not earthed, about ${Math.round(r.touchV)} V on it; a person touching it takes about ${Math.round(r.bodyMa ?? 0)} mA`);
  if (r.level === 'leak') return `${head} ${tr('(위험하지 않은 크기)', '(not dangerous)')}`;
  if (r.touchTrip) return tr(`${head} → 누전차단기 ${r.touchTrip.tag} 가 그때 끊습니다 (0.03 초 안에). 외함을 접지하세요`, `${head} → RCD ${r.touchTrip.tag} would trip then; earth the frame`);
  return tr(`${head} (감전 위험: 끊는 누전차단기가 없음) → 외함을 접지 (PE) 하고 누전차단기를 다세요`, `${head} (electric shock: nothing trips) — earth the frame and add an RCD`);
}

/** 넷마다 이어진 접점 (전원 쪽으로 길 찾기용) */
export function conductorGraph(conductors: Conductor[]): Map<number, Conductor[]> {
  const adj = new Map<number, Conductor[]>();
  for (const k of conductors) {
    if (k.plcOut !== undefined) continue;
    adj.set(k.a, [...(adj.get(k.a) ?? []), k]);
    adj.set(k.b, [...(adj.get(k.b) ?? []), k]);
  }
  return adj;
}

/**
 * 기기 단자에서 전원 (상) 까지 닫힌 접점을 따라가는 가장 짧은 길과 그 위의 차단기 (기기에서 가까운 것부터).
 * 길이 없으면 null
 */
export function feedPath(adj: Map<number, Conductor[]>, from: number[], sources: Map<number, string>, closed: (k: Conductor) => boolean): { phase: string; protectors: Part[] } | null {
  const prev = new Map<number, { net: number; k: Conductor } | null>();
  const queue: number[] = [];
  for (const n of from) {
    if (prev.has(n)) continue;
    prev.set(n, null);
    queue.push(n);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    const ph = sources.get(n);
    if (ph) {
      const protectors: Part[] = [];
      for (let cur = prev.get(n); cur; cur = prev.get(cur.net)) if (isProtector(cur.k.part) && !protectors.includes(cur.k.part)) protectors.push(cur.k.part);
      // 거꾸로 모았으니 (전원 쪽부터) 뒤집어 기기에서 가까운 것부터
      return { phase: ph, protectors: protectors.reverse() };
    }
    for (const k of adj.get(n) ?? []) {
      if (!closed(k)) continue;
      const m = k.a === n ? k.b : k.a;
      if (prev.has(m)) continue;
      prev.set(m, { net: n, k });
      queue.push(m);
    }
  }
  return null;
}

/** 상의 대지 전압 (상전압) */
export function phaseVolt(c: Pick<Circuit, 'system' | 'vll'>, phase: string): number {
  const ph = systemVolts(c).phasor[phase];
  return ph ? Math.hypot(ph[0], ph[1]) : 0;
}

/** 전원 넷 → 상 (L1 L2 L3). 변압기 2차도 */
export function phaseSources(model: CircuitModel): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of model.sources) if (s.id === 'L1' || s.id === 'L2' || s.id === 'L3') m.set(s.net, s.id);
  for (const t of model.trList) t.x.forEach((n, k) => m.set(n, ['L1', 'L2', 'L3'][k]));
  return m;
}

/** 외함이 접지 (PE) 에 이어져 있는가: 접지 단자가 있으면 그 넷이 PE 전원과 (선 · 단자대 · 바로) 이어지는가, 기호 그림은 접지를 그리지 않으므로 이어진 것으로 본다 */
export function frameEarthed(model: CircuitModel, p: Part, peNets: Set<number>): boolean {
  const i = frameEarthPin(p);
  if (i < 0) return !REAL.has(p.type);
  const n = model.net.pinNet.get(`${p.id}:${i}`);
  return n !== undefined && peNets.has(n);
}

/** PE 전원과 (늘 통하는 단자대 · 바로) 이어진 넷 */
export function peNetsOf(model: CircuitModel): Set<number> {
  const pe = new Set(model.sources.filter((s) => s.id === 'PE').map((s) => s.net));
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of model.conductors) {
      if (!k.always) continue;
      if (pe.has(k.a) !== pe.has(k.b)) {
        pe.add(k.a);
        pe.add(k.b);
        grew = true;
      }
    }
  }
  return pe;
}

export interface EarthRow {
  part: Part;
  name: string;
  /** 지락 계산 (완전 지락, 절연 저항 0 Ω) */
  r: FaultResult;
  /** 지나는 차단기 (기기에서 가까운 것부터) */
  protectors: Part[];
  text: string;
}

export interface EarthStudy {
  kind: Earthing;
  ra: number;
  rb: number;
  rows: EarthRow[];
  /** 누전차단기마다 평상시 누설 전류 합계 (mA) 와 그 아래 기기 */
  leaks: { part: Part; ma: number; idnMa: number; devices: string[] }[];
}

/**
 * 지락 검토 (시뮬레이션 없이): 모든 접점이 닫혔다고 보고, 누전이 날 수 있는 기기마다 완전 지락이면
 * 접지로 얼마가 흐르고 외함에 몇 V 가 남는지, 어느 차단기가 끊는지. 누전차단기마다 평상시 누설 전류 합계
 */
export function earthStudy(c: Circuit, model: CircuitModel): EarthStudy {
  const cfg = earthingOf(c);
  const adj = conductorGraph(model.conductors);
  const src = phaseSources(model);
  const pe = peNetsOf(model);
  const rows: EarthRow[] = [];
  const leakBy = new Map<string, { part: Part; ma: number; devices: string[] }>();
  for (const p of c.parts) {
    if (!FAULTABLE.has(p.type)) continue;
    const nets = livePins(p)
      .map((i) => model.net.pinNet.get(`${p.id}:${i}`))
      .filter((n): n is number => n !== undefined);
    const path = feedPath(adj, nets, src, () => true);
    if (!path) continue;
    const name = p.tag.trim() || p.type;
    const r = earthFault(phaseVolt(c, path.phase), frameEarthed(model, p, pe), 0, cfg, path.protectors);
    rows.push({ part: p, name, r, protectors: path.protectors, text: faultText(name, r, cfg) });
    for (const q of path.protectors) {
      if (!q.elb) continue;
      const e = leakBy.get(q.id) ?? { part: q, ma: 0, devices: [] };
      e.ma += LEAK_MA[p.type] ?? 0.5;
      e.devices.push(name);
      leakBy.set(q.id, e);
    }
  }
  const leaks = [...leakBy.values()].map((e) => ({ ...e, ma: Math.round(e.ma * 100) / 100, idnMa: Math.round(idnOf(e.part) * 1000) }));
  return { ...cfg, rows, leaks };
}
