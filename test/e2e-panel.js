/* 갤러리 아코디언 + 단위 환산 + 패널 편집 E2E */
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');

  // ── 1. 갤러리 아코디언 ──
  const acc = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#gallery .gcat')];
    const cards = document.querySelectorAll('#gallery .card').length;
    return { heads: heads.length, cards, firstHead: heads[0].textContent };
  });
  ok('categories are collapsible headers with counts', acc.heads >= 4 && /\(\d+\)/.test(acc.firstHead), acc.firstHead);
  ok('only active category expanded initially', acc.cards > 0 && acc.cards <= 6, acc.cards);
  // Mathematics 펼치기 → 카드 증가, 다시 접기 → 감소
  await page.click('#gallery .gcat:has-text("Mathematics")');
  const open1 = await page.evaluate(() => document.querySelectorAll('#gallery .card').length);
  await page.click('#gallery .gcat:has-text("Mathematics")');
  const open0 = await page.evaluate(() => document.querySelectorAll('#gallery .card').length);
  ok('category click expands below / collapses', open1 > acc.cards && open0 === acc.cards, open1 + '/' + open0);
  // 펼친 카테고리에서 템플릿 선택
  await page.click('#gallery .gcat:has-text("Mathematics")');
  await page.click('#gallery .card:has-text("Bar Chart"), #gallery .card:has-text("막대")');
  const sel = await page.evaluate(() => document.querySelector('#gallery .card.active') && document.querySelector('#preview svg') != null);
  ok('template selectable from expanded category', sel === true);

  // ── 2. 치수 패널: 수치+단위 드롭다운, ft→m 환산 ──
  if (!await page.$('#gallery .card:has-text("Tennis")')) await page.click('#gallery .gcat:has-text("Physical")');
  await page.click('#gallery .card:has-text("Tennis")');
  await page.waitForSelector('#dimForm .frow');
  const dim0 = await page.evaluate(() => {
    const row = document.querySelector('#dimForm .frow');
    const inp = row.querySelector('input'), sel = row.querySelector('select');
    return { type: inp.type, val: inp.value, unit: sel && sel.value, opts: sel ? [...sel.options].map(o => o.value).join(',') : '' };
  });
  ok('dim row = number input + unit select (78 ft)', dim0.type === 'number' && dim0.val === '78' && dim0.unit === 'ft', JSON.stringify(dim0));
  ok('unit options mm/cm/m/ft/in', dim0.opts === ',mm,cm,m,ft,in', dim0.opts);
  await page.selectOption('#dimForm .frow:nth-child(1) select', 'm');
  await sleep(300);
  const conv = await page.evaluate(() => ({
    val: document.querySelector('#dimForm .frow input').value,
    svgHasM: /23\.77/.test(document.querySelector('#preview').innerHTML)
  }));
  ok('ft→m converts value (78 ft = 23.77 m)', conv.val === '23.77' && conv.svgHasM, JSON.stringify(conv));

  // ── 3. 문구 레이블 패널 수정 ──
  await page.click('#labelMode');
  await page.click('#preview svg', { position: { x: 320, y: 220 } });
  await page.fill('#labelInput', 'net');
  await page.press('#labelInput', 'Enter');
  await page.waitForSelector('#labelList .lrow input');
  await page.fill('#labelList .lrow input', 'net line');
  await page.press('#labelList .lrow input', 'Enter');
  await sleep(300);
  const lbl = await page.evaluate(() => ({
    text: document.querySelector('#labelList .lrow input').value,
    inSvg: document.querySelector('#preview').innerHTML.includes('net line')
  }));
  ok('label editable in panel, reflected in diagram', lbl.text === 'net line' && lbl.inSvg, JSON.stringify(lbl));

  // ── 4. 도면 치수 클릭 → 패널 행 포커스 (플로팅 입력 아님) ──
  await page.evaluate(() => document.querySelector('#labelMode').classList.contains('on') && document.querySelector('#labelMode').click());
  const labelPos = await page.evaluate(() => {   // 첫 치수 레이블의 실제 화면 좌표 (_labelMm → px)
    const svg = document.querySelector('#preview svg');
    const r = svg.getBoundingClientRect();
    const dim = window.__STATE ? null : null;
    // 앱 내부 state는 클로저라 스펙의 _labelMm를 JSON 편집창에서 읽는다
    const spec = JSON.parse(document.querySelector('#json').value);
    const d = spec.elements.find(e => e.type === 'dimension' && e._labelMm);
    const pg = { w: r.width, h: r.height };
    const paper = { w: 292.1, h: 279.4 };   // 11.5×11in
    return { x: r.left + d._labelMm[0] / paper.w * r.width, y: r.top + d._labelMm[1] / paper.h * r.height };
  });
  await page.mouse.click(labelPos.x, labelPos.y);
  await sleep(200);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return a && a.closest('#dimForm') ? a.value : null;
  });
  ok('clicking dimension on canvas focuses panel row', focused != null, focused);
  const floatBox = await page.evaluate(() => document.querySelector('#labelBox').style.display);
  ok('no floating edit box appears', floatBox === 'none', floatBox);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
