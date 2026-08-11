/* SDK 로딩 3단 폴백 검증: ① 내장 SDK 즉시 로드(기본) ② 내장 제거 시 파일 선택 → Blob import(ESM/UMD) ③ BT 부재 인라인 안내 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 가짜 SDK — ESM판과 UMD판 (모의 기기 거동) */
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
    /*COMPLETE*/
  }
  disconnect(d) { setTimeout(() => this._m && this._m(d, 'Disconnected'), 10); }
}
class DotPadScanner { startBleScan() { return Promise.resolve({ id: 'FAKE-1', name: 'DotPad320' }); } }
const DisplayMode = { GraphicMode: 'GraphicMode', TextMode: 'TextMode' };`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsdk-'));
const ESM_SDK = path.join(tmp, 'DotPadSDK-3.0.0.js');
const UMD_SDK = path.join(tmp, 'DotPadSDK-umd.js');
/* ESM판은 완료 통지를 주고(패치된 공식 SDK와 동일), UMD판은 안 준다(무패치 폴백) —
   완료 통지가 없어도 SELF_CLOCK 자체 시계로 전송이 굴러가는지까지 확인한다. */
const WITH_COMPLETE = "setTimeout(() => this._m && this._m(dev, 'ResponseDisplayLineComplete'), 5);";
fs.writeFileSync(ESM_SDK, CORE.replace('/*COMPLETE*/', WITH_COMPLETE) + '\nexport { DotPadSDK, DotPadScanner, DisplayMode };\n');
fs.writeFileSync(UMD_SDK, CORE + '\nwindow.DotPadSDK = DotPadSDK; window.DotPadScanner = DotPadScanner; window.DisplayMode = DisplayMode;\n');

(async () => {
  // ── 1. 내장 SDK: 파일 선택 없이 즉시 로드 (공식 SDK가 실제로 import되는지) ──
  {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'bluetooth', { value: {} });`);
    await page.goto(DIST);
    await page.waitForSelector('#gallery .gcat');
    await page.evaluate(() => { DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.LINE_GAP = 5; });
    const emb = await page.evaluate(() => !!window.DOTPAD_SDK_SRC && window.DOTPAD_SDK_SRC.length > 10000);
    ok('official SDK embedded (base64)', emb);
    let chooserOpened = false;
    page.on('filechooser', () => { chooserOpened = true; });
    await page.click('#dpBtn');
    await sleep(1500);
    const st = await page.evaluate(() => ({
      loaded: !!(window.DOTPAD && DOTPAD.BLE.sdkMod && DOTPAD.BLE.sdkMod.DotPadSDK && DOTPAD.BLE.sdkMod.DotPadScanner),
      dm: window.DOTPAD && DOTPAD.BLE.sdkMod && DOTPAD.BLE.sdkMod.DisplayMode && DOTPAD.BLE.sdkMod.DisplayMode.GraphicMode
    }));
    ok('embedded SDK loads without file picker', st.loaded && !chooserOpened, JSON.stringify({ st, chooserOpened }));
    ok('DisplayMode present', !!st.dm, st.dm);
    // 실기기 없으니 스캔은 실패 — 인라인 안내가 떠야 함 (무반응 금지)
    const msg = await page.evaluate(() => ({
      shown: document.querySelector('#dpMsg').style.display !== 'none',
      text: document.querySelector('#dpMsg').textContent.slice(0, 40)
    }));
    ok('scan failure shows inline message (no silent stall)', msg.shown, JSON.stringify(msg));
    await browser.close();
  }

  // ── 2. 내장 SDK 제거 → 파일 선택 폴백 (ESM/UMD) ──
  for (const [sdkPath, label] of [[ESM_SDK, 'ESM picker'], [UMD_SDK, 'UMD picker']]) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(`
      Object.defineProperty(navigator, 'bluetooth', { value: {} });
      window.addEventListener('DOMContentLoaded', () => { window.DOTPAD_SDK_SRC = ''; });
    `);
    await page.goto(DIST);
    await page.waitForSelector('#gallery .gcat');
    await page.evaluate(() => { DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.LINE_GAP = 5; });   // 테스트 가속 (전송 간격은 dotpad-pacing에서 검증)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('#dpBtn')]);
    await chooser.setFiles(sdkPath);
    await page.waitForFunction(() => window.DOTPAD && DOTPAD.BLE.readyCount() === 1, null, { timeout: 8000 });
    await sleep(2600);                       // UMD(완료 통지 없음)는 자체 시계 160ms/줄 → 11줄 ≈ 1.8s
    const st = await page.evaluate(() => ({
      sent: (window.__sent || []).filter(x => x.mode === 'GraphicMode').length,
      btn: document.querySelector('#dpBtn').textContent
    }));
    ok(label + ': connected + frame rows sent', st.sent >= 10 && /●/.test(st.btn), JSON.stringify(st));
    await browser.close();
  }

  // ── 3. Web Bluetooth 부재 → 인라인 안내 ──
  {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(DIST);
    await page.waitForSelector('#gallery .gcat');
    const hasBt = await page.evaluate(() => !!navigator.bluetooth);
    if (!hasBt) {
      await page.click('#dpBtn');
      await sleep(300);
      const msg = await page.evaluate(() => document.querySelector('#dpMsg').textContent);
      ok('no-bluetooth: inline message (not alert)', /Chrome|Edge/.test(msg), msg.slice(0, 60));
    } else console.log('  (headless has navigator.bluetooth — no-bt branch skipped)');
    await browser.close();
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
