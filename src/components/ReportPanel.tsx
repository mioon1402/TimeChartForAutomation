import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Project, Signal } from '../model/types';
import { checkRules, cycleSummary, isIoSignal, sequenceEvents, signalStats, sigLabel, type RuleResult } from '../model/analysis';
import { formatTime, todayString } from '../model/format';
import { computeLayout } from '../render/layout';
import { labelWidths, GrayPatternDefs } from '../render/ChartParts';
import { chartGeometry, ChartSvg } from '../render/ChartSvg';
import { roleLabelKo } from '../io/csv';
import { computeTimeline, ioPoints, type SeqSpec } from '../model/sequence';
import { fmtSec, KIND_LABEL, sensorText, sequenceStatus, startText } from '../model/seqEdit';
import { sheetName } from '../model/book';
import { Check, Field, Icon, TextInput, TimeInput } from './ui';
import { tr } from '../i18n';
import { storageGet, storageSet } from '../storage';
import { WEB_TRIAL } from '../env';

export interface ReportOpts {
  paper: 'A4' | 'A3';
  orientation: 'landscape' | 'portrait';
  /** one = 한 장에 요약 + 전체 차트 (+ 스텝 표), full = 여러 장 보고서 */
  layout: 'one' | 'full';
  /** current = 지금 차트, all = 설비 파일의 차트 전부 (목차 포함) */
  scope: 'current' | 'all';
  cover: boolean;
  chart: boolean;
  signals: boolean;
  steps: boolean;
  /** 동작 순서표 (신호 변화 시간순) */
  events: boolean;
  rules: boolean;
  annotations: boolean;
  /** 동작 순서 탭에서 만든 설계 표 (기기 · 동작 순서) */
  sequence: boolean;
  /** 페이지당 시간 (0 = 한 페이지에 전체) */
  timePerPage: number;
  grayscale: boolean;
  violations: boolean;
  /** 차트가 남는 공간이 많으면 행 높이를 늘려 채움 */
  stretch: boolean;
  /** 표제란 (빼면 차트를 더 크게) */
  titleBlock: boolean;
}

const OPTS_KEY = 'timechart-studio.report.v1';
const MM = 3.7795;
const MARGIN = 10;
const HEAD_MM = 9;
const TITLEBLOCK_MM = 21;
/** 쪽 머리·표제란·위아래 여백을 뺀 본문 높이 (mm) */
const bodyHeight = (size: { h: number }, o: Pick<ReportOpts, 'titleBlock'>) => size.h - 2 * MARGIN - HEAD_MM - (o.titleBlock ? TITLEBLOCK_MM : 0) - 7;

export const DEFAULT_SIGN_LABELS = ['작성', '검토', '승인'];

/** 로고 그림 → 표제란에 맞게 줄인 PNG (파일이 커지지 않게) */
async function logoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => bad(new Error(tr('그림을 읽지 못했습니다', 'Could not read the image')));
      im.src = url;
    });
    const k = Math.min(1, 480 / img.width, 160 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const DEFAULT_REPORT_OPTS: ReportOpts = {
  paper: 'A4',
  orientation: 'landscape',
  layout: 'full',
  scope: 'current',
  cover: true,
  chart: true,
  signals: true,
  steps: true,
  events: true,
  rules: true,
  annotations: true,
  sequence: true,
  timePerPage: 0,
  grayscale: false,
  violations: true,
  stretch: true,
  titleBlock: true,
};

function loadOpts(): ReportOpts {
  try {
    return { ...DEFAULT_REPORT_OPTS, ...JSON.parse(storageGet(OPTS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_REPORT_OPTS;
  }
}

export function paperSize(o: Pick<ReportOpts, 'paper' | 'orientation'>): { w: number; h: number } {
  const base = o.paper === 'A3' ? { w: 420, h: 297 } : { w: 297, h: 210 };
  return o.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

interface PageDef {
  kind: string;
  title: string;
  body: ReactNode;
  /** 쪽 머리·표제란에 쓸 차트 (설비 전체를 인쇄할 때 페이지마다 다름) */
  project?: Project;
}

/** 여러 페이지에 이어 싣는 표 */
interface Block {
  id: string;
  title: string;
  /** 첫 조각에만 (요약 등) */
  pre?: ReactNode;
  head: ReactNode;
  rows: ReactNode[];
  foot?: ReactNode;
  cols?: ReactNode;
}

interface Meas {
  title: number;
  pre: number;
  head: number;
  foot: number;
  rows: number[];
}

interface Slice {
  block: Block;
  from: number;
  to: number;
  first: boolean;
  last: boolean;
}

export function ReportPanel() {
  const project = useStore((s) => s.project);
  const { setMeta, commit, setTab } = useStore.getState();
  const [o, setO] = useState<ReportOpts>(loadOpts);
  const set = (patch: Partial<ReportOpts>) => {
    const n = { ...o, ...patch };
    setO(n);
    storageSet(OPTS_KEY, JSON.stringify(n));
  };
  const size = paperSize(o);

  // @page 크기를 동적으로 지정
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'page-size-style';
    el.textContent = `@page { size: ${o.paper} ${o.orientation}; margin: 0; }`;
    document.getElementById('page-size-style')?.remove();
    document.head.appendChild(el);
    return () => el.remove();
  }, [o.paper, o.orientation]);

  // 인쇄할 차트: 지금 차트, 또는 설비 파일의 차트 전부
  const sheets = useStore((s) => s.sheets);
  const activeSheet = useStore((s) => s.activeSheet);
  const bookName = useStore((s) => s.bookName);
  const all = useMemo(() => sheets.map((p, i) => (i === activeSheet ? project : p)), [sheets, activeSheet, project]);
  const targets = useMemo(() => (o.scope === 'all' && all.length > 1 ? all : [project]), [o.scope, all, project]);
  const rulesAll = useMemo(() => targets.map((p) => checkRules(p)), [targets]);
  const blocks = useMemo(() => (o.layout === 'full' ? targets.flatMap((p, si) => tableBlocks(p, o, rulesAll[si]).map((b) => ({ ...b, id: `${si}:${b.id}` }))) : []), [targets, o, rulesAll]);

  // 표의 실제 줄 높이를 재서 페이지를 나눈다 (글이 길어 두 줄이 되는 칸도 정확히)
  const measRef = useRef<HTMLDivElement>(null);
  const [meas, setMeas] = useState<Record<string, Meas>>({});
  useLayoutEffect(() => {
    const root = measRef.current;
    if (!root) return;
    const h = (el: Element | null) => {
      if (!el) return 0;
      const cs = getComputedStyle(el);
      return (el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)) / MM;
    };
    const next: Record<string, Meas> = {};
    root.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
      next[el.dataset.block!] = {
        title: h(el.querySelector('.rblock-title')),
        pre: h(el.querySelector('.rblock-pre')),
        head: h(el.querySelector('thead')),
        foot: h(el.querySelector('tfoot')),
        rows: [...el.querySelectorAll('tbody > tr')].map((tr) => tr.getBoundingClientRect().height / MM),
      };
    });
    if (JSON.stringify(next) !== JSON.stringify(meas)) setMeas(next);
  });

  const pages = useMemo(() => {
    if (targets.length === 1) return buildPages(targets[0], o, size, rulesAll[0], blocks, meas).map((pg) => ({ ...pg, project: targets[0] }));
    const parts = targets.map((p, si) => buildPages(p, o, size, rulesAll[si], blocks.filter((b) => b.id.startsWith(`${si}:`)), meas).map((pg) => ({ ...pg, project: p })));
    const indexProject: Project = { ...project, meta: { ...project.meta, title: tr(`${bookName || project.meta.machine || '설비'} 타임차트 모음`, `${bookName || project.meta.machine || 'Machine'} timing charts`) } };
    let at = 2;
    const rows = targets.map((p, si) => {
      const from = at;
      at += parts[si].length;
      return { p, from, to: at - 1, rules: rulesAll[si] };
    });
    const index: PageDef = { kind: 'index', title: tr('목차', 'Contents'), project: indexProject, body: <IndexPage rows={rows} bookName={bookName || project.meta.machine} /> };
    return [index, ...parts.flat()];
  }, [targets, o, size.w, size.h, rulesAll, blocks, meas, project, bookName]); // eslint-disable-line react-hooks/exhaustive-deps

  // 미리보기 배율: 화면 폭에 맞춤 (인쇄는 항상 실제 크기)
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(1000);
  const [zoomMode, setZoomMode] = useState<'fit' | '100'>(() => (storageGet('timechart-studio.report-zoom.v1') === '100' ? '100' : 'fit'));
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setPreviewW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.min(1, Math.max(0.3, (previewW - 8) / (size.w * MM)));
  const zoom = zoomMode === 'fit' ? fit : 1;

  const m = project.meta;
  const addRevision = () => {
    commit({ ...project, revisions: [...project.revisions, { rev: nextRev(project.revisions.map((r) => r.rev)), date: todayString(), description: '', author: m.author }] });
  };
  const seqChanged = sequenceStatus(project) === 'changed';

  const seg = <T extends string>(value: T, options: { value: T; label: string; icon?: string }[], onChange: (v: T) => void) => (
    <div className="seg" role="radiogroup">
      {options.map((opt) => (
        <button type="button" key={opt.value} role="radio" aria-checked={value === opt.value} className={value === opt.value ? 'on' : ''} onClick={() => onChange(opt.value)}>
          {opt.icon && <Icon name={opt.icon} size={14} />} {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="report">
      <aside className="report-side">
        <div className="plc-head">
          <h3>
            <Icon name="report" /> {tr('보고서 · 인쇄', 'Report & print')}
          </h3>
        </div>
        {WEB_TRIAL ? (
          <p className="trial-note">
            {tr('온라인 체험판에서는 인쇄와 PDF 저장이 막혀 있습니다. 보고서를 출력하려면 파일 버전(TimeChartStudio.html)을 PC에서 여세요. 미리보기는 여기서 그대로 확인할 수 있습니다.', 'Printing is blocked in the online trial. Open the file version (TimeChartStudio.html) on your PC to print. The preview below is the same.')}
          </p>
        ) : (
          <button type="button" className="btn primary run" onClick={() => window.print()}>
            <Icon name="print" /> {tr(`인쇄 / PDF 저장 (${pages.length}쪽)`, `Print / Save PDF (${pages.length} p.)`)}
          </button>
        )}
        {seqChanged && (
          <p className="report-warn">
            <Icon name="warn" size={14} /> {tr('동작 순서표를 고친 뒤 차트에 적용하지 않았습니다. 보고서는 지금 차트 기준입니다.', 'The sequence table has changes not applied to the chart. The report follows the current chart.')}{' '}
            <button type="button" className="linkish" onClick={() => setTab('sequence')}>
              {tr('동작 순서로 가기', 'Open sequence')}
            </button>
          </p>
        )}
        <h4>{tr('출력 방식', 'Layout')}</h4>
        {seg(
          o.layout,
          [
            { value: 'one', label: tr('한 장으로', 'One page'), icon: 'chart' },
            { value: 'full', label: tr('여러 장 보고서', 'Full report'), icon: 'report' },
          ],
          (v) => set({ layout: v }),
        )}
        {all.length > 1 && (
          <>
            <h4>{tr('인쇄 범위', 'Print')}</h4>
            {seg(
              o.scope,
              [
                { value: 'current', label: tr('이 차트', 'This chart') },
                { value: 'all', label: tr(`설비 전체 (${all.length}장)`, `Whole machine (${all.length})`) },
              ],
              (v) => set({ scope: v }),
            )}
            {o.scope === 'all' && <p className="muted small">{tr('맨 앞에 목차가 붙고, 차트마다 차례로 싣습니다. "한 장으로"와 함께 쓰면 차트마다 한 장씩입니다.', 'A contents page first, then each chart in turn. With "One page", each chart gets one sheet.')}</p>}
          </>
        )}
        <p className="muted small">
          {o.layout === 'one'
            ? tr('제목·사이클 타임·전체 타임차트(와 공정 스텝 표)를 한 장에 맞춰 넣습니다. 설비 옆에 붙여 두거나 회의 자료로 쓰기 좋습니다.', 'Title, cycle time, the whole chart (and the step table) fitted on one sheet.')
            : tr('표지, 타임차트, 신호 목록, 공정 스텝, 동작 순서표, 규칙 검증 등을 여러 장에 이어서 싣습니다. 짧은 표는 한 장에 모읍니다.', 'Cover, chart, signal list, steps, sequence and checks over several pages; short tables share a page.')}
        </p>
        <div className="grid2">
          <Field label={tr('용지', 'Paper')}>
            {seg(
              o.paper,
              [
                { value: 'A4', label: 'A4' },
                { value: 'A3', label: 'A3' },
              ],
              (v) => set({ paper: v }),
            )}
          </Field>
          <Field label={tr('방향', 'Orientation')}>
            {seg(
              o.orientation,
              [
                { value: 'landscape', label: tr('가로', 'Landscape') },
                { value: 'portrait', label: tr('세로', 'Portrait') },
              ],
              (v) => set({ orientation: v }),
            )}
          </Field>
        </div>
        <div className="checks">
          <Check checked={o.grayscale} onChange={(v) => set({ grayscale: v })} label={tr('흑백 프린터용 (색 대신 무늬로 구분)', 'Black & white (patterns instead of colors)')} />
          <Check checked={o.violations} onChange={(v) => set({ violations: v })} label={tr('차트에 규칙 위반 표시', 'Highlight violations')} />
          <Check checked={o.stretch} onChange={(v) => set({ stretch: v })} label={tr('남는 공간은 차트 행을 높여 채우기', 'Stretch rows to fill space')} />
        </div>
        {o.layout === 'one' ? (
          <div className="checks">
            <Check checked={o.steps} onChange={(v) => set({ steps: v })} label={tr('공정 스텝 · 시간 표 함께', 'Include step table')} />
          </div>
        ) : (
          <>
            <h4>{tr('넣을 내용', 'Sections')}</h4>
            <div className="checks">
              <Check checked={o.cover} onChange={(v) => set({ cover: v })} label={tr('표지 · 요약', 'Cover & summary')} />
              <Check checked={o.chart} onChange={(v) => set({ chart: v })} label={tr('타임차트', 'Timing chart')} />
              {project.sequence && <Check checked={o.sequence} onChange={(v) => set({ sequence: v })} label={tr('동작 순서표 (설계: 기기 · 순서 · I/O)', 'Sequence table (design)')} />}
              <Check checked={o.signals} onChange={(v) => set({ signals: v })} label={tr('신호(I/O) 목록', 'Signal (I/O) list')} />
              <Check checked={o.steps} onChange={(v) => set({ steps: v })} label={tr('공정 스텝 · 사이클 타임', 'Steps & cycle time')} />
              <Check checked={o.events} onChange={(v) => set({ events: v })} label={tr('입출력 변화 순서 (시간순)', 'Sequence of events')} />
              <Check checked={o.rules} onChange={(v) => set({ rules: v })} label={tr('타이밍 규칙 검증', 'Timing rule check')} />
              <Check checked={o.annotations} onChange={(v) => set({ annotations: v })} label={tr('인터록 · 주석 목록', 'Interlocks & notes')} />
            </div>
            <Field label={tr('타임차트 페이지당 시간 (비우면 전체를 한 장에)', 'Chart time per page (empty = fit)')} wide>
              <TimeInput value={o.timePerPage || undefined} allowEmpty onChange={(v) => set({ timePerPage: v ?? 0 })} placeholder={tr('자동', 'auto')} />
            </Field>
          </>
        )}
        <details className="print-tips">
          <summary>{tr('인쇄가 이상하게 나올 때', 'Print tips')}</summary>
          <ul>
            <li>{tr('인쇄 창의 "배율"은 기본값(100%)으로 두세요. 용지와 방향은 여기서 고른 대로 자동으로 맞춰집니다.', 'Keep scale at 100% in the print dialog. Paper and orientation follow the settings here.')}</li>
            <li>{tr('색이 안 나오면 인쇄 창의 "배경 그래픽"을 켜세요.', 'If colors are missing, enable "Background graphics".')}</li>
            <li>{tr('흑백 레이저 프린터는 "흑백 프린터용"을 켜면 출력·센서가 무늬로 구분되어 더 잘 보입니다.', 'On a mono laser printer, turn on black & white for patterns.')}</li>
            <li>{tr('PDF 로 저장하려면 프린터에서 "PDF로 저장" 또는 "Microsoft Print to PDF"를 고르세요.', 'To save a PDF, choose "Save as PDF" or "Microsoft Print to PDF".')}</li>
          </ul>
        </details>
        <h4>{tr('표제란', 'Title block')}</h4>
        <div className="checks">
          <Check checked={o.titleBlock} onChange={(v) => set({ titleBlock: v })} label={tr('표제란 넣기 (빼면 차트가 더 커짐)', 'Include title block')} />
        </div>
        <div className="logo-row">
          {m.logo ? <img src={m.logo} alt={tr('회사 로고', 'Company logo')} className="logo-thumb" /> : <span className="muted small">{tr('회사 로고 없음', 'No logo')}</span>}
          <label className="btn small">
            <Icon name="image" size={13} /> {m.logo ? tr('로고 바꾸기', 'Change logo') : tr('로고 넣기', 'Add logo')}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  setMeta({ logo: await logoDataUrl(f) });
                } catch (err) {
                  useStore.getState().toast((err as Error).message, 'error');
                }
              }}
            />
          </label>
          {m.logo && (
            <button type="button" className="btn small" onClick={() => setMeta({ logo: undefined })}>
              {tr('빼기', 'Remove')}
            </button>
          )}
        </div>
        <Field label={tr('서명 칸 이름 (회사 양식에 맞게)', 'Sign-off labels')} wide>
          <div className="sign-labels">
            {[0, 1, 2].map((k) => (
              <TextInput
                key={k}
                value={(m.signLabels ?? DEFAULT_SIGN_LABELS)[k] ?? ''}
                placeholder={DEFAULT_SIGN_LABELS[k]}
                onChange={(v) => {
                  const next = [...(m.signLabels ?? DEFAULT_SIGN_LABELS)];
                  next[k] = v || DEFAULT_SIGN_LABELS[k];
                  setMeta({ signLabels: next.join() === DEFAULT_SIGN_LABELS.join() ? undefined : next });
                }}
              />
            ))}
          </div>
        </Field>
        <Field label={tr('제목', 'Title')} wide>
          <TextInput value={m.title} onChange={(v) => setMeta({ title: v })} />
        </Field>
        <div className="grid2">
          <Field label={tr('설비명', 'Machine')}>
            <TextInput value={m.machine} onChange={(v) => setMeta({ machine: v })} />
          </Field>
          <Field label={tr('도면 번호', 'Drawing no.')}>
            <TextInput value={m.drawingNo} onChange={(v) => setMeta({ drawingNo: v })} />
          </Field>
          <Field label={tr('회사', 'Company')}>
            <TextInput value={m.company} onChange={(v) => setMeta({ company: v })} />
          </Field>
          <Field label="Rev.">
            <TextInput value={m.revision} onChange={(v) => setMeta({ revision: v })} />
          </Field>
          <Field label={tr('작성', 'Drawn')}>
            <TextInput value={m.author} onChange={(v) => setMeta({ author: v })} />
          </Field>
          <Field label={tr('검토', 'Checked')}>
            <TextInput value={m.checker} onChange={(v) => setMeta({ checker: v })} />
          </Field>
          <Field label={tr('승인', 'Approved')}>
            <TextInput value={m.approver} onChange={(v) => setMeta({ approver: v })} />
          </Field>
          <Field label={tr('날짜', 'Date')}>
            <TextInput value={m.date} onChange={(v) => setMeta({ date: v })} />
          </Field>
        </div>
        <h4>
          {tr('변경 이력', 'Revisions')}
          <button type="button" className="mini-btn" onClick={addRevision} title={tr('이력 추가', 'Add revision')}>
            <Icon name="plus" size={13} />
          </button>
        </h4>
        {project.revisions.map((r, i) => (
          <div key={i} className="rev-row">
            <input className="input rev" value={r.rev} onChange={(e) => commit({ ...project, revisions: project.revisions.map((x, j) => (j === i ? { ...x, rev: e.target.value } : x)) }, `rev${i}`)} />
            <input className="input" value={r.date} onChange={(e) => commit({ ...project, revisions: project.revisions.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }, `revd${i}`)} />
            <input className="input" placeholder={tr('내용', 'Description')} value={r.description} onChange={(e) => commit({ ...project, revisions: project.revisions.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) }, `revs${i}`)} />
            <button type="button" className="mini-btn" onClick={() => commit({ ...project, revisions: project.revisions.filter((_, j) => j !== i) })}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <p className="muted small">
          {tr('총', 'Total')} {pages.length} {tr('페이지', 'pages')} · {o.paper} {o.orientation === 'landscape' ? tr('가로', 'landscape') : tr('세로', 'portrait')}
          {o.grayscale ? tr(' · 흑백', ' · B&W') : ''}
        </p>
      </aside>
      <div className="report-preview" ref={previewRef}>
        <div className="report-zoom">
          {seg(
            zoomMode,
            [
              { value: 'fit', label: tr(`화면에 맞춤 (${Math.round(fit * 100)}%)`, `Fit (${Math.round(fit * 100)}%)`) },
              { value: '100', label: tr('실제 크기', 'Actual size') },
            ],
            (v) => {
              setZoomMode(v);
              storageSet('timechart-studio.report-zoom.v1', v);
            },
          )}
        </div>
        <div className={`report-pages ${o.grayscale ? 'gray' : ''}`} style={{ zoom }}>
          {pages.map((p, i) => (
            <div key={i} className="page" style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
              <div className="page-inner" style={{ padding: `${MARGIN}mm` }}>
                <div className="page-head" style={{ height: `${HEAD_MM}mm` }}>
                  <span className="ph-title">{(p.project ?? project).meta.title}</span>
                  <span className="ph-sec">
                    {p.title}
                    {!o.titleBlock && <span className="ph-page"> · {i + 1} / {pages.length}</span>}
                  </span>
                </div>
                <div className="page-content">{p.body}</div>
                {o.titleBlock && <TitleBlock project={p.project ?? project} page={i + 1} total={pages.length} portrait={o.orientation === 'portrait'} />}
              </div>
            </div>
          ))}
        </div>
        {/* 페이지 나누기용 측정 (화면 밖, 인쇄 안 됨) */}
        {blocks.length > 0 && (
          <div className="page page-measure" ref={measRef} style={{ width: `${size.w}mm` }} aria-hidden="true">
            <div className="page-inner" style={{ padding: `0 ${MARGIN}mm` }}>
              <div className="page-content">
                {blocks.map((b) => (
                  <BlockView key={b.id} slice={{ block: b, from: 0, to: b.rows.length, first: true, last: true }} measure />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 설비 전체 인쇄의 목차 */
function IndexPage({ rows, bookName }: { rows: { p: Project; from: number; to: number; rules: RuleResult[] }[]; bookName: string }) {
  return (
    <div className="index-page">
      <h1>{bookName || tr('설비', 'Machine')}</h1>
      <p className="muted">{tr(`타임차트 ${rows.length}장`, `${rows.length} timing charts`)}</p>
      <table className="rtable">
        <thead>
          <tr>
            <th>No</th>
            <th>{tr('차트', 'Chart')}</th>
            <th>{tr('제목', 'Title')}</th>
            <th>{tr('사이클 타임', 'Cycle time')}</th>
            <th>{tr('스텝', 'Steps')}</th>
            <th>{tr('규칙 검증', 'Checks')}</th>
            <th>Rev.</th>
            <th>{tr('페이지', 'Pages')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const c = cycleSummary(r.p);
            const ng = r.rules.filter((x) => x.status === 'fail').length;
            const ok = r.rules.filter((x) => x.status === 'ok').length;
            return (
              <tr key={r.p.id}>
                <td>{i + 1}</td>
                <td>
                  <b>{sheetName(r.p)}</b>
                </td>
                <td>{r.p.meta.title}</td>
                <td className="mono">{r.p.steps.length ? formatTime(c.total, r.p.settings.timeUnit) : '-'}</td>
                <td>{r.p.steps.length}</td>
                <td>{r.rules.length ? <span className={`status ${ng ? 'fail' : 'ok'}`}>{ng ? `NG ${ng}` : `OK ${ok}`}</span> : '-'}</td>
                <td>{r.p.meta.revision}</td>
                <td className="mono">{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function nextRev(revs: string[]): string {
  const last = revs[revs.length - 1];
  if (!last) return 'A';
  if (/^[A-Y]$/.test(last)) return String.fromCharCode(last.charCodeAt(0) + 1);
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  return last + "'";
}

function TitleBlock({ project, page, total, portrait }: { project: Project; page: number; total: number; portrait: boolean }) {
  const m = project.meta;
  // 칸 너비 (mm 비율): 세로 용지에서도 제목·설비·도면번호가 잘리지 않게
  const w = portrait ? [30, 12, 36, 15, 31, 16, 16, 16, 14] : [42, 14, 58, 18, 48, 24, 24, 24, 20];
  return (
    <table className={`titleblock ${portrait ? 'portrait' : ''}`} style={{ height: `${TITLEBLOCK_MM}mm` }}>
      <colgroup>
        {w.map((x, i) => (
          <col key={i} style={{ width: `${x}%` }} />
        ))}
      </colgroup>
      <tbody>
        <tr>
          <td rowSpan={2} className="tb-company">
            {m.logo && <img src={m.logo} alt="" className="tb-logo" />}
            {m.company ? <span className={m.logo ? 'tb-company-name small' : 'tb-company-name'}>{m.company}</span> : m.logo ? null : ' '}
          </td>
          <th>{tr('제목', 'TITLE')}</th>
          <td colSpan={3} className="tb-title">
            {m.title}
          </td>
          {(m.signLabels ?? [tr('작성', 'DRAWN'), tr('검토', 'CHECKED'), tr('승인', 'APPROVED')]).slice(0, 3).map((l, k) => (
            <th key={k}>{l}</th>
          ))}
          <th>{tr('페이지', 'PAGE')}</th>
        </tr>
        <tr>
          <th>{tr('설비', 'MACHINE')}</th>
          <td className="tb-wrap">{m.machine}</td>
          <th>{tr('도면번호', 'DWG NO.')}</th>
          <td className="tb-wrap">
            {m.drawingNo} {m.revision && <span className="tb-rev">Rev.{m.revision}</span>}
          </td>
          <td className="sign">
            {m.author}
            <small>{m.date}</small>
          </td>
          <td className="sign">{m.checker}</td>
          <td className="sign">{m.approver}</td>
          <td className="tb-page">
            {page} / {total}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function BlockView({ slice, measure }: { slice: Slice; measure?: boolean }) {
  const { block: b, from, to, first, last } = slice;
  return (
    <section className="rblock" data-block={measure ? b.id : undefined}>
      <h3 className="rblock-title">
        {b.title}
        {!first && <span className="rblock-cont">{tr(' (계속)', ' (cont.)')}</span>}
      </h3>
      {first && b.pre && <div className="rblock-pre">{b.pre}</div>}
      {(b.rows.length > 0 || measure) && (
        <table className="rtable">
          {b.cols}
          <thead>{b.head}</thead>
          <tbody>{b.rows.slice(from, to)}</tbody>
          {last && b.foot && <tfoot>{b.foot}</tfoot>}
        </table>
      )}
    </section>
  );
}

const EST: Meas = { title: 8, pre: 0, head: 7, foot: 6.5, rows: [] };

/** 표 조각을 페이지에 채운다. 조각마다 최소 3줄(또는 남은 줄 전부)은 같이 싣는다. */
export function paginateBlocks(blocks: { id: string; rows: unknown[]; hasPre?: boolean; hasFoot?: boolean }[], meas: Record<string, Meas>, cap: number): { id: string; from: number; to: number; first: boolean; last: boolean }[][] {
  const pages: { id: string; from: number; to: number; first: boolean; last: boolean }[][] = [];
  let cur: (typeof pages)[number] = [];
  let used = 0;
  const GAP = 3;
  for (const b of blocks) {
    const m = meas[b.id] ?? { ...EST, pre: b.hasPre ? 32 : 0 };
    const rowH = (i: number) => m.rows[i] ?? 6.2;
    const n = b.rows.length;
    let i = 0;
    let first = true;
    while (first || i < n) {
      const top = m.title + (first ? m.pre : 0) + m.head + GAP;
      const minRows = Math.min(3, n - i);
      let minNeed = top;
      for (let k = 0; k < minRows; k++) minNeed += rowH(i + k);
      if (i + minRows === n && b.hasFoot) minNeed += m.foot;
      if (cur.length && used + minNeed > cap) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      let j = i;
      let h = top;
      while (j < n && used + h + rowH(j) + (j + 1 === n && b.hasFoot ? m.foot : 0) <= cap) {
        h += rowH(j);
        j++;
      }
      if (j === i && n > 0) {
        h += rowH(i);
        j = i + 1;
      }
      const last = j >= n;
      if (last && b.hasFoot) h += m.foot;
      cur.push({ id: b.id, from: i, to: j, first, last });
      used += h;
      first = false;
      i = j;
      if (!last) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
    }
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** 차트 행 높이를 바꾼 사본 (보고서 페이지에 맞춰 늘리거나 줄임) */
function withRowScale(project: Project, k: number): Project {
  if (Math.abs(k - 1) < 0.02) return project;
  return { ...project, settings: { ...project.settings, rowHeight: Math.max(16, Math.round(project.settings.rowHeight * k)) } };
}

function GrayLegend() {
  const item = (fill: string, opacity: number, label: string) => (
    <span className="gl-item">
      <svg width="26" height="12" aria-hidden="true">
        <defs>
          <GrayPatternDefs idp="lg" />
        </defs>
        <rect x={0.5} y={0.5} width={25} height={11} fill={fill} fillOpacity={opacity} stroke="#111827" />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="gray-legend">
      {item('#374151', 0.32, tr('출력 (SOL · 모터)', 'Output'))}
      {item('url(#lg-ghatch)', 1, tr('입력 · 센서', 'Input / sensor'))}
      {item('#4b5563', 0.22, tr('실린더 동작', 'Cylinder motion'))}
      {item('#6b7280', 0.16, tr('타이머 · 내부', 'Timer / internal'))}
    </div>
  );
}

function kpis(project: Project, rules: RuleResult[], compact = false) {
  const c = cycleSummary(project);
  const u = project.settings.timeUnit;
  const ok = rules.filter((r) => r.status === 'ok').length;
  const ng = rules.filter((r) => r.status === 'fail').length;
  const target = project.rules.find((r) => r.type === 'cycle');
  return (
    <div className={`kpis ${compact ? 'compact' : ''}`}>
      <div className="kpi">
        <span>{tr('사이클 타임', 'Cycle time')}</span>
        <b>{formatTime(c.total, u)}</b>
      </div>
      {target && target.type === 'cycle' && (
        <div className={`kpi ${c.total <= target.max ? 'good' : 'bad'}`}>
          <span>{tr('목표', 'Target')}</span>
          <b>
            {formatTime(target.max, u)} {c.total <= target.max ? 'OK' : 'NG'}
          </b>
        </div>
      )}
      <div className="kpi">
        <span>{tr('공정 스텝', 'Steps')}</span>
        <b>{project.steps.length}</b>
      </div>
      <div className={`kpi ${ng ? 'bad' : rules.length ? 'good' : ''}`}>
        <span>{tr('규칙 검증', 'Rule check')}</span>
        <b>{rules.length ? `OK ${ok} / NG ${ng}` : '-'}</b>
      </div>
    </div>
  );
}

function buildPages(project: Project, o: ReportOpts, size: { w: number; h: number }, rules: RuleResult[], blocks: Block[], meas: Record<string, Meas>): PageDef[] {
  const pages: PageDef[] = [];
  const u = project.settings.timeUnit;
  const contentW = (size.w - 2 * MARGIN) * MM;
  const contentHmm = bodyHeight(size, o);
  const contentH = contentHmm * MM;
  const visible = project.signals.filter((s) => !s.hidden);
  const d = project.settings.duration;
  const violations = o.violations ? rules.flatMap((r) => r.violations) : [];
  const legendH = o.grayscale ? 7 * MM : 0;

  if (o.layout === 'one') {
    pages.push({ kind: 'one', title: tr('타임차트', 'Timing chart'), body: onePage(project, o, contentW, contentHmm, rules, violations) });
    return pages;
  }

  if (o.cover) {
    const g = computeLayout(project, { includeHidden: false });
    const natH = g.headerH + g.bodyH;
    const revRows = Math.min(project.revisions.length, 4);
    const thumbH = contentH - 46 * MM - (revRows ? (revRows + 1) * 6 * MM + 4 * MM : 0) - legendH;
    pages.push({
      kind: 'cover',
      title: tr('요약', 'Summary'),
      body: (
        <div className="cover">
          <div className="cover-top">
            <div>
              <h1>{project.meta.title}</h1>
              <p className="cover-machine">{project.meta.machine}</p>
              {project.meta.description && <p className="cover-desc">{project.meta.description}</p>}
            </div>
            {kpis(project, rules)}
          </div>
          {visible.length > 0 && (
            <div className="cover-thumb" style={{ maxHeight: Math.max(80, thumbH) }}>
              <ChartSvg project={project} width={contentW} idp="cov" grayscale={o.grayscale} violations={violations} />
              {natH > thumbH && <div className="fade" />}
            </div>
          )}
          {o.grayscale && visible.length > 0 && <GrayLegend />}
          {project.revisions.length > 0 && (
            <table className="rtable rev-table">
              <thead>
                <tr>
                  <th>Rev.</th>
                  <th>{tr('날짜', 'Date')}</th>
                  <th>{tr('내용', 'Description')}</th>
                  <th>{tr('작성', 'By')}</th>
                </tr>
              </thead>
              <tbody>
                {project.revisions.slice(-4).map((r, i) => (
                  <tr key={i}>
                    <td>{r.rev}</td>
                    <td>{r.date}</td>
                    <td>{r.description}</td>
                    <td>{r.author}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ),
    });
  }

  if (o.chart && visible.length) {
    // 행 분할: 페이지 높이에 맞게
    const full = computeLayout(project, { includeHidden: false });
    const bodyAvail = contentH - full.headerH - 4 - legendH;
    // 25% 이내로 넘치면 행을 낮춰 한 페이지에, 그 이상이면 신호를 여러 페이지로 나눈다
    const squeeze = full.bodyH > bodyAvail && full.bodyH <= bodyAvail / 0.75;
    const stretch = o.stretch && full.bodyH < bodyAvail * 0.8 ? Math.min(1.6, bodyAvail / full.bodyH) : 1;
    const k = squeeze ? bodyAvail / full.bodyH : stretch;
    const proj = withRowScale(project, k);
    const lay = computeLayout(proj, { includeHidden: false });
    const rowGroups: Signal[][] = [];
    let cur: Signal[] = [];
    let used = 0;
    for (const r of lay.rows) {
      const extra = r.h + (r.signal.group && !cur.some((s) => s.group === r.signal.group) ? lay.groupH : 0);
      if (cur.length && used + extra > bodyAvail) {
        rowGroups.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(r.signal);
      used += extra;
    }
    if (cur.length) rowGroups.push(cur);
    const lw = labelWidths(proj, visible).total;
    const waveW = contentW - lw - 14;
    const span = o.timePerPage > 0 ? Math.min(o.timePerPage, d) : d;
    const px = waveW / span;
    const nT = Math.max(1, Math.ceil(d / span - 1e-9));
    for (let ti = 0; ti < nT; ti++) {
      const t0 = ti * span;
      const t1 = Math.min(t0 + span, d);
      rowGroups.forEach((rg, ri) => {
        const ids = new Set(rg.map((s) => s.id));
        const label = [nT > 1 ? `${formatTime(t0, u)} ~ ${formatTime(t1, u)}` : '', rowGroups.length > 1 ? `${tr('신호', 'signals')} ${ri + 1}/${rowGroups.length}` : ''].filter(Boolean).join(' · ');
        pages.push({
          kind: 'chart',
          title: tr('타임차트', 'Timing chart') + (label ? ` (${label})` : ''),
          body: (
            <div className="chart-page">
              <ChartSvg project={proj} t0={t0} t1={t0 + span} px={px} signalIds={ids} idp={`p${ti}_${ri}`} grayscale={o.grayscale} violations={violations} style={{ maxHeight: `${contentH - legendH}px`, width: 'auto', maxWidth: '100%' }} />
              {o.grayscale && <GrayLegend />}
            </div>
          ),
        });
      });
    }
  }

  // 표: 짧은 표는 한 페이지에 모으고, 긴 표는 제목 줄을 되풀이하며 다음 페이지로 잇는다
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const tablePages = paginateBlocks(
    blocks.map((b) => ({ id: b.id, rows: b.rows, hasPre: !!b.pre, hasFoot: !!b.foot })),
    meas,
    contentHmm - 2,
  );
  for (const pg of tablePages) {
    const slices: Slice[] = pg.map((s) => ({ ...s, block: byId.get(s.id)! }));
    const titles = [...new Set(slices.map((s) => s.block.title))];
    pages.push({
      kind: 'tables',
      title: titles.join(' · '),
      body: (
        <div className="tables-page">
          {slices.map((s, i) => (
            <BlockView key={`${s.block.id}-${s.from}-${i}`} slice={s} />
          ))}
        </div>
      ),
    });
  }

  if (!pages.length) pages.push({ kind: 'empty', title: '', body: <p className="muted">{tr('출력할 내용이 없습니다. 왼쪽에서 항목을 선택하세요.', 'Nothing to print. Select sections on the left.')}</p> });
  return pages;
}

/** 한 장: 제목·KPI → 전체 차트(페이지에 맞춤) → 공정 스텝 표 */
function onePage(project: Project, o: ReportOpts, contentW: number, contentHmm: number, rules: RuleResult[], violations: RuleResult['violations']): ReactNode {
  const visible = project.signals.filter((s) => !s.hidden);
  const u = project.settings.timeUnit;
  const c = cycleSummary(project);
  const topMm = 17;
  const legendMm = o.grayscale ? 7 : 0;
  const steps = o.steps ? c.steps : [];
  const landscape = o.orientation === 'landscape';
  // 스텝 표: 가로 용지는 2~3단으로 나눠 높이를 줄인다
  let cols = landscape ? 2 : 1;
  const rowMm = 5.1;
  const headMm = 5.6;
  const stepH = (n: number, k: number) => (n ? headMm + Math.ceil(n / k) * rowMm + 1.5 : 0);
  while (cols < 3 && stepH(steps.length, cols) > contentHmm * 0.3) cols++;
  const stepsMm = Math.min(stepH(steps.length, cols), contentHmm * 0.34);
  // 그래도 넘치면 앞쪽 스텝만 싣고 몇 개를 뺐는지 적는다
  const fitRows = Math.max(1, Math.floor((stepsMm - headMm - 1.5) / rowMm));
  const chartMm = contentHmm - topMm - legendMm - stepsMm - 3;
  const chartH = chartMm * MM;
  // 행 높이를 늘리거나 줄여 차트를 남은 높이에 맞춘다 (글자는 그대로, 넘치면 전체 축소)
  const g0 = chartGeometry(project, { width: contentW });
  const layout0 = computeLayout(project, { includeHidden: false });
  const fixedH = g0.height - layout0.bodyH;
  let k = (chartH - fixedH) / Math.max(layout0.bodyH, 1);
  if (!o.stretch) k = Math.min(k, 1);
  k = Math.min(1.6, Math.max(k, 0.5));
  const proj = withRowScale(project, k);
  const ng = rules.filter((r) => r.status === 'fail');
  const shown = steps.slice(0, fitRows * cols);
  const perCol = Math.ceil(shown.length / cols);
  const hidden = steps.length - shown.length;
  const maxDur = Math.max(...steps.map((r) => r.duration), 1);
  return (
    <div className="one-page">
      <div className="one-top" style={{ height: `${topMm}mm` }}>
        <div className="one-title">
          <h1>{project.meta.title}</h1>
          <p>
            {[project.meta.machine, project.meta.drawingNo && `${tr('도면', 'DWG')} ${project.meta.drawingNo}`, project.meta.description].filter(Boolean).join('  ·  ')}
            {ng.length > 0 && <span className="one-ng"> · NG: {ng.map((r) => r.rule.name).join(', ')}</span>}
          </p>
        </div>
        {kpis(project, rules, true)}
      </div>
      {visible.length > 0 ? (
        <div className="one-chart" style={{ height: `${chartMm}mm` }}>
          <ChartSvg project={proj} width={contentW} idp="one" grayscale={o.grayscale} violations={violations} style={{ maxHeight: `${chartH}px`, maxWidth: '100%', width: 'auto', height: 'auto' }} />
        </div>
      ) : (
        <p className="muted">{tr('신호가 없습니다.', 'No signals.')}</p>
      )}
      {o.grayscale && <GrayLegend />}
      {steps.length > 0 && (
        <div className="one-steps" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxHeight: `${stepsMm}mm` }}>
          {Array.from({ length: cols }, (_, ci) => (
            <table key={ci} className="rtable compact">
              <thead>
                <tr>
                  <th>{tr('스텝', 'Step')}</th>
                  <th>{tr('시작', 'Start')}</th>
                  <th>{tr('시간', 'Time')}</th>
                  <th style={{ width: '28%' }}>{tr('비율', 'Share')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(ci * perCol, (ci + 1) * perCol).map((r) => (
                  <tr key={r.step.id} className={c.longest?.id === r.step.id ? 'longest' : ''}>
                    <td className="ellipsis">{r.step.label}</td>
                    <td className="mono">{formatTime(r.step.start, u)}</td>
                    <td className="mono">
                      <b>{formatTime(r.duration, u)}</b>
                    </td>
                    <td>
                      <div className="bar">
                        <div className="bar-fill" style={{ width: `${(r.duration / maxDur) * 100}%`, background: o.grayscale ? '#6b7280' : undefined }} />
                        <span>{(r.share * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {hidden > 0 && ci === cols - 1 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {tr(`… 스텝 ${hidden}개 더 (여러 장 보고서에 전체)`, `… ${hidden} more steps (see full report)`)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}

/** 여러 장 보고서의 표들 */
function tableBlocks(project: Project, o: ReportOpts, rules: RuleResult[]): Block[] {
  const blocks: Block[] = [];
  const u = project.settings.timeUnit;
  const visible = project.signals.filter((s) => !s.hidden);
  const d = project.settings.duration;
  const c = cycleSummary(project);

  if (o.sequence && project.sequence) blocks.push(...sequenceBlocks(project.sequence));

  if (o.signals && visible.length) {
    blocks.push({
      id: 'signals',
      title: tr('신호(I/O) 목록', 'Signal (I/O) list'),
      head: (
        <tr>
          <th>No</th>
          <th>{tr('주소', 'Address')}</th>
          <th>{tr('신호명', 'Name')}</th>
          <th>{tr('설명', 'Comment')}</th>
          <th>{tr('구분', 'Role')}</th>
          <th>{tr('동작 (ON/OFF)', 'Levels')}</th>
          <th>{tr('ON 횟수', 'ON count')}</th>
          <th>{tr('최초 ON', 'First ON')}</th>
          <th>{tr('ON 시간 합계', 'ON total')}</th>
        </tr>
      ),
      rows: visible.map((s, i) => {
        const st = signalStats(s, d);
        const bit = s.kind === 'bit' || s.kind === 'clock';
        return (
          <tr key={s.id}>
            <td>{i + 1}</td>
            <td className="mono">{s.address}</td>
            <td>
              <span className="lcolor" style={{ background: o.grayscale ? '#374151' : s.color }} /> {s.name}
            </td>
            <td>{s.comment}</td>
            <td>{tr(roleLabelKo(s.role), s.role)}</td>
            <td>{s.onLabel || s.offLabel ? `${s.onLabel ?? ''} / ${s.offLabel ?? ''}` : s.kind === 'bit' ? 'ON / OFF' : s.kind}</td>
            <td>{bit ? st.onCount : ''}</td>
            <td>{bit && st.firstOn !== null ? formatTime(st.firstOn, u) : ''}</td>
            <td>{bit ? formatTime(st.onTotal, u) : ''}</td>
          </tr>
        );
      }),
    });
  }

  if (o.steps && project.steps.length) {
    const max = Math.max(...c.steps.map((r) => r.duration), 1);
    const ganttRows = c.steps.slice(0, 18);
    blocks.push({
      id: 'steps',
      title: tr('공정 스텝 · 사이클 타임', 'Process steps & cycle time'),
      pre: (
        <div className="steps-summary">
          <div className="kpi">
            <span>{tr('사이클 타임', 'Cycle time')}</span>
            <b>{formatTime(c.total, u)}</b>
          </div>
          {c.longest && (
            <div className="kpi bad">
              <span>{tr('최장 스텝 (병목)', 'Bottleneck')}</span>
              <b>
                {c.longest.label} · {formatTime(c.longest.end - c.longest.start, u)}
              </b>
            </div>
          )}
          <svg className="gantt" viewBox={`0 0 600 ${ganttRows.length * 14 + 4}`} preserveAspectRatio="none">
            {ganttRows.map((r, i) => {
              const x = ((r.step.start - c.start) / Math.max(c.total, 1)) * 600;
              const w = Math.max(1.5, (r.duration / Math.max(c.total, 1)) * 600);
              return <rect key={r.step.id} x={x} y={i * 14 + 2} width={w} height={10} rx={2} fill={o.grayscale ? (c.longest?.id === r.step.id ? '#111827' : '#6b7280') : c.longest?.id === r.step.id ? '#dc2626' : '#2563eb'} />;
            })}
          </svg>
        </div>
      ),
      head: (
        <tr>
          <th>No</th>
          <th>{tr('스텝', 'Step')}</th>
          <th>{tr('시작', 'Start')}</th>
          <th>{tr('종료', 'End')}</th>
          <th>{tr('시간', 'Time')}</th>
          <th style={{ width: '22%' }}>{tr('비율', 'Share')}</th>
          <th>{tr('동작 내용', 'Description')}</th>
        </tr>
      ),
      rows: c.steps.map((r, i) => (
        <tr key={r.step.id}>
          <td>{i + 1}</td>
          <td>{r.step.label}</td>
          <td>{formatTime(r.step.start, u)}</td>
          <td>{formatTime(r.step.end, u)}</td>
          <td>
            <b>{formatTime(r.duration, u)}</b>
          </td>
          <td>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${(r.duration / max) * 100}%`, background: o.grayscale ? '#6b7280' : undefined }} />
              <span>{(r.share * 100).toFixed(1)}%</span>
            </div>
          </td>
          <td>{r.step.description}</td>
        </tr>
      )),
      foot: (
        <tr>
          <td />
          <td>{tr('합계', 'Total')}</td>
          <td>{formatTime(c.start, u)}</td>
          <td>{formatTime(c.end, u)}</td>
          <td>
            <b>{formatTime(c.total, u)}</b>
          </td>
          <td>100%</td>
          <td />
        </tr>
      ),
    });
  }

  if (o.events) {
    const hasIo = visible.some(isIoSignal);
    const evs = sequenceEvents(project, hasIo ? isIoSignal : undefined);
    if (evs.length)
      blocks.push({
        id: 'events',
        title: tr('입출력 변화 순서', 'Sequence of events') + (hasIo ? tr(' (실제 입출력)', ' (real I/O)') : ''),
        head: (
          <tr>
            <th>No</th>
            <th>{tr('시각', 'Time')}</th>
            <th>{tr('간격', 'Δt')}</th>
            <th>{tr('공정 스텝', 'Step')}</th>
            <th>{tr('주소', 'Address')}</th>
            <th>{tr('신호명', 'Name')}</th>
            <th>{tr('변화', 'Change')}</th>
          </tr>
        ),
        rows: evs.map((e, i) => {
          const newStep = !!e.step && (i === 0 || evs[i - 1].step?.id !== e.step.id);
          return (
            <tr key={i} className={newStep ? 'step-start' : ''}>
              <td>{i + 1}</td>
              <td className="mono">{formatTime(e.t, u)}</td>
              <td className="mono">{e.dt !== null ? `+${formatTime(e.dt, u)}` : ''}</td>
              <td>{newStep ? <b>{e.step!.label}</b> : ''}</td>
              <td className="mono">{e.signal.address}</td>
              <td>{e.signal.name}</td>
              <td>{e.kind === 'on' ? `↑ ${e.value}` : e.kind === 'off' ? `↓ ${e.value}` : `= ${e.value}`}</td>
            </tr>
          );
        }),
      });
  }

  if (o.rules && rules.length) {
    const nameOf = (id: string) => sigLabel(project.signals.find((s) => s.id === id));
    const cond = (r: RuleResult['rule']): string => {
      const lim = (min?: number, max?: number) => [min !== undefined ? `≥ ${formatTime(min, u)}` : '', max !== undefined ? `≤ ${formatTime(max, u)}` : ''].filter(Boolean).join(', ');
      switch (r.type) {
        case 'delay':
          return `${nameOf(r.fromSignal)} ${r.fromEdge === 'rise' ? '↑' : '↓'} → ${nameOf(r.toSignal)} ${r.toEdge === 'rise' ? '↑' : '↓'}   ${lim(r.min, r.max)}`;
        case 'exclusive':
          return `${nameOf(r.a)} / ${nameOf(r.b)} ${tr('동시 ON 금지', 'never both ON')}`;
        case 'pulse':
          return `${nameOf(r.signal)} ${r.level ? 'ON' : 'OFF'} ${tr('폭', 'width')} ${lim(r.min, r.max)}`;
        case 'cycle':
          return `${tr('사이클 타임', 'Cycle time')} ≤ ${formatTime(r.max, u)}`;
      }
    };
    blocks.push({
      id: 'rules',
      title: tr('타이밍 규칙 검증', 'Timing rule check'),
      head: (
        <tr>
          <th>No</th>
          <th>{tr('결과', 'Result')}</th>
          <th>{tr('규칙', 'Rule')}</th>
          <th>{tr('조건', 'Condition')}</th>
          <th>{tr('측정값', 'Measured')}</th>
          <th>{tr('위반 내용', 'Violations')}</th>
        </tr>
      ),
      rows: rules.map((r, i) => (
        <tr key={r.rule.id}>
          <td>{i + 1}</td>
          <td>
            <span className={`status ${r.status}`}>{r.status === 'ok' ? 'OK' : r.status === 'fail' ? 'NG' : 'N/A'}</span>
          </td>
          <td>{r.rule.name}</td>
          <td>{cond(r.rule)}</td>
          <td>{r.measured}</td>
          <td className="small">
            {r.violations.slice(0, 4).map((v, k) => (
              <div key={k}>{v.message}</div>
            ))}
            {r.violations.length > 4 && <div>+{r.violations.length - 4}</div>}
          </td>
        </tr>
      )),
    });
  }

  if (o.annotations && project.annotations.length) {
    const nameOf = (id: string | null) => (id ? sigLabel(project.signals.find((s) => s.id === id)) : tr('(전체)', '(all)'));
    const rows = project.annotations.map((a) => {
      switch (a.type) {
        case 'arrow':
          return { kind: tr('인과/인터록', 'Cause → effect'), what: `${nameOf(a.from.signalId)} @${formatTime(a.from.t, u)} → ${nameOf(a.to.signalId)} @${formatTime(a.to.t, u)}`, value: formatTime(a.to.t - a.from.t, u), label: a.label };
        case 'dimension':
          return { kind: tr('치수', 'Dimension'), what: `${nameOf(a.signalId)}  ${formatTime(a.t1, u)} ~ ${formatTime(a.t2, u)}`, value: formatTime(Math.abs(a.t2 - a.t1), u), label: a.label };
        case 'note':
          return { kind: tr('메모', 'Note'), what: `${nameOf(a.signalId)} @${formatTime(a.t, u)}`, value: '', label: a.text };
        case 'marker':
          return { kind: tr('마커', 'Marker'), what: `@${formatTime(a.t, u)}`, value: '', label: a.label };
      }
    });
    blocks.push({
      id: 'annotations',
      title: tr('인터록 · 주석 목록', 'Interlocks & notes'),
      head: (
        <tr>
          <th>No</th>
          <th>{tr('종류', 'Type')}</th>
          <th>{tr('대상', 'Target')}</th>
          <th>{tr('시간', 'Time')}</th>
          <th>{tr('내용', 'Label')}</th>
        </tr>
      ),
      rows: rows.map((r, i) => (
        <tr key={i}>
          <td>{i + 1}</td>
          <td>{r.kind}</td>
          <td>{r.what}</td>
          <td>
            <b>{r.value}</b>
          </td>
          <td>{r.label}</td>
        </tr>
      )),
    });
  }
  return blocks;
}

/** 동작 순서 탭의 설계 표: 기기 · 동작 시간, 동작 순서 (출력 → 확인 센서) */
function sequenceBlocks(spec: SeqSpec): Block[] {
  const tl = computeTimeline(spec);
  const io = ioPoints(spec);
  const addr = (dev: string, kind: string) => io.find((p) => p.device === dev && p.kind === kind);
  const devRows = spec.devices.map((d, i) => (
    <tr key={d.id}>
      <td>{i + 1}</td>
      <td>
        <b>{d.name}</b>
      </td>
      <td>{KIND_LABEL[d.kind]}</td>
      <td>{d.fwdLabel}</td>
      <td className="mono">{fmtSec(d.fwdTime)} s</td>
      <td>{d.kind === 'motor' ? '' : d.retLabel}</td>
      <td className="mono">{d.kind === 'motor' ? '' : `${fmtSec(d.retTime)} s`}</td>
      <td>{sensorText(d)}</td>
    </tr>
  ));
  let timer = 0;
  const actRows = tl.items.map((it, i) => {
    const a = it.action;
    const d = spec.devices.find((x) => x.id === a.device);
    let out = '';
    let done = '';
    if (!a.device) {
      out = spec.addrStyle === 'none' ? '' : spec.addrStyle === 'siemens' ? `T${timer + 1}` : spec.addrStyle === 'ls' ? `T${String(timer).padStart(4, '0')}` : `T${timer}`;
      done = out;
      timer++;
    } else if (d) {
      const o = d.kind === 'cyl2' ? addr(d.id, a.dir === 'fwd' ? 'fwdOut' : 'retOut') : addr(d.id, 'fwdOut');
      const sen = addr(d.id, a.dir === 'fwd' ? 'fwdSen' : 'retSen');
      const off = d.kind !== 'cyl2' && a.dir === 'ret';
      out = o ? `${o.address || o.name}${off ? ' OFF' : ' ON'}` : '';
      done = sen ? sen.address || sen.name : '';
    }
    const prevGroup = i > 0 ? tl.items[i - 1].group : -1;
    return (
      <tr key={a.id} className={it.group !== prevGroup ? 'step-start' : ''}>
        <td>{it.group !== prevGroup ? `S${(it.group + 1) * 10}` : ''}</td>
        <td>{d ? d.name : tr('대기', 'Wait')}</td>
        <td>{d ? (a.dir === 'fwd' ? d.fwdLabel : d.retLabel) : a.label}</td>
        <td className="mono">{fmtSec(it.end - it.start)} s</td>
        <td>{startText(a, i === 0, spec.startButton)}</td>
        <td className="mono">
          {fmtSec(it.start)} ~ {fmtSec(it.end)}
        </td>
        <td className="mono">{out}</td>
        <td className="mono">{done}</td>
      </tr>
    );
  });
  const cycle = tl.cycleEnd - tl.cycleStart;
  return [
    {
      id: 'seq-devices',
      title: tr('동작 기기 · 동작 시간', 'Devices & motion times'),
      head: (
        <tr>
          <th>No</th>
          <th>{tr('기기', 'Device')}</th>
          <th>{tr('종류', 'Type')}</th>
          <th>{tr('가는 동작', 'Go')}</th>
          <th>{tr('시간', 'Time')}</th>
          <th>{tr('돌아오는 동작', 'Return')}</th>
          <th>{tr('시간', 'Time')}</th>
          <th>{tr('끝 센서', 'Sensors')}</th>
        </tr>
      ),
      rows: devRows,
    },
    {
      id: 'seq-actions',
      title: tr('동작 순서표 (설계)', 'Sequence table (design)'),
      head: (
        <tr>
          <th>{tr('스텝', 'Step')}</th>
          <th>{tr('기기', 'Device')}</th>
          <th>{tr('동작', 'Motion')}</th>
          <th>{tr('시간', 'Time')}</th>
          <th>{tr('시작 조건', 'Starts')}</th>
          <th>{tr('시각 (s)', 'At (s)')}</th>
          <th>{tr('출력', 'Output')}</th>
          <th>{tr('완료 확인', 'Done by')}</th>
        </tr>
      ),
      rows: actRows,
      foot: (
        <tr>
          <td />
          <td colSpan={2}>{tr('사이클 타임', 'Cycle time')}</td>
          <td className="mono">
            <b>{fmtSec(cycle)} s</b>
          </td>
          <td colSpan={4}>{spec.targetCycle > 0 ? `${tr('목표', 'Target')} ${fmtSec(spec.targetCycle)} s · ${cycle <= spec.targetCycle ? 'OK' : 'NG'}` : ''}</td>
        </tr>
      ),
    },
  ];
}
