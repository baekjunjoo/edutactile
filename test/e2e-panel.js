/* 갤러리 아코디언 + 단위 일괄 환산 + 미리보기 직접 편집(치수·제목) + 레이블 패널 편집 E2E */
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
  const acc = await page.evaluate(() => ({
    heads: document.querySelectorAll('#gallery .gcat').length,
    cards: document.querySelectorAll('#gallery .card').length,
    firstHead: document.querySelector('#gallery .gcat').textContent
  }));
  ok('categories are collapsible headers with counts', acc.heads >= 4 && /\(\d+\)/.test(acc.firstHead), acc.firstHead);
  ok('only active category expanded initially', acc.cards > 0 && acc.cards <= 6, acc.cards);
  await page.click('#gallery .gcat:has-text("Mathematics")');
  const open1 = await page.evaluate(() => document.querySelectorAll('#gallery .card').length);
  await page.click('#gallery .gcat:has-text("Mathematics")');
  const open0 = await page.evaluate(() => document.querySelectorAll('#gallery .card').length);
  ok('category click expands below / collapses', open1 > acc.cards && open0 === acc.cards, open1 + '/' + open0);

  // ── 2. 치수: 단위 일괄 선택 + 전체 환산 ──
  await page.waitForSelector('#dimForm .frow');
  const form0 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dimForm .frow')];
    const uSel = rows[0].querySelector('select');
    return {
      rows: rows.length,
      unitOpts: [...uSel.options].map(o => o.value).join(','),
      unitVal: uSel.value,
      perRowSelects: rows.slice(1).filter(r => r.querySelector('select')).length,
      v1: rows[1].querySelector('input').value
    };
  });
  ok('one global unit select (mm/cm/m/ft/in), rows have none', form0.unitOpts === ',mm,cm,m,ft,in' && form0.perRowSelects === 0, JSON.stringify(form0));
  ok('tennis defaults: unit=ft, dim1=78', form0.unitVal === 'ft' && form0.v1 === '78', form0.unitVal + '/' + form0.v1);
  await page.selectOption('#dimForm .frow:nth-child(1) select', 'm');
  await sleep(400);
  const conv = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dimForm .frow')];
    return {
      vals: rows.slice(1).map(r => r.querySelector('input').value).join(','),
      units: rows.slice(1).map(r => (r.querySelector('span:nth-child(3)') || {}).textContent).join(','),
      svg: /23\.77/.test(document.querySelector('#preview').innerHTML) && /8\.23/.test(document.querySelector('#preview').innerHTML)
    };
  });
  ok('ALL dims convert at once (78/27/39 ft → 23.77/8.23/11.89 m)', conv.vals === '23.77,8.23,11.89' && conv.svg, JSON.stringify(conv));
  ok('rows show unit word', /meters,meters,meters/.test(conv.units), conv.units);

  // ── 3. 미리보기에서 치수 직접 수정 (클릭 → 플로팅 입력) ──
  const dimPos = await page.evaluate(() => {
    const svg = document.querySelector('#preview svg');
    const r = svg.getBoundingClientRect();
    const spec = JSON.parse(document.querySelector('#json').value);
    const d = spec.elements.find(e => e.type === 'dimension' && e._labelMm);
    const paper = { w: 292.1, h: 279.4 };
    return { x: r.left + d._labelMm[0] / paper.w * r.width, y: r.top + d._labelMm[1] / paper.h * r.height };
  });
  await page.mouse.click(dimPos.x, dimPos.y);
  await sleep(200);
  const fl = await page.evaluate(() => ({
    shown: document.querySelector('#labelBox').style.display !== 'none',
    val: document.querySelector('#labelInput').value,
    unit: document.querySelector('#unitSel').value,
    unitShown: document.querySelector('#unitSel').style.display !== 'none'
  }));
  ok('clicking dim in preview opens inline editor (value+unit preset)', fl.shown && fl.val === '23.77' && fl.unit === 'm' && fl.unitShown, JSON.stringify(fl));
  await page.fill('#labelInput', '24');
  await page.press('#labelInput', 'Enter');
  await sleep(300);
  const edited = await page.evaluate(() => ({
    svg: /24 meters/.test(document.querySelector('#preview').innerHTML),
    row: document.querySelectorAll('#dimForm .frow')[1].querySelector('input').value
  }));
  ok('inline edit updates diagram + panel row', edited.svg && edited.row === '24', JSON.stringify(edited));

  // ── 4. 제목 수정: 미리보기 클릭 + 옵션 패널 필드 ──
  const tPos = await page.evaluate(() => {
    const svg = document.querySelector('#preview svg');
    const r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.055 };
  });
  await page.mouse.click(tPos.x, tPos.y);
  await sleep(200);
  const tf = await page.evaluate(() => ({
    shown: document.querySelector('#labelBox').style.display !== 'none',
    val: document.querySelector('#labelInput').value
  }));
  ok('clicking title opens inline editor with current title', tf.shown && /Tennis/.test(tf.val), JSON.stringify(tf));
  await page.fill('#labelInput', 'My Court');
  await page.press('#labelInput', 'Enter');
  await sleep(300);
  const tDone = await page.evaluate(() => ({
    svg: document.querySelector('#preview').innerHTML.includes('My Court'),
    field: document.querySelector('#titleOvr') && document.querySelector('#titleOvr').value
  }));
  ok('title updates in diagram + options field', tDone.svg && tDone.field === 'My Court', JSON.stringify(tDone));
  await page.fill('#titleOvr', 'Court 2');
  await page.press('#titleOvr', 'Enter');
  await sleep(300);
  const tPanel = await page.evaluate(() => document.querySelector('#preview').innerHTML.includes('Court 2'));
  ok('title editable from options panel too', tPanel);

  // ── 5. 문구 레이블 패널 수정 ──
  await page.click('#labelMode');
  await page.click('#preview svg', { position: { x: 320, y: 260 } });
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

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
