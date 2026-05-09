"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import {
  HARMONY_INTERVALS,
  chordLabel,
  chordVoicing,
  chordsContaining,
  midiToName,
  snapToScale,
  type Chord,
} from "@/lib/music";
import { playNote, scheduleNotes } from "@/lib/audio";

export function Inspector() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedIds);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const addNotes = useStore((s) => s.addNotes);
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
          Click in the grid to add a note. Drag to extend. Shift-drag to marquee-select.
          ↑/↓ transpose. ←/→ nudge. Backspace deletes. Space plays.
        </div>
      ) : single ? (
        <div>
          {/* `key` remounts the cycler when the selected note changes. */}
          <SingleNoteInspector key={single.id} />
          <div className="mt-2">
            <DeleteSelectedButton />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-gray-400">{selectedNotes.length} notes selected</span>
          <HarmonizeRow />
          <DeleteSelectedButton />
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

  function HarmonizeRow() {
    const scale = project!.scale;
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-gray-400">Harmonize</span>
        {(Object.entries(HARMONY_INTERVALS) as Array<[string, number]>).map(([label, semis]) => (
          <button
            key={label}
            onClick={() => {
              if (!activeVoiceId) return;
              const created = selectedNotes.map((n) => ({
                voiceId: activeVoiceId,
                pitch: snapToScale(n.pitch, semis, scale),
                start: n.start,
                length: n.length,
                velocity: n.velocity,
              }));
              const notes = addNotes(created);
              for (const n of notes) playNote(n.pitch, 0.2);
            }}
            className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
            title={`Add a voice ${label} from the selection`}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
}

function SingleNoteInspector() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selectedIds);
  const note = project.notes.find((n) => selected.has(n.id))!;
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const addNotes = useStore((s) => s.addNotes);
  const setSelected = useStore((s) => s.setSelected);

  const chords = useMemo(() => chordsContaining(note.pitch), [note.pitch]);
  const [idx, setIdx] = useState(0);

  const chord = chords[idx % Math.max(1, chords.length)] as Chord | undefined;
  const voicing = useMemo(
    () => (chord ? chordVoicing(chord, note.pitch) : []),
    [chord, note.pitch],
  );

  // Preview the chord audibly when it changes.
  useEffect(() => {
    if (!chord || voicing.length === 0) return;
    const events = voicing.map((midi) => ({ midi, startBeat: 0, lengthBeat: 1, velocity: 0.5 }));
    scheduleNotes(events, 240);
  }, [chord, voicing]);

  function commit() {
    if (!chord || !activeVoiceId) return;
    // Add chord tones (skip the existing pitch).
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
          {(Object.entries(HARMONY_INTERVALS) as Array<[string, number]>).map(([label, semis]) => (
            <button
              key={label}
              onClick={() => {
                if (!activeVoiceId) return;
                const newNotes = [{
                  voiceId: activeVoiceId,
                  pitch: snapToScale(note.pitch, semis, project.scale),
                  start: note.start,
                  length: note.length,
                  velocity: note.velocity,
                }];
                const created = addNotes(newNotes);
                for (const n of created) playNote(n.pitch, 0.2);
              }}
              className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
