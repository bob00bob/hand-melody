import { HandTracker, handFeatures, HAND_EDGES } from '../../src/hand.js';
import { Quantizer } from '../../src/music.js';
import { OneEuro } from '../../src/filters.js';
import { ChordEngine, TIMBRES } from './chord_engine.js';
import { MODES, PRESETS, KEY_NAMES, resolveChord, voiceChord, bassMidi, slotShort, keyName, midiLabel, mod12 } from './harmony.js';

// ---------------- 设置 ----------------
const DEFAULTS = {
  key: 0, mode: 'major', preset: 'basic', range: 7, voicing: 'smooth', center: 64, bass: true,
  timbre: 'choir', vibrato: 14, glide: 40, reverb: 0.25, volume: 0.8,
  gateMode: 'open', gateTh: 1.4, second: 'volume', mainHand: 'right', hyst: 0.2, follow: 1.5,
  top: 0.12, bottom: 0.26, camAlpha: 0.35, debug: false,
};
const STORE_KEY = 'hh_settings_v1';
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

const engine = new ChordEngine();
const tracker = new HandTracker();
const quant = new Quantizer();
const fY = new OneEuro({ minCutoff: S.follow, beta: 4 });
const fVol = new OneEuro({ minCutoff: 1.0, beta: 2 });

// ---------------- 设置面板 ----------------
function fillSelect(el, entries) {
  el.innerHTML = entries.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
}
fillSelect($('s_key'), KEY_NAMES.map((n, i) => [i, n]));
fillSelect($('s_mode'), Object.entries(MODES).map(([k, v]) => [k, v.label]));
fillSelect($('s_preset'), Object.entries(PRESETS).map(([k, v]) => [k, v.label]));
fillSelect($('s_timbre'), Object.entries(TIMBRES).map(([k, v]) => [k, v.label]));

const fmt = {
  center: (v) => midiLabel(v, 0, 'major'), vibrato: (v) => `${v} 音分`, glide: (v) => `${v} ms`,
  reverb: (v) => `${Math.round(v * 100)}%`, volume: (v) => `${Math.round(v * 100)}%`,
  gateTh: (v) => (+v).toFixed(2), hyst: (v) => (+v).toFixed(2), follow: (v) => (+v).toFixed(1),
  top: (v) => `${Math.round(v * 100)}%`, bottom: (v) => `${Math.round(v * 100)}%`,
  camAlpha: (v) => `${Math.round(v * 100)}%`,
};
const NUMERIC = new Set(['key', 'range']);

function applySetting(k) {
  switch (k) {
    case 'timbre': engine.setTimbre(S.timbre); break;
    case 'vibrato': engine.setVibrato(S.vibrato); break;
    case 'glide': engine.glide = S.glide / 1000 / 3; break;
    case 'reverb': engine.setReverb(S.reverb); break;
    case 'volume': engine.setVolume(S.volume); break;
    case 'bass': engine.setBass(S.bass); break;
    case 'follow': fY.minCutoff = S.follow; break;
    case 'preset': renderChips(); break;
    case 'key': case 'mode': case 'voicing': case 'center': case 'range':
      st.prevVoicing = null; st.chordId = null; quant.reset(); renderChips(); break;
    default: break;
  }
}

for (const k of Object.keys(DEFAULTS)) {
  const el = $('s_' + k);
  if (!el) continue;
  const isBool = el.type === 'checkbox';
  const isNum = el.type === 'range' || NUMERIC.has(k);
  if (isBool) el.checked = !!S[k];
  else el.value = S[k];
  const out = $('v_' + k);
  if (out) out.textContent = fmt[k] ? fmt[k](S[k]) : S[k];
  el.addEventListener(isBool ? 'change' : 'input', () => {
    S[k] = isBool ? el.checked : isNum ? +el.value : el.value;
    if (out) out.textContent = fmt[k] ? fmt[k](S[k]) : S[k];
    applySetting(k);
    save();
  });
}

$('gearBtn').onclick = () => $('panel').classList.add('open');
$('closePanel').onclick = () => $('panel').classList.remove('open');

// ---------------- 和弦性质色块（显示手指对照 + 可点选） ----------------
const chipsEl = $('chips');
const FINGER_TAG = ['拳', '1 指', '2 指', '3 指', '4 指', '5 指'];
function renderChips() {
  const map = PRESETS[S.preset].map;
  chipsEl.innerHTML = map.map((slot, i) => `<button data-i="${i}"><i>${FINGER_TAG[i]}</i>${slotShort(slot)}</button>`).join('');
  markChips();
}
function markChips() {
  [...chipsEl.children].forEach((b, i) => b.classList.toggle('on', i === st.qIdx));
}
chipsEl.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault();
  st.chipIdx = +b.dataset.i;
});

// ---------------- 画布 ----------------
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

// 屏幕 y <-> u（0 底 ~ 1 顶）
const bandTop = () => H * S.top;
const bandBottom = () => H * (1 - S.bottom);
function yToU(sy) {
  return Math.min(1, Math.max(0, (bandBottom() - sy) / (bandBottom() - bandTop())));
}
function uToY(u) {
  return bandBottom() - u * (bandBottom() - bandTop());
}

// ---------------- 触摸兜底 ----------------
const pointer = { active: false, y: 0, x: 0 };
const stage = $('stage');
stage.addEventListener('pointerdown', (e) => { pointer.active = true; pointer.x = e.clientX; pointer.y = e.clientY; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', (e) => { if (pointer.active) { pointer.x = e.clientX; pointer.y = e.clientY; } });
const endPointer = () => { pointer.active = false; };
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// 键盘（桌面调试）：0~5 选性质
window.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '5') st.chipIdx = +e.key;
});

// ---------------- 运行状态 ----------------
const st = {
  hands: [],
  mainIdx: -1,
  lastHandT: -1e9,
  lastSecondT: -1e9,
  gate: false,
  open: false,
  u: 0.5,
  deg: 0,
  level: 1,
  qIdx: 0,          // 实际生效的性质序号 0~5
  leftIdx: null,    // 左手给出的序号（null = 没有左手）
  chipIdx: 0,       // 色块 / 键盘选的序号（没有左手时用）
  fingerCand: -1,
  fingerSince: 0,
  chord: null,
  chordId: null,
  prevVoicing: null,
  voicing: [],
  bassNote: null,
  trail: [],
  lastVideoTime: -1,
  inferMs: 0,
  detCount: 0,
  detFps: 0,
  fpsT: 0,
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
  let main = 0;
  if (hands.length > 1) {
    const rightFirst = S.mainHand === 'right';
    main = (hands[0].palm.x > hands[1].palm.x) === rightFirst ? 0 : 1;
  }
  st.hands = hands;
  st.mainIdx = main;
  return { main: hands[main], second: hands.length > 1 ? hands[1 - main] : null };
}

function degreeCount() {
  return +S.range === 8 ? 8 : 7;
}

function updateControl(nowMs) {
  const tSec = nowMs / 1000;
  let have = false;
  let u = null;
  let open = false;
  let level = 1;

  if (st.detected) {
    const { main, second } = st.detected;
    st.detected = null;
    st.lastHandT = nowMs;
    have = true;
    u = fY.filter(yToU(main.palm.y), tSec);
    st.feat = main.f;
    const th = S.gateTh;
    open = st.open ? main.f.openness > th - 0.08 : main.f.openness > th + 0.08;
    if (S.gateMode === 'always') open = true;
    if (second) {
      st.lastSecondT = nowMs;
      if (S.second === 'volume') level = 0.25 + 0.75 * fVol.filter(yToU(second.palm.y), tSec);
      // 手指数保持 120ms 不变才生效，避免换手势过程中闪过中间的和弦
      const n = second.f.fingers;
      if (n !== st.fingerCand) { st.fingerCand = n; st.fingerSince = nowMs; }
      else if (nowMs - st.fingerSince >= 120) st.leftIdx = n;
    }
    st.source = '手';
    st.uLast = u;
    st.levelLast = level;
  } else if (nowMs - st.lastHandT < 160 && st.uLast !== undefined) {
    have = true;
    u = st.uLast;
    open = st.open;
    level = st.levelLast ?? 1;
  } else if (pointer.active) {
    have = true;
    u = fY.filter(yToU(pointer.y), tSec);
    open = true;
    st.source = '触摸';
  } else {
    fY.reset(); fVol.reset();
    st.uLast = undefined;
    st.source = '-';
  }
  // 左手消失 300ms 以上 → 回到色块 / 键盘选择
  if (nowMs - st.lastSecondT > 300) { st.leftIdx = null; st.fingerCand = -1; fVol.reset(); }

  const qIdx = st.leftIdx ?? st.chipIdx;
  if (qIdx !== st.qIdx) { st.qIdx = qIdx; markChips(); }

  const wasGate = st.gate;
  st.open = open;
  st.gate = have && open;

  if (have) {
    st.u = u;
    const n = degreeCount();
    const levels = Array.from({ length: n }, (_, i) => i);
    st.deg = quant.process(u * n - 0.5, levels, 1, S.hyst);
  }

  const slot = PRESETS[S.preset].map[st.qIdx];
  const chord = resolveChord(st.deg, slot, S.key, S.mode);
  const changed = chord.id !== st.chordId;
  const jump = st.gate && !wasGate;
  if (changed) {
    st.chord = chord;
    st.chordId = chord.id;
    st.voicing = voiceChord(chord, st.prevVoicing, { center: S.center, mode: S.voicing, key: S.key });
    st.prevVoicing = st.voicing;
    st.bassNote = bassMidi(chord, S.key);
  }
  if (changed || jump) engine.setChord(st.voicing, st.bassNote, { jump, changed: changed && st.gate });
  engine.setGate(st.gate, level);
  st.level = level;

  if (changed && st.gate) st.trail.push({ t: nowMs, deg: st.deg, label: chord.roman });
  while (st.trail.length && nowMs - st.trail[0].t > 6000) st.trail.shift();
}

// ---------------- 绘制 ----------------
const C = { bg: '#141e1d', line: '#2b3b39', root: '#2f6f62', accent: '#2f9c86', accentH: '#4bad97', text: '#dcece8', sub: '#a4b5b0', dim: '#6f817c', key: '#c9d6d2', keyDark: '#1a2423' };

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

  // 级数色带：从下到上 I ~ VII，每条显示“当前左手性质下”这一级会响的和弦
  const n = degreeCount();
  const top = bandTop();
  const bot = bandBottom();
  const bh = (bot - top) / n;
  const slot = PRESETS[S.preset].map[st.qIdx];
  for (let d = 0; d < n; d++) {
    const y1 = bot - (d + 1) * bh;
    const c = resolveChord(d, slot, S.key, S.mode);
    const cur = d === st.deg;
    if (cur) {
      g.fillStyle = st.gate ? 'rgba(47,156,134,0.20)' : 'rgba(47,156,134,0.08)';
      g.fillRect(0, y1, W, bh);
    }
    g.strokeStyle = d % 7 === 0 ? C.root : C.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y1 + bh);
    g.lineTo(W, y1 + bh);
    g.stroke();
    g.textBaseline = 'middle';
    g.font = `${cur ? 500 : 400} ${Math.min(22, bh * 0.42)}px system-ui, -apple-system, sans-serif`;
    g.fillStyle = cur ? C.text : C.sub;
    g.fillText(c.roman, 14, y1 + bh / 2);
    g.font = `${Math.min(14, bh * 0.3)}px system-ui, -apple-system, sans-serif`;
    g.fillStyle = cur ? C.accentH : c.diatonic ? C.dim : '#8a7f6a';
    g.fillText(c.symbol, 84, y1 + bh / 2);
  }
  g.strokeStyle = C.line;
  g.beginPath();
  g.moveTo(0, top);
  g.lineTo(W, top);
  g.stroke();

  // 右侧指示点：手的连续高度
  const mx = W * 0.86;
  const my = uToY(st.u);
  g.beginPath();
  g.arc(mx, my, st.gate ? 9 + 3 * st.level : 7, 0, Math.PI * 2);
  if (st.gate) { g.fillStyle = C.accentH; g.fill(); }
  else { g.strokeStyle = C.dim; g.lineWidth = 2; g.stroke(); }

  // 最近的和弦进行（色带下方，从右往左排，越旧越淡）
  g.font = '13px system-ui, -apple-system, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  let tx = W - 14;
  for (let i = st.trail.length - 1; i >= 0 && tx > 40; i--) {
    const a = Math.max(0.25, 1 - (nowMs - st.trail[i].t) / 6000);
    g.fillStyle = `rgba(164,181,176,${a})`;
    const s = st.trail[i].label + (i < st.trail.length - 1 ? '  →' : '');
    g.fillText(s, tx, bot + 18);
    tx -= g.measureText(s + '  ').width;
  }
  g.textAlign = 'left';

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
      g.setLineDash([4, 5]);
      g.beginPath();
      g.moveTo(h.palm.x, h.palm.y);
      g.lineTo(mx, my);
      g.strokeStyle = 'rgba(47,156,134,0.35)';
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
    } else {
      const k = h.f.fingers;
      const label = `${k ? k + ' 指' : '握拳'} · ${slotShort(PRESETS[S.preset].map[k])}`;
      g.font = '15px system-ui, -apple-system, sans-serif';
      g.fillStyle = C.text;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, h.palm.x, h.palm.y - 70);
      g.textAlign = 'left';
    }
    if (S.debug) {
      g.font = '11px ui-monospace, Consolas, monospace';
      g.fillStyle = C.text;
      g.fillText(`open ${h.f.openness.toFixed(2)}  fingers ${h.f.fingers}`, h.palm.x + 12, h.palm.y - 14);
    }
  });

  drawKeyboard();
}

// 底部小键盘：上方声部亮青色，低音暗青色
function drawKeyboard() {
  const chipTop = chipsEl.getBoundingClientRect().top;
  const kh = 42;
  const ky = chipTop - kh - 10;
  const low = st.bassNote != null && st.bassNote < 36 ? 24 : 36;
  const high = 84;
  const whites = [];
  for (let m = low; m <= high; m++) if (![1, 3, 6, 8, 10].includes(mod12(m))) whites.push(m);
  const x0 = 12;
  const ww = (W - 24) / whites.length;
  const on = new Set(st.gate ? st.voicing : []);
  const bassOn = st.gate && S.bass ? st.bassNote : null;
  const fill = (m, base) => (on.has(m) ? C.accentH : m === bassOn ? C.root : base);
  whites.forEach((m, i) => {
    g.fillStyle = fill(m, 'rgba(201,214,210,0.16)');
    g.fillRect(x0 + i * ww + 0.5, ky, ww - 1, kh);
  });
  whites.forEach((m, i) => {
    if (m === high) return;
    const b = m + 1;
    if (![1, 3, 6, 8, 10].includes(mod12(b))) return;
    g.fillStyle = fill(b, C.keyDark);
    g.fillRect(x0 + (i + 1) * ww - ww * 0.3, ky, ww * 0.6, kh * 0.6);
  });
  // C 标记
  g.font = '9px ui-monospace, Consolas, monospace';
  g.fillStyle = C.dim;
  g.textBaseline = 'top';
  whites.forEach((m, i) => { if (mod12(m) === 0) g.fillText('C' + (m / 12 - 1), x0 + i * ww + 1, ky + kh + 2); });
}

// ---------------- HUD ----------------
const chordEl = $('chord');
const chordSub = $('chordSub');
const statsEl = $('stats');
let hudT = 0;
function updateHud(nowMs) {
  if (nowMs - hudT < 80) return;
  hudT = nowMs;
  const c = st.chord;
  if (st.gate && c) {
    const names = c.names.join(' ');
    chordEl.innerHTML = `${c.symbol}<small>${c.roman}</small>`;
    chordSub.textContent = `${c.quality.label} · ${names}`;
  } else {
    chordEl.innerHTML = `--<small></small>`;
    chordSub.textContent = st.hands.length ? '张开右手奏响' : `${keyName(S.key, S.mode)} ${MODES[S.mode].label.slice(0, 2)} · 举起右手开始`;
  }
  const lines = [
    `识别 ${st.detFps} fps · ${st.inferMs.toFixed(1)} ms`,
    `引擎 ${tracker.engineName}/${tracker.delegate} · ${video.videoWidth || 0}x${video.videoHeight || 0}`,
    `音频输出延迟 ${engine.latencyMs.toFixed(0)} ms`,
    `输入 ${st.source}${st.leftIdx != null ? ' · 左手' : ''}`,
  ];
  if (S.debug && st.voicing.length) lines.push(`声部 ${st.bassNote ?? '-'} | ${st.voicing.join(' ')}`);
  statsEl.textContent = lines.join('\n');
}

// ---------------- 主循环 ----------------
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
        st.inferMs = st.inferMs * 0.9 + (performance.now() - t0) * 0.1;
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

renderChips();

$('startBtn').onclick = async () => {
  const btn = $('startBtn');
  btn.disabled = true;
  try {
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch { /* ignore */ } }
    status('启动声音引擎…');
    await engine.start();
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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume();
});
