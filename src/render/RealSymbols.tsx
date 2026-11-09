import type { Part, WireColor } from '../circuit/types';
import { LAMP_HEX, tbSize } from '../circuit/parts';
import { formatTime } from '../model/format';
import { POLE_WIRE } from '../circuit/wires';
import type { CircuitColors, PartState } from './CircuitSvg';
import { tr } from '../i18n';

/** 실제 전선 색 */
export const WIRE_HEX: Record<WireColor, string> = {
  brown: '#8b4513',
  black: '#1f2937',
  grey: '#9ca3af',
  blue: '#1d4ed8',
  gy: '#16a34a',
  red: '#dc2626',
  yellow: '#eab308',
  white: '#f8fafc',
  orange: '#f97316',
};


const BODY = '#e5e7eb';
const BODY_EDGE = '#9ca3af';
const BAND = '#f3f4f6';

/** 나사 단자 (주황 링 + 회색 나사) */
type Ring = 'orange' | 'green' | 'yellow' | 'grey';

function Screw({ x, y, ring = 'orange' }: { x: number; y: number; ring?: Ring }) {
  const fill = ring === 'green' ? '#86efac' : ring === 'yellow' ? '#fde047' : ring === 'grey' ? '#e5e7eb' : '#fdba74';
  const edge = ring === 'green' ? '#15803d' : ring === 'yellow' ? '#a16207' : ring === 'grey' ? '#6b7280' : '#c2410c';
  return (
    <g>
      <circle cx={x} cy={y} r={8} fill={fill} stroke={edge} strokeWidth={1.6} />
      <circle cx={x} cy={y} r={4} fill="#d1d5db" stroke="#6b7280" strokeWidth={1} />
      <path d={`M${x - 3},${y}h6`} stroke="#4b5563" strokeWidth={1.2} />
    </g>
  );
}

function Label({ x, y, text, fill = '#374151', size = 9, anchor = 'middle', weight = 600 }: { x: number; y: number; text: string; fill?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill} stroke="none">
      {text}
    </text>
  );
}

/** 전원 단자 기둥 (빨간 링, 가운데 극 색) */
export function TermGlyph({ p }: { p: Part }) {
  const pole = p.pole ?? 'L1';
  const id = pole === 'L' ? 'L1' : pole;
  const col = WIRE_HEX[POLE_WIRE[id] ?? 'grey'];
  const pe = id === 'PE';
  return (
    <g>
      <circle r={11} fill={pe ? '#15803d' : '#b91c1c'} />
      <circle r={8} fill="#fef2f2" />
      <circle r={5} fill={col} />
      {pe && <path d="M-5,0h10" stroke="#facc15" strokeWidth={2} />}
      <Label x={0} y={-17} text={pole} fill={pe ? '#15803d' : '#b91c1c'} size={14} weight={800} />
    </g>
  );
}

/** 차단기 1P·2P·3P: 위 단자(전원), 파란 레버(위 = ON), 아래 단자(부하) */
export function McbGlyph({ p, st }: { p: Part; st: PartState }) {
  const n = p.type === 'r_mcb3' ? 3 : p.type === 'r_mcb2' ? 2 : 1;
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 40);
  const half = n * 20 + 6;
  const on = st.act;
  return (
    <g>
      <rect x={-half} y={-100} width={half * 2} height={200} rx={4} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-half} y={-100} width={half * 2} height={42} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-half} y={58} width={half * 2} height={42} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <Label x={0} y={-46} text={p.spec?.trim() || 'AC/25A'} size={8.5} />
      {xs.map((x) => (
        <g key={x}>
          <rect x={x - 4} y={-40} width={8} height={7} fill={on ? '#16a34a' : '#dc2626'} />
          <rect x={x - 13} y={-28} width={26} height={60} rx={3} fill="#cbd5e1" stroke="#94a3b8" />
          <rect x={x - 11} y={on ? -26 : 4} width={22} height={26} rx={3} fill="#2563eb" stroke="#1e40af" />
          <rect x={x - 3} y={on ? -6 : 22} width={6} height={4} fill="#1e3a8a" />
        </g>
      ))}
      {n > 1 && <rect x={xs[0] - 11} y={on ? -16 : 12} width={xs[n - 1] - xs[0] + 22} height={6} fill="#1d4ed8" opacity={0.85} />}
      <Label x={0} y={50} text={p.tag} size={10} weight={800} />
      {xs.map((x) => (
        <g key={`t${x}`}>
          <Screw x={x} y={-80} />
          <Screw x={x} y={80} />
        </g>
      ))}
    </g>
  );
}

/** 전자접촉기: A1(위)·A2(아래) 코일, 주접점 1/L1 3/L2 5/L3 → 2/T1 4/T2 6/T3, 보조 13-14 NO · 21-22 NC */
export function McGlyph({ p, st }: { p: Part; st: PartState }) {
  const on = st.on;
  const top = ['1/L1', '3/L2', '5/L3', '13NO', '21NC'];
  const bot = ['2/T1', '4/T2', '6/T3', '14NO', '22NC'];
  const xs = [-60, -20, 20, 60, 100];
  const ring = (i: number): 'orange' | 'green' | 'yellow' => (i === 3 ? 'green' : i === 4 ? 'yellow' : 'orange');
  return (
    <g>
      <rect x={-52} y={-130} width={24} height={26} rx={3} fill={BAND} stroke={BODY_EDGE} />
      <rect x={28} y={104} width={24} height={26} rx={3} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-80} y={-104} width={200} height={208} rx={5} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-80} y={-104} width={200} height={42} rx={5} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-80} y={62} width={200} height={42} rx={5} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-72} y={-58} width={184} height={116} rx={4} fill="#111827" />
      <rect x={-58} y={-34} width={156} height={30} rx={3} fill="#0ea5e9" opacity={on ? 0.95 : 0.7} />
      <rect x={-10} y={on ? -26 : -40} width={36} height={22} rx={2} fill={on ? '#1e3a8a' : '#334155'} stroke="#0f172a" />
      {[-40, 60].map((x) => (
        <rect key={x} x={x} y={-30} width={22} height={22} rx={2} fill={on ? '#1d4ed8' : '#0369a1'} opacity={0.9} />
      ))}
      <rect x={-30} y={8} width={92} height={22} rx={3} fill="#030712" stroke="#4b5563" />
      <Label x={16} y={23} text={p.spec?.trim() || 'AC/220V'} fill="#f9fafb" size={10} weight={700} />
      <Label x={16} y={48} text={p.tag} fill={on ? '#7dd3fc' : '#e5e7eb'} size={11} weight={800} />
      {on && <circle cx={100} cy={-44} r={4} fill="#22c55e" />}
      <Label x={-40} y={-94} text="A1" size={8.5} weight={800} />
      <Label x={40} y={101} text="A2" size={8.5} weight={800} />
      {xs.map((x, i) => (
        <g key={x}>
          <Screw x={x} y={-80} ring={ring(i)} />
          <Label x={x} y={-64} text={top[i]} size={7.5} />
          <Screw x={x} y={80} ring={ring(i)} />
          <Label x={x} y={70} text={bot[i]} size={7.5} />
        </g>
      ))}
      <Screw x={-40} y={-120} />
      <Screw x={40} y={120} />
    </g>
  );
}

/** 열동형 과부하 계전기: 주회로 3극, 95-96 b · 97-98 a, 트립 표시와 복귀 버튼 */
export function ThrGlyph({ p, st }: { p: Part; st: PartState }) {
  const trip = st.act;
  return (
    <g>
      <rect x={-60} y={-72} width={200} height={144} rx={5} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-52} y={-30} width={184} height={60} rx={4} fill="#1f2937" />
      <rect x={-40} y={-18} width={30} height={14} rx={2} fill={trip ? '#ef4444' : '#16a34a'} />
      <Label x={-25} y={10} text={trip ? 'TRIP' : 'OK'} fill="#f9fafb" size={8} weight={800} />
      <circle cx={20} cy={-4} r={11} fill="#2563eb" stroke="#1e3a8a" />
      <Label x={20} y={-1} text="R" fill="#fff" size={9} weight={800} />
      <Label x={90} y={0} text={p.tag || 'THR'} fill="#e5e7eb" size={11} weight={800} />
      <Label x={90} y={16} text="95-96 · 97-98" fill="#9ca3af" size={7.5} />
      {[
        [-40, '1/L1', '2/T1', 'orange'],
        [0, '3/L2', '4/T2', 'orange'],
        [40, '5/L3', '6/T3', 'orange'],
        [80, '95', '96', 'yellow'],
        [120, '97', '98', 'green'],
      ].map(([x, a, b, r]) => (
        <g key={x as number}>
          <Screw x={x as number} y={-60} ring={r as 'orange'} />
          <Label x={x as number} y={-40} text={a as string} size={7.5} />
          <Screw x={x as number} y={60} ring={r as 'orange'} />
          <Label x={x as number} y={46} text={b as string} size={7.5} />
        </g>
      ))}
    </g>
  );
}

/** 푸시버튼 유닛: 버섯 머리, 11-12 b접점(노랑), 23-24 a접점(초록) */
export function PbGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const col = LAMP_HEX[p.color ?? 'green'];
  const dy = st.act ? 7 : 0;
  return (
    <g>
      <g transform={`translate(0,${dy})`}>
        <path d="M-28,-60Q-28,-80 0,-80Q28,-80 28,-60L28,-56H-28Z" fill={col} stroke="#00000055" />
        <ellipse cx={-8} cy={-70} rx={9} ry={3} fill="#ffffff" opacity={0.45} />
      </g>
      <rect x={-17} y={-56} width={34} height={20} rx={3} fill="#d1d5db" stroke="#9ca3af" />
      <rect x={-40} y={-36} width={80} height={92} rx={5} fill="#111827" stroke="#6b7280" />
      <rect x={-4} y={-36} width={8} height={30} fill="#16a34a" opacity={st.act ? 1 : 0.6} />
      <Label x={0} y={19} text="Momentary" fill="#9ca3af" size={7} weight={500} />
      <Label x={-20} y={-12} text="11" fill="#f9fafb" size={7.5} />
      <Label x={20} y={-12} text="12" fill="#f9fafb" size={7.5} />
      <Label x={-20} y={29} text="23" fill="#f9fafb" size={7.5} />
      <Label x={20} y={29} text="24" fill="#f9fafb" size={7.5} />
      <Screw x={-20} y={0} ring="yellow" />
      <Screw x={20} y={0} ring="yellow" />
      <Screw x={-20} y={40} ring="green" />
      <Screw x={20} y={40} ring="green" />
      <Label x={34} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={34} y={-53} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 파일럿 램프: 색 렌즈, X1 · X2 */
export function RLampGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const col = LAMP_HEX[p.color ?? 'red'];
  return (
    <g>
      {st.on && <circle cy={-30} r={30} fill={col} opacity={0.35} />}
      <circle cy={-30} r={22} fill="#d1d5db" stroke="#9ca3af" />
      <circle cy={-30} r={16} fill={col} opacity={st.on ? 1 : 0.35} stroke="#00000033" />
      <ellipse cx={-5} cy={-37} rx={6} ry={3} fill="#fff" opacity={0.5} />
      <rect x={-32} y={-8} width={64} height={42} rx={4} fill="#111827" stroke="#6b7280" />
      <Label x={-20} y={8} text="X1" fill="#f9fafb" size={7.5} />
      <Label x={20} y={8} text="X2" fill="#f9fafb" size={7.5} />
      <Screw x={-20} y={20} />
      <Screw x={20} y={20} />
      <Label x={28} y={-50} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={28} y={-37} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 3상 전동기: U V W 단자함, PE, 몸통과 팬 (돌 때 팬이 회전) */
export function RMotorGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const spin = st.dir !== 0;
  return (
    <g>
      <rect x={-100} y={72} width={130} height={14} rx={3} fill="#4b5563" />
      <rect x={-112} y={6} width={152} height={68} rx={18} fill="#9ca3af" stroke="#6b7280" />
      {[-90, -74, -58, -42, -26, -10, 6, 22].map((x) => (
        <path key={x} d={`M${x},12V68`} stroke="#6b7280" strokeWidth={2} />
      ))}
      <rect x={-126} y={36} width={16} height={8} fill="#6b7280" />
      <g transform="translate(-126,40)">
        <g className={spin ? `cc-spin ${st.dir < 0 ? 'rev' : ''}` : undefined}>
          <path d="M0,0C-6,-26 10,-34 14,-30C10,-18 6,-8 0,0Z" fill="#facc15" stroke="#ca8a04" />
          <path d="M0,0C-6,-26 10,-34 14,-30C10,-18 6,-8 0,0Z" fill="#fbbf24" stroke="#ca8a04" transform="rotate(120)" />
          <path d="M0,0C-6,-26 10,-34 14,-30C10,-18 6,-8 0,0Z" fill="#facc15" stroke="#ca8a04" transform="rotate(240)" />
          <circle r={5} fill="#6b7280" />
        </g>
      </g>
      <rect x={-60} y={-44} width={124} height={52} rx={4} fill="#111827" />
      <Label x={2} y={-22} text={p.tag ? `${p.tag}  3상 Motor` : '3상 Motor'} fill="#f9fafb" size={9.5} weight={700} />
      <Label x={2} y={-6} text={p.spec?.trim() || 'AC/380V'} fill="#d1d5db" size={9} />
      {spin && <Label x={52} y={52} text={st.dir > 0 ? 'FWD' : 'REV'} fill={c.accent} size={10} weight={800} />}
      {[
        [-40, 'U'],
        [0, 'V'],
        [40, 'W'],
      ].map(([x, l]) => (
        <g key={l as string}>
          <path d={`M${x},-52V-44`} stroke="#6b7280" strokeWidth={4} />
          <Screw x={x as number} y={-60} />
          <Label x={(x as number) + 12} y={-48} text={l as string} anchor="start" size={9} weight={800} />
        </g>
      ))}
      <path d="M64,20H72" stroke="#16a34a" strokeWidth={3} />
      <Screw x={80} y={20} ring="green" />
      <Label x={80} y={5} text="PE" fill="#15803d" size={10} weight={800} />
    </g>
  );
}

/** 8핀 소켓: 위 1 2 3 4, 아래 8 7 6 5 (번호마다 나사) */
const OCT_TOP = ['1', '2', '3', '4'];
const OCT_BOT = ['8', '7', '6', '5'];
const OCT_X = [-60, -20, 20, 60];

function OctalSocket({ children }: { children: React.ReactNode }) {
  return (
    <g>
      <rect x={-86} y={-90} width={172} height={180} rx={6} fill="#4b5563" stroke="#1f2937" />
      <rect x={-80} y={-84} width={160} height={30} rx={3} fill="#6b7280" />
      <rect x={-80} y={54} width={160} height={30} rx={3} fill="#6b7280" />
      {children}
      {OCT_X.map((x, i) => (
        <g key={x}>
          <Screw x={x} y={-60} ring="grey" />
          <Label x={x + 11} y={-66} text={OCT_TOP[i]} anchor="start" fill="#fde047" size={11} weight={800} />
          <Screw x={x} y={60} ring="grey" />
          <Label x={x + 11} y={74} text={OCT_BOT[i]} anchor="start" fill="#fde047" size={11} weight={800} />
        </g>
      ))}
    </g>
  );
}

/** 전환 접점 한 벌 (공통 → a · b), 동작하면 날이 a 쪽으로 */
function Changeover({ y, com, no, nc, on, timed, inst }: { y: number; com: string; no: string; nc: string; on: boolean; timed?: boolean; inst?: boolean }) {
  const ink = '#111827';
  const hot = '#2563eb';
  return (
    <g>
      <circle cx={-2} cy={y} r={2.6} fill={ink} />
      <Label x={-8} y={y + 3.5} text={com} anchor="end" fill={ink} size={9} weight={800} />
      <path d={`M30,${y - 9}h10M30,${y + 9}h10`} stroke={ink} strokeWidth={1.6} />
      <Label x={44} y={y - 6} text={`${nc} b`} anchor="start" fill={ink} size={8.5} weight={700} />
      <Label x={44} y={y + 12} text={`${no} a`} anchor="start" fill={ink} size={8.5} weight={700} />
      <path d={`M-2,${y}L30,${on ? y + 9 : y - 9}`} stroke={on ? hot : ink} strokeWidth={2.2} />
      {timed && <path d={`M10,${y - 13}a5,5 0 0 1 10,0`} stroke={ink} strokeWidth={1.3} fill="none" />}
      {inst && <Label x={15} y={y - 11} text={tr('순시', 'inst')} fill="#6b7280" size={7} weight={600} />}
    </g>
  );
}

/** 8핀 릴레이 + 소켓: 덮개에 내부 결선도 (2-7 코일, 1-3 a · 1-4 b, 8-6 a · 8-5 b) */
export function Relay8Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const on = st.act;
  return (
    <OctalSocket>
      <rect x={-70} y={-46} width={140} height={92} rx={8} fill="#e0f2fe" stroke="#7dd3fc" strokeWidth={1.4} opacity={0.97} />
      <rect x={-62} y={-14} width={26} height={28} rx={2} fill={st.on ? '#f59e0b' : '#f8fafc'} stroke="#111827" strokeWidth={1.6} />
      <path d="M-49,-14V-30M-49,14V30" stroke="#111827" strokeWidth={1.4} />
      <Label x={-49} y={-33} text="2" fill="#111827" size={9} weight={800} />
      <Label x={-49} y={40} text="7" fill="#111827" size={9} weight={800} />
      <Label x={-26} y={-34} text={tr('코일', 'coil')} anchor="start" fill="#475569" size={7.5} weight={600} />
      <Changeover y={-18} com="1" no="3" nc="4" on={on} />
      <Changeover y={22} com="8" no="6" nc="5" on={on} />
      {st.on && <circle cx={60} cy={-36} r={3.5} fill="#ef4444" />}
      <Label x={94} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={94} y={-53} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      <Label x={94} y={-40} text={p.spec?.trim() || 'AC 220V'} anchor="start" size={8.5} weight={500} fill={c.muted} />
    </OctalSocket>
  );
}

/** 8핀 타이머 + 소켓: 설정 다이얼, 전원·출력 램프, 2-7 전원, 8-6 · 8-5 한시, 1-3 · 1-4 한시 또는 순시 */
export function Timer8Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const preset = p.preset ?? 3000;
  const t = st.timer;
  const coil = t ? t.coil : false;
  const out = t ? t.out : false;
  // 다이얼 눈금: 설정 시간이 들어가는 가장 작은 범위 (실제 타이머의 레인지 선택처럼)
  const range = [1, 3, 6, 10, 30, 60, 180, 600, 1800, 3600].find((r) => r * 1000 >= preset) ?? Math.ceil(preset / 1000);
  const set = Math.min(1, preset / (range * 1000));
  const frac = t && t.elapsed !== null ? Math.min(set, t.elapsed / (range * 1000)) : 0;
  const ang = (f: number) => {
    const a = ((-135 + 270 * f) * Math.PI) / 180;
    return [-40 + 15 * Math.sin(a), -2 - 15 * Math.cos(a)];
  };
  const [ex, ey] = ang(frac);
  const [sx, sy] = ang(0);
  const mode = p.timerMode === 'off' ? 'OFF DLY' : p.timerMode === 'flicker' ? 'FLICKER' : 'ON DLY';
  return (
    <OctalSocket>
      <rect x={-70} y={-46} width={140} height={92} rx={8} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1.4} />
      <circle cx={-40} cy={-2} r={19} fill="#ffffff" stroke="#334155" strokeWidth={1.4} />
      {frac > 0 && <path d={`M${sx},${sy}A15,15 0 ${frac > 2 / 3 ? 1 : 0} 1 ${ex},${ey}`} stroke="#f59e0b" strokeWidth={4} fill="none" />}
      <path d={`M-40,-2L${ang(set).join(',')}`} stroke="#dc2626" strokeWidth={2.4} />
      <Label x={-56} y={20} text="0" fill="#64748b" size={6.5} />
      <Label x={-24} y={20} text={`${range}s`} fill="#64748b" size={6.5} />
      <circle cx={-40} cy={-2} r={3} fill="#334155" />
      <Label x={-40} y={30} text={formatTime(preset, 's')} fill="#111827" size={9} weight={800} />
      <Label x={-40} y={40} text={mode} fill="#64748b" size={7} weight={700} />
      <circle cx={-60} cy={-36} r={3.5} fill={coil ? '#22c55e' : '#cbd5e1'} />
      <Label x={-54} y={-33} text="PW" anchor="start" fill="#475569" size={7} weight={700} />
      <circle cx={-30} cy={-36} r={3.5} fill={out ? '#ef4444' : '#cbd5e1'} />
      <Label x={-24} y={-33} text="UP" anchor="start" fill="#475569" size={7} weight={700} />
      <Label x={20} y={-33} text={tr('전원 2-7', 'power 2-7')} anchor="middle" fill="#475569" size={7.5} weight={700} />
      <Changeover y={-12} com="1" no="3" nc="4" on={p.inst13 ? coil : out} timed={!p.inst13} inst={p.inst13} />
      <Changeover y={24} com="8" no="6" nc="5" on={out} timed />
      <Label x={94} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={94} y={-53} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      {t && t.elapsed !== null && <Label x={94} y={-40} text={`${(t.elapsed / 1000).toFixed(1)} / ${(preset / 1000).toFixed(1)}s`} anchor="start" size={10} weight={800} fill={c.accent} />}
    </OctalSocket>
  );
}

/** 접점 블록 두 개 (11-12 b 노랑, 23-24 a 초록) */
function ContactBlocks({ act }: { act: boolean }) {
  return (
    <g>
      <rect x={-40} y={-36} width={80} height={92} rx={5} fill="#111827" stroke="#6b7280" />
      <rect x={-4} y={-36} width={8} height={30} fill="#16a34a" opacity={act ? 1 : 0.6} />
      <Label x={-20} y={-12} text="11" fill="#f9fafb" size={7.5} />
      <Label x={20} y={-12} text="12" fill="#f9fafb" size={7.5} />
      <Label x={-20} y={29} text="23" fill="#f9fafb" size={7.5} />
      <Label x={20} y={29} text="24" fill="#f9fafb" size={7.5} />
      <Label x={0} y={18} text={act ? '11-12 OFF · 23-24 ON' : '11-12 ON · 23-24 OFF'} fill={act ? '#4ade80' : '#9ca3af'} size={6.5} weight={600} />
      <Screw x={-20} y={0} ring="yellow" />
      <Screw x={20} y={0} ring="yellow" />
      <Screw x={-20} y={40} ring="green" />
      <Screw x={20} y={40} ring="green" />
    </g>
  );
}

/** 셀렉터 스위치 (2단): 검은 손잡이, 왼쪽 0 · 오른쪽 1 */
export function SsGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const a = st.act ? 40 : -40;
  return (
    <g>
      <rect x={-17} y={-56} width={34} height={20} rx={3} fill="#d1d5db" stroke="#9ca3af" />
      <circle cy={-62} r={26} fill="#1f2937" stroke="#000" />
      <g transform={`rotate(${a},0,-62)`}>
        <rect x={-6} y={-84} width={12} height={44} rx={5} fill="#4b5563" stroke="#111827" />
        <path d="M0,-82V-74" stroke="#f9fafb" strokeWidth={2.4} />
      </g>
      <Label x={-30} y={-84} text="0" fill={c.ink} size={10} weight={800} />
      <Label x={30} y={-84} text="1" fill={c.ink} size={10} weight={800} />
      <ContactBlocks act={st.act} />
      <Label x={44} y={-70} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={44} y={-57} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 비상정지: 노란 판 + 빨간 버섯 머리, 누르면 잠기고 다시 누르면(돌리면) 풀림 */
export function EstopGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const dy = st.act ? 6 : 0;
  return (
    <g>
      <circle cy={-48} r={40} fill="#facc15" stroke="#a16207" />
      <text y={-14} textAnchor="middle" fontSize={7} fontWeight={800} fill="#7c2d12" stroke="none">
        EMERGENCY STOP
      </text>
      <rect x={-12} y={-60} width={24} height={20} fill="#9ca3af" />
      <g transform={`translate(0,${dy})`}>
        <path d="M-32,-62Q-32,-88 0,-88Q32,-88 32,-62L32,-58H-32Z" fill="#dc2626" stroke="#7f1d1d" />
        <ellipse cx={-10} cy={-78} rx={10} ry={3.5} fill="#ffffff" opacity={0.4} />
        <path d="M-14,-68a14,6 0 0 0 28,0" stroke="#7f1d1d" strokeWidth={1.4} fill="none" />
      </g>
      {st.act && <Label x={0} y={-94} text="LOCK" fill="#dc2626" size={9} weight={800} />}
      <ContactBlocks act={st.act} />
      <Label x={44} y={-76} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={44} y={-63} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 단자대: 극마다 위·아래 나사, 가운데 번호 */
export function TbGlyph({ p, c }: { p: Part; c: CircuitColors }) {
  const n = tbSize(p);
  return (
    <g>
      <rect x={-22} y={-52} width={(n - 1) * 40 + 44} height={104} rx={3} fill="#9ca3af" />
      {Array.from({ length: n }, (_, k) => {
        const x = k * 40;
        return (
          <g key={k}>
            <rect x={x - 18} y={-50} width={36} height={100} rx={2} fill="#e7e5e4" stroke="#78716c" />
            <rect x={x - 12} y={-8} width={24} height={16} rx={2} fill="#ffffff" stroke="#a8a29e" />
            <Label x={x} y={4} text={String(k + 1)} fill="#111827" size={10} weight={800} />
            <Screw x={x} y={-40} ring="grey" />
            <Screw x={x} y={40} ring="grey" />
          </g>
        );
      })}
      <Label x={-28} y={-2} text={p.tag} anchor="end" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={-28} y={11} text={p.name} anchor="end" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}
