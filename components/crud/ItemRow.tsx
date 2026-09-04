"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

// Generic read+delete row. delete → `${endpoint}/${id}`.
export function ItemRow({
  endpoint,
  id,
  title,
  badge,
  subtitle,
}: {
  endpoint: string;
  id: string;
  title: string;
  badge?: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await fetch(`${endpoint}/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-4">{title}</p>
        {subtitle && <p className="truncate text-xs text-ink-3">{subtitle}</p>}
      </div>
      {badge && (
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-ink-3">
          {badge}
        </span>
      )}
      <button
        onClick={remove}
        disabled={busy}
        aria-label="Delete"
        className="shrink-0 text-ink-3 hover:text-danger"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
