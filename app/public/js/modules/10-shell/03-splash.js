// ============================================================

document.body.classList.add('splash-active');
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;
var splashW = 0, splashH = 0;
var splashDust = [];
var splashStreaks = [];
var splashShards = [];
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;

function splashClamp01(v) { return Math.max(0, Math.min(1, v)); }
function splashSmoothstep(edge0, edge1, x) {
  var t = splashClamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function splashEaseOutCubic(t) {
  t = splashClamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
function splashTimelineElapsed(elapsed) {
  return elapsed;
}
function stopSplashIntroSound() {
  if (!splashAudioCtx) return;
  try {
    if (splashAudioCtx.close) splashAudioCtx.close();
  } catch (e) { }
  splashAudioCtx = null;
}
function releaseStartupFastSkipPreload() {
  if (!document.documentElement.classList.contains('startup-fast-skip-preload')) return false;
  document.body.classList.add('startup-fast-skip-revealing');
  // This gate hides the whole renderer (including the player console) before
  // the fast-skip splash is released. Full desktop mode briefly hides and
  // reparents the Chromium HWND; waiting for another rAF here can therefore
  // leave the gate latched forever while only the native desktop controller is
  // visible. Release the gate synchronously, then keep only the cosmetic reveal
  // class on a timer.
  document.documentElement.classList.remove('startup-fast-skip-preload');
  setTimeout(function () { document.body.classList.remove('startup-fast-skip-revealing'); }, 520);
  return true;
}

// ---- Vesper 启动画面（替换原项目的启动动画和开场音效）----
// 纯黑夜空：星星慢慢闪，一弯新月从下方升起，缺口处那颗晚星（Vesper）最后亮起来。
// 只用 2D canvas，不再用原来的 WebGL 光带。

var vesperSplashStars = [];
var vesperSplashPointer = { x: 0, y: 0, tx: 0, ty: 0 };
var vesperSplashMoon = { x: 0, y: 0, r: 34, sprite: null };

// 月牙先画在一张小画布上（整圆减去错开的圆），再贴到夜空里，不会擦掉后面的星星
function vesperSplashMoonSprite(r, ratio) {
  var size = Math.ceil(r * 2 + 4);
  var c = document.createElement('canvas');
  c.width = Math.ceil(size * ratio);
  c.height = Math.ceil(size * ratio);
  var g = c.getContext('2d');
  g.scale(ratio, ratio);
  var cx = size / 2, cy = size / 2;
  g.fillStyle = '#f6efe2';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(cx + r * 0.5, cy - r * 0.38, r * 0.84, 0, Math.PI * 2);
  g.fill();
  return { canvas: c, size: size };
}

// 月亮放在字标正上方：按字标的实际位置算，窗口大小变了也对得上
function vesperSplashPlaceMoon() {
  var word = document.getElementById('splash-wordmark');
  var rect = word ? word.getBoundingClientRect() : null;
  var r = Math.max(24, Math.min(42, splashH * 0.045));
  vesperSplashMoon.r = r;
  vesperSplashMoon.x = rect && rect.width ? rect.left + rect.width / 2 : splashW / 2;
  vesperSplashMoon.y = rect && rect.height ? rect.top - r * 1.9 : splashH * 0.38;
  vesperSplashMoon.sprite = vesperSplashMoonSprite(r, splashPixelRatio);
}

function vesperSplashSeed(count) {
  var stars = [];
  for (var i = 0; i < count; i++) {
    var depth = Math.random();
    stars.push({
      x: Math.random(),
      y: Math.random() * 0.92,
      r: 0.35 + depth * 1.15,
      a: 0.18 + depth * 0.62,
      depth: depth,
      speed: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2
    });
  }
  return stars;
}

(function initVesperSplashCanvas() {
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  splashCtx = splashCanvas.getContext('2d');
  function resize() {
    splashPixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    vesperSplashStars = vesperSplashSeed(reduceSplashMotion ? 90 : 240);
    vesperSplashPlaceMoon();
  }
  resize();
  // 字体加载完字标宽度会变，再对一次月亮的位置
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(vesperSplashPlaceMoon);
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', function (e) {
    vesperSplashPointer.tx = (e.clientX / Math.max(1, splashW) - 0.5) * 2;
    vesperSplashPointer.ty = (e.clientY / Math.max(1, splashH) - 0.5) * 2;
  }, { passive: true });
  drawVesperSplash();
})();

function drawVesperFourPointStar(ctx, x, y, size, alpha) {
  if (alpha <= 0.002) return;
  var glow = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
  glow.addColorStop(0, 'rgba(255,244,222,' + (0.34 * alpha) + ')');
  glow.addColorStop(1, 'rgba(255,244,222,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, size * 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,248,236,' + alpha + ')';
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.9);
  ctx.quadraticCurveTo(x + size * 0.22, y - size * 0.22, x + size * 1.9, y);
  ctx.quadraticCurveTo(x + size * 0.22, y + size * 0.22, x, y + size * 1.9);
  ctx.quadraticCurveTo(x - size * 0.22, y + size * 0.22, x - size * 1.9, y);
  ctx.quadraticCurveTo(x - size * 0.22, y - size * 0.22, x, y - size * 1.9);
  ctx.fill();
}

function drawVesperSplash() {
  if (!splashAnimating || !splashCtx) return;
  var ctx = splashCtx;
  var t = (performance.now() - splashStartedAt) / 1000;
  var p = vesperSplashPointer;
  p.x += (p.tx - p.x) * 0.04;
  p.y += (p.ty - p.y) * 0.04;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, splashW, splashH);

  // 地平线上一层极淡的暮色
  var dusk = ctx.createLinearGradient(0, splashH * 0.55, 0, splashH);
  dusk.addColorStop(0, 'rgba(18,22,40,0)');
  dusk.addColorStop(1, 'rgba(26,30,52,' + (0.55 * splashSmoothstep(0, 1.6, t)) + ')');
  ctx.fillStyle = dusk;
  ctx.fillRect(0, 0, splashW, splashH);

  // 星星：越近的越亮、跟鼠标视差越大
  var starsIn = splashSmoothstep(0.05, 1.2, t);
  for (var i = 0; i < vesperSplashStars.length; i++) {
    var s = vesperSplashStars[i];
    var tw = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
    var a = s.a * tw * starsIn;
    if (a < 0.01) continue;
    var x = s.x * splashW - p.x * 14 * s.depth;
    var y = s.y * splashH - p.y * 9 * s.depth;
    ctx.fillStyle = 'rgba(235,238,255,' + a + ')';
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 新月：从下方升起，停在字标上方
  var rise = splashEaseOutCubic(splashClamp01((t - 0.15) / 1.35));
  var moon = vesperSplashMoon;
  var mr = moon.r;
  var mx = moon.x - p.x * 6;
  var my = moon.y + (1 - rise) * mr * 1.4 - p.y * 4;
  ctx.save();
  ctx.globalAlpha = rise;
  var halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
  halo.addColorStop(0, 'rgba(255,236,200,0.09)');
  halo.addColorStop(1, 'rgba(255,236,200,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 4, 0, Math.PI * 2);
  ctx.fill();
  if (moon.sprite) {
    var half = moon.sprite.size / 2;
    ctx.drawImage(moon.sprite.canvas, mx - half, my - half, moon.sprite.size, moon.sprite.size);
  }
  ctx.restore();

  // 晚星：月牙缺口外侧，最后亮起并缓慢呼吸
  var starOn = splashSmoothstep(0.95, 1.55, t);
  var breathe = 0.82 + 0.18 * Math.sin(t * 2.1);
  drawVesperFourPointStar(ctx, mx + mr * 0.95, my - mr * 0.92, mr * 0.2, starOn * breathe);

  requestAnimationFrame(drawVesperSplash);
}

// 开场音效：两个音（E5、B5）轻轻敲一下，像远处的风铃
function playVesperIntroSound() {
  if (splashSoundPlayed) return;
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    splashAudioCtx = splashAudioCtx || new Ctx();
    var ctx = splashAudioCtx;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    if (ctx.state !== 'running') return;
    splashSoundPlayed = true;
    var master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    var now = ctx.currentTime + 0.02;
    [[659.25, 0], [987.77, 0.16]].forEach(function (note) {
      [1, 2.01].forEach(function (mult, k) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = note[0] * mult;
        var start = now + note[1];
        var peak = k === 0 ? 0.9 : 0.16;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (k === 0 ? 2.4 : 0.9));
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + 2.5);
      });
    });
  } catch (e) { }
}

function armSplashSoundFallback() {
  if (splashSoundFallbackArmed) return;
  splashSoundFallbackArmed = true;
  function unlock() {
    if (!splashSoundPlayed) playVesperIntroSound();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

function finishSplashReveal(forceLoad, opts) {
  opts = opts || {};
  markAppPerf('home-revealed');
  if (typeof resumeSavedGestureControl === 'function') {
    setTimeout(function () { resumeSavedGestureControl(opts.reason || 'splash-reveal'); }, opts.fastSkip ? 120 : 260);
  }
  // Never make the renderer's visibility depend on the next animation frame.
  // The desktop HWND may already be in its native handoff at this point.
  releaseStartupFastSkipPreload();
  requestAnimationFrame(function () {
    var homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
      homeSuppressed = false;
      homeForcedOpen = true;
      homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    }
    requestAnimationFrame(function () {
      markStartupHomeReadyForAutoplay(opts.reason || 'splash', opts.fastSkip ? 240 : 100);
      var guideStarted = maybeRunStartupVisualGuide('splash');
      if (!guideStarted && !hasAnyPlatformLogin()) maybeRunStartupLoginGuide('splash');
      else if (!guideStarted && !homeShown) maybeRunStartupLoginGuide('splash');
      setTimeout(maybeShowUploadTipOnce, 5200);
    });
  });
}

function dismissSplash(opts) {
  opts = opts || {};
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  var instant = !!opts.instant;
  markAppPerf(instant ? 'splash-skip' : 'splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  setTimeout(stopSplashIntroSound, instant ? 0 : 240);
  if (instant) {
    s.classList.add('hide');
    s.style.display = 'none';
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    revealIdleParticles(0, 520);
    finishSplashReveal(true, { fastSkip: true, reason: 'fast-skip' });
    return;
  }
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, reduceSplashMotion ? 520 : 920);
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.transition = 'opacity 360ms cubic-bezier(.22,1,.36,1), transform 520ms cubic-bezier(.22,1,.36,1)';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-10px) scale(.992)';
  }

  setTimeout(function () {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    if (s && s.parentNode) s.style.display = 'none';
    finishSplashReveal(true, { reason: 'splash-dismiss' });
  }, 620);
}

function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
  s.setAttribute('role', 'button');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', '点击进入 Vesper');
}

document.addEventListener('DOMContentLoaded', function () {
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  if (startupFastSkipPreference) {
    dismissSplash({ instant: true });
    return;
  }
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playVesperIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  if (reduceSplashMotion) {
    s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, 650);
    return;
  }
  playVesperIntroSound();
  splashTimer = setTimeout(markSplashReadyToEnter, 1500);
});
