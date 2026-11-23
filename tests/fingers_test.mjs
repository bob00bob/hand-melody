// 合成关键点，检查手指数（含拇指）判定：用法 node tests/fingers_test.mjs
import { handFeatures } from '../src/hand.js';

// 右手掌心朝镜头：手腕在下，四指向上。ext: [拇指, 食指, 中指, 无名指, 小指] 是否伸直
function makeHand(ext) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const W = { x: 0.5, y: 0.8 };
  lm[0] = W;
  const mcpX = [0, 0.44, 0.49, 0.54, 0.59];
  [5, 9, 13, 17].forEach((m, i) => {
    const x = mcpX[i + 1];
    lm[m] = { x, y: 0.62 };
    if (ext[i + 1]) {
      lm[m + 1] = { x, y: 0.55 }; lm[m + 2] = { x, y: 0.5 }; lm[m + 3] = { x, y: 0.45 };
    } else {
      // 弯曲：指尖折回到掌心附近
      lm[m + 1] = { x, y: 0.57 }; lm[m + 2] = { x, y: 0.6 }; lm[m + 3] = { x, y: 0.65 };
    }
  });
  // 拇指链 1..4
  lm[1] = { x: 0.45, y: 0.76 }; lm[2] = { x: 0.41, y: 0.72 };
  if (ext[0]) { lm[3] = { x: 0.37, y: 0.68 }; lm[4] = { x: 0.33, y: 0.64 }; }
  else { lm[3] = { x: 0.43, y: 0.67 }; lm[4] = { x: 0.48, y: 0.66 }; } // 压在手指上
  return lm;
}

const cases = [
  ['握拳', [0, 0, 0, 0, 0], 0],
  ['1 指（食指）', [0, 1, 0, 0, 0], 1],
  ['2 指（V）', [0, 1, 1, 0, 0], 2],
  ['3 指', [0, 1, 1, 1, 0], 3],
  ['4 指（不含拇指）', [0, 1, 1, 1, 1], 4],
  ['5 指（张开）', [1, 1, 1, 1, 1], 5],
  ['点赞（只有拇指）', [1, 0, 0, 0, 0], 1],
];
let fail = 0;
for (const [name, ext, want] of cases) {
  const f = handFeatures(makeHand(ext));
  const ok = f.fingers === want;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: fingers=${f.fingers} (期望 ${want}) openness=${f.openness.toFixed(2)}`);
}
process.exit(fail ? 1 : 0);
