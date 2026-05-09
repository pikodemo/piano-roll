"use client";

import { useStore } from "@/lib/store";
import { scheduleNotes } from "@/lib/audio";
import { useEffect, useRef } from "react";
import type { ScaleMode } from "@/lib/music";
import { NOTE_NAMES } from "@/lib/music";
import { ProjectsMenu } from "./ProjectsMenu";

const SNAP_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "1/1", value: 4 },
  { label: "1/2", value: 2 },
  { label: "1/4", value: 1 },
  { label: "1/8", value: 0.5 },
  { label: "1/16", value: 0.25 },
  { label: "1/32", value: 0.125 },
];

const MODES: ScaleMode[] = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "harmonic_minor", "melodic_minor", "minor_pentatonic", "major_pentatonic", "blues"];

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
  const stopRef = useRef<(() => void) | null>(null);

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

  function toggle() {
    if (!project) return;
    if (isPlaying) {
      stopRef.current?.();
      stopRef.current = null;
      setPlaying(false);
      setPlayhead(0);
      return;
    }
    const soloed = project.voices.some((v) => v.soloed);
    const events = project.notes
      .filter((n) => {
        const v = project.voices.find((x) => x.id === n.voiceId);
        if (!v) return false;
        if (soloed) return v.soloed;
        return !v.muted;
      })
      .map((n) => ({ midi: n.pitch, startBeat: n.start, lengthBeat: n.length, velocity: n.velocity }));
    if (events.length === 0) return;
    setPlaying(true);
    stopRef.current = scheduleNotes(
      events,
      project.tempo,
      0.05,
      (b) => setPlayhead(b),
      () => {
        setPlaying(false);
        setPlayhead(0);
        stopRef.current = null;
      },
    );
  }

  if (!project) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100">
      <ProjectsMenu />
      <button
        onClick={toggle}
        className="rounded bg-blue-600 px-3 py-1 font-semibold hover:bg-blue-500"
        aria-label={isPlaying ? "Stop" : "Play"}
      >
        {isPlaying ? "■ Stop" : "▶ Play"}
      </button>
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
