import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useStore, selectedSignalIds } from '../store/store';
import type { Annotation, Signal, Step, WavePoint } from '../model/types';
import { computeLayout, rowAtY, SCREEN_COLORS, type ChartLayout, type RowLayout } from '../render/layout';
import { BodyLayer, HeaderLayer, rulerUnit, rowMid } from '../render/ChartParts';
import { edgesOf, invertBit, isHigh, moveEdge, normalize, removePoint, roundT, setFrom, setRange, snap as snapGrid, uid, valueAt, invertWave } from '../model/wave';
import { checkRules } from '../model/analysis';
import { formatTime, parseTime } from '../model/format';
import { askText, Icon } from './ui';
import { tr } from '../i18n';
import { storageGet, storageSet } from '../storage';

type Drag =
  | { kind: 'edge'; sigId: string; index: number; orig: WavePoint[] }
  | { kind: 'draw'; sigId: string; t0: number; t1: number; value: WavePoint['v'] }
  | { kind: 'busdraw'; sigId: string; t0: number; t1: number }
  | { kind: 'range'; t0: number; t1: number; moved: boolean; x0: number }
  | { kind: 'arrow'; fromId: string; fromT: number; toId: string | null; toT: number }
  | { kind: 'dimension'; rowId: string | null; t0: number; t1: number }
  | { kind: 'newstep'; t0: number; t1: number }
  | { kind: 'marker'; id: string }
  | { kind: 'note'; id: string; dt: number }
  | { kind: 'step'; id: string; mode: 'start' | 'end' | 'move'; orig: Step; startT: number };

interface CtxMenu {
  x: number;
  y: number;
  t: number;
  rowId: string | null;
}

const LABEL_W_KEY = 'timechart-studio.labelw';

export function ChartEditor() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const range = useStore((s) => s.range);
  const cursorA = useStore((s) => s.cursorA);
  const cursorB = useStore((s) => s.cursorB);
  const snapOn = useStore((s) => s.snap);
  const scrollToTime = useStore((s) => s.scrollToTime);
  const st = useStore.getState;

  const [labelW, setLabelW] = useState(() => {
    const v = Number(storageGet(LABEL_W_KEY));
    if (v >= 110 && v <= 520) return v;
    return typeof window !== 'undefined' && window.innerWidth <= 760 ? 120 : 250;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<SVGSVGElement>(null);
  const headRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ signalId: string; index: number } | null>(null);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [viewW, setViewW] = useState(1000);

  const layout = useMemo(() => computeLayout(project, { includeHidden: true }), [project]);
  const px = zoom;
  const duration = project.settings.duration;
  const waveW = Math.max(duration * px + 60, viewW - labelW - 2);
  const t1 = waveW / px;
  const selIds = useMemo(() => new Set(selectedSignalIds(selection)), [selection]);
  const violations = useMemo(() => checkRules(project).flatMap((r) => r.violations), [project]);

  // 스냅 후보: 모든 전환 시점, 스텝 경계, 마커, 커서
  const snapCandidates = useMemo(() => {
    const out: { t: number; sigId: string | null }[] = [];
    for (const s of project.signals) if (s.kind !== 'clock') for (const p of s.points.slice(1)) out.push({ t: p.t, sigId: s.id }, ...(p.ramp ? [{ t: p.t + p.ramp, sigId: s.id }] : []));
    for (const s of project.steps) out.push({ t: s.start, sigId: null }, { t: s.end, sigId: null });
    for (const a of project.annotations) if (a.type === 'marker') out.push({ t: a.t, sigId: null });
    out.push({ t: 0, sigId: null }, { t: duration, sigId: null });
    return out;
  }, [project, duration]);

  const snapT = useCallback(
    (t: number, exclude?: string, noMagnet?: boolean): number => {
      if (!noMagnet) {
        const tol = 6 / px;
        let best: number | null = null;
        let bd = tol;
        for (const c of snapCandidates) {
          if (exclude && c.sigId === exclude) continue;
          const d = Math.abs(c.t - t);
          if (d < bd) {
            bd = d;
            best = c.t;
          }
        }
        if (best !== null) return best;
      }
      return snapOn ? snapGrid(t, project.settings.grid) : roundT(t);
    },
    [snapCandidates, px, snapOn, project.settings.grid],
  );

  // 화면 폭 추적
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth);
      st().setViewWidth(el.clientWidth - labelW);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [labelW, st]);

  // 특정 시각으로 스크롤
  useEffect(() => {
    if (scrollToTime === null || !scrollRef.current) return;
    const el = scrollRef.current;
    const x = scrollToTime * px;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - labelW - 40) el.scrollLeft = Math.max(0, x - (el.clientWidth - labelW) / 3);
  }, [scrollToTime, px, labelW]);

  // Ctrl+휠 확대/축소 (마우스 위치 기준)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - labelW;
      const tAt = (el.scrollLeft + mx) / st().zoom;
      const factor = Math.exp(-e.deltaY * 0.0022);
      st().setZoom(st().zoom * factor);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, tAt * st().zoom - mx);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [labelW, st]);

  const toLocal = (e: { clientX: number; clientY: number }, el: Element | null) => {
    const r = el!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const findEdge = (row: RowLayout, x: number): number | null => {
    const s = row.signal;
    if (s.kind === 'clock') return null;
    let best: number | null = null;
    let bd = 6;
    s.points.forEach((p, i) => {
      if (i === 0) return;
      const xs = p.t * px;
      const xe = (p.t + (p.ramp ?? 0)) * px;
      const d = x < xs ? xs - x : x > xe ? x - xe : 0;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const nearestEdgeT = (row: RowLayout | null, t: number): number => {
    if (row && row.signal.kind !== 'clock') {
      const tol = 10 / px;
      let best: number | null = null;
      let bd = tol;
      for (const e of edgesOf(row.signal.points)) {
        const d = Math.abs(e.t - t);
        if (d < bd) {
          bd = d;
          best = e.t;
        }
      }
      if (best !== null) return best;
    }
    return snapT(t);
  };

  const startDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  const updateDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ───────────── 본문 포인터 ─────────────
  const onBodyDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setCtx(null);
    const { x, y } = toLocal(e, bodyRef.current);
    const t = Math.max(0, x / px);
    const row = rowAtY(layout, y);
    const target = e.target as Element;
    const annEl = target.closest('[data-ann-id]');
    const s = st();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (annEl && (tool === 'select' || tool === 'draw')) {
      const id = annEl.getAttribute('data-ann-id')!;
      s.select({ type: 'annotation', id });
      const a = project.annotations.find((q) => q.id === id);
      if (a?.type === 'marker') startDrag({ kind: 'marker', id });
      else if (a?.type === 'note') startDrag({ kind: 'note', id, dt: t - a.t });
      return;
    }

    switch (tool) {
      case 'select': {
        if (row) {
          const idx = findEdge(row, x);
          const multi = e.shiftKey || e.ctrlKey || e.metaKey;
          if (multi) {
            const ids = new Set(selIds);
            if (ids.has(row.signal.id)) ids.delete(row.signal.id);
            else ids.add(row.signal.id);
            s.select({ type: 'signals', ids: [...ids] });
          } else if (!selIds.has(row.signal.id) || selIds.size > 1) s.select({ type: 'signals', ids: [row.signal.id] });
          if (idx !== null && !multi) {
            startDrag({ kind: 'edge', sigId: row.signal.id, index: idx, orig: row.signal.points });
            return;
          }
        } else s.select(null);
        startDrag({ kind: 'range', t0: t, t1: t, moved: false, x0: x });
        return;
      }
      case 'draw': {
        if (!row) return;
        const sig = row.signal;
        s.select({ type: 'signals', ids: [sig.id] });
        const t0 = snapT(t, sig.id);
        if (sig.kind === 'bit') {
          const cur = valueAt(sig.points, t0 + 1e-6);
          const value = e.altKey ? 0 : e.shiftKey ? 1 : invertBit(cur);
          startDrag({ kind: 'draw', sigId: sig.id, t0, t1: t0, value });
        } else if (sig.kind === 'bus') startDrag({ kind: 'busdraw', sigId: sig.id, t0, t1: t0 });
        else if (sig.kind === 'analog') {
          const min = sig.analogMin ?? 0;
          const max = sig.analogMax ?? 10;
          const pad = 5;
          const frac = 1 - (y - row.y - pad) / (row.h - 2 * pad);
          const v = Math.round((min + Math.min(Math.max(frac, 0), 1) * (max - min)) * 100) / 100;
          s.updateSignal(sig.id, (q) => ({ ...q, points: normalize([...q.points.filter((p) => Math.abs(p.t - t0) > 1e-6), { t: t0, v }], 'analog', q.points[0]?.v ?? 0) }));
        } else s.toast(tr('클럭 신호는 속성 패널에서 주기를 설정합니다.', 'Set clock period in the properties panel.'));
        return;
      }
      case 'arrow': {
        if (!row) return;
        const t0 = nearestEdgeT(row, t);
        startDrag({ kind: 'arrow', fromId: row.signal.id, fromT: t0, toId: row.signal.id, toT: t0 });
        return;
      }
      case 'dimension': {
        const t0 = row ? nearestEdgeT(row, t) : snapT(t);
        startDrag({ kind: 'dimension', rowId: row?.signal.id ?? null, t0, t1: t0 });
        return;
      }
      case 'step': {
        const t0 = snapT(t);
        startDrag({ kind: 'newstep', t0, t1: t0 });
        return;
      }
      case 'note': {
        const tt = row ? nearestEdgeT(row, t) : snapT(t);
        askText(tr('메모 추가', 'Add note'), tr('내용', 'Text')).then((text) => {
          if (text) st().addAnnotation({ id: uid('ann'), type: 'note', signalId: row?.signal.id ?? null, t: tt, text });
        });
        return;
      }
      case 'marker': {
        const tt = snapT(t);
        askText(tr('마커 추가', 'Add marker'), tr('라벨 (선택)', 'Label (optional)')).then((label) => {
          if (label !== null) st().addAnnotation({ id: uid('ann'), type: 'marker', t: tt, label, color: '#16a34a' });
        });
        return;
      }
    }
  };

  const onBodyMove = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = toLocal(e, bodyRef.current);
    const t = Math.max(0, x / px);
    st().setHoverT(t);
    const d = dragRef.current;
    if (!d) {
      const row = rowAtY(layout, y);
      const idx = row && (tool === 'select' || tool === 'draw') ? findEdge(row, x) : null;
      const he = row && idx !== null ? { signalId: row.signal.id, index: idx } : null;
      if (he?.signalId !== hoverEdge?.signalId || he?.index !== hoverEdge?.index) setHoverEdge(he);
      return;
    }
    const s = st();
    switch (d.kind) {
      case 'edge': {
        const nt = snapT(t, d.sigId);
        const sig = project.signals.find((q) => q.id === d.sigId);
        if (!sig) return;
        s.updateSignal(d.sigId, { points: moveEdge(d.orig, d.index, nt, sig.kind) }, 'edge-drag');
        return;
      }
      case 'draw':
        updateDrag({ ...d, t1: snapT(t, d.sigId) });
        return;
      case 'busdraw':
        updateDrag({ ...d, t1: snapT(t, d.sigId) });
        return;
      case 'range':
        updateDrag({ ...d, t1: snapT(t), moved: d.moved || Math.abs(x - d.x0) > 3 });
        return;
      case 'arrow': {
        const row = rowAtY(layout, y);
        updateDrag({ ...d, toId: row?.signal.id ?? null, toT: nearestEdgeT(row, t) });
        return;
      }
      case 'dimension': {
        const row = d.rowId ? layout.rowById.get(d.rowId) ?? null : null;
        updateDrag({ ...d, t1: row ? nearestEdgeT(row, t) : snapT(t) });
        return;
      }
      case 'newstep':
        updateDrag({ ...d, t1: snapT(t) });
        return;
      case 'marker':
        s.updateAnnotation(d.id, { t: snapT(t) } as Partial<Annotation>, 'marker-drag');
        return;
      case 'note':
        s.updateAnnotation(d.id, { t: snapT(t - d.dt) } as Partial<Annotation>, 'note-drag');
        return;
    }
  };

  const onBodyUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    const s = st();
    s.endMerge();
    if (!d) return;
    switch (d.kind) {
      case 'draw': {
        const sig = project.signals.find((q) => q.id === d.sigId);
        if (!sig) return;
        let [a, b] = [Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)];
        if (b - a < 1e-6) {
          // 클릭: 다음 전환(또는 그리드 한 칸)까지 토글
          const next = sig.points.find((p) => p.t > a + 1e-6);
          b = Math.min(next ? next.t : a + project.settings.grid, duration);
          if (b <= a) b = a + project.settings.grid;
        }
        s.updateSignal(sig.id, { points: setRange(sig.points, a, b, d.value, 'bit', sig.defaultRamp) });
        return;
      }
      case 'busdraw': {
        const sig = project.signals.find((q) => q.id === d.sigId);
        if (!sig) return;
        let [a, b] = [Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)];
        if (b - a < 1e-6) {
          const prev = [...sig.points].reverse().find((p) => p.t <= a + 1e-6);
          const next = sig.points.find((p) => p.t > a + 1e-6);
          a = prev?.t ?? 0;
          b = next?.t ?? duration;
        }
        const cur = String(valueAt(sig.points, a + 1e-6, 'bus'));
        askText(tr('값 입력', 'Enter value'), `${formatTime(a)} ~ ${formatTime(b)}`, cur).then((v) => {
          if (v !== null) st().updateSignal(sig.id, (q) => ({ ...q, points: setRange(q.points, a, b, v, 'bus') }));
        });
        return;
      }
      case 'range':
        if (d.moved && Math.abs(d.t1 - d.t0) > 1e-6) s.setRange({ t0: Math.min(d.t0, d.t1), t1: Math.max(d.t0, d.t1) });
        else s.setRange(null);
        return;
      case 'arrow':
        if (d.toId && (d.toId !== d.fromId || Math.abs(d.toT - d.fromT) > 1e-6)) {
          s.addAnnotation({ id: uid('ann'), type: 'arrow', from: { signalId: d.fromId, t: d.fromT }, to: { signalId: d.toId, t: d.toT }, label: '' });
          s.setTool('select');
        }
        return;
      case 'dimension':
        if (Math.abs(d.t1 - d.t0) > 1e-6) {
          s.addAnnotation({ id: uid('ann'), type: 'dimension', signalId: d.rowId, t1: Math.min(d.t0, d.t1), t2: Math.max(d.t0, d.t1), label: '' });
          s.setTool('select');
        }
        return;
      case 'newstep':
        if (Math.abs(d.t1 - d.t0) > 1e-6) {
          s.addStep({ start: Math.min(d.t0, d.t1), end: Math.max(d.t0, d.t1) });
          s.setTool('select');
        }
        return;
    }
  };

  const onBodyDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = toLocal(e, bodyRef.current);
    const t = x / px;
    const row = rowAtY(layout, y);
    const annEl = (e.target as Element).closest('[data-ann-id]');
    const s = st();
    if (annEl) {
      const a = project.annotations.find((q) => q.id === annEl.getAttribute('data-ann-id'));
      if (!a) return;
      const cur = a.type === 'note' ? a.text : a.label;
      askText(tr('라벨 편집', 'Edit label'), tr('라벨', 'Label'), cur).then((v) => {
        if (v === null) return;
        st().updateAnnotation(a.id, (a.type === 'note' ? { text: v } : { label: v }) as Partial<Annotation>);
      });
      return;
    }
    if (!row || tool !== 'select') return;
    const sig = row.signal;
    const prev = [...sig.points].reverse().find((p) => p.t <= t + 1e-6);
    const next = sig.points.find((p) => p.t > t + 1e-6);
    const a = prev?.t ?? 0;
    const b = next?.t ?? duration;
    if (sig.kind === 'bit') {
      s.updateSignal(sig.id, { points: setRange(sig.points, a, b, invertBit(prev?.v ?? 0), 'bit') });
    } else if (sig.kind === 'bus') {
      askText(tr('값 입력', 'Enter value'), `${formatTime(a)} ~ ${formatTime(b)}`, String(prev?.v ?? '')).then((v) => {
        if (v !== null) st().updateSignal(sig.id, (q) => ({ ...q, points: setRange(q.points, a, b, v, 'bus') }));
      });
    }
  };

  const onContext = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x, y } = toLocal(e, bodyRef.current);
    const row = rowAtY(layout, y);
    if (row && !selIds.has(row.signal.id)) st().select({ type: 'signals', ids: [row.signal.id] });
    setCtx({ x: e.clientX, y: e.clientY, t: snapT(x / px), rowId: row?.signal.id ?? null });
  };

  // ───────────── 헤더 포인터 (스텝 / 눈금자 / 마커) ─────────────
  const onHeadDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { x, y } = toLocal(e, headRef.current);
    const t = Math.max(0, x / px);
    const s = st();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const annEl = (e.target as Element).closest('[data-ann-id]');
    if (annEl) {
      const id = annEl.getAttribute('data-ann-id')!;
      s.select({ type: 'annotation', id });
      startDrag({ kind: 'marker', id });
      return;
    }
    if (y < layout.stepsH || (layout.stepsH === 0 && tool === 'step')) {
      const hit = project.steps.find((q) => t >= q.start - 5 / px && t <= q.end + 5 / px);
      if (hit && y < layout.stepsH) {
        s.select({ type: 'step', id: hit.id });
        const mode = Math.abs(t - hit.start) * px < 6 ? 'start' : Math.abs(t - hit.end) * px < 6 ? 'end' : 'move';
        startDrag({ kind: 'step', id: hit.id, mode, orig: hit, startT: t });
      } else startDrag({ kind: 'newstep', t0: snapT(t), t1: snapT(t) });
      return;
    }
    const tt = snapT(t);
    if (e.shiftKey) s.setCursor('B', tt);
    else s.setCursor('A', tt);
  };

  const onHeadMove = (e: RPointerEvent<SVGSVGElement>) => {
    const { x } = toLocal(e, headRef.current);
    const t = Math.max(0, x / px);
    const d = dragRef.current;
    if (!d) return;
    const s = st();
    if (d.kind === 'step') {
      const dt = snapT(t) - snapT(d.startT);
      if (d.mode === 'move') {
        const len = d.orig.end - d.orig.start;
        const ns = Math.max(0, snapT(d.orig.start + (t - d.startT)));
        s.updateStep(d.id, { start: ns, end: ns + len }, 'step-drag');
      } else if (d.mode === 'start') s.updateStep(d.id, { start: Math.min(Math.max(0, d.orig.start + dt), d.orig.end - 1e-3) }, 'step-drag');
      else s.updateStep(d.id, { end: Math.max(d.orig.end + dt, d.orig.start + 1e-3) }, 'step-drag');
    } else if (d.kind === 'newstep') updateDrag({ ...d, t1: snapT(t) });
    else if (d.kind === 'marker') s.updateAnnotation(d.id, { t: snapT(t) } as Partial<Annotation>, 'marker-drag');
  };

  const onHeadDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = toLocal(e, headRef.current);
    const t = x / px;
    if (y >= layout.stepsH) return;
    const hit = project.steps.find((q) => t >= q.start && t <= q.end);
    if (!hit) return;
    askText(tr('스텝 이름', 'Step name'), tr('이름', 'Name'), hit.label).then((v) => {
      if (v) st().updateStep(hit.id, { label: v });
    });
  };

  // 드래그 미리보기
  const preview: ReactNode = (() => {
    if (!drag) return null;
    const x = (t: number) => t * px;
    switch (drag.kind) {
      case 'draw':
      case 'busdraw': {
        const r = layout.rowById.get(drag.sigId);
        if (!r) return null;
        const a = Math.min(drag.t0, drag.t1);
        const b = Math.max(drag.t0, drag.t1);
        return <rect x={x(a)} y={r.y + 3} width={Math.max(2, (b - a) * px)} height={r.h - 6} fill="var(--accent)" opacity={0.25} stroke="var(--accent)" />;
      }
      case 'range': {
        if (!drag.moved) return null;
        const a = Math.min(drag.t0, drag.t1);
        return <rect x={x(a)} y={0} width={Math.abs(drag.t1 - drag.t0) * px} height={layout.bodyH} fill="var(--chart-range)" stroke="var(--accent)" strokeDasharray="4 3" />;
      }
      case 'arrow': {
        const ra = layout.rowById.get(drag.fromId);
        const rb = drag.toId ? layout.rowById.get(drag.toId) : null;
        if (!ra) return null;
        return <line x1={x(drag.fromT)} y1={rowMid(ra)} x2={x(drag.toT)} y2={rb ? rowMid(rb) : rowMid(ra)} stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 3" />;
      }
      case 'dimension': {
        const r = drag.rowId ? layout.rowById.get(drag.rowId) : null;
        const y = r ? rowMid(r) : 10;
        return (
          <g>
            <line x1={x(drag.t0)} x2={x(drag.t1)} y1={y} y2={y} stroke="#b45309" strokeWidth={2} />
            <text x={(x(drag.t0) + x(drag.t1)) / 2} y={y - 5} fontSize={11} textAnchor="middle" fill="#b45309">
              {formatTime(Math.abs(drag.t1 - drag.t0), project.settings.timeUnit)}
            </text>
          </g>
        );
      }
      case 'newstep': {
        const a = Math.min(drag.t0, drag.t1);
        return <rect x={x(a)} y={0} width={Math.abs(drag.t1 - drag.t0) * px} height={layout.bodyH} fill="#fde68a" opacity={0.35} stroke="#ca8a04" strokeDasharray="4 3" />;
      }
      default:
        return null;
    }
  })();

  const headPreview: ReactNode =
    drag?.kind === 'newstep' ? <rect x={Math.min(drag.t0, drag.t1) * px} y={2} width={Math.abs(drag.t1 - drag.t0) * px} height={Math.max(layout.stepsH, 20) - 4} fill="#fde68a" stroke="#ca8a04" opacity={0.7} /> : null;

  const cursorStyle = tool === 'draw' ? 'crosshair' : tool === 'select' ? (hoverEdge ? 'ew-resize' : 'default') : 'copy';
  const selAnn = selection?.type === 'annotation' ? selection.id : null;
  const selStep = selection?.type === 'step' ? selection.id : null;
  const headerH = Math.max(layout.headerH, 26);

  return (
    <div className="chart-scroll" ref={scrollRef} onScroll={() => setCtx(null)}>
      <div className="chart-grid" data-px={px} style={{ gridTemplateColumns: `${labelW}px ${waveW}px`, gridTemplateRows: `${headerH}px ${layout.bodyH + 40}px` }}>
        <div className="chart-corner" style={{ height: headerH }}>
          <div className="corner-inner">
            <span>
              {tr('신호', 'Signals')} <b>{project.signals.length}</b>
            </span>
            <span className="corner-unit">[{rulerUnit(project)}]</span>
            <button type="button" className="mini-btn" title={tr('신호 추가', 'Add signal')} onClick={() => st().addSignal({}, lastSelectedIndex(project.signals, selIds))}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div
            className="label-resizer"
            onPointerDown={(e) => {
              const startX = e.clientX;
              const startW = labelW;
              const move = (ev: PointerEvent) => setLabelW(Math.min(520, Math.max(110, startW + ev.clientX - startX)));
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                setLabelW((w) => {
                  storageSet(LABEL_W_KEY, String(w));
                  return w;
                });
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          />
        </div>
        <div className="chart-head" style={{ height: headerH }}>
          <svg ref={headRef} width={waveW} height={headerH} onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onBodyUp} onDoubleClick={onHeadDouble} onContextMenu={(e) => {
            e.preventDefault();
            st().setCursor('A', null);
            st().setCursor('B', null);
          }}>
            <HeaderLayer project={project} layout={{ ...layout, headerH }} px={px} t0={0} t1={t1} colors={SCREEN_COLORS} idp="ed" width={waveW} selectedStep={selStep} selectedAnnotation={selAnn} cursorA={cursorA} cursorB={cursorB} interactive />
            {headPreview}
          </svg>
        </div>
        <LabelColumn layout={layout} width={labelW} selIds={selIds} />
        <div className="chart-body">
          <svg
            ref={bodyRef}
            width={waveW}
            height={layout.bodyH + 40}
            style={{ cursor: cursorStyle, touchAction: 'none' }}
            onPointerDown={onBodyDown}
            onPointerMove={onBodyMove}
            onPointerUp={onBodyUp}
            onPointerLeave={() => {
              st().setHoverT(null);
              if (hoverEdge) setHoverEdge(null);
            }}
            onDoubleClick={onBodyDouble}
            onContextMenu={onContext}
          >
            <BodyLayer
              project={project}
              layout={layout}
              px={px}
              t0={0}
              t1={t1}
              colors={SCREEN_COLORS}
              idp="ed"
              width={waveW}
              selectedSignals={selIds}
              selectedAnnotation={selAnn}
              range={range}
              cursorA={cursorA}
              cursorB={cursorB}
              violations={violations}
              hoverEdge={hoverEdge}
              interactive
            />
            {preview}
          </svg>
        </div>
      </div>
      {project.signals.length === 0 && (
        <div className="empty-hint">
          <p>{tr('신호가 없습니다.', 'No signals yet.')}</p>
          <button type="button" className="btn primary" onClick={() => st().addSignal()}>
            <Icon name="plus" /> {tr('신호 추가', 'Add signal')}
          </button>
          <button type="button" className="btn" onClick={() => st().setTab('plc')}>
            <Icon name="cpu" /> {tr('PLC 프로그램에서 생성', 'Generate from PLC program')}
          </button>
        </div>
      )}
      {ctx && <ContextMenu ctx={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}

function lastSelectedIndex(signals: Signal[], sel: Set<string>): number | undefined {
  let idx = -1;
  signals.forEach((s, i) => {
    if (sel.has(s.id)) idx = i;
  });
  return idx >= 0 ? idx + 1 : undefined;
}

// ───────────────────────────── 라벨 열 ─────────────────────────────

function LabelColumn({ layout, width, selIds }: { layout: ChartLayout; width: number; selIds: Set<string> }) {
  const st = useStore.getState;
  const [editing, setEditing] = useState<string | null>(null);
  const [dragY, setDragY] = useState<{ id: string; y: number } | null>(null);

  const dropIndex = (y: number): number => {
    let idx = layout.rows.length;
    for (const r of layout.rows) {
      if (y < r.y + r.h / 2) {
        idx = r.index;
        break;
      }
    }
    return idx;
  };

  return (
    <div className="chart-labels" style={{ width, height: layout.bodyH + 40 }}>
      {layout.groups.map((g) => (
        <div key={g.y} className="lgroup" style={{ top: g.y, height: layout.groupH }}>
          ▸ {g.name}
        </div>
      ))}
      {layout.rows.map((r) => {
        const s = r.signal;
        const sel = selIds.has(s.id);
        return (
          <div
            key={s.id}
            className={`lrow ${sel ? 'sel' : ''} ${s.hidden ? 'hidden-sig' : ''}`}
            style={{ top: r.y, height: r.h }}
            onPointerDown={(e) => {
              if ((e.target as Element).closest('input,button')) return;
              const multi = e.shiftKey || e.ctrlKey || e.metaKey;
              if (multi) {
                const ids = new Set(selIds);
                if (ids.has(s.id)) ids.delete(s.id);
                else ids.add(s.id);
                st().select({ type: 'signals', ids: [...ids] });
              } else st().select({ type: 'signals', ids: [s.id] });
            }}
            onDoubleClick={() => setEditing(s.id)}
          >
            <span
              className="lhandle"
              title={tr('드래그하여 순서 변경', 'Drag to reorder')}
              onPointerDown={(e) => {
                e.preventDefault();
                const col = (e.currentTarget as HTMLElement).closest('.chart-labels')!;
                const top = col.getBoundingClientRect().top;
                setDragY({ id: s.id, y: e.clientY - top });
                const move = (ev: PointerEvent) => setDragY({ id: s.id, y: ev.clientY - top });
                const up = (ev: PointerEvent) => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  const to = dropIndex(ev.clientY - top);
                  setDragY(null);
                  const from = r.index;
                  if (to !== from && to !== from + 1) st().moveSignal(s.id, to > from ? to - 1 : to);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              ⋮⋮
            </span>
            <span className="lcolor" style={{ background: s.color }} />
            {s.address && <span className="laddr">{s.address}</span>}
            {editing === s.id ? (
              <input
                className="lname-input"
                autoFocus
                defaultValue={s.name}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== s.name) st().updateSignal(s.id, { name: e.target.value });
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span className="lname" title={[s.address ? `${s.address} ${s.name}` : s.name, s.comment].filter(Boolean).join('\n')}>
                {s.name}
              </span>
            )}
            {s.kind !== 'bit' && <span className="lkind">{s.kind === 'bus' ? 'WORD' : s.kind === 'analog' ? 'ANA' : 'CLK'}</span>}
            {(s.onLabel || s.offLabel) && s.kind === 'bit' && (
              <span className="llevels">
                <span>{s.onLabel}</span>
                <span>{s.offLabel}</span>
              </span>
            )}
            <button type="button" className="leye" title={s.hidden ? tr('보고서/내보내기에 표시', 'Show in report/export') : tr('보고서/내보내기에서 숨김', 'Hide in report/export')} onClick={() => st().updateSignal(s.id, { hidden: !s.hidden })}>
              <Icon name={s.hidden ? 'eyeOff' : 'eye'} size={13} />
            </button>
          </div>
        );
      })}
      {dragY && <div className="ldrop" style={{ top: (() => {
        const idx = dropIndex(dragY.y);
        const r = layout.rows.find((q) => q.index === idx);
        return r ? r.y : layout.bodyH;
      })() }} />}
    </div>
  );
}

// ───────────────────────────── 컨텍스트 메뉴 ─────────────────────────────

function ContextMenu({ ctx, onClose }: { ctx: CtxMenu; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const range = useStore((s) => s.range);
  const s = useStore.getState();
  const sig = ctx.rowId ? project.signals.find((q) => q.id === ctx.rowId) : null;
  const idx = sig ? project.signals.indexOf(sig) : -1;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      type="button"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span className="menu-ico" />
      <span className="menu-label">{label}</span>
    </button>
  );
  const bit = sig?.kind === 'bit';
  const ramp = sig?.defaultRamp;
  const t = ctx.t;
  const style = { left: Math.min(ctx.x, window.innerWidth - 240), top: Math.min(ctx.y, window.innerHeight - 420) };
  return (
    <div className="menu-pop ctx" style={style} ref={ref}>
      <div className="menu-title">{formatTime(t, project.settings.timeUnit)}</div>
      {sig && bit && item(tr('여기부터 ON', 'ON from here'), () => s.updateSignal(sig.id, { points: setFrom(sig.points, t, 1, 'bit', ramp) }))}
      {sig && bit && item(tr('여기부터 OFF', 'OFF from here'), () => s.updateSignal(sig.id, { points: setFrom(sig.points, t, 0, 'bit', ramp) }))}
      {sig && range && bit && item(tr('선택 구간 ON', 'Range ON'), () => s.updateSignal(sig.id, { points: setRange(sig.points, range.t0, range.t1, 1, 'bit', ramp) }))}
      {sig && range && bit && item(tr('선택 구간 OFF', 'Range OFF'), () => s.updateSignal(sig.id, { points: setRange(sig.points, range.t0, range.t1, 0, 'bit', ramp) }))}
      {sig && bit && item(tr('파형 반전', 'Invert waveform'), () => s.updateSignal(sig.id, { points: invertWave(sig.points) }))}
      {sig &&
        item(tr('가장 가까운 전환 삭제', 'Delete nearest transition'), () => {
          const e = edgesOf(sig.points).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
          if (e) s.updateSignal(sig.id, { points: removePoint(sig.points, e.index, sig.kind) });
        })}
      {sig && item(tr('파형 지우기', 'Clear waveform'), () => s.updateSignal(sig.id, { points: [{ t: 0, v: sig.kind === 'bus' ? '0' : 0 }] }))}
      <div className="menu-div" />
      {item(tr('위에 신호 추가', 'Add signal above'), () => s.addSignal({ group: sig?.group }, idx >= 0 ? idx : undefined))}
      {item(tr('아래에 신호 추가', 'Add signal below'), () => s.addSignal({ group: sig?.group }, idx >= 0 ? idx + 1 : undefined))}
      {sig && item(tr('신호 복제', 'Duplicate signal'), () => s.duplicateSignals(selectedSignalIds(s.selection)))}
      {sig && item(tr('신호 삭제', 'Delete signal'), () => s.removeSignals(selectedSignalIds(s.selection)))}
      <div className="menu-div" />
      {range && item(tr('선택 구간 → 스텝', 'Range → step'), () => s.addStep({ start: range.t0, end: range.t1 }))}
      {range && item(tr('선택 구간 치수선', 'Range dimension'), () => s.addAnnotation({ id: uid('ann'), type: 'dimension', signalId: ctx.rowId, t1: range.t0, t2: range.t1, label: '' }))}
      {range && item(tr('선택 구간 시간 삭제', 'Delete time in range'), () => {
        s.deleteTimeAll(range.t0, range.t1);
        s.setRange(null);
      })}
      {range && item(tr('선택 구간 길이만큼 시간 삽입', 'Insert time (range length)'), () => s.insertTimeAll(range.t0, range.t1 - range.t0))}
      {item(tr('여기에 시간 삽입…', 'Insert time here…'), () =>
        askText(tr('시간 삽입', 'Insert time'), tr('삽입할 시간 (예: 500, 1.5s)', 'Duration (e.g. 500, 1.5s)'), String(project.settings.grid * 4)).then((v) => {
          const dt = v ? parseTime(v) : null;
          if (dt !== null && dt > 0) useStore.getState().insertTimeAll(t, dt);
        }),
      )}
      {item(tr('여기에 마커', 'Marker here'), () => s.addAnnotation({ id: uid('ann'), type: 'marker', t, label: '', color: '#16a34a' }))}
      {item(tr('커서 A 여기', 'Cursor A here'), () => s.setCursor('A', t))}
      {item(tr('커서 B 여기', 'Cursor B here'), () => s.setCursor('B', t))}
    </div>
  );
}

export function levelText(s: Signal, v: WavePoint['v']): string {
  if (s.kind !== 'bit') return String(v);
  if (isHigh(v)) return s.onLabel || 'ON';
  return s.offLabel || 'OFF';
}
