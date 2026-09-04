import { createClient } from "@/lib/supabase/server";
import { listContacts } from "@/lib/domains/contacts";
import { Panel } from "@/components/ui/Panel";
import { AddRecord } from "@/components/crud/AddRecord";
import { ItemRow } from "@/components/crud/ItemRow";

export default async function CrmPage() {
  const supabase = await createClient();
  let contacts;
  try {
    contacts = await listContacts(supabase);
  } catch {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="CRM">
          <p className="text-sm text-danger">Could not load contacts. Check Supabase env vars and migrations.</p>
        </Panel>
      </div>
    );
  }

  const now = new Date().toISOString();
  const overdue = contacts.filter((c) => c.next_follow_up_at != null && c.next_follow_up_at < now).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink-4">CRM</h1>
        <p className="text-sm text-ink-3">
          {contacts.length} contacts ·{" "}
          {overdue > 0 ? <span className="text-danger">{overdue} overdue follow-ups</span> : "no overdue follow-ups"}
        </p>
      </div>
      <Panel>
        <AddRecord
          endpoint="/api/contacts"
          submitLabel="Add contact"
          fields={[
            { name: "name", placeholder: "Name", required: true },
            { name: "company", placeholder: "Company" },
            { name: "email", placeholder: "Email", type: "email" },
            { name: "role", placeholder: "Role", width: "half" },
            { name: "next_follow_up_at", placeholder: "Follow up", type: "datetime-local", width: "half" },
          ]}
        />
      </Panel>
      <Panel title={`All contacts (${contacts.length})`}>
        {contacts.length === 0 ? (
          <p className="text-sm text-ink-3">
            No contacts yet. Mention people in captures (“met Sam Rivera from Northwind”) and the graph
            mirrors them here, or add them directly.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {contacts.map((c) => (
              <ItemRow
                key={c.id}
                endpoint="/api/contacts"
                id={c.id}
                title={c.name}
                badge={c.relationship_strength != null ? `★${c.relationship_strength}` : undefined}
                subtitle={[
                  c.role,
                  c.company,
                  c.email,
                  c.next_follow_up_at ? `follow up ${c.next_follow_up_at.slice(0, 10)}` : null,
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
