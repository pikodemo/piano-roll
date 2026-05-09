// /api/chat — streaming Claude agent for the piano-roll editor.
//
// Wire format: NDJSON (newline-delimited JSON). Each line is one of:
//   {"type":"text","delta":"..."}
//   {"type":"thinking","delta":"..."}
//   {"type":"tool","name":"...","input":{...},"id":"..."}
//   {"type":"tool_result","name":"...","result":"...","id":"..."}
//   {"type":"patch","project":{...}}        // applied to the client store
//   {"type":"selection","ids":[...]}         // requested selection update
//   {"type":"done","stop_reason":"..."}
//   {"type":"error","message":"..."}
//
// The browser sends the full project + chat history on each turn; the server
// keeps no per-session state. After each tool runs we stream a `patch` event
// with the new project state, so the user sees changes appear live.

import Anthropic from "@anthropic-ai/sdk";
import type { Project } from "@/lib/types";
import {
  ToolDescriptions,
  ToolSchemas,
  executeTool,
  serializeProject,
  type ToolExecutionContext,
  type ToolName,
} from "@/lib/agent-tools";
import { z } from "zod";

export const runtime = "nodejs";

// ---------- Request body ----------

const RequestBody = z.object({
  model: z.string(),
  // Free-form chat history. The route translates this to Anthropic's message
  // format; the project snapshot is included on the most recent user turn.
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string(),
  })),
  project: z.unknown(),
});

// ---------- System prompt ----------

const SYSTEM_PROMPT = `You are a music-arrangement assistant working inside a piano-roll editor.

You can see the user's current project (notes, voices, tempo, scale) and you have a small set of tools that mirror what the user can do in the UI: add/move/delete notes, harmonize, stack chords, change voices/instruments, set the working scale, etc. Use them to make precise edits — do not paste a full new project; just call the right tools.

Schema:
- pitch is a MIDI integer 0-127. Middle C = 60. Each octave is 12 semitones (C4=60, C5=72, C3=48, A4=69).
- start and length are in beats. One beat = one quarter note. tempo is BPM.
- Notes belong to voices. Each voice has its own instrument: triangle, sine, saw, square, pluck, bass, pad, bell.
- A working scale (set_scale) has a tonic (pitch class 0-11; 0=C, 1=C#/Db, ..., 11=B) and a mode: major, minor, dorian, phrygian, lydian, mixolydian, harmonic_minor, melodic_minor, minor_pentatonic, major_pentatonic, blues.
- Chord qualities: maj, min, 7, maj7, min7, sus2, sus4, dim, aug, m7b5, dim7, maj6, min6.
- Harmony intervals (used by harmonize_notes): "min3 ↑", "maj3 ↑", "P4 ↑", "P5 ↑", "min6 ↑", "maj6 ↑", "octave ↑", and the same with ↓.

Working principles:
- For "transpose down an octave" or "shift these up a fifth": use the transpose tool, not delete + add.
- For "add a third above this melody" or "harmonize in sixths": use harmonize_notes (snaps to scale automatically when one is set).
- For "use the diatonic chords of A minor" or "voice this in C major": call set_scale first, then stack_chord with quality "diatonic" on the relevant melody notes.
- For "add a bass voice": add_voice with instrument "bass" and a sensible name, then add_notes (root motion an octave or two below the melody's lowest pitch is usually right).
- After making non-trivial edits, optionally call select_notes to highlight what you changed/added.
- Be concise in prose — describe what you'll do in one or two sentences, then make the edits, then briefly summarize the result. The user will see the roll change live, so don't recite every note you added.
- If the user asks for something stylistically open-ended ("voice this in the style of X"), it's fine to interpret and execute; mention the choices you made so they can adjust.`;

// ---------- Anthropic tool schema (built from Zod) ----------

function buildAnthropicTools(): Anthropic.Tool[] {
  return (Object.keys(ToolSchemas) as ToolName[]).map((name) => {
    const json = z.toJSONSchema(ToolSchemas[name], { unrepresentable: "any" }) as Record<string, unknown>;
    delete json.$schema;
    return {
      name,
      description: ToolDescriptions[name],
      input_schema: json as Anthropic.Tool["input_schema"],
    };
  });
}

// ---------- Route handler ----------

export async function POST(req: Request) {
  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await req.json());
  } catch (err) {
    return Response.json(
      { error: "invalid_request", message: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: "missing_api_key",
        message: "ANTHROPIC_API_KEY is not set on the server. Add it to your environment (or .env.local) and restart.",
      },
      { status: 500 },
    );
  }

  // Snapshot the project we're operating on. Tools mutate this in place; the
  // updated snapshot is streamed back to the client as `patch` events.
  let ctx: ToolExecutionContext = {
    project: body.project as Project,
    selectedIds: new Set<string>(),
  };

  const client = new Anthropic({ apiKey });
  const tools = buildAnthropicTools();

  // Translate the chat history into Anthropic's message format. The latest
  // user turn carries the project snapshot inside a `<project>` block so the
  // model has full context without needing a read_project call up front.
  const messages: Anthropic.MessageParam[] = body.messages.map((m, i) => {
    if (m.role === "user" && i === body.messages.length - 1) {
      return {
        role: "user",
        content: [
          { type: "text", text: `Current project state:\n<project>\n${JSON.stringify(serializeProject(ctx.project), null, 2)}\n</project>` },
          { type: "text", text: m.text },
        ],
      };
    }
    return { role: m.role, content: m.text };
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: object) => {
        controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // Manual agent loop. The Anthropic SDK's tool runner is convenient,
        // but doing the loop by hand lets us emit a `patch` event with the
        // updated project snapshot after each tool call so the UI can re-render
        // the roll while the agent is still running.
        let stopReason: string | null = null;
        for (let turn = 0; turn < 8; turn++) {
          const apiStream = client.messages.stream({
            model: body.model,
            max_tokens: 16000,
            // System prompt + tool definitions are stable across turns; cache
            // them so multi-turn chat is cheap.
            system: [
              { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            ],
            tools,
            thinking: { type: "adaptive" },
            messages,
          });

          for await (const event of apiStream) {
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                send({ type: "text", delta: event.delta.text });
              } else if (event.delta.type === "thinking_delta") {
                send({ type: "thinking", delta: event.delta.thinking });
              }
            }
          }

          const finalMessage = await apiStream.finalMessage();
          messages.push({ role: "assistant", content: finalMessage.content });
          stopReason = finalMessage.stop_reason ?? null;

          // Server-side tool pause — re-issue with the same history.
          if (stopReason === "pause_turn") continue;

          const toolUses = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name, input: tu.input, id: tu.id });
            let resultText: string;
            try {
              const out = executeTool(ctx, tu.name as ToolName, tu.input);
              ctx = { project: out.project, selectedIds: out.selectedIds };
              resultText = out.result;
              send({ type: "patch", project: ctx.project });
              if (out.selectedIds.size > 0) {
                send({ type: "selection", ids: Array.from(out.selectedIds) });
              }
            } catch (err) {
              resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
              send({ type: "tool_result", name: tu.name, id: tu.id, result: resultText, error: true });
              toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText, is_error: true });
              continue;
            }
            send({ type: "tool_result", name: tu.name, id: tu.id, result: resultText });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
          }

          messages.push({ role: "user", content: toolResults });
        }

        send({ type: "done", stop_reason: stopReason ?? "end_turn" });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
