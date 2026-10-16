// make_guitar.mjs · 生成 data/guitar.js（本项目原创吉他音色包）
//
// 用法：node tools/make_guitar.mjs [--check]
//   默认：构建音色 → 实测（voice_lab）→ 把测量数据写进 design → 落盘
//   --check：只实测并与 data/guitar.js 里已存的测量值比对（CI 式复查）
//
// 设计不是凭耳朵：每个音色都有明确的量化目标（见 VOICES 注释），
// 迭代回路 = 改参数 → node tools/make_guitar.mjs → 看 voice_lab 读数 → 再改。
// 渲染引擎是我们的近似引擎（fm.js），所以这些数字刻画的是「本引擎里的
// 形状」；真机上的包络/频谱会有出入 —— 真机实测是另一把尺，将来做。
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const lab = await import(pathToFileURL(path.join(ROOT, 'tools', 'voice_lab.mjs')).href);

/* ---- 解码对象构建器：只填关心的字段，其余给安全默认值 ---- */
function op(s) {
  s = s || {};
  return {
    num: 0,
    egR: s.egR || [60, 50, 40, 60],
    egL: s.egL || [0, 0, 0, 0],
    breakPoint: s.breakPoint == null ? 50 : s.breakPoint,
    leftDepth: 0,
    rightDepth: s.rightDepth || 0,     /* 键位缩放（截高音亮度）——引擎不实现，
                                          但真机按 DX7 规格原生支持，写进字节就有用 */
    leftCurve: 0, rightCurve: 0,
    detune: 7, rateScale: s.rateScale || 0,
    keyVelSens: s.keyVelSens == null ? 0 : s.keyVelSens,
    ampModSens: 0,
    outputLevel: s.level || 0,
    oscMode: 0,
    freqCoarse: s.coarse == null ? 1 : s.coarse,
    freqFine: s.fine || 0,
  };
}
function mkVoice(name, algo, feedback, ops /* {1..6} */, oscKeySync, pitchEg) {
  const d = {
    ops: [], pitchEgR: [99, 99, 99, 99], pitchEgL: [50, 50, 50, 50],
    algorithm: algo - 1, oscKeySync: oscKeySync == null ? 1 : oscKeySync,
    feedback: feedback,
    lfoSpeed: 0, lfoDelay: 0, lfoPitchModDepth: 0, lfoAmpModDepth: 0,
    lfoPitchModSens: 0, lfoWave: 0, lfoSync: 0, transpose: 24,
    name: name, raw: null,
  };
  if (pitchEg) { d.pitchEgR = pitchEg.egR; d.pitchEgL = pitchEg.egL; }
  for (let n = 1; n <= 6; n++) { const o = op(ops[n]); o.num = n; d.ops.push(o); }
  /* ops 数组顺序 = packed 顺序：OP6 在前（decodeVoice 的 b=0 → num 6） */
  d.ops.sort((a, b) => b.num - a.num);
  return d;
}

/* ==========================================================================
   v2 配方 · 结构依据：雅马哈原厂 GUITAR 1（ROM1A #12，dx7dump 公开的参数
   分析），mu:zines「Understanding the DX7 / Patchwork」独立印证。共同骨架：
     · 算法 8：OP1←OP2 载波对 + OP3←{OP5←OP6, OP4(反馈)}
     · 反馈 7 拉满（在 OP4 上，电平稍收防啸叫）
     · 比率堆栈 12:3:1（OP6=12 高次泛音、OP5/OP4=3、OP3=1 载波）+ OP2=3 调 OP1=1
     · 力度灵敏度布在载波+调制器上（轻扫暗、重扫亮 —— 真机原生支持）
     · 键位缩放截高音亮度（同上，真机侧）
     · 音高包络做拨弦瞬态（音头先偏高、快速回落）
   ========================================================================== */

/* 音色一：AC PLUCK —— 原声拨弦（扫弦主力）
   目标（C3）：起音 <12ms；亮→暗比 ≥2（前 50ms 质心 ≥ 200-400ms ×2）；
   -30dB 衰减 0.8–1.5s；轻扫(vel 40)质心比重奏暗 >1.1×。
   全算子无延音（L2=L3=0，拨弦只有衰减）；OP2 慢衰减给余亮。 */
const AC_PLUCK = mkVoice('AC PLUCK', 8, 7, {
  1: { level: 78, coarse: 1, egR: [85, 24, 50, 70], egL: [85, 0, 0, 0], keyVelSens: 2 },
  2: { level: 92, coarse: 3, egR: [85, 55, 50, 70], egL: [92, 0, 0, 0], keyVelSens: 3 },
  3: { level: 72, coarse: 1, egR: [85, 28, 50, 70], egL: [80, 0, 0, 0], keyVelSens: 2 },
  4: { level: 85, coarse: 3, egR: [85, 56, 50, 70], egL: [82, 0, 0, 0], keyVelSens: 4, rateScale: 2 },
  5: { level: 75, coarse: 3, egR: [85, 58, 50, 70], egL: [75, 0, 0, 0], keyVelSens: 3, rateScale: 2 },
  6: { level: 70, coarse: 12, egR: [85, 60, 50, 70], egL: [72, 0, 0, 0], keyVelSens: 4,
       rateScale: 3, rightDepth: 20, breakPoint: 60 },
}, 1, { egR: [35, 60, 60, 60], egL: [64, 50, 50, 50] });   /* 拨弦瞬态：+84 音分快速回落 */

/* 音色二：EL GTR SUS —— 清音电吉他（有延音）
   目标（C3）：起音 <10ms；亮→暗比 <1.5（延音亮度稳定）；平台跌落 <3dB；
   轻扫更暗 >1.1×。载波 L3>0 给平台；OP2 慢衰减延亮度（R2:22/L2:62 式）。 */
const EL_GTR_SUST = mkVoice('EL GTR SUS', 8, 7, {
  1: { level: 78, coarse: 1, egR: [88, 28, 24, 65], egL: [82, 73, 71, 0], keyVelSens: 2 },
  2: { level: 86, coarse: 3, egR: [88, 22, 24, 65], egL: [80, 66, 62, 0], keyVelSens: 3 },
  3: { level: 72, coarse: 1, egR: [88, 30, 24, 65], egL: [78, 67, 65, 0], keyVelSens: 2 },
  4: { level: 80, coarse: 3, egR: [88, 38, 30, 65], egL: [74, 46, 36, 0], keyVelSens: 4, rateScale: 2 },
  5: { level: 70, coarse: 3, egR: [88, 42, 34, 65], egL: [64, 40, 30, 0], keyVelSens: 3, rateScale: 2 },
  6: { level: 66, coarse: 12, egR: [88, 46, 38, 65], egL: [58, 30, 20, 0], keyVelSens: 4,
       rateScale: 3, rightDepth: 20, breakPoint: 60 },
}, 1, { egR: [40, 60, 60, 60], egL: [58, 50, 50, 50] });   /* 轻微瞬态：+48 音分 */

/* ---- 实测并收集 design 数据 ---- */
function measured(d) {
  const at = (note) => lab.measure(d, { note, gate: 1.2 });
  const atVel = (note, velocity) => lab.measure(d, { note, gate: 1.2, velocity });
  const m48 = at(48), m60 = at(60), m72 = at(72);
  const soft = atVel(48, 40);
  return {
    note48: { attackMs: m48.attackMs, brightDrop: m48.brightDrop,
              brightCurve: m48.brightCurve,
              decay30s: m48.decay30, sustainDropDb: m48.sustainDropDb,
              brightVelRatio: soft.centroidAttack > 0
                ? +(m48.centroidAttack / soft.centroidAttack).toFixed(2) : null },
    note60: { attackMs: m60.attackMs, brightDrop: m60.brightDrop },
    note72: { attackMs: m72.attackMs, brightDrop: m72.brightDrop },
  };
}

const VOICES = [
  { name: 'AC PLUCK', d: AC_PLUCK, design: { algo: 8, feedback: 7,
    idea: '原声拨弦 v2：按原厂 GUITAR 1（ROM1A #12）骨架重做 —— 算法 8、反馈 7 拉满（OP4）、' +
          '比率堆栈 12:3:1（OP6 高次泛音给琴体、OP5/4=3、OP3/1=1 载波对）、全算子无延音（L2=L3=0）、' +
          'OP2 慢衰减给余亮、力度灵敏度布在全部算子（轻扫暗重扫亮）、键位缩放截高音亮度、' +
          '音高包络 +84 音分快速回落做拨弦瞬态。' } },
  { name: 'EL GTR SUS', d: EL_GTR_SUST, design: { algo: 8, feedback: 7,
    idea: '清音电吉他 v2：同 GUITAR 1 骨架，载波 L3>0 给 sustain 平台（跌落<3dB）、' +
          'OP2 慢衰减延亮度（R2=22/L2=62），调制链衰到低值 sustain 留持续咬合；' +
          '音高包络 +48 音分轻微瞬态。' } },
];

/* ---- 主流程：实测 →（可选比对）→ 落盘 ---- */
const out = {
  schema: 1,
  label: 'FM 吉他（本项目原创）',
  origin: 'original',
  licence: 'CC0-1.0',
  note: '两个原创吉他类音色，由 tools/make_guitar.mjs 按实测数据生成（v2：原厂 GUITAR 1 骨架）；测量值刻画的是本仓库近似引擎（fm.js）里的形状，真机另有出入。',
  voices: [],
};

for (const v of VOICES) {
  const raw = DX7.encodeVoice(v.d);
  const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
  const m = measured(v.d);
  out.voices.push({ name: v.name, raw: hex, design: Object.assign({}, v.design, { measured: m }) });
  console.log('\n■ ' + v.name);
  lab.report(v.d, { note: 48 });
  lab.report(v.d, { note: 60 });
  lab.report(v.d, { note: 72, tag: '高把位' });
}

if (process.argv.includes('--check')) {
  console.log('\n（--check 模式：只报告，不落盘）');
} else {
  const target = path.join(ROOT, 'data', 'guitar.js');
  const content = '/* 由 tools/make_guitar.mjs 生成 —— 不要手改，改生成器再生成。 */\n' +
    'window.FM1_GUITAR = ' + JSON.stringify(out, null, 2) + ';\n';
  fs.writeFileSync(target, content);   // node 写 \n 就是 \n，没有 Windows 换行翻译
  console.log('\n✓ 已写入 ' + path.relative(ROOT, target) +
              '（' + out.voices.length + ' 音色，测量数据已嵌进 design.measured）');
}
