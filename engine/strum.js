/* ============================================================================
   FM-1 演奏台 · 扫弦引擎
   ----------------------------------------------------------------------------
   把「扫一下」变成一串带时序与力度的 MIDI 音符事件。纯函数：不碰 DOM、
   不碰 AudioContext、不碰 MIDI 端口 —— 同样的输入永远得到同样的事件序列，
   浏览器与 Node 共用这一份（UMD，全局 FM1_STRUM）。

   做法依据（不是发明，是 MIDI 行业三十年的通行做法）：
     · 扫弦 = 和弦里每根弦一个音符，起音按拨弦次序错开 spread 秒
       （RealGuitar / EZkeys / Ample Sound 等 strum 引擎同构，它们的
       "strum time" 参数对应这里的 spread）。
     · 下扫从低音弦开始、上扫从高音弦开始；力度沿拨弦次序线性递减
       （先被拨到的弦吃到的力最大 —— 拨片的物理），上扫整体偏轻。
     · 哑音扫弦（chuck）= 每个音符时值极短 + 力度压低。
     · 闷音（事件级）= 音符时值被钳短 —— 演奏时序的事，跟「音色本身
       变闷」（params.js 的 palmMute 宏，改设备端包络）是两回事，可叠加。

   所有校验抛错不静默：越界值、未知 pattern、非升序 note 列表都当场炸 ——
   静默修正会掩盖调用方的 bug（这是 fm1-tone-engine 两次栽跟头换来的规矩）。
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FM1_STRUM = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* pattern 表：数据驱动。order 是拨弦次序，muted 是哑音扫弦标记，
     velHigh/velLow 是该 pattern 的默认力度端点，strings 是弦宽
     （从拨弦方向那端数起：上扫只带高音 4 弦 —— 真实扫弦里上扫不碰低音弦，
     这是 modwheel.net 扫弦指南 + RealGuitar 手册一致的行业事实；
     下扫/chuck 全弦）。up 端点 = down 端点 − 15（上扫整体偏轻）。
     自定义 pattern = 传入同构对象即可，不加新代码分支。 */
  var PATTERNS = {
    down:  { order: 'low-to-high', muted: false, velHigh: 112, velLow: 76, strings: 6 },
    up:    { order: 'high-to-low', muted: false, velHigh: 97,  velLow: 61, strings: 4 },
    chuck: { order: 'low-to-high', muted: true,  velHigh: 58,  velLow: 45 },
  };

  var CHUCK_GATE = 0.07;     // 哑音扫弦每音时值（秒）
  var MUTE_GATE = 0.14;      // 事件级闷音把每音时值钳到的上限（秒）

  function isPosNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  /* 校验 note 列表：0-127 的整数、严格升序。
     「第几根弦」的语义依赖调用方给的低→高次序，静默重排会掩盖调用方的 bug，
     所以检测到非升序直接抛 —— 修调用方，不修数据。 */
  function checkNotes(notes) {
    if (!notes || typeof notes.length !== 'number' || notes.length === 0)
      throw new Error('notes 必须是非空数组（低音弦 → 高音弦）');
    if (notes.length < 2)
      throw new Error('扫弦至少要 2 根弦，实际 ' + notes.length + ' 个音');
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n !== Math.floor(n) || n < 0 || n > 127)
        throw new Error('note 必须是 0-127 的整数，实际 ' + n);
      if (i > 0 && n <= notes[i - 1])
        throw new Error('notes 必须严格升序（低音弦 → 高音弦），第 ' + i + ' 个 ' + n +
                        ' ≤ 前一个 ' + notes[i - 1]);
    }
  }

  /* ---- 核心：和弦 + pattern + 时序 → 事件序列 ----
     opts.pattern: 'down' | 'up' | 'chuck' 或自定义 { order, muted, velHigh, velLow, strings }
     opts.spread:  扫弦总时长（秒），默认 0.025 —— 6 弦每弦 5ms，总窗 25ms，
                   落在真实拨片的 15–35ms 区间（旧默认 0.09 慢了近 4 倍且每弦
                   18ms，是「像竖琴不像扫弦」的第一主因，见计划文件调研节）
     opts.gate:    每音保持（秒），默认 1.2（chuck/闷音会钳得更短）
     opts.velHigh / opts.velLow: 力度端点（覆盖 pattern 默认）
     opts.palmMute: true → 事件级闷音，每音时值钳到 MUTE_GATE
     opts.stringBudget: true → 力度决定弦数（RealGuitar「Dyn=Velo Strum」式）：
                   第一根被拨弦的力度（velHigh）≥112 全弦、≤64 只响最低 3 弦，
                   线性内插，保低音侧。轻扫 = 少而低沉，重扫 = 全弦轰鸣。
     返回 [{ note, velocity, tOn, tOff, string, stroke }]，时间单位秒，
     string = 原始弦位（0 = 最低音弦），stroke = 拨弦次序（0 = 第一个被拨到）。 */
  function strum(notes, opts) {
    checkNotes(notes);
    opts = opts || {};
    var pattern;
    if (typeof opts.pattern === 'string') {
      pattern = PATTERNS[opts.pattern];
      if (!pattern) throw new Error('未知 pattern：' + opts.pattern +
        '（可用：' + Object.keys(PATTERNS).join(' / ') + '，或传 {order, muted} 对象）');
    } else if (opts.pattern && typeof opts.pattern === 'object') {
      if (opts.pattern.order !== 'low-to-high' && opts.pattern.order !== 'high-to-low')
        throw new Error('自定义 pattern.order 必须是 low-to-high 或 high-to-low');
      pattern = { order: opts.pattern.order, muted: !!opts.pattern.muted,
                  velHigh: opts.pattern.velHigh, velLow: opts.pattern.velLow,
                  strings: opts.pattern.strings };
    } else {
      throw new Error('缺 pattern：down / up / chuck，或 {order, muted} 对象');
    }

    var spread = opts.spread == null ? 0.025 : opts.spread;
    var gate = opts.gate == null ? 1.2 : opts.gate;
    if (!isPosNum(spread)) throw new Error('spread 必须是正数，实际 ' + spread);
    if (!isPosNum(gate)) throw new Error('gate 必须是正数，实际 ' + gate);

    var velHigh = opts.velHigh == null ? pattern.velHigh : opts.velHigh;
    var velLow = opts.velLow == null ? pattern.velLow : opts.velLow;
    checkVel(velHigh, 'velHigh'); checkVel(velLow, 'velLow');

    var muted = pattern.muted || !!opts.palmMute;
    var capGate = pattern.muted ? CHUCK_GATE : (opts.palmMute ? MUTE_GATE : gate);
    /* 力度不用隐藏钳制：chuck 的低力度来自 PATTERNS 默认端点，用户显式
       覆盖 velHigh/velLow 就按用户的来 —— 静默改值正是本项目禁止的掩码行为。 */

    /* ---- 有效弦集合：先按 pattern 弦宽截（拨弦方向那端），再按力度预算截 ----
       弦宽超过和弦弦数时取全部弦 —— 物理上不可能扫出比和弦更多的弦，
       这是约束不是错误。stringBudget 再保低音侧截（轻扫少而低沉）。 */
    var n0 = notes.length;
    var width = pattern.strings == null ? n0 : pattern.strings;
    if (width !== Math.floor(width) || width < 2)
      throw new Error('pattern.strings 必须是 ≥2 的整数，实际 ' + width);
    if (width > n0) width = n0;
    var lo = 0, hi = n0 - 1;
    if (pattern.order === 'high-to-low') lo = n0 - width;   /* 上扫：保高音侧 */
    else hi = width - 1;                                    /* 下扫：保低音侧 */
    if (opts.stringBudget && !pattern.muted) {
      /* 哑音扫弦（chuck/自定义 muted）不参与预算：它的意义就是全弦闷响，
         而它的力度端点天然低于预算下限，参与预算会被永久砍到 3 弦。
         事件级闷音（palmMute）照常参与 —— 轻的闷下扫少几根弦是成立的。 */
      var frac = (velHigh - 64) / (112 - 64);
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      var budget = Math.round(3 + (width - 3) * frac);
      if (budget < 2) budget = 2;
      if (budget > width) budget = width;
      hi = lo + budget - 1;                                 /* 预算截弦：保低音侧 */
    }
    var n = hi - lo + 1;                    /* n ≥ 2：budget/width 下限保证 */

    var step = spread / (n - 1);            // 每弦错峰间隔
    var out = [];
    for (var s = 0; s < n; s++) {
      var idx = pattern.order === 'low-to-high' ? lo + s : hi - s;
      var tOn = s * step;
      /* 力度沿「拨弦次序」线性递减：先被拨到的弦最响。
         单弦扫弦（n=1）不可能到达（弦集合下限 2），这里不会除零。 */
      var vel = Math.round(velHigh + (velLow - velHigh) * (s / (n - 1)));
      var tOff = tOn + (muted ? capGate : gate);
      out.push({ note: notes[idx], velocity: vel, tOn: tOn, tOff: tOff,
                 string: idx, stroke: s });
    }
    /* 终检：产出必须自洽 —— 时序单调、时值正、力度合法。
       这是给未来改算法的人（包括未来的我们）上的保险：改坏了当场炸。 */
    for (var e = 0; e < out.length; e++) {
      var ev = out[e];
      if (!(ev.tOn >= 0) || !(ev.tOff > ev.tOn))
        throw new Error('内部错误：事件时序不合法 tOn=' + ev.tOn + ' tOff=' + ev.tOff);
      if (ev.velocity < 1 || ev.velocity > 127)
        throw new Error('内部错误：velocity 越界 ' + ev.velocity);
      if (e > 0 && out[e].tOn < out[e - 1].tOn)
        throw new Error('内部错误：tOn 序列不是单调不减');
    }
    return out;
  }

  function checkVel(v, who) {
    if (v !== Math.floor(v) || v < 1 || v > 127)
      throw new Error(who + ' 必须是 1-127 的整数，实际 ' + v);
  }

  /* ---- 事件序列 → MIDI Note On/Off 消息（带相对时间戳） ----
     返回 [{ bytes:[0x90,note,vel], tMs }, { bytes:[0x80,note,0], tMs }]
     tMs = 相对扫弦起点的毫秒偏移，交给 output.send(bytes, when) 定时。
     Note Off 用独立的 0x80（不用 0x90 vel=0）—— 语义清晰、测试好断言；
     若某天发现 FM-1 对 0x80 有兼容问题，只改这一处。
     这是个纯映射，smoke 测试用它做「独立重算期望字节」的另一半。 */
  function eventsToMidi(events, channel) {
    if (channel !== Math.floor(channel) || channel < 0 || channel > 15)
      throw new Error('MIDI 通道必须是 0-15 的整数，实际 ' + channel);
    if (!events || typeof events.length !== 'number' || events.length === 0)
      throw new Error('events 必须是非空数组');
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.note !== Math.floor(e.note) || e.note < 0 || e.note > 127)
        throw new Error('event note 越界：' + e.note);
      if (e.velocity !== Math.floor(e.velocity) || e.velocity < 1 || e.velocity > 127)
        throw new Error('event velocity 越界：' + e.velocity);
      if (!(e.tOn >= 0) || !(e.tOff > e.tOn))
        throw new Error('event 时序不合法 tOn=' + e.tOn + ' tOff=' + e.tOff);
      out.push({ bytes: [0x90 | channel, e.note, e.velocity], tMs: Math.round(e.tOn * 1000) });
      out.push({ bytes: [0x80 | channel, e.note, 0], tMs: Math.round(e.tOff * 1000) });
    }
    return out;
  }

  /* ---- 确定性随机：mulberry32（ES5 手写 imul，不依赖 Math.imul） ----
     为什么不用 Math.random：循环扫弦要求「同一种子第 N 小节永远逐字节相同」
     （测试断言 + 跨引擎复现），Math.random 给不了。
     参考值由 Python 独立实现算出写死在 strum_test ⑪ —— 两个实现互相咬合，
     任何一边写错都炸（防「同一个 bug 复制两份」）。 */
  function imul(a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  }
  function mulberry32(seed) {
    if (seed !== Math.floor(seed) || seed < 1)
      throw new Error('seed 必须是 ≥1 的整数，实际 ' + seed);
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 事件组校验（humanize 与 eventsToMidi 共用的语义：非空 + 每条合法） */
  function checkEvents(events) {
    if (!events || typeof events.length !== 'number' || events.length === 0)
      throw new Error('events 必须是非空数组');
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.note !== Math.floor(e.note) || e.note < 0 || e.note > 127)
        throw new Error('event note 越界：' + e.note);
      if (e.velocity !== Math.floor(e.velocity) || e.velocity < 1 || e.velocity > 127)
        throw new Error('event velocity 越界：' + e.velocity);
      if (!(e.tOn >= 0) || !(e.tOff > e.tOn))
        throw new Error('event 时序不合法 tOn=' + e.tOn + ' tOff=' + e.tOff);
    }
  }

  /* ---- 人性化：对事件组做确定性抖动（新数组，不改输入） ----
     opts.seed     必填 ≥1 整数 —— 同一 (events, opts) 永远逐字段相同
     opts.timingMs 每弦 tOn 偏移幅度（毫秒，≥0，默认 0 = 关）
     opts.velJitter 每弦 velocity 偏移幅度（≥0，默认 0 = 关）
     规则：
       · tOff 与 tOn 同步平移 —— gate 时值不变，闷音/chuck 的语义不被抖动破坏
       · tOn 平移后 < 0 时钳到 0（小节第一根弦不能跑到上一小节去）
       · velocity 合成后钳到 1..127 —— 钳的是我们自己抖出来的量，
         不是掩码用户的显式参数，与 strum() 的「无隐藏钳制」不冲突
       · timingMs/velJitter 为 0 的轴完全不动（连取整都不做）—— 保证
         「关人性化 = 纯 strum 输出」逐字节成立 */
  function humanize(events, opts) {
    checkEvents(events);
    opts = opts || {};
    if (opts.seed == null)
      throw new Error('humanize 缺 seed：确定性随机必须有种子');
    var rng = mulberry32(opts.seed);
    var timingMs = opts.timingMs == null ? 0 : opts.timingMs;
    var velJitter = opts.velJitter == null ? 0 : opts.velJitter;
    if (!(typeof timingMs === 'number') || !isFinite(timingMs) || timingMs < 0)
      throw new Error('timingMs 必须是 ≥0 的有限数，实际 ' + timingMs);
    if (!(typeof velJitter === 'number') || !isFinite(velJitter) || velJitter < 0)
      throw new Error('velJitter 必须是 ≥0 的有限数，实际 ' + velJitter);

    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var o = { note: e.note, velocity: e.velocity, tOn: e.tOn, tOff: e.tOff,
                string: e.string, stroke: e.stroke };
      if (timingMs > 0) {
        var dT = (rng() * 2 - 1) * (timingMs / 1000);
        o.tOn = Math.round((e.tOn + dT) * 1e6) / 1e6;
        if (o.tOn < 0) o.tOn = 0;
        o.tOff = Math.round((o.tOn + (e.tOff - e.tOn)) * 1e6) / 1e6;
      }
      if (velJitter > 0) {
        var dV = Math.round((rng() * 2 - 1) * velJitter);
        o.velocity = Math.min(127, Math.max(1, e.velocity + dV));
      }
      out.push(o);
    }
    return out;
  }

  /* ---- 节奏型表：显式步进数据，不用字符串 DSL ----
     beats = 每小节拍数（四分音符），steps 里 beat 允许小数（反拍）。
     stroke ∈ PATTERNS 键集；palmMute: true 的步把事件级闷音传给 strum()。 */
  var RHYTHMS = {
    folk:   { beats: 4, steps: [
      { beat: 0, stroke: 'down' }, { beat: 1, stroke: 'down' },
      { beat: 2, stroke: 'up' },   { beat: 3, stroke: 'up' }] },
    folkUp: { beats: 4, steps: [
      { beat: 0, stroke: 'down' }, { beat: 1, stroke: 'down' },
      { beat: 2, stroke: 'up' },   { beat: 3, stroke: 'up' },
      { beat: 3.5, stroke: 'up' }] },
    punk:   { beats: 4, steps: (function () {
      var s = [];
      for (var k = 0; k < 8; k++) s.push({ beat: k * 0.5, stroke: 'chuck' });
      return s; })() },
    ballad: { beats: 4, steps: [
      { beat: 0, stroke: 'down' }, { beat: 2, stroke: 'up' },
      { beat: 3, stroke: 'up' }] },
  };

  /* ---- 节奏型 → 一小节内的扫弦时刻表 ----
     rhythm: 'folk' 等名字，或同构 { beats, steps } 对象
     barSec: 一小节的秒数（= beats 拍的总时长）
     返回 [{ stroke, at, palmMute }]，at = 相对小节起点的秒。
     校验全 throw：未知名字、beat 越界、stroke 不在 PATTERNS、空 steps。 */
  function expandRhythm(rhythm, barSec) {
    if (!isPosNum(barSec))
      throw new Error('barSec 必须是正数，实际 ' + barSec);
    var r;
    if (typeof rhythm === 'string') {
      r = RHYTHMS[rhythm];
      if (!r) throw new Error('未知节奏型：' + rhythm +
        '（可用：' + Object.keys(RHYTHMS).join(' / ') + '，或传 {beats, steps} 对象）');
    } else if (rhythm && typeof rhythm === 'object') {
      r = rhythm;
    } else {
      throw new Error('rhythm 必须是节奏型名字或 {beats, steps} 对象');
    }
    if (r.beats !== Math.floor(r.beats) || r.beats < 1)
      throw new Error('rhythm.beats 必须是 ≥1 的整数，实际 ' + r.beats);
    if (!r.steps || typeof r.steps.length !== 'number' || r.steps.length === 0)
      throw new Error('rhythm.steps 必须是非空数组');
    var perBeat = barSec / r.beats;
    var out = [];
    for (var i = 0; i < r.steps.length; i++) {
      var st = r.steps[i];
      if (typeof st.beat !== 'number' || !isFinite(st.beat) ||
          st.beat < 0 || st.beat >= r.beats)
        throw new Error('step.beat 必须在 [0, beats) 内，实际 ' + st.beat +
                        '（beats=' + r.beats + '）');
      if (typeof st.stroke !== 'string' || !PATTERNS[st.stroke])
        throw new Error('step.stroke 必须是 ' +
          Object.keys(PATTERNS).join(' / ') + '，实际 ' + st.stroke);
      out.push({ stroke: st.stroke, at: st.beat * perBeat,
                 palmMute: !!st.palmMute });
    }
    return out;
  }

  /* ---- 循环小节的种子派生：第 i 小节用 base + i*7919 ----
     7919 是第 1000 个质数 —— 偏移量本身没有魔力，魔力在「写死、可测」：
     同一 base 下 bar0 与 bar1 必不同、任意次起停后第 N 小节逐字节相同。 */
  function barSeed(base, i) {
    if (base !== Math.floor(base) || base < 1)
      throw new Error('base 必须是 ≥1 的整数，实际 ' + base);
    if (i !== Math.floor(i) || i < 0)
      throw new Error('barIndex 必须是 ≥0 的整数，实际 ' + i);
    return base + i * 7919;
  }

  return { PATTERNS: PATTERNS, strum: strum, eventsToMidi: eventsToMidi,
           CHUCK_GATE: CHUCK_GATE, MUTE_GATE: MUTE_GATE,
           mulberry32: mulberry32, humanize: humanize,
           RHYTHMS: RHYTHMS, expandRhythm: expandRhythm, barSeed: barSeed };
});
