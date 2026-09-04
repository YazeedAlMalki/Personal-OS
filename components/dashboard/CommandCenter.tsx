"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CaptureResult =
  | { status: "created"; table: string; classified: { kind: string }; via: string }
  | { status: "review"; via: string }
  | { status: "error"; error: string };

// Quick-capture box. Type anything; the pipeline classifies and files it
// (or sends it to the review queue when unsure). Same pipeline the bot will use.
export function CommandCenter() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    const json = (await res.json().catch(() => null)) as CaptureResult | null;
    setBusy(false);
    if (!res.ok || !json) {
      setMsg("Capture failed.");
      return;
    }
    if (json.status === "created") setMsg(`Filed as ${json.classified.kind} → ${json.table} (via ${json.via}).`);
    else if (json.status === "review") setMsg(`Unclear — sent to the review queue (via ${json.via}).`);
    else setMsg("Saved.");
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Capture anything — a task, idea, note, contact, risk… AI files it for you."
        className="w-full resize-none rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-ink-3">{msg}</span>
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
        >
          {busy ? "Filing…" : "Capture"}
        </button>
      </div>
    </form>
  );
}
