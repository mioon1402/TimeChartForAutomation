import type { Circuit, Part, PartType } from './types';
import { CONTACT_A, CONTACT_B, compareTags, lampColorName, OPERATOR, partKindName, PARTS, plcAddresses } from './parts';
import { CircuitModel, normTag, tagKey } from './engine';
import { isContactor } from './chart';
import { formatTime } from '../model/format';
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
};

/** 기기의 품명을 정하는 부품 (코일 > 주회로 > 스위치 > 접점) */
function mainOf(parts: Part[]): Part {
  const rank = (p: Part) => (p.type === 'coil' || p.type === 'timer' || p.type === 'cyl' ? 0 : p.type === 'ol3' || p.type === 'mcb3' || p.type === 'mcb' ? 1 : OPERATOR.has(p.type) || PARTS[p.type].load ? 2 : p.type === 'km3' ? 3 : 4);
  return [...parts].sort((x, y) => rank(x) - rank(y))[0];
}

function contactText(a: number, b: number): string {
  return [a ? `${a}a` : '', b ? `${b}b` : ''].join('') || '';
}

function kindAndSpec(c: Circuit, tag: string, p: Part, a: number, b: number, main: number): { kind: string; spec: string } {
  const ab = contactText(a, b);
  switch (p.type) {
    case 'coil':
    case 'km3': {
      if (isContactor(c, tag)) return { kind: tr('전자접촉기', 'Magnetic contactor'), spec: [main ? tr(`주접점 ${main}P`, `${main}P main`) : '', ab ? tr(`보조 ${ab}`, `aux ${ab}`) : ''].filter(Boolean).join(', ') };
      return { kind: tr('릴레이', 'Relay'), spec: ab };
    }
    case 'timer':
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
    case 'ls_nc':
      return { kind: p.cyl ? tr('실린더 센서', 'Cylinder sensor') : tr('리밋 스위치', 'Limit switch'), spec: [p.cyl ? `${p.cyl} ${p.end === '-' ? tr('후진단', 'retracted') : tr('전진단', 'extended')}` : '', ab].filter(Boolean).join(', ') };
    case 'mcb3':
    case 'mcb':
      return { kind: tr('배선용 차단기', 'Circuit breaker'), spec: p.type === 'mcb3' ? '3P' : '1P' };
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
  for (const p of c.parts) {
    if (p.type === 'src' || p.type === 'src3' || p.type === 'text') continue;
    const k = tagKey(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const rows: BomRow[] = [];
  for (const [k, parts] of groups) {
    const main = mainOf(parts);
    const a = parts.filter((p) => CONTACT_A.has(p.type)).length;
    const b = parts.filter((p) => CONTACT_B.has(p.type)).length;
    const poles = parts.filter((p) => p.type === 'km3').length * 3;
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
      if (!p.solPlus?.trim()) out.push({ level: 'warn', msg: tr(`${p.tag}: 전진 솔레노이드를 정하세요`, `${p.tag}: choose the advance solenoid`), partIds: [p.id] });
    }
  }
  for (const [tag, ids] of [...model.coilParts, ...model.timerParts]) {
    if (ids.length > 1) out.push({ level: 'error', msg: tr(`코일 ${model.label(tag)} 이(가) ${ids.length}개 있습니다 (기호가 겹침)`, `Coil ${model.label(tag)} appears ${ids.length} times`), partIds: ids });
  }
  for (const p of c.parts) {
    const pins = PARTS[p.type].pins;
    if (!pins.length || p.type === 'src' || p.type === 'plc') continue;
    const nets = pins.map((_, i) => model.net.pinNet.get(`${p.id}:${i}`)!);
    const floating = nets.filter((n) => model.net.pinCount[n] <= 1 && !model.net.hasWire[n]).length;
    if (floating) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 이어지지 않은 단자 ${floating}개`, `${p.tag || partKindName(p.type)}: ${floating} unconnected terminal(s)`), partIds: [p.id] });
    const poles = PARTS[p.type].poles ?? (PARTS[p.type].load && nets.length === 2 ? ([[0, 1]] as [number, number][]) : []);
    if (poles.some(([i, j]) => nets[i] === nets[j])) out.push({ level: 'warn', msg: tr(`${p.tag || partKindName(p.type)}: 두 단자가 선으로 바로 이어져 있습니다`, `${p.tag || partKindName(p.type)}: both terminals are wired together`), partIds: [p.id] });
  }
  const plcParts = c.parts.filter((p) => p.type === 'plc').map((p) => p.id);
  for (const msg of model.plcIssues) out.push({ level: model.prog ? 'error' : 'warn', msg, partIds: plcParts });
  if (c.parts.some((p) => PARTS[p.type].pins.length) && !c.parts.some((p) => p.type === 'src' || p.type === 'src3')) {
    out.push({ level: 'error', msg: tr('전원(L·N, +24V·0V, 3상)이 없습니다', 'No supply (L/N, +24V/0V or 3-phase)'), partIds: [] });
  }
  return out;
}
