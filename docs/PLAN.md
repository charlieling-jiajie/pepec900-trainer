# PEPEC 900 复诵训练器 — 技术规划 v0.1

> 目标：随机抽取 PEPEC 900 句中的句子 → 播报标准参考音 → 使用者复诵录音 → **不依赖任何大模型**判定"哪里读对、哪里读错"。
> 语料来源：`PEPEC900.pdf`（中国民航局飞行标准司，2014-08，66 页，8 章，900 句）。

---

## 0. 结论速览

| 决策项 | 结论 |
|---|---|
| 呈现形式 | **本地优先的 Web 应用**（FastAPI 后端 + 浏览器前端），PC 与手机同一套界面 |
| 部署方式 | Windows 本机 `docker compose up` 即可；也可部署到 `192.168.3.100`（Debian）做家庭内服务，手机浏览器直接练 |
| 判分技术路线 | **已知文本的 CTC 强制对齐 + 逐音素 GOP**，非 ASR + 文本比对，非大模型 |
| 判分模型 | `facebook/wav2vec2-lv-60-espeak-cv-ft`（音素级 CTC，315M 参数，CPU 可跑） |
| 阈值来源 | `speechocean762`（CC BY 4.0，250 名**中文母语者**的英语发音，五专家音素级评分） |
| 可复用开源骨架 | **`xialeistudio/echoic`（MIT）** — 直接 fork 改造，不自建 |
| 仓库策略 | 代码公开 / 语料与音频可分离；模型与音频不进 git，用下载脚本 |
| 预估工作量 | 5 个里程碑，约 8–9 个有效工作日 |

---

## 1. 需求拆解

| 编号 | 需求 | 判定标准 |
|---|---|---|
| R1 | 随机播放 900 句中的句子 | 可限定章节、可排除"已掌握"、可重复练习错句 |
| R2 | 录音复诵 | 浏览器授权麦克风，一键录/停/回放 |
| R3 | 判对错到"位置" | 词级高亮：正确 / 读错（并指出听成了什么）/ 漏读 / 多读 |
| R4 | 不用大模型 | 全部本地推理，无 API 调用，可断网运行 |
| R5 | 航空特殊读音识别 | TREE / FIFE / NINER / TOU-SAND / DAY-SEE-MAL / 字母拼读 |
| R6 | 进度沉淀 | 历史记录、错句本、薄弱音素统计 |
| R7 | GitHub 备份与更新 | git 版本管理 + CI + Release |

**明确不做**：不评估语法/语义（那是 LLM 的活）、不做 ICAO 等级评分、不做自由对话。

---

## 2. 形式选型

| 方案 | 优点 | 缺点 | 判断 |
|---|---|---|---|
| **A. 本地 Web（FastAPI + React/PWA）** | 录音用浏览器原生 API；手机/平板/PC 通吃；Docker 一条命令部署；后续可用 Tauri 套壳变桌面版 | 需要保持后端进程运行 | **推荐** |
| B. 桌面单机（Tauri/Electron + Python 侧车） | 双击即用，无浏览器 | 打包体积 1.5GB+，跨平台打包成本高，手机用不了 | 二期可选 |
| C. 纯浏览器（WASM + onnxruntime-web） | 零安装、可静态托管 | 需把 315M 参数模型转 ONNX 量化后塞进浏览器（≥300MB 下载），首次加载极慢，移动端易 OOM | 不推荐 |
| D. 原生 App（Android/iOS） | 手感最好 | 开发成本 3 倍，判分后端仍要跑模型 | 不推荐 |

**结论**：A。前端做成 PWA，手机"添加到主屏幕"后体验接近原生。

---

## 3. 判分引擎（核心）

### 3.1 为什么不走"ASR 转文字再比对"

ASR 输出的是**它认为最可能的词**。复诵者把 "three" 念成 "tree"、把 "nine" 念成 "niner"，ASR 往往直接给出正确拼写，错误被"纠错"抹掉 → 判不出错。而且 ASR 的词错率会掩盖音素级细节。

正确做法：**题干已知 → 只做强制对齐**。把"应该念的音素序列"和"实际音频"做 CTC 对齐，逐帧看模型对目标音素的置信度（GOP）。这条路径不需要语言模型，也不需要解码搜索，短句在 CPU 上 <1s。

### 3.2 五级流水线

```
①  书面文本        "Maintaining FL310."
        │  spoken_form 规则层（数字/字母/缩写/航路点）
        ▼
②  口语形式        "maintaining flight level three one zero"
        │  发音词典（CMUdict + 航空覆盖词典），ARPAbet → IPA(espeak 音素集)
        ▼
③  目标音素序列    m eI n t eI n ... f l aI t l E v @ l ...
        │                                    ▲
        │  用户录音 16kHz 单声道              │ CTC 强制对齐
        ▼                                    │（torchaudio.functional.forced_align）
④  音素后验矩阵    P(phone | frame)  T×N  ──┘
        │  逐音素 GOP = log P(target) − log P(best competitor)
        ▼
⑤  判定与高亮      词级：correct / wrong(→听成什么) / missing / extra
```

### 3.3 判定分三层（避免"满屏报红"）

| 层 | 判定内容 | 方法 |
|---|---|---|
| L1 结构 | 漏词、多词、语序 | 对齐路径上的 gap / 未匹配帧 |
| L2 音素 | 该音素是否读准 | GOP 对照**该音素专属阈值**（不是全局阈值） |
| L3 航空规则 | 是否用了航空惯用读法 | 规则检测：数字位是否 TREE/FIFE/NINER，字母是否拼读，`FL` 是否展开 |

L3 是本项目相对通用发音软件（含 Echoic）的核心差异点：普通工具会把 "three one zero" 判为完全正确，但航线上应读 "tree wun ze-ro"。

### 3.4 阈值校准（关键工程细节）

实测结论：**不同音素的后验基线差异极大**——母语者的 `s` 接近满置信，而 `θ` 即使读得标准，模型平均也只有 -2.6。单一阈值必然同时造成"误报母语者"和"漏报真错误"。

做法：
1. 用 `speechocean762` 跑一遍，得到每个音素的"读对"分布（μ, σ）；
2. 阈值取 `μ − 1.6σ`（该音素自己的线，随音素移动）；
3. 前后半数据分离：一半拟合、一半验证，报告误报率/检出率；
4. 上线后按使用者个人做轻微自适应（仅在连续 10 次通过时上调，防止漂移）。

### 3.5 架构简化建议

Echoic 用了 WhisperX 做转写 + wav2vec2 做对齐。本项目**不需要转写**（题干已知），可整段删掉 `faster-whisper` / `CTranslate2`，只保留音素模型：
- 依赖体积从约 2.5GB 降到约 1.4GB；
- 冷启动从 40s+ 降到 <10s；
- CPU 内存峰值从约 6GB 降到约 2.5GB。

---

## 4. 航空读音层（已按你确认的标准落地）

### 4.1 数字读法（你 2026-10-18 确认的版本）

| 数字 | 标准读法 |
|---|---|
| 3 | **TREE** |
| 9 | **NINER** |
| 小数点 | **DECIMAL** |
| 其余 | 常规读法：zero / one / two / four / five / six / seven / eight |

> 千位仍读 "thousand"（如 `3000 feet` → three thousand feet），因为这是自然语流中的数词，不是逐位读。

### 4.2 字母（通话中直接读字母）

用户确认：**缩写与航路点直接读字母**，不读拼读词。

| 原文 | 应读 | 备注 |
|---|---|---|
| `VOR` `DME` `ILS` `NDB` `QNH` `QFE` | V-O-R / D-M-E / I-L-S / N-D-B / Q-N-H / Q-F-E | 逐个字母 |
| `LOC` | localizer | 按词读 |
| `NOTAM` `CAVOK` `METAR` `TAF` `SIGMET` `MAYDAY` | 按词读 | 见 `WORD_ABBR` |
| 航路点 / 程序名（`BKM`、`BK-1A`、`JEMMY`） | B-K-M / B-K-one-A | 逐个字母 + 数字 |

26 个字母的 ICAO 拼读词（Alfa/Bravo/…/Zulu）保留在 `ALPHA` 表与界面「读法表」中，
作为**逐字确认场合**（读呼号、拼地名）的参考，不参与本工具的参考音合成。

### 4.3 书面 → 口语的转换规则（节选）

| 书面 | 口语形式 |
|---|---|
| `FL310` | flight level three one zero |
| `FL90` | flight level nine zero |
| `3000 feet` | three thousand feet |
| `QNH 1012` | Q N H one zero one two |
| `Runway 36R` | runway three six right |
| `Mach decimal 76` | mach decimal seven six |
| `250 knots` | two five zero knots |
| `4 miles final` | four miles final |
| `2000 feet per minute` | two thousand feet per minute |
| `level by 55` | level by five five |

### 4.4 语料内部的不一致（必须由你裁决）

第 33 句为 `Mach decimal 76`，第 34/35 句却是 `Mach point 84 / point 80`。同一份教材两种写法。
- 若以 ICAO 为准 → 统一转 `decimal`，`point` 视为过时写法；
- 若以教材音频为准 → 保留双读法，都判对。

---

## 5. 语料现状（实测，非估算）

对 `PEPEC900.pdf` 实际解析结果：

| 指标 | 实测值 | 影响 |
|---|---|---|
| 页数 / 句子总数 | 66 页 / **900 句全齐**（1–900 无缺号） | 语料完整，可直接用 |
| 章节 | 8 章，分布 86 / 137 / 71 / 87 / 59 / 260 / 100 / 100 | 第六章（紧急情况）占 260 句，随机抽句需按章加权 |
| **跨行句子** | **416 句**（46%）跨 2–3 行，部分被分页截断 | 朴素按行抽取会丢半句，必须做续行合并 |
| 缺空格 | 12 处（`RNPapproach`、`BK-1ADeparture`、`JEMMYvia`…） | 需词典化重切分 |
| 全角标点 | 1 处（第 5 句 `，`） | 统一转半角 |
| 含数字的句子 | 342 句（38%） | 数字读法是主要工作量 |
| 含 `FLxx` | 79 处 | 高频规则 |
| 含跑道号 | 56 处 | 含 L/C/R 后缀 |
| 大写缩略语 | 195 句 / **134 种** | 需逐项定读音 |
| 最长句 | 179 字符 | 录音时长上限按 15s 设计 |

> 已完成：`data/pepec900.json`（900 句，编号 + 文本）。剩余为清洗与校对，预计 1–2 小时人工复核。

---

## 6. 参考音（TTS vs 真人）

| 方案 | 说明 | 结论 |
|---|---|---|
| edge-tts（`en-US-GuyNeural`） | 免费、语速语调自然、批量 900 句约 10 分钟 | **先跑通** |
| piper / sherpa-onnx TTS | 完全离线，质量略逊 | 断网场景备选 |
| 真人录音 | 最贴近考试原声 | 二期再议 |

**关键细节**：TTS 输入必须喂**口语形式**（`tree wun ze-ro`），不能喂书面文本（`310`）。否则参考音读 "three-one-zero"，而判分期望 "tree wun ze-ro"，标准与示范互相打架——这是此类工具最常见的隐性缺陷。

音频产物统一 16kHz 单声道 m4a，900 条约 25MB，放 `assets/audio/`（git-lfs 或 Release 附件）。

---

## 7. 开源调研与复用决策

| 项目 | 定位 | 许可证 | 可复用度 | 结论 |
|---|---|---|---|---|
| **`xialeistudio/echoic`** | React+FastAPI 的发音练习平台，wav2vec2 + phonemizer 做音素级评分，逐句练习、录音、A/B 对比、历史、热力图，**评分不依赖 LLM** | **MIT** | ★★★★★ | **作为骨架 fork**，删 WhisperX，换航空规则层 |
| `varsha2503/Pronunciation_Scoring` | MFA + wav2vec2 GOP + DTW 流利度，脚本形态 | 未标注 | ★★☆ | 算法参考（DTW 流利度部分可借鉴），工程不适合直接跑 |
| `a2d8a4v/CTC-based-GOP` | Interspeech 2024 论文代码，CTC-GOP 的权威实现与评测 | 学术代码 | ★★★ | **GOP 公式与归一化方法的参考基准**，抄算法不抄工程 |
| `teinhonglo/modelz-mdd` | 端到端发音检错（MDD）服务，wav2vec CTC + GOP | 未标注 | ★★☆ | 其"诊断（读成了什么）"思路可借鉴；但它用 LLM 生成建议，与本项目约束冲突 |
| `k2-fsa/sherpa-onnx` | 离线 ASR/TTS/VAD/KWS，纯 ONNX，跨平台 | Apache-2.0 | ★★★ | 若后期想去掉 PyTorch 依赖（打包更小、启动更快），用它的 ONNX 音素模型替代 |
| `Montreal Forced Aligner` | 传统强制对齐金标准 | MIT | ★★ | 精度高但依赖 Kaldi/conda，体积与部署成本过高，不采用 |
| `speechocean762`（OpenSLR 101） | 5000 条**中文母语者**英语发音，五专家音素级标注 | CC BY 4.0 | ★★★★★ | **阈值校准数据集**，与本项目目标人群高度匹配 |
| `chizuko-prg/aviation-english-response-trainer` | 航空英语应答练习（React 静态站，Web Speech API） | 代码 MIT / 内容 CC BY-NC | ★☆ | 只做示范朗读、无录音无评分；UI/情景题设计可参考 |
| `DQ-HollyLee/icao900-asmr` | 用 TTS 批量渲染 ICAO 900 句并做字幕 | — | ★★ | 其"批量 TTS + 字幕对齐"脚本思路可复用（TTS 用 ElevenLabs，需换 edge-tts） |

**不推荐从零写**。Echoic 已经解决了 80% 的通用问题（录音、逐句、评分调用、历史、对比播放），本项目真正的增量在三处：
1. **航空口语化层**（书面 → 口语 → 音素）；
2. **L3 航空读法规则判定**；
3. **纯文本语料的随机抽句**（Echoic 以音频文件为导入单位，没有"900 句题库"概念）。

---

## 8. 仓库结构与技术栈

```
pepec900-trainer/
├─ data/
│  ├─ pepec900.json          # 900 句：编号/章节/文本/口语形式
│  ├─ lexicon_aviation.yaml  # 航空读音覆盖（数字、字母、缩写、航路点）
│  └─ thresholds.json        # 校准后的逐音素阈值
├─ backend/
│  └─ app/
│     ├─ api/                # /sentences /score /audio /stats
│     ├─ scoring/            # normalize.py  align.py  gop.py  verdict.py
│     └─ tts/                # 参考音生成与缓存
├─ frontend/                 # Vite + React + Tailwind + WaveSurfer
├─ tools/
│  ├─ extract_pdf.py         # PDF → 900 句（含续行合并、缺空格修复）
│  ├─ build_spoken.py        # 书面 → 口语形式
│  ├─ gen_tts.py             # 口语形式 → 参考音
│  └─ calibrate.py           # speechocean762 → 阈值
├─ assets/audio/             # 参考音（git-lfs / Release）
├─ docker-compose.yml
├─ scripts/download_models.py
└─ .github/workflows/ci.yml
```

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | FastAPI + SQLite（非 Postgres） | 单用户场景，SQLite 免运维，Echoic 的 Postgres 是过度设计 |
| 前端 | React 18 + Vite + Tailwind + WaveSurfer.js | 与 Echoic 一致，改造成本最低 |
| 推理 | PyTorch CPU + torchaudio.forced_align | 无需 GPU，无需 Kaldi |
| 建模 | wav2vec2-lv-60-espeak-cv-ft | 音素级 CTC，多语言，espeak 音素集与 IPA 可映射 |
| 词典 | CMUdict + 航空覆盖 + `g2p_en` 兜底 | 规避 Windows 上 espeak-ng 的安装麻烦 |

---

## 9. 里程碑

| 阶段 | 内容 | 验收标准 | 估时 |
|---|---|---|---|
| **M0 数据与仓库** | PDF 清洗成 900 句、口语化规则、GitHub 建仓与 CI 骨架 | `data/pepec900.json` 人工抽检 30 句零错误 | 0.5 天 |
| **M1 播放与录音** | 抽句（按章加权/随机）、TTS 参考音、录音、波形对比 | 手机上可完整跑一轮"听→录→回放" | 2 天 |
| **M2 判分内核** | 音素化、强制对齐、GOP、词级高亮 | 20 条自录样本，人工标注一致率 ≥80% | 3 天 |
| **M3 航空规则层** | TREE/FIFE/NINER/TOUSAND/DECIMAL、字母拼读、缩写读音 | 人造"通用读法"样本能被稳定标出（如 three 替代 tree） | 2 天 |
| **M4 沉淀与部署** | 错句本、薄弱音素统计、Docker、局域网访问、CI | `192.168.3.100:8090` 手机可访问，数据持久化 | 1 天 |

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 口音/麦克风差异导致误判 | 信任度崩塌（比漏判更伤） | 校准阈值偏保守（宁漏勿误）；提供"我觉得读对了"申诉按钮，收集为个人校准样本 |
| 模型对 `θ/ð` 等音素基线低 | 系统性误报 | 逐音素阈值，不做全局阈值（见 3.4） |
| 航空读法与通用英语冲突 | 判分标准争议 | 双读法白名单：`tree` 得分高于 `three` 但 `three` 不判错，只在 L3 提示"建议用航空读法" |
| 900 句语料版权 | 公开仓库风险 | 代码公开、语料私有（见 §11 Q4） |
| 首次下载 1.4GB 模型 | 上手门槛 | 提供国内镜像脚本 + 进度条；模型不进 git |
| Windows 无 espeak-ng | phonemizer 不可用 | 用 CMUdict + g2p_en 纯 Python 方案，绕开系统依赖 |

---

## 11. 待确认（需要你拍板）

1. **部署位置**：只在本机 Windows 跑，还是也部署到 `192.168.3.100` 让手机/平板随时练？（影响是否要 PWA + HTTPS）
2. **严格度取向**：优先"少误报"（读准了绝不冤枉你），还是优先"揪错彻底"（宁可多报）？默认我选前者 7:3。
3. **读音标准**：完全以 ICAO Doc 9432 为准，还是以教材配套音频为准？（`Mach point` vs `Mach decimal` 就是分水岭）
4. **仓库公开性**：代码公开 + 语料私有？还是整个仓库私有？（本机暂无 `gh` CLI，需要装或用 PAT 推送）
5. **缩写读音表**：`ILS / VOR / RNAV / CPDLC` 这些，你们单位实际是逐字母读还是按词读？有现成清单最好。
6. **是否已有配套音频**：如果有教材官方录音或 ICAO 考试原声，参考音质量会显著优于 TTS。

---

## 附录 A：ICAO 字母拼读表

| 字母 | 词 | 发音 | 字母 | 词 | 发音 |
|---|---|---|---|---|---|
| A | Alfa | AL FAH | N | November | NO VEM BER |
| B | Bravo | BRAH VOH | O | Oscar | OSS CAH |
| C | Charlie | CHAR LEE | P | Papa | PAH PAH |
| D | Delta | DELL TAH | Q | Quebec | KEH BECK |
| E | Echo | ECK OH | R | Romeo | ROW ME OH |
| F | Foxtrot | FOKS TROT | S | Sierra | SEE AIR RAH |
| G | Golf | GOLF | T | Tango | TANG GO |
| H | Hotel | HOH TELL | U | Uniform | YOU NEE FORM |
| I | India | IN DEE AH | V | Victor | VIK TAH |
| J | Juliett | JEW LEE ETT | W | Whiskey | WISS KEY |
| K | Kilo | KEY LOH | X | X-ray | ECKS RAY |
| L | Lima | LEE MAH | Y | Yankee | YANG KEY |
| M | Mike | MIKE | Z | Zulu | ZOO LOO |
