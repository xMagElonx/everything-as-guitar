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
     velHigh/velLow 是该 pattern 的默认力度端点（上扫整体偏轻）。
     自定义 pattern = 传入同构对象即可，不加新代码分支。 */
  var PATTERNS = {
    down:  { order: 'low-to-high', muted: false, velHigh: 112, velLow: 76 },
    up:    { order: 'high-to-low', muted: false, velHigh: 96,  velLow: 68 },
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
     opts.pattern: 'down' | 'up' | 'chuck' 或自定义 { order, muted, velHigh, velLow }
     opts.spread:  扫弦总时长（秒），默认 0.09
     opts.gate:    每音保持（秒），默认 1.2（chuck/闷音会钳得更短）
     opts.velHigh / opts.velLow: 力度端点（覆盖 pattern 默认）
     opts.palmMute: true → 事件级闷音，每音时值钳到 MUTE_GATE
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
                  velHigh: opts.pattern.velHigh, velLow: opts.pattern.velLow };
    } else {
      throw new Error('缺 pattern：down / up / chuck，或 {order, muted} 对象');
    }

    var spread = opts.spread == null ? 0.09 : opts.spread;
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

    var n = notes.length;
    var step = spread / (n - 1);          // 每弦错峰间隔
    var orderIdx = [];                    // 拨弦次序 → 原始弦位
    for (var k = 0; k < n; k++)
      orderIdx.push(pattern.order === 'low-to-high' ? k : n - 1 - k);

    var out = [];
    for (var s = 0; s < n; s++) {
      var idx = orderIdx[s];
      var tOn = s * step;
      /* 力度沿「拨弦次序」线性递减：先被拨到的弦最响。
         单弦扫弦（n=1）已被 checkNotes 拦下，这里 n ≥ 2 不会除零。 */
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

  return { PATTERNS: PATTERNS, strum: strum, eventsToMidi: eventsToMidi,
           CHUCK_GATE: CHUCK_GATE, MUTE_GATE: MUTE_GATE };
});
