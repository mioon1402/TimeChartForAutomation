import { useEffect, useState } from 'react';
import { hasAutosave, useStore } from './store/store';
import { ChartEditor } from './components/ChartEditor';
import { PropertiesPanel } from './components/PropertiesPanel';
import { BottomPanel } from './components/BottomPanel';
import { PlcPanel } from './components/PlcPanel';
import { TextPanel } from './components/TextPanel';
import { ReportPanel } from './components/ReportPanel';
import { HelpModal, StatusBar, Toolbar, TopBar, useShortcuts, WelcomeModal } from './components/Shell';
import { Tour } from './components/Tour';
import { SequenceWizard } from './components/SequenceWizard';
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
  const wizard = useStore((s) => s.wizard);
  useStore((s) => s.lang); // 언어 변경 시 전체 다시 렌더링
  const [help, setHelp] = useState(false);
  // 처음 방문(이전 작업 없음)이면 시작 화면
  const [welcome, setWelcome] = useState(() => !storageGet(WELCOME_KEY) && !hasAutosave());
  const tour = useStore((s) => s.tour);
  const picker = useStore((s) => s.practicePicker);
  const { setTour } = useStore.getState();
  const closeWelcome = () => {
    storageSet(WELCOME_KEY, '1');
    setWelcome(false);
  };
  const [dropping, setDropping] = useState(false);
  useShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
      {tab === 'plc' && <PlcPanel />}
      {tab === 'text' && <TextPanel />}
      {tab === 'report' && <ReportPanel />}
      {help && <HelpModal onClose={() => setHelp(false)} onWelcome={() => setWelcome(true)} onTour={setTour} />}
      {welcome && !help && !tour && !picker && <WelcomeModal onClose={closeWelcome} onTour={setTour} />}
      {tour && <Tour key={tour} id={tour} onClose={() => setTour(null)} />}
      {wizard && <SequenceWizard mode={wizard} onClose={() => useStore.getState().setWizard(null)} />}
      {picker && <PracticePicker onClose={() => useStore.getState().setPracticePicker(false)} />}
      <PromptHost />
      <Toasts />
      {dropping && <div className="drop-overlay">{tr('파일을 놓으면 불러옵니다 (.tchart, .csv, .json, PLC 소스, IL 인쇄 PDF)', 'Drop to open (.tchart, .csv, .json, PLC source, IL PDF)')}</div>}
    </div>
  );
}
