/* 전송 계층 검증 — 한 줄씩, 기기 완료(Complete) 통지에 맞춰 (기기 속도가 곧 페이스)
 * 핵심: 프레임 diff를 기기별 queue에 담고 한 줄 보내면 Complete까지 대기 — 기기 명령
 * 큐 깊이가 항상 ≤1이라 밀어넣기가 원천 봉쇄된다(누적 수십 줄 뒤 끊김의 근본 대책).
 * 새 프레임은 남은 queue를 교체(최신 화면만). 줄 무응답은 LINE_TIMEOUT 후 건너뛰고,
 * 연속 3회면 좀비 링크로 판정해 즉시 강제 재연결한다. */
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

  // ── 2. 프레임 안의 행들은 버스트 — 검증 패턴 (SDK 내부가 페이싱) ──
  const first = await page.evaluate(() => {
    const g = window.__sim.log.filter(x => x.mode === 'GraphicMode');
    const t0 = g.length ? g[0].t : 0;
    const burst = g.filter(x => x.t - t0 < 100).length;   // 첫 프레임: 100ms 안에 여러 행
    return { total: g.length, burst };
  });
  ok('fast device: a frame drains quickly (Complete-paced)', first.burst >= 5, `첫 100ms 안 ${first.burst}행`);

  // ── 3. 키 연타 → 프레임 스로틀 + 최신 프레임만 (오래된 프레임 폐기) ──
  const flood = await page.evaluate(async () => {
    const before = window.__sim.log.length;
    for (let i = 0; i < 12; i++) {
      window.__key(i % 2 ? 'KeyFunction4' : 'KeyFunction2');
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 2500));
    const log = window.__sim.log.slice(before).filter(x => x.mode === 'GraphicMode');
    let f = 0, lastT = -1e9;
    log.forEach(x => { if (x.t - lastT > 120) f++; lastT = x.t; });
    return { sent: log.length, frames: f, inflight: DOTPAD.BLE.inflightTotal() };
  });
  ok('12 rapid keys collapse to a few throttled frames', flood.frames <= 6, `프레임 ${flood.frames}개`);
  ok('stale frames dropped (bounded traffic)', flood.sent <= 45, `전송 ${flood.sent}행`);
  ok('all lines completed (inflight back to 0)', flood.inflight === 0, flood.inflight);

  // ── 4. ★ 흐름제어: 한 줄 보내면 기기 완료(Complete)까지 대기 — 명령 큐 깊이 항상 ≤1.
  //        기기가 느려도 밀어넣기가 원천 봉쇄되고, 새 프레임은 남은 줄들을 교체한다(최신만). ──
  const bp = await page.evaluate(async () => {
    window.__sim.completeDelay = 400;                  // 느린 기기 흉내: 줄당 400ms 소화
    const before = window.__sim.log.length;
    window.__key('LPF1');                              // 프레임 1: 축소 — 전 행 교체 (가장자리 클램프 무관)
    await new Promise(r => setTimeout(r, 600));        // 키 디바운스(60)+프레임 스로틀 뒤 ~1줄 소화 시점
    const early = window.__sim.log.length - before;    // 이 시점: 최대 2줄 (깊이 ≤1 증명)
    const inflightMid = DOTPAD.BLE.inflightTotal();
    window.__key('RPF4');                              // 프레임 2: 확대 — 남은 프레임1 줄들을 교체해야 함
    await new Promise(r => setTimeout(r, 6000));
    const total = window.__sim.log.length - before;
    window.__sim.completeDelay = 8;
    const gaps = window.__sim.log.slice(before + 1).map((x, i) => x.t - window.__sim.log[before + i].t);
    return { early, inflightMid, total, inflight: DOTPAD.BLE.inflightTotal(),
             paced: gaps.filter(g => g >= 380).length, n: gaps.length };
  });
  ok('slow device: command queue depth stays ≤1 (no pile-up)', bp.early <= 2 && bp.inflightMid > 0,
    `600ms 시점 ${bp.early}행 / inflight ${bp.inflightMid}`);
  ok('lines paced by device Complete (~400ms each)', bp.paced >= bp.n - 2, `${bp.paced}/${bp.n} 간격 ≥380ms`);
  ok('stale frame-1 lines replaced by frame 2, queue drains', bp.total <= 14 && bp.inflight === 0,
    `최종 ${bp.total}행 / inflight ${bp.inflight}`);

  // ── 5. 대기 상태 = 완전한 무전송 (keep-alive 제거 — restart 유발로 끊김의 공범이었다) ──
  const quiet = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 1200));       // 직전 잔여 소진
    const before = window.__sim.log.length;
    await new Promise(r => setTimeout(r, 2500));
    return window.__sim.log.length - before;
  });
  ok('idle → zero SDK calls (no keep-alive poking restarts)', quiet === 0, quiet);

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
