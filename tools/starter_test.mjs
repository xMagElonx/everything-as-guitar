// starter 音色可用性回归：打包成功 ≠ 音色可用。载波电平全 0 的音色格式完全合法，
// 但它是哑的 —— 所以要把每个音色真的渲染一遍。精简自 fm1-tone-engine 的 verify_starter.mjs。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));

const SR = 44100;
let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  ← ' + extra : '')); }
  return cond;
}
function section(t) { console.log('\n' + t); }

const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);
const S = sandbox.FM1_STARTER;
const packed = DX7.parseBank(DX7.b64ToBytes(S.banks[0]));
const voices = [];
for (let i = 0; i < 32; i++) voices.push(DX7.decodeVoice(packed.slice(i * 128, i * 128 + 128)));

section('① 许可与元数据');
check(S.licence === 'CC0-1.0' && S.origin === 'original', 'CC0 1.0，本项目原创');
check(S.names.length === 32 && S.design.length === 32, '32 个名字 + 32 条设计说明');

section('② 每个音色至少有一个载波在发声');
const silent = [];
for (let i = 0; i < 32; i++) {
  const info = DX7.describe(voices[i], FM);
  const live = info.carriers.filter(n => voices[i].ops[6 - n].outputLevel > 0);
  if (live.length === 0) silent.push('槽 ' + i + ' ' + voices[i].name);
}
check(silent.length === 0, '无哑音色', silent.join(', '));

section('③ 真的渲染一遍（note C3、2.2s、gate 1.2s）');
let nonfinite = 0;
const quiet = [];
for (let i = 0; i < 32; i++) {
  const buf = FM.render(voices[i], { sampleRate: SR, duration: 2.2, gate: 1.2, note: 48, normalize: false });
  let peak = 0;
  for (let k = 0; k < buf.length; k++) {
    const x = buf[k];
    if (!Number.isFinite(x)) nonfinite++;
    else if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  if (peak < 0.01) quiet.push(i + ':' + voices[i].name + ' peak=' + peak.toExponential(2));
}
check(nonfinite === 0, '全部渲染输出均为有限值');
check(quiet.length === 0, '没有音色渲染成近乎静音（阈值 0.01）', quiet.join(', '));

section('④ 参数区间（越界 = 打包时发生了位溢出）');
let totalBad = 0;
const bump = (k, val, max) => { if (val > max) totalBad++; };
for (const d of voices) {
  bump('算法', d.algorithm, 31); bump('反馈', d.feedback, 7);
  bump('同步', d.oscKeySync, 1); bump('移调', d.transpose, 127);
  bump('LFO 波形', d.lfoWave, 7);
  d.ops.forEach(o => {
    o.egR.concat(o.egL).forEach(x => bump('EG', x, 127));
    bump('电平', o.outputLevel, 127);
    bump('粗调', o.freqCoarse, 31); bump('曲线', o.leftCurve, 3); bump('曲线', o.rightCurve, 3);
    bump('速率缩放', o.rateScale, 7); bump('力度灵敏度', o.keyVelSens, 7);
    bump('振幅调制', o.ampModSens, 3);
  });
}
check(totalBad === 0, '超出字节容量的取值：' + totalBad + ' 个');

/* WAV 编码器顺带回归（页面下载/预览要用它） */
section('⑤ encodeWav');
const buf = FM.render(voices[0], { sampleRate: SR, duration: 0.5, gate: 0.3, note: 48 });
const wav = FM.encodeWav(buf, SR);
check(wav.length === 44 + buf.length * 2, 'WAV = 44 字节头 + 16bit 单声道数据', String(wav.length));
check(wav[0] === 0x52 && wav[1] === 0x49 && wav[2] === 0x46 && wav[3] === 0x46, 'RIFF 头');
check(wav[8] === 0x57 && wav[9] === 0x41 && wav[10] === 0x56 && wav[11] === 0x45, 'WAVE 标记');

/* ------------------------------------------------------------- ⑥ 吉他音色包 */
section('⑥ data/guitar.js：原创吉他音色（解码 + 渲染 + design 完整）');
{
  const box = {};
  new Function('window', readFileSync(path.join(ROOT, 'data', 'guitar.js'), 'utf8'))(box);
  const G = box.FM1_GUITAR;
  check(!!G, 'FM1_GUITAR 存在');
  check(G.schema === 1 && G.licence === 'CC0-1.0' && G.origin === 'original',
    'schema 1 + CC0 1.0 + 原创');
  check(G.voices.length === 2, '2 个吉他音色');
  const h2b = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  let gBad = 0, gWho = '';
  for (const v of G.voices) {
    if (typeof v.raw !== 'string' || v.raw.length !== 256) { gBad++; gWho = v.name + ' raw'; continue; }
    const d = DX7.decodeVoice(h2b(v.raw));
    const re = DX7.encodeVoice(d);
    if (DX7.hex(re) !== DX7.hex(h2b(v.raw))) { gBad++; gWho = v.name + ' 往返'; }
    if (d.algorithm < 0 || d.algorithm > 31) { gBad++; gWho = v.name + ' 算法'; }
    if (!v.design || !v.design.measured || !v.design.measured.note48) { gBad++; gWho = v.name + ' design'; continue; }
    /* 渲染两把尺：C3 + C5 都要出声且有限 */
    for (const note of [48, 72]) {
      const b = FM.render(d, { sampleRate: SR, duration: 2.2, gate: 1.2, note, normalize: false });
      let peak = 0;
      for (let k = 0; k < b.length; k++) {
        if (!Number.isFinite(b[k])) { gBad++; gWho = v.name + ' 非有限值'; break; }
        if (Math.abs(b[k]) > peak) peak = Math.abs(b[k]);
      }
      if (peak < 0.005) { gBad++; gWho = v.name + ' note' + note + ' peak=' + peak.toExponential(2); }
    }
  }
  check(gBad === 0, '2 音色：raw 256 hex、往返无损、算法合法、design.measured 在、C3/C5 出声', gWho);
  /* 目标断言：make_guitar 的量化目标（数据说话，不是"大概听感"） */
  const pluck = G.voices.find(v => v.name === 'AC PLUCK');
  const sust = G.voices.find(v => v.name === 'EL GTR SUS');
  check(pluck && pluck.design.measured.note48.attackMs < 12 &&
        pluck.design.measured.note48.centroidRatio >= 2 &&
        parseFloat(pluck.design.measured.note48.decay30s) >= 0.8 &&
        parseFloat(pluck.design.measured.note48.decay30s) <= 1.5,
    'AC PLUCK 达标：起音<12ms、质心比≥2、-30dB 0.8–1.5s（C3，实测数据）',
    JSON.stringify(pluck && pluck.design.measured.note48));
  check(sust && sust.design.measured.note48.attackMs < 10 &&
        sust.design.measured.note48.centroidRatio < 1.5 &&
        sust.design.measured.note48.sustainDropDb > -3,
    'EL GTR SUS 达标：起音<10ms、质心比<1.5、平台跌落<3dB（实测数据）',
    JSON.stringify(sust && sust.design.measured.note48));
}

/* ------------------------------------------------------------- ⑦ 外部音色包（无包则大声 SKIP） */
section('⑦ FM1_EXT_* 外部音色包（有则同检；无包是正常状态，SKIP 不计失败）');
{
  const extKeys = Object.keys(sandboxAfterExt()).filter(k => k.indexOf('FM1_EXT_') === 0);
  if (extKeys.length === 0) {
    console.log('  SKIP  没有外部音色包（docs/voice-sources.md 有收录标准；无字节是权利链常态）');
  } else {
    let extBad = 0, extWho = '';
    for (const k of extKeys) {
      const pack = sandboxAfterExt()[k];
      if (!pack.licence || !pack.licenceText) { extBad++; extWho = k + ' 缺 licence'; continue; }
      for (const v of pack.voices || []) {
        const d = DX7.decodeVoice(h2b_(v.raw));
        const b = FM.render(d, { sampleRate: SR, duration: 1.5, gate: 0.9, note: 48, normalize: false });
        let peak = 0;
        for (let i = 0; i < b.length; i++) if (Math.abs(b[i]) > peak) peak = Math.abs(b[i]);
        if (peak < 0.005) { extBad++; extWho = k + '/' + v.name + ' 哑音色'; }
      }
    }
    check(extBad === 0, extKeys.length + ' 个外部包全部有声且 licence 完整', extWho);
  }
  function sandboxAfterExt() {
    const box = {};
    try {
      const fsdir = path.join(ROOT, 'data', 'external');
      const fsmod = require_('node:fs');
      for (const f of fsmod.readdirSync(fsdir))
        if (f.endsWith('.js'))
          new Function('window', fsmod.readFileSync(path.join(fsdir, f), 'utf8'))(box);
    } catch (e) { /* 目录不存在 = 无包 */ }
    return box;
  }
  function h2b_(h) { return new Uint8Array(h.match(/../g).map(x => parseInt(x, 16))); }
}

console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
