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
  muted: boolean;
  soloed: boolean;
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
}
