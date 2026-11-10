import type { Circuit, Part, PartType } from './types';
import { CONTACT_A, CONTACT_B, compareTags, lampColorName, OPERATOR, partKindName, partPins, PARTS, plcAddresses, REAL, tbSize, tswSched, VALVES } from './parts';
import { airDriven, CircuitModel, normTag, tagKey } from './engine';
import { isContactor } from './chart';
import { formatClock, formatTime } from '../model/format';
import { loadRating } from './power';
import { tr } from '../i18n';

/** 부품 리스트 한 줄 = 기호 하나 (코일과 그 접점들은 한 기기) */
export interface BomRow {
  tag: string;
  kind: string;
  name: string;
  spec: string;
  /** a접점 수, b접점 수, 주접점 극 수 */
  a: number;
  b: number;
  main: number;
  /** 회로에 그려진 기호 수 */
  count: number;
  cat: number;
}

export interface BomSummary {
  kind: string;
  spec: string;
  qty: number;
  tags: string[];
}

const CAT_ORDER: Partial<Record<PartType, number>> = {
  mcb3: 0,
  mcb: 0,
  fuse3: 1,
  fuse: 1,
  ol3: 2,
  coil: 3,
  km3: 3,
  timer: 4,
  pb_no: 5,
  pb_nc: 5,
  sw_no: 6,
  sw_nc: 6,
  estop: 6,
  ls_no: 7,
  ls_nc: 7,
  lamp: 8,
  buzzer: 8,
  motor3: 9,
  motor: 9,
  sol: 10,
  cyl: 11,
  plc: 3,
  smps: 0,
  prox: 7,
  r_mcb3: 0,
  r_mcb2: 0,
  r_mcb1: 0,
  r_thr: 2,
  r_mc: 3,
  r_pb: 5,
  r_lamp: 8,
  r_motor3: 9,
  r_relay8: 3,
  r_timer8: 4,
  r_ss: 6,
  r_estop: 6,
  r_tb: 12,
  r_tsw: 4,
  r_light: 8,
  r_sw: 6,
  r_sw3: 6,
  r_load1: 9,
  r_load3: 9,
  r_panel: -1,
  frl: 10,
  v32: 10,
  v52: 10,
  v52d: 10,
  v53: 10,
  fc: 10,
};

const VALVE_KIND: Partial<Record<PartType, [string, string]>> = {
  v32: ['3/2 솔레노이드 밸브 (NC)', '3/2 solenoid valve (NC)'],
  v52: ['5/2 솔레노이드 밸브 (편솔)', '5/2 solenoid valve (single)'],
  v52d: ['5/2 솔레노이드 밸브 (양솔)', '5/2 solenoid valve (double)'],
  v53: ['5/3 솔레노이드 밸브 (올포트 블록)', '5/3 solenoid valve (closed centre)'],
};

/** 기기의 품명을 정하는 부품 (코일 > 주회로 > 스위치 > 접점) */
function mainOf(parts: Part[]): Part {
  const rank = (p: Part) =>
    p.type === 'coil' || p.type === 'timer' || p.type === 'cyl' || p.type === 'r_mc' || p.type === 'r_relay8' || p.type === 'r_timer8' || p.type === 'r_tsw'
      ? 0
      : p.type === 'ol3' || p.type === 'mcb3' || p.type === 'mcb' || p.type === 'r_thr' || p.type === 'r_mcb1' || p.type === 'r_mcb2' || p.type === 'r_mcb3'
        ? 1
        : OPERATOR.has(p.type) || PARTS[p.type].load
          ? 2
          : p.type === 'km3'
            ? 3
            : 4;
  return [...parts].sort((x, y) => rank(x) - rank(y))[0];
}

function contactText(a: number, b: number): string {
  return [a ? `${a}a` : '', b ? `${b}b` : ''].join('') || '';
}

function kindAndSpec(c: Circuit, tag: string, p: Part, a: number, b: number, main: number): { kind: string; spec: string } {
  const ab = contactText(a, b);
  switch (p.type) {
    case 'coil':
    case 'r_mc':
    case 'km3': {
      if (isContactor(c, tag)) return { kind: tr('전자접촉기', 'Magnetic contactor'), spec: [main ? tr(`주접점 ${main}P`, `${main}P main`) : '', ab ? tr(`보조 ${ab}`, `aux ${ab}`) : ''].filter(Boolean).join(', ') };
      return { kind: tr('릴레이', 'Relay'), spec: ab };
    }
    case 'timer':
      if (p.timerMode === 'flicker') return { kind: tr('플리커 릴레이', 'Flicker relay'), spec: `${formatTime(p.preset ?? 500, 's')} ${tr('간격', 'interval')}${ab ? `, ${ab}` : ''}` };
      return { kind: tr('타이머', 'Timer'), spec: `${p.timerMode === 'off' ? tr('OFF 딜레이', 'off-delay') : tr('ON 딜레이', 'on-delay')} ${formatTime(p.preset ?? 3000, 's')}${ab ? `, ${ab}` : ''}` };
    case 'pb_no':
    case 'pb_nc':
      return { kind: tr('푸시버튼', 'Push button'), spec: [p.color ? lampColorName(p.color) : '', ab].filter(Boolean).join(' ') };
    case 'sw_no':
    case 'sw_nc':
      return { kind: tr('셀렉터 스위치', 'Selector switch'), spec: ab };
    case 'estop':
      return { kind: tr('비상정지 스위치', 'Emergency stop'), spec: ab };
    case 'ls_no':
    case 'ls_nc': {
      const kind =
        p.sense === 'reed'
          ? tr('리드 스위치 (실린더 센서)', 'Reed switch')
          : p.sense === 'float'
            ? tr('플로트 스위치', 'Float switch')
            : p.sense === 'pressure'
              ? tr('압력 스위치', 'Pressure switch')
              : p.cyl
                ? tr('실린더 센서', 'Cylinder sensor')
                : tr('리밋 스위치', 'Limit switch');
      return { kind, spec: [p.cyl ? `${p.cyl} ${p.end === '-' ? tr('후진단', 'retracted') : tr('전진단', 'extended')}` : '', ab].filter(Boolean).join(', ') };
    }
    case 'prox': {
      const kind = p.sense === 'photo' ? tr('광전 센서', 'Photoelectric sensor') : p.sense === 'capacitive' ? tr('근접 센서 (정전용량형)', 'Capacitive proximity sensor') : tr('근접 센서 (유도형)', 'Inductive proximity sensor');
      return { kind, spec: [`DC 24V ${tr('3선식', '3-wire')} ${p.npn ? 'NPN' : 'PNP'}`, p.cyl ? `${p.cyl} ${p.end === '-' ? tr('후진단', 'retracted') : tr('전진단', 'extended')}` : ''].filter(Boolean).join(', ') };
    }
    case 'smps':
      return { kind: tr('SMPS (DC 전원 공급기)', 'Switching power supply'), spec: 'AC 220V → DC 24V' };
    case 'frl':
      return { kind: tr('에어 서비스 유닛 (FRL)', 'Air service unit (FRL)'), spec: tr('필터 · 레귤레이터 · 압력계', 'filter, regulator, gauge') };
    case 'fc':
      return { kind: tr('속도 제어 밸브', 'Flow control valve'), spec: tr(`미터 아웃, ${p.speed ?? 50}%`, `meter-out, ${p.speed ?? 50}%`) };
    case 'v32':
    case 'v52':
    case 'v52d':
    case 'v53': {
      const [ko, en] = VALVE_KIND[p.type]!;
      const sols = [p.solA?.trim() ? `${p.solA.trim()} (14)` : '', p.type !== 'v32' && p.type !== 'v52' && p.solB?.trim() ? `${p.solB.trim()} (12)` : ''].filter(Boolean).join(', ');
      return { kind: tr(ko, en), spec: sols };
    }
    case 'mcb3':
    case 'mcb':
      return { kind: tr('배선용 차단기', 'Circuit breaker'), spec: p.type === 'mcb3' ? '3P' : '1P' };
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
      return { kind: tr('배선용 차단기', 'Circuit breaker'), spec: `${p.type.slice(-1)}P${p.amps ? ` ${p.amps}A` : ''}` };
    case 'r_thr':
      return { kind: tr('열동형 과부하 계전기', 'Thermal overload relay'), spec: ab };
    case 'r_pb':
      return { kind: tr('푸시버튼', 'Push button'), spec: [p.color ? lampColorName(p.color) : '', ab].filter(Boolean).join(' ') };
    case 'r_lamp':
      return { kind: tr('파일럿 램프', 'Pilot lamp'), spec: lampColorName(p.color) };
    case 'r_motor3':
      return { kind: tr('3상 유도 전동기', '3-phase induction motor'), spec: '' };
    case 'r_relay8':
      return { kind: tr('릴레이 (8핀) + 소켓', 'Relay (8-pin) + socket'), spec: `${tr('코일 AC 220V', 'coil AC 220V')}, ${ab}` };
    case 'r_timer8': {
      const mode = p.timerMode === 'off' ? tr('OFF 딜레이', 'off-delay') : p.timerMode === 'flicker' ? tr('플리커', 'flicker') : tr('ON 딜레이', 'on-delay');
      const cts = p.inst13 ? tr('한시 1a1b · 순시 1a1b', 'timed 1NO1NC · inst. 1NO1NC') : tr('한시 2a2b', 'timed 2NO2NC');
      return { kind: tr('타이머 (8핀) + 소켓', 'Timer (8-pin) + socket'), spec: `${mode} ${formatTime(p.preset ?? 3000, 's')}, ${cts}` };
    }
    case 'r_ss':
      return { kind: tr('셀렉터 스위치 (2단)', 'Selector switch (2-position)'), spec: ab };
    case 'r_estop':
      return { kind: tr('비상정지 스위치', 'Emergency stop'), spec: [tr('적색 버섯, 잠김', 'red mushroom, latching'), ab].join(', ') };
    case 'r_tb':
      return { kind: tr('단자대', 'Terminal block'), spec: `${tbSize(p)}P` };
    case 'r_tsw': {
      const on = tswSched(p)
        .map(([s, e]) => `${formatClock(s)}~${formatClock(e)}`)
        .join(', ');
      return { kind: tr('24시간 타임 스위치 (다이얼식)', '24-hour dial time switch'), spec: [tr('AC 220V, 접점 1c', 'AC 220V, 1 c/o contact'), on ? `ON ${on}` : ''].filter(Boolean).join(', ') };
    }
    case 'r_light':
      return { kind: tr('전등', 'Light'), spec: 'AC 220V' };
    case 'r_sw':
      return { kind: tr('스위치 (단로)', 'Switch (1-way)'), spec: '' };
    case 'r_sw3':
      return { kind: tr('3로 스위치', '3-way switch'), spec: '' };
    case 'r_load1':
    case 'r_load3': {
      const r = loadRating(p);
      return { kind: tr('부하', 'Load'), spec: `${p.type === 'r_load3' ? tr('3상', '3-phase') : tr('단상', '1-phase')} ${r ? Math.round(r.out / 10) / 100 : 0} kW, pf ${r?.pf ?? 1}` };
    }
    case 'r_panel':
      return { kind: tr('분전반 · 변전함', 'Panel / switchboard'), spec: '' };
    case 'fuse3':
    case 'fuse':
      return { kind: tr('퓨즈', 'Fuse'), spec: p.type === 'fuse3' ? '3P' : '1P' };
    case 'ol3':
      return { kind: tr('열동형 과부하 계전기', 'Thermal overload relay'), spec: ab ? tr(`보조 ${ab}`, `aux ${ab}`) : '' };
    case 'lamp':
      return { kind: tr('파일럿 램프', 'Pilot lamp'), spec: lampColorName(p.color) };
    case 'buzzer':
      return { kind: tr('부저', 'Buzzer'), spec: '' };
    case 'motor3':
      return { kind: tr('3상 유도 전동기', '3-phase induction motor'), spec: '' };
    case 'motor':
      return { kind: tr('전동기', 'Motor'), spec: '' };
    case 'sol': {
      const cyl = c.parts.find((x) => x.type === 'cyl' && (normTag(x.solPlus ?? '') === normTag(tag) || normTag(x.solMinus ?? '') === normTag(tag)));
      return { kind: tr('솔레노이드 밸브', 'Solenoid valve'), spec: cyl ? `${cyl.tag} ${normTag(cyl.solPlus ?? '') === normTag(tag) ? tr('전진', 'advance') : tr('후진', 'return')}` : '' };
    }
    case 'cyl':
      return { kind: tr('공압 실린더', 'Pneumatic cylinder'), spec: `${p.solMinus?.trim() ? tr('복동', 'double-acting') : tr('단동 (스프링 복귀)', 'single-acting')}, ${tr('전진', 'adv')} ${formatTime(p.stroke ?? 1000, 's')}` };
    case 'plc': {
      const { ins, outs } = plcAddresses(p);
      return { kind: 'PLC', spec: tr(`입력 8 (${ins[0]}~${ins[7]}) · 릴레이 출력 8 (${outs[0]}~${outs[7]})`, `8 in (${ins[0]}–${ins[7]}) · 8 relay out (${outs[0]}–${outs[7]})`) };
    }
    default:
      return { kind: partKindName(p.type), spec: ab };
  }
}

/** 회로도 → 부품 리스트 (기호마다 한 줄) */
export function partsList(c: Circuit): BomRow[] {
  const groups = new Map<string, Part[]>();
  // 밸브에 붙은 솔레노이드는 밸브 한 줄에 함께 적는다
  const valveSols = new Set(c.parts.filter((p) => VALVES.has(p.type)).flatMap((p) => [normTag(p.solA ?? ''), p.type === 'v52d' || p.type === 'v53' ? normTag(p.solB ?? '') : '']).filter(Boolean));
  for (const p of c.parts) {
    if (p.type === 'src' || p.type === 'src3' || p.type === 'text' || p.type === 'air' || p.type === 'r_term') continue;
    if (p.type === 'sol' && valveSols.has(normTag(p.tag))) continue;
    const k = tagKey(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const rows: BomRow[] = [];
  for (const [k, parts] of groups) {
    const main = mainOf(parts);
    // 실물 기기는 몸 안의 보조 접점(1a1b)도 센다
    const inside = parts.reduce((n, p) => n + (p.type === 'r_relay8' || p.type === 'r_timer8' ? 2 : p.type === 'r_mc' || p.type === 'r_pb' || p.type === 'r_thr' || p.type === 'r_ss' || p.type === 'r_estop' ? 1 : 0), 0);
    const a = parts.filter((p) => CONTACT_A.has(p.type)).length + inside;
    const b = parts.filter((p) => CONTACT_B.has(p.type)).length + inside;
    const poles = (parts.filter((p) => p.type === 'km3').length + parts.filter((p) => p.type === 'r_mc').length) * 3;
    const ks = kindAndSpec(c, k, main, a, b, poles);
    const named = parts.find((p) => p.name?.trim());
    const spec = parts.find((p) => p.spec?.trim())?.spec?.trim() ?? ks.spec;
    rows.push({ tag: main.tag.trim(), kind: ks.kind, name: named?.name?.trim() ?? '', spec, a, b, main: poles, count: parts.length, cat: CAT_ORDER[main.type] ?? 20 });
  }
  return rows.sort((x, y) => x.cat - y.cat || compareTags(x.tag, y.tag));
}

/** 같은 품명·사양끼리 수량 집계 (구매용) */
export function bomSummary(rows: BomRow[]): BomSummary[] {
  const m = new Map<string, BomSummary>();
  for (const r of rows) {
    const k = `${r.kind}\u0000${r.spec}`;
    const s = m.get(k) ?? { kind: r.kind, spec: r.spec, qty: 0, tags: [] };
    s.qty++;
    if (r.tag) s.tags.push(r.tag);
    m.set(k, s);
  }
  return [...m.values()];
}

export function contactsLabel(r: BomRow): string {
  return [r.main ? tr(`주 ${r.main}P`, `${r.main}P`) : '', contactText(r.a, r.b)].filter(Boolean).join(' · ');
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 엑셀용 CSV (UTF-8 BOM): 기기별 목록 + 수량 집계 */
export function bomCsv(c: Circuit): string {
  const rows = partsList(c);
  const line = (cells: unknown[]) => cells.map(csvCell).join(',');
  const out = [line([tr('기호', 'Tag'), tr('품명', 'Item'), tr('설명', 'Description'), tr('사양', 'Spec'), tr('접점', 'Contacts'), tr('수량', 'Qty')])];
  for (const r of rows) out.push(line([r.tag, r.kind, r.name, r.spec, contactsLabel(r), 1]));
  out.push('');
  out.push(line([tr('품명', 'Item'), tr('사양', 'Spec'), tr('수량', 'Qty'), tr('기호', 'Tags')]));
  for (const s of bomSummary(rows)) out.push(line([s.kind, s.spec, s.qty, s.tags.join(' ')]));
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ───────────────────────── 검사 ─────────────────────────

export interface CircuitIssue {
  level: 'error' | 'warn';
  msg: string;
  /** 표시할 부품 */
  partIds: string[];
}

/** 그리다 놓치기 쉬운 것: 코일 없는 접점, 겹친 코일, 떠 있는 단자, 바로 이어진 단자 */
export function checkCircuit(c: Circuit, model: CircuitModel = new CircuitModel(c)): CircuitIssue[] {
  const out: CircuitIssue[] = [];
  const kinds = model.tagKind;
  for (const p of c.parts) {
    if ((p.type === 'no' || p.type === 'nc' || p.type === 'km3') && !kinds.has(tagKey(p))) {
      out.push({ level: 'error', msg: p.tag.trim() ? tr(`접점 ${p.tag}: 같은 기호의 코일·타이머·스위치가 없습니다`, `Contact ${p.tag}: no coil, timer or switch with this tag`) : tr('기호가 없는 접점이 있습니다', 'A contact has no tag'), partIds: [p.id] });
    }
    if ((p.type === 'ls_no' || p.type === 'ls_nc') && p.cyl && !model.cylDef.has(normTag(p.cyl))) {
      out.push({ level: 'error', msg: tr(`${p.tag || 'LS'}: 실린더 ${p.cyl} 이(가) 없습니다`, `${p.tag || 'LS'}: cylinder ${p.cyl} not found`), partIds: [p.id] });
    }
    if (p.type === 'cyl') {
      if (!p.tag.trim()) out.push({ level: 'error', msg: tr('기호가 없는 실린더가 있습니다', 'A cylinder has no tag'), partIds: [p.id] });
      for (const s of [p.solPlus, p.solMinus]) {
        if (s?.trim() && !model.loadParts.has(normTag(s))) out.push({ level: 'error', msg: tr(`${p.tag}: 솔레노이드 ${s} 이(가) 회로에 없습니다`, `${p.tag}: solenoid ${s} not in the circuit`), partIds: [p.id] });
      }
      if (!p.solPlus?.trim() && !airDriven(model, tagKey(p))) out.push({ level: 'warn', msg: tr(`${p.tag}: 배관을 잇거나 전진 솔레노이드를 정하세요`, `${p.tag}: connect air tubes or choose the advance solenoid`), partIds: [p.id] });
    }
  }
  for (const [tag, ids] of [...model.coilParts, ...model.timerParts]) {
    if (ids.length > 1) out.push({ level: 'error', msg: tr(`코일 ${model.label(tag)} 이(가) ${ids.length}개 있습니다 (기호가 겹침)`, `Coil ${model.label(tag)} appears ${ids.length} times`), partIds: ids });
  }
  for (const p of c.parts) {
    const pins = PARTS[p.type].pins;
    // 단자가 많은 실물 기기는 안 쓰는 단자(예비 접점, 남는 극)가 있는 게 보통
    if (!pins.length || p.type === 'src' || p.type === 'plc' || p.type === 'cyl' || (REAL.has(p.type) && p.type !== 'r_lamp' && p.type !== 'r_light' && p.type !== 'r_sw')) continue;
    const nets = pins.map((_, i) => model.net.pinNet.get(`${p.id}:${i}`)!);
    // 공압 포트는 안 쓰는 것이 있어도 정상 (5/2 밸브로 단동 실린더 등)
    const floating = nets.filter((n, i) => !pins[i].air && model.net.pinCount[n] <= 1 && !model.net.hasWire[n]).length;
    if (floating) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 이어지지 않은 단자 ${floating}개`, `${p.tag || partKindName(p.type)}: ${floating} unconnected terminal(s)`), partIds: [p.id] });
    const poles = PARTS[p.type].poles ?? (PARTS[p.type].load && nets.length === 2 ? ([[0, 1]] as [number, number][]) : []);
    if (poles.some(([i, j]) => nets[i] === nets[j])) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 두 단자가 선으로 바로 이어져 있습니다`, `${p.tag || partKindName(p.type)}: both terminals are wired together`), partIds: [p.id] });
  }
  // 공압: 전기 단자와 배관이 섞임, 밸브 솔레노이드, 공급 포트
  const airIds = new Map<number, string[]>();
  const elecIds = new Map<number, string[]>();
  for (const p of c.parts) {
    partPins(p).forEach((pin, i) => {
      const n = model.net.pinNet.get(`${p.id}:${i}`)!;
      const m = pin.air ? airIds : elecIds;
      m.set(n, [...(m.get(n) ?? []), p.id]);
    });
  }
  for (const [n, ids] of airIds) {
    if (elecIds.has(n)) out.push({ level: 'error', msg: tr('공압 포트와 전기 단자가 같은 선으로 이어졌습니다', 'An air port is wired to an electrical terminal'), partIds: [...ids, ...elecIds.get(n)!] });
  }
  const fed = new Set<number>();
  {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      const p = parent.get(i);
      if (p === undefined || p === i) return i;
      const r = find(p);
      parent.set(i, r);
      return r;
    };
    for (const [a, b] of model.airAlways) parent.set(find(a), find(b));
    const src = new Set(model.airSrc.map(find));
    for (const v of model.valves) {
      const pIdx = v.part.type === 'v32' ? 1 : 2;
      if (src.has(find(v.ports[pIdx]))) fed.add(v.ports[pIdx]);
    }
  }
  for (const v of model.valves) {
    const p = v.part;
    const name = p.tag || partKindName(p.type);
    const pIdx = p.type === 'v32' ? 1 : 2;
    if (!fed.has(v.ports[pIdx])) out.push({ level: 'warn', msg: tr(`${name}: 공급 포트(1)에 공압원이 이어지지 않았습니다`, `${name}: no air supply on port 1`), partIds: [p.id] });
    if (!p.solA?.trim()) out.push({ level: 'warn', msg: tr(`${name}: 솔레노이드 기호를 정하세요`, `${name}: choose its solenoid`), partIds: [p.id] });
    for (const s of [p.solA, p.type === 'v52d' || p.type === 'v53' ? p.solB : undefined]) {
      if (s?.trim() && !model.loadParts.has(normTag(s))) out.push({ level: 'error', msg: tr(`${name}: 솔레노이드 ${s} 이(가) 회로에 없습니다`, `${name}: solenoid ${s} not in the circuit`), partIds: [p.id] });
    }
  }
  // 타임 스위치: 시계 전원, 설정
  for (const d of model.tswDef.values()) {
    const p = d.part;
    const wired = (n: number) => model.net.pinCount[n] > 1 || model.net.hasWire[n];
    if (!wired(d.l) || !wired(d.n)) out.push({ level: 'warn', msg: tr(`${p.tag}: 시계 전원 L · N 을 이어야 다이얼이 돕니다`, `${p.tag}: wire L and N so the dial runs`), partIds: [p.id] });
    if (!d.sched.some(([a, b]) => a !== b)) out.push({ level: 'warn', msg: tr(`${p.tag}: 켜지는 시각을 정하세요`, `${p.tag}: set the ON periods`), partIds: [p.id] });
  }
  const plcParts = c.parts.filter((p) => p.type === 'plc').map((p) => p.id);
  for (const msg of model.plcIssues) out.push({ level: model.prog ? 'error' : 'warn', msg, partIds: plcParts });
  if (c.parts.some((p) => partPins(p).length) && !c.parts.some((p) => p.type === 'src' || p.type === 'src3' || p.type === 'r_term')) {
    out.push({ level: 'error', msg: tr('전원(L·N, +24V·0V, 3상)이 없습니다', 'No supply (L/N, +24V/0V or 3-phase)'), partIds: [] });
  }
  return out;
}
