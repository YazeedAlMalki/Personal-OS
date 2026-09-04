import type { Classified } from "@/lib/ai/types";

// Maps a classified capture to a destination table + a row to insert.
// Pure + deterministic → fully unit-testable. Only sets columns that exist and
// satisfies NOT NULL / CHECK constraints (e.g. risks.category).

export type RoutedRecord = { table: string; record: Record<string, unknown> };

export function kindToTable(kind: Classified["kind"]): string {
  switch (kind) {
    case "task":
      return "tasks";
    case "opportunity":
      return "opportunities";
    case "risk":
      return "risks";
    case "decision":
      return "decisions";
    case "contact":
      return "contacts";
    case "learning":
      return "learning_items";
    default:
      return "journal_entries"; // note | idea | journal | health | finance
  }
}

export function routeRecord(c: Classified, text: string): RoutedRecord {
  const table = kindToTable(c.kind);
  switch (table) {
    case "tasks":
      return {
        table,
        record: { title: c.title, priority: c.priority, due_date: c.due_date ?? null, source: "capture" },
      };
    case "opportunities":
      return { table, record: { title: c.title, status: "new" } };
    case "risks":
      return { table, record: { title: c.title, category: "business" } };
    case "decisions":
      return { table, record: { title: c.title } };
    case "contacts":
      return { table, record: { name: c.title } };
    case "learning_items":
      return { table, record: { title: c.title } };
    default:
      return { table: "journal_entries", record: { raw_text: text, summary: c.title } };
  }
}
