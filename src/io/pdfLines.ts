/** PDF 텍스트 조각(위치 포함) → 줄 텍스트. 열 간격이 넓으면 공백 3칸으로 구분한다. */
export interface PdfTextItem {
  str: string;
  /** 왼쪽 x (pt) */
  x: number;
  /** 기준선 y (pt, 아래가 0) */
  y: number;
  /** 글자 폭 합계 (pt) */
  w: number;
  /** 글자 크기 (pt) */
  h: number;
}

export function itemsToLines(items: PdfTextItem[]): string[] {
  const list = items.filter((it) => it.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const it of list) {
    const row = rows[rows.length - 1];
    const tol = Math.max(1.5, 0.45 * Math.max(it.h, row?.[0]?.h ?? 0));
    if (row && Math.abs(row[0].y - it.y) <= tol) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let s = '';
    let end = -Infinity;
    for (const it of row) {
      const h = it.h || 10;
      const gap = it.x - end;
      if (s) {
        if (gap > h * 0.9) s += '   ';
        else if (gap > h * 0.12 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
      }
      s += it.str;
      end = Math.max(end, it.x + it.w);
    }
    return s.replace(/\s+$/, '');
  });
}
