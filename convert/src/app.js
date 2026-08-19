/* DOT Convert 프로토타입 — 업로드 → 분석 → 견적(크레딧) → AI 변환 데모 (전부 브라우저 안)
 * 단가: 원가검토 노트 (기본 $0.6/페이지 · AI 객체 $0.6/객체 · 프리미엄 $30/객체 · 검수 견적) */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var PRICE = { page: 0.6, obj: 0.6, prem: 30, credit: 0.10, krw: 1350 };  // 1크레딧=$0.10, 환율 표기용
  var S = { file: null, pages: 0, words: 0, objs: 0, scanned: false, text: '', credits: 5000, paid: false };

  /* ── 업로드 ── */
  var drop = $('#drop'), inp = $('#fileInp');
  drop.addEventListener('click', function () { inp.click(); });
  ['dragover', 'dragenter'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    drop.addEventListener(ev, function () { drop.classList.remove('on'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('on');
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  inp.addEventListener('change', function () { if (inp.files[0]) handleFile(inp.files[0]); });

  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function num(n) { return n.toLocaleString('en-US'); }

  function handleFile(f) {
    var lower = f.name.toLowerCase();
    if (!/\.(pdf|docx)$/.test(lower)) { alert('PDF 또는 Word(.docx) 파일을 올려주세요.'); return; }
    S.file = f; S.paid = false;
    $('#fic').textContent = lower.endsWith('.pdf') ? 'PDF' : 'DOCX';
    $('#fn').textContent = f.name;
    $('#fs').textContent = fmtSize(f.size);
    $('#work').style.display = 'grid';
    $('#result').style.display = 'none';
    $('#stage').style.display = 'none';
    ['#stPages', '#stWords', '#stObjs', '#stKind'].forEach(function (id) { $(id).textContent = '…'; });
    $('#anNote').textContent = '분석 중…';
    $('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (lower.endsWith('.pdf')) analyzePdf(f); else analyzeDocx(f);
  }

  /* ── PDF 분석: 페이지 수 + 텍스트 + 이미지 객체 수 ── */
  function analyzePdf(f) {
    var fr = new FileReader();
    fr.onload = function () {
      var lib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      lib.getDocument({ data: new Uint8Array(fr.result), useSystemFonts: true }).promise.then(function (doc) {
        var OPS = lib.OPS, text = [], objs = 0, chain = Promise.resolve();
        for (var n = 1; n <= doc.numPages; n++) (function (pn) {
          chain = chain.then(function () {
            return doc.getPage(pn).then(function (pg) {
              return Promise.all([pg.getTextContent(), pg.getOperatorList()]).then(function (r) {
                text.push(r[0].items.map(function (i) { return i.str; }).join(' '));
                r[1].fnArray.forEach(function (fn) {
                  if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject ||
                      fn === OPS.paintJpegXObject || fn === OPS.paintImageMaskXObject) objs++;
                });
              });
            });
          });
        })(n);
        chain.then(function () {
          var full = text.join('\n\n').replace(/\s+\n/g, '\n').trim();
          finishAnalysis(doc.numPages, full, objs);
        });
      }).catch(function (e) { $('#anNote').textContent = 'PDF 분석 실패: ' + e.message; });
    };
    fr.readAsArrayBuffer(f);
  }

  /* ── DOCX 분석: 문단 텍스트 + 이미지 수 (media 파일) + 페이지 추정 ── */
  function analyzeDocx(f) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var files = ZIPREAD.readZip(new Uint8Array(fr.result), function (raw) { return window.pako.inflateRaw(raw); });
        var xml = files['word/document.xml'];
        if (!xml) throw new Error('word/document.xml 없음');
        var paras = ZIPREAD.docxParagraphs(xml);
        var full = paras.join('\n').trim();
        var objs = Object.keys(files).filter(function (k) { return /^word\/media\//.test(k); }).length;
        var words = full.split(/\s+/).filter(Boolean).length;
        var pages = Math.max(1, Math.ceil(words / 400));          // 400단어/쪽 추정 (docx는 페이지 개념이 유동)
        finishAnalysis(pages, full, objs, true);
      } catch (e) { $('#anNote').textContent = 'DOCX 분석 실패: ' + e.message; }
    };
    fr.readAsArrayBuffer(f);
  }

  function finishAnalysis(pages, text, objs, estimated) {
    S.pages = pages; S.text = text; S.objs = objs;
    S.words = text.split(/\s+/).filter(Boolean).length;
    S.scanned = S.words < pages * 15;                              // 텍스트가 거의 없으면 스캔본
    $('#stPages').textContent = num(pages) + (estimated ? '±' : '');
    $('#stWords').textContent = num(S.words);
    $('#stObjs').textContent = num(objs);
    $('#stKind').textContent = S.scanned ? '스캔본' : '텍스트 기반';
    var note = $('#anNote');
    if (S.scanned) {
      note.className = 'note warn';
      note.textContent = '추출 가능한 텍스트가 거의 없습니다 — 스캔본으로 판단되어 실서비스에서는 OCR 단계가 자동으로 붙습니다 (요금 동일). 데모 변환은 추출된 텍스트만 사용합니다.';
    } else {
      note.className = 'note';
      note.textContent = '텍스트 기반 문서입니다. 객체 수는 문서에 포함된 이미지 기준이며, 실서비스에서는 도형·수식도 객체로 집계됩니다.';
    }
    $('#pCnt').textContent = '0';
    quote();
  }

  /* ── 견적 ── */
  function cred(usd) { return Math.round(usd / PRICE.credit); }
  function quote() {
    var base = S.pages * PRICE.page;
    var objOn = $('#optObj').checked && S.objs > 0;
    var obj = objOn ? S.objs * PRICE.obj : 0;
    var pn = parseInt($('#pCnt').textContent, 10) || 0;
    var prem = pn * PRICE.prem;
    $('#qBaseD').textContent = num(S.pages) + '페이지 × $' + PRICE.page + ' · WCAG 문서 + 점자';
    $('#qBase').innerHTML = num(cred(base)) + ' 크레딧<small>$' + base.toFixed(1) + '</small>';
    $('#qObj').innerHTML = objOn ? num(cred(obj)) + ' 크레딧<small>' + num(S.objs) + '객체 · $' + obj.toFixed(1) + '</small>' : '—';
    $('#rowObj').classList.toggle('off', !objOn);
    $('#qPrem').innerHTML = pn ? num(cred(prem)) + ' 크레딧<small>$' + prem.toFixed(0) + '</small>' : '—';
    $('#rowPrem').classList.toggle('off', !pn);
    var total = base + obj + prem;
    $('#tCred').textContent = num(cred(total));
    $('#tUsd').textContent = '크레딧 · $' + total.toFixed(1) + ' ≈ ₩' + num(Math.round(total * PRICE.krw)) +
      ($('#optRev').checked ? ' + 검수 견적 별도' : '');
    var short = cred(total) > S.credits;
    $('#goBtn').disabled = short;
    $('#goBtn').textContent = short ? '크레딧이 부족합니다 (데모 잔액 ' + num(S.credits) + ')' : num(cred(total)) + ' 크레딧으로 변환 시작';
    S._total = total;
  }
  $('#optObj').addEventListener('change', quote);
  $('#optRev').addEventListener('change', quote);
  $('#pPlus').addEventListener('click', function () {
    var n = parseInt($('#pCnt').textContent, 10) || 0;
    if (n < Math.max(S.objs, 0)) { $('#pCnt').textContent = n + 1; quote(); }
  });
  $('#pMinus').addEventListener('click', function () {
    var n = parseInt($('#pCnt').textContent, 10) || 0;
    if (n > 0) { $('#pCnt').textContent = n - 1; quote(); }
  });
  $('#resetBtn').addEventListener('click', function () {
    $('#work').style.display = 'none'; $('#result').style.display = 'none'; $('#stage').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── 변환 (데모: 실제로 점역·문서 생성) ── */
  $('#goBtn').addEventListener('click', function () {
    if (S.paid) { $('#result').scrollIntoView({ behavior: 'smooth' }); return; }
    S.credits -= cred(S._total); S.paid = true;
    $('#creditBal').textContent = num(S.credits);
    $('#stage').style.display = 'block';
    $('#result').style.display = 'none';
    var steps = [
      [12, '문서 구조 분석 중…'],
      [34, '텍스트 정규화·헤딩 감지…'],
      [58, $('#optObj').checked ? '객체 대체텍스트 생성 중…' : '접근성 구조 생성 중…'],
      [80, '점자 변환 중 (' + (isKorean() ? '한국 점자' : 'UEB Grade 2') + ')…'],
      [100, '검증·패키징…']
    ];
    var i = 0;
    var tick = function () {
      if (i < steps.length) {
        $('#progB').style.width = steps[i][0] + '%';
        $('#progT').textContent = steps[i][1];
        i++; setTimeout(tick, 420);
      } else {
        $('#stage').style.display = 'none';
        renderResult();
      }
    };
    tick();
  });

  function isKorean() { return /[가-힣]/.test(S.text); }

  function renderResult() {
    var paras = S.text.split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!paras.length) paras = ['(추출된 텍스트가 없습니다 — 스캔본은 실서비스에서 OCR 후 변환됩니다.)'];
    // 접근성 문서 미리보기: 첫 문단을 제목으로, 객체 자리 표시
    var doc = ['<h4>' + esc(paras[0]).slice(0, 120) + '</h4>'];
    paras.slice(1, 7).forEach(function (p) { doc.push('<p>' + esc(p).slice(0, 300) + '</p>'); });
    if (S.objs > 0) doc.splice(2, 0, '<div class="obj">🖼 객체 1/' + num(S.objs) + ' — ' +
      ($('#optObj').checked ? 'AI 대체텍스트 + 촉각 그래픽 생성됨' : 'AI 객체 변환 미선택 (원본 유지)') + '</div>');
    if (paras.length > 7) doc.push('<p style="color:var(--dim)">… 외 ' + num(paras.length - 7) + '개 문단 (전체는 내려받기)</p>');
    $('#prevDoc').innerHTML = doc.join('');

    // 점자 미리보기 (실제 점역 — 유니코드 점자)
    var code = isKorean() ? 'ko' : 'en';
    $('#brlCode').textContent = code === 'ko' ? '— 한국 점자' : '— UEB Grade 2';
    var sample = paras.join(' ').slice(0, 220);
    var uni = '';
    try {
      TGIL.translate(sample, code).forEach(function (cell) {
        var v = 0; cell.forEach(function (d) { v |= 1 << (d - 1); });
        uni += String.fromCharCode(0x2800 + v);
      });
    } catch (e) { uni = '(점역 실패: ' + e.message + ')'; }
    $('#prevBrl').textContent = uni || '(내용 없음)';
    $('#result').style.display = 'grid';
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function download(name, content, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function base() { return (S.file ? S.file.name.replace(/\.(pdf|docx)$/i, '') : 'document'); }

  $('#dlHtml').addEventListener('click', function () {
    var paras = S.text.split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    var body = paras.map(function (p, i) { return i === 0 ? '<h1>' + esc(p) + '</h1>' : '<p>' + esc(p) + '</p>'; }).join('\n');
    download(base() + '-accessible.html',
      '<!doctype html><html lang="' + (isKorean() ? 'ko' : 'en') + '"><head><meta charset="utf-8">' +
      '<title>' + esc(base()) + '</title><meta name="generator" content="DOT Convert prototype"></head>' +
      '<body>\n<main>\n' + body + '\n</main>\n</body></html>', 'text/html');
  });
  $('#dlBrf').addEventListener('click', function () {
    var code = isKorean() ? 'ko' : 'en';
    var lines = [];
    S.text.split(/\n+/).forEach(function (p) {
      p = p.trim(); if (!p) return;
      try { lines.push(TGIL.translate(p, code)); } catch (e) {}
    });
    if (!lines.length) { alert('점역할 텍스트가 없습니다.'); return; }
    download(base() + '.brf', EXPORTERS.makeBrf(lines), 'text/plain');
  });

  /* 검증 훅 */
  window.__dc = { state: S, quote: quote, handleFile: handleFile, cred: cred, PRICE: PRICE };
})();
