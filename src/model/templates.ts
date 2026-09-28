import type { Project } from './types';
import { parseDsl } from '../io/dsl';
import { createProject, sampleProject } from './project';
import { todayString } from './format';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(): Project;
}

const ROBOT = `title: 로봇 ↔ PLC 인터페이스 핸드셰이크
machine: 로봇 셀 R1 - 지그 투입
drawingNo: TC-RBT-010
revision: A
description: PLC 투입 요구 → 로봇 작업 개시 → 간섭영역 진입/퇴피 → 투입 완료 핸드셰이크
duration: 4.5s
grid: 100
unit: s

group PLC → 로봇
sig Y22 "지그 클램프 완료" output : 0 | 300 1 | 4200 0
sig Y21 "간섭영역 진입 허가" output : 0 | 400 1 | 3600 0
sig Y20 "투입 요구" output : 0 | 500 1 | 1000 0
group 로봇 → PLC
sig X20 "로봇 작업 중" input : 0 | 900 1 | 3800 0
sig X23 "로봇 원점" input : 1 | 900 0 | 3800 1
sig X21 "간섭영역 내" input : 0 | 1300 1 | 3500 0
sig X22 "투입 완료" input : 0 | 2800 1 | 3200 0
group 로봇 동작
sig - "로봇 암" actuator on=투입위치 off=원점 : 0 | 900 1~1000 | 2800 0~1000
sig - "그리퍼" actuator on=해제 off=파지 : 0 | 2200 1~200 | 2800 0~200

step "S1 준비" 300..900 "지그 클램프 → 진입 허가 → 투입 요구"
step "S2 투입 이동" 900..1900 "로봇 원점 → 투입 위치"
step "S3 그리퍼 해제" 1900..2800 "워크 안착 후 그리퍼 해제"
step "S4 복귀" 2800..3800 "원점 복귀, 간섭영역 퇴피"

arrow Y20@500 -> X20@900 "작업 개시"
arrow X20@900 -> Y20@1000 "요구 리셋"
arrow X21@3500 -> Y21@3600 "퇴피 확인"
arrow X22@2800 ~> Y22@4200
dim "로봇 암" 900..1900 "이동 1.0s"
marker 3800 "사이클 완료" color=#16a34a

rule delay Y20 rise -> X20 rise max=500 "작업 개시 응답"
rule delay X21 fall -> Y21 fall max=300 "퇴피 후 허가 해제"
rule pulse X22 1 min=200 "완료 신호 폭"
rule cycle max=4s "목표 사이클"
`;

const INVERTER = `title: 인버터 컨베이어 기동 · 정지
machine: CV-03 인버터 컨베이어
drawingNo: TC-CV-003
revision: A
description: 저속 기동 → 고속 운전 → 감속 → 정지. 아날로그 속도 파형과 인버터 신호
duration: 10s
grid: 100
unit: s

group 조작
sig X0 "운전 PB" input : 0 | 500 1 | 800 0
sig X1 "정지 PB" input : 0 | 7000 1 | 7300 0
group 인버터 지령
sig Y0 "운전 (STF)" output : 0 | 500 1 | 7000 0
sig Y1 "고속 선택 (RH)" output : 0 | 3000 1 | 6000 0
sig D100 "속도 지령 (Hz)" bus data : 0 | 500 30 | 3000 60 | 6000 30 | 7000 0
group 인버터 상태
sig - "모터 속도" analog data min=0 max=60 unit=Hz height=1.8 : 0 | 500 0 | 2500 30 | 3000 30 | 4500 60 | 6000 60 | 7000 30 | 9000 0
sig X10 "운전 중 (RUN)" input : 0 | 600 1 | 9000 0
sig X11 "주파수 도달 (SU)" input : 0 | 2500 1 | 3000 0 | 4500 1 | 6000 0 | 7000 0
sig X12 "이상 (ALM)" input : 0

step "가속" 500..2500 "0 → 30Hz, 2s"
step "저속" 2500..3000 ""
step "가속" 3000..4500 "30 → 60Hz"
step "고속 운전" 4500..6000 ""
step "감속" 6000..7000 "60 → 30Hz"
step "정지" 7000..9000 "30 → 0Hz"

arrow X0@500 -> Y0@500 "기동"
arrow Y0@500 -> X10@600 ""
arrow X1@7000 -> Y0@7000 "정지"
dim "모터 속도" 500..2500 "가속 2.0s"

rule delay Y0 rise -> X10 rise max=200 "인버터 응답"
rule exclusive X10 X12 "이상 중 운전 금지"
`;

function fromDsl(text: string): Project {
  const p = parseDsl(text).project;
  p.meta.date = todayString();
  p.revisions = [{ rev: 'A', date: p.meta.date, description: '최초 작성', author: '' }];
  return p;
}

export function templates(): Template[] {
  return [
    { id: 'drill', name: '드릴 가공 유닛 (실린더 · 센서 · 스텝)', description: '클램프/드릴 실린더 동작 경사, 인과 화살표, 규칙 검증 예제', build: sampleProject },
    { id: 'robot', name: '로봇 ↔ PLC 핸드셰이크 (인터록)', description: '요구/응답 핸드셰이크, 간섭영역 인터록, 응답 시간 규칙', build: () => fromDsl(ROBOT) },
    { id: 'inverter', name: '인버터 컨베이어 (아날로그 속도)', description: '아날로그 가감속 파형, 워드 지령값, 인버터 상태 신호', build: () => fromDsl(INVERTER) },
    { id: 'empty', name: '빈 차트', description: '신호 없이 시작', build: () => createProject() },
  ];
}
