import type { ReactNode, JSX } from 'react';
import type { Circuit, Part, WireColor } from '../circuit/types';
import { LAMP_HEX, PARTS, partBox, pinPositions, plcAddresses, REAL, rotate, schedOn, tswSched } from '../circuit/parts';
import { airDriven, CircuitModel, normTag, tagKey, type CircuitSim, type TagKind, type TimerView } from '../circuit/engine';
import { AirSupplyGlyph, FlowCtrlGlyph, FrlGlyph, ProxGlyph, SmpsGlyph, TUBE, TUBE_P, ValveGlyph } from './PneuSymbols';
import { EstopGlyph, LightGlyph, LoadGlyph, PanelGlyph, PanelTitle, panelTitleWidth, Sw3Glyph, SwGlyph, TswGlyph, McbGlyph, McGlyph, PbGlyph, Relay8Glyph, RLampGlyph, RMotorGlyph, SsGlyph, TbGlyph, TermGlyph, Timer8Glyph, ThrGlyph, WIRE_HEX } from './RealSymbols';
import { formatTime } from '../model/format';
import { wireNoLabels, wiringList } from '../circuit/wiring';
import type { PowerState } from '../circuit/power';
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
  /** PLC 입출력 램프 */
  plcIn?: boolean[];
  plcOut?: boolean[];
  /** 3선식 센서·SMPS 전원 */
  powered?: boolean;
  /** 밸브 위치와 솔레노이드 (14쪽, 12쪽) */
  valve?: 'a' | 'b' | 'c';
  solOn?: [boolean, boolean];
  /** 전기 해석: 부하의 전압 · 전류, 차단기 · 접점에 흐르는 전류 */
  pw?: { v: number; i: number; p: number };
  amp?: number;
  /** 타임 스위치: 다이얼 시각, 접점, 시계가 도는 중 */
  tsw?: { dial: number; out: boolean; run: boolean };
  /** 실린더: 스프링 복귀 (단동), 배관으로 움직임 */
  spring?: boolean;
  air?: boolean;
}

export function partState(p: Part, model: CircuitModel, sim: CircuitSim | null): PartState {
  const tag = tagKey(p);
  const def = PARTS[p.type];
  const air = p.type === 'cyl' && airDriven(model, tag);
  const spring = p.type === 'cyl' ? (air ? !model.cylPorts.get(tag)!.rodTubed : !p.solMinus?.trim()) : undefined;
  if (!sim) {
    const act = !!def.defaultOn;
    if (p.type === 'r_tsw') {
      const dial = model.circuit.clock ?? 0;
      return { closed: false, act: false, on: false, dir: 0, openPhase: false, timer: null, pos: 0, link: 'tsw', tsw: { dial, out: schedOn(tswSched(p), dial), run: true } };
    }
    return { closed: def.nc ? !act : act || p.type === 'fuse' || p.type === 'fuse3', act, on: false, dir: 0, openPhase: false, timer: null, pos: 0, link: model.tagKind.get(tag), spring, air };
  }
  const sol = (t?: string) => !!t?.trim() && sim.loadOn(normTag(t));
  return {
    spring,
    air,
    powered: sim.powered.get(p.id),
    valve: sim.valvePos.get(p.id),
    solOn: [sol(p.solA), sol(p.solB)],
    closed: def.poles ? sim.closed(p) : false,
    act: sim.on(tag),
    on: sim.energized.has(p.id),
    dir: sim.motorDir.get(p.id) ?? 0,
    openPhase: sim.openPhase.has(p.id),
    timer: p.type === 'timer' || p.type === 'r_timer8' ? sim.timerView(tag) : null,
    pos: p.type === 'cyl' ? sim.cylPos(tag) : 0,
    link: model.tagKind.get(tag),
    tsw: p.type === 'r_tsw' ? sim.tsw.get(tag) : undefined,
    plcIn: p.type === 'plc' ? sim.plcIn.get(p.id) : undefined,
    plcOut: p.type === 'plc' ? sim.plcOut.get(p.id) : undefined,
  };
}

/** PLC: 입력 I0~I7 (위), 공통 C 와 릴레이 출력 Q0~Q7 (아래), 입출력 램프 */
function PlcGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const { ins, outs } = plcAddresses(p);
  const xs = Array.from({ length: 8 }, (_, n) => -140 + 40 * n);
  return (
    <g>
      {xs.map((x) => (
        <path key={x} d={`M${x},-60V-42M${x},60V42`} stroke={c.ink} />
      ))}
      <path d="M-180,60V30H150" stroke={c.muted} strokeDasharray="3 3" />
      <rect x={-196} y={-42} width={372} height={84} rx={6} fill={c.bg} stroke={c.ink} strokeWidth={1.8} />
      <path d="M-180,60V42" stroke={c.ink} />
      {xs.map((x, n) => (
        <g key={n} stroke="none">
          <rect x={x - 6} y={-38} width={12} height={7} rx={1.5} fill={st.plcIn?.[n] ? '#22c55e' : 'none'} stroke={st.plcIn?.[n] ? '#16a34a' : c.muted} strokeWidth={1} />
          <text x={x} y={-20} textAnchor="middle" fontSize={9.5} fill={c.ink}>
            {ins[n]}
          </text>
          <rect x={x - 6} y={31} width={12} height={7} rx={1.5} fill={st.plcOut?.[n] ? '#f59e0b' : 'none'} stroke={st.plcOut?.[n] ? '#d97706' : c.muted} strokeWidth={1} />
          <text x={x} y={25} textAnchor="middle" fontSize={9.5} fill={c.ink}>
            {outs[n]}
          </text>
        </g>
      ))}
      <text x={-180} y={25} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={c.ink} stroke="none">
        C
      </text>
      <text x={-186} y={4} fontSize={13} fontWeight={800} fill={c.accent} stroke="none">
        PLC
      </text>
      <text x={-150} y={4} fontSize={11.5} fontWeight={700} fill={c.ink} stroke="none">
        {[p.tag, p.name].filter(Boolean).join('  ')}
      </text>
    </g>
  );
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
      if (p.sense === 'reed')
        return (
          <>
            <rect x={-26} y={-5} width={5} height={10} fill="#ef4444" stroke="none" />
            <rect x={-21} y={-5} width={5} height={10} fill="#3b82f6" stroke="none" />
          </>
        );
      if (p.sense === 'float')
        return (
          <>
            <path d="M-16,0L-22,4" stroke={c.ink} />
            <circle cx={-25} cy={6} r={4} stroke={c.ink} fill="none" />
          </>
        );
      if (p.sense === 'pressure')
        return (
          <>
            <circle cx={-22} cy={0} r={6} stroke={c.ink} fill="none" />
            <text x={-22} y={3} textAnchor="middle" fontSize={8} fontWeight={700} fill={c.ink} stroke="none">
              P
            </text>
          </>
        );
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
      const spring = st.spring ?? !p.solMinus?.trim();
      return (
        <g>
          <path d="M20,16V40" stroke={TUBE} strokeWidth={1.8} />
          {!spring && <path d="M100,16V40" stroke={TUBE} strokeWidth={1.8} />}
          <rect x={0} y={-16} width={120} height={32} fill={c.bg} stroke={c.ink} />
          {spring && <path d="M100,-12l4,4-8,4 8,4-8,4 8,4-4,4" stroke={c.muted} fill="none" transform={`translate(${(px - 6) * 0.4},0)`} />}
          <rect x={px} y={-14} width={8} height={28} fill={c.ink} stroke="none" />
          <rect x={px + 8} y={-3} width={116} height={6} fill={c.muted} stroke="none" />
          <rect x={rodEnd} y={-8} width={5} height={16} fill={c.ink} stroke="none" />
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
    case 'plc':
      return <PlcGlyph p={p} st={st} c={c} />;
    case 'prox':
      return <ProxGlyph p={p} st={st} c={c} />;
    case 'smps':
      return <SmpsGlyph st={st} c={c} />;
    case 'air':
      return <AirSupplyGlyph c={c} />;
    case 'frl':
      return <FrlGlyph c={c} />;
    case 'fc':
      return <FlowCtrlGlyph c={c} />;
    case 'v32':
    case 'v52':
    case 'v52d':
    case 'v53':
      return <ValveGlyph p={p} st={st} c={c} />;
    case 'r_term':
      return <TermGlyph p={p} />;
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
      return <McbGlyph p={p} st={st} />;
    case 'r_mc':
      return <McGlyph p={p} st={st} />;
    case 'r_thr':
      return <ThrGlyph p={p} st={st} />;
    case 'r_pb':
      return <PbGlyph p={p} st={st} c={c} />;
    case 'r_lamp':
      return <RLampGlyph p={p} st={st} c={c} />;
    case 'r_motor3':
      return <RMotorGlyph p={p} st={st} c={c} />;
    case 'r_relay8':
      return <Relay8Glyph p={p} st={st} c={c} />;
    case 'r_timer8':
      return <Timer8Glyph p={p} st={st} c={c} />;
    case 'r_ss':
      return <SsGlyph p={p} st={st} c={c} />;
    case 'r_estop':
      return <EstopGlyph p={p} st={st} c={c} />;
    case 'r_tb':
      return <TbGlyph p={p} c={c} />;
    case 'r_tsw':
      return <TswGlyph p={p} st={st} c={c} />;
    case 'r_light':
      return <LightGlyph p={p} st={st} c={c} />;
    case 'r_sw':
      return <SwGlyph p={p} st={st} c={c} />;
    case 'r_sw3':
      return <Sw3Glyph p={p} st={st} c={c} />;
    case 'r_load1':
    case 'r_load3':
      return <LoadGlyph p={p} st={st} c={c} />;
    case 'r_panel':
      return <PanelGlyph p={p} c={c} />;
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
  // 실물 기기는 기호를 몸에 직접 적는다
  if (p.type === 'src' || p.type === 'src3' || p.type === 'text' || p.type === 'plc' || p.type === 'air' || REAL.has(p.type)) return null;
  const valve = p.type === 'v32' || p.type === 'v52' || p.type === 'v52d' || p.type === 'v53';
  const X = p.x * G;
  const Y = p.y * G;
  const vertical = p.rot === 0 || p.rot === 180;
  const wide = p.type === 'km3' || p.type === 'mcb3' || p.type === 'ol3' || p.type === 'fuse3' || p.type === 'motor3' || p.type === 'smps';
  // 오른쪽에 선·기호가 붙는 부품은 글자를 더 오른쪽에
  const side = p.type === 'prox' ? 2.6 : p.type === 'fc' || p.type === 'frl' ? 1.7 : 0.9;
  let lines: string[] = [p.tag];
  if (p.name) lines.push(p.name);
  if (p.type === 'timer') lines[0] = `${p.tag} ${formatTime(p.preset ?? 3000, 's').replace(' ', '')}${p.timerMode === 'off' ? ' OFF' : p.timerMode === 'flicker' ? ' FLK' : ''}`;
  if (p.type === 'cyl') lines = [[p.tag, p.name].filter(Boolean).join(' '), ...(!st.air && p.solPlus?.trim() ? [`${p.solPlus}${p.solMinus ? ` / ${p.solMinus}` : ''}`] : [])];
  if (p.type === 'fc') lines.push(`${p.speed ?? 50}%`);
  let lx: number;
  let ly: number;
  let anchor: 'start' | 'middle' = 'start';
  if (p.type === 'cyl') {
    const [x0, y0] = partBox(p);
    lx = x0 * G;
    ly = y0 * G - 8 - (lines.length - 1) * 12;
  } else if (valve && p.rot === 0) {
    lx = X - 3.4 * G;
    ly = Y + 2.5 * G;
  } else if (vertical) {
    lx = X + (wide ? 3 * G - 6 : side * G);
    ly = Y - 4 - (lines.length - 1) * 6;
  } else {
    lx = X;
    ly = Y - (wide ? 3.3 : 1.4) * G - (lines.length - 1) * 12;
    anchor = 'middle';
  }
  const pinLabels = PARTS[p.type].pins.filter((pin) => pin.label).length && !wide && !valve && p.type !== 'prox';
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
    if ((p.type !== 'ls_no' && p.type !== 'ls_nc' && p.type !== 'prox') || !p.cyl) continue;
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
  /** 결선표에서 고른 전선: 그림의 토막과 두 단자 */
  highlight?: { segs: [[number, number], [number, number]][]; pts: [number, number][] } | null;
  /** 전기 해석 결과 (시뮬레이션 중): 부하 · 차단기에 전류를 적는다 */
  power?: PowerState | null;
  /** 전선 위에 적는 전류: a → b 는 글자표를 놓을 수 있는 선 (겹치면 선을 따라 자리를 옮긴다) */
  currents?: { a: [number, number]; b: [number, number]; text: string; bad?: boolean; i: number }[];
  /** 화면을 줄여도 읽히도록 글자표 (전류 · 선번호 · 분전반 이름) 를 키우는 배율 */
  labelScale?: number;
  /** 선번호 (전선 가운데에 적는다) */
  wireNos?: { at: [number, number]; no: number }[];
  /** 따라 배선하기: 배선을 마친 전선만 진하게, 나머지는 흐리게 */
  progress?: { segs: [[number, number], [number, number]][]; color?: WireColor }[] | null;
}

/** 선·점·부품·글자 (편집기와 인쇄 공용) */
export function CircuitLayer({ circuit, model, c, o = {} }: { circuit: Circuit; model: CircuitModel; c: CircuitColors; o?: LayerOptions }) {
  const sim = o.sim ?? null;
  const sensors = cylinderSensors(circuit);
  const wireColor = (id: string) => {
    const n = model.net.wireNet.get(id);
    if (n !== undefined && model.airNets.has(n)) return sim?.airState[n] === 'P' ? TUBE_P : TUBE;
    if (!sim) return null;
    const pole = n === undefined ? null : sim.netPole[n];
    return pole ? POLE_COLOR[pole] ?? c.accent : null;
  };
  const wideWire = (id: string, col: string | null) => {
    if (!col) return 1.8;
    const n = model.net.wireNet.get(id);
    if (n !== undefined && model.airNets.has(n)) return sim?.airState[n] === 'P' ? 3.4 : 2.2;
    return 2.6;
  };
  const ls = Math.max(1, o.labelScale ?? 1);
  // 따라 배선하기: 마친 전선 끝 (단자 좌표 + 나가는 방향)
  const doneEnds = o.progress ? new Set<string>() : null;
  if (o.progress && doneEnds) {
    for (const r of o.progress)
      for (const [a, b] of r.segs) {
        doneEnds.add(`${a[0]},${a[1]}|${Math.sign(b[0] - a[0])},${Math.sign(b[1] - a[1])}`);
        doneEnds.add(`${b[0]},${b[1]}|${Math.sign(a[0] - b[0])},${Math.sign(a[1] - b[1])}`);
      }
  }
  return (
    <g fontFamily={FONT} strokeLinecap="round" strokeLinejoin="round">
      {circuit.parts
        .filter((p) => p.type === 'r_panel')
        .map((p) => (
          <g key={p.id} data-part={p.id} transform={`translate(${p.x * G},${p.y * G})`} fill="none">
            <PanelGlyph p={p} c={c} />
            {o.selected?.has(p.id) && <rect x={-3} y={-3} width={partBox(p)[2] * G - p.x * G + 6} height={partBox(p)[3] * G - p.y * G + 6} rx={12} fill="none" stroke={c.select} strokeWidth={2} strokeDasharray="6 4" />}
          </g>
        ))}
      <g opacity={o.progress ? 0.16 : undefined}>
      {circuit.wires.map((w) => {
        const col = wireColor(w.id);
        const sel = o.selected?.has(w.id);
        const n = model.net.wireNet.get(w.id);
        if (w.cable?.kind === 'bus' && !(n !== undefined && model.airNets.has(n))) {
          // 부스바: 납작한 구리 막대
          const pole = sim && n !== undefined ? sim.netPole[n] : null;
          const L = { x1: w.a[0] * G, y1: w.a[1] * G, x2: w.b[0] * G, y2: w.b[1] * G };
          return (
            <g key={w.id} strokeLinecap="butt">
              {sel && <line {...L} stroke={c.select} strokeWidth={16} opacity={0.5} strokeLinecap="round" />}
              <line {...L} stroke="#7c2d12" strokeWidth={11} strokeLinecap="square" />
              <line {...L} stroke={w.color ? WIRE_HEX[w.color] : '#d97706'} strokeWidth={8.5} strokeLinecap="square" />
              <line {...L} stroke="#ffffff" strokeWidth={1.4} opacity={0.35} />
              {pole && pole !== 'short' && pole !== 'PE' && <line {...L} stroke="#ffffff" strokeWidth={1.8} strokeDasharray="5 5" className="cc-flow" />}
            </g>
          );
        }
        if (w.color && !(n !== undefined && model.airNets.has(n))) {
          const pole = sim && n !== undefined ? sim.netPole[n] : null;
          return (
            <g key={w.id}>
              {sel && <line x1={w.a[0] * G} y1={w.a[1] * G} x2={w.b[0] * G} y2={w.b[1] * G} stroke={c.select} strokeWidth={9} opacity={0.5} />}
              <Cable a={w.a} b={w.b} color={w.color} pole={pole} c={c} />
            </g>
          );
        }
        return (
          <g key={w.id}>
            {sel && <line x1={w.a[0] * G} y1={w.a[1] * G} x2={w.b[0] * G} y2={w.b[1] * G} stroke={c.select} strokeWidth={7} opacity={0.5} />}
            <line x1={w.a[0] * G} y1={w.a[1] * G} x2={w.b[0] * G} y2={w.b[1] * G} stroke={col ?? c.ink} strokeWidth={wideWire(w.id, col)} className={col === POLE_COLOR.short ? 'cc-short' : undefined} />
          </g>
        );
      })}
      {model.net.junctions.map(([x, y]) => (
        <circle key={`j${x},${y}`} cx={x * G} cy={y * G} r={3.4} fill={c.ink} />
      ))}
      </g>
      {o.progress?.map((r, i) =>
        r.segs.map(([a, b], j) =>
          r.color ? <Cable key={`d${i}-${j}`} a={a} b={b} color={r.color} pole={null} c={c} /> : <line key={`d${i}-${j}`} x1={a[0] * G} y1={a[1] * G} x2={b[0] * G} y2={b[1] * G} stroke={c.ink} strokeWidth={1.8} />,
        ),
      )}
      {circuit.parts.map((p) => {
        if (p.type === 'r_panel') return null;
        const st = partState(p, model, sim);
        if (o.power) {
          st.pw = o.power.loads.get(p.id);
          st.amp = o.power.partI.get(p.id);
        }
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
              !REAL.has(p.type) &&
              pinPositions(p).map(([x, y], i) => {
                const n = model.net.pinNet.get(`${p.id}:${i}`)!;
                // PLC·공압 포트는 안 쓰는 단자가 있는 게 정상
                const air = !!PARTS[p.type].pins[i].air;
                const open = p.type !== 'plc' && !air && model.net.pinCount[n] <= 1 && !model.net.hasWire[n];
                if (air) return <rect key={i} x={x * G - 2.5} y={y * G - 2.5} width={5} height={5} fill={c.bg} stroke={TUBE} strokeWidth={1.4} />;
                return <circle key={i} cx={x * G} cy={y * G} r={open ? 3.2 : 2} fill={open ? c.bg : c.ink} stroke={open ? c.danger : 'none'} strokeWidth={1.4} />;
              })}
          </g>
        );
      })}
      <WireEnds circuit={circuit} model={model} sim={sim} c={c} doneEnds={doneEnds} />
      {circuit.parts
        .filter((p) => p.type === 'r_panel')
        .map((p) => (
          // 이름표는 화면을 줄이면 키우되, 분전반 폭을 넘어 옆 분전반과 겹치지 않게
          <g key={`t${p.id}`} transform={`translate(${p.x * G},${p.y * G}) scale(${Math.max(1, Math.min(ls, 1.8, ((partBox(p)[2] - p.x) * G - 12) / panelTitleWidth(p)))})`}>
            <PanelTitle p={p} c={c} />
          </g>
        ))}
      {placeLabels(o.currents ?? [], ls).map((n, i) => {
        const w = n.text.length * 6.4 + 10;
        return (
          <g key={`c${i}`} pointerEvents="none" transform={`translate(${n.at[0] * G},${n.at[1] * G}) scale(${ls})`}>
            <rect x={-w / 2} y={-8} width={w} height={16} rx={8} fill={n.bad ? '#dc2626' : '#0f172a'} opacity={0.92} />
            <text x={0} y={4} textAnchor="middle" fontSize={10.5} fontWeight={800} fill={n.bad ? '#ffffff' : '#a7f3d0'} stroke="none">
              {n.text}
            </text>
          </g>
        );
      })}
      {o.wireNos?.map((n, i) => {
        const t = String(n.no);
        const w = t.length * 6.2 + 8;
        return (
          <g key={`n${i}`} pointerEvents="none" transform={`translate(${n.at[0] * G},${n.at[1] * G}) scale(${ls})`}>
            <rect x={-w / 2} y={-7.5} width={w} height={15} rx={3.5} fill="#ffffff" stroke="#111827" strokeWidth={1} />
            <text x={0} y={3.8} textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#111827" stroke="none">
              {t}
            </text>
          </g>
        );
      })}
      {o.highlight && (
        <g pointerEvents="none">
          {o.highlight.segs.map(([a, b], i) => (
            <line key={i} x1={a[0] * G} y1={a[1] * G} x2={b[0] * G} y2={b[1] * G} stroke="#f59e0b" strokeWidth={12} opacity={0.5} />
          ))}
          {o.highlight.pts.map(([x, y], i) => (
            <circle key={`p${i}`} cx={x * G} cy={y * G} r={13} fill="none" stroke="#f59e0b" strokeWidth={3.5} />
          ))}
        </g>
      )}
    </g>
  );
}

/**
 * 전류 글자표 자리 잡기: 나란한 선 (3상 세 가닥) 의 글자표가 겹치지 않게 선을 따라 어긋나게 놓는다.
 * 허용전류를 넘은 것, 전류가 큰 것부터 자리를 잡고, 놓을 자리가 없으면 뺀다 (마우스를 올리면 보인다).
 */
function placeLabels(items: NonNullable<LayerOptions['currents']>, ls: number): { at: [number, number]; text: string; bad?: boolean }[] {
  const order = [...items].sort((x, y) => Number(!!y.bad) - Number(!!x.bad) || y.i - x.i);
  const placed: { at: [number, number]; text: string; bad?: boolean; w: number; h: number }[] = [];
  for (const it of order) {
    const w = ((it.text.length * 6.4 + 10) * ls) / G;
    const h = (16 * ls) / G;
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const at: [number, number] = [it.a[0] + (it.b[0] - it.a[0]) * f, it.a[1] + (it.b[1] - it.a[1]) * f];
      if (placed.some((q) => Math.abs(q.at[0] - at[0]) < (q.w + w) / 2 + 0.1 && Math.abs(q.at[1] - at[1]) < (q.h + h) / 2 + 0.1)) continue;
      placed.push({ at, text: it.text, bad: it.bad, w, h });
      break;
    }
  }
  return placed;
}

/** 실제 전선 한 토막: 색 + 얇은 테두리, 녹황은 줄무늬, 전압이 닿으면 흰 점선이 흐른다 */
function Cable({ a, b, color, pole, c }: { a: [number, number]; b: [number, number]; color: WireColor; pole: string | null; c: CircuitColors }) {
  const live = !!pole && pole !== 'short' && pole !== 'PE';
  const L = { x1: a[0] * G, y1: a[1] * G, x2: b[0] * G, y2: b[1] * G };
  return (
    <g>
      <line {...L} stroke={c.bg === CIRCUIT_DARK.bg ? '#ffffff55' : '#00000045'} strokeWidth={5.6} />
      <line {...L} stroke={WIRE_HEX[color]} strokeWidth={3.8} />
      {color === 'gy' && <line {...L} stroke="#facc15" strokeWidth={3.8} strokeDasharray="7 7" strokeLinecap="butt" />}
      {live && <line {...L} stroke="#ffffff" strokeWidth={1.6} strokeDasharray="5 5" className="cc-flow" />}
      {pole === 'short' && <line {...L} stroke={POLE_COLOR.short} strokeWidth={2.4} className="cc-short" />}
    </g>
  );
}

/**
 * 실물 기기의 나사에 닿는 전선 끝: 몸통 그림이 선을 덮으므로 끝부분만 위에 다시 그려
 * 전선이 어느 나사로 들어가는지 보이게 한다.
 */
function WireEnds({ circuit, model, sim, c, doneEnds }: { circuit: Circuit; model: CircuitModel; sim: CircuitSim | null; c: CircuitColors; doneEnds?: Set<string> | null }) {
  const real = new Set<string>();
  for (const p of circuit.parts) if (REAL.has(p.type)) pinPositions(p).forEach(([x, y]) => real.add(`${x},${y}`));
  if (!real.size) return null;
  const out: JSX.Element[] = [];
  for (const w of circuit.wires) {
    const n = model.net.wireNet.get(w.id);
    if (n !== undefined && model.airNets.has(n)) continue;
    for (const [end, other] of [
      [w.a, w.b],
      [w.b, w.a],
    ] as const) {
      if (!real.has(`${end[0]},${end[1]}`)) continue;
      const len = Math.abs(other[0] - end[0]) + Math.abs(other[1] - end[1]);
      const s = Math.min(len, 1.6);
      if (s <= 0.5) continue;
      const dx = Math.sign(other[0] - end[0]);
      const dy = Math.sign(other[1] - end[1]);
      const from: [number, number] = [end[0] + dx * s, end[1] + dy * s];
      const to: [number, number] = [end[0] + dx * 0.35, end[1] + dy * 0.35];
      const pole = sim && n !== undefined ? sim.netPole[n] : null;
      const key = `${w.id}:${end[0]},${end[1]}`;
      // 따라 배선하기: 아직 잇지 않은 전선 끝은 흐리게
      const dim = doneEnds && !doneEnds.has(`${end[0]},${end[1]}|${dx},${dy}`) ? 0.16 : undefined;
      if (w.color)
        out.push(
          <g key={key} opacity={dim}>
            <Cable a={from} b={to} color={w.color} pole={pole} c={c} />
          </g>,
        );
      else out.push(<line key={key} x1={from[0] * G} y1={from[1] * G} x2={to[0] * G} y2={to[1] * G} stroke={(pole && POLE_COLOR[pole]) || c.ink} strokeWidth={1.8} opacity={dim} />);
    }
  }
  return <g pointerEvents="none">{out}</g>;
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
export function CircuitSvg({ circuit, width, height, c = CIRCUIT_LIGHT, frame, wireNos }: { circuit: Circuit; width?: number; height?: number; c?: CircuitColors; frame?: boolean; wireNos?: boolean }) {
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
      <CircuitLayer circuit={circuit} model={model} c={c} o={wireNos ? { wireNos: wireNoLabels(wiringList(circuit, model)) } : undefined} />
    </svg>
  );
}
