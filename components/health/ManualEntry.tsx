"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Form = {
  date: string;
  steps: string;
  sleep_minutes: string;
  resting_heart_rate: string;
  hrv: string;
  active_energy_burned: string;
  weight: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Form => ({
  date: today(),
  steps: "",
  sleep_minutes: "",
  resting_heart_rate: "",
  hrv: "",
  active_energy_burned: "",
  weight: "",
  notes: "",
});

// Manual-entry card for `health_daily`. Submits to /api/health which upserts
// by (user_id, date) and recomputes the three scores.
export function ManualEntry() {
  const router = useRouter();
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function setField<K extends keyof Form>(k: K, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = { date: f.date, source: "manual" };
    const numFields = [
      "steps",
      "sleep_minutes",
      "resting_heart_rate",
      "hrv",
      "active_energy_burned",
      "weight",
    ] as const;
    for (const k of numFields) {
      const v = f[k];
      if (v !== "") body[k] = Number(v);
    }
    if (f.notes) body.notes = f.notes;

    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg("Save failed.");
      return;
    }
    setF(blank());
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <FormField label="Date" type="date" value={f.date} onChange={(v) => setField("date", v)} />
      <FormField label="Steps" type="number" value={f.steps} onChange={(v) => setField("steps", v)} />
      <FormField label="Sleep (min)" type="number" value={f.sleep_minutes} onChange={(v) => setField("sleep_minutes", v)} />
      <FormField label="Resting HR" type="number" value={f.resting_heart_rate} onChange={(v) => setField("resting_heart_rate", v)} />
      <FormField label="HRV" type="number" value={f.hrv} onChange={(v) => setField("hrv", v)} />
      <FormField label="Active kcal" type="number" value={f.active_energy_burned} onChange={(v) => setField("active_energy_burned", v)} />
      <FormField label="Weight" type="number" value={f.weight} onChange={(v) => setField("weight", v)} />
      <FormField label="Notes" type="text" value={f.notes} onChange={(v) => setField("notes", v)} />
      <div className="col-span-2 flex items-center gap-3 sm:col-span-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save day"}
        </button>
        {msg && <p className="text-xs text-ink-3">{msg}</p>}
      </div>
    </form>
  );
}

function FormField({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-3">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-ink-0 px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}
