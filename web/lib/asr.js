/**
 * 浏览器内语音识别（Whisper-tiny.en，ONNX + WASM）
 * - 按需加载：只有用户点击「识别我说的」才下载 43MB 模型
 * - 全程本地推理，录音不出浏览器
 * - 微信内置浏览器 / 手机端默认不启用（见 asrEnv）
 *
 * 准确率相关（详见 docs/asr-accuracy.md）：
 * - 送识别前先掐头去尾静音 + 峰值归一，减少 Whisper 在静音上的幻觉
 * - beam search（num_beams）替代贪心解码，对口音/噪音更稳
 * - 不使用「参考句偏置」：训练器靠 ASR 当独立裁判，偏置会掩盖真实读错
 */

const MODEL = 'whisper-tiny-en';
let pipePromise = null;

export function asrEnv() {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const wechat = /MicroMessenger/i.test(ua);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const wasm = typeof WebAssembly === 'object';
  let reason = '', warn = '';
  if (wechat) reason = '微信内置浏览器跑不动识别模型：点右上角「···」→「在浏览器打开」后再试';
  else if (!wasm) reason = '当前浏览器不支持 WebAssembly，无法本地识别';
  else if (mobile) warn = '手机端首次需下载 43MB 模型，推理约 30–60 秒，建议在电脑上使用';
  return { wechat, mobile, wasm, ok: !reason, reason, warn };
}

export async function loadASR(onProgress) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const mod = await import('./transformers/transformers.min.js');
      const { pipeline, env } = mod;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = new URL('../models/', import.meta.url).href;
      env.backends.onnx.wasm.wasmPaths = new URL('./transformers/', import.meta.url).href;
      // 未开启 COOP/COEP 时 SharedArrayBuffer 不可用，必须单线程
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline('automatic-speech-recognition', MODEL, {
        quantized: true,
        progress_callback: onProgress,
      });
    })();
    pipePromise.catch(() => { pipePromise = null; });
  }
  return pipePromise;
}

/**
 * 识别前预处理：掐掉头尾静音、峰值归一。
 * 静音不承载信息，却容易让 Whisper 短音频幻觉出无关词。
 */
function prepAudio(samples) {
  const sr = 16000;
  const frame = Math.round(sr * 0.01);            // 10ms 帧
  const rms = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) s += samples[i + j] * samples[i + j];
    rms.push(Math.sqrt(s / frame));
  }
  if (!rms.length) return samples;
  const peak = Math.max(...rms, 1e-6);
  const gate = Math.max(peak * 0.04, 1e-4);       // 相对静音门限
  let lo = 0, hi = rms.length - 1;
  while (lo <= hi && rms[lo] < gate) lo++;
  while (hi >= lo && rms[hi] < gate) hi--;
  if (lo > hi) { lo = 0; hi = rms.length - 1; }   // 全程低电平：不裁剪
  const a = Math.max(0, (lo - 1)) * frame;
  const b = Math.min(samples.length, (hi + 2) * frame);
  let out = samples.subarray(a, Math.max(b, a + 1));
  // 峰值归一到 0.9
  let mx = 1e-6;
  for (let i = 0; i < out.length; i++) mx = Math.max(mx, Math.abs(out[i]));
  const gain = 0.9 / mx;
  const norm = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) norm[i] = out[i] * gain;
  return norm;
}

/** @param {Float32Array} samples 16kHz 单声道 */
export async function transcribe(samples, onProgress) {
  if (!samples || !samples.length) throw new Error('录音为空，无法识别');
  if (samples.length < 1600) throw new Error('录音太短（<0.1 秒），无法识别');
  const asr = await loadASR(onProgress);
  const audio = new Float32Array(prepAudio(samples));
  // num_beams 走 beam search：transformers.js 会把多余参数透传给 model.generate
  const out = await asr(audio, { num_beams: 5 });
  return String((out && out.text) || '').trim();
}
