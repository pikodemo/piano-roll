"use client";

import { useEffect, useRef, useState } from "react";
import { listProjects, loadProject, saveProject } from "@/lib/storage";
import { makeDefaultProject, useStore } from "@/lib/store";
import { getMIDIAccess, subscribe as subscribeMIDI } from "@/lib/midi";
import { playNote } from "@/lib/audio";
import { Toolbar } from "./Toolbar";
import { VoiceList } from "./VoiceList";
import { PianoRoll } from "./PianoRoll";
import { Inspector } from "./Inspector";
import { ChatPanel } from "./ChatPanel";
import { HistoryBar } from "./HistoryBar";

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
          // Stop any in-flight note for this pitch (re-press without note-off).
          heldNotes.get(event.note)?.();
          // Long sustain so the note rings until note-off lands. Most synths
          // here have ≤1.5s release; 6s is more than enough for a sustained press.
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

  return (
    <div className="grid h-screen text-gray-100" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="flex min-w-0 flex-col bg-gray-950">
        <Toolbar />
        <VoiceList />
        <div className="min-h-0 flex-1">
          <PianoRoll />
        </div>
        <HistoryBar />
        <div className="max-h-[35vh] overflow-auto">
          <Inspector />
        </div>
      </div>
      <ChatPanel />
    </div>
  );
}
