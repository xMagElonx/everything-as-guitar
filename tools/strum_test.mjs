// strum.js 审计：扫弦引擎的时序、力度、字节映射与全部拒绝路径。
// 精确期望值在这里独立手算 —— 引擎改坏了当场炸，不靠「大概对」。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const S = require_(path.join(ROOT, 'engine', 'strum.js'));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  ← ' + extra : '')); }
  return cond;
}
function throws(fn, frag, msg) {
  try { fn(); return check(false, msg, '没有抛错'); }
  catch (e) { return check(String(e.message).indexOf(frag) >= 0, msg, e.message); }
}
function section(t) { console.log('\n' + t); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* 六弦 E 和弦：E2 B2 E3 G#3 B3 E4（低→高） */
const E6 = [40, 47, 52, 56, 59, 64];

/* ------------------------------------------------------------- ① pattern 表 */
section('① PATTERNS 表（数据驱动，per-pattern 力度默认）');
check(S.PATTERNS.down.order === 'low-to-high' && S.PATTERNS.down.muted === false,
  'down：低弦起，不哑音');
check(S.PATTERNS.up.order === 'high-to-low' && S.PATTERNS.up.muted === false,
  'up：高弦起，不哑音');
check(S.PATTERNS.chuck.order === 'low-to-high' && S.PATTERNS.chuck.muted === true,
  'chuck：低弦起 + 哑音');
check(S.PATTERNS.up.velHigh < S.PATTERNS.down.velHigh,
  '上扫默认整体偏轻（' + S.PATTERNS.up.velHigh + ' < ' + S.PATTERNS.down.velHigh + '）');

/* ------------------------------------------------------------- ② down 精确序列 */
section('② down：精确期望序列（独立手算）');
const ev = S.strum(E6, { pattern: 'down', spread: 0.09, gate: 1.2 });
check(ev.length === 6, '6 弦 → 6 事件');
check(eq(ev.map(e => e.string), [0, 1, 2, 3, 4, 5]), '下扫：低弦 → 高弦（弦位 0..5）');
check(eq(ev.map(e => e.note), E6), '音符顺序 = 输入顺序');
check(eq(ev.map(e => Math.round(e.tOn * 1000)), [0, 18, 36, 54, 72, 90]), 'tOn 毫秒取整 0/18/36/54/72/90');
check(eq(ev.map(e => e.velocity), [112, 105, 98, 90, 83, 76]),
  '力度沿拨弦序线性递减 112 → 76（手算四舍五入）');
check(ev.every(e => Math.abs(e.tOff - (e.tOn + 1.2)) < 1e-9), 'gate 1.2s：tOff = tOn + 1.2');
check(ev[0].stroke === 0 && ev[5].stroke === 5, 'stroke = 拨弦次序');

/* ------------------------------------------------------------- ③ up */
section('③ up：反序 + 力度端点 96/68');
const up = S.strum(E6, { pattern: 'up', spread: 0.09, gate: 1.2 });
check(eq(up.map(e => e.string), [5, 4, 3, 2, 1, 0]), '上扫：高弦 → 低弦');
check(eq(up.map(e => e.note), E6.slice().reverse()), '音符顺序反转为高音先');
check(eq(up.map(e => e.velocity), [96, 90, 85, 79, 74, 68]),
  '上扫力度 96 → 68（先被拨到的高弦最响）');
check(eq(up.map(e => Math.round(e.tOn * 1000)), [0, 18, 36, 54, 72, 90]), '时序仍单调');

/* ------------------------------------------------------------- ④ chuck */
section('④ chuck：哑音扫弦 = 短 gate + 低力度');
const ck = S.strum(E6, { pattern: 'chuck', spread: 0.09, gate: 1.2 });
check(eq(ck.map(e => Math.round((e.tOff - e.tOn) * 1000)), [70, 70, 70, 70, 70, 70]),
  '每音时值 = CHUCK_GATE 0.07s（不管 gate 给了多少）');
check(ck.every(e => e.velocity <= 60), '力度全部压在 60 以下');
check(eq(ck.map(e => e.velocity), [58, 55, 53, 50, 48, 45]), 'chuck 力度 58 → 45（来自 pattern 默认端点）');
/* 显式覆盖端点是用户的合法权利 —— 引擎不隐藏钳制，给了什么用什么 */
const ckHigh = S.strum(E6, { pattern: 'chuck', velHigh: 100, velLow: 90 });
check(eq(ckHigh.map(e => e.velocity), [100, 98, 96, 94, 92, 90]),
  '显式 velHigh=100/velLow=90 → 按用户的来（无静默钳制）');

/* ------------------------------------------------------------- ⑤ 事件级闷音 */
section('⑤ palmMute：演奏时序层面的闷音（与 params.js 的音色宏是两回事）');
const pm = S.strum(E6, { pattern: 'down', gate: 1.2, palmMute: true });
check(eq(pm.map(e => Math.round((e.tOff - e.tOn) * 1000)), [140, 140, 140, 140, 140, 140]),
  '每音时值钳到 MUTE_GATE 0.14s');
check(eq(pm.map(e => e.velocity), [112, 105, 98, 90, 83, 76]),
  '闷音不改力度（那是 chuck 的事，二者语义分开）');
const pmChuck = S.strum(E6, { pattern: 'chuck', palmMute: true });
check(pmChuck.every(e => e.tOff - e.tOn <= S.CHUCK_GATE + 1e-9),
  'chuck + palmMute：取更短的 gate（chuck 赢）');

/* ------------------------------------------------------------- ⑥ 自定义 pattern */
section('⑥ 自定义 pattern 对象（数据驱动，不加代码分支）');
const custom = S.strum(E6, { pattern: { order: 'high-to-low', muted: true, velHigh: 70, velLow: 50 }, spread: 0.1 });
check(eq(custom.map(e => e.string), [5, 4, 3, 2, 1, 0]) && custom.every(e => e.tOff - e.tOn <= S.CHUCK_GATE + 1e-9),
  '自定义：高弦起 + 哑音，复用 chuck 的短 gate');
check(eq(custom.map(e => e.velocity), [70, 66, 62, 58, 54, 50]), '自定义力度端点生效（70 → 50）');
throws(() => S.strum(E6, { pattern: { order: 'sideways' } }), 'order', '自定义 order 非法 → 报错');

/* ------------------------------------------------------------- ⑦ 拒绝路径 */
section('⑦ 全部校验分支：抛错，不静默');
throws(() => S.strum([], { pattern: 'down' }), '非空数组', '空 notes');
throws(() => S.strum([60], { pattern: 'down' }), '至少要 2 根弦', '单音不算扫弦');
throws(() => S.strum([60, 60, 64], { pattern: 'down' }), '严格升序', '重复音 = 非升序');
throws(() => S.strum([64, 60], { pattern: 'down' }), '严格升序', '降序输入');
throws(() => S.strum([60.5, 64], { pattern: 'down' }), '整数', '非整数 note');
throws(() => S.strum([60, 128], { pattern: 'down' }), '0-127', 'note 128');
throws(() => S.strum(E6, { pattern: 'sideways' }), '未知 pattern', '未知 pattern 名');
throws(() => S.strum(E6, {}), '缺 pattern', '缺 pattern');
throws(() => S.strum(E6, { pattern: 'down', spread: 0 }), '正数', 'spread = 0');
throws(() => S.strum(E6, { pattern: 'down', gate: -1 }), '正数', 'gate 负数');
throws(() => S.strum(E6, { pattern: 'down', velHigh: 128 }), '1-127', 'velHigh 128');
throws(() => S.strum(E6, { pattern: 'down', velLow: 0 }), '1-127', 'velLow 0');

/* ------------------------------------------------------------- ⑧ eventsToMidi */
section('⑧ eventsToMidi：事件 → Note On/Off 字节');
const midi = S.eventsToMidi(ev, 0);
check(midi.length === 12, '6 事件 → 12 条消息（On/Off 成对）');
check(eq(midi[0], { bytes: [0x90, 40, 112], tMs: 0 }), '第一条：Note On 通道 1');
check(eq(midi[1], { bytes: [0x80, 40, 0], tMs: 1200 }), '第二条：Note Off（0x80，独立消息）');
check(midi.filter(m => (m.bytes[0] & 0xF0) === 0x90).length === 6 &&
      midi.filter(m => (m.bytes[0] & 0xF0) === 0x80).length === 6, '6 条 On + 6 条 Off');
check(midi.every(m => (m.bytes[0] & 0x0F) === 0), '通道字节 = 0');
const midiCh9 = S.eventsToMidi(ev, 9);
check(midiCh9[0].bytes[0] === 0x99 && midiCh9[1].bytes[0] === 0x89, '通道 9 → 0x99/0x89');
check(eq(midi.map(m => m.tMs),
  [0, 1200, 18, 1218, 36, 1236, 54, 1254, 72, 1272, 90, 1290]), 'On/Off 交替、时间戳单调');
throws(() => S.eventsToMidi(ev, 16), '0-15', '通道 16 越界');
throws(() => S.eventsToMidi(ev, -1), '0-15', '通道 -1 越界');
throws(() => S.eventsToMidi([], 0), '非空数组', '空事件组');
throws(() => S.eventsToMidi([{ note: 200, velocity: 64, tOn: 0, tOff: 1 }], 0), '越界', 'note 200');
throws(() => S.eventsToMidi([{ note: 60, velocity: 0, tOn: 0, tOff: 1 }], 0), 'velocity', 'velocity 0');
throws(() => S.eventsToMidi([{ note: 60, velocity: 64, tOn: 1, tOff: 1 }], 0), '不合法', 'tOff ≤ tOn');

/* ------------------------------------------------------------- ⑨ 确定性 */
section('⑨ 确定性：纯函数，同输入同输出');
check(JSON.stringify(S.strum(E6, { pattern: 'down' })) ===
      JSON.stringify(S.strum(E6, { pattern: 'down' })), '两次调用逐字段相同');
const two = S.strum([40, 47], { pattern: 'down', spread: 0.06 });
check(eq(two.map(e => Math.round(e.tOn * 1000)), [0, 60]), '双弦扫弦：间隔 = spread/(n-1) = 60ms');

console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
