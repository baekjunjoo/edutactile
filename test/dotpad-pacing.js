/* 연결 끊김 원인 검증: 전송 폭주 방지 (실제 기본 간격 200ms 그대로)
 * SDK sendCommand는 전송 중 재호출 시 큐잉이 아니라 restart가 걸리는 상태머신이라,
 * 한 프레임의 여러 줄을 연달아 쏘면 전송이 끝나지 않고 링크가 죽는다. */
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`
    Object.defineProperty(navigator, 'bluetooth', { value: {} });
    window.__mock = (function(){ const module = { exports: {} }; ${mockSrc}; return module.exports; })();
  `);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');
  await page.evaluate(() => {
    window.__sim = window.__mock.createMockSdk();
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);   // MIN_INTERVAL은 실제 기본값(200) 유지
    window.__key = k => window.__sim.fireKey(k, DOTPAD.BLE.devs[0].dev);
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);

  // ── 1. 기본 간격이 계약값(200ms)인지 ──
  const iv = await page.evaluate(() => DOTPAD.BLE.MIN_INTERVAL);
  ok('default send interval is 200ms (bandwidth guard)', iv === 200, iv);

  // ── 2. 한 번에 한 줄만 in-flight (동시 전송 없음) ──
  await sleep(2500);
  const conc = await page.evaluate(() => {
    // 로그 타임스탬프 간격 분석
    const g = window.__sim.log;
    let minGap = Infinity;
    for (let i = 1; i < g.length; i++) minGap = Math.min(minGap, g[i].t - g[i - 1].t);
    return { n: g.length, minGap: g.length > 1 ? minGap : null, inflight: !!DOTPAD.BLE.inflight };
  });
  ok('lines are paced, never blasted back-to-back',
    conc.n > 1 && conc.minGap >= 150, `전송 ${conc.n}건, 최소 간격 ${conc.minGap}ms`);

  // ── 3. 조작 폭주 → 큐가 최신 프레임으로 합쳐진다 (오래된 프레임 폐기) ──
  const flood = await page.evaluate(async () => {
    const before = window.__sim.log.length;
    for (let i = 0; i < 12; i++) {          // 확대·이동을 빠르게 연타
      window.__key(i % 2 ? 'PanningRight' : 'PanningLeft');
      await new Promise(r => setTimeout(r, 30));
    }
    const qPeak = DOTPAD.BLE.q.length;
    await new Promise(r => setTimeout(r, 3000));
    return { sent: window.__sim.log.length - before, qPeak };
  });
  ok('queue never exceeds one screen (11 lines) under key spam', flood.qPeak <= 11, `큐 최대 ${flood.qPeak}건`);
  ok('12 rapid key presses do not produce 12 frames of traffic',
    flood.sent <= 40, `전송 ${flood.sent}건 (합쳐지지 않으면 100건 이상)`);

  // ── 4. 무응답 기기에서도 멈추지 않는다 (ACK 없이도 다음 줄로) ──
  const noAck = await page.evaluate(async () => {
    const before = window.__sim.log.length;
    DOTPAD.BLE.devs.forEach(d => { d.lastSent = []; });   // 전체 재전송 유도
    window.__key('KeyFunction1');
    await new Promise(r => setTimeout(r, 3000));
    return window.__sim.log.length - before;
  });
  ok('keeps sending without ACK (timeout fallback)', noAck >= 5, `${noAck}건`);

  // ── 5. 끊김 시: 대기분 폐기 + 자동 재연결 시도 + 안내 ──
  const lost = await page.evaluate(async () => {
    const dev = DOTPAD.BLE.devs[0].dev;
    window.__sim.fireMessage('Disconnected', dev);
    await new Promise(r => setTimeout(r, 150));
    return {
      q: DOTPAD.BLE.q.length, inflight: !!DOTPAD.BLE.inflight,
      retries: DOTPAD.BLE.retries, msg: document.querySelector('#dpMsg').textContent
    };
  });
  ok('pending lines dropped for the lost device', lost.q === 0 && !lost.inflight, JSON.stringify(lost));
  ok('auto-reconnect is attempted', lost.retries >= 1, lost.retries);
  ok('user is told what happened', /reconnect|재연결|disconnect|끊/.test(lost.msg), lost.msg.slice(0, 60));

  // ── 6. 재연결 성공 시 정상 복귀 ──
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1, null, { timeout: 8000 }).catch(() => {});
  const back = await page.evaluate(() => ({ ready: DOTPAD.BLE.readyCount(), retries: DOTPAD.BLE.retries }));
  ok('reconnected device resumes (retries reset)', back.ready === 1 && back.retries === 0, JSON.stringify(back));

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
