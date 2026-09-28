import type { ReactNode } from 'react';
import type { Annotation, Project, Signal, WavePoint } from '../model/types';
import type { Violation } from '../model/analysis';
import { effectivePoints, isHigh, isLow } from '../model/wave';
import { formatTime, niceStep } from '../model/format';
import { FONT, MONO, type ChartColors, type ChartLayout, type RowLayout } from './layout';

export interface ViewProps {
  project: Project;
  layout: ChartLayout;
  /** px / ms */
  px: number;
  /** 표시 시간 범위 */
  t0: number;
  t1: number;
  colors: ChartColors;
  /** SVG id 충돌 방지 접두어 */
  idp: string;
  grayscale?: boolean;
}

export interface EditorOverlayProps {
  selectedSignals?: Set<string>;
  selectedAnnotation?: string | null;
  selectedStep?: string | null;
  range?: { t0: number; t1: number } | null;
  cursorA?: number | null;
  cursorB?: number | null;
  violations?: Violation[];
  hoverEdge?: { signalId: string; index: number } | null;
  interactive?: boolean;
}

const GRAY = '#374151';

export function sigColor(s: Signal, gray?: boolean): string {
  return gray ? GRAY : s.color;
}

/** 대략적인 글자 폭 (한글은 넓게) */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef))) w += size * 0.98;
    else if (/[A-Z0-9%#@MW]/.test(ch)) w += size * 0.66;
    else w += size * 0.54;
  }
  return w;
}

export function fitText(s: string, maxW: number, size: number): string {
  if (textWidth(s, size) <= maxW) return s;
  let out = s;
  while (out.length > 0 && textWidth(out + '…', size) > maxW) out = out.slice(0, -1);
  return out ? out + '…' : '';
}

function unitFor(project: Project): 'ms' | 's' {
  const u = project.settings.timeUnit;
  if (u === 'auto') return project.settings.duration >= 10000 ? 's' : 'ms';
  return u;
}

export function tickLabel(t: number, project: Project): string {
  return formatTime(t, unitFor(project), false);
}

export function rulerUnit(project: Project): string {
  return unitFor(project);
}

// ─────────────────────────── 헤더 (스텝 + 눈금자) ───────────────────────────

export function HeaderLayer(props: ViewProps & EditorOverlayProps & { width: number }) {
  const { project, layout, px, t0, t1, colors, width } = props;
  const x = (t: number) => (t - t0) * px;
  const major = niceStep(px, 64);
  const minorDiv = major * px >= 120 ? 10 : major * px >= 50 ? 5 : 2;
  const minor = major / minorDiv;
  const ticks: ReactNode[] = [];
  const start = Math.floor(t0 / minor) * minor;
  const yR = layout.stepsH;
  for (let t = start, i = 0; t <= t1 + 1e-9 && i < 5000; t += minor, i++) {
    const tt = Math.round(t * 1e6) / 1e6;
    if (tt < t0 - 1e-9) continue;
    const isMajor = Math.abs(tt / major - Math.round(tt / major)) < 1e-6;
    const xx = x(tt);
    ticks.push(<line key={`t${i}`} x1={xx} x2={xx} y1={yR + layout.rulerH - (isMajor ? 9 : 4)} y2={yR + layout.rulerH} stroke={colors.muted} strokeWidth={isMajor ? 1 : 0.6} />);
    if (isMajor)
      ticks.push(
        <text key={`l${i}`} x={xx + 3} y={yR + 12} fontSize={10} fill={colors.muted} fontFamily={FONT}>
          {tickLabel(tt, project)}
        </text>,
      );
  }
  const steps = project.steps.filter((s) => s.end > t0 && s.start < t1);
  return (
    <g fontFamily={FONT}>
      <rect x={0} y={0} width={width} height={layout.headerH} fill={colors.bg} />
      {layout.stepsH > 0 &&
        steps.map((s) => {
          const xs = Math.max(0, x(s.start));
          const xe = Math.min(width, x(s.end));
          const w = xe - xs;
          const sel = props.selectedStep === s.id;
          return (
            <g key={s.id} data-step-id={props.interactive ? s.id : undefined} style={props.interactive ? { cursor: 'pointer' } : undefined}>
              <rect x={xs} y={2} width={Math.max(w, 0)} height={layout.stepsH - 4} rx={3} fill={props.grayscale ? '#f3f4f6' : s.color ?? '#e5e7eb'} stroke={sel ? colors.selection : colors.gridMajor} strokeWidth={sel ? 2 : 1} />
              {w > 14 && (
                <text x={xs + w / 2} y={layout.stepsH / 2 + 4} fontSize={11} fontWeight={600} textAnchor="middle" fill="#1f2937">
                  {fitText(s.label, w - 6, 11)}
                </text>
              )}
            </g>
          );
        })}
      <line x1={0} x2={width} y1={yR + layout.rulerH - 0.5} y2={yR + layout.rulerH - 0.5} stroke={colors.gridMajor} />
      {ticks}
      {project.annotations.map((a) =>
        a.type === 'marker' && a.t >= t0 && a.t <= t1 ? (
          <g key={a.id} data-ann-id={props.interactive ? a.id : undefined} style={props.interactive ? { cursor: 'ew-resize' } : undefined}>
            <path d={`M${x(a.t) - 5},${yR + 14} h10 v6 l-5,5 l-5,-5 z`} fill={props.grayscale ? GRAY : a.color ?? '#16a34a'} stroke={props.selectedAnnotation === a.id ? colors.selection : 'none'} strokeWidth={2} />
          </g>
        ) : null,
      )}
      {props.cursorA != null && <CursorFlag x={x(props.cursorA)} y={yR} label="A" color="#2563eb" />}
      {props.cursorB != null && <CursorFlag x={x(props.cursorB)} y={yR} label="B" color="#db2777" />}
    </g>
  );
}

function CursorFlag({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x - 7} y={y + 1} width={14} height={13} rx={2} fill={color} />
      <text x={x} y={y + 11} fontSize={10} fontWeight={700} textAnchor="middle" fill="#fff">
        {label}
      </text>
    </g>
  );
}

// ─────────────────────────── 본문 (행, 파형, 주석) ───────────────────────────

interface Vertex {
  x: number;
  y: number;
}

function levelY(v: WavePoint['v'], yHi: number, yLo: number): number {
  if (isHigh(v)) return yHi;
  if (isLow(v)) return yLo;
  return (yHi + yLo) / 2;
}

function bitVertices(pts: WavePoint[], x: (t: number) => number, yHi: number, yLo: number, tEnd: number): Vertex[] {
  const V: Vertex[] = [{ x: x(0), y: levelY(pts[0].v, yHi, yLo) }];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.t > tEnd) break;
    const yPrev = levelY(pts[i - 1].v, yHi, yLo);
    const yNew = levelY(p.v, yHi, yLo);
    V.push({ x: x(p.t), y: yPrev });
    V.push({ x: x(Math.min(p.t + (p.ramp ?? 0), tEnd)), y: yNew });
  }
  V.push({ x: x(tEnd), y: V[V.length - 1].y });
  return V;
}

function pathOf(V: Vertex[]): string {
  return V.map((v, i) => `${i ? 'L' : 'M'}${v.x.toFixed(2)},${v.y.toFixed(2)}`).join('');
}

function BitWave({ s, row, x, tEnd, colors, fill, gray, showTimes, project, idp }: { s: Signal; row: RowLayout; x: (t: number) => number; tEnd: number; colors: ChartColors; fill: boolean; gray?: boolean; showTimes: boolean; project: Project; idp: string }) {
  const pad = Math.max(5, row.h * 0.2);
  const yHi = row.y + pad;
  const yLo = row.y + row.h - pad;
  const pts = effectivePoints(s, tEnd);
  const V = bitVertices(pts, x, yHi, yLo, tEnd);
  const col = sigColor(s, gray);
  const fillD = `M${V[0].x},${yLo}` + V.map((v) => `L${v.x.toFixed(2)},${v.y.toFixed(2)}`).join('') + `L${V[V.length - 1].x},${yLo}Z`;
  const unknown: ReactNode[] = [];
  pts.forEach((p, i) => {
    if (p.v !== 'x' && p.v !== 'z') return;
    const te = i + 1 < pts.length ? pts[i + 1].t : tEnd;
    if (p.v === 'x')
      unknown.push(<rect key={i} x={x(p.t)} y={yHi} width={Math.max(0, x(te) - x(p.t))} height={yLo - yHi} fill={`url(#${idp}-hatch)`} stroke={col} strokeWidth={1} />);
  });
  const times: ReactNode[] = [];
  if (showTimes) {
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.t > tEnd) break;
      times.push(
        <text key={i} x={x(p.t) + 2} y={isHigh(p.v) ? yHi - 2 : yLo - 3} fontSize={8.5} fill={colors.muted} fontFamily={FONT}>
          {tickLabel(p.t, project)}
        </text>,
      );
    }
  }
  return (
    <g opacity={s.hidden ? 0.45 : 1}>
      {fill && <path d={fillD} fill={col} opacity={s.role === 'actuator' ? 0.2 : 0.13} />}
      {unknown}
      <path d={pathOf(V)} fill="none" stroke={col} strokeWidth={s.role === 'actuator' ? 2.2 : 1.7} strokeLinejoin="round" />
      {times}
    </g>
  );
}

function BusWave({ s, row, x, tEnd, gray, idp }: { s: Signal; row: RowLayout; x: (t: number) => number; tEnd: number; colors: ChartColors; gray?: boolean; idp: string }) {
  const pad = Math.max(5, row.h * 0.18);
  const yHi = row.y + pad;
  const yLo = row.y + row.h - pad;
  const ym = (yHi + yLo) / 2;
  const col = sigColor(s, gray);
  const pts = s.points;
  const out: ReactNode[] = [];
  for (let i = 0; i < pts.length; i++) {
    const ts = pts[i].t;
    if (ts >= tEnd) break;
    const te = Math.min(i + 1 < pts.length ? pts[i + 1].t : tEnd, tEnd);
    const xs = x(ts);
    const xe = x(te);
    const w = xe - xs;
    const k = Math.min(4, w / 2);
    const v = String(pts[i].v);
    const isX = v === 'x' || v === 'X';
    const isZ = v === 'z' || v === 'Z';
    if (isZ) {
      out.push(<line key={i} x1={xs} x2={xe} y1={ym} y2={ym} stroke={col} strokeWidth={1.4} />);
      continue;
    }
    const d = `M${xs},${ym}L${xs + k},${yHi}L${xe - k},${yHi}L${xe},${ym}L${xe - k},${yLo}L${xs + k},${yLo}Z`;
    out.push(<path key={`p${i}`} d={d} fill={isX ? `url(#${idp}-hatch)` : col} fillOpacity={isX ? 1 : v === '0' ? 0.04 : 0.12} stroke={col} strokeWidth={1.4} strokeLinejoin="round" />);
    if (!isX && w > 12) {
      const size = Math.min(11, row.h * 0.36);
      const label = fitText(v, w - 2 * k - 4, size);
      if (label)
        out.push(
          <text key={`t${i}`} x={(xs + xe) / 2} y={ym + size * 0.36} fontSize={size} textAnchor="middle" fill={gray ? '#111827' : col} fontFamily={FONT} fontWeight={600}>
            {label}
          </text>,
        );
    }
  }
  return <g opacity={s.hidden ? 0.45 : 1}>{out}</g>;
}

function AnalogWave({ s, row, x, tEnd, colors, gray }: { s: Signal; row: RowLayout; x: (t: number) => number; tEnd: number; colors: ChartColors; gray?: boolean }) {
  const pad = 5;
  const yHi = row.y + pad;
  const yLo = row.y + row.h - pad;
  const min = s.analogMin ?? 0;
  const max = s.analogMax ?? 10;
  const span = max - min || 1;
  const y = (v: number) => yLo - ((Math.min(Math.max(v, min), max) - min) / span) * (yLo - yHi);
  const pts = s.points.filter((p) => p.t <= tEnd);
  const V: Vertex[] = pts.map((p) => ({ x: x(p.t), y: y(Number(p.v)) }));
  if (V.length) V.push({ x: x(tEnd), y: V[V.length - 1].y });
  const col = sigColor(s, gray);
  const fillD = V.length ? `M${V[0].x},${yLo}` + V.map((v) => `L${v.x.toFixed(2)},${v.y.toFixed(2)}`).join('') + `L${V[V.length - 1].x},${yLo}Z` : '';
  return (
    <g opacity={s.hidden ? 0.45 : 1}>
      <line x1={x(0)} x2={x(tEnd)} y1={yLo} y2={yLo} stroke={colors.grid} />
      <path d={fillD} fill={col} opacity={0.1} />
      <path d={pathOf(V)} fill="none" stroke={col} strokeWidth={1.7} strokeLinejoin="round" />
    </g>
  );
}

export function rowMid(r: RowLayout): number {
  return r.y + r.h / 2;
}

function annotationY(layout: ChartLayout, signalId: string | null): number {
  if (!signalId) return 10;
  const r = layout.rowById.get(signalId);
  return r ? rowMid(r) : 10;
}

function ArrowShape({ a, layout, x, colors, idp, selected, interactive }: { a: Extract<Annotation, { type: 'arrow' }>; layout: ChartLayout; x: (t: number) => number; colors: ChartColors; idp: string; selected: boolean; interactive?: boolean }) {
  const ra = layout.rowById.get(a.from.signalId);
  const rb = layout.rowById.get(a.to.signalId);
  if (!ra || !rb) return null;
  const x1 = x(a.from.t);
  const x2 = x(a.to.t);
  const down = rb.y >= ra.y;
  const y1 = down ? ra.y + ra.h * 0.62 : ra.y + ra.h * 0.38;
  const y2 = down ? rb.y + rb.h * 0.3 : rb.y + rb.h * 0.7;
  const dx = Math.min(Math.abs(x2 - x1) * 0.5, 40);
  const d = x1 === x2 ? `M${x1},${y1}L${x2},${y2}` : `M${x1},${y1}C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  const col = selected ? colors.selection : colors.annotation;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g data-ann-id={interactive ? a.id : undefined} style={interactive ? { cursor: 'pointer' } : undefined}>
      {interactive && <path d={d} stroke="transparent" strokeWidth={10} fill="none" />}
      <circle cx={x1} cy={y1} r={2.4} fill={col} />
      <path d={d} fill="none" stroke={col} strokeWidth={selected ? 2 : 1.2} strokeDasharray={a.dashed ? '4 3' : undefined} markerEnd={`url(#${idp}-${selected ? 'arrow-sel' : 'arrow'})`} />
      {a.label && (
        <g>
          <rect x={mx - textWidth(a.label, 10) / 2 - 3} y={my - 8} width={textWidth(a.label, 10) + 6} height={14} rx={3} fill={colors.labelBg} stroke={col} strokeWidth={0.6} opacity={0.95} />
          <text x={mx} y={my + 3} fontSize={10} textAnchor="middle" fill={col} fontFamily={FONT}>
            {a.label}
          </text>
        </g>
      )}
    </g>
  );
}

function DimensionShape({ a, layout, x, colors, idp, selected, interactive, project }: { a: Extract<Annotation, { type: 'dimension' }>; layout: ChartLayout; x: (t: number) => number; colors: ChartColors; idp: string; selected: boolean; interactive?: boolean; project: Project }) {
  const row = a.signalId ? layout.rowById.get(a.signalId) : null;
  if (a.signalId && !row) return null;
  const y = row ? row.y + row.h / 2 : 10;
  const top = row ? row.y + 2 : 0;
  const bot = row ? row.y + row.h - 2 : layout.bodyH;
  const x1 = x(Math.min(a.t1, a.t2));
  const x2 = x(Math.max(a.t1, a.t2));
  const col = selected ? colors.selection : '#b45309';
  const text = a.label || formatTime(Math.abs(a.t2 - a.t1), project.settings.timeUnit);
  const tw = textWidth(text, 10) + 8;
  const inside = x2 - x1 > tw + 8;
  const tx = inside ? (x1 + x2) / 2 : x2 + tw / 2 + 4;
  return (
    <g data-ann-id={interactive ? a.id : undefined} style={interactive ? { cursor: 'pointer' } : undefined}>
      <line x1={x1} x2={x1} y1={top} y2={bot} stroke={col} strokeWidth={0.8} strokeDasharray="2 2" />
      <line x1={x2} x2={x2} y1={top} y2={bot} stroke={col} strokeWidth={0.8} strokeDasharray="2 2" />
      {interactive && <rect x={x1} y={y - 6} width={Math.max(x2 - x1, 4)} height={12} fill="transparent" />}
      <line x1={x1 + 1} x2={x2 - 1} y1={y} y2={y} stroke={col} strokeWidth={selected ? 1.8 : 1.1} markerStart={`url(#${idp}-dim)`} markerEnd={`url(#${idp}-dim)`} />
      <rect x={tx - tw / 2} y={y - 7.5} width={tw} height={15} rx={3} fill={colors.labelBg} stroke={col} strokeWidth={0.7} />
      <text x={tx} y={y + 3.5} fontSize={10} fontWeight={600} textAnchor="middle" fill={col} fontFamily={FONT}>
        {text}
      </text>
    </g>
  );
}

export function BodyLayer(props: ViewProps & EditorOverlayProps & { width: number }) {
  const { project, layout, px, t0, t1, colors, width, idp } = props;
  const d = project.settings.duration;
  const tEnd = Math.min(d, t1);
  const x = (t: number) => (t - t0) * px;
  const H = layout.bodyH;
  const grid = project.settings.grid;
  const lines: ReactNode[] = [];
  if (grid > 0 && grid * px >= 6) {
    const start = Math.ceil(t0 / grid) * grid;
    for (let t = start, i = 0; t <= t1 && i < 4000; t += grid, i++) lines.push(<line key={`g${i}`} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={colors.grid} strokeWidth={1} />);
  }
  const major = niceStep(px, 64);
  const mstart = Math.ceil(t0 / major) * major;
  for (let t = mstart, i = 0; t <= t1 && i < 2000; t += major, i++) lines.push(<line key={`m${i}`} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={colors.gridMajor} strokeWidth={0.8} />);

  const selectedSignals = props.selectedSignals ?? new Set<string>();
  const inRange = (t: number) => t >= t0 - 1e-9 && t <= t1 + 1e-9;

  return (
    <g fontFamily={FONT}>
      <defs>
        <marker id={`${idp}-arrow`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10z" fill={colors.annotation} />
        </marker>
        <marker id={`${idp}-arrow-sel`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10z" fill={colors.selection} />
        </marker>
        <marker id={`${idp}-dim`} viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1L10,5L0,9z" fill="#b45309" />
        </marker>
        <pattern id={`${idp}-hatch`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={colors.muted} strokeWidth={1} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={H} fill={colors.bg} />
      {project.steps.map((s, i) =>
        s.end > t0 && s.start < t1 ? (
          <rect key={s.id} x={x(s.start)} y={0} width={Math.max(0, x(s.end) - x(s.start))} height={H} fill={props.grayscale ? (i % 2 ? '#f9fafb' : '#f3f4f6') : s.color ?? '#eef2ff'} style={{ opacity: props.grayscale ? 1 : colors.stepShade }} />
        ) : null,
      )}
      {lines}
      {project.steps.map((s) => (
        <g key={`b${s.id}`}>
          {inRange(s.start) && <line x1={x(s.start)} x2={x(s.start)} y1={0} y2={H} stroke={colors.muted} strokeWidth={0.7} strokeDasharray="3 3" />}
          {inRange(s.end) && <line x1={x(s.end)} x2={x(s.end)} y1={0} y2={H} stroke={colors.muted} strokeWidth={0.7} strokeDasharray="3 3" />}
        </g>
      ))}
      {x(d) < width && <rect x={x(d)} y={0} width={width - x(d)} height={H} fill={colors.grid} opacity={0.6} />}
      {layout.groups.map((g) => (
        <rect key={`grp${g.y}`} x={0} y={g.y} width={width} height={layout.groupH} fill={colors.groupBg} opacity={0.7} />
      ))}
      {layout.rows.map((r) => (
        <g key={r.signal.id}>
          {selectedSignals.has(r.signal.id) && <rect x={0} y={r.y} width={width} height={r.h} fill={colors.selection} opacity={0.08} />}
          <line x1={0} x2={width} y1={r.y + r.h - 0.5} y2={r.y + r.h - 0.5} stroke={colors.rowSep} />
        </g>
      ))}
      {props.range && (
        <rect x={x(Math.min(props.range.t0, props.range.t1))} y={0} width={Math.abs(props.range.t1 - props.range.t0) * px} height={H} fill={colors.rangeFill} stroke={colors.selection} strokeDasharray="4 3" strokeWidth={1} />
      )}
      {(props.violations ?? []).flatMap((v, i) => {
        const rows = v.signalIds.map((id) => layout.rowById.get(id)).filter((r): r is RowLayout => !!r);
        const xs = x(v.t0);
        const w = Math.max(3, x(v.t1) - xs);
        if (!rows.length) return [<rect key={`v${i}`} x={xs} y={0} width={w} height={4} fill="#dc2626" opacity={0.75} />];
        return rows.map((r) => <rect key={`v${i}-${r.signal.id}`} x={xs} y={r.y + 1} width={w} height={r.h - 2} fill={colors.violation} stroke="#dc2626" strokeWidth={1} />);
      })}
      {layout.rows.map((r) => {
        const s = r.signal;
        const common = { s, row: r, x, tEnd, colors, gray: props.grayscale };
        if (s.kind === 'bus') return <BusWave key={s.id} {...common} idp={idp} />;
        if (s.kind === 'analog') return <AnalogWave key={s.id} {...common} />;
        return <BitWave key={s.id} {...common} fill={project.settings.fillHigh} showTimes={project.settings.showEdgeTimes} project={project} idp={idp} />;
      })}
      {props.hoverEdge &&
        (() => {
          const r = layout.rowById.get(props.hoverEdge.signalId);
          const p = r?.signal.points[props.hoverEdge.index];
          if (!r || !p) return null;
          return <rect x={x(p.t) - 3} y={r.y + 2} width={6 + (p.ramp ?? 0) * px} height={r.h - 4} rx={2} fill={colors.selection} opacity={0.25} />;
        })()}
      {project.annotations.map((a) => {
        const sel = props.selectedAnnotation === a.id;
        switch (a.type) {
          case 'arrow':
            return <ArrowShape key={a.id} a={a} layout={layout} x={x} colors={colors} idp={idp} selected={sel} interactive={props.interactive} />;
          case 'dimension':
            return <DimensionShape key={a.id} a={a} layout={layout} x={x} colors={colors} idp={idp} selected={sel} interactive={props.interactive} project={project} />;
          case 'note': {
            const y = annotationY(layout, a.signalId);
            const tw = textWidth(a.text, 10) + 10;
            const xx = x(a.t);
            return (
              <g key={a.id} data-ann-id={props.interactive ? a.id : undefined} style={props.interactive ? { cursor: 'move' } : undefined}>
                <circle cx={xx} cy={y} r={2.5} fill="#7c3aed" />
                <line x1={xx} y1={y} x2={xx + 8} y2={y - 8} stroke="#7c3aed" strokeWidth={1} />
                <rect x={xx + 8} y={y - 17} width={tw} height={16} rx={3} fill="#faf5ff" stroke={sel ? colors.selection : '#7c3aed'} strokeWidth={sel ? 2 : 1} />
                <text x={xx + 13} y={y - 5.5} fontSize={10} fill="#5b21b6" fontFamily={FONT}>
                  {a.text}
                </text>
              </g>
            );
          }
          case 'marker':
            return inRange(a.t) ? (
              <g key={a.id} data-ann-id={props.interactive ? a.id : undefined} style={props.interactive ? { cursor: 'ew-resize' } : undefined}>
                {props.interactive && <rect x={x(a.t) - 4} y={0} width={8} height={H} fill="transparent" />}
                <line x1={x(a.t)} x2={x(a.t)} y1={0} y2={H} stroke={props.grayscale ? GRAY : a.color ?? '#16a34a'} strokeWidth={sel ? 2.4 : 1.4} strokeDasharray="6 3" />
                {a.label && (
                  <g>
                    <rect x={x(a.t) + 3} y={2} width={textWidth(a.label, 10) + 8} height={15} rx={3} fill={props.grayscale ? GRAY : a.color ?? '#16a34a'} />
                    <text x={x(a.t) + 7} y={13} fontSize={10} fill="#fff" fontWeight={600} fontFamily={FONT}>
                      {a.label}
                    </text>
                  </g>
                )}
              </g>
            ) : null;
        }
      })}
      {props.cursorA != null && <line x1={x(props.cursorA)} x2={x(props.cursorA)} y1={0} y2={H} stroke="#2563eb" strokeWidth={1.2} />}
      {props.cursorB != null && <line x1={x(props.cursorB)} x2={x(props.cursorB)} y1={0} y2={H} stroke="#db2777" strokeWidth={1.2} />}
    </g>
  );
}

// ─────────────────────────── 라벨 (내보내기/보고서용) ───────────────────────────

export interface LabelWidths {
  addrW: number;
  nameW: number;
  lvlW: number;
  total: number;
}

export function labelWidths(project: Project, signals: Signal[]): LabelWidths {
  const st = project.settings;
  const addrW = st.showAddress && signals.some((s) => s.address) ? Math.min(Math.max(...signals.map((s) => textWidth(s.address, 10.5)), 30) + 14, 120) : 0;
  const nameW = Math.min(Math.max(...signals.map((s) => textWidth(s.name, 12)), 60) + 18, 280);
  const hasLvl = st.showLevelLabels && signals.some((s) => s.onLabel || s.offLabel);
  const lvlW = hasLvl ? Math.min(Math.max(...signals.map((s) => Math.max(textWidth(s.onLabel ?? '', 9.5), textWidth(s.offLabel ?? '', 9.5))), 16) + 10, 70) : 0;
  return { addrW, nameW, lvlW, total: addrW + nameW + lvlW };
}

export function LabelLayer({ layout, colors, widths, grayscale }: { layout: ChartLayout; colors: ChartColors; widths: LabelWidths; grayscale?: boolean }) {
  const { addrW, nameW, lvlW, total } = widths;
  return (
    <g fontFamily={FONT}>
      <rect x={0} y={0} width={total} height={layout.bodyH} fill={colors.bg} />
      {layout.groups.map((g) => (
        <g key={g.y}>
          <rect x={0} y={g.y} width={total} height={layout.groupH} fill={colors.groupBg} />
          <text x={6} y={g.y + 13} fontSize={10.5} fontWeight={700} fill={colors.text}>
            ▸ {g.name}
          </text>
        </g>
      ))}
      {layout.rows.map((r) => {
        const s = r.signal;
        const ym = r.y + r.h / 2;
        const pad = Math.max(5, r.h * 0.2);
        return (
          <g key={s.id}>
            <line x1={0} x2={total} y1={r.y + r.h - 0.5} y2={r.y + r.h - 0.5} stroke={colors.rowSep} />
            <rect x={0} y={r.y + 4} width={3} height={r.h - 8} rx={1.5} fill={sigColor(s, grayscale)} />
            {addrW > 0 && (
              <text x={8} y={ym + 3.5} fontSize={10.5} fill={colors.muted} fontFamily={MONO}>
                {fitText(s.address, addrW - 10, 10.5)}
              </text>
            )}
            <text x={addrW + 8} y={ym + 4} fontSize={12} fill={colors.text} fontWeight={500}>
              {fitText(s.name, nameW - 12, 12)}
            </text>
            {lvlW > 0 && s.kind === 'bit' && (
              <g fontSize={9.5} fill={colors.muted} textAnchor="end">
                {s.onLabel && (
                  <text x={total - 5} y={r.y + pad + 3.5}>
                    {s.onLabel}
                  </text>
                )}
                {s.offLabel && (
                  <text x={total - 5} y={r.y + r.h - pad + 3.5}>
                    {s.offLabel}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      <line x1={total - 0.5} x2={total - 0.5} y1={0} y2={layout.bodyH} stroke={colors.gridMajor} />
    </g>
  );
}
