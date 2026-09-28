/**
 * PDF → 텍스트 (pdf.js, 오프라인).
 * XG5000 처럼 니모닉(IL)을 인쇄/PDF 로만 내보내는 경우에 사용한다.
 * 한글 CMap 을 파일 안에 포함하여 인터넷 없이도 한글 PDF 를 읽는다.
 */
import { itemsToLines, type PdfTextItem } from './pdfLines';

// 한글 관련 CMap (필요할 때만 풀어서 사용)
const CMAPS = import.meta.glob('../../node_modules/pdfjs-dist/cmaps/{Adobe-Korea1-*,KSC*,UniKS-*}.bcmap', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>;

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class InlineBinaryDataFactory {
  constructor(_opts: unknown) {
    void _opts;
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind === 'cMapUrl') {
      const key = Object.keys(CMAPS).find((k) => k.endsWith('/' + filename));
      if (key) return dataUrlToBytes(await CMAPS[key]());
    }
    throw new Error(`${filename} 없음`);
  }
}

export interface PdfText {
  text: string;
  pages: number;
  /** 추출된 글자 수 (0 이면 이미지만 있는 PDF) */
  chars: number;
}

let loaded: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!loaded) {
    loaded = (async () => {
      // 별도 워커 파일 없이 메인 스레드에서 실행 (단일 HTML 파일 배포용)
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
      (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
      return import('pdfjs-dist');
    })();
  }
  return loaded;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfText> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    BinaryDataFactory: InlineBinaryDataFactory,
    cMapUrl: 'inline/',
    cMapPacked: true,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    useWasm: false,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const out: string[] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const tr = it.transform as number[];
      const h = Math.hypot(tr[2], tr[3]) || it.height || 10;
      items.push({ str: it.str, x: tr[4], y: tr[5], w: it.width, h });
      chars += it.str.trim().length;
    }
    out.push(...itemsToLines(items), '');
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text: out.join('\n'), pages, chars };
}

export function isPdf(name: string, head?: Uint8Array): boolean {
  if (/\.pdf$/i.test(name)) return true;
  return !!head && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}
