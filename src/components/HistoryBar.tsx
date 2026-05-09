"use client";

import { useEffect, useRef, useState } from "react";
import { currentHistoryPath, historyBranches, useStore } from "@/lib/store";

export function HistoryBar() {
  const project = useStore((s) => s.project);
  const jumpToStep = useStore((s) => s.jumpToStep);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const [open, setOpen] = useState(false);

  if (!project) return null;
  const path = currentHistoryPath(project);
  const branches = historyBranches(project);
  const headId = project.history.headId;
  const currentIdx = path.findIndex((s) => s.id === headId);
  const headStep = path[currentIdx];

  const totalEdits = Object.keys(project.history.steps).length;
  const canUndo = !!headStep?.parentId;
  const canRedo = project.history.redoStack.length > 0;

  return (
    <div className="border-t border-gray-700 bg-gray-900 text-gray-100">
      {/* Compact summary row, always visible. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-800/40"
        title="Toggle history panel"
      >
        <span className="flex items-center gap-2">
          <span className="text-gray-400">{open ? "▼" : "▶"} History</span>
          <span className="font-mono text-gray-300">{currentIdx + 1} / {path.length}</span>
          <span className="truncate text-gray-300">— {headStep?.label}</span>
          {branches.length > 0 && (
            <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-200">
              {branches.length} other branch{branches.length === 1 ? "" : "es"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <span>{totalEdits} edit{totalEdits === 1 ? "" : "s"} total</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-800 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700 disabled:opacity-40"
              title="Undo (Cmd-Z)"
            >‹</button>
            <Slider
              path={path.map((s) => ({ id: s.id, label: s.label, timestamp: s.timestamp }))}
              currentIdx={currentIdx}
              onScrub={(idx) => {
                const target = path[idx];
                if (target && target.id !== headId) jumpToStep(target.id);
              }}
            />
            <button
              onClick={redo}
              disabled={!canRedo}
              className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700 disabled:opacity-40"
              title="Redo (Cmd-Shift-Z)"
            >›</button>
          </div>

          {branches.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <span className="text-gray-400">Other branches</span>
              {branches.map((b) => {
                // Walk up from this tip to find the most recent step that's
                // also on the current path — that's the fork point.
                let forkLabel = "";
                let cur = project.history.steps[b.parentId ?? ""];
                const onPath = new Set(path.map((s) => s.id));
                while (cur && !onPath.has(cur.id)) {
                  cur = cur.parentId ? project.history.steps[cur.parentId] : undefined!;
                  if (!cur) break;
                }
                if (cur) forkLabel = ` (forked at "${cur.label}")`;
                return (
                  <button
                    key={b.id}
                    onClick={() => jumpToStep(b.id)}
                    className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
                    title={`Switch to this branch tip: ${b.label}${forkLabel}`}
                  >
                    🔀 <span className="font-medium">{b.label}</span>
                    <span className="ml-1 text-gray-500">{relativeTime(b.timestamp)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SliderProps {
  path: Array<{ id: string; label: string; timestamp: number }>;
  currentIdx: number;
  onScrub: (idx: number) => void;
}

function Slider({ path, currentIdx, onScrub }: SliderProps) {
  // Local "drag" state so scrubbing feels snappy: we update the local value
  // every pointer-move and only call onScrub when it changes (jumpToStep is
  // expensive — it rewrites the whole project). Mouse-leave on the bar still
  // commits, so the UI never shows a different position than the store.
  const [hovered, setHovered] = useState<number | null>(null);
  const lastEmittedRef = useRef<number>(currentIdx);

  // Tooltip showing the label of the position you'd land on.
  const tipIdx = hovered ?? currentIdx;
  const tip = path[tipIdx];

  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="range"
        min={0}
        max={Math.max(0, path.length - 1)}
        step={1}
        value={currentIdx}
        onChange={(e) => {
          const idx = Number(e.target.value);
          if (idx !== lastEmittedRef.current) {
            lastEmittedRef.current = idx;
            onScrub(idx);
          }
        }}
        onPointerMove={(e) => {
          const t = e.currentTarget;
          const r = t.getBoundingClientRect();
          const fr = (e.clientX - r.left) / r.width;
          const idx = Math.max(0, Math.min(path.length - 1, Math.round(fr * (path.length - 1))));
          setHovered(idx);
        }}
        onPointerLeave={() => setHovered(null)}
        className="flex-1 accent-blue-400"
        aria-label="History position"
      />
      <span className="min-w-[180px] text-right font-mono text-xs text-gray-400 truncate" title={tip?.label}>
        {tip?.label} <span className="text-gray-600">{tip ? relativeTime(tip.timestamp) : ""}</span>
      </span>
    </div>
  );
}

function relativeTime(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// Re-render every 30s so relative timestamps stay fresh while the panel is open.
export function useHistoryTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}
