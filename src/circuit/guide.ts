import type { PartType } from './types';
import { tr } from '../i18n';

/** 부품 쓰는 법: 무엇인지, 단자, 잇는 순서, 시뮬레이션에서 하는 일, 이 부품을 쓴 예제 */
export interface PartGuide {
  what: string;
  /** [단자, 뜻] */
  pins: [string, string][];
  /** 잇는 순서 */
  steps: string[];
  sim: string;
  /** 예제 회로 id (circuitExamples) */
  example?: string;
}

const g = (what: string, pins: [string, string][], steps: string[], sim: string, example?: string): PartGuide => ({ what, pins, steps, sim, example });

const CLICK = () => tr('시뮬레이션에서 마우스로 누르면 바뀝니다.', 'Click it in the simulation to operate it.');
const AUTO = () => tr('직접 누르는 부품이 아닙니다. 전압이 걸리면 스스로 움직입니다.', 'Not clicked directly: it works by itself when powered.');

export function partGuide(type: PartType): PartGuide | null {
  switch (type) {
    // ───────────── 실물 배선 ─────────────
    case 'r_term':
      return g(
        tr('전원이 들어오는 단자입니다. 회로는 여기서 시작합니다. 극(L1 · L2 · L3 · N · PE · +24V · 0V)과 전원 계통 (3상 4선식 380/220 V · 3상 3선식 380 · 220 V · 단상 3선식 220/110 V · 단상 2선식 220 V) 은 속성에서 고릅니다.', 'Where the supply comes in. Choose its pole and the supply system (3-phase 4-wire, 3-phase 3-wire, 1-phase 3-wire, 1-phase 2-wire) in the properties.'),
        [
          ['L1 · L2 · L3', tr('3상 전원의 세 상 (전동기). 두 상 사이 = 선간 전압 (380 V)', 'the three phases; line voltage between two of them')],
          ['L (L1) · N', tr('단상: L 과 N 사이에 부하를 둡니다 (3상 4선식이면 220 V)', 'single phase: put the load between L and N')],
          [tr('단상 3선식 L1 · N · L2', '1-phase 3-wire L1 · N · L2'), tr('L1-N · L2-N 110 V, L1-L2 220 V. 3상 3선식에는 N 이 없습니다', 'L1-N, L2-N 110 V; L1-L2 220 V. 3-phase 3-wire has no N')],
          ['+24V · 0V', tr('직류 제어 전원', 'DC control supply')],
          ['PE', tr('접지 (전동기 몸체 등). L 과 닿으면 지락', 'earth; touching L is a fault')],
        ],
        [tr('전원 단자를 맨 위에 놓고, 바로 아래에 차단기를 둡니다', 'Put the supply terminals at the top and a breaker right below'), tr('부하(램프 · 코일 · 전동기)는 서로 다른 극 사이에 있어야 동작합니다 (L↔N, +24V↔0V, L1↔L2↔L3)', 'A load works only between two different poles of the same system'), tr('전원 계통은 그림 전체에 하나입니다. 계통에 없는 극 (3상 3선식의 N 등) 은 전압이 나오지 않고 [검사] 에 표시됩니다', 'One supply system per drawing; a pole the system does not have stays dead and is reported')],
        tr('늘 전압이 나옵니다.', 'Always live.'),
        'real',
      );
    case 'r_kepco':
      return g(
        tr('한전에서 특고압 (22.9 kV) 3상을 받는 수전점입니다. 계통 해석의 맨 위에 놓습니다. 수전 전압과 수전점 단락 전류 (한전 협의값, 모르면 12.5 kA) 를 속성에 적습니다.', 'The utility supply point (22.9 kV, 3-phase). Put it at the top; enter the voltage and the fault current at the supply.'),
        [['A · B · C', tr('특고압 세 상. 아래로 VCB → 변압기 1차 (H1 H2 H3)', 'the three HV phases, down to the VCB and transformer primary')]],
        [tr('A B C 에서 진공차단기 VCB 위 단자 (1 3 5) 로 선을 내립니다', 'Run A B C down to the VCB top terminals'), tr('VCB 아래 단자 (2 4 6) 에서 변압기 1차 H1 H2 H3 로 잇습니다', 'From the VCB bottom to the transformer primary'), tr('특고압 선은 저압과 섞이면 단락으로 잡힙니다', 'HV touching LV is a short')],
        tr('늘 전압이 나옵니다. 전류는 변압기가 2차에서 쓰는 만큼 (전압비로 줄여서) 흐릅니다.', 'Always live; carries the transformer load current scaled by the voltage ratio.'),
        'substation',
      );
    case 'r_vcb':
      return g(
        tr('특고압 진공차단기 (VCB) 입니다. 누를 때마다 투입 (빨강) · 개방 (초록) 이 바뀝니다. 정격 전류와 차단 용량 (kA) 을 적으면 수전점 단락 전류와 비교합니다.', 'HV vacuum circuit breaker. Click to close (red) or open (green). Enter its rating and breaking capacity.'),
        [
          [tr('위 1 · 3 · 5', 'top 1, 3, 5'), tr('한전 수전점 쪽 (A B C)', 'utility side')],
          [tr('아래 2 · 4 · 6', 'bottom 2, 4, 6'), tr('변압기 1차 (H1 H2 H3) 쪽', 'transformer side')],
        ],
        [tr('한전 수전점과 변압기 사이에 넣습니다', 'Between the utility supply and the transformer'), tr('개방하면 변압기 2차 아래 전체가 꺼집니다 (정전 시험)', 'Opening it de-energises everything below the transformer')],
        tr('[조작 순서] 에 개방 · 투입을 넣으면 정전 · 복전이 타임차트에 나옵니다.', 'Put open/close steps in the sequence to see an outage in the timechart.'),
        'substation',
      );
    case 'r_tr3':
      return g(
        tr('3상 변압기 (Δ-Y) 입니다. 1차에 특고압 세 상이 다 들어오면 2차에 저압이 나옵니다. 2차 전압은 전원 계통 설정 (기본 380/220 V) 을 따르고, 용량 (kVA) · %임피던스 · X/R 로 부하율 · 전압 변동 · 단락 전류를 계산합니다.', 'A 3-phase transformer (D-Y). When all three HV phases reach the primary, the secondary is live. Rating, %Z and X/R give loading, regulation and fault current.'),
        [
          ['H1 · H2 · H3', tr('1차 (특고압): VCB 아래 단자에서', 'primary (HV), from the VCB')],
          ['X1 · X2 · X3', tr('2차 L1 · L2 · L3: 저압 메인 차단기로', 'secondary L1 L2 L3 to the LV main breaker')],
          ['X0', tr('2차 중성점 (N): 메인 차단기 N 극 · 부스바 N 으로', 'secondary neutral (N)')],
        ],
        [tr('1차는 VCB 아래에서, 2차는 X1 X2 X3 X0 을 저압 메인 4P 차단기 위 단자로 곧게 내립니다 (2칸 간격이 같습니다)', 'Run X1 X2 X3 X0 straight down to a 4P main breaker (same 2-cell spacing)'), tr('메인 아래에 부스바를 두고 분기 차단기를 답니다', 'Put a busbar below and the branch breakers on it')],
        tr('1차가 끊기면 2차도 꺼집니다. [해석] 탭에 부하율 · 2차 · 1차 전류 · 전압 변동 · 2차 단락 전류가 나오고, 차단기마다 설치점 단락 전류를 차단 용량과 비교합니다.', 'Losing the primary turns the secondary off. The Analysis tab shows loading, currents, regulation and fault currents, and checks each breaker against its breaking capacity.'),
        'substation',
      );
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
    case 'r_mcb4':
      return g(
        tr('배선용 차단기입니다. 전원을 손으로 넣고 끊는 곳이고, 실제로는 과전류가 흐르면 스스로 떨어집니다.', 'A circuit breaker: the manual on/off point of the circuit.'),
        [
          [tr('위 단자 (1 · 3 · 5)', 'top (1, 3, 5)'), tr('전원 쪽: 전원 단자에서 내려오는 선', 'supply side')],
          [tr('아래 단자 (2 · 4 · 6)', 'bottom (2, 4, 6)'), tr('부하 쪽: 전자접촉기 · 조작 회로로 가는 선', 'load side')],
        ],
        [
          tr('위에는 전원(L1 L2 L3 또는 L N)을, 아래에는 부하 쪽 선을 잇습니다. 같은 줄의 위 · 아래가 한 극입니다', 'Supply on top, load below; each column is one pole'),
          tr('주회로용(3P)과 조작 회로용(2P 또는 1P)을 따로 두는 것이 보통입니다', 'Usually one breaker for the power circuit and one for the control circuit'),
          tr('속성에 정격 전류 (A) 를 적으면 [해석] 탭이 흐르는 전류와 전선 허용전류를 비교합니다 (IB ≤ In ≤ Iz)', 'Enter the rated current so the Analysis tab can check IB ≤ In ≤ Iz'),
        ],
        tr('시뮬레이션에서 레버를 누르면 ON/OFF 됩니다. 처음에는 ON 입니다.', 'Click the lever to switch it; it starts ON.'),
        'real',
      );
    case 'r_mc':
      return g(
        tr(
          '전자접촉기(MC)는 "전기로 누르는 큰 스위치"입니다. 코일(A1 · A2)에 전압이 걸리면 주접점 3개와 보조접점이 한꺼번에 바뀝니다. 버튼의 작은 전류로 전동기 · 전등 같은 큰 부하를 켜고 끌 때 씁니다.',
          'A contactor is a big switch operated by electricity: powering the coil (A1, A2) switches three main contacts and the auxiliary contacts together.',
        ),
        [
          ['A1 · A2', tr('코일. 이 두 단자 사이에 조작 전압(예: AC 220V)이 걸리면 붙습니다', 'coil: energised when the control voltage is across them')],
          ['1/L1 · 3/L2 · 5/L3', tr('주접점 전원 쪽 (차단기 아래에서)', 'main contacts, supply side')],
          ['2/T1 · 4/T2 · 6/T3', tr('주접점 부하 쪽 (전동기 U · V · W 로)', 'main contacts, load side')],
          ['13 – 14 (NO)', tr('보조 a접점: 코일이 붙으면 닫힘 → 자기유지에', 'aux NO: closes when energised, for self-holding')],
          ['21 – 22 (NC)', tr('보조 b접점: 코일이 붙으면 열림 → 인터록에', 'aux NC: opens when energised, for interlocks')],
        ],
        [
          tr('주회로: 차단기 아래 → 1/L1 · 3/L2 · 5/L3, 그리고 2/T1 · 4/T2 · 6/T3 → 전동기 U · V · W', 'Power: breaker → 1/L1, 3/L2, 5/L3 and 2/T1, 4/T2, 6/T3 → motor U, V, W'),
          tr('코일: A1 은 N(조작 전원 한쪽)에, A2 는 정지 버튼(11-12 b) → 기동 버튼(23-24 a)을 거쳐 L 에 닿게 잇습니다. 순서는 바꿔도 됩니다', 'Coil: one side to N, the other through stop (NC) and start (NO) to L'),
          tr('자기유지: 기동 버튼 23-24 의 양쪽에 13-14 를 나란히(병렬로) 잇습니다. 그러면 버튼에서 손을 떼도 계속 붙어 있습니다', 'Self-holding: wire 13-14 in parallel with the start button'),
        ],
        tr('코일에 전압이 걸리면 가운데 창이 들어가고 불이 켜집니다. 직접 누르는 부품이 아니라 버튼으로 코일을 움직입니다.', 'When the coil is powered the armature pulls in. You operate it through the buttons, not by clicking it.'),
        'real',
      );
    case 'r_thr':
      return g(
        tr('열동형 과부하 계전기(THR)입니다. 전동기에 전류가 너무 많이 흐르면 트립해서 전자접촉기를 떨어뜨립니다. 전자접촉기 바로 아래에 붙입니다.', 'A thermal overload relay: trips on motor overload and drops the contactor.'),
        [
          ['1/L1 · 3/L2 · 5/L3 → 2/T1 · 4/T2 · 6/T3', tr('주회로: 전자접촉기 아래 → THR → 전동기', 'power: contactor → THR → motor')],
          ['95 – 96', tr('b접점: 평소 닫힘, 트립하면 열림 → MC 코일 회로에 직렬로', 'NC: opens on trip, in series with the coil')],
          ['97 – 98', tr('a접점: 트립하면 닫힘 → 경보 램프에', 'NO: closes on trip, for an alarm lamp')],
        ],
        [tr('전자접촉기 2/T1 · 4/T2 · 6/T3 → THR 위, THR 아래 → 전동기', 'Contactor outputs → THR top, THR bottom → motor'), tr('95-96 을 정지 버튼 앞이나 뒤에 직렬로 넣습니다', 'Put 95-96 in series with the stop button')],
        tr('시뮬레이션에서 누르면 트립 / 복귀(R)가 바뀝니다.', 'Click to trip or reset.'),
      );
    case 'r_relay8':
      return g(
        tr('8핀 릴레이와 소켓입니다. 릴레이는 소켓에 꽂고, 전선은 소켓의 나사 단자에 물립니다 (위 줄 6 5 4 3 · 아래 줄 7 8 1 2). 코일에 전압이 걸리면 접점 두 벌이 넘어갑니다. 버튼 신호를 기억(자기유지)하거나 접점 수를 늘릴 때 씁니다.', 'An 8-pin relay on its socket. Wires land on the socket screws (top 6 5 4 3, bottom 7 8 1 2). Powering the coil switches two changeover contacts.'),
        [
          [tr('소켓 단자', 'socket'), tr('아래 줄 바깥쪽 7 · 2 가 코일, 안쪽 8 · 1 이 공통, 위 줄 6 · 3 이 a, 5 · 4 가 b. 소켓이 다르면 속성의 [소켓 단자 배열] 에서 고릅니다', 'bottom outer 7 · 2 coil, inner 8 · 1 commons; top 6 · 3 NO, 5 · 4 NC. Pick your socket layout in the properties')],
          ['2 – 7', tr('코일', 'coil')],
          ['1', tr('첫째 접점의 공통', 'common of contact 1')],
          ['1 – 3 / 1 – 4', tr('a접점 (붙으면 닫힘) / b접점 (붙으면 열림)', 'NO / NC')],
          ['8', tr('둘째 접점의 공통', 'common of contact 2')],
          ['8 – 6 / 8 – 5', tr('a접점 / b접점', 'NO / NC')],
        ],
        [
          tr('코일: 7 은 N 에, 2 는 정지(b) → 기동(a) 버튼을 거쳐 L 에', 'Coil: 7 to N, 2 through stop and start to L'),
          tr('자기유지: 기동 버튼과 나란히 1-3 을 잇습니다 (1 은 기동 버튼 앞, 3 은 뒤 = 2 번과 같은 선)', 'Self-holding: 1-3 in parallel with the start button'),
          tr('남은 8-6 · 8-5 로 램프나 다른 기기를 켭니다', 'Use 8-6 / 8-5 for lamps or other devices'),
        ],
        AUTO() + ' ' + tr('덮개의 결선도에서 접점 날이 a 쪽으로 넘어가는 것이 보입니다.', 'The diagram on the cover shows the contacts moving.'),
        'panel',
      );
    case 'r_fuse':
      return g(
        tr('퓨즈 홀더입니다. 선 중간에 직렬로 넣어 과전류 때 회로를 끊습니다. 조작 회로 · SMPS 앞에 많이 씁니다.', 'A fuse holder, in series with the wire; common in front of control circuits and power supplies.'),
        [['1 – 2', tr('위 (전원 쪽) – 아래 (부하 쪽). 늘 통합니다', 'top (supply) – bottom (load); always conducting')]],
        [tr('전원 바로 아래, 보호할 회로 앞에 넣습니다', 'Place right after the supply, in front of the circuit to protect'), tr('속성에 정격 전류 (A) 를 적으면 [해석] 탭에서 흐르는 전류와 비교합니다', 'Enter its rating to compare with the current in the Analysis tab')],
        tr('늘 통합니다 (끊어지는 것은 흉내 내지 않고, 정격을 넘으면 [해석] 에서 알려 줍니다).', 'Always conducts; the Analysis tab reports overload.'),
        'dc-sensor',
      );
    case 'r_vfd':
      return g(
        tr('인버터 (VFD, 가변 주파수 드라이브) 입니다. 전원을 받아 주파수를 바꾼 3상을 만들어 전동기 속도를 바꿉니다. 정회전 · 역회전 · 다단속 · 가감속 (천천히 기동 · 정지) 을 접점 입력으로 고릅니다. 컨베이어 · 팬 · 펌프에 많이 씁니다.', 'An inverter (variable-frequency drive): turns the supply into a variable-frequency 3-phase output to set motor speed. Forward, reverse, preset speeds and soft accel/decel are chosen by contact inputs; common on conveyors, fans and pumps.'),
        [
          ['R/L1 · S/L2 · T/L3', tr('전원 (차단기 뒤). 단상 기종은 R · S 에 L · N', 'supply after a breaker; single-phase models use R and S')],
          ['U · V · W', tr('전동기로 (전원을 여기에 물리면 인버터가 탐)', 'to the motor (never connect the mains here)')],
          ['PE', tr('접지 (인버터 · 전동기 외함)', 'earth (inverter and motor frame)')],
          ['STF · STR', tr('정회전 · 역회전: SD 와 닫히면 운전 (무전압 접점)', 'forward / reverse: run when closed to SD (dry contact)')],
          ['RH · RM · RL', tr('다단속 고 · 중 · 저 (SD 와 닫히면 그 주파수)', 'preset high / mid / low speed when closed to SD')],
          ['SD', tr('입력 공통 (접점의 다른 쪽을 모두 여기에)', 'input common (the other side of every input contact)')],
          ['A · B · C', tr('고장 릴레이: 평상시 B-C 닫힘, 고장 때 A-C 닫힘 → 경보등 · 차단', 'fault relay: B–C closed normally, A–C on fault → alarm lamp / trip')],
        ],
        [
          tr('3상 전원 → 배선용 차단기 → R/L1 · S/L2 · T/L3, U · V · W → 전동기 (인버터와 전동기 사이에 전자접촉기 · THR 는 보통 넣지 않음, 인버터가 전동기를 보호)', '3-phase supply → breaker → R/S/T, U/V/W → motor (no contactor or overload relay between them as a rule; the inverter protects the motor)'),
          tr('운전 셀렉터 (정 · 정지 · 역) 의 공통을 SD 에, 접점 한쪽을 STF, 다른 쪽을 STR 에', 'Run selector (fwd / stop / rev): common to SD, contacts to STF and STR'),
          tr('속도 셀렉터를 RH · RM · RL 과 SD 사이에. 속성에서 그 주파수 · 가감속 시간을 정합니다', 'Speed selector between RH/RM/RL and SD; set the frequencies and ramp times in the properties'),
          tr('고장 경보: 조작 전원 → C, A → 경보등 → N', 'Fault alarm: control supply → C, A → alarm lamp → N'),
        ],
        tr('운전 입력이 닫히면 가속 시간만큼 주파수가 오르고 (타임차트의 Hz 선이 기울기로), 열리면 감속해서 멈춥니다. 방향을 바꾸면 먼저 0 Hz 까지 감속한 뒤 반대로 돕니다. 시뮬레이션 중 인버터를 누르면 고장 (트립) 이 나서 출력이 끊기고 A-C 가 닫힙니다. 아날로그 속도 입력 (10 · 2 · 5 단자, 볼륨) 과 전류 해석은 아직 하지 않습니다.', 'Closing a run input ramps the frequency up over the accel time (a slope in the chart) and opening it ramps down; reversing stops first. Click the inverter while simulating to trip it. Analog speed input (terminals 10/2/5, potentiometer) and current analysis are not simulated yet.'),
        'vfd-fwd-rev',
      );
    case 'r_imp':
    case 'imp':
      return g(
        tr('임펄스 릴레이 (래칭 릴레이 · 텔레럽터) 입니다. 코일에 짧은 펄스 (푸시버튼 한 번) 가 들어올 때마다 접점이 켜짐 ↔ 꺼짐으로 바뀌고, 버튼을 떼도 · 전원이 끊겨도 그대로 있습니다. 계단 · 복도처럼 여러 곳의 푸시버튼으로 한 전등을 켜고 끌 때 씁니다 (3로 스위치 배선보다 간단).', 'An impulse (latching) relay: every pulse on its coil (one button press) flips its contacts on ↔ off, and they stay there after release or power loss. Used to switch one light from many push buttons (simpler than 3-way switching).'),
        type === 'imp'
          ? [[tr('A1 · A2 (코일)', 'A1, A2 (coil)'), tr('기호가 같은 a · b 접점이 누를 때마다 바뀝니다', 'contacts with the same tag flip on each pulse')]]
          : [
              ['A1 · A2', tr('코일 (AC 220V): 푸시버튼 (a접점) 을 여러 개 나란히 거쳐서', 'coil (AC 220V), through push buttons (NO) in parallel')],
              ['13 → 14', tr('a접점: 켜짐일 때 닫힘 → 전등', 'NO: closed when on → light')],
              ['21 → 22', tr('b접점: 꺼짐일 때 닫힘', 'NC: closed when off')],
            ],
        [
          tr('L → 차단기 → 푸시버튼 (a접점) 들을 나란히 → A1, A2 → N', 'L → breaker → push buttons (NO) in parallel → A1, A2 → N'),
          tr('L → 13, 14 → 전등 → N (전등 전류가 크면 접점 정격 · 16 A 확인)', 'L → 13, 14 → light → N (check the contact rating for big loads)'),
          tr('푸시버튼은 누르는 동안만 닫히는 a접점 (토글 스위치를 쓰면 한 번 바뀐 뒤 코일에 계속 전압이 걸려 코일이 탈 수 있음)', 'Use momentary push buttons; a maintained switch keeps the coil energised'),
        ],
        tr('조작 순서에서 버튼을 누를 때마다 (누름 → 뗌) 접점이 바뀝니다. 타임차트에 코일 (펄스) 과 접점 (래치) 이 따로 나옵니다.', 'Each press in the operation sequence flips the contacts; the chart shows the coil pulses and the latched contacts separately.'),
        'stair-impulse',
      );
    case 'r_sk':
    case 'sk':
      return g(
        tr('스파크 킬러 (CR 서지 흡수기: 저항 + 콘덴서) 입니다. 교류 코일 (SOL · 전자접촉기 · 릴레이) 은 접점이 끊는 순간 큰 서지 전압을 내서 접점을 태우고 노이즈를 만듭니다. 코일 양단에 달아 그 서지를 흡수합니다.', 'A spark killer (RC snubber). An AC coil (solenoid, contactor, relay) throws a voltage spike when its contact breaks, burning the contact and making noise; this absorbs it.'),
        [[tr('1 · 2 (리드선)', '1, 2 (leads)'), tr('극성 없음. 코일의 두 단자에 나란히', 'no polarity; across the two coil terminals')]],
        [
          tr('교류 SOL (2선식 리드선 · DIN 커넥터 1 · 2) 의 두 단자에 나란히 답니다. 밸브 가까이 (커넥터 · 단자대) 일수록 좋습니다', 'Across the two terminals of the AC solenoid, as close to the valve as possible'),
          tr('접점 양단에 달지 마세요: 접점이 열려도 0.1 µF 면 220 V 에서 약 8 mA 가 새어 소형 릴레이 (코일 ≈ 5 mA) · LED 램프가 꺼지지 않습니다', 'Not across the contact: 0.1 µF leaks about 8 mA at 220 V even with the contact open, enough to hold a small relay or light an LED'),
          tr('직류 코일 (DC 24V) 에는 스파크 킬러 대신 환류 다이오드 · TVS 를 씁니다. 서지 흡수가 들어 있는 밸브 · 커넥터면 따로 달지 않아도 됩니다', 'For DC coils use a flyback diode or TVS instead; valves with built-in suppression need nothing extra'),
          tr('380 V 코일에는 AC 440V · 600V 용을 씁니다 (사양에 적으면 [검사] 가 봄)', 'Use a 440 V / 600 V type on 380 V coils (Check compares with the spec)'),
        ],
        tr('시뮬레이션 동작에는 영향이 없고, [검사] 가 자리 (접점 양단 · 전원 양단 · 직류 회로) 와 정격 전압을 봅니다.', 'It does not change the simulation; Check looks at where it is fitted and its voltage rating.'),
        'sol-alternate',
      );
    case 'r_mpcb':
      return g(
        tr('모터 보호 차단기 (MPCB, MMS · GV2 꼴) 입니다. 차단기 (단락 보호) 와 열동 계전기 (과부하 보호) 를 한 몸에 담아, 전동기 하나마다 앞에 둡니다. 앞면 눈금으로 전동기 정격 전류에 맞춰 설정하고, 옆에 붙인 보조 접점 블록 (1a1b) 이 손잡이와 함께 움직입니다.', 'A motor protection circuit breaker (MPCB, MMS / GV2 type): a breaker (short-circuit) and an overload relay in one body, one per motor. Set the dial to the motor current; the side auxiliary block (1NO1NC) follows the handle.'),
        [
          ['1 · 3 · 5 → 2 · 4 · 6', tr('주접점 (전원 → 전동기 쪽 접촉기)', 'main poles (supply → motor contactor)')],
          ['13-14', tr('보조 a접점: 켜져 있으면 닫힘 → 조작 회로에 직렬로 (트립하면 운전 정지)', 'aux NO: closed while on → in series with the control circuit (a trip stops the motor)')],
          ['21-22', tr('보조 b접점: 트립 · OFF 면 닫힘 → 고장등 · 부저', 'aux NC: closed when tripped / off → fault lamp, buzzer')],
        ],
        [
          tr('전원 → 1 · 3 · 5, 2 · 4 · 6 → 전자접촉기 1/L1 · 3/L2 · 5/L3 (THR 은 따로 두지 않음)', 'Supply → 1, 3, 5; 2, 4, 6 → contactor 1/L1, 3/L2, 5/L3 (no separate THR)'),
          tr('[속성] 의 정격 전류에 설정 전류 (전동기 정격 전류) 를 적습니다 (예: 2.2 kW · 380 V ≈ 5 A)', 'Put the set current (motor rated current) in [Rated current], e.g. 2.2 kW 380 V ≈ 5 A'),
          tr('보조 13-14 를 정지 버튼 앞에 직렬로, 21-22 로 트립 표시', 'Aux 13-14 in series before the stop button, 21-22 for the trip indication'),
        ],
        CLICK() + ' ' + tr('누르면 손잡이가 OFF (트립) ↔ ON 으로 바뀌고, 주접점 · 13-14 가 열리고 21-22 가 닫힙니다. 조작 순서에서 OFF 로 과부하 트립을 넣을 수 있습니다.', 'Clicking toggles ON and OFF (trip): the main poles and 13-14 open, 21-22 closes. Put OFF in the sequence to model an overload trip.'),
        'motor-2speed',
      );
    case 'r_tower':
      return g(
        tr('경광등 (시그널 타워) 입니다. 설비 상태를 멀리서 보이게 적색 (고장) · 황색 (주의 · 대기) · 녹색 (운전) 과 부저를 한 기둥에 쌓았습니다. 공통 COM 과 색 단자 사이에 전압을 걸면 그 단이 켜집니다.', 'A signal tower: red (fault), amber (warning / standby), green (running) and a buzzer on one pole. Applying the voltage between COM and a colour terminal lights that tier.'),
        [
          ['COM', tr('공통 (직류면 보통 0V 또는 +24V, 교류면 N)', 'common (0 V or +24 V on DC, N on AC)')],
          ['R · Y · G', tr('적 · 황 · 녹 램프', 'red, amber, green lamps')],
          ['BZ', tr('부저', 'buzzer')],
        ],
        [
          tr('COM 을 전원의 한쪽 극에, 각 색 단자를 그 상태를 나타내는 접점 (접촉기 보조 · 차단기 보조 · PLC 출력) 뒤에 잇습니다', 'COM to one pole; each colour after the contact that shows that state (contactor aux, breaker aux, PLC output)'),
          tr('정격 전압을 [사양] 에 적습니다 (비우면 DC 24V). 교류 220V 회로면 AC 220V 용을 고릅니다', 'Put the rated voltage in [Spec] (DC 24V if empty); use an AC 220V type on 220 V circuits'),
        ],
        AUTO() + ' ' + tr('단마다 켜지고 꺼지며, 타임차트에 단마다 줄이 나옵니다 (선이 이어진 단만).', 'Each tier lights on its own and gets its own chart row (wired tiers only).'),
        'motor-2speed',
      );
    case 'r_motor2s':
      return g(
        tr('2단 속도 전동기 (다알란더, 4극 / 2극) 입니다. 권선 하나를 바꿔 이어 저속 · 고속 두 속도로 돕니다. 저속은 1U 1V 1W 에 전원 (Δ), 고속은 2U 2V 2W 에 전원을 넣고 1U 1V 1W 를 한데 묶습니다 (YY).', 'A two-speed Dahlander motor (4 / 2 poles): one winding reconnected for two speeds. Low: supply on 1U 1V 1W (delta). High: supply on 2U 2V 2W with 1U 1V 1W tied together (double star).'),
        [
          ['1U · 1V · 1W', tr('저속 전원 (저속 접촉기), 고속일 때는 고속 단락 접촉기로 한데 묶음', 'low-speed supply (low contactor); tied together by the star contactor at high speed')],
          ['2U · 2V · 2W', tr('고속 전원 (고속 접촉기)', 'high-speed supply (high contactor)')],
          ['PE', tr('외함 접지', 'frame earth')],
        ],
        [
          tr('접촉기 3대: 저속 MC1 (→ 1U 1V 1W), 고속 MC2 (→ 2U 2V 2W), 고속 단락 MC3 (1U 1V 1W 를 묶음, MC2 와 함께 동작)', 'Three contactors: low MC1 (→ 1U 1V 1W), high MC2 (→ 2U 2V 2W), star MC3 (ties 1U 1V 1W, with MC2)'),
          tr('저속 (MC1) 과 고속 (MC2 · MC3) 은 반드시 인터록 (서로의 b접점). MC1 과 MC3 가 함께 붙으면 단락입니다', 'Interlock low (MC1) and high (MC2, MC3) with each other\'s NC contacts; MC1 with MC3 is a short circuit'),
          tr('저속 · 고속마다 과부하 보호 (THR 또는 모터 보호 차단기) 를 따로 둡니다 (전류가 다름)', 'Separate overload protection for each speed (different currents)'),
        ],
        AUTO() + ' ' + tr('저속 · 고속이 그림과 타임차트 (저속 · 고속 칸) 에 나옵니다. 저속 · 고속이 함께 들어가거나 고속인데 1U 1V 1W 가 묶이지 않으면 알립니다. 전기 해석 (전류) 은 아직 하지 않습니다.', 'Low / high shows on the drawing and the chart; it warns if both are supplied or high runs without the star tie. Not included in the current analysis yet.'),
        'motor-2speed',
      );
    case 'r_motor1':
      return g(
        tr('단상 가역 모터 (인덕션 · 리버시블 기어드 모터, 콘덴서 운전) 입니다. 공통 C 와 A 에 전원을 넣으면 정회전, C 와 B 에 넣으면 역회전합니다. 콘덴서 (모터와 함께 오는 것) 는 A-B 사이에 답니다.', 'A single-phase reversible (induction, capacitor-run) geared motor: supply on C-A runs forward, on C-B reverse. The capacitor supplied with it goes between A and B.'),
        [
          ['C', tr('공통 (N 쪽)', 'common (to N)')],
          ['A', tr('정회전 (정 접촉기 · 릴레이 뒤의 L)', 'forward (L after the forward contactor / relay)')],
          ['B', tr('역회전 (역 접촉기 · 릴레이 뒤의 L)', 'reverse (L after the reverse contactor / relay)')],
          ['PE', tr('외함 접지', 'frame earth')],
        ],
        [
          tr('C → N, A ← 정 접촉기, B ← 역 접촉기. 콘덴서는 단자대에서 A · B 에 함께 물립니다', 'C → N, A ← forward contactor, B ← reverse contactor; the capacitor on A and B at the terminal block'),
          tr('정 · 역 접촉기는 반드시 인터록: A · B 에 함께 전원이 들어가면 콘덴서가 단락되어 탑니다', 'Interlock forward and reverse: power on A and B together shorts the capacitor'),
          tr('방향을 바꿀 때는 완전히 멈춘 뒤에 (가역 모터는 바로 바꿔도 되지만 기어에 무리)', 'Change direction after it stops (reversible motors allow instant reversing but it strains the gears)'),
        ],
        AUTO() + ' ' + tr('정회전 · 역회전이 그림과 타임차트에 나옵니다. A · B 에 함께 전원이 들어가면 알립니다.', 'Forward / reverse shows on the drawing and the chart; it warns if A and B are fed together.'),
        'motor1-rev',
      );
    case 'r_diode':
    case 'diode':
      return g(
        tr('서지 흡수용 다이오드 (환류 다이오드, 1N4007 꼴) 입니다. 직류 코일 (DC 24V 릴레이 · 솔레노이드) 은 접점 · 트랜지스터가 끊는 순간 반대 방향으로 큰 전압을 냅니다. 코일 양단에 거꾸로 (K 를 + 쪽) 달아 그 전류를 코일 안에서 돌려 사그라지게 합니다.', 'A suppression (flyback) diode, 1N4007 type. A DC coil (24 V relay or solenoid) kicks back a large reverse voltage when its contact or transistor opens; fitted reverse-biased across the coil (K to +) it lets that current circulate and die away.'),
        [
          [tr('K (띠 쪽)', 'K (band)'), tr('코일의 + 쪽 단자 (+24V 가 들어오는 쪽)', 'the + end of the coil (where +24 V comes in)')],
          ['A', tr('코일의 0V 쪽 단자', 'the 0 V end of the coil')],
        ],
        [
          tr('코일의 두 단자에 나란히, 띠 (K) 가 + 쪽이 되게 답니다. 평소에는 전류가 흐르지 않습니다', 'Across the two coil terminals with the band (K) on the + side; normally no current flows'),
          tr('거꾸로 달면 코일에 전원이 들어가는 순간 다이오드로 단락됩니다 (퓨즈 · SMPS 보호 동작)', 'Fitted the wrong way it shorts the supply as soon as the coil is energised'),
          tr('교류 코일에는 쓰지 않습니다. 교류는 스파크 킬러 (CR) · 바리스터', 'Not for AC coils: use an RC snubber or varistor there'),
          tr('코일이 떨어지는 시간이 조금 (수 ms ~ 수십 ms) 늦어집니다. 빨리 떨어져야 하면 제너 다이오드 · TVS 를 함께 씁니다', 'The coil drops out a little later (ms to tens of ms); add a Zener or TVS where fast release matters'),
        ],
        tr('시뮬레이션 동작에는 영향이 없고, [검사] 가 방향 (거꾸로면 단락) · 자리 (전원 양단 · 접점 양단) · 교류 회로를 봅니다.', 'It does not change the simulation; Check looks at its direction (reversed = short), where it is fitted and AC circuits.'),
      );
    case 'r_flr':
      return g(
        tr('플로트리스 릴레이 (전극식 수위 릴레이, 61F 꼴) 입니다. 수조에 매단 전극봉 사이가 물로 통하는지를 재서, 물이 상한 E1 에 닿으면 내부 릴레이가 켜지고 하한 E2 아래로 내려가면 꺼집니다. 급수 펌프 · 배수 펌프 자동 운전에 씁니다.', 'A floatless (electrode) level relay, 61F type. It senses whether the electrodes hanging in the tank are bridged by water: the internal relay picks up when the water reaches the high electrode E1 and drops when it falls below the low electrode E2. Used for automatic fill or drain pumps.'),
        [
          ['S1 · S2', tr('릴레이 전원 (AC 220V)', 'relay supply (AC 220V)')],
          ['E1', tr('상한 전극 (가장 짧은 전극봉)', 'high electrode (the shortest rod)')],
          ['E2', tr('하한 전극', 'low electrode')],
          ['E3', tr('공통 전극 (가장 긴 전극봉, 접지)', 'common electrode (the longest rod, earthed)')],
          ['Tc → Ta · Tb', tr('출력 1c: 물이 E1 에 닿으면 Tc-Ta 닫힘 · Tc-Tb 열림, E2 아래로 내려가면 되돌아감', 'output 1 c/o: at E1 Tc-Ta closes and Tc-Tb opens; below E2 they return')],
        ],
        [
          tr('수조의 전극봉 E1 · E2 · E3 을 같은 이름 단자에 잇습니다 (전극 회로는 릴레이 안의 낮은 교류 전압. L · N 을 잇지 마세요)', 'Wire the tank electrodes to the same-named terminals (the electrode circuit runs on a low internal AC voltage; never connect L or N)'),
          tr('급수 (물탱크를 채움): Tc-Tb 를 펌프 전자접촉기 코일 회로에 → 물이 적으면 운전, 가득 차면 정지', 'Filling: Tc-Tb in the pump contactor circuit → runs while low, stops when full'),
          tr('배수 (집수정을 비움): Tc-Ta 를 펌프 회로에 → 물이 차면 운전, E2 아래면 정지', 'Draining (sump): Tc-Ta in the pump circuit → runs when full, stops below E2'),
          tr('E2 를 빼면 유지가 없어 물결마다 펌프가 켜졌다 꺼집니다. 단자 이름은 61F 꼴 기능 이름이니 실물은 기기 옆면 결선도를 따르세요', 'Without E2 there is no hold band and the pump chatters. Terminal names follow the 61F style; follow the label on your relay'),
        ],
        AUTO() + ' ' + tr('수조의 수위가 바뀌어 전극이 잠기고 드러나는 대로 동작하고, 타임차트의 수위 칸에 출력이 나옵니다.', 'It follows the tank level as the electrodes are covered and uncovered; its output appears in the level group of the chart.'),
        'water-supply',
      );
    case 'r_tank':
      return g(
        tr('수조 (물탱크) 와 전극 유지기 · 전극봉 세 개입니다. 물에 잠긴 전극끼리 물로 통합니다. 수위는 급수 기기 (펌프 · 밸브) 가 켜져 있는 동안 오르고, 배수 기기 · 늘 쓰는 양만큼 내려갑니다.', 'A water tank with an electrode holder and three rods. Submerged electrodes are connected through the water. The level rises while the fill device (pump, valve) is on and falls with the drain device and the constant use.'),
        [
          ['E1', tr('상한 전극 (짧음, 기본 80%)', 'high electrode (short, 80% by default)')],
          ['E2', tr('하한 전극 (기본 40%)', 'low electrode (40% by default)')],
          ['E3', tr('공통 전극 (가장 김, 기본 10%)', 'common electrode (longest, 10% by default)')],
        ],
        [
          tr('E1 · E2 · E3 을 플로트리스 릴레이의 같은 이름 단자에 잇습니다', 'Wire E1, E2, E3 to the same-named terminals of the floatless relay'),
          tr('[속성] 에서 전극 높이, 처음 수위, 급수 · 배수 기기의 기호 (예: M1) 와 속도 (%/s), 늘 쓰는 양을 정합니다', 'In Properties set the electrode heights, start level, fill/drain device tags (e.g. M1), their rates (%/s) and the constant use'),
          tr('가득 찼는데 급수가 계속되면 (넘침) · 비었는데 배수가 계속되면 (공운전) 시뮬레이션이 알립니다', 'The simulation warns on overflow (still filling when full) and dry running (still draining when empty)'),
        ],
        tr('시뮬레이션 중 수조를 누르면 누른 높이로 수위가 바뀝니다 (조작 순서의 [수위 →] 로도). 수위는 타임차트에 % 아날로그 선으로 나옵니다.', 'Click the tank while simulating to set the level at that height (or use [Level →] in the sequence). The level is drawn as an analog % line in the chart.'),
        'water-supply',
      );
    case 'r_smps':
      return g(
        tr('SMPS (직류 전원 장치) 입니다. 교류 L · N 을 받아 직류 24V 를 만듭니다. 센서 · PLC · 직류 릴레이 · 솔레노이드의 전원입니다.', 'A switching power supply: AC in, 24 V DC out, for sensors, PLCs, DC relays and solenoids.'),
        [
          ['L · N', tr('교류 입력 (차단기 · 퓨즈 뒤에서)', 'AC input, after a breaker or fuse')],
          ['FG', tr('접지 (녹황 전선으로 PE 에)', 'frame ground, to PE')],
          ['+V · -V', tr('직류 24V 출력. +V 가 +24V, -V 가 0V', 'DC output: +V is +24 V, -V is 0 V')],
        ],
        [tr('L · N 을 퓨즈나 차단기 뒤에 잇고 FG 를 접지합니다', 'Wire L and N after a fuse or breaker and earth FG'), tr('+V 에서 직류 부하의 + 쪽 (스위치 · 센서 갈색선) 으로, -V 는 0V 모선으로 잇습니다', 'Feed the + side of DC loads from +V and return to -V')],
        AUTO() + ' ' + tr('입력이 들어오면 초록 LED 가 켜지고 출력이 나옵니다.', 'The green LED lights and the output is live when the input is powered.'),
        'dc-sensor',
      );
    case 'r_prox':
      return g(
        tr('3선식 근접 · 광전 센서입니다. 물체를 감지하면 검정 (출력) 선이 살아납니다. PNP 는 출력이 + 로, NPN 은 0V 로 이어집니다.', 'A 3-wire proximity or photo sensor. When it detects, the black output switches: PNP to +, NPN to 0 V.'),
        [
          [tr('갈색', 'brown'), tr('+24V (전원 +)', '+24 V')],
          [tr('파랑', 'blue'), tr('0V (전원 –)', '0 V')],
          [tr('검정', 'black'), tr('출력. PNP: 감지하면 +24V 가 나옴 → 부하의 반대쪽은 0V 에. NPN: 감지하면 0V 로 당김 → 부하의 반대쪽은 +24V 에', 'output. PNP sources +24 V (load to 0 V); NPN sinks to 0 V (load to +24 V)')],
        ],
        [tr('갈색 → +24V, 파랑 → 0V', 'Brown to +24 V, blue to 0 V'), tr('검정 → 릴레이 코일이나 PLC 입력. 코일의 반대쪽은 PNP 면 0V, NPN 이면 +24V', 'Black to a relay coil or PLC input; the other side of the coil goes to 0 V (PNP) or +24 V (NPN)'), tr('극성을 바꿔 이으면 [검사] 탭이 알려 줍니다', 'The Check tab reports reversed polarity')],
        tr('시뮬레이션에서 센서를 누르면 감지 (다시 누르면 해제) 됩니다. 속성에서 실린더 끝에 연결하면 실린더가 닿을 때 스스로 감지합니다.', 'Click to detect or release; link it to a cylinder end in the properties to make it automatic.'),
        'dc-sensor',
      );
    case 'r_prox2':
      return g(
        tr('2선식 근접 센서입니다. 갈색 · 파랑 두 선뿐이고, 리밋 스위치처럼 부하 (릴레이 코일 · PLC 입력 · 램프) 와 직렬로 잇습니다. 센서 전원은 부하를 거쳐 받습니다. 직류용 (DC 12-24V) 은 극성이 있고, 교류용 (AC 100-240V) 은 극성이 없습니다.', 'A 2-wire proximity sensor: just brown and blue, wired in series with the load (relay coil, PLC input, lamp) like a limit switch; it takes its supply through the load. The DC type is polarised, the AC type is not.'),
        [
          [tr('갈색 (BN)', 'brown (BN)'), tr('직류: + 쪽 (+24V 쪽이나 부하의 + 쪽). 교류: 어느 쪽이든', 'DC: the + side (+24 V, or the + end of the load). AC: either side')],
          [tr('파랑 (BU)', 'blue (BU)'), tr('직류: 0V 쪽 (부하 쪽이나 0V). 교류: 어느 쪽이든', 'DC: the 0 V side. AC: either side')],
        ],
        [
          tr('+24V → 갈색, 파랑 → 부하 → 0V (또는 +24V → 부하 → 갈색, 파랑 → 0V)', '+24 V → brown, blue → load → 0 V (or +24 V → load → brown, blue → 0 V)'),
          tr('부하 없이 전원 두 극 사이에 바로 이으면 감지하는 순간 단락되어 센서가 탑니다 → [검사] 탭이 알려 줍니다', 'Never wire it straight across the supply: it shorts and burns when it detects (the Check tab reports this)'),
          tr('꺼져 있어도 누설전류 (약 1 mA 이하) 가 흐르고 켜지면 잔류전압 (몇 V) 이 남습니다. 소형 릴레이 · PLC 입력이 꺼지지 않으면 부하와 나란히 블리더 저항을 답니다', 'Off-state leakage (≤ about 1 mA) and on-state residual voltage (a few V): if a small relay or PLC input will not drop out, add a bleeder resistor across the load'),
        ],
        tr('시뮬레이션에서 센서를 누르면 감지 (다시 누르면 해제) 됩니다. 직류용을 거꾸로 이으면 켜지지 않습니다. 속성에서 실린더 끝에 연결하면 실린더가 닿을 때 스스로 감지합니다.', 'Click to detect or release. A reversed DC sensor does not switch on. Link it to a cylinder end in the properties to make it automatic.'),
        'prox2',
      );
    case 'r_ls':
    case 'r_fsw':
    case 'r_float':
    case 'r_psw':
      return g(
        type === 'r_ls'
          ? tr('리밋 스위치입니다. 기계가 롤러 레버를 밀면 접점이 바뀝니다. 끝 위치에서 멈추거나 되돌릴 때 씁니다.', 'A limit switch: the machine pushes the roller lever and the contacts change.')
          : type === 'r_fsw'
            ? tr('풋 스위치입니다. 밟는 동안 접점이 바뀝니다 (손이 바쁠 때 발로 운전).', 'A foot switch: contacts change while it is pressed.')
            : type === 'r_float'
              ? tr('플로트 스위치입니다. 수위가 오르면 뜨개가 올라가 접점이 바뀝니다. 급수 · 배수 펌프 자동 운전에 씁니다.', 'A float switch: contacts change when the level rises; for pump control.')
              : tr('압력 스위치 (전기 접점식 압력계) 입니다. 설정 압력에 닿으면 접점이 바뀝니다. 컴프레서 · 펌프 자동 운전에 씁니다.', 'A pressure switch: contacts change at the set pressure; for compressor and pump control.'),
        [
          ['11 – 12', tr('b접점: 평소 닫힘, 동작하면 열림 → 멈추게 할 때', 'NC: opens when operated, to stop')],
          ['23 – 24', tr('a접점: 평소 열림, 동작하면 닫힘 → 켜거나 알릴 때', 'NO: closes when operated, to start or signal')],
        ],
        [tr('멈춤: 코일로 가는 선 중간에 11-12 (b) 를 직렬로 넣습니다', 'To stop: put 11-12 (NC) in series with the coil'), tr('기동 · 표시: 23-24 (a) 로 코일이나 램프를 켭니다', 'To start or signal: use 23-24 (NO)')],
        type === 'r_ls' || type === 'r_fsw' ? tr('시뮬레이션에서 누르고 있는 동안 동작합니다. 리밋 스위치는 속성에서 실린더 끝에 연결할 수 있습니다.', 'Hold the mouse button to operate it; a limit switch can be linked to a cylinder end.') : tr('시뮬레이션에서 누를 때마다 동작 · 복귀가 바뀝니다 (수위 · 압력이 올랐다 내렸다).', 'Click to toggle (level or pressure up and down).'),
        'pump-float',
      );
    case 'r_pbl':
      return g(
        tr('조광형 푸시버튼입니다. 버튼 접점과 램프가 한 몸에 있습니다. 누르는 동안 접점이 바뀌고, 램프는 X1-X2 에 전압이 걸리면 따로 켜집니다.', 'An illuminated push button: momentary contacts and a lamp in one body; the lamp is wired separately on X1-X2.'),
        [
          ['11 – 12', tr('b접점 (정지용)', 'NC (stop)')],
          ['23 – 24', tr('a접점 (기동용)', 'NO (start)')],
          ['X1 – X2', tr('램프. 운전 중 표시하려면 X1 을 코일과 같은 선 (또는 a접점 뒤) 에, X2 를 N · 0V 에', 'lamp: X1 to the coil wire, X2 to N or 0 V')],
        ],
        [tr('접점은 일반 푸시버튼처럼 잇습니다', 'Wire the contacts like an ordinary push button'), tr('램프 X1 을 릴레이 a접점 뒤에 이으면 운전 중에 버튼이 켜집니다', 'Feed X1 from a relay NO contact to light the button while running')],
        tr('시뮬레이션에서 누르는 동안 눌립니다. 램프는 회로대로 켜집니다.', 'Hold to press; the lamp follows the circuit.'),
        'dc-sensor',
      );
    case 'r_buzzer':
      return g(tr('부저입니다. X1-X2 에 전압이 걸리면 울립니다. 경보 · 고장 알림에 씁니다.', 'A buzzer: sounds while X1-X2 is powered.'), [['X1 – X2', tr('두 단자 사이에 전압 (극성 없음으로 봅니다)', 'supply across the two terminals')]], [tr('X1 을 경보 접점 (a) 뒤에, X2 를 N · 0V 에 잇습니다', 'X1 after the alarm contact, X2 to N or 0 V')], AUTO(), 'dc-sensor');
    case 'r_sol':
      return g(
        tr('공압 솔레노이드 밸브 (5포트) 입니다. 코일에서 리드선 2가닥이 나옵니다 (직류: 빨강 + · 검정 -). 전압이 걸리면 밸브가 넘어가 1 → 4 (A) 로 공기가 나가 실린더가 전진합니다. 실린더 · 공압 밸브의 솔레노이드 기호로 고르면 함께 움직입니다. 속성에서 DIN 커넥터 (1 · 2 · 접지) 로 바꿀 수 있습니다.', 'A 5-port pneumatic solenoid valve with two lead wires from the coil (DC: red +, black -). Powered, it shifts and sends air 1 → 4 (A). Pick its tag as the solenoid of a cylinder or valve to link them. Switch to a DIN connector (1, 2, earth) in the properties.'),
        [
          [tr('빨강 (+)', 'red (+)'), tr('직류 코일의 + : 릴레이 a접점 · PLC 출력 · 센서 뒤 (+24V 쪽)', '+ of a DC coil: after the relay NO contact, PLC output or sensor')],
          [tr('검정 (-)', 'black (-)'), tr('0V 로', 'to 0 V')],
          [tr('DIN 커넥터', 'DIN connector'), tr('1 · 2 가 코일 (교류는 극성 없음), PE 는 접지 (교류 밸브는 PE 에 잇기)', '1 and 2 are the coil; PE is earth (connect it on AC valves)')],
        ],
        [
          tr('빨강을 접점 (출력) 뒤에, 검정을 0V 에 잇습니다. 거꾸로 이으면 [검사] 탭이 알려 줍니다 (LED · 서지 흡수 다이오드가 든 코일은 극성이 있음)', 'Red after the contact or output, black to 0 V; the Check tab reports reversed leads'),
          tr('코일 전압은 속성에서 고릅니다 (비우면 DC 24V). 다른 전압에 이으면 [검사] 탭이 알려 줍니다', 'Pick the coil voltage in the properties (DC 24 V when empty); the Check tab reports a wrong supply'),
        ],
        AUTO() + ' ' + tr('여자되면 표시등이 켜지고 유체가 흐릅니다.', 'The indicator lights and flow is shown while energised.'),
        'dc-sensor',
      );
    case 'r_fan':
      return g(tr('판넬 팬 (단상) 입니다. L-N 에 전압이 걸리면 돕니다. 제어반 냉각에 씁니다.', 'A single-phase panel fan: runs while L-N is powered.'), [['L · N', tr('단상 전원', 'single-phase supply')]], [tr('차단기 뒤 L 과 N 에 바로, 또는 온도 스위치 접점을 거쳐 잇습니다', 'After a breaker, directly or through a thermostat contact')], AUTO() + ' ' + tr('돌 때 날개가 회전합니다.', 'The blades spin while it runs.'), 'pump-float');
    case 'r_outlet':
      return g(tr('콘센트입니다. L · N · PE 를 잇습니다. 전등 회로와 따로 차단기를 두는 것이 보통입니다.', 'A socket outlet with L, N and PE.'), [['L', tr('상 (갈색)', 'line (brown)')], ['N', tr('중성선 (파랑)', 'neutral (blue)')], ['PE', tr('접지 (녹황)', 'earth (green-yellow)')]], [tr('누전차단기 뒤에서 L · N 을, 접지 바에서 PE 를 잇습니다', 'L and N after an ELB, PE from the earth bar')], tr('그림만 있고 동작은 없습니다. PE 가 빠지면 [검사] 탭이 알려 줍니다.', 'No behaviour; the Check tab reports a missing PE.'), 'home-outlet');
    case 'r_motor6':
      return g(
        tr('6단자 3상 전동기입니다 (Y-Δ 기동용). 권선 세 개의 양 끝이 모두 나와 있습니다: U1-U2 · V1-V2 · W1-W2. 기동은 Y 결선으로 전류를 줄이고, 몇 초 뒤 Δ 결선으로 바꿉니다.', 'A 6-lead 3-phase motor for star-delta starting: windings U1-U2, V1-V2, W1-W2.'),
        [
          ['U1 · V1 · W1', tr('전원 쪽 (주 접촉기 아래 L1 L2 L3)', 'supply side, from the main contactor')],
          ['W2 · U2 · V2', tr('반대쪽 끝. Y: 셋을 한데 묶음 (Y 접촉기). Δ: U2→L2, V2→L3, W2→L1 (Δ 접촉기)', 'far ends. Star: tie the three together. Delta: U2→L2, V2→L3, W2→L1')],
          ['PE', tr('접지', 'earth')],
        ],
        [tr('주 접촉기 MC1 → U1 V1 W1', 'Main contactor to U1 V1 W1'), tr('Y 접촉기 MC2: W2 U2 V2 를 한데 묶습니다 (아래 세 단자를 점퍼)', 'Star contactor: ties W2 U2 V2 together'), tr('Δ 접촉기 MC3: U2 를 L2 에, V2 를 L3 에, W2 를 L1 에. MC2 와 MC3 은 서로 b접점 인터록', 'Delta contactor: U2 to L2, V2 to L3, W2 to L1; interlock star and delta')],
        AUTO() + ' ' + tr('돌 때 몸통에 결선 (Y · Δ) 이 적힙니다. Y 와 Δ 가 함께 붙으면 단락입니다.', 'The body shows Y or Δ while running; star and delta together is a short.'),
        'star-delta',
      );
    case 'r_nbar':
      return g(tr('중성선 바 · 접지 바입니다. 나사가 모두 한 구리 막대에 물려 있어서, 여러 회로의 N (또는 PE) 을 한곳에 모읍니다.', 'A neutral or earth bar: every screw is on one copper bar.'), [[tr('나사 1 … n', 'screws 1…n'), tr('모두 서로 이어져 있습니다', 'all connected together')]], [tr('전원의 N (또는 PE) 을 한 나사에, 각 회로의 N (PE) 을 나머지 나사에 한 가닥씩 물립니다', 'Supply N (or PE) on one screw, one circuit per remaining screw'), tr('오른쪽 끝 손잡이를 끌어 나사 수를 바꿉니다', 'Drag the right handle to change the number of screws')], tr('늘 통합니다.', 'Always conducts.'), 'home-outlet');
    case 'r_vm':
      return g(tr('전압계입니다. 두 단자 사이 전압을 보여 줍니다 (선 사이에 나란히 = 병렬).', 'A voltmeter: shows the voltage between its terminals (in parallel).'), [['V1 · V2', tr('재려는 두 선 (L-N, L1-L2, +24V-0V)', 'the two wires to measure')]], [tr('재려는 두 선에 한 가닥씩 잇습니다. 회로 동작에는 영향을 주지 않습니다', 'One wire to each; it does not affect the circuit')], tr('시뮬레이션 중에 값이 나옵니다 (부하가 하나라도 있어야 계산합니다).', 'Shows a value during simulation.'), 'dc-sensor');
    case 'r_am':
      return g(tr('전류계입니다. 선 중간에 직렬로 넣으면 그 선에 흐르는 전류를 보여 줍니다.', 'An ammeter: in series with a wire, shows its current.'), [['1 – 2', tr('늘 통합니다. 재려는 선을 끊고 그 사이에 넣습니다', 'always conducting; insert into the wire')]], [tr('부하로 가는 선 중간에 넣습니다', 'Insert into the wire to the load')], tr('시뮬레이션 중에 값이 나옵니다.', 'Shows a value during simulation.'), 'dc-sensor');
    case 'r_duct':
      return g(tr('배선 덕트입니다. 실제 판넬처럼 선을 덕트 안으로 지나가게 정리해 보이는 그림입니다 (전기적으로는 아무것도 하지 않음).', 'A wire duct: a drawing aid that covers the wires running inside it.'), [[tr('단자', 'terminals'), tr('없음 (그림만 있는 부품)', 'none (drawing only)')]], [tr('기기 줄 사이에 놓고, 오른쪽 아래 손잡이를 끌어 길이 · 폭을 맞춥니다. R 로 세웁니다', 'Place between device rows; drag the handle to size it; R rotates'), tr('덕트 안의 선은 흐리게 보입니다. 선을 고치려면 덕트 밖에서 누르거나 덕트를 잠시 옮깁니다', 'Wires inside are dimmed')], tr('동작은 없습니다.', 'No behaviour.'), 'dc-sensor');
    case 'r_rail':
      return g(tr('DIN 레일입니다. 차단기 · 릴레이 소켓 · 단자대를 올려 다는 레일을 그림으로 보여 줍니다 (전기적으로는 아무것도 하지 않음).', 'A DIN rail: a drawing aid behind the devices.'), [[tr('단자', 'terminals'), tr('없음 (그림만 있는 부품)', 'none (drawing only)')]], [tr('기기 줄 뒤에 놓고, 오른쪽 끝 손잡이를 끌어 길이를 맞춥니다', 'Place behind a row of devices and drag the handle to length')], tr('동작은 없습니다.', 'No behaviour.'), 'dc-sensor');
    case 'r_my2':
    case 'r_my4': {
      const four = type === 'r_my4';
      return g(
        four
          ? tr('각형 릴레이 4c (MY4N 꼴) 와 소켓 (PYF14A 꼴) 입니다. 릴레이는 소켓에 꽂고, 전선은 소켓의 나사 단자에 물립니다. 코일에 전압이 걸리면 접점 네 벌이 함께 넘어갑니다.', 'A 4-pole blade relay (MY4N type) on its socket (PYF14A type). The relay plugs in; wires land on the socket screws.')
          : tr('각형 릴레이 2c (MY2N 꼴) 와 소켓 (PYF08A 꼴) 입니다. 릴레이는 소켓에 꽂고, 전선은 소켓의 나사 단자에 물립니다. 코일에 전압이 걸리면 접점 두 벌이 함께 넘어갑니다.', 'A 2-pole blade relay (MY2N type) on its socket (PYF08A type). The relay plugs in; wires land on the socket screws.'),
        [
          ['13 – 14', tr('코일 (소켓 맨 아래 단). 직류 코일이면 13 이 –, 14 가 +', 'coil (bottom tier); for DC 13 is –, 14 is +')],
          [four ? '9 · 10 · 11 · 12' : '9 · 12', tr('공통 (아래 안쪽 단)', 'commons (lower inner tier)')],
          [four ? '5 · 6 · 7 · 8' : '5 · 8', tr('a접점 (위 안쪽 단): 코일이 붙으면 공통과 닫힘', 'NO (upper inner tier)')],
          [four ? '1 · 2 · 3 · 4' : '1 · 4', tr('b접점 (위 바깥 단): 평소 공통과 닫혀 있음', 'NC (upper outer tier)')],
          [four ? '9-5-1 · 10-6-2 · 11-7-3 · 12-8-4' : '9-5-1 · 12-8-4', tr('한 벌 (같은 세로줄의 세 단자)', 'one changeover (same column)')],
        ],
        [
          tr('코일: 13 은 N 에, 14 는 정지(b) → 기동(a) 버튼을 거쳐 L 에', 'Coil: 13 to N, 14 through stop and start to L'),
          tr('자기유지: 9 를 기동 버튼 앞에, 5 를 기동 버튼 뒤 (14 와 같은 선) 에 잇습니다', 'Self-holding: 9 before the start button, 5 after it (same wire as 14)'),
          tr('남은 벌의 공통 (12 …) 에 L 을 주고 a (8 …) 로 운전 램프, b (4 …) 로 정지 램프를 켭니다', 'Feed L to another common and use NO / NC for lamps'),
          tr('그림에서 안쪽 단 나사는 선이 바깥 단 사이로 지나가도록 반 칸 옆에 그렸습니다. 실물은 위아래 단이 같은 줄에 있고 번호는 같습니다', 'Inner-tier screws are drawn half a step aside so wires can pass; the numbers match the real socket'),
        ],
        AUTO() + ' ' + tr('덮개 안의 접점 날이 a 쪽으로 넘어가고 동작 표시등이 켜집니다.', 'The blades move to the NO side and the indicator lights.'),
        'relay-socket',
      );
    }
    case 'r_timer8':
      return g(
        tr('8핀 타이머와 소켓입니다. 타이머는 소켓에 꽂고, 전선은 소켓의 나사 단자에 물립니다 (위 줄 6 5 4 3 · 아래 줄 7 8 1 2). 전원(2-7)이 들어오고 설정 시간이 지나면 한시 접점이 넘어갑니다 (ON 딜레이). "기동하고 3초 뒤에" 같은 동작에 씁니다.', 'An 8-pin timer on its socket; wires land on the socket screws (top 6 5 4 3, bottom 7 8 1 2). After power is applied for the preset time its timed contacts switch (on-delay).'),
        [
          [tr('소켓 단자', 'socket'), tr('아래 줄 바깥쪽 7 · 2 가 전원, 안쪽 8 · 1 이 공통, 위 줄 6 · 3 이 a, 5 · 4 가 b', 'bottom outer 7 · 2 power, inner 8 · 1 commons; top 6 · 3 NO, 5 · 4 NC')],
          ['2 – 7', tr('전원 (이 사이에 전압이 걸려 있는 동안 시간을 잽니다)', 'power: times while energised')],
          ['8 – 6 / 8 – 5', tr('한시 a접점 (시간이 지나면 닫힘) / 한시 b접점 (시간이 지나면 열림)', 'timed NO / timed NC')],
          ['1 – 3 / 1 – 4', tr('한시 접점 한 벌 더. 속성에서 순시(전원이 들어오면 바로)로 바꿀 수 있습니다', 'second timed pair, or instantaneous if chosen')],
        ],
        [tr('7 은 N 에, 2 는 타이머를 돌리고 싶은 신호(예: 릴레이 a접점 뒤)에', '7 to N, 2 to the signal that should start timing'), tr('시간이 지난 뒤 켤 것은 a접점(8-6)에, 그동안만 켤 것은 b접점(8-5)에 잇습니다', 'What turns on after the delay goes on the NO contact; what is on meanwhile goes on the NC')],
        AUTO() +
          ' ' +
          tr(
            '다이얼에 지난 시간이 차오르고, 시간이 되면 UP 램프가 켜집니다. 동작은 속성에서: ON 딜레이 (전원이 들어오고 설정 시간 뒤 ON), OFF 딜레이 (전원이 들어오면 바로 ON, 전원이 빠지고 설정 시간 뒤 OFF), 인터벌 (전원이 들어오면 바로 ON, 설정 시간 뒤 OFF: "감지하면 3초만" 같은 원샷), 플리커 (켜짐 · 꺼짐 반복, 꺼짐 시간을 따로 넣으면 트윈 타이머).',
            'The dial fills as time passes. Modes: on-delay, off-delay (on at once, off after the delay once power is removed), interval (on at once, off after the preset: a one-shot), flicker (separate off time = twin timer).',
          ),
        'sensor-oneshot',
      );
    case 'r_pb':
      return g(
        tr('푸시버튼입니다. 누르는 동안만 접점이 바뀝니다.', 'A push button: its contacts change only while pressed.'),
        [
          ['11 – 12', tr('b접점: 평소 닫힘, 누르면 열림 → 정지 버튼에', 'NC: opens when pressed, for stop')],
          ['23 – 24', tr('a접점: 평소 열림, 누르면 닫힘 → 기동 버튼에', 'NO: closes when pressed, for start')],
        ],
        [tr('정지 버튼은 11-12 를, 기동 버튼은 23-24 를 씁니다', 'Stop uses 11-12, start uses 23-24'), tr('L → 정지 11-12 → 기동 23-24 → 코일 순서로 직렬로 잇습니다', 'Wire L → stop 11-12 → start 23-24 → coil in series')],
        tr('시뮬레이션에서 누르고 있는 동안 눌립니다.', 'Hold the mouse button to keep it pressed.'),
        'real',
      );
    case 'r_ss':
      return g(
        tr('셀렉터 스위치입니다. 손잡이를 돌려 두면 그 자리에 머뭅니다 (자동/수동 선택, 운전 선택).', 'A selector switch that stays where you turn it (auto/manual, run select).'),
        [
          ['11 – 12', tr('손잡이가 0 일 때 닫힘', 'closed in position 0')],
          ['23 – 24', tr('손잡이가 1 일 때 닫힘', 'closed in position 1')],
        ],
        [tr('한 가지만 켜고 끄려면 23-24 만 씁니다 (1 로 돌리면 ON)', 'For simple on/off use 23-24 only'), tr('자동/수동: 11 과 23 에 L 을 주고, 12 → 자동 쪽(타임 스위치 등), 24 → 수동 쪽으로 잇습니다', 'Auto/manual: feed 11 and 23, wire 12 to the auto path and 24 to the manual path')],
        tr('시뮬레이션에서 누를 때마다 0 ↔ 1 로 바뀝니다.', 'Each click turns it between 0 and 1.'),
        'tsw-panel',
      );
    case 'r_ss3':
      return g(
        tr('3단 셀렉터 스위치입니다. 왼쪽 · 가운데 · 오른쪽 세 자리에 머뭅니다 (수동 · 정지 · 자동, 정 · 정지 · 역 등).', 'A 3-position selector that stays in left, centre or right (manual / off / auto, forward / off / reverse …).'),
        [
          ['13 – 14', tr('손잡이가 왼쪽일 때 닫힘 (보통 수동)', 'closed in the left position (usually manual)')],
          ['23 – 24', tr('손잡이가 오른쪽일 때 닫힘 (보통 자동)', 'closed in the right position (usually auto)')],
          [tr('가운데', 'Centre'), tr('두 접점 모두 열림 (정지)', 'both contacts open (off)')],
        ],
        [
          tr('조작 전원을 13 과 23 에 함께 주고 (점퍼), 14 → 수동 회로 (기동 · 정지 버튼), 24 → 자동 회로 (플로트 · 타임 스위치 등) 로 잇습니다', 'Feed 13 and 23 together (jumper); 14 goes to the manual path (buttons), 24 to the automatic path (float, time switch …)'),
          tr('자리 이름은 속성에서 바꿉니다 (예: 정 / 정지 / 역)', 'Rename the positions in the properties (e.g. FWD / OFF / REV)'),
        ],
        tr('시뮬레이션에서 손잡이의 왼쪽을 누르면 왼쪽으로, 오른쪽을 누르면 오른쪽으로 돌고, 같은 쪽을 한 번 더 누르면 가운데로 돌아옵니다. 조작 순서표에서는 동작을 왼쪽 · 가운데 · 오른쪽으로 고릅니다.', 'Click the left or right side of the knob to turn it; click the same side again to return to the centre. In the operation list pick left, centre or right.'),
        'pump-manual-auto',
      );
    case 'r_plc':
      return g(
        tr('제어반에 다는 PLC (CPU 일체형, 입력 16 · 릴레이 출력 16) 입니다. DC 24V 전원이 + · − 에 들어와야 돌고, PLC 시뮬레이션 탭의 프로그램 (니모닉 · 래더) 을 스캔마다 실행합니다. 전원이 끊겼다 들어오면 처음부터 다시 돕니다.', 'A panel PLC (compact CPU, 16 inputs and 16 relay outputs). It runs only with 24 V DC on + and −, executing the program from the PLC tab every scan, and restarts from scratch after a power loss.'),
        [
          ['+ · −', tr('PLC 전원 DC 24V (SMPS 에서, 퓨즈 · 차단기를 거쳐)', 'PLC supply 24 V DC (from the SMPS, through a fuse or breaker)')],
          ['FG', tr('접지 (PE) — 노이즈를 빼는 길', 'frame ground (PE)')],
          ['COM', tr('입력 공통. 0V 를 물리면 싱크 (입력에 +24V 가 오면 ON), +24V 를 물리면 소스 (입력에 0V 가 오면 ON)', 'input common: 0V for sink inputs (ON with +24V), +24V for source inputs (ON with 0V)')],
          [tr('입력 16', '16 inputs'), tr('버튼 · 셀렉터 · 리밋 · 센서 · MC 보조 접점 · THR 접점. DC 24V 만 (AC 220V 를 넣으면 입력 회로가 탑니다)', 'buttons, selectors, limits, sensors, MC aux and THR contacts — 24 V DC only (220 V AC burns the input)')],
          ['COM0 · COM1', tr('출력 공통 (0~7 · 8~15). 그룹마다 따로 전원과 퓨즈를 줍니다', 'output commons (0–7, 8–15), each with its own supply and fuse')],
          [tr('출력 16', '16 outputs'), tr('릴레이 접점 (보통 2A). 프로그램이 켜면 COM 과 이어집니다', 'relay contacts (typically 2 A), closed to their COM when the program turns them on')],
        ],
        [
          tr('SMPS +V → 퓨즈 → PLC +, SMPS −V → PLC −, FG → PE 바', 'SMPS +V → fuse → PLC +, SMPS −V → PLC −, FG → earth bar'),
          tr('싱크 입력: COM → 0V, +24V → 버튼 · 센서 → 입력 단자', 'Sink inputs: COM → 0V, +24V → button / sensor → input'),
          tr('정지 · 비상정지 · THR 처럼 끊겨야 안전한 신호는 b접점으로 받습니다 (선이 끊어져도 정지 쪽)', 'Read stop, E-stop and overload as NC contacts so a broken wire also means stop'),
          tr('출력으로 전자접촉기 코일 · 전동기를 바로 움직이지 말고, DC 24V 보조 릴레이 (인터포징 릴레이) 를 거칩니다. 출력 공통에는 퓨즈를', 'Do not switch contactor coils or motors straight from the outputs: go through 24 V DC interposing relays, and fuse the output commons'),
          tr('비상정지 · THR 는 PLC 와 따로 MC 코일 회로를 직접 끊게 배선합니다 (PLC 가 고장 나도 멈추게)', 'Wire the E-stop and overload to break the MC coil circuit directly, independent of the PLC'),
        ],
        tr('시뮬레이션 중에는 입력 · 출력 LED 와 PWR · RUN 램프가 켜지고, [속성] 칸에 래더 모니터가 나옵니다. 주소 (X0 / P00000 …) 는 속성에서 정하고, 프로그램은 PLC 시뮬레이션 탭에서 고칩니다.', 'While simulating the I/O LEDs and PWR/RUN lamps light and the ladder monitor shows in Properties. Set the addresses in Properties and edit the program in the PLC tab.'),
        'plc-panel',
      );
    case 'r_hmi':
      return g(
        tr('제어반 문에 다는 HMI (터치 판넬) 입니다. 화면의 버튼 · 스위치 · 램프가 PLC 의 디바이스 (M100 처럼) 를 통신으로 쓰고 읽습니다. 선으로 잇는 것은 전원뿐입니다.', 'A door-mounted HMI (touch panel): its screen buttons, switches and lamps write and read PLC devices (like M100) over the link; only the supply is wired.'),
        [
          ['+ · −', tr('HMI 전원 DC 24V', 'HMI supply 24 V DC')],
          ['FG', tr('접지 (PE)', 'frame ground (PE)')],
          [tr('버튼', 'button'), tr('누르는 동안 디바이스 = 1', 'device = 1 while pressed')],
          [tr('스위치', 'switch'), tr('누를 때마다 1 ↔ 0 (불이 디바이스 값을 보여 줌)', 'toggles 1 ↔ 0 on each press (lit while 1)')],
          [tr('램프', 'lamp'), tr('디바이스가 1 이면 켜짐 (운전 · 고장 표시)', 'lit while the device is 1 (run / fault)')],
        ],
        [
          tr('속성에서 화면 칸 (버튼 · 스위치 · 램프) 과 PLC 디바이스를 정합니다', 'Set the screen items and their PLC devices in the properties'),
          tr('HMI 버튼은 PLC 입력 (X · P) 이 아닌 내부 릴레이 (M) 에 씁니다. 입력은 PLC 가 스캔마다 단자 값으로 덮어씁니다', 'Point HMI buttons at internal relays (M), not at inputs (X / P), which the PLC overwrites from the terminals each scan'),
          tr('로컬 · 원격 셀렉터로 어느 쪽 조작을 받을지 PLC 프로그램에서 고릅니다. 비상정지는 HMI 가 아닌 배선으로', 'Use a local/remote selector in the program to choose which commands count; keep the E-stop hardwired, not on the HMI'),
        ],
        tr('시뮬레이션에서 화면의 버튼을 누르면 PLC 가 다음 스캔에 읽습니다. 조작 순서표에서는 HMI1-1, HMI1-2 … (칸 번호) 를 고릅니다. 전원이 없거나 PLC 가 멈추면 "통신 이상" 으로 버튼이 듣지 않습니다.', 'Click the screen buttons while simulating; the PLC reads them on the next scan. In the operation list choose HMI1-1, HMI1-2 … (item numbers). Without power or a running PLC the panel shows a link error and ignores presses.'),
        'plc-panel',
      );
    case 'r_counter':
      return g(
        tr('프리셋 카운터입니다. 입력이 들어올 때마다 하나씩 세고, 설정 수에 닿으면 출력 접점이 바뀌어 리셋할 때까지 유지합니다 (제품 수 세기, 몇 번 왕복 뒤 정지).', 'A preset counter: counts each input and switches its output at the preset until reset (counting products, stop after n strokes).'),
        [
          ['A1 · A2', tr('카운터 전원 (AC 220V). 전원이 없으면 세지 않고 출력도 꺼집니다', 'counter supply (AC 220V); without it nothing counts and the output is off')],
          ['CP – COM', tr('계수 입력 (무전압 접점): 리밋 스위치 · 센서 접점 · 버튼의 a접점을 이 두 단자 사이에. 닫힐 때마다 1 셈', 'count input (dry contact): put a limit switch, sensor or button contact between them; each closing counts one')],
          ['RST – COM', tr('리셋 입력 (무전압 접점): 닫히면 0 으로', 'reset input (dry contact): closing resets to 0')],
          ['C → NO · NC', tr('출력 1c: 설정 수에 닿으면 C-NO 닫힘 · C-NC 열림', 'output 1 c/o: at the preset C-NO closes, C-NC opens')],
        ],
        [
          tr('입력은 전압을 넣지 않는 접점 입력입니다. CP · RST · COM 에 L 이나 N 을 잇지 마세요 (기기가 상합니다)', 'The inputs are dry contacts: never wire L or N to CP, RST or COM'),
          tr('정지시키려면 출력 C-NC 를 자기유지 회로에 직렬로, 완료 표시는 C-NO 뒤에 램프를', 'To stop a machine put C-NC in series with the holding circuit; put a lamp after C-NO for "done"'),
          tr('단자 번호는 기종마다 다릅니다. 실물은 기기 옆면의 결선도를 따르세요', 'Terminal numbers differ by model; follow the label on your counter'),
        ],
        tr('시뮬레이션에서는 CP-COM 이 이어지는 순간마다 하나씩 세고, 센 수와 출력이 타임차트의 카운터 칸에 나옵니다.', 'In the simulation each closing of CP-COM counts one; the count and the output appear in the chart.'),
        'counter',
      );
    case 'r_tc8':
      return g(
        tr('8핀 소켓에 꽂는 온도 조절기 (48×48, 오토닉스 T3S 꼴: 앞면 썸휠 스위치로 설정) 입니다. 측온저항체 (Pt100) 로 잰 온도가 설정보다 낮으면 출력 릴레이를 붙여 히터 · 열풍기의 전자접촉기를 켭니다 (ON/OFF 제어). 센서가 끊기면 oPEn 을 띄우고 출력을 끕니다.', 'A plug-in 48×48 temperature controller (Autonics T3S type, thumbwheel set point) on an 8-pin socket. Below the set point (Pt100 RTD) it closes its output relay to drive the heater contactor (ON/OFF control). With the sensor open it shows oPEn and switches the output off.'),
        [
          ['L · N', tr('조절기 전원 (AC 100-240V)', 'controller supply (AC 100-240V)')],
          ['COM → NO', tr('제어 출력 (릴레이 a접점, 250VAC 5A): 가열이면 온도가 낮을 때 닫힘 → 전자접촉기 코일로', 'control output (NO, 250 VAC 5 A): closes while too cold when heating → contactor coil')],
          ['COM → NC', tr('같은 릴레이의 b접점 (설정에 닿으면 닫힘)', 'NC contact of the same relay (closes at the set point)')],
          ["A · B · B'", tr("측온저항체 입력: A 에 한 가닥, B · B' 에 같은 색 두 가닥 (3선식). 굵기 · 길이가 같은 선으로", "RTD input: the single lead on A, the two same-colour leads on B and B' (3-wire), same size and length")],
        ],
        [
          tr('L → 차단기 · 퓨즈 → L, N → N 으로 전원', 'Feed L → breaker / fuse → L, N → N'),
          tr('조작 L → COM, NO → 전자접촉기 A1, A2 → N. 열풍기 · 히터는 접촉기 주접점 뒤에 (출력 릴레이 5 A 로 히터를 바로 켜지 마세요)', 'Control L → COM, NO → contactor A1, A2 → N; the heater goes after the contactor (do not run a heater straight off the 5 A relay)'),
          tr("측온저항체 A · B · B' → 조절기 A · B · B' (단자대를 거쳐도 됨). 전원선과 따로 배선", "RTD A, B, B' → controller A, B, B' (through a terminal block is fine); keep away from power wiring"),
          tr('속성에서 설정 온도 · 히스테리시스와 [온도를 바꾸는 부하] (히터 기호) · 오르내리는 속도를 정합니다', 'Set the set point, hysteresis, the heating load and the rates in the properties'),
          tr('단자 번호 (1~8) 는 기종마다 다르니 기기 옆면의 결선도대로 기능 이름 (L N COM NO NC A B B\') 을 맞춥니다', "Pin numbers (1–8) differ by model; match the function names to the label on the side"),
        ],
        tr('히터가 켜지면 온도가 오르고 설정 온도에서 출력이 꺼졌다가 히스테리시스만큼 내려가면 다시 켜집니다. 센서 선을 하나라도 빼면 oPEn 으로 출력이 꺼집니다 (번아웃 보호). 시뮬레이션 중 기기의 왼쪽 · 오른쪽을 누르면 온도가 5℃ 내리고 오릅니다.', 'With the heater on the temperature rises; the output opens at the set point and closes again one hysteresis lower. Remove any sensor lead and it shows oPEn and opens its output (burn-out protection). Click its left or right side while simulating to change the temperature by 5℃.'),
        'blower-timer',
      );
    case 'r_rtd':
      return g(
        tr("측온저항체 (Pt100 Ω, 0℃ 에서 100 Ω) 입니다. 백금의 저항이 온도에 따라 바뀌는 것을 온도 조절기가 읽습니다. 리드선 세 가닥 (3선식) 은 선 저항을 빼 주려는 것입니다.", 'A Pt100 RTD (100 Ω at 0℃): the controller reads the platinum resistance that changes with temperature; the third lead cancels the wire resistance.'),
        [
          ['A', tr('한 가닥 (보통 빨강) → 조절기 A', 'the single lead (often red) → controller A')],
          ["B · B'", tr("같은 색 두 가닥 (보통 흰색) → 조절기 B · B' (서로 바뀌어도 됨)", "the two same-colour leads (often white) → controller B and B' (either way round)")],
        ],
        [
          tr('보호관을 재려는 곳 (덕트 · 탱크 · 열풍 출구) 에 나사로 고정합니다', 'Screw the sheath into the place to measure (duct, tank, hot-air outlet)'),
          tr('세 가닥 모두 굵기 · 길이가 같아야 하고 (선 저항 한 가닥 5 Ω 이하), 동력선과 떨어뜨려 배선합니다', 'All three leads must match in size and length (≤ 5 Ω each) and run away from power cables'),
          tr('리드선 색은 제조사 · 규격 (IEC · JIS) 마다 다르니 한 가닥 = A, 같은 색 두 가닥 = B · B\' 로 구분합니다', "Lead colours differ by maker and standard; the odd one is A, the matching pair is B and B'"),
        ],
        tr('조절기 A · B · B\' 에 제대로 이어지면 조절기가 묶음 온도를 읽고, 빠지거나 바뀌면 [검사] 가 알리고 조절기가 oPEn 으로 출력을 끕니다.', "Wired to A, B, B' the controller reads the zone temperature; a missing or swapped lead is flagged in Check and the controller shows oPEn with its output off."),
        'blower-timer',
      );
    case 'r_tk4':
      return g(
        tr('PID 온도 조절기 (48×48 나사 단자, 오토닉스 TK4S 꼴) 입니다. T3S 처럼 설정에서 켜고 끄기만 하는 것이 아니라, 제어 주기 (릴레이 출력이면 보통 20초) 마다 편차 · 적분 · 미분으로 조작량 MV (%) 를 계산해 그 비율만큼 출력을 닫아 둡니다 (시간 비례). 그래서 온도가 설정 근처에서 거의 흔들리지 않습니다. 앞면에 PV (지금 온도) · SV (설정) 두 줄이 나오고 키로 설정하며, 소켓 없이 뒤쪽 나사 단자에 바로 배선합니다. 입력은 열전대 · 측온저항체 · 아날로그를 다 받는 멀티 입력이라 파라미터에서 입력 종류를 맞춥니다.', 'A 48×48 screw-terminal PID controller (Autonics TK4S type). Unlike the T3S, which only switches at the set point, every control cycle (about 20 s for a relay output) it computes MV (%) from error, integral and derivative and keeps the output closed for that share (time-proportional), so the temperature hardly swings. PV and SV are shown on two lines, set with keys; it is wired straight to its rear screws (no socket). Multi-input: set the input type in the parameters.'),
        [
          ['L · N', tr('전원 (AC 100-240V)', 'supply (AC 100-240V)')],
          ['C1 → OUT1', tr('제어 출력 (릴레이 a접점, 250VAC 3A) → 전자접촉기 코일. SSR 구동 출력 기종 (TK4S-T4SN 등) 은 SSR 입력으로', 'control output (relay NO, 250 VAC 3 A) → contactor coil; SSR-drive models go to an SSR input')],
          ['C2 → AL1', tr('경보 출력 (릴레이 a접점): 경보 온도 이상이면 닫힘 → 경보등 · 부저', 'alarm output (relay NO): closes above the alarm temperature → lamp / buzzer')],
          ["10 A · 11 B · 12 B'", tr("측온저항체 Pt100 3선식: 빨강 (다른 색 한 가닥) → 10, 같은 색 두 가닥 → 11 · 12 (서로 바뀌어도 됨)", "Pt100 3-wire RTD: the red (odd) lead → 10, the matching pair → 11 and 12 (either way)")],
          ['485+ · 485-', tr('RS485 통신 (PLC · HMI 에서 SV 쓰기 · PV 읽기). 시뮬레이션은 하지 않음', 'RS485 (read PV / write SV from a PLC or HMI); not simulated')],
        ],
        [
          tr('L → 차단기 · 퓨즈 → L, N → N 으로 전원', 'Feed L → breaker / fuse → L, N → N'),
          tr('조작 L → C1, OUT1 → 전자접촉기 A1, A2 → N (과열 차단 접점이 있으면 C1 앞에 직렬로)', 'Control L → C1, OUT1 → contactor A1, A2 → N (an over-temperature cut-off goes in series before C1)'),
          tr('조작 L → C2, AL1 → 경보등 X1, X2 → N', 'Control L → C2, AL1 → alarm lamp X1, X2 → N'),
          tr("측온저항체를 10 · 11 · 12 에. 파라미터의 입력 종류를 Pt100 (DPt100) 으로 바꿉니다 (다른 센서로 두면 온도가 틀립니다)", 'RTD on 10, 11, 12; set the input type parameter to Pt100 (DPt100), otherwise the reading is wrong'),
          tr('속성에서 설정 온도 · P · I · D · 제어 주기 · 경보 온도를 정합니다. 실제 기기는 오토튜닝 (AT) 으로 P · I · D 를 구합니다', 'Set SV, P, I, D, cycle and alarm in the properties; real units find P, I, D by auto-tuning (AT)'),
          tr('P · I · D 가 하는 일: P (비례대 ℃) = 편차만큼 출력, 좁을수록 세게 (너무 좁으면 흔들림), P 만이면 설정보다 조금 낮은 곳에서 멈춤 (잔류 편차). I (적분 시간 s) = 남은 편차를 쌓아 없앰, 짧을수록 빨리 (너무 짧으면 넘침). D (미분 시간 s) = 빨리 오를 때 미리 줄여 넘침을 막음. 예제 [PID 배우기] 에서 네 가지를 한 차트로 비교합니다', 'What P, I, D do: P (band, ℃) gives output in proportion to the error, narrower = stronger (too narrow swings) and P alone settles a little below SV (offset). I (integral time, s) builds up the remaining error and removes it, shorter = faster (too short overshoots). D (derivative time, s) brakes a fast rise to limit overshoot. The example "Learn PID" compares all four on one chart'),
          tr('나머지 단자 (전원 · 출력 · 경보 · 통신) 번호는 기종 (옵션 기호) 마다 다르니 기기 옆면 결선도를 따르세요', 'Other terminal numbers depend on the option code; follow the label on the side'),
        ],
        tr('처음에는 MV 100% 로 계속 켜져 있다가 설정에 가까워지면 20초 중 켜 두는 시간이 줄어들고, 설정 온도에 머무르면 열이 빠지는 만큼만 켭니다. 앞면에 MV % 가 보입니다. 센서가 끊기면 oPEn 으로 출력을 끕니다. 제어 방식을 ON/OFF 로 바꾸면 T3S 처럼 히스테리시스로 동작합니다.', 'It starts at MV 100%, then shortens the on-time per 20 s as it nears SV and settles at just enough heat to cover the losses; MV % is shown on the front. An open sensor shows oPEn and switches the output off. Set the method to ON/OFF to behave like the T3S.'),
        'oven-pid',
      );
    case 'r_rtd2':
      return g(
        tr('측온저항체 Pt100 더블 (소자 2개, 3선식 × 2 = 6가닥) 입니다. 한 보호관 안의 두 소자를 서로 다른 기기 (예: PID 조절기 + 과열 차단 · 기록계 · PLC 아날로그 입력) 에 따로 잇습니다. 한 소자를 두 기기에 같이 물리면 두 기기의 측정 전류가 섞여 둘 다 온도가 틀어지기 때문입니다.', 'A duplex Pt100 RTD (two elements, 2 × 3 wires). Each element goes to a different instrument (e.g. the PID controller and an over-temperature cut-off, recorder or PLC input); sharing one element between two instruments mixes their measuring currents and both read wrong.'),
        [
          ["A1 · B1 · B1'", tr("1번 소자 (보통 빨강 한 가닥 · 흰색 두 가닥) → 첫 기기의 A · B · B'", "element 1 (often red + two whites) → first instrument's A, B, B'")],
          ["A2 · B2 · B2'", tr("2번 소자 (다른 색. 이 그림의 검정 · 회색은 예시) → 둘째 기기의 A · B · B'", "element 2 (other colours; black / grey here are an example) → second instrument's A, B, B'")],
        ],
        [
          tr("소자마다 한 가닥만 색이 다른 것이 A, 같은 색 두 가닥이 B · B' 입니다. 색은 제조사마다 다르니 성적서 · 라벨을 보고, 모르면 테스터로 잽니다 (같은 소자의 B-B' 는 거의 0 Ω, A-B 는 약 100 Ω 이상)", "In each element the odd-coloured lead is A and the matching pair is B and B'. Colours vary by maker; check the label or measure (B–B' ≈ 0 Ω, A–B ≈ 100 Ω or more)"),
          tr('1번 소자를 주 조절기에, 2번 소자를 과열 차단 · 기록계에 잇습니다', 'Element 1 to the main controller, element 2 to the cut-off or recorder'),
          tr('쓰지 않는 소자는 끝을 절연해서 단자대에 남겨 둡니다 (예비)', 'Insulate and park an unused element on the terminal block as a spare'),
        ],
        tr("각 소자가 이어진 기기는 같은 온도 묶음을 읽습니다. 한 소자에 두 기기를 물리면 [검사] 가 알립니다.", 'Each instrument reads the zone temperature through its own element; Check warns when two instruments share one element.'),
        'oven-pid',
      );
    case 'r_tc':
      return g(
        tr('온도 조절기 (48×48) 입니다. 센서 (열전대 K) 로 잰 지금 온도 (PV) 를 설정 온도 (SV) 와 비교해서 출력 접점을 켜고 끕니다 (ON/OFF 제어). 히터 · 건조기 · 금형 온도 관리에 씁니다.', 'A 48×48 temperature controller: compares the measured temperature (PV, K thermocouple) with the set point (SV) and switches its output relay (ON/OFF control). Used for heaters, dryers and moulds.'),
        [
          ['A1 · A2', tr('조절기 전원 (AC 100-240V). 전원이 없으면 출력이 모두 꺼집니다', 'controller supply (AC 100-240V); without it both outputs are off')],
          ['C1 → OUT', tr('제어 출력 (릴레이 a접점): 가열이면 온도가 낮을 때 닫힘. 히터를 바로 켜지 말고 전자접촉기 · SSR 코일을 켭니다', 'control output (NO relay): closes while too cold when heating. Drive a contactor or SSR, not the heater directly')],
          ['C2 → AL', tr('경보 출력 (릴레이 a접점): 경보 온도 이상이면 닫힘 → 경보등 · 부저, 또는 히터 회로 차단', 'alarm output (NO relay): closes above the alarm temperature → alarm lamp, buzzer, or cut the heater circuit')],
        ],
        [
          tr('L → 차단기 → A1, A2 → N 으로 전원을 줍니다', 'Feed L → breaker → A1, A2 → N'),
          tr('L → C1, OUT → 전자접촉기 (또는 SSR) 코일 → N. 히터는 접촉기 주접점 뒤에', 'L → C1, OUT → contactor (or SSR) coil → N; the heater goes after the contactor'),
          tr('L → C2, AL → 경보등 → N', 'L → C2, AL → alarm lamp → N'),
          tr('속성에서 설정 온도 · 히스테리시스 · 경보 온도와 [온도를 바꾸는 부하] (히터 기호) 를 정합니다', 'Set the set point, hysteresis, alarm and the load that heats it (heater tag) in the properties'),
          tr('단자 번호는 기종마다 다릅니다. 실물은 기기 옆면의 결선도를 따르세요', 'Terminal numbers differ by model; follow the label on your controller'),
        ],
        tr('히터가 켜지면 온도가 오르고 꺼지면 내려갑니다 (속도는 속성). 설정 온도에서 OUT 이 꺼지고 히스테리시스만큼 내려가면 다시 켜져서, 타임차트에 온도 선과 OUT · AL 이 함께 나옵니다. 시뮬레이션 중 기기의 왼쪽 · 오른쪽을 누르면 온도가 5℃ 내리고 오릅니다.', 'With the heater on the temperature rises, off it falls (rates in the properties). OUT turns off at the set point and back on one hysteresis lower; the chart shows the temperature line with OUT and AL. While simulating, click its left or right side to lower or raise the temperature by 5℃.'),
        'tc-heater',
      );
    case 'r_thermo':
      return g(
        tr('판넬 서모스탯 (바이메탈) 입니다. 판넬 안 온도에 따라 접점이 바뀌어 판넬 팬이나 판넬 히터를 바로 켜고 끕니다. 전원이 필요 없습니다.', 'A bimetal panel thermostat: its contact switches with the panel temperature to run a panel fan or heater directly. Needs no supply.'),
        [
          ['1 · 2', tr('접점: 팬 · 히터와 직렬로 (L → 1, 2 → 팬 → N)', 'contact: in series with the fan or heater (L → 1, 2 → fan → N)')],
          [tr('NC (빨간 다이얼)', 'NC (red dial)'), tr('히터용: 온도가 설정에 닿으면 열림, 차만큼 내려가면 닫힘', 'heater: opens at the set point, closes again one differential lower')],
          [tr('NO (파란 다이얼)', 'NO (blue dial)'), tr('팬용: 온도가 설정에 닿으면 닫힘, 차만큼 내려가면 열림', 'fan: closes at the set point, opens again one differential lower')],
        ],
        [
          tr('팬은 NO (예: 35℃), 결로 방지 히터는 NC (예: 10℃) 를 씁니다', 'Use NO for a fan (e.g. 35℃) and NC for an anti-condensation heater (e.g. 10℃)'),
          tr('같은 판넬 안이면 속성의 [온도 묶음 이름] 을 같게 (예: 판넬) 해서 같은 온도를 재게 합니다', 'Give thermostats in one panel the same zone name (e.g. panel) so they read one temperature'),
          tr('접점 용량보다 큰 부하는 릴레이 · 접촉기를 거쳐 켭니다', 'Switch loads above the contact rating through a relay or contactor'),
        ],
        tr('조작 순서의 [온도 →] 로 판넬 온도를 바꾸거나, 시뮬레이션 중 기기의 왼쪽 · 오른쪽을 눌러 5℃씩 내리고 올립니다. 팬을 [온도를 바꾸는 부하] 로 정하면 팬이 돌 때 내려갑니다.', 'Change the panel temperature with a [Temp. →] step, or click its left/right side while simulating (±5℃). Set the fan as the load that changes it and it cools while running.'),
        'panel-thermo',
      );
    case 'r_ssr':
      return g(
        tr('SSR (무접점 릴레이) 입니다. 직류 신호 (PLC · 온도 조절기 · 스위치) 로 교류 부하 (히터 · 램프) 를 켜고 끕니다. 접점이 닳지 않아 자주 켜고 끄는 히터에 씁니다.', 'A solid-state relay: a DC signal (PLC, temperature controller, switch) switches an AC load (heater, lamp). No contacts to wear, so it suits heaters switched often.'),
        [
          ['3 (+) · 4 (-)', tr('입력: DC 24V 의 + 를 3 에, 0V 를 4 에 (극성이 바뀌면 동작하지 않음)', 'input: +24 V to 3, 0 V to 4 (reversed polarity does not work)')],
          ['1 · 2', tr('출력: 교류 부하와 직렬로 (L → 1, 2 → 부하 → N)', 'output: in series with the AC load (L → 1, 2 → load → N)')],
        ],
        [
          tr('SSR 은 켜질 때 열이 납니다. 방열판에 달고, 부하 전류에 여유 있는 정격을 고릅니다', 'SSRs run hot: mount on a heat sink and choose a rating with margin'),
          tr('출력 앞에 차단기 (또는 속단 퓨즈) 를 둡니다', 'Put a breaker (or fast fuse) ahead of the output'),
        ],
        tr('입력에 + 와 0V 가 바르게 걸리면 출력 1-2 가 바로 통합니다.', 'With + and 0 V on the input the output 1-2 conducts at once.'),
        'ssr-heater',
      );
    case 'r_estop':
      return g(
        tr('비상정지 스위치입니다. 누르면 잠겨서 회로를 끊고, 다시 누르면(실제로는 돌리면) 풀립니다.', 'An emergency stop: latches when pressed and cuts the circuit.'),
        [
          ['11 – 12', tr('b접점: 평소 닫힘, 누르면 열림 → 조작 회로 맨 앞에 직렬로', 'NC: in series at the head of the control circuit')],
          ['23 – 24', tr('a접점: 누르면 닫힘 → 경보 램프 · 부저에', 'NO: for an alarm lamp or buzzer')],
        ],
        [tr('조작 전원 L 을 먼저 11-12 에 통과시킨 뒤 나머지 회로로 보냅니다. 그래야 누르면 전부 꺼집니다', 'Pass the control supply through 11-12 first so pressing it drops everything')],
        tr('시뮬레이션에서 누르면 잠기고(LOCK), 다시 누르면 풀립니다.', 'Click to latch, click again to release.'),
        'panel',
      );
    case 'r_lamp':
      return g(tr('파일럿 램프(표시등)입니다. 두 단자 사이에 전압이 걸리면 켜집니다.', 'A pilot lamp: lights when voltage is across its terminals.'), [['X1 · X2', tr('한쪽은 켜고 싶은 신호(접점 뒤)에, 다른 쪽은 N(또는 0V)에', 'one side to the signal, the other to N or 0V')]], [tr('운전 표시: MC 나 릴레이의 a접점 뒤에. 정지 표시: b접점 뒤에', 'Run lamp after an NO contact, stop lamp after an NC contact')], AUTO(), 'panel');
    case 'r_motor3':
      return g(
        tr('3상 유도 전동기입니다. U · V · W 에 세 상이 모두 들어오면 돕니다.', 'A 3-phase motor: runs when all three phases reach U, V, W.'),
        [
          ['U · V · W', tr('전자접촉기 2/T1 · 4/T2 · 6/T3 에서', 'from the contactor outputs')],
          ['PE', tr('접지 단자에 (녹황 선)', 'to the earth terminal')],
        ],
        [tr('L1→U, L2→V, L3→W 순서면 정회전, 두 상을 바꾸면 역회전입니다', 'L1-U, L2-V, L3-W runs forward; swapping two phases reverses'), tr('두 상만 닿으면 결상으로 돌지 않습니다', 'With only two phases it does not run')],
        AUTO() + ' ' + tr('돌면 팬이 회전하고 FWD / REV 가 표시됩니다.', 'The fan spins and FWD/REV is shown.'),
        'real',
      );
    case 'r_tb':
      return g(
        tr('단자대입니다. 판넬 안 기기와 밖(문에 붙은 버튼 · 램프, 현장 기기)을 이어 주는 중간 연결점입니다.', 'A terminal block: the hand-over point between panel devices and door or field devices.'),
        [[tr('번호마다 위 · 아래 나사', 'two screws per number'), tr('같은 번호의 위와 아래는 속에서 이어져 있습니다', 'top and bottom of one number are connected')]],
        [tr('판넬 안 기기의 선은 아래 나사에, 문 · 현장으로 나가는 선은 위 나사에 물립니다', 'Panel wires on the bottom screws, outgoing wires on the top'), tr('극수는 속성에서 바꿉니다. 결선표에서 위 · 아래는 같은 선번호가 됩니다', 'Change the number of poles in the properties')],
        tr('늘 통합니다.', 'Always connected.'),
        'panel',
      );
    case 'r_tsw':
      return g(
        tr('24시간 타임 스위치(다이얼식)입니다. 다이얼이 하루에 한 바퀴 돌면서, 정해 둔 시간 동안만 접점을 붙입니다. 전등 · 간판 · 환풍기를 매일 같은 시각에 켜고 끌 때 씁니다.', 'A 24-hour dial time switch: the dial turns once a day and closes its contact during the set periods.'),
        [
          ['L · N', tr('시계 전원. 늘 전압이 있어야 다이얼이 돕니다 (차단기 아래에서 바로)', 'clock supply: must always be powered')],
          ['COM', tr('접점 공통: 켜고 끌 전원(L)을 넣는 곳', 'common: feed the switched supply here')],
          ['NO', tr('설정 시간 동안 COM 과 붙음 → 전등 쪽으로', 'closed to COM during the ON periods')],
          ['NC', tr('NO 의 반대 (꺼져 있는 시간에 붙음)', 'the opposite of NO')],
        ],
        [
          tr('L → 단자 L, N → 단자 N (시계 전원)', 'L to L and N to N (clock supply)'),
          tr('L 단자에서 COM 으로 짧은 선(점퍼)을 하나 잇습니다', 'Jumper from L to COM'),
          tr('NO → 전등 L, 전등 N → N', 'NO to the light, the other side of the light to N'),
          tr('전등이 많으면 NO 로 전자접촉기 코일(A1)만 켜고, 전등은 주접점으로 켭니다', 'For many lights let NO drive a contactor coil'),
        ],
        tr('켜지는 시간은 속성에서 정합니다(15분 단위). 시뮬레이션은 1초에 1시간씩 흐르고, 전원이 끊기면 시계가 멈춥니다.', 'Set the ON periods in the properties. The simulation runs at 1 hour per second; the dial stops without power.'),
        'tsw-light',
      );
    case 'r_light':
      return g(tr('전등입니다. L 과 N 사이에 전압이 걸리면 켜집니다.', 'A light: on when voltage is across L and N.'), [['L', tr('스위치 · 타임 스위치 · 전자접촉기를 거쳐 온 선', 'the switched live wire')], ['N', tr('중성선 N 에 바로', 'straight to neutral')]], [tr('스위치는 L 쪽에 넣습니다. N 은 끊지 않고 바로 잇습니다', 'Put the switch in the L wire; neutral goes straight through'), tr('전등 여러 개는 나란히(병렬로) 잇습니다', 'Several lights go in parallel')], AUTO(), 'tsw-light');
    case 'r_sw':
      return g(tr('벽 스위치(단로)입니다. 누를 때마다 켜짐 · 꺼짐이 바뀝니다.', 'A wall switch: toggles on each press.'), [['1 · 2', tr('켜면 서로 이어집니다', 'connected when on')]], [tr('L → 1, 2 → 전등 L, 전등 N → N', 'L to 1, 2 to the light, light to N')], CLICK());
    case 'r_sw3':
      return g(
        tr('3로 스위치입니다. 공통 0 이 1 또는 3 중 한쪽에 붙습니다. 두 개를 쓰면 계단 아래 · 위 두 곳에서 전등 하나를 켜고 끕니다.', 'A 3-way switch: common 0 connects to 1 or 3. Two of them control one light from two places.'),
        [
          ['0', tr('공통', 'common')],
          ['1 · 3', tr('누를 때마다 0 이 1 ↔ 3 으로 넘어갑니다', 'each press moves 0 between 1 and 3')],
        ],
        [tr('L → 첫째 스위치 0', 'L to the first switch 0'), tr('두 스위치의 1 끼리, 3 끼리 잇습니다', 'Join 1 to 1 and 3 to 3'), tr('둘째 스위치 0 → 전등 L, 전등 N → N', 'Second switch 0 to the light, light to N')],
        CLICK(),
        'stair',
      );

    case 'r_load1':
    case 'r_load3':
      return g(
        tr(
          '용량 (kW) 과 역률로 전류를 계산하는 부하 상자입니다. 히터 · 컴프레서 · 생산 라인처럼 기기 하나, 또는 아래쪽 분전반 전체를 한 덩어리로 나타낼 때 씁니다.',
          'A load box whose current is computed from its kW and power factor: one machine, or a whole downstream panel lumped together.',
        ),
        type === 'r_load3'
          ? [['L1 · L2 · L3', tr('3상 전원 (차단기 아래에서)', '3-phase supply from the breaker')]]
          : [
              ['L', tr('차단기를 거친 상 (L1 · L2 · L3 중 하나)', 'a phase through the breaker')],
              ['N', tr('중성선', 'neutral')],
            ],
        [
          tr('차단기 아래 단자에서 부하 단자로 잇고, 그 전선을 눌러 케이블 규격 (굵기 · 공사방법 · 길이) 을 정합니다', 'Wire from the breaker and give that wire a cable spec'),
          tr('속성에서 용량 (kW) 과 역률을 적습니다. 조명이면 [조명 부하] 를 체크합니다 (전압강하 허용값 3%)', 'Enter kW and power factor; tick lighting for the stricter drop limit'),
          tr('[해석] 탭에서 전류 · 허용전류 · 전압강하 · 차단기 정격을 봅니다', 'Open the Analysis tab'),
        ],
        tr('전압이 들어오면 상자에 전류 (A) 와 단자 전압 (V) 이 나옵니다. 전선 위에 마우스를 올리면 그 선의 전류가 클램프 미터처럼 보입니다.', 'When powered the box shows its current and voltage; hover a wire to read its current like a clamp meter.'),
        'feeders',
      );
    case 'r_bus':
      return g(
        tr(
          '부스바입니다. 분전반 가운데에 세로로 서는 구리 막대 (L1 · L2 · L3 · N) 로, 메인 차단기에서 받은 전원을 분기 차단기들에 나눠 줍니다.',
          'A busbar: the vertical copper bars (L1, L2, L3, N) in the middle of a panel that feed the branch breakers from the main breaker.',
        ),
        [
          [tr('위 끝 단자', 'top terminals'), tr('L1 · L2 · L3 · N: 메인 차단기 아래 단자에서', 'L1, L2, L3, N from the main breaker')],
          [tr('막대 어디든', 'anywhere on a bar'), tr('분기 선 끝을 막대에 대면 그 상에 이어집니다 (볼트 점이 찍힘). 그냥 지나가는 선은 이어지지 않습니다', 'a wire end on a bar connects to that phase (bolt dot); wires that only cross do not')],
        ],
        [
          tr('메인 차단기 아래 단자 → 부스바 위 끝 단자 (L1 L2 L3 N)', 'Main breaker outputs → the top terminals'),
          tr('분기 차단기는 옆으로 돌려 (R) 전원 쪽 단자가 부스바를 보게 놓고, 단자에서 각 상 막대까지 가로로 끌어 잇습니다', 'Turn branch breakers sideways (R) and drag from each terminal across to its bar'),
          tr('단상 (2P) 은 한 상 막대와 N 막대에 잇습니다', 'Single-phase (2P) breakers take one phase bar and the N bar'),
          tr('길이는 아래 끝 손잡이를 끌어 바꾸고, 단면적 · 정격 전류 (제조사 표 값) 는 속성에서 적습니다', 'Drag the bottom handle to change the length; enter section and rating in the properties'),
        ],
        tr('[해석] 탭에서 막대마다 흐르는 전류를 정격 전류와 비교하고, 메인 차단기 정격이 부스바 정격보다 크지 않은지 봅니다.', 'The Analysis tab compares each bar current with the rating and checks the main breaker against it.'),
        'busbar',
      );
    case 'r_panel':
      return g(
        tr(
          '분전반 · 변전함을 나타내는 테두리입니다. 다른 도면 번호를 적는 대신, 함을 상자로 나누어 한 그림에 놓고 그 사이를 급전선으로 이으면 전체가 함께 시뮬레이션됩니다.',
          'A frame that stands for a panel or switchboard. Keep several panels on one drawing and connect them with feeders so everything simulates together.',
        ),
        [[tr('단자 없음', 'no terminals'), tr('안에 차단기 · 부스바 · 부하를 놓습니다', 'place breakers, busbars and loads inside')]],
        [
          tr('이름표 줄을 잡고 끌면 안의 기기와 선이 함께 옮겨집니다. 크기는 속성의 가로 · 세로 칸 수로 바꿉니다', 'Drag the title bar to move it with its contents; resize in the properties'),
          tr('함과 함 사이의 선 (급전선) 에 케이블 규격과 길이를 주면 전압강하가 계산됩니다', 'Give the feeders between panels a cable spec and length'),
          tr('[해석] 탭에 함마다 부하 합계가 나옵니다', 'The Analysis tab totals the load per panel'),
        ],
        tr('그림을 묶어 보여 주는 테두리라 전기적으로는 아무 일도 하지 않습니다.', 'Only a frame; it does nothing electrically.'),
        'feeders',
      );

    // ───────────── 회로 기호 ─────────────
    case 'src':
      return g(
        tr('전원 한 극입니다. 위에 L(또는 +24V), 아래에 N(또는 0V)을 놓고 그 사이에 회로를 세로로 그립니다.', 'One supply pole. Put L (or +24V) at the top and N (or 0V) at the bottom and draw the rungs between them.'),
        [[tr('단자 1개', 'one terminal'), tr('극은 속성에서 고릅니다', 'choose the pole in the properties')]],
        [tr('두 극에서 가로로 긴 선(모선)을 긋고, 그 사이에 접점과 코일을 세로로 잇습니다', 'Draw two bus wires and connect contacts and coils between them')],
        tr('늘 전압이 나옵니다.', 'Always live.'),
        'self-hold',
      );
    case 'src3':
      return g(tr('3상 전원 L1 · L2 · L3 입니다. 전동기 주회로의 시작입니다.', '3-phase supply for the motor circuit.'), [['L1 · L2 · L3', tr('아래로 차단기 → MC 주접점 → THR → 전동기', 'down to breaker, contactor, overload, motor')]], [tr('세 선을 그대로 아래로 내려 잇습니다', 'Run the three wires straight down')], tr('늘 전압이 나옵니다.', 'Always live.'), 'self-hold');
    case 'fuse':
    case 'fuse3':
      return g(tr('퓨즈입니다. 선 중간에 직렬로 넣습니다.', 'A fuse, in series with the wire.'), [[tr('위 · 아래', 'top, bottom'), tr('늘 통합니다', 'always conducting')]], [tr('전원 바로 아래에 넣습니다', 'Place right after the supply')], tr('늘 통합니다 (끊어지는 것은 흉내 내지 않습니다).', 'Always conducts.'));
    case 'mcb':
    case 'mcb3':
      return g(tr('배선용 차단기입니다. 전원을 손으로 넣고 끊습니다.', 'A circuit breaker.'), [[tr('위 · 아래', 'top, bottom'), tr('위는 전원, 아래는 부하', 'supply on top, load below')]], [tr('전원 바로 아래에 직렬로 넣습니다', 'In series right after the supply')], tr('시뮬레이션에서 누르면 ON/OFF. 처음에는 ON 입니다.', 'Click to switch; starts ON.'), 'self-hold');
    case 'ol3':
      return g(
        tr('열동형 과부하 계전기(THR)의 주회로입니다. 접점은 같은 기호를 적은 a · b 접점 기호로 따로 그립니다.', 'The power part of a thermal overload relay; its contacts are drawn separately with the same tag.'),
        [[tr('3극', '3 poles'), tr('MC 주접점 아래 → 전동기 위', 'between contactor and motor')]],
        [tr('조작 회로에 b접점을 놓고 기호를 THR 과 똑같이 적으면 트립할 때 열립니다 (95-96)', 'An NC contact with the same tag opens on trip')],
        tr('시뮬레이션에서 누르면 트립 / 복귀.', 'Click to trip or reset.'),
        'self-hold',
      );
    case 'pb_no':
    case 'pb_nc':
      return g(tr('푸시버튼입니다. 누르는 동안만 바뀝니다. a접점은 기동, b접점은 정지에 씁니다.', 'A push button: NO for start, NC for stop.'), [[tr('위 · 아래', 'top, bottom'), tr('선 중간에 직렬로', 'in series')]], [tr('L → 정지(b) → 기동(a) → 코일 → N', 'L → stop (NC) → start (NO) → coil → N'), tr('기동 버튼과 나란히 코일의 a접점을 이으면 자기유지', 'A coil NO contact in parallel with start makes it hold')], tr('시뮬레이션에서 누르고 있는 동안 눌립니다.', 'Hold the mouse button to press it.'), 'self-hold');
    case 'sw_no':
    case 'sw_nc':
      return g(tr('셀렉터(유지형) 스위치입니다. 누를 때마다 켜짐 · 꺼짐이 바뀌고 그대로 있습니다.', 'A maintained switch: toggles on each click.'), [[tr('위 · 아래', 'top, bottom'), tr('선 중간에 직렬로', 'in series')]], [tr('자동/수동, 운전 선택처럼 계속 켜 두는 신호에 씁니다', 'For signals that stay on')], CLICK());
    case 'estop':
      return g(tr('비상정지 스위치입니다. 평소 닫혀 있다가 누르면 열려서 잠깁니다.', 'An emergency stop: normally closed, latches open.'), [[tr('위 · 아래', 'top, bottom'), tr('조작 회로 맨 앞에 직렬로', 'in series at the head of the control circuit')]], [tr('L 바로 다음에 넣어서, 누르면 뒤의 회로가 모두 꺼지게 합니다', 'Place right after L so it drops everything')], CLICK());
    case 'ls_no':
    case 'ls_nc':
      return g(
        tr('리밋 스위치(또는 리드 · 플로트 · 압력 · 온도 스위치, 2선식 근접 센서)입니다. 접점처럼 부하와 직렬로 잇습니다. 실린더 끝에 연결하면 실린더가 닿을 때 저절로 바뀝니다. 온도 스위치는 설정 온도에 닿으면 바뀝니다 (온도는 조작 순서의 [온도 →] 나 연결 부하로).', 'A limit switch (or reed, float, pressure or temperature switch, 2-wire proximity sensor) wired in series like a contact; linked to a cylinder end it operates by itself. A temperature switch changes at its set point (temperature from [Temp. →] steps or a linked load).'),
        [[tr('위 · 아래', 'top, bottom'), tr('선 중간에 직렬로', 'in series')]],
        [tr('속성에서 [실린더 연결]과 전진단/후진단을 고릅니다', 'Choose the cylinder and its end in the properties'), tr('연결하지 않으면 손으로 누르는 스위치입니다', 'Unlinked, you click it by hand')],
        tr('실린더에 연결하면 자동, 아니면 누를 때마다 바뀝니다.', 'Automatic when linked, otherwise click to toggle.'),
        'cylinder',
      );
    case 'no':
    case 'nc':
      return g(
        tr('접점입니다. 혼자 움직이지 않고, 기호가 같은 코일 · 타이머 · 스위치를 따라 움직입니다. a접점은 붙으면 닫히고, b접점은 붙으면 열립니다.', 'A contact: it follows the coil, timer or switch that has the same tag.'),
        [[tr('위 · 아래', 'top, bottom'), tr('선 중간에 직렬로', 'in series')]],
        [
          tr('기호를 코일과 똑같이 적습니다 (코일 X1 ↔ 접점 X1, 전자접촉기 MC1 ↔ 접점 MC1)', 'Give it exactly the tag of its coil'),
          tr('타이머 기호를 적으면 한시 접점, THR 기호를 적으면 트립 접점이 됩니다', 'With a timer tag it is a timed contact, with a THR tag a trip contact'),
          tr("단자 번호는 [실물 배선도 만들기] 가 쓸 실물 단자로 자동으로 붙습니다 (8핀 릴레이 a 8-6 · 1-3, b 8-5 · 1-4 / 각형 4c a 9-5 …, b 9-1 … / 전자접촉기 13-14 · 21-22 / 타이머 8-6 · 8-5, 순시 1-3 · 1-4). 같은 릴레이의 접점끼리 번호가 겹치지 않습니다", 'Terminal numbers follow the real terminals that "Make real wiring" will use (8-pin relay NO 8-6, 1-3, NC 8-5, 1-4; square 4c NO 9-5…, NC 9-1…; contactor 13-14, 21-22), so contacts of one relay never share a number'),
          tr('[속성] 의 단자 번호에 직접 적으면 (예: 1-3) 실물 배선도에서 그 단자에 물립니다. 기기에 없는 번호 · a/b 가 틀린 번호 · 겹친 번호는 [검사] 가 알리고 자동으로 정합니다. [자동 번호 고정] 은 지금 번호를 적어 두어 선을 바꿔도 움직이지 않게 합니다', 'Type a number in the properties (e.g. 1-3) to wire that contact to exactly that terminal; numbers that do not exist, have the wrong NO/NC or clash are flagged in Check and assigned automatically. "Pin automatic numbers" writes the current numbers down'),
        ],
        AUTO(),
        'self-hold',
      );
    case 'km3':
      return g(tr('전자접촉기의 주접점(3극)입니다. 기호가 같은 코일이 붙으면 닫혀서 전동기에 전원을 보냅니다.', 'The three main contacts of a contactor: close when the coil with the same tag is energised.'), [[tr('3극', '3 poles'), tr('차단기 아래 → 주접점 → THR → 전동기', 'breaker → contacts → overload → motor')]], [tr('기호를 코일과 똑같이 적습니다 (MC1)', 'Use the same tag as the coil')], AUTO(), 'self-hold');
    case 'coil':
      return g(
        tr('릴레이 · 전자접촉기의 코일입니다. 양 끝에 전압이 걸리면 기호가 같은 접점이 모두 바뀝니다.', 'A relay or contactor coil: when powered, every contact with its tag changes.'),
        [['A1 · A2', tr('한쪽은 접점들을 거쳐 L(+24V)에, 다른 쪽은 N(0V)에', 'one side through the contacts to L, the other to N')]],
        [tr('코일은 회로의 맨 아래(N 쪽)에 둡니다', 'Put the coil at the bottom, next to N'), tr('접점 기호(a · b · 주접점)에 같은 기호를 적으면 연동됩니다. 기호가 MC · KM 으로 시작하면 전자접촉기로 봅니다', 'Contacts with the same tag follow it')],
        AUTO(),
        'self-hold',
      );
    case 'timer':
      return g(
        tr('타이머 코일입니다. 전압이 걸리고 설정 시간이 지나면 기호가 같은 접점(한시 접점)이 바뀝니다.', 'A timer coil: after the preset time its contacts change.'),
        [['A1 · A2', tr('코일처럼 잇습니다', 'wired like a coil')]],
        [tr('설정 시간과 동작(ON 딜레이 · OFF 딜레이 · 인터벌 · 플리커)은 속성에서. 플리커는 켜짐 · 꺼짐 시간을 따로 넣을 수 있음', 'Preset and mode (on-delay, off-delay, interval, flicker) in the properties; flicker can have a separate off time'), tr('OFF 딜레이의 한시 b접점을 자기를 켜는 회로에 넣으면 매번 다시 시작합니다 (시뮬레이션이 0초 펄스로 알려 줌)', 'An off-delay timed NC in its own feed makes it restart every cycle (the simulation reports a 0-second pulse)'), tr('a · b 접점 기호에 타이머 기호(T1)를 적으면 한시 접점', 'Contacts tagged T1 are its timed contacts')],
        AUTO(),
        'timer',
      );
    case 'lamp':
    case 'buzzer':
      return g(tr('램프 · 부저입니다. 양 끝에 전압이 걸리면 켜집니다.', 'A lamp or buzzer: on when powered.'), [[tr('위 · 아래', 'top, bottom'), tr('한쪽은 신호에, 다른 쪽은 N(0V)에', 'signal on one side, N on the other')]], [tr('운전 표시는 a접점 뒤에, 정지 표시는 b접점 뒤에 둡니다', 'Run lamp after NO, stop lamp after NC')], AUTO(), 'self-hold');
    case 'motor3':
      return g(tr('3상 전동기입니다. 세 상이 모두 닿으면 돌고, 상 순서로 정 · 역이 정해집니다.', 'A 3-phase motor.'), [['U · V · W', tr('THR 아래에서', 'from the overload relay')]], [tr('L1→U, L2→V, L3→W 는 정회전. 두 상을 바꾸면 역회전', 'Swap two phases to reverse')], AUTO(), 'reversing');
    case 'motor':
      return g(tr('전동기(단상 · 직류)입니다. 양 끝에 전압이 걸리면 돕니다. 직류는 극을 바꾸면 역회전합니다.', 'A single-phase or DC motor.'), [[tr('위 · 아래', 'top, bottom'), tr('두 극 사이에', 'between two poles')]], [tr('접점이나 MC 를 거쳐 전원에 잇습니다', 'Wire through a contact to the supply')], AUTO());
    case 'load':
      return g(tr('부하 (히터 · 팬 등) 입니다. 두 단자 사이에 전압이 걸리면 동작합니다. 용량은 속성의 [해석] 값으로 적습니다.', 'A load (heater, fan …): on when powered. Enter its rating for the analysis.'), [[tr('위 · 아래', 'top, bottom'), tr('한쪽은 접점 뒤에, 다른 쪽은 N 에', 'one side after the contact, the other to N')]], [tr('자주 켜고 끄는 히터는 SSR 로 개폐합니다', 'Switch heaters that cycle often with an SSR')], AUTO(), 'ssr-heater');
    case 'sol':
      return g(
        tr('솔레노이드(밸브 코일)입니다. 전압이 걸리면 밸브가 넘어가 실린더가 움직입니다.', 'A solenoid: when powered the valve shifts and the cylinder moves.'),
        [[tr('위 · 아래', 'top, bottom'), tr('코일처럼 잇습니다', 'wired like a coil')]],
        [tr('밸브나 실린더의 속성에서 이 솔레노이드 기호(SOL1)를 고르면 연결됩니다', 'Pick this solenoid in the valve or cylinder properties')],
        AUTO(),
        'cylinder',
      );
    case 'cyl':
      return g(
        tr('공압 실린더입니다. 배관을 이으면 공기 압력으로, 배관이 없으면 속성에서 고른 솔레노이드로 움직입니다.', 'A pneumatic cylinder: moved by air through tubes, or by the solenoids chosen in its properties.'),
        [[tr('포트 2개 (헤드 · 로드)', 'two ports'), tr('헤드 쪽에 압력 → 전진, 로드 쪽에 압력 → 후진', 'pressure on the cap side extends it')]],
        [tr('간단히: 속성에서 전진 SOL(과 후진 SOL)을 고릅니다', 'Simple: choose the advance (and return) solenoid'), tr('배관으로: 밸브의 4 → 헤드, 2 → 로드 포트로 잇습니다', 'With tubes: valve 4 to the cap port, 2 to the rod port'), tr('끝 센서는 리밋 스위치 · 근접 센서의 속성에서 이 실린더를 고릅니다', 'End sensors: pick this cylinder in the sensor properties')],
        AUTO(),
        'pneumatic',
      );
    case 'plc':
      return g(
        tr('PLC 입니다. PLC 시뮬레이션 탭의 프로그램이 스캔마다 돌면서 입력을 읽고 출력 접점을 붙입니다.', 'A PLC: runs the program from the PLC tab every scan.'),
        [
          [tr('입력 (위 8개)', 'inputs (top)'), tr('단자에 +24V 가 닿으면 ON', 'ON when +24V reaches the terminal')],
          ['C', tr('출력 공통: +24V 를 줍니다', 'output common: feed +24V')],
          [tr('출력 (아래 8개)', 'outputs (bottom)'), tr('프로그램이 켜면 C 와 이어집니다 → 램프 · 코일로', 'connected to C when on')],
        ],
        [tr('+24V → 버튼 → 입력 단자', '+24V → button → input'), tr('+24V → C, 출력 단자 → 램프(코일) → 0V', '+24V → C, output → lamp → 0V'), tr('프로그램은 PLC 시뮬레이션 탭에서 고칩니다', 'Edit the program in the PLC tab')],
        AUTO(),
        'plc',
      );
    case 'prox':
      return g(
        tr('3선식 근접 · 광전 센서입니다. 전원이 있어야 동작하고, 감지하면 검정선(출력)에 전압이 나옵니다.', 'A 3-wire proximity or photo sensor: needs power, switches its black output wire.'),
        [
          [tr('갈색', 'brown'), '+24V'],
          [tr('파랑', 'blue'), '0V'],
          [tr('검정', 'black'), tr('출력: PNP 는 감지하면 +24V, NPN 은 0V', 'output: +24V when detecting (PNP), 0V (NPN)')],
        ],
        [tr('갈색 → +24V, 파랑 → 0V, 검정 → 릴레이 코일이나 PLC 입력', 'Brown to +24V, blue to 0V, black to a coil or PLC input'), tr('실린더 끝에 연결하면 실린더가 닿을 때 감지합니다 (속성)', 'Link it to a cylinder end in the properties')],
        tr('실린더에 연결하면 자동, 아니면 누를 때마다 감지 / 해제.', 'Automatic when linked, otherwise click to toggle.'),
        'pneumatic',
      );
    case 'smps':
      return g(tr('SMPS(직류 전원 공급기)입니다. AC 220V 를 받아 DC 24V 를 만듭니다.', 'A switching power supply: AC 220V in, DC 24V out.'), [['L · N', tr('입력 AC 220V', 'AC input')], ['+V · −V', tr('출력 +24V · 0V', 'DC output')]], [tr('L · N 에 전원이 들어와야 +V · −V 에 전압이 나옵니다', 'The output is live only while L and N are powered')], AUTO(), 'pneumatic');
    case 'air':
      return g(tr('공압원(컴프레서)입니다. 배관의 시작입니다.', 'The air supply.'), [[tr('포트 1개', 'one port'), tr('FRL 을 거쳐 밸브의 1번 포트로', 'through the FRL to valve port 1')]], [tr('배관도 전선처럼 포트에서 포트로 끌어서 잇습니다', 'Draw tubes like wires, port to port')], tr('늘 압력이 나옵니다.', 'Always pressurised.'), 'pneumatic');
    case 'frl':
      return g(tr('에어 서비스 유닛(FRL: 필터 · 레귤레이터)입니다. 공압원과 밸브 사이에 넣습니다.', 'An air service unit between supply and valve.'), [[tr('입구 · 출구', 'in, out'), tr('늘 통합니다', 'always open')]], [tr('공압원 → FRL → 밸브 1번 포트', 'Supply → FRL → valve port 1')], tr('늘 통합니다.', 'Always open.'), 'pneumatic');
    case 'fc':
      return g(tr('속도 제어 밸브입니다. 실린더에서 빠져나가는 공기를 조여서 그 방향의 속도를 늦춥니다 (미터 아웃).', 'A flow control valve: throttles exhaust air to slow that stroke (meter-out).'), [[tr('포트 2개', 'two ports'), tr('밸브와 실린더 포트 사이에', 'between valve and cylinder port')]], [tr('전진을 늦추려면 로드 쪽 배관에, 후진을 늦추려면 헤드 쪽 배관에 넣습니다', 'On the rod side to slow extension, on the cap side to slow return'), tr('빠르기(%)는 속성에서', 'Set the speed in the properties')], tr('늘 통하고, 속도만 늦춥니다.', 'Always open; only slows.'), 'pneumatic');
    case 'v32':
    case 'v52':
    case 'v52d':
    case 'v53':
      return g(
        tr('솔레노이드 밸브입니다. 솔레노이드에 전압이 걸리면 공기 길이 바뀌어 실린더가 움직입니다. 편솔은 꺼지면 스프링으로 돌아오고, 양솔은 마지막 위치를 지킵니다.', 'A solenoid valve: the solenoid changes the air path. Single-solenoid valves spring back, double-solenoid valves keep their position.'),
        [
          ['1', tr('공급: FRL 에서', 'supply from the FRL')],
          ['4 · 2', tr('실린더 헤드 쪽 · 로드 쪽으로 (3/2 밸브는 2 하나)', 'to the cylinder cap and rod ports')],
        ],
        [tr('배관: 공압원 → FRL → 1, 4 → 실린더 헤드, 2 → 로드', 'Tubes: supply → FRL → 1, 4 → cap, 2 → rod'), tr('전기: 솔레노이드 기호(SOL)를 회로에 그리고, 밸브 속성에서 그 기호를 고릅니다', 'Electrics: draw a solenoid in the circuit and choose its tag in the valve properties')],
        AUTO() + ' ' + tr('밸브 그림의 칸이 솔레노이드 쪽으로 밀립니다.', 'The valve boxes shift toward the energised solenoid.'),
        'pneumatic',
      );
    case 'text':
      return null;
  }
  return null;
}
