/**
 * 浏览器内语音识别（Whisper-tiny.en，ONNX + WASM）
 * - 按需加载：只有用户点击「识别我说的」才下载 43MB 模型
 * - 全程本地推理，录音不出浏览器
 * - 微信内置浏览器 / 手机端默认不启用（见 asrEnv）
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

/** @param {Float32Array} samples 16kHz 单声道 */
export async function transcribe(samples, onProgress) {
  const asr = await loadASR(onProgress);
  const out = await asr(samples);
  return String((out && out.text) || '').trim();
}
