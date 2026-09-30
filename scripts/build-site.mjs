// GitHub Pages 에 올릴 사이트 만들기 (npm run build:site → _site/)
//   /                      소개 페이지 (site/index.html)
//   /app/                  편집기 (단일 HTML 빌드)
//   /TimeChartStudio.html  오프라인 파일 (편집기 안의 "오프라인 버전 받기"용으로 /app/ 에도 둠)
//   /og.png                링크 공유 미리보기 이미지
import fs from 'node:fs';
import path from 'node:path';

const out = '_site';
const app = fs.readFileSync('dist/index.html');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync('site', out, { recursive: true });
fs.mkdirSync(path.join(out, 'app'), { recursive: true });
fs.writeFileSync(path.join(out, 'app', 'index.html'), app);
fs.writeFileSync(path.join(out, 'TimeChartStudio.html'), app);
fs.writeFileSync(path.join(out, 'app', 'TimeChartStudio.html'), app);
fs.copyFileSync('dist/og.png', path.join(out, 'og.png'));
console.log(`site → ${out}/ (소개 페이지, app/, 오프라인 파일, og.png)`);
