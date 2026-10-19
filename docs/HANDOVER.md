# 项目交接 / 跨设备记忆

> 这份文件是给「未来的自己」和「其他设备上的 AI 会话」看的。换设备时：把本文件贴给 AI，或让它先读 `docs/HANDOVER.md`，即可继续维护。

## 一句话

PEPEC 900 句复诵训练器：听标准音 → 复诵录音 → 逐词指出哪里读偏。**纯静态前端，零后端、零大模型、录音不上传**。

| 项 | 值 |
|---|---|
| 线上 | https://charlieling-jiajie.github.io/pepec900-trainer/ |
| 仓库 | https://github.com/charlieling-jiajie/pepec900-trainer （public） |
| 作者署名 | CharlieL（页面页脚） |
| 版本 | v1.0（资源版本号 `?v=8`，见下文「版本号机制」） |
| 部署 | GitHub Pages + Actions（`.github/workflows/pages.yml`，push 到 main 即发布） |

## 架构

```
书面文本 → 口语形式(spoken) → 参考音(mp3)
                 ↓                  ↓
            界面逐词显示      浏览器内 DTW 比对 → 逐词打分
```

- 判分原理：参考音与录音各取 40 维对数梅尔 → CMVN → 带 Sakura-Chiba 约束的 DTW → 按词聚合代价 → 句内相对打分。
- **不做语音识别、不接任何模型**，因此速度快、可离线、录音不出浏览器。
- 已知限制：只能指出「哪个词偏离」，**说不出「读成了什么」**（音素级判定留给 v0.2）。

## 目录

```
pepec900-trainer/
├─ web/                 纯静态站点（GitHub Pages 发布的就是这个目录）
│  ├─ index.html styles.css app.js
│  ├─ lib/dsp.js        FFT / 梅尔 / DTW / 逐词区间与打分（纯函数，Node 可测）
│  ├─ data/corpus.js    由 corpus.json 生成，前端 import
│  ├─ audio/{1..900}.mp3  参考音，约 36MB
│  └─ audition/         音色试听页（同句多音色对比）
├─ data/corpus.json     900 句全量：text / spoken / tts / gaps / words / syl / hints
├─ data/audio_meta.json 每条音频的时长与体积
├─ tools/
│  ├─ build_corpus.py   PDF → 900 句 → 口语形式（读法规则都在这里）
│  ├─ build_audio.py    spoken/tts → mp3（Kokoro，按标点切段插静音）
│  ├─ export_web.py     corpus.json → web/data/corpus.js（会剔除 tts 字段）
│  ├─ test_dsp.mjs      DSP 链路自检
│  └─ test_app.mjs      前端启动冒烟测试（Node + DOM 桩）
├─ deploy/nginx.conf    备站用的 nginx 配置（HTTPS、gzip、缓存、麦克风策略）
├─ docs/PLAN.md         最初的技术规划
└─ start.bat            本地起静态服务（Windows）
```

## 语料流水线（顺序不能错）

```bash
python tools/build_corpus.py            # PDF/规则 → data/corpus.json
python tools/export_web.py              # corpus.json → web/data/corpus.js  ★容易漏
python tools/build_audio.py --engine kokoro --sid 24 --force
```

**踩过的坑**：改了读法只跑了 `build_corpus` + `build_audio`，忘了 `export_web`，导致音频读 "ar nav"、界面显示 "r n a v"。三者必须一起跑。

## 读法规则（三相，全在 `tools/build_corpus.py` 顶部）

| 类别 | 集合 | 例 |
|---|---|---|
| 直接读字母 | `LETTER_ABBR` = VOR / DME / ILS / NDB / QNH / QFE / HF / VHF / UHF / SSR / ATC / ADS / ELT | `VOR` → v o r |
| 按词读 | `SPECIAL` = LOC→localizer、RNAV→ar nav、TCAS→t cas、RAIM→raim；`WORD_ABBR` = NOTAM/CAVOK/METAR/TAF/SIGMET/EICAS/ECAM/ETOPS/SELCAL/MAYDAY/PAN/WILCO/ROGER/NOT | `LOC` → localizer |
| 其余字母 | 一律 **ICAO 拼读词** | `BKM` → bravo kilo mike、`HUR` → hotel uniform romeo |

数字：仅 **3→tree、9→niner、小数点→decimal** 特殊，其余按常规（千位读 thousand）。
`ADS-B` 在 `clean()` 里先于连字符拆分替换为 `a d s b`。

## 音频合成

- 引擎 **Kokoro-82M**（`kokoro-multi-lang-v1_0`，24kHz），说话人 **sid=24**（实测基频约 128Hz，男声）。
- **Kokoro 完全忽略标点**（带逗号 6.52s vs 不带 6.50s），所以停顿是**按标点切段合成、再手动插入静音**：逗号 0.16s、句号 0.42s（`build_audio.py` 顶部 `GAP_COMMA` / `GAP_STOP`）。
- 语料里 `gaps` 字段记录「停顿发生在第几个词之前、多长」，前端 `wordRangesBySyllable(syl, n, gaps)` 先把停顿帧扣掉再按音节分配，否则词边界会漂。
- 全量 900 条约 13 分钟、36MB、77 分钟音频。

## 语音识别比对（v1.1）

- 模型：`web/models/whisper-tiny-en/`（encoder 10.1MB + decoder 30.7MB + tokenizer 2.1MB，int8 量化）
- 运行时：`web/lib/transformers/`（transformers.js 2.17.2 + ort-wasm-simd.wasm），**全部本地化，不依赖境外 CDN**
- 代码：`web/lib/asr.js`（懒加载 + 环境门控）、`web/lib/diff.js`（归一化 + LCS 对齐 + 四分类）
- 三层归一化是核心：缩写还原（`meta.abbr`）→ 数字按数值（`three thousand` ↔ `3000`）→ 连续单字母合并（`v o r` ↔ `VOR`）
- `env.backends.onnx.wasm.numThreads = 1`：Pages 没有 COOP/COEP，SharedArrayBuffer 不可用，多线程会失败
- 环境门控：微信内置浏览器直接禁用（提示「在浏览器打开」）；手机浏览器放行但提示慢
- 单测：`node tools/test_diff.mjs`（7 个用例）

## 交互约定

- **听写模式**：默认不显示原文与「应读」，按「原文」（快捷键 T）才展开；**播放时自动收起**；评分后只显示「应读」+ 逐词高亮，原文仍需手动展开。
- 快捷键：Space 播放 / R 录音 / T 原文 / N 下一句。

## 版本号机制（重要）

`web/index.html` 的 `styles.css?v=N`、`app.js?v=N`，`web/app.js` 内 `corpus.js?v=N`、`dsp.js?v=N`、`ASSET_V='?v=N'`（音频 URL 也用）。

**每次改动内容都要把 N 加一**，否则 GitHub Pages 的 CDN 与浏览器会继续用旧资源。改完顺带更新页面右上角 `v1.0` 标签的展示版本（如需）。

## 改一处读法的标准动作（SOP）

1. 改 `tools/build_corpus.py` 里的集合/规则
2. `build_corpus.py` → 跑一段 diff 找出受影响句号（只重做这几条，秒级）
3. `export_web.py`
4. `build_audio.py --engine kokoro --sid 24 --only <句号...> --force`
5. 版本号 +1，`test_app.mjs` 自检
6. `git add -A && git commit && git push`
7. 等 Actions（约 20–40 秒），再核对线上：页面版本、`corpus.js` 文本、`audio/<id>.mp3` 字节数

## 构建环境

- Python：`C:\Users\31383\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（已装 sherpa-onnx、lameenc、pdfplumber、numpy）
- Node：`C:\Users\31383\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`
- 模型（不入库，需自备）：`models/kokoro-multi-lang-v1_0/`，来自
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2`
- 原始语料：`C:\Users\31383\Desktop\PEPEC900.pdf`（用户本机）

## 已知坑

1. PDF 折行会产生形如 `24.` 的**伪编号行**（实为上一句折行尾巴），会把真句子覆盖成空 → 判据必须是「编号后有正文」。
2. 拼写粘连（`viaA2` / `taxiwayAapproved` / `JEMMYvia`）→ 三条正则 + 少量硬编码。
3. `QNH 1012` 早期规则若产出大写 `"Q N H"`，会被「单个大写字母→拼读词」二次展开，必须直接产出小写 `q n h`。
4. 沙箱可能拦截批量删除大量文件 → 音频重建用 `--force` 原地覆盖，不要 `rmtree`。
5. 国内访问：`gh-proxy` 类前缀**不能**代理 github.io（实测 404/403）；可用 jsDelivr 兜底：
   `https://cdn.jsdelivr.net/gh/charlieling-jiajie/pepec900-trainer@main/web/index.html`

## 后续路线

- **v0.2 音素级判定**：wav2vec2 音素 CTC + 已知文本强制对齐 + GOP，能说出「此处该读 tree，你读成了 three」。
- v0.3：用 speechocean762 校准逐音素阈值；个人薄弱音素统计。
- 备选：把 `web/` 用 nginx 丢到自有服务器（`deploy/nginx.conf` 已写好）做国内备站。
