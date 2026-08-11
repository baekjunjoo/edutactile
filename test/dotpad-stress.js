/* 부하 테스트 도구 + 적응형 백오프 검증 (모의 기기) */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    DOTPAD.BLE.MIN_INTERVAL = 5;
    window.__logs = [];
    const orig = console.log.bind(console);
    console.log = (...a) => { window.__logs.push(a.join(' ')); orig(...a); };
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(600);

  // ── 1. 부하 테스트: 완주 → 안전 판정 + LINE_GAP 원복 ──
  const run = await page.evaluate(async () => {
    const gap0 = DOTPAD.BLE.LINE_GAP;
    const sent0 = DOTPAD.BLE.stats.sent;
    DOTPAD.BLE.stress(4, 5);
    await new Promise(r => setTimeout(r, 4000));
    return {
      done: window.__logs.some(l => l.includes('완주')),
      sent: DOTPAD.BLE.stats.sent - sent0,
      gapRestored: DOTPAD.BLE.LINE_GAP === gap0,
      off: DOTPAD.BLE._stressOn
    };
  });
  ok('stress test completes and reports safe pace', run.done && !run.off, JSON.stringify(run));
  ok('stress sends full alternating frames (~10 lines each)', run.sent >= 35, run.sent + '줄');
  ok('LINE_GAP restored after test', run.gapRestored);

  // ── 2. 적응형 백오프: 예기치 않은 끊김마다 LINE_GAP 증가 (상한 있음) ──
  const bo = await page.evaluate(async () => {
    const g0 = DOTPAD.BLE.LINE_GAP;
    window.__sim.fireMessage('Disconnected', DOTPAD.BLE.devs[0].dev);
    await new Promise(r => setTimeout(r, 100));
    const g1 = DOTPAD.BLE.LINE_GAP;
    return { g0, g1, step: DOTPAD.BLE.GAP_STEP, traced: DOTPAD.BLE.trace.some(x => x.ev === 'gap-up') };
  });
  ok('unexpected drop raises LINE_GAP (adaptive backoff)', bo.g1 === bo.g0 + bo.step && bo.traced,
    `${bo.g0} → ${bo.g1}`);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
