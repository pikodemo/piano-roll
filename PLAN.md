# Plan

Two stages. Stage 1 is the standalone piano roll — fully usable on its own.
Stage 2 wires the chat agent into the same data model.

## Stage 1 — Piano roll (this PR)

1. **Project scaffold** — Next.js 15 (app router) + TS + Tailwind. Strict mode.
   Single page route `/`, with the layout sketched in `SPEC.md`.
2. **Music-theory module** (`lib/music.ts`) — pure functions:
   - `midiToName`, `nameToMidi`, `pitchClass`, `noteName`.
   - `SCALES` (major, minor, dorian, mixolydian, ...) and helpers to ask "is
     pitch X in scale Y rooted at Z".
   - `CHORD_QUALITIES` (maj/min/dim/aug/sus2/sus4/maj7/min7/dom7/dim7/m7b5).
   - `chordsContaining(midi)` — returns all (root × quality × inversion) chords
     whose pitch classes include the given pitch.
   - `harmonizeAt(midi, interval, scale?)` — for the snap-to-interval helper.
3. **State store** (`lib/store.ts`, Zustand) — single source of truth:
   - `project: Project` (notes, voices, tempo, scale, view).
   - Mutations: `addNote / updateNote / deleteNotes / setTempo / addVoice / ...`.
   - Selection state: `selectedIds`, `activeVoiceId`.
   - Undo/redo via a small ring of past project snapshots.
4. **Persistence** (`lib/storage.ts`) — `idb` wrapper. Object store `projects`.
   Subscribe to the store, debounce 250ms, write the whole project doc. Load on
   app boot; create a default project if none exists.
5. **Piano roll component** (`components/PianoRoll.tsx`) — SVG-based grid:
   - Renders pitch lanes + bar/beat grid + notes.
   - Pointer handlers for draw / move / resize / select.
   - Zoom (vertical and horizontal) + scroll. Sticky pitch keyboard on the left
     and time ruler on top.
6. **Inspector** (`components/Inspector.tsx`):
   - Note details (pitch, start, length, voice).
   - **Snap-to-interval** buttons.
   - **Chord cycler** when exactly one note is selected.
7. **Audio** (`lib/audio.ts`) — Web Audio synth + scheduler:
   - On play, schedule note-on/off events using `AudioContext.currentTime`.
   - Stop kills all in-flight gains.
   - Used both by the transport (Play) and the chord previewer.
8. **Chat panel placeholder** (`components/ChatPanel.tsx`) — fixed layout slot
   with model picker (no network calls yet) and a "stage 2" notice. Keeps the
   layout honest so we don't have to redo it later.
9. **Smoke tests** — Playwright run against `next dev`:
   - Page loads, piano roll renders.
   - Click adds a note; Backspace removes it; Space toggles transport label.
   - Chord cycler renders for a single selection.
   - IndexedDB write happens (verified via `evaluate`).
10. **Docs + commit cadence** — commit after each numbered step. Document any
    deviation from this plan inline in `PLAN.md`.

## Stage 2 — Agent (separate PR)

See `STAGE2_AI.md` for the design. Summary:

- Add an `/api/chat` route that streams from the Claude API using the official
  SDK. Model ID is sent by the client (picker in the UI).
- Define a typed tool surface mirroring the store mutations:
  `read_project`, `add_notes`, `update_notes`, `delete_notes`, `transpose`,
  `set_voice`, `replace_region`. Each tool is a thin wrapper around the same
  store mutation used by the UI, so undo/redo and persistence keep working.
- Server validates and executes tool calls against an in-memory snapshot the
  client sent; replies with a patch the client applies through the store. This
  keeps the server stateless and the canonical state in the browser.
- API key is server-side only (`ANTHROPIC_API_KEY` env var on Vercel). The
  client never sees it.

## Out of scope for stage 1

- MIDI export, audio export, swing, automation, plug-ins.
- Account / cloud sync.
