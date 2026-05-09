# Stage 2 — AI agent integration

The agent should feel like a collaborator that can see the roll and edit it.
This document is the design we'll build against in stage 2.

## Architecture

```
 Browser                                   Vercel server
┌──────────────────────┐                  ┌────────────────────────┐
│ Chat UI ──┐          │                  │                        │
│           │          │   POST /api/chat │  Anthropic SDK         │
│ Store ────┼──snapshot┼─────────────────▶│  (streaming, tools)    │
│           │          │                  │                        │
│           ◀───stream─┼──────────────────┤                        │
│           │  text +  │                  │                        │
│           │  tool    │                  │                        │
│           │  results │                  │                        │
│ Apply ◀───┘          │                  └────────────────────────┘
│ patches              │
└──────────────────────┘
```

- The browser is the source of truth. On each turn it sends the current
  project snapshot + chat history + chosen model.
- The server runs a tool loop with the Anthropic SDK. Tool calls are evaluated
  against the snapshot it received; the resulting **patches** are streamed back.
- The browser applies patches through the same Zustand mutations the UI uses,
  so undo/redo and IndexedDB persistence work identically.

## Tools

Each tool is a JSON-schema'd function the model can call.

| Tool | Inputs | Effect |
|------|--------|--------|
| `read_project` | — | Returns the current project snapshot. (Free no-op; the server already has it but exposing it lets the model "look again" after edits.) |
| `add_notes` | `notes: Note[]`, `voiceId?` | Appends notes. Returns the IDs assigned. |
| `update_notes` | `updates: {id, ...partial}[]` | Patch-update notes. |
| `delete_notes` | `ids: string[]` | Remove notes. |
| `transpose` | `ids: string[]` (or `all: true`), `semitones: number` | Convenience wrapper. |
| `set_voice_meta` | `voiceId, name?, color?, muted?` | Edit voice metadata. |
| `add_voice` | `name, color` | New voice. Returns id. |
| `set_tempo` | `bpm` | Change tempo. |
| `set_scale` | `tonic, mode` | Records the scale on the project (used by harmonization tools and the model). |

All tools return either the patch they applied or an error string. The server
keeps applying tool calls in a loop until the model produces a final
`assistant` message with no tool calls.

## Streaming protocol

The route streams a sequence of newline-delimited JSON events:

```
{"type":"text_delta","delta":"Sure, transposing..."}
{"type":"tool_use","name":"transpose","input":{"all":true,"semitones":-12}}
{"type":"tool_result","name":"transpose","patch":{...}}
{"type":"text_delta","delta":"Done."}
{"type":"done"}
```

The client applies `patch` events to the store as they arrive — the user sees
the roll change while the model is still talking.

## Model selection

A small dropdown in the chat panel:

- Claude Opus 4.7 — `claude-opus-4-7` (default, best for arrangement reasoning).
- Claude Sonnet 4.6 — `claude-sonnet-4-6` (fast, cheap, very capable).
- Claude Haiku 4.5 — `claude-haiku-4-5-20251001` (cheapest).

Picked model is sent in the request body.

## Prompting

System prompt includes:

- A description of the JSON shape of `Note` and `Voice`.
- The tools available (the SDK supplies the schemas; the prompt explains intent).
- A reminder that "diatonic to the project's scale" should use `set_scale` if
  the scale isn't set yet, then derive notes from it.
- The current project snapshot (so the model can reason without immediately
  calling `read_project`).

## Auth / secrets

- `ANTHROPIC_API_KEY` is a Vercel server env var. Never sent to the browser.
- Rate limit: 1 in-flight request per session (client-side guard).

## Telemetry

Off by default. If we add it, log only token counts per turn — never the prompt
or the project itself.

## Testing

- Mock the SDK in unit tests. For each tool, assert that valid input mutates the
  snapshot the way we expect and that invalid input returns an error.
- A short integration test against a real key can be wired up in CI later (gated
  on the secret existing).
