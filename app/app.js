/* app.js — 촉각 교육자료 제작 도구 UI (템플릿 갤러리 → 폼 → 미리보기 → 내보내기) */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var DEF = (typeof window !== 'undefined' && window.TGIL_DEFAULT_LANG) || 'en';
  var state = {
    tpl: null, spec: null, uiLang: DEF, brailleLang: DEF, svg: '', trace: null,
    extraReport: [], labels: [], labelMode: false, layout: null, pending: null,
    paper: DEF === 'ko' ? 'a4-landscape' : '11.5x11in',  // 국내 스웰페이퍼 = A4
    inkMode: 'screen', dimOverrides: {}, loadedSpec: null,
    userDims: [], dimMode: false, pendingDimPt: null, pendingKind: null,
    dragging: null, didDrag: false, dimHidden: {}, pendingDimEl: null,
    pages: [], editingPage: null,
    titleOverride: null, dimUnit: null, leaderOverrides: {}, pendingLeaderEl: null,
    dpView: { zoom: 1, cx: null, cy: null }   // 1:1 = 점자 도트 1개가 핀 1개 (판독 가능한 유일한 배율)
  };

  /* 점자 규정집 변환기 가상 템플릿 */
  var RULEBOOK_TPL = {
    id: '__rulebook__', category: 'Documents',
    name: { en: 'Braille Document Converter', ko: '점자 문서 변환기' },
    params: [
      { key: 'dtmsMode', label: { en: 'DotPad export mode', ko: 'DotPad 출력 방식' }, type: 'select', options: ['item-screens', 'braille-flow'], default: 'item-screens' },
      { key: 'dtmsRange', label: { en: 'DotPad chapter range', ko: 'DotPad 출력 범위 (장)' }, type: 'select', options: ['1', '2', '3', '4', '5', 'all'], default: '1' },
      { key: 'flowRtl', label: { en: 'Flow cells R→L (doc convention)', ko: '흐름 셀 우→좌 (문서 표기 관례)' }, type: 'bool', default: false }
    ]
  };

  /* 트랙 B: 이미지 트레이싱 가상 템플릿 */
  var TRACE_TPL = {
    id: '__trace__', category: 'Image Trace (Track B)',
    name: { en: 'Image → Tactile Outline', ko: '이미지 → 촉각 윤곽선' },
    params: [
      { key: 'title', label: { en: 'Title', ko: '제목' }, type: 'text', default: 'Traced Graphic' },
      { key: 'simplify', label: { en: 'Simplify (0.2–2%)', ko: '단순화 (0.2–2%)' }, type: 'number', default: 0.6 },
      { key: 'smooth', label: { en: 'Smooth curves', ko: '곡선 스무딩' }, type: 'bool', default: true },
      { key: 'invert', label: { en: 'Invert (light on dark)', ko: '반전 (어두운 배경)' }, type: 'bool', default: false }
    ]
  };

  var STR = {
    en: {
      appName: 'Tactile Learning Material Maker',
      templates: 'Templates', options: 'Options', braille: 'Braille code',
      preview: 'Preview (actual output)', exports: 'Export',
      report: 'What the engine did for you', advanced: 'Advanced: edit spec (JSON)',
      apply: 'Apply JSON', title: 'Title',
      ueb: 'UEB Grade 2 — English / TGIL submission', nemeth: 'Nemeth — US math braille', kor: 'Korean Braille — 국내 수업용',
      upload: 'Upload image', noimg: 'Upload an image to trace.',
      traceHint: 'Simple illustrations & silhouettes convert best — photos will fragment. If the result looks broken, try a cleaner source image.',
      labelMode: 'Add label (click diagram)', labelModeOn: 'Click a spot on the diagram…',
      dimMode: 'Add measurement (click 2 points)', dimModeOn: 'Click point 1 of 2…', dimModeOn2: 'Click point 2 of 2…',
      labels: 'Labels (lead lines)', lempty: 'None yet — use "Add label".',
      editHint: 'Click any text on the diagram — title, dimension, label — to edit it right there · label dot: drag = move, double-click = delete',
      paper: 'Paper size', ink: 'Print text (묵자) alongside braille',
      inkScreen: 'Screen only (for checking)', inkPrint: 'Include in print/export', inkOff: 'Off',
      dims: 'Dimension labels (editable)', dimUnit: 'Unit (applies to all)',
      seqPreview: 'This template builds a {n}-page lesson — showing page 1. Press "Generate sequence" to create all pages.',
      seq: 'Lesson sequence', seqEmpty: 'No pages yet — build a diagram, then "Add as page".',
      addPage: '+ Add as page', savePage: '✓ Save to page', genSeq: 'Generate sequence',
      open: 'Open', dup: 'Copy', descPh: 'Page description (spoken on DotPad)',
      printTip: 'When printing: set scale to "Actual size (100%)" — braille size must not shrink.',
      loaded: 'Loaded spec file — template options are disabled; labels & exports still work.',
      rbUpload: 'Rulebook JSON', rbSample: 'Load built-in sample (Arabic, 709 symbols)',
      rbLoaded: 'Loaded: ', rbHint: 'Drag a table-format rulebook here (PDF, Word, or verified JSON) — or use the file picker on the right. → UEB-style narrative document with selectable braille text (embedded font). For HWP files: open in Hangul → Save As → Word (.docx) first.',
      rbDropType: 'Only .pdf, .docx, or .json files can be converted.',
      docx: 'Word (.docx)',
      ebrl: 'eBraille (.ebrl)',
      dpBtn: 'Connect DotPad', dpConnected: 'DotPad ● {n}',
      dpAddTip: 'Click again to mirror to another DotPad (max 5)',
      dpNoBt: 'Web Bluetooth is not available here. Download this HTML file and open it directly in Chrome or Edge (embedded previews and Safari/Firefox cannot use Bluetooth).',
      dpNoSdk: 'Could not load the DotPad SDK. Have DotPadSDK-3.0.0.js ready (it cannot be embedded for license reasons) and click "Connect DotPad" again — a file picker will ask for it.',
      dpPickSdk: '📂 Select the DotPadSDK-3.0.0.js file in the dialog that just opened. When this file is opened directly from disk, the browser blocks automatic loading, so a one-time manual selection is needed.',
      dpFail: 'DotPad connection failed{e} — check the device is on and in range, then try again.',
      dpKeys: 'DotPad connected — the blue frame is what the device shows (60×40 pins). Starts at 1:1, where one braille dot lands on one pin. Device keys: F1 left · F2 up · F3 down · F4 right · pan◀+F1 zoom out · pan▶+F4 zoom in · pan ◀▶ alone = previous/next page.',
      dpFit: 'full page', dpOneToOne: '1:1 actual size', dpNoBrl: '⚠ braille unreadable',
      dpLost: 'DotPad disconnected.',
      dpDiag: 'link: lines sent {sent} · device done {ack} · in flight {ka} · errors {err} · drops {lost}',
      dpReconn: 'DotPad disconnected — reconnecting… (attempt {n})',
      dpReconnFail: 'Could not reconnect automatically. Turn the device off and on, then press "Connect DotPad" again.',
      dpBrlWarn: '⚠ At this zoom one pin covers {mm}mm, but braille dots are 2.34mm apart — dots merge and the labels cannot be read by touch. Use pan▶+F4 to reach 1:1; the shape is still useful for orientation at this zoom.',
      dpKeysRb: 'DotPad connected — device keys: ◀▶ previous/next item, F1 resend, F2 first item, F3/F4 back/forward 10.',
      dl: { svg: 'SVG (embosser/Monarch)', pdf: 'PDF (print)', dtms: 'DotPad .dtms', brf: 'BRF key page', json: 'Save spec JSON', load: 'Open spec JSON' }
    },
    ko: {
      appName: '촉각 교육자료 제작 도구',
      templates: '템플릿', options: '옵션', braille: '점자 코드',
      preview: '미리보기 (실제 출력)', exports: '내보내기',
      report: '엔진이 자동으로 처리한 것', advanced: '고급: 스펙 직접 편집 (JSON)',
      apply: 'JSON 적용', title: '제목',
      ueb: 'UEB Grade 2 — 영어권·TGIL 제출용', nemeth: 'Nemeth — 미국 수학점자', kor: '한국 점자 — 국내 수업용',
      upload: '이미지 업로드', noimg: '트레이싱할 이미지를 업로드하세요.',
      traceHint: '사진보다 단순한 일러스트·실루엣이 잘 변환됩니다. 결과가 조각나면 더 깔끔한 이미지로 바꿔보세요.',
      labelMode: '레이블 추가 (도면 클릭)', labelModeOn: '도면에서 위치를 클릭하세요…',
      dimMode: '치수 추가 (두 점 클릭)', dimModeOn: '측정 시작점을 클릭하세요 (1/2)…', dimModeOn2: '측정 끝점을 클릭하세요 (2/2)…',
      labels: '레이블 (리드선)', lempty: '아직 없음 — "레이블 추가"를 누르세요.',
      editHint: '도면의 글자(제목·치수·레이블)를 클릭하면 그 자리에서 바로 수정 · 레이블 도트: 드래그 = 이동, 더블클릭 = 삭제',
      paper: '용지 크기', ink: '묵자 병기 (점자 옆 일반 글자)',
      inkScreen: '화면에만 (검증용)', inkPrint: '인쇄물에도 포함', inkOff: '끄기',
      dims: '치수 레이블 (수정 가능)', dimUnit: '단위 (전체 일괄 적용)',
      seqPreview: '이 템플릿은 {n}쪽짜리 레슨을 만듭니다 — 지금은 1쪽 미리보기입니다. "시퀀스 생성"을 누르면 전체가 만들어집니다.',
      seq: '레슨 시퀀스', seqEmpty: '아직 페이지 없음 — 도면을 만들고 "페이지로 추가"를 누르세요.',
      addPage: '+ 페이지로 추가', savePage: '✓ 이 페이지에 저장', genSeq: '시퀀스 생성',
      open: '열기', dup: '복제', descPh: '페이지 설명 (DotPad에서 음성으로 읽힘)',
      printTip: '인쇄할 때 배율을 "실제 크기(100%)"로 설정하세요 — 점자 크기는 줄어들면 안 됩니다.',
      loaded: '스펙 파일을 불러왔습니다 — 템플릿 옵션은 비활성, 레이블·내보내기는 그대로 사용 가능.',
      rbUpload: '규정집 JSON', rbSample: '내장 샘플 불러오기 (아랍어 709 기호)',
      rbLoaded: '불러옴: ', rbHint: '표 형식 규정집(PDF·Word·검증된 JSON)을 여기에 끌어다 놓으세요 — 오른쪽 파일 선택으로도 됩니다. → UEB 스타일 서술형 문서로 변환되며, 점자는 선택·복사 가능한 텍스트입니다(폰트 내장). hwp는 한글에서 "다른 이름으로 저장 → Word(.docx)" 후 올리세요.',
      rbDropType: 'PDF·Word(.docx)·JSON 파일만 변환할 수 있습니다.',
      docx: 'Word (.docx)',
      ebrl: 'eBraille (.ebrl)',
      dpBtn: 'DotPad 연결', dpConnected: 'DotPad ● {n}대',
      dpAddTip: '한 번 더 누르면 다른 DotPad에 미러링 (최대 5대)',
      dpNoBt: '여기서는 Web Bluetooth를 쓸 수 없습니다. 이 HTML 파일을 내려받아 Chrome이나 Edge에서 직접 열어주세요 (미리보기 창·Safari·Firefox에서는 블루투스가 막혀 있습니다).',
      dpNoSdk: 'DotPad SDK를 불러오지 못했습니다. DotPadSDK-3.0.0.js 파일을 준비한 뒤 "DotPad 연결"을 다시 누르세요 — 파일 선택 창이 열립니다 (라이선스상 내장 불가).',
      dpPickSdk: '📂 방금 열린 창에서 DotPadSDK-3.0.0.js 파일을 선택해주세요. 파일을 디스크에서 직접 열면 브라우저가 자동 불러오기를 막아서, 한 번만 직접 선택이 필요합니다.',
      dpFail: 'DotPad 연결 실패{e} — 기기 전원과 거리를 확인하고 다시 시도하세요.',
      dpKeys: 'DotPad 연결됨 — 파란 테두리가 기기에 나오는 범위입니다 (60×40 핀). 점자 도트 1개가 핀 1개에 떨어지는 1:1로 시작합니다. 기기 키: F1 왼쪽 · F2 위 · F3 아래 · F4 오른쪽 · 좌패닝+F1 축소 · 우패닝+F4 확대 · 패닝 단독은 이전/다음 페이지.',
      dpFit: '전체보기', dpOneToOne: '1:1 실제 크기', dpNoBrl: '⚠ 점자 판독 불가',
      dpLost: 'DotPad 연결이 끊겼습니다.',
      dpDiag: '줄 전송 {sent} · 기기 완료 {ack} · 처리 대기 {ka} · 오류 {err} · 끊김 {lost}',
      dpReconn: 'DotPad 연결이 끊겨 다시 연결하는 중… ({n}번째 시도)',
      dpReconnFail: '자동 재연결에 실패했습니다. 기기를 껐다 켠 뒤 "DotPad 연결"을 다시 눌러주세요.',
      dpBrlWarn: '⚠ 이 배율에서는 핀 1개가 {mm}mm를 맡는데 점자 도트 간격은 2.34mm입니다 — 도트가 한 핀에 뭉쳐 레이블을 손으로 읽을 수 없습니다. 우패닝+F4로 1:1까지 확대하세요. (이 배율은 전체 형태 파악용으로만 쓰세요.)',
      dpKeysRb: 'DotPad 연결됨 — 기기 키: ◀▶ 이전/다음 항목, F1 재전송, F2 처음으로, F3/F4 10개 뒤로/앞으로.',
      dl: { svg: 'SVG (엠보서/Monarch)', pdf: 'PDF (인쇄)', dtms: 'DotPad .dtms', brf: 'BRF 키 페이지', json: '스펙 저장 (JSON)', load: '스펙 불러오기' }
    }
  };

  function t(k) { var o = STR[state.uiLang]; return k.split('.').reduce(function (a, b) { return a[b]; }, o); }

  function init() {
    $('#uiLang').value = state.uiLang;
    $('#brlLang').value = state.brailleLang;
    $('#paper').value = state.paper;
    $('#inkMode').value = state.inkMode;
    renderChrome();
    renderGallery();
    selectTemplate(TEMPLATES[0]);
    $('#uiLang').addEventListener('change', function (e) { state.uiLang = e.target.value; renderChrome(); renderGallery(); renderForm(); update(); });
    $('#brlLang').addEventListener('change', function (e) { state.brailleLang = e.target.value; update(); });
    $('#paper').addEventListener('change', function (e) { state.paper = e.target.value; update(); });
    $('#inkMode').addEventListener('change', function (e) { state.inkMode = e.target.value; update(); });
    $('#rbFixSave').addEventListener('click', saveRbFix);
    $('#rbFixClear').addEventListener('click', clearRbFix);
    $('#ex-load').addEventListener('click', function () { $('#loadFile').click(); });
    $('#loadFile').addEventListener('change', function (ev) {
      var file = ev.target.files[0]; if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var data = JSON.parse(fr.result);
          if (data.tgilSequence && data.pages) {   // 레슨 시퀀스 파일
            state.pages = data.pages;
            renderSeqList(); openPage(0);
            return;
          }
          state.loadedSpec = data;
          state.tpl = null; state.labels = []; state.dimOverrides = {};
          state.titleOverride = null; state.dimUnit = null; state.leaderOverrides = {};
          $('#form').innerHTML = '<div class="hint">' + t('loaded') + '</div>';
          renderGallery(); renderLabelList(); update();
        } catch (e) { alert('JSON error: ' + e.message); }
      };
      fr.readAsText(file);
      ev.target.value = '';
    });
    $('#applyJson').addEventListener('click', applyJson);
    ['svg', 'pdf', 'dtms', 'brf', 'json', 'docx', 'ebrl'].forEach(function (k) {
      $('#ex-' + k).addEventListener('click', function () { EXPORT[k](); });
    });
    $('#dpBtn').addEventListener('click', dpConnect);
    $('#dpOff').addEventListener('click', function () { if (window.DOTPAD) DOTPAD.BLE.disconnectAll(); });
    $('#addPage').addEventListener('click', addOrSavePage);
    setSeqChrome();
    // 레이블 모드 / 치수 모드 (상호 배타)
    $('#labelMode').addEventListener('click', function () { setMode('label', !state.labelMode); });
    $('#dimMode').addEventListener('click', function () { setMode('dim', !state.dimMode); });
    $('#preview').addEventListener('click', onPreviewClick);
    $('#preview').addEventListener('dblclick', onPreviewDblClick);
    $('#preview').addEventListener('mousedown', onDragStart);
    // 문서 변환기: 미리보기에 파일을 끌어다 놓으면 바로 변환 (PDF·Word·JSON)
    ['dragover', 'dragenter'].forEach(function (ev) {
      $('#preview').addEventListener(ev, function (e) {
        if (state.tpl !== RULEBOOK_TPL) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        $('#preview').classList.add('dropping');
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      $('#preview').addEventListener(ev, function () { $('#preview').classList.remove('dropping'); });
    });
    $('#preview').addEventListener('drop', function (e) {
      if (state.tpl !== RULEBOOK_TPL) return;
      e.preventDefault(); e.stopPropagation();
      $('#preview').classList.remove('dropping');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.(json|pdf|docx)$/i.test(f.name)) { alert(t('rbDropType')); return; }
      rbHandleFile(f);
    });
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('resize', function () { dpOverlay(); });
    $('#labelInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var txt = ev.target.value.trim();
        if (state.pendingKind === 'label' && state.pending && txt) {
          state.labels.push({ at: state.pending, text: txt }); update(); renderLabelList();
        } else if (state.pendingKind === 'dim' && state.pendingDimPt && state.pending && txt) {
          state.userDims.push({ from: state.pendingDimPt, to: state.pending, label: applyUnit(txt) });
          state.pendingDimPt = null; setMode('dim', false); update();
        } else {
          commitInlineEdit(txt);   // 제자리 편집 (치수·제목·레이블)
        }
        hideLabelInput();
      } else if (ev.key === 'Escape') { state.pendingDimPt = null; hideLabelInput(); setModeChrome(); }
    });
    // 다른 곳을 누르면 제자리 편집은 그대로 확정 (문서 편집기 관례)
    $('#labelInput').addEventListener('blur', function (ev) {
      if (!state.pendingKind) return;
      if (commitInlineEdit(ev.target.value)) hideLabelInput();
    });
  }

  function setMode(kind, on) {
    state.labelMode = kind === 'label' ? on : false;
    state.dimMode = kind === 'dim' ? on : false;
    if (!state.dimMode) state.pendingDimPt = null;
    setModeChrome();
  }
  function setModeChrome() {
    $('#labelMode').classList.toggle('on', state.labelMode);
    $('#labelMode').textContent = state.labelMode ? t('labelModeOn') : t('labelMode');
    $('#dimMode').classList.toggle('on', state.dimMode);
    $('#dimMode').textContent = state.dimMode
      ? (state.pendingDimPt ? t('dimModeOn2') : t('dimModeOn')) : t('dimMode');
    $('#preview').classList.toggle('labeling', state.labelMode || state.dimMode);
  }

  /* 클릭/드래그 좌표 → world */
  function worldFromEvent(ev) {
    var svg = $('#preview svg'); if (!svg || !state.layout) return null;
    var r = svg.getBoundingClientRect();
    var pg = state.layout.page || TGIL.PROFILE.page;
    var mmX = (ev.clientX - r.left) / r.width * pg.w;
    var mmY = (ev.clientY - r.top) / r.height * pg.h;
    // w(도면 좌표)는 좌표계가 있는 도면에서만 — 텍스트 페이지는 mm만 유효
    return { w: state.layout.XI ? [state.layout.XI(mmX), state.layout.YI(mmY)] : null, mm: [mmX, mmY] };
  }
  /* 치수 근접 탐색: 레이블 박스 or 치수선 3mm 이내 */
  function findDimNear(mm) {
    var dims = (state.spec && state.spec.elements || []).filter(function (e) { return e.type === 'dimension' && e._labelMm; });
    for (var i = 0; i < dims.length; i++) {
      var e = dims[i], sz = e._size || { w: 20, h: 6.5 };
      if (Math.abs(mm[0] - e._labelMm[0]) < sz.w / 2 + 3 && Math.abs(mm[1] - e._labelMm[1]) < sz.h / 2 + 4) return e;
      var L2 = e._lineMm;
      var vx = L2[2] - L2[0], vy = L2[3] - L2[1], len2 = vx * vx + vy * vy || 1;
      var tt = Math.max(0, Math.min(1, ((mm[0] - L2[0]) * vx + (mm[1] - L2[1]) * vy) / len2));
      var px = L2[0] + tt * vx - mm[0], py = L2[1] + tt * vy - mm[1];
      if (Math.sqrt(px * px + py * py) < 3) return e;
    }
    return null;
  }

  /* 레이블 타깃 도트 근접 탐색 (페이지 mm 기준 반경) */
  function findLabelNear(mm, radius) {
    radius = radius || 5;
    if (!state.layout || !state.layout.X) return -1;
    var best = -1, bestD = radius;
    state.labels.forEach(function (l, i) {
      var dx = state.layout.X(l.at[0]) - mm[0], dy = state.layout.Y(l.at[1]) - mm[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function onPreviewClick(ev) {
    if (state.didDrag) { state.didDrag = false; return; }  // 드래그 직후 클릭 무시
    var pt = worldFromEvent(ev); if (!pt) return;
    if ((state.dimMode || state.labelMode) && !pt.w) return;   // 좌표계 없는 페이지(텍스트 페이지)엔 배치 불가
    if (state.dimMode) {
      if (!state.pendingDimPt) {           // 1/2: 시작점
        state.pendingDimPt = pt.w; setModeChrome(); return;
      }
      state.pending = pt.w; state.pendingKind = 'dim';   // 2/2: 끝점 → 레이블 입력
      var d = Math.sqrt(Math.pow(pt.w[0] - state.pendingDimPt[0], 2) + Math.pow(pt.w[1] - state.pendingDimPt[1], 2));
      showLabelInput(ev, String(Math.round(d * 100) / 100));
      return;
    }
    if (state.labelMode) {
      state.pending = pt.w; state.pendingKind = 'label';
      showLabelInput(ev, '');
      return;
    }
    // 모드 없음: 제목·치수·레이블 글자를 클릭하면 그 글자 위에서 바로 수정 (제자리 편집)
    if (state.pendingKind && commitInlineEdit($('#labelInput').value)) { hideLabelInput(); return; }
    hideLabelInput();
    var dimEl = findDimNear(pt.mm);
    if (dimEl) {
      state.pendingDimEl = dimEl; state.pendingKind = 'dimedit';
      var p = parseDimLabel(dimEl.label);
      var sz = dimEl._size || { w: 20, h: 6.5 };
      showInlineEdit({ cxMm: dimEl._labelMm[0], cyMm: dimEl._labelMm[1], wMm: sz.w, hMm: sz.h, value: p ? String(p.val) : dimEl.label });
      focusDimRowSoft(dimEl);
      return;
    }
    var ldEl = findLeaderLabelNear(pt.mm);
    if (ldEl) {
      state.pendingLeaderEl = ldEl; state.pendingKind = 'leaderedit';
      var lsz = ldEl._size || { w: 20, h: 6.5 };
      showInlineEdit({ cxMm: ldEl._labelMm[0], cyMm: ldEl._labelMm[1], wMm: lsz.w, hMm: lsz.h, value: ldEl.text });
      if (ldEl._userLabelIdx != null) focusLabelRowSoft(ldEl._userLabelIdx);
      return;
    }
    var li = findLabelNear(pt.mm);
    if (li >= 0) { focusLabelRow(li); return; }
    var tb = findTitleHit(pt.mm);
    if (tb) {
      state.pendingKind = 'title';
      showInlineEdit({ cxMm: tb.cx, cyMm: tb.y0 + tb.h / 2, wMm: tb.w, hMm: tb.h, value: state.spec.title.text });
    }
  }
  /* 리드선 레이블 글자 히트 테스트 (도트가 아니라 텍스트 박스) */
  function findLeaderLabelNear(mm) {
    var ls = (state.spec && state.spec.elements || []).filter(function (e) { return e.type === 'leader' && e._labelMm; });
    for (var i = 0; i < ls.length; i++) {
      var e = ls[i], sz = e._size || { w: 20, h: 6.5 };
      if (Math.abs(mm[0] - e._labelMm[0]) < sz.w / 2 + 3 && Math.abs(mm[1] - e._labelMm[1]) < sz.h / 2 + 4) return e;
    }
    return null;
  }
  /* 제목 영역 히트 테스트 (미리보기 상단 점자+묵자 제목) */
  function findTitleHit(mm) {
    var L = state.layout;
    if (!L || !L.titleBox || !state.spec || !state.spec.title) return null;
    var b = L.titleBox;
    if (mm[1] < b.y0 - 2 || mm[1] > b.y0 + b.h + 5) return null;
    if (Math.abs(mm[0] - b.cx) > b.w / 2 + 8) return null;
    return b;
  }

  function onPreviewDblClick(ev) {   // 더블클릭: 레이블 삭제 → 치수 삭제 순으로 탐색
    if (state.labelMode || state.dimMode) return;
    var pt = worldFromEvent(ev); if (!pt) return;
    var i = findLabelNear(pt.mm);
    if (i >= 0) { state.labels.splice(i, 1); update(); renderLabelList(); return; }
    var dimEl = findDimNear(pt.mm);
    if (dimEl) {
      hideLabelInput();  // 첫 클릭이 연 수정창 닫기
      if (dimEl._userIdx != null) state.userDims.splice(dimEl._userIdx, 1);
      else if (dimEl._dimIdx != null) state.dimHidden[dimEl._dimIdx] = true;
      update();
    }
  }

  var rafPending = false;
  function onDragStart(ev) {
    if (state.labelMode || state.dimMode) return;
    var pt = worldFromEvent(ev); if (!pt || !pt.w) return;
    var i = findLabelNear(pt.mm);
    if (i >= 0) { state.dragging = i; ev.preventDefault(); }
  }
  function onDragMove(ev) {
    if (state.dragging == null) return;
    var pt = worldFromEvent(ev); if (!pt || !pt.w) return;
    state.labels[state.dragging].at = pt.w;
    state.didDrag = true;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(function () { rafPending = false; update(); });
    }
  }
  function onDragEnd() {
    if (state.dragging == null) return;
    var moved = state.didDrag;
    state.dragging = null;
    if (moved) update();  // 이동 없으면 재렌더 생략 (더블클릭 이벤트 보존)
  }

  /* 생성 시 입력창: 클릭 지점 옆 (아직 대상이 없으므로 위치를 찍는 흐름) */
  function showLabelInput(ev, preset, unitK) {
    var box = $('#labelBox'), inp = $('#labelInput');
    box.className = '';
    inp.style.width = ''; inp.style.height = ''; inp.style.fontSize = '';
    box.style.display = 'flex';
    box.style.left = Math.min(ev.clientX + 8, window.innerWidth - 240) + 'px';
    box.style.top = (ev.clientY - 16) + 'px';
    // 치수 생성일 때만 단위 선택 노출 (수정은 전체 일괄 단위를 따른다)
    var isNewDim = state.pendingKind === 'dim';
    $('#unitSel').style.display = isNewDim ? 'inline-block' : 'none';
    if (isNewDim) $('#unitSel').value = unitK != null ? unitK : (state.dimUnit || $('#unitSel').value);
    inp.value = preset || ''; inp.focus(); inp.select();
  }
  /* 수정 시 입력창: 도면의 그 글자 위에 정확히 겹쳐 띄운다 (제자리 편집) */
  function showInlineEdit(o) {
    var svg = $('#preview svg'); if (!svg || !state.layout) return false;
    var r = svg.getBoundingClientRect();
    var pg = state.layout.page || TGIL.PROFILE.page;
    var sx = r.width / pg.w, sy = r.height / pg.h;
    var w = Math.max((o.wMm || 0) * sx + 26, 96);
    var h = Math.max((o.hMm || 0) * sy + 4, 24);
    var box = $('#labelBox'), inp = $('#labelInput');
    box.className = 'inplace';
    box.style.display = 'flex';
    box.style.left = Math.round(r.left + o.cxMm * sx - w / 2) + 'px';
    box.style.top = Math.round(r.top + o.cyMm * sy - h / 2) + 'px';
    inp.style.width = w + 'px';
    inp.style.height = h + 'px';
    inp.style.fontSize = Math.max(12, Math.min(16, Math.round(h * 0.62))) + 'px';
    $('#unitSel').style.display = 'none';
    inp.value = o.value || ''; inp.focus(); inp.select();
    return true;
  }
  function hideLabelInput() {
    var box = $('#labelBox'), inp = $('#labelInput');
    box.style.display = 'none'; box.className = '';
    inp.style.width = ''; inp.style.height = ''; inp.style.fontSize = '';
    state.pending = null; state.pendingKind = null; state.pendingDimEl = null; state.pendingLeaderEl = null;
  }
  /* 제자리 편집 확정 (Enter · 다른 곳 클릭 공통) */
  function commitInlineEdit(txt) {
    txt = String(txt || '').trim();
    var k = state.pendingKind;
    if (!txt) return false;
    if (k === 'dimedit' && state.pendingDimEl) {
      var p = parseDimLabel(state.pendingDimEl.label);
      var unit = state.dimUnit != null && state.dimUnit !== '' ? state.dimUnit : (p ? p.unit : null);
      var num = parseFloat(txt.replace(/,/g, ''));
      commitDim(state.pendingDimEl, (/^[0-9][0-9.,]*$/.test(txt) && !isNaN(num)) ? fmtDim(num, unit) : txt, true);
      $('#dimForm').innerHTML = '';   // 행 재구성 (수치 표기 갱신)
      update();
      return true;
    }
    if (k === 'title') {
      var tk = tplTitleParam(), ti = titleInput();
      if (tk && ti) { ti.value = txt; update(); }      // 템플릿 자체 제목 파라미터에 반영
      else { state.titleOverride = txt; update(); }
      return true;
    }
    if (k === 'leaderedit' && state.pendingLeaderEl) {
      var el = state.pendingLeaderEl;
      if (el._userLabelIdx != null && state.labels[el._userLabelIdx]) state.labels[el._userLabelIdx].text = txt;
      else if (el._leaderIdx != null) state.leaderOverrides[el._leaderIdx] = txt;
      update(); renderLabelList();
      return true;
    }
    return false;
  }

  /* ── 치수 단위 체계 (mm·cm·m·ft·in, 단위 변경 시 수치 자동 환산) ── */
  var UNITS = [
    { k: 'mm', f: 1,     en: 'mm',     ko: '밀리미터' },
    { k: 'cm', f: 10,    en: 'cm',     ko: '센티미터' },
    { k: 'm',  f: 1000,  en: 'meters', ko: '미터' },
    { k: 'ft', f: 304.8, en: 'feet',   ko: '피트' },
    { k: 'in', f: 25.4,  en: 'inches', ko: '인치' }
  ];
  var UNIT_WORDS = {
    mm: ['mm', 'millimeter', 'millimeters', '밀리미터', '미리미터'],
    cm: ['cm', 'centimeter', 'centimeters', '센티미터', '센치미터'],
    m:  ['m', 'meter', 'meters', 'metre', 'metres', '미터'],
    ft: ['ft', 'foot', 'feet', '피트'],
    in: ['in', 'inch', 'inches', '인치']
  };
  function unitOf(k) { for (var i = 0; i < UNITS.length; i++) if (UNITS[i].k === k) return UNITS[i]; return null; }
  /* "78 feet" / "78피트" / "0.914 m" / "12" → {val, unit|null} | null(자유 문구) */
  function parseDimLabel(label) {
    var m = String(label).trim().match(/^([0-9][0-9.,]*)\s*(.*)$/);
    if (!m) return null;
    var val = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(val)) return null;
    var w = m[2].trim().toLowerCase();
    if (!w) return { val: val, unit: null };
    for (var k in UNIT_WORDS) {
      for (var j = 0; j < UNIT_WORDS[k].length; j++) if (UNIT_WORDS[k][j].toLowerCase() === w) return { val: val, unit: k };
    }
    return null;
  }
  function fmtNum(v) { return String(Math.round(v * 100) / 100); }
  function fmtDim(val, unitK) {
    if (!unitK) return fmtNum(val);
    var u = unitOf(unitK);
    return state.uiLang === 'ko' ? fmtNum(val) + u.ko : fmtNum(val) + ' ' + u.en;
  }
  /* 치수 문구 확정: 숫자면 선택된 단위를 붙인다 (생성 시 플로팅 입력) */
  function applyUnit(txt) {
    var u = $('#unitSel').value;
    txt = txt.trim();
    if (u && /^[0-9][0-9.,]*$/.test(txt)) return fmtDim(parseFloat(txt.replace(/,/g, '')), u);
    return txt;
  }

  function renderLabelList() {
    var box = $('#labelList'); box.innerHTML = '';
    if (!state.labels.length) { box.innerHTML = '<div class="lempty">' + t('lempty') + '</div>'; return; }
    state.labels.forEach(function (l, i) {
      var row = document.createElement('div'); row.className = 'lrow';
      var inp = document.createElement('input'); inp.type = 'text'; inp.value = l.text;
      inp.addEventListener('change', function () {
        var v = inp.value.trim();
        if (v) { l.text = v; update(); }
        else inp.value = l.text;   // 빈 문구 방지 (삭제는 ✕)
      });
      row.appendChild(inp);
      var del = document.createElement('button'); del.textContent = '✕';
      del.onclick = function () { state.labels.splice(i, 1); update(); renderLabelList(); };
      row.appendChild(del); box.appendChild(row);
    });
  }

  function renderChrome() {
    $('#appName').textContent = t('appName');
    document.title = t('appName');
    $('#h-templates').textContent = t('templates');
    $('#h-options').textContent = t('options');
    $('#h-braille').textContent = t('braille');
    $('#h-paper').textContent = t('paper');
    $('#h-ink').textContent = t('ink');
    $('#h-dims').textContent = t('dims');
    Object.keys(TGIL.PAPERS).forEach(function (k) {
      var op = $('#paper option[value="' + k + '"]');
      if (op) op.textContent = TGIL.PAPERS[k].name + ' (' + TGIL.PAPERS[k].w + '×' + TGIL.PAPERS[k].h + 'mm)';
    });
    $('#inkMode option[value=screen]').textContent = t('inkScreen');
    $('#inkMode option[value=print]').textContent = t('inkPrint');
    $('#inkMode option[value=off]').textContent = t('inkOff');
    UNITS.forEach(function (u) {   // 플로팅 단위 선택도 언어에 맞춤
      var op = $('#unitSel option[value="' + u.k + '"]');
      if (op) op.textContent = state.uiLang === 'ko' ? u.ko : u.en;
    });
    $('#h-labels').textContent = t('labels');
    // (시퀀스 헤더는 renderSeqList가 관리)
    $('#editHint').textContent = t('editHint');
    setModeChrome();
    renderLabelList();
    renderSeqList();
    $('#h-preview').textContent = t('preview');
    $('#h-exports').textContent = t('exports');
    $('#h-report').textContent = t('report');
    $('#h-advanced').textContent = t('advanced');
    $('#applyJson').textContent = t('apply');
    $('#brlLang option[value=en]').textContent = t('ueb');
    $('#brlLang option[value=nemeth]').textContent = t('nemeth');
    $('#brlLang option[value=ko]').textContent = t('kor');
    var dl = STR[state.uiLang].dl;
    Object.keys(dl).forEach(function (k) { $('#ex-' + k).textContent = dl[k]; });
    $('#ex-docx').textContent = t('docx');
    $('#ex-ebrl').textContent = t('ebrl');
    dpChrome();
  }

  function renderGallery() {   // 카테고리 아코디언 — 누르면 아래로 펼침 (긴 목록 대응)
    var g = $('#gallery'); g.innerHTML = '';
    var all = TEMPLATES.concat([RULEBOOK_TPL, TRACE_TPL]);
    var groups = {};
    all.forEach(function (tpl) {
      var cat = tpl.category.split('/')[0];
      (groups[cat] = groups[cat] || []).push(tpl);
    });
    state.galleryOpen = state.galleryOpen || {};
    Object.keys(groups).forEach(function (cat) {
      var open = !!state.galleryOpen[cat];
      var head = document.createElement('button');
      head.className = 'gcat'; head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.textContent = (open ? '▾ ' : '▸ ') + cat + ' (' + groups[cat].length + ')';
      head.onclick = function () { state.galleryOpen[cat] = !open; renderGallery(); };
      g.appendChild(head);
      if (!open) return;
      groups[cat].forEach(function (tpl) {
        var card = document.createElement('button');
        card.className = 'card' + (state.tpl === tpl ? ' active' : '');
        card.innerHTML = '<b>' + tpl.name[state.uiLang] + '</b><small>' + tpl.category + '</small>';
        card.onclick = function () { selectTemplate(tpl); };
        g.appendChild(card);
      });
    });
  }

  function selectTemplate(tpl) {
    state.galleryOpen = state.galleryOpen || {};
    state.galleryOpen[tpl.category.split('/')[0]] = true;   // 선택한 템플릿의 카테고리는 펼침 유지
    state.tpl = tpl; state.loadedSpec = null; state.editingPage = null;   // 시퀀스(pages)는 유지 — 여러 템플릿을 섞어 레슨 구성
    state.labels = []; state.dimOverrides = {}; state.userDims = []; state.pendingDimPt = null; state.dimHidden = {};
    state.titleOverride = null; state.dimUnit = null; state.leaderOverrides = {};
    state.dpView = { zoom: DP_DEFAULT_SCALE, cx: null, cy: null };   // 새 도면도 기본 배율부터
    renderLabelList(); renderSeqList();
    renderGallery(); renderForm(); update();
  }

  /* ── 레슨 시퀀스 ── */
  function pageTitleOf(spec) { return (spec && spec.title && spec.title.text) || 'page'; }

  function addOrSavePage() {
    if (!state.spec) return;
    var copy = JSON.parse(JSON.stringify(state.spec));
    delete copy._tplDimCount;
    if (state.editingPage != null && state.pages[state.editingPage]) {
      state.pages[state.editingPage].spec = copy;
      state.pages[state.editingPage].title = pageTitleOf(copy);
    } else {
      state.pages.push({ title: pageTitleOf(copy), desc: '', spec: copy });
      state.editingPage = state.pages.length - 1;
    }
    renderSeqList(); setSeqChrome();
  }

  function openPage(i, keepTpl) {
    if (!state.pages[i]) return;
    state.loadedSpec = JSON.parse(JSON.stringify(state.pages[i].spec));
    state.editingPage = i;
    if (!keepTpl) { state.tpl = null; $('#form').innerHTML = '<div class="hint">' + t('loaded') + '</div>'; renderGallery(); }
    state.labels = []; state.userDims = []; state.dimOverrides = {}; state.dimHidden = {};
    state.titleOverride = null; state.dimUnit = null; state.leaderOverrides = {};
    renderLabelList();
    update(); renderSeqList(); setSeqChrome();
  }

  function setSeqChrome() {
    $('#addPage').textContent = state.editingPage != null ? t('savePage') : t('addPage');
  }

  function renderSeqList() {
    var box = $('#seqList'); if (!box) return;
    // 접기 토글 헤더 (긴 시퀀스 대응 — 페르소나 피드백)
    var h = $('#h-seq');
    h.textContent = t('seq') + (state.pages.length ? ' (' + state.pages.length + ') ' + (state.seqCollapsed ? '▸' : '▾') : '');
    h.style.cursor = 'pointer';
    h.onclick = function () { state.seqCollapsed = !state.seqCollapsed; renderSeqList(); };
    box.style.display = state.seqCollapsed ? 'none' : '';
    box.innerHTML = '';
    if (state.seqCollapsed) return;
    if (!state.pages.length) { box.innerHTML = '<div class="lempty">' + t('seqEmpty') + '</div>'; return; }
    state.pages.forEach(function (pg, i) {
      var row = document.createElement('div');
      row.className = 'srow' + (state.editingPage === i ? ' active' : '');
      var st = document.createElement('div'); st.className = 'st';
      var num = document.createElement('b'); num.textContent = (i + 1) + '.'; st.appendChild(num);
      var ti = document.createElement('input'); ti.value = pg.title;
      ti.addEventListener('change', function () { pg.title = ti.value; });
      st.appendChild(ti); row.appendChild(st);
      var de = document.createElement('textarea'); de.placeholder = t('descPh'); de.value = pg.desc || '';
      de.addEventListener('change', function () { pg.desc = de.value; });
      row.appendChild(de);
      var sb = document.createElement('div'); sb.className = 'sb';
      [[t('open'), function () { openPage(i); }],
       [t('dup'), function () { state.pages.splice(i + 1, 0, JSON.parse(JSON.stringify(pg))); renderSeqList(); }],
       ['↑', function () { if (i > 0) { state.pages.splice(i - 1, 0, state.pages.splice(i, 1)[0]); if (state.editingPage === i) state.editingPage = i - 1; renderSeqList(); } }],
       ['↓', function () { if (i < state.pages.length - 1) { state.pages.splice(i + 1, 0, state.pages.splice(i, 1)[0]); if (state.editingPage === i) state.editingPage = i + 1; renderSeqList(); } }],
       ['✕', function () { state.pages.splice(i, 1); if (state.editingPage === i) state.editingPage = null; renderSeqList(); setSeqChrome(); }]
      ].forEach(function (b) {
        var btn = document.createElement('button'); btn.textContent = b[0]; btn.onclick = b[1]; sb.appendChild(btn);
      });
      row.appendChild(sb); box.appendChild(row);
    });
  }

  /* 템플릿 자체 제목 파라미터 (예: 텍스트 페이지의 heading) */
  function tplTitleParam() {
    if (!state.tpl || !state.tpl.params) return null;
    for (var i = 0; i < state.tpl.params.length; i++) {
      var k = state.tpl.params[i].key;
      if (k === 'heading' || k === 'title') return k;
    }
    return null;
  }
  function titleInput() {
    var k = tplTitleParam();
    return k ? $('#form [data-key="' + k + '"]') : $('#titleOvr');
  }
  var _formT = null;
  function scheduleUpdate() { clearTimeout(_formT); _formT = setTimeout(update, 180); }

  var paramRows = [];
  /* showIf 조건에 따라 파라미터 행 표시/숨김 (선택이 바뀔 때마다 재평가) */
  function applyParamVis() {
    if (!paramRows.length) return;
    var p = readParams();
    paramRows.forEach(function (x) {
      var on = true;
      try { on = !!x.fn(p); } catch (e) {}
      x.row.style.display = on ? '' : 'none';
    });
  }

  function renderForm() {
    var f = $('#form'); f.innerHTML = '';
    paramRows = [];
    if (!state.tpl) return;
    // 제목 수정 (미리보기 제목 클릭으로도 가능). 템플릿이 자체 제목 파라미터를 가지면 중복 생성하지 않는다.
    if (state.tpl !== RULEBOOK_TPL && state.tpl !== TRACE_TPL && !tplTitleParam()) {
      var tRow = document.createElement('label'); tRow.className = 'frow';
      var tLab = document.createElement('span'); tLab.textContent = t('title'); tRow.appendChild(tLab);
      var tInp = document.createElement('input'); tInp.type = 'text'; tInp.id = 'titleOvr';
      tInp.addEventListener('input', function () {
        state.titleOverride = tInp.value.trim() || null;
        scheduleUpdate();
      });
      tRow.appendChild(tInp); f.appendChild(tRow);
    }
    if (state.tpl === RULEBOOK_TPL) {   // 문서 변환기: PDF/Word/JSON 업로드 + 내장 샘플
      var ru = document.createElement('label'); ru.className = 'frow';
      var rs = document.createElement('span'); rs.textContent = t('rbUpload'); ru.appendChild(rs);
      var rf = document.createElement('input'); rf.type = 'file';
      rf.accept = '.json,.pdf,.docx,application/json,application/pdf';
      rf.addEventListener('change', function (ev) {
        if (ev.target.files[0]) rbHandleFile(ev.target.files[0]);
      });
      ru.appendChild(rf); f.appendChild(ru);
      if (typeof window !== 'undefined' && window.RB_SAMPLE) {
        var sb = document.createElement('button'); sb.className = 'genBtn';
        sb.textContent = t('rbSample');
        sb.onclick = function () { state.rbData = window.RB_SAMPLE; state.rbName = 'built-in'; update(); };
        f.appendChild(sb);
      }
      var rh = document.createElement('div'); rh.className = 'hint';
      rh.textContent = t('rbHint'); f.appendChild(rh);
    }
    if (state.tpl === TRACE_TPL) {   // 트랙 B: 파일 업로드 입력 + 소스 가이드
      var up = document.createElement('label'); up.className = 'frow';
      var us = document.createElement('span'); us.textContent = t('upload'); up.appendChild(us);
      var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*';
      fi.addEventListener('change', function (ev) { loadTraceImage(ev.target.files[0]); });
      up.appendChild(fi); f.appendChild(up);
      var hint = document.createElement('div'); hint.className = 'hint';
      hint.textContent = t('traceHint'); f.appendChild(hint);
    }
    state.tpl.params.forEach(function (p) {
      var row = document.createElement('label'); row.className = 'frow';
      var lab = document.createElement('span'); lab.textContent = p.label[state.uiLang]; row.appendChild(lab);
      var inp;
      if (p.type === 'select') {
        inp = document.createElement('select');
        p.options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; inp.appendChild(op); });
        inp.value = p.default;
      } else if (p.type === 'bool') {
        inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!p.default;
      } else if (p.type === 'textarea') {
        row.className = 'frow col';
        inp = document.createElement('textarea'); inp.value = p.default;
      } else {
        inp = document.createElement('input'); inp.type = p.type === 'number' ? 'number' : 'text'; inp.value = p.default;
      }
      inp.dataset.key = p.key;
      // 글자 입력은 타이핑하는 동안 바로 반영(input). blur의 change로 다시 그리면
      // 그 순간의 클릭이 삼켜지므로(미리보기 DOM 교체) 글자 입력엔 change를 걸지 않는다.
      if (p.type === 'text' || p.type === 'textarea' || p.type === 'number') inp.addEventListener('input', scheduleUpdate);
      else inp.addEventListener('change', update);
      row.appendChild(inp); f.appendChild(row);
      // 다른 선택에 따라 의미가 없어지는 항목은 숨긴다 (예: 정육면체의 가로·높이·세로)
      if (p.showIf) paramRows.push({ row: row, fn: p.showIf });
    });
    applyParamVis();
    if (state.tpl.sequence) {   // 시퀀스 생성 템플릿: 버튼으로 페이지 일괄 생성
      var gb = document.createElement('button'); gb.className = 'genBtn';
      gb.textContent = t('genSeq');
      gb.onclick = generateSequence;
      f.appendChild(gb);
    }
  }

  function generateSequence() {
    if (!state.tpl || !state.tpl.sequence) return;
    var textLang = state.brailleLang === 'ko' ? 'ko' : 'en';
    var pages = state.tpl.build(readParams(), textLang);
    state.pages = pages.map(function (pg) { return { title: pg.title, desc: pg.desc || '', spec: pg.spec }; });
    renderSeqList();
    openPage(0, true);   // keepTpl: 파라미터 폼 유지 (재생성 가능)
  }

  function readParams() {
    var out = {};
    document.querySelectorAll('#form [data-key]').forEach(function (inp) {
      out[inp.dataset.key] = inp.type === 'checkbox' ? inp.checked : inp.value;
    });
    return out;
  }

  function loadTraceImage(file) {
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      var MAX = 640, sc = Math.min(1, MAX / Math.max(img.width, img.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      state.trace = { data: ctx.getImageData(0, 0, cv.width, cv.height), w: cv.width, h: cv.height };
      update();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function buildTraceSpec(p) {
    if (!state.trace) { state.extraReport = [t('noimg')]; return null; }
    var r = TRACE.traceToElements(state.trace.data.data, state.trace.w, state.trace.h, {
      simplify: Math.max(0.002, Math.min(0.02, (+p.simplify || 0.6) / 100)),
      smooth: !!p.smooth, invert: !!p.invert
    });
    state.extraReport = r.report.slice();
    if (!r.elements.length || r.elements.length > 12) state.extraReport.push(t('traceHint'));
    return {
      lang: state.brailleLang === 'ko' ? 'ko' : 'en',
      title: { text: p.title || 'Traced Graphic' },
      canvas: {}, units: 'px', elements: r.elements
    };
  }

  /* PDF → 텍스트 아이템(x,y,w) → 파서 (파싱은 베타: 리포트로 검토 유도) */
  /* 규정집 파일 공통 처리 — 파일 선택 창과 미리보기 드래그&드롭이 같은 경로를 쓴다 */
  function rbHandleFile(file) {
    var lower = file.name.toLowerCase();
    state.rbFixes = {}; state.rbFixId = null;
    if (lower.endsWith('.pdf')) return loadRbPdf(file);
    if (lower.endsWith('.docx')) return loadRbDocx(file);
    var fr = new FileReader();
    fr.onload = function () {
      try { state.rbData = JSON.parse(fr.result); state.rbName = file.name; state.rbParseReport = null; update(); }
      catch (e) { alert('JSON error: ' + e.message); }
    };
    fr.readAsText(file);
  }

  function loadRbPdf(file) {
    var fr = new FileReader();
    fr.onload = function () {
      $('#report').innerHTML = '<li>' + (state.uiLang === 'ko' ? 'PDF 텍스트 추출 중…' : 'Extracting PDF text…') + '</li>';
      var lib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      lib.getDocument({ data: new Uint8Array(fr.result), useSystemFonts: true }).promise.then(function (doc) {
        var pages = [], chain = Promise.resolve();
        for (var n = 1; n <= doc.numPages; n++) {
          (function (pn) {
            chain = chain.then(function () {
              return doc.getPage(pn).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
                pages.push({ items: tc.items.map(function (i) { return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }; }) });
              });
            });
          })(n);
        }
        chain.then(function () {
          var parsed = RBPARSER.parsePdfPages(pages);
          parsed.title = file.name.replace(/\.pdf$/i, '');
          state.rbData = parsed; state.rbName = file.name + ' (PDF 자동 파싱 · 베타)';
          state.rbParseReport = parsed._report;
          update();
        });
      }).catch(function (e) { alert('PDF error: ' + e.message); });
    };
    fr.readAsArrayBuffer(file);
  }

  /* Word(.docx) → 문단 → 파서 */
  function loadRbDocx(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var files = ZIPREAD.readZip(new Uint8Array(fr.result), function (raw) { return window.pako.inflateRaw(raw); });
        var xml = files['word/document.xml'];
        if (!xml) throw new Error('word/document.xml not found');
        var paras = ZIPREAD.docxParagraphs(xml);
        var parsed = RBPARSER.parseDocxParagraphs(paras, true);
        parsed.title = file.name.replace(/\.docx$/i, '');
        state.rbData = parsed; state.rbName = file.name + ' (Word 자동 파싱 · 베타)';
        state.rbParseReport = null;
        update();
      } catch (e) { alert('DOCX error: ' + e.message); }
    };
    fr.readAsArrayBuffer(file);
  }

  /* 교정 저장소: {"1-2-3": {name, print, dots:[...]}} — 렌더 때마다 정규화 결과에 덮어쓴다 */
  function rbItemAt(id) {
    var p = id.split('-').map(Number);
    var ch = state.rbDoc.chapters[p[0] - 1];
    var s = ch && ch.sections[p[1] - 1];
    return s && s.items[p[2] - 1];
  }
  function applyRbFixes(doc) {
    var fixes = state.rbFixes || {};
    Object.keys(fixes).forEach(function (id) {
      var p = id.split('-').map(Number);
      var ch = doc.chapters[p[0] - 1], s = ch && ch.sections[p[1] - 1], it = s && s.items[p[2] - 1];
      if (!it) return;
      var fx = fixes[id];
      if (fx.name != null) it.name = fx.name;
      if (fx.print != null) it.print = fx.print;
      if (fx.dots) it.dots = fx.dots.slice();
      it._fixed = true;
    });
  }
  function openRbFix(id) {
    var it = rbItemAt(id); if (!it) return;
    state.rbFixId = id;
    var box = $('#rbFix');
    box.style.display = '';
    $('#rbFixTitle').textContent = (state.uiLang === 'ko' ? '항목 교정 — ' : 'Fix item — ') + id;
    $('#rbFixName').value = it.name || '';
    $('#rbFixPrint').value = it.print || '';
    $('#rbFixDots').value = (it.dots || []).join(', ');
    box.scrollIntoView({ block: 'nearest' });
  }
  function saveRbFix() {
    if (!state.rbFixId) return;
    var dots = $('#rbFixDots').value.split(',').map(function (s) {
      return s.trim().match(/[1-6]/g) ? s.trim().match(/[1-6]/g).join('-') : null;
    }).filter(Boolean);
    state.rbFixes = state.rbFixes || {};
    state.rbFixes[state.rbFixId] = { name: $('#rbFixName').value.trim(), print: $('#rbFixPrint').value.trim() || null, dots: dots };
    update();
  }
  function clearRbFix() {
    if (state.rbFixId && state.rbFixes) { delete state.rbFixes[state.rbFixId]; update(); }
  }

  /* 규정집 모드 렌더: HTML 문서를 iframe으로 미리보기 */
  function renderRulebook() {
    $('#ex-docx').style.display = '';
    $('#ex-ebrl').style.display = '';
    state.spec = null; state.layout = null; state.svg = '';
    $('#h-dims').style.display = 'none'; $('#dimForm').innerHTML = '';
    if (!state.rbData) {
      $('#preview').innerHTML = '<div class="hint" style="padding:30px">' + t('rbHint') + '</div>';
      $('#report').innerHTML = '<li>—</li>';
      return;
    }
    state.rbDoc = RULEBOOK.normalize(state.rbData, {});
    applyRbFixes(state.rbDoc);
    var html = RULEBOOK.renderHTML(state.rbDoc, (typeof window !== 'undefined' && window.RB_FONT) || '', false, true);
    $('#preview').innerHTML = '<iframe id="rbFrame" style="width:100%;height:74vh;border:none;background:#fff"></iframe>';
    var ifr = document.getElementById('rbFrame');
    ifr.srcdoc = html;
    ifr.addEventListener('load', function () {   // 항목 클릭 → 교정 패널 (1순위 피드백)
      var idoc = ifr.contentDocument;
      if (!idoc) return;
      idoc.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-rbid]') : null;
        if (!el) return;
        idoc.querySelectorAll('.rb-item.sel').forEach(function (x) { x.classList.remove('sel'); });
        el.classList.add('sel');
        openRbFix(el.getAttribute('data-rbid'));
      });
    });
    var d = state.rbDoc;
    var secs = d.chapters.reduce(function (a, c) { return a + c.sections.length; }, 0);
    var msgs = [
      (state.rbName ? t('rbLoaded') + state.rbName + ' · ' : '') + d.itemCount + ' items · ' + d.chapters.length + ' chapters · ' + secs + ' sections',
      state.uiLang === 'ko'
        ? 'DotPad 점자 흐름은 기본 좌→우(물리 점자 세계 표준) — 문서 표기 관례를 따르려면 "흐름 셀 우→좌"를 켜세요.'
        : 'DotPad braille flow defaults to left-to-right (physical braille standard) — enable "Flow cells R→L" to follow document convention.'
    ];
    var fixCount = Object.keys(state.rbFixes || {}).length;
    if (fixCount) msgs.push(state.uiLang === 'ko'
      ? '✏️ 수동 교정 ' + fixCount + '건 적용됨 (초록 배경 항목). "스펙 저장"으로 교정본 JSON을 보관하세요.'
      : '✏️ ' + fixCount + ' manual fixes applied (green items). Use "Save spec" to keep the corrected JSON.');
    if (state.rbParseReport) {
      var rp = state.rbParseReport;
      msgs.push(state.uiLang === 'ko'
        ? '⚠️ 자동 파싱(베타): ' + rp.pages + '쪽에서 항목 ' + rp.items + '개 추출, 그룹 순서 자동 교정 ' + (rp.flippedItems || 0) + '건. 점 번호가 중요한 문서이니 원본과 대조 검토 후 사용하세요. 검증된 JSON이 있다면 그쪽을 권장합니다.'
        : '⚠️ Auto-parse (beta): ' + rp.items + ' items from ' + rp.pages + ' pages, ' + (rp.flippedItems || 0) + ' group-order fixes. Review dots against the original before use; a verified JSON is preferred.');
    }
    if (dpConnected()) msgs.push(t('dpKeysRb'));
    $('#report').innerHTML = msgs.map(function (m) { return '<li>' + m + '</li>'; }).join('');
    dpSchedule();
  }

  function update() {
    if (state.tpl === RULEBOOK_TPL) { renderRulebook(); return; }
    $('#ex-docx').style.display = 'none';
    $('#ex-ebrl').style.display = 'none';
    $('#rbFix').style.display = 'none';
    if (!state.tpl && !state.loadedSpec) return;
    try {
      state.extraReport = [];
      applyParamVis();
      var textLang = state.brailleLang === 'ko' ? 'ko' : 'en';
      var spec;
      if (state.loadedSpec) {
        spec = JSON.parse(JSON.stringify(state.loadedSpec)); // 불러온 스펙 (깊은 복사)
      } else {
        spec = (state.tpl === TRACE_TPL)
          ? buildTraceSpec(readParams())
          : state.tpl.build(readParams(), textLang);
        // 시퀀스 템플릿의 build는 스펙이 아니라 페이지 배열을 준다 —
        // 첫 페이지를 미리보기로 보여주고 생성 버튼을 안내한다 (예전엔 배열을 렌더해 오류)
        if (state.tpl.sequence && Array.isArray(spec)) {
          state.extraReport.push(t('seqPreview').replace('{n}', spec.length));
          spec = spec.length ? JSON.parse(JSON.stringify(spec[0].spec)) : null;
        }
      }
      if (!spec) { $('#preview').innerHTML = ''; $('#report').innerHTML = '<li>' + (state.extraReport[0] || '') + '</li>'; return; }
      spec.brailleCode = state.brailleLang === 'nemeth' ? 'nemeth' : (state.brailleLang === 'ko' ? 'ko' : 'ueb');
      spec.canvas = Object.assign({}, spec.canvas, { paper: state.paper });   // 용지
      spec.inkText = state.inkMode === 'off' ? null : state.inkMode;          // 묵자 병기
      if (state.titleOverride && spec.title) spec.title.text = state.titleOverride;   // 제목 덮어쓰기
      var tOvr = $('#titleOvr');   // 템플릿 자체 제목 파라미터가 없을 때만 존재
      if (tOvr && spec.title && document.activeElement !== tOvr) tOvr.value = spec.title.text;
      // 치수 레이블 덮어쓰기(미터법 등) + 삭제(숨김) 적용 — 원본 인덱스 기준
      var di = 0;
      spec.elements = spec.elements.filter(function (e) {
        if (e.type !== 'dimension') return true;
        var idx = di++;
        if (state.dimHidden[idx]) return false;
        if (state.dimOverrides[idx] != null && state.dimOverrides[idx] !== '') e.label = state.dimOverrides[idx];
        e._dimIdx = idx;
        return true;
      });
      spec._tplDimCount = di;
      // 사용자 추가 치수 (두 점 클릭) — 가로/세로 자동 판별
      var bb = null;
      state.userDims.forEach(function (ud) {
        if (!bb) { // 요소 범위로 사이드 결정
          var xs = [], ys = [];
          spec.elements.forEach(function (e) {
            if (e.type === 'region') { xs.push(e.rect[0], e.rect[0] + e.rect[2]); ys.push(e.rect[1], e.rect[1] + e.rect[3]); }
            if (e.type === 'line') { xs.push(e.from[0], e.to[0]); ys.push(e.from[1], e.to[1]); }
            if (e.type === 'circle' || e.type === 'arc' || e.type === 'sector') { xs.push(e.at[0] - e.r, e.at[0] + e.r); ys.push(e.at[1] - e.r, e.at[1] + e.r); }
            if (e.type === 'polyline') e.points.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
          });
          bb = { cx: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 };
        }
        var dx = Math.abs(ud.to[0] - ud.from[0]), dy = Math.abs(ud.to[1] - ud.from[1]);
        var side;
        if (dy > dx) side = ((ud.from[0] + ud.to[0]) / 2 < bb.cx) ? 'left' : 'right';    // 세로 측정
        else side = ((ud.from[1] + ud.to[1]) / 2 < bb.cy) ? 'bottom' : 'top';            // 가로 측정
        spec.elements.push({ type: 'dimension', from: ud.from, to: ud.to, side: side, label: ud.label, _userIdx: state.userDims.indexOf(ud) });
      });
      // 템플릿 리드선: 문구 덮어쓰기 (미리보기에서 제자리 수정한 값)
      var lgi = 0;
      spec.elements.forEach(function (e) {
        if (e.type !== 'leader') return;
        var idx = lgi++;
        if (state.leaderOverrides[idx] != null) e.text = state.leaderOverrides[idx];
        e._leaderIdx = idx;
      });
      // 사용자 배치 레이블(리드선) 추가
      spec.elements = spec.elements.concat(state.labels.map(function (l, i) {
        return { type: 'leader', at: l.at, text: l.text, _userLabelIdx: i };
      }));
      state.spec = spec;
      draw();
      renderDimForm();
    } catch (e) { $('#report').textContent = 'Error: ' + e.message; }
  }

  /* 치수 커밋 (userDims/템플릿 오버라이드 공통) */
  function commitDim(d, label, skipUpdate) {
    if (d._userIdx != null) { if (state.userDims[d._userIdx]) state.userDims[d._userIdx].label = label; }
    else state.dimOverrides[d._dimIdx] = label;
    if (!skipUpdate) update();
  }
  function dimUnitGuess(dims) {
    for (var i = 0; i < dims.length; i++) { var p = parseDimLabel(dims[i].label); if (p && p.unit) return p.unit; }
    return '';
  }
  /* 치수 레이블 편집 폼: 단위는 문서 전체 일괄 선택(자동 환산), 수치는 행별 수정 */
  function renderDimForm() {
    var dims = state.spec.elements.filter(function (e) { return e.type === 'dimension'; });
    var head = $('#h-dims'), box = $('#dimForm');
    head.style.display = dims.length ? '' : 'none';
    if (!dims.length) { box.innerHTML = ''; return; }
    if (box.childElementCount === dims.length + 1) {
      // 개수가 같으면 행을 다시 만들지 않고 값만 동기화한다 (포커스 보존).
      // 예전엔 그냥 return이라, 파라미터로 치수가 바뀌어도 패널이 옛 값을 계속 보여줬다.
      dims.forEach(function (d, i) {
        var row = box.children[i + 1]; if (!row) return;
        var inp = row.querySelector('input');
        if (!inp || document.activeElement === inp) return;
        var parsed = parseDimLabel(d.label);
        var v = parsed ? String(parsed.val) : d.label;
        if (inp.value !== v) inp.value = v;
        var u = row.querySelector('.dunit');
        if (u) u.textContent = (parsed && parsed.unit) ? (state.uiLang === 'ko' ? unitOf(parsed.unit).ko : unitOf(parsed.unit).en) : '';
      });
      return;
    }
    box.innerHTML = '';
    // 단위 일괄 선택 — 치수마다 단위가 다를 일은 없으므로 한 번에 전체 변환
    var uRow = document.createElement('label'); uRow.className = 'frow';
    var uLab = document.createElement('span'); uLab.textContent = t('dimUnit'); uRow.appendChild(uLab);
    var uSel = document.createElement('select');
    var op0 = document.createElement('option'); op0.value = ''; op0.textContent = '—'; uSel.appendChild(op0);
    UNITS.forEach(function (u) {
      var op = document.createElement('option'); op.value = u.k;
      op.textContent = state.uiLang === 'ko' ? u.ko : u.en;
      uSel.appendChild(op);
    });
    uSel.value = state.dimUnit != null ? state.dimUnit : dimUnitGuess(dims);
    uSel.addEventListener('change', function () {
      state.dimUnit = uSel.value;
      var newU = uSel.value || null;
      dims.forEach(function (d) {
        var p = parseDimLabel(d.label);
        if (!p) return;                                  // 자유 문구는 건드리지 않음
        var v = p.val;
        if (p.unit && newU && p.unit !== newU) v = Math.round(v * unitOf(p.unit).f / unitOf(newU).f * 100) / 100;
        commitDim(d, fmtDim(v, newU), true);
      });
      box.innerHTML = '';                                // 행 재구성 (단위 표기 갱신)
      update();
    });
    uRow.appendChild(uSel); box.appendChild(uRow);
    dims.forEach(function (d, i) {
      var row = document.createElement('label'); row.className = 'frow';
      var s = document.createElement('span'); s.textContent = (i + 1) + '.'; row.appendChild(s);
      var parsed = parseDimLabel(d.label);
      var inp = document.createElement('input');
      if (parsed) {                       // 수치 + 단위 표기 (단위 변경은 위의 일괄 선택으로)
        inp.type = 'number'; inp.step = 'any'; inp.value = parsed.val;
        inp.style.width = '84px';
        var uTxt = document.createElement('span');
        uTxt.className = 'dunit';
        uTxt.style.cssText = 'color:#8a8378;font-size:12px;flex:1';
        uTxt.textContent = parsed.unit ? (state.uiLang === 'ko' ? unitOf(parsed.unit).ko : unitOf(parsed.unit).en) : '';
        inp.addEventListener('change', function () {
          var v = parseFloat(inp.value); if (isNaN(v)) return;
          commitDim(d, fmtDim(v, parsed.unit));
        });
        row.appendChild(inp); row.appendChild(uTxt);
      } else {                            // 자유 문구
        inp.type = 'text'; inp.value = d.label; inp.style.width = '150px';
        inp.addEventListener('change', function () { commitDim(d, inp.value); });
        row.appendChild(inp);
      }
      var del = document.createElement('button'); del.textContent = '✕';
      del.style.cssText = 'border:none;background:none;color:#c8265c;cursor:pointer';
      del.onclick = function (ev) {
        ev.preventDefault();
        if (d._userIdx != null) state.userDims.splice(d._userIdx, 1);
        else state.dimHidden[d._dimIdx] = true;
        update();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  /* 도면에서 치수/레이블 클릭 → 패널의 해당 행으로 포커스 (플로팅 입력 대신) */
  function flashRow(row) {
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    var inp = row.querySelector('input');
    if (inp) { inp.focus(); if (inp.select) inp.select(); }
    row.style.boxShadow = '0 0 0 2px rgba(200,38,92,.5)';
    setTimeout(function () { row.style.boxShadow = ''; }, 1200);
  }
  function focusDimRowSoft(el) {   // 하이라이트만 (포커스는 플로팅 입력이 가져간다)
    var dims = state.spec.elements.filter(function (e) { return e.type === 'dimension'; });
    var row = $('#dimForm').children[dims.indexOf(el) + 1];   // +1 = 단위 일괄 행
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    row.style.boxShadow = '0 0 0 2px rgba(200,38,92,.5)';
    setTimeout(function () { row.style.boxShadow = ''; }, 1200);
  }
  function focusLabelRow(i) { flashRow($('#labelList').children[i]); }
  function focusLabelRowSoft(i) {   // 하이라이트만 (포커스는 제자리 입력이 가져간다)
    var row = $('#labelList').children[i]; if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    row.style.boxShadow = '0 0 0 2px rgba(200,38,92,.5)';
    setTimeout(function () { row.style.boxShadow = ''; }, 1200);
  }

  function draw() {
    var r = TGIL.render(state.spec);
    state.svg = r.svg; state.layout = r.layout;
    $('#preview').innerHTML = r.svg;
    var svgEl = $('#preview svg');
    svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
    var msgs = state.extraReport.concat(r.report);
    msgs.push(t('printTip'));
    if (dpConnected()) msgs.push(t('dpKeys'));
    $('#report').innerHTML = msgs.length
      ? msgs.map(function (m) { return '<li>' + m + '</li>'; }).join('')
      : '<li>—</li>';
    $('#json').value = JSON.stringify(state.spec, null, 2);
    dpSchedule(); dpOverlay();
  }

  function applyJson() {
    try { state.spec = JSON.parse($('#json').value); draw(); }
    catch (e) { alert('JSON error: ' + e.message); }
  }

  /* ── 내보내기 ── */
  function download(name, content, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime || 'application/octet-stream' }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function fileBase() {
    return (state.spec && state.spec.title && state.spec.title.text || 'tactile-graphic')
      .toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
  }

  /* 내보내기용 SVG: 묵자 병기 '화면만' 모드면 인쇄물에서 묵자 제거 */
  function stripInk(svg) {
    if (state.inkMode === 'screen') return svg.replace(/<text class="inktxt".*?<\/text>/g, '');
    return svg;
  }
  function exportSvg() { return stripInk(state.svg); }
  /* 시퀀스 페이지 spec에 전역 설정(용지·묵자·점자코드) 적용 후 렌더 */
  function renderPageSpec(spec) {
    var s = JSON.parse(JSON.stringify(spec));
    s.canvas = Object.assign({}, s.canvas, { paper: state.paper });
    s.inkText = state.inkMode === 'off' ? null : state.inkMode;
    if (!s.brailleCode) s.brailleCode = state.brailleLang === 'nemeth' ? 'nemeth' : (state.brailleLang === 'ko' ? 'ko' : 'ueb');
    return stripInk(TGIL.render(s).svg);
  }

  function rbMode() { return state.tpl === RULEBOOK_TPL && state.rbDoc; }
  function rbChapters() {
    var r = readParams().dtmsRange || '1';
    return r === 'all' ? state.rbDoc.chapters : [state.rbDoc.chapters[+r - 1]].filter(Boolean);
  }
  function rbItems() {
    var out = [];
    rbChapters().forEach(function (ch, i) {
      ch.sections.forEach(function (s) { s.items.forEach(function (it) { if (it.dots && it.dots.length) out.push(it); }); });
    });
    return out;
  }
  function dtmsEnvelope(title, items) {
    return JSON.stringify({
      title: title, lang: 'arabic', lang_option: '2', device: 'dotpad320', audioPath: '',
      items: items.map(function (it, k) {
        return { page: k + 1, title: it.title, graphic: { name: (k + 1) + '.dtm', data: it.hex }, text: { name: (k + 1) + '.txt', data: '', plain: it.desc || '' }, audio: { fileName: '' } };
      })
    }, null, 1);
  }

  /* ── 문서 자신의 문자표(항목 print→dots)로 묵자를 점자로 전사 — BRF 맥락 병기·.ebrl용 ── */
  function rbCharMap() {
    var map = {};
    (state.rbDoc.chapters || []).forEach(function (ch) {
      ch.sections.forEach(function (s) {
        s.items.forEach(function (it) {
          if (!it.print || !it.dots || !it.dots.length) return;
          var p = String(it.print).trim();
          if (Array.from(p).length === 1 && !map[p]) map[p] = it.dots;
        });
      });
    });
    return map;
  }
  /* 전사율이 낮으면 null (엉터리 점자 방지). 반환: 셀별 점 배열, 공백 = [] */
  function rbTranscribe(text, map) {
    if (!text) return null;
    var cells = [], known = 0, unknown = 0;
    Array.from(String(text)).forEach(function (ch) {
      if (/\s/.test(ch)) { cells.push([]); return; }
      var dots = map[ch];
      if (dots) { known++; dots.forEach(function (ds) { cells.push(RULEBOOK.parseDots(ds)); }); }
      else unknown++;
    });
    if (!known || known < unknown) return null;
    while (cells.length && !cells[0].length) cells.shift();
    while (cells.length && !cells[cells.length - 1].length) cells.pop();
    return cells.length ? cells : null;
  }
  function rbBrailleStr(cells) {
    if (!cells) return null;
    return cells.map(function (c) { return c.length ? RULEBOOK.cellChar(c) : '⠀'; }).join('');
  }
  var BR_DIGITS = ['⠚', '⠁', '⠃', '⠉', '⠙', '⠑', '⠋', '⠛', '⠓', '⠊'];
  function rbNumBraille(n) {   // 수표(3-4-5-6) + 숫자
    return '⠼' + String(n).split('').map(function (c) { return BR_DIGITS[+c] || '⠀'; }).join('');
  }

  var EXPORT = {
    svg: function () {
      if (rbMode()) {   // 규정집 모드: 선택·복사 가능한 HTML 문서 다운로드
        download('braille-document.html', RULEBOOK.renderHTML(state.rbDoc, window.RB_FONT || '', true), 'text/html');
        return;
      }
      download(fileBase() + '.svg', exportSvg(), 'image/svg+xml');
    },
    docx: function () {
      if (!rbMode()) return;
      var bytes = DOCX.buildDocx(state.rbDoc, RULEBOOK);
      download('braille-document.docx', bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    },
    ebrl: function () {   // eBraille 1.0 — 점자 전용 전자문서 (피드백: BRF 소비자 미란)
      if (!rbMode() || typeof EBRL === 'undefined') return;
      var d = state.rbDoc, map = rbCharMap(), blocks = [];
      d.chapters.forEach(function (ch, ci) {
        var hb = rbBrailleStr(rbTranscribe(ch.title, map));
        blocks.push({ h: hb || rbNumBraille(ci + 1) });
        ch.sections.forEach(function (sec) {
          var sb = rbBrailleStr(rbTranscribe(sec.title, map));
          if (sb) blocks.push({ p: sb });
          sec.items.forEach(function (it) {
            if (!it.dots || !it.dots.length) return;
            var nb = rbBrailleStr(rbTranscribe(it.name || it.print || '', map));
            blocks.push({ p: (nb ? nb + '⠀' : '') + RULEBOOK.brailleText(it.dots) });
          });
        });
      });
      var bytes = EBRL.buildFromBraille(blocks, {
        title: d.title || 'braille document',
        titleBraille: rbBrailleStr(rbTranscribe(d.title, map)) || undefined
      });
      download('braille-document.ebrl', bytes, 'application/epub+zip');
    },
    json: function () {
      if (rbMode()) {   // 교정 반영된 정규화 문서를 저장 → 재업로드 시 100% 재현 (검증본 워크플로)
        var d = state.rbDoc;
        var out = { generic: true, title: d.title, front: d.front, sections: [] };
        d.chapters.forEach(function (ch) {
          ch.sections.forEach(function (s) { out.sections.push({ title: (ch.title ? ch.title + ' — ' : '') + (s.title || ''), items: s.items }); });
        });
        download('braille-document.verified.json', JSON.stringify(out, null, 1), 'application/json');
        return;
      }
      if (state.pages.length) {  // 시퀀스 전체 저장
        download(fileBase() + '.lesson.json', JSON.stringify({ tgilSequence: 1, pages: state.pages }, null, 2), 'application/json');
      } else {
        download(fileBase() + '.spec.json', JSON.stringify(state.spec, null, 2), 'application/json');
      }
    },
    pdf: function () {
      if (rbMode()) {   // 규정집: 폰트 내장 RTL 문서 인쇄 (점자 = 선택 가능한 텍스트)
        var wr = window.open('', '_blank');
        wr.document.write(RULEBOOK.renderHTML(state.rbDoc, window.RB_FONT || '', true));
        wr.document.close(); setTimeout(function () { wr.print(); }, 800);
        return;
      }
      var P = TGIL.PAPERS[state.paper] || TGIL.PROFILE.page;
      var body = state.pages.length
        ? state.pages.map(function (pg) { return '<div class="pg">' + renderPageSpec(pg.spec) + '</div>'; }).join('')
        : exportSvg();
      var w = window.open('', '_blank');
      w.document.write('<html><head><title>' + fileBase() + '</title><style>@page{size:' + P.w + 'mm ' + P.h + 'mm;margin:0}body{margin:0}svg{width:' + P.w + 'mm;height:' + P.h + 'mm}.pg{page-break-after:always}</style></head><body>' + body + '</body></html>');
      w.document.close(); setTimeout(function () { w.print(); }, 400);
    },
    brf: function () {
      if (rbMode()) {   // 규정집: 항목 이름·절 제목을 점자로 병기한 "읽는 문서형" BRF — 문서 전체 (피드백: 미란·하늘)
        var map2 = rbCharMap(), lines2 = [];
        state.rbDoc.chapters.forEach(function (ch2) {
          var tc = rbTranscribe(ch2.title, map2);
          if (tc) { lines2.push(tc); lines2.push([]); }
          ch2.sections.forEach(function (sec) {
            var sc = rbTranscribe(sec.title, map2);
            if (sc) { lines2.push([]); lines2.push(sc); }
            sec.items.forEach(function (it) {
              if (!it.dots || !it.dots.length) return;
              var name = rbTranscribe(it.name || it.print || '', map2);
              var cells = it.dots.map(RULEBOOK.parseDots);
              lines2.push(name ? name.concat([[]], cells) : cells);
            });
          });
        });
        download('braille-document.brf', EXPORTERS.makeBrf(lines2), 'text/plain');
        return;
      }
      var code = state.spec.brailleCode, lines = [];
      function specLines(spec) {
        if (spec.title) lines.push(TGIL.translate(spec.title.text, code));
        if (spec.textPage) String(spec.textPage).split('\n').forEach(function (l) { if (l.trim()) lines.push(TGIL.translate(l, code)); });
        (spec.key || []).forEach(function (kv) { lines.push(TGIL.translate(kv[0] + ': ' + kv[1], code)); });
        (spec.elements || []).forEach(function (e) {
          if (e.type === 'dimension') lines.push(TGIL.translate(e.label, code));
          if (e.type === 'leader') lines.push(TGIL.translate(e.text, code));
        });
        lines.push([]);
      }
      if (state.pages.length) state.pages.forEach(function (pg) {
        if (pg.desc) { lines.push(TGIL.translate(pg.title, code)); String(pg.desc).split('\n').forEach(function (l) { if (l.trim()) lines.push(TGIL.translate(l, code)); }); lines.push([]); }
        else specLines(pg.spec);
      });
      else specLines(state.spec);
      download(fileBase() + '.brf', EXPORTERS.makeBrf(lines), 'text/plain');
    },
    dtms: function () {
      if (rbMode()) {   // 규정집: 항목별 확대 화면 or 점자 흐름
        var p = readParams();
        var items = [];
        if (p.dtmsMode === 'braille-flow') {
          var grids = RULEBOOK.flowToGrids(rbItems().map(function (it) { return it.dots; }), !!p.flowRtl);
          grids.forEach(function (g, i) {
            items.push({ title: 'صفحة ' + (i + 1), hex: EXPORTERS.encodePage(g), desc: '' });
          });
        } else {
          rbItems().forEach(function (it) {
            items.push({
              title: it.name || it.print || '', hex: EXPORTERS.encodePage(RULEBOOK.itemToGrid(it.dots)),
              desc: (it.name || '') + (it.dots ? ' — النقاط: ' + RULEBOOK.dotsLabel(it.dots, false) : '') + ((it.notes || []).length ? ' — ' + it.notes.join(' ') : '')
            });
          });
        }
        download('braille-document.dtms', dtmsEnvelope('نظام برايل العربي المطور', items), 'application/json');
        return;
      }
      // 각 페이지: 도트 그리드(피치 2.4mm) → 크롭 → 한 화면이면 단일, 아니면 분할 → items 연결
      var P = TGIL.PAPERS[state.paper] || TGIL.PROFILE.page;
      var cols = Math.round(P.w / 2.4), rows = Math.round(P.h / 2.4);
      var SS = 4, cw = cols * SS, ch = rows * SS;
      function rasterize(svg, cb) {
        var img = new Image();
        img.onload = function () {
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          var grid = EXPORTERS.gridFromImageData(ctx.getImageData(0, 0, cw, ch).data, cw, ch, cols, rows);
          cb(EXPORTERS.fitOrSlice(grid));
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      }
      var queue = state.pages.length
        ? state.pages.map(function (pg) { return { title: pg.title, desc: pg.desc || '', svg: renderPageSpec(pg.spec) }; })
        : [{ title: state.spec.title ? state.spec.title.text : 'graphic', desc: '', svg: exportSvg() }];
      var items = [], qi = 0;
      (function next() {
        if (qi >= queue.length) {
          var docTitle = state.pages.length ? fileBase() : queue[0].title;
          var dtms = JSON.stringify({
            title: docTitle, lang: state.brailleLang === 'ko' ? 'korean' : 'english', lang_option: '2',
            device: 'dotpad320', audioPath: '',
            items: items.map(function (it, k) {
              return { page: k + 1, title: it.title, graphic: { name: (k + 1) + '.dtm', data: it.hex }, text: { name: (k + 1) + '.txt', data: '', plain: it.desc }, audio: { fileName: '' } };
            })
          }, null, 1);
          download(fileBase() + '.dtms', dtms, 'application/json');
          return;
        }
        var q = queue[qi++];
        rasterize(q.svg, function (vps) {
          vps.forEach(function (vp, vi) {
            items.push({
              title: q.title + (vps.length > 1 ? ' (' + vp.row + ',' + vp.col + ')' : ''),
              desc: q.desc, hex: EXPORTERS.encodePage(vp.grid)
            });
          });
          next();
        });
      })();
    }
  };

  /* ── DotPad 실시간 연동 (dotpad-dev 계약: 마이크로배치 → 완성 프레임만 push) ── */
  var dpNav = { idx: 0 };
  var _dpFlushT = null;
  var DP_W = 60, DP_H = 40, DP_AR = DP_W / DP_H;      // 그래픽 핀 60×40
  /* 배율은 "핀 1개가 맡는 페이지 길이(mm)" 기준.
   * DotPad 핀 간격 = 점자 도트 간격이므로, 점자 도트 1개 → 핀 1개(=1:1)일 때만 점자가 읽힌다.
   * 실기기 문제: 전체보기는 핀 하나가 4~7mm를 맡아 도트 2~3개가 한 핀에 뭉개져 판독 불가. */
  var DP_PIN = TGIL.PROFILE.braille.dotGap;           // 2.34mm — 1:1 기준
  var DP_SCALES = ['fit', 0.5, 1, 2];                 // 전체 · ½ · 1:1 · 2배
  var DP_DEFAULT_SCALE = 1;                           // 기본 = 1:1 (점자가 읽히는 유일한 배율)

  /* 기기 화면에 대응하는 페이지 영역(mm) */
  function dpViewport() {
    var pg = (state.layout && state.layout.page) || TGIL.PROFILE.page;
    var s = state.dpView.zoom, w, h;
    if (s === 'fit') {                                                // 전체보기: 비율 유지 레터박스
      if (pg.w / pg.h > DP_AR) { w = pg.w; h = pg.w / DP_AR; }
      else { h = pg.h; w = pg.h * DP_AR; }
    } else {                                                          // 실척 기준: 핀 1개 = DP_PIN/s mm
      w = DP_W * DP_PIN / s; h = DP_H * DP_PIN / s;
    }
    var cx = state.dpView.cx == null ? pg.w / 2 : state.dpView.cx;
    var cy = state.dpView.cy == null ? pg.h / 2 : state.dpView.cy;
    if (w < pg.w) cx = Math.max(w / 2, Math.min(pg.w - w / 2, cx)); else cx = pg.w / 2;
    if (h < pg.h) cy = Math.max(h / 2, Math.min(pg.h - h / 2, cy)); else cy = pg.h / 2;
    state.dpView.cx = cx; state.dpView.cy = cy;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h, page: pg };
  }
  /* 전체 페이지 SVG → 뷰포트만 잘라낸 SVG (viewBox 교체 = 벡터 그대로 확대, 계단현상 없음) */
  function svgCrop(svg, vp, wpx, hpx) {
    return svg.replace(/^\s*<svg[^>]*>/, function (tag) {
      return tag
        .replace(/\swidth="[^"]*"/, ' width="' + wpx + '"')
        .replace(/\sheight="[^"]*"/, ' height="' + hpx + '"')
        .replace(/\sviewBox="[^"]*"/, ' viewBox="' + f2(vp.x) + ' ' + f2(vp.y) + ' ' + f2(vp.w) + ' ' + f2(vp.h) + '"');
    });
  }
  function f2(n) { return Math.round(n * 100) / 100; }

  /* 미리보기 위에 기기 화면 범위 표시 */
  function dpOverlay() {
    var box = $('#dpVp');
    if (!box) {   // draw()가 #preview를 새로 그리면 사라지므로 없으면 다시 만든다
      box = document.createElement('div'); box.id = 'dpVp';
      $('#preview').appendChild(box);
    }
    var svg = $('#preview svg');
    var isText = state.spec && state.spec.textPage != null;
    if (!dpConnected() || !svg || !state.layout || rbMode() || isText) { box.style.display = 'none'; return; }
    var vp = dpViewport();
    var pr = $('#preview').getBoundingClientRect(), sr = svg.getBoundingClientRect();
    var sx = sr.width / vp.page.w, sy = sr.height / vp.page.h;
    box.style.display = 'block';
    box.style.left = Math.round(sr.left - pr.left + vp.x * sx) + 'px';
    box.style.top = Math.round(sr.top - pr.top + vp.y * sy) + 'px';
    box.style.width = Math.round(vp.w * sx) + 'px';
    box.style.height = Math.round(vp.h * sy) + 'px';
    box.textContent = 'DotPad 60×40  ' + dpScaleLabel() + (dpBrailleLegible() ? '' : '  ' + t('dpNoBrl'));
    box.classList.toggle('warn', !dpBrailleLegible());
  }
  function dpScaleLabel() {
    var s = state.dpView.zoom;
    return s === 'fit' ? t('dpFit') : (s === 1 ? t('dpOneToOne') : (s < 1 ? '½' : s + '×'));
  }
  /* 점자 판독 가능 여부: 핀 1개가 맡는 mm가 점자 도트 간격 이하일 때만 도트가 핀에 1:1로 떨어진다 */
  function dpMmPerPin() { var vp = dpViewport(); return vp.w / DP_W; }
  function dpBrailleLegible() { return dpMmPerPin() <= DP_PIN * 1.05; }
  function dpConnect() {
    var B = window.DOTPAD && DOTPAD.BLE;
    if (!B) return;
    B.onStatus = dpStatus; B.onKeyNav = dpKey;
    B.addDevice();
  }
  function dpMsg(txt) {   // 인라인 상태 표시 — 샌드박스 미리보기에선 alert가 막히므로 alert에 의존하지 않는다
    var el = $('#dpMsg'); if (!el) return;
    el.style.display = txt ? '' : 'none';
    el.textContent = txt || '';
  }
  function dpStatus(s) {
    if (s && s.error === 'no-bluetooth') dpMsg(t('dpNoBt'));
    else if (s && s.error === 'no-sdk') dpMsg(t('dpNoSdk'));
    else if (s && s.error === 'connect') dpMsg(t('dpFail').replace('{e}', s.detail ? ': ' + s.detail : ''));
    else if (s && s.error === 'reconnect') dpMsg(t('dpReconnFail'));
    else if (s && s.askSdk) dpMsg(t('dpPickSdk'));
    else if (s && s.reconnecting) dpMsg(t('dpReconn').replace('{n}', s.reconnecting));
    else if (s && s.lost) dpMsg(t('dpLost'));
    dpChrome(); dpDiag();
    if (s && s.repaint) { dpSchedule(true); return; }   // BoardInfo 수신 → 화면 다시 그리기
    if (s && s.connected != null) {
      if (s.connected > 0) dpMsg(null);       // 성공 → 안내 제거
      update();                                // 리포트에 키 안내 반영 + 현재 화면 push (update가 dpSchedule 호출)
    }
  }
  function dpChrome() {
    var B = window.DOTPAD && DOTPAD.BLE;
    var n = B ? B.readyCount() : 0;
    var btn = $('#dpBtn'); if (!btn) return;
    btn.textContent = n ? t('dpConnected').replace('{n}', n) : t('dpBtn');
    btn.classList.toggle('on', n > 0);
    btn.title = n ? t('dpAddTip') : '';
    $('#dpOff').style.display = n ? '' : 'none';
    dpOverlay();
  }
  function dpConnected() { return window.DOTPAD && DOTPAD.BLE.connected; }
  /* 렌더(clear→draw)가 같은 턴에서 끝난 뒤 완성 프레임만 push — 빈 프레임 전송 방지.
   * + 편집 중에는 조용해질 때까지 기다린다: 타이핑·드래그마다 기기로 쏘면 핀이 쉬지 않고
   *   움직이고 BLE 트래픽이 계속 이어져 연결이 불안해진다. 기기 키 조작은 짧게 반응. */
  function dpSchedule(fast) {
    if (!dpConnected()) return;
    if (_dpFlushT != null) clearTimeout(_dpFlushT);
    _dpFlushT = setTimeout(function () {
      _dpFlushT = null;
      if (dpConnected()) dpPushFrame();
    }, fast ? 60 : 450);
  }
  /* 점자 텍스트 페이지 → 기기 점자 흐름 (20셀 × 10줄, 셀 전진 3핀·행 전진 4핀).
   * 도면처럼 래스터라이즈하면 본문 점자가 제거돼 제목만 나간다 — 텍스트는 셀로 찍어야 읽힌다. */
  function dpTextPages() {
    var sp = state.spec;
    if (!sp || sp.textPage == null) return null;
    var code = sp.brailleCode || 'ueb', lines = [], src = [];
    if (sp.title && sp.title.text) { src.push(sp.title.text); src.push(''); }
    String(sp.textPage || '').split('\n').forEach(function (l) { src.push(l); });
    src.forEach(function (para) {
      if (!String(para).trim()) { lines.push([]); return; }
      var cur = [];
      String(para).split(/\s+/).forEach(function (w) {
        var wc;
        try { wc = TGIL.translate(w, code); } catch (e) { wc = []; }
        if (!wc.length) return;
        if (cur.length && cur.length + 1 + wc.length > 20) { lines.push(cur); cur = []; }
        if (cur.length) cur.push([]);                       // 단어 사이 빈 셀
        wc.forEach(function (c) { if (cur.length < 20) cur.push(c); });
      });
      if (cur.length) lines.push(cur);
    });
    var pages = [];
    for (var i = 0; i < lines.length; i += 10) {
      var g = [];
      for (var y = 0; y < DP_H; y++) g.push(new Array(DP_W).fill(0));
      lines.slice(i, i + 10).forEach(function (line, li) {
        line.forEach(function (cell, ci) {
          (cell || []).forEach(function (d) {
            var col = d >= 4 ? 1 : 0, row = (d - 1) % 3;
            var px = ci * 3 + col, py = li * 4 + row;
            if (px < DP_W && py < DP_H) g[py][px] = 1;
          });
        });
      });
      pages.push(g);
    }
    return pages.length ? pages : null;
  }

  function dpPushFrame() {
    var B = DOTPAD.BLE;
    var tp = dpTextPages();
    if (tp) {                             // 텍스트 페이지: 점자 흐름 (팬 키로 쪽 넘김)
      dpNav.idx = Math.max(0, Math.min(dpNav.idx, tp.length - 1));
      B.push(DOTPAD.encodeRows(tp[dpNav.idx]), null);
      dpOverlay();
      return;
    }
    if (rbMode()) {                       // 규정집: 항목 확대 화면 + 텍스트 라인에 표준 점자
      var items = rbItems();
      if (!items.length) return;
      dpNav.idx = Math.max(0, Math.min(dpNav.idx, items.length - 1));
      var it = items[dpNav.idx];
      B.push(DOTPAD.encodeRows(RULEBOOK.itemToGrid(it.dots)),
             DOTPAD.textLineHex(it.dots.map(RULEBOOK.parseDots)));
      dpOverlay();
      return;
    }
    if (!state.svg) return;               // 도면: 뷰포트 영역만 잘라 60×40으로
    var svg = state.svg, vp = dpViewport();
    dpRasterize(svg, vp, function (grid) {
      if (!dpConnected() || state.svg !== svg) return;   // 뒤늦은 프레임 폐기
      B.push(DOTPAD.encodeRows(grid), dpTextHex(vp));
      dpDiag();
    });
    dpOverlay();
  }
  /* 텍스트 라인: 기본은 제목, 확대 중이면 배율·현재 칸 위치 (촉각 사용자용 현재 위치 안내) */
  function dpTextHex(vp) {
    try {
      var code = (state.spec && state.spec.brailleCode) || 'ueb', txt;
      if (state.dpView.zoom !== "fit") {
        var col = Math.floor(vp.x / vp.w + 0.5) + 1, row = Math.floor(vp.y / vp.h + 0.5) + 1;
        var cols = Math.max(1, Math.ceil(vp.page.w / vp.w)), rows = Math.max(1, Math.ceil(vp.page.h / vp.h));
        txt = row + "-" + col + "/" + rows + "-" + cols;
      } else {
        txt = state.spec && state.spec.title && state.spec.title.text;
      }
      return txt ? DOTPAD.textLineHex(TGIL.translate(txt, code).slice(0, 20)) : null;
    } catch (e) { return null; }
  }
  /* 기기용 SVG를 두 층으로 분리한다.
   * - 점자: 래스터라이즈하면 도트가 핀 경계에 번져 붙으므로 제거 후 stampBraille이 직접 찍는다
   * - 묵자: 눈으로 보는 글자라 핀으로는 잡음
   * - 'fill' 층: 빗금 텍스처(url(#tx-…))를 solid로 → 기기에서 "채워진 면"은 핀이 다 솟는다
   * - 'line' 층: 선·점 심볼
   * 두 층을 XOR하면 채운 면 안의 구분선이 홈이 된다 — 솟은 면 위의 솟은 선은 손으로 못 느끼므로
   * 구분선은 반드시 내려가 있어야 칸이 세어진다(실기기 피드백). */
  var DEV_TAG = /<(rect|circle|ellipse|line|polyline|polygon|path)\b[^>]*\/>/g;
  function deviceLayer(svg, want, minStrokeMm) {
    return svg
      .replace(/<g fill="#000">[\s\S]*?<\/g>/g, '')          // 점자
      .replace(/<text class="inktxt"[\s\S]*?<\/text>/g, '')  // 묵자
      .replace(DEV_TAG, function (tag) {
        if (/width="100%"/.test(tag)) return tag;            // 배경
        var isTexture = /fill="url\(#/.test(tag);
        if (want === 'fill') return isTexture ? tag.replace(/fill="url\(#[^"]*\)"/, 'fill="#000"') : '';
        if (isTexture) return '';
        if (!/stroke="#000"/.test(tag) && !/fill="#000"/.test(tag)) return '';
        // 종이용 얇은 선(1mm 등)은 핀 격자에서 사라진다 — 기기에서는 최소 1핀 굵기로
        return tag.replace(/stroke-width="([\d.]+)"/, function (m, w) {
          return 'stroke-width="' + Math.max(parseFloat(w), minStrokeMm || 0) + '"';
        });
      });
  }
  /* 점자를 기기 핀 격자에 직접 찍는다 — 셀 전진 3핀, 도트 간격 1핀 (기기 점자 규격) */
  function dpLabels() {
    var out = [];
    (state.spec && state.spec.elements || []).forEach(function (e) {
      // label(축 눈금 등)도 포함 — 수학 템플릿의 점자가 기기에서 통째로 빠지던 원인
      if ((e.type === 'dimension' || e.type === 'leader' || e.type === 'label') &&
          e._labelMm && e._cells && e._cells.length)
        out.push({ cells: e._cells, at: e._labelMm });
    });
    var L = state.layout;
    if (L && L.titleBox && state.spec && state.spec.title && state.spec.title.text) {
      try {
        out.push({
          cells: TGIL.translate(state.spec.title.text, state.spec.brailleCode || 'ueb'),
          at: [L.titleBox.cx, L.titleBox.y0 + L.titleBox.h / 2]
        });
      } catch (err) {}
    }
    return out;
  }
  function stampBraille(grid, vp) {
    var pxmm = DP_W / vp.w, pymm = DP_H / vp.h;
    dpLabels().forEach(function (lb) {
      var wPins = lb.cells.length * 3 - 1;
      var x0 = Math.round((lb.at[0] - vp.x) * pxmm - wPins / 2);
      var y0 = Math.round((lb.at[1] - vp.y) * pymm - 1);      // 3핀 높이의 중앙
      if (x0 + wPins < 0 || x0 >= DP_W || y0 + 3 < 0 || y0 >= DP_H) return;   // 화면 밖
      for (var cy = y0 - 1; cy <= y0 + 3; cy++)               // 점자 주변 여백 확보 (선과 겹침 방지)
        for (var cx = x0 - 1; cx <= x0 + wPins + 1; cx++)
          if (cy >= 0 && cy < DP_H && cx >= 0 && cx < DP_W) grid[cy][cx] = 0;
      lb.cells.forEach(function (cell, ci) {
        cell.forEach(function (d) {
          var col = d >= 4 ? 1 : 0, row = (d - 1) % 3;
          var px = x0 + ci * 3 + col, py = y0 + row;
          if (px >= 0 && px < DP_W && py >= 0 && py < DP_H) grid[py][px] = 1;
        });
      });
    });
  }
  function rasterLayer(src, cw, chh, cb) {
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, chh);
      ctx.drawImage(img, 0, 0, cw, chh);
      cb(EXPORTERS.gridFromImageData(ctx.getImageData(0, 0, cw, chh).data, cw, chh, DP_W, DP_H));
    };
    img.onerror = function () { cb(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  }
  function dpRasterize(svg, vp, cb) {
    var SS = 4, cw = DP_W * SS, chh = DP_H * SS;
    var minStroke = vp.w / DP_W;                      // 1핀에 해당하는 mm
    rasterLayer(svgCrop(deviceLayer(svg, 'fill'), vp, cw, chh), cw, chh, function (fg) {
      rasterLayer(svgCrop(deviceLayer(svg, 'line', minStroke), vp, cw, chh), cw, chh, function (lg) {
        var grid = [];
        for (var y = 0; y < DP_H; y++) {
          var row = new Array(DP_W);
          for (var x = 0; x < DP_W; x++) {
            var f = fg && fg[y] ? fg[y][x] : 0, l = lg && lg[y] ? lg[y][x] : 0;
            row[x] = (f ^ l) ? 1 : 0;      // 채운 면 위의 선 = 홈, 빈 배경 위의 선 = 솟음
          }
          grid.push(row);
        }
        if (dpBrailleLegible()) stampBraille(grid, vp);   // 판독 가능한 배율에서만 점자를 얹는다
        cb(grid);
      });
    });
  }
  function dpZoomBy(d) {
    var i = DP_SCALES.indexOf(state.dpView.zoom);
    if (i < 0) i = DP_SCALES.indexOf(DP_DEFAULT_SCALE);
    var n = Math.max(0, Math.min(DP_SCALES.length - 1, i + d));
    if (n === i) return;
    state.dpView.zoom = DP_SCALES[n];
    dpSchedule(true); dpOverlay(); dpReport();
  }
  /* 연결 진단: 실기기에서 문제가 생겼을 때 추측 대신 근거를 남긴다 */
  var _diagT = null;
  function dpDiag() {
    var el = $('#dpDiag'); if (!el) return;
    var B = window.DOTPAD && DOTPAD.BLE;
    if (!B || !B.connected) {
      el.style.display = 'none';
      if (_diagT) { clearInterval(_diagT); _diagT = null; }
      return;
    }
    if (!_diagT) _diagT = setInterval(dpDiag, 1000);   // 연결 중에는 실시간 갱신
    var s = B.stats;
    el.style.display = '';
    el.textContent = t('dpDiag')
      .replace('{sent}', s.sent).replace('{ka}', B.inflightTotal ? B.inflightTotal() : 0).replace('{ack}', s.ack)
      .replace('{err}', s.err).replace('{lost}', s.lost);
  }
  /* 점자가 뭉개지는 배율이면 제작자에게 경고 (산출물 사용자는 못 보는 문제라 화면에서 알려야 한다) */
  function dpReport() {
    var li = $('#dpWarn');
    if (!li) { li = document.createElement('li'); li.id = 'dpWarn'; }
    if (dpConnected() && !rbMode() && !dpBrailleLegible()) {
      li.textContent = t('dpBrlWarn').replace('{mm}', (Math.round(dpMmPerPin() * 10) / 10));
      li.style.color = '#a05a00';
      if (!li.parentNode) $('#report').appendChild(li);
    } else if (li.parentNode) li.parentNode.removeChild(li);
  }
  function dpPan(dx, dy) {
    var vp = dpViewport();
    state.dpView.cx = vp.x + vp.w / 2 + dx * vp.w * 0.5;   // 반 화면씩 (맥락 유지)
    state.dpView.cy = vp.y + vp.h / 2 + dy * vp.h * 0.5;
    dpSchedule(true); dpOverlay();
  }
  /* 키 배치 — 도면: 팬 좌/우 = 좌우 이동(확대 없으면 이전/다음 페이지), F1/F2 = 위/아래, F3/F4 = 축소/확대
   *          규정집: 팬 좌/우 = 이전/다음 항목, F1 = 재전송, F2 = 처음, F3/F4 = 10개 이전/다음 */
  function dpKey(key) {
    if (state.spec && state.spec.textPage != null) {      // 텍스트 페이지: 팬 키로 쪽 넘김
      if (key === 'PanningRight') dpNav.idx++;
      else if (key === 'PanningLeft') dpNav.idx--;
      else if (key === 'KeyFunction1') DOTPAD.BLE.devs.forEach(function (e) { e.lastSent = []; });
      dpNav.idx = Math.max(0, dpNav.idx);
      dpSchedule(true);
      return;
    }
    if (rbMode()) {
      var n = rbItems().length;
      if (key === 'PanningRight') dpNav.idx++;
      else if (key === 'PanningLeft') dpNav.idx--;
      else if (key === 'KeyFunction2') dpNav.idx = 0;
      else if (key === 'KeyFunction3') dpNav.idx -= 10;
      else if (key === 'KeyFunction4') dpNav.idx += 10;
      else if (key === 'KeyFunction1') DOTPAD.BLE.devs.forEach(function (e) { e.lastSent = []; e.lastText = null; });
      dpNav.idx = Math.max(0, Math.min(dpNav.idx, Math.max(0, n - 1)));
      dpSchedule(true);
      return;
    }
    // 방향키: F1 왼쪽 · F2 위 · F3 아래 · F4 오른쪽 (키 물리 배치와 방향 일치)
    if (key === 'KeyFunction1') { dpPan(-1, 0); return; }
    if (key === 'KeyFunction2') { dpPan(0, -1); return; }
    if (key === 'KeyFunction3') { dpPan(0, 1); return; }
    if (key === 'KeyFunction4') { dpPan(1, 0); return; }
    // 조합키(SDK가 단일 이벤트로 보고): 좌패닝+F1 = 축소, 우패닝+F4 = 확대
    if (key === 'LPF1') { dpCancelPan(); dpZoomBy(-1); return; }
    if (key === 'RPF4') { dpCancelPan(); dpZoomBy(1); return; }
    // 패닝 단독: 이전/다음 페이지 (조합키의 앞부분일 수 있어 잠깐 뒤에 실행)
    if (key === 'PanningLeft' || key === 'PanningRight') {
      var d = key === 'PanningRight' ? 1 : -1;
      if (!state.pages.length) return;
      dpCancelPan();
      _dpPanT = setTimeout(function () {
        _dpPanT = null;
        var i = (state.editingPage == null ? (d > 0 ? -1 : state.pages.length) : state.editingPage) + d;
        if (i >= 0 && i < state.pages.length) openPage(i);
      }, 350);
    }
  }
  var _dpPanT = null;
  function dpCancelPan() { if (_dpPanT) { clearTimeout(_dpPanT); _dpPanT = null; } }

  /* 검증 훅 (시뮬레이터 하네스에서 뷰포트를 직접 지정해 기기 출력 점형을 비교한다) */
  if (typeof window !== 'undefined') {
    window.__setView = function (scale, cx, cy) {
      state.dpView = { zoom: scale, cx: cx, cy: cy };
      dpSchedule(true); dpOverlay(); dpReport();
    };
    window.__dpInfo = function () {
      return { scale: state.dpView.zoom, mmPerPin: dpMmPerPin(), legible: dpBrailleLegible(), vp: dpViewport() };
    };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
