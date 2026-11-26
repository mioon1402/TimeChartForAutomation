/** 회로도 (CADe SIMU 처럼 그리는 릴레이·전동기·공압 제어 회로) */

/** 전원 극: 직류 +24V/0V, 교류 L/N, 3상 L1/L2/L3 (L 은 L1 과 같은 상) */
export type Pole = '+24V' | '0V' | 'L' | 'N' | 'L1' | 'L2' | 'L3' | 'PE';

export type PartType =
  | 'src' // 전원 단자 하나 (극 선택)
  | 'src3' // 3상 전원 L1 L2 L3
  | 'fuse'
  | 'sk' // 스파크 킬러 (CR 서지 흡수기) 기호: 코일 양단에
  | 'imp' // 임펄스 릴레이 (래칭 릴레이) 코일 기호: 누를 때마다 같은 기호의 접점이 바뀌고 그대로 유지
  | 'diode' // 다이오드 기호 (직류 코일 서지 흡수): 캐소드 (띠) 가 + 쪽이 되게 코일 양단에
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
  | 'load' // 부하 (히터 · 팬 등, 두 단자 사이에 전압이 걸리면 동작)
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
  | 'r_my2' // 각형 릴레이 2c + 소켓 (MY2N · PYF08A 꼴): 13-14 코일, 9-5 · 12-8 a, 9-1 · 12-4 b
  | 'r_my4' // 각형 릴레이 4c + 소켓 (MY4N · PYF14A 꼴): 13-14 코일, 9~12 공통, 5~8 a, 1~4 b
  | 'r_fuse' // 퓨즈 홀더 1P
  | 'r_vfd' // 인버터 (VFD): 전원 R/L1 · S/L2 · T/L3, 출력 U · V · W, 무전압 입력 STF · STR · RH · RM · RL (SD 공통), 고장 릴레이 A · B · C
  | 'r_imp' // 임펄스 릴레이 (래칭, DIN 레일): 코일 A1 · A2 에 펄스가 들어올 때마다 13-14 a · 21-22 b 가 바뀌고 유지
  | 'r_sk' // 스파크 킬러 (CR 서지 흡수기, 리드선 2가닥): 교류 SOL · MC · 릴레이 코일 양단에
  | 'r_diode' // 다이오드 (서지 흡수, 리드선 2가닥 A · K): 직류 코일 양단에 K 를 + 쪽으로
  | 'r_flr' // 플로트리스 릴레이 (61F 꼴, 전극식 수위): 전원 S1 · S2, 전극 E1 (상한) · E2 (하한) · E3 (공통), 출력 Tc → Ta (a) · Tb (b)
  | 'r_tank' // 수조 (물탱크) + 전극봉 E1 · E2 · E3: 물에 잠긴 전극끼리 통한다. 수위는 급수 · 배수 부하와 사용량으로 바뀐다
  | 'r_smps' // SMPS (실물): L N FG → +V -V
  | 'r_prox' // 근접 · 광전 센서 3선식 (실물): 갈색 +, 검정 출력, 파랑 0V
  | 'r_prox2' // 근접 센서 2선식 (실물): 갈색 · 파랑 두 선이 부하와 직렬 (스위치처럼). 직류는 갈색이 + 쪽
  | 'r_ls' // 리밋 스위치 (실물): 11-12 b, 23-24 a
  | 'r_buzzer' // 부저
  | 'r_sol' // 솔레노이드 밸브 코일
  | 'r_fan' // 판넬 팬 (단상)
  | 'r_pbl' // 조광형 푸시버튼: 11-12 b, 23-24 a, 램프 X1-X2
  | 'r_nbar' // 중성선 · 접지 바 (나사가 모두 한 막대에)
  | 'r_vm' // 전압계
  | 'r_am' // 전류계 (선 사이에 직렬)
  | 'r_duct' // 배선 덕트 (그림만: 선이 덕트 안으로 지나간다)
  | 'r_rail' // DIN 레일 (그림만)
  | 'r_fsw' // 풋 스위치 (1a1b, 밟는 동안)
  | 'r_float' // 플로트 스위치 (1a1b, 수위)
  | 'r_psw' // 압력 스위치 (1a1b)
  | 'r_outlet' // 콘센트 (L N PE)
  | 'r_motor6' // 3상 전동기 6단자 (Y-Δ 기동): U1 V1 W1 / W2 U2 V2
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
  | 'r_kepco' // 한전 수전점: 특고압 3상 (22.9 kV) 전원, 단락 전류 (kA)
  | 'r_vcb' // 진공차단기 VCB 3P (특고압)
  | 'r_tr3' // 3상 변압기 (Δ-Y): 1차 H1 H2 H3, 2차 X1 X2 X3 X0
  | 'r_ss3' // 3단 셀렉터 스위치 (수동 · 정지 · 자동): 왼쪽 13-14 a, 오른쪽 23-24 a
  | 'r_counter' // 프리셋 카운터: 전원 A1 · A2, 무전압 입력 CP · RST · COM, 출력 C → NO · NC
  | 'r_ssr' // SSR (무접점 릴레이): 입력 3(+) · 4(-) DC, 출력 1-2 AC
  | 'r_tc' // 온도 조절기 (48×48): 전원 A1 · A2, 제어 출력 C1-OUT, 경보 출력 C2-AL (릴레이 a접점)
  | 'r_thermo' // 판넬 서모스탯 (바이메탈): 1-2 접점. NC = 난방 (오르면 열림), NO = 냉방 · 팬 (오르면 닫힘)
  | 'r_tc8' // 온도 조절기 8핀 (T3S 꼴, 썸휠 설정): 전원 L · N, 릴레이 출력 COM → NO · NC, 측온저항체 입력 A · B · B'. 센서가 끊기면 출력 끔
  | 'r_rtd' // 측온저항체 Pt100 (3선식 보호관): A · B · B' 세 가닥을 온도 조절기 센서 단자에
  | 'r_rtd2' // 측온저항체 Pt100 더블 (3선식 소자 두 개, 6가닥): 1 · 2 소자를 각각 다른 기기에 (조절기 + 과열 방지 · 기록계)
  | 'r_tk4' // PID 온도 조절기 (TK4S 꼴, 48×48 나사 단자): 전원 L · N, 제어 출력 OUT1 (릴레이 a), 경보 AL1, RS485, 센서 10 A · 11 B · 12 B'
  | 'r_plc' // PLC (실물): 전원 + · − · FG, 입력 16 + 공통 COM (싱크 · 소스), 릴레이 출력 16 (8점마다 공통 COM0 · COM1). 전원이 있어야 돈다
  | 'r_hmi' // HMI (터치 판넬): 전원 + · − · FG. 화면의 버튼 · 램프가 PLC 디바이스 (M 등) 를 쓰고 읽는다 (통신, 선 없음)
  | 'text';

export type Rot = 0 | 90 | 180 | 270;

export type LampColor = 'red' | 'green' | 'yellow' | 'white' | 'blue';

/** HMI 화면의 한 칸: 버튼 (누르는 동안 1) · 스위치 (누를 때마다 1 ↔ 0) · 램프 (디바이스가 1 이면 켜짐) */
export interface HmiItem {
  kind: 'btn' | 'sw' | 'lamp';
  label: string;
  /** PLC 디바이스 (M100 · P00100 …) */
  dev: string;
  color?: LampColor;
}

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
  timerMode?: 'on' | 'off' | 'flicker' | 'interval';
  /** 타이머 설정 시간 (ms) */
  preset?: number;
  /** 플리커의 꺼짐 시간 (ms, 트윈 타이머). 없으면 켜짐 시간 (preset) 과 같음 */
  presetOff?: number;
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
  /** 부하 상자 (히터 · 열풍기): 외함 접지 단자 PE 가 있다 (금속 외함) */
  pe?: boolean;
  /** HMI: 화면의 버튼 · 스위치 · 램프 (위에서 아래, 왼쪽에서 오른쪽) */
  hmi?: HmiItem[];
  /** 센서 종류: 3선식(inductive 유도형 · capacitive 정전용량형 · photo 광전), 리밋 스위치(reed 리드 · float 플로트 · pressure 압력) */
  sense?: 'inductive' | 'capacitive' | 'photo' | 'reed' | 'float' | 'pressure' | 'temp';
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
  /** 누전차단기 정격 감도 전류 (mA, 없으면 30) */
  idn?: number;
  /** 부스바: 막대 수 (3 = L1 L2 L3, 4 = + N), 단면적 (mm²) */
  bars?: number;
  mm2?: number;
  /**
   * 8핀 원형 소켓의 단자 배열 (위에서 본 그림): pf = 위 6 5 4 3 · 아래 7 8 1 2, pfr = 같은 소켓을 돌려 단 것 (위 2 1 8 7 · 아래 3 4 5 6).
   * 없으면 예전 그림 (번호순: 위 1 2 3 4 · 아래 8 7 6 5)
   */
  sock?: 'pf' | 'pfr';
  /** 변압기: 용량 (kVA), %임피던스, X/R. 한전 수전점 · 변압기 1차: 전압 (kV) */
  kva?: number;
  z?: number;
  xr?: number;
  kv?: number;
  /** 차단기: 차단 용량 (kA). 한전 수전점: 수전점 단락 전류 (kA) */
  ka?: number;
  /** 카운터: 설정 수 (이 수만큼 세면 출력) */
  count?: number;
  /** 3단 셀렉터: 세 자리 이름 '왼쪽/가운데/오른쪽' (비우면 수동/정지/자동). 회로 기호의 셀렉터 접점 (sw_no) 에도 쓴다 */
  pos3?: string;
  /** 3단 셀렉터: 시작할 때 손잡이 자리 (-1 왼쪽, 1 오른쪽, 없으면 가운데) */
  pos0?: -1 | 1;
  /** 회로 기호의 셀렉터 접점 (sw_no): 3단 셀렉터의 이 자리 (-1 왼쪽, 1 오른쪽) 에서 닫힌다 */
  sel?: -1 | 1;
  /** 2선식 근접 센서: 교류용 (AC 100-240V, 극성 없음). 없으면 직류 (DC 12-24V, 갈색이 + 쪽) */
  ac?: boolean;
  /** 2선식 근접 센서: 출력이 b접점 (NC, 감지하면 꺼짐) */
  ncOut?: boolean;
  /** 솔레노이드 밸브: 코일 결선. 없으면 리드선 2가닥 (직류는 빨강 + · 검정 -), din = DIN 커넥터 (1 · 2 · 접지) */
  conn?: 'din';
  /** 회로 기호의 단자 번호를 실물 기기 번호로 ('1-3', 'A1-A2' …). 회로도 자동 생성에서 쓴다 */
  term?: string;
  /** 온도 기기 (온도 조절기 · 서모스탯 · 온도 스위치): 설정 온도 (℃) */
  sv?: number;
  /** 히스테리시스 (℃): 설정 온도에서 이만큼 내려가야 되돌아간다 */
  hys?: number;
  /** 온도 조절기: 경보 온도 (℃, 이 온도 이상이면 AL). 없으면 경보 없음 */
  alarm?: number;
  /** 온도 조절기 제어 출력: heat = 가열 (설정보다 낮으면 OUT), cool = 냉각 (설정 이상이면 OUT) */
  tcMode?: 'heat' | 'cool';
  /** 인버터: 기본 주파수 (Hz, 다단속 입력이 없을 때) · 다단속 RH · RM · RL (Hz), 가속 · 감속 시간 (s, 0 ↔ 60 Hz), 단상 입력 (R · S) */
  hz?: number;
  hzH?: number;
  hzM?: number;
  hzL?: number;
  acc?: number;
  dec?: number;
  ph1?: boolean;
  /** 스파크 킬러: 정전 용량 (µF, 없으면 0.1) · 저항 (Ω, 없으면 120) */
  uf?: number;
  ohm?: number;
  /** PID 온도 조절기 (TK4S 꼴) 제어 방식: 없으면 PID (시간 비례), onoff = ON/OFF (히스테리시스) */
  ctrl?: 'onoff';
  /** PID: 비례대 P (℃), 적분 시간 I (초, 0 = 안 씀), 미분 시간 D (초, 0 = 안 씀), 제어 주기 T (초, 릴레이 출력이면 보통 20) */
  pb?: number;
  ti?: number;
  td?: number;
  cycle?: number;
  /** 온도 묶음 이름: 같은 이름의 온도 기기는 같은 온도를 잰다 (없으면 기기 기호) */
  zone?: string;
  /** 이 온도를 바꾸는 부하의 기호 (히터 · 팬). 없으면 조작 순서로만 바뀐다 */
  tLoad?: string;
  /** 연결 부하가 식히는 것 (팬 · 냉방): 켜지면 주위 온도로 내려가고 꺼지면 최고 온도로 오른다 */
  tLoadCool?: boolean;
  /** 처음 · 주위 온도 (℃) */
  amb?: number;
  /** 최고 온도 (℃, 가열이 계속되면 여기서 멈춤) */
  tmax?: number;
  /** 오르는 · 내리는 속도 (℃/s) */
  rise?: number;
  fall?: number;
  /** 지연 시간 (s, 없으면 0): 부하를 켜고 끈 뒤 센서 온도가 바뀌기 시작할 때까지 (열이 퍼지는 시간). 있으면 ON/OFF 제어가 설정을 넘친다 */
  lag?: number;
  /** 수조: 처음 수위 (%, 없으면 50) */
  lv0?: number;
  /** 수조: 전극봉 끝의 높이 (바닥에서 %, 없으면 E1 80 · E2 40 · E3 10). 물이 이 높이 이상이면 그 전극이 잠긴다 */
  e1?: number;
  e2?: number;
  e3?: number;
  /** 수조: 급수 · 배수 기기의 기호 (펌프 · 솔레노이드 밸브 …, 켜져 있는 동안 수위가 오르고 · 내린다) */
  fillTag?: string;
  drainTag?: string;
  /** 수조: 급수 · 배수 속도 (%/s, 없으면 5 · 5), 늘 쓰는 양 (%/s, 없으면 0) */
  fillRate?: number;
  drainRate?: number;
  useRate?: number;
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
  /**
   * press = 눌렀다 뗌 (hold 동안), on = 켬·누른 채 유지, off = 끔·뗌 (3단 셀렉터는 가운데), left · right = 3단 셀렉터를 왼쪽 · 오른쪽으로,
   * temp = 온도 기기의 온도를 value (℃) 로 (hold 동안 일정하게 바뀜, 0 이면 바로),
   * leak = 기기의 누전 (절연 불량: 충전부가 외함에 닿음, value = 절연 저항 Ω, hold 동안, 0 이면 끝까지),
   * level = 수조의 수위를 value (%) 로 (hold 동안 일정하게 바뀜, 0 이면 바로)
   */
  action: 'press' | 'on' | 'off' | 'left' | 'right' | 'temp' | 'leak' | 'level';
  hold: number;
  /** temp: 바꿀 온도 (℃), leak: 절연 저항 (Ω, 0 = 완전 지락), level: 수위 (%) */
  value?: number;
  /** 적으면 타임차트의 공정 스텝 이름이 된다 */
  note?: string;
}

/** 이을 넷 하나 (배선 전 계획): 같은 넷이 될 단자들 (부품 id, 단자 차례) 과 전선 색 */
export interface PlanNet {
  pins: [string, number][];
  color?: WireColor;
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
  /** 전기 요금: 전력량 단가 (원/kWh, 없으면 182 = 2025 산업용 평균), 기본요금 (원/kW · 월, 없으면 0), 계약 전력 (kW, 없으면 부하 합계) */
  price?: number;
  basePrice?: number;
  contractKw?: number;
  /** 배선 계획: [실물 배선도 만들기 → 기기만 놓기] 로 만든 그림에서 아직 긋지 않은 연결. [배선 잇기] 가 지금 기기 자리로 긋고 지운다 */
  plan?: PlanNet[];
  /** 전원 계통 (없으면 3상 4선식) */
  system?: PowerSystem;
  /** 릴레이 · 전자접촉기 · 타이머 코일이 붙고 떨어지는 데 걸리는 시간 (ms). 없으면 0 (바로) */
  relayMs?: number;
  /** 계통 접지 방식: TT (기기를 따로 접지, 저압 수전 주택 등) · 없으면 TN (TN-C-S, 기기 접지선이 변압기 중성점으로) */
  earthing?: 'TT';
  /** 접지 저항 (Ω): ra = 기기 보호 접지 (TT), rb = 계통 (변압기 중성점) 접지. 없으면 100 · 10 */
  ra?: number;
  rb?: number;
  /** 계통의 대표 전압 (V): 3상은 선간 (3상 4선식 기본 380, 상전압은 선간 / √3), 단상 3선식은 L1-L2 (기본 220), 단상 2선식은 L-N (기본 220) */
  vll?: number;
}

/** 전원 계통: 3상 4선식 · 3상 3선식 · 단상 3선식 · 단상 2선식 */
export type PowerSystem = '3p4w' | '3p3w' | '1p3w' | '1p2w';

export function emptyCircuit(): Circuit {
  return { parts: [], wires: [], ops: [] };
}
