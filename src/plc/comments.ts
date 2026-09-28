import type { PlcDialect } from './types';
import { normDevice } from './devices';
import { detectDelimiter, splitCsvLine, splitLines } from './text';

const DEVICE_RE = /^(%?[A-Z]{1,3}[0-9][0-9A-F]*(\.[0-9A-F]+)?|%[IQM][XBWD]?\d+(\.\d+)?|[A-Z]{1,2}\s?\d+(\.\d+)?|DB\d+\.DB[XBWD]\d+(\.\d+)?)$/i;
const NOISE_RE = /^(BOOL|BIT|WORD|DWORD|INT|DINT|UINT|REAL|LREAL|TIME|BYTE|STRING|O|X|-|사용|미사용|VAR|VAR_GLOBAL|\d+)$/i;

/**
 * 디바이스 코멘트 파일 파싱 (GX Works 코멘트 CSV, XG5000 변수/코멘트, TIA 태그 테이블, "X0 시작버튼" 텍스트)
 * → 디바이스 → 설명
 */
export function parseDeviceComments(text: string, dialect: PlcDialect): Map<string, string> {
  const out = new Map<string, string>();
  const lines = splitLines(text).filter((l) => l.trim());
  if (!lines.length) return out;
  const delim = detectDelimiter(lines);
  const hasDelim = lines.some((l) => l.includes(delim));
  for (const line of lines) {
    let cells: string[];
    if (hasDelim && line.includes(delim)) cells = splitCsvLine(line, delim);
    else if (/\S\s{2,}\S/.test(line)) {
      // PDF 에서 추출한 표: 넓은 공백이 열 구분
      cells = line.trim().split(/\s{2,}/);
    } else {
      const m = /^\s*(\S+)\s+(.+)$/.exec(line);
      if (!m) continue;
      cells = [m[1], m[2].trim()];
    }
    cells = cells.map((c) => c.replace(/^"|"$/g, '').trim());
    const devIdx = cells.findIndex((c) => DEVICE_RE.test(c) && !NOISE_RE.test(c));
    if (devIdx < 0) continue;
    const dev = normDevice(cells[devIdx], dialect === 'st' ? 'st' : dialect);
    const cand = (c: string, i: number) => i !== devIdx && c && !NOISE_RE.test(c) && !DEVICE_RE.test(c);
    const after = cells.map((c, i) => ({ c, i })).filter(({ c, i }) => i > devIdx && cand(c, i));
    const before = cells.map((c, i) => ({ c, i })).filter(({ c, i }) => i < devIdx && cand(c, i));
    const comment = after.length ? after[after.length - 1].c : before.length ? before[0].c : '';
    if (comment && !out.has(dev)) out.set(dev, comment);
    // ST: 변수 이름으로도 조회 가능하게
    if (dialect === 'st' && before.length && comment) out.set(before[0].c.toUpperCase(), comment);
  }
  return out;
}
