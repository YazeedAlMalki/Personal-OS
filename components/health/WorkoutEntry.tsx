"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const today = () => new Date().toISOString().slice(0, 10);

export function WorkoutEntry() {
  const router = useRouter();
  const [date, setDate] = useState(today());
  const [type, setType] = useState("");
  const [minutes, setMinutes] = useState("");
  const [calories, setCalories] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type || !minutes) return;
    setBusy(true);
    const res = await fetch("/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        workout_type: type,
        duration_minutes: Number(minutes),
        calories_burned: calories ? Number(calories) : null,
        source: "manual",
      }),
    });
    setBusy(false);
    if (res.ok) {
      setType("");
      setMinutes("");
      setCalories("");
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label="Date">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Type">
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="e.g. run"
          className="rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Minutes">
        <input
          type="number"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-24 rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="kcal">
        <input
          type="number"
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          className="w-24 rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-0 disabled:opacity-50"
      >
        Log workout
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-3">{label}</span>
      {children}
    </label>
  );
}
