import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Project } from '../model/types';
import { emptyCircuit, type CableMethod, type CableSpec, type Circuit, type LampColor, type OpStep, type Part, type PartType, type Pole, type Wire, type WireColor } from '../circuit/types';
import { partGuide } from '../circuit/guide';
import { analyzePower, breakerAmps, cableIz, cableMethods, cableSizes, cableZ, groupFactor, isBreaker, loadRating, nominalVolt, PowerModel, tableIz, tempFactor, type PowerAnalysis, type PowerState } from '../circuit/power';
import { wireChain } from '../circuit/wires';
import { DEFAULT_SCHED, FOLLOWER, LAMP_PREFIX, lampColorName, nextTag, palette, PARTS, partBox, partKindName, tswSched, plcAddresses, plcBases, VALVES, type PaletteItem } from '../circuit/parts';
import type { PlcDialect } from '../plc/types';
import { dialectName } from '../plc/program';
import { airDriven, CircuitModel, CircuitSim, normTag, runScenario, tagKey, type OpEvent, type ScenarioResult } from '../circuit/engine';
import { applyCircuit, autoChartOn, circuitStatus, circuitToProject } from '../circuit/chart';
import { bomCsv, bomSummary, checkCircuit, contactsLabel, partsList, type CircuitIssue } from '../circuit/bom';
import { CircuitCanvas, NO_SEL, type Sel } from './CircuitCanvas';
import { CIRCUIT_DARK, CIRCUIT_LIGHT, PartGlyph, partState, type CircuitColors } from '../render/CircuitSvg';
import { ChartSvg } from '../render/ChartSvg';
import { SCREEN_COLORS } from '../render/layout';
import { formatClock, formatTime, HOUR, MINUTE, parseClock } from '../model/format';
import { uid } from '../model/wave';
import { downloadText, safeFileName } from '../io/files';
import { niceCeil } from '../plc/simulator';
import { askConfirm, askText, Check, Field, Icon, IconButton, Menu, NumberInput, Select, TimeInput } from './ui';
import * as F from './fileActions';
import { circuitExamples } from '../circuit/examples';
import { tr } from '../i18n';
import { WEB_TRIAL } from '../env';
import { WIRE_HEX } from '../render/RealSymbols';
import { termText, wireColorName, wireNoLabels, wiringCsv, wiringList, type WiringRow } from '../circuit/wiring';
import { storageGet, storageSet } from '../storage';

const EMPTY = emptyCircuit();
let lastZoom = 1;
let clip: { parts: Part[]; wires: Wire[] } | null = null;
let pasteCount = 0;

type Side = 'props' | 'ops' | 'bom' | 'wiring' | 'power' | 'check';

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
  // 결선표: 그림에 선번호 적기, 따라 배선하기 (마친 전선만 진하게)
  const [wireNosOn, setWireNosOn] = useState(false);
  const [wireGuide, setWireGuide] = useState(false);
  const wireNos = useMemo(() => (wireNosOn ? wireNoLabels(wiring) : undefined), [wireNosOn, wiring]);
  const wireProgress = useMemo(() => {
    if (!wireGuide || side !== 'wiring') return null;
    const done = new Set(circuit.wired ?? []);
    return wiring.filter((r) => done.has(r.key) || r.key === wirePick).map((r) => ({ segs: r.segs, color: r.color }));
  }, [wireGuide, side, wiring, circuit.wired, wirePick]);
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
    // 타임 스위치가 있으면 빨리 감기로 시작 (1초에 1시간, 하루가 24초)
    runRef.current = { sim, base: performance.now(), startT: 0, speed: model.tswDef.size ? 3600 : 1, actions: [] };
    setPlacing(null);
    setSel(NO_SEL);
    setRunning(true);
    const errs = issues.filter((i) => i.level === 'error').length;
    const hint = model.tswDef.size ? tr('시뮬레이션 시작: 1초에 1시간씩 흐릅니다 (속도는 위에서 바꿉니다)', 'Simulation running at 1 hour per second') : tr('시뮬레이션 시작: 버튼·스위치를 눌러 보세요', 'Simulation running: click buttons and switches');
    toast(errs ? tr(`시뮬레이션 시작 (검사 문제 ${errs}개)`, `Simulation started (${errs} issues)`) : hint, errs ? 'warn' : 'ok');
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
  // 전기 해석: 조작 순서 전체에서 가장 나쁜 값 (허용전류 · 전압강하 · 차단기), 시뮬레이션 중에는 그 순간의 전류
  const powerModel = useMemo(() => new PowerModel(circuit, model), [circuit, model]);
  // 케이블 규격이 하나도 없고 [해석] 탭도 닫혀 있으면 계산하지 않는다 (PLC 회로처럼 시뮬레이션이 긴 회로를 끌 때 버벅이지 않게)
  const needPower = side === 'power' || circuit.wires.some((w) => w.cable);
  const analysis = useMemo(() => (needPower ? analyzePower(circuit, model) : NO_ANALYSIS), [needPower, circuit, model]);
  const powerErrs = analysis.issues.filter((i) => i.level === 'error').length;
  const liveRef = useRef<{ pm: PowerModel; sig: string; st: PowerState } | null>(null);
  let livePower: PowerState | null = null;
  if (running && runRef.current && powerModel.loads.length) {
    const sim = runRef.current.sim;
    const sig = powerModel.signature(sim) + (sim.shorted ? '!' : '');
    if (!liveRef.current || liveRef.current.pm !== powerModel || liveRef.current.sig !== sig) liveRef.current = { pm: powerModel, sig, st: powerModel.solve(sim) };
    livePower = liveRef.current.st.shorted ? null : liveRef.current.st;
  }
  const liveCurrents = useMemo(() => {
    if (!livePower) return undefined;
    const out: { at: [number, number]; text: string; bad?: boolean }[] = [];
    for (const cb of powerModel.cables) {
      const ws = circuit.wires.filter((w) => cb.wires.includes(w.id));
      const i = Math.max(0, ...ws.map((w) => livePower!.wireI.get(w.id) ?? 0));
      if (i < 0.05 || !ws.length) continue;
      const long = [...ws].sort((a, b) => Math.abs(b.a[0] - b.b[0]) + Math.abs(b.a[1] - b.b[1]) - (Math.abs(a.a[0] - a.b[0]) + Math.abs(a.a[1] - a.b[1])))[0];
      const iz = cableIz(cb.spec);
      out.push({ at: [(long.a[0] + long.b[0]) / 2, (long.a[1] + long.b[1]) / 2], text: `${i.toFixed(1)} A`, bad: iz !== null && i > iz });
    }
    return out;
  }, [livePower, powerModel, circuit.wires]);
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
              {[0, 0.25, 0.5, 1, 2, 4, ...(model.tswDef.size || (r?.speed ?? 1) > 4 ? [60, 600, 3600] : [])].map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? tr('일시정지', 'Pause') : s === 60 ? tr('×60 (1초에 1분)', '×60 (1 min/s)') : s === 600 ? tr('×600 (1초에 10분)', '×600 (10 min/s)') : s === 3600 ? tr('×3600 (1초에 1시간)', '×3600 (1 h/s)') : `×${s}`}
                </option>
              ))}
            </select>
            {model.tswDef.size > 0 && r ? (
              <span className="cc-clock">
                {tr('시각', 'Clock')} <b>{formatClock(r.sim.clock)}</b>
                {r.sim.t >= 24 * HOUR ? ` (+${Math.floor((r.sim.clock0 + r.sim.t) / (24 * HOUR))}${tr('일', 'd')})` : ''}
              </span>
            ) : (
              <span className="cc-clock">t = {formatTime(r?.sim.t ?? 0, 's')}</span>
            )}
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
        <Palette c={colors} placing={placing} disabled={running} onPick={(it) => (setPlacing(placing?.key === it.key ? null : it), setTool('select'), setSel(NO_SEL), setSide('props'))} />
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
          wireNos={side === 'wiring' ? wireNos : undefined}
          progress={wireProgress}
          power={livePower}
          currents={liveCurrents}
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
            <button type="button" className={side === 'power' ? 'on' : ''} onClick={() => setSide('power')} title={tr('전류 · 허용전류 · 전압강하 · 차단기 검토', 'Currents, ampacity, voltage drop, breakers')}>
              {tr('해석', 'Analysis')} {analysis.issues.filter((i) => i.level !== 'info').length ? <b className={powerErrs ? 'bad' : ''}>{analysis.issues.filter((i) => i.level !== 'info').length}</b> : null}
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
                placing={placing}
                update={updatePart}
                remove={deleteSel}
                rotate={rotateSel}
                setWireColor={(color) => {
                  const ws = new Set(sel.wires);
                  commitCircuit({ ...circuit, wires: circuit.wires.map((w) => (ws.has(w.id) ? (color ? { ...w, color } : { id: w.id, a: w.a, b: w.b, ...(w.cable ? { cable: w.cable } : {}) }) : w)) });
                }}
                setWireCable={(cable) => {
                  // 꺾여 이어진 한 가닥 전체에 같은 규격
                  const ws = new Set(wireChain(circuit, sel.wires));
                  commitCircuit({ ...circuit, wires: circuit.wires.map((w) => (ws.has(w.id) ? { id: w.id, a: w.a, b: w.b, ...(w.color ? { color: w.color } : {}), ...(cable ? { cable } : {}) } : w)) }, `cable:${sel.wires.join()}`, false);
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
                nosOn={wireNosOn}
                setNosOn={setWireNosOn}
                guide={wireGuide}
                setGuide={setWireGuide}
                onDone={(wired) => commitCircuit(wired.length ? { ...circuit, wired } : { ...circuit, wired: undefined }, 'wired', false)}
              />
            )}
            {side === 'power' && <PowerPane circuit={circuit} a={analysis} onChange={(c) => commitCircuit(c, 'power-sys', false)} onPick={(parts, wires) => setSel({ parts, wires })} title={project.meta.title} />}
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
              {model.tswDef.size
                ? tr(`타임 스위치: 하루 ${formatTime(preview.res.end, 'h')} 시뮬레이션 · 조작 ${circuit.ops.length}단계`, `Time switch: ${formatTime(preview.res.end, 'h')} simulated · ${circuit.ops.length} operations`)
                : circuit.ops.length ? tr(`조작 ${circuit.ops.length}단계 · 마지막 변화 ${longTime(preview.res.lastChange)}`, `${circuit.ops.length} operations · last change ${longTime(preview.res.lastChange)}`) : tr('조작 순서가 없습니다: [조작 순서]에 적거나, 시뮬레이션에서 눌러 본 뒤 저장하세요', 'No operations yet: add them, or record them in the simulation')}
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

function MiniGlyph({ item, c, size = 30 }: { item: PaletteItem; c: CircuitColors; size?: number }) {
  const p = makePart(emptyCircuit(), item, 0, 0, 'mini');
  const [x0, y0, x1, y1] = partBox(p);
  const w = Math.max((x1 - x0) * 20, 20);
  const h = Math.max((y1 - y0) * 20, 20);
  const model = useMemo(() => new CircuitModel(emptyCircuit()), []);
  return (
    <svg width={size} height={size} viewBox={`${x0 * 20 - 4} ${y0 * 20 - 4} ${w + 8} ${h + 8}`} aria-hidden="true">
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
      <div className="cc-pal-sticky">
      <div className="seg cc-pal-mode" role="radiogroup">
        <button type="button" role="radio" aria-checked={mode === 'real'} className={mode === 'real' ? 'on' : ''} onClick={() => pick('real')} title={tr('실제 기기 모양과 단자 번호로 배선 (실체 배선도)', 'Real devices with terminal numbers (wiring diagram)')}>
          {tr('실물 배선', 'Wiring')}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'symbol'} className={mode === 'symbol' ? 'on' : ''} onClick={() => pick('symbol')} title={tr('전기 기호로 그리는 시퀀스도 (전개 접속도)', 'Schematic symbols (ladder style)')}>
          {tr('회로 기호', 'Symbols')}
        </button>
      </div>
      </div>
      {palette()
        .filter((g) => !g.mode || g.mode === mode)
        .map((g) => (
        <div key={g.title} className="cc-pal-group">
          <div className="cc-pal-title">{g.title}</div>
          {g.items.map((it) => (
            <button type="button" key={it.key} className={`cc-pal-item ${placing?.key === it.key ? 'on' : ''}`} onClick={() => onPick(it)} disabled={disabled} title={`${partKindName(it.type)}\n${partGuide(it.type)?.what ?? ''}`.trim()}>
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

function PropsPane({
  circuit,
  model,
  sel,
  part: p,
  colors,
  placing,
  update,
  remove,
  rotate,
  setWireColor,
  setWireCable,
}: {
  circuit: Circuit;
  model: CircuitModel;
  sel: Sel;
  part: Part | null;
  colors: CircuitColors;
  placing: PaletteItem | null;
  update: (id: string, patch: Partial<Part>) => void;
  remove: () => void;
  rotate: () => void;
  setWireColor: (c: WireColor | undefined) => void;
  setWireCable: (c: CableSpec | undefined) => void;
}) {
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
          {sel.wires.length > 0 && <CableEditor circuit={circuit} ids={sel.wires} onChange={setWireCable} />}
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
    // 놓으려고 고른 부품: 무엇이고 어떻게 잇는지 먼저 보여 준다
    if (placing)
      return (
        <div className="cc-props">
          <div className="cc-props-head">
            <MiniGlyph item={placing} c={colors} size={34} />
            <div>
              <b>{placing.label}</b>
              <div className="muted small">{tr('그림판을 누르면 놓입니다 (Esc: 취소)', 'Click the canvas to place it (Esc to cancel)')}</div>
            </div>
          </div>
          <GuideCard type={placing.type} />
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
          {p.type === 'r_tsw' && <SchedEditor p={p} set={set} />}
          <RatingFields p={p} set={set} circuit={circuit} />
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
      <GuideCard type={p.type} />
    </div>
  );
}

const GUIDE_KEY = 'timechart-studio.circuit-guide.v1';

/** 부품 쓰는 법: 무엇인지 · 단자 · 잇는 순서 · 예제 (접어 둘 수 있고, 접은 상태를 기억) */
function GuideCard({ type }: { type: PartType }) {
  const guide = partGuide(type);
  const [open, setOpen] = useState(() => storageGet(GUIDE_KEY) !== '0');
  if (!guide) return null;
  return (
    <details
      className="cc-guide"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        if (o === open) return;
        setOpen(o);
        storageSet(GUIDE_KEY, o ? '1' : '0');
      }}
    >
      <summary>
        <Icon name="help" size={14} /> {tr('이 부품 쓰는 법', 'How to use this part')}
      </summary>
      <p>{guide.what}</p>
      <div className="cc-guide-h">{tr('단자', 'Terminals')}</div>
      <table className="cc-guide-pins">
        <tbody>
          {guide.pins.map(([a, b]) => (
            <tr key={a}>
              <th>{a}</th>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cc-guide-h">{tr('잇는 순서', 'How to wire it')}</div>
      <ol>
        {guide.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="cc-guide-sim">
        <Icon name="play" size={12} /> {guide.sim}
      </p>
      {guide.example && (
        <button type="button" className="btn small" onClick={() => F.openCircuitExample(guide.example!)} title={tr('새 차트 탭으로 열립니다 (지금 그림은 그대로)', 'Opens as a new chart tab')}>
          <Icon name="circuit" size={13} /> {tr('이 부품을 쓴 예제 열기', 'Open an example using it')}
        </button>
      )}
    </details>
  );
}

const NO_ANALYSIS: PowerAnalysis = { shorted: false, cables: [], loads: [], breakers: [], issues: [], supply: [], peakKw: 0, panels: [], wireI: new Map(), vll: 220 * Math.sqrt(3), vln: 220 };

const METHOD_LABEL: Record<CableMethod, [string, string]> = {
  A1: ['A1 단열벽 속 전선관 (절연전선)', 'A1 conduit in insulated wall (wires)'],
  A2: ['A2 단열벽 속 전선관 (다심 케이블)', 'A2 conduit in insulated wall (cable)'],
  B1: ['B1 전선관 · 덕트 (절연전선)', 'B1 conduit / trunking (wires)'],
  B2: ['B2 전선관 · 덕트 (다심 케이블)', 'B2 conduit / trunking (cable)'],
  C: ['C 벽면 노출 배선', 'C clipped direct'],
  D1: ['D1 지중 전선관', 'D1 buried duct'],
  D2: ['D2 지중 직매', 'D2 direct buried'],
  E: ['E 케이블 트레이 (다심)', 'E tray, multi-core'],
  F: ['F 케이블 트레이 (단심)', 'F tray, single-core'],
};

/** 전선 · 케이블 규격: 절연, 굵기, 공사방법, 길이 → 허용전류와 저항. 꺾여 이어진 한 가닥 전체에 적용된다 */
function CableEditor({ circuit, ids, onChange }: { circuit: Circuit; ids: string[]; onChange: (c: CableSpec | undefined) => void }) {
  const cur = circuit.wires.find((w) => ids.includes(w.id) && w.cable)?.cable;
  const three = circuit.parts.some((p) => p.type === 'src3' || ((p.type === 'src' || p.type === 'r_term') && (p.pole === 'L2' || p.pole === 'L3')));
  const kind = !cur ? 'none' : cur.kind === 'bus' ? 'bus' : 'cable';
  const base: CableSpec = cur ?? { ins: 'xlpe', mm2: 2.5, method: 'B1', cores: three ? 3 : 2, len: 10 };
  const set = (patch: Partial<CableSpec>) => {
    const next: CableSpec = { ...base, ...patch };
    if (next.kind !== 'bus') {
      delete next.kind;
      delete next.iz;
      if (!cableMethods(next.ins).includes(next.method)) next.method = 'B1';
      const sizes = cableSizes(next.ins, next.cores, next.method);
      if (!sizes.includes(next.mm2)) next.mm2 = sizes.find((s) => s >= next.mm2) ?? sizes[sizes.length - 1];
    }
    onChange(next);
  };
  const iz = cur ? cableIz(cur) : null;
  const [r, x] = cur ? cableZ(cur) : [0, 0];
  return (
    <div className="cc-cable">
      <Field label={tr('케이블 규격 (해석용)', 'Cable spec (for analysis)')} wide>
        <Select
          value={kind}
          onChange={(v) => (v === 'none' ? onChange(undefined) : v === 'bus' ? onChange({ kind: 'bus', ins: 'xlpe', mm2: cur?.kind === 'bus' ? cur.mm2 : 60, method: 'C', cores: 3, len: cur?.len ?? 1, ...(cur?.iz ? { iz: cur.iz } : {}) }) : set({ kind: undefined }))}
          options={[
            { value: 'none', label: tr('정하지 않음 (저항 없는 선)', 'None (ideal wire)') },
            { value: 'cable', label: tr('전선 · 케이블', 'Wire / cable') },
            { value: 'bus', label: tr('부스바 (구리)', 'Busbar (copper)') },
          ]}
        />
      </Field>
      {cur && kind === 'cable' && (
        <>
          <div className="grid2">
            <Field label={tr('절연', 'Insulation')}>
              <Select value={cur.ins} onChange={(v) => set({ ins: v })} options={[{ value: 'xlpe', label: tr('XLPE · EPR 90℃ (HFIX · CV · FR-8)', 'XLPE / EPR 90°C') }, { value: 'pvc', label: tr('PVC 70℃ (IV · VV)', 'PVC 70°C') }]} />
            </Field>
            <Field label={tr('부하 도체 수', 'Loaded conductors')}>
              <Select value={String(cur.cores) as '2' | '3'} onChange={(v) => set({ cores: v === '2' ? 2 : 3 })} options={[{ value: '3', label: tr('3 (3상)', '3 (3-phase)') }, { value: '2', label: tr('2 (단상 · 직류)', '2 (1-phase / DC)') }]} />
            </Field>
          </div>
          <Field label={tr('공사방법', 'Installation method')} wide>
            <Select value={cur.method} onChange={(v) => set({ method: v })} options={cableMethods(cur.ins).map((m) => ({ value: m, label: tr(...METHOD_LABEL[m]) }))} />
          </Field>
          <div className="grid2">
            <Field label={tr('굵기 (mm²)', 'Size (mm²)')}>
              <Select value={String(cur.mm2)} onChange={(v) => set({ mm2: Number(v) })} options={cableSizes(cur.ins, cur.cores, cur.method).map((s) => ({ value: String(s), label: `${s} mm²` }))} />
            </Field>
            <Field label={tr('길이 (m)', 'Length (m)')} hint={tr('꺾여 이어진 한 가닥 전체', 'Whole run')}>
              <NumberInput value={cur.len} min={0} step={1} onChange={(v) => set({ len: Math.max(0, v ?? 0) })} />
            </Field>
            <Field label={tr('주위 온도 (℃)', 'Ambient (°C)')}>
              <NumberInput value={cur.amb ?? (cur.method === 'E' || cur.method === 'F' ? 40 : 30)} min={10} max={65} step={5} onChange={(v) => set({ amb: v ?? undefined })} />
            </Field>
            <Field label={tr('함께 지나는 회로 수', 'Grouped circuits')}>
              <NumberInput value={cur.group ?? 1} min={1} max={20} step={1} onChange={(v) => set({ group: v && v > 1 ? Math.round(v) : undefined })} />
            </Field>
          </div>
          <p className="small">
            {iz === null ? (
              <span className="cc-bad">{tr('허용전류 표에 없는 조합입니다', 'Not in the ampacity table')}</span>
            ) : (
              <>
                {tr('허용전류', 'Ampacity')} <b>Iz = {iz} A</b>{' '}
                <span className="muted">
                  ({tr('표', 'table')} {tableIz(cur)} A × {tr('온도', 'temp')} {Math.round(tempFactor(cur) * 100) / 100} × {tr('복수회로', 'group')} {groupFactor(cur)})
                </span>
              </>
            )}
            <br />
            <span className="muted">
              {tr('한 가닥', 'Per conductor')} R = {r.toFixed(3)} Ω, X = {x.toFixed(4)} Ω
            </span>
          </p>
        </>
      )}
      {cur && kind === 'bus' && (
        <>
          <div className="grid2">
            <Field label={tr('단면적 (mm²)', 'Section (mm²)')} hint={tr('예: 20 × 3 = 60', 'e.g. 20 × 3 = 60')}>
              <NumberInput value={cur.mm2} min={1} step={1} onChange={(v) => onChange({ ...cur, mm2: Math.max(1, v ?? 60) })} />
            </Field>
            <Field label={tr('길이 (m)', 'Length (m)')}>
              <NumberInput value={cur.len} min={0} step={0.1} onChange={(v) => onChange({ ...cur, len: Math.max(0, v ?? 0) })} />
            </Field>
          </div>
          <Field label={tr('허용전류 (A)', 'Ampacity (A)')} wide hint={tr('부스바는 크기 · 배치에 따라 달라서 제조사 표의 값을 적습니다', 'Enter the value from the manufacturer table')}>
            <NumberInput value={cur.iz} min={1} step={1} onChange={(v) => onChange({ ...cur, iz: v && v > 0 ? v : undefined })} />
          </Field>
        </>
      )}
      <p className="small muted">
        {tr(
          '규격을 정하면 [해석] 탭에서 이 선의 전류가 허용전류를 넘는지, 부하까지 전압강하가 얼마인지 검토합니다. 3상은 세 가닥을 함께 고르고 (Shift+클릭) 같은 값을 주세요.',
          'With a spec, the Analysis tab checks this wire against its ampacity and computes the voltage drop. For 3-phase select all three wires (Shift+click).',
        )}
      </p>
    </div>
  );
}

/** 해석에 쓰는 정격: 부하 용량 · 역률, 차단기 정격 전류, 분전반 크기 */
function RatingFields({ p, set, circuit }: { p: Part; set: (patch: Partial<Part>) => void; circuit: Circuit }) {
  const big = p.type === 'r_load1' || p.type === 'r_load3' || p.type === 'r_motor3' || p.type === 'motor3' || p.type === 'motor';
  const motor = p.type === 'r_motor3' || p.type === 'motor3' || p.type === 'motor';
  const three = p.type === 'r_load3' || p.type === 'r_motor3' || p.type === 'motor3';
  const r = loadRating(p);
  if (p.type === 'r_panel')
    return (
      <div className="grid2">
        <Field label={tr('가로 (칸)', 'Width (cells)')}>
          <NumberInput value={p.w ?? 20} min={4} max={400} step={1} onChange={(v) => set({ w: Math.max(4, Math.round(v ?? 20)) })} />
        </Field>
        <Field label={tr('세로 (칸)', 'Height (cells)')}>
          <NumberInput value={p.h ?? 20} min={4} max={400} step={1} onChange={(v) => set({ h: Math.max(4, Math.round(v ?? 20)) })} />
        </Field>
      </div>
    );
  if (isBreaker(p))
    return (
      <Field label={tr('정격 전류 (A)', 'Rated current (A)')} wide hint={tr('[해석] 탭에서 흐르는 전류와 전선 허용전류를 이 값과 비교합니다', 'Compared with the current and the cable ampacity in the Analysis tab')}>
        <NumberInput value={breakerAmps(p) ?? undefined} min={1} step={1} onChange={(v) => set({ amps: v && v > 0 ? v : undefined })} />
      </Field>
    );
  if (!big && p.type !== 'r_light') return null;
  const vll = circuit.vll && circuit.vll > 0 ? circuit.vll : 220 * Math.sqrt(3);
  const volt = p.volt ?? (three ? vll : vll / Math.sqrt(3));
  const amps = r ? (three ? r.va / (Math.sqrt(3) * volt) : r.va / volt) : 0;
  return (
    <>
      <div className="grid2">
        {big ? (
          <Field label={motor ? tr('정격 출력 (kW)', 'Rated output (kW)') : tr('용량 (kW)', 'Power (kW)')}>
            <NumberInput value={r ? r.out / 1000 : 0} min={0} step={0.1} onChange={(v) => set({ watt: Math.max(0, (v ?? 0) * 1000) })} />
          </Field>
        ) : (
          <Field label={tr('소비 전력 (W)', 'Power (W)')}>
            <NumberInput value={r?.out ?? 100} min={0} step={10} onChange={(v) => set({ watt: Math.max(0, v ?? 0) })} />
          </Field>
        )}
        {big && (
          <Field label={tr('역률', 'Power factor')}>
            <NumberInput value={r?.pf ?? 1} min={0.05} max={1} step={0.01} onChange={(v) => set({ pf: v && v > 0 ? Math.min(1, v) : undefined })} />
          </Field>
        )}
        {motor && (
          <Field label={tr('효율', 'Efficiency')}>
            <NumberInput value={p.eff ?? 0.88} min={0.05} max={1} step={0.01} onChange={(v) => set({ eff: v && v > 0 ? Math.min(1, v) : undefined })} />
          </Field>
        )}
      </div>
      {(p.type === 'r_load1' || p.type === 'r_load3') && <Check checked={!!p.lighting} onChange={(v) => set({ lighting: v || undefined })} label={tr('조명 부하 (전압강하 허용값이 더 작다)', 'Lighting load (stricter voltage drop)')} />}
      <p className="small muted">
        {tr('정격 전류', 'Rated current')} <b>{amps.toFixed(1)} A</b> ({three ? tr('3상', '3-ph') : tr('단상', '1-ph')} {nominalVolt(volt)} V{motor ? tr(', 기동 전류는 계산하지 않습니다', '; starting current is not modelled') : ''})
      </p>
    </>
  );
}

/** 긴 시간은 시 · 분으로 */
function longTime(ms: number): string {
  return formatTime(ms, ms >= HOUR ? 'h' : ms >= 10 * MINUTE && ms % MINUTE === 0 ? 'min' : 's');
}

/** 타임 스위치 설정: 켜지는 구간 (다이얼의 세그먼트처럼 15분 단위) */
function SchedEditor({ p, set }: { p: Part; set: (patch: Partial<Part>) => void }) {
  const sched = tswSched(p);
  const snap = (ms: number) => (Math.round(ms / (15 * MINUTE)) * 15 * MINUTE) % (24 * HOUR);
  const change = (i: number, k: 0 | 1, v: string) => {
    const t = parseClock(v);
    if (t === null) return;
    set({ sched: sched.map((r, j) => (j === i ? ((k === 0 ? [snap(t), r[1]] : [r[0], snap(t)]) as [number, number]) : r)) });
  };
  const total = sched.reduce((n, [a, b]) => n + (a === b ? 0 : (b - a + 24 * HOUR) % (24 * HOUR)), 0);
  return (
    <div className="cc-sched">
      <div className="cc-sched-head">
        <b>{tr('켜지는 시간 (ON 구간)', 'ON periods')}</b>
        <span className="muted small">{tr(`하루 ${formatTime(total, 'h')} 켜짐`, `${formatTime(total, 'h')} on per day`)}</span>
      </div>
      {sched.map(([a, b], i) => (
        <div key={i} className="cc-sched-row">
          <input type="time" className="input" step={900} value={formatClock(a)} onChange={(e) => change(i, 0, e.target.value)} aria-label={tr('켜짐 시각', 'On time')} />
          <span className="muted">{tr('켜짐 →', 'on →')}</span>
          <input type="time" className="input" step={900} value={formatClock(b)} onChange={(e) => change(i, 1, e.target.value)} aria-label={tr('꺼짐 시각', 'Off time')} />
          <span className="muted">{tr('꺼짐', 'off')}</span>
          <IconButton icon="trash" title={tr('이 구간 지우기', 'Remove')} onClick={() => set({ sched: sched.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <div className="cc-btnrow">
        <button type="button" className="btn small" onClick={() => set({ sched: [...sched, sched.length ? ([6 * HOUR, 8 * HOUR] as [number, number]) : DEFAULT_SCHED[0]] })} disabled={sched.length >= 12}>
          <Icon name="plus" size={13} /> {tr('구간 추가', 'Add period')}
        </button>
      </div>
      <p className="small muted">
        {tr(
          '다이얼 가장자리의 세그먼트(15분)를 밀어 넣은 구간에 COM-NO 가 붙습니다. 꺼짐이 켜짐보다 이르면 자정을 넘깁니다 (예: 18:00 → 06:00). 시계는 L · N 에 전원이 있어야 돌고, 정전되면 그만큼 늦어집니다.',
          'COM-NO closes during the pushed-in segments (15 min each). If off is earlier than on, the period runs past midnight. The dial only turns while L and N are powered.',
        )}
      </p>
      <p className="small muted">{tr('단자: L · N 시계 전원 / COM 공통 · NO 설정 시간에 붙음 · NC 반대 (제품마다 단자 이름이 다르니 옆면 결선도 확인)', 'Terminals: L, N clock supply / COM, NO closes during ON, NC opposite (check your model)')}</p>
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
                    {times[i] === undefined ? '' : model.tswDef.size ? formatClock((circuit.clock ?? 0) + times[i]) : longTime(times[i])}
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
        {model.tswDef.size > 0 && (
          <Field label={tr('시작 시각', 'Start clock')} hint={tr('타임 스위치의 시계가 시작하는 시각. 00:00 이면 차트의 시간이 곧 하루의 시각', 'Clock time at t = 0')}>
            <input
              type="time"
              className="input"
              value={formatClock(circuit.clock ?? 0)}
              onChange={(e) => {
                const t = parseClock(e.target.value);
                if (t !== null) onChange({ ...circuit, clock: t || undefined });
              }}
            />
          </Field>
        )}
      </div>
      {model.tswDef.size > 0 && <p className="muted small">{tr('타임 스위치가 있으면 하루(24시간)를 시뮬레이션합니다. 조작의 대기 시간은 6h, 30min 처럼 적을 수 있습니다.', 'With a time switch one day (24 h) is simulated. Waits can be written like 6h or 30min.')}</p>}
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

/** 전기 해석: 계통 설정, 문제, 케이블 · 부하 · 차단기 표 (조작 순서 전체에서 가장 나쁜 값) */
function PowerPane({ circuit, a, onChange, onPick, title }: { circuit: Circuit; a: PowerAnalysis; onChange: (c: Circuit) => void; onPick: (parts: string[], wires: string[]) => void; title: string }) {
  const f1 = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
  const pct = (i: number, lim: number | null) => (lim && lim > 0 ? Math.round((i / lim) * 100) : null);
  const csv = () => {
    const cell = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const line = (cells: unknown[]) => cells.map(cell).join(',');
    const out = [line([tr('케이블', 'Cable'), tr('규격', 'Spec'), 'IB (A)', 'Iz (A)', tr('차단기', 'Breaker'), 'In (A)', tr('전압강하 (V)', 'Drop (V)')])];
    for (const r of a.cables) out.push(line([`${r.from} → ${r.to}`, r.text, r.ib, r.iz ?? '', r.breaker, r.breakerAmps ?? '', r.dv]));
    out.push('', line([tr('부하', 'Load'), tr('설명', 'Name'), 'kW', tr('역률', 'pf'), tr('전류 (A)', 'I (A)'), tr('전압 (V)', 'V'), tr('전압강하 (%)', 'Drop (%)'), tr('허용 (%)', 'Limit (%)')]));
    for (const r of a.loads) out.push(line([r.tag, r.name, r.watt / 1000, r.pf, r.i, r.v ?? '', r.dropPct ?? '', r.limit]));
    out.push('', line([tr('차단기', 'Breaker'), 'In (A)', tr('최대 전류 (A)', 'Max I (A)')]));
    for (const r of a.breakers) out.push(line([r.tag, r.amps ?? '', r.i]));
    downloadText(`${safeFileName(title || 'circuit')}_${tr('전기해석', 'analysis')}.csv`, '\uFEFF' + out.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  };
  if (!a.loads.length && !a.cables.length)
    return (
      <div className="cc-power">
        <p className="muted">
          {tr(
            '부하 (전동기 · 전등 · 부하 상자) 와 케이블 규격을 넣으면 전선마다 흐르는 전류, 허용전류, 전압강하, 차단기 정격을 검토합니다.',
            'Add loads and cable specs to check currents, ampacity, voltage drop and breaker ratings.',
          )}
        </p>
        <ol className="small muted">
          <li>{tr('왼쪽 [분전반 · 부하] 에서 부하를 놓고 용량 (kW) 을 적습니다. 전동기 · 전등도 부하입니다', 'Place loads and enter their kW; motors and lights count too')}</li>
          <li>{tr('전선을 누르고 [속성] 에서 케이블 규격 (굵기 · 공사방법 · 길이) 을 정합니다', 'Select a wire and set its cable spec')}</li>
          <li>{tr('차단기를 누르고 정격 전류 (A) 를 적습니다', 'Enter breaker ratings')}</li>
          <li>{tr('분전반 · 변전함은 테두리 상자로 나누고 그 사이를 급전선으로 잇습니다', 'Use panel boxes and connect them with feeders')}</li>
        </ol>
        <button type="button" className="btn small" onClick={() => F.openCircuitExample('feeders')}>
          <Icon name="circuit" size={13} /> {tr('예제 열기: 분전반 급전 해석', 'Open the feeder analysis example')}
        </button>
      </div>
    );
  return (
    <div className="cc-power">
      <div className="grid2">
        <Field label={tr('선간 전압 (V)', 'Line voltage (V)')} hint={tr(`상전압 ${nominalVolt(a.vln)} V`, `phase ${nominalVolt(a.vln)} V`)}>
          <NumberInput value={circuit.vll ?? 380} min={1} step={10} onChange={(v) => onChange({ ...circuit, vll: v && v > 0 && v !== 380 ? v : undefined })} />
        </Field>
        <Field label={tr('수전 (전압강하 허용값)', 'Supply (drop limits)')}>
          <Select value={circuit.supply ?? 'lv'} onChange={(v) => onChange({ ...circuit, supply: v === 'hv' ? 'hv' : undefined })} options={[{ value: 'lv', label: tr('저압 수전: 조명 3% · 기타 5%', 'LV supply: 3% / 5%') }, { value: 'hv', label: tr('고압 이상 수전: 조명 6% · 기타 8%', 'HV supply: 6% / 8%') }]} />
        </Field>
      </div>
      <div className="cc-power-sum">
        <span>
          {tr('최대 부하', 'Peak load')} <b>{a.peakKw} kW</b>
        </span>
        {a.supply
          .filter((s) => s.i > 0.005)
          .map((s) => (
            <span key={s.pole}>
              {s.pole} <b>{f1(s.i)} A</b>
            </span>
          ))}
      </div>
      {a.issues.length === 0 ? (
        <p className="cc-ok">{tr('허용전류 · 전압강하 · 차단기 정격에 문제가 없습니다.', 'No ampacity, voltage drop or breaker problems.')}</p>
      ) : (
        <div className="msgs cc-check">
          {a.issues.map((i, k) => (
            <button type="button" key={k} className={`msg ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warning' : 'info'}`} onClick={() => onPick(i.partIds, i.wireIds)} disabled={!i.partIds.length && !i.wireIds.length}>
              <span>{i.msg}</span>
            </button>
          ))}
        </div>
      )}
      {a.cables.length > 0 && (
        <>
          <h4>{tr('케이블: 전류 IB ≤ 차단기 In ≤ 허용전류 Iz', 'Cables: IB ≤ In ≤ Iz')}</h4>
          <table className="tbl compact cc-power-tbl">
            <thead>
              <tr>
                <th>{tr('구간', 'Run')}</th>
                <th>{tr('규격', 'Spec')}</th>
                <th>IB</th>
                <th>In</th>
                <th>Iz</th>
              </tr>
            </thead>
            <tbody>
              {a.cables.map((r) => {
                const over = r.iz !== null && r.ib > r.iz;
                const bad = over || (r.iz !== null && r.breakerAmps !== null && r.breakerAmps > r.iz);
                return (
                  <tr key={r.id} className={bad ? 'bad' : ''} onClick={() => onPick([], r.wires)}>
                    <td className="mono small">
                      {r.from || '?'}
                      <br />→ {r.to || '?'}
                    </td>
                    <td className="small">
                      {r.spec.kind === 'bus' ? tr('부스바', 'Busbar') : r.spec.ins === 'pvc' ? 'PVC' : 'XLPE'} {r.spec.mm2}
                      <br />
                      <span className="muted">
                        {r.spec.kind === 'bus' ? '' : `${r.spec.method} · `}
                        {r.spec.len} m
                      </span>
                    </td>
                    <td className="num">
                      {f1(r.ib)}
                      {pct(r.ib, r.iz) !== null && <div className={`small ${over ? 'cc-bad' : 'muted'}`}>{pct(r.ib, r.iz)}%</div>}
                    </td>
                    <td className="num">{r.breakerAmps ?? '—'}</td>
                    <td className="num">{r.iz ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {a.loads.length > 0 && (
        <>
          <h4>{tr('부하: 전류와 전압강하', 'Loads: current and voltage drop')}</h4>
          <table className="tbl compact cc-power-tbl">
            <thead>
              <tr>
                <th>{tr('기호', 'Tag')}</th>
                <th>kW</th>
                <th>A</th>
                <th>V</th>
                <th>{tr('강하', 'Drop')}</th>
              </tr>
            </thead>
            <tbody>
              {a.loads.map((r) => {
                const bad = r.dropPct !== null && r.dropPct > r.limit;
                return (
                  <tr key={r.partId} className={bad ? 'bad' : ''} onClick={() => onPick([r.partId], [])}>
                    <td className="mono">
                      <b>{r.tag}</b>
                      {r.name && <div className="small muted">{r.name}</div>}
                    </td>
                    <td className="num">{Math.round(r.watt / 10) / 100}</td>
                    <td className="num">{f1(r.i)}</td>
                    <td className="num">{r.v === null ? '—' : Math.round(r.v)}</td>
                    <td className="num">
                      {r.dropPct === null ? '—' : `${r.dropPct}%`}
                      <div className={`small ${bad ? 'cc-bad' : 'muted'}`}>≤ {Math.round(r.limit * 100) / 100}%</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {a.breakers.length > 0 && (
        <>
          <h4>{tr('차단기', 'Breakers')}</h4>
          <table className="tbl compact cc-power-tbl">
            <thead>
              <tr>
                <th>{tr('기호', 'Tag')}</th>
                <th>{tr('정격 In', 'Rating In')}</th>
                <th>{tr('최대 전류', 'Max current')}</th>
              </tr>
            </thead>
            <tbody>
              {a.breakers.map((r) => {
                const bad = r.amps !== null && r.i > r.amps;
                return (
                  <tr key={r.partId} className={bad ? 'bad' : ''} onClick={() => onPick([r.partId], [])}>
                    <td className="mono">
                      <b>{r.tag}</b>
                    </td>
                    <td className="num">{r.amps === null ? '—' : `${r.amps} A`}</td>
                    <td className="num">
                      {f1(r.i)} A {pct(r.i, r.amps) !== null && <span className={`small ${bad ? 'cc-bad' : 'muted'}`}>({pct(r.i, r.amps)}%)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {a.panels.length > 0 && (
        <>
          <h4>{tr('분전반별 부하', 'Load per panel')}</h4>
          <table className="tbl compact cc-power-tbl">
            <tbody>
              {a.panels.map((r) => (
                <tr key={r.partId} onClick={() => onPick([r.partId], [])}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td className="num">
                    {r.kw} kW <span className="small muted">({tr(`부하 ${r.loads}개`, `${r.loads} loads`)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!WEB_TRIAL && (
        <button type="button" className="btn small" onClick={csv}>
          <Icon name="download" size={13} /> {tr('엑셀 CSV 저장', 'Save Excel CSV')}
        </button>
      )}
      <details className="cc-power-note">
        <summary>{tr('계산 방법과 가정', 'Method and assumptions')}</summary>
        <ul className="small muted">
          <li>{tr('조작 순서대로 돌렸을 때 가장 큰 전류 · 가장 낮은 전압을 봅니다. 조작 순서가 없으면 처음 상태 (차단기 ON) 입니다', 'Worst case over the operation sequence; without one, the initial state')}</li>
          <li>{tr('허용전류: KS C IEC 60364-5-52 표 B.52.2~B.52.5 (구리, 기중 30℃ · 지중 20℃), 트레이 E · F 는 40℃ 기준 표. 주위온도 · 복수회로 보정계수를 곱합니다', 'Ampacity: KS C IEC 60364-5-52 tables B.52.2–B.52.5 with temperature and grouping factors')}</li>
          <li>{tr('전압강하: 케이블 한 가닥 R = 0.0225·L/S Ω, X = 0.08 mΩ/m 로 실제 전류를 풀어서 부하 단자 전압을 구합니다 (규격이 없는 선은 저항 0)', 'Voltage drop: R = 0.0225·L/S Ω and X = 0.08 mΩ/m per conductor; wires without a spec are ideal')}</li>
          <li>{tr('부하는 정격 전압에서 정격 용량을 쓰는 것으로 봅니다. 전동기 기동 전류, 단락 전류, 차단기 트립 시간, 수용률은 계산하지 않습니다', 'Loads are constant impedance at rated voltage. Motor starting current, fault current, trip time and demand factors are not modelled')}</li>
          <li>{tr('참고용 계산입니다. 실제 시공 전에는 전기 설계 · 감리 기준으로 확인하세요', 'For reference only; confirm against the applicable design rules before installation')}</li>
        </ul>
      </details>
    </div>
  );
}

function wireHighlight(r: WiringRow | undefined) {
  return r ? { segs: r.segs, pts: [r.from.at, r.to.at] } : null;
}

/** 결선표: 단자 → 단자 전선 한 가닥씩, 누르면 그림에서 강조, 배선을 마치면 체크 */
function WiringPane({
  rows,
  done,
  title,
  pick,
  onPick,
  onDone,
  nosOn,
  setNosOn,
  guide,
  setGuide,
}: {
  rows: WiringRow[];
  done: string[];
  title: string;
  pick: string | null;
  onPick: (key: string | null) => void;
  onDone: (wired: string[]) => void;
  nosOn: boolean;
  setNosOn: (v: boolean) => void;
  guide: boolean;
  setGuide: (v: boolean) => void;
}) {
  const doneSet = new Set(done);
  const cur = rows.findIndex((r) => r.key === pick);
  // 따라 배선하기를 켜면 아직 안 한 첫 전선부터
  useEffect(() => {
    if (guide && cur < 0 && rows.length) onPick((rows.find((r) => !doneSet.has(r.key)) ?? rows[0]).key);
  }, [guide, cur, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <p className="muted">{tr('선으로 이어진 단자가 없습니다.', 'No wired terminals yet.')}</p>;
  const n = rows.filter((r) => doneSet.has(r.key)).length;
  const toggle = (key: string, on: boolean) => onDone(on ? [...done.filter((k) => k !== key), key] : done.filter((k) => k !== key));
  const go = (d: number) => cur >= 0 && onPick(rows[(cur + d + rows.length) % rows.length].key);
  /** 지금 전선을 마쳤다고 표시하고, 다음 안 한 전선으로 */
  const finish = () => {
    if (cur < 0) return;
    const key = rows[cur].key;
    const next = [...done.filter((k) => k !== key), key];
    onDone(next);
    const set = new Set(next);
    for (let i = 1; i <= rows.length; i++) {
      const r = rows[(cur + i) % rows.length];
      if (!set.has(r.key)) return onPick(r.key);
    }
  };
  const row = cur >= 0 ? rows[cur] : null;
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
      <div className="cc-wiring-opts">
        <Check checked={nosOn} onChange={setNosOn} label={tr('그림에 선번호 적기', 'Wire numbers on the drawing')} />
        <button type="button" className={`btn small ${guide ? 'primary' : ''}`} onClick={() => setGuide(!guide)} title={tr('한 가닥씩 차례로 안내합니다. 마친 전선만 진하게 보입니다', 'Step through the wires one at a time; finished wires stay solid')}>
          <Icon name="play" size={13} /> {guide ? tr('따라 배선 끝내기', 'Stop guide') : tr('따라 배선하기', 'Follow along')}
        </button>
      </div>
      {guide && row && (
        <div className="cc-wiring-step">
          <div className="cc-wiring-step-no">
            {tr(`${cur + 1}번째 전선`, `Wire ${cur + 1}`)} / {rows.length}
            <span className="muted"> · {tr('선번호', 'no.')} {row.no}</span>
          </div>
          <div className="cc-wiring-step-main">
            <b>{termText(row.from)}</b>
            <span className="cc-wiring-arrow">→</span>
            <b>{termText(row.to)}</b>
          </div>
          <div className="small">
            {row.color && <span className="cc-wsw" style={{ background: WIRE_HEX[row.color] }} />} {wireColorName(row.color) || tr('색 없음', 'no colour')}
            {doneSet.has(row.key) && <span className="cc-ok"> ✓ {tr('완료', 'done')}</span>}
          </div>
          <div className="cc-btnrow">
            <button type="button" className="btn small" onClick={() => go(-1)}>
              ← {tr('이전', 'Back')}
            </button>
            <button type="button" className="btn small primary" onClick={finish}>
              {n + (doneSet.has(row.key) ? 0 : 1) >= rows.length ? tr('완료 ✓', 'Done ✓') : tr('완료 → 다음', 'Done → next')}
            </button>
            <button type="button" className="btn small" onClick={() => go(1)}>
              {tr('건너뛰기', 'Skip')} →
            </button>
          </div>
          {n >= rows.length && <p className="cc-ok small">{tr('모든 전선을 이었습니다. [시뮬레이션]으로 동작을 확인하세요.', 'All wires done. Run the simulation to check.')}</p>}
        </div>
      )}
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
