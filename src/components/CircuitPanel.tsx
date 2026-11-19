import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import type { Project } from '../model/types';
import { emptyCircuit, type CableMethod, type CableSpec, type Circuit, type HmiItem, type LampColor, type OpStep, type Part, type PartType, type Pole, type PowerSystem, type Wire, type WireColor } from '../circuit/types';
import { defaultVolt, poleLive, POWER_SYSTEMS, systemLabel, systemName, systemOf, systemVolts, systemVoltText, voltFieldLabel } from '../circuit/supply';
import { partGuide } from '../circuit/guide';
import { analyzePower, autoSize, breakerAmps, cableIz, cableMethods, cableSizes, cableZ, groupFactor, isBreaker, loadRating, nominalVolt, PowerModel, tableIz, tempFactor, trImpedance, type PowerAnalysis, type PowerState } from '../circuit/power';
import { parallelWires, wireChain } from '../circuit/wires';
import { BODY_OHM, earthingOf, earthStudy, ZLOOP_TN, type EarthRow } from '../circuit/earth';
import { changeSocketLayout } from '../circuit/socket';
import { busSize, circuitWires, REAL, counterPreset, HMI_MAX, hmiTag, isPlcPart, isTempDevice, tempSetting, DEFAULT_SCHED, FOLLOWER, LAMP_PREFIX, lampColorName, nextTag, octalLayout, opActionLabel, palette, PARTS, partBox, partKindName, pos3Labels, PROX_TYPES, SOL_TYPES, tswSched, plcAddresses, plcBases, VALVES, type OctalLayout, type PaletteItem } from '../circuit/parts';
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
import { rerouteWiring, wireLength } from '../circuit/realize';
import { ilToLadder, readLadder } from '../plc/ladder';
import { parseDeviceComments } from '../plc/comments';
import { LadderEditor } from './LadderEditor';

/** 회로 기호가 아닌 것 (글 · PLC · 공압): [실물 배선도 만들기] 를 띄울지 볼 때 뺀다 */
const NOT_SYMBOL = new Set<PartType>(['text', 'plc', 'cyl', 'v32', 'v52', 'v52d', 'v53', 'air', 'frl', 'fc']);
import { circuitExamples, exampleGroups } from '../circuit/examples';
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
  if (item.type === 'plc' || item.type === 'r_plc') {
    const b = plcBases(dialect);
    p.inBase = b.in;
    p.outBase = b.out;
  }
  if (item.type === 'r_hmi' && !p.hmi) {
    // 기본 화면: 기동 · 정지 버튼, 운전 램프 (PLC 종류에 맞는 내부 릴레이)
    const ls = dialect === 'ls';
    p.hmi = [
      { kind: 'btn', label: tr('기동', 'Start'), dev: ls ? 'M00100' : 'M100', color: 'green' },
      { kind: 'btn', label: tr('정지', 'Stop'), dev: ls ? 'M00101' : 'M101', color: 'red' },
      { kind: 'lamp', label: tr('운전', 'Run'), dev: plcBases(dialect).out, color: 'green' },
    ];
  }
  // 아직 아무것도 쓰지 않는 솔레노이드 기호를 실린더·밸브에 붙여 준다
  const used = new Set(c.parts.flatMap((q) => [q.solPlus, q.solMinus, q.solA, q.solB].map((t) => normTag(t ?? ''))));
  const free = c.parts.filter((q) => SOL_TYPES.has(q.type) && q.tag.trim() && !used.has(normTag(q.tag))).map((q) => q.tag);
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
    // 누전: 시작 → (끝날 때까지의 시간)
    if (a.leak !== undefined) {
      if (a.leak === null) continue;
      const t = r10(a.t);
      const end = actions.slice(i + 1).find((b) => b.tag === a.tag && b.leak === null);
      ops.push({ id: uid('op'), wait: Math.max(0, t - prev), tag: model.label(a.tag), action: 'leak', value: a.leak, hold: end ? Math.max(10, r10(end.t - a.t)) : 0 });
      prev = t;
      continue;
    }
    const momentary = model.momentary(a.tag);
    if (momentary && !a.on) continue;
    const t = r10(a.t);
    const op: OpStep = { id: uid('op'), wait: Math.max(0, t - prev), tag: model.label(a.tag), action: 'press', hold: 300 };
    if (a.temp !== undefined) {
      op.action = 'temp';
      op.value = a.temp;
      op.hold = 0;
    } else if (a.pos !== undefined) op.action = a.pos < 0 ? 'left' : a.pos > 0 ? 'right' : 'off';
    else if (momentary) {
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
  /** 기기 자리는 그대로, 전선만 가장 짧게 다시 긋는다 (연결은 그대로) */
  const reroute = () => {
    const r = rerouteWiring(circuit);
    if (r.skipped) return toast(r.skipped, 'warn');
    if (r.failed) return toast(tr(`선 ${r.failed}개를 이을 자리가 없어 그대로 두었습니다. 기기 사이를 조금 띄운 뒤 다시 해 보세요`, `${r.failed} connection(s) had no room; nothing changed. Space the devices out a little and try again`), 'warn');
    commitCircuit(r.circuit);
    const m = (v: number) => (v / 100).toFixed(1);
    toast(tr(`전선을 다시 그렸습니다: 약 ${m(r.before)} m → ${m(r.after)} m (연결은 그대로)`, `Wires redrawn: about ${m(r.before)} m → ${m(r.after)} m (same connections)`), 'ok');
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
    // PLC 가 있으면 래더 모니터가 보이게
    if (circuit.parts.some(isPlcPart) && side === 'ops') setSide('props');
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
        tr(`방금 누른 조작 ${r.actions.filter((a) => a.on || !model.momentary(a.tag)).length}개를 조작 순서표로 바꿀까요? 그러면 타임차트가 그 순서대로 만들어집니다.`, 'Turn the operations you just made into the operation sequence? The timing chart follows it.'),
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

  const onOperate = (tag: string, phase: 'down' | 'up', side?: -1 | 1) => {
    const r = runRef.current;
    if (!r) return;
    const t = simTime(performance.now());
    r.sim.advanceTo(t);
    // 온도 기기: 왼쪽을 누르면 5℃ 내리고, 오른쪽을 누르면 5℃ 올린다
    if (model.tempDef.has(tag)) {
      if (phase !== 'down') return;
      const v = Math.round((r.sim.tempView(tag)?.pv ?? 0) / 5) * 5 + 5 * (side ?? 1);
      if (r.sim.changeTemp(tag, v)) r.actions.push({ t, tag, on: false, temp: v });
      setTick((x) => x + 1);
      return;
    }
    // 3단 셀렉터: 누른 쪽으로 돌리고, 이미 그쪽이면 가운데로
    if (model.sel3.has(tag)) {
      if (phase !== 'down') return;
      const cur = r.sim.selPos(tag);
      const next: -1 | 0 | 1 = cur === (side ?? 1) ? 0 : (side ?? 1);
      if (r.sim.setPos(tag, next)) r.actions.push({ t, tag, on: next !== 0, pos: next });
      setTick((x) => x + 1);
      return;
    }
    const momentary = model.momentary(tag);
    let v: boolean | null = null;
    if (phase === 'down') v = momentary ? true : !r.sim.on(tag);
    else if (momentary) v = false;
    if (v !== null && r.sim.setAct(tag, v)) r.actions.push({ t, tag, on: v });
    setTick((x) => x + 1);
  };

  /** 시뮬레이션 중 Shift+클릭: 누전을 켜고 끈다 */
  const onLeak = (tag: string) => {
    const r = runRef.current;
    if (!r) return;
    const t = simTime(performance.now());
    r.sim.advanceTo(t);
    const on = r.sim.faults.has(tag);
    const before = r.sim.faultLog.length;
    if (r.sim.setLeak(tag, on ? null : 0)) r.actions.push({ t, tag, on: false, leak: on ? null : 0 });
    const log = r.sim.faultLog.slice(before);
    if (on) toast(tr(`${model.label(tag)} 누전을 없앴습니다`, `${model.label(tag)} earth fault cleared`), 'ok');
    else if (log.length) toast(log[log.length - 1].text, log[log.length - 1].level === 'danger' ? 'warn' : 'ok');
    else toast(tr(`${model.label(tag)} 누전: 지금은 전원이 없어 흐르지 않습니다`, `${model.label(tag)} earth fault: not energised now`), 'ok');
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
    // 온도는 사건 사이에도 바뀌므로 지금 시각의 값을 끝에 붙인다
    const tracks = r.sim.tracks.map((x) => {
      const points = [...x.points];
      if (x.kind === 'tempVal' && t > (points[points.length - 1]?.t ?? 0)) points.push({ t, v: Math.round(r.sim.zoneTemp(x.key.slice(3)) * 100) / 100 });
      return { ...x, points };
    });
    const res: ScenarioResult = { model, tracks, end: t, lastChange: t, warnings: [], times: [] };
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
  const needPower = side === 'power' || circuit.wires.some((w) => w.cable) || circuit.parts.some((q) => q.type === 'r_bus');
  // 그린 선 + 부스바 막대 (전류표 · 강조에 함께 쓴다)
  const allWires = useMemo(() => circuitWires(circuit), [circuit]);
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
  // 전선마다 전류표: 시뮬레이션 중에는 그 순간 값, [해석] 탭을 열어 두면 가장 클 때의 값. 규격이 없는 선에도 붙인다
  const staticI = !running && side === 'power' ? analysis.wireI : null;
  const [showAmps, setShowAmpsState] = useState(() => storageGet(AMPS_KEY) !== '0');
  const setShowAmps = (v: boolean) => {
    setShowAmpsState(v);
    storageSet(AMPS_KEY, v ? '1' : '0');
  };
  const liveCurrents = useMemo(() => {
    const src = (showAmps ? livePower?.wireI : null) ?? staticI;
    if (!src) return undefined;
    // 시뮬레이션 중에는 0.05 A 이상만 (제어 회로 그림을 가리지 않게), [해석] 탭에서는 mA 단위의 제어 전류까지
    const min = livePower && showAmps ? 0.05 : 0.002;
    const byId = new Map(allWires.map((w) => [w.id, w]));
    const len = (w: Wire) => Math.abs(w.a[0] - w.b[0]) + Math.abs(w.a[1] - w.b[1]);
    const out: { a: [number, number]; b: [number, number]; text: string; bad?: boolean; i: number }[] = [];
    for (const run of powerModel.runs) {
      const ws = run.wires.map((id) => byId.get(id)).filter((w): w is Wire => !!w);
      const i = Math.max(0, ...ws.map((w) => src.get(w.id) ?? 0));
      if (i < min || !ws.length) continue;
      const long = [...ws].sort((a, b) => len(b) - len(a))[0];
      // 아주 짧은 점퍼선은 글자표가 그림을 가리므로 건너뛴다 (마우스를 올리면 보인다)
      if (run.cable < 0 && len(long) < 2) continue;
      const iz = run.cable >= 0 ? cableIz(powerModel.cables[run.cable].spec) : null;
      out.push({ a: long.a, b: long.b, text: i >= 10 ? `${i.toFixed(1)} A` : i >= 1 ? `${i.toFixed(2)} A` : `${Math.round(i * 1000)} mA`, bad: iz !== null && i > iz, i });
    }
    return out;
  }, [livePower, staticI, showAmps, powerModel, allWires]);
  // [해석] 탭에서 고른 줄: 그림에서 강조하고 화면 밖이면 그쪽으로
  const [powerPick, setPowerPick] = useState<{ parts: string[]; wires: string[] } | null>(null);
  const powerHighlight = useMemo(() => {
    if (!powerPick || side !== 'power') return null;
    const ws = new Set(powerPick.wires);
    const ps = new Set(powerPick.parts);
    return { segs: allWires.filter((w) => ws.has(w.id)).map((w) => [w.a, w.b] as [[number, number], [number, number]]), pts: circuit.parts.filter((q) => ps.has(q.id) && q.type !== 'r_panel' && q.type !== 'r_bus').map((q) => [q.x, q.y] as [number, number]) };
  }, [powerPick, side, allWires, circuit.parts]);
  /** 부품 위에 마우스를 올렸을 때의 정보 */
  const partInfo = (q: Part): string[] => {
    const lines = [[q.tag, q.name].filter(Boolean).join('  ') || partKindName(q.type)];
    const rating = loadRating(q);
    const amps = breakerAmps(q);
    lines.push([q.tag || q.name ? partKindName(q.type) : '', amps !== null ? `${amps} A` : '', rating && (rating.out >= 20 || q.watt !== undefined) ? `${Math.round(rating.out / 10) / 100} kW · pf ${rating.pf}` : ''].filter(Boolean).join(' · '));
    if (livePower) {
      const ld = livePower.loads.get(q.id);
      const through = livePower.partI.get(q.id);
      if (ld) lines.push(tr(`지금 ${ld.i.toFixed(2)} A · ${ld.v.toFixed(0)} V`, `now ${ld.i.toFixed(2)} A · ${ld.v.toFixed(0)} V`));
      else if (through !== undefined && through > 0.005) lines.push(tr(`지금 ${through.toFixed(2)} A${amps ? ` (정격의 ${Math.round((through / amps) * 100)}%)` : ''}`, `now ${through.toFixed(2)} A${amps ? ` (${Math.round((through / amps) * 100)}% of rating)` : ''}`));
    } else if (needPower) {
      const ld = analysis.loads.find((l) => l.partId === q.id);
      const br = analysis.breakers.find((b) => b.partId === q.id);
      if (ld) lines.push(ld.on ? tr(`최대 ${ld.i} A${ld.dropPct !== null ? ` · 전압강하 ${ld.dropPct}%` : ''}`, `max ${ld.i} A${ld.dropPct !== null ? ` · drop ${ld.dropPct}%` : ''}`) : tr('조작 순서에서 켜지지 않음', 'never on in the sequence'));
      else if (br && br.i > 0.005) lines.push(tr(`최대 ${br.i} A${br.amps ? ` / 정격 ${br.amps} A` : ''}`, `max ${br.i} A${br.amps ? ` / rated ${br.amps} A` : ''}`));
    }
    return lines;
  };
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
            // 묶음마다 폴더 (누르면 그 자리에서 펼쳐짐)
            ...exampleGroups().map((g) => ({
              label: g.title,
              sub: circuitExamples()
                .filter((ex) => ex.group === g.key)
                .map((ex) => ({ label: ex.name, icon: 'circuit', onClick: () => F.openCircuitExample(ex.id) })),
            })),
            { divider: true },
            { label: tr('새 회로도 (새 차트 탭)', 'New circuit (new chart tab)'), icon: 'plus', onClick: F.addCircuitSheet },
          ]}
        />
        {circuit.parts.some((p) => !REAL.has(p.type) && !NOT_SYMBOL.has(p.type)) && (
          <button type="button" className="btn small" onClick={F.makeWiringSheet} disabled={running} title={tr('이 회로도를 실물 기기로 바꿔 판넬처럼 놓고 전선을 그어 새 차트 탭으로 엽니다 (전선이 짧아지게 차례를 정함, 시뮬레이션 결과가 같음)', 'Turn this schematic into real devices laid out like a panel with every wire drawn, in a new chart tab (ordered for short wires, same simulation)')}>
            <Icon name="circuit" size={13} /> {tr('실물 배선도 만들기', 'Make wiring diagram')}
          </button>
        )}
        {circuit.parts.some((p) => REAL.has(p.type) && p.type !== 'r_panel') && circuit.wires.length > 0 && (
          <button type="button" className="btn small" onClick={reroute} disabled={running} title={tr('기기 자리는 그대로 두고 전선을 모두 다시 긋습니다 (가장 짧게, 연결은 그대로). 기기를 실제 자리로 옮긴 뒤 누르면 전선 길이를 비교할 수 있습니다', 'Redraw every wire for the current device positions (shortest, same connections); move devices to their real places first to compare wire length')}>
            <Icon name="wire" size={13} /> {tr('배선 다시 그리기', 'Re-route wires')}
          </button>
        )}
        {circuit.parts.some((p) => REAL.has(p.type) && p.type !== 'r_panel') && (
          <button type="button" className="btn small" onClick={F.makeSchematicSheet} disabled={running} title={tr('이 실물 배선도를 회로 기호로 다시 그려 새 차트 탭으로 엽니다 (조작 순서도 같이, 시뮬레이션 결과가 같음)', 'Redraw this wiring diagram as a schematic in a new chart tab (same operations, same simulation)')}>
            <Icon name="circuit" size={13} /> {tr('회로도 만들기', 'Make schematic')}
          </button>
        )}
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
            {powerModel.loads.length > 0 && <Check checked={showAmps} onChange={setShowAmps} label={tr('전류 표시', 'Show currents')} />}
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
            ? tr('버튼을 누르고 있으면 ON, 스위치·차단기·THR 은 누를 때마다 바뀝니다. 전동기 · 히터 · 콘센트를 Shift+클릭하면 누전. 끝나면 [정지]', 'Hold push buttons; click switches, breakers and THR to toggle; Shift+click a motor, heater or outlet for an earth fault')
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
          onLeak={onLeak}
          onCommit={commitCircuit}
          onEndMerge={endMerge}
          onEditPart={(p) => void editTag(p)}
          flagged={flagged}
          ghostPart={(item, x, y) => makePart(circuit, item, x, y, 'ghost', project.plc?.dialect)}
          fitKey={fitKey}
          highlight={side === 'wiring' ? wireHighlight(wiring.find((r) => r.key === wirePick)) : powerHighlight}
          partInfo={partInfo}
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
                plcMonitor={running && runRef.current ? (d) => runRef.current?.sim.plcBit(d) ?? null : undefined}
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
                setCircuit={(c) => commitCircuit(c, 'power-sys', false)}
                setWireCable={(cable, parallel) => {
                  // 꺾여 이어진 한 가닥 전체에 같은 규격. 나란한 가닥 (3상의 나머지 두 가닥) 도 함께
                  const ws = new Set(parallel ? parallelWires(circuit, sel.wires) : wireChain(circuit, sel.wires));
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
                length={wireLength(circuit)}
                onReroute={circuit.parts.some((p) => REAL.has(p.type)) ? reroute : undefined}
              />
            )}
            {side === 'power' && (
              <PowerPane
                circuit={circuit}
                a={analysis}
                onChange={(c) => commitCircuit(c, 'power-sys', false)}
                onPick={(parts, wires) => {
                  setSel({ parts, wires });
                  setPowerPick({ parts, wires });
                }}
                onAuto={(assign) => {
                  const res = autoSize(circuit, (c) => new CircuitModel(c, project.plc), { assign });
                  if (res.circuit === circuit) {
                    toast(tr('바꿀 것이 없습니다', 'Nothing to change'), 'ok');
                    return;
                  }
                  commitCircuit(res.circuit, undefined, false);
                  const what = [res.assigned ? tr(`${res.assigned}구간에 규격 지정`, `${res.assigned} runs given a spec`) : '', res.resized ? tr(`${res.resized}구간 굵기 키움`, `${res.resized} runs enlarged`) : ''].filter(Boolean).join(', ');
                  toast(res.left ? tr(`${what || '굵기 선정'}: 문제 ${res.left}개가 남았습니다 (차단기 정격 · 부하를 확인하세요). Ctrl+Z 로 되돌리기`, `${what}: ${res.left} problems left. Ctrl+Z to undo`) : tr(`${what}: 문제가 없습니다. Ctrl+Z 로 되돌리기`, `${what}: no problems left. Ctrl+Z to undo`), res.left ? 'warn' : 'ok');
                }}
                title={project.meta.title}
              />
            )}
            {side === 'power' && <EarthSection circuit={circuit} model={model} onPick={(parts) => (setSel({ parts, wires: [] }), setPowerPick({ parts, wires: [] }))} />}
            {side === 'check' && <CheckPane issues={issues} onPick={(ids, wires) => (setSel({ parts: ids, wires }), setPowerPick({ parts: ids, wires }), ids.length === 1 && !wires.length && setSide('props'))} />}
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
const AMPS_KEY = 'timechart-studio.circuit-amps.v1';

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
  setCircuit,
  plcMonitor,
}: {
  circuit: Circuit;
  model: CircuitModel;
  sel: Sel;
  part: Part | null;
  /** 시뮬레이션 중 PLC 디바이스 값 */
  plcMonitor?: (dev: string) => boolean | null;
  colors: CircuitColors;
  placing: PaletteItem | null;
  update: (id: string, patch: Partial<Part>) => void;
  remove: () => void;
  rotate: () => void;
  setWireColor: (c: WireColor | undefined) => void;
  setWireCable: (c: CableSpec | undefined, parallel: boolean) => void;
  setCircuit: (c: Circuit) => void;
}) {
  const bom = useMemo(() => partsList(circuit), [circuit]);
  // 시뮬레이션 중이고 PLC 가 있으면, 고른 것이 없을 때 래더 모니터를 보여 준다
  if (!p && plcMonitor && circuit.parts.some(isPlcPart) && !sel.parts.length && !sel.wires.length)
    return (
      <div className="cc-props">
        <PlcMonitor monitor={plcMonitor} />
      </div>
    );
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
  const solTags = circuit.parts.filter((q) => SOL_TYPES.has(q.type) && q.tag.trim()).map((q) => q.tag);
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
        <>
          <Field label={tr('전원 극', 'Supply pole')} wide hint={tr('같은 계통끼리 동작: +24V↔0V, L(L1)·L2·L3↔N. PE 는 접지 (L 과 닿으면 지락)', 'Works within a system: +24V↔0V, L/L1/L2/L3↔N. PE is earth')}>
            <Select
              value={p.pole ?? 'L'}
              onChange={(v: Pole) => set({ pole: v })}
              options={(['L', 'N', '+24V', '0V', 'L1', 'L2', 'L3', 'PE'] as Pole[]).map((x) => ({ value: x, label: poleLive(circuit, x === 'L' ? 'L1' : x) ? x : `${x} ${tr('(이 계통에 없음)', '(not in this system)')}` }))}
            />
          </Field>
          <SupplyFields circuit={circuit} onChange={setCircuit} />
        </>
      ) : isPlcPart(p) ? (
        <PlcProps p={p} set={set} model={model} monitor={plcMonitor} />
      ) : p.type === 'r_hmi' ? (
        <HmiProps p={p} set={set} model={model} />
      ) : p.type === 'src3' ? (
        <>
          <p className="muted small">{tr('3상 전원 L1 · L2 · L3. 전동기 U·V·W 에 L1→L2→L3 순서로 닿으면 정회전, 두 상을 바꾸면 역회전.', '3-phase supply. L1→L2→L3 on U·V·W runs forward; swapping two phases reverses.')}</p>
          <SupplyFields circuit={circuit} onChange={setCircuit} />
        </>
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
                <Select value={p.timerMode ?? 'on'} onChange={(v: 'on' | 'off' | 'flicker' | 'interval') => set({ timerMode: v })} options={[{ value: 'on', label: tr('ON 딜레이 (한시 동작)', 'On-delay') }, { value: 'off', label: tr('OFF 딜레이 (한시 복귀)', 'Off-delay') }, { value: 'interval', label: tr('인터벌 (원샷: 켜지면 설정 시간만 ON)', 'Interval (one-shot)') }, { value: 'flicker', label: tr('플리커 (점멸)', 'Flicker') }]} />
              </Field>
              <Field label={p.timerMode === 'flicker' ? tr('켜짐 시간', 'On time') : tr('설정 시간', 'Preset')}>
                <TimeInput value={p.preset ?? 3000} onChange={(v) => v !== undefined && set({ preset: v })} />
              </Field>
              {p.timerMode === 'flicker' && (
                <Field label={tr('꺼짐 시간', 'Off time')} hint={tr('비우면 켜짐 시간과 같음. 다르게 넣으면 트윈 타이머 (예: 2초 ON · 5초 OFF 반복)', 'Empty = same as on time. Different = twin timer (e.g. 2 s on, 5 s off)')}>
                  <TimeInput value={p.presetOff} allowEmpty placeholder={tr('켜짐과 같음', 'same as on')} onChange={(v) => set({ presetOff: v && v > 0 ? v : undefined })} />
                </Field>
              )}
            </div>
          )}
          {p.type === 'r_timer8' && (
            <>
              <Check checked={!!p.inst13} onChange={(v) => set({ inst13: v || undefined })} label={tr('1-3 · 1-4 를 순시 접점으로 (한시 1a1b + 순시 1a1b)', '1-3 / 1-4 instantaneous (timed 1NO1NC + inst. 1NO1NC)')} />
              <p className="small muted">{tr('2-7 전원 · 8-6 한시 a · 8-5 한시 b · 1-3 a · 1-4 b (모델마다 다르니 기기 옆면 결선도를 확인)', 'Power 2-7 · 8-6 timed NO · 8-5 timed NC · 1-3 NO · 1-4 NC (check the label on your model)')}</p>
            </>
          )}
          {p.type === 'r_counter' && (
            <>
              <div className="grid2">
                <Field label={tr('설정 수 (이만큼 세면 출력)', 'Preset count')}>
                  <NumberInput value={counterPreset(p)} min={1} max={999999} step={1} onChange={(v) => set({ count: Math.max(1, Math.round(v ?? 5)) })} />
                </Field>
              </div>
              <p className="small muted">{tr('A1 · A2 전원 · CP-COM 사이가 이어질 때마다 1 셈 (무전압 접점 입력) · RST-COM 이 이어지면 0 · 설정 수에 닿으면 C-NO 닫힘, C-NC 열림 (리셋까지 유지). 단자 번호는 기종마다 다르니 기기 옆면 결선도를 따르세요', 'Power A1/A2 · counts each time CP closes to COM (dry contact) · RST to COM resets · at the preset C-NO closes and C-NC opens until reset. Terminal numbers differ by model; follow the label on yours')}</p>
            </>
          )}
          {isTempDevice(p) && <TempProps p={p} circuit={circuit} set={set} />}
          {p.type === 'r_ss3' && (
            <>
              <Field label={tr('자리 이름 (왼쪽 / 가운데 / 오른쪽)', 'Position names (left / centre / right)')} wide>
                <TagInput value={p.pos3 ?? ''} onChange={(v) => set({ pos3: v || undefined })} placeholder={pos3Labels({}).join(' / ')} />
              </Field>
              <Field label={tr('지금 자리 (시뮬레이션을 이 자리에서 시작)', 'Current position (simulation starts here)')} wide>
                <Select
                  value={String(p.pos0 ?? 0)}
                  onChange={(v: string) => set({ pos0: v === '-1' ? -1 : v === '1' ? 1 : undefined })}
                  options={[
                    { value: '-1', label: `← ${pos3Labels(p)[0]}` },
                    { value: '0', label: pos3Labels(p)[1] },
                    { value: '1', label: `${pos3Labels(p)[2]} →` },
                  ]}
                />
              </Field>
              <p className="small muted">{tr(`왼쪽 (${pos3Labels(p)[0]}) 이면 13-14, 오른쪽 (${pos3Labels(p)[2]}) 이면 23-24 가 닫히고 가운데는 둘 다 열립니다. 시뮬레이션 중에는 손잡이의 왼쪽 · 오른쪽을 눌러 돌립니다`, `Left (${pos3Labels(p)[0]}) closes 13-14, right (${pos3Labels(p)[2]}) closes 23-24, centre opens both. While simulating, click the left or right side of the knob`)}</p>
            </>
          )}
          {p.type === 'r_ssr' && <p className="small muted">{tr('입력 3 (+) · 4 (-) 에 DC 를 넣으면 출력 1-2 가 통합니다 (교류 부하용, 극성 주의)', 'DC on input 3 (+) / 4 (-) turns output 1-2 on (AC load; mind the polarity)')}</p>}
          {p.type === 'r_relay8' && <p className="small muted">{tr('2-7 코일 · 1-3 a · 1-4 b · 8-6 a · 8-5 b (MK2P 꼴)', 'Coil 2-7 · 1-3 NO · 1-4 NC · 8-6 NO · 8-5 NC (MK2P-style)')}</p>}
          {(p.type === 'r_relay8' || p.type === 'r_timer8') && (
            <Field
              label={tr('소켓 단자 배열 (위에서 본 그림)', 'Socket terminal layout (top view)')}
              wide
              hint={tr('전선은 소켓의 나사 단자에 물립니다. 가진 소켓에 적힌 번호 줄과 같은 것을 고르세요. 바꾸면 물려 있던 선은 같은 번호 단자를 따라갑니다 (비스듬해진 선은 다시 정리)', 'Wires land on the socket screws. Pick the rows printed on your socket; attached wires follow their terminal numbers')}
            >
              <Select
                value={octalLayout(p)}
                onChange={(v: OctalLayout) => {
                  const res = changeSocketLayout(circuit, p.id, v);
                  const { toast } = useStore.getState();
                  setCircuit(res.circuit);
                  if (!res.same) toast(tr('옮겨진 선이 다른 단자 위를 지나가서 연결이 달라졌습니다. 비스듬한 선을 다시 그리거나 Ctrl+Z 로 되돌리세요', 'A moved wire now touches another terminal. Redraw the slanted wires or press Ctrl+Z'), 'warn');
                  else if (res.moved) toast(tr(`물려 있던 선 ${res.moved}가닥이 같은 번호 단자를 따라갔습니다. 비스듬해진 선은 다시 정리하세요`, `${res.moved} wires followed their terminal numbers; tidy up any slanted ones`), 'ok');
                }}
                options={[
                  { value: 'pf', label: tr('위 6 5 4 3 · 아래 7 8 1 2 (PF083A · 8PFA 꼴)', 'Top 6 5 4 3 · bottom 7 8 1 2 (PF083A type)') },
                  { value: 'pfr', label: tr('위 2 1 8 7 · 아래 3 4 5 6 (같은 소켓을 돌려 단 것)', 'Top 2 1 8 7 · bottom 3 4 5 6 (same socket turned round)') },
                  { value: 'seq', label: tr('번호순: 위 1 2 3 4 · 아래 8 7 6 5 (예전 그림)', 'In order: top 1 2 3 4 · bottom 8 7 6 5 (old drawing)') },
                ]}
              />
            </Field>
          )}
          {(p.type === 'r_my2' || p.type === 'r_my4') && (
            <p className="small muted">
              {p.type === 'r_my2'
                ? tr('13-14 코일 · 9-5 a · 9-1 b · 12-8 a · 12-4 b (MY2N · 소켓 PYF08A 꼴). 소켓 위 바깥 단이 b (4 1), 안쪽 단이 a (8 5), 아래 안쪽 단이 공통 (12 9), 바깥 단이 코일 (14 13)', 'Coil 13-14 · 9-5 NO · 9-1 NC · 12-8 NO · 12-4 NC (MY2N-style, PYF08A socket)')
                : tr('13-14 코일 · 공통 9 10 11 12 · a 5 6 7 8 · b 1 2 3 4 (MY4N · 소켓 PYF14A 꼴). 같은 줄의 세 단자가 한 벌: 9-5 a · 9-1 b, 10-6 · 10-2, 11-7 · 11-3, 12-8 · 12-4', 'Coil 13-14 · commons 9-12 · NO 5-8 · NC 1-4 (MY4N-style, PYF14A socket). Each column is one changeover')}
            </p>
          )}
          {p.type === 'r_tsw' && <SchedEditor p={p} set={set} />}
          <RatingFields p={p} set={set} circuit={circuit} />
          {p.type === 'r_tb' && (
            <Field label={tr('극수', 'Poles')} wide hint={tr('번호마다 위·아래 나사가 이어져 있습니다', 'Top and bottom screws of each number are connected')}>
              <NumberInput value={p.n ?? 6} min={1} max={40} onChange={(v) => set({ n: v ?? 6 })} />
            </Field>
          )}
          {p.type === 'r_nbar' && (
            <div className="grid2">
              <Field label={tr('쓰임', 'Use')}>
                <Select value={p.pole === 'PE' ? 'PE' : 'N'} onChange={(v: 'N' | 'PE') => set({ pole: v })} options={[{ value: 'N', label: tr('중성선 바 (N)', 'Neutral bar (N)') }, { value: 'PE', label: tr('접지 바 (PE)', 'Earth bar (PE)') }]} />
              </Field>
              <Field label={tr('나사 수', 'Screws')} hint={tr('모두 한 막대에 이어져 있습니다', 'all on one bar')}>
                <NumberInput value={p.n ?? 6} min={2} max={40} onChange={(v) => set({ n: Math.max(2, v ?? 6) })} />
              </Field>
            </div>
          )}
          {(p.type === 'r_duct' || p.type === 'r_rail') && (
            <div className="grid2" title={tr('손잡이를 끌어도 됩니다', 'or drag the handle')}>
              <Field label={tr('길이 (칸)', 'Length (cells)')}>
                <NumberInput value={p.w ?? 16} min={2} max={400} step={1} onChange={(v) => set({ w: Math.max(2, Math.round(v ?? 16)) })} />
              </Field>
              {p.type === 'r_duct' && (
                <Field label={tr('폭 (칸)', 'Width (cells)')}>
                  <NumberInput value={p.h ?? 2} min={1} max={400} step={1} onChange={(v) => set({ h: Math.max(1, Math.round(v ?? 2)) })} />
                </Field>
              )}
            </div>
          )}
          {(p.type === 'lamp' || p.type === 'pb_no' || p.type === 'pb_nc' || p.type === 'r_lamp' || p.type === 'r_pb' || p.type === 'r_pbl') && (
            <Field label={tr('색', 'Colour')} wide>
              <Select value={p.color ?? (p.type === 'lamp' || p.type === 'r_lamp' ? 'red' : '')} onChange={(v) => set({ color: (v || undefined) as LampColor | undefined })} options={[...(p.type !== 'lamp' && p.type !== 'r_lamp' ? [{ value: '', label: '—' }] : []), ...(['red', 'green', 'yellow', 'white', 'blue'] as LampColor[]).map((x) => ({ value: x, label: lampColorName(x) }))]} />
            </Field>
          )}
          {PROX_TYPES.has(p.type) && (
            <div className="grid2">
              <Field label={tr('센서 종류', 'Sensor type')}>
                <Select value={p.sense ?? 'inductive'} onChange={(v) => set({ sense: v as Part['sense'] })} options={[{ value: 'inductive', label: tr('근접 (유도형, 금속)', 'Inductive (metal)') }, { value: 'capacitive', label: tr('근접 (정전용량형)', 'Capacitive') }, { value: 'photo', label: tr('광전 센서', 'Photoelectric') }]} />
              </Field>
              <Field label={tr('출력', 'Output')} hint={p.npn ? tr('감지하면 검정선이 0V 로 (부하는 +24V 쪽)', 'Black goes to 0V when detecting') : tr('감지하면 검정선이 +24V 로 (부하는 0V 쪽)', 'Black goes to +24V when detecting')}>
                <Select value={p.npn ? 'npn' : 'pnp'} onChange={(v) => set({ npn: v === 'npn' || undefined })} options={[{ value: 'pnp', label: 'PNP' }, { value: 'npn', label: 'NPN' }]} />
              </Field>
            </div>
          )}
          {p.type === 'r_sol' && (
            <div className="grid2">
              <Field label={tr('코일 전압', 'Coil voltage')}>
                <Select value={p.spec?.trim() || 'DC 24V'} onChange={(v) => set({ spec: v === 'DC 24V' ? undefined : v })} options={[...new Set(['DC 24V', 'DC 12V', 'AC 220V', 'AC 110V', p.spec?.trim() || 'DC 24V'])].map((v) => ({ value: v, label: v }))} />
              </Field>
              <Field label={tr('코일 결선', 'Coil connection')} hint={p.conn === 'din' ? tr('1 · 2 와 접지 PE', '1, 2 and earth (PE)') : tr('직류: 빨강 + · 검정 -', 'DC: red +, black -')}>
                <Select value={p.conn ?? 'lead'} onChange={(v) => set({ conn: v === 'din' ? 'din' : undefined })} options={[{ value: 'lead', label: tr('리드선 2가닥', 'Two lead wires') }, { value: 'din', label: tr('DIN 커넥터', 'DIN connector') }]} />
              </Field>
            </div>
          )}
          {p.type === 'r_prox2' && (
            <>
              <div className="grid2">
                <Field label={tr('전원', 'Supply')}>
                  <Select value={p.ac ? 'ac' : 'dc'} onChange={(v) => set({ ac: v === 'ac' || undefined })} options={[{ value: 'dc', label: tr('DC 12-24V (극성 있음)', 'DC 12-24V (polarised)') }, { value: 'ac', label: tr('AC 100-240V (극성 없음)', 'AC 100-240V (no polarity)') }]} />
                </Field>
                <Field label={tr('출력', 'Output')}>
                  <Select value={p.ncOut ? 'nc' : 'no'} onChange={(v) => set({ ncOut: v === 'nc' || undefined })} options={[{ value: 'no', label: tr('NO (감지하면 켜짐)', 'NO (on when detecting)') }, { value: 'nc', label: tr('NC (감지하면 꺼짐)', 'NC (off when detecting)') }]} />
                </Field>
              </div>
              <p className="small muted">{tr('갈색 · 파랑 두 선을 부하와 직렬로 (스위치처럼). 직류는 갈색이 + 쪽', 'Brown and blue in series with the load, like a switch. DC: brown on the + side')}</p>
            </>
          )}
          {(p.type === 'ls_no' || p.type === 'ls_nc') && (
            <Field label={tr('스위치 종류', 'Switch type')} wide>
              <Select value={p.sense ?? ''} onChange={(v) => set({ sense: (v || undefined) as Part['sense'] })} options={[{ value: '', label: tr('리밋 스위치 (롤러)', 'Limit switch (roller)') }, { value: 'inductive', label: tr('근접 센서 (2선식)', 'Proximity sensor (2-wire)') }, { value: 'reed', label: tr('리드 스위치 (실린더 센서)', 'Reed switch') }, { value: 'float', label: tr('플로트 스위치 (수위)', 'Float switch') }, { value: 'pressure', label: tr('압력 스위치', 'Pressure switch') }, { value: 'temp', label: tr('온도 스위치', 'Temperature switch') }]} />
            </Field>
          )}
          {(p.type === 'ls_no' || p.type === 'ls_nc' || p.type === 'r_ls' || p.type === 'r_prox2' || PROX_TYPES.has(p.type)) && p.sense !== 'temp' && (
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

const NO_ANALYSIS: PowerAnalysis = { shorted: false, cables: [], bare: [], loads: [], breakers: [], issues: [], supply: [], peakKw: 0, panels: [], wireI: new Map(), vll: 220 * Math.sqrt(3), vln: 220, system: '3p4w', systemText: '', transformers: [] };

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
function CableEditor({ circuit, ids, onChange: apply }: { circuit: Circuit; ids: string[]; onChange: (c: CableSpec | undefined, parallel: boolean) => void }) {
  // 같은 두 기기를 잇는 나란한 가닥 (3상의 나머지 두 가닥) 에도 함께 적용
  const [parallel, setParallel] = useState(true);
  const others = useMemo(() => parallelWires(circuit, ids).length - wireChain(circuit, ids).length, [circuit, ids]);
  const onChange = (c: CableSpec | undefined) => apply(c, parallel);
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
      {others > 0 && <Check checked={parallel} onChange={setParallel} label={tr(`같은 두 기기를 잇는 나란한 가닥 ${others}토막에도 함께 적용 (3상)`, `Also apply to the ${others} parallel wire(s) between the same devices (3-phase)`)} />}
      <p className="small muted">
        {tr(
          '규격을 정하면 [해석] 탭에서 이 선의 전류가 허용전류를 넘는지, 부하까지 전압강하가 얼마인지 검토합니다. 꺾여 이어진 한 가닥 전체에 적용됩니다.',
          'With a spec, the Analysis tab checks this wire against its ampacity and computes the voltage drop. The spec applies to the whole run.',
        )}
      </p>
    </div>
  );
}

/** 해석에 쓰는 정격: 부하 용량 · 역률, 차단기 정격 전류, 분전반 크기 */
/** 전원 계통 (3상 4선식 · 3상 3선식 · 단상 3선식 · 단상 2선식) 과 전압. 그림의 모든 전원 단자에 적용 */
function SupplyFields({ circuit, onChange }: { circuit: Circuit; onChange: (c: Circuit) => void }) {
  const sys = systemOf(circuit);
  const sv = systemVolts(circuit);
  const hint = (s: PowerSystem) => (s === '3p4w' ? '380/220 V' : s === '3p3w' ? '380 · 220 V' : s === '1p3w' ? '220/110 V' : '220 V');
  return (
    <div className="cc-supply">
      <div className="grid2">
        <Field label={tr('전원 계통', 'Supply system')}>
          <Select value={sys} onChange={(v) => onChange({ ...circuit, system: v === '3p4w' ? undefined : v, vll: undefined })} options={POWER_SYSTEMS.map((s) => ({ value: s, label: `${systemName(s)} (${hint(s)})` }))} />
        </Field>
        <Field label={voltFieldLabel(sys)}>
          <NumberInput value={circuit.vll ?? defaultVolt(sys)} min={1} step={10} onChange={(v) => onChange({ ...circuit, vll: v && v > 0 && v !== defaultVolt(sys) ? v : undefined })} />
        </Field>
      </div>
      <p className="small muted">
        {systemVoltText(sv)}. {tr('그림의 모든 전원 단자에 적용됩니다.', 'Applies to every supply terminal in this drawing.')}
      </p>
      <EarthingFields circuit={circuit} onChange={onChange} />
    </div>
  );
}

/** 계통 접지 방식 (TN · TT) 과 접지 저항: 누전 · 지락 계산에 쓴다 */
function EarthingFields({ circuit, onChange }: { circuit: Circuit; onChange: (c: Circuit) => void }) {
  const e = earthingOf(circuit);
  return (
    <>
      <div className="grid2">
        <Field label={tr('계통 접지 (누전 계산)', 'Earthing (fault calc.)')} hint={e.kind === 'TN' ? tr('기기 접지선이 변압기 중성점으로: 지락 = 단락처럼 큰 전류', 'Protective earth back to the transformer neutral: an earth fault is like a short') : tr('기기를 따로 접지: 지락 전류가 작아 누전차단기로 끊음', 'Frames earthed locally: small fault current, cleared by an RCD')}>
          <Select
            value={e.kind}
            onChange={(v: string) => onChange({ ...circuit, earthing: v === 'TT' ? 'TT' : undefined })}
            options={[
              { value: 'TN', label: tr('TN-C-S (특고압 수전 · 공장 · 빌딩)', 'TN-C-S (HV-fed plants, buildings)') },
              { value: 'TT', label: tr('TT (저압 수전 · 주택 · 작은 공장)', 'TT (LV-fed houses, small shops)') },
            ]}
          />
        </Field>
        {e.kind === 'TT' && (
          <div className="grid2">
            <Field label={tr('기기 접지 Ra (Ω)', 'Ra (Ω)')}>
              <NumberInput value={e.ra} min={0.1} step={10} onChange={(v) => onChange({ ...circuit, ra: v && v > 0 && v !== 100 ? v : undefined })} />
            </Field>
            <Field label={tr('계통 접지 Rb (Ω)', 'Rb (Ω)')}>
              <NumberInput value={e.rb} min={0.1} step={1} onChange={(v) => onChange({ ...circuit, rb: v && v > 0 && v !== 10 ? v : undefined })} />
            </Field>
          </div>
        )}
      </div>
    </>
  );
}

/** [해석] 의 지락 · 누전 검토: 기기마다 완전 지락이면 흐르는 전류 · 외함 전압 · 끊는 차단기, 누전차단기마다 평상시 누설 */
function EarthSection({ circuit, model, onPick }: { circuit: Circuit; model: CircuitModel; onPick: (parts: string[]) => void }) {
  const st = useMemo(() => earthStudy(circuit, model), [circuit, model]);
  if (!st.rows.length) return null;
  const amp = (x: number) => (x >= 1 ? `${x.toFixed(x >= 100 ? 0 : 1)} A` : `${Math.round(x * 1000)} mA`);
  const verdict = (r: EarthRow) => (r.r.level === 'danger' ? tr('위험', 'Danger') : r.r.level === 'ok' ? tr('끊김', 'Cleared') : tr('누설', 'Leak'));
  return (
    <div className="cc-earth">
      <h4>{tr('누전 · 지락 검토', 'Earth faults')}</h4>
      <p className="small muted">
        {tr(
          `기기마다 충전부가 외함에 완전히 닿았다고 (절연 0 Ω) 보고, 접지로 흐르는 전류와 외함 전압, 끊는 차단기를 어림합니다 (${st.kind === 'TN' ? `TN: 고장 루프 ${ZLOOP_TN} Ω` : `TT: Ra ${st.ra} Ω · Rb ${st.rb} Ω`}, 사람 몸 ${BODY_OHM} Ω, 순시 트립 = 정격 × 10). 시뮬레이션에서는 기기를 Shift+클릭하거나 조작 순서에 [누전] 을 넣어 봅니다.`,
          `Assumes a solid fault (0 Ω) from live parts to the frame of each device: earth current, frame voltage and the breaker that clears it (${st.kind === 'TN' ? `TN: loop ${ZLOOP_TN} Ω` : `TT: Ra ${st.ra} Ω · Rb ${st.rb} Ω`}, body ${BODY_OHM} Ω, instantaneous trip = 10 × In). In the simulation Shift+click a device or add an [Earth fault] step.`,
        )}
      </p>
      <table className="cc-table">
        <thead>
          <tr>
            <th>{tr('기기', 'Device')}</th>
            <th>{tr('지락 전류', 'Fault I')}</th>
            <th>{tr('외함', 'Frame')}</th>
            <th>{tr('결과', 'Result')}</th>
          </tr>
        </thead>
        <tbody>
          {st.rows.map((row) => (
            <tr key={row.part.id} className={row.r.level === 'danger' ? 'bad' : ''} onClick={() => onPick([row.part.id])} title={row.text}>
              <td className="mono">
                <b>{row.name}</b>
                {row.part.name && <div className="small muted">{row.part.name}</div>}
                {!row.r.earthed && <div className="small cc-bad">{tr('외함 접지 없음', 'frame not earthed')}</div>}
              </td>
              <td className="num">{row.r.earthed ? amp(row.r.ifA) : <span className="small">{tr(`만지면 ${Math.round(row.r.bodyMa ?? 0)} mA`, `touch ${Math.round(row.r.bodyMa ?? 0)} mA`)}</span>}</td>
              <td className="num">{Math.round(row.r.touchV)} V</td>
              <td className={row.r.level === 'danger' ? 'cc-bad' : row.r.level === 'ok' ? 'cc-good' : 'muted'}>
                {row.r.trip ? `${row.r.trip.part.tag} ${row.r.trip.why === 'rcd' ? tr('누전 트립', 'RCD trip') : tr('순시 트립', 'instant trip')}` : row.r.touchTrip ? tr(`${row.r.touchTrip.tag} (만질 때)`, `${row.r.touchTrip.tag} (on touch)`) : verdict(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.rows
        .filter((r) => r.r.level === 'danger')
        .map((r) => (
          <p key={r.part.id} className="small cc-bad">
            {r.text}
          </p>
        ))}
      {st.leaks.length > 0 && (
        <>
          <div className="field-label">{tr('누전차단기마다 평상시 누설 전류 (어림)', 'Standing leakage per RCD (estimate)')}</div>
          <table className="cc-table">
            <tbody>
              {st.leaks.map((l) => {
                const bad = l.ma > l.idnMa * 0.3;
                return (
                  <tr key={l.part.id} className={bad ? 'bad' : ''} onClick={() => onPick([l.part.id])}>
                    <td className="mono">
                      <b>{l.part.tag}</b> <span className="small muted">{l.idnMa} mA</span>
                    </td>
                    <td className="num">{l.ma} mA</td>
                    <td className="small">{bad ? tr(`감도의 30% (${Math.round(l.idnMa * 0.3)} mA) 를 넘어 이유 없이 떨어질 수 있음 → 회로를 나누세요`, `over 30% of the rating (${Math.round(l.idnMa * 0.3)} mA): nuisance trips likely — split the circuit`) : l.devices.join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">{tr('전동기 · 케이블의 정전 용량, SMPS 노이즈 필터로 평상시에도 접지로 조금씩 샙니다. 합이 감도의 30% 를 넘지 않게 회로를 나눕니다 (실제 값은 누설 전류계로 재세요).', 'Motors, cables and SMPS filters leak a little to earth all the time; keep the total under 30% of the RCD rating (measure with a leakage clamp).')}</p>
        </>
      )}
    </div>
  );
}

function RatingFields({ p, set, circuit }: { p: Part; set: (patch: Partial<Part>) => void; circuit: Circuit }) {
  const big = p.type === 'r_load1' || p.type === 'r_load3' || p.type === 'r_motor3' || p.type === 'motor3' || p.type === 'motor';
  const motor = p.type === 'r_motor3' || p.type === 'motor3' || p.type === 'motor';
  const three = p.type === 'r_load3' || p.type === 'r_motor3' || p.type === 'motor3';
  const r = loadRating(p);
  if (p.type === 'r_panel')
    return (
      <div className="grid2" title={tr('오른쪽 아래 모서리 손잡이를 끌어도 됩니다', 'or drag the bottom-right handle')}>
        <Field label={tr('가로 (칸)', 'Width (cells)')}>
          <NumberInput value={p.w ?? 20} min={4} max={400} step={1} onChange={(v) => set({ w: Math.max(4, Math.round(v ?? 20)) })} />
        </Field>
        <Field label={tr('세로 (칸)', 'Height (cells)')}>
          <NumberInput value={p.h ?? 20} min={4} max={400} step={1} onChange={(v) => set({ h: Math.max(4, Math.round(v ?? 20)) })} />
        </Field>
      </div>
    );
  if (p.type === 'r_bus') {
    const { bars, len } = busSize(p);
    return (
      <>
        <div className="grid2">
          <Field label={tr('막대 수', 'Bars')}>
            <Select value={String(bars) as '3' | '4'} onChange={(v) => set({ bars: v === '3' ? 3 : 4 })} options={[{ value: '4', label: tr('4극 (L1 L2 L3 N)', '4 (L1 L2 L3 N)') }, { value: '3', label: tr('3극 (L1 L2 L3)', '3 (L1 L2 L3)') }]} />
          </Field>
          <Field label={tr('길이 (칸)', 'Length (cells)')} hint={tr('아래 끝 손잡이를 끌어도 됩니다', 'or drag the bottom handle')}>
            <NumberInput value={len} min={2} max={400} step={1} onChange={(v) => set({ h: Math.max(2, Math.round(v ?? 20)) })} />
          </Field>
          <Field label={tr('단면적 (mm²)', 'Section (mm²)')} hint={tr('예: 20 × 5 = 100', 'e.g. 20 × 5 = 100')}>
            <NumberInput value={p.mm2 ?? 100} min={1} step={10} onChange={(v) => set({ mm2: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label={tr('정격 전류 (A)', 'Rated current (A)')} hint={tr('제조사 표의 값', 'from the maker table')}>
            <NumberInput value={p.amps} min={1} step={10} onChange={(v) => set({ amps: v && v > 0 ? v : undefined })} />
          </Field>
        </div>
        <p className="small muted">
          {tr(
            '분기선 끝을 막대 위에 대면 그 상에 이어집니다 (볼트 점). 막대 위를 끌면 그 자리에서 분기선이 시작됩니다. 부스바를 옮기면 물린 분기선도 따라옵니다.',
            'A wire end on a bar connects to that phase (bolt dot). Drag from a bar to start a branch wire. Moving the busbar keeps its branch wires attached.',
          )}
        </p>
      </>
    );
  }
  if (p.type === 'r_kepco') {
    const kv = p.kv ?? 22.9;
    const ka = p.ka ?? 12.5;
    return (
      <>
        <div className="grid2">
          <Field label={tr('수전 전압 (kV)', 'Supply voltage (kV)')}>
            <NumberInput value={kv} min={0.1} step={0.1} onChange={(v) => set({ kv: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label={tr('수전점 단락 전류 (kA)', 'Fault current at supply (kA)')} hint={tr('한전과 협의한 값. 모르면 12.5 kA', 'from the utility; 12.5 kA if unknown')}>
            <NumberInput value={ka} min={0.1} step={0.5} onChange={(v) => set({ ka: v && v > 0 ? v : undefined })} />
          </Field>
        </div>
        <p className="small muted">
          {tr(`단락 용량 ${Math.round(Math.sqrt(3) * kv * ka)} MVA. 특고압 세 상 (A B C) 이 VCB 를 거쳐 변압기 1차 (H1 H2 H3) 에 닿으면 변압기 2차에 저압이 나옵니다.`, `Fault level ${Math.round(Math.sqrt(3) * kv * ka)} MVA. When A B C reach the transformer primary through the VCB, the secondary is live.`)}
        </p>
      </>
    );
  }
  if (p.type === 'r_tr3') {
    const sv = systemVolts(circuit);
    const utility = circuit.parts.find((q) => q.type === 'r_kepco') ?? null;
    const kva = p.kva ?? 500;
    const kv1 = p.kv ?? utility?.kv ?? 22.9;
    const z = trImpedance(p, sv.vll, utility);
    const zt = Math.hypot(z.tr[0] + z.utility[0], z.tr[1] + z.utility[1]);
    const i2n = (kva * 1000) / (Math.sqrt(3) * sv.vll);
    return (
      <>
        <div className="grid2">
          <Field label={tr('용량 (kVA)', 'Rating (kVA)')}>
            <NumberInput value={kva} min={1} step={50} onChange={(v) => set({ kva: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label={tr('1차 전압 (kV)', 'Primary (kV)')}>
            <NumberInput value={kv1} min={0.1} step={0.1} onChange={(v) => set({ kv: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label={tr('%임피던스 (%Z)', 'Impedance (%Z)')} hint={tr('명판 값. 유입 500 kVA 쯤 5 %, 몰드 6 %', 'from the nameplate')}>
            <NumberInput value={p.z ?? 5} min={0.5} max={30} step={0.5} onChange={(v) => set({ z: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label="X/R" hint={tr('모르면 5', '5 if unknown')}>
            <NumberInput value={p.xr ?? 5} min={0.1} step={0.5} onChange={(v) => set({ xr: v && v > 0 ? v : undefined })} />
          </Field>
        </div>
        <p className="small muted">
          {tr(
            `2차: ${systemLabel(sv)} (전원 계통 설정을 따름, X0 = 중성점). 정격 전류 1차 ${((kva * 1000) / (Math.sqrt(3) * kv1 * 1000)).toFixed(1)} A · 2차 ${i2n.toFixed(0)} A. 2차 단자 단락 전류 약 ${(sv.vll / Math.sqrt(3) / zt / 1000).toFixed(1)} kA (한전 계통 + 변압기).`,
            `Secondary: ${systemLabel(sv)} (follows the supply system; X0 = neutral). Rated current ${((kva * 1000) / (Math.sqrt(3) * kv1 * 1000)).toFixed(1)} A / ${i2n.toFixed(0)} A. Fault current at the secondary about ${(sv.vll / Math.sqrt(3) / zt / 1000).toFixed(1)} kA.`,
          )}
        </p>
      </>
    );
  }
  if (isBreaker(p))
    return (
      <>
        <div className="grid2">
          <Field label={tr('정격 전류 (A)', 'Rated current (A)')} hint={tr('흐르는 전류 · 전선 허용전류와 비교', 'vs current and cable ampacity')}>
            <NumberInput value={breakerAmps(p) ?? undefined} min={1} step={1} onChange={(v) => set({ amps: v && v > 0 ? v : undefined })} />
          </Field>
          <Field label={tr('차단 용량 (kA)', 'Breaking capacity (kA)')} hint={tr('설치점 단락 전류와 비교 (변압기가 있을 때)', 'vs the fault current (with a transformer)')}>
            <NumberInput value={p.ka} allowEmpty min={0.5} step={5} placeholder="—" onChange={(v) => set({ ka: v && v > 0 ? v : undefined })} />
          </Field>
        </div>
        {p.type.startsWith('r_mcb') && p.type !== 'r_mcb1' && <Check checked={!!p.elb} onChange={(v) => set({ elb: v || undefined })} label={tr('누전차단기 (ELB)', 'Earth leakage breaker (ELB)')} />}
        {p.elb && (
          <Field label={tr('정격 감도 전류 (mA)', 'Rated residual current (mA)')} hint={tr('접지로 새는 전류가 이 이상이면 0.03 초 안에 끊습니다 (사람 보호 30 mA)', 'Trips within 0.03 s when the earth leakage reaches this (30 mA protects people)')}>
            <Select value={String(p.idn ?? 30)} onChange={(v: string) => set({ idn: v === '30' ? undefined : Number(v) })} options={['15', '30', '100', '200', '500'].map((x) => ({ value: x, label: `${x} mA` }))} />
          </Field>
        )}
      </>
    );
  if (!big && p.type !== 'r_light') return null;
  // 정격 전압을 적지 않으면 전원 계통의 보통 전압 (3상은 선간, 단상은 3상 4선식이면 L-N, 3상 3선식이면 선간)
  const sv = systemVolts(circuit);
  const volt = p.volt ?? (three ? sv.vll : sv.v1);
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
        {big && (
          <Field label={tr('정격 전압 (V)', 'Rated voltage (V)')} hint={tr('비우면 이어진 전원에 맞춤. 적으면 다른 전압에 이었을 때 알려 줍니다', 'Empty: follows the supply. Set it to be warned about a wrong voltage')}>
            <NumberInput value={p.volt} allowEmpty min={1} step={10} placeholder={String(nominalVolt(volt))} onChange={(v) => set({ volt: v && v > 0 ? v : undefined })} />
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

/** PLC 프로그램을 래더로 (시뮬레이션 중이면 켜진 접점 · 코일을 칠한다) */
function PlcMonitor({ monitor }: { monitor?: (dev: string) => boolean | null }) {
  const plc = useStore((s) => s.project.plc);
  const ld = useMemo(() => {
    if (!plc || (plc.dialect !== 'mitsubishi' && plc.dialect !== 'ls')) return null;
    if (plc.view === 'ladder') {
      const l = readLadder(plc.ladder);
      if (l) return l;
    }
    return plc.source.trim() ? ilToLadder(plc.source, plc.dialect).ladder : null;
  }, [plc]);
  const comments = useMemo(() => {
    const m = new Map<string, string>();
    if (plc) for (const [k, v] of parseDeviceComments(plc.comments, plc.dialect)) m.set(k.toUpperCase(), v);
    return m;
  }, [plc]);
  if (!ld || !plc) return null;
  return (
    <div className="cc-ld-monitor">
      <div className="field-label">{monitor ? tr('PLC 래더 모니터 (켜진 접점 · 코일을 칠함)', 'PLC ladder monitor (ON contacts and coils filled)') : tr('PLC 프로그램 (래더)', 'PLC program (ladder)')}</div>
      <LadderEditor ladder={ld} dialect={plc.dialect as 'mitsubishi' | 'ls'} comments={comments} readOnly monitor={monitor} scale={0.8} />
    </div>
  );
}

function PlcProps({ p, set, model, monitor }: { p: Part; set: (patch: Partial<Part>) => void; model: CircuitModel; monitor?: (dev: string) => boolean | null }) {
  const plc = useStore((s) => s.project.plc);
  const { ins, outs } = plcAddresses(p);
  const real = p.type === 'r_plc';
  return (
    <>
      <div className="grid2">
        <Field label={tr('기호', 'Tag')}>
          <TagInput value={p.tag} onChange={(v) => set({ tag: v.trim() })} />
        </Field>
        <Field label={tr('설명', 'Description')}>
          <TagInput value={p.name ?? ''} onChange={(v) => set({ name: v || undefined })} placeholder="FX3U, XGB …" />
        </Field>
        <Field label={tr('입력 첫 주소', 'First input')} hint={`${ins[0]} ~ ${ins[ins.length - 1]}`}>
          <TagInput value={p.inBase ?? ''} onChange={(v) => set({ inBase: v.trim() || undefined })} placeholder="X0" />
        </Field>
        <Field label={tr('출력 첫 주소', 'First output')} hint={`${outs[0]} ~ ${outs[outs.length - 1]}`}>
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
        {real
          ? tr('+ · − 에 DC 24V 가 들어와야 돕니다 (끊겼다 들어오면 처음부터). 입력은 COM 과 반대 극이 닿으면 ON (COM = 0V 면 싱크). 출력은 COM0 (0~7) · COM1 (8~15) 과 이어지는 릴레이 접점입니다. 전자접촉기 코일은 보조 릴레이를 거쳐 움직이세요.', 'Runs only with 24 V DC on + and − (restarts after a power loss). An input is ON with the opposite pole of COM (COM = 0V: sink). Outputs are relay contacts to COM0 (0–7) and COM1 (8–15). Drive contactor coils through interposing relays.')
          : tr('입력 단자에 +24V 나 L 이 닿으면 ON. 출력은 공통 C 와 Q 사이의 릴레이 접점입니다. 프로그램은 PLC 시뮬레이션 탭의 것을 스캔마다 실행합니다.', 'An input is ON when +24V or L reaches it. Outputs are relay contacts between C and Q. The PLC tab program runs every scan.')}
      </p>
      <p className={`small ${model.prog ? 'muted' : 'cc-bad'}`}>
        {model.prog && plc
          ? tr(`프로그램: ${dialectName(plc.dialect)} · ${model.prog.size}개 명령 · 스캔 ${formatTime(plc.sim.scanTime, 'ms')}`, `Program: ${dialectName(plc.dialect)} · ${model.prog.size} instructions · scan ${formatTime(plc.sim.scanTime, 'ms')}`)
          : tr('PLC 프로그램이 없습니다.', 'No PLC program yet.')}{' '}
        <button type="button" className="linkish" onClick={() => useStore.getState().setTab('plc')}>
          {tr('PLC 탭에서 프로그램 열기 (니모닉 · 래더)', 'Open the PLC tab (mnemonic / ladder)')}
        </button>
      </p>
      <PlcMonitor monitor={monitor} />
    </>
  );
}

/** HMI: 화면 칸 (버튼 · 스위치 · 램프) 과 PLC 디바이스 */
function HmiProps({ p, set, model }: { p: Part; set: (patch: Partial<Part>) => void; model: CircuitModel }) {
  const items = p.hmi ?? [];
  const plc = useStore((s) => s.project.plc);
  const setItem = (n: number, patch: Partial<HmiItem>) => set({ hmi: items.map((it, k) => (k === n ? { ...it, ...patch } : it)) });
  const ls = plc?.dialect === 'ls';
  return (
    <>
      <div className="grid2">
        <Field label={tr('기호', 'Tag')}>
          <TagInput value={p.tag} onChange={(v) => set({ tag: v.trim() })} />
        </Field>
        <Field label={tr('설명', 'Description')}>
          <TagInput value={p.name ?? ''} onChange={(v) => set({ name: v || undefined })} placeholder={tr('운전 화면', 'Main screen')} />
        </Field>
      </div>
      <div className="field-label">{tr('화면 칸 (3열, 최대 12)', 'Screen items (3 columns, up to 12)')}</div>
      <div className="cc-hmi-items">
        {items.map((it, n) => (
          <div key={n} className="cc-hmi-row">
            <span className="mono small muted" title={tr('조작 순서에서 쓰는 이름', 'Name used in the operation list')}>
              {it.kind === 'lamp' ? '' : hmiTag(p, n)}
            </span>
            <select className="input" value={it.kind} onChange={(e) => setItem(n, { kind: e.target.value as HmiItem['kind'] })}>
              <option value="btn">{tr('버튼 (누르는 동안)', 'Button (momentary)')}</option>
              <option value="sw">{tr('스위치 (누를 때마다)', 'Switch (toggle)')}</option>
              <option value="lamp">{tr('램프 (표시)', 'Lamp (indicator)')}</option>
            </select>
            <input className="input" value={it.label} placeholder={tr('글', 'Label')} onChange={(e) => setItem(n, { label: e.target.value })} />
            <input className="input mono" value={it.dev} placeholder={ls ? 'M00100' : 'M100'} onChange={(e) => setItem(n, { dev: e.target.value.toUpperCase() })} />
            <select className="input" value={it.color ?? ''} onChange={(e) => setItem(n, { color: (e.target.value || undefined) as LampColor | undefined })}>
              <option value="">{tr('색', 'Colour')}</option>
              {(['green', 'red', 'yellow', 'blue', 'white'] as LampColor[]).map((c) => (
                <option key={c} value={c}>
                  {lampColorName(c)}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={() => set({ hmi: items.filter((_, k) => k !== n) })} title={tr('지우기', 'Remove')}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="cc-btnrow">
        <button type="button" className="btn small" disabled={items.length >= HMI_MAX} onClick={() => set({ hmi: [...items, { kind: 'btn', label: tr('버튼', 'Button'), dev: '' }] })}>
          + {tr('버튼', 'Button')}
        </button>
        <button type="button" className="btn small" disabled={items.length >= HMI_MAX} onClick={() => set({ hmi: [...items, { kind: 'lamp', label: tr('램프', 'Lamp'), dev: '', color: 'green' }] })}>
          + {tr('램프', 'Lamp')}
        </button>
      </div>
      <p className="small muted">
        {tr('버튼 · 스위치는 PLC 의 내부 릴레이 (M) 에 쓰고, 램프는 아무 디바이스 (출력 · M) 나 읽습니다. 전원 + · − (DC 24V) 만 배선하고 PLC 와는 통신으로 이어집니다. 조작 순서에서는 왼쪽의 이름 (HMI1-1 …) 을 고릅니다.', 'Buttons and switches write PLC internal relays (M); lamps read any device. Only + and − (24 V DC) are wired; the PLC link is by communication. Use the names on the left (HMI1-1 …) in the operation list.')}
      </p>
      {!model.plcs.length && <p className="small cc-bad">{tr('회로에 PLC 가 없습니다. HMI 는 PLC 와 함께 씁니다.', 'There is no PLC in the circuit; the HMI needs one.')}</p>}
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

/** 온도 기기 속성: 설정 · 히스테리시스 · 경보 · 동작, 온도가 바뀌는 방식 (묶음 · 연결 부하 · 속도) */
function TempProps({ p, circuit, set }: { p: Part; circuit: Circuit; set: (patch: Partial<Part>) => void }) {
  const { sv, hys } = tempSetting(p);
  const loads = [...new Set(circuit.parts.filter((q) => PARTS[q.type].load && !PARTS[q.type].selfCoil && q.type !== 'coil' && q.type !== 'timer' && q.type !== 'r_tc' && q.type !== 'r_counter' && q.tag.trim()).map((q) => q.tag.trim()))];
  const tc = p.type === 'r_tc';
  return (
    <>
      <div className="grid2">
        <Field label={tr('설정 온도 (℃)', 'Set point (℃)')}>
          <NumberInput value={sv} min={-100} max={2000} step={1} onChange={(v) => v !== undefined && set({ sv: v })} />
        </Field>
        <Field label={tr('히스테리시스 (℃)', 'Hysteresis (℃)')} hint={tr('설정에서 이만큼 내려가야 되돌아갑니다', 'Returns once it drops this far below the set point')}>
          <NumberInput value={hys} min={0.1} max={500} step={1} onChange={(v) => v !== undefined && set({ hys: v })} />
        </Field>
        {tc && (
          <>
            <Field label={tr('제어 동작', 'Control action')}>
              <Select value={p.tcMode ?? 'heat'} onChange={(v: 'heat' | 'cool') => set({ tcMode: v === 'cool' ? 'cool' : undefined })} options={[{ value: 'heat', label: tr('가열 (설정보다 낮으면 OUT)', 'Heating (OUT below set)') }, { value: 'cool', label: tr('냉각 (설정 이상이면 OUT)', 'Cooling (OUT above set)') }]} />
            </Field>
            <Field label={tr('경보 온도 AL (℃)', 'Alarm AL (℃)')} hint={tr('이 온도 이상이면 C2-AL 닫힘. 비우면 경보 없음', 'C2-AL closes at or above this. Empty = no alarm')}>
              <NumberInput value={p.alarm} allowEmpty placeholder={tr('없음', 'none')} min={-100} max={2000} step={1} onChange={(v) => set({ alarm: v })} />
            </Field>
          </>
        )}
        {p.type === 'r_thermo' && (
          <Field label={tr('접점', 'Contact')} wide>
            <Select value={p.ncOut ? 'nc' : 'no'} onChange={(v) => set({ ncOut: v === 'nc' || undefined })} options={[{ value: 'nc', label: tr('NC: 오르면 열림 (히터 · 난방)', 'NC: opens on rise (heater)') }, { value: 'no', label: tr('NO: 오르면 닫힘 (팬 · 냉방)', 'NO: closes on rise (fan)') }]} />
          </Field>
        )}
      </div>
      <p className="small muted">
        {tc
          ? tr(`A1 · A2 전원. ${p.tcMode === 'cool' ? `${sv}℃ 이상이면 C1-OUT 닫힘, ${sv - hys}℃ 이하로 내려가면 열림` : `${sv - hys}℃ 이하이면 C1-OUT 닫힘 (히터 켜짐), ${sv}℃ 에 닿으면 열림`}. 단자 번호는 기종마다 다르니 기기 옆면 결선도를 따르세요`, `Power A1/A2. ${p.tcMode === 'cool' ? `C1-OUT closes at ${sv}℃ and opens at ${sv - hys}℃` : `C1-OUT closes at ${sv - hys}℃ and opens at ${sv}℃`}. Terminal numbers differ by model`)
          : tr(`${sv}℃ 에 닿으면 접점이 바뀌고 ${sv - hys}℃ 까지 내려가야 되돌아갑니다. 전원이 필요 없는 무전압 접점입니다`, `Switches at ${sv}℃ and back at ${sv - hys}℃. Dry contact, no supply needed`)}
      </p>
      <div className="field-label" style={{ marginTop: 8 }}>
        {tr('시뮬레이션의 온도', 'Temperature in the simulation')}
      </div>
      <div className="grid2">
        <Field label={tr('온도를 바꾸는 부하', 'Load that changes it')} hint={tr('비우면 조작 순서 (온도 →) 나 시뮬레이션 중 기기를 눌러서만 바뀜', 'Empty: only operation steps or clicks change it')}>
          <Select value={p.tLoad ?? ''} onChange={(v) => set({ tLoad: v || undefined })} options={[{ value: '', label: tr('(없음)', '(none)') }, ...loads.map((t) => ({ value: t, label: t }))]} />
        </Field>
        {p.tLoad && (
          <Field label={tr('그 부하가', 'That load')}>
            <Select value={p.tLoadCool ? 'cool' : 'heat'} onChange={(v) => set({ tLoadCool: v === 'cool' || undefined })} options={[{ value: 'heat', label: tr('데운다 (히터)', 'heats (heater)') }, { value: 'cool', label: tr('식힌다 (팬 · 냉방)', 'cools (fan)') }]} />
          </Field>
        )}
        <Field label={tr('처음 · 주위 온도 (℃)', 'Start / ambient (℃)')}>
          <NumberInput value={p.amb ?? 20} min={-100} max={2000} step={1} onChange={(v) => v !== undefined && set({ amb: v })} />
        </Field>
        {p.tLoad && (
          <>
            <Field label={tr('최고 온도 (℃)', 'Maximum (℃)')} hint={tr('비우면 설정 + 20℃', 'Empty: set point + 20℃')}>
              <NumberInput value={p.tmax} allowEmpty placeholder={tr('자동', 'auto')} min={-100} max={2000} step={1} onChange={(v) => set({ tmax: v })} />
            </Field>
            <Field label={tr('오르는 속도 (℃/초)', 'Rise (℃/s)')}>
              <NumberInput value={p.rise ?? 1} min={0.001} max={1000} step={0.1} onChange={(v) => v !== undefined && set({ rise: v })} />
            </Field>
            <Field label={tr('내리는 속도 (℃/초)', 'Fall (℃/s)')}>
              <NumberInput value={p.fall ?? 0.5} min={0.001} max={1000} step={0.1} onChange={(v) => v !== undefined && set({ fall: v })} />
            </Field>
          </>
        )}
        <Field label={tr('온도 묶음 이름', 'Zone name')} hint={tr('같은 이름의 온도 기기는 같은 온도를 잽니다 (예: 판넬). 비우면 이 기기만', 'Devices with the same name read the same temperature')}>
          <TagInput value={p.zone ?? ''} onChange={(v) => set({ zone: v || undefined })} placeholder={tr('(이 기기만)', '(this one)')} />
        </Field>
      </div>
    </>
  );
}

function OpsPane({ circuit, model, res, onChange }: { circuit: Circuit; model: CircuitModel; res: ScenarioResult | null; onChange: (c: Circuit, key?: string) => void }) {
  const ops = circuit.ops;
  const devices = model.operable().map((t) => {
    const p = model.mainPart.get(t)!;
    const name = model.hmiDef.get(t) ? `HMI ${model.hmiDef.get(t)!.label}` : circuit.parts.find((q) => tagKey(q) === t && q.name)?.name;
    return { value: model.label(t), label: `${model.label(t)}${name ? `  ${name}` : ''}`, momentary: model.momentary(t), sel3: p.type === 'r_ss3' ? p : undefined, temp: model.tagKind.get(t) === 'temp' ? p : undefined, leak: false };
  });
  // 누전을 일으킬 수 있는 기기 (전동기 · 히터 · 콘센트 …): 동작은 누전 하나
  for (const [t, d] of model.faultDev) {
    if (devices.some((x) => normTag(x.value) === t)) continue;
    devices.push({ value: model.label(t), label: `${model.label(t)}  ${d.part.name ?? ''} · ${tr('누전', 'fault')}`, momentary: false, sel3: undefined, temp: undefined, leak: true });
  }
  const setOps = (next: OpStep[]) => onChange({ ...circuit, ops: next });
  const setOp = (i: number, patch: Partial<OpStep>) => setOps(ops.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const add = () => {
    const used = new Set(ops.map((o) => normTag(o.tag)));
    const d = devices.find((x) => !x.leak && !used.has(normTag(x.value))) ?? devices.find((x) => !x.leak) ?? devices[0];
    if (d?.leak) {
      setOps([...ops, { id: uid('op'), wait: ops.length ? 2000 : 500, tag: d.value, action: 'leak', value: 0, hold: 0 }]);
      return;
    }
    if (d?.temp) {
      setOps([...ops, { id: uid('op'), wait: ops.length ? 2000 : 500, tag: d.value, action: 'temp', value: tempSetting(d.temp).sv + 5, hold: 0 }]);
      return;
    }
    setOps([...ops, { id: uid('op'), wait: ops.length ? 2000 : 500, tag: d?.value ?? '', action: d?.sel3 ? 'right' : d && !d.momentary ? 'on' : 'press', hold: 300 }]);
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
            const sel3 = devices.find((d) => normTag(d.value) === normTag(o.tag))?.sel3;
            const tempDev = devices.find((d) => normTag(d.value) === normTag(o.tag))?.temp;
            const leakDev = devices.find((d) => normTag(d.value) === normTag(o.tag))?.leak;
            return (
              <div className="cc-op" key={o.id}>
                <div className="cc-op-top">
                  <span className="cc-op-n">{i + 1}</span>
                  <select
                    className={`input ${known ? '' : 'bad'}`}
                    value={o.tag}
                    onChange={(e) => {
                      // 온도 기기로 바꾸면 동작도 온도로 (반대로도)
                      const d = devices.find((x) => x.value === e.target.value);
                      if (d?.leak) setOp(i, { tag: e.target.value, action: 'leak', value: o.action === 'leak' ? o.value : 0, hold: o.action === 'leak' ? o.hold : 0 });
                      else if (d?.temp) setOp(i, { tag: e.target.value, action: 'temp', value: o.value ?? tempSetting(d.temp).sv + 5, hold: o.action === 'temp' ? o.hold : 0 });
                      else setOp(i, { tag: e.target.value, ...(o.action === 'temp' || o.action === 'leak' ? { action: d?.sel3 ? 'right' : d && !d.momentary ? 'on' : 'press', hold: 300, value: undefined } : {}) });
                    }}
                    aria-label={tr('기기', 'Device')}
                  >
                    {!devices.some((d) => d.value === o.tag) && <option value={o.tag}>{o.tag || '—'} ?</option>}
                    {devices.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <select className="input cc-op-act" value={o.action} onChange={(e) => setOp(i, { action: e.target.value as OpStep['action'] })} aria-label={tr('동작', 'Action')}>
                    {leakDev ? (
                      <option value="leak">{tr('누전 (절연 불량)', 'Earth fault')}</option>
                    ) : tempDev ? (
                      <option value="temp">{tr('온도 →', 'Temp. →')}</option>
                    ) : sel3 ? (
                      <>
                        <option value="left">{opActionLabel('left', sel3)}</option>
                        <option value="off">{opActionLabel('off', sel3)}</option>
                        <option value="right">{opActionLabel('right', sel3)}</option>
                        {o.action === 'press' && <option value="press">{tr('누름→뗌', 'Press')}</option>}
                      </>
                    ) : (
                      <>
                        <option value="press">{tr('누름→뗌', 'Press')}</option>
                        <option value="on">{tr('ON 유지', 'ON')}</option>
                        <option value="off">OFF</option>
                        {(o.action === 'left' || o.action === 'right') && <option value={o.action}>{opActionLabel(o.action)}</option>}
                      </>
                    )}
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
                  {o.action === 'leak' && (
                    <>
                      <label title={tr('충전부와 외함 사이의 절연 저항 (0 = 완전히 닿음, 10 kΩ 쯤이면 약 22 mA 누설)', 'Insulation resistance between live parts and the frame (0 = solid contact; about 10 kΩ leaks 22 mA)')}>
                        {tr('절연', 'Insul.')} Ω <NumberInput value={o.value ?? 0} min={0} max={1e8} step={100} onChange={(v) => v !== undefined && setOp(i, { value: Math.max(0, v) })} />
                      </label>
                      <label title={tr('누전이 이어지는 시간 (0 = 끝까지)', 'How long the fault lasts (0 = to the end)')}>
                        {tr('지속', 'Lasts')} <TimeInput value={o.hold} onChange={(v) => v !== undefined && setOp(i, { hold: v })} />
                      </label>
                    </>
                  )}
                  {o.action === 'temp' && (
                    <>
                      <label title={tr('바꿀 온도', 'Target temperature')}>
                        ℃ <NumberInput value={o.value ?? 20} min={-100} max={2000} step={1} onChange={(v) => v !== undefined && setOp(i, { value: v })} />
                      </label>
                      <label title={tr('이 시간 동안 일정하게 바뀜 (0 = 바로)', 'Changes evenly over this time (0 = at once)')}>
                        {tr('걸림', 'Over')} <TimeInput value={o.hold} onChange={(v) => v !== undefined && setOp(i, { hold: v })} />
                      </label>
                    </>
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
        <Field label={tr('릴레이 동작 시간 (ms)', 'Relay operate time (ms)')} hint={tr('0 = 바로 붙음 (이상적). 실제 릴레이 · 전자접촉기는 10~30 ms. 넣으면 접점이 바뀌는 순간의 짧은 끊김이 보입니다', '0 = instant. Real relays and contactors take 10–30 ms; set it to see brief drop-outs')}>
          <NumberInput value={circuit.relayMs ?? 0} min={0} max={1000} step={5} onChange={(v) => onChange({ ...circuit, relayMs: v && v > 0 ? Math.min(1000, v) : undefined })} />
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
function PowerPane({ circuit, a, onChange, onPick, onAuto, title }: { circuit: Circuit; a: PowerAnalysis; onChange: (c: Circuit) => void; onPick: (parts: string[], wires: string[]) => void; onAuto: (assign: boolean) => void; title: string }) {
  const major = a.loads.filter((l) => !l.minor);
  const minor = a.loads.filter((l) => l.minor);
  const errors = a.issues.filter((i) => i.level === 'error').length;
  const fmtI = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(3));
  const loadRows = (rows: PowerAnalysis['loads']) =>
    rows.map((r) => {
      const bad = r.dropPct !== null && r.dropPct > r.limit;
      return (
        <tr key={r.partId} className={bad ? 'bad' : ''} onClick={() => onPick([r.partId], [])}>
          <td className="mono">
            <b>{r.tag}</b>
            {r.name && <div className="small muted">{r.name}</div>}
          </td>
          <td className="num">{r.watt >= 1000 ? `${Math.round(r.watt / 10) / 100} kW` : `${Math.round(r.watt * 10) / 10} W`}</td>
          <td className="num">{r.on ? fmtI(r.i) : <span className="muted small">{tr('꺼짐', 'off')}</span>}</td>
          <td className="num">{r.v === null ? '—' : Math.round(r.v)}</td>
          <td className="num">
            {r.dropPct === null ? '—' : `${r.dropPct}%`}
            {r.dropPct !== null && <div className={`small ${bad ? 'cc-bad' : 'muted'}`}>≤ {Math.round(r.limit * 100) / 100}%</div>}
          </td>
        </tr>
      );
    });
  const loadHead = (
    <thead>
      <tr>
        <th>{tr('기호', 'Tag')}</th>
        <th>{tr('용량', 'Power')}</th>
        <th>A</th>
        <th>V</th>
        <th>{tr('강하', 'Drop')}</th>
      </tr>
    </thead>
  );
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
    out.push('', line([tr('차단기', 'Breaker'), 'In (A)', tr('최대 전류 (A)', 'Max I (A)'), tr('단락 전류 (kA)', 'Isc (kA)'), tr('차단 용량 (kA)', 'Icu (kA)')]));
    for (const r of a.breakers) out.push(line([r.tag, r.amps ?? '', r.i, r.isc ?? '', r.ka ?? '']));
    if (a.transformers.length) {
      out.push('', line([tr('변압기', 'Transformer'), 'kVA', tr('1차 (kV)', 'HV (kV)'), tr('2차 (V)', 'LV (V)'), tr('최대 부하 (kVA)', 'Peak (kVA)'), tr('부하율 (%)', 'Load (%)'), tr('2차 전류 (A)', 'LV I (A)'), tr('1차 전류 (A)', 'HV I (A)'), tr('전압 변동 (%)', 'Reg. (%)'), tr('2차 단락 (kA)', 'Isc (kA)')]));
      for (const r of a.transformers) out.push(line([r.tag, r.kva, r.kv1, r.v2, r.load, r.pct, r.i2, r.i1, r.reg, r.isc]));
    }
    downloadText(`${safeFileName(title || 'circuit')}_${tr('전기해석', 'analysis')}.csv`, '\uFEFF' + out.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  };
  if (!a.loads.length && !a.cables.length && !a.bare.length)
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
      <SupplyFields circuit={circuit} onChange={onChange} />
      <div className="grid2">
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
      {(errors > 0 || a.bare.length > 0) && (
        <div className="cc-power-auto">
          {errors > 0 && a.cables.length > 0 && (
            <button type="button" className="btn small primary" onClick={() => onAuto(false)} title={tr('허용전류가 모자라거나 전압강하가 큰 케이블을 필요한 만큼 굵게 바꿉니다 (차단기 · 부하는 그대로)', 'Enlarges cables that fail ampacity or voltage drop; breakers and loads stay')}>
              <Icon name="wand" size={13} /> {tr('굵기 자동 선정', 'Auto-size cables')}
            </button>
          )}
          {a.bare.length > 0 && (
            <button type="button" className={`btn small ${a.cables.length ? '' : 'primary'}`} onClick={() => onAuto(true)} title={tr('규격 없는 전선에 전류 · 차단기 정격에 맞는 굵기를 줍니다 (XLPE · B1, 길이는 그림에서 어림: 1칸 = 1 cm)', 'Gives bare wires a size that suits their current and breaker (XLPE, B1; length estimated from the drawing)')}>
              <Icon name="wand" size={13} /> {tr(`규격 자동 지정 (${a.bare.length}구간)`, `Assign specs (${a.bare.length} runs)`)}
            </button>
          )}
        </div>
      )}
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
                    <td className="num" title={r.tap ? tr(`3 m 이내 분기 (KEC 212.4.2): 분기점에서 3 m 안에 있는 ${r.breaker} 가 과부하 보호를 맡습니다. 단락 보호는 위쪽 차단기`, `Tap within 3 m: ${r.breaker} provides overload protection; the upstream breaker covers short circuits`) : r.breaker}>
                      {r.breakerAmps ?? '—'}
                      {r.tap && <div className="small muted">{tr('탭 3m', 'tap')}</div>}
                    </td>
                    <td className="num">{r.iz ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {a.bare.length > 0 && (
        <details className="cc-power-more" open={!a.cables.length}>
          <summary>{tr(`규격을 정하지 않은 전선 ${a.bare.length}구간 (전류만 계산)`, `${a.bare.length} wire runs without a spec (currents only)`)}</summary>
          <table className="tbl compact cc-power-tbl">
            <thead>
              <tr>
                <th>{tr('구간', 'Run')}</th>
                <th>IB</th>
                <th>In</th>
                <th>{tr('권장', 'Suggest')}</th>
              </tr>
            </thead>
            <tbody>
              {a.bare.map((r, i) => (
                <tr key={i} onClick={() => onPick([], r.wires)}>
                  <td className="mono small">
                    {r.from} → {r.to}
                    {r.count > 1 ? ` (${tr(`${r.count}가닥`, `×${r.count}`)})` : ''}
                  </td>
                  <td className="num">{fmtI(r.ib)}</td>
                  <td className="num" title={r.tap ? tr(`3 m 이내 분기 (KEC 212.4.2): 분기점에서 3 m 안에 있는 ${r.breaker} 가 과부하 보호를 맡습니다. 단락 보호는 위쪽 차단기`, `Tap within 3 m: ${r.breaker} provides overload protection; the upstream breaker covers short circuits`) : r.breaker}>
                    {r.breakerAmps ?? '—'}
                    {r.tap && <div className="small muted">{tr('탭 3m', 'tap')}</div>}
                  </td>
                  <td className="num">{r.suggest === null ? '—' : `${r.suggest} mm²`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{tr('권장 굵기는 XLPE · B1 (전선관) 기준으로, 흐르는 전류와 위쪽 차단기 정격을 모두 감당하는 가장 가는 것입니다.', 'Suggested for XLPE in conduit (B1): the smallest size that carries both the current and the breaker rating above.')}</p>
        </details>
      )}
      {major.length > 0 && (
        <>
          <h4>{tr('부하: 전류와 전압강하', 'Loads: current and voltage drop')}</h4>
          <table className="tbl compact cc-power-tbl">
            {loadHead}
            <tbody>{loadRows(major)}</tbody>
          </table>
        </>
      )}
      {minor.length > 0 && (
        <details className="cc-power-more" open={!major.length}>
          <summary>{tr(`작은 제어 부하 ${minor.length}개 (릴레이 코일 · 표시등: 용량은 가정값)`, `${minor.length} small control loads (coils, lamps; assumed ratings)`)}</summary>
          <table className="tbl compact cc-power-tbl">
            {loadHead}
            <tbody>{loadRows(minor)}</tbody>
          </table>
        </details>
      )}
      {a.loads.some((l) => !l.on) && <p className="small muted">{tr('"꺼짐" 은 조작 순서대로 돌렸을 때 한 번도 켜지지 않은 부하입니다. [조작 순서] 에 기동 조작을 넣으면 그때의 전류로 검토합니다.', '"off" loads were never energised in the operation sequence; add the operations that start them.')}</p>}
      {a.transformers.length > 0 && (
        <>
          <h4>{tr('변압기: 부하율 · 전압 변동 · 단락 전류', 'Transformers: loading, regulation, fault current')}</h4>
          <table className="tbl compact cc-power-tbl">
            <thead>
              <tr>
                <th>{tr('기호', 'Tag')}</th>
                <th>{tr('부하', 'Load')}</th>
                <th>{tr('전류', 'Current')}</th>
                <th title={tr('전압 변동 / 2차 단락 전류', 'Regulation / secondary fault current')}>{tr('변동 · 단락', 'Reg. · Isc')}</th>
              </tr>
            </thead>
            <tbody>
              {a.transformers.map((r) => {
                const bad = r.pct > 100;
                return (
                  <tr key={r.partId} className={bad ? 'bad' : ''} onClick={() => onPick([r.partId], [])}>
                    <td className="mono small">
                      <b>{r.tag}</b>
                      <br />
                      <span className="muted">
                        {r.kva} kVA · {r.kv1}kV/{r.v2}V
                      </span>
                    </td>
                    <td className="num">
                      {r.load} kVA
                      <div className={`small ${bad ? 'cc-bad' : 'muted'}`}>{r.pct}%</div>
                    </td>
                    <td className="num small">
                      {tr('2차', 'LV')} {f1(r.i2)} / {r.i2n} A
                      <br />
                      <span className="muted">
                        {tr('1차', 'HV')} {r.i1} A
                      </span>
                    </td>
                    <td className="num small">
                      {r.reg}%
                      <br />
                      <span className="muted">{r.isc} kA</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            {tr(
              '전압 변동은 한전 계통 + 변압기 임피던스에서 떨어지는 전압 (가장 클 때). 부하의 전압강하는 변압기 2차 단자부터 잽니다. 단락 전류는 %임피던스법 (3상, 전압 계수 1).',
              'Regulation: drop across the utility and transformer impedance at peak. Load voltage drop is measured from the transformer secondary. Fault current by the %Z method (3-phase).',
            )}
          </p>
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
                {a.breakers.some((r) => r.isc !== null) && <th title={tr('설치점 단락 전류 / 차단 용량', 'Fault current / breaking capacity')}>{tr('단락 / 차단', 'Isc / Icu')}</th>}
              </tr>
            </thead>
            <tbody>
              {a.breakers.map((r) => {
                const over = r.amps !== null && r.i > r.amps;
                const weak = r.isc !== null && r.ka !== null && r.isc > r.ka;
                return (
                  <tr key={r.partId} className={over || weak ? 'bad' : ''} onClick={() => onPick([r.partId], [])}>
                    <td className="mono">
                      <b>{r.tag}</b>
                    </td>
                    <td className="num">{r.amps === null ? '—' : `${r.amps} A`}</td>
                    <td className="num">
                      {f1(r.i)} A {pct(r.i, r.amps) !== null && <span className={`small ${over ? 'cc-bad' : 'muted'}`}>({pct(r.i, r.amps)}%)</span>}
                    </td>
                    {a.breakers.some((b) => b.isc !== null) && (
                      <td className={`num small ${weak ? 'cc-bad' : ''}`}>
                        {r.isc === null ? '—' : `${r.isc} kA`}
                        <br />
                        <span className={weak ? 'cc-bad' : 'muted'}>{r.ka === null ? tr('차단 ?', 'Icu ?') : `${r.ka} kA`}</span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {a.breakers.some((r) => r.isc !== null && r.ka === null) && <p className="small muted">{tr('차단기를 누르고 차단 용량 (kA) 을 적으면 설치점 단락 전류와 비교합니다.', 'Enter breaking capacities (kA) to compare with the fault currents.')}</p>}
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
  length,
  onReroute,
}: {
  /** 그림의 전선 길이 합계 (칸 = cm) */
  length: number;
  onReroute?: () => void;
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
      <div className="cc-wiring-len small">
        {tr('그림의 전선 합계', 'Wire drawn')} <b>{tr(`약 ${(length / 100).toFixed(1)} m`, `about ${(length / 100).toFixed(1)} m`)}</b> <span className="muted">{tr('(그림 1칸 = 1 cm 로 어림)', '(1 grid cell ≈ 1 cm)')}</span>
        {onReroute && (
          <button type="button" className="btn small ghost" onClick={onReroute} title={tr('기기를 옮긴 뒤 전선을 가장 짧게 다시 긋습니다', 'Redraw the wires shortest for the current positions')}>
            {tr('배선 다시 그리기', 'Re-route wires')}
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

function CheckPane({ issues, onPick }: { issues: CircuitIssue[]; onPick: (ids: string[], wires: string[]) => void }) {
  if (!issues.length) return <p className="cc-ok">{tr('문제가 없습니다.', 'No problems found.')}</p>;
  return (
    <div className="msgs cc-check">
      {issues.map((i, k) => (
        <button type="button" key={k} className={`msg ${i.level === 'error' ? 'error' : 'warning'}`} onClick={() => (i.partIds.length || i.wireIds?.length) && onPick(i.partIds, i.wireIds ?? [])}>
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
