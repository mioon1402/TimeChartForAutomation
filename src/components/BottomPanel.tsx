import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import type { EdgeKind, Signal, TimingRule } from '../model/types';
import { checkRules, cycleSummary, isIoSignal, measureDelays, sequenceEvents, stepsFromOutputs } from '../model/analysis';
import { formatTime } from '../model/format';
import { effectivePoints, uid, valueAt } from '../model/wave';
import { createStep, STEP_COLORS } from '../model/project';
import { Field, Icon, Select, TimeInput } from './ui';
import { tr } from '../i18n';
import { levelText } from './ChartEditor';

export function BottomPanel() {
  const bottom = useStore((s) => s.bottom);
  const setBottom = useStore((s) => s.setBottom);
  const project = useStore((s) => s.project);
  const results = useMemo(() => checkRules(project), [project]);
  const fails = results.filter((r) => r.status === 'fail').length;
  const tabs: { id: NonNullable<typeof bottom>; label: string; badge?: string; bad?: boolean }[] = [
    { id: 'analysis', label: tr('측정 · 분석', 'Measure') },
    { id: 'rules', label: tr('타이밍 규칙 검증', 'Timing rules'), badge: project.rules.length ? (fails ? `NG ${fails}` : 'OK') : undefined, bad: fails > 0 },
    { id: 'steps', label: tr('공정 스텝 · 사이클 타임', 'Steps & cycle time') },
    { id: 'events', label: tr('동작 순서표', 'Sequence of events') },
  ];
  return (
    <div className={`bottom ${bottom ? 'open' : ''}`}>
      <div className="bottom-tabs">
        {tabs.map((t) => (
          <button type="button" key={t.id} className={`btab ${bottom === t.id ? 'on' : ''}`} onClick={() => setBottom(bottom === t.id ? null : t.id)}>
            {t.label}
            {t.badge && <span className={`badge ${t.bad ? 'bad' : 'good'}`}>{t.badge}</span>}
          </button>
        ))}
        <span className="grow" />
        <button type="button" className="mini-btn" title={bottom ? tr('패널 접기', 'Collapse') : tr('패널 열기', 'Expand')} onClick={() => setBottom(bottom ? null : 'analysis')}>
          <Icon name={bottom ? 'down' : 'up'} size={14} />
        </button>
      </div>
      {bottom && (
        <div className="bottom-body">
          {bottom === 'analysis' && <AnalysisTab />}
          {bottom === 'rules' && <RulesTab />}
          {bottom === 'steps' && <StepsTab />}
          {bottom === 'events' && <EventsTab />}
        </div>
      )}
    </div>
  );
}

function sigOptions(signals: Signal[]) {
  return signals.map((s) => ({ value: s.id, label: s.address ? `${s.address} ${s.name}` : s.name }));
}

function AnalysisTab() {
  const project = useStore((s) => s.project);
  const cursorA = useStore((s) => s.cursorA);
  const cursorB = useStore((s) => s.cursorB);
  const { setCursor, addAnnotation, revealTime } = useStore.getState();
  const u = project.settings.timeUnit;
  const bits = project.signals.filter((s) => s.kind === 'bit' || s.kind === 'clock');
  const [fromSel, setFrom] = useState(bits[0]?.id ?? '');
  const [fromEdge, setFromEdge] = useState<EdgeKind>('rise');
  const [toSel, setTo] = useState(bits[1]?.id ?? '');
  const [toEdge, setToEdge] = useState<EdgeKind>('rise');
  // 차트가 바뀌어 선택한 신호가 없어지면 기본값 사용
  const from = bits.some((b) => b.id === fromSel) ? fromSel : bits[0]?.id ?? '';
  const to = bits.some((b) => b.id === toSel) ? toSel : bits[1]?.id ?? bits[0]?.id ?? '';
  const delays = useMemo(() => (from && to ? measureDelays(project, from, fromEdge, to, toEdge) : []), [project, from, fromEdge, to, toEdge]);
  const edgeOpts = [
    { value: 'rise' as EdgeKind, label: tr('↑ 상승', '↑ rise') },
    { value: 'fall' as EdgeKind, label: tr('↓ 하강', '↓ fall') },
  ];
  const d = project.settings.duration;
  const delta = cursorA !== null && cursorB !== null ? cursorB - cursorA : null;
  return (
    <div className="analysis">
      <div className="card">
        <h4>{tr('커서 측정', 'Cursors')}</h4>
        <p className="muted small">{tr('눈금자 클릭 = 커서 A, Shift+클릭 = 커서 B, 우클릭 = 해제', 'Ruler click = A, Shift+click = B, right-click clears')}</p>
        <div className="grid3">
          <Field label="A">
            <TimeInput value={cursorA ?? undefined} allowEmpty onChange={(v) => setCursor('A', v ?? null)} />
          </Field>
          <Field label="B">
            <TimeInput value={cursorB ?? undefined} allowEmpty onChange={(v) => setCursor('B', v ?? null)} />
          </Field>
          <Field label="Δ (B − A)">
            <div className="readout">{delta === null ? '-' : formatTime(delta, u)}</div>
          </Field>
        </div>
        {(cursorA !== null || cursorB !== null) && (
          <div className="cursor-values">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>{tr('신호', 'Signal')}</th>
                  {cursorA !== null && <th>A</th>}
                  {cursorB !== null && <th>B</th>}
                </tr>
              </thead>
              <tbody>
                {project.signals.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="lcolor" style={{ background: s.color }} /> {s.address || s.name}
                    </td>
                    {cursorA !== null && <td>{levelText(s, valueAt(effectivePoints(s, d), cursorA + 1e-6, s.kind))}</td>}
                    {cursorB !== null && <td>{levelText(s, valueAt(effectivePoints(s, d), cursorB + 1e-6, s.kind))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card grow2">
        <h4>{tr('에지 간 지연 측정', 'Edge-to-edge delay')}</h4>
        <div className="delay-form">
          <Select value={from} onChange={setFrom} options={sigOptions(bits)} />
          <Select value={fromEdge} onChange={setFromEdge} options={edgeOpts} />
          <span className="arrow">→</span>
          <Select value={to} onChange={setTo} options={sigOptions(bits)} />
          <Select value={toEdge} onChange={setToEdge} options={edgeOpts} />
        </div>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>#</th>
              <th>{tr('원인 시각', 'From')}</th>
              <th>{tr('결과 시각', 'To')}</th>
              <th>{tr('지연', 'Delay')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {delays.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {tr('해당 에지가 없습니다', 'No matching edges')}
                </td>
              </tr>
            )}
            {delays.map((m, i) => (
              <tr key={i} onClick={() => revealTime(m.from)} className="clickable">
                <td>{i + 1}</td>
                <td>{formatTime(m.from, u)}</td>
                <td>{m.to === null ? '-' : formatTime(m.to, u)}</td>
                <td>
                  <b>{m.delay === null ? tr('응답 없음', 'none') : formatTime(m.delay, u)}</b>
                </td>
                <td>
                  {m.to !== null && (
                    <button
                      type="button"
                      className="mini-btn"
                      title={tr('화살표로 추가', 'Add as arrow')}
                      onClick={(e) => {
                        e.stopPropagation();
                        addAnnotation({ id: uid('ann'), type: 'arrow', from: { signalId: from, t: m.from }, to: { signalId: to, t: m.to! }, label: formatTime(m.delay!, u) });
                      }}
                    >
                      <Icon name="arrow" size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function describeRule(r: TimingRule, signals: Signal[], u: ReturnType<typeof useStore.getState>['project']['settings']['timeUnit']): string {
  const n = (id: string) => {
    const s = signals.find((q) => q.id === id);
    return s ? s.address || s.name : '?';
  };
  const lim = (min?: number, max?: number) => [min !== undefined ? `≥ ${formatTime(min, u)}` : '', max !== undefined ? `≤ ${formatTime(max, u)}` : ''].filter(Boolean).join(', ');
  const e = (k: EdgeKind) => (k === 'rise' ? '↑' : '↓');
  switch (r.type) {
    case 'delay':
      return `${n(r.fromSignal)}${e(r.fromEdge)} → ${n(r.toSignal)}${e(r.toEdge)}  ${lim(r.min, r.max)}`;
    case 'exclusive':
      return `${n(r.a)} ⊕ ${n(r.b)}  ${tr('동시 ON 금지', 'never both ON')}`;
    case 'pulse':
      return `${n(r.signal)} ${r.level ? 'ON' : 'OFF'} ${tr('폭', 'width')} ${lim(r.min, r.max)}`;
    case 'cycle':
      return `${tr('사이클', 'Cycle')} ≤ ${formatTime(r.max, u)}`;
  }
}

function RulesTab() {
  const project = useStore((s) => s.project);
  const { addRule, removeRule, revealTime, select } = useStore.getState();
  const results = useMemo(() => checkRules(project), [project]);
  const u = project.settings.timeUnit;
  const bits = project.signals.filter((s) => s.kind === 'bit' || s.kind === 'clock');
  const [type, setType] = useState<TimingRule['type']>('delay');
  const [aSel, setA] = useState(bits[0]?.id ?? '');
  const [bSel, setB] = useState(bits[1]?.id ?? '');
  const a = bits.some((x) => x.id === aSel) ? aSel : bits[0]?.id ?? '';
  const b = bits.some((x) => x.id === bSel) ? bSel : bits[1]?.id ?? bits[0]?.id ?? '';
  const [ea, setEa] = useState<EdgeKind>('rise');
  const [eb, setEb] = useState<EdgeKind>('rise');
  const [min, setMin] = useState<number | undefined>();
  const [max, setMax] = useState<number | undefined>(500);
  const [level, setLevel] = useState<'1' | '0'>('1');
  const [name, setName] = useState('');
  const edgeOpts = [
    { value: 'rise' as EdgeKind, label: '↑' },
    { value: 'fall' as EdgeKind, label: '↓' },
  ];
  const add = () => {
    const id = uid('rul');
    let r: TimingRule;
    if (type === 'delay') r = { id, type, name: name || tr('응답 시간', 'Response time'), fromSignal: a, fromEdge: ea, toSignal: b, toEdge: eb, min, max };
    else if (type === 'exclusive') r = { id, type, name: name || tr('동시 ON 금지 (인터록)', 'Interlock'), a, b };
    else if (type === 'pulse') r = { id, type, name: name || tr('펄스 폭', 'Pulse width'), signal: a, level: level === '1' ? 1 : 0, min, max };
    else r = { id, type, name: name || tr('목표 사이클 타임', 'Target cycle time'), max: max ?? 1000 };
    addRule(r);
    setName('');
  };
  return (
    <div className="rules">
      <div className="card grow2">
        <table className="tbl">
          <thead>
            <tr>
              <th />
              <th>{tr('규칙', 'Rule')}</th>
              <th>{tr('조건', 'Condition')}</th>
              <th>{tr('측정값', 'Measured')}</th>
              <th>{tr('위반', 'Violations')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {tr('규칙이 없습니다. 오른쪽에서 응답 시간, 인터록(동시 ON 금지), 펄스 폭, 사이클 타임 규칙을 추가하세요.', 'No rules yet. Add response-time, interlock, pulse-width or cycle-time rules on the right.')}
                </td>
              </tr>
            )}
            {results.map((res) => (
              <tr key={res.rule.id} className={`clickable ${res.status}`} onClick={() => select({ type: 'rule', id: res.rule.id })}>
                <td>
                  <span className={`status ${res.status}`}>{res.status === 'ok' ? 'OK' : res.status === 'fail' ? 'NG' : '-'}</span>
                </td>
                <td>{res.rule.name}</td>
                <td className="mono small">{describeRule(res.rule, project.signals, u)}</td>
                <td>{res.measured}</td>
                <td>
                  {res.violations.slice(0, 3).map((v, i) => (
                    <button
                      type="button"
                      key={i}
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        revealTime(v.t0);
                      }}
                    >
                      {v.message}
                    </button>
                  ))}
                  {res.violations.length > 3 && <span className="muted"> +{res.violations.length - 3}</span>}
                </td>
                <td>
                  <button
                    type="button"
                    className="mini-btn"
                    title={tr('삭제', 'Delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRule(res.rule.id);
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card rule-form">
        <h4>{tr('규칙 추가', 'Add rule')}</h4>
        <Select
          value={type}
          onChange={setType}
          options={[
            { value: 'delay', label: tr('응답 시간 (A 에지 → B 에지)', 'Response time (A → B)') },
            { value: 'exclusive', label: tr('인터록: 동시 ON 금지', 'Interlock: never both ON') },
            { value: 'pulse', label: tr('펄스 폭 범위', 'Pulse width range') },
            { value: 'cycle', label: tr('사이클 타임 목표', 'Cycle time target') },
          ]}
        />
        {type !== 'cycle' && (
          <div className="rule-row">
            <Select value={a} onChange={setA} options={sigOptions(bits)} />
            {type === 'delay' && <Select value={ea} onChange={setEa} options={edgeOpts} />}
            {type === 'pulse' && <Select value={level} onChange={setLevel} options={[{ value: '1', label: 'ON' }, { value: '0', label: 'OFF' }]} />}
          </div>
        )}
        {(type === 'delay' || type === 'exclusive') && (
          <div className="rule-row">
            <Select value={b} onChange={setB} options={sigOptions(bits)} />
            {type === 'delay' && <Select value={eb} onChange={setEb} options={edgeOpts} />}
          </div>
        )}
        {type !== 'exclusive' && (
          <div className="rule-row">
            {type !== 'cycle' && (
              <Field label={tr('최소', 'Min')}>
                <TimeInput value={min} allowEmpty onChange={setMin} placeholder="-" />
              </Field>
            )}
            <Field label={tr('최대', 'Max')}>
              <TimeInput value={max} allowEmpty onChange={setMax} placeholder="-" />
            </Field>
          </div>
        )}
        <input className="input" placeholder={tr('규칙 이름 (선택)', 'Rule name (optional)')} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn primary small" onClick={add} disabled={type !== 'cycle' && !a}>
          <Icon name="plus" size={13} /> {tr('추가', 'Add')}
        </button>
      </div>
    </div>
  );
}

function StepsTab() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const { addStep, select, revealTime, commit } = useStore.getState();
  const c = useMemo(() => cycleSummary(project), [project]);
  const u = project.settings.timeUnit;
  const buses = project.signals.filter((s) => s.kind === 'bus');
  const [srcSel, setSrc] = useState(buses[0]?.id ?? '');
  const src = buses.some((x) => x.id === srcSel) ? srcSel : buses[0]?.id ?? '';
  const fromBus = () => {
    const sig = project.signals.find((s) => s.id === src);
    if (!sig) return;
    const steps = [];
    for (let i = 0; i < sig.points.length; i++) {
      const v = String(sig.points[i].v);
      if (v === '0' || v === '' || v === 'x') continue;
      const start = sig.points[i].t;
      const end = i + 1 < sig.points.length ? sig.points[i + 1].t : project.settings.duration;
      steps.push(createStep({ label: /^\d+$/.test(v) ? `S${v}` : v, start, end, description: '', color: STEP_COLORS[steps.length % STEP_COLORS.length] }));
    }
    commit({ ...project, steps });
  };
  const outs = project.signals.filter((s) => s.kind === 'bit' && (s.role === 'output' || s.role === 'actuator'));
  const fromOutputs = () => {
    const d = project.settings.duration;
    const steps = stepsFromOutputs(
      outs.map((s) => ({ id: s.id, points: effectivePoints(s, d), name: s.name, address: s.address, rank: s.role === 'actuator' ? 0 : undefined })),
      d,
    );
    if (!steps.length) return;
    commit({ ...project, steps });
  };
  const max = Math.max(...c.steps.map((r) => r.duration), 1);
  return (
    <div className="steps-tab">
      <div className="card summary">
        <h4>{tr('사이클 타임', 'Cycle time')}</h4>
        <div className="big-num">{formatTime(c.total, u)}</div>
        <p className="muted small">
          {c.basis === 'steps' ? tr('스텝 기준', 'by steps') : tr('신호 변화 구간 기준', 'by signal activity')} · {formatTime(c.start, u)} ~ {formatTime(c.end, u)}
        </p>
        {c.longest && (
          <p className="small">
            {tr('최장 스텝 (병목)', 'Longest step (bottleneck)')}: <b>{c.longest.label}</b> ({formatTime(c.longest.end - c.longest.start, u)})
          </p>
        )}
        <div className="row-btns">
          <button type="button" className="btn small" onClick={() => addStep()}>
            <Icon name="plus" size={13} /> {tr('스텝 추가', 'Add step')}
          </button>
        </div>
        {outs.length > 0 && (
          <div className="rule-row">
            <button type="button" className="btn small" onClick={fromOutputs} title={tr('어떤 출력이 켜져 있는지가 바뀔 때마다 스텝을 나눕니다 (UP → LEFT → 대기 …)', 'New step whenever the set of ON outputs changes')}>
              <Icon name="wand" size={13} /> {tr('출력 조합으로 스텝 생성', 'Steps from outputs')}
            </button>
          </div>
        )}
        {buses.length > 0 && (
          <div className="rule-row">
            <Select value={src} onChange={setSrc} options={sigOptions(buses)} />
            <button type="button" className="btn small" onClick={fromBus} title={tr('워드 신호 값 변화로 스텝을 다시 만듭니다', 'Rebuild steps from word value changes')}>
              <Icon name="wand" size={13} /> {tr('값으로 스텝 생성', 'Steps from values')}
            </button>
          </div>
        )}
      </div>
      <div className="card grow2">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>{tr('스텝', 'Step')}</th>
              <th>{tr('시작', 'Start')}</th>
              <th>{tr('끝', 'End')}</th>
              <th>{tr('시간', 'Time')}</th>
              <th style={{ width: '30%' }}>{tr('비율', 'Share')}</th>
              <th>{tr('설명', 'Description')}</th>
            </tr>
          </thead>
          <tbody>
            {c.steps.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {tr('스텝이 없습니다. 눈금자 위 스텝 띠를 드래그하거나 "스텝" 도구로 구간을 지정하세요.', 'No steps. Drag on the step band above the ruler or use the Step tool.')}
                </td>
              </tr>
            )}
            {c.steps.map((r, i) => (
              <tr
                key={r.step.id}
                className={`clickable ${selection?.type === 'step' && selection.id === r.step.id ? 'sel' : ''}`}
                onClick={() => {
                  select({ type: 'step', id: r.step.id });
                  revealTime(r.step.start);
                }}
              >
                <td>{i + 1}</td>
                <td>
                  <span className="lcolor" style={{ background: r.step.color }} /> {r.step.label}
                </td>
                <td>{formatTime(r.step.start, u)}</td>
                <td>{formatTime(r.step.end, u)}</td>
                <td>
                  <b>{formatTime(r.duration, u)}</b>
                </td>
                <td>
                  <div className="bar">
                    <div className={`bar-fill ${c.longest?.id === r.step.id ? 'hot' : ''}`} style={{ width: `${(r.duration / max) * 100}%` }} />
                    <span>{(r.share * 100).toFixed(1)}%</span>
                  </div>
                </td>
                <td className="small">{r.step.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 동작 순서표: 신호 변화를 시간 순으로 - "무엇이 켜지고 → 무엇이 꺼지는가" */
function EventsTab() {
  const project = useStore((s) => s.project);
  const { revealTime, setCursor } = useStore.getState();
  const [ioOnly, setIoOnly] = useState(true);
  const hasIo = project.signals.some(isIoSignal);
  const events = useMemo(() => sequenceEvents(project, ioOnly && hasIo ? isIoSignal : undefined), [project, ioOnly, hasIo]);
  const u = project.settings.timeUnit;
  let lastStep: string | null = null;
  return (
    <div className="events-tab">
      <div className="events-head">
        <span className="small muted">
          {tr(`변화 ${events.length}건 · 행을 누르면 그 시각으로 이동`, `${events.length} changes · click a row to jump`)}
        </span>
        <span className="grow" />
        {hasIo && (
          <label className="check small">
            <input type="checkbox" checked={ioOnly} onChange={(e) => setIoOnly(e.target.checked)} /> {tr('실제 입출력·설비만', 'Real I/O & equipment only')}
          </label>
        )}
      </div>
      <div className="card grow2 events-card">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>{tr('시각', 'Time')}</th>
              <th>{tr('간격', 'Δt')}</th>
              <th>{tr('주소', 'Address')}</th>
              <th>{tr('신호', 'Signal')}</th>
              <th>{tr('변화', 'Change')}</th>
              <th>{tr('공정 스텝', 'Step')}</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {tr('신호 변화가 없습니다.', 'No signal changes.')}
                </td>
              </tr>
            )}
            {events.map((e, i) => {
              const newStep = e.step && e.step.id !== lastStep;
              lastStep = e.step?.id ?? null;
              return (
                <tr
                  key={i}
                  className={`clickable ${newStep ? 'step-start' : ''}`}
                  onClick={() => {
                    setCursor('A', e.t);
                    revealTime(e.t);
                  }}
                >
                  <td>{i + 1}</td>
                  <td className="mono">{formatTime(e.t, u)}</td>
                  <td className="mono muted">{e.dt !== null ? `+${formatTime(e.dt, u)}` : ''}</td>
                  <td className="mono">{e.signal.address}</td>
                  <td>
                    <span className="lcolor" style={{ background: e.signal.color }} /> {e.signal.name}
                  </td>
                  <td>
                    <span className={`ev ${e.kind}`}>{e.kind === 'on' ? `↑ ${e.value}` : e.kind === 'off' ? `↓ ${e.value}` : `= ${e.value}`}</span>
                  </td>
                  <td className="small">{newStep ? <b>{e.step!.label}</b> : e.step ? <span className="muted">〃</span> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
