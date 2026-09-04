"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

interface AskSource {
  source_type: string;
  source_id: string | null;
  text: string;
  similarity: number;
  created_at: string;
}

// §10 /api/ask — the only model-calling read path, fired ONLY on explicit click.
export function AskPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setAnswer(null);
    setSources([]);
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q.trim() }),
    });
    const j = (await res.json().catch(() => null)) as
      | { data?: { answer: string; sources: AskSource[] }; error?: string }
      | null;
    setBusy(false);
    if (!res.ok || !j?.data) {
      setErr(j?.error ?? "Ask failed.");
      return;
    }
    setAnswer(j.data.answer);
    setSources(j.data.sources);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask your OS anything — “what did I decide about the Acme retainer?”"
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
        >
          <Sparkles size={14} />
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      {err && <p className="text-sm text-danger">{err}</p>}
      {answer && (
        <div className="space-y-2 rounded-lg border border-line bg-ink-0 p-3">
          <p className="whitespace-pre-wrap text-sm text-ink-4">{answer}</p>
          {sources.length > 0 && (
            <details className="text-xs text-ink-3">
              <summary className="cursor-pointer">
                {sources.length} memory source{sources.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 space-y-1">
                {sources.map((s, i) => (
                  <li key={i} className="truncate">
                    [{i + 1}] {s.source_type} · {s.created_at.slice(0, 10)} · “{s.text}”
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
