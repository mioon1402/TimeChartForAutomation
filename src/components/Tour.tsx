/**
 * 따라 하기 튜토리얼: 화면의 버튼을 하나씩 강조하고 설명한다.
 * "해 보기" 가 있는 단계는 사용자가 그 동작을 하면 자동으로 다음 단계로 넘어간다.
 * 시작할 때 지금 차트를 보관해 두고, 끝나면 되돌린다 (원하면 튜토리얼 차트를 계속 쓸 수 있음).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../model/book';
import { clearTutorialBackup, saveTutorialBackup, useStore } from '../store/store';
import { sampleProject } from '../model/project';
import { plcSamples } from '../plc/samples';
import { computeTimeline, defaultSpec } from '../model/sequence';
import { newSequenceProject, sequenceStatus } from '../model/seqEdit';
import { tr } from '../i18n';
import { Icon } from './ui';

type S = ReturnType<typeof useStore.getState>;

export type TourId = 'basic' | 'plc' | 'sequence';

interface TourStep {
  /** 강조할 요소 (CSS 선택자). 없거나 화면에 없으면 가운데에 설명만 */
  target?: string;
  title: string;
  body: string;
  /** 해 보기: 사용자가 할 동작. done 이 참이 되면 자동으로 다음 단계 */
  task?: string;
  done?: (s: S, start: S) => boolean;
  /** 이 단계에 들어올 때 화면 준비 (탭 전환 등) */
  enter?: () => void;
}

const st = () => useStore.getState();

export function tourTitle(id: TourId): string {
  if (id === 'sequence') return tr('동작 순서표로 차트 만들기', 'Chart from a sequence table');
  return id === 'basic' ? tr('차트 그리기 기초', 'Chart basics') : tr('PLC 프로그램으로 차트 만들기', 'Chart from a PLC program');
}

const devByName = (s: S, name: string) => s.project.sequence?.devices.find((d) => d.name === name);

function sequenceSteps(): TourStep[] {
  return [
    {
      title: tr('동작 순서표로 차트 만들기', 'Chart from a sequence table'),
      body: tr(
        '실무에서 타임차트를 만드는 순서(설비 → 동작 기기 → I/O → 동작 순서 → 확인)대로 표를 채워 차트를 만들어 봅니다. 예시(클램프 → 프레스)가 들어 있습니다. 3분쯤 걸리고, 끝나면 지금 차트로 돌아갑니다.',
        'Fill in tables in the practical order (machine → devices → I/O → sequence → review) to build a chart. An example (clamp → press) is loaded. About 3 minutes; your chart comes back at the end.',
      ),
      enter: () => st().setTab('sequence'),
    },
    {
      target: '#seq-machine',
      title: tr('① 설비', '① Machine'),
      body: tr(
        '설비 이름과 목표 사이클 타임(한 사이클을 몇 초 안에 끝내야 하는지)을 적습니다. 설비 이름·제목·도면 번호·작성자는 보고서 표제란에 그대로 들어갑니다.',
        'Machine name and the target cycle time. Name, title, drawing no. and author go into the report title block.',
      ),
    },
    {
      target: '#seq-devices .grid-wrap',
      title: tr('② 동작 기기: 엑셀처럼 입력', '② Devices: type like a spreadsheet'),
      body: tr(
        '움직이는 것과 한쪽 끝에서 반대쪽 끝까지 가는 시간입니다. 칸을 누르고 바로 숫자를 치면 바뀝니다. Enter·Tab·방향키로 옮겨 다닙니다.',
        'What moves and its end-to-end travel time. Click a cell and just type; Enter, Tab and arrows move around.',
      ),
      task: tr('프레스의 "가는 시간(초)" 칸을 누르고 1 을 친 뒤 Enter 를 누르세요.', 'Click the press "Go time" cell, type 1 and press Enter.'),
      done: (s) => devByName(s, '프레스')?.fwdTime === 1000,
    },
    {
      target: '#seq-io',
      title: tr('③ I/O 목록', '③ I/O list'),
      body: tr(
        '기기에서 입력(버튼·센서)과 출력(SOL)을 자동으로 뽑았습니다. 주소 방식(미쓰비시·LS·지멘스)을 고르고 배선과 다른 곳만 고칩니다. 엑셀 I/O 리스트를 제목 줄(주소, 이름)과 함께 붙여 넣으면 이름으로 찾아 주소를 넣습니다.',
        'Inputs and outputs are derived from the devices. Pick the address style and fix what differs from the wiring. Paste an Excel I/O list with a header row to fill addresses by name.',
      ),
    },
    {
      target: '#seq-actions .grid-wrap',
      title: tr('④ 동작 순서: 새 기기는 이름만 적으면', '④ Sequence: new devices by name'),
      body: tr(
        '한 줄에 기기와 동작 하나입니다. 기기 표에 없는 이름을 적으면 기기가 새로 생기고, 처음 적은 동작(상승)과 반대 동작(하강)이 그 기기의 동작 이름이 됩니다.',
        'One device and motion per row. A new name creates the device; the first motion you type (and its opposite) become its motion names.',
      ),
      task: tr('맨 아래 빈 줄의 "기기" 칸에 리프터, Tab, "동작" 칸에 상승 을 적고 Enter.', 'In the empty last row type 리프터 (device), Tab, 상승 (motion), Enter.'),
      done: (s) => !!devByName(s, '리프터') && !!s.project.sequence?.actions.some((a) => a.device === devByName(s, '리프터')!.id),
    },
    {
      target: '#seq-actions .seq-notes',
      title: tr('검토할 점', 'Things to check'),
      body: tr(
        '리프터가 올라간 채로 사이클이 끝나서 다음 사이클을 시작할 수 없다고 알려 줍니다. 같은 기기 이름만 한 번 더 적으면 반대 동작(하강)이 들어갑니다.',
        'The lifter ends the cycle up, so the next cycle cannot start. Type the same device name once more to add the opposite motion.',
      ),
      task: tr('빈 줄의 "기기" 칸에 리프터 만 적고 Enter.', 'Type just 리프터 in the empty row and press Enter.'),
      done: (s) => !!s.project.sequence && computeTimeline(s.project.sequence).notes.length === 0,
    },
    {
      target: '[data-tour="seq-paste"]',
      title: tr('엑셀 동작 순서표 붙여넣기', 'Paste an Excel sequence table'),
      body: tr(
        '엑셀에 정리해 둔 동작 순서표가 있으면 복사해서 ④ 의 첫 칸에 Ctrl+V 하거나 이 버튼을 누릅니다. 첫 줄의 제목(기기, 동작, 시간, 시작)으로 칸을 맞추고, "클램프 전진"처럼 한 칸에 적어도 나눠 읽습니다.',
        'Have a sequence table in Excel? Copy it and Ctrl+V into the first cell of ④, or use this button. Header words map the columns; "clamp advance" in one cell is split.',
      ),
    },
    {
      target: '#seq-review .seq-preview',
      title: tr('⑤ 확인: 미리보기', '⑤ Review: preview'),
      body: tr('표를 고칠 때마다 사이클 타임, 목표 대비 OK/NG, 차트 미리보기가 바로 바뀝니다.', 'Cycle time, target OK/NG and the chart preview update as you edit.'),
    },
    {
      target: '[data-tour="seq-apply"]',
      title: tr('차트에 적용', 'Apply to the chart'),
      body: tr(
        '고친 내용은 파일에 바로 저장되지만, 차트는 이 버튼을 눌러야 다시 만들어집니다. 적용한 뒤에도 Ctrl+Z 로 되돌릴 수 있습니다.',
        'Edits are saved right away, but the chart is rebuilt only when you press this. Ctrl+Z undoes it.',
      ),
      task: tr('[차트에 적용]을 누르세요.', 'Click [Apply to chart].'),
      done: (s) => s.tab === 'editor' && sequenceStatus(s.project) === 'applied',
    },
    {
      target: '.chart-body',
      title: tr('만들어진 타임차트', 'The chart'),
      body: tr(
        'SOL·센서 파형, 실린더 동작선, "센서 확인 → 다음 동작" 화살표, 공정 스텝, 인터록 규칙이 들어 있습니다. 여기서 파형을 더 다듬을 수 있습니다.',
        'Solenoid and sensor waveforms, cylinder motion, cause arrows, steps and interlock rules. Polish it further here.',
      ),
      enter: () => st().setTab('editor'),
    },
    {
      target: '.sheetbar',
      title: tr('설비 하나 = 파일 하나', 'One machine, one file'),
      body: tr(
        '[+ 차트 추가]로 원점 복귀, 유닛별 차트를 같은 파일에 더합니다. 탭을 두 번 누르면 이름을 바꿉니다. 보고서에서 목차와 함께 한 번에 인쇄할 수 있습니다.',
        'Use [+ Add chart] to keep homing and unit charts in the same file. Double-click a tab to rename. Print them together with a contents page.',
      ),
    },
    {
      target: '[data-tour="tab-report"]',
      title: tr('인쇄', 'Printing'),
      body: tr(
        '보고서 탭에서 "한 장으로"를 고르면 요약·전체 차트·스텝 표가 한 장에 들어갑니다. 세로 용지, 흑백 프린터용 무늬도 고를 수 있습니다.',
        'In the Report tab, "One page" fits the summary, whole chart and step table on one sheet. Portrait and black-and-white patterns are available too.',
      ),
    },
  ];
}

function basicSteps(): TourStep[] {
  return [
    {
      title: tr('차트 그리기 기초', 'Chart basics'),
      body: tr(
        '예제 차트(드릴 가공 설비)로 기본 조작을 따라 해 봅니다. 3분쯤 걸립니다. 튜토리얼이 끝나면 지금 차트로 돌아갑니다.',
        'Follow along with an example chart (a drilling machine). About 3 minutes. Your current chart comes back when you finish.',
      ),
      enter: () => st().setTab('editor'),
    },
    {
      target: '.chart-labels',
      title: tr('신호 목록', 'Signals'),
      body: tr(
        '한 줄이 신호 하나입니다. 주소(X0, Y0 …)와 이름이 있고, 이름을 더블클릭하면 바꿀 수 있습니다. 왼쪽 ⋮⋮ 를 끌면 순서가 바뀝니다.',
        'Each row is one signal with its address (X0, Y0 …) and name. Double-click a name to rename it; drag ⋮⋮ to reorder.',
      ),
    },
    {
      target: '.chart-body',
      title: tr('파형', 'Waveforms'),
      body: tr(
        '가로축이 시간입니다. 위로 올라간 구간이 ON, 비스듬한 선은 실린더가 움직이는 시간입니다. 화살표는 "이 신호 때문에 저 신호가 켜진다"는 관계입니다.',
        'Time runs left to right. Raised = ON, slopes = actuator travel time. Arrows show cause and effect.',
      ),
    },
    {
      target: '[data-tour="tool-draw"]',
      title: tr('그리기 도구', 'Draw tool'),
      body: tr('파형을 직접 그리는 도구입니다. 단축키는 D 입니다.', 'Draws waveforms. Shortcut: D.'),
      task: tr('연필 모양 버튼을 누르세요.', 'Click the pencil button.'),
      done: (s) => s.tool === 'draw',
    },
    {
      target: '.chart-body',
      title: tr('파형 그리기', 'Draw'),
      body: tr('끈 구간의 ON/OFF 가 뒤집힙니다. Shift 를 누르고 끌면 ON, Alt 를 누르고 끌면 OFF 로 칠합니다.', 'Dragging flips ON/OFF in that span. Hold Shift for ON, Alt for OFF.'),
      task: tr('아무 신호 줄 위에서 마우스를 누른 채 옆으로 끌어 보세요.', 'Press and drag sideways on any signal row.'),
      done: (s, a) => s.project !== a.project,
    },
    {
      target: '[data-tour="undo"]',
      title: tr('되돌리기', 'Undo'),
      body: tr('실수해도 괜찮습니다. 되돌리기(Ctrl+Z)와 다시 실행(Ctrl+Y)이 있습니다.', 'Mistakes are fine: undo (Ctrl+Z) and redo (Ctrl+Y).'),
      task: tr('되돌리기 버튼을 눌러 방금 그린 것을 취소하세요.', 'Click undo to take back what you drew.'),
      done: (s, a) => s.past.length < a.past.length,
    },
    {
      target: '[data-tour="tool-select"]',
      title: tr('선택 도구', 'Select tool'),
      body: tr(
        '선택 도구에서 파형이 바뀌는 세로선(에지)을 좌우로 끌면 그 시각이 옮겨집니다. 근처 에지와 눈금에 자동으로 붙습니다. 단축키는 V 입니다.',
        'With the select tool, drag a vertical edge left or right to move it in time. It snaps to nearby edges and the grid. Shortcut: V.',
      ),
      task: tr('화살표 모양 버튼을 누르세요.', 'Click the arrow button.'),
      done: (s) => s.tool === 'select',
    },
    {
      target: '[data-tour="add-signal"]',
      title: tr('신호 추가', 'Add a signal'),
      body: tr('옆의 ▾ 에서 워드(데이터 값), 아날로그, 클럭, 실린더도 고를 수 있습니다.', 'The ▾ next to it adds word, analog, clock or cylinder signals.'),
      task: tr('＋신호 를 눌러 신호를 하나 추가하세요.', 'Click + Signal to add one.'),
      done: (s, a) => s.project.signals.length > a.project.signals.length,
    },
    {
      target: '.chart-head',
      title: tr('공정 스텝과 시간 재기', 'Steps and measuring'),
      body: tr(
        '위 색 띠가 공정 스텝(클램프 → 하강 → 가공 …)입니다. 스텝 도구(S)로 이 띠를 끌면 새 스텝이 생깁니다. 눈금자를 누르면 커서 A, Shift+클릭은 커서 B 로 두 시각 사이 시간을 잽니다.',
        'The colored band shows process steps. Drag on it with the Step tool (S) to add one. Click the ruler for cursor A and Shift+click for cursor B to measure time.',
      ),
    },
    {
      target: '.bottom-tabs',
      title: tr('사이클 타임 · 검증', 'Cycle time & checks'),
      body: tr(
        '아래 탭에서 사이클 타임과 가장 오래 걸리는 스텝, 타이밍 규칙 검증(OK/NG), 동작 순서표를 봅니다.',
        'The tabs below show cycle time and the slowest step, timing-rule checks (OK/NG), and the sequence of events.',
      ),
      enter: () => st().setBottom('steps'),
    },
    {
      target: '[data-tour="tab-report"]',
      title: tr('보고서', 'Report'),
      body: tr('표제란(작성·검토·승인)이 있는 보고서를 인쇄하거나 PDF 로 저장합니다.', 'Print or save a report with a title block as PDF.'),
    },
    {
      target: '[data-tour="menu-file"]',
      title: tr('저장', 'Saving'),
      body: tr(
        '작업은 이 브라우저에 자동 백업됩니다. 파일로 보관하거나 다른 PC 로 옮기려면 파일 → 저장(Ctrl+S)으로 .tchart 파일을 만드세요. 내 설비의 차트는 위쪽 [동작 순서] 탭에서 설비 → 동작 기기 → I/O → 동작 순서를 엑셀처럼 표에 적어(엑셀에서 붙여넣기도 됨) 만들 수 있습니다.',
        'Work is auto-saved in this browser. To keep a file or move it to another PC, use File → Save (Ctrl+S). For your own machine, use the Sequence tab: fill in machine, devices, I/O and sequence in spreadsheet-like tables (pasting from Excel works too).',
      ),
    },
  ];
}

function plcSteps(): TourStep[] {
  return [
    {
      title: tr('PLC 프로그램으로 차트 만들기', 'Chart from a PLC program'),
      body: tr(
        '예제 PLC 프로그램(LS XGK 픽앤플레이스)을 시뮬레이션해서 타임차트를 자동으로 그려 봅니다. 3분쯤 걸립니다. 끝나면 지금 차트로 돌아갑니다.',
        'Simulate an example PLC program (LS XGK pick-and-place) into a timing chart. About 3 minutes. Your current chart comes back when you finish.',
      ),
      enter: () => st().setTab('plc'),
    },
    {
      target: '.plc-src',
      title: tr('PLC 프로그램', 'PLC program'),
      body: tr(
        '여기에 프로그램이 들어갑니다. 내 프로그램은 위의 [파일 열기]로 엽니다: XG5000 니모닉 인쇄 PDF, GX Works CSV, 지멘스 STL, ST 코드. 지금은 예제가 들어 있습니다.',
        'The program goes here. Open your own with [Open file]: XG5000 IL printed to PDF, GX Works CSV, Siemens STL or ST code. An example is loaded now.',
      ),
    },
    {
      target: '.plc-devs .dev-table-wrap',
      title: tr('디바이스와 입력 자극', 'Devices and stimuli'),
      body: tr(
        '프로그램에서 찾은 입력·출력·내부 릴레이입니다. ✔ 표시한 것이 차트에 나옵니다. 입력에는 "입력 자극"을 넣습니다. 예제에는 시작 버튼을 잠깐 눌렀다 떼는 펄스가 들어 있습니다.',
        'Inputs, outputs and relays found in the program. Checked ones appear in the chart. Inputs get a stimulus; the example presses the start button briefly.',
      ),
    },
    {
      target: '.plc-sim .models',
      title: tr('설비 모델', 'Equipment models'),
      body: tr(
        '솔레노이드가 켜지면 얼마 뒤 센서가 켜지는 것을 흉내 냅니다. 이게 있어야 사이클이 멈추지 않고 끝까지 돕니다. 실린더, 지연 응답, 위치 축(크레인·컨베이어)을 넣을 수 있습니다.',
        'Models mimic the machine: a sensor turns on some time after its solenoid. They keep the cycle running. Cylinders, delays and moving axes (cranes, conveyors).',
      ),
    },
    {
      target: '[data-tour="plc-step"]',
      title: tr('공정 스텝', 'Process steps'),
      body: tr(
        '"출력 조합으로 자동"이면 어떤 출력이 켜져 있는지로 공정 스텝을 나눕니다. 스텝 번호를 담는 레지스터(D0 등)가 있으면 그것을 고르면 됩니다.',
        '"From output combinations" splits steps by which outputs are ON. If the program has a step-number register (e.g. D0), pick it instead.',
      ),
    },
    {
      target: '.plc-sim .run',
      title: tr('시뮬레이션', 'Simulate'),
      body: tr('PLC 가 스캔하는 것처럼 프로그램을 계산해서 타임차트를 만듭니다.', 'Runs the program scan by scan like a PLC and builds the chart.'),
      task: tr('[시뮬레이션 → 타임차트 생성]을 누르세요.', 'Click [Simulate → generate chart].'),
      done: (s, a) => s.tab === 'editor' && s.project.signals !== a.project.signals,
    },
    {
      target: '.chart-body',
      title: tr('결과 차트', 'The result'),
      body: tr(
        '위 띠가 공정 스텝, 비스듬한 선이 실린더 동작입니다. 프로그램을 고쳐 다시 시뮬레이션해도 직접 바꾼 이름·색·주석은 유지됩니다.',
        'The band shows process steps; slopes are cylinder motion. Re-simulating keeps your edited names, colors and notes.',
      ),
      enter: () => st().setTab('editor'),
    },
    {
      target: '.bottom-tabs',
      title: tr('동작 순서표', 'Sequence of events'),
      body: tr('몇 초에 무엇이 켜지고 꺼졌는지 시간 순서로 봅니다. 행을 누르면 그 시각으로 이동합니다.', 'What turned on and off, in time order. Click a row to jump there.'),
      enter: () => st().setBottom('events'),
    },
    {
      title: tr('내 프로그램으로 해 보기', 'Try your own program'),
      body: tr(
        'XG5000: 니모닉(IL) 보기 → 인쇄 → 프린터를 "Microsoft Print to PDF"로 → PLC 탭 [파일 열기]로 그 PDF 를 엽니다. 실제 입출력을 M 릴레이로 옮겨 쓰는 프로그램도 자동으로 실제 I/O 로 풀어 줍니다. 자세한 내용은 도움말(?)의 사용 설명서를 보세요.',
        'XG5000: IL view → Print → "Microsoft Print to PDF" → open that PDF in the PLC tab. Relays that copy real I/O are traced back to the physical I/O automatically. See the user guide under Help (?).',
      ),
    },
  ];
}

export function tourSteps(id: TourId): TourStep[] {
  if (id === 'sequence') return sequenceSteps();
  return id === 'basic' ? basicSteps() : plcSteps();
}

/** 튜토리얼용 차트로 바꾸기 */
function setupTour(id: TourId) {
  const s = st();
  const base = sampleProject();
  if (id === 'plc') {
    const ex = plcSamples().find((x) => x.id === 'ls-pickplace') ?? plcSamples()[0];
    s.loadProject({ ...base, plc: { dialect: ex.dialect, source: ex.source, comments: ex.comments, sim: ex.sim } });
  } else if (id === 'sequence') s.loadProject(newSequenceProject(defaultSpec()));
  else s.loadProject(base);
  s.setTool('select');
  s.select(null);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;

export function Tour({ id, onClose }: { id: TourId; onClose: () => void }) {
  const lang = useStore((s) => s.lang);
  const steps = useMemo(() => tourSteps(id), [id, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const [doneFlash, setDoneFlash] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<S>(st());
  const backup = useRef<{ doc: Book; tab: S['tab']; bottom: S['bottom']; fileName: string; dirty: boolean } | null>(null);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  // 시작: 지금 차트 보관 → 튜토리얼 차트
  useEffect(() => {
    const s = st();
    const doc = s.getDocument();
    backup.current = { doc, tab: s.tab, bottom: s.bottom, fileName: s.fileName, dirty: s.dirty };
    saveTutorialBackup(doc);
    setupTour(id);
  }, [id]);

  const finish = (keep: boolean) => {
    const b = backup.current;
    clearTutorialBackup();
    if (!keep && b) {
      st().loadDocument(b.doc, b.fileName);
      useStore.setState({ dirty: b.dirty });
      st().setTab(b.tab);
      st().setBottom(b.bottom);
    }
    onClose();
  };

  // 단계 진입
  useEffect(() => {
    step.enter?.();
    startRef.current = st();
    setDoneFlash(false);
    // 강조할 요소가 화면 밖이면 보이게
    const t = step.target;
    const h = setTimeout(() => {
      const el = t ? document.querySelector(t) : null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, 60);
    return () => clearTimeout(h);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // "해 보기" 완료 → 다음 단계
  useEffect(() => {
    const d = step.done;
    if (!d) return;
    let fired = false;
    let h: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((s) => {
      if (fired || !d(s, startRef.current)) return;
      fired = true;
      setDoneFlash(true);
      h = setTimeout(() => setI((k) => (k === i ? Math.min(k + 1, steps.length - 1) : k)), 700);
    });
    return () => {
      unsub();
      if (h) clearTimeout(h);
    };
  }, [i, step, steps.length]);

  // 강조할 요소 위치 따라가기 (탭 전환, 스크롤, 창 크기 변경)
  useEffect(() => {
    const t = step.target;
    const update = () => {
      const el = t ? (document.querySelector(t) as HTMLElement | null) : null;
      const r = el && el.offsetParent !== null ? visibleRect(el) : null;
      const next = r ? clipBox({ x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 }, window.innerWidth, window.innerHeight) : null;
      setBox((b) => (sameBox(b, next) ? b : next));
    };
    update();
    const h = setInterval(update, 150);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(h);
      window.removeEventListener('resize', update);
    };
  }, [step]);

  // 설명 카드 위치: 강조 영역 아래 → 위 → 오른쪽 → 왼쪽 → 화면 아래
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 12;
    if (!box) {
      setPop({ left: (vw - pw) / 2, top: Math.max(m, (vh - ph) / 2) });
      return;
    }
    const clampX = (x: number) => Math.min(Math.max(m, x), vw - pw - m);
    const clampY = (y: number) => Math.min(Math.max(m, y), vh - ph - m);
    let p: { left: number; top: number };
    if (box.y + box.h + m + ph <= vh - m) p = { left: clampX(box.x), top: box.y + box.h + m };
    else if (box.y - m - ph >= m) p = { left: clampX(box.x), top: box.y - m - ph };
    else if (box.x + box.w + m + pw <= vw - m) p = { left: box.x + box.w + m, top: clampY(box.y) };
    else if (box.x - m - pw >= m) p = { left: box.x - m - pw, top: clampY(box.y) };
    else p = { left: (vw - pw) / 2, top: vh - ph - m };
    setPop((q) => (q && q.left === p.left && q.top === p.top ? q : p));
  }, [box, i, lang, doneFlash]);

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label={tourTitle(id)}>
      {box ? <div className="tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} /> : <div className="tour-dim" />}
      <div ref={popRef} className="tour-pop" style={pop ? { left: pop.left, top: pop.top } : { visibility: 'hidden' }}>
        <div className="tour-head">
          <span className="tour-count">
            {tourTitle(id)} · {i + 1} / {steps.length}
          </span>
          <button type="button" className="mini-btn" title={tr('튜토리얼 끝내기', 'End tutorial')} onClick={() => finish(false)}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        {step.task && (
          <div className={`tour-task ${doneFlash ? 'done' : ''}`}>
            {doneFlash ? <Icon name="check" size={14} /> : <span className="tour-dot" />}
            <span>{doneFlash ? tr('잘했어요!', 'Nice!') : step.task}</span>
          </div>
        )}
        <div className="tour-bar" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        <div className="tour-foot">
          {i > 0 && (
            <button type="button" className="btn small" onClick={() => setI(i - 1)}>
              {tr('이전', 'Back')}
            </button>
          )}
          <span className="grow" />
          {last ? (
            <>
              <button type="button" className="btn small" onClick={() => finish(true)} title={tr('튜토리얼에서 만든 차트를 그대로 둡니다', 'Keep the tutorial chart')}>
                {tr('이 차트 계속 쓰기', 'Keep this chart')}
              </button>
              <button type="button" className="btn small primary" onClick={() => finish(false)}>
                {tr('끝내기', 'Finish')}
              </button>
            </>
          ) : (
            <button type="button" className={`btn small ${step.task ? '' : 'primary'}`} onClick={() => setI(i + 1)}>
              {step.task ? tr('건너뛰기', 'Skip') : tr('다음', 'Next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 스크롤되는 영역 안의 요소는 그 영역에서 실제로 보이는 부분만 */
function visibleRect(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  let x1 = r.left;
  let y1 = r.top;
  let x2 = r.right;
  let y2 = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
    const q = p.getBoundingClientRect();
    x1 = Math.max(x1, q.left);
    y1 = Math.max(y1, q.top);
    x2 = Math.min(x2, q.right);
    y2 = Math.min(y2, q.bottom);
  }
  return x2 - x1 > 4 && y2 - y1 > 4 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

function clipBox(b: Box, vw: number, vh: number): Box | null {
  const x = Math.max(2, b.x);
  const y = Math.max(2, b.y);
  const w = Math.min(vw - 2, b.x + b.w) - x;
  const h = Math.min(vh - 2, b.y + b.h) - y;
  return w > 4 && h > 4 ? { x, y, w, h } : null;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}
