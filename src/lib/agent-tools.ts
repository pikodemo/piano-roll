// Pure tool implementations — each takes the current Project snapshot and an
// input object and returns an updated Project plus a short result string for
// the model. No SDK or server APIs here; the route handler wraps these with
// betaZodTool() and streams patches back to the client.
//
// Tool surface is intentionally aligned 1:1 with what the user can do in the
// UI (add notes, harmonize, stack a chord, change voices, etc.) so the model
// has access to the same operations the user does.

import { z } from "zod";
import type { Note, Project, Voice } from "./types";
import {
  CHORD_INTERVALS,
  HARMONY_INTERVALS,
  SCALE_INTERVALS,
  chordOffsetsAbove,
  chordVoicingContaining,
  clampMidi,
  diatonicChordAt,
  midiToName,
  snapToScale,
  type ChordQuality,
  type Scale,
  type ScaleMode,
} from "./music";
import { INSTRUMENT_LIST, type InstrumentId } from "./audio";

// Same uid scheme as the client store. Doesn't need to match a particular
// note's existing IDs — these are new IDs assigned by the server during the
// agent turn and applied verbatim once the patch lands on the client.
function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Shared zod schemas ----------

const NoteInput = z.object({
  voice_id: z.string().describe("Target voice ID. Must reference one of the project's voices."),
  pitch: z.number().int().min(0).max(127).describe("MIDI pitch 0-127. Middle C = 60."),
  start: z.number().min(0).describe("Start time in beats from project start."),
  length: z.number().positive().describe("Length in beats. 1 = a quarter note."),
  velocity: z.number().min(0).max(1).optional().describe("Velocity 0-1 (default 0.8)."),
});

const NoteUpdate = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127).optional(),
  start: z.number().min(0).optional(),
  length: z.number().positive().optional(),
  velocity: z.number().min(0).max(1).optional(),
  voice_id: z.string().optional(),
});

const ScaleModeEnum = z.enum(Object.keys(SCALE_INTERVALS) as [ScaleMode, ...ScaleMode[]]);
const ChordQualityEnum = z.enum(Object.keys(CHORD_INTERVALS) as [ChordQuality, ...ChordQuality[]]);
const InstrumentEnum = z.enum(INSTRUMENT_LIST as [InstrumentId, ...InstrumentId[]]);
const HarmonyKey = z.enum(Object.keys(HARMONY_INTERVALS) as [keyof typeof HARMONY_INTERVALS, ...Array<keyof typeof HARMONY_INTERVALS>]);

// ---------- Tool input schemas ----------

export const ToolSchemas = {
  read_project: z.object({}).describe("Re-read the full project. Use after edits to verify state, or to look up IDs of just-added notes."),

  add_notes: z.object({
    notes: z.array(NoteInput),
  }),

  update_notes: z.object({
    updates: z.array(NoteUpdate).describe("Each entry mutates one note by id. Pass only the fields you want to change."),
  }),

  delete_notes: z.object({
    ids: z.array(z.string()),
  }),

  transpose: z.object({
    semitones: z.number().int().describe("Positive = up, negative = down. 12 = octave."),
    ids: z.array(z.string()).optional().describe("Note ids to transpose. Omit and pass `all: true` to transpose everything."),
    all: z.boolean().optional(),
  }),

  move_notes_to_voice: z.object({
    ids: z.array(z.string()),
    voice_id: z.string(),
  }),

  add_voice: z.object({
    name: z.string().optional(),
    color: z.string().optional().describe("Hex color, e.g. '#60a5fa'. Optional."),
    instrument: InstrumentEnum.optional(),
  }),

  update_voice: z.object({
    id: z.string(),
    name: z.string().optional(),
    color: z.string().optional(),
    instrument: InstrumentEnum.optional(),
    volume: z.number().min(0).max(1).optional().describe("Per-voice volume multiplier 0-1; multiplies note velocity at playback."),
    muted: z.boolean().optional(),
    soloed: z.boolean().optional(),
  }),

  delete_voice: z.object({
    id: z.string().describe("Voice id. The project must have at least one remaining voice; deleting the last one is rejected."),
  }),

  set_tempo: z.object({
    bpm: z.number().int().min(20).max(300),
  }),

  set_bars: z.object({
    bars: z.number().int().min(1).max(64),
  }),

  set_scale: z.object({
    tonic: z.number().int().min(0).max(11).optional().describe("Pitch class 0-11 (0=C, 1=C#/Db, 2=D, ..., 11=B)."),
    mode: ScaleModeEnum.optional(),
    clear: z.boolean().optional().describe("Set true to remove the scale instead of setting it."),
  }),

  harmonize_notes: z.object({
    ids: z.array(z.string()),
    interval: HarmonyKey.describe("Symbolic interval, e.g. 'maj3 ↑', 'P5 ↓', 'octave ↑'."),
    target_voice_id: z.string().optional().describe("Voice to add the harmony to. Defaults to the source notes' voice."),
  }),

  stack_chord: z.object({
    ids: z.array(z.string()).describe("Notes to use as chord roots."),
    quality: z.union([ChordQualityEnum, z.literal("diatonic")]).describe("Chord quality. 'diatonic' uses the project's working scale (set via set_scale first)."),
    target_voice_id: z.string().optional(),
  }),

  add_chord: z.object({
    root_pc: z.number().int().min(0).max(11).describe("Root pitch class 0-11."),
    quality: ChordQualityEnum,
    near_pitch: z.number().int().min(0).max(127).describe("MIDI pitch the chord voicing should cluster near (typically the melody note that's being harmonized)."),
    voice_id: z.string(),
    start: z.number().min(0),
    length: z.number().positive(),
    velocity: z.number().min(0).max(1).optional(),
  }),

  select_notes: z.object({
    ids: z.array(z.string()).describe("Highlight these notes in the user's UI (purely for visual feedback)."),
  }),
} as const;

export type ToolName = keyof typeof ToolSchemas;
export type ToolInput<N extends ToolName> = z.infer<(typeof ToolSchemas)[N]>;

export const ToolDescriptions: Record<ToolName, string> = {
  read_project: "Return the current project snapshot (notes, voices, tempo, scale, etc.). Useful after edits to verify the state or to find IDs of just-added notes.",
  add_notes: "Append new notes to a voice. Returns the IDs assigned to each new note.",
  update_notes: "Patch existing notes by id. Use this for moving, transposing, or resizing — preserves IDs and beats undo/redo cleaner than delete + re-add.",
  delete_notes: "Remove notes by id.",
  transpose: "Convenience: shift notes up/down by N semitones. Pass `ids` to target specific notes, or `all: true` to transpose everything.",
  move_notes_to_voice: "Reassign the given notes to a different voice. Useful for splitting a melody into a separate track or moving a bass line into a 'Bass' voice.",
  add_voice: "Create a new voice. Returns its ID. Default instrument is 'triangle'.",
  update_voice: "Update a voice's metadata: rename, change color, change instrument, mute, solo.",
  delete_voice: "Delete a voice and all its notes. Rejected if it would leave the project with no voices.",
  set_tempo: "Set project tempo in BPM (20-300).",
  set_bars: "Set project length in bars (1-64).",
  set_scale: "Set the working scale used by diatonic harmonization. tonic is a pitch class 0-11 (0=C). Pass `clear: true` to remove the scale.",
  harmonize_notes: "Add a parallel harmony voice at a fixed interval from each selected note (e.g. 'maj3 ↑', 'P5 ↓'). If a working scale is set, the harmony is snapped to scale.",
  stack_chord: "Treat each given note as a chord root and stack chord tones above it. quality can be a literal chord quality (maj, min, 7, sus4, ...) or 'diatonic' to use the diatonic triad on the project's scale.",
  add_chord: "Place a single chord directly: pick the root pitch class, quality, and the melody pitch the chord should cluster around. The chord voicing pins near_pitch in the result.",
  select_notes: "Highlight the given notes in the user's UI as the current selection. Use this to draw the user's attention to what was changed/added.",
};

// ---------- Tool execution ----------

export interface ToolExecutionContext {
  project: Project;
  selectedIds: Set<string>;
}

export interface ToolExecutionResult {
  project: Project;
  selectedIds: Set<string>;
  result: string;
}

function findVoice(project: Project, id: string): Voice | undefined {
  return project.voices.find((v) => v.id === id);
}

function ensureVoice(project: Project, id: string): Voice {
  const v = findVoice(project, id);
  if (!v) throw new Error(`Unknown voice_id: ${id}`);
  return v;
}

const VOICE_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171"];

// ---------- Per-tool implementations ----------

function impl_read_project(ctx: ToolExecutionContext): ToolExecutionResult {
  return {
    project: ctx.project,
    selectedIds: ctx.selectedIds,
    result: JSON.stringify(serializeProject(ctx.project)),
  };
}

function impl_add_notes(ctx: ToolExecutionContext, input: ToolInput<"add_notes">): ToolExecutionResult {
  const created: Note[] = [];
  for (const n of input.notes) {
    ensureVoice(ctx.project, n.voice_id);
    created.push({
      id: uid(),
      voiceId: n.voice_id,
      pitch: clampMidi(n.pitch),
      start: Math.max(0, n.start),
      length: Math.max(0.001, n.length),
      velocity: n.velocity ?? 0.8,
    });
  }
  return {
    project: { ...ctx.project, notes: [...ctx.project.notes, ...created], updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Added ${created.length} note${created.length === 1 ? "" : "s"}: ${created.map((n) => `${n.id}=${midiToName(n.pitch)}@${n.start}b`).join(", ")}`,
  };
}

function impl_update_notes(ctx: ToolExecutionContext, input: ToolInput<"update_notes">): ToolExecutionResult {
  const map = new Map(input.updates.map((u) => [u.id, u]));
  let touched = 0;
  const notes = ctx.project.notes.map((n) => {
    const u = map.get(n.id);
    if (!u) return n;
    if (u.voice_id !== undefined) ensureVoice(ctx.project, u.voice_id);
    touched++;
    return {
      ...n,
      pitch: u.pitch !== undefined ? clampMidi(u.pitch) : n.pitch,
      start: u.start !== undefined ? Math.max(0, u.start) : n.start,
      length: u.length !== undefined ? Math.max(0.001, u.length) : n.length,
      velocity: u.velocity !== undefined ? u.velocity : n.velocity,
      voiceId: u.voice_id !== undefined ? u.voice_id : n.voiceId,
    };
  });
  return {
    project: { ...ctx.project, notes, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Updated ${touched} note${touched === 1 ? "" : "s"}.`,
  };
}

function impl_delete_notes(ctx: ToolExecutionContext, input: ToolInput<"delete_notes">): ToolExecutionResult {
  const ids = new Set(input.ids);
  const before = ctx.project.notes.length;
  const notes = ctx.project.notes.filter((n) => !ids.has(n.id));
  const remainingSel = new Set(ctx.selectedIds);
  for (const id of ids) remainingSel.delete(id);
  return {
    project: { ...ctx.project, notes, updatedAt: Date.now() },
    selectedIds: remainingSel,
    result: `Deleted ${before - notes.length} note${before - notes.length === 1 ? "" : "s"}.`,
  };
}

function impl_transpose(ctx: ToolExecutionContext, input: ToolInput<"transpose">): ToolExecutionResult {
  const ids = input.all ? new Set(ctx.project.notes.map((n) => n.id)) : new Set(input.ids ?? []);
  if (ids.size === 0) return { ...ctx, result: "transpose: no notes targeted (need ids or all=true)." };
  const notes = ctx.project.notes.map((n) =>
    ids.has(n.id) ? { ...n, pitch: clampMidi(n.pitch + input.semitones) } : n,
  );
  return {
    project: { ...ctx.project, notes, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Transposed ${ids.size} note${ids.size === 1 ? "" : "s"} by ${input.semitones >= 0 ? "+" : ""}${input.semitones} semitones.`,
  };
}

function impl_move_notes_to_voice(ctx: ToolExecutionContext, input: ToolInput<"move_notes_to_voice">): ToolExecutionResult {
  ensureVoice(ctx.project, input.voice_id);
  const ids = new Set(input.ids);
  let touched = 0;
  const notes = ctx.project.notes.map((n) => {
    if (!ids.has(n.id)) return n;
    touched++;
    return { ...n, voiceId: input.voice_id };
  });
  return {
    project: { ...ctx.project, notes, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Moved ${touched} note${touched === 1 ? "" : "s"} to voice ${input.voice_id}.`,
  };
}

function impl_add_voice(ctx: ToolExecutionContext, input: ToolInput<"add_voice">): ToolExecutionResult {
  const id = uid();
  const idx = ctx.project.voices.length;
  const voice: Voice = {
    id,
    name: input.name ?? `Voice ${idx + 1}`,
    color: input.color ?? VOICE_COLORS[idx % VOICE_COLORS.length],
    instrument: input.instrument ?? "triangle",
    volume: 1,
    muted: false,
    soloed: false,
  };
  return {
    project: { ...ctx.project, voices: [...ctx.project.voices, voice], updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Added voice ${voice.id} ("${voice.name}", instrument=${voice.instrument}).`,
  };
}

function impl_update_voice(ctx: ToolExecutionContext, input: ToolInput<"update_voice">): ToolExecutionResult {
  ensureVoice(ctx.project, input.id);
  const voices = ctx.project.voices.map((v) => v.id === input.id ? {
    ...v,
    name: input.name ?? v.name,
    color: input.color ?? v.color,
    instrument: input.instrument ?? v.instrument,
    volume: input.volume ?? v.volume,
    muted: input.muted ?? v.muted,
    soloed: input.soloed ?? v.soloed,
  } : v);
  return {
    project: { ...ctx.project, voices, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Updated voice ${input.id}.`,
  };
}

function impl_delete_voice(ctx: ToolExecutionContext, input: ToolInput<"delete_voice">): ToolExecutionResult {
  if (ctx.project.voices.length <= 1) {
    return { ...ctx, result: `Cannot delete voice ${input.id}: it's the last remaining voice.` };
  }
  ensureVoice(ctx.project, input.id);
  const voices = ctx.project.voices.filter((v) => v.id !== input.id);
  const notes = ctx.project.notes.filter((n) => n.voiceId !== input.id);
  return {
    project: { ...ctx.project, voices, notes, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Deleted voice ${input.id} and its ${ctx.project.notes.length - notes.length} notes.`,
  };
}

function impl_set_tempo(ctx: ToolExecutionContext, input: ToolInput<"set_tempo">): ToolExecutionResult {
  return {
    project: { ...ctx.project, tempo: input.bpm, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Tempo set to ${input.bpm} BPM.`,
  };
}

function impl_set_bars(ctx: ToolExecutionContext, input: ToolInput<"set_bars">): ToolExecutionResult {
  return {
    project: { ...ctx.project, bars: input.bars, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Project length set to ${input.bars} bars.`,
  };
}

function impl_set_scale(ctx: ToolExecutionContext, input: ToolInput<"set_scale">): ToolExecutionResult {
  if (input.clear) {
    return {
      project: { ...ctx.project, scale: null, updatedAt: Date.now() },
      selectedIds: ctx.selectedIds,
      result: "Scale cleared.",
    };
  }
  if (input.tonic === undefined || input.mode === undefined) {
    return { ...ctx, result: "set_scale needs both tonic and mode (or clear:true)." };
  }
  const scale: Scale = { tonic: input.tonic, mode: input.mode };
  return {
    project: { ...ctx.project, scale, updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Scale set to tonic=${input.tonic} (pitch class), mode=${input.mode}.`,
  };
}

function impl_harmonize_notes(ctx: ToolExecutionContext, input: ToolInput<"harmonize_notes">): ToolExecutionResult {
  const sourceNotes = ctx.project.notes.filter((n) => input.ids.includes(n.id));
  if (sourceNotes.length === 0) return { ...ctx, result: "No matching notes." };
  const semis = HARMONY_INTERVALS[input.interval];
  const targetVoice = input.target_voice_id ?? sourceNotes[0].voiceId;
  ensureVoice(ctx.project, targetVoice);
  const created: Note[] = sourceNotes.map((n) => ({
    id: uid(),
    voiceId: targetVoice,
    pitch: clampMidi(snapToScale(n.pitch, semis, ctx.project.scale)),
    start: n.start,
    length: n.length,
    velocity: n.velocity,
  }));
  return {
    project: { ...ctx.project, notes: [...ctx.project.notes, ...created], updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Harmonized ${sourceNotes.length} note${sourceNotes.length === 1 ? "" : "s"} ${input.interval}: added ${created.length} note${created.length === 1 ? "" : "s"} to voice ${targetVoice}.`,
  };
}

function impl_stack_chord(ctx: ToolExecutionContext, input: ToolInput<"stack_chord">): ToolExecutionResult {
  const sourceNotes = ctx.project.notes.filter((n) => input.ids.includes(n.id));
  if (sourceNotes.length === 0) return { ...ctx, result: "No matching notes." };
  const targetVoice = input.target_voice_id ?? sourceNotes[0].voiceId;
  ensureVoice(ctx.project, targetVoice);
  const created: Note[] = [];
  for (const n of sourceNotes) {
    let extraPitches: number[] = [];
    if (input.quality === "diatonic") {
      if (!ctx.project.scale) continue;
      const chord = diatonicChordAt(n.pitch, ctx.project.scale);
      if (!chord) continue;
      extraPitches = chordVoicingContaining(chord, n.pitch).filter((m) => m !== n.pitch);
    } else {
      extraPitches = chordOffsetsAbove(input.quality).map((o) => clampMidi(n.pitch + o));
    }
    for (const pitch of extraPitches) {
      created.push({
        id: uid(),
        voiceId: targetVoice,
        pitch,
        start: n.start,
        length: n.length,
        velocity: n.velocity,
      });
    }
  }
  return {
    project: { ...ctx.project, notes: [...ctx.project.notes, ...created], updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Stacked ${input.quality} chord on ${sourceNotes.length} note${sourceNotes.length === 1 ? "" : "s"}: added ${created.length} chord tone${created.length === 1 ? "" : "s"}.`,
  };
}

function impl_add_chord(ctx: ToolExecutionContext, input: ToolInput<"add_chord">): ToolExecutionResult {
  ensureVoice(ctx.project, input.voice_id);
  const voicing = chordVoicingContaining({ rootPc: input.root_pc, quality: input.quality, inversion: 0 }, input.near_pitch);
  const created: Note[] = voicing.map((m) => ({
    id: uid(),
    voiceId: input.voice_id,
    pitch: m,
    start: input.start,
    length: input.length,
    velocity: input.velocity ?? 0.8,
  }));
  return {
    project: { ...ctx.project, notes: [...ctx.project.notes, ...created], updatedAt: Date.now() },
    selectedIds: ctx.selectedIds,
    result: `Added chord at beat ${input.start}: ${voicing.map((m) => midiToName(m)).join(" ")} (${created.length} notes).`,
  };
}

function impl_select_notes(ctx: ToolExecutionContext, input: ToolInput<"select_notes">): ToolExecutionResult {
  return {
    project: ctx.project,
    selectedIds: new Set(input.ids),
    result: `Highlighted ${input.ids.length} note${input.ids.length === 1 ? "" : "s"}.`,
  };
}

const IMPLS: Record<ToolName, (ctx: ToolExecutionContext, input: unknown) => ToolExecutionResult> = {
  read_project:        (ctx) => impl_read_project(ctx),
  add_notes:           (ctx, i) => impl_add_notes(ctx, i as ToolInput<"add_notes">),
  update_notes:        (ctx, i) => impl_update_notes(ctx, i as ToolInput<"update_notes">),
  delete_notes:        (ctx, i) => impl_delete_notes(ctx, i as ToolInput<"delete_notes">),
  transpose:           (ctx, i) => impl_transpose(ctx, i as ToolInput<"transpose">),
  move_notes_to_voice: (ctx, i) => impl_move_notes_to_voice(ctx, i as ToolInput<"move_notes_to_voice">),
  add_voice:           (ctx, i) => impl_add_voice(ctx, i as ToolInput<"add_voice">),
  update_voice:        (ctx, i) => impl_update_voice(ctx, i as ToolInput<"update_voice">),
  delete_voice:        (ctx, i) => impl_delete_voice(ctx, i as ToolInput<"delete_voice">),
  set_tempo:           (ctx, i) => impl_set_tempo(ctx, i as ToolInput<"set_tempo">),
  set_bars:            (ctx, i) => impl_set_bars(ctx, i as ToolInput<"set_bars">),
  set_scale:           (ctx, i) => impl_set_scale(ctx, i as ToolInput<"set_scale">),
  harmonize_notes:     (ctx, i) => impl_harmonize_notes(ctx, i as ToolInput<"harmonize_notes">),
  stack_chord:         (ctx, i) => impl_stack_chord(ctx, i as ToolInput<"stack_chord">),
  add_chord:           (ctx, i) => impl_add_chord(ctx, i as ToolInput<"add_chord">),
  select_notes:        (ctx, i) => impl_select_notes(ctx, i as ToolInput<"select_notes">),
};

export function executeTool(
  ctx: ToolExecutionContext,
  name: ToolName,
  input: unknown,
): ToolExecutionResult {
  const schema = ToolSchemas[name];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ...ctx, result: `Invalid input for ${name}: ${parsed.error.message}` };
  }
  const fn = IMPLS[name];
  return fn(ctx, parsed.data);
}

// Compact serialization for sending to the model.
export function serializeProject(p: Project) {
  return {
    name: p.name,
    tempo: p.tempo,
    beatsPerBar: p.beatsPerBar,
    bars: p.bars,
    scale: p.scale,
    voices: p.voices.map((v) => ({
      id: v.id,
      name: v.name,
      instrument: v.instrument,
      muted: v.muted,
      soloed: v.soloed,
    })),
    notes: p.notes.map((n) => ({
      id: n.id,
      voice_id: n.voiceId,
      pitch: n.pitch,
      pitch_name: midiToName(n.pitch),
      start: n.start,
      length: n.length,
      velocity: n.velocity,
    })),
  };
}
