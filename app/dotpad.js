/* dotpad.js — DotPad BLE 드라이버 (dotpad-dev 계약 준수 · Super Dot 실기기 검증 패턴)
 * 계약:
 *  - setCallBack은 connectBleDevice 전에 (콜백 선등록)
 *  - onMessage 'Connected' 수신 후에만 전송 시작 (게이트)
 *  - 행단위 displayLineData(row+1, 0, rowHex, GraphicMode, dev)만 사용 — 전체 전송 금지
 *  - 기기별 lastSent 행 차분 fan-out, 전송 간격 = MIN_INTERVAL(200ms) × 기기수
 *  - keep-alive: 1초마다 1행 재전송
 *  - 그래픽 셀 인코딩: bit = y%4 + (x%2)*4, 행우선 10행×30셀 (절대 불변)
 *  - 텍스트 라인: lineId 0, TextMode, dot n = bit n-1
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DOTPAD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 60×40 0/1 그리드 → 10행 hex (행당 30바이트 = 60자). 검증된 인코딩 — 변경 금지 */
  function encodeRows(grid) {
    var rows = [];
    for (var cy = 0; cy < 10; cy++) {
      var hex = '';
      for (var cx = 0; cx < 30; cx++) {
        var b = 0;
        for (var r = 0; r < 4; r++) {
          var y = cy * 4 + r, row = grid[y];
          if (!row) continue;
          if (row[cx * 2]) b |= (1 << r);
          if (row[cx * 2 + 1]) b |= (1 << (r + 4));
        }
        var h = b.toString(16).toUpperCase();
        hex += (h.length < 2 ? '0' : '') + h;
      }
      rows.push(hex);
    }
    return rows;
  }

  /* 셀별 점 배열(1~8) 최대 20셀 → 텍스트 라인 hex (dot n = bit n-1) */
  function textLineHex(cells) {
    var out = '';
    for (var i = 0; i < 20; i++) {
      var b = 0, c = cells && cells[i];
      if (c) for (var k = 0; k < c.length; k++) { var d = c[k]; if (d >= 1 && d <= 8) b |= (1 << (d - 1)); }
      var h = b.toString(16).toUpperCase();
      out += (h.length < 2 ? '0' : '') + h;
    }
    return out;
  }

  var BLE = {
    connected: false,
    sdkMod: null, sdk: null, scanner: null,
    devs: [], MAX: 5,                          // [{dev,name,ready,lastSent[],lastText}]
    busy: false, last: 0,
    MIN_INTERVAL: 200, _ka: null, _kaRow: 0,
    classroom: false, userClosed: false,
    onStatus: null, onKeyNav: null,            // 앱이 주입

    status: function (s) { if (BLE.onStatus) try { BLE.onStatus(s); } catch (e) {} },
    readyCount: function () { var n = 0; BLE.devs.forEach(function (e) { if (e.ready) n++; }); return n; },
    findDev: function (dev) {
      for (var i = 0; i < BLE.devs.length; i++) if (BLE.devs[i].dev === dev) return BLE.devs[i];
      return null;
    },

    /* SDK 로딩 (라이선스상 내장 불가 — 3단 폴백):
       1) 전역에 이미 로드됨 (<script>로 직접 포함)
       2) 같은 폴더 동적 import — http(s) 서빙일 때
       3) 파일 선택 창 → Blob URL import (file://에서는 CORS로 2가 막힌다) → UMD 폴백
       테스트 하네스는 BLE.loadSDK를 오버라이드해 모의 SDK를 주입한다. */
    adoptModule: function (m) {
      var g = (typeof window !== 'undefined') ? window : {};
      var mod = (m && m.DotPadSDK && m.DotPadScanner) ? m
        : ((g.DotPadSDK && g.DotPadScanner) ? { DotPadSDK: g.DotPadSDK, DotPadScanner: g.DotPadScanner, DisplayMode: g.DisplayMode } : null);
      if (!mod) throw new Error('no sdk');
      if (!mod.DisplayMode) mod = { DotPadSDK: mod.DotPadSDK, DotPadScanner: mod.DotPadScanner, DisplayMode: { GraphicMode: 'GraphicMode', TextMode: 'TextMode' } };
      BLE.sdkMod = mod;
      return mod;
    },
    importSrc: function (parts) {   // 소스(문자열/바이트) → Blob URL → ESM import
      var url = URL.createObjectURL(new Blob([parts], { type: 'text/javascript' }));
      return import(url).then(
        function (m) { URL.revokeObjectURL(url); return BLE.adoptModule(m); },
        function (e) { URL.revokeObjectURL(url); throw e; }
      );
    },
    loadSDK: function () {
      if (BLE.sdkMod) return Promise.resolve(BLE.sdkMod);
      try { return Promise.resolve(BLE.adoptModule(null)); } catch (e0) {}
      var g = (typeof window !== 'undefined') ? window : {};
      if (g.DOTPAD_SDK_SRC) {         // 내장 SDK (base64) — file://·https 어디서든 즉시 로드
        var bin = atob(g.DOTPAD_SDK_SRC), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return BLE.importSrc(bytes).catch(function () { return BLE.pickSdkFile(); });
      }
      var paths = ['./DotPadSDK-3.0.0.js', './DotPadSDK-3_0_0.js', './dotpadsdk.js'];
      var p = Promise.reject(new Error('no sdk'));
      paths.forEach(function (path) {
        p = p.catch(function () { return import(path); });
      });
      return p.then(function (m) { return BLE.adoptModule(m); })
        .catch(function () { return BLE.pickSdkFile(); });
    },
    pickSdkFile: function () {
      BLE.status({ askSdk: true });                       // 앱이 인라인 안내 표시
      return new Promise(function (resolve, reject) {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.js,text/javascript';
        inp.onchange = function () {
          var f = inp.files[0];
          if (!f) return reject(new Error('no sdk'));
          var fr = new FileReader();
          fr.onerror = function () { reject(new Error('no sdk')); };
          fr.onload = function () {
            var src = String(fr.result);
            BLE.importSrc(src).then(resolve, function () {  // ESM 실패 → UMD/classic 폴백
              try {
                (new Function(src)).call(window);
                resolve(BLE.adoptModule(null));
              } catch (e) { reject(new Error('no sdk')); }
            });
          };
          fr.readAsText(f);
        };
        inp.click();
      });
    },

    connect: function () { return BLE.addDevice(); },
    addDevice: function () {
      if (typeof navigator === 'undefined' || !navigator.bluetooth) {
        BLE.status({ error: 'no-bluetooth' }); return Promise.resolve(false);
      }
      if (BLE.devs.length >= BLE.MAX) { BLE.status({ error: 'max' }); return Promise.resolve(false); }
      BLE.userClosed = false;
      return BLE.loadSDK().then(function (m) {
        BLE.sdkMod = m;                                    // 주입(loadSDK 오버라이드) 대비
        if (!BLE.sdk) {
          BLE.sdk = new m.DotPadSDK();
          BLE.sdk.setCallBack(BLE.onMessage, BLE.onKey);   // ★ 콜백 선등록 — 연결 전에!
        }
        if (!BLE.scanner) BLE.scanner = new m.DotPadScanner();
        return BLE.scanner.startBleScan();
      }).then(function (d) {
        if (!d) throw new Error('scan cancelled');
        return BLE.sdk.connectBleDevice(d).then(function (dev) {
          BLE.devs.push({ dev: dev || d, name: (d && d.name) || 'DotPad', ready: false, lastSent: [], lastText: null });
          // 전송은 onMessage 'Connected' 후에만 시작 (게이트) — 여기서 push하지 않는다
          return true;
        });
      }).catch(function (e) {
        BLE.status({ error: (e && e.message === 'no sdk') ? 'no-sdk' : 'connect', detail: e && e.message });
        return false;
      });
    },

    onMessage: function (dev, code) {
      var e = BLE.findDev(dev);
      // 기기 응답: 진단 집계만 (전송 흐름은 SDK 내부가 관리 — 실기기 검증 패턴)
      if (code === 'ResponseDisplayLineComplete' || code === 'ResponseDisplayLineAck' ||
          code === 'ResponseDisplayLineNonAck') { BLE.onAck(); return; }
      if (code === 'CommandError') { BLE.errCount++; BLE.stats.err++; return; }
      // 보드 정보 수신 = 디스플레이 준비 완료. 그 전에 보낸 줄은 기기가 버렸을 수 있어 다시 그린다.
      if (code === 'BoardInfo') {
        if (e) { e.boardInfo = true; e.lastSent = []; e.lastText = null; }
        BLE.status({ connected: BLE.readyCount(), repaint: true });
        return;
      }
      if (code === 'Connected') {
        if (e) e.ready = true;
        else if (BLE.devs.length && !BLE.devs[BLE.devs.length - 1].ready) BLE.devs[BLE.devs.length - 1].ready = true;
        BLE.connected = true;
        BLE.startKeepAlive();
        BLE.retries = 0;
        BLE.status({ connected: BLE.readyCount() });
        BLE.flushFrame();
      } else if (code === 'Disconnected' || code === 'ConnectedFail') {
        if (e) BLE.devs.splice(BLE.devs.indexOf(e), 1);
        BLE.connected = BLE.readyCount() > 0;
        if (!BLE.connected) BLE.stopKeepAlive();
        var lost = code === 'Disconnected' && !BLE.userClosed;
        if (lost) BLE.stats.lost++;
        BLE.status({ connected: BLE.readyCount(), lost: lost });
        if (lost && e && BLE.retries < BLE.MAX_RETRY) BLE.reconnect(e);   // 의도치 않은 끊김 → 자동 재연결
      }
    },

    /* 자동 재연결: 저장된 기기 객체로 재시도 (스캔 창 없이). 실패해도 조용히 포기하고 안내만. */
    retries: 0, MAX_RETRY: 2,
    reconnect: function (entry) {
      BLE.retries++; BLE.stats.reconn++;
      BLE.status({ reconnecting: BLE.retries });
      setTimeout(function () {
        if (BLE.userClosed) return;
        try {
          BLE.sdk.connectBleDevice(entry.dev).then(function (dev) {
            BLE.devs.push({ dev: dev || entry.dev, name: entry.name, ready: false, lastSent: [], lastText: null });
          }).catch(function () { BLE.status({ error: 'reconnect' }); });
        } catch (err) { BLE.status({ error: 'reconnect' }); }
      }, 800 * BLE.retries);
    },

    onKey: function (dev, key) {
      if (BLE.classroom && BLE.devs.length && dev !== BLE.devs[0].dev) return;  // 교실 모드: 교사 기기만
      if (BLE.onKeyNav) try { BLE.onKeyNav(key); } catch (e) {}
    },

    /* ── 전송 (실기기 검증 패턴 — Dote/공식 데모와 동일) ──
     * SDK의 sendCommand는 내부 상태머신이 자체적으로 라인 큐·ACK 대기·재시도를 처리한다.
     * 검증된 사용법은 "바뀐 행을 연달아 호출하고 SDK에 맡기는 것" — 밖에서 한 줄씩
     * ACK를 기다리며 보내면 내부 루프와 어긋나 restart·중복 전송만 늘어난다(이전 구현의 실수).
     * 앱이 하는 일은 두 가지뿐: ① 프레임 단위 스로틀(200ms×기기수, 최신 프레임으로 덮어씀)
     *                         ② 행 차분(바뀐 행만). 나머지는 SDK 소관. */
    errCount: 0, pendingRows: null, pendingText: null, _frameT: null,
    lastFrame: null,                       // 현재 화면 (keep-alive의 진실 원본)
    stats: { sent: 0, ack: 0, timeout: 0, err: 0, lost: 0, reconn: 0 },

    /* 완성 프레임 push (호출측이 마이크로배치로 감싼다). 최신 프레임만 유지. */
    push: function (rows, textHex) {
      if (rows) BLE.pendingRows = rows;
      if (textHex != null) BLE.pendingText = textHex;
      BLE.flushFrame();
    },

    flushFrame: function () {
      if (!BLE.connected || !BLE.sdkMod) return;
      if (BLE.pendingRows == null && BLE.pendingText == null) return;
      var gap = BLE.MIN_INTERVAL * Math.max(1, BLE.devs.length);   // 프레임 간 간격 (대역폭 보호)
      var wait = gap - (Date.now() - BLE.last);
      if (wait > 0) {
        if (BLE._frameT == null) BLE._frameT = setTimeout(function () { BLE._frameT = null; BLE.flushFrame(); }, wait + 5);
        return;                                                    // 그 사이 새 프레임이 오면 pending을 덮어쓴다
      }
      var rows = BLE.pendingRows, text = BLE.pendingText;
      BLE.pendingRows = null; BLE.pendingText = null;
      BLE.last = Date.now();
      var DM = BLE.sdkMod.DisplayMode;
      BLE.devs.forEach(function (e) {
        if (!e.ready) return;
        if (rows) rows.forEach(function (hex, r) {
          if (e.lastSent[r] === hex) return;                       // 행 차분: 바뀐 행만
          e.lastSent[r] = hex;
          BLE.stats.sent++;
          try { BLE.sdk.displayLineData(r + 1, 0, hex, DM.GraphicMode, e.dev); }
          catch (err) { BLE.errCount++; BLE.stats.err++; e.lastSent[r] = null; }
        });
        if (text != null && e.lastText !== text) {
          e.lastText = text;
          BLE.stats.sent++;
          try { BLE.sdk.displayLineData(0, 0, text, DM.TextMode, e.dev); }
          catch (err) { BLE.errCount++; BLE.stats.err++; e.lastText = null; }
        }
      });
      if (rows) BLE.lastFrame = rows;
    },

    /* SDK 응답은 흐름제어가 아니라 진단용으로만 집계 (전송 자체는 SDK가 관리) */
    onAck: function () { BLE.stats.ack++; },

    /* keep-alive: 1초마다 1행 재전송 (연결 유지 — Dote 검증 패턴: 현재 화면에서, 차분 무시하고).
     * 부수 효과로 유실·기기 초기화로 어긋난 행이 10초 안에 자가 복구된다. */
    startKeepAlive: function () {
      if (BLE._ka) return;
      BLE._ka = setInterval(function () {
        if (!BLE.connected || !BLE.sdkMod || !BLE.lastFrame) return;
        var DM = BLE.sdkMod.DisplayMode, r = BLE._kaRow % 10;
        BLE._kaRow++;
        var hex = BLE.lastFrame[r];
        if (hex == null) return;
        BLE.devs.forEach(function (e) {
          if (!e.ready) return;
          try { BLE.sdk.displayLineData(r + 1, 0, hex, DM.GraphicMode, e.dev); } catch (x) {}
        });
      }, 1000);
    },
    stopKeepAlive: function () { if (BLE._ka) { clearInterval(BLE._ka); BLE._ka = null; } },

    disconnectAll: function () {
      BLE.userClosed = true;
      BLE.stopKeepAlive();
      var list = BLE.devs.slice();
      BLE.devs = []; BLE.connected = false;
      list.forEach(function (e) { try { BLE.sdk.disconnect(e.dev); } catch (x) {} });
      BLE.status({ connected: 0 });
    }
  };

  return { BLE: BLE, encodeRows: encodeRows, textLineHex: textLineHex };
});
