// Compact mobile controls reuse the real player nodes and restore them on desktop.
(function () {
  'use strict';
  var query = window.matchMedia('(max-width: 640px)');
  var mobile = false, expanded = false, scheduled = 0, barHeight = -1;
  var bar, controls, more, quick, drawer, stageButton;
  var slots = [], maximumHeight = window.innerHeight;

  function move(id, destination) {
    var node = document.getElementById(id);
    if (!node || !node.parentNode) return null;
    var anchor = document.createComment('vesper-mobile:' + id);
    node.parentNode.insertBefore(anchor, node);
    slots.push({ node: node, anchor: anchor });
    destination.appendChild(node);
    return node;
  }
  function restore() {
    slots.forEach(function (slot) {
      if (slot.anchor.parentNode) slot.anchor.parentNode.replaceChild(slot.node, slot.anchor);
    });
    slots = [];
    drawer.replaceChildren();
  }
  function schedule() {
    if (!scheduled) scheduled = window.requestAnimationFrame(measure);
  }
  function measure() {
    scheduled = 0;
    if (!bar) return;
    var next = mobile ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    if (next !== barHeight) {
      barHeight = next;
      document.documentElement.style.setProperty('--vesper-mobile-bar-height', next + 'px');
      if (window.vesperLyricStyles) window.vesperLyricStyles.update(true);
    }
    var viewport = window.visualViewport;
    var currentHeight = viewport ? viewport.height : window.innerHeight;
    maximumHeight = Math.max(maximumHeight, window.innerHeight);
    var editing = document.activeElement === document.getElementById('search-input');
    var keyboard = mobile && editing && maximumHeight - currentHeight > 140;
    document.body.classList.toggle('vesper-mobile-keyboard', keyboard);
    document.documentElement.style.setProperty('--vesper-mobile-viewport', Math.round(currentHeight) + 'px');
    if (keyboard && expanded) setExpanded(false);
  }
  function setExpanded(value, focus) {
    expanded = mobile && !!value;
    drawer.hidden = !expanded;
    more.setAttribute('aria-expanded', String(expanded));
    more.setAttribute('aria-label', expanded ? '收起更多播放操作' : '更多播放操作');
    more.querySelector('span').textContent = expanded ? '收起' : '更多';
    bar.classList.toggle('vesper-mobile-expanded', expanded);
    if (focus) more.focus({ preventScroll: true });
    schedule();
  }
  function addAction(id, label) {
    var cell = document.createElement('div');
    cell.className = 'vm-action';
    var node = move(id, cell);
    if (!node) return;
    var button = node.tagName === 'BUTTON' ? node : node.querySelector('button');
    if (button && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title || label);
    var text = document.createElement('span');
    text.className = 'vm-action-label'; text.textContent = label;
    text.setAttribute('aria-hidden', 'true'); cell.appendChild(text);
    drawer.appendChild(cell);
  }
  function sync() {
    if (!bar) return;
    var next = query.matches;
    if (next !== mobile) {
      mobile = next;
      if (mobile) {
        move('vesper-lyric-style-btn', quick);
        move('time-display', quick);
        [
          ['prev-btn', '上一首'], ['play-mode-btn', '播放顺序'],
          ['mini-queue-btn', '播放队列'], ['heart-btn', '喜欢'],
          ['collect-btn', '加入歌单'], ['lyric-timing-control', '歌词'],
          ['volume-control', '音量'], ['immersive-btn', '沉浸模式']
        ].forEach(function (item) { addAction(item[0], item[1]); });
      } else restore();
      document.body.classList.toggle('vesper-mobile-ready', mobile);
      more.hidden = !mobile; quick.hidden = !mobile;
      setExpanded(false);
    }
    var onHome = document.body.classList.contains('empty-home-active');
    stageButton.textContent = onHome ? '看歌词' : '选歌';
    stageButton.setAttribute('aria-label', onHome ? '进入歌词舞台' : '返回首页选歌');
    if (document.body.classList.contains('vesper-lyric-picker-open') && expanded) setExpanded(false);
    schedule();
  }
  function init() {
    bar = document.getElementById('bottom-bar'); controls = document.getElementById('controls');
    if (!bar || !controls) return;
    more = document.createElement('button'); more.id = 'vesper-mobile-more'; more.type = 'button';
    more.className = 'ctrl-btn'; more.hidden = true;
    more.setAttribute('aria-controls', 'vesper-mobile-actions');
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="9" r="1.6"/><circle cx="12" cy="9" r="1.6"/><circle cx="19" cy="9" r="1.6"/></svg><span>更多</span>';
    controls.appendChild(more);
    quick = document.createElement('div'); quick.id = 'vesper-mobile-quick'; quick.hidden = true;
    stageButton = document.createElement('button'); stageButton.type = 'button';
    stageButton.id = 'vesper-mobile-stage'; stageButton.textContent = '看歌词'; quick.appendChild(stageButton);
    bar.appendChild(quick);
    drawer = document.createElement('div'); drawer.id = 'vesper-mobile-actions'; drawer.hidden = true;
    drawer.setAttribute('role', 'group'); drawer.setAttribute('aria-label', '更多播放操作'); bar.appendChild(drawer);
    more.addEventListener('click', function (event) { event.stopPropagation(); setExpanded(!expanded); });
    stageButton.addEventListener('click', function () {
      if (!window.vesperHome) return;
      if (document.body.classList.contains('empty-home-active')) window.vesperHome.enterStage();
      else window.vesperHome.open();
      setExpanded(false);
    });
    document.addEventListener('pointerdown', function (event) {
      if (expanded && !bar.contains(event.target)) setExpanded(false);
    });
    document.addEventListener('keydown', function (event) {
      if (expanded && event.key === 'Escape' && bar.contains(document.activeElement)) {
        event.preventDefault(); event.stopPropagation(); setExpanded(false, true);
      }
    });
    if (query.addEventListener) query.addEventListener('change', sync);
    else query.addListener(sync);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', function () { maximumHeight = window.innerHeight; schedule(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(bar);
    if (typeof MutationObserver === 'function') new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.vesperMobile = { setExpanded: setExpanded, snapshot: function () { return { active: mobile, expanded: expanded, barHeight: barHeight }; } };
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
