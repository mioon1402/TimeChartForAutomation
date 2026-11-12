import type { CableMethod, CableSpec, Circuit, LampColor, OpStep, Part, PartType, Pole, Rot, Wire, WireColor } from './types';
import { PARTS } from './parts';
import { uid } from '../model/wave';

const POLES: Pole[] = ['+24V', '0V', 'L', 'N', 'L1', 'L2', 'L3', 'PE'];
const METHODS: CableMethod[] = ['A1', 'A2', 'B1', 'B2', 'C', 'D1', 'D2', 'E', 'F'];

function sanitizeCable(raw: unknown): CableSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const mm2 = n(q.mm2, 0.1, 5000);
  const len = n(q.len, 0, 1e5);
  if (mm2 === null || len === null) return null;
  const c: CableSpec = { ins: q.ins === 'pvc' ? 'pvc' : 'xlpe', mm2, method: METHODS.includes(q.method as CableMethod) ? (q.method as CableMethod) : 'B1', cores: q.cores === 2 ? 2 : 3, len };
  if (q.kind === 'bus') c.kind = 'bus';
  const amb = n(q.amb, -20, 90);
  if (amb !== null && amb !== 30) c.amb = amb;
  const group = n(q.group, 1, 50);
  if (group !== null && group > 1) c.group = Math.round(group);
  const iz = n(q.iz, 0.1, 1e5);
  if (iz !== null) c.iz = iz;
  return c;
}

const WIRE_COLORS: WireColor[] = ['brown', 'black', 'grey', 'blue', 'gy', 'red', 'yellow', 'white', 'orange'];
const COLORS: LampColor[] = ['red', 'green', 'yellow', 'white', 'blue'];

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const pt = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [Math.round(v[0]), Math.round(v[1])] : null);

/** 파일·자동 백업에서 읽은 회로를 검사하고 빠진 값을 채운다 (모르는 부품은 뺀다) */
export function sanitizeCircuit(raw: unknown): Circuit | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const parts: Part[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(o.parts) ? o.parts : []) {
    if (!r || typeof r !== 'object') continue;
    const q = r as Record<string, unknown>;
    const type = q.type as PartType;
    if (!(type in PARTS)) continue;
    let id = str(q.id) || uid('cp');
    if (seen.has(id)) id = uid('cp');
    seen.add(id);
    const rot = ([0, 90, 180, 270].includes(q.rot as number) ? q.rot : 0) as Rot;
    const p: Part = { id, type, x: Math.round(num(q.x)), y: Math.round(num(q.y)), rot, tag: str(q.tag) };
    if (optStr(q.name)) p.name = str(q.name);
    if (optStr(q.spec)) p.spec = str(q.spec);
    if (POLES.includes(q.pole as Pole)) p.pole = q.pole as Pole;
    if (q.timerMode === 'on' || q.timerMode === 'off' || q.timerMode === 'flicker') p.timerMode = q.timerMode;
    if (typeof q.preset === 'number' && q.preset >= 0) p.preset = q.preset;
    if (COLORS.includes(q.color as LampColor)) p.color = q.color as LampColor;
    if (typeof q.stroke === 'number' && q.stroke >= 0) p.stroke = q.stroke;
    if (typeof q.strokeBack === 'number' && q.strokeBack >= 0) p.strokeBack = q.strokeBack;
    if (typeof q.solPlus === 'string') p.solPlus = q.solPlus;
    if (typeof q.solMinus === 'string') p.solMinus = q.solMinus;
    if (optStr(q.cyl)) p.cyl = str(q.cyl);
    if (q.end === '+' || q.end === '-') p.end = q.end;
    if (typeof q.text === 'string') p.text = q.text;
    if (optStr(q.inBase)) p.inBase = str(q.inBase);
    if (optStr(q.outBase)) p.outBase = str(q.outBase);
    if (['inductive', 'capacitive', 'photo', 'reed', 'float', 'pressure'].includes(q.sense as string)) p.sense = q.sense as Part['sense'];
    if (q.npn === true) p.npn = true;
    if (optStr(q.solA)) p.solA = str(q.solA);
    if (optStr(q.solB)) p.solB = str(q.solB);
    if (typeof q.speed === 'number' && q.speed > 0) p.speed = Math.min(100, q.speed);
    if (typeof q.n === 'number' && q.n >= 1) p.n = Math.min(40, Math.round(q.n));
    if (q.inst13 === true) p.inst13 = true;
    if (typeof q.watt === 'number' && q.watt >= 0 && q.watt < 1e8) p.watt = q.watt;
    if (typeof q.pf === 'number' && q.pf > 0 && q.pf <= 1) p.pf = q.pf;
    if (typeof q.eff === 'number' && q.eff > 0 && q.eff <= 1) p.eff = q.eff;
    if (typeof q.volt === 'number' && q.volt > 0 && q.volt < 1e5) p.volt = q.volt;
    if (q.lighting === true) p.lighting = true;
    if (typeof q.amps === 'number' && q.amps > 0 && q.amps < 1e5) p.amps = q.amps;
    if (q.elb === true) p.elb = true;
    if (q.bars === 3 || q.bars === 4) p.bars = q.bars;
    if (typeof q.mm2 === 'number' && q.mm2 > 0 && q.mm2 < 1e5) p.mm2 = q.mm2;
    if (typeof q.w === 'number' && q.w >= 2) p.w = Math.min(400, Math.round(q.w));
    if (typeof q.h === 'number' && q.h >= 2) p.h = Math.min(400, Math.round(q.h));
    if (Array.isArray(q.sched)) {
      const day = 86400000;
      const sched = q.sched
        .filter((x): x is [number, number] => Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] === 'number' && Number.isFinite(x[0]) && Number.isFinite(x[1]))
        .map((x) => [((x[0] % day) + day) % day, ((x[1] % day) + day) % day] as [number, number])
        .slice(0, 24);
      p.sched = sched;
    }
    parts.push(p);
  }
  const wires: Wire[] = [];
  for (const r of Array.isArray(o.wires) ? o.wires : []) {
    if (!r || typeof r !== 'object') continue;
    const q = r as Record<string, unknown>;
    const a = pt(q.a);
    const b = pt(q.b);
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const w: Wire = { id: str(q.id) || uid('cw'), a, b };
    if (WIRE_COLORS.includes(q.color as WireColor)) w.color = q.color as WireColor;
    const cable = sanitizeCable(q.cable);
    if (cable) w.cable = cable;
    wires.push(w);
  }
  const ops: OpStep[] = [];
  for (const r of Array.isArray(o.ops) ? o.ops : []) {
    if (!r || typeof r !== 'object') continue;
    const q = r as Record<string, unknown>;
    const action = q.action === 'on' || q.action === 'off' ? q.action : 'press';
    const op: OpStep = { id: str(q.id) || uid('op'), wait: Math.max(0, num(q.wait)), tag: str(q.tag), action, hold: Math.max(0, num(q.hold, 300)) };
    if (optStr(q.note)) op.note = str(q.note);
    ops.push(op);
  }
  const c: Circuit = { parts, wires, ops };
  if (typeof o.duration === 'number' && o.duration > 0) c.duration = o.duration;
  if (o.autoChart === false) c.autoChart = false;
  if (typeof o.applied === 'string') c.applied = o.applied;
  if (typeof o.clock === 'number' && o.clock > 0 && o.clock < 86400000) c.clock = o.clock;
  if (o.supply === 'hv') c.supply = 'hv';
  if (typeof o.vll === 'number' && o.vll > 0 && o.vll < 1e5) c.vll = o.vll;
  if (Array.isArray(o.wired)) {
    const wired = o.wired.filter((x): x is string => typeof x === 'string' && x.length < 200);
    if (wired.length) c.wired = wired;
  }
  return c;
}
