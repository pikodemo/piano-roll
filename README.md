# piano-roll

Browser-based piano roll for sketching musical arrangements, with a
Claude-powered side chat (stage 2) that can read and rewrite your roll on
request.

Stage 1 ships the standalone piano roll. Stage 2 ships the Claude agent —
the chat panel sees the project, has the same tool surface as the user
(add/move/delete notes, harmonize, stack chords, change voices, set scale,
…), and edits the roll in real time. See `STAGE2_AI.md` for the design.

## Run it locally

```sh
npm install
cp .env.local.example .env.local   # then fill in ANTHROPIC_API_KEY for stage 2
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint         # eslint
node scripts/smoke.mjs   # headless playwright smoke test (needs `npm run dev`)
```

Stage 1 (the piano roll) works without `ANTHROPIC_API_KEY`. Stage 2 (the
chat agent) needs it — when missing, the chat panel surfaces a helpful
error instead of a generic failure.

## Quick tour

- The **toolbar** has a tool toggle: **✎ Draw** (B) is the default — click in
  the grid to add a note. Switch to **⬚ Select** (V) when you just want to
  pick notes: click-drag is now a marquee, no Shift needed.
- In Draw mode a faint **dashed ghost** follows the pointer to show exactly
  where the next note will land — useful because notes are wider than the
  snap unit.
- **Click + drag** an existing note to move it; the right edge resizes.
- **Shift-drag** on empty grid always marquees (additive — preserves the
  current selection); **Shift-click** on a note toggles it in/out.
- **Backspace** removes the selection. **↑/↓** transposes by a semitone
  (Shift = octave). **←/→** nudges by the snap value.
- **Space** plays / stops. Tempo, bar count, snap, and a working scale live in
  the toolbar.
- Add a **voice** (track) from the Voices row; the active voice is what new
  notes go into. Each voice has its own **instrument** (Triangle / Sine /
  Saw / Square / Pluck / Bass / Pad / Bell), mute, solo, and delete.
- Select a single note to open the **chord cycler**: `[` / `]` cycles through
  every chord that contains the note (major / minor / 7th / sus / inversions);
  **Enter** commits the chord. The previewed chord is auditioned through the
  synth.
- Select one or more notes and use **Harmonize** to add a voice a 3rd / 5th /
  6th / octave above or below — snapped to the working scale if one is set.
- With 2+ notes selected, **Stack chord** adds chord tones above each selected
  note (treating it as the chord root). Choose a quality — maj / min / 7 /
  maj7 / m7 / sus4 / dim — or `diatonic` to use the diatonic triad rooted on
  each note when a scale is set.
- Hovering any chord/harmonize button shows a **dashed ghost preview** of
  the notes that would be added.
- The chord cycler shows ghost notes for the chord currently in view.
- **Move to** lets you reassign the selected notes to a different voice with
  one click.
- A red **Delete** button appears in the inspector when notes are selected
  (Backspace works too).
- The **Projects** menu in the toolbar lists every saved project, lets you
  create new ones, switch between them, and delete the ones you don't need.
  Rename via the name field on the right side of the toolbar.
- **Voices** have a volume slider, instrument dropdown, M/S buttons, and a
  double-clickable name (Enter saves, Escape cancels).
- A connected **MIDI keyboard** auto-attaches; pressing keys plays preview
  through the active voice's instrument. The toolbar shows the device name.
- The **Rec** button records audio from your microphone, runs a pitch
  detector, and adds the resulting notes to the active voice (anchored at
  the playhead, snapped to the grid). Sing a melody, click Stop, the notes
  appear.
- The **History** bar (above the inspector) is a Git-like timeline of every
  edit. Each step is named (Add note, Transpose +12, Set scale, etc.) and
  the slider scrubs through the past — the roll updates live as you drag.
  Editing while scrubbed back creates a new branch automatically; the
  previous tip is preserved as a switchable branch button. Undo / redo go
  through the same tree.
- The **Export** button in the toolbar opens a modal that converts the
  selected voices (or just the selected notes) to **MusicXML** (universal
  sheet music — open in MuseScore et al. for printing/PDF), **ASCII
  guitar tab** (six-string standard tuning), or **Jianpu** (numbered
  notation, reads the project's working scale). Preview pane shows the
  output; Copy or Download.

Everything is auto-saved to IndexedDB.

## Docs

- [`SPEC.md`](SPEC.md) — what the product does
- [`PLAN.md`](PLAN.md) — staged delivery plan
- [`STAGE2_AI.md`](STAGE2_AI.md) — design for the chat agent (next stage)
- [`IMPLEMENTATION.md`](IMPLEMENTATION.md) — engineering notes for stage 1
- [`FUTURE.md`](FUTURE.md) — deferred features and refinements

## Stack

Next.js 16 (app router) · React 19 · TypeScript · Tailwind v4 · Zustand · idb ·
Web Audio · Playwright (smoke). Deployed on Vercel.
