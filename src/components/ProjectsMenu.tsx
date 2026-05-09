"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, makeDefaultProject } from "@/lib/store";
import { deleteProject, listProjects, loadProject, saveProject } from "@/lib/storage";

interface Item { id: string; name: string; updatedAt: number }

export function ProjectsMenu() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Refresh the list whenever the menu opens, or when the current project's
  // id/name changes (covers rename + auto-save bumping updatedAt).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listProjects().then((l) => { if (!cancelled) setItems(l); });
    return () => { cancelled = true; };
  }, [open, project?.id, project?.name, project?.updatedAt]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function onNew() {
    const fresh = makeDefaultProject();
    fresh.name = `Project ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    await saveProject(fresh);
    setProject(fresh);
    setOpen(false);
  }

  async function onSwitch(id: string) {
    if (id === project?.id) { setOpen(false); return; }
    const p = await loadProject(id);
    if (p) setProject(p);
    setOpen(false);
  }

  async function onDelete(id: string) {
    const target = items.find((i) => i.id === id);
    if (!confirm(`Delete project "${target?.name ?? "Untitled"}"? This cannot be undone.`)) return;
    await deleteProject(id);
    if (id === project?.id) {
      // Switch to most-recent remaining, or create a fresh one.
      const remaining = (await listProjects()).filter((p) => p.id !== id);
      if (remaining.length > 0) {
        const next = await loadProject(remaining[0].id);
        if (next) setProject(next);
      } else {
        const fresh = makeDefaultProject();
        await saveProject(fresh);
        setProject(fresh);
      }
    }
    setItems((cur) => cur.filter((i) => i.id !== id));
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
        title="Projects"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Projects ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 w-72 rounded border border-gray-700 bg-gray-900 shadow-lg"
        >
          <button
            onClick={onNew}
            className="block w-full rounded-t bg-emerald-600 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-emerald-500"
          >
            + New project
          </button>
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">No saved projects.</div>
            ) : items.map((it) => {
              const active = it.id === project?.id;
              return (
                <div
                  key={it.id}
                  className={`flex items-center gap-2 px-2 py-1 text-sm ${active ? "bg-gray-800" : "hover:bg-gray-800"}`}
                >
                  <button
                    onClick={() => onSwitch(it.id)}
                    className="flex-1 text-left"
                    title={`Open ${it.name}`}
                  >
                    <div className="truncate">{it.name || "Untitled"}{active ? " · current" : ""}</div>
                    <div className="text-xs text-gray-500">{new Date(it.updatedAt).toLocaleString()}</div>
                  </button>
                  <button
                    onClick={() => onDelete(it.id)}
                    className="rounded px-1 text-xs text-red-400 hover:bg-red-900/40"
                    title="Delete project"
                    aria-label={`Delete ${it.name}`}
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
