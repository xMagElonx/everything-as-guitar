# Engine fork provenance

The four files under `engine/` marked below are **byte-identical copies** from
the sister project [`fm1-tone-engine`](https://github.com/xMagElonx/fm1-tone-engine)
(MIT, © 2026 x网友X), taken at commit `f385a94` (2026-10-16).
`data/starter.js` and `starter/FM-1_starter_bank.syx` are likewise byte-identical
copies (CC0 1.0 voice data).

| File | Source | License |
|---|---|---|
| `engine/dx7.js` | fm1-tone-engine @ f385a94, verbatim | MIT |
| `engine/fm.js` | fm1-tone-engine @ f385a94, verbatim | MIT |
| `engine/midi.js` | fm1-tone-engine @ f385a94, verbatim | MIT |
| `engine/params.js` | fm1-tone-engine @ f385a94, verbatim | MIT |
| `data/starter.js` | fm1-tone-engine @ f385a94, verbatim | CC0 1.0 |
| `starter/FM-1_starter_bank.syx` | fm1-tone-engine @ f385a94, verbatim | CC0 1.0 |

Why verbatim: keeping the fork byte-identical means upstream fixes can be
pulled with a plain `diff`/copy, and `tools/dx7_test.mjs` in this repo acts as
a regression net proving the copies still round-trip real bytes. `engine/midi.js`
loads `./dx7.js` by relative path, so the directory layout must keep both files
side by side.

New code in this repo (everything else): `engine/strum.js`, the page, and the
test suites — MIT, same author.

## 同步记录

- 2026-10-16：engine/fm.js 逐字节同步自上游 @ fe34636（新增 render 可选参数
  `velocity:`（力度→算子电平）与 `bend:`（音高包络）；engine_test 28→42）。
