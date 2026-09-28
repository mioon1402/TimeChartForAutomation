/**
 * 간단한 이중 언어 지원: tr('한국어', 'English')
 * 컴포넌트는 스토어의 lang 을 구독하므로 언어 변경 시 다시 렌더링된다.
 */
export type Lang = 'ko' | 'en';

let current: Lang = 'ko';

export function setLang(l: Lang): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export function getLang(): Lang {
  return current;
}

export function tr(ko: string, en: string): string {
  return current === 'en' ? en : ko;
}
