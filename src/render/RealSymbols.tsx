import type { Part, WireColor } from '../circuit/types';
import { LAMP_HEX } from '../circuit/parts';
import { POLE_WIRE } from '../circuit/wires';
import type { CircuitColors, PartState } from './CircuitSvg';

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
function Screw({ x, y, ring = 'orange' }: { x: number; y: number; ring?: 'orange' | 'green' | 'yellow' }) {
  const fill = ring === 'green' ? '#86efac' : ring === 'yellow' ? '#fde047' : '#fdba74';
  const edge = ring === 'green' ? '#15803d' : ring === 'yellow' ? '#a16207' : '#c2410c';
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
      <Label x={-40} y={-136} text="A1" size={9} />
      <Label x={40} y={142} text="A2" size={9} />
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
      <rect x={-40} y={-36} width={80} height={92} rx={5} fill="#111827" />
      <rect x={-4} y={-36} width={8} height={30} fill="#16a34a" opacity={st.act ? 1 : 0.6} />
      <Label x={0} y={24} text="Momentary" fill="#9ca3af" size={7.5} weight={500} />
      <Label x={-20} y={-12} text="11" fill="#f9fafb" size={7.5} />
      <Label x={20} y={-12} text="12" fill="#f9fafb" size={7.5} />
      <Label x={-20} y={54} text="23" fill="#f9fafb" size={7.5} />
      <Label x={20} y={54} text="24" fill="#f9fafb" size={7.5} />
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
      <rect x={-32} y={-8} width={64} height={42} rx={4} fill="#111827" />
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
