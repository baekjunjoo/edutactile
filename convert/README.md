# DOT Convert — 접근성 문서 변환 서비스 프로토타입

업로드 → 자동 분석(페이지·객체) → 크레딧 견적 → AI 변환 데모(WCAG HTML·점자 BRF).
단가는 원가검토 노트(2026.08) 기준: 기본 $0.6/페이지 · AI 객체 $0.6/객체 · 프리미엄 $30/객체 · 점역사 검수 견적.

- 배포: https://baekjunjoo.github.io/edutactile/convert.html
- 빌드: `node convert/build.js` (edutactile 엔진·pdf.js·pako를 단일 HTML로 인라인)
- 검증: `node convert/e2e.js` (업로드→분석→견적 단가→변환→BRF 9건)
- 분석·점역은 전부 브라우저 안에서 수행 (서버 없음)
