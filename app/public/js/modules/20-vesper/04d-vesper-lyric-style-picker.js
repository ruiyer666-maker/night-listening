// Vesper lyric style picker; the playback and timing state stay in the existing player.
(function () {
  'use strict';
  var runtime = window.vesperLyricStyles, renderers = window.VesperLyricRenderers, core = window.VesperLyricStyleCore;
  if (!runtime || !renderers || !core) return;
  var entries = [{ id: 'native', label: '原舞台', description: '原有粒子歌词与电影镜头' }].concat(renderers.styles);
  var trigger = document.createElement('button');
  trigger.id = 'vesper-lyric-style-btn'; trigger.type = 'button'; trigger.className = 'ctrl-btn vesper-lyric-style-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="vls-trigger-glyph" aria-hidden="true">Aa</span><span class="vls-trigger-label">样式</span>';
  var anchor = document.getElementById('lyric-timing-control');
  if (!anchor || !anchor.parentNode) return;
  anchor.insertAdjacentElement('afterend', trigger);

  var panel = document.createElement('div');
  panel.id = 'vesper-lyric-styles-panel'; panel.hidden = true;
  panel.innerHTML = '<section class="vls-dialog" role="dialog" aria-modal="true" aria-labelledby="vls-title" aria-describedby="vls-description">' +
    '<header class="vls-header"><div><span class="vls-eyebrow">VESPER / LYRICS</span><h2 id="vls-title">让文字换一种出场方式</h2><p id="vls-description"></p></div>' +
    '<button class="vls-close" type="button" aria-label="关闭歌词样式">×</button></header>' +
    '<div class="vls-grid" role="radiogroup" aria-label="歌词样式"></div>' +
    '<section class="vls-position-controls" aria-labelledby="vls-position-title">' +
    '<strong id="vls-position-title">歌词位置</strong>' +
    '<label class="vls-position-axis" for="vls-position-x"><span>水平 <output id="vls-position-x-value">0%</output></span><input id="vls-position-x" type="range" min="-40" max="40" step="1" value="0" aria-label="歌词水平位置" aria-describedby="vls-position-note"></label>' +
    '<label class="vls-position-axis" for="vls-position-y"><span>垂直 <output id="vls-position-y-value">0%</output></span><input id="vls-position-y" type="range" min="-40" max="40" step="1" value="0" aria-label="歌词垂直位置" aria-describedby="vls-position-note"></label>' +
    '<div class="vls-position-actions"><button id="vls-position-edit" class="vls-position-button" type="button">调整位置</button><button id="vls-position-reset" class="vls-position-button" type="button">恢复默认</button></div>' +
    '<p id="vls-position-note">拖动文字移动歌词；点击“调整位置”后，可拖动整个歌词区域。位置自动保存。</p></section>' +
    '<footer class="vls-footer"><label for="vls-font-scale">字号 <output id="vls-font-value">100%</output></label>' +
    '<input id="vls-font-scale" type="range" min="0.7" max="1.5" step="0.05" value="1" aria-label="歌词字号">' +
    '<span class="vls-credit">Folia 适配系列 · <a href="licenses/folia.html" target="_blank" rel="noopener">来源与许可</a></span>' +
    '<span class="vls-shortcut">Shift + L</span></footer></section>';
  document.body.appendChild(panel);
  var positionToolbar = document.createElement('div');
  positionToolbar.id = 'vesper-lyric-position-toolbar'; positionToolbar.hidden = true;
  positionToolbar.setAttribute('role', 'region'); positionToolbar.setAttribute('aria-label', '调整歌词位置');
  positionToolbar.innerHTML = '<span class="vls-position-help"><strong>调整歌词位置</strong><span>拖动歌词区域 · 方向键微调 · Esc 完成</span></span>' +
    '<button class="vls-position-button" data-position-action="reset" type="button">恢复默认</button>' +
    '<button class="vls-position-button vls-position-done" data-position-action="done" type="button">完成</button>';
  document.body.appendChild(positionToolbar);
  var coverHint = document.createElement('div');
  coverHint.id = 'vesper-cover-gesture-hint'; coverHint.hidden = true;
  coverHint.innerHTML = '<strong>立体封面</strong><span>拖动空白旋转封面 · 滚轮缩放 · 双击回正</span>';
  document.body.appendChild(coverHint);
  panel.querySelector('#vls-description').textContent = entries.length + ' 种排版。悬停或聚焦预览动态，点击切换，音乐继续播放。';
  var grid = panel.querySelector('.vls-grid'), cards = [], previousFocus = null;
  var previewItem = null, previewRaf = 0, previewStarted = 0, previewLast = 0;
  var previewFrames = 0, motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var recommended = ['classic', 'pendolo', 'monet'];
  var demoLines = core.prepare([
    { t: 0, text: '雨落在窗前' }, { t: 4, text: '灯火把夜色轻轻照亮' },
    { t: 8, text: '月亮升起在海面' }, { t: 13, text: '海浪轻轻拍着岸' },
    { t: 18, text: '风把远方带到身旁' }, { t: 23, text: '星空落进一盏灯' },
    { t: 28, text: '让回声慢慢走远' }
  ], 35);
  entries.forEach(function (entry) {
    var card = document.createElement('button');
    card.type = 'button'; card.className = 'vls-card'; card.dataset.style = entry.id;
    card.setAttribute('role', 'radio'); card.setAttribute('aria-label', entry.label + '，' + entry.description);
    var canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 220; canvas.setAttribute('aria-hidden', 'true');
    var caption = document.createElement('span'); caption.className = 'vls-card-caption';
    var label = document.createElement('strong'); label.textContent = entry.label;
    if (recommended.indexOf(entry.id) >= 0) {
      var badge = document.createElement('span'); badge.className = 'vls-recommended'; badge.textContent = '推荐'; label.appendChild(badge);
    }
    var detail = document.createElement('small'); detail.textContent = entry.description;
    caption.append(label, detail); card.append(canvas, caption); grid.appendChild(card);
    card.addEventListener('click', function () { runtime.setStyle(entry.id); close(); });
    var item = { card: card, canvas: canvas, entry: entry };
    cards.push(item);
    card.addEventListener('pointerenter', function () { startPreview(item); });
    card.addEventListener('pointerleave', function () { if (previewItem === item) stopPreview(true); });
    card.addEventListener('focus', function () { startPreview(item); });
    card.addEventListener('blur', function () { if (previewItem === item) stopPreview(true); });
  });
  function drawPreview(item, time, animated) {
      var sample = core.sample(demoLines, time);
      var ctx = item.canvas.getContext('2d'); ctx.clearRect(0, 0, 420, 220);
      if (item.entry.id === 'native') {
        ctx.fillStyle = '#0c1418'; ctx.fillRect(0, 0, 420, 220);
        ctx.fillStyle = '#8fa7b2';
        for (var i = 0; i < 140; i++) { var x = 45 + (i * 79 % 330), y = 18 + (i * 37 % 180); ctx.globalAlpha = 0.15 + (i % 4) * 0.1; ctx.fillRect(x, y, 2, 2); }
        ctx.globalAlpha = 1; ctx.fillStyle = '#eee9dd'; ctx.textAlign = 'center'; ctx.font = '600 31px sans-serif'; ctx.fillText('月亮升起在海面', 210, 114);
        ctx.fillStyle = '#8d9398'; ctx.font = '18px sans-serif'; ctx.fillText('海浪轻轻拍着岸', 210, 151);
        return;
      }
      renderers.draw(ctx, { style: item.entry.id, width: 420, height: 220, contentRect: { x: 20, y: 10, width: 380, height: 200 },
        time: time, lines: demoLines, index: sample.index, progress: sample.progress, charProgress: sample.charProgress,
        paused: !animated, reducedMotion: !animated, fontScale: 1, coverImage: null, preview: true, highlightMode: 'line',
        lyricState: { kind: 'ready', message: '' },
        theme: { background: '#0c1218', foreground: '#f7f2e6', accent: '#d7b989', muted: '#8c969d' }, song: { name: '月海', artist: 'Vesper' } });
  }
  function preview() { cards.forEach(function (item) { drawPreview(item, 10.4, false); }); }
  function revealCard(item) {
    // Scroll only the grid. Native scrollIntoView can also move the modal/page.
    var cardRect = item.card.getBoundingClientRect(), gridRect = grid.getBoundingClientRect();
    var inset = 5;
    if (cardRect.top < gridRect.top + inset) grid.scrollTop -= gridRect.top + inset - cardRect.top;
    else if (cardRect.bottom > gridRect.bottom - inset) grid.scrollTop += cardRect.bottom - gridRect.bottom + inset;
  }
  function stopPreview(reset) {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    var previous = previewItem; previewItem = null;
    if (previous) {
      previous.card.classList.remove('is-previewing');
      if (reset && !panel.hidden) drawPreview(previous, 10.4, false);
    }
  }
  function startPreview(item) {
    if (panel.hidden || document.hidden || motion.matches || item.entry.id === 'native') return;
    if (previewItem === item) return;
    stopPreview(true); previewItem = item; previewStarted = performance.now(); previewLast = 0;
    item.card.classList.add('is-previewing');
    function tick(now) {
      previewRaf = 0;
      if (!previewItem || panel.hidden || document.hidden || motion.matches) { stopPreview(false); return; }
      // Only the focused card animates, at 24fps, for one short sample.
      var elapsed = (now - previewStarted) / 1000;
      if (elapsed > 8) { stopPreview(true); return; }
      if (now - previewLast >= 1000 / 24) {
        previewLast = now; previewFrames++;
        drawPreview(item, 7.6 + elapsed, true);
      }
      previewRaf = requestAnimationFrame(tick);
    }
    previewRaf = requestAnimationFrame(tick);
  }
  function sync() {
    var id = runtime.getStyle(), chosen = entries.find(function (entry) { return entry.id === id; }) || entries[1];
    cards.forEach(function (item) { var selected = item.entry.id === id; item.card.setAttribute('aria-checked', String(selected)); item.card.tabIndex = selected ? 0 : -1; });
    trigger.title = '歌词样式：' + chosen.label + '（Shift + L）'; trigger.setAttribute('aria-label', trigger.title);
    trigger.querySelector('.vls-trigger-label').textContent = chosen.label;
    var scale = runtime.getFontScale(); panel.querySelector('#vls-font-scale').value = scale;
    panel.querySelector('#vls-font-scale').disabled = id === 'native';
    panel.querySelector('#vls-font-scale').title = id === 'native' ? '原舞台的字号使用原有视觉设置' : '调整当前歌词排版的字号';
    panel.querySelector('#vls-font-value').textContent = Math.round(scale * 100) + '%';
    syncPosition();
  }
  function syncPosition() {
    var native = runtime.getStyle() === 'native';
    var position = runtime.getPosition(), snapshot = runtime.snapshot();
    var wallpaper = document.body.classList.contains('custom-background-media') ||
      document.body.classList.contains('wallpaper-engine-active') || document.body.classList.contains('custom-background-video');
    ['x', 'y'].forEach(function (axis) {
      var input = panel.querySelector('#vls-position-' + axis), value = Math.round(position[axis] * 100);
      input.value = value; input.disabled = native;
      panel.querySelector('#vls-position-' + axis + '-value').textContent = (value > 0 ? '+' : '') + value + '%';
    });
    panel.querySelector('#vls-position-edit').disabled = native || !snapshot.visible;
    panel.querySelector('#vls-position-reset').disabled = native;
    panel.querySelector('#vls-position-note').textContent = native ? '位置调整仅用于 Folia 适配样式。' :
      (!snapshot.visible ? '进入歌词舞台后可拖动调整；滑杆设置会自动保存。' :
        (wallpaper ? '拖动歌词区域移动位置，也可用滑杆微调。位置自动保存。' :
          '拖动文字移动歌词；点击“调整位置”后，可拖动整个歌词区域。位置自动保存。'));
    positionToolbar.hidden = native || !snapshot.visible || !runtime.isPositionEditing() || !panel.hidden;
    coverHint.hidden = native || !snapshot.visible || !snapshot.coverOrbitAvailable || document.hidden || wallpaper || runtime.isPositionEditing() || !panel.hidden ||
      typeof fx === 'undefined' || !fx || fx.preset !== 0;
  }
  function open() {
    previousFocus = document.activeElement; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('vesper-lyric-picker-open'); sync(); preview();
    var selected = cards.find(function (item) { return item.entry.id === runtime.getStyle(); });
    if (selected) { selected.card.focus({ preventScroll: true }); revealCard(selected); }
  }
  function close() {
    stopPreview(false);
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); document.body.classList.remove('vesper-lyric-picker-open');
    if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    syncPosition();
  }
  trigger.addEventListener('click', function (event) { event.stopPropagation(); panel.hidden ? open() : close(); });
  panel.querySelector('.vls-close').addEventListener('click', close);
  panel.addEventListener('click', function (event) { if (event.target === panel) close(); });
  panel.querySelector('#vls-font-scale').addEventListener('input', function (event) { runtime.setFontScale(Number(event.target.value)); sync(); });
  ['x', 'y'].forEach(function (axis) {
    panel.querySelector('#vls-position-' + axis).addEventListener('input', function (event) {
      var position = runtime.getPosition(); position[axis] = Number(event.target.value) / 100;
      runtime.setPosition(position); syncPosition();
    });
  });
  panel.querySelector('#vls-position-edit').addEventListener('click', function () {
    close(); runtime.setPositionEditing(true); syncPosition();
  });
  panel.querySelector('#vls-position-reset').addEventListener('click', function () { runtime.resetPosition(); syncPosition(); });
  positionToolbar.querySelector('[data-position-action="reset"]').addEventListener('click', function () { runtime.resetPosition(); syncPosition(); });
  positionToolbar.querySelector('[data-position-action="done"]').addEventListener('click', function () {
    runtime.setPositionEditing(false); syncPosition(); trigger.focus({ preventScroll: true });
  });
  window.addEventListener('vesper-lyric-style-change', sync);
  window.addEventListener('vesper-lyric-position-change', syncPosition);
  window.addEventListener('vesper-stage-interaction-change', syncPosition);
  window.addEventListener('vesper-lyric-fonts-ready', function () {
    // Repaint the existing canvases once; preserve focus, audio and preview clock.
    preview();
    if (previewItem) drawPreview(previewItem, 7.6 + Math.min(8, (performance.now() - previewStarted) / 1000), true);
  });
  window.addEventListener('keydown', function (event) {
    var typing = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target && event.target.isContentEditable;
    if (!typing && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'l') {
      event.preventDefault(); event.stopImmediatePropagation(); panel.hidden ? open() : close(); return;
    }
    if (panel.hidden) return;
    // Keep existing home/shelf/player shortcuts out of this modal. Native button,
    // range and Tab defaults still work unless explicitly handled below.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.key === 'Tab') {
      var focusable = Array.from(panel.querySelectorAll('button,input,a')).filter(function (el) { return el.tabIndex >= 0 && !el.disabled; });
      var current = focusable.indexOf(document.activeElement), next = current + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= focusable.length) { event.preventDefault(); focusable[(next + focusable.length) % focusable.length].focus(); }
    }
    var focused = cards.findIndex(function (item) { return item.card === document.activeElement; });
    if (focused >= 0 && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      var columns = innerWidth <= 640 ? 2 : (innerWidth <= 950 ? 3 : 4);
      var step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
      var index = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : (focused + step + cards.length) % cards.length;
      runtime.setStyle(cards[index].entry.id); cards[index].card.focus({ preventScroll: true }); revealCard(cards[index]);
    }
  }, true);
  // Background/home switches already update body classes. Observe those changes
  // once, alongside runtime events, without another animation-frame loop.
  var stageObserver = new MutationObserver(syncPosition);
  stageObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopPreview(false); syncPosition(); });
  window.addEventListener('pagehide', function () { stopPreview(false); });
  if (motion.addEventListener) motion.addEventListener('change', function () { if (motion.matches) stopPreview(true); });
  window.vesperLyricStylePicker = { open: open, close: close, snapshot: function () { return { open: !panel.hidden, previewStyle: previewItem ? previewItem.entry.id : '', animating: !!previewRaf, previewFrames: previewFrames }; } };
  sync();
})();
