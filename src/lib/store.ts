"use client";

import { create } from "zustand";
import type { Note, Project, Voice } from "./types";
import { clampMidi } from "./music";
import { saveProject } from "./storage";

const VOICE_COLORS = [
  "#60a5fa", // blue
  "#f472b6", // pink
  "#34d399", // green
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#f87171", // red
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function makeDefaultProject(): Project {
  const voiceId = uid();
  const now = Date.now();
  return {
    id: uid(),
    name: "Untitled",
    createdAt: now,
    updatedAt: now,
    tempo: 100,
    beatsPerBar: 4,
    bars: 8,
    scale: null,
    voices: [
      { id: voiceId, name: "Voice 1", color: VOICE_COLORS[0], muted: false, soloed: false },
    ],
    notes: [],
    view: {
      pixelsPerBeat: 56,
      rowHeight: 14,
      minPitch: 36, // C2
      maxPitch: 84, // C6
      snap: 0.25,
    },
  };
}

interface Snapshot {
  notes: Note[];
  voices: Voice[];
  tempo: number;
  bars: number;
  scale: Project["scale"];
}

interface State {
  project: Project | null;
  selectedIds: Set<string>;
  activeVoiceId: string | null;
  isPlaying: boolean;
  playheadBeat: number;
  hoverPitch: number | null;
  past: Snapshot[];
  future: Snapshot[];
}

interface Actions {
  setProject: (p: Project) => void;
  setName: (name: string) => void;
  setTempo: (bpm: number) => void;
  setBars: (bars: number) => void;
  setSnap: (snap: number) => void;
  setScale: (scale: Project["scale"]) => void;

  addVoice: () => Voice;
  removeVoice: (id: string) => void;
  updateVoice: (id: string, patch: Partial<Voice>) => void;
  setActiveVoice: (id: string) => void;

  addNote: (n: Omit<Note, "id">) => Note;
  addNotes: (ns: Omit<Note, "id">[]) => Note[];
  updateNote: (id: string, patch: Partial<Note>) => void;
  updateNotes: (updates: Array<{ id: string } & Partial<Note>>) => void;
  deleteNotes: (ids: string[]) => void;
  transposeSelected: (semitones: number) => void;
  nudgeSelected: (beats: number) => void;

  setSelected: (ids: Iterable<string>) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  setPlaying: (playing: boolean) => void;
  setPlayhead: (beat: number) => void;
  setHoverPitch: (pitch: number | null) => void;

  undo: () => void;
  redo: () => void;
}

export const useStore = create<State & Actions>((set, get) => {
  const snap = (p: Project): Snapshot => ({
    notes: p.notes,
    voices: p.voices,
    tempo: p.tempo,
    bars: p.bars,
    scale: p.scale,
  });

  // Mutate the project, push the previous snapshot to undo, schedule a save.
  const mutate = (recipe: (p: Project) => Project | void, opts?: { history?: boolean }) => {
    const cur = get().project;
    if (!cur) return;
    const prev = snap(cur);
    const draft: Project = { ...cur, notes: [...cur.notes], voices: [...cur.voices] };
    const result = recipe(draft);
    const next = result ?? draft;
    next.updatedAt = Date.now();
    set((s) => ({
      project: next,
      past: opts?.history === false ? s.past : [...s.past.slice(-49), prev],
      future: opts?.history === false ? s.future : [],
    }));
    scheduleSave(next);
  };

  return {
    project: null,
    selectedIds: new Set(),
    activeVoiceId: null,
    isPlaying: false,
    playheadBeat: 0,
    hoverPitch: null,
    past: [],
    future: [],

    setProject: (p) => set({
      project: p,
      activeVoiceId: p.voices[0]?.id ?? null,
      selectedIds: new Set(),
      past: [],
      future: [],
      playheadBeat: 0,
    }),

    setName:  (name)  => mutate((p) => { p.name = name; }, { history: false }),
    setTempo: (bpm)   => mutate((p) => { p.tempo = Math.max(20, Math.min(300, Math.round(bpm))); }),
    setBars:  (bars)  => mutate((p) => { p.bars = Math.max(1, Math.min(64, Math.round(bars))); }),
    setSnap:  (snap)  => mutate((p) => { p.view = { ...p.view, snap }; }, { history: false }),
    setScale: (scale) => mutate((p) => { p.scale = scale; }),

    addVoice: () => {
      const cur = get().project;
      const id = uid();
      const color = VOICE_COLORS[((cur?.voices.length ?? 0)) % VOICE_COLORS.length];
      const voice: Voice = { id, name: `Voice ${(cur?.voices.length ?? 0) + 1}`, color, muted: false, soloed: false };
      mutate((p) => { p.voices = [...p.voices, voice]; });
      set({ activeVoiceId: id });
      return voice;
    },
    removeVoice: (id) => {
      const cur = get().project;
      if (!cur || cur.voices.length <= 1) return;
      mutate((p) => {
        p.voices = p.voices.filter((v) => v.id !== id);
        p.notes = p.notes.filter((n) => n.voiceId !== id);
      });
      const remaining = get().project?.voices ?? [];
      if (get().activeVoiceId === id) set({ activeVoiceId: remaining[0]?.id ?? null });
    },
    updateVoice: (id, patch) => mutate((p) => {
      p.voices = p.voices.map((v) => v.id === id ? { ...v, ...patch } : v);
    }),
    setActiveVoice: (id) => set({ activeVoiceId: id }),

    addNote: (n) => {
      const note: Note = { id: uid(), ...n, pitch: clampMidi(n.pitch) };
      mutate((p) => { p.notes = [...p.notes, note]; });
      return note;
    },
    addNotes: (ns) => {
      const created: Note[] = ns.map((n) => ({ id: uid(), ...n, pitch: clampMidi(n.pitch) }));
      mutate((p) => { p.notes = [...p.notes, ...created]; });
      return created;
    },
    updateNote: (id, patch) => mutate((p) => {
      p.notes = p.notes.map((n) => n.id === id ? { ...n, ...patch, pitch: patch.pitch !== undefined ? clampMidi(patch.pitch) : n.pitch } : n);
    }),
    updateNotes: (updates) => mutate((p) => {
      const map = new Map(updates.map((u) => [u.id, u]));
      p.notes = p.notes.map((n) => {
        const u = map.get(n.id);
        if (!u) return n;
        const next = { ...n, ...u };
        if (u.pitch !== undefined) next.pitch = clampMidi(u.pitch);
        return next;
      });
    }),
    deleteNotes: (ids) => {
      const set_ = new Set(ids);
      mutate((p) => { p.notes = p.notes.filter((n) => !set_.has(n.id)); });
      set((s) => {
        const next = new Set(s.selectedIds);
        for (const id of ids) next.delete(id);
        return { selectedIds: next };
      });
    },
    transposeSelected: (semitones) => {
      const ids = get().selectedIds;
      mutate((p) => {
        p.notes = p.notes.map((n) => ids.has(n.id) ? { ...n, pitch: clampMidi(n.pitch + semitones) } : n);
      });
    },
    nudgeSelected: (beats) => {
      const ids = get().selectedIds;
      mutate((p) => {
        p.notes = p.notes.map((n) => ids.has(n.id) ? { ...n, start: Math.max(0, n.start + beats) } : n);
      });
    },

    setSelected: (ids) => set({ selectedIds: new Set(ids) }),
    toggleSelected: (id, additive) => set((s) => {
      const next = new Set(additive ? s.selectedIds : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
    clearSelection: () => set({ selectedIds: new Set() }),

    setPlaying: (playing) => set({ isPlaying: playing }),
    setPlayhead: (beat) => set({ playheadBeat: beat }),
    setHoverPitch: (pitch) => set({ hoverPitch: pitch }),

    undo: () => {
      const { past, project } = get();
      if (!project || past.length === 0) return;
      const prev = past[past.length - 1];
      const newPast = past.slice(0, -1);
      const cur = snap(project);
      const next: Project = { ...project, ...prev, updatedAt: Date.now() };
      set({ project: next, past: newPast, future: [...get().future, cur] });
      scheduleSave(next);
    },
    redo: () => {
      const { future, project } = get();
      if (!project || future.length === 0) return;
      const fwd = future[future.length - 1];
      const newFuture = future.slice(0, -1);
      const cur = snap(project);
      const next: Project = { ...project, ...fwd, updatedAt: Date.now() };
      set({ project: next, future: newFuture, past: [...get().past, cur] });
      scheduleSave(next);
    },
  };
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(project: Project) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveProject(project).catch((err) => console.error("save failed", err));
  }, 250);
}
