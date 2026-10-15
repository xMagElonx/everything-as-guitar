# 外部音色来源与权利链审查（voice-sources）

本项目的权利红线：**只分发权利链能审清的字节**。审不清的，只在这里留链接指引，
绝不把字节打进仓库。出厂音色的权利链在 Yamaha 那一层就断了，所以那 128 个音色
永远不进本仓库（starter 32 个是我们自己的 CC0，guitar 2 个是我们自己的 CC0）。

## 收录标准（三条全过才收）

1. **来源页可查**：必须有一个公开 URL，能独立看到「这些字节是谁发布的」。
2. **许可证原文可引**：发布页必须明确写出许可证（CC0 / CC-BY / 公有领域 /
   明确的再分发授权），并能把原文段落摘录进收录记录。**"网上流传的 bank" 不算**。
3. **存档快照**：收录时用 web.archive.org 或本地 hash 记录（SHA-256），
   防止来源页日后改口或消失。

## 收录流程

1. 找到候选音色包，逐条核对上面三条标准。
2. 在 `data/external/` 下建一个文件，命名 `data/external/<来源简称>.js`，
   结构如下（UMD，与 starter/guitar 同构）：

```js
/* 外部音色包：<来源名>
   来源页：<URL>
   许可证：<许可证名>（原文摘录见本文件底部注释）
   存档：<archive.org 链接 或 SHA-256>
   收录日期：<YYYY-MM-DD> */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FM1_EXT_<大写来源简称> = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    licence: 'CC0 1.0',           // 短名
    licenceText: '...',           // 原文摘录（页面日志会引用）
    voices: [ { name: '...', raw: '<256 位 hex，128 字节 packed voice>' } ],
  };
});
```

3. 在 `index.html` 加一行 `<script src="data/external/<来源简称>.js"></script>`。
   页面会自动探测 `FM1_EXT_*` 并载入（逐字节去重，与已有音色重复的自动跳过）；
   **缺 `licence`/`licenceText` 字段的包会被拒载并打日志**，不会静默。

## 审查未通过时的降级

审不清来源/许可证的音色库，**不要下载、不要贴字节**。在本节下面加一行链接 +
一句话说明（它是什么、为什么没收），让想用的人自己去原站拿。
已知的大库现状（2026-10 调研）：

- **DEXED 社区音色库（asb2m10/dexed 仓库内 patches）**：大量用户转存的 DX7
  cartridge 转储，权利链普遍不明 —— 未收录。想要的人自行从 Dexed 相关渠道获取。
- **Dave Benson 的 sysex-format.txt 附带音色、经典 DX7 数据集**：多为爱好者
  转存，授权不明 —— 未收录。
- **mu:zines / DX Simulator 等站的 cartridge 镜像**：原始 ROM 卡带内容的复制，
  权利链断在 Yamaha/第三方版权方 —— 未收录。

## 本仓库自己的字节（不受上述约束）

| 文件 | 内容 | 许可证 |
|---|---|---|
| `data/starter.js` | 32 个原创音色 | CC0 1.0 |
| `data/guitar.js` | 2 个原创吉他音色（AC PLUCK / EL GTR SUS，实测数据在 design 字段） | CC0 1.0 |
