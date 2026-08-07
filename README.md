# edutactile — 촉각 교육자료 제작 도구 (Tactile Learning Material Maker)

TGIL 규칙을 몰라도 APH 라이브러리급 촉각 도면을 만들 수 있는 오프라인 단일 HTML 도구.
비장애인 제작자(교사·부모)가 시각장애 학습자를 위한 교육자료를 만드는 것을 전제로 설계했다.

## 주요 기능

- **템플릿 20종** — 코트(테니스·농구·배구·야구), 수학(좌표평면·수직선·분수·각도·그래프 6종·도형·전개도), 시계·회로·텍스트 페이지 등. TGIL/BANA 물리 규격(선 굵기 위계 2.0/1.0/0.5mm, 점자 도트 피치, 셀 전진)을 엔진이 자동 적용.
- **점자 3코드** — UEB Grade 2, Nemeth(수학), 한국 점자 (검증된 점역 테이블).
- **편집** — 레이블(리드선)·치수(mm/cm/m) 클릭 배치, 드래그 이동, 더블클릭 삭제. 묵자 병기(화면 검증용/인쇄 포함/끄기).
- **레슨 시퀀스** — 여러 페이지를 묶어 단계 학습 자료 구성.
- **트랙 B** — 이미지 → 촉각 윤곽선 자동 추출 (Otsu + marching squares + 단순화·스무딩).
- **점자 문서 변환기** — 표 형식 점자 규정집(PDF·Word·검증 JSON) → UEB 스타일 서술형 문서. 점자는 선택·복사 가능한 유니코드 텍스트. 항목 클릭 교정 UI + 교정본 JSON 재현.
- **출력 7종** — 인쇄 PDF · SVG(엠보서/Monarch) · DotPad .dtms · BRF(묵자 맥락 병기) · eBraille .ebrl · Word .docx(RTL/bidi) · 스펙 JSON.
- **DotPad 실시간 연동** — Web Bluetooth로 미리보기를 60×40 핀에 즉시 출력. 팬 키 ◀▶ 페이지·항목 탐색, F1 재전송, 최대 5대 미러링(교실 모드). 실기기 검증 BLE 계약(행단위 전송, Connected 게이트, 행 차분, keep-alive) 준수.

## 사용

- **웹 (GitHub Pages)**: https://baekjunjoo.github.io/edutactile/ (한국어) · [/en.html](https://baekjunjoo.github.io/edutactile/en.html) (영어) — push마다 자동 빌드·배포.
- **오프라인**: 직접 빌드한 `dist/tactile-material-maker-ko.html`을 Chrome/Edge에서 열면 끝. 단일 파일, 서버·설치 불필요.

### DotPad 연결

공식 `DotPadSDK-3.0.0.js`(Dot Inc. 자사 SDK)가 `app/`에 있으면 빌드에 base64로 내장되어, "DotPad 연결" 클릭 → 곧바로 블루투스 기기 선택으로 이어진다 (file://·https 모두). SDK 파일이 없는 빌드는 파일 선택 창 폴백으로 동작한다.

## 빌드

```bash
npm install
node build.js        # → dist/tactile-material-maker{,-ko}.html
```

### 저장소에 없는 선택 자산 (라이선스상 공개 저장소 제외)

- **점자 폰트** — macOS의 `/System/Library/Fonts/Apple Braille Pinpoint 6 Dot.ttf`를 `rulebook/AppleBraillePinpoint.ttf`로 복사하면 빌드에 자동 내장된다 (인쇄·HTML 출력의 점자 모양 일관성). 없으면 OS 기본 폰트로 표시된다.
- **내장 샘플(아랍어 709 규정집 JSON)** — 원 기관 저작물이라 제외. `rulebook/arabic-709.json`이 있으면 변환기에 "내장 샘플" 버튼이 생긴다. 없어도 PDF·Word·JSON 업로드 변환은 모두 동작.

## 테스트

```bash
node test/ebrl-unit.js            # .ebrl 유효성 22항목 (eBraille 1.0 OCF)
node test/dotpad-sim.js           # DotPad BLE 계약 18항목 (모의 SDK)
node test/dotpad-file-fallback.js # file:// SDK 로딩 폴백 7항목
node test/e2e-feedback.js         # 기능 E2E 18항목
```

E2E는 Playwright/Chromium 사용 (`PLAYWRIGHT_PATH`로 설치 경로 지정 가능).

## 구조

```
engine/    tgil.js(렌더러·물리규격) templates.js braille.js(점역) exporters.js(dtms/BRF) trace.js
rulebook/  rulebook.js(정규화·렌더) parser.js(PDF/Word 파싱) docx.js ebrl.js zipread.js
app/       shell.html app.js dotpad.js(BLE 드라이버)
build.js   단일 HTML 조립 (placeholder 치환)
test/      검증 스위트 + dotpad-mock(모의 SDK)
```

## 설계 문서

`persona-test-*.md` — 페르소나 시뮬레이션 피드백과 반영 이력 (교사·학생·점역사·시각장애 당사자·특수교육 교수 5인, 1개월).
