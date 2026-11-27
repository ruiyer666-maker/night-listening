// Folia-inspired lyric layouts share Vesper's media clock and existing render loop.
// This adapter owns only the canvas presentation; fetching and parsing stay upstream.
(function () {
  'use strict';
  var core = window.VesperLyricStyleCore;
  var renderers = window.VesperLyricRenderers;
  if (!core || !renderers) return;
  var STYLE_KEY = 'vesper-lyric-style-v1';
  var FONT_KEY = 'vesper-lyric-font-scale-v1';
  var POSITION_KEY = 'vesper-lyric-positions-v1';
  var positions = Object.create(null), positionEditing = false, pointerDrag = null, suppressClick = false;
  var lastInteractionState = '';
  var positionOffset = { x: 0, y: 0 };
  var style = 'classic', fontScale = 1;
  var canvas = null, context = null, width = 0, height = 0, dpr = 1;
  var visible = false, initialized = false, updating = false, stopped = false;
  var lastLines = null, lastToken = null, lastTrackKey = null, blockedLines = null, lastDuration = -1;
  var prepared = [], bounds = [], drawnLines = [];
  var currentSample = { index: -1, progress: 0, charProgress: [], highlightMode: 'line' }, currentTime = 0;
  var currentLyricState = { kind: 'unavailable', message: '暂无歌词' };
  var coverImage = null, coverSrc = '', coverRequest = 0, media = null;
  var lastDrawKey = '', lastDrawTime = null, errorMessage = '';
  var nativeSuspended = false;
  var contentRect = { x: 0, y: 0, width: 0, height: 0 };
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mediaEvents = ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata', 'ended'];

  function validStyle(value) {
    value = String(value || 'classic');
    return value === 'native' || renderers.styles.some(function (item) { return item.id === value; }) ? value : 'classic';
  }
  function normalizedFontScale(value) {
    value = Number(value);
    return isFinite(value) ? Math.max(0.7, Math.min(1.5, value)) : 1;
  }
  function normalizedPosition(value) {
    value = value || {};
    function axis(number) { number = Number(number); return isFinite(number) ? Math.max(-.4, Math.min(.4, number)) : 0; }
    return { x: axis(value.x), y: axis(value.y) };
  }
  try {
    style = validStyle(localStorage.getItem(STYLE_KEY));
    var savedScale = localStorage.getItem(FONT_KEY);
    if (savedScale != null) fontScale = normalizedFontScale(savedScale);
    var savedPositions = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}');
    renderers.styles.forEach(function (entry) {
      if (savedPositions && Object.prototype.hasOwnProperty.call(savedPositions, entry.id)) positions[entry.id] = normalizedPosition(savedPositions[entry.id]);
    });
  } catch (_) { }

  function getPosition() { return normalizedPosition(positions[style]); }
  function getVisiblePosition() {
    return visible ? normalizedPosition({ x: positionOffset.x / contentRect.width, y: positionOffset.y / contentRect.height }) : getPosition();
  }
  function announcePosition() {
    window.dispatchEvent(new CustomEvent('vesper-lyric-position-change', { detail: { style: style, position: getPosition(), editing: positionEditing } }));
  }
  function savePositions() { try { localStorage.setItem(POSITION_KEY, JSON.stringify(positions)); } catch (_) { } }
  function setPosition(value, transient) {
    if (!isCustom()) return getPosition();
    positions[style] = normalizedPosition(value);
    lastDrawKey = '';
    update();
    // Store the position actually reached at a boundary, so controls and reload
    // agree with the drag. Later lines may need a tighter visible offset.
    if (visible && isCustom()) positions[style] = normalizedPosition({ x: positionOffset.x / contentRect.width, y: positionOffset.y / contentRect.height });
    if (!transient) savePositions();
    announcePosition();
    return getPosition();
  }
  function resetPosition() { finishPointer(false); return setPosition({ x: 0, y: 0 }); }
  function setPositionEditing(value) {
    positionEditing = !!value && isCustom() && visible;
    if (canvas) canvas.setAttribute('data-position-editing', String(positionEditing));
    if (!positionEditing) finishPointer(true);
    announcePosition();
    announceInteraction();
    return positionEditing;
  }

  function isCustom() { return style !== 'native'; }
  function currentAudio() { return typeof audio !== 'undefined' ? audio : null; }
  function song() {
    if (typeof currentLyricSong === 'function') return currentLyricSong() || {};
    if (typeof currentIdx !== 'undefined' && typeof playQueue !== 'undefined' && playQueue[currentIdx]) return playQueue[currentIdx];
    return typeof currentLocalSong !== 'undefined' && currentLocalSong || {};
  }
  function playbackTime() {
    var source = currentAudio();
    var raw = typeof stageLyricPlaybackSeconds === 'function' ? stageLyricPlaybackSeconds() : source && Number(source.currentTime) || 0;
    return typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(raw) : raw;
  }
  function isPaused() { var source = currentAudio(); return !source || !!source.paused; }
  function trackKey() {
    var current = song();
    return typeof vesperLyricTrackKey === 'function' ? vesperLyricTrackKey(current) :
      [current.source || current.provider || '', current.localKey || current.id || current.localUrl || current.name || ''].join('|');
  }
  function lyricState() {
    var source = currentAudio();
    var kind = currentSample.state || 'neutral';
    if (source && source.ended) kind = 'ended';
    else if (currentSample.index >= 0) kind = 'ready';
    else if (!prepared.some(function (line) { return !!line.text; })) {
      var fetched = typeof getVesperLyricFetchState === 'function' ? getVesperLyricFetchState(song(), lastToken) : null;
      if (fetched) kind = fetched.kind === 'ready' ? 'neutral' : fetched.kind;
      else if (blockedLines || typeof lyricsTimingSource !== 'undefined' && lyricsTimingSource === 'pending') kind = 'loading';
      else kind = 'unavailable';
    }
    var messages = {
      loading: '正在加载歌词', unavailable: '暂无歌词', error: '歌词加载失败', instrumental: '纯音乐',
      intro: '前奏', interlude: '间奏', outro: '尾奏', ready: '', neutral: '随音乐静听', ended: '播放结束'
    };
    return { kind: kind, message: messages[kind] == null ? messages.neutral : messages[kind], gapAfter: currentSample.gapAfter == null ? null : currentSample.gapAfter };
  }
  function canShow() {
    var source = currentAudio();
    return isCustom() && !stopped && !document.hidden && source &&
      typeof fx !== 'undefined' && fx.particleLyrics !== false &&
      !(source.paused && !source.ended && fx.lyricPauseHold === false) &&
      !document.body.classList.contains('empty-home-active') &&
      !document.body.classList.contains('splash-active');
  }
  function hide() {
    var wasVisible = visible;
    visible = false;
    bounds = [];
    drawnLines = [];
    lastDrawTime = null;
    lastDrawKey = '';
    if (canvas) {
      canvas.hidden = true;
      canvas.style.pointerEvents = 'none';
      canvas.setAttribute('aria-hidden', 'true');
    }
    if (pointerDrag) finishPointer(pointerDrag.mode !== 'scene');
    if (positionEditing || wasVisible) setPositionEditing(false);
    announceInteraction();
  }
  function syncNativeRenderer() {
    if (isCustom()) {
      if (!nativeSuspended) {
        if (typeof clearStageLyrics === 'function') clearStageLyrics();
        nativeSuspended = true;
      }
      if (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group) stageLyrics.group.visible = false;
      return;
    }
    if (!nativeSuspended) return;
    nativeSuspended = false;
    if (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group) stageLyrics.group.visible = true;
    if (typeof fx !== 'undefined' && fx.particleLyrics !== false) {
      if (typeof createLyricsParticles === 'function') createLyricsParticles();
      if (typeof renderLyrics === 'function') renderLyrics({ reason: 'vesper-native-style' });
    }
  }
  function bindMedia(source) {
    if (source === media) return;
    if (media && media.removeEventListener) mediaEvents.forEach(function (name) { media.removeEventListener(name, onMediaChange); });
    media = source;
    if (media && media.addEventListener) mediaEvents.forEach(function (name) { media.addEventListener(name, onMediaChange); });
  }
  function onMediaChange() { update(); }
  function syncLines(force) {
    var input = typeof lyricsLines !== 'undefined' && Array.isArray(lyricsLines) ? lyricsLines : [];
    var token = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : 0;
    var key = trackKey();
    var source = currentAudio();
    var duration = source && isFinite(source.duration) ? Number(source.duration) : Number(song().duration) || 0;
    if (lastToken !== null && (token !== lastToken || key !== lastTrackKey) && input === lastLines) {
      blockedLines = input;
      prepared = [];
      lastDrawKey = '';
    }
    var changed = input !== lastLines || token !== lastToken || key !== lastTrackKey || Math.abs(duration - lastDuration) > 0.1;
    if (input !== lastLines) blockedLines = null;
    lastToken = token;
    lastTrackKey = key;
    lastLines = input;
    lastDuration = duration;
    if (blockedLines === input) return;
    if (changed || force) {
      prepared = core.prepare(input, duration);
      lastDrawKey = '';
    }
  }
  function syncCover() {
    var current = song();
    var raw = typeof songCoverSrc === 'function' ? songCoverSrc(current, 600) : current.cover || current.coverUrl || '';
    var src = typeof coverProxySrc === 'function' ? coverProxySrc(raw) : raw;
    if (src === coverSrc) return;
    coverSrc = src;
    coverImage = null;
    var token = ++coverRequest;
    if (!src) return;
    var image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = function () {
      if (token !== coverRequest) return;
      coverImage = image;
      lastDrawKey = '';
      update();
    };
    image.onerror = function () { if (token === coverRequest) coverImage = null; };
    image.src = src;
  }
  function safeColor(value, fallback) {
    if (value && typeof value.getStyle === 'function') return value.getStyle();
    return typeof value === 'string' && value ? value : fallback;
  }
  function theme() {
    var palette = typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.palette || {};
    return {
      background: '#080b10', foreground: '#f5f3ee',
      accent: safeColor(palette.highlight || palette.primary, '#e7c987'),
      muted: safeColor(palette.secondary, '#9298a3')
    };
  }
  function layout() {
    var nextWidth = Math.max(1, Math.round(window.innerWidth));
    var nextHeight = Math.max(1, Math.round(window.innerHeight));
    var nextDpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (width !== nextWidth || height !== nextHeight || dpr !== nextDpr) {
      width = nextWidth; height = nextHeight; dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      lastDrawKey = '';
    }
    var top = width < 640 ? 82 : 88;
    if (width < 640) {
      ['top-right', 'search-area'].forEach(function (id) {
        var element = document.getElementById(id);
        if (!element || !element.getBoundingClientRect) return;
        if (id === 'search-area') {
          var styles = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null;
          if (styles ? Number(styles.opacity) <= 0.05 || styles.pointerEvents === 'none' || styles.display === 'none' : !(element.classList && element.classList.contains('peek'))) return;
        }
        var box = element.getBoundingClientRect();
        if (box.height > 0 && box.bottom < height - 160) top = Math.max(top, box.bottom + 14);
      });
    }
    var bottom = height - (width < 640 ? 124 : 116);
    var bar = document.getElementById('bottom-bar');
    if (bar) {
      var barRect = bar.getBoundingClientRect();
      if (barRect.height > 0 && barRect.top > top + 100 && barRect.top < height) bottom = Math.min(bottom, barRect.top - 18);
    }
    bottom = Math.max(top + 100, Math.min(height - 16, bottom));
    var padding = width < 640 ? 18 : Math.max(32, Math.min(84, width * 0.055));
    contentRect = { x: padding, y: top, width: Math.max(1, width - padding * 2), height: Math.max(1, bottom - top) };
    canvas.style.clipPath = 'inset(' + top + 'px 0 ' + Math.max(0, height - bottom) + 'px 0)';
  }
  function constrainOffset(offset, lineBounds) {
    var active = lineBounds.filter(function (item) { return item.lineIndex === currentSample.index; });
    if (!active.length) return offset;
    var left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    active.forEach(function (item) {
      left = Math.min(left, item.x); right = Math.max(right, item.x + item.width);
      top = Math.min(top, item.y); bottom = Math.max(bottom, item.y + item.height);
    });
    // Do not move an originally clipped animation further outside its stage.
    // Interior movement remains a pure translation, preserving its typography.
    return {
      x: Math.max(Math.min(0, contentRect.x + 3 - left), Math.min(Math.max(0, contentRect.x + contentRect.width - 3 - right), offset.x)),
      y: Math.max(Math.min(0, contentRect.y + 3 - top), Math.min(Math.max(0, contentRect.y + contentRect.height - 3 - bottom), offset.y))
    };
  }
  function drawFrame(frame, offset) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.rect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
    context.clip();
    context.translate(offset.x, offset.y);
    try { return renderers.draw(context, frame) || {}; }
    finally { context.restore(); }
  }
  function update(force) {
    if (!initialized || updating) return;
    updating = true;
    try {
      syncNativeRenderer();
      bindMedia(currentAudio());
      syncLines(force === true);
      currentTime = playbackTime();
      currentSample = core.sample(prepared, currentTime);
      var source = currentAudio();
      if (source && source.ended) currentSample = {
        index: -1, progress: 0, charProgress: [], highlightMode: 'line', state: 'ended',
        gapAfter: currentSample.index >= 0 ? currentSample.index : currentSample.gapAfter
      };
      currentLyricState = lyricState();
      if (!canShow()) { hide(); return; }
      syncCover();
      layout();
      var colors = theme(), currentSong = song();
      var position = getPosition();
      var requestedOffset = { x: position.x * contentRect.width, y: position.y * contentRect.height };
      var frame = {
        style: style, width: width, height: height, contentRect: contentRect,
        time: currentTime, index: currentSample.index, lines: prepared,
        progress: currentSample.progress, charProgress: currentSample.charProgress,
        lyricState: Object.assign({}, currentLyricState), highlightMode: currentSample.highlightMode || 'line', gapAfter: currentLyricState.gapAfter,
        paused: isPaused(), reducedMotion: !!reducedMotion.matches,
        fontScale: fontScale, theme: colors, coverImage: coverImage,
        song: { name: currentSong.name || currentSong.title || '', artist: currentSong.artist || '' }
      };
      var drawKey = [style, width, height, dpr, fontScale, position.x, position.y, currentTime, currentSample.index, frame.lyricState.kind, frame.highlightMode, lastTrackKey, frame.paused, frame.reducedMotion, colors.accent, colors.muted, contentRect.height, coverRequest, !!coverImage].join('|');
      canvas.hidden = false;
      canvas.style.pointerEvents = 'auto';
      canvas.setAttribute('aria-hidden', 'false');
      visible = true;
      if (pointerDrag && pointerDrag.mode === 'scene' && !scenePointerAvailable()) finishPointer(false);
      announceInteraction();
      if (lastDrawKey === drawKey) return;
      positionOffset = requestedOffset;
      // Translate the scene without changing its typography or media clock.
      // The fixed outer clip keeps lyrics clear of the player controls.
      var result = drawFrame(frame, positionOffset);
      var limitedOffset = constrainOffset(positionOffset, Array.isArray(result.bounds) ? result.bounds : []);
      if (limitedOffset.x !== positionOffset.x || limitedOffset.y !== positionOffset.y) {
        positionOffset = limitedOffset;
        result = drawFrame(frame, positionOffset);
      }
      bounds = Array.isArray(result.bounds) ? result.bounds.map(function (item) {
        return Object.assign({}, item, { x: item.x + positionOffset.x, y: item.y + positionOffset.y });
      }) : [];
      drawnLines = Array.isArray(result.drawnLines) ? result.drawnLines : [];
      lastDrawTime = currentTime;
      lastDrawKey = drawKey;
      var currentLine = prepared[currentSample.index];
      canvas.setAttribute('aria-label', currentLine ? '当前歌词：' + currentLine.text : currentLyricState.message + '：' + frame.song.name);
    } catch (error) {
      errorMessage = error && error.message || String(error);
      console.warn('[VesperLyricStyles] Returning to native lyrics:', error);
      hide();
      style = 'native';
      syncNativeRenderer();
      announce();
      if (typeof showToast === 'function') showToast('歌词样式暂不可用，已恢复原生舞台');
    } finally { updating = false; }
  }
  function announce() {
    window.dispatchEvent(new CustomEvent('vesper-lyric-style-change', { detail: { style: style, fontScale: fontScale } }));
  }
  function setStyle(value) {
    var next = validStyle(value);
    if (style === next) { update(); return style; }
    finishPointer(pointerDrag && pointerDrag.mode === 'scene' ? false : true);
    style = next;
    if (!isCustom()) setPositionEditing(false);
    errorMessage = '';
    lastDrawKey = '';
    try { localStorage.setItem(STYLE_KEY, style); } catch (_) { }
    update();
    announce();
    announcePosition();
    return style;
  }
  function setFontScale(value) {
    fontScale = normalizedFontScale(value);
    lastDrawKey = '';
    try { localStorage.setItem(FONT_KEY, String(fontScale)); } catch (_) { }
    update();
    announce();
    return fontScale;
  }
  function isReady(rawTime) {
    if (!isCustom() || !canShow() || !prepared.length) return true;
    // Never call stageLyricPlaybackSeconds here: the preview clock itself asks
    // this readiness predicate while releasing a seek hold.
    if (rawTime == null) return lastDrawTime !== null;
    var expected = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(rawTime) : rawTime;
    return lastDrawTime !== null && Math.abs(lastDrawTime - expected) < 0.24;
  }
  function clickLine(event) {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    if (positionEditing) return;
    if (!visible || !currentAudio()) return;
    var box = canvas.getBoundingClientRect();
    var x = (event.clientX - box.left) * width / Math.max(1, box.width);
    var y = (event.clientY - box.top) * height / Math.max(1, box.height);
    if (x < contentRect.x || x > contentRect.x + contentRect.width || y < contentRect.y || y > contentRect.y + contentRect.height) return;
    var hit = bounds.slice().reverse().find(function (item) {
      return item.lineIndex != null && x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height;
    });
    var line = hit && prepared[hit.lineIndex];
    if (!line) return;
    event.preventDefault();
    var source = currentAudio();
    var offset = typeof getActiveLyricTimingOffsetSeconds === 'function' ? getActiveLyricTimingOffsetSeconds() : 0;
    var target = Math.max(0, line.t - offset);
    var resume = !source.paused && !source.ended;
    if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('lyric-click-seek');
    if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload('lyric-click-seek');
    if (typeof commitProgressSeek === 'function' && typeof progressDragState !== 'undefined') {
      progressDragState.active = false;
      progressDragState.media = source;
      progressDragState.mediaSrc = source.currentSrc || source.src || '';
      progressDragState.previewDuration = typeof getPlaybackDurationSeconds === 'function' ? getPlaybackDurationSeconds() : Number(source.duration) || 0;
      commitProgressSeek(target, resume);
    } else source.currentTime = target;
    lastDrawKey = '';
    update();
  }
  function pointerPoint(event) {
    var box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) * width / Math.max(1, box.width), y: (event.clientY - box.top) * height / Math.max(1, box.height) };
  }
  function pointInsideStage(point) {
    return point.x >= contentRect.x && point.x <= contentRect.x + contentRect.width && point.y >= contentRect.y && point.y <= contentRect.y + contentRect.height;
  }
  function pointHitsLyric(point) {
    return pointInsideStage(point) && bounds.some(function (item) {
      return item.lineIndex >= 0 && prepared[item.lineIndex] && point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height;
    });
  }
  function hasWallpaper() { return document.body.classList.contains('custom-background-media'); }
  function scenePointerAvailable(event) {
    return visible && !positionEditing && !hasWallpaper() && window.vesperStagePointer && window.vesperStagePointer.canInteract(event);
  }
  function coverOrbitAvailable() { return !!scenePointerAvailable() && typeof fx !== 'undefined' && Number(fx.preset) === 0; }
  function announceInteraction() {
    var available = coverOrbitAvailable(), preset = typeof fx !== 'undefined' ? fx.preset : '';
    var key = [visible, positionEditing, hasWallpaper(), preset, available].join('|');
    if (lastInteractionState === key) return;
    lastInteractionState = key;
    if (canvas) canvas.title = scenePointerAvailable() ? '拖动歌词调整位置；拖动空白旋转封面，滚轮缩放，双击空白回正' : '按住拖动调整歌词位置；单击歌词跳转播放';
    window.dispatchEvent(new CustomEvent('vesper-stage-interaction-change', { detail: { visible: visible, coverOrbitAvailable: available, preset: preset } }));
  }
  function sceneWheel(event) {
    if (scenePointerAvailable(event) && pointInsideStage(pointerPoint(event))) window.vesperStagePointer.wheel(event);
  }
  function sceneDoubleClick(event) {
    var point = pointerPoint(event);
    if (scenePointerAvailable(event) && pointInsideStage(point) && !pointHitsLyric(point)) window.vesperStagePointer.recenter(event);
  }
  function startPointer(event) {
    if (event.button !== 0 || !visible || pointerDrag || document.body.classList.contains('vesper-lyric-picker-open')) return;
    var point = pointerPoint(event);
    if (!pointInsideStage(point)) return;
    suppressClick = false;
    // Suppress the compatibility mousedown consumed by the old 3D camera drag.
    // Pointer click still handles ordinary lyric seeking independently.
    event.preventDefault();
    var mode = 'lyrics';
    if (!positionEditing && !hasWallpaper() && !pointHitsLyric(point)) {
      if (!scenePointerAvailable(event) || !window.vesperStagePointer.begin(event)) return;
      mode = 'scene';
    }
    pointerDrag = { id: event.pointerId, mode: mode, start: point, position: getVisiblePosition(), originalPosition: getPosition(), moved: false, width: contentRect.width, height: contentRect.height };
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  }
  function movePointer(event) {
    if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
    var point = pointerPoint(event), dx = point.x - pointerDrag.start.x, dy = point.y - pointerDrag.start.y;
    if (!pointerDrag.moved && Math.hypot(dx, dy) < 5) return;
    pointerDrag.moved = true;
    canvas.setAttribute('data-dragging', 'true');
    event.preventDefault();
    if (pointerDrag.mode === 'scene') {
      if (!scenePointerAvailable()) { finishPointer(false); return; }
      window.vesperStagePointer.move(event);
      return;
    }
    setPosition({ x: pointerDrag.position.x + dx / pointerDrag.width, y: pointerDrag.position.y + dy / pointerDrag.height }, true);
  }
  function finishPointer(commit) {
    var drag = pointerDrag;
    if (!drag) return;
    pointerDrag = null;
    suppressClick = drag.mode === 'scene' || drag.moved;
    canvas.setAttribute('data-dragging', 'false');
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    if (drag.mode === 'scene') { window.vesperStagePointer.end(!commit); return; }
    if (drag.moved) {
      if (commit) { savePositions(); announcePosition(); }
      else {
        positions[style] = drag.originalPosition;
        savePositions(); lastDrawKey = ''; update(); announcePosition();
      }
    }
  }
  function positionKey(event) {
    if (!positionEditing || !visible || document.body.classList.contains('vesper-lyric-picker-open')) return;
    if (event.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setPositionEditing(false); return; }
    if (!/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var position = getVisiblePosition(), step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') position.x -= step / contentRect.width;
    if (event.key === 'ArrowRight') position.x += step / contentRect.width;
    if (event.key === 'ArrowUp') position.y -= step / contentRect.height;
    if (event.key === 'ArrowDown') position.y += step / contentRect.height;
    setPosition(position);
  }
  function snapshot() {
    var line = prepared[currentSample.index];
    var currentSong = song();
    return {
      style: style, visible: visible, lineIndex: currentSample.index,
      time: currentTime, progress: currentSample.progress, paused: isPaused(),
      currentText: line ? line.text : '', charProgress: (currentSample.charProgress || []).slice(),
      state: currentLyricState.kind, lyricState: Object.assign({}, currentLyricState),
      highlightMode: currentSample.highlightMode || 'line', gapAfter: currentLyricState.gapAfter,
      hasWordTiming: !!(line && line.hasWordTiming), trackToken: lastToken,
      trackKey: String(currentSong.localKey || currentSong.id || currentSong.name || ''),
      reducedMotion: !!reducedMotion.matches, fontScale: fontScale,
      position: getPosition(), positionOffset: Object.assign({}, positionOffset), positionEditing: positionEditing,
      pointerMode: pointerDrag ? pointerDrag.mode : 'none',
      coverOrbitAvailable: coverOrbitAvailable(),
      drawnLines: drawnLines.slice(), bounds: bounds.map(function (item) { return Object.assign({}, item); }),
      width: width, height: height, canvasWidth: canvas ? canvas.width : 0, canvasHeight: canvas ? canvas.height : 0, dpr: dpr,
      contentRect: Object.assign({}, contentRect), safeRect: Object.assign({}, contentRect), ready: isReady(), error: errorMessage
    };
  }
  function init() {
    if (initialized) return;
    canvas = document.createElement('canvas');
    canvas.id = 'vesper-lyric-canvas';
    canvas.hidden = true;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '歌词舞台');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.title = '按住拖动调整歌词位置；单击歌词跳转播放';
    context = canvas.getContext('2d', { alpha: true });
    if (!context) { style = 'native'; return; }
    document.body.appendChild(canvas);
    canvas.addEventListener('click', clickLine);
    canvas.addEventListener('pointerdown', startPointer);
    canvas.addEventListener('pointermove', movePointer);
    canvas.addEventListener('pointerup', function (event) { if (pointerDrag && pointerDrag.id === event.pointerId) finishPointer(true); });
    canvas.addEventListener('pointercancel', function (event) { if (pointerDrag && pointerDrag.id === event.pointerId) finishPointer(false); });
    canvas.addEventListener('lostpointercapture', function () { finishPointer(false); });
    canvas.addEventListener('wheel', sceneWheel, { passive: false });
    canvas.addEventListener('dblclick', sceneDoubleClick);
    window.addEventListener('blur', function () { finishPointer(pointerDrag && pointerDrag.mode === 'scene' ? false : true); });
    window.addEventListener('keydown', positionKey, true);
    initialized = true;
    window.addEventListener('resize', function () { lastDrawKey = ''; update(); });
    window.addEventListener('vesper-lyric-fonts-ready', function () {
      lastDrawKey = '';
      if (style === 'native' && typeof renderLyrics === 'function') renderLyrics();
      else update(true);
    });
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', function () { stopped = true; hide(); });
    window.addEventListener('pageshow', function () { stopped = false; update(); });
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', function () { lastDrawKey = ''; update(); });
    else if (reducedMotion.addListener) reducedMotion.addListener(function () { lastDrawKey = ''; update(); });
    if (typeof MutationObserver === 'function') new MutationObserver(function () { update(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    update();
    announce();
  }
  window.vesperLyricStyles = {
    setStyle: setStyle, getStyle: function () { return style; },
    setFontScale: setFontScale, getFontScale: function () { return fontScale; },
    getPosition: getPosition, setPosition: setPosition, resetPosition: resetPosition,
    getPointerMode: function () { return pointerDrag ? pointerDrag.mode : 'none'; },
    setPositionEditing: setPositionEditing, isPositionEditing: function () { return positionEditing; },
    snapshot: snapshot, update: update, isCustom: isCustom, isReady: isReady
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
