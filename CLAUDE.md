# TimeChart Studio

자동화 설비의 타임차트를 그리고, PLC 프로그램(LS XG5000 · 미쓰비시 · 지멘스 STL · IEC ST)을 스캔 시뮬레이션해서 차트를 자동으로 만들고, 보고서로 출력하는 브라우저 앱이다. 서버 없이 브라우저 안에서만 동작하고, 단일 HTML 파일로 빌드된다. 사용자는 한국 자동화·제어 엔지니어이고 UI 기본 언어는 한국어다.

- 사이트: https://mioon1402.github.io/TimeChartForAutomation/ (소개 페이지) · `/app/` (편집기)
- 사용 설명서: `README.md` (일반 사용자용, 한국어)

## 명령어

```bash
npm install
npm run dev         # 개발 서버 (편집기 화면 확인)
npm run typecheck   # 타입 검사
npm test            # 단위 테스트 (vitest)
npm run build       # 타입 검사 + dist/index.html (단일 HTML)
npm run release     # 빌드 후 release/TimeChartStudio.html 갱신 (저장소에 커밋되는 오프라인 파일)
npm run build:site  # GitHub Pages 사이트 조립 → _site/ (소개 페이지 + app/ + 오프라인 파일 + og.png)
npm run build:web   # 인쇄·다운로드가 막힌 내장 뷰어(claude.ai 아티팩트)용 체험판 → dist-web/
```

변경을 마치면 `npm run typecheck && npm test`를 통과시키고, 앱 코드를 바꿨으면 `npm run release`로 `release/TimeChartStudio.html`도 갱신해서 함께 커밋한다. 화면을 바꿨으면 `npm run dev`로 브라우저에서 직접 확인한다.

## 배포

- 혼자 쓰는 공개 저장소다. `main`에 push 하면 `.github/workflows/pages.yml`이 테스트 → `npm run build:site` → GitHub Pages 배포를 한다.
- 사이트 구성: `/` = `site/index.html` (정적 소개 페이지, 캡처 이미지는 `site/img/`), `/app/` = 편집기, `/TimeChartStudio.html` 과 `/app/TimeChartStudio.html` = 오프라인 파일, `/og.png` = 링크 미리보기 (`public/og.png`).
- 소개 페이지는 편집기로 바로 가는 링크를 쓴다: `app/#tutorial`, `#tutorial-plc`, `#practice`, `#wizard`, `#plc` (`src/App.tsx`에서 처리).
- `dist/`, `_site/`, `dist-web/` 는 빌드 결과라 커밋하지 않는다.

## 구조

```text
src/model       파형 데이터·연산(wave.ts), 분석·규칙 검증(analysis.ts), 프로젝트/예제(project.ts), 작성 도우미 모델(sequence.ts)
src/plc         PLC 파서(il.ts 미쓰비시·LS, stl.ts 지멘스, st.ts ST), LS PDF 텍스트 해석(lsStream.ts), 스캔 실행기(runtime.ts),
                시뮬레이터·설비 모델(simulator.ts: 실린더·지연·위치 축), I/O 매핑 추적(alias.ts), 예제(samples.ts)
src/learn       연습 문제(exercises.ts)와 채점(grade.ts)
src/io          PDF 텍스트 추출(pdf.ts, pdf.js + 한글 CMap), WaveDrom, CSV, TCT 텍스트, 파일 입출력
src/render      차트 그리기 (편집기·보고서·이미지 내보내기 공용 SVG)
src/components  편집기, PLC·텍스트·보고서 화면, 튜토리얼(Tour.tsx), 작성 도우미(SequenceWizard.tsx), 연습 문제(Practice.tsx)
src/store       zustand 상태 (프로젝트, 실행 취소, 자동 백업, 튜토리얼·연습 상태)
site            소개 페이지와 캡처
scripts         build-site.mjs
tests           단위 테스트
```

## 지켜야 할 것

- **회사 자료를 커밋하지 않는다.** 사용자가 주는 실제 PLC 프로그램, XG5000 PDF, 변수·설명문 목록, 그걸로 만든 차트(.tchart)는 작업용으로만 쓰고 저장소·테스트·캡처에 넣지 않는다. 테스트와 예제는 직접 만든 합성 프로그램만 쓴다. 소개 페이지 캡처(`site/img/`)도 내장 예제로만 찍는다.
- **UI 문구는 두 언어로**: `tr('한국어', 'English')` (`src/i18n.ts`). 한국어는 쉬운 말로, 엔지니어가 현장에서 쓰는 용어(SOL, 전진단, 자기유지, 인터록 등)를 그대로 쓴다.
- **저장 형식과 브라우저 저장 키를 함부로 바꾸지 않는다.** `timechart-studio.*` localStorage 키(자동 백업 `autosave.v1` 등)를 바꾸면 사용자의 작업이 사라진다. 프로젝트 형식을 바꿀 때는 `migrateProject`(`src/model/project.ts`)에서 옛 파일도 읽히게 한다.
- **연습 문제**를 추가·수정하면 `tests/learn.test.ts`에 정답 시각을 확인하는 테스트를 넣는다. 해설에 적은 시각이 시뮬레이터 결과와 맞아야 한다 (PLC 는 위에서 아래로 실행돼 한 스캔 늦게 바뀌는 경우가 있다).
- 빌드 설정의 `escapeReplacementChar` 플러그인(`vite.config.ts`)과 pdf.js CMap 인라인 처리는 PDF·한글 파일 읽기에 필요하니 지우지 않는다.
- 편집기는 오프라인 단일 파일로도 동작해야 한다. 외부 서버·CDN 에 의존하는 기능을 편집기에 넣지 않는다 (소개 페이지의 웹 폰트는 예외).

## 도메인 메모

- LS XGK: `F00099` 항상 ON, `F0009A` 항상 OFF, 타이머 기본 단위 100ms. XG5000 은 니모닉을 인쇄(PDF)로만 내보낼 수 있어서 PDF 텍스트를 토큰 흐름으로 읽는다(`lsStream.ts`). "비실행문" 렁은 빼고, "설명문"은 설명으로 처리한다.
- 많은 현장 프로그램이 실제 입력(P)을 M 릴레이로 복사해서 쓴다. `alias.ts`가 복사 렁(`LOAD P → OUT M`, 반전, 항상 ON 조건 경유, 사슬)을 따라가 실제 I/O 로 풀어 준다.
- 실무 타임차트 작성 순서: 설비 사양(목표 사이클 타임) → 동작 기기와 동작 시간 → I/O 목록 → 동작 순서 → 차트·검토(사이클 타임, 인터록). 작성 도우미가 이 순서를 따른다.
