/* rulebook.js — 점자 규정집 변환기 (표 형식 JSON → UEB 스타일 서술형 문서)
 * 아랍어 규정집 709항목 실전 검증 데이터 기준. 설계 문서의 검증된 규칙 구현:
 *  - 유니코드 점자 비트마스크 인코딩
 *  - RTL 문서: 점자 셀 역순 배치 (화면상 첫 셀이 오른쪽), Bidi 격리
 *  - 점 번호 그룹: RTL에서 그룹 순서 역전 표시, 내부는 LTR 고정
 *  - 비고·예시 없는 연속 항목 6개 이상 → 압축 그리드
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RULEBOOK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOT_BIT = { 1: 0x01, 2: 0x02, 3: 0x04, 4: 0x08, 5: 0x10, 6: 0x20 };

  function parseDots(str) {          // "1-2-4" → [1,2,4]
    return String(str).split(/[^1-6]+/).filter(Boolean).map(Number);
  }
  function cellChar(dotList) {
    var m = 0;
    dotList.forEach(function (d) { m |= DOT_BIT[d] || 0; });
    return String.fromCharCode(0x2800 + m);
  }
  /* dots 배열(셀 문자열들) → 유니코드 점자. rtl이면 셀 역순 (첫 셀이 화면 오른쪽) */
  function brailleText(dotStrs, rtl) {
    var cells = (dotStrs || []).map(function (s) { return cellChar(parseDots(s)); });
    if (rtl) cells = cells.slice().reverse();
    return cells.join('');
  }
  /* 점 번호 라벨: "(1-2-5) (1)" — RTL 표시 관례로 그룹 역순, 내부 LTR */
  function dotsLabel(dotStrs, rtl) {
    var gs = (dotStrs || []).map(function (s) { return '(' + parseDots(s).join('-') + ')'; });
    if (rtl) gs = gs.slice().reverse();
    return gs.join(' ');
  }

  /* ── 아랍어 709 JSON → 정규화 문서 구조 ── */
  var CH1_SECTIONS = { t1: null, t2: null, t3: null, t4: null, t5: null }; // 제목은 데이터에서
  function normalize(data, opts) {
    opts = opts || {};
    var doc = {
      title: opts.title || data.title || 'نظام برايل العربي المطور',
      subtitle: opts.subtitle || '',
      rtl: opts.rtl !== false,
      front: [], chapters: []
    };
    // PDF/Word 파서 출력 (generic 구조): 단일 챕터로 수용
    if (data.generic) {
      doc.front = (data.front || []).slice(0, 200);
      doc.chapters = [{ title: data.title || '', sections: data.sections || [], rules: [] }];
      doc.itemCount = doc.chapters[0].sections.reduce(function (a, s) { return a + s.items.length; }, 0);
      return doc;
    }
    // 서문 (front.02~05: blocks)
    if (data.front) {
      Object.keys(data.front).sort().forEach(function (pk) {
        var pg = data.front[pk];
        (pg.blocks || []).forEach(function (b) {
          doc.front.push({ kind: b.kind || 'para', text: b.text || '' });
        });
      });
    }
    // 1장: t1~t5 표
    if (data.ch1) {
      var ch1 = { title: 'الرموز الأساسية في نظام برايل العربي المطور', sections: [], rules: [] };
      Object.keys(data.ch1).sort().forEach(function (tk) {
        var t = data.ch1[tk];
        if (t && t.items) ch1.sections.push({ title: t.title || tk, items: t.items });
      });
      doc.chapters.push(ch1);
    }
    // 2~5장
    ['ch2', 'ch3', 'ch4', 'ch5'].forEach(function (ck) {
      var c = data[ck];
      if (!c) return;
      var ch = { title: c.title || ck, sections: [], rules: [] };
      (c.rule_blocks || c.rules || []).forEach(function (rb) {
        ch.rules.push({ heading: rb.heading || '', lines: rb.lines || [] });
      });
      (c.sections && c.sections.length ? c.sections : [{ title: c.title, items: c.items || [] }])
        .forEach(function (s) { ch.sections.push({ title: s.title || '', items: s.items || [] }); });
      if (c.extra_rules && c.extra_rules.length)
        ch.sections.push({ title: '', items: c.extra_rules, isExtra: true });
      doc.chapters.push(ch);
    });
    // 통계
    doc.itemCount = doc.chapters.reduce(function (a, ch) {
      return a + ch.sections.reduce(function (b, s) { return b + s.items.length; }, 0);
    }, 0);
    return doc;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── HTML 렌더 (미리보기 + 인쇄 공용) ── */
  var COMPACT_THRESHOLD = 6;

  function itemHTML(it, id, rtl, compact, interactive) {
    var hasDetail = (it.notes && it.notes.length) || (it.examples && it.examples.length);
    var br = brailleText(it.dots, rtl);
    var h = '<div class="rb-item' + (compact && !hasDetail ? ' compact' : '') +
      (it._fixed ? ' fixed' : '') + '"' + (interactive ? ' data-rbid="' + esc(id) + '"' : '') + '>';
    h += '<div class="rb-head"><span class="rb-id">' + esc(id) + '</span>';
    if (it.name) h += '<span class="rb-name">' + esc(it.name) + '</span>';
    if (it.print != null && it.print !== '') h += '<span class="rb-print" dir="auto">' + esc(it.print) + '</span>';
    if (br) h += '<span class="bcell" dir="ltr">' + br + '</span>';
    h += '</div>';
    if (it.dots && it.dots.length)
      h += '<div class="rb-dots">النقاط: <span dir="ltr">' + esc(dotsLabel(it.dots, rtl)) + '</span></div>';
    (it.notes || []).forEach(function (n) { h += '<div class="rb-note">ملاحظة: ' + esc(n) + '</div>'; });
    if (it.examples && it.examples.length) {
      h += '<div class="rb-ex-head">أمثلة:</div>';
      it.examples.forEach(function (ex) {
        h += '<div class="rb-ex">';
        if (ex.print != null) h += '<span class="rb-ex-print" dir="auto">' + esc(ex.print) + '</span> ';
        h += '<span class="bcell exb" dir="ltr">' + brailleText(ex.dots, rtl) + '</span>';
        h += ' <span class="rb-dots-sm" dir="ltr">' + esc(dotsLabel(ex.dots, rtl)) + '</span></div>';
      });
    }
    return h + '</div>';
  }

  function renderHTML(doc, fontB64, forPrint, interactive) {
    var rtl = doc.rtl;
    var css =
      (fontB64 ? '@font-face{font-family:"AB Pinpoint";src:url(data:font/ttf;base64,' + fontB64 + ') format("truetype")}' : '') +
      'body{direction:' + (rtl ? 'rtl' : 'ltr') + ';font-family:"Noto Naskh Arabic","Geeza Pro",serif;font-size:11.5pt;margin:0;color:#1a1a1a}' +
      '.rb-page{max-width:175mm;margin:0 auto;padding:14mm 12mm}' +
      'h1.rb{font-size:21pt;text-align:center;border-top:2px solid #222;border-bottom:2px solid #222;padding:10mm 0;margin:22mm 0 6mm}' +
      '.rb-sub{text-align:center;color:#555;margin-bottom:30mm}' +
      'h2.rb{font-size:15pt;border-bottom:1.5px solid #333;padding-bottom:2mm;margin:12mm 0 5mm;page-break-after:avoid}' +
      'h3.rb{font-size:12.5pt;margin:8mm 0 3mm;page-break-after:avoid}' +
      '.rb-front p{line-height:1.9;text-align:justify;margin:2.5mm 0}' +
      '.rb-front h3{margin:6mm 0 2mm}' +
      '.rb-rule{line-height:1.9;margin:2mm 0}' +
      '.rb-grid{display:grid;grid-template-columns:1fr 1fr;gap:2mm 8mm}' +
      '.rb-item{padding:2.2mm 0;border-bottom:.5px solid #e4e0d8;page-break-inside:avoid}' +
      '.rb-head{display:flex;align-items:center;gap:3mm;flex-wrap:wrap}' +
      '.rb-id{font-size:8.5pt;color:#888;font-family:"Noto Serif",serif;direction:ltr;min-width:11mm}' +
      '.rb-name{font-weight:700}' +
      '.rb-print{color:#333}' +
      '.bcell{font-family:"AB Pinpoint","Apple Braille",monospace;font-size:20pt;direction:ltr;unicode-bidi:isolate;line-height:1.15;margin-inline-start:auto}' +
      '.bcell.exb{font-size:15pt;margin-inline-start:0}' +
      '.rb-dots{font-size:8.5pt;color:#666;margin-top:1mm}' +
      '.rb-dots-sm{font-size:8pt;color:#777}' +
      '.rb-note{font-size:10pt;color:#444;margin-top:1.5mm;line-height:1.8}' +
      '.rb-ex-head{font-size:10pt;font-weight:700;margin-top:2mm}' +
      '.rb-ex{margin:1.2mm 0;display:flex;align-items:center;gap:3mm;flex-wrap:wrap}' +
      (interactive ? '.rb-item[data-rbid]{cursor:pointer}.rb-item[data-rbid]:hover{background:#faf6ec}.rb-item.fixed{background:#eef7ee}.rb-item.sel{outline:2px solid #c8265c;outline-offset:2px}' : '') +
      (forPrint ? '@page{size:A4;margin:0}.rb-chapter{page-break-before:always}' : '');

    var body = '<div class="rb-page">';
    body += '<h1 class="rb">' + esc(doc.title) + '</h1>';
    if (doc.subtitle) body += '<div class="rb-sub">' + esc(doc.subtitle) + '</div>';
    body += '<div class="rb-sub">' + doc.itemCount + ' رمزًا · ' + doc.chapters.length + ' فصول</div>';
    // 서문
    if (doc.front.length) {
      body += '<div class="rb-front">';
      doc.front.forEach(function (b) {
        body += b.kind === 'heading' ? '<h3 class="rb">' + esc(b.text) + '</h3>' : '<p>' + esc(b.text) + '</p>';
      });
      body += '</div>';
    }
    doc.chapters.forEach(function (ch, ci) {
      body += '<div class="rb-chapter"><h2 class="rb">' + (ci + 1) + ' — ' + esc(ch.title) + '</h2>';
      ch.rules.forEach(function (rb) {
        if (rb.heading) body += '<h3 class="rb">' + esc(rb.heading) + '</h3>';
        rb.lines.forEach(function (l) { body += '<div class="rb-rule">' + esc(l) + '</div>'; });
      });
      ch.sections.forEach(function (s, si) {
        if (s.title) body += '<h3 class="rb">' + (ci + 1) + '-' + (si + 1) + ' ' + esc(s.title) + '</h3>';
        var noDetail = s.items.filter(function (i) { return !(i.notes && i.notes.length) && !(i.examples && i.examples.length); });
        var compact = noDetail.length >= COMPACT_THRESHOLD;
        if (compact) body += '<div class="rb-grid">';
        s.items.forEach(function (it, ii) {
          var id = (ci + 1) + '-' + (si + 1) + '-' + (ii + 1);
          body += itemHTML(it, id, doc.rtl, compact, interactive);
        });
        if (compact) body += '</div>';
      });
      body += '</div>';
    });
    body += '</div>';
    return '<!DOCTYPE html><html lang="' + (doc.rtl ? 'ar' : 'en') + '" dir="' + (doc.rtl ? 'rtl' : 'ltr') + '"><head><meta charset="utf-8"><title>' + esc(doc.title) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
  }

  /* ── DotPad: 항목당 한 화면 (확대 점자) ──
   * 확대 셀: 도트 = 2×2 핀 블록, 도트 피치 4핀, 셀 폭 2도트(6핀)+간격 4핀 → 셀 전진 10핀
   * 60핀 → 한 줄 최대 5셀, 2줄까지 (물리 촉각 학습용 확대 표현) */
  function itemToGrid(dotStrs, ltrCells) {
    var W = 60, H = 40, g = [];
    for (var y = 0; y < H; y++) { g.push(new Array(W).fill(0)); }
    var cells = (dotStrs || []).map(parseDots);
    if (!ltrCells) cells = cells; // 확대 화면은 항상 판독 순서(LTR)로
    var perRow = 5, rows = Math.ceil(cells.length / perRow);
    if (rows > 2) { perRow = Math.ceil(cells.length / 2); rows = 2; }
    var cw = 10, chh = 16, H2 = H - 6;           // 하단 6행은 표준 피치 병기 공간
    cells.forEach(function (dl, idx) {
      var r = Math.floor(idx / perRow), c = idx % perRow;
      var n = Math.min(perRow, cells.length - r * perRow);
      var x0 = Math.round((W - n * cw) / 2) + c * cw + 1;
      var y0 = Math.max(0, Math.round((H2 - rows * chh) / 2)) + r * chh + 1;
      dl.forEach(function (d) {
        var col = d >= 4 ? 1 : 0, row = (d - 1) % 3;
        var px = x0 + col * 4, py = y0 + row * 4;
        for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++)
          if (py + dy < H && px + dx < W) g[py + dy][px + dx] = 1;
      });
      // 셀 테두리 없음 — 도트만 (실제 점자 감각)
    });
    // 하단에 표준 피치 병기 (확대 점자의 스케일 혼란 방지 — 페르소나 피드백)
    var std = cells.slice(0, 19);
    var sx0 = Math.round((W - std.length * 3) / 2);
    std.forEach(function (dl, ci) {
      dl.forEach(function (d) {
        var col = d >= 4 ? 1 : 0, row = (d - 1) % 3;
        var yy = H - 4 + row, xx = sx0 + ci * 3 + col;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) g[yy][xx] = 1;
      });
    });
    return g;
  }

  /* ── DotPad: 점자 텍스트 흐름 (표준 피치: 셀 3×4핀 전진, 20셀×10행/페이지) ──
   * 물리 점자는 판독 방향이 항상 왼→오 (세계 공통). cellsRtl 옵션은 문서 표기 관례용. */
  function flowToGrids(cellSeqs, cellsRtl) {
    var W = 60, H = 40, perLine = 20, perPage = 10;
    var lines = [], cur = [];
    cellSeqs.forEach(function (dotStrs) {
      var cells = (dotStrs || []).map(parseDots);
      if (cellsRtl) cells = cells.slice().reverse();
      if (cur.length && cur.length + cells.length + 1 > perLine) { lines.push(cur); cur = []; }
      if (cur.length) cur.push(null);            // 빈 셀 = 구분
      cells.forEach(function (c) {
        if (cur.length >= perLine) { lines.push(cur); cur = []; }
        cur.push(c);
      });
    });
    if (cur.length) lines.push(cur);
    var pages = [];
    for (var p = 0; p < lines.length; p += perPage) {
      var g = [];
      for (var y = 0; y < H; y++) g.push(new Array(W).fill(0));
      lines.slice(p, p + perPage).forEach(function (line, li) {
        line.forEach(function (cell, ci) {
          if (!cell) return;
          cell.forEach(function (d) {
            var col = d >= 4 ? 1 : 0, row = (d - 1) % 3;
            g[li * 4 + row][ci * 3 + col] = 1;
          });
        });
      });
      pages.push(g);
    }
    return pages;
  }

  return {
    parseDots: parseDots, cellChar: cellChar, brailleText: brailleText, dotsLabel: dotsLabel,
    normalize: normalize, renderHTML: renderHTML,
    itemToGrid: itemToGrid, flowToGrids: flowToGrids,
    COMPACT_THRESHOLD: COMPACT_THRESHOLD
  };
});
