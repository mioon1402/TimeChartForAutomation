import type { Circuit, Part, PartType, WireColor } from './types';
import { circuitWires, hmiTag, rtdInputPins, skLeakMa, tankSetting, partKindName, partPins, pinPositions, PARTS, POLE_SYSTEM, REAL, RPLC, solAc } from './parts';
import { onWireInterior } from './netlist';
import type { CircuitModel } from './engine';
import { nominalVolt, poleLive, systemVolts } from './supply';
import { POLE_WIRE } from './wires';
import { earthStudy } from './earth';
import { tr } from '../i18n';

/**
 * 배선 검사: 그림을 실제로 배선했을 때 생기는 잘못을 시뮬레이션 없이 찾는다.
 *  - 전원까지 이어지지 않는 부하 (선 빠짐 · 같은 극에만 물림 · 직렬), 결상
 *  - 기기 정격 전압과 걸리는 전압이 다름 (AC 220 V 코일을 DC 24 V 에 등)
 *  - 전원 극끼리 바로 이어짐 (단락)
 *  - 끝이 떠 있는 선, 나사 단자 하나에 3가닥 이상
 *  - 차단기 · 퓨즈 없이 전원에 바로 물린 기기, 접점이 N 쪽에 있는 부하
 *  - 접지 (PE) 가 빠진 기기, 전선 색과 극이 맞지 않음
 *  - 센서 · SMPS 전원 빠짐 · 극성 반대
 * 접점은 "닫힐 수 있다" 고 보고 길을 찾는다 (all), 차단기 · 퓨즈 · 단자대만 지난 길은 "전원에 바로" (feed), 선과 단자대만은 "한 전선" (tie).
 */
export interface WiringIssue {
  level: 'error' | 'warn';
  msg: string;
  partIds: string[];
  wireIds?: string[];
}

const THREE: ReadonlySet<PartType> = new Set(['motor3', 'r_motor3', 'r_load3', 'r_motor6']);
/** 전원을 넣고 끊거나 보호하는 기기: 이것만 지난 길은 전원에 바로 물린 것으로 본다 */
const FEED: ReadonlySet<PartType> = new Set(['r_mcb1', 'r_mcb2', 'r_mcb3', 'r_mcb4', 'r_vcb', 'mcb', 'mcb3', 'fuse', 'fuse3', 'r_fuse']);
const PROX: ReadonlySet<PartType> = new Set(['prox', 'r_prox']);
const SMPS: ReadonlySet<PartType> = new Set(['smps', 'r_smps']);
/** 전원에 바로 물려 있어도 되는 것 (보호 장치 · 단자 · 모선) */
const PASSIVE: ReadonlySet<PartType> = new Set([...FEED, 'src', 'src3', 'r_term', 'r_tb', 'r_bus', 'r_nbar', 'r_kepco', 'r_tr3', 'r_panel', 'text', 'r_am']);

class Groups {
  private readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent[ra] = rb;
  }
}

const COLOR_NAME: Record<WireColor, [string, string]> = {
  brown: ['갈색', 'brown'],
  black: ['검정', 'black'],
  grey: ['회색', 'grey'],
  blue: ['파랑', 'blue'],
  gy: ['녹황', 'green-yellow'],
  red: ['빨강', 'red'],
  yellow: ['노랑', 'yellow'],
  white: ['흰색', 'white'],
  orange: ['주황', 'orange'],
};

/** 기기에 적힌 정격 전압: 교류 · 직류와 전압 범위 (없으면 null) */
export function ratedVoltage(p: Part): { kind: 'ac' | 'dc' | 'any'; lo: number; hi: number; text: string } | null {
  // 덮개에 AC 220V 가 적혀 나오는 기기는 사양을 비워도 그 전압으로 본다
  const shown = p.type === 'r_relay8' || p.type === 'r_my2' || p.type === 'r_my4' || p.type === 'r_mc' || p.type === 'r_imp' || p.type === 'r_flr' ? 'AC 220V' : p.type === 'r_counter' || p.type === 'r_tc' || p.type === 'r_tc8' || p.type === 'r_tk4' ? 'AC 100-240V' : p.type === 'r_sk' || p.type === 'sk' ? 'AC 250V' : p.type === 'r_ssr' ? 'DC 4-32V' : p.type === 'r_sol' || p.type === 'r_plc' || p.type === 'r_hmi' ? 'DC 24V' : '';
  const text = p.spec?.trim() || shown;
  if (text) {
    const m = /(\d+(?:\.\d+)?)\s*(?:[~\-–]\s*(\d+(?:\.\d+)?))?\s*V/i.exec(text);
    if (m) {
      const both = /AC\s*\/\s*DC|DC\s*\/\s*AC/i.test(text);
      const kind = both ? 'any' : /DC/i.test(text) ? 'dc' : /AC/i.test(text) ? 'ac' : 'any';
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      return { kind, lo: Math.min(a, b), hi: Math.max(a, b), text: text.replace(/\s+/g, ' ') };
    }
  }
  if (p.volt && p.volt > 0) return { kind: 'any', lo: p.volt, hi: p.volt, text: `${p.volt} V` };
  return null;
}

export function verifyWiring(c: Circuit, model: CircuitModel): WiringIssue[] {
  const out: WiringIssue[] = [];
  const net = model.net;
  const n = net.count;
  const tie = new Groups(n);
  const feed = new Groups(n);
  const all = new Groups(n);
  // 보호 장치 (차단기 · 퓨즈) 를 지나기 전까지: 단자대 · 바 · 전류계만 지난 길
  const bare = new Groups(n);
  for (const k of model.conductors) {
    all.union(k.a, k.b);
    if ((k.always || k.part.type === 'r_tb' || k.part.type === 'r_nbar' || k.part.type === 'r_am') && !FEED.has(k.part.type)) bare.union(k.a, k.b);
    if (k.always || k.part.type === 'r_tb' || k.part.type === 'r_nbar' || k.part.type === 'r_fuse' || k.part.type === 'r_am') {
      tie.union(k.a, k.b);
      feed.union(k.a, k.b);
    } else if (FEED.has(k.part.type)) feed.union(k.a, k.b);
  }
  // 전원: 전원 단자, SMPS 출력, 변압기 2차
  const sources: { net: number; id: string; real: boolean; derived: boolean }[] = model.sources.map((s) => ({ ...s, real: false, derived: false }));
  for (const s of model.smpsList) sources.push({ net: s.outP, id: '+24V', real: false, derived: true }, { net: s.outM, id: '0V', real: false, derived: true });
  // 인버터 출력 U V W 는 3상 전원 (돌고 있을 때)
  for (const v of model.vfdList) ['L1', 'L2', 'L3'].forEach((id, k) => sources.push({ net: v.uvw[k], id, real: false, derived: true }));
  for (const t of model.trList) {
    ['L1', 'L2', 'L3'].forEach((id, k) => poleLive(c, id) && sources.push({ net: t.x[k], id, real: false, derived: true }));
    if (poleLive(c, 'N')) sources.push({ net: t.x0, id: 'N', real: false, derived: true });
  }
  const polesOf = (g: Groups) => {
    const m = new Map<number, Set<string>>();
    for (const s of sources) m.set(g.find(s.net), (m.get(g.find(s.net)) ?? new Set()).add(s.id));
    return (x: number): Set<string> => m.get(g.find(x)) ?? new Set();
  };
  const tiePoles = polesOf(tie);
  const feedPoles = polesOf(feed);
  const allPoles = polesOf(all);
  // 부하를 거쳐서라도 닿는가 (직렬 연결을 가려내려고)
  const series = new Groups(n);
  for (const k of model.conductors) series.union(k.a, k.b);
  const pinNet = (p: Part, i: number) => net.pinNet.get(`${p.id}:${i}`)!;
  const loadPins = (p: Part): number[] => (THREE.has(p.type) ? [0, 1, 2] : PARTS[p.type].selfCoil ?? PARTS[p.type].loadPins ?? [0, 1]);
  for (const p of model.loads) {
    const idx = loadPins(p);
    for (let i = 1; i < idx.length; i++) series.union(pinNet(p, idx[0]), pinNet(p, idx[i]));
  }
  const seriesPoles = polesOf(series);
  const name = (p: Part) => p.tag.trim() || partKindName(p.type);
  const label = (p: Part, i: number) => partPins(p)[i]?.label || String(i + 1);
  const wired = (x: number) => net.pinCount[x] > 1 || net.hasWire[x];
  const sys = systemVolts(c);
  const volt = (a: string, b: string): number => {
    const [pa, pb] = [sys.phasor[a], sys.phasor[b]];
    return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : 0;
  };
  const neutral = (id: string) => id === 'N' || id === '0V';
  const live = (id: string) => POLE_SYSTEM[id] === 'ac' || POLE_SYSTEM[id] === 'dc';
  /** 두 단자에 걸릴 수 있는 전원 극의 짝 (같은 계통, 서로 다른 극). 중성선이 낀 짝을 먼저 */
  const pair = (A: Set<string>, B: Set<string>): [string, string] | null => {
    let best: [string, string] | null = null;
    let score = -1;
    for (const a of A)
      for (const b of B) {
        if (a === b || !live(a) || !live(b) || POLE_SYSTEM[a] !== POLE_SYSTEM[b]) continue;
        const s = (neutral(a) || neutral(b) ? 1e6 : 0) + volt(a, b);
        if (s > score) [best, score] = [[a, b], s];
      }
    return best;
  };
  const realCircuit = c.parts.some((p) => REAL.has(p.type) && p.type !== 'r_panel');

  // ── 1) 전원 극끼리 바로 이어짐 (단락)
  {
    const groups = new Map<number, Set<string>>();
    for (const s of sources) groups.set(feed.find(s.net), (groups.get(feed.find(s.net)) ?? new Set()).add(s.id));
    for (const [g, ids] of groups) {
      if (ids.size < 2) continue;
      const wires = c.wires.filter((w) => net.wireNet.get(w.id) !== undefined && feed.find(net.wireNet.get(w.id)!) === g).map((w) => w.id);
      const list = [...ids].join(' · ');
      out.push({ level: 'error', msg: tr(`단락: ${list} 이(가) 부하 없이 선 (차단기 · 퓨즈) 으로만 이어져 있습니다. 전원을 넣으면 차단기가 떨어집니다`, `Short circuit: ${list} are joined by wires (through breakers or fuses) with no load between`), partIds: [], wireIds: wires });
    }
  }

  // ── 2) 부하: 전원까지 이어지는가, 걸리는 전압이 정격과 맞는가, 접점이 N 쪽에 있지 않은가
  for (const p of model.loads) {
    const idx = loadPins(p);
    const nets = idx.map((i) => pinNet(p, i));
    if (nets.some((x) => x === undefined)) continue;
    if (nets.every((x) => !wired(x))) {
      if (realCircuit && REAL.has(p.type)) out.push({ level: 'warn', msg: tr(`${name(p)}: 아직 배선되지 않았습니다`, `${name(p)}: not wired yet`), partIds: [p.id] });
      continue;
    }
    if (THREE.has(p.type)) {
      const phases = nets.map((x) => [...allPoles(x)].filter((id) => id === 'L1' || id === 'L2' || id === 'L3'));
      const dead = idx.filter((_, k) => !phases[k].length);
      if (dead.length) {
        out.push({ level: 'error', msg: tr(`${name(p)}: ${dead.map((i) => label(p, i)).join(' · ')} 단자에 상이 닿지 않습니다 (결상). 세 선이 모두 전원까지 이어졌는지 확인하세요`, `${name(p)}: no phase reaches ${dead.map((i) => label(p, i)).join(', ')} (open phase)`), partIds: [p.id] });
        continue;
      }
      const ok = phases[0].some((a) => phases[1].some((b) => b !== a && phases[2].some((d) => d !== a && d !== b)));
      if (!ok) out.push({ level: 'error', msg: tr(`${name(p)}: 세 단자에 서로 다른 세 상 (L1 · L2 · L3) 이 닿지 않습니다. 두 단자가 같은 상에 물려 있습니다`, `${name(p)}: the three terminals do not get three different phases`), partIds: [p.id] });
      continue;
    }
    const [A, B] = nets.map(allPoles);
    const got = pair(A, B);
    if (!got) {
      const open = idx.filter((_, k) => ![...allPoles(nets[k])].some(live));
      const viaLoad = open.length > 0 && pair(seriesPoles(nets[0]), seriesPoles(nets[1])) !== null;
      let msg: string;
      if (viaLoad) msg = tr(`${name(p)}: 다른 부하를 거쳐서만 전원에 닿습니다 (직렬 연결). 부하는 전원 두 극 사이에 하나씩 나란히 잇습니다`, `${name(p)}: reaches the supply only through another load (series). Connect each load across the supply on its own`);
      else if (open.length) msg = tr(`${name(p)}: ${open.map((i) => label(p, i)).join(' · ')} 단자가 전원까지 이어지지 않습니다. 선이 빠졌거나 끊겼습니다`, `${name(p)}: terminal ${open.map((i) => label(p, i)).join(', ')} never reaches the supply`);
      else {
        const [a] = [...A].filter(live);
        const [b] = [...B].filter(live);
        msg =
          POLE_SYSTEM[a] !== POLE_SYSTEM[b]
            ? tr(`${name(p)}: 한쪽은 ${POLE_SYSTEM[a] === 'ac' ? '교류' : '직류'} (${a}), 다른 쪽은 ${POLE_SYSTEM[b] === 'ac' ? '교류' : '직류'} (${b}) 에 이어져 있습니다. 교류와 직류가 섞였습니다`, `${name(p)}: one side is on ${a}, the other on ${b} (AC and DC mixed)`)
            : tr(`${name(p)}: 두 단자가 모두 ${a} 쪽에만 이어져 있습니다. 반대 극 (${POLE_SYSTEM[a] === 'dc' ? (a === '0V' ? '+24V' : '0V') : 'N'}) 으로 가는 선이 없습니다`, `${name(p)}: both terminals only reach ${a}; nothing returns to the other pole`);
      }
      out.push({ level: 'error', msg, partIds: [p.id] });
      continue;
    }
    const v = volt(got[0], got[1]);
    const kind = POLE_SYSTEM[got[0]] === 'dc' ? 'dc' : 'ac';
    const conn = `${kind === 'dc' ? 'DC' : 'AC'} ${nominalVolt(v)}V`;
    const rated = ratedVoltage(p);
    if (rated && v > 0) {
      if (rated.kind !== 'any' && rated.kind !== kind)
        out.push({ level: 'error', msg: tr(`${name(p)}: 정격은 ${rated.text} 인데 ${conn} 에 이어져 있습니다 (${kind === 'dc' ? '직류' : '교류'}). 기기를 그 전압용으로 바꾸거나 (속성의 사양) 전원을 확인하세요`, `${name(p)}: rated ${rated.text} but wired to ${conn}`), partIds: [p.id] });
      else if (v > rated.hi * 1.15) out.push({ level: 'error', msg: tr(`${name(p)}: 정격 ${rated.text} 인데 ${conn} 이 걸립니다. 과전압으로 탑니다`, `${name(p)}: rated ${rated.text} but gets ${conn} (overvoltage)`), partIds: [p.id] });
      else if (v < rated.lo * 0.85) out.push({ level: 'error', msg: tr(`${name(p)}: 정격 ${rated.text} 인데 ${conn} 밖에 걸리지 않습니다. 전압이 모자라 동작하지 않거나 떨립니다`, `${name(p)}: rated ${rated.text} but only gets ${conn} (undervoltage)`), partIds: [p.id] });
    }
    // 교류 부하의 한쪽이 상에 바로 물려 있고 접점이 N 쪽에만 있으면, 꺼도 기기에 전압이 남는다
    if (realCircuit && kind === 'ac') {
      const direct = nets.map((x) => feedPoles(x));
      for (const k of [0, 1]) {
        const hot = [...direct[k]].some((id) => id === 'L1' || id === 'L2' || id === 'L3');
        if (hot && !direct[1 - k].has('N') && allPoles(nets[1 - k]).has('N') && ![...direct[1 - k]].some(live)) {
          out.push({ level: 'warn', msg: tr(`${name(p)}: ${label(p, idx[k])} 단자가 상 (L) 에 바로 물려 있고 접점이 N 쪽에 있습니다. 꺼져 있어도 기기에 전압이 남습니다 → 접점은 L 쪽에 두고 N 은 바로 잇습니다`, `${name(p)}: the line is wired straight to ${label(p, idx[k])} and the switching is on the neutral side; switch the line instead`), partIds: [p.id] });
          break;
        }
      }
    }
  }

  // ── 3) 센서 · SMPS 전원
  for (const p of c.parts) {
    if (PROX.has(p.type)) {
      const [bn, bu] = [pinNet(p, 0), pinNet(p, 2)];
      if (![bn, pinNet(p, 1), bu].some(wired)) continue;
      const [A, B] = [allPoles(bn), allPoles(bu)];
      const plus = (s: Set<string>) => [...s].some((id) => live(id) && !neutral(id));
      const minus = (s: Set<string>) => [...s].some(neutral);
      if (plus(A) && minus(B)) continue;
      if (plus(B) && minus(A) && !plus(A)) out.push({ level: 'error', msg: tr(`${name(p)}: 전원 극성이 반대입니다. 갈색 선이 + (24V), 파랑 선이 0V 입니다`, `${name(p)}: supply polarity is reversed (brown = +, blue = 0V)`), partIds: [p.id] });
      else out.push({ level: 'error', msg: tr(`${name(p)}: 센서 전원이 이어지지 않았습니다 (${!plus(A) ? '갈색 → +24V' : ''}${!plus(A) && !minus(B) ? ', ' : ''}${!minus(B) ? '파랑 → 0V' : ''})`, `${name(p)}: sensor supply is not connected`), partIds: [p.id] });
    } else if (p.type === 'r_prox2') {
      // 2선식 센서: 이 센서를 뺀 나머지로 양쪽 끝이 어디에 닿는지 본다
      const [bn, bu] = [pinNet(p, 0), pinNet(p, 1)];
      if (![bn, bu].some(wired)) continue;
      const rest = new Groups(n);
      for (const k of model.conductors) if (k.part.id !== p.id) rest.union(k.a, k.b);
      const restPoles = polesOf(rest);
      const [A, B] = [restPoles(bn), restPoles(bu)];
      const across = pair(A, B);
      if (across) {
        out.push({ level: 'error', msg: tr(`${name(p)}: 부하 없이 전원 두 극 (${across.join(' · ')}) 사이에 바로 물려 있습니다. 2선식 센서는 리밋 스위치처럼 부하와 직렬로 잇습니다 (감지하는 순간 단락되어 센서가 탑니다)`, `${name(p)}: wired straight across the supply (${across.join(', ')}). A 2-wire sensor goes in series with a load; it shorts and burns when it detects`), partIds: [p.id] });
        continue;
      }
      if (!p.ac && ((B.has('+24V') && !A.has('+24V')) || (A.has('0V') && !B.has('0V'))))
        out.push({ level: 'error', msg: tr(`${name(p)}: 극성이 반대입니다. 직류 2선식 센서는 갈색이 + 쪽, 파랑이 0V 쪽입니다 (거꾸로면 켜지지 않습니다)`, `${name(p)}: reversed polarity; on a DC 2-wire sensor brown goes to the + side and blue to the 0 V side`), partIds: [p.id] });
      const sys = new Set([...seriesPoles(bn), ...seriesPoles(bu)].filter(live).map((id) => POLE_SYSTEM[id]));
      if (!p.ac && sys.has('ac') && !sys.has('dc')) out.push({ level: 'error', msg: tr(`${name(p)}: 직류용 (DC 12-24V) 2선식 센서가 교류 회로에 있습니다. 속성에서 AC 용으로 바꾸거나 직류 회로에 잇습니다`, `${name(p)}: a DC 2-wire sensor in an AC circuit`), partIds: [p.id] });
      if (p.ac && sys.has('dc') && !sys.has('ac')) out.push({ level: 'error', msg: tr(`${name(p)}: 교류용 (AC 100-240V) 2선식 센서가 직류 회로에 있습니다. 속성에서 DC 용으로 바꿉니다`, `${name(p)}: an AC 2-wire sensor in a DC circuit`), partIds: [p.id] });
    } else if (p.type === 'r_sol' && p.conn !== 'din' && !solAc(p)) {
      // 직류 코일 리드선: 빨강이 +, 검정이 - (LED · 서지 흡수 다이오드가 든 코일은 극성이 있다)
      const [a, b] = [pinNet(p, 0), pinNet(p, 1)];
      if (![a, b].some(wired)) continue;
      const [A, B] = [allPoles(a), allPoles(b)];
      if (B.has('+24V') && A.has('0V') && !A.has('+24V')) out.push({ level: 'warn', msg: tr(`${name(p)}: 리드선 극성이 반대입니다. 직류 코일은 빨강이 + (24V), 검정이 0V 쪽입니다 (표시등이 안 켜지고, 서지 흡수 다이오드가 든 코일은 상할 수 있음)`, `${name(p)}: lead polarity reversed; red is + and black is 0 V on a DC coil`), partIds: [p.id] });
    } else if (p.type === 'r_ssr') {
      const [a, b] = [pinNet(p, 2), pinNet(p, 3)];
      if (![a, b].some(wired)) continue;
      const [A, B] = [allPoles(a), allPoles(b)];
      if (B.has('+24V') && A.has('0V') && !A.has('+24V')) out.push({ level: 'error', msg: tr(`${name(p)}: 입력 극성이 반대입니다. 3 에 + (24V), 4 에 0V 를 잇습니다`, `${name(p)}: input polarity is reversed (3 = +, 4 = 0 V)`), partIds: [p.id] });
    } else if (p.type === 'r_vfd') {
      // 인버터: 전원은 R S T, 전동기는 U V W (바꾸어 물리면 인버터가 탐), 입력 단자는 무전압 접점만, 접지
      const v = model.vfdList.find((x) => x.part.id === p.id);
      if (!v) continue;
      const onOut = new Set(v.uvw.flatMap((n) => sources.filter((s) => !s.derived && all.find(s.net) === all.find(n)).map((s) => s.id)));
      if (onOut.size) out.push({ level: 'error', msg: tr(`${name(p)}: 출력 U · V · W 에 전원 (${[...onOut].join(' · ')}) 이 닿습니다. 전원은 R/L1 · S/L2 · T/L3 에, 전동기는 U · V · W 에 잇습니다 (출력에 전원이 들어가면 인버터가 탑니다. 인버터와 전동기 사이 바이패스 접촉기는 인터록 필수)`, `${name(p)}: supply (${[...onOut].join(', ')}) reaches U, V, W; mains go to R/S/T and the motor to U/V/W`), partIds: [p.id] });
      const hot = new Set([...v.ins, v.sd].flatMap((n) => [...allPoles(n)].filter((id) => live(id) && !onOut.has(id) && !v.uvw.some((u) => all.find(u) === all.find(n)))));
      if (hot.size) out.push({ level: 'error', msg: tr(`${name(p)}: 입력 단자 (STF · STR · RH · RM · RL · SD) 에 전원 (${[...hot].join(' · ')}) 이 닿습니다. 입력은 인버터 안의 DC 24V 로 도는 무전압 접점 입력이라, 버튼 · 셀렉터 · 릴레이 접점만 입력과 SD 사이에 넣습니다`, `${name(p)}: supply (${[...hot].join(', ')}) reaches the control inputs; use only dry contacts between the inputs and SD`), partIds: [p.id] });
      const rst = v.rst.map((n) => [...allPoles(n)].filter((id) => id === 'L1' || id === 'L2' || id === 'L3'));
      const phases = new Set(rst.flat());
      if (!p.ph1 && v.rst.some(wired) && phases.size < 3) out.push({ level: 'warn', msg: tr(`${name(p)}: R/L1 · S/L2 · T/L3 에 3상이 다 오지 않습니다 (${[...phases].join(' · ') || '없음'}). 단상 입력 기종이면 속성에서 [단상 입력] 을 켜세요`, `${name(p)}: R/S/T do not get all three phases; tick "single-phase input" for a single-phase model`), partIds: [p.id] });
      if (realCircuit && wired(pinNet(p, 3)) === false) out.push({ level: 'warn', msg: tr(`${name(p)}: 접지 (PE) 가 이어지지 않았습니다. 인버터는 노이즈 필터로 평상시에도 접지로 전류가 새므로 반드시 접지합니다 (전동기 외함도)`, `${name(p)}: PE is not connected; an inverter must be earthed (and the motor frame)`), partIds: [p.id] });
    } else if (p.type === 'r_flr') {
      // 플로트리스 릴레이: 전극 E1 · E2 · E3 은 릴레이 안의 낮은 교류로 물을 재는 단자 (전원이 닿으면 탐), 수조 전극봉에 이름대로
      const d = [...model.flrDef.values()].find((x) => x.part.id === p.id);
      if (!d) continue;
      const hot = new Set(d.e.flatMap((x) => [...allPoles(x)].filter(live)));
      if (hot.size) {
        out.push({ level: 'error', msg: tr(`${name(p)}: 전극 단자 (E1 · E2 · E3) 에 전원 (${[...hot].join(' · ')}) 이 닿습니다. 전극 회로는 릴레이 안의 낮은 교류 전압으로 물을 재는 곳이라 수조 전극봉만 잇습니다 (입력 회로가 탑니다)`, `${name(p)}: supply (${[...hot].join(', ')}) reaches the electrode terminals; connect only the tank electrodes`), partIds: [p.id] });
        continue;
      }
      if (!d.e.some(wired)) continue;
      // 이 단자에 (선 · 단자대로) 이어진 수조 전극봉: [수조, 전극 차례]
      const tanks = c.parts.filter((q) => q.type === 'r_tank');
      const elec = d.e.map((x) => {
        for (const q of tanks) for (const k of [0, 1, 2]) if (tie.find(pinNet(q, k)) === tie.find(x)) return [q, k] as const;
        return null;
      });
      if (!elec[0] || !elec[2]) {
        out.push({ level: 'warn', msg: tr(`${name(p)}: ${[!elec[0] ? 'E1' : '', !elec[2] ? 'E3' : ''].filter(Boolean).join(' · ')} 이(가) 수조 전극봉에 이어지지 않아 수위를 잴 수 없습니다 (E1 = 상한, E2 = 하한, E3 = 공통 · 가장 긴 전극)`, `${name(p)}: ${[!elec[0] ? 'E1' : '', !elec[2] ? 'E3' : ''].filter(Boolean).join(', ')} not wired to the tank electrodes`), partIds: [p.id] });
        continue;
      }
      const h = elec.map((x) => (x ? tankSetting(x[0]).e[x[1]] : null));
      if (h[1] !== null && (h[0]! <= h[1] || h[2]! > h[1]))
        out.push({ level: 'warn', msg: tr(`${name(p)}: 전극이 바뀌어 이어졌습니다 (E1 ${h[0]}% · E2 ${h[1]}% · E3 ${h[2]}%). E1 은 가장 짧은 상한 전극, E2 는 하한, E3 은 가장 긴 공통 전극에 잇습니다 (그렇지 않으면 펌프가 짧게 켜졌다 꺼짐을 되풀이합니다)`, `${name(p)}: electrodes swapped (E1 ${h[0]}%, E2 ${h[1]}%, E3 ${h[2]}%); E1 = shortest (high), E2 = low, E3 = longest (common)`), partIds: [p.id, elec[0][0].id] });
      else if (h[1] === null)
        out.push({ level: 'warn', msg: tr(`${name(p)}: E2 (하한) 가 수조에 이어지지 않아 E1 에 닿을 때만 켜지고 물결에도 바로 꺼집니다 (펌프가 짧게 켜졌다 꺼짐을 되풀이). 하한 전극을 E2 에 잇습니다`, `${name(p)}: E2 (low) is not wired, so the relay has no hold band and the pump will chatter`), partIds: [p.id] });
    } else if (p.type === 'diode' || p.type === 'r_diode') {
      // 다이오드 (환류): 직류 코일 양단에 K (띠) 를 + 쪽으로. 거꾸로면 코일이 켜질 때 단락, 교류에는 쓸 수 없음
      const [k, a] = [pinNet(p, 0), pinNet(p, 1)];
      if (![k, a].every(wired)) continue;
      const [K, A] = [allPoles(k), allPoles(a)];
      if ([...K, ...A].some((id) => POLE_SYSTEM[id] === 'ac')) {
        out.push({ level: 'error', msg: tr(`${name(p)}: 교류 회로에 달려 있습니다. 다이오드는 반 주기마다 전류를 그대로 흘려 코일이 동작하지 않거나 단락됩니다. 교류 코일의 서지는 스파크 킬러 (CR) · 바리스터로 흡수합니다`, `${name(p)}: in an AC circuit; a diode conducts every half cycle. Use an RC snubber or varistor on AC coils`), partIds: [p.id] });
        continue;
      }
      const plus = (S: Set<string>) => S.has('+24V');
      const zero = (S: Set<string>) => S.has('0V');
      const [fK, fA] = [feedPoles(k), feedPoles(a)];
      if (plus(fA) && zero(fK)) {
        out.push({ level: 'error', msg: tr(`${name(p)}: 전원 (+24V → 0V) 에 순방향으로 바로 물려 있어 단락됩니다 (SMPS 보호 · 퓨즈 끊김). 다이오드는 코일 양단에 K (띠) 를 + 쪽으로 답니다`, `${name(p)}: forward-biased straight across the supply (short circuit); fit it across the coil, band (K) to +`), partIds: [p.id] });
        continue;
      }
      if (plus(fK) && zero(fA)) {
        out.push({ level: 'warn', msg: tr(`${name(p)}: 전원 양단에 바로 물려 있어 서지를 흡수하지 못합니다. 끄고 켜는 코일 (릴레이 · SOL) 의 두 단자에 답니다`, `${name(p)}: across the supply, so it suppresses nothing; fit it across the switched coil`), partIds: [p.id] });
        continue;
      }
      if (plus(A) && zero(K) && !plus(K)) {
        out.push({ level: 'error', msg: tr(`${name(p)}: 방향이 거꾸로입니다 (A 가 + 쪽). 코일에 전원이 들어가는 순간 다이오드로 단락됩니다. K (띠) 를 + 쪽, A 를 0V 쪽으로 돌려 답니다`, `${name(p)}: reversed (A on the + side); it shorts the supply as soon as the coil is energised. Band (K) to +, A to 0 V`), partIds: [p.id] });
        continue;
      }
      const across = model.conductors.find((q) => !q.always && !FEED.has(q.part.type) && ((tie.find(q.a) === tie.find(a) && tie.find(q.b) === tie.find(k)) || (tie.find(q.a) === tie.find(k) && tie.find(q.b) === tie.find(a))));
      if (across) out.push({ level: 'warn', msg: tr(`${name(p)}: 접점 ${name(across.part)} 의 양단에 달려 있습니다. 서지를 흡수하려면 접점이 아니라 코일 (부하) 양단에 답니다 (방향에 따라 접점이 열려도 부하가 켜집니다)`, `${name(p)}: fitted across contact ${name(across.part)}; fit it across the coil instead`), partIds: [p.id, across.part.id] });
    } else if (p.type === 'sk' || p.type === 'r_sk') {
      // 스파크 킬러 (CR): 교류 코일 양단이 제자리. 접점 양단이면 열려도 새고, 직류는 다이오드, 전원 양단은 늘 흐름
      const [a, b] = [pinNet(p, 0), pinNet(p, 1)];
      if (![a, b].every(wired)) continue;
      const [A, B] = [allPoles(a), allPoles(b)];
      const pr = pair(A, B);
      const v = pr ? volt(pr[0], pr[1]) : 0;
      if ([...A, ...B].some((id) => POLE_SYSTEM[id] === 'dc')) {
        out.push({ level: 'warn', msg: tr(`${name(p)}: 직류 회로입니다. 직류 코일 (DC 24V SOL · 릴레이) 의 서지는 스파크 킬러가 아니라 다이오드 (코일과 반대 방향, 환류) 나 TVS 로 흡수합니다. 서지 흡수 내장 코일이면 따로 달지 않아도 됩니다`, `${name(p)}: this is a DC circuit; suppress DC coils with a flyback diode or TVS instead`), partIds: [p.id] });
        continue;
      }
      const fp = pair(feedPoles(a), feedPoles(b));
      const across = model.conductors.find((k) => !k.always && !FEED.has(k.part.type) && k.part.id !== p.id && ((tie.find(k.a) === tie.find(a) && tie.find(k.b) === tie.find(b)) || (tie.find(k.a) === tie.find(b) && tie.find(k.b) === tie.find(a))));
      if (fp) {
        const ma = skLeakMa(p, volt(fp[0], fp[1]));
        out.push({ level: 'warn', msg: tr(`${name(p)}: 전원 (${fp[0]} · ${fp[1]}) 양단에 바로 물려 늘 약 ${ma.toFixed(1)} mA 가 흐릅니다 (서지를 흡수하지 못함). 스파크 킬러는 끄고 켜는 코일 (SOL · MC · 릴레이) 의 두 단자에 답니다`, `${name(p)}: across the supply (${fp[0]}, ${fp[1]}): about ${ma.toFixed(1)} mA flows all the time. Fit it across the coil that is switched`), partIds: [p.id] });
      } else if (across) {
        const ma = skLeakMa(p, v || 220);
        const g = [tie.find(a), tie.find(b)];
        const loads = model.loads.filter((q) => q.id !== p.id && loadPins(q).some((i) => g.includes(tie.find(pinNet(q, i)))));
        const who = loads.map(name).join(' · ');
        out.push({
          level: 'warn',
          msg: tr(
            `${name(p)}: 접점 ${name(across.part)} 의 양단에 달려 있어, 접점이 열려도 약 ${ma.toFixed(1)} mA 가 ${who || '부하'} 쪽으로 샙니다. 소형 릴레이 (1 VA 급 코일 ≈ 5 mA) · LED 램프 · PLC 입력은 꺼지지 않거나 희미하게 켜질 수 있습니다. 스파크 킬러는 접점이 아니라 코일 (부하) 양단에 다세요`,
            `${name(p)}: fitted across contact ${name(across.part)}, so about ${ma.toFixed(1)} mA leaks to ${who || 'the load'} when it is open; small relays, LED lamps and PLC inputs may not switch off. Fit it across the coil instead`,
          ),
          partIds: [p.id, across.part.id, ...loads.map((q) => q.id)],
        });
      }
      const rated = ratedVoltage(p)?.hi ?? 250;
      if (v > rated * 1.1) out.push({ level: 'warn', msg: tr(`${name(p)}: 걸리는 전압 약 ${Math.round(v)} V 가 정격 ${rated} V 를 넘습니다. 그 전압용 (AC 440V · 600V) 을 쓰세요`, `${name(p)}: about ${Math.round(v)} V exceeds its ${rated} V rating`), partIds: [p.id] });
    } else if (rtdInputPins(p)) {
      // 측온저항체 입력 A · B · B': 센서 세 가닥이 같은 이름 단자에. 전원이 닿으면 입력 회로가 탄다
      const sensor = rtdInputPins(p)!.map((i) => pinNet(p, i));
      const hot = new Set(sensor.flatMap((x) => [...allPoles(x)].filter(live)));
      if (hot.size) out.push({ level: 'error', msg: tr(`${name(p)}: 센서 단자 (A · B · B') 에 전원 (${[...hot].join(' · ')}) 이 닿습니다. 측온저항체 리드선만 잇습니다 (입력 회로가 탑니다)`, `${name(p)}: supply (${[...hot].join(', ')}) reaches the sensor terminals; connect only the RTD leads`), partIds: [p.id] });
      else {
        const d = [...model.tempDef.values()].find((x) => x.part.id === p.id);
        if (d && !d.sensorOk)
          out.push({ level: 'warn', msg: tr(`${name(p)}: 측온저항체가 A · B · B' 에 제대로 이어지지 않았습니다 (A ↔ A, B · B' ↔ 같은 색 두 가닥). 센서가 끊긴 것으로 보고 출력을 끕니다 (oPEn)`, `${name(p)}: the RTD is not wired A↔A and B/B'↔the two same-colour leads; the controller reads an open sensor and switches its output off`), partIds: [p.id] });
        else if (d?.rtdEl) {
          // 한 소자를 두 기기가 같이 쓰면 두 기기의 측정 전류가 한 저항에 섞여 둘 다 틀린 값을 읽는다 (앞 기기에서 한 번만 알린다)
          const share = [...model.tempDef.values()].filter((x) => x.rtdEl === d.rtdEl);
          if (share.length > 1 && share[0].part.id === p.id)
            out.push({ level: 'warn', msg: tr(`${share.map((x) => name(x.part)).join(' · ')}: 측온저항체 소자 하나를 같이 씁니다. 두 기기의 측정 전류가 섞여 둘 다 온도가 틀어집니다. 더블 Pt100 (소자 2개) 을 써서 기기마다 소자를 따로 잇습니다`, `${share.map((x) => name(x.part)).join(', ')} share one RTD element; their measuring currents mix and both read wrong. Use a duplex Pt100, one element each`), partIds: share.map((x) => x.part.id) });
        }
      }
    } else if (p.type === 'r_counter') {
      const hot = new Set([2, 3, 4].flatMap((i) => [...allPoles(pinNet(p, i))].filter(live)));
      if (hot.size) out.push({ level: 'error', msg: tr(`${name(p)}: 입력 (CP · RST · COM) 은 무전압 접점 입력인데 전원 (${[...hot].join(' · ')}) 이 닿습니다. 리밋 스위치 · 버튼의 접점만 CP-COM, RST-COM 사이에 넣으세요`, `${name(p)}: the inputs (CP, RST, COM) are dry contacts but ${[...hot].join(', ')} reaches them; put only switch contacts between CP/RST and COM`), partIds: [p.id] });
    } else if (SMPS.has(p.type)) {
      const [l, nn] = [pinNet(p, 0), pinNet(p, 1)];
      if (!PARTS[p.type].pins.some((_, i) => wired(pinNet(p, i)))) continue;
      if (!pair(allPoles(l), allPoles(nn))) out.push({ level: 'error', msg: tr(`${name(p)}: 입력 전원 (L · N) 이 이어지지 않았습니다. 출력 24V 가 나오지 않습니다`, `${name(p)}: input supply (L, N) is not connected`), partIds: [p.id] });
    }
  }

  // ── 4) 끝이 떠 있는 선 (기호 회로의 모선은 끝이 남아도 되므로 실물 배선에서만)
  if (realCircuit) {
    const pinAt = new Set<string>();
    for (const p of c.parts) if (p.type !== 'text' && p.type !== 'r_panel') pinPositions(p).forEach(([x, y]) => pinAt.add(`${x},${y}`));
    const everything = circuitWires(c);
    const ends = new Map<string, number>();
    for (const w of everything) for (const e of [w.a, w.b]) ends.set(`${e[0]},${e[1]}`, (ends.get(`${e[0]},${e[1]}`) ?? 0) + 1);
    const loose = c.wires.filter((w) => [w.a, w.b].some((e) => !pinAt.has(`${e[0]},${e[1]}`) && (ends.get(`${e[0]},${e[1]}`) ?? 0) < 2 && !everything.some((o) => o.id !== w.id && onWireInterior(o, e[0], e[1]))));
    if (loose.length) out.push({ level: 'warn', msg: tr(`끝이 어디에도 물리지 않은 선 ${loose.length}가닥이 있습니다. 단자까지 잇거나 지우세요`, `${loose.length} wire(s) have a loose end; connect them to a terminal or delete them`), partIds: [], wireIds: loose.map((w) => w.id) });
  }

  if (realCircuit) {
    // ── 5) 나사 단자 하나에 3가닥 이상
    for (const p of c.parts) {
      if (!REAL.has(p.type) || p.type === 'r_term' || p.type === 'r_bus' || p.type === 'r_panel') continue;
      pinPositions(p).forEach(([x, y], i) => {
        let count = 0;
        for (const w of c.wires) {
          if ((w.a[0] === x && w.a[1] === y) || (w.b[0] === x && w.b[1] === y)) count++;
          else if (onWireInterior(w, x, y)) count += 2;
        }
        if (count >= 3) out.push({ level: 'warn', msg: tr(`${name(p)} ${label(p, i)}: 나사 단자 하나에 전선 ${count}가닥이 물려 있습니다. 보통 2가닥까지이니 단자대나 옆 단자로 건너가는 점퍼로 나누세요`, `${name(p)} ${label(p, i)}: ${count} wires on one screw; use a terminal block or a jumper (two at most)`), partIds: [p.id] });
      });
    }

    // ── 6) 차단기 · 퓨즈 없이 전원 상에 바로 물린 기기
    {
      const pinsOf = new Map<number, Part[]>();
      for (const p of c.parts) {
        if (PASSIVE.has(p.type)) continue;
        partPins(p).forEach((d, i) => {
          if (d.air) return;
          const g = bare.find(pinNet(p, i));
          if (!pinsOf.get(g)?.includes(p)) pinsOf.set(g, [...(pinsOf.get(g) ?? []), p]);
        });
      }
      const seen = new Set<string>();
      for (const s of sources) {
        if (s.derived || (s.id !== 'L1' && s.id !== 'L2' && s.id !== 'L3')) continue;
        const parts = (pinsOf.get(bare.find(s.net)) ?? []).filter((p) => !seen.has(`${s.id}:${p.id}`));
        if (!parts.length) continue;
        parts.forEach((p) => seen.add(`${s.id}:${p.id}`));
        const names = parts.slice(0, 4).map(name).join(' · ') + (parts.length > 4 ? ' …' : '');
        out.push({ level: 'warn', msg: tr(`전원 ${s.id} 이 차단기 · 퓨즈를 거치지 않고 ${names} 에 바로 이어져 있습니다. 전원 바로 아래에 차단기를 두세요`, `Supply ${s.id} reaches ${names} without a breaker or fuse`), partIds: parts.map((p) => p.id) });
      }
    }

    // ── 7) 접지 (PE · FG) 단자
    {
      const hasPe = sources.some((s) => s.id === 'PE');
      // 직류 솔레노이드 (DIN 커넥터) 는 접지가 없어도 된다
      const open = c.parts.filter((p) => REAL.has(p.type) && !(p.type === 'r_sol' && !solAc(p)) && partPins(p).some((d, i) => (d.label === 'PE' || d.label === 'FG') && !tiePoles(pinNet(p, i)).has('PE')) && partPins(p).some((_, i) => wired(pinNet(p, i))));
      if (open.length)
        out.push({
          level: 'warn',
          msg: hasPe
            ? tr(`${open.map(name).join(' · ')}: 접지 (PE) 단자가 접지에 이어지지 않았습니다. 녹황 전선으로 PE 에 잇습니다`, `${open.map(name).join(', ')}: the PE terminal is not earthed`)
            : tr(`${open.map(name).join(' · ')}: 접지 (PE) 가 없습니다. 전원 단자 PE 를 놓고 녹황 전선으로 기기의 PE 단자에 잇습니다`, `${open.map(name).join(', ')}: no earth; place a PE terminal and connect it`),
          partIds: open.map((p) => p.id),
        });
    }

    // ── 8) 전선 색과 극
    {
      const bad = new Map<string, { msg: string; level: 'error' | 'warn'; wires: string[] }>();
      const add = (key: string, level: 'error' | 'warn', msg: string, id: string) => {
        const cur = bad.get(key) ?? { msg, level, wires: [] };
        cur.wires.push(id);
        bad.set(key, cur);
      };
      const cn = (col: WireColor) => tr(COLOR_NAME[col][0], COLOR_NAME[col][1]);
      for (const w of c.wires) {
        const x = net.wireNet.get(w.id);
        if (!w.color || x === undefined || model.airNets.has(x)) continue;
        const poles = feedPoles(x);
        if (poles.size !== 1) continue;
        const [id] = [...poles];
        const phase = id === 'L1' || id === 'L2' || id === 'L3';
        if (id === 'PE' && w.color !== 'gy') add('pe', 'error', tr('접지 (PE) 선인데 녹황이 아닌 전선', 'Earth (PE) wires that are not green-yellow'), w.id);
        else if (w.color === 'gy' && id !== 'PE') add(`gy:${id}`, 'error', tr(`녹황 전선은 접지 전용인데 ${id} 에 물려 있습니다`, `Green-yellow is for earth only but is on ${id}`), w.id);
        else if (id === 'N' && w.color !== 'blue') add('n', 'warn', tr('중성선 (N) 인데 파랑이 아닌 전선', 'Neutral (N) wires that are not blue'), w.id);
        else if (w.color === 'blue' && phase) add(`blue:${id}`, 'warn', tr(`파랑은 중성선 (N) 색인데 ${id} 에 물려 있습니다`, `Blue is the neutral colour but is on ${id}`), w.id);
        else if (phase && (w.color === 'brown' || w.color === 'black' || w.color === 'grey') && POLE_WIRE[id] !== w.color) add(`ph:${id}:${w.color}`, 'warn', tr(`${id} 선인데 ${cn(w.color)} 입니다 (${id} 은 ${cn(POLE_WIRE[id])})`, `${id} wires drawn ${cn(w.color)} (should be ${cn(POLE_WIRE[id])})`), w.id);
      }
      for (const b of bad.values()) out.push({ level: b.level, msg: `${b.msg} ${tr(`${b.wires.length}가닥`, `(${b.wires.length})`)}`, partIds: [], wireIds: b.wires });
    }
  }
  // TT 계통: 지락 전류가 작아 (약 2 A) 일반 차단기가 떨어지지 않으니 누전차단기가 있어야 한다
  if (c.earthing === 'TT') {
    const bad = earthStudy(c, model).rows.filter((r) => r.r.level === 'danger');
    if (bad.length)
      out.push({
        level: 'warn',
        msg: tr(
          `TT 계통인데 ${bad.map((r) => r.name).join(' · ')} 이(가) 누전 때 끊기지 않습니다 (지락 전류가 작아 차단기가 떨어지지 않고 외함에 위험한 전압이 남거나, 외함이 접지되지 않음) → 누전차단기 (30 mA) 를 거치게 하고 외함을 접지하세요. [해석] 의 누전 · 지락 검토를 보세요`,
          `TT system: ${bad.map((r) => r.name).join(', ')} would not be disconnected on an earth fault (fault current too small for the breaker, or the frame is not earthed) — feed it through an RCD (30 mA) and earth the frame; see Earth faults in Analysis`,
        ),
        partIds: bad.map((r) => r.part.id),
      });
  }
  out.push(...plcChecks(model, { allPoles, bare, sources, wired, name, pinNet }));
  return out;
}

/** 전자접촉기 코일 · 전동기처럼 PLC 출력 접점으로 바로 켜면 안 되는 부하 */
const HEAVY: ReadonlySet<PartType> = new Set(['r_mc', 'r_motor3', 'r_motor6', 'motor', 'motor3', 'r_load1', 'r_load3', 'load', 'r_fan']);

/**
 * PLC 가 상하지 않게: 입력에 교류, 입력 공통 · 출력 공통이 빠짐, 출력 공통에 퓨즈 없음,
 * 출력 접점으로 전자접촉기 코일 · 전동기 · 교류 솔레노이드를 바로 켬, HMI 버튼이 PLC 입력에 씀
 */
function plcChecks(
  model: CircuitModel,
  h: { allPoles: (x: number) => Set<string>; bare: Groups; sources: { net: number; id: string }[]; wired: (x: number) => boolean; name: (p: Part) => string; pinNet: (p: Part, i: number) => number },
): WiringIssue[] {
  const out: WiringIssue[] = [];
  const { allPoles, bare, sources, wired, name, pinNet } = h;
  const ac = (x: number) => [...allPoles(x)].filter((id) => POLE_SYSTEM[id] === 'ac');
  // 출력에서 부하까지: PLC 출력 접점은 빼고 다른 접점 · 선 · 단자대를 따라가되, 전원이 직접 닿은 넷에서는 멈춘다
  const adj = new Map<number, number[]>();
  for (const k of model.conductors) {
    if (k.plcOut !== undefined) continue;
    adj.set(k.a, [...(adj.get(k.a) ?? []), k.b]);
    adj.set(k.b, [...(adj.get(k.b) ?? []), k.a]);
  }
  const srcNets = new Set(sources.map((s) => s.net));
  const loadsAt = new Map<number, Part[]>();
  for (const p of model.loads) {
    const def = PARTS[p.type];
    const idx = def.selfCoil ?? def.loadPins ?? (p.type === 'r_motor3' || p.type === 'r_motor6' || p.type === 'r_load3' || p.type === 'motor3' ? [0, 1, 2] : [0, 1]);
    for (const i of idx) {
      const x = pinNet(p, i);
      if (x !== undefined) loadsAt.set(x, [...(loadsAt.get(x) ?? []), p]);
    }
  }
  const driven = (start: number): Part[] => {
    const seen = new Set([start]);
    const todo = [start];
    const found: Part[] = [];
    while (todo.length) {
      const x = todo.pop()!;
      for (const p of loadsAt.get(x) ?? []) if (!found.includes(p)) found.push(p);
      if (srcNets.has(x)) continue;
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) seen.add(y), todo.push(y);
    }
    return found;
  };
  const heavy = (p: Part) => HEAVY.has(p.type) || (p.type === 'coil' && /^(MC|KM)/i.test(p.tag.trim())) || ((p.type === 'r_sol' || p.type === 'sol') && ac(pinNet(p, 0)).length > 0);
  for (const b of model.plcs) {
    const p = b.part;
    if (p.type !== 'r_plc') continue;
    // 입력: DC 24V 전용
    const acIn = b.inNets.map((x, i) => (wired(x) && ac(x).length ? b.inAddr[i] : '')).filter(Boolean);
    if (acIn.length)
      out.push({ level: 'error', msg: tr(`${name(p)}: 입력 ${acIn.join(' · ')} 에 교류 (${[...new Set(b.inNets.flatMap(ac))].join(' · ')}) 가 닿을 수 있습니다. 이 PLC 입력은 DC 24V 용이라 입력 회로가 탑니다 → 교류 신호는 보조 릴레이 접점으로 바꿔 DC 24V 로 받습니다`, `${name(p)}: inputs ${acIn.join(', ')} can see AC; these are 24 V DC inputs and burn — convert AC signals through a relay contact`), partIds: [p.id] });
    const com = b.com!;
    if (b.inNets.some(wired) && !wired(com)) out.push({ level: 'warn', msg: tr(`${name(p)}: 입력 공통 COM 이 이어지지 않아 입력이 들어오지 않습니다. 싱크 입력이면 COM 을 0V 에 잇습니다`, `${name(p)}: input COM is not wired, so no input turns on; for sink inputs connect COM to 0 V`), partIds: [p.id] });
    else if (wired(com) && ac(com).length) out.push({ level: 'error', msg: tr(`${name(p)}: 입력 공통 COM 에 교류가 닿습니다. COM 은 DC 24V 전원 (0V 또는 +24V) 에 잇습니다`, `${name(p)}: input COM sees AC; tie it to the 24 V DC supply`), partIds: [p.id] });
    // 출력 공통: 그룹마다 이어졌는가, 퓨즈 · 차단기를 거치는가
    for (const [g, ci] of [
      [0, RPLC.com0],
      [1, RPLC.com1],
    ] as const) {
      const outs = b.outAddr.map((a, n) => ({ a, n })).filter(({ n }) => (n < 8 ? 0 : 1) === g && wired(pinNet(p, RPLC.out0 + n)));
      if (!outs.length) continue;
      const cn = pinNet(p, ci);
      const label = g === 0 ? 'COM0' : 'COM1';
      if (!wired(cn)) {
        out.push({ level: 'warn', msg: tr(`${name(p)}: 출력 공통 ${label} 이 이어지지 않아 ${outs.map((o) => o.a).join(' · ')} 이(가) 아무것도 켜지 못합니다`, `${name(p)}: output common ${label} is not wired, so ${outs.map((o) => o.a).join(', ')} switch nothing`), partIds: [p.id] });
        continue;
      }
      const direct = sources.filter((s) => bare.find(s.net) === bare.find(cn)).map((s) => s.id);
      if (direct.length)
        out.push({ level: 'warn', msg: tr(`${name(p)}: 출력 공통 ${label} 이 퓨즈 · 차단기 없이 전원 (${[...new Set(direct)].join(' · ')}) 에 바로 물려 있습니다. 출력 쪽이 단락되면 PLC 출력 접점이 녹아 붙습니다 → 공통마다 퓨즈 (2~4A) 를 넣습니다`, `${name(p)}: output common ${label} is fed straight from ${[...new Set(direct)].join(', ')} with no fuse; a short welds the PLC contacts — fuse each common (2–4 A)`), partIds: [p.id] });
      // 출력 접점이 바로 켜는 부하
      for (const o of outs) {
        const big = driven(pinNet(p, RPLC.out0 + o.n)).filter((q) => q.id !== p.id && heavy(q));
        if (big.length)
          out.push({
            level: 'warn',
            msg: tr(
              `${name(p)}: 출력 ${o.a} 이 ${big.map(name).join(' · ')} 을(를) 바로 켭니다. 전자접촉기 코일 · 전동기 · 교류 솔레노이드는 돌입 전류와 끊을 때의 서지가 커서 PLC 출력 접점 (보통 2A) 이 녹아 붙거나 탑니다 → DC 24V 보조 릴레이 (인터포징 릴레이) 를 거쳐 움직이세요`,
              `${name(p)}: output ${o.a} switches ${big.map(name).join(', ')} directly; contactor coils, motors and AC solenoids have inrush and switch-off surges that weld or burn the PLC contact (typically 2 A) — drive them through 24 V DC interposing relays`,
            ),
            partIds: [p.id, ...big.map((q) => q.id)],
          });
      }
    }
  }
  // HMI 버튼이 PLC 입력 주소에 쓰면 다음 스캔에 단자 값으로 덮어써진다
  const inputs = new Set(model.plcs.flatMap((b) => b.inDev));
  for (const [tag, hb] of model.hmiDef)
    if (inputs.has(hb.dev))
      out.push({ level: 'warn', msg: tr(`${hmiTag(hb.part, hb.n)} (${hb.label}): PLC 입력 ${hb.dev} 에 씁니다. 입력은 PLC 가 스캔마다 단자 값으로 덮어쓰니 내부 릴레이 (M) 를 쓰세요`, `${tag} (${hb.label}) writes PLC input ${hb.dev}, which the PLC overwrites from its terminals every scan; use an internal relay (M)`), partIds: [hb.part.id] });
  return out;
}
