/* 전송 계층 검증 — 실기기 검증 패턴(Dote/공식 데모)과의 일치
 * 핵심: 행은 버스트(SDK 내부가 큐·ACK 처리), 프레임은 200ms×기기수 스로틀 + 최신만,
 *       keep-alive는 현재 화면에서 1행/s, 끊김 시 자동 재연결. */
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
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);   // 실제 기본 간격(200ms) 유지
    window.__key = k => window.__sim.fireKey(k, DOTPAD.BLE.devs[0].dev);
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(1600);

  // ── 1. 기본 간격 계약값 ──
  const iv = await page.evaluate(() => DOTPAD.BLE.MIN_INTERVAL);
  ok('frame throttle is 200ms (contract value)', iv === 200, iv);

  // ── 2. 프레임 안의 행들은 버스트 — Dote 검증 패턴 (SDK 내부가 페이싱) ──
  const first = await page.evaluate(() => {
    const g = window.__sim.log.filter(x => x.mode === 'GraphicMode');
    const t0 = g.length ? g[0].t : 0;
    const burst = g.filter(x => x.t - t0 < 100).length;   // 첫 프레임: 100ms 안에 여러 행
    return { total: g.length, burst };
  });
  ok('rows within a frame go back-to-back (SDK-internal pacing)', first.burst >= 5, `첫 100ms 안 ${first.burst}행`);

  // ── 3. 키 연타 → 프레임 스로틀 + 최신 프레임만 (오래된 프레임 폐기) ──
  const flood = await page.evaluate(async () => {
    const frames = [];                       // 프레임 시작 시각 기록 (같은 tick 묶음)
    const before = window.__sim.log.length;
    for (let i = 0; i < 12; i++) {
      window.__key(i % 2 ? 'KeyFunction3' : 'KeyFunction2');
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 2500));
    const log = window.__sim.log.slice(before).filter(x => x.mode === 'GraphicMode');
    let f = 0, lastT = -1e9;
    log.forEach(x => { if (x.t - lastT > 120) f++; lastT = x.t; });
    return { sent: log.length, frames: f };
  });
  ok('12 rapid keys collapse to a few throttled frames', flood.frames <= 5, `프레임 ${flood.frames}개`);
  ok('stale frames dropped (bounded traffic)', flood.sent <= 45, `전송 ${flood.sent}행`);

  // ── 3b. ★ 대량 변경 프레임 뒤 냉각: SDK가 LIVE 줄을 1.5s×3회 자동 재전송하므로
  //        전 행이 바뀌는 프레임(팬·확대)을 연달아 보내면 기기 명령이 4배로 폭주 → 끊김.
  //        무거운 프레임 뒤 다음 프레임은 HEAVY_GAP(1.6s) 이상 띄운다. ──
  //        (keep-alive를 멈추고 측정 — 단일 행 재전송이 프레임 경계로 오인되지 않게)
  const heavy = await page.evaluate(async () => {
    DOTPAD.BLE.stopKeepAlive();
    await new Promise(r => setTimeout(r, 2000));      // 직전 프레임의 냉각 소진
    const g0 = window.__sim.log.filter(x => x.mode === 'GraphicMode').length;
    window.__key('KeyFunction3');                     // 전 행 교체 프레임 1
    await new Promise(r => setTimeout(r, 400));
    window.__key('KeyFunction3');                     // 전 행 교체 프레임 2 — 냉각 후에 나가야 함
    await new Promise(r => setTimeout(r, 4000));
    const log = window.__sim.log.filter(x => x.mode === 'GraphicMode').slice(g0);
    const starts = []; let lastT = -1e9;
    log.forEach(x => { if (x.t - lastT > 120) starts.push(x.t); lastT = x.t; });
    let minGap = Infinity;
    for (let i = 1; i < starts.length; i++) minGap = Math.min(minGap, starts[i] - starts[i - 1]);
    return { frames: starts.length, gap: starts.length >= 2 ? starts[1] - starts[0] : null,
             minGap: starts.length > 1 ? minGap : null, cool: DOTPAD.BLE.HEAVY_GAP };
  });
  ok('heavy frame → next frame waits for SDK refresh window (≥1.6s)',
    heavy.gap != null && heavy.gap >= heavy.cool - 50, `프레임 간 ${heavy.gap}ms (기준 ${heavy.cool}ms)`);
  ok('frames are ≥200ms apart', heavy.minGap == null || heavy.minGap >= 190, `최소 ${heavy.minGap}ms`);
  await page.evaluate(() => DOTPAD.BLE.startKeepAlive());

  // ── 5. keep-alive: 현재 화면에서 1행/s, 0(빈 행) 전송 금지 ──
  const ka = await page.evaluate(async () => {
    const st0 = JSON.stringify(window.__sim.deviceState());
    const before = window.__sim.log.length;
    await new Promise(r => setTimeout(r, 3200));
    const fresh = window.__sim.log.slice(before).filter(x => x.mode === 'GraphicMode');
    return {
      sent: fresh.length,
      same: st0 === JSON.stringify(window.__sim.deviceState()),
      zeros: fresh.filter(x => x.hex === '0'.repeat(60) &&
        window.__sim.deviceState()[x.lineId - 1] !== '0'.repeat(60)).length
    };
  });
  ok('keep-alive ~1 row/s while idle', ka.sent >= 2 && ka.sent <= 5, ka.sent);
  ok('keep-alive resends the CURRENT screen (never blanks a row)', ka.same && ka.zeros === 0, JSON.stringify(ka));

  // ── 6. 끊김 → 자동 재연결 + 안내 + 복귀 후 화면 복원 ──
  const lost = await page.evaluate(async () => {
    window.__sim.fireMessage('Disconnected', DOTPAD.BLE.devs[0].dev);
    await new Promise(r => setTimeout(r, 150));
    return { retries: DOTPAD.BLE.retries, msg: document.querySelector('#dpMsg').textContent };
  });
  ok('auto-reconnect attempted on unexpected drop', lost.retries >= 1, lost.retries);
  ok('user told what happened', /reconnect|재연결|disconnect|끊/.test(lost.msg), lost.msg.slice(0, 60));
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1, null, { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const back = await page.evaluate(() => ({
    ready: DOTPAD.BLE.readyCount(), retries: DOTPAD.BLE.retries,
    ink: window.__sim.deviceState().some(r => r !== '0'.repeat(60))
  }));
  ok('reconnected and screen restored (retries reset)', back.ready === 1 && back.retries === 0 && back.ink, JSON.stringify(back));

  // ── 7. BoardInfo 수신 → 전체 화면 재전송 (SDK가 준비 전 라인을 버리는 것 보상) ──
  const bi = await page.evaluate(async () => {
    const before = window.__sim.log.length;
    window.__sim.fireMessage('BoardInfo', DOTPAD.BLE.devs[0].dev);
    await new Promise(r => setTimeout(r, 1200));
    const fresh = window.__sim.log.slice(before).filter(x => x.mode === 'GraphicMode');
    return new Set(fresh.map(x => x.lineId)).size;
  });
  ok('BoardInfo triggers a full repaint', bi >= 8, `${bi}행 재전송`);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
