// 歌词意象在现有 Three.js 场景中绘制：一个 draw call，固定 756 个点，不另外创建渲染器。
// 动画与音频时间一致；轻量状态巡检 4 Hz，真正的动画 uniform 由现有舞台渲染帧更新。
(function () {
  'use strict';
  var core = window.VesperImageryCore;
  if (!core || typeof THREE === 'undefined' || typeof scene === 'undefined') return;
  var KEY = 'vesper-lyric-imagery-v1';
  var enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) { }
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var button, caption, cloud, material;
  var timer = 0, stopped = false, failed = false;
  var lastLines = null, lastToken = null, timeline = core.buildTimeline([]), lastCaption = '';
  var active = false, renderedTime = 0, currentSample = core.sampleTimeline(timeline, 0);

  function playbackTime() {
    var time = typeof audio !== 'undefined' && audio ? Number(audio.currentTime) || 0 : 0;
    return typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(time) : time;
  }
  function stageActive() {
    return enabled && !failed && !document.hidden && !stopped &&
      !document.body.classList.contains('empty-home-active') &&
      !document.body.classList.contains('splash-active') &&
      typeof audio !== 'undefined' && audio && !audio.ended &&
      typeof lyricsLines !== 'undefined' && lyricsLines && lyricsLines.length;
  }
  function syncTimeline() {
    var lines = typeof lyricsLines !== 'undefined' ? lyricsLines : null;
    var token = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
    // 换歌先于新歌词返回时，不把旧歌词误配给新音频。
    if (lastToken !== null && token !== lastToken && lines === lastLines) {
      lastToken = token;
      timeline = core.buildTimeline([]);
      return;
    }
    if (lines !== lastLines || token !== lastToken) {
      lastLines = lines;
      lastToken = token;
      timeline = core.buildTimeline(lines);
    }
  }
  function syncButton() {
    if (!button) return;
    button.setAttribute('aria-pressed', String(enabled));
    button.title = '歌词意象：' + (enabled ? '已开启，点击关闭' : '已关闭，点击开启');
    button.setAttribute('aria-label', button.title);
  }
  function syncCaption(sample) {
    if (!caption) return;
    var labels = active ? core.keys.filter(function (key) { return sample.levels[key] > 0.08; }) : [];
    var signature = labels.map(function (key) { return key + ':' + sample.labels[key]; }).join('|');
    caption.hidden = !signature;
    if (signature === lastCaption) return;
    lastCaption = signature;
    caption.replaceChildren();
    labels.forEach(function (key) {
      var tag = document.createElement('span');
      tag.style.setProperty('--imagery-color', core.kinds[key].color);
      tag.textContent = sample.labels[key];
      tag.title = '歌词意象：' + core.kinds[key].name;
      caption.appendChild(tag);
    });
  }
  function stopAfterError(error) {
    failed = true;
    active = false;
    if (cloud) cloud.visible = false;
    if (caption) caption.hidden = true;
    console.warn('[VesperImagery] Visual layer disabled:', error);
    if (button) {
      button.disabled = true;
      button.title = '歌词意象暂不可用，音乐播放不受影响';
    }
  }

  var vertexShader = [
    'attribute vec3 aSeed;', 'attribute float aKind;',
    'uniform float uTime;', 'uniform float uLevels[8];',
    'uniform vec2 uViewport;', 'uniform float uDpr;',
    'uniform float uBass;', 'uniform float uPulse;', 'uniform float uEnergy;',
    'varying float vKind;', 'varying float vAlpha;', 'varying vec3 vColor;',
    'void main() {',
    ' float k = aKind; vec3 s = aSeed; float t = uTime;',
    ' vec2 p = s.xy * 2.0 - 1.0; float size = 6.0; float a = 0.0;',
    ' vKind = k;',
    ' if (k < 0.5) {',
    '   a = uLevels[0]; vColor = vec3(.62,.80,1.);',
    '   p.y = 1.2 - mod(s.y * 2.4 + t * (.6 + .3*s.z), 2.4);',
    '   p.x += p.y * .08; size = 20.0 + s.z * 12.0;',
    ' } else if (k < 1.5) {',
    '   a = uLevels[1]; vColor = vec3(.91,.95,1.);',
    '   p.y = 1.15 - mod(s.y * 2.3 + t * (.07 + .08*s.z), 2.3);',
    '   p.x += sin(t * .5 + s.z * 20.0) * .05; size = 3.0 + s.z * 6.0;',
    ' } else if (k < 2.5) {',
    '   a = uLevels[2] * (.6 + .22*sin(t+s.z*30.) + .18*uPulse); vColor = vec3(1.,.85,.54);',
    '   p.y = .15 + s.y*.84; size = 3.0 + s.z*7.0;',
    ' } else if (k < 3.5) {',
    '   a = uLevels[3]; vColor = vec3(.37,.83,.81);',
    '   p.x = s.x*2.4-1.2; p.y = -.45 - s.y*.5;',
    '   p.y += sin(s.x*22. + s.y*12. - t*.8)*(.018+.025*uBass)*(1.-s.y);',
    '   size = 2.0 + s.y * 3.0;',
    ' } else if (k < 4.5) {',
    '   a = uLevels[4]; vColor = vec3(.72,.94,.85);',
    '   p.x = mod(s.x*2.4+t*(.18+s.z*.2),2.4)-1.2;',
    '   p.y += sin(t*.7+s.z*12.)*.06; size = 38.0+s.z*22.0;',
    ' } else if (k < 5.5) {',
    '   a = uLevels[5]; vColor = vec3(1.,.95,.79);',
    '   p = vec2(uViewport.x < 600. ? .55 : .68, .62); size = min(uViewport.x*.14, 105.);',
    ' } else if (k < 6.5) {',
    '   a = uLevels[6]; vColor = vec3(1.,.70,.36);',
    '   p.y = mod(s.y*2.4+t*(.06+s.z*.1),2.4)-1.2;',
    '   p.x += sin(t*.3+s.z*20.)*.07; size = 7.0+s.z*12.0;',
    ' } else {',
    '   a = uLevels[7]; vColor = vec3(1.,.62,.77);',
    '   p.y = 1.2-mod(s.y*2.4+t*(.07+s.z*.1),2.4);',
    '   p.x += sin(t*.7+s.z*15.)*.12; size = 6.0+s.z*8.0;',
    ' }',
    // 视野空间的点层让不同镜头/手机横竖屏下的意象都留在可见范围，并降低中央歌词区亮度。
    ' float centerFade = mix(.32, 1., smoothstep(.12,.65,length(p)));',
    ' vAlpha = a * centerFade * (.65+.15*uEnergy);',
    ' gl_Position = vec4(p, .99, 1.);',
    ' gl_PointSize = min(128., size*uDpr);',
    ' if (a < .001) gl_Position = vec4(3.,3.,.99,1.);',
    '}'
  ].join('\n');
  var fragmentShader = [
    // Three.js 为顶点/片元同时注入同一精度；不要单独改片元精度，否则共享 uniform 无法链接。
    'uniform float uTime;',
    'varying float vKind;', 'varying float vAlpha;', 'varying vec3 vColor;',
    'void main() {',
    ' vec2 p = gl_PointCoord - .5; float d = length(p); float a;',
    ' if (vKind < .5) {',
    '   a = (1.-smoothstep(.012,.035,abs(p.x+p.y*.15)))*(1.-smoothstep(.28,.5,abs(p.y)));',
    ' } else if (vKind < 1.5) { a = 1.-smoothstep(.12,.48,d);',
    ' } else if (vKind < 2.5) {',
    '   a = max(1.-smoothstep(.03,.12,d), (1.-smoothstep(.02,.045,min(abs(p.x),abs(p.y))))*(1.-smoothstep(.15,.48,d))*.6);',
    ' } else if (vKind < 3.5) { a = 1.-smoothstep(.1,.48,d);',
    ' } else if (vKind < 4.5) {',
    '   a = (1.-smoothstep(.009,.022,abs(p.y)))*(1.-smoothstep(.2,.5,abs(p.x)))*.7;',
    ' } else if (vKind < 5.5) {',
    '   a = (1.-smoothstep(.30,.32,d))*.62 + (1.-smoothstep(.32,.49,d))*.13;',
    '   a *= .92 + .08*sin(p.x*53.)*sin(p.y*37.);',
    ' } else if (vKind < 6.5) { a = pow(max(0.,1.-d*2.),2.);',
    ' } else {',
    '   float angle = uTime*.45; p = mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;',
    '   a = 1.-smoothstep(.7,1.,length(p/vec2(.22,.43)));',
    ' }',
    ' if (a*vAlpha < .005) discard;',
    ' gl_FragColor = vec4(vColor, a*vAlpha);',
    '}'
  ].join('\n');

  function createCloud() {
    if (cloud) return;
    var counts = [180, 90, 110, 200, 45, 1, 65, 65];
    var count = counts.reduce(function (a, b) { return a + b; }, 0);
    var seed = new Float32Array(count * 3), kind = new Float32Array(count);
    var position = new Float32Array(count * 3), cursor = 0;
    // 固定采样，不随换歌创建几何体或贴图。
    counts.forEach(function (n, type) {
      for (var i = 0; i < n; i++, cursor++) {
        seed[cursor * 3] = ((i * 0.61803398875 + type * .17) % 1);
        seed[cursor * 3 + 1] = ((i * 0.38196601125 + i * i * .0137) % 1);
        seed[cursor * 3 + 2] = ((i * 0.754877666 + .31) % 1);
        kind[cursor] = type;
      }
    });
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uLevels: { value: new Float32Array(8) },
        uViewport: { value: new THREE.Vector2(innerWidth, innerHeight) }, uDpr: { value: 1 },
        uBass: { value: 0 }, uPulse: { value: 0 }, uEnergy: { value: 0 }
      },
      vertexShader: vertexShader, fragmentShader: fragmentShader
    });
    cloud = new THREE.Points(geometry, material);
    cloud.name = 'vesper-lyric-imagery';
    cloud.frustumCulled = false;
    cloud.renderOrder = -100;
    cloud.visible = false;
    cloud.onBeforeRender = function (renderer) {
      try {
        if (!stageActive()) { material.uniforms.uLevels.value.fill(0); return; }
        syncTimeline();
        var t = playbackTime();
        currentSample = core.sampleTimeline(timeline, t);
        core.keys.forEach(function (key, index) { material.uniforms.uLevels.value[index] = currentSample.levels[key]; });
        if (!reducedMotion.matches) renderedTime = t;
        material.uniforms.uTime.value = reducedMotion.matches ? 0 : renderedTime;
        material.uniforms.uViewport.value.set(innerWidth, innerHeight);
        material.uniforms.uDpr.value = Math.min(1.5, renderer.getPixelRatio());
        var animate = !reducedMotion.matches && audio && !audio.paused;
        material.uniforms.uBass.value = animate && typeof bass !== 'undefined' ? bass : 0;
        material.uniforms.uPulse.value = animate && typeof beatPulse !== 'undefined' ? beatPulse : 0;
        material.uniforms.uEnergy.value = animate && typeof audioEnergy !== 'undefined' ? audioEnergy : 0;
      } catch (error) { stopAfterError(error); }
    };
    scene.add(cloud);
  }

  function inspect() {
    clearTimeout(timer);
    timer = 0;
    try {
      syncTimeline();
      active = !!stageActive();
      currentSample = core.sampleTimeline(timeline, playbackTime());
      var visible = active && core.keys.some(function (key) { return currentSample.levels[key] > .001; });
      if (visible) createCloud();
      if (cloud) cloud.visible = visible;
      syncCaption(currentSample);
    } catch (error) { stopAfterError(error); }
    // 关闭、后台或卸载期间完全停止巡检，由用户操作/可见性事件唤醒。
    if (enabled && !failed && !document.hidden && !stopped) timer = setTimeout(inspect, 250);
  }
  function setEnabled(value) {
    enabled = !!value;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) { }
    syncButton();
    inspect();
    if (typeof showToast === 'function') showToast(enabled ? '歌词意象已开启' : '歌词意象已关闭');
  }
  function init() {
    button = document.getElementById('vesper-imagery-btn');
    caption = document.getElementById('vesper-imagery-caption');
    if (button) button.addEventListener('click', function () { setEnabled(!enabled); });
    syncButton();
    document.addEventListener('visibilitychange', inspect);
    window.addEventListener('pagehide', function () { stopped = true; inspect(); });
    window.addEventListener('pageshow', function () { stopped = false; inspect(); });
    window.addEventListener('storage', function (event) {
      if (event.key === KEY) { enabled = event.newValue !== 'off'; syncButton(); inspect(); }
    });
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', inspect);
    new MutationObserver(inspect).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    inspect();
  }
  window.vesperImagery = {
    setEnabled: setEnabled,
    snapshot: function () {
      return { enabled: enabled, active: active, reducedMotion: reducedMotion.matches, failed: failed,
        visible: !!(cloud && cloud.visible), levels: Object.assign({}, currentSample.levels),
        cueCount: timeline.cues.length, particleCount: cloud ? cloud.geometry.getAttribute('aKind').count : 0 };
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
