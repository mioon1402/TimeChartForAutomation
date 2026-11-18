import type { Part, WireColor } from '../circuit/types';
import { BUS_PHASES, busSize, counterPreset, hmiCells, LAMP_HEX, plcAddresses, solAc, MY_COLS, OCTAL_ROWS, octalLayout, panelSize, pos3Labels, schedOn, stripSize, tbSize, tempSetting, timerText, tswSched } from '../circuit/parts';
import { loadRating } from '../circuit/power';
import { formatClock } from '../model/format';
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
  const n = p.type === 'r_mcb4' ? 4 : p.type === 'r_mcb3' ? 3 : p.type === 'r_mcb2' ? 2 : 1;
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 40);
  const half = n * 20 + 6;
  const on = st.act;
  return (
    <g>
      <rect x={-half} y={-100} width={half * 2} height={200} rx={4} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-half} y={-100} width={half * 2} height={42} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-half} y={58} width={half * 2} height={42} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <Label x={0} y={-46} text={`${p.amps ? `AC/${p.amps}A` : p.spec?.trim() || 'AC/25A'}${p.elb ? ' ELB' : ''}`} size={8.5} fill={p.elb ? '#b91c1c' : '#374151'} />
      {p.elb && (
        <g>
          <rect x={half - 16} y={38} width={10} height={10} rx={2} fill="#facc15" stroke="#a16207" />
          <Label x={half - 11} y={56} text="T" size={6.5} />
        </g>
      )}
      {st.amp !== undefined && st.amp > 0.05 && (
        <Label x={half + 5} y={4} text={`${st.amp.toFixed(1)} A`} anchor="start" size={10.5} weight={800} fill={p.amps && st.amp > p.amps ? '#dc2626' : '#2563eb'} />
      )}
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
      {xs.map((x, i) => (
        <g key={`t${x}`}>
          <Screw x={x} y={-80} />
          <Screw x={x} y={80} />
          <Label x={x} y={-63} text={n === 4 && i === 3 ? 'N' : String(2 * i + 1)} size={7.5} weight={800} fill="#475569" />
          <Label x={x} y={70} text={n === 4 && i === 3 ? 'N' : String(2 * i + 2)} size={7.5} weight={800} fill="#475569" />
        </g>
      ))}
    </g>
  );
}

const BUS_SLEEVE = ['#8b4513', '#1f2937', '#9ca3af', '#1d4ed8'];

/** 부스바: 세로 구리 막대 (위에 상 표시 슬리브), 전압이 닿으면 흰 점선이 흐른다. 분기선은 막대 위로 지나가고 볼트 점에서만 이어진다 */
export function BusGlyph({ p, live, c }: { p: Part; live: boolean[]; c: CircuitColors }) {
  const { bars, len } = busSize(p);
  const h = len * 20;
  return (
    <g>
      <rect x={-12} y={-6} width={(bars - 1) * 40 + 24} height={h + 12} rx={4} fill={c.ink} fillOpacity={0.06} stroke="none" />
      {Array.from({ length: bars }, (_, k) => {
        const x = k * 40;
        return (
          <g key={k}>
            <rect x={x - 5} y={0} width={10} height={h} rx={2} fill="#b45309" stroke="#78350f" strokeWidth={1} />
            <path d={`M${x - 2},2V${h - 2}`} stroke="#fbbf24" strokeWidth={1.4} opacity={0.6} />
            <rect x={x - 5} y={6} width={10} height={12} fill={BUS_SLEEVE[k]} stroke="#00000055" strokeWidth={0.6} />
            {live[k] && <path d={`M${x},20V${h - 2}`} stroke="#ffffff" strokeWidth={1.6} strokeDasharray="5 5" className="cc-flow" />}
            <Label x={x} y={-10} text={BUS_PHASES[k]} size={8.5} weight={800} fill={c.ink} />
          </g>
        );
      })}
      {/* 이름표는 막대 아래 (위쪽은 메인 차단기가 붙는 자리, 바로 아래는 길이 손잡이) */}
      <Label x={(bars - 1) * 20} y={h + 34} text={[p.tag, p.amps ? `${p.amps}A` : '', `${p.mm2 ?? 100}mm²`].filter(Boolean).join(' · ')} size={10} weight={800} fill={c.ink} />
      {p.name && <Label x={(bars - 1) * 20} y={h + 46} text={p.name} size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 한전 수전점: 특고압 인입 (전주 · 인입선), 아래 단자 A B C */
export function KepcoGlyph({ p, c }: { p: Part; c: CircuitColors }) {
  return (
    <g>
      <rect x={-70} y={-82} width={140} height={86} rx={6} fill="#fef3c7" stroke="#b45309" strokeWidth={1.4} />
      {/* 전주와 완금, 애자 */}
      <path d="M-50,-70V-14M-62,-60H-38" stroke="#57534e" strokeWidth={3} />
      {[-60, -50, -40].map((x) => (
        <circle key={x} cx={x} cy={-64} r={2.4} fill="#e7e5e4" stroke="#57534e" />
      ))}
      <path d="M-24,-60l-8,16h8l-6,14" fill="none" stroke="#dc2626" strokeWidth={2.2} strokeLinejoin="round" />
      <Label x={20} y={-52} text={p.name?.trim() || tr('한전 수전', 'Utility')} size={10} weight={800} fill="#78350f" />
      <Label x={20} y={-36} text={`${p.kv ?? 22.9} kV · 3φ`} size={9} weight={700} fill="#92400e" />
      <Label x={20} y={-21} text={`Isc ${p.ka ?? 12.5} kA`} size={8.5} weight={600} fill="#92400e" />
      <Label x={-66} y={-88} text={p.tag} anchor="start" size={9.5} weight={800} fill={c.ink} />
      {[-40, 0, 40].map((x, i) => (
        <g key={x}>
          <path d={`M${x},4V56`} stroke="#57534e" strokeWidth={2.4} />
          <rect x={x - 5} y={12} width={10} height={16} rx={2} fill="#d6d3d1" stroke="#78716c" />
          <Label x={x + 10} y={44} text={'ABC'[i]} anchor="start" size={8} weight={800} fill="#78350f" />
        </g>
      ))}
    </g>
  );
}

/** 진공차단기 VCB: 위 1 3 5 (전원), 아래 2 4 6. 투입 = 빨간 표시, 개방 = 초록 표시 (수배전반 관례) */
export function VcbGlyph({ p, st }: { p: Part; st: PartState }) {
  const on = st.act;
  return (
    <g>
      <rect x={-64} y={-100} width={128} height={200} rx={5} fill="#cbd5e1" stroke="#64748b" />
      <rect x={-56} y={-56} width={112} height={112} rx={4} fill="#1e293b" />
      {[-40, 0, 40].map((x) => (
        <rect key={x} x={x - 9} y={-46} width={18} height={60} rx={3} fill="#475569" stroke="#94a3b8" />
      ))}
      <rect x={-34} y={22} width={68} height={22} rx={3} fill={on ? '#dc2626' : '#16a34a'} />
      <Label x={0} y={37} text={on ? tr('투입 ON', 'CLOSED') : tr('개방 OFF', 'OPEN')} size={9} weight={800} fill="#ffffff" />
      <Label x={0} y={-66} text={`VCB ${p.amps ? `${p.amps}A` : ''}${p.ka ? ` ${p.ka}kA` : ''}`} size={8.5} weight={800} fill="#1e293b" />
      <Label x={0} y={72} text={p.tag} size={10} weight={800} fill="#1e293b" />
      {st.amp !== undefined && st.amp > 0.005 && <Label x={70} y={4} text={`${st.amp.toFixed(2)} A`} anchor="start" size={10.5} weight={800} fill={p.amps && st.amp > p.amps ? '#dc2626' : '#2563eb'} />}
      {[-40, 0, 40].map((x, i) => (
        <g key={`t${x}`}>
          <Screw x={x} y={-80} />
          <Screw x={x} y={80} />
          <Label x={x + 12} y={-86} text={String(2 * i + 1)} anchor="start" size={7.5} weight={800} fill="#475569" />
          <Label x={x + 12} y={92} text={String(2 * i + 2)} anchor="start" size={7.5} weight={800} fill="#475569" />
        </g>
      ))}
    </g>
  );
}

/** 3상 변압기 (Δ-Y): 위 특고압 부싱 H1 H2 H3, 아래 저압 부싱 X1 X2 X3 X0 (중성점) */
export function TrGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const live = !!st.powered;
  return (
    <g>
      {/* 방열판 */}
      {[-92, 80].map((x) => (
        <g key={x}>
          {[0, 1, 2].map((k) => (
            <rect key={k} x={x + k * 4} y={-56} width={2.5} height={112} fill="#94a3b8" />
          ))}
        </g>
      ))}
      <rect x={-78} y={-76} width={156} height={152} rx={8} fill="#e2e8f0" stroke="#64748b" strokeWidth={1.4} />
      {/* 특고압 부싱 (길다) · 저압 부싱 */}
      {[-40, 0, 40].map((x) => (
        <g key={`h${x}`}>
          <path d={`M${x},-76V-100`} stroke="#57534e" strokeWidth={2.4} />
          {[-82, -88, -94].map((y) => (
            <ellipse key={y} cx={x} cy={y} rx={6} ry={2.4} fill="#a8a29e" stroke="#57534e" strokeWidth={0.8} />
          ))}
        </g>
      ))}
      {[-60, -20, 20, 60].map((x, i) => (
        <g key={`x${x}`}>
          <path d={`M${x},76V100`} stroke="#57534e" strokeWidth={2.4} />
          <ellipse cx={x} cy={84} rx={5} ry={2.2} fill={i === 3 ? '#93c5fd' : '#a8a29e'} stroke="#57534e" strokeWidth={0.8} />
        </g>
      ))}
      {/* 기호: 원 두 개 (Δ / Y) */}
      <circle cx={0} cy={-22} r={20} fill="none" stroke={live ? '#2563eb' : '#334155'} strokeWidth={2} />
      <circle cx={0} cy={6} r={20} fill="none" stroke={live ? '#2563eb' : '#334155'} strokeWidth={2} />
      <path d="M-8,-18l8,-12l8,12z" fill="none" stroke="#334155" strokeWidth={1.4} />
      <path d="M0,6v8M0,6l-7,-5M0,6l7,-5" fill="none" stroke="#334155" strokeWidth={1.4} />
      <Label x={0} y={44} text={`${p.tag}  ${p.kva ?? 500} kVA`} size={10} weight={800} fill="#0f172a" />
      <Label x={0} y={58} text={`${p.kv ?? 22.9}kV / LV · %Z ${p.z ?? 5}`} size={8} weight={600} fill="#334155" />
      {['H1', 'H2', 'H3'].map((t, i) => (
        <Label key={t} x={-40 + 40 * i + 10} y={-104} text={t} anchor="start" size={7.5} weight={800} fill="#78350f" />
      ))}
      {['X1', 'X2', 'X3', 'X0'].map((t, i) => (
        <Label key={t} x={-60 + 40 * i + 7} y={98} text={t} anchor="start" size={7.5} weight={800} fill={i === 3 ? '#1d4ed8' : '#475569'} />
      ))}
      {live && <circle cx={64} cy={-64} r={5} fill="#22c55e" stroke="#15803d" />}
      {p.name && <Label x={-78} y={-82} text={p.name} anchor="start" size={8.5} weight={600} fill={c.muted} />}
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
const OCT_X = [-60, -20, 20, 60];

/** 단자의 쓰임: 코일 (전원) · 공통 · a접점 · b접점. 나사 링 색과 번호 색을 맞춘다 */
type TermUse = 'coil' | 'com' | 'a' | 'b';
const USE_RING: Record<TermUse, Ring> = { coil: 'orange', com: 'yellow', a: 'green', b: 'grey' };
const USE_INK: Record<TermUse, string> = { coil: '#fdba74', com: '#fde047', a: '#86efac', b: '#e5e7eb' };
const OCT_USE: Record<number, TermUse> = { 1: 'com', 2: 'coil', 3: 'a', 4: 'b', 5: 'b', 6: 'a', 7: 'coil', 8: 'com' };

/** 기기 위에 붙이는 기호 스티커 (오른쪽 끝 x, 가운데 y). 소켓 옆은 점퍼선이 지나가는 자리라 기호는 기기 안에 적는다 */
function TagSticker({ tag, right, y }: { tag: string; right: number; y: number }) {
  if (!tag) return null;
  const w = Math.max(30, tag.length * 7 + 12);
  return (
    <g>
      <rect x={right - w} y={y - 7} width={w} height={14} rx={2} fill="#ffffff" stroke="#111827" strokeWidth={1} />
      <Label x={right - w / 2} y={y + 3.6} text={tag} fill="#111827" size={10} weight={800} />
    </g>
  );
}

/** 소켓 옆 (점퍼선 한 줄 바깥) 에 적는 설명 · 사양 */
function SideNotes({ x, lines, c }: { x: number; lines: (string | undefined | null | false)[]; c: CircuitColors }) {
  const shown = lines.filter((l): l is string => !!l);
  return (
    <g>
      {shown.map((l, i) => (
        <Label key={i} x={x} y={-2 + i * 12} text={l} anchor="start" size={i === 0 ? 9 : 8.5} weight={500} fill={c.muted} />
      ))}
    </g>
  );
}

/**
 * 8핀 원형 소켓 (DIN 레일용, PF083A · 8PFA 꼴): 전선은 릴레이 · 타이머가 아니라 이 소켓의 나사 단자에 물린다.
 * 위 · 아래 줄의 단자 번호는 소켓 배열 (Part.sock) 을 따르고, 번호 옆에 쓰임 (코일 · C · a · b) 을 적는다.
 */
function OctalSocket({ p, coil, children }: { p: Part; coil: string; children: React.ReactNode }) {
  const rows = OCTAL_ROWS[octalLayout(p)];
  const cap = (n: number) => (OCT_USE[n] === 'coil' ? coil : OCT_USE[n] === 'com' ? 'C' : OCT_USE[n]);
  const term = (n: number, x: number, top: boolean) => (
    <g key={n}>
      <Screw x={x} y={top ? -62 : 62} ring={USE_RING[OCT_USE[n]]} />
      <Label x={x + 11} y={top ? -66 : 62} text={String(n)} anchor="start" fill={USE_INK[OCT_USE[n]]} size={11} weight={800} />
      <Label x={x + 11} y={top ? -56 : 72} text={cap(n)} anchor="start" fill="#f3f4f6" size={7} weight={700} />
    </g>
  );
  return (
    <g>
      {/* DIN 레일 */}
      <rect x={-96} y={-13} width={192} height={26} fill="#d1d5db" stroke="#9ca3af" strokeWidth={0.8} />
      <rect x={-86} y={-90} width={172} height={180} rx={6} fill="#4b5563" stroke="#1f2937" />
      <rect x={-80} y={-84} width={160} height={34} rx={3} fill="#6b7280" />
      <rect x={-80} y={50} width={160} height={34} rx={3} fill="#6b7280" />
      {children}
      {rows.top.map((n, i) => term(n, OCT_X[i], true))}
      {rows.bottom.map((n, i) => term(n, OCT_X[i], false))}
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
    <OctalSocket p={p} coil={tr('코일', 'coil')}>
      <rect x={-70} y={-46} width={140} height={92} rx={8} fill="#e0f2fe" stroke="#7dd3fc" strokeWidth={1.4} opacity={0.97} />
      <rect x={-62} y={-14} width={26} height={28} rx={2} fill={st.on ? '#f59e0b' : '#f8fafc'} stroke="#111827" strokeWidth={1.6} />
      <path d="M-49,-14V-30M-49,14V30" stroke="#111827" strokeWidth={1.4} />
      <Label x={-49} y={-33} text="2" fill="#111827" size={9} weight={800} />
      <Label x={-49} y={40} text="7" fill="#111827" size={9} weight={800} />
      <Label x={-26} y={-34} text={tr('코일', 'coil')} anchor="start" fill="#475569" size={7.5} weight={600} />
      <Changeover y={-14} com="1" no="3" nc="4" on={on} />
      <Changeover y={24} com="8" no="6" nc="5" on={on} />
      {st.on && <circle cx={-2} cy={-37} r={3.5} fill="#ef4444" />}
      <TagSticker tag={p.tag} right={66} y={-36} />
      <SideNotes x={106} lines={[p.name, p.spec?.trim() || 'AC 220V']} c={c} />
    </OctalSocket>
  );
}

/**
 * 각형 릴레이 + 소켓 (MY2N · PYF08A / MY4N · PYF14A 꼴): 소켓의 나사 단자가 위 두 단 (바깥 b · 안쪽 a), 아래 두 단 (안쪽 공통 · 바깥 코일).
 * 투명 덮개 안에 극마다 전환 접점을 그 줄의 단자 바로 위에 그린다.
 */
export function MyRelayGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const cols = MY_COLS[p.type === 'r_my4' ? 'r_my4' : 'r_my2'];
  const n = cols.length;
  const x0 = -(n - 1) * 20;
  const left = x0 - 46;
  const right = x0 + 40 * (n - 1) + 26;
  const on = st.act;
  const ink = '#111827';
  const term = (num: number, x: number, y: number, use: TermUse) => (
    <g key={num}>
      <Screw x={x} y={y} ring={USE_RING[use]} />
      <Label x={x + 10} y={y - 4} text={String(num)} anchor="start" fill={USE_INK[use]} size={10} weight={800} />
    </g>
  );
  return (
    <g>
      {/* DIN 레일 */}
      <rect x={left - 10} y={-13} width={right - left + 20} height={26} fill="#d1d5db" stroke="#9ca3af" strokeWidth={0.8} />
      <rect x={left} y={-126} width={right - left} height={252} rx={6} fill="#4b5563" stroke="#1f2937" />
      {/* 계단처럼 두 단: 바깥 단이 한 층 높다 */}
      <rect x={left + 5} y={-121} width={right - left - 10} height={38} rx={3} fill="#6b7280" />
      <rect x={left + 5} y={-81} width={right - left - 10} height={38} rx={3} fill="#5f6875" />
      <rect x={left + 5} y={43} width={right - left - 10} height={38} rx={3} fill="#5f6875" />
      <rect x={left + 5} y={83} width={right - left - 10} height={38} rx={3} fill="#6b7280" />
      {/* 릴레이 (투명 덮개) */}
      <rect x={left + 8} y={-40} width={right - left - 16} height={80} rx={6} fill={st.on ? '#fef9c3' : '#e0f2fe'} stroke="#7dd3fc" strokeWidth={1.4} opacity={0.97} />
      {cols.map((num, k) => {
        const xb = x0 + 40 * k; // b (바깥 단) · 그 왼쪽 한 칸이 a 와 공통 (안쪽 단)
        const xa = xb - 20;
        const xc = xa;
        return (
          <g key={num}>
            <path d={`M${xb},-40V-22M${xa},-40V-22M${xc},40V20`} stroke={ink} strokeWidth={1.5} />
            <circle cx={xc} cy={20} r={2.4} fill={ink} />
            <path d={`M${xc},20L${on ? xa : xb},-21`} stroke={on ? '#2563eb' : ink} strokeWidth={2.2} />
            {term(num, xb, -102, 'b')}
            {term(num + 4, xa, -62, 'a')}
            {term(num + 8, xc, 62, 'com')}
          </g>
        );
      })}
      {term(14, x0, 102, 'coil')}
      {term(13, x0 + 40 * (n - 1), 102, 'coil')}
      <circle cx={right - 18} cy={30} r={4} fill={st.on ? '#ef4444' : '#cbd5e1'} stroke="#64748b" strokeWidth={0.8} />
      {/* 단마다 쓰임 */}
      <Label x={left + 8} y={-98} text="b" anchor="start" fill="#f3f4f6" size={8} weight={800} />
      <Label x={right - 7} y={-58} text="a" anchor="end" fill="#f3f4f6" size={8} weight={800} />
      <Label x={right - 7} y={66} text="C" anchor="end" fill="#f3f4f6" size={8} weight={800} />
      <Label x={left + 8} y={106} text={tr('코일', 'coil')} anchor="start" fill="#f3f4f6" size={7.5} weight={800} />
      {/* 기호는 덮개 위에 (접점 그림 위에 겹쳐도 읽히게 흰 테두리) */}
      <text x={(left + right) / 2} y={6} textAnchor="middle" fontSize={12} fontWeight={800} fill="#111827" stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round">
        {p.tag}
      </text>
      <g transform={`translate(${right + 26},0)`}>
        <SideNotes x={0} lines={[p.name, p.spec?.trim() || 'AC 220V']} c={c} />
      </g>
    </g>
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
  const mode = p.timerMode === 'off' ? 'OFF DLY' : p.timerMode === 'flicker' ? 'FLICKER' : p.timerMode === 'interval' ? 'INTERVAL' : 'ON DLY';
  return (
    <OctalSocket p={p} coil={tr('전원', 'power')}>
      <rect x={-70} y={-46} width={140} height={92} rx={8} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1.4} />
      <circle cx={-40} cy={-2} r={19} fill="#ffffff" stroke="#334155" strokeWidth={1.4} />
      {frac > 0 && <path d={`M${sx},${sy}A15,15 0 ${frac > 2 / 3 ? 1 : 0} 1 ${ex},${ey}`} stroke="#f59e0b" strokeWidth={4} fill="none" />}
      <path d={`M-40,-2L${ang(set).join(',')}`} stroke="#dc2626" strokeWidth={2.4} />
      <Label x={-56} y={20} text="0" fill="#64748b" size={6.5} />
      <Label x={-24} y={20} text={`${range}s`} fill="#64748b" size={6.5} />
      <circle cx={-40} cy={-2} r={3} fill="#334155" />
      <Label x={-40} y={30} text={timerText(p).replace(/(ON|OFF) /g, '').replace(/ (?=m?s|min|h)/g, '').replace(' · ', '/')} fill="#111827" size={9} weight={800} />
      <Label x={-40} y={40} text={mode} fill="#64748b" size={7} weight={700} />
      <circle cx={-60} cy={-36} r={3.5} fill={coil ? '#22c55e' : '#cbd5e1'} />
      <Label x={-54} y={-33} text="PW" anchor="start" fill="#475569" size={7} weight={700} />
      <circle cx={-30} cy={-36} r={3.5} fill={out ? '#ef4444' : '#cbd5e1'} />
      <Label x={-24} y={-33} text="UP" anchor="start" fill="#475569" size={7} weight={700} />
      <Changeover y={-10} com="1" no="3" nc="4" on={p.inst13 ? coil : out} timed={!p.inst13} inst={p.inst13} />
      <Changeover y={26} com="8" no="6" nc="5" on={out} timed />
      <TagSticker tag={p.tag} right={66} y={-36} />
      <SideNotes x={106} lines={[p.name, t && t.elapsed !== null && `${(t.elapsed / 1000).toFixed(1)} / ${(t.preset / 1000).toFixed(1)}s`]} c={c} />
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

/** 다이얼 위의 점 (0시가 위, 시계 방향) */
function dialPt(cx: number, cy: number, r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`;
}

/** 다이얼 가장자리의 15분 세그먼트 96개 (켜진 것 / 꺼진 것 두 path 로) */
function dialSegments(sched: [number, number][], cx: number, cy: number, r0: number, r1: number): { on: string; off: string } {
  let on = '';
  let off = '';
  for (let i = 0; i < 96; i++) {
    const a0 = i * 3.75 + 0.45;
    const a1 = (i + 1) * 3.75 - 0.45;
    const d = `M${dialPt(cx, cy, r0, a0)}L${dialPt(cx, cy, r1, a0)}A${r1},${r1} 0 0 1 ${dialPt(cx, cy, r1, a1)}L${dialPt(cx, cy, r0, a1)}Z`;
    // 세그먼트 가운데 시각으로 판정
    if (schedOn(sched, (i + 0.5) * 900000)) on += d;
    else off += d;
  }
  return { on, off };
}

/**
 * 24시간 타임 스위치 (다이얼식): 가장자리 세그먼트 (15분) 를 밀어 넣은 구간에 접점이 붙는다.
 * 아래 단자: L · N 시계 전원, COM → NO (설정 시간에 ON) · NC
 */
export function TswGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const sched = tswSched(p);
  const v = st.tsw ?? { dial: 0, out: schedOn(sched, 0), run: false };
  const seg = dialSegments(sched, 0, -28, 49, 61);
  const deg = (v.dial / 86400000) * 360;
  const xs = [-80, -40, 0, 40, 80];
  const names = ['L', 'N', 'COM', 'NO', 'NC'];
  return (
    <g>
      <rect x={-92} y={-112} width={184} height={186} rx={7} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-92} y={70} width={184} height={46} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <circle cx={0} cy={-28} r={66} fill="#f8fafc" stroke="#94a3b8" />
      <path d={seg.off} fill="#cbd5e1" />
      <path d={seg.on} fill="#f59e0b" stroke="#b45309" strokeWidth={0.5} />
      <circle cx={0} cy={-28} r={46} fill="#ffffff" stroke="#cbd5e1" />
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
        const [x, y] = dialPt(0, -28, 37, h * 15).split(',').map(Number);
        return <Label key={h} x={x} y={y + 3} text={String(h)} fill="#334155" size={8.5} weight={700} />;
      })}
      {Array.from({ length: 24 }, (_, h) => (
        <path key={h} d={`M${dialPt(0, -28, 43, h * 15)}L${dialPt(0, -28, 46, h * 15)}`} stroke="#64748b" strokeWidth={h % 3 === 0 ? 1.6 : 0.8} />
      ))}
      <path d={`M0,-28L${dialPt(0, -28, 47, deg)}`} stroke="#dc2626" strokeWidth={2.6} strokeLinecap="round" />
      <circle cx={0} cy={-28} r={4.5} fill="#334155" />
      <Label x={0} y={-12} text="24h" fill="#94a3b8" size={7} weight={700} />
      <rect x={-46} y={44} width={62} height={20} rx={3} fill="#0f172a" />
      <Label x={-15} y={58} text={formatClock(v.dial)} fill="#a7f3d0" size={12} weight={800} />
      <circle cx={34} cy={54} r={5} fill={v.out ? '#ef4444' : '#cbd5e1'} stroke="#64748b" strokeWidth={0.8} />
      <Label x={44} y={58} text={v.out ? 'ON' : 'OFF'} anchor="start" fill={v.out ? '#dc2626' : '#64748b'} size={9.5} weight={800} />
      <Label x={-82} y={-98} text={tr('타임 스위치', 'TIME SWITCH')} anchor="start" fill="#475569" size={8} weight={700} />
      {xs.map((x, i) => (
        <g key={x}>
          <Screw x={x} y={100} ring={i < 2 ? 'orange' : i === 3 ? 'green' : i === 4 ? 'yellow' : 'grey'} />
          <Label x={x} y={86} text={names[i]} size={8.5} weight={800} />
        </g>
      ))}
      <path d="M-20,74V116" stroke={BODY_EDGE} />
      <Label x={98} y={-98} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={98} y={-85} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      {(sched.length ? sched.slice(0, 3) : [null]).map((r, i) => (
        <Label key={i} x={98} y={(p.name ? -72 : -85) + i * 12} text={r ? `ON ${formatClock(r[0])}~${formatClock(r[1])}${i === 2 && sched.length > 3 ? ' …' : ''}` : 'ON —'} anchor="start" size={9} weight={700} fill={c.accent} />
      ))}
      {st.tsw && !v.run && <Label x={98} y={(p.name ? -72 : -85) + Math.min(3, Math.max(1, sched.length)) * 12 + 2} text={tr('전원 없음: 시계 멈춤', 'No power: stopped')} anchor="start" size={9} weight={700} fill="#dc2626" />}
    </g>
  );
}

/** 전등: 전구 + 소켓, L · N. 켜지면 빛난다 */
export function LightGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const on = st.on;
  return (
    <g>
      {on && <circle cy={-34} r={46} fill="#fde047" opacity={0.3} />}
      <path d="M-11,2C-11,-8 -26,-16 -26,-36A26,26 0 0 1 26,-36C26,-16 11,-8 11,2Z" fill={on ? '#fde047' : '#f8fafc'} stroke={on ? '#ca8a04' : '#94a3b8'} strokeWidth={1.4} />
      <path d="M-7,-2V-20L-3,-28L0,-20L3,-28L7,-20V-2" stroke={on ? '#b45309' : '#94a3b8'} strokeWidth={1.2} fill="none" />
      <rect x={-12} y={2} width={24} height={12} fill="#9ca3af" stroke="#6b7280" />
      <path d="M-12,6H12M-12,10H12" stroke="#6b7280" strokeWidth={0.8} />
      <rect x={-32} y={14} width={64} height={40} rx={4} fill="#111827" stroke="#6b7280" />
      <Label x={-20} y={27} text="L" fill="#f9fafb" size={8} weight={800} />
      <Label x={20} y={27} text="N" fill="#f9fafb" size={8} weight={800} />
      <Screw x={-20} y={40} />
      <Screw x={20} y={40} />
      <Label x={34} y={-52} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={34} y={-39} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 벽 스위치 판: 로커, 켜지면 위쪽이 눌리고 표시등 */
function SwitchPlate({ on }: { on: boolean }) {
  return (
    <g>
      <rect x={-34} y={-48} width={68} height={72} rx={6} fill="#f8fafc" stroke="#94a3b8" />
      <rect x={-15} y={-40} width={30} height={56} rx={4} fill="#e2e8f0" stroke="#94a3b8" />
      <rect x={-13} y={on ? -38 : -12} width={26} height={26} rx={3} fill="#ffffff" stroke="#cbd5e1" />
      <rect x={-13} y={on ? -12 : -38} width={26} height={26} rx={3} fill="#cbd5e1" />
      <circle cx={0} cy={-25} r={3} fill={on ? '#22c55e' : '#94a3b8'} />
    </g>
  );
}

/** 스위치 (단로): 단자 1 · 2 */
export function SwGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  return (
    <g>
      <SwitchPlate on={st.act} />
      <rect x={-34} y={22} width={68} height={34} rx={4} fill="#111827" stroke="#6b7280" />
      <Label x={-6} y={44} text="1" fill="#f9fafb" size={8} weight={800} />
      <Label x={6} y={44} text="2" fill="#f9fafb" size={8} weight={800} />
      <Screw x={-20} y={40} />
      <Screw x={20} y={40} />
      <Label x={0} y={-52} text={st.act ? 'ON' : 'OFF'} fill={st.act ? '#16a34a' : c.muted} size={8.5} weight={800} />
      <Label x={40} y={-36} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={40} y={-23} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 3로 스위치: 공통 0 (위) → 1 또는 3 (아래). 누를 때마다 넘어간다 */
export function Sw3Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const to3 = st.act;
  return (
    <g>
      <rect x={-14} y={-74} width={28} height={30} rx={4} fill="#111827" stroke="#6b7280" />
      <Screw x={0} y={-60} ring="grey" />
      <Label x={20} y={-57} text="0" anchor="start" fill={c.ink} size={9} weight={800} />
      <SwitchPlate on={to3} />
      <rect x={-34} y={22} width={68} height={34} rx={4} fill="#111827" stroke="#6b7280" />
      <Label x={-6} y={44} text="1" fill="#f9fafb" size={8} weight={800} />
      <Label x={6} y={44} text="3" fill="#f9fafb" size={8} weight={800} />
      <Screw x={-20} y={40} ring={to3 ? 'grey' : 'green'} />
      <Screw x={20} y={40} ring={to3 ? 'green' : 'grey'} />
      <path d={`M0,-44L${to3 ? 20 : -20},24`} stroke="#16a34a" strokeWidth={2} strokeDasharray="4 3" opacity={0.85} />
      <Label x={40} y={-36} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={40} y={-23} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      <Label x={40} y={p.name ? -10 : -23} text={to3 ? '0-3' : '0-1'} anchor="start" size={9} weight={700} fill={c.accent} />
    </g>
  );
}

/** 부하 (용량으로 전류를 계산하는 상자): 위에 단자, 가운데 용량, 시뮬레이션 중에는 전류 · 전압 */
export function LoadGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const three = p.type === 'r_load3';
  const xs = three ? [-40, 0, 40] : [-20, 20];
  const names = three ? ['L1', 'L2', 'L3'] : ['L', 'N'];
  const half = three ? 68 : 60;
  const r = loadRating(p);
  const kw = r ? r.out / 1000 : 0;
  const on = st.on;
  return (
    <g>
      <rect x={-half} y={-76} width={half * 2} height={34} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-half} y={-44} width={half * 2} height={100} rx={6} fill={on ? '#fef3c7' : '#f8fafc'} stroke={on ? '#d97706' : BODY_EDGE} strokeWidth={1.6} />
      {xs.map((x, i) => (
        <g key={x}>
          <Screw x={x} y={-60} />
          <Label x={x} y={-33} text={names[i]} size={8} weight={800} />
        </g>
      ))}
      <Label x={0} y={-12} text={p.tag} fill="#111827" size={12} weight={800} />
      <Label x={0} y={6} text={`${kw >= 10 ? kw.toFixed(1) : Number(kw.toFixed(2))} kW`} fill="#111827" size={13} weight={800} />
      <Label x={0} y={20} text={`${three ? tr('3상', '3-ph') : tr('단상', '1-ph')} · pf ${r?.pf ?? 1}${p.lighting ? ` · ${tr('조명', 'light')}` : ''}`} fill="#64748b" size={8} weight={600} />
      <rect x={-half + 8} y={28} width={half * 2 - 16} height={20} rx={3} fill="#0f172a" />
      <Label x={0} y={42} text={st.pw && st.pw.i > 0.005 ? `${st.pw.i.toFixed(1)} A · ${st.pw.v.toFixed(0)} V` : '0 A'} fill={st.pw && st.pw.i > 0.005 ? '#a7f3d0' : '#64748b'} size={10.5} weight={800} />
      {p.name && <Label x={0} y={70} text={p.name} size={10} weight={600} fill={c.ink} />}
    </g>
  );
}

/** 분전반 · 변전함 테두리: 왼쪽 위가 기준점. 이름표 줄을 잡고 옮긴다 */
export function PanelGlyph({ p, c }: { p: Part; c: CircuitColors }) {
  const [w, h] = panelSize(p);
  return (
    <g>
      <rect x={0} y={0} width={w * 20} height={h * 20} rx={10} fill={c.ink} fillOpacity={0.035} stroke={c.muted} strokeWidth={2.2} />
      <path d={`M0,30H${w * 20}`} stroke={c.muted} strokeWidth={1.2} />
      <rect x={0} y={0} width={w * 20} height={30} rx={10} fill={c.muted} fillOpacity={0.16} stroke="none" />
    </g>
  );
}

/** 분전반 이름표의 폭 (px, 배율 1 일 때) */
export function panelTitleWidth(p: Part): number {
  const text = [p.tag, p.name].filter(Boolean).join('  ');
  return [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 14 : 8.2), 0) + 18;
}

/** 분전반 이름표: 선 위에 그려서 급전선이 지나가도 읽힌다 */
export function PanelTitle({ p, c }: { p: Part; c: CircuitColors }) {
  const text = [p.tag, p.name].filter(Boolean).join('  ');
  const w = panelTitleWidth(p);
  return (
    <g pointerEvents="none">
      <rect x={6} y={4} width={w} height={22} rx={5} fill={c.bg} stroke={c.muted} strokeWidth={1.2} />
      <text x={15} y={20} fontSize={14} fontWeight={800} fill={c.ink} stroke="none">
        {text}
      </text>
    </g>
  );
}

// ───────────────────────── 현장 기기 (실물) ─────────────────────────

/** 접점 블록 (검은 몸통, 11-12 b 노랑 링 · 23-24 a 초록 링). 푸시버튼 · 리밋 · 풋 · 플로트 · 압력 스위치가 함께 쓴다 */
function ContactBlock({ note, lamp, lit }: { note: string; lamp?: boolean; lit?: boolean }) {
  return (
    <g>
      <rect x={-40} y={-36} width={80} height={lamp ? 132 : 92} rx={5} fill="#111827" stroke="#6b7280" />
      <Label x={0} y={19} text={note} fill="#9ca3af" size={7} weight={500} />
      <Label x={-20} y={-12} text="11" fill="#f9fafb" size={7.5} />
      <Label x={20} y={-12} text="12" fill="#f9fafb" size={7.5} />
      <Label x={-20} y={29} text="23" fill="#f9fafb" size={7.5} />
      <Label x={20} y={29} text="24" fill="#f9fafb" size={7.5} />
      <Screw x={-20} y={0} ring="yellow" />
      <Screw x={20} y={0} ring="yellow" />
      <Screw x={-20} y={40} ring="green" />
      <Screw x={20} y={40} ring="green" />
      {lamp && (
        <g>
          <Label x={-20} y={69} text="X1" fill={lit ? '#fde047' : '#f9fafb'} size={7.5} />
          <Label x={20} y={69} text="X2" fill={lit ? '#fde047' : '#f9fafb'} size={7.5} />
          <Screw x={-20} y={80} />
          <Screw x={20} y={80} />
        </g>
      )}
    </g>
  );
}

function TagAt({ p, x, y, c }: { p: Part; x: number; y: number; c: CircuitColors }) {
  return (
    <g>
      <Label x={x} y={y} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={x} y={y + 13} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 퓨즈 홀더: 위 1 · 아래 2, 늘 통한다 */
export function FuseGlyph({ p, st }: { p: Part; st: PartState }) {
  return (
    <g>
      <rect x={-24} y={-78} width={48} height={156} rx={4} fill="#e5e7eb" stroke="#9ca3af" />
      <rect x={-24} y={-78} width={48} height={36} rx={4} fill="#f3f4f6" stroke="#9ca3af" />
      <rect x={-24} y={42} width={48} height={36} rx={4} fill="#f3f4f6" stroke="#9ca3af" />
      <rect x={-16} y={-34} width={32} height={68} rx={3} fill="#ffffff" stroke="#cbd5e1" />
      <circle cy={-22} r={3.5} fill="#dc2626" />
      <Label x={0} y={-2} text="Fuse" size={8.5} weight={800} fill="#111827" />
      <Label x={0} y={12} text={p.amps ? `${p.amps}A` : p.spec?.trim() || '10A'} size={8} fill="#475569" />
      <Label x={0} y={27} text={p.tag} size={9} weight={800} />
      {st.amp !== undefined && st.amp > 0.05 && <Label x={30} y={4} text={`${st.amp.toFixed(1)} A`} anchor="start" size={10.5} weight={800} fill={p.amps && st.amp > p.amps ? '#dc2626' : '#2563eb'} />}
      <Screw x={0} y={-60} />
      <Screw x={0} y={60} />
    </g>
  );
}

/** SMPS: 아래 단자대 L N FG -V +V, 입력이 들어오면 초록 LED */
export function RSmpsGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const terms: [number, string, Ring][] = [
    [-80, 'L', 'orange'],
    [-40, 'N', 'grey'],
    [0, 'FG', 'green'],
    [40, '-V', 'grey'],
    [80, '+V', 'orange'],
  ];
  return (
    <g>
      <rect x={-104} y={-80} width={208} height={136} rx={4} fill="#9ca3af" stroke="#4b5563" />
      {Array.from({ length: 6 }, (_, r) =>
        Array.from({ length: 16 }, (_, k) => <circle key={`${r}-${k}`} cx={-90 + k * 12} cy={-68 + r * 12} r={3.4} fill="#374151" />),
      )}
      <rect x={-70} y={4} width={140} height={34} rx={3} fill="#1f2937" />
      <Label x={0} y={18} text="Switching Power Supply" fill="#f9fafb" size={8.5} weight={700} />
      <Label x={0} y={31} text={p.spec?.trim() || 'IN AC 100-240V  OUT DC 24V'} fill="#d1d5db" size={7.5} />
      <circle cx={-86} cy={21} r={5} fill={st.powered ? '#22c55e' : '#6b7280'} stroke="#111827" />
      <rect x={-104} y={56} width={208} height={48} rx={3} fill="#374151" stroke="#111827" />
      {terms.map(([x, t, ring]) => (
        <g key={t}>
          <Screw x={x} y={80} ring={ring} />
          <Label x={x} y={66} text={t} fill={t === '+V' ? '#fca5a5' : t === 'FG' ? '#86efac' : '#f9fafb'} size={8} weight={800} />
        </g>
      ))}
      <TagAt p={p} x={-104} y={-98} c={c} />
    </g>
  );
}

/** 근접 · 광전 센서 3선식: 갈색 (+) · 검정 (출력) · 파랑 (0V) 리드선 */
export function RProxGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const photo = p.sense === 'photo';
  const on = st.act && st.powered !== false;
  const leads: [number, string, string][] = [
    [-40, '#92400e', tr('갈 +', 'BN +')],
    [0, '#111827', tr('흑 OUT', 'BK OUT')],
    [40, '#2563eb', tr('청 0V', 'BU 0V')],
  ];
  return (
    <g>
      {leads.map(([x, col, t]) => (
        <g key={x}>
          <path d={`M0,-8C0,20 ${x},16 ${x},46`} stroke="#00000040" strokeWidth={5.4} fill="none" />
          <path d={`M0,-8C0,20 ${x},16 ${x},46`} stroke={col} strokeWidth={3.6} fill="none" />
          <rect x={x - 3} y={44} width={6} height={12} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.8} />
          <circle cx={x} cy={60} r={5} fill={col} stroke="#ffffff" strokeWidth={1.2} />
          <Label x={x} y={76} text={t} size={7} weight={700} fill={c.muted} />
        </g>
      ))}
      {photo ? (
        <g>
          <rect x={-22} y={-78} width={44} height={70} rx={4} fill="#1f2937" stroke="#111827" />
          <circle cx={0} cy={-58} r={11} fill="#7dd3fc" stroke="#0369a1" />
          <circle cx={0} cy={-58} r={5} fill="#0c4a6e" />
          {on && <path d="M0,-72V-96M-10,-70L-18,-92M10,-70L18,-92" stroke="#ef4444" strokeWidth={1.6} />}
        </g>
      ) : (
        <g>
          <rect x={-14} y={-78} width={28} height={12} rx={2} fill={p.sense === 'capacitive' ? '#38bdf8' : '#f97316'} stroke="#7c2d12" strokeWidth={0.8} />
          <rect x={-14} y={-66} width={28} height={46} fill="#9ca3af" stroke="#4b5563" />
          {[-60, -52, -44, -36, -28].map((y) => (
            <path key={y} d={`M-14,${y}H14`} stroke="#4b5563" strokeWidth={1} />
          ))}
          <rect x={-18} y={-40} width={36} height={8} fill="#d1d5db" stroke="#6b7280" />
          <rect x={-12} y={-20} width={24} height={12} rx={2} fill="#1f2937" />
          {on && <path d="M-12,-84Q0,-94 12,-84M-18,-90Q0,-104 18,-90" stroke="#f97316" strokeWidth={1.6} fill="none" />}
        </g>
      )}
      <circle cx={0} cy={-14} r={3.4} fill={on ? '#f59e0b' : st.powered ? '#22c55e' : '#6b7280'} stroke="#111827" strokeWidth={0.8} />
      <Label x={24} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      <Label x={24} y={-53} text={`${p.npn ? 'NPN' : 'PNP'} · DC 24V`} anchor="start" size={8.5} weight={600} fill={c.muted} />
      {p.name && <Label x={24} y={-41} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 리밋 스위치: 롤러 레버가 밀리면 접점이 바뀐다 */
export function LsGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  return (
    <g>
      <rect x={-22} y={-56} width={44} height={22} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
      <g transform={`rotate(${st.act ? 32 : 0},0,-52)`}>
        <rect x={-3.5} y={-84} width={7} height={34} rx={3} fill="#d1d5db" stroke="#6b7280" />
        <circle cx={0} cy={-84} r={8} fill="#e5e7eb" stroke="#6b7280" strokeWidth={1.4} />
        <circle cx={0} cy={-84} r={2.4} fill="#6b7280" />
      </g>
      <circle cx={0} cy={-52} r={4} fill="#9ca3af" stroke="#4b5563" />
      <ContactBlock note="Limit SW" />
      <TagAt p={p} x={30} y={-58} c={c} />
    </g>
  );
}

/** 풋 스위치: 밟는 동안 접점이 바뀐다 */
export function FswGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  return (
    <g>
      <path d="M-62,-36H62L54,-46H-54Z" fill="#6b7280" stroke="#374151" />
      <g transform={`rotate(${st.act ? 0 : -12},56,-46)`}>
        <path d="M-56,-56H56V-46H-56Z" fill="#d1d5db" stroke="#6b7280" />
        {[-44, -32, -20, -8, 4, 16, 28, 40].map((x) => (
          <path key={x} d={`M${x},-55V-47`} stroke="#9ca3af" strokeWidth={1.4} />
        ))}
      </g>
      <ContactBlock note="Foot SW" />
      <TagAt p={p} x={46} y={-10} c={c} />
    </g>
  );
}

/** 플로트 스위치: 수위가 오르면 뜨개가 올라가 접점이 바뀐다 */
export function FloatGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const up = st.act;
  return (
    <g>
      <rect x={-34} y={-98} width={68} height={58} rx={3} fill="#e0f2fe" stroke="#7dd3fc" />
      <rect x={-34} y={up ? -84 : -56} width={68} height={up ? 44 : 16} fill="#38bdf8" opacity={0.55} />
      <path d={`M0,-40V${up ? -78 : -52}`} stroke="#f59e0b" strokeWidth={3} />
      <rect x={-11} y={up ? -96 : -70} width={22} height={18} rx={6} fill="#0ea5e9" stroke="#0369a1" />
      <ContactBlock note="Float SW" />
      <TagAt p={p} x={40} y={-84} c={c} />
      <Label x={40} y={-58} text={up ? tr('만수', 'HIGH') : tr('저수', 'LOW')} anchor="start" size={8.5} weight={700} fill={up ? '#0369a1' : c.muted} />
    </g>
  );
}

/** 압력 스위치 (전기 접점식 압력계): 설정 압력에 닿으면 접점이 바뀐다 */
export function PswGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const a = ((st.act ? 50 : -60) * Math.PI) / 180;
  return (
    <g>
      <rect x={-5} y={-44} width={10} height={10} fill="#b45309" />
      <circle cx={0} cy={-68} r={28} fill="#f8fafc" stroke="#334155" strokeWidth={2} />
      {[-120, -80, -40, 0, 40, 80, 120].map((d) => {
        const r = (d * Math.PI) / 180;
        return <path key={d} d={`M${Math.sin(r) * 21},${-68 - Math.cos(r) * 21}L${Math.sin(r) * 25},${-68 - Math.cos(r) * 25}`} stroke="#334155" strokeWidth={1.2} />;
      })}
      <path d={`M${Math.sin((50 * Math.PI) / 180) * 12},${-68 - Math.cos((50 * Math.PI) / 180) * 12}L${Math.sin((50 * Math.PI) / 180) * 25},${-68 - Math.cos((50 * Math.PI) / 180) * 25}`} stroke="#dc2626" strokeWidth={2} />
      <path d={`M0,-68L${Math.sin(a) * 20},${-68 - Math.cos(a) * 20}`} stroke="#111827" strokeWidth={2.4} />
      <circle cx={0} cy={-68} r={3} fill="#111827" />
      <Label x={0} y={-50} text="MPa" size={6.5} fill="#64748b" />
      <ContactBlock note="Pressure SW" />
      <TagAt p={p} x={34} y={-84} c={c} />
    </g>
  );
}

/** 조광형 푸시버튼: 접점 11-12 · 23-24 와 램프 X1-X2 */
export function PblGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const col = LAMP_HEX[p.color ?? 'green'];
  const dy = st.act ? 7 : 0;
  return (
    <g>
      {st.on && <ellipse cx={0} cy={-66} rx={40} ry={24} fill={col} opacity={0.35} />}
      <g transform={`translate(0,${dy})`}>
        <path d="M-28,-60Q-28,-80 0,-80Q28,-80 28,-60L28,-56H-28Z" fill={col} opacity={st.on ? 1 : 0.55} stroke="#00000055" />
        <ellipse cx={-8} cy={-70} rx={9} ry={3} fill="#ffffff" opacity={st.on ? 0.8 : 0.35} />
      </g>
      <rect x={-17} y={-56} width={34} height={20} rx={3} fill="#d1d5db" stroke="#9ca3af" />
      <ContactBlock note="Illuminated" lamp lit={st.on} />
      <TagAt p={p} x={34} y={-66} c={c} />
    </g>
  );
}

/** 부저: X1 · X2, 울리면 소리 물결 */
export function BuzzerGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  return (
    <g>
      <circle cy={-30} r={22} fill="#1f2937" stroke="#6b7280" />
      <circle cy={-30} r={13} fill="#374151" />
      {[-8, -3, 2, 7].map((y) => (
        <path key={y} d={`M-9,${-30 + y}H9`} stroke="#111827" strokeWidth={1.6} />
      ))}
      {st.on && <path d="M26,-44Q34,-30 26,-16M34,-50Q46,-30 34,-10M-26,-44Q-34,-30 -26,-16M-34,-50Q-46,-30 -34,-10" stroke="#f59e0b" strokeWidth={2} fill="none" />}
      <rect x={-32} y={-8} width={64} height={42} rx={4} fill="#111827" stroke="#6b7280" />
      <Label x={-20} y={8} text="X1" fill="#f9fafb" size={7.5} />
      <Label x={20} y={8} text="X2" fill="#f9fafb" size={7.5} />
      <Screw x={-20} y={20} />
      <Screw x={20} y={20} />
      <TagAt p={p} x={28} y={-58} c={c} />
    </g>
  );
}

/** 솔레노이드 밸브: 코일 1 · 2 (DIN 커넥터), 여자되면 표시등 */
export function SolGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const ac = solAc(p);
  const din = p.conn === 'din';
  const on = st.on;
  /** 코일에서 나온 선 한 가닥: 슬리브 · 압착 단자까지 */
  const lead = (x0: number, y0: number, x: number, col: string, label: string, key: string) => (
    <g key={key}>
      <path d={`M${x0},${y0}C${x0},${y0 + 14} ${x},${y0 + 8} ${x},22`} stroke="#00000040" strokeWidth={5.4} fill="none" />
      <path d={`M${x0},${y0}C${x0},${y0 + 14} ${x},${y0 + 8} ${x},22`} stroke={col} strokeWidth={3.6} fill="none" />
      <rect x={x - 3} y={22} width={6} height={11} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.8} />
      <circle cx={x} cy={40} r={5} fill={col} stroke="#ffffff" strokeWidth={1.2} />
      <Label x={x} y={55} text={label} size={7.5} weight={800} fill={c.muted} />
    </g>
  );
  return (
    <g>
      {/* 밸브 몸통 (5포트): 위 4 (A) · 2 (B), 아래 5 · 1 · 3 */}
      <rect x={-16} y={-50} width={72} height={36} rx={3} fill="#cbd5e1" stroke="#64748b" />
      <path d="M-16,-32H56" stroke="#94a3b8" strokeWidth={0.8} />
      {[
        [8, '4'],
        [36, '2'],
      ].map(([x, t]) => (
        <g key={t as string}>
          <rect x={(x as number) - 6} y={-62} width={12} height={12} rx={2} fill="#e2e8f0" stroke="#64748b" />
          <circle cx={x as number} cy={-62} r={4.5} fill="#2563eb" stroke="#1e3a8a" strokeWidth={0.8} />
          <Label x={(x as number) + 10} y={-54} text={t as string} anchor="start" size={7.5} weight={800} fill="#334155" />
        </g>
      ))}
      {[
        [4, '5'],
        [20, '1'],
        [36, '3'],
      ].map(([x, t]) => (
        <g key={t as string}>
          <circle cx={x as number} cy={-20} r={3.2} fill="#475569" />
          <Label x={x as number} y={-24} text={t as string} size={6.5} weight={700} fill="#334155" />
        </g>
      ))}
      {on && <path d="M20,-22V-36L8,-46" stroke="#0ea5e9" strokeWidth={2.4} fill="none" strokeDasharray="5 4" className="cc-flow" />}
      {/* 수동 조작 버튼 */}
      <circle cx={-8} cy={-41} r={4} fill="#facc15" stroke="#a16207" />
      {/* 코일 */}
      <rect x={-56} y={-58} width={40} height={50} rx={3} fill="#111827" stroke="#374151" />
      {/* 기호는 코일에, 설명은 몸통 아래에 (옆 기기와 겹치지 않게) */}
      <Label x={-36} y={-36} text={p.tag || 'SOL'} fill="#f9fafb" size={9} weight={800} />
      <Label x={-36} y={-24} text={p.spec?.trim() || 'DC 24V'} fill="#d1d5db" size={6.5} />
      <circle cx={-26} cy={-51} r={3.2} fill={on ? '#ef4444' : '#4b5563'} stroke="#000" strokeWidth={0.6} />
      {din ? (
        <g>
          {/* DIN 커넥터 + 케이블 그랜드 → 3심 (1 · 2 · 접지) */}
          <rect x={-54} y={-10} width={32} height={16} rx={2} fill="#4b5563" stroke="#1f2937" />
          <Label x={-38} y={1} text="DIN" fill="#e5e7eb" size={6.5} weight={800} />
          <rect x={-44} y={6} width={12} height={6} fill="#374151" />
          {lead(-40, 12, -20, '#92400e', '1', 'a')}
          {lead(-38, 12, 0, '#65a30d', 'PE', 'pe')}
          {lead(-36, 12, 20, '#2563eb', '2', 'b')}
        </g>
      ) : (
        <g>
          {/* 플러그 커넥터 → 리드선 2가닥 */}
          <rect x={-50} y={-10} width={24} height={12} rx={2} fill="#374151" stroke="#1f2937" />
          {lead(-42, 2, -20, ac ? '#111827' : '#dc2626', ac ? '1' : '+', 'a')}
          {lead(-34, 2, 20, '#111827', ac ? '2' : '−', 'b')}
        </g>
      )}
      {p.name && <Label x={-12} y={0} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 판넬 팬: L · N, 돌 때 날개가 회전 */
export function FanGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  return (
    <g>
      <rect x={-54} y={-58} width={108} height={100} rx={8} fill="#374151" stroke="#111827" />
      <circle cx={0} cy={-8} r={42} fill="#111827" stroke="#6b7280" />
      <g transform="translate(0,-8)">
        <g className={st.on ? 'cc-spin' : undefined}>
          {[0, 72, 144, 216, 288].map((d) => (
            <path key={d} d="M0,0C-10,-22 6,-38 16,-34C14,-20 8,-8 0,0Z" fill="#9ca3af" stroke="#d1d5db" strokeWidth={0.8} transform={`rotate(${d})`} />
          ))}
          <circle r={9} fill="#4b5563" stroke="#d1d5db" />
        </g>
      </g>
      {[-44, 44].map((x) => [-48, 32].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={3} fill="#9ca3af" />))}
      <rect x={-32} y={42} width={64} height={32} rx={3} fill="#1f2937" stroke="#6b7280" />
      <Label x={-20} y={50} text="L" fill="#f9fafb" size={7} />
      <Label x={20} y={50} text="N" fill="#f9fafb" size={7} />
      <Screw x={-20} y={60} />
      <Screw x={20} y={60} ring="grey" />
      <TagAt p={p} x={60} y={-44} c={c} />
      <Label x={60} y={-18} text={p.spec?.trim() || 'AC 220V'} anchor="start" size={8.5} fill={c.muted} />
    </g>
  );
}

/** 중성선 · 접지 바: 나사가 모두 한 막대에 물려 있다 */
export function NbarGlyph({ p, c }: { p: Part; c: CircuitColors }) {
  const n = tbSize(p);
  const pe = p.pole === 'PE';
  return (
    <g>
      <rect x={-22} y={-18} width={(n - 1) * 40 + 44} height={36} rx={4} fill={pe ? '#bbf7d0' : '#e5e7eb'} stroke={pe ? '#15803d' : '#6b7280'} />
      <rect x={-16} y={-7} width={(n - 1) * 40 + 32} height={14} rx={2} fill="#d6b370" stroke="#92400e" strokeWidth={0.8} />
      {Array.from({ length: n }, (_, k) => (
        <Screw key={k} x={k * 40} y={0} ring={pe ? 'green' : 'grey'} />
      ))}
      <Label x={-22} y={-24} text={[p.tag, pe ? 'PE' : 'N', p.name].filter(Boolean).join(' · ')} anchor="start" size={10} weight={800} fill={c.ink} />
    </g>
  );
}

/** 전압계 · 전류계 (디지털 판넬 미터) */
export function MeterGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const amp = p.type === 'r_am';
  const v = amp ? st.amp : st.volt;
  const text = v === undefined ? '---' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return (
    <g>
      <rect x={-50} y={-50} width={100} height={86} rx={6} fill="#1f2937" stroke="#111827" />
      <rect x={-40} y={-38} width={80} height={38} rx={3} fill="#052e16" stroke="#000000" />
      <Label x={24} y={-11} text={text} anchor="end" size={20} weight={800} fill={v === undefined ? '#166534' : '#4ade80'} />
      <Label x={36} y={-11} text={amp ? 'A' : 'V'} anchor="end" size={10} weight={800} fill="#86efac" />
      <Label x={0} y={18} text={amp ? tr('전류계', 'AMMETER') : tr('전압계', 'VOLTMETER')} size={8} weight={700} fill="#d1d5db" />
      <Label x={0} y={30} text={p.tag} size={8.5} weight={800} fill="#f9fafb" />
      <rect x={-34} y={36} width={68} height={38} rx={3} fill="#374151" stroke="#111827" />
      <Screw x={-20} y={60} />
      <Screw x={20} y={60} ring={amp ? 'orange' : 'grey'} />
      <Label x={-20} y={46} text={amp ? '1' : 'V1'} fill="#f9fafb" size={7} />
      <Label x={20} y={46} text={amp ? '2' : 'V2'} fill="#f9fafb" size={7} />
      {p.name && <Label x={56} y={-36} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 배선 덕트: 선이 덕트 안으로 지나간다 (선 위에 반투명하게 덮는다) */
export function DuctGlyph({ p }: { p: Part }) {
  const [w, h] = stripSize(p);
  const [W, H] = [w * 20, h * 20];
  const wide = W >= H;
  const n = Math.floor((wide ? W : H) / 10);
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} rx={2} fill="#cbd5e1" opacity={0.88} stroke="#64748b" strokeWidth={1.2} />
      {Array.from({ length: n }, (_, k) => {
        const t = 5 + k * 10;
        return wide ? <path key={k} d={`M${t},0v5M${t},${H}v-5`} stroke="#64748b" strokeWidth={2.2} /> : <path key={k} d={`M0,${t}h5M${W},${t}h-5`} stroke="#64748b" strokeWidth={2.2} />;
      })}
      {wide ? <path d={`M4,${H / 2}H${W - 4}`} stroke="#94a3b8" strokeWidth={1} strokeDasharray="8 6" /> : <path d={`M${W / 2},4V${H - 4}`} stroke="#94a3b8" strokeWidth={1} strokeDasharray="8 6" />}
    </g>
  );
}

/** DIN 레일 (35 mm): 기기를 올려 다는 레일 */
export function RailGlyph({ p }: { p: Part }) {
  const W = stripSize(p)[0] * 20;
  return (
    <g>
      <rect x={0} y={-14} width={W} height={28} fill="#d1d5db" stroke="#9ca3af" strokeWidth={1} />
      <path d={`M0,-8H${W}M0,8H${W}`} stroke="#f3f4f6" strokeWidth={2} />
      {Array.from({ length: Math.floor(W / 30) }, (_, k) => (
        <rect key={k} x={10 + k * 30} y={-3} width={14} height={6} rx={3} fill="#9ca3af" />
      ))}
    </g>
  );
}

/** 콘센트: L · N · PE */
export function OutletGlyph({ p, c }: { p: Part; c: CircuitColors }) {
  return (
    <g>
      <rect x={-54} y={-56} width={108} height={84} rx={8} fill="#f5e9e2" stroke="#d6b8a8" />
      <circle cx={0} cy={-16} r={30} fill="#ffffff" stroke="#d6b8a8" />
      <circle cx={-12} cy={-16} r={4.5} fill="#111827" />
      <circle cx={12} cy={-16} r={4.5} fill="#111827" />
      <rect x={-3} y={-46} width={6} height={8} fill="#a3a3a3" />
      <rect x={-3} y={6} width={6} height={8} fill="#a3a3a3" />
      <rect x={-54} y={24} width={108} height={30} rx={3} fill="#e7d5cb" stroke="#d6b8a8" />
      <Screw x={-40} y={40} />
      <Screw x={0} y={40} ring="green" />
      <Screw x={40} y={40} ring="grey" />
      <Label x={-40} y={30} text="L" size={7} weight={800} fill="#7c2d12" />
      <Label x={0} y={30} text="PE" size={7} weight={800} fill="#15803d" />
      <Label x={40} y={30} text="N" size={7} weight={800} fill="#1d4ed8" />
      <TagAt p={p} x={60} y={-44} c={c} />
    </g>
  );
}

/** 3상 전동기 6단자: 위 U1 V1 W1, 아래 W2 U2 V2 (Y-Δ 기동). 돌 때 결선 (Y · Δ) 을 적는다 */
export function Motor6Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const spin = st.dir !== 0;
  const rows: [number, string[]][] = [
    [-80, ['U1', 'V1', 'W1']],
    [80, ['W2', 'U2', 'V2']],
  ];
  return (
    <g>
      <rect x={-112} y={-40} width={170} height={80} rx={20} fill="#9ca3af" stroke="#6b7280" />
      {[-92, -76, -60, -44, 28, 44].map((x) => (
        <path key={x} d={`M${x},-34V34`} stroke="#6b7280" strokeWidth={2} />
      ))}
      <rect x={-34} y={-30} width={52} height={60} rx={3} fill="#111827" />
      <Label x={-8} y={-8} text={p.tag || 'M'} fill="#f9fafb" size={10} weight={800} />
      <Label x={-8} y={5} text="3φ Y-Δ" fill="#d1d5db" size={8} />
      <Label x={-8} y={19} text={st.mode ? (st.mode === 'Y' ? 'Y' : 'Δ') : '—'} fill={st.mode ? '#fde047' : '#6b7280'} size={12} weight={800} />
      <rect x={-126} y={-4} width={16} height={8} fill="#6b7280" />
      <g transform="translate(-126,0)">
        <g className={spin ? `cc-spin ${st.dir < 0 ? 'rev' : ''}` : undefined}>
          {[0, 120, 240].map((d) => (
            <path key={d} d="M0,0C-6,-26 10,-34 14,-30C10,-18 6,-8 0,0Z" fill="#facc15" stroke="#ca8a04" transform={`rotate(${d})`} />
          ))}
          <circle r={5} fill="#6b7280" />
        </g>
      </g>
      {rows.map(([y, labels]) =>
        labels.map((l, k) => (
          <g key={l}>
            <path d={`M${-40 + 40 * k},${y}V${y < 0 ? -40 : 40}`} stroke="#6b7280" strokeWidth={4} />
            <Screw x={-40 + 40 * k} y={y} />
            <Label x={-40 + 40 * k + 11} y={y + (y < 0 ? -6 : 14)} text={l} anchor="start" size={8.5} weight={800} />
          </g>
        )),
      )}
      <path d="M58,0H92" stroke="#6b7280" strokeWidth={3} />
      <Screw x={100} y={0} ring="green" />
      <Label x={100} y={-12} text="PE" size={8} weight={800} fill="#15803d" />
      {p.name && <Label x={64} y={-30} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      {spin && <Label x={74} y={30} text={st.dir > 0 ? 'FWD' : 'REV'} fill={c.accent} size={10} weight={800} />}
    </g>
  );
}

// ───────────────────────── 3단 셀렉터 · 카운터 · SSR ─────────────────────────

/** 3단 셀렉터: 손잡이가 왼쪽 · 가운데 · 오른쪽. 왼쪽이면 13-14, 오른쪽이면 23-24 가 닫힌다 */
export function Ss3Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const pos = st.sel ?? 0;
  const [l, m, r] = pos3Labels(p);
  const on = (k: -1 | 1) => pos === k;
  return (
    <g>
      <rect x={-17} y={-56} width={34} height={20} rx={3} fill="#d1d5db" stroke="#9ca3af" />
      <circle cy={-62} r={26} fill="#1f2937" stroke="#000" />
      <g transform={`rotate(${pos * 45},0,-62)`}>
        <rect x={-6} y={-84} width={12} height={44} rx={5} fill="#4b5563" stroke="#111827" />
        <path d="M0,-82V-74" stroke="#f9fafb" strokeWidth={2.4} />
      </g>
      <Label x={-34} y={-80} text={l} anchor="end" fill={pos === -1 ? c.accent : c.ink} size={9.5} weight={800} />
      <Label x={0} y={-94} text={m} fill={pos === 0 ? c.accent : c.ink} size={9.5} weight={800} />
      <Label x={34} y={-80} text={r} anchor="start" fill={pos === 1 ? c.accent : c.ink} size={9.5} weight={800} />
      <rect x={-40} y={-36} width={80} height={92} rx={5} fill="#111827" stroke="#6b7280" />
      <Label x={-20} y={-12} text="13" fill="#f9fafb" size={7.5} />
      <Label x={20} y={-12} text="14" fill="#f9fafb" size={7.5} />
      <Label x={-20} y={29} text="23" fill="#f9fafb" size={7.5} />
      <Label x={20} y={29} text="24" fill="#f9fafb" size={7.5} />
      <Label x={0} y={-22} text={`${l} a`} fill={on(-1) ? '#4ade80' : '#9ca3af'} size={6.5} weight={600} />
      <Label x={0} y={19} text={`${r} a`} fill={on(1) ? '#4ade80' : '#9ca3af'} size={6.5} weight={600} />
      <Screw x={-20} y={0} ring="green" />
      <Screw x={20} y={0} ring="green" />
      <Screw x={-20} y={40} ring="green" />
      <Screw x={20} y={40} ring="green" />
      <Label x={46} y={-56} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={46} y={-43} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 프리셋 카운터 (48 각): 위 입력 CP · COM · RST, 아래 전원 A1 · A2 · 출력 C · NO · NC, 앞면에 센 수 / 설정 수 */
export function CounterGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const preset = counterPreset(p);
  const v = st.count ?? { n: 0, out: false };
  const top = [
    [-40, 'CP'],
    [0, 'COM'],
    [40, 'RST'],
  ] as const;
  const bottom = [
    [-80, 'A1', 'orange'],
    [-40, 'A2', 'orange'],
    [0, 'C', 'grey'],
    [40, 'NO', 'green'],
    [80, 'NC', 'yellow'],
  ] as const;
  return (
    <g>
      <rect x={-96} y={-116} width={192} height={232} rx={7} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-96} y={-116} width={192} height={44} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <rect x={-96} y={72} width={192} height={44} rx={4} fill={BAND} stroke={BODY_EDGE} />
      {top.map(([x, t]) => (
        <g key={t}>
          <Screw x={x} y={-100} ring="grey" />
          <Label x={x} y={-80} text={t} size={8.5} weight={800} />
        </g>
      ))}
      <Label x={-88} y={-80} text={tr('입력', 'IN')} anchor="start" fill="#64748b" size={7} weight={700} />
      {bottom.map(([x, t, ring]) => (
        <g key={t}>
          <Screw x={x} y={100} ring={ring} />
          <Label x={x} y={86} text={t} size={8.5} weight={800} />
        </g>
      ))}
      <rect x={-70} y={-60} width={140} height={120} rx={5} fill="#1f2937" stroke="#111827" />
      <rect x={-60} y={-50} width={120} height={58} rx={3} fill="#0f172a" />
      <Label x={52} y={-6} text={String(v.n).padStart(4, ' ')} anchor="end" fill="#f87171" size={30} weight={800} />
      <Label x={-54} y={-38} text="CNT" anchor="start" fill="#64748b" size={7} weight={700} />
      <rect x={-60} y={14} width={120} height={22} rx={3} fill="#0f172a" />
      <Label x={-54} y={29} text="SET" anchor="start" fill="#64748b" size={7} weight={700} />
      <Label x={52} y={30} text={String(preset)} anchor="end" fill="#4ade80" size={13} weight={800} />
      <circle cx={-48} cy={48} r={4.5} fill={v.out ? '#ef4444' : '#475569'} />
      <Label x={-38} y={51} text="OUT" anchor="start" fill={v.out ? '#fca5a5' : '#94a3b8'} size={7.5} weight={800} />
      <rect x={22} y={42} width={30} height={12} rx={2} fill="#475569" />
      <Label x={37} y={51} text="RST" fill="#e5e7eb" size={6.5} weight={700} />
      <Label x={104} y={-100} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={104} y={-87} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
      {st.count && !st.on && <Label x={104} y={p.name ? -74 : -87} text={tr('전원 없음', 'No power')} anchor="start" size={9} weight={700} fill="#dc2626" />}
    </g>
  );
}

/** 온도 표시 (정수, 7세그먼트처럼) */
function tempText(v: number): string {
  return String(Math.round(v));
}

/**
 * 온도 조절기 (48×48): 앞면에 현재 온도 PV (빨강) · 설정 온도 SV (초록), OUT · AL 램프. 아래 단자 A1 · A2 (전원), C1-OUT, C2-AL.
 * 시뮬레이션 중에는 왼쪽 · 오른쪽을 눌러 온도를 5℃ 내리고 올린다
 */
export function TcGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const t = st.temp;
  const sv = tempSetting(p).sv;
  const powered = !t || st.on;
  const bottom = [
    [-100, 'A1', 'orange'],
    [-60, 'A2', 'orange'],
    [-20, 'C1', 'grey'],
    [20, 'OUT', 'green'],
    [60, 'C2', 'grey'],
    [100, 'AL', 'yellow'],
  ] as const;
  const led = (x: number, on: boolean, color: string, text: string) => (
    <g>
      <circle cx={x} cy={44} r={4.5} fill={on ? color : '#475569'} />
      <Label x={x + 8} y={47} text={text} anchor="start" fill={on ? '#f8fafc' : '#94a3b8'} size={7.5} weight={800} />
    </g>
  );
  return (
    <g>
      <rect x={-116} y={-104} width={232} height={220} rx={7} fill={BODY} stroke={BODY_EDGE} />
      <rect x={-116} y={72} width={232} height={44} rx={4} fill={BAND} stroke={BODY_EDGE} />
      {bottom.map(([x, label, ring]) => (
        <g key={label}>
          <Screw x={x} y={100} ring={ring} />
          <Label x={x} y={86} text={label} size={8.5} weight={800} />
        </g>
      ))}
      <rect x={-72} y={-98} width={144} height={164} rx={5} fill="#111827" stroke="#030712" />
      <rect x={-62} y={-88} width={124} height={52} rx={3} fill="#0b1120" />
      <Label x={-56} y={-76} text="PV" anchor="start" fill="#64748b" size={7} weight={700} />
      <Label x={54} y={-44} text={powered ? tempText(t ? t.pv : sv) : ''} anchor="end" fill="#f87171" size={30} weight={800} />
      <rect x={-62} y={-30} width={124} height={34} rx={3} fill="#0b1120" />
      <Label x={-56} y={-18} text="SV" anchor="start" fill="#64748b" size={7} weight={700} />
      <Label x={54} y={-4} text={powered ? tempText(sv) : ''} anchor="end" fill="#4ade80" size={20} weight={800} />
      {led(-54, !!t?.out, '#22c55e', 'OUT')}
      {led(-2, !!t?.al, '#ef4444', 'AL')}
      <Label x={64} y={47} text="℃" anchor="end" fill="#94a3b8" size={9} weight={700} />
      {[-36, 0, 36].map((x, i) => (
        <rect key={x} x={x - 12} y={54} width={24} height={8} rx={2} fill="#374151" stroke="none">
          <title>{['MODE', '▼', '▲'][i]}</title>
        </rect>
      ))}
      <Label x={-108} y={-90} text={tr('센서', 'Sensor')} anchor="start" fill="#64748b" size={7} weight={700} />
      <Label x={-108} y={-80} text="K (CA)" anchor="start" fill="#475569" size={7.5} weight={800} />
      {t && (
        <>
          <Label x={-94} y={-28} text="−5" fill="#2563eb" size={9} weight={800} />
          <Label x={94} y={-28} text="+5" fill="#dc2626" size={9} weight={800} />
        </>
      )}
      <Label x={124} y={-90} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      <SideNotes x={124} lines={[p.name, `SV ${sv}℃${typeof p.alarm === 'number' ? ` · AL ${p.alarm}℃` : ''}`, p.tcMode === 'cool' ? tr('냉각 동작', 'cooling') : tr('가열 동작', 'heating')]} c={c} />
      {t && !st.on && <Label x={124} y={40} text={tr('전원 없음', 'No power')} anchor="start" size={9} weight={700} fill="#dc2626" />}
    </g>
  );
}

/**
 * 판넬 서모스탯 (바이메탈, 레일 장착): 설정 다이얼, 아래 단자 1 · 2. NC (빨간 다이얼, 히터: 오르면 열림) · NO (파란 다이얼, 팬: 오르면 닫힘).
 * 시뮬레이션 중에는 왼쪽 · 오른쪽을 눌러 온도를 5℃ 내리고 올린다
 */
export function ThermoGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const t = st.temp;
  const { sv } = tempSetting(p);
  const nc = !!p.ncOut;
  const ring = nc ? '#dc2626' : '#2563eb';
  // 다이얼 눈금 0 ~ 60℃ (270°)
  const ang = (v: number) => {
    const a = ((-135 + 270 * Math.min(1, Math.max(0, v / 60))) * Math.PI) / 180;
    return [16 * Math.sin(a), -26 - 16 * Math.cos(a)];
  };
  const [px, py] = ang(sv);
  return (
    <g>
      <rect x={-44} y={-76} width={88} height={146} rx={6} fill="#f8fafc" stroke={BODY_EDGE} />
      <rect x={-44} y={34} width={88} height={36} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <circle cx={0} cy={-26} r={24} fill="#ffffff" stroke={ring} strokeWidth={3} />
      {[0, 10, 20, 30, 40, 50, 60].map((v) => {
        const [x, y] = ang(v);
        return <circle key={v} cx={x * 1.3} cy={-26 + (y + 26) * 1.3} r={1.2} fill="#64748b" />;
      })}
      <path d={`M0,-26L${px},${py}`} stroke="#111827" strokeWidth={3} strokeLinecap="round" />
      <circle cx={0} cy={-26} r={4} fill="#334155" />
      <Label x={0} y={12} text={`${sv}℃`} fill="#111827" size={11} weight={800} />
      <Label x={0} y={26} text={nc ? tr('NC 히터', 'NC heater') : tr('NO 팬', 'NO fan')} fill={ring} size={8} weight={800} />
      <Screw x={-20} y={58} ring="grey" />
      <Screw x={20} y={58} ring="grey" />
      <Label x={-34} y={50} text="1" size={8.5} weight={800} />
      <Label x={34} y={50} text="2" size={8.5} weight={800} />
      {t && (
        <>
          <Label x={-36} y={-58} text="−5" fill="#2563eb" size={9} weight={800} />
          <Label x={36} y={-58} text="+5" fill="#dc2626" size={9} weight={800} />
        </>
      )}
      <Label x={52} y={-62} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      <SideNotes x={52} lines={[p.name, t && `${tempText(t.pv)}℃ · ${st.closed ? tr('닫힘', 'closed') : tr('열림', 'open')}`]} c={c} />
    </g>
  );
}

/** SSR: 방열판 위의 몸통, 위 1 · 2 (출력), 아래 3 + · 4 - (입력). 입력이 들어오면 LED */
export function SsrGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const on = st.on;
  return (
    <g>
      <rect x={-52} y={-84} width={104} height={168} rx={3} fill="#cbd5e1" stroke="#94a3b8" />
      {Array.from({ length: 6 }, (_, k) => (
        <path key={k} d={`M${-46 + k * 18.4},-84V84`} stroke="#94a3b8" strokeWidth={1} />
      ))}
      <rect x={-38} y={-78} width={76} height={156} rx={4} fill="#111827" stroke="#374151" />
      <Label x={-20} y={-38} text="1" fill="#f9fafb" size={8} weight={800} />
      <Label x={20} y={-38} text="2" fill="#f9fafb" size={8} weight={800} />
      <Label x={0} y={-24} text="LOAD AC" fill="#9ca3af" size={6.5} weight={700} />
      <Label x={0} y={2} text="SSR" fill="#e5e7eb" size={12} weight={800} />
      <circle cx={0} cy={16} r={4} fill={on ? '#ef4444' : '#4b5563'} />
      <Label x={0} y={33} text="INPUT DC" fill="#9ca3af" size={6.5} weight={700} />
      <Label x={-20} y={46} text="3 +" fill="#fca5a5" size={8} weight={800} />
      <Label x={20} y={46} text="4 −" fill="#93c5fd" size={8} weight={800} />
      <Screw x={-20} y={-60} />
      <Screw x={20} y={-60} />
      <Screw x={-20} y={60} ring="yellow" />
      <Screw x={20} y={60} ring="yellow" />
      <Label x={58} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      {p.name && <Label x={58} y={-53} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/** 2선식 근접 센서: 원통 몸통에 갈색 · 파랑 두 선. 부하와 직렬로 (스위치처럼) 잇는다 */
export function Prox2Glyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const on = st.act;
  const leads: [number, string, string][] = [
    [-20, '#92400e', p.ac ? tr('갈', 'BN') : tr('갈 +', 'BN +')],
    [20, '#2563eb', p.ac ? tr('청', 'BU') : tr('청 -', 'BU -')],
  ];
  return (
    <g>
      {leads.map(([x, col, t]) => (
        <g key={x}>
          <path d={`M0,-8C0,20 ${x},16 ${x},46`} stroke="#00000040" strokeWidth={5.4} fill="none" />
          <path d={`M0,-8C0,20 ${x},16 ${x},46`} stroke={col} strokeWidth={3.6} fill="none" />
          <rect x={x - 3} y={44} width={6} height={12} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.8} />
          <circle cx={x} cy={60} r={5} fill={col} stroke="#ffffff" strokeWidth={1.2} />
          <Label x={x} y={76} text={t} size={7} weight={700} fill={c.muted} />
        </g>
      ))}
      <rect x={-14} y={-78} width={28} height={12} rx={2} fill={p.ac ? '#a3e635' : '#f97316'} stroke="#7c2d12" strokeWidth={0.8} />
      <rect x={-14} y={-66} width={28} height={46} fill="#9ca3af" stroke="#4b5563" />
      {[-60, -52, -44, -36, -28].map((y) => (
        <path key={y} d={`M-14,${y}H14`} stroke="#4b5563" strokeWidth={1} />
      ))}
      <rect x={-18} y={-40} width={36} height={8} fill="#d1d5db" stroke="#6b7280" />
      <rect x={-12} y={-20} width={24} height={12} rx={2} fill="#1f2937" />
      {on && <path d="M-12,-84Q0,-94 12,-84M-18,-90Q0,-104 18,-90" stroke="#f97316" strokeWidth={1.6} fill="none" />}
      <circle cx={0} cy={-14} r={3.4} fill={on ? '#ef4444' : '#6b7280'} stroke="#111827" strokeWidth={0.8} />
      <Label x={24} y={-66} text={p.tag} anchor="start" size={11} weight={800} fill={c.ink} />
      <Label x={24} y={-53} text={`${tr('2선식', '2-wire')} · ${p.ac ? 'AC 100-240V' : 'DC 12-24V'} · ${p.ncOut ? 'NC' : 'NO'}`} anchor="start" size={8.5} weight={600} fill={c.muted} />
      {p.name && <Label x={24} y={-41} text={p.name} anchor="start" size={9} weight={500} fill={c.muted} />}
    </g>
  );
}

/**
 * PLC (실물, 입력 16 · 릴레이 출력 16): 위 단자대 + · − · FG · COM · 입력, 아래 단자대 COM0 · 출력 0~7 · COM1 · 출력 8~15.
 * 입력 · 출력 LED, 앞면 PWR · RUN 램프
 */
export function RPlcGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const { ins, outs } = plcAddresses(p);
  const run = !!st.plcRun;
  const x0 = -470;
  const x1 = 410;
  const ix = (n: number) => (-13 + 2 * n) * 20;
  const ox = (n: number) => (n < 8 ? -13 + 2 * n : 5 + 2 * (n - 8)) * 20;
  return (
    <g>
      <rect x={x0} y={-120} width={x1 - x0} height={240} rx={8} fill="#d1d5db" stroke={BODY_EDGE} />
      <rect x={x0} y={-120} width={x1 - x0} height={44} rx={4} fill={BAND} stroke={BODY_EDGE} />
      <rect x={x0} y={76} width={x1 - x0} height={44} rx={4} fill={BAND} stroke={BODY_EDGE} />
      {/* 위 단자대: 전원 · 입력 */}
      {[
        [-440, '+', 'orange'],
        [-400, '−', 'orange'],
        [-360, 'FG', 'green'],
        [-300, 'COM', 'grey'],
      ].map(([x, t, ring]) => (
        <g key={t as string}>
          <Screw x={x as number} y={-100} ring={ring as Ring} />
          <Label x={x as number} y={-80} text={t as string} size={8} weight={800} />
        </g>
      ))}
      <Label x={-400} y={-64} text="DC 24V" size={7.5} weight={700} fill="#475569" />
      {ins.map((a, n) => (
        <g key={a}>
          <Screw x={ix(n)} y={-100} ring="grey" />
          <Label x={ix(n)} y={-80} text={a} size={7} weight={700} />
          <rect x={ix(n) - 6} y={-70} width={12} height={7} rx={1.5} fill={st.plcIn?.[n] ? '#22c55e' : '#94a3b8'} stroke={st.plcIn?.[n] ? '#15803d' : '#64748b'} strokeWidth={0.8} />
        </g>
      ))}
      {/* 아래 단자대: 출력 공통과 출력 */}
      {[
        [-300, 'COM0'],
        [60, 'COM1'],
      ].map(([x, t]) => (
        <g key={t}>
          <Screw x={x as number} y={100} ring="grey" />
          <Label x={x as number} y={86} text={t as string} size={7.5} weight={800} />
        </g>
      ))}
      {outs.map((a, n) => (
        <g key={a}>
          <Screw x={ox(n)} y={100} ring="grey" />
          <Label x={ox(n)} y={86} text={a} size={7} weight={700} />
          <rect x={ox(n) - 6} y={63} width={12} height={7} rx={1.5} fill={st.plcOut?.[n] ? '#f59e0b' : '#94a3b8'} stroke={st.plcOut?.[n] ? '#b45309' : '#64748b'} strokeWidth={0.8} />
        </g>
      ))}
      {/* 앞면: CPU · 상태 램프 */}
      <rect x={-458} y={-54} width={150} height={108} rx={5} fill="#334155" stroke="#1e293b" />
      <Label x={-446} y={-32} text={p.tag || 'PLC'} anchor="start" fill="#f8fafc" size={14} weight={800} />
      <Label x={-446} y={-16} text={p.name || 'CPU'} anchor="start" fill="#cbd5e1" size={8.5} weight={600} />
      {[
        ['PWR', !!st.powered, '#22c55e'],
        ['RUN', run, '#22c55e'],
        ['ERR', !!st.plcErr, '#ef4444'],
      ].map(([t, on, col], k) => (
        <g key={t as string}>
          <circle cx={-440 + 44 * k} cy={10} r={6} fill={on ? (col as string) : '#475569'} stroke="#0f172a" />
          <Label x={-440 + 44 * k} y={28} text={t as string} fill="#cbd5e1" size={7.5} weight={700} />
        </g>
      ))}
      <Label x={-446} y={46} text={tr('입력 16 · 릴레이 출력 16', '16 in · 16 relay out')} anchor="start" fill="#94a3b8" size={7} weight={600} />
      <rect x={-290} y={-54} width={690} height={108} rx={4} fill="#e5e7eb" stroke="#cbd5e1" />
      <Label x={-280} y={-38} text={tr('입력 (COM 과 반대 극이 닿으면 ON)', 'Inputs (ON when the opposite pole of COM is applied)')} anchor="start" fill="#64748b" size={7.5} weight={700} />
      <Label x={-280} y={46} text={tr('릴레이 출력 (COM0: 0~7 · COM1: 8~15, 접점 2A)', 'Relay outputs (COM0: 0–7 · COM1: 8–15, 2 A contacts)')} anchor="start" fill="#64748b" size={7.5} weight={700} />
      {st.plcIn && !st.powered && <Label x={60} y={6} text={tr('전원 없음 (정지)', 'No power (stopped)')} fill="#dc2626" size={12} weight={800} />}
      <path d={`M${x1 - 6},-20v40`} stroke={c.muted} strokeWidth={0.8} />
    </g>
  );
}

/** HMI (터치 판넬): 화면 버튼 · 스위치 · 램프, 아래 전원 단자 + · − · FG */
export function HmiGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const items = p.hmi ?? [];
  const h = st.hmi;
  const online = !h || h.online;
  return (
    <g>
      <rect x={-180} y={-150} width={360} height={290} rx={10} fill="#1f2937" stroke="#111827" />
      <rect x={-172} y={-146} width={344} height={26} rx={4} fill="#0f172a" />
      <Label x={-162} y={-128} text={`${p.tag || 'HMI'}${p.name ? `  ${p.name}` : ''}`} anchor="start" fill="#e2e8f0" size={10} weight={800} />
      <Label x={162} y={-128} text={!h ? 'HMI' : h.online ? tr('통신 정상', 'Online') : h.powered ? tr('통신 이상', 'No PLC') : tr('전원 없음', 'No power')} anchor="end" fill={!h || h.online ? '#4ade80' : '#f87171'} size={8.5} weight={700} />
      <rect x={-172} y={-114} width={344} height={212} rx={4} fill={h && !h.powered ? '#0b1120' : '#e2e8f0'} stroke="#475569" />
      {hmiCells(p).map((cell) => {
        const it = items[cell.n];
        const x = cell.x * 20;
        const y = cell.y * 20;
        const w = cell.w * 20;
        const hh = cell.h * 20;
        const bit = h?.bits[cell.n] ?? false;
        const pressed = h?.pressed[cell.n] ?? false;
        if (h && !h.powered) return null;
        if (it.kind === 'lamp') {
          const col = LAMP_HEX[it.color ?? 'green'];
          return (
            <g key={cell.n}>
              <circle cx={x + 16} cy={y + hh / 2} r={10} fill={bit && online ? col : '#cbd5e1'} stroke="#475569" />
              <Label x={x + 32} y={y + hh / 2 + 4} text={it.label} anchor="start" size={9} weight={700} fill="#0f172a" />
            </g>
          );
        }
        const lit = it.kind === 'sw' ? bit && online : pressed;
        const col = LAMP_HEX[it.color ?? (it.kind === 'sw' ? 'green' : 'blue')];
        return (
          <g key={cell.n}>
            <rect x={x} y={y} width={w} height={hh} rx={6} fill={lit ? col : '#f8fafc'} stroke={pressed ? '#0f172a' : '#64748b'} strokeWidth={pressed ? 2.4 : 1.2} />
            <rect x={x + 2} y={y + hh - 5} width={w - 4} height={3} rx={1.5} fill={pressed ? 'none' : '#cbd5e1'} />
            <Label x={x + w / 2} y={y + hh / 2 + 4} text={it.label} size={9.5} weight={800} fill={lit ? '#fff' : '#0f172a'} />
          </g>
        );
      })}
      {!items.length && <Label x={0} y={-10} text={tr('속성에서 버튼 · 램프를 넣으세요', 'Add buttons and lamps in Properties')} size={9} fill="#64748b" />}
      <rect x={-70} y={104} width={140} height={34} rx={4} fill={BAND} stroke={BODY_EDGE} />
      {[
        [-40, '+', 'orange'],
        [0, '−', 'orange'],
        [40, 'FG', 'green'],
      ].map(([x, t, ring]) => (
        <g key={t as string}>
          <Screw x={x as number} y={120} ring={ring as Ring} />
          <Label x={(x as number) + 13} y={112} text={t as string} anchor="start" size={7} weight={800} />
        </g>
      ))}
      <Label x={-76} y={124} text="DC 24V" anchor="end" fill={c.muted} size={7.5} weight={700} />
    </g>
  );
}
