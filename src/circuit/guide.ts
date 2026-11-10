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
        tr('전원이 들어오는 단자입니다. 회로는 여기서 시작합니다. 극(L1 · L2 · L3 · N · PE · +24V · 0V)은 속성에서 고릅니다.', 'Where the supply comes in. Choose its pole (L1, L2, L3, N, PE, +24V, 0V) in the properties.'),
        [
          ['L1 · L2 · L3', tr('3상 전원의 세 상 (전동기)', 'the three phases')],
          ['L (L1) · N', tr('단상 220V: L 과 N 사이에 부하를 둡니다', 'single phase: put the load between L and N')],
          ['+24V · 0V', tr('직류 제어 전원', 'DC control supply')],
          ['PE', tr('접지 (전동기 몸체 등). L 과 닿으면 지락', 'earth; touching L is a fault')],
        ],
        [tr('전원 단자를 맨 위에 놓고, 바로 아래에 차단기를 둡니다', 'Put the supply terminals at the top and a breaker right below'), tr('부하(램프 · 코일 · 전동기)는 서로 다른 극 사이에 있어야 동작합니다 (L↔N, +24V↔0V, L1↔L2↔L3)', 'A load works only between two different poles of the same system')],
        tr('늘 전압이 나옵니다.', 'Always live.'),
        'real',
      );
    case 'r_mcb1':
    case 'r_mcb2':
    case 'r_mcb3':
      return g(
        tr('배선용 차단기입니다. 전원을 손으로 넣고 끊는 곳이고, 실제로는 과전류가 흐르면 스스로 떨어집니다.', 'A circuit breaker: the manual on/off point of the circuit.'),
        [
          [tr('위 단자 (1 · 3 · 5)', 'top (1, 3, 5)'), tr('전원 쪽: 전원 단자에서 내려오는 선', 'supply side')],
          [tr('아래 단자 (2 · 4 · 6)', 'bottom (2, 4, 6)'), tr('부하 쪽: 전자접촉기 · 조작 회로로 가는 선', 'load side')],
        ],
        [tr('위에는 전원(L1 L2 L3 또는 L N)을, 아래에는 부하 쪽 선을 잇습니다. 같은 줄의 위 · 아래가 한 극입니다', 'Supply on top, load below; each column is one pole'), tr('주회로용(3P)과 조작 회로용(2P 또는 1P)을 따로 두는 것이 보통입니다', 'Usually one breaker for the power circuit and one for the control circuit')],
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
        tr('8핀 릴레이(소켓에 꽂아 씀)입니다. 코일에 전압이 걸리면 접점 두 벌이 넘어갑니다. 버튼 신호를 기억(자기유지)하거나 접점 수를 늘릴 때 씁니다.', 'An 8-pin plug-in relay: powering the coil switches two changeover contacts.'),
        [
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
    case 'r_timer8':
      return g(
        tr('8핀 타이머입니다. 전원(2-7)이 들어오고 설정 시간이 지나면 한시 접점이 넘어갑니다 (ON 딜레이). "기동하고 3초 뒤에" 같은 동작에 씁니다.', 'An 8-pin timer: after power is applied for the preset time its timed contacts switch (on-delay).'),
        [
          ['2 – 7', tr('전원 (이 사이에 전압이 걸려 있는 동안 시간을 잽니다)', 'power: times while energised')],
          ['8 – 6 / 8 – 5', tr('한시 a접점 (시간이 지나면 닫힘) / 한시 b접점 (시간이 지나면 열림)', 'timed NO / timed NC')],
          ['1 – 3 / 1 – 4', tr('한시 접점 한 벌 더. 속성에서 순시(전원이 들어오면 바로)로 바꿀 수 있습니다', 'second timed pair, or instantaneous if chosen')],
        ],
        [tr('7 은 N 에, 2 는 타이머를 돌리고 싶은 신호(예: 릴레이 a접점 뒤)에', '7 to N, 2 to the signal that should start timing'), tr('시간이 지난 뒤 켤 것은 a접점(8-6)에, 그동안만 켤 것은 b접점(8-5)에 잇습니다', 'What turns on after the delay goes on the NO contact; what is on meanwhile goes on the NC')],
        AUTO() + ' ' + tr('다이얼에 지난 시간이 차오르고, 시간이 되면 UP 램프가 켜집니다. 설정 시간과 동작(ON/OFF 딜레이 · 플리커)은 속성에서 바꿉니다.', 'The dial fills as time passes; change preset and mode in the properties.'),
        'panel',
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
        tr('리밋 스위치(또는 리드 · 플로트 · 압력 스위치)입니다. 실린더 끝에 연결하면 실린더가 닿을 때 저절로 바뀝니다.', 'A limit switch; linked to a cylinder end it operates by itself.'),
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
        [tr('기호를 코일과 똑같이 적습니다 (코일 X1 ↔ 접점 X1, 전자접촉기 MC1 ↔ 접점 MC1)', 'Give it exactly the tag of its coil'), tr('타이머 기호를 적으면 한시 접점, THR 기호를 적으면 트립 접점이 됩니다', 'With a timer tag it is a timed contact, with a THR tag a trip contact')],
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
        [tr('설정 시간과 동작(ON 딜레이 · OFF 딜레이 · 플리커)은 속성에서', 'Preset and mode in the properties'), tr('a · b 접점 기호에 타이머 기호(T1)를 적으면 한시 접점', 'Contacts tagged T1 are its timed contacts')],
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
