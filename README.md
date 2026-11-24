# Hand Melody · 手势唱音（原型 v0.1）

用手机或电脑的摄像头追踪手的高度，控制虚拟人声唱“啊——”的音高。

## 运行

```bash
python serve.py          # 默认端口 8765，只监听 127.0.0.1
```

浏览器打开 http://localhost:8765 ，点击“开始”并允许摄像头。
没有摄像头时会自动切到**触摸模式**：在屏幕上按住、上下拖动也能唱。

> 手机需要通过 **HTTPS** 访问：浏览器只允许在安全上下文（HTTPS 或 localhost）里调用摄像头。

## 手部识别引擎（自动选择）

| 顺序 | 引擎 | 资源来源 | 场景 |
|---|---|---|---|
| 1 | tasks（MediaPipe Tasks Vision 1.2.3） | 本地 `vendor/` | 本地开发（vendor 不进 Git 仓库） |
| 2 | legacy（MediaPipe Hands 0.4） | 国内 npmmirror CDN | GitHub Pages 线上版 |
| 3 | tasks | npmmirror wasm + 谷歌模型 | 兜底（国内一般访问不到谷歌存储） |

可以用 `?engine=legacy`、`?engine=tasks-local` 或 `?engine=tasks` 强制指定引擎。

## 玩法

| 手势 | 作用 |
|---|---|
| 手掌上下 | 音高（默认五声音阶，吸附 85%，保留少量滑音） |
| 张开 / 握拳 | 唱 / 停（带滞回，阈值可在设置里调） |
| 左手（第二只手）的高度 | 音量 |
| 左手伸出的手指数 | 元音：1 啊 · 2 喔 · 3 呜 · 4 诶 · 5 咿（保持 120ms 才切换，握拳保持当前元音） |
| 右手左右移动（可选） | 元音 u·o·a·e·i 连续变化 |

音色（设置里切换）：人声（元音）/ 哼鸣“嗯” / 口哨（高一个八度）/ 机器人（32Hz 环形调制）。

音高稳定约 250ms 后会自动加入颤音，手一动颤音就撤掉，模仿真人演唱。

## 和声版 Hand Harmony（`chord/`）

打开 http://localhost:8765/chord/ 。右手选“第几级和弦”，左手选“什么和弦”。

| 手势 | 作用 |
|---|---|
| 右手高度 | 级数 I ~ VII（可选 8 档，多一个高八度 I），带滞回防抖 |
| 右手张开 / 握拳 | 奏响 / 停止 |
| 左手手指数 | 和弦性质（保持 120ms 才切换）。握拳或不举左手 = 顺阶和弦 |
| 左手高度（可选） | 音量 |
| 底部色块 / 键盘 0~5 | 没有左手时手动选性质（触摸模式用） |

左手映射方案（设置里切换）：

| 方案 | 拳 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 常用（默认） | 顺阶 | 大三 | 小三 | 属七 | 大七 | 小七 |
| 三和弦 | 顺阶 | 大 | 小 | 减 | 增 | 挂四 |
| 七和弦 | 顺阶七 | 大七 | 小七 | 属七 | 半减七 | 减七 |
| 色彩 | 顺阶 | 挂二 | 挂四 | 加九 | 六 | 属九 |

- 调式：大调 / 小调（小调 V 级用属和弦）；12 个调，和弦音按字母级数拼写（C 大调的 Gm 是 G B♭ D）
- 声部：上方 4 声部 + 低音根音。“就近声部进行”会在所有转位里选移动量最小的，听感连贯；“原位”则手越高和弦越高
- 音色：合唱“啊”（共享共振峰组）/ 弦乐 Pad / 风琴 / 电钢琴（换和弦时从低到高逐音扫弦）

```
chord/index.html          界面
chord/src/main.js         主循环（复用 src/hand.js、src/filters.js、src/music.js 的量化器）
chord/src/harmony.js      调式、和弦性质、罗马级数、拼写、声部排列（纯函数）
chord/src/chord_engine.js 4+1 声部和弦合成器
tests/harmony_test.mjs    node 单测（12 调 × 2 调式 × 8 级 × 全部性质）
tests/chord_audio_test.js 离线渲染电平 / NaN / 换和弦瞬态
tests/chord_e2e.js        虚拟摄像头 + 触摸模式端到端
```

## 目录

```
index.html            界面 + 样式（C 深青墨暗色）
src/main.js           主循环：识别 → 平滑 → 量化 → 发声 → 绘制
src/hand.js           MediaPipe HandLandmarker 封装 + 手势特征（掌心、张开度、手指数）
src/voice.js          人声引擎（方案 B：声门源 + 5 个共振峰 + 合唱失谐 + 颤音 + 混响）
src/music.js          音阶 / 音名 / 带滞回的量化器
src/filters.js        One Euro 滤波（去抖）
vendor/mediapipe/     tasks-vision 1.2.3 + wasm + hand_landmarker.task（仅本地，约 22MB，不进仓库）
serve.py              本地预览服务器
```

## 替换声音引擎

`VoiceEngine` 只对外暴露这几个接口：`start / jumpPitch / setPitch / setVowel / setGate / setVibrato / setVolume`。
以后换成多音高采样（方案 A），只要实现同样的接口，`main.js` 不用改。

## 已验证

- 离线渲染 7 组声部、音高、元音组合：峰值 0.53~0.74，RMS 在 -8 到 -17 dBFS 之间，没有 NaN，也没有削波
- Edge（headless）用虚拟摄像头跑完整链路：GPU 推理，每帧约 3.5ms；推理帧率等于摄像头帧率，开头约 2 秒是 GPU 预热
- 触摸模式下起音和停音正常，界面上的音名与音高一致
