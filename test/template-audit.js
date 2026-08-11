/* 템플릿 전수 감사 — 모든 템플릿 × 파라미터 변형에 대해
 *   ① build/render 예외 없음  ② 좌표에 NaN 없음  ③ 요소가 용지 밖으로 나가지 않음
 *   ④ 모든 문구가 점역됨      ⑤ 점자 레이블끼리 최소 간격(3.2mm) 유지
 * 배경: y축 눈금 레이블이 용지 밖(x<0)으로 나가 엠보싱에서 잘리던 문제,
 *       시퀀스 템플릿을 고르면 미리보기가 예외로 죽던 문제를 이 검사가 잡았다. */
const path = require('path');
const TGIL = require(path.join(__dirname, '../engine/tgil.js'));
const TEMPLATES = require(path.join(__dirname, '../engine/templates.js'));

const MINGAP = 3.2;                       // TGIL: 서로 다른 촉각 요소 최소 간격
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };

function variants(tpl) {
  const base = {};
  tpl.params.forEach(p => base[p.key] = p.default);
  const out = [{ tag: 'default', p: base }];
  tpl.params.forEach(p => {
    if (p.type === 'select') p.options.filter(o => o !== p.default)
      .forEach(o => out.push({ tag: `${p.key}=${o}`, p: Object.assign({}, base, { [p.key]: o }) }));
    if (p.type === 'bool') out.push({ tag: `${p.key}=${!p.default}`, p: Object.assign({}, base, { [p.key]: !p.default }) });
    if (p.type === 'number') {
      out.push({ tag: `${p.key}=1`, p: Object.assign({}, base, { [p.key]: 1 }) });
      out.push({ tag: `${p.key}=빈칸`, p: Object.assign({}, base, { [p.key]: '' }) });   // 사용자가 칸을 비우는 경우
    }
  });
  return out;
}

/* 점자 레이블(=<g fill="#000"> 한 덩어리)들의 바운딩박스 */
function brailleBoxes(svg) {
  const out = [];
  [...svg.matchAll(/<g fill="#000">([\s\S]*?)<\/g>/g)].forEach(m => {
    const cs = [...m[1].matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)].map(c => [+c[1], +c[2]]);
    if (!cs.length) return;
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  });
  return out;
}
const boxGap = (a, b) => Math.hypot(
  Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1)),
  Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1))
);

console.log(`템플릿 ${TEMPLATES.length}종 전수 감사`);
TEMPLATES.forEach(tpl => {
  variants(tpl).forEach(v => {
    const id = `${tpl.id} [${v.tag}]`;
    let spec;
    try { spec = tpl.build(Object.assign({}, v.p), 'ko'); }
    catch (e) { ok(`${id} build`, false, e.message); return; }
    if (Array.isArray(spec)) spec = spec[0] && spec[0].spec;      // 시퀀스 템플릿은 페이지 배열
    if (!spec) return;
    spec.brailleCode = 'ko';

    let r;
    try { r = TGIL.render(spec); }
    catch (e) { ok(`${id} render`, false, e.message); return; }
    const svg = r.svg, page = r.layout.page;

    ok(`${id} 좌표 정상`, !/NaN|Infinity/.test(svg));

    const coords = [...svg.matchAll(/(?:^|\s)(x|y|x1|y1|x2|y2|cx|cy)="(-?[\d.]+)"/g)];
    const oob = coords.filter(m => {
      const v2 = +m[2], horiz = /^(x|x1|x2|cx)$/.test(m[1]);
      return v2 < -0.5 || v2 > (horiz ? page.w : page.h) + 0.5;
    });
    ok(`${id} 용지 안에 그려짐`, oob.length === 0, oob.length ? `${oob.length}개 이탈 (예 ${oob.slice(0, 3).map(m => m[1] + '=' + m[2]).join(', ')})` : '');

    (spec.elements || []).forEach(e => {
      const txt = e.text != null ? e.text : e.label;
      if (!/^(label|leader|dimension)$/.test(e.type) || txt == null) return;
      ok(`${id} "${txt}" 점역`, String(txt).trim() !== '' && TGIL.translate(String(txt), 'ko').length > 0);
    });

    const boxes = brailleBoxes(svg);
    let worst = Infinity;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) worst = Math.min(worst, boxGap(boxes[i], boxes[j]));
    ok(`${id} 점자 간격 ≥${MINGAP}mm`, boxes.length < 2 || worst >= MINGAP, worst === Infinity ? '' : worst.toFixed(2) + 'mm');
  });
});

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
