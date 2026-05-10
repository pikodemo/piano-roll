"use client";

import { create } from "zustand";
import type { History, HistorySnapshot, HistoryStep, Note, Project, Voice } from "./types";
import { clampMidi } from "./music";
import { DEFAULT_INSTRUMENT } from "./audio";
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

function snapshotOf(p: Project): HistorySnapshot {
  return {
    notes: p.notes,
    voices: p.voices,
    tempo: p.tempo,
    beatsPerBar: p.beatsPerBar,
    bars: p.bars,
    scale: p.scale,
  };
}

function applySnapshot(p: Project, s: HistorySnapshot): Project {
  return {
    ...p,
    notes: s.notes,
    voices: s.voices,
    tempo: s.tempo,
    beatsPerBar: s.beatsPerBar,
    bars: s.bars,
    scale: s.scale,
  };
}

export function makeDefaultProject(): Project {
  const voiceId = uid();
  const now = Date.now();
  const project: Project = {
    id: uid(),
    name: "Untitled",
    createdAt: now,
    updatedAt: now,
    tempo: 100,
    beatsPerBar: 4,
    bars: 8,
    scale: null,
    voices: [
      { id: voiceId, name: "Voice 1", color: VOICE_COLORS[0], instrument: DEFAULT_INSTRUMENT, volume: 1, muted: false, soloed: false },
    ],
    notes: [],
    view: {
      pixelsPerBeat: 56,
      rowHeight: 14,
      minPitch: 36, // C2
      maxPitch: 84, // C6
      snap: 0.25,
    },
    // Filled in below.
    history: { steps: {}, headId: "", redoStack: [] },
  };
  const rootId = uid();
  project.history = {
    steps: {
      [rootId]: {
        id: rootId,
        parentId: null,
        label: "New project",
        timestamp: now,
        snapshot: snapshotOf(project),
      },
    },
    headId: rootId,
    redoStack: [],
  };
  return project;
}

// Ghost notes shown by hover-preview (not persisted).
export interface PreviewNote { pitch: number; start: number; length: number }

// Editor tool modes.
export type Tool = "select" | "draw";

// Persisted UI layout (per device, in localStorage).
export interface UILayout {
  historyOpen: boolean;
  chatOpen: boolean;
  inspectorPos: "bottom" | "right";
}

const DEFAULT_LAYOUT: UILayout = {
  historyOpen: false,
  chatOpen: true,
  inspectorPos: "bottom",
};

const LAYOUT_KEY = "pianoroll-layout";

export function loadLayoutFromStorage(): UILayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayoutToStorage(layout: UILayout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignored — quota errors etc.
  }
}

// In-memory chat state used by the stage-2 agent.
export interface ChatToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  error?: boolean;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  toolCalls: ChatToolCall[];
}

interface State {
  project: Project | null;
  selectedIds: Set<string>;
  activeVoiceId: string | null;
  isPlaying: boolean;
  playheadBeat: number;
  hoverPitch: number | null;
  previewNotes: PreviewNote[];
  tool: Tool;
  layout: UILayout;
  chatMessages: ChatMessage[];
  chatBusy: boolean;
  chatError: string | null;
  // The snapshot the active agent turn started from. Set by beginAgentTurn,
  // consumed by endAgentTurn to commit one history step for the whole turn.
  agentTurnBaseStepId: string | null;
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
  updateVoice: (id: string, patch: Partial<Voice>, opts?: { label?: string | false }) => void;
  setActiveVoice: (id: string) => void;

  addNote: (n: Omit<Note, "id">) => Note;
  addNotes: (ns: Omit<Note, "id">[], opts?: { label?: string }) => Note[];
  updateNote: (id: string, patch: Partial<Note>, opts?: { label?: string }) => void;
  updateNotes: (updates: Array<{ id: string } & Partial<Note>>, opts?: { label?: string }) => void;
  deleteNotes: (ids: string[]) => void;
  transposeSelected: (semitones: number) => void;
  nudgeSelected: (beats: number) => void;

  setSelected: (ids: Iterable<string>) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  setPlaying: (playing: boolean) => void;
  setPlayhead: (beat: number) => void;
  setHoverPitch: (pitch: number | null) => void;
  setPreview: (notes: PreviewNote[]) => void;
  clearPreview: () => void;
  setTool: (tool: Tool) => void;
  setLayout: (patch: Partial<UILayout>) => void;

  appendChatMessage: (msg: ChatMessage) => void;
  patchLastAssistant: (patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => void;
  setChatBusy: (busy: boolean) => void;
  setChatError: (msg: string | null) => void;
  beginAgentTurn: () => void;
  applyAgentPatch: (project: Project) => void;
  endAgentTurn: (label: string) => void;

  moveSelectedToVoice: (voiceId: string) => void;

  undo: () => void;
  redo: () => void;
  // Jump HEAD to any step in the history tree. Editing afterwards forks from
  // that step (existing tip preserved as a separate branch).
  jumpToStep: (stepId: string) => void;
}

// How long after the last edit a same-labeled mutation collapses into the
// previous step instead of creating a new one. Critical for drag-edits, where
// every pointermove fires updateNote — without coalescing the history fills
// up with hundreds of "Move note" entries.
const COALESCE_MS = 800;

export const useStore = create<State & Actions>((set, get) => {
  // Mutate the project. `opts.label`:
  //   - undefined → "Edit" (fallback)
  //   - false → don't add a history step (transient, e.g. setSnap)
  //   - string → use as the step label (coalesce with previous step if same
  //              label and recent)
  function mutate(
    recipe: (p: Project) => Project | void,
    opts: { label?: string | false } = {},
  ) {
    const cur = get().project;
    if (!cur) return;
    const draft: Project = { ...cur, notes: [...cur.notes], voices: [...cur.voices] };
    const result = recipe(draft);
    let next = result ?? draft;
    next.updatedAt = Date.now();

    if (opts.label === false) {
      set({ project: next });
      scheduleSave(next);
      return;
    }

    const label = opts.label ?? "Edit";
    const lastStep = cur.history.steps[cur.history.headId];
    const now = Date.now();

    let history: History;
    if (lastStep && lastStep.label === label && now - lastStep.timestamp < COALESCE_MS && cur.history.redoStack.length === 0) {
      // Coalesce: replace the last step's snapshot.
      const updated: HistoryStep = {
        ...lastStep,
        snapshot: snapshotOf(next),
        timestamp: now,
      };
      history = {
        ...cur.history,
        steps: { ...cur.history.steps, [lastStep.id]: updated },
      };
    } else {
      // New step.
      const newStep: HistoryStep = {
        id: uid(),
        parentId: cur.history.headId,
        label,
        timestamp: now,
        snapshot: snapshotOf(next),
      };
      history = {
        steps: { ...cur.history.steps, [newStep.id]: newStep },
        headId: newStep.id,
        redoStack: [],
      };
    }
    next = { ...next, history };
    set({ project: next });
    scheduleSave(next);
  }

  // Move HEAD to a different step, applying that step's snapshot. Used by
  // undo / redo / jumpToStep / restore. `redoBehavior` controls how the redo
  // stack is updated.
  function gotoStep(stepId: string, redoBehavior: "clear" | "push" | "pop") {
    const cur = get().project;
    if (!cur) return;
    const step = cur.history.steps[stepId];
    if (!step) return;
    let redoStack = cur.history.redoStack;
    if (redoBehavior === "clear") {
      redoStack = [];
    } else if (redoBehavior === "push") {
      // Push the previous head onto the redo stack so redo retraces the path.
      if (cur.history.headId !== stepId) {
        redoStack = [...redoStack, cur.history.headId];
      }
    } else if (redoBehavior === "pop") {
      redoStack = redoStack.slice(0, -1);
    }
    const next: Project = {
      ...applySnapshot(cur, step.snapshot),
      updatedAt: Date.now(),
      history: { ...cur.history, headId: stepId, redoStack },
    };
    set((s) => {
      // Drop any selection IDs that no longer exist in the snapshot.
      const validIds = new Set(next.notes.map((n) => n.id));
      const sel = new Set([...s.selectedIds].filter((id) => validIds.has(id)));
      return { project: next, selectedIds: sel };
    });
    scheduleSave(next);
  }

  return {
    project: null,
    selectedIds: new Set(),
    activeVoiceId: null,
    isPlaying: false,
    playheadBeat: 0,
    hoverPitch: null,
    previewNotes: [],
    tool: "draw",
    layout: DEFAULT_LAYOUT,
    chatMessages: [],
    chatBusy: false,
    chatError: null,
    agentTurnBaseStepId: null,

    setProject: (p) => set({
      project: p,
      activeVoiceId: p.voices[0]?.id ?? null,
      selectedIds: new Set(),
      playheadBeat: 0,
      previewNotes: [],
      // Default to Select mode if the project already has notes — we'd rather
      // not have a click create a stray note on top of existing material. A
      // blank canvas opens in Draw so the user can start sketching immediately.
      tool: p.notes.length > 0 ? "select" : "draw",
      agentTurnBaseStepId: null,
    }),

    setName:  (name)  => mutate((p) => { p.name = name; }, { label: false }),
    setTempo: (bpm)   => mutate((p) => { p.tempo = Math.max(20, Math.min(300, Math.round(bpm))); }, { label: `Set tempo` }),
    setBars:  (bars)  => mutate((p) => { p.bars = Math.max(1, Math.min(64, Math.round(bars))); }, { label: `Set length` }),
    setSnap:  (snap)  => mutate((p) => { p.view = { ...p.view, snap }; }, { label: false }),
    setScale: (scale) => mutate((p) => { p.scale = scale; }, { label: scale ? `Set scale` : `Clear scale` }),

    addVoice: () => {
      const cur = get().project;
      const id = uid();
      const color = VOICE_COLORS[((cur?.voices.length ?? 0)) % VOICE_COLORS.length];
      const voice: Voice = { id, name: `Voice ${(cur?.voices.length ?? 0) + 1}`, color, instrument: DEFAULT_INSTRUMENT, volume: 1, muted: false, soloed: false };
      mutate((p) => { p.voices = [...p.voices, voice]; }, { label: "Add voice" });
      set({ activeVoiceId: id });
      return voice;
    },
    removeVoice: (id) => {
      const cur = get().project;
      if (!cur || cur.voices.length <= 1) return;
      mutate((p) => {
        p.voices = p.voices.filter((v) => v.id !== id);
        p.notes = p.notes.filter((n) => n.voiceId !== id);
      }, { label: "Delete voice" });
      const remaining = get().project?.voices ?? [];
      if (get().activeVoiceId === id) set({ activeVoiceId: remaining[0]?.id ?? null });
    },
    // Default labels per kind of voice change. Volume slider is `false` so
    // the slider doesn't fill history with thousands of tiny commits.
    updateVoice: (id, patch, opts) => {
      let label: string | false;
      if (opts?.label !== undefined) label = opts.label;
      else if (patch.name !== undefined) label = "Rename voice";
      else if (patch.instrument !== undefined) label = "Change instrument";
      else if (patch.color !== undefined) label = "Recolor voice";
      else if (patch.muted !== undefined) label = "Mute voice";
      else if (patch.soloed !== undefined) label = "Solo voice";
      else if (patch.volume !== undefined) label = false;
      else label = "Update voice";
      mutate((p) => {
        p.voices = p.voices.map((v) => v.id === id ? { ...v, ...patch } : v);
      }, { label });
    },
    setActiveVoice: (id) => set({ activeVoiceId: id }),

    addNote: (n) => {
      const note: Note = { id: uid(), ...n, pitch: clampMidi(n.pitch) };
      mutate((p) => { p.notes = [...p.notes, note]; }, { label: "Add note" });
      return note;
    },
    addNotes: (ns, opts) => {
      const created: Note[] = ns.map((n) => ({ id: uid(), ...n, pitch: clampMidi(n.pitch) }));
      const label = opts?.label ?? `Add ${created.length} note${created.length === 1 ? "" : "s"}`;
      mutate((p) => { p.notes = [...p.notes, ...created]; }, { label });
      return created;
    },
    updateNote: (id, patch, opts) => {
      const label = opts?.label ?? (patch.length !== undefined ? "Resize note" : "Move note");
      mutate((p) => {
        p.notes = p.notes.map((n) => n.id === id ? { ...n, ...patch, pitch: patch.pitch !== undefined ? clampMidi(patch.pitch) : n.pitch } : n);
      }, { label });
    },
    updateNotes: (updates, opts) => {
      const label = opts?.label ?? "Move notes";
      mutate((p) => {
        const map = new Map(updates.map((u) => [u.id, u]));
        p.notes = p.notes.map((n) => {
          const u = map.get(n.id);
          if (!u) return n;
          const next = { ...n, ...u };
          if (u.pitch !== undefined) next.pitch = clampMidi(u.pitch);
          return next;
        });
      }, { label });
    },
    deleteNotes: (ids) => {
      const set_ = new Set(ids);
      const label = ids.length === 1 ? "Delete note" : `Delete ${ids.length} notes`;
      mutate((p) => { p.notes = p.notes.filter((n) => !set_.has(n.id)); }, { label });
      set((s) => {
        const next = new Set(s.selectedIds);
        for (const id of ids) next.delete(id);
        return { selectedIds: next };
      });
    },
    transposeSelected: (semitones) => {
      const ids = get().selectedIds;
      if (ids.size === 0) return;
      const label = `Transpose ${semitones >= 0 ? "+" : ""}${semitones}`;
      mutate((p) => {
        p.notes = p.notes.map((n) => ids.has(n.id) ? { ...n, pitch: clampMidi(n.pitch + semitones) } : n);
      }, { label });
    },
    nudgeSelected: (beats) => {
      const ids = get().selectedIds;
      if (ids.size === 0) return;
      mutate((p) => {
        p.notes = p.notes.map((n) => ids.has(n.id) ? { ...n, start: Math.max(0, n.start + beats) } : n);
      }, { label: "Nudge" });
    },
    moveSelectedToVoice: (voiceId) => {
      const ids = get().selectedIds;
      if (ids.size === 0) return;
      mutate((p) => {
        if (!p.voices.some((v) => v.id === voiceId)) return;
        p.notes = p.notes.map((n) => ids.has(n.id) ? { ...n, voiceId } : n);
      }, { label: "Move to voice" });
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
    setPreview: (notes) => set({ previewNotes: notes }),
    clearPreview: () => set((s) => s.previewNotes.length === 0 ? s : { previewNotes: [] }),
    setTool: (tool) => set({ tool }),
    setLayout: (patch) => set((s) => {
      const next = { ...s.layout, ...patch };
      saveLayoutToStorage(next);
      return { layout: next };
    }),

    appendChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
    patchLastAssistant: (patch) => set((s) => {
      const idx = (() => {
        for (let i = s.chatMessages.length - 1; i >= 0; i--) {
          if (s.chatMessages[i].role === "assistant") return i;
        }
        return -1;
      })();
      if (idx === -1) return s;
      const cur = s.chatMessages[idx];
      const p = typeof patch === "function" ? patch(cur) : patch;
      const next = { ...cur, ...p };
      const list = [...s.chatMessages];
      list[idx] = next;
      return { chatMessages: list };
    }),
    setChatBusy: (busy) => set({ chatBusy: busy }),
    setChatError: (msg) => set({ chatError: msg }),

    // Remember the HEAD step at turn start, so endAgentTurn can decide whether
    // anything actually changed and emit one consolidated history step.
    beginAgentTurn: () => set((s) => ({
      agentTurnBaseStepId: s.project?.history.headId ?? null,
    })),
    // Replace project state without committing a history step. The agent
    // streams patches through here while the LLM is still talking.
    applyAgentPatch: (project) => {
      const cur = get().project;
      if (!cur) return;
      // Preserve the existing history (in particular: don't let the agent's
      // patch overwrite headId / steps if it ever included them).
      const next: Project = { ...project, history: cur.history, updatedAt: Date.now() };
      set({ project: next });
      scheduleSave(next);
    },
    endAgentTurn: (label) => {
      const cur = get().project;
      const baseStepId = get().agentTurnBaseStepId;
      if (!cur || !baseStepId) {
        set({ agentTurnBaseStepId: null });
        return;
      }
      const baseStep = cur.history.steps[baseStepId];
      // Only commit if state actually changed compared to the turn's start.
      const same = baseStep && JSON.stringify(snapshotOf(cur)) === JSON.stringify(baseStep.snapshot);
      if (same) {
        set({ agentTurnBaseStepId: null });
        return;
      }
      const newStep: HistoryStep = {
        id: uid(),
        // Branch from the baseStep so the agent's edits live as a single step
        // off the position where the user invoked the agent, even if the user
        // had scrubbed elsewhere meanwhile.
        parentId: baseStepId,
        label,
        timestamp: Date.now(),
        snapshot: snapshotOf(cur),
      };
      const history: History = {
        steps: { ...cur.history.steps, [newStep.id]: newStep },
        headId: newStep.id,
        redoStack: [],
      };
      const next: Project = { ...cur, history, updatedAt: Date.now() };
      set({ project: next, agentTurnBaseStepId: null });
      scheduleSave(next);
    },

    undo: () => {
      const cur = get().project;
      if (!cur) return;
      const head = cur.history.steps[cur.history.headId];
      if (!head?.parentId) return;
      const prevHeadId = head.id;
      const cur1 = get().project!;
      const next: Project = {
        ...applySnapshot(cur1, cur.history.steps[head.parentId].snapshot),
        updatedAt: Date.now(),
        history: {
          ...cur1.history,
          headId: head.parentId,
          redoStack: [...cur1.history.redoStack, prevHeadId],
        },
      };
      set((s) => {
        const validIds = new Set(next.notes.map((n) => n.id));
        const sel = new Set([...s.selectedIds].filter((id) => validIds.has(id)));
        return { project: next, selectedIds: sel };
      });
      scheduleSave(next);
    },
    redo: () => {
      const cur = get().project;
      if (!cur) return;
      const stack = cur.history.redoStack;
      if (stack.length === 0) return;
      const targetId = stack[stack.length - 1];
      const target = cur.history.steps[targetId];
      if (!target) return;
      gotoStep(targetId, "pop");
    },
    jumpToStep: (stepId) => {
      gotoStep(stepId, "clear");
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

// ---------- Public history helpers ----------

// Path from root to HEAD (chronological order). Used by the slider.
export function currentHistoryPath(project: Project | null): HistoryStep[] {
  if (!project) return [];
  const path: HistoryStep[] = [];
  let cur: HistoryStep | undefined = project.history.steps[project.history.headId];
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? project.history.steps[cur.parentId] : undefined;
  }
  return path;
}

// All branch tips (steps with no children), excluding HEAD. Used by the
// "branches" picker so the user can switch back to a previously-cut path.
export function historyBranches(project: Project | null): HistoryStep[] {
  if (!project) return [];
  const childCount = new Map<string, number>();
  for (const s of Object.values(project.history.steps)) {
    if (s.parentId) childCount.set(s.parentId, (childCount.get(s.parentId) ?? 0) + 1);
  }
  return Object.values(project.history.steps)
    .filter((s) => (childCount.get(s.id) ?? 0) === 0 && s.id !== project.history.headId)
    .sort((a, b) => b.timestamp - a.timestamp);
}
