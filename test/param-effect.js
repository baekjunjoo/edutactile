/* 파라미터가 실제로 산출물에 반영되는가 (템플릿 전수 검사)
 * 배경: 정육면체 전개도에서 수치를 바꿔도 도면이 그대로였다.
 *   ① 정육면체는 h·d가 w로 강제돼 무시됐고
 *   ② 도면이 용지에 자동 축척되므로 균일 확대는 상쇄된다 → 치수 레이블이 없으면 숫자가 전달되지 않는다
 * 화면에 보이는(showIf 통과) 수치 파라미터는 모두 출력에 차이를 만들어야 한다. */
const path = require('path');
const TGIL = require(path.join(__dirname, '../engine/tgil.js'));
const TEMPLATES = require(path.join(__dirname, '../engine/templates.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };

const norm = s => s.replace(/id="[^"]*"/g, '').replace(/url\(#[^)]*\)/g, '');
function render(tpl, params, lang) {
  const spec = tpl.build(Object.assign({}, params), lang || 'ko');
  if (!spec) return null;
  spec.brailleCode = 'ko';
  return norm(TGIL.render(spec).svg);
}
const visible = (p, params) => { try { return p.showIf ? !!p.showIf(params) : true; } catch (e) { return true; } };

/* 템플릿·변형(선택 파라미터 조합)별로 검사 */
function check(tpl, base, tag) {
  const s0 = render(tpl, base);
  if (!s0) return;
  tpl.params.forEach(p => {
    if (p.type !== 'number' || !visible(p, base)) return;
    const step = /den|parts|num|count|steps|sides/.test(p.key) ? 1 : 3;
    const q = Object.assign({}, base);
    q[p.key] = (+p.default || 0) + step;
    let s1;
    try { s1 = render(tpl, q); } catch (e) { s1 = null; }
    ok(`${tpl.id}${tag} · ${p.key} ${p.default}→${q[p.key]} 반영`, s1 && s1 !== s0);
  });
}

console.log('템플릿 수치 파라미터 반영 검사\n');
TEMPLATES.forEach(tpl => {
  if (tpl.sequence) return;                       // 시퀀스 생성형은 별도 경로
  const base = {};
  tpl.params.forEach(p => base[p.key] = p.default);
  check(tpl, base, '');
  // select 파라미터의 모든 값에서 검사 (도형·입체마다 의미 있는 수치가 다르다)
  const sel = tpl.params.find(p => p.type === 'select' && p.options && p.options.length > 1);
  if (sel) sel.options.filter(o => o !== sel.default).forEach(o => {
    const alt = Object.assign({}, base);
    alt[sel.key] = o;
    check(tpl, alt, ` [${sel.key}=${o}]`);
  });
});

/* 회귀 고정: 전개도는 치수 레이블로 수치를 전달해야 한다 (자동 축척으로 형태만으로는 구분 불가) */
const net = TEMPLATES.find(t => t.id === 'solid-net');
const cube = net.build({ solid: 'cube', edge: 5, showDims: true, faceLabels: true }, 'ko');
const dims = cube.elements.filter(e => e.type === 'dimension');
ok('전개도(정육면체): 한 변 치수가 레이블로 나간다', dims.length === 1 && dims[0].label === '5', JSON.stringify(dims.map(d => d.label)));
const box = net.build({ solid: 'cuboid', w: 4, h: 3, d: 2, showDims: true, faceLabels: true }, 'ko');
const bdims = box.elements.filter(e => e.type === 'dimension').map(d => d.label);
ok('전개도(직육면체): 가로·높이·세로 3개 치수', bdims.join(',') === '4,3,2', bdims.join(','));
ok('전개도: 정육면체는 한 변 파라미터만 노출', net.params.filter(p => p.showIf && !p.showIf({ solid: 'cube' })).map(p => p.key).join(',') === 'w,h,d');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
