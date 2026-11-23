// 离线渲染人声引擎：检查各音色 / 元音的电平、NaN，以及频谱重心（确认元音之间确实有区别）
// 用法：playwright-cli run-code "$(cat tests/audio_test.js)"（页面需先打开 http://localhost:8765/）
async page => {
  return await page.evaluate(async () => {
    const { VoiceEngine, vowelPos } = await import('/src/voice.js');
    const { midiToHz } = await import('/src/music.js');
    const sr = 48000;
    const cases = [
      ['voice', 'soprano', 67, 'a'], ['voice', 'soprano', 67, 'o'], ['voice', 'soprano', 67, 'u'],
      ['voice', 'soprano', 67, 'e'], ['voice', 'soprano', 67, 'i'], ['voice', 'soprano', 84, 'a'],
      ['voice', 'tenor', 50, 'a'], ['voice', 'bass', 40, 'o'],
      ['hum', 'soprano', 67, 'a'], ['hum', 'tenor', 50, 'a'],
      ['whistle', 'soprano', 67, 'a'], ['whistle', 'soprano', 84, 'a'],
      ['robot', 'soprano', 67, 'a'], ['robot', 'tenor', 50, 'i'],
    ];
    const out = [];
    for (const [timbre, voiceType, m, vow] of cases) {
      const ctx = new OfflineAudioContext(1, sr * 1.2, sr);
      const e = new VoiceEngine();
      e.voice = voiceType; e.timbre = timbre; e.vowelPos = vowelPos(vow);
      await e.start(ctx);
      e.jumpPitch(midiToHz(m));
      e.setGate(true, 1);
      const d = (await ctx.startRendering()).getChannelData(0);
      const s0 = Math.floor(sr * 0.4);
      let peak = 0, sum = 0, nan = 0;
      for (let i = s0; i < d.length; i++) { const x = d[i]; if (!Number.isFinite(x)) nan++; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      const rms = Math.sqrt(sum / (d.length - s0));
      // 简易频谱重心：4096 点 DFT（只算到 6kHz）
      const N = 4096, seg = d.subarray(s0, s0 + N);
      let num = 0, den = 0, f2 = 0;
      for (let k = 1; k < N / 2 && k * sr / N < 6000; k += 2) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n += 2) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N); const a = 2 * Math.PI * k * n / N; re += seg[n] * w * Math.cos(a); im -= seg[n] * w * Math.sin(a); }
        const mag = Math.hypot(re, im); const fq = k * sr / N; num += mag * fq; den += mag; if (fq > 1500 && fq < 3000) f2 += mag;
      }
      out.push(`${timbre.padEnd(7)} ${voiceType.padEnd(7)} m${m} ${vow}: peak ${peak.toFixed(2)} rms ${(20 * Math.log10(rms)).toFixed(1)}dB centroid ${Math.round(num / den)}Hz F2区占比 ${(100 * f2 / den).toFixed(0)}% nan ${nan}`);
    }
    return out.join('\n');
  });
}
