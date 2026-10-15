/* ============================================================================
   FM-1 演奏台 · 循环调度器（SEQ player）
   ----------------------------------------------------------------------------
   把「按住循环扫」变成可调度的引擎：lookahead 模式（Chris Wilson
   "A Tale of Two Clocks" 的标准结构）——一个定时器每半格提前量醒一次，
   把「当前时刻 + 提前量」之前还没排的小节全部排出去。

   职责边界（与 strum.js 的分工同构）：
     · 本文件不碰 AudioContext、不碰 MIDI 端口 —— 它只按时钟调用
       deliver(events, barStartAbs, barIndex)，出口映射（本地试听 /
       MIDI 发送）是页面层的事。
     · 时间源、定时器都由调用方注入（now / timer）—— Node 测试里
       用手动假时钟直接推进，浏览器里用 performance.now() +
       window.setInterval。这也是本文件唯一允许的「副作用边界」。

   确定性约定：buildBar(barIndex) 必须是 barIndex 的纯函数（页面用
   FM1_STRUM.barSeed(base, i) 派生随机种子）—— 于是「同种子同和弦
   同节奏型，任意次起停后的第 N 小节逐字节相同」由组合保证，本文件
   只负责保证 barIndex 从 0 开始递增、不错乱。

   停止语义：stop() 只停排程，已排进未来的事件不撤 —— 事件自带
   Note Off 会自然结束；这里没有需要清理的悬挂状态（与「闷音宏改
   设备端包络」那种状态不同类）。
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FM1_SEQ = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isFn(v) { return typeof v === 'function'; }

  function createPlayer(cfg) {
    cfg = cfg || {};
    if (!isFn(cfg.now)) throw new Error('createPlayer 缺 now：必须注入时间源函数（秒）');
    if (!cfg.timer || !isFn(cfg.timer.set) || !isFn(cfg.timer.clear))
      throw new Error('createPlayer 缺 timer：必须注入 { set(fn,ms)->id, clear(id) }');
    if (!isFn(cfg.deliver)) throw new Error('createPlayer 缺 deliver：小节事件的出口回调');
    if (!isFn(cfg.buildBar)) throw new Error('createPlayer 缺 buildBar：必须能按 barIndex 造出一小节');
    var lookahead = cfg.lookahead == null ? 0.15 : cfg.lookahead;
    if (!(typeof lookahead === 'number') || !isFinite(lookahead) || lookahead <= 0)
      throw new Error('lookahead 必须是正数（秒），实际 ' + lookahead);

    var now = cfg.now, timer = cfg.timer, deliver = cfg.deliver, buildBar = cfg.buildBar;

    var running = false;
    var tickId = null;
    var nextBar = 0;        // 下一小节的编号（start 时归零）
    var nextBarStart = 0;   // 下一小节在 now() 坐标系里的起点（秒）
    var TICK_FLOOR_MS = 20; // 提前量极小时定时器的下限，避免 0ms 疯转

    /* 排出一小节：buildBar → 校验 → 交付 → 前进。
       积压小节（设备休眠/标签页挂起后追不上）直接跳过不交付 ——
       把过去的事件发出去只会糊成一团；跳过后编号照常前进，
       后续小节依然确定性。 */
    function scheduleBar(horizon) {
      var bar = buildBar(nextBar);
      if (!bar || typeof bar.barSec !== 'number' || !isFinite(bar.barSec) || bar.barSec <= 0)
        throw new Error('buildBar(' + nextBar + ') 必须返回 { events, barSec }，' +
                        'barSec 必须是正数，实际 ' + (bar && bar.barSec));
      var events = bar.events || [];
      if (typeof events.length !== 'number')
        throw new Error('buildBar(' + nextBar + ').events 必须是数组');
      var missed = nextBarStart < now() - 0.005;
      if (!missed) deliver(events, nextBarStart, nextBar);
      nextBarStart += bar.barSec;
      nextBar += 1;
      return missed;
    }

    function tick() {
      if (!running) return;
      var horizon = now() + lookahead;
      var guard = 0;
      /* guard 上限：单次 tick 最多排 64 小节。正常永远用不到
         （barSec 通常是零点几秒到几秒），只防 buildBar 返回极小
         barSec 时把定时器线程吃死。 */
      while (running && nextBarStart < horizon && guard < 64) {
        scheduleBar(horizon);
        guard++;
      }
    }

    function start() {
      if (running) return false;   // 重复 start 是 no-op，不是错误
      running = true;
      nextBar = 0;
      nextBarStart = now();
      tick();
      tickId = timer.set(tick, Math.max(TICK_FLOOR_MS, Math.round(lookahead * 500)));
      return true;
    }

    function stop() {
      if (!running) return false;
      running = false;
      if (tickId != null) { timer.clear(tickId); tickId = null; }
      return true;
    }

    return {
      start: start,
      stop: stop,
      isRunning: function () { return running; },
      _tick: tick,   // 手动档 timer 下由测试直接推进
    };
  }

  return { createPlayer: createPlayer };
});
