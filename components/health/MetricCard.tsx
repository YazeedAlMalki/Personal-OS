import { SparkLine } from "@/components/health/SparkLine";

// One health metric tile: today's value (or em-dash), label, 14d trend.
export function MetricCard({
  label,
  value,
  unit,
  series,
  hint,
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  series?: Array<number | null | undefined>;
  hint?: string;
}) {
  const display =
    value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="rounded-2xl border border-line bg-ink-1 p-4">
      <p className="text-xs uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl text-ink-4">{display}</span>
        {unit && display !== "—" && (
          <span className="text-xs text-ink-3">{unit}</span>
        )}
      </div>
      {series && (
        <div className="mt-2 text-accent">
          <SparkLine values={series} width={180} height={28} />
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}
