"use client";

import { useEffect, useState } from "react";
import { currentHistoryPath, historyBranches, useStore } from "@/lib/store";

export function HistoryPanel() {
  const project = useStore((s) => s.project);
  const jumpToStep = useStore((s) => s.jumpToStep);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setLayout = useStore((s) => s.setLayout);
  // Force re-render every 30s so relative timestamps stay current.
  useTick(30_000);

  if (!project) return null;
  const path = currentHistoryPath(project);
  const branches = historyBranches(project);
  const headId = project.history.headId;
  const headIdx = path.findIndex((s) => s.id === headId);
  const totalEdits = Object.keys(project.history.steps).length;
  const canUndo = !!path[headIdx]?.parentId;
  const canRedo = project.history.redoStack.length > 0;

  // Display newest-first (git log convention) — head at the top, root at the
  // bottom.
  const reversed = [...path].reverse();

  return (
    <div className="flex h-full flex-col bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="text-sm font-semibold">History</span>
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="rounded bg-gray-800 px-2 py-0.5 text-xs hover:bg-gray-700 disabled:opacity-40"
            title="Undo (Cmd-Z)"
          >‹</button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="rounded bg-gray-800 px-2 py-0.5 text-xs hover:bg-gray-700 disabled:opacity-40"
            title="Redo (Cmd-Shift-Z)"
          >›</button>
          <button
            onClick={() => setLayout({ historyOpen: false })}
            className="ml-1 rounded px-1.5 text-xs text-gray-400 hover:bg-gray-800"
            title="Hide history panel"
          >✕</button>
        </div>
      </div>

      <div className="border-b border-gray-800 px-3 py-1 text-xs text-gray-500">
        {headIdx + 1} / {path.length} on this branch · {totalEdits} edit{totalEdits === 1 ? "" : "s"} total
      </div>

      {/* Slim slider for quick scrubbing without leaving the panel. */}
      <div className="border-b border-gray-800 px-3 py-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, path.length - 1)}
          step={1}
          value={headIdx}
          onChange={(e) => {
            const idx = Number(e.target.value);
            const target = path[idx];
            if (target && target.id !== headId) jumpToStep(target.id);
          }}
          className="w-full accent-blue-400"
          aria-label="History scrubber"
        />
      </div>

      {/* Step list — git-log style. Newest at top. Click any to jump. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reversed.map((step, i) => {
          const isHead = step.id === headId;
          const isRoot = step.parentId == null;
          // Logical index within the path (root=0 → head=path.length-1).
          const pathIdx = path.length - 1 - i;
          return (
            <button
              key={step.id}
              onClick={() => { if (!isHead) jumpToStep(step.id); }}
              className={
                "group flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-800/60 " +
                (isHead ? "bg-blue-900/40" : "")
              }
              title={`Step ${pathIdx + 1} — jump here`}
            >
              <span className="mt-0.5 select-none">
                {isHead ? <span className="text-blue-400">●</span>
                  : isRoot ? <span className="text-gray-600">○</span>
                  : <span className="text-gray-700">│</span>}
              </span>
              <span className="flex-1 truncate">
                <span className={isHead ? "font-semibold text-gray-100" : "text-gray-300"}>
                  {step.label}
                </span>
              </span>
              <span className="text-gray-600 group-hover:text-gray-400">{relativeTime(step.timestamp)}</span>
            </button>
          );
        })}
      </div>

      {/* Branch tips — sources of "redo from a different fork" jumps. */}
      {branches.length > 0 && (
        <div className="border-t border-gray-800 px-3 py-2">
          <div className="mb-1 text-xs uppercase tracking-wide text-amber-300/80">
            Other branches ({branches.length})
          </div>
          <div className="flex flex-col gap-1">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => jumpToStep(b.id)}
                className="flex items-center gap-2 rounded bg-gray-800/60 px-2 py-1 text-left text-xs hover:bg-gray-800"
                title="Switch HEAD to this branch tip"
              >
                <span className="text-amber-300">🔀</span>
                <span className="flex-1 truncate">{b.label}</span>
                <span className="text-gray-500">{relativeTime(b.timestamp)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Slim re-open handle shown on the left edge when the panel is hidden.
export function HistoryReopenHandle() {
  const setLayout = useStore((s) => s.setLayout);
  return (
    <button
      onClick={() => setLayout({ historyOpen: true })}
      className="flex h-full w-5 items-center justify-center border-r border-gray-800 bg-gray-900/60 text-xs text-gray-500 hover:bg-gray-800 hover:text-gray-200"
      title="Show history panel"
      aria-label="Open history panel"
    >
      ▶
    </button>
  );
}

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function relativeTime(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
