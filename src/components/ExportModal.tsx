"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  exportFilename,
  exportMime,
  renderExport,
  type ExportFormat,
  type ExportOptions,
} from "@/lib/export";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  musicxml: "Music sheet (MusicXML)",
  tab: "Guitar tab (ASCII)",
  jianpu: "Jianpu (numbered)",
};

const FORMAT_HELP: Record<ExportFormat, string> = {
  musicxml: "Universal sheet-music format. Open in MuseScore, Sibelius, Finale, or import into Logic / GarageBand for printing/PDF/editing.",
  tab: "Six-string standard tuning (E A D G B e). All selected voices are merged onto one tab; string/fret assignments are picked to minimize hand movement.",
  jianpu: "Numbered notation. 1-7 = scale degrees Do-Ti, ' = octave up, , = octave down. Reads from the project's working scale (defaults to C major).",
};

export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project);
  if (!open || !project) return null;
  // Inner component is keyed on the project's voice list so it remounts (and
  // re-initializes its local state) every time the modal is reopened or the
  // voice list changes — avoids setState-in-effect for state initialization.
  return <ExportModalContent project={project} onClose={onClose} />;
}

function ExportModalContent({ project, onClose }: { project: NonNullable<ReturnType<typeof useStore.getState>["project"]>; onClose: () => void }) {
  const selectedIds = useStore((s) => s.selectedIds);
  const [format, setFormat] = useState<ExportFormat>("musicxml");
  const [voiceIds, setVoiceIds] = useState<string[]>(() => project.voices.map((v) => v.id));
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showXmlSource, setShowXmlSource] = useState(false);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const opts: ExportOptions = useMemo(() => ({
    voiceIds,
    selectedNoteIds: selectionOnly && selectedIds.size > 0 ? selectedIds : undefined,
  }), [voiceIds, selectionOnly, selectedIds]);

  const body = useMemo(() => {
    try {
      return renderExport(format, project, opts);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [format, project, opts]);

  function download() {
    const blob = new Blob([body], { type: exportMime(format) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(project, format);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignored — most browsers without clipboard permission can't reach here.
    }
  }

  function toggleVoice(id: string) {
    setVoiceIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 text-gray-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2">
          <h2 className="text-base font-semibold">Export</h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
            title="Close (Esc)"
          >✕</button>
        </div>

        <div className="grid flex-1 grid-cols-[260px_1fr] overflow-hidden">
          {/* Left: options */}
          <div className="overflow-y-auto border-r border-gray-700 p-3 text-sm">
            <div className="mb-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">Format</div>
              {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                <label key={f} className="mb-1 flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-gray-800">
                  <input
                    type="radio"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    className="mt-1"
                  />
                  <div>
                    <div>{FORMAT_LABELS[f]}</div>
                    <div className="text-xs text-gray-500">{FORMAT_HELP[f]}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="mb-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">Voices</div>
              {project.voices.map((v) => (
                <label key={v.id} className="mb-1 flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-gray-800">
                  <input
                    type="checkbox"
                    checked={voiceIds.includes(v.id)}
                    onChange={() => toggleVoice(v.id)}
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.color }} />
                  <span className="truncate">{v.name}</span>
                  <span className="ml-auto text-xs text-gray-500">{v.instrument}</span>
                </label>
              ))}
            </div>

            <div className="mb-3">
              <label className={selectedIds.size === 0 ? "flex items-center gap-2 text-gray-500" : "flex cursor-pointer items-center gap-2"}>
                <input
                  type="checkbox"
                  checked={selectionOnly}
                  disabled={selectedIds.size === 0}
                  onChange={(e) => setSelectionOnly(e.target.checked)}
                />
                <span>Selected notes only</span>
                <span className="text-xs text-gray-500">({selectedIds.size} selected)</span>
              </label>
            </div>
          </div>

          {/* Right: preview + actions */}
          <div className="flex flex-col overflow-hidden">
            {format === "musicxml" && !showXmlSource ? (
              <MusicSheetPreview xml={body} />
            ) : (
              <pre className="flex-1 overflow-auto bg-gray-950 px-4 py-3 font-mono text-xs leading-relaxed text-gray-200">
                {body}
              </pre>
            )}
            <div className="flex items-center justify-between border-t border-gray-700 bg-gray-900 px-4 py-2 text-xs">
              <span className="text-gray-500">
                {format === "musicxml"
                  ? "Open the downloaded .musicxml file in MuseScore (free) or any notation editor."
                  : "Use a monospace viewer for best alignment."}
              </span>
              <div className="flex items-center gap-2">
                {format === "musicxml" && (
                  <button
                    onClick={() => setShowXmlSource((v) => !v)}
                    className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700"
                    title="Toggle between rendered sheet and raw MusicXML"
                  >
                    {showXmlSource ? "Sheet" : "XML source"}
                  </button>
                )}
                <button
                  onClick={copy}
                  className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={download}
                  className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-500"
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Renders MusicXML as an actual sheet using OpenSheetMusicDisplay. The lib is
// ~500 KB gzipped so we dynamic-import it to keep it out of the initial bundle
// — the modal is the only place it's used.
function MusicSheetPreview({ xml }: { xml: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const target = containerRef.current;
        if (!target) return;
        if (!osmdRef.current) {
          const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
          if (cancelled) return;
          osmdRef.current = new OpenSheetMusicDisplay(target, {
            autoResize: true,
            backend: "svg",
            drawingParameters: "compact",
          });
        }
        await osmdRef.current.load(xml);
        if (cancelled) return;
        osmdRef.current.render();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [xml]);

  useEffect(() => {
    return () => {
      try { osmdRef.current?.clear?.(); } catch { /* OSMD may throw on already-unmounted */ }
      osmdRef.current = null;
    };
  }, []);

  return (
    <div className="relative flex-1 overflow-auto bg-white">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-red-600">
          Render error: {error}
        </div>
      )}
      <div ref={containerRef} className="p-4" />
    </div>
  );
}
