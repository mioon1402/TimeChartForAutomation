/**
 * 설비 파일: 설비 하나의 타임차트 여러 장 (자동 운전 사이클, 원점 복귀, 유닛별 …) 을 한 파일에.
 * 엑셀의 시트처럼 차트마다 신호·스텝·동작 순서·PLC 설정·표제란을 따로 가진다.
 * 차트가 한 장이면 예전 형식(프로젝트 하나)으로 저장해서 이전 버전에서도 열린다.
 */
import type { Project } from './types';
import { migrateProject } from './project';
import { uid } from './wave';

export interface Book {
  format: 'timechart-studio-book';
  version: 1;
  id: string;
  /** 설비 이름 (파일 이름 기본값) */
  name: string;
  sheets: Project[];
  active: number;
}

export function bookFromProject(p: Project): Book {
  return { format: 'timechart-studio-book', version: 1, id: uid('book'), name: p.meta.machine || '', sheets: [p], active: 0 };
}

export function isBookJson(o: unknown): boolean {
  return !!o && typeof o === 'object' && (o as { format?: unknown }).format === 'timechart-studio-book';
}

/** 프로젝트 파일이든 설비 파일이든 읽는다 */
export function migrateDocument(raw: unknown): Book {
  if (!isBookJson(raw)) return bookFromProject(migrateProject(raw));
  const o = raw as Record<string, unknown>;
  const sheets = Array.isArray(o.sheets) ? (o.sheets as unknown[]).map((s) => migrateProject(s)) : [];
  if (!sheets.length) throw new Error('설비 파일에 차트가 없습니다.');
  // 같은 id 가 두 번 나오면 (복사해서 붙인 파일 등) 새 id
  const seen = new Set<string>();
  for (const s of sheets) {
    if (seen.has(s.id)) s.id = uid('prj');
    seen.add(s.id);
  }
  const active = Math.min(Math.max(0, Number(o.active) || 0), sheets.length - 1);
  return { format: 'timechart-studio-book', version: 1, id: typeof o.id === 'string' ? o.id : uid('book'), name: typeof o.name === 'string' ? o.name : sheets[0].meta.machine, sheets, active };
}

/** 저장할 글: 차트가 한 장이면 예전 프로젝트 형식 그대로 */
export function serializeDocument(b: Book): string {
  if (b.sheets.length === 1) return JSON.stringify(b.sheets[0], null, 1);
  return JSON.stringify(b, null, 1);
}

/** 시트 탭에 보일 짧은 이름 */
export function sheetName(p: Project): string {
  return p.sheet?.trim() || p.meta.title || '차트';
}

/** 파일 이름 */
export function documentTitle(b: Book): string {
  if (b.sheets.length === 1) return b.sheets[0].meta.title;
  return b.name || b.sheets[0].meta.machine || b.sheets[0].meta.title;
}

/**
 * 브라우저 자동 백업 두 곳을 합친다.
 *  - 예전 키(프로젝트 하나)는 지금 보고 있던 차트를 담고, 이전 버전 앱도 이 키만 읽고 쓴다.
 *  - 설비 키는 차트 전부를 담는다.
 * 이전 버전 앱으로 작업한 뒤 돌아와도 어느 쪽 차트도 잃지 않게 합친다.
 */
export function mergeAutosave(bookRaw: unknown, projectRaw: unknown): Book | null {
  let book: Book | null = null;
  let proj: Project | null = null;
  try {
    if (bookRaw) book = migrateDocument(bookRaw);
  } catch {
    book = null;
  }
  try {
    if (projectRaw) proj = migrateProject(projectRaw);
  } catch {
    proj = null;
  }
  if (!book) return proj ? bookFromProject(proj) : null;
  if (!proj) return book;
  const i = book.sheets.findIndex((s) => s.id === proj!.id);
  if (i >= 0) {
    book.sheets[i] = proj;
    book.active = i;
  } else {
    book.sheets.push(proj);
    book.active = book.sheets.length - 1;
  }
  return book;
}

/** 새 시트 이름이 겹치지 않게 */
export function uniqueSheetName(sheets: Project[], base: string): string {
  const names = new Set(sheets.map(sheetName));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
