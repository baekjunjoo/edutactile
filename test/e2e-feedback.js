/* 피드백 1~7 + DotPad 그래픽 모드 E2E (빌드된 단일 파일 기준) */
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
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`
    Object.defineProperty(navigator, 'bluetooth', { value: {} });
    window.__mock = (function(){ const module = { exports: {} }; ${mockSrc}; return module.exports; })();
  `);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .card');

  // ── 항목 3: 리드선 점선 (치수선과 촉각 구분) ──
  await page.click('#labelMode');
  await page.click('#preview svg', { position: { x: 300, y: 200 } });
  await page.fill('#labelInput', 'net');
  await page.press('#labelInput', 'Enter');
  await sleep(300);
  const leaderDash = await page.evaluate(() => {
    const svg = document.querySelector('#preview').innerHTML;
    return /stroke-dasharray="2,1.2"/.test(svg);
  });
  ok('item 3: leader lines dashed (2,1.2)', leaderDash);

  // ── DotPad 그래픽 모드: 현재 도면이 60×40으로 push ──
  await page.evaluate(() => {
    window.__sim = window.__mock.createMockSdk();
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(1200);   // rasterize(Image onload) + pump
  const gfx = await page.evaluate(() => {
    const st = window.__sim.deviceState();
    return { ink: st.some(r => r !== '0'.repeat(60)), rows: st.length };
  });
  ok('graphics mode: preview pushed to DotPad (has ink)', gfx.ink && gfx.rows === 10, JSON.stringify(gfx));
  const keysHint = await page.evaluate(() => document.querySelector('#report').textContent);
  ok('report shows DotPad key guide', /pan keys|팬 키/.test(keysHint));

  // ── 항목 7: 시퀀스 접기 ──
  await page.click('#addPage');
  await sleep(200);
  await page.click('#h-seq');
  const collapsed = await page.evaluate(() => document.querySelector('#seqList').style.display === 'none');
  await page.click('#h-seq');
  const expanded = await page.evaluate(() => document.querySelector('#seqList').style.display !== 'none');
  ok('item 7: sequence header toggles collapse', collapsed && expanded);

  // ── 문서 변환기 진입 ──
  await page.click('#gallery .card:has-text("Braille Document Converter")');
  // 항목 6: hwp 안내
  const hint = await page.evaluate(() => document.querySelector('#form .hint').textContent);
  ok('item 6: HWP guidance in converter hint', /hwp|HWP/i.test(hint), hint.slice(0, 60));
  await page.click('#form .genBtn');
  await page.waitForSelector('#rbFrame');
  const btns = await page.evaluate(() => ({
    ebrl: document.querySelector('#ex-ebrl').style.display !== 'none',
    docx: document.querySelector('#ex-docx').style.display !== 'none',
    ebrlLabel: document.querySelector('#ex-ebrl').textContent
  }));
  ok('item 2: eBraille (.ebrl) button visible in converter', btns.ebrl && /ebrl/i.test(btns.ebrlLabel), JSON.stringify(btns));
  ok('Word (.docx) button visible', btns.docx);

  // ── 항목 1: 교정 UI — iframe 항목 클릭 → 패널 → 점 수정 → 저장 → 반영 ──
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForSelector('[data-rbid]');
  const rbid = await frame.evaluate(() => {
    const el = document.querySelector('[data-rbid]');
    el.scrollIntoView();
    return el.getAttribute('data-rbid');
  });
  await frame.click('[data-rbid="' + rbid + '"]');
  await sleep(200);
  const panel = await page.evaluate(() => ({
    visible: document.querySelector('#rbFix').style.display !== 'none',
    title: document.querySelector('#rbFixTitle').textContent
  }));
  ok('item 1: clicking item opens correction panel', panel.visible && panel.title.includes(rbid), JSON.stringify(panel));
  await page.fill('#rbFixName', 'TEST-FIX');
  await page.fill('#rbFixDots', '1-2, 4');
  await page.click('#rbFixSave');
  await sleep(400);
  const fixed = await page.evaluate((id) => {
    const doc = document.querySelector('#rbFrame').contentDocument;
    const el = doc.querySelector('[data-rbid="' + id + '"]');
    return { cls: el.className, report: document.querySelector('#report').textContent };
  }, rbid);
  ok('item 1: fixed item marked in preview', /fixed/.test(fixed.cls), fixed.cls);
  ok('item 1: report counts manual fixes', /교정 1건|1 manual fix/.test(fixed.report));

  // 검증본 JSON에 교정 반영 확인
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ex-json')]);
  const jpath = await dl.path();
  const verified = JSON.parse(fs.readFileSync(jpath, 'utf8'));
  const fixedItem = verified.sections.flatMap(s => s.items).find(it => it.name === 'TEST-FIX');
  ok('item 1: verified.json carries the fix (dots 1-2, 4)', fixedItem && JSON.stringify(fixedItem.dots) === '["1-2","4"]', fixedItem && JSON.stringify(fixedItem.dots));
  ok('verified.json filename', dl.suggestedFilename() === 'braille-document.verified.json', dl.suggestedFilename());

  // ── 항목 2: .ebrl 다운로드 (ZIP 시그니처 + mimetype) ──
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#ex-ebrl')]);
  const epath = await dl2.path();
  const buf = fs.readFileSync(epath);
  ok('.ebrl downloads as ZIP (PK)', buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 10000, buf.length);
  ok('.ebrl mimetype first entry', buf.slice(30, 38).toString() === 'mimetype');
  ok('.ebrl filename', dl2.suggestedFilename() === 'braille-document.ebrl', dl2.suggestedFilename());

  // ── BRF 맥락 병기 ──
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#ex-brf')]);
  const brf = fs.readFileSync(await dl3.path(), 'utf8');
  ok('BRF has transcribed context lines (letters before dots)', /^AL/m.test(brf) && brf.split('\r\n').length > 100, brf.split('\r\n')[0]);

  // ── DotPad 규정집 모드로 전환돼 있는지 (연결 유지 상태에서 템플릿 전환) ──
  await sleep(900);
  const rbPush = await page.evaluate(() => {
    const st = window.__sim.deviceState();
    return st.some(r => r !== '0'.repeat(60));
  });
  ok('DotPad follows template switch (rulebook item frame)', rbPush);

  // ── 한국어 빌드 스모크 ──
  const ko = await ctx.newPage();
  await ko.goto('file://' + path.resolve(__dirname, '../dist/tactile-material-maker-ko.html'));
  await ko.waitForSelector('#gallery .card');
  const koChrome = await ko.evaluate(() => ({
    name: document.querySelector('#appName').textContent,
    dp: document.querySelector('#dpBtn').textContent,
    svg: !!document.querySelector('#preview svg')
  }));
  ok('KO build: app name + DotPad button + preview', koChrome.name === '촉각 교육자료 제작 도구' && koChrome.dp === 'DotPad 연결' && koChrome.svg, JSON.stringify(koChrome));

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
