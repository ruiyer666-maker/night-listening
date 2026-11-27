// ============================================================
// Vesper 壁纸背景：用电脑上 Wallpaper Engine 的壁纸做播放页背景
//
// 右上角"壁纸"按钮打开面板，列出 Steam 创意工坊里订阅的壁纸（server/wallpaper-routes.js 扫描）：
//   - 视频壁纸：直接当播放背景循环播放（静音），粒子和歌词叠在上面
//   - 场景壁纸：要 Wallpaper Engine 自己的渲染程序才能动，网页里跑不了，只能用它的预览图（GIF 会动）
// 设好的背景走原项目的"自定义背景媒体"（setCustomBackgroundMedia），会随视觉设置一起保存。
// ============================================================
(function () {
  'use strict';

  var state = { open: false, loaded: false, loading: false, projects: [], filter: 'video' };
  var els = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function abs(url) { return url ? location.origin + url : ''; }

  function currentSrc() {
    try {
      var m = typeof fx !== 'undefined' && fx ? (fx.backgroundMedia || null) : null;
      return m && m.src ? String(m.src) : '';
    } catch (e) { return ''; }
  }

  function load(refresh) {
    if (state.loading) return;
    state.loading = true;
    render();
    fetch('/api/vesper/wallpapers' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.loading = false;
        state.loaded = true;
        state.projects = (d && d.projects) || [];
        state.error = d && d.ok === false ? (d.error || '读取失败') : '';
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.loaded = true;
        state.error = err && err.message ? err.message : '读取失败';
        render();
      });
  }

  function render() {
    if (!els.grid) return;
    var list = state.projects.filter(function (p) { return state.filter === 'all' || p.playable; });
    var videoCount = state.projects.filter(function (p) { return p.playable; }).length;
    els.filters.innerHTML =
      '<button type="button" data-filter="video" class="' + (state.filter === 'video' ? 'is-active' : '') + '">动态视频 ' + videoCount + '</button>' +
      '<button type="button" data-filter="all" class="' + (state.filter === 'all' ? 'is-active' : '') + '">全部 ' + state.projects.length + '</button>';
    if (state.loading) { els.grid.innerHTML = '<p class="vw-note">正在读取 Wallpaper Engine 壁纸…</p>'; return; }
    if (state.error) { els.grid.innerHTML = '<p class="vw-note">读取失败：' + esc(state.error) + '</p>'; return; }
    if (!state.projects.length) {
      els.grid.innerHTML = '<p class="vw-note">没有找到 Wallpaper Engine 壁纸。需要在 Steam 上装好 Wallpaper Engine 并订阅一些壁纸。</p>';
      return;
    }
    var cur = currentSrc();
    var none = '<button type="button" class="vw-item vw-none' + (!cur ? ' is-active' : '') + '" data-act="none"><span class="vw-thumb"><span>不用壁纸</span></span><span class="vw-name">纯黑背景</span></button>';
    els.grid.innerHTML = none + list.map(function (p) {
      var src = p.playable ? abs(p.mediaUrl) : abs(p.previewUrl);
      var active = cur && src && cur === src;
      return '<button type="button" class="vw-item' + (active ? ' is-active' : '') + '" data-id="' + esc(p.id) + '">' +
        '<span class="vw-thumb">' + (p.previewUrl ? '<img alt="" loading="lazy" decoding="async" src="' + esc(p.previewUrl) + '">' : '') +
        '<em>' + (p.playable ? '动态' : '预览图') + '</em></span>' +
        '<span class="vw-name">' + esc(p.title) + '</span></button>';
    }).join('');
  }

  function apply(id) {
    if (typeof setCustomBackgroundMedia !== 'function') return;
    if (id === null) {
      setCustomBackgroundMedia(null, true);
      if (typeof showToast === 'function') showToast('已换回纯黑背景');
      render();
      return;
    }
    var p = state.projects.find(function (x) { return x.id === id; });
    if (!p) return;
    if (p.playable) {
      setCustomBackgroundMedia({ type: 'video', src: abs(p.mediaUrl), name: p.title, mime: 'video/mp4' }, true);
      if (typeof showToast === 'function') showToast('播放背景：' + p.title);
    } else if (p.previewUrl) {
      setCustomBackgroundMedia({ type: 'image', src: abs(p.previewUrl) }, true);
      if (typeof showToast === 'function') showToast('场景壁纸在网页里跑不了，先用它的预览图');
    }
    render();
  }

  function open() {
    if (!els.root) return;
    state.open = true;
    els.root.hidden = false;
    requestAnimationFrame(function () { els.root.classList.add('is-open'); });
    if (!state.loaded) load(false);
    else render();
  }
  function close() {
    state.open = false;
    els.root.classList.remove('is-open');
    setTimeout(function () { if (!state.open) els.root.hidden = true; }, 320);
  }

  function init() {
    els.root = $('vesper-wallpaper');
    if (!els.root) return;
    els.grid = $('vw-grid');
    els.filters = $('vw-filters');
    var btn = $('vesper-wallpaper-btn');
    if (btn) btn.addEventListener('click', function () { state.open ? close() : open(); });
    $('vw-close').addEventListener('click', close);
    $('vw-refresh').addEventListener('click', function () { load(true); });
    els.filters.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-filter]') : null;
      if (!b) return;
      state.filter = b.getAttribute('data-filter');
      render();
    });
    els.grid.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.vw-item') : null;
      if (!item) return;
      if (item.getAttribute('data-act') === 'none') apply(null);
      else apply(item.getAttribute('data-id'));
    });
    window.addEventListener('keydown', function (e) {
      if (document.body.classList.contains('vesper-lyric-picker-open')) return;
      if (state.open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);
  }

  window.vesperWallpaper = { open: open, close: close };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
