import type { Circuit, Part, PartType, WireColor } from './types';
import { circuitWires, partKindName, partPins, pinPositions, PARTS, POLE_SYSTEM, REAL, solAc } from './parts';
import { onWireInterior } from './netlist';
import type { CircuitModel } from './engine';
import { nominalVolt, poleLive, systemVolts } from './supply';
import { POLE_WIRE } from './wires';
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
  const shown = p.type === 'r_relay8' || p.type === 'r_my2' || p.type === 'r_my4' || p.type === 'r_mc' ? 'AC 220V' : p.type === 'r_counter' || p.type === 'r_tc' ? 'AC 100-240V' : p.type === 'r_ssr' ? 'DC 4-32V' : p.type === 'r_sol' ? 'DC 24V' : '';
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
  return out;
}
