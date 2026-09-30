/**
 * TimeChart 텍스트 형식 (TCT) - 사람이 읽고 쓰기 쉬운 시간 기반 타임차트 코드.
 *
 *   title: 드릴 가공 유닛
 *   duration: 3200ms
 *   grid: 50ms
 *
 *   group 클램프
 *   sig Y0 "클램프 SOL" output : 0 | 300 1 | 2400 0
 *   sig - "클램프 실린더" actuator on=전진 off=후진 ramp=300 : 0 | 300 1~300 | 2400 0~300
 *   sig D0 "스텝" bus data : 0 | 300 10 | 600 20
 *   sig CLK "클럭" clock period=100 duty=0.5
 *
 *   step "S10 클램프" 300..600 "설명"
 *   arrow X0@250 -> Y0@300 "시작"
 *   dim "클램프 실린더" 300..600 "300ms"
 *   note Y0@500 "메모"
 *   marker 2800 "완료"
 *   rule delay Y0 rise -> X1 rise max=400 "응답"
 */
import type { Annotation, EdgeKind, Project, ProjectMeta, Signal, SignalKind, SignalRole, TimingRule, WavePoint } from '../model/types';
import { createProject, createSignal, createStep, ROLE_COLORS, STEP_COLORS } from '../model/project';
import { normalize, uid } from '../model/wave';
import { parseTime } from '../model/format';

const KINDS: SignalKind[] = ['bit', 'bus', 'analog', 'clock'];
const ROLES: SignalRole[] = ['input', 'output', 'internal', 'actuator', 'sensor', 'timer', 'counter', 'data', 'other'];
const META_KEYS: Exclude<keyof ProjectMeta, 'logo' | 'signLabels'>[] = ['title', 'machine', 'drawingNo', 'company', 'author', 'checker', 'approver', 'revision', 'date', 'description'];

function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function needsQuote(s: string): boolean {
  return s === '' || s === '-' || /[\s"|@:=~#\\]|->|\.\./.test(s);
}

function tok(s: string): string {
  return needsQuote(s) ? q(s) : s;
}

function refOf(s: Signal, all: Signal[]): string {
  if (s.address && all.filter((x) => x.address === s.address).length === 1) return tok(s.address);
  return q(s.name);
}

export function serializeDsl(p: Project): string {
  const out: string[] = ['# TimeChart Studio 텍스트 형식 (시간 단위: ms, "1.5s" 처럼 s 도 가능)'];
  for (const k of META_KEYS) if (p.meta[k]) out.push(`${k}: ${p.meta[k].replace(/\r?\n/g, ' ')}`);
  out.push(`duration: ${num(p.settings.duration)}`);
  out.push(`grid: ${num(p.settings.grid)}`);
  out.push(`unit: ${p.settings.timeUnit}`);
  out.push('');
  let group: string | undefined;
  for (const s of p.signals) {
    if ((s.group || undefined) !== group) {
      group = s.group || undefined;
      out.push(group ? `group ${group}` : 'group -');
    }
    const parts = ['sig', s.address ? tok(s.address) : '-', q(s.name)];
    if (s.kind !== 'bit') parts.push(s.kind);
    if (s.role !== 'other') parts.push(s.role);
    if (s.comment) parts.push(`comment=${q(s.comment)}`);
    if (s.onLabel) parts.push(`on=${tok(s.onLabel)}`);
    if (s.offLabel) parts.push(`off=${tok(s.offLabel)}`);
    if (s.defaultRamp) parts.push(`ramp=${num(s.defaultRamp)}`);
    if (s.heightScale && s.heightScale !== 1) parts.push(`height=${num(s.heightScale)}`);
    if (s.analogMin !== undefined) parts.push(`min=${num(s.analogMin)}`);
    if (s.analogMax !== undefined) parts.push(`max=${num(s.analogMax)}`);
    if (s.unit) parts.push(`unit=${tok(s.unit)}`);
    if (s.hidden) parts.push('hidden');
    if (s.color && s.color !== ROLE_COLORS[s.role]) parts.push(`color=${s.color}`);
    if (s.kind === 'clock') {
      parts.push(`period=${num(s.clockPeriod ?? 100)}`, `duty=${num(s.clockDuty ?? 0.5)}`);
      if (s.clockPhase) parts.push(`phase=${num(s.clockPhase)}`);
      out.push(parts.join(' '));
      continue;
    }
    const val = (v: WavePoint['v']) => (s.kind === 'bus' ? tok(String(v)) : String(v));
    const pts = s.points.map((pt, i) => (i === 0 ? val(pt.v) : `${num(pt.t)} ${val(pt.v)}${pt.ramp ? `~${num(pt.ramp)}` : ''}`));
    out.push(`${parts.join(' ')} : ${pts.join(' | ')}`);
  }
  if (p.steps.length) out.push('');
  for (const st of p.steps) out.push(`step ${q(st.label)} ${num(st.start)}..${num(st.end)}${st.description ? ' ' + q(st.description) : ''}`);
  const ref = (id: string) => {
    const s = p.signals.find((x) => x.id === id);
    return s ? refOf(s, p.signals) : q('?');
  };
  if (p.annotations.length) out.push('');
  for (const a of p.annotations) {
    switch (a.type) {
      case 'arrow':
        out.push(`arrow ${ref(a.from.signalId)}@${num(a.from.t)} ${a.dashed ? '~>' : '->'} ${ref(a.to.signalId)}@${num(a.to.t)}${a.label ? ' ' + q(a.label) : ''}`);
        break;
      case 'dimension':
        out.push(`dim ${a.signalId ? ref(a.signalId) : '-'} ${num(a.t1)}..${num(a.t2)}${a.label ? ' ' + q(a.label) : ''}`);
        break;
      case 'note':
        out.push(`note ${a.signalId ? ref(a.signalId) : '-'}@${num(a.t)} ${q(a.text)}`);
        break;
      case 'marker':
        out.push(`marker ${num(a.t)}${a.label ? ' ' + q(a.label) : ''}${a.color ? ` color=${a.color}` : ''}`);
        break;
    }
  }
  if (p.rules.length) out.push('');
  for (const r of p.rules) {
    const lim = (r2: { min?: number; max?: number }) => `${r2.min !== undefined ? ` min=${num(r2.min)}` : ''}${r2.max !== undefined ? ` max=${num(r2.max)}` : ''}`;
    switch (r.type) {
      case 'delay':
        out.push(`rule delay ${ref(r.fromSignal)} ${r.fromEdge} -> ${ref(r.toSignal)} ${r.toEdge}${lim(r)} ${q(r.name)}`);
        break;
      case 'exclusive':
        out.push(`rule exclusive ${ref(r.a)} ${ref(r.b)} ${q(r.name)}`);
        break;
      case 'pulse':
        out.push(`rule pulse ${ref(r.signal)} ${r.level}${lim(r)} ${q(r.name)}`);
        break;
      case 'cycle':
        out.push(`rule cycle max=${num(r.max)} ${q(r.name)}`);
        break;
    }
  }
  return out.join('\n') + '\n';
}

// ─────────────────────────── 파서 ───────────────────────────

interface Tk {
  v: string;
  quoted: boolean;
}

function tokenize(line: string): Tk[] {
  const out: Tk[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) i++;
        s += line[i++];
      }
      i++;
      out.push({ v: s, quoted: true });
      continue;
    }
    if (c === '|' || c === ':' || c === '@') {
      out.push({ v: c, quoted: false });
      i++;
      continue;
    }
    if (line.startsWith('->', i) || line.startsWith('~>', i)) {
      out.push({ v: line.slice(i, i + 2), quoted: false });
      i += 2;
      continue;
    }
    let s = '';
    while (i < line.length && !/[\s"|@]/.test(line[i]) && !(line[i] === ':' && s && !/=/.test(s)) && !line.startsWith('->', i) && !line.startsWith('~>', i)) {
      // key="value" 형태
      if (line[i] === '=' && line[i + 1] === '"') {
        s += '=';
        i += 2;
        let v = '';
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\' && i + 1 < line.length) i++;
          v += line[i++];
        }
        i++;
        s += '\u0000' + v;
        break;
      }
      s += line[i++];
    }
    if (s) out.push({ v: s, quoted: false });
    else i++;
  }
  return out;
}

export interface DslMessage {
  line: number;
  message: string;
}

export interface DslResult {
  project: Project;
  errors: DslMessage[];
}

function timeOf(s: string, line: number, errors: DslMessage[]): number {
  const t = parseTime(s);
  if (t === null) {
    errors.push({ line, message: `시간 값이 올바르지 않습니다: "${s}"` });
    return 0;
  }
  return t;
}

function kv(t: Tk): [string, string] | null {
  if (t.quoted) return null;
  const eq = t.v.indexOf('=');
  if (eq <= 0) return null;
  const key = t.v.slice(0, eq);
  const val = t.v.slice(eq + 1).replace(/^\u0000/, '');
  return [key, val];
}

/** 텍스트 → 프로젝트. base 가 주어지면 PLC 설정 등 텍스트에 없는 정보를 유지한다. */
export function parseDsl(text: string, base?: Project): DslResult {
  const errors: DslMessage[] = [];
  const p = createProject();
  if (base) {
    // 텍스트에 없는 것은 지금 차트에서 이어 받는다 (표시 설정, 동작 순서표, 차트 탭 이름, 로고 …)
    p.id = base.id;
    p.revisions = base.revisions;
    p.plc = base.plc;
    p.sequence = base.sequence;
    p.sheet = base.sheet;
    p.settings = { ...p.settings, ...base.settings };
    p.meta = { ...p.meta, date: base.meta.date, logo: base.meta.logo, signLabels: base.meta.signLabels };
  }
  let group: string | undefined;
  const refs = new Map<string, Signal>();
  const pending: { line: number; run: () => void }[] = [];
  const lines = text.split(/\r?\n/);

  const findSig = (r: string, line: number): Signal | null => {
    const s = refs.get(r) ?? refs.get(r.toUpperCase());
    if (!s) {
      errors.push({ line, message: `신호 "${r}" 를 찾을 수 없습니다` });
      return null;
    }
    return s;
  };

  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const line = raw.replace(/^\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const meta = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (meta && !/^(sig|step|arrow|dim|note|marker|rule|group)\b/.test(line)) {
      const key = meta[1];
      const val = meta[2].trim();
      if ((META_KEYS as string[]).includes(key)) (p.meta as unknown as Record<string, string>)[key] = val;
      else if (key === 'duration') p.settings.duration = timeOf(val, ln, errors) || p.settings.duration;
      else if (key === 'grid') p.settings.grid = timeOf(val, ln, errors) || p.settings.grid;
      else if (key === 'unit') p.settings.timeUnit = val === 's' ? 's' : val === 'auto' ? 'auto' : 'ms';
      else errors.push({ line: ln, message: `알 수 없는 설정 "${key}"` });
      return;
    }
    const tks = tokenize(line);
    const cmd = tks[0]?.v;
    try {
      switch (cmd) {
        case 'group': {
          const g = tks
            .slice(1)
            .map((t) => t.v)
            .join(' ')
            .trim();
          group = g && g !== '-' ? g : undefined;
          break;
        }
        case 'sig': {
          const colon = tks.findIndex((t, i) => i > 0 && t.v === ':' && !t.quoted);
          const head = colon >= 0 ? tks.slice(1, colon) : tks.slice(1);
          const body = colon >= 0 ? tks.slice(colon + 1) : [];
          const address = head[0] && !(head[0].v === '-' && !head[0].quoted) ? head[0].v : '';
          const name = head[1]?.quoted ? head[1].v : address || '신호';
          const sig = createSignal({ name, address, group });
          for (const t of head.slice(head[1]?.quoted ? 2 : 1)) {
            const pair = kv(t);
            if (!pair) {
              if ((KINDS as string[]).includes(t.v)) sig.kind = t.v as SignalKind;
              else if ((ROLES as string[]).includes(t.v)) {
                sig.role = t.v as SignalRole;
                sig.color = ROLE_COLORS[sig.role];
              } else if (t.v === 'hidden') sig.hidden = true;
              else errors.push({ line: ln, message: `알 수 없는 속성 "${t.v}"` });
              continue;
            }
            const [k, v] = pair;
            const n = Number(v);
            switch (k) {
              case 'comment':
                sig.comment = v;
                break;
              case 'on':
                sig.onLabel = v;
                break;
              case 'off':
                sig.offLabel = v;
                break;
              case 'ramp':
                sig.defaultRamp = timeOf(v, ln, errors);
                break;
              case 'height':
                sig.heightScale = n || 1;
                break;
              case 'min':
                sig.analogMin = n;
                break;
              case 'max':
                sig.analogMax = n;
                break;
              case 'unit':
                sig.unit = v;
                break;
              case 'color':
                sig.color = v;
                break;
              case 'period':
                sig.clockPeriod = timeOf(v, ln, errors);
                break;
              case 'duty':
                sig.clockDuty = n;
                break;
              case 'phase':
                sig.clockPhase = timeOf(v, ln, errors);
                break;
              default:
                errors.push({ line: ln, message: `알 수 없는 속성 "${k}"` });
            }
          }
          // 파형: v0 | t v[~ramp] | ...
          const segs: Tk[][] = [[]];
          for (const t of body) {
            if (t.v === '|' && !t.quoted) segs.push([]);
            else segs[segs.length - 1].push(t);
          }
          const pts: WavePoint[] = [];
          const parseVal = (t: Tk): WavePoint['v'] => {
            if (sig.kind === 'bus') return t.v;
            if (sig.kind === 'analog') return Number(t.v) || 0;
            if (t.v === 'x' || t.v === 'z') return t.v;
            return t.v === '1' || t.v.toUpperCase() === 'ON' || t.v.toUpperCase() === 'H' ? 1 : 0;
          };
          segs.forEach((seg, i) => {
            if (!seg.length) return;
            if (i === 0 && seg.length === 1) {
              pts.push({ t: 0, v: parseVal(seg[0]) });
              return;
            }
            if (seg.length < 2) {
              errors.push({ line: ln, message: `"시간 값" 형식이 필요합니다: "${seg.map((s) => s.v).join(' ')}"` });
              return;
            }
            const t = timeOf(seg[0].v, ln, errors);
            let vt = seg[1];
            let ramp: number | undefined;
            const tilde = !vt.quoted ? vt.v.indexOf('~') : -1;
            if (tilde > 0) {
              ramp = timeOf(vt.v.slice(tilde + 1), ln, errors);
              vt = { v: vt.v.slice(0, tilde), quoted: false };
            } else if (seg[2] && seg[2].v.startsWith('~')) {
              ramp = timeOf(
                seg
                  .slice(2)
                  .map((x) => x.v)
                  .join('')
                  .slice(1),
                ln,
                errors,
              );
            }
            const pt: WavePoint = { t, v: parseVal(vt) };
            if (ramp) pt.ramp = ramp;
            pts.push(pt);
          });
          if (sig.kind !== 'clock') sig.points = normalize(pts.length ? pts : [{ t: 0, v: sig.kind === 'bus' ? '0' : 0 }], sig.kind, sig.kind === 'bus' ? '0' : 0);
          p.signals.push(sig);
          if (address) {
            refs.set(address, sig);
            refs.set(address.toUpperCase(), sig);
          }
          if (!refs.has(name)) refs.set(name, sig);
          break;
        }
        case 'step': {
          const label = tks[1]?.v ?? 'STEP';
          const range = tks[2]?.v ?? '';
          const m = /^(.+)\.\.(.+)$/.exec(range);
          if (!m) throw new Error('범위는 "시작..끝" 형식이어야 합니다');
          p.steps.push(
            createStep({
              label,
              start: timeOf(m[1], ln, errors),
              end: timeOf(m[2], ln, errors),
              description: tks[3]?.v ?? '',
              color: STEP_COLORS[p.steps.length % STEP_COLORS.length],
            }),
          );
          break;
        }
        default: {
          if (!['arrow', 'dim', 'note', 'marker', 'rule'].includes(cmd ?? '')) {
            errors.push({ line: ln, message: `알 수 없는 명령 "${cmd}"` });
            return;
          }
          // 주석/규칙은 모든 신호를 읽은 뒤 순서대로 처리 (신호 참조가 뒤에 나와도 됨)
          pending.push({ line: ln, run: () => parseRef(cmd!, tks, ln) });
        }
      }
    } catch (e) {
      errors.push({ line: ln, message: (e as Error).message });
    }
  });

  function at(tks: Tk[], i: number, ln: number): { sig: Signal | null; t: number; next: number } {
    // REF @ TIME
    const r = tks[i];
    if (!r || tks[i + 1]?.v !== '@') throw new Error('"신호@시간" 형식이 필요합니다');
    return { sig: findSig(r.v, ln), t: timeOf(tks[i + 2]?.v ?? '', ln, errors), next: i + 3 };
  }

  function limits(tks: Tk[]): { min?: number; max?: number } {
    const out: { min?: number; max?: number } = {};
    for (const t of tks) {
      const pair = kv(t);
      if (pair?.[0] === 'min') out.min = parseTime(pair[1]) ?? undefined;
      if (pair?.[0] === 'max') out.max = parseTime(pair[1]) ?? undefined;
    }
    return out;
  }

  function lastQuoted(tks: Tk[], from: number): string {
    for (let i = tks.length - 1; i >= from; i--) if (tks[i].quoted) return tks[i].v;
    return '';
  }

  function parseRef(cmd: string, tks: Tk[], ln: number) {
    switch (cmd) {
      case 'marker': {
        const t = timeOf(tks[1]?.v ?? '', ln, errors);
        const label = tks[2]?.quoted ? tks[2].v : '';
        const col = tks.map(kv).find((x) => x?.[0] === 'color')?.[1];
        p.annotations.push({ id: uid('ann'), type: 'marker', t, label, ...(col ? { color: col } : {}) });
        break;
      }
      case 'arrow': {
        const a = at(tks, 1, ln);
        const op = tks[a.next]?.v;
        if (op !== '->' && op !== '~>') throw new Error('"->" 가 필요합니다');
        const b = at(tks, a.next + 1, ln);
        if (!a.sig || !b.sig) return;
        const ann: Annotation = {
          id: uid('ann'),
          type: 'arrow',
          from: { signalId: a.sig.id, t: a.t },
          to: { signalId: b.sig.id, t: b.t },
          label: tks[b.next]?.quoted ? tks[b.next].v : '',
        };
        if (op === '~>') ann.dashed = true;
        p.annotations.push(ann);
        break;
      }
      case 'dim': {
        const r = tks[1];
        const sig = r && !(r.v === '-' && !r.quoted) ? findSig(r.v, ln) : null;
        const m = /^(.+)\.\.(.+)$/.exec(tks[2]?.v ?? '');
        if (!m) throw new Error('범위는 "시작..끝" 형식이어야 합니다');
        p.annotations.push({ id: uid('ann'), type: 'dimension', signalId: sig?.id ?? null, t1: timeOf(m[1], ln, errors), t2: timeOf(m[2], ln, errors), label: tks[3]?.quoted ? tks[3].v : '' });
        break;
      }
      case 'note': {
        const r = tks[1];
        const sig = r && !(r.v === '-' && !r.quoted) ? findSig(r.v, ln) : null;
        if (tks[2]?.v !== '@') throw new Error('"신호@시간" 형식이 필요합니다');
        p.annotations.push({ id: uid('ann'), type: 'note', signalId: sig?.id ?? null, t: timeOf(tks[3]?.v ?? '', ln, errors), text: tks[4]?.v ?? '' });
        break;
      }
      case 'rule': {
        const type = tks[1]?.v;
        let rule: TimingRule | null = null;
        if (type === 'delay') {
          const a = findSig(tks[2]?.v ?? '', ln);
          const b = findSig(tks[5]?.v ?? '', ln);
          if (tks[4]?.v !== '->') throw new Error('"->" 가 필요합니다');
          if (!a || !b) return;
          rule = {
            id: uid('rul'),
            type: 'delay',
            name: lastQuoted(tks, 7) || '응답 시간',
            fromSignal: a.id,
            fromEdge: (tks[3]?.v === 'fall' ? 'fall' : 'rise') as EdgeKind,
            toSignal: b.id,
            toEdge: (tks[6]?.v === 'fall' ? 'fall' : 'rise') as EdgeKind,
            ...limits(tks.slice(7)),
          };
        } else if (type === 'exclusive') {
          const a = findSig(tks[2]?.v ?? '', ln);
          const b = findSig(tks[3]?.v ?? '', ln);
          if (!a || !b) return;
          rule = { id: uid('rul'), type: 'exclusive', name: lastQuoted(tks, 4) || '동시 ON 금지', a: a.id, b: b.id };
        } else if (type === 'pulse') {
          const s = findSig(tks[2]?.v ?? '', ln);
          if (!s) return;
          rule = { id: uid('rul'), type: 'pulse', name: lastQuoted(tks, 4) || '펄스 폭', signal: s.id, level: tks[3]?.v === '0' ? 0 : 1, ...limits(tks.slice(4)) };
        } else if (type === 'cycle') {
          const lim = limits(tks.slice(2));
          if (lim.max === undefined) throw new Error('cycle 규칙에는 max= 가 필요합니다');
          rule = { id: uid('rul'), type: 'cycle', name: lastQuoted(tks, 2) || '사이클 타임', max: lim.max };
        } else throw new Error(`알 수 없는 규칙 종류 "${type}"`);
        p.rules.push(rule);
        break;
      }
    }
  }

  for (const job of pending) {
    try {
      job.run();
    } catch (e) {
      errors.push({ line: job.line, message: (e as Error).message });
    }
  }
  return { project: p, errors };
}
