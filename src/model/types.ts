import type { PlcConfig } from '../plc/types';

/** 신호 종류 */
export type SignalKind =
  | 'bit' // ON/OFF 디지털 신호 (접점, 코일, 센서, 실린더 등)
  | 'bus' // 워드/데이터 값 (D 레지스터, 스텝 번호, 상태 등)
  | 'analog' // 아날로그 값 (압력, 속도, 위치 등) - 선형 보간
  | 'clock'; // 주기 클럭 (자동 생성)

/** 신호의 역할 - 보고서의 I/O 리스트, 색상 기본값 등에 사용 */
export type SignalRole =
  | 'input'
  | 'output'
  | 'internal'
  | 'actuator'
  | 'sensor'
  | 'timer'
  | 'counter'
  | 'data'
  | 'other';

/** bit: 0 | 1 | 'x'(불명), bus: 문자열 라벨, analog: 숫자 */
export type WaveValue = number | string;

export interface WavePoint {
  /** 변화 시각 (ms) */
  t: number;
  /** 이 시각부터의 값 */
  v: WaveValue;
  /** 전환(동작) 시간 ms - 실린더 이동처럼 경사선으로 표시 (bit 전용) */
  ramp?: number;
}

export interface Signal {
  id: string;
  name: string;
  /** PLC 디바이스 주소 (X0, Y10, P00020, %IX0.0, I0.0 ...) */
  address: string;
  comment: string;
  kind: SignalKind;
  role: SignalRole;
  color: string;
  points: WavePoint[];
  /** High 레벨 라벨 (예: 전진, ON, 흡착) */
  onLabel?: string;
  /** Low 레벨 라벨 (예: 후진, OFF, 해제) */
  offLabel?: string;
  /** 새로 그리는 전환의 기본 동작 시간 (ms) */
  defaultRamp?: number;
  /** 행 높이 배율 (1 = 기본) */
  heightScale?: number;
  analogMin?: number;
  analogMax?: number;
  unit?: string;
  clockPeriod?: number;
  clockDuty?: number;
  clockPhase?: number;
  hidden?: boolean;
  /** 그룹 이름 - 연속된 신호의 그룹이 바뀌면 그룹 헤더 표시 */
  group?: string;
}

export interface Step {
  id: string;
  label: string;
  start: number;
  end: number;
  description: string;
  color?: string;
}

export interface EdgeRef {
  signalId: string;
  t: number;
}

export interface ArrowAnnotation {
  id: string;
  type: 'arrow';
  from: EdgeRef;
  to: EdgeRef;
  label: string;
  dashed?: boolean;
}

export interface DimensionAnnotation {
  id: string;
  type: 'dimension';
  /** 치수선을 표시할 행 (null 이면 차트 상단) */
  signalId: string | null;
  t1: number;
  t2: number;
  /** 비어 있으면 자동으로 시간차 표시 */
  label: string;
}

export interface NoteAnnotation {
  id: string;
  type: 'note';
  signalId: string | null;
  t: number;
  text: string;
}

export interface MarkerAnnotation {
  id: string;
  type: 'marker';
  t: number;
  label: string;
  color?: string;
}

export type Annotation = ArrowAnnotation | DimensionAnnotation | NoteAnnotation | MarkerAnnotation;
export type AnnotationType = Annotation['type'];

export type EdgeKind = 'rise' | 'fall';

/** 타이밍 규칙 - 설계 검증 (인터록, 응답시간, 펄스폭, 사이클 타임) */
export type TimingRule =
  | {
      id: string;
      type: 'delay';
      name: string;
      fromSignal: string;
      fromEdge: EdgeKind;
      toSignal: string;
      toEdge: EdgeKind;
      min?: number;
      max?: number;
    }
  | {
      id: string;
      type: 'exclusive';
      name: string;
      a: string;
      b: string;
    }
  | {
      id: string;
      type: 'pulse';
      name: string;
      signal: string;
      level: 0 | 1;
      min?: number;
      max?: number;
    }
  | {
      id: string;
      type: 'cycle';
      name: string;
      max: number;
    };

export type RuleType = TimingRule['type'];

export interface ProjectMeta {
  title: string;
  machine: string;
  drawingNo: string;
  company: string;
  author: string;
  checker: string;
  approver: string;
  revision: string;
  date: string;
  description: string;
}

export interface Revision {
  rev: string;
  date: string;
  description: string;
  author: string;
}

export type TimeUnit = 'ms' | 's' | 'auto';

export interface ProjectSettings {
  /** 차트 전체 길이 (ms) */
  duration: number;
  /** 스냅 그리드 (ms) */
  grid: number;
  timeUnit: TimeUnit;
  /** 기본 행 높이 (px) */
  rowHeight: number;
  /** ON 구간 채우기 */
  fillHigh: boolean;
  /** 차트에 주소 컬럼 표시 */
  showAddress: boolean;
  /** 신호 이름 옆 ON/OFF 라벨 표시 */
  showLevelLabels: boolean;
  /** 에지에 시간 표시 */
  showEdgeTimes: boolean;
}

export interface Project {
  format: 'timechart-studio';
  version: 1;
  id: string;
  meta: ProjectMeta;
  revisions: Revision[];
  settings: ProjectSettings;
  signals: Signal[];
  steps: Step[];
  annotations: Annotation[];
  rules: TimingRule[];
  plc?: PlcConfig;
}
