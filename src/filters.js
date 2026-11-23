// One Euro Filter（Casiez 2012）：慢速时强平滑去抖，快速时降低延迟
// 参考：https://gery.casiez.net/1euro/

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

function alphaOf(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 4, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastRaw = null;
  }

  // t: 秒
  filter(value, t) {
    if (this.lastT === null) {
      this.lastT = t;
      this.lastRaw = value;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const rawD = (value - this.lastRaw) / dt;
    this.lastRaw = value;
    const d = this.dx.filter(rawD, alphaOf(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(d);
    return this.x.filter(value, alphaOf(cutoff, dt));
  }
}
