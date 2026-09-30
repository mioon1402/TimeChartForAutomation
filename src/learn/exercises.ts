/**
 * 연습 문제: 문제를 읽고 타임차트를 직접 그린 뒤 채점한다.
 *  - PLC 읽기: 짧은 PLC 프로그램과 입력 파형이 주어지면 출력 파형을 그린다 (정답 = 내장 시뮬레이터 결과)
 *  - 설비 동작: 말로 설명한 설비 동작을 보고 솔레노이드·센서 파형을 그린다 (정답 = 작성 도우미 모델)
 */
import type { Project, Signal } from '../model/types';
import { createProject } from '../model/project';
import { buildProject, computeTimeline, actionText, newAction, newDevice, type SeqSpec, type SeqDevice } from '../model/sequence';
import { parseProgram } from '../plc/program';
import { applySimulation, runSimulation } from '../plc/simulator';
import { defaultSimSettings, type Stimulus } from '../plc/types';
import { sigKey } from './grade';

export type ExerciseKind = 'plc' | 'machine';

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  /** 1 기초, 2 중급, 3 응용 */
  level: 1 | 2 | 3;
  title: string;
  /** 이 문제로 배우는 것 */
  goal: string;
  /** 문제 설명 (상황, 주어진 것, 그릴 것) */
  problem: string;
  /** PLC 문제: 보여 줄 프로그램 (미쓰비시 니모닉) */
  program?: string;
  /** PLC 문제: 래더 그림 (글자로) */
  ladder?: string;
  hints: string[];
  /** 해설 */
  explanation: string;
  build(): Built;
}

export interface Built {
  answer: Project;
  /** 사용자가 그려야 할 신호 (주소 또는 이름) */
  draw: string[];
}

export function levelName(l: 1 | 2 | 3): string {
  return l === 1 ? '기초' : l === 2 ? '중급' : '응용';
}

// ───────────────────────── 만들기 도우미 ─────────────────────────

const pulse = (device: string, ...ranges: [number, number][]): Stimulus => ({ device, mode: 'pulse', pulses: ranges.map(([start, end]) => ({ start, end })) });

function plcAnswer(title: string, source: string, comments: Record<string, string>, stimuli: Stimulus[], watch: string[], draw: string[], duration: number): Built {
  const prog = parseProgram(source, 'mitsubishi', new Map(Object.entries(comments)));
  const sim = { ...defaultSimSettings(), duration, scanTime: 10, timerBase: 100, stimuli, watch, autoTrim: false, stepDevice: '' };
  const res = runSimulation(prog, sim);
  const p = applySimulation(createProject(), prog, sim, res, { keepExisting: false });
  p.meta = { ...p.meta, title, description: '' };
  p.settings = { ...p.settings, duration, grid: 100, timeUnit: 's' };
  p.plc = { dialect: 'mitsubishi', source, comments: Object.entries(comments).map(([k, v]) => `${k}\t${v}`).join('\n'), sim };
  return { answer: p, draw };
}

function machineAnswer(spec: SeqSpec): Built {
  const p = buildProject(spec);
  p.settings = { ...p.settings, grid: 100, timeUnit: 's' };
  const draw = p.signals.filter((s) => s.role === 'output' || s.role === 'sensor' || s.role === 'timer').map(sigKey);
  return { answer: p, draw };
}

function spec(devices: SeqDevice[], actions: SeqSpec['actions'], title: string): SeqSpec {
  return { title, machine: '', drawingNo: '', author: '', targetCycle: 0, startButton: true, devices, addrStyle: 'mitsubishi', ioEdits: {}, actions };
}

const sec = (t: number) => `${Math.round(t / 10) / 100}초`;

/** 설비 문제 해설 뒷부분: 시간 순서대로 무엇이 일어나는지 */
export function timelineText(s: SeqSpec): string {
  const tl = computeTimeline(s);
  return tl.groups
    .map((g, i) => `S${(i + 1) * 10} (${sec(g.start)} ~ ${sec(g.end)}): ${g.items.map((it) => actionText(it.action, s.devices)).join(' + ')}`)
    .join('\n');
}

/** 정답 차트 → 연습용 차트: 그려야 할 신호는 비우고, 공정 스텝·화살표·실린더 동작선은 숨긴다 */
export function practiceProject(b: Built, ex: Exercise): Project {
  const given = new Set(b.answer.signals.filter((s) => s.role === 'input').map(sigKey));
  const signals: Signal[] = b.answer.signals
    .filter((s) => b.draw.includes(sigKey(s)) || given.has(sigKey(s)))
    .map((s) =>
      b.draw.includes(sigKey(s))
        ? { ...s, points: [{ t: 0, v: 0 }], group: '② 그려야 할 신호', defaultRamp: undefined }
        : { ...s, group: '① 주어진 입력 (그대로 두세요)' },
    );
  return {
    ...createProject(),
    meta: { ...b.answer.meta, title: `연습: ${ex.title}`, description: ex.goal },
    settings: { ...b.answer.settings },
    signals,
  };
}

// ───────────────────────── PLC 읽기 문제 ─────────────────────────

const plcExercises: Exercise[] = [
  {
    id: 'plc-selfhold',
    kind: 'plc',
    level: 1,
    title: '자기유지 회로',
    goal: '버튼에서 손을 떼도 출력이 계속 켜져 있는 "자기유지"와, 정지 버튼을 B접점으로 쓰는 이유를 익힙니다.',
    problem:
      '운전 램프 Y0 을 시작 버튼 X0 으로 켜고 정지 버튼 X1 으로 끄는 가장 기본적인 회로입니다.\n\n' +
      '주어진 입력:\n· X0 시작 버튼: 0.5~0.8초, 3.0~3.2초에 누름\n· X1 정지 버튼: 2.0~2.3초에 누름\n\n' +
      '그릴 것: Y0 운전 램프가 언제 켜지고 꺼지는지 그리세요. (0~4초)',
    ladder: '  X0      X1\n--| |--+--|/|------( Y0 )\n  Y0   |\n--| |--+',
    program: 'LD  X0     ; 시작 버튼\nOR  Y0     ; 자기유지\nANI X1     ; 정지 버튼 (B접점)\nOUT Y0     ; 운전 램프\nEND',
    hints: [
      'X0 을 누르는 순간 Y0 이 켜집니다.',
      'X0 에서 손을 떼도 Y0 은 자기 자신(OR Y0)으로 이어져 있어서 계속 켜져 있습니다. 이것이 자기유지입니다.',
      'X1 을 누르면 ANI X1(B접점)이 끊어져 Y0 이 꺼집니다. 그 뒤 X1 을 떼도 X0 을 다시 누르기 전까지는 꺼져 있습니다.',
    ],
    explanation:
      '① 0.5초: X0 이 켜지면 "X0 또는 Y0" 이 참이 되고, X1 은 눌리지 않았으므로 Y0 이 켜집니다.\n' +
      '② 0.8초: X0 에서 손을 떼도 OR 로 연결된 Y0 자기 접점이 켜져 있으므로 Y0 은 계속 켜집니다(자기유지).\n' +
      '③ 2.0초: X1 을 누르면 ANI X1 이 끊어져 Y0 이 꺼집니다. 자기유지도 함께 풀립니다.\n' +
      '④ 2.3초: X1 에서 손을 떼도 X0 도 Y0 도 꺼져 있으므로 Y0 은 꺼진 채로 있습니다.\n' +
      '⑤ 3.0초: X0 을 다시 누르면 다시 켜지고, 끝까지 유지됩니다.\n\n' +
      '정답: Y0 은 0.5~2.0초, 3.0초~끝까지 ON.\n\n' +
      '실무 메모: 정지 버튼은 보통 B접점(평상시 닫힘) 버튼을 씁니다. 전선이 끊어져도 "정지"로 판단되게 하려는 안전 설계입니다. 그때 프로그램에서는 LD/AND(A접점)로 읽습니다. 이 문제에서는 A접점 버튼을 ANI 로 읽는 형태로 단순화했습니다.',
    build: () =>
      plcAnswer('자기유지 회로', 'LD X0\nOR Y0\nANI X1\nOUT Y0\nEND', { X0: '시작 버튼', X1: '정지 버튼', Y0: '운전 램프' }, [pulse('X0', [500, 800], [3000, 3200]), pulse('X1', [2000, 2300])], ['X0', 'X1', 'Y0'], ['Y0'], 4000),
  },
  {
    id: 'plc-ton',
    kind: 'plc',
    level: 1,
    title: 'ON 딜레이 타이머',
    goal: '타이머는 입력이 계속 켜져 있는 동안만 시간을 세고, 중간에 꺼지면 처음부터 다시 센다는 것을 익힙니다.',
    problem:
      '센서 X0 이 2초 이상 계속 켜져 있으면 경보 Y0 을 켜는 회로입니다. 타이머 T0 의 설정값 K20 은 20 × 0.1초 = 2초입니다.\n\n' +
      '주어진 입력:\n· X0 센서: 0.5~3.5초(3초 동안), 4.0~5.0초(1초 동안) 켜짐\n\n' +
      '그릴 것: Y0 경보. (0~6초)',
    ladder: '  X0\n--| |-------------( T0 K20 )\n  T0\n--| |-------------( Y0 )',
    program: 'LD  X0\nOUT T0 K20   ; 2초 타이머\nLD  T0\nOUT Y0       ; 경보\nEND',
    hints: ['타이머는 X0 이 켜진 순간부터 2초를 셉니다. 첫 번째는 언제 2초가 되나요?', 'X0 이 꺼지면 타이머는 0 으로 돌아가고, 타이머 접점 T0 도 꺼집니다.', '두 번째로 켜진 시간은 1초뿐입니다. 2초가 되지 않으면 어떻게 될까요?'],
    explanation:
      '① 0.5초에 X0 이 켜지면 T0 이 시간을 세기 시작합니다.\n② 2초 뒤인 2.5초에 T0 이 다 세고 T0 접점이 켜져 Y0 이 켜집니다.\n' +
      '③ 3.5초에 X0 이 꺼지면 타이머가 0 으로 돌아가고 T0, Y0 이 함께 꺼집니다.\n' +
      '④ 4.0~5.0초는 1초뿐이라 2초에 이르지 못하므로 Y0 은 켜지지 않습니다.\n\n정답: Y0 은 2.5~3.5초만 ON.\n\n' +
      '실무 메모: 이런 타이머는 "센서가 잠깐 흔들린 것(채터링)은 무시하고 확실히 켜졌을 때만 반응"하게 할 때, 또는 "문이 2초 이상 열려 있으면 경보"처럼 지속 시간을 볼 때 씁니다.',
    build: () => plcAnswer('ON 딜레이 타이머', 'LD X0\nOUT T0 K20\nLD T0\nOUT Y0\nEND', { X0: '센서', Y0: '경보' }, [pulse('X0', [500, 3500], [4000, 5000])], ['X0', 'Y0'], ['Y0'], 6000),
  },
  {
    id: 'plc-toggle',
    kind: 'plc',
    level: 2,
    title: '버튼 한 개로 켜고 끄기 (펄스)',
    goal: 'PLS(상승 펄스)가 버튼을 누른 순간 한 스캔만 켜진다는 것과, 이를 이용해 누를 때마다 켜짐·꺼짐이 바뀌는 회로를 익힙니다.',
    problem:
      '버튼 X0 을 한 번 누르면 조명 Y0 이 켜지고, 다시 누르면 꺼지는 회로입니다. M0 은 X0 을 누른 순간 한 스캔(0.01초)만 켜지는 펄스입니다.\n\n' +
      '주어진 입력:\n· X0 버튼: 0.5~0.8초, 1.8~2.1초, 3.1~3.4초에 누름\n\n그릴 것: Y0 조명. (0~4초)',
    ladder: '  X0\n--| |-------------[ PLS M0 ]\n  M0    Y0\n--| |---|/|---+---( Y0 )\n  Y0    M0    |\n--| |---|/|---+',
    program: 'LD  X0\nPLS M0      ; 누른 순간 한 스캔\nLD  M0\nANI Y0      ; 꺼져 있으면 켜기\nLD  Y0\nANI M0      ; 켜져 있으면 유지 (펄스 때는 끊김)\nORB\nOUT Y0\nEND',
    hints: ['M0 은 누른 순간에만 아주 짧게 켜집니다. 버튼을 오래 눌러도 한 번뿐입니다.', 'Y0 이 꺼져 있을 때 M0 이 오면 → 켜짐. Y0 이 켜져 있을 때 M0 이 오면 → 자기유지가 끊겨 꺼짐.', '버튼을 뗄 때는 아무 일도 없습니다. 누를 때마다 상태가 바뀝니다.'],
    explanation:
      '① 0.5초: X0 을 누른 순간 M0 이 한 스캔 켜집니다. Y0 이 꺼져 있으므로 "M0 AND NOT Y0" 가 참 → Y0 켜짐.\n' +
      '② 다음 스캔부터 M0 은 꺼지고, "Y0 AND NOT M0" 로 Y0 이 유지됩니다. 버튼을 떼는 0.8초에는 변화가 없습니다.\n' +
      '③ 1.8초: 다시 누르면 M0 이 켜지는 그 스캔에 "Y0 AND NOT M0" 이 끊기고 "M0 AND NOT Y0" 도 거짓 → Y0 꺼짐.\n④ 3.1초: 다시 누르면 다시 켜져 끝까지 유지됩니다.\n\n' +
      '정답: Y0 은 0.5~1.8초, 3.1초~끝 ON.\n\n' +
      '실무 메모: PLS 대신 X0 을 그대로 쓰면 버튼을 누르고 있는 동안 스캔마다 켜짐·꺼짐이 바뀌어 결과가 운에 맡겨집니다. "한 번 누름 = 한 번 동작"이 필요할 때는 항상 펄스(PLS, LDP)를 씁니다. 미쓰비시는 ALTP 명령 하나로도 같은 동작을 만들 수 있습니다.',
    build: () =>
      plcAnswer('버튼 한 개로 켜고 끄기', 'LD X0\nPLS M0\nLD M0\nANI Y0\nLD Y0\nANI M0\nORB\nOUT Y0\nEND', { X0: '버튼', M0: '누름 펄스', Y0: '조명' }, [pulse('X0', [500, 800], [1800, 2100], [3100, 3400])], ['X0', 'Y0'], ['Y0'], 4000),
  },
  {
    id: 'plc-interlock',
    kind: 'plc',
    level: 2,
    title: '정·역회전 인터록',
    goal: '동시에 켜지면 안 되는 두 출력을 서로의 B접점으로 막는 "인터록"을 익힙니다.',
    problem:
      '컨베이어 모터를 정회전 Y0, 역회전 Y1 으로 돌립니다. 둘이 동시에 켜지면 전원이 단락되므로 서로 막아야 합니다. 각 버튼은 자기유지되고, X2 정지 버튼은 둘 다 멈춥니다.\n\n' +
      '주어진 입력:\n· X0 정회전 버튼: 0.5~0.7초\n· X1 역회전 버튼: 1.5~1.7초, 3.2~3.4초\n· X2 정지 버튼: 2.5~2.7초\n\n그릴 것: Y0 정회전, Y1 역회전. (0~5초)',
    ladder: '  X0      X2     Y1\n--| |--+--|/|----|/|----( Y0 )\n  Y0   |\n--| |--+\n  X1      X2     Y0\n--| |--+--|/|----|/|----( Y1 )\n  Y1   |\n--| |--+',
    program: 'LD  X0     ; 정회전 버튼\nOR  Y0\nANI X2     ; 정지\nANI Y1     ; 인터록: 역회전 중이면 안 됨\nOUT Y0\nLD  X1     ; 역회전 버튼\nOR  Y1\nANI X2\nANI Y0     ; 인터록: 정회전 중이면 안 됨\nOUT Y1\nEND',
    hints: ['1.5초에 역회전 버튼을 누를 때 정회전(Y0)이 이미 돌고 있습니다. Y1 회로의 ANI Y0 은 어떤 상태인가요?', '정지 버튼은 두 회로 모두의 자기유지를 끊습니다.', '정지 뒤에는 Y0 이 꺼져 있으니 역회전 버튼이 먹힙니다.'],
    explanation:
      '① 0.5초: X0 → Y0 켜짐(자기유지).\n② 1.5초: X1 을 눌러도 Y1 회로의 "ANI Y0" 이 끊겨 있어(Y0 이 켜져 있으므로) Y1 은 켜지지 않습니다. 이것이 인터록입니다.\n' +
      '③ 2.5초: X2 정지 → Y0 꺼짐.\n④ 3.2초: 이제 Y0 이 꺼져 있으므로 X1 → Y1 켜짐, 끝까지 유지.\n\n정답: Y0 0.5~2.5초, Y1 3.2초~끝. 두 출력이 겹치는 곳은 없습니다.\n\n' +
      '실무 메모: 실제 설비에서는 프로그램 인터록에 더해 전자접촉기(MC)끼리도 B접점으로 서로 막는 "하드웨어 인터록"을 함께 둡니다. 타임차트 검토 때는 "동시 ON 금지" 규칙으로 두 출력이 겹치지 않는지 확인합니다.',
    build: () =>
      plcAnswer(
        '정·역회전 인터록',
        'LD X0\nOR Y0\nANI X2\nANI Y1\nOUT Y0\nLD X1\nOR Y1\nANI X2\nANI Y0\nOUT Y1\nEND',
        { X0: '정회전 버튼', X1: '역회전 버튼', X2: '정지 버튼', Y0: '정회전', Y1: '역회전' },
        [pulse('X0', [500, 700]), pulse('X1', [1500, 1700], [3200, 3400]), pulse('X2', [2500, 2700])],
        ['X0', 'X1', 'X2', 'Y0', 'Y1'],
        ['Y0', 'Y1'],
        5000,
      ),
  },
  {
    id: 'plc-counter',
    kind: 'plc',
    level: 2,
    title: '카운터: 3개 모이면 알림',
    goal: '카운터가 입력이 켜질 때마다 하나씩 세고, 설정값에 이르면 접점이 켜지며, 리셋해야 0 으로 돌아간다는 것을 익힙니다.',
    problem:
      '제품 감지 센서 X0 이 켜질 때마다 개수를 세어 3개가 되면 배출 알림 Y0 을 켭니다. X1 리셋 버튼으로 개수를 0 으로 되돌립니다. C0 의 설정값 K3 은 3개입니다.\n\n' +
      '주어진 입력:\n· X0 제품 감지: 0.5~0.7초, 1.2~1.4초, 1.9~2.1초, 3.6~3.8초\n· X1 리셋: 3.0~3.2초\n\n그릴 것: Y0 배출 알림. (0~4.5초)',
    ladder: '  X0\n--| |-------------( C0 K3 )\n  C0\n--| |-------------( Y0 )\n  X1\n--| |-------------[ RST C0 ]',
    program: 'LD  X0\nOUT C0 K3    ; 3개 세기\nLD  C0\nOUT Y0       ; 배출 알림\nLD  X1\nRST C0       ; 개수 리셋\nEND',
    hints: ['카운터는 X0 이 꺼짐 → 켜짐으로 바뀔 때 하나씩 셉니다. 세 번째로 켜지는 시각은?', '3개가 된 뒤에는 X0 이 꺼져도 C0 은 켜진 채로 있습니다.', '리셋 뒤 한 번 더 감지되면 개수는 1 입니다. 3 이 될까요?'],
    explanation:
      '① 0.5초 → 1개, 1.2초 → 2개, 1.9초 → 3개. 3개가 되는 순간 C0 접점이 켜져 Y0 이 켜집니다.\n② 카운터는 X0 이 꺼져도 값을 기억하므로 Y0 은 계속 켜져 있습니다.\n' +
      '③ 3.0초: X1 리셋 → 개수 0, C0 꺼짐 → Y0 꺼짐. 정확히는 RST 가 OUT Y0 보다 뒤에 있어서 다음 스캔(0.01초 뒤)에 꺼집니다. PLC 는 위에서 아래로 차례로 실행하기 때문입니다.\n④ 3.6초: 다시 1개가 되지만 3개가 아니므로 Y0 은 꺼진 채로 있습니다.\n\n정답: Y0 1.9~3.0초 ON.\n\n' +
      '실무 메모: 카운터 값은 정전 뒤에도 남게(래치) 설정하는 경우가 많습니다. 차트에는 카운터 현재값을 워드 신호(0, 1, 2, 3)로 함께 그리면 이해하기 쉽습니다.',
    build: () =>
      plcAnswer('카운터', 'LD X0\nOUT C0 K3\nLD C0\nOUT Y0\nLD X1\nRST C0\nEND', { X0: '제품 감지', X1: '리셋 버튼', Y0: '배출 알림' }, [pulse('X0', [500, 700], [1200, 1400], [1900, 2100], [3600, 3800]), pulse('X1', [3000, 3200])], ['X0', 'X1', 'Y0'], ['Y0'], 4500),
  },
  {
    id: 'plc-flicker',
    kind: 'plc',
    level: 2,
    title: '깜빡이 (플리커) 회로',
    goal: '타이머 두 개가 서로를 리셋하며 일정한 주기의 ON/OFF 를 만드는 "플리커"를 익힙니다.',
    problem:
      '운전 스위치 X0 이 켜져 있는 동안 경광등 Y0 을 0.5초 켜고 0.5초 끄기를 되풀이합니다. T0, T1 은 둘 다 K5 = 0.5초입니다.\n\n' +
      '주어진 입력:\n· X0 운전 스위치: 0.5~3.5초 켜짐\n\n그릴 것: Y0 경광등. (0~4초)',
    ladder: '  X0    T1\n--| |---|/|-------( T0 K5 )\n  T0\n--| |-------------( T1 K5 )\n  X0    T0\n--| |---|/|-------( Y0 )',
    program: 'LD  X0\nANI T1\nOUT T0 K5    ; 켜짐 0.5초 재기\nLD  T0\nOUT T1 K5    ; 꺼짐 0.5초 재기\nLD  X0\nANI T0\nOUT Y0       ; T0 이 다 세기 전까지 켜짐\nEND',
    hints: ['X0 이 켜지면 Y0 은 바로 켜지고, T0 이 0.5초를 셉니다.', 'T0 이 다 세면 Y0 이 꺼지고 T1 이 0.5초를 셉니다. T1 이 다 세면 T0 이 리셋됩니다.', '한 주기는 1초(켜짐 0.5 + 꺼짐 0.5)입니다. X0 이 꺼지면 바로 꺼집니다.'],
    explanation:
      '① 0.5초: X0 켜짐 → Y0 켜짐, T0 세기 시작.\n② 1.0초: T0 완료 → Y0 꺼짐, T1 세기 시작.\n③ 1.5초: T1 완료 → T0 코일이 끊겨 T0 리셋 → Y0 다시 켜짐, T1 도 리셋.\n' +
      '④ 이렇게 0.5초씩 반복: 켜짐 0.5~1.0, 1.5~2.0, 2.5~3.0 …, 3.5초에 X0 이 꺼지면 끝.\n\n정답: Y0 은 0.5~1.0, 1.5~2.0, 2.5~3.0초 ON (3.0~3.5초는 꺼짐 구간). 실제 PLC 에서는 스캔 시간만큼 조금씩 늦어집니다.\n\n' +
      '실무 메모: 경고등, 부저 단속음, 이상 표시 램프에 많이 씁니다. PLC 에 따라 1초 주기 특수 릴레이(미쓰비시 M8013, LS F0093 등)를 쓰기도 합니다.',
    build: () =>
      plcAnswer('깜빡이 회로', 'LD X0\nANI T1\nOUT T0 K5\nLD T0\nOUT T1 K5\nLD X0\nANI T0\nOUT Y0\nEND', { X0: '운전 스위치', Y0: '경광등' }, [pulse('X0', [500, 3500])], ['X0', 'Y0'], ['Y0'], 4000),
  },
  {
    id: 'plc-sequence',
    kind: 'plc',
    level: 3,
    title: '순차 기동 (1초 간격)',
    goal: '타이머를 이어 붙여 여러 출력을 차례로 켜는 순차 동작과, 공통 정지로 한꺼번에 끄는 구조를 익힙니다.',
    problem:
      '시작 버튼 X0 을 누르면 컨베이어 1 → 2 → 3 을 1초 간격으로 차례로 기동하고(돌입 전류를 나누기 위해), 정지 버튼 X1 로 모두 멈춥니다. M0 은 "운전 중" 자기유지 릴레이, T0·T1 은 K10 = 1초입니다.\n\n' +
      '주어진 입력:\n· X0 시작: 0.5~0.7초\n· X1 정지: 4.0~4.2초\n\n그릴 것: Y0 컨베이어1, Y1 컨베이어2, Y2 컨베이어3. (0~5초)',
    ladder: '  X0     X1\n--| |-+--|/|------( M0 )\n  M0  |\n--| |-+\n  M0\n--| |-------+-----( Y0 )\n            +-----( T0 K10 )\n  T0\n--| |-------+-----( Y1 )\n            +-----( T1 K10 )\n  T1\n--| |-------------( Y2 )',
    program: 'LD  X0\nOR  M0\nANI X1\nOUT M0       ; 운전 중\nLD  M0\nOUT Y0       ; 컨베이어1\nOUT T0 K10\nLD  T0\nOUT Y1       ; 컨베이어2\nOUT T1 K10\nLD  T1\nOUT Y2       ; 컨베이어3\nEND',
    hints: ['M0 이 켜지면 Y0 은 바로, T0 은 1초를 세기 시작합니다.', 'T0 이 다 세면 Y1 이 켜지고 T1 이 1초를 셉니다.', '정지 버튼으로 M0 이 꺼지면 T0 이 리셋 → T1 도 리셋 → 세 출력이 같은 순간에 꺼집니다.'],
    explanation:
      '① 0.5초: X0 → M0 켜짐(자기유지) → Y0 켜짐, T0 시작.\n② 1.5초: T0 완료 → Y1 켜짐, T1 시작.\n③ 2.5초: T1 완료 → Y2 켜짐.\n' +
      '④ 4.0초: X1 → M0 꺼짐 → Y0 꺼짐, T0 리셋 → Y1 꺼짐, T1 리셋 → Y2 꺼짐. 모두 같은 스캔에 꺼집니다.\n\n정답: Y0 0.5~4.0초, Y1 1.5~4.0초, Y2 2.5~4.0초.\n\n' +
      '실무 메모: 큰 모터 여러 대를 한꺼번에 기동하면 전원 전압이 크게 떨어지므로 이렇게 시차를 둡니다. 멈출 때는 반대로 "하류부터 차례로 정지"해야 제품이 쌓이지 않는 설비도 있습니다. 그런 경우 정지 순서도 타임차트로 따로 그려 검토합니다.',
    build: () =>
      plcAnswer(
        '순차 기동',
        'LD X0\nOR M0\nANI X1\nOUT M0\nLD M0\nOUT Y0\nOUT T0 K10\nLD T0\nOUT Y1\nOUT T1 K10\nLD T1\nOUT Y2\nEND',
        { X0: '시작 버튼', X1: '정지 버튼', M0: '운전 중', Y0: '컨베이어1', Y1: '컨베이어2', Y2: '컨베이어3' },
        [pulse('X0', [500, 700]), pulse('X1', [4000, 4200])],
        ['X0', 'X1', 'Y0', 'Y1', 'Y2'],
        ['Y0', 'Y1', 'Y2'],
        5000,
      ),
  },
  {
    id: 'plc-offdelay',
    kind: 'plc',
    level: 3,
    title: '컨베이어 정지 지연',
    goal: '입력이 꺼진 뒤 일정 시간이 지나야 출력을 끄는 "OFF 딜레이"를 ON 딜레이 타이머로 만드는 방법을 익힙니다.',
    problem:
      '제품 감지 센서 X0 이 켜지면 컨베이어 Y0 을 돌리고, 센서가 꺼진 뒤에도 3초 더 돌려 제품을 끝까지 보낸 뒤 멈춥니다. 3초 안에 다음 제품이 오면 다시 3초를 셉니다. T0 은 K30 = 3초입니다.\n\n' +
      '주어진 입력:\n· X0 제품 감지: 0.5~1.5초, 2.5~3.0초\n\n그릴 것: Y0 컨베이어. (0~7초)',
    ladder: '  X0     T0\n--| |-+--|/|------( Y0 )\n  Y0  |\n--| |-+\n  X0    Y0\n--|/|---| |-------( T0 K30 )',
    program: 'LD  X0\nOR  Y0\nANI T0\nOUT Y0       ; 컨베이어 (자기유지)\nLDI X0\nAND Y0\nOUT T0 K30   ; 센서가 꺼진 뒤 3초\nEND',
    hints: ['X0 이 켜지면 Y0 이 켜지고 자기유지됩니다.', 'T0 은 "X0 이 꺼져 있고 Y0 이 켜져 있을 때"만 셉니다. 1.5초부터 세다가 2.5초에 X0 이 다시 켜지면?', '마지막으로 X0 이 꺼진 3.0초부터 3초를 다 세면 Y0 이 꺼집니다.'],
    explanation:
      '① 0.5초: X0 → Y0 켜짐(자기유지).\n② 1.5초: X0 꺼짐 → T0 세기 시작.\n③ 2.5초: 1초만 셌는데 X0 이 다시 켜져 T0 이 리셋됩니다. Y0 은 계속 켜져 있습니다.\n' +
      '④ 3.0초: X0 꺼짐 → T0 다시 세기 시작.\n⑤ 6.0초: 3초 완료 → ANI T0 이 끊겨 Y0 꺼짐 → T0 코일도 꺼져 리셋. (T0 이 Y0 보다 아래에 있어서 실제로는 한 스캔, 0.01초 뒤에 꺼집니다.)\n\n정답: Y0 0.5~6.0초 ON (한 번).\n\n' +
      '실무 메모: LS 의 TOFF, 지멘스의 SF 처럼 OFF 딜레이 타이머 명령이 따로 있는 PLC 도 있습니다. 명령이 없어도 이 문제처럼 ON 딜레이와 자기유지로 똑같이 만들 수 있습니다.',
    build: () =>
      plcAnswer('컨베이어 정지 지연', 'LD X0\nOR Y0\nANI T0\nOUT Y0\nLDI X0\nAND Y0\nOUT T0 K30\nEND', { X0: '제품 감지', Y0: '컨베이어' }, [pulse('X0', [500, 1500], [2500, 3000])], ['X0', 'Y0'], ['Y0'], 7000),
  },
];

// ───────────────────────── 설비 동작 문제 ─────────────────────────

function machine(id: string, level: 1 | 2 | 3, title: string, goal: string, problem: string, hints: string[], why: string, make: () => SeqSpec): Exercise {
  return {
    id,
    kind: 'machine',
    level,
    title,
    goal,
    problem,
    hints,
    get explanation() {
      return `${why}\n\n시간 순서:\n${timelineText(make())}`;
    },
    build: () => machineAnswer(make()),
  };
}

const pusher = () => {
  const d = newDevice('cyl2', '푸셔', { fwdTime: 600, retTime: 500 });
  return spec([d], [newAction({ device: d.id, dir: 'fwd' }), newAction({ device: '', wait: 300, label: '밀기 유지' }), newAction({ device: d.id, dir: 'ret' })], '푸셔 왕복');
};

const stopper = () => {
  const d = newDevice('cyl1', '스토퍼', { fwdLabel: '상승', retLabel: '하강', fwdTime: 400, retTime: 300 });
  return spec([d], [newAction({ device: d.id, dir: 'fwd' }), newAction({ device: '', wait: 2000, label: '제품 정지' }), newAction({ device: d.id, dir: 'ret' })], '스토퍼');
};

const clampPress = () => {
  const c = newDevice('cyl2', '클램프', { fwdTime: 500, retTime: 400 });
  const p = newDevice('cyl2', '프레스', { fwdLabel: '하강', retLabel: '상승', fwdTime: 800, retTime: 600 });
  return spec(
    [c, p],
    [newAction({ device: c.id, dir: 'fwd' }), newAction({ device: p.id, dir: 'fwd' }), newAction({ device: '', wait: 1000, label: '가압' }), newAction({ device: p.id, dir: 'ret' }), newAction({ device: c.id, dir: 'ret' })],
    '클램프 · 프레스',
  );
};

const twoClamps = () => {
  const l = newDevice('cyl2', '좌 클램프', { fwdTime: 500, retTime: 500 });
  const r = newDevice('cyl2', '우 클램프', { fwdTime: 700, retTime: 600 });
  return spec(
    [l, r],
    [
      newAction({ device: l.id, dir: 'fwd' }),
      newAction({ device: r.id, dir: 'fwd', withPrev: true }),
      newAction({ device: '', wait: 1000, label: '용접' }),
      newAction({ device: l.id, dir: 'ret' }),
      newAction({ device: r.id, dir: 'ret', withPrev: true }),
    ],
    '양쪽 클램프 동시 동작',
  );
};

const pickPlace = () => {
  const z = newDevice('cyl2', 'Z축', { fwdLabel: '하강', retLabel: '상승', fwdTime: 400, retTime: 400 });
  const v = newDevice('vacuum', '흡착', { fwdTime: 300, retTime: 200 });
  const y = newDevice('cyl2', 'Y축', { fwdTime: 800, retTime: 800 });
  return spec(
    [z, v, y],
    [
      newAction({ device: z.id, dir: 'fwd' }),
      newAction({ device: v.id, dir: 'fwd' }),
      newAction({ device: z.id, dir: 'ret' }),
      newAction({ device: y.id, dir: 'fwd' }),
      newAction({ device: z.id, dir: 'fwd' }),
      newAction({ device: v.id, dir: 'ret' }),
      newAction({ device: z.id, dir: 'ret' }),
      newAction({ device: y.id, dir: 'ret' }),
    ],
    '픽앤플레이스',
  );
};

const drill = () => {
  const c = newDevice('cyl2', '클램프', { fwdTime: 500, retTime: 500 });
  const m = newDevice('motor', '드릴 모터');
  const d = newDevice('cyl2', '드릴', { fwdLabel: '하강', retLabel: '상승', fwdTime: 700, retTime: 500 });
  return spec(
    [c, m, d],
    [
      newAction({ device: c.id, dir: 'fwd' }),
      newAction({ device: m.id, dir: 'fwd' }),
      newAction({ device: d.id, dir: 'fwd', withPrev: true }),
      newAction({ device: '', wait: 1000, label: '가공' }),
      newAction({ device: d.id, dir: 'ret' }),
      newAction({ device: m.id, dir: 'ret' }),
      newAction({ device: c.id, dir: 'ret', withPrev: true }),
    ],
    '드릴 가공',
  );
};

const machineExercises: Exercise[] = [
  machine(
    'mc-pusher',
    1,
    '실린더 한 개 왕복',
    '실린더가 움직일 때 솔레노이드(출력)와 끝 위치 센서(입력)가 어떤 순서로 켜지고 꺼지는지 익힙니다.',
    '시작 버튼(X0)을 누르면(0.1초) 푸셔 실린더가 전진해 제품을 밀고, 전진단 센서로 도착을 확인한 뒤 0.3초 동안 밀고 있다가 후진합니다.\n\n' +
      '· 푸셔: 더블 솔레노이드. 전진 SOL(Y0), 후진 SOL(Y1)은 움직이는 동안만 켭니다.\n· 전진에 0.6초, 후진에 0.5초 걸립니다.\n· 센서: 전진단(X1), 후진단(X2). 처음에는 후진 위치에 있습니다.\n· 밀기 유지: 전진단이 켜지면 타이머 T0 으로 0.3초를 잽니다.\n\n' +
      '그릴 것: 전진 SOL, 후진 SOL, 전진단, 후진단, 밀기 유지 타이머.',
    ['처음(0초)에 푸셔는 후진 위치에 있으므로 후진단 센서는 켜져 있습니다.', '전진 SOL 이 켜지면 실린더가 출발하는 순간 후진단이 꺼지고, 0.6초 뒤(0.7초) 전진단이 켜집니다. 이때 전진 SOL 을 끄고 타이머가 0.3초를 잽니다.', '타이머가 끝나는 1.0초에 후진 SOL 이 켜지고, 그 순간 전진단이 꺼집니다. 0.5초 뒤(1.5초) 후진단이 켜집니다.'],
    '실린더 한 번 움직임은 항상 "출력 ON → 출발(출발한 쪽 센서 OFF) → 도착(도착한 쪽 센서 ON) → 다음 동작"의 순서입니다. 더블 솔레노이드는 밸브가 위치를 기억하므로 도착하면 SOL 을 꺼도 그 자리에 있습니다. 한 사이클은 0.1초 시작부터 1.5초까지 1.4초입니다.',
    pusher,
  ),
  machine(
    'mc-stopper',
    1,
    '싱글 솔레노이드 스토퍼',
    '싱글 솔레노이드는 켜 두는 동안만 그 위치에 있고, 끄면 스프링으로 돌아온다는 것과 대기(타이머) 표시를 익힙니다.',
    '시작 버튼(X0)을 누르면(0.1초) 스토퍼가 올라와 제품을 2초 동안 세웠다가 내려갑니다.\n\n' +
      '· 스토퍼: 싱글 솔레노이드(Y0). SOL 을 켜면 상승, 끄면 스프링으로 하강합니다.\n· 상승에 0.4초, 하강에 0.3초 걸립니다.\n· 센서: 상승단(X1), 하강단(X2). 처음에는 하강 위치.\n· 상승단을 확인한 뒤 2초 기다리는 타이머(T0)를 켭니다.\n\n' +
      '그릴 것: 상승 SOL, 상승단, 하강단, 제품 정지 타이머.',
    ['싱글 솔레노이드는 올라가 있는 동안 계속 켜져 있어야 합니다. 언제 꺼야 내려가기 시작할까요?', '타이머는 상승단이 켜진 순간부터 2초 동안 켜져 있습니다.', '타이머가 끝나는 순간 SOL 을 끄면, 그때 상승단이 꺼지고 0.3초 뒤 하강단이 켜집니다.'],
    '더블 솔레노이드와 달리 싱글 솔레노이드는 SOL 을 끄면 스프링으로 돌아가므로, 올라가 있어야 하는 동안(0.1~2.5초) 내내 켜 둡니다. 정전이나 비상정지로 출력이 꺼지면 자동으로 원위치로 돌아가는 성질이 있어, 안전 쪽으로 움직여야 하는 기기에 많이 씁니다.',
    stopper,
  ),
  machine(
    'mc-clamp-press',
    2,
    '클램프 → 프레스 → 가압',
    '여러 기기가 차례로 움직일 때 "앞 동작의 도착 센서가 다음 동작을 시작시킨다"는 흐름과 사이클 타임 계산을 익힙니다.',
    '제품을 클램프로 고정한 뒤 프레스로 1초 동안 누르고, 프레스를 올린 다음 클램프를 풉니다. 시작 버튼(X0)은 0.1초에 눌립니다.\n\n' +
      '· 클램프: 더블 SOL(전진 Y0, 후진 Y1), 전진 0.5초, 후진 0.4초, 센서 전진단 X1 · 후진단 X2\n· 프레스: 더블 SOL(하강 Y2, 상승 Y3), 하강 0.8초, 상승 0.6초, 센서 하강단 X3 · 상승단 X4\n· 가압: 프레스 하강단을 확인한 뒤 1초(타이머 T0)\n\n' +
      '순서: 클램프 전진 → 프레스 하강 → 가압 1초 → 프레스 상승 → 클램프 후진\n\n그릴 것: SOL 4개, 센서 4개, 가압 타이머.',
    ['각 동작의 시작 시각 = 앞 동작이 끝난 시각입니다. 0.1 → 0.6 → 1.4 → 2.4 → 3.0 → 3.4초.', '더블 SOL 은 움직이는 동안만 켭니다. 예: 클램프 전진 SOL 은 0.1~0.6초.', '원위치(후진단, 상승단) 센서는 처음에 켜져 있고, 떠날 때 꺼졌다가 돌아오면 다시 켜집니다.'],
    '타임차트를 그릴 때는 먼저 각 동작의 시작·끝 시각을 표로 계산하고, 그다음 출력 → 센서 순으로 그립니다. 이 설비의 사이클 타임은 0.1~3.4초, 3.3초입니다. 목표가 3초라면 클램프 후진과 프레스 상승을 겹칠 수 있는지(부딪히지 않는지) 검토합니다.',
    clampPress,
  ),
  machine(
    'mc-two-clamps',
    2,
    '두 클램프 동시 동작',
    '동시에 움직이는 동작은 "둘 다 도착해야" 다음 단계로 넘어간다는 것과, 동시 동작으로 사이클 타임이 줄어드는 것을 익힙니다.',
    '용접 지그의 좌·우 클램프를 동시에 전진시키고, 둘 다 도착하면 1초 동안 용접한 뒤 동시에 후진합니다. 시작 버튼(X0)은 0.1초.\n\n' +
      '· 좌 클램프: 더블 SOL(전진 Y0, 후진 Y1), 전진 0.5초, 후진 0.5초, 센서 X1 · X2\n· 우 클램프: 더블 SOL(전진 Y2, 후진 Y3), 전진 0.7초, 후진 0.6초, 센서 X3 · X4\n· 용접: 두 전진단이 모두 켜진 뒤 1초(타이머 T0)\n\n그릴 것: SOL 4개, 센서 4개, 용접 타이머.',
    ['두 클램프는 0.1초에 함께 출발하지만, 좌는 0.6초, 우는 0.8초에 도착합니다.', '용접은 늦게 도착하는 쪽(우 클램프, 0.8초)을 기다린 뒤 시작합니다.', '후진도 1.8초에 함께 출발하고, 좌 2.3초 · 우 2.4초에 도착합니다.'],
    '동시에 움직이면 사이클 타임은 "둘 중 긴 쪽"만큼만 걸립니다. 차례로 움직였다면 0.5+0.7+1+0.5+0.6 = 3.3초였겠지만, 동시에 움직여 0.7+1+0.6 = 2.3초가 됩니다. 이렇게 겹칠 수 있는 동작을 찾는 것이 사이클 타임 개선의 기본입니다.',
    twoClamps,
  ),
  machine(
    'mc-pick-place',
    3,
    '픽앤플레이스',
    '흡착(진공) 확인 센서를 포함한 8단계 이송 동작을 스스로 시간표로 풀어 그리는 연습입니다.',
    '제품을 흡착해 옮겨 놓는 장치입니다. 시작 버튼(X0)은 0.1초.\n\n' +
      '· Z축(상하): 더블 SOL(하강 Y0, 상승 Y1), 하강 0.4초, 상승 0.4초, 센서 하강단 X1 · 상승단 X2\n· 흡착: SOL 하나(Y2, 켜 두는 동안 흡착), 흡착 0.3초 뒤 흡착 확인(X3) ON, 해제 0.2초\n· Y축(전후): 더블 SOL(전진 Y3, 후진 Y4), 전진 0.8초, 후진 0.8초, 센서 전진단 X4 · 후진단 X5\n\n' +
      '순서: Z 하강 → 흡착 → Z 상승 → Y 전진 → Z 하강 → 흡착 해제 → Z 상승 → Y 후진\n\n그릴 것: SOL 5개, 센서 5개.',
    ['먼저 8개 동작의 시작·끝 시각을 적어 보세요: 0.1, 0.5, 0.8, 1.2, 2.0, 2.4, 2.6, 3.0, 3.8초.', '흡착 SOL 은 흡착 시작(0.5초)부터 해제 시작(2.4초)까지 켜져 있습니다. 흡착 확인 센서는 0.3초 뒤 켜지고, 해제를 시작하면 꺼집니다.', 'Z축은 한 사이클에 두 번 내려갑니다. 하강단·상승단도 두 번씩 바뀝니다.'],
    '단계가 많을수록 "시간표를 먼저 쓰고 그린다"가 중요합니다. 이 장치의 사이클 타임은 3.7초입니다. 실제 설계에서는 Y 후진 중에 Z 를 미리 내리지 않도록(충돌) 인터록을 두고, 흡착 확인 센서가 켜지지 않으면 이상으로 멈추는 조건도 함께 검토합니다.',
    pickPlace,
  ),
  machine(
    'mc-drill',
    3,
    '드릴 가공 (모터 포함)',
    '모터처럼 센서 없이 켜 두는 출력과 실린더 동작을 함께 그리고, 동시 동작이 섞인 순서를 푸는 연습입니다.',
    '제품을 클램프한 뒤 드릴 모터를 돌리며 하강해 1초 가공하고, 상승 후 모터 정지와 클램프 해제를 동시에 합니다. 시작 버튼(X0)은 0.1초.\n\n' +
      '· 클램프: 더블 SOL(전진 Y0, 후진 Y1), 전진·후진 0.5초, 센서 X1 · X2\n· 드릴 모터: 운전 출력 Y2 (기동~정지 동안 ON, 걸리는 시간 없음)\n· 드릴: 더블 SOL(하강 Y3, 상승 Y4), 하강 0.7초, 상승 0.5초, 센서 X3 · X4\n\n' +
      '순서: 클램프 전진 → 모터 기동 + 드릴 하강(동시) → 가공 1초 → 드릴 상승 → 모터 정지 + 클램프 후진(동시)\n\n그릴 것: 출력 5개, 센서 4개, 가공 타이머.',
    ['모터 기동과 드릴 하강은 클램프 전진단이 켜지는 0.6초에 함께 시작합니다.', '모터 운전 출력은 0.6초부터 모터 정지(드릴 상승이 끝나는 2.8초)까지 켜져 있습니다.', '마지막 단계는 클램프 후진 0.5초가 끝나는 3.3초에 끝납니다.'],
    '모터처럼 위치 센서가 없는 기기는 "켜 둔 동안 돈다"로 그립니다. 드릴이 제품에 닿기 전에 모터가 돌고 있어야 하므로 모터 기동을 하강과 같이(또는 먼저) 시작하고, 드릴이 완전히 올라온 뒤 정지합니다. 사이클 타임은 3.2초입니다.',
    drill,
  ),
];

export const EXERCISES: Exercise[] = [...plcExercises, ...machineExercises];

export function exerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}
