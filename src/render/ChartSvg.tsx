import type { Project } from '../model/types';
import type { Violation } from '../model/analysis';
import { tr } from '../i18n';
import { computeLayout, FONT, PRINT_COLORS, type ChartColors } from './layout';
import { BodyLayer, HeaderLayer, LabelLayer, labelWidths, rulerUnit, fitText } from './ChartParts';

export interface ChartSvgOptions {
  t0?: number;
  t1?: number;
  /** px / ms (지정하지 않으면 width 로 계산) */
  px?: number;
  /** 전체 폭 (라벨 포함) */
  width?: number;
  signalIds?: Set<string>;
  title?: boolean;
  grayscale?: boolean;
  idp?: string;
  violations?: Violation[];
  colors?: ChartColors;
  showSteps?: boolean;
  style?: React.CSSProperties;
}

export interface ChartGeometry {
  width: number;
  height: number;
  px: number;
  labelW: number;
  titleH: number;
}

export function chartGeometry(project: Project, o: ChartSvgOptions = {}): ChartGeometry {
  const layout = computeLayout(project, { includeHidden: false, only: o.signalIds, showSteps: o.showSteps });
  const lw = labelWidths(project, layout.rows.map((r) => r.signal));
  const t0 = o.t0 ?? 0;
  const t1 = o.t1 ?? project.settings.duration;
  const span = Math.max(t1 - t0, 1e-6);
  const px = o.px ?? (o.width ? Math.max((o.width - lw.total - 12) / span, 1e-6) : Math.max(900 / span, 1e-6));
  const titleH = o.title ? 38 : 0;
  return { width: lw.total + span * px + 12, height: titleH + layout.headerH + layout.bodyH + 1, px, labelW: lw.total, titleH };
}

/** 정적 타임차트 SVG (내보내기 / 보고서 / 미리보기) */
export function ChartSvg({ project, ...o }: ChartSvgOptions & { project: Project }) {
  const colors = o.colors ?? PRINT_COLORS;
  const layout = computeLayout(project, { includeHidden: false, only: o.signalIds, showSteps: o.showSteps });
  const widths = labelWidths(project, layout.rows.map((r) => r.signal));
  const g = chartGeometry(project, o);
  const t0 = o.t0 ?? 0;
  const t1 = o.t1 ?? project.settings.duration;
  const waveW = (t1 - t0) * g.px;
  const idp = o.idp ?? 'c';
  const top = g.titleH;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} fontFamily={FONT} style={{ background: colors.bg, ...o.style }}>
      <rect x={0} y={0} width={g.width} height={g.height} fill={colors.bg} />
      {o.title && (
        <g>
          <text x={8} y={22} fontSize={16} fontWeight={700} fill={colors.text}>
            {fitText(project.meta.title, g.width * 0.6, 16)}
          </text>
          <text x={g.width - 8} y={22} fontSize={11} textAnchor="end" fill={colors.muted}>
            {[project.meta.machine, project.meta.drawingNo, project.meta.revision && `Rev.${project.meta.revision}`].filter(Boolean).join('  ·  ')}
          </text>
          <line x1={0} x2={g.width} y1={top - 6} y2={top - 6} stroke={colors.gridMajor} />
        </g>
      )}
      {/* 좌상단 모서리 */}
      <g transform={`translate(0,${top})`}>
        <rect x={0} y={0} width={widths.total} height={layout.headerH} fill={colors.bg} />
        {layout.stepsH > 0 && (
          <text x={widths.total - 6} y={layout.stepsH / 2 + 4} fontSize={10} textAnchor="end" fill={colors.muted}>
            STEP
          </text>
        )}
        <text x={8} y={layout.stepsH + 17} fontSize={10.5} fontWeight={600} fill={colors.muted}>
          {widths.addrW ? tr('주소 / 신호명', 'Address / Signal') : tr('신호명', 'Signal')}
        </text>
        <text x={widths.total - 6} y={layout.stepsH + 17} fontSize={10} textAnchor="end" fill={colors.muted}>
          [{rulerUnit(project)}]
        </text>
        <line x1={0} x2={widths.total} y1={layout.headerH - 0.5} y2={layout.headerH - 0.5} stroke={colors.gridMajor} />
      </g>
      <g transform={`translate(${widths.total},${top})`}>
        <svg x={0} y={0} width={waveW + 12} height={layout.headerH} overflow="hidden">
          <HeaderLayer project={project} layout={layout} px={g.px} t0={t0} t1={t1} colors={colors} idp={idp} width={waveW + 12} grayscale={o.grayscale} />
        </svg>
      </g>
      <g transform={`translate(0,${top + layout.headerH})`}>
        <LabelLayer layout={layout} colors={colors} widths={widths} grayscale={o.grayscale} />
      </g>
      <g transform={`translate(${widths.total},${top + layout.headerH})`}>
        <svg x={0} y={0} width={waveW + 12} height={layout.bodyH} overflow="hidden">
          <BodyLayer project={project} layout={layout} px={g.px} t0={t0} t1={t1} colors={colors} idp={idp} width={waveW + 12} violations={o.violations} grayscale={o.grayscale} />
        </svg>
      </g>
      <rect x={0.5} y={top + 0.5} width={g.width - 1} height={g.height - top - 1} fill="none" stroke={colors.gridMajor} />
    </svg>
  );
}
