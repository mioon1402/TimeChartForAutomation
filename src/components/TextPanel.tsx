import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { parseDsl, serializeDsl } from '../io/dsl';
import { exportWaveDrom, importWaveDrom } from '../io/wavedrom';
import { ChartSvg } from '../render/ChartSvg';
import { downloadText, openTextFile, safeFileName } from '../io/files';
import { Icon, TimeInput } from './ui';
import { tr } from '../i18n';
import { WEB_TRIAL } from '../env';
import type { Project } from '../model/types';

type Mode = 'dsl' | 'wavedrom';

export function TextPanel() {
  const project = useStore((s) => s.project);
  const { commit, toast, setTab } = useStore.getState();
  const [mode, setMode] = useState<Mode>('dsl');
  const [tick, setTick] = useState<number>(project.settings.grid);
  const [text, setText] = useState(() => serializeDsl(project));
  const [dirty, setDirty] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const regenerate = (m: Mode = mode) => {
    if (m === 'dsl') setText(serializeDsl(useStore.getState().project));
    else {
      const r = exportWaveDrom(useStore.getState().project, tick);
      setText(r.source);
      r.warnings.forEach((w) => toast(w, 'warn'));
    }
    setDirty(false);
  };

  // 차트가 바뀌었고 사용자가 텍스트를 수정 중이 아니면 자동 동기화
  useEffect(() => {
    if (!dirty) regenerate();
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo((): { project: Project | null; errors: { line: number; message: string }[] } => {
    if (mode === 'dsl') {
      const r = parseDsl(text, project);
      return { project: r.project, errors: r.errors };
    }
    try {
      const r = importWaveDrom(text, tick);
      return { project: r.project, errors: r.warnings.map((w) => ({ line: 0, message: w })) };
    } catch (e) {
      const m = /줄 (\d+)/.exec((e as Error).message);
      return { project: null, errors: [{ line: m ? Number(m[1]) : 0, message: (e as Error).message }] };
    }
  }, [text, mode, tick, project]);

  const apply = () => {
    if (!parsed.project) return;
    const cur = useStore.getState().project;
    const next: Project = mode === 'dsl' ? { ...parsed.project, plc: cur.plc, revisions: cur.revisions } : { ...parsed.project, id: cur.id, meta: { ...cur.meta, title: parsed.project.meta.title || cur.meta.title }, plc: cur.plc, revisions: cur.revisions };
    commit(next);
    setDirty(false);
    setTimeout(() => useStore.getState().fitZoom(), 0);
    toast(tr('차트에 적용했습니다', 'Applied to chart'), 'ok');
  };

  const lines = text.split('\n').length;
  const errLines = new Set(parsed.errors.map((e) => e.line));
  const fatal = mode === 'wavedrom' ? !parsed.project : parsed.errors.length > 0;

  return (
    <div className="textpanel">
      <div className="text-left">
        <div className="plc-head">
          <div className="seg">
            <button type="button" className={mode === 'dsl' ? 'on' : ''} onClick={() => (setMode('dsl'), regenerate('dsl'))}>
              {tr('TCT 텍스트', 'TCT text')}
            </button>
            <button type="button" className={mode === 'wavedrom' ? 'on' : ''} onClick={() => (setMode('wavedrom'), regenerate('wavedrom'))}>
              WaveDrom JSON
            </button>
          </div>
          {mode === 'wavedrom' && (
            <label className="inline-field">
              {tr('틱 =', 'Tick =')} <TimeInput value={tick} onChange={(v) => v && setTick(v)} />
            </label>
          )}
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => regenerate()} title={tr('현재 차트에서 텍스트를 다시 생성', 'Regenerate from chart')}>
            <Icon name="undo" size={14} /> {tr('차트에서 생성', 'From chart')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              const f = await openTextFile(mode === 'dsl' ? '.tct,.txt' : '.json,.json5,.js,.txt');
              if (f) {
                setText(f.text);
                setDirty(true);
              }
            }}
          >
            <Icon name="open" size={14} /> {tr('열기', 'Open')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                toast(tr('복사했습니다', 'Copied'), 'ok');
              } catch {
                taRef.current?.select();
                toast(tr('클립보드가 막혀 있어 텍스트를 선택해 두었습니다. Ctrl+C 로 복사하세요.', 'Clipboard blocked; text selected, press Ctrl+C.'), 'warn');
              }
            }}
          >
            <Icon name="copy" size={14} /> {tr('복사', 'Copy')}
          </button>
          {!WEB_TRIAL && (
            <button type="button" className="btn small" onClick={() => downloadText(`${safeFileName(project.meta.title)}.${mode === 'dsl' ? 'tct' : 'json'}`, text)}>
              <Icon name="download" size={14} /> {tr('저장', 'Save')}
            </button>
          )}
          <button type="button" className="btn primary small" onClick={apply} disabled={fatal}>
            <Icon name="check" size={14} /> {tr('차트에 적용', 'Apply')}
          </button>
        </div>
        <div className="code">
          <div className="gutter" ref={gutterRef}>
            {Array.from({ length: lines }, (_, i) => (
              <div key={i} className={errLines.has(i + 1) ? 'err' : ''}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={taRef}
            className="code-ta"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
            }}
          />
        </div>
        <div className="msgs">
          {parsed.errors.length === 0 ? (
            <span className="status ok">OK</span>
          ) : (
            parsed.errors.slice(0, 30).map((e, i) => (
              <div key={i} className={`msg ${mode === 'wavedrom' && parsed.project ? 'warning' : 'error'}`}>
                {e.line > 0 && <b>{tr('줄', 'Line')} {e.line}</b>} {e.message}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="plc-head">
          <h3>{tr('미리보기', 'Preview')}</h3>
          <span className="grow" />
          {dirty && <span className="chip warn">{tr('적용 안 됨', 'Not applied')}</span>}
          <button type="button" className="btn small" onClick={() => setTab('editor')}>
            {tr('편집기로', 'To editor')}
          </button>
        </div>
        <div className="preview">{parsed.project && parsed.project.signals.length > 0 ? <ChartSvg project={parsed.project} width={900} idp="pv" /> : <p className="muted">{tr('표시할 신호가 없습니다', 'Nothing to preview')}</p>}</div>
        {mode === 'dsl' && <DslHelp />}
      </div>
    </div>
  );
}

function DslHelp() {
  return (
    <details className="dsl-help">
      <summary>{tr('TCT 텍스트 문법', 'TCT syntax')}</summary>
      <pre>{`title: 제목            duration: 3s        grid: 50ms
group 클램프
sig Y0 "클램프 SOL" output : 0 | 300 1 | 2400 0
sig - "실린더" actuator on=전진 off=후진 : 0 | 300 1~300 | 2.4s 0~300
sig D0 "스텝" bus data : 0 | 300 10 | 600 "STEP 20"
sig P1 "압력" analog min=0 max=10 unit=bar : 0 | 500 6 | 1s 6
sig CLK "클럭" clock period=100 duty=0.5
step "S10 클램프" 300..600 "설명"
arrow X0@250 -> Y0@300 "시작"      (~> 는 점선)
dim CYL1 300..600 "300ms"         note Y0@500 "메모"
marker 2800 "완료" color=#16a34a
rule delay Y0 rise -> X1 rise max=400 "응답"
rule exclusive X1 X2 "인터록"     rule pulse X0 1 min=100 "폭"
rule cycle max=3s "목표"`}</pre>
    </details>
  );
}
