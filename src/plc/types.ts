import type { SignalRole, WavePoint } from '../model/types';

/** 지원 PLC 언어/제조사 */
export type PlcDialect =
  | 'mitsubishi' // 미쓰비시 GX Works2/3, GX Developer 니모닉(IL) / CSV
  | 'ls' // LS ELECTRIC XG5000 (XGK/XGB) 니모닉(IL)
  | 'siemens' // 지멘스 STEP7 / TIA Portal STL(AWL)
  | 'st'; // IEC 61131-3 Structured Text (CODESYS, TwinCAT, SCL, XG5000 ST, GX Works3 ST)

export interface PulseDef {
  start: number;
  end: number;
}

export type Stimulus =
  | { device: string; mode: 'const'; value: 0 | 1 }
  | { device: string; mode: 'pulse'; pulses: PulseDef[] }
  | { device: string; mode: 'wave'; points: WavePoint[] };

/** 설비 동작 모델 - 출력에 반응하여 입력(센서)을 자동 생성 */
export type MachineModel =
  | {
      id: string;
      type: 'cylinder';
      name: string;
      /** 전진 출력 (솔레노이드) */
      extend: string;
      /** 후진 출력 - 비어 있으면 싱글 솔레노이드(스프링 복귀) */
      retract: string;
      /** 전진단 센서 입력 */
      extSensor: string;
      /** 후진단 센서 입력 */
      retSensor: string;
      extendTime: number;
      retractTime: number;
      initial: 0 | 1;
    }
  | {
      id: string;
      type: 'delay';
      name: string;
      /** 원인 디바이스 (보통 출력) */
      source: string;
      /** 결과 디바이스 (보통 입력) */
      target: string;
      onDelay: number;
      offDelay: number;
      invert: boolean;
    }
  | AxisModel;

/** 위치 축 모델: 정/역 출력이 켜져 있는 동안 위치가 움직임 (크레인 주행·횡행·권상, 컨베이어, 서보)
 *  - 위치를 카운터/워드에 써서 엔코더처럼 동작
 *  - 위치 구간에 들어오면 켜지는 리밋 스위치 입력 */
export interface AxisModel {
  id: string;
  type: 'axis';
  name: string;
  /** 정방향 출력 (위치 증가) */
  fwd: string;
  /** 역방향 출력 (위치 감소) */
  rev: string;
  /** 기본 속도 (단위/초) */
  speed: number;
  /** 속도 선택 출력: 위에서부터 먼저 켜진 것의 속도 사용 */
  speeds: { device: string; speed: number }[];
  min: number;
  max: number;
  initial: number;
  /** 위치를 쓸 카운터/워드 (엔코더) - '' 이면 안 씀 */
  counter: string;
  /** 위치 구간 [from, to] 에서 ON 되는 입력 (리밋 스위치) */
  sensors: { device: string; from: number; to: number }[];
  unit: string;
}

export interface SimSettings {
  /** 스캔 타임 (ms) */
  scanTime: number;
  /** 시뮬레이션 시간 (ms) */
  duration: number;
  /** K 상수 타이머 기본 단위 (ms) */
  timerBase: number;
  /** 미쓰비시 시리즈 (FX: T200~ 10ms 타이머 규칙 적용) */
  mitsubishiSeries: 'FX' | 'Q';
  stimuli: Stimulus[];
  models: MachineModel[];
  /** 차트에 표시할 디바이스 (순서대로) */
  watch: string[];
  /** 스텝 번호 디바이스 ('' 없음, '@STL' 미쓰비시 S 스텝 릴레이) */
  stepDevice: string;
  /** 마지막 변화 이후를 잘라 차트 길이 자동 조정 */
  autoTrim: boolean;
}

export interface PlcConfig {
  dialect: PlcDialect;
  source: string;
  comments: string;
  sim: SimSettings;
}

export type DeviceType = 'bit' | 'word' | 'timer' | 'counter';

export interface DeviceInfo {
  name: string;
  /** ST 변수의 AT 주소 (%IX0.0 등) */
  address?: string;
  type: DeviceType;
  read: boolean;
  written: boolean;
  role: SignalRole;
  comment: string;
  /** 코드 상 처음 등장한 줄 */
  line: number;
  /** 실제 I/O 를 복사한 매핑 릴레이면 그 원본 (예: 'P00019', 'NOT P00040') */
  alias?: string;
  /** 이 릴레이가 그대로 켜는 실제 출력 (예: 'P00021') */
  drives?: string;
  /** 실제 I/O 면: 이 I/O 를 받아 쓰는 내부 릴레이 (예: ['M00629', 'M00440']) */
  relays?: string[];
}

export interface ParseMessage {
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

export type CmpOp = '=' | '<>' | '>' | '<' | '>=' | '<=';

/** 니모닉(IL/STL) 명령 - 공통 중간 표현 */
export interface Instr {
  op: string;
  args: string[];
  neg?: boolean;
  edge?: 'P' | 'F';
  cmp?: CmpOp;
  /** 펄스 실행형 (MOVP 등) */
  pulse?: boolean;
  /** 타이머 종류 */
  timer?: 'TON' | 'TOF' | 'TMR' | 'TMON' | 'TRTG' | 'SD' | 'SE' | 'SP' | 'SS' | 'SF';
  /** 타이머 단위 (ms) - OUTH 등 */
  timerBase?: number;
  line: number;
  text: string;
}

export function defaultSimSettings(): SimSettings {
  return {
    scanTime: 10,
    duration: 5000,
    timerBase: 100,
    mitsubishiSeries: 'FX',
    stimuli: [],
    models: [],
    watch: [],
    stepDevice: '',
    autoTrim: true,
  };
}
