"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import {
  CHORD_LABELS,
  HARMONY_INTERVALS,
  chordLabel,
  chordOffsetsAbove,
  chordVoicing,
  chordVoicingContaining,
  chordsContaining,
  diatonicChordAt,
  midiToName,
  snapToScale,
  type Chord,
  type ChordQuality,
} from "@/lib/music";
import { playNote, scheduleNotes } from "@/lib/audio";

// Hook helpers for setting/clearing the ghost preview on hover.
function useHoverPreview() {
  const setPreview = useStore((s) => s.setPreview);
  const clearPreview = useStore((s) => s.clearPreview);
  return (compute: () => Array<{ pitch: number; start: number; length: number }>) => ({
    onPointerEnter: () => setPreview(compute()),
    onPointerLeave: () => clearPreview(),
    onFocus: () => setPreview(compute()),
    onBlur: () => clearPreview(),
  });
}

// Stack-chord quality choices used in single-note "Add chord" and multi-note
// "Stack chord" controls.
const STACK_QUALITIES: ChordQuality[] = ["maj", "min", "7", "maj7", "min7", "sus4", "dim"];

// Compute the chord-tone pitches to stack on top of `rootMidi`. If the user
// asked for "diatonic" and a scale is set, use the diatonic triad rooted at
// that pitch; otherwise add the literal chord-tone offsets above the root.
// Returns an empty array when nothing should be added (e.g. diatonic on a
// non-scale tone).
function stackPitches(
  rootMidi: number,
  quality: ChordQuality | "diatonic",
  scale: ReturnType<typeof useStore.getState>["project"] extends infer P
    ? P extends { scale: infer S } ? S : never
    : never,
): number[] {
  if (quality === "diatonic") {
    if (!scale) return [];
    const chord = diatonicChordAt(rootMidi, scale);
    if (!chord) return [];
    return chordVoicing(chord, rootMidi).filter((m) => m !== rootMidi);
  }
  return chordOffsetsAbove(quality).map((o) => rootMidi + o);
}

export function Inspector() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedIds);
  const deleteNotes = useStore((s) => s.deleteNotes);

  const selectedNotes = useMemo(
    () => project?.notes.filter((n) => selected.has(n.id)) ?? [],
    [project, selected],
  );

  if (!project) return null;
  const single = selectedNotes.length === 1 ? selectedNotes[0] : null;

  return (
    <div className="border-t border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100">
      {selectedNotes.length === 0 ? (
        <div className="text-gray-500">
          Click in the grid to add a note. Drag to extend. Shift-drag for marquee-select; Shift-click toggles a note in/out of the selection.
          ↑/↓ transpose. ←/→ nudge. Backspace deletes. Space plays.
        </div>
      ) : single ? (
        <div className="flex flex-col gap-2">
          <SingleNoteInspector key={single.id} note={single} />
          <BulkActions notes={selectedNotes} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-gray-300">{selectedNotes.length} notes selected</span>
            <DeleteSelectedButton />
            <MoveToVoice />
          </div>
          <StackChordRow notes={selectedNotes} />
          <HarmonizeRow notes={selectedNotes} />
        </div>
      )}
    </div>
  );

  function DeleteSelectedButton() {
    return (
      <button
        onClick={() => deleteNotes(Array.from(selected))}
        className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
        title="Delete selected (Backspace)"
      >
        Delete{selectedNotes.length > 1 ? ` ${selectedNotes.length}` : ""}
        <span className="ml-1 text-red-200/80">⌫</span>
      </button>
    );
  }
}

// Used in single-note mode to host the Delete + Move-to-voice buttons.
function BulkActions({ notes }: { notes: Note[] }) {
  const deleteNotes = useStore((s) => s.deleteNotes);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => deleteNotes(notes.map((n) => n.id))}
        className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
        title="Delete selected (Backspace)"
      >
        Delete{notes.length > 1 ? ` ${notes.length}` : ""}
        <span className="ml-1 text-red-200/80">⌫</span>
      </button>
      <MoveToVoice />
    </div>
  );
}

function MoveToVoice() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedIds);
  const moveSelectedToVoice = useStore((s) => s.moveSelectedToVoice);
  if (selected.size === 0 || project.voices.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-400">Move to</span>
      {project.voices.map((v) => (
        <button
          key={v.id}
          onClick={() => moveSelectedToVoice(v.id)}
          className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
          title={`Reassign selected notes to ${v.name}`}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.color }} />
          <span>{v.name}</span>
        </button>
      ))}
    </div>
  );
}

function HarmonizeRow({ notes }: { notes: Note[] }) {
  const project = useStore((s) => s.project)!;
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const addNotes = useStore((s) => s.addNotes);
  const hover = useHoverPreview();
  const scale = project.scale;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-gray-400">Harmonize</span>
      {(Object.entries(HARMONY_INTERVALS) as Array<[string, number]>).map(([label, semis]) => {
        const previewFor = () => notes.map((n) => ({
          pitch: snapToScale(n.pitch, semis, scale),
          start: n.start,
          length: n.length,
        }));
        return (
          <button
            key={label}
            onClick={() => {
              if (!activeVoiceId) return;
              const created = notes.map((n) => ({
                voiceId: activeVoiceId,
                pitch: snapToScale(n.pitch, semis, scale),
                start: n.start,
                length: n.length,
                velocity: n.velocity,
              }));
              const added = addNotes(created);
              for (const n of added) playNote(n.pitch, 0.2);
            }}
            className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
            title={`Add a voice ${label} from each selected note`}
            {...hover(previewFor)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Multi-note stack-chord row: builds a chord rooted on each selected note.
function StackChordRow({ notes }: { notes: Note[] }) {
  const project = useStore((s) => s.project)!;
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const addNotes = useStore((s) => s.addNotes);
  const hover = useHoverPreview();
  const scale = project.scale;

  // Always show the diatonic option so users discover it; disable it (with an
  // explanatory tooltip) when no working scale is set.
  const choices: Array<{ key: ChordQuality | "diatonic"; label: string }> = [
    { key: "diatonic" as const, label: "diatonic" },
    ...STACK_QUALITIES.map((q) => ({ key: q, label: CHORD_LABELS[q] || "maj" })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-gray-400">
        Stack chord <span className="text-xs text-gray-500">(rooted on each selected note)</span>
      </span>
      {choices.map(({ key, label }) => {
        const disabled = key === "diatonic" && !scale;
        const previewFor = () => disabled ? [] : notes.flatMap((n) =>
          stackPitches(n.pitch, key, scale).map((pitch) => ({ pitch, start: n.start, length: n.length })),
        );
        return (
          <button
            key={key}
            disabled={disabled}
            onClick={() => {
              if (!activeVoiceId) return;
              const newNotes = notes.flatMap((n) =>
                stackPitches(n.pitch, key, scale).map((pitch) => ({
                  voiceId: activeVoiceId,
                  pitch,
                  start: n.start,
                  length: n.length,
                  velocity: n.velocity,
                })),
              );
              if (newNotes.length === 0) return;
              const added = addNotes(newNotes);
              const events = added.map((a) => ({ midi: a.pitch, startBeat: 0, lengthBeat: 0.4, velocity: 0.5 }));
              scheduleNotes(events, 240);
            }}
            className={
              disabled
                ? "rounded bg-gray-900 px-2 py-1 text-xs text-gray-500 cursor-not-allowed"
                : "rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
            }
            title={
              disabled
                ? "Set a working scale in the toolbar (Scale ▾) to enable diatonic harmonization"
                : key === "diatonic"
                ? "Add the diatonic triad rooted on each selected note (degrees of the project scale)"
                : `Add a ${key} chord rooted on each selected note`
            }
            {...hover(previewFor)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SingleNoteInspector({ note }: { note: Note }) {
  const project = useStore((s) => s.project)!;
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const addNotes = useStore((s) => s.addNotes);
  const setSelected = useStore((s) => s.setSelected);
  const setPreview = useStore((s) => s.setPreview);
  const clearPreview = useStore((s) => s.clearPreview);
  const hover = useHoverPreview();

  // Sorted chord suggestions: diatonic-first (when a scale is set), then
  // simpler triads, then 7ths, then suspensions, etc. The selected note's
  // pitch class is guaranteed to be a chord tone of every entry.
  const chords = useMemo(
    () => chordsContaining(note.pitch, { scale: project.scale }),
    [note.pitch, project.scale],
  );
  const [idx, setIdx] = useState(0);

  const chord = chords[idx % Math.max(1, chords.length)] as Chord | undefined;
  // Pinned voicing — the user's note keeps its exact MIDI position; the other
  // chord tones cluster within an octave of it.
  const voicing = useMemo(
    () => (chord ? chordVoicingContaining(chord, note.pitch) : []),
    [chord, note.pitch],
  );

  // Audible preview when the chord changes.
  useEffect(() => {
    if (!chord || voicing.length === 0) return;
    const events = voicing.map((midi) => ({ midi, startBeat: 0, lengthBeat: 1, velocity: 0.5 }));
    scheduleNotes(events, 240);
  }, [chord, voicing]);

  // Visual preview: while the cycler shows a chord, ghost the chord tones
  // that would actually get added (skip the existing root note).
  useEffect(() => {
    if (!chord) { clearPreview(); return; }
    setPreview(
      voicing.filter((m) => m !== note.pitch).map((m) => ({ pitch: m, start: note.start, length: note.length })),
    );
    return () => clearPreview();
  }, [chord, voicing, note.pitch, note.start, note.length, setPreview, clearPreview]);

  function commit() {
    if (!chord || !activeVoiceId) return;
    const newNotes = voicing
      .filter((m) => m !== note.pitch)
      .map((m) => ({
        voiceId: activeVoiceId,
        pitch: m,
        start: note.start,
        length: note.length,
        velocity: note.velocity,
      }));
    const created = addNotes(newNotes);
    setSelected([note.id, ...created.map((n) => n.id)]);
  }

  // Arrow keys cycle, Enter commits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "[") { e.preventDefault(); setIdx((i) => (i - 1 + chords.length) % chords.length); }
      else if (e.key === "]") { e.preventDefault(); setIdx((i) => (i + 1) % chords.length); }
      else if (e.key === "Enter") { e.preventDefault(); commit(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chord, chords.length, activeVoiceId]);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-[180px]">
        <div className="text-gray-400">Selected note</div>
        <div className="text-base font-mono">{midiToName(note.pitch)}</div>
        <div className="text-xs text-gray-500">
          beat {note.start.toFixed(2)} · length {note.length.toFixed(2)}
        </div>
      </div>
      <div>
        <div className="text-gray-400">
          Chord cycler <span className="text-xs text-gray-500">[ ] cycle · Enter commit</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button onClick={() => setIdx((i) => (i - 1 + chords.length) % chords.length)} className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">‹</button>
          <div className="min-w-[140px] rounded bg-gray-800 px-3 py-1 text-center font-mono">
            {chord ? chordLabel(chord) : "—"}
          </div>
          <button onClick={() => setIdx((i) => (i + 1) % chords.length)} className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">›</button>
          <span className="text-xs text-gray-500">{chords.length ? `${idx + 1}/${chords.length}` : ""}</span>
          <button onClick={commit} className="ml-2 rounded bg-emerald-600 px-3 py-1 font-semibold hover:bg-emerald-500">Add chord</button>
        </div>
        <div className="mt-1 font-mono text-xs text-gray-400">
          {voicing.map((m) => midiToName(m)).join("  ")}
        </div>
      </div>
      <div className="ml-auto">
        <div className="text-gray-400">Harmonize</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(Object.entries(HARMONY_INTERVALS) as Array<[string, number]>).map(([label, semis]) => {
            const previewFor = () => [{
              pitch: snapToScale(note.pitch, semis, project.scale),
              start: note.start,
              length: note.length,
            }];
            return (
              <button
                key={label}
                onClick={() => {
                  if (!activeVoiceId) return;
                  const created = addNotes([{
                    voiceId: activeVoiceId,
                    pitch: snapToScale(note.pitch, semis, project.scale),
                    start: note.start,
                    length: note.length,
                    velocity: note.velocity,
                  }]);
                  for (const n of created) playNote(n.pitch, 0.2);
                }}
                className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
                {...hover(previewFor)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
