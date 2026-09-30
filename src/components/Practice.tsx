/**
 * 연습 문제: 문제 고르기 창, 아래 패널의 "연습 문제" 탭(문제·채점·힌트·정답·해설).
 * 시작할 때 지금 차트를 보관해 두고, 연습을 끝내면 되돌린다.
 */
import { useEffect, useMemo, useState } from 'react';
import { clearTutorialBackup, saveTutorialBackup, useStore } from '../store/store';
import { EXERCISES, exerciseById, levelName, practiceProject, type Exercise } from '../learn/exercises';
import { gradeChart } from '../learn/grade';
import type { Project } from '../model/types';
import { storageGet, storageSet } from '../storage';
import { tr } from '../i18n';
import { Icon, Modal } from './ui';

const PROGRESS_KEY = 'timechart-studio.practice.v1';

type Progress = Record<string, { best: number; total: number }>;

function loadProgress(): Progress {
  try {
    return JSON.parse(storageGet(PROGRESS_KEY) ?? '{}') as Progress;
  } catch {
    return {};
  }
}

function saveProgress(id: string, correct: number, total: number) {
  const p = loadProgress();
  if (!p[id] || correct > p[id].best) p[id] = { best: correct, total };
  storageSet(PROGRESS_KEY, JSON.stringify(p));
}

/** 연습 전 차트 (연습을 끝내면 되돌림) */
let backup: { project: Project; fileName: string; dirty: boolean; tab: ReturnType<typeof useStore.getState>['tab']; showProps: boolean } | null = null;

export function startPractice(id: string) {
  const ex = exerciseById(id);
  if (!ex) return;
  const s = useStore.getState();
  if (!s.practice) {
    backup = { project: s.project, fileName: s.fileName, dirty: s.dirty, tab: s.tab, showProps: s.showProps };
    saveTutorialBackup(s.project);
  }
  const built = ex.build();
  s.loadProject(practiceProject(built, ex));
  s.setPractice({ id, draw: built.draw, answer: built.answer, attempt: null, view: 'mine', result: null, hints: 0 });
  s.setTab('editor');
  s.setBottom('practice');
  s.setTool('draw');
  s.setSnap(true);
  s.setPracticePicker(false);
  // 그리기 칸을 넓게
  useStore.setState({ showProps: false });
}

export function endPractice() {
  const s = useStore.getState();
  clearTutorialBackup();
  if (backup) {
    s.loadProject(backup.project, backup.fileName);
    useStore.setState({ dirty: backup.dirty, showProps: backup.showProps });
    s.setTab(backup.tab);
  }
  backup = null;
  s.setPractice(null);
  s.setBottom('analysis');
  s.setTool('select');
}

function kindName(e: Exercise): string {
  return e.kind === 'plc' ? tr('PLC 읽기', 'Read PLC') : tr('설비 동작', 'Machine');
}

/** 문제 고르기 */
export function PracticePicker({ onClose }: { onClose: () => void }) {
  const progress = useMemo(loadProgress, []);
  const groups: { kind: Exercise['kind']; title: string; desc: string }[] = [
    {
      kind: 'plc',
      title: tr('PLC 읽기: 프로그램을 보고 출력 파형 그리기', 'Read PLC: draw the outputs of a program'),
      desc: tr(
        '짧은 PLC 프로그램(래더와 니모닉)과 입력 파형이 주어집니다. PLC 가 위에서 아래로 한 줄씩 실행된다고 생각하며 출력이 언제 켜지고 꺼지는지 그립니다. 자기유지, 타이머, 펄스, 인터록, 카운터, 플리커, 순차 동작을 차례로 연습합니다.',
        'A short PLC program and input waveforms are given. Draw when each output turns on and off.',
      ),
    },
    {
      kind: 'machine',
      title: tr('설비 동작: 설명을 보고 솔레노이드 · 센서 파형 그리기', 'Machine: draw solenoids and sensors from a description'),
      desc: tr(
        '실린더·모터·흡착 장치가 어떤 순서로 몇 초씩 움직이는지 글로 주어집니다. 먼저 각 동작의 시작·끝 시각을 계산하고, 출력(SOL)과 끝 위치 센서가 언제 켜지고 꺼지는지 그립니다. 실무 타임차트를 그리는 순서 그대로입니다.',
        'A machine sequence is described in words. Work out the times, then draw solenoids and sensors.',
      ),
    },
  ];
  return (
    <Modal title={tr('연습 문제', 'Practice')} onClose={onClose} width={860}>
      <div className="practice-pick">
        <p className="wiz-why">
          {tr(
            '문제를 고르면 차트가 연습용으로 바뀝니다. 위쪽 "① 주어진 입력"은 그대로 두고, "② 그려야 할 신호"를 연필 도구로 그린 뒤 아래 [채점하기]를 누르세요. 신호마다 맞았는지, 틀렸다면 몇 초에 무엇이 달랐는지 알려 줍니다. 힌트, 정답 보기, 자세한 해설도 있습니다. 연습을 끝내면 원래 차트로 돌아옵니다.',
            'Pick a problem and the chart becomes a practice sheet. Leave "① given inputs" as they are, draw "② signals to draw" with the pencil, then press [Check]. Hints, the answer and an explanation are available. Your own chart comes back when you finish.',
          )}
        </p>
        {groups.map((g) => (
          <section key={g.kind} className="practice-group">
            <h4>{g.title}</h4>
            <p className="muted small">{g.desc}</p>
            <div className="practice-cards">
              {EXERCISES.filter((e) => e.kind === g.kind).map((e, i) => {
                const pr = progress[e.id];
                const done = pr && pr.best === pr.total;
                return (
                  <button type="button" key={e.id} className={`practice-card ${done ? 'done' : ''}`} onClick={() => startPractice(e.id)}>
                    <span className="practice-card-top">
                      <span className="practice-no">{i + 1}</span>
                      <span className={`chip lv${e.level}`}>{levelName(e.level)}</span>
                      {pr && (
                        <span className={`practice-score ${done ? 'ok' : ''}`}>
                          {done ? '✓ ' : ''}
                          {pr.best}/{pr.total}
                        </span>
                      )}
                    </span>
                    <b>{e.title}</b>
                    <span>{e.goal}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** 아래 패널 "연습 문제" 탭 */
export function PracticeTab() {
  const practice = useStore((s) => s.practice);
  const [showExplain, setShowExplain] = useState(false);
  // 다른 문제로 바뀌면 해설은 닫고 시작 (답이 먼저 보이지 않게)
  const pid = practice?.id;
  useEffect(() => setShowExplain(false), [pid]);
  if (!practice) return null;
  const ex = exerciseById(practice.id);
  if (!ex) return null;
  const s = useStore.getState;
  const idx = EXERCISES.findIndex((e) => e.id === ex.id);
  const next = EXERCISES[idx + 1];
  const prev = EXERCISES[idx - 1];
  const r = practice.result;
  const answerView = practice.view === 'answer';

  const check = () => {
    const res = gradeChart(s().project, practice.answer, practice.draw);
    s().setPractice({ ...practice, result: res });
    saveProgress(ex.id, res.correct, res.total);
    if (res.correct === res.total) setShowExplain(true);
  };
  const toggleAnswer = () => {
    if (!answerView) {
      const attempt = s().project;
      s().loadProject(structuredClone(practice.answer));
      s().setPractice({ ...practice, attempt, view: 'answer' });
      setShowExplain(true);
    } else {
      if (practice.attempt) s().loadProject(practice.attempt);
      s().setPractice({ ...practice, attempt: null, view: 'mine' });
      s().setTool('draw');
    }
  };
  const restart = () => {
    s().loadProject(practiceProject(ex.build(), ex));
    s().setPractice({ ...practice, attempt: null, view: 'mine', result: null, hints: 0 });
    s().setTool('draw');
    setShowExplain(false);
  };
  const go = (e: Exercise | undefined) => {
    if (!e) return;
    setShowExplain(false);
    startPractice(e.id);
  };

  return (
    <div className="practice">
      <div className="practice-problem">
        <div className="practice-title">
          <span className={`chip lv${ex.level}`}>{levelName(ex.level)}</span>
          <span className="chip">{kindName(ex)}</span>
          <b>{ex.title}</b>
          <span className="muted small">
            {idx + 1} / {EXERCISES.length}
          </span>
        </div>
        <p className="practice-goal">
          <b>{tr('배우는 것', 'Goal')}</b> {ex.goal}
        </p>
        <p className="practice-text">{ex.problem}</p>
        {ex.program && (
          <div className="practice-code">
            {ex.ladder && (
              <div>
                <span className="muted small">{tr('래더', 'Ladder')}</span>
                <pre>{ex.ladder}</pre>
                <span className="muted small">{tr('| | A접점(평상시 열림)  |/| B접점(평상시 닫힘)  ( ) 출력  [ ] 명령', '| | NO contact  |/| NC contact  ( ) coil  [ ] instruction')}</span>
              </div>
            )}
            <div>
              <span className="muted small">{tr('니모닉 (미쓰비시)', 'Mnemonic (Mitsubishi)')}</span>
              <pre>{ex.program}</pre>
            </div>
          </div>
        )}
      </div>
      <div className="practice-side">
        {answerView && <p className="practice-banner">{tr('정답 화면입니다. 여기서 고친 것은 채점하지 않습니다.', 'Showing the answer. Edits here are not graded.')}</p>}
        <div className="practice-btns">
          <button type="button" className="btn primary" onClick={check} disabled={answerView}>
            <Icon name="check" size={15} /> {tr('채점하기', 'Check')}
          </button>
          <button type="button" className="btn small" disabled={practice.hints >= ex.hints.length} onClick={() => s().setPractice({ ...practice, hints: practice.hints + 1 })}>
            {tr('힌트', 'Hint')} {practice.hints}/{ex.hints.length}
          </button>
          <button type="button" className="btn small" onClick={toggleAnswer}>
            <Icon name={answerView ? 'undo' : 'eye'} size={14} /> {answerView ? tr('내 답 보기', 'My answer') : tr('정답 보기', 'Show answer')}
          </button>
          <button type="button" className="btn small" onClick={restart}>
            {tr('처음부터 다시', 'Start over')}
          </button>
        </div>
        {practice.hints > 0 && (
          <ol className="practice-hints">
            {ex.hints.slice(0, practice.hints).map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        )}
        {r && !answerView && (
          <div className={`practice-result ${r.correct === r.total ? 'ok' : ''}`}>
            <b>
              {r.correct === r.total ? tr('모두 맞았습니다!', 'All correct!') : tr(`${r.total}개 중 ${r.correct}개 맞았습니다`, `${r.correct} of ${r.total} correct`)}
            </b>
            <ul>
              {r.items.map((it) => (
                <li key={it.key} className={it.ok ? 'ok' : 'ng'}>
                  <span>{it.ok ? '✓' : '✗'}</span>
                  <b>{it.name}</b> {it.message}
                </li>
              ))}
            </ul>
            <p className="muted small">{tr('시각은 눈금 한 칸(0.1초) 안이면 맞은 것으로 봅니다.', 'Times within one grid step (0.1 s) count as correct.')}</p>
          </div>
        )}
        <details className="practice-explain" open={showExplain} onToggle={(e) => setShowExplain((e.target as HTMLDetailsElement).open)}>
          <summary>{tr('해설', 'Explanation')}</summary>
          <p className="practice-text">{ex.explanation}</p>
        </details>
        <div className="practice-nav">
          <button type="button" className="btn small" disabled={!prev} onClick={() => go(prev)}>
            ‹ {tr('이전 문제', 'Previous')}
          </button>
          <button type="button" className="btn small" onClick={() => s().setPracticePicker(true)}>
            {tr('문제 목록', 'All problems')}
          </button>
          <button type="button" className="btn small" disabled={!next} onClick={() => go(next)}>
            {tr('다음 문제', 'Next')} ›
          </button>
          <span className="grow" />
          <button type="button" className="btn small" onClick={endPractice} title={tr('연습 전 차트로 돌아갑니다', 'Return to your chart')}>
            {tr('연습 끝내기', 'End practice')}
          </button>
        </div>
      </div>
    </div>
  );
}
