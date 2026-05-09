# Piano Roll — Spec

A browser-based piano roll for exploring musical arrangements, paired with a chat
agent that can read and modify the roll on your behalf.

## Goals

- Sketch a melody fast.
- Layer additional voices that snap to musically useful intervals.
- Audition chord ideas around a selected note (cycle through major / minor / 7th /
  sus / inversions, etc.) and commit one with a single keystroke.
- Talk to an AI agent that understands the current arrangement and can rewrite it
  on request: "transpose down an octave", "add a bass voice using the diatonic
  chords of A minor", "voice-lead this in the style of late-Romantic chamber
  music", etc.
- Everything stays local: notes are persisted in IndexedDB.

## Non-goals (for now)

- DAW-grade automation, MIDI device I/O, or VST plugins.
- Multi-user editing.
- Audio rendering / export to WAV. (MIDI export is a stretch goal.)

## User-facing surface

### Layout

```
┌────────────────────────────────────────────────┬──────────────────────┐
│  Toolbar  (transport · tempo · grid · voices)  │                      │
├────────────────────────────────────────────────┤   Chat panel         │
│                                                │   (model picker,     │
│             Piano roll grid                    │    messages, input)  │
│                                                │                      │
│                                                │                      │
├────────────────────────────────────────────────┤                      │
│  Inspector (selected note · chord cycler)      │                      │
└────────────────────────────────────────────────┴──────────────────────┘
```

### Piano roll

- Vertical axis: pitch (MIDI 21–108 by default, scroll/zoom).
- Horizontal axis: time, in beats. Default 16 bars of 4/4, expandable.
- Grid snapping configurable (1, 1/2, 1/4, 1/8, 1/16, triplets).
- Notes belong to **voices** (tracks). Each voice has a name, color, and mute/solo.
- Click empty space to draw a note at the current default duration.
- Drag a note to move (snaps); drag the right edge to resize; delete with Backspace.
- Multi-select with shift-click and rectangle drag.
- Transport: play / stop / loop region; tempo (BPM) input; metronome toggle.
- Playhead scrolls with playback.

### Voice / interval helpers

When one or more notes are selected:

- **Snap to interval** menu offers harmonizations a 3rd, 4th, 5th, 6th, octave
  above/below the selection — clicking adds those notes to the active voice.
- The intervals can be chromatic or scale-relative (when a scale is set).

### Chord cycler

When a single note is selected:

- Inspector shows a list of chords that contain that pitch class:
  major, minor, dom7, maj7, min7, sus2, sus4, dim, aug, plus the inversions of
  each.
- Arrow keys cycle the preview; Enter commits the chord to the active voice at
  the selected beat. Each preview also plays through the synth.

### Audio

- Web Audio synth (basic sine/triangle with ADSR envelope) per voice. Good
  enough to audition arrangements; not a sound design tool.

### Persistence

- The app keeps a list of **projects** in IndexedDB. Each project stores:
  notes, voices, tempo, time signature, scale, view state.
- Auto-saves on every change (debounced). New / Open / Rename / Delete in a
  project picker.

### Chat panel (stage 2)

- Picks a Claude model (Opus, Sonnet, Haiku — IDs from runtime config).
- Streams responses.
- Has tools that read and mutate the project state. See `STAGE2_AI.md`.

## Keyboard shortcuts (initial)

- `Space` — play / stop
- `Backspace` — delete selected
- `Cmd/Ctrl-Z` / `Shift-Cmd/Ctrl-Z` — undo / redo
- `←` / `→` — nudge selection by grid
- `↑` / `↓` — transpose selection by semitone (`Shift` for octave)
- `[` / `]` — cycle chord preview (when one note is selected)
- `Enter` — commit chord preview

## Tech

- Next.js 15 (app router) + React 19 + TypeScript.
- Tailwind for layout/styling.
- Web Audio API (no Tone.js, to keep the bundle small).
- `idb` (tiny wrapper) for IndexedDB.
- Zustand for client state.
- Deployed to Vercel.
