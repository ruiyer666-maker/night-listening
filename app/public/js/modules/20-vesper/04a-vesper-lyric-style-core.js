// Vesper lyric time adapter. Keeps the existing LRC/YRC timestamps authoritative.
(function (root) {
  'use strict';
  function finite(value, fallback) { var n = Number(value); return isFinite(n) ? n : fallback; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  var graphemeSegmenter, wordSegmenter;
  try {
    graphemeSegmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
    wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  } catch (_) { }
  function graphemes(text) {
    if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text)).map(function (s) { return { text: s.segment, offset: s.index }; });
    var offset = 0;
    return Array.from(text).map(function (s) { var item = { text: s, offset: offset }; offset += s.length; return item; });
  }
  function tokensFor(text, chars) {
    var pieces = wordSegmenter ? Array.from(wordSegmenter.segment(text)).map(function (s) { return { text: s.segment, offset: s.index }; }) : chars;
    return pieces.map(function (piece) {
      var start = 0, end = chars.length;
      while (start < chars.length && chars[start].offset < piece.offset) start++;
      end = start;
      while (end < chars.length && chars[end].offset < piece.offset + piece.text.length) end++;
      return { text: piece.text, startChar: start, endChar: end };
    }).filter(function (piece) { return piece.endChar > piece.startChar; });
  }
  function prepare(input, duration) {
    var mediaEnd = finite(duration, 0);
    var rows = (Array.isArray(input) ? input : []).map(function (line, index) {
      if (!line || typeof line !== 'object' || line.fallback) return null;
      var time = finite(line.t != null ? line.t : line.time, NaN);
      if (!isFinite(time) || time < 0) return null;
      return { raw: line, t: time, sourceIndex: index };
    }).filter(Boolean).sort(function (a, b) { return a.t - b.t || a.sourceIndex - b.sourceIndex; });
    return rows.map(function (row, index) {
      var rawText = String(row.raw.text || '');
      var leading = (rawText.match(/^\s*/) || [''])[0].length;
      var text = rawText.trim();
      var chars = graphemes(text);
      var next = rows[index + 1];
      // A line timestamp is not a word alignment or an explicit vocal end.
      // Keep the final LRC line static until the known media end (or until a
      // new line/track arrives), rather than inventing an eight-second tail.
      var fallbackEnd = next ? next.t : (mediaEnd > row.t ? mediaEnd : Infinity);
      var explicitDuration = finite(row.raw.duration, 0);
      var hasExplicitEnd = explicitDuration > 0 && row.raw.durationInferred !== true &&
        !/^(?:custom-)?lrc(?:-line)?$/.test(String(row.raw.source || ''));
      var words = Array.isArray(row.raw.words) ? row.raw.words : [];
      var wordEnd = words.reduce(function (end, word) {
        var start = finite(word.t, NaN), length = finite(word.d, 0);
        var c0 = finite(word.c0, NaN) - leading, c1 = finite(word.c1, NaN) - leading;
        var matched = chars.some(function (char) { return char.offset < c1 && char.offset + char.text.length > c0; });
        return isFinite(start) && length > 0 && c1 > c0 && matched ? Math.max(end, start + length) : end;
      }, row.t);
      var end = hasExplicitEnd ? Math.min(Math.max(row.t + explicitDuration, wordEnd), fallbackEnd) :
        (wordEnd > row.t ? Math.min(wordEnd, fallbackEnd) : fallbackEnd);
      hasExplicitEnd = hasExplicitEnd || wordEnd > row.t;
      end = Math.max(row.t + 0.02, end);
      var timings = chars.map(function () { return null; });
      var hasWordTiming = false;
      words.forEach(function (word) {
        var start = finite(word.t, NaN), length = finite(word.d, 0);
        var c0 = finite(word.c0, NaN) - leading, c1 = finite(word.c1, NaN) - leading;
        if (!isFinite(start) || !isFinite(c0) || !isFinite(c1) || c1 <= c0 || length <= 0) return;
        var matched = [];
        chars.forEach(function (char, i) { if (char.offset < c1 && char.offset + char.text.length > c0) matched.push(i); });
        matched.forEach(function (charIndex, i) {
          var timing = { start: Math.max(row.t, start + length * i / matched.length), end: Math.min(end, start + length * (i + 1) / matched.length) };
          if (timing.end > timing.start) { timings[charIndex] = timing; hasWordTiming = true; }
        });
      });
      return { t: row.t, end: end, text: text, translation: String(row.raw.translation || '').trim(),
        chars: chars.map(function (char) { return char.text; }), tokens: tokensFor(text, chars),
        timings: timings, hasWordTiming: hasWordTiming, highlightMode: hasWordTiming ? 'word' : 'line',
        explicitEnd: hasExplicitEnd, source: String(row.raw.source || ''), sourceIndex: row.sourceIndex, fallback: false };
    });
  }
  function gapState(lines, time, index) {
    var before = -1, after = -1;
    lines.forEach(function (line, i) {
      if (!line.text) return;
      if (line.t > time) { if (after < 0) after = i; }
      else before = i;
    });
    if (before < 0) return after >= 0 ? 'intro' : 'unavailable';
    if (after >= 0) return 'interlude';
    var marker = index >= 0 && lines[index];
    if (lines[before].explicitEnd || marker && !marker.text && marker.t >= lines[before].t) return 'outro';
    return 'neutral';
  }
  function sample(lines, value) {
    var time = finite(value, 0), lo = 0, hi = lines.length - 1, index = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= time) { index = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (index < 0) return { index: -1, progress: 0, charProgress: [], highlightMode: 'line', state: gapState(lines, time, index) };
    var line = lines[index];
    // A gap is a timeline state, not proof that the entire track is instrumental.
    if (time >= line.end || !line.text) return { index: -1, progress: 0, charProgress: [], highlightMode: 'line', state: gapState(lines, time, index), gapAfter: index };
    var charProgress = line.timings.map(function (timing) {
      return timing ? clamp((time - timing.start) / Math.max(0.02, timing.end - timing.start), 0, 1) : 1;
    });
    return { index: index, progress: line.hasWordTiming ? clamp((time - line.t) / Math.max(0.02, line.end - line.t), 0, 1) : 1,
      charProgress: charProgress, highlightMode: line.highlightMode, state: 'ready' };
  }
  root.VesperLyricStyleCore = { prepare: prepare, sample: sample, graphemes: graphemes };
})(typeof window === 'undefined' ? globalThis : window);
