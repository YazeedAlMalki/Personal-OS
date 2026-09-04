"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddTask() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), priority }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr("Could not add task.");
      return;
    }
    setTitle("");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="flex flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task…"
        className="min-w-0 flex-1 rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        className="rounded-lg border border-line bg-ink-0 px-2 py-2 text-sm text-ink-3"
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="urgent">urgent</option>
      </select>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
      >
        Add
      </button>
      {err && <p className="w-full text-sm text-danger">{err}</p>}
    </form>
  );
}
