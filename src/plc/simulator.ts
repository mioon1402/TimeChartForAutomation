import type { Project, Signal, SignalRole, Step, WavePoint } from '../model/types';
import { createSignal, createStep, ROLE_COLORS, STEP_COLORS } from '../model/project';
import { lastChange, levelIntervals, normalize, uid } from '../model/wave';
import { formatTime } from '../model/format';
import type { DeviceInfo, MachineModel, SimSettings, Stimulus } from './types';
import type { ParsedProgram } from './program';
import { dialectName } from './program';
import { isStepRelay } from './devices';

export interface TraceData {
  device: string;
  type: 'bit' | 'word';
  points: WavePoint[];
}

export interface ActuatorTrace {
  model: Extract<MachineModel, { type: 'cylinder' }>;
  points: WavePoint[];
}

export interface SimResult {
  traces: TraceData[];
  actuators: ActuatorTrace[];
  stepTrace: TraceData | null;
  stlTraces: TraceData[];
  scans: number;
  simulated: number;
  lastChange: number;
  warnings: string[];
  runMs: number;
}

export function stimulusValue(s: Stimulus, t: number): boolean {
  switch (s.mode) {
    case 'const':
      return s.value === 1;
    case 'pulse':
      return s.pulses.some((p) => t >= p.start - 1e-9 && t < p.end - 1e-9);
    case 'wave': {
      let v: WavePoint['v'] = 0;
      for (const p of s.points) {
        if (p.t <= t + 1e-9) v = p.v;
        else break;
      }
      return v === 1 || v === '1';
    }
  }
}

const MAX_SCANS = 400000;

/** 스캔 시뮬레이션 실행 */
export function runSimulation(prog: ParsedProgram, settings: SimSettings): SimResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rt = prog.createRuntime(settings);
  const warnings: string[] = [];
  const dt = Math.max(settings.scanTime, 0.1);
  let nScans = Math.floor(settings.duration / dt) + 1;
  if (nScans > MAX_SCANS) {
    warnings.push(`스캔 수가 너무 많아 ${MAX_SCANS.toLocaleString()} 스캔까지만 실행합니다. 스캔 타임을 늘리거나 시간을 줄이세요.`);
    nScans = MAX_SCANS;
  }

  // 모델이 제어하는 입력은 자극(stimulus) 대상에서 제외
  const modelTargets = new Set<string>();
  for (const m of settings.models) {
    if (m.type === 'cylinder') {
      if (m.extSensor) modelTargets.add(m.extSensor);
      if (m.retSensor) modelTargets.add(m.retSensor);
    } else if (m.target) modelTargets.add(m.target);
  }
  const stimuli = settings.stimuli.filter((s) => s.device && !modelTargets.has(s.device));

  interface CylState {
    pos: number;
    target: 0 | 1;
    points: WavePoint[];
  }
  const cyl = new Map<string, CylState>();
  const del = new Map<string, { out: boolean; pending: boolean | null; since: number }>();
  for (const m of settings.models) {
    if (m.type === 'cylinder') cyl.set(m.id, { pos: m.initial, target: m.initial, points: [{ t: 0, v: m.initial }] });
    else del.set(m.id, { out: m.invert, pending: null, since: 0 });
  }

  // 기록 대상
  const recorders = new Map<string, { type: 'bit' | 'word'; points: WavePoint[]; last: string | number | null }>();
  const addRec = (d: string) => {
    if (!d || recorders.has(d)) return;
    recorders.set(d, { type: rt.valueType(d), points: [], last: null });
  };
  settings.watch.forEach(addRec);
  const stepDev = settings.stepDevice && settings.stepDevice !== '@STL' ? settings.stepDevice : '';
  if (stepDev) addRec(stepDev);
  const stlDevs = settings.stepDevice === '@STL' ? prog.devices.filter((d) => isStepRelay(d.name)).map((d) => d.name) : [];
  stlDevs.forEach(addRec);

  let prevT = 0;
  for (let k = 0; k < nScans; k++) {
    const t = Math.round(k * dt * 1000) / 1000;
    for (const s of stimuli) rt.writeBit(s.device, stimulusValue(s, t));

    for (const m of settings.models) {
      if (m.type === 'cylinder') {
        const st = cyl.get(m.id)!;
        const step = t - prevT;
        // 이동
        if (st.pos !== st.target && step > 0) {
          const time = st.target === 1 ? m.extendTime : m.retractTime;
          const delta = time > 0 ? step / time : 1;
          st.pos = st.target === 1 ? Math.min(1, st.pos + delta) : Math.max(0, st.pos - delta);
        }
        // 출력으로 목표 결정
        const ext = m.extend ? rt.readBit(m.extend) : false;
        const ret = m.retract ? rt.readBit(m.retract) : false;
        let target = st.target;
        if (m.retract) {
          if (ext && !ret) target = 1;
          else if (ret && !ext) target = 0;
        } else target = ext ? 1 : 0;
        if (target !== st.target) {
          st.target = target;
          const time = target === 1 ? m.extendTime : m.retractTime;
          const remaining = target === 1 ? (1 - st.pos) * time : st.pos * time;
          if (remaining <= 0) st.pos = target;
          const p: WavePoint = { t, v: target };
          if (remaining > 0) p.ramp = Math.round(remaining * 1000) / 1000;
          st.points.push(p);
        }
        if (m.extSensor) rt.writeBit(m.extSensor, st.pos >= 1 - 1e-9);
        if (m.retSensor) rt.writeBit(m.retSensor, st.pos <= 1e-9);
      } else {
        const st = del.get(m.id)!;
        const src = m.source ? rt.readBit(m.source) : false;
        const desired = m.invert ? !src : src;
        if (desired !== st.out) {
          if (st.pending !== desired) {
            st.pending = desired;
            st.since = t;
          }
          if (t - st.since >= (desired ? m.onDelay : m.offDelay) - 1e-9) {
            st.out = desired;
            st.pending = null;
          }
        } else st.pending = null;
        if (m.target) rt.writeBit(m.target, st.out);
      }
    }

    rt.scan(t, k);

    for (const [d, r] of recorders) {
      const raw = rt.readValue(d);
      const v: string | number = r.type === 'word' ? String(typeof raw === 'boolean' ? (raw ? 1 : 0) : Math.round(Number(raw) * 1000) / 1000) : raw ? 1 : 0;
      if (r.last === null || r.last !== v) {
        r.points.push({ t, v });
        r.last = v;
      }
    }
    prevT = t;
  }

  const simulated = (nScans - 1) * dt;
  const toTrace = (d: string): TraceData => {
    const r = recorders.get(d)!;
    const kind = r.type === 'word' ? 'bus' : 'bit';
    return { device: d, type: r.type, points: normalize(r.points, kind, r.type === 'word' ? '0' : 0) };
  };
  const traces = settings.watch.filter((d) => recorders.has(d)).map(toTrace);
  const actuators: ActuatorTrace[] = settings.models
    .filter((m): m is Extract<MachineModel, { type: 'cylinder' }> => m.type === 'cylinder')
    .map((m) => ({ model: m, points: normalize(cyl.get(m.id)!.points, 'bit', m.initial) }));

  let last = 0;
  for (const tr of [...traces, ...actuators]) last = Math.max(last, lastChange(tr.points));
  const runMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  return {
    traces,
    actuators,
    stepTrace: stepDev ? toTrace(stepDev) : null,
    stlTraces: stlDevs.map(toTrace),
    scans: nScans,
    simulated,
    lastChange: last,
    warnings: [...warnings, ...rt.warnings],
    runMs,
  };
}

function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

export function niceGrid(duration: number, scanTime: number): number {
  const raw = duration / 60;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.001))));
  let g = pow;
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) {
      g = m * pow;
      break;
    }
  }
  return Math.max(g, scanTime);
}

function stepsFromTrace(tr: TraceData, label: (v: string) => string, until: number): Step[] {
  const out: Step[] = [];
  const pts = tr.points;
  for (let i = 0; i < pts.length; i++) {
    const v = String(pts[i].v);
    if (v === '0' || v === '') continue;
    const start = pts[i].t;
    const end = i + 1 < pts.length ? pts[i + 1].t : until;
    if (end <= start) continue;
    out.push(createStep({ label: label(v), start, end, description: '', color: STEP_COLORS[out.length % STEP_COLORS.length] }));
  }
  return out;
}

export interface ApplyOptions {
  /** 기존 차트의 신호(주소 일치)를 유지 - 주석, 규칙, 이름 편집 보존 */
  keepExisting: boolean;
}

/** 시뮬레이션 결과 → 프로젝트 (신호, 스텝, 길이) */
export function applySimulation(base: Project, prog: ParsedProgram, settings: SimSettings, res: SimResult, opts: ApplyOptions = { keepExisting: true }): Project {
  const devInfo = new Map<string, DeviceInfo>(prog.devices.map((d) => [d.name, d]));
  const sensorSet = new Set<string>();
  for (const m of settings.models) {
    if (m.type === 'cylinder') {
      sensorSet.add(m.extSensor);
      sensorSet.add(m.retSensor);
    } else sensorSet.add(m.target);
  }
  const existing = new Map<string, Signal>();
  if (opts.keepExisting) for (const s of base.signals) existing.set(s.address || s.name, s);

  const duration = settings.autoTrim ? niceCeil(Math.max(res.lastChange * 1.08, res.lastChange + settings.scanTime * 5, 100)) : settings.duration;
  const signals: Signal[] = [];
  const addressOf = (d: string) => devInfo.get(d)?.address || d;

  for (const tr of res.traces) {
    const info = devInfo.get(tr.device);
    let role: SignalRole = info?.role ?? 'other';
    if (sensorSet.has(tr.device) && (role === 'input' || role === 'other')) role = 'sensor';
    // ST: AT 주소가 있으면 주소 칸에 주소, 설명에 변수 이름
    const addr = prog.dialect === 'st' ? addressOf(tr.device) : tr.device;
    const prev = existing.get(addr) ?? existing.get(tr.device);
    const kind = tr.type === 'word' ? 'bus' : 'bit';
    if (prev && prev.kind === kind) {
      signals.push({ ...prev, points: tr.points });
    } else {
      signals.push(
        createSignal({
          name: info?.comment || tr.device,
          address: addr,
          comment: prog.dialect === 'st' && addr !== tr.device ? tr.device : '',
          kind,
          role,
          color: ROLE_COLORS[role],
          points: tr.points,
        }),
      );
    }
  }
  // 실린더 동작 행: 전진 출력 바로 뒤에 삽입
  for (const a of res.actuators) {
    const key = a.model.name || '실린더';
    const prev = existing.get(key);
    const sig = prev && prev.role === 'actuator'
      ? { ...prev, points: a.points }
      : createSignal({
          name: key,
          address: '',
          kind: 'bit',
          role: 'actuator',
          onLabel: '전진',
          offLabel: '후진',
          defaultRamp: a.model.extendTime,
          points: a.points,
        });
    const idx = signals.findIndex((s) => s.address === a.model.extend || s.address === addressOf(a.model.extend));
    if (idx >= 0) {
      if (!prev) sig.group = signals[idx].group;
      signals.splice(idx + 1, 0, sig);
    }
    else signals.push(sig);
  }

  let steps: Step[] = base.steps;
  if (res.stepTrace) {
    const dev = res.stepTrace.device;
    const names = prog.stepNames.get(dev);
    steps = stepsFromTrace(res.stepTrace, (v) => (/^-?\d+$/.test(v) ? `S${v}` : v), Math.min(duration, res.simulated));
    for (const s of steps) {
      const v = s.label.replace(/^S(?=-?\d+$)/, '');
      const name = names?.get(v);
      if (name) s.label = `${s.label} ${name}`;
      s.description = name ? `${name} (${dev} = ${v})` : `${dev} = ${v}`;
    }
  } else if (res.stlTraces.length) {
    steps = [];
    for (const tr of res.stlTraces) {
      for (const iv of levelIntervals(tr.points, Math.min(duration, res.simulated), 1)) {
        const info = devInfo.get(tr.device);
        steps.push(
          createStep({ label: info?.comment ? `${tr.device} ${info.comment}` : tr.device, start: iv.start, end: iv.end, description: info?.comment ?? '', color: STEP_COLORS[steps.length % STEP_COLORS.length] }),
        );
      }
    }
    steps.sort((a, b) => a.start - b.start);
    steps.forEach((s, i) => (s.color = STEP_COLORS[i % STEP_COLORS.length]));
  }

  const ids = new Set(signals.map((s) => s.id));
  const annotations = base.annotations.filter((a) => {
    if (a.type === 'arrow') return ids.has(a.from.signalId) && ids.has(a.to.signalId);
    if (a.type === 'dimension' || a.type === 'note') return a.signalId === null || ids.has(a.signalId);
    return true;
  });
  const rules = base.rules.filter((r) => {
    if (r.type === 'delay') return ids.has(r.fromSignal) && ids.has(r.toSignal);
    if (r.type === 'exclusive') return ids.has(r.a) && ids.has(r.b);
    if (r.type === 'pulse') return ids.has(r.signal);
    return true;
  });

  const desc = `PLC 시뮬레이션: ${dialectName(prog.dialect)}, 스캔 ${formatTime(settings.scanTime, 'ms')}, ${res.scans.toLocaleString()} 스캔`;
  return {
    ...base,
    meta: { ...base.meta, description: base.meta.description && !base.meta.description.startsWith('PLC 시뮬레이션') ? base.meta.description : desc },
    settings: { ...base.settings, duration, grid: niceGrid(duration, settings.scanTime) },
    signals,
    steps,
    annotations,
    rules,
  };
}

/** 기본 표시 디바이스: 입력 → 출력 → 내부 → 타이머/카운터 → 스텝 워드 */
export function defaultWatch(prog: ParsedProgram, limit = 40): string[] {
  const ds = prog.devices.filter((d) => {
    if (d.type === 'word') return prog.stepCandidates.includes(d.name);
    if (d.role === 'internal') return d.written;
    return true;
  });
  return ds.slice(0, limit).map((d) => d.name);
}

/** 시작 버튼으로 보이는 입력에 기본 펄스를 넣는 등 초기 설정 제안 */
export function suggestStimuli(prog: ParsedProgram): Stimulus[] {
  const out: Stimulus[] = [];
  for (const d of prog.devices) {
    if (d.role !== 'input' || d.type !== 'bit') continue;
    const text = `${d.name} ${d.comment}`.toUpperCase();
    if (/START|시작|기동|RUN|AUTO|자동/.test(text) && !/STOP|정지|비상|EMG/.test(text)) {
      out.push({ device: d.name, mode: 'pulse', pulses: [{ start: 100, end: 300 }] });
    } else if (/STOP|정지|비상|EMG|E-STOP|NC/.test(text)) {
      // 정지/비상정지 버튼은 보통 B접점(NC) - 평상시 ON
      out.push({ device: d.name, mode: 'const', value: /B접|NC|비상|EMG/.test(text) ? 1 : 0 });
    }
  }
  return out;
}

export function newCylinderModel(partial: Partial<Extract<MachineModel, { type: 'cylinder' }>> = {}): Extract<MachineModel, { type: 'cylinder' }> {
  return {
    id: uid('mdl'),
    type: 'cylinder',
    name: '실린더',
    extend: '',
    retract: '',
    extSensor: '',
    retSensor: '',
    extendTime: 500,
    retractTime: 500,
    initial: 0,
    ...partial,
  };
}

export function newDelayModel(partial: Partial<Extract<MachineModel, { type: 'delay' }>> = {}): Extract<MachineModel, { type: 'delay' }> {
  return { id: uid('mdl'), type: 'delay', name: '응답', source: '', target: '', onDelay: 100, offDelay: 100, invert: false, ...partial };
}
