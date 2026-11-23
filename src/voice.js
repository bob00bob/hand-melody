// 人声引擎（方案 B：声门源 + 共振峰滤波）
// 接口刻意保持精简：start / setPitch / setVowel / setGate / setVibrato / setVolume
// 后续换成采样引擎时，只需实现同样的接口。

// 共振峰表（Csound 歌唱共振峰数据）：freq(Hz) / amp(dB) / bw(Hz)
const FORMANTS = {
  soprano: {
    a: { f: [800, 1150, 2900, 3900, 4950], a: [0, -6, -32, -20, -50], b: [80, 90, 120, 130, 140] },
    e: { f: [350, 2000, 2800, 3600, 4950], a: [0, -20, -15, -40, -56], b: [60, 100, 120, 150, 200] },
    i: { f: [270, 2140, 2950, 3900, 4950], a: [0, -12, -26, -26, -44], b: [60, 90, 100, 120, 120] },
    o: { f: [450, 800, 2830, 3800, 4950], a: [0, -11, -22, -22, -50], b: [70, 80, 100, 130, 135] },
    u: { f: [325, 700, 2700, 3800, 4950], a: [0, -16, -35, -40, -60], b: [50, 60, 170, 180, 200] },
  },
  alto: {
    a: { f: [800, 1150, 2800, 3500, 4950], a: [0, -4, -20, -36, -60], b: [80, 90, 120, 130, 140] },
    e: { f: [400, 1600, 2700, 3300, 4950], a: [0, -24, -30, -35, -60], b: [60, 80, 120, 150, 200] },
    i: { f: [350, 1700, 2700, 3700, 4950], a: [0, -20, -30, -36, -60], b: [50, 100, 120, 150, 200] },
    o: { f: [450, 800, 2830, 3500, 4950], a: [0, -9, -16, -28, -55], b: [70, 80, 100, 130, 135] },
    u: { f: [325, 700, 2530, 3500, 4950], a: [0, -12, -30, -40, -64], b: [50, 60, 170, 180, 200] },
  },
  tenor: {
    a: { f: [650, 1080, 2650, 2900, 3250], a: [0, -6, -7, -8, -22], b: [80, 90, 120, 130, 140] },
    e: { f: [400, 1700, 2600, 3200, 3580], a: [0, -14, -12, -14, -20], b: [70, 80, 100, 120, 120] },
    i: { f: [290, 1870, 2800, 3250, 3540], a: [0, -15, -18, -20, -30], b: [40, 90, 100, 120, 120] },
    o: { f: [400, 800, 2600, 2800, 3000], a: [0, -10, -12, -12, -26], b: [40, 80, 100, 120, 120] },
    u: { f: [350, 600, 2700, 2900, 3300], a: [0, -20, -17, -14, -26], b: [40, 60, 100, 120, 120] },
  },
  bass: {
    a: { f: [600, 1040, 2250, 2450, 2750], a: [0, -7, -9, -9, -20], b: [60, 70, 110, 120, 130] },
    e: { f: [400, 1620, 2400, 2800, 3100], a: [0, -12, -9, -12, -18], b: [40, 80, 100, 120, 120] },
    i: { f: [250, 1750, 2600, 3050, 3340], a: [0, -30, -16, -22, -28], b: [60, 90, 100, 120, 120] },
    o: { f: [400, 750, 2400, 2600, 2900], a: [0, -11, -21, -20, -40], b: [40, 80, 100, 120, 120] },
    u: { f: [350, 600, 2400, 2675, 2950], a: [0, -20, -32, -28, -36], b: [40, 80, 100, 120, 120] },
  },
};

// 元音连续轴：后元音 → 前元音（舌位从后到前），a 居中
export const VOWEL_AXIS = ['u', 'o', 'a', 'e', 'i'];

export const VOICES = {
  soprano: { label: '女高音', low: 60, span: 24 },
  alto: { label: '女中音', low: 55, span: 22 },
  tenor: { label: '男高音', low: 48, span: 22 },
  bass: { label: '男低音', low: 40, span: 22 },
};

const lerp = (a, b, t) => a + (b - a) * t;

// pos: 0~1 沿 VOWEL_AXIS 连续插值
function vowelAt(voice, pos) {
  const table = FORMANTS[voice];
  const x = Math.min(0.9999, Math.max(0, pos)) * (VOWEL_AXIS.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  const A = table[VOWEL_AXIS[i]];
  const B = table[VOWEL_AXIS[i + 1]];
  return {
    f: A.f.map((v, k) => Math.exp(lerp(Math.log(v), Math.log(B.f[k]), t))),
    a: A.a.map((v, k) => lerp(v, B.a[k], t)),
    b: A.b.map((v, k) => lerp(v, B.b[k], t)),
  };
}

function makeGlottalWave(ctx) {
  // 近似声门脉冲 + 唇辐射：谐波按 1/n^1.1 衰减，略暗于锯齿波
  const N = 80;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) imag[n] = 1 / Math.pow(n, 1.1);
  return ctx.createPeriodicWave(real, imag);
}

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export class VoiceEngine {
  constructor() {
    this.ctx = null;
    this.voice = 'soprano';
    this.vowelPos = 0.5;
    this.gateOn = false;
    this.volume = 0.8;
    this.glide = 0.035;
    this.choir = true;
  }

  // ctxOverride：测试时传入 OfflineAudioContext 做离线渲染
  async start(ctxOverride = null) {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = ctxOverride || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // 输出链：formant 合流 → 包络 → 音量 → 限幅 → 输出
    this.env = ctx.createGain();
    this.env.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.env.connect(this.master).connect(this.limiter).connect(ctx.destination);

    // 简易混响（短卷积）增加空间感
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    const conv = ctx.createConvolver();
    conv.buffer = this._makeImpulse(1.8);
    this.master.connect(this.reverbSend).connect(conv).connect(this.limiter);

    // 共振峰滤波组（并联带通）
    this.srcBus = ctx.createGain();
    this.formants = [];
    for (let k = 0; k < 5; k++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const g = ctx.createGain();
      this.srcBus.connect(bp).connect(g).connect(this.env);
      this.formants.push({ bp, g });
    }

    // 声门源：3 个轻微失谐的振荡器（合唱感），各自独立颤音
    const wave = makeGlottalWave(ctx);
    this.oscs = [];
    const detunes = [0, -9, 8];
    const rates = [5.4, 5.1, 5.8];
    for (let k = 0; k < 3; k++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = 440;
      osc.detune.value = detunes[k];
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rates[k];
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain).connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = k === 0 ? 0.6 : 0.3;
      osc.connect(g).connect(this.srcBus);
      osc.start();
      lfo.start();
      this.oscs.push({ osc, lfoGain, g });
    }

    // 气声：高通噪声进入共振峰组
    const noise = makeNoise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0.05;
    noise.connect(hp).connect(this.breath).connect(this.srcBus);
    noise.start();

    this._applyChoir();
    this._applyVowel(true);
    if (!ctxOverride) await ctx.resume();
  }

  _makeImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  get latencyMs() {
    if (!this.ctx) return 0;
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
  }

  setVoice(v) {
    if (!FORMANTS[v]) return;
    this.voice = v;
    this._applyVowel();
  }

  setChoir(on) {
    this.choir = on;
    this._applyChoir();
  }

  _applyChoir() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.oscs.forEach((o, k) => {
      if (k > 0) o.g.gain.setTargetAtTime(this.choir ? 0.3 : 0, t, 0.05);
    });
  }

  setPitch(hz) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(hz, t, this.glide);
    this._setF0(hz);
  }

  // 高音区基频超过 F1 时，真人歌手会把 F1 “调”到基频之上（formant tuning），否则声音发虚
  _setF0(hz) {
    const prev = this.f0 || 0;
    this.f0 = hz;
    if (Math.abs(prev - hz) / hz > 0.01) this._applyVowel();
  }

  // 直接跳到目标音高（新音符起音时用，避免从上一个音滑过来）
  jumpPitch(hz) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const o of this.oscs) {
      o.osc.frequency.cancelScheduledValues(t);
      o.osc.frequency.setValueAtTime(hz, t);
    }
    this._setF0(hz);
  }

  setVowel(pos) {
    this.vowelPos = pos;
    this._applyVowel();
  }

  _applyVowel(immediate = false) {
    if (!this.ctx) return;
    const v = vowelAt(this.voice, this.vowelPos);
    const f0 = this.f0 || 0;
    if (f0 * 1.1 > v.f[0]) v.f[0] = f0 * 1.1;
    if (v.f[0] * 1.35 > v.f[1]) v.f[1] = v.f[0] * 1.35;
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.001 : 0.04;
    this.formants.forEach((fm, k) => {
      fm.bp.frequency.setTargetAtTime(v.f[k], t, tc);
      fm.bp.Q.setTargetAtTime(v.f[k] / v.b[k], t, tc);
      // 带通峰值 0dB 但窄带会损失能量，用 Q 做补偿
      const comp = Math.sqrt(v.f[k] / v.b[k]) * 0.9;
      fm.g.gain.setTargetAtTime(Math.pow(10, v.a[k] / 20) * comp, t, tc);
    });
  }

  // 颤音深度（音分）
  setVibrato(cents) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const o of this.oscs) o.lfoGain.gain.setTargetAtTime(cents, t, 0.15);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setGate(on, level = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on) {
      this.env.gain.setTargetAtTime(level, t, this.gateOn ? 0.05 : 0.025);
      this.breath.gain.setTargetAtTime(0.05, t, 0.05);
    } else {
      this.env.gain.setTargetAtTime(0, t, 0.06);
    }
    this.gateOn = on;
  }
}
