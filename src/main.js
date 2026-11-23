import { HandTracker, handFeatures, HAND_EDGES } from './hand.js';
import { VoiceEngine, VOICES, VOWEL_AXIS } from './voice.js';
import { SCALES, NOTE_NAMES, Quantizer, scaleNotes, midiToHz, midiName, midiSolfege } from './music.js';
import { OneEuro } from './filters.js';

// ---------------- 设置 ----------------
const DEFAULTS = {
  voice: 'soprano', choir: true, vowelMode: 'fixed', vibrato: 18, volume: 0.8,
  scale: 'pentatonic', key: 0, low: 60, span: 24, snap: 0.85, glide: 35,
  gateMode: 'open', gateTh: 1.4, second: 'volume', mainHand: 'right', follow: 1.5,
  top: 0.12, bottom: 0.12, camAlpha: 0.35, debug: false,
};
const STORE_KEY = 'hm_settings_v1';
const S = { ...DEFAULTS, ...safeLoad() };

function safeLoad() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* 隐私模式忽略 */ }
}

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const g = canvas.getContext('2d');
const video = $('cam');

const voice = new VoiceEngine();
const tracker = new HandTracker();
const quant = new Quantizer();
const fY = new OneEuro({ minCutoff: S.follow, beta: 4 });
const fX = new OneEuro({ minCutoff: 1.0, beta: 2 });
const fVol = new OneEuro({ minCutoff: 1.0, beta: 2 });

// ---------------- 设置面板绑定 ----------------
function fillSelect(el, entries) {
  el.innerHTML = entries.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
}
fillSelect($('s_voice'), Object.entries(VOICES).map(([k, v]) => [k, v.label]));
fillSelect($('s_scale'), Object.entries(SCALES).map(([k, v]) => [k, v.label]));
fillSelect($('s_key'), NOTE_NAMES.map((n, i) => [i, n]));

const fmt = {
  vibrato: (v) => `${v} 音分`, volume: (v) => `${Math.round(v * 100)}%`,
  low: (v) => midiName(v), span: (v) => `${v} 半音`, snap: (v) => `${Math.round(v * 100)}%`,
  glide: (v) => `${v} ms`, gateTh: (v) => (+v).toFixed(2), follow: (v) => (+v).toFixed(1),
  top: (v) => `${Math.round(v * 100)}%`, bottom: (v) => `${Math.round(v * 100)}%`,
  camAlpha: (v) => `${Math.round(v * 100)}%`,
};

function applySetting(k) {
  switch (k) {
    case 'voice': voice.setVoice(S.voice); break;
    case 'choir': voice.setChoir(S.choir); break;
    case 'volume': voice.setVolume(S.volume); break;
    case 'glide': voice.glide = S.glide / 1000 / 3; break;
    case 'follow': fY.minCutoff = S.follow; break;
    case 'vowelMode': if (S.vowelMode === 'fixed') voice.setVowel(VOWEL_AXIS.indexOf('a') / (VOWEL_AXIS.length - 1)); break;
    case 'scale': case 'key': quant.reset(); break;
    default: break;
  }
}

for (const k of Object.keys(DEFAULTS)) {
  const el = $('s_' + k);
  if (!el) continue;
  const isBool = el.type === 'checkbox';
  const isNum = el.type === 'range' || k === 'key';
  if (isBool) el.checked = !!S[k];
  else el.value = S[k];
  const out = $('v_' + k);
  if (out) out.textContent = fmt[k] ? fmt[k](S[k]) : S[k];
  el.addEventListener(isBool ? 'change' : 'input', () => {
    S[k] = isBool ? el.checked : isNum ? +el.value : el.value;
    if (out) out.textContent = fmt[k] ? fmt[k](S[k]) : S[k];
    if (k === 'voice') {
      // 切换声部时同步推荐音域
      S.low = VOICES[S.voice].low;
      S.span = VOICES[S.voice].span;
      $('s_low').value = S.low; $('v_low').textContent = fmt.low(S.low);
      $('s_span').value = S.span; $('v_span').textContent = fmt.span(S.span);
    }
    applySetting(k);
    save();
  });
}

$('gearBtn').onclick = () => $('panel').classList.add('open');
$('closePanel').onclick = () => $('panel').classList.remove('open');

// ---------------- 画布尺寸 ----------------
let W = 0;
let H = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// 视频 cover 适配 + 镜像（前置摄像头）
function coverRect() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s;
  const dh = vh * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh };
}
function toScreen(p, r) {
  return { x: W - (r.ox + p.x * r.dw), y: r.oy + p.y * r.dh };
}

// 屏幕 y <-> 音高（u: 0 底 ~ 1 顶）
function yToU(sy) {
  const h = H * (1 - S.top - S.bottom);
  return Math.min(1, Math.max(0, 1 - (sy - H * S.top) / h));
}
function midiToY(m) {
  const u = (m - S.low) / S.span;
  return H * (S.top + (1 - u) * (1 - S.top - S.bottom));
}

// ---------------- 触摸兜底（没摄像头也能试声音） ----------------
const pointer = { active: false, y: 0, x: 0 };
const stage = $('stage');
stage.addEventListener('pointerdown', (e) => { pointer.active = true; pointer.x = e.clientX; pointer.y = e.clientY; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', (e) => { if (pointer.active) { pointer.x = e.clientX; pointer.y = e.clientY; } });
const endPointer = () => { pointer.active = false; };
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// ---------------- 运行状态 ----------------
const st = {
  hands: [],          // 屏幕坐标下的手（用于绘制）
  mainIdx: -1,
  lastHandT: -1e9,
  gate: false,
  open: false,
  midi: S.low + S.span / 2,
  rawMidi: S.low + S.span / 2,
  level: 1,
  trail: [],
  lastVideoTime: -1,
  inferMs: 0,
  detCount: 0,
  detFps: 0,
  fpsT: 0,
  stillSince: 0,
  lastMidiForVib: 0,
  vibOn: false,
  feat: null,
  source: '-',
};

function processDetections(landmarks) {
  st.hands = [];
  st.mainIdx = -1;
  if (!landmarks || landmarks.length === 0) return null;
  const r = coverRect();
  const hands = landmarks.map((lm) => {
    const f = handFeatures(lm);
    const pts = lm.map((p) => toScreen(p, r));
    const palm = toScreen({ x: f.x, y: f.y }, r);
    return { f, pts, palm };
  });
  // 选音高手：按屏幕左右
  let main = 0;
  if (hands.length > 1) {
    const rightFirst = S.mainHand === 'right';
    main = (hands[0].palm.x > hands[1].palm.x) === rightFirst ? 0 : 1;
  }
  st.hands = hands;
  st.mainIdx = main;
  const second = hands.length > 1 ? hands[1 - main] : null;
  return { main: hands[main], second };
}

function updateControl(nowMs) {
  const tSec = nowMs / 1000;
  let have = false;
  let u = null;
  let vowelX = 0.5;
  let open = false;
  let level = 1;

  if (st.detected) {
    const { main, second } = st.detected;
    st.detected = null;
    st.lastHandT = nowMs;
    have = true;
    u = fY.filter(yToU(main.palm.y), tSec);
    vowelX = fX.filter(Math.min(1, Math.max(0, main.palm.x / W)), tSec);
    st.feat = main.f;
    // 握拳/张开滞回
    const th = S.gateTh;
    if (st.open) open = main.f.openness > th - 0.08;
    else open = main.f.openness > th + 0.08;
    if (S.gateMode === 'always') open = true;
    if (second && S.second === 'volume') {
      const v = fVol.filter(yToU(second.palm.y), tSec);
      level = 0.12 + 0.88 * v;
    }
    st.source = '手';
    st.uLast = u;
    st.vowelLast = vowelX;
    st.levelLast = level;
  } else if (nowMs - st.lastHandT < 160 && st.uLast !== undefined) {
    // 短暂丢帧：保持上一状态，避免断音
    have = true;
    u = st.uLast;
    vowelX = st.vowelLast;
    open = st.open;
    level = st.levelLast ?? 1;
  } else if (pointer.active) {
    have = true;
    u = fY.filter(yToU(pointer.y), tSec);
    vowelX = fX.filter(pointer.x / W, tSec);
    open = true;
    st.source = '触摸';
  } else {
    fY.reset(); fX.reset(); fVol.reset();
    st.uLast = undefined;
    st.source = '-';
  }

  const wasGate = st.gate;
  st.open = open;
  st.gate = have && open;

  if (have) {
    st.rawMidi = S.low + u * S.span;
    const notes = S.scale === 'free' ? null : scaleNotes(S.scale, S.key, S.low - 1, S.low + S.span + 1);
    st.midi = quant.process(st.rawMidi, notes, S.scale === 'free' ? 0 : S.snap);
  }
  const hz = midiToHz(st.midi);

  if (st.gate && !wasGate) voice.jumpPitch(hz);
  else voice.setPitch(hz);
  if (S.vowelMode === 'x' && have) voice.setVowel(vowelX);
  voice.setGate(st.gate, level);
  st.level = level;

  // 颤音：音高稳定 250ms 后再进来，移动时撤掉（模仿真人）
  if (Math.abs(st.midi - st.lastMidiForVib) > 0.25) {
    st.stillSince = nowMs;
    st.lastMidiForVib = st.midi;
  }
  const wantVib = st.gate && nowMs - st.stillSince > 250;
  if (wantVib !== st.vibOn) {
    voice.setVibrato(wantVib ? S.vibrato : 0);
    st.vibOn = wantVib;
  }

  st.trail.push({ t: nowMs, m: st.midi, on: st.gate });
  while (st.trail.length && nowMs - st.trail[0].t > 3500) st.trail.shift();
}

// ---------------- 绘制 ----------------
const C = { bg: '#141e1d', line: '#2b3b39', root: '#2f6f62', accent: '#2f9c86', accentH: '#4bad97', text: '#dcece8', sub: '#a4b5b0', dim: '#6f817c' };

function draw(nowMs) {
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);

  if (video.readyState >= 2 && S.camAlpha > 0) {
    const r = coverRect();
    g.save();
    g.globalAlpha = S.camAlpha;
    g.translate(W, 0);
    g.scale(-1, 1);
    g.drawImage(video, r.ox, r.oy, r.dw, r.dh);
    g.restore();
  }

  // 音高刻度线
  const lineNotes = S.scale === 'free'
    ? scaleNotes('chromatic', 0, S.low, S.low + S.span)
    : scaleNotes(S.scale, S.key, S.low, S.low + S.span);
  g.font = '11px ui-monospace, Consolas, monospace';
  g.textBaseline = 'middle';
  const cur = Math.round(st.midi);
  for (const m of lineNotes) {
    const y = midiToY(m);
    const isRoot = (((m - S.key) % 12) + 12) % 12 === 0;
    const isCur = st.gate && m === cur && S.scale !== 'free';
    g.strokeStyle = isCur ? C.accent : isRoot ? C.root : C.line;
    g.lineWidth = isCur ? 2 : 1;
    g.beginPath();
    g.moveTo(54, y);
    g.lineTo(W, y);
    g.stroke();
    if (S.scale !== 'free' || m % 12 === 0) {
      g.fillStyle = isCur ? C.text : isRoot ? C.sub : C.dim;
      g.fillText(midiName(m), 10, y);
    }
  }

  // 音高轨迹（向左滚动）
  const headX = W * 0.8;
  const pxPerMs = (W * 0.75) / 3500;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 1; i < st.trail.length; i++) {
    const a = st.trail[i - 1];
    const b = st.trail[i];
    if (!a.on || !b.on) continue;
    g.strokeStyle = C.accent;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(headX - (nowMs - a.t) * pxPerMs, midiToY(a.m));
    g.lineTo(headX - (nowMs - b.t) * pxPerMs, midiToY(b.m));
    g.stroke();
  }
  const hy = midiToY(st.midi);
  g.beginPath();
  g.arc(headX, hy, st.gate ? 9 + 3 * st.level : 7, 0, Math.PI * 2);
  if (st.gate) { g.fillStyle = C.accentH; g.fill(); }
  else { g.strokeStyle = C.dim; g.lineWidth = 2; g.stroke(); }

  // 手骨架
  st.hands.forEach((h, idx) => {
    const isMain = idx === st.mainIdx;
    g.strokeStyle = isMain ? 'rgba(75,173,151,0.85)' : 'rgba(164,181,176,0.55)';
    g.lineWidth = 2;
    for (const [a, b] of HAND_EDGES) {
      g.beginPath();
      g.moveTo(h.pts[a].x, h.pts[a].y);
      g.lineTo(h.pts[b].x, h.pts[b].y);
      g.stroke();
    }
    g.fillStyle = isMain ? C.text : C.sub;
    for (const p of h.pts) { g.beginPath(); g.arc(p.x, p.y, 2.5, 0, Math.PI * 2); g.fill(); }
    if (isMain) {
      g.beginPath();
      g.arc(h.palm.x, h.palm.y, 7, 0, Math.PI * 2);
      g.strokeStyle = st.gate ? C.accentH : C.dim;
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([4, 5]);
      g.beginPath();
      g.moveTo(h.palm.x, h.palm.y);
      g.lineTo(headX, hy);
      g.strokeStyle = 'rgba(47,156,134,0.35)';
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
    }
    if (S.debug) {
      g.fillStyle = C.text;
      g.fillText(`open ${h.f.openness.toFixed(2)}  fingers ${h.f.fingers}`, h.palm.x + 12, h.palm.y - 14);
    }
  });
}

// ---------------- HUD ----------------
const noteEl = $('note');
const noteSub = $('noteSub');
const statsEl = $('stats');
let hudT = 0;
function updateHud(nowMs) {
  if (nowMs - hudT < 80) return;
  hudT = nowMs;
  const vowelCh = { u: '呜', o: '喔', a: '啊', e: '诶', i: '咿' };
  const vi = S.vowelMode === 'fixed' ? 'a' : VOWEL_AXIS[Math.round(voice.vowelPos * (VOWEL_AXIS.length - 1))];
  if (st.gate) {
    const name = midiName(st.midi);
    const cents = Math.round((st.midi - Math.round(st.midi)) * 100);
    noteEl.innerHTML = `${name}<small>${midiSolfege(st.midi, S.key)} · ${vowelCh[vi]}</small>`;
    noteSub.textContent = `${midiToHz(st.midi).toFixed(1)} Hz` + (Math.abs(cents) > 3 ? `  ${cents > 0 ? '+' : ''}${cents}¢` : '');
  } else {
    noteEl.innerHTML = `--<small></small>`;
    noteSub.textContent = st.hands.length ? '张开手掌开始唱' : '举起手掌开始唱';
  }
  const lines = [
    `识别 ${st.detFps} fps · ${st.inferMs.toFixed(1)} ms`,
    `引擎 ${tracker.engineName}/${tracker.delegate} · ${video.videoWidth || 0}x${video.videoHeight || 0}`,
    `音频输出延迟 ${voice.latencyMs.toFixed(0)} ms`,
    `输入 ${st.source}`,
  ];
  if (S.debug && st.feat) lines.push(`张开度 ${st.feat.openness.toFixed(2)} (阈 ${S.gateTh.toFixed(2)})`);
  statsEl.textContent = lines.join('\n');
}

// ---------------- 主循环 ----------------
// 用 requestVideoFrameCallback 精确感知“新的一帧”，避免对同一帧重复推理（手机上省电省算力）
let frameReady = false;
const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
function armRVFC() {
  video.requestVideoFrameCallback(() => { frameReady = true; armRVFC(); });
}

let busy = false;
function frame() {
  const now = performance.now();
  const isNew = hasRVFC ? frameReady : video.currentTime !== st.lastVideoTime;
  if (tracker.ready && !busy && video.readyState >= 2 && isNew) {
    frameReady = false;
    st.lastVideoTime = video.currentTime;
    busy = true;
    const t0 = performance.now();
    tracker.process(video, t0)
      .then((landmarks) => {
        const dt = performance.now() - t0;
        st.inferMs = st.inferMs * 0.9 + dt * 0.1;
        st.detCount++;
        const d = processDetections(landmarks);
        if (d) st.detected = d;
      })
      .catch((e) => console.warn(e))
      .finally(() => { busy = false; });
  }
  if (now - st.fpsT > 1000) {
    st.detFps = st.detCount;
    st.detCount = 0;
    st.fpsT = now;
  }
  updateControl(now);
  draw(now);
  updateHud(now);
  requestAnimationFrame(frame);
}

// ---------------- 启动 ----------------
const statusEl = $('status');
function status(msg, err = false) {
  statusEl.textContent = msg;
  statusEl.className = err ? 'err' : '';
}

async function startCamera() {
  if (!window.isSecureContext) throw new Error('摄像头需要 HTTPS 或 localhost 访问');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头接口');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();
  if (hasRVFC) armRVFC();
}

$('startBtn').onclick = async () => {
  const btn = $('startBtn');
  btn.disabled = true;
  try {
    // iOS：让声音不受静音键影响（Safari 16.4+）
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch { /* ignore */ } }
    status('启动声音引擎…');
    await voice.start();
    for (const k of Object.keys(DEFAULTS)) applySetting(k);
  } catch (e) {
    status('声音引擎启动失败：' + e.message, true);
    btn.disabled = false;
    return;
  }

  let camOk = true;
  try {
    status('请求摄像头权限…');
    await startCamera();
  } catch (e) {
    camOk = false;
    status(`摄像头不可用（${e.message}），已切换为触摸模式`, true);
  }

  if (camOk) {
    try {
      await tracker.init(status);
    } catch (e) {
      status('手部识别加载失败：' + e.message + '（可先用触摸模式）', true);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
  $('intro').style.display = 'none';
  requestAnimationFrame(frame);
};

// 切回前台时恢复音频
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && voice.ctx && voice.ctx.state !== 'running') voice.ctx.resume();
});
