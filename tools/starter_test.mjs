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

console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
