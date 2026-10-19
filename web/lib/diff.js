/**
 * 识别结果 vs 原句 的比对
 * 目标：区分「读音不准」与「复诵错误」
 *
 * 关键设计：
 *  1. 两侧都先归一到「比较单元」：
 *     - 数字词/千/百/小数点 → 合并成一个数值（two thousand five hundred → 2500）
 *     - 连续单字母 → 合并（v o r → vor，便于与 ASR 的 "VOR" 对齐）
 *     - ICAO 拼读词 → 首字母（alfa/alpha → a）
 *  2. 归一后相同但原文不同 → 读音问题（tree vs three）
 *  3. 归一后不同 → 用词不同（复诵错误）
 */

const NUMW = {
  zero: 0, one: 1, two: 2, too: 2, tree: 3, three: 3, four: 4, fower: 4,
  five: 5, fife: 5, six: 6, seven: 7, eight: 8, ait: 8, nine: 9, niner: 9,
};
const MULT = { thousand: 1000, hundred: 100 };
const LETTER = {
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e',
  foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i', juliett: 'j', juliet: 'j',
  kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p',
  quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v',
  whiskey: 'w', xray: 'x', yankee: 'y', zulu: 'z',
};
const DOT = { decimal: 1, point: 1, dot: 1 };

/** 文本 → 词数组（小写，去掉标点） */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.replace(/^\.+|\.+$/g, ''))   // 去掉句末句点，保留 121.5 这类小数点
    .filter(Boolean);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把识别文本里的缩写还原成训练用的口语展开：VOR -> v o r */
export function expandAbbr(text, abbr = {}) {
  let h = ' ' + String(text || '').toLowerCase() + ' ';
  for (const k of Object.keys(abbr).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`([^a-z0-9])${esc(k)}(?=[^a-z0-9]|$)`, 'g');
    h = h.replace(re, (m, p1) => `${p1}${abbr[k]} `);
  }
  return h.trim();
}

/** 词 → 原子序列 */
function atomsOf(words) {
  const out = [];
  for (const w of words) {
    if (DOT[w]) { out.push({ k: '.', raw: w }); continue; }
    if (w in NUMW) { out.push({ k: 'd', d: NUMW[w], raw: w }); continue; }
    if (w in MULT) { out.push({ k: 'm', m: MULT[w], raw: w }); continue; }
    if (LETTER[w]) { out.push({ k: 'l', c: LETTER[w], raw: w }); continue; }
    if (/^\d+(\.\d+)?$/.test(w)) {                    // "2500" / "121.5"
      let buf = '';
      for (const ch of w) {
        if (ch === '.') {
          if (buf) out.push({ k: 'd', d: +buf, raw: w });
          buf = '';
          out.push({ k: '.', raw: w });
        } else buf += ch;
      }
      if (buf) out.push({ k: 'd', d: +buf, raw: w });
      continue;
    }
    if (/^[a-z]$/.test(w)) { out.push({ k: 'l', c: w, raw: w }); continue; }
    out.push({ k: 'w', s: w, raw: w });
  }
  return out;
}

function intOf(list) {
  let total = 0, cur = 0;
  for (const a of list) {
    if (a.k === 'd') cur = cur * 10 + a.d;
    else if (a.m === 100) cur = (cur || 1) * 100;
    else { total += (cur || 1) * 1000; cur = 0; }
  }
  return total + cur;
}

/** 原子序列 → 比较单元 */
function unitsOf(atoms) {
  const units = [];
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    if (a.k === 'd' || a.k === 'm' || a.k === '.') {
      const run = [];
      let j = i;
      while (j < atoms.length && (atoms[j].k === 'd' || atoms[j].k === 'm' || atoms[j].k === '.')) {
        run.push(atoms[j]); j++;
      }
      // 以小数点切分整数/小数两段
      const dotAt = run.findIndex(x => x.k === '.');
      let s;
      if (dotAt >= 0) {
        const left = intOf(run.slice(0, dotAt));
        const right = run.slice(dotAt + 1).filter(x => x.k === 'd').map(x => x.d).join('');
        s = `${left}${right ? '.' + right : ''}`;
      } else s = String(intOf(run));
      units.push({ s, raw: run.map(x => x.raw).join(' '), kind: 'num' });
      i = j; continue;
    }
    if (a.k === 'l') {
      let j = i, cs = '', raws = [];
      while (j < atoms.length && atoms[j].k === 'l') { cs += atoms[j].c; raws.push(atoms[j].raw); j++; }
      units.push({ s: cs, raw: raws.join(' '), kind: 'letters' });
      i = j; continue;
    }
    units.push({ s: a.s, raw: a.raw, kind: 'word' });
    i++;
  }
  return units;
}

export function toUnits(text) {
  return unitsOf(atomsOf(tokenize(text)));
}

/** LCS 对齐 */
function align(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].s === b[j].s
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].s === b[j].s) { ops.push({ t: '=', ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', ai: i }); i++; }
    else { ops.push({ t: '+', bi: j }); j++; }
  }
  while (i < n) { ops.push({ t: '-', ai: i }); i++; }
  while (j < m) { ops.push({ t: '+', bi: j }); j++; }
  return ops;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const sim = (a, b) => {
  const L = Math.max(a.length, b.length) || 1;
  return 1 - lev(a, b) / L;
};

/**
 * @param {string} expected 原句应读（corpus 里的 spoken）
 * @param {string} hyp      语音识别得到的文本
 * @returns {{items:Array, stats:Object}}
 */
export function compare(expected, hyp, abbr = {}) {
  const A = toUnits(expected), B = toUnits(expandAbbr(hyp, abbr));
  const ops = align(A, B);

  // 把相邻的「删除+插入」合并成「替换」
  const merged = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k], nx = ops[k + 1];
    if (o.t === '-' && nx && nx.t === '+') {
      merged.push({ t: '~', ai: o.ai, bi: nx.bi }); k++; continue;
    }
    if (o.t === '+' && nx && nx.t === '-') {
      merged.push({ t: '~', ai: nx.ai, bi: o.bi }); k++; continue;
    }
    merged.push(o);
  }

  const items = [];
  const stat = { ok: 0, pron: 0, sub: 0, miss: 0, extra: 0 };
  for (const o of merged) {
    if (o.t === '=') {
      const e = A[o.ai], h = B[o.bi];
      const same = e.raw === h.raw;
      items.push({
        cls: same ? 'ok' : 'pron',
        exp: e.raw, hyp: h.raw, expS: e.s, hypS: h.s,
        tip: same ? '' : '读法与标准不同（内容对）',
      });
      stat[same ? 'ok' : 'pron']++;
    } else if (o.t === '~') {
      const e = A[o.ai], h = B[o.bi];
      const close = sim(e.s, h.s) >= 0.6;
      items.push({
        cls: close ? 'pron' : 'sub',
        exp: e.raw, hyp: h.raw, expS: e.s, hypS: h.s,
        tip: close ? '发音接近，但可辨为不同词' : '用词不同',
      });
      stat[close ? 'pron' : 'sub']++;
    } else if (o.t === '-') {
      items.push({ cls: 'miss', exp: A[o.ai].raw, hyp: '', expS: A[o.ai].s, hypS: '', tip: '未读到' });
      stat.miss++;
    } else {
      items.push({ cls: 'extra', exp: '', hyp: B[o.bi].raw, expS: '', hypS: B[o.bi].s, tip: '多读了内容' });
      stat.extra++;
    }
  }

  const total = stat.ok + stat.pron + stat.sub + stat.miss + stat.extra;
  const acc = total ? Math.round((stat.ok / total) * 100) : 0;
  return { items, stats: { ...stat, total, acc } };
}
