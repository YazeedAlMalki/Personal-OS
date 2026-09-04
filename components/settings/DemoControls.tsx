"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 8 — demo mode toggle. Load inserts tagged fixtures via
// POST /api/settings/demo; Clear removes exactly those rows (DELETE).
export function DemoControls({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/settings/demo", { method });
    setBusy(false);
    if (!res.ok) {
      setErr("Demo action failed — check server logs.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => call("POST")}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
        >
          {active ? "Reload demo data" : "Load demo data"}
        </button>
        {active && (
          <button
            onClick={() => call("DELETE")}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 disabled:opacity-50"
          >
            Clear demo data
          </button>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Inserts a small showcase dataset (tasks, goals, projects, opportunities,
        risks) tagged with <code>[demo]</code>. Crafted to trigger Chief-of-Staff
        alerts and forecasts. Clear removes only tagged rows — your real data is
        never touched.
      </p>
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
