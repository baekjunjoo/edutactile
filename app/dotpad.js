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
        // ①-c LIVE 리프레시 완전 차단 (0회) — 정지 후 전체 줄을 다시 구동하는 보강 라운드가
        //      연속 핀 구동 부하를 배로 만든다 (실기기: 이전 프레임+보강+새 프레임 연속 구동 중 침묵)
        ['liveRefresh(){this.refreshCount<3?', 'liveRefresh(){this.refreshCount<0?', false],
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
          // dev = SDK의 DotDevice (display 호출용) · d = 브라우저 BluetoothDevice (재연결용) — 둘 다 보관
          BLE.devs.push({ dev: dev || d, bt: d, name: (d && d.name) || 'DotPad', ready: false, lastSent: [], lastText: null, queue: [], awaiting: null, tmoRun: 0 });
          // 전송은 onMessage 'Connected' 후에만 시작 (게이트) — 여기서 push하지 않는다
          return true;
        });
      }).catch(function (e) {
        BLE.status({ error: (e && e.message === 'no sdk') ? 'no-sdk' : 'connect', detail: e && e.message });
        return false;
      });
    },

    /* 블랙박스: 마지막 200개 이벤트 기록. 실기기 끊김을 추측이 아니라 데이터로 좁힌다.
     * 끊긴 뒤 콘솔에서 DOTPAD.BLE.dumpTrace() — 마지막 순간에 무엇이 오갔는지 그대로 나온다. */
    trace: [], TRACE_MAX: 200,
    log: function (ev, d) {
      BLE.trace.push({ t: Date.now(), ev: ev, d: d });
      if (BLE.trace.length > BLE.TRACE_MAX) BLE.trace.shift();
    },
    dumpTrace: function () {
      var t0 = BLE.trace.length ? BLE.trace[0].t : 0;
      return BLE.trace.map(function (x) {
        return ((x.t - t0) / 1000).toFixed(2) + 's ' + x.ev + (x.d != null ? ' ' + x.d : '');
      }).join('\n');
    },

    onMessage: function (dev, code) {
      var e = BLE.findDev(dev);
      // 기기 완료 통지(패치된 SDK가 전달): 이 줄을 기기가 다 처리했다 → 다음 줄을 보낸다
      if (code === 'ResponseDisplayLineComplete' || code === 'ResponseDisplayLineAck' ||
          code === 'ResponseDisplayLineNonAck') {
        BLE.stats.ack++;
        BLE.log('done');
        if (e) { e.gotComplete = true; e.awaiting = null; e.tmoRun = 0; e.lastDone = Date.now(); BLE.drain(e); }
        return;
      }
      if (code === 'CommandError') { BLE.errCount++; BLE.stats.err++; BLE.log('cmd-error'); return; }
      if (code === 'DeviceFWVersion' || code === 'DeviceHWVersion' || code === 'DeviceName' ||
          code === 'BleMacAddress') { BLE.log('pong', code); return; }   // 유휴 핑 응답 = 링크 생존
      // 보드 정보 수신 = 디스플레이 준비 완료. 그 전에 보낸 줄은 기기가 버렸을 수 있어 다시 그린다.
      if (code === 'BoardInfo') {
        BLE.log('board-info');
        if (e) { e.boardInfo = true; e.lastSent = []; e.lastText = null; e.queue = []; e.awaiting = null; }
        BLE.status({ connected: BLE.readyCount(), repaint: true });
        return;
      }
      if (code === 'Connected') {
        BLE.log('connected');
        if (e) e.ready = true;
        else if (BLE.devs.length && !BLE.devs[BLE.devs.length - 1].ready) BLE.devs[BLE.devs.length - 1].ready = true;
        BLE.connected = true;
        BLE.retries = 0;
        BLE.startWatchdog();
        BLE.status({ connected: BLE.readyCount() });
        BLE.flushFrame();
      } else if (code === 'Disconnected' || code === 'ConnectedFail') {
        BLE.log(code === 'Disconnected' ? 'DISCONNECTED' : 'connect-fail');
        if (e) BLE.devs.splice(BLE.devs.indexOf(e), 1);
        BLE.connected = BLE.readyCount() > 0;
        if (!BLE.connected) BLE.stopWatchdog();
        var lost = code === 'Disconnected' && !BLE.userClosed;
        if (lost) {
          BLE.stats.lost++;
          if (typeof console !== 'undefined') console.warn('[DotPad] 링크 끊김 — 직전 이벤트:\n' + BLE.dumpTrace().split('\n').slice(-25).join('\n'));
        }
        BLE.status({ connected: BLE.readyCount(), lost: lost });
        if (lost && e && BLE.retries < BLE.MAX_RETRY) BLE.reconnect(e);   // 의도치 않은 끊김 → 자동 재연결
      }
    },

    /* 자동 재연결: 반드시 "브라우저 BluetoothDevice"로 재시도 (스캔 창 없이).
     * SDK의 connectBleDevice는 dev.gatt.connect()를 부르므로 DotDevice를 넘기면
     * "reading 'connect'" 예외로 즉사한다 — 실기기 로그로 확인된 버그.
     * 기기 펌웨어가 재광고를 시작할 시간이 필요해 1·2·3·4초 백오프로 4회 시도. */
    retries: 0, MAX_RETRY: 4,
    reconnect: function (entry) {
      BLE.retries++; BLE.stats.reconn++;
      BLE.log('reconnect', '#' + BLE.retries);
      BLE.status({ reconnecting: BLE.retries });
      setTimeout(function () {
        if (BLE.userClosed) return;
        var bt = entry.bt || (entry.dev && entry.dev.connectDevice) || entry.dev;
        try {
          BLE.sdk.connectBleDevice(bt).then(function (dev) {
            if (!dev) throw new Error('busy');
            BLE.devs.push({ dev: dev, bt: bt, name: entry.name, ready: false, lastSent: [], lastText: null, queue: [], awaiting: null, tmoRun: 0 });
          }).catch(function () {
            BLE.log('reconnect-fail', '#' + BLE.retries);
            if (BLE.retries < BLE.MAX_RETRY) BLE.reconnect(entry);
            else BLE.status({ error: 'reconnect' });
          });
        } catch (err) {
          BLE.log('reconnect-fail', err && err.message);
          if (BLE.retries < BLE.MAX_RETRY) BLE.reconnect(entry);
          else BLE.status({ error: 'reconnect' });
        }
      }, 1000 * BLE.retries);
    },

    onKey: function (dev, key) {
      if (BLE.classroom && BLE.devs.length && dev !== BLE.devs[0].dev) return;  // 교실 모드: 교사 기기만
      if (BLE.onKeyNav) try { BLE.onKeyNav(key); } catch (e) {}
    },

    /* ── 전송 (한 줄씩, 기기 완료 통지에 맞춰 — 기기 속도가 곧 페이스) ──
     * 이전 방식(바뀐 행 버스트)의 문제: displayLineData를 연달아 부르면 SDK의 restart
     * 우회 때문에 기기 명령 큐에 최대 11줄이 쌓인다. 기기 완료(Complete)가 44인데
     * 처리 대기 2가 남은 채 죽은 실측 — 기기가 핀을 올리는 도중 명령이 계속 밀려들면
     * 펌웨어가 링크를 놓는다. 이제 Complete를 앱이 받으므로(SDK 패치 ②) 진짜 흐름제어가
     * 가능하다:
     *   - 프레임 diff를 기기별 queue에 담고, 한 줄 보내면 Complete(또는 타임아웃)까지 대기
     *   - 기기 명령 큐 깊이가 항상 ≤1 — 밀어넣기가 원천적으로 불가능
     *   - 새 프레임이 오면 남은 queue를 새 diff로 교체 (최신 화면만)
     *   - 줄 무응답 LINE_TIMEOUT: 건너뛰고 진행, 연속 TMO_LIMIT회면 링크 사망으로 판정하고
     *     30초 좀비(SDK 내부 재연결) 대신 즉시 강제 재연결
     * keep-alive는 없다(무의미 + restart 유발). 대신 유휴 15초마다 펌웨어 버전을 묻는
     * 저비용 핑으로 링크 생존만 확인한다 — 핀을 건드리지 않고, 전송 중에는 절대 안 보낸다. */
    errCount: 0, pendingRows: null, pendingText: null, _frameT: null,
    lastFrame: null,                       // 현재 화면 (재연결 후 다시 그리기의 진실 원본)
    LINE_TIMEOUT: 1200, TMO_LIMIT: 3, PING_IDLE: 15000, SELF_CLOCK: 160,
    LINE_GAP: 120, GAP_ROWS: 6,   // 전 행 교체급 프레임은 줄 사이 쉼표 — 연속 핀 구동으로 기기가 침묵하는 것 방지
    stats: { sent: 0, ka: 0, ack: 0, err: 0, lost: 0, reconn: 0 },
    inflightTotal: function () {
      var n = 0;
      BLE.devs.forEach(function (e) { n += (e.queue ? e.queue.length : 0) + (e.awaiting ? 1 : 0); });
      return n;
    },

    /* 완성 프레임 push (호출측이 마이크로배치로 감싼다). 최신 프레임만 유지. */
    push: function (rows, textHex) {
      if (rows) BLE.pendingRows = rows;
      if (textHex != null) BLE.pendingText = textHex;
      BLE.flushFrame();
    },

    /* 프레임 → 기기별 diff 계산 → queue 교체. 실제 전송은 drain이 한 줄씩. */
    flushFrame: function () {
      if (!BLE.connected || !BLE.sdkMod) return;
      if (BLE.pendingRows == null && BLE.pendingText == null) return;
      var now = Date.now();
      var wait = BLE.MIN_INTERVAL - (now - BLE.last);          // 프레임 계산 최소 간격 (연타 병합)
      if (wait > 0) {
        if (BLE._frameT == null) BLE._frameT = setTimeout(function () { BLE._frameT = null; BLE.flushFrame(); }, wait + 5);
        return;                                                // 그 사이 새 프레임이 오면 pending을 덮어쓴다
      }
      var rows = BLE.pendingRows, text = BLE.pendingText;
      BLE.pendingRows = null; BLE.pendingText = null;
      BLE.last = now;
      BLE.devs.forEach(function (e) {
        if (!e.ready) return;
        var q = [];
        if (rows) rows.forEach(function (hex, r) {
          if (e.lastSent[r] !== hex) q.push({ line: r + 1, hex: hex, text: false });
        });
        if (text != null && e.lastText !== text) q.push({ line: 0, hex: text, text: true });
        if (q.length) {
          e.queue = q;                                         // 남은 옛 diff는 버린다 — 최신 화면만
          e.gap = q.length >= BLE.GAP_ROWS ? BLE.LINE_GAP : 0; // 무거운 프레임만 줄 사이 쉼표
          BLE.log('frame', q.length + '줄' + (e.gap ? ' (쉼표 ' + e.gap + 'ms)' : ''));
          BLE.drain(e);
        }
      });
      if (rows) BLE.lastFrame = rows;
    },

    /* 한 줄 전송 → Complete 대기. 기기 명령 큐 깊이 ≤1 보장.
     * 무거운 프레임은 완료 후 LINE_GAP만큼 쉬었다 다음 줄 — 핀 구동에 숨 쉴 틈을 준다. */
    drain: function (e) {
      if (!e || !e.ready || e.awaiting || !e.queue || !e.queue.length) return;
      if (e.gap) {
        var now = Date.now(), since = now - (e.lastDone || 0);
        if (since < e.gap) {
          if (!e._gapT) e._gapT = setTimeout(function () { e._gapT = null; BLE.drain(e); }, e.gap - since + 5);
          return;
        }
      }
      var it = e.queue.shift();
      var DM = BLE.sdkMod.DisplayMode;
      e.awaiting = { t: Date.now(), it: it };
      BLE.stats.sent++;
      BLE.log('send', (it.text ? 'text' : 'L' + it.line));
      try {
        BLE.sdk.displayLineData(it.line, 0, it.hex, it.text ? DM.TextMode : DM.GraphicMode, e.dev);
        if (it.text) e.lastText = it.hex; else e.lastSent[it.line - 1] = it.hex;
      } catch (err) {
        BLE.errCount++; BLE.stats.err++; e.awaiting = null;
        BLE.log('send-error', err && err.message);
        return;
      }
      // Complete를 한 번도 안 주는 SDK(무패치 폴백)면 자체 시계로 진행 — 타임아웃 누명을 씌우지 않는다
      if (!e.gotComplete) {
        var mine = e.awaiting;
        setTimeout(function () {
          if (e.awaiting === mine && !e.gotComplete) { e.awaiting = null; BLE.drain(e); }
        }, BLE.SELF_CLOCK);
      }
    },

    /* 감시: 줄 무응답이면 건너뛰고 진행, 연속 3회면 좀비 링크로 판정 → 즉시 강제 복구.
     * 유휴가 길면 핀을 건드리지 않는 펌웨어 버전 핑으로 링크 생존을 확인한다. */
    _wd: null, _lastPing: 0,
    startWatchdog: function () {
      if (BLE._wd) return;
      BLE._wd = setInterval(function () {
        if (!BLE.connected) return;
        var now = Date.now();
        BLE.devs.slice().forEach(function (e) {
          if (!e.ready) return;
          if (e.awaiting && now - e.awaiting.t > BLE.LINE_TIMEOUT) {
            e.tmoRun = (e.tmoRun || 0) + 1;
            BLE.stats.err++;
            BLE.log('line-timeout', (e.awaiting.it.text ? 'text' : 'L' + e.awaiting.it.line) + ' #' + e.tmoRun);
            e.awaiting = null;
            if (e.tmoRun >= BLE.TMO_LIMIT) {                   // 좀비 링크 — SDK 내부 재연결(30초+)을 기다리지 않는다
              BLE.log('force-recover');
              e.tmoRun = 0; e.queue = [];
              try { BLE.sdk.disconnect(e.dev); } catch (x) {}  // Disconnected 경로 → 자동 재연결
            } else BLE.drain(e);
          }
          // 유휴 핑: 전송이 완전히 쉬고 있을 때만 (충돌 방지), 15초마다
          if (!e.awaiting && (!e.queue || !e.queue.length) &&
              now - BLE.last > BLE.PING_IDLE && now - BLE._lastPing > BLE.PING_IDLE) {
            BLE._lastPing = now;
            BLE.log('ping');
            try { BLE.sdk.requestDeviceInfo(e.dev, 'FirmwareVersion'); } catch (x) {}
          }
        });
      }, 400);
    },
    stopWatchdog: function () { if (BLE._wd) { clearInterval(BLE._wd); BLE._wd = null; } },

    disconnectAll: function () {
      BLE.userClosed = true;
      BLE.stopWatchdog();
      var list = BLE.devs.slice();
      BLE.devs = []; BLE.connected = false;
      list.forEach(function (e) { try { BLE.sdk.disconnect(e.dev); } catch (x) {} });
      BLE.status({ connected: 0 });
    }
  };

  return { BLE: BLE, encodeRows: encodeRows, textLineHex: textLineHex };
});
