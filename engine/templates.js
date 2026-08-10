/* templates.js — 파라미터화된 TGIL 템플릿 카탈로그
 * 각 템플릿 = 스펙 생성 함수. 제작자는 빈칸(파라미터)만 채운다.
 * 언어: 'en' → UEB G2, 'ko' → 한국 점자 (레이블 텍스트를 언어별로 생성)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TEMPLATES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function u(lang, en, ko) { return lang === 'ko' ? ko : en; }

  var T = [];

  /* ── 1. 테니스 코트 (단식/복식) ── */
  T.push({
    id: 'tennis-court', category: 'Physical and Recreational Activities',
    name: { en: 'Tennis Court', ko: '테니스 코트' },
    params: [
      { key: 'mode', label: { en: 'Court type', ko: '코트 종류' }, type: 'select', options: ['singles', 'doubles'], default: 'singles' },
      { key: 'showDims', label: { en: 'Show dimensions', ko: '치수 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var singles = p.mode !== 'doubles';
      var W = 78, H = singles ? 27 : 36;
      var els = [
        { type: 'region', rect: [0, 0, W, H], edge: 'outline' },
        { type: 'line', from: [18, 0], to: [18, H], style: 'minor' },
        { type: 'line', from: [60, 0], to: [60, H], style: 'minor' },
        { type: 'line', from: [18, H / 2], to: [60, H / 2], style: 'minor' },
        { type: 'line', from: [39, 0], to: [39, H], style: 'dashed', overshootMm: 8 },
        { type: 'pointSymbol', at: [39, H], symbol: 'dot', offsetMm: [0, 11] },
        { type: 'pointSymbol', at: [39, 0], symbol: 'dot', offsetMm: [0, -11] },
        { type: 'tick', at: [0, H / 2], dir: [1, 0], len: 5 },
        { type: 'tick', at: [W, H / 2], dir: [-1, 0], len: 5 }
      ];
      if (!singles) {  // 복식: 단식 사이드라인 추가
        els.push({ type: 'line', from: [0, 4.5], to: [W, 4.5], style: 'minor' });
        els.push({ type: 'line', from: [0, H - 4.5], to: [W, H - 4.5], style: 'minor' });
      }
      if (p.showDims) {
        els.push({ type: 'dimension', from: [0, H], to: [W, H], side: 'top', label: u(lang, '78 feet', '78피트') });
        els.push({ type: 'dimension', from: [0, 0], to: [0, H], side: 'left', label: u(lang, H + ' feet', H + '피트') });
        els.push({ type: 'dimension', from: [0, 0], to: [39, 0], side: 'bottom', label: u(lang, '39 feet', '39피트'), offset: 24 });
      }
      return {
        lang: lang,
        title: { text: u(lang, 'Tennis Court, ' + (singles ? 'Singles' : 'Doubles'), '테니스 코트 ' + (singles ? '단식' : '복식')) },
        canvas: { stretch: true, aspect: 1.65 }, units: 'feet', elements: els
      };
    }
  });

  /* ── 2. 농구 코트 ── */
  T.push({
    id: 'basketball-court', category: 'Physical and Recreational Activities',
    name: { en: 'Basketball Court', ko: '농구 코트' },
    params: [
      { key: 'showDims', label: { en: 'Show dimensions', ko: '치수 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var W = 94, H = 50, keyW = 19, keyH = 12, r = 6;
      var els = [
        { type: 'region', rect: [0, 0, W, H], edge: 'outline' },
        { type: 'line', from: [W / 2, 0], to: [W / 2, H], style: 'major' },
        { type: 'circle', at: [W / 2, H / 2], r: r, style: 'major' },
        // 좌우 키(페인트존) + 자유투 서클(코트 안쪽 반 파선)
        { type: 'region', rect: [0, H / 2 - keyH / 2, keyW, keyH], edge: 'minor' },
        { type: 'region', rect: [W - keyW, H / 2 - keyH / 2, keyW, keyH], edge: 'minor' },
        { type: 'arc', at: [keyW, H / 2], r: r, from: -90, to: 90, style: 'minor' },
        { type: 'arc', at: [W - keyW, H / 2], r: r, from: 90, to: 270, style: 'minor' },
        // 3점 라인 (호만, 단순화)
        { type: 'arc', at: [5.25, H / 2], r: 23.75, from: -68, to: 68, style: 'minor' },
        { type: 'arc', at: [W - 5.25, H / 2], r: 23.75, from: 112, to: 248, style: 'minor' },
        // 바스켓 위치
        { type: 'pointSymbol', at: [5.25, H / 2], symbol: 'dot' },
        { type: 'pointSymbol', at: [W - 5.25, H / 2], symbol: 'dot' }
      ];
      if (p.showDims) {
        els.push({ type: 'dimension', from: [0, H], to: [W, H], side: 'top', label: u(lang, '94 feet', '94피트') });
        els.push({ type: 'dimension', from: [0, 0], to: [0, H], side: 'left', label: u(lang, '50 feet', '50피트') });
      }
      return {
        lang: lang, title: { text: u(lang, 'Basketball Court', '농구 코트') },
        canvas: { stretch: true, aspect: 1.7 }, units: 'feet', elements: els
      };
    }
  });

  /* ── 3. 배구 코트 ── */
  T.push({
    id: 'volleyball-court', category: 'Physical and Recreational Activities',
    name: { en: 'Volleyball Court', ko: '배구 코트' },
    params: [
      { key: 'showDims', label: { en: 'Show dimensions', ko: '치수 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var W = 18, H = 9; // meters
      var els = [
        { type: 'region', rect: [0, 0, W, H], edge: 'outline' },
        { type: 'line', from: [6, 0], to: [6, H], style: 'minor' },     // attack lines
        { type: 'line', from: [12, 0], to: [12, H], style: 'minor' },
        { type: 'line', from: [9, 0], to: [9, H], style: 'dashed', overshootMm: 8 },
        { type: 'pointSymbol', at: [9, H], symbol: 'dot', offsetMm: [0, 11] },
        { type: 'pointSymbol', at: [9, 0], symbol: 'dot', offsetMm: [0, -11] }
      ];
      if (p.showDims) {
        els.push({ type: 'dimension', from: [0, H], to: [W, H], side: 'top', label: u(lang, '18 meters', '18미터') });
        els.push({ type: 'dimension', from: [0, 0], to: [0, H], side: 'left', label: u(lang, '9 meters', '9미터') });
        els.push({ type: 'dimension', from: [6, 0], to: [9, 0], side: 'bottom', label: u(lang, '3 meters', '3미터'), offset: 24 });
      }
      return {
        lang: lang, title: { text: u(lang, 'Volleyball Court', '배구 코트') },
        canvas: { stretch: true, aspect: 1.65 }, units: 'meters', elements: els
      };
    }
  });

  /* ── 4. 좌표평면 (Cartesian graph) ── */
  T.push({
    id: 'cartesian-grid', category: 'Mathematics/Algebra',
    name: { en: 'Cartesian Graph', ko: '좌표평면' },
    params: [
      { key: 'xmin', label: { en: 'X min', ko: 'X 최소' }, type: 'number', default: -5 },
      { key: 'xmax', label: { en: 'X max', ko: 'X 최대' }, type: 'number', default: 5 },
      { key: 'ymin', label: { en: 'Y min', ko: 'Y 최소' }, type: 'number', default: -5 },
      { key: 'ymax', label: { en: 'Y max', ko: 'Y 최대' }, type: 'number', default: 5 },
      { key: 'grid', label: { en: 'Show grid', ko: '격자 표시' }, type: 'bool', default: true },
      { key: 'labelEvery', label: { en: 'Label every N', ko: 'N칸마다 레이블' }, type: 'number', default: 5 }
    ],
    build: function (p, lang) {
      var x0 = +p.xmin, x1 = +p.xmax, y0 = +p.ymin, y1 = +p.ymax, els = [], i;
      var pad = 0.6; // 축 화살표 여유
      if (p.grid) {
        for (i = Math.ceil(x0); i <= x1; i++) els.push({ type: 'line', from: [i, y0], to: [i, y1], style: 'minor' });
        for (i = Math.ceil(y0); i <= y1; i++) els.push({ type: 'line', from: [x0, i], to: [x1, i], style: 'minor' });
      } else {
        els.push({ type: 'region', rect: [x0, y0, x1 - x0, y1 - y0], edge: 'minor' });
      }
      // 축 (0이 범위 안일 때) — major + 화살표
      var ax = (y0 <= 0 && y1 >= 0) ? 0 : y0, ay = (x0 <= 0 && x1 >= 0) ? 0 : x0;
      els.push({ type: 'line', from: [x0 - pad, ax], to: [x1 + pad, ax], style: 'major', arrows: true });
      els.push({ type: 'line', from: [ay, y0 - pad], to: [ay, y1 + pad], style: 'major', arrows: true });
      // 눈금 레이블 — 격자 바깥 여백에 배치 (BANA 관행: 점자가 선과 겹치지 않게)
      var ev = Math.max(1, Math.round(+p.labelEvery));
      for (i = Math.ceil(x0 / ev) * ev; i <= x1; i += ev) {
        if (i === 0) continue;
        els.push({ type: 'label', at: [i, y0], text: String(i), anchor: 'middle', offsetMm: [0, -9] });
      }
      for (i = Math.ceil(y0 / ev) * ev; i <= y1; i += ev) {
        if (i === 0) continue;
        els.push({ type: 'label', at: [x0, i], text: String(i), anchor: 'end', offsetMm: [-6, 0] });
      }
      return {
        lang: lang, title: { text: u(lang, 'Cartesian Graph', '좌표평면') },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 5. 수직선 (number line) ── */
  T.push({
    id: 'number-line', category: 'Mathematics/Basic Math',
    name: { en: 'Number Line', ko: '수직선' },
    params: [
      { key: 'min', label: { en: 'Min', ko: '최소' }, type: 'number', default: 0 },
      { key: 'max', label: { en: 'Max', ko: '최대' }, type: 'number', default: 10 },
      { key: 'marked', label: { en: 'Marked points (comma)', ko: '표시할 점 (쉼표)' }, type: 'text', default: '3, 7' }
    ],
    build: function (p, lang) {
      var a = +p.min, b = +p.max, els = [], i;
      els.push({ type: 'line', from: [a - 0.5, 0], to: [b + 0.5, 0], style: 'major', arrows: true });
      for (i = a; i <= b; i++) {
        els.push({ type: 'tick', at: [i, 0], dir: [0, 1], len: 3, style: 'major' });
        els.push({ type: 'tick', at: [i, 0], dir: [0, -1], len: 3, style: 'major' });
        els.push({ type: 'label', at: [i, 0], text: String(i), anchor: 'middle', offsetMm: [0, -9] });
      }
      String(p.marked || '').split(',').forEach(function (s) {
        var v = parseFloat(s); if (!isNaN(v)) els.push({ type: 'pointSymbol', at: [v, 0], symbol: 'dot' });
      });
      return {
        lang: lang, title: { text: u(lang, 'Number Line', '수직선') },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 6. 야구장 ── */
  T.push({
    id: 'baseball-field', category: 'Physical and Recreational Activities',
    name: { en: 'Baseball Field', ko: '야구장' },
    params: [
      { key: 'showLabels', label: { en: 'Base labels (key: 1,2,3,h,p)', ko: '베이스 레이블 (키: 1,2,3,h,p)' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var B = 90 / Math.SQRT2;          // 베이스 간 90ft → 다이아몬드 좌표
      var R = 250, D = R / Math.SQRT2;  // 외야 펜스
      var els = [
        // 파울 라인 + 외야 펜스 호
        { type: 'line', from: [0, 0], to: [D, D], style: 'outline' },
        { type: 'line', from: [0, 0], to: [-D, D], style: 'outline' },
        { type: 'arc', at: [0, 0], r: R, from: 45, to: 135, style: 'outline' },
        // 내야 다이아몬드
        { type: 'polyline', points: [[0, 0], [B, B], [0, 2 * B], [-B, B]], closed: true, style: 'major' },
        // 베이스 (■) + 홈플레이트·투수판
        { type: 'pointSymbol', at: [B, B], symbol: 'square' },
        { type: 'pointSymbol', at: [0, 2 * B], symbol: 'square' },
        { type: 'pointSymbol', at: [-B, B], symbol: 'square' },
        { type: 'pointSymbol', at: [0, 0], symbol: 'dot' },
        { type: 'pointSymbol', at: [0, 60.5], symbol: 'cross' }
      ];
      if (p.showLabels) {
        els.push({ type: 'label', at: [B, B], text: '1', anchor: 'middle', offsetMm: [9, 0] });
        els.push({ type: 'label', at: [0, 2 * B], text: '2', anchor: 'middle', offsetMm: [0, 9] });
        els.push({ type: 'label', at: [-B, B], text: '3', anchor: 'middle', offsetMm: [-9, 0] });
        els.push({ type: 'label', at: [0, 0], text: 'h', anchor: 'middle', offsetMm: [0, -9] });
        els.push({ type: 'label', at: [0, 60.5], text: 'p', anchor: 'middle', offsetMm: [9, 0] });
      }
      return {
        lang: lang, title: { text: u(lang, 'Baseball Field', '야구장') },
        canvas: {}, units: 'feet', elements: els,
        key: [['1', u(lang, 'first base', '1루')], ['2', u(lang, 'second base', '2루')], ['3', u(lang, 'third base', '3루')],
              ['h', u(lang, 'home plate', '홈플레이트')], ['p', u(lang, 'pitcher', '투수판')]]
      };
    }
  });

  /* ── 7. 막대그래프 ── */
  T.push({
    id: 'bar-chart', category: 'Mathematics/Statistics',
    name: { en: 'Bar Chart', ko: '막대그래프' },
    params: [
      { key: 'cats', label: { en: 'Categories (comma)', ko: '항목 (쉼표)' }, type: 'text', default: 'a, b, c, d' },
      { key: 'vals', label: { en: 'Values (comma)', ko: '값 (쉼표)' }, type: 'text', default: '3, 7, 5, 9' },
      { key: 'ystep', label: { en: 'Y axis step', ko: 'Y축 눈금 간격' }, type: 'number', default: 1 },
      { key: 'fill', label: { en: 'Bar texture', ko: '막대 텍스처' }, type: 'select', options: ['diag-lines', 'dots', 'hlines', 'vlines', 'none'], default: 'diag-lines' }
    ],
    build: function (p, lang) {
      var cats = String(p.cats).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var vals = String(p.vals).split(',').map(parseFloat).filter(function (v) { return !isNaN(v); });
      var n = Math.min(cats.length, vals.length);
      var ymax = Math.max.apply(null, vals.slice(0, n));
      var step = Math.max(0.1, +p.ystep || 1);
      ymax = Math.ceil(ymax / step) * step;
      var els = [
        { type: 'line', from: [0, 0], to: [0, ymax * 1.08], style: 'major', arrows: 'end' },
        { type: 'line', from: [0, 0], to: [n, 0], style: 'major' }
      ], i;
      for (i = 0; i < n; i++) {
        var el = { type: 'region', rect: [i + 0.18, 0, 0.64, vals[i]], edge: 'major' };
        if (p.fill !== 'none') el.fill = p.fill;
        els.push(el);
        els.push({ type: 'label', at: [i + 0.5, 0], text: cats[i], anchor: 'middle', offsetMm: [0, -8] });
      }
      var yEvery = ymax / step > 12 ? Math.ceil(ymax / step / 12) : 1; // 눈금 과밀 방지
      for (i = 0; i <= ymax + 1e-9; i += step * yEvery) {
        els.push({ type: 'tick', at: [0, i], dir: [-1, 0], len: 3, style: 'major' });
        els.push({ type: 'label', at: [0, i], text: String(Math.round(i * 100) / 100), anchor: 'end', offsetMm: [-6, 0] });
      }
      return {
        lang: lang, title: { text: u(lang, 'Bar Chart', '막대그래프') },
        canvas: { stretch: true, aspect: 1.25 }, units: 'units', elements: els
      };
    }
  });

  /* ── 8. 꺾은선그래프 ── */
  T.push({
    id: 'line-graph', category: 'Mathematics/Statistics',
    name: { en: 'Line Graph', ko: '꺾은선그래프' },
    params: [
      { key: 'vals', label: { en: 'Values (comma)', ko: '값 (쉼표)' }, type: 'text', default: '2, 5, 3, 8, 6' },
      { key: 'xstart', label: { en: 'X start', ko: 'X 시작' }, type: 'number', default: 0 },
      { key: 'ystep', label: { en: 'Y axis step', ko: 'Y축 눈금 간격' }, type: 'number', default: 2 },
      { key: 'grid', label: { en: 'Show grid', ko: '격자 표시' }, type: 'bool', default: false }
    ],
    build: function (p, lang) {
      var vals = String(p.vals).split(',').map(parseFloat).filter(function (v) { return !isNaN(v); });
      var x0 = Math.round(+p.xstart) || 0, n = vals.length;
      var ymax = Math.max.apply(null, vals), step = Math.max(0.1, +p.ystep || 1);
      ymax = Math.ceil(ymax / step) * step;
      var els = [], i;
      if (p.grid) {
        for (i = 0; i < n; i++) els.push({ type: 'line', from: [x0 + i, 0], to: [x0 + i, ymax], style: 'minor' });
        for (i = step; i <= ymax + 1e-9; i += step) els.push({ type: 'line', from: [x0, i], to: [x0 + n - 1, i], style: 'minor' });
      }
      els.push({ type: 'line', from: [x0, 0], to: [x0, ymax * 1.08], style: 'major', arrows: 'end' });
      els.push({ type: 'line', from: [x0, 0], to: [x0 + n - 0.5, 0], style: 'major', arrows: 'end' });
      els.push({ type: 'polyline', points: vals.map(function (v, k) { return [x0 + k, v]; }), style: 'outline' });
      vals.forEach(function (v, k) {
        els.push({ type: 'pointSymbol', at: [x0 + k, v], symbol: 'dot' });
        els.push({ type: 'label', at: [x0 + k, 0], text: String(x0 + k), anchor: 'middle', offsetMm: [0, -8] });
      });
      for (i = step; i <= ymax + 1e-9; i += step) {
        els.push({ type: 'tick', at: [x0, i], dir: [-1, 0], len: 3, style: 'major' });
        els.push({ type: 'label', at: [x0, i], text: String(Math.round(i * 100) / 100), anchor: 'end', offsetMm: [-6, 0] });
      }
      return {
        lang: lang, title: { text: u(lang, 'Line Graph', '꺾은선그래프') },
        canvas: { stretch: true, aspect: 1.3 }, units: 'units', elements: els
      };
    }
  });

  /* ── 9. 분수 원 ── */
  T.push({
    id: 'fraction-circle', category: 'Mathematics/Fractions',
    name: { en: 'Fraction Circle', ko: '분수 원' },
    params: [
      { key: 'num', label: { en: 'Numerator', ko: '분자' }, type: 'number', default: 1 },
      { key: 'den', label: { en: 'Denominator', ko: '분모' }, type: 'number', default: 3 },
      { key: 'fill', label: { en: 'Shaded texture', ko: '칠한 부분 텍스처' }, type: 'select', options: ['diag-lines', 'dots', 'hlines'], default: 'diag-lines' },
      { key: 'showLabel', label: { en: 'Show fraction label', ko: '분수 레이블 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var den = Math.max(1, Math.round(+p.den)), num = Math.min(den, Math.max(0, Math.round(+p.num)));
      var els = [], i;
      for (i = 0; i < den; i++) {
        var a0 = 90 - (i + 1) * 360 / den, a1 = 90 - i * 360 / den;
        var el = { type: 'sector', at: [0, 0], r: 1, from: a0, to: a1, style: 'major' };
        if (i < num) el.fill = p.fill;
        els.push(el);
      }
      els.push({ type: 'circle', at: [0, 0], r: 1, style: 'outline' });
      if (p.showLabel) els.push({ type: 'label', at: [0, -1], text: num + '/' + den, anchor: 'middle', offsetMm: [0, -12] });
      return {
        lang: lang, title: { text: u(lang, 'Fraction: ' + num + '/' + den, '분수: ' + num + '/' + den) },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 10. 분수 막대 ── */
  T.push({
    id: 'fraction-strip', category: 'Mathematics/Fractions',
    name: { en: 'Fraction Strip', ko: '분수 막대' },
    params: [
      { key: 'num', label: { en: 'Numerator', ko: '분자' }, type: 'number', default: 3 },
      { key: 'den', label: { en: 'Denominator', ko: '분모' }, type: 'number', default: 4 },
      { key: 'fill', label: { en: 'Shaded texture', ko: '칠한 부분 텍스처' }, type: 'select', options: ['diag-lines', 'dots', 'vlines'], default: 'diag-lines' },
      { key: 'showLabel', label: { en: 'Show fraction label', ko: '분수 레이블 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var den = Math.max(1, Math.round(+p.den)), num = Math.min(den, Math.max(0, Math.round(+p.num)));
      var H = Math.max(1.1, den * 0.28), els = [], i;
      for (i = 0; i < den; i++) {
        var el = { type: 'region', rect: [i, 0, 1, H], edge: 'major' };
        if (i < num) el.fill = p.fill;
        els.push(el);
      }
      els.push({ type: 'region', rect: [0, 0, den, H], edge: 'outline' });
      if (p.showLabel) els.push({ type: 'label', at: [den / 2, 0], text: num + '/' + den, anchor: 'middle', offsetMm: [0, -10] });
      return {
        lang: lang, title: { text: u(lang, 'Fraction: ' + num + '/' + den, '분수: ' + num + '/' + den) },
        canvas: { stretch: true, aspect: 2.6 }, units: 'units', elements: els
      };
    }
  });

  /* ── 11. 각도 ── */
  T.push({
    id: 'angle', category: 'Mathematics/Geometry',
    name: { en: 'Angle', ko: '각도' },
    params: [
      { key: 'deg', label: { en: 'Angle (degrees)', ko: '각도 (도)' }, type: 'number', default: 45 },
      { key: 'showLabel', label: { en: 'Show label', ko: '레이블 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var a = Math.max(1, Math.min(359, +p.deg || 45)), rad = a * Math.PI / 180;
      var els = [
        { type: 'line', from: [0, 0], to: [3, 0], style: 'major', arrows: 'end' },
        { type: 'line', from: [0, 0], to: [3 * Math.cos(rad), 3 * Math.sin(rad)], style: 'major', arrows: 'end' },
        { type: 'arc', at: [0, 0], r: 0.85, from: 0, to: a, style: 'minor' },
        { type: 'pointSymbol', at: [0, 0], symbol: 'dot' }
      ];
      if (p.showLabel) {
        var mid = rad / 2;
        els.push({ type: 'label', at: [1.5 * Math.cos(mid), 1.5 * Math.sin(mid)], text: u(lang, a + ' degrees', a + '도'), anchor: 'middle' });
      }
      return {
        lang: lang, title: { text: u(lang, 'Angle, ' + a + ' Degrees', '각도 ' + a + '도') },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 12. 기본 도형 ── */
  T.push({
    id: 'shapes', category: 'Mathematics/Shapes',
    name: { en: 'Basic Shape', ko: '기본 도형' },
    params: [
      { key: 'shape', label: { en: 'Shape', ko: '도형' }, type: 'select', options: ['square', 'rectangle', 'triangle', 'right-triangle', 'circle'], default: 'rectangle' },
      // 도형마다 실제로 의미 있는 수치만 노출한다 (정사각형은 한 변, 원은 지름)
      { key: 'side', label: { en: 'Side length', ko: '한 변 길이' }, type: 'number', default: 5, showIf: function (p) { return p.shape === 'square'; } },
      { key: 'dia', label: { en: 'Diameter', ko: '지름' }, type: 'number', default: 6, showIf: function (p) { return p.shape === 'circle'; } },
      { key: 'w', label: { en: 'Width', ko: '가로' }, type: 'number', default: 6, showIf: function (p) { return p.shape !== 'square' && p.shape !== 'circle'; } },
      { key: 'h', label: { en: 'Height', ko: '세로' }, type: 'number', default: 4, showIf: function (p) { return p.shape !== 'square' && p.shape !== 'circle'; } },
      { key: 'unit', label: { en: 'Unit word', ko: '단위 단어' }, type: 'text', default: 'inches' },
      { key: 'showDims', label: { en: 'Show dimensions', ko: '치수 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var w, h;
      if (p.shape === 'square') { w = h = Math.max(0.1, +p.side || 5); }
      else if (p.shape === 'circle') { w = h = Math.max(0.1, +p.dia || 6); }
      else { w = Math.max(0.1, +p.w || 6); h = Math.max(0.1, +p.h || 4); }
      var unit = p.unit ? ' ' + p.unit : '';
      var els = [], names = {
        square: ['Square', '정사각형'], rectangle: ['Rectangle', '직사각형'],
        triangle: ['Triangle', '삼각형'], 'right-triangle': ['Right Triangle', '직각삼각형'], circle: ['Circle', '원']
      };
      if (p.shape === 'circle') {
        var r = w / 2;
        els.push({ type: 'circle', at: [r, r], r: r, style: 'outline' });
        els.push({ type: 'line', from: [0, r], to: [w, r], style: 'dashed' });
        if (p.showDims) {
          els.push({ type: 'dimension', from: [0, 2 * r], to: [w, 2 * r], side: 'top', label: w + unit });
          els.push({ type: 'dimension', from: [0, 0], to: [0, 2 * r], side: 'left', label: w + unit }); // 세로 지름
        }
      } else if (p.shape === 'triangle') {
        els.push({ type: 'polyline', points: [[0, 0], [w, 0], [w / 2, h]], closed: true, style: 'outline' });
        if (p.showDims) {
          els.push({ type: 'dimension', from: [0, 0], to: [w, 0], side: 'bottom', label: w + unit });
          els.push({ type: 'dimension', from: [0, 0], to: [0, h], side: 'left', label: h + unit });
        }
      } else if (p.shape === 'right-triangle') {
        els.push({ type: 'polyline', points: [[0, 0], [w, 0], [0, h]], closed: true, style: 'outline' });
        if (p.showDims) {
          els.push({ type: 'dimension', from: [0, 0], to: [w, 0], side: 'bottom', label: w + unit });
          els.push({ type: 'dimension', from: [0, 0], to: [0, h], side: 'left', label: h + unit });
        }
      } else {
        els.push({ type: 'region', rect: [0, 0, w, h], edge: 'outline' });
        if (p.showDims) {
          els.push({ type: 'dimension', from: [0, h], to: [w, h], side: 'top', label: w + unit });
          els.push({ type: 'dimension', from: [0, 0], to: [0, h], side: 'left', label: h + unit });
        }
      }
      var nm = names[p.shape] || names.rectangle;
      return {
        lang: lang, title: { text: u(lang, nm[0], nm[1]) },
        canvas: {}, units: p.unit || 'units', elements: els
      };
    }
  });

  /* ── 13. 시계 ── */
  T.push({
    id: 'clock', category: 'Daily Living',
    name: { en: 'Clock Face', ko: '시계' },
    params: [
      { key: 'time', label: { en: 'Time (h:mm)', ko: '시각 (h:mm)' }, type: 'text', default: '3:30' },
      { key: 'allNumbers', label: { en: 'All 12 numbers', ko: '숫자 12개 모두' }, type: 'bool', default: false }
    ],
    build: function (p, lang) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(p.time).trim());
      var hh = m ? (+m[1] % 12) : 3, mm = m ? Math.min(59, +m[2]) : 30;
      var els = [{ type: 'circle', at: [0, 0], r: 1, style: 'outline' }], i;
      for (i = 0; i < 12; i++) {
        var a = Math.PI / 2 - i * Math.PI / 6;
        els.push({ type: 'line', from: [0.9 * Math.cos(a), 0.9 * Math.sin(a)], to: [Math.cos(a), Math.sin(a)], style: 'major' });
        if (p.allNumbers || i % 3 === 0)
          els.push({ type: 'label', at: [1.22 * Math.cos(a), 1.22 * Math.sin(a)], text: String(i === 0 ? 12 : i), anchor: 'middle' });
      }
      var ha = Math.PI / 2 - (hh + mm / 60) * Math.PI / 6;
      var ma = Math.PI / 2 - mm * Math.PI / 30;
      els.push({ type: 'line', from: [0, 0], to: [0.5 * Math.cos(ha), 0.5 * Math.sin(ha)], style: 'outline' });
      els.push({ type: 'line', from: [0, 0], to: [0.8 * Math.cos(ma), 0.8 * Math.sin(ma)], style: 'major', arrows: 'end' });
      els.push({ type: 'pointSymbol', at: [0, 0], symbol: 'dot' });
      var timeText = (hh === 0 ? 12 : hh) + ':' + (mm < 10 ? '0' : '') + mm;
      return {
        lang: lang, title: { text: u(lang, 'Clock, ' + timeText, '시계 ' + timeText) },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 14. 원그래프 (초등 '여러가지 그래프') ── */
  T.push({
    id: 'pie-chart', category: 'Mathematics/Statistics',
    name: { en: 'Pie Chart', ko: '원그래프' },
    params: [
      { key: 'items', label: { en: 'Items "name value, …"', ko: '항목 "이름 값, …"' }, type: 'text', default: '국어 30, 수학 25, 과학 20, 기타 25' }
    ],
    build: function (p, lang) {
      var parts = String(p.items).split(',').map(function (s) {
        var m = s.trim().match(/^(.+?)\s+([\d.]+)$/);
        return m ? { name: m[1], v: parseFloat(m[2]) } : null;
      }).filter(Boolean);
      var total = parts.reduce(function (a, b) { return a + b.v; }, 0) || 1;
      var TX = ['diag-lines', 'dots', 'hlines', 'vlines', null];
      var els = [], cum = 0;
      parts.forEach(function (it, i) {
        var pct = it.v / total * 100;
        var a1 = 90 - cum * 3.6, a0 = 90 - (cum + pct) * 3.6;   // 12시부터 시계방향 (교과서 관행)
        var el = { type: 'sector', at: [0, 0], r: 1, from: a0, to: a1, style: 'major' };
        if (TX[i % TX.length]) el.fill = TX[i % TX.length];
        els.push(el);
        var mid = (90 - (cum + pct / 2) * 3.6) * Math.PI / 180;
        els.push({ type: 'leader', at: [0.62 * Math.cos(mid), 0.62 * Math.sin(mid)], text: it.name + ' ' + Math.round(pct) + '%' });
        cum += pct;
      });
      els.push({ type: 'circle', at: [0, 0], r: 1, style: 'outline' });
      return {
        lang: lang, title: { text: u(lang, 'Pie Chart', '원그래프') },
        canvas: {}, units: '%', elements: els
      };
    }
  });

  /* ── 15. 띠그래프 ── */
  T.push({
    id: 'band-graph', category: 'Mathematics/Statistics',
    name: { en: 'Band Graph', ko: '띠그래프' },
    params: [
      { key: 'items', label: { en: 'Items "name value, …"', ko: '항목 "이름 값, …"' }, type: 'text', default: '국어 30, 수학 25, 과학 20, 기타 25' }
    ],
    build: function (p, lang) {
      var parts = String(p.items).split(',').map(function (s) {
        var m = s.trim().match(/^(.+?)\s+([\d.]+)$/);
        return m ? { name: m[1], v: parseFloat(m[2]) } : null;
      }).filter(Boolean);
      var total = parts.reduce(function (a, b) { return a + b.v; }, 0) || 1;
      var TX = ['diag-lines', 'dots', 'vlines', null];
      var H = 14, els = [], x = 0;
      parts.forEach(function (it, i) {
        var w = it.v / total * 100;
        var el = { type: 'region', rect: [x, 0, w, H], edge: 'minor' };
        if (TX[i % TX.length]) el.fill = TX[i % TX.length];
        els.push(el);
        // 레이블 두 줄 교차 배치 (좁은 구간 겹침 방지)
        els.push({ type: 'label', at: [x + w / 2, 0], text: it.name + ' ' + Math.round(it.v / total * 100) + '%', anchor: 'middle', offsetMm: [0, i % 2 ? -19 : -9] });
        x += w;
      });
      els.push({ type: 'region', rect: [0, 0, 100, H], edge: 'outline' });
      // 0·50·100 눈금
      [0, 50, 100].forEach(function (v) {
        els.push({ type: 'tick', at: [v, H], dir: [0, 1], len: 3, style: 'major' });
        els.push({ type: 'label', at: [v, H], text: String(v), anchor: 'middle', offsetMm: [0, 8] });
      });
      return {
        lang: lang, title: { text: u(lang, 'Band Graph', '띠그래프') },
        canvas: { stretch: true, aspect: 3.2 }, units: '%', elements: els
      };
    }
  });

  /* ── 16. 전개도 (정육면체·직육면체) — 실선=자르는 선, 파선=접는 선 ── */
  T.push({
    id: 'solid-net', category: 'Mathematics/Geometry',
    name: { en: 'Solid Net (unfolded)', ko: '전개도' },
    params: [
      { key: 'solid', label: { en: 'Solid', ko: '입체' }, type: 'select', options: ['cube', 'cuboid'], default: 'cube' },
      // 정육면체는 한 변으로 결정된다 — 가로·높이·세로를 따로 두면 바꿔도 반영되지 않아 혼란스럽다
      { key: 'edge', label: { en: 'Edge length', ko: '한 변 길이' }, type: 'number', default: 4, showIf: function (p) { return p.solid === 'cube'; } },
      { key: 'w', label: { en: 'Width', ko: '가로' }, type: 'number', default: 4, showIf: function (p) { return p.solid !== 'cube'; } },
      { key: 'h', label: { en: 'Height', ko: '높이' }, type: 'number', default: 3, showIf: function (p) { return p.solid !== 'cube'; } },
      { key: 'd', label: { en: 'Depth', ko: '세로(깊이)' }, type: 'number', default: 2, showIf: function (p) { return p.solid !== 'cube'; } },
      { key: 'showDims', label: { en: 'Show measurements', ko: '치수 표시' }, type: 'bool', default: true },
      { key: 'faceLabels', label: { en: 'Face labels', ko: '면 이름 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var w, h, d;
      if (p.solid === 'cube') { w = h = d = +p.edge || 4; }
      else { w = +p.w || 4; h = +p.h || 3; d = +p.d || 2; }
      // 십자 전개: 가운데 행 = 옆·앞·옆·뒤, 앞면 위 = 윗면, 아래 = 밑면
      var els = [
        // 접는 선 (파선)
        { type: 'line', from: [d, 0], to: [d, h], style: 'dashed' },
        { type: 'line', from: [d + w, 0], to: [d + w, h], style: 'dashed' },
        { type: 'line', from: [d + w + d, 0], to: [d + w + d, h], style: 'dashed' },
        { type: 'line', from: [d, h], to: [d + w, h], style: 'dashed' },
        { type: 'line', from: [d, 0], to: [d + w, 0], style: 'dashed' },
        // 자르는 선 (외곽 실선)
        {
          type: 'polyline', closed: true, style: 'outline', points: [
            [0, 0], [d, 0], [d, -d], [d + w, -d], [d + w, 0], [2 * d + 2 * w, 0],
            [2 * d + 2 * w, h], [d + w, h], [d + w, h + d], [d, h + d], [d, h], [0, h]
          ]
        }
      ];
      if (p.faceLabels) {
        var F = lang === 'ko' ? ['옆', '앞', '옆', '뒤', '위', '밑'] : ['s', 'f', 's', 'k', 't', 'b'];
        els.push({ type: 'label', at: [d / 2, h / 2], text: F[0], anchor: 'middle' });
        els.push({ type: 'label', at: [d + w / 2, h / 2], text: F[1], anchor: 'middle' });
        els.push({ type: 'label', at: [d + w + d / 2, h / 2], text: F[2], anchor: 'middle' });
        els.push({ type: 'label', at: [d + w + d + w / 2, h / 2], text: F[3], anchor: 'middle' });
        els.push({ type: 'label', at: [d + w / 2, h + d / 2], text: F[4], anchor: 'middle' });
        els.push({ type: 'label', at: [d + w / 2, -d / 2], text: F[5], anchor: 'middle' });
      }
      /* 치수 레이블 — 도면은 용지에 맞춰 자동 축척되므로, 실제 수치는 점자 레이블이 전달한다.
       * (이게 없으면 숫자를 바꿔도 산출물이 똑같아 보인다) */
      if (p.showDims !== false) {
        var n = function (v) { return String(Math.round(v * 100) / 100); };
        if (p.solid === 'cube') {
          els.push({ type: 'dimension', from: [d, 0], to: [d + w, 0], side: 'bottom', label: n(w) });
        } else {
          els.push({ type: 'dimension', from: [d, 0], to: [d + w, 0], side: 'bottom', label: n(w) });
          els.push({ type: 'dimension', from: [0, 0], to: [0, h], side: 'left', label: n(h) });
          els.push({ type: 'dimension', from: [0, 0], to: [d, 0], side: 'bottom', offset: 34, label: n(d) });
        }
      }
      return {
        lang: lang,
        title: { text: u(lang, (p.solid === 'cube' ? 'Cube' : 'Cuboid') + ' Net', (p.solid === 'cube' ? '정육면체' : '직육면체') + ' 전개도') },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 17. 쌓기나무 (위에서 본 모양 + 아이소메트릭) ── */
  T.push({
    id: 'block-stack', category: 'Mathematics/Geometry',
    name: { en: 'Block Stacking', ko: '쌓기나무' },
    params: [
      { key: 'grid', label: { en: 'Heights (rows back→front, e.g. "2 1; 1 3")', ko: '층수 (뒷줄부터, 예 "2 1; 1 3")' }, type: 'text', default: '2 1; 1 3' },
      { key: 'topView', label: { en: 'Show top view with counts', ko: '위에서 본 모양(개수) 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var rows = String(p.grid).split(';').map(function (r) {
        return r.trim().split(/[\s,]+/).map(Number).filter(function (v) { return !isNaN(v); });
      }).filter(function (r) { return r.length; });
      var nR = rows.length, nC = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      var s = 1, w2 = 0.866 * s, h2 = 0.5 * s;
      var els = [], isoX = p.topView ? nC * 1.2 + 3.2 : 0;
      // 위에서 본 모양: 칸 + 개수 (교과서 표준 병기)
      if (p.topView) {
        for (var j = 0; j < nR; j++) for (var i = 0; i < (rows[j] || []).length; i++) {
          if (!rows[j][i]) continue;
          var ty = (nR - 1 - j) * 1.2;
          els.push({ type: 'region', rect: [i * 1.2, ty, 1, 1], edge: 'major' });
          els.push({ type: 'label', at: [i * 1.2 + 0.5, ty + 0.5], text: String(rows[j][i]), anchor: 'middle' });
        }
      }
      // 아이소메트릭 (뒤→앞, 아래→위 페인터 순서)
      var cubes = [];
      for (var jj = 0; jj < nR; jj++) for (var ii = 0; ii < (rows[jj] || []).length; ii++)
        for (var k = 0; k < (rows[jj][ii] || 0); k++) cubes.push([ii, jj, k]);
      cubes.sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2]; });
      cubes.forEach(function (c) {
        var i = c[0], j = c[1], k = c[2];
        var cx = isoX + (i - j) * w2 + nR * w2;             // 화면 좌표 (y-down으로 계산 후 반전)
        var cyD = (i + j) * h2 - k * s;
        function pt(dx, dyD) { return [cx + dx, -(cyD + dyD)]; }
        els.push({ type: 'polyline', closed: true, style: 'major', fill: null, points: [pt(0, 0), pt(w2, -h2), pt(0, -2 * h2), pt(-w2, -h2)] });                    // 윗면 (민무늬)
        els.push({ type: 'polyline', closed: true, style: 'major', fill: 'dots', points: [pt(-w2, -h2), pt(0, 0), pt(0, s), pt(-w2, s - h2)] });                   // 왼쪽 면
        els.push({ type: 'polyline', closed: true, style: 'major', fill: 'diag-lines', points: [pt(w2, -h2), pt(0, 0), pt(0, s), pt(w2, s - h2)] });               // 오른쪽 면
      });
      return {
        lang: lang, title: { text: u(lang, 'Block Stacking', '쌓기나무') },
        canvas: {}, units: 'blocks', elements: els
      };
    }
  });

  /* ── 18. 전기회로 (6학년 2학기 '전기의 이용') ── */
  T.push({
    id: 'circuit', category: 'Science/Physics',
    name: { en: 'Electric Circuit', ko: '전기회로' },
    params: [
      { key: 'mode', label: { en: 'Connection', ko: '연결 방식' }, type: 'select', options: ['series', 'parallel'], default: 'series' },
      { key: 'bulbs', label: { en: 'Bulbs', ko: '전구 수' }, type: 'number', default: 2 },
      { key: 'sw', label: { en: 'Switch', ko: '스위치' }, type: 'bool', default: true },
      { key: 'showLabels', label: { en: 'Part labels', ko: '부품 이름 표시' }, type: 'bool', default: true }
    ],
    build: function (p, lang) {
      var W = 60, H = 34, nB = Math.max(1, Math.min(3, Math.round(+p.bulbs) || 1));
      var els = [], r = 3.2;
      function bulb(x, y) {   // 전구: 원 + X (기호 관행)
        var q = r * 0.707;
        els.push({ type: 'circle', at: [x, y], r: r, style: 'major' });
        els.push({ type: 'line', from: [x - q, y - q], to: [x + q, y + q], style: 'minor' });
        els.push({ type: 'line', from: [x - q, y + q], to: [x + q, y - q], style: 'minor' });
      }
      // 아래 변: 전지 (긴 판 = +, 짧고 굵은 판 = −)
      els.push({ type: 'line', from: [0, 0], to: [27, 0], style: 'major' });
      els.push({ type: 'line', from: [33, 0], to: [W, 0], style: 'major' });
      els.push({ type: 'line', from: [28.2, -5], to: [28.2, 5], style: 'minor' });
      els.push({ type: 'line', from: [31.8, -3], to: [31.8, 3], style: 'outline' });
      // 좌변
      els.push({ type: 'line', from: [0, 0], to: [0, H], style: 'major' });
      // 우변 (+스위치)
      if (p.sw) {
        els.push({ type: 'line', from: [W, 0], to: [W, H / 2 - 4], style: 'major' });
        els.push({ type: 'line', from: [W, H / 2 + 4], to: [W, H], style: 'major' });
        els.push({ type: 'pointSymbol', at: [W, H / 2 - 4], symbol: 'dot' });
        els.push({ type: 'pointSymbol', at: [W, H / 2 + 4], symbol: 'dot' });
        els.push({ type: 'line', from: [W, H / 2 - 4], to: [W + 5.5, H / 2 + 2.5], style: 'major' });   // 레버 (열린 상태)
      } else {
        els.push({ type: 'line', from: [W, 0], to: [W, H], style: 'major' });
      }
      if (p.mode === 'series') {
        // 직렬: 윗변 위에 전구 나란히
        var xs = [];
        for (var i = 0; i < nB; i++) xs.push(W * (i + 1) / (nB + 1));
        var prev = 0;
        xs.forEach(function (x) {
          els.push({ type: 'line', from: [prev, H], to: [x - r, H], style: 'major' });
          bulb(x, H); prev = x + r;
        });
        els.push({ type: 'line', from: [prev, H], to: [W, H], style: 'major' });
      } else {
        // 병렬: 가운데 가로 가지마다 전구
        els.push({ type: 'line', from: [0, H], to: [W, H], style: 'major' });
        for (var b = 0; b < nB; b++) {
          var y = H * (b + 1) / (nB + 1);
          els.push({ type: 'line', from: [0, y], to: [30 - r, y], style: 'major' });
          bulb(30, y);
          els.push({ type: 'line', from: [30 + r, y], to: [W, y], style: 'major' });
        }
      }
      if (p.showLabels) {
        els.push({ type: 'leader', at: [30, 0], text: u(lang, 'battery', '전지'), side: 'bottom' });
        els.push({ type: 'leader', at: [p.mode === 'series' ? W / (nB + 1) : 30, p.mode === 'series' ? H : H / (nB + 1)], text: u(lang, 'bulb', '전구') });
        if (p.sw) els.push({ type: 'leader', at: [W, H / 2 + 4], text: u(lang, 'switch', '스위치') });
      }
      return {
        lang: lang,
        title: { text: u(lang, (p.mode === 'series' ? 'Series' : 'Parallel') + ' Circuit', '전기회로 — ' + (p.mode === 'series' ? '직렬연결' : '병렬연결')) },
        canvas: {}, units: 'units', elements: els
      };
    }
  });

  /* ── 19. 점자 텍스트 페이지 (레슨 설명·퀴즈용) ── */
  T.push({
    id: 'text-page', category: 'Language Arts',
    name: { en: 'Braille Text Page', ko: '점자 텍스트 페이지' },
    params: [
      { key: 'heading', label: { en: 'Heading', ko: '제목' }, type: 'text', default: '' },
      { key: 'body', label: { en: 'Body text', ko: '본문' }, type: 'textarea', default: '' }
    ],
    build: function (p, lang) {
      return {
        lang: lang,
        title: { text: p.heading || u(lang, 'Text Page', '텍스트 페이지') },
        canvas: {}, textPage: String(p.body || ''), elements: []
      };
    }
  });

  /* ── 20. 대분수→가분수 변환 과정 (시퀀스 자동 생성) ── */
  T.push({
    id: 'fraction-process', category: 'Mathematics/Fractions', sequence: true,
    name: { en: 'Mixed→Improper Steps', ko: '대분수→가분수 과정' },
    params: [
      { key: 'whole', label: { en: 'Whole part', ko: '자연수 부분' }, type: 'number', default: 2 },
      { key: 'num', label: { en: 'Numerator', ko: '분자' }, type: 'number', default: 1 },
      { key: 'den', label: { en: 'Denominator', ko: '분모' }, type: 'number', default: 3 }
    ],
    build: function (p, lang) {
      var a = Math.max(1, Math.round(+p.whole)), c = Math.max(2, Math.round(+p.den));
      var b = Math.min(c - 1, Math.max(0, Math.round(+p.num)));
      var Hs = 1.3, GAP = 0.35;
      function stripsPage(converted, caption) {
        // converted = c등분으로 쪼개진 자연수 개수. 나머지는 통짜.
        var els = [], x = 0, i, k;
        for (i = 0; i < a; i++) {
          if (i < converted) {
            for (k = 0; k < c; k++) els.push({ type: 'region', rect: [x + k / c, 0, 1 / c, Hs], edge: 'major', fill: 'diag-lines' });
            els.push({ type: 'region', rect: [x, 0, 1, Hs], edge: 'outline' });
          } else {
            els.push({ type: 'region', rect: [x, 0, 1, Hs], edge: 'outline', fill: 'diag-lines' });
          }
          x += 1 + GAP;
        }
        for (k = 0; k < c; k++) els.push({ type: 'region', rect: [x + k / c, 0, 1 / c, Hs], edge: 'major', fill: k < b ? 'diag-lines' : null });
        els.push({ type: 'region', rect: [x, 0, 1, Hs], edge: 'outline' });
        els.push({ type: 'label', at: [(x + 1) / 2, 0], text: caption, anchor: 'middle', offsetMm: [0, -11] });
        return els;
      }
      var mixed = a + ' ' + b + '/' + c, improper = (a * c + b) + '/' + c;
      var pages = [];
      pages.push({
        title: u(lang, 'Mixed number ' + mixed, '대분수 ' + mixed),
        desc: u(lang, 'A mixed number: ' + a + ' wholes and ' + b + '/' + c + '.', '대분수 ' + mixed + ' — 자연수 ' + a + '와 진분수 ' + b + '/' + c + '입니다.'),
        spec: { lang: lang, title: { text: u(lang, 'Mixed: ' + mixed, '대분수 ' + mixed) }, canvas: { stretch: true, aspect: 2.4 }, units: 'wholes', elements: stripsPage(0, mixed) }
      });
      for (var s2 = 1; s2 <= a; s2++) {
        var run = (s2 * c + b) + '/' + c;
        pages.push({
          title: u(lang, 'Step ' + s2 + ': 1 = ' + c + '/' + c, s2 + '단계: 1 = ' + c + '/' + c),
          desc: u(lang, 'Split whole #' + s2 + ' into ' + c + ' parts. Running total ' + run + '.', s2 + '번째 자연수 1을 ' + c + '등분하면 ' + c + '/' + c + '. 지금까지 ' + run + '입니다.'),
          spec: { lang: lang, title: { text: u(lang, 'Step ' + s2 + ' — ' + run, s2 + '단계 — ' + run) }, canvas: { stretch: true, aspect: 2.4 }, units: 'wholes', elements: stripsPage(s2, run) }
        });
      }
      pages.push({
        title: u(lang, 'Improper: ' + improper, '가분수 ' + improper),
        desc: u(lang, mixed + ' equals ' + improper + '.', '대분수 ' + mixed + '는 가분수 ' + improper + '와 같습니다. 조각 수 = ' + a + '×' + c + '+' + b + ' = ' + (a * c + b) + '.'),
        spec: { lang: lang, title: { text: u(lang, mixed + ' = ' + improper, mixed + ' = ' + improper) }, canvas: { stretch: true, aspect: 2.4 }, units: 'wholes', elements: stripsPage(a, improper) }
      });
      return pages;
    }
  });

  return T;
});
