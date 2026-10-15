// fm1-guitar 页面端到端冒烟测试。
// 场景 A：无 MIDI 环境 —— 音色载入、和弦垫点击、本地 WebAudio 调度。
// 场景 B：假 MIDI access + 字节捕获端口 —— 页面真发出的字节与测试侧
//         用 FM1_STRUM + params 独立复算的期望逐字节对齐。
// 结构沿用 fm1-tone-engine 的 smoke.mjs：DOM 桩 + new Function 执行页面脚本。
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
  'engine/strum.js']) {
  new Function(readFileSync(path.join(ROOT, f), 'utf8'))();
}
const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);

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
  };
}
const els = {};
for (const id of ['voice-sel', 'btn-audition', 'btn-load', 'file-in', 'voice-note',
  'pads', 'ck-pm', 'rng-spread', 'spread-val', 'btn-connect', 'port-sel', 'ck-send',
  'btn-note', 'btn-pmmacro', 'ck-confirm', 'log']) {
  els[id] = makeEl(id);
}
els.log.textContent = '';
els.rngSpread = els['rng-spread'];
els.rngSpread.value = '90';

let currentPattern = 'down';
const document = {
  getElementById(id) { return els[id] || null; },
  querySelector(sel) {
    if (String(sel).indexOf('pattern') >= 0) return { value: currentPattern };
    return null;
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl('el-' + tag + '-' + Math.random()); },
  addEventListener() {},
  body: makeEl('body'),
};

/* ---------------------------------------------------------------- 假音频 */
function FakeAudioContext() {
  FakeAudioContext.instances.push(this);
  this.currentTime = 0;
  this.sampleRate = 44100;
  this.destination = { name: 'dest' };
  this.starts = [];       /* 每次调度一个 src.start(when) 记一个 */
  this.gainVals = [];
}
FakeAudioContext.instances = [];
FakeAudioContext.prototype.createBuffer = function (ch, len, sr) {
  const self = this;
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
    start(when) { self.starts.push(when); },
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

/* ---------------------------------------------------------------- 执行页面脚本 */
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<script>\n([\s\S]*)<\/script>/);
if (!m) { console.log('  FAIL  从 index.html 提取不到内联脚本'); process.exit(1); }

const FakeAC = () => FakeAudioContext.instances[0];
const window = {
  DX7: globalThis.DX7, FM_ENGINE: globalThis.FM_ENGINE, FM1MIDI: globalThis.FM1MIDI,
  DX7_PARAMS: globalThis.DX7_PARAMS, FM1_STRUM: globalThis.FM1_STRUM,
  FM1_STARTER: sandbox.FM1_STARTER,
  AudioContext: FakeAudioContext,
};
new Function('window', 'document', m[1])(window, document);

/* ================================================================ 场景 A */
console.log('\n═══ 场景 A：无 MIDI —— 音色载入 + 本地试听 ═══');

section('A1 音色随 starter 载入');
check((els['voice-sel'].innerHTML.match(/<option /g) || []).length === 32,
  '音色下拉 32 项（随附 CC0 starter）');
check(/随附入门音色/.test(els['voice-sel'].innerHTML), '下拉里带音色库标签');
check(/自检通过/.test(els.log.textContent), '页面自检通过（扫弦引擎 + 字节编解码）');

section('A2 和弦垫');
check(els.pads.children.length === 10, '10 个和弦垫', String(els.pads.children.length));
check(/<div class="nm">E<\/div>/.test(els.pads.children[0].innerHTML), '第一个垫是 E 和弦');
check(els.pads.children[9].innerHTML.indexOf('E7') >= 0, '第十个垫是 E7');

section('A3 点垫 → 本地渲染 + WebAudio 调度（E，6 音符）');
els.pads.children[0].onclick();
check(FakeAC().starts.length === 6, '调了 6 个 BufferSource（每音符一个）',
  String(FakeAC().starts.length));
const starts = FakeAC().starts;
check(starts.every((t, i) => i === 0 || t > starts[i - 1]), '起音时间严格递增（错峰）');
check(Math.abs(starts[0] - 0.06) < 1e-9, '第一个音符在 +60ms 调度余量处起');
check(FakeAC().gainVals.length === 6 && FakeAC().gainVals[0] === 112 / 127,
  '力度进增益（velocity/127，首弦 112）');
check(/扫 E：6 个音符，90ms 内错峰起音/.test(els.log.textContent), '日志给出音符数与错峰总时长');

section('A4 换垫清缓存 + 事件照算');
const startsBefore = FakeAC().starts.length;
els.pads.children[4].onclick();       /* C 和弦：5 音符 */
check(FakeAC().starts.length === startsBefore + 5, 'C 和弦 5 音符 → 5 个新源');

/* ================================================================ 场景 B */
console.log('\n═══ 场景 B：假 MIDI —— 页面真发出的字节 vs 独立复算 ═══');

/* 字节捕获端口：记录 (bytes, when)。Note 消息 FakeFm1 不收（它是 SysEx 规范），
   这里用页面视角的忠实端口 —— 设备收到什么记什么。 */
function CapturePort() {
  this.id = 'fm1-capture';
  this.name = 'M-VAVE FM-1';
  this.manufacturer = 'M-VAVE';
  this.type = 'output';
  this.state = 'connected';
  this.sent = [];       /* { bytes, when } */
  this.send = function (bytes, when) {
    this.sent.push({ bytes: Array.from(bytes), when: when == null ? null : when });
  };
}
const port = new CapturePort();
const navRestorer = (() => {
  const had = typeof globalThis.navigator !== 'undefined';
  const old = had ? globalThis.navigator : undefined;
  /* Node 22 的 navigator 是只读 getter —— 只能 defineProperty 覆盖 */
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { requestMIDIAccess() { return Promise.resolve(M.fakeAccess([port])); } },
  });
  return () => {
    if (had) Object.defineProperty(globalThis, 'navigator',
      { configurable: true, value: old });
    else delete globalThis.navigator;
  };
})();

section('B1 连接 MIDI');
els['btn-connect'].onclick();
for (let i = 0; i < 20; i++) await tick();
check(/MIDI 权限已拿到/.test(els.log.textContent), '权限拿到并选好端口');
check((els['port-sel'].innerHTML.match(/<option /g) || []).length === 1, '端口下拉 1 项');
check(els['btn-note'].disabled === false, '「发单音」按钮已启用');

section('B2 开启「把演奏发到设备」→ 点 G 和弦垫 → 捕获字节对齐独立复算');
els['ck-send'].checked = true;
els.pads.children[3].onclick();       /* G 和弦 6 音符 */
/* 独立复算：不经过页面 —— 同参数调引擎，得到期望字节序列 */
const expectEv = STRUM.strum([43, 47, 50, 55, 59, 67],
  { pattern: 'down', spread: 0.09, palmMute: false });
const expectMsgs = STRUM.eventsToMidi(expectEv, 0);
const justSent = port.sent.slice(-expectMsgs.length);
check(justSent.length === expectMsgs.length, '消息条数 = 2×音符数（On/Off 成对）',
  justSent.length + ' vs ' + expectMsgs.length);
let byteBad = -1;
for (let i = 0; i < expectMsgs.length; i++)
  if (DX7.hex(justSent[i].bytes) !== DX7.hex(expectMsgs[i].bytes)) { byteBad = i; break; }
check(byteBad < 0, '捕获的每一条字节与独立复算逐字节一致', '首条失配 #' + byteBad);
check(justSent[0].bytes[0] === 0x90 && justSent[1].bytes[0] === 0x80,
  'Note On 用 0x90、Note Off 用 0x80');
const t0 = justSent[0].when;
let tBad = -1;
for (let i = 0; i < expectMsgs.length; i++) {
  const expectWhen = t0 + expectMsgs[i].tMs;
  if (Math.abs(justSent[i].when - expectWhen) > 0.5) { tBad = i; break; }
}
check(tBad < 0, '时间戳调度 = performance.now() + tMs（与引擎事件时序一致）', '#' + tBad);
check(/已发出 ≠ 设备已发声/.test(els.log.textContent), '日志带着诚实标注');

section('B3 哑音扫弦：Note Off 紧跟在 70ms 后');
currentPattern = 'chuck';
const sentBefore = port.sent.length;
els.pads.children[2].onclick();       /* F 和弦，chuck */
const chuckSent = port.sent.slice(sentBefore);
const expectChuck = STRUM.eventsToMidi(
  STRUM.strum([41, 48, 53, 57, 60, 65], { pattern: 'chuck', spread: 0.09, palmMute: false }), 0);
check(chuckSent.length === expectChuck.length, 'chuck 消息条数对齐',
  chuckSent.length + ' vs ' + expectChuck.length);
check(DX7.hex(chuckSent.map(s => s.bytes)) === DX7.hex(expectChuck.map(m => m.bytes)),
  'chuck 字节序列与独立复算逐字节一致');
const onMs = chuckSent.filter(s => (s.bytes[0] & 0xF0) === 0x90).map(s => s.when - chuckSent[0].when);
const offMs = chuckSent.filter(s => (s.bytes[0] & 0xF0) === 0x80).map(s => s.when - chuckSent[0].when);
check(Math.abs((offMs[0] - onMs[0]) - 70) < 0.5, '首个音符 70ms 就被掐断（CHUCK_GATE）');
currentPattern = 'down';

section('B4 发单音（真机验证入口）');
const beforeNote = port.sent.length;
els['btn-note'].onclick();
const noteSent = port.sent.slice(beforeNote);
check(noteSent.length === 2 &&
      DX7.hex(noteSent[0].bytes) === '90 40 64' &&
      DX7.hex(noteSent[1].bytes) === '80 40 00',
  '单音 = Note On(64) + Off，字节固定');

section('B5 闷音宏：7 字节实时消息，与 params 独立复算对齐');
const voice0 = DX7.parseBank(DX7.b64ToBytes(sandbox.FM1_STARTER.banks[0])).slice(0, 128);
els['ck-confirm'].checked = false;
els['btn-pmmacro'].onclick();
check(/没在真机上验证过/.test(els.log.textContent), '未勾确认框 → 被拦下（双闸门）');
els['ck-confirm'].checked = true;
els['btn-pmmacro'].onclick();
const expectMacro = P.changesToSysex(P.palmMute(voice0).changes, 0);
const macroSent = port.sent.slice(-expectMacro.length);
check(macroSent.length === expectMacro.length && macroSent.length > 0,
  '宏消息条数与 params 计划一致（' + expectMacro.length + ' 条）');
check(DX7.hex(macroSent.map(s => s.bytes)) === DX7.hex(expectMacro.map(m => Array.from(m))),
  '宏字节与独立复算逐字节一致（含真机锚点编址）');
check(macroSent.every(s => s.bytes.length === 7 && s.bytes[0] === 0xF0 && s.bytes[6] === 0xF7),
  '每条都是 7 字节 F0 43 … F7');
check(/已发出 ≠ 已执行/.test(els.log.textContent), '宏日志带诚实标注');

/* ---------------------------------------------------------------- 收尾 */
globalThis.fetch = realFetch;
navRestorer();
check(fetchCalls === 0, '全程零网络请求（fetch 守门计数 0）');

console.log(`\n${'─'.repeat(56)}`);
console.log(fail === 0 ? `结论：两个场景端到端执行全部通过（${pass} 项断言）。`
                       : `结论：${fail} 项失败 / ${pass} 项通过。`);
process.exit(fail === 0 ? 0 : 1);
