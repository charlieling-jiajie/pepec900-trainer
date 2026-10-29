// 无浏览器环境下的冒烟测试：用最小 DOM 桩跑一遍 app.js 的启动路径
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

function stub(name = 'stub') {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => stub('ctx');
      if (k === 'textContent' || k === 'innerHTML' || k === 'value' || k === 'title') return '';
      if (k === 'disabled') return false;
      if (k === 'style') return {};
      if (k === 'dataset') return {};
      if (k === 'width' || k === 'height' || k === 'clientWidth' || k === 'clientHeight') return 600;
      if (k === 'tagName') return 'DIV';
      if (k === 'size') return 0;
      if (k === 'prototype') return t.prototype;
      if (k === Symbol.toPrimitive) return () => 0;
      if (typeof k === 'symbol') return undefined;
      return stub(name + '.' + String(k));
    },
    set() { return true; },
    apply() { return stub(name + '()'); },
  });
}

const els = new Map();
globalThis.document = {
  getElementById: (id) => {
    if (!els.has(id)) els.set(id, stub(id));
    return els.get(id);
  },
  addEventListener() {},
  createElement: () => stub('el'),
  querySelectorAll: () => [],
  body: stub('body'),
};
globalThis.window = globalThis;
globalThis.location = { protocol: 'http:' };
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => Date.now() };
globalThis.Audio = function () { return stub('audio'); };
globalThis.AudioContext = function () { return stub('ac'); };
globalThis.OfflineAudioContext = function () { return stub('offline'); };
globalThis.MediaRecorder = function () { return stub('mr'); };
MediaRecorder.isTypeSupported = () => false;
Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: { getUserMedia: async () => stub('stream') },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestHarness',
    sendBeacon: () => true,          // 屏蔽真实上报，避免 Node 22 undici 在桩环境崩溃
  },
  configurable: true,
});

const before = Object.keys(els).length;
await import('../web/app.js');
await new Promise((r) => setTimeout(r, 30));

const ids = [...els.keys()];
console.log('已访问元素数:', ids.length);
const required = ['sid', 'chap', 'meta', 'text', 'textWrap', 'spoken', 'spokenWrap', 'hints',
  'btnPlay', 'btnRec', 'btnStop', 'chapterBar', 'modeBar', 'wave', 'scoreVal', 'verdict',
  'pillStat', 'btnReveal', 'placeholder', 'btnAsr', 'asrStatus', 'asrOut'];
const miss = required.filter((r) => !ids.includes(r));
console.log(miss.length ? '缺失元素: ' + miss.join(',') : '全部关键元素已挂载');
console.log(miss.length ? 'FAIL' : 'PASS');
