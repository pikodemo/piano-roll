import type { Scale } from "./music";
import type { InstrumentId } from "./audio";

export interface Note {
  id: string;
  voiceId: string;
  pitch: number;     // MIDI 0-127
  start: number;     // beats from project start
  length: number;    // beats
  velocity: number;  // 0-1
}

export interface Voice {
  id: string;
  name: string;
  color: string;     // hex
  instrument: InstrumentId;
  volume: number;    // 0-1, multiplies note velocity at playback time
  muted: boolean;
  soloed: boolean;
}

// ---------- History ----------
//
// Every edit produces a `HistoryStep`. Steps form a tree: each step has one
// `parentId`, and "branches" are the leaves of that tree (steps with no
// children). Restoring to a previous step + editing creates a child off that
// step, leaving the prior tip preserved as a separate branch.

export interface HistorySnapshot {
  notes: Note[];
  voices: Voice[];
  tempo: number;
  beatsPerBar: number;
  bars: number;
  scale: Scale | null;
}

export interface HistoryStep {
  id: string;
  parentId: string | null;
  label: string;       // human-readable, e.g. "Add note", "Transpose +12"
  timestamp: number;
  snapshot: HistorySnapshot;
}

export interface History {
  steps: Record<string, HistoryStep>;
  headId: string;
  // Linear redo path: stack of steps the user just undid (cleared by any
  // non-redo action). Powers Cmd-Shift-Z without forcing the user to think
  // about the tree.
  redoStack: string[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectMeta {
  tempo: number;            // BPM
  beatsPerBar: number;      // numerator of time sig (denominator assumed 4)
  bars: number;             // total length in bars
  scale: Scale | null;      // optional working scale/tonic
  voices: Voice[];
  notes: Note[];
  view: {
    pixelsPerBeat: number;
    rowHeight: number;
    minPitch: number;
    maxPitch: number;
    snap: number;           // beats; e.g. 0.25 = 1/16
  };
  history: History;
}
