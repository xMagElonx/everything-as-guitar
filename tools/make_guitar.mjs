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
    breakPoint: 50, leftDepth: 0, rightDepth: 0,
    leftCurve: 0, rightCurve: 0,
    detune: 7, rateScale: s.rateScale || 0,
    keyVelSens: s.keyVelSens == null ? 3 : s.keyVelSens,   // 真机上让 MIDI 力度有话说
    ampModSens: 0,
    outputLevel: s.level || 0,
    oscMode: 0,
    freqCoarse: s.coarse == null ? 1 : s.coarse,
    freqFine: s.fine || 0,
  };
}
function mkVoice(name, algo, feedback, ops /* {1..6} */, oscKeySync) {
  const d = {
    ops: [], pitchEgR: [99, 99, 99, 99], pitchEgL: [50, 50, 50, 50],
    algorithm: algo - 1, oscKeySync: oscKeySync == null ? 1 : oscKeySync,
    feedback: feedback,
    lfoSpeed: 0, lfoDelay: 0, lfoPitchModDepth: 0, lfoAmpModDepth: 0,
    lfoPitchModSens: 0, lfoWave: 0, lfoSync: 0, transpose: 24,
    name: name, raw: null,
  };
  for (let n = 1; n <= 6; n++) { const o = op(ops[n]); o.num = n; d.ops.push(o); }
  /* ops 数组顺序 = packed 顺序：OP6 在前（decodeVoice 的 b=0 → num 6） */
  d.ops.sort((a, b) => b.num - a.num);
  return d;
}

/* ==========================================================================
   音色一：AC PLUCK —— 原声拨弦感（扫弦主力）
     目标（note 48 / C3）：起音 < 12ms；质心衰减比 ≥ 2（音头亮、随后转暗）；
     -30dB 衰减 0.8–1.5s（拨弦没有 sustain 平台，只有衰减）。
     结构（算法 5 = 3 载波 + 3 调制器）：
       OP1+OP2 主体对：调制器比率 2、包络快衰减 → 音头亮、0.1s 内转暗
       OP3+OP4 瞬态对：载波比率 4 → 指甲打弦的高频成分，衰减更快
       OP5+OP6 暖底对：衰减更慢的低电平主体，让扫弦有"琴体"
   ========================================================================== */
const AC_PLUCK = mkVoice('AC PLUCK', 5, 1, {
  1: { level: 80, coarse: 1, egR: [88, 28, 60, 70], egL: [85, 0, 0, 0] },
  2: { level: 92, coarse: 2, egR: [88, 68, 60, 70], egL: [92, 0, 0, 0] },
  3: { level: 45, coarse: 4, egR: [88, 85, 60, 70], egL: [65, 0, 0, 0] },
  4: { level: 80, coarse: 7, egR: [88, 80, 60, 70], egL: [80, 0, 0, 0] },
  5: { level: 30, coarse: 1, egR: [88, 24, 60, 70], egL: [50, 0, 0, 0] },
  6: { level: 45, coarse: 1, egR: [88, 55, 60, 70], egL: [45, 0, 0, 0] },
});

/* ==========================================================================
   音色二：EL GTR SUST —— 清音电吉他（有延音，solo/分解和弦用）
     目标（note 48，gate 1.2s）：起音 < 10ms；平台跌落 < 3dB（平台成立）；
     质心衰减比 < 1.5（延音段亮度稳定，与 AC PLUCK 相反）；反馈 3 给拨弦 grit。
     结构（算法 1 = 两条链）：
       OP1+OP2 主链：载波 sustain 平台（L3=55），调制器衰到低值 sustain
                     （纯直音会像风琴，留一点持续咬合）
       OP3..OP6 副链：低电平、带反馈的深度调制链 —— 拨弦 grit 与琴体感
   ========================================================================== */
const EL_GTR_SUST = mkVoice('EL GTR SUS', 1, 3, {
  1: { level: 78, coarse: 1, egR: [90, 45, 30, 65], egL: [62, 56, 55, 0] },
  2: { level: 70, coarse: 1, egR: [88, 50, 40, 65], egL: [72, 42, 34, 0] },
  3: { level: 28, coarse: 1, egR: [90, 45, 35, 65], egL: [45, 30, 26, 0] },
  4: { level: 40, coarse: 2, egR: [88, 70, 50, 65], egL: [40, 12, 8, 0] },
  5: { level: 35, coarse: 1, egR: [88, 70, 50, 65], egL: [35, 10, 6, 0] },
  6: { level: 30, coarse: 1, egR: [88, 70, 50, 65], egL: [30, 8, 5, 0] },
});

/* ---- 实测并收集 design 数据 ---- */
function measured(d) {
  const at = (note) => lab.measure(d, { note, gate: 1.2 });
  const m48 = at(48), m60 = at(60), m72 = at(72);
  return {
    note48: { attackMs: m48.attackMs, centroidRatio: m48.centroidRatio,
              decay30s: m48.decay30, sustainDropDb: m48.sustainDropDb },
    note60: { attackMs: m60.attackMs, centroidRatio: m60.centroidRatio },
    note72: { attackMs: m72.attackMs, centroidRatio: m72.centroidRatio },
  };
}

const VOICES = [
  { name: 'AC PLUCK', d: AC_PLUCK, design: { algo: 5, feedback: 1,
    idea: '原声拨弦感：算法 5 三对算子分工 —— OP1/OP2 主体（调制器比率 2 快衰减，音头亮随后转暗）、' +
          'OP3/OP4 瞬态（载波比率 4，指甲打弦的高频）、OP5/OP6 暖底（慢衰减低电平，琴体感）。' +
          '没有 sustain 平台：L2=L3=0，拨弦之后只有衰减。目标：起音<12ms、质心衰减比≥2、-30dB 0.8–1.5s（C3）。' } },
  { name: 'EL GTR SUS', d: EL_GTR_SUST, design: { algo: 1, feedback: 3,
    idea: '清音电吉他：算法 1 双链 —— 主链 OP1/OP2 有 L3=55 的 sustain 平台（跌落<3dB），' +
          '调制器衰到低值 sustain（留一点持续咬合，纯直音会像风琴）；副链 OP3..OP6 低电平深度调制，' +
          '反馈 3 给拨弦 grit。目标：起音<10ms、质心衰减比<1.5（延音亮度稳定）。' } },
];

/* ---- 主流程：实测 →（可选比对）→ 落盘 ---- */
const out = {
  schema: 1,
  label: 'FM 吉他（本项目原创）',
  origin: 'original',
  licence: 'CC0-1.0',
  note: '两个原创吉他类音色，由 tools/make_guitar.mjs 按实测数据生成；测量值刻画的是本仓库近似引擎（fm.js）里的形状，真机另有出入。',
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
