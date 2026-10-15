// params.js 移植回归：155 参数表、packed 双向映射、SysEx 构造、闷音宏。
// 数据只用 starter 32 音色（全新 clone 必定可跑）。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const P = require_(path.join(ROOT, 'engine', 'params.js'));
const M = require_(path.join(ROOT, 'engine', 'midi.js'));

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '  ← ' + extra : '')); }
  return cond;
}
function throws(fn, frag, msg) {
  try { fn(); return check(false, msg, '没有抛错'); }
  catch (e) { return check(String(e.message).indexOf(frag) >= 0, msg, e.message); }
}
function section(t) { console.log('\n' + t); }
function bytesEq(a, b) { return DX7.hex(a) === DX7.hex(b); }

/* ------------------------------------------------------------- 数据 */
const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);
const packed = DX7.parseBank(DX7.b64ToBytes(sandbox.FM1_STARTER.banks[0]));
const voices = [];
for (let i = 0; i < 32; i++) voices.push(packed.slice(i * 128, i * 128 + 128));

/* ------------------------------------------------------------- ① 表结构 */
section('① 参数表结构');
check(P.PARAM_COUNT === 155 && P.GLOBAL_BASE === 126 && P.OP_PARAM_COUNT === 21,
  '155 参数 = 6 算子 × 21 + 全局 29');
const rows = P.listParams().split('\n');
check(rows.length === 155, 'listParams 摊平 155 行', String(rows.length));
check(P.opBase(6) === 0 && P.opBase(1) === 105, 'VCED 编址：OP6 基址 0、OP1 基址 105（步长 21）');
check(P.packedOpBase(6) === 0 && P.packedOpBase(1) === 85, 'packed 侧：OP6 基址 0、步长 17');
const anchor = P.paramChange(134, 31, 0);   // 算法 → 面板 32（sezare56 真机锚点）
check(DX7.hex(anchor) === 'f0 43 10 01 08 1f f7',
  '真机锚点：paramChange(算法, 31) → F0 43 10 01 08 1F F7');

/* ------------------------------------------------------------- ② 读 */
section('② getParam 与已验证解码器一致');
let mism = 0;
for (const v of voices) {
  const d = DX7.decodeVoice(v);
  if (P.getParam(v, 134) !== d.algorithm) mism++;
  if (P.getParam(v, 135) !== d.feedback) mism++;
  if (P.getParam(v, 136) !== d.oscKeySync) mism++;
  for (let op = 1; op <= 6; op++) {
    const b = P.opBase(op);
    if (P.getParam(v, b + 16) !== d.ops[6 - op].outputLevel) mism++;
    if (P.getParam(v, b + 20) !== d.ops[6 - op].detune) mism++;
  }
}
check(mism === 0, '算法/反馈/同步/输出电平/失谐：参数层与解码器逐音色一致', mism + ' 处不一致');

/* ------------------------------------------------------------- ③ 往返 */
section('③ 逐参数 get → set 全 155 项 → 128 字节逐字节相同');
let rtBad = 0, rtWho = '';
for (let vi = 0; vi < 32; vi++) {
  const v = voices[vi];
  const copy = new Uint8Array(v);
  for (let i = 0; i < 155; i++) {
    const val = P.getParam(copy, i);
    P.setParam(copy, i, val);
  }
  if (!bytesEq(copy, v)) { rtBad++; if (!rtWho) rtWho = '音色 ' + vi; }
}
check(rtBad === 0, '32 个音色 × 155 参数全部往返无损', rtWho);

/* ------------------------------------------------------------- ④ 越界报错 */
section('④ 越界值必须报错，不许静默截断');
const v0 = new Uint8Array(voices[0]);
throws(() => P.setParam(v0, 134, 32), '0-31', '算法 32 越界');
throws(() => P.setParam(v0, 135, 8), '0-7', '反馈 8 越界');
throws(() => P.setParam(v0, 0, 100), '0-99', '包络 rate 100 越界');
throws(() => P.setParam(v0, 155, 0), '0-154', '索引 155 越界');
throws(() => P.setParam(v0, 145, 31), '32-', '名字字符 < 32 越界');
throws(() => P.getParam(new Uint8Array(10), 0), '128', '非 128 字节输入被拒');

/* ------------------------------------------------------------- ⑤ 闷音宏 */
section('⑤ palmMute 宏（纯函数：同输入同输出，只出计划不改数据）');
const before = DX7.hex(voices[1]);
const plan1 = P.palmMute(voices[1]);
const plan2 = P.palmMute(voices[1]);
check(before === DX7.hex(voices[1]), '宏调用不改输入数据');
check(JSON.stringify(plan1) === JSON.stringify(plan2), '确定性：两次调用计划完全相同');
check(plan1.name === 'palmMute' && Array.isArray(plan1.changes), '返回 {name, changes[]}');
let structBad = 0;
for (const c of plan1.changes) {
  if (typeof c.delta !== 'number' || !Number.isFinite(c.delta)) structBad++;
  if (c.to !== c.from + c.delta) structBad++;
  const inf = P.paramInfo(c.index);
  if (c.to < inf.min || c.to > inf.max) structBad++;
  if (c.pp !== inf.pp || c.qq !== inf.qq) structBad++;
}
check(structBad === 0 && plan1.changes.length > 0,
  '每条变更：delta 有限、to = from + delta、落在参数区间内、pp/qq 与定位一致',
  structBad ? structBad + ' 条结构错误' : plan1.changes.length + ' 条变更');
const msgs = P.changesToSysex(plan1.changes, 0);
check(msgs.length === plan1.changes.length && msgs.every(m => M.assertLiveSysex(m)),
  'changesToSysex 的每条消息都通过 assertLiveSysex（7 字节、F0 43 … F7）');
check(msgs.every(m => m[2] === 0x10), '默认通道 1（字节 2 = 0x10）');

/* ------------------------------------------------------------- ⑥ 整音色推送 */
section('⑥ pushVoice：128 字节 → 155 条实时单参数消息（往返尺）');
const pv = P.pushVoice(voices[3], 0);
check(pv.length === 155, '恰 155 条消息', String(pv.length));
let pvBad = 0, pvWho = -1;
for (let i = 0; i < 155; i++) {
  const expect = P.paramChange(i, P.getParam(voices[3], i), 0);
  if (DX7.hex(pv[i].bytes) !== DX7.hex(expect)) { pvBad++; if (pvWho < 0) pvWho = i; }
  if (pv[i].index !== i || pv[i].value !== P.getParam(voices[3], i)) pvBad++;
}
check(pvBad === 0, '每条 bytes 与 paramChange 独立复算逐字节一致（含 index/value 伴随字段）', pvWho);
check(pv.every(m => M.assertLiveSysex(m.bytes)), '全部通过 assertLiveSysex（7 字节无校验和）');
check(pv[134].bytes[3] === 0x01 && pv[134].bytes[5] === voices[3][110] & 31,
  '算法参数走全局区 pp=01（真机锚点同路）');
/* 重建尺：按推送序列用 setParam 从零重建，必须逐字节还原 ——
   这是「推送出去的消息集合 ≡ 音色本身」的硬证明 */
let rebuildBad = 0, rebuildWho = '';
for (let vi = 0; vi < 32; vi++) {
  const src = voices[vi];
  const msgs = P.pushVoice(src, 0);
  const rebuilt = new Uint8Array(128);
  for (const m of msgs) P.setParam(rebuilt, m.index, m.value);
  if (!bytesEq(rebuilt, src)) { rebuildBad++; if (!rebuildWho) rebuildWho = '音色 ' + vi; }
}
check(rebuildBad === 0, '32 音色 × pushVoice → setParam 重建全部逐字节还原', rebuildWho);
throws(() => P.pushVoice(new Uint8Array(10)), '128', '非 128 字节被拒');
throws(() => P.pushVoice(voices[3], 16), '0-15', '通道 16 越界');

/* ------------------------------------------------------------- 结论 */
console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
