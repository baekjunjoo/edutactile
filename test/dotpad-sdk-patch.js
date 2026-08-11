/* SDK 로드 패치 검증 — 실기기 끊김의 근본 원인과 그 수정
 *
 * DotPadSDK 3.0.0의 결함(실측): refreshItem에 "함수"가 담기는데 취소는
 * clearTimeout(그 함수)로 한다 — 조용한 no-op이라 LIVE 리프레시 타이머를 취소할
 * 방법이 없다. 연속 조작 중에는 매 변경이 refreshCount를 0으로 되돌려 refreshLine
 * (최대 11줄)이 비워지지 않고, 취소 불가 타이머가 1.5초마다 그 전체를 재전송한다.
 * → 기기 명령 버퍼 누적 → 누적 수십 프레임 뒤 펌웨어가 BLE를 끊는다.
 * ("전송 수십 회 넘어가면 끊긴다"의 정체. 앱에서는 보이지 않는 SDK 내부 트래픽.)
 *
 * 이 테스트는 ① 원본 SDK로 결함을 재현하고 ② patchSdkSrc 적용본으로 수정을 확인한다.
 * 실제 DotPadSDK-3.0.0.js를 그대로 로드해 내부 送信모듈을 직접 구동한다(모의 아님). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const DOTPAD = require(path.join(__dirname, '../app/dotpad.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SRC = fs.readFileSync(path.join(__dirname, '../app/DotPadSDK-3.0.0.js'), 'utf8');

/* SDK 소스를 임시 ESM으로 저장하며 내부 클래스를 테스트용으로 노출 */
async function loadSdk(code, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsdk-patch-'));
  const f = path.join(dir, tag + '.mjs');
  fs.writeFileSync(f, code + '\nexport { DotPadSendModule, RefreshMode };\n');
  return import('file://' + f);
}

/* 送信모듈 하네스: 가짜 기기(줄당 ackDelay ms 뒤 ACK+Complete)를 붙여 구동 */
function harness(mod) {
  const writes = [];
  const fake = {
    cellType: 'D2',                          // D2 경로가 refreshCommand를 돈다
    sendCommand: async (buf) => {
      const b = new Uint8Array(buf);
      writes.push({ t: Date.now(), line: b[4] });
      setTimeout(() => { sm.setDotPadLineReceiveAck(b[4], true); sm.setDotCommandSendReady(true); }, 3);
    }
  };
  const sm = new mod.DotPadSendModule(fake);
  for (let i = 0; i < 11; i++) sm.addDotPadLine(60, 30);   // 텍스트 1 + 그래픽 10줄, requestTime 60ms
  /* DotDevice.displayLineData와 동일한 순서: 줄마다 setCommand → setRefreshMode(LIVE) → sendCommand */
  const line = (r, hex) => {
    sm.setDotPadLineCommand(r, '00', 0, hex);
    sm.setRefreshMode(mod.RefreshMode.LIVE_DISPLAY);
    sm.sendCommand(true);
  };
  const frame = (fill) => { for (let r = 1; r <= 10; r++) line(r, fill.repeat(30)); };
  return { sm, writes, frame, line };
}

(async () => {
  // ── 1. 패치가 실제 SDK 소스에 전부 적용되는지 ──
  const patched = DOTPAD.BLE.patchSdkSrc(SRC);
  ok('4/4 patches applied to the real SDK source', DOTPAD.BLE.sdkPatches === 4, DOTPAD.BLE.sdkPatches);
  ok('refresh timer id is stored (cancellable)', patched.includes('this.refreshTimer=setTimeout(this.refreshItem,'));
  ok('clearTimeout targets the id, not the function', !patched.includes('clearTimeout(this.refreshItem)'));
  ok('LIVE refresh reduced 3 → 1 round', patched.includes('liveRefresh(){this.refreshCount<1?'));
  ok('Complete forwarded to app callback (backpressure)',
    patched.includes('setDotCommandSendReady(!0),this.#s(this,e,t);break;'));

  // ── 2. 원본 SDK: 결함 재현 — 프레임 뒤 리프레시가 취소 불가, 3회 전체 재전송 ──
  const orig = harness(await loadSdk(SRC, 'orig'));
  orig.frame('FF');
  await sleep(400);
  const sent0 = orig.writes.length;                       // 프레임 자체 (10줄)
  orig.sm.setRefreshMode('LIVE_DISPLAY');                 // "취소" 시도 — 결함: clearTimeout(함수)는 no-op
  await sleep(5200);                                      // 리프레시 창(1.5s×3회) 관찰
  const ghost = orig.writes.length - sent0;
  ok('original SDK: refresh fires despite cancel — invisible retransmission (bug reproduced)',
    ghost >= 20, `취소 후에도 ${ghost}줄 재전송 (10줄 프레임의 ${(ghost / 10).toFixed(1)}배)`);

  // ── 3. 패치본: 같은 시나리오에서 취소가 실제로 듣는다 ──
  const fix = harness(await loadSdk(patched, 'patched'));
  fix.frame('FF');
  await sleep(400);
  const fsent0 = fix.writes.length;
  fix.sm.setRefreshMode('LIVE_DISPLAY');                  // 이제 진짜로 취소된다
  await sleep(5200);
  const fghost = fix.writes.length - fsent0;
  ok('patched SDK: cancelled refresh stays cancelled (no ghost traffic)', fghost === 0, `${fghost}줄`);

  // ── 4. 패치본: 정지 후 보강 리프레시는 1회만 — 유한하게 끝난다 ──
  const one = harness(await loadSdk(patched, 'patched2'));
  one.frame('AA');
  await sleep(6500);                                      // 아무도 건드리지 않고 방치
  const total = one.writes.length;
  const after4s = one.writes.filter(w => w.t - one.writes[0].t > 4000).length;
  ok('patched SDK: one reinforcement round then silence (10+10 lines, bounded)',
    total >= 19 && total <= 22 && after4s === 0, `총 ${total}줄, 4초 이후 ${after4s}줄`);

  // ── 5. 패치본: 연속 프레임 — 이전 프레임의 리프레시가 다음 프레임에 눌려 폭주하지 않는다 ──
  const nav = harness(await loadSdk(patched, 'patched3'));
  nav.frame('11'); await sleep(500);
  nav.frame('22'); await sleep(500);
  nav.frame('44'); await sleep(500);
  nav.frame('88');                                        // 팬 연타 흉내: 4프레임 연속
  await sleep(6500);
  const navTotal = nav.writes.length;
  ok('patched SDK: 4 rapid frames → ≤ frames+1 refresh round (was frames×4 before)',
    navTotal <= 52, `총 ${navTotal}줄 (원본이라면 ~160줄)`);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
