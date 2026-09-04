"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/calendar/sync", { method: "POST" });
    const j = (await res.json().catch(() => null)) as
      | { upserted?: number; error?: string }
      | null;
    setBusy(false);
    if (!res.ok) {
      setMsg(j?.error ?? "Sync failed.");
      return;
    }
    setMsg(`Synced ${j?.upserted ?? 0} events.`);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-3">{msg}</span>}
      <button
        onClick={sync}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink-4 disabled:opacity-50"
      >
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        Sync ICS feed
      </button>
    </span>
  );
}
