/**
 * 회로도 (회로 기호) → 실물 배선도.
 *  1) 기호를 실물 기기로: 코일 + 접점 → 소켓 릴레이 (8핀 2c, 모자라면 각형 4c, 그래도 모자라면 코일을 나란히 단 보조 릴레이),
 *     전자접촉기 (주접점 3 + 보조 1a1b), 타이머 (8핀), 버튼 · 셀렉터 · 리밋 스위치 (1a1b), 센서, 램프 · 부하, 차단기 · THR, 전원 단자
 *  2) 판넬처럼 줄로 놓기: 전원 → 차단기 → 제어 기기 (접촉기 · 릴레이 · 타이머) → 문 (버튼 · 램프) → 현장 기기 (전동기 · 센서 · 밸브).
 *     줄 안의 차례는 전선 길이 (넷마다 단자를 잇는 가장 짧은 나무) 가 짧아지도록 바꾼다
 *  3) 넷마다 단자를 격자 위 길 찾기로 잇는다: 다른 넷의 단자 · 선 끝 · 같은 방향의 선에는 닿지 않고, 엇갈려 지나가기만 한다
 *     (netlist 는 선 끝이나 단자가 다른 선 중간에 닿으면 잇기 때문). 그래서 만든 그림의 넷은 회로도의 넷과 꼭 같다
 */
import type { Circuit, Part, PartType, Pole, Wire, WireColor } from './types';
import { CircuitModel, tagKey } from './engine';
import { partBox, partPins, pinPositions, PARTS, POLE_IDENTITY, REAL } from './parts';
import { POLE_WIRE } from './wires';
import { isContactor } from './chart';
import { uid } from '../model/wave';
import { tr } from '../i18n';

export interface WiringResult {
  circuit: Circuit;
  notes: string[];
  /** 그린 전선 길이 합계 (칸, 그림 1칸 = 1 cm 로 어림) */
  length: number;
  /** 잇지 못한 연결 수 (0 이어야 정상) */
  failed: number;
  /** 만든 기기의 단자 → 회로도의 넷 (`부품id:단자`) : 검사용 */
  pinNets: Map<string, number>;
}

interface Dev {
  part: Part;
  row: number;
  /** 회로도에서의 자리 (줄 안의 처음 차례) */
  order: number;
  /** 단자 번호 → 넷 */
  pins: Map<number, number>;
}

/** 접점 하나의 쓰임: a접점인가, 두 끝의 넷 */
interface Use {
  no: boolean;
  a: number;
  b: number;
  part: Part;
  inst: boolean;
  sel?: -1 | 1;
}

/** 전환 접점 (c) 한 벌: 공통 · a · b 단자 번호 */
interface Changeover {
  com: number;
  a: number;
  b: number;
}

/** 줄: 0 전원 단자, 1 차단기 · 퓨즈, 2 제어 기기, 3 문 (조작 · 표시), 4 현장 기기 */
const ROW: Partial<Record<PartType, number>> = {
  r_term: 0,
  r_mcb1: 1,
  r_mcb2: 1,
  r_mcb3: 1,
  r_mcb4: 1,
  r_fuse: 1,
  r_mc: 2,
  r_thr: 2,
  r_relay8: 2,
  r_my2: 2,
  r_my4: 2,
  r_timer8: 2,
  r_counter: 2,
  r_plc: 2,
  r_hmi: 3,
  r_ssr: 2,
  r_tc: 2,
  r_smps: 2,
  r_tsw: 2,
  r_tb: 2,
  r_pb: 3,
  r_pbl: 3,
  r_ss: 3,
  r_ss3: 3,
  r_estop: 3,
  r_lamp: 3,
  r_buzzer: 3,
  r_sw: 3,
  r_sw3: 3,
  r_vm: 3,
  r_am: 3,
  plc: 2,
};

const CONTACT_SYMS = new Set<PartType>(['no', 'nc', 'pb_no', 'pb_nc', 'sw_no', 'sw_nc', 'estop', 'ls_no', 'ls_nc']);
const PNEUMATIC = new Set<PartType>(['cyl', 'v32', 'v52', 'v52d', 'v53', 'air', 'frl', 'fc']);
/** 그림만 있는 것 (배선에 들지 않음) */
const DRAWING = new Set<PartType>(['text', 'r_panel', 'r_duct', 'r_rail']);
const TEMP_KEYS = ['sv', 'hys', 'zone', 'tLoad', 'tLoadCool', 'amb', 'tmax', 'rise', 'fall'] as const;

const relBox = (p: Part) => partBox({ ...p, x: 0, y: 0 });

/** 회로도 → 실물 배선도 */
export function toWiring(c: Circuit): WiringResult {
  const model = new CircuitModel(c);
  const notes: string[] = [];
  // 넷 묶기: 같은 극의 전원 단자는 한 넷 (실물에서는 전원 단자 하나에 모인다)
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const raw = (p: Part, i: number) => model.net.pinNet.get(`${p.id}:${i}`)!;
  let nextNet = model.net.count;

  const poleNet = new Map<string, number>();
  const poleLabel = new Map<string, Pole>();
  const addPole = (pole: Pole, n: number) => {
    const id = POLE_IDENTITY[pole];
    if (poleNet.has(id)) union(n, poleNet.get(id)!);
    else {
      poleNet.set(id, n);
      poleLabel.set(id, pole);
    }
  };
  for (const p of c.parts) {
    if (p.type === 'src' || p.type === 'r_term') addPole(p.pole ?? 'L', raw(p, 0));
    if (p.type === 'src3') (['L1', 'L2', 'L3'] as Pole[]).forEach((pole, i) => addPole(pole, raw(p, i)));
  }
  const net = (p: Part, i: number) => find(raw(p, i));

  // 넷의 전원 극 (접점을 모두 닫고 따라간 것): 전선 색 · 직류 / 교류
  const group = new Map<number, number>();
  const gfind = (n: number): number => {
    let r = n;
    while ((group.get(r) ?? r) !== r) r = group.get(r)!;
    group.set(n, r);
    return r;
  };
  for (const k of model.conductors) {
    const a = gfind(find(k.a));
    const b = gfind(find(k.b));
    if (a !== b) group.set(a, b);
  }
  const polesOf = (n: number) => {
    const g = gfind(find(n));
    return new Set([...poleNet].filter(([, m]) => gfind(find(m)) === g).map(([id]) => id));
  };
  const isDc = (n: number) => [...polesOf(n)].some((id) => id === '+24V' || id === '0V');
  // 전선 색: 차단기 · 퓨즈 · THR 주접점만 지나 닿는 극 ([검사] 의 전선 색 검사와 같은 기준). 원래 그림의 전선에 색이 있으면 그 색
  const feed = new Map<number, number>();
  const ffind = (n: number): number => {
    let r = n;
    while ((feed.get(r) ?? r) !== r) r = feed.get(r)!;
    feed.set(n, r);
    return r;
  };
  for (const k of model.conductors) {
    const t = k.part.type;
    const protect = k.always || !!PARTS[t].defaultOn || t === 'ol3' || (t === 'r_thr' && k.ia < 3);
    if (!protect) continue;
    const a = ffind(find(k.a));
    const b = ffind(find(k.b));
    if (a !== b) feed.set(a, b);
  }
  const feedPoles = (n: number) => {
    const g = ffind(find(n));
    return new Set([...poleNet].filter(([, m]) => ffind(find(m)) === g).map(([id]) => id));
  };
  const drawn = new Map<number, Map<string, number>>();
  for (const w of c.wires) {
    const wn = model.net.wireNet.get(w.id);
    if (wn === undefined || !w.color) continue;
    const m = drawn.get(find(wn)) ?? new Map<string, number>();
    m.set(w.color, (m.get(w.color) ?? 0) + 1);
    drawn.set(find(wn), m);
  }

  const devs: Dev[] = [];
  const origin = (p: Part) => p.x * 1000 + p.y;
  const mk = (type: PartType, tag: string, from: Part, extra: Partial<Part> = {}): Dev => {
    const part: Part = { id: uid('cp'), type, x: 0, y: 0, rot: 0, tag, ...extra };
    const d: Dev = { part, row: ROW[type] ?? 4, order: origin(from), pins: new Map() };
    devs.push(d);
    return d;
  };
  const link = (d: Dev, pin: number, n: number) => {
    const cur = d.pins.get(pin);
    if (cur !== undefined && cur !== n) throw new Error(`${d.part.tag}: 단자 ${pin} 이 두 넷에 물림`);
    d.pins.set(pin, n);
  };
  const named = (tag: string, ...prefer: PartType[]): Partial<Part> => {
    const ps = c.parts.filter((q) => tagKey(q) === tag && q.name?.trim());
    const n = (ps.find((q) => prefer.includes(q.type)) ?? ps[0])?.name?.trim();
    return n ? { name: n } : {};
  };
  const label = (tag: string) => model.label(tag);

  // ── 전원 단자: 극마다 하나
  for (const [id, n] of poleNet) {
    const src = c.parts.find((q) => (q.type === 'src3' ? ['L1', 'L2', 'L3'].includes(id) : (q.type === 'src' || q.type === 'r_term') && POLE_IDENTITY[q.pole ?? 'L'] === id))!;
    const d = mk('r_term', '', src, { pole: poleLabel.get(id)! });
    d.order = ['L1', 'L2', 'L3', 'N', 'PE', '+24V', '0V'].indexOf(id);
    link(d, 0, find(n));
  }

  // ── 접점 쓰임을 기호마다 모은다
  const uses = new Map<string, Use[]>();
  for (const p of c.parts) {
    if (!CONTACT_SYMS.has(p.type)) continue;
    const tag = tagKey(p);
    uses.set(tag, [...(uses.get(tag) ?? []), { no: !PARTS[p.type].nc, a: net(p, 0), b: net(p, 1), part: p, inst: (p.type === 'no' || p.type === 'nc') && !!p.inst13, ...(p.sel ? { sel: p.sel } : {}) }]);
  }
  const byTag = (type: PartType) => {
    const m = new Map<string, Part[]>();
    for (const p of c.parts) if (p.type === type) m.set(tagKey(p), [...(m.get(tagKey(p)) ?? []), p]);
    return m;
  };
  const coils = byTag('coil');
  const timers = byTag('timer');
  const km3s = byTag('km3');
  const ol3s = byTag('ol3');

  /** 전환 접점에 쓰임을 넣는다. a 와 b 가 한 넷을 같이 쓰면 공통 단자를 함께 쓴다. 못 넣은 것을 돌려준다 */
  const fillChangeovers = (d: Dev, groups: Changeover[], list: Use[]): Use[] => {
    const used: { g: Changeover; com: number; a: boolean; b: boolean }[] = [];
    const left: Use[] = [];
    list.forEach((u, i) => {
      const slot = used.find((s) => (u.no ? !s.a : !s.b) && (s.com === u.a || s.com === u.b));
      if (slot) {
        link(d, u.no ? slot.g.a : slot.g.b, slot.com === u.a ? u.b : u.a);
        if (u.no) slot.a = true;
        else slot.b = true;
        return;
      }
      const g = groups[used.length];
      if (!g) {
        left.push(u);
        return;
      }
      // 뒤에 오는 반대 종류 쓰임과 같이 쓰는 넷을 공통으로
      const rest = list.slice(i + 1).filter((v) => v.no !== u.no);
      const com = rest.some((v) => v.a === u.b || v.b === u.b) ? u.b : u.a;
      link(d, g.com, com);
      link(d, u.no ? g.a : g.b, com === u.a ? u.b : u.a);
      used.push({ g, com, a: u.no, b: !u.no });
    });
    return left;
  };
  // 8핀: 8-6 a · 8-5 b 부터, 그다음 1-3 a · 1-4 b
  const octal: Changeover[] = [
    { com: 7, a: 5, b: 4 },
    { com: 0, a: 2, b: 3 },
  ];
  const blade = (type: 'r_my2' | 'r_my4'): Changeover[] => {
    const poles = PARTS[type].poles!;
    return Array.from({ length: poles.length / 2 }, (_, k) => ({ com: poles[2 * k][0], a: poles[2 * k][1], b: poles[2 * k + 1][1] }));
  };
  const coilSpec = (n: number): Partial<Part> => (isDc(n) ? { spec: 'DC 24V' } : {});

  /** 접점이 모자라면 코일을 나란히 단 보조 릴레이 (각형 4c) 에 */
  const auxRelays = (tag: string, from: Part, coilNets: [number, number], left: Use[]) => {
    let k = 2;
    while (left.length) {
      const t = `${label(tag)}-${k++}`;
      const d = mk('r_my4', t, from, { name: tr(`${label(tag)} 보조`, `${label(tag)} aux`), ...coilSpec(coilNets[0]) });
      const sc = PARTS.r_my4.selfCoil!;
      link(d, sc[0], coilNets[0]);
      link(d, sc[1], coilNets[1]);
      left = fillChangeovers(d, blade('r_my4'), left);
      notes.push(tr(`${label(tag)}: 접점이 모자라 코일을 나란히 단 보조 릴레이 ${t} 를 붙였습니다`, `${label(tag)}: not enough contacts, added auxiliary relay ${t} with its coil in parallel`));
    }
  };

  const done = new Set<string>();
  // ── 코일: 전자접촉기 · 릴레이
  for (const [tag, [cp]] of coils) {
    done.add(tag);
    const cn: [number, number] = [net(cp, 0), net(cp, 1)];
    const list = uses.get(tag) ?? [];
    if (isContactor(c, tag)) {
      const d = mk('r_mc', label(tag), cp, { ...named(tag, 'coil'), ...coilSpec(cn[0]) });
      link(d, 0, cn[0]);
      link(d, 1, cn[1]);
      const main = km3s.get(tag) ?? [];
      const mainPins = [2, 3, 4, 7, 8, 9];
      if (main.length) [0, 1, 2, 3, 4, 5].forEach((i) => link(d, mainPins[i], net(main[0], i)));
      if (main.length > 1) notes.push(tr(`${label(tag)}: 주접점이 ${main.length}벌이라 첫 벌만 그렸습니다`, `${label(tag)}: only the first set of main contacts is drawn`));
      // 보조 13-14 a · 21-22 b, 주접점을 안 쓰면 주접점도 a접점으로
      const noSlots: [number, number][] = [[5, 10], ...(main.length ? [] : ([[2, 7], [3, 8], [4, 9]] as [number, number][]))];
      const ncSlots: [number, number][] = [[6, 11]];
      const left: Use[] = [];
      for (const u of list) {
        const slot = (u.no ? noSlots : ncSlots).shift();
        if (!slot) {
          left.push(u);
          continue;
        }
        link(d, slot[0], u.a);
        link(d, slot[1], u.b);
      }
      auxRelays(tag, cp, cn, left);
      continue;
    }
    // 릴레이: 8핀 2c 로 되면 8핀, 아니면 각형 4c
    const probe: Dev = { part: { id: '', type: 'r_relay8', x: 0, y: 0, rot: 0, tag: '' }, row: 2, order: 0, pins: new Map() };
    const type = fillChangeovers(probe, octal, list).length === 0 ? 'r_relay8' : 'r_my4';
    const d = mk(type, label(tag), cp, { ...named(tag, 'coil'), ...coilSpec(cn[0]), ...(type === 'r_relay8' ? { sock: 'pf' as const } : {}) });
    const sc = PARTS[type].selfCoil!;
    link(d, sc[0], cn[0]);
    link(d, sc[1], cn[1]);
    auxRelays(tag, cp, cn, fillChangeovers(d, type === 'r_relay8' ? octal : blade('r_my4'), list));
  }

  // ── 타이머 (8핀): 순시 접점이 있으면 1-3 · 1-4 를 순시로
  for (const [tag, [tp]] of timers) {
    done.add(tag);
    const list = uses.get(tag) ?? [];
    const inst = list.filter((u) => u.inst);
    const timed = list.filter((u) => !u.inst);
    const d = mk('r_timer8', label(tag), tp, { ...named(tag, 'timer'), sock: 'pf', timerMode: tp.timerMode ?? 'on', preset: tp.preset ?? 3000, ...(tp.presetOff ? { presetOff: tp.presetOff } : {}), ...(inst.length ? { inst13: true } : {}) });
    link(d, 1, net(tp, 0));
    link(d, 6, net(tp, 1));
    const left = [...fillChangeovers(d, inst.length ? [octal[0]] : octal, timed), ...(inst.length ? fillChangeovers(d, [octal[1]], inst) : [])];
    if (left.length) notes.push(tr(`${label(tag)}: 타이머 접점이 모자라 ${left.length}개를 잇지 못했습니다 (타이머 접점으로 보조 릴레이를 켜서 늘리세요)`, `${label(tag)}: not enough timer contacts, ${left.length} left out`));
  }

  // ── THR: 주회로 3극 + 95-96 b · 97-98 a
  const thrTags = new Set([...ol3s.keys(), ...[...uses.keys()].filter((t) => model.tagKind.get(t) === 'thr' && !done.has(t))]);
  for (const tag of thrTags) {
    done.add(tag);
    const main = ol3s.get(tag)?.[0];
    const from = main ?? uses.get(tag)![0].part;
    const d = mk('r_thr', label(tag), from, named(tag, 'ol3'));
    if (main) [0, 1, 2, 3, 4, 5].forEach((i) => link(d, i, net(main, i)));
    const slots: Record<'no' | 'nc', [number, number][]> = { no: [[8, 9]], nc: [[6, 7]] };
    let miss = 0;
    for (const u of uses.get(tag) ?? []) {
      const s = slots[u.no ? 'no' : 'nc'].shift();
      if (!s) miss++;
      else {
        link(d, s[0], u.a);
        link(d, s[1], u.b);
      }
    }
    if (miss) notes.push(tr(`${label(tag)}: THR 접점이 모자라 ${miss}개를 잇지 못했습니다`, `${label(tag)}: not enough overload contacts, ${miss} left out`));
  }

  // ── 조작 기기 · 센서 접점 (1a1b 몸통, 2선식 센서 · 서모스탯은 접점 하나)
  for (const [tag, list] of uses) {
    if (done.has(tag)) continue;
    done.add(tag);
    const first = list[0].part;
    const sense = list.find((u) => u.part.sense)?.part.sense;
    const any = <K extends keyof Part>(k: K) => list.map((u) => u.part[k]).find((v) => v !== undefined);
    if (first.type === 'no' || first.type === 'nc') {
      notes.push(tr(`접점 ${label(tag)}: 같은 기호의 코일 · 타이머 · 스위치가 없어 그리지 않았습니다`, `Contact ${label(tag)}: no coil, timer or switch with this tag`));
      continue;
    }
    if (sense === 'temp' || sense === 'inductive' || sense === 'capacitive' || sense === 'photo') {
      const u = list[0];
      const temp = sense === 'temp';
      const extra: Partial<Part> = temp
        ? (Object.fromEntries(TEMP_KEYS.filter((k) => u.part[k] !== undefined).map((k) => [k, u.part[k]])) as Partial<Part>)
        : { sense, ...(any('cyl') ? { cyl: any('cyl'), end: any('end') } : {}), ...(isDc(u.a) || isDc(u.b) ? {} : { ac: true }) };
      const d = mk(temp ? 'r_thermo' : 'r_prox2', label(tag), first, { ...named(tag), ...extra, ...(u.no ? {} : { ncOut: true }) });
      // 직류 2선식: 갈색이 + 쪽
      const plus = !temp && polesOf(u.b).has('+24V') && !polesOf(u.a).has('+24V');
      link(d, 0, plus ? u.b : u.a);
      link(d, 1, plus ? u.a : u.b);
      if (list.length > 1) notes.push(tr(`${label(tag)}: 접점이 하나뿐인 기기라 ${list.length - 1}개를 잇지 못했습니다`, `${label(tag)}: single-contact device, ${list.length - 1} left out`));
      continue;
    }
    let type: PartType;
    const extra: Partial<Part> = { ...named(tag) };
    if (first.type === 'pb_no' || first.type === 'pb_nc') {
      type = 'r_pb';
      const col = any('color');
      if (col) extra.color = col;
    } else if (first.type === 'sw_no' && list.some((u) => u.sel)) {
      type = 'r_ss3';
      const p3 = any('pos3');
      if (p3) extra.pos3 = p3;
    } else if (first.type === 'sw_no' || first.type === 'sw_nc') type = 'r_ss';
    else if (first.type === 'estop') type = 'r_estop';
    else if (sense === 'float') type = 'r_float';
    else if (sense === 'pressure') type = 'r_psw';
    else {
      type = 'r_ls';
      if (any('cyl')) Object.assign(extra, { cyl: any('cyl'), end: any('end') });
    }
    const d = mk(type, label(tag), first, extra);
    // 11-12 b (3단 셀렉터는 왼쪽 13-14) 와 23-24 a (오른쪽)
    const slot = { b: [0, 1], a: [2, 3] };
    const taken = new Set<string>();
    let miss = 0;
    for (const u of list) {
      const k = type === 'r_ss3' ? (u.sel === -1 ? 'b' : 'a') : u.no ? 'a' : 'b';
      if (taken.has(k)) {
        miss++;
        continue;
      }
      taken.add(k);
      link(d, slot[k][0], u.a);
      link(d, slot[k][1], u.b);
    }
    if (miss) notes.push(tr(`${label(tag)}: 1a1b 기기라 접점 ${miss}개를 잇지 못했습니다 (접점 블록을 더하세요)`, `${label(tag)}: 1 NO 1 NC device, ${miss} contact(s) left out`));
  }

  // ── 그 밖의 기호 하나하나
  const peNeeds: { d: Dev; pin: number }[] = [];
  for (const p of c.parts) {
    const t = p.tag.trim();
    const two = (type: PartType, extra: Partial<Part> = {}) => {
      const d = mk(type, t, p, { ...(p.name ? { name: p.name } : {}), ...extra });
      link(d, 0, net(p, 0));
      link(d, 1, net(p, 1));
      return d;
    };
    switch (p.type) {
      case 'lamp':
        two('r_lamp', { color: p.color ?? 'red', ...coilSpec(net(p, 0)) });
        break;
      case 'buzzer':
        two('r_buzzer', coilSpec(net(p, 0)));
        break;
      case 'sol':
        two('r_sol', isDc(net(p, 0)) ? {} : { spec: 'AC 220V' });
        break;
      case 'load':
      case 'motor':
        two('r_load1', { ...(p.watt ? { watt: p.watt } : {}), ...(p.pf ? { pf: p.pf } : {}), ...(p.type === 'motor' && !p.name ? { name: tr('전동기', 'Motor') } : {}) });
        break;
      case 'mcb':
        two('r_mcb1', p.spec ? { spec: p.spec } : {});
        break;
      case 'fuse':
        two('r_fuse', p.amps ? { amps: p.amps } : {});
        break;
      case 'fuse3':
        for (let i = 0; i < 3; i++) {
          const d = mk('r_fuse', t, p, p.name ? { name: p.name } : {});
          link(d, 0, net(p, i));
          link(d, 1, net(p, i + 3));
        }
        break;
      case 'mcb3': {
        const d = mk('r_mcb3', t, p, { ...(p.name ? { name: p.name } : {}), ...(p.spec ? { spec: p.spec } : {}) });
        [0, 1, 2, 3, 4, 5].forEach((i) => link(d, i, net(p, i)));
        break;
      }
      case 'motor3': {
        const d = mk('r_motor3', t, p, p.name ? { name: p.name } : {});
        [0, 1, 2].forEach((i) => link(d, i, net(p, i)));
        peNeeds.push({ d, pin: 3 });
        break;
      }
      case 'smps': {
        const d = mk('r_smps', t, p, p.name ? { name: p.name } : {});
        [0, 1, 2, 3].forEach((i) => link(d, i, net(p, i)));
        peNeeds.push({ d, pin: 4 });
        break;
      }
      case 'prox': {
        const d = mk('r_prox', t, p, { ...(p.name ? { name: p.name } : {}), ...(p.sense ? { sense: p.sense } : {}), ...(p.npn ? { npn: true } : {}), ...(p.cyl ? { cyl: p.cyl, end: p.end } : {}) });
        [0, 1, 2].forEach((i) => link(d, i, net(p, i)));
        break;
      }
      default:
        // 실물 기기 · 공압 기기 (실린더 · 밸브 · 배관) · PLC 블록은 그대로 옮긴다 (단자 번호도 그대로, 배관은 선처럼 다시 긋는다)
        if ((REAL.has(p.type) || PNEUMATIC.has(p.type) || p.type === 'plc') && !DRAWING.has(p.type) && p.type !== 'r_term') {
          const d = mk(p.type, p.tag, p, Object.fromEntries(Object.entries(p).filter(([k]) => !['id', 'x', 'y', 'rot', 'type', 'tag'].includes(k))) as Partial<Part>);
          partPins(p).forEach((_, i) => link(d, i, net(p, i)));
        }
    }
  }

  // ── 차단기 없이 전원에 바로 물린 제어 회로: 제어 전원 차단기를 넣는다 (상마다 한 극, N 은 그대로)
  {
    const PROTECT = new Set<PartType>(['r_term', 'r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mcb4', 'r_fuse', 'r_vcb', 'r_tr3', 'r_kepco']);
    const direct = (id: string) => {
      const n = find(poleNet.get(id)!);
      return devs.filter((d) => !PROTECT.has(d.part.type)).flatMap((d) => [...d.pins].filter(([, m]) => m === n).map(([i]) => ({ d, i })));
    };
    const phases = ['L1', 'L2', 'L3'].filter((id) => poleNet.has(id) && direct(id).length);
    if (phases.length) {
      const used = new Set(c.parts.map((p) => tagKey(p)));
      let k = 0;
      while (used.has(`CB${k}`)) k++;
      const tag = `CB${k}`;
      const type: PartType = phases.length === 1 ? 'r_mcb1' : phases.length === 2 ? 'r_mcb2' : 'r_mcb3';
      const top = type === 'r_mcb1' ? [0] : type === 'r_mcb2' ? [0, 1] : [0, 1, 2];
      const bottom = type === 'r_mcb1' ? [1] : type === 'r_mcb2' ? [2, 3] : [3, 4, 5];
      const first = direct(phases[0])[0];
      const cb = mk(type, tag, c.parts.find((p) => tagKey(p) === tagKey(first.d.part)) ?? c.parts[0], { name: tr('제어 전원', 'Control power'), spec: 'AC/10A' });
      phases.forEach((id, j) => {
        const src = find(poleNet.get(id)!);
        const to = nextNet++;
        // 차단기 아래 넷도 같은 극에서 오는 것으로 (전선 색)
        feed.set(to, ffind(src));
        group.set(to, gfind(src));
        for (const { d, i } of direct(id)) d.pins.set(i, to);
        link(cb, top[j], src);
        link(cb, bottom[j], to);
      });
      notes.push(tr(`제어 회로가 차단기 없이 ${phases.join(' · ')} 에 바로 물려 있어 제어 전원 차단기 ${tag} 를 넣었습니다`, `The control circuit was fed straight from ${phases.join(', ')}; added control breaker ${tag}`));
    }
  }

  // ── 접지: 전동기 · SMPS 의 PE (회로도에 PE 가 없으면 PE 단자를 더한다)
  if (peNeeds.length) {
    let pe = poleNet.get('PE');
    if (pe === undefined) {
      pe = nextNet++;
      const d = mk('r_term', '', c.parts[0], { pole: 'PE' });
      d.order = 4;
      link(d, 0, pe);
      poleNet.set('PE', pe);
    }
    for (const { d, pin } of peNeeds) link(d, pin, find(pe));
  }

  // ── 놓기 · 잇기 (잇지 못한 선이 있으면 간격을 넓혀 다시)
  const peNet = poleNet.has('PE') ? find(poleNet.get('PE')!) : -1;
  const colorOf = (n: number): WireColor => {
    if (n === peNet) return 'gy';
    const was = drawn.get(n);
    if (was) return [...was].sort((a, b) => b[1] - a[1])[0][0] as WireColor;
    const fp = feedPoles(n);
    if (fp.size === 1) return POLE_WIRE[[...fp][0]] ?? 'grey';
    if (fp.size > 1) return 'grey';
    const ps = polesOf(n);
    return ps.size === 1 ? POLE_WIRE[[...ps][0]] ?? 'grey' : 'grey';
  };
  let best: { wires: Wire[]; failed: number; length: number } | null = null;
  let bestPos: [number, number][] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    place(devs, 4 + attempt * 2, 9 + attempt * 5);
    const r = routeAll(devs, colorOf);
    if (!best || r.failed < best.failed) {
      best = r;
      bestPos = devs.map((d) => [d.part.x, d.part.y]);
    }
    if (r.failed === 0) break;
  }
  devs.forEach((d, i) => ([d.part.x, d.part.y] = bestPos[i]));
  const res = best!;
  if (res.failed) notes.push(tr(`선 ${res.failed}개를 자동으로 잇지 못했습니다. 그림에서 직접 이어 주세요`, `${res.failed} connection(s) could not be routed; draw them by hand`));

  const title = c.parts.find((p) => p.type === 'text')?.text;
  const text: Part = { id: uid('cp'), type: 'text', x: 0, y: -4, rot: 0, tag: '', text: tr(`실물 배선도 (회로도에서 자동 생성)${title ? `: ${title}` : ''}`, `Wiring diagram (generated from the schematic)${title ? `: ${title}` : ''}`) };
  const out: Circuit = {
    parts: [text, ...devs.map((d) => d.part)],
    wires: res.wires,
    ops: c.ops.map((o) => ({ ...o })),
    ...(c.duration ? { duration: c.duration } : {}),
    ...(c.clock ? { clock: c.clock } : {}),
    ...(c.system ? { system: c.system } : {}),
    ...(c.vll ? { vll: c.vll } : {}),
    ...(c.relayMs ? { relayMs: c.relayMs } : {}),
  };
  const pinNets = new Map<string, number>();
  for (const d of devs) for (const [i, n] of d.pins) pinNets.set(`${d.part.id}:${i}`, n);
  return { circuit: out, notes, length: res.length, failed: res.failed, pinNets };
}

// ───────────────────────── 놓기 ─────────────────────────

/** 넷마다 단자를 잇는 가장 짧은 나무 (맨해튼) 의 길이 합 */
function estimate(devs: Dev[]): number {
  const pts = new Map<number, [number, number][]>();
  for (const d of devs) {
    const pos = pinPositions(d.part);
    for (const [i, n] of d.pins) pts.set(n, [...(pts.get(n) ?? []), pos[i]]);
  }
  let total = 0;
  for (const ps of pts.values()) {
    if (ps.length < 2) continue;
    const inTree = [ps[0]];
    const rest = ps.slice(1);
    while (rest.length) {
      let bi = 0;
      let bd = Infinity;
      rest.forEach((p, i) => {
        for (const q of inTree) {
          const dd = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        }
      });
      total += bd;
      inTree.push(rest.splice(bi, 1)[0]);
    }
  }
  return total;
}

/** 줄마다 왼쪽부터 놓는다 (위 맞춤). 줄 안의 차례는 전선 길이 어림이 짧아지도록 둘씩 바꿔 본다 */
function place(devs: Dev[], gap: number, channel: number): void {
  const rows = [0, 1, 2, 3, 4].map((r) => devs.filter((d) => d.row === r).sort((a, b) => a.order - b.order)).filter((r) => r.length);
  const layout = () => {
    let top = 0;
    for (const row of rows) {
      let cursor = 0;
      let h = 0;
      for (const d of row) {
        const [x0, y0, x1, y1] = relBox(d.part);
        d.part.x = Math.ceil(cursor - x0);
        d.part.y = Math.ceil(top - y0);
        cursor = d.part.x + x1 + gap;
        h = Math.max(h, y1 - y0);
      }
      top = Math.ceil(top + h) + channel;
    }
  };
  layout();
  let cost = estimate(devs);
  for (let pass = 0; pass < 30; pass++) {
    let better = false;
    for (const row of rows) {
      for (let i = 0; i + 1 < row.length; i++) {
        for (let j = i + 1; j < row.length; j++) {
          [row[i], row[j]] = [row[j], row[i]];
          layout();
          const c2 = estimate(devs);
          if (c2 < cost - 1e-9) {
            cost = c2;
            better = true;
          } else [row[i], row[j]] = [row[j], row[i]];
        }
      }
    }
    if (!better) break;
  }
  layout();
}

// ───────────────────────── 잇기 (격자 길 찾기) ─────────────────────────

/** 단자가 넷에 물린 기기들 (회로도에서 만든 것이든, 이미 그려진 실물 배선도든) */
export interface RouteDev {
  part: Part;
  pins: Map<number, number>;
}

/** 0 →, 1 ←, 2 ↓, 3 ↑ (짝끼리 반대 방향) */
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 넷마다 단자를 잇는 선을 긋는다. 지킬 것 (netlist 가 엉뚱하게 잇지 않도록):
 *  - 다른 넷의 단자 · 선 끝 (모퉁이 · 분기 포함) 을 지나가지 않는다
 *  - 다른 넷의 선과 같은 방향으로 겹치지 않는다. 직각으로 엇갈리기만 하고, 엇갈리는 점에서는 꺾거나 끝나지 않는다
 *  - 같은 넷의 이미 그은 선이나 단자에 닿으면 거기서 끝난다 (T 분기)
 * 기기 몸통 위는 지날 수 있지만 비싸게, 꺾는 것도 비싸게 해서 깔끔한 선이 되게 한다.
 */
export function routeAll(devs: RouteDev[], colorOf: (net: number) => WireColor | undefined): { wires: Wire[]; failed: number; length: number } {
  const wires: Wire[] = [];
  if (!devs.length) return { wires, failed: 0, length: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of devs) {
    const b = partBox(d.part);
    for (const [x, y] of [...pinPositions(d.part), [b[0], b[1]], [b[2], b[3]]]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const M = 6;
  const gx0 = Math.floor(x0) - M;
  const gy0 = Math.floor(y0) - M;
  const W = Math.ceil(x1) + M - gx0 + 1;
  const H = Math.ceil(y1) + M - gy0 + 1;
  const N = W * H;
  const at = (x: number, y: number) => (y - gy0) * W + (x - gx0);
  const ptOf = (i: number): [number, number] => [(i % W) + gx0, Math.floor(i / W) + gy0];

  // 단자의 넷 (안 쓰는 단자는 -2 로 막는다), 몸통, 선 (가로 · 세로), 선 끝
  const pin = new Int32Array(N).fill(-1);
  const body = new Uint8Array(N);
  const hNet = new Int32Array(N).fill(-1);
  const vNet = new Int32Array(N).fill(-1);
  const endNet = new Int32Array(N).fill(-1);
  const netPins = new Map<number, number[]>();
  for (const d of devs) {
    const [bx0, by0, bx1, by1] = partBox(d.part);
    for (let y = Math.ceil(by0); y <= Math.floor(by1); y++) for (let x = Math.ceil(bx0); x <= Math.floor(bx1); x++) if (x > bx0 && x < bx1 && y > by0 && y < by1) body[at(x, y)] = 1;
    pinPositions(d.part).forEach(([x, y], i) => {
      const n = d.pins.get(i);
      const k = at(x, y);
      if (n === undefined) {
        if (pin[k] === -1) pin[k] = -2;
        return;
      }
      pin[k] = n;
      const list = netPins.get(n) ?? [];
      if (!list.includes(k)) list.push(k);
      netPins.set(n, list);
    });
  }

  let failed = 0;
  let length = 0;
  // 단자가 많고 넓게 퍼진 넷 (전원) 부터
  const spread = (ks: number[]) => {
    const ps = ks.map(ptOf);
    return Math.max(...ps.map((p) => p[0])) - Math.min(...ps.map((p) => p[0])) + Math.max(...ps.map((p) => p[1])) - Math.min(...ps.map((p) => p[1]));
  };
  const order = [...netPins].filter(([, ks]) => ks.length > 1).sort((a, b) => b[1].length - a[1].length || spread(b[1]) - spread(a[1]));

  const S = N * 4;
  const dist = new Int32Array(S);
  const prev = new Int32Array(S);
  const other = (k: number, n: number) => (hNet[k] !== -1 && hNet[k] !== n) || (vNet[k] !== -1 && vNet[k] !== n) || (endNet[k] !== -1 && endNet[k] !== n);
  const own = (k: number, n: number) => hNet[k] === n || vNet[k] === n || endNet[k] === n;

  /** start (단자) 에서 같은 넷의 나무까지: 상태 = 점 × 들어온 방향, 비용 = 길이 + 꺾임 + 몸통 위 + 엇갈림 */
  const search = (start: number, n: number, tree: Set<number>): number[] | null => {
    dist.fill(0x3fffffff);
    const heap: number[] = [];
    const push = (cost: number, s: number) => {
      heap.push(cost * S + s);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= heap[i]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l] < heap[m]) m = l;
          if (r < heap.length && heap[r] < heap[m]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    // 도착: 같은 넷의 나무에 든 단자, 또는 다른 넷이 지나가지 않는 같은 넷의 선 위
    const isGoal = (k: number) => (pin[k] === n && tree.has(k)) || (pin[k] === -1 && own(k, n) && !other(k, n));
    const step = (x: number, y: number, m: number, base: number, from: number) => {
      const tx = x + DIRS[m][0];
      const ty = y + DIRS[m][1];
      if (tx < gx0 || ty < gy0 || tx >= gx0 + W || ty >= gy0 + H) return;
      const k = at(tx, ty);
      if (pin[k] !== -1 && !(pin[k] === n && tree.has(k))) return;
      if (endNet[k] !== -1 && endNet[k] !== n) return;
      if (m < 2 ? hNet[k] !== -1 && hNet[k] !== n : vNet[k] !== -1 && vNet[k] !== n) return;
      const cross = other(k, n);
      if (cross && own(k, n)) return;
      const c2 = base + 1 + (body[k] ? 12 : 0) + (cross ? 1 : 0);
      const s = k * 4 + m;
      if (c2 < dist[s]) {
        dist[s] = c2;
        prev[s] = from;
        push(c2, s);
      }
    };
    const [sx, sy] = ptOf(start);
    for (let m = 0; m < 4; m++) step(sx, sy, m, 0, -1);
    while (heap.length) {
      const v = pop();
      const s = v % S;
      const cost = Math.floor(v / S);
      if (cost > dist[s]) continue;
      const k = s >> 2;
      const d = s & 3;
      if (isGoal(k)) {
        const path: number[] = [];
        for (let t = s; t >= 0; t = prev[t]) path.push(t >> 2);
        path.push(start);
        return path.reverse();
      }
      const [x, y] = ptOf(k);
      // 다른 넷과 엇갈리는 점에서는 곧게만
      const cross = other(k, n);
      for (let m = 0; m < 4; m++) {
        if ((m ^ 1) === d) continue;
        if (cross && m !== d) continue;
        step(x, y, m, cost + (m >> 1 !== d >> 1 ? 4 : 0), s);
      }
    }
    return null;
  };

  for (const [n, ks] of order) {
    const tree = new Set<number>([ks[0]]);
    const todo = ks.slice(1);
    const color = colorOf(n);
    while (todo.length) {
      // 나무에 가장 가까운 단자부터
      let bi = 0;
      let bd = Infinity;
      todo.forEach((k, i) => {
        const [x, y] = ptOf(k);
        for (const t of tree) {
          const [tx, ty] = ptOf(t);
          const dd = Math.abs(x - tx) + Math.abs(y - ty);
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        }
      });
      const start = todo.splice(bi, 1)[0];
      const path = search(start, n, tree);
      if (!path) {
        failed++;
        continue;
      }
      // 꺾이는 곳에서 끊어 선으로
      const pts = path.map(ptOf);
      let a = 0;
      for (let i = 1; i < pts.length; i++) {
        const last = i === pts.length - 1;
        const turn = !last && (pts[i + 1][0] - pts[i][0] !== pts[i][0] - pts[i - 1][0] || pts[i + 1][1] - pts[i][1] !== pts[i][1] - pts[i - 1][1]);
        if (!last && !turn) continue;
        const [ax, ay] = pts[a];
        const [bx, by] = pts[i];
        wires.push({ id: uid('cw'), a: [ax, ay], b: [bx, by], ...(color ? { color } : {}) });
        length += Math.abs(bx - ax) + Math.abs(by - ay);
        const horiz = ay === by;
        for (let j = a; j <= i; j++) {
          if (horiz) hNet[path[j]] = n;
          else vNet[path[j]] = n;
        }
        endNet[path[a]] = n;
        endNet[path[i]] = n;
        a = i;
      }
      for (const k of path) tree.add(k);
    }
  }
  return { wires, failed, length };
}

/** 그린 전선 길이 합계 (칸, 그림 1칸 = 1 cm 로 어림) */
export function wireLength(c: Pick<Circuit, 'wires'>): number {
  return c.wires.reduce((s, w) => s + Math.abs(w.b[0] - w.a[0]) + Math.abs(w.b[1] - w.a[1]), 0);
}

/**
 * 이미 그린 실물 배선도에서 기기 자리는 그대로 두고 전선만 다시 긋는다 (기기를 옮긴 뒤 선을 짧게).
 * 넷은 지금 그림의 넷 그대로, 색 · 케이블 규격은 그 넷의 선에서 가져온다. 부스바가 있는 그림은 하지 않는다
 */
export function rerouteWiring(c: Circuit): { circuit: Circuit; before: number; after: number; failed: number; skipped?: string } {
  const before = wireLength(c);
  if (c.parts.some((p) => p.type === 'r_bus')) return { circuit: c, before, after: before, failed: 0, skipped: tr('부스바가 있는 그림은 다시 그리지 않습니다', 'Drawings with busbars are not re-routed') };
  const model = new CircuitModel(c);
  const devs: RouteDev[] = c.parts
    .filter((p) => !DRAWING.has(p.type))
    .map((p) => {
      const pins = new Map<number, number>();
      partPins(p).forEach((_, i) => {
        const n = model.net.pinNet.get(`${p.id}:${i}`);
        if (n !== undefined) pins.set(i, n);
      });
      return { part: p, pins };
    });
  // 넷마다 가장 많이 쓴 색 · 처음 케이블 규격
  const colors = new Map<number, Map<string, number>>();
  const cable = new Map<number, NonNullable<Wire['cable']>>();
  for (const w of c.wires) {
    const n = model.net.wireNet.get(w.id);
    if (n === undefined) continue;
    const m = colors.get(n) ?? new Map<string, number>();
    m.set(w.color ?? '', (m.get(w.color ?? '') ?? 0) + 1);
    colors.set(n, m);
    if (w.cable && !cable.has(n)) cable.set(n, w.cable);
  }
  const colorOf = (n: number): WireColor | undefined => {
    const m = colors.get(n);
    if (!m) return undefined;
    const top = [...m].sort((a, b) => b[1] - a[1])[0][0];
    return (top || undefined) as WireColor | undefined;
  };
  // 단자가 둘 이상인 넷만 다시 긋는다 (선끼리만 이어진 것은 없어진다)
  const r = routeAll(devs, colorOf);
  // 케이블 규격: 새 그림의 넷을 같은 단자를 가진 옛 넷에 맞춰 다시 붙인다
  const tmp = new CircuitModel({ ...c, wires: r.wires });
  const toOld = new Map<number, number>();
  for (const [id, nn] of tmp.net.pinNet) {
    const o = model.net.pinNet.get(id);
    if (o !== undefined && !toOld.has(nn)) toOld.set(nn, o);
  }
  const out = r.wires.map((w) => {
    const nn = tmp.net.wireNet.get(w.id);
    const o = nn === undefined ? undefined : toOld.get(nn);
    const spec = o === undefined ? undefined : cable.get(o);
    return spec ? { ...w, cable: { ...spec } } : w;
  });
  return { circuit: { ...c, wires: out }, before, after: wireLength({ wires: out }), failed: r.failed };
}
