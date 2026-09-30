import { useEffect, useState } from 'react';
import { hasAutosave, selectedSignalIds, useStore } from './store/store';
import { copySignalsText, pasteSignals } from './model/signalClipboard';
import { ChartEditor } from './components/ChartEditor';
import { PropertiesPanel } from './components/PropertiesPanel';
import { BottomPanel } from './components/BottomPanel';
import { PlcPanel } from './components/PlcPanel';
import { TextPanel } from './components/TextPanel';
import { ReportPanel } from './components/ReportPanel';
import { HelpModal, markWhatsNewSeen, StatusBar, Toolbar, TopBar, useShortcuts, WelcomeModal, WhatsNew, whatsNewPending } from './components/Shell';
import { Tour } from './components/Tour';
import { SequencePanel } from './components/SequencePanel';
import { SheetBar } from './components/SheetBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PracticePicker } from './components/Practice';
import { PromptHost, Toasts } from './components/ui';
import { loadFromText } from './components/fileActions';
import { readTextSmart } from './io/files';
import { readProgramFile } from './components/programFile';
import { tr } from './i18n';
import { WEB_TRIAL } from './env';
import { storageGet, storageSet } from './storage';

const WELCOME_KEY = 'timechart-studio.welcomed.v1';

export default function App() {
  const tab = useStore((s) => s.tab);
  const theme = useStore((s) => s.theme);
  const showProps = useStore((s) => s.showProps);
  useStore((s) => s.lang); // 언어 변경 시 전체 다시 렌더링
  const [help, setHelp] = useState(false);
  // 처음 방문(이전 작업 없음)이면 시작 화면
  const [welcome, setWelcome] = useState(() => !storageGet(WELCOME_KEY) && !hasAutosave());
  // 이전 버전을 쓰던 사람(작업 기록이 있음)에게 한 번만 새 기능 안내. 처음 온 사람은 시작 화면이 대신한다.
  const [whatsNew, setWhatsNew] = useState(() => whatsNewPending() && (!!storageGet(WELCOME_KEY) || hasAutosave()));
  const closeWhatsNew = () => {
    markWhatsNewSeen();
    setWhatsNew(false);
  };
  const tour = useStore((s) => s.tour);
  const picker = useStore((s) => s.practicePicker);
  const practice = useStore((s) => !!s.practice);
  const { setTour } = useStore.getState();
  const closeWelcome = () => {
    storageSet(WELCOME_KEY, '1');
    markWhatsNewSeen();
    setWelcome(false);
  };
  const [dropping, setDropping] = useState(false);
  useShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 소개 페이지에서 바로 가기: /app/#tutorial, #tutorial-plc, #practice, #wizard(동작 순서 탭), #plc
  useEffect(() => {
    const h = typeof location !== 'undefined' ? location.hash.replace('#', '') : '';
    const s = useStore.getState();
    if (h === 'tutorial') s.setTour('basic');
    else if (h === 'tutorial-plc') s.setTour('plc');
    else if (h === 'tutorial-sequence') s.setTour('sequence');
    else if (h === 'practice') s.setPracticePicker(true);
    else if (h === 'wizard' || h === 'sequence') s.setTab('sequence');
    else if (h === 'plc') s.setTab('plc');
    else return;
    storageSet(WELCOME_KEY, '1');
    setWelcome(false);
    setWhatsNew(false);
    markWhatsNewSeen();
    history.replaceState(null, '', location.pathname + location.search);
  }, []);

  // 차트 편집기: 고른 신호 복사·잘라내기·붙여넣기 (다른 차트 탭, 다른 창, 텍스트 탭과 주고받기)
  useEffect(() => {
    const typing = () => {
      const t = document.activeElement as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const copy = (e: ClipboardEvent, cut: boolean) => {
      const s = useStore.getState();
      if (s.tab !== 'editor' || typing() || document.querySelector('.modal-back')) return;
      const ids = selectedSignalIds(s.selection);
      if (!ids.length) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', copySignalsText(s.project, ids));
      if (cut) s.removeSignals(ids);
      s.toast(
        cut ? tr(`신호 ${ids.length}개를 잘라 냈습니다. 붙여 넣을 곳에서 Ctrl+V`, `Cut ${ids.length} signals`) : tr(`신호 ${ids.length}개를 복사했습니다. 다른 차트 탭에서도 Ctrl+V 로 붙여 넣을 수 있습니다`, `Copied ${ids.length} signals; paste with Ctrl+V in any chart`),
        'info',
      );
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      const s = useStore.getState();
      if (s.tab !== 'editor' || typing() || document.querySelector('.modal-back')) return;
      const ids = selectedSignalIds(s.selection);
      const r = pasteSignals(s.project, e.clipboardData?.getData('text/plain') ?? '', ids[ids.length - 1]);
      if (!r) return;
      e.preventDefault();
      s.commit(r.project);
      s.select({ type: 'signals', ids: r.ids });
      s.toast(tr(`신호 ${r.ids.length}개를 붙여 넣었습니다`, `Pasted ${r.ids.length} signals`), 'ok');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // 첫 화면: 차트를 화면 폭에 맞춤
  useEffect(() => {
    const h = setTimeout(() => useStore.getState().fitZoom(), 50);
    return () => clearTimeout(h);
  }, []);

  // 저장하지 않은 변경 경고
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <div
      className={`app tab-${tab} ${WEB_TRIAL ? 'web-trial' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDropping(false);
        const f = e.dataTransfer.files[0];
        if (!f) return;
        const r = /\.(tchart|json|tct|csv|tsv)$/i.test(f.name) ? { text: await readTextSmart(f) } : await readProgramFile(f);
        if (!r) return;
        const text = r.text;
        if (/\.(tchart|json|tct|csv|tsv)$/i.test(f.name)) loadFromText(f.name, text);
        else {
          // PLC 소스로 간주
          const { detectDialect } = await import('./plc/program');
          const dialect = /\.(st|scl)$/i.test(f.name) ? 'st' : detectDialect(text);
          const s = useStore.getState();
          const cur = s.project.plc;
          s.commit({ ...s.project, plc: { dialect, source: text, comments: cur?.comments ?? '', sim: cur?.sim ?? (await import('./plc/types')).defaultSimSettings() } });
          s.setTab('plc');
          s.toast(tr(`${f.name} 을(를) PLC 프로그램으로 불러왔습니다`, `Loaded ${f.name} as PLC program`), 'ok');
        }
      }}
    >
      <TopBar onHelp={() => setHelp(true)} />
      {!practice && <SheetBar />}
      <ErrorBoundary key={tab} area={{ editor: tr('타임차트', 'Chart'), sequence: tr('동작 순서', 'Sequence'), plc: 'PLC', text: tr('텍스트 코드', 'Text'), report: tr('보고서', 'Report') }[tab]}>
        {tab === 'editor' && (
          <>
            <Toolbar />
            <div className="workspace">
              <div className="main-col">
                <ChartEditor />
                <BottomPanel />
              </div>
              {showProps && <PropertiesPanel />}
            </div>
            <StatusBar />
          </>
        )}
        {tab === 'sequence' && <SequencePanel />}
        {tab === 'plc' && <PlcPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'report' && <ReportPanel />}
      </ErrorBoundary>
      {help && <HelpModal onClose={() => setHelp(false)} onWelcome={() => setWelcome(true)} onTour={setTour} />}
      {welcome && !help && !tour && !picker && <WelcomeModal onClose={closeWelcome} onTour={setTour} />}
      {whatsNew && !welcome && !help && !tour && !picker && <WhatsNew onClose={closeWhatsNew} />}
      {tour && <Tour key={tour} id={tour} onClose={() => setTour(null)} />}
      {picker && <PracticePicker onClose={() => useStore.getState().setPracticePicker(false)} />}
      <PromptHost />
      <Toasts />
      {dropping && <div className="drop-overlay">{tr('파일을 놓으면 불러옵니다 (.tchart, .csv, .json, PLC 소스, IL 인쇄 PDF)', 'Drop to open (.tchart, .csv, .json, PLC source, IL PDF)')}</div>}
    </div>
  );
}
