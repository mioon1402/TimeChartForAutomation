import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Project, Signal } from '../model/types';
import { checkRules, cycleSummary, isIoSignal, sequenceEvents, signalStats, sigLabel, type RuleResult } from '../model/analysis';
import { formatTime, todayString } from '../model/format';
import { computeLayout } from '../render/layout';
import { labelWidths } from '../render/ChartParts';
import { ChartSvg } from '../render/ChartSvg';
import { roleLabelKo } from '../io/csv';
import { Check, Field, Icon, Select, TextInput, TimeInput } from './ui';
import { tr } from '../i18n';
import { storageGet, storageSet } from '../storage';
import { WEB_TRIAL } from '../env';

interface ReportOpts {
  paper: 'A4' | 'A3';
  orientation: 'landscape' | 'portrait';
  cover: boolean;
  chart: boolean;
  signals: boolean;
  steps: boolean;
  /** 동작 순서표 (신호 변화 시간순) */
  events: boolean;
  rules: boolean;
  annotations: boolean;
  /** 페이지당 시간 (0 = 한 페이지에 전체) */
  timePerPage: number;
  grayscale: boolean;
  violations: boolean;
}

const OPTS_KEY = 'timechart-studio.report.v1';
const MM = 3.7795;
const MARGIN = 10;
const HEAD_MM = 9;
const TITLEBLOCK_MM = 21;

function loadOpts(): ReportOpts {
  const def: ReportOpts = { paper: 'A4', orientation: 'landscape', cover: true, chart: true, signals: true, steps: true, events: true, rules: true, annotations: true, timePerPage: 0, grayscale: false, violations: true };
  try {
    return { ...def, ...JSON.parse(storageGet(OPTS_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

function paperSize(o: ReportOpts): { w: number; h: number } {
  const base = o.paper === 'A3' ? { w: 420, h: 297 } : { w: 297, h: 210 };
  return o.orientation === 'landscape' ? base : { w: base.h, h: base.w };
}

interface PageDef {
  kind: string;
  title: string;
  body: ReactNode;
}

export function ReportPanel() {
  const project = useStore((s) => s.project);
  const { setMeta, commit } = useStore.getState();
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

  const rules = useMemo(() => checkRules(project), [project]);
  const pages = useMemo(() => buildPages(project, o, size, rules), [project, o, size.w, size.h, rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = project.meta;
  const addRevision = () => {
    commit({ ...project, revisions: [...project.revisions, { rev: nextRev(project.revisions.map((r) => r.rev)), date: todayString(), description: '', author: m.author }] });
  };

  return (
    <div className="report">
      <aside className="report-side">
        <div className="plc-head">
          <h3>
            <Icon name="report" /> {tr('보고서', 'Report')}
          </h3>
        </div>
        {WEB_TRIAL ? (
          <p className="trial-note">
            {tr('온라인 체험판에서는 인쇄와 PDF 저장이 막혀 있습니다. 보고서를 출력하려면 파일 버전(TimeChartStudio.html)을 PC에서 여세요. 미리보기는 여기서 그대로 확인할 수 있습니다.', 'Printing is blocked in the online trial. Open the file version (TimeChartStudio.html) on your PC to print. The preview below is the same.')}
          </p>
        ) : (
          <>
            <button type="button" className="btn primary run" onClick={() => window.print()}>
              <Icon name="print" /> {tr('인쇄 / PDF 저장', 'Print / Save PDF')}
            </button>
            <p className="muted small">{tr('인쇄 대화상자에서 "PDF로 저장"을 선택하세요. 배경 그래픽 옵션을 켜면 색상이 그대로 출력됩니다.', 'Choose "Save as PDF" in the print dialog. Enable background graphics for colors.')}</p>
          </>
        )}
        <div className="grid2">
          <Field label={tr('용지', 'Paper')}>
            <Select value={o.paper} onChange={(v) => set({ paper: v })} options={[{ value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }]} />
          </Field>
          <Field label={tr('방향', 'Orientation')}>
            <Select value={o.orientation} onChange={(v) => set({ orientation: v })} options={[{ value: 'landscape', label: tr('가로', 'Landscape') }, { value: 'portrait', label: tr('세로', 'Portrait') }]} />
          </Field>
        </div>
        <Field label={tr('페이지당 시간 (비우면 전체를 한 장에)', 'Time per page (empty = fit)')} wide>
          <TimeInput value={o.timePerPage || undefined} allowEmpty onChange={(v) => set({ timePerPage: v ?? 0 })} placeholder={tr('자동', 'auto')} />
        </Field>
        <div className="checks">
          <Check checked={o.cover} onChange={(v) => set({ cover: v })} label={tr('표지 · 요약', 'Cover & summary')} />
          <Check checked={o.chart} onChange={(v) => set({ chart: v })} label={tr('타임차트', 'Timing chart')} />
          <Check checked={o.signals} onChange={(v) => set({ signals: v })} label={tr('신호(I/O) 목록', 'Signal (I/O) list')} />
          <Check checked={o.steps} onChange={(v) => set({ steps: v })} label={tr('공정 스텝 · 사이클 타임', 'Steps & cycle time')} />
          <Check checked={o.events} onChange={(v) => set({ events: v })} label={tr('동작 순서표 (입출력 변화 시간순)', 'Sequence of events')} />
          <Check checked={o.rules} onChange={(v) => set({ rules: v })} label={tr('타이밍 규칙 검증', 'Timing rule check')} />
          <Check checked={o.annotations} onChange={(v) => set({ annotations: v })} label={tr('인터록 · 주석 목록', 'Interlocks & notes')} />
          <Check checked={o.violations} onChange={(v) => set({ violations: v })} label={tr('차트에 규칙 위반 표시', 'Highlight violations')} />
          <Check checked={o.grayscale} onChange={(v) => set({ grayscale: v })} label={tr('흑백 인쇄용', 'Grayscale')} />
        </div>
        <h4>{tr('표제란', 'Title block')}</h4>
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
          {tr('총', 'Total')} {pages.length} {tr('페이지', 'pages')}
        </p>
      </aside>
      <div className="report-preview">
        <div className={`report-pages ${o.grayscale ? 'gray' : ''}`}>
          {pages.map((p, i) => (
            <div key={i} className="page" style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
              <div className="page-inner" style={{ padding: `${MARGIN}mm` }}>
                <div className="page-head" style={{ height: `${HEAD_MM}mm` }}>
                  <span className="ph-title">{project.meta.title}</span>
                  <span className="ph-sec">{p.title}</span>
                </div>
                <div className="page-content">{p.body}</div>
                <TitleBlock project={project} page={i + 1} total={pages.length} />
              </div>
            </div>
          ))}
        </div>
      </div>
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

function TitleBlock({ project, page, total }: { project: Project; page: number; total: number }) {
  const m = project.meta;
  return (
    <table className="titleblock" style={{ height: `${TITLEBLOCK_MM}mm` }}>
      <tbody>
        <tr>
          <td rowSpan={2} className="tb-company">
            {m.company || ' '}
          </td>
          <th>{tr('제목', 'TITLE')}</th>
          <td colSpan={3} className="tb-title">
            {m.title}
          </td>
          <th>{tr('작성', 'DRAWN')}</th>
          <th>{tr('검토', 'CHECKED')}</th>
          <th>{tr('승인', 'APPROVED')}</th>
          <th>{tr('페이지', 'PAGE')}</th>
        </tr>
        <tr>
          <th>{tr('설비', 'MACHINE')}</th>
          <td>{m.machine}</td>
          <th>{tr('도면번호', 'DWG NO.')}</th>
          <td>
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

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length ? out : [[]];
}

function buildPages(project: Project, o: ReportOpts, size: { w: number; h: number }, rules: RuleResult[]): PageDef[] {
  const pages: PageDef[] = [];
  const u = project.settings.timeUnit;
  const contentW = (size.w - 2 * MARGIN) * MM;
  const contentHmm = size.h - 2 * MARGIN - HEAD_MM - TITLEBLOCK_MM - 3;
  const contentH = contentHmm * MM;
  const visible = project.signals.filter((s) => !s.hidden);
  const d = project.settings.duration;
  const c = cycleSummary(project);
  const violations = o.violations ? rules.flatMap((r) => r.violations) : [];
  const tableRows = Math.max(8, Math.floor((contentHmm - 12) / 5.6));

  if (o.cover) {
    const ok = rules.filter((r) => r.status === 'ok').length;
    const ng = rules.filter((r) => r.status === 'fail').length;
    const g = computeLayout(project, { includeHidden: false });
    const natH = g.headerH + g.bodyH;
    const revRows = Math.min(project.revisions.length, 4);
    const thumbH = contentH - 46 * MM - (revRows ? (revRows + 1) * 6 * MM + 4 * MM : 0);
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
            <div className="kpis">
              <div className="kpi">
                <span>{tr('사이클 타임', 'Cycle time')}</span>
                <b>{formatTime(c.total, u)}</b>
              </div>
              <div className="kpi">
                <span>{tr('신호', 'Signals')}</span>
                <b>{visible.length}</b>
              </div>
              <div className="kpi">
                <span>{tr('공정 스텝', 'Steps')}</span>
                <b>{project.steps.length}</b>
              </div>
              <div className={`kpi ${ng ? 'bad' : rules.length ? 'good' : ''}`}>
                <span>{tr('규칙 검증', 'Rule check')}</span>
                <b>{rules.length ? `OK ${ok} / NG ${ng}` : '-'}</b>
              </div>
            </div>
          </div>
          {visible.length > 0 && (
            <div className="cover-thumb" style={{ maxHeight: Math.max(80, thumbH) }}>
              <ChartSvg project={project} width={contentW} idp="cov" grayscale={o.grayscale} violations={violations} />
              {natH > thumbH && <div className="fade" />}
            </div>
          )}
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
    const bodyAvail = contentH - full.headerH - 4;
    // 25% 이내로 넘치면 축소해서 한 페이지에, 그 이상이면 신호를 여러 페이지로 분할
    const shrinkToFit = full.bodyH > bodyAvail && full.bodyH <= bodyAvail / 0.75;
    const rowGroups: Signal[][] = [];
    let cur: Signal[] = [];
    let used = shrinkToFit ? Number.NEGATIVE_INFINITY : 0;
    for (const r of full.rows) {
      const extra = r.h + (r.signal.group && !cur.some((s) => s.group === r.signal.group) ? full.groupH : 0);
      if (cur.length && used + extra > bodyAvail) {
        rowGroups.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(r.signal);
      used += extra;
    }
    if (cur.length) rowGroups.push(cur);
    const lw = labelWidths(project, visible).total;
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
              <ChartSvg project={project} t0={t0} t1={t0 + span} px={px} signalIds={ids} idp={`p${ti}_${ri}`} grayscale={o.grayscale} violations={violations} style={shrinkToFit ? { maxHeight: `${contentH}px`, width: 'auto', maxWidth: '100%' } : undefined} />
            </div>
          ),
        });
      });
    }
  }

  if (o.signals && visible.length) {
    const rows = visible.map((s, i) => ({ s, i, st: signalStats(s, d) }));
    chunk(rows, tableRows).forEach((part, pi, all) =>
      pages.push({
        kind: 'signals',
        title: tr('신호(I/O) 목록', 'Signal (I/O) list') + (all.length > 1 ? ` (${pi + 1}/${all.length})` : ''),
        body: (
          <table className="rtable">
            <thead>
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
            </thead>
            <tbody>
              {part.map(({ s, i, st }) => {
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
              })}
            </tbody>
          </table>
        ),
      }),
    );
  }

  if (o.steps && project.steps.length) {
    const max = Math.max(...c.steps.map((r) => r.duration), 1);
    const ganttRows = c.steps.slice(0, 18);
    chunk(c.steps, tableRows - 2).forEach((part, pi, all) =>
      pages.push({
        kind: 'steps',
        title: tr('공정 스텝 · 사이클 타임', 'Process steps & cycle time') + (all.length > 1 ? ` (${pi + 1}/${all.length})` : ''),
        body: (
          <div className="steps-page">
            {pi === 0 && (
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
                    return <rect key={r.step.id} x={x} y={i * 14 + 2} width={w} height={10} rx={2} fill={o.grayscale ? '#6b7280' : c.longest?.id === r.step.id ? '#dc2626' : '#2563eb'} />;
                  })}
                </svg>
              </div>
            )}
            <table className="rtable">
              <thead>
                <tr>
                  <th>No</th>
                  <th>{tr('스텝', 'Step')}</th>
                  <th>{tr('시작', 'Start')}</th>
                  <th>{tr('종료', 'End')}</th>
                  <th>{tr('시간', 'Time')}</th>
                  <th style={{ width: '22%' }}>{tr('비율', 'Share')}</th>
                  <th>{tr('동작 내용', 'Description')}</th>
                </tr>
              </thead>
              <tbody>
                {part.map((r) => (
                  <tr key={r.step.id}>
                    <td>{c.steps.indexOf(r) + 1}</td>
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
                ))}
              </tbody>
              {pi === all.length - 1 && (
                <tfoot>
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
                </tfoot>
              )}
            </table>
          </div>
        ),
      }),
    );
  }

  if (o.events) {
    const hasIo = visible.some(isIoSignal);
    const evs = sequenceEvents(project, hasIo ? isIoSignal : undefined);
    const rows = evs.map((e, i) => ({ e, i, newStep: !!e.step && (i === 0 || evs[i - 1].step?.id !== e.step.id) }));
    chunk(rows, tableRows).forEach((part, pi, all) =>
      pages.push({
        kind: 'events',
        title: tr('동작 순서표', 'Sequence of events') + (hasIo ? tr(' (실제 입출력)', ' (real I/O)') : '') + (all.length > 1 ? ` (${pi + 1}/${all.length})` : ''),
        body: (
          <table className="rtable">
            <thead>
              <tr>
                <th>No</th>
                <th>{tr('시각', 'Time')}</th>
                <th>{tr('간격', 'Δt')}</th>
                <th>{tr('공정 스텝', 'Step')}</th>
                <th>{tr('주소', 'Address')}</th>
                <th>{tr('신호명', 'Name')}</th>
                <th>{tr('변화', 'Change')}</th>
              </tr>
            </thead>
            <tbody>
              {part.map(({ e, i, newStep }) => (
                <tr key={i} className={newStep ? 'step-start' : ''}>
                  <td>{i + 1}</td>
                  <td className="mono">{formatTime(e.t, u)}</td>
                  <td className="mono">{e.dt !== null ? `+${formatTime(e.dt, u)}` : ''}</td>
                  <td>{newStep ? <b>{e.step!.label}</b> : ''}</td>
                  <td className="mono">{e.signal.address}</td>
                  <td>{e.signal.name}</td>
                  <td>{e.kind === 'on' ? `↑ ${e.value}` : e.kind === 'off' ? `↓ ${e.value}` : `= ${e.value}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      }),
    );
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
    chunk(rules, Math.floor(tableRows / 1.4)).forEach((part, pi, all) =>
      pages.push({
        kind: 'rules',
        title: tr('타이밍 규칙 검증', 'Timing rule check') + (all.length > 1 ? ` (${pi + 1}/${all.length})` : ''),
        body: (
          <table className="rtable">
            <thead>
              <tr>
                <th>No</th>
                <th>{tr('결과', 'Result')}</th>
                <th>{tr('규칙', 'Rule')}</th>
                <th>{tr('조건', 'Condition')}</th>
                <th>{tr('측정값', 'Measured')}</th>
                <th>{tr('위반 내용', 'Violations')}</th>
              </tr>
            </thead>
            <tbody>
              {part.map((r) => (
                <tr key={r.rule.id}>
                  <td>{rules.indexOf(r) + 1}</td>
                  <td>
                    <span className={`status ${r.status}`}>{r.status === 'ok' ? 'OK' : r.status === 'fail' ? 'NG' : 'N/A'}</span>
                  </td>
                  <td>{r.rule.name}</td>
                  <td>{cond(r.rule)}</td>
                  <td>{r.measured}</td>
                  <td className="small">
                    {r.violations.slice(0, 4).map((v, i) => (
                      <div key={i}>{v.message}</div>
                    ))}
                    {r.violations.length > 4 && <div>+{r.violations.length - 4}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      }),
    );
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
    chunk(rows, tableRows).forEach((part, pi, all) =>
      pages.push({
        kind: 'annotations',
        title: tr('인터록 · 주석 목록', 'Interlocks & notes') + (all.length > 1 ? ` (${pi + 1}/${all.length})` : ''),
        body: (
          <table className="rtable">
            <thead>
              <tr>
                <th>No</th>
                <th>{tr('종류', 'Type')}</th>
                <th>{tr('대상', 'Target')}</th>
                <th>{tr('시간', 'Time')}</th>
                <th>{tr('내용', 'Label')}</th>
              </tr>
            </thead>
            <tbody>
              {part.map((r, i) => (
                <tr key={i}>
                  <td>{rows.indexOf(r) + 1}</td>
                  <td>{r.kind}</td>
                  <td>{r.what}</td>
                  <td>
                    <b>{r.value}</b>
                  </td>
                  <td>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      }),
    );
  }
  if (!pages.length) pages.push({ kind: 'empty', title: '', body: <p className="muted">{tr('출력할 내용이 없습니다. 왼쪽에서 항목을 선택하세요.', 'Nothing to print. Select sections on the left.')}</p> });
  return pages;
}
