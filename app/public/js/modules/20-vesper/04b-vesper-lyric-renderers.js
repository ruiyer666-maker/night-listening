/* SPDX-License-Identifier: AGPL-3.0-only
 * Vesper Canvas lyric renderers, adapted from Folia's layouts and motion.
 * Upstream: chthollyphile/folia-major, b0d2d74e4f4458879f6a53c31bcdb4144d06d754.
 * The seeded classic word layout, Partita sequential columns, Cadenza's
 * hero-first collision placement, Claddagh arc advances and Pendolo wheel
 * geometry are adapted for Vesper's media clock and Canvas2D. GlowWord's
 * waiting/active/passed variants, line envelopes and mode entrance vectors
 * are evaluated analytically so pause and seeking do not depend on frame history.
 * The remaining
 * renderers recreate the corresponding Folia compositions without React/Pixi.
 * See app/NOTICE.md and the accompanying Folia license/source record.
 */
(function () {
  'use strict';
  var SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';
  var SANS = '"Inter","Segoe UI","Microsoft YaHei",sans-serif';
  var glyphCache = new Map(), widthCache = new Map(), wrapCache = new Map(), placementCache = new Map();
  var flowCache = new WeakMap();
  function invalidateFontMetrics() {
    // Font CSS loads independently of startup. Its arrival changes measured
    // widths even though the CSS font string and the lyric text stay the same.
    widthCache.clear(); wrapCache.clear(); placementCache.clear();
    flowCache = new WeakMap();
  }
  if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', function () {
      invalidateFontMetrics();
      window.dispatchEvent(new CustomEvent('vesper-lyric-fonts-ready'));
    });
  }
  function remember(cache, key, value, limit) {
    if (cache.size >= limit) cache.delete(cache.keys().next().value);
    cache.set(key, value); return value;
  }
  var styles = [
    { id: 'classic', label: '流光', description: '松散词组 · 逐词浮起' },
    { id: 'partita', label: '云阶', description: '错落分句 · 阶梯排版' },
    { id: 'cadenza', label: '心象', description: '词语散落 · 焦点聚光' },
    { id: 'fume', label: '浮名', description: '长卷文章 · 镜头跟读' },
    { id: 'tilt', label: '倾诉', description: '倾斜大字 · 交替登场' },
    { id: 'claddagh', label: '回环', description: '圆弧字轨 · 环形吟唱' },
    { id: 'pendolo', label: '擒纵', description: '歌词转轮 · 摆动对焦' },
    { id: 'cappella', label: '群唱', description: '左右对话 · 歌词气泡' },
    { id: 'monet', label: '莫奈', description: '唱片画幅 · 纵向跟读' },
    { id: 'sonnet', label: '商籁', description: '主词海报 · 横竖叙事' },
    { id: 'tempera', label: '凝彩', description: '反色拼贴 · 几何节奏' },
    { id: 'diorama', label: '镜台', description: '透视字廊 · 空间推进' }
  ];
  function clamp(v, a, b) { return Math.min(b, Math.max(a, Number(v) || 0)); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function fract(v) { return v - Math.floor(v); }
  function random(seed) { return fract(Math.sin(seed) * 10000); }
  function smooth(v) { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); }
  function easeOut(v) { return 1 - Math.pow(1 - clamp(v, 0, 1), 3); }
  // Folia GlowWord: spring stiffness=200, damping=20, mass=1. Closed form
  // replaces Framer's frame integrator, retaining the same damped overshoot.
  function wordSpring(seconds) {
    if (seconds <= 0) return 0;
    if (seconds >= .9) return 1;
    return 1 - Math.exp(-10 * seconds) * (Math.cos(10 * seconds) + Math.sin(10 * seconds));
  }
  function tokenTime(state, from, to) {
    var item = state.current, start = Infinity, end = -Infinity;
    if (item.hasWordTiming) for (var i = from; i < to; i++) {
      var timing = item.timings[i];
      if (timing) { start = Math.min(start, timing.start); end = Math.max(end, timing.end); }
    }
    if (isFinite(start)) return { start: start, end: end, word: true };
    // LRC supplies no word alignment. A short entrance cascade is typography,
    // not a fabricated syllable timeline; it never stretches over the song line.
    var cascade = Math.min(.30, Math.max(.04, (item.end - item.t) * .12));
    start = item.t + cascade * from / Math.max(1, chars(item.text).length - 1);
    return { start: start, end: start + .46, word: false };
  }
  function tokenMotion(state, token, seed, mode) {
    if (state.f.reducedMotion) return { x: 0, y: 0, angle: 0, scale: 1, alpha: 1, blur: 0, passed: 0 };
    var timing = tokenTime(state, token.startChar, token.endChar), time = state.f.time;
    var age = time - timing.start + (timing.word ? .15 : 0), spring = wordSpring(age);
    var passed = easeOut((time - timing.end) / .5), drift = clamp((time - timing.end) / 5, 0, 1);
    var x = (Math.sin(seed * 1.73) * Math.min(100, state.r.width * .12)) * (1 - spring);
    var y = Math.cos(seed * .91) * Math.min(50, state.r.height * .14) * (1 - spring);
    var scale = mix(.5, mode === 'cadenza' ? 1.3 : 1.4, spring);
    scale = mix(scale, 1, passed);
    var angle = (20 * (1 - spring) + (random(seed + 8) - .5) * 18 * drift) * Math.PI / 180;
    if (mode === 'cadenza') {
      x += (random(seed + 11) - .5) * state.base * .70 * drift;
      y -= state.base * (.18 + random(seed + 12) * .35) * drift;
    }
    return { x: x, y: y, angle: angle, scale: Math.max(.1, scale), alpha: clamp(age / .1, 0, 1) * mix(1, .82, passed), blur: 10 * (1 - clamp(age / .2, 0, 1)), passed: passed };
  }
  function entrance(state, from, to, delay, duration) {
    if (state.f.reducedMotion) return 1;
    var timing = tokenTime(state, from, to);
    return easeOut((state.f.time - timing.start + (timing.word ? .15 : 0) - (delay || 0)) / (duration || .55));
  }
  function cubicBezier(x1, y1, x2, y2, value) {
    var target = clamp(value, 0, 1);
    if (target === 0 || target === 1) return target;
    function coordinate(a, b, t) { var inv = 1 - t; return 3 * inv * inv * t * a + 3 * inv * t * t * b + t * t * t; }
    var low = 0, high = 1, parameter = target;
    for (var i = 0; i < 12; i++) { if (coordinate(x1, x2, parameter) < target) low = parameter; else high = parameter; parameter = (low + high) / 2; }
    return coordinate(y1, y2, parameter);
  }
  function chars(text) {
    text = String(text || '');
    if (glyphCache.has(text)) return glyphCache.get(text);
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      if (!chars.segmenter) chars.segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return remember(glyphCache, text, Array.from(chars.segmenter.segment(text), function (part) { return part.segment; }), 256);
    }
    return remember(glyphCache, text, Array.from(text), 256);
  }
  function font(ctx, size, family, weight) { ctx.font = (weight || 600) + ' ' + Math.max(1, size) + 'px ' + (family || SERIF); }
  function widthOf(ctx, text, size, family, weight) {
    font(ctx, size, family, weight);
    var key = ctx.font + '|' + text;
    if (widthCache.has(key)) return widthCache.get(key);
    return remember(widthCache, key, ctx.measureText(text).width, 2400);
  }
  function measureChars(ctx, glyphs, size, family, weight, spacing) {
    font(ctx, size, family, weight);
    var widths = glyphs.map(function (g) { return widthOf(ctx, g, size, family, weight); });
    return { widths: widths, width: widths.reduce(function (a, b) { return a + b; }, 0) + Math.max(0, glyphs.length - 1) * (spacing || 0) };
  }
  function rounded(ctx, x, y, w, h, radius) {
    radius = Math.min(radius || 0, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius); ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h); ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius); ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
  }
  function mark(state, x, y, w, h, index, angle) {
    if (angle) {
      var rw = Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h;
      var rh = Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h;
      x += (w - rw) / 2; y += (h - rh) / 2; w = rw; h = rh;
    }
    var layer = state.layerMotion;
    if (layer) {
      x = layer.cx + (x - layer.cx) * layer.scale + layer.x;
      y = layer.cy + (y - layer.cy) * layer.scale + layer.y;
      w *= layer.scale; h *= layer.scale;
    }
    var r = state.r, left = Math.max(x, r.x), top = Math.max(y, r.y);
    var right = Math.min(x + w, r.x + r.width), bottom = Math.min(y + h, r.y + r.height);
    if (right <= left || bottom <= top || !isFinite(left + top + right + bottom)) return;
    state.bounds.push({ x: left, y: top, width: right - left, height: bottom - top, lineIndex: index });
    if (index >= 0 && state.drawnLines.indexOf(index) === -1) state.drawnLines.push(index);
  }
  function unitProgress(state, index, charIndex) {
    if (index < state.f.index) return 1;
    if (index > state.f.index) return 0;
    // Plain LRC describes a line, not individual syllables. Do not let an
    // estimated character array manufacture singing accents. Entrance motion
    // has its own clock and does not read this progress.
    if (state.highlightMode === 'line') return 1;
    var list = state.f.charProgress;
    if (list && list.length) return clamp(list[charIndex], 0, 1);
    var line = state.lines[index];
    return clamp((state.f.progress || 0) * Math.max(1, chars(line && line.text).length) - charIndex, 0, 1);
  }
  function averageProgress(state, index, from, to) {
    var sum = 0; for (var i = from; i < to; i++) sum += unitProgress(state, index, i);
    return sum / Math.max(1, to - from);
  }
  function drawRun(state, text, x, y, size, options) {
    options = options || {};
    var ctx = state.ctx, glyphs = chars(text), spacing = options.spacing || 0;
    var family = options.family || SERIF, weight = options.weight || 600;
    var measured = measureChars(ctx, glyphs, size, family, weight, spacing);
    var w = measured.width, h = size * 1.28, angle = options.angle || 0;
    var lineIndex = options.index == null ? state.f.index : options.index;
    if (options.align === 'center') x -= w / 2;
    if (options.align === 'right') x -= w;
    // Waiting words have a layout but no pixels. In particular, never run a
    // blur filter for the invisible words of a future YRC phrase.
    if (ctx.globalAlpha < .001 || options.alpha != null && options.alpha < .001) return { x: x, y: y, width: w, height: h };
    ctx.save(); ctx.globalAlpha *= options.alpha == null ? 1 : clamp(options.alpha, 0, 1);
    var blur = (options.blur || 0) + (state.layerBlur || 0);
    // Canvas filter creates an expensive filtered render layer for every
    // stroke/fill (and can starve capture/compositing on desktop Edge). Keep
    // Folia's motion/depth envelope, but express defocus as a local glyph glow
    // and opacity falloff. Nothing outside the text bounds darkens or blurs.
    ctx.filter = 'none';
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle); ctx.translate(-w / 2, -h / 2);
    font(ctx, size, family, weight); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    var cursor = 0, highlight = options.highlight !== false;
    var emphasis = options.emphasis == null ? 1 : clamp(options.emphasis, 0, 1);
    var textColor = options.color || state.theme.foreground;
    var protect = options.protect !== false;
    if (protect) {
      ctx.shadowColor = 'rgba(2,5,9,.72)'; ctx.shadowBlur = Math.max(2, size * .09); ctx.shadowOffsetY = 1;
      ctx.strokeStyle = 'rgba(2,5,9,.58)'; ctx.lineWidth = Math.max(.8, size * .026); ctx.lineJoin = 'round';
    }
    if (blur > .05) {
      ctx.shadowColor = textColor; ctx.shadowBlur = Math.min(24, blur * 1.4); ctx.shadowOffsetY = 0;
      ctx.globalAlpha *= 1 - .22 * clamp(blur / 20, 0, 1);
    }
    // An LRC word has one colour. Paint it once so an entrance blur is
    // applied to one word, rather than allocating a filtered layer per glyph.
    // YRC wipes keep the individual glyph path below.
    if (!spacing && !options.wave && (!highlight || state.highlightMode === 'line')) {
      ctx.fillStyle = textColor;
      ctx.globalAlpha *= highlight ? .80 : 1;
      if (protect && ctx.strokeText) ctx.strokeText(text, 0, size * .98);
      ctx.fillText(text, 0, size * .98);
      ctx.globalAlpha /= highlight ? .80 : 1;
      if (highlight && emphasis > 0) {
        ctx.globalAlpha *= emphasis; ctx.fillStyle = options.accent || state.theme.accent;
        ctx.fillText(text, 0, size * .98);
      }
      ctx.restore();
      if (options.mark !== false && (options.alpha == null || options.alpha > .025)) mark(state, x, y, w, h, lineIndex, angle);
      return { x: x, y: y, width: w, height: h };
    }
    for (var i = 0; i < glyphs.length; i++) {
      var p = unitProgress(state, lineIndex, (options.startChar || 0) + i);
      var active = p > 0 && p < 1;
      var lift = options.wave && !state.f.reducedMotion ? Math.sin(i * 1.7 + state.motion * 2) * size * 0.085 : 0;
      var unprinted = options.printed && state.highlightMode !== 'line' && lineIndex === state.f.index && p <= 0;
      ctx.fillStyle = textColor;
      if (unprinted) ctx.globalAlpha *= .90;
      ctx.globalAlpha *= highlight ? .80 : 1;
      if (protect && ctx.strokeText) ctx.strokeText(glyphs[i], cursor, size * .98 + lift);
      ctx.fillText(glyphs[i], cursor, size * .98 + lift);
      ctx.globalAlpha /= highlight ? .80 : 1;
      if (unprinted) ctx.globalAlpha /= .90;
      if (highlight && p > 0 && emphasis > 0) {
        ctx.save();
        ctx.globalAlpha *= emphasis;
        if (active) { ctx.beginPath(); ctx.rect(cursor - size * .06, -size * .2, measured.widths[i] * p + size * .06, size * 1.6); ctx.clip(); }
        ctx.fillStyle = options.accent || state.theme.accent;
        if (active && !state.f.reducedMotion) { ctx.shadowBlur = size * .18; ctx.shadowColor = options.accent || state.theme.accent; }
        ctx.fillText(glyphs[i], cursor, size * .98 + lift);
        ctx.restore();
      }
      cursor += measured.widths[i] + spacing;
    }
    ctx.restore();
    if (options.mark !== false && (options.alpha == null || options.alpha > .025)) mark(state, x, y, w, h, lineIndex, angle);
    return { x: x, y: y, width: w, height: h };
  }
  function wrap(state, text, size, maxWidth, family, weight) {
    var glyphs = chars(text), ctx = state.ctx, rows = [], start = 0, cursor = 0;
    font(ctx, size, family, weight);
    var cacheKey = ctx.font + '|' + maxWidth + '|' + text;
    if (wrapCache.has(cacheKey)) return wrapCache.get(cacheKey);
    // Match drawRun's individual grapheme advances rather than a kerning-aware
    // whole-string width. Row starts always refer to the untouched source.
    var advances = glyphs.map(function (glyph) { return ctx.measureText(glyph).width; });
    while (cursor < glyphs.length) {
      // A separator left at a visual wrap belongs to neither visible row.
      // Advance its source index explicitly, instead of trimming text later
      // and accidentally shifting the following word's karaoke timestamps.
      while (start < glyphs.length && glyphs[start] !== '\n' && /\s/.test(glyphs[start])) start++;
      cursor = start;
      if (cursor >= glyphs.length) break;
      var end = start, used = 0, lastWordBreak = -1, hasVisibleText = false;
      while (end < glyphs.length && glyphs[end] !== '\n') {
        if (end > start && used + advances[end] > maxWidth) break;
        used += advances[end];
        if (/\s/.test(glyphs[end])) {
          if (hasVisibleText) lastWordBreak = end + 1;
        } else hasVisibleText = true;
        end++;
      }
      // Prefer an already fitting whitespace boundary. A single unbroken
      // word (or CJK text) that exceeds the row still folds by grapheme.
      var cut = end < glyphs.length && glyphs[end] !== '\n' && lastWordBreak > start ? lastWordBreak : end;
      if (cut === start && glyphs[start] !== '\n') cut = start + 1;
      rows.push({ text: glyphs.slice(start, cut).join(''), start: start, width: advances.slice(start, cut).reduce(function (sum, advance) { return sum + advance; }, 0) });
      cursor = cut;
      if (glyphs[cursor] === '\n') cursor++;
      start = cursor;
    }
    if (!rows.length) rows.push({ text: '', start: 0, width: 0 });
    return remember(wrapCache, cacheKey, rows, 256);
  }
  function block(state, text, rect, options) {
    options = options || {};
    var size = Math.max(1, options.size || state.base), gap = options.gap || 1.38, rows;
    for (var attempt = 0; attempt < 40; attempt++) {
      rows = wrap(state, text, size, Math.max(1, rect.width), options.family, options.weight);
      if ((rows.length * size * gap <= rect.height && (!options.maxRows || rows.length <= options.maxRows)) || size <= 1) break;
      size = Math.max(1, size * .89);
    }
    var height = rows.length * size * gap;
    var top = options.valign === 'top' ? rect.y : rect.y + (rect.height - height) / 2;
    rows.forEach(function (row, rowIndex) {
      var x = options.align === 'left' ? rect.x : (options.align === 'right' ? rect.x + rect.width : rect.x + rect.width / 2);
      drawRun(state, row.text, x, top + rowIndex * size * gap, size, Object.assign({}, options, { align: options.align === 'left' ? undefined : (options.align || 'center'), startChar: (options.startChar || 0) + row.start }));
    });
    return { size: size, height: height, rows: rows, y: top };
  }
  function tokensFor(line, maximum) {
    var list = line && line.tokens && line.tokens.length ? line.tokens.map(function (token) { return { text: token.text, startChar: token.startChar || 0, endChar: token.endChar == null ? (token.startChar || 0) + chars(token.text).length : token.endChar }; }) : [];
    if (!list.length) {
      var glyphs = chars(line && line.text), chunk = Math.max(1, Math.ceil(glyphs.length / 8));
      for (var i = 0; i < glyphs.length; i += chunk) list.push({ text: glyphs.slice(i, i + chunk).join(''), startChar: i, endChar: Math.min(glyphs.length, i + chunk) });
    }
    // Keep every original grapheme in a contiguous range. Whitespace is owned
    // by its preceding token, as in Folia's printed-text ranges.
    var joined = [], prefix = null;
    list.forEach(function (item) {
      if (!item.text.trim()) {
        if (joined.length) { joined[joined.length - 1].text += item.text; joined[joined.length - 1].endChar = item.endChar; }
        else prefix = prefix ? { text: prefix.text + item.text, startChar: prefix.startChar, endChar: item.endChar } : item;
      } else {
        if (prefix) { item = { text: prefix.text + item.text, startChar: prefix.startChar, endChar: item.endChar }; prefix = null; }
        joined.push(item);
      }
    });
    list = joined;
    if (maximum && list.length > maximum) {
      var grouped = [], count = Math.ceil(list.length / maximum);
      for (var j = 0; j < list.length; j += count) {
        var members = list.slice(j, j + count);
        grouped.push({ text: members.map(function (m) { return m.text; }).join(''), startChar: members[0].startChar, endChar: members[members.length - 1].endChar });
      }
      list = grouped;
    }
    return list;
  }
  function kineticBlock(state, text, rect, options) {
    options = options || {};
    var size = options.size || state.base, start = options.startChar || 0, rows;
    for (var attempt = 0; attempt < 40; attempt++) {
      rows = wrap(state, text, size, rect.width / 1.42, options.family, options.weight);
      if (rows.length * size * 1.75 <= rect.height || size <= 1) break;
      size *= .89;
    }
    var top = rect.y + (rect.height - rows.length * size * 1.75) / 2;
    var original = tokensFor(state.current, 24);
    rows.forEach(function (row, rowIndex) {
      var begin = start + row.start, end = begin + chars(row.text).length;
      var pieces = original.filter(function (part) { return part.endChar > begin && part.startChar < end; });
      var cursor = rect.x + (rect.width - widthOf(state.ctx, row.text, size, options.family, options.weight) * 1.42) / 2;
      pieces.forEach(function (part) {
        var from = Math.max(part.startChar, begin), to = Math.min(part.endChar, end);
        var value = chars(state.current.text).slice(from, to).join('');
        var width = widthOf(state.ctx, value, size, options.family, options.weight) * 1.42;
        var motion = tokenMotion(state, { startChar: from, endChar: to }, state.current.t + from + 1, 'classic');
        drawRun(state, value, cursor + width / 2 + motion.x, top + rowIndex * size * 1.75 + motion.y, size * motion.scale, Object.assign({}, options, { align: 'center', startChar: from, angle: (options.angle || 0) + motion.angle, alpha: motion.alpha, blur: motion.blur }));
        cursor += width;
      });
    });
    return { size: size, height: rows.length * size * 1.75, y: top };
  }
  function glyphMotion(state, index, size, kind, vertical) {
    if (state.f.reducedMotion) return { x: 0, y: 0, angle: 0, scale: 1, alpha: 1 };
    var timing = tokenTime(state, index, index + 1), age = state.f.time - timing.start + (timing.word ? .15 : 0);
    var direction = index % 2 ? 1 : -1, progress;
    if (kind === 'sonnet') {
      var duration = Math.min(clamp((state.current.end - state.current.t) * .42, .65, 1.8), (state.current.end - state.current.t) * .72);
      progress = clamp(age / Math.max(.08, duration), 0, 1);
      progress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      return { x: vertical ? direction * size * .28 * (1 - progress) : 0, y: vertical ? 0 : direction * size * .24 * (1 - progress), angle: direction * .055 * (1 - progress), scale: 1, alpha: clamp(age / .14, 0, 1) };
    }
    progress = cubicBezier(.25, .46, .45, .94, age / .5);
    var p = timing.word ? clamp((state.f.time - timing.start) / Math.max(.2, Math.min(.9, timing.end - timing.start)), 0, 1) : 0;
    return { x: 0, y: direction * size / 6 * (1 - progress) * 2, angle: 0, scale: 1 + Math.sin(Math.PI * p) * .18, alpha: progress };
  }
  function typographyBlock(state, text, rect, options) {
    options = options || {};
    var size = options.size || state.base, rows, gap = 1.44;
    for (var attempt = 0; attempt < 40; attempt++) {
      rows = wrap(state, text, size, rect.width / 1.08, options.family, options.weight);
      if ((rows.length * size * gap <= rect.height && (!options.maxRows || rows.length <= options.maxRows)) || size <= 1) break;
      size *= .89;
    }
    var top = rect.y + (rect.height - rows.length * size * gap) / 2;
    rows.forEach(function (row, rowIndex) {
      var measured = measureChars(state.ctx, chars(row.text), size, options.family, options.weight, 0);
      var cursor = options.align === 'left' ? rect.x : options.align === 'right' ? rect.x + rect.width - measured.width : rect.x + (rect.width - measured.width) / 2;
      chars(row.text).forEach(function (glyph, i) {
        var index = (options.startChar || 0) + row.start + i, motion = glyphMotion(state, index, size, options.motion || 'tilt', false);
        drawRun(state, glyph, cursor + measured.widths[i] / 2 + motion.x, top + rowIndex * size * gap + motion.y, size * motion.scale, Object.assign({}, options, { align: 'center', angle: (options.angle || 0) + motion.angle, alpha: motion.alpha, startChar: index }));
        cursor += measured.widths[i];
      });
    });
    return { size: size, height: rows.length * size * gap, y: top };
  }
  function lineAt(state, index) { return state.lines[index] || null; }
  var lightWords = new Set(('a an the and or but nor for so yet as at by in of on to up via with from into onto upon ' +
    'is am are was were be been being do does did have has had can could may might must shall should will would ' +
    'i me my mine we us our ours you your yours he him his she her hers it its they them their theirs ' +
    'this that these those who whom whose which what where when why how if than then there here not no yes ' +
    '在 的 地 得 了 着 过 和 与 及 或 而 却 就 也 还 都 又 很 更 最 太 所 把 被 让 给 从 向 对 将 以 因 由 为 是 有 ' +
    '这 那 哪 些 个 们 吗 呢 啊 呀 吧 哦 你 我 他 她 它 谁 什么 怎么 如此 因此 所以 自己 我们 你们 他们').split(/\s+/));
  function contentWordCount(text) {
    var words = String(text).toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || [];
    return words.filter(function (word) {
      return !lightWords.has(word) && !/^[的地得了着过在于和与及或而却就也还都又很更最太所把被让给从向对将以因由为是有这那哪些个们吗呢啊呀吧哦你我他她它]+$/.test(word);
    }).length;
  }
  function heroFor(line, parts) {
    var best = 0, bestScore = -Infinity, total = Math.max(1, chars(line.text).length);
    parts.forEach(function (part, index) {
      var length = chars(part.text.trim()).length, semantic = contentWordCount(part.text);
      var timings = line.timings || [], first = null, last = null;
      // Token ranges intentionally own trailing separators; those separators
      // often have no timing and must not hide the word's actual duration.
      for (var offset = part.startChar; offset < part.endChar; offset++) {
        if (timings[offset]) { if (!first) first = timings[offset]; last = timings[offset]; }
      }
      var duration = first && last ? last.end - first.start : (line.end - line.t) * length / total;
      var centrality = 1 - Math.abs(index - (parts.length - 1) / 2) / Math.max(1, parts.length);
      // Meaningful words always outrank a conjunction/pronoun, even when that
      // syllable lasts longer. The remaining score is stable on seek/replay.
      var score = (semantic ? 1000 : 0) + Math.min(length, 8) * 14 + clamp(duration, 0, 2.5) * 18 + centrality * 8;
      if (score > bestScore) { bestScore = score; best = index; }
    });
    return best;
  }
  function focusIndex(state) {
    var index = state.f.index, current = state.current, previous = state.lines[index - 1];
    if (state.f.reducedMotion || !current || !previous || previous.end < current.t - .35) return index;
    var duration = Math.min(.62, Math.max(.08, (current.end - current.t) * .24));
    return index - 1 + smooth((Number(state.f.time) - current.t) / duration);
  }
  function flowLayout(state, width, size, maxHeight, family, gap) {
    var cache = flowCache.get(state.lines);
    if (!cache) { cache = new Map(); flowCache.set(state.lines, cache); }
    var key = [width, size, maxHeight, family, gap].join('|');
    if (cache.has(key)) return cache.get(key);
    var bottom = 0;
    var items = state.lines.map(function (item) {
      var fitted = size, rows;
      for (var attempt = 0; attempt < 40; attempt++) {
        rows = wrap(state, item.text, fitted, width, family);
        if (rows.length * fitted * 1.38 <= maxHeight || fitted <= 1) break;
        fitted *= .89;
      }
      var height = rows.length * fitted * 1.38;
      var result = { rows: rows, size: fitted, height: height, center: bottom + height / 2 };
      bottom += height + gap;
      return result;
    });
    return remember(cache, key, items, 8);
  }
  function flowFocus(items, focus) {
    var before = items[Math.max(0, Math.floor(focus))], after = items[Math.min(items.length - 1, Math.ceil(focus))];
    return before && after ? mix(before.center, after.center, fract(focus)) : 0;
  }
  function clipRegion(state, rect, paint) {
    var original = state.r;
    state.ctx.save(); state.ctx.beginPath(); state.ctx.rect(rect.x, rect.y, rect.width, rect.height); state.ctx.clip();
    state.r = { x: Math.max(original.x, rect.x), y: Math.max(original.y, rect.y), width: Math.min(original.x + original.width, rect.x + rect.width) - Math.max(original.x, rect.x), height: Math.min(original.y + original.height, rect.y + rect.height) - Math.max(original.y, rect.y) };
    paint(); state.r = original; state.ctx.restore();
  }
  function flowLine(state, item, index, x, centerY, family, scale, alpha, emphasis, printed) {
    var size = item.size * scale, top = centerY - item.height * scale / 2;
    item.rows.forEach(function (row, rowIndex) {
      drawRun(state, row.text, x, top + rowIndex * size * 1.38, size, { family: family, index: index, alpha: alpha, emphasis: emphasis, startChar: row.start, printed: printed });
    });
  }
  function lyricColumn(state, column, size, family, focusAt, printed) {
    var items = flowLayout(state, column.width, size, column.height * .48, family, size * .62);
    var focus = focusIndex(state), camera = flowFocus(items, focus), anchor = column.y + column.height * focusAt;
    clipRegion(state, column, function () {
      for (var index = Math.max(0, Math.floor(focus) - 7); index <= Math.min(items.length - 1, Math.ceil(focus) + 7); index++) {
        var item = items[index], y = anchor + item.center - camera;
        if (y + item.height / 2 < column.y || y - item.height / 2 > column.y + column.height) continue;
        var distance = Math.abs(index - focus), emphasis = clamp(1 - distance, 0, 1);
        var edge = Math.min(clamp((y - column.y) / (size * .75), 0, 1), clamp((column.y + column.height - y) / (size * .75), 0, 1));
        flowLine(state, item, index, column.x, y, family, .82 + emphasis * .18, (.40 + emphasis * .60) * edge, emphasis, printed);
      }
    });
    return anchor;
  }
  function subline(state, index, y, alpha, align) {
    var line = lineAt(state, index); if (!line) return;
    var r = state.r;
    block(state, line.text, { x: r.x + r.width * .08, y: y, width: r.width * .84, height: Math.max(28, r.height * .12) }, { size: state.base * .35, family: SANS, index: index, alpha: alpha, highlight: false, align: align || 'center', maxRows: 2 });
  }
  function footer(state) {
    var line = state.current; if (!line || !line.translation) return;
    var r = state.r;
    block(state, line.translation, { x: r.x + r.width * .09, y: r.y + r.height * .88, width: r.width * .82, height: r.height * .10 }, { size: Math.min(21, state.base * .31), family: SANS, color: state.theme.muted, alpha: .9, highlight: false, index: state.f.index, maxRows: 2 });
  }
  function line(ctx, x1, y1, x2, y2, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function label(state, text, x, y, options) {
    drawRun(state, text, x, y, Math.max(9, Math.min(12, state.r.width * .025)), Object.assign({ family: SANS, highlight: false, alpha: .5, mark: false, spacing: 1.4, weight: 500 }, options));
  }
  function classic(state) {
    var r = state.r, items = tokensFor(state.current, 16), size = state.base * 1.06, gap;
    var placements;
    for (var attempt = 0; attempt < 16; attempt++) {
      gap = size * .30;
      placements = items.map(function (item, i) {
        var seed = state.current.t + i;
        return { item: item, seed: seed, width: widthOf(state.ctx, item.text, size), xJitter: (random(seed + 1) - .5) * size * .35, yJitter: (random(seed + 2) - .5) * size * .5, angle: (random(seed + 3) - .5) * .15, scale: 1.1 + random(seed + 4) * .2 };
      });
      var total = placements.reduce(function (n, p) { return n + p.width * p.scale * 1.46 + gap; }, -gap);
      if (total <= r.width * .86 || size <= 16) break;
      size *= .88;
    }
    // A very long sentence is folded without losing glyphs; short lines retain Folia's loose row.
    if (total > r.width * .86 || size < state.base * .44) {
      if (state.f.reducedMotion) block(state, state.current.text, { x: r.x + r.width * .07, y: r.y + r.height * .22, width: r.width * .86, height: r.height * .55 }, { size: state.base * .68, maxRows: 4 });
      else kineticBlock(state, state.current.text, { x: r.x + r.width * .07, y: r.y + r.height * .18, width: r.width * .86, height: r.height * .62 }, { size: state.base * .68 });
      footer(state); return;
    }
    var cursor = r.x + (r.width - total) / 2;
    var breath = state.f.reducedMotion ? 0 : Math.sin(state.motion * Math.PI * 2 / 7) * Math.min(14, r.height * .025);
    placements.forEach(function (p) {
      var motion = tokenMotion(state, p.item, p.seed, 'classic'), cell = p.width * p.scale * 1.46;
      drawRun(state, p.item.text, cursor + cell / 2 + p.xJitter + motion.x, r.y + r.height * .44 - size / 2 + p.yJitter + breath + motion.y, size * p.scale * motion.scale, { align: 'center', angle: p.angle + motion.angle, startChar: p.item.startChar, alpha: motion.alpha, blur: motion.blur });
      cursor += cell + gap;
    });
    footer(state);
  }
  function partita(state) {
    var r = state.r, units = tokensFor(state.current, 16), rowCount = Math.min(units.length, Math.max(2, Math.min(4, Math.floor(r.height * .65 / 95))));
    var chunks = [], offset = 0, seed = state.current.t || .5;
    for (var i = 0; i < rowCount; i++) {
      var remaining = units.length - offset, slots = rowCount - i, average = remaining / slots;
      var length = i === rowCount - 1 ? remaining : clamp(Math.round(average + (random(seed++) - .5) * average), 1, remaining - slots + 1);
      var part = units.slice(offset, offset + length); offset += length;
      chunks.push({ text: part.map(function (p) { return p.text; }).join(''), startChar: part[0].startChar, shift: (i % 2 ? 1 : -1) * (.04 + random(seed++) * .10), scale: .8 + random(seed++) * .50 });
    }
    var rowHeight = r.height * .72 / Math.max(1, chunks.length), top = r.y + r.height * .08;
    chunks.forEach(function (chunk, i) {
      var width = r.width * .70, x = r.x + r.width / 2 + r.width * chunk.shift;
      var rect = { x: x - width / 2, y: top + i * rowHeight, width: width, height: rowHeight * .88 };
      var drawn = kineticBlock(state, chunk.text, rect, { size: Math.min(state.base * 1.22 * chunk.scale, rowHeight * .60), startChar: chunk.startChar });
      line(state.ctx, rect.x + width * .07, drawn.y + drawn.height - drawn.size * .05, rect.x + width * .93, drawn.y + drawn.height - drawn.size * .05, state.theme.muted, .19);
      line(state.ctx, i % 2 ? rect.x + width * .93 : rect.x + width * .07, drawn.y + drawn.height - 10, i % 2 ? rect.x + width * .93 : rect.x + width * .07, drawn.y + drawn.height + 5, state.theme.accent, .45);
    }); footer(state);
  }
  function intersectArea(a, b) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  }
  function cadenza(state) {
    var r = state.r, tokens = tokensFor(state.current, 12), size = state.base * .84;
    var placements = [], hero = heroFor(state.current, tokens), region = { x: r.x + r.width * .06, y: r.y + r.height * .10, width: r.width * .88, height: r.height * .70 };
    var cacheKey = [state.current.text, state.current.t, r.x, r.y, r.width, r.height, state.base, hero, tokens.map(function (token) { return token.startChar + ':' + token.endChar; }).join(',')].join('|'), cached = placementCache.get(cacheKey), fits = false;
    var order = tokens.map(function (_, i) { return i; }).sort(function (a, b) { return a === hero ? -1 : (b === hero ? 1 : a - b); });
    for (var retry = 0; !cached && retry < 14; retry++) {
      placements = []; fits = true;
      order.forEach(function (index) {
        var token = tokens[index], isHero = index === hero, seed = state.current.t + index * 7.13;
        var scale = isHero ? 1.46 : .82 + random(seed + 4) * .25;
        var w = widthOf(state.ctx, token.text, size * scale) * 1.32, h = size * scale * 1.78, padding = Math.max(6, size * .12);
        var preferredX = region.x + region.width / 2 - w / 2 + (isHero ? 0 : (random(seed + 1) - .5) * region.width * .66);
        var preferredY = region.y + region.height / 2 - h / 2 + (isHero ? 0 : (random(seed + 2) - .5) * region.height * .60);
        var best = null, bestScore = Infinity, step = Math.max(10, size * .14);
        for (var radius = 0; radius <= Math.max(region.width, region.height) * .6; radius += step) {
          var count = radius === 0 ? 1 : Math.max(12, Math.round(Math.PI * 2 * radius / Math.max(step * 1.1, 10)));
          for (var point = 0; point < count; point++) {
            var angle = point * Math.PI * 2 / count + random(seed + 7) * Math.PI * 2;
            var x = preferredX + Math.cos(angle) * radius, y = preferredY + Math.sin(angle) * radius * .80;
            var box = { x: x - padding, y: y - padding, width: w + padding * 2, height: h + padding * 2 };
            if (box.x < region.x || box.y < region.y || box.x + box.width > region.x + region.width || box.y + box.height > region.y + region.height) continue;
            var overlap = placements.reduce(function (sum, p) { return sum + intersectArea(box, p.box); }, 0), score = overlap * 2.2 + radius;
            if (score < bestScore) { bestScore = score; best = { x: x, y: y, width: w, height: h, size: size * scale, box: box, token: token, hero: isHero, angle: (random(seed + 3) - .5) * .12 }; }
            if (overlap === 0) break;
          }
          if (best && bestScore <= radius + .01) break;
        }
        if (!best || bestScore > Math.max(region.width, region.height)) fits = false;
        if (best) placements.push(best);
      });
      if (fits && placements.length === tokens.length) break;
      size *= .86;
    }
    if (cached) { placements = cached.placements; size = cached.size; fits = cached.fits; }
    else remember(placementCache, cacheKey, { placements: placements, size: size, fits: fits }, 48);
    if (!fits || placements.length !== tokens.length) { kineticBlock(state, state.current.text, region, { size: size }); footer(state); return; }
    placements.forEach(function (p) {
      var motion = tokenMotion(state, p.token, state.current.t + p.token.startChar * 7.13, 'cadenza');
      if (p.hero) {
        state.ctx.save(); state.ctx.globalAlpha *= .11 * motion.alpha; state.ctx.strokeStyle = state.theme.accent; state.ctx.lineWidth = 1;
        state.ctx.beginPath(); state.ctx.ellipse(p.x + p.width / 2 + motion.x, p.y + p.height / 2 + motion.y, p.width * .60 + 12, p.height * .68, -.16, 0, Math.PI * 2); state.ctx.stroke(); state.ctx.restore();
      }
      drawRun(state, p.token.text, p.x + p.width / 2 + motion.x, p.y + (p.height - p.size * motion.scale * 1.28) / 2 + motion.y, p.size * motion.scale, { align: 'center', angle: p.angle + motion.angle, startChar: p.token.startChar, alpha: motion.alpha, blur: motion.blur });
    }); footer(state);
  }
  function fume(state) {
    var r = state.r, column = { x: r.x + r.width * .10, y: r.y + r.height * .10, width: r.width * .80, height: r.height * .73 }, currentSize = state.base * .76;
    label(state, 'LYRIC ARCHIVE   /   ' + String(state.f.index + 1).padStart(2, '0'), column.x, r.y + r.height * .01);
    var anchor = lyricColumn(state, column, currentSize, SERIF, .46, true);
    line(state.ctx, column.x - 16, anchor - currentSize * .48, column.x - 16, anchor + currentSize * .48, state.theme.accent, .85); footer(state);
  }
  function tilt(state) {
    var r = state.r, angled = state.f.index % 2 !== 0, angle = angled ? -.115 : .025;
    subline(state, state.f.index - 1, r.y + r.height * .12, .24, 'left');
    var rect = { x: r.x + r.width * .12, y: r.y + r.height * .30, width: r.width * .76, height: r.height * .40 };
    var enter = entrance(state, 0, chars(state.current.text).length, 0, angled ? .6 : .55);
    rect.y += (1 - enter) * (angled ? 24 : 20);
    var rows = typographyBlock(state, state.current.text, rect, { size: state.base * 1.12 * (angled ? mix(.92, 1, enter) : 1), weight: 800, family: SANS, angle: angle, motion: 'tilt', maxRows: 3 });
    var underlineY = Math.min(r.y + r.height * .77, rows.y + rows.height + 8);
    line(state.ctx, rect.x + 12, underlineY, rect.x + rect.width - 12, underlineY - (angled ? rect.width * .075 : 0), state.theme.accent, .65);
    subline(state, state.f.index + 1, r.y + r.height * .75, .33, 'right'); footer(state);
  }
  function claddagh(state) {
    var r = state.r, glyphs = chars(state.current.text), size = Math.min(state.base * .98, r.height * .19);
    var radius = Math.min(r.width * .62, r.height * .90), measured, tracking = 1.48;
    for (var attempt = 0; attempt < 18; attempt++) {
      measured = measureChars(state.ctx, glyphs, size, SERIF, 600, size * .06);
      // Reserve the largest 1.386x focused glyph, then invert the projected
      // ellipse spacing. Measuring base glyphs alone collapses adjacent CJK
      // letters when the depth transform enlarges the centre of the ring.
      if (measured.width * tracking <= radius * 1.28 || size <= 13) break;
      size *= .88;
    }
    if (size < 14 && glyphs.length > 38) {
      block(state, state.current.text, { x: r.x + r.width * .1, y: r.y + r.height * .25, width: r.width * .8, height: r.height * .5 }, { size: state.base * .55, maxRows: 5 }); footer(state); return;
    }
    var cx = r.x + r.width / 2, cy = r.y + r.height * .45, advance = 0, positions = [];
    measured.widths.forEach(function (width) {
      var target = (advance + width / 2 - measured.width / 2) * tracking / radius;
      var low = -.94, high = .94, angle = 0;
      for (var step = 0; step < 14; step++) {
        angle = (low + high) / 2;
        var depth = (Math.cos(angle) + 1) / 2, projected = Math.sin(angle) * (.35 + .65 * Math.pow(depth, 1.2));
        if (projected < target) low = angle; else high = angle;
      }
      positions.push(angle); advance += width + size * .06;
    });
    // Folia's ring is a 45-degree tilted, foreshortened ellipse. The word
    // offset follows actual timestamps; LRC only settles the ring at entry.
    var offset = 0, timingList = state.current.timings || [];
    if (!state.f.reducedMotion && state.current.hasWordTiming) {
      var previous = null, next = null;
      timingList.forEach(function (timing, i) {
        if (!timing) return;
        if (timing.start <= state.f.time) previous = { timing: timing, angle: positions[i] };
        else if (!next) next = { timing: timing, angle: positions[i] };
      });
      if (previous && next) offset = mix(previous.angle, next.angle, clamp((state.f.time - previous.timing.start) / (next.timing.start - previous.timing.start), 0, 1));
      else if (previous) offset = previous.angle;
      else if (next) offset = next.angle;
    } else if (!state.f.reducedMotion) offset = -.8 * (1 - easeOut((state.f.time - state.current.t) / .7));
    var tilt = Math.PI / 4, cos = Math.cos(tilt), sin = Math.sin(tilt);
    glyphs.forEach(function (glyph, i) {
      var a = positions[i] - offset, depth = (Math.cos(a) + 1) / 2, spacing = .35 + .65 * Math.pow(depth, 1.2);
      var rawX = Math.sin(a) * radius * spacing, rawY = Math.cos(a) * radius * .09;
      var focus = Math.pow(Math.max(0, Math.cos(a)), 8), scale = (.22 + .98 * Math.pow(depth, 1.5)) * (1 + .65 * focus);
      var reveal = entrance(state, i, i + 1, 0, .45), glyphSize = size * scale * .70;
      var x = cx + rawX * cos - rawY * sin, y = cy + rawX * sin + rawY * cos;
      drawRun(state, glyph, x, y - glyphSize / 2, glyphSize, { align: 'center', startChar: i, angle: tilt * .66 + clamp(a * .15, -.25, .25), alpha: (.40 + .60 * depth) * reveal, blur: state.f.reducedMotion ? 0 : 8 * (1 - depth) * (1 - .5 * focus) });
    });
    footer(state);
  }
  function pendolo(state) {
    var r = state.r, ctx = state.ctx, radius = Math.min(r.width * .48, r.height * .72), cx = r.x - radius * .30, cy = r.y + r.height * .45;
    ctx.save(); ctx.strokeStyle = state.theme.muted; ctx.globalAlpha *= .16; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, radius, -1.24, 1.24); ctx.stroke();
    for (var tick = -15; tick <= 15; tick++) {
      var a = tick * .065; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (radius - 8), cy + Math.sin(a) * (radius - 8)); ctx.lineTo(cx + Math.cos(a) * (radius + (tick % 5 === 0 ? 8 : 2)), cy + Math.sin(a) * (radius + (tick % 5 === 0 ? 8 : 2))); ctx.stroke();
    } ctx.restore();
    var currentSize = state.base * .77;
    var activeX = cx + radius + 25, activeWidth = Math.max(50, r.x + r.width * .95 - activeX);
    var items = flowLayout(state, activeWidth, currentSize, r.height * .34, SANS, Math.max(24, radius * .20 - currentSize * 1.38));
    var focus = focusIndex(state), camera = flowFocus(items, focus);
    for (var index = Math.max(0, Math.floor(focus) - 6); index <= Math.min(items.length - 1, Math.ceil(focus) + 6); index++) {
      var item = items[index], angle = (item.center - camera) / Math.max(1, radius);
      if (Math.abs(angle) >= 1.42) continue;
      var x = cx + Math.cos(angle) * radius + 25, y = cy + Math.sin(angle) * radius;
      var distance = Math.abs(index - focus), emphasis = clamp(1 - distance, 0, 1);
      var scale = .78 + emphasis * .22;
      var opacity = (.40 + emphasis * .60) * Math.pow(Math.cos(angle * .75), 2.5);
      flowLine(state, item, index, x, y, SANS, scale, opacity, emphasis, false);
    }
    ctx.save(); ctx.fillStyle = state.theme.accent; ctx.beginPath(); ctx.arc(cx + radius + 7, cy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); footer(state);
  }
  function cappella(state) {
    var r = state.r, ctx = state.ctx, width = r.width * (r.width < 600 ? .80 : .64), size = state.base * .62;
    var bottom = r.y + r.height * .82, cards = [];
    for (var index = state.f.index; index >= Math.max(0, state.f.index - 5); index--) {
      var item = lineAt(state, index), cardSize = size, rows = wrap(state, item.text, cardSize, width - 38), height = rows.length * cardSize * 1.32 + 30;
      for (var retry = 0; height > r.height * .54 && retry < 30; retry++) { cardSize *= .86; rows = wrap(state, item.text, cardSize, width - 38); height = rows.length * cardSize * 1.32 + 30; }
      if (bottom - height < r.y + r.height * .05 && index !== state.f.index) break;
      cards.unshift({ item: item, index: index, y: bottom - height, height: height, rows: rows, size: cardSize }); bottom -= height + 16;
    }
    cards.forEach(function (card) {
      var right = card.index % 2 === 1, x = right ? r.x + r.width * .94 - width : r.x + r.width * .06, active = card.index === state.f.index;
      var entry = active && !state.f.reducedMotion ? 1 - easeOut((state.f.time - card.item.t) / .32) : 0;
      var y = card.y + entry * 22;
      x += (right ? 1 : -1) * entry * 14;
      ctx.save(); ctx.globalAlpha *= (active ? .92 : .24) * (1 - entry); ctx.fillStyle = right ? state.theme.accent : '#24333b'; rounded(ctx, x, y, width, card.height, 19); ctx.fill(); ctx.restore();
      var textColor = right ? '#10171c' : state.theme.foreground;
      card.rows.forEach(function (row, i) { drawRun(state, row.text, x + 19, y + 12 + i * card.size * 1.32, card.size * mix(.98, 1, 1 - entry), { family: SANS, weight: active ? 650 : 500, color: textColor, accent: right ? '#10171c' : state.theme.accent, protect: !right, highlight: active, alpha: (active ? 1 : .60) * (1 - entry), startChar: row.start, index: card.index }); });
      label(state, right ? 'YOU' : 'ME', right ? x + width - 4 : x + 4, y - 14, { align: right ? 'right' : undefined, alpha: .35 });
    }); footer(state);
  }
  function coverImage(state, x, y, size, radius) {
    var ctx = state.ctx;
    ctx.save(); rounded(ctx, x, y, size, size, radius || 3); ctx.clip();
    ctx.fillStyle = '#1f3037'; ctx.fillRect(x, y, size, size);
    var image = state.f.coverImage;
    if (image && (image.naturalWidth || image.width)) {
      var w = image.naturalWidth || image.width, h = image.naturalHeight || image.height, side = Math.min(w, h);
      try { ctx.drawImage(image, (w - side) / 2, (h - side) / 2, side, side, x, y, size, size); } catch (_) { }
    } else {
      var gradient = ctx.createLinearGradient(x, y, x + size, y + size); gradient.addColorStop(0, '#203c48'); gradient.addColorStop(1, '#503b52'); ctx.fillStyle = gradient; ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = state.theme.accent; ctx.globalAlpha *= .38; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + size * .5, y + size * .5, size * .28, 0, Math.PI * 2); ctx.stroke();
    } ctx.restore();
  }
  function monet(state) {
    var r = state.r, portrait = r.width < 600, coverSize = portrait ? Math.min(r.width * .34, r.height * .24) : Math.min(r.width * .32, r.height * .60);
    var coverX = portrait ? r.x + r.width * .08 : r.x + r.width * .06, coverY = portrait ? r.y + r.height * .05 : r.y + (r.height - coverSize) / 2 - 14;
    coverImage(state, coverX, coverY, coverSize, 4);
    var titleRect = portrait ? { x: coverX + coverSize + 17, y: coverY, width: r.width * .82 - coverSize - 17, height: coverSize } : { x: coverX, y: coverY + coverSize + 15, width: coverSize, height: 52 };
    block(state, state.f.song && state.f.song.name || 'Vesper', titleRect, { size: Math.min(24, state.base * .42), family: SANS, weight: 600, highlight: false, align: 'left', maxRows: 2, mark: false });
    var column = portrait ? { x: r.x + r.width * .08, y: coverY + coverSize + 28, width: r.width * .84, height: r.height * .60 } : { x: r.x + r.width * .45, y: r.y + r.height * .15, width: r.width * .49, height: r.height * .70 };
    var size = state.base * (portrait ? .61 : .66);
    lyricColumn(state, column, size, SANS, .47, false);
    footer(state);
  }
  function sonnet(state) {
    var r = state.r, ctx = state.ctx, parts = tokensFor(state.current, 8), heroIndex = heroFor(state.current, parts);
    var hero = parts[heroIndex];
    var side = Math.max(16, r.width * .07);
    label(state, 'VESPER  /  SONNET', r.x + side, r.y + r.height * .04, { alpha: .55 });
    line(ctx, r.x + side, r.y + r.height * .11, r.x + r.width - side, r.y + r.height * .11, state.theme.muted, .3);
    var heroRect = { x: r.x + r.width * .16, y: r.y + r.height * .25, width: r.width * .68, height: r.height * .40 };
    var heroGlyphs = chars(hero.text), heroBlock;
    if (state.f.index % 2 && heroGlyphs.length >= 2 && heroGlyphs.length <= 5) {
      var verticalSize = Math.min(state.base * 1.55, heroRect.height / (heroGlyphs.length * .97));
      heroGlyphs.forEach(function (glyph, i) {
        var motion = glyphMotion(state, hero.startChar + i, verticalSize, 'sonnet', true);
        drawRun(state, glyph, heroRect.x + heroRect.width / 2 + motion.x, heroRect.y + i * verticalSize * .97 + motion.y, verticalSize, { align: 'center', weight: 800, startChar: hero.startChar + i, angle: motion.angle, alpha: motion.alpha });
      });
      heroBlock = { y: heroRect.y, height: heroGlyphs.length * verticalSize * .97 };
    } else heroBlock = typographyBlock(state, hero.text, heroRect, { size: state.base * 2.1, weight: 800, family: SERIF, motion: 'sonnet', maxRows: 2, startChar: hero.startChar });
    var leading = parts.slice(0, heroIndex), trailing = parts.slice(heroIndex + 1);
    if (leading.length) typographyBlock(state, leading.map(function (p) { return p.text; }).join(''), { x: r.x + side, y: r.y + r.height * .14, width: r.width - side * 2, height: r.height * .13 }, { size: state.base * .54, align: 'left', motion: 'sonnet', startChar: leading[0].startChar, maxRows: 2 });
    if (trailing.length) typographyBlock(state, trailing.map(function (p) { return p.text; }).join(''), { x: r.x + side, y: r.y + r.height * .69, width: r.width - side * 2, height: r.height * .14 }, { size: state.base * .57, align: 'right', motion: 'sonnet', startChar: trailing[0].startChar, maxRows: 2 });
    label(state, String(state.f.index + 1).padStart(2, '0'), r.x + r.width - side, heroBlock.y + heroBlock.height - 12, { align: 'right', alpha: .45 });
    footer(state);
  }
  function tempera(state) {
    var r = state.r, ctx = state.ctx, tokens = tokensFor(state.current, 3), rowHeight = r.height * .66 / Math.max(1, tokens.length), top = r.y + r.height * .12;
    ctx.save(); ctx.globalAlpha *= .10; ctx.fillStyle = state.theme.accent; ctx.filter = 'none';
    // One path for the entire print texture. Applying a scene blur to thousands
    // of individual dot fills stalls Canvas rendering during a crossfade.
    ctx.beginPath();
    for (var xx = r.x + r.width * .1; xx < r.x + r.width * .9; xx += 13) for (var yy = r.y + r.height * .15; yy < r.y + r.height * .78; yy += 13) { ctx.moveTo(xx + 1.1, yy); ctx.arc(xx, yy, 1.1, 0, Math.PI * 2); }
    ctx.fill();
    ctx.restore();
    tokens.forEach(function (token, i) {
      var width = r.width * (.78 + (i % 2) * .06), x = r.x + (r.width - width) / 2 + (i % 2 ? 1 : -1) * r.width * .025, y = top + i * rowHeight;
      var timing = tokenTime(state, token.startChar, token.endChar), age = state.f.time - timing.start + (timing.word ? .15 : 0);
      var linear = state.f.reducedMotion ? 1 : clamp(age / .55, 0, 1), entry = 1 - cubicBezier(.22, 1, .36, 1, linear);
      var kind = (state.f.index * 3 + i) % 7, travel = Math.min(64, r.width * .085), scale = 1 - .12 * entry;
      var angle = (i % 2 ? .025 : -.035), warm = i % 2 === 0, alpha = state.f.reducedMotion ? 1 : clamp(age / .14, 0, 1);
      if (kind === 0 || kind === 1) x -= travel * entry;
      else if (kind === 2) x += travel * entry;
      else if (kind === 3) y -= travel * entry;
      else if (kind === 4) y += travel * entry;
      else if (kind === 5) { angle += .95 * entry; x += travel * .6 * entry; }
      else scale = 1 + .70 * entry;
      var visibleWidth = width * scale, visibleHeight = rowHeight * scale;
      x += (width - visibleWidth) / 2; y += (rowHeight - visibleHeight) / 2;
      ctx.save(); ctx.translate(x + visibleWidth / 2, y + visibleHeight / 2); ctx.rotate(angle); ctx.globalAlpha *= .95 * alpha;
      ctx.fillStyle = warm ? state.theme.accent : state.theme.foreground; ctx.fillRect(-visibleWidth / 2, -visibleHeight * .43, visibleWidth, visibleHeight * .86); ctx.restore();
      block(state, token.text, { x: x + 13, y: y + visibleHeight * .07, width: visibleWidth - 26, height: visibleHeight * .85 }, { size: Math.min(state.base * 1.12, rowHeight * .67) * scale, angle: angle, alpha: alpha, family: SANS, weight: 900, color: '#10171c', accent: '#10171c', protect: false, highlight: true, startChar: token.startChar, maxRows: 2 });
    }); footer(state);
  }
  function diorama(state) {
    var r = state.r, ctx = state.ctx, cx = r.x + r.width / 2, vanishingY = r.y + r.height * .18;
    ctx.save(); ctx.strokeStyle = state.theme.muted; ctx.lineWidth = 1; ctx.globalAlpha *= .16;
    for (var rail = -2; rail <= 2; rail++) { ctx.beginPath(); ctx.moveTo(cx + rail * r.width * .03, vanishingY); ctx.lineTo(cx + rail * r.width * .27, r.y + r.height * .88); ctx.stroke(); }
    ctx.restore();
    // Continuous camera depth keeps the corridor advancing through a line
    // boundary instead of swapping a static foreground and four thumbnails.
    var focus = focusIndex(state), float = state.f.reducedMotion ? 0 : Math.sin(state.motion * .4) * r.height * .009;
    for (var index = Math.min(state.lines.length - 1, Math.ceil(focus) + 4); index >= Math.max(0, Math.floor(focus) - 1); index--) {
      var item = lineAt(state, index); if (!item || !item.text) continue;
      var depth = index - focus, scale = 1 / Math.max(.62, 1 + depth * .60);
      var y = vanishingY + r.height * .45 * scale + float;
      var alpha = depth >= 0 ? mix(1, .16, clamp(depth / 2.5, 0, 1)) : clamp(1 + depth, 0, 1);
      if (alpha <= .01) continue;
      block(state, item.text, { x: cx - r.width * .41 * scale, y: y - r.height * .14 * scale, width: r.width * .82 * scale, height: r.height * .28 * scale }, { size: state.base * 1.04 * scale, family: SANS, weight: 800, alpha: alpha, highlight: index === state.f.index, index: index, maxRows: 3 });
    }
    footer(state);
  }
  var painters = { classic: classic, partita: partita, cadenza: cadenza, fume: fume, tilt: tilt, claddagh: claddagh, pendolo: pendolo, cappella: cappella, monet: monet, sonnet: sonnet, tempera: tempera, diorama: diorama };
  var sceneStyles = new Set(['classic', 'partita', 'cadenza', 'tilt', 'claddagh', 'sonnet', 'tempera']);
  function paintScene(state, index) {
    var item = state.lines[index], time = Number(state.f.time) || 0, reduced = state.f.reducedMotion;
    var lookahead = item.hasWordTiming ? .15 : 0, elapsed = time - item.t + lookahead;
    var enter = reduced ? 1 : easeOut(elapsed / .3);
    var exit = reduced ? 0 : clamp((time - item.end) / .3, 0, 1);
    if (enter <= 0 || exit >= 1) return;
    var child = Object.assign({}, state), r = state.r;
    child.current = item;
    child.f = Object.assign({}, state.f, { index: index });
    child.highlightMode = index === state.f.index ? state.highlightMode : (item.hasWordTiming ? 'word' : 'line');
    if (index !== state.f.index) child.f.charProgress = (item.timings || []).map(function (timing) { return timing ? clamp((time - timing.start) / Math.max(.02, timing.end - timing.start), 0, 1) : 1; });
    var glowStyle = state.f.style === 'classic' || state.f.style === 'partita' || state.f.style === 'cadenza';
    var scale = glowStyle ? mix(.9, 1, enter) + .1 * smooth(exit) : 1;
    var y = state.f.style === 'tilt' ? -16 * smooth(exit) : 0;
    child.layerMotion = { cx: r.x + r.width / 2, cy: r.y + r.height * .46, scale: scale, x: 0, y: y };
    child.layerBlur = reduced ? 0 : (glowStyle ? 10 * (1 - enter) + 20 * smooth(exit) : 6 * smooth(exit));
    var ctx = state.ctx, layer = child.layerMotion;
    ctx.save(); ctx.globalAlpha *= enter * (1 - smooth(exit));
    ctx.translate(layer.cx, layer.cy + layer.y); ctx.scale(scale, scale); ctx.translate(-layer.cx, -layer.cy);
    // drawRun expresses defocus locally with glyph glow. Decorations must not
    // inherit a scene-wide filter or draw an overlay across the wallpaper.
    (painters[state.f.style] || classic)(child);
    ctx.restore();
  }
  function draw(ctx, frame) {
    frame = frame || {};
    var width = Math.max(1, Number(frame.width) || 1), height = Math.max(1, Number(frame.height) || 1);
    var source = frame.contentRect || { x: width * .04, y: height * .10, width: width * .92, height: height * .73 };
    var r = { x: clamp(source.x, 0, width), y: clamp(source.y, 0, height), width: clamp(source.width, 1, width), height: clamp(source.height, 1, height) };
    r.width = Math.max(1, Math.min(r.width, width - r.x)); r.height = Math.max(1, Math.min(r.height, height - r.y));
    var theme = Object.assign({ background: '#0b1118', foreground: '#f3eee3', accent: '#e8c57f', muted: '#9aa9b6' }, frame.theme || {});
    var state = { ctx: ctx, f: frame, lines: frame.lines || [], r: r, theme: theme, bounds: [], drawnLines: [], motion: frame.reducedMotion ? 0 : Number(frame.time) || 0, base: Math.min(r.width < 600 ? 52 : 88, Math.max(24, r.width * .069), r.height * .20) * clamp(frame.fontScale == null ? 1 : frame.fontScale, .65, 1.6) };
    state.current = state.lines[frame.index];
    state.highlightMode = frame.highlightMode === 'word' || frame.highlightMode === 'estimated' ? frame.highlightMode : 'line';
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    // The lyric layer is transparent. Wallpaper brightness belongs to the
    // wallpaper controls; contrast protection is local to the glyph strokes.
    ctx.beginPath(); ctx.rect(r.x, r.y, r.width, r.height); ctx.clip();
    var scenes = [];
    if (sceneStyles.has(frame.style || 'classic') && !(frame.lyricState && frame.lyricState.kind === 'ended')) {
      var around = frame.index;
      if (!(around >= 0)) {
        around = 0;
        while (around + 1 < state.lines.length && state.lines[around + 1].t <= frame.time) around++;
      }
      for (var candidate = Math.max(0, around - 1); candidate <= Math.min(state.lines.length - 1, around + 1); candidate++) {
        var item = state.lines[candidate], lookahead = !frame.reducedMotion && item.hasWordTiming ? .15 : 0;
        var tail = frame.reducedMotion ? 0 : .3;
        var semanticGap = !(frame.index >= 0), edgeOnly = !semanticGap || frame.time < item.t || frame.time >= item.end;
        if (item.text && edgeOnly && frame.time >= item.t - lookahead && frame.time < item.end + tail) scenes.push(candidate);
      }
    }
    if (scenes.length) scenes.forEach(function (index) { paintScene(state, index); });
    else if (!state.current || !state.current.text) {
      var name = frame.song && frame.song.name || 'Vesper';
      block(state, name, { x: r.x + r.width * .08, y: r.y + r.height * .34, width: r.width * .84, height: r.height * .28 }, { size: state.base * .75, highlight: false, index: -1, maxRows: 3 });
      var message = frame.lyricState && typeof frame.lyricState.message === 'string' ? frame.lyricState.message : '聆听此刻';
      if (message) block(state, message, { x: r.x + r.width * .12, y: r.y + r.height * .66, width: r.width * .76, height: r.height * .17 }, { size: Math.min(20, state.base * .37), family: SANS, highlight: false, index: -1, color: state.theme.foreground, alpha: .86, maxRows: 3 });
    } else if (!sceneStyles.has(frame.style || 'classic')) (painters[frame.style] || classic)(state);
    ctx.restore();
    return { bounds: state.bounds, style: painters[frame.style] ? frame.style : 'classic', drawnLines: state.drawnLines };
  }
  window.VesperLyricRenderers = { styles: styles, draw: draw, invalidateFontMetrics: invalidateFontMetrics };
})();
