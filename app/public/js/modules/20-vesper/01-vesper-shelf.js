// ============================================================
// Vesper 首页的 3D 歌单架
//
// 首页底部"歌单架"按钮（或 L 键）打开：歌单卡片围成一圈立在地板上，
// 滚轮 / 方向键 / 拖动转动，正对你的那张高亮；点它，歌单里的歌就放进首页的黑胶 Cover Flow。
// 想法来自 MIMI Music Player 的 Shelf3DView（MIT，Three.js 实现）；这里用 CSS 3D 自己实现，
// 不另开一个 WebGL 画布，和播放页的 3D 舞台互不干扰。
// ============================================================
(function () {
  'use strict';

  var TABS = [
    { key: 'mine', label: '我的歌单' },
    { key: 'recommend', label: '推荐歌单' },
    { key: 'charts', label: '排行榜' }
  ];
  var SPRING = { k: 220, c: 26, m: 1 };

  var state = {
    open: false,
    tab: 'recommend',
    lists: { mine: null, recommend: null, charts: null },
    angle: 0, vel: 0, target: 0,
    front: 0,
    card: 180,
    radius: 600,
    loading: false,
    mineGeneration: 0,
    drag: null
  };
  var els = {};
  var nodes = [];
  var rafId = 0, lastT = 0, wheelUntil = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }); }
  function pic(url, size) {
    url = String(url || '');
    if (/music\.126\.net/.test(url)) url = url.replace(/\?.*$/, '') + '?param=' + size + 'y' + size;
    // 和首页一样，封面经本机服务转发
    return /^https?:\/\//.test(url) ? '/api/cover?url=' + encodeURIComponent(url) : url;
  }
  function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿次播放';
    if (n >= 1e4) return Math.round(n / 1e4) + ' 万次播放';
    return n ? n + ' 次播放' : '';
  }
  function loggedIn() {
    try { return !!(typeof loginStatus !== 'undefined' && loginStatus && loginStatus.loggedIn); } catch (e) { return false; }
  }

  function currentList() { return state.lists[state.tab] || []; }

  function loadTab(tab) {
    state.tab = tab;
    renderTabs();
    if (tab === 'mine' && !loggedIn()) { state.lists.mine = null; build(); return; }
    if (state.lists[tab]) { build(); return; }
    state.loading = true;
    build();
    var url = tab === 'charts' ? '/api/vesper/charts' : tab === 'recommend' ? '/api/vesper/playlists?limit=30' : '/api/user/playlists';
    var generation = state.mineGeneration;
    getJson(url).then(function (d) {
      if (tab === 'mine' && (generation !== state.mineGeneration || !loggedIn())) return;
      state.lists[tab] = (d.charts || d.playlists || []).filter(function (p) { return p && p.id; });
      state.loading = false;
      if (state.tab === tab) build();
      updateCount();
    }).catch(function () {
      if (tab === 'mine' && (generation !== state.mineGeneration || !loggedIn())) return;
      state.loading = false;
      state.lists[tab] = [];
      if (state.tab === tab) build();
    });
  }

  function renderTabs() {
    if (!els.tabs) return;
    els.tabs.innerHTML = TABS.map(function (t) {
      return '<button type="button" class="vs-tab' + (t.key === state.tab ? ' is-active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');
  }

  function build() {
    if (!els.ring) return;
    var list = currentList();
    els.ring.innerHTML = '';
    nodes = [];
    els.empty.hidden = true;
    if (state.loading) { els.empty.hidden = false; els.empty.innerHTML = '<p>正在打开歌单…</p>'; updateCaption(); return; }
    if (state.tab === 'mine' && !loggedIn()) {
      els.empty.hidden = false;
      els.empty.innerHTML = '<p>登录网易云后，这里会摆上你的歌单</p><button type="button" class="vs-login" data-act="login">扫码登录</button>';
      updateCaption();
      return;
    }
    if (!list.length) { els.empty.hidden = false; els.empty.innerHTML = '<p>这里还没有歌单</p>'; updateCaption(); return; }
    var n = list.length;
    var step = 360 / Math.max(n, 9);
    state.step = step;
    // 半径让相邻两张卡之间留一点缝；张数少时不要挤成一团
    state.radius = Math.max(state.card * 1.6, (state.card * 1.08) / (2 * Math.tan(Math.PI * step / 360)));
    list.forEach(function (p, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'vs-card';
      el.setAttribute('data-i', String(i));
      el.innerHTML = '<img alt="" draggable="false" decoding="async" loading="lazy" src="' + esc(pic(p.cover, 400)) + '">' +
        '<span class="vs-card-name">' + esc(p.name) + '</span>';
      el.style.transform = 'rotateY(' + (i * step) + 'deg) translateZ(' + state.radius.toFixed(1) + 'px)';
      els.ring.appendChild(el);
      nodes.push(el);
    });
    state.angle = state.target = 0;
    state.vel = 0;
    state.front = 0;
    apply();
    updateCaption();
  }

  function apply() {
    if (!els.ring) return;
    els.ring.style.transform = 'translateZ(' + (-state.radius).toFixed(1) + 'px) rotateY(' + (-state.angle).toFixed(3) + 'deg)';
    var step = state.step || 40;
    var n = nodes.length;
    var front = n ? ((Math.round(state.angle / step) % n) + n) % n : 0;
    for (var i = 0; i < n; i++) {
      var diff = ((i * step - state.angle) % 360 + 540) % 360 - 180;
      var a = Math.abs(diff);
      nodes[i].style.opacity = String(Math.max(0, 1 - a / 110).toFixed(3));
      nodes[i].style.visibility = a > 115 ? 'hidden' : 'visible';
      nodes[i].classList.toggle('is-front', i === front);
    }
    if (front !== state.front) {
      state.front = front;
      updateCaption();
      if (typeof playShelfSelectTick === 'function') { try { playShelfSelectTick(1, 'row'); } catch (e) { } }
    }
  }

  function frame(now) {
    rafId = 0;
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    if (!state.drag) {
      var steps = Math.max(1, Math.ceil(dt * 120));
      var h = dt / steps;
      for (var s = 0; s < steps; s++) {
        var f = -SPRING.k * (state.angle - state.target) - SPRING.c * state.vel;
        state.vel += f / SPRING.m * h;
        state.angle += state.vel * h;
      }
    }
    apply();
    if (state.drag || Math.abs(state.angle - state.target) > 0.02 || Math.abs(state.vel) > 0.02) kick();
    else lastT = 0;
  }
  function kick() { if (!rafId) rafId = requestAnimationFrame(frame); }

  function rotateBy(cards) {
    if (!nodes.length) return;
    state.target = Math.round(state.target / state.step + cards) * state.step;
    kick();
  }
  function rotateTo(i) {
    var step = state.step;
    var n = nodes.length;
    var cur = Math.round(state.target / step);
    var d = ((i - cur) % n + n) % n;
    if (d > n / 2) d -= n;
    state.target = (cur + d) * step;
    kick();
  }

  function updateCaption() {
    if (!els.capTitle) return;
    var p = currentList()[state.front];
    els.capTitle.textContent = p ? p.name : '';
    var bits = [];
    if (p && p.trackCount) bits.push(p.trackCount + ' 首');
    if (p && p.playCount) bits.push(formatCount(p.playCount));
    if (p && p.description) bits.push(p.description);
    els.capSub.textContent = bits.join(' · ');
    els.pick.hidden = !p;
  }

  function pickFront() {
    var p = currentList()[state.front];
    if (!p) return;
    close();
    if (window.vesperHome) window.vesperHome.loadPlaylist(Object.assign({}, p, { accountScoped: state.tab === 'mine' }));
  }

  function updateCount() {
    var btnCount = $('vh-shelf-count');
    if (!btnCount) return;
    var total = (state.lists.mine || []).length || (state.lists.recommend || []).length;
    btnCount.textContent = total ? total + ' 张歌单' : '歌单';
  }

  function open() {
    if (state.open || !els.root) return;
    state.open = true;
    els.root.hidden = false;
    requestAnimationFrame(function () { els.root.classList.add('is-open'); });
    // 第一次打开：登录了先看自己的歌单，没登录先看推荐；之后记住上次停在哪个标签
    if (!state.openedOnce) { state.tab = loggedIn() ? 'mine' : 'recommend'; state.openedOnce = true; }
    loadTab(state.tab);
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    els.root.classList.remove('is-open');
    setTimeout(function () { if (!state.open) els.root.hidden = true; }, 380);
  }

  function bind() {
    els.btn && els.btn.addEventListener('click', open);
    els.closeBtn.addEventListener('click', close);
    els.root.addEventListener('click', function (e) {
      if (e.target === els.root || e.target === els.floor) close();
    });
    els.tabs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (b) loadTab(b.getAttribute('data-tab'));
    });
    els.empty.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act="login"]') : null;
      if (b && typeof onUserBtnClick === 'function') { close(); onUserBtnClick(); }
    });
    els.pick.addEventListener('click', pickFront);
    els.ring.addEventListener('click', function (e) {
      if (state.drag && state.drag.moved) return;
      var c = e.target.closest ? e.target.closest('.vs-card') : null;
      if (!c) return;
      var i = Number(c.getAttribute('data-i'));
      if (i === state.front) pickFront();
      else rotateTo(i);
    });
    els.root.addEventListener('wheel', function (e) {
      if (!state.open) return;
      e.preventDefault();
      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 8) return;
      var now = performance.now();
      if (now < wheelUntil) return;
      wheelUntil = now + 70;
      rotateBy(delta > 0 ? 1 : -1);
    }, { passive: false });
    els.stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !nodes.length) return;
      state.drag = { x: e.clientX, angle: state.angle, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
    });
    window.addEventListener('pointermove', function (e) {
      var d = state.drag;
      if (!d) return;
      var dx = e.clientX - d.x;
      if (Math.abs(dx) > 6) d.moved = true;
      var degPerPx = state.step / (state.card * 0.9);
      state.angle = d.angle - dx * degPerPx;
      var now = performance.now();
      d.v = -(e.clientX - d.lastX) * degPerPx / Math.max(1, now - d.lastT) * 1000;
      d.lastX = e.clientX; d.lastT = now;
      kick();
    }, { passive: true });
    window.addEventListener('pointerup', function () {
      var d = state.drag;
      if (!d) return;
      // 松手时按甩动速度多转一点，再停到最近的一张
      state.target = Math.round((state.angle + d.v * 0.18) / state.step) * state.step;
      state.vel = 0;
      setTimeout(function () { state.drag = null; kick(); }, 0);
    });
    window.addEventListener('keydown', function (e) {
      if (!state.open) return;
      if (document.body.classList.contains('vesper-lyric-picker-open') || (e.shiftKey && (e.key === 'l' || e.key === 'L'))) return;
      var handled = true;
      if (e.key === 'Escape' || e.key === 'l' || e.key === 'L') close();
      else if (e.key === 'ArrowLeft') rotateBy(-1);
      else if (e.key === 'ArrowRight') rotateBy(1);
      else if (e.key === 'Enter' || e.code === 'Space') pickFront();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  function measure() {
    state.card = Math.round(Math.max(150, Math.min(230, window.innerHeight * 0.27)));
    document.documentElement.style.setProperty('--vs-card', state.card + 'px');
  }

  function init() {
    els.root = $('vesper-shelf');
    if (!els.root) return;
    els.btn = $('vh-shelf-btn');
    els.closeBtn = $('vs-close');
    els.tabs = $('vs-tabs');
    els.stage = $('vs-stage');
    els.ring = $('vs-ring');
    els.floor = $('vs-floor');
    els.empty = $('vs-empty');
    els.capTitle = $('vs-cap-title');
    els.capSub = $('vs-cap-sub');
    els.pick = $('vs-pick');
    measure();
    window.addEventListener('resize', function () { measure(); if (state.open) build(); });
    renderTabs();
    bind();
    getJson('/api/vesper/playlists?limit=30').then(function (d) {
      if (!state.lists.recommend) state.lists.recommend = (d.playlists || []).filter(function (p) { return p && p.id; });
      updateCount();
    }).catch(function () { });
  }

  window.vesperShelf = {
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    setMine: function (list) {
      state.mineGeneration++;
      state.loading = false;
      state.lists.mine = list === null ? null : (list || []).filter(function (p) { return p && p.id; });
      updateCount();
      if (state.open && state.tab === 'mine') build();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
