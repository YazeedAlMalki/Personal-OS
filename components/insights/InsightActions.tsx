"use client";

import { useState, useTransition } from "react";

type Status = "new" | "seen" | "acted" | "dismissed" | "snoozed";

const LABELS: Record<Exclude<Status, "new" | "snoozed">, string> = {
  seen: "Seen",
  acted: "Acted",
  dismissed: "Dismiss",
};

export function InsightActions({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: Status;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function patch(next: Status) {
    setErr(null);
    startTransition(async () => {
      const prev = status;
      setStatus(next); // optimistic
      try {
        const r = await fetch(`/api/insights/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!r.ok) throw new Error(await r.text());
      } catch (e) {
        setStatus(prev);
        setErr((e as Error).message);
      }
    });
  }

  if (status === "dismissed") {
    return <span className="text-xs text-ink-3">Dismissed</span>;
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      {(["seen", "acted", "dismissed"] as const).map((s) => {
        const active = status === s;
        return (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => patch(s)}
            className={
              "rounded-full border px-2 py-0.5 transition " +
              (active
                ? "border-accent bg-accent/10 text-accent"
                : "border-line text-ink-3 hover:bg-ink-2")
            }
          >
            {LABELS[s]}
          </button>
        );
      })}
      {err && <span className="ml-1 text-danger">!</span>}
    </div>
  );
}
