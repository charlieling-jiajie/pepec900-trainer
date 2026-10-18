import CORPUS from './data/corpus.js?v=8';
import { logMel, trimSilence, cmvn, dtw, wordCosts, wordRangesBySyllable, scoreWords } from './lib/dsp.js?v=8';

const ASSET_V = '?v=8';   // 换语料或换音色时递增，强制绕过浏览器缓存

const S = CORPUS.sentences;
const CH = CORPUS.meta.chapters;
const HINT = CORPUS.meta.hintText;
const LS_KEY = 'pepec900.v1';

/* ---------------- 状态 ---------------- */
const st = {
  filter: 'all',        // all | ch1..ch8 | wrong
  order: 'random',      // random | seq
  idx: null,
  rate: 1,
  recording: false,
  reveal: false,        // 是否显示原文
  showSpoken: false,    // 评分后显示「应读」与逐词高亮
  last: null,           // 上次评分结果
  db: load(),
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { rec: d.rec || {}, wrong: d.wrong || {}, seen: d.seen || [] };
  } catch { return { rec: {}, wrong: {}, seen: [] }; }
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(st.db)); } catch {} }

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const el = {
  warn: $('warn'), chapterBar: $('chapterBar'), modeBar: $('modeBar'),
  sid: $('sid'), chap: $('chap'), meta: $('meta'), text: $('text'),
  spoken: $('spoken'), hints: $('hints'),
  play: $('btnPlay'), rec: $('btnRec'), stop: $('btnStop'), speed: $('speedBox'),
  meter: $('meter'), wave: $('wave'), timer: $('timer'),
  result: $('result'), scoreVal: $('scoreVal'), scoreLabel: $('scoreLabel'),
  detail: $('detail'), verdict: $('verdict'),
  next: $('btnNext'), again: $('btnAgain'), pill: $('pillStat'),
  reveal: $('btnReveal'), textWrap: $('textWrap'), spokenWrap: $('spokenWrap'), placeholder: $('placeholder'),
};

/* file:// 下 fetch 音频会被拦，给出提示 */
if (location.protocol === 'file:') {
  el.warn.classList.add('on');
  el.warn.innerHTML = '当前是本地文件方式打开，浏览器会阻止读取音频文件，<b>评分将不可用</b>。'
    + '请双击项目根目录的 <code>start.bat</code>（或运行 <code>python -m http.server 8080</code>）后访问 http://localhost:8080 。';
}

/* ---------------- 语料筛选 ---------------- */
function pool() {
  if (st.filter === 'all') return S;
  if (st.filter === 'wrong') return S.filter(s => st.db.wrong[s.id]);
  const c = Number(st.filter.slice(2));
  return S.filter(s => s.ch === c);
}

function pick() {
  const p = pool();
  if (!p.length) return null;
  if (st.order === 'seq') {
    const cur = st.idx ? p.findIndex(s => s.id === st.idx) : -1;
    return p[(cur + 1 + p.length) % p.length];
  }
  const recent = new Set(st.db.seen.slice(-18));
  const cand = p.filter(s => !recent.has(s.id));
  const use = cand.length ? cand : p;
  const w = use.map(s => {
    const r = st.db.rec[s.id];
    if (!r) return 4;
    if (r.last < 60) return 6;
    if (r.last < 82) return 3;
    return 1;
  });
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < use.length; i++) { x -= w[i]; if (x <= 0) return use[i]; }
  return use[use.length - 1];
}

/* ---------------- 渲染 ---------------- */
function renderBar() {
  const items = [{ k: 'all', t: '全部 900' }, ...CH.map(c => ({ k: 'ch' + c.id, t: `第${c.id}章` })), { k: 'wrong', t: '错句本' }];
  el.chapterBar.innerHTML = items.map(it =>
    `<span class="chip ${st.filter === it.k ? 'on' : ''} ${it.k === 'wrong' ? 'ghost' : ''}" data-f="${it.k}">${it.t}</span>`
  ).join('');
  el.modeBar.innerHTML = [
    { k: 'random', t: '随机' }, { k: 'seq', t: '顺序' },
  ].map(it => `<span class="chip ${st.order === it.k ? 'on' : ''}" data-o="${it.k}">${it.t}</span>`).join('');

  el.chapterBar.querySelectorAll('[data-f]').forEach(n => n.onclick = () => {
    st.filter = n.dataset.f; renderBar(); next();
  });
  el.modeBar.querySelectorAll('[data-o]').forEach(n => n.onclick = () => {
    st.order = n.dataset.o; renderBar();
  });
}

function renderSentence(s) {
  st.idx = s.id;
  st.db.seen.push(s.id);
  if (st.db.seen.length > 400) st.db.seen = st.db.seen.slice(-300);
  save();

  const c = CH.find(x => x.id === s.ch);
  el.sid.textContent = '#' + s.id;
  el.chap.textContent = `第${s.ch}章 · ${c ? c.name : ''}`;
  const r = st.db.rec[s.id];
  el.meta.textContent = r ? `练过 ${r.n} 次 · 最好 ${r.best}` : '未练过';
  el.text.textContent = s.text;
  el.spoken.innerHTML = s.words.map((w, i) =>
    `<span class="w" data-i="${i}">${w}</span>`).join('');
  el.hints.innerHTML = s.hints.map(h => `<span class="hint">${HINT[h] || h}</span>`).join('');

  st.reveal = false;
  st.showSpoken = false;
  applyReveal();

  el.result.classList.remove('on');
  el.scoreVal.textContent = '—';
  el.verdict.textContent = '';
  el.detail.textContent = '';
  el.wave.width = el.wave.clientWidth; el.wave.height = el.meter.clientHeight || 56;
  drawIdle();
  updatePill();
}

function applyReveal() {
  el.textWrap.classList.toggle('hide', !st.reveal);
  el.spokenWrap.classList.toggle('hide', !(st.reveal || st.showSpoken));
  el.placeholder.classList.toggle('hide', st.reveal || st.showSpoken);
  el.reveal.textContent = st.reveal ? '隐藏原文' : '原文';
  el.reveal.classList.toggle('on', st.reveal);
}

function updatePill() {
  const n = Object.keys(st.db.rec).length;
  const w = Object.keys(st.db.wrong).length;
  el.pill.textContent = `已练 ${n} / 900 · 错句 ${w}`;
}

/* ---------------- 播放 ---------------- */
const audio = new Audio();
audio.preload = 'auto';
let playTimer = null;

function play() {
  if (st.recording) return;
  if (!st.idx) return;
  if (st.reveal) { st.reveal = false; applyReveal(); }   // 播放时不显示原文
  audio.src = `audio/${st.idx}.mp3${ASSET_V}`;
  audio.playbackRate = st.rate;
  audio.currentTime = 0;
  const p = audio.play();
  if (p) p.catch(() => {});
  el.play.classList.add('primary');
  clearInterval(playTimer);
  playTimer = setInterval(() => {
    if (audio.paused) { clearInterval(playTimer); drawIdle(); return; }
    drawProgress(audio.currentTime / (audio.duration || 1));
  }, 60);
}

el.play.onclick = play;
el.speed.querySelectorAll('button').forEach(b => b.onclick = () => {
  st.rate = Number(b.dataset.rate);
  el.speed.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  if (!audio.paused) audio.playbackRate = st.rate;
});

/* ---------------- 波形显示 ---------------- */
const cvs = el.wave, ctx2d = cvs.getContext('2d');
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = cvs.clientWidth || 600, h = cvs.clientHeight || 56;
  cvs.width = w * dpr; cvs.height = h * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawIdle() {
  fitCanvas();
  const w = cvs.clientWidth, h = cvs.clientHeight;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.strokeStyle = '#e3e8ef'; ctx2d.lineWidth = 1;
  ctx2d.beginPath(); ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2); ctx2d.stroke();
}
function drawProgress(p) {
  fitCanvas();
  const w = cvs.clientWidth, h = cvs.clientHeight;
  ctx2d.clearRect(0, 0, w, h);
  if (!isFinite(p)) return;
  ctx2d.fillStyle = '#e8eefb';
  ctx2d.fillRect(0, 0, w * Math.min(1, Math.max(0, p)), h);
  ctx2d.strokeStyle = '#1d4ed8'; ctx2d.lineWidth = 2;
  ctx2d.beginPath(); ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2); ctx2d.stroke();
}

/* ---------------- 录音 ---------------- */
let stream, mr, chunks = [], ac, analyser, srcNode, rafId, t0, recTimer;

async function ensureAC() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') await ac.resume();
  return ac;
}

async function startRec() {
  if (st.recording) return;
  audio.pause();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    el.warn.classList.add('on');
    el.warn.textContent = '无法访问麦克风：' + (e && e.message ? e.message : e) + '。请检查浏览器权限（需 https 或 localhost）。';
    return;
  }
  chunks = [];
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = onRecStop;

  const a = await ensureAC();
  srcNode = a.createMediaStreamSource(stream);
  analyser = a.createAnalyser();
  analyser.fftSize = 1024;
  srcNode.connect(analyser);

  mr.start(120);
  st.recording = true;
  el.rec.classList.add('rec-on');
  el.rec.disabled = true; el.play.disabled = true;
  el.stop.disabled = false;
  el.meter.classList.add('on');
  fitCanvas();
  t0 = performance.now();
  el.timer.textContent = '0.0s';
  recTimer = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    el.timer.textContent = s.toFixed(1) + 's';
    if (s > 16) stopRec();
  }, 100);
  drawMeter();
}

function drawMeter() {
  if (!st.recording) return;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  const w = cvs.clientWidth, h = cvs.clientHeight;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.strokeStyle = '#b91c1c'; ctx2d.lineWidth = 1.6;
  ctx2d.beginPath();
  const n = buf.length;
  for (let i = 0; i < n; i += 4) {
    const x = (i / n) * w;
    const y = h / 2 + ((buf[i] - 128) / 128) * (h / 2 - 4);
    i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();
  rafId = requestAnimationFrame(drawMeter);
}

function stopRec() {
  if (!st.recording) return;
  st.recording = false;
  clearInterval(recTimer);
  cancelAnimationFrame(rafId);
  try { mr.stop(); } catch {}
  stream && stream.getTracks().forEach(t => t.stop());
  el.rec.classList.remove('rec-on');
  el.rec.disabled = false; el.play.disabled = false; el.stop.disabled = true;
}

async function onRecStop() {
  const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
  el.meter.classList.remove('on');
  if (blob.size < 2000) { el.result.classList.add('on'); el.scoreVal.textContent = '—'; el.verdict.textContent = '录音太短，请重录。'; return; }
  el.result.classList.add('on');
  el.scoreVal.textContent = '…';
  el.verdict.textContent = '正在比对…';
  try {
    await score(blob);
  } catch (e) {
    el.scoreVal.textContent = '—';
    el.verdict.textContent = '比对失败：' + (e && e.message ? e.message : e);
    console.error(e);
  }
}

/* ---------------- 音频解码 ---------------- */
const refCache = new Map();

async function decodeTo16k(arrayBuffer) {
  const a = await ensureAC();
  const buf = await a.decodeAudioData(arrayBuffer.slice(0));
  if (Math.abs(buf.sampleRate - 16000) < 1 && buf.numberOfChannels === 1) {
    return buf.getChannelData(0).slice();
  }
  const len = Math.max(1, Math.ceil(buf.duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const s = off.createBufferSource();
  s.buffer = buf; s.connect(off.destination); s.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

async function refSamples(id) {
  if (refCache.has(id)) return refCache.get(id);
  const r = await fetch(`audio/${id}.mp3${ASSET_V}`);
  if (!r.ok) throw new Error('缺少参考音 ' + id + '.mp3');
  const samples = await decodeTo16k(await r.arrayBuffer());
  refCache.set(id, samples);
  return samples;
}

/* ---------------- 评分 ---------------- */
function feats(samples) {
  if (samples.length < 400 * 8) throw new Error('录音过短');
  const { frames, energy } = logMel(samples, 16000);
  const [a, b] = trimSilence(energy);
  const cut = frames.slice(a, b + 1);
  if (cut.length < 6) throw new Error('录音过短');
  return { n: cmvn(cut) };
}

async function score(blob) {
  const s = S.find(x => x.id === st.idx);
  const [ref, user] = await Promise.all([
    refSamples(s.id),
    blob.arrayBuffer().then(decodeTo16k),
  ]);

  const A = feats(ref), B = feats(user);
  const ranges = wordRangesBySyllable(s.syl, A.n.length, s.gaps || []);
  const res = dtw(A.n, B.n, 0.35);
  const costs = wordCosts(A.n, B.n, res, ranges);
  const sc = scoreWords(costs);

  const refDur = ref.length / 16000, userDur = user.length / 16000;
  const ratio = userDur / refDur;

  // 高亮
  st.showSpoken = true;
  applyReveal();
  const nodes = el.spoken.querySelectorAll('.w');
  sc.forEach((v, i) => {
    const n = nodes[i]; if (!n) return;
    n.classList.remove('good', 'mid', 'bad');
    n.classList.add(v >= 82 ? 'good' : v >= 62 ? 'mid' : 'bad');
    n.title = v + ' 分';
  });

  // 分数
  const mean = sc.reduce((x, y) => x + y, 0) / sc.length;
  const dim = sc.filter(v => v < 62).length;
  const overall = Math.round(Math.max(0, mean - dim * 1.6));
  el.scoreVal.textContent = overall;
  el.scoreLabel.textContent = '句内相对评分（v1.0 声学比对）';
  el.detail.innerHTML = `偏差词 <b>${dim}</b> / ${sc.length} · 语速比 <b>${ratio.toFixed(2)}×</b> · 时长 <b>${userDur.toFixed(1)}s</b> / ${refDur.toFixed(1)}s`;

  // 结论
  const bad = sc.map((v, i) => [v, i]).filter(x => x[0] < 62).sort((a, b) => a[0] - b[0]).slice(0, 3);
  const parts = [];
  if (ratio < 0.72) parts.push('录音长度明显短于标准音，可能有 <b>漏读</b> 或吞音。');
  if (ratio > 1.45) parts.push('语速明显偏慢，注意连贯。');
  if (bad.length) {
    parts.push('偏离最明显：' + bad.map(([v, i]) => `<span class="bad-t">${s.words[i]}</span>（${v}）`).join('、') + '。');
    const hs = bad.map(([, i]) => s.words[i]).filter(w => HINT[w]).map(w => HINT[w]);
    if (hs.length) parts.push('提示：' + [...new Set(hs)].join('；'));
  } else {
    parts.push('各词都比较贴近标准音，可以进入下一句。');
  }
  el.verdict.innerHTML = parts.join('<br>');

  // 存库
  const rec = st.db.rec[s.id] || { n: 0, best: 0, last: 0 };
  rec.n++; rec.last = overall; rec.best = Math.max(rec.best, overall);
  st.db.rec[s.id] = rec;
  if (overall < 62) st.db.wrong[s.id] = 1; else if (overall >= 85) delete st.db.wrong[s.id];
  save();
  el.meta.textContent = `练过 ${rec.n} 次 · 最好 ${rec.best}`;
  updatePill();
}

/* ---------------- 交互 ---------------- */
el.rec.onclick = startRec;
el.stop.onclick = stopRec;
el.next.onclick = next;
el.again.onclick = () => { if (st.recording) return; startRec(); };
el.reveal.onclick = () => {
  if (st.recording) return;
  st.reveal = !st.reveal;
  if (st.reveal) st.showSpoken = true;
  applyReveal();
};

function next() {
  const s = pick();
  if (!s) {
    el.textWrap.classList.remove('hide');
    el.text.textContent = '（该筛选下没有句子）';
    el.placeholder.classList.add('hide');
    return;
  }
  renderSentence(s);
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.key === 'Enter')) return;
  if (e.code === 'Space') { e.preventDefault(); st.recording ? stopRec() : play(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); st.recording ? stopRec() : startRec(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); next(); }
  else if (e.key === 't' || e.key === 'T') {
    if (st.recording) return;
    e.preventDefault(); st.reveal = !st.reveal;
    if (st.reveal) st.showSpoken = true;
    applyReveal();
  }
});

window.addEventListener('resize', () => { fitCanvas(); drawIdle(); });

/* ---------------- 启动 ---------------- */
renderBar();
next();
drawIdle();
