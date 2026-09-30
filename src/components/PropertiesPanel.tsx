import { useMemo } from 'react';
import { useStore } from '../store/store';
import type { Annotation, EdgeKind, Signal, SignalKind, SignalRole, Step, TimingRule, WavePoint } from '../model/types';
import { ROLE_COLORS, STEP_COLORS } from '../model/project';
import { normalize, setRamp } from '../model/wave';
import { checkRule, signalStats } from '../model/analysis';
import { formatTime } from '../model/format';
import { Check, ColorInput, Field, Icon, NumberInput, Section, Select, TextInput, TimeInput } from './ui';
import { tr } from '../i18n';

export function roleOptions(): { value: SignalRole; label: string }[] {
  return [
    { value: 'input', label: tr('입력 (X, I, P)', 'Input') },
    { value: 'output', label: tr('출력 (Y, Q)', 'Output') },
    { value: 'sensor', label: tr('센서', 'Sensor') },
    { value: 'actuator', label: tr('액추에이터 (실린더/모터)', 'Actuator') },
    { value: 'internal', label: tr('내부 릴레이 (M)', 'Internal relay') },
    { value: 'timer', label: tr('타이머', 'Timer') },
    { value: 'counter', label: tr('카운터', 'Counter') },
    { value: 'data', label: tr('데이터 (D, 워드)', 'Data word') },
    { value: 'other', label: tr('기타', 'Other') },
  ];
}

export function kindOptions(): { value: SignalKind; label: string }[] {
  return [
    { value: 'bit', label: tr('비트 (ON/OFF)', 'Bit (ON/OFF)') },
    { value: 'bus', label: tr('워드 / 데이터 값', 'Word / data') },
    { value: 'analog', label: tr('아날로그', 'Analog') },
    { value: 'clock', label: tr('클럭 (주기)', 'Clock') },
  ];
}

export function PropertiesPanel() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  let body;
  if (selection?.type === 'signals' && selection.ids.length === 1) {
    const sig = project.signals.find((s) => s.id === selection.ids[0]);
    body = sig ? <SignalProps sig={sig} /> : <ProjectProps />;
  } else if (selection?.type === 'signals' && selection.ids.length > 1) body = <MultiSignalProps ids={selection.ids} />;
  else if (selection?.type === 'annotation') {
    const a = project.annotations.find((q) => q.id === selection.id);
    body = a ? <AnnotationProps a={a} /> : <ProjectProps />;
  } else if (selection?.type === 'step') {
    const s = project.steps.find((q) => q.id === selection.id);
    body = s ? <StepProps step={s} /> : <ProjectProps />;
  } else if (selection?.type === 'rule') {
    const r = project.rules.find((q) => q.id === selection.id);
    body = r ? <RuleProps rule={r} /> : <ProjectProps />;
  } else body = <ProjectProps />;
  return <aside className="props">{body}</aside>;
}

function ProjectProps() {
  const project = useStore((s) => s.project);
  const { setMeta, setSettings, scaleTimeAll, fitZoom } = useStore.getState();
  const m = project.meta;
  const st = project.settings;
  return (
    <div className="props-inner">
      <div className="props-title">
        <Icon name="chart" /> {tr('차트 설정', 'Chart settings')}
      </div>
      <Section title={tr('시간 축', 'Time axis')}>
        <div className="grid2">
          <Field label={tr('전체 길이', 'Duration')}>
            <TimeInput value={st.duration} onChange={(v) => v && (setSettings({ duration: v }), setTimeout(fitZoom, 0))} />
          </Field>
          <Field label={tr('그리드 (스냅)', 'Grid (snap)')}>
            <TimeInput value={st.grid} onChange={(v) => v && setSettings({ grid: v })} />
          </Field>
          <Field label={tr('시간 단위', 'Time unit')}>
            <Select value={st.timeUnit} onChange={(v) => setSettings({ timeUnit: v })} options={[{ value: 'ms', label: 'ms' }, { value: 's', label: 's' }, { value: 'auto', label: tr('자동', 'Auto') }]} />
          </Field>
          <Field label={tr('행 높이 (px)', 'Row height')}>
            <NumberInput value={st.rowHeight} min={20} max={120} onChange={(v) => v && setSettings({ rowHeight: v })} />
          </Field>
        </div>
        <div className="row-btns">
          <button type="button" className="btn small" onClick={() => scaleTimeAll(0.5)}>
            {tr('시간 ×0.5', 'Time ×0.5')}
          </button>
          <button type="button" className="btn small" onClick={() => scaleTimeAll(2)}>
            {tr('시간 ×2', 'Time ×2')}
          </button>
        </div>
      </Section>
      <Section title={tr('표시', 'Display')}>
        <Check checked={st.fillHigh} onChange={(v) => setSettings({ fillHigh: v })} label={tr('ON 구간 채우기', 'Fill ON levels')} />
        <Check checked={st.showAddress} onChange={(v) => setSettings({ showAddress: v })} label={tr('주소 열 표시', 'Show address column')} />
        <Check checked={st.showLevelLabels} onChange={(v) => setSettings({ showLevelLabels: v })} label={tr('ON/OFF 라벨 표시 (전진/후진 등)', 'Show level labels')} />
        <Check checked={st.showEdgeTimes} onChange={(v) => setSettings({ showEdgeTimes: v })} label={tr('전환 시각 표시', 'Show edge times')} />
      </Section>
      <Section title={tr('도면 정보 (표제란)', 'Title block')}>
        <Field label={tr('제목', 'Title')} wide>
          <TextInput value={m.title} onChange={(v) => setMeta({ title: v })} />
        </Field>
        <Field label={tr('설비명', 'Machine')} wide>
          <TextInput value={m.machine} onChange={(v) => setMeta({ machine: v })} />
        </Field>
        <div className="grid2">
          <Field label={tr('도면 번호', 'Drawing no.')}>
            <TextInput value={m.drawingNo} onChange={(v) => setMeta({ drawingNo: v })} />
          </Field>
          <Field label={tr('Rev.', 'Rev.')}>
            <TextInput value={m.revision} onChange={(v) => setMeta({ revision: v })} />
          </Field>
          <Field label={tr('회사', 'Company')}>
            <TextInput value={m.company} onChange={(v) => setMeta({ company: v })} />
          </Field>
          <Field label={tr('날짜', 'Date')}>
            <TextInput value={m.date} onChange={(v) => setMeta({ date: v })} />
          </Field>
          <Field label={tr('작성', 'Drawn')}>
            <TextInput value={m.author} onChange={(v) => setMeta({ author: v })} />
          </Field>
          <Field label={tr('검토', 'Checked')}>
            <TextInput value={m.checker} onChange={(v) => setMeta({ checker: v })} />
          </Field>
          <Field label={tr('승인', 'Approved')}>
            <TextInput value={m.approver} onChange={(v) => setMeta({ approver: v })} />
          </Field>
        </div>
        <Field label={tr('설명', 'Description')} wide>
          <textarea className="input" rows={3} defaultValue={m.description} key={m.description} onBlur={(e) => e.target.value !== m.description && setMeta({ description: e.target.value })} />
        </Field>
      </Section>
      <p className="props-tip">
        {tr('팁: 신호·주석·스텝을 클릭하면 속성을 편집할 수 있습니다. 더블클릭으로 파형 구간 반전, 우클릭으로 메뉴를 엽니다.', 'Tip: click a signal, annotation or step to edit it. Double-click toggles a segment; right-click opens a menu.')}
      </p>
    </div>
  );
}

function SignalProps({ sig }: { sig: Signal }) {
  const project = useStore((s) => s.project);
  const { updateSignal, removeSignals, duplicateSignals } = useStore.getState();
  const up = (patch: Partial<Signal>) => updateSignal(sig.id, patch);
  const stats = useMemo(() => signalStats(sig, project.settings.duration), [sig, project.settings.duration]);
  const u = project.settings.timeUnit;
  const groups = useMemo(() => [...new Set(project.signals.map((s) => s.group).filter(Boolean))] as string[], [project.signals]);
  return (
    <div className="props-inner">
      <div className="props-title">
        <span className="lcolor big" style={{ background: sig.color }} />
        {sig.name}
        <span className="grow" />
        <button type="button" className="mini-btn" title={tr('복제 (Ctrl+D)', 'Duplicate (Ctrl+D)')} onClick={() => duplicateSignals([sig.id])}>
          <Icon name="copy" size={14} />
        </button>
        <button type="button" className="mini-btn danger" title={tr('삭제 (Del)', 'Delete (Del)')} onClick={() => removeSignals([sig.id])}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <Section title={tr('신호', 'Signal')}>
        <Field label={tr('이름', 'Name')} wide>
          <TextInput value={sig.name} onChange={(v) => up({ name: v })} />
        </Field>
        <div className="grid2">
          <Field label={tr('PLC 주소', 'PLC address')}>
            <TextInput value={sig.address} mono onChange={(v) => up({ address: v.trim() })} placeholder="X0, Y10, %IX0.0" />
          </Field>
          <Field label={tr('그룹', 'Group')}>
            <input className="input" list="group-list" defaultValue={sig.group ?? ''} key={sig.id + (sig.group ?? '')} onBlur={(e) => (e.target.value || undefined) !== sig.group && up({ group: e.target.value || undefined })} />
            <datalist id="group-list">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label={tr('종류', 'Kind')}>
            <Select value={sig.kind} onChange={(v) => up({ kind: v })} options={kindOptions()} />
          </Field>
          <Field label={tr('역할', 'Role')}>
            <Select value={sig.role} onChange={(v) => up({ role: v, color: sig.color === ROLE_COLORS[sig.role] ? ROLE_COLORS[v] : sig.color })} options={roleOptions()} />
          </Field>
        </div>
        <Field label={tr('설명', 'Comment')} wide>
          <TextInput value={sig.comment} onChange={(v) => up({ comment: v })} />
        </Field>
        <Field label={tr('색상', 'Color')} wide>
          <ColorInput value={sig.color} onChange={(v) => up({ color: v })} />
        </Field>
        <div className="grid2">
          <Field label={tr('행 높이 배율', 'Height scale')}>
            <NumberInput value={sig.heightScale ?? 1} min={0.5} max={4} step={0.1} onChange={(v) => up({ heightScale: v })} />
          </Field>
          <Field label={tr('보고서 표시', 'In report')}>
            <Check checked={!sig.hidden} onChange={(v) => up({ hidden: !v })} label={tr('표시', 'Visible')} />
          </Field>
        </div>
      </Section>
      {sig.kind === 'bit' && (
        <Section title={tr('동작 표현 (실린더·모터)', 'Motion (cylinders, motors)')}>
          <div className="grid2">
            <Field label={tr('ON 라벨', 'ON label')}>
              <TextInput value={sig.onLabel ?? ''} onChange={(v) => up({ onLabel: v || undefined })} placeholder={tr('전진', 'ADV')} />
            </Field>
            <Field label={tr('OFF 라벨', 'OFF label')}>
              <TextInput value={sig.offLabel ?? ''} onChange={(v) => up({ offLabel: v || undefined })} placeholder={tr('후진', 'RET')} />
            </Field>
          </div>
          <Field label={tr('기본 동작 시간 (새 전환의 경사)', 'Default motion time (slope)')} wide>
            <TimeInput value={sig.defaultRamp} allowEmpty onChange={(v) => up({ defaultRamp: v || undefined })} placeholder="0" />
          </Field>
          <div className="row-btns">
            <button type="button" className="btn small" onClick={() => up({ points: sig.points.map((p, i) => (i === 0 ? p : { ...p, ramp: sig.defaultRamp || undefined })).map(cleanRamp) })}>
              {tr('모든 전환에 동작 시간 적용', 'Apply to all transitions')}
            </button>
          </div>
          <div className="presets">
            {[
              [tr('전진', 'ADV'), tr('후진', 'RET')],
              [tr('상승', 'UP'), tr('하강', 'DOWN')],
              [tr('하강', 'DOWN'), tr('상승', 'UP')],
              [tr('흡착', 'VAC'), tr('해제', 'REL')],
              [tr('닫힘', 'CLOSE'), tr('열림', 'OPEN')],
              ['ON', 'OFF'],
            ].map(([on, off]) => (
              <button type="button" key={on + off} className="chip" onClick={() => up({ onLabel: on, offLabel: off })}>
                {on}/{off}
              </button>
            ))}
          </div>
        </Section>
      )}
      {sig.kind === 'analog' && (
        <Section title={tr('아날로그 범위', 'Analog range')}>
          <div className="grid2">
            <Field label={tr('최소', 'Min')}>
              <NumberInput value={sig.analogMin ?? 0} onChange={(v) => up({ analogMin: v })} />
            </Field>
            <Field label={tr('최대', 'Max')}>
              <NumberInput value={sig.analogMax ?? 10} onChange={(v) => up({ analogMax: v })} />
            </Field>
            <Field label={tr('단위', 'Unit')}>
              <TextInput value={sig.unit ?? ''} onChange={(v) => up({ unit: v })} placeholder="bar, mm/s" />
            </Field>
          </div>
        </Section>
      )}
      {sig.kind === 'clock' && (
        <Section title={tr('클럭', 'Clock')}>
          <div className="grid2">
            <Field label={tr('주기', 'Period')}>
              <TimeInput value={sig.clockPeriod ?? 100} onChange={(v) => v && up({ clockPeriod: v })} />
            </Field>
            <Field label={tr('듀티 (0~1)', 'Duty (0-1)')}>
              <NumberInput value={sig.clockDuty ?? 0.5} min={0.01} max={0.99} step={0.05} onChange={(v) => up({ clockDuty: v })} />
            </Field>
            <Field label={tr('위상 지연', 'Phase delay')}>
              <TimeInput value={sig.clockPhase ?? 0} onChange={(v) => up({ clockPhase: v ?? 0 })} />
            </Field>
          </div>
        </Section>
      )}
      {sig.kind !== 'clock' && <PointTable sig={sig} />}
      {(sig.kind === 'bit' || sig.kind === 'clock') && (
        <Section title={tr('통계', 'Statistics')}>
          <table className="kv">
            <tbody>
              <tr>
                <th>{tr('ON 횟수', 'ON count')}</th>
                <td>{stats.onCount}</td>
              </tr>
              <tr>
                <th>{tr('ON 합계', 'ON total')}</th>
                <td>
                  {formatTime(stats.onTotal, u)} ({(stats.duty * 100).toFixed(1)}%)
                </td>
              </tr>
              <tr>
                <th>{tr('최초 ON', 'First ON')}</th>
                <td>{stats.firstOn === null ? '-' : formatTime(stats.firstOn, u)}</td>
              </tr>
              <tr>
                <th>{tr('ON 폭 (최소~최대)', 'ON width (min-max)')}</th>
                <td>{stats.minOn === null ? '-' : `${formatTime(stats.minOn, u)} ~ ${formatTime(stats.maxOn!, u)}`}</td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function cleanRamp(p: WavePoint): WavePoint {
  if (!p.ramp) {
    const { ramp: _r, ...rest } = p;
    void _r;
    return rest;
  }
  return p;
}

function PointTable({ sig }: { sig: Signal }) {
  const { updateSignal } = useStore.getState();
  const grid = useStore((s) => s.project.settings.grid);
  const dur = useStore((s) => s.project.settings.duration);
  const setPoints = (pts: WavePoint[]) => updateSignal(sig.id, { points: normalize(pts, sig.kind, sig.kind === 'bus' ? '0' : 0) });
  const valueInput = (p: WavePoint, i: number) => {
    const change = (v: WavePoint['v']) => setPoints(sig.points.map((q, j) => (j === i ? { ...q, v } : q)));
    if (sig.kind === 'bit')
      return (
        <select className="input" value={String(p.v)} onChange={(e) => change(e.target.value === 'x' ? 'x' : Number(e.target.value))}>
          <option value="1">1 {sig.onLabel ? `(${sig.onLabel})` : 'ON'}</option>
          <option value="0">0 {sig.offLabel ? `(${sig.offLabel})` : 'OFF'}</option>
          <option value="x">X</option>
        </select>
      );
    if (sig.kind === 'analog') return <NumberInput value={Number(p.v)} onChange={(v) => change(v ?? 0)} />;
    return <TextInput value={String(p.v)} onChange={(v) => change(v)} />;
  };
  return (
    <Section title={`${tr('파형 데이터', 'Waveform points')} (${sig.points.length})`} defaultOpen={sig.points.length <= 24}>
      <table className="points">
        <thead>
          <tr>
            <th>{tr('시각', 'Time')}</th>
            <th>{tr('값', 'Value')}</th>
            {sig.kind === 'bit' && <th>{tr('동작', 'Motion')}</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {sig.points.map((p, i) => (
            <tr key={`${i}-${p.t}`}>
              <td>{i === 0 ? <span className="muted">0</span> : <TimeInput value={p.t} onChange={(v) => v !== undefined && setPoints(sig.points.map((q, j) => (j === i ? { ...q, t: v } : q)))} />}</td>
              <td>{valueInput(p, i)}</td>
              {sig.kind === 'bit' && <td>{i === 0 ? '' : <TimeInput value={p.ramp} allowEmpty placeholder="0" onChange={(v) => updateSignal(sig.id, { points: setRamp(sig.points, i, v ?? 0) })} />}</td>}
              <td>
                {i > 0 && (
                  <button type="button" className="mini-btn" title={tr('삭제', 'Delete')} onClick={() => setPoints(sig.points.filter((_, j) => j !== i))}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          const last = sig.points[sig.points.length - 1];
          const t = Math.min(last.t + grid * 4, dur);
          const v: WavePoint['v'] = sig.kind === 'bit' ? (last.v === 1 ? 0 : 1) : sig.kind === 'analog' ? Number(last.v) : String(Number(last.v) + 1 || 'A');
          setPoints([...sig.points, { t, v, ...(sig.defaultRamp ? { ramp: sig.defaultRamp } : {}) }]);
        }}
      >
        <Icon name="plus" size={13} /> {tr('전환 추가', 'Add transition')}
      </button>
    </Section>
  );
}

function MultiSignalProps({ ids }: { ids: string[] }) {
  const project = useStore((s) => s.project);
  const { updateSignals, removeSignals, duplicateSignals } = useStore.getState();
  const sigs = project.signals.filter((s) => ids.includes(s.id));
  return (
    <div className="props-inner">
      <div className="props-title">
        {tr(`${sigs.length}개 신호 선택됨`, `${sigs.length} signals selected`)}
        <span className="grow" />
        <button type="button" className="mini-btn" title={tr('복제', 'Duplicate')} onClick={() => duplicateSignals(ids)}>
          <Icon name="copy" size={14} />
        </button>
        <button type="button" className="mini-btn danger" title={tr('삭제', 'Delete')} onClick={() => removeSignals(ids)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <Section title={tr('일괄 변경', 'Bulk edit')}>
        <Field label={tr('그룹', 'Group')} wide>
          <TextInput value="" placeholder={tr('그룹 이름 입력 후 Enter', 'Type group name, Enter')} onChange={(v) => updateSignals(ids, { group: v || undefined })} />
        </Field>
        <Field label={tr('역할', 'Role')} wide>
          <select className="input" defaultValue="" onChange={(e) => e.target.value && updateSignals(ids, { role: e.target.value as SignalRole, color: ROLE_COLORS[e.target.value as SignalRole] })}>
            <option value="">—</option>
            {roleOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('색상', 'Color')} wide>
          <ColorInput value="" onChange={(v) => updateSignals(ids, { color: v })} />
        </Field>
        <div className="row-btns">
          <button type="button" className="btn small" onClick={() => updateSignals(ids, { hidden: true })}>
            {tr('보고서에서 숨김', 'Hide in report')}
          </button>
          <button type="button" className="btn small" onClick={() => updateSignals(ids, { hidden: false })}>
            {tr('표시', 'Show')}
          </button>
        </div>
      </Section>
      <ul className="sel-list">
        {sigs.map((s) => (
          <li key={s.id}>
            <span className="lcolor" style={{ background: s.color }} /> {s.address && <code>{s.address}</code>} {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnotationProps({ a }: { a: Annotation }) {
  const project = useStore((s) => s.project);
  const { updateAnnotation, removeAnnotation, revealTime } = useStore.getState();
  const up = (patch: Partial<Annotation>) => updateAnnotation(a.id, patch);
  const sigOpts = [{ value: '', label: tr('(차트 상단)', '(chart top)') }, ...project.signals.map((s) => ({ value: s.id, label: s.address ? `${s.address} ${s.name}` : s.name }))];
  const names: Record<Annotation['type'], string> = {
    arrow: tr('인과/인터록 화살표', 'Cause→effect arrow'),
    dimension: tr('시간 치수선', 'Time dimension'),
    note: tr('메모', 'Note'),
    marker: tr('마커', 'Marker'),
  };
  return (
    <div className="props-inner">
      <div className="props-title">
        {names[a.type]}
        <span className="grow" />
        <button type="button" className="mini-btn danger" title={tr('삭제 (Del)', 'Delete (Del)')} onClick={() => removeAnnotation(a.id)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <Section title={tr('속성', 'Properties')}>
        {a.type === 'arrow' && (
          <>
            <Field label={tr('라벨', 'Label')} wide>
              <TextInput value={a.label} onChange={(v) => up({ label: v })} />
            </Field>
            <Field label={tr('원인 신호', 'From signal')} wide>
              <Select value={a.from.signalId} onChange={(v) => up({ from: { ...a.from, signalId: v } } as Partial<Annotation>)} options={sigOpts.slice(1)} />
            </Field>
            <Field label={tr('원인 시각', 'From time')}>
              <TimeInput value={a.from.t} onChange={(v) => v !== undefined && up({ from: { ...a.from, t: v } } as Partial<Annotation>)} />
            </Field>
            <Field label={tr('결과 신호', 'To signal')} wide>
              <Select value={a.to.signalId} onChange={(v) => up({ to: { ...a.to, signalId: v } } as Partial<Annotation>)} options={sigOpts.slice(1)} />
            </Field>
            <Field label={tr('결과 시각', 'To time')}>
              <TimeInput value={a.to.t} onChange={(v) => v !== undefined && up({ to: { ...a.to, t: v } } as Partial<Annotation>)} />
            </Field>
            <Check checked={!!a.dashed} onChange={(v) => up({ dashed: v } as Partial<Annotation>)} label={tr('점선 (간접 조건)', 'Dashed (indirect)')} />
            <p className="muted small">
              {tr('지연', 'Delay')}: {formatTime(a.to.t - a.from.t, project.settings.timeUnit)}
            </p>
          </>
        )}
        {a.type === 'dimension' && (
          <>
            <Field label={tr('라벨 (비우면 자동)', 'Label (auto if empty)')} wide>
              <TextInput value={a.label} onChange={(v) => up({ label: v })} placeholder={formatTime(Math.abs(a.t2 - a.t1), project.settings.timeUnit)} />
            </Field>
            <Field label={tr('행', 'Row')} wide>
              <Select value={a.signalId ?? ''} onChange={(v) => up({ signalId: v || null } as Partial<Annotation>)} options={sigOpts} />
            </Field>
            <div className="grid2">
              <Field label={tr('시작', 'Start')}>
                <TimeInput value={a.t1} onChange={(v) => v !== undefined && up({ t1: v } as Partial<Annotation>)} />
              </Field>
              <Field label={tr('끝', 'End')}>
                <TimeInput value={a.t2} onChange={(v) => v !== undefined && up({ t2: v } as Partial<Annotation>)} />
              </Field>
            </div>
          </>
        )}
        {a.type === 'note' && (
          <>
            <Field label={tr('내용', 'Text')} wide>
              <TextInput value={a.text} onChange={(v) => up({ text: v } as Partial<Annotation>)} />
            </Field>
            <Field label={tr('행', 'Row')} wide>
              <Select value={a.signalId ?? ''} onChange={(v) => up({ signalId: v || null } as Partial<Annotation>)} options={sigOpts} />
            </Field>
            <Field label={tr('시각', 'Time')}>
              <TimeInput value={a.t} onChange={(v) => v !== undefined && up({ t: v } as Partial<Annotation>)} />
            </Field>
          </>
        )}
        {a.type === 'marker' && (
          <>
            <Field label={tr('라벨', 'Label')} wide>
              <TextInput value={a.label} onChange={(v) => up({ label: v })} />
            </Field>
            <Field label={tr('시각', 'Time')}>
              <TimeInput value={a.t} onChange={(v) => v !== undefined && up({ t: v } as Partial<Annotation>)} />
            </Field>
            <Field label={tr('색상', 'Color')} wide>
              <ColorInput value={a.color ?? '#16a34a'} onChange={(v) => up({ color: v } as Partial<Annotation>)} />
            </Field>
          </>
        )}
        <button type="button" className="btn small" onClick={() => revealTime(a.type === 'arrow' ? a.from.t : a.type === 'dimension' ? a.t1 : a.t)}>
          {tr('위치로 이동', 'Scroll to')}
        </button>
      </Section>
    </div>
  );
}

function StepProps({ step }: { step: Step }) {
  const project = useStore((s) => s.project);
  const { updateStep, removeStep } = useStore.getState();
  const up = (patch: Partial<Step>) => updateStep(step.id, patch);
  const idx = project.steps.findIndex((s) => s.id === step.id);
  return (
    <div className="props-inner">
      <div className="props-title">
        {tr('공정 스텝', 'Process step')}
        <span className="grow" />
        <button type="button" className="mini-btn danger" title={tr('삭제 (Del)', 'Delete (Del)')} onClick={() => removeStep(step.id)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <Section title={tr('속성', 'Properties')}>
        <Field label={tr('이름', 'Name')} wide>
          <TextInput value={step.label} onChange={(v) => up({ label: v })} />
        </Field>
        <div className="grid2">
          <Field label={tr('시작', 'Start')}>
            <TimeInput value={step.start} onChange={(v) => v !== undefined && up({ start: v })} />
          </Field>
          <Field label={tr('끝', 'End')}>
            <TimeInput value={step.end} onChange={(v) => v !== undefined && up({ end: v })} />
          </Field>
        </div>
        <p className="muted small">
          {tr('소요 시간', 'Duration')}: <b>{formatTime(step.end - step.start, project.settings.timeUnit)}</b>
        </p>
        <Field label={tr('설명 (동작 내용)', 'Description')} wide>
          <TextInput value={step.description} onChange={(v) => up({ description: v })} />
        </Field>
        <Field label={tr('색상', 'Color')} wide>
          <div className="swatches">
            {STEP_COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${c === step.color ? 'on' : ''}`} style={{ background: c }} onClick={() => up({ color: c })} aria-label={c} />
            ))}
          </div>
        </Field>
        <p className="muted small">
          #{idx + 1} / {project.steps.length}
        </p>
      </Section>
    </div>
  );
}

function RuleProps({ rule }: { rule: TimingRule }) {
  const project = useStore((s) => s.project);
  const { updateRule, removeRule, revealTime } = useStore.getState();
  const up = (patch: Partial<TimingRule>) => updateRule(rule.id, patch);
  const res = useMemo(() => checkRule(project, rule), [project, rule]);
  const sigOpts = project.signals.filter((s) => s.kind === 'bit' || s.kind === 'clock').map((s) => ({ value: s.id, label: s.address ? `${s.address} ${s.name}` : s.name }));
  const edgeOpts = [
    { value: 'rise' as EdgeKind, label: tr('↑ 상승', '↑ rise') },
    { value: 'fall' as EdgeKind, label: tr('↓ 하강', '↓ fall') },
  ];
  return (
    <div className="props-inner">
      <div className="props-title">
        {tr('타이밍 규칙', 'Timing rule')}
        <span className={`status ${res.status}`}>{res.status === 'ok' ? 'OK' : res.status === 'fail' ? 'NG' : 'N/A'}</span>
        <span className="grow" />
        <button type="button" className="mini-btn danger" title={tr('삭제 (Del)', 'Delete (Del)')} onClick={() => removeRule(rule.id)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <Section title={tr('조건', 'Condition')}>
        <Field label={tr('이름', 'Name')} wide>
          <TextInput value={rule.name} onChange={(v) => up({ name: v })} />
        </Field>
        {rule.type === 'delay' && (
          <>
            <Field label={tr('원인', 'From')} wide>
              <Select value={rule.fromSignal} onChange={(v) => up({ fromSignal: v } as Partial<TimingRule>)} options={sigOpts} />
            </Field>
            <Field label={tr('원인 에지', 'From edge')} wide>
              <Select value={rule.fromEdge} onChange={(v) => up({ fromEdge: v } as Partial<TimingRule>)} options={edgeOpts} />
            </Field>
            <Field label={tr('결과', 'To')} wide>
              <Select value={rule.toSignal} onChange={(v) => up({ toSignal: v } as Partial<TimingRule>)} options={sigOpts} />
            </Field>
            <Field label={tr('결과 에지', 'To edge')} wide>
              <Select value={rule.toEdge} onChange={(v) => up({ toEdge: v } as Partial<TimingRule>)} options={edgeOpts} />
            </Field>
          </>
        )}
        {rule.type === 'exclusive' && (
          <>
            <Field label="A" wide>
              <Select value={rule.a} onChange={(v) => up({ a: v } as Partial<TimingRule>)} options={sigOpts} />
            </Field>
            <Field label="B" wide>
              <Select value={rule.b} onChange={(v) => up({ b: v } as Partial<TimingRule>)} options={sigOpts} />
            </Field>
          </>
        )}
        {rule.type === 'pulse' && (
          <>
            <Field label={tr('신호', 'Signal')} wide>
              <Select value={rule.signal} onChange={(v) => up({ signal: v } as Partial<TimingRule>)} options={sigOpts} />
            </Field>
            <Field label={tr('레벨', 'Level')} wide>
              <Select value={String(rule.level)} onChange={(v) => up({ level: v === '1' ? 1 : 0 } as Partial<TimingRule>)} options={[{ value: '1', label: 'ON' }, { value: '0', label: 'OFF' }]} />
            </Field>
          </>
        )}
        {rule.type !== 'exclusive' && (
          <div className="grid2">
            {rule.type !== 'cycle' && (
              <Field label={tr('최소', 'Min')}>
                <TimeInput value={rule.min} allowEmpty onChange={(v) => up({ min: v } as Partial<TimingRule>)} placeholder="-" />
              </Field>
            )}
            <Field label={tr('최대', 'Max')}>
              <TimeInput value={rule.max} allowEmpty={rule.type !== 'cycle'} onChange={(v) => up({ max: v } as Partial<TimingRule>)} placeholder="-" />
            </Field>
          </div>
        )}
      </Section>
      <Section title={tr('결과', 'Result')}>
        <p className="small">
          {tr('측정값', 'Measured')}: <b>{res.measured}</b>
        </p>
        {res.violations.map((v, i) => (
          <button type="button" key={i} className="link" onClick={() => revealTime(v.t0)}>
            {v.message}
          </button>
        ))}
      </Section>
    </div>
  );
}
