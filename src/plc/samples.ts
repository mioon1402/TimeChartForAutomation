import type { PlcDialect, SimSettings } from './types';
import { defaultSimSettings } from './types';
import { newCylinderModel } from './simulator';

export interface PlcSample {
  id: string;
  name: string;
  description: string;
  dialect: PlcDialect;
  source: string;
  comments: string;
  sim: SimSettings;
}

const MITSUBISHI = `; 드릴 가공 유닛 - 미쓰비시 FX 니모닉 예제 (D0 스텝 번호 방식)
0    LD    M8002          ; 최초 1스캔
1    MOV   K0 D0
6    LD    X0             ; 자동 시작 PB
7    AND=  D0 K0
12   AND   X2             ; 클램프 후진단
13   AND   X4             ; 드릴 상승단
14   MOVP  K10 D0
19   LD=   D0 K10
24   AND   X1             ; 클램프 전진단
25   MOVP  K20 D0
30   LD=   D0 K20
35   OUT   T1 K1          ; 모터 안정화 0.1s
38   LD=   D0 K20
43   AND   T1
44   MOVP  K30 D0
49   LD=   D0 K30
54   AND   X3             ; 드릴 하강단
55   MOVP  K40 D0
60   LD=   D0 K40
65   OUT   T0 K7          ; 가공 드웰 0.7s
68   LD    T0
69   AND=  D0 K40
74   MOVP  K50 D0
79   LD=   D0 K50
84   AND   X4
85   MOVP  K60 D0
90   LD=   D0 K60
95   AND   X2
96   MOVP  K70 D0
101  LD=   D0 K70
106  OUT   T2 K1
109  LD    T2
110  MOVP  K0 D0
115  LD>=  D0 K10
120  AND<= D0 K50
125  OUT   Y0             ; 클램프 SOL
126  LD>=  D0 K20
131  AND<= D0 K50
136  OUT   Y1             ; 드릴 모터
137  LD>=  D0 K30
142  AND<= D0 K40
147  OUT   Y2             ; 드릴 하강 SOL
148  LD=   D0 K70
153  OUT   M10            ; 사이클 완료
154  END
`;

const MITSUBISHI_COMMENTS = `"Device","Comment"
"X0","자동 시작 PB"
"X1","클램프 전진단"
"X2","클램프 후진단"
"X3","드릴 하강단"
"X4","드릴 상승단"
"Y0","클램프 SOL"
"Y1","드릴 모터"
"Y2","드릴 하강 SOL"
"T0","가공 드웰 타이머"
"D0","스텝 번호"
"M10","사이클 완료"
`;

const MITSUBISHI_STL = `; 반송 리프터 - 미쓰비시 FX STL(스텝 래더) 예제
LD   M8002
SET  S0
STL  S0              ; 초기 스텝
LD   X0              ; 기동 PB
AND  X3              ; 리프터 하강단
SET  S20
STL  S20             ; 리프터 상승
OUT  Y0              ; 상승 SOL
LD   X2              ; 리프터 상승단
SET  S21
STL  S21             ; 컨베이어 반출
OUT  Y1              ; 컨베이어 모터
OUT  T0 K15          ; 반출 1.5s
LD   T0
SET  S22
STL  S22             ; 리프터 하강
OUT  Y2              ; 하강 SOL
LD   X3
OUT  S0
RET
END
`;

const LS = `; 픽앤플레이스 - LS XGK 니모닉 예제 (SET/RST 스텝 방식)
LOAD      P00000     ; 시작 PB
AND       P00002     ; Z축 상승단
AND       P00004     ; Y축 후진단
AND NOT   M00010
SET       M00001     ; STEP1 Z 하강
LOAD      M00001
AND       P00001     ; Z축 하강단
SET       M00002     ; STEP2 그립
RST       M00001
LOAD      M00002
TON       T0000 5    ; 그립 대기 0.5s
LOAD      M00002
AND       T0000
SET       M00003     ; STEP3 Z 상승
RST       M00002
LOAD      M00003
AND       P00002
SET       M00004     ; STEP4 Y 전진
RST       M00003
LOAD      M00004
AND       P00003     ; Y축 전진단
SET       M00005     ; STEP5 Z 하강
RST       M00004
LOAD      M00005
AND       P00001
SET       M00006     ; STEP6 언그립
RST       M00005
LOAD      M00006
TON       T0001 3    ; 해제 대기 0.3s
LOAD      M00006
AND       T0001
SET       M00007     ; STEP7 Z 상승
RST       M00006
LOAD      M00007
AND       P00002
SET       M00008     ; STEP8 Y 후진
RST       M00007
LOAD      M00008
AND       P00004
RST       M00008
LOAD      M00001
OR        M00002
OR        M00005
OR        M00006
OUT       P00040     ; Z축 하강 SOL
LOAD      M00002
OR        M00003
OR        M00004
OR        M00005
OUT       P00041     ; 그리퍼 SOL
LOAD      M00004
OR        M00005
OR        M00006
OR        M00007
OUT       P00042     ; Y축 전진 SOL
LOAD      M00001
OR        M00002
OR        M00003
OR        M00004
OR        M00005
OR        M00006
OR        M00007
OR        M00008
OUT       M00010     ; 운전 중
END
`;

const SIEMENS = `// 컨베이어 + 푸셔 분류 - 지멘스 STL 예제
NETWORK 1 // 컨베이어 모터 자기유지
A(
O     I 0.0          // 운전 PB
O     Q 4.0
)
AN    I 0.1          // 정지 PB
=     Q 4.0          // 컨베이어 모터

NETWORK 2 // 제품 감지 2초 후 푸셔 기동
A     Q 4.0
A     I 0.2          // 제품 감지 센서
L     S5T#2S
SD    T 1

NETWORK 3
A     T 1
AN    I 0.4          // 푸셔 전진단
S     Q 4.1          // 푸셔 전진 SOL

NETWORK 4
A     I 0.4
R     Q 4.1

NETWORK 5 // 분류 수량 카운트
A     I 0.4
CU    C 1
L     C 1
T     MW 10          // 분류 수량
`;

const ST = `PROGRAM PLC_PRG
VAR
    Start_PB   AT %IX0.0 : BOOL;   (* 자동 시작 버튼 *)
    Clamp_Adv  AT %IX0.1 : BOOL;   (* 클램프 전진단 *)
    Clamp_Ret  AT %IX0.2 : BOOL;   (* 클램프 후진단 *)
    Press_Down AT %IX0.3 : BOOL;   (* 프레스 하강단 *)
    Press_Up   AT %IX0.4 : BOOL;   (* 프레스 상승단 *)
    Clamp_SOL  AT %QX0.0 : BOOL;   (* 클램프 SOL *)
    Press_SOL  AT %QX0.1 : BOOL;   (* 프레스 하강 SOL *)
    Buzzer     AT %QX0.2 : BOOL;   (* 완료 부저 *)
    Step       : INT := 0;          (* 시퀀스 스텝 *)
    StartTrig  : R_TRIG;
    tHold      : TON;               (* 가압 유지 타이머 *)
    tDone      : TON;
    CycleCount : INT;               (* 생산 수량 *)
END_VAR

StartTrig(CLK := Start_PB);

CASE Step OF
    0:  (* 대기 *)
        IF StartTrig.Q AND Clamp_Ret AND Press_Up THEN
            Step := 10;
        END_IF
    10: (* 클램프 *)
        IF Clamp_Adv THEN Step := 20; END_IF
    20: (* 프레스 하강 *)
        IF Press_Down THEN Step := 30; END_IF
    30: (* 가압 유지 1.2s *)
        IF tHold.Q THEN Step := 40; END_IF
    40: (* 프레스 상승 *)
        IF Press_Up THEN Step := 50; END_IF
    50: (* 언클램프 *)
        IF Clamp_Ret THEN
            Step := 60;
            CycleCount := CycleCount + 1;
        END_IF
    60: (* 완료 부저 0.3s *)
        IF tDone.Q THEN Step := 0; END_IF
END_CASE;

tHold(IN := Step = 30, PT := T#1200MS);
tDone(IN := Step = 60, PT := T#300MS);

Clamp_SOL := Step >= 10 AND Step < 50;
Press_SOL := Step >= 20 AND Step < 40;
Buzzer    := Step = 60;
END_PROGRAM
`;

export function plcSamples(): PlcSample[] {
  const base = defaultSimSettings();
  return [
    {
      id: 'mitsubishi-drill',
      name: '미쓰비시 FX - 드릴 가공 유닛 (D0 스텝)',
      description: '비교 접점(LD=)과 MOVP로 스텝 번호를 진행하는 전형적인 시퀀스',
      dialect: 'mitsubishi',
      source: MITSUBISHI,
      comments: MITSUBISHI_COMMENTS,
      sim: {
        ...base,
        duration: 5000,
        stimuli: [{ device: 'X0', mode: 'pulse', pulses: [{ start: 100, end: 300 }] }],
        models: [
          newCylinderModel({ name: '클램프 실린더', extend: 'Y0', extSensor: 'X1', retSensor: 'X2', extendTime: 300, retractTime: 300 }),
          newCylinderModel({ name: '드릴 실린더', extend: 'Y2', extSensor: 'X3', retSensor: 'X4', extendTime: 500, retractTime: 500 }),
        ],
        watch: ['X0', 'Y0', 'X1', 'X2', 'Y1', 'Y2', 'X3', 'X4', 'T0', 'D0', 'M10'],
        stepDevice: 'D0',
      },
    },
    {
      id: 'mitsubishi-stl',
      name: '미쓰비시 FX - 반송 리프터 (STL 스텝 래더)',
      description: 'STL/RET 스텝 래더 - S 릴레이가 공정 스텝으로 자동 변환됩니다',
      dialect: 'mitsubishi',
      source: MITSUBISHI_STL,
      comments: '',
      sim: {
        ...base,
        duration: 6000,
        stimuli: [{ device: 'X0', mode: 'pulse', pulses: [{ start: 200, end: 400 }] }],
        models: [newCylinderModel({ name: '리프터', extend: 'Y0', retract: 'Y2', extSensor: 'X2', retSensor: 'X3', extendTime: 800, retractTime: 700 })],
        watch: ['X0', 'Y0', 'Y2', 'X2', 'X3', 'Y1', 'T0', 'S0', 'S20', 'S21', 'S22'],
        stepDevice: '@STL',
      },
    },
    {
      id: 'ls-pickplace',
      name: 'LS XGK - 픽앤플레이스 (SET/RST 스텝)',
      description: 'LOAD / AND NOT / TON 등 XG5000 니모닉, 3개 실린더 모델',
      dialect: 'ls',
      source: LS,
      comments: '',
      sim: {
        ...base,
        duration: 8000,
        stimuli: [{ device: 'P00000', mode: 'pulse', pulses: [{ start: 100, end: 300 }] }],
        models: [
          newCylinderModel({ name: 'Z축 실린더', extend: 'P00040', extSensor: 'P00001', retSensor: 'P00002', extendTime: 400, retractTime: 400 }),
          newCylinderModel({ name: '그리퍼', extend: 'P00041', extendTime: 150, retractTime: 150 }),
          newCylinderModel({ name: 'Y축 실린더', extend: 'P00042', extSensor: 'P00003', retSensor: 'P00004', extendTime: 600, retractTime: 600 }),
        ],
        watch: ['P00000', 'P00040', 'P00001', 'P00002', 'P00041', 'P00042', 'P00003', 'P00004', 'T0000', 'T0001', 'M00001', 'M00002', 'M00003', 'M00004', 'M00005', 'M00006', 'M00007', 'M00008'],
        stepDevice: '',
      },
    },
    {
      id: 'siemens-pusher',
      name: '지멘스 STL - 컨베이어 푸셔 분류',
      description: 'A( O ) 괄호 논리, S5 타이머(SD), 카운터(CU), L/T 워드 전송',
      dialect: 'siemens',
      source: SIEMENS,
      comments: '',
      sim: {
        ...base,
        duration: 9000,
        stimuli: [
          { device: 'I0.0', mode: 'pulse', pulses: [{ start: 200, end: 400 }] },
          { device: 'I0.1', mode: 'pulse', pulses: [{ start: 8000, end: 8200 }] },
          { device: 'I0.2', mode: 'pulse', pulses: [{ start: 1000, end: 3150 }, { start: 4500, end: 6650 }] },
        ],
        models: [newCylinderModel({ name: '푸셔 실린더', extend: 'Q4.1', extSensor: 'I0.4', retSensor: 'I0.3', extendTime: 300, retractTime: 300 })],
        watch: ['I0.0', 'I0.1', 'Q4.0', 'I0.2', 'T1', 'Q4.1', 'I0.4', 'I0.3', 'MW10'],
        stepDevice: '',
        autoTrim: false,
      },
    },
    {
      id: 'st-press',
      name: 'IEC ST - 클램프 프레스 (CASE 스텝, 2사이클)',
      description: 'CASE 문 스텝 시퀀스, TON / R_TRIG, AT 주소 변수 (CODESYS / TwinCAT / XG5000 ST 호환)',
      dialect: 'st',
      source: ST,
      comments: '',
      sim: {
        ...base,
        duration: 9000,
        stimuli: [{ device: 'Start_PB', mode: 'pulse', pulses: [{ start: 200, end: 400 }, { start: 4200, end: 4400 }] }],
        models: [
          newCylinderModel({ name: '클램프 실린더', extend: 'Clamp_SOL', extSensor: 'Clamp_Adv', retSensor: 'Clamp_Ret', extendTime: 300, retractTime: 300 }),
          newCylinderModel({ name: '프레스 실린더', extend: 'Press_SOL', extSensor: 'Press_Down', retSensor: 'Press_Up', extendTime: 600, retractTime: 500 }),
        ],
        watch: ['Start_PB', 'Clamp_SOL', 'Clamp_Adv', 'Clamp_Ret', 'Press_SOL', 'Press_Down', 'Press_Up', 'tHold.Q', 'Buzzer', 'Step', 'CycleCount'],
        stepDevice: 'Step',
      },
    },
  ];
}
