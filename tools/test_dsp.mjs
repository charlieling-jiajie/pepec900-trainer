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
