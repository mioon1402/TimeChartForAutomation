/**
 * 설비 파일의 차트 탭 (엑셀 시트처럼): 설비 하나에 자동 운전 사이클, 원점 복귀, 유닛별 차트 …
 * 누르면 그 차트로, 두 번 누르면 이름 바꾸기. 차트마다 동작 순서·PLC 설정·표제란·실행 취소 기록이 따로 있다.
 */
import { useState } from 'react';
import { useStore } from '../store/store';
import { sheetName } from '../model/book';
import { templates } from '../model/templates';
import { tr } from '../i18n';
import { Icon, Menu } from './ui';
import * as F from './fileActions';

export function SheetBar() {
  const sheets = useStore((s) => s.sheets);
  const active = useStore((s) => s.activeSheet);
  const project = useStore((s) => s.project);
  const bookName = useStore((s) => s.bookName);
  const { switchSheet, moveSheet, setBookName } = useStore.getState();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [editBook, setEditBook] = useState(false);
  const list = sheets.map((p, i) => (i === active ? project : p));
  const many = list.length > 1;
  const book = bookName || project.meta.machine;

  const commitRename = (i: number, v: string) => {
    if (v.trim() && v.trim() !== sheetName(list[i])) F.renameSheet(i, v);
    setRenaming(null);
  };

  return (
    <div className={`sheetbar ${many ? 'many' : ''}`}>
      <span className="sb-book" title={tr('설비 이름 (여러 차트를 저장할 때 파일 이름)', 'Machine name (file name when saving several charts)')}>
        <Icon name="open" size={14} />
        {editBook ? (
          <input
            className="input sb-input"
            autoFocus
            defaultValue={book}
            placeholder={tr('설비 이름', 'Machine name')}
            onBlur={(e) => {
              if (e.target.value !== bookName) setBookName(e.target.value);
              setEditBook(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditBook(false);
            }}
          />
        ) : (
          <button type="button" className="sb-book-btn" onClick={() => setEditBook(true)}>
            {book || tr('설비 이름 없음', 'Unnamed machine')}
          </button>
        )}
      </span>
      <div className="sb-tabs" role="tablist" aria-label={tr('이 설비의 차트', 'Charts of this machine')}>
        {list.map((p, i) => (
          <div
            key={p.id}
            role="tab"
            aria-selected={i === active}
            tabIndex={0}
            className={`sb-tab ${i === active ? 'on' : ''}`}
            title={`${p.meta.title}${many ? tr('\n두 번 누르면 이름 바꾸기', '\nDouble-click to rename') : ''}`}
            onClick={() => switchSheet(i)}
            onKeyDown={(e) => e.key === 'Enter' && switchSheet(i)}
            onDoubleClick={() => setRenaming(i)}
          >
            <Icon name={p.sequence ? 'table' : p.plc?.source ? 'cpu' : 'chart'} size={13} />
            {renaming === i ? (
              <input
                className="input sb-input"
                autoFocus
                defaultValue={sheetName(p)}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => commitRename(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="sb-name">{sheetName(p)}</span>
            )}
            {i === active && (
              <span onClick={(e) => e.stopPropagation()} className="sb-menu">
                <Menu
                  label="▾"
                  items={[
                    { label: tr('이름 바꾸기', 'Rename'), icon: 'pen', onClick: () => setRenaming(i) },
                    { label: tr('복제', 'Duplicate'), icon: 'copy', onClick: F.duplicateSheet },
                    { divider: true },
                    { label: tr('왼쪽으로', 'Move left'), icon: 'up', disabled: i === 0, onClick: () => moveSheet(i, -1) },
                    { label: tr('오른쪽으로', 'Move right'), icon: 'down', disabled: i === list.length - 1, onClick: () => moveSheet(i, 1) },
                    { divider: true },
                    { label: tr('이 차트 삭제…', 'Delete this chart…'), icon: 'trash', disabled: !many, onClick: () => void F.deleteSheet(i) },
                  ]}
                />
              </span>
            )}
          </div>
        ))}
        <span className="sb-add">
          <Menu
            label={tr('+ 차트 추가', '+ Add chart')}
            items={[
              { label: tr('동작 순서표로 새 차트', 'New chart from a sequence table'), icon: 'table', onClick: F.addSequenceSheet },
              { label: tr('빈 차트', 'Blank chart'), icon: 'plus', onClick: F.addBlankSheet },
              { label: tr('지금 차트 복제', 'Duplicate this chart'), icon: 'copy', onClick: F.duplicateSheet },
              { divider: true },
              ...templates().map((t) => ({ label: tr('템플릿: ', 'Template: ') + t.name, icon: 'chart', onClick: () => F.addTemplateSheet(t.id) })),
            ]}
          />
        </span>
      </div>
      <span className="sb-hint">{many ? tr(`차트 ${list.length}장 · Ctrl+PgUp/PgDn 으로 넘기기`, `${list.length} charts · Ctrl+PgUp/PgDn`) : tr('한 설비의 차트 여러 장(자동 사이클, 원점 복귀, 유닛별 …)을 한 파일로 관리할 수 있습니다', 'Keep all charts of one machine in one file')}</span>
    </div>
  );
}
