import { beforeEach, describe, expect, it } from 'vitest';
import { bookFromProject, mergeAutosave, migrateDocument, serializeDocument, sheetName, uniqueSheetName } from '../src/model/book';
import { createProject, sampleProject } from '../src/model/project';
import { useStore } from '../src/store/store';

const chart = (title: string, sheet?: string) => {
  const p = createProject();
  p.meta.title = title;
  if (sheet) p.sheet = sheet;
  return p;
};

describe('machine file (several charts)', () => {
  it('saves one chart in the old project format and several as a book', () => {
    const one = bookFromProject(chart('자동 사이클'));
    expect(JSON.parse(serializeDocument(one)).format).toBe('timechart-studio');
    const two = { ...one, name: '압입기', sheets: [chart('자동 사이클'), chart('원점 복귀', '원점')], active: 1 };
    const json = serializeDocument(two);
    expect(JSON.parse(json).format).toBe('timechart-studio-book');
    const back = migrateDocument(JSON.parse(json));
    expect(back.name).toBe('압입기');
    expect(back.active).toBe(1);
    expect(back.sheets.map(sheetName)).toEqual(['자동 사이클', '원점']);
    // 예전 파일도 그대로 열린다
    const old = migrateDocument(JSON.parse(JSON.stringify(sampleProject())));
    expect(old.sheets).toHaveLength(1);
  });

  it('never loses a chart when merging the two autosave slots', () => {
    const a = chart('A');
    const b = chart('B');
    const book = { format: 'timechart-studio-book', version: 1, id: 'bk', name: '', sheets: [a, b], active: 0 };
    // 같은 차트면 최신본으로 바꾸고 그 차트를 보여 준다
    const newerB = { ...b, meta: { ...b.meta, title: 'B 고침' } };
    const m1 = mergeAutosave(JSON.parse(JSON.stringify(book)), JSON.parse(JSON.stringify(newerB)))!;
    expect(m1.sheets.map((s) => s.meta.title)).toEqual(['A', 'B 고침']);
    expect(m1.active).toBe(1);
    // 이전 버전 앱에서 다른 차트를 작업했으면 그 차트를 더한다
    const other = chart('이전 버전에서 만든 차트');
    const m2 = mergeAutosave(JSON.parse(JSON.stringify(book)), JSON.parse(JSON.stringify(other)))!;
    expect(m2.sheets.map((s) => s.meta.title)).toEqual(['A', 'B', '이전 버전에서 만든 차트']);
    // 설비 키가 없으면 예전처럼 차트 한 장
    expect(mergeAutosave(null, JSON.parse(JSON.stringify(a)))!.sheets).toHaveLength(1);
    expect(mergeAutosave(null, null)).toBeNull();
    // 한쪽이 망가져도 다른 쪽은 살린다
    expect(mergeAutosave('{broken', JSON.parse(JSON.stringify(a)))!.sheets[0].meta.title).toBe('A');
  });

  it('keeps sheet names unique', () => {
    expect(uniqueSheetName([chart('자동'), chart('자동 (2)')], '자동')).toBe('자동 (3)');
    expect(uniqueSheetName([chart('자동')], '원점')).toBe('원점');
  });
});

describe('store: switching charts', () => {
  beforeEach(() => {
    useStore.getState().loadProject(chart('자동 사이클'));
  });

  it('adds, switches, renames, moves and removes charts with their own undo history', () => {
    const s = () => useStore.getState();
    s().setMeta({ machine: '압입기' });
    expect(s().past).toHaveLength(1);
    s().addSheet(chart('원점 복귀'));
    expect(s().activeSheet).toBe(1);
    expect(s().past).toHaveLength(0);
    s().setMeta({ author: '홍' });
    s().switchSheet(0);
    expect(s().project.meta.title).toBe('자동 사이클');
    expect(s().past).toHaveLength(1); // 첫 차트의 실행 취소 기록 그대로
    s().switchSheet(1);
    expect(s().project.meta.author).toBe('홍'); // 두 번째 차트에서 고친 내용 유지
    expect(s().past).toHaveLength(1);
    s().renameSheet(1, '원점');
    expect(sheetName(s().project)).toBe('원점');
    s().moveSheet(1, -1);
    expect(s().getDocument().sheets.map(sheetName)).toEqual(['원점', '자동 사이클']);
    expect(s().activeSheet).toBe(0);
    s().removeSheet(0);
    expect(s().getDocument().sheets.map(sheetName)).toEqual(['자동 사이클']);
    expect(s().project.meta.machine).toBe('압입기');
    // 마지막 한 장은 지울 수 없다
    s().removeSheet(0);
    expect(s().getDocument().sheets).toHaveLength(1);
  });

  it('opening a single chart closes the other charts', () => {
    const s = () => useStore.getState();
    s().addSheet(chart('원점 복귀'));
    expect(s().getDocument().sheets).toHaveLength(2);
    s().loadProject(chart('다른 파일'));
    expect(s().getDocument().sheets).toHaveLength(1);
    expect(s().project.meta.title).toBe('다른 파일');
  });
});
