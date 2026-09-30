/**
 * 온라인 체험판 빌드 여부 (VITE_WEB_TRIAL=1).
 * 체험판은 claude.ai 링크 안에서 열리며, 그 환경은 인쇄와 파일 다운로드를 막는다.
 * 그래서 체험판에서는 인쇄·저장·내보내기 대신 파일 버전 안내와 클립보드 복사를 보여 준다.
 */
export const WEB_TRIAL = import.meta.env.VITE_WEB_TRIAL === '1';

/** 공개 저장소: 사용 설명서, 문제 신고 */
export const REPO_URL = 'https://github.com/mioon1402/TimeChartForAutomation';
export const GUIDE_URL = `${REPO_URL}#readme`;
export const ISSUES_URL = `${REPO_URL}/issues`;

/** 웹 주소(GitHub Pages)에서 열었을 때 같은 곳에 있는 오프라인용 단일 HTML 파일 */
export const OFFLINE_FILE = 'TimeChartStudio.html';

/** 소개 페이지 (편집기가 /app/ 에 있을 때 한 단계 위) */
export function introUrl(): string | null {
  if (!servedFromWeb()) return null;
  return /\/app\/(index\.html)?$/.test(location.pathname) ? '../' : null;
}

/** 웹 주소로 열었는가 (파일로 열었거나 체험판이면 false) */
export function servedFromWeb(): boolean {
  return !WEB_TRIAL && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
}
