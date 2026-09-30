import { create } from 'zustand';
import type { Annotation, Project, ProjectMeta, ProjectSettings, Signal, Step, TimingRule } from '../model/types';
import { createProject, createSignal, createStep, migrateProject, sampleProject, STEP_COLORS } from '../model/project';
import { deleteTime, insertTime, normalize, scaleTime, uid } from '../model/wave';
import { setLang, type Lang } from '../i18n';

export type Tab = 'editor' | 'plc' | 'text' | 'report';
export type Tool = 'select' | 'draw' | 'arrow' | 'dimension' | 'note' | 'marker' | 'step';
export type Selection =
  | { type: 'signals'; ids: string[] }
  | { type: 'annotation'; id: string }
  | { type: 'step'; id: string }
  | { type: 'rule'; id: string }
  | null;

export interface TimeRange {
  t0: number;
  t1: number;
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastMergeKey: string | null;
  dirty: boolean;
  fileName: string;

  tab: Tab;
  tool: Tool;
  selection: Selection;
  range: TimeRange | null;
  /** px / ms */
  zoom: number;
  snap: boolean;
  cursorA: number | null;
  cursorB: number | null;
  hoverT: number | null;
  lang: Lang;
  theme: 'light' | 'dark';
  bottom: 'analysis' | 'rules' | 'steps' | 'events' | null;
  showProps: boolean;
  toasts: Toast[];
  /** 차트 편집 영역 가로 폭 (px) - 화면 맞춤에 사용 */
  viewWidth: number;
  scrollToTime: number | null;

  // 기록되는 변경
  commit(next: Project, mergeKey?: string): void;
  endMerge(): void;
  undo(): void;
  redo(): void;
  loadProject(p: Project, fileName?: string): void;
  markSaved(fileName?: string): void;

  setMeta(patch: Partial<ProjectMeta>, mergeKey?: string): void;
  setSettings(patch: Partial<ProjectSettings>, mergeKey?: string): void;
  addSignal(partial?: Partial<Signal>, index?: number): string;
  updateSignal(id: string, patch: Partial<Signal> | ((s: Signal) => Signal), mergeKey?: string): void;
  updateSignals(ids: string[], patch: Partial<Signal>): void;
  removeSignals(ids: string[]): void;
  moveSignal(id: string, toIndex: number): void;
  duplicateSignals(ids: string[]): void;
  addStep(partial?: Partial<Step>): string;
  updateStep(id: string, patch: Partial<Step>, mergeKey?: string): void;
  removeStep(id: string): void;
  addAnnotation(a: Annotation): void;
  updateAnnotation(id: string, patch: Partial<Annotation>, mergeKey?: string): void;
  removeAnnotation(id: string): void;
  addRule(r: TimingRule): void;
  updateRule(id: string, patch: Partial<TimingRule>, mergeKey?: string): void;
  removeRule(id: string): void;
  insertTimeAll(at: number, dt: number): void;
  deleteTimeAll(t0: number, t1: number): void;
  scaleTimeAll(factor: number): void;

  // UI
  setTab(t: Tab): void;
  setTool(t: Tool): void;
  select(s: Selection): void;
  setRange(r: TimeRange | null): void;
  setZoom(z: number): void;
  setSnap(v: boolean): void;
  setCursor(which: 'A' | 'B', t: number | null): void;
  setHoverT(t: number | null): void;
  setLang(l: Lang): void;
  setTheme(t: 'light' | 'dark'): void;
  setBottom(b: State['bottom']): void;
  toggleProps(): void;
  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setViewWidth(w: number): void;
  fitZoom(): void;
  revealTime(t: number): void;
}

const AUTOSAVE_KEY = 'timechart-studio.autosave.v1';
const PREFS_KEY = 'timechart-studio.prefs.v1';
const HISTORY_LIMIT = 200;

/** 이 브라우저에 이전 작업(자동 백업)이 있는가 - 처음 방문 판단용 */
export function hasAutosave(): boolean {
  try {
    return !!localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return false;
  }
}

function loadInitial(): Project {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return migrateProject(JSON.parse(raw));
  } catch {
    /* 자동 저장본이 없거나 손상 */
  }
  return sampleProject();
}

function loadPrefs(): { lang: Lang; theme: 'light' | 'dark' } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { lang: p.lang === 'en' ? 'en' : 'ko', theme: p.theme === 'dark' ? 'dark' : 'light' };
    }
  } catch {
    /* 무시 */
  }
  // 저장된 설정이 없으면: 페이지를 연 곳이 지정한 테마(data-theme) → 운영체제 설정 순
  const host = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  if (host === 'dark' || host === 'light') return { lang: 'ko', theme: host };
  const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  return { lang: 'ko', theme: dark ? 'dark' : 'light' };
}

function savePrefs(p: { lang: Lang; theme: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
}

const prefs = loadPrefs();
setLang(prefs.lang);

let toastSeq = 0;

export const useStore = create<State>((set, get) => {
  const mutate = (fn: (p: Project) => Project, mergeKey?: string) => get().commit(fn(get().project), mergeKey);
  const mapSignals = (p: Project, fn: (s: Signal) => Signal): Project => ({ ...p, signals: p.signals.map(fn) });

  return {
    project: loadInitial(),
    past: [],
    future: [],
    lastMergeKey: null,
    dirty: false,
    fileName: '',

    tab: 'editor',
    tool: 'select',
    selection: null,
    range: null,
    zoom: 0.3,
    snap: true,
    cursorA: null,
    cursorB: null,
    hoverT: null,
    lang: prefs.lang,
    theme: prefs.theme,
    // 휴대폰 폭에서는 아래 분석 패널을 접어서 차트를 넓게
    bottom: typeof window !== 'undefined' && window.innerWidth <= 760 ? null : 'analysis',
    // 휴대폰 폭에서는 속성 패널이 차트를 가리므로 닫힌 상태로 시작
    showProps: typeof window === 'undefined' || window.innerWidth > 760,
    toasts: [],
    viewWidth: 1000,
    scrollToTime: null,

    commit(next, mergeKey) {
      const { project, past, lastMergeKey } = get();
      if (next === project) return;
      const merge = mergeKey !== undefined && mergeKey === lastMergeKey;
      set({
        project: next,
        past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), project],
        future: [],
        lastMergeKey: mergeKey ?? null,
        dirty: true,
      });
    },
    endMerge() {
      set({ lastMergeKey: null });
    },
    undo() {
      const { past, project, future } = get();
      if (!past.length) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastMergeKey: null, dirty: true });
    },
    redo() {
      const { past, project, future } = get();
      if (!future.length) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project], lastMergeKey: null, dirty: true });
    },
    loadProject(p, fileName = '') {
      set({ project: p, past: [], future: [], lastMergeKey: null, selection: null, range: null, cursorA: null, cursorB: null, dirty: false, fileName });
      setTimeout(() => get().fitZoom(), 0);
    },
    markSaved(fileName) {
      set({ dirty: false, ...(fileName ? { fileName } : {}) });
    },

    setMeta(patch, mergeKey) {
      mutate((p) => ({ ...p, meta: { ...p.meta, ...patch } }), mergeKey);
    },
    setSettings(patch, mergeKey) {
      mutate((p) => ({ ...p, settings: { ...p.settings, ...patch } }), mergeKey);
    },
    addSignal(partial = {}, index) {
      const s = createSignal({ name: `신호 ${get().project.signals.length + 1}`, ...partial });
      mutate((p) => {
        const signals = [...p.signals];
        signals.splice(index ?? signals.length, 0, s);
        return { ...p, signals };
      });
      set({ selection: { type: 'signals', ids: [s.id] } });
      return s.id;
    },
    updateSignal(id, patch, mergeKey) {
      mutate(
        (p) =>
          mapSignals(p, (s) => {
            if (s.id !== id) return s;
            const next = typeof patch === 'function' ? patch(s) : { ...s, ...patch };
            // 종류가 바뀌면 파형 값을 변환
            if (next.kind !== s.kind) {
              if (next.kind === 'bus') next.points = normalize(s.points.map((pt) => ({ t: pt.t, v: String(pt.v) })), 'bus', '0');
              else if (next.kind === 'bit') next.points = normalize(s.points.map((pt) => ({ t: pt.t, v: Number(pt.v) ? 1 : 0 })), 'bit', 0);
              else if (next.kind === 'analog') {
                next.points = normalize(s.points.map((pt) => ({ t: pt.t, v: Number(pt.v) || 0 })), 'analog', 0);
                next.analogMin ??= 0;
                next.analogMax ??= 10;
                next.heightScale ??= 1.6;
              } else if (next.kind === 'clock') {
                next.clockPeriod ??= get().project.settings.grid * 2;
                next.clockDuty ??= 0.5;
              }
            }
            return next;
          }),
        mergeKey,
      );
    },
    updateSignals(ids, patch) {
      const set_ = new Set(ids);
      mutate((p) => mapSignals(p, (s) => (set_.has(s.id) ? { ...s, ...patch } : s)));
    },
    removeSignals(ids) {
      const del = new Set(ids);
      mutate((p) => ({
        ...p,
        signals: p.signals.filter((s) => !del.has(s.id)),
        annotations: p.annotations.filter((a) => {
          if (a.type === 'arrow') return !del.has(a.from.signalId) && !del.has(a.to.signalId);
          if (a.type === 'dimension' || a.type === 'note') return !a.signalId || !del.has(a.signalId);
          return true;
        }),
        rules: p.rules.filter((r) => {
          if (r.type === 'delay') return !del.has(r.fromSignal) && !del.has(r.toSignal);
          if (r.type === 'exclusive') return !del.has(r.a) && !del.has(r.b);
          if (r.type === 'pulse') return !del.has(r.signal);
          return true;
        }),
      }));
      set({ selection: null });
    },
    moveSignal(id, toIndex) {
      mutate((p) => {
        const from = p.signals.findIndex((s) => s.id === id);
        if (from < 0) return p;
        const signals = [...p.signals];
        const [s] = signals.splice(from, 1);
        signals.splice(Math.max(0, Math.min(toIndex, signals.length)), 0, s);
        return { ...p, signals };
      });
    },
    duplicateSignals(ids) {
      const newIds: string[] = [];
      mutate((p) => {
        const signals: Signal[] = [];
        for (const s of p.signals) {
          signals.push(s);
          if (ids.includes(s.id)) {
            const c = { ...structuredClone(s), id: uid('sig'), name: `${s.name} (복사)` };
            newIds.push(c.id);
            signals.push(c);
          }
        }
        return { ...p, signals };
      });
      set({ selection: { type: 'signals', ids: newIds } });
    },
    addStep(partial = {}) {
      const p = get().project;
      const n = p.steps.length;
      const last = [...p.steps].sort((a, b) => b.end - a.end)[0];
      const start = partial.start ?? last?.end ?? 0;
      const st = createStep({
        label: `S${(n + 1) * 10}`,
        start,
        end: partial.end ?? Math.min(start + p.settings.grid * 10, p.settings.duration),
        color: STEP_COLORS[n % STEP_COLORS.length],
        ...partial,
      });
      mutate((pp) => ({ ...pp, steps: [...pp.steps, st].sort((a, b) => a.start - b.start) }));
      set({ selection: { type: 'step', id: st.id } });
      return st.id;
    },
    updateStep(id, patch, mergeKey) {
      mutate((p) => ({ ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), mergeKey);
    },
    removeStep(id) {
      mutate((p) => ({ ...p, steps: p.steps.filter((s) => s.id !== id) }));
      set({ selection: null });
    },
    addAnnotation(a) {
      mutate((p) => ({ ...p, annotations: [...p.annotations, a] }));
      set({ selection: { type: 'annotation', id: a.id } });
    },
    updateAnnotation(id, patch, mergeKey) {
      mutate((p) => ({ ...p, annotations: p.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)) }), mergeKey);
    },
    removeAnnotation(id) {
      mutate((p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== id) }));
      set({ selection: null });
    },
    addRule(r) {
      mutate((p) => ({ ...p, rules: [...p.rules, r] }));
    },
    updateRule(id, patch, mergeKey) {
      mutate((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? ({ ...r, ...patch } as TimingRule) : r)) }), mergeKey);
    },
    removeRule(id) {
      mutate((p) => ({ ...p, rules: p.rules.filter((r) => r.id !== id) }));
    },
    insertTimeAll(at, dt) {
      mutate((p) => ({
        ...p,
        settings: { ...p.settings, duration: p.settings.duration + dt },
        signals: p.signals.map((s) => ({ ...s, points: insertTime(s.points, at, dt) })),
        steps: p.steps.map((s) => ({ ...s, start: s.start >= at ? s.start + dt : s.start, end: s.end > at ? s.end + dt : s.end })),
        annotations: p.annotations.map((a) => shiftAnnotation(a, (t) => (t >= at ? t + dt : t))),
      }));
    },
    deleteTimeAll(t0, t1) {
      const dt = t1 - t0;
      const f = (t: number) => (t >= t1 ? t - dt : t > t0 ? t0 : t);
      mutate((p) => ({
        ...p,
        settings: { ...p.settings, duration: Math.max(p.settings.grid, p.settings.duration - dt) },
        signals: p.signals.map((s) => ({ ...s, points: deleteTime(s.points, t0, t1, s.kind) })),
        steps: p.steps.map((s) => ({ ...s, start: f(s.start), end: f(s.end) })).filter((s) => s.end > s.start),
        annotations: p.annotations.map((a) => shiftAnnotation(a, f)),
      }));
    },
    scaleTimeAll(factor) {
      const f = (t: number) => Math.round(t * factor * 1000) / 1000;
      mutate((p) => ({
        ...p,
        settings: { ...p.settings, duration: f(p.settings.duration), grid: f(p.settings.grid) || p.settings.grid },
        signals: p.signals.map((s) => ({
          ...s,
          points: scaleTime(s.points, factor),
          ...(s.clockPeriod ? { clockPeriod: f(s.clockPeriod) } : {}),
          ...(s.defaultRamp ? { defaultRamp: f(s.defaultRamp) } : {}),
        })),
        steps: p.steps.map((s) => ({ ...s, start: f(s.start), end: f(s.end) })),
        annotations: p.annotations.map((a) => shiftAnnotation(a, f)),
        rules: p.rules.map((r) => {
          if (r.type === 'cycle') return { ...r, max: f(r.max) };
          if (r.type === 'delay' || r.type === 'pulse') return { ...r, ...(r.min !== undefined ? { min: f(r.min) } : {}), ...(r.max !== undefined ? { max: f(r.max) } : {}) };
          return r;
        }),
      }));
    },

    setTab(tab) {
      set({ tab });
    },
    setTool(tool) {
      set({ tool });
    },
    select(selection) {
      set({ selection });
    },
    setRange(range) {
      set({ range });
    },
    setZoom(z) {
      set({ zoom: Math.min(Math.max(z, 0.0005), 50) });
    },
    setSnap(snap) {
      set({ snap });
    },
    setCursor(which, t) {
      set(which === 'A' ? { cursorA: t } : { cursorB: t });
    },
    setHoverT(hoverT) {
      set({ hoverT });
    },
    setLang(lang) {
      setLang(lang);
      set({ lang });
      savePrefs({ lang, theme: get().theme });
    },
    setTheme(theme) {
      set({ theme });
      savePrefs({ lang: get().lang, theme });
    },
    setBottom(bottom) {
      set({ bottom });
    },
    toggleProps() {
      set({ showProps: !get().showProps });
    },
    toast(msg, kind = 'info') {
      const id = ++toastSeq;
      set({ toasts: [...get().toasts.slice(-3), { id, msg, kind }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setViewWidth(viewWidth) {
      set({ viewWidth });
    },
    fitZoom() {
      const { project, viewWidth } = get();
      const d = Math.max(project.settings.duration, 1);
      set({ zoom: Math.max((viewWidth - 24) / d, 0.0005) });
    },
    revealTime(t) {
      set({ scrollToTime: t });
      setTimeout(() => set({ scrollToTime: null }), 0);
    },
  };
});

function shiftAnnotation(a: Annotation, f: (t: number) => number): Annotation {
  switch (a.type) {
    case 'arrow':
      return { ...a, from: { ...a.from, t: f(a.from.t) }, to: { ...a.to, t: f(a.to.t) } };
    case 'dimension':
      return { ...a, t1: f(a.t1), t2: f(a.t2) };
    case 'note':
    case 'marker':
      return { ...a, t: f(a.t) };
  }
}

// 자동 저장 (0.8초 디바운스)
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let warnedQuota = false;
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s.project));
    } catch {
      // 브라우저 저장 공간 부족 (대용량 CSV 로그 등) - 한 번만 알림
      if (!warnedQuota) {
        warnedQuota = true;
        useStore.getState().toast('차트가 커서 자동 백업을 할 수 없습니다. 파일로 저장(Ctrl+S)하세요.', 'warn');
      }
    }
  }, 800);
});

export function newEmptyProject(): Project {
  const p = createProject();
  p.signals = [
    createSignal({ name: '입력 1', address: 'X0', role: 'input', color: '#2563eb' }),
    createSignal({ name: '출력 1', address: 'Y0', role: 'output', color: '#dc2626' }),
  ];
  return p;
}

export const selectedSignalIds = (s: Selection): string[] => (s?.type === 'signals' ? s.ids : []);
