/* 가이드용 DotPad 연결 화면 캡처 — 목 SDK로 연결 상태를 만들어 파란 뷰포트 프레임을 찍는다.
 * 사용: node test/guide-shot-dotpad.js <ko|en> */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const lang = process.argv[2] === 'ko' ? 'ko' : 'en';
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker' + (lang === 'ko' ? '-ko' : '') + '.html');
const OUT = path.join(__dirname, 'guide' + (lang === 'en' ? 'en' : '') + '-06-dotpad.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`
    Object.defineProperty(navigator, 'bluetooth', { value: {} });
    window.__mock = (function(){ const module = { exports: {} }; ${mockSrc}; return module.exports; })();
  `);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');
  await page.evaluate(() => {
    window.__sim = window.__mock.createMockSdk();
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);
    DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.LINE_GAP = 5;
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(1600);

  const box = await page.evaluate(() => {
    const bar = document.querySelector('#pbar').getBoundingClientRect();
    const pv = document.querySelector('#preview').getBoundingClientRect();
    return { x: bar.left - 10, y: bar.top - 10, width: pv.width + 20, height: pv.bottom - bar.top + 20 };
  });
  await page.screenshot({ path: OUT, clip: box });
  console.log('shot', path.basename(OUT));
  await browser.close();
})();
