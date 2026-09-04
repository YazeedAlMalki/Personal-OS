"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import type { Task } from "@/lib/db/types";

export function TaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const done = task.status === "done";

  async function patch(body: object) {
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <button
        onClick={() => patch({ status: done ? "todo" : "done" })}
        disabled={busy}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          done ? "border-ok bg-ok text-ink-0" : "border-line"
        }`}
      >
        {done && <Check size={13} />}
      </button>
      <span className={`flex-1 truncate text-sm ${done ? "text-ink-3 line-through" : "text-ink-4"}`}>
        {task.title}
      </span>
      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-ink-3">
        {task.priority}
      </span>
      <button
        onClick={remove}
        disabled={busy}
        aria-label="Delete task"
        className="shrink-0 text-ink-3 hover:text-danger"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
