// A/B 试听渲染：v0.4 语义 vs v0.5.1 语义，同一「复杂录音」素材扫同一和弦。
// 用法：node ../fm1-guitar/tools/ab_render.mjs  （在 fm1-guitar 仓库内运行）
// 产物：../rhythm-preview/AB_v0.4.wav / AB_v0.5.1.wav / AB_v0.5旧bug.wav
// 纯诊断脚本，不进回归；采样是合成的「歌曲片段」（和弦垫+旋律+鼓点噪声），
// 用来复现用户报告的 glitch 与验证修复。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// v0.4 旧引擎直接从 git 历史取（不靠记忆复刻）
const v04Path = '/tmp/sampler_v04.js';
if (!fs.existsSync(v04Path))
  execSync(`git show 749b03a:engine/sampler.js > "${v04Path}"`, { cwd: ROOT });
const S04 = require_(v04Path);
const S = require_(path.join(ROOT, 'engine', 'sampler.js'));
const STRUM = require_(path.join(ROOT, 'engine', 'strum.js'));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));

const SR = 44100;

/* ---- 合成「复杂录音」：C 大调和弦垫 + 旋律 + 类鼓噪声，3 秒 ---- */
function songSnippet() {
  const n = SR * 3, p = new Float32Array(n);
  const chord = [130.81, 164.81, 196.0, 261.63];       // C3 E3 G3 C4 和弦垫
  const melody = [[261.63, 0.0, 0.4], [293.66, 0.5, 0.4], [329.63, 1.0, 0.4],
                  [293.66, 1.5, 0.4], [261.63, 2.0, 0.9]]; // C4 D4 E4…
  let seed = 7;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                        return seed / 2147483648 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const f of chord) v += 0.12 * Math.sin(2 * Math.PI * f * t);
    for (const [f, t0, dur] of melody)
      if (t >= t0 && t < t0 + dur)
        v += 0.25 * Math.exp(-(t - t0) / 0.25) * Math.sin(2 * Math.PI * f * (t - t0));
    if (t % 0.5 < 0.004) v += noise();                  // 每 0.5s 一声「鼓」
    p[i] = v;
  }
  let pk = 0; for (const x of p) pk = Math.max(pk, Math.abs(x));
  for (let i = 0; i < n; i++) p[i] *= 0.7 / pk;
  return p;
}

/* ---- 混音工具：把 Float32Array 片段加进总线 ---- */
function mix(bus, frag, at) {
  const i0 = Math.round(at * SR);
  for (let i = 0; i < frag.length && i0 + i < bus.length; i++)
    bus[i0 + i] += frag[i];
}
function readVarispeed(pcm, rate, lenSec) {   // 线性插值变速读取
  const out = new Float32Array(Math.round(lenSec * SR));
  let p = 0;
  for (let i = 0; i < out.length; i++, p += rate) {
    const i0 = Math.floor(p);
    if (i0 >= pcm.length - 1) { out[i] = 0; continue; }
    const fr = p - i0;
    out[i] = pcm[i0] * (1 - fr) + pcm[i0 + 1] * fr;
  }
  return out;
}

const pcm = songSnippet();
const events = STRUM.strum([45, 52, 57, 61, 64], { pattern: 'down', spread: 0.02 });
const TOTAL = 3.5;

function renderV04() {
  const bus = new Float32Array(TOTAL * SR);
  for (const e of events) {
    const rate = S04.rateFor(e.note, 40);            // v0.4：无自动根音，手选 E2
    const dur = Math.min(e.tOff - e.tOn, pcm.length / SR / rate) + S04.RELEASE;
    const frag = readVarispeed(pcm, rate, dur);      // 裸 PCM，硬结束（v0.4 忠实语义）
    mix(bus, frag, e.tOn);
    for (let i = 0; i < frag.length; i++) bus[Math.round(e.tOn * SR) + i] += frag[i] * 0; // noop
  }
  return bus;
}
function renderV051() {
  const bus = new Float32Array(TOTAL * SR);
  const marks = S.analyze(pcm, SR);
  const cut = S.trim(pcm, marks);
  const norm = S.normalize(cut.pcm);
  const m = cut.marks;
  const loop = m.loopStart != null ? { start: m.loopStart, end: m.loopEnd } : null;
  console.log('v0.5.1 体检: root=' + m.rootNote + ' conf=' + m.rootConf.toFixed(2) +
    ' reliable=' + m.rootReliable + ' loop=' + m.loopStart + ' 裁剪=' +
    (pcm.length - norm.length) + ' 样本');
  // 复杂录音：根音不可靠 → 用户手选根音。手选 E2（40）与 v0.4 同基准
  for (const e of events) {
    const frag = S.renderNote(norm, SR, e.note, 40, e.tOff - e.tOn, loop);
    mix(bus, frag, e.tOn);
  }
  return bus;
}
function renderV05bug() {  // v0.5 旧 bug 忠实复现：钳制 ±12 + 无循环门控
  const src = fs.readFileSync(path.join(ROOT, 'engine', 'sampler.js'), 'utf8');
  const patched = src.replace('var RATE_CLAMP_SEMI = 24', 'var RATE_CLAMP_SEMI = 12')
                     .replace('rootConf >= ROOT_CONF_LOOP) {', 'true) {');
  fs.writeFileSync('/tmp/sampler_v05bug.js', patched);
  // 清 require 缓存重载
  delete require_.cache[require_.resolve('/tmp/sampler_v05bug.js')];
  const S05 = require_('/tmp/sampler_v05bug.js');
  const bus = new Float32Array(TOTAL * SR);
  const marks = S05.analyze(pcm, SR);
  const cut = S05.trim(pcm, marks);
  const norm = S05.normalize(cut.pcm);
  const m = cut.marks;
  console.log('v0.5 旧bug 体检: root=' + m.rootNote + ' reliable=' + m.rootReliable +
    ' loop=' + m.loopStart + '-' + m.loopEnd);
  const loop = m.loopStart != null ? { start: m.loopStart, end: m.loopEnd } : null;
  for (const e of events) {
    const frag = S05.renderNote(norm, SR, e.note, m.rootNote ?? 40, e.tOff - e.tOn, loop);
    mix(bus, frag, e.tOn);
  }
  return bus;
}

function writeWav(bus, file) {
  const out = path.join(ROOT, '..', 'rhythm-preview', file);
  const n = bus.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, bus[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(out, buf);
  console.log('written', out);
}

writeWav(renderV04(), 'AB_v0.4.wav');
writeWav(renderV051(), 'AB_v0.5.1已修.wav');
writeWav(renderV05bug(), 'AB_v0.5旧bug.wav');
