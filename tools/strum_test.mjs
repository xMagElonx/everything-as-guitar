// strum.js 审计：扫弦引擎的时序、力度、字节映射与全部拒绝路径。
// 精确期望值在这里独立手算 —— 引擎改坏了当场炸，不靠「大概对」。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const S = require_(path.join(ROOT, 'engine', 'strum.js'));
const SEQ = require_(path.join(ROOT, 'engine', 'seq.js'));
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
section('③ up：只扫最高 4 弦 + 力度端点 97/61（行业事实：上扫不带低音弦）');
const up = S.strum(E6, { pattern: 'up', spread: 0.09, gate: 1.2 });
check(up.length === 4, '上扫 6 弦和弦 → 只响最高 4 弦（modwheel 指南 + RealGuitar 一致）');
check(eq(up.map(e => e.string), [5, 4, 3, 2]), '上扫：高弦 → 低弦（仅最高 4 弦）');
check(eq(up.map(e => e.note), [64, 59, 56, 52]), '音符 = 最高 4 弦，高音先');
check(eq(up.map(e => e.velocity), [97, 85, 73, 61]),
  '上扫力度 97 → 61（down 端点 −15，4 弦递减手算）');
check(eq(up.map(e => Math.round(e.tOn * 1000)), [0, 30, 60, 90]), '时序单调（4 弦 → 步长 30ms）');
check(S.PATTERNS.up.velHigh === S.PATTERNS.down.velHigh - 15 &&
      S.PATTERNS.up.velLow === S.PATTERNS.down.velLow - 15,
  'up 端点 = down 端点 − 15（数据自洽）');

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
check(eq(S.strum(E6, { pattern: 'down' }).map(e => Math.round(e.tOn * 1000)),
  [0, 5, 10, 15, 20, 25]), '默认 spread=0.025s 总窗 → 每弦 5ms（0..25ms，落在行业 15–35ms 区间）');

/* ------------------------------------------------------------- ⑩ 节奏型 */
section('⑩ RHYTHMS / expandRhythm：节奏型 → 一小节扫弦时刻表');
const folk = S.expandRhythm('folk', 2.0);
check(folk.length === 4, 'folk：4 步');
check(eq(folk.map(s => s.stroke), ['down', 'down', 'up', 'up']), 'folk 手法序列 down-down-up-up');
check(eq(folk.map(s => s.at), [0, 0.5, 1.0, 1.5]), 'folk@120BPM 时刻 0/0.5/1.0/1.5（手算）');
check(folk.every(s => s.palmMute === false), 'palmMute 默认 false');
const folkUp = S.expandRhythm('folkUp', 2.0);
check(folkUp.length === 5 && folkUp[4].at === 1.75, 'folkUp：第 5 步反拍 3.5 → 1.75s');
const punk = S.expandRhythm('punk', 4);   // 60BPM：一拍一秒，八分 = 0.5s
check(eq(punk.map(s => s.at), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]), 'punk：8 个八分（手算）');
check(punk.every(s => s.stroke === 'chuck'), 'punk 全部 chuck');
const ballad = S.expandRhythm('ballad', 2.0);
check(eq(ballad.map(s => [s.stroke, s.at]),
  [['down', 0], ['up', 1], ['up', 1.5]]), 'ballad：down 空半小节 up-up');
const custR = S.expandRhythm({ beats: 3, steps: [{ beat: 2.5, stroke: 'down' }] }, 3);
check(custR.length === 1 && custR[0].at === 2.5, '自定义节奏型 {beats,steps}：beat 2.5/barSec3 → 2.5s');
const pmR = S.expandRhythm({ beats: 4, steps: [{ beat: 0, stroke: 'down', palmMute: true }] }, 2);
check(pmR[0].palmMute === true, '步级 palmMute 透传');
throws(() => S.expandRhythm('nope', 2), '未知节奏型', '未知节奏型名');
throws(() => S.expandRhythm('folk', 0), '正数', 'barSec = 0');
throws(() => S.expandRhythm('folk', -1), '正数', 'barSec 负');
throws(() => S.expandRhythm(null, 2), '{beats, steps}', 'rhythm 非对象非名字');
throws(() => S.expandRhythm({ beats: 0, steps: [{ beat: 0, stroke: 'down' }] }, 2), 'beats', 'beats = 0');
throws(() => S.expandRhythm({ beats: 4, steps: [] }, 2), '非空数组', '空 steps');
throws(() => S.expandRhythm({ beats: 4, steps: [{ beat: 4, stroke: 'down' }] }, 2), '[0, beats)', 'beat 越界（=beats）');
throws(() => S.expandRhythm({ beats: 4, steps: [{ beat: -0.5, stroke: 'down' }] }, 2), '[0, beats)', 'beat 负');
throws(() => S.expandRhythm({ beats: 4, steps: [{ beat: 0, stroke: 'sideways' }] }, 2), 'step.stroke', 'stroke 未知');

/* ------------------------------------------------------------- ⑪ 人性化 */
section('⑪ humanize：确定性抖动（mulberry32，参考值来自 Python 独立实现）');
const REF = {
  1: [0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982, 0.281103503],
  42: [0.6011037519, 0.448290559, 0.8524657935, 0.6697340414, 0.1748138987, 0.5265925422],
  123456: [0.3823330435, 0.7972629075, 0.9965302374, 0.1600116848, 0.2085719788, 0.2328370977],
};
let refOk = true;
for (const seed of [1, 42, 123456]) {
  const r = S.mulberry32(seed);
  for (let i = 0; i < 6; i++)
    if (Math.abs(r() - REF[seed][i]) > 1e-9) refOk = false;
}
check(refOk, 'mulberry32 前 6 输出与 Python 独立实现逐项咬合（seed 1/42/123456）');
throws(() => S.mulberry32(0), '≥1', 'seed 0');
throws(() => S.mulberry32(1.5), '整数', 'seed 非整数');

const ev2 = S.strum([40, 47], { pattern: 'down', spread: 0.06, gate: 1.2 });
const h1 = S.humanize(ev2, { seed: 1, timingMs: 6, velJitter: 10 });
/* 手算（seed 1，每事件消耗两个随机数：先时机后力度）：
   ev0: dT=(2*0.6270739406-1)*6ms=+1.5249ms → tOn=0.001525（取整 1e-6）
        dV=round((2*0.0027357212-1)*10)=-10 → vel 112-10=102
   ev1: dT=(2*0.52744704-1)*6ms=+0.3294ms → tOn=0.060329
        dV=round((2*0.9810509675-1)*10)=+10 → vel 76+10=86 */
check(eq(h1.map(e => e.tOn), [0.001525, 0.060329]), 'tOn 偏移精确到微秒（手算 seed=1）');
check(eq(h1.map(e => e.velocity), [102, 86]), 'velocity 抖动 -10/+10（手算）');
check(h1.every(e => Math.abs(e.tOff - e.tOn - 1.2) < 1e-9), 'gate 保形：tOff 随 tOn 平移');
check(h1[0].tOff === 1.201525 && h1[1].tOff === 1.260329, 'tOff 取整同样到微秒');
check(eq(h1.map(e => e.note), [40, 47]) && h1[0].string === 0 && h1[1].stroke === 1,
  'note/string/stroke 原样保留');

check(JSON.stringify(S.humanize(ev2, { seed: 1, timingMs: 6, velJitter: 10 })) ===
      JSON.stringify(h1), '同 seed 同输入两次 → 逐字节相同');
check(JSON.stringify(S.humanize(ev2, { seed: 2, timingMs: 6, velJitter: 10 })) !==
      JSON.stringify(h1), '不同 seed → 结果不同');
throws(() => S.humanize(ev2, {}), '缺 seed', '缺 seed → 报错（不确定性是禁止的）');

/* 关人性化 = 恒等变换：0 幅度的轴完全不动（连取整都不做） */
const h0 = S.humanize(ev2, { seed: 999, timingMs: 0, velJitter: 0 });
check(JSON.stringify(h0) === JSON.stringify(ev2), 'timingMs=0 + velJitter=0 → 与纯 strum 逐字节相同');

/* 边界钳制（消耗顺序：timing=0 时时机随机数不消耗，velocity 用第 1 个输出）
   seed 123456 首输出 0.3823 → dV=round((0.7647-1)*30)=-7 → 2-7=-5 → 钳 1
   seed 1      首输出 0.6271 → dV=round(0.2541*30)=+8  → 120+8=128 → 钳 127
   seed 123456 首输出 0.3823 → dT=(0.7647-1)*10ms=-2.353ms → 0.001-0.00235<0 → 钳 0 */
const one = (vel, tOn) => [{ note: 60, velocity: vel, tOn: tOn, tOff: tOn + 0.4, string: 0, stroke: 0 }];
check(S.humanize(one(2, 0.1), { seed: 123456, velJitter: 30 })[0].velocity === 1,
  'vel 2 + 抖 -7 → 钳到 1（钳自己的抖动量，非掩码参数）');
check(S.humanize(one(120, 0.1), { seed: 1, velJitter: 30 })[0].velocity === 127,
  'vel 120 + 抖 +8 → 钳到 127');
check(S.humanize(one(64, 0.001), { seed: 123456, timingMs: 10 })[0].tOn === 0,
  'tOn 平移后 <0 → 钳到 0（不能跑进上一小节）');

/* 200 组 seed 抽样：无一与原事件全同（防「抖动恒 0」假通过），且全部在界内 */
let allDiffer = true, inBounds = true;
for (let sd = 1; sd <= 200; sd++) {
  const h = S.humanize(ev, { seed: sd, timingMs: 6, velJitter: 10 });
  if (JSON.stringify(h) === JSON.stringify(ev)) allDiffer = false;
  for (let i = 0; i < h.length; i++) {
    if (Math.abs(h[i].tOn - ev[i].tOn) > 0.006 + 1e-9) inBounds = false;
    if (Math.abs(h[i].velocity - ev[i].velocity) > 10) inBounds = false;
  }
}
check(allDiffer, '200 组 seed 抽样：无一与原事件全同');
check(inBounds, '200 组 seed 抽样：|ΔtOn|≤6ms 且 |Δvel|≤10 全部成立');

throws(() => S.humanize([], { seed: 1 }), '非空数组', '空事件组');
throws(() => S.humanize([{ note: 200, velocity: 64, tOn: 0, tOff: 1 }], { seed: 1 }), '越界', 'note 200');
throws(() => S.humanize(ev2, { seed: 1, timingMs: -1 }), '≥0', 'timingMs 负');
throws(() => S.humanize(ev2, { seed: 1, velJitter: -1 }), '≥0', 'velJitter 负');
throws(() => S.humanize(ev2, { seed: 0, timingMs: 6 }), '≥1', 'seed 0');

/* ------------------------------------------------------------- ⑫ barSeed */
section('⑫ barSeed：循环小节的种子派生（写死的偏移，可测）');
check(S.barSeed(7, 0) === 7, 'bar0 = base 本身');
check(S.barSeed(7, 1) === 7 + 7919, 'bar1 = base + 7919');
check(S.barSeed(7, 5) === 7 + 5 * 7919, 'bar5 线性派生');
check(S.barSeed(1, 0) !== S.barSeed(1, 1), '相邻小节种子必不同');
throws(() => S.barSeed(0, 0), '≥1', 'base 0');
throws(() => S.barSeed(1, -1), '≥0', 'barIndex 负');
throws(() => S.barSeed(1.5, 0), '整数', 'base 非整数');

/* ------------------------------------------------------------- ⑬ 调度器 */
section('⑬ FM1_SEQ.createPlayer：lookahead 调度（手动假时钟，不睡觉）');

/* 手动档时钟：pending 记录 {fn, at, id, every}，advance 推进假时间并按时触发。
   set 模拟 setInterval：触发后重臂（除非 clear 过）—— 一次性假定时器
   会让 lookahead 循环只走一步，什么都测不到。 */
let fakeNow = 100;                 // 秒
let pending = [];
let nextId = 1;
const clearedIds = new Set();
const manualTimer = {
  set(fn, ms) { const id = nextId++; pending.push({ fn, at: fakeNow + ms / 1000, id, every: ms / 1000 }); return id; },
  clear(id) { clearedIds.add(id); pending = pending.filter(p => p.id !== id); },
};
function advance(sec) {
  const target = fakeNow + sec;
  for (;;) {
    const due = pending.filter(p => p.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    pending = pending.filter(p => p !== due);
    fakeNow = due.at;
    due.fn();
    if (!clearedIds.has(due.id))
      pending.push({ fn: due.fn, at: due.at + due.every, id: due.id, every: due.every });
  }
  fakeNow = target;
}

/* buildBar：真实 FM1_STRUM 造 folk 小节（与页面将来同一套组合） */
const BAR_SEC = 2.0;               // 120BPM 4/4
function makeBuildBar(baseSeed) {
  return function (barIndex) {
    const steps = S.expandRhythm('folk', BAR_SEC);
    let events = [];
    for (const st of steps) {
      const evs = S.strum(E6, { pattern: st.stroke, spread: 0.09, gate: 1.2 });
      const hz = S.humanize(evs, { seed: S.barSeed(baseSeed, barIndex), timingMs: 6, velJitter: 10 });
      events = events.concat(hz.map(e => ({ note: e.note, velocity: e.velocity,
        tOn: e.tOn + st.at, tOff: e.tOff + st.at, string: e.string, stroke: e.stroke })));
    }
    return { events: events, barSec: BAR_SEC };
  };
}

/* 校验路径 */
throws(() => SEQ.createPlayer({}), 'now', '缺 now');
throws(() => SEQ.createPlayer({ now: () => fakeNow }), 'timer', '缺 timer');
throws(() => SEQ.createPlayer({ now: () => fakeNow, timer: manualTimer }), 'deliver', '缺 deliver');
throws(() => SEQ.createPlayer({ now: () => fakeNow, timer: manualTimer, deliver: () => {} }), 'buildBar', '缺 buildBar');
throws(() => SEQ.createPlayer({ now: () => fakeNow, timer: manualTimer, deliver: () => {},
  buildBar: () => ({ events: [], barSec: 2 }), lookahead: 0 }), '正数', 'lookahead = 0');
throws(() => { const p = SEQ.createPlayer({ now: () => fakeNow, timer: manualTimer, deliver: () => {},
  buildBar: () => ({ barSec: 0 }) }); p.start(); }, 'barSec', 'buildBar 返回 barSec=0（start 时炸）');

/* 基本 run：4 小节，barStart 等差 2.0 */
function freshRun(baseSeed) {
  const got = [];
  const player = SEQ.createPlayer({
    now: () => fakeNow,
    timer: manualTimer,
    deliver: (events, barStart, barIndex) => got.push({ events, barStart, barIndex }),
    buildBar: makeBuildBar(baseSeed),
  });
  return { player, got };
}
const run = freshRun(7);
check(run.player.start() === true, 'start() 返回 true');
check(run.player.isRunning() === true, 'isRunning = true');
check(run.player.start() === false, '重复 start = no-op（返回 false，不是错误）');
check(run.got.length === 1, 'start 即排第 1 小节（lookahead 内）');
check(run.got[0].barStart === 100 && run.got[0].barIndex === 0, 'bar0 起点 = 启动时刻 100');
advance(2.0);
check(run.got.length === 2 && run.got[1].barStart === 102, '2 秒后 bar1 已排在 102');
advance(4.0);
check(run.got.length === 4, '再 4 秒共 4 小节');
check(eq(run.got.map(b => b.barStart), [100, 102, 104, 106]), 'barStart 严格等差 2.0（浮点精确）');
check(eq(run.got.map(b => b.barIndex), [0, 1, 2, 3]), 'barIndex 从 0 递增');
check(run.got.every(b => b.events.every(e => e.tOn >= 0 && e.tOn < BAR_SEC)),
  '每小节事件 tOn 全部落在 [0, barSec)');
/* 与 strum 的闭环：bar0 第一步是 0 拍 down 扫弦，首事件 = 最低音弦 */
check(run.got[0].events[0].note === E6[0] &&
      Math.abs(run.got[0].events[0].tOn) <= 0.006,
  'bar0 首事件 = E 和弦最低音弦、tOn 只带人性化偏移（与 strum+humanize 闭环）');

/* 确定性穿透：同一 run 内 bar0 与 bar1 种子不同必不同；跨 run 的 bar0 相同 */
check(JSON.stringify(run.got[0].events) !== JSON.stringify(run.got[1].events),
  'bar0 ≠ bar1（barSeed 派生不同）');
run.player.stop();
check(run.player.isRunning() === false, 'stop 后 isRunning = false');
const before = run.got.length;
advance(10);
check(run.got.length === before, 'stop 后推进时钟不再派发');
const run2 = freshRun(7);
run2.player.start();
check(JSON.stringify(run2.got[0].events) === JSON.stringify(run.got[0].events),
  '跨 run 的 bar0 逐字节相同（任意次起停后第 N 小节确定性）');
run2.player.stop();

/* 积压跳过：挂起 10 秒后恢复，过去的小节不交付，从当前时刻续上 */
const run3 = freshRun(7);
fakeNow = 100;                     // 重置时钟（前面的 run 已推走）
run3.player.start();
fakeNow += 10;                     // 模拟标签页挂起：时钟跳过、定时器没跑
const cnt3 = run3.got.length;
pending.slice().sort((a, b) => a.at - b.at).forEach(p => { fakeNow = Math.max(fakeNow, p.at); p.fn(); });
check(run3.got.length === cnt3 + 1, '挂起恢复：积压小节全部跳过，单次 tick 只补排 1 小节');
check(run3.got[run3.got.length - 1].barStart === 110, '补排的是当前时刻的小节（110 = 100+10）');
run3.player.stop();

/* ------------------------------------------------------------- ⑭ 弦宽与预算 */
section('⑭ 弦宽（pattern.strings）与力度预算（stringBudget，RealGuitar Dyn 式）');
/* 自定义弦宽：保拨弦方向那端 —— low-to-high 保低音侧 3 弦 */
const w3 = S.strum(E6, { pattern: { order: 'low-to-high', muted: false,
  velHigh: 100, velLow: 60, strings: 3 }, spread: 0.09 });
check(w3.length === 3 && eq(w3.map(e => e.string), [0, 1, 2]),
  '自定义 strings=3 → 保低音侧（弦位 0/1/2）');
check(eq(w3.map(e => e.velocity), [100, 80, 60]), '力度在 3 弦上重排 100 → 60');
/* 上扫弦宽：保高音侧（内建 up strings=4 已测）；弦宽超过和弦 → 取全部弦 */
const two2 = S.strum([40, 47], { pattern: 'up', spread: 0.06 });
check(two2.length === 2 && eq(two2.map(e => e.string), [1, 0]),
  '弦宽 > 和弦弦数 → 取全部弦（物理约束，非错误）');
/* stringBudget：默认 down（velHigh 112）→ 全弦，与不开预算逐字节相同 */
check(JSON.stringify(S.strum(E6, { pattern: 'down', stringBudget: true })) ===
      JSON.stringify(S.strum(E6, { pattern: 'down' })),
  'velHigh 112 = 满力度 → 预算不截弦（与无预算逐字节相同）');
/* 轻扫（velHigh 70）：frac=(70-64)/48=0.125 → budget=round(3.375)=3 → 最低 3 弦 */
const light = S.strum(E6, { pattern: 'down', velHigh: 70, velLow: 50, stringBudget: true });
check(light.length === 3 && eq(light.map(e => e.string), [0, 1, 2]),
  '轻扫 velHigh=70 → 只响最低 3 弦（手算 budget=3）');
check(eq(light.map(e => e.velocity), [70, 60, 50]), '轻扫力度在保留下来的弦上重排');
/* 极轻（velHigh 60 < 64 下限）：clamp 0 → 3 弦；up 保高音侧 4 弦后预算再保低侧 */
const vLightUp = S.strum(E6, { pattern: 'up', velHigh: 60, velLow: 40, stringBudget: true });
check(vLightUp.length === 3 && eq(vLightUp.map(e => e.string), [4, 3, 2]),
  '极轻上扫：先保高音 4 弦（2..5）、预算再保低侧 3 弦（2/3/4），高弦先拨');
check(eq(vLightUp.map(e => e.velocity), [60, 50, 40]), '极轻上扫力度 60 → 40');
/* 预算 ≥ 弦宽时不截：up 默认 velHigh 97 → frac=0.6875 → budget 5 > 弦宽 4 */
check(S.strum(E6, { pattern: 'up', stringBudget: true }).length === 4,
  'up 默认力度：预算(5) ≥ 弦宽(4) → 不截');
/* 哑音扫弦不参与预算：chuck 力度天然低于下限，参与预算会被永久砍到 3 弦 */
check(JSON.stringify(S.strum(E6, { pattern: 'chuck', stringBudget: true })) ===
      JSON.stringify(S.strum(E6, { pattern: 'chuck' })),
  'chuck + stringBudget → 与无预算逐字节相同（哑音扫弦 = 全弦闷响，预算不适用）');
/* 校验：strings 非法 */
throws(() => S.strum(E6, { pattern: { order: 'low-to-high', muted: false,
  velHigh: 100, velLow: 60, strings: 0 } }), 'pattern.strings', 'strings = 0');
throws(() => S.strum(E6, { pattern: { order: 'low-to-high', muted: false,
  velHigh: 100, velLow: 60, strings: 2.5 } }), 'pattern.strings', 'strings 非整数');
throws(() => S.strum(E6, { pattern: { order: 'low-to-high', muted: false,
  velHigh: 100, velLow: 60, strings: 1 } }), 'pattern.strings', 'strings = 1（单弦不成扫弦）');

console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
