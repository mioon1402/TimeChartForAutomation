import type { Project, Signal } from '../model/types';

export interface RowLayout {
  signal: Signal;
  index: number;
  y: number;
  h: number;
}

export interface GroupHeader {
  name: string;
  y: number;
}

export interface ChartLayout {
  rows: RowLayout[];
  groups: GroupHeader[];
  rowById: Map<string, RowLayout>;
  stepsH: number;
  rulerH: number;
  headerH: number;
  /** 본문(행 영역) 높이 */
  bodyH: number;
  groupH: number;
}

export interface LayoutOptions {
  includeHidden: boolean;
  /** 표시할 신호 id (페이지 분할) */
  only?: Set<string>;
  showSteps?: boolean;
}

export const GROUP_H = 18;
export const RULER_H = 26;
export const STEPS_H = 24;

export function rowHeight(s: Signal, base: number): number {
  return Math.round(base * (s.heightScale ?? 1));
}

export function computeLayout(project: Project, opts: LayoutOptions): ChartLayout {
  const base = project.settings.rowHeight;
  const hasSteps = opts.showSteps !== false && project.steps.length > 0;
  const stepsH = hasSteps ? STEPS_H : 0;
  const rulerH = RULER_H;
  const rows: RowLayout[] = [];
  const groups: GroupHeader[] = [];
  let y = 0;
  let group: string | undefined;
  project.signals.forEach((s, index) => {
    if (!opts.includeHidden && s.hidden) return;
    if (opts.only && !opts.only.has(s.id)) return;
    const g = s.group || undefined;
    if (g && g !== group) {
      groups.push({ name: g, y });
      y += GROUP_H;
    }
    group = g;
    const h = rowHeight(s, base);
    rows.push({ signal: s, index, y, h });
    y += h;
  });
  return {
    rows,
    groups,
    rowById: new Map(rows.map((r) => [r.signal.id, r])),
    stepsH,
    rulerH,
    headerH: stepsH + rulerH,
    bodyH: Math.max(y, base),
    groupH: GROUP_H,
  };
}

export function rowAtY(layout: ChartLayout, y: number): RowLayout | null {
  for (const r of layout.rows) if (y >= r.y && y < r.y + r.h) return r;
  return null;
}

export interface ChartColors {
  bg: string;
  grid: string;
  gridMajor: string;
  text: string;
  muted: string;
  rowSep: string;
  groupBg: string;
  selection: string;
  rangeFill: string;
  annotation: string;
  violation: string;
  labelBg: string;
  /** 스텝 구간 음영 불투명도 */
  stepShade: string;
}

/** 인쇄/내보내기용 고정 색상 */
export const PRINT_COLORS: ChartColors = {
  bg: '#ffffff',
  grid: '#eef0f3',
  gridMajor: '#d5d9e0',
  text: '#1f2937',
  muted: '#6b7280',
  rowSep: '#e5e7eb',
  groupBg: '#f3f4f6',
  selection: '#2563eb',
  rangeFill: 'rgba(37,99,235,0.08)',
  annotation: '#111827',
  violation: 'rgba(220,38,38,0.16)',
  labelBg: '#ffffff',
  stepShade: '0.28',
};

/** 화면용 - CSS 변수 (다크 모드 대응) */
export const SCREEN_COLORS: ChartColors = {
  bg: 'var(--chart-bg)',
  grid: 'var(--chart-grid)',
  gridMajor: 'var(--chart-grid-major)',
  text: 'var(--chart-text)',
  muted: 'var(--chart-muted)',
  rowSep: 'var(--chart-row-sep)',
  groupBg: 'var(--chart-group-bg)',
  selection: 'var(--accent)',
  rangeFill: 'var(--chart-range)',
  annotation: 'var(--chart-annotation)',
  violation: 'rgba(220,38,38,0.18)',
  labelBg: 'var(--chart-bg)',
  stepShade: 'var(--step-shade)',
};

export const FONT = "'Pretendard','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif";
export const MONO = "'JetBrains Mono','D2Coding','Consolas','Menlo',monospace";
