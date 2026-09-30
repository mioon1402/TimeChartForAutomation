/** CSV/TSV 한 줄 분리 (따옴표 지원) */
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** 텍스트의 구분자 추정 (탭 > 콤마 > 세미콜론) */
export function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 50).join('\n');
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  const semis = (sample.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (commas >= semis && commas > 0) return ',';
  if (semis > 0) return ';';
  return ',';
}

export function splitLines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
}

export interface SourceLine {
  /** 1부터 시작하는 원본 줄 번호 */
  line: number;
  tokens: string[];
  comment: string;
  text: string;
}

/**
 * 니모닉 텍스트를 줄 단위 토큰으로 분리.
 * 주석: ;  //  (* *)  ' (줄 시작)
 */
export function tokenizeMnemonic(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  const lines = splitLines(text);
  let inBlock = false;
  lines.forEach((raw, idx) => {
    let s = raw;
    let comment = '';
    if (inBlock) {
      const end = s.indexOf('*)');
      if (end < 0) return;
      s = s.slice(end + 2);
      inBlock = false;
    }
    const bs = s.indexOf('(*');
    if (bs >= 0) {
      const be = s.indexOf('*)', bs + 2);
      if (be >= 0) {
        comment = s.slice(bs + 2, be).trim();
        s = s.slice(0, bs) + s.slice(be + 2);
      } else {
        comment = s.slice(bs + 2).trim();
        s = s.slice(0, bs);
        inBlock = true;
      }
    }
    const sl = s.indexOf('//');
    if (sl >= 0) {
      comment = s.slice(sl + 2).trim() || comment;
      s = s.slice(0, sl);
    }
    const sc = s.indexOf(';');
    if (sc >= 0) {
      comment = s.slice(sc + 1).trim() || comment;
      s = s.slice(0, sc);
    }
    const tokens = s
      .replace(/,/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0 && !comment) return;
    out.push({ line: idx + 1, tokens, comment, text: raw.trim() });
  });
  return out;
}

/**
 * GX Works 등에서 내보낸 CSV/TSV 명령 리스트를 "명령 오퍼랜드..." 줄로 변환.
 * 헤더에서 명령/디바이스 열을 찾고, 명령이 비어 있는 행은 앞 명령의 오퍼랜드로 이어 붙인다.
 * CSV 형식이 아니면 null.
 */
export function csvInstructionListToLines(text: string): SourceLine[] | null {
  const lines = splitLines(text);
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 2) return null;
  const quoted = nonEmpty.filter((l) => /^\s*"/.test(l)).length;
  const delim = detectDelimiter(nonEmpty);
  if (quoted < nonEmpty.length * 0.5 && delim !== '\t') return null;
  const rows = lines.map((l) => splitCsvLine(l, delim));
  let header = -1;
  let instrCol = -1;
  let devCol = -1;
  let noteCol = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const ic = r.findIndex((c) => /^(instruction|命令|명령|니모닉|mnemonic)/i.test(c));
    if (ic >= 0) {
      header = i;
      instrCol = ic;
      devCol = r.findIndex((c) => /(i\/o|device|デバイス|디바이스|operand|오퍼랜드)/i.test(c));
      noteCol = r.findIndex((c) => /^(note|注釈|노트|주석|comment|설명)/i.test(c));
      break;
    }
  }
  if (header < 0) return null;
  if (devCol < 0) devCol = instrCol + 1;
  const out: SourceLine[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i];
    const instr = (r[instrCol] ?? '').trim();
    const dev = (r[devCol] ?? '').trim();
    const note = noteCol >= 0 ? (r[noteCol] ?? '').trim() : '';
    if (!instr && !dev) continue;
    if (!instr && dev && out.length) {
      out[out.length - 1].tokens.push(...dev.split(/\s+/));
      continue;
    }
    const tokens = [...instr.split(/\s+/), ...(dev ? dev.split(/\s+/) : [])];
    out.push({ line: i + 1, tokens, comment: note, text: lines[i].trim() });
  }
  return out;
}
