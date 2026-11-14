# everything-as-guitar

**Give any sound source a guitarist's playing semantics — the browser is
the strumming hand, your synthesizer is the voice.** Chord pads are your
fretting hand, gesture keys are your strumming hand (down / up / muted
chug), space toggles a rhythm loop, holding a pad gives a continuous
strum — and every voice gets strummed, not just guitar patches. The strum
engine emits nothing but standard MIDI notes, so the sound source is your
choice: the **built-in FM engine** (audition without hardware), **your own
imported `.syx` voices**, **your own WAV/MP3 samples** (one sample + a
root note = a whole sample guitar via varispeed pitch-shift), or **any
MIDI synthesizer** — FM-1, Dexed, Volca FM, a real DX7. **The M-VAVE FM-1
is simply the first, best-tested target** (every hardware section below is
about it), not the only one.

This is the *performance* counterpart to
[fm1-tone-engine](https://github.com/xMagElonx/fm1-tone-engine) (the *voice*
bench: search, edit, write FM/DX7 voices). Separate repos; the byte-level
engine is forked verbatim — see [`ENGINE-FORK.md`](ENGINE-FORK.md).

⚠ **Hardware status — testers welcome.** Everything here runs, covered by
**383 test assertions**, but **the device-facing paths have never touched a
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
| `Space` | Rhythm loop on/off (folk universal / pop alternating / punk all-down / reggae offbeat / ballad, adjustable BPM). All follow the arm-motion rule: downstrokes on beats, upstrokes on offbeats (three independent sources agree; punk is all-down eighths per real punk convention) |
| `[` / `]` | BPM −5 / +5 |
| `H` | Humanize toggle (±6 ms timing, ±10 velocity per string; seeded, reproducible) |
| **Hold a pad** | Continuous strum (motor strum); release to stop |
| **Load sample** | Upload WAV/MP3 → auto-processed sample guitar (root auto-detected, editable; persisted in IndexedDB; cannot be pushed to a device) |

**MIDI keyboard input**: low zone C2–A2 (36–45) selects chord slots, high
zone C4/D4/E4 = down/up/chug — with a MIDI keyboard this is the VST
one-hand playing posture. (Slots map chromatically: G2 picks the 8th pad,
which is A, not "G major".)

## Sound sources: three ways to connect (the engine only sends MIDI; what makes the noise is up to you)

1. **Built-in FM engine (no hardware needed)**: 32 CC0 starter voices + 2
   original guitar voices (`data/guitar.js`: AC PLUCK acoustic pluck,
   EL GTR SUS clean electric). The guitar voices are **measurement-driven**:
   offline render → measure attack time / windowed spectral-centroid
   (brightness decay curve) / decay slope → iterate until targets are met.
   The measurements live in each voice's `design` field;
   `tools/voice_lab.mjs` re-runs them. The v2 recipes follow the **factory
   Yamaha GUITAR 1** skeleton (ROM1A #12, dx7dump parameter analysis,
   independently corroborated by mu:zines "Understanding the DX7"):
   algorithm 8, feedback 7, 12:3:1 ratio stack, no sustain in any operator,
   velocity sensitivity (soft strum darker — supported by the local preview
   engine), key scaling, pitch-EG pluck transient. Every voice can be
   strummed — **the strum engine is voice-agnostic**; strumming a bell
   works fine.
2. **Bring your own voices**: load your own `.syx` banks at runtime (DX7
   standard layout), strum them in the built-in engine first, then push to
   the device when satisfied; license-vetted external packs can go into
   `data/external/` (inclusion criteria in
   [`docs/voice-sources.md`](docs/voice-sources.md); packs missing licence
   fields are **refused** with a log line, never silently loaded).
3. **Bring your own samples (WAV/MP3)**: record one real guitar pluck (or
   any sound), drop it in — that's a whole sample guitar. Since v0.5 the
   preprocessing is **fully automatic**: silence trim → peak normalize →
   **root-note auto-detection** (normalized autocorrelation) →
   **sustain-loop detection** for sustained material (zero-crossing
   aligned, crossfaded wrap). Chord tones play via varispeed **clamped to
   ±24 semitones** (extreme-rate guard only), rendered through the same
   offline pipeline as FM voices — **envelope baked in, never hard-cut**.
   **Complex recordings (songs/harmonies) degrade gracefully**: when root
   confidence is low the page skips prefill and skips looping (no glitch
   repeats) and asks you to verify the root by ear. Strumming, rhythm
   loops, humanize and motor-strum all apply. Samples persist in browser
   IndexedDB and survive a refresh (private-browsing mode degrades
   gracefully to session-only, with a log line). **Samples drive local
   audition and MIDI out only — they cannot be pushed to a device** (an FM
   synth has no sample-transfer protocol). DSP and persistence live in
   `engine/sampler.js` (`FM1_SAMPLER`, pure functions, Node-testable).
4. **Any external MIDI synthesizer**: what goes out is a standard staggered
   Note On/Off stream — the FM-1 is simply the device with today's longest
   test checklist; Dexed, a Volca FM, a real DX7, anything with a MIDI IN
   becomes the voice.

## Hardware mapping (three steps on the real thing)

1. **One-time setup**: USB-C to the computer (not the 3.5mm TRS) → set
   **POLY** via EDIT → check MIDI channel = 1 under **GLO** → **turn ARP and
   SEQ off** (so they don't hijack incoming Notes).
2. **Make the device play your voice**: "push voice to device" sends all
   155 VCED parameters of the current voice as live single-parameter writes
   (`pushVoice` in `engine/params.js`) — effective immediately, no SAVE
   needed; hold **SAVE** on the device to keep it.
3. **Play**: the actions live on the page / computer keyboard / MIDI
   keyboard (table above). Be precise about the split: **the FM synth engine
   runs on the device — it is not a speaker.** The page does exactly one
   thing: turn strumming gestures into a staggered stream of MIDI notes fed
   to it. The device is the voice; the outside is the right hand.

## Five routes to standalone playing (no-flash → flash)

| Route | Computer-free? | Cost | Status |
|---|---|---|---|
| ① This page + computer brain | ✗ | zero | **this repo** |
| ② Phone + Bluetooth MIDI (responsive page; FM-1 has BLE; iOS Web MIDI limits stated honestly) | phone in pocket | tiny | adapted here |
| ③ Stock ARP/SEQ squeezed | ✓ | can't do strumming (ARP is monophonic, SEQ is hand-recorded) | built into the device |
| ④ Flash existing firmware (FoMni already strums natively; CTL-1 / ETCH turn the whole device into a USB MIDI controller; both GPL) | ✓ | becomes someone else's instrument | exists in the community |
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
  everything happens on the device itself). Custom firmware proves the
  hardware path exists — **CTL-1** (charlesvestal, updated 2026-10: white
  keys = chosen scale, black keys = chords, knobs send CC, its own GM
  sounds work with nothing connected; browser emulator + web installer)
  and **ETCH** V1.37+ (SikkenWorks: hold SEQ at power-on to boot into a
  MIDI KEYBOARD mode where all 27 keys send USB Note On/Off, F3–G5 with
  octave shift) — but that is post-flash behavior; **stock firmware**
  remains unverified.
- **No Program Change is sent**: PC support unverified, not assumed.

## Tests

```
node tools/dx7_test.mjs       # ① byte codec round-trip (22)
node tools/starter_test.mjs   # ② every bundled voice renders audible + guitar targets met (15)
node tools/param_test.mjs     # ③ 155-param table + pushVoice round-trip + SysEx anchor (26)
node tools/midi_test.mjs      # ④ transport + device sim (36)
node tools/strum_test.mjs     # ⑤ strum / humanize / rhythms / scheduler (141)
node tools/sampler_test.mjs   # ⑥ sample DSP pipeline: clamp/trim/root/loop/render (67)
node tools/smoke.mjs          # ⑦ page end-to-end, three scenarios (77, incl. samples)
```

All seven exit 0, **383 assertions**. Fresh `git clone` → run → green. The
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

- v0.5.1: **sample bugfixes** — complex recordings no longer trigger the
  sustain loop (glitch repeats), root detection marked unreliable on
  polyphonic material (no prefill), ±12 clamp that folded chord tones
  relaxed to ±24, attack fade skipped on hot-start samples
- v0.5: **sample voices matured** — fully automatic preprocessing
  (trim / normalize / root detection / sustain loop), playback moved to the
  unified offline-render pipeline (envelope baked in, cached), pitch shift
  clamped
- v0.4: **sample voices** — upload WAV/MP3 + root note, one sample
  becomes a whole sample guitar via varispeed; IndexedDB persistence; new
  `engine/sampler.js` (`FM1_SAMPLER`)
- v0.3.1: rhythm patterns rebuilt on the guitar arm-motion rule + repositioned
  as everything-as-guitar
- v0.3 (this repo): strum realism (spread default 90 ms → ~25 ms total window,
  up-stroke hits top 4 strings only, soft strums drop strings) + guitar voices
  rebuilt on the factory GUITAR 1 skeleton + preview engine now supports
  velocity→brightness and the pitch EG
- v0.2: VST-style strummer (gestures + loop + motor strum +
  humanize) + original guitar voices + push-to-device + MIDI keyboard input
  + external-pack pipeline
- v0.1: chord pads + strum + event mute + local audition + MIDI out
- next: hammer-on / pull-off / bend macros (device-level, like palm mute),
  hardware-test feedback folded back in
- later: a firmware route (JieLi AC791N, simulator-first) — separate decision

### Parking lot (ideas, unscheduled)

- **User-defined strum-pattern editor**: free arrangement of down/up/muted
  strokes and rests on a visual grid, exported as custom rhythm patterns for
  the loop. The five built-ins (folk/pop/punk/reggae/ballad) are just the
  arm-motion rule's starting point — rhythm itself shouldn't be capped by
  enumeration.
- **Guitar-shaped interface**: render the whole performance bench as a
  visible guitar — fretboard and six strings highlighting which string and
  position every strum event lands on; click and drag across the strings to
  play. Strumming stops being numbers and becomes something you can see.
- **fm1-firmware-dev agent skill, open-sourced**: turn the firmware line's
  working discipline into a publishable agent skill — toolchain wrapping
  (build/flash/debug as subcommands), three-environment labeling
  (simulator / host / hardware, never mixed), double brick-gate (verified
  recovery path + owner consent), differential-test discipline. No JieLi
  skill exists anywhere — the niche is empty. Others ship firmware; we ship
  the methodology of shipping it reliably.

You can also try Everything As Guitar in the browser, no flashing needed, in the free community [FM-1 Emulator](https://fm1-emulator.atst.tools/).
