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
| 第二只手的高度 | 音量 |
| 手左右移动（可选） | 元音 u·o·a·e·i 连续变化 |

音高稳定约 250ms 后会自动加入颤音，手一动颤音就撤掉，模仿真人演唱。

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
