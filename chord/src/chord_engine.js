// 和弦声音引擎：4 个上方声部 + 1 个低音声部
// 接口：start / setChord / setGate / setTimbre / setVolume / setVibrato / setBass / setReverb
//
// 信号流：
//   每个声部 2 个微失谐振荡器 → 声部增益(电钢的逐音衰减包络) ─┬→ 共振峰组（合唱“啊”）─┐
//                                                          └→ 低通（Pad/风琴/电钢）─┼→ 门包络 → 音量 → 限幅 → 输出
//   低音声部 → 独立低通 ─────────────────────────────────────────────────────────┘        └→ 混响
// 共振峰滤波是线性的，所以 4 个声部可以共用一组，省算力

export const TIMBRES = {
  choir: { label: '合唱“啊”' },
  strings: { label: '弦乐 Pad' },
  organ: { label: '风琴' },
  epiano: { label: '电钢琴（逐音扫弦）' },
};

// 每种音色的参数：wave 声源；formant 是否走共振峰；lp 低通；det 失谐音分；vib 颤音比例；
// atk/rel 门包络时间常数（秒）；pluck 是否逐音衰减
const PATCH = {
  choir: { wave: 'glottal', formant: 1, lp: 5000, det: 7, vib: 1, atk: 0.07, rel: 0.14, pluck: false, lvl: 1.0 },
  strings: { wave: 'saw', formant: 0, lp: 2200, det: 9, vib: 0.4, atk: 0.16, rel: 0.3, pluck: false, lvl: 0.55 },
  organ: { wave: 'organ', formant: 0, lp: 7000, det: 3, vib: 0, atk: 0.006, rel: 0.03, pluck: false, lvl: 0.5 },
  epiano: { wave: 'epiano', formant: 0, lp: 4200, det: 4, vib: 0, atk: 0.002, rel: 0.25, pluck: true, lvl: 1.1 },
};

// 合唱“啊”：女中音 a 的共振峰（Csound 歌唱共振峰表）
const CHOIR_A = { f: [800, 1150, 2800, 3500, 4950], a: [0, -4, -20, -36, -60], b: [80, 90, 120, 130, 140] };

export const NV = 4; // 上方声部数
const UPPER_GAIN = 0.2;
const BASS_GAIN = 0.32;

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function wave(ctx, amps) {
  const N = amps.length;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) imag[n] = amps[n];
  return ctx.createPeriodicWave(real, imag);
}

function makeWaves(ctx) {
  const glottal = [0];
  const saw = [0];
  for (let n = 1; n < 80; n++) { glottal.push(1 / Math.pow(n, 1.1)); saw.push(1 / n); }
  // 风琴拉杆 8' 4' 2⅔' 2' 1⅗' 1'：基频 + 2/3/4/5/8 次谐波
  const organ = new Array(17).fill(0);
  organ[1] = 1; organ[2] = 0.7; organ[3] = 0.45; organ[4] = 0.35; organ[5] = 0.12; organ[8] = 0.18; organ[16] = 0.05;
  // 电钢：近正弦，带一点 2/3 次谐波和高位“金属”泛音
  const ep = new Array(16).fill(0);
  ep[1] = 1; ep[2] = 0.28; ep[3] = 0.1; ep[4] = 0.05; ep[7] = 0.03; ep[14] = 0.02;
  return { glottal: wave(ctx, glottal), saw: wave(ctx, saw), organ: wave(ctx, organ), epiano: wave(ctx, ep) };
}

export class ChordEngine {
  constructor() {
    this.ctx = null;
    this.timbre = 'choir';
    this.volume = 0.8;
    this.glide = 0.03;
    this.vibrato = 14;
    this.bassOn = true;
    this.reverb = 0.25;
    this.gateOn = false;
    this.notes = [];
    this.bass = null;
  }

  async start(ctxOverride = null) {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = ctxOverride || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.waves = makeWaves(ctx);

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

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this.reverb;
    const conv = ctx.createConvolver();
    conv.buffer = this._impulse(2.2);
    this.master.connect(this.reverbSend).connect(conv).connect(this.limiter);

    // 共振峰组（合唱用）
    this.formantIn = ctx.createGain();
    this.formantOut = ctx.createGain();
    this.formantOut.connect(this.env);
    CHOIR_A.f.forEach((f, k) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = f / CHOIR_A.b[k];
      const g = ctx.createGain();
      const tilt = Math.pow(f / 500, 0.8);
      g.gain.value = Math.pow(10, CHOIR_A.a[k] / 20) * Math.sqrt(f / CHOIR_A.b[k]) * 0.9 * tilt;
      this.formantIn.connect(bp).connect(g).connect(this.formantOut);
    });

    // 低通组（其他音色）
    this.toneIn = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.6;
    this.toneOut = ctx.createGain();
    this.toneIn.connect(this.lp).connect(this.toneOut).connect(this.env);

    // 低音：独立低通，任何音色下都给和声“托底”
    this.bassLP = ctx.createBiquadFilter();
    this.bassLP.type = 'lowpass';
    this.bassLP.frequency.value = 700;
    this.bassLP.Q.value = 0.5;
    this.bassOut = ctx.createGain();
    this.bassLP.connect(this.bassOut).connect(this.env);

    // 声部
    const rates = [5.1, 5.6, 4.8, 5.9, 5.3];
    this.voices = [];
    for (let k = 0; k <= NV; k++) {
      const isBass = k === NV;
      const vg = ctx.createGain();
      vg.gain.value = 1;
      const lvl = ctx.createGain();
      lvl.gain.value = isBass ? BASS_GAIN : UPPER_GAIN;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rates[k];
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfo.start();
      const oscs = [0, 1].map((j) => {
        const o = ctx.createOscillator();
        o.frequency.value = 220;
        lfoGain.connect(o.detune);
        const og = ctx.createGain();
        og.gain.value = 0.5;
        o.connect(og).connect(vg);
        o.start();
        return o;
      });
      vg.connect(lvl);
      let toF = null;
      let toT = null;
      if (isBass) {
        lvl.connect(this.bassLP);
      } else {
        toF = ctx.createGain();
        toT = ctx.createGain();
        lvl.connect(toF).connect(this.formantIn);
        lvl.connect(toT).connect(this.toneIn);
      }
      this.voices.push({ oscs, vg, lvl, lfoGain, toF, toT, isBass, midi: null });
    }
    this._applyTimbre(true);
    if (!ctxOverride) await ctx.resume();
  }

  _impulse(seconds) {
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

  get patch() {
    return PATCH[this.timbre];
  }

  setTimbre(t) {
    if (!PATCH[t]) return;
    this.timbre = t;
    this._applyTimbre();
  }

  _applyTimbre(immediate = false) {
    if (!this.ctx) return;
    const p = this.patch;
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.001 : 0.05;
    const w = this.waves[p.wave];
    for (const v of this.voices) {
      v.oscs[0].setPeriodicWave(w);
      v.oscs[1].setPeriodicWave(w);
      v.oscs[0].detune.setTargetAtTime(-p.det / 2, t, tc);
      v.oscs[1].detune.setTargetAtTime(p.det / 2, t, tc);
      if (!v.isBass) {
        v.toF.gain.setTargetAtTime(p.formant ? 1 : 0, t, tc);
        v.toT.gain.setTargetAtTime(p.formant ? 0 : 1, t, tc);
      }
      if (!p.pluck) v.vg.gain.setTargetAtTime(1, t, tc);
    }
    this.toneOut.gain.setTargetAtTime(p.lvl, t, tc);
    this.lp.frequency.setTargetAtTime(p.lp, t, tc);
    this._applyVibrato();
    this._applyBass();
  }

  setVibrato(cents) {
    this.vibrato = cents;
    this._applyVibrato();
  }

  _applyVibrato() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.lfoGain.gain.setTargetAtTime(v.isBass ? 0 : this.vibrato * this.patch.vib, t, 0.15);
  }

  setBass(on) {
    this.bassOn = on;
    this._applyBass();
  }

  _applyBass() {
    if (!this.ctx) return;
    this.bassOut.gain.setTargetAtTime(this.bassOn ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setReverb(v) {
    this.reverb = v;
    if (this.reverbSend) this.reverbSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // upper: 4 个 midi（低→高）；bass: midi 或 null；jump: 新起音（不滑音）；changed: 和弦换了（电钢重新扫弦）
  setChord(upper, bass, { jump = false, changed = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const list = [...upper, bass];
    const pluck = this.patch.pluck && (changed || jump);
    this.voices.forEach((v, k) => {
      const m = list[k];
      if (m == null) return;
      const hz = midiToHz(m);
      for (const o of v.oscs) {
        if (jump || this.patch.pluck) {
          o.frequency.cancelScheduledValues(t);
          o.frequency.setValueAtTime(hz, t + (pluck ? this._strum(k) : 0));
        } else {
          o.frequency.setTargetAtTime(hz, t, this.glide);
        }
      }
      if (pluck) {
        // 从低音到高音依次拨响（约 14ms 间隔），之后衰减到持续电平
        const t0 = t + this._strum(k);
        v.vg.gain.cancelScheduledValues(t);
        v.vg.gain.setTargetAtTime(0, t, 0.004);
        v.vg.gain.setTargetAtTime(1, t0, 0.003);
        v.vg.gain.setTargetAtTime(0.22, t0 + 0.02, 0.7);
      }
      v.midi = m;
    });
    this.notes = upper.slice();
    this.bass = bass;
  }

  _strum(k) {
    // 低音最先，上方声部从低到高。每个声部先压到 0（4ms）再换音高，避免换音时的“咔”声
    return k === NV ? 0.01 : 0.022 + k * 0.014;
  }

  setGate(on, level = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = this.patch;
    if (on) this.env.gain.setTargetAtTime(level, t, this.gateOn ? 0.05 : p.atk);
    else this.env.gain.setTargetAtTime(0, t, p.rel);
    this.gateOn = on;
  }
}
