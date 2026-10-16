/* ============================================================================
   Everything as Guitar · 采样音色引擎
   ----------------------------------------------------------------------------
   把用户上传的 WAV/MP3 变成一把「采样吉他」：一个采样 + 一个根音，
   扫弦事件按音程变调播放 —— MPC / Mellotron / 老采样器一脉的经典玩法。
   移动播放速率会连带改变时长（降调变慢、升调变快），恰好近似真实吉他
   高把位偏亮偏短的手感。

   v0.5 起的完整管线（全部纯函数，Node 可测）：
     analyze   上传体检：峰值 / 静音裁剪点 / 自相关根音 / 稳态循环点
     trim      掐头去尾（按 analyze 给的裁剪点）
     normalize 峰值归一化（安全增益封顶）
     renderNote 离线渲染单个音符：varispeed + sustain loop + 包络烘焙，
               输出与 FM 路径同构（Float32Array，永不硬切）

   纯逻辑与持久化封装放这份 UMD（全局 FM1_SAMPLER），浏览器与 Node 共用；
   idb 是 IndexedDB 的 ES5 Promise 封装，Node 无 indexedDB 时
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

  /* ---- v0.5 常量表（全部集中在此，测试逐个断言）----
     TRIM_DB        静音阈值（dBFS）—— 低于它视为无声，trim 掐头去尾
     ATTACK_SEC     起音淡入（与 FM 路径 normalize 的 3ms 淡入同款）
     RELEASE_SEC    释放淡出（烘焙进渲染 buffer，输出永不硬切）
     NORM_TARGET    上传归一化目标峰值
     NORM_MAX_GAIN  归一化安全增益封顶（防把噪声底抬上天）
     ROOT_MIN/MAX_HZ  根音自相关检测的频率窗（约 B1–D5）
     ROOT_CONF      归一化自相关峰值置信阈值，低于 → 根音检测失败
     ROOT_WIN       根音检测窗口（样本数，自动截到信号长）
     LOOP_MIN_SEC   循环区最短时长
     LOOP_XFADE_SEC 循环 crossfade 时长（回绕接缝无缝化）
     LOOP_STABLE_SEC 稳态判定窗（逐窗 RMS）
     LOOP_STABLE_DB 相邻窗 RMS 变化小于它才视为「平稳」
     RATE_CLAMP_SEMI 变调钳制半音数（超出封顶，不再 4× 变声） */
  var TRIM_DB = -50;
  var TRIM_LIN = Math.pow(10, TRIM_DB / 20);
  var ATTACK_SEC = 0.003;
  var RELEASE_SEC = 0.04;
  var NORM_TARGET = 0.95;
  var NORM_MAX_GAIN = 10;
  var ROOT_MIN_HZ = 60;
  var ROOT_MAX_HZ = 600;
  var ROOT_CONF = 0.5;
  var ROOT_WIN = 4096;
  var LOOP_MIN_SEC = 0.10;
  var LOOP_XFADE_SEC = 0.01;
  var LOOP_STABLE_SEC = 0.05;
  var LOOP_STABLE_DB = 3;
  var RATE_CLAMP_SEMI = 12;

  /* ---- 变调比率：每 12 个半音翻一倍频率（十二平均律）----
     v0.5 起钳制在 ±RATE_CLAMP_SEMI 半音（封顶语义，保序）：
     note 高于 root → rate > 1（升调，采样变快变短）；
     note 低于 root → rate < 1（降调，采样变慢变长）。
     |note-root| ≤ 12 时行为与 v0.4 完全一致。 */
  function rateFor(note, root) {
    midiNote(note, 'note');
    midiNote(root, 'root');
    var semi = note - root;
    if (semi > RATE_CLAMP_SEMI) semi = RATE_CLAMP_SEMI;
    if (semi < -RATE_CLAMP_SEMI) semi = -RATE_CLAMP_SEMI;
    return Math.pow(2, semi / 12);
  }

  /* ---- 释放余量（v0.4 plan() 时代的 stop 调度余量；
     v0.5 播放走 renderNote、包络烘焙，页面不再消费 plan。保留作回归。）---- */
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

  /* ================================================================
     v0.5 DSP 管线：analyze → trim → normalize → renderNote
     全部纯函数：输入不可变、返回新数组、不碰 DOM/AudioContext。
     ================================================================ */

  function pcmOk(pcm, what) {
    if (!(pcm instanceof Float32Array) || pcm.length === 0)
      throw new Error(what + ' 必须是非空 Float32Array');
  }

  function srOk(sampleRate) {
    if (typeof sampleRate !== 'number' || !isFinite(sampleRate) ||
        sampleRate <= 0)
      throw new Error('sampleRate 必须是正数，实际 ' + sampleRate);
  }

  /* ---- analyze：上传体检。返回的索引全部是「原始 pcm 坐标」，
     trim() 负责把它们平移到裁剪后坐标。----
     peak       最大绝对振幅
     trimIn/Out 首个/末个超阈值样本的界外索引（裁 [trimIn, trimOut)）
     rootNote   自相关检测的 MIDI 根音（检测失败 → null，页面回退手选）
     loopStart/End 稳态循环段（零交叉对齐；打击型/太短 → null） */
  function analyze(pcm, sampleRate) {
    pcmOk(pcm, 'pcm');
    srOk(sampleRate);
    var n = pcm.length;
    var peak = 0, i;
    for (i = 0; i < n; i++) {
      var a = Math.abs(pcm[i]);
      if (a > peak) peak = a;
    }

    /* -- 静音裁剪点 -- */
    var trimIn = 0, trimOut = n;
    if (peak > TRIM_LIN) {
      while (trimIn < n && Math.abs(pcm[trimIn]) <= TRIM_LIN) trimIn++;
      trimOut = n;
      while (trimOut > trimIn && Math.abs(pcm[trimOut - 1]) <= TRIM_LIN) trimOut--;
    }

    /* -- 根音：归一化自相关，取裁剪后中段窗口 -- */
    var rootNote = null;
    var trimLen = trimOut - trimIn;
    var w = Math.min(ROOT_WIN, trimLen);
    var minLag = Math.max(2, Math.floor(sampleRate / ROOT_MAX_HZ));
    var maxLag = Math.min(Math.floor(sampleRate / ROOT_MIN_HZ),
                          Math.floor(w / 2) - 1);
    if (peak > TRIM_LIN && maxLag >= minLag + 2) {
      var start = trimIn + Math.floor((trimLen - w) / 2);
      var rs = new Float32Array(maxLag + 2);   /* rs[lag] 保留给抛物线插值 */
      var bestLag = -1, bestR = -1;
      for (var lag = minLag; lag <= maxLag; lag++) {
        var num = 0, e1 = 0, e2 = 0;
        for (i = 0; i + lag < w; i++) {
          num += pcm[start + i] * pcm[start + i + lag];
          e1 += pcm[start + i] * pcm[start + i];
          e2 += pcm[start + i + lag] * pcm[start + i + lag];
        }
        var den = Math.sqrt(e1 * e2);
        rs[lag] = den > 0 ? num / den : 0;
        if (rs[lag] > bestR) { bestR = rs[lag]; bestLag = lag; }
      }
      /* 八度纠偏（经典「第一峰」启发式）：自相关在整数倍周期处相关度
         与真峰一样高（440Hz 在 lag 100/200/400 处都 ≈1），从短 lag 向上
         找第一个 ≥0.85×峰值的局部极大 —— 那才是基波周期。 */
      var pickLag = -1;
      for (var lag2 = minLag + 1; lag2 < maxLag; lag2++) {
        if (rs[lag2] >= bestR * 0.85 &&
            rs[lag2] >= rs[lag2 - 1] && rs[lag2] >= rs[lag2 + 1]) {
          pickLag = lag2; break;
        }
      }
      if (pickLag === -1) pickLag = bestLag;
      bestLag = pickLag;
      if (bestR >= ROOT_CONF && bestLag > minLag && bestLag < maxLag) {
        /* 抛物线插值细化峰位 */
        var r0 = rs[bestLag - 1], r1 = rs[bestLag], r2 = rs[bestLag + 1];
        var d = (r0 - r2) / (2 * (r0 - 2 * r1 + r2) || 1e-12);
        if (!(d > -1 && d < 1)) d = 0;
        var f = sampleRate / (bestLag + d);
        rootNote = Math.round(69 + 12 * Math.log2(f / 440));
        if (rootNote < 24) rootNote = 24;
        if (rootNote > 84) rootNote = 84;
      }
    }

    /* -- 循环点：从尾部向前找稳态带（逐窗 RMS 变化 < LOOP_STABLE_DB）-- */
    var loopStart = null, loopEnd = null;
    if (peak > TRIM_LIN) {
      var winN = Math.max(64, Math.round(LOOP_STABLE_SEC * sampleRate));
      var winRms = [];                       /* {from, to, db} */
      for (var ws = trimIn; ws + winN <= trimOut; ws += winN) {
        var sum = 0;
        for (i = ws; i < ws + winN; i++) sum += pcm[i] * pcm[i];
        var rms = Math.sqrt(sum / winN);
        winRms.push({ from: ws, to: ws + winN,
                      db: 20 * Math.log10(rms + 1e-12),
                      loud: rms > 4 * TRIM_LIN });
      }
      /* 找最长「响且平稳」的连续窗带 */
      var bandA = -1, bandLen = 0, curA = -1, curLen = 0;
      for (i = 0; i < winRms.length; i++) {
        var ok = winRms[i].loud &&
                 (curLen === 0 || Math.abs(winRms[i].db - winRms[i - 1].db) <
                                   LOOP_STABLE_DB);
        if (ok) {
          if (curLen === 0) curA = i;
          curLen++;
          if (curLen > bandLen) { bandLen = curLen; bandA = curA; }
        } else { curA = -1; curLen = 0; }
      }
      if (bandLen >= 2) {
        /* 在带内滑动找「首尾能量落差 < LOOP_STABLE_DB」的 LOOP_MIN_SEC 段：
           只看相邻窗会漏掉缓衰减（τ=0.15s 每窗只掉 2.87dB，但 100ms 累计
           5.8dB——回绕一次就跳一次音量），落差判据才杀得住打击型。 */
        var minLen = Math.ceil(LOOP_MIN_SEC * sampleRate);
        var hN = winN >> 1;                  /* 半窗：把落差量程拉开到
            minLen - hN（≈75ms），否则量到的还是相邻窗落差 */
        var step = Math.max(32, winN >> 1);
        var rmsDb = function (from, len) {
          var s2 = 0;
          for (var k = from; k < from + len; k++) s2 += pcm[k] * pcm[k];
          return 20 * Math.log10(Math.sqrt(s2 / len) + 1e-12);
        };
        for (var s = winRms[bandA].from;
             s + minLen <= trimOut; s += step) {
          var dA = rmsDb(s, hN), dBv = rmsDb(s + minLen - hN, hN);
          if (Math.abs(dA - dBv) < LOOP_STABLE_DB) {
            loopStart = riseZero(pcm, s, trimOut);
            if (loopStart !== null)
              loopEnd = riseZero(pcm, loopStart + minLen, trimOut);
            break;
          }
        }
        if (loopStart !== null && loopEnd === null)
          loopStart = null;                /* 末端对齐失败 = 放弃 */
      }
    }

    return { peak: peak, trimIn: trimIn, trimOut: trimOut,
             rootNote: rootNote, loopStart: loopStart, loopEnd: loopEnd };
  }

  /* 从 from 起找第一个上升零交叉（x≤0 且下一样本>0）；
     找不到返回 null（最多扫 2048 样本，防止大文件上死磕）。 */
  function riseZero(pcm, from, limit) {
    var end = Math.min(limit - 1, from + 2048);
    for (var i = Math.max(0, from - 1); i < end; i++)
      if (pcm[i] <= 0 && pcm[i + 1] > 0) return i + 1;
    return null;
  }

  /* ---- trim：按 analyze 的裁剪点掐头去尾，marks 同步平移 ---- */
  function trim(pcm, marks) {
    pcmOk(pcm, 'pcm');
    if (!marks || typeof marks.trimIn !== 'number' ||
        typeof marks.trimOut !== 'number' ||
        marks.trimIn < 0 || marks.trimOut > pcm.length ||
        marks.trimIn >= marks.trimOut)
      throw new Error('trim: marks.trimIn/trimOut 非法');
    var out = pcm.slice(marks.trimIn, marks.trimOut);
    var shift = marks.trimIn;
    var m = { trimIn: 0, trimOut: out.length,
              peak: marks.peak, rootNote: marks.rootNote || null,
              loopStart: marks.loopStart != null ? marks.loopStart - shift : null,
              loopEnd: marks.loopEnd != null ? marks.loopEnd - shift : null };
    if (m.loopStart != null && (m.loopStart < 0 || m.loopEnd > out.length)) {
      m.loopStart = m.loopEnd = null;        /* 平移后越界 = 放弃循环 */
    }
    return { pcm: out, marks: m };
  }

  /* ---- normalize：峰值归一到 target，安全增益封顶 ----
     全静音（peak ≤ 1e-9）原样返回拷贝 —— 不炸、不放大噪声底。 */
  function normalize(pcm, target) {
    pcmOk(pcm, 'pcm');
    if (target == null) target = NORM_TARGET;
    if (typeof target !== 'number' || !(target > 0) || target > 1)
      throw new Error('normalize: target 必须在 (0,1]，实际 ' + target);
    var peak = 0, i;
    for (i = 0; i < pcm.length; i++) {
      var a = Math.abs(pcm[i]);
      if (a > peak) peak = a;
    }
    if (peak <= 1e-9) return new Float32Array(pcm);
    var gain = target / peak;
    if (gain > NORM_MAX_GAIN) gain = NORM_MAX_GAIN;
    var out = new Float32Array(pcm.length);
    for (i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
    return out;
  }

  /* ---- renderNote：离线渲染单个音符（v0.5 播放主路径）----
     与 FM 路径同构：调用方拿到 Float32Array → copyToChannel → start(when)，
     永不 src.stop()。包络（3ms 淡入 / 40ms 淡出）烘焙进输出。
       rate     = rateFor(note, root)（已钳制）
       outLen   恒 = (gateSec + RELEASE_SEC) * sampleRate —— 时长由事件决定，
                不随 rate 变（与 FM 的 gate 语义一致）
       varispeed 读指针每输出样本前进 rate，线性插值
       loop     非空且指针到达前，进入 loopEnd 前 LOOP_XFADE_SEC 区做
                crossfade 回绕（淡入源 = loopStart 起）；自然播完超出部分补零
     纯函数：不修改输入 pcm。 */
  function renderNote(pcm, sampleRate, note, root, gateSec, loop) {
    pcmOk(pcm, 'pcm');
    srOk(sampleRate);
    midiNote(note, 'note');
    midiNote(root, 'root');
    if (typeof gateSec !== 'number' || !isFinite(gateSec) || gateSec < 0)
      throw new Error('gateSec 必须是非负数，实际 ' + gateSec);
    if (loop != null) {
      if (typeof loop.start !== 'number' || typeof loop.end !== 'number' ||
          loop.start < 0 || loop.end > pcm.length || loop.start >= loop.end)
        throw new Error('renderNote: loop {start,end} 非法');
    }
    var rate = rateFor(note, root);
    var outLen = Math.ceil((gateSec + RELEASE_SEC) * sampleRate);
    var out = new Float32Array(outLen);
    var xfade = 0, start = 0, end = 0;
    if (loop) {
      end = loop.end;
      start = loop.start;
      xfade = Math.min(Math.round(LOOP_XFADE_SEC * sampleRate),
                       Math.floor((end - start) / 2));
    }
    var p = 0, i;
    for (i = 0; i < outLen; i++) {
      if (loop && p >= end) p = start + xfade + (p - end);
      var s;
      if (loop && p >= end - xfade) {
        var wv = (p - (end - xfade)) / xfade;
        s = (1 - wv) * readAt(pcm, p) +
            wv * readAt(pcm, start + (p - (end - xfade)));
      } else {
        s = readAt(pcm, p);
      }
      out[i] = s;
      p += rate;
    }
    /* 包络烘焙：淡长 min(常量, len/4)——超短输入也有淡入淡出 */
    var atk = Math.min(Math.round(ATTACK_SEC * sampleRate),
                       Math.floor(outLen / 4));
    var rel = Math.min(Math.round(RELEASE_SEC * sampleRate),
                       Math.floor(outLen / 4));
    for (i = 0; i < atk; i++) out[i] *= i / atk;
    for (i = 0; i < rel; i++) out[outLen - 1 - i] *= i / rel;
    return out;
  }

  /* 线性插值读：越界（无 loop 自然播完）读 0。 */
  function readAt(pcm, p) {
    var i0 = Math.floor(p);
    if (i0 < 0) return 0;
    if (i0 >= pcm.length - 1) return pcm.length > 0 ? pcm[pcm.length - 1] : 0;
    var fr = p - i0;
    return pcm[i0] * (1 - fr) + pcm[i0 + 1] * fr;
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

  return {
    rateFor: rateFor, plan: plan, RELEASE: RELEASE,
    analyze: analyze, trim: trim, normalize: normalize, renderNote: renderNote,
    idb: idb
  };
});
