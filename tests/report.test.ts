import { describe, expect, it } from 'vitest';
import { paginateBlocks, paperSize } from '../src/components/ReportPanel';

const block = (id: string, n: number, extra: Partial<{ hasPre: boolean; hasFoot: boolean }> = {}) => ({ id, rows: Array.from({ length: n }), ...extra });

describe('report pagination', () => {
  it('puts short tables on the same page', () => {
    const pages = paginateBlocks([block('a', 5), block('b', 4), block('c', 6)], {}, 150);
    expect(pages).toHaveLength(1);
    expect(pages[0].map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('continues a long table on the next page and never leaves a lone header', () => {
    const meas = { a: { title: 8, pre: 0, head: 7, foot: 6, rows: Array(60).fill(6) } };
    const pages = paginateBlocks([block('a', 60, { hasFoot: true })], meas, 150);
    const slices = pages.flat();
    // 모든 줄이 한 번씩, 순서대로
    expect(slices.map((s) => [s.from, s.to])).toEqual(slices.map((s, i) => [i ? slices[i - 1].to : 0, s.to]));
    expect(slices[slices.length - 1].to).toBe(60);
    expect(slices[0].first).toBe(true);
    expect(slices.slice(1).every((s) => !s.first)).toBe(true);
    expect(slices.filter((s) => s.last)).toHaveLength(1);
    // 한 페이지 높이를 넘지 않는다
    for (const s of slices) expect(8 + 7 + 3 + (s.to - s.from) * 6 + (s.last ? 6 : 0)).toBeLessThanOrEqual(150);
    // 페이지 끝에 제목만 남기지 않는다: 3줄이 안 들어가면 다음 페이지로
    const two = paginateBlocks([block('x', 21), block('y', 10)], { x: { title: 8, pre: 0, head: 7, foot: 0, rows: Array(21).fill(6) } }, 150);
    const firstOfY = two.findIndex((p) => p.some((s) => s.id === 'y'));
    const ySlice = two[firstOfY].find((s) => s.id === 'y')!;
    expect(ySlice.to - ySlice.from).toBeGreaterThanOrEqual(3);
  });

  it('knows paper sizes', () => {
    expect(paperSize({ paper: 'A4', orientation: 'portrait' })).toEqual({ w: 210, h: 297 });
    expect(paperSize({ paper: 'A3', orientation: 'landscape' })).toEqual({ w: 420, h: 297 });
  });
});
