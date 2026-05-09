# Implementation notes — Stage 1

This is the engineering log for the piano-roll codebase. Stage-2 (the chat
agent) is described in `STAGE2_AI.md`; everything below is what shipped in the
stage-1 PR.

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

Pointer interactions are all on the grid SVG and dispatch by inspecting the
event target's `data-note-id`:

- empty + click → create note (snapped) and start a "create" drag that resizes
  while the pointer is held;
- note + click → select; drag near the right edge resizes, otherwise moves all
  selected notes;
- shift + drag on empty → marquee-select.

Pointer capture is requested on the grid SVG so a fast-moving pointer doesn't
escape mid-drag.

## Chord cycler

`chordsContaining(midi)` enumerates every (root × quality × inversion) chord
whose pitch classes include the selected note. The Inspector cycles through the
list with `[` / `]` and previews each one through the synth. `Enter` (or the
"Add chord" button) commits the chord by inserting the missing chord tones at
the same start/length as the selected note.

The cycler is its own subcomponent and gets a `key={note.id}` from the parent
so it remounts (and resets local state) when the selection changes — cleaner
than firing a `setState` from a `useEffect`.

## Harmonize

The harmonize buttons add a single new note at a given chromatic interval
above/below each selected note. If a project scale is set,
`snapToScale(midi, semitones, scale)` nudges the new pitch to the nearest
in-scale neighbor (within ±2 semitones) so a "min3 ↑" on a B in A-minor lands
on D, not on C#.

## Audio

Plain Web Audio: a triangle oscillator + a small linear-ramp envelope per
note, summed straight to `destination`. `scheduleNotes` schedules every event
ahead of time using `AudioContext.currentTime`, returns a stop function, and
runs a `requestAnimationFrame` loop to update the playhead beat in the store.
Cheap, no library needed, good enough to audition arrangements.

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
