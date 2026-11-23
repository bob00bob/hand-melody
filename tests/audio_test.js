async page => {
  return await page.evaluate(async () => {
    const { VoiceEngine } = await import('/src/voice.js');
    const { midiToHz } = await import('/src/music.js');
    const out = [];
    const cases = [
      ['soprano', 60, 0.5, true], ['soprano', 72, 0.5, true], ['soprano', 84, 0.5, true],
      ['tenor', 48, 0.5, true], ['bass', 40, 0.5, false], ['alto', 62, 0.0, true], ['alto', 62, 1.0, true],
    ];
    for (const [v, m, vow, choir] of cases) {
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 1.5, sr);
      const e = new VoiceEngine();
      e.voice = v; e.vowelPos = vow; e.choir = choir;
      await e.start(ctx);
      e.jumpPitch(midiToHz(m));
      e.setGate(true, 1);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, nan = 0;
      const s0 = Math.floor(sr * 0.5);
      for (let i = s0; i < d.length; i++) { const x = d[i]; if (!Number.isFinite(x)) nan++; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      const rms = Math.sqrt(sum / (d.length - s0));
      out.push(`${v} m${m} vow${vow} choir${choir}: peak ${peak.toFixed(3)} rms ${(20*Math.log10(rms)).toFixed(1)}dBFS nan ${nan}`);
    }
    return out.join('\n');
  });
}
