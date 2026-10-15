# fm1-guitar

**Play the M-VAVE FM-1 like a guitar — in the browser.** Chord pads, real
strumming (down/up strokes, per-string velocity, muted chucks), palm mute,
local audition through a built-in FM engine, and MIDI output to the device.

This is the *performance* counterpart to
[fm1-tone-engine](https://github.com/xMagElonx/fm1-tone-engine) (the *voice*
bench: search, edit, write). The two projects are separate; they share the
byte-level engine, forked verbatim — see [`ENGINE-FORK.md`](ENGINE-FORK.md).

⚠ **Hardware status — testers welcome.** Everything here runs and is covered
by 168 test assertions, but **the device-facing paths have never touched a
real FM-1**:

- **MIDI Note On/Off for playing** — upstream evidence only covers SysEx
  (bank dumps, single-parameter messages). Whether the FM-1 responds to
  channel Note messages at all is the single biggest open question. The
  page has a **"发单音" (send single note)** button exactly for testing this
  first.
- **The palm-mute macro** (`F0 43 10 pp qq vv F7`, single-parameter live
  write, V15 firmware) — one device-verified anchor exists from the
  community, the full path has not been run on hardware.

「字节已发出」≠「设备已发声/已执行」。 If you have the machine: five minutes
over **USB**, and negative results are the most useful ones —
[open an issue](../../issues).

---

## What it does

| Layer | What | Proven by |
|---|---|---|
| Byte codec | DX7 packed voice / bank parse & rebuild | `tools/dx7_test.mjs` — byte-identical round-trip on all 32 bundled voices |
| FM audition | Pure-JS 6-operator FM render of any DX7 voice | `tools/starter_test.mjs` — every bundled voice renders audible & finite |
| Strum engine | chord + pattern → timed, graded note events | `tools/strum_test.mjs` — exact sequences, independently hand-computed |
| MIDI out | Note On/Off with timestamp scheduling; bank/lives SysEx rulers | `tools/midi_test.mjs` + `tools/smoke.mjs` scenario B — page bytes vs independent recomputation |
| Palm mute (device) | 155-param VCED live-write macro | `tools/param_test.mjs` — device-verified SysEx anchor reproduced |

Two palm mutes, on purpose, documented apart:

- **Event-level** (strum engine): notes get very short gates — playing
  technique, affects both local audition and MIDI.
- **Device-level** (`DX7_PARAMS.palmMute`): rewrites decay envelopes +
  feedback of the *sounding* voice over live SysEx — timbre, unverified.

## Run it

Double-click `index.html` (Chrome / Edge / Opera for Web MIDI). No install,
no build, no account, no network. Pick a voice, click a chord pad or press
keys **1–0**, flip patterns. Own `.syx` banks can be loaded at runtime
(files never leave your machine).

## Tests

```
node tools/dx7_test.mjs       # ① byte codec round-trip on real bytes (22)
node tools/starter_test.mjs   # ② every bundled voice renders audible (9)
node tools/param_test.mjs     # ③ 155-param table + SysEx anchor (19)
node tools/midi_test.mjs      # ④ transport + device sim (36)
node tools/strum_test.mjs     # ⑤ strum engine, exact sequences (52)
node tools/smoke.mjs          # ⑥ page end-to-end, two scenarios (30)
```

All six exit 0, **168 assertions**, all data ships with the repo — no SKIP
paths, nothing to download. Fresh `git clone` → run → green (LF discipline
is enforced by `.gitattributes`; on Windows a CRLF checkout breaks the smoke
test by design, so that file must not be removed).

## Legal

MIT (code) + CC0 1.0 (the 32 bundled voices). **No third-party voice bytes
are distributed**; user-loaded banks and runtime-fetched data are not part of
this distribution. Details in [`LICENSE`](LICENSE) and [`ENGINE-FORK.md`](ENGINE-FORK.md).

## Roadmap

- v0.1 (this): chord pads + strum + event mute + local audition + MIDI out
- next: hammer-on / pull-off / bend macros (device-level, like palm mute),
  strum-pattern editor, technique voice pack (existing clean-license patches
  first; self-tuned voices only measurement-driven)
- later: a firmware route (JieLi AC791N, simulator-first) — separate decision
