"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const today = () => new Date().toISOString().slice(0, 10);

export function NutritionEntry() {
  const router = useRouter();
  const [date, setDate] = useState(today());
  const [meal, setMeal] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!meal || (!calories && !protein)) return;
    setBusy(true);
    const res = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        meal_name: meal,
        calories: calories ? Number(calories) : null,
        protein: protein ? Number(protein) : null,
        source: "manual",
      }),
    });
    setBusy(false);
    if (res.ok) {
      setMeal("");
      setCalories("");
      setProtein("");
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
      <Field label="Meal">
        <input
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          placeholder="e.g. breakfast"
          className="rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Calories">
        <input
          type="number"
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          className="w-24 rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Protein (g)">
        <input
          type="number"
          value={protein}
          onChange={(e) => setProtein(e.target.value)}
          className="w-24 rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm"
        />
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-0 disabled:opacity-50"
      >
        Log meal
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
