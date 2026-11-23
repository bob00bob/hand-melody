// 音乐相关：音名、音阶、音高量化（带滞回，防止在两个音之间来回跳）

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SOLFEGE = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];

export const SCALES = {
  pentatonic: { label: '五声音阶', steps: [0, 2, 4, 7, 9] },
  major: { label: '自然大调', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: '自然小调', steps: [0, 2, 3, 5, 7, 8, 10] },
  chromatic: { label: '半音阶', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  free: { label: '自由（不吸附）', steps: null },
};

export function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiName(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

export function midiSolfege(m, key) {
  const r = Math.round(m);
  return SOLFEGE[(((r - key) % 12) + 12) % 12];
}

// 返回 [low, high] 区间内所有属于该音阶的 midi 音
export function scaleNotes(scaleId, key, low, high) {
  const steps = SCALES[scaleId]?.steps ?? SCALES.chromatic.steps;
  const out = [];
  for (let m = Math.ceil(low); m <= Math.floor(high); m++) {
    const deg = (((m - key) % 12) + 12) % 12;
    if (steps.includes(deg)) out.push(m);
  }
  return out;
}

// 量化器：连续音高(半音单位) -> 吸附后的音高
export class Quantizer {
  constructor() {
    this.current = null;
  }

  reset() {
    this.current = null;
  }

  // s: 连续 midi 值；notes: 可选音列表；strength: 0~1 吸附强度；hysteresis: 半音
  process(s, notes, strength, hysteresis = 0.18) {
    if (!notes || notes.length === 0 || strength <= 0) {
      this.current = null;
      return s;
    }
    let nearest = notes[0];
    for (const n of notes) if (Math.abs(n - s) < Math.abs(nearest - s)) nearest = n;

    // 滞回：当前音仍在“地盘 + 余量”内就不切换
    if (this.current !== null && this.current !== nearest && notes.includes(this.current)) {
      const dCur = Math.abs(s - this.current);
      const dNew = Math.abs(s - nearest);
      if (dCur - dNew < hysteresis) nearest = this.current;
    }
    this.current = nearest;
    return nearest + (s - nearest) * (1 - strength);
  }
}
