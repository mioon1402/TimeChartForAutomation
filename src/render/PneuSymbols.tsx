import type { ReactNode } from 'react';
import type { Part } from '../circuit/types';
import type { CircuitColors, PartState } from './CircuitSvg';

/** 공압 배관 색 (압력이 있으면 진하게) */
export const TUBE = '#0891b2';
export const TUBE_P = '#0ea5e9';

function Arrow({ x1, y1, x2, y2, c }: { x1: number; y1: number; x2: number; y2: number; c: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = 7;
  const p1 = [x2 - h * Math.cos(a - 0.4), y2 - h * Math.sin(a - 0.4)];
  const p2 = [x2 - h * Math.cos(a + 0.4), y2 - h * Math.sin(a + 0.4)];
  return (
    <g>
      <path d={`M${x1},${y1}L${x2},${y2}`} stroke={c} />
      <path d={`M${x2},${y2}L${p1[0]},${p1[1]}L${p2[0]},${p2[1]}Z`} fill={c} stroke="none" />
    </g>
  );
}

/** 막힌 포트 (ㅗ) */
function Block({ x, y, dir, c }: { x: number; y: number; dir: 1 | -1; c: string }) {
  return <path d={`M${x},${y}v${dir * 8}m-5,0h10`} stroke={c} />;
}

/** 밸브 한 칸 (왼쪽 x0, 폭 80) 안의 통로 */
function ValveBox({ type, box, x0, c, active }: { type: Part['type']; box: 'a' | 'b' | 'c'; x0: number; c: CircuitColors; active: boolean }) {
  const ink = active ? c.accent : c.ink;
  const at = (x: number) => x0 + x;
  let body: ReactNode;
  if (type === 'v32') {
    body =
      box === 'a' ? (
        <>
          <Arrow x1={at(20)} y1={20} x2={at(20)} y2={-20} c={ink} />
          <Block x={at(60)} y={20} dir={-1} c={ink} />
        </>
      ) : (
        <>
          <Arrow x1={at(20)} y1={-20} x2={at(60)} y2={20} c={ink} />
          <Block x={at(20)} y={20} dir={-1} c={ink} />
        </>
      );
  } else if (box === 'a') {
    body = (
      <>
        <Arrow x1={at(40)} y1={20} x2={at(20)} y2={-20} c={ink} />
        <Arrow x1={at(60)} y1={-20} x2={at(60)} y2={20} c={ink} />
      </>
    );
  } else if (box === 'b') {
    body = (
      <>
        <Arrow x1={at(40)} y1={20} x2={at(60)} y2={-20} c={ink} />
        <Arrow x1={at(20)} y1={-20} x2={at(20)} y2={20} c={ink} />
      </>
    );
  } else {
    body = (
      <>
        <Block x={at(20)} y={-20} dir={1} c={ink} />
        <Block x={at(60)} y={-20} dir={1} c={ink} />
        <Block x={at(40)} y={20} dir={-1} c={ink} />
      </>
    );
  }
  return (
    <g>
      <rect x={x0} y={-20} width={80} height={40} fill={active ? c.fillOn : c.bg} fillOpacity={active ? 0.45 : 1} stroke={c.ink} strokeWidth={active ? 2 : 1.5} />
      {body}
    </g>
  );
}

function Solenoid({ x, side, on, label, c }: { x: number; side: -1 | 1; on: boolean; label?: string; c: CircuitColors }) {
  const x0 = side < 0 ? x - 18 : x;
  return (
    <g>
      <rect x={x0} y={-10} width={18} height={20} fill={on ? c.fillOn : c.bg} stroke={on ? c.accent : c.ink} strokeWidth={on ? 2 : 1.5} />
      <path d={`M${x0},10L${x0 + 18},-10`} stroke={c.ink} strokeWidth={1.2} />
      {label && (
        <text x={x0 + 9} y={-24} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={on ? c.accent : c.muted} stroke="none">
          {label}
        </text>
      )}
    </g>
  );
}

function Spring({ x, side, c }: { x: number; side: -1 | 1; c: CircuitColors }) {
  const s = side;
  return <path d={`M${x},0l${s * 3},-8l${s * 4},16l${s * 4},-16l${s * 4},16l${s * 3},-8`} stroke={c.ink} fill="none" strokeWidth={1.3} />;
}

/** 솔레노이드 밸브: 지금 위치의 칸이 포트(가운데)에 오도록 칸들이 옆으로 움직인다 */
export function ValveGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const boxes: ('a' | 'b' | 'c')[] = p.type === 'v53' ? ['a', 'c', 'b'] : ['a', 'b'];
  const pos = st.valve ?? (p.type === 'v53' ? 'c' : 'b');
  const cur = boxes.indexOf(pos);
  const x0 = (i: number) => -40 + (i - cur) * 80;
  const left = x0(0);
  const right = x0(boxes.length - 1) + 80;
  const [onA, onB] = st.solOn ?? [false, false];
  const double = p.type === 'v52d' || p.type === 'v53';
  const ports = p.type === 'v32' ? { top: [-20], bottom: [-20], ex: [20] } : { top: [-20, 20], bottom: [0], ex: [-20, 20] };
  return (
    <g>
      {ports.top.map((x) => (
        <path key={`t${x}`} d={`M${x},-40V-20`} stroke={TUBE} strokeWidth={1.8} />
      ))}
      {ports.bottom.map((x) => (
        <path key={`b${x}`} d={`M${x},40V20`} stroke={TUBE} strokeWidth={1.8} />
      ))}
      {ports.ex.map((x) => (
        <path key={`e${x}`} d={`M${x},20v6M${x - 5},26h10l-5,8z`} stroke={c.ink} fill="none" strokeWidth={1.2} />
      ))}
      {boxes.map((b, i) => (
        <ValveBox key={b} type={p.type} box={b} x0={x0(i)} c={c} active={i === cur} />
      ))}
      {p.type === 'v53' && <Spring x={left} side={-1} c={c} />}
      <Solenoid x={p.type === 'v53' ? left - 18 : left} side={-1} on={onA} label={p.solA} c={c} />
      {double ? (
        <>
          {p.type === 'v53' && <Spring x={right} side={1} c={c} />}
          <Solenoid x={p.type === 'v53' ? right + 18 : right} side={1} on={onB} label={p.solB} c={c} />
        </>
      ) : (
        <Spring x={right} side={1} c={c} />
      )}
    </g>
  );
}

export function AirSupplyGlyph({ c }: { c: CircuitColors }) {
  return (
    <g>
      <path d="M0,10V20" stroke={TUBE} strokeWidth={1.8} />
      <circle r={10} fill={c.bg} stroke={c.ink} />
      <path d="M0,-6L6,4H-6Z" fill={c.ink} stroke="none" />
      <text x={14} y={4} fontSize={10} fontWeight={700} fill={TUBE} stroke="none">
        P
      </text>
    </g>
  );
}

export function FrlGlyph({ c }: { c: CircuitColors }) {
  return (
    <g>
      <path d="M0,-40V-18M0,18V40" stroke={TUBE} strokeWidth={1.8} />
      <rect x={-24} y={-18} width={48} height={36} fill={c.bg} stroke={c.muted} strokeDasharray="6 2 2 2" />
      <path d="M0,-18V18" stroke={c.ink} />
      <path d="M-9,-8L0,-17L9,-8L0,1Z" fill={c.bg} stroke={c.ink} />
      <path d="M0,-15V-1" stroke={c.ink} strokeDasharray="2 2" />
      <rect x={-6} y={4} width={12} height={10} fill={c.bg} stroke={c.ink} />
      <path d="M-8,16L8,2" stroke={c.ink} />
      <circle cx={16} cy={9} r={5} fill={c.bg} stroke={c.ink} />
      <path d="M6,9H11M16,9l2,-3" stroke={c.ink} strokeWidth={1} />
    </g>
  );
}

/** 한쪽 방향 속도 제어 밸브: 교축 + 체크 밸브 */
export function FlowCtrlGlyph({ c }: { c: CircuitColors }) {
  return (
    <g>
      <path d="M0,-40V-12M0,12V40" stroke={TUBE} strokeWidth={1.8} />
      <path d="M-6,-12Q0,0 -6,12M6,-12Q0,0 6,12" stroke={c.ink} fill="none" />
      <Arrow x1={-12} y1={11} x2={12} y2={-11} c={c.ink} />
      <path d="M0,-24H20V24H0" stroke={TUBE} fill="none" strokeWidth={1.4} />
      <circle cx={20} cy={4} r={4} fill={c.bg} stroke={c.ink} />
      <path d="M15,-4L20,1L25,-4" stroke={c.ink} fill="none" />
    </g>
  );
}

/** 3선식 센서: 갈색(+) 위, 검정(출력) 아래, 파랑(0V) 오른쪽 아래 */
export function ProxGlyph({ p, st, c }: { p: Part; st: PartState; c: CircuitColors }) {
  const out = st.act && !!st.powered;
  return (
    <g>
      <path d="M0,-40V-14" stroke="#92400e" strokeWidth={1.8} />
      <path d="M0,14V40" stroke={c.ink} strokeWidth={1.8} />
      <path d="M14,6H40V40" stroke="#2563eb" strokeWidth={1.8} fill="none" />
      <rect x={-14} y={-14} width={28} height={28} fill={st.act ? c.fillOn : c.bg} stroke={c.ink} />
      {p.sense === 'photo' ? (
        <g stroke={c.ink} fill="none">
          <path d="M-9,-6L-1,0M-9,0L-1,6" />
          <circle cx={4} cy={1} r={4} />
        </g>
      ) : (
        <g stroke={c.ink} fill="none">
          <path d="M0,-8L7,0L0,8L-7,0Z" />
          {p.sense === 'capacitive' && <path d="M-3,-3V3M3,-3V3" />}
        </g>
      )}
      <circle cx={18} cy={-16} r={4} fill={out ? '#f59e0b' : 'none'} stroke={out ? '#d97706' : c.muted} />
      <text x={0} y={24} textAnchor="middle" fontSize={7.5} fill={c.muted} stroke="none">
        {p.npn ? 'NPN' : 'PNP'}
      </text>
    </g>
  );
}

export function SmpsGlyph({ st, c }: { st: PartState; c: CircuitColors }) {
  return (
    <g>
      <path d="M-20,-40V-22M20,-40V-22" stroke={c.ink} />
      <path d="M-20,40V22" stroke="#dc2626" strokeWidth={1.8} />
      <path d="M20,40V22" stroke="#2563eb" strokeWidth={1.8} />
      <rect x={-32} y={-22} width={64} height={44} rx={3} fill={st.powered ? c.fillOn : c.bg} stroke={c.ink} strokeWidth={1.6} />
      <text y={-2} textAnchor="middle" fontSize={11} fontWeight={800} fill={c.ink} stroke="none">
        SMPS
      </text>
      <text y={12} textAnchor="middle" fontSize={8.5} fill={c.muted} stroke="none">
        AC→DC24V
      </text>
      <g fontSize={8} fill={c.muted} stroke="none" textAnchor="middle">
        <text x={-20} y={-12}>L</text>
        <text x={20} y={-12}>N</text>
        <text x={-20} y={19}>+</text>
        <text x={20} y={19}>−</text>
      </g>
      <circle cx={25} cy={-15} r={3} fill={st.powered ? '#22c55e' : 'none'} stroke={st.powered ? '#16a34a' : c.muted} />
    </g>
  );
}
