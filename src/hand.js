// 手部追踪：两套引擎，按“国内能不能拿到模型”自动选择
//  - tasks ：MediaPipe Tasks Vision（新 API）。模型要从 vendor/ 本地加载；谷歌存储在国内访问不到
//  - legacy：MediaPipe Hands（旧 API）。wasm 和模型都在 npm 包里，可以走国内 npmmirror CDN
// 选择顺序：URL 参数 ?engine=tasks|legacy > 本地有 vendor 模型就用 tasks > legacy(npmmirror) > tasks(npmmirror + 谷歌模型)

const LOCAL = new URL('../vendor/mediapipe/', import.meta.url).href;
const NPMMIRROR = 'https://registry.npmmirror.com';
const TASKS_VER = '1.2.3';
const HANDS_VER = '0.4.1675469240';
const TASKS_CDN = `${NPMMIRROR}/@mediapipe/tasks-vision/${TASKS_VER}/files/`;
const HANDS_CDN = `${NPMMIRROR}/@mediapipe/hands/${HANDS_VER}/files/`;
const GOOGLE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('脚本加载失败：' + src));
    document.head.appendChild(s);
  });
}

// ---------- 引擎 1：Tasks Vision ----------
class TasksEngine {
  constructor(base, model) {
    this.base = base;
    this.model = model;
    this.name = 'tasks';
    this.delegate = '-';
  }

  async init(onStatus) {
    onStatus('加载手部识别引擎…');
    const { FilesetResolver, HandLandmarker } = await import(this.base + 'vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(this.base + 'wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: this.model, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      onStatus('加载模型（GPU）…');
      this.lm = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU delegate 失败，回退 CPU', e);
      onStatus('GPU 不可用，回退 CPU…');
      this.lm = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.delegate = 'CPU';
    }
  }

  async process(video, tMs) {
    const r = this.lm.detectForVideo(video, tMs);
    return r?.landmarks || [];
  }
}

// ---------- 引擎 2：Legacy Hands ----------
class LegacyEngine {
  constructor(base) {
    this.base = base;
    this.name = 'legacy';
    this.delegate = 'WebGL';
    this._resolve = null;
  }

  async init(onStatus) {
    onStatus('加载手部识别引擎（国内镜像）…');
    if (!window.Hands) await loadScript(this.base + 'hands.js');
    this.hands = new window.Hands({ locateFile: (f) => this.base + f });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      selfieMode: false,
    });
    this.hands.onResults((res) => {
      const r = this._resolve;
      this._resolve = null;
      if (r) r(res.multiHandLandmarks || []);
    });
    onStatus('下载手部模型（约 10MB，首次较慢）…');
    await this.hands.initialize();
  }

  process(video) {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this.hands.send({ image: video }).catch(reject);
    });
  }
}

export class HandTracker {
  constructor() {
    this.engine = null;
    this.delegate = '-';
    this.engineName = '-';
  }

  get ready() {
    return !!this.engine;
  }

  async init(onStatus = () => {}) {
    const forced = new URLSearchParams(location.search).get('engine');
    const candidates = [];
    const hasLocal = forced ? false : await urlExists(LOCAL + 'hand_landmarker.task');
    if (forced === 'tasks') candidates.push(new TasksEngine(TASKS_CDN, GOOGLE_MODEL));
    else if (forced === 'tasks-local') candidates.push(new TasksEngine(LOCAL, LOCAL + 'hand_landmarker.task'));
    else if (forced === 'legacy') candidates.push(new LegacyEngine(HANDS_CDN));
    else {
      if (hasLocal) candidates.push(new TasksEngine(LOCAL, LOCAL + 'hand_landmarker.task'));
      candidates.push(new LegacyEngine(HANDS_CDN));
      candidates.push(new TasksEngine(TASKS_CDN, GOOGLE_MODEL));
    }

    let lastErr = null;
    for (const eng of candidates) {
      try {
        await eng.init(onStatus);
        this.engine = eng;
        this.delegate = eng.delegate;
        this.engineName = eng.name;
        return;
      } catch (e) {
        console.warn(`引擎 ${eng.name} 初始化失败`, e);
        lastErr = e;
      }
    }
    throw lastErr || new Error('没有可用的手部识别引擎');
  }

  // 返回 Promise<landmarks[]>，每只手 21 个 {x,y,z}（视频归一化坐标，未镜像）
  process(video, tMs) {
    return this.engine.process(video, tMs);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 从 21 个关键点提取演奏特征（坐标为视频归一化坐标，未镜像）
export function handFeatures(lm) {
  const palmIdx = [0, 5, 9, 13, 17];
  let px = 0;
  let py = 0;
  for (const i of palmIdx) {
    px += lm[i].x;
    py += lm[i].y;
  }
  px /= palmIdx.length;
  py /= palmIdx.length;

  const palm = Math.max(1e-4, dist(lm[0], lm[9]));
  // 张开度：四指指尖到手腕的平均距离 / 掌长。张开约 1.8~2.2，握拳约 0.8~1.1
  const tips = [8, 12, 16, 20];
  let s = 0;
  for (const i of tips) s += dist(lm[i], lm[0]);
  const openness = s / tips.length / palm;

  // 伸出的手指数 0~5（指尖比第二指节离手腕更远即视为伸直）
  const pip = { 8: 6, 12: 10, 16: 14, 20: 18 };
  let fingers = 0;
  for (const i of tips) if (dist(lm[i], lm[0]) > dist(lm[pip[i]], lm[0]) * 1.12) fingers++;
  // 拇指：指尖离食指根足够远，且比拇指第一关节更远离小指根（握拳时拇指压在手指上，两项都不满足）
  const thumb = dist(lm[4], lm[5]) > palm * 0.6 && dist(lm[4], lm[17]) > dist(lm[3], lm[17]);
  if (thumb) fingers++;

  return { x: px, y: py, openness, palm, fingers, thumb };
}
