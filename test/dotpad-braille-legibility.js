/* 실기기 문제 재현·검증: 치수 레이블 점자가 기기 핀으로 제대로 나오는가
 * 방법 — 뷰포트를 레이블 위에 두고 기기가 받은 60×40 핀을 역디코딩해
 *        점역 엔진이 낸 점자 셀과 도트 수·간격을 비교한다. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 전송 큐가 비고 in-flight가 없을 때까지 (한 줄씩 보내므로 프레임 완성까지 기다린다) */
const waitIdle = async p => { await p.waitForFunction(() => window.DOTPAD && !DOTPAD.BLE.inflight && DOTPAD.BLE.q.length === 0, null, { timeout: 20000 }); await sleep(60); };

/* 10행 hex → 60×40 0/1 그리드 (인코딩 bit = y%4 + (x%2)*4 역산) */
function rowsToGrid(rows) {
  const g = Array.from({ length: 40 }, () => new Array(60).fill(0));
  rows.forEach((hex, cy) => {
    for (let cx = 0; cx < 30; cx++) {
      const b = parseInt(hex.substr(cx * 2, 2), 16);
      for (let r = 0; r < 4; r++) {
        if (b & (1 << r)) g[cy * 4 + r][cx * 2] = 1;
        if (b & (1 << (r + 4))) g[cy * 4 + r][cx * 2 + 1] = 1;
      }
    }
  });
  return g;
}
const ascii = g => g.map(r => r.map(v => v ? '●' : '·').join('')).join('\n');
/* 연결된 잉크 덩어리 수 (8-이웃) — 점자 도트가 뭉치면 덩어리 수가 급감한다 */
function blobs(g) {
  const seen = g.map(r => r.map(() => false));
  let n = 0, sizes = [];
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    if (!g[y][x] || seen[y][x]) continue;
    n++; let size = 0; const st = [[y, x]]; seen[y][x] = true;
    while (st.length) {
      const [cy, cx] = st.pop(); size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ny = cy + dy, nx = cx + dx;
        if (ny >= 0 && ny < g.length && nx >= 0 && nx < g[0].length && g[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; st.push([ny, nx]); }
      }
    }
    sizes.push(size);
  }
  return { n, sizes };
}

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
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);
    DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.PROBE_TIMEOUT = 20;   // 테스트 가속 (실제 기본값 200ms는 별도 항목에서 검증)
    window.__key = k => window.__sim.fireKey(k, DOTPAD.BLE.devs[0].dev);
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(1400);

  // 세로 치수 레이블('27 feet')의 위치와 점역 결과를 spec에서 가져온다
  const info = await page.evaluate(() => {
    const spec = JSON.parse(document.querySelector('#json').value);
    const d = spec.elements.filter(e => e.type === 'dimension' && e._labelMm)
      .sort((a, b) => a._labelMm[0] - b._labelMm[0])[0];      // 가장 왼쪽 = 세로 치수
    const cells = TGIL.translate(d.label, spec.brailleCode || 'ueb');
    return { label: d.label, at: d._labelMm, expect: cells, dots: cells.reduce((s, c) => s + c.length, 0), cells: cells.length };
  });
  console.log(`  대상 레이블: "${info.label}" — ${info.cells}셀 / 도트 ${info.dots}개, 위치 ${info.at.map(v => Math.round(v))}mm\n`);

  /* 기기 핀에서 점자 셀을 역디코딩 (앱과 동일한 배치식: 셀 전진 3핀, 도트 간격 1핀) */
  async function decodeLabel(grid) {
    const vp = await page.evaluate(() => window.__dpInfo().vp);
    const wPins = info.cells * 3 - 1;
    const x0 = Math.round((info.at[0] - vp.x) * (60 / vp.w) - wPins / 2);
    const y0 = Math.round((info.at[1] - vp.y) * (40 / vp.h) - 1);
    const cells = [];
    for (let ci = 0; ci < info.cells; ci++) {
      const dots = [];
      [[0, 0, 1], [0, 1, 2], [0, 2, 3], [1, 0, 4], [1, 1, 5], [1, 2, 6]].forEach(([col, row, d]) => {
        const r = grid[y0 + row];
        if (r && r[x0 + ci * 3 + col]) dots.push(d);
      });
      cells.push(dots.sort((a, b) => a - b));
    }
    // 셀 사이 구분 열(빈 칸)이 실제로 비어 있는지도 확인
    let gaps = 0;
    for (let ci = 1; ci < info.cells; ci++) {
      const x = x0 + ci * 3 - 1;
      if (![0, 1, 2].some(r => grid[y0 + r] && grid[y0 + r][x])) gaps++;
    }
    return { cells, gaps, box: { x0, y0, wPins } };
  }

  async function frameAt(scale) {
    await page.evaluate(([s, x, y]) => {
      DOTPAD.BLE.devs.forEach(d => { d.lastSent = []; d.lastText = null; });   // 차분 초기화
      window.__setView(s, x, y);
    }, [scale, info.at[0], info.at[1]]);
    await sleep(1100);
    return page.evaluate(() => window.__sim.deviceState());
  }

  // ── 1:1 (기본) — 기기 핀에서 읽어낸 점자가 점역 결과와 셀 단위로 일치해야 한다 ──
  const g1 = rowsToGrid(await frameAt(1));
  console.log(ascii(g1).split('\n').slice(15, 25).join('\n'), '\n');
  const d1 = await decodeLabel(g1);
  console.log('  기기에서 읽은 셀:', JSON.stringify(d1.cells));
  console.log('  점역 엔진 출력  :', JSON.stringify(info.expect), '\n');
  ok('1:1 — braille on the device matches the translator, cell by cell',
    JSON.stringify(d1.cells) === JSON.stringify(info.expect));
  ok('1:1 — blank column between cells is preserved', d1.gaps === info.cells - 1, `${d1.gaps}/${info.cells - 1}`);
  const win1 = g1.slice(d1.box.y0 - 1, d1.box.y0 + 4).map(r => r.slice(d1.box.x0 - 1, d1.box.x0 + d1.box.wPins + 1));
  ok('1:1 — exactly one pin per braille dot (nothing smeared or merged)',
    win1.flat().filter(Boolean).length === info.dots, `핀 ${win1.flat().filter(Boolean).length}개 vs 도트 ${info.dots}개`);
  ok('1:1 — label area is clear of stray shape pins',
    win1[0].every(v => !v) && win1[win1.length - 1].every(v => !v));

  // ── 전체보기 — 판독 불가 배율이므로 점자를 아예 싣지 않는다 (도형만) ──
  const gFit = rowsToGrid(await frameAt('fit'));
  const dFit = await decodeLabel(gFit);
  const fitInfo = await page.evaluate(() => window.__dpInfo());
  ok('full view — app knows braille is illegible here', fitInfo.legible === false, `핀당 ${fitInfo.mmPerPin.toFixed(2)}mm`);
  ok('full view — braille not stamped (shape only, no unreadable mush)',
    JSON.stringify(dFit.cells) !== JSON.stringify(info.expect), JSON.stringify(dFit.cells.slice(0, 4)));
  const warn = await page.evaluate(() => {
    const el = document.querySelector('#dpWarn');
    return { shown: !!el, text: el ? el.textContent : '', frame: document.querySelector('#dpVp').textContent };
  });
  ok('full view — app warns the braille is unreadable', warn.shown && /braille|점자/.test(warn.text), warn.text.slice(0, 70));
  ok('full view — frame label flags it too', /⚠/.test(warn.frame), warn.frame);

  // ── 1:1로 돌아오면 경고가 사라진다 ──
  await frameAt(1);
  const cleared = await page.evaluate(() => ({
    warn: !!document.querySelector('#dpWarn'),
    frame: document.querySelector('#dpVp').textContent
  }));
  ok('1:1 — warning clears', !cleared.warn && !/⚠/.test(cleared.frame), cleared.frame);
  ok('1:1 — frame labelled as actual size', /1:1/.test(cleared.frame), cleared.frame);

  // ── 2× 확대에서도 점자는 기기 규격 그대로 (도형만 커진다) ──
  const g2 = rowsToGrid(await frameAt(2));
  const d2 = await decodeLabel(g2);
  ok('2× — braille still matches the translator (device pitch, not scaled)',
    JSON.stringify(d2.cells) === JSON.stringify(info.expect), JSON.stringify(d2.cells.slice(0, 4)));

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
