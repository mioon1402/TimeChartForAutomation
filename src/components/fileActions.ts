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
import { tr } from '../i18n';

type FileHandle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> };
let handle: FileHandle | null = null;

const g = () => useStore.getState();

function confirmDiscard(): boolean {
  if (!g().dirty) return true;
  return window.confirm(tr('저장하지 않은 변경 내용이 있습니다. 계속할까요?', 'You have unsaved changes. Continue?'));
}

export function newProject() {
  if (!confirmDiscard()) return;
  handle = null;
  g().loadProject(newEmptyProject());
  g().setTab('editor');
}

export function loadSample() {
  if (!confirmDiscard()) return;
  handle = null;
  g().loadProject(sampleProject());
  g().setTab('editor');
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
  if (!confirmDiscard()) return;
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]> };
  if (w.showOpenFilePicker) {
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

export function exportTct() {
  downloadText(`${base()}.tct`, serializeDsl(g().project));
}
