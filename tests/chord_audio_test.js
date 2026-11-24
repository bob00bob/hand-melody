// 离线渲染和弦引擎：各音色 × 各和弦的电平 / NaN / 削波，以及换和弦过程中的瞬态（咔声）
// 用法：playwright-cli run-code "$(cat tests/chord_audio_test.js)"（页面需先打开 http://localhost:8765/chord/）
async page => {
  return await page.evaluate(async () => {
    const { ChordEngine } = await import('/chord/src/chord_engine.js');
    const { resolveChord, voiceChord, bassMidi } = await import('/chord/src/harmony.js');
    const sr = 48000;
    const out = [];
    const stats = (d, s0) => {
      let peak = 0, sum = 0, nan = 0, jump = 0;
      for (let i = s0; i < d.length; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) nan++;
        peak = Math.max(peak, Math.abs(x)); sum += x * x;
        if (i > s0) jump = Math.max(jump, Math.abs(x - d[i - 1]));
      }
      return { peak, rms: 20 * Math.log10(Math.sqrt(sum / (d.length - s0))), nan, jump };
    };
    // 1) 静态：每种音色 × 几种性质
    for (const timbre of ['choir', 'strings', 'organ', 'epiano']) {
      for (const [deg, slot] of [[0, 'dia'], [4, '7'], [1, 'm7'], [6, 'dim7'], [0, 'add9']]) {
        const ctx = new OfflineAudioContext(1, sr * 1.2, sr);
        const e = new ChordEngine();
        e.timbre = timbre;
        await e.start(ctx);
        const c = resolveChord(deg, slot, 0, 'major');
        e.setChord(voiceChord(c, null, { center: 64 }), bassMidi(c, 0), { jump: true, changed: true });
        e.setGate(true, 1);
        const s = stats((await ctx.startRendering()).getChannelData(0), Math.floor(sr * 0.4));
        out.push(`${timbre.padEnd(7)} ${c.symbol.padEnd(6)} peak ${s.peak.toFixed(2)} rms ${s.rms.toFixed(1)}dB nan ${s.nan}`);
      }
    }
    // 2) 动态：I-vi-IV-V 每 0.5s 换一次，测最大相邻采样差（咔声指标）
    for (const timbre of ['choir', 'strings', 'organ', 'epiano']) {
      const ctx = new OfflineAudioContext(1, sr * 2.4, sr);
      const e = new ChordEngine();
      e.timbre = timbre;
      e.glide = 0.04 / 3;
      await e.start(ctx);
      let prev = null;
      const seq = [0, 5, 3, 4];
      // 用 suspend 在指定时间点切换和弦
      seq.forEach((deg, i) => {
        ctx.suspend(0.1 + i * 0.5).then(() => {
          const c = resolveChord(deg, 'dia', 0, 'major');
          prev = voiceChord(c, prev, { center: 64 });
          e.setChord(prev, bassMidi(c, 0), { jump: i === 0, changed: true });
          if (i === 0) e.setGate(true, 1);
          ctx.resume();
        });
      });
      const s = stats((await ctx.startRendering()).getChannelData(0), Math.floor(sr * 0.2));
      out.push(`进行 ${timbre.padEnd(7)} I-vi-IV-V peak ${s.peak.toFixed(2)} rms ${s.rms.toFixed(1)}dB 最大采样跳变 ${s.jump.toFixed(3)} nan ${s.nan}`);
    }
    return out.join('\n');
  });
}
