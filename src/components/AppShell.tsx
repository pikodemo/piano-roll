"use client";

import { useEffect, useState } from "react";
import { listProjects, loadProject, saveProject } from "@/lib/storage";
import { makeDefaultProject, useStore } from "@/lib/store";
import { Toolbar } from "./Toolbar";
import { VoiceList } from "./VoiceList";
import { PianoRoll } from "./PianoRoll";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./ChatPanel";

export function AppShell() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const [ready, setReady] = useState(false);

  // On first mount: load the most recent project, or create a default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listProjects();
        if (cancelled) return;
        if (list.length > 0) {
          const p = await loadProject(list[0].id);
          if (p && !cancelled) {
            setProject(p);
            setReady(true);
            return;
          }
        }
        const fresh = makeDefaultProject();
        await saveProject(fresh);
        if (cancelled) return;
        setProject(fresh);
      } catch (err) {
        console.error("Failed to load project", err);
        const fresh = makeDefaultProject();
        if (!cancelled) setProject(fresh);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [setProject]);

  if (!ready || !project) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid h-screen text-gray-100" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="flex min-w-0 flex-col bg-gray-950">
        <Toolbar />
        <VoiceList />
        <div className="min-h-0 flex-1">
          <PianoRoll />
        </div>
        <div className="max-h-[35vh] overflow-auto">
          <Inspector />
        </div>
      </div>
      <ChatPanel />
    </div>
  );
}
