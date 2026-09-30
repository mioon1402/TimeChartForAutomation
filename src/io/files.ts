/** 브라우저 파일 입출력 도우미 */

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(name: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(name, new Blob([text], { type: mime }));
}

export interface OpenedFile {
  name: string;
  text: string;
}

/** 파일 선택 대화상자 → 텍스트 (UTF-8, 실패 시 EUC-KR 재시도) */
export function openTextFile(accept: string): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await readTextSmart(f) });
    };
    input.click();
  });
}

/** 파일 선택 대화상자 → File */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** UTF-8/UTF-16 BOM 처리, 깨진 문자가 많으면 EUC-KR(CP949)로 다시 해석 */
export async function readTextSmart(f: Blob): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // 깨진 문자(U+FFFD) 개수 - 소스와 빌드 결과에 문자 그대로 넣지 않도록 코드값으로 만든다
  const bad = utf8.split(String.fromCharCode(0xfffd)).length - 1;
  if (bad > 2) {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8.replace(/^﻿/, '');
}

export function safeFileName(s: string): string {
  return (s || 'timechart').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'timechart';
}
