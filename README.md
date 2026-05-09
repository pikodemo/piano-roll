# piano-roll

Browser-based piano roll for sketching musical arrangements, with a
Claude-powered side chat (stage 2) that can read and rewrite your roll on
request.

Stage 1 (this PR) ships the standalone piano roll. The chat panel is present
but disabled until stage 2.

## Run it locally

```sh
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint         # eslint
node scripts/smoke.mjs   # headless playwright smoke test (needs `npm run dev`)
```

## Quick tour

- **Click** in the grid to draw a note; **drag** to extend it.
- **Click + drag** an existing note to move it; the right edge resizes.
- **Shift-drag** on empty grid is marquee-select; **Shift-click** on a note
  toggles it in/out of the selection.
- **Backspace** removes the selection. **↑/↓** transposes by a semitone
  (Shift = octave). **←/→** nudges by the snap value.
- **Space** plays / stops. Tempo, bar count, snap, and a working scale live in
  the toolbar.
- Add a **voice** (track) from the Voices row; the active voice is what new
  notes go into. Mute / solo / delete per voice.
- Select a single note to open the **chord cycler**: `[` / `]` cycles through
  every chord that contains the note (major / minor / 7th / sus / inversions);
  **Enter** commits the chord. The previewed chord is auditioned through the
  synth.
- Select one or more notes and use **Harmonize** to add a voice a 3rd / 5th /
  6th / octave above or below — snapped to the working scale if one is set.

Everything is auto-saved to IndexedDB.

## Docs

- [`SPEC.md`](SPEC.md) — what the product does
- [`PLAN.md`](PLAN.md) — staged delivery plan
- [`STAGE2_AI.md`](STAGE2_AI.md) — design for the chat agent (next stage)
- [`IMPLEMENTATION.md`](IMPLEMENTATION.md) — engineering notes for stage 1

## Stack

Next.js 16 (app router) · React 19 · TypeScript · Tailwind v4 · Zustand · idb ·
Web Audio · Playwright (smoke). Deployed on Vercel.
