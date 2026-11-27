'use strict';

// Original, deterministic demo music. No recordings, samples or online services
// are used. Only these three short mono WAV files can enter the in-memory cache.
const SAMPLE_RATE = 22050;
const PREFIX = '/api/vesper/demo';
const DEFINITIONS = [
  {
    id: 'vesper-demo-rain', name: '雨窗', bpm: 76, root: 50, seed: 17,
    chords: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [-2, 2, 5, 9]],
    palette: ['#12212d', '#8ebed6', '#efbd7d'],
    lines: ['雨落在窗前', '灯火把夜色轻轻照亮', '风吹过安静的街', '星光停在你的肩上', '把脚步交给缓慢的鼓点', '让这一刻慢慢流淌'],
  },
  {
    id: 'vesper-demo-sea', name: '月海', bpm: 80, root: 48, seed: 53,
    chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]],
    palette: ['#102e32', '#77c7c3', '#e8e1a7'],
    lines: ['月亮升起在海面', '海浪轻轻拍着岸', '风把远方带到身旁', '星空落进一盏灯', '晚安留在最后一拍', '让回声慢慢走远'],
  },
  {
    id: 'vesper-demo-snow', name: '春雪', bpm: 84, root: 53, seed: 91,
    chords: [[0, 4, 7, 11], [5, 9, 12, 16], [4, 7, 11, 14], [9, 12, 16, 19]],
    palette: ['#282238', '#e6dced', '#df9ebf'],
    lines: ['雪花落在掌心', '春天的花悄悄盛开', '风穿过树梢的星光', '月光照着回家的路', '我们把灯火留给夜晚', '听一场温柔的雨'],
  },
];

const WAV_CACHE = new Map();
const byId = new Map(DEFINITIONS.map((item) => [item.id, item]));
const sampleCount = (item) => Math.floor(48 * 60 / item.bpm * SAMPLE_RATE);
const durationOf = (item) => sampleCount(item) / SAMPLE_RATE;
const wavSize = (item) => 44 + sampleCount(item) * 2;

function stamp(seconds) {
  const hundredths = Math.round(seconds * 100);
  return '[' + String(Math.floor(hundredths / 6000)).padStart(2, '0') + ':' +
    String(Math.floor(hundredths / 100) % 60).padStart(2, '0') + '.' + String(hundredths % 100).padStart(2, '0') + ']';
}

function demoBeatMap(item) {
  const gridStep = 60 / item.bpm;
  // The synthesizer below places a kick on quarter-note slots 0 and 2, and a
  // snare on slots 1 and 3. Use that same clock instead of analyzing this WAV.
  const beats = Array.from({ length: 48 }, (_, index) => {
    const kick = index % 2 === 0;
    return {
      time: index * gridStep, step: gridStep, index,
      strength: kick ? 0.62 : 0.35, impact: kick ? 0.58 : 0.28,
      confidence: 1, primary: kick, camera: kick, pulse: kick, grid: true,
      low: kick ? 0.74 : 0.18, body: kick ? 0.23 : 0.48, snap: kick ? 0.10 : 0.34,
      mass: kick ? 0.64 : 0.24, sharpness: kick ? 0.12 : 0.34,
      combo: index % 4 === 0 ? 'downbeat' : (kick ? 'drop' : 'rebound'),
    };
  });
  const cameraBeats = beats.filter((beat) => beat.camera);
  return {
    source: 'vesper-demo-v1', tempoSource: 'synthetic-grid', analysisProfile: 'vesper-demo-lofi',
    bpm: item.bpm, gridStep, duration: durationOf(item),
    beats, cameraBeats, pulseBeats: cameraBeats, kicks: cameraBeats.map((beat) => beat.time),
    visualBeatCount: cameraBeats.length, partial: false,
  };
}

function demoSongs() {
  return DEFINITIONS.map((item) => ({
    id: item.id, localKey: item.id, type: 'local', source: 'local', provider: 'local',
    name: item.name, title: item.name, artist: 'Vesper 本机合成', album: 'Vesper 离线演示',
    duration: durationOf(item), localUrl: PREFIX + '/audio/' + item.id + '.wav',
    cover: PREFIX + '/cover/' + item.id + '.svg',
    lyric: item.lines.map((line, i) => stamp(i * 8 * 60 / item.bpm) + line).join('\n') + '\n' + stamp(durationOf(item)),
    demo: true, demoBeatMap: demoBeatMap(item),
  }));
}

function synthesize(item) {
  const n = sampleCount(item);
  const pcm = new Float32Array(n);
  const beatSeconds = 60 / item.bpm;
  const twoPi = 2 * Math.PI;
  const midi = (note) => 440 * Math.pow(2, (note - 69) / 12);
  const chordFreqs = item.chords.map((notes) => notes.map((note) => midi(item.root + note + 12)));
  const bassFreqs = item.chords.map((notes) => midi(item.root + notes[0] - 12));
  const melodyNotes = [0, 7, 12, 3, 10, 7, 5, 3, 0, 3, 7, 10, 14, 12, 7, 5];
  const melodyFreqs = melodyNotes.map((note) => midi(item.root + note + 24));
  let seed = item.seed >>> 0, previousNoise = 0;

  for (let i = 0; i < n; i++) {
    const time = i / SAMPLE_RATE;
    const beat = time / beatSeconds;
    const beatIndex = Math.floor(beat);
    const chordIndex = Math.floor(beat / 4) % 4;
    const beatAge = (beat - beatIndex) * beatSeconds;
    const chordAge = (beat % 2) * beatSeconds;
    const chordEnvelope = Math.min(1, chordAge / 0.012) * Math.exp(-chordAge * 2.2);
    let value = 0;
    for (const frequency of chordFreqs[chordIndex]) {
      const phase = twoPi * frequency * time;
      value += (Math.sin(phase) + 0.18 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3)) * chordEnvelope * 0.055;
    }
    const bassEnvelope = Math.min(1, beatAge / 0.01) * Math.exp(-beatAge * 3.5);
    const bassPhase = twoPi * bassFreqs[chordIndex] * time;
    value += (Math.sin(bassPhase) + 0.12 * Math.sin(bassPhase * 2)) * bassEnvelope * 0.18;

    // A quiet pentatonic-like bell melody with intentional rests.
    const halfBeat = Math.floor(beat * 2);
    if (halfBeat % 4 !== 3) {
      const age = (beat * 2 - halfBeat) * beatSeconds / 2;
      value += Math.sin(twoPi * melodyFreqs[halfBeat % melodyFreqs.length] * age) * Math.min(1, age / 0.008) * Math.exp(-age * 10) * 0.055;
    }
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const highNoise = noise - previousNoise;
    previousNoise = noise;
    if (beatIndex % 4 === 0 || beatIndex % 4 === 2) {
      // Integrated falling-frequency phase keeps the kick continuous.
      const phase = twoPi * (45 * beatAge + 4 * (1 - Math.exp(-beatAge * 24)));
      value += Math.sin(phase) * Math.exp(-beatAge * 15) * 0.30;
    } else {
      value += noise * Math.exp(-beatAge * 29) * 0.09;
    }
    const hatAge = (beat * 2 - halfBeat) * beatSeconds / 2;
    value += highNoise * Math.exp(-hatAge * 95) * (halfBeat % 2 ? 0.019 : 0.027);
    pcm[i] = value;
  }

  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24); buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(n * 2, 40);
  const echo = Math.floor(beatSeconds * 0.75 * SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const dry = pcm[i] + (i >= echo ? pcm[i - echo] * 0.16 : 0) + (i >= echo * 2 ? pcm[i - echo * 2] * 0.06 : 0);
    const fade = Math.min(1, i / (SAMPLE_RATE * 0.025), (n - i - 1) / (SAMPLE_RATE * 0.45));
    buffer.writeInt16LE(Math.round(Math.tanh(dry * 1.2) * 24575 * fade), 44 + i * 2);
  }
  return buffer;
}

function waveFor(item) {
  if (!WAV_CACHE.has(item.id)) WAV_CACHE.set(item.id, synthesize(item));
  return WAV_CACHE.get(item.id);
}

function coverFor(item) {
  const [background, ink, accent] = item.palette;
  const seed = item.seed;
  let marks = '';
  for (let i = 0; i < 14; i++) {
    const x = 30 + (i * 47 + seed) % 340;
    const y = 30 + (i * 73 + seed * 2) % 240;
    marks += `<circle cx="${x}" cy="${y}" r="${i % 4 + 1}" fill="${ink}" opacity=".45"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${background}"/><circle cx="248" cy="147" r="86" fill="${ink}" opacity=".20"/><circle cx="270" cy="125" r="77" fill="${background}"/>${marks}<path d="M0 265Q85 205 185 267T400 255V400H0Z" fill="${ink}" opacity=".24"/><path d="M0 303Q110 246 210 304T400 291" fill="none" stroke="${accent}" stroke-width="2" opacity=".65"/><text x="32" y="350" fill="${ink}" font-family="sans-serif" font-size="30" letter-spacing="8">${item.name}</text><text x="34" y="377" fill="${accent}" font-family="sans-serif" font-size="10" letter-spacing="3">VESPER · LOCAL DEMO</text></svg>`;
}

function rangeFor(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

function createDemoRoutes({ sendJSON }) {
  return function handleDemoRoute(pn, req, res) {
    if (pn !== PREFIX && !pn.startsWith(PREFIX + '/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true;
    }
    if (pn === PREFIX) {
      if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(); }
      else sendJSON(res, { songs: demoSongs(), description: 'Vesper 原创程序合成演示音乐；歌词为视觉演示文本，音频不含人声。' });
      return true;
    }
    const match = /^\/api\/vesper\/demo\/(audio|cover)\/([a-z0-9-]+)\.(wav|svg)$/.exec(pn);
    const item = match && byId.get(match[2]);
    if (!item || (match[1] === 'audio' ? match[3] !== 'wav' : match[3] !== 'svg')) {
      sendJSON(res, { error: 'DEMO_NOT_FOUND' }, 404); return true;
    }
    if (match[1] === 'cover') {
      const svg = Buffer.from(coverFor(item));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Length': svg.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : svg); return true;
    }
    const size = wavSize(item);
    const range = rangeFor(req.headers.range, size);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }); res.end(); return true;
    }
    const headers = { 'Content-Type': 'audio/wav', 'Content-Length': range.end - range.start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    res.writeHead(range.partial ? 206 : 200, headers);
    res.end(req.method === 'HEAD' ? undefined : waveFor(item).subarray(range.start, range.end + 1));
    return true;
  };
}

module.exports = { createDemoRoutes, demoSongs };
