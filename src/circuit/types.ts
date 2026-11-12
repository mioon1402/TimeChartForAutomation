/** 회로도 (CADe SIMU 처럼 그리는 릴레이·전동기·공압 제어 회로) */

/** 전원 극: 직류 +24V/0V, 교류 L/N, 3상 L1/L2/L3 (L 은 L1 과 같은 상) */
export type Pole = '+24V' | '0V' | 'L' | 'N' | 'L1' | 'L2' | 'L3' | 'PE';

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
  | 'prox' // 3선식 센서 (근접·광전): 갈색 +, 검정 출력, 파랑 0V. 전원이 있어야 동작
  | 'smps' // DC 전원 공급기: AC 220V 입력 → +24V / 0V 출력
  | 'air' // 공압원
  | 'frl' // 에어 서비스 유닛 (필터·레귤레이터)
  | 'fc' // 속도 제어 밸브 (한쪽 방향 유량 조절, 미터 아웃)
  | 'v32' // 3/2 밸브 (NC) 편솔 · 스프링 복귀
  | 'v52' // 5/2 밸브 편솔 · 스프링 복귀
  | 'v52d' // 5/2 밸브 양솔 (위치 유지)
  | 'v53' // 5/3 밸브 양솔 · 올포트 블록 (스프링 센터)
  // 실물 배선도용 기기 (단자 번호가 붙은 실제 모양, 기기 하나에 코일·접점이 함께)
  | 'r_term' // 전원 단자 (L1 L2 L3 N PE …)
  | 'r_mcb1' // 차단기 1P · 2P · 3P (레버 클릭 ON/OFF)
  | 'r_mcb2'
  | 'r_mcb3'
  | 'r_mc' // 전자접촉기: A1·A2, 주접점 1/L1~6/T3, 보조 13-14 NO · 21-22 NC
  | 'r_thr' // 열동형 과부하 계전기: 주회로, 95-96 NC · 97-98 NO
  | 'r_pb' // 푸시버튼 유닛: 11-12 NC · 23-24 NO (누르는 동안)
  | 'r_lamp' // 파일럿 램프 X1 · X2
  | 'r_motor3' // 3상 전동기 U V W + PE
  | 'r_relay8' // 8핀 릴레이 + 소켓: 2-7 코일, 1-3·8-6 a, 1-4·8-5 b
  | 'r_timer8' // 8핀 타이머 + 소켓: 2-7 전원, 8-6 한시 a, 8-5 한시 b, 1-3 a · 1-4 b (한시 또는 순시)
  | 'r_ss' // 셀렉터 스위치 (손잡이, 11-12 b · 23-24 a, 돌려서 유지)
  | 'r_estop' // 비상정지 (노란 판 + 빨간 버섯, 눌러서 잠김, 11-12 b · 23-24 a)
  | 'r_tb' // 단자대 (번호마다 위·아래 나사가 이어짐)
  | 'r_tsw' // 24시간 타임 스위치 (다이얼식): L · N 시계 전원, COM → NO · NC
  | 'r_light' // 전등 (L · N)
  | 'r_sw' // 벽 스위치 (단로)
  | 'r_sw3' // 3로 스위치 (0 → 1 · 3)
  | 'r_load1' // 부하 (단상): L · N, 용량 kW · 역률
  | 'r_load3' // 부하 (3상): L1 · L2 · L3, 용량 kW · 역률
  | 'r_panel' // 분전반 · 변전함 테두리 (안의 기기를 한 함으로 묶어 보여 준다)
  | 'r_mcb4' // 차단기 4P (3상 + N)
  | 'r_bus' // 부스바: 세로 막대 3 · 4 개 (L1 L2 L3 N), 막대 어디에 선 끝을 대도 이어진다
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
  /** on = ON 딜레이, off = OFF 딜레이, flicker = 켜져 있는 동안 preset 마다 반전 (플리커 릴레이) */
  timerMode?: 'on' | 'off' | 'flicker';
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
  /** 센서 종류: 3선식(inductive 유도형 · capacitive 정전용량형 · photo 광전), 리밋 스위치(reed 리드 · float 플로트 · pressure 압력) */
  sense?: 'inductive' | 'capacitive' | 'photo' | 'reed' | 'float' | 'pressure';
  /** 3선식 센서 출력: NPN (기본 PNP) */
  npn?: boolean;
  /** 밸브: 14쪽(왼쪽) · 12쪽(오른쪽) 솔레노이드 기호 */
  solA?: string;
  solB?: string;
  /** 속도 제어 밸브: 빠르기 (%) */
  speed?: number;
  /** 단자대: 극수 */
  n?: number;
  /** 8핀 타이머: 1-3 · 1-4 접점이 순시 접점 (기본은 한시) */
  inst13?: boolean;
  /** 타임 스위치: 켜지는 구간 [켜짐, 꺼짐] (하루 안의 시각, ms). 꺼짐이 더 이르면 자정을 넘긴다 */
  sched?: [number, number][];
  /** 부하: 용량 (W). 전동기는 정격 출력, 그 밖은 소비 전력 */
  watt?: number;
  /** 부하: 역률 (0~1), 전동기: 효율 (0~1) */
  pf?: number;
  eff?: number;
  /** 부하: 정격 전압 (V). 비우면 이어진 전원에서 정한다 */
  volt?: number;
  /** 부하: 조명 (전압강하 허용값이 더 작다) */
  lighting?: boolean;
  /** 차단기 · 퓨즈: 정격 전류 (A) */
  amps?: number;
  /** 분전반 테두리: 크기 (격자 칸). 부스바는 h 가 막대 길이 */
  w?: number;
  h?: number;
  /** 차단기: 누전차단기 (ELB) */
  elb?: boolean;
  /** 부스바: 막대 수 (3 = L1 L2 L3, 4 = + N), 단면적 (mm²) */
  bars?: number;
  mm2?: number;
}

/** 전선 색: 갈색 L1, 검정 L2, 회색 L3, 파랑 N, 녹황 PE, 그 밖 제어선 */
export type WireColor = 'brown' | 'black' | 'grey' | 'blue' | 'gy' | 'red' | 'yellow' | 'white' | 'orange';

/** 공사방법 (KS C IEC 60364-5-52): A1 · A2 단열벽 속, B1 · B2 전선관 · 덕트, C 노출, D1 · D2 지중, E · F 케이블 트레이 */
export type CableMethod = 'A1' | 'A2' | 'B1' | 'B2' | 'C' | 'D1' | 'D2' | 'E' | 'F';

/** 전선 · 케이블 규격 (해석용). 꺾여 이어진 한 가닥 전체에 같은 값을 준다 */
export interface CableSpec {
  /** 'bus' = 부스바 (허용전류는 직접 적는다) */
  kind?: 'bus';
  /** 절연: PVC 70℃ (IV · VV), XLPE · EPR 90℃ (HFIX · CV · FR-8) */
  ins: 'pvc' | 'xlpe';
  /** 도체 단면적 (mm²) */
  mm2: number;
  method: CableMethod;
  /** 부하 도체 수: 2 = 단상 · 직류, 3 = 3상 */
  cores: 2 | 3;
  /** 길이 (m): 꺾여 이어진 한 가닥 전체 */
  len: number;
  /** 주위 온도 (℃, 기본 30) */
  amb?: number;
  /** 함께 지나는 회로 수 (복수회로 감소계수, 기본 1) */
  group?: number;
  /** 부스바: 허용전류 (A) */
  iz?: number;
}

export interface Wire {
  id: string;
  a: [number, number];
  b: [number, number];
  /** 실제 전선 색 (없으면 회로도처럼 검은 선, 시뮬레이션 중 극 색) */
  color?: WireColor;
  /** 케이블 규격 (없으면 저항이 없는 이상적인 선으로 본다) */
  cable?: CableSpec;
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
  /** 결선표에서 배선을 마쳤다고 체크한 전선 (단자 두 개의 키) */
  wired?: string[];
  /** 시뮬레이션을 시작하는 시각 (하루 안의 ms, 기본 00:00) - 타임 스위치가 있을 때 */
  clock?: number;
  /** 전기 해석: 수전 유형 (lv = 저압 수전, hv = 고압 이상 수전) */
  supply?: 'lv' | 'hv';
  /** 전원 계통 (없으면 3상 4선식) */
  system?: PowerSystem;
  /** 계통의 대표 전압 (V): 3상은 선간 (3상 4선식 기본 380, 상전압은 선간 / √3), 단상 3선식은 L1-L2 (기본 220), 단상 2선식은 L-N (기본 220) */
  vll?: number;
}

/** 전원 계통: 3상 4선식 · 3상 3선식 · 단상 3선식 · 단상 2선식 */
export type PowerSystem = '3p4w' | '3p3w' | '1p3w' | '1p2w';

export function emptyCircuit(): Circuit {
  return { parts: [], wires: [], ops: [] };
}
