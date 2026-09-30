import { useEffect, useState } from 'react';
import { useStore, selectedSignalIds, type Tab, type Tool } from '../store/store';
import { formatTime } from '../model/format';
import { Icon, IconButton, Menu, Modal } from './ui';
import * as F from './fileActions';
import { tr } from '../i18n';
import { GUIDE_URL, ISSUES_URL, OFFLINE_FILE, REPO_URL, servedFromWeb, WEB_TRIAL } from '../env';
import { templates } from '../model/templates';
import { tourTitle, type TourId } from './Tour';

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const title = useStore((s) => s.project.meta.title);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const { undo, redo, setLang, setTheme, setMeta, setWizard, setTour, setPracticePicker } = useStore.getState();
  const hasSequence = useStore((s) => !!s.project.sequence);
  const [editing, setEditing] = useState(false);

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'editor', icon: 'chart', label: tr('타임차트', 'Chart') },
    { id: 'plc', icon: 'cpu', label: tr('PLC 시뮬레이션', 'PLC simulation') },
    { id: 'text', icon: 'code', label: tr('텍스트 코드', 'Text code') },
    { id: 'report', icon: 'report', label: tr('보고서', 'Report') },
  ];

  return (
    <header className="topbar">
      <div className="brand" title="TimeChart Studio">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#2563eb" />
          <path d="M5 21h5v-9h6v9h4v-6l3-3h4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className="brand-name">
          TimeChart <b>Studio</b>
        </span>
        {WEB_TRIAL && (
          <span className="trial-badge" title={tr('인쇄·파일 저장·내보내기는 파일 버전(TimeChartStudio.html)에서 됩니다', 'Print, save and export work in the file version')}>
            {tr('온라인 체험판', 'Online trial')}
          </span>
        )}
      </div>
      <nav className="menus">
        <Menu
          label={tr('파일', 'File')}
          tour="menu-file"
          items={[
            { label: tr('새 차트: 순서대로 만들기…', 'New chart: step by step…'), icon: 'wand', onClick: () => setWizard('new') },
            { label: tr('새 차트: 빈 차트', 'New chart: blank'), icon: 'plus', onClick: F.newProject },
            ...(hasSequence ? [{ label: tr('동작 순서 고치기…', 'Edit sequence…'), icon: 'step', onClick: () => setWizard('edit') }] : []),
            { label: tr('열기…', 'Open…'), icon: 'open', shortcut: 'Ctrl+O', onClick: F.openProject },
            ...(WEB_TRIAL
              ? []
              : [
                  { label: tr('저장', 'Save'), icon: 'save', shortcut: 'Ctrl+S', onClick: () => F.saveProject() },
                  { label: tr('다른 이름으로 저장…', 'Save as…'), shortcut: 'Ctrl+Shift+S', onClick: () => F.saveProject(true) },
                ]),
            { divider: true },
            ...templates().map((t) => ({ label: tr('템플릿: ', 'Template: ') + t.name, icon: 'chart', onClick: () => F.loadTemplate(t.id) })),
            { label: tr('예제: PLC 프로그램 → 차트', 'Example: PLC program → chart'), icon: 'cpu', onClick: () => setTab('plc') },
            ...(WEB_TRIAL ? [] : [{ divider: true }, { label: tr('보고서 인쇄 / PDF', 'Print report / PDF'), icon: 'print', shortcut: 'Ctrl+P', onClick: F.printReport }]),
          ]}
        />
        <Menu
          label={tr('배우기', 'Learn')}
          tour="menu-learn"
          items={[
            { label: tr('튜토리얼: 차트 그리기 기초', 'Tutorial: chart basics'), icon: 'play', onClick: () => setTour('basic') },
            { label: tr('튜토리얼: PLC 프로그램으로 차트 만들기', 'Tutorial: chart from a PLC program'), icon: 'play', onClick: () => setTour('plc') },
            { divider: true },
            { label: tr('연습 문제: 직접 그리고 채점받기…', 'Practice: draw and get graded…'), icon: 'ruleCheck', onClick: () => setPracticePicker(true) },
            { label: tr('순서대로 새 차트 만들기 (실무 작성 순서)…', 'New chart step by step…'), icon: 'wand', onClick: () => setWizard('new') },
          ]}
        />
        <Menu
          label={tr('가져오기', 'Import')}
          items={[
            { label: tr('PLC 프로그램 (미쓰비시 · LS · 지멘스 · ST)', 'PLC program (Mitsubishi · LS · Siemens · ST)'), icon: 'cpu', onClick: () => setTab('plc') },
            { label: tr('CSV 로그 / 트렌드 데이터…', 'CSV log / trend data…'), icon: 'table', onClick: () => F.importFile('.csv,.tsv,.txt') },
            { label: tr('WaveDrom JSON…', 'WaveDrom JSON…'), icon: 'code', onClick: () => F.importFile('.json,.json5,.js,.txt') },
            { label: tr('TCT 텍스트…', 'TCT text…'), icon: 'code', onClick: () => F.importFile('.tct,.txt') },
          ]}
        />
        <Menu
          label={tr('내보내기', 'Export')}
          items={WEB_TRIAL ? [
            { label: tr('TCT 텍스트 복사 (파일 버전으로 옮기기)', 'Copy TCT text (move to file version)'), icon: 'copy', onClick: F.copyTct },
            { label: tr('차트 이미지 복사 (클립보드)', 'Copy chart image'), icon: 'image', onClick: F.copyPng },
            { divider: true },
            { label: tr('인쇄·PDF·파일 저장은 파일 버전에서', 'Print, PDF and files: use the file version'), icon: 'help', disabled: true },
          ] : [
            { label: tr('보고서 인쇄 / PDF', 'Print report / PDF'), icon: 'print', onClick: () => setTab('report') },
            { divider: true },
            { label: tr('PNG 이미지', 'PNG image'), icon: 'image', onClick: F.exportPng },
            { label: tr('이미지 복사 (클립보드)', 'Copy image to clipboard'), icon: 'copy', onClick: F.copyPng },
            { label: tr('SVG 벡터 (Visio, 일러스트레이터)', 'SVG vector'), icon: 'image', onClick: F.exportSvg },
            { divider: true },
            { label: tr('엑셀 CSV - 변화 시점표', 'Excel CSV - change table'), icon: 'table', onClick: () => F.exportCsv('changes') },
            { label: tr('엑셀 CSV - 신호(I/O) 목록', 'Excel CSV - signal list'), icon: 'table', onClick: () => F.exportCsv('signals') },
            { label: tr('엑셀 CSV - 공정 스텝표', 'Excel CSV - step table'), icon: 'table', onClick: () => F.exportCsv('steps') },
            { divider: true },
            { label: 'WaveDrom JSON', icon: 'code', onClick: F.exportWaveDromFile },
            { label: tr('TCT 텍스트', 'TCT text'), icon: 'code', onClick: F.exportTct },
            { label: tr('TCT 텍스트 복사', 'Copy TCT text'), icon: 'copy', onClick: F.copyTct },
          ]}
        />
      </nav>
      <div className="doc-title">
        {editing ? (
          <input
            className="input"
            autoFocus
            defaultValue={title}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== title) setMeta({ title: e.target.value });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button type="button" className="title-btn" onClick={() => setEditing(true)} title={tr('제목 편집', 'Edit title')}>
            {title}
            {dirty && <span className="dirty-dot" title={tr('저장 안 됨 (자동 백업은 됨)', 'Unsaved (auto-backup on)')} />}
          </button>
        )}
      </div>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button type="button" role="tab" aria-selected={tab === t.id} key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-tour={`tab-${t.id}`}>
            <Icon name={t.icon} size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="top-right">
        <IconButton icon="undo" title={tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')} onClick={undo} disabled={!canUndo} tour="undo" />
        <IconButton icon="redo" title={tr('다시 실행 (Ctrl+Y)', 'Redo (Ctrl+Y)')} onClick={redo} disabled={!canRedo} />
        {!WEB_TRIAL && <IconButton icon="save" title={tr('저장 (Ctrl+S)', 'Save (Ctrl+S)')} onClick={() => F.saveProject()} />}
        <IconButton icon="globe" title="한국어 / English" label={lang === 'ko' ? 'EN' : '한'} onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} />
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} title={tr('테마 전환', 'Toggle theme')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <IconButton icon="help" title={tr('도움말 · 단축키', 'Help & shortcuts')} onClick={onHelp} />
      </div>
    </header>
  );
}

export const TOOLS: { id: Tool; icon: string; key: string; ko: string; en: string }[] = [
  { id: 'select', icon: 'select', key: 'V', ko: '선택 · 에지 이동', en: 'Select / move edges' },
  { id: 'draw', icon: 'pen', key: 'D', ko: '파형 그리기 (드래그: 반전, Shift: ON, Alt: OFF)', en: 'Draw (drag toggles; Shift=ON, Alt=OFF)' },
  { id: 'arrow', icon: 'arrow', key: 'A', ko: '인과/인터록 화살표 (에지→에지 드래그)', en: 'Cause→effect arrow' },
  { id: 'dimension', icon: 'dimension', key: 'M', ko: '시간 치수선 (드래그)', en: 'Time dimension' },
  { id: 'step', icon: 'step', key: 'S', ko: '공정 스텝 구간 (드래그)', en: 'Process step' },
  { id: 'note', icon: 'note', key: 'N', ko: '메모', en: 'Note' },
  { id: 'marker', icon: 'marker', key: 'K', ko: '마커 (세로선)', en: 'Marker' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const snap = useStore((s) => s.snap);
  const showProps = useStore((s) => s.showProps);
  const grid = useStore((s) => s.project.settings.grid);
  const { setTool, setZoom, fitZoom, setSnap, addSignal, addStep, toggleProps, selection, project } = useStore.getState();
  const addKind = (kind: 'bit' | 'bus' | 'analog' | 'clock') => {
    const ids = selectedSignalIds(useStore.getState().selection);
    let idx: number | undefined;
    if (ids.length) idx = project.signals.findIndex((s) => s.id === ids[ids.length - 1]) + 1;
    addSignal(
      kind === 'bus'
        ? { kind, role: 'data', points: [{ t: 0, v: '0' }], name: tr('데이터', 'Data') }
        : kind === 'analog'
          ? { kind, role: 'data', points: [{ t: 0, v: 0 }], analogMin: 0, analogMax: 10, heightScale: 1.6, name: tr('아날로그', 'Analog') }
          : kind === 'clock'
            ? { kind, clockPeriod: grid * 2, clockDuty: 0.5, name: 'CLK' }
            : {},
      idx,
    );
  };
  void selection;
  return (
    <div className="toolbar">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <IconButton key={t.id} icon={t.icon} title={`${tr(t.ko, t.en)} (${t.key})`} active={tool === t.id} onClick={() => setTool(t.id)} tour={`tool-${t.id}`} />
        ))}
      </div>
      <div className="sep" />
      <div className="tool-group">
        <IconButton icon="plus" label={tr('신호', 'Signal')} title={tr('비트 신호 추가', 'Add bit signal')} onClick={() => addKind('bit')} tour="add-signal" />
        <Menu
          label="▾"
          items={[
            { label: tr('비트 (ON/OFF)', 'Bit (ON/OFF)'), onClick: () => addKind('bit') },
            { label: tr('워드 / 데이터 값', 'Word / data'), onClick: () => addKind('bus') },
            { label: tr('아날로그', 'Analog'), onClick: () => addKind('analog') },
            { label: tr('클럭', 'Clock'), onClick: () => addKind('clock') },
            { divider: true },
            { label: tr('실린더 (동작 시간 경사)', 'Cylinder (sloped motion)'), onClick: () => addSignal({ name: tr('실린더', 'Cylinder'), role: 'actuator', color: '#ea580c', onLabel: tr('전진', 'ADV'), offLabel: tr('후진', 'RET'), defaultRamp: grid * 4 }) },
          ]}
        />
        <IconButton icon="step" label={tr('스텝', 'Step')} title={tr('공정 스텝 추가', 'Add step')} onClick={() => addStep()} />
      </div>
      <div className="sep" />
      <div className="tool-group">
        <IconButton icon="zoomOut" title={tr('축소 (-)', 'Zoom out (-)')} onClick={() => setZoom(zoom / 1.4)} />
        <span className="zoom-label" title={tr('1픽셀당 시간', 'time per pixel')}>
          {formatTime(1 / zoom, 'auto').replace(' ', '')}/px
        </span>
        <IconButton icon="zoomIn" title={tr('확대 (+)', 'Zoom in (+)')} onClick={() => setZoom(zoom * 1.4)} />
        <IconButton icon="fit" title={tr('화면에 맞춤 (0)', 'Fit (0)')} onClick={fitZoom} />
        <IconButton icon="magnet" title={tr('그리드 · 에지 스냅 (G)', 'Snap to grid & edges (G)')} active={snap} onClick={() => setSnap(!snap)} />
      </div>
      <span className="grow" />
      <div className="tool-group">
        {!WEB_TRIAL && <IconButton icon="image" title={tr('PNG 내보내기', 'Export PNG')} onClick={F.exportPng} />}
        <IconButton icon="print" title={tr('보고서', 'Report')} onClick={() => useStore.getState().setTab('report')} />
        <IconButton icon="panel" title={tr('속성 패널', 'Properties panel')} active={showProps} onClick={toggleProps} />
      </div>
    </div>
  );
}

export function StatusBar() {
  const hoverT = useStore((s) => s.hoverT);
  const a = useStore((s) => s.cursorA);
  const b = useStore((s) => s.cursorB);
  const range = useStore((s) => s.range);
  const unit = useStore((s) => s.project.settings.timeUnit);
  const n = useStore((s) => s.project.signals.length);
  const dur = useStore((s) => s.project.settings.duration);
  const tool = useStore((s) => s.tool);
  const fileName = useStore((s) => s.fileName);
  const t = TOOLS.find((x) => x.id === tool);
  return (
    <footer className="statusbar">
      <span>{t ? tr(t.ko, t.en) : ''}</span>
      <span className="sep-dot" />
      <span>t = {hoverT === null ? '-' : formatTime(hoverT, unit)}</span>
      {a !== null && <span className="cur-a">A {formatTime(a, unit)}</span>}
      {b !== null && <span className="cur-b">B {formatTime(b, unit)}</span>}
      {a !== null && b !== null && <b>Δ {formatTime(b - a, unit)}</b>}
      {range && (
        <span>
          {tr('선택 구간', 'Range')} {formatTime(range.t0, unit)} ~ {formatTime(range.t1, unit)} (<b>{formatTime(range.t1 - range.t0, unit)}</b>)
        </span>
      )}
      <span className="grow" />
      <span>
        {n} {tr('신호', 'signals')} · {formatTime(dur, unit)}
      </span>
      <span className="muted">{fileName || tr('자동 백업됨', 'auto-saved')}</span>
    </footer>
  );
}

/** 도움말·시작 화면 공통: 설명서, 문제 신고, 오프라인 파일 */
function PublicLinks() {
  return (
    <div className="public-links">
      <a className="btn small" href={GUIDE_URL} target="_blank" rel="noreferrer">
        <Icon name="report" size={14} /> {tr('사용 설명서', 'User guide')}
      </a>
      <a className="btn small" href={ISSUES_URL} target="_blank" rel="noreferrer">
        <Icon name="warn" size={14} /> {tr('문제 신고 · 기능 제안', 'Report a problem / suggest')}
      </a>
      {servedFromWeb() && (
        <a className="btn small" href={OFFLINE_FILE} download={OFFLINE_FILE} title={tr('인터넷이 없는 PC(공장, 사내망)에서 쓰는 파일 버전. 받은 파일을 더블클릭하면 열립니다.', 'File version for offline PCs. Double-click the downloaded file to open it.')}>
          <Icon name="download" size={14} /> {tr('오프라인 버전 받기', 'Download offline version')}
        </a>
      )}
      <a className="btn small" href={REPO_URL} target="_blank" rel="noreferrer">
        <Icon name="code" size={14} /> {tr('소스 코드', 'Source code')}
      </a>
    </div>
  );
}

/** 튜토리얼 시작 버튼 두 개 + 연습 문제 */
function TourButtons({ onTour, primary }: { onTour: (id: TourId) => void; primary?: boolean }) {
  return (
    <>
      {(['basic', 'plc'] as TourId[]).map((id, k) => (
        <button type="button" key={id} className={`btn small ${primary && k === 0 ? 'primary' : ''}`} onClick={() => onTour(id)}>
          <Icon name="play" size={14} /> {tourTitle(id)}
        </button>
      ))}
      <button type="button" className="btn small" onClick={() => useStore.getState().setPracticePicker(true)}>
        <Icon name="ruleCheck" size={14} /> {tr('연습 문제', 'Practice')}
      </button>
    </>
  );
}

/** 처음 방문한 사람을 위한 시작 화면 */
export function WelcomeModal({ onClose, onTour }: { onClose: () => void; onTour: (id: TourId) => void }) {
  const setTab = useStore((s) => s.setTab);
  const lang = useStore((s) => s.lang);
  const choices: { icon: string; title: string; desc: string; go: () => void }[] = [
    {
      icon: 'chart',
      title: tr('예제 차트 둘러보기', 'Explore the example chart'),
      desc: tr('드릴 가공 설비의 타임차트가 열려 있습니다. 파형 에지를 끌어서 고쳐 보세요.', 'A drilling machine chart is open. Drag an edge to change it.'),
      go: () => setTab('editor'),
    },
    {
      icon: 'cpu',
      title: tr('PLC 프로그램으로 만들기', 'Generate from a PLC program'),
      desc: tr('XG5000 니모닉 인쇄 PDF, GX Works CSV, 지멘스 STL, ST 코드를 열면 시뮬레이션해서 차트를 자동으로 그립니다.', 'Open an XG5000 IL PDF, GX Works CSV, Siemens STL or ST code and simulate it into a chart.'),
      go: () => setTab('plc'),
    },
    {
      icon: 'wand',
      title: tr('순서대로 새로 만들기', 'Build one step by step'),
      desc: tr('설비 → 동작 기기 → I/O → 동작 순서를 차례로 적으면 타임차트를 그려 줍니다. 실무에서 만드는 순서 그대로입니다.', 'Enter machine, devices, I/O and sequence in order and the chart is drawn for you, the way it is done in practice.'),
      go: () => useStore.getState().setWizard('new'),
    },
  ];
  return (
    <Modal title="TimeChart Studio" onClose={onClose} width={680}>
      <div className="welcome">
        <p className="welcome-lead">
          {tr('자동화 설비의 타임차트를 그리고, PLC 프로그램으로 자동 생성하고, 보고서로 출력하는 도구입니다. 설치나 회원가입 없이 바로 쓸 수 있습니다.', 'Draw timing charts for automated machines, generate them from PLC programs, and print reports. No install or sign-up.')}
        </p>
        <div className="welcome-tour">
          <div>
            <b>{tr('처음이세요? 따라 하기 튜토리얼 · 연습 문제', 'New here? Tutorials and practice')}</b>
            <span>{tr('튜토리얼은 버튼을 하나씩 짚어 알려 주고(각 3분), 연습 문제는 직접 그려 보고 채점받습니다.', 'Tutorials point at each button (3 min each); practice lets you draw and get graded.')}</span>
          </div>
          <div className="welcome-tour-btns">
            <TourButtons
              primary
              onTour={(id) => {
                onClose();
                onTour(id);
              }}
            />
          </div>
        </div>
        <div className="welcome-choices">
          {choices.map((c) => (
            <button
              type="button"
              key={c.title}
              className="welcome-choice"
              onClick={() => {
                c.go();
                onClose();
              }}
            >
              <Icon name={c.icon} size={20} />
              <b>{c.title}</b>
              <span>{c.desc}</span>
            </button>
          ))}
        </div>
        <p className="welcome-phone">{tr('휴대폰에서는 차트 보기와 간단한 수정에 알맞습니다. 편집과 보고서 출력은 PC가 편합니다.', 'On a phone, use it for viewing and small edits. Editing and printing are easier on a PC.')}</p>
        <p className="welcome-privacy">
          {tr('여는 파일(PLC 프로그램, 차트)은 서버로 보내지 않습니다. 모든 계산은 이 브라우저 안에서만 하고, 작업 내용은 이 브라우저에 자동 백업됩니다.', 'Files you open are never uploaded. Everything runs in this browser, and your work is auto-saved here.')}
        </p>
        <div className="welcome-foot">
          <PublicLinks />
          <button type="button" className="btn small" onClick={() => useStore.getState().setLang(lang === 'ko' ? 'en' : 'ko')}>
            <Icon name="globe" size={14} /> {lang === 'ko' ? 'English' : '한국어'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function HelpModal({ onClose, onWelcome, onTour }: { onClose: () => void; onWelcome: () => void; onTour: (id: TourId) => void }) {
  const keys: [string, string][] = [
    ['V / D / A / M / S / N / K', tr('선택 / 그리기 / 화살표 / 치수 / 스텝 / 메모 / 마커 도구', 'Tools: select, draw, arrow, dimension, step, note, marker')],
    ['Ctrl+Z, Ctrl+Y', tr('실행 취소, 다시 실행', 'Undo, redo')],
    ['Ctrl+S, Ctrl+O', tr('저장, 열기', 'Save, open')],
    ['Ctrl+P', tr('보고서 인쇄 / PDF', 'Print report / PDF')],
    ['Ctrl+D', tr('선택 신호 복제', 'Duplicate signals')],
    ['Delete', tr('선택 항목 삭제', 'Delete selection')],
    ['Alt+↑ / Alt+↓', tr('선택 신호 위/아래로 이동', 'Move signal up/down')],
    ['Ctrl+A', tr('모든 신호 선택', 'Select all signals')],
    ['+ / - / 0', tr('확대 / 축소 / 화면 맞춤 (Ctrl+휠: 마우스 위치 확대)', 'Zoom in/out/fit (Ctrl+wheel)')],
    ['G', tr('스냅 켜기/끄기', 'Toggle snap')],
    ['Esc', tr('선택 해제 · 선택 도구', 'Clear selection')],
    [tr('더블클릭', 'Double-click'), tr('파형 구간 반전 / 값 편집 / 이름 변경', 'Toggle segment / edit value / rename')],
    [tr('우클릭', 'Right-click'), tr('신호·구간 메뉴 (시간 삽입/삭제, 스텝 생성 등)', 'Context menu (insert/delete time, steps…)')],
    [tr('눈금자 클릭', 'Ruler click'), tr('커서 A, Shift+클릭 커서 B (Δt 측정)', 'Cursor A, Shift = cursor B')],
  ];
  return (
    <Modal title={tr('TimeChart Studio 도움말', 'TimeChart Studio help')} onClose={onClose} width={720}>
      <div className="help">
        <div className="help-top">
          <PublicLinks />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              onClose();
              onWelcome();
            }}
          >
            <Icon name="play" size={14} /> {tr('시작 화면', 'Start screen')}
          </button>
        </div>
        <h4>{tr('따라 하기 튜토리얼', 'Tutorials')}</h4>
        <div className="help-tours">
          <TourButtons
            onTour={(id) => {
              onClose();
              onTour(id);
            }}
          />
        </div>
        <h4>{tr('주요 기능', 'Features')}</h4>
        <ul>
          <li>{tr('PLC 프로그램(미쓰비시 GX Works 니모닉/CSV, LS XG5000, 지멘스 STL, IEC ST/SCL)을 불러와 스캔 시뮬레이션으로 타임차트 자동 생성', 'Generate charts from PLC programs (Mitsubishi, LS, Siemens STL, IEC ST) by scan simulation')}</li>
          <li>{tr('실린더/지연 설비 모델로 센서 응답을 자동 생성 → 전체 사이클 타임 산출', 'Equipment models auto-respond to outputs for full cycle-time simulation')}</li>
          <li>{tr('마우스로 파형 그리기, 에지 드래그, 실린더 동작 경사, 인과 화살표, 치수선, 공정 스텝', 'Draw waveforms, drag edges, sloped actuator motion, arrows, dimensions, steps')}</li>
          <li>{tr('타이밍 규칙 검증: 응답 시간, 인터록(동시 ON 금지), 펄스 폭, 목표 사이클 타임', 'Rule checks: response time, interlock, pulse width, cycle target')}</li>
          <li>{tr('표제란이 있는 보고서 인쇄/PDF, PNG·SVG, 엑셀 CSV, WaveDrom, 텍스트 코드', 'Reports with title block (PDF), PNG/SVG, Excel CSV, WaveDrom, text code')}</li>
          <li>{tr('설치 없이 오프라인 단일 HTML 파일로 실행, 작업 내용 자동 백업', 'Runs offline as a single HTML file, auto-backup')}</li>
        </ul>
        <h4>{tr('단축키 · 조작', 'Shortcuts')}</h4>
        <table className="tbl compact">
          <tbody>
            {keys.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** 전역 단축키 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        F.saveProject(e.shiftKey);
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        F.openProject();
        return;
      }
      if (mod && k === 'p') {
        e.preventDefault();
        F.printReport();
        return;
      }
      if (typing) return;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (s.tab !== 'editor') return;
      const ids = selectedSignalIds(s.selection);
      if (mod && k === 'd') {
        e.preventDefault();
        if (ids.length) s.duplicateSignals(ids);
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        s.select({ type: 'signals', ids: s.project.signals.map((x) => x.id) });
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && ids.length === 1) {
        e.preventDefault();
        const i = s.project.signals.findIndex((x) => x.id === ids[0]);
        s.moveSignal(ids[0], i + (e.key === 'ArrowUp' ? -1 : 1));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = s.selection;
        if (!sel) return;
        e.preventDefault();
        if (sel.type === 'signals') s.removeSignals(sel.ids);
        else if (sel.type === 'annotation') s.removeAnnotation(sel.id);
        else if (sel.type === 'step') s.removeStep(sel.id);
        else if (sel.type === 'rule') s.removeRule(sel.id);
        return;
      }
      if (e.key === 'Escape') {
        s.select(null);
        s.setRange(null);
        s.setTool('select');
        return;
      }
      if (mod || e.altKey) return;
      const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (tool) {
        s.setTool(tool.id);
        return;
      }
      if (e.key === '+' || e.key === '=') s.setZoom(s.zoom * 1.4);
      else if (e.key === '-') s.setZoom(s.zoom / 1.4);
      else if (e.key === '0') s.fitZoom();
      else if (k === 'g') s.setSnap(!s.snap);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
