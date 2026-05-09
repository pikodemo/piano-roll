# Future improvements

A running list of features and refinements we've discussed but deferred.
Order is roughly priority, not commitment.

## History storage

- **Operational transforms + keyframes.** Today every `HistoryStep` carries a
  full `HistorySnapshot`. That's simple and lets us scrub instantly, but the
  IDB document grows linearly with edits — a long session can easily push
  past 1 MB. Instead, store the *operation* (e.g. `addNotes`, `updateNotes`,
  `transpose`) plus its parameters, and reconstruct any past state by
  replaying ops from the nearest keyframe. Keep periodic full snapshots as
  keyframes (every N steps, or on agent turns / user-named checkpoints) so
  scrubbing stays fast — the slider never has to replay more than a
  bounded number of ops to render a position.
  - Operations are already modeled (the store mutations + agent-tools.ts
    inputs), so the data format is mostly there.
  - Keyframe interval is a tunable knob: more keyframes = faster scrub,
    larger storage; fewer = slower scrub, smaller storage.
  - Agent turns naturally make good keyframes (one per turn).
- **History pruning.** Cap the tree at N steps; drop the oldest leaf branches
  first (so the *current* path is preserved as long as possible).
- **Named checkpoints.** A button to mark the current state as a save point
  with a custom label ("v1", "before chorus rewrite"). Treated as keyframes
  for OT replay and pinned in the UI for quick navigation.
- **Tree visualization.** Show the full branch tree, not just the linear
  current path. Useful when the project has branched several times.
- **Selective undo.** "Undo just this past edit" — extract a single
  operation from history and apply its inverse, leaving everything since
  intact. Mostly relevant once we're on OT-based storage.
- **Project-level "save as new" branch.** A way to fork the entire project
  including its history (vs. creating a new branch in the same project).

## Editing

- **Quantize button** for selected notes (snap each note's start to the grid).
- **Humanize:** small randomized offsets on start/velocity for selected notes.
- **Copy / paste / duplicate** selected notes.
- **Per-note velocity editing** (the data model already carries velocity;
  the UI just doesn't expose it yet).
- **Time signature changes** mid-piece, swing, tempo automation.

## Audio & MIDI

- **MIDI file import / export.** Standard `.mid` files, round-trippable.
- **Audio file export** (rendering the synth playback to WAV / MP3).
- **Sample-based instruments** in addition to the synthesized ones (richer
  acoustic timbres — piano, strings, etc.).
- **MIDI keyboard live recording** — currently MIDI input only previews;
  add a "record from MIDI" mode that captures notes at the playhead while
  the project is playing.
- **Polyphonic pitch detection** for the microphone path (today's
  autocorrelation handles single voice only).
- **Improved monophonic pitch detection** — YIN or pYIN would be more
  robust than autocorrelation, especially for vocals with vibrato.
- **Audio reference track:** load an MP3 / WAV to play alongside the synth
  for transcription / arrangement work.

## Export

- **PDF export of the rendered sheet music** (currently MusicXML; users
  open in MuseScore et al. to print).
- **Inline rendered preview** of sheet music in the export modal (Vexflow
  or similar).
- **Higher-fidelity Jianpu** with proper underlines for sub-quarter
  rhythms and pitch-class / octave dot diacritics.
- **Lead sheet mode** — chord symbols above a melody line.
- **Multi-voice tab:** today the tab export collapses voices into one
  staff; show separate tab staves per voice.

## Collaboration & sharing

- **Project export / import** as a single JSON (incl. history).
- **Share-by-link** via short hosted JSON.
- **Multi-user real-time collaboration** (likely Yjs or a custom CRDT;
  the OT-based history above is half the work).

## UI / UX

- **Mobile / touch support.** The piano roll uses pointer events but the
  layout assumes a wide screen and a precise pointer.
- **Customizable theme.** Light mode, color customization.
- **Keyboard shortcut customization.**
- **Larger zoom range** for the piano roll grid.
- **Per-voice inspector** — click a voice to edit its full configuration
  (volume curve, ADSR overrides, FX) in a dedicated pane.

## Agent / chat

- **Streaming UI for tool inputs** — show partial JSON as the model is
  still generating it (today we wait for the full block).
- **Abort an in-flight turn** (cancel button + AbortController).
- **Persisted chat history** — currently messages live in memory only.
- **Tool: humanize** — agent can humanize a passage on request.
- **Style presets** — system-prompt addenda the agent applies on top of
  the base prompt ("classical-romantic", "lo-fi hip-hop", "bossa nova").

## Reliability

- **Smoke test against a real Anthropic key** in CI (gated).
- **Storage migrations test suite.** As we add fields to `Project`, every
  migration needs to be exercised against fixture old-format projects.
