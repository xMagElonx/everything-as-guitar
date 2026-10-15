// dx7.js 移植回归：证明 fork 过来的字节编解码器在本仓库里依然是严格互逆的。
// 精简自 fm1-tone-engine 的 verify.mjs / engine_test.mjs —— 数据只用随仓库分发的
// CC0 starter bank（32 音色），全新 clone 上必定可跑，无 SKIP 路径。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const FM = require_(path.join(ROOT, 'engine', 'fm.js'));

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

/* ------------------------------------------------------------- 常量 */
section('① 常量');
check(DX7.SYSEX_BYTES === 4104, 'SysEx 整包 4104 字节');
check(DX7.BANK_BYTES === 4096, '裸 bank 4096 字节');
check(DX7.VOICE_BYTES === 128 && DX7.VOICES_PER_BANK === 32 && DX7.OP_BLOCK === 17,
  '128 × 32 × 17 三个格式常数');
check(DX7.hex(new Uint8Array([0xF0, 0x43])) === 'f0 43', 'hex() 小写两位输出');

/* ------------------------------------------------------------- 数据载入 */
section('② starter bank');
const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);
const S = sandbox.FM1_STARTER;
if (!S) { console.log('  FAIL  data/starter.js 里取不到 FM1_STARTER'); process.exit(1); }
const syx = DX7.b64ToBytes(S.banks[0]);
check(syx.length === 4104, 'banks[0] 解 base64 后是 4104 字节', String(syx.length));

const syxFile = new Uint8Array(readFileSync(path.join(ROOT, 'starter', 'FM-1_starter_bank.syx')));
check(DX7.hex(syx) === DX7.hex(syxFile),
  'data/starter.js 与 starter/*.syx 是同一份字节');

let packed = null;
try { packed = DX7.parseBank(syx); check(true, 'parseBank 接受 starter SysEx（头 + 校验和）'); }
catch (e) { check(false, 'parseBank 接受 starter SysEx', e.message); }

check(S.names.length === 32 && S.design.length === 32, '32 个名字 + 32 条设计说明');
check(S.licence === 'CC0-1.0', '许可证标注 ' + S.licence);

const voices = [];
for (let i = 0; i < 32; i++)
  voices.push(DX7.decodeVoice(packed.slice(i * 128, i * 128 + 128)));
const nameMismatch = [];
for (let i = 0; i < 32; i++)
  if (voices[i].name !== S.names[i]) nameMismatch.push(i + ': "' + voices[i].name + '" ≠ "' + S.names[i] + '"');
check(nameMismatch.length === 0, '解码出的名字与 starter.js 的 names 逐一相符', nameMismatch.join('; '));

/* ------------------------------------------------------------- 往返 */
section('③ 解码 → 编码 严格互逆（真实字节）');
let rtBad = 0, firstBad = -1;
for (let i = 0; i < 32; i++) {
  const back = DX7.encodeVoice(voices[i]);
  if (DX7.hex(back) !== DX7.hex(packed.slice(i * 128, i * 128 + 128))) { rtBad++; if (firstBad < 0) firstBad = i; }
}
check(rtBad === 0, '32 个音色逐字节往返（decodeVoice → encodeVoice）',
  rtBad ? '首个失配槽 ' + firstBad : '');

/* ------------------------------------------------------------- 拒绝路径 */
section('④ parseBank / encodeVoice 的拒绝路径（坏数据必须报错，不许静默）');
throws(() => DX7.parseBank(new Uint8Array(100)), '长度', '长度不对 → 报错');
throws(() => DX7.parseBank(new Uint8Array(4104)), '头不对', '全零 4104 字节 → 头不对报错');
const noF7 = syx.slice();
noF7[4103] = 0x00;
throws(() => DX7.parseBank(noF7), 'F7', '结尾不是 F7 → 报错');
const badCk = syx.slice();
badCk[4102] = (badCk[4102] + 1) & 0x7F;
throws(() => DX7.parseBank(badCk), '校验和', '校验和错 1 → 报错');
throws(() => DX7.encodeVoice(Object.assign({}, voices[0], { algorithm: 32 })), '算法',
  '算法 32 越界 → 报错（不许掩码截断）');
throws(() => DX7.encodeVoice(Object.assign({}, voices[0], { ops: voices[0].ops.slice(1) })), '算子块缺失',
  '算子块缺失 → 报错');

/* ------------------------------------------------------------- buildBank 往返 */
section('⑤ buildBank 往返');
const rebuilt = DX7.buildBank(packed);
check(rebuilt.length === 4104, 'buildBank 产出 4104 字节');
check(DX7.hex(rebuilt) === DX7.hex(syx), 'buildBank(parseBank(syx)) 与原文件逐字节一致');
check(DX7.checksum(packed) === syx[4102], 'checksum() 与文件内校验和一致');

/* ------------------------------------------------------------- describe */
section('⑥ describe（算法结构摘要）');
let carriersBad = 0;
for (const d of voices) {
  const info = DX7.describe(d, FM);
  if (info.carrierCount < 1 || info.carrierCount > 6) carriersBad++;
  if (info.algorithmPanel !== d.algorithm + 1) carriersBad++;
}
check(carriersBad === 0, '32 个音色的载波数都在 1-6、面板算法号 = 索引 +1');
const liveBad = voices.filter(d =>
  DX7.describe(d, FM).carriers.filter(n => d.ops[6 - n].outputLevel > 0).length === 0);
check(liveBad.length === 0, '每个音色至少有一个载波在发声（载波电平全 0 = 哑音色）',
  liveBad.map(d => d.name).join(', '));

/* ------------------------------------------------------------- 结论 */
console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
