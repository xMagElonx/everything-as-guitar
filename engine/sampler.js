/* ============================================================================
   Everything as Guitar · 采样音色引擎
   ----------------------------------------------------------------------------
   把用户上传的 WAV/MP3 变成一把「采样吉他」：一个采样 + 一个根音，
   扫弦事件按音程变调播放（playbackRate = 2^((note-root)/12)）—— 这是
   MPC / Mellotron / 老采样器一脉的经典玩法。移动播放速率会连带改变时长
   （降调变慢、升调变快），恰好近似真实吉他高把位偏亮偏短的手感。

   纯逻辑与持久化封装放这份 UMD（全局 FM1_SAMPLER），浏览器与 Node 共用：
     · rateFor / plan 是纯函数，Node 里直接测；
     · idb 是 IndexedDB 的 ES5 Promise 封装，Node 无 indexedDB 时
       available() 返回 false —— 降级判定本身可测，IDB 本体交给 smoke 桩。

   所有校验抛错不静默（与 strum.js 同纪律）：越界根音、非法事件当场炸。
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FM1_SAMPLER = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---- 校验工具：整数与 MIDI 音域 ---- */
  function midiNote(v, what) {
    if (typeof v !== 'number' || v !== Math.floor(v) ||
        v < 0 || v > 127)
      throw new Error(what + ' 必须是 0–127 的整数，实际 ' + v);
    return v;
  }

  /* ---- 变调比率：每 12 个半音翻一倍频率（十二平均律）----
     note 高于 root → rate > 1（升调，采样变快变短）；
     note 低于 root → rate < 1（降调，采样变慢变长）。 */
  function rateFor(note, root) {
    midiNote(note, 'note');
    midiNote(root, 'root');
    return Math.pow(2, (note - root) / 12);
  }

  /* ---- 释放余量：stop 排在时长之后留 60ms，避免尾音被硬切出咔声 ---- */
  var RELEASE = 0.06;

  /* ---- 事件 → 播放参数。events 来自 strum.js：{note, velocity, tOn, tOff}。
     duration = min(事件时值, 采样时长/速率) + RELEASE：
       · 长采样（超过事件时值）截到事件时值 —— 跟 FM 路径的 gate 语义一致；
       · 短采样被降调拉长后按 采样时长/速率 截 —— 变调不改变「采样总量」。
     返回与 events 等长的数组，顺序一一对应。 */
  function plan(events, root, sampleDur) {
    if (!Array.isArray(events))
      throw new Error('events 必须是数组，实际 ' + typeof events);
    if (typeof sampleDur !== 'number' || !isFinite(sampleDur) || sampleDur <= 0)
      throw new Error('sampleDur 必须是正数（秒），实际 ' + sampleDur);
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || typeof e.note !== 'number' || typeof e.velocity !== 'number' ||
          typeof e.tOn !== 'number' || typeof e.tOff !== 'number')
        throw new Error('events[' + i + '] 缺 note/velocity/tOn/tOff 字段：' +
                        JSON.stringify(e));
      if (e.tOff < e.tOn)
        throw new Error('events[' + i + '].tOff (' + e.tOff +
                        ') 早于 tOn (' + e.tOn + ')');
      var rate = rateFor(e.note, root);
      var gate = e.tOff - e.tOn;
      out.push({
        rate: rate,
        gain: e.velocity / 127,
        duration: Math.min(gate, sampleDur / rate) + RELEASE
      });
    }
    return out;
  }

  /* ---- IndexedDB 封装：库 fm1-guitar-samples / store samples（keyPath name）----
     rec = { name, root, sampleRate, pcm:ArrayBuffer }。
     全部返回原生 Promise；open() 惰性执行一次并缓存。 */
  var DB_NAME = 'fm1-guitar-samples';
  var STORE = 'samples';
  var dbPromise = null;

  function available() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var out = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(out && out.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('IDB 事务中止')); };
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var idb = {
    available: available,

    /* rec 必须四字段齐全；pcm 必须是 ArrayBuffer（调用方负责拷贝，
       不要直接塞 getChannelData 返回的视图 —— 那块内存归 AudioBuffer 管）。 */
    save: function (rec) {
      if (!rec || typeof rec.name !== 'string' || !rec.name)
        throw new Error('save: rec.name 必须是非空字符串');
      if (typeof rec.root !== 'number')
        throw new Error('save: rec.root 必须是数字');
      if (!(rec.pcm instanceof ArrayBuffer))
        throw new Error('save: rec.pcm 必须是 ArrayBuffer');
      return withStore('readwrite', function (s) { s.put(rec); });
    },

    list: function () {
      return open().then(function (db) {
        return reqToPromise(db.transaction(STORE, 'readonly')
                              .objectStore(STORE).getAll());
      });
    },

    remove: function (name) {
      if (typeof name !== 'string' || !name)
        throw new Error('remove: name 必须是非空字符串');
      return withStore('readwrite', function (s) { s['delete'](name); });
    }
  };

  return { rateFor: rateFor, plan: plan, RELEASE: RELEASE, idb: idb };
});
