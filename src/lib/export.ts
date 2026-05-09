// Export the project (or a subset of voices / a selection) to other notation
// formats:
//
//   - MusicXML  — universal sheet-music format. Open in MuseScore, Sibelius,
//                 Finale, etc. for printing/PDF/editing.
//   - Guitar tab (ASCII) — six-string standard tuning. Each beat is a column.
//   - Jianpu — numbered notation (1-7 = Do-Ti). Octaves shown with apostrophe
//                 (up) / comma (down). Bar lines and dashes for sustain.
//
// Conversion is done in pure functions so it's straightforward to unit-test
// or invoke from the agent down the line. The export modal just calls these.

import type { Note, Project } from "./types";
import {
  NOTE_NAMES,
  SCALE_INTERVALS,
  pitchClass,
  type Scale,
  type ScaleMode,
} from "./music";

export type ExportFormat = "musicxml" | "tab" | "jianpu";

export interface ExportOptions {
  voiceIds: string[];                 // Voices to include
  selectedNoteIds?: Set<string>;      // If provided, only include these notes
}

// Convenience: collect the notes-to-export per voice.
function selectNotesPerVoice(project: Project, opts: ExportOptions): Map<string, Note[]> {
  const out = new Map<string, Note[]>();
  for (const id of opts.voiceIds) out.set(id, []);
  for (const n of project.notes) {
    if (!opts.voiceIds.includes(n.voiceId)) continue;
    if (opts.selectedNoteIds && !opts.selectedNoteIds.has(n.id)) continue;
    out.get(n.voiceId)!.push(n);
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return out;
}

// ---------- Note-value helpers ----------

const STD_DURATIONS: Array<{ beats: number; type: string; xmlType: string }> = [
  { beats: 4,    type: "whole",       xmlType: "whole" },
  { beats: 2,    type: "half",        xmlType: "half" },
  { beats: 1,    type: "quarter",     xmlType: "quarter" },
  { beats: 0.5,  type: "eighth",      xmlType: "eighth" },
  { beats: 0.25, type: "sixteenth",   xmlType: "16th" },
  { beats: 0.125, type: "32nd",       xmlType: "32nd" },
];

function nearestStdDuration(beats: number) {
  let best = STD_DURATIONS[STD_DURATIONS.length - 1];
  let bestErr = Math.abs(best.beats - beats);
  for (const d of STD_DURATIONS) {
    const err = Math.abs(d.beats - beats);
    if (err < bestErr) { best = d; bestErr = err; }
  }
  return best;
}

// ---------- MusicXML ----------

const STEP_BY_PC: Record<number, { step: string; alter: number }> = {
  0:  { step: "C", alter: 0 },
  1:  { step: "C", alter: 1 },
  2:  { step: "D", alter: 0 },
  3:  { step: "D", alter: 1 },
  4:  { step: "E", alter: 0 },
  5:  { step: "F", alter: 0 },
  6:  { step: "F", alter: 1 },
  7:  { step: "G", alter: 0 },
  8:  { step: "G", alter: 1 },
  9:  { step: "A", alter: 0 },
  10: { step: "A", alter: 1 },
  11: { step: "B", alter: 0 },
};

// MIDI 60 = C4. MusicXML pitch.octave matches scientific pitch notation, so
// midi 60 → octave 4.
function midiToMusicXMLPitch(midi: number): { step: string; alter: number; octave: number } {
  const pc = pitchClass(midi);
  const { step, alter } = STEP_BY_PC[pc];
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

interface MeasureNote {
  pitch: number;
  startInMeasure: number; // beats
  length: number;         // beats
  isChord: boolean;       // true if part of a chord (not the first member)
}

// Split each note into per-measure pieces with ties at measure boundaries.
// Returns an array of measures; each measure is the list of notes that play
// during it, sorted by start, with chord-grouped notes flagged.
function splitIntoMeasures(notes: Note[], beatsPerBar: number, totalBars: number): MeasureNote[][] {
  const measures: MeasureNote[][] = Array.from({ length: totalBars }, () => []);
  for (const n of notes) {
    const startMeasure = Math.floor(n.start / beatsPerBar);
    const endMeasure = Math.floor((n.start + n.length - 1e-9) / beatsPerBar);
    for (let m = startMeasure; m <= endMeasure && m < totalBars; m++) {
      const measureStart = m * beatsPerBar;
      const inStart = Math.max(n.start, measureStart) - measureStart;
      const inEnd = Math.min(n.start + n.length, measureStart + beatsPerBar) - measureStart;
      const len = inEnd - inStart;
      if (len <= 0) continue;
      measures[m].push({
        pitch: n.pitch,
        startInMeasure: inStart,
        length: len,
        isChord: false,
      });
    }
  }
  // Sort each measure by start, then group chords (notes starting at the same
  // beat with the same length).
  for (const m of measures) {
    m.sort((a, b) => a.startInMeasure - b.startInMeasure || a.pitch - b.pitch);
    let prev: MeasureNote | null = null;
    for (const note of m) {
      if (prev && Math.abs(prev.startInMeasure - note.startInMeasure) < 1e-6 && Math.abs(prev.length - note.length) < 1e-6) {
        note.isChord = true;
      } else {
        prev = note;
      }
    }
  }
  return measures;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]!));
}

export function exportToMusicXML(project: Project, opts: ExportOptions): string {
  const notesPerVoice = selectNotesPerVoice(project, opts);
  const voicesToInclude = project.voices.filter((v) => opts.voiceIds.includes(v.id));
  const beatsPerBar = project.beatsPerBar;
  const divisionsPerQuarter = 8; // sixteenths = 2 divisions; thirty-seconds = 1
  const totalBars = project.bars;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="4.0">');
  lines.push('  <work><work-title>' + escapeXml(project.name || "Untitled") + '</work-title></work>');
  lines.push('  <part-list>');
  voicesToInclude.forEach((v, i) => {
    lines.push(`    <score-part id="P${i + 1}"><part-name>${escapeXml(v.name)}</part-name></score-part>`);
  });
  lines.push('  </part-list>');

  voicesToInclude.forEach((v, i) => {
    const partId = `P${i + 1}`;
    const measures = splitIntoMeasures(notesPerVoice.get(v.id) ?? [], beatsPerBar, totalBars);

    lines.push(`  <part id="${partId}">`);
    measures.forEach((m, measureIdx) => {
      lines.push(`    <measure number="${measureIdx + 1}">`);
      if (measureIdx === 0) {
        // Pick a clef per voice based on the average pitch in the entire
        // voice — bass for low voices, treble for high.
        const allPitches = (notesPerVoice.get(v.id) ?? []).map((n) => n.pitch);
        const avg = allPitches.length ? allPitches.reduce((a, b) => a + b, 0) / allPitches.length : 60;
        const useTreble = avg >= 55;
        lines.push('      <attributes>');
        lines.push(`        <divisions>${divisionsPerQuarter}</divisions>`);
        // Default: C major, no key signature. Map project scale to fifths.
        lines.push('        <key><fifths>' + scaleToFifths(project.scale) + '</fifths></key>');
        lines.push('        <time>');
        lines.push('          <beats>' + beatsPerBar + '</beats>');
        lines.push('          <beat-type>4</beat-type>');
        lines.push('        </time>');
        lines.push('        <clef>');
        lines.push(`          <sign>${useTreble ? "G" : "F"}</sign><line>${useTreble ? 2 : 4}</line>`);
        lines.push('        </clef>');
        lines.push('      </attributes>');
      }

      // Walk the measure in time; emit notes (with chord siblings) and rests
      // for gaps. Rests are quantized to the nearest standard duration; the
      // result is musically readable but not perfectly tied at unusual
      // positions.
      let cursor = 0;
      const iter = m.slice();
      while (iter.length) {
        const next = iter.shift()!;
        if (next.isChord) {
          // Shouldn't happen — chord siblings come after a primary; primary
          // emits all of them below. Skip if encountered here.
          continue;
        }
        if (next.startInMeasure > cursor + 1e-6) {
          // Rest before this note.
          emitRest(lines, next.startInMeasure - cursor, divisionsPerQuarter);
        }
        // Gather chord siblings (same start + length).
        const siblings: MeasureNote[] = [];
        while (iter.length && iter[0].isChord) siblings.push(iter.shift()!);
        emitNote(lines, next, false, divisionsPerQuarter);
        for (const s of siblings) emitNote(lines, s, true, divisionsPerQuarter);
        cursor = next.startInMeasure + next.length;
      }
      if (cursor < beatsPerBar - 1e-6) {
        emitRest(lines, beatsPerBar - cursor, divisionsPerQuarter);
      }
      lines.push('    </measure>');
    });
    lines.push('  </part>');
  });

  lines.push('</score-partwise>');
  return lines.join("\n");
}

function emitNote(lines: string[], n: MeasureNote, isChord: boolean, divPerQuarter: number) {
  const dur = nearestStdDuration(n.length);
  const divisions = Math.max(1, Math.round(dur.beats * divPerQuarter));
  const { step, alter, octave } = midiToMusicXMLPitch(n.pitch);
  lines.push('      <note>');
  if (isChord) lines.push('        <chord/>');
  lines.push('        <pitch>');
  lines.push(`          <step>${step}</step>`);
  if (alter !== 0) lines.push(`          <alter>${alter}</alter>`);
  lines.push(`          <octave>${octave}</octave>`);
  lines.push('        </pitch>');
  lines.push(`        <duration>${divisions}</duration>`);
  lines.push(`        <type>${dur.xmlType}</type>`);
  lines.push('      </note>');
}

function emitRest(lines: string[], lengthBeats: number, divPerQuarter: number) {
  const dur = nearestStdDuration(lengthBeats);
  const divisions = Math.max(1, Math.round(dur.beats * divPerQuarter));
  lines.push('      <note>');
  lines.push('        <rest/>');
  lines.push(`        <duration>${divisions}</duration>`);
  lines.push(`        <type>${dur.xmlType}</type>`);
  lines.push('      </note>');
}

// Approximate fifths for the key signature. Major mode uses tonic directly;
// minor maps to relative major (tonic + 3 semitones). Other modes map to
// closest major equivalent — a rough approximation but better than nothing.
function scaleToFifths(scale: Scale | null): number {
  if (!scale) return 0;
  const majorMap: Record<ScaleMode, number> = {
    major: 0, minor: 3, dorian: 10, phrygian: 8, lydian: -5,
    mixolydian: 5, locrian: 1, harmonic_minor: 3, melodic_minor: 3,
    minor_pentatonic: 3, major_pentatonic: 0, blues: 3,
  };
  // Circle of fifths: tonic 0 (C) → 0 fifths, 7 (G) → 1 fifth, 2 (D) → 2, etc.
  const fifthsByTonic: Record<number, number> = {
    0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5,
  };
  const offset = majorMap[scale.mode] ?? 0;
  const adjustedTonic = (scale.tonic + offset + 12) % 12;
  return fifthsByTonic[adjustedTonic];
}

// ---------- Guitar tab (ASCII) ----------

// Standard tuning, low → high.
const TAB_STRINGS = [
  { name: "E", openMidi: 40 }, // E2
  { name: "A", openMidi: 45 }, // A2
  { name: "D", openMidi: 50 }, // D3
  { name: "G", openMidi: 55 }, // G3
  { name: "B", openMidi: 59 }, // B3
  { name: "e", openMidi: 64 }, // E4
];

function pitchToTab(pitch: number): { stringIdx: number; fret: number } | null {
  // Pick the highest string whose open pitch is ≤ the target and the fret
  // ends up in [0, 24]. This puts most notes on a higher string with a low
  // fret — easier to play.
  for (let i = TAB_STRINGS.length - 1; i >= 0; i--) {
    const fret = pitch - TAB_STRINGS[i].openMidi;
    if (fret >= 0 && fret <= 24) return { stringIdx: i, fret };
  }
  return null;
}

export function exportToTab(project: Project, opts: ExportOptions): string {
  const notesPerVoice = selectNotesPerVoice(project, opts);
  const voicesToInclude = project.voices.filter((v) => opts.voiceIds.includes(v.id));
  const beatsPerBar = project.beatsPerBar;
  const colsPerBeat = Math.max(1, Math.round(1 / project.view.snap));
  const colsPerBar = beatsPerBar * colsPerBeat;

  const blocks: string[] = [];
  blocks.push(`Project: ${project.name}    Tempo: ${project.tempo} BPM    ${beatsPerBar}/4`);
  blocks.push("");

  for (const v of voicesToInclude) {
    const notes = notesPerVoice.get(v.id) ?? [];
    blocks.push(`-- ${v.name} (${v.instrument}) --`);

    if (notes.length === 0) {
      blocks.push("(no notes)");
      blocks.push("");
      continue;
    }

    const totalBeats = project.bars * beatsPerBar;
    const totalCols = totalBeats * colsPerBeat;

    // string × column grid; each cell holds the fret string ("3", "12", "-")
    const grid: string[][] = TAB_STRINGS.map(() => Array.from({ length: totalCols }, () => "-"));

    for (const n of notes) {
      const place = pitchToTab(n.pitch);
      if (!place) continue;
      const startCol = Math.round(n.start * colsPerBeat);
      if (startCol < 0 || startCol >= totalCols) continue;
      grid[place.stringIdx][startCol] = String(place.fret);
    }

    // Pad cells to a uniform width so columns line up. Two-digit frets need
    // two characters; single-digit cells pad to two as well.
    const cellWidth = 2;
    const pad = (s: string) => s.length === 1 ? s + "-" : s;

    // Render each string as a single line, with bar separators every colsPerBar.
    for (let s = TAB_STRINGS.length - 1; s >= 0; s--) {
      const cells = grid[s].map(pad);
      const bars: string[] = [];
      for (let bar = 0; bar * colsPerBar < cells.length; bar++) {
        bars.push(cells.slice(bar * colsPerBar, (bar + 1) * colsPerBar).join(""));
      }
      blocks.push(`${TAB_STRINGS[s].name}|${bars.join("|")}|`);
    }
    blocks.push("");
    void cellWidth; // silence the lint
  }

  return blocks.join("\n");
}

// ---------- Jianpu ----------

// Map MIDI to (degree, accidental) given a tonic pitch class.
function midiToJianpu(pitch: number, tonic: number, mode: ScaleMode): { degree: string; octave: number } {
  const intervals = SCALE_INTERVALS[mode];
  const tonicMidi = tonic; // pitch class
  const diff = ((pitch - tonicMidi) % 12 + 12) % 12;
  // Tonic C4 (MIDI 60) → octave 0; C5 = +1; C3 = -1.
  // We compute relative to the project's tonic at MIDI octave 4.
  const tonicReference = 60 + tonic; // MIDI of tonic at octave 4 (e.g., A=69)
  const octave = Math.round((pitch - tonicReference) / 12);

  // Find the scale degree.
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] === diff) {
      // Map index 0..6 to "1".."7" (or "1".."5" for pentatonic — fall back to
      // sharp/flat treatment for non-scale tones below).
      return { degree: String(i + 1), octave };
    }
  }
  // Not in scale: try the previous/next scale tone with an accidental.
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] === diff - 1) {
      return { degree: `#${i + 1}`, octave };
    }
    if (intervals[i] === diff + 1) {
      return { degree: `b${i + 1}`, octave };
    }
  }
  // Last resort — render as the chromatic semitone above the tonic.
  return { degree: `?${diff}`, octave };
}

function jianpuMarkOctave(degree: string, octave: number): string {
  if (octave === 0) return degree;
  if (octave > 0) return degree + "'".repeat(octave);
  return degree + ",".repeat(-octave);
}

export function exportToJianpu(project: Project, opts: ExportOptions): string {
  const notesPerVoice = selectNotesPerVoice(project, opts);
  const voicesToInclude = project.voices.filter((v) => opts.voiceIds.includes(v.id));

  const tonic = project.scale?.tonic ?? 0;       // default C
  const mode: ScaleMode = project.scale?.mode ?? "major";
  const tonicName = NOTE_NAMES[tonic];

  const blocks: string[] = [];
  blocks.push(`Project: ${project.name}`);
  blocks.push(`Key: ${tonicName} ${mode.replace("_", " ")}    Tempo: ${project.tempo} BPM    ${project.beatsPerBar}/4`);
  blocks.push("");

  const beatsPerBar = project.beatsPerBar;
  const cellsPerBeat = Math.max(1, Math.round(1 / project.view.snap));
  const totalCells = project.bars * beatsPerBar * cellsPerBeat;

  for (const v of voicesToInclude) {
    const notes = notesPerVoice.get(v.id) ?? [];
    blocks.push(`-- ${v.name} (${v.instrument}) --`);
    if (notes.length === 0) {
      blocks.push("(no notes)");
      blocks.push("");
      continue;
    }

    // For polyphony within a voice, pick the highest pitch at each cell —
    // jianpu is fundamentally a single-line notation. (Multi-voice users
    // should split into separate voices first.)
    const cell: Array<{ start: boolean; pitch: number | null }> = Array.from(
      { length: totalCells },
      () => ({ start: false, pitch: null }),
    );
    for (const n of notes) {
      const startCell = Math.round(n.start * cellsPerBeat);
      const lengthCells = Math.max(1, Math.round(n.length * cellsPerBeat));
      for (let i = 0; i < lengthCells && startCell + i < totalCells; i++) {
        const c = cell[startCell + i];
        if (c.pitch == null || n.pitch > c.pitch) {
          c.pitch = n.pitch;
          c.start = i === 0;
        }
      }
    }

    // Render: bars separated by '|', cells separated by spaces. A held note
    // is shown as '-' at its non-start cells; rests as '0'.
    let line = "| ";
    for (let i = 0; i < totalCells; i++) {
      const c = cell[i];
      let token: string;
      if (c.pitch == null) {
        token = "0";
      } else if (c.start) {
        const j = midiToJianpu(c.pitch, tonic, mode);
        token = jianpuMarkOctave(j.degree, j.octave);
      } else {
        token = "-";
      }
      line += token + " ";
      if ((i + 1) % (beatsPerBar * cellsPerBeat) === 0) line += "| ";
    }
    blocks.push(line.trim());
    blocks.push("");
  }

  blocks.push("Octave marks: ' = +1 octave (above tonic), , = -1 octave.");
  blocks.push("Sustain: '-'    Rest: '0'    Bar lines: '|'.");
  return blocks.join("\n");
}

// ---------- Suggested filename ----------

export function exportFilename(project: Project, format: ExportFormat): string {
  const safe = (project.name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = format === "musicxml" ? "musicxml" : "txt";
  return `${safe || "untitled"}.${ext}`;
}

// MIME type for the download.
export function exportMime(format: ExportFormat): string {
  return format === "musicxml" ? "application/vnd.recordare.musicxml+xml" : "text/plain";
}

// Render the body for a given format. Convenience used by the modal.
export function renderExport(format: ExportFormat, project: Project, opts: ExportOptions): string {
  if (format === "musicxml") return exportToMusicXML(project, opts);
  if (format === "tab") return exportToTab(project, opts);
  return exportToJianpu(project, opts);
}
