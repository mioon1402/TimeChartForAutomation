/**
 * 작성 도우미: 실무 순서(설비 → 동작 기기 → I/O 목록 → 동작 순서 → 확인)대로 입력하면 타임차트를 만든다.
 * 각 단계 위에 "이 단계가 무엇이고 왜 하는지" 짧은 설명을 둔다.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import {
  actionText,
  addrStyleName,
  buildProject,
  computeTimeline,
  defaultSpec,
  ioPoints,
  kindDefaults,
  LABEL_PAIRS,
  newAction,
  newDevice,
  suggestActions,
  type AddrStyle,
  type DeviceKind,
  type SeqAction,
  type SeqDevice,
  type SeqSpec,
} from '../model/sequence';
import { formatTime } from '../model/format';
import { storageGet, storageSet } from '../storage';
import { tr } from '../i18n';
import { askConfirm, Check, Field, Icon, Modal, Select, TextInput } from './ui';
import { confirmDiscard } from './fileActions';

const DRAFT_KEY = 'timechart-studio.wizard-draft.v1';

function loadDraft(): SeqSpec | null {
  try {
    const raw = storageGet(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SeqSpec) : null;
  } catch {
    return null;
  }
}

const KINDS: { value: DeviceKind; label: string; help: string }[] = [
  { value: 'cyl2', label: '실린더 (더블 SOL)', help: '전진 SOL, 후진 SOL 두 개. 신호를 끊어도 그 자리에 머뭅니다.' },
  { value: 'cyl1', label: '실린더 (싱글 SOL)', help: 'SOL 하나. 켜면 전진하고, 끄면 스프링으로 돌아옵니다.' },
  { value: 'motor', label: '모터', help: '운전 출력 하나. 기동부터 정지까지 켜져 있습니다.' },
  { value: 'vacuum', label: '흡착 · 척', help: 'SOL 하나와 흡착(잡힘) 확인 센서.' },
];

/** 초 단위 숫자 입력 (값은 ms) */
function SecInput({ value, onChange, id }: { value: number; onChange: (ms: number) => void; id?: string }) {
  const [v, setV] = useState(String(value / 1000));
  useEffect(() => setV(String(value / 1000)), [value]);
  const commit = () => {
    const n = parseFloat(v.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 1000));
    else setV(String(value / 1000));
  };
  return (
    <span className="sec-input">
      <input id={id} className="input mono" type="number" min={0} step={0.1} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span>{tr('초', 's')}</span>
    </span>
  );
}

function Why({ children }: { children: string }) {
  return <p className="wiz-why">{children}</p>;
}

const PAGES = () => [
  tr('설비', 'Machine'),
  tr('동작 기기', 'Devices'),
  tr('I/O 목록', 'I/O list'),
  tr('동작 순서', 'Sequence'),
  tr('확인 · 만들기', 'Review'),
];

export function SequenceWizard({ mode, onClose }: { mode: 'new' | 'edit'; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [spec, setSpec] = useState<SeqSpec>(() => (mode === 'edit' && project.sequence ? project.sequence : loadDraft() ?? defaultSpec()));
  const [page, setPage] = useState(0);
  const pages = PAGES();

  useEffect(() => {
    storageSet(DRAFT_KEY, JSON.stringify(spec));
  }, [spec]);

  const set = (patch: Partial<SeqSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setDevice = (id: string, patch: Partial<SeqDevice>) => setSpec((s) => ({ ...s, devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  const setAction = (id: string, patch: Partial<SeqAction>) => setSpec((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const io = useMemo(() => ioPoints(spec), [spec]);
  const tl = useMemo(() => computeTimeline(spec), [spec]);
  const cycle = tl.cycleEnd - tl.cycleStart;

  const create = async () => {
    if (mode === 'edit') {
      const ok = await askConfirm(tr('차트 다시 만들기', 'Rebuild chart'), tr('동작 순서대로 차트를 다시 만듭니다. 차트에서 직접 고친 파형·화살표·주석은 사라집니다. 계속할까요?', 'The chart is rebuilt from the sequence. Manual edits to waveforms, arrows and notes are lost. Continue?'), tr('다시 만들기', 'Rebuild'));
      if (!ok) return;
    } else if (!(await confirmDiscard())) return;
    const s = useStore.getState();
    const p = buildProject(spec);
    if (mode === 'edit') p.meta = { ...s.project.meta, ...p.meta, company: s.project.meta.company, checker: s.project.meta.checker, approver: s.project.meta.approver, revision: s.project.meta.revision };
    s.loadProject(p);
    s.setTab('editor');
    s.setBottom('steps');
    s.toast(tr(`타임차트를 만들었습니다: ${tl.groups.length}단계, 사이클 타임 ${formatTime(cycle, 'auto')}`, `Chart created: ${tl.groups.length} steps, cycle ${formatTime(cycle, 'auto')}`), 'ok');
    onClose();
  };

  const devOpts = [
    ...spec.devices.flatMap((d) => [
      { value: `${d.id}:fwd`, label: `${d.name} ${d.fwdLabel}` },
      { value: `${d.id}:ret`, label: `${d.name} ${d.retLabel}` },
    ]),
    { value: ':wait', label: tr('대기 (타이머)', 'Wait (timer)') },
  ];
  const moveAction = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= spec.actions.length) return;
    const a = [...spec.actions];
    [a[i], a[j]] = [a[j], a[i]];
    a[0] = { ...a[0], withPrev: false };
    set({ actions: a });
  };
  const timeOf = new Map(tl.items.map((it) => [it.action.id, it]));
  const maxEnd = Math.max(tl.cycleEnd, 1);

  const body = [
    // ① 설비
    <div className="wiz-page" key="m">
      <Why>
        {tr(
          '타임차트는 설비가 한 사이클 동안 언제 무엇이 움직이는지 시간 순서로 그린 그림입니다. 실무에서는 ① 설비 사양 → ② 동작 기기 → ③ I/O 목록 → ④ 동작 순서 → ⑤ 타임차트·검토 순서로 만들고, 이 도우미도 같은 순서로 진행합니다. 먼저 어떤 설비인지 적습니다.',
          'A timing chart shows when each part of a machine moves during one cycle. In practice it is made in this order: machine spec → moving devices → I/O list → sequence → chart and review. This wizard follows the same order. Start with the machine.',
        )}
      </Why>
      <div className="grid2">
        <Field label={tr('설비 이름', 'Machine')}>
          <TextInput value={spec.machine} onChange={(v) => set({ machine: v })} placeholder={tr('예: 프레스 압입 설비', 'e.g. Press-fit machine')} />
        </Field>
        <Field label={tr('차트 제목', 'Chart title')} hint={tr('비우면 "설비 이름 + 동작 타임차트"', 'Empty = machine name + "timing chart"')}>
          <TextInput value={spec.title} onChange={(v) => set({ title: v })} />
        </Field>
        <Field label={tr('도면 번호', 'Drawing no.')}>
          <TextInput value={spec.drawingNo} onChange={(v) => set({ drawingNo: v })} />
        </Field>
        <Field label={tr('작성자', 'Author')}>
          <TextInput value={spec.author} onChange={(v) => set({ author: v })} />
        </Field>
      </div>
      <Field label={tr('목표 사이클 타임', 'Target cycle time')} wide hint={tr('고객이나 공정이 요구하는 한 사이클 시간(택트 타임). 0이면 검토를 생략합니다.', 'The cycle (tact) time the process requires. 0 skips the check.')}>
        <SecInput value={spec.targetCycle} onChange={(ms) => set({ targetCycle: ms })} />
      </Field>
    </div>,

    // ② 동작 기기
    <div className="wiz-page" key="d">
      <Why>
        {tr(
          '설비에서 움직이는 것을 적습니다. 실린더는 솔레노이드 밸브(SOL, PLC 출력)로 움직이고, 끝에 도착했는지는 센서(PLC 입력)로 확인합니다. 동작 시간은 한쪽 끝에서 반대쪽 끝까지 가는 시간입니다. 모르면 0.5초로 두고 나중에 실측값으로 고치세요. 예시로 두 개가 들어 있으니 내 설비에 맞게 고치세요.',
          'List what moves. A cylinder is driven by a solenoid valve (SOL, a PLC output) and a sensor (a PLC input) confirms it arrived. Motion time is end-to-end travel time; use 0.5 s if unsure and correct it later. Two examples are filled in.',
        )}
      </Why>
      <div className="wiz-table-wrap">
        <table className="tbl wiz-table">
          <thead>
            <tr>
              <th>{tr('이름', 'Name')}</th>
              <th>{tr('종류', 'Type')}</th>
              <th>{tr('동작 이름 (가기 / 돌아오기)', 'Motion names (go / return)')}</th>
              <th>{tr('가는 시간', 'Go time')}</th>
              <th>{tr('돌아오는 시간', 'Return time')}</th>
              <th>{tr('끝 센서', 'Sensors')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {spec.devices.map((d) => (
              <tr key={d.id}>
                <td>
                  <TextInput value={d.name} onChange={(v) => setDevice(d.id, { name: v })} />
                </td>
                <td>
                  <Select value={d.kind} onChange={(k: DeviceKind) => setDevice(d.id, { kind: k, ...kindDefaults(k) })} options={KINDS.map((k) => ({ value: k.value, label: tr(k.label, k.label) }))} />
                </td>
                <td>
                  <div className="wiz-labels">
                    <TextInput value={d.fwdLabel} onChange={(v) => setDevice(d.id, { fwdLabel: v })} />
                    <TextInput value={d.retLabel} onChange={(v) => setDevice(d.id, { retLabel: v })} />
                    <select className="input" value="" aria-label={tr('자주 쓰는 이름', 'Common names')} onChange={(e) => {
                      const p = LABEL_PAIRS[Number(e.target.value)];
                      if (p) setDevice(d.id, { fwdLabel: p[0], retLabel: p[1] });
                    }}>
                      <option value="">{tr('자주 쓰는 이름…', 'Common…')}</option>
                      {LABEL_PAIRS.map((p, i) => (
                        <option key={i} value={i}>
                          {p[0]} / {p[1]}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td>
                  <SecInput value={d.fwdTime} onChange={(ms) => setDevice(d.id, { fwdTime: ms })} />
                </td>
                <td>
                  <SecInput value={d.retTime} onChange={(ms) => setDevice(d.id, { retTime: ms })} />
                </td>
                <td>{d.kind !== 'motor' && <input type="checkbox" checked={d.sensors} aria-label={tr('끝 센서', 'Sensors')} onChange={(e) => setDevice(d.id, { sensors: e.target.checked })} />}</td>
                <td>
                  <button type="button" className="mini-btn danger" title={tr('삭제', 'Delete')} onClick={() => set({ devices: spec.devices.filter((x) => x.id !== d.id), actions: spec.actions.filter((a) => a.device !== d.id) })}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wiz-row-btns">
        {KINDS.map((k) => (
          <button type="button" key={k.value} className="btn small" onClick={() => set({ devices: [...spec.devices, newDevice(k.value, k.value === 'motor' ? tr('모터', 'Motor') : k.value === 'vacuum' ? tr('흡착', 'Vacuum') : tr(`실린더 ${spec.devices.length + 1}`, `Cylinder ${spec.devices.length + 1}`))] })}>
            <Icon name="plus" size={13} /> {k.label}
          </button>
        ))}
      </div>
      <ul className="wiz-legend">
        {KINDS.map((k) => (
          <li key={k.value}>
            <b>{k.label}</b> {k.help}
          </li>
        ))}
      </ul>
    </div>,

    // ③ I/O 목록
    <div className="wiz-page" key="io">
      <Why>
        {tr(
          'I/O 는 PLC 와 기기를 잇는 신호입니다. 출력(Output)은 PLC 가 켜는 것(솔레노이드, 모터), 입력(Input)은 PLC 가 읽는 것(버튼, 센서)입니다. 기기에서 자동으로 뽑았으니 PLC 주소 방식을 고르고, 실제 배선과 다른 곳만 고치세요. 아직 주소가 정해지지 않았으면 "주소 없이"를 고르세요.',
          'I/O are the signals between the PLC and the machine. Outputs are what the PLC turns on (solenoids, motors); inputs are what it reads (buttons, sensors). They were derived from the devices; pick the address style and fix anything that differs from the wiring.',
        )}
      </Why>
      <div className="wiz-io-top">
        <Field label={tr('주소 방식', 'Address style')}>
          <Select value={spec.addrStyle} onChange={(v: AddrStyle) => set({ addrStyle: v })} options={(['mitsubishi', 'ls', 'siemens', 'none'] as AddrStyle[]).map((s) => ({ value: s, label: tr(addrStyleName(s), addrStyleName(s)) }))} />
        </Field>
        <Check checked={spec.startButton} onChange={(v) => set({ startButton: v })} label={tr('시작 버튼 넣기', 'Include a start button')} />
        <button type="button" className="btn small" onClick={() => set({ ioEdits: {} })} title={tr('직접 고친 주소와 이름을 지우고 자동 번호로', 'Discard edits and renumber')}>
          {tr('자동 번호로 되돌리기', 'Renumber')}
        </button>
      </div>
      <div className="wiz-io-cols">
        {(['in', 'out'] as const).map((dir) => (
          <div key={dir}>
            <h4>
              {dir === 'in' ? tr('입력 (버튼 · 센서)', 'Inputs (buttons, sensors)') : tr('출력 (SOL · 모터)', 'Outputs (SOL, motors)')} · {io.filter((p) => p.dir === dir).length}
            </h4>
            <table className="tbl wiz-table">
              <thead>
                <tr>
                  <th>{tr('주소', 'Address')}</th>
                  <th>{tr('이름', 'Name')}</th>
                </tr>
              </thead>
              <tbody>
                {io
                  .filter((p) => p.dir === dir)
                  .map((p) => (
                    <tr key={p.key}>
                      <td className="wiz-addr">
                        <TextInput mono value={p.address} onChange={(v) => set({ ioEdits: { ...spec.ioEdits, [p.key]: { ...spec.ioEdits[p.key], address: v } } })} />
                      </td>
                      <td>
                        <TextInput value={p.name} onChange={(v) => set({ ioEdits: { ...spec.ioEdits, [p.key]: { ...spec.ioEdits[p.key], name: v } } })} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>,

    // ④ 동작 순서
    <div className="wiz-page" key="s">
      <Why>
        {tr(
          '한 사이클 동안 움직이는 순서를 적습니다. 보통은 앞 동작이 끝난 것을 센서로 확인하고 다음 동작을 시작합니다. 서로 부딪히지 않는 동작은 "앞 동작과 동시에"로 바꾸면 사이클 타임이 줄어듭니다. 마지막에는 모든 기기가 처음 위치로 돌아와야 다음 사이클을 시작할 수 있습니다.',
          'List the motions in one cycle. Normally the next motion starts after a sensor confirms the previous one finished. Motions that cannot collide can start "together with previous" to shorten the cycle. Every device must be back home at the end.',
        )}
      </Why>
      <div className="wiz-table-wrap">
        <table className="tbl wiz-table">
          <thead>
            <tr>
              <th>{tr('스텝', 'Step')}</th>
              <th>{tr('동작', 'Motion')}</th>
              <th>{tr('시작', 'Starts')}</th>
              <th>{tr('시간', 'Time')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {spec.actions.map((a, i) => {
              const it = timeOf.get(a.id);
              const val = a.device ? `${a.device}:${a.dir}` : ':wait';
              return (
                <tr key={a.id} className={a.withPrev ? 'wiz-par' : ''}>
                  <td className="mono">{it ? `S${(it.group + 1) * 10}` : ''}</td>
                  <td>
                    <div className="wiz-action">
                      <Select
                        value={val}
                        onChange={(v) => {
                          const [dev, dir] = v.split(':');
                          setAction(a.id, dev ? { device: dev, dir: dir as 'fwd' | 'ret' } : { device: '' });
                        }}
                        options={devOpts}
                      />
                      {!a.device && (
                        <>
                          <TextInput value={a.label} onChange={(v) => setAction(a.id, { label: v })} placeholder={tr('무엇을 기다리나 (가공, 건조…)', 'What for (machining…)')} />
                          <SecInput value={a.wait} onChange={(ms) => setAction(a.id, { wait: ms })} />
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    {i === 0 ? (
                      <span className="muted small">{spec.startButton ? tr('시작 버튼', 'Start button') : tr('처음', 'First')}</span>
                    ) : (
                      <Select
                        value={a.withPrev ? 'with' : 'after'}
                        onChange={(v) => setAction(a.id, { withPrev: v === 'with' })}
                        options={[
                          { value: 'after', label: tr('앞 동작이 끝난 뒤', 'After previous') },
                          { value: 'with', label: tr('앞 동작과 동시에', 'With previous') },
                        ]}
                      />
                    )}
                  </td>
                  <td className="mono small wiz-time">{it ? `${(it.start / 1000).toFixed(1)} – ${(it.end / 1000).toFixed(1)} s` : ''}</td>
                  <td className="wiz-row-tools">
                    <button type="button" className="mini-btn" title={tr('위로', 'Up')} onClick={() => moveAction(i, -1)} disabled={i === 0}>
                      ▲
                    </button>
                    <button type="button" className="mini-btn" title={tr('아래로', 'Down')} onClick={() => moveAction(i, 1)} disabled={i === spec.actions.length - 1}>
                      ▼
                    </button>
                    <button type="button" className="mini-btn danger" title={tr('삭제', 'Delete')} onClick={() => set({ actions: spec.actions.filter((x) => x.id !== a.id).map((x, k) => (k === 0 ? { ...x, withPrev: false } : x)) })}>
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="wiz-row-btns">
        <button type="button" className="btn small" disabled={!spec.devices.length} onClick={() => set({ actions: [...spec.actions, newAction({ device: spec.devices[0]?.id ?? '', dir: 'fwd' })] })}>
          <Icon name="plus" size={13} /> {tr('동작 추가', 'Add motion')}
        </button>
        <button type="button" className="btn small" onClick={() => set({ actions: [...spec.actions, newAction({ device: '', wait: 1000 })] })}>
          <Icon name="plus" size={13} /> {tr('대기 추가', 'Add wait')}
        </button>
        <button
          type="button"
          className="btn small"
          title={tr('기기 순서대로 가고 → 작업 대기 → 거꾸로 돌아오는 순서를 넣습니다', 'Go out in order, wait, come back in reverse')}
          onClick={async () => {
            if (spec.actions.length && !(await askConfirm(tr('자동 제안', 'Suggest'), tr('지금 적은 동작 순서를 지우고 기본 순서로 바꿀까요?', 'Replace the current sequence with a default one?'), tr('바꾸기', 'Replace')))) return;
            set({ actions: suggestActions(spec.devices) });
          }}
        >
          <Icon name="wand" size={13} /> {tr('자동 제안', 'Suggest')}
        </button>
      </div>
      <Notes notes={tl.notes} />
    </div>,

    // ⑤ 확인
    <div className="wiz-page" key="r">
      <Why>
        {tr(
          '예상 사이클 타임과 동작 흐름을 확인하고 차트를 만듭니다. 차트에는 출력(SOL)·센서 파형, 실린더 동작선, "센서 확인 → 다음 동작" 화살표, 공정 스텝, 목표 사이클 타임과 인터록(전진·후진 SOL 동시 ON 금지) 검사가 들어갑니다.',
          'Check the estimated cycle time and flow, then build the chart. It includes output and sensor waveforms, cylinder motion, "sensor confirms → next motion" arrows, process steps, and checks for the target cycle time and interlocks.',
        )}
      </Why>
      <div className="wiz-kpis">
        <div className="wiz-kpi">
          <span>{tr('예상 사이클 타임', 'Estimated cycle time')}</span>
          <b>{formatTime(cycle, 's')}</b>
        </div>
        {spec.targetCycle > 0 && (
          <div className={`wiz-kpi ${cycle <= spec.targetCycle ? 'ok' : 'ng'}`}>
            <span>
              {tr('목표', 'Target')} {formatTime(spec.targetCycle, 's')}
            </span>
            <b>{cycle <= spec.targetCycle ? `OK (${tr('여유', 'margin')} ${formatTime(spec.targetCycle - cycle, 's')})` : `NG (+${formatTime(cycle - spec.targetCycle, 's')})`}</b>
          </div>
        )}
        <div className="wiz-kpi">
          <span>{tr('구성', 'Contents')}</span>
          <b>
            {tr(`${tl.groups.length}단계 · 기기 ${spec.devices.length} · 입력 ${io.filter((p) => p.dir === 'in').length} · 출력 ${io.filter((p) => p.dir === 'out').length}`, `${tl.groups.length} steps · ${spec.devices.length} devices · ${io.filter((p) => p.dir === 'in').length} in · ${io.filter((p) => p.dir === 'out').length} out`)}
          </b>
        </div>
      </div>
      <div className="wiz-gantt">
        {tl.groups.map((g, i) => (
          <div className="wiz-gantt-row" key={i}>
            <span className="wiz-gantt-label">
              S{(i + 1) * 10} {g.items.map((it) => actionText(it.action, spec.devices)).join(' + ')}
            </span>
            <span className="wiz-gantt-track">
              <span className="wiz-gantt-bar" style={{ left: `${(g.start / maxEnd) * 100}%`, width: `${Math.max(0.6, ((g.end - g.start) / maxEnd) * 100)}%` }} />
            </span>
            <span className="wiz-gantt-time mono">{formatTime(g.end - g.start, 's')}</span>
          </div>
        ))}
        {!tl.groups.length && <p className="muted">{tr('동작 순서가 비어 있습니다. ④ 동작 순서에서 적어 주세요.', 'The sequence is empty. Fill in step 4.')}</p>}
      </div>
      <Notes notes={tl.notes} />
      <p className="muted small">
        {tr('만든 뒤에도 차트에서 파형을 직접 고칠 수 있고, 파일 → 동작 순서 고치기로 이 도우미를 다시 열 수 있습니다. PLC 프로그램이 생기면 PLC 탭에서 시뮬레이션해 이 차트와 비교해 보세요.', 'You can edit the chart afterwards, or reopen this wizard via File → Edit sequence. Once a PLC program exists, simulate it in the PLC tab and compare.')}
      </p>
    </div>,
  ];

  const footer = (
    <>
      {page > 0 && (
        <button type="button" className="btn" onClick={() => setPage(page - 1)}>
          {tr('이전', 'Back')}
        </button>
      )}
      <span className="grow" />
      {page < pages.length - 1 ? (
        <button type="button" className="btn primary" onClick={() => setPage(page + 1)}>
          {tr('다음', 'Next')}: {pages[page + 1]}
        </button>
      ) : (
        <button type="button" className="btn primary" onClick={create} disabled={!tl.groups.length}>
          <Icon name="chart" size={15} /> {mode === 'edit' ? tr('차트 다시 만들기', 'Rebuild chart') : tr('타임차트 만들기', 'Create chart')}
        </button>
      )}
    </>
  );

  return (
    <Modal title={mode === 'edit' ? tr('동작 순서 고치기', 'Edit sequence') : tr('순서대로 새 차트 만들기', 'New chart, step by step')} onClose={onClose} width={960} footer={footer}>
      <div className="wiz">
        <ol className="wiz-nav">
          {pages.map((p, i) => (
            <li key={p}>
              <button type="button" className={`wiz-nav-btn ${i === page ? 'on' : ''} ${i < page ? 'done' : ''}`} onClick={() => setPage(i)}>
                <span className="wiz-num">{i < page ? '✓' : i + 1}</span>
                {p}
              </button>
            </li>
          ))}
        </ol>
        <div className="wiz-body">{body[page]}</div>
      </div>
    </Modal>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="wiz-notes">
      <b>{tr('검토할 점', 'To check')}</b>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
