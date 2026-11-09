/** 회로도 (CADe SIMU 처럼 그리는 릴레이·전동기·공압 제어 회로) */

/** 전원 극: 직류 +24V/0V, 교류 L/N, 3상 L1/L2/L3 (L 은 L1 과 같은 상) */
export type Pole = '+24V' | '0V' | 'L' | 'N' | 'L1' | 'L2' | 'L3';

export type PartType =
  | 'src' // 전원 단자 하나 (극 선택)
  | 'src3' // 3상 전원 L1 L2 L3
  | 'fuse'
  | 'fuse3'
  | 'mcb' // 배선용 차단기 1P (클릭: ON/OFF)
  | 'mcb3'
  | 'ol3' // 열동형 과부하 계전기 주회로 (클릭: 트립/복귀)
  | 'pb_no' // 푸시버튼 a접점 (누르는 동안)
  | 'pb_nc'
  | 'sw_no' // 셀렉터·토글 스위치 (유지형)
  | 'sw_nc'
  | 'estop' // 비상정지 (b접점, 잠김)
  | 'ls_no' // 리밋 스위치·센서: 실린더 끝에 연결하거나 클릭으로 조작
  | 'ls_nc'
  | 'no' // 같은 기호의 코일·타이머·THR·스위치를 따라가는 a접점
  | 'nc'
  | 'km3' // 전자접촉기 주접점 3P
  | 'coil' // 릴레이·전자접촉기 코일
  | 'timer' // 타이머 코일 (ON/OFF 딜레이)
  | 'lamp'
  | 'buzzer'
  | 'motor3'
  | 'motor' // 단상·직류 전동기
  | 'sol' // 솔레노이드 밸브 코일
  | 'cyl' // 공압 실린더 (솔레노이드 기호로 움직임)
  | 'plc' // PLC: 입력 8 · 릴레이 출력 8, PLC 탭의 프로그램을 스캔 실행
  | 'text';

export type Rot = 0 | 90 | 180 | 270;

export type LampColor = 'red' | 'green' | 'yellow' | 'white' | 'blue';

export interface Part {
  id: string;
  type: PartType;
  /** 격자 좌표 */
  x: number;
  y: number;
  rot: Rot;
  /** 기호 (PB1, MC1, X1, T1, GL, M1, SOL1, CYL1 …) - 같은 기호끼리 연동 */
  tag: string;
  /** 설명 (기동, 정지, 운전 표시 …) */
  name?: string;
  /** 부품 리스트에 쓰는 사양 (비우면 자동) */
  spec?: string;
  pole?: Pole;
  timerMode?: 'on' | 'off';
  /** 타이머 설정 시간 (ms) */
  preset?: number;
  color?: LampColor;
  /** 실린더: 전진·후진 시간 (ms) */
  stroke?: number;
  strokeBack?: number;
  /** 실린더: 전진·후진 솔레노이드 기호 (후진이 비면 스프링 복귀) */
  solPlus?: string;
  solMinus?: string;
  /** 리밋 스위치: 이 실린더의 끝에서 눌림 */
  cyl?: string;
  end?: '+' | '-';
  text?: string;
  /** PLC: 입력·출력 첫 주소 (X0 / Y0, P00000 / P00040, I0.0 / Q0.0, %IX0.0 / %QX0.0) */
  inBase?: string;
  outBase?: string;
}

export interface Wire {
  id: string;
  a: [number, number];
  b: [number, number];
}

/** 조작 순서 한 줄: 앞 줄 조작 시각에서 wait 뒤에 이 기기를 조작 */
export interface OpStep {
  id: string;
  wait: number;
  tag: string;
  /** press = 눌렀다 뗌 (hold 동안), on = 켬·누른 채 유지, off = 끔·뗌 */
  action: 'press' | 'on' | 'off';
  hold: number;
  /** 적으면 타임차트의 공정 스텝 이름이 된다 */
  note?: string;
}

export interface Circuit {
  parts: Part[];
  wires: Wire[];
  ops: OpStep[];
  /** 시뮬레이션 시간 (ms) - 없으면 마지막 변화에 맞춤 */
  duration?: number;
  /** 회로·조작 순서를 고치면 타임차트를 바로 다시 만든다 (기본 켬) */
  autoChart?: boolean;
  /** 마지막으로 타임차트에 적용한 회로의 서명 */
  applied?: string;
}

export function emptyCircuit(): Circuit {
  return { parts: [], wires: [], ops: [] };
}
