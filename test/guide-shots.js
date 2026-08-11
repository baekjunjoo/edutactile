/* 사용 가이드용 화면 캡처 — 한국어 UI 기준 */
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker-ko.html');
const OUT = p => path.resolve(__dirname, 'guide-' + p + '.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');
  await sleep(600);

  // 1. 전체 화면
  await page.screenshot({ path: OUT('01-overview') });

  // 2. 템플릿 갤러리 — 카테고리 펼침
  await page.evaluate(() => {
    [...document.querySelectorAll('#gallery .gcat')].slice(0, 2).forEach(h => h.click());
  });
  await sleep(400);
  const gal = await page.$('#gallery');
  await gal.screenshot({ path: OUT('02-gallery') });

  // 3. 옵션/치수 패널 (좌측 컬럼)
  await page.evaluate(() => { const p = document.querySelector('#dimForm'); if (p) p.scrollIntoView({ block: 'center' }); });
  await sleep(300);
  const side = await page.$('#side') || await page.$('aside') || await page.$('#panel');
  if (side) await side.screenshot({ path: OUT('03-options') });

  // 4. 미리보기 제자리 편집 — 제목 클릭
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#preview svg .inktxt')][0];
    if (t) { const r = t.getBoundingClientRect(); window.__tp = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  });
  const tp = await page.evaluate(() => window.__tp);
  if (tp) { await page.mouse.click(tp.x, tp.y); await sleep(500); }
  await page.screenshot({ path: OUT('04-inline-edit') });
  await page.keyboard.press('Escape');
  await sleep(300);

  // 5. 내보내기 버튼 영역
  const ex = await page.$('#exports') || await page.$('#h-exports');
  if (ex) {
    await page.evaluate(() => document.querySelector('#h-exports').scrollIntoView({ block: 'center' }));
    await sleep(300);
    const box = await page.evaluate(() => {
      const h = document.querySelector('#h-exports');
      const r = h.getBoundingClientRect();
      const last = document.querySelector('#ex-load').getBoundingClientRect();
      return { x: r.left - 8, y: r.top - 8, width: Math.max(r.width, last.width) + 30, height: last.bottom - r.top + 16 };
    });
    await page.screenshot({ path: OUT('05-exports'), clip: box });
  }

  // 6. DotPad 뷰포트 — 모의 연결 상태로 파란 프레임 노출
  await page.evaluate(() => {
    if (window.DOTPAD && window.__dpDemo) window.__dpDemo();
  });
  await sleep(300);

  console.log('shots done');
  await browser.close();
})();
