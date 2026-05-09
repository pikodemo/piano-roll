"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Keyboard } from "./Keyboard";
import { TimeRuler } from "./TimeRuler";
import { playNote } from "@/lib/audio";
import { pitchClass } from "@/lib/music";

const KEYBOARD_W = 56;
const RULER_H = 24;
const BLACK = new Set([1, 3, 6, 8, 10]);
const RESIZE_PX = 6;

type Drag =
  | { kind: "create"; id: string; startBeat: number; startPitch: number }
  | { kind: "move"; ids: string[]; startBeat: number; startPitch: number; origNotes: Map<string, { start: number; pitch: number }> }
  | { kind: "resize"; id: string; startBeat: number; origLength: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number };

export function PianoRoll() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedIds);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const playheadBeat = useStore((s) => s.playheadBeat);
  const isPlaying = useStore((s) => s.isPlaying);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const updateNotes = useStore((s) => s.updateNotes);
  const setSelected = useStore((s) => s.setSelected);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const clearSelection = useStore((s) => s.clearSelection);
  const deleteNotes = useStore((s) => s.deleteNotes);
  const transposeSelected = useStore((s) => s.transposeSelected);
  const nudgeSelected = useStore((s) => s.nudgeSelected);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerWrapRef = useRef<HTMLDivElement | null>(null);
  const kbWrapRef = useRef<HTMLDivElement | null>(null);
  const gridSvgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Sync scroll between the corner panes and the main grid.
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (rulerWrapRef.current) rulerWrapRef.current.scrollLeft = el.scrollLeft;
    if (kbWrapRef.current) kbWrapRef.current.scrollTop = el.scrollTop;
  }, []);

  // Auto-scroll keyboard to middle on first load.
  useEffect(() => {
    if (!project || !scrollRef.current) return;
    const { rowHeight, maxPitch } = project.view;
    const middle = (maxPitch - 60) * rowHeight;
    scrollRef.current.scrollTop = Math.max(0, middle - 200);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts. Defined here (before any conditional returns) so the
  // hook order stays stable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      const sel = useStore.getState().selectedIds;
      if ((e.key === "Backspace" || e.key === "Delete") && sel.size > 0) {
        e.preventDefault();
        deleteNotes(Array.from(sel));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        transposeSelected(e.shiftKey ? 12 : 1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        transposeSelected(e.shiftKey ? -12 : -1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelected(-(useStore.getState().project?.view.snap ?? 0.25));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelected(useStore.getState().project?.view.snap ?? 0.25);
      } else if (e.key === "Escape") {
        clearSelection();
      } else if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteNotes, transposeSelected, nudgeSelected, clearSelection]);

  if (!project) return null;
  const { view } = project;
  const totalBeats = project.bars * project.beatsPerBar;
  const contentW = totalBeats * view.pixelsPerBeat;
  const pitchRange = view.maxPitch - view.minPitch + 1;
  const contentH = pitchRange * view.rowHeight;

  function snap(beat: number): number {
    if (!project) return beat;
    return Math.round(beat / project.view.snap) * project.view.snap;
  }

  function pxToBeat(x: number): number {
    return x / view.pixelsPerBeat;
  }
  function pxToPitch(y: number): number {
    return view.maxPitch - Math.floor(y / view.rowHeight);
  }
  function beatToPx(b: number): number {
    return b * view.pixelsPerBeat;
  }
  function pitchToPx(p: number): number {
    return (view.maxPitch - p) * view.rowHeight;
  }

  function onGridPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!gridSvgRef.current) return;
    const rect = gridSvgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = e.target as Element;
    const noteId = target.getAttribute("data-note-id");
    if (noteId) {
      e.preventDefault();
      const note = project!.notes.find((n) => n.id === noteId);
      if (!note) return;
      const noteX1 = beatToPx(note.start + note.length);
      const isResize = x >= noteX1 - RESIZE_PX;

      // Selection update.
      if (!selected.has(noteId)) {
        if (e.shiftKey) toggleSelected(noteId, true);
        else setSelected([noteId]);
      }

      gridSvgRef.current.setPointerCapture(e.pointerId);
      if (isResize) {
        setDrag({ kind: "resize", id: noteId, startBeat: pxToBeat(x), origLength: note.length });
      } else {
        // Move all currently selected notes.
        const ids = selected.has(noteId) ? Array.from(selected) : [noteId];
        const origNotes = new Map<string, { start: number; pitch: number }>();
        for (const n of project!.notes) {
          if (ids.includes(n.id)) origNotes.set(n.id, { start: n.start, pitch: n.pitch });
        }
        setDrag({ kind: "move", ids, startBeat: pxToBeat(x), startPitch: pxToPitch(y), origNotes });
        // Audible click of the moved note.
        playNote(note.pitch, 0.15, { velocity: note.velocity });
      }
      return;
    }

    // Empty area: shift+drag → marquee; otherwise create a new note.
    if (e.shiftKey) {
      gridSvgRef.current.setPointerCapture(e.pointerId);
      setDrag({ kind: "marquee", x0: x, y0: y, x1: x, y1: y });
      clearSelection();
      return;
    }

    if (!activeVoiceId) return;
    const startBeat = snap(pxToBeat(x));
    const pitch = pxToPitch(y);
    // Default new-note length: 1 beat, but never shorter than the snap.
    const length = Math.max(1, view.snap);
    const note = addNote({ voiceId: activeVoiceId, pitch, start: startBeat, length, velocity: 0.8 });
    setSelected([note.id]);
    playNote(pitch, 0.2, { velocity: 0.8 });
    gridSvgRef.current.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", id: note.id, startBeat, startPitch: pitch });
  }

  function onGridPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag || !gridSvgRef.current) return;
    const rect = gridSvgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drag.kind === "create") {
      const cur = pxToBeat(x);
      const length = Math.max(view.snap, snap(cur - drag.startBeat) || view.snap);
      updateNote(drag.id, { length });
    } else if (drag.kind === "move") {
      const dBeat = snap(pxToBeat(x) - drag.startBeat);
      const dPitch = pxToPitch(y) - drag.startPitch;
      const updates = Array.from(drag.origNotes.entries()).map(([id, orig]) => ({
        id,
        start: Math.max(0, orig.start + dBeat),
        pitch: orig.pitch + dPitch,
      }));
      updateNotes(updates);
    } else if (drag.kind === "resize") {
      const cur = pxToBeat(x);
      const length = Math.max(view.snap, snap(drag.origLength + (cur - drag.startBeat)));
      updateNote(drag.id, { length });
    } else if (drag.kind === "marquee") {
      setDrag({ ...drag, x1: x, y1: y });
    }
  }

  function onGridPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.kind === "marquee") {
      const x0 = Math.min(drag.x0, drag.x1);
      const x1 = Math.max(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1);
      const y1 = Math.max(drag.y0, drag.y1);
      const ids: string[] = [];
      for (const n of project!.notes) {
        const nx0 = beatToPx(n.start);
        const nx1 = beatToPx(n.start + n.length);
        const ny0 = pitchToPx(n.pitch);
        const ny1 = ny0 + view.rowHeight;
        if (nx1 >= x0 && nx0 <= x1 && ny1 >= y0 && ny0 <= y1) ids.push(n.id);
      }
      setSelected(ids);
    }
    try { gridSvgRef.current?.releasePointerCapture(e.pointerId); } catch {}
    setDrag(null);
  }

  // Lane background bands (shaded for black-key rows).
  const laneRows: Array<{ pitch: number; y: number; black: boolean }> = [];
  for (let i = 0; i < pitchRange; i++) {
    const pitch = view.maxPitch - i;
    laneRows.push({ pitch, y: i * view.rowHeight, black: BLACK.has(pitchClass(pitch)) });
  }
  // Vertical grid lines.
  const beats: Array<{ beat: number; major: boolean; barLine: boolean }> = [];
  for (let b = 0; b <= totalBeats; b++) {
    beats.push({ beat: b, major: true, barLine: b % project.beatsPerBar === 0 });
  }
  const subBeats: number[] = [];
  if (view.snap < 1) {
    for (let b = 0; b < totalBeats; b += view.snap) {
      if (Math.abs(b - Math.round(b)) > 0.001) subBeats.push(b);
    }
  }

  const voiceById = new Map(project.voices.map((v) => [v.id, v]));

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: `${KEYBOARD_W}px 1fr`, gridTemplateRows: `${RULER_H}px 1fr` }}>
      {/* Corner */}
      <div className="bg-gray-900 border-r border-b border-gray-700" />
      {/* Ruler */}
      <div ref={rulerWrapRef} className="overflow-hidden border-b border-gray-700">
        <TimeRuler bars={project.bars} beatsPerBar={project.beatsPerBar} pixelsPerBeat={view.pixelsPerBeat} height={RULER_H} />
      </div>
      {/* Keyboard */}
      <div ref={kbWrapRef} className="overflow-hidden border-r border-gray-700 bg-gray-100 dark:bg-gray-900">
        <Keyboard
          minPitch={view.minPitch}
          maxPitch={view.maxPitch}
          rowHeight={view.rowHeight}
          width={KEYBOARD_W}
          onPreview={(p) => playNote(p, 0.3)}
        />
      </div>
      {/* Grid */}
      <div ref={scrollRef} className="overflow-auto" onScroll={onScroll}>
        <svg
          ref={gridSvgRef}
          width={contentW}
          height={contentH}
          className="block"
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
          onPointerCancel={onGridPointerUp}
          style={{ touchAction: "none" }}
        >
          {/* Lane bands */}
          {laneRows.map(({ y, black, pitch }) => (
            <rect key={pitch} x={0} y={y} width={contentW} height={view.rowHeight} fill={black ? "#1f2937" : "#111827"} />
          ))}
          {/* Lane separators */}
          {laneRows.map(({ y, pitch }) => (
            pitchClass(pitch) === 0 ? (
              <line key={`sep-${pitch}`} x1={0} y1={y + view.rowHeight} x2={contentW} y2={y + view.rowHeight} stroke="#4b5563" strokeWidth={0.5} />
            ) : null
          ))}
          {/* Sub-beat lines */}
          {subBeats.map((b) => (
            <line key={`sb-${b}`} x1={beatToPx(b)} y1={0} x2={beatToPx(b)} y2={contentH} stroke="#374151" strokeWidth={0.4} />
          ))}
          {/* Beat lines */}
          {beats.map(({ beat, barLine }) => (
            <line key={`b-${beat}`} x1={beatToPx(beat)} y1={0} x2={beatToPx(beat)} y2={contentH} stroke={barLine ? "#9ca3af" : "#6b7280"} strokeWidth={barLine ? 1 : 0.6} />
          ))}
          {/* Notes */}
          {project.notes.map((n) => {
            const v = voiceById.get(n.voiceId);
            const color = v?.color ?? "#60a5fa";
            const isSelected = selected.has(n.id);
            const isActive = activeVoiceId === n.voiceId;
            const muted = v?.muted;
            const opacity = muted ? 0.35 : isActive ? 1 : 0.75;
            return (
              <g key={n.id} opacity={opacity}>
                <rect
                  data-note-id={n.id}
                  x={beatToPx(n.start)}
                  y={pitchToPx(n.pitch)}
                  width={Math.max(2, beatToPx(n.length))}
                  height={view.rowHeight - 1}
                  fill={color}
                  stroke={isSelected ? "#ffffff" : "#000000"}
                  strokeWidth={isSelected ? 1.5 : 0.5}
                  rx={2}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}
          {/* Marquee */}
          {drag?.kind === "marquee" && (
            <rect
              x={Math.min(drag.x0, drag.x1)}
              y={Math.min(drag.y0, drag.y1)}
              width={Math.abs(drag.x1 - drag.x0)}
              height={Math.abs(drag.y1 - drag.y0)}
              fill="rgba(96,165,250,0.15)"
              stroke="#60a5fa"
              strokeWidth={1}
            />
          )}
          {/* Playhead */}
          {(isPlaying || playheadBeat > 0) && (
            <line x1={beatToPx(playheadBeat)} y1={0} x2={beatToPx(playheadBeat)} y2={contentH} stroke="#ef4444" strokeWidth={1.5} />
          )}
        </svg>
      </div>
    </div>
  );
}
