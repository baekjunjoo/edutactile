/* dotpad.js — DotPad BLE 드라이버 (dotpad-dev 계약 준수 · Super Dot 실기기 검증 패턴)
 * 계약:
 *  - setCallBack은 connectBleDevice 전에 (콜백 선등록)
 *  - onMessage 'Connected' 수신 후에만 전송 시작 (게이트)
 *  - 행단위 displayLineData(row+1, 0, rowHex, GraphicMode, dev)만 사용 — 전체 전송 금지
 *  - 기기별 lastSent 행 차분 fan-out, 전송 간격 = MIN_INTERVAL(200ms) × 기기수
 *  - 역압: 기기 Complete 통지(패치된 SDK가 전달)로 inflight를 세어, 소화 전에는 다음 프레임 보류
 *  - keep-alive 없음: SDK가 동일 데이터를 걸러 전파를 안 타고, restart만 유발 (끊김 공범이었음)
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
    MIN_INTERVAL: 200,
    classroom: false, userClosed: false,
    onStatus: null, onKeyNav: null,            // 앱이 주입

    status: function (s) { if (BLE.onStatus) try { BLE.onStatus(s); } catch (e) {} },
    readyCount: function () { var n = 0; BLE.devs.forEach(function (e) { if (e.ready) n++; }); return n; },
    findDev: function (dev) {
      for (var i = 0; i < BLE.devs.length; i++) if (BLE.devs[i].dev === dev) return BLE.devs[i];
      return null;
    },

    /* ── SDK 로드 시 패치 (연결 끊김의 근본 원인 — 3.0.0에서 실측 확인) ──
     * ① refreshItem에 "함수"가 담기는데 clearTimeout(함수)는 조용한 no-op —
     *    LIVE 리프레시 타이머를 취소할 방법이 없다. 연속 조작 중에는 매 변경이
     *    refreshCount를 0으로 되돌려 refreshLine(최대 11줄)이 비워지지 않고,
     *    취소 불가 타이머가 1.5초마다 그 전체를 재전송한다 → 기기 명령 버퍼 누적
     *    → 누적 수십 프레임 뒤 펌웨어가 BLE를 끊는다. 타이머 id를 refreshTimer에
     *    담아 취소가 실제로 되게 하고, 리프레시는 3회 → 1회(정지 후 보강 1회)로.
     * ② ResponseDisplayLineComplete를 SDK가 내부에서만 소비하고 앱에 안 준다 —
     *    앱이 기기 처리 속도를 알 길이 없어 눈감고 밀어넣게 된다. 앱 콜백으로도
     *    전달하게 해 진짜 역압(backpressure)을 건다.
     * 패치는 소스 문자열 치환 — 대상 패턴이 없으면(다른 SDK 판) 그대로 두고 개수만 기록. */
    sdkPatches: 0,
    patchSdkSrc: function (src) {
      var n = 0;
      [
        // ①-a 타이머 취소가 실제로 되게: setTimeout 반환값을 refreshTimer에 보관
        ['setTimeout(this.refreshItem,', 'this.refreshTimer=setTimeout(this.refreshItem,', true],
        // ①-b clearTimeout은 함수가 아니라 타이머 id에
        ['clearTimeout(this.refreshItem)', 'clearTimeout(this.refreshTimer)', true],
        // ①-c LIVE 리프레시 3회 → 1회 (정지 후 화면 보강은 1회면 충분)
        ['liveRefresh(){this.refreshCount<3?', 'liveRefresh(){this.refreshCount<1?', false],
        // ② Complete를 앱 콜백에도 전달 (역압용)
        ['case DataCodes.ResponseDisplayLineComplete:this.#k.setDotCommandSendReady(!0);break;',
         'case DataCodes.ResponseDisplayLineComplete:this.#k.setDotCommandSendReady(!0),this.#s(this,e,t);break;', false]
      ].forEach(function (p) {
        var from = p[0], to = p[1], all = p[2];
        if (src.indexOf(from) < 0) return;
        src = all ? src.split(from).join(to) : src.replace(from, to);
        n++;
      });
      BLE.sdkPatches = n;
      return src;
    },

    /* SDK 로딩 (3단 폴백):
       1) 전역에 이미 로드됨 (<script>로 직접 포함 — 패치 불가, 구형 경로)
       2) 같은 폴더에서 fetch → 패치 → Blob import (http(s) 서빙일 때)
       3) 파일 선택 창 → 패치 → Blob URL import (file://) → UMD 폴백
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
    importSrc: function (src) {     // 소스 문자열 → 패치 → Blob URL → ESM import
      var url = URL.createObjectURL(new Blob([BLE.patchSdkSrc(String(src))], { type: 'text/javascript' }));
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
        return BLE.importSrc(new TextDecoder().decode(bytes)).catch(function () { return BLE.pickSdkFile(); });
      }
      // 같은 폴더 SDK: fetch로 소스를 얻어 패치 후 import (직접 import하면 패치 불가)
      var paths = ['./DotPadSDK-3.0.0.js', './DotPadSDK-3_0_0.js', './dotpadsdk.js'];
      var p = Promise.reject(new Error('no sdk'));
      paths.forEach(function (path) {
        p = p.catch(function () {
          return fetch(path).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.text();
          }).then(BLE.importSrc);
        });
      });
      return p.catch(function () {    // fetch가 막힌 환경(file://) → 직접 import (무패치 폴백)
        var q = Promise.reject(new Error('no sdk'));
        paths.forEach(function (path) { q = q.catch(function () { return import(path); }); });
        return q.then(function (m) { return BLE.adoptModule(m); });
      }).catch(function () { return BLE.pickSdkFile(); });
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
                (new Function(BLE.patchSdkSrc(src))).call(window);
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
      // 기기 완료 통지(패치된 SDK가 전달) = 역압 신호: 밀린 줄 수를 줄이고 다음 프레임을 연다
      if (code === 'ResponseDisplayLineComplete' || code === 'ResponseDisplayLineAck' ||
          code === 'ResponseDisplayLineNonAck') {
        BLE.stats.ack++;
        if (e && e.inflight > 0) e.inflight--;
        if (BLE.pendingRows != null || BLE.pendingText != null) BLE.flushFrame();
        return;
      }
      if (code === 'CommandError') { BLE.errCount++; BLE.stats.err++; return; }
      // 보드 정보 수신 = 디스플레이 준비 완료. 그 전에 보낸 줄은 기기가 버렸을 수 있어 다시 그린다.
      if (code === 'BoardInfo') {
        if (e) { e.boardInfo = true; e.lastSent = []; e.lastText = null; e.inflight = 0; }
        BLE.status({ connected: BLE.readyCount(), repaint: true });
        return;
      }
      if (code === 'Connected') {
        if (e) e.ready = true;
        else if (BLE.devs.length && !BLE.devs[BLE.devs.length - 1].ready) BLE.devs[BLE.devs.length - 1].ready = true;
        BLE.connected = true;
        BLE.retries = 0;
        BLE.status({ connected: BLE.readyCount() });
        BLE.flushFrame();
      } else if (code === 'Disconnected' || code === 'ConnectedFail') {
        if (e) BLE.devs.splice(BLE.devs.indexOf(e), 1);
        BLE.connected = BLE.readyCount() > 0;
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

    /* ── 전송 (역압 기반 — 기기 완료 통지에 맞춰 보낸다) ──
     * SDK의 sendCommand는 내부 상태머신이 라인 큐·ACK 대기·재시도를 처리하므로
     * "바뀐 행을 연달아 호출하고 SDK에 맡기는" 사용법은 유지한다. 달라진 것은 프레임
     * 사이의 간격: 시간이 아니라 기기가 실제로 소화했는지(inflight==0)로 연다.
     *   - 보낸 줄마다 inflight++ · Complete 통지마다 inflight-- (패치된 SDK가 전달)
     *   - inflight가 남아 있으면 다음 프레임을 보류 — 기기 명령 버퍼에 밀어넣지 않는다
     *   - Complete가 안 오는 환경(무패치 폴백) 대비 STALL_MS 지나면 강제로 연다
     * keep-alive는 제거: SDK가 같은 데이터를 걸러내서 전파를 타지도 않으면서(무의미),
     * 매 초 sendCommand(true)를 흔들어 전송 중 restart만 유발하던 것이 끊김의 공범이었다.
     * BLE 링크 유지는 링크 계층이 하는 일이라 앱 트래픽이 필요 없다. */
    errCount: 0, pendingRows: null, pendingText: null, _frameT: null,
    lastFrame: null,                       // 현재 화면 (재연결 후 다시 그리기의 진실 원본)
    STALL_MS: 1500,
    stats: { sent: 0, ka: 0, ack: 0, err: 0, lost: 0, reconn: 0 },
    inflightTotal: function () {
      var n = 0; BLE.devs.forEach(function (e) { n += e.inflight || 0; }); return n;
    },

    /* 완성 프레임 push (호출측이 마이크로배치로 감싼다). 최신 프레임만 유지. */
    push: function (rows, textHex) {
      if (rows) BLE.pendingRows = rows;
      if (textHex != null) BLE.pendingText = textHex;
      BLE.flushFrame();
    },

    flushFrame: function () {
      if (!BLE.connected || !BLE.sdkMod) return;
      if (BLE.pendingRows == null && BLE.pendingText == null) return;
      var now = Date.now();
      var wait = BLE.MIN_INTERVAL * Math.max(1, BLE.devs.length) - (now - BLE.last);
      // 역압: 기기가 직전 프레임을 아직 소화 중이면 보류 (Complete 통지가 flushFrame을 다시 부른다)
      if (wait <= 0 && BLE.inflightTotal() > 0 && now - BLE.last < BLE.STALL_MS) wait = 120;
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
        e.inflight = e.inflight || 0;
        if (rows) rows.forEach(function (hex, r) {
          if (e.lastSent[r] === hex) return;                       // 행 차분: 바뀐 행만
          e.lastSent[r] = hex;
          BLE.stats.sent++; e.inflight++;
          try { BLE.sdk.displayLineData(r + 1, 0, hex, DM.GraphicMode, e.dev); }
          catch (err) { BLE.errCount++; BLE.stats.err++; e.lastSent[r] = null; e.inflight--; }
        });
        if (text != null && e.lastText !== text) {
          e.lastText = text;
          BLE.stats.sent++; e.inflight++;
          try { BLE.sdk.displayLineData(0, 0, text, DM.TextMode, e.dev); }
          catch (err) { BLE.errCount++; BLE.stats.err++; e.lastText = null; e.inflight--; }
        }
      });
      if (rows) BLE.lastFrame = rows;
    },

    disconnectAll: function () {
      BLE.userClosed = true;
      var list = BLE.devs.slice();
      BLE.devs = []; BLE.connected = false;
      list.forEach(function (e) { try { BLE.sdk.disconnect(e.dev); } catch (x) {} });
      BLE.status({ connected: 0 });
    }
  };

  return { BLE: BLE, encodeRows: encodeRows, textLineHex: textLineHex };
});
