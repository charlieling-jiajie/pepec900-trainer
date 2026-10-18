# PEPEC 900 复诵训练器

听标准音 → 复诵录音 → 立刻指出哪几个词读偏了。给民航飞行员 / ATC 学员练 PEPEC 900 句用。

**不联网、不上传录音、不调用任何大模型**：全部处理在浏览器本地完成。

作者：**CharlieL**

---

## 两种用法

**在线用（免安装）**
https://charlieling-jiajie.github.io/pepec900-trainer/
手机浏览器可"添加到主屏幕"，体验接近 App。

**本地用**
1. 双击 `start.bat`（需要 Python 3，仅用来起一个静态服务器）
2. 浏览器自动打开 `http://127.0.0.1:8080/`

> 不要直接双击 `web/index.html`：浏览器会因安全限制拒绝读取音频文件，评分不可用。

---

## v1.0 做了什么

| 功能 | 说明 |
|---|---|
| 900 句题库 | 民航局《PEPEC 英语考试 900 句》全文，8 章可筛选 |
| 读法 | 缩写与航路点**逐字母直读**（V-O-R、B-K-M），`LOC` 读 localizer；数字 3 读 TREE、9 读 NINER，小数点读 DECIMAL |
| 听写模式 | 默认**不显示原文与应读**，先听再复诵；按「原文」才展开，播放时自动收起 |
| 标准音 | 每句一条离线合成音（**Kokoro-82M**，24 kHz，男声），支持 0.75–1.25 倍速 |
| 录音 | 一键录/停，实时波形与计时，最长 16 秒 |
| 比对 | 录音与标准音做时间对齐，逐词给出读对 / 接近 / 偏差大 |
| 辅助指标 | 句内相对分、偏差词数、语速比、漏读提示 |
| 记忆 | 练习次数、最好分、错句本（存在浏览器 localStorage） |

例：#1 `Maintaining FL310.` 显示"应读"为 `maintaining flight level tree one zero` —— 这正是考试要的读法。

## v1.0 的能力边界（务必知情）

1. **判分是"声学比对"，不是音素识别**。它能指出*哪个词*偏离标准音，但说不出*读成了什么*（"你把 three 念成 tree"这一层要等 v0.2）。
2. **分数是句内相对分**，不是绝对水平。词与词之间可比，跨句、跨人不严格可比（阈值尚未用公开语料校准）。
3. **参考音是合成音**，不是考试原声，语速与语调仅作示范。
4. 对麦克风与噪声敏感：安静环境 + 耳麦效果最好；外放会串音。

这些限制不是实现缺陷，而是"不依赖大模型 + 纯浏览器"路线的阶段性取舍，改进路径见文末路线图。

---

## 交接文档

换设备继续维护，或让 AI 接手，先读 [docs/HANDOVER.md](docs/HANDOVER.md)：
里面有读法规则、语料流水线顺序、音频合成参数、版本号机制和所有已知坑。

## 目录结构

```
pepec900-trainer/
├─ web/                     # 纯静态站点，可直接托管
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js                # 交互 + 录音 + 评分调度
│  ├─ lib/dsp.js            # FFT / 对数梅尔 / DTW / 逐词打分（纯函数）
│  ├─ data/corpus.js        # 由 corpus.json 生成的语料模块
│  └─ audio/{1..900}.mp3    # 参考音（约 28 MB）
├─ data/
│  ├─ corpus.json           # 900 句：原文 / 口语形式 / 词表 / 章节 / 读法提示
│  └─ audio_meta.json       # 参考音时长
├─ tools/
│  ├─ build_corpus.py       # PDF → 900 句 → ICAO 口语形式
│  ├─ build_audio.py        # 口语形式 → 参考音（离线 TTS）
│  ├─ export_web.py         # corpus.json → web/data/corpus.js
│  └─ test_dsp.mjs          # DSP 链路自检（Node）
├─ models/                  # TTS 语音（不入库，脚本下载）
└─ start.bat
```

---

## 读法标准

**通话中的读法**（本工具实际采用）：

| 原文 | 应读 |
|---|---|
| `VOR` / `DME` / `ILS` / `NDB` | V-O-R / D-M-E / I-L-S / N-D-B |
| `QNH 997` / `QFE 997` | Q-N-H niner niner seven / Q-F-E … |
| `HF` / `VHF` / `UHF` / `SSR` | H-F / V-H-F / U-H-F / S-S-R |
| `ATC` / `ADS-B` / `ELT` | A-T-C / A-D-S-B / E-L-T |
| `LOC` | localizer |
| `RNAV` / `TCAS` / `RAIM` | ar-nav / T-cas / raim |
| `BKM` / `BK-1A` / `HUR` | Bravo-Kilo-Mike / Bravo-Kilo-one-Alfa / Hotel-Uniform-Romeo |
| `NOTAM` / `CAVOK` / `MAYDAY` / `NOT` | 按词读，不拼字母 |

**标点停顿**：参考音保留原文的逗号与句号，合成时自然停顿；「应读」行仍按词显示（不含标点），便于逐词比对。

**数字**只在读出时特殊：3 → **TREE**、9 → **NINER**、小数点 → **DECIMAL**；其余按常规读法。

**ICAO 拼读词**（仅在需要逐字确认时使用，如读呼号、拼地名；界面中已不再展示此表）：

| | | | | | | | |
|---|---|---|---|---|---|---|---|
| A Alfa | B Bravo | C Charlie | D Delta | E Echo | F Foxtrot | G Golf | H Hotel |
| I India | J Juliett | K Kilo | L Lima | M Mike | N November | O Oscar | P Papa |
| Q Quebec | R Romeo | S Sierra | T Tango | U Uniform | V Victor | W Whiskey | X X-ray |
| Y Yankee | Z Zulu | | | | | | |

实例：

| 原文 | 应读 |
|---|---|
| `Maintaining FL310.` | maintaining flight level tree one zero |
| `Cleared VOR-DME approach Runway 24` | cleared V-O-R D-M-E approach runway two four |
| `Runway 36R` | runway tree six right |
| `Cleared for CAT II ILS approach` | cleared for category two I-L-S approach |

## 音色

参考音由 **Kokoro-82M**（kokoro-multi-lang-v1_0）离线合成，24 kHz。换音色只需改 `--sid`：

```bash
python tools/build_audio.py --engine kokoro --sid 16 --force
```

已内置的常用男声：`16`（默认，117 Hz）、`11`（121 Hz）、`12`（109 Hz）、`17`（低沉 87 Hz）、`24`（128 Hz）；女声 `0`（144 Hz）。
试听对比页：`web/audition/index.html`（同句多音色）。

## 维护语料与读法

改读法只需要动 `tools/build_corpus.py` 顶部的几张表：

- `DIGIT`：0–9 的读法
- `ALPHA`：26 个字母的 ICAO 拼读词（仅作参考表输出到界面）
- `WORD_ABBR`：按「词」读的缩写（NOTAM、CAVOK、SIGMET、MAYDAY…）
- `SPECIAL`：按「词」读的特定缩写（如 `LOC` → localizer）

然后依次执行：

```bash
python tools/build_corpus.py      # 重建 900 句与口语形式
python tools/export_web.py        # 导出前端模块
python tools/build_audio.py --force   # 重生成参考音（约 2 分钟）
```

DSP 链路自检：

```bash
node tools/test_dsp.mjs     # 应输出 PASS
```

---

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/pages.yml`，推送后自动把 `web/` 目录发布出去（自带 HTTPS，无需域名）。

```bash
# 1. 安装并登录 gh（只需一次）
winget install GitHub.cli
gh auth login

# 2. 建公开仓库并推送
cd pepec900-trainer
gh repo create pepec900-trainer --public --source . --push

# 3. 打开仓库 → Settings → Pages → Source 选 "GitHub Actions"
#    等 Actions 跑完，地址为 https://charlieling-jiajie.github.io/pepec900-trainer/
```

没有 `gh` 也可以：在 GitHub 网页新建仓库后执行

```bash
git remote add origin https://github.com/<账号>/pepec900-trainer.git
git push -u origin main
```

**更新流程**：改完 → `git add -A && git commit -m "..." && git push`，1–2 分钟后站点自动更新。
页面与资源都带 `?v=N` 版本号，改版后记得同时把 `v` 加一，避免浏览器用旧缓存。

**仓库体积**：`web/` 约 40 MB（900 条音频）。首次推送用的是压缩后的单条初始提交，之后只推增量。

> 语料为民航局公开发布的教材文本，仅用于学习交流；商用或再分发请自行确认授权。

---

## 路线图

| 版本 | 内容 |
|---|---|
| **v1.0（当前）** | 900 句 + ICAO 读法 + 带停顿的标准音 + 录音 + 逐词比对高亮 |
| v0.2 | **音素级判定**：wav2vec2 音素 CTC + 已知文本强制对齐 + GOP，能说出"此处把 tree 读成了 three" |
| v0.3 | 用 speechocean762（中文母语者语料）校准逐音素阈值；个人薄弱音素统计 |
| v1.0 | 多用户、云端同步进度、错句专项训练 |

## 许可

代码 MIT。教材文本版权归原发布方，本项目仅作学习用途，不作商业分发。
