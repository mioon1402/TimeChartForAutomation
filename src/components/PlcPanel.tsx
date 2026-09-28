import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { defaultSimSettings, type DeviceInfo, type MachineModel, type PlcConfig, type PlcDialect, type PulseDef, type SimSettings, type Stimulus } from '../plc/types';
import { detectDialect, dialectName, parseProgram, type ParsedProgram } from '../plc/program';
import { parseDeviceComments } from '../plc/comments';
import { applySimulation, defaultWatch, newCylinderModel, newDelayModel, runSimulation, suggestStimuli, type SimResult } from '../plc/simulator';
import { plcSamples } from '../plc/samples';
import { formatTime } from '../model/format';
import { openTextFile } from '../io/files';
import { Check, Field, Icon, Select, TimeInput } from './ui';
import { roleOptions } from './PropertiesPanel';
import { tr } from '../i18n';

function defaultConfig(): PlcConfig {
  const s = plcSamples()[0];
  return { dialect: s.dialect, source: s.source, comments: s.comments, sim: s.sim };
}

export function parsePulses(text: string): PulseDef[] | null {
  const out: PulseDef[] = [];
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  for (const p of parts) {
    const m = /^([\d.]+(?:ms|s)?)\s*[-~]\s*([\d.]+(?:ms|s)?)$/i.exec(p);
    if (!m) return null;
    const toMs = (x: string) => (/ms$/i.test(x) ? parseFloat(x) : /s$/i.test(x) ? parseFloat(x) * 1000 : parseFloat(x));
    const a = toMs(m[1]);
    const b = toMs(m[2]);
    if (!(b > a)) return null;
    out.push({ start: a, end: b });
  }
  return out;
}

export function pulsesText(p: PulseDef[]): string {
  return p.map((x) => `${x.start}-${x.end}`).join(', ');
}

export function PlcPanel() {
  const project = useStore((s) => s.project);
  const { commit, setTab, toast, loadProject } = useStore.getState();
  const cfg: PlcConfig = project.plc ?? defaultConfig();
  const setCfg = (patch: Partial<PlcConfig>, key?: string) => commit({ ...useStore.getState().project, plc: { ...cfg, ...patch } }, key);
  const setSim = (patch: Partial<SimSettings>, key?: string) => setCfg({ sim: { ...cfg.sim, ...patch } }, key);

  // 소스 편집은 로컬 상태 → 0.4초 후 반영 (매 키 입력마다 파싱하지 않도록)
  const [src, setSrc] = useState(cfg.source);
  const [comments, setComments] = useState(cfg.comments);
  const [showComments, setShowComments] = useState(!!cfg.comments);
  useEffect(() => setSrc(cfg.source), [cfg.source]);
  useEffect(() => setComments(cfg.comments), [cfg.comments]);
  useEffect(() => {
    if (src === cfg.source && comments === cfg.comments) return;
    const h = setTimeout(() => setCfg({ source: src, comments }, 'plc-source'), 400);
    return () => clearTimeout(h);
  }, [src, comments]); // eslint-disable-line react-hooks/exhaustive-deps

  const commentMap = useMemo(() => parseDeviceComments(cfg.comments, cfg.dialect), [cfg.comments, cfg.dialect]);
  const prog: ParsedProgram = useMemo(() => parseProgram(cfg.source, cfg.dialect, commentMap), [cfg.source, cfg.dialect, commentMap]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [keepExisting, setKeepExisting] = useState(true);
  const [filter, setFilter] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const errors = prog.messages.filter((m) => m.severity === 'error');
  const sim = cfg.sim;

  const lineCount = src.split('\n').length;
  const errLines = new Set(prog.messages.map((m) => m.line));

  const jumpTo = (line: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 5) * 19);
  };

  const loadSample = (id: string) => {
    const s = plcSamples().find((x) => x.id === id);
    if (!s) return;
    setCfg({ dialect: s.dialect, source: s.source, comments: s.comments, sim: s.sim });
    setShowComments(!!s.comments);
    setResult(null);
  };

  const openSource = async () => {
    const f = await openTextFile('.txt,.csv,.il,.st,.scl,.awl,.stl,.xml,.prn,.mnm,.*');
    if (!f) return;
    const dialect = /\.(st|scl)$/i.test(f.name) ? 'st' : /\.(awl|stl)$/i.test(f.name) ? 'siemens' : detectDialect(f.text);
    const parsed = parseProgram(f.text, dialect);
    setCfg({ dialect, source: f.text, sim: { ...defaultSimSettings(), duration: sim.duration, scanTime: sim.scanTime, watch: defaultWatch(parsed), stimuli: suggestStimuli(parsed), stepDevice: parsed.stepCandidates[0] ?? '' } });
    toast(tr(`${f.name} 불러옴 (${dialectName(dialect)})`, `Loaded ${f.name} (${dialectName(dialect)})`), 'ok');
  };

  const openComments = async () => {
    const f = await openTextFile('.csv,.txt,.tsv');
    if (!f) return;
    setCfg({ comments: f.text });
    setShowComments(true);
    toast(tr('디바이스 코멘트를 불러왔습니다', 'Device comments loaded'), 'ok');
  };

  const autoSetup = () => {
    setSim({ watch: defaultWatch(prog), stimuli: suggestStimuli(prog), stepDevice: prog.stepCandidates[0] ?? sim.stepDevice });
    toast(tr('표시 디바이스와 입력 자극을 자동 설정했습니다', 'Auto-configured watch list and stimuli'), 'ok');
  };

  const run = () => {
    if (errors.length) {
      toast(tr('프로그램 오류를 먼저 수정하세요', 'Fix program errors first'), 'error');
      return;
    }
    if (!sim.watch.length) {
      toast(tr('차트에 표시할 디바이스를 선택하세요', 'Select devices to show'), 'warn');
      return;
    }
    try {
      const res = runSimulation(prog, sim);
      setResult(res);
      const base = useStore.getState().project;
      // 기존 차트와 겹치는 디바이스가 없으면 (다른 설비의 차트) 새 차트로 시작
      const watched = new Set([...sim.watch, ...prog.devices.filter((d) => sim.watch.includes(d.name)).map((d) => d.address ?? '')]);
      const overlap = base.signals.some((s) => watched.has(s.address));
      const fresh = !keepExisting || !overlap;
      const start = fresh
        ? {
            ...base,
            signals: [],
            annotations: [],
            rules: [],
            steps: [],
            meta: overlap ? base.meta : { ...base.meta, title: tr('PLC 시뮬레이션 타임차트', 'PLC simulation timing chart'), machine: '', drawingNo: '', description: '' },
          }
        : base;
      const next = applySimulation(start, prog, sim, res, { keepExisting: !fresh });
      commit({ ...next, plc: { ...cfg, source: src, comments } });
      setTimeout(() => useStore.getState().fitZoom(), 0);
      setTab('editor');
      toast(tr(`시뮬레이션 완료: ${res.scans.toLocaleString()} 스캔, ${res.runMs.toFixed(0)}ms`, `Simulated ${res.scans.toLocaleString()} scans in ${res.runMs.toFixed(0)}ms`), res.warnings.length ? 'warn' : 'ok');
    } catch (e) {
      toast(tr('시뮬레이션 실패: ', 'Simulation failed: ') + (e as Error).message, 'error');
    }
  };

  const watchSet = new Set(sim.watch);
  const stimOf = (d: string) => sim.stimuli.find((s) => s.device === d);
  const modelTargets = new Set(sim.models.flatMap((m) => (m.type === 'cylinder' ? [m.extSensor, m.retSensor] : [m.target])).filter(Boolean));
  const setStim = (d: string, s: Stimulus | null) => setSim({ stimuli: [...sim.stimuli.filter((x) => x.device !== d), ...(s ? [s] : [])] });
  const toggleWatch = (d: string, on: boolean) => {
    const order = prog.devices.map((x) => x.name);
    const next = on ? [...sim.watch, d] : sim.watch.filter((x) => x !== d);
    // 프로그램의 디바이스 순서 유지 (단, 사용자가 정한 기존 순서 우선)
    const existing = sim.watch.filter((x) => next.includes(x));
    const added = next.filter((x) => !sim.watch.includes(x)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setSim({ watch: [...existing, ...added] });
  };
  const moveWatch = (d: string, dir: -1 | 1) => {
    const i = sim.watch.indexOf(d);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sim.watch.length) return;
    const w = [...sim.watch];
    [w[i], w[j]] = [w[j], w[i]];
    setSim({ watch: w });
  };

  const outputs = prog.devices.filter((d) => d.type === 'bit' && (d.written || d.role === 'output'));
  const inputs = prog.devices.filter((d) => d.type === 'bit' && (!d.written || d.role === 'input'));
  const devOpts = (list: DeviceInfo[]) => [{ value: '', label: '—' }, ...list.map((d) => ({ value: d.name, label: d.comment ? `${d.name}  ${d.comment}` : d.name }))];
  const wordDevs = prog.devices.filter((d) => d.type === 'word');
  const stepOpts = [
    { value: '', label: tr('(스텝 자동 생성 안 함)', '(no steps)') },
    ...(prog.stepCandidates.includes('@STL') ? [{ value: '@STL', label: tr('STL 스텝 릴레이 (S)', 'STL step relays (S)') }] : []),
    ...wordDevs.map((d) => ({ value: d.name, label: `${d.name}${d.comment ? '  ' + d.comment : ''}${prog.stepCandidates.includes(d.name) ? tr('  ★추천', '  ★suggested') : ''}` })),
  ];
  const q = filter.trim().toUpperCase();
  const shownDevices = prog.devices.filter((d) => !q || d.name.toUpperCase().includes(q) || d.comment.toUpperCase().includes(q));

  return (
    <div className="plc">
      <div className="plc-col plc-src">
        <div className="plc-head">
          <h3>
            <Icon name="cpu" /> {tr('PLC 프로그램', 'PLC program')}
          </h3>
          <span className="grow" />
          <button type="button" className="btn small" onClick={openSource}>
            <Icon name="open" size={14} /> {tr('파일 열기', 'Open file')}
          </button>
        </div>
        <div className="plc-toolbar">
          <Select value={cfg.dialect} onChange={(v: PlcDialect) => setCfg({ dialect: v })} options={(['mitsubishi', 'ls', 'siemens', 'st'] as PlcDialect[]).map((d) => ({ value: d, label: dialectName(d) }))} />
          <button type="button" className="btn small" title={tr('소스에서 PLC 종류 자동 감지', 'Detect dialect from source')} onClick={() => setCfg({ dialect: detectDialect(src) })}>
            <Icon name="wand" size={14} /> {tr('자동 감지', 'Detect')}
          </button>
          <select className="input" value="" onChange={(e) => e.target.value && loadSample(e.target.value)}>
            <option value="">{tr('예제 불러오기…', 'Load example…')}</option>
            {plcSamples().map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="code">
          <div className="gutter" ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={errLines.has(i + 1) ? 'err' : ''}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={taRef}
            className="code-ta"
            spellCheck={false}
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
            }}
            placeholder={tr('여기에 니모닉(IL), STL, ST 코드를 붙여넣으세요.\nGX Works → 프로젝트 → 다른 형식으로 저장 → CSV, XG5000 → 니모닉 보기 → 복사', 'Paste IL / STL / ST code here.')}
          />
        </div>
        <div className="msgs">
          <div className="msgs-head">
            {errors.length ? (
              <span className="status fail">
                {tr('오류', 'Errors')} {errors.length}
              </span>
            ) : (
              <span className="status ok">OK</span>
            )}
            <span className="muted small">
              {dialectName(prog.dialect)} · {prog.size} {cfg.dialect === 'st' ? tr('문장', 'statements') : tr('명령', 'instructions')} · {prog.devices.length} {tr('디바이스', 'devices')}
            </span>
          </div>
          {prog.messages.slice(0, 50).map((m, i) => (
            <button type="button" key={i} className={`msg ${m.severity}`} onClick={() => jumpTo(m.line)}>
              <b>{tr('줄', 'Line')} {m.line}</b> {m.message}
            </button>
          ))}
        </div>
        <div className="comments-box">
          <div className="plc-head">
            <button type="button" className="section-toggle" onClick={() => setShowComments(!showComments)}>
              <span className="caret">{showComments ? '▾' : '▸'}</span> {tr('디바이스 코멘트 (선택)', 'Device comments (optional)')} {commentMap.size ? `· ${commentMap.size}` : ''}
            </button>
            <span className="grow" />
            <button type="button" className="btn small" onClick={openComments}>
              <Icon name="open" size={14} /> CSV
            </button>
          </div>
          {showComments && (
            <textarea
              className="code-ta small-ta"
              spellCheck={false}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={tr('"X0","시작 버튼" 또는 X0 시작버튼 형식 / GX Works 코멘트 CSV / XG5000 변수 목록', '"X0","Start PB" per line, or GX Works / XG5000 comment export')}
            />
          )}
        </div>
      </div>

      <div className="plc-col plc-devs">
        <div className="plc-head">
          <h3>{tr('디바이스 · 입력 자극', 'Devices & stimuli')}</h3>
          <span className="grow" />
          <input className="input search" placeholder={tr('검색', 'Search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="btn small" onClick={autoSetup} title={tr('입력/출력/내부 릴레이를 표시하고 시작 버튼에 펄스를 넣습니다', 'Auto-select devices and add start pulse')}>
            <Icon name="wand" size={14} /> {tr('자동 설정', 'Auto')}
          </button>
        </div>
        <p className="muted small hint">
          {tr('✔ = 차트에 표시할 디바이스. 입력은 고정값/펄스(예: 100-300, 2s-2.5s)로 자극하거나, 오른쪽 설비 모델로 출력에 반응하게 만드세요.', '✔ = shown in chart. Drive inputs with constants/pulses (e.g. 100-300, 2s-2.5s) or let equipment models respond to outputs.')}
        </p>
        <div className="dev-table-wrap">
          <table className="tbl dev-table">
            <thead>
              <tr>
                <th>✔</th>
                <th>{tr('디바이스', 'Device')}</th>
                <th>{tr('설명', 'Comment')}</th>
                <th>{tr('역할', 'Role')}</th>
                <th>{tr('입력 자극', 'Stimulus')}</th>
              </tr>
            </thead>
            <tbody>
              {shownDevices.map((d) => {
                const stim = stimOf(d.name);
                const isInput = d.type === 'bit' && !d.written;
                const byModel = modelTargets.has(d.name);
                return (
                  <tr key={d.name} className={watchSet.has(d.name) ? 'on' : ''}>
                    <td>
                      <input type="checkbox" checked={watchSet.has(d.name)} onChange={(e) => toggleWatch(d.name, e.target.checked)} />
                    </td>
                    <td className="mono">
                      {d.name}
                      {d.address && <div className="muted small">{d.address}</div>}
                    </td>
                    <td className="small">{d.comment}</td>
                    <td className="small">{roleOptions().find((o) => o.value === d.role)?.label.split(' ')[0] ?? d.role}</td>
                    <td>{isInput ? byModel ? <span className="chip model">{tr('설비 모델', 'model')}</span> : <StimEditor device={d.name} stim={stim} onChange={(s) => setStim(d.name, s)} /> : <span className="muted small">{d.written ? tr('프로그램 출력', 'program') : ''}</span>}</td>
                  </tr>
                );
              })}
              {prog.devices.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {tr('디바이스가 없습니다. 프로그램을 입력하세요.', 'No devices. Enter a program.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sim.watch.length > 0 && (
          <div className="watch-order">
            <div className="small muted">{tr('차트 행 순서', 'Chart row order')}</div>
            <div className="watch-chips">
              {sim.watch.map((w, i) => (
                <span key={w} className="chip">
                  {i > 0 && (
                    <button type="button" onClick={() => moveWatch(w, -1)} title="◀">
                      ‹
                    </button>
                  )}
                  {w}
                  {i < sim.watch.length - 1 && (
                    <button type="button" onClick={() => moveWatch(w, 1)} title="▶">
                      ›
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="plc-col plc-sim">
        <div className="plc-head">
          <h3>{tr('시뮬레이션', 'Simulation')}</h3>
        </div>
        <div className="grid2">
          <Field label={tr('스캔 타임', 'Scan time')}>
            <TimeInput value={sim.scanTime} onChange={(v) => v && setSim({ scanTime: Math.max(0.1, v) })} />
          </Field>
          <Field label={tr('시뮬레이션 시간', 'Duration')}>
            <TimeInput value={sim.duration} onChange={(v) => v && setSim({ duration: v })} />
          </Field>
          {(cfg.dialect === 'mitsubishi' || cfg.dialect === 'ls') && (
            <Field label={tr('타이머 기본 단위', 'Timer base')} hint={tr('K10 × 100ms = 1초', 'K10 × 100ms = 1 s')}>
              <Select value={String(sim.timerBase)} onChange={(v) => setSim({ timerBase: Number(v) })} options={[{ value: '1', label: '1 ms' }, { value: '10', label: '10 ms' }, { value: '100', label: '100 ms' }, { value: '1000', label: '1 s' }]} />
            </Field>
          )}
          {cfg.dialect === 'mitsubishi' && (
            <Field label={tr('시리즈', 'Series')} hint={tr('FX: T200~ 10ms 규칙', 'FX: T200+ = 10ms')}>
              <Select value={sim.mitsubishiSeries} onChange={(v) => setSim({ mitsubishiSeries: v })} options={[{ value: 'FX', label: 'FX' }, { value: 'Q', label: 'Q / L / iQ-R' }]} />
            </Field>
          )}
        </div>
        <Field label={tr('공정 스텝 디바이스', 'Step device')} wide hint={tr('값이 바뀔 때마다 공정 스텝이 자동 생성됩니다', 'Steps are generated when its value changes')}>
          <Select value={sim.stepDevice} onChange={(v) => setSim({ stepDevice: v })} options={stepOpts} />
        </Field>
        <Check checked={sim.autoTrim} onChange={(v) => setSim({ autoTrim: v })} label={tr('마지막 변화 이후 자동으로 잘라내기', 'Auto-trim after last change')} />
        <Check checked={keepExisting} onChange={setKeepExisting} label={tr('기존 신호 편집 내용(이름·색·주석·규칙) 유지', 'Keep existing edits (names, colors, annotations, rules)')} />

        <div className="plc-head models-head">
          <h3>{tr('설비 모델', 'Equipment models')}</h3>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => setSim({ models: [...sim.models, newCylinderModel({ name: tr(`실린더 ${sim.models.length + 1}`, `Cylinder ${sim.models.length + 1}`) })] })}>
            <Icon name="plus" size={13} /> {tr('실린더', 'Cylinder')}
          </button>
          <button type="button" className="btn small" onClick={() => setSim({ models: [...sim.models, newDelayModel({ name: tr(`응답 ${sim.models.length + 1}`, `Response ${sim.models.length + 1}`) })] })}>
            <Icon name="plus" size={13} /> {tr('지연 응답', 'Delay')}
          </button>
        </div>
        <p className="muted small hint">{tr('출력(솔레노이드)이 켜지면 동작 시간 뒤 센서 입력이 자동으로 ON 됩니다. 실린더 동작은 경사선으로 차트에 표시됩니다.', 'Sensors respond automatically to outputs after the motion time; cylinder strokes are drawn as slopes.')}</p>
        <div className="models">
          {sim.models.map((m) => (
            <ModelCard
              key={m.id}
              m={m}
              outOpts={devOpts(outputs)}
              inOpts={devOpts(inputs)}
              onChange={(nm) => setSim({ models: sim.models.map((x) => (x.id === m.id ? nm : x)) })}
              onRemove={() => setSim({ models: sim.models.filter((x) => x.id !== m.id) })}
            />
          ))}
          {sim.models.length === 0 && <p className="muted small">{tr('모델이 없으면 입력은 자극 설정만 따릅니다.', 'Without models, inputs follow stimuli only.')}</p>}
        </div>

        <button type="button" className="btn primary run" onClick={run} disabled={!!errors.length}>
          <Icon name="play" /> {tr('시뮬레이션 → 타임차트 생성', 'Simulate → generate chart')}
        </button>
        {result && (
          <div className="sim-result">
            <div>
              {tr('스캔', 'Scans')}: <b>{result.scans.toLocaleString()}</b> · {tr('계산', 'CPU')}: {result.runMs.toFixed(0)}ms · {tr('마지막 변화', 'Last change')}: {formatTime(result.lastChange)}
            </div>
            {result.warnings.map((w, i) => (
              <div key={i} className="msg warning">
                {w}
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn small" onClick={() => loadProject({ ...project, plc: undefined })} title={tr('저장된 PLC 설정을 프로젝트에서 제거', 'Remove PLC config from project')}>
          {tr('PLC 설정 초기화', 'Reset PLC config')}
        </button>
      </div>
    </div>
  );
}

function StimEditor({ device, stim, onChange }: { device: string; stim: Stimulus | undefined; onChange: (s: Stimulus | null) => void }) {
  const mode = stim?.mode ?? 'const0';
  const value = stim?.mode === 'const' ? (stim.value ? 'const1' : 'const0') : stim?.mode === 'pulse' ? 'pulse' : stim?.mode === 'wave' ? 'wave' : mode;
  const [text, setText] = useState(stim?.mode === 'pulse' ? pulsesText(stim.pulses) : '100-300');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (stim?.mode === 'pulse') setText(pulsesText(stim.pulses));
  }, [stim]);
  return (
    <div className="stim">
      <select
        className="input"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'const0') onChange(null);
          else if (v === 'const1') onChange({ device, mode: 'const', value: 1 });
          else onChange({ device, mode: 'pulse', pulses: parsePulses(text) ?? [{ start: 100, end: 300 }] });
        }}
      >
        <option value="const0">{tr('0 (OFF)', '0 (OFF)')}</option>
        <option value="const1">{tr('1 (ON)', '1 (ON)')}</option>
        <option value="pulse">{tr('펄스', 'Pulses')}</option>
        {stim?.mode === 'wave' && <option value="wave">{tr('파형', 'Waveform')}</option>}
      </select>
      {value === 'pulse' && (
        <input
          className={`input mono ${bad ? 'bad' : ''}`}
          value={text}
          title={tr('시작-끝 (ms), 여러 개는 콤마: 100-300, 2s-2.5s', 'start-end in ms, comma separated')}
          onChange={(e) => {
            setText(e.target.value);
            const p = parsePulses(e.target.value);
            setBad(!p);
          }}
          onBlur={() => {
            const p = parsePulses(text);
            if (p) onChange({ device, mode: 'pulse', pulses: p });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </div>
  );
}

function ModelCard({ m, outOpts, inOpts, onChange, onRemove }: { m: MachineModel; outOpts: { value: string; label: string }[]; inOpts: { value: string; label: string }[]; onChange: (m: MachineModel) => void; onRemove: () => void }) {
  return (
    <div className="model-card">
      <div className="model-head">
        <span className={`chip ${m.type === 'cylinder' ? 'cyl' : 'dly'}`}>{m.type === 'cylinder' ? tr('실린더', 'Cylinder') : tr('지연', 'Delay')}</span>
        <input className="input model-name" value={m.name} onChange={(e) => onChange({ ...m, name: e.target.value })} />
        <button type="button" className="mini-btn danger" onClick={onRemove} title={tr('삭제', 'Delete')}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {m.type === 'cylinder' ? (
        <div className="grid2">
          <Field label={tr('전진 출력', 'Extend output')}>
            <Select value={m.extend} onChange={(v) => onChange({ ...m, extend: v })} options={outOpts} />
          </Field>
          <Field label={tr('후진 출력 (더블)', 'Retract output')}>
            <Select value={m.retract} onChange={(v) => onChange({ ...m, retract: v })} options={outOpts} />
          </Field>
          <Field label={tr('전진단 센서', 'Extended sensor')}>
            <Select value={m.extSensor} onChange={(v) => onChange({ ...m, extSensor: v })} options={inOpts} />
          </Field>
          <Field label={tr('후진단 센서', 'Retracted sensor')}>
            <Select value={m.retSensor} onChange={(v) => onChange({ ...m, retSensor: v })} options={inOpts} />
          </Field>
          <Field label={tr('전진 시간', 'Extend time')}>
            <TimeInput value={m.extendTime} onChange={(v) => v !== undefined && onChange({ ...m, extendTime: v })} />
          </Field>
          <Field label={tr('후진 시간', 'Retract time')}>
            <TimeInput value={m.retractTime} onChange={(v) => v !== undefined && onChange({ ...m, retractTime: v })} />
          </Field>
          <Field label={tr('초기 위치', 'Initial')}>
            <Select value={String(m.initial)} onChange={(v) => onChange({ ...m, initial: v === '1' ? 1 : 0 })} options={[{ value: '0', label: tr('후진', 'Retracted') }, { value: '1', label: tr('전진', 'Extended') }]} />
          </Field>
        </div>
      ) : (
        <div className="grid2">
          <Field label={tr('원인 (출력)', 'Source')}>
            <Select value={m.source} onChange={(v) => onChange({ ...m, source: v })} options={outOpts} />
          </Field>
          <Field label={tr('결과 (입력)', 'Target input')}>
            <Select value={m.target} onChange={(v) => onChange({ ...m, target: v })} options={inOpts} />
          </Field>
          <Field label={tr('ON 지연', 'ON delay')}>
            <TimeInput value={m.onDelay} onChange={(v) => v !== undefined && onChange({ ...m, onDelay: v })} />
          </Field>
          <Field label={tr('OFF 지연', 'OFF delay')}>
            <TimeInput value={m.offDelay} onChange={(v) => v !== undefined && onChange({ ...m, offDelay: v })} />
          </Field>
          <Check checked={m.invert} onChange={(v) => onChange({ ...m, invert: v })} label={tr('반전 (출력 OFF일 때 ON)', 'Invert')} />
        </div>
      )}
    </div>
  );
}


