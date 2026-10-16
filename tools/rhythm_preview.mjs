// rhythm_preview.mjs · 节奏型试听包（一次性工装，也可留作节奏预览器）
//
// 用法：node tools/rhythm_preview.mjs [输出目录]
// 在 Node 里离线渲染「五个新节奏型 + 旧 folk 对照」，逐字节复刻页面本地试听
// 的语义（renderNote normalize:true、gain=vel/127、spreadMs=5、轻扫减弦默认开、
// 人性化 timing 6ms/vel 10、种子 barSeed(seed, barIndex*8+stepIdx)）。
// 输出 WAV 到仓库外目录，不进 git。
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));
const STRUM = require_(path.join(ROOT, 'engine', 'strum.js'));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));

const w = {}; global.window = w;
require_(path.join(ROOT, 'data', 'guitar.js'));
const pack = w.FM1_GUITAR;
function hexToBytes(h) {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}
const voice = DX7.decodeVoice(hexToBytes(
  pack.voices.find(v => v.name === 'AC PLUCK').raw));

/* ---- 候选节奏型（新五个 + 旧 folk 对照）——就是计划里的数据，引擎未改 ---- */
const CANDIDATES = {
  '1-new-folk-万能D-DU-UDU': { beats: 4, steps: [
    { beat: 0, stroke: 'down' }, { beat: 1, stroke: 'down' },
    { beat: 1.5, stroke: 'up' }, { beat: 2.5, stroke: 'up' },
    { beat: 3, stroke: 'down' }, { beat: 3.5, stroke: 'up' }] },
  '2-new-pop-全交替': { beats: 4, steps: (function () {
    const s = [];
    for (let k = 0; k < 8; k++)
      s.push({ beat: k * 0.5, stroke: k % 2 === 0 ? 'down' : 'up' });
    return s; })() },
  '3-new-punk-全下刷': { beats: 4, steps: (function () {
    const s = [];
    for (let k = 0; k < 8; k++) s.push({ beat: k * 0.5, stroke: 'down' });
    return s; })() },
  '4-new-reggae-反拍上刷': { beats: 4, steps: [
    { beat: 0.5, stroke: 'up' }, { beat: 1.5, stroke: 'up' },
    { beat: 2.5, stroke: 'up' }, { beat: 3.5, stroke: 'up' }] },
  '5-new-ballad-慢歌': { beats: 4, steps: [
    { beat: 0, stroke: 'down' }, { beat: 1.5, stroke: 'up' },
    { beat: 2.5, stroke: 'up' }, { beat: 3, stroke: 'down' },
    { beat: 3.5, stroke: 'up' }] },
  '6-old-folk-下下上上-对照': { beats: 4, steps: [
    { beat: 0, stroke: 'down' }, { beat: 1, stroke: 'down' },
    { beat: 2, stroke: 'up' }, { beat: 3, stroke: 'up' }] },
};

/* ---- 页面同款参数 ---- */
const CHORD = [43, 47, 50, 55, 59, 67];        /* G（垫 4） */
const BPM = 100, BARS = 2, SPREAD_MS = 5, SEED = 1;
const HUM = { timingMs: 6, velJitter: 10 };
const SR = 44100;

function renderMix(name, rh) {
  const barSec = rh.beats * 60 / BPM;
  const totalSec = BARS * barSec + 1.2;        /* 尾音余量 */
  const mix = new Float64Array(Math.round(totalSec * SR));
  for (let bar = 0; bar < BARS; bar++) {
    const barStart = bar * barSec;
    const steps = STRUM.expandRhythm(rh, barSec);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      let evs = STRUM.strum(CHORD, {
        pattern: st.stroke, palmMute: st.palmMute,
        spread: SPREAD_MS * (CHORD.length - 1) / 1000,
        stringBudget: true });                 /* 页面默认勾选 */
      evs = STRUM.humanize(evs, { seed: STRUM.barSeed(SEED, bar * 8 + i),
        timingMs: HUM.timingMs, velJitter: HUM.velJitter });
      for (const e of evs) {
        const gate = e.tOff - e.tOn;
        const buf = FM.render(voice, { sampleRate: SR,
          duration: gate + 0.35, gate, note: e.note, normalize: true });
        const g = e.velocity / 127;
        /* 三层时间叠加：小节起点 + 扫步在小节内的位置(st.at) + 扫弦内部错峰(e.tOn) */
        const at = Math.round((barStart + st.at + e.tOn) * SR);
        for (let k = 0; k < buf.length && at + k < mix.length; k++)
          mix[at + k] += buf[k] * g;
      }
    }
  }
  /* 最终峰值归一（纯试听防削波；页面里浏览器自己 clamp） */
  let peak = 0;
  for (let k = 0; k < mix.length; k++) peak = Math.max(peak, Math.abs(mix[k]));
  const g = peak > 0 ? 0.9 / peak : 1;
  const out = new Float32Array(mix.length);
  for (let k = 0; k < mix.length; k++) out[k] = mix[k] * g;
  return out;
}

const outDir = process.argv[2] ||
  path.dirname(ROOT) + '/rhythm-preview';
fs.mkdirSync(outDir, { recursive: true });
for (const [name, rh] of Object.entries(CANDIDATES)) {
  const buf = renderMix(name, rh);
  const wav = FM.encodeWav(buf, SR);
  const f = path.join(outDir, name + '.wav');
  fs.writeFileSync(f, Buffer.from(wav));
  console.log('✓ ' + path.basename(f) + '  ' +
    (buf.length / SR).toFixed(1) + 's  ' + (wav.length / 1024).toFixed(0) + 'KB');
}
console.log('\n全部输出在 ' + outDir);
