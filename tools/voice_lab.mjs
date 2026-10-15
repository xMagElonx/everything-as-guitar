// voice_lab.mjs · 音色度量工具（不是测试命令，是调音色的尺子）
//
// 用法：node tools/voice_lab.mjs <data 文件.js>（如 data/guitar.js）
// 对文件里每个音色渲染并输出：
//   · 包络：起音时长（10%→90% 峰值）、峰值时刻、跌到 -20/-30dB 的时刻
//   · 延音平台：早窗/晚窗 RMS 比（dB）—— 有没有 sustain 平台一目了然
//   · 频谱：起音窗(0-50ms) 与延音窗(200-400ms) 的频谱质心 及 衰减比
//   · muteMods 视角：把调制器全部静音后再量一遍 —— 「量包络归包络」：
//     载波纯包络的形状不该让调制指数的变化背锅
//
// 方法论（fm1-tone-engine 三次翻车换来的）：
//   · 渲染关掉峰值归一化 —— 它会把"改慢起音导致整体变安静"抬回来
//   · 包络度量按整段能量，不取任何固定时刻的瞬时值
//   · 频谱归频谱、包络归包络，两把尺分开读数
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));

const TAU = Math.PI * 2;

function hexToBytes(h) {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}

/* 调制器静音：把该算法里所有非载波算子的输出电平置 0（深拷贝，不改输入） */
export function muteModulators(d) {
  const plan = FM.compiled(d.algorithm & 31);
  const carriers = new Set(plan.carriers.map(i => plan.nodes[i].op));
  const copy = JSON.parse(JSON.stringify(d));
  for (const op of copy.ops)
    if (!carriers.has(op.num)) op.outputLevel = 0;
  return copy;
}

/* 幅度包络：滑动窗口（约 1ms）内的最大绝对值 */
function envelope(buf, sr) {
  const w = Math.max(1, Math.round(sr * 0.001));
  const env = new Float64Array(Math.ceil(buf.length / w));
  for (let e = 0; e < env.length; e++) {
    let m = 0;
    for (let k = e * w; k < Math.min(buf.length, (e + 1) * w); k++) {
      const a = Math.abs(buf[k]);
      if (a > m) m = a;
    }
    env[e] = m;
  }
  return { env, w };
}

/* 频谱质心：Hann 窗 + 直接 DFT，0-8kHz 分 200 根谱线 */
export function centroid(buf, sr, t0, t1) {
  const i0 = Math.round(t0 * sr);
  const i1 = Math.min(buf.length, Math.round(t1 * sr));
  const N = i1 - i0;
  if (N < 32) return 0;
  const bins = 200, fmax = 8000;
  let num = 0, den = 0;
  for (let b = 1; b <= bins; b++) {
    const f = b * fmax / bins;
    const w = TAU * f / sr;
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const hann = 0.5 - 0.5 * Math.cos(TAU * i / (N - 1));
      const s = buf[i0 + i] * hann;
      re += s * Math.cos(w * i);
      im -= s * Math.sin(w * i);
    }
    const mag = Math.sqrt(re * re + im * im);
    num += f * mag;
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

function rms(buf, sr, t0, t1) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const i1 = Math.min(buf.length, Math.round(t1 * sr));
  if (i1 <= i0) return 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (i1 - i0));
}

/* 主度量：voice = 解码后的音色对象 */
export function measure(voice, opts) {
  opts = opts || {};
  const sr = 44100, note = opts.note == null ? 48 : opts.note;
  const gate = opts.gate == null ? 1.2 : opts.gate;
  const dur = opts.duration == null ? gate + 0.6 : opts.duration;
  const buf = FM.render(voice, { sampleRate: sr, duration: dur, gate, note, normalize: false });

  const { env, w } = envelope(buf, sr);
  let peak = 0, peakE = 0;
  for (let e = 0; e < env.length; e++) if (env[e] > peak) { peak = env[e]; peakE = e; }
  const peakT = peakE * w / sr;

  let a10 = -1, a90 = -1;
  for (let e = 0; e < env.length; e++) {
    if (a10 < 0 && env[e] >= peak * 0.1) a10 = e;
    if (a10 >= 0 && env[e] >= peak * 0.9) { a90 = e; break; }
  }
  const attackMs = (a10 < 0 || a90 < 0) ? NaN : (a90 - a10) * w / sr * 1000;

  function lastAbove(thr) {
    for (let e = env.length - 1; e >= 0; e--) if (env[e] >= thr) return e * w / sr;
    return 0;
  }
  const decay20 = lastAbove(peak * Math.pow(10, -20 / 20)) - peakT;
  const decay30 = lastAbove(peak * Math.pow(10, -30 / 20)) - peakT;

  const cA = centroid(buf, sr, 0.002, 0.05);      // 起音窗
  const cS = centroid(buf, sr, 0.2, 0.4);         // 延音窗
  const rA = rms(buf, sr, 0.15, 0.3);             // 平台早窗
  const rB = rms(buf, sr, gate * 0.9, gate * 0.98); // 平台晚窗
  const dropDb = (rA > 0 && rB > 0) ? 20 * Math.log10(rB / rA) : -Infinity;

  return {
    note, peak: +peak.toFixed(4), attackMs: +attackMs.toFixed(2),
    peakT: +peakT.toFixed(3),
    decay20: decay20 < dur - peakT ? +decay20.toFixed(3) : '>' + (dur - peakT).toFixed(1),
    decay30: decay30 < dur - peakT ? +decay30.toFixed(3) : '>' + (dur - peakT).toFixed(1),
    centroidAttack: +cA.toFixed(0), centroidSustain: +cS.toFixed(0),
    centroidRatio: cS > 0 ? +(cA / cS).toFixed(2) : Infinity,
    sustainDropDb: +dropDb.toFixed(2),
    buf,
  };
}

export function report(voice, opts) {
  const tag = opts && opts.tag ? '[' + opts.tag + '] ' : '';
  const m = measure(voice, opts);
  console.log(
    tag + 'note ' + m.note +
    '  起音 ' + m.attackMs + 'ms' +
    '  峰 ' + m.peak + '@' + m.peakT + 's' +
    '  -20dB ' + m.decay20 + 's  -30dB ' + m.decay30 + 's' +
    '  质心 ' + m.centroidAttack + '→' + m.centroidSustain + 'Hz (×' + m.centroidRatio + ')' +
    '  平台跌落 ' + m.sustainDropDb + 'dB');
  const mm = measure(muteModulators(voice), opts);
  console.log(
    tag + '  └ 调制器静音后：起音 ' + mm.attackMs + 'ms' +
    '  -20dB ' + mm.decay20 + 's  -30dB ' + mm.decay30 + 's  （载波纯包络）');
  return m;
}

/* 直接运行：node tools/voice_lab.mjs <data.js> —— 量文件里全部音色 */
if (import.meta.url === 'file://' + process.argv[1].replace(/\\/g, '/') ||
    process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const file = process.argv[2];
  if (!file) { console.log('用法：node tools/voice_lab.mjs <data/guitar.js 等数据文件>'); process.exit(2); }
  const w = {}; global.window = w;
  require_(path.join(ROOT, file));
  const packName = Object.keys(w).find(k => k.indexOf('FM1_') === 0);
  const pack = w[packName];
  if (!pack || !pack.voices) { console.log('文件里没有 FM1_* 音色包'); process.exit(2); }
  console.log('包：' + packName + '（' + pack.voices.length + ' 音色，licence ' + pack.licence + '）');
  for (const v of pack.voices) {
    const d = DX7.decodeVoice(hexToBytes(v.raw));
    console.log('\n■ ' + v.name + '  算法 ' + (d.algorithm + 1) + '  反馈 ' + d.feedback);
    report(d, { note: 48 });
    report(d, { note: 60 });
  }
}
