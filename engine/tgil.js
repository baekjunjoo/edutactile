/* tgil.js — TGIL-style tactile graphic engine (spec → SVG)
 * 좌표계: world = 실제 단위(feet 등), y-up. page = mm, y-down, origin 좌상단.
 * 핵심 원칙:
 *   1) 점자·심볼·선 두께는 물리 규격(mm) 고정 — 도면 스케일과 무관.
 *   2) 선 두께는 역할 클래스(outline/major/minor/dashed)로만 지정.
 *   3) 제작자가 TGIL 규칙을 몰라도 엔진이 규격을 강제한다.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./braille.js'));
  } else {
    root.TGIL = factory(root.KB || root.B);
  }
})(typeof self !== 'undefined' ? self : this, function (B) {
  'use strict';

  /* ── 용지 프리셋 (mm) — 점자·심볼 크기는 용지와 무관하게 고정 ── */
  var PAPERS = {
    '11.5x11in': { w: 292.1, h: 279.4, margin: 14, name: '11.5×11 in (US braille)' },
    'a4': { w: 210, h: 297, margin: 12, name: 'A4 세로' },
    'a4-landscape': { w: 297, h: 210, margin: 12, name: 'A4 가로' },
    'b4': { w: 257, h: 364, margin: 13, name: 'B4 세로' },
    'b4-landscape': { w: 364, h: 257, margin: 13, name: 'B4 가로' }
  };

  /* ── TGIL 물리 프로파일 (BANA/APH 규격 기반, mm) ── */
  var PROFILE = {
    page: { w: 292.1, h: 279.4, margin: 14 },        // 기본: 11.5 × 11 in braille paper
    line: {
      outline: { w: 2.0 },                           // 외곽선(굵음)
      major:   { w: 1.0 },                           // 내부 주 구획선
      minor:   { w: 0.5 },                           // 보조선
      dashed:  { w: 1.4, dash: [7, 3.5] },           // 파선(공중·가상 요소)
      dim:     { w: 0.35 }                           // 치수선(가장 얇게)
    },
    braille: {
      dotR: 0.72,        // 도트 반지름 (base dia ≈1.44mm)
      dotGap: 2.34,      // 셀 내 도트 간격 (0.092in)
      cellAdv: 6.1,      // 셀 전진폭 (0.24in)
      lineAdv: 10.16     // 행 전진폭 (0.4in)
    },
    symbol: { dot: 3.8, square: 3.4, cross: 4.2 },   // 포인트 심볼 크기(직경/변)
    dim: { offset: 16, tick: 4.2, labelGap: 3 },     // 치수선 오프셋·엔드틱·레이블 여백
    texture: { lineGap: 4.5, lineW: 0.4, dotGap: 3.4, dotR: 0.5 },
    minGap: 3.2,        // 서로 다른 선 최소 간격 (1/8 in)
    titleGap: 9
  };

  var BRL_H = 2 * PROFILE.braille.dotGap + 2 * PROFILE.braille.dotR; // 6점 셀 높이

  /* ── Nemeth 수학 점자: 숫자(내림 점형)·마이너스·소수점·분수 빗금 ──
   * 단어(영문)는 UEB로 폴백. TGIL의 "... Nemeth" 변형 그래픽과 동일 관행:
   * 축 눈금·치수는 수표(3456) + Nemeth 숫자. */
  var NEMETH_DIGIT = { '1': [2], '2': [2, 3], '3': [2, 5], '4': [2, 5, 6], '5': [2, 6], '6': [2, 3, 5], '7': [2, 3, 5, 6], '8': [2, 3, 6], '9': [3, 5], '0': [3, 5, 6] };
  function nemethCells(s) {
    var out = [], i = 0, numMode = false;
    while (i < s.length) {
      var ch = s[i];
      if (ch === ' ') { out.push([]); numMode = false; i++; continue; }
      if (ch === '-') { out.push([3, 6]); numMode = false; i++; continue; }
      if (NEMETH_DIGIT[ch]) { if (!numMode) { out.push([3, 4, 5, 6]); numMode = true; } out.push(NEMETH_DIGIT[ch]); i++; continue; }
      if (ch === '.' && NEMETH_DIGIT[s[i + 1]]) { if (!numMode) { out.push([3, 4, 5, 6]); numMode = true; } out.push([4, 6]); i++; continue; }
      if (ch === '/') { out.push([3, 4]); i++; continue; }  // 분수 빗금: 수 모드 유지 (수표 반복 금지)
      var j = i; while (j < s.length && /[A-Za-z,']/.test(s[j])) j++;
      if (j > i) { B.setGrade('g2'); B.brailleCells(s.slice(i, j)).forEach(function (c) { out.push(c); }); numMode = false; i = j; continue; }
      i++;
    }
    return out;
  }

  /* ── 점역: 텍스트 → 셀(점번호 배열) 시퀀스. code: 'ueb'|'ko'|'nemeth' ── */
  function translate(text, code) {
    if (code === 'nemeth') return nemethCells(String(text));
    if (B && B.setGrade) B.setGrade('g2');
    return B.brailleCells(String(text)); // 엔진이 한글/영문/숫자 자동 판별
  }
  function labelSize(cells) {
    return { w: cells.length * PROFILE.braille.cellAdv, h: BRL_H };
  }
  /* 점자 도트를 SVG 원으로 직접 렌더 (폰트 비의존) */
  function brailleSVG(cells, x, y) {
    var p = PROFILE.braille, out = [];
    for (var i = 0; i < cells.length; i++) {
      var cx0 = x + i * p.cellAdv + p.dotR;
      for (var d = 0; d < cells[i].length; d++) {
        var dot = cells[i][d];                       // 1..6 (v1: 6점)
        var col = dot >= 4 ? 1 : 0, row = (dot - 1) % 3;
        out.push('<circle cx="' + f(cx0 + col * p.dotGap) + '" cy="' +
          f(y + p.dotR + row * p.dotGap) + '" r="' + p.dotR + '"/>');
      }
    }
    return out.join('');
  }
  function f(n) { return Math.round(n * 100) / 100; }

  /* ── world bbox 계산 (치수선 제외) ── */
  function worldBBox(spec) {
    var xs = [], ys = [];
    spec.elements.forEach(function (e) {
      if (e.type === 'region') { xs.push(e.rect[0], e.rect[0] + e.rect[2]); ys.push(e.rect[1], e.rect[1] + e.rect[3]); }
      else if (e.type === 'line') { xs.push(e.from[0], e.to[0]); ys.push(e.from[1], e.to[1]); }
      else if (e.type === 'pointSymbol' || e.type === 'tick' || e.type === 'label' || e.type === 'leader') { xs.push(e.at[0]); ys.push(e.at[1]); }
      else if (e.type === 'circle' || e.type === 'arc' || e.type === 'sector') { xs.push(e.at[0] - e.r, e.at[0] + e.r); ys.push(e.at[1] - e.r, e.at[1] + e.r); }
      else if (e.type === 'polyline') { e.points.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); }
      else if (e.type === 'path' && e.bbox) { xs.push(e.bbox[0], e.bbox[0] + e.bbox[2]); ys.push(e.bbox[1], e.bbox[1] + e.bbox[3]); }
    });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ── 레이아웃: 타이틀 밴드 + 치수 밴드 예약 → 스케일 결정 ── */
  function layout(spec, report) {
    var P = PROFILE;
    var page = PAPERS[(spec.canvas && spec.canvas.paper) || '11.5x11in'] || P.page;
    var inner = { x: page.margin, y: page.margin, w: page.w - 2 * page.margin, h: page.h - 2 * page.margin };

    // 타이틀 (점자, 자동 줄바꿈)
    var titleLines = [];
    if (spec.title && spec.title.text) {
      var words = String(spec.title.text).split(/\s+/), cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (labelSize(translate(t, spec.brailleCode)).w > inner.w && cur) { titleLines.push(cur); cur = w; }
        else cur = t;
      });
      if (cur) titleLines.push(cur);
    }
    var titleH = titleLines.length ? titleLines.length * P.braille.lineAdv + P.titleGap : 0;

    // 치수 밴드: 각 변에서 필요한 폭 계산 (같은 변의 치수는 자동 단계 오프셋으로 겹침 방지)
    var bands = { top: 0, bottom: 0, left: 0, right: 0 }, sideSeen = {};
    spec.elements.forEach(function (e) {
      if (e.type !== 'dimension') return;
      var cells = translate(e.label, spec.brailleCode);
      var sz = labelSize(cells);
      var stack = sideSeen[e.side] || 0; sideSeen[e.side] = stack + 1;
      var off = (e.offset || P.dim.offset) + stack * ((e.side === 'left' || e.side === 'right') ? sz.w + 14 : sz.h + 12);
      e._off = off;
      var need = (e.side === 'left' || e.side === 'right')
        ? off + P.dim.labelGap + sz.w + 2
        : off + P.dim.labelGap + sz.h + 2;
      if (need > bands[e.side]) bands[e.side] = need;
      e._cells = cells; e._size = sz;
    });

    // 리드선(leader) 레이블: 사이드 자동 결정 + 밴드 예약
    // 치수선이 있는 사이드에서는 그 바깥으로 밀어내 겹침 방지
    var dimBands = { left: bands.left, right: bands.right, top: bands.top, bottom: bands.bottom };
    var bbPre = worldBBox(spec);
    spec.elements.forEach(function (e) {
      if (e.type !== 'leader') return;
      e._cells = translate(e.text, spec.brailleCode);
      e._size = labelSize(e._cells);
      if (!e.side) {   // 목표점이 도면 중심 기준 어느 쪽에 가까운가 (좌/우 우선)
        var nx = (e.at[0] - bbPre.x0) / (bbPre.w || 1);
        e.side = nx < 0.5 ? 'left' : 'right';
      }
      var base = dimBands[e.side] ? dimBands[e.side] + 6 : 12;
      var need2 = (e.side === 'left' || e.side === 'right')
        ? base + e._size.w + 10 : base + e._size.h + 6;
      if (need2 > bands[e.side]) bands[e.side] = need2;
    });

    var draw = {
      x: inner.x + bands.left,
      y: inner.y + titleH + bands.top,
      w: inner.w - bands.left - bands.right,
      h: inner.h - titleH - bands.top - bands.bottom
    };

    var bb = worldBBox(spec);
    var sx = draw.w / bb.w, sy = draw.h / bb.h;
    var stretch = spec.canvas && spec.canvas.stretch;
    if (!stretch) { sx = sy = Math.min(sx, sy); }
    var usedW = bb.w * sx, usedH = bb.h * sy;
    // 목표 종횡비(drawn aspect): APH 관행처럼 의도적 비율로 그리기
    if (stretch && spec.canvas.aspect) {
      var A = spec.canvas.aspect;
      usedW = Math.min(draw.w, draw.h * A); usedH = usedW / A;
      sx = usedW / bb.w; sy = usedH / bb.h;
    }
    var ox = draw.x + (draw.w - usedW) / 2, oy = draw.y + (draw.h - usedH) / 2;
    if (stretch) report.push('용지에 맞춰 가로·세로 비율을 조정했어요 (촉각 도면에서 허용되는 관행 — 치수는 점자 레이블이 전달합니다).');

    return {
      page: page, dimBands: dimBands,
      inner: inner, titleLines: titleLines, draw: draw, bb: bb,
      X: function (wx) { return ox + (wx - bb.x0) * sx; },
      Y: function (wy) { return oy + usedH - (wy - bb.y0) * sy; },  // y-up → y-down
      XI: function (px) { return bb.x0 + (px - ox) / sx; },         // 역변환 (클릭 → world)
      YI: function (py) { return bb.y0 + (oy + usedH - py) / sy; },
      SX: function (w) { return w * sx; }, SY: function (h) { return h * sy; },
      titleY: inner.y
    };
  }

  /* ── 텍스처 패턴 정의 ── */
  var TEXTURES = {
    'diag-lines': function (id) {
      var g = PROFILE.texture;
      return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + g.lineGap + '" height="' + g.lineGap + '" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="' + g.lineGap + '" stroke="#000" stroke-width="' + g.lineW + '"/></pattern>';
    },
    'dots': function (id) {
      var g = PROFILE.texture;
      return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + g.dotGap + '" height="' + g.dotGap + '">' +
        '<circle cx="' + g.dotGap / 2 + '" cy="' + g.dotGap / 2 + '" r="' + g.dotR + '" fill="#000"/></pattern>';
    },
    'grid': function (id) {
      var g = PROFILE.texture;
      return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + g.lineGap + '" height="' + g.lineGap + '">' +
        '<path d="M ' + g.lineGap + ' 0 L 0 0 0 ' + g.lineGap + '" fill="none" stroke="#000" stroke-width="' + g.lineW + '"/></pattern>';
    },
    'hlines': function (id) {
      var g = PROFILE.texture;
      return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + g.lineGap + '" height="' + g.lineGap + '">' +
        '<line x1="0" y1="0" x2="' + g.lineGap + '" y2="0" stroke="#000" stroke-width="' + g.lineW + '"/></pattern>';
    },
    'vlines': function (id) {
      var g = PROFILE.texture;
      return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + g.lineGap + '" height="' + g.lineGap + '">' +
        '<line x1="0" y1="0" x2="0" y2="' + g.lineGap + '" stroke="#000" stroke-width="' + g.lineW + '"/></pattern>';
    }
  };

  /* 묵자 병기: 점자 아래 작은 일반 글자. mode 'screen'(화면 확인용) | 'print'(인쇄 포함).
   * 스웰페이퍼는 진한 검정에 반응하므로 인쇄 모드도 중간 회색(#767676) 사용. */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inkText(spec, text, cx, topY) {
    if (!spec.inkText) return '';
    return '<text class="inktxt" x="' + f(cx) + '" y="' + f(topY + 3.1) + '" font-family="sans-serif" font-size="3.2" text-anchor="middle" fill="#767676">' + esc(text) + '</text>';
  }

  function arrowHead(x, y, ux, uy, len) {
    len = len || 4.2; var w = 2.8;
    var bx = x - ux * len, by = y - uy * len;
    var px = -uy, py = ux;
    return '<path d="M' + f(x) + ' ' + f(y) + ' L' + f(bx + px * w / 2) + ' ' + f(by + py * w / 2) +
      ' L' + f(bx - px * w / 2) + ' ' + f(by - py * w / 2) + ' Z" fill="#000"/>';
  }

  function strokeAttr(style) {
    var s = PROFILE.line[style] || PROFILE.line.minor;
    var a = 'stroke="#000" stroke-width="' + s.w + '" fill="none"';
    if (s.dash) a += ' stroke-dasharray="' + s.dash.join(',') + '"';
    return a;
  }

  /* ── 점자 텍스트 페이지: 도면 없이 제목+본문 (레슨 개념 설명·퀴즈용) ── */
  function renderTextPage(spec) {
    var P = PROFILE, report = [];
    var page = PAPERS[(spec.canvas && spec.canvas.paper) || '11.5x11in'] || P.page;
    var inner = { x: page.margin, y: page.margin, w: page.w - 2 * page.margin, h: page.h - 2 * page.margin };
    var body = [], y = inner.y;
    var lineStep = P.braille.lineAdv + (spec.inkText ? 4 : 0);
    function pushLine(text, center) {
      if (y + BRL_H > inner.y + inner.h) return false;
      var cells = translate(text, spec.brailleCode);
      var w = labelSize(cells).w, x = center ? inner.x + (inner.w - w) / 2 : inner.x;
      body.push('<g fill="#000">' + brailleSVG(cells, x, y) + '</g>');
      body.push(inkText(spec, text, x + w / 2, y + BRL_H + 0.8));
      y += lineStep;
      return true;
    }
    function wrap(text) {  // 폭 맞춤 줄바꿈 (단어 단위, 초과 단어는 글자 단위)
      var lines = [], maxCells = Math.floor(inner.w / P.braille.cellAdv);
      String(text).split('\n').forEach(function (para) {
        if (!para.trim()) { lines.push(''); return; }
        var cur = '';
        para.split(/\s+/).forEach(function (word) {
          var t = cur ? cur + ' ' + word : word;
          if (translate(t, spec.brailleCode).length > maxCells && cur) { lines.push(cur); cur = word; }
          else cur = t;
          while (translate(cur, spec.brailleCode).length > maxCells) { // 초장문 단어 강제 분할
            var k = cur.length;
            while (k > 1 && translate(cur.slice(0, k), spec.brailleCode).length > maxCells) k--;
            lines.push(cur.slice(0, k)); cur = cur.slice(k);
          }
        });
        if (cur) lines.push(cur);
      });
      return lines;
    }
    if (spec.title && spec.title.text) { wrap(spec.title.text).forEach(function (l) { pushLine(l, true); }); y += 4; }
    var overflow = false;
    wrap(spec.textPage).forEach(function (l) {
      if (l === '') { y += lineStep / 2; return; }
      if (!pushLine(l, false)) overflow = true;
    });
    if (overflow) report.push('본문이 한 페이지를 넘칩니다 — 내용을 줄이거나 페이지를 나눠 주세요.');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + page.w + 'mm" height="' + page.h + 'mm" viewBox="0 0 ' + page.w + ' ' + page.h + '">' +
      '<rect width="100%" height="100%" fill="#fff"/>' + body.join('\n') + '</svg>';
    return { svg: svg, report: report, layout: { page: page, bb: null } };
  }

  /* ── 렌더: spec → { svg, report } ── */
  function render(spec) {
    if (spec.textPage != null) return renderTextPage(spec);
    var P = PROFILE, report = [];
    var L = layout(spec, report);
    var defs = {}, body = [];

    // z-order: 텍스처 → minor → major → dashed → outline → 심볼/틱 → 치수 → 레이블
    var order = { texture: 0, sector: 1, region: 1, path: 2, line: 2, circle: 2, arc: 2, polyline: 2, tick: 5, pointSymbol: 6, dimension: 7, label: 8 };
    var els = spec.elements.slice().sort(function (a, b) {
      var za = a.type === 'line' ? (a.style === 'outline' ? 4 : a.style === 'dashed' ? 3 : 2) : order[a.type] || 2;
      var zb = b.type === 'line' ? (b.style === 'outline' ? 4 : b.style === 'dashed' ? 3 : 2) : order[b.type] || 2;
      return za - zb;
    });

    els.forEach(function (e) {
      switch (e.type) {
        case 'region': {
          var x = L.X(e.rect[0]), y = L.Y(e.rect[1] + e.rect[3]);
          var w = L.X(e.rect[0] + e.rect[2]) - x, h = L.Y(e.rect[1]) - y;
          if (e.fill && TEXTURES[e.fill]) {
            var pid = 'tx-' + e.fill;
            defs[pid] = TEXTURES[e.fill](pid);
            body.push('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" fill="url(#' + pid + ')" stroke="none"/>');
          }
          if (e.edge && e.edge !== 'none')
            body.push('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" ' + strokeAttr(e.edge) + '/>');
          break;
        }
        case 'line': {
          var lx1 = L.X(e.from[0]), ly1 = L.Y(e.from[1]), lx2 = L.X(e.to[0]), ly2 = L.Y(e.to[1]);
          if (e.overshootMm) {  // 페이지 mm 단위로 양끝 연장 (네트→포스트 등, 스케일 비의존)
            var vx = lx2 - lx1, vy = ly2 - ly1, vl = Math.sqrt(vx * vx + vy * vy) || 1;
            vx /= vl; vy /= vl;
            lx1 -= vx * e.overshootMm; ly1 -= vy * e.overshootMm;
            lx2 += vx * e.overshootMm; ly2 += vy * e.overshootMm;
          }
          body.push('<line x1="' + f(lx1) + '" y1="' + f(ly1) + '" x2="' + f(lx2) + '" y2="' + f(ly2) + '" ' + strokeAttr(e.style || 'minor') + ' stroke-linecap="butt"/>');
          if (e.arrows) {   // 화살촉: true|'both'=양끝, 'end'=끝만 (물리 크기 고정)
            var ux = (lx2 - lx1), uy = (ly2 - ly1), ul = Math.sqrt(ux * ux + uy * uy) || 1;
            ux /= ul; uy /= ul;
            body.push(arrowHead(lx2, ly2, ux, uy));
            if (e.arrows !== 'end') body.push(arrowHead(lx1, ly1, -ux, -uy));
          }
          break;
        }
        case 'polyline': {
          var pts = e.points.map(function (p) { return f(L.X(p[0])) + ',' + f(L.Y(p[1])); }).join(' ');
          var fillAttr = 'fill="none"';
          if (e.fill === 'solid') fillAttr = 'fill="#000"';
          else if (e.fill && TEXTURES[e.fill]) { var ppid = 'tx-' + e.fill; defs[ppid] = TEXTURES[e.fill](ppid); fillAttr = 'fill="url(#' + ppid + ')"'; }
          body.push('<' + (e.closed ? 'polygon' : 'polyline') + ' points="' + pts + '" ' +
            strokeAttr(e.style || 'major').replace('fill="none"', fillAttr) + ' stroke-linejoin="round"/>');
          break;
        }
        case 'sector': {
          var scx = L.X(e.at[0]), scy = L.Y(e.at[1]), srx = L.SX(e.r), sry = L.SY(e.r);
          var sa0 = e.from * Math.PI / 180, sa1 = e.to * Math.PI / 180;
          var sp0 = [scx + srx * Math.cos(sa0), scy - sry * Math.sin(sa0)];
          var sp1 = [scx + srx * Math.cos(sa1), scy - sry * Math.sin(sa1)];
          var ssweep = ((e.to - e.from) % 360 + 360) % 360;
          var slarge = ssweep > 180 ? 1 : 0;
          var sfill = 'fill="none"';
          if (e.fill === 'solid') sfill = 'fill="#000"';
          else if (e.fill && TEXTURES[e.fill]) { var spid = 'tx-' + e.fill; defs[spid] = TEXTURES[e.fill](spid); sfill = 'fill="url(#' + spid + ')"'; }
          body.push('<path d="M' + f(scx) + ' ' + f(scy) + ' L' + f(sp0[0]) + ' ' + f(sp0[1]) +
            ' A' + f(srx) + ' ' + f(sry) + ' 0 ' + slarge + ' 0 ' + f(sp1[0]) + ' ' + f(sp1[1]) + ' Z" ' +
            strokeAttr(e.style || 'major').replace('fill="none"', sfill) + '/>');
          break;
        }
        case 'circle': {
          var ccx = L.X(e.at[0]), ccy = L.Y(e.at[1]);
          body.push('<ellipse cx="' + f(ccx) + '" cy="' + f(ccy) + '" rx="' + f(L.SX(e.r)) + '" ry="' + f(L.SY(e.r)) + '" ' + strokeAttr(e.style || 'major') + (e.fillTexture ? '' : '') + '/>');
          break;
        }
        case 'arc': {
          // world 각도(도, y-up CCW, 0=동쪽) → 타원 호
          var acx = L.X(e.at[0]), acy = L.Y(e.at[1]), rx = L.SX(e.r), ry = L.SY(e.r);
          var a0 = e.from * Math.PI / 180, a1 = e.to * Math.PI / 180;
          var p0 = [acx + rx * Math.cos(a0), acy - ry * Math.sin(a0)];
          var p1 = [acx + rx * Math.cos(a1), acy - ry * Math.sin(a1)];
          var sweep = ((e.to - e.from) % 360 + 360) % 360;
          var large = sweep > 180 ? 1 : 0;
          body.push('<path d="M' + f(p0[0]) + ' ' + f(p0[1]) + ' A' + f(rx) + ' ' + f(ry) + ' 0 ' + large + ' 0 ' + f(p1[0]) + ' ' + f(p1[1]) + '" ' + strokeAttr(e.style || 'major') + '/>');
          break;
        }
        case 'path':
          body.push('<path d="' + e.d + '" ' + strokeAttr(e.style || 'major') + (e.transform ? ' transform="' + e.transform + '"' : '') + '/>');
          break;
        case 'tick': {
          var tx = L.X(e.at[0]), ty = L.Y(e.at[1]);
          var len = e.len || 5, dx = (e.dir && e.dir[0]) || 0, dy = -((e.dir && e.dir[1]) || 0);
          body.push('<line x1="' + f(tx) + '" y1="' + f(ty) + '" x2="' + f(tx + dx * len) + '" y2="' + f(ty + dy * len) + '" ' + strokeAttr(e.style || 'outline') + '/>');
          break;
        }
        case 'pointSymbol': {
          var px = L.X(e.at[0]), py = L.Y(e.at[1]), s = P.symbol[e.symbol || 'dot'];
          if (e.offsetMm) { px += e.offsetMm[0]; py -= e.offsetMm[1]; } // +y = 위쪽
          if (e.symbol === 'square') body.push('<rect x="' + f(px - s / 2) + '" y="' + f(py - s / 2) + '" width="' + s + '" height="' + s + '" fill="#000"/>');
          else if (e.symbol === 'cross') body.push('<path d="M' + f(px - s / 2) + ' ' + f(py) + 'H' + f(px + s / 2) + 'M' + f(px) + ' ' + f(py - s / 2) + 'V' + f(py + s / 2) + '" stroke="#000" stroke-width="1.2" fill="none"/>');
          else body.push('<circle cx="' + f(px) + '" cy="' + f(py) + '" r="' + f(s / 2) + '" fill="#3a3a3a"/>');
          break;
        }
        case 'dimension': body.push(renderDim(e, L, spec)); break;
        case 'leader': break; // 후처리 일괄 렌더 (스태킹 필요)
        case 'label': {
          var cells = e._cells || translate(e.text, spec.brailleCode);
          var sz = labelSize(cells);
          var lx = L.X(e.at[0]), ly = L.Y(e.at[1]);
          if (e.offsetMm) { lx += e.offsetMm[0]; ly -= e.offsetMm[1]; } // +y = 위쪽
          if (e.anchor === 'middle') lx -= sz.w / 2;
          if (e.anchor === 'end') lx -= sz.w;
          body.push('<g fill="#000">' + brailleSVG(cells, lx, ly - sz.h / 2) + '</g>');
          body.push(inkText(spec, e.text, lx + sz.w / 2, ly + sz.h / 2 + 0.8));
          break;
        }
      }
    });

    renderLeaders(spec, L, body, report);

    // 타이틀 (중앙 정렬 점자)
    var titleW = 0;
    L.titleLines.forEach(function (t, i) {
      var cells = translate(t, spec.brailleCode);
      var sz = labelSize(cells);
      if (sz.w > titleW) titleW = sz.w;
      var tx0 = L.inner.x + (L.inner.w - sz.w) / 2, ty0 = L.titleY + i * P.braille.lineAdv;
      body.push('<g fill="#000">' + brailleSVG(cells, tx0, ty0) + '</g>');
      body.push(inkText(spec, t, tx0 + sz.w / 2, ty0 + sz.h + 0.8));
      L.titleBox = { cx: L.inner.x + L.inner.w / 2, y0: L.titleY, w: titleW, h: (i + 1) * P.braille.lineAdv };
    });

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + L.page.w + 'mm" height="' + L.page.h + 'mm" viewBox="0 0 ' + L.page.w + ' ' + L.page.h + '">' +
      '<defs>' + Object.keys(defs).map(function (k) { return defs[k]; }).join('') + '</defs>' +
      '<rect width="100%" height="100%" fill="#fff"/>' + body.join('\n') + '</svg>';
    return { svg: svg, report: report, layout: L };
  }

  /* 리드선 레이블: BANA 관행 — 가장 얇은 선, 레이블은 도형 바깥, 목표점에 도트.
   * 같은 사이드의 레이블은 수직 스태킹으로 자동 충돌 회피. */
  function renderLeaders(spec, L, body, report) {
    var P = PROFILE, moved = false;
    ['left', 'right', 'top', 'bottom'].forEach(function (side) {
      var ls = spec.elements.filter(function (e) { return e.type === 'leader' && e.side === side; });
      if (!ls.length) return;
      var GAP = (L.dimBands && L.dimBands[side]) ? L.dimBands[side] + 6 : 12; // 치수 밴드 바깥으로
      ls.forEach(function (e) { e._tx = L.X(e.at[0]); e._ty = L.Y(e.at[1]); });
      if (side === 'left' || side === 'right') {
        ls.sort(function (a, b) { return a._ty - b._ty; });
        for (var i = 0; i < ls.length; i++) {
          var want = ls[i]._ty;
          if (i > 0 && want < ls[i - 1]._ly + P.braille.lineAdv) { want = ls[i - 1]._ly + P.braille.lineAdv; moved = true; }
          ls[i]._ly = want;
        }
        var edgeX = side === 'left' ? L.X(L.bb.x0) : L.X(L.bb.x0 + L.bb.w);
        ls.forEach(function (e) {
          var labelEdge = side === 'left' ? edgeX - GAP : edgeX + GAP;
          var lx = side === 'left' ? labelEdge - e._size.w : labelEdge;
          body.push('<g fill="#000">' + brailleSVG(e._cells, lx, e._ly - e._size.h / 2) + '</g>');
          body.push(inkText(spec, e.text, lx + e._size.w / 2, e._ly + e._size.h / 2 + 0.8));
          e._labelMm = [lx + e._size.w / 2, e._ly];   // 히트 영역 (편집 UI용)
          var sx0 = side === 'left' ? labelEdge + 2.5 : labelEdge - 2.5;
          // 리드선은 미세 파선 — 치수선(실선 최세선)과 촉각으로 구별 (페르소나 피드백)
          body.push('<line x1="' + f(sx0) + '" y1="' + f(e._ly) + '" x2="' + f(e._tx) + '" y2="' + f(e._ty) + '" ' + strokeAttr('dim') + ' stroke-dasharray="2,1.2"/>');
          body.push('<circle cx="' + f(e._tx) + '" cy="' + f(e._ty) + '" r="1.1" fill="#000"/>');
        });
      } else {
        var edgeY = side === 'top' ? L.Y(L.bb.y0 + L.bb.h) : L.Y(L.bb.y0);
        ls.forEach(function (e) {
          var ly = side === 'top' ? edgeY - GAP - e._size.h : edgeY + GAP;
          body.push('<g fill="#000">' + brailleSVG(e._cells, e._tx - e._size.w / 2, ly) + '</g>');
          body.push(inkText(spec, e.text, e._tx, ly + e._size.h + 0.8));
          e._labelMm = [e._tx, ly + e._size.h / 2];   // 히트 영역 (편집 UI용)
          var sy0 = side === 'top' ? ly + e._size.h + 2 : ly - 2;
          body.push('<line x1="' + f(e._tx) + '" y1="' + f(sy0) + '" x2="' + f(e._tx) + '" y2="' + f(e._ty) + '" ' + strokeAttr('dim') + ' stroke-dasharray="2,1.2"/>');
          body.push('<circle cx="' + f(e._tx) + '" cy="' + f(e._ty) + '" r="1.1" fill="#000"/>');
        });
      }
    });
    if (moved) report.push('점자 레이블이 겹치지 않도록 세로 간격을 자동 조정했어요 (행간 10.16mm 규격).');
  }

  /* 치수선: 얇은 선 + 엔드틱 + 점자 레이블 (BANA 스타일) */
  function renderDim(e, L, spec) {
    var P = PROFILE, out = [], t = P.dim.tick / 2;
    var cells = e._cells, sz = e._size, off = e._off || e.offset || P.dim.offset;
    var a = strokeAttr('dim');
    if (e.side === 'top' || e.side === 'bottom') {
      var x1 = L.X(e.from[0]), x2 = L.X(e.to[0]);
      var edge = e.side === 'top' ? L.Y(L.bb.y0 + L.bb.h) : L.Y(L.bb.y0);
      var y = e.side === 'top' ? edge - off : edge + off;
      out.push('<line x1="' + f(x1) + '" y1="' + f(y) + '" x2="' + f(x2) + '" y2="' + f(y) + '" ' + a + '/>');
      [x1, x2].forEach(function (x) {
        out.push('<line x1="' + f(x) + '" y1="' + f(y - t) + '" x2="' + f(x) + '" y2="' + f(y + t) + '" ' + a + '/>');
      });
      var ly = e.side === 'top' ? y - P.dim.labelGap - sz.h - (spec.inkText ? 4 : 0) : y + P.dim.labelGap;
      out.push('<g fill="#000">' + brailleSVG(cells, (x1 + x2) / 2 - sz.w / 2, ly) + '</g>');
      out.push(inkText(spec, e.label, (x1 + x2) / 2, ly + sz.h + 0.8));
      e._labelMm = [(x1 + x2) / 2, ly + sz.h / 2];   // 히트 영역 (편집 UI용)
      e._lineMm = [x1, y, x2, y];
    } else {
      var y1 = L.Y(e.from[1]), y2 = L.Y(e.to[1]);
      var edgeX = e.side === 'left' ? L.X(L.bb.x0) : L.X(L.bb.x0 + L.bb.w);
      var x = e.side === 'left' ? edgeX - off : edgeX + off;
      out.push('<line x1="' + f(x) + '" y1="' + f(y1) + '" x2="' + f(x) + '" y2="' + f(y2) + '" ' + a + '/>');
      [y1, y2].forEach(function (yy) {
        out.push('<line x1="' + f(x - t) + '" y1="' + f(yy) + '" x2="' + f(x + t) + '" y2="' + f(yy) + '" ' + a + '/>');
      });
      var lx = e.side === 'left' ? x - P.dim.labelGap - sz.w : x + P.dim.labelGap;
      out.push('<g fill="#000">' + brailleSVG(cells, lx, (y1 + y2) / 2 - sz.h / 2) + '</g>');
      out.push(inkText(spec, e.label, lx + sz.w / 2, (y1 + y2) / 2 + sz.h / 2 + 0.8));
      e._labelMm = [lx + sz.w / 2, (y1 + y2) / 2];   // 히트 영역 (편집 UI용)
      e._lineMm = [x, y1, x, y2];
    }
    return out.join('\n');
  }

  return { PROFILE: PROFILE, PAPERS: PAPERS, render: render, translate: translate, brailleSVG: brailleSVG, labelSize: labelSize, TEXTURES: TEXTURES };
});
