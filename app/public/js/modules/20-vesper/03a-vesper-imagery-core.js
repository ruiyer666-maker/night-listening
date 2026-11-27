// Vesper 歌词意象：移植自 src/lib/imagery.js。纯词表与时间线，不依赖 DOM / 音频 / Three.js。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VesperImageryCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var kinds = {
    rain: { name: '雨', color: '#9ecbff' }, snow: { name: '雪', color: '#e8f2ff' },
    star: { name: '星', color: '#ffd98a' }, sea: { name: '海', color: '#5fd4d0' },
    wind: { name: '风', color: '#b8f0d8' }, moon: { name: '月', color: '#fff1c9' },
    glow: { name: '灯火', color: '#ffb35c' }, flower: { name: '花', color: '#ff9ec4' }
  };
  var keys = Object.keys(kinds);
  var vocabulary = {
    rain: '梅雨 下雨 雨 伞 淋湿 雷 rain raining storm umbrella',
    snow: '雪花 雪 冬天 结冰 snow winter',
    star: '银河 星空 宇宙 流星 星 star stars galaxy universe',
    sea: '大海 海浪 浪花 海 浪 潮 岸 港 sea ocean wave waves tide',
    wind: '风 吹 wind breeze',
    moon: '月光 月亮 月 moon moonlight',
    glow: '烟花 烟火 火花 萤火 灯火 路灯 灯 火 太阳 阳光 光 fire light lights sun sunshine firework fireworks',
    flower: '樱花 花瓣 花 春天 flower flowers bloom blossom'
  };
  var words = [];
  keys.forEach(function (kind) {
    vocabulary[kind].split(' ').forEach(function (word) {
      words.push({ word: word, kind: kind, latin: /^[a-z]/.test(word) });
    });
  });
  words.sort(function (a, b) { return b.word.length - a.word.length; });
  var exclusions = /星期|明星|星座|零星|星级|卫星|[一二三四五六七八九十正腊\d]月|月[台份底初末薪票历饼]|岁月|蜜月|时光|光阴|光年|目光|光荣|曝光|光顾|光临|光盘|光头|风光|风格|风险|风度|作风|威风|吹牛|吹嘘|花钱|花费|花样|花心|眼花|雪碧|雪糕|海报|海鲜|浪费|潮湿|港口城市|火车|火锅|发火|上火|火柴|灯泡|有点潮|很潮|发潮|返潮|潮气|潮流|潮牌/g;

  function findImagery(input) {
    var text = String(input || '');
    var lower = text.toLowerCase();
    var taken = new Uint8Array(text.length);
    var blocked = new Uint8Array(text.length);
    var result = [], match;
    exclusions.lastIndex = 0;
    while ((match = exclusions.exec(text))) {
      for (var b = match.index; b < match.index + match[0].length; b++) blocked[b] = 1;
    }
    words.forEach(function (item) {
      var start = lower.indexOf(item.word);
      while (start >= 0) {
        var end = start + item.word.length;
        var valid = !(item.latin && (/[a-z]/i.test(lower[start - 1] || '') || /[a-z]/i.test(lower[end] || '')));
        for (var i = start; valid && i < end; i++) if (taken[i] || blocked[i]) valid = false;
        if (valid) {
          result.push({ kind: item.kind, start: start, end: end, word: text.slice(start, end) });
          for (var j = start; j < end; j++) taken[j] = 1;
        }
        start = lower.indexOf(item.word, start + 1);
      }
    });
    return result.sort(function (a, b) { return a.start - b.start; });
  }

  var MAX_HOLD = 30;
  var FADE_IN = 0.8;
  var FADE_OUT = 2;
  function buildTimeline(input) {
    var lines = (Array.isArray(input) ? input : []).filter(function (line) {
      return line && !line.fallback && line.t !== null && line.t !== '' && Number.isFinite(Number(line.t)) && Number(line.t) >= 0 && String(line.text || '').trim();
    }).map(function (line) {
      return { t: Number(line.t), text: String(line.text), duration: Number(line.duration) || 0 };
    }).sort(function (a, b) { return a.t - b.t; });
    var cues = [];
    lines.forEach(function (line, index) {
      // 制作人员名单不是正在演唱的歌词，避免“灯光”“录音室”触发背景。
      if (/^\s*(作词|作曲|编曲|制作人|混音|母带|录音|灯光|词|曲)\s*[:：]/.test(line.text)) return;
      var marks = findImagery(line.text);
      // 当前句和后两句保留意象；长间奏/最后一句最多停留 30 秒，再淡出。
      var following = lines[index + 3];
      var last = lines[Math.min(lines.length - 1, index + 2)];
      var until = following ? following.t : last.t + Math.max(6, last.duration);
      var end = Math.min(line.t + MAX_HOLD, Math.max(line.t + 1, until));
      var seen = {};
      marks.forEach(function (mark) {
        if (seen[mark.kind]) return;
        seen[mark.kind] = true;
        cues.push({ kind: mark.kind, start: line.t, end: end, word: mark.word, text: line.text });
      });
    });
    return { cues: cues, lines: lines };
  }

  function sampleTimeline(timeline, seconds) {
    var levels = {}, labels = {};
    keys.forEach(function (key) { levels[key] = 0; });
    var t = Number(seconds);
    if (!Number.isFinite(t) || t < 0) return { levels: levels, labels: labels };
    var cues = timeline && timeline.cues || [];
    // 二分找最后一个已开始的意象，跳进度时直接重算，不携带上一首或未来的状态。
    var lo = 0, hi = cues.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (cues[mid].start <= t) lo = mid + 1;
      else hi = mid;
    }
    for (var i = lo - 1; i >= 0; i--) {
      var cue = cues[i];
      if (cue.start < t - MAX_HOLD - FADE_OUT) break;
      var strength = Math.max(0, Math.min(1, (t - cue.start) / FADE_IN, (cue.end + FADE_OUT - t) / FADE_OUT));
      if (strength > levels[cue.kind]) {
        levels[cue.kind] = strength;
        labels[cue.kind] = cue.word;
      }
    }
    return { levels: levels, labels: labels };
  }

  return { kinds: kinds, keys: keys, findImagery: findImagery, buildTimeline: buildTimeline, sampleTimeline: sampleTimeline };
});
