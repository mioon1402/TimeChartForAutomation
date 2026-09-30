import { useStore, newEmptyProject } from '../store/store';
import { migrateProject, sampleProject } from '../model/project';
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

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
let handle: FileHandle | null = null;

const g = () => useStore.getState();

/** 저장하지 않은 변경이 있으면 앱 안의 확인 창으로 묻는다 (브라우저 confirm 은 막힌 환경이 있음) */
async function confirmDiscard(): Promise<boolean> {
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

/** 파일 내용으로 형식을 판별하여 불러오기 */
export function loadFromText(name: string, text: string): boolean {
  const s = g();
  try {
    if (/\.tct$/i.test(name)) {
      const r = parseDsl(text);
      if (r.errors.length) s.toast(tr(`텍스트 오류 ${r.errors.length}건 (줄 ${r.errors[0].line}: ${r.errors[0].message})`, `${r.errors.length} text errors`), 'warn');
      s.loadProject(r.project, name);
      return true;
    }
    if (/\.csv$|\.tsv$/i.test(name)) {
      const r = importCsvLog(text);
      r.project.meta.title = name.replace(/\.[^.]+$/, '');
      s.loadProject(r.project);
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
    if (o && o.format === 'timechart-studio') {
      s.loadProject(migrateProject(o), name);
      s.toast(tr(`${name} 을(를) 열었습니다`, `Opened ${name}`), 'ok');
      return true;
    }
    if (o && Array.isArray(o.signal)) {
      const r = importWaveDrom(text, s.project.settings.grid || 100);
      s.loadProject(r.project);
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

function projectJson(p: Project): string {
  return JSON.stringify(p, null, 1);
}

export async function saveProject(saveAs = false) {
  const s = g();
  if (WEB_TRIAL) {
    s.toast(tr('온라인 체험판에서는 파일 저장이 막혀 있습니다. 작업 내용은 이 브라우저에 자동 백업됩니다. [내보내기 → TCT 텍스트 복사]로 내용을 옮길 수 있습니다.', 'Saving files is blocked in the online trial. Work is auto-backed up in this browser; use Export → Copy TCT text.'), 'warn');
    return;
  }
  const p = s.project;
  const name = `${safeFileName(p.meta.title)}.tchart`;
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> };
  try {
    if (handle && !saveAs) {
      const wr = await handle.createWritable();
      await wr.write(projectJson(p));
      await wr.close();
      s.markSaved(handle.name);
      s.toast(tr(`저장됨: ${handle.name}`, `Saved: ${handle.name}`), 'ok');
      return;
    }
    if (w.showSaveFilePicker) {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'TimeChart Studio', accept: { 'application/json': ['.tchart'] } }] });
      const wr = await h.createWritable();
      await wr.write(projectJson(p));
      await wr.close();
      handle = h;
      s.markSaved(h.name);
      s.toast(tr(`저장됨: ${h.name}`, `Saved: ${h.name}`), 'ok');
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  downloadText(name, projectJson(p), 'application/json');
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
