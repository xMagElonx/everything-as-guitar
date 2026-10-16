// 采样音色引擎纯逻辑回归：变调比率、播放参数计划、DSP 管线、IDB 降级判定。
// rateFor 是变调的全部数学；v0.5 起播放走 analyze→trim→normalize→renderNote
// 离线渲染管线（与 FM 路径同构），plan 保留作回归。这里逐字段锁死，
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

section('④ rateFor：±24 半音钳制（v0.5.1：只拦极端速率，不折叠和弦）');
check(SAM.rateFor(76, 40) === 4, '+36 半音 → 封顶 4（两个八度）');
check(SAM.rateFor(4, 40) === 0.25, '−36 半音 → 封底 0.25');
check(Math.abs(SAM.rateFor(57, 40) - Math.pow(2, 17 / 12)) < 1e-12,
  '+17 半音不再被折叠（v0.5 的 ±12 会把和弦高音撞成同音）');
check(SAM.rateFor(64, 40) === 4 && SAM.rateFor(16, 40) === 0.25,
  '边界 ±24 含');
check(Math.abs(SAM.rateFor(52, 40) - 2) < 1e-12, '±12 内行为不变');

/* ---- 合成信号工具 ---- */
const SR = 44100;
function sineBuf(hz, durSec, amp) {
  const n = Math.round(durSec * SR), p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = amp * Math.sin(2 * Math.PI * hz * i / SR);
  return p;
}
function decayBuf(hz, tauSec, durSec, amp) {
  const n = Math.round(durSec * SR), p = new Float32Array(n);
  for (let i = 0; i < n; i++)
    p[i] = amp * Math.exp(-i / (tauSec * SR)) * Math.sin(2 * Math.PI * hz * i / SR);
  return p;
}

section('⑤ analyze/trim/normalize：静音裁剪与归一化');
const padded = new Float32Array(SR);            // 0.2s 静音 + 0.4s 440Hz + 0.2s 静音
for (let i = Math.round(0.2 * SR); i < Math.round(0.6 * SR); i++)
  padded[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
const marks = SAM.analyze(padded, SR);
check(Math.abs(marks.trimIn - 0.2 * SR) < 32, 'trimIn ≈ 0.2s（阈值内容差 <32 样本）',
  marks.trimIn);
check(Math.abs(marks.trimOut - 0.6 * SR) < 32,
  'trimOut ≈ 0.6s（内容终点）', marks.trimOut);
check(marks.peak > 0.49 && marks.peak <= 0.5, 'peak = 0.5（正弦幅度）', marks.peak);
const cut = SAM.trim(padded, marks);
check(cut.pcm.length === marks.trimOut - marks.trimIn, '裁剪长度 = trimOut−trimIn');
check(cut.marks.trimIn === 0 && cut.marks.trimOut === cut.pcm.length,
  '裁后 marks 归零（新坐标系）');
if (marks.loopStart != null) {
  check(cut.marks.loopStart === marks.loopStart - marks.trimIn,
    '循环点随裁剪平移');
}
const normed = SAM.normalize(cut.pcm, 0.95);
let pk2 = 0;
for (const x of normed) pk2 = Math.max(pk2, Math.abs(x));
check(Math.abs(pk2 - 0.95) < 1e-6, '归一化后峰值 = 0.95', pk2);
const quiet = sineBuf(440, 0.5, 1e-4);
const qn = SAM.normalize(quiet, 0.95);
let qpk = 0;
for (const x of qn) qpk = Math.max(qpk, Math.abs(x));
check(Math.abs(qpk - 1e-3) < 1e-9, '极小信号增益封顶 ×10（防抬噪声底）', qpk);
const silentOut = SAM.normalize(new Float32Array(1000), 0.95);
check(silentOut.length === 1000 &&
      silentOut.every((x) => x === 0), '全静音输入原样返回不炸');
check(throws(() => SAM.normalize(cut.pcm, 1.5), 'target'),
  'normalize target > 1 抛错');
check(throws(() => SAM.trim(cut.pcm, { trimIn: 5, trimOut: 2 }), '非法'),
  'trim marks 倒挂抛错');

section('⑥ analyze：自相关根音检测');
check(SAM.analyze(sineBuf(440, 1.0, 0.5), SR).rootNote === 69,
  '440Hz → A4 (69)');
check(SAM.analyze(sineBuf(82.41, 1.5, 0.8), SR).rootNote === 40,
  '82.41Hz → E2 (40)（低音区，lag 535）');
check(SAM.analyze(sineBuf(261.63, 1.0, 0.4), SR).rootNote === 60,
  '261.63Hz → C4 (60)');
const silentMarks = SAM.analyze(new Float32Array(SR), SR);
check(silentMarks.rootNote === null && silentMarks.loopStart === null,
  '全静音 → rootNote/loop 双 null');
const noiseBuf = new Float32Array(SR);          // LCG 白噪声（确定可复现）
let seed = 42;
for (let i = 0; i < SR; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  noiseBuf[i] = 0.5 * (seed / 2147483648 - 1);
}
check(SAM.analyze(noiseBuf, SR).rootNote === null, '无调噪声 → null');
/* 正弦+噪声混合：根音能检出（置信 0.5–0.7 区间）但不可靠 —— 复杂录音
   的模型。v0.5.1 行为：根音照报，rootReliable=false，循环不启用。 */
const mixedBuf = new Float32Array(SR);
for (let i = 0; i < SR; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  mixedBuf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR) +
                0.6 * (seed / 2147483648 - 1);
}
const mm = SAM.analyze(mixedBuf, SR);
/* 噪声会拉偏插值峰位半个音级 —— 断言的契约是「检出但不可靠」，不是恰好 69 */
check(mm.rootNote !== null && mm.rootReliable === false &&
      mm.rootConf >= 0.5 && mm.rootConf < 0.7,
  '正弦+噪声：根音检出但置信不足 → 标记不可靠', 'conf=' + mm.rootConf);
check(mm.loopStart === null,
  '置信不足 → 不启用循环（复杂录音防 glitch 复读）');

section('⑦ analyze：稳态循环点检测');
const susMarks = SAM.analyze(sineBuf(440, 1.0, 0.5), SR);
check(susMarks.loopStart !== null && susMarks.loopEnd > susMarks.loopStart,
  '持续音找到循环段');
check(susMarks.loopEnd - susMarks.loopStart >= Math.ceil(0.1 * SR),
  '循环段长 ≥ LOOP_MIN_SEC (0.1s)', susMarks.loopEnd - susMarks.loopStart);
const susPcm = sineBuf(440, 1.0, 0.5);
check(susPcm[susMarks.loopStart - 1] <= 0 && susPcm[susMarks.loopStart] > 0,
  'loopStart 落在上升零交叉');
check(susPcm[susMarks.loopEnd - 1] <= 0 && susPcm[susMarks.loopEnd] > 0,
  'loopEnd 落在上升零交叉');
check(SAM.analyze(decayBuf(440, 0.15, 1.0, 0.5), SR).loopStart === null,
  '快衰减 τ=0.15s（打击型）→ 无循环');
check(SAM.analyze(decayBuf(440, 2.0, 1.0, 0.5), SR).loopStart !== null,
  '慢衰减 τ=2s（可延音）→ 有循环');

section('⑧ renderNote：离线渲染（varispeed + loop + 包络）');
const normSine = SAM.normalize(SAM.trim(padded, marks).pcm, 0.95);
const loopObj = marks.loopStart != null
  ? { start: SAM.trim(padded, marks).marks.loopStart,
      end: SAM.trim(padded, marks).marks.loopEnd }
  : null;
const r1 = SAM.renderNote(normSine, SR, 69, 69, 0.5, loopObj);
check(r1.length === Math.ceil((0.5 + 0.04) * SR),
  '输出长度恒 = (gate+RELEASE_SEC)*sr', r1.length);
check(Math.abs(r1[0]) < 1e-6 && Math.abs(r1[r1.length - 1]) < 1e-6,
  '首尾样值 ≈ 0（淡入淡出烘焙，永不硬切）');
const rLong = SAM.renderNote(normSine, SR, 69, 69, 2.0, loopObj);
check(rLong.length === Math.ceil((2.0 + 0.04) * SR) &&
      rLong.length > normSine.length,
  'gate 超采样长 + loop → 长度仍达标（回绕生效）');
let maxJump = 0;
for (let i = 1; i < rLong.length; i++)
  maxJump = Math.max(maxJump, Math.abs(rLong[i] - rLong[i - 1]));
/* 判别力校准：归一化 440Hz 的自然斜率 = 0.95*2*sin(π*440/SR) ≈ 0.0596，
   阈值给 1.05× —— 真接缝炸裂是 0.3 级别的跳变，混不过去。 */
const slopeCap = 0.95 * 2 * Math.sin(Math.PI * 440 / SR) * 1.05;
check(maxJump < slopeCap, '回绕接缝无缝（最大跳变 < 自然斜率×1.05）',
  maxJump + ' vs ' + slopeCap.toFixed(4));
const rHi = SAM.renderNote(normSine, SR, 81, 69, 0.3, loopObj);  // +12 半音
check(rHi.length === Math.ceil((0.3 + 0.04) * SR),
  '升八度（钳制边界）时长仍恒定——变调不变长');
const rShort = SAM.renderNote(normSine, SR, 69, 69, 0.05, loopObj);
check(rShort.length === Math.ceil((0.05 + 0.04) * SR),
  'gate 短于采样 → 不触发 loop，长度照样恒定');
const snapshot = Float32Array.from(normSine);
SAM.renderNote(normSine, SR, 50, 69, 0.5, loopObj);
let same = true;
for (let i = 0; i < normSine.length; i++)
  if (normSine[i] !== snapshot[i]) { same = false; break; }
check(same, '纯函数：输入 pcm 未被修改');
check(throws(() => SAM.renderNote(normSine, SR, 69, 69, -1, null), '非负数'),
  'gateSec < 0 抛错');
check(throws(() => SAM.renderNote(normSine, SR, 69, 69, 0.5,
  { start: 5, end: 2 }), '非法'), 'loop 倒挂抛错');
check(throws(() => SAM.renderNote('x', SR, 69, 69, 0.5, null), 'Float32Array'),
  'pcm 非 Float32Array 抛错');
const zero = SAM.renderNote(new Float32Array(SR), SR, 69, 69, 0.5, null);
check(zero.length === Math.ceil((0.5 + 0.04) * SR) &&
      zero.every((x) => x === 0), '全静音输入 → 全零 buffer（照样调度不炸）');
/* 热起始（复杂录音中段 / 录音开头就在响）：跳过起音淡入，保住音头 */
const hot = new Float32Array(Math.round(0.6 * SR));
for (let i = 0; i < hot.length; i++)
  hot[i] = 0.9 * Math.sin(2 * Math.PI * 440 * i / SR + 1);   // hot[0] ≈ 0.76
const rHot = SAM.renderNote(hot, SR, 69, 69, 0.3, null);
check(Math.abs(rHot[0] - hot[0]) < 1e-9, '起始就有声 → 跳过起音淡入（保音头）',
  rHot[0] + ' vs ' + hot[0]);
check(Math.abs(rHot[rHot.length - 1]) < 1e-6, '尾部照样淡出（永不硬切）');

console.log('\n结论：' + (fail === 0
  ? `全部通过（${pass} 项断言）。`
  : `${pass} 过 ${fail} 挂 —— 见上方 FAIL 行。`));
process.exit(fail === 0 ? 0 : 1);
