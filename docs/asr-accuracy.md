# 语音识别准确性：现状与提升路径

> 适用范围：web/lib/asr.js（whisper-tiny.en 量化 ONNX，transformers.js + WASM，单线程）。
> 约束：全离线、免费、微信外浏览器可用、不上传录音。

## 现状

- 模型 `whisper-tiny.en`（量化约 43MB，首次点击「识别我说的」时加载）
- 解码：贪心 → 本次改为 beam search（`num_beams: 5`）
- 输入：本次增加预处理（掐头去尾静音 + 峰值归一），减少短音频幻觉
- 用途：ASR 是**独立裁判**——把用户复诵转写出来，与 `spoken` 逐词比对，标出漏读/多读/用词/读音差异

## 本次已落地（零成本）

| 措施 | 作用 | 代价 |
|---|---|---|
| 头尾静音裁剪（10ms 帧 RMS 门限） | 短录音不再被静音诱发幻觉词 | 无 |
| 峰值归一到 0.9 | 电平过低时 Whisper 词错率上升 | 无 |
| `num_beams: 5` beam search | 口音/噪音下比贪心稳，词错率下降 | 解码约 2–4×耗时（tiny 模型基数小，可接受） |

## 进一步提升（按性价比排序）

### 1. 换 whisper-base.en（推荐下一步）

- 量化后约 80MB，英文词错率相对 tiny 再降约 30–50%（对非母语口音收益更大）
- 做法：`web/models/` 里放 `whisper-base-en`（Xenova/whisper-base.en 的 onnx 量化版），`asr.js` 的 `MODEL` 常量改名即可
- 不建议直接入 git（仓库/站点体积翻倍）：可做成「设置里点一下再下载」，走 HuggingFace CDN（`env.allowRemoteModels = true` 临时放开该模型）
- 代价：推理约 2–3×耗时；手机端更慢，建议仍限电脑端

### 2. whisper-small.en（谨慎）

量化约 250MB，准确率更高，但下载与推理成本都大。除非做「电脑端高质量模式」，否则不值。

### 3. 双路录音（ASR 吃降噪、DTW 吃原声）

现在 `getUserMedia` 把 echoCancellation / noiseSuppression / AGC **全部关闭**是刻意的：DTW 评分要跟参考 TTS 频谱对齐，浏览器降噪会扭曲频谱。
但 ASR 反而喜欢干净输入。可取折中：录音仍存原始波形（给 DTW），送 ASR 前在 WebAudio 里做轻量噪声门 + 高通 80Hz（仅 ASR 输入路径）。预期对环境噪音场景有感。

### 4. 参考句偏置（initial prompt）——**本训练器不建议**

transformers.js 支持 `get_decoder_prompt_ids` + `forced_decoder_ids`，技术上可以把参考句塞进解码器前缀，让 Whisper"顺着"参考句转写。
**不开**的原因：训练器靠 ASR 当独立裁判抓读错；偏置会把真实错误"拉回"参考句，漏报上升。只适合纯听写场景。

### 5. 航空领域微调模型（长期）

HuggingFace 上有基于 ATC 语料（ATCO2、ATCOSIM 等）微调的 Whisper，对 niner/tree、航路点、呼号识别明显更好。离线部署需导出量化 ONNX 放进 `web/models/`。工程量中等，收益最大，适合识别功能用得多了以后再做。

### 6. 比对端补偿（低优先）

`lib/diff.js` 已把 tree/three、niner/nine、fower/four 等先归一到数字再比，读音差异单独标。可再补一张「Whisper 常见误听表」（如 expedite→expect the），但每补一条都有掩盖真错的风险，建议拿到真实误听样本后再逐条加。

## 口径提醒

- 「读音」类判定（tree vs three）目前靠 `spoken` 原文差异 + DTW 频谱路径，ASR 单独无法区分「用户读错」与「Whisper 听错」——这是任何单模型 ASR 的固有局限，不是实现缺陷。
- 手机/微信端体验差是模型体积决定的，微信内置浏览器没有完整 WASM 线程能力，维持「引导去系统浏览器」策略。
