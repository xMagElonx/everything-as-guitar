# data/external/

外部音色包放这里（`<来源简称>.js`，UMD，结构见 `docs/voice-sources.md`）。
**默认为空** —— 没有任何通过权利链审查的外部包随仓库分发。

页面会自动探测全局 `FM1_EXT_*` 并载入；缺 `licence`/`licenceText` 的包
会被拒载并打日志（不静默）。`tools/starter_test.mjs` 对本目录的包
跑同一套「解码 → 往返 → 出声」检查；目录为空时大声 SKIP 并说明怎么补。
