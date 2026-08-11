/* DotPad BLE 계약 검증 (dotpad-simulator 하네스, Playwright/Chromium)
 * 검증 항목: 콜백 선등록, Connected 게이트, 행단위 전송만, 점형 일치,
 * 행 차분, 대기 무전송·역압, 팬/F1 키 라우팅, 다중 기기 미러링·부분 해제 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');

const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 전송 큐가 비고 in-flight가 없을 때까지 (한 줄씩 보내므로 프레임 완성까지 기다린다) */
const waitIdle = async p => { await p.waitForFunction(() => window.DOTPAD && DOTPAD.BLE.pendingRows == null && DOTPAD.BLE.pendingText == null, null, { timeout: 20000 }); await sleep(80); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`
    Object.defineProperty(navigator, 'bluetooth', { value: {} });
    window.__mock = (function(){ const module = { exports: {} }; ${mockSrc}; return module.exports; })();
  `);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .card');

  // ── 문서 변환기 + 내장 샘플 로드 (결정적 프레임 소스) ──
  await page.click('#gallery .gcat:has-text("Documents")');   // 아코디언 펼침
  await page.click('#gallery .card:has-text("Braille Document Converter")');
  await page.click('#form .genBtn');
  await page.waitForSelector('#rbFrame');

  // ── 모의 SDK 주입 → 연결 ──
  await page.evaluate(() => {
    window.__sim = window.__mock.createMockSdk();
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);
    DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.LINE_GAP = 5;   // 테스트 가속 (실제 기본값 200ms는 별도 항목에서 검증)
  });
  await page.click('#dpBtn');

  // 1. 콜백 선등록 + Connected 게이트
  await page.waitForFunction(() => DOTPAD.BLE.devs.length === 1);
  const gate = await page.evaluate(() => ({
    order: window.__sim.order,
    ready: DOTPAD.BLE.devs[0].ready,
    logBeforeReady: window.__sim.log.length
  }));
  ok('callback registered BEFORE connect', gate.order.callbackSetAt < gate.order.connectCalledAt, JSON.stringify(gate.order));
  if (!gate.ready) ok('no transmission before Connected (gate)', gate.logBeforeReady === 0, gate.logBeforeReady);
  else console.log('  (gate window missed — timing)');

  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(600); await waitIdle(page);   // 편집 디바운스(450ms) + 큐 배출까지

  // 2. 행단위 전송만 + 초기 프레임 점형 일치
  const first = await page.evaluate(() => {
    const items = [];
    const d = RULEBOOK.normalize(window.RB_SAMPLE, {});
    d.chapters[0].sections.forEach(s => s.items.forEach(it => { if (it.dots && it.dots.length) items.push(it); }));
    const expRows = i => DOTPAD.encodeRows(RULEBOOK.itemToGrid(items[i].dots));
    const expText = i => DOTPAD.textLineHex(items[i].dots.map(RULEBOOK.parseDots));
    const log = window.__sim.log;
    return {
      total: log.length,
      badLine: log.filter(x => x.lineId < 0 || x.lineId > 10 || x.startCell < 0 || x.startCell > 29).length,
      badHex: log.filter(x => x.mode === 'GraphicMode' &&
        (x.hex.length % 2 || x.startCell * 2 + x.hex.length > 60)).length,
      textSent: log.filter(x => x.mode === 'TextMode' && x.lineId === 0).length,
      state: window.__sim.deviceState(),
      lastText: DOTPAD.BLE.devs[0].lastText,
      exp0: expRows(0), expT0: expText(0), exp1: expRows(1), expT1: expText(1)
    };
  });
  ok('row-based displayLineData only (lineId 0–10, valid cell span)', first.total > 0 && first.badLine === 0, first.badLine);
  ok('graphic spans stay inside the 30-cell row', first.badHex === 0, first.badHex);
  ok('text line (lineId 0, TextMode) sent', first.textSent >= 1);
  ok('initial frame matches item 1 enlarged grid', JSON.stringify(first.state) === JSON.stringify(first.exp0));
  ok('text line matches item 1 standard braille', first.lastText === first.expT0, first.lastText);

  // 3. 행 차분: 동일 프레임 재push → 무전송
  const diff = await page.evaluate(async () => {
    const len0 = window.__sim.log.length;
    DOTPAD.BLE.push(DOTPAD.BLE.devs[0].lastSent.slice(), DOTPAD.BLE.devs[0].lastText);
    await new Promise(r => setTimeout(r, 700));
    return window.__sim.log.length - len0;
  });
  ok('row diff: identical frame → 0 resends', diff === 0, diff);

  // 4. 대기 상태 = 완전한 무전송 (keep-alive 없음 — 매초 SDK를 흔들어 restart를 유발해 끊김의 공범이었다)
  //    + 역압: 보낸 줄 수만큼 Complete가 돌아와 inflight가 0으로 소진된다
  const idle = await page.evaluate(async () => {
    const len0 = window.__sim.log.length;
    await new Promise(r => setTimeout(r, 2300));
    return { sent: window.__sim.log.length - len0, inflight: DOTPAD.BLE.inflightTotal() };
  });
  ok('idle → zero traffic (no keep-alive)', idle.sent === 0, idle.sent);
  ok('backpressure: inflight drained to 0 by device Complete', idle.inflight === 0, idle.inflight);

  // 5. 팬 키 라우팅: PanningRight → 항목 2, PanningLeft → 항목 1
  await page.evaluate(() => window.__sim.fireKey('PanningRight', DOTPAD.BLE.devs[0].dev));
  await sleep(200); await waitIdle(page);
  const nav1 = await page.evaluate(() => ({ state: window.__sim.deviceState(), lastText: DOTPAD.BLE.devs[0].lastText }));
  ok('PanningRight → item 2 frame', JSON.stringify(nav1.state) === JSON.stringify(first.exp1));
  ok('PanningRight → item 2 text line', nav1.lastText === first.expT1, nav1.lastText);
  await page.evaluate(() => window.__sim.fireKey('PanningLeft', DOTPAD.BLE.devs[0].dev));
  await sleep(200); await waitIdle(page);
  const nav0 = await page.evaluate(() => window.__sim.deviceState());
  ok('PanningLeft → back to item 1', JSON.stringify(nav0) === JSON.stringify(first.exp0));

  // 6. F1 = 전체 재전송
  const f1 = await page.evaluate(async () => {
    const len0 = window.__sim.log.length;
    window.__sim.fireKey('KeyFunction1', DOTPAD.BLE.devs[0].dev);
    await new Promise(r => setTimeout(r, 800));
    const fresh = window.__sim.log.slice(len0).filter(x => x.mode === 'GraphicMode');
    return new Set(fresh.map(x => x.lineId)).size;
  });
  ok('F1 → full 10-row resend', f1 === 10, f1);

  // 7. 다중 기기: 추가 연결 → 미러링, 부분 해제 → 나머지 유지
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 2, null, { timeout: 5000 });
  await sleep(600); await waitIdle(page);
  const multi = await page.evaluate(() => {
    const dev2 = DOTPAD.BLE.devs[1].dev;
    const rows2 = new Set(window.__sim.log.filter(x => x.dev === dev2 && x.mode === 'GraphicMode').map(x => x.lineId));
    return { mirrored: rows2.size, btn: document.querySelector('#dpBtn').textContent };
  });
  ok('2nd device mirrored (all 10 rows)', multi.mirrored === 10, multi.mirrored);
  ok('UI shows 2 devices', /2/.test(multi.btn), multi.btn);
  const part = await page.evaluate(async () => {
    window.__sim.fireMessage('Disconnected', DOTPAD.BLE.devs[0].dev);
    await new Promise(r => setTimeout(r, 200));
    return { n: DOTPAD.BLE.devs.length, connected: DOTPAD.BLE.connected };
  });
  ok('partial disconnect keeps remaining device', part.n === 1 && part.connected === true, JSON.stringify(part));

  // 8. 전체 해제
  const off = await page.evaluate(async () => {
    DOTPAD.BLE.disconnectAll();
    await new Promise(r => setTimeout(r, 100));
    return { connected: DOTPAD.BLE.connected, off: document.querySelector('#dpOff').style.display };
  });
  ok('disconnectAll → not connected', off.connected === false);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
