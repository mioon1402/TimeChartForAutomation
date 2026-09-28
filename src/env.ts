/**
 * 온라인 체험판 빌드 여부 (VITE_WEB_TRIAL=1).
 * 체험판은 claude.ai 링크 안에서 열리며, 그 환경은 인쇄와 파일 다운로드를 막는다.
 * 그래서 체험판에서는 인쇄·저장·내보내기 대신 파일 버전 안내와 클립보드 복사를 보여 준다.
 */
export const WEB_TRIAL = import.meta.env.VITE_WEB_TRIAL === '1';
