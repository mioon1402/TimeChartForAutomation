# TimeChart Studio

자동화 설비의 제어 회로도를 그리고 시뮬레이션해서(CADe SIMU 처럼) 타임차트와 부품 리스트를 자동으로 만들고, PLC 프로그램(LS XG5000 · 미쓰비시 · 지멘스 STL · IEC ST)도 스캔 시뮬레이션해서 차트를 만들어 보고서로 출력하는 브라우저 앱이다. 회로도 탭이 중심이고 타임차트는 그 결과물(보조)이다. 서버 없이 브라우저 안에서만 동작하고, 단일 HTML 파일로 빌드된다. 사용자는 한국 자동화·제어 엔지니어이고 UI 기본 언어는 한국어다.

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
- 소개 페이지는 편집기로 바로 가는 링크를 쓴다: `app/#circuit`, `#tutorial`, `#tutorial-plc`, `#practice`, `#wizard`, `#plc` (`src/App.tsx`에서 처리).
- `dist/`, `_site/`, `dist-web/` 는 빌드 결과라 커밋하지 않는다.

## 구조

```text
src/circuit     회로도: 부품 정의·기하(parts.ts), 선 연결(netlist.ts: 끝점·T 분기), 사건 구동 시뮬레이션(engine.ts: 극 판정, 코일 하나씩 안정화,
                타이머·실린더 사건), 조작 순서 → 타임차트(chart.ts), 부품 리스트·검사(bom.ts), 저장 검사(sanitize.ts), 예제(examples.ts),
                전기 해석(power.ts: 허용전류 표, 복소 마디 해석으로 전류·전압, 허용전류·전압강하·차단기 검토), 결선표(wiring.ts), 쓰는 법(guide.ts)
src/model       파형 데이터·연산(wave.ts), 분석·규칙 검증(analysis.ts), 프로젝트/예제(project.ts), 동작 순서 모델(sequence.ts),
                동작 순서 표 편집 규칙·차트 적용(seqEdit.ts), 설비 파일 = 차트 여러 장(book.ts)
src/plc         PLC 파서(il.ts 미쓰비시·LS, stl.ts 지멘스, st.ts ST), LS PDF 텍스트 해석(lsStream.ts), 스캔 실행기(runtime.ts),
                시뮬레이터·설비 모델(simulator.ts: 실린더·지연·위치 축), I/O 매핑 추적(alias.ts), 예제(samples.ts)
src/learn       연습 문제(exercises.ts)와 채점(grade.ts)
src/io          PDF 텍스트 추출(pdf.ts, pdf.js + 한글 CMap), WaveDrom, CSV, TCT 텍스트, 엑셀 붙여넣기 표(tsv.ts), 파일 입출력
src/render      차트 그리기 (편집기·보고서·이미지 내보내기 공용 SVG), 회로도 기호(CircuitSvg.tsx)
src/components  회로도 탭(CircuitPanel.tsx, CircuitCanvas.tsx), 편집기, 동작 순서 탭(SequencePanel.tsx)·PLC·텍스트·보고서 화면, 엑셀형 표(Grid.tsx), 차트 탭(SheetBar.tsx),
                튜토리얼(Tour.tsx), 연습 문제(Practice.tsx)
src/store       zustand 상태 (프로젝트, 실행 취소, 자동 백업, 튜토리얼·연습 상태)
site            소개 페이지와 캡처
scripts         build-site.mjs
tests           단위 테스트
```

## 지켜야 할 것

- **회사 자료를 커밋하지 않는다.** 사용자가 주는 실제 PLC 프로그램, XG5000 PDF, 변수·설명문 목록, 그걸로 만든 차트(.tchart)는 작업용으로만 쓰고 저장소·테스트·캡처에 넣지 않는다. 테스트와 예제는 직접 만든 합성 프로그램만 쓴다. 소개 페이지 캡처(`site/img/`)도 내장 예제로만 찍는다.
- **UI 문구는 두 언어로**: `tr('한국어', 'English')` (`src/i18n.ts`). 한국어는 쉬운 말로, 엔지니어가 현장에서 쓰는 용어(SOL, 전진단, 자기유지, 인터록 등)를 그대로 쓴다.
- **저장 형식과 브라우저 저장 키를 함부로 바꾸지 않는다.** `timechart-studio.*` localStorage 키(자동 백업 `autosave.v1` 등)를 바꾸면 사용자의 작업이 사라진다. 프로젝트 형식을 바꿀 때는 `migrateProject`(`src/model/project.ts`)에서 옛 파일도 읽히게 한다. 차트가 여러 장인 설비 파일은 `book.ts`: 한 장이면 예전 프로젝트 형식으로 저장하고, 자동 백업은 `autosave.v1`(지금 차트, 이전 버전 호환)과 `autosave-book.v1`(전체)에 나눠 쓰고 읽을 때 `mergeAutosave`로 합친다.
- **연습 문제**를 추가·수정하면 `tests/learn.test.ts`에 정답 시각을 확인하는 테스트를 넣는다. 해설에 적은 시각이 시뮬레이터 결과와 맞아야 한다 (PLC 는 위에서 아래로 실행돼 한 스캔 늦게 바뀌는 경우가 있다).
- 빌드 설정의 `escapeReplacementChar` 플러그인(`vite.config.ts`)과 pdf.js CMap 인라인 처리는 PDF·한글 파일 읽기에 필요하니 지우지 않는다.
- 편집기는 오프라인 단일 파일로도 동작해야 한다. 외부 서버·CDN 에 의존하는 기능을 편집기에 넣지 않는다 (소개 페이지의 웹 폰트는 예외).

## 도메인 메모

- LS XGK: `F00099` 항상 ON, `F0009A` 항상 OFF, 타이머 기본 단위 100ms. XG5000 은 니모닉을 인쇄(PDF)로만 내보낼 수 있어서 PDF 텍스트를 토큰 흐름으로 읽는다(`lsStream.ts`). "비실행문" 렁은 빼고, "설명문"은 설명으로 처리한다.
- 많은 현장 프로그램이 실제 입력(P)을 M 릴레이로 복사해서 쓴다. `alias.ts`가 복사 렁(`LOAD P → OUT M`, 반전, 항상 ON 조건 경유, 사슬)을 따라가 실제 I/O 로 풀어 준다.
- 실무 타임차트 작성 순서: 설비 사양(목표 사이클 타임) → 동작 기기와 동작 시간 → I/O 목록 → 동작 순서 → 차트·검토(사이클 타임, 인터록). 동작 순서 탭이 이 순서를 한 페이지에 위에서 아래로 놓는다. 표를 고치면 프로젝트에 바로 저장되고, 차트는 [차트에 적용]에서만 다시 만든다(`applySequence`, 표제란·PLC 설정 유지).
- 회로도: 같은 기호(코일 X1 ↔ 접점 X1)끼리 연동한다. PLC 블록은 PLC 탭의 프로그램(`Project.plc`)을 스캔 타임마다 사건으로 실행한다(입력 = 단자에 +24V/L, 출력 = C↔Q 접점). 공압 포트는 `PinDef.air` 단자이고 배관은 일반 선과 같은 Wire 로 그린다(공압 넷은 `airNets`). 밸브 위치 → 배관 압력(P/E/X, `evaluateAir`) → 실린더 목표, 막히면 그 자리에 멈춤(`hold`). 실린더 포트에 배관이 없으면 예전처럼 솔레노이드 기호(solPlus/solMinus)로 움직인다. 3선식 센서·SMPS 는 전원 극이 닿아야 동작한다(`powered`). 실물 배선도 기기(`r_*`, `REAL`)는 한 몸에 코일(`selfCoil`)과 a·b 접점(`polesNc`)을 함께 가지고, 전선은 `Wire.color` 로 실제 색을 가진다(새 선은 `autoWireColor` 가 극을 따라 표준 색). 8핀 타이머(`r_timer8`)는 타이머로 등록되고 `inst13` 이면 1-3·1-4 가 코일을 따르는 순시 접점(`Conductor.inst`). 단자대(`r_tb`)는 극수 `Part.n` 만큼 단자가 생기므로 단자 목록은 `PARTS[..].pins` 대신 `partPins`/`partPoles` 로 읽는다. 결선표(`wiring.ts`)는 선 그림을 단자 → 단자 전선으로 풀고(넷마다 가까운 단자부터 잇기, 선번호는 단자대 위·아래를 같은 번호로), 체크는 `Circuit.wired` 에 저장한다(`circuitSig` 에는 들어가지 않음). 24시간 타임 스위치(`r_tsw`, 기호 종류 `tsw`)는 `Part.sched`(켜지는 구간, 하루 안의 ms)대로 COM-NO 를 붙이고, 다이얼은 L·N 에 전원이 있을 때만 돈다(`CircuitSim.tsw`). 타임 스위치가 있으면 `runScenario` 가 하루 단위로 돌고 차트는 시간 단위(`TimeUnit` 의 `min`·`h`, 눈금은 `tickSteps`), 시작 시각은 `Circuit.clock`. 부품을 추가하면 `guide.ts` 에 쓰는 법(단자 · 잇는 순서 · 예제)도 적는다(테스트가 빠진 부품을 잡는다). 전기 해석(`power.ts`)은 시뮬레이션의 그 순간 상태(`conductorClosed`)에서 전류를 푼다: 케이블 규격(`Wire.cable`)이 있는 선만 임피던스를 갖고, 규격 없는 선·닫힌 접점은 임피던스 0 이라 한 마디로 묶은 뒤 묶음 안의 전류는 전원에서 퍼지는 나무를 따라 더한다. `analyzePower` 는 `runScenario` 의 hook 으로 조작 순서 전체에서 가장 나쁜 값을 모아 IB ≤ In ≤ Iz 와 전압강하를 검토한다. 허용전류 표는 KS C IEC 60364-5-52 표 B.52.2~5 값이니 고칠 때는 표준과 대조하고 `tests/power.test.ts` 의 손계산 테스트를 맞춘다. 분전반 테두리(`r_panel`)는 그림만 묶고 전기적으로는 아무것도 하지 않는다. PE 는 혼자인 계통이라 부하를 움직이지 않고 L 과 닿으면 단락. 회로·조작 순서는 `Project.circuit` 에 저장되고, 차트는 `applyCircuit` 으로 만든다. 손으로 그린 차트는 자동으로 덮어쓰지 않는다(`autoChartOn`: 빈 차트이거나 회로로 만든 차트일 때만). 회로 예제를 추가·수정하면 `tests/circuit.test.ts` 에 동작 시각 테스트를 넣는다.
- 인쇄 사용자는 흑백 프린터, A4 세로, 한 장 출력을 많이 쓴다. 보고서를 바꿀 때 `한 장으로`/세로/흑백에서 깨지지 않는지 확인한다.
