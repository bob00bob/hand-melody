// 和声：调式、顺阶和弦、和弦性质、罗马级数命名、声部排列（就近声部进行）
// 纯函数，不依赖浏览器，可直接 node 测试

export const mod12 = (n) => ((n % 12) + 12) % 12;

// ---- 拼写：按字母级数推导（C 大调的 Gm 是 G B♭ D，而不是 G A♯ D） ----
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
// 各调主音的字母（0=C … 6=B）。大调取常用拼法（D♭ E♭ F♯ A♭ B♭），小调取 c♯ f♯ g♯ e♭ b♭
const TONIC_LETTER = {
  major: [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6],
  minor: [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6],
};

function spell(letter, pc) {
  const l = ((letter % 7) + 7) % 7;
  let a = mod12(pc - LETTER_PC[l]);
  if (a > 6) a -= 12;
  return LETTERS[l] + (ACC[a] ?? '?');
}

// 和弦拼写：根音用调内字母；如果出现重升/重降（如 C♭dim7 要 B𝄫𝄫），换等音根音重拼，取变音记号最少的
const accCount = (n) => [...n.slice(1)].reduce((a, ch) => a + (ch === '𝄫' || ch === '𝄪' ? 2 : 1), 0);
function spellChord(rootLetter, rootPc, q) {
  const tryL = (L) => {
    const names = q.iv.map((i, k) => spell(L + q.lt[k], rootPc + i));
    const bad = names.some((n) => n.includes('?'));
    const doubles = names.some((n) => n.includes('𝄫') || n.includes('𝄪'));
    return { root: names[0], names, bad, doubles, score: bad ? 99 : names.reduce((a, n) => a + accCount(n), 0) };
  };
  const first = tryL(rootLetter);
  if (!first.bad && !first.doubles) return first;
  return [first, tryL(rootLetter - 1), tryL(rootLetter + 1)].sort((a, b) => a.score - b.score)[0];
}

export function keyName(key, mode = 'major') {
  return spell(TONIC_LETTER[mode][key], key);
}

// 调选择框的标签
export const KEY_NAMES = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭/G♯', 'A', 'B♭', 'B'];

// 不在和弦上下文里的音名（比如音区刻度）：按调的升降号习惯
export function noteName(pc, key = 0, mode = 'major') {
  const flat = mode === 'minor' ? [0, 2, 3, 5, 7, 10].includes(key) : [1, 3, 5, 6, 8, 10].includes(key);
  return (flat ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
    : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'])[mod12(pc)];
}

export function midiLabel(m, key, mode) {
  return noteName(m, key, mode) + (Math.floor(Math.round(m) / 12) - 1);
}

export const MODES = {
  major: {
    label: '大调',
    steps: [0, 2, 4, 5, 7, 9, 11],
    triads: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    sevenths: ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'],
  },
  // 小调：自然小调音阶，但 V 级按和声小调用大三 / 属七（古典与流行里最常见的写法）
  minor: {
    label: '小调（V 级用属和弦）',
    steps: [0, 2, 3, 5, 7, 8, 10],
    triads: ['min', 'dim', 'maj', 'min', 'maj', 'maj', 'maj'],
    sevenths: ['m7', 'm7b5', 'maj7', 'm7', '7', 'maj7', '7'],
  },
};

// iv: 相对根音的半音；minor: 罗马数字是否小写；sym: 和弦记号后缀；rn: 罗马数字后缀
export const QUALITIES = {
  maj: { label: '大三和弦', short: '大三', iv: [0, 4, 7], lt: [0, 2, 4], sym: '', rn: '', minor: false },
  min: { label: '小三和弦', short: '小三', iv: [0, 3, 7], lt: [0, 2, 4], sym: 'm', rn: '', minor: true },
  dim: { label: '减三和弦', short: '减三', iv: [0, 3, 6], lt: [0, 2, 4], sym: 'dim', rn: '°', minor: true },
  aug: { label: '增三和弦', short: '增三', iv: [0, 4, 8], lt: [0, 2, 4], sym: 'aug', rn: '+', minor: false },
  sus2: { label: '挂二和弦', short: '挂二', iv: [0, 2, 7], lt: [0, 1, 4], sym: 'sus2', rn: 'sus2', minor: false },
  sus4: { label: '挂四和弦', short: '挂四', iv: [0, 5, 7], lt: [0, 3, 4], sym: 'sus4', rn: 'sus4', minor: false },
  6: { label: '大六和弦', short: '六', iv: [0, 4, 7, 9], lt: [0, 2, 4, 5], sym: '6', rn: '6', minor: false },
  7: { label: '属七和弦', short: '属七', iv: [0, 4, 7, 10], lt: [0, 2, 4, 6], sym: '7', rn: '7', minor: false },
  maj7: { label: '大七和弦', short: '大七', iv: [0, 4, 7, 11], lt: [0, 2, 4, 6], sym: 'maj7', rn: 'maj7', minor: false },
  m7: { label: '小七和弦', short: '小七', iv: [0, 3, 7, 10], lt: [0, 2, 4, 6], sym: 'm7', rn: '7', minor: true },
  m7b5: { label: '半减七和弦', short: '半减七', iv: [0, 3, 6, 10], lt: [0, 2, 4, 6], sym: 'm7♭5', rn: 'ø7', minor: true },
  dim7: { label: '减七和弦', short: '减七', iv: [0, 3, 6, 9], lt: [0, 2, 4, 6], sym: 'dim7', rn: '°7', minor: true },
  add9: { label: '加九和弦', short: '加九', iv: [0, 4, 7, 14], lt: [0, 2, 4, 1], sym: 'add9', rn: 'add9', minor: false },
  9: { label: '属九和弦（省五音）', short: '属九', iv: [0, 4, 10, 14], lt: [0, 2, 6, 1], sym: '9', rn: '9', minor: false },
};

// 左手手指数 0~5 → 和弦性质。dia = 顺阶三和弦（按调内自动取大/小/减），dia7 = 顺阶七和弦
export const PRESETS = {
  basic: { label: '常用：顺阶 大三 小三 属七 大七 小七', map: ['dia', 'maj', 'min', '7', 'maj7', 'm7'] },
  triad: { label: '三和弦：顺阶 大 小 减 增 挂四', map: ['dia', 'maj', 'min', 'dim', 'aug', 'sus4'] },
  seventh: { label: '七和弦：顺阶七 大七 小七 属七 半减七 减七', map: ['dia7', 'maj7', 'm7', '7', 'm7b5', 'dim7'] },
  color: { label: '色彩：顺阶 挂二 挂四 加九 六 属九', map: ['dia', 'sus2', 'sus4', 'add9', '6', '9'] },
};

export function slotShort(slot) {
  if (slot === 'dia') return '顺阶';
  if (slot === 'dia7') return '顺阶七';
  return QUALITIES[slot].short;
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// deg: 0~7（7 = 高八度的 I）；slot: PRESETS.map 里的一项
export function resolveChord(deg, slot, key = 0, mode = 'major') {
  const M = MODES[mode];
  const d = deg % 7;
  const qid = slot === 'dia' ? M.triads[d] : slot === 'dia7' ? M.sevenths[d] : slot;
  const q = QUALITIES[qid];
  const rootStep = M.steps[d] + (deg >= 7 ? 12 : 0);
  const rootPc = mod12(key + rootStep);
  const spelled = spellChord(TONIC_LETTER[mode][key] + d, rootPc, q);
  const diaRn = M.triads[d] === 'min' || M.triads[d] === 'dim';
  const numeral = q.minor ? NUMERALS[d].toLowerCase() : NUMERALS[d];
  return {
    id: `${deg}:${qid}`,
    deg,
    qid,
    quality: q,
    rootStep,
    rootPc,
    intervals: q.iv,
    pcs: q.iv.map((i) => mod12(rootPc + i)),
    names: spelled.names,
    symbol: spelled.root + q.sym,
    roman: numeral + q.rn,
    diatonic: slot === 'dia' || slot === 'dia7' || (qid === M.triads[d]) || (qid === M.sevenths[d]),
    diaMinor: diaRn,
  };
}

// 低音：根音，随级数单调升高。范围约 G♯1 ~ G3
export function bassMidi(chord, key) {
  const base = 36 + key - (key > 7 ? 12 : 0);
  return base + chord.rootStep;
}

// 上方 4 个声部：密集排列。
//  smooth：从所有转位 / 八度里选“离上一个和弦总移动量最小”的一个（就近声部进行，听感最连贯）
//  root  ：原位，根音在最下面，手越高整体越高
export function voiceChord(chord, prev, { center = 64, mode = 'smooth', key = 0 } = {}) {
  // 和弦音循环（按音级从低到高）。三和弦重复根音凑满 4 个声部
  const rel = [...new Set(chord.intervals.map(mod12))].sort((a, b) => a - b);
  const build = (r, bottom) => {
    const out = [bottom];
    for (let k = 1; k < 4; k++) {
      const pc = mod12(chord.rootPc + rel[(r + k) % rel.length]);
      let m = out[k - 1] + 1;
      while (mod12(m) !== pc) m++;
      out.push(m);
    }
    return out;
  };

  if (mode === 'root') {
    // 主音落在 [center-15, center-4]，8 个级数（含高八度 I）的最高音不超过 C6 附近
    const lo = center - 15;
    const keyBase = lo + mod12(key - lo);
    return build(0, keyBase + chord.rootStep);
  }

  let best = null;
  let bestCost = Infinity;
  for (let r = 0; r < rel.length; r++) {
    const pc = mod12(chord.rootPc + rel[r]);
    for (let m = center - 16; m <= center + 4; m++) {
      if (mod12(m) !== pc) continue;
      const v = build(r, m);
      const avg = (v[0] + v[1] + v[2] + v[3]) / 4;
      let cost;
      if (prev && prev.length === 4) {
        cost = 0;
        for (let k = 0; k < 4; k++) cost += Math.abs(v[k] - prev[k]);
        cost += 0.35 * Math.abs(avg - center); // 防止一路漂到太高/太低
      } else {
        cost = Math.abs(avg - center) + (r === 0 ? 0 : 0.5); // 首个和弦略偏好原位
      }
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = v;
      }
    }
  }
  return best;
}
