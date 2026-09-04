"use client";

import { Panel } from "@/components/ui/Panel";
import type { EntityDetail } from "@/lib/db/graph-types";

export type EntityDetailData = EntityDetail;

function fmtMoney(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtDate(d: string | null): string {
  return d ? d.slice(0, 10) : "—";
}

// Side panel for the selected graph node: who/what it is, its mirrored CRM
// contact, its connections, and the opportunities + tasks linked to it.
export function EntityPanel({
  detail,
  loading,
  selected,
  onSelectEntity,
}: {
  detail: EntityDetailData | null;
  loading: boolean;
  selected: boolean;
  onSelectEntity: (id: string) => void;
}) {
  if (!selected) {
    return (
      <Panel title="Entity">
        <p className="text-sm text-ink-2">
          Click a node to see its company, connections, opportunities and linked tasks.
        </p>
      </Panel>
    );
  }
  if (loading || !detail) {
    return (
      <Panel title="Entity">
        <p className="text-sm text-ink-2">{loading ? "Loading…" : "Could not load entity."}</p>
      </Panel>
    );
  }

  const { entity, neighbors, contact, tasks, opportunities } = detail;
  const mentions = (entity.metadata?.mention_count as number | undefined) ?? 0;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink-4">{entity.name}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
              {entity.entity_type}
            </span>
          </div>
          <p className="text-xs text-ink-2">
            importance {Number(entity.importance_score).toFixed(1)} · {mentions} mention
            {mentions === 1 ? "" : "s"}
          </p>
          {entity.description && <p className="pt-1 text-sm text-ink-3">{entity.description}</p>}
        </div>
      </Panel>

      {contact && (
        <Panel title="Contact">
          <dl className="space-y-1 text-sm">
            {contact.company && (
              <div className="flex justify-between">
                <dt className="text-ink-2">Company</dt>
                <dd className="text-ink-4">{contact.company}</dd>
              </div>
            )}
            {contact.role && (
              <div className="flex justify-between">
                <dt className="text-ink-2">Role</dt>
                <dd className="text-ink-4">{contact.role}</dd>
              </div>
            )}
            {contact.email && (
              <div className="flex justify-between">
                <dt className="text-ink-2">Email</dt>
                <dd className="text-ink-4">{contact.email}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-2">Last contacted</dt>
              <dd className="text-ink-4">{fmtDate(contact.last_contacted_at)}</dd>
            </div>
          </dl>
        </Panel>
      )}

      <Panel title={`Connections (${neighbors.length})`}>
        {neighbors.length === 0 ? (
          <p className="text-sm text-ink-2">No connections yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {neighbors.map((n) => (
              <li key={n.relationship_id}>
                <button
                  onClick={() => onSelectEntity(n.entity.id)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-ink-0"
                >
                  <span className="text-ink-4">{n.entity.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-2">
                    {n.relationship_type.replaceAll("_", " ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {opportunities.length > 0 && (
        <Panel title={`Opportunities (${opportunities.length})`}>
          <ul className="space-y-1.5 text-sm">
            {opportunities.map((o) => (
              <li key={o.id} className="flex items-baseline justify-between gap-2">
                <span className="text-ink-4">{o.title}</span>
                <span className="shrink-0 text-xs text-ink-2">
                  {fmtMoney(o.estimated_value)} · {o.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tasks.length > 0 && (
        <Panel title={`Linked tasks (${tasks.length})`}>
          <ul className="space-y-1.5 text-sm">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-2">
                <span className={t.status === "done" ? "text-ink-2 line-through" : "text-ink-4"}>
                  {t.title}
                </span>
                <span className="shrink-0 text-xs text-ink-2">{fmtDate(t.due_date)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
