import fs from 'fs';
import { compare } from '../web/lib/diff.js';

const meta = JSON.parse(fs.readFileSync(new URL('../data/corpus.json', import.meta.url), 'utf-8')).meta;
const AB = meta.abbr;

const cases = [
  {
    name: '读音差异（tree / three）',
    exp: 'maintaining flight level tree one zero',
    hyp: 'Maintaining flight level three one zero.',
    want: { ok: 3, pron: 1, sub: 0, miss: 0, extra: 0 },
  },
  {
    name: '字母缩写（VOR / DME）',
    exp: 'cleared v o r d m e approach runway two four',
    hyp: 'Cleared VOR DME approach runway two four.',
    want: { ok: 5, pron: 0, sub: 0, miss: 0, extra: 0 },
  },
  {
    name: '数字写法差异',
    exp: 'descending to three thousand feet q n h one zero zero seven',
    hyp: 'descending to 3000 feet QNH 1007',
    want: { ok: 4, pron: 2, sub: 0, miss: 0, extra: 0 },
  },
  {
    name: '漏词',
    exp: 'right heading tree tree zero descending to three thousand feet',
    hyp: 'right heading three three zero to three thousand feet',
    want: { miss: 1, sub: 0 },
  },
  {
    name: '用词错误（NDB → ILS）',
    exp: 'unable ar nav loss of raim request n d b approach',
    hyp: 'unable RNAV loss of RAIM request ILS approach',
    want: { ok: 8, sub: 1, miss: 0 },
  },
  {
    name: '多读',
    exp: 'stand by',
    hyp: 'stand by standby now',
    want: { extra: 2 },
  },
  {
    name: '完全一致',
    exp: 'runway tree six right',
    hyp: 'runway 36 right',
    want: { ok: 2, pron: 1, sub: 0 },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = compare(c.exp, c.hyp, AB);
  const ok = Object.entries(c.want).every(([k, v]) => r.stats[k] === v);
  if (ok) { pass++; console.log('PASS', c.name, JSON.stringify(r.stats)); }
  else {
    fail++;
    console.log('FAIL', c.name, '期望', JSON.stringify(c.want), '实际', JSON.stringify(r.stats));
    console.log('   ', r.items.map(i => `${i.cls}:${i.exp || '∅'}→${i.hyp || '∅'}`).join(' | '));
  }
}
console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
