import { createClient } from "@/lib/supabase/server";
import { listFinanceSnapshots } from "@/lib/domains/finance";
import { Panel } from "@/components/ui/Panel";
import { AddRecord } from "@/components/crud/AddRecord";
import { ItemRow } from "@/components/crud/ItemRow";

function fmt(n: number | null, currency: string): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default async function FinancePage() {
  const supabase = await createClient();
  let snaps;
  try {
    snaps = await listFinanceSnapshots(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Finance">
          <p className="text-sm text-danger">Could not load finance snapshots. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const latest = snaps[0] ?? null;
  const prev = snaps[1] ?? null;
  const delta =
    latest?.net_worth != null && prev?.net_worth != null ? latest.net_worth - prev.net_worth : null;
  const currency = latest?.currency ?? "USD";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">Finance</h1>
        <p className="text-sm text-ink-3">
          Net worth: <span className="font-semibold text-ink-4">{fmt(latest?.net_worth ?? null, currency)}</span>
          {delta != null && (
            <span className={delta >= 0 ? "text-success" : "text-danger"}>
              {" "}({delta >= 0 ? "+" : ""}{fmt(delta, currency)})
            </span>
          )}
        </p>
      </div>
      <Panel title="Add snapshot (one per date — resubmitting a date updates it)">
        <AddRecord
          endpoint="/api/finance"
          submitLabel="Save"
          fields={[
            { name: "date", placeholder: "Date", type: "date", required: true },
            { name: "net_worth", placeholder: "Net worth", type: "number" },
            { name: "cash_balance", placeholder: "Cash", type: "number" },
            { name: "assets", placeholder: "Assets", type: "number" },
            { name: "liabilities", placeholder: "Liabilities", type: "number" },
            { name: "investment_value", placeholder: "Investments", type: "number" },
            { name: "income_month_to_date", placeholder: "Income MTD", type: "number", width: "half" },
            { name: "expenses_month_to_date", placeholder: "Expenses MTD", type: "number", width: "half" },
          ]}
        />
      </Panel>
      <Panel title={`Snapshots (${snaps.length})`}>
        {snaps.length === 0 ? (
          <p className="text-sm text-ink-3">
            No snapshots yet. Add one above — weekly is plenty. The analytics cron correlates these
            with the rest of your data.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {snaps.map((s) => (
              <ItemRow
                key={s.id}
                endpoint="/api/finance"
                id={s.id}
                title={`${s.date} — net ${fmt(s.net_worth, s.currency)}`}
                badge={s.source}
                subtitle={[
                  s.cash_balance != null ? `cash ${fmt(s.cash_balance, s.currency)}` : null,
                  s.investment_value != null ? `invested ${fmt(s.investment_value, s.currency)}` : null,
                  s.expenses_month_to_date != null ? `spent MTD ${fmt(s.expenses_month_to_date, s.currency)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
