"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Generic multi-field creator — the n-field sibling of AddItem. Declarative
// field list in, one JSON POST out. Numbers are coerced, empties dropped.
export interface RecordField {
  name: string;
  placeholder: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email";
  required?: boolean;
  options?: string[]; // renders a <select>
  width?: "full" | "half" | "third";
}

const WIDTHS = { full: "w-full", half: "w-[calc(50%-0.25rem)]", third: "w-[calc(33.5%-0.34rem)]" };

export function AddRecord({
  endpoint,
  fields,
  submitLabel = "Add",
}: {
  endpoint: string;
  fields: RecordField[];
  submitLabel?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (values[f.name] ?? "").trim();
      if (!raw) {
        if (f.required) {
          setErr(`${f.placeholder} is required.`);
          return;
        }
        continue;
      }
      if (f.type === "number") body[f.name] = Number(raw);
      else if (f.type === "datetime-local") body[f.name] = new Date(raw).toISOString();
      else body[f.name] = raw;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      setErr(typeof j?.error === "string" ? j.error : "Could not add.");
      return;
    }
    setValues({});
    router.refresh();
  }

  const input =
    "min-w-0 rounded-lg border border-line bg-ink-0 px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form onSubmit={add} className="flex flex-wrap gap-2">
      {fields.map((f) =>
        f.options ? (
          <select
            key={f.name}
            value={values[f.name] ?? ""}
            onChange={(e) => set(f.name, e.target.value)}
            className={`${input} ${WIDTHS[f.width ?? "third"]} text-ink-3`}
            aria-label={f.placeholder}
          >
            <option value="">{f.placeholder}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            key={f.name}
            type={f.type ?? "text"}
            value={values[f.name] ?? ""}
            onChange={(e) => set(f.name, e.target.value)}
            placeholder={f.placeholder + (f.required ? " *" : "")}
            aria-label={f.placeholder}
            className={`${input} ${WIDTHS[f.width ?? "third"]}`}
          />
        ),
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-50"
      >
        {submitLabel}
      </button>
      {err && <p className="w-full text-sm text-danger">{err}</p>}
    </form>
  );
}
