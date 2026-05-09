# Stage 2 — AI agent integration (shipped)

The agent feels like a collaborator that can see the roll and edit it. This
document is the as-built design — read alongside `IMPLEMENTATION.md`.

## Setup

Create `.env.local` with your key (see `.env.local.example`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Restart `next dev`. On Vercel, set the same env var on the project.

## Architecture

```
 Browser                                   Server (Next.js route)
┌──────────────────────┐                  ┌────────────────────────┐
│ Chat UI ──┐          │                  │ /api/chat              │
│           │          │   POST /api/chat │ • Anthropic SDK        │
│ Store ────┼──snapshot┼─────────────────▶│ • In-memory snapshot   │
│           │ + history│                  │ • Manual agent loop    │
│           │          │                  │   (tool_use round-trip)│
│           ◀───NDJSON─┼──────────────────┤ • z.toJSONSchema()     │
│           │  events  │                  │   for tool schemas     │
│ Apply ◀───┘          │                  └────────────────────────┘
│ patches              │
└──────────────────────┘
```

- The browser is the source of truth. Each turn sends `{ model, messages, project }`.
- The server snapshot starts as a clone of the browser's project. Each tool
  call mutates the snapshot in place; the new snapshot is streamed back as a
  `patch` event so the user sees changes appear live.
- The system prompt + tool definitions are stable and use `cache_control`
  for prompt caching; the volatile project state is included in the latest
  user turn (cache miss expected for that block).

## Tools

Pure functions in `src/lib/agent-tools.ts`. Mirrors the user-facing operations
1:1:

| Tool | Effect |
|---|---|
| `read_project` | Re-read full project (notes, voices, tempo, scale, …). |
| `add_notes` | Append notes to a voice. |
| `update_notes` | Patch existing notes by id (pitch / start / length / velocity / voice). |
| `delete_notes` | Remove notes. |
| `transpose` | Shift notes (or all notes) by N semitones. |
| `move_notes_to_voice` | Reassign notes to a different voice. |
| `add_voice` | Create a new voice (name / color / instrument). |
| `update_voice` | Rename, recolor, change instrument, mute, solo. |
| `delete_voice` | Delete voice + its notes (refuses to drop the last voice). |
| `set_tempo` / `set_bars` | Project length & tempo. |
| `set_scale` | Working scale (tonic + mode), or clear. |
| `harmonize_notes` | Add a parallel voice at a chromatic interval (snaps to scale when set). |
| `stack_chord` | Stack chord tones above each given note (`maj`/`min`/`7`/…/`diatonic`). |
| `add_chord` | Place a single chord directly with a target near-pitch and voicing. |
| `select_notes` | Highlight notes in the user's UI (visual feedback). |

Tool inputs are validated by Zod schemas (`ToolSchemas`); the route converts
them to JSON Schema with `z.toJSONSchema()` for the Anthropic SDK.

## Streaming protocol

NDJSON over `application/x-ndjson`. One event per line:

```
{"type":"text","delta":"Sure, transposing..."}
{"type":"thinking","delta":"..."}                  // adaptive thinking summary (when enabled)
{"type":"tool","name":"transpose","input":{...},"id":"toolu_..."}
{"type":"patch","project":{...}}                   // updated project after the tool ran
{"type":"selection","ids":[...]}                   // when select_notes was called
{"type":"tool_result","name":"transpose","id":"toolu_...","result":"Transposed 8 notes by -12 semitones."}
{"type":"text","delta":"Done."}
{"type":"done","stop_reason":"end_turn"}
{"type":"error","message":"..."}                   // unrecoverable
```

The client applies `patch` events to the store via `applyAgentPatch(project)`
— same persistence pipeline as user edits, but bypasses undo's per-edit
snapshots. One undo-snapshot is captured at the start of the agent turn via
`beginAgentTurn()`, so a single Cmd-Z undoes the whole turn.

## Model selection

Dropdown in the chat panel:

- **Claude Opus 4.7** — `claude-opus-4-7` (default, best for arrangement reasoning)
- **Claude Sonnet 4.6** — `claude-sonnet-4-6`
- **Claude Haiku 4.5** — `claude-haiku-4-5`

The chosen ID is sent verbatim in the request body. Adaptive thinking
(`thinking: { type: "adaptive" }`) is on; sampling parameters are not used —
Opus 4.7 doesn't accept them anyway.

## System prompt

`SYSTEM_PROMPT` in `src/app/api/chat/route.ts`. Contents:

- Schema description (pitch = MIDI integer, time in beats, voice schema, instruments).
- Available scale modes + chord qualities + harmony intervals (the same
  vocabulary as the UI buttons).
- Working principles ("prefer update_notes over delete + add", "set_scale
  first if the user asks for diatonic chords", etc.).

Cached via `cache_control: { type: "ephemeral" }` so multi-turn chat reuses
the prefix.

## Agent loop

Manual loop in the route handler (not the SDK's tool runner) so we can stream
a `patch` event after each tool execution while the model is still talking.
Capped at 8 turns per request to bound runaway loops; `pause_turn` (server-side
tool budget) is handled by re-issuing.

## Auth / secrets

- `ANTHROPIC_API_KEY` is server-side only. The route reads it from
  `process.env`; if missing, returns a structured 500 with a friendly message
  the chat panel surfaces in red.
- The browser never sees the key.

## Limitations / future work

- No abort: clicking "Send" again while the agent is mid-turn isn't supported
  — UI disables the input until the turn finishes. An AbortController hook is
  a small follow-up.
- No chat persistence: messages live in the Zustand store only. Surviving a
  reload would mean adding a `messages` field to `Project` (or a new IDB store).
- Token usage isn't surfaced. The SDK returns it in `finalMessage().usage`; we
  could stream a usage event after each turn for cost visibility.

## Testing

- `scripts/smoke.mjs` covers the chat panel UI end-to-end: sends a message,
  verifies the missing-`ANTHROPIC_API_KEY` error surfaces correctly. The
  expected 500 from `/api/chat` is filtered out of the page-error tracker so
  the rest of the test suite still runs clean.
- For real-key testing, set the env var and chat with the agent in dev:
  "transpose everything down an octave" and "add a bass voice" are good first
  prompts.
