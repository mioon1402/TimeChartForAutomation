/**
 * I/O 매핑 추적: 실제 입력(P, X)을 M 릴레이로 복사해서 쓰는 프로그램에서
 * "이 M 은 사실 어느 입력인가" 를 찾아낸다.
 *
 *   LOAD P00019 / OUT M00629                    → M00629 = P00019
 *   LOAD M00629 / AND M00667 / OUT M00440       → M00440 = M00629 (M00667 이 항상 ON 이면)
 *   LOAD NOT P00040 / OUT M00631                → M00631 = NOT P00040
 *
 * 한 번만 쓰이는 코일이고, 추가 조건이 전부 "항상 ON" 인 단순 복사 렁만 매핑으로 본다.
 */
import type { Instr, PlcDialect } from './types';
import { isConstant, specialBit } from './devices';

export interface Alias {
  /** 최종 원본 디바이스 (보통 실제 입력) */
  source: string;
  /** 원본을 반전해서 받는가 */
  invert: boolean;
  /** 원본 → … → 이 디바이스 까지 거친 디바이스 (원본 제외, 자기 자신 포함) */
  chain: string[];
}

interface CopyRung {
  src: string;
  neg: boolean;
  gates: { dev: string; neg: boolean }[];
  dests: string[];
}

/** 명령 목록에서 단순 복사 렁 찾기: LD a [AND g]* OUT d [OUT d2]* */
function findCopyRungs(instrs: Instr[]): CopyRung[] {
  const out: CopyRung[] = [];
  for (let i = 0; i < instrs.length; i++) {
    const I = instrs[i];
    if (I.op !== 'LD' || I.cmp || I.edge) continue;
    const prev = instrs[i - 1];
    // 렁의 시작이어야 함 (앞 명령이 출력류이거나 처음)
    if (prev && !['OUT', 'SET', 'RST', 'PLS', 'PLF', 'TMR', 'CTU', 'CTD', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'INC', 'DEC', 'MC', 'MCR', 'END', 'JMP', 'ALT', 'ZRST', 'FMOV'].includes(prev.op)) continue;
    const gates: CopyRung['gates'] = [];
    let j = i + 1;
    while (j < instrs.length && instrs[j].op === 'AND' && !instrs[j].cmp && !instrs[j].edge) {
      gates.push({ dev: instrs[j].args[0], neg: !!instrs[j].neg });
      j++;
    }
    const dests: string[] = [];
    while (j < instrs.length && instrs[j].op === 'OUT' && !instrs[j].neg) {
      dests.push(instrs[j].args[0]);
      j++;
    }
    if (!dests.length) continue;
    // 렁이 여기서 끝나야 함 (다음이 새 렁의 LD 이거나 끝)
    const next = instrs[j];
    if (next && next.op !== 'LD' && next.op !== 'END' && next.op !== 'STL' && next.op !== 'RET') continue;
    out.push({ src: I.args[0], neg: !!I.neg, gates, dests });
  }
  return out;
}

/** 쓰기(코일) 횟수 */
function writeCounts(instrs: Instr[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const I of instrs) {
    if (['OUT', 'SET', 'RST', 'PLS', 'PLF', 'ALT', 'MOV', 'TMR', 'CTU', 'CTD'].includes(I.op)) {
      const d = I.op === 'MOV' ? I.args[1] : I.args[0];
      if (d) m.set(d, (m.get(d) ?? 0) + 1);
    }
  }
  return m;
}

export function resolveAliases(instrs: Instr[], dialect: PlcDialect): Map<string, Alias> {
  const rungs = findCopyRungs(instrs);
  const writes = writeCounts(instrs);
  const alwaysOn = (d: string) => specialBit(d, dialect, 5, 0) === true && specialBit(d, dialect, 0, 0) === true;

  // 항상 ON 인 릴레이: 항상 ON 플래그만 복사한 코일 (반복해서 전파)
  const constOn = new Set<string>();
  for (let pass = 0; pass < 5; pass++) {
    for (const r of rungs) {
      const srcOn = alwaysOn(r.src) || constOn.has(r.src);
      if (!srcOn || r.neg || r.gates.some((g) => g.neg || !(alwaysOn(g.dev) || constOn.has(g.dev)))) continue;
      for (const d of r.dests) if ((writes.get(d) ?? 0) === 1) constOn.add(d);
    }
  }

  // 직접 매핑: dest ← src
  const direct = new Map<string, { src: string; neg: boolean }>();
  for (const r of rungs) {
    if (isConstant(r.src) || alwaysOn(r.src) || constOn.has(r.src)) continue;
    if (!r.gates.every((g) => !g.neg && (alwaysOn(g.dev) || constOn.has(g.dev)))) continue;
    for (const d of r.dests) {
      if ((writes.get(d) ?? 0) !== 1 || d === r.src) continue;
      direct.set(d, { src: r.src, neg: r.neg });
    }
  }

  // 사슬 풀기
  const out = new Map<string, Alias>();
  for (const d of direct.keys()) {
    let cur = d;
    let invert = false;
    const chain: string[] = [];
    const seen = new Set<string>();
    while (direct.has(cur) && !seen.has(cur) && chain.length < 12) {
      seen.add(cur);
      chain.unshift(cur);
      const step = direct.get(cur)!;
      if (step.neg) invert = !invert;
      cur = step.src;
    }
    out.set(d, { source: cur, invert, chain });
  }
  return out;
}

/** 표시용: "= P00019" / "= NOT P00040" */
export function aliasText(a: Alias): string {
  return `${a.invert ? 'NOT ' : ''}${a.source}`;
}

/** 내부 릴레이 ↔ 실제 I/O 연결 */
export interface IoLink {
  /** 내부 릴레이 (M00440) */
  relay: string;
  /** 실제 I/O (P00019) */
  io: string;
  invert: boolean;
  /** in = 릴레이가 I/O 를 받아 옴 (M ← P), out = 릴레이가 출력을 켬 (M → P) */
  dir: 'in' | 'out';
}

/** 매핑 결과를 "내부 릴레이 ↔ 실제 I/O" 목록으로 정리 */
export function ioLinks(aliases: Map<string, Alias>, isIo: (d: string) => boolean, isRelay: (d: string) => boolean = () => true): IoLink[] {
  const out: IoLink[] = [];
  const seen = new Set<string>();
  const add = (l: IoLink) => {
    const k = `${l.dir}:${l.relay}:${l.io}`;
    if (seen.has(k) || l.relay === l.io) return;
    seen.add(k);
    out.push(l);
  };
  for (const [dest, a] of aliases) {
    if (!isIo(dest) && isIo(a.source) && isRelay(dest)) add({ relay: dest, io: a.source, invert: a.invert, dir: 'in' });
    if (isIo(dest)) {
      // 출력을 켜는 릴레이: 원본과 중간 사슬 (실제 I/O 는 제외)
      const relays = [a.source, ...a.chain.slice(0, -1)];
      for (const r of relays) {
        if (isIo(r) || !isRelay(r)) continue;
        const inv = r === a.source ? a.invert : a.invert !== (aliases.get(r)?.invert ?? false);
        add({ relay: r, io: dest, invert: inv, dir: 'out' });
      }
    }
  }
  return out;
}

/** 표시 디바이스 목록에서 매핑 릴레이를 실제 I/O 로 바꾸기 (중복 제거, 순서 유지) */
export function swapToRealIo(watch: string[], links: IoLink[]): { watch: string[]; swapped: number } {
  const inMap = new Map<string, string>();
  const outMap = new Map<string, string>();
  for (const l of links) {
    if (l.dir === 'in' && !inMap.has(l.relay)) inMap.set(l.relay, l.io);
    if (l.dir === 'out' && !outMap.has(l.relay)) outMap.set(l.relay, l.io);
  }
  const res: string[] = [];
  let swapped = 0;
  for (const w of watch) {
    const io = inMap.get(w) ?? outMap.get(w);
    if (io) swapped++;
    const d = io ?? w;
    if (!res.includes(d)) res.push(d);
  }
  return { watch: res, swapped };
}
