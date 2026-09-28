import { useStore } from '../store/store';
import { readTextSmart } from '../io/files';
import { tr } from '../i18n';

/** PLC 프로그램/코멘트 파일 읽기: PDF 면 텍스트 추출, 아니면 텍스트로 */
export async function readProgramFile(f: File): Promise<{ text: string } | null> {
  const s = useStore.getState();
  const head = new Uint8Array(await f.slice(0, 5).arrayBuffer());
  const { isPdf } = await import('../io/pdf');
  if (!isPdf(f.name, head)) return { text: await readTextSmart(f) };
  s.toast(tr(`${f.name} PDF에서 글자를 읽는 중…`, `Reading text from ${f.name}…`), 'info');
  try {
    const { extractPdfText } = await import('../io/pdf');
    const r = await extractPdfText(await f.arrayBuffer());
    if (r.chars === 0) {
      s.toast(tr('PDF에 글자 정보가 없습니다 (스캔 이미지). XG5000에서 "Microsoft Print to PDF"로 다시 인쇄해 주세요.', 'This PDF has no text layer (scanned image).'), 'error');
      return null;
    }
    s.toast(tr(`PDF ${r.pages}쪽에서 글자 ${r.chars.toLocaleString()}자를 읽었습니다`, `Read ${r.chars} characters from ${r.pages} pages`), 'ok');
    return { text: r.text };
  } catch (e) {
    s.toast(tr('PDF를 읽지 못했습니다: ', 'Could not read PDF: ') + (e as Error).message, 'error');
    return null;
  }
}
