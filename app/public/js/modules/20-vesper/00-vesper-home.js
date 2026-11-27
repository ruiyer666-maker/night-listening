// ============================================================
// Vesper 首页：黑胶 Cover Flow 选歌
//
// 交互参考 MIMI Music Player（NanQiaoMi/music_source_code，MIT License）的 MusicCardStack：
//   一排 3D 黑胶封套，中间那张放大、跟着鼠标倾斜，唱片从封套里滑出来转；
//   滚轮 / 方向键 / 拖动换一张；单击中间卡片开始/继续播放，双击卡片进入舞台。
//   明确的播放/暂停按钮单独切换状态，卡片背景不会因双击的前序 click 暂停音乐。
// 原实现是 React + Framer Motion，这里用原生 JS 重写（自己的弹簧积分器），接到原项目的播放队列上。
// 弹簧参数、间距、倾角沿用 MIMI 调好的手感（stiffness 320 / damping 30 / mass 0.8，侧转 38°）。
//
// 数据：网易云排行榜、每日推荐、我喜欢、歌单、搜索结果，全部走 server.js（→ netease-api 服务）。
// ============================================================
(function () {
  'use strict';

  var CHARTS = [
    { key: 'chart-rise', kind: 'playlist', id: 19723756, label: '飙升榜' },
    { key: 'chart-new', kind: 'playlist', id: 3779629, label: '新歌榜' },
    { key: 'chart-hot', kind: 'playlist', id: 3778678, label: '热歌榜' }
  ];
  var SOURCE_STORE_KEY = 'vesper-home-source-v1';
  var PAGE_SIZE = 60;
  var SPRING = { k: 320, c: 30, m: 0.8 };
  var TILT_SPRING = { k: 350, c: 32, m: 1 };
  var MAX_HALF = 3;
  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var state = {
    items: [],
    center: 0,
    source: null,
    previousSource: null,
    loading: false,
    pageError: false,
    hasMore: false,
    nextOffset: 0,
    total: 0,
    seq: 0,
    hover: false,
    sleeve: 300,
    liked: null,
    loggedIn: false,
    accountKey: '',
    accountRequest: 0,
    searchTimer: 0,
    lastSongKey: '',
    lastPlaying: null,
    accentFor: ''
  };
  var cards = new Map();
  var tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  var els = {};
  var rafId = 0;
  var lastFrame = 0;
  var wheelLockedUntil = 0;
  var drag = null;

  // ---------- 小工具 ----------

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function homeActive() { return document.body.classList.contains('empty-home-active'); }
  function songKey(song) {
    if (!song) return '';
    if (typeof queueItemKey === 'function') { try { return queueItemKey(song); } catch (e) { } }
    return String(song.provider || song.source || 'netease') + '|' + String(song.id || song.name || '');
  }
  function currentSong() {
    try { return (typeof playQueue !== 'undefined' && currentIdx >= 0) ? playQueue[currentIdx] : null; } catch (e) { return null; }
  }
  function isPlayingNow() {
    try { return !!(typeof playing !== 'undefined' && playing); } catch (e) { return false; }
  }
  function artistText(song) {
    if (!song) return '';
    if (song.artist) return String(song.artist);
    if (Array.isArray(song.artists)) return song.artists.map(function (a) { return a && a.name; }).filter(Boolean).join(' / ');
    return '';
  }
  function coverUrl(song, size) {
    var raw = String((song && (song.cover || song.picUrl || song.coverUrl)) || '');
    if (!raw) return '';
    if (/music\.126\.net/.test(raw)) raw = raw.replace(/\?.*$/, '') + '?param=' + size + 'y' + size;
    // 封面经本机服务转一手（/api/cover）：有的网络下浏览器直连网易云图片很慢甚至失败，服务端转发稳定得多
    return /^https?:\/\//.test(raw) ? '/api/cover?url=' + encodeURIComponent(raw) : raw;
  }
  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error || '请求暂时不可用');
        return data;
      });
    });
  }
  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  // ---------- 数据源 ----------

  function sourceKey(src) {
    if (!src) return '';
    if (src.kind === 'search') return 'search|' + src.q;
    if (src.kind === 'playlist') return 'playlist|' + src.id;
    return src.kind;
  }

  function fetchPage(src, offset) {
    if (src.kind === 'playlist') {
      return getJson('/api/playlist/tracks?id=' + encodeURIComponent(src.id) + '&limit=' + PAGE_SIZE + '&offset=' + offset).then(function (d) {
        if (d.playlist && d.playlist.name && !src.fixedLabel) src.label = d.playlist.name;
        return { songs: d.tracks || [], hasMore: !!d.hasMore, nextOffset: d.nextOffset || offset + (d.tracks || []).length, total: Number(d.total || (d.playlist && d.playlist.trackCount)) || 0 };
      });
    }
    if (src.kind === 'search') {
      return getJson('/api/search?keywords=' + encodeURIComponent(src.q) + '&limit=40&offset=' + offset).then(function (d) {
        return { songs: d.songs || [], hasMore: !!d.hasMore, nextOffset: d.nextOffset || offset + (d.songs || []).length };
      });
    }
    if (src.kind === 'daily') {
      return getJson('/api/discover/home').then(function (d) {
        return { songs: d.dailySongs || [], hasMore: false, nextOffset: 0 };
      });
    }
    if (src.kind === 'demo') {
      return getJson('/api/vesper/demo').then(function (d) {
        return { songs: d.songs || [], hasMore: false, nextOffset: (d.songs || []).length };
      });
    }
    if (src.kind === 'queue') {
      var list = (typeof playQueue !== 'undefined' && Array.isArray(playQueue)) ? playQueue.slice() : [];
      return Promise.resolve({ songs: list, hasMore: false, nextOffset: 0 });
    }
    return Promise.resolve({ songs: [], hasMore: false, nextOffset: 0 });
  }

  function loadSource(src, opts) {
    opts = opts || {};
    if (!src) return;
    var seq = ++state.seq;
    if (src.kind !== 'search') state.previousSource = src;
    state.source = src;
    state.loading = true;
    state.pageError = false;
    state.hasMore = false;
    // Browsing changes source immediately; old cards must never seed the new source.
    state.items = []; state.center = 0; state.total = 0; state.nextOffset = 0;
    resetCards(); updateCaption();
    renderChips();
    renderStatus('正在打开「' + (src.label || '') + '」…');
    if (src.kind !== 'search') {
      try { localStorage.setItem(SOURCE_STORE_KEY, JSON.stringify({ kind: src.kind, id: src.id, label: src.label, key: src.key, fixedLabel: !!src.fixedLabel, accountScoped: !!src.accountScoped })); } catch (e) { }
      // 换到别的来源时，搜索框里上次的关键词就不该留着了
      var input = $('search-input');
      if (input && document.activeElement !== input) input.value = '';
    }
    fetchPage(src, 0).then(function (page) {
      if (seq !== state.seq) return;
      state.loading = false;
      state.items = page.songs.filter(function (s) { return s && (s.id || s.name); });
      state.hasMore = page.hasMore;
      state.nextOffset = page.nextOffset;
      state.total = page.total || state.items.length;
      var cur = currentSong();
      var idx = -1;
      if (opts.focusCurrent !== false && cur) {
        var key = songKey(cur);
        for (var i = 0; i < state.items.length; i++) if (songKey(state.items[i]) === key) { idx = i; break; }
      }
      resetCards();
      state.center = idx >= 0 ? idx : 0;
      renderChips();
      if (!state.items.length) {
        renderStatus(src.kind === 'search' ? '没有找到「' + src.q + '」相关的歌' : '这里还没有歌');
      } else {
        renderStatus('');
      }
      layoutCards(true);
      updateCaption();
    }).catch(function (err) {
      if (seq !== state.seq) return;
      state.loading = false;
      console.warn('[VesperHome] load failed', err);
      renderChips();
      renderStatus('暂时无法打开「' + (src.label || '歌曲') + '」。正在播放的音乐不会受影响。', true, [
        { label: '重新加载', run: function () { if (seq === state.seq) loadSource(src, opts); } },
        { label: '听本地演示', run: function () { loadSource({ kind: 'demo', key: 'demo', label: '本地演示', fixedLabel: true }); } }
      ]);
    });
  }

  function maybeLoadMore(force) {
    if (!state.hasMore || state.loading || state.pageError || !state.source) return;
    if (!force && state.center < state.items.length - 8) return;
    var src = state.source;
    var seq = state.seq;
    state.loading = true;
    fetchPage(src, state.nextOffset).then(function (page) {
      if (seq !== state.seq) return;
      state.loading = false;
      renderStatus('');
      var seen = Object.create(null);
      var previousLength = state.items.length;
      state.items.forEach(function (s) { seen[songKey(s)] = true; });
      page.songs.forEach(function (s) { if (s && !seen[songKey(s)]) { seen[songKey(s)] = true; state.items.push(s); } });
      state.hasMore = page.hasMore && state.items.length > previousLength && page.nextOffset > state.nextOffset;
      state.nextOffset = page.nextOffset;
      state.total = page.total || state.total;
      updateCaption();
    }).catch(function () {
      if (seq !== state.seq) return;
      state.loading = false; state.pageError = true;
      renderStatus('后面的歌曲暂时没有加载出来，已载入的歌曲仍可播放。', true, [
        { label: '重试加载', run: function () { if (seq !== state.seq) return; state.pageError = false; renderStatus('正在加载更多歌曲…'); maybeLoadMore(true); } }
      ]);
    });
  }

  function chipSources() {
    var list = [];
    if (typeof playQueue !== 'undefined' && playQueue && playQueue.length) list.push({ key: 'queue', kind: 'queue', label: '正在听' });
    CHARTS.forEach(function (c) { list.push(Object.assign({ fixedLabel: true }, c)); });
    list.push({ key: 'demo', kind: 'demo', label: '本地演示', fixedLabel: true });
    if (state.loggedIn) {
      list.push({ key: 'daily', kind: 'daily', label: '每日推荐', fixedLabel: true });
      if (state.liked) list.push({ key: 'liked', kind: 'playlist', id: state.liked.id, label: '我喜欢', fixedLabel: true, accountScoped: true });
    }
    var src = state.source;
    if (src && src.kind === 'search') list.push({ key: 'search', kind: 'search', q: src.q, label: '搜索 · ' + src.q, transient: true });
    else if (src && src.kind === 'playlist' && !list.some(function (c) { return c.kind === 'playlist' && String(c.id) === String(src.id); })) {
      list.push({ key: 'playlist', kind: 'playlist', id: src.id, label: src.label || '歌单', transient: true });
    }
    return list;
  }

  function renderChips() {
    if (!els.chips) return;
    var active = sourceKey(state.source);
    els.chips.innerHTML = chipSources().map(function (c, i) {
      var on = sourceKey(c) === active;
      return '<button type="button" class="vh-chip' + (on ? ' is-active' : '') + (c.transient ? ' is-transient' : '') + '" data-chip="' + i + '">' +
        esc(c.label) + (on && state.loading ? '<span class="vh-chip-dot"></span>' : '') + '</button>';
    }).join('');
    els.chipList = chipSources();
  }

  function renderStatus(text, isError, actions) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.hidden = !text;
    els.status.classList.toggle('is-error', !!isError);
    if (actions && actions.length) {
      var group = document.createElement('div'); group.className = 'vh-recovery';
      actions.forEach(function (action) { var button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.addEventListener('click', action.run); group.appendChild(button); });
      els.status.appendChild(group);
    }
    if (els.stage) els.stage.classList.toggle('is-empty', !!text && !state.items.length);
  }

  // ---------- 卡片 ----------

  function makeCard(index) {
    var song = state.items[index];
    var el = document.createElement('div');
    el.className = 'vh-card';
    var cover = coverUrl(song, 600);
    var title = song.name || song.title || '未知歌曲';
    var vip = song.fee === 1 || song.vip || (typeof songRequiresVip === 'function' && (function () { try { return songRequiresVip(song); } catch (e) { return false; } })());
    el.innerHTML =
      '<div class="vh-card-tilt">' +
      '<div class="vh-disc"><div class="vh-disc-spin"><div class="vh-disc-grooves"></div>' +
      '<div class="vh-disc-label"' + (cover ? ' style="background-image:url(&quot;' + esc(cover) + '&quot;)"' : '') + '><span class="vh-disc-hole"></span></div></div>' +
      '<div class="vh-disc-sheen"></div></div>' +
      '<div class="vh-sleeve">' +
      (cover ? '<img class="vh-sleeve-art" alt="" draggable="false" decoding="async" src="' + esc(cover) + '">' : '<div class="vh-sleeve-art vh-sleeve-blank"></div>') +
      '<span class="vh-sleeve-spine"></span><span class="vh-sleeve-mouth"></span>' +
      '<div class="vh-sleeve-shade"><p>' + esc(title) + '</p></div>' +
      '<div class="vh-sleeve-face">' +
      '<div class="vh-face-top"><button type="button" class="vh-stage-btn" data-act="stage">播放并进入舞台 ↗</button>' +
      '<span class="vh-eq" aria-hidden="true"><i></i><i></i><i></i></span></div>' +
      '<button type="button" class="vh-face-play" data-act="toggle" aria-label="播放"><svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>' +
      '<svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg></button>' +
      '<div class="vh-face-meta"><h3>' + esc(title) + (vip ? '<em class="vh-vip">VIP</em>' : '') + '</h3><p>' + esc(artistText(song)) + '</p></div>' +
      '</div></div>' +
      (cover ? '<div class="vh-reflect" aria-hidden="true"><img alt="" draggable="false" decoding="async" src="' + esc(cover) + '"></div>' : '') +
      '</div>';
    els.track.appendChild(el);
    var card = {
      index: index,
      el: el,
      tilt: el.firstChild,
      disc: el.querySelector('.vh-disc'),
      cur: null,
      vel: { x: 0, z: 0, ry: 0, s: 0, o: 0, d: 0, ds: 0, dop: 0 },
      tgt: null,
      leaving: false,
      offset: 0
    };
    return card;
  }

  function resetCards() {
    cards.forEach(function (c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    cards.clear();
  }

  function halfWindow(n) {
    if (n <= 1) return 0;
    return Math.min(MAX_HALF, n >= 3 ? Math.floor((n - 1) / 2) : 1);
  }

  function circularOffset(index, center, n) {
    var d = ((index - center) % n + n) % n;
    if (d > n / 2) d -= n;
    return d;
  }

  function targetFor(offset) {
    var S = state.sleeve;
    var a = Math.abs(offset);
    var isCenter = offset === 0;
    return {
      x: offset * S * 0.542,
      z: isCenter ? S * 0.139 : -a * S * 0.306,
      ry: isCenter ? 0 : (offset < 0 ? 38 : -38),
      s: isCenter ? (state.hover ? 1.2 : 1.18) : Math.max(0.64, 0.82 - a * 0.08),
      o: isCenter ? 1 : Math.max(0.28, 0.72 - a * 0.16),
      d: isCenter ? S * (state.hover ? 0.467 : 0.428) : 0,
      ds: isCenter ? 1 : 0.88,
      dop: isCenter ? 1 : 0
    };
  }

  function layoutCards(initial) {
    var n = state.items.length;
    if (!els.track) return;
    if (!n) { resetCards(); return; }
    state.center = ((state.center % n) + n) % n;
    var half = halfWindow(n);
    var wanted = new Map();
    for (var o = -half; o <= half; o++) {
      var idx = ((state.center + o) % n + n) % n;
      if (!wanted.has(idx)) wanted.set(idx, o);
    }
    cards.forEach(function (card, idx) {
      if (!wanted.has(idx) && !card.leaving) {
        card.leaving = true;
        var side = card.offset >= 0 ? 1 : -1;
        var t = targetFor(card.offset);
        t.x += side * state.sleeve * 0.25;
        t.o = 0;
        t.s *= 0.9;
        t.dop = 0;
        card.tgt = t;
      }
    });
    wanted.forEach(function (offset, idx) {
      var card = cards.get(idx);
      if (!card || card.leaving) {
        if (card && card.el.parentNode) card.el.parentNode.removeChild(card.el);
        card = makeCard(idx);
        cards.set(idx, card);
        var start = targetFor(offset);
        if (!initial || offset !== 0) {
          start.x += (offset >= 0 ? 1 : -1) * state.sleeve * 0.25;
          start.o = 0;
          start.s *= 0.9;
        }
        if (initial) start.o = offset === 0 ? 0 : start.o;
        card.cur = start;
      }
      card.offset = offset;
      card.tgt = targetFor(offset);
      card.el.classList.toggle('is-center', offset === 0);
      card.el.style.zIndex = String(30 - Math.abs(offset));
    });
    syncCenterState();
    kick();
  }

  function syncCenterState() {
    var cur = currentSong();
    var curKey = songKey(cur);
    var playingNow = isPlayingNow();
    cards.forEach(function (card) {
      var song = state.items[card.index];
      var isCurrent = !!(song && curKey && songKey(song) === curKey);
      card.el.classList.toggle('is-current', isCurrent);
      card.el.classList.toggle('is-playing', isCurrent && playingNow);
      var stageAction = card.el.querySelector('[data-act="stage"]');
      if (stageAction) {
        stageAction.textContent = isCurrent ? (playingNow ? '查看歌词 ↗' : '继续播放并看歌词 ↗') : '播放并进入舞台 ↗';
        stageAction.tabIndex = card.offset === 0 && !card.leaving ? 0 : -1;
      }
      var toggleAction = card.el.querySelector('[data-act="toggle"]');
      if (toggleAction) {
        toggleAction.setAttribute('aria-label', (isCurrent && playingNow ? '暂停' : (isCurrent ? '继续播放' : '播放')) + '「' + (song && (song.name || song.title) || '当前歌曲') + '」');
        toggleAction.tabIndex = card.offset === 0 && !card.leaving ? 0 : -1;
      }
    });
    if (els.root) els.root.classList.toggle('is-playing', playingNow);
  }

  function stepSpring(card, prop, dt) {
    var cfg = SPRING;
    var x = card.cur[prop], v = card.vel[prop], t = card.tgt[prop];
    var f = -cfg.k * (x - t) - cfg.c * v;
    v += (f / cfg.m) * dt;
    x += v * dt;
    card.cur[prop] = x;
    card.vel[prop] = v;
    return Math.abs(x - t) > 0.01 || Math.abs(v) > 0.01;
  }

  var PROPS = ['x', 'z', 'ry', 's', 'o', 'd', 'ds', 'dop'];

  function frame(now) {
    rafId = 0;
    var dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    var moving = false;
    var steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    var h = dt / steps;
    for (var s = 0; s < steps; s++) {
      var fx = -TILT_SPRING.k * (tilt.x - tilt.tx) - TILT_SPRING.c * tilt.vx;
      var fy = -TILT_SPRING.k * (tilt.y - tilt.ty) - TILT_SPRING.c * tilt.vy;
      tilt.vx += fx / TILT_SPRING.m * h; tilt.x += tilt.vx * h;
      tilt.vy += fy / TILT_SPRING.m * h; tilt.y += tilt.vy * h;
    }
    if (Math.abs(tilt.x - tilt.tx) > 0.01 || Math.abs(tilt.y - tilt.ty) > 0.01 || Math.abs(tilt.vx) > 0.01 || Math.abs(tilt.vy) > 0.01) moving = true;

    var dead = [];
    cards.forEach(function (card, idx) {
      if (!card.cur || !card.tgt) return;
      var cardMoving = false;
      for (var s2 = 0; s2 < steps; s2++) {
        for (var p = 0; p < PROPS.length; p++) {
          if (stepSpring(card, PROPS[p], h)) cardMoving = true;
        }
      }
      var c = card.cur;
      card.el.style.transform = 'translate3d(' + c.x.toFixed(2) + 'px,0,' + c.z.toFixed(2) + 'px) rotateY(' + c.ry.toFixed(3) + 'deg) scale(' + Math.max(0, c.s).toFixed(4) + ')';
      card.el.style.opacity = clamp(c.o, 0, 1).toFixed(3);
      if (card.disc) {
        card.disc.style.transform = 'translate3d(' + c.d.toFixed(2) + 'px,0,0) scale(' + c.ds.toFixed(4) + ')';
        card.disc.style.opacity = clamp(c.dop, 0, 1).toFixed(3);
      }
      if (card.offset === 0 && !card.leaving) {
        card.tilt.style.transform = 'rotateX(' + tilt.y.toFixed(3) + 'deg) rotateY(' + tilt.x.toFixed(3) + 'deg)';
      } else if (card.tilt.style.transform) {
        card.tilt.style.transform = '';
      }
      if (card.leaving && c.o < 0.02) dead.push(idx);
      else if (cardMoving) moving = true;
    });
    dead.forEach(function (idx) {
      var card = cards.get(idx);
      if (card && card.leaving) {
        if (card.el.parentNode) card.el.parentNode.removeChild(card.el);
        cards.delete(idx);
      }
    });
    if (moving) kick();
    else lastFrame = 0;
  }

  function kick() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  // ---------- 操作 ----------

  function step(delta) {
    var n = state.items.length;
    if (n <= 1) return;
    state.center = ((state.center + delta) % n + n) % n;
    // 原项目 3D 歌单架的'咔哒'换片音效
    if (typeof playShelfSelectTick === 'function') { try { playShelfSelectTick(delta > 0 ? 1 : -1); } catch (e) { } }
    layoutCards(false);
    updateCaption();
    maybeLoadMore();
  }

  function focusIndex(index) {
    var n = state.items.length;
    if (!n) return;
    var d = circularOffset(index, state.center, n);
    if (!d) return;
    state.center = index;
    layoutCards(false);
    updateCaption();
    maybeLoadMore();
  }

  function openHome() {
    if (homeActive()) return;
    homeSuppressed = false;
    homeForcedOpen = true;
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(!isPlayingNow() && !(typeof playQueue !== 'undefined' && playQueue.length));
    if (typeof shelfManager !== 'undefined' && shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent() && typeof safeShelfCloseContent === 'function') safeShelfCloseContent('vesper-home');
    if (typeof setShelfPinnedOpen === 'function') setShelfPinnedOpen(false, true);
    if (typeof togglePlaylistPanel === 'function') togglePlaylistPanel(false);
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
  }

  function enterStage() {
    homeForcedOpen = false;
    homeSuppressed = true;
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
    var area = $('search-area');
    if (area && typeof setPeek === 'function') setPeek(area, false, 'search');
  }

  async function playCenter(goToStage, toggleCurrent) {
    var song = state.items[state.center];
    if (!song) return;
    var cur = currentSong();
    if (cur && songKey(cur) === songKey(song)) {
      // Card selection is idempotent during playback: a desktop dblclick also
      // emits two click events before its own event. Only an explicit control
      // (or the non-interactive-area keyboard shortcut) may pause this track.
      if ((toggleCurrent || !isPlayingNow()) && typeof togglePlay === 'function') togglePlay();
      if (goToStage) enterStage();
      setTimeout(syncCenterState, 60);
      return;
    }
    var src = state.source;
    if (src && src.kind === 'playlist' && typeof loadPlaylistIntoQueueById === 'function') {
      // Preserve the server's pagination cursor so nextTrack() can continue beyond the first 60 tracks.
      var loaded = await loadPlaylistIntoQueueById(src.id, false, src.label, {
        seedTracks: state.items, startIndex: state.center, total: state.total,
        nextOffset: state.nextOffset, hasMore: state.hasMore, preserveHomeState: true
      });
      if (!loaded) return;
    } else {
      if (!src || src.kind !== 'queue') {
        if (typeof cancelPlaylistQueueHydration === 'function') cancelPlaylistQueueHydration('vesper-home-source');
        playQueue = state.items.map(function (s) { return typeof cloneSong === 'function' ? cloneSong(s) : Object.assign({}, s); });
      }
      currentIdx = state.center;
    }
    if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('vesper-home', { scrollCurrent: true });
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('vesper-home', true);
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
    var p = playQueueAt(currentIdx, {
      manual: true,
      preserveHomeState: true,
      context: { type: 'vesper-home', playlistName: (state.source && state.source.label) || 'Vesper' }
    });
    if (goToStage) enterStage();
    Promise.resolve(p).catch(function (err) { console.warn('[VesperHome] play failed', err); }).then(function () {
      setTimeout(syncCenterState, 80);
    });
  }

  // 原项目在 playQueueAt 里会把首页关掉（homeForcedOpen = false）。
  // 用户在首页点歌、或者在首页时自动切到下一首，都应该留在首页，所以包一层：调用前在首页，调用后保持首页打开。
  function wrapPlayQueueAt() {
    if (typeof window.playQueueAt !== 'function' || window.playQueueAt.__vesperWrapped) return;
    var original = window.playQueueAt;
    var wrapped = function () {
      var stay = homeActive();
      var result = original.apply(this, arguments);
      if (stay) {
        homeForcedOpen = true;
        homeSuppressed = false;
      }
      return result;
    };
    wrapped.__vesperWrapped = true;
    window.playQueueAt = wrapped;
  }

  // ---------- 文字 ----------

  function updateCaption() {
    if (!els.capTitle) return;
    var song = state.items[state.center];
    var n = state.items.length;
    els.capTitle.textContent = song ? (song.name || song.title || '') : '';
    els.capSub.textContent = song ? artistText(song) + (song.album ? ' · ' + (song.album.name || song.album) : '') : '';
    els.capCount.textContent = n ? (state.center + 1) + ' / ' + (state.hasMore ? n + '+' : n) : '';
    updateAccent(song);
  }

  // 取中间那张封面的主色，给舞台底部的光和进度提示用（颜色只来自音乐）
  function updateAccent(song) {
    var url = coverUrl(song, 64);
    if (!url || url === state.accentFor) return;
    state.accentFor = url;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (state.accentFor !== url) return;
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 24;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0, 24, 24);
        var data = g.getImageData(0, 0, 24, 24).data;
        var r = 0, gg = 0, b = 0, w = 0;
        for (var i = 0; i < data.length; i += 4) {
          var R = data[i], G = data[i + 1], B = data[i + 2];
          var max = Math.max(R, G, B), min = Math.min(R, G, B);
          var sat = max ? (max - min) / max : 0;
          var weight = 0.15 + sat * (max / 255);
          r += R * weight; gg += G * weight; b += B * weight; w += weight;
        }
        r = Math.round(r / w); gg = Math.round(gg / w); b = Math.round(b / w);
        document.documentElement.style.setProperty('--vh-accent-rgb', r + ', ' + gg + ', ' + b);
      } catch (e) { }
    };
    img.src = url;
  }

  function tickClock() {
    if (!els.time) return;
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    if (els.time.textContent !== hh + ':' + mm) els.time.textContent = hh + ':' + mm;
    var h = d.getHours();
    var greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var date = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()] + ' · ' + greet;
    if (els.date.textContent !== date) els.date.textContent = date;
  }

  // ---------- 搜索：结果进黑胶架，不再弹下拉列表 ----------

  function runSearch(q) {
    q = String(q || '').trim();
    if (!q) {
      if (state.source && state.source.kind === 'search') loadSource(state.previousSource || CHARTS[0], { focusCurrent: true });
      return;
    }
    if (typeof rememberSearchQuery === 'function') { try { rememberSearchQuery(q); } catch (e) { } }
    openHome();
    loadSource({ kind: 'search', q: q, label: '搜索 · ' + q }, { focusCurrent: false });
  }

  function bindSearch() {
    window.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'search-input') return;
      e.stopImmediatePropagation();
      clearTimeout(state.searchTimer);
      var q = e.target.value;
      state.searchTimer = setTimeout(function () { runSearch(q); }, 420);
    }, true);
    window.addEventListener('keydown', function (e) {
      if (!e.target || e.target.id !== 'search-input') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearTimeout(state.searchTimer);
        runSearch(e.target.value);
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearTimeout(state.searchTimer);
        e.target.value = '';
        e.target.blur();
        runSearch('');
      }
    }, true);
    window.addEventListener('focus', function (e) {
      if (!e.target || e.target.id !== 'search-input') return;
      e.stopImmediatePropagation();
      var area = $('search-area');
      if (area && typeof setPeek === 'function') setPeek(area, true, 'search');
    }, true);
  }

  // ---------- 事件 ----------

  function bindStage() {
    // 整个首页都能用滚轮换唱片（MIMI 也是整块区域接管滚轮），顶部的来源按钮除外
    els.root.addEventListener('wheel', function (e) {
      if (e.target.closest && e.target.closest('#vh-chips')) return;
      if (!homeActive()) return;
      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 12) return;
      e.preventDefault();
      var now = performance.now();
      if (now < wheelLockedUntil) return;
      wheelLockedUntil = now + 90;
      step(delta > 0 ? 1 : -1);
    }, { passive: false });

    els.stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, moved: false, id: e.pointerId };
    });
    window.addEventListener('pointermove', function (e) {
      if (drag && e.pointerId === drag.id) {
        var dx = e.clientX - drag.x;
        if (Math.abs(dx) > 8) drag.moved = true;
        if (Math.abs(dx) > state.sleeve * 0.32) {
          step(dx < 0 ? 1 : -1);
          drag.x = e.clientX;
        }
      }
      var center = null;
      cards.forEach(function (c) { if (c.offset === 0 && !c.leaving) center = c; });
      if (!center || !homeActive()) return;
      var rect = center.el.getBoundingClientRect();
      var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside) {
        var nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        var ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        tilt.tx = nx * 7.5;
        tilt.ty = -ny * 7.5;
      } else {
        tilt.tx = 0;
        tilt.ty = 0;
      }
      if (inside !== state.hover) {
        state.hover = inside;
        if (center.tgt) { center.tgt = targetFor(0); }
      }
      kick();
    }, { passive: true });
    window.addEventListener('pointerup', function () {
      setTimeout(function () { drag = null; }, 0);
    });

    els.track.addEventListener('click', function (e) {
      if (drag && drag.moved) return;
      var cardEl = e.target.closest ? e.target.closest('.vh-card') : null;
      if (!cardEl) return;
      var card = null;
      cards.forEach(function (c) { if (c.el === cardEl) card = c; });
      if (!card || card.leaving) return;
      if (card.offset !== 0) { focusIndex(card.index); return; }
      var act = e.target.closest('[data-act]');
      if (act && act.getAttribute('data-act') === 'stage') { playCenter(true); return; }
      if (act && act.getAttribute('data-act') === 'toggle') { playCenter(false, true); return; }
      playCenter(false);
    });
    els.track.addEventListener('dblclick', function (e) {
      // Native controls keep their own action; double-clicking Pause must not
      // also navigate while its asynchronous fade-out is still in flight.
      if (e.target.closest && e.target.closest('button,a,input,textarea,select,[role="button"]')) return;
      if (drag && drag.moved) return;
      var cardEl = e.target.closest ? e.target.closest('.vh-card.is-center') : null;
      if (cardEl) playCenter(true);
    });

    els.chips.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-chip]') : null;
      if (!btn) return;
      var src = (els.chipList || [])[Number(btn.getAttribute('data-chip'))];
      if (!src) return;
      if (sourceKey(src) === sourceKey(state.source)) return;
      if (src.kind === 'search' && state.source && state.source.kind === 'search') return;
      loadSource(Object.assign({}, src), { focusCurrent: true });
    });

    window.addEventListener('keydown', function (e) {
      if (!homeActive()) return;
      if (document.body.classList.contains('vesper-lyric-picker-open') || (e.shiftKey && (e.key === 'l' || e.key === 'L'))) return;
      if (window.vesperShelf && window.vesperShelf.isOpen()) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
      if (e.target && e.target.closest && e.target.closest('button,a,input,textarea,select,summary,[role="button"],[role="slider"],[contenteditable="true"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var handled = true;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Enter' || e.code === 'Space') {
        var goToStage = e.key === 'Enter' && e.shiftKey;
        playCenter(goToStage, !goToStage);
      }
      else if (e.key === 'l' || e.key === 'L') { if (window.vesperShelf) window.vesperShelf.open(); }
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener('resize', function () { measure(); layoutCards(false); });
  }

  function measure() {
    var S = Math.round(clamp(Math.min(window.innerHeight * 0.36, window.innerWidth * 0.23), 200, 360));
    state.sleeve = S;
    document.documentElement.style.setProperty('--vh-sleeve', S + 'px');
  }

  // 登录状态和"我喜欢"歌单：登录后多出"每日推荐""我喜欢"两个入口
  function refreshAccount() {
    var logged = false;
    try { logged = !!(typeof loginStatus !== 'undefined' && loginStatus && loginStatus.loggedIn); } catch (e) { }
    var accountKey = logged ? String(loginStatus.userId || loginStatus.uid || loginStatus.nickname || 'user') : '';
    if (accountKey === state.accountKey && logged === state.loggedIn) return;
    state.accountKey = accountKey;
    var request = ++state.accountRequest;
    state.loggedIn = logged;
    state.liked = null;
    if (state.source && (state.source.kind === 'daily' || state.source.accountScoped || state.source.key === 'liked')) {
      state.items = [];
      resetCards();
      loadSource(Object.assign({ fixedLabel: true }, CHARTS[0]), { focusCurrent: false });
    }
    if (window.vesperShelf) window.vesperShelf.setMine(null);
    renderChips();
    if (!logged) return;
    getJson('/api/user/playlists').then(function (d) {
      if (request !== state.accountRequest || !state.loggedIn) return;
      var list = (d && d.playlists) || [];
      var liked = list.find(function (p) { return Number(p.specialType) === 5; });
      if (liked) state.liked = { id: liked.id, name: liked.name };
      renderChips();
      if (window.vesperShelf) window.vesperShelf.setMine(list);
    }).catch(function () {
      if (request === state.accountRequest) setTimeout(function () { if (request === state.accountRequest) state.accountKey = ''; }, 5000);
    });
  }

  // 正在播放的歌变了（自动下一首、播放条上切歌）：首页上把它转到中间，唱片转起来
  function watchPlayback() {
    setInterval(function () {
      var cur = currentSong();
      var key = songKey(cur);
      var playingNow = isPlayingNow();
      if (key !== state.lastSongKey) {
        state.lastSongKey = key;
        if (state.source && state.source.kind === 'queue') {
          state.items = (typeof playQueue !== 'undefined' && playQueue) ? playQueue.slice() : [];
        }
        if (key) {
          for (var i = 0; i < state.items.length; i++) {
            if (songKey(state.items[i]) === key) {
              if (i !== state.center) { state.center = i; layoutCards(false); updateCaption(); }
              break;
            }
          }
        }
        renderChips();
        syncCenterState();
      }
      if (playingNow !== state.lastPlaying) {
        state.lastPlaying = playingNow;
        syncCenterState();
      }
      refreshAccount();
    }, 400);
    setInterval(tickClock, 1000);
  }

  function initialSource() {
    try {
      var saved = JSON.parse(localStorage.getItem(SOURCE_STORE_KEY) || 'null');
      if (saved && saved.kind && saved.kind !== 'search' && saved.kind !== 'queue' && saved.kind !== 'daily' && !saved.accountScoped && saved.key !== 'liked') return saved;
    } catch (e) { }
    if (typeof playQueue !== 'undefined' && playQueue && playQueue.length) return { key: 'queue', kind: 'queue', label: '正在听' };
    return Object.assign({ fixedLabel: true }, CHARTS[0]);
  }

  function init() {
    els.root = $('vesper-home');
    if (!els.root) return;
    els.stage = $('vh-stage');
    els.track = $('vh-track');
    els.chips = $('vh-chips');
    els.status = $('vh-status');
    els.time = $('vh-time');
    els.date = $('vh-date');
    els.capTitle = $('vh-cap-title');
    els.capSub = $('vh-cap-sub');
    els.capCount = $('vh-cap-count');
    var input = $('search-input');
    if (input) input.setAttribute('placeholder', '搜索歌曲、歌手，结果会放进下面的唱片架');
    measure();
    tickClock();
    wrapPlayQueueAt();
    bindSearch();
    bindStage();
    watchPlayback();
    loadSource(initialSource(), { focusCurrent: true });
  }

  window.vesperHome = {
    loadPlaylist: function (playlist) {
      if (!playlist || !playlist.id) return;
      openHome();
      loadSource({ kind: 'playlist', id: playlist.id, label: playlist.name || '歌单', accountScoped: !!playlist.accountScoped }, { focusCurrent: true });
    },
    open: openHome,
    enterStage: enterStage,
    refresh: function () { layoutCards(false); updateCaption(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
