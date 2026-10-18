/**
 * dsp.js — 轻量声学比对内核（无模型、无网络、无大模型）
 * 纯函数，浏览器与 Node 通用。
 *
 * 流程：语音 -> 对数梅尔特征 -> CMVN -> 带约束 DTW -> 逐词相对代价
 */

const MEL_FFT = 512;
const MEL_WIN = 400;   // 25ms @16k
const MEL_HOP = 160;   // 10ms @16k
const N_MELS = 40;

/* ---------------- FFT ---------------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function hz2mel(f) { return 2595 * Math.log10(1 + f / 700); }
function mel2hz(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

function melBank(sr) {
  const lo = hz2mel(80), hi = hz2mel(sr / 2);
  const pts = [];
  for (let i = 0; i < N_MELS + 2; i++) pts.push(mel2hz(lo + (hi - lo) * i / (N_MELS + 1)));
  const bins = [];
  for (let i = 0; i < N_MELS + 2; i++) bins.push(Math.floor((MEL_FFT + 1) * pts[i] / sr));
  const bank = [];
  for (let m = 1; m <= N_MELS; m++) {
    const row = new Float32Array(MEL_FFT / 2 + 1);
    const l = bins[m - 1], c = bins[m], r = bins[m + 1];
    for (let k = l; k < c; k++) if (c > l) row[k] = (k - l) / (c - l);
    for (let k = c; k < r; k++) if (r > c) row[k] = (r - k) / (r - c);
    bank.push(row);
  }
  return bank;
}

const _hann = (() => {
  const w = new Float32Array(MEL_WIN);
  for (let i = 0; i < MEL_WIN; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (MEL_WIN - 1));
  return w;
})();

/** 逐帧对数梅尔能量；返回 {frames: Float32Array[], energy: Float32Array} */
export function logMel(samples, sr = 16000) {
  const bank = melBank(sr);
  const nFrames = Math.max(1, Math.floor((samples.length - MEL_WIN) / MEL_HOP) + 1);
  const frames = [], energy = new Float32Array(nFrames);
  const re = new Float64Array(MEL_FFT), im = new Float64Array(MEL_FFT);
  for (let t = 0; t < nFrames; t++) {
    const off = t * MEL_HOP;
    let e = 0;
    for (let i = 0; i < MEL_FFT; i++) {
      const s = i < MEL_WIN && off + i < samples.length ? samples[off + i] * _hann[i] : 0;
      re[i] = s; im[i] = 0; e += s * s;
    }
    energy[t] = Math.sqrt(e / MEL_WIN);
    fft(re, im);
    const mel = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      const row = bank[m];
      let acc = 0;
      for (let k = 1; k < MEL_FFT / 2; k++) acc += row[k] * (re[k] * re[k] + im[k] * im[k]);
      mel[m] = Math.log(acc + 1e-10);
    }
    frames.push(mel);
  }
  return { frames, energy };
}

/** 按能量裁剪首尾静音，返回 [startFrame, endFrame] */
export function trimSilence(energy, ratio = 0.08) {
  let mx = 0;
  for (let i = 0; i < energy.length; i++) mx = Math.max(mx, energy[i]);
  const th = Math.max(0.006, mx * ratio);
  let a = 0, b = energy.length - 1;
  while (a < energy.length && energy[a] < th) a++;
  while (b > a && energy[b] < th) b--;
  if (b - a < 3) return [0, energy.length - 1];
  return [Math.max(0, a - 2), Math.min(energy.length - 1, b + 2)];
}

/** 说话人/信道无关化：逐维减均值、除标准差 */
export function cmvn(frames) {
  const n = frames.length, d = frames[0].length;
  const mu = new Float64Array(d), sd = new Float64Array(d);
  for (const f of frames) for (let k = 0; k < d; k++) mu[k] += f[k];
  for (let k = 0; k < d; k++) mu[k] /= n;
  for (const f of frames) for (let k = 0; k < d; k++) sd[k] += (f[k] - mu[k]) ** 2;
  for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k] / n) + 1e-6;
  return frames.map(f => {
    const o = new Float32Array(d);
    for (let k = 0; k < d; k++) o[k] = (f[k] - mu[k]) / sd[k];
    return o;
  });
}

function dist(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; s += d * d; }
  return Math.sqrt(s);
}

/**
 * 带 Sakoe-Chiba 约束的 DTW。
 * @returns {dist, path: Int32Array(pairs*2), norm} norm = dist / 路径长度
 */
export function dtw(A, B, bandRatio = 0.3) {
  const n = A.length, m = B.length;
  const band = Math.max(Math.abs(n - m) + 1, Math.ceil(bandRatio * Math.max(n, m)));
  const INF = 1e9;
  const D = new Float32Array(n * m).fill(INF);
  const BP = new Int8Array(n * m); // 0对角 1上 2左
  const idx = (i, j) => i * m + j;
  D[0] = dist(A[0], B[0]);
  for (let i = 0; i < n; i++) {
    const jc = Math.round(i * m / n);
    const j0 = Math.max(0, jc - band), j1 = Math.min(m - 1, jc + band);
    for (let j = j0; j <= j1; j++) {
      if (i === 0 && j === 0) continue;
      const c = dist(A[i], B[j]);
      let best = INF, bp = 0;
      if (i > 0 && D[idx(i - 1, j)] < best) { best = D[idx(i - 1, j)]; bp = 1; }
      if (j > 0 && D[idx(i, j - 1)] < best) { best = D[idx(i, j - 1)]; bp = 2; }
      if (i > 0 && j > 0 && D[idx(i - 1, j - 1)] < best) { best = D[idx(i - 1, j - 1)]; bp = 0; }
      if (best >= INF) continue;
      D[idx(i, j)] = c + best;
      BP[idx(i, j)] = bp;
    }
  }
  let i = n - 1, j = m - 1;
  const path = [];
  let guard = 0;
  while (i > 0 || j > 0) {
    path.push(i, j);
    const bp = BP[idx(i, j)];
    if (i === 0) j--;
    else if (j === 0) i--;
    else if (bp === 0) { i--; j--; }
    else if (bp === 1) i--;
    else j--;
    if (++guard > n + m + 10) break;
  }
  path.push(0, 0);
  path.reverse();
  const pairs = path.length / 2;
  return { dist: D[idx(n - 1, m - 1)], path: Int32Array.from(path), pairs, norm: D[idx(n - 1, m - 1)] / pairs };
}

/**
 * 逐词代价：把参考帧按词区间聚合，取该词在 DTW 路径上的平均距离。
 * wordRanges: [[startFrame, endFrame], ...]（含端点）
 */
export function wordCosts(A, B, res, wordRanges) {
  const { path, pairs } = res;
  const sum = new Float64Array(wordRanges.length);
  const cnt = new Float64Array(wordRanges.length);
  for (let p = 0; p < pairs; p++) {
    const i = path[p * 2], j = path[p * 2 + 1];
    for (let w = 0; w < wordRanges.length; w++) {
      if (i >= wordRanges[w][0] && i <= wordRanges[w][1]) {
        sum[w] += dist(A[i], B[j]); cnt[w]++; break;
      }
    }
  }
  return Array.from(sum, (s, w) => (cnt[w] ? s / cnt[w] : 0));
}

/** 按音节数把 [0, nFrames) 切成每词区间；gaps 为合成时插入的停顿，需单独占位 */
export function wordRangesBySyllable(syl, nFrames, gaps = []) {
  const total = syl.reduce((a, b) => a + b, 0) || 1;
  const gapAt = new Map();
  let pauseFrames = 0;
  for (const g of gaps) {
    const f = Math.max(0, Math.round(g.dur * 100));   // 10ms 一帧
    pauseFrames += f;
    gapAt.set(g.at, (gapAt.get(g.at) || 0) + f);
  }
  const speechFrames = Math.max(1, nFrames - pauseFrames);
  const out = [];
  let acc = 0, cursor = 0;
  for (let i = 0; i < syl.length; i++) {
    cursor += gapAt.get(i) || 0;
    const start = cursor;
    const len = Math.max(1, Math.round(syl[i] / total * speechFrames));
    out.push([Math.min(nFrames - 1, start), Math.min(nFrames - 1, start + len - 1)]);
    cursor += len;
    acc += syl[i];
  }
  return out;
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 把逐词原始代价转为 0-100 分（句子内相对，抗麦克风差异）。
 * z=0（中位数）-> 100，越差降得越多。
 */
export function scoreWords(costs) {
  const med = median(costs);
  const mad = median(costs.map(c => Math.abs(c - med))) + 1e-6;
  return costs.map(c => {
    const z = (c - med) / mad;
    return Math.max(5, Math.min(100, Math.round(100 - 26 * Math.max(0, z - 0.35))));
  });
}
