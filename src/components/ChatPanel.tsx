"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, type ChatMessage } from "@/lib/store";

const MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

function uid(): string { return Math.random().toString(36).slice(2, 10); }

export function ChatPanel() {
  const project = useStore((s) => s.project);
  const messages = useStore((s) => s.chatMessages);
  const busy = useStore((s) => s.chatBusy);
  const error = useStore((s) => s.chatError);
  const appendChatMessage = useStore((s) => s.appendChatMessage);
  const patchLastAssistant = useStore((s) => s.patchLastAssistant);
  const setChatBusy = useStore((s) => s.setChatBusy);
  const setChatError = useStore((s) => s.setChatError);
  const beginAgentTurn = useStore((s) => s.beginAgentTurn);
  const applyAgentPatch = useStore((s) => s.applyAgentPatch);
  const endAgentTurn = useStore((s) => s.endAgentTurn);
  const setSelected = useStore((s) => s.setSelected);

  const [model, setModel] = useState(MODELS[0].id);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the message list as content streams in.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !project) return;
    setInput("");
    setChatError(null);

    const userMsg: ChatMessage = { id: uid(), role: "user", text, toolCalls: [] };
    const assistantMsg: ChatMessage = { id: uid(), role: "assistant", text: "", toolCalls: [] };
    appendChatMessage(userMsg);
    appendChatMessage(assistantMsg);
    setChatBusy(true);
    beginAgentTurn();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          // Send full chat history (text only — tool calls don't go back to
          // the model since the project state is re-attached each turn).
          messages: [...useStore.getState().chatMessages.filter((m) => m.role !== "system"), userMsg].map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            text: m.text,
          })),
          project: useStore.getState().project,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let lineEnd: number;
        while ((lineEnd = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, lineEnd).trim();
          buf = buf.slice(lineEnd + 1);
          if (!line) continue;
          let event: { type: string;[k: string]: unknown };
          try { event = JSON.parse(line); } catch { continue; }
          handleEvent(event);
        }
      }
      if (buf.trim()) {
        try { handleEvent(JSON.parse(buf)); } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChatError(msg);
      patchLastAssistant((cur) => ({ text: cur.text + (cur.text ? "\n\n" : "") + `_Error: ${msg}_` }));
    } finally {
      setChatBusy(false);
      // Commit the whole agent turn as a single labeled history step. If the
      // agent didn't actually change anything, endAgentTurn is a no-op.
      const summary = text.length > 60 ? text.slice(0, 57) + "…" : text;
      endAgentTurn(`Agent: ${summary}`);
    }

    function handleEvent(event: { type: string;[k: string]: unknown }) {
      switch (event.type) {
        case "text":
          patchLastAssistant((cur) => ({ text: cur.text + (event.delta as string) }));
          break;
        case "tool":
          patchLastAssistant((cur) => ({
            toolCalls: [
              ...cur.toolCalls,
              { id: event.id as string, name: event.name as string, input: event.input },
            ],
          }));
          break;
        case "tool_result":
          patchLastAssistant((cur) => ({
            toolCalls: cur.toolCalls.map((t) =>
              t.id === event.id
                ? { ...t, result: event.result as string, error: event.error as boolean | undefined }
                : t,
            ),
          }));
          break;
        case "patch":
          applyAgentPatch(event.project as Parameters<typeof applyAgentPatch>[0]);
          break;
        case "selection":
          setSelected(event.ids as string[]);
          break;
        case "error":
          setChatError(event.message as string);
          break;
        case "done":
          break;
      }
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-gray-700 bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2 text-sm">
        <span className="font-semibold">Chat</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded bg-gray-800 px-2 py-1 text-xs"
          disabled={busy}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 text-sm">
        {messages.length === 0 && (
          <div className="rounded bg-gray-800/60 px-3 py-2 leading-relaxed text-gray-400">
            <p className="text-gray-200 font-semibold">Try asking:</p>
            <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
              <li>&ldquo;Add a simple bass line under the melody.&rdquo;</li>
              <li>&ldquo;Use the diatonic chords of A minor for a chord voice.&rdquo;</li>
              <li>&ldquo;Transpose everything down an octave.&rdquo;</li>
              <li>&ldquo;Voice this in the style of late-Romantic chamber music.&rdquo;</li>
            </ul>
            <p className="mt-2 text-xs">
              The agent can read and edit the roll. You&rsquo;ll see notes appear/move as it works.
              Set <code className="text-gray-200">ANTHROPIC_API_KEY</code> on the server first.
            </p>
          </div>
        )}
        {messages.map((m) => <ChatBubble key={m.id} m={m} />)}
        {busy && <div className="mt-2 text-xs text-gray-500">Agent is working…</div>}
        {error && (
          <div className="mt-2 rounded border border-red-700 bg-red-900/40 px-2 py-1 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-gray-700 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          placeholder={busy ? "Working…" : "Ask the agent (Enter to send, Shift+Enter for newline)"}
          className="w-full resize-none rounded bg-gray-800 px-2 py-1 text-sm text-gray-100 placeholder-gray-500 disabled:opacity-50"
          disabled={busy || !project}
        />
        <div className="mt-1 flex justify-end">
          <button
            onClick={send}
            disabled={busy || !input.trim() || !project}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="mb-3 ml-auto max-w-[85%] rounded bg-blue-700/30 px-3 py-2 text-sm text-gray-100">
        {m.text}
      </div>
    );
  }
  return (
    <div className="mb-3 max-w-[95%] text-sm text-gray-200">
      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
      {m.toolCalls.length > 0 && (
        <div className="mt-1 space-y-1">
          {m.toolCalls.map((t) => (
            <details key={t.id} className="rounded bg-gray-800/60 px-2 py-1 text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-200">
                <span className={t.error ? "text-red-400" : "text-emerald-400"}>{t.error ? "✗" : t.result ? "✓" : "…"}</span>{" "}
                <span className="text-gray-200 font-mono">{t.name}</span>
                {t.result && <span className="ml-2 text-gray-500">— {t.result.length > 80 ? t.result.slice(0, 80) + "…" : t.result}</span>}
              </summary>
              <pre className="mt-1 overflow-x-auto text-[10px] leading-tight text-gray-400">{JSON.stringify(t.input, null, 2)}</pre>
              {t.result && <pre className="mt-1 overflow-x-auto text-[10px] leading-tight text-gray-300">{t.result}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
