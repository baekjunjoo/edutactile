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
    pendingRows: null, pendingText: null,
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
      if (code === 'Connected') {
        if (e) e.ready = true;
        else if (BLE.devs.length && !BLE.devs[BLE.devs.length - 1].ready) BLE.devs[BLE.devs.length - 1].ready = true;
        BLE.connected = true;
        BLE.startKeepAlive();
        BLE.status({ connected: BLE.readyCount() });
        BLE.pump();
      } else if (code === 'Disconnected' || code === 'ConnectedFail') {
        if (e) BLE.devs.splice(BLE.devs.indexOf(e), 1);
        BLE.connected = BLE.readyCount() > 0;
        if (!BLE.connected) BLE.stopKeepAlive();
        BLE.status({ connected: BLE.readyCount(), lost: code === 'Disconnected' && !BLE.userClosed });
      }
    },

    onKey: function (dev, key) {
      if (BLE.classroom && BLE.devs.length && dev !== BLE.devs[0].dev) return;  // 교실 모드: 교사 기기만
      if (BLE.onKeyNav) try { BLE.onKeyNav(key); } catch (e) {}
    },

    /* 완성 프레임 push (호출측이 setTimeout(0) 마이크로배치로 감싼다) */
    push: function (rows, textHex) {
      BLE.pendingRows = rows;
      BLE.pendingText = textHex == null ? BLE.pendingText : textHex;
      BLE.pump();
    },

    pump: function () {
      if (BLE.busy || !BLE.connected || !BLE.pendingRows) return;
      var gap = BLE.MIN_INTERVAL * Math.max(1, BLE.devs.length);   // 대역폭 보호
      var now = Date.now();
      if (now - BLE.last < gap) {
        setTimeout(function () { BLE.pump(); }, gap - (now - BLE.last) + 5);
        return;
      }
      var rows = BLE.pendingRows, text = BLE.pendingText;
      BLE.pendingRows = null; BLE.pendingText = null;
      BLE.busy = true; BLE.last = now;
      var DM = BLE.sdkMod.DisplayMode;
      var chain = Promise.resolve();
      BLE.devs.forEach(function (e) {
        if (!e.ready) return;
        rows.forEach(function (hex, r) {
          if (e.lastSent[r] === hex) return;                       // ★ 행 차분
          chain = chain.then(function () {
            return BLE.sdk.displayLineData(r + 1, 0, hex, DM.GraphicMode, e.dev);
          }).then(function () { e.lastSent[r] = hex; });
        });
        if (text != null && e.lastText !== text) {
          chain = chain.then(function () {
            return BLE.sdk.displayLineData(0, 0, text, DM.TextMode, e.dev);
          }).then(function () { e.lastText = text; });
        }
      });
      chain.catch(function () {}).then(function () {
        BLE.busy = false;
        if (BLE.pendingRows) BLE.pump();
      });
    },

    /* keep-alive: 1초마다 1행 재전송 (연결 유지) */
    startKeepAlive: function () {
      if (BLE._ka) return;
      BLE._ka = setInterval(function () {
        if (!BLE.connected || BLE.busy || !BLE.sdkMod) return;
        var DM = BLE.sdkMod.DisplayMode, r = BLE._kaRow % 10;
        BLE.devs.forEach(function (e) {
          if (!e.ready) return;
          var hex = e.lastSent[r] != null ? e.lastSent[r] : new Array(61).join('0');
          try { BLE.sdk.displayLineData(r + 1, 0, hex, DM.GraphicMode, e.dev); } catch (x) {}
        });
        BLE._kaRow++;
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
