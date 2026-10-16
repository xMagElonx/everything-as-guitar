# fm1-guitar

**Play the M-VAVE FM-1 like a guitar — in the browser. Or rather: give a
synthesizer a guitarist's playing semantics.** Chord pads are your fretting
hand, gesture keys are your strumming hand (down / up / muted chug), space
toggles a rhythm loop, holding a pad gives a continuous strum — and every
voice gets strummed, not just guitar patches.

This is the *performance* counterpart to
[fm1-tone-engine](https://github.com/xMagElonx/fm1-tone-engine) (the *voice*
bench: search, edit, write). Separate repos; the byte-level engine is forked
verbatim — see [`ENGINE-FORK.md`](ENGINE-FORK.md).

⚠ **Hardware status — testers welcome.** Everything here runs, covered by
**295 test assertions**, but **the device-facing paths have never touched a
real FM-1**. The biggest open question and the full unverified list are below.

「Bytes sent」≠「device played it」。 If you have the machine: five minutes
over **USB**, and negative results are the most useful ones —
[open an issue](../../issues).

---

## How to play (keyboard map)

| Key | Action |
|---|---|
| `1`–`0` | Select chord (E Em F G C D Dm A Am E7) — selecting is silent, like fretting |
| `D` / `U` / `X` | Gesture: down strum / up strum / muted chug (one per press) |
| `Space` | Rhythm loop on/off (folk / folkUp / punk / ballad, adjustable BPM) |
| `[` / `]` | BPM −5 / +5 |
| `H` | Humanize toggle (±6 ms timing, ±10 velocity per string; seeded, reproducible) |
| **Hold a pad** | Continuous strum (motor strum); release to stop |

**MIDI keyboard input**: low zone C2–A2 (36–45) selects chord slots, high
zone C4/D4/E4 = down/up/chug — with a MIDI keyboard this is the VST
one-hand playing posture. (Slots map chromatically: G2 picks the 8th pad,
which is A, not "G major".)

## Where the sound comes from

- **32 CC0 starter voices** + **2 original guitar voices** (`data/guitar.js`:
  AC PLUCK acoustic pluck, EL GTR SUS clean electric). The guitar voices are
  **measurement-driven**: offline render → measure attack time / windowed
  spectral-centroid (brightness decay curve) / decay slope → iterate until
  targets are met. The measurements live in each voice's `design` field;
  `tools/voice_lab.mjs` re-runs them. The v2 recipes follow the **factory
  Yamaha GUITAR 1** skeleton (ROM1A #12, dx7dump parameter analysis,
  independently corroborated by mu:zines "Understanding the DX7"):
  algorithm 8, feedback 7, 12:3:1 ratio stack, no sustain in any operator,
  velocity sensitivity (soft strum darker — supported by the local preview
  engine), key scaling, pitch-EG pluck transient.
- Every voice can be strummed — **the strum engine is voice-agnostic**;
  strumming a bell works fine.
- Load your own `.syx` banks at runtime; license-vetted external packs can
  go into `data/external/` (inclusion criteria in
  [`docs/voice-sources.md`](docs/voice-sources.md); packs missing licence
  fields are **refused** with a log line, never silently loaded).

## Hardware mapping (three steps on the real thing)

1. **One-time setup**: USB-C to the computer (not the 3.5mm TRS) → set
   **POLY** via EDIT → check MIDI channel = 1 under **GLO** → **turn ARP and
   SEQ off** (so they don't hijack incoming Notes).
2. **Make the device play your voice**: "push voice to device" sends all
   155 VCED parameters of the current voice as live single-parameter writes
   (`pushVoice` in `engine/params.js`) — effective immediately, no SAVE
   needed; hold **SAVE** on the device to keep it.
3. **Play**: the actions live on the page / computer keyboard / MIDI
   keyboard (table above); the device only sounds — it is the voice, the
   outside is the right hand.

## Five routes to standalone playing (no-flash → flash)

| Route | Computer-free? | Cost | Status |
|---|---|---|---|
| ① This page + computer brain | ✗ | zero | **this repo** |
| ② Phone + Bluetooth MIDI (responsive page; FM-1 has BLE; iOS Web MIDI limits stated honestly) | phone in pocket | tiny | adapted here |
| ③ Stock ARP/SEQ squeezed | ✓ | can't do strumming (ARP is monophonic, SEQ is hand-recorded) | built into the device |
| ④ Flash existing firmware (FoMni already strums natively, GPL) | ✓ | becomes someone else's instrument | exists in the community |
| ⑤ Own firmware (Optimist modular parts + Felucca browser simulator first; official updater flashes back to stock) | ✓ | weeks of embedded work; nothing touches hardware until the simulator is green | long-term |

## Unverified list (the hardware is the judge)

- **MIDI Note On/Off for playing** — upstream evidence only covers SysEx.
  Whether the FM-1 responds to channel Note messages at all is **the single
  biggest open question**; the "send single note" button is test #1.
- **pushVoice**: acceptance of all 155 parameters, immediacy, SAVE rules.
- **Polyphony**: manual claims up to 12 voices in POLY (a claim, not a
  measurement); 6-note chords untested.
- **Note-stream stability under loop playback**; whether external Notes get
  hijacked by ARP/SEQ if left on.
- **After a bank dump**: manual says "auto-saves after a short delay" vs
  community measurement "hold SAVE" — contradiction, awaiting arbitration.
- **The FM-1's own 27-key keyboard** as a USB MIDI controller (if it works,
  everything happens on the device itself).
- **No Program Change is sent**: PC support unverified, not assumed.

## Tests

```
node tools/dx7_test.mjs       # ① byte codec round-trip (22)
node tools/starter_test.mjs   # ② every bundled voice renders audible + guitar targets met (15)
node tools/param_test.mjs     # ③ 155-param table + pushVoice round-trip + SysEx anchor (26)
node tools/midi_test.mjs      # ④ transport + device sim (36)
node tools/strum_test.mjs     # ⑤ strum / humanize / rhythms / scheduler (139)
node tools/smoke.mjs          # ⑥ page end-to-end, two scenarios (57)
```

All six exit 0, **295 assertions**. Fresh `git clone` → run → green. The
external-pack section **loudly SKIPs** when `data/external/` is empty
(no bytes is the rights-chain norm, not a failure). LF discipline is
enforced by `.gitattributes`; a CRLF checkout breaks the smoke test by
design — that file must not be removed.

## Legal

MIT (code) + CC0 1.0 (the 34 bundled voices: 32 starter + 2 original
guitars). **No third-party voice bytes are distributed**; the external-pack
pipeline only admits chains that can be vetted (criteria and current state
in [`docs/voice-sources.md`](docs/voice-sources.md)). Details in
[`LICENSE`](LICENSE) and [`ENGINE-FORK.md`](ENGINE-FORK.md).

## Roadmap

- v0.3 (this repo): strum realism (spread default 90 ms → ~25 ms total window,
  up-stroke hits top 4 strings only, soft strums drop strings) + guitar voices
  rebuilt on the factory GUITAR 1 skeleton + preview engine now supports
  velocity→brightness and the pitch EG
- v0.2: VST-style strummer (gestures + loop + motor strum +
  humanize) + original guitar voices + push-to-device + MIDI keyboard input
  + external-pack pipeline
- v0.1: chord pads + strum + event mute + local audition + MIDI out
- next: hammer-on / pull-off / bend macros (device-level, like palm mute),
  strum-pattern editor, hardware-test feedback folded back in
- later: a firmware route (JieLi AC791N, simulator-first) — separate decision
