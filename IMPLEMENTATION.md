# Implementation notes

Engineering log for the piano-roll codebase. Stage 1 (the standalone piano
roll) is documented below. Stage 2 (the Claude agent) lives in `STAGE2_AI.md`
— the short version is: `src/lib/agent-tools.ts` defines the same operations
the user has in the UI as pure functions on a Project; `src/app/api/chat/route.ts`
runs a manual streaming agent loop with the Anthropic SDK, validates tool
inputs with Zod, and streams NDJSON events back to the client. The chat panel
applies project patches live as the agent works.

## Layout

```
src/
  app/
    layout.tsx          // root layout, html lang/title
    page.tsx            // <AppShell />
    globals.css         // tailwind + dark canvas
  components/
    AppShell.tsx        // boots project from idb, wires the panes together
    Toolbar.tsx         // transport, tempo, bars, snap, scale, undo/redo
    ProjectsMenu.tsx    // dropdown: list / new / switch / delete projects
    VoiceList.tsx       // active voice picker, mute/solo, add/remove
    PianoRoll.tsx       // grid + sticky keyboard + sticky ruler
    Keyboard.tsx        // 12-tone keyboard column (preview-on-click)
    TimeRuler.tsx       // bar-numbered ruler
    Inspector.tsx       // selected-note details, chord cycler, harmonize, delete
    ChatPanel.tsx       // stage-2 placeholder w/ model picker
  lib/
    music.ts            // pitch/scale/chord helpers (pure)
    types.ts            // Note / Voice / Project shape
    store.ts            // zustand store w/ undo/redo + debounced save
    storage.ts          // idb wrapper, single object store `projects`
    audio.ts            // Web Audio synth + scheduler
scripts/
  smoke.mjs             // headless playwright smoke test
  screenshot.mjs        // dev screenshot
```

## Data model

A `Project` is the unit of persistence. It stores notes (flat array, each note
has a `voiceId`), voices (id/name/color/muted/soloed), tempo, bars, optional
working scale, and view settings (snap, zoom, pitch range). One project at a
time is loaded into the Zustand store; mutations bump `updatedAt`, push the
prior snapshot onto the undo stack, and trigger a 250ms-debounced write to
IndexedDB.

Notes are MIDI integers 0–127. Time is in **beats** (one quarter note) — the
scheduler converts to seconds at playback time.

## Piano roll rendering

Single SVG, sized to the full project (`bars * beatsPerBar * pixelsPerBeat`
wide × `(maxPitch - minPitch + 1) * rowHeight` tall). The keyboard column and
the time ruler live in their own panes; scroll is synced via a scroll handler
so the ruler tracks horizontal scroll and the keyboard tracks vertical scroll.

Pointer interactions are all on the grid SVG. The active **tool** (`select` or
`draw`, stored in Zustand) decides what happens on empty-grid clicks:

- **Draw mode**, click on empty grid → create note (snapped, default 1-beat
  length) and start a "create" drag that resizes while the pointer is held.
- **Draw mode**, idle pointer over empty grid → render a dashed blue ghost at
  the snapped target position, so the user can see where their next click will
  land. Cleared on pointer-leave or while dragging.
- **Select mode**, click on empty grid → start a marquee. Selection updates
  live as the rectangle sweeps; shift makes the marquee additive (preserves
  the prior selection).
- **Draw mode + Shift** on empty → also marquee (additive).

Note clicks behave the same in both modes:
- click → select that note (or replace selection); drag → move all selected
  notes; drag the right 6 px → resize.
- shift-click → toggle the note in/out of the selection without starting a
  drag.

Pointer capture is requested on the grid SVG so a fast-moving pointer doesn't
escape mid-drag.

## Chord cycler

`chordsContaining(midi, { scale })` enumerates every (root × quality) chord
whose pitch classes include the selected note. Results are sorted simplest
first via `chordSimplicityScore`:

1. Diatonic-to-the-project-scale chords win a heavy bonus.
2. Then triads before 7ths (count of chord tones).
3. Then quality preference: maj/min < 7th-family < sus < dim/aug < exotic.
4. Tie-broken by pinned-note position: chord-as-root, then 3rd, 5th, 7th, etc.

The voicing is computed by `chordVoicingContaining(chord, pinMidi)`, which
pins the selected note at its actual MIDI value and clusters the other chord
tones within ±6 semitones of the pin. So picking `F maj` while `C4` is
selected produces `A3 C4 F4` (an Fmaj/A voicing) rather than the
chord-floating-above-the-pin layout the unpinned voicer would have given.

Inversions are no longer enumerated as separate cycler entries — different
chords already produce different voicings around the pin, so the duplicates
were noise rather than signal.

The cycler is its own subcomponent and gets a `key={note.id}` from the parent
so it remounts (and resets local state) when the selection changes.

## Harmonize

The harmonize buttons add a single new note at a given chromatic interval
above/below each selected note. If a project scale is set,
`snapToScale(midi, semitones, scale)` nudges the new pitch to the nearest
in-scale neighbor (within ±2 semitones) so a "min3 ↑" on a B in A-minor lands
on D, not on C#.

## Stack chord (multi-select)

When 2+ notes are selected, the inspector shows a **Stack chord** row. Each
button (`maj`, `m`, `7`, `maj7`, `m7`, `sus4`, `dim`, plus `diatonic` if a
scale is set) treats every selected note as a root and adds the chord-tones
*above* it at the same start/length. `diatonic` resolves to the actual
diatonic triad rooted at that scale degree (e.g. on the 4th degree of D
major, the button adds G + B above the existing G — i.e. nothing new on the
root, the major-3rd, and the perfect-5th of G major).

## Ghost-note preview

`previewNotes: PreviewNote[]` lives on the store as transient (non-persisted)
state. The piano roll renders them as dashed low-opacity rectangles. Inspector
buttons set the preview on `pointerenter` and clear it on `pointerleave`
(via the `useHoverPreview` helper). The single-note chord cycler keeps the
preview live for the chord currently selected in the cycler (so `[` and `]`
are visualized immediately even without hovering).

## Move to voice

`moveSelectedToVoice(voiceId)` reassigns every selected note's `voiceId` and
goes through the standard `mutate` path — meaning undo, autosave, and the
voice-color render all update naturally. The Inspector exposes a "Move to"
row of voice chips when 1+ notes are selected and the project has 2+ voices.

## Audio

Plain Web Audio: each voice picks an `InstrumentId` (default `triangle`).
Synthesis is hand-rolled per instrument:

- `triangle` / `sine` / `saw` / `square` — single oscillator + linear ADSR.
- `pluck` — triangle through a low-pass, exponential decay, no sustain
  (decay length is independent of the note duration so short notes still ring).
- `bass` — square wave one octave down, low-pass-filtered for fatness.
- `pad` — four detuned saws + lowpass + slow attack/release; attack is
  capped at 0.3s but never longer than half the note duration.
- `bell` — sine carrier FM-modulated by a sine at a 3:1 ratio, exponential
  decay (1s minimum so it actually rings).

`playNote(midi, dur, { instrument, velocity })` triggers a one-shot voice;
`scheduleNotes(events, bpm, …)` schedules a list of (`midi`, `startBeat`,
`lengthBeat`, `instrument`, `velocity`) events using
`AudioContext.currentTime` and runs a `requestAnimationFrame` loop to update
the playhead beat in the store.

Voices carry their own instrument, so transport playback dispatches per-note:
the events fed to `scheduleNotes` look up `voice.instrument` for each note.
The keyboard preview, the note-creation click, the chord-cycler audition,
the harmonize/stack-chord button feedback, and the move-feedback all use the
*active* voice's instrument so the user hears what they're about to commit.

## Persistence

`idb` wraps IndexedDB. One object store, `projects`, keyed by `id`. The store
calls `saveProject(project)` on every mutation, debounced to 250ms. On boot
the AppShell loads the most recently updated project, falling back to a fresh
default if none exists.

## Projects menu

A dropdown in the toolbar lists every project saved in IndexedDB. Each row
opens (loads) the project and has an `×` to delete it. "New project" creates
an empty one with a timestamped name and switches to it. Deleting the current
project switches to the most-recent remaining one (or creates a fresh one if
the list is now empty), so the editor is never left without a project.

Rename is via the project name input on the right side of the toolbar — typing
saves immediately through the same debounced auto-save pipeline.

## What's intentionally simple right now

- No MIDI export, no audio export.
- No swing, no per-note velocity editing UI (velocity exists in the model).
- No copy/paste yet.
- No tempo automation, no time-signature changes mid-piece.

These are intentionally deferred — the data model can carry them, the UI just
doesn't expose them.

## Tests

`scripts/smoke.mjs` boots Chromium against a running `next dev`, walks through
the core flow:

- page loads past the loading state;
- toolbar + voice list render;
- click in grid creates a note;
- second click creates another;
- backspace removes the selected note;
- selecting a single note shows the chord cycler;
- `]`, `]`, Enter cycles two chords forward and commits — note count grows;
- Space toggles transport label between Play / Stop;
- IndexedDB `piano-roll` database exists.

Run it with `node scripts/smoke.mjs`. Production build is checked with
`npm run build`; lint with `npm run lint`.

## Deploying to Vercel

Stock Next.js project — no special config. Push to GitHub, import the repo on
Vercel, accept defaults. Stage 2 will add `ANTHROPIC_API_KEY` as a server
env var.
