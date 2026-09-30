import { useStore, newEmptyProject } from '../store/store';
import { sampleProject } from '../model/project';
import { downloadText, openTextFile, readTextSmart, safeFileName } from '../io/files';
import { importWaveDrom, exportWaveDrom } from '../io/wavedrom';
import { exportChangeTable, exportSignalList, exportStepTable, importCsvLog } from '../io/csv';
import { serializeDsl, parseDsl } from '../io/dsl';
import { copyPngToClipboard, downloadPng, downloadSvg } from '../render/exportImage';
import { checkRules } from '../model/analysis';
import { parseLooseJson } from '../io/json5';
import type { Project } from '../model/types';
import { templates } from '../model/templates';
import { tr } from '../i18n';
import { WEB_TRIAL } from '../env';
import { askConfirm } from './ui';
import { defaultSpec, type SeqSpec } from '../model/sequence';
import { autoTitle, emptySpec, newSequenceProject } from '../model/seqEdit';
import { documentTitle, isBookJson, migrateDocument, serializeDocument, sheetName } from '../model/book';
import { uid } from '../model/wave';

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
let handle: FileHandle | null = null;

const g = () => useStore.getState();

/** 저장하지 않은 변경이 있으면 앱 안의 확인 창으로 묻는다 (브라우저 confirm 은 막힌 환경이 있음) */
export async function confirmDiscard(): Promise<boolean> {
  if (!g().dirty) return true;
  return askConfirm(
    tr('저장하지 않은 변경', 'Unsaved changes'),
    tr('지금 차트를 다른 차트로 바꾸면 저장하지 않은 변경 내용이 사라집니다. 계속할까요?', 'Replacing the chart discards unsaved changes. Continue?'),
    tr('계속', 'Continue'),
  );
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  handle = null;
  g().loadProject(newEmptyProject());
  g().setTab('editor');
}

// ───────────────────────── 설비 파일의 차트(시트) ─────────────────────────

/** 같은 설비의 표제란(회사·설비·작성·검토·승인)을 새 차트에 이어 받는다 */
function inheritMeta(p: Project): Project {
  const m = g().project.meta;
  return { ...p, meta: { ...p.meta, company: m.company, machine: m.machine, drawingNo: m.drawingNo, author: m.author, checker: m.checker, approver: m.approver, revision: m.revision || p.meta.revision, logo: m.logo, signLabels: m.signLabels } };
}

export function addBlankSheet() {
  const p = inheritMeta(newEmptyProject());
  p.meta.title = tr('새 타임차트', 'New timing chart');
  p.sheet = tr('새 차트', 'New chart');
  g().addSheet(p);
  g().setTab('editor');
}

export function addSequenceSheet() {
  const p = inheritMeta(newSequenceProject(emptySpec()));
  p.sheet = tr('새 동작 순서', 'New sequence');
  p.meta.title = chartTitle(p.meta.machine, p.sheet);
  g().addSheet(p);
  g().setTab('sequence');
}

export function duplicateSheet() {
  const cur = g().project;
  const copy: Project = { ...structuredClone(cur), id: uid('prj'), sheet: `${sheetName(cur)} ${tr('복사', 'copy')}` };
  g().addSheet(copy);
}

export function addTemplateSheet(id: string) {
  const t = templates().find((x) => x.id === id);
  if (!t) return;
  g().addSheet(inheritMeta(t.build()));
  g().setTab('editor');
}

/** 차트 이름으로 만든 제목 */
function chartTitle(machine: string, sheet: string): string {
  return `${machine ? `${machine} ` : ''}${sheet} 타임차트`;
}

/** 차트 이름 바꾸기: 제목이 자동으로 붙인 것이면 제목도 함께 */
export function renameSheet(i: number, name: string) {
  const s = g();
  const p = s.getDocument().sheets[i];
  if (!p) return;
  const old = sheetName(p);
  const m = p.meta;
  const auto = [autoTitle(m.machine), autoTitle(''), chartTitle(m.machine, old), chartTitle('', old), old, tr('새 타임차트', 'New timing chart')];
  s.renameSheet(i, name);
  if (auto.includes(m.title) && name.trim()) {
    const title = chartTitle(m.machine, name.trim());
    if (i === g().activeSheet) g().setMeta({ title });
    else useStore.setState((st) => ({ sheets: st.sheets.map((x, k) => (k === i ? { ...x, meta: { ...x.meta, title } } : x)), dirty: true }));
  }
}

export async function deleteSheet(i: number) {
  const s = g();
  const doc = s.getDocument();
  const p = doc.sheets[i];
  if (!p || doc.sheets.length <= 1) return;
  const ok = await askConfirm(tr('차트 삭제', 'Delete chart'), tr(`"${sheetName(p)}" 차트를 설비 파일에서 지울까요? 이 삭제는 실행 취소(Ctrl+Z)로 되돌릴 수 없습니다.`, `Delete "${sheetName(p)}" from this file? This cannot be undone with Ctrl+Z.`), tr('삭제', 'Delete'));
  if (ok) s.removeSheet(i);
}

/** 동작 순서표로 새 차트 (동작 순서 탭에서 이어서 적는다) */
export async function newSequenceChart(spec: SeqSpec = defaultSpec()): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  handle = null;
  g().loadProject(newSequenceProject(spec));
  g().setTab('sequence');
  return true;
}

/** 글자를 클립보드로 (막힌 환경이면 알림) */
export async function copyText(text: string, okMessage: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    g().toast(okMessage, 'ok');
    return true;
  } catch {
    g().toast(tr('이 브라우저에서는 클립보드 복사가 막혀 있습니다.', 'Clipboard access is blocked in this browser.'), 'warn');
    return false;
  }
}

export async function loadSample() {
  if (!(await confirmDiscard())) return;
  handle = null;
  g().loadProject(sampleProject());
  g().setTab('editor');
}

export async function loadTemplate(id: string) {
  const t = templates().find((x) => x.id === id);
  if (!t || !(await confirmDiscard())) return;
  handle = null;
  g().loadProject(t.build());
  g().setTab('editor');
}

/** 어느 탭에서든 Ctrl+P → 보고서 탭으로 이동 후 인쇄 */
export function printReport() {
  const s = g();
  if (WEB_TRIAL) {
    s.setTab('report');
    s.toast(tr('온라인 체험판에서는 인쇄가 막혀 있습니다. 파일 버전(TimeChartStudio.html)에서 인쇄하세요.', 'Printing is blocked in the online trial. Use the file version.'), 'warn');
    return;
  }
  if (s.tab !== 'report') {
    s.setTab('report');
    setTimeout(() => window.print(), 400);
  } else window.print();
}

/** 가져온 차트: 설비 파일(차트 여러 장)을 쓰는 중이면 새 차트로 추가, 아니면 지금 차트 대신 */
function placeImported(p: Project, fileName = '') {
  const s = g();
  if (s.sheets.length > 1) {
    s.addSheet(p);
    s.toast(tr(`"${sheetName(p)}" 을(를) 새 차트로 추가했습니다`, `Added "${sheetName(p)}" as a new chart`), 'info');
  } else s.loadProject(p, fileName);
}

/** 파일 내용으로 형식을 판별하여 불러오기 */
export function loadFromText(name: string, text: string): boolean {
  const s = g();
  try {
    if (/\.tct$/i.test(name)) {
      const r = parseDsl(text);
      if (r.errors.length) s.toast(tr(`텍스트 오류 ${r.errors.length}건 (줄 ${r.errors[0].line}: ${r.errors[0].message})`, `${r.errors.length} text errors`), 'warn');
      placeImported(r.project, name);
      return true;
    }
    if (/\.csv$|\.tsv$/i.test(name)) {
      const r = importCsvLog(text);
      r.project.meta.title = name.replace(/\.[^.]+$/, '');
      placeImported(r.project);
      r.warnings.forEach((w) => s.toast(w, 'warn'));
      s.toast(tr(`CSV 로그 ${r.project.signals.length}개 신호를 가져왔습니다`, `Imported ${r.project.signals.length} signals from CSV`), 'ok');
      return true;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = parseLooseJson(text);
    }
    const o = data as Record<string, unknown>;
    if (o && (o.format === 'timechart-studio' || isBookJson(o))) {
      const doc = migrateDocument(o);
      s.loadDocument(doc, name);
      s.toast(doc.sheets.length > 1 ? tr(`${name} 을(를) 열었습니다 (차트 ${doc.sheets.length}장)`, `Opened ${name} (${doc.sheets.length} charts)`) : tr(`${name} 을(를) 열었습니다`, `Opened ${name}`), 'ok');
      return true;
    }
    if (o && Array.isArray(o.signal)) {
      const r = importWaveDrom(text, s.project.settings.grid || 100);
      placeImported(r.project);
      r.warnings.forEach((w) => s.toast(w, 'warn'));
      s.toast(tr('WaveDrom 파형을 가져왔습니다', 'Imported WaveDrom'), 'ok');
      return true;
    }
    throw new Error(tr('알 수 없는 파일 형식입니다', 'Unknown file format'));
  } catch (e) {
    s.toast(`${name}: ${(e as Error).message}`, 'error');
    return false;
  }
}

export async function openProject() {
  if (!(await confirmDiscard())) return;
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]> };
  if (w.showOpenFilePicker && !WEB_TRIAL) {
    try {
      const [h] = await w.showOpenFilePicker({
        types: [{ description: 'TimeChart', accept: { 'application/json': ['.tchart', '.json'], 'text/plain': ['.tct', '.csv', '.txt'] } }],
      });
      const f = await h.getFile();
      if (loadFromText(f.name, await readTextSmart(f)) && /\.(tchart|json)$/i.test(f.name)) handle = h as unknown as FileHandle;
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const f = await openTextFile('.tchart,.json,.tct,.csv,.txt');
  if (f) {
    handle = null;
    loadFromText(f.name, f.text);
  }
}

export async function importFile(accept: string) {
  const f = await openTextFile(accept);
  if (f) loadFromText(f.name, f.text);
}


export async function saveProject(saveAs = false) {
  const s = g();
  if (WEB_TRIAL) {
    s.toast(tr('온라인 체험판에서는 파일 저장이 막혀 있습니다. 작업 내용은 이 브라우저에 자동 백업됩니다. [내보내기 → TCT 텍스트 복사]로 내용을 옮길 수 있습니다.', 'Saving files is blocked in the online trial. Work is auto-backed up in this browser; use Export → Copy TCT text.'), 'warn');
    return;
  }
  const doc = s.getDocument();
  const json = serializeDocument(doc);
  const name = `${safeFileName(documentTitle(doc))}.tchart`;
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> };
  try {
    if (handle && !saveAs) {
      const wr = await handle.createWritable();
      await wr.write(json);
      await wr.close();
      s.markSaved(handle.name);
      s.toast(tr(`저장됨: ${handle.name}`, `Saved: ${handle.name}`), 'ok');
      return;
    }
    if (w.showSaveFilePicker) {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'TimeChart Studio', accept: { 'application/json': ['.tchart'] } }] });
      const wr = await h.createWritable();
      await wr.write(json);
      await wr.close();
      handle = h;
      s.markSaved(h.name);
      s.toast(tr(`저장됨: ${h.name}`, `Saved: ${h.name}`), 'ok');
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  downloadText(name, json, 'application/json');
  s.markSaved(name);
  s.toast(tr(`다운로드 폴더에 ${name} 저장`, `Downloaded ${name}`), 'ok');
}

const base = () => safeFileName(g().project.meta.title);

export async function exportPng() {
  const p = g().project;
  try {
    await downloadPng(p, `${base()}.png`, { title: true, violations: checkRules(p).flatMap((r) => r.violations) });
  } catch (e) {
    g().toast((e as Error).message, 'error');
  }
}

export async function copyPng() {
  const p = g().project;
  try {
    const ok = await copyPngToClipboard(p, { title: true });
    g().toast(ok ? tr('차트 이미지를 클립보드에 복사했습니다 (엑셀/파워포인트에 붙여넣기)', 'Chart image copied to clipboard') : tr('이 브라우저는 이미지 복사를 지원하지 않습니다', 'Image copy not supported'), ok ? 'ok' : 'warn');
  } catch (e) {
    g().toast((e as Error).message, 'error');
  }
}

export function exportSvg() {
  downloadSvg(g().project, `${base()}.svg`, { title: true });
}

export function exportCsv(kind: 'changes' | 'signals' | 'steps') {
  const p = g().project;
  const text = kind === 'changes' ? exportChangeTable(p) : kind === 'signals' ? exportSignalList(p) : exportStepTable(p);
  const suffix = kind === 'changes' ? tr('변화표', 'changes') : kind === 'signals' ? tr('신호목록', 'signals') : tr('스텝표', 'steps');
  downloadText(`${base()}_${suffix}.csv`, text, 'text/csv;charset=utf-8');
}

export function exportWaveDromFile() {
  const r = exportWaveDrom(g().project);
  r.warnings.forEach((w) => g().toast(w, 'warn'));
  downloadText(`${base()}.wavedrom.json`, r.source, 'application/json');
}

/** TCT 텍스트를 클립보드로 (체험판 ↔ 파일 버전 간 옮기기) */
export async function copyTct() {
  const text = serializeDsl(g().project);
  try {
    await navigator.clipboard.writeText(text);
    g().toast(tr('TCT 텍스트를 복사했습니다. 다른 곳의 [텍스트 코드] 탭에 붙여넣고 [차트에 적용]하면 됩니다.', 'TCT text copied. Paste it into the Text code tab elsewhere and Apply.'), 'ok');
  } catch {
    g().setTab('text');
    g().toast(tr('클립보드 복사가 막혀 있습니다. [텍스트 코드] 탭에서 직접 선택해 복사하세요.', 'Clipboard blocked. Select and copy from the Text code tab.'), 'warn');
  }
}

export function exportTct() {
  downloadText(`${base()}.tct`, serializeDsl(g().project));
}
