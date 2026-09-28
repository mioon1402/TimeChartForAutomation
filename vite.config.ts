/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';

// 압축기가 '\uFFFD' 이스케이프를 문자 그대로(깨진 문자 기호) 바꿔 넣지 않도록 결과 JS 에서 다시 이스케이프
const escapeReplacementChar = (): Plugin => ({
  name: 'escape-replacement-char',
  generateBundle(_opts, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type === 'chunk' && f.code.includes('\uFFFD')) f.code = f.code.replace(/\uFFFD/g, '\\uFFFD');
    }
  },
});

// 단일 HTML 파일로 빌드 → 설치 없이 오프라인(공장 PC, USB)에서도 실행 가능
export default defineConfig({
  base: './',
  plugins: [react(), escapeReplacementChar(), viteSingleFile()],
  // pdf.js 한글 CMap (PDF 텍스트 추출용) 을 파일 안에 포함
  assetsInclude: ['**/*.bcmap'],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
