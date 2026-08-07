/* file:// 환경 SDK 로딩 폴백 검증: import() CORS 차단 → 파일 선택 → Blob import(ESM/UMD) → 연결 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 가짜 공식 SDK — ESM판과 UMD판 (모의 기기 거동 동일) */
const CORE = `
class DotPadSDK {
  setCallBack(m, k) { this._m = m; this._k = k; }
  connectBleDevice(d) {
    const self = this;
    return new Promise(res => setTimeout(() => {
      res(d);
      setTimeout(() => self._m && self._m(d, 'Connected'), 30);
    }, 20));
  }
  displayLineData(lineId, startCell, hex, mode, dev) {
    (window.__sent = window.__sent || []).push({ lineId, startCell, hex, mode });
  }
  disconnect(d) { setTimeout(() => this._m && this._m(d, 'Disconnected'), 10); }
}
class DotPadScanner { startBleScan() { return Promise.resolve({ id: 'FAKE-1', name: 'DotPad320' }); } }
const DisplayMode = { GraphicMode: 'GraphicMode', TextMode: 'TextMode' };`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsdk-'));
const ESM_SDK = path.join(tmp, 'DotPadSDK-3.0.0.js');
const UMD_SDK = path.join(tmp, 'DotPadSDK-umd.js');
fs.writeFileSync(ESM_SDK, CORE + '\nexport { DotPadSDK, DotPadScanner, DisplayMode };\n');
fs.writeFileSync(UMD_SDK, CORE + '\nwindow.DotPadSDK = DotPadSDK; window.DotPadScanner = DotPadScanner; window.DisplayMode = DisplayMode;\n');

async function run(sdkPath, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`Object.defineProperty(navigator, 'bluetooth', { value: {} });`);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .card');

  // loadSDK를 오버라이드하지 않는다 — 실제 file:// 경로: import() 실패 → 파일 선택 폴백
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('#dpBtn')]);
  const askMsg = await page.evaluate(() => document.querySelector('#dpMsg').textContent);
  ok(label + ': picker opens + inline guide shown', /DotPadSDK-3\.0\.0\.js/.test(askMsg), askMsg.slice(0, 50));
  await chooser.setFiles(sdkPath);
  await page.waitForFunction(() => window.DOTPAD && DOTPAD.BLE.readyCount() === 1, null, { timeout: 8000 });
  await sleep(1400);
  const st = await page.evaluate(() => ({
    sent: (window.__sent || []).filter(x => x.mode === 'GraphicMode').length,
    hasInk: (window.__sent || []).some(x => x.mode === 'GraphicMode' && /[1-9A-F]/.test(x.hex)),
    msg: document.querySelector('#dpMsg').style.display,
    btn: document.querySelector('#dpBtn').textContent
  }));
  ok(label + ': connected + frame rows sent', st.sent >= 10 && st.hasInk, JSON.stringify(st));
  ok(label + ': guide cleared, button shows connected', st.msg === 'none' && /●/.test(st.btn), st.btn);
  await browser.close();
}

(async () => {
  await run(ESM_SDK, 'ESM SDK');
  await run(UMD_SDK, 'UMD SDK');

  // Web Bluetooth 부재 → 인라인 안내 (alert 없이)
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(DIST);
  await page.waitForSelector('#gallery .card');
  const hasBt = await page.evaluate(() => !!navigator.bluetooth);
  if (!hasBt) {
    await page.click('#dpBtn');
    await sleep(300);
    const msg = await page.evaluate(() => document.querySelector('#dpMsg').textContent);
    ok('no-bluetooth: inline message (not alert)', /Chrome|Edge/.test(msg), msg.slice(0, 60));
  } else console.log('  (headless has navigator.bluetooth — no-bt branch skipped)');
  await browser.close();

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
