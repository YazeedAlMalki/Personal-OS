"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

export function ReviewItem({
  id,
  proposedTable,
  proposed,
  confidence,
  reason,
}: {
  id: string;
  proposedTable: string;
  proposed: Record<string, unknown>;
  confidence: number | null;
  reason: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve(action: "accept" | "reject") {
    setBusy(true);
    await fetch(`/api/review/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    router.refresh();
  }

  const title = String(proposed.title ?? proposed.name ?? proposed.raw_text ?? "(item)");

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-4">{title}</p>
        <p className="text-xs text-ink-3">
          → {proposedTable} · {reason}
          {confidence != null && ` · ${Math.round(confidence * 100)}% sure`}
        </p>
      </div>
      <button
        onClick={() => resolve("accept")}
        disabled={busy}
        className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ok hover:bg-ink-2"
      >
        <Check size={14} /> Accept
      </button>
      <button
        onClick={() => resolve("reject")}
        disabled={busy}
        className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-danger hover:bg-ink-2"
      >
        <X size={14} /> Reject
      </button>
    </li>
  );
}
