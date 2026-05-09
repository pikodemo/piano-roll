"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { INSTRUMENT_LIST, INSTRUMENT_NAMES, playNote, type InstrumentId } from "@/lib/audio";
import type { Voice } from "@/lib/types";

export function VoiceList() {
  const project = useStore((s) => s.project);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const setActiveVoice = useStore((s) => s.setActiveVoice);
  const addVoice = useStore((s) => s.addVoice);
  const removeVoice = useStore((s) => s.removeVoice);
  const updateVoice = useStore((s) => s.updateVoice);

  if (!project) return null;
  return (
    <div className="border-b border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100">
      <div className="flex items-center justify-between">
        <span className="text-gray-400">Voices</span>
        <button onClick={() => addVoice()} className="rounded bg-gray-800 px-2 py-0.5 text-xs hover:bg-gray-700">+ Add</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {project.voices.map((v) => {
          const active = v.id === activeVoiceId;
          return (
            <div
              key={v.id}
              className={`flex items-center gap-1 rounded border px-2 py-1 ${active ? "border-white bg-gray-800" : "border-gray-700"}`}
            >
              <button
                onClick={() => setActiveVoice(v.id)}
                className="flex items-center gap-1"
                title="Set active (double-click name to rename)"
              >
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: v.color }} />
                <VoiceName voice={v} onRename={(name) => updateVoice(v.id, { name })} />
              </button>
              <select
                value={v.instrument}
                onChange={(e) => {
                  const inst = e.target.value as InstrumentId;
                  updateVoice(v.id, { instrument: inst });
                  playNote(60, 0.6, { instrument: inst, volume: v.volume });
                }}
                className="ml-1 rounded bg-gray-700 px-1 py-0.5 text-xs"
                title="Instrument"
              >
                {INSTRUMENT_LIST.map((id) => (
                  <option key={id} value={id}>{INSTRUMENT_NAMES[id]}</option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={v.volume}
                onChange={(e) => updateVoice(v.id, { volume: Number(e.target.value) })}
                className="w-16 accent-white"
                title={`Volume: ${Math.round(v.volume * 100)}%`}
                aria-label="Volume"
              />
              <button
                onClick={() => updateVoice(v.id, { muted: !v.muted })}
                className={`rounded px-1 text-xs ${v.muted ? "bg-amber-600" : "bg-gray-700 hover:bg-gray-600"}`}
                title="Mute"
              >M</button>
              <button
                onClick={() => updateVoice(v.id, { soloed: !v.soloed })}
                className={`rounded px-1 text-xs ${v.soloed ? "bg-amber-500 text-black" : "bg-gray-700 hover:bg-gray-600"}`}
                title="Solo"
              >S</button>
              {project.voices.length > 1 && (
                <button
                  onClick={() => removeVoice(v.id)}
                  className="rounded px-1 text-xs text-red-400 hover:bg-gray-700"
                  title="Delete voice"
                >×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoiceName({ voice, onRename }: { voice: Voice; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(voice.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEdit() {
    setDraft(voice.name);
    setEditing(true);
  }
  function commit() {
    const next = draft.trim();
    if (next && next !== voice.name) onRename(next);
    setEditing(false);
  }
  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="rounded bg-gray-900 px-1 py-0 text-sm text-gray-100 outline outline-1 outline-gray-500"
        size={Math.max(6, draft.length)}
      />
    );
  }
  return (
    <span
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startEdit();
      }}
    >
      {voice.name}
    </span>
  );
}
