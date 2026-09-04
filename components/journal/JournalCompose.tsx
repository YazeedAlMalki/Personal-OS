"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SCALES: { name: "mood" | "energy_level" | "stress_level" | "sleep_quality"; label: string }[] = [
  { name: "mood", label: "Mood" },
  { name: "energy_level", label: "Energy" },
  { name: "stress_level", label: "Stress" },
  { name: "sleep_quality", label: "Sleep" },
];

export function JournalCompose() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [scales, setScales] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { raw_text: text.trim() };
    for (const s of SCALES) if (scales[s.name]) body[s.name] = Number(scales[s.name]);
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setErr("Could not save the entry.");
      return;
    }
    setText("");
    setScales({});
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What happened today? What did you learn?"
        rows={4}
        className="w-full rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        {SCALES.map((s) => (
          <select
            key={s.name}
            value={scales[s.name] ?? ""}
            onChange={(e) => setScales((p) => ({ ...p, [s.name]: e.target.value }))}
            aria-label={s.label}
            className="rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-xs text-ink-3 outline-none focus:border-accent"
          >
            <option value="">{s.label} —</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {s.label} {n}/5
              </option>
            ))}
          </select>
        ))}
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
        >
          Save entry
        </button>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
    </form>
  );
}
