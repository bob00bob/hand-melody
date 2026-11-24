// 和声模块单测：node tests/harmony_test.mjs
import { resolveChord, voiceChord, bassMidi, mod12, PRESETS } from '../chord/src/harmony.js';

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ' 期望 ' + JSON.stringify(want)}`);
};

// C 大调顺阶三和弦
check('C 大调顺阶', [0, 1, 2, 3, 4, 5, 6].map((d) => resolveChord(d, 'dia', 0, 'major').symbol), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
check('C 大调罗马', [0, 1, 2, 3, 4, 5, 6].map((d) => resolveChord(d, 'dia', 0, 'major').roman), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
check('C 大调顺阶七', [0, 1, 2, 3, 4, 5, 6].map((d) => resolveChord(d, 'dia7', 0, 'major').symbol), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7♭5']);
check('A 小调顺阶', [0, 1, 2, 3, 4, 5, 6].map((d) => resolveChord(d, 'dia', 9, 'minor').symbol), ['Am', 'Bdim', 'C', 'Dm', 'E', 'F', 'G']);
check('F 大调用降号', [0, 3, 4].map((d) => resolveChord(d, 'dia', 5, 'major').symbol), ['F', 'B♭', 'C']);
check('E♭ 大调 V7', resolveChord(4, '7', 3, 'major').symbol, 'B♭7');
check('II 级强制大三(副属)', resolveChord(1, 'maj', 0, 'major').roman, 'II');
check('G7 音级', resolveChord(4, '7', 0, 'major').pcs, [7, 11, 2, 5]);
check('高八度 I', resolveChord(7, 'dia', 0, 'major').rootStep, 12);

check('C 大调 Gm 拼写', resolveChord(4, 'min', 0, 'major').names, ['G', 'B♭', 'D']);
check('C 大调 Bdim7 拼写', resolveChord(6, 'dim7', 0, 'major').names, ['B', 'D', 'F', 'A♭']);
check('F♯ 大调 vii°', resolveChord(6, 'dia', 6, 'major').names, ['E♯', 'G♯', 'B']);
check('E♭ 小调 V7', resolveChord(4, 'dia7', 3, 'minor').names, ['B♭', 'D', 'F', 'A♭']);
check('A 小调 V 用升 G', resolveChord(4, 'dia', 9, 'minor').names, ['E', 'G♯', 'B']);
check('G 大调 Dadd9', resolveChord(4, 'add9', 7, 'major').names, ['D', 'F♯', 'A', 'E']);
check('C 大调 G9', resolveChord(4, '9', 0, 'major').names, ['G', 'B', 'F', 'A']);

// 声部排列：每个声部都必须是和弦音；就近模式下 I-IV-V-I 每声部移动都很小
const prog = [0, 3, 4, 0].map((d) => resolveChord(d, 'dia', 0, 'major'));
let prev = null;
let maxMove = 0;
for (const c of prog) {
  const v = voiceChord(c, prev, { center: 64 });
  const allIn = v.every((m) => c.pcs.includes(mod12(m)));
  const coversAll = c.pcs.every((p) => v.some((m) => mod12(m) === p));
  if (!allIn || !coversAll) { fail++; console.log('FAIL 和弦音不完整', c.symbol, v); }
  if (prev) maxMove = Math.max(maxMove, ...v.map((m, k) => Math.abs(m - prev[k])));
  console.log(`     ${c.symbol.padEnd(4)} ${v.join(' ')}`);
  prev = v;
}
check('就近声部进行：单声部最大跳进 ≤ 5 半音', maxMove <= 5, true);

// 所有调 × 所有级数 × 所有性质：声部在合理音区、低音单调上升、无 NaN
let bad = 0;
const allSlots = [...new Set(Object.values(PRESETS).flatMap((p) => p.map))];
for (let key = 0; key < 12; key++) {
  for (const mode of ['major', 'minor']) {
    let lastBass = -1;
    for (let d = 0; d < 8; d++) {
      const b = bassMidi(resolveChord(d, 'dia', key, mode), key);
      if (b <= lastBass || b < 28 || b > 62) bad++;
      lastBass = b;
      for (const slot of allSlots) {
        const c = resolveChord(d, slot, key, mode);
        if (c.names.some((x) => x.includes('?')) || c.symbol.includes('?')) { bad++; console.log('拼写失败', key, mode, d, slot, c.names); }
        for (const vm of ['smooth', 'root']) {
          const v = voiceChord(c, null, { center: 64, mode: vm, key });
          if (!v || v.length !== 4 || v.some((m) => !Number.isFinite(m) || m < 44 || m > 84)) { bad++; console.log('越界', key, mode, d, slot, vm, v); }
        }
      }
    }
  }
}
check('12 调 × 2 调式 × 8 级 × 全部性质：音区/低音单调', bad, 0);

process.exit(fail ? 1 : 0);
