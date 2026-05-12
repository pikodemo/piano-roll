"use client";

import { useStore } from "@/lib/store";
import { getAudioStartTime, scheduleNotes, scheduleMetronome, startMetronome, type ScheduledNote } from "@/lib/audio";
import { useEffect, useRef, useState } from "react";
import type { ScaleMode } from "@/lib/music";
import { NOTE_NAMES, midiToName } from "@/lib/music";
import { ProjectsMenu } from "./ProjectsMenu";
import { getMIDIAccess, listInputs, subscribe as subscribeMIDI, watchDevices, type MIDIDeviceInfo } from "@/lib/midi";
import { startRecording, type DetectedNote, type RecordHandle } from "@/lib/audio-capture";
import { ExportModal } from "./ExportModal";

const SNAP_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "1/1", value: 4 },
  { label: "1/2", value: 2 },
  { label: "1/4", value: 1 },
  { label: "1/8", value: 0.5 },
  { label: "1/16", value: 0.25 },
  { label: "1/32", value: 0.125 },
];

const MODES: ScaleMode[] = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "harmonic_minor", "melodic_minor", "minor_pentatonic", "major_pentatonic", "blues"];

type RecordSource = "mic" | "midi";
type RecordedNote = DetectedNote & { velocity?: number };

interface MIDIRecordHandle {
  stop: () => { notes: RecordedNote[] };
  currentMidi: () => number | null;
}

function startMIDIRecording(): MIDIRecordHandle {
  const startedAt = performance.now();
  const notes: RecordedNote[] = [];
  const active = new Map<number, { startSec: number; velocity: number }>();
  let lastMidi: number | null = null;

  const nowSec = () => (performance.now() - startedAt) / 1000;
  const finishNote = (midi: number, endSec: number) => {
    const held = active.get(midi);
    if (!held) return;
    active.delete(midi);
    notes.push({
      midi,
      startSec: held.startSec,
      lengthSec: Math.max(0, endSec - held.startSec),
      velocity: held.velocity,
    });
  };

  const unsubscribe = subscribeMIDI((event) => {
    const t = nowSec();
    if (event.type === "noteOn") {
      finishNote(event.note, t);
      active.set(event.note, { startSec: t, velocity: event.velocity });
      lastMidi = event.note;
      return;
    }
    finishNote(event.note, t);
    if (lastMidi === event.note) {
      lastMidi = [...active.keys()].pop() ?? null;
    }
  });

  return {
    currentMidi: () => lastMidi,
    stop: () => {
      const endSec = nowSec();
      unsubscribe();
      for (const midi of active.keys()) finishNote(midi, endSec);
      return { notes: notes.filter((n) => n.lengthSec > 0) };
    },
  };
}

function RecordButton() {
  const project = useStore((s) => s.project);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const playheadBeat = useStore((s) => s.playheadBeat);
  const addNotes = useStore((s) => s.addNotes);
  const setSelected = useStore((s) => s.setSelected);
  const layout = useStore((s) => s.layout);

  const [recording, setRecording] = useState(false);
  const [source, setSource] = useState<RecordSource>("mic");
  const [devices, setDevices] = useState<MIDIDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [livePitch, setLivePitch] = useState<number | null>(null);
  const handleRef = useRef<RecordHandle | null>(null);
  const midiHandleRef = useRef<MIDIRecordHandle | null>(null);
  const startBeatRef = useRef(0);
  const tempoRef = useRef(120);
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMetronomeRef = useRef<(() => void) | null>(null);
  const recordTempo = project?.tempo;
  const recordBeatsPerBar = project?.beatsPerBar;

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const access = await getMIDIAccess();
      if (!access || cancelled) return;
      unsub = watchDevices((next) => {
        setDevices(next);
        if (next.length === 0) setSource("mic");
      });
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  async function start() {
    if (!project || !activeVoiceId) return;
    setError(null);
    try {
      const handle = source === "midi"
        ? (() => {
            if (listInputs().length === 0) throw new Error("No MIDI input connected");
            return startMIDIRecording();
          })()
        : await startRecording();
      if (source === "midi") {
        midiHandleRef.current = handle as MIDIRecordHandle;
      } else {
        handleRef.current = handle as RecordHandle;
      }
      // Anchor the recording to the current playhead position so the notes
      // line up with whatever the user is overdubbing onto.
      startBeatRef.current = playheadBeat;
      tempoRef.current = project.tempo;
      setRecording(true);
      // Poll the live pitch a few times per second for the UI indicator.
      livePollRef.current = setInterval(() => {
        setLivePitch(handle.currentMidi());
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stop() {
    if ((!handleRef.current && !midiHandleRef.current) || !project || !activeVoiceId) return;
    if (livePollRef.current) { clearInterval(livePollRef.current); livePollRef.current = null; }
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    setRecording(false);
    setLivePitch(null);
    const detected: RecordedNote[] = handleRef.current
      ? (await handleRef.current.stop()).notes
      : midiHandleRef.current!.stop().notes;
    handleRef.current = null;
    midiHandleRef.current = null;
    if (detected.length === 0) return;
    const beatSec = 60 / tempoRef.current;
    const snap = project.view.snap;
    const created = detected.map((n) => {
      const startBeat = startBeatRef.current + n.startSec / beatSec;
      const lengthBeat = Math.max(snap, n.lengthSec / beatSec);
      // Snap start to the grid; round so the closest grid line wins (we don't
      // need the cursor-inside-cell guarantee here, that was a click-time UX
      // concern).
      const snappedStart = Math.round(startBeat / snap) * snap;
      const snappedLength = Math.max(snap, Math.round(lengthBeat / snap) * snap);
      return {
        voiceId: activeVoiceId,
        pitch: n.midi,
        start: Math.max(0, snappedStart),
        length: snappedLength,
        velocity: n.velocity ?? 0.85,
      };
    });
    const added = addNotes(created, { label: source === "midi" ? "Record MIDI" : undefined });
    setSelected(added.map((n) => n.id));
  }

  // Cleanup if the component unmounts mid-recording.
  useEffect(() => {
    if (!recording || recordTempo == null || recordBeatsPerBar == null) return;
    tempoRef.current = recordTempo;
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
    if (!layout.metronome) return;
    const startAt = getAudioStartTime(0.05);
    stopMetronomeRef.current = startMetronome(recordTempo, recordBeatsPerBar, 0.05, startAt);
    return () => {
      stopMetronomeRef.current?.();
      stopMetronomeRef.current = null;
    };
  }, [layout.metronome, recordBeatsPerBar, recordTempo, recording]);

  useEffect(() => () => {
    if (livePollRef.current) clearInterval(livePollRef.current);
    stopMetronomeRef.current?.();
    if (handleRef.current) handleRef.current.stop().catch(() => {});
    if (midiHandleRef.current) midiHandleRef.current.stop();
  }, []);

  return (
    <div className="flex items-center gap-2">
      {devices.length > 0 && (
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as RecordSource)}
          disabled={recording}
          className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-gray-100 disabled:opacity-60"
          title={`Recording input: ${devices.map((d) => d.name).join(", ")}`}
          aria-label="Recording input"
        >
          <option value="mic">Mic</option>
          <option value="midi">MIDI</option>
        </select>
      )}
      <button
        onClick={() => recording ? void stop() : void start()}
        className={
          recording
            ? "rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
            : "rounded bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-100 hover:bg-gray-700"
        }
        title={
          recording
            ? "Stop recording"
            : source === "midi"
              ? "Record from the connected MIDI keyboard into the active voice"
              : "Record from microphone (transcribes pitch to notes in the active voice)"
        }
      >
        <span className={recording ? "inline-block h-2 w-2 rounded-full bg-red-200 mr-1 animate-pulse" : "inline-block h-2 w-2 rounded-full bg-red-500 mr-1"} />
        {recording ? "Stop" : source === "midi" ? "Rec MIDI" : "Rec"}
      </button>
      {recording && (
        <span className="text-xs text-gray-400 font-mono">
          {livePitch != null ? midiToName(livePitch) : "—"}
        </span>
      )}
      {error && <span className="text-xs text-red-400" title={error}>rec err</span>}
    </div>
  );
}

function ExportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
        title="Export to sheet music, guitar tab, or Jianpu"
      >
        ↓ Export
      </button>
      <ExportModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LayoutToggles() {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const cls = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-medium ${active ? "bg-white text-gray-900" : "bg-gray-800 text-gray-200 hover:bg-gray-700"}`;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Layout">
      <button
        onClick={() => setLayout({ historyOpen: !layout.historyOpen })}
        className={cls(layout.historyOpen)}
        title={layout.historyOpen ? "Hide history panel" : "Show history panel (left column)"}
        aria-pressed={layout.historyOpen}
      >
        ≡ History
      </button>
      <button
        onClick={() => setLayout({ inspectorPos: layout.inspectorPos === "bottom" ? "right" : "bottom" })}
        className="rounded bg-gray-800 px-2 py-1 text-xs font-medium text-gray-200 hover:bg-gray-700"
        title={`Inspector position: ${layout.inspectorPos} — click to move ${layout.inspectorPos === "bottom" ? "to right column" : "to bottom"}`}
      >
        Inspector {layout.inspectorPos === "bottom" ? "⬇" : "➡"}
      </button>
      <button
        onClick={() => setLayout({ chatOpen: !layout.chatOpen })}
        className={cls(layout.chatOpen)}
        title={layout.chatOpen ? "Hide chat panel" : "Show chat panel (right column)"}
        aria-pressed={layout.chatOpen}
      >
        💬 Chat
      </button>
    </div>
  );
}

function MIDIStatus() {
  const [devices, setDevices] = useState<MIDIDeviceInfo[]>([]);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const access = await getMIDIAccess();
      if (!access || cancelled) return;
      unsub = watchDevices(setDevices);
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);
  if (devices.length === 0) return null;
  return (
    <span
      className="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200"
      title={devices.map((d) => `${d.name}${d.manufacturer ? ` (${d.manufacturer})` : ""}`).join(", ")}
    >
      🎹 {devices.length === 1 ? devices[0].name : `${devices.length} MIDI devices`}
    </span>
  );
}

function ToolToggle() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  // Keyboard shortcuts: V = select, B = draw (Photoshop convention).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "v" || e.key === "V") { e.preventDefault(); setTool("select"); }
      else if (e.key === "b" || e.key === "B") { e.preventDefault(); setTool("draw"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);
  const cls = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-semibold ${active ? "bg-white text-gray-900" : "bg-gray-800 text-gray-200 hover:bg-gray-700"}`;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Tool">
      <button
        onClick={() => setTool("select")}
        className={cls(tool === "select")}
        title="Select (V) — click-drag for marquee, click notes to select"
        aria-pressed={tool === "select"}
      >
        ⬚ Select
      </button>
      <button
        onClick={() => setTool("draw")}
        className={cls(tool === "draw")}
        title="Draw (B) — click in the grid to add a note"
        aria-pressed={tool === "draw"}
      >
        ✎ Draw
      </button>
    </div>
  );
}

export function Toolbar() {
  const project = useStore((s) => s.project);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const setTempo = useStore((s) => s.setTempo);
  const setBars = useStore((s) => s.setBars);
  const setSnap = useStore((s) => s.setSnap);
  const setName = useStore((s) => s.setName);
  const setScale = useStore((s) => s.setScale);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const stopRef = useRef<(() => void) | null>(null);
  const stopMetronomeRef = useRef<(() => void) | null>(null);

  // Space toggles play/stop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, isPlaying]);

  function buildEvents(): ScheduledNote[] {
    if (!project) return [];
    const soloed = project.voices.some((v) => v.soloed);
    const voiceById = new Map(project.voices.map((v) => [v.id, v]));
    return project.notes
      .filter((n) => {
        const v = voiceById.get(n.voiceId);
        if (!v) return false;
        if (soloed) return v.soloed;
        return !v.muted;
      })
      .map((n) => {
        const v = voiceById.get(n.voiceId);
        return {
          midi: n.pitch,
          startBeat: n.start,
          lengthBeat: n.length,
          velocity: n.velocity,
          volume: v?.volume ?? 1,
          instrument: v?.instrument,
        };
      });
  }

  function stopAll() {
    stopRef.current?.();
    stopRef.current = null;
    stopMetronomeRef.current?.();
    stopMetronomeRef.current = null;
  }

  function startCycle() {
    if (!project) return;
    const events = buildEvents();
    // Read latest layout state so toggling Loop / Metro mid-playback affects
    // the next cycle without needing to restart manually.
    const latestLayout = useStore.getState().layout;
    if (events.length === 0 && !latestLayout.metronome) {
      setPlaying(false);
      setPlayhead(0);
      return;
    }
    // Loop boundary is the end of the last note; falls back to the project
    // length when there are no notes (metronome-only).
    const lastNoteEnd = events.reduce((m, e) => Math.max(m, e.startBeat + e.lengthBeat), 0);
    const projectBeats = project.bars * project.beatsPerBar;
    const loopBeats = lastNoteEnd > 0 ? lastNoteEnd : projectBeats;

    const startOffsetSec = 0.05;
    const startAt = getAudioStartTime(startOffsetSec);
    if (latestLayout.metronome) {
      const metroBeats = latestLayout.loop ? Math.max(1, Math.ceil(loopBeats)) : projectBeats;
      stopMetronomeRef.current = scheduleMetronome(
        project.tempo,
        metroBeats,
        project.beatsPerBar,
        startOffsetSec,
        startAt,
      );
    }
    if (events.length === 0) {
      // Metronome-only playback: tick the playhead manually until the end.
      const startMs = performance.now() + startOffsetSec * 1000;
      const beatMs = 60000 / project.tempo;
      let raf = 0;
      const tick = () => {
        const b = Math.max(0, (performance.now() - startMs) / beatMs);
        if (b >= loopBeats) {
          stopAll();
          if (useStore.getState().layout.loop) {
            startCycle();
          } else {
            setPlaying(false);
            setPlayhead(0);
          }
          return;
        }
        setPlayhead(b);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      stopRef.current = () => cancelAnimationFrame(raf);
      return;
    }
    stopRef.current = scheduleNotes(
      events,
      project.tempo,
      0.05,
      (b) => setPlayhead(b),
      () => {
        stopAll();
        if (useStore.getState().layout.loop) {
          startCycle();
        } else {
          setPlaying(false);
          setPlayhead(0);
        }
      },
      startAt,
    );
  }

  function toggle() {
    if (!project) return;
    if (isPlaying) {
      stopAll();
      setPlaying(false);
      setPlayhead(0);
      return;
    }
    setPlaying(true);
    startCycle();
  }

  if (!project) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100">
      <ProjectsMenu />
      <LayoutToggles />
      <span className="h-5 w-px bg-gray-700" />
      <ToolToggle />
      <button
        onClick={toggle}
        className="rounded bg-blue-600 px-3 py-1 font-semibold hover:bg-blue-500"
        aria-label={isPlaying ? "Stop" : "Play"}
      >
        {isPlaying ? "■ Stop" : "▶ Play"}
      </button>
      <button
        onClick={() => setLayout({ metronome: !layout.metronome })}
        className={
          layout.metronome
            ? "rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-gray-900 hover:bg-amber-400"
            : "rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-700"
        }
        aria-pressed={layout.metronome}
        title={layout.metronome ? "Metronome on — click to disable" : "Metronome off — click to enable"}
      >
        ♩ Metro
      </button>
      <button
        onClick={() => setLayout({ loop: !layout.loop })}
        className={
          layout.loop
            ? "rounded bg-sky-500 px-2 py-1 text-xs font-semibold text-gray-900 hover:bg-sky-400"
            : "rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-700"
        }
        aria-pressed={layout.loop}
        title={layout.loop ? "Loop on — playback restarts after the last note" : "Loop off — click to repeat playback from start to last note"}
      >
        ↻ Loop
      </button>
      <RecordButton />
      <ExportButton />
      <MIDIStatus />
      <div className="flex items-center gap-1">
        <label className="text-gray-400">Tempo</label>
        <input
          type="number"
          min={20}
          max={300}
          value={project.tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
          className="w-16 rounded bg-gray-800 px-2 py-1 text-right"
        />
        <span className="text-gray-500">BPM</span>
      </div>
      <div className="flex items-center gap-1">
        <label className="text-gray-400">Bars</label>
        <input
          type="number"
          min={1}
          max={64}
          value={project.bars}
          onChange={(e) => setBars(Number(e.target.value))}
          className="w-14 rounded bg-gray-800 px-2 py-1 text-right"
        />
      </div>
      <div className="flex items-center gap-1">
        <label className="text-gray-400">Snap</label>
        <select
          value={String(project.view.snap)}
          onChange={(e) => setSnap(Number(e.target.value))}
          className="rounded bg-gray-800 px-2 py-1"
        >
          {SNAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <label className="text-gray-400">Scale</label>
        <select
          value={project.scale ? `${project.scale.tonic}-${project.scale.mode}` : ""}
          onChange={(e) => {
            if (!e.target.value) { setScale(null); return; }
            const [tonic, mode] = e.target.value.split("-");
            setScale({ tonic: Number(tonic), mode: mode as ScaleMode });
          }}
          className="rounded bg-gray-800 px-2 py-1"
        >
          <option value="">none</option>
          {NOTE_NAMES.map((n, i) => MODES.map((m) => (
            <option key={`${i}-${m}`} value={`${i}-${m}`}>{n} {m.replace("_", " ")}</option>
          )))}
        </select>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={undo} className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">Undo</button>
        <button onClick={redo} className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">Redo</button>
        <input
          value={project.name}
          onChange={(e) => setName(e.target.value)}
          className="w-44 rounded bg-gray-800 px-2 py-1"
        />
      </div>
    </div>
  );
}
