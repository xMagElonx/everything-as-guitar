// 采样音色引擎纯逻辑回归：变调比率、播放参数计划、IDB 降级判定。
// rateFor/plan 是 scheduleNote 分叉的全部数学 —— 这里逐字段锁死，
// 页面侧只消费它们的输出（smoke 场景 C 负责端到端）。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAM = require_(path.join(ROOT, 'engine', 'sampler.js'));

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  ← ' + extra : '')); }
  return cond;
}
function section(t) { console.log('\n' + t); }
function throws(fn, msg) {
  try { fn(); return false; } catch (e) { return msg === undefined || String(e.message).includes(msg); }
}

section('① rateFor：十二平均律变调比率');
check(SAM.rateFor(40, 40) === 1, '同度 rate = 1');
check(Math.abs(SAM.rateFor(52, 40) - 2) < 1e-12, '+12 半音 rate = 2（高八度翻倍）');
check(Math.abs(SAM.rateFor(28, 40) - 0.5) < 1e-12, '−12 半音 rate = 0.5（低八度减半）');
check(Math.abs(SAM.rateFor(47, 40) - Math.pow(2, 7 / 12)) < 1e-12, '+7 半音 = 纯五度比率 2^(7/12)');
check(Math.abs(SAM.rateFor(45, 52) - SAM.rateFor(33, 40)) < 1e-12, '比率只看音程差（同音程同比率）');
check(throws(() => SAM.rateFor(128, 40), '0–127'), 'note > 127 抛错');
check(throws(() => SAM.rateFor(60.5, 40), '整数'), '非整数 note 抛错');
check(throws(() => SAM.rateFor(60, -1), '0–127'), 'root < 0 抛错');

section('② plan：事件 → 播放参数');
const evs = [
  { note: 40, velocity: 100, tOn: 0.00, tOff: 0.50 },   // gate 0.50s
  { note: 47, velocity: 76,  tOn: 0.05, tOff: 0.17 },   // gate 0.12s
  { note: 28, velocity: 127, tOn: 0.09, tOff: 0.60 },   // 降调，gate 0.51s
];
const SD = 0.30; // 采样 0.30s
const p = SAM.plan(evs, 40, SD);
check(p.length === 3, '输出与事件等长');
check(Math.abs(p[0].rate - 1) < 1e-12, '同度事件 rate = 1');
check(Math.abs(p[0].gain - 100 / 127) < 1e-12, 'gain = velocity/127');
check(Math.abs(p[0].duration - (SD + SAM.RELEASE)) < 1e-12, '采样短于 gate → 截到 sampleDur/rate + RELEASE（0.30+0.06）');
// 真长采样：SD=2.0 > gate 0.50 → 截到 gate
const pLong = SAM.plan([evs[0]], 40, 2.0);
check(Math.abs(pLong[0].duration - (0.50 + SAM.RELEASE)) < 1e-12, '长采样截到 gate + RELEASE（0.50+0.06）');
check(Math.abs(p[1].duration - (0.12 + SAM.RELEASE)) < 1e-12, 'gate 短于采样时截到 gate');
// note 28：rate = 2^(-1) = 0.5 → 采样被拉长到 0.30/0.5 = 0.60s > gate 0.51 → 仍截到 gate
check(Math.abs(p[2].rate - 0.5) < 1e-12, '降调事件 rate = 0.5');
check(Math.abs(p[2].duration - (0.51 + SAM.RELEASE)) < 1e-12, '拉长后仍超过 gate → 截到 gate');
// 短采样场景：SD=0.05，note 47（rate=2^(7/12)≈1.498）→ 采样时长 0.05/1.498 ≈ 0.0334 < gate 0.12 → 截到采样
const p2 = SAM.plan([{ note: 47, velocity: 90, tOn: 0, tOff: 0.12 }], 40, 0.05);
check(Math.abs(p2[0].duration - (0.05 / p2[0].rate + SAM.RELEASE)) < 1e-12, '降调拉长未过 gate → 截到 sampleDur/rate');
check(throws(() => SAM.plan(evs, 40, 0), '正数'), 'sampleDur ≤ 0 抛错');
check(throws(() => SAM.plan([{ note: 40, velocity: 100, tOn: 0.2, tOff: 0.1 }], 40, 1), '早于'), 'tOff < tOn 抛错');
check(throws(() => SAM.plan('x', 40, 1), '数组'), 'events 非数组抛错');

section('③ IDB 降级判定（Node 无 indexedDB）');
check(SAM.idb.available() === false, 'Node 下 available() === false');
check(throws(() => SAM.idb.save({}), 'rec.name'), 'save 缺 name 抛错（不静默）');
check(throws(() => SAM.idb.save({ name: 'x' }), 'rec.root'), 'save 缺 root 抛错');
check(throws(() => SAM.idb.save({ name: 'x', root: 40, pcm: {} }), 'ArrayBuffer'), 'save pcm 非 ArrayBuffer 抛错');
check(throws(() => SAM.idb.remove(''), '非空'), 'remove 空名抛错');

console.log('\n结论：' + (fail === 0
  ? `全部通过（${pass} 项断言）。`
  : `${pass} 过 ${fail} 挂 —— 见上方 FAIL 行。`));
process.exit(fail === 0 ? 0 : 1);
