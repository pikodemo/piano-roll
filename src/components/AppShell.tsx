"use client";

import { useEffect, useRef, useState } from "react";
import { listProjects, loadProject, saveProject } from "@/lib/storage";
import { loadLayoutFromStorage, makeDefaultProject, useStore } from "@/lib/store";
import { getMIDIAccess, subscribe as subscribeMIDI } from "@/lib/midi";
import { playNote } from "@/lib/audio";
import { Toolbar } from "./Toolbar";
import { VoiceList } from "./VoiceList";
import { PianoRoll } from "./PianoRoll";
import { Inspector } from "./Inspector";
import { ChatPanel, ChatReopenHandle } from "./ChatPanel";
import { HistoryPanel, HistoryReopenHandle } from "./HistoryPanel";

export function AppShell() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const [ready, setReady] = useState(false);

  // On first mount: hydrate the layout prefs from localStorage and load the
  // most-recent project (or create a default).
  useEffect(() => {
    setLayout(loadLayoutFromStorage());
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
  }, [setProject, setLayout]);

  // MIDI keyboard input → preview through the active voice's instrument.
  // We re-read store state inside the message handler so changes to the active
  // voice or its instrument/volume take effect without re-subscribing.
  const heldNotesRef = useRef<Map<number, () => void>>(new Map());
  useEffect(() => {
    const heldNotes = heldNotesRef.current;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const access = await getMIDIAccess();
      if (!access || cancelled) return;
      unsub = subscribeMIDI((event) => {
        const s = useStore.getState();
        const voice = s.project?.voices.find((v) => v.id === s.activeVoiceId);
        if (event.type === "noteOn") {
          heldNotes.get(event.note)?.();
          const stop = playNote(event.note, 6, {
            velocity: event.velocity,
            instrument: voice?.instrument,
            volume: voice?.volume,
          });
          heldNotes.set(event.note, stop);
        } else {
          const stop = heldNotes.get(event.note);
          if (stop) {
            stop();
            heldNotes.delete(event.note);
          }
        }
      });
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
      for (const stop of heldNotes.values()) stop();
      heldNotes.clear();
    };
  }, []);

  if (!ready || !project) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading…
      </div>
    );
  }

  // Right column is rendered when there's anything to put in it (chat or a
  // right-positioned inspector). When closed entirely, a slim re-open handle
  // takes its place.
  const rightColumnVisible = layout.chatOpen || layout.inspectorPos === "right";
  const inspectorAtBottom = layout.inspectorPos === "bottom";

  return (
    <div className="flex h-screen text-gray-100">
      {/* Left column — history. */}
      {layout.historyOpen ? (
        <div className="flex w-72 flex-shrink-0 flex-col border-r border-gray-800">
          <HistoryPanel />
        </div>
      ) : (
        <HistoryReopenHandle />
      )}

      {/* Center column — editor. */}
      <div className="flex min-w-0 flex-1 flex-col bg-gray-950">
        <Toolbar />
        <VoiceList />
        <div className="min-h-0 flex-1">
          <PianoRoll />
        </div>
        {inspectorAtBottom && (
          <div className="max-h-[35vh] overflow-auto border-t border-gray-700">
            <Inspector />
          </div>
        )}
      </div>

      {/* Right column — inspector (when right) + chat. */}
      {rightColumnVisible ? (
        <div className="flex w-80 flex-shrink-0 flex-col border-l border-gray-800">
          {layout.inspectorPos === "right" && (
            <div className="max-h-[45vh] overflow-auto border-b border-gray-700">
              <Inspector />
            </div>
          )}
          {layout.chatOpen && (
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          )}
        </div>
      ) : (
        <ChatReopenHandle />
      )}
    </div>
  );
}
