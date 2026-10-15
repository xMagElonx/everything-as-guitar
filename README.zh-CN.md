# fm1-guitar

**在浏览器里像弹吉他一样弹 M-VAVE FM-1。** 和弦垫、真·扫弦（下扫/上扫、逐弦力度、哑音扫弦）、闷音；自带 FM 引擎本地试听，也可把演奏发到设备。

这是 [fm1-tone-engine](https://github.com/xMagElonx/fm1-tone-engine)（**音色台**：检索、编辑、写入）的姊妹项目 —— 演奏台。两个项目独立建仓，字节级引擎原样共用（出处见 [`ENGINE-FORK.md`](ENGINE-FORK.md)）。

⚠ **硬件状态 —— 欢迎来测。** 这一页全部能跑、有 168 项测试断言罩着，但**面向设备的路径从来没碰过真机**：

- **演奏用的 MIDI Note On/Off** —— 上游证据只覆盖 SysEx（bank dump 和单参数消息）。FM-1 到底认不认频道 Note 消息，是当前最大的未知数。页面上的**「发单音」按钮**就是为第一步验证准备的。
- **闷音宏**（`F0 43 10 pp qq vv F7`，V15 固件实时单参数写入）—— 圈内有一条真机实测锚点，完整路径未上过真机。

「字节已发出」≠「设备已发声/已执行」。有琴的朋友：USB 连上五分钟，**阴性结果（没反应/不对劲）对我们最有价值** —— 请开 issue。

---

## 它做什么

| 层 | 做什么 | 怎么证明 |
|---|---|---|
| 字节编解码 | DX7 packed 音色 / bank 的解析与重建 | `tools/dx7_test.mjs` —— 32 个随附音色逐字节往返 |
| FM 试听 | 纯 JS 六算子 FM 渲染任意 DX7 音色 | `tools/starter_test.mjs` —— 每个随附音色渲染出声且有限 |
| 扫弦引擎 | 和弦 + 演奏方式 → 带时序与力度的事件序列 | `tools/strum_test.mjs` —— 精确序列，独立手算期望 |
| MIDI 输出 | Note On/Off 时间戳调度；bank/实时 SysEx 两把守门尺 | `tools/midi_test.mjs` + `tools/smoke.mjs` 场景 B —— 页面真字节 vs 独立复算 |
| 闷音宏（设备级） | 155 参数 VCED 实时写入 | `tools/param_test.mjs` —— 复现真机锚点字节 |

两个「闷音」是有意分开的：

- **事件级**（扫弦引擎）：音符时值掐短 —— 演奏时序，本地试听与 MIDI 都受益；
- **设备级**（`DX7_PARAMS.palmMute`）：用实时 SysEx 改「正在响的音色」的衰减包络与反馈 —— 音色层面，真机未验证。

## 怎么跑

双击 `index.html`（Web MIDI 需要 Chrome / Edge / Opera）。免安装、免构建、无账号、不联网。选音色 → 点和弦垫或按键盘 **1–0** → 换演奏方式。自己的 `.syx` 音色库随时拖进来（文件不出你的机器）。

## 测试

```
node tools/dx7_test.mjs       # ① 字节编解码往返（22）
node tools/starter_test.mjs   # ② 随附音色全部可发声（9）
node tools/param_test.mjs     # ③ 155 参数表 + SysEx 锚点（19）
node tools/midi_test.mjs      # ④ 传输层 + 设备模拟（36）
node tools/strum_test.mjs     # ⑤ 扫弦引擎精确序列（52）
node tools/smoke.mjs          # ⑥ 页面端到端，两个场景（30）
```

六条全部退出 0，共 **168 项断言**，测试数据全部随仓库分发 —— 没有 SKIP 路径、无需下载任何东西。全新 `git clone` → 跑 → 全绿（LF 行尾纪律由 `.gitattributes` 强制；Windows 上若被改成 CRLF，冒烟测试会**故意**崩 —— 那个文件别删）。

## 许可

MIT（代码）+ CC0 1.0（随附 32 音色）。**不分发任何第三方音色字节**；用户运行时载入的音色不属于本发行物。详见 [`LICENSE`](LICENSE) 与 [`ENGINE-FORK.md`](ENGINE-FORK.md)。

## 路线

- v0.1（本仓库）：和弦垫 + 扫弦 + 事件级闷音 + 本地试听 + MIDI 输出
- 接下来：击勾弦/推弦宏（设备级，同闷音宏的路数）、扫弦节奏编辑器、技法音色组（先用授权干净的现成 patch；自调音色必须实测驱动）
- 更远：固件路线（JieLi AC791N，模拟器优先）—— 另行决策
