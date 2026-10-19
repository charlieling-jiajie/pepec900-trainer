/**
 * 使用计数：只上报事件名与本地随机 ID，不上传录音、不采集 IP/UA。
 * 事件：open（打开页面）/ practice（完成一次复诵）/ asr（用过识别）
 */
const API = 'https://35-212-199-158.sslip.io/api/hit';

function uid() {
  try {
    let v = localStorage.getItem('pp9_uid');
    if (!v) {
      v = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('pp9_uid', v);
    }
    return v;
  } catch {
    return 'anon';
  }
}

export function track(event) {
  try {
    const body = JSON.stringify({ e: event, v: uid() });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }));
      return;
    }
    fetch(API, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 统计失败不影响主流程 */
  }
}
