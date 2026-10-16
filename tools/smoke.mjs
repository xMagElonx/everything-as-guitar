// fm1-guitar 页面端到端冒烟测试。
// 场景 A：无 MIDI —— 音色载入（含吉他包）、和弦选中态、手势、按住连扫、循环节奏型。
// 场景 B：假 MIDI（输出捕获 + 输入注入）—— 页面真发出的字节与测试侧
//         用 FM1_STRUM + params 独立复算的期望逐字节对齐。
// 结构沿用 fm1-tone-engine 的 smoke.mjs：DOM 桩 + new Function 执行页面脚本。
// 时钟纪律：页面经 window.setInterval / window.__seqNow 拿时间 —— 这里用
// 手动假时钟接管，循环调度可以被确定性地推进。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));
const M = require_(path.join(ROOT, 'engine', 'midi.js'));
const P = require_(path.join(ROOT, 'engine', 'params.js'));
const STRUM = require_(path.join(ROOT, 'engine', 'strum.js'));

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  ← ' + extra : '')); }
  return cond;
}
function section(t) { console.log('\n' + t); }
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------------------------------------------------------------- 引擎挂 globalThis */
for (const f of ['engine/dx7.js', 'engine/fm.js', 'engine/midi.js', 'engine/params.js',
  'engine/strum.js', 'engine/seq.js', 'engine/sampler.js']) {
  new Function(readFileSync(path.join(ROOT, f), 'utf8'))();
}
const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);
const boxG = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'guitar.js'), 'utf8'))(boxG);

/* ---------------------------------------------------------------- 网络守门 */
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = function () { fetchCalls++; throw new Error('测试期间禁止网络'); };

/* ---------------------------------------------------------------- DOM 桩 */
function makeEl(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false,
    disabled: false, className: '', scrollTop: 0, scrollHeight: 0,
    files: null, dataset: {}, style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    click() {}, focus() {},
    onclick: null, onchange: null, oninput: null, onstatechange: null,
    onpointerdown: null, onpointerup: null, onpointerleave: null, onpointercancel: null,
  };
}
const els = {};
for (const id of ['voice-sel', 'btn-audition', 'btn-load', 'file-in', 'voice-note',
  'btn-sample', 'sample-in', 'sample-root', 'btn-sample-del',
  'pads', 'ck-pm', 'rng-spread', 'spread-val', 'ck-budget',
  'btn-down', 'btn-up', 'btn-chuck', 'ck-hum', 'rng-humt', 'humt-val', 'rng-humv', 'humv-val',
  'sel-rhythm', 'rng-bpm', 'bpm-val', 'in-seed', 'btn-dice', 'btn-loop',
  'btn-connect', 'port-sel', 'ck-send', 'btn-push', 'btn-note', 'btn-pmmacro', 'ck-confirm',
  'in-sel', 'log']) {
  els[id] = makeEl(id);
}
els.log.textContent = '';
els.rngSpread = els['rng-spread'];
els.rngSpread.value = '5';
els['ck-budget'].checked = true;
els['rng-bpm'].value = '100';
els['rng-humt'].value = '6';
els['rng-humv'].value = '10';
els['in-seed'].value = '1';

const keyHandlers = {};
const document = {
  getElementById(id) { return els[id] || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl('el-' + tag + '-' + Math.random()); },
  addEventListener(type, fn) { (keyHandlers[type] = keyHandlers[type] || []).push(fn); },
  body: makeEl('body'),
};
function fireKey(key, extra) {
  const e = Object.assign({ key, repeat: false, target: { tagName: 'BODY' },
    preventDefault() {} }, extra || {});
  for (const fn of keyHandlers.keydown || []) fn(e);
}

/* ---------------------------------------------------------------- 假音频 */
function FakeAudioContext() {
  FakeAudioContext.instances.push(this);
  this.currentTime = 0;
  this.sampleRate = 44100;
  this.destination = { name: 'dest' };
  this.starts = [];
  this.stops = [];
  this.rates = [];
  this.lens = [];
  this.gainVals = [];
}
FakeAudioContext.instances = [];
/* decodeAudioData：回调式（页面同款用法），返回 0.5s 440Hz 正弦。
   v0.5 起上传会跑全自动预处理（trim/根音检测/循环点）——静音桩什么都
   检不出来，必须给非静音内容：440Hz 持续正弦 → 根音 A4(69) + 有循环。 */
FakeAudioContext.prototype.decodeAudioData = function (ab, ok, fail) {
  const n = 22050, pcm = new Float32Array(n);
  for (let i = 0; i < n; i++)
    pcm[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100);
  ok({
    duration: 0.5, sampleRate: 44100, numberOfChannels: 1, length: n,
    getChannelData() { return pcm; },
  });
};
FakeAudioContext.prototype.createBuffer = function (ch, len, sr) {
  const self = this;
  self.lens.push(len);               /* v0.5：buffer 长度是路径判别信号 */
  return {
    length: len, sampleRate: sr,
    getChannelData() { return new Float32Array(len); },
    copyToChannel() { self._copied = (self._copied || 0) + 1; },
  };
};
FakeAudioContext.prototype.createBufferSource = function () {
  const self = this;
  return {
    buffer: null, connect() {},
    playbackRate: { value: 1 },
    start(when) { self.starts.push(when); self.rates.push(this.playbackRate.value); },
    stop(when) { self.stops.push(when); },
  };
};
FakeAudioContext.prototype.createGain = function () {
  const self = this;
  const g = { gain: { value: 0 }, connect() {} };
  Object.defineProperty(g.gain, 'value', {
    get() { return this._v || 0; },
    set(v) { this._v = v; self.gainVals.push(v); },
  });
  return g;
};

/* ---------------------------------------------------------------- 假时钟 + 假定时器 */
let fakeNow = 1000;              // 秒（刻意远离真实 performance.now()，防串线）
let seqTimers = [];
let seqNextId = 1;
function advanceSeq(sec) {
  const target = fakeNow + sec;
  for (;;) {
    const due = seqTimers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    seqTimers = seqTimers.filter(t => t !== due);
    fakeNow = due.at;
    due.fn();
    seqTimers.push({ fn: due.fn, at: due.at + due.every, every: due.every, id: due.id });
  }
  fakeNow = target;
}

/* ---------------------------------------------------------------- 执行页面脚本 */
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script>\n([\s\S]*)<\/script>/);
if (!m) { console.log('  FAIL  从 index.html 提取不到内联脚本'); process.exit(1); }

const window = {
  DX7: globalThis.DX7, FM_ENGINE: globalThis.FM_ENGINE, FM1MIDI: globalThis.FM1MIDI,
  DX7_PARAMS: globalThis.DX7_PARAMS, FM1_STRUM: globalThis.FM1_STRUM,
  FM1_SEQ: globalThis.FM1_SEQ, FM1_SAMPLER: globalThis.FM1_SAMPLER,
  FM1_STARTER: sandbox.FM1_STARTER,
  FM1_GUITAR: boxG.FM1_GUITAR,
  AudioContext: FakeAudioContext,
  setLookup: null,
};
window.setInterval = function (fn, ms) {
  const id = seqNextId++;
  seqTimers.push({ fn, at: fakeNow + ms / 1000, every: ms / 1000, id });
  return id;
};
window.clearInterval = function (id) { seqTimers = seqTimers.filter(t => t.id !== id); };
window.__seqNow = function () { return fakeNow * 1000; };   /* 页面 perfSec() 会 /1000 → 还原成秒 */

new Function('window', 'document', m[1])(window, document);

/* 手势种子的独立复算：页面用 barSeed(1, 100000 + n)，n = 本次会话第几个手势 */
let gestureN = -1;
function gestureSeed() { return STRUM.barSeed(1, 100000 + ++gestureN); }

/* ================================================================ 场景 A */
console.log('\n═══ 场景 A：无 MIDI —— 音色 + 选中态 + 手势 + 循环 ═══');
const FakeAC = () => FakeAudioContext.instances[0];

section('A1 音色随 starter + 吉他包载入');
check((els['voice-sel'].innerHTML.match(/<option /g) || []).length === 34,
  '音色下拉 34 项（32 starter + 2 原创吉他）');
check(/AC PLUCK/.test(els['voice-sel'].innerHTML) && /EL GTR SUS/.test(els['voice-sel'].innerHTML),
  '两个吉他音色出现在下拉里');
check(/吉他音色包：2 个/.test(els.log.textContent), '吉他包载入有日志');
check(/自检通过：扫弦 \+ 人性化（种子确定） \+ 调度器 \+ 字节编解码就绪/.test(els.log.textContent),
  '页面自检通过（扫弦 + 人性化 + 调度器 + 编解码）');

section('A2 和弦垫');
check(els.pads.children.length === 10, '10 个和弦垫', String(els.pads.children.length));
check(/<div class="nm">E<\/div>/.test(els.pads.children[0].innerHTML), '第一个垫是 E 和弦');
check(els.pads.children[9].innerHTML.indexOf('E7') >= 0, '第十个垫是 E7');

section('A3 点垫 = 选中（不发声）');
els.pads.children[0].onclick();
check(els.pads.children[0].className === 'pad sel', 'E 垫进入选中态（className = pad sel）');
check(FakeAudioContext.instances.length === 0, '选中不发声（连 AudioContext 都没创建）');
check(/选中和弦：E/.test(els.log.textContent), '日志写明选中语义');
els.pads.children[4].onclick();
check(els.pads.children[4].className === 'pad sel' && els.pads.children[0].className === 'pad',
  '换垫：新垫亮、旧垫灭（单选）');

section('A4 手势键 = 一次扫弦（含人性化，独立复算对齐）');
els['btn-down'].onclick();
/* 页面默认：滑杆 5ms/弦 × 4 间隔 = 总窗 0.02s；轻扫减弦开（down velHigh 112 = 满力度不截） */
const evE = STRUM.humanize(
  STRUM.strum([48, 52, 55, 60, 64], { pattern: 'down', spread: 0.02, palmMute: false, stringBudget: true }),
  { seed: gestureSeed(), timingMs: 6, velJitter: 10 });
check(FakeAC().starts.length === evE.length, 'C 和弦 5 音符 → 5 个新源（种子 n=0）',
  FakeAC().starts.length + ' vs ' + evE.length);
const starts = FakeAC().starts;
check(Math.abs(starts[0] - (0.06 + evE[0].tOn)) < 1e-9 &&
      Math.abs(starts[4] - (0.06 + evE[4].tOn)) < 1e-9,
  '起音时间 = 60ms 余量 + 人性化偏移（与独立复算一致）');
check(FakeAC().gainVals.length === evE.length &&
      Math.abs(FakeAC().gainVals[0] - evE[0].velocity / 127) < 1e-12,
  '（抖动后的）力度进增益');
const againStarts = FakeAC().starts.length;
els['btn-down'].onclick();
gestureSeed();                     /* 第二次手势也推进页面计数器 —— 保持种子对齐 */
check(FakeAC().starts.length === againStarts + evE.length,
  '同键再按 → 同样 5 个源（种子推进，但事件结构相同）');

section('A5 按住垫 = motor strum（连续下扫，松手停）');
const before5 = FakeAC().starts.length;
els.pads.children[1].onpointerdown();        /* Em，按住 */
check(/▶ 循环开始：按住连扫 @100 BPM/.test(els.log.textContent), '按下即开连扫（日志）');
const after5 = FakeAC().starts.length;
check(after5 === before5 + 6, '第一小节立即排出（Em 6 音符）',
  (after5 - before5) + ' vs 6');
advanceSeq(1.2);                             /* @100BPM 一拍 0.6s → 再 2 小节 */
check(FakeAC().starts.length === after5 + 12, '假时钟推进 1.2s → 恰好再排 2 小节（12 音符）',
  (FakeAC().starts.length - after5) + ' vs 12');
els.pads.children[1].onpointerup();          /* 松手 */
check(/■ 循环停止/.test(els.log.textContent), '松手即停（日志）');
const after6 = FakeAC().starts.length;
advanceSeq(2);
check(FakeAC().starts.length === after6, '松手后推进时钟不再派发');

section('A6 空格 = 循环节奏型开关');
const barStarts = FakeAC().starts.length;     /* 快照必须取在开循环之前 */
fireKey(' ');
check(/▶ 循环开始：节奏型 folk @100 BPM/.test(els.log.textContent), '空格开循环（folk）');
/* folk（万能 D_DU_UDU）@100BPM barSec = 2.4s；第一小节已排。
   当前选中 = A5 按住过的 Em（6 音）：down 全弦 6 音 ×3 + up 高 4 弦 4 音 ×3 = 30 */
check(FakeAC().starts.length - barStarts === 30, '第一小节 = down×6音×3 + up×4音×3 → 30 源',
  String(FakeAC().starts.length - barStarts) + ' vs 30');
advanceSeq(2.4);
check(FakeAC().starts.length - barStarts === 60, '推进一小节 → 第二小节也排出（共 60）',
  String(FakeAC().starts.length - barStarts) + ' vs 60');
fireKey(' ');
check(/■ 循环停止/.test(els.log.textContent), '空格关循环');
const after7 = FakeAC().starts.length;
advanceSeq(3);
check(FakeAC().starts.length === after7, '关循环后不再派发');
/* BPM 键盘 */
fireKey(']');
check(els['bpm-val'].textContent === '105', '] = BPM+5（回显 105）');
fireKey('['); fireKey('[');
check(els['bpm-val'].textContent === '95', '[ [ = BPM-10（95）');

/* ================================================================ 场景 B */
console.log('\n═══ 场景 B：假 MIDI —— 字节对齐独立复算（输出 + 输入 + 推送）═══');

/* 字节捕获端口（输出）+ 可注入消息的输入端口 */
function CapturePort() {
  this.id = 'fm1-capture';
  this.name = 'M-VAVE FM-1';
  this.manufacturer = 'M-VAVE';
  this.type = 'output';
  this.state = 'connected';
  this.sent = [];
  this.send = function (bytes, when) {
    this.sent.push({ bytes: Array.from(bytes), when: when == null ? null : when });
  };
}
const port = new CapturePort();
const inPort = {
  id: 'keys-in', name: 'MIDI Keyboard', manufacturer: '', type: 'input',
  state: 'connected', onmidimessage: null,
};
const navRestorer = (() => {
  const had = typeof globalThis.navigator !== 'undefined';
  const old = had ? globalThis.navigator : undefined;
  const access = M.fakeAccess([port]);
  access.inputs = new Map([[inPort.id, inPort]]);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { requestMIDIAccess() { return Promise.resolve(access); } },
  });
  return () => {
    if (had) Object.defineProperty(globalThis, 'navigator',
      { configurable: true, value: old });
    else delete globalThis.navigator;
  };
})();

section('B1 连接 MIDI（输出 + 输入）');
els['btn-connect'].onclick();
for (let i = 0; i < 20; i++) await tick();
check(/MIDI 权限已拿到/.test(els.log.textContent), '权限拿到并选好端口');
check((els['port-sel'].innerHTML.match(/<option /g) || []).length === 1, '输出端口下拉 1 项');
check((els['in-sel'].innerHTML.match(/<option /g) || []).length === 1, '输入端口下拉 1 项');
check(els['btn-push'].disabled === false, '「推送音色」按钮已启用');
check(typeof inPort.onmidimessage === 'function', '输入端口的 onmidimessage 已被页面接管');

section('B2 键盘选和弦 + 手势键 → 捕获字节对齐独立复算（含人性化）');
els['ck-send'].checked = true;
fireKey('4');                                 /* 选 G 和弦 */
check(els.pads.children[3].className === 'pad sel', '键盘 4 → G 垫选中');
const sentBefore2 = port.sent.length;
fireKey('d');                                 /* 下扫 */
const justSent = port.sent.slice(sentBefore2);
/* 页面默认：5ms/弦 × 5 间隔 = 总窗 0.025s；轻扫减弦开（down 满力度不截） */
const expectEv = STRUM.humanize(
  STRUM.strum([43, 47, 50, 55, 59, 67], { pattern: 'down', spread: 0.025, palmMute: false, stringBudget: true }),
  { seed: gestureSeed(), timingMs: 6, velJitter: 10 });
const expectMsgs = STRUM.eventsToMidi(expectEv, 0);
check(justSent.length === expectMsgs.length, '消息条数 = 2×音符数（On/Off 成对）',
  justSent.length + ' vs ' + expectMsgs.length);
let byteBad = -1;
for (let i = 0; i < expectMsgs.length; i++)
  if (DX7.hex(justSent[i].bytes) !== DX7.hex(expectMsgs[i].bytes)) { byteBad = i; break; }
check(byteBad < 0, '捕获的每一条字节与独立复算逐字节一致（含人性化抖动）', '首条失配 #' + byteBad);
const t0 = justSent[0].when;
let tBad = -1;
for (let i = 0; i < expectMsgs.length; i++) {
  if (Math.abs(justSent[i].when - (t0 + expectMsgs[i].tMs)) > 0.5) { tBad = i; break; }
}
check(tBad < 0, '时间戳调度 = 发送时刻 + tMs', '#' + tBad);
check(/已发出 ≠ 设备已发声/.test(els.log.textContent), '日志带着诚实标注');

section('B3 哑音手势：Note Off 紧跟 70ms（人性化保 gate 形）');
const sentBefore3 = port.sent.length;
fireKey('3');                                 /* 选 F */
fireKey('x');                                 /* 哑音 */
const chuckSent = port.sent.slice(sentBefore3);
const onMs = chuckSent.filter(s => (s.bytes[0] & 0xF0) === 0x90).map(s => s.when - chuckSent[0].when);
const offMs = chuckSent.filter(s => (s.bytes[0] & 0xF0) === 0x80).map(s => s.when - chuckSent[0].when);
check(onMs.length === 6 && offMs.length === 6, '6 On + 6 Off');
check(Math.abs((offMs[0] - onMs[0]) - 70) < 0.5, '首个音符 70ms 被掐断（CHUCK_GATE 不被人化破坏）');
gestureSeed();                     /* B3 的哑音手势也推进页面手势计数器 —— 保持种子对齐 */

section('B4 循环走 MIDI：小节字节 vs 独立复算（假时钟推进）');
const sentBefore4 = port.sent.length;
const loopBaseSec = fakeNow;                  /* 循环 bar0 的绝对起点（秒） */
fireKey(' ');                                 /* 开循环（folk @95 BPM，seed=1） */
const loopBar0 = port.sent.slice(sentBefore4);
/* 独立复算 bar0：每步 strum+humanize(seed=barSeed(1, 0*8+i))，偏移到步时刻 */
const bpm = 95, barSec = 4 * 60 / bpm;
const steps = STRUM.expandRhythm('folk', barSec);
let expectEvents = [];
steps.forEach((st, i) => {
  const evs = STRUM.humanize(
    STRUM.strum([41, 48, 53, 57, 60, 65], { pattern: st.stroke, spread: 0.025, stringBudget: true }),
    { seed: STRUM.barSeed(1, 0 * 8 + i), timingMs: 6, velJitter: 10 });
  for (const e of evs)
    expectEvents.push({ note: e.note, velocity: e.velocity,
      tOn: e.tOn + st.at, tOff: e.tOff + st.at });
});
const expectLoop = STRUM.eventsToMidi(expectEvents, 0);
check(loopBar0.length === expectLoop.length, 'bar0 消息条数 = 复算（' + expectLoop.length + ' 条）',
  loopBar0.length + ' vs ' + expectLoop.length);
let loopBad = -1;
for (let i = 0; i < expectLoop.length; i++)
  if (DX7.hex(loopBar0[i].bytes) !== DX7.hex(expectLoop[i].bytes)) { loopBad = i; break; }
check(loopBad < 0, '循环 bar0 字节与独立复算逐字节一致（种子派生穿透到页面层）', '#' + loopBad);
const baseMs = loopBaseSec * 1000;
let loopTBad = -1;
for (let i = 0; i < expectLoop.length; i++)
  if (Math.abs(loopBar0[i].when - (baseMs + expectLoop[i].tMs)) > 0.5) { loopTBad = i; break; }
check(loopTBad < 0, '循环时间戳 = barStart×1000 + tMs（同一时钟坐标系）', '#' + loopTBad);
fireKey(' ');                                 /* 关循环 */

section('B5 发单音（真机验证入口）');
const beforeNote = port.sent.length;
els['btn-note'].onclick();
const noteSent = port.sent.slice(beforeNote);
check(noteSent.length === 2 &&
      DX7.hex(noteSent[0].bytes) === '90 40 64' &&
      DX7.hex(noteSent[1].bytes) === '80 40 00',
  '单音 = Note On(64) + Off，字节固定');

section('B6 推送当前音色：155 条实时参数消息，与 params 独立复算对齐');
const voice0 = DX7.parseBank(DX7.b64ToBytes(sandbox.FM1_STARTER.banks[0])).slice(0, 128);
els['ck-confirm'].checked = false;
els['btn-push'].onclick();
check(/没在真机上验证过/.test(els.log.textContent), '未勾确认框 → 被拦下（双闸门）');
els['ck-confirm'].checked = true;
const beforePush = port.sent.length;
els['btn-push'].onclick();
const pushSent = port.sent.slice(beforePush);
const expectPush = P.pushVoice(voice0, 0);
check(pushSent.length === 155, '恰 155 条', String(pushSent.length));
let pushBad = -1;
for (let i = 0; i < 155; i++)
  if (DX7.hex(pushSent[i].bytes) !== DX7.hex(expectPush[i].bytes)) { pushBad = i; break; }
check(pushBad < 0, '推送字节与 pushVoice 独立复算逐字节一致', '#' + pushBad);
check(pushSent.every(s => s.bytes.length === 7 && s.bytes[0] === 0xF0 && s.bytes[6] === 0xF7),
  '每条都是 7 字节 F0 43 … F7');
let paceBad = -1;
for (let i = 1; i < 155; i++)
  if (Math.abs(pushSent[i].when - pushSent[i - 1].when - 4) > 0.5) { paceBad = i; break; }
check(paceBad < 0, '间隔 4ms 逐条排开（背靠背不发）');
check(/不 SAVE 断电即失/.test(els.log.textContent), '日志写明持久化规则');

section('B7 MIDI 输入：低音区选和弦、高音区手势（与页面手势同一通路）');
inPort.onmidimessage({ data: [0x90, 43, 100] });       /* G2 → 槽位 7 = A 和弦（半音连续映射） */
check(els.pads.children[7].className === 'pad sel', 'MIDI 键盘 G2 → 第 8 个垫（A）选中');
const sentBefore8 = port.sent.length;
inPort.onmidimessage({ data: [0x90, 60, 100] });       /* C4 → 下扫 */
const inSent = port.sent.slice(sentBefore8);
const expectIn = STRUM.eventsToMidi(STRUM.humanize(
  STRUM.strum([45, 52, 57, 61, 64], { pattern: 'down', spread: 0.09 }),
  { seed: gestureSeed(), timingMs: 6, velJitter: 10 }), 0);
check(inSent.length === expectIn.length &&
      DX7.hex(inSent.map(s => s.bytes)) === DX7.hex(expectIn.map(mm => mm.bytes)),
  'MIDI 输入触发的扫弦字节与手势键完全一致（单一通路）');
inPort.onmidimessage({ data: [0x80, 60, 0] });         /* Note Off 被忽略 */
check(port.sent.length === sentBefore8 + expectIn.length, 'Note Off 不触发任何东西');

section('B8 闷音宏：7 字节实时消息（原有路径回归）');
els['ck-confirm'].checked = false;
els['btn-pmmacro'].onclick();
check(/没在真机上验证过/.test(els.log.textContent), '未勾确认框 → 被拦下（双闸门）');
els['ck-confirm'].checked = true;
els['btn-pmmacro'].onclick();
const expectMacro = P.changesToSysex(P.palmMute(voice0).changes, 0);
const macroSent = port.sent.slice(-expectMacro.length);
check(macroSent.length === expectMacro.length && macroSent.length > 0,
  '宏消息条数与 params 计划一致（' + expectMacro.length + ' 条）');
check(DX7.hex(macroSent.map(s => s.bytes)) === DX7.hex(expectMacro.map(mm => Array.from(mm))),
  '宏字节与独立复算逐字节一致（含真机锚点编址）');
check(/已发出 ≠ 已执行/.test(els.log.textContent), '宏日志带诚实标注');

/* ================================================================ 场景 C */
console.log('\n═══ 场景 C：采样音色 —— 上传/变调/守卫/删除（IDB 在 Node 降级）═══');

/* 假 FileReader：页面 new FileReader() 走的是 globalThis（Node 全局）——
   挂上再摘掉，别污染其他场景 */
function FakeFileReader() {}
FakeFileReader.prototype.readAsArrayBuffer = function () {
  const self = this;
  setImmediate(() => { if (self.onload) self.onload(); });
};
globalThis.FileReader = FakeFileReader;

section('C1 上传采样：预处理 → 自动根音 → 入列（IDB 不可用 → 会话内降级）');
els['sample-root'].value = '40';                /* 真浏览器里默认选中的 E2 */
els['sample-in'].files = [{ name: 'hit.wav' }];
const optsBefore = (els['voice-sel'].innerHTML.match(/<option /g) || []).length;
els['sample-in'].onchange();
for (let i = 0; i < 5; i++) await tick();       /* FileReader 异步 onload */
check((els['voice-sel'].innerHTML.match(/<option /g) || []).length === optsBefore + 1,
  '上传后音色下拉多一项', (els['voice-sel'].innerHTML.match(/<option /g) || []).length + ' vs ' + (optsBefore + 1));
check(/采样·根音 A4/.test(els['voice-sel'].innerHTML),
  '下拉标记「采样·根音 A4」（440Hz 自动检测 → 69）');
check(els['sample-root'].value === '69', '根音下拉被预填为检测结果 69');
check(/（自动检测）/.test(els.log.textContent), '根音来源入日志（自动检测）');
check(/已定位延音循环/.test(els.log.textContent), '持续正弦 → 自动定位延音循环');
check(/采样「hit\.wav」就绪/.test(els.log.textContent), '就绪日志（时长/采样率/根音）');
check(/IndexedDB 不可用（隐私模式？）：采样仅本次会话有效/.test(els.log.textContent),
  'Node 无 IDB → 会话内降级有日志（不大声失败也不静默）');
check(els['btn-sample-del'].style.display === '', '选中采样 → 删除按钮出现');

section('C2 采样手势：统一渲染管线（零 stop、buffer 长度 = gate+40ms、力度照常）');
const SAM = globalThis.FM1_SAMPLER;
/* 给 renderNote 套计数器：缓存省的是 DSP 渲染，不是 createBuffer 分配
   （scheduleNote 每音符都建新 AudioBuffer——那是廉价操作），所以缓存命中
   的判别信号是渲染调用次数，不是 lens。 */
const realSamplerRender = SAM.renderNote;
let samplerRenderCalls = 0;
SAM.renderNote = function () {
  samplerRenderCalls++;
  return realSamplerRender.apply(this, arguments);
};
const beforeC2s = FakeAC().starts.length, beforeC2g = FakeAC().gainVals.length,
      beforeC2l = FakeAC().lens.length, beforeC2st = FakeAC().stops.length;
els['btn-down'].onclick();
/* 当前选中和弦 = B7 结束时的 A（槽 7，5 音）：与页面同参独立复算。
   根音已被自动检测预填为 69（A4）。 */
const evS = STRUM.humanize(
  STRUM.strum([45, 52, 57, 61, 64], { pattern: 'down', spread: 0.02, palmMute: false, stringBudget: true }),
  { seed: gestureSeed(), timingMs: 6, velJitter: 10 });
check(FakeAC().starts.length - beforeC2s === evS.length, '采样手势源数 = 事件数（5）',
  (FakeAC().starts.length - beforeC2s) + ' vs ' + evS.length);
check(FakeAC().stops.length - beforeC2st === 0,
  '零显式 stop（v0.5 统一管线：包络烘焙进 buffer，与 FM 同构）',
  'stops+' + (FakeAC().stops.length - beforeC2st));
let gainBad = -1;
for (let i = beforeC2g; i < FakeAC().gainVals.length; i++)
  if (Math.abs(FakeAC().gainVals[i] - evS[i - beforeC2g].velocity / 127) > 1e-12) { gainBad = i - beforeC2g; break; }
check(gainBad < 0, '力度照常进增益（velocity/127）', '#' + gainBad);
let lenBad = -1;
for (let i = 0; i < evS.length; i++) {
  const want = Math.ceil((evS[i].tOff - evS[i].tOn + 0.04) * 44100);
  if (FakeAC().lens[beforeC2l + i] !== want) { lenBad = i; break; }
}
check(lenBad < 0, '每个源 buffer 长度 = (gate+40ms)*sr（逐事件对齐，不随 rate 变）',
  '#' + lenBad);
/* 缓存验证：人性化会给 gate 加 ±6ms 抖动（每次手势键都不同，命中不了
   是正确行为），关掉人性化连点两次 —— 事件逐字节相同 → 渲染零重复。
   桩元素改 checked 不会触发页面逻辑，必须显式调 onchange() 同步
   S.humanize.on。 */
els['ck-hum'].checked = false; els['ck-hum'].onchange();
els['btn-down'].onclick();
gestureSeed();                                  /* 关人性化也消耗手势种子 */
const callsMid = samplerRenderCalls;            /* 首次关人性化：+5 次渲染 */
els['btn-down'].onclick();
gestureSeed();
check(samplerRenderCalls === callsMid,
  '同参手势命中 S.cache（DSP 渲染零重复）',
  '+' + (samplerRenderCalls - callsMid) + ' 次渲染');
els['ck-hum'].checked = true; els['ck-hum'].onchange();   /* 还原 */

section('C3 守卫：采样音色不能推送/闷音宏（没有参数字节）');
const sentBeforeC = port.sent.length;
els['btn-push'].onclick();
check(/采样音色没有参数字节，无法推送/.test(els.log.textContent), 'pushVoice 被守卫拦下');
check(port.sent.length === sentBeforeC, '被拦时一条消息都没发');
els['btn-pmmacro'].onclick();
check(/闷音宏（改设备端包络）不适用/.test(els.log.textContent), '闷音宏同样被拦（带替代建议）');
check(port.sent.length === sentBeforeC, '仍然一条没发');

section('C4 删除采样：列表回落、FM 路径恢复');
els['btn-sample-del'].onclick();
check((els['voice-sel'].innerHTML.match(/<option /g) || []).length === optsBefore,
  '删除后音色下拉回到原项数');
check(els['btn-sample-del'].style.display === 'none', '删除按钮隐藏（当前不是采样）');
const beforeC4s = FakeAC().starts.length, beforeC4l = FakeAC().lens.length;
els['btn-down'].onclick();                      /* S.sel 落回普通音色 → FM 路径 */
/* 两条路径现在都不 stop（包络烘焙），判别信号换成 buffer 长度模式：
   FM = round((gate+0.35)*sr)，采样 = ceil((gate+0.04)*sr) */
const seed4 = gestureSeed();                    /* 点击后取 = 页面刚用掉的种子 */
const ev4 = STRUM.humanize(
  STRUM.strum([45, 52, 57, 61, 64], { pattern: 'down', spread: 0.02, palmMute: false, stringBudget: true }),
  { seed: seed4, timingMs: 6, velJitter: 10 });
let fmLenBad = -1;
for (let i = 0; i < ev4.length; i++) {
  const want = Math.round((ev4[i].tOff - ev4[i].tOn + 0.35) * 44100);
  if (FakeAC().lens[beforeC4l + i] !== want) { fmLenBad = i; break; }
}
check(FakeAC().starts.length - beforeC4s === 5 && fmLenBad < 0,
  'FM 路径恢复：5 个声源、buffer 长度 = (gate+350ms)*sr（FM 特征，零采样残留）',
  'starts+' + (FakeAC().starts.length - beforeC4s) + ' lenBad#' + fmLenBad);

globalThis.FileReader = undefined;              /* 摘掉假 FileReader */


globalThis.fetch = realFetch;
navRestorer();
check(fetchCalls === 0, '全程零网络请求（fetch 守门计数 0）');

console.log(`\n${'─'.repeat(56)}`);
console.log(fail === 0 ? `结论：三个场景端到端执行全部通过（${pass} 项断言）。`
                       : `结论：${fail} 项失败 / ${pass} 项通过。`);
process.exit(fail === 0 ? 0 : 1);
