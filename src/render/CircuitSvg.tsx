import type { ReactNode } from 'react';
import type { Circuit, Part } from '../circuit/types';
import { LAMP_HEX, PARTS, partBox, pinPositions, rotate } from '../circuit/parts';
import { CircuitModel, normTag, tagKey, type CircuitSim, type TagKind, type TimerView } from '../circuit/engine';
import { formatTime } from '../model/format';
import { FONT } from './layout';

/** 격자 한 칸 (px) */
export const G = 20;

export interface CircuitColors {
  bg: string;
  grid: string;
  ink: string;
  muted: string;
  accent: string;
  select: string;
  danger: string;
  fillOn: string;
}

export const CIRCUIT_LIGHT: CircuitColors = { bg: '#ffffff', grid: '#cfd6df', ink: '#1f2937', muted: '#6b7280', accent: '#2563eb', select: '#f59e0b', danger: '#dc2626', fillOn: '#bfdbfe' };
export const CIRCUIT_DARK: CircuitColors = { bg: '#101822', grid: '#2a3a50', ink: '#dbe3ee', muted: '#8a9ab0', accent: '#5b9bff', select: '#fbbf24', danger: '#f87171', fillOn: '#1e3a8a' };

/** 전원 극별 선 색 (L1/+24V 빨강, L2 주황, L3 보라, N/0V 파랑) */
export const POLE_COLOR: Record<string, string> = { L1: '#dc2626', '+24V': '#dc2626', L2: '#d97706', L3: '#7c3aed', N: '#2563eb', '0V': '#2563eb', short: '#ef4444' };

/** 그릴 때 필요한 부품 상태 (시뮬레이션 중이 아니면 평상시 상태) */
export interface PartState {
  closed: boolean;
  /** 조작 기기가 눌림 / 켜짐 */
  act: boolean;
  /** 부하가 동작 (코일 여자, 램프 점등 …) */
  on: boolean;
  dir: 1 | -1 | 0;
  openPhase: boolean;
  timer: TimerView | null;
  pos: number;
  /** 접점이 따르는 기기 종류 (타이머 한시 접점, THR 접점 표시용) */
  link?: TagKind;
}

export function partState(p: Part, model: CircuitModel, sim: CircuitSim | null): PartState {
  const tag = tagKey(p);
  const def = PARTS[p.type];
  if (!sim) {
    const act = !!def.defaultOn;
    return { closed: def.nc ? !act : act || p.type === 'fuse' || p.type === 'fuse3', act, on: false, dir: 0, openPhase: false, timer: null, pos: 0, link: model.tagKind.get(tag) };
  }
  return {
    closed: def.poles ? sim.closed(p) : false,
    act: sim.on(tag),
    on: sim.energized.has(p.id),
    dir: sim.motorDir.get(p.id) ?? 0,
    openPhase: sim.openPhase.has(p.id),
    timer: p.type === 'timer' ? sim.timerView(tag) : null,
    pos: p.type === 'cyl' ? sim.cylPos(tag) : 0,
    link: model.tagKind.get(tag),
  };
}

// ───────────────────────── 기호 ─────────────────────────

/** 접점 하나 (0,-40)~(0,40). actuator: 왼쪽에 붙는 조작부 */
function Contact({ closed, nc, c, x = 0, actuator, act, main }: { closed: boolean; nc: boolean; c: CircuitColors; x?: number; actuator?: ReactNode; act?: boolean; main?: boolean }) {
  const end = closed ? (nc ? [x + 10, -12] : [x, -12]) : [x - 11, -11];
  return (
    <g>
      <path d={`M${x},-40V-12M${x},40V12${nc ? `M${x},-12h10` : ''}`} stroke={c.ink} />
      {main && <path d={`M${x - 3},-12a3,3 0 0 0 6,0`} stroke={c.ink} fill="none" />}
      <path d={`M${x},12L${end[0]},${end[1]}`} stroke={closed ? c.accent : c.ink} strokeWidth={2.2} />
      {actuator && (
        <g transform={act ? 'translate(3,0)' : undefined}>
          <path d={`M${x - 6},0H${x - 16}`} stroke={c.muted} strokeDasharray="2 2" />
          {actuator}
        </g>
      )}
    </g>
  );
}

const PB = (c: CircuitColors, fill?: string) => <path d="M-16,-7V7M-16,-7h-5M-16,7h-5" stroke={c.ink} fill={fill ?? 'none'} />;

function actuatorFor(p: Part, st: PartState, c: CircuitColors): ReactNode {
  switch (p.type) {
    case 'pb_no':
    case 'pb_nc':
      return (
        <>
          {PB(c)}
          {p.color && <rect x={-25} y={-5} width={4} height={10} fill={LAMP_HEX[p.color]} stroke="none" />}
        </>
      );
    case 'sw_no':
    case 'sw_nc':
      return <path d="M-16,-7V7M-16,-7l-4,-4M-16,7l-4,4" stroke={c.ink} fill="none" />;
    case 'estop':
      return <path d="M-16,-9A9,9 0 0 0 -16,9Z" stroke={c.ink} fill={st.act ? '#ef4444' : '#fca5a5'} />;
    case 'ls_no':
    case 'ls_nc':
      return (
        <>
          <path d="M-16,0l-4,-5" stroke={c.ink} />
          <circle cx={-22} cy={-7} r={3} stroke={c.ink} fill="none" />
        </>
      );
    case 'mcb':
      return <rect x={-24} y={-5} width={8} height={10} stroke={c.ink} fill={st.act ? c.fillOn : 'none'} />;
    case 'no':
    case 'nc':
      if (st.link === 'timer') return <path d="M-16,-6A6,6 0 0 0 -16,6" stroke={c.ink} fill="none" />;
      if (st.link === 'thr') return <path d="M-16,-5h-4v10h-4" stroke={c.ink} fill="none" />;
      if (st.link === 'operator') return PB(c);
      return null;
    default:
      return null;
  }
}

function Coil({ st, c, timer }: { st: PartState; c: CircuitColors; timer?: boolean }) {
  return (
    <g>
      <path d="M0,-40V-10M0,10V40" stroke={c.ink} />
      <rect x={-15} y={-10} width={30} height={20} stroke={st.on ? c.accent : c.ink} fill={st.on ? c.fillOn : c.bg} strokeWidth={st.on ? 2.2 : 1.6} />
      {timer && <path d="M-15,-10h9v20h-9zM-15,-10l9,20M-6,-10l-9,20" stroke={c.ink} fill="none" strokeWidth={1.1} />}
      {timer && st.timer && st.timer.elapsed !== null && st.timer.preset > 0 && (
        <rect x={-6} y={6} width={21 * Math.min(1, st.timer.elapsed / st.timer.preset)} height={4} fill={c.accent} stroke="none" />
      )}
    </g>
  );
}

function Spinner({ r, dir, c }: { r: number; dir: 1 | -1 | 0; c: CircuitColors }) {
  if (!dir) return null;
  return (
    <g className={`cc-spin ${dir < 0 ? 'rev' : ''}`}>
      <path d={`M${r * 0.75},0A${r * 0.75},${r * 0.75} 0 0 1 0,${r * 0.75}`} stroke={c.accent} strokeWidth={2.4} fill="none" />
      <path d={`M${-r * 0.75},0A${r * 0.75},${r * 0.75} 0 0 1 0,${-r * 0.75}`} stroke={c.accent} strokeWidth={2.4} fill="none" />
    </g>
  );
}

/** 회전 0° 기준으로 그린 부품 (원점 = 부품 좌표) */
export function PartGlyph({ part: p, st, c, sensors }: { part: Part; st: PartState; c: CircuitColors; sensors?: { plus: string[]; minus: string[] } }) {
  const nc = !!PARTS[p.type].nc;
  switch (p.type) {
    case 'src': {
      const col = POLE_COLOR[p.pole === 'L' ? 'L1' : p.pole ?? 'L1'] ?? c.ink;
      return (
        <g>
          <circle r={5} fill={c.bg} stroke={col} strokeWidth={2} />
          <text y={-11} textAnchor="middle" fontSize={13} fontWeight={700} fill={col} stroke="none">
            {p.pole ?? 'L'}
          </text>
        </g>
      );
    }
    case 'src3':
      return (
        <g>
          <path d="M-50,-12H50" stroke={c.muted} strokeWidth={1} />
          {(['L1', 'L2', 'L3'] as const).map((l, i) => (
            <g key={l} transform={`translate(${(i - 1) * 40},0)`}>
              <path d="M0,-12V15" stroke={POLE_COLOR[l]} strokeWidth={2} />
              <circle cy={20} r={4} fill={c.bg} stroke={POLE_COLOR[l]} strokeWidth={2} />
              <text x={4} y={-16} fontSize={12} fontWeight={700} fill={POLE_COLOR[l]} stroke="none">
                {l}
              </text>
            </g>
          ))}
        </g>
      );
    case 'fuse':
      return (
        <g>
          <path d="M0,-40V40" stroke={c.ink} />
          <rect x={-6} y={-16} width={12} height={32} fill={c.bg} stroke={c.ink} />
          <path d="M0,-16V16" stroke={c.ink} />
        </g>
      );
    case 'fuse3':
      return (
        <g>
          {[-40, 0, 40].map((x) => (
            <g key={x} transform={`translate(${x},0)`}>
              <path d="M0,-40V40" stroke={c.ink} />
              <rect x={-6} y={-16} width={12} height={32} fill={c.bg} stroke={c.ink} />
              <path d="M0,-16V16" stroke={c.ink} />
            </g>
          ))}
        </g>
      );
    case 'mcb':
      return (
        <g>
          <Contact closed={st.closed} nc={false} c={c} actuator={actuatorFor(p, st, c)} />
          <path d="M-4,-16l8,8M4,-16l-8,8" stroke={c.ink} />
        </g>
      );
    case 'mcb3':
    case 'km3':
      return (
        <g>
          <path d="M-52,0H44" stroke={c.muted} strokeDasharray="3 3" />
          {[-40, 0, 40].map((x) => (
            <g key={x}>
              <Contact closed={st.closed} nc={false} c={c} x={x} main={p.type === 'km3'} />
              {p.type === 'mcb3' && <path d={`M${x - 4},-16l8,8M${x + 4},-16l-8,8`} stroke={c.ink} />}
            </g>
          ))}
          {p.type === 'mcb3' && <rect x={-64} y={-5} width={10} height={10} stroke={c.ink} fill={st.act ? c.fillOn : c.bg} />}
        </g>
      );
    case 'ol3':
      return (
        <g>
          <rect x={-52} y={-15} width={104} height={30} fill="none" stroke={st.act ? c.danger : c.muted} strokeDasharray={st.act ? undefined : '4 3'} />
          {[-40, 0, 40].map((x) => (
            <path key={x} d={`M${x},-40V-9h7v18h-7V40`} stroke={st.act ? c.danger : c.ink} fill="none" />
          ))}
          {st.act && (
            <text x={0} y={-19} textAnchor="middle" fontSize={11} fontWeight={700} fill={c.danger} stroke="none">
              TRIP
            </text>
          )}
        </g>
      );
    case 'pb_no':
    case 'pb_nc':
    case 'sw_no':
    case 'sw_nc':
    case 'estop':
    case 'ls_no':
    case 'ls_nc':
    case 'no':
    case 'nc':
      return <Contact closed={st.closed} nc={nc} c={c} actuator={actuatorFor(p, st, c)} act={st.act && (p.type === 'pb_no' || p.type === 'pb_nc')} />;
    case 'coil':
      return <Coil st={st} c={c} />;
    case 'timer':
      return <Coil st={st} c={c} timer />;
    case 'sol':
      return (
        <g>
          <path d="M0,-40V-10M0,10V40" stroke={c.ink} />
          <rect x={-15} y={-10} width={30} height={20} stroke={st.on ? c.accent : c.ink} fill={st.on ? c.fillOn : c.bg} strokeWidth={st.on ? 2.2 : 1.6} />
          <path d="M-15,10L15,-10" stroke={c.ink} />
        </g>
      );
    case 'lamp': {
      const col = LAMP_HEX[p.color ?? 'red'];
      return (
        <g>
          <path d="M0,-40V-12M0,12V40" stroke={c.ink} />
          {st.on && <circle r={19} fill={col} opacity={0.35} stroke="none" />}
          <circle r={12} fill={st.on ? col : c.bg} stroke={st.on ? col : c.ink} strokeWidth={st.on ? 2.2 : 1.6} />
          <path d="M-8.5,-8.5L8.5,8.5M8.5,-8.5L-8.5,8.5" stroke={st.on ? '#ffffff' : c.ink} strokeWidth={1.2} />
          {!st.on && <circle r={5} fill={col} opacity={0.55} stroke="none" />}
        </g>
      );
    }
    case 'buzzer':
      return (
        <g>
          <path d="M0,-40V-6M0,10V40" stroke={c.ink} />
          <path d="M-13,10A13,13 0 0 1 13,10Z" fill={st.on ? c.fillOn : c.bg} stroke={st.on ? c.accent : c.ink} />
          {st.on && <path d="M17,-8a14,14 0 0 1 0,16M21,-12a20,20 0 0 1 0,24" stroke={c.accent} fill="none" />}
        </g>
      );
    case 'motor':
      return (
        <g>
          <path d="M0,-40V-16M0,16V40" stroke={c.ink} />
          <circle r={16} fill={st.on ? c.fillOn : c.bg} stroke={st.on ? c.accent : c.ink} strokeWidth={st.on ? 2.2 : 1.6} />
          <Spinner r={16} dir={st.dir} c={c} />
          <text y={5} textAnchor="middle" fontSize={14} fontWeight={700} fill={c.ink} stroke="none">
            M
          </text>
        </g>
      );
    case 'motor3':
      return (
        <g>
          <path d="M-40,-40V-12L-15,4M0,-40V-6M40,-40V-12L15,4" stroke={c.ink} fill="none" />
          <circle cy={22} r={24} fill={st.on ? c.fillOn : c.bg} stroke={st.openPhase ? c.danger : st.on ? c.accent : c.ink} strokeWidth={st.on ? 2.2 : 1.6} />
          <g transform="translate(0,22)">
            <Spinner r={24} dir={st.dir} c={c} />
          </g>
          <text y={21} textAnchor="middle" fontSize={15} fontWeight={700} fill={c.ink} stroke="none">
            M
          </text>
          <text y={36} textAnchor="middle" fontSize={11} fill={c.ink} stroke="none">
            3~
          </text>
          {st.dir !== 0 && (
            <text x={30} y={52} fontSize={11} fontWeight={700} fill={c.accent} stroke="none">
              {st.dir > 0 ? 'FWD' : 'REV'}
            </text>
          )}
        </g>
      );
    case 'cyl': {
      const px = 6 + st.pos * 104;
      const rodEnd = px + 8 + 116;
      const spring = !p.solMinus?.trim();
      return (
        <g>
          <rect x={0} y={-16} width={120} height={32} fill={c.bg} stroke={c.ink} />
          {spring && <path d="M100,-12l4,4-8,4 8,4-8,4 8,4-4,4" stroke={c.muted} fill="none" transform={`translate(${(px - 6) * 0.4},0)`} />}
          <rect x={px} y={-14} width={8} height={28} fill={c.ink} stroke="none" />
          <rect x={px + 8} y={-3} width={116} height={6} fill={c.muted} stroke="none" />
          <rect x={rodEnd} y={-8} width={5} height={16} fill={c.ink} stroke="none" />
          <path d="M10,16v6M110,16v6" stroke={c.ink} />
          {[
            { x: 134, tags: sensors?.minus ?? [], at: st.pos <= 0.03 },
            { x: 238, tags: sensors?.plus ?? [], at: st.pos >= 0.999 },
          ].map((s) =>
            s.tags.length ? (
              <g key={s.x}>
                <path d={`M${s.x - 5},26h10l-5,-7z`} fill={s.at ? c.accent : 'none'} stroke={c.accent} />
                <text x={s.x} y={38} textAnchor="middle" fontSize={10} fill={c.accent} stroke="none">
                  {s.tags.join(',')}
                </text>
              </g>
            ) : null,
          )}
        </g>
      );
    }
    case 'text':
      return (
        <text y={0} fontSize={14} fontWeight={600} fill={c.ink} stroke="none">
          {p.text}
        </text>
      );
  }
}

/** 기호·설명·단자 번호 (글자는 돌리지 않는다) */
export function PartLabels({ part: p, st, c }: { part: Part; st: PartState; c: CircuitColors }) {
  if (p.type === 'src' || p.type === 'src3' || p.type === 'text') return null;
  const X = p.x * G;
  const Y = p.y * G;
  const vertical = p.rot === 0 || p.rot === 180;
  const wide = p.type === 'km3' || p.type === 'mcb3' || p.type === 'ol3' || p.type === 'fuse3' || p.type === 'motor3';
  let lines: string[] = [p.tag];
  if (p.name) lines.push(p.name);
  if (p.type === 'timer') lines[0] = `${p.tag} ${formatTime(p.preset ?? 3000, 's').replace(' ', '')}${p.timerMode === 'off' ? ' OFF' : ''}`;
  if (p.type === 'cyl') lines = [[p.tag, p.name].filter(Boolean).join(' '), `${p.solPlus || '?'}${p.solMinus ? ` / ${p.solMinus}` : ''}`];
  let lx: number;
  let ly: number;
  let anchor: 'start' | 'middle' = 'start';
  if (p.type === 'cyl') {
    const [x0, y0] = partBox(p);
    lx = x0 * G;
    ly = y0 * G - 8 - (lines.length - 1) * 12;
  } else if (vertical) {
    lx = X + (wide ? 3 * G - 6 : 0.9 * G);
    ly = Y - 4 - (lines.length - 1) * 6;
  } else {
    lx = X;
    ly = Y - (wide ? 3.3 : 1.4) * G - (lines.length - 1) * 12;
    anchor = 'middle';
  }
  const pinLabels = PARTS[p.type].pins.filter((pin) => pin.label).length && !wide;
  const pinText = (i: number, label: string) => {
    if (st.link === 'thr' && (p.type === 'nc' || p.type === 'no')) return p.type === 'nc' ? ['95', '96'][i] : ['97', '98'][i];
    if (st.link === 'timer' && (p.type === 'nc' || p.type === 'no')) return p.type === 'nc' ? ['55', '56'][i] : ['67', '68'][i];
    return label;
  };
  return (
    <g fontFamily={FONT} stroke="none">
      {lines.map((l, i) => (
        <text key={i} x={lx} y={ly + i * 13} textAnchor={anchor} fontSize={i === 0 ? 12.5 : 11} fontWeight={i === 0 ? 700 : 400} fill={i === 0 ? c.ink : c.muted}>
          {l}
        </text>
      ))}
      {st.timer && st.timer.elapsed !== null && (
        <text x={lx} y={ly + lines.length * 13} textAnchor={anchor} fontSize={11} fontWeight={700} fill={c.accent}>
          {(st.timer.elapsed / 1000).toFixed(1)} / {(st.timer.preset / 1000).toFixed(1)}s
        </text>
      )}
      {pinLabels &&
        PARTS[p.type].pins.map((pin, i) => {
          const [ox, oy] = rotate(-7, pin.y < 0 ? -26 : 30, p.rot);
          const [px, py] = pinPositions(p)[i];
          return (
            <text key={i} x={px * G + ox} y={py * G + oy + 3} textAnchor="middle" fontSize={8.5} fill={c.muted}>
              {pinText(i, pin.label)}
            </text>
          );
        })}
    </g>
  );
}

/** 실린더 끝에 연결된 센서 기호 */
export function cylinderSensors(circuit: Circuit): Map<string, { plus: string[]; minus: string[] }> {
  const m = new Map<string, { plus: string[]; minus: string[] }>();
  for (const p of circuit.parts) {
    if ((p.type !== 'ls_no' && p.type !== 'ls_nc') || !p.cyl) continue;
    const k = normTag(p.cyl);
    const s = m.get(k) ?? { plus: [], minus: [] };
    const list = p.end === '-' ? s.minus : s.plus;
    if (p.tag && !list.includes(p.tag)) list.push(p.tag);
    m.set(k, s);
  }
  return m;
}

export interface LayerOptions {
  sim?: CircuitSim | null;
  selected?: Set<string>;
  /** 문제가 있는 부품 */
  flagged?: Set<string>;
  showPins?: boolean;
}

/** 선·점·부품·글자 (편집기와 인쇄 공용) */
export function CircuitLayer({ circuit, model, c, o = {} }: { circuit: Circuit; model: CircuitModel; c: CircuitColors; o?: LayerOptions }) {
  const sim = o.sim ?? null;
  const sensors = cylinderSensors(circuit);
  const wireColor = (id: string) => {
    if (!sim) return null;
    const n = model.net.wireNet.get(id);
    const pole = n === undefined ? null : sim.netPole[n];
    return pole ? POLE_COLOR[pole] ?? c.accent : null;
  };
  return (
    <g fontFamily={FONT} strokeLinecap="round" strokeLinejoin="round">
      {circuit.wires.map((w) => {
        const col = wireColor(w.id);
        const sel = o.selected?.has(w.id);
        return (
          <g key={w.id}>
            {sel && <line x1={w.a[0] * G} y1={w.a[1] * G} x2={w.b[0] * G} y2={w.b[1] * G} stroke={c.select} strokeWidth={7} opacity={0.5} />}
            <line x1={w.a[0] * G} y1={w.a[1] * G} x2={w.b[0] * G} y2={w.b[1] * G} stroke={col ?? c.ink} strokeWidth={col ? 2.6 : 1.8} className={col === POLE_COLOR.short ? 'cc-short' : undefined} />
          </g>
        );
      })}
      {model.net.junctions.map(([x, y]) => (
        <circle key={`j${x},${y}`} cx={x * G} cy={y * G} r={3.4} fill={c.ink} />
      ))}
      {circuit.parts.map((p) => {
        const st = partState(p, model, sim);
        const sel = o.selected?.has(p.id);
        const flag = o.flagged?.has(p.id);
        const [x0, y0, x1, y1] = partBox(p);
        return (
          <g key={p.id} data-part={p.id}>
            {(sel || flag) && <rect x={x0 * G - 3} y={y0 * G - 3} width={(x1 - x0) * G + 6} height={(y1 - y0) * G + 6} rx={4} fill={sel ? c.select : 'none'} fillOpacity={0.14} stroke={sel ? c.select : c.danger} strokeDasharray={sel ? undefined : '4 3'} />}
            <g transform={`translate(${p.x * G},${p.y * G})${p.rot ? ` rotate(${p.rot})` : ''}`} fill="none" strokeWidth={1.6}>
              <PartGlyph part={p} st={st} c={c} sensors={p.type === 'cyl' ? sensors.get(normTag(p.tag)) : undefined} />
            </g>
            <PartLabels part={p} st={st} c={c} />
            {o.showPins &&
              pinPositions(p).map(([x, y], i) => {
                const n = model.net.pinNet.get(`${p.id}:${i}`)!;
                const open = model.net.pinCount[n] <= 1 && !model.net.hasWire[n];
                return <circle key={i} cx={x * G} cy={y * G} r={open ? 3.2 : 2} fill={open ? c.bg : c.ink} stroke={open ? c.danger : 'none'} strokeWidth={1.4} />;
              })}
          </g>
        );
      })}
    </g>
  );
}

/** 회로 전체의 범위 (격자) */
export function circuitBounds(circuit: Circuit): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const p of circuit.parts) {
    const [a, b, cc, d] = partBox(p);
    add(a, b);
    // 오른쪽 글자 자리
    add(cc + (p.type === 'text' ? 0 : 3.5), d + 0.6);
  }
  for (const w of circuit.wires) {
    add(...w.a);
    add(...w.b);
  }
  if (x0 === Infinity) return [0, 0, 10, 10];
  return [x0 - 1, y0 - 1.5, x1 + 1, y1 + 1];
}

/** 정적 회로도 (보고서·이미지 내보내기) */
export function CircuitSvg({ circuit, width, height, c = CIRCUIT_LIGHT, frame }: { circuit: Circuit; width?: number; height?: number; c?: CircuitColors; frame?: boolean }) {
  const model = new CircuitModel(circuit);
  const [x0, y0, x1, y1] = circuitBounds(circuit);
  const vw = (x1 - x0) * G;
  const vh = (y1 - y0) * G;
  let w = width ?? vw;
  let h = height ?? vh;
  if (width && height) {
    const k = Math.min(width / vw, height / vh);
    w = vw * k;
    h = vh * k;
  } else if (width) h = (vh * width) / vw;
  else if (height) w = (vw * height) / vh;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`${x0 * G} ${y0 * G} ${vw} ${vh}`} fontFamily={FONT} style={{ background: c.bg }}>
      <rect x={x0 * G} y={y0 * G} width={vw} height={vh} fill={c.bg} stroke={frame ? c.muted : 'none'} />
      <CircuitLayer circuit={circuit} model={model} c={c} />
    </svg>
  );
}
