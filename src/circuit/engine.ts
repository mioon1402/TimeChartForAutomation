import type { WavePoint } from '../model/types';
import type { Circuit, OpStep, Part, PartType } from './types';
import { buildNetlist, type Netlist } from './netlist';
import { ALWAYS_ON, counterPreset, hmiTag, isLinkedSensor, isPlcPart, isTempDevice, tempSetting, OPERATOR, partPins, partPoles, PARTS, plcAddresses, REAL, RPLC, POLE_IDENTITY, POLE_SYSTEM, PROX_TYPES, schedOn, SMPS_TYPES, tswSched, VALVES } from './parts';
import { formatTime } from '../model/format';
import { poleLive } from './supply';
import type { PlcConfig, SimSettings } from '../plc/types';
import { parseProgram, type ParsedProgram } from '../plc/program';
import { parseDeviceComments } from '../plc/comments';
import { normDevice } from '../plc/devices';
import type { PlcRuntime } from '../plc/runtime';
import { conductorGraph, earthFault, earthingOf, FAULTABLE, faultText, feedPath, frameEarthPin, livePins, phaseSources, phaseVolt, type FaultResult } from './earth';

/**
 * 회로 시뮬레이션 (사건 구동)
 *  - 닫힌 접점·퓨즈·차단기로 이어진 넷을 묶고, 묶음마다 닿은 전원 극을 본다.
 *  - 부하(코일·램프·전동기·솔레노이드)는 두 단자가 같은 계통의 서로 다른 극에 닿으면 동작.
 *    (+24V 와 0V, L 과 N, L1 과 L2 …) 부하를 거쳐서만 닿는 단자는 극이 없는 것으로 본다.
 *  - 한 묶음에 서로 다른 극이 둘 이상 닿으면 단락.
 *  - 코일은 한 번에 하나씩 바꾸며 안정될 때까지 반복 (동시에 누른 정역 버튼은 앞 렁이 이김).
 *  - 타이머 만료, 실린더 도착 시각을 다음 사건으로 잡아서 시간을 건너뛴다.
 */

export type TagKind = 'coil' | 'timer' | 'tsw' | 'counter' | 'temp' | 'thr' | 'sensor' | 'operator';

const DAY = 86400000;

/** 부품이 따르는 기호 (대소문자 무시, 기호 없는 조작 기기는 부품마다 따로) */
export function tagKey(p: Pick<Part, 'id' | 'tag'>): string {
  const t = p.tag.trim();
  return t ? t.toUpperCase() : `#${p.id}`;
}

export function normTag(tag: string): string {
  return tag.trim().toUpperCase();
}

export interface Conductor {
  part: Part;
  a: number;
  b: number;
  /** 두 단자의 번호 (부품의 단자 목록에서) */
  ia: number;
  ib: number;
  tag: string;
  nc: boolean;
  always: boolean;
  /** PLC 릴레이 출력 번호 (공통 C ↔ Qn) */
  plcOut?: number;
  /** 3선식 센서: 이 부품에 전원이 있어야 닫힌다 */
  power?: string;
  /** 타이머의 순시 접점: 한시 출력이 아니라 코일을 따른다 */
  inst?: boolean;
  /** 3단 셀렉터: 이 자리 (-1 왼쪽, 1 오른쪽) 에서 닫힌다 */
  sel?: -1 | 1;
  /** 직류 2선식 센서: a = 갈색, b = 파랑. 파랑이 + 쪽이거나 갈색이 0V 쪽이면 (거꾸로 이으면) 켜지지 않는다 */
  dc2?: boolean;
  /** 온도 조절기의 경보 출력 (AL) */
  al?: boolean;
}

/** 온도 기기 하나: 묶음 (같은 온도를 재는 기기끼리), 설정 · 히스테리시스 · 경보, 온도 조절기면 출력 동작 */
export interface TempDef {
  part: Part;
  zone: string;
  /** 온도 조절기 (전원 A1 · A2, 출력 OUT · AL) */
  tc: boolean;
  sv: number;
  hys: number;
  alarm: number | null;
  /** 냉각 동작: 설정 이상이면 OUT */
  cool: boolean;
}

/** 온도 묶음: 처음 · 주위 온도, 최고 온도, 오르는 · 내리는 속도 (℃/s), 온도를 바꾸는 부하 */
export interface TempZone {
  label: string;
  amb: number;
  tmax: number;
  rise: number;
  fall: number;
  load: string;
  loadCool: boolean;
}

export interface TempView {
  pv: number;
  sv: number;
  hot: boolean;
  out: boolean;
  al: boolean;
  /** 온도가 바뀌는 중: 1 오름, -1 내림, 0 그대로 */
  dir: -1 | 0 | 1;
}

/** 공압 포트 상태: P = 압력, E = 배기(대기), X = 막힘 */
export type AirState = 'P' | 'E' | 'X';

/** 두 극 사이에 전압이 걸리는가 (같은 계통의 다른 극, 직류는 +24V 쪽이 a) */
function powerBetween(a: string | null, b: string | null, dcPolarity = false): boolean {
  if (!a || !b || a === b || a === 'short' || b === 'short' || POLE_SYSTEM[a] !== POLE_SYSTEM[b]) return false;
  return !dcPolarity || POLE_SYSTEM[a] !== 'dc' || a === '+24V';
}

/** 회로 안의 PLC: 입력 단자 넷과 프로그램 디바이스 */
export interface PlcBlock {
  part: Part;
  inNets: number[];
  /** 런타임에 쓰는 디바이스 이름 */
  inDev: string[];
  outDev: string[];
  /** 화면에 보이는 주소 */
  inAddr: string[];
  outAddr: string[];
  /** 디바이스 설명 (코멘트) */
  inName: string[];
  outName: string[];
  /** 실물 PLC: 입력 공통 COM 넷, 전원 + · − 넷 (기호 PLC 는 없음 = 늘 켜짐, 입력은 +24V · L 이 닿으면 ON) */
  com?: number;
  power?: [number, number];
}

/** HMI 버튼 · 스위치 하나 */
export interface HmiButton {
  part: Part;
  n: number;
  label: string;
  /** 런타임 디바이스 */
  dev: string;
  /** 스위치 (누를 때마다 바뀜) */
  toggle: boolean;
}

export type TrackKind = 'operator' | 'selector' | 'sensor' | 'coil' | 'timerCoil' | 'timerOut' | 'tsw' | 'counterVal' | 'counterOut' | 'tempVal' | 'tempOut' | 'tempAlarm' | 'tempSw' | 'load' | 'motor' | 'cyl' | 'plcIn' | 'plcOut' | 'leak' | 'earthA';

export interface Track {
  key: string;
  /** 화면에 쓰는 기호 */
  tag: string;
  kind: TrackKind;
  /** 대표 부품 */
  part: Part;
  points: WavePoint[];
  last: number | string | null;
  /** PLC 입출력 번호 */
  idx?: number;
}

/** 회로에서 바뀌지 않는 정보 (기호 연결, 넷) */
export class CircuitModel {
  readonly net: Netlist;
  readonly tagKind = new Map<string, TagKind>();
  /** 기호 → 화면용 기호 */
  readonly tagLabel = new Map<string, string>();
  readonly coilParts = new Map<string, string[]>();
  readonly timerParts = new Map<string, string[]>();
  /** preset = 설정 시간 (플리커는 켜짐 시간), off = 플리커의 꺼짐 시간 */
  readonly timerDef = new Map<string, { mode: 'on' | 'off' | 'flicker' | 'interval'; preset: number; off: number }>();
  /** 24시간 타임 스위치: 시계 전원 넷 (L · N) 과 켜지는 구간 */
  readonly tswDef = new Map<string, { part: Part; l: number; n: number; sched: [number, number][] }>();
  /** 프리셋 카운터: 입력 CP · RST · COM 넷 (무전압 접점 입력: COM 과 이어지면 들어온 것) */
  readonly counterDef = new Map<string, { part: Part; cp: number; rst: number; com: number; preset: number }>();
  /** 3단 셀렉터 기호 */
  readonly sel3 = new Set<string>();
  /** 온도 기기 (온도 조절기 · 서모스탯 · 온도 스위치) 와 온도 묶음 */
  readonly tempDef = new Map<string, TempDef>();
  readonly tempZones = new Map<string, TempZone>();
  /** 릴레이 · 타이머 코일이 붙고 떨어지는 데 걸리는 시간 (ms, 0 = 바로) */
  readonly relayMs: number;
  readonly cylDef = new Map<string, Part>();
  readonly sensorDef = new Map<string, { cyl: string; end: '+' | '-' }>();
  readonly operatorDefault = new Map<string, boolean>();
  readonly loads: Part[] = [];
  readonly loadParts = new Map<string, string[]>();
  readonly conductors: Conductor[] = [];
  readonly sources: { net: number; id: string }[] = [];
  /** 대표 부품 (기호마다 처음 나온 것, 코일이 있으면 코일) */
  readonly mainPart = new Map<string, Part>();
  readonly plcs: PlcBlock[] = [];
  /** HMI: 기기와 버튼 · 스위치 (조작 기호 → 정의), 램프 디바이스 */
  readonly hmis: { part: Part; plus: number; minus: number }[] = [];
  readonly hmiDef = new Map<string, HmiButton>();
  /** 누전이 날 수 있는 기기 (기호 → 부품, 충전부 넷, 외함 접지 단자 넷) */
  readonly faultDev = new Map<string, { part: Part; live: number[]; pe: number | null }>();
  /** HMI 칸마다 PLC 디바이스 (런타임 이름, 부품 id → 칸 차례) */
  readonly hmiDevs = new Map<string, string[]>();
  /** PLC 탭의 프로그램 (회로에 PLC 가 있을 때만) */
  readonly prog: ParsedProgram | null = null;
  readonly plcSim: SimSettings | null = null;
  readonly plcIssues: string[] = [];
  /** 3선식 센서: 갈색(+) · 검정(출력) · 파랑(0V) 넷 */
  readonly proxs: { part: Part; bn: number; bu: number }[] = [];
  /** SMPS: 입력 L·N, 출력 +V·-V 넷 */
  readonly smpsList: { part: Part; inL: number; inN: number; outP: number; outM: number }[] = [];
  /** 3상 변압기: 1차 (H1 H2 H3) 에 특고압 세 상이 다 닿으면 2차 (X1 X2 X3 = L1 L2 L3, X0 = N) 가 전원이 된다 */
  readonly trList: { part: Part; h: number[]; x: number[]; x0: number }[] = [];
  /** 공압: 공압원 넷, 늘 통하는 쌍(FRL·속도 제어), 속도 제어, 밸브, 실린더 포트 */
  readonly airNets = new Set<number>();
  readonly airSrc: number[] = [];
  readonly airAlways: [number, number][] = [];
  readonly flowCtrls: { part: Part; net: number; speed: number }[] = [];
  readonly valves: { part: Part; ports: number[]; solA: string; solB: string }[] = [];
  readonly cylPorts = new Map<string, { cap: number; rod: number; capTubed: boolean; rodTubed: boolean }>();

  constructor(
    readonly circuit: Circuit,
    plc?: PlcConfig,
  ) {
    this.net = buildNetlist(circuit);
    this.relayMs = Math.min(1000, Math.max(0, circuit.relayMs ?? 0));
    const rank: Record<TagKind, number> = { coil: 5, timer: 5, tsw: 5, counter: 5, temp: 5, thr: 4, sensor: 3, operator: 2 };
    const zoneParts = new Map<string, Part[]>();
    const setKind = (tag: string, k: TagKind, p: Part) => {
      const cur = this.tagKind.get(tag);
      if (!cur || rank[k] > rank[cur]) {
        this.tagKind.set(tag, k);
        this.mainPart.set(tag, p);
      }
    };
    const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
    for (const p of circuit.parts) {
      const tag = tagKey(p);
      if (!this.tagLabel.has(tag)) this.tagLabel.set(tag, p.tag.trim() || PARTS[p.type].prefix || '?');
      if (!this.mainPart.has(tag)) this.mainPart.set(tag, p);
      const def = PARTS[p.type];
      if (p.type === 'timer' || p.type === 'r_timer8') {
        setKind(tag, 'timer', p);
        push(this.timerParts, tag, p.id);
        if (!this.timerDef.has(tag)) {
          const preset = Math.max(0, p.preset ?? 3000);
          this.timerDef.set(tag, { mode: p.timerMode ?? 'on', preset, off: p.timerMode === 'flicker' && p.presetOff && p.presetOff > 0 ? p.presetOff : preset });
        }
      } else if (p.type === 'r_counter') {
        setKind(tag, 'counter', p);
        const pn = (i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
        if (!this.counterDef.has(tag)) this.counterDef.set(tag, { part: p, cp: pn(2), rst: pn(3), com: pn(4), preset: counterPreset(p) });
      } else if (isTempDevice(p)) {
        setKind(tag, 'temp', p);
        if (!this.tempDef.has(tag)) {
          const s = tempSetting(p);
          const zone = normTag(p.zone ?? '') || tag;
          this.tempDef.set(tag, { part: p, zone, tc: p.type === 'r_tc', sv: s.sv, hys: s.hys, alarm: p.type === 'r_tc' && typeof p.alarm === 'number' ? p.alarm : null, cool: p.tcMode === 'cool' });
          zoneParts.set(zone, [...(zoneParts.get(zone) ?? []), p]);
        }
      } else if (p.type === 'r_tsw') {
        setKind(tag, 'tsw', p);
        if (!this.tswDef.has(tag)) this.tswDef.set(tag, { part: p, l: this.net.pinNet.get(`${p.id}:0`)!, n: this.net.pinNet.get(`${p.id}:1`)!, sched: tswSched(p) });
      } else if (p.type === 'coil' || def.selfCoil) {
        setKind(tag, 'coil', p);
        push(this.coilParts, tag, p.id);
      } else if (p.type === 'ol3' || p.type === 'r_thr') setKind(tag, 'thr', p);
      else if (isLinkedSensor(p)) {
        setKind(tag, 'sensor', p);
        if (!this.sensorDef.has(tag)) this.sensorDef.set(tag, { cyl: normTag(p.cyl!), end: p.end ?? '+' });
      } else if (OPERATOR.has(p.type)) {
        setKind(tag, 'operator', p);
        if (p.type === 'r_ss3' || (p.type === 'sw_no' && p.sel)) this.sel3.add(tag);
        if (def.defaultOn) this.operatorDefault.set(tag, true);
      } else if (p.type === 'cyl') {
        if (p.tag.trim() && !this.cylDef.has(tag)) this.cylDef.set(tag, p);
      } else if (p.type === 'r_hmi') {
        // 화면 버튼 · 스위치마다 조작 기호 (HMI1-1, HMI1-2 …). 디바이스 이름은 PLC 종류를 안 뒤에 정한다
        (p.hmi ?? []).forEach((it, n) => {
          if (it.kind === 'lamp' || !it.dev.trim()) return;
          const t = hmiTag(p, n);
          if (this.tagKind.has(t)) return;
          setKind(t, 'operator', p);
          this.tagLabel.set(t, `${p.tag.trim() || 'HMI'}-${n + 1}`);
          this.hmiDef.set(t, { part: p, n, label: it.label, dev: it.dev.trim().toUpperCase(), toggle: it.kind === 'sw' });
        });
      }
      if (def.load) {
        this.loads.push(p);
        push(this.loadParts, tag, p.id);
      }
      const poles = partPoles(p);
      if (poles) {
        // 단자대는 늘 통한다. 8핀 타이머의 1-3 · 1-4 는 순시로 고를 수 있다
        const always = ALWAYS_ON.has(p.type);
        poles.forEach(([i, j], k) => {
          const a = this.net.pinNet.get(`${p.id}:${i}`)!;
          const b = this.net.pinNet.get(`${p.id}:${j}`)!;
          if (p.type === 'r_tc' && k === 1) {
            this.conductors.push({ part: p, a, b, ia: i, ib: j, tag, nc: false, always: false, al: true });
            return;
          }
          this.conductors.push({ part: p, a, b, ia: i, ib: j, tag, nc: p.type === 'r_thermo' ? !!p.ncOut : def.polesNc?.[k] ?? !!def.nc, always, inst: (p.type === 'r_timer8' && !!p.inst13 && k < 2) || ((p.type === 'no' || p.type === 'nc') && !!p.inst13), ...(p.type === 'r_ss3' ? { sel: k === 0 ? (-1 as const) : (1 as const) } : p.type === 'sw_no' && p.sel ? { sel: p.sel } : {}) });
        });
      }
      // 전원 계통에 없는 극 (3상 3선식의 N, 단상의 L3 …) 은 전압이 없다
      if ((p.type === 'src' || p.type === 'r_term') && poleLive(circuit, POLE_IDENTITY[p.pole ?? 'L'])) this.sources.push({ net: this.net.pinNet.get(`${p.id}:0`)!, id: POLE_IDENTITY[p.pole ?? 'L'] });
      if (p.type === 'src3') ['L1', 'L2', 'L3'].forEach((id, i) => poleLive(circuit, id) && this.sources.push({ net: this.net.pinNet.get(`${p.id}:${i}`)!, id }));
      // 한전 수전점: 특고압 세 상 (H1 H2 H3, 저압과는 다른 계통)
      if (p.type === 'r_kepco') ['H1', 'H2', 'H3'].forEach((id, i) => this.sources.push({ net: this.net.pinNet.get(`${p.id}:${i}`)!, id }));
      if (p.type === 'r_tr3') {
        const pn = (i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
        this.trList.push({ part: p, h: [pn(0), pn(1), pn(2)], x: [pn(3), pn(4), pn(5)], x0: pn(6) });
      }
      const pin = (i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
      partPins(p).forEach((pd, i) => pd.air && this.airNets.add(pin(i)));
      const tubed = (n: number) => this.net.pinCount[n] > 1 || this.net.hasWire[n];
      if (PROX_TYPES.has(p.type)) {
        // PNP: 감지하면 출력이 + 에, NPN: 출력이 0V 에 이어진다
        this.proxs.push({ part: p, bn: pin(0), bu: pin(2) });
        this.conductors.push({ part: p, a: p.npn ? pin(1) : pin(0), b: p.npn ? pin(2) : pin(1), ia: p.npn ? 1 : 0, ib: p.npn ? 2 : 1, tag, nc: false, always: false, power: p.id });
      } else if (p.type === 'r_prox2') {
        // 2선식: 갈색 · 파랑이 부하와 직렬인 접점 (전원은 부하를 거쳐 받는다)
        this.conductors.push({ part: p, a: pin(0), b: pin(1), ia: 0, ib: 1, tag, nc: !!p.ncOut, always: false, ...(p.ac ? {} : { dc2: true }) });
      } else if (SMPS_TYPES.has(p.type)) this.smpsList.push({ part: p, inL: pin(0), inN: pin(1), outP: pin(2), outM: pin(3) });
      else if (p.type === 'air') this.airSrc.push(pin(0));
      else if (p.type === 'frl' || p.type === 'fc') {
        this.airAlways.push([pin(0), pin(1)]);
        if (p.type === 'fc') this.flowCtrls.push({ part: p, net: pin(0), speed: Math.min(100, Math.max(5, p.speed ?? 50)) });
      } else if (VALVES.has(p.type)) this.valves.push({ part: p, ports: def.pins.map((_, i) => pin(i)), solA: normTag(p.solA ?? ''), solB: normTag(p.solB ?? '') });
      else if (p.type === 'cyl' && p.tag.trim() && !this.cylPorts.has(tag)) this.cylPorts.set(tag, { cap: pin(0), rod: pin(1), capTubed: tubed(pin(0)), rodTubed: tubed(pin(1)) });
      if (p.type === 'r_hmi') this.hmis.push({ part: p, plus: pin(0), minus: pin(1) });
      if (FAULTABLE.has(p.type) && p.tag.trim() && !this.faultDev.has(tag)) {
        const pe = frameEarthPin(p);
        this.faultDev.set(tag, { part: p, live: livePins(p).map(pin), pe: pe >= 0 ? pin(pe) : null });
        if (!this.tagLabel.has(tag)) this.tagLabel.set(tag, p.tag.trim());
      }
    }
    // 온도 묶음: 값마다 그 값을 처음 적은 기기의 것을 쓴다 (부하 · 속도 · 주위 온도)
    for (const [zone, ps] of zoneParts) {
      const first = <K extends keyof Part>(k: K) => ps.find((q) => q[k] !== undefined && q[k] !== '')?.[k];
      const amb = (first('amb') as number | undefined) ?? 20;
      const defs = [...this.tempDef.values()].filter((d) => d.zone === zone);
      const top = Math.max(amb + 10, ...defs.map((d) => d.sv + 20), ...defs.map((d) => (d.alarm ?? -Infinity) + 10));
      const owner = ps.find((q) => q.tLoad?.trim()) ?? ps[0];
      this.tempZones.set(zone, {
        label: ps[0].zone?.trim() || this.tagLabel.get(zone) || zone,
        amb,
        tmax: Math.max(amb, (first('tmax') as number | undefined) ?? top),
        rise: Math.max(0.001, (first('rise') as number | undefined) ?? 1),
        fall: Math.max(0.001, (first('fall') as number | undefined) ?? 0.5),
        load: normTag(owner.tLoad ?? ''),
        loadCool: !!owner.tLoadCool,
      });
    }
    // PLC: 입력은 단자 넷의 극으로 읽고, 출력은 공통 C ↔ Qn 접점
    const blocks = circuit.parts.filter(isPlcPart);
    if (blocks.length) {
      const dialect = plc?.dialect ?? 'mitsubishi';
      if (plc?.source.trim()) {
        try {
          this.prog = parseProgram(plc.source, plc.dialect, parseDeviceComments(plc.comments, plc.dialect));
          this.plcSim = plc.sim;
          const errs = this.prog.messages.filter((m) => m.severity === 'error');
          if (errs.length) this.plcIssues.push(`PLC 프로그램 오류 ${errs.length}개 (줄 ${errs[0].line}: ${errs[0].message})`);
        } catch (e) {
          this.plcIssues.push(`PLC 프로그램을 읽지 못했습니다: ${(e as Error).message}`);
        }
      } else this.plcIssues.push('PLC 프로그램이 없습니다. PLC 시뮬레이션 탭에서 넣으세요');
      const byAddr = new Map((this.prog?.devices ?? []).filter((d) => d.address).map((d) => [d.address!.toUpperCase(), d.name]));
      const info = new Map((this.prog?.devices ?? []).map((d) => [d.name, d]));
      const dev = (a: string) => (dialect === 'st' ? byAddr.get(a.toUpperCase()) ?? a : normDevice(a, dialect));
      const net = (p: Part, i: number) => this.net.pinNet.get(`${p.id}:${i}`)!;
      for (const p of blocks) {
        const { ins, outs } = plcAddresses(p);
        const inDev = ins.map(dev);
        const outDev = outs.map(dev);
        const real = p.type === 'r_plc';
        this.plcs.push({
          part: p,
          inNets: ins.map((_, n) => net(p, n)),
          inDev,
          outDev,
          inAddr: ins,
          outAddr: outs,
          inName: inDev.map((d) => info.get(d)?.comment ?? ''),
          outName: outDev.map((d) => info.get(d)?.comment ?? ''),
          ...(real ? { com: net(p, RPLC.com), power: [net(p, RPLC.plus), net(p, RPLC.minus)] as [number, number] } : {}),
        });
        outs.forEach((_, n) => {
          // 기호 PLC: 공통 C (8) ↔ Q (9~). 실물 PLC: 출력 0~7 은 COM0, 8~15 는 COM1
          const ia = real ? (n < 8 ? RPLC.com0 : RPLC.com1) : ins.length;
          const ib = real ? RPLC.out0 + n : ins.length + 1 + n;
          this.conductors.push({ part: p, a: net(p, ia), b: net(p, ib), ia, ib, tag: tagKey(p), nc: false, always: false, plcOut: n });
        });
      }
      for (const b of this.hmiDef.values()) b.dev = dev(b.dev);
      for (const h of this.hmis) this.hmiDevs.set(h.part.id, (h.part.hmi ?? []).map((it) => (it.dev.trim() ? dev(it.dev.trim().toUpperCase()) : '')));
    } else if (this.hmiDef.size) this.plcIssues.push('HMI 가 있지만 회로에 PLC 가 없습니다. HMI 버튼은 PLC 와 통신해야 동작합니다');
    // 실린더 기호가 없는 리밋 스위치 연결은 조작 기기로
    for (const [tag, s] of this.sensorDef) {
      if (!this.cylDef.has(s.cyl)) {
        this.sensorDef.delete(tag);
        this.tagKind.set(tag, 'operator');
      }
    }
  }

  /** 사람이 조작하는 기호 (조작 순서에서 고를 수 있는 것) */
  /** 조작 순서에 쓸 수 있는 기호 (버튼 · 스위치 · THR, 온도 기기는 온도를 바꾼다) */
  /** 누르는 동안만 (버튼) 인가 — HMI 스위치는 누를 때마다 바뀜 */
  momentary(tag: string): boolean {
    const h = this.hmiDef.get(tag);
    if (h) return !h.toggle;
    const p = this.mainPart.get(tag);
    return !!p && PARTS[p.type].operate === 'momentary';
  }

  operable(): string[] {
    return [...this.tagKind].filter(([, k]) => k === 'operator' || k === 'thr' || k === 'temp').map(([t]) => t);
  }

  label(tag: string): string {
    return this.tagLabel.get(tag) ?? tag;
  }
}

/** 배관으로 움직이는 실린더인가 (포트에 배관이 하나라도 있음) */
export function airDriven(m: CircuitModel, tag: string): boolean {
  const c = m.cylPorts.get(tag);
  return !!c && (c.capTubed || c.rodTubed);
}

export interface TimerView {
  coil: boolean;
  out: boolean;
  /** 진행 중이면 지난 시간 (ms) */
  elapsed: number | null;
  preset: number;
}

const EPS = 1e-6;
/** 끝 센서가 꺼지기까지 실린더가 움직이는 거리 (스트로크의 3%) */
export const SENSOR_BAND = 0.03;

interface CylState {
  pos: number;
  target: 0 | 1;
  atPlus: boolean;
  atMinus: boolean;
  /** 배관이 막혀(5/3 가운데 등) 그 자리에 멈춤 */
  hold: boolean;
}

export class CircuitSim {
  t = 0;
  readonly act = new Map<string, boolean>();
  readonly coilOn = new Map<string, boolean>();
  readonly timers = new Map<string, { coil: boolean; out: boolean; since: number }>();
  /** 타임 스위치: 다이얼이 가리키는 시각 (하루 안의 ms), 접점, 시계가 도는 중 (전원이 있을 때만 돈다) */
  readonly tsw = new Map<string, { dial: number; out: boolean; run: boolean }>();
  /** 3단 셀렉터 자리: -1 왼쪽, 0 가운데, 1 오른쪽 */
  readonly sel = new Map<string, -1 | 0 | 1>();
  /** 카운터: 센 수, 출력, 입력 (CP · RST) 이 들어와 있나 */
  readonly counters = new Map<string, { n: number; out: boolean; cp: boolean; rst: boolean }>();
  /**
   * 온도 묶음: since 시각의 온도, 바뀌는 속도 (℃/ms), 향하는 온도 (닿으면 멈춤),
   * forced = 조작 순서로 바꾸는 중 (부하와 상관없이 goal 까지)
   */
  readonly zones = new Map<string, { pv: number; since: number; rate: number; goal: number; forced: boolean }>();
  /** 온도 기기: 설정 온도 이상 (hot, 히스테리시스), 경보 온도 이상, 제어 출력 · 경보 출력 */
  readonly temps = new Map<string, { hot: boolean; alHot: boolean; out: boolean; al: boolean }>();
  /** 넷마다 이어진 묶음 (닫힌 접점까지 따라간 것) */
  private root: Int32Array = new Int32Array(0);
  /** 릴레이 동작 시간이 있을 때: 코일 · 타이머가 바뀔 예정 (c:태그 · t:태그) */
  private readonly pending = new Map<string, { want: boolean; at: number }>();
  /** 채터링 검사: 코일마다 최근 1초 동안 바뀐 시각 */
  private readonly flipLog = new Map<string, number[]>();
  /** 시작할 때 자리 잡는 동안은 릴레이 동작 시간을 두지 않는다 */
  private boot = false;
  readonly cyl = new Map<string, CylState>();
  /** 넷마다 닿은 극 ('short' = 단락, null = 전압 없음) */
  netPole: (string | null)[] = [];
  readonly energized = new Set<string>();
  readonly motorDir = new Map<string, 1 | -1>();
  readonly openPhase = new Set<string>();
  shorted = false;
  readonly plcIn = new Map<string, boolean[]>();
  readonly plcOut = new Map<string, boolean[]>();
  /** 3선식 센서·SMPS 에 전원이 들어와 있는가 */
  readonly powered = new Map<string, boolean>();
  /** 6단자 전동기의 결선: Y (기동) · D (Δ 운전) */
  readonly motorMode = new Map<string, 'Y' | 'D'>();
  /** 밸브 위치: a = 14쪽 솔레노이드, b = 12쪽(또는 스프링), c = 가운데 */
  readonly valvePos = new Map<string, 'a' | 'b' | 'c'>();
  /** 공압 넷마다 상태 (공압이 아닌 넷은 null) */
  airState: (AirState | null)[] = [];
  /** 속도 제어 밸브로 느려진 비율 (1 = 그대로) */
  readonly cylFactor = new Map<string, { ext: number; ret: number }>();
  private rt: PlcRuntime | null = null;
  /** PLC 전원이 꺼져 있었다 (다시 들어오면 처음부터 돈다: 유지하지 않는 M · 타이머가 지워짐) */
  private plcDown = false;
  /** 누전 (절연 불량) 중인 기기: 기호 → 절연 저항 (Ω) */
  readonly faults = new Map<string, number>();
  /** 누전 중인 기기의 지금 지락 계산 */
  readonly faultView = new Map<string, FaultResult>();
  /** 누전 사건 기록 (시각 · 글) — 화면 알림용 */
  readonly faultLog: { t: number; tag: string; text: string; level: FaultResult['level'] }[] = [];
  private faultAdj: ReturnType<typeof conductorGraph> | null = null;
  /** 지락으로 끊을 차단기: 기호 → 끊는 시각 (누전차단기 0.03 s, 순시 0.01 s 뒤) */
  private readonly tripAt = new Map<string, number>();
  /** HMI 버튼이 PLC 에 마지막으로 쓴 값 (바뀔 때만 쓴다) */
  private readonly hmiSent = new Map<string, boolean>();
  private nextScan: number | null = null;
  private scanK = 0;
  /** 기록이 마지막으로 바뀐 시각 */
  lastChangeT = 0;
  readonly warnings: string[] = [];
  private readonly warned = new Set<string>();
  readonly tracks: Track[] = [];
  /** 상태를 기록할 때마다 불린다 (전기 해석이 그때의 전류를 계산) */
  onRecord?: () => void;

  constructor(readonly m: CircuitModel) {
    for (const [tag, k] of m.tagKind) if (k === 'operator' || k === 'thr') this.act.set(tag, m.operatorDefault.get(tag) ?? false);
    for (const tag of m.coilParts.keys()) this.coilOn.set(tag, false);
    for (const tag of m.timerParts.keys()) this.timers.set(tag, { coil: false, out: false, since: 0 });
    for (const [tag, d] of m.tswDef) this.tsw.set(tag, { dial: this.clock0, out: schedOn(d.sched, this.clock0), run: false });
    // 3단 셀렉터: 그림에 둔 자리 (pos0) 에서 시작
    for (const tag of m.sel3) {
      const p = m.mainPart.get(tag);
      const at = p?.type === 'r_ss3' ? (p.pos0 ?? 0) : 0;
      this.sel.set(tag, at);
      if (at) this.act.set(tag, true);
    }
    for (const tag of m.counterDef.keys()) this.counters.set(tag, { n: 0, out: false, cp: false, rst: false });
    for (const [z, d] of m.tempZones) this.zones.set(z, { pv: d.amb, since: 0, rate: 0, goal: d.amb, forced: false });
    for (const tag of m.tempDef.keys()) this.temps.set(tag, { hot: false, alHot: false, out: false, al: false });
    for (const tag of m.cylDef.keys()) this.cyl.set(tag, { pos: 0, target: 0, atPlus: false, atMinus: true, hold: false });
    for (const v of m.valves) this.valvePos.set(v.part.id, v.part.type === 'v53' ? 'c' : 'b');
    for (const b of m.plcs) {
      this.plcIn.set(b.part.id, new Array<boolean>(b.inDev.length).fill(false));
      this.plcOut.set(b.part.id, new Array<boolean>(b.outDev.length).fill(false));
    }
    m.plcIssues.forEach((w) => this.warn(w));
    if (m.prog && m.plcSim && m.plcs.length) {
      try {
        this.rt = m.prog.createRuntime(m.plcSim);
        this.nextScan = 0;
      } catch (e) {
        this.warn(`PLC 를 시작하지 못했습니다: ${(e as Error).message}`);
      }
    }
    this.buildTracks();
    // 시작 상태는 전원이 들어와 자리 잡은 상태로 (릴레이 동작 시간 없이)
    this.boot = true;
    this.settle();
    if (this.rt) {
      this.scanPlc();
      this.settle();
    }
    this.boot = false;
    this.record();
  }

  /** 시뮬레이션을 시작한 시각 (하루 안의 ms) */
  get clock0(): number {
    const c = this.m.circuit.clock ?? 0;
    return ((c % DAY) + DAY) % DAY;
  }

  /** 지금 시각 (하루 안의 ms) */
  get clock(): number {
    return (this.clock0 + this.t) % DAY;
  }

  get hasPlc(): boolean {
    return this.rt !== null;
  }

  get scanTime(): number {
    return Math.max(0.1, this.m.plcSim?.scanTime ?? 10);
  }

  /** PLC 가 돌고 있는가 (실물 PLC 는 + · − 에 DC 24V, 기호 PLC 는 늘) */
  plcRunning(id: string): boolean {
    const b = this.m.plcs.find((x) => x.part.id === id);
    return !!b && (!b.power || !!this.powered.get(id));
  }

  /** HMI 화면: 전원 · 통신, 칸마다 눌림 · 디바이스 값 */
  hmiView(p: Part): { powered: boolean; online: boolean; pressed: boolean[]; bits: boolean[] } {
    const online = this.hmiOnline(p.id);
    const devs = this.m.hmiDevs.get(p.id) ?? [];
    return {
      powered: !!this.powered.get(p.id),
      online,
      pressed: (p.hmi ?? []).map((_, n) => !!this.act.get(hmiTag(p, n))),
      bits: devs.map((d) => (online && d ? !!this.plcBit(d) : false)),
    };
  }

  /** HMI 가 켜져 있고 PLC 와 통신하는가 */
  hmiOnline(id: string): boolean {
    return !!this.powered.get(id) && this.rt !== null && this.m.plcs.some((b) => this.plcRunning(b.part.id));
  }

  /** PLC 한 스캔: 입력 단자 전압 → 프로그램 → 출력 접점 */
  private scanPlc(): void {
    const up = this.m.plcs.filter((b) => this.plcRunning(b.part.id));
    if (!up.length) {
      // 전원이 없으면 멈춘다 (출력 모두 꺼짐)
      for (const b of this.m.plcs) this.plcOut.set(b.part.id, b.outDev.map(() => false));
      this.plcDown = true;
      this.nextScan = this.t + this.scanTime;
      return;
    }
    if (this.plcDown && this.m.prog && this.m.plcSim) {
      // 전원이 다시 들어오면 처음부터 (STOP → RUN)
      this.rt = this.m.prog.createRuntime(this.m.plcSim);
      this.hmiSent.clear();
      this.plcDown = false;
    }
    const rt = this.rt!;
    for (const b of up) {
      const com = b.com !== undefined ? this.netPole[b.com] : null;
      const ins = b.inNets.map((n) => {
        const p = this.netPole[n];
        // 실물: COM 과 반대 극 (싱크 = COM 0V · 입력 +24V, 소스 = COM +24V · 입력 0V). 기호: +24V · L 이 닿으면
        if (b.com !== undefined) return (p === '+24V' && com === '0V') || (p === '0V' && com === '+24V');
        return p === '+24V' || p === 'L1' || p === 'L2' || p === 'L3';
      });
      this.plcIn.set(b.part.id, ins);
      ins.forEach((v, i) => rt.writeBit(b.inDev[i], v));
    }
    // HMI 버튼: 바뀔 때만 디바이스에 쓴다 (프로그램이 같은 비트를 지워도 덮어쓰지 않게)
    for (const [tag, h] of this.m.hmiDef) {
      const v = !!this.act.get(tag) && this.hmiOnline(h.part.id);
      if (this.hmiSent.get(tag) === v) continue;
      this.hmiSent.set(tag, v);
      try {
        rt.writeBit(h.dev, v);
      } catch {
        this.warn(`HMI 버튼 ${this.m.label(tag)} 의 디바이스 ${h.dev} 를 PLC 에 쓸 수 없습니다`);
      }
    }
    rt.scan(this.t, this.scanK++);
    for (const b of this.m.plcs) this.plcOut.set(b.part.id, b.outDev.map((d) => this.plcRunning(b.part.id) && rt.readBit(d)));
    this.nextScan = this.t + this.scanTime;
  }

  // ───────────── 상태 읽기 ─────────────

  /** 기호가 동작 중인가 (코일 여자, 타이머 출력, 스위치 눌림, 센서 감지) */
  on(tag: string): boolean {
    switch (this.m.tagKind.get(tag)) {
      case 'coil':
        return this.coilOn.get(tag) ?? false;
      case 'timer':
        return this.timers.get(tag)?.out ?? false;
      case 'tsw':
        return this.tsw.get(tag)?.out ?? false;
      case 'counter':
        return this.counters.get(tag)?.out ?? false;
      case 'temp': {
        const st = this.temps.get(tag);
        return !!st && (this.m.tempDef.get(tag)!.tc ? st.out : st.hot);
      }
      case 'thr':
      case 'operator':
        return this.act.get(tag) ?? false;
      case 'sensor': {
        const s = this.m.sensorDef.get(tag)!;
        const c = this.cyl.get(s.cyl);
        if (!c) return false;
        return s.end === '+' ? c.atPlus : c.atMinus;
      }
      default:
        return false;
    }
  }

  /** 접점 (부품) 이 닫혀 있는가 */
  closed(p: Part): boolean {
    if (p.type === 'fuse' || p.type === 'fuse3' || p.type === 'r_tb') return true;
    if (p.type === 'sw_no' && p.sel) return this.selPos(tagKey(p)) === p.sel;
    if (p.type === 'r_prox2' || p.type === 'r_thermo') return this.on(tagKey(p)) !== !!p.ncOut;
    if ((p.type === 'no' || p.type === 'nc') && p.inst13) return !!this.timers.get(tagKey(p))?.coil !== (p.type === 'nc');
    const v = this.on(tagKey(p));
    return PARTS[p.type].nc ? !v : v;
  }

  loadOn(tag: string): boolean {
    return (this.m.loadParts.get(tag) ?? []).some((id) => this.energized.has(id));
  }

  /** 온도 묶음의 지금 온도 (℃) */
  zoneTemp(zone: string): number {
    const s = this.zones.get(zone);
    if (!s) return 0;
    if (!s.rate) return s.pv;
    const v = s.pv + s.rate * (this.t - s.since);
    return s.rate > 0 ? Math.min(s.goal, v) : Math.max(s.goal, v);
  }

  tempView(tag: string): TempView | null {
    const d = this.m.tempDef.get(tag);
    const st = this.temps.get(tag);
    const z = d && this.zones.get(d.zone);
    if (!d || !st || !z) return null;
    return { pv: this.zoneTemp(d.zone), sv: d.sv, hot: st.hot, out: st.out, al: st.al, dir: z.rate > 0 ? 1 : z.rate < 0 ? -1 : 0 };
  }

  /** 온도 기기가 재는 온도를 value 로 바꾼다 (ramp ms 동안 일정하게, 0 이면 바로) */
  private setTemp(tag: string, value: number, ramp: number): boolean {
    const d = this.m.tempDef.get(tag);
    const s = d && this.zones.get(d.zone);
    if (!d || !s) return false;
    s.pv = this.zoneTemp(d.zone);
    s.since = this.t;
    if (ramp > 0 && Math.abs(value - s.pv) > 1e-6) {
      s.forced = true;
      s.goal = value;
      s.rate = (value - s.pv) / ramp;
    } else {
      // 바로 바꾸면 차트에 수직선이 되도록 바로 앞 (0.001 ms) 에 지금 온도를 찍어 둔다
      const tr = this.tracks.find((x) => x.key === `tv:${d.zone}`);
      const t0 = Math.round((this.t - 0.001) * 1000) / 1000;
      if (tr && Math.abs(value - s.pv) > 1e-6 && t0 > (tr.points[tr.points.length - 1]?.t ?? 0)) tr.points.push({ t: t0, v: Math.round(s.pv * 100) / 100 });
      s.pv = value;
      s.goal = value;
      s.rate = 0;
      s.forced = false;
    }
    return true;
  }

  /** 시뮬레이션 중 온도를 바꾼다 (온도 기기를 눌러서) */
  changeTemp(tag: string, value: number, ramp = 0): boolean {
    if (!this.setTemp(tag, value, ramp)) return false;
    this.settle();
    this.record();
    return true;
  }

  /** 부하 (히터 · 팬) 상태에 따라 온도가 향하는 곳과 속도를 다시 정한다 */
  private retarget(): void {
    for (const [z, s] of this.zones) {
      if (s.forced) continue;
      const d = this.m.tempZones.get(z)!;
      s.pv = this.zoneTemp(z);
      s.since = this.t;
      if (!d.load) {
        s.rate = 0;
        s.goal = s.pv;
        continue;
      }
      // 가열 부하가 켜졌거나, 식히는 부하 (팬) 가 꺼졌으면 최고 온도 쪽으로
      const heating = this.loadOn(d.load) !== d.loadCool;
      s.goal = heating ? d.tmax : d.amb;
      s.rate = s.pv < s.goal - 1e-6 ? d.rise / 1000 : s.pv > s.goal + 1e-6 ? -d.fall / 1000 : 0;
    }
  }

  /** PLC 디바이스 값 (래더 모니터): PLC 가 없으면 null */
  plcBit(dev: string): boolean | null {
    if (!this.rt) return null;
    try {
      return this.rt.readBit(dev);
    } catch {
      return null;
    }
  }

  timerView(tag: string): TimerView | null {
    const st = this.timers.get(tag);
    const def = this.m.timerDef.get(tag);
    if (!st || !def) return null;
    const pending = def.mode === 'on' ? st.coil && !st.out : def.mode === 'flicker' ? st.coil : def.mode === 'interval' ? st.coil && st.out : !st.coil && st.out;
    return { coil: st.coil, out: st.out, elapsed: pending ? this.t - st.since : null, preset: timerSpan(def, st.out) };
  }

  cylPos(tag: string): number {
    return this.cyl.get(tag)?.pos ?? 0;
  }

  // ───────────── 조작 ─────────────

  setAct(tag: string, on: boolean): boolean {
    const k = this.m.tagKind.get(tag);
    if (k !== 'operator' && k !== 'thr') return false;
    if (this.m.sel3.has(tag)) return this.setPos(tag, on ? 1 : 0);
    if ((this.act.get(tag) ?? false) === on) return false;
    this.act.set(tag, on);
    this.settle();
    this.record();
    return true;
  }

  /** 3단 셀렉터를 돌린다 (-1 왼쪽, 0 가운데, 1 오른쪽) */
  setPos(tag: string, pos: -1 | 0 | 1): boolean {
    if (!this.m.sel3.has(tag)) return pos === 0 ? this.setAct(tag, false) : this.setAct(tag, true);
    if ((this.sel.get(tag) ?? 0) === pos) return false;
    this.sel.set(tag, pos);
    this.act.set(tag, pos !== 0);
    this.settle();
    this.record();
    return true;
  }

  /** 같은 순간의 조작을 한꺼번에 바꾸고 한 번만 자리 잡는다 (두 버튼을 동시에 누름 · 뗌) */
  applyAll(list: { tag: string; on: boolean; pos?: -1 | 0 | 1; temp?: number; ramp?: number; leak?: number | null }[]): void {
    let changed = false;
    for (const e of list) {
      if (e.leak !== undefined) {
        if (!this.m.faultDev.has(e.tag)) continue;
        if (e.leak === null) {
          if (!this.faults.delete(e.tag)) continue;
          this.faultView.delete(e.tag);
        } else if (this.faults.get(e.tag) === e.leak) continue;
        else this.faults.set(e.tag, Math.max(0, e.leak));
        changed = true;
        continue;
      }
      if (e.temp !== undefined) {
        changed = this.setTemp(e.tag, e.temp, e.ramp ?? 0) || changed;
        continue;
      }
      if (this.m.sel3.has(e.tag)) {
        const pos = e.pos ?? (e.on ? 1 : 0);
        if ((this.sel.get(e.tag) ?? 0) === pos) continue;
        this.sel.set(e.tag, pos);
        this.act.set(e.tag, pos !== 0);
        changed = true;
      } else {
        const on = e.pos !== undefined ? e.pos !== 0 : e.on;
        if ((this.act.get(e.tag) ?? false) === on) continue;
        this.act.set(e.tag, on);
        changed = true;
      }
    }
    if (!changed) return;
    this.settle();
    this.record();
  }

  /** 기기에 누전을 일으키거나 (절연 저항 Ω, 0 = 완전 지락) 없앤다 (null) */
  setLeak(tag: string, rf: number | null): boolean {
    if (!this.m.faultDev.has(tag)) return false;
    if (rf === null ? !this.faults.has(tag) : this.faults.get(tag) === rf) return false;
    if (rf === null) {
      this.faults.delete(tag);
      this.faultView.delete(tag);
    } else this.faults.set(tag, Math.max(0, rf));
    this.settle();
    this.record();
    return true;
  }

  /** 누전 중인 기기마다 지락 전류를 계산하고, 끊는 차단기가 있으면 끊는다 (끊었으면 true) */
  private faultStep(): boolean {
    const cfg = earthingOf(this.m.circuit);
    this.faultAdj ??= conductorGraph(this.m.conductors);
    const src = phaseSources(this.m);
    let tripped = false;
    for (const [tag, rf] of this.faults) {
      const d = this.m.faultDev.get(tag)!;
      const earthed = d.pe === null ? !REAL.has(d.part.type) : this.netPole[d.pe] === 'PE';
      // 전압이 걸린 충전부에서 전원 쪽으로 (지금 닫힌 접점만)
      const live = d.live.filter((n) => {
        const p = this.netPole[n];
        return p === 'L1' || p === 'L2' || p === 'L3';
      });
      const path = live.length ? feedPath(this.faultAdj, live, src, (k) => this.conductorClosed(k)) : null;
      const r = earthFault(path ? phaseVolt(this.m.circuit, path.phase) : 0, earthed, rf, cfg, path?.protectors ?? []);
      this.faultView.set(tag, r);
      if (r.u0 <= 0) continue;
      const key = `fault:${tag}:${rf}:${r.trip?.part.id ?? ''}:${earthed}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        const text = faultText(this.m.label(tag), r, cfg);
        this.faultLog.push({ t: this.t, tag, text, level: r.level });
        this.warnings.push(`${formatTime(this.t, 's')}: ${text}`);
      }
      if (r.trip) {
        const bt = tagKey(r.trip.part);
        // 끊는 데 걸리는 시간 동안은 지락 전류가 흐른다 (차트에 보이게). 시작할 때 (boot) 는 바로
        if (this.act.get(bt) !== false && !this.tripAt.has(bt)) {
          if (this.boot) {
            this.act.set(bt, false);
            tripped = true;
          } else this.tripAt.set(bt, this.t + (r.trip.why === 'rcd' ? 30 : 10));
        }
      }
    }
    return tripped;
  }

  selPos(tag: string): -1 | 0 | 1 {
    return this.sel.get(tag) ?? 0;
  }

  // ───────────── 계산 ─────────────

  private warn(msg: string, key = msg): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(msg);
  }

  /** 이 접점 (극) 이 지금 통하는가 */
  conductorClosed(c: Conductor): boolean {
    if (c.sel !== undefined) return (this.sel.get(c.tag) ?? 0) === c.sel;
    if (c.al) return !!this.temps.get(c.tag)?.al;
    const closed = c.plcOut !== undefined ? !!this.plcOut.get(c.part.id)?.[c.plcOut] && this.plcRunning(c.part.id) : c.always || (c.inst ? !!this.timers.get(c.tag)?.coil : this.on(c.tag)) !== c.nc;
    return closed && !(c.power && !this.powered.get(c.power));
  }

  private evaluate(): void {
    const n = this.m.net.count;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const sources = [...this.m.sources];
    for (const s of this.m.smpsList) {
      if (!this.powered.get(s.part.id)) continue;
      sources.push({ net: s.outP, id: '+24V' }, { net: s.outM, id: '0V' });
    }
    for (const t of this.m.trList) {
      if (!this.powered.get(t.part.id)) continue;
      ['L1', 'L2', 'L3'].forEach((id, k) => poleLive(this.m.circuit, id) && sources.push({ net: t.x[k], id }));
      if (poleLive(this.m.circuit, 'N')) sources.push({ net: t.x0, id: 'N' });
    }
    const join = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const dc2: Conductor[] = [];
    for (const c of this.m.conductors) {
      if (!this.conductorClosed(c)) continue;
      if (c.dc2) dc2.push(c);
      else join(c.a, c.b);
    }
    // 직류 2선식 센서: 나머지를 다 이은 뒤 극성을 보고 (갈색이 0V 쪽 · 파랑이 + 쪽이면 거꾸로라 켜지지 않음) 잇는다
    for (let changed = dc2.length > 0; changed; ) {
      changed = false;
      const at = new Map<number, Set<string>>();
      for (const s of sources) at.set(find(s.net), (at.get(find(s.net)) ?? new Set<string>()).add(s.id));
      for (let i = dc2.length - 1; i >= 0; i--) {
        const c = dc2[i];
        const bn = at.get(find(c.a)) ?? new Set<string>();
        const bu = at.get(find(c.b)) ?? new Set<string>();
        if ((bu.has('+24V') && !bn.has('+24V')) || (bn.has('0V') && !bu.has('0V'))) continue;
        join(c.a, c.b);
        dc2.splice(i, 1);
        changed = true;
      }
    }
    const poles = new Map<number, Set<string>>();
    for (const s of sources) {
      const r = find(s.net);
      const set = poles.get(r) ?? new Set<string>();
      set.add(s.id);
      poles.set(r, set);
    }
    this.shorted = false;
    const groupPole = new Map<number, string>();
    for (const [r, set] of poles) {
      if (set.size > 1) {
        groupPole.set(r, 'short');
        this.shorted = true;
        this.warn(`${formatTime(this.t, 's')}: 단락 - ${[...set].join(', ')} 이(가) 바로 이어졌습니다`, `short:${[...set].sort().join()}`);
      } else groupPole.set(r, [...set][0]);
    }
    this.netPole = Array.from({ length: n }, (_, i) => groupPole.get(find(i)) ?? null);
    this.root = Int32Array.from({ length: n }, (_, i) => find(i));

    this.energized.clear();
    this.motorMode.clear();
    this.motorDir.clear();
    this.openPhase.clear();
    const live = (net: number | undefined) => {
      const p = net === undefined ? null : this.netPole[net];
      return p && p !== 'short' ? p : null;
    };
    for (const p of this.m.loads) {
      const def = PARTS[p.type];
      let nets = def.pins.map((_, i) => this.m.net.pinNet.get(`${p.id}:${i}`));
      const lp = def.selfCoil ?? def.loadPins;
      if (lp) nets = lp.map((i) => nets[i]);
      if (p.type === 'r_motor6') {
        // 6단자 전동기: 권선 U1-U2 · V1-V2 · W1-W2. 한쪽 끝 (U1 V1 W1) 에 세 상이 닿고,
        // 반대쪽 끝이 한데 묶이면 Y 결선, 저마다 다른 상에 닿으면 Δ 결선으로 돈다
        const idx = nets.slice(0, 3).map((x) => ['L1', 'L2', 'L3'].indexOf(live(x) ?? ''));
        if (new Set(idx.filter((i) => i >= 0)).size === 3) {
          const far = [nets[4], nets[5], nets[3]]; // U2 V2 W2
          const star = far.every((x) => x !== undefined) && find(far[0]!) === find(far[1]!) && find(far[1]!) === find(far[2]!) && !live(far[0]);
          const delta = far.every((x, k) => {
            const f = ['L1', 'L2', 'L3'].indexOf(live(x) ?? '');
            return f >= 0 && f !== idx[k];
          });
          if (star || delta) {
            this.energized.add(p.id);
            this.motorDir.set(p.id, (idx[1] - idx[0] + 3) % 3 === 1 ? 1 : -1);
            this.motorMode.set(p.id, star ? 'Y' : 'D');
          }
        } else if (new Set(idx.filter((i) => i >= 0)).size === 2) {
          this.openPhase.add(p.id);
          this.warn(`${p.tag || 'M'}: 결상 - 두 상만 이어져서 돌지 않습니다`, `open:${p.id}`);
        }
        continue;
      }
      if (p.type === 'motor3' || p.type === 'r_motor3' || p.type === 'r_load3') {
        const ph = nets.slice(0, 3).map(live);
        const idx = ph.map((x) => (x === 'L1' ? 0 : x === 'L2' ? 1 : x === 'L3' ? 2 : -1));
        const distinct = new Set(idx.filter((i) => i >= 0));
        if (distinct.size === 3) {
          this.energized.add(p.id);
          const [u, v] = idx;
          this.motorDir.set(p.id, (v - u + 3) % 3 === 1 ? 1 : -1);
        } else if (distinct.size === 2) {
          this.openPhase.add(p.id);
          this.warn(p.type === 'r_load3' ? `${p.tag || 'LD'}: 결상 - 두 상만 이어졌습니다` : `${p.tag || 'M'}: 결상 - 두 상만 이어져서 돌지 않습니다`, `open:${p.id}`);
        }
        continue;
      }
      const a = live(nets[0]);
      const b = live(nets[1]);
      // SSR 입력은 극성이 있다 (3 = +, 4 = -)
      if (p.type === 'r_ssr' && !(a === '+24V' && b === '0V')) continue;
      if (a && b && a !== b && POLE_SYSTEM[a] === POLE_SYSTEM[b]) {
        this.energized.add(p.id);
        // 직류 전동기만 극성으로 방향이 바뀐다
        if (p.type === 'motor') this.motorDir.set(p.id, a === '0V' ? -1 : 1);
      }
    }
  }

  /** 코일·타이머·실린더 하나를 바꾸면 true */
  /** 릴레이 동작 시간이 있으면 바로 바꾸지 않고 예약한다. 바꿨으면 true */
  /** 1초 안에 10번 넘게 붙었다 떨어지면 채터링으로 알린다 (자기 b접점으로 자기를 끊는 회로 등) */
  private chatterCheck(key: string): boolean {
    if (this.warned.has(`chatter:${key}`)) return false;
    const list = this.flipLog.get(key) ?? [];
    list.push(this.t);
    while (list.length && list[0] < this.t - 1000 - EPS) list.shift();
    this.flipLog.set(key, list);
    if (list.length < 10) return false;
    this.warned.add(`chatter:${key}`);
    this.flipLog.delete(key);
    return true;
  }

  private delayed(key: string, want: boolean, cur: boolean): boolean {
    if (this.m.relayMs <= 0 || this.boot) return false;
    const pd = this.pending.get(key);
    if (want === cur) this.pending.delete(key);
    else if (!pd || pd.want !== want) this.pending.set(key, { want, at: this.t + this.m.relayMs });
    return true;
  }

  private setTimerCoil(tag: string, want: boolean): void {
    const st = this.timers.get(tag)!;
    const def = this.m.timerDef.get(tag)!;
    st.coil = want;
    st.since = this.t;
    if (def.mode === 'on') {
      if (!want) st.out = false;
      else if (def.preset <= 0) st.out = true;
    } else if (def.mode === 'flicker') st.out = want;
    // 인터벌 (원샷): 코일이 들어오면 바로 ON, 설정 시간 뒤 OFF (코일이 들어와 있어도). 코일이 빠지면 OFF
    else if (def.mode === 'interval') st.out = want && def.preset > 0;
    else if (want) st.out = true;
    else if (def.preset <= 0) st.out = false;
  }

  private stepOnce(): boolean {
    for (const [tag, ids] of this.m.coilParts) {
      const want = ids.some((id) => this.energized.has(id));
      const cur = this.coilOn.get(tag) ?? false;
      if (this.delayed(`c:${tag}`, want, cur)) continue;
      if (want !== cur) {
        this.coilOn.set(tag, want);
        return true;
      }
    }
    for (const [tag, ids] of this.m.timerParts) {
      const want = ids.some((id) => this.energized.has(id));
      const st = this.timers.get(tag)!;
      if (this.delayed(`t:${tag}`, want, st.coil)) continue;
      if (want === st.coil) continue;
      this.setTimerCoil(tag, want);
      return true;
    }
    // 타임 스위치: 시계 전원, 다이얼 위치에 따른 접점
    for (const [tag, d] of this.m.tswDef) {
      const st = this.tsw.get(tag)!;
      const run = powerBetween(this.netPole[d.l], this.netPole[d.n]);
      if (run !== st.run) {
        st.run = run;
        return true;
      }
      const out = schedOn(d.sched, st.dial);
      if (out !== st.out) {
        st.out = out;
        return true;
      }
    }
    // 온도 기기: 설정 온도에 닿으면 동작, 히스테리시스만큼 내려가야 되돌아감. 온도 조절기는 전원 (A1 · A2) 이 있어야 출력
    for (const [tag, d] of this.m.tempDef) {
      const st = this.temps.get(tag)!;
      const pv = this.zoneTemp(d.zone);
      const hot = st.hot ? pv > d.sv - d.hys + 1e-6 : pv >= d.sv - 1e-6;
      const alHot = d.alarm !== null && (st.alHot ? pv > d.alarm - d.hys + 1e-6 : pv >= d.alarm - 1e-6);
      const pw = !d.tc || this.energized.has(d.part.id);
      const out = d.tc ? pw && (d.cool ? hot : !hot) : hot;
      const al = d.tc && pw && alHot;
      if (hot !== st.hot || alHot !== st.alHot || out !== st.out || al !== st.al) {
        Object.assign(st, { hot, alHot, out, al });
        return true;
      }
    }
    // 카운터: 전원 (A1 · A2) 이 있을 때 CP 가 COM 과 이어지는 순간마다 하나씩 센다. RST 가 이어지면 0 으로
    for (const [tag, d] of this.m.counterDef) {
      const st = this.counters.get(tag)!;
      const pw = this.energized.has(d.part.id);
      const cp = this.root[d.cp] === this.root[d.com];
      const rst = this.root[d.rst] === this.root[d.com];
      if (rst !== st.rst) {
        st.rst = rst;
        if (rst && pw) st.n = 0;
        return true;
      }
      if (cp !== st.cp) {
        st.cp = cp;
        if (cp && pw && !rst) st.n = Math.min(999999, st.n + 1);
        return true;
      }
      if (rst && pw && st.n !== 0) {
        st.n = 0;
        return true;
      }
      const out = pw && st.n >= d.preset;
      if (out !== st.out) {
        st.out = out;
        return true;
      }
    }
    // 3선식 센서·SMPS 전원
    for (const s of this.m.proxs) {
      const want = powerBetween(this.netPole[s.bn], this.netPole[s.bu], true);
      if (want !== (this.powered.get(s.part.id) ?? false)) {
        this.powered.set(s.part.id, want);
        return true;
      }
    }
    for (const s of this.m.smpsList) {
      const want = powerBetween(this.netPole[s.inL], this.netPole[s.inN]);
      if (want !== (this.powered.get(s.part.id) ?? false)) {
        this.powered.set(s.part.id, want);
        return true;
      }
    }
    // 실물 PLC · HMI: + 에 +24V, − 에 0V (거꾸로면 안 켜짐)
    for (const b of this.m.plcs) {
      if (!b.power) continue;
      const want = powerBetween(this.netPole[b.power[0]], this.netPole[b.power[1]], true);
      if (want !== (this.powered.get(b.part.id) ?? false)) {
        this.powered.set(b.part.id, want);
        if (!want) this.plcOut.set(b.part.id, b.outDev.map(() => false));
        return true;
      }
    }
    for (const h of this.m.hmis) {
      const want = powerBetween(this.netPole[h.plus], this.netPole[h.minus], true);
      if (want !== (this.powered.get(h.part.id) ?? false)) {
        this.powered.set(h.part.id, want);
        return true;
      }
    }
    // 변압기: 1차에 특고압 세 상이 서로 다르게 닿아야 2차에 전압이 나온다
    for (const t of this.m.trList) {
      const ph = t.h.map((n) => this.netPole[n]);
      const want = ph.every((x) => x === 'H1' || x === 'H2' || x === 'H3') && new Set(ph).size === 3;
      if (want !== (this.powered.get(t.part.id) ?? false)) {
        this.powered.set(t.part.id, want);
        return true;
      }
    }
    // 밸브 위치 (양솔은 마지막 위치 유지, 5/3 은 둘 다 꺼지면 가운데)
    for (const v of this.m.valves) {
      const a = !!v.solA && this.loadOn(v.solA);
      const b = !!v.solB && this.loadOn(v.solB);
      const cur = this.valvePos.get(v.part.id)!;
      let pos = cur;
      if (v.part.type === 'v32' || v.part.type === 'v52') pos = a ? 'a' : 'b';
      else if (a && !b) pos = 'a';
      else if (b && !a) pos = 'b';
      else if (v.part.type === 'v53' && !a && !b) pos = 'c';
      this.valvePos.set(v.part.id, pos);
    }
    const groupOf = this.evaluateAir();
    let jumped = false;
    for (const [tag, def] of this.m.cylDef) {
      const st = this.cyl.get(tag)!;
      let target = st.target;
      const ports = this.m.cylPorts.get(tag);
      if (ports && (ports.capTubed || ports.rodTubed)) {
        // 배관: 헤드 쪽 압력 → 전진, 로드 쪽 압력 → 후진. 로드 쪽 배관이 없으면 단동(스프링 복귀)
        const cap = ports.capTubed ? this.airState[ports.cap] : 'E';
        const rod = ports.rodTubed ? this.airState[ports.rod] : 'E';
        let drive: 0 | 1 | null = null;
        if (!ports.rodTubed) drive = cap === 'P' ? 1 : cap === 'E' ? 0 : null;
        else if (cap === 'P' && rod !== 'P') drive = 1;
        else if (rod === 'P' && cap !== 'P') drive = 0;
        // 양쪽이 막혔거나 양쪽에 압력: 그 자리에 멈춤
        st.hold = drive === null && st.pos !== st.target;
        if (drive !== null) target = drive;
        // 속도 제어(미터 아웃): 배기되는 쪽 배관에 있으면 그 방향이 느려진다
        const slow = (net: number, tubed: boolean) => {
          if (!tubed) return 1;
          const g = groupOf(net);
          return Math.min(1, ...this.m.flowCtrls.filter((f) => groupOf(f.net) === g).map((f) => f.speed / 100));
        };
        this.cylFactor.set(tag, { ext: rod !== 'P' ? slow(ports.rod, ports.rodTubed) : 1, ret: cap !== 'P' ? slow(ports.cap, ports.capTubed) : 1 });
      } else {
        const plus = def.solPlus ? this.loadOn(normTag(def.solPlus)) : false;
        const minus = def.solMinus ? this.loadOn(normTag(def.solMinus)) : false;
        if (def.solMinus?.trim()) {
          if (plus && !minus) target = 1;
          else if (minus && !plus) target = 0;
        } else target = plus ? 1 : 0;
      }
      if (target === st.target) continue;
      st.target = target;
      if (this.strokeTime(def, target) <= 0) {
        st.pos = target;
        st.atPlus = target === 1;
        st.atMinus = target === 0;
        jumped = true;
      }
    }
    return jumped;
  }

  private strokeTime(def: Part, target: 0 | 1): number {
    const base = Math.max(0, target ? def.stroke ?? 1000 : def.strokeBack ?? def.stroke ?? 1000);
    const f = this.cylFactor.get(tagKey(def));
    return f ? base / Math.max(0.05, target ? f.ext : f.ret) : base;
  }

  /** 공압: 공압원에서 밸브 통로를 따라 압력이 닿는 곳, 밸브 배기구로 빠지는 곳 */
  private evaluateAir(): (net: number) => number {
    const m = this.m;
    const n = m.net.count;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const [a, b] of m.airAlways) union(a, b);
    const vents: number[] = [];
    for (const v of m.valves) {
      const pos = this.valvePos.get(v.part.id)!;
      if (v.part.type === 'v32') {
        // 2 = A, 1 = P: 켜지면 P→A, 꺼지면 A→배기
        if (pos === 'a') union(v.ports[1], v.ports[0]);
        else vents.push(v.ports[0]);
      } else {
        // 4 = A, 2 = B, 1 = P: a 위치 1→4 · 2 배기, b 위치 1→2 · 4 배기, c 모두 막힘
        if (pos === 'a') {
          union(v.ports[2], v.ports[0]);
          vents.push(v.ports[1]);
        } else if (pos === 'b') {
          union(v.ports[2], v.ports[1]);
          vents.push(v.ports[0]);
        }
      }
    }
    const press = new Set(m.airSrc.map(find));
    const vent = new Set(vents.map(find));
    this.airState = Array.from({ length: n }, (_, i) => {
      if (!m.airNets.has(i)) return null;
      const r = find(i);
      if (press.has(r)) {
        if (vent.has(r)) this.warn(`${formatTime(this.t, 's')}: 공압이 밸브 배기구로 새고 있습니다 (배관 확인)`, 'airleak');
        return 'P';
      }
      return vent.has(r) ? 'E' : 'X';
    });
    return find;
  }

  settle(): void {
    // 같은 순간에 붙었다 떨어지는 코일 (0초 펄스) 을 찾으려고 바뀐 횟수를 센다
    const snap = () => new Map<string, boolean>([...[...this.coilOn].map(([t, v]) => [`c:${t}`, v] as [string, boolean]), ...[...this.timers].map(([t, v]) => [`t:${t}`, v.coil] as [string, boolean])]);
    let last = snap();
    const flips = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      this.evaluate();
      if (!this.stepOnce()) {
        // 누전: 지락 전류로 차단기가 끊으면 다시 자리 잡는다
        if (this.faults.size && this.faultStep()) continue;
        this.retarget();
        // 한 번에 한 줄로: 아직 알리지 않은 코일만 모아서
        const keys = [...flips].filter(([key, k]) => k >= 2 && !this.warned.has(`pulse:${key}`)).map(([key]) => key);
        if (keys.length) {
          for (const key of keys) this.warned.add(`pulse:${key}`);
          const tags = [...new Set(keys.map((key) => this.m.label(key.slice(2))))].join(' · ');
          this.warnings.push(
            `${formatTime(this.t, 's')}: ${tags} 이(가) 같은 순간에 붙었다 떨어집니다 (0초 펄스). 자기 접점 (또는 그 뒤의 접점) 이 자기 회로를 끊는 구성이라, 실제로는 릴레이가 붙는 수십 ms 동안만 동작해서 그 사이 다른 출력이 잠깐 끊기거나 타이머가 다시 시작합니다. 조작 순서 탭의 [릴레이 동작 시간] 을 넣으면 실제처럼 볼 수 있습니다`,
          );
        }
        return;
      }
      const now = snap();
      for (const [key, v] of now) if (last.get(key) !== v) flips.set(key, (flips.get(key) ?? 0) + 1);
      last = now;
    }
    this.retarget();
    this.warn(`${formatTime(this.t, 's')}: 릴레이가 계속 켜졌다 꺼졌다 합니다 (발진)`, 'osc');
  }

  /** 다음 사건 시각 (타이머 만료, 실린더 도착·끝 센서 벗어남, PLC 스캔) */
  nextEvent(withScan = true): number | null {
    let best = withScan && this.nextScan !== null ? this.nextScan : Infinity;
    for (const pd of this.pending.values()) best = Math.min(best, pd.at);
    for (const at of this.tripAt.values()) best = Math.min(best, at);
    // 온도: 향하는 온도, 설정 · 경보 온도 (오를 때) 와 되돌아가는 온도 (내릴 때) 에 닿는 시각
    for (const [z, s] of this.zones) {
      if (!s.rate) continue;
      const pv = this.zoneTemp(z);
      const marks = [s.goal];
      for (const d of this.m.tempDef.values()) {
        if (d.zone !== z) continue;
        if (s.rate > 0) marks.push(d.sv, ...(d.alarm !== null ? [d.alarm] : []));
        else marks.push(d.sv - d.hys, ...(d.alarm !== null ? [d.alarm - d.hys] : []));
      }
      for (const m of marks) if (s.rate > 0 ? m > pv + 1e-6 : m < pv - 1e-6) best = Math.min(best, this.t + (m - pv) / s.rate);
    }
    for (const [tag, st] of this.timers) {
      const def = this.m.timerDef.get(tag)!;
      if ((def.mode === 'on' && st.coil && !st.out) || (def.mode === 'off' && !st.coil && st.out) || (def.mode === 'flicker' && st.coil && def.preset > 0) || (def.mode === 'interval' && st.coil && st.out)) best = Math.min(best, st.since + timerSpan(def, st.out));
    }
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target || st.hold) continue;
      const time = this.strokeTime(this.m.cylDef.get(tag)!, st.target);
      best = Math.min(best, this.t + Math.abs(st.target - st.pos) * time);
      if (st.atPlus && st.target === 0) best = Math.min(best, this.t + Math.max(0, st.pos - (1 - SENSOR_BAND)) * time);
      if (st.atMinus && st.target === 1) best = Math.min(best, this.t + Math.max(0, SENSOR_BAND - st.pos) * time);
    }
    // 타임 스위치: 다이얼이 다음 켜짐·꺼짐 시각에 닿을 때
    for (const [tag, st] of this.tsw) {
      if (!st.run) continue;
      for (const b of this.m.tswDef.get(tag)!.sched.flat()) {
        const d = (b - st.dial + DAY) % DAY;
        if (d > 1e-3) best = Math.min(best, this.t + d);
      }
    }
    return best === Infinity ? null : Math.max(best, this.t);
  }

  private moveTo(t2: number): void {
    const dt = t2 - this.t;
    for (const [tag, st] of this.cyl) {
      if (st.pos === st.target || st.hold) continue;
      if (dt > 0) {
        const time = this.strokeTime(this.m.cylDef.get(tag)!, st.target);
        const step = time > 0 ? dt / time : 1;
        st.pos = st.target === 1 ? Math.min(1, st.pos + step) : Math.max(0, st.pos - step);
        if (Math.abs(st.pos - st.target) < EPS) st.pos = st.target;
      }
      if (st.pos >= 1 - EPS) st.atPlus = true;
      else if (st.pos <= 1 - SENSOR_BAND + EPS) st.atPlus = false;
      if (st.pos <= EPS) st.atMinus = true;
      else if (st.pos >= SENSOR_BAND - EPS) st.atMinus = false;
    }
    for (const s of this.zones.values()) {
      if (!s.rate) {
        s.since = Math.max(s.since, t2);
        continue;
      }
      const v = s.pv + s.rate * (t2 - s.since);
      s.pv = s.rate > 0 ? Math.min(s.goal, v) : Math.max(s.goal, v);
      s.since = t2;
      if (Math.abs(s.pv - s.goal) < 1e-6) {
        s.pv = s.goal;
        s.rate = 0;
        s.forced = false;
      }
    }
    if (dt > 0) {
      for (const [tag, st] of this.tsw) {
        if (!st.run) continue;
        st.dial = (st.dial + dt) % DAY;
        // 켜짐·꺼짐 시각에 딱 맞춘다 (소수 오차로 한 사건을 놓치지 않게)
        for (const b of this.m.tswDef.get(tag)!.sched.flat()) if (Math.abs(st.dial - b) < 1e-3 || Math.abs(st.dial - b - DAY) < 1e-3) st.dial = b;
      }
    }
    this.t = Math.max(this.t, t2);
  }

  /** to 까지 시간을 진행 (사이의 사건을 차례로 처리) */
  advanceTo(to: number): void {
    for (let guard = 0; guard < 200000; guard++) {
      const next = this.nextEvent();
      if (next === null || next > to + EPS) {
        this.moveTo(to);
        return;
      }
      this.moveTo(next);
      // 지락으로 차단기가 끊는 시각
      for (const [bt, at] of [...this.tripAt]) {
        if (at > this.t + EPS) continue;
        this.tripAt.delete(bt);
        this.act.set(bt, false);
      }
      // 릴레이 동작 시간이 지난 코일 · 타이머
      const chatter: string[] = [];
      for (const [key, pd] of [...this.pending]) {
        if (pd.at > this.t + EPS) continue;
        this.pending.delete(key);
        const tag = key.slice(2);
        if (this.chatterCheck(key)) chatter.push(this.m.label(tag));
        if (key[0] === 'c') this.coilOn.set(tag, pd.want);
        else if (this.timers.get(tag)!.coil !== pd.want) this.setTimerCoil(tag, pd.want);
      }
      if (chatter.length)
        this.warnings.push(
          `${formatTime(this.t, 's')}: ${[...new Set(chatter)].join(' · ')} 이(가) 계속 붙었다 떨어집니다 (채터링, 약 ${Math.round(this.m.relayMs * 2)} ms 주기). 자기 b접점이 자기 코일을 끊거나, 인터록 없이 서로 끊는 회로입니다. 실제로는 접점이 타고 소리가 납니다`,
        );
      for (const [tag, st] of this.timers) {
        const def = this.m.timerDef.get(tag)!;
        const span = timerSpan(def, st.out);
        if (st.since + span > this.t + EPS) continue;
        if (def.mode === 'on' && st.coil && !st.out) st.out = true;
        else if (def.mode === 'off' && !st.coil && st.out) st.out = false;
        else if (def.mode === 'interval' && st.coil && st.out) st.out = false;
        else if (def.mode === 'flicker' && st.coil && def.preset > 0) {
          st.out = !st.out;
          st.since += span;
        }
      }
      if (this.nextScan !== null && this.nextScan <= this.t + EPS) {
        this.settle();
        this.scanPlc();
      }
      this.settle();
      this.record();
    }
    this.warn('사건이 너무 많아 시뮬레이션을 멈췄습니다', 'guard');
    this.moveTo(to);
  }

  // ───────────── 기록 (타임차트) ─────────────

  private buildTracks(): void {
    const m = this.m;
    const add = (key: string, tag: string, kind: TrackKind) => this.tracks.push({ key, tag: m.label(tag), kind, part: m.mainPart.get(tag)!, points: [], last: null });
    for (const [tag, k] of m.tagKind) {
      if ((k === 'operator' || k === 'thr') && m.sel3.has(tag)) add(`sel:${tag}`, tag, 'selector');
      else if (k === 'operator' || k === 'thr') add(`op:${tag}`, tag, 'operator');
      else if (k === 'sensor') add(`sen:${tag}`, tag, 'sensor');
      else if (k === 'coil') add(`coil:${tag}`, tag, 'coil');
      else if (k === 'timer') {
        add(`tc:${tag}`, tag, 'timerCoil');
        add(`tq:${tag}`, tag, 'timerOut');
      } else if (k === 'tsw') add(`ts:${tag}`, tag, 'tsw');
      else if (k === 'counter') {
        add(`cv:${tag}`, tag, 'counterVal');
        add(`cq:${tag}`, tag, 'counterOut');
      } else if (k === 'temp') {
        const d = m.tempDef.get(tag)!;
        if (d.tc) {
          add(`to:${tag}`, tag, 'tempOut');
          if (d.alarm !== null) add(`ta:${tag}`, tag, 'tempAlarm');
        } else add(`tt:${tag}`, tag, 'tempSw');
      }
    }
    // 온도 묶음마다 온도 (아날로그)
    for (const [z, d] of m.tempZones) {
      const first = [...m.tempDef.values()].find((x) => x.zone === z)!;
      this.tracks.push({ key: `tv:${z}`, tag: d.label, kind: 'tempVal', part: first.part, points: [], last: null });
    }
    for (const [tag, ids] of m.loadParts) {
      const k = m.tagKind.get(tag);
      if (k === 'coil' || k === 'timer' || k === 'counter' || k === 'temp') continue;
      const types = new Set(ids.map((id) => m.circuit.parts.find((p) => p.id === id)!.type));
      const motor = types.has('motor3') || types.has('motor') || types.has('r_motor3');
      const t = this.tracks.length;
      add(`${motor ? 'mot' : 'load'}:${tag}`, tag, motor ? 'motor' : 'load');
      this.tracks[t].part = m.circuit.parts.find((p) => p.id === ids[0])!;
    }
    for (const [tag, p] of m.cylDef) {
      this.tracks.push({ key: `cyl:${tag}`, tag: m.label(tag), kind: 'cyl', part: p, points: [], last: null });
    }
    // 누전: 기기마다 누전 여부 · 접지로 흐르는 전류 (차트에는 바뀐 것만)
    for (const [tag, d] of m.faultDev) {
      this.tracks.push({ key: `leak:${tag}`, tag: m.label(tag), kind: 'leak', part: d.part, points: [], last: null });
      this.tracks.push({ key: `ie:${tag}`, tag: m.label(tag), kind: 'earthA', part: d.part, points: [], last: null });
    }
    // PLC: 선이 이어진 입출력 단자만
    const wired = (p: Part, i: number) => {
      const n = m.net.pinNet.get(`${p.id}:${i}`)!;
      return m.net.pinCount[n] > 1 || m.net.hasWire[n];
    };
    for (const b of m.plcs) {
      b.inAddr.forEach((a, n) => wired(b.part, n) && this.tracks.push({ key: `plcIn:${b.part.id}:${n}`, tag: a, kind: 'plcIn', part: b.part, points: [], last: null, idx: n }));
      b.outAddr.forEach((a, n) => wired(b.part, b.power ? RPLC.out0 + n : b.inDev.length + 1 + n) && this.tracks.push({ key: `plcOut:${b.part.id}:${n}`, tag: a, kind: 'plcOut', part: b.part, points: [], last: null, idx: n }));
    }
  }

  private trackValue(tr: Track): number | string {
    const tag = tr.key.slice(tr.key.indexOf(':') + 1);
    switch (tr.kind) {
      case 'operator':
      case 'sensor':
      case 'coil':
        return this.on(tag) ? 1 : 0;
      case 'timerCoil':
        return this.timers.get(tag)?.coil ? 1 : 0;
      case 'timerOut':
        return this.timers.get(tag)?.out ? 1 : 0;
      case 'tsw':
        return this.tsw.get(tag)?.out ? 1 : 0;
      case 'selector': {
        const v = this.sel.get(tag) ?? 0;
        return v < 0 ? 'L' : v > 0 ? 'R' : '0';
      }
      case 'counterVal':
        return String(this.counters.get(tag)?.n ?? 0);
      case 'counterOut':
        return this.counters.get(tag)?.out ? 1 : 0;
      case 'tempVal':
        return Math.round(this.zoneTemp(tag) * 100) / 100;
      case 'leak':
        return this.faults.has(tag) ? 1 : 0;
      case 'earthA': {
        const f = this.faultView.get(tag);
        return f && this.faults.has(tag) ? Math.round(f.ifA * 1000) / 1000 : 0;
      }
      case 'tempOut':
        return this.temps.get(tag)?.out ? 1 : 0;
      case 'tempAlarm':
        return this.temps.get(tag)?.al ? 1 : 0;
      case 'tempSw': {
        // 서모스탯 · 온도 스위치: 접점이 닫혀 있나 (NC 는 차가울 때 닫힘)
        const p = tr.part;
        const nc = p.type === 'r_thermo' ? !!p.ncOut : p.type === 'ls_nc';
        return this.on(tag) !== nc ? 1 : 0;
      }
      case 'load':
        return this.loadOn(tag) ? 1 : 0;
      case 'motor': {
        const ids = this.m.loadParts.get(tag) ?? [];
        const dir = ids.map((id) => this.motorDir.get(id)).find((d) => d !== undefined);
        return dir === undefined ? '0' : dir > 0 ? 'FWD' : 'REV';
      }
      case 'cyl':
        return this.cyl.get(tag)?.target ?? 0;
      case 'plcIn':
        return this.plcIn.get(tr.part.id)?.[tr.idx!] ? 1 : 0;
      case 'plcOut':
        return this.plcOut.get(tr.part.id)?.[tr.idx!] ? 1 : 0;
    }
  }

  record(): void {
    const t = Math.round(this.t * 1000) / 1000;
    for (const tr of this.tracks) {
      const v = this.trackValue(tr);
      // 온도는 값이 같아도 바뀌는 속도가 달라지면 점을 찍는다 (그래야 차트의 선이 그 자리에서 꺾인다)
      const key = tr.kind === 'tempVal' ? `${v}|${this.zones.get(tr.key.slice(3))?.rate ?? 0}` : v;
      if (tr.last !== null && tr.last === key) continue;
      const pt: WavePoint = { t, v };
      if (tr.kind === 'cyl') {
        const tag = tr.key.slice(4);
        const st = this.cyl.get(tag)!;
        const remain = Math.abs(st.target - st.pos) * this.strokeTime(this.m.cylDef.get(tag)!, st.target);
        if (remain > 0) pt.ramp = Math.round(remain * 1000) / 1000;
      }
      // 지락 전류는 계단으로 바뀐다 (아날로그 선이 비스듬히 이어지지 않게 바로 앞에 이전 값)
      if (tr.kind === 'earthA' && tr.last !== null && t > 0.001) tr.points.push({ t: Math.round((t - 0.001) * 1000) / 1000, v: tr.last as number });
      tr.points.push(pt);
      if (tr.last !== null) this.lastChangeT = Math.max(this.lastChangeT, t);
      tr.last = key;
    }
    this.onRecord?.();
  }
}

// ───────────────────────── 조작 순서 → 시뮬레이션 ─────────────────────────

export interface OpEvent {
  t: number;
  tag: string;
  on: boolean;
  /** 3단 셀렉터 자리 (-1 왼쪽, 0 가운데, 1 오른쪽) */
  pos?: -1 | 0 | 1;
  /** 온도 기기: 바꿀 온도 (℃) 와 걸리는 시간 (ms) */
  temp?: number;
  ramp?: number;
  /** 누전: 절연 저항 (Ω) 으로 시작, null = 끝 */
  leak?: number | null;
}

/** 조작 순서의 각 줄 시각 (앞 줄 조작 시각 + 대기) */
export function opTimes(ops: OpStep[]): number[] {
  let t = 0;
  return ops.map((o) => (t += Math.max(0, o.wait)));
}

export function opsToEvents(ops: OpStep[]): OpEvent[] {
  const times = opTimes(ops);
  const ev: OpEvent[] = [];
  ops.forEach((o, i) => {
    const tag = normTag(o.tag);
    if (!tag) return;
    const t = times[i];
    if (o.action === 'press') {
      ev.push({ t, tag, on: true });
      ev.push({ t: t + Math.max(0, o.hold), tag, on: false });
    } else if (o.action === 'temp') ev.push({ t, tag, on: false, temp: o.value ?? 0, ramp: Math.max(0, o.hold || 0) });
    else if (o.action === 'leak') {
      ev.push({ t, tag, on: false, leak: Math.max(0, o.value ?? 0) });
      if (o.hold > 0) ev.push({ t: t + o.hold, tag, on: false, leak: null });
    }
    else if (o.action === 'left' || o.action === 'right') ev.push({ t, tag, on: true, pos: o.action === 'left' ? -1 : 1 });
    else ev.push({ t, tag, on: o.action === 'on' });
  });
  return ev.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
}

export interface ScenarioResult {
  model: CircuitModel;
  tracks: Track[];
  /** 시뮬레이션한 끝 시각 */
  end: number;
  /** 마지막으로 무언가 바뀐 시각 (조작 포함) */
  lastChange: number;
  warnings: string[];
  times: number[];
}

/** 조작 순서대로 회로를 돌려 신호 기록을 얻는다 */
/** 지금 세고 있는 구간의 길이: 플리커는 켜져 있으면 켜짐 시간, 꺼져 있으면 꺼짐 시간 */
function timerSpan(def: { mode: string; preset: number; off: number }, out: boolean): number {
  return def.mode === 'flicker' && !out ? def.off : def.preset;
}

export function runScenario(c: Circuit, model: CircuitModel = new CircuitModel(c), hook?: (sim: CircuitSim) => void): ScenarioResult {
  const sim = new CircuitSim(model);
  if (hook) {
    hook(sim);
    sim.onRecord = () => hook(sim);
  }
  const events = opsToEvents(c.ops);
  const fixed = c.duration && c.duration > 0 ? c.duration : null;
  const missing = new Set<string>();
  // 같은 시각의 조작은 동시에 (한 버튼씩 차례로 바꾸면 그 사이에 코일이 붙었다 떨어질 수 있다)
  for (let i = 0; i < events.length; ) {
    const t = events[i].t;
    if (fixed !== null && t > fixed) break;
    sim.advanceTo(t);
    // 같은 기기가 다시 나오면 (누름 시간 0 의 누름 · 뗌) 거기서 끊어 차례로
    const now: typeof events = [];
    for (; i < events.length && events[i].t <= t + EPS; i++) {
      const ev = events[i];
      const k = model.tagKind.get(ev.tag);
      if (ev.leak !== undefined ? !model.faultDev.has(ev.tag) : ev.temp !== undefined ? k !== 'temp' : k !== 'operator' && k !== 'thr') {
        missing.add(ev.tag);
        continue;
      }
      if (now.some((e) => e.tag === ev.tag)) {
        sim.applyAll(now);
        now.length = 0;
      }
      now.push(ev);
    }
    sim.applyAll(now);
  }
  const lastOp = events.length ? events[events.length - 1].t : 0;
  // 타임 스위치가 있으면 하루 단위로 (조작이 하루를 넘으면 그만큼 더)
  const days = model.tswDef.size && fixed === null ? Math.max(1, Math.ceil(lastOp / DAY + 1e-9)) * DAY : null;
  if (fixed !== null) sim.advanceTo(fixed);
  else if (days !== null) sim.advanceTo(days);
  else {
    // 마지막 조작 뒤: 타이머·실린더가 멈출 때까지 (최대 60초). PLC 는 늘 스캔하므로 20초 동안 바뀐 것이 없으면 멈춤
    const limit = lastOp + 60000;
    for (let i = 0; i < 200000; i++) {
      const next = sim.nextEvent();
      if (next === null || next > limit) break;
      if (sim.hasPlc && sim.nextEvent(false) === null && next > Math.max(lastOp, sim.lastChangeT) + 20000) break;
      sim.advanceTo(next);
    }
  }
  // 온도는 사건 사이에도 바뀌므로 끝 시각의 값을 한 번 더 찍는다
  if (model.tempZones.size) sim.record();
  let last = lastOp;
  for (const tr of sim.tracks) {
    const p = tr.points[tr.points.length - 1];
    if (p && tr.points.length > 1) last = Math.max(last, p.t + (p.ramp ?? 0));
  }
  const warnings = [...sim.warnings];
  for (const t of missing) warnings.push(`조작 순서의 ${t}: 회로에 그런 조작 기기가 없습니다`);
  return { model, tracks: sim.tracks, end: fixed ?? days ?? Math.max(sim.t, last), lastChange: last, warnings, times: opTimes(c.ops) };
}

/** 대표 부품의 종류 */
export function trackType(tr: Track): PartType {
  return tr.part.type;
}
