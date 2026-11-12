import type { Circuit, PowerSystem } from './types';
import { tr } from '../i18n';

/**
 * 전원 계통 (그림 하나에 하나): 어느 극이 있고 극마다 전압 · 위상이 어떤가.
 *  - 3상 4선식: L1 · L2 · L3 는 120° 차, N 은 중성점. 선간 = 상전압 × √3 (380/220 V)
 *  - 3상 3선식: L1 · L2 · L3 만 (N 없음). 단상 부하는 두 상 사이 (선간 전압)
 *  - 단상 3선식: L1 · L2 는 반대 위상 (180°), N 은 가운데. L1-L2 = L-N × 2 (220/110 V)
 *  - 단상 2선식: L · N 만
 * `Circuit.vll` 은 계통의 대표 전압이다: 3상은 선간, 단상 3선식은 L1-L2, 단상 2선식은 L-N.
 */

export const POWER_SYSTEMS: PowerSystem[] = ['3p4w', '3p3w', '1p3w', '1p2w'];

/** 계통에 있는 교류 극 */
export const SYSTEM_POLES: Record<PowerSystem, readonly string[]> = {
  '3p4w': ['L1', 'L2', 'L3', 'N'],
  '3p3w': ['L1', 'L2', 'L3'],
  '1p3w': ['L1', 'L2', 'N'],
  '1p2w': ['L1', 'N'],
};

const AC = new Set(['L1', 'L2', 'L3', 'N']);

export function systemOf(c: Pick<Circuit, 'system'>): PowerSystem {
  return c.system && POWER_SYSTEMS.includes(c.system) ? c.system : '3p4w';
}

/** 전압을 적지 않았을 때의 대표 전압 */
export function defaultVolt(s: PowerSystem): number {
  return s === '1p3w' || s === '1p2w' ? 220 : 380;
}

/** 그 극이 이 계통에 있는가 (직류 · PE 는 늘 있음) */
export function poleLive(c: Pick<Circuit, 'system'>, id: string): boolean {
  return !AC.has(id) || SYSTEM_POLES[systemOf(c)].includes(id);
}

export interface SystemVolts {
  system: PowerSystem;
  /** 두 상 사이 전압 (단상 2선식은 L-N) */
  vll: number;
  /** 상과 N 사이 전압 (3상 3선식은 N 이 없어서 가상 중성점 기준) */
  vln: number;
  /** 단상 부하가 보통 받는 전압 (정격 전류 어림에 씀) */
  v1: number;
  three: boolean;
  /** 극마다 전압 (복소수 [실수, 허수]). 계통에 없는 극은 빠진다 */
  phasor: Record<string, [number, number]>;
}

export function systemVolts(c: Pick<Circuit, 'system' | 'vll'>): SystemVolts {
  const system = systemOf(c);
  const set = c.vll && c.vll > 0 ? c.vll : null;
  const dc: Record<string, [number, number]> = { PE: [0, 0], '+24V': [24, 0], '0V': [0, 0] };
  const s = Math.sqrt(3) / 2;
  if (system === '1p3w') {
    const vll = set ?? 220;
    const v = vll / 2;
    return { system, vll, vln: v, v1: vll, three: false, phasor: { L1: [v, 0], L2: [-v, 0], N: [0, 0], ...dc } };
  }
  if (system === '1p2w') {
    const v = set ?? 220;
    return { system, vll: v, vln: v, v1: v, three: false, phasor: { L1: [v, 0], N: [0, 0], ...dc } };
  }
  // 3상: 3상 4선식에서 전압을 적지 않으면 상전압 220 V 기준 (선간 381 V, 공칭 380 V)
  const vln = set ? set / Math.sqrt(3) : system === '3p4w' ? 220 : 380 / Math.sqrt(3);
  const vll = vln * Math.sqrt(3);
  const phasor: Record<string, [number, number]> = { L1: [vln, 0], L2: [-vln / 2, -vln * s], L3: [-vln / 2, vln * s], ...dc };
  if (system === '3p4w') phasor.N = [0, 0];
  return { system, vll, vln, v1: system === '3p4w' ? vln : vll, three: true, phasor };
}

/** 공칭값으로 적기 (220 × √3 = 381 → 380) */
export function nominalVolt(v: number): number {
  for (const n of [24, 110, 127, 220, 254, 380, 440, 480]) if (Math.abs(v - n) <= n * 0.005) return n;
  return Math.round(v);
}

export function systemName(s: PowerSystem): string {
  return s === '3p4w' ? tr('3상 4선식', '3-phase 4-wire') : s === '3p3w' ? tr('3상 3선식', '3-phase 3-wire') : s === '1p3w' ? tr('단상 3선식', '1-phase 3-wire') : tr('단상 2선식', '1-phase 2-wire');
}

/** '3상 4선식 380/220 V' */
export function systemLabel(sv: SystemVolts): string {
  const ll = nominalVolt(sv.vll);
  const ln = nominalVolt(sv.vln);
  const v = sv.system === '3p4w' || sv.system === '1p3w' ? `${ll}/${ln} V` : sv.system === '1p2w' ? `${ln} V` : `${ll} V`;
  return `${systemName(sv.system)} ${v}`;
}

/** 극 사이 전압을 풀어 적은 설명 */
export function systemVoltText(sv: SystemVolts): string {
  const ll = nominalVolt(sv.vll);
  const ln = nominalVolt(sv.vln);
  switch (sv.system) {
    case '3p4w':
      return tr(`L1-L2 · L2-L3 · L3-L1 = ${ll} V, L-N = ${ln} V (Y 결선: 상전압 = 선간 ÷ √3)`, `L-L ${ll} V, L-N ${ln} V (star: phase = line ÷ √3)`);
    case '3p3w':
      return tr(`L1-L2 · L2-L3 · L3-L1 = ${ll} V. 중성선 (N) 이 없어서 단상 부하는 두 상 사이 (${ll} V) 에 겁니다`, `L-L ${ll} V. No neutral: single-phase loads go between two lines (${ll} V)`);
    case '1p3w':
      return tr(`L1-N · L2-N = ${ln} V, L1-L2 = ${ll} V (L1 · L2 는 반대 위상, N 은 가운데)`, `L1-N and L2-N ${ln} V, L1-L2 ${ll} V (L1 and L2 in opposite phase, N in the middle)`);
    case '1p2w':
      return tr(`L-N = ${ln} V`, `L-N ${ln} V`);
  }
}

/** 대표 전압 칸의 이름 */
export function voltFieldLabel(s: PowerSystem): string {
  return s === '1p3w' ? tr('L1-L2 전압 (V)', 'L1-L2 voltage (V)') : s === '1p2w' ? tr('전압 L-N (V)', 'Voltage L-N (V)') : tr('선간 전압 (V)', 'Line voltage (V)');
}

export interface SupplyProblem {
  level: 'error' | 'warn';
  msg: string;
  partIds: string[];
}

const THREE_PHASE = new Set(['motor3', 'r_motor3', 'r_load3']);

/** 계통과 맞지 않는 전원 단자 · 기기 */
export function supplyProblems(c: Circuit): SupplyProblem[] {
  const sys = systemOf(c);
  const label = systemLabel(systemVolts(c));
  const out: SupplyProblem[] = [];
  const byPole = new Map<string, string[]>();
  for (const p of c.parts) {
    const poles = p.type === 'src' || p.type === 'r_term' ? [p.pole === 'L' || !p.pole ? 'L1' : p.pole] : p.type === 'src3' ? ['L1', 'L2', 'L3'] : [];
    for (const id of poles) if (!poleLive(c, id)) byPole.set(id, [...(byPole.get(id) ?? []), p.id]);
  }
  for (const [pole, ids] of byPole)
    out.push({
      level: 'error',
      msg:
        pole === 'N' && sys === '3p3w'
          ? tr('N 단자: 3상 3선식에는 중성선이 없어서 N 에 이은 부하는 동작하지 않습니다. 단상 부하는 두 상 사이 (L1-L2 등) 에 잇거나, 전원 계통을 3상 4선식으로 바꾸세요', 'N terminal: a 3-phase 3-wire system has no neutral. Connect single-phase loads between two lines, or switch to 3-phase 4-wire')
          : tr(`${pole} 단자: ${label} 에는 ${pole} 이 없어서 전압이 나오지 않습니다. 전원 단자의 속성에서 계통을 바꾸세요`, `${pole} terminal: ${label} has no ${pole}; change the supply system in the terminal properties`),
      partIds: ids,
    });
  if (sys === '1p3w' || sys === '1p2w') {
    const ids = c.parts.filter((p) => THREE_PHASE.has(p.type)).map((p) => p.id);
    if (ids.length) out.push({ level: 'warn', msg: tr(`단상 계통 (${label}) 에서는 3상 전동기 · 부하가 돌지 않습니다`, `3-phase motors and loads do not run on ${label}`), partIds: ids });
  }
  return out;
}
