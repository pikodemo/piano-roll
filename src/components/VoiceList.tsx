"use client";

import { useStore } from "@/lib/store";

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
                title="Set active"
              >
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: v.color }} />
                <span>{v.name}</span>
              </button>
              <button
                onClick={() => updateVoice(v.id, { muted: !v.muted })}
                className={`ml-1 rounded px-1 text-xs ${v.muted ? "bg-amber-600" : "bg-gray-700 hover:bg-gray-600"}`}
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
