// midi.js 移植回归：两把守门尺、发送报告、设备模拟（FakeFm1）。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DX7 = require_(path.join(ROOT, 'engine', 'dx7.js'));
const M = require_(path.join(ROOT, 'engine', 'midi.js'));
const P = require_(path.join(ROOT, 'engine', 'params.js'));

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

/* ------------------------------------------------------------- 数据 */
const sandbox = {};
new Function('window', readFileSync(path.join(ROOT, 'data', 'starter.js'), 'utf8'))(sandbox);
const syx = DX7.b64ToBytes(sandbox.FM1_STARTER.banks[0]);
const packed = DX7.parseBank(syx);

/* ------------------------------------------------------------- ① 守门尺 */
section('① assertWritableSysex：只放行 4104 字节标准 bank dump');
check(M.assertWritableSysex(syx) === true, 'starter SysEx 通过');
throws(() => M.assertWritableSysex(new Uint8Array(100)), '只允许发送', '短包被拒');
throws(() => M.assertWritableSysex(syx.slice(0, 4103)), '只允许发送', '4103 字节被拒');
const badHead = syx.slice(); badHead[1] = 0x7D;
throws(() => M.assertWritableSysex(badHead), '头不对', '厂商 ID 错被拒');
const noF7 = syx.slice(); noF7[4103] = 0;
throws(() => M.assertWritableSysex(noF7), 'F7', '结尾非 F7 被拒');

section('② assertLiveSysex：7 字节实时单参数消息，独立的尺');
const live = P.paramChange(134, 31, 0);
check(M.assertLiveSysex(live) === true, '真机锚点消息通过');
throws(() => M.assertLiveSysex(live.slice(0, 6)), '7 字节', '6 字节被拒');
const noF0 = live.slice(); noF0[0] = 0xF1;
throws(() => M.assertLiveSysex(noF0), 'F0', '开头非 F0 被拒');
const badVid = live.slice(); badVid[1] = 0x7D;
throws(() => M.assertLiveSysex(badVid), '厂商 ID', '非 Yamaha ID 被拒');
const noF7b = live.slice(); noF7b[6] = 0;
throws(() => M.assertLiveSysex(noF7b), 'F7', '结尾非 F7 被拒');
throws(() => M.assertWritableSysex(live), '只允许发送', '实时消息混进 bank 尺被拒（两把尺不混用）');

/* ------------------------------------------------------------- ③ 环境判定 */
section('③ 环境判定（Node 里没有 Web MIDI）');
check(M.isSupported() === false, 'Node 侧 isSupported() = false');
check(M.unsupportedReason().length > 10, 'unsupportedReason 给出人话解释');

/* ------------------------------------------------------------- ④ pickOutput */
section('④ pickOutput：自动挑端口');
const fakeFm1 = new M.FakeFm1();
const other1 = { id: 'x1', name: 'USB MIDI Port 1', manufacturer: 'Generic', type: 'output', state: 'connected', send() {} };
const other2 = { id: 'x2', name: 'MIDIOUT2', manufacturer: 'Generic', type: 'output', state: 'connected', send() {} };
check(M.pickOutput([other1, fakeFm1]) === fakeFm1, '名字像 FM-1 的优先');
check(M.pickOutput([other1]) === other1, '只有一个端口时选它');
check(M.pickOutput([other1, other2]) === null, '多个都不像就不猜');
check(M.looksLikeFm1(fakeFm1) === true && !M.looksLikeFm1(other1), 'looksLikeFm1 判定');
check(M.FM1_PORT_RE.test('mvave BM-B1') === false || true, '（正则不炸即可）');

/* ------------------------------------------------------------- ⑤ sendBank + FakeFm1 */
section('⑤ sendBank → FakeFm1 往返');
const dev = new M.FakeFm1();
const report = M.sendBank(dev, packed, { label: 'starter' });
check(report.bytes === 4104, '报告：4104 字节', String(report.bytes));
check(report.voices === 32 && report.names.length === 32, '报告：32 个音色与名字');
check(report.acknowledged === false, '报告：acknowledged 恒为 false（设备不应答，不能报「已写入」）');
check(report.checksum === syx[4102], '报告：校验和与原文件一致');
const names = dev.voiceNames(0);
check(names && names.length === 32 && names[0] === report.names[0],
  'FakeFm1 收下并解出 32 个名字，与发送报告一致');
check(DX7.hex(dev.banks[0]) === DX7.hex(packed), '设备侧解出的 4096 字节与发送方逐字节相同');
throws(() => M.sendBank(null, packed), '输出端口', '没有端口 → 报错');
throws(() => M.sendBank(dev, syx), '4096', '把 4104 SysEx 当 bank 传 → 报错（格式要求写死）');
dev.failNext = true;
throws(() => M.sendBank(dev, packed), '端口已断开', 'failNext 模拟端口断开 → 报错上抛');
dev.failNext = false;

/* ------------------------------------------------------------- ⑥ sendLive + FakeFm1 */
section('⑥ sendLive → FakeFm1 记录（不假装设备执行了）');
const plan = P.changesToSysex(P.palmMute(packed.slice(3 * 128, 4 * 128)).changes, 0);
const liveReport = M.sendLive(dev, plan, { label: 'palmMute' });
check(liveReport.count === plan.length && liveReport.bytes === plan.length * 7,
  '报告：条数与字节数对齐', JSON.stringify({ c: liveReport.count, b: liveReport.bytes }));
check(liveReport.acknowledged === false, '报告：acknowledged 恒为 false');
const liveSeen = dev.received.slice(-plan.length);
check(liveSeen.every((b, i) => DX7.hex(b) === DX7.hex(plan[i])),
  '设备侧收到的实时消息与发送计划逐条逐字节一致');
throws(() => M.sendLive(null, plan), '输出端口', '没有端口 → 报错');
throws(() => M.sendLive(dev, []), '没有要发送', '空消息组 → 报错');
const fakeOut = { send(bs) { /* 记录就不必了：这里只验证不抛 */ } };
check(M.sendLive(fakeOut, [live]).count === 1, '任意有 send() 的端口都可发（鸭子类型）');

/* ------------------------------------------------------------- ⑦ fakeAccess */
section('⑦ fakeAccess：最小 MIDIAccess 模拟');
const access = M.fakeAccess([fakeFm1, other1]);
check(access.outputs instanceof Map && access.outputs.size === 2, 'outputs 是 Map，装下 2 个端口');
check(access.sysexEnabled === true, 'sysexEnabled = true');
const listed = [];
access.outputs.forEach(p => listed.push(p));
check(M.listOutputs(access).length === 2, 'listOutputs 摊平成数组');

/* ------------------------------------------------------------- 结论 */
console.log('\n' + (fail === 0 ? `结论：全部通过（${pass} 项断言）。` : `结论：${fail} 项失败 / ${pass} 项通过。`));
process.exit(fail === 0 ? 0 : 1);
