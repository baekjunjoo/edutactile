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
      // 줄 전송 완료 신호 → 다음 줄 (기기 속도에 맞춘 흐름 제어)
      if (code === 'ResponseDisplayLineComplete' || code === 'ResponseDisplayLineAck' ||
          code === 'ResponseDisplayLineNonAck') { BLE.onAck(); return; }
      if (code === 'CommandError') { BLE.errCount++; BLE.stats.err++; BLE.onAck(); return; }
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
        BLE.drain();
      } else if (code === 'Disconnected' || code === 'ConnectedFail') {
        if (e) BLE.devs.splice(BLE.devs.indexOf(e), 1);
        BLE.connected = BLE.readyCount() > 0;
        if (BLE.inflight) { BLE.inflight = null; BLE.busy = false; }
        BLE.q = BLE.q.filter(function (it) { return it.dev !== dev; });   // 끊긴 기기 대기분 폐기
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

    /* ── 전송: 한 번에 한 줄, 간격을 두고, 최신 프레임으로 덮어쓰며 ──
     * SDK의 sendCommand는 내부 상태머신이라 전송 중에 또 부르면 큐잉이 아니라 restart가 걸린다
     * (currentIndex 초기화 + 라인 상태 리셋). 한 프레임의 여러 줄을 연달아 쏘면 restart가 반복돼
     * 전송이 끝나지 않고 링크가 죽는다 → 실기기 연결 끊김의 원인.
     * 그래서 (1) 한 줄씩만 in-flight, (2) ACK/Complete 또는 간격 경과 후 다음 줄,
     *        (3) 대기 중 같은 줄은 최신 내용으로 교체(=오래된 프레임 자동 폐기). */
    q: [], inflight: null, _doneT: null, errCount: 0,
    /* 기기가 완료를 알려주면(ACK/Complete) 그때까지 기다린다 — 실기기 핀은 200ms보다 훨씬 느려서
     * 간격만 믿고 다음 줄을 보내면 전송 중 재호출 → restart 폭주 → 링크 사망.
     * ACK를 한 번도 못 본 기기(구형 펌웨어·시뮬레이터)에서는 간격 기반으로 자동 폴백. */
    ACK_TIMEOUT: 5000, PROBE_TIMEOUT: 1500, ackSeen: false, timedMode: false, unacked: 0,
    stats: { sent: 0, ack: 0, timeout: 0, err: 0, lost: 0, reconn: 0 },

    enqueue: function (dev, lineId, hex, mode) {
      for (var i = 0; i < BLE.q.length; i++) {
        var it = BLE.q[i];
        if (it.dev === dev && it.lineId === lineId && it.mode === mode) { it.hex = hex; return; }  // 최신으로 교체
      }
      BLE.q.push({ dev: dev, lineId: lineId, hex: hex, mode: mode });
    },

    /* 완성 프레임 push (호출측이 setTimeout(0) 마이크로배치로 감싼다) */
    push: function (rows, textHex) {
      if (!BLE.connected || !BLE.sdkMod) return;
      var DM = BLE.sdkMod.DisplayMode;
      BLE.devs.forEach(function (e) {
        if (!e.ready) return;
        if (rows) rows.forEach(function (hex, r) {
          if (e.lastSent[r] === hex) return;                       // 행 차분
          BLE.enqueue(e.dev, r + 1, hex, DM.GraphicMode);
        });
        if (textHex != null && e.lastText !== textHex) BLE.enqueue(e.dev, 0, textHex, DM.TextMode);
      });
      BLE.drain();
    },

    drain: function () {
      if (BLE.inflight || !BLE.connected || !BLE.q.length) return;
      var gap = BLE.MIN_INTERVAL * Math.max(1, BLE.devs.length);   // 대역폭 보호
      var wait = gap - (Date.now() - BLE.last);
      if (wait > 0) { setTimeout(function () { BLE.drain(); }, wait); return; }
      var it = BLE.q.shift();
      BLE.inflight = it; BLE.last = Date.now(); BLE.busy = true;
      BLE.stats.sent++;
      try {
        BLE.sdk.displayLineData(it.lineId, 0, it.hex, it.mode, it.dev);
      } catch (err) {
        BLE.errCount++; BLE.stats.err++; BLE.inflight = null; BLE.busy = false;
        setTimeout(function () { BLE.drain(); }, gap);
        return;
      }
      /* 첫 줄은 "이 기기가 완료를 알려주는가"를 확인하는 탐침이다.
       * 처음부터 간격(200ms)으로 끝내버리면, 실기기는 아직 핀을 움직이는 중인데 다음 줄이 나가고
       * 뒤늦게 도착한 ACK가 그 줄을 또 앞당겨 끝내며 겹침이 연쇄된다 → 링크 사망. */
      var wait = BLE.ackSeen ? BLE.ACK_TIMEOUT : (BLE.timedMode ? gap : BLE.PROBE_TIMEOUT);
      BLE._doneT = setTimeout(function () {
        if (BLE.ackSeen) BLE.stats.timeout++;
        else BLE.timedMode = true;            // 완료를 안 알려주는 기기로 확정 → 간격 기반
        BLE.unacked++;                        // 응답 없이 끝냈다 → 이 줄의 늦은 ACK가 나중에 올 수 있다
        BLE.sendDone();
      }, wait);
    },

    /* 기기 완료 신호. ACK에는 줄 번호가 없으므로, 앞서 응답 없이 끝낸 줄이 있으면
     * 그 줄의 지각 응답으로 보고 소비한다 — 아니면 지금 보내는 줄을 엉뚱하게 앞당겨 끝내
     * 겹침이 연쇄된다(연결 끊김의 직접 원인). */
    onAck: function () {
      BLE.ackSeen = true; BLE.timedMode = false; BLE.stats.ack++;
      if (BLE.unacked > 0) { BLE.unacked--; return; }
      BLE.sendDone(true);
    },

    sendDone: function (fromAck) {
      var it = BLE.inflight;
      if (!it) return;
      if (BLE._doneT) { clearTimeout(BLE._doneT); BLE._doneT = null; }
      BLE.inflight = null; BLE.busy = false;
      var e = BLE.findDev(it.dev);
      if (e) {                                   // 실제로 보낸 뒤에만 기록 → 유실된 줄은 다음에 다시 간다
        if (it.lineId === 0) e.lastText = it.hex;
        else e.lastSent[it.lineId - 1] = it.hex;
      }
      BLE.drain();
    },

    /* keep-alive: 1초마다 1행 재전송 (연결 유지). 보낼 게 남아 있으면 그쪽이 우선 */
    startKeepAlive: function () {
      if (BLE._ka) return;
      BLE._ka = setInterval(function () {
        if (!BLE.connected || !BLE.sdkMod) return;
        if (BLE.inflight || BLE.q.length) return;               // 이미 트래픽이 있으면 생략
        var DM = BLE.sdkMod.DisplayMode, r = BLE._kaRow % 10;
        BLE.devs.forEach(function (e) {
          if (!e.ready) return;
          var hex = e.lastSent[r] != null ? e.lastSent[r] : new Array(61).join('0');
          BLE.enqueue(e.dev, r + 1, hex, DM.GraphicMode);
        });
        BLE._kaRow++;
        BLE.drain();
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
