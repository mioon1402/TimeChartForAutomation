import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Project } from '../model/types';
import { emptyCircuit, type Circuit, type LampColor, type OpStep, type Part, type Pole, type Wire, type WireColor } from '../circuit/types';
import { FOLLOWER, LAMP_PREFIX, lampColorName, nextTag, palette, PARTS, partBox, partKindName, plcAddresses, plcBases, VALVES, type PaletteItem } from '../circuit/parts';
import type { PlcDialect } from '../plc/types';
import { dialectName } from '../plc/program';
import { airDriven, CircuitModel, CircuitSim, normTag, runScenario, tagKey, type OpEvent, type ScenarioResult } from '../circuit/engine';
import { applyCircuit, autoChartOn, circuitStatus, circuitToProject } from '../circuit/chart';
import { bomCsv, bomSummary, checkCircuit, contactsLabel, partsList, type CircuitIssue } from '../circuit/bom';
import { CircuitCanvas, NO_SEL, type Sel } from './CircuitCanvas';
import { CIRCUIT_DARK, CIRCUIT_LIGHT, PartGlyph, partState, type CircuitColors } from '../render/CircuitSvg';
import { ChartSvg } from '../render/ChartSvg';
import { SCREEN_COLORS } from '../render/layout';
import { formatTime } from '../model/format';
import { uid } from '../model/wave';
import { downloadText, safeFileName } from '../io/files';
import { niceCeil } from '../plc/simulator';
import { askConfirm, askText, Check, Field, Icon, IconButton, Menu, NumberInput, Select, TimeInput } from './ui';
import * as F from './fileActions';
import { circuitExamples } from '../circuit/examples';
import { tr } from '../i18n';
import { WEB_TRIAL } from '../env';
import { WIRE_HEX } from '../render/RealSymbols';
import { wireColorName, wiringCsv, wiringList, type WiringRow } from '../circuit/wiring';
import { storageGet, storageSet } from '../storage';

const EMPTY = emptyCircuit();
let lastZoom = 1;
let clip: { parts: Part[]; wires: Wire[] } | null = null;
let pasteCount = 0;

type Side = 'props' | 'ops' | 'bom' | 'wiring' | 'check';

interface Running {
  sim: CircuitSim;
  /** performance.now() 기준점과 그때의 시뮬레이션 시각 */
  base: number;
  startT: number;
  speed: number;
  actions: OpEvent[];
}

/** 팔레트 항목 → 새 부품 (기호는 앞글자 + 다음 번호, 접점은 최근 코일 기호) */
export function makePart(c: Circuit, item: PaletteItem, x: number, y: number, id = uid('cp'), dialect?: PlcDialect): Part {
  const def = PARTS[item.type];
  const p: Part = { id, type: item.type, x, y, rot: 0, tag: '', ...item.init };
  if (!item.init?.tag) {
    if (FOLLOWER.has(item.type)) {
      const coils = c.parts.filter((q) => (q.type === 'coil' || q.type === 'timer') && q.tag.trim() && (item.type !== 'km3' || /^(MC|KM)/i.test(q.tag)));
      p.tag = coils.length ? coils[coils.length - 1].tag : item.type === 'km3' ? 'MC1' : 'X1';
    } else {
      const prefix = item.type === 'lamp' || item.type === 'r_lamp' ? LAMP_PREFIX[p.color ?? 'red'] : item.prefix ?? def.prefix;
      p.tag = nextTag(c.parts, prefix);
    }
  }
  if (item.type === 'plc') {
    const b = plcBases(dialect);
    p.inBase = b.in;
    p.outBase = b.out;
  }
  // 아직 아무것도 쓰지 않는 솔레노이드 기호를 실린더·밸브에 붙여 준다
  const used = new Set(c.parts.flatMap((q) => [q.solPlus, q.solMinus, q.solA, q.solB].map((t) => normTag(t ?? ''))));
  const free = c.parts.filter((q) => q.type === 'sol' && q.tag.trim() && !used.has(normTag(q.tag))).map((q) => q.tag);
  if (item.type === 'cyl') {
    p.solPlus = free[0] ?? '';
    p.solMinus = free[1] ?? '';
  }
  if (VALVES.has(item.type)) {
    p.solA = free[0] ?? '';
    if (item.type === 'v52d' || item.type === 'v53') p.solB = free[1] ?? '';
  }
  return p;
}

/** 시뮬레이션 중 누른 기록 → 조작 순서 */
function actionsToOps(actions: OpEvent[], model: CircuitModel): OpStep[] {
  const ops: OpStep[] = [];
  const r10 = (t: number) => Math.round(t / 10) * 10;
  let prev = 0;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const main = model.mainPart.get(a.tag);
    const momentary = main && PARTS[main.type].operate === 'momentary';
    if (momentary && !a.on) continue;
    const t = r10(a.t);
    const op: OpStep = { id: uid('op'), wait: Math.max(0, t - prev), tag: model.label(a.tag), action: 'press', hold: 300 };
    if (momentary) {
      const up = actions.slice(i + 1).find((b) => b.tag === a.tag && !b.on);
      op.hold = Math.max(10, r10((up?.t ?? a.t + 300) - a.t));
    } else op.action = a.on ? 'on' : 'off';
    ops.push(op);
    prev = t;
  }
  return ops;
}

export function CircuitPanel() {
  const project = useStore((s) => s.project);
  const theme = useStore((s) => s.theme);
  const { commit, endMerge, toast, setTab } = useStore.getState();
  const circuit = project.circuit ?? EMPTY;
  const model = useMemo(() => new CircuitModel(circuit, project.plc), [circuit, project.plc]);
  const issues = useMemo(() => checkCircuit(circuit, model), [circuit, model]);
  const wiring = useMemo(() => wiringList(circuit, model), [circuit.parts, circuit.wires, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wirePick, setWirePick] = useState<string | null>(null);
  const colors: CircuitColors = theme === 'dark' ? CIRCUIT_DARK : CIRCUIT_LIGHT;
  const [sel, setSel] = useState<Sel>(NO_SEL);
  const [tool, setTool] = useState<'select' | 'wire'>('select');
  const [placing, setPlacing] = useState<PaletteItem | null>(null);
  const [side, setSide] = useState<Side>(circuit.parts.length ? 'ops' : 'props');
  const [zoom, setZoomState] = useState(lastZoom);
  const setZoom = (z: number) => {
    lastZoom = z;
    setZoomState(z);
  };
  const runRef = useRef<Running | null>(null);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [liveTick, setLiveTick] = useState(0);
  const [showPreview, setShowPreview] = useState(true);
  // 다른 차트로 바꾸거나 예제를 열면 화면 맞춤
  const [fitKey, setFitKey] = useState(0);
  const prevFit = useRef({ id: project.id, n: circuit.parts.length });
  useEffect(() => {
    const pf = prevFit.current;
    if (pf.id !== project.id || (pf.n === 0 && circuit.parts.length > 3)) setFitKey((k) => k + 1);
    prevFit.current = { id: project.id, n: circuit.parts.length };
  }, [project.id, circuit.parts.length]);

  /** 회로를 바꿔 저장 (자동 적용이 켜져 있으면 차트도 같은 실행 취소 단계로) */
  const commitCircuit = (next: Circuit, mergeKey?: string, regen = true) => {
    const st = useStore.getState();
    let p: Project = { ...st.project, circuit: next };
    if (regen && autoChartOn(p)) p = applyCircuit(p);
    commit(p, mergeKey);
  };

  // 지워진 부품은 선택에서 뺀다
  useEffect(() => {
    const ids = new Set(circuit.parts.map((p) => p.id));
    const wids = new Set(circuit.wires.map((w) => w.id));
    if (sel.parts.some((id) => !ids.has(id)) || sel.wires.some((id) => !wids.has(id))) setSel({ parts: sel.parts.filter((id) => ids.has(id)), wires: sel.wires.filter((id) => wids.has(id)) });
  }, [circuit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────── 시뮬레이션 (실시간) ─────────────

  const simTime = (now: number) => {
    const r = runRef.current!;
    return r.startT + (now - r.base) * r.speed;
  };

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    let lastLive = 0;
    const loop = (now: number) => {
      const r = runRef.current;
      if (!r) return;
      r.sim.advanceTo(simTime(now));
      if (now - last > 30) {
        last = now;
        setTick((t) => t + 1);
      }
      if (now - lastLive > 250) {
        lastLive = now;
        setLiveTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => void (runRef.current = null), []);

  const startSim = () => {
    if (!circuit.parts.length) {
      toast(tr('먼저 회로를 그리세요 (왼쪽 부품을 누르고 그림판을 누르면 놓입니다)', 'Draw a circuit first'), 'warn');
      return;
    }
    const sim = new CircuitSim(model);
    runRef.current = { sim, base: performance.now(), startT: 0, speed: 1, actions: [] };
    setPlacing(null);
    setSel(NO_SEL);
    setRunning(true);
    const errs = issues.filter((i) => i.level === 'error').length;
    toast(errs ? tr(`시뮬레이션 시작 (검사 문제 ${errs}개)`, `Simulation started (${errs} issues)`) : tr('시뮬레이션 시작: 버튼·스위치를 눌러 보세요', 'Simulation running: click buttons and switches'), errs ? 'warn' : 'ok');
  };

  const stopSim = async () => {
    const r = runRef.current;
    runRef.current = null;
    setRunning(false);
    if (r && r.actions.length) {
      const ok = await askConfirm(
        tr('조작 순서로 저장', 'Save as operation sequence'),
        tr(`방금 누른 조작 ${r.actions.filter((a) => a.on || PARTS[model.mainPart.get(a.tag)?.type ?? 'pb_no'].operate !== 'momentary').length}개를 조작 순서표로 바꿀까요? 그러면 타임차트가 그 순서대로 만들어집니다.`, 'Turn the operations you just made into the operation sequence? The timing chart follows it.'),
        tr('조작 순서로 저장', 'Save'),
      );
      if (ok) {
        commitCircuit({ ...circuit, ops: actionsToOps(r.actions, model) });
        setSide('ops');
      }
    }
  };

  const setSpeed = (speed: number) => {
    const r = runRef.current;
    if (!r) return;
    const now = performance.now();
    r.startT = simTime(now);
    r.base = now;
    r.speed = speed;
    setTick((t) => t + 1);
  };

  const onOperate = (tag: string, phase: 'down' | 'up') => {
    const r = runRef.current;
    if (!r) return;
    const t = simTime(performance.now());
    r.sim.advanceTo(t);
    const main = model.mainPart.get(tag);
    const momentary = !!main && PARTS[main.type].operate === 'momentary';
    let v: boolean | null = null;
    if (phase === 'down') v = momentary ? true : !r.sim.on(tag);
    else if (momentary) v = false;
    if (v !== null && r.sim.setAct(tag, v)) r.actions.push({ t, tag, on: v });
    setTick((x) => x + 1);
  };

  // ───────────── 편집 ─────────────

  const updatePart = (id: string, patch: Partial<Part>, key?: string) => commitCircuit({ ...circuit, parts: circuit.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) }, key);
  const deleteSel = () => {
    if (!sel.parts.length && !sel.wires.length) return;
    const ps = new Set(sel.parts);
    const ws = new Set(sel.wires);
    commitCircuit({ ...circuit, parts: circuit.parts.filter((p) => !ps.has(p.id)), wires: circuit.wires.filter((w) => !ws.has(w.id)) });
    setSel(NO_SEL);
  };
  const rotateSel = () => {
    if (!sel.parts.length) return;
    const ps = new Set(sel.parts);
    commitCircuit({ ...circuit, parts: circuit.parts.map((p) => (ps.has(p.id) ? { ...p, rot: ((p.rot + 90) % 360) as Part['rot'] } : p)) });
  };
  const copySel = () => {
    if (!sel.parts.length && !sel.wires.length) return false;
    clip = { parts: circuit.parts.filter((p) => sel.parts.includes(p.id)), wires: circuit.wires.filter((w) => sel.wires.includes(w.id)) };
    pasteCount = 0;
    return true;
  };
  const paste = () => {
    if (!clip) return;
    pasteCount++;
    const d = 2 * pasteCount;
    const parts = clip.parts.map((p) => ({ ...p, id: uid('cp'), x: p.x + d, y: p.y + d }));
    const wires = clip.wires.map((w) => ({ ...w, id: uid('cw'), a: [w.a[0] + d, w.a[1] + d] as [number, number], b: [w.b[0] + d, w.b[1] + d] as [number, number] }));
    commitCircuit({ ...circuit, parts: [...circuit.parts, ...parts], wires: [...circuit.wires, ...wires] });
    setSel({ parts: parts.map((p) => p.id), wires: wires.map((w) => w.id) });
  };
  const nudge = (dx: number, dy: number) => {
    const ps = new Set(sel.parts);
    const ws = new Set(sel.wires);
    if (!ps.size && !ws.size) return;
    commitCircuit(
      {
        ...circuit,
        parts: circuit.parts.map((p) => (ps.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
        wires: circuit.wires.map((w) => (ws.has(w.id) ? { ...w, a: [w.a[0] + dx, w.a[1] + dy], b: [w.b[0] + dx, w.b[1] + dy] } : w)),
      },
      'cc-nudge',
    );
  };
  const onPlace = (item: PaletteItem, x: number, y: number, keep: boolean) => {
    const p = makePart(circuit, item, x, y, undefined, project.plc?.dialect);
    commitCircuit({ ...circuit, parts: [...circuit.parts, p] });
    setSel({ parts: [p.id], wires: [] });
    setSide('props');
    if (!keep) setPlacing(null);
  };
  const editTag = async (p: Part) => {
    if (p.type === 'text') {
      const v = await askText(tr('글자', 'Text'), tr('글자', 'Text'), p.text ?? '');
      if (v !== null) updatePart(p.id, { text: v });
      return;
    }
    if (p.type === 'src' || p.type === 'src3') return;
    const v = await askText(tr('기호', 'Tag'), tr('기호 (같은 기호끼리 연동: 코일 X1 ↔ 접점 X1)', 'Tag (same tags work together)'), p.tag);
    if (v !== null) updatePart(p.id, { tag: v.trim() });
  };

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().tab !== 'circuit') return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('.modal-back')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (running) {
        if (e.key === 'Escape') void stopSim();
        return;
      }
      if (e.key === 'Escape') {
        setPlacing(null);
        setTool('select');
        setSel(NO_SEL);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSel();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSel({ parts: circuit.parts.map((p) => p.id), wires: circuit.wires.map((w) => w.id) });
      } else if (mod && key === 'c') copySel();
      else if (mod && key === 'x') {
        if (copySel()) deleteSel();
      } else if (mod && key === 'v') paste();
      else if (mod && key === 'd') {
        e.preventDefault();
        if (copySel()) paste();
      } else if (!mod && !e.altKey) {
        if (key === 'r') rotateSel();
        else if (key === 'w') setTool('wire');
        else if (key === 'v' || key === 's') setTool('select');
        else if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          nudge(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ───────────── 타임차트 ─────────────

  const preview = useMemo((): { res: ScenarioResult; project: Project } | null => {
    if (!circuit.parts.length) return null;
    const res = runScenario(circuit, model);
    return { res, project: circuitToProject(project, circuit, res) };
  }, [circuit, model, project]);

  const live = useMemo((): Project | null => {
    const r = runRef.current;
    if (!running || !r) return null;
    const t = r.sim.t;
    const res: ScenarioResult = { model, tracks: r.sim.tracks.map((x) => ({ ...x, points: [...x.points] })), end: t, lastChange: t, warnings: [], times: [] };
    return circuitToProject({ ...project, signals: [], annotations: [] }, { ...circuit, ops: [], duration: niceCeil(Math.max(5000, t + 500)) }, res);
  }, [liveTick, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = circuitStatus(project);
  const auto = autoChartOn(project);
  const apply = async () => {
    if (!preview) return;
    const p = useStore.getState().project;
    if (!p.circuit?.applied && p.signals.length) {
      const ok = await askConfirm(tr('타임차트에 적용', 'Apply to timing chart'), tr(`지금 차트의 신호 ${p.signals.length}개를 회로 시뮬레이션 결과로 바꿉니다. 같은 기호의 신호는 이름·색을 유지합니다. 계속할까요? (새 차트 탭으로 하려면 [+ 차트 추가] → 회로도)`, `Replace the ${p.signals.length} signals of this chart with the circuit result? Rows with the same tag keep their names and colours.`), tr('적용', 'Apply'));
      if (!ok) return;
    }
    commit(applyCircuit(p));
    toast(tr('회로 시뮬레이션 결과를 타임차트에 적용했습니다', 'Applied the circuit result to the timing chart'), 'ok');
  };

  const selected = sel.parts.length === 1 && !sel.wires.length ? circuit.parts.find((p) => p.id === sel.parts[0]) ?? null : null;
  const flagged = useMemo(() => new Set(issues.filter((i) => i.level === 'error').flatMap((i) => i.partIds)), [issues]);
  const errCount = issues.filter((i) => i.level === 'error').length;
  const r = runRef.current;

  return (
    <div className="circuit">
      <div className="cc-toolbar">
        <div className="tool-group">
          <IconButton icon="select" title={tr('선택 · 이동 (V) — 부품 몸통을 끌면 이동, 단자를 끌면 선', 'Select / move (V)')} active={tool === 'select' && !placing} onClick={() => (setTool('select'), setPlacing(null))} disabled={running} />
          <IconButton icon="wire" title={tr('선 긋기 (W) — 점에서 점으로 끌기', 'Wire (W) — drag point to point')} active={tool === 'wire' && !placing} onClick={() => (setTool('wire'), setPlacing(null))} disabled={running} />
          <IconButton icon="rotate" title={tr('회전 (R)', 'Rotate (R)')} onClick={rotateSel} disabled={running || !sel.parts.length} />
          <IconButton icon="trash" title={tr('삭제 (Delete)', 'Delete')} onClick={deleteSel} disabled={running || (!sel.parts.length && !sel.wires.length)} />
        </div>
        <div className="sep" />
        <Menu
          label={tr('예제 회로', 'Examples')}
          icon="circuit"
          items={[
            ...circuitExamples().map((ex) => ({ label: ex.name, icon: 'circuit', onClick: () => F.openCircuitExample(ex.id) })),
            { divider: true },
            { label: tr('새 회로도 (새 차트 탭)', 'New circuit (new chart tab)'), icon: 'plus', onClick: F.addCircuitSheet },
          ]}
        />
        <div className="sep" />
        <div className="tool-group">
          <IconButton icon="zoomOut" title={tr('축소 (Ctrl+휠)', 'Zoom out')} onClick={() => setZoom(Math.max(0.3, zoom / 1.2))} />
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <IconButton icon="zoomIn" title={tr('확대 (Ctrl+휠)', 'Zoom in')} onClick={() => setZoom(Math.min(3, zoom * 1.2))} />
          <IconButton icon="fit" title={tr('화면 맞춤', 'Fit')} onClick={() => setFitKey((k) => k + 1)} />
        </div>
        <div className="sep" />
        {running ? (
          <>
            <button type="button" className="btn small danger-btn" onClick={() => void stopSim()} title="Esc">
              <Icon name="stop" size={14} /> {tr('정지', 'Stop')}
            </button>
            <select className="input cc-speed" value={r?.speed ?? 1} onChange={(e) => setSpeed(Number(e.target.value))} title={tr('시뮬레이션 속도', 'Speed')}>
              {[0, 0.25, 0.5, 1, 2, 4].map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? tr('일시정지', 'Pause') : `×${s}`}
                </option>
              ))}
            </select>
            <span className="cc-clock">t = {formatTime(r?.sim.t ?? 0, 's')}</span>
            {r?.sim.shorted && <span className="chip danger">{tr('단락!', 'Short!')}</span>}
          </>
        ) : (
          <button type="button" className="btn small primary" onClick={startSim} data-tour="cc-run" title={tr('버튼·스위치를 마우스로 눌러 회로를 움직여 봅니다', 'Run and click buttons')}>
            <Icon name="play" size={14} /> {tr('시뮬레이션', 'Simulate')}
          </button>
        )}
        <span className="grow" />
        <span className="cc-hint muted small">
          {running
            ? tr('버튼을 누르고 있으면 ON, 스위치·차단기·THR 은 누를 때마다 바뀝니다. 끝나면 [정지]', 'Hold push buttons; click switches, breakers and THR to toggle')
            : placing
              ? tr('그림판을 누르면 놓입니다 (Shift: 계속 놓기, Esc: 취소)', 'Click to place (Shift: keep placing, Esc: cancel)')
              : tr('단자를 끌면 선, 몸통을 끌면 이동 · R 회전 · Del 삭제 · Ctrl+C/V · 두 번 누르면 기호', 'Drag a terminal to wire, the body to move · R rotate · Del')}
        </span>
        {!WEB_TRIAL && (
          <Menu
            label="▾"
            icon="image"
            items={[
              { label: tr('회로도 PNG 이미지', 'Circuit PNG'), icon: 'image', onClick: () => void F.exportCircuitImage('png') },
              { label: tr('회로도 SVG (벡터)', 'Circuit SVG'), icon: 'image', onClick: () => void F.exportCircuitImage('svg') },
              { label: tr('부품 리스트 CSV (엑셀)', 'Parts list CSV'), icon: 'table', onClick: () => downloadText(`${safeFileName(project.meta.title || 'circuit')}_${tr('부품리스트', 'parts')}.csv`, bomCsv(circuit), 'text/csv;charset=utf-8') },
              { label: tr('결선표 CSV (엑셀)', 'Wiring list CSV'), icon: 'table', onClick: () => downloadText(`${safeFileName(project.meta.title || 'circuit')}_${tr('결선표', 'wiring')}.csv`, wiringCsv(wiring, new Set(circuit.wired ?? [])), 'text/csv;charset=utf-8') },
            ]}
          />
        )}
      </div>

      <div className={`cc-work ${showPreview ? '' : 'no-preview'}`}>
        <Palette c={colors} placing={placing} disabled={running} onPick={(it) => (setPlacing(placing?.key === it.key ? null : it), setTool('select'))} />
        <CircuitCanvas
          circuit={circuit}
          model={model}
          colors={colors}
          sel={sel}
          setSel={(s) => (setSel(s), s.parts.length || s.wires.length ? setSide('props') : undefined)}
          tool={tool}
          placing={placing}
          onPlace={onPlace}
          zoom={zoom}
          setZoom={setZoom}
          sim={running ? r?.sim ?? null : null}
          onOperate={onOperate}
          onCommit={commitCircuit}
          onEndMerge={endMerge}
          onEditPart={(p) => void editTag(p)}
          flagged={flagged}
          ghostPart={(item, x, y) => makePart(circuit, item, x, y, 'ghost', project.plc?.dialect)}
          fitKey={fitKey}
          highlight={side === 'wiring' ? wireHighlight(wiring.find((r) => r.key === wirePick)) : null}
        />
        <aside className="cc-side">
          <div className="seg cc-tabs">
            <button type="button" className={side === 'props' ? 'on' : ''} onClick={() => setSide('props')}>
              {tr('속성', 'Properties')}
            </button>
            <button type="button" className={side === 'ops' ? 'on' : ''} onClick={() => setSide('ops')} data-tour="cc-ops">
              {tr('조작 순서', 'Operations')} {circuit.ops.length ? <b>{circuit.ops.length}</b> : null}
            </button>
            <button type="button" className={side === 'bom' ? 'on' : ''} onClick={() => setSide('bom')}>
              {tr('부품 리스트', 'Parts list')}
            </button>
            <button type="button" className={side === 'wiring' ? 'on' : ''} onClick={() => setSide('wiring')}>
              {tr('결선표', 'Wiring')}
            </button>
            <button type="button" className={side === 'check' ? 'on' : ''} onClick={() => setSide('check')}>
              {tr('검사', 'Check')} {issues.length ? <b className={errCount ? 'bad' : ''}>{issues.length}</b> : null}
            </button>
          </div>
          <div className="cc-side-body">
            {side === 'props' && (
              <PropsPane
                circuit={circuit}
                model={model}
                sel={sel}
                part={selected}
                colors={colors}
                update={updatePart}
                remove={deleteSel}
                rotate={rotateSel}
                setWireColor={(color) => {
                  const ws = new Set(sel.wires);
                  commitCircuit({ ...circuit, wires: circuit.wires.map((w) => (ws.has(w.id) ? (color ? { ...w, color } : { id: w.id, a: w.a, b: w.b }) : w)) });
                }}
              />
            )}
            {side === 'ops' && <OpsPane circuit={circuit} model={model} res={preview?.res ?? null} onChange={commitCircuit} />}
            {side === 'bom' && <BomPane circuit={circuit} title={project.meta.title} />}
            {side === 'wiring' && (
              <WiringPane
                rows={wiring}
                done={circuit.wired ?? []}
                title={project.meta.title}
                pick={wirePick}
                onPick={setWirePick}
                onDone={(wired) => commitCircuit(wired.length ? { ...circuit, wired } : { ...circuit, wired: undefined }, 'wired', false)}
              />
            )}
            {side === 'check' && <CheckPane issues={issues} onPick={(ids) => (setSel({ parts: ids, wires: [] }), setSide('props'))} />}
          </div>
        </aside>
      </div>

      <section className={`cc-preview ${showPreview ? '' : 'closed'}`}>
        <header>
          <button type="button" className="section-toggle" onClick={() => setShowPreview(!showPreview)}>
            <span className="caret">{showPreview ? '▾' : '▸'}</span> {running ? tr('타임차트 (시뮬레이션 기록)', 'Timing chart (live recording)') : tr('타임차트 미리보기', 'Timing chart preview')}
          </button>
          {!running && preview && (
            <span className="muted small">
              {circuit.ops.length ? tr(`조작 ${circuit.ops.length}단계 · 마지막 변화 ${formatTime(preview.res.lastChange, 's')}`, `${circuit.ops.length} operations · last change ${formatTime(preview.res.lastChange, 's')}`) : tr('조작 순서가 없습니다: [조작 순서]에 적거나, 시뮬레이션에서 눌러 본 뒤 저장하세요', 'No operations yet: add them, or record them in the simulation')}
            </span>
          )}
          <span className="grow" />
          {!running && preview && (
            <>
              <Check checked={circuit.autoChart !== false} onChange={(v) => commitCircuit({ ...circuit, autoChart: v }, undefined, false)} label={tr('회로를 고치면 타임차트도 자동으로', 'Update the chart automatically')} />
              {auto && status === 'applied' ? (
                <span className="chip ok-chip">{tr('타임차트에 반영됨', 'In the chart')}</span>
              ) : (
                <button type="button" className="btn small primary" onClick={() => void apply()}>
                  <Icon name="chart" size={14} /> {tr('타임차트에 적용', 'Apply to chart')}
                </button>
              )}
              <button type="button" className="btn small" onClick={() => setTab('editor')}>
                {tr('타임차트 탭에서 보기', 'Open chart tab')}
              </button>
            </>
          )}
        </header>
        {showPreview && <PreviewChart project={running ? live : preview?.project ?? null} />}
      </section>
    </div>
  );
}

// ───────────────────────── 팔레트 ─────────────────────────

function MiniGlyph({ item, c }: { item: PaletteItem; c: CircuitColors }) {
  const p = makePart(emptyCircuit(), item, 0, 0, 'mini');
  const [x0, y0, x1, y1] = partBox(p);
  const w = Math.max((x1 - x0) * 20, 20);
  const h = Math.max((y1 - y0) * 20, 20);
  const model = useMemo(() => new CircuitModel(emptyCircuit()), []);
  return (
    <svg width={30} height={30} viewBox={`${x0 * 20 - 4} ${y0 * 20 - 4} ${w + 8} ${h + 8}`} aria-hidden="true">
      <g fill="none" strokeWidth={2.4} strokeLinecap="round">
        <PartGlyph part={{ ...p, tag: '' }} st={partState(p, model, null)} c={c} />
      </g>
    </svg>
  );
}

const PALETTE_KEY = 'timechart-studio.circuit-palette.v1';

function Palette({ c, placing, onPick, disabled }: { c: CircuitColors; placing: PaletteItem | null; onPick: (it: PaletteItem) => void; disabled: boolean }) {
  const [mode, setMode] = useState<'real' | 'symbol'>(() => (storageGet(PALETTE_KEY) === 'symbol' ? 'symbol' : 'real'));
  const pick = (m: 'real' | 'symbol') => {
    setMode(m);
    storageSet(PALETTE_KEY, m);
  };
  return (
    <nav className={`cc-palette ${disabled ? 'off' : ''}`} aria-label={tr('부품', 'Parts')} data-tour="cc-palette">
      <div className="seg cc-pal-mode" role="radiogroup">
        <button type="button" role="radio" aria-checked={mode === 'real'} className={mode === 'real' ? 'on' : ''} onClick={() => pick('real')} title={tr('실제 기기 모양과 단자 번호로 배선 (실체 배선도)', 'Real devices with terminal numbers (wiring diagram)')}>
          {tr('실물 배선', 'Wiring')}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'symbol'} className={mode === 'symbol' ? 'on' : ''} onClick={() => pick('symbol')} title={tr('전기 기호로 그리는 시퀀스도 (전개 접속도)', 'Schematic symbols (ladder style)')}>
          {tr('회로 기호', 'Symbols')}
        </button>
      </div>
      {palette()
        .filter((g) => !g.mode || g.mode === mode)
        .map((g) => (
        <div key={g.title} className="cc-pal-group">
          <div className="cc-pal-title">{g.title}</div>
          {g.items.map((it) => (
            <button type="button" key={it.key} className={`cc-pal-item ${placing?.key === it.key ? 'on' : ''}`} onClick={() => onPick(it)} disabled={disabled} title={partKindName(it.type)}>
              <MiniGlyph item={it} c={c} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
        ))}
    </nav>
  );
}

// ───────────────────────── 속성 ─────────────────────────

function TagInput({ value, onChange, list, placeholder }: { value: string; onChange: (v: string) => void; list?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="input mono"
      value={v}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onChange(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

const WIRE_CHOICES: [WireColor, string, string][] = [
  ['brown', '갈색 (L1)', 'Brown (L1)'],
  ['black', '검정 (L2)', 'Black (L2)'],
  ['grey', '회색 (L3 · 제어)', 'Grey (L3 / control)'],
  ['blue', '파랑 (N · 0V)', 'Blue (N / 0V)'],
  ['gy', '녹황 (PE)', 'Green-yellow (PE)'],
  ['red', '빨강 (+24V)', 'Red (+24V)'],
  ['yellow', '노랑', 'Yellow'],
  ['white', '흰색', 'White'],
  ['orange', '주황', 'Orange'],
];

function WireColorPicker({ circuit, ids, onPick }: { circuit: Circuit; ids: string[]; onPick: (c: WireColor | undefined) => void }) {
  const cur = new Set(circuit.wires.filter((w) => ids.includes(w.id)).map((w) => w.color ?? ''));
  return (
    <div className="cc-wirecolors">
      <span className="field-label">{tr('전선 색', 'Wire colour')}</span>
      <div className="cc-swatches">
        {WIRE_CHOICES.map(([k, ko, en]) => (
          <button type="button" key={k} className={`cc-swatch ${cur.size === 1 && cur.has(k) ? 'on' : ''}`} title={tr(ko, en)} aria-label={tr(ko, en)} onClick={() => onPick(k)} style={{ background: k === 'gy' ? 'repeating-linear-gradient(135deg,#16a34a 0 5px,#facc15 5px 10px)' : WIRE_HEX[k] }} />
        ))}
        <button type="button" className={`btn small ${cur.size === 1 && cur.has('') ? 'on' : ''}`} onClick={() => onPick(undefined)} title={tr('색 없이 회로도처럼 (시뮬레이션 중 극 색)', 'No colour (schematic style)')}>
          {tr('기호선', 'Plain')}
        </button>
      </div>
    </div>
  );
}

function PropsPane({ circuit, model, sel, part: p, colors, update, remove, rotate, setWireColor }: { circuit: Circuit; model: CircuitModel; sel: Sel; part: Part | null; colors: CircuitColors; update: (id: string, patch: Partial<Part>) => void; remove: () => void; rotate: () => void; setWireColor: (c: WireColor | undefined) => void }) {
  const bom = useMemo(() => partsList(circuit), [circuit]);
  if (!p) {
    const n = sel.parts.length + sel.wires.length;
    if (n)
      return (
        <div className="cc-props">
          <p>
            {tr(`부품 ${sel.parts.length}개, 선 ${sel.wires.length}개 선택`, `${sel.parts.length} parts, ${sel.wires.length} wires selected`)}
          </p>
          {sel.wires.length > 0 && <WireColorPicker circuit={circuit} ids={sel.wires} onPick={setWireColor} />}
          <div className="cc-btnrow">
            {sel.parts.length > 0 && (
              <button type="button" className="btn small" onClick={rotate}>
                <Icon name="rotate" size={13} /> {tr('회전', 'Rotate')}
              </button>
            )}
            <button type="button" className="btn small" onClick={remove}>
              <Icon name="trash" size={13} /> {tr('삭제', 'Delete')}
            </button>
          </div>
          <p className="muted small">{tr('끌어서 함께 옮기거나 방향키로 한 칸씩 옮깁니다. Ctrl+C / Ctrl+V 로 복사합니다.', 'Drag to move together or nudge with arrow keys. Ctrl+C / Ctrl+V to copy.')}</p>
        </div>
      );
    return <Tips />;
  }
  const def = PARTS[p.type];
  const tag = tagKey(p);
  const row = bom.find((r) => normTag(r.tag) === tag && r.tag);
  const kind = model.tagKind.get(tag);
  const coilTags = [...model.tagKind].filter(([, k]) => k !== 'sensor').map(([t]) => model.label(t)).filter((t) => !t.startsWith('#'));
  const solTags = circuit.parts.filter((q) => q.type === 'sol' && q.tag.trim()).map((q) => q.tag);
  const cylTags = circuit.parts.filter((q) => q.type === 'cyl' && q.tag.trim()).map((q) => q.tag);
  const set = (patch: Partial<Part>) => update(p.id, patch);
  const sameTag = circuit.parts.filter((q) => q.id !== p.id && q.tag.trim() && normTag(q.tag) === tag);
  return (
    <div className="cc-props">
      <div className="cc-props-head">
        <svg width={34} height={34} viewBox={(() => {
          const [x0, y0, x1, y1] = PARTS[p.type].box;
          const s = Math.max(x1 - x0, y1 - y0) * 20 + 8;
          return `${((x0 + x1) / 2) * 20 - s / 2} ${((y0 + y1) / 2) * 20 - s / 2} ${s} ${s}`;
        })()} aria-hidden="true">
          <g fill="none" strokeWidth={2.2}>
            <PartGlyph part={{ ...p, rot: 0 }} st={partState(p, model, null)} c={colors} />
          </g>
        </svg>
        <b>{partKindName(p.type)}</b>
      </div>
      {p.type === 'text' ? (
        <Field label={tr('글자', 'Text')} wide>
          <TagInput value={p.text ?? ''} onChange={(v) => set({ text: v })} />
        </Field>
      ) : p.type === 'src' || p.type === 'r_term' ? (
        <Field label={tr('전원 극', 'Supply pole')} wide hint={tr('같은 계통끼리 동작: +24V↔0V, L(L1)·L2·L3↔N. PE 는 접지 (L 과 닿으면 지락)', 'Works within a system: +24V↔0V, L/L1/L2/L3↔N. PE is earth')}>
          <Select value={p.pole ?? 'L'} onChange={(v: Pole) => set({ pole: v })} options={(['L', 'N', '+24V', '0V', 'L1', 'L2', 'L3', 'PE'] as Pole[]).map((x) => ({ value: x, label: x }))} />
        </Field>
      ) : p.type === 'plc' ? (
        <PlcProps p={p} set={set} model={model} />
      ) : p.type === 'src3' ? (
        <p className="muted small">{tr('3상 전원 L1 · L2 · L3. 전동기 U·V·W 에 L1→L2→L3 순서로 닿으면 정회전, 두 상을 바꾸면 역회전.', '3-phase supply. L1→L2→L3 on U·V·W runs forward; swapping two phases reverses.')}</p>
      ) : (
        <>
          <div className="grid2">
            <Field label={tr('기호', 'Tag')}>
              <TagInput value={p.tag} onChange={(v) => set({ tag: v.trim() })} list={FOLLOWER.has(p.type) ? 'cc-coil-tags' : undefined} />
            </Field>
            <Field label={tr('설명', 'Description')}>
              <TagInput value={p.name ?? ''} onChange={(v) => set({ name: v || undefined })} placeholder={tr('기동, 정지 …', 'Start, stop …')} />
            </Field>
          </div>
          <datalist id="cc-coil-tags">
            {coilTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {FOLLOWER.has(p.type) && (
            <p className={`small ${kind ? 'muted' : 'cc-bad'}`}>
              {kind === 'timer'
                ? tr(`타이머 ${p.tag} 의 한시 접점 (설정 시간 뒤 바뀜)`, `Timed contact of timer ${p.tag}`)
                : kind === 'coil'
                  ? tr(`코일 ${p.tag} 이(가) 여자되면 바뀝니다`, `Switches when coil ${p.tag} is energised`)
                  : kind === 'thr'
                    ? tr(`THR ${p.tag} 이(가) 트립되면 바뀝니다 (95-96 b, 97-98 a)`, `Switches when THR ${p.tag} trips`)
                    : kind === 'operator'
                      ? tr(`스위치 ${p.tag} 의 접점`, `Contact of switch ${p.tag}`)
                      : tr(`같은 기호(${p.tag || '?'})의 코일이 없습니다`, `No coil with tag ${p.tag || '?'}`)}
            </p>
          )}
          {(p.type === 'timer' || p.type === 'r_timer8') && (
            <div className="grid2">
              <Field label={tr('동작', 'Mode')}>
                <Select value={p.timerMode ?? 'on'} onChange={(v: 'on' | 'off' | 'flicker') => set({ timerMode: v })} options={[{ value: 'on', label: tr('ON 딜레이 (한시 동작)', 'On-delay') }, { value: 'off', label: tr('OFF 딜레이 (한시 복귀)', 'Off-delay') }, { value: 'flicker', label: tr('플리커 (점멸)', 'Flicker') }]} />
              </Field>
              <Field label={p.timerMode === 'flicker' ? tr('켜짐·꺼짐 시간', 'On/off time') : tr('설정 시간', 'Preset')}>
                <TimeInput value={p.preset ?? 3000} onChange={(v) => v !== undefined && set({ preset: v })} />
              </Field>
            </div>
          )}
          {p.type === 'r_timer8' && (
            <>
              <Check checked={!!p.inst13} onChange={(v) => set({ inst13: v || undefined })} label={tr('1-3 · 1-4 를 순시 접점으로 (한시 1a1b + 순시 1a1b)', '1-3 / 1-4 instantaneous (timed 1NO1NC + inst. 1NO1NC)')} />
              <p className="small muted">{tr('2-7 전원 · 8-6 한시 a · 8-5 한시 b · 1-3 a · 1-4 b (모델마다 다르니 기기 옆면 결선도를 확인)', 'Power 2-7 · 8-6 timed NO · 8-5 timed NC · 1-3 NO · 1-4 NC (check the label on your model)')}</p>
            </>
          )}
          {p.type === 'r_relay8' && <p className="small muted">{tr('2-7 코일 · 1-3 a · 1-4 b · 8-6 a · 8-5 b (MK2P · 소켓 PTF08A 꼴)', 'Coil 2-7 · 1-3 NO · 1-4 NC · 8-6 NO · 8-5 NC (MK2P-style, PTF08A socket)')}</p>}
          {p.type === 'r_tb' && (
            <Field label={tr('극수', 'Poles')} wide hint={tr('번호마다 위·아래 나사가 이어져 있습니다', 'Top and bottom screws of each number are connected')}>
              <NumberInput value={p.n ?? 6} min={1} max={40} onChange={(v) => set({ n: v ?? 6 })} />
            </Field>
          )}
          {(p.type === 'lamp' || p.type === 'pb_no' || p.type === 'pb_nc' || p.type === 'r_lamp' || p.type === 'r_pb') && (
            <Field label={tr('색', 'Colour')} wide>
              <Select value={p.color ?? (p.type === 'lamp' || p.type === 'r_lamp' ? 'red' : '')} onChange={(v) => set({ color: (v || undefined) as LampColor | undefined })} options={[...(p.type !== 'lamp' && p.type !== 'r_lamp' ? [{ value: '', label: '—' }] : []), ...(['red', 'green', 'yellow', 'white', 'blue'] as LampColor[]).map((x) => ({ value: x, label: lampColorName(x) }))]} />
            </Field>
          )}
          {p.type === 'prox' && (
            <div className="grid2">
              <Field label={tr('센서 종류', 'Sensor type')}>
                <Select value={p.sense ?? 'inductive'} onChange={(v) => set({ sense: v as Part['sense'] })} options={[{ value: 'inductive', label: tr('근접 (유도형, 금속)', 'Inductive (metal)') }, { value: 'capacitive', label: tr('근접 (정전용량형)', 'Capacitive') }, { value: 'photo', label: tr('광전 센서', 'Photoelectric') }]} />
              </Field>
              <Field label={tr('출력', 'Output')} hint={p.npn ? tr('감지하면 검정선이 0V 로 (부하는 +24V 쪽)', 'Black goes to 0V when detecting') : tr('감지하면 검정선이 +24V 로 (부하는 0V 쪽)', 'Black goes to +24V when detecting')}>
                <Select value={p.npn ? 'npn' : 'pnp'} onChange={(v) => set({ npn: v === 'npn' || undefined })} options={[{ value: 'pnp', label: 'PNP' }, { value: 'npn', label: 'NPN' }]} />
              </Field>
            </div>
          )}
          {(p.type === 'ls_no' || p.type === 'ls_nc') && (
            <Field label={tr('스위치 종류', 'Switch type')} wide>
              <Select value={p.sense ?? ''} onChange={(v) => set({ sense: (v || undefined) as Part['sense'] })} options={[{ value: '', label: tr('리밋 스위치 (롤러)', 'Limit switch (roller)') }, { value: 'reed', label: tr('리드 스위치 (실린더 센서)', 'Reed switch') }, { value: 'float', label: tr('플로트 스위치 (수위)', 'Float switch') }, { value: 'pressure', label: tr('압력 스위치', 'Pressure switch') }]} />
            </Field>
          )}
          {(p.type === 'ls_no' || p.type === 'ls_nc' || p.type === 'prox') && (
            <div className="grid2">
              <Field label={tr('실린더 연결', 'Cylinder')} hint={tr('비우면 시뮬레이션에서 눌러서 조작', 'Empty: operate by clicking')}>
                <Select value={p.cyl ?? ''} onChange={(v) => set({ cyl: v || undefined })} options={[{ value: '', label: tr('(손으로 조작)', '(manual)') }, ...cylTags.map((t) => ({ value: t, label: t }))]} />
              </Field>
              {p.cyl && (
                <Field label={tr('위치', 'Position')}>
                  <Select value={p.end ?? '+'} onChange={(v: '+' | '-') => set({ end: v })} options={[{ value: '+', label: tr('전진단 (+)', 'Extended (+)') }, { value: '-', label: tr('후진단 (−)', 'Retracted (−)') }]} />
                </Field>
              )}
            </div>
          )}
          {VALVES.has(p.type) && (
            <div className="grid2">
              <Field label={tr('솔레노이드 14 (왼쪽)', 'Solenoid 14 (left)')} hint={tr('켜지면 1→4 (A, 전진 쪽)', 'ON: 1→4 (A)')}>
                <Select value={p.solA ?? ''} onChange={(v) => set({ solA: v })} options={[{ value: '', label: '—' }, ...solTags.map((t) => ({ value: t, label: t }))]} />
              </Field>
              {(p.type === 'v52d' || p.type === 'v53') && (
                <Field label={tr('솔레노이드 12 (오른쪽)', 'Solenoid 12 (right)')} hint={tr('켜지면 1→2 (B, 후진 쪽)', 'ON: 1→2 (B)')}>
                  <Select value={p.solB ?? ''} onChange={(v) => set({ solB: v })} options={[{ value: '', label: '—' }, ...solTags.map((t) => ({ value: t, label: t }))]} />
                </Field>
              )}
              <p className="small muted cc-span2">
                {p.type === 'v32'
                  ? tr('1 = 공급(P), 2 = 출력(A), 3 = 배기. 꺼지면 스프링으로 2→배기.', '1 = supply, 2 = A, 3 = exhaust. Spring return.')
                  : p.type === 'v52'
                    ? tr('1 = 공급(P), 4 = A, 2 = B. 꺼지면 스프링으로 1→2 · 4 배기.', '1 = supply, 4 = A, 2 = B. Spring return to 1→2.')
                    : p.type === 'v52d'
                      ? tr('양솔: 펄스만 줘도 마지막 위치를 유지합니다.', 'Double solenoid: keeps the last position.')
                      : tr('둘 다 꺼지면 가운데(모든 포트 막힘) — 실린더가 그 자리에 멈춥니다.', 'Both off: centre, all ports closed — the cylinder stops.')}
              </p>
            </div>
          )}
          {p.type === 'fc' && (
            <Field label={tr('빠르기 (%)', 'Speed (%)')} wide hint={tr('배기되는 쪽 배관에 달면 그 방향 동작이 느려집니다 (미터 아웃)', 'On the exhaust side it slows that stroke (meter-out)')}>
              <NumberInput value={p.speed ?? 50} min={5} max={100} onChange={(v) => set({ speed: v ?? 50 })} />
            </Field>
          )}
          {p.type === 'cyl' && airDriven(model, tag) && (
            <p className="small muted">{tr(`배관으로 움직입니다 (${model.cylPorts.get(tag)!.rodTubed ? '복동' : '단동 · 스프링 복귀'}). 왼쪽 포트 = 헤드 쪽(전진), 오른쪽 포트 = 로드 쪽(후진).`, `Driven by air (${model.cylPorts.get(tag)!.rodTubed ? 'double-acting' : 'single-acting'}). Left port = cap end, right port = rod end.`)}</p>
          )}
          {p.type === 'cyl' && airDriven(model, tag) && (
            <div className="grid2">
              <Field label={tr('전진 시간', 'Advance time')}>
                <TimeInput value={p.stroke ?? 1000} onChange={(v) => v !== undefined && set({ stroke: v })} />
              </Field>
              <Field label={tr('후진 시간', 'Return time')}>
                <TimeInput value={p.strokeBack ?? p.stroke ?? 1000} onChange={(v) => v !== undefined && set({ strokeBack: v })} />
              </Field>
            </div>
          )}
          {p.type === 'cyl' && !airDriven(model, tag) && (
            <div className="grid2">
              <Field label={tr('전진 솔레노이드', 'Advance solenoid')}>
                <Select value={p.solPlus ?? ''} onChange={(v) => set({ solPlus: v })} options={[{ value: '', label: '—' }, ...solTags.map((t) => ({ value: t, label: t }))]} />
              </Field>
              <Field label={tr('후진 솔레노이드', 'Return solenoid')}>
                <Select value={p.solMinus ?? ''} onChange={(v) => set({ solMinus: v })} options={[{ value: '', label: tr('(스프링 복귀)', '(spring return)') }, ...solTags.map((t) => ({ value: t, label: t }))]} />
              </Field>
              <Field label={tr('전진 시간', 'Advance time')}>
                <TimeInput value={p.stroke ?? 1000} onChange={(v) => v !== undefined && set({ stroke: v })} />
              </Field>
              <Field label={tr('후진 시간', 'Return time')}>
                <TimeInput value={p.strokeBack ?? p.stroke ?? 1000} onChange={(v) => v !== undefined && set({ strokeBack: v })} />
              </Field>
            </div>
          )}
          <Field label={tr('사양 (부품 리스트)', 'Spec (parts list)')} wide>
            <TagInput value={p.spec ?? ''} onChange={(v) => set({ spec: v || undefined })} placeholder={row?.spec || tr('예: AC220V, 22mm', 'e.g. AC220V, 22mm')} />
          </Field>
          {(p.type === 'coil' || p.type === 'timer' || p.type === 'ol3' || def.operate || def.selfCoil) && row && (
            <p className="small muted">
              {tr('같은 기호의 접점', 'Contacts with this tag')}: <b>{contactsLabel(row) || tr('없음', 'none')}</b> {sameTag.length ? `(${tr('그림', 'drawn')} ${sameTag.length})` : ''}
            </p>
          )}
        </>
      )}
      <div className="cc-btnrow">
        <button type="button" className="btn small" onClick={rotate}>
          <Icon name="rotate" size={13} /> {tr('회전 (R)', 'Rotate (R)')}
        </button>
        <button type="button" className="btn small" onClick={remove}>
          <Icon name="trash" size={13} /> {tr('삭제', 'Delete')}
        </button>
      </div>
    </div>
  );
}

function PlcProps({ p, set, model }: { p: Part; set: (patch: Partial<Part>) => void; model: CircuitModel }) {
  const plc = useStore((s) => s.project.plc);
  const { ins, outs } = plcAddresses(p);
  return (
    <>
      <div className="grid2">
        <Field label={tr('기호', 'Tag')}>
          <TagInput value={p.tag} onChange={(v) => set({ tag: v.trim() })} />
        </Field>
        <Field label={tr('설명', 'Description')}>
          <TagInput value={p.name ?? ''} onChange={(v) => set({ name: v || undefined })} placeholder="FX3U, XGB …" />
        </Field>
        <Field label={tr('입력 첫 주소', 'First input')} hint={`${ins[0]} ~ ${ins[7]}`}>
          <TagInput value={p.inBase ?? ''} onChange={(v) => set({ inBase: v.trim() || undefined })} placeholder="X0" />
        </Field>
        <Field label={tr('출력 첫 주소', 'First output')} hint={`${outs[0]} ~ ${outs[7]}`}>
          <TagInput value={p.outBase ?? ''} onChange={(v) => set({ outBase: v.trim() || undefined })} placeholder="Y0" />
        </Field>
      </div>
      <div className="cc-btnrow">
        {(['mitsubishi', 'ls', 'siemens', 'st'] as PlcDialect[]).map((d) => (
          <button type="button" key={d} className="btn small" title={dialectName(d)} onClick={() => set({ inBase: plcBases(d).in, outBase: plcBases(d).out })}>
            {plcBases(d).in} / {plcBases(d).out}
          </button>
        ))}
      </div>
      <p className="small muted">
        {tr('입력 단자에 +24V 나 L 이 닿으면 ON. 출력은 공통 C 와 Q 사이의 릴레이 접점입니다. 프로그램은 PLC 시뮬레이션 탭의 것을 스캔마다 실행합니다.', 'An input is ON when +24V or L reaches it. Outputs are relay contacts between C and Q. The PLC tab program runs every scan.')}
      </p>
      <p className={`small ${model.prog ? 'muted' : 'cc-bad'}`}>
        {model.prog && plc
          ? tr(`프로그램: ${dialectName(plc.dialect)} · ${model.prog.size}개 명령 · 스캔 ${formatTime(plc.sim.scanTime, 'ms')}`, `Program: ${dialectName(plc.dialect)} · ${model.prog.size} instructions · scan ${formatTime(plc.sim.scanTime, 'ms')}`)
          : tr('PLC 프로그램이 없습니다.', 'No PLC program yet.')}{' '}
        <button type="button" className="linkish" onClick={() => useStore.getState().setTab('plc')}>
          {tr('PLC 탭에서 프로그램 열기', 'Open the PLC tab')}
        </button>
      </p>
    </>
  );
}

function Tips() {
  const items: [string, string][] = [
    [tr('부품 놓기', 'Place'), tr('왼쪽 목록에서 부품을 누르고 그림판을 누르세요', 'Pick a part on the left, then click the canvas')],
    [tr('선 긋기', 'Wire'), tr('부품 단자(작은 점)에서 다른 단자까지 끌면 꺾인 선이 그어집니다. 선 끝이 다른 선 중간에 닿으면 이어집니다(점 표시)', 'Drag from a terminal dot to another; a wire end on another wire joins it')],
    [tr('기호로 연동', 'Tags'), tr('코일 X1 과 접점 X1 처럼 기호가 같으면 함께 움직입니다. 타이머 T1 의 접점은 한시 접점', 'Coil X1 drives every contact tagged X1; timer contacts are timed')],
    [tr('시뮬레이션', 'Simulate'), tr('[시뮬레이션]을 누르고 버튼·스위치를 마우스로 누르세요. 전압이 닿은 선은 색으로 보입니다', 'Run, then click buttons; live wires are coloured')],
    [tr('타임차트', 'Timing chart'), tr('[조작 순서]에 누를 버튼과 시간을 적으면 아래에 타임차트가 바로 그려집니다', 'Write the operations and the chart is drawn below')],
  ];
  return (
    <div className="cc-tips">
      {items.map(([a, b]) => (
        <div key={a}>
          <b>{a}</b>
          <span>{b}</span>
        </div>
      ))}
      <p className="muted small">{tr('예제 회로(위 [예제 회로])를 열어 보면 빨리 익힐 수 있습니다.', 'Open an example circuit to learn quickly.')}</p>
    </div>
  );
}

// ───────────────────────── 조작 순서 ─────────────────────────

function OpsPane({ circuit, model, res, onChange }: { circuit: Circuit; model: CircuitModel; res: ScenarioResult | null; onChange: (c: Circuit, key?: string) => void }) {
  const ops = circuit.ops;
  const devices = model.operable().map((t) => {
    const p = model.mainPart.get(t)!;
    const name = circuit.parts.find((q) => tagKey(q) === t && q.name)?.name;
    return { value: model.label(t), label: `${model.label(t)}${name ? `  ${name}` : ''}`, momentary: PARTS[p.type].operate === 'momentary' };
  });
  const setOps = (next: OpStep[]) => onChange({ ...circuit, ops: next });
  const setOp = (i: number, patch: Partial<OpStep>) => setOps(ops.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const add = () => {
    const used = new Set(ops.map((o) => normTag(o.tag)));
    const d = devices.find((x) => !used.has(normTag(x.value))) ?? devices[0];
    setOps([...ops, { id: uid('op'), wait: ops.length ? 2000 : 500, tag: d?.value ?? '', action: d && !d.momentary ? 'on' : 'press', hold: 300 }]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ops.length) return;
    const next = [...ops];
    [next[i], next[j]] = [next[j], next[i]];
    setOps(next);
  };
  const times = res?.times ?? [];
  return (
    <div className="cc-ops">
      <p className="muted small hint">{tr('사람이 버튼을 누르는 순서와 시간입니다. 회로가 이 순서대로 움직인 결과가 타임차트가 됩니다. 메모를 적으면 차트의 공정 스텝 이름이 됩니다.', 'The operator actions in order. The circuit runs through them and the result becomes the timing chart. Notes become step names.')}</p>
      {devices.length === 0 ? (
        <p className="muted">{tr('회로에 푸시버튼·스위치가 없습니다. 먼저 그리세요.', 'No buttons or switches in the circuit yet.')}</p>
      ) : (
        <div className="cc-oplist">
          {ops.map((o, i) => {
            const known = devices.some((d) => normTag(d.value) === normTag(o.tag));
            return (
              <div className="cc-op" key={o.id}>
                <div className="cc-op-top">
                  <span className="cc-op-n">{i + 1}</span>
                  <select className={`input ${known ? '' : 'bad'}`} value={o.tag} onChange={(e) => setOp(i, { tag: e.target.value })} aria-label={tr('기기', 'Device')}>
                    {!devices.some((d) => d.value === o.tag) && <option value={o.tag}>{o.tag || '—'} ?</option>}
                    {devices.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <select className="input cc-op-act" value={o.action} onChange={(e) => setOp(i, { action: e.target.value as OpStep['action'] })} aria-label={tr('동작', 'Action')}>
                    <option value="press">{tr('누름→뗌', 'Press')}</option>
                    <option value="on">{tr('ON 유지', 'ON')}</option>
                    <option value="off">OFF</option>
                  </select>
                  <button type="button" className="mini-btn danger" onClick={() => setOps(ops.filter((_, k) => k !== i))} title={tr('삭제', 'Delete')}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
                <div className="cc-op-bot">
                  <span className="cc-op-t mono" title={tr('조작 시각', 'Time of this action')}>
                    {times[i] !== undefined ? formatTime(times[i], 's') : ''}
                  </span>
                  <label title={tr('앞 줄 조작에서 기다리는 시간', 'Wait after the previous action')}>
                    {tr('대기', 'Wait')} <TimeInput value={o.wait} onChange={(v) => v !== undefined && setOp(i, { wait: v })} />
                  </label>
                  {o.action === 'press' && (
                    <label title={tr('누르고 있는 시간', 'How long it is held')}>
                      {tr('누름', 'Hold')} <TimeInput value={o.hold} onChange={(v) => v !== undefined && setOp(i, { hold: v })} />
                    </label>
                  )}
                  <TagInput value={o.note ?? ''} onChange={(v) => setOp(i, { note: v || undefined })} placeholder={tr('메모 (스텝 이름)', 'Note (step)')} />
                  <span className="cc-row-btns">
                    <button type="button" className="mini-btn" onClick={() => move(i, -1)} disabled={i === 0} title={tr('위로', 'Up')}>
                      <Icon name="up" size={12} />
                    </button>
                    <button type="button" className="mini-btn" onClick={() => move(i, 1)} disabled={i === ops.length - 1} title={tr('아래로', 'Down')}>
                      <Icon name="down" size={12} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="cc-btnrow">
        <button type="button" className="btn small" onClick={add} disabled={!devices.length}>
          <Icon name="plus" size={13} /> {tr('조작 추가', 'Add action')}
        </button>
        {ops.length > 0 && (
          <button type="button" className="btn small" onClick={() => setOps([])}>
            {tr('모두 지우기', 'Clear')}
          </button>
        )}
      </div>
      <p className="muted small">{tr('또는 [시뮬레이션]에서 버튼을 직접 눌러 본 뒤 [정지]하면 누른 순서·시간이 그대로 여기에 저장됩니다.', 'Or press buttons in the simulation; when you stop, the actions can be saved here.')}</p>
      <div className="grid2">
        <Field label={tr('시뮬레이션 시간', 'Duration')} hint={tr('비우면 마지막 변화에 맞춤', 'Empty = fit to last change')}>
          <TimeInput value={circuit.duration} allowEmpty placeholder={tr('자동', 'auto')} onChange={(v) => onChange({ ...circuit, duration: v && v > 0 ? v : undefined })} />
        </Field>
      </div>
      {res && res.warnings.length > 0 && (
        <div className="msgs">
          {res.warnings.map((w, i) => (
            <div key={i} className="msg warning">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 부품 리스트 · 검사 ─────────────────────────

function BomPane({ circuit, title }: { circuit: Circuit; title: string }) {
  const rows = useMemo(() => partsList(circuit), [circuit]);
  const sum = useMemo(() => bomSummary(rows), [rows]);
  if (!rows.length) return <p className="muted">{tr('회로에 부품이 없습니다.', 'No parts yet.')}</p>;
  return (
    <div className="cc-bom">
      <p className="muted small hint">{tr('회로도에서 자동으로 만든 목록입니다. 사양은 부품 속성에서 고칠 수 있고, 보고서에도 인쇄됩니다.', 'Built from the drawing. Edit specs in part properties; printed in the report too.')}</p>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>{tr('기호', 'Tag')}</th>
            <th>{tr('품명', 'Item')}</th>
            <th>{tr('설명', 'Desc.')}</th>
            <th>{tr('사양', 'Spec')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.tag}-${i}`}>
              <td className="mono">
                <b>{r.tag || '—'}</b>
              </td>
              <td>{r.kind}</td>
              <td>{r.name}</td>
              <td className="small">{r.spec}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{tr('수량 집계', 'Quantities')}</h4>
      <table className="tbl compact">
        <thead>
          <tr>
            <th>{tr('품명', 'Item')}</th>
            <th>{tr('사양', 'Spec')}</th>
            <th>{tr('수량', 'Qty')}</th>
          </tr>
        </thead>
        <tbody>
          {sum.map((s, i) => (
            <tr key={i} title={s.tags.join(', ')}>
              <td>{s.kind}</td>
              <td className="small">{s.spec}</td>
              <td className="num">{s.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!WEB_TRIAL && (
        <button type="button" className="btn small" onClick={() => downloadText(`${safeFileName(title || 'circuit')}_${tr('부품리스트', 'parts')}.csv`, bomCsv(circuit), 'text/csv;charset=utf-8')}>
          <Icon name="download" size={13} /> {tr('엑셀 CSV 저장', 'Save Excel CSV')}
        </button>
      )}
    </div>
  );
}

function wireHighlight(r: WiringRow | undefined) {
  return r ? { segs: r.segs, pts: [r.from.at, r.to.at] } : null;
}

/** 결선표: 단자 → 단자 전선 한 가닥씩, 누르면 그림에서 강조, 배선을 마치면 체크 */
function WiringPane({ rows, done, title, pick, onPick, onDone }: { rows: WiringRow[]; done: string[]; title: string; pick: string | null; onPick: (key: string | null) => void; onDone: (wired: string[]) => void }) {
  const doneSet = new Set(done);
  if (!rows.length) return <p className="muted">{tr('선으로 이어진 단자가 없습니다.', 'No wired terminals yet.')}</p>;
  const n = rows.filter((r) => doneSet.has(r.key)).length;
  const toggle = (key: string, on: boolean) => onDone(on ? [...done.filter((k) => k !== key), key] : done.filter((k) => k !== key));
  return (
    <div className="cc-wiring">
      <p className="muted small hint">
        {tr(
          '회로도의 선을 실제 전선 한 가닥씩 (단자 → 단자) 풀어 쓴 표입니다. 줄을 누르면 그림에서 그 전선이 강조됩니다. 배선을 마친 줄은 체크하세요. 선번호가 같으면 같은 전위 (마크 튜브 번호로 쓰면 됩니다).',
          'Each row is one real wire from terminal to terminal. Click a row to highlight it; tick it when wired. Same wire number = same potential.',
        )}
      </p>
      <div className="cc-wiring-head">
        <div className="cc-wiring-bar" aria-hidden>
          <i style={{ width: `${(100 * n) / rows.length}%` }} />
        </div>
        <span className="small">
          {tr('완료', 'Done')} <b>{n}</b> / {rows.length}
        </span>
        {n > 0 && (
          <button type="button" className="btn small ghost" onClick={() => onDone([])}>
            {tr('체크 지우기', 'Clear ticks')}
          </button>
        )}
      </div>
      <table className="tbl compact cc-wiring-tbl">
        <thead>
          <tr>
            <th aria-label={tr('완료', 'Done')}>✓</th>
            <th title={tr('선번호 (같은 전위)', 'Wire number')}>{tr('번호', 'No.')}</th>
            <th>{tr('출발', 'From')}</th>
            <th>{tr('도착', 'To')}</th>
            <th>{tr('색', 'Colour')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={`${pick === r.key ? 'on' : ''} ${doneSet.has(r.key) ? 'done' : ''} ${i > 0 && rows[i - 1].no !== r.no ? 'grp' : ''}`} onClick={() => onPick(pick === r.key ? null : r.key)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={doneSet.has(r.key)} onChange={(e) => toggle(r.key, e.target.checked)} aria-label={tr('배선 완료', 'Wired')} />
              </td>
              <td className="num mono">{r.no}</td>
              <td className="mono">
                <b>{r.from.dev}</b> {r.from.label}
              </td>
              <td className="mono">
                <b>{r.to.dev}</b> {r.to.label}
              </td>
              <td className="small">
                {r.color && <span className="cc-wsw" style={{ background: WIRE_HEX[r.color] }} />} {wireColorName(r.color)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!WEB_TRIAL && (
        <button type="button" className="btn small" onClick={() => downloadText(`${safeFileName(title || 'circuit')}_${tr('결선표', 'wiring')}.csv`, wiringCsv(rows, doneSet), 'text/csv;charset=utf-8')}>
          <Icon name="download" size={13} /> {tr('엑셀 CSV 저장', 'Save Excel CSV')}
        </button>
      )}
    </div>
  );
}

function CheckPane({ issues, onPick }: { issues: CircuitIssue[]; onPick: (ids: string[]) => void }) {
  if (!issues.length) return <p className="cc-ok">{tr('문제가 없습니다.', 'No problems found.')}</p>;
  return (
    <div className="msgs cc-check">
      {issues.map((i, k) => (
        <button type="button" key={k} className={`msg ${i.level === 'error' ? 'error' : 'warning'}`} onClick={() => i.partIds.length && onPick(i.partIds)}>
          {i.msg}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── 차트 미리보기 ─────────────────────────

function PreviewChart({ project }: { project: Project | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(420, el.clientWidth - 4)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="cc-preview-body" ref={ref}>
      {project && project.signals.length ? (
        <ChartSvg project={{ ...project, settings: { ...project.settings, rowHeight: 26, showLevelLabels: false } }} width={w} idp="ccpv" colors={SCREEN_COLORS} showSteps />
      ) : (
        <p className="muted small">{tr('회로를 그리면 여기에 타임차트가 나타납니다.', 'Draw a circuit and its timing chart appears here.')}</p>
      )}
    </div>
  );
}
