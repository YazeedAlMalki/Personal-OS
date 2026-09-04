"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Generic single-field creator. POSTs { title } to `endpoint`.
export function AddItem({
  endpoint,
  placeholder,
}: {
  endpoint: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr("Could not add.");
      return;
    }
    setTitle("");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent"
      />
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
