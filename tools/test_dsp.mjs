// Node 自检：验证 FFT / 梅尔 / DTW / 逐词打分链路
import { logMel, trimSilence, cmvn, dtw, wordCosts, wordRangesBySyllable, scoreWords } from '../web/lib/dsp.js';

const SR = 16000;
const F0 = [140, 180, 120, 210, 160];      // 每个"词"的基频
const SYL = [2, 1, 2, 1, 2];
const WORD_LEN = 0.34;                      // 秒

function synth(f0s, alter = -1) {
  const n = Math.round(f0s.length * WORD_LEN * SR);
  const out = new Float32Array(n);
  for (let w = 0; w < f0s.length; w++) {
    const s0 = Math.round(w * WORD_LEN * SR);
    const len = Math.round(WORD_LEN * SR);
    const f = (alter === w ? f0s[w] * 2.4 : f0s[w]);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.sin(Math.PI * i / len) ** 0.7;
      out[s0 + i] = env * (0.6 * Math.sin(2 * Math.PI * f * t)
        + 0.25 * Math.sin(2 * Math.PI * 2 * f * t)
        + 0.12 * Math.sin(2 * Math.PI * 3 * f * t));
    }
  }
  return out;
}

function run(audio) {
  const { frames, energy } = logMel(audio, SR);
  const [s, e] = trimSilence(energy);
  const cut = frames.slice(s, e + 1);
  const N = cmvn(cut);
  return N;
}

const A = run(synth(F0));
const B0 = run(synth(F0));            // 完全相同
const B1 = run(synth(F0, 2));         // 第 3 个词读错

const ranges = wordRangesBySyllable(SYL, A.length);
console.log('frames', A.length, 'ranges', JSON.stringify(ranges));

const r0 = dtw(A, B0);
const c0 = wordCosts(A, B0, r0, ranges);
console.log('same   : norm=%s  path=%d  scores=%s', r0.norm.toFixed(4), r0.pairs, scoreWords(c0).join(','));

const r1 = dtw(A, B1);
const c1 = wordCosts(A, B1, r1, ranges);
const sc1 = scoreWords(c1);
console.log('altered: norm=%s  path=%d  scores=%s', r1.norm.toFixed(4), r1.pairs, sc1.join(','));
console.log('argmin =', sc1.indexOf(Math.min(...sc1)), '(应为 2)');

// 路径单调性检查
let ok = true;
for (let p = 1; p < r1.pairs; p++) {
  const i0 = r1.path[(p - 1) * 2], j0 = r1.path[(p - 1) * 2 + 1];
  const i1 = r1.path[p * 2], j1 = r1.path[p * 2 + 1];
  if (i1 < i0 || j1 < j0) ok = false;
}
console.log('monotonic:', ok);
console.log(Math.abs(r0.norm) < 0.05 && sc1.indexOf(Math.min(...sc1)) === 2 && ok ? 'PASS' : 'FAIL');

// ---- 回归：不同帧数必须不崩溃，且路径 i/j 分别落在各自数组范围内 ----
{
  const mk = (n, off = 0) => Array.from({ length: n }, (_, i) => {
    const v = new Float32Array(4);
    for (let k = 0; k < 4; k++) v[k] = Math.sin((i + off) * 0.31 + k) + k * 0.1;
    return v;
  });
  for (const [na, nb] of [[120, 75], [75, 120], [200, 199], [120, 120]]) {
    const A = mk(na), B = mk(nb, 3);
    const res = dtw(A, B, 0.35);
    let ok = true, maxI = 0, maxJ = 0;
    for (let p = 0; p < res.pairs; p++) {
      const i = res.path[p * 2], j = res.path[p * 2 + 1];
      if (i >= A.length || j >= B.length || i < 0 || j < 0) { ok = false; break; }
      maxI = Math.max(maxI, i); maxJ = Math.max(maxJ, j);
    }
    const ranges = wordRangesBySyllable([1, 2, 1], A.length, []);
    const costs = wordCosts(A, B, res, ranges);
    const sane = costs.length === 3 && costs.every(c => Number.isFinite(c));
    if (!ok || !sane) {
      console.log('FAIL 不同帧数回退', na, nb, 'ok=' + ok, 'costs=' + sane);
      process.exit(1);
    }
  }
  console.log('PASS 不同帧数 DTW 路径与打分均正常（120/75、75/120、200/199、120/120）');
}
