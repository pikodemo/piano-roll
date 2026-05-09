"use client";

import { useState } from "react";

const MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

// Placeholder for stage 2. Layout is real so we don't have to redo the page
// when the agent lands; the input is disabled and explains why.
export function ChatPanel() {
  const [model, setModel] = useState(MODELS[0].id);
  return (
    <div className="flex h-full flex-col border-l border-gray-700 bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2 text-sm">
        <span className="font-semibold">Chat</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded bg-gray-800 px-2 py-1 text-xs"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 text-sm text-gray-400">
        <div className="rounded bg-gray-800/60 px-3 py-2 leading-relaxed">
          <strong className="text-gray-200">Coming in stage 2.</strong>
          <br />
          A Claude-powered agent will read the current arrangement and rewrite it on
          request — &ldquo;transpose down an octave&rdquo;, &ldquo;use the diatonic chords of A
          minor&rdquo;, &ldquo;voice this in the style of Debussy&rdquo;, etc.
          <br /><br />
          For now, please use the toolbar and inspector below.
        </div>
      </div>
      <div className="border-t border-gray-700 p-2">
        <textarea
          disabled
          rows={3}
          placeholder="Disabled in stage 1"
          className="w-full resize-none rounded bg-gray-800/60 px-2 py-1 text-sm text-gray-400 placeholder-gray-600"
        />
      </div>
    </div>
  );
}
