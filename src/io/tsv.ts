/**
 * 엑셀·구글 시트에서 복사한 표 (클립보드 텍스트) ↔ 2차원 배열.
 * 엑셀은 칸을 탭, 줄을 줄바꿈으로 나누고, 칸 안에 줄바꿈·탭·따옴표가 있으면 "..." 로 감싼다.
 */

/** 클립보드 텍스트 → 표. 탭이 없고 쉼표만 있으면 CSV 로 읽는다. 끝의 빈 줄은 버린다. */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = src.includes('\t') || !src.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  let atCellStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = '';
      atCellStart = true;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    atCellStart = false;
    i++;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows.map((r) => r.map((c) => c.trim()));
}

/** 표 → 엑셀에 붙여 넣을 수 있는 텍스트 */
export function toTsv(rows: string[][]): string {
  const cell = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(cell).join('\t')).join('\r\n');
}
