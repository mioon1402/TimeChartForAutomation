/**
 * 회로도 기호의 접점 번호 ↔ 실물 기기 단자.
 *
 * 같은 기호 (X1) 의 코일 · 접점을 모아 실물 기기 (8핀 릴레이 2c · 각형 4c · 전자접촉기 · 8핀 타이머 · THR) 의 어느 단자에 물릴지 정한다.
 *  - 접점에 번호를 적어 두면 (`Part.term` '8-6') 그 단자에 그대로 넣는다 (기기에 있는 번호이고 a · b 가 맞을 때)
 *  - 적지 않은 접점은 남은 단자에 차례로 넣는다 (a · b 가 한 넷을 같이 쓰면 공통 단자 한 벌)
 * [실물 배선도 만들기] (`realize.ts`) 와 회로도의 단자 번호 표시가 같은 결과를 쓰므로, 그림에 보이는 번호대로 배선된다
 */
import type { Circuit, Part, PartType } from './types';
import { tagKey, type CircuitModel } from './engine';
import { isContactor } from './chart';
import { PARTS, POLE_IDENTITY } from './parts';

/** 접점 하나의 쓰임: a접점인가, 위 (a) · 아래 (b) 넷 */
export interface Use {
  no: boolean;
  a: number;
  b: number;
  part: Part;
  inst: boolean;
  sel?: -1 | 1;
}

/** 전환 접점 (c) 한 벌: 공통 · a · b 단자 차례 */
export interface Changeover {
  com: number;
  a: number;
  b: number;
}

/** 접점 하나가 놓인 곳: 기기 (0 = 본체, 1… = 보조 릴레이) · 위 넷 · 아래 넷에 물린 단자 차례 */
export interface Placed {
  dev: number;
  pa: number;
  pb: number;
}

export type MainType = 'r_mc' | 'r_relay8' | 'r_my4' | 'r_timer8' | 'r_thr' | 'r_imp';

/** 기호 하나 (X1 · T1 · MC1 · THR1) 의 배치 */
export interface TagPlan {
  tag: string;
  type: MainType;
  /** 본체 코일 단자 차례 (THR 은 없음) */
  coil: [number, number] | null;
  /** 코일 기호 (타이머 기호) 부품 */
  coilPart: Part | null;
  /** 코일을 나란히 단 보조 릴레이 (각형 4c) 수 */
  aux: number;
  /** 접점 부품 id → 놓인 곳 */
  placed: Map<string, Placed>;
  /** 넣을 자리가 없었던 접점 (타이머 · THR) */
  left: Use[];
  /** 적은 번호를 쓸 수 없었던 접점 (기기에 없는 번호 · a/b 가 틀림 · 겹침): 자동 번호로 넣었다 */
  bad: Part[];
}

/** 회로도 접점 기호 (실물 기기의 접점이 되는 것) */
export const CONTACT_SYMS = new Set<PartType>(['no', 'nc', 'pb_no', 'pb_nc', 'sw_no', 'sw_nc', 'estop', 'ls_no', 'ls_nc']);

/** 8핀 2c: 8-6 a · 8-5 b 부터, 그다음 1-3 a · 1-4 b */
export const OCTAL_GROUPS: Changeover[] = [
  { com: 7, a: 5, b: 4 },
  { com: 0, a: 2, b: 3 },
];

/** 각형 릴레이의 전환 접점: 극마다 공통 → a · 공통 → b */
export function bladeGroups(type: 'r_my2' | 'r_my4'): Changeover[] {
  const poles = PARTS[type].poles!;
  return Array.from({ length: poles.length / 2 }, (_, k) => ({ com: poles[2 * k][0], a: poles[2 * k][1], b: poles[2 * k + 1][1] }));
}

/** 단자 글: 앞의 숫자 ('13NO' → 13, '1/L1' → 1), 숫자가 없으면 그대로 (A1) */
export function pinNo(type: PartType, i: number): string {
  const l = PARTS[type].pins[i]?.label ?? '';
  return /^\d+/.exec(l)?.[0] ?? l;
}

/** 적은 단자 번호 '13-14' · '8 - 6' · '1~3' → ['13', '14'], 모양이 아니면 null */
export function parseTerm(t?: string): [string, string] | null {
  const m = /^\s*([A-Za-z]?\d+)\s*[-–~·,/ ]+\s*([A-Za-z]?\d+)\s*$/.exec(t ?? '');
  return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : null;
}

/** 기기에서 a · b 접점으로 쓸 수 있는 번호 (안내 글에 씀) */
export function termChoices(type: MainType): { no: string[]; nc: string[] } {
  const pair = (t: PartType, x: number, y: number) => `${pinNo(t, x)}-${pinNo(t, y)}`;
  if (type === 'r_mc') return { no: ['13-14'], nc: ['21-22'] };
  if (type === 'r_thr') return { no: ['97-98'], nc: ['95-96'] };
  if (type === 'r_imp') return { no: ['13-14'], nc: ['21-22'] };
  const gs = type === 'r_my4' ? bladeGroups('r_my4') : OCTAL_GROUPS;
  return { no: gs.map((g) => pair(type, g.com, g.a)), nc: gs.map((g) => pair(type, g.com, g.b)) };
}

interface Slot {
  g: Changeover;
  com: number;
  a: boolean;
  b: boolean;
}

/** 전환 접점에 쓰임을 넣는다. a 와 b 가 한 넷을 같이 쓰면 공통 단자를 함께 쓴다. 못 넣은 것을 돌려준다 */
function fill(groups: Changeover[], list: Use[], used: Slot[], dev: number, out: Map<string, Placed>): Use[] {
  const left: Use[] = [];
  list.forEach((u, i) => {
    const slot = used.find((s) => (u.no ? !s.a : !s.b) && (s.com === u.a || s.com === u.b));
    if (slot) {
      const side = u.no ? slot.g.a : slot.g.b;
      out.set(u.part.id, slot.com === u.a ? { dev, pa: slot.g.com, pb: side } : { dev, pa: side, pb: slot.g.com });
      if (u.no) slot.a = true;
      else slot.b = true;
      return;
    }
    const g = groups.find((x) => !used.some((s) => s.g === x));
    if (!g) {
      left.push(u);
      return;
    }
    // 뒤에 오는 반대 종류 쓰임과 같이 쓰는 넷을 공통으로
    const rest = list.slice(i + 1).filter((v) => v.no !== u.no);
    const com = rest.some((v) => v.a === u.b || v.b === u.b) ? u.b : u.a;
    const side = u.no ? g.a : g.b;
    out.set(u.part.id, com === u.a ? { dev, pa: g.com, pb: side } : { dev, pa: side, pb: g.com });
    used.push({ g, com, a: u.no, b: !u.no });
  });
  return left;
}

/**
 * 번호를 적은 쓰임을 그 단자에 넣는다. 기기에 없는 번호이거나, a/b 가 틀리거나, 같은 단자를 두 넷이 쓰면 그 접점을 돌려준다 (bad).
 * 넣은 자리는 used · out 에 더하고, 번호가 없는 쓰임은 rest 로
 */
function explicitOn(type: PartType, groups: Changeover[], list: Use[], used: Slot[], dev: number, out: Map<string, Placed>): { bad: Part | null; rest: Use[] } {
  const rest: Use[] = [];
  const pinNet = new Map<number, number>();
  const tmp = new Map<string, Placed>();
  const slots: Slot[] = [];
  for (const u of list) {
    const t = parseTerm(u.part.term);
    if (!t) {
      rest.push(u);
      continue;
    }
    let hit: [Changeover, number, number] | null = null;
    for (const g of groups) {
      const side = u.no ? g.a : g.b;
      const [lc, ls] = [pinNo(type, g.com), pinNo(type, side)];
      if (t[0] === lc && t[1] === ls) hit = [g, g.com, side];
      else if (t[0] === ls && t[1] === lc) hit = [g, side, g.com];
      if (hit) break;
    }
    if (!hit) return { bad: u.part, rest: list };
    const [g, pa, pb] = hit;
    for (const [pin, n] of [
      [pa, u.a],
      [pb, u.b],
    ] as const) {
      if (pinNet.has(pin) && pinNet.get(pin) !== n) return { bad: u.part, rest: list };
      pinNet.set(pin, n);
    }
    let s = slots.find((x) => x.g === g);
    if (s && (u.no ? s.a : s.b)) return { bad: u.part, rest: list };
    if (!s) {
      s = { g, com: pinNet.get(g.com)!, a: false, b: false };
      slots.push(s);
    }
    if (u.no) s.a = true;
    else s.b = true;
    tmp.set(u.part.id, { dev, pa, pb });
  }
  for (const [k, v] of tmp) out.set(k, v);
  used.push(...slots);
  return { bad: null, rest };
}

/** 고정 자리 (전자접촉기 보조 · THR) 에 넣는다: 번호를 적었으면 그 자리, 아니면 차례로 */
function slotFill(type: PartType, slots: { no: [number, number][]; nc: [number, number][] }, list: Use[], out: Map<string, Placed>, bad: Part[]): Use[] {
  const left: Use[] = [];
  const free = { no: [...slots.no], nc: [...slots.nc] };
  const auto: Use[] = [];
  for (const u of list) {
    const t = parseTerm(u.part.term);
    if (!t) {
      auto.push(u);
      continue;
    }
    const pool = u.no ? free.no : free.nc;
    const k = pool.findIndex(([x, y]) => (pinNo(type, x) === t[0] && pinNo(type, y) === t[1]) || (pinNo(type, x) === t[1] && pinNo(type, y) === t[0]));
    if (k < 0) {
      bad.push(u.part);
      auto.push(u);
      continue;
    }
    const [x, y] = pool.splice(k, 1)[0];
    out.set(u.part.id, pinNo(type, x) === t[0] ? { dev: 0, pa: x, pb: y } : { dev: 0, pa: y, pb: x });
  }
  for (const u of auto) {
    const s = (u.no ? free.no : free.nc).shift();
    if (!s) left.push(u);
    else out.set(u.part.id, { dev: 0, pa: s[0], pb: s[1] });
  }
  return left;
}

/** 같은 극의 전원 단자를 한 넷으로 묶은 넷 (실물에서는 전원 단자 하나에 모인다). [실물 배선도 만들기] 와 같은 묶음 */
export function mergedNet(c: Circuit, model: CircuitModel): (p: Part, i: number) => number {
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    return r;
  };
  const first = new Map<string, number>();
  const raw = (p: Part, i: number) => model.net.pinNet.get(`${p.id}:${i}`)!;
  const add = (id: string, n: number) => {
    const f = first.get(id);
    if (f === undefined) first.set(id, n);
    else if (find(n) !== find(f)) parent.set(find(n), find(f));
  };
  for (const p of c.parts) {
    if (p.type === 'src' || p.type === 'r_term') add(POLE_IDENTITY[p.pole ?? 'L'], raw(p, 0));
    if (p.type === 'src3') ['L1', 'L2', 'L3'].forEach((id, i) => add(id, raw(p, i)));
  }
  return (p, i) => find(raw(p, i));
}

/** 접점 기호의 쓰임을 기호마다 모은다 */
export function contactUses(c: Circuit, net: (p: Part, i: number) => number): Map<string, Use[]> {
  const uses = new Map<string, Use[]>();
  for (const p of c.parts) {
    if (!CONTACT_SYMS.has(p.type)) continue;
    const tag = tagKey(p);
    uses.set(tag, [...(uses.get(tag) ?? []), { no: !PARTS[p.type].nc, a: net(p, 0), b: net(p, 1), part: p, inst: (p.type === 'no' || p.type === 'nc') && !!p.inst13, ...(p.sel ? { sel: p.sel } : {}) }]);
  }
  return uses;
}

/**
 * 코일 · 타이머 · THR 기호마다 실물 기기와 접점 자리를 정한다 (차례: 코일, 타이머, THR — [실물 배선도 만들기] 가 기기를 만드는 차례).
 * net 은 [실물 배선도 만들기] 의 넷 (같은 극 전원을 묶은 것)
 */
export function planContacts(c: Circuit, model: CircuitModel, net: (p: Part, i: number) => number = mergedNet(c, model), uses: Map<string, Use[]> = contactUses(c, net)): Map<string, TagPlan> {
  const plans = new Map<string, TagPlan>();
  const byTag = (type: PartType) => {
    const m = new Map<string, Part[]>();
    for (const p of c.parts) if (p.type === type) m.set(tagKey(p), [...(m.get(tagKey(p)) ?? []), p]);
    return m;
  };
  const coils = byTag('coil');
  const timers = byTag('timer');
  const km3s = byTag('km3');
  const ol3s = byTag('ol3');

  /** 남은 쓰임을 코일을 나란히 단 보조 릴레이 (각형 4c) 에 */
  const auxFill = (left: Use[], out: Map<string, Placed>): number => {
    let aux = 0;
    while (left.length) left = fill(bladeGroups('r_my4'), left, [], ++aux, out);
    return aux;
  };

  for (const [tag, [cp]] of coils) {
    const list = uses.get(tag) ?? [];
    const out = new Map<string, Placed>();
    const bad: Part[] = [];
    if (isContactor(c, tag)) {
      // 보조 13-14 a · 21-22 b, 주접점을 안 쓰면 주접점도 a접점으로
      const main = km3s.get(tag) ?? [];
      const slots = { no: [[5, 10], ...(main.length ? [] : [[2, 7], [3, 8], [4, 9]])] as [number, number][], nc: [[6, 11]] as [number, number][] };
      const left = slotFill('r_mc', slots, list, out, bad);
      plans.set(tag, { tag, type: 'r_mc', coil: [0, 1], coilPart: cp, aux: auxFill(left, out), placed: out, left: [], bad });
      continue;
    }
    // 릴레이: 번호를 적었으면 그 번호가 있는 기기 (8핀 → 각형), 아니면 8핀 2c 로 되면 8핀, 안 되면 각형 4c
    const explicit = list.filter((u) => parseTerm(u.part.term));
    let type: 'r_relay8' | 'r_my4' | null = null;
    let left: Use[] = [];
    if (explicit.length) {
      for (const t of ['r_relay8', 'r_my4'] as const) {
        const tryOut = new Map<string, Placed>();
        const used: Slot[] = [];
        const groups = t === 'r_relay8' ? OCTAL_GROUPS : bladeGroups('r_my4');
        const r = explicitOn(t, groups, list, used, 0, tryOut);
        if (r.bad) continue;
        type = t;
        left = fill(groups, r.rest, used, 0, tryOut);
        for (const [k, v] of tryOut) out.set(k, v);
        break;
      }
      if (!type) bad.push(...explicit.map((u) => u.part));
    }
    if (!type) {
      type = fill(OCTAL_GROUPS, list, [], 0, new Map()).length === 0 ? 'r_relay8' : 'r_my4';
      left = fill(type === 'r_relay8' ? OCTAL_GROUPS : bladeGroups('r_my4'), list, [], 0, out);
    }
    plans.set(tag, { tag, type, coil: PARTS[type].selfCoil! as [number, number], coilPart: cp, aux: auxFill(left, out), placed: out, left: [], bad });
  }

  // 임펄스 릴레이 (DIN 모듈): 13-14 a · 21-22 b, 코일 A1 · A2
  for (const [tag, [ip]] of byTag('imp')) {
    if (plans.has(tag)) continue;
    const out = new Map<string, Placed>();
    const bad: Part[] = [];
    const left = slotFill('r_imp', { no: [[1, 4]], nc: [[2, 5]] }, uses.get(tag) ?? [], out, bad);
    plans.set(tag, { tag, type: 'r_imp', coil: [0, 3], coilPart: ip, aux: 0, placed: out, left, bad });
  }

  // 타이머 (8핀): 순시 접점이 있으면 1-3 · 1-4 를 순시로, 한시는 8-6 · 8-5
  for (const [tag, [tp]] of timers) {
    if (plans.has(tag)) continue;
    const list = uses.get(tag) ?? [];
    const out = new Map<string, Placed>();
    const bad: Part[] = [];
    const inst = list.filter((u) => u.inst);
    const timed = list.filter((u) => !u.inst);
    const put = (groups: Changeover[], l: Use[]): Use[] => {
      const used: Slot[] = [];
      const r = explicitOn('r_timer8', groups, l, used, 0, out);
      if (r.bad) bad.push(...l.filter((u) => parseTerm(u.part.term)).map((u) => u.part));
      return fill(groups, r.bad ? l : r.rest, r.bad ? [] : used, 0, out);
    };
    const left = [...put(inst.length ? [OCTAL_GROUPS[0]] : OCTAL_GROUPS, timed), ...(inst.length ? put([OCTAL_GROUPS[1]], inst) : [])];
    plans.set(tag, { tag, type: 'r_timer8', coil: [1, 6], coilPart: tp, aux: 0, placed: out, left, bad });
  }

  // THR: 95-96 b · 97-98 a
  const thrTags = new Set([...ol3s.keys(), ...[...uses.keys()].filter((t) => model.tagKind.get(t) === 'thr' && !plans.has(t))]);
  for (const tag of thrTags) {
    if (plans.has(tag)) continue;
    const out = new Map<string, Placed>();
    const bad: Part[] = [];
    const left = slotFill('r_thr', { no: [[8, 9]], nc: [[6, 7]] }, uses.get(tag) ?? [], out, bad);
    plans.set(tag, { tag, type: 'r_thr', coil: null, coilPart: null, aux: 0, placed: out, left, bad });
  }
  return plans;
}

/** 놓인 곳의 실물 단자 번호 ['8', '6'] */
export function placedTerms(plan: TagPlan, at: Placed): [string, string] {
  const t: PartType = at.dev === 0 ? plan.type : 'r_my4';
  return [pinNo(t, at.pa), pinNo(t, at.pb)];
}

export interface ContactNumbers {
  /** 부품 id → 위 · 아래 단자 번호 (접점 · 코일 기호) */
  terms: Map<string, [string, string]>;
  /** 부품 id → 들어가는 기기 설명 (보조 릴레이면 X1-2) */
  where: Map<string, { tag: string; type: PartType }>;
  plans: Map<string, TagPlan>;
}

const cache = new WeakMap<CircuitModel, ContactNumbers>();

/** 회로도 기호에 보일 단자 번호: 적은 번호가 있으면 그것, 없으면 [실물 배선도 만들기] 가 쓸 단자 */
export function contactNumbers(c: Circuit, model: CircuitModel): ContactNumbers {
  const hit = cache.get(model);
  if (hit) return hit;
  const plans = planContacts(c, model);
  const terms = new Map<string, [string, string]>();
  const where = new Map<string, { tag: string; type: PartType }>();
  for (const plan of plans.values()) {
    const label = model.label(plan.tag);
    if (plan.coilPart && plan.coil) {
      terms.set(plan.coilPart.id, [pinNo(plan.type, plan.coil[0]), pinNo(plan.type, plan.coil[1])]);
      where.set(plan.coilPart.id, { tag: label, type: plan.type });
    }
    for (const [id, at] of plan.placed) {
      terms.set(id, placedTerms(plan, at));
      where.set(id, at.dev === 0 ? { tag: label, type: plan.type } : { tag: `${label}-${at.dev + 1}`, type: 'r_my4' });
    }
  }
  const res = { terms, where, plans };
  cache.set(model, res);
  return res;
}
