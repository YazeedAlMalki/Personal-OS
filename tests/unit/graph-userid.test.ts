import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEntity,
  createRelationship,
  ensureEdge,
  linkEntitiesForCapture,
} from "@/lib/domains/entities";

// Step 2.5: graph writes must stamp user_id explicitly for service-role callers
// (Telegram/webhook), where auth.uid() is NULL and the column default can't fill
// it. This fake records the RAW insert payloads the app sends (unlike the fake in
// graph-entities.test.ts, which injects a default user_id and would mask the gap),
// so we can assert exactly which columns the app set.

type Row = Record<string, unknown>;

class RecordingDB {
  inserts: Record<string, Row[]> = {}; // raw payloads, no DB defaults applied
  tables: Record<string, Row[]> = {};
  seq = 0;
  from(table: string) {
    return new QB(this, table);
  }
  get client(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

class QB {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  private limitN: number | null = null;
  constructor(private db: RecordingDB, private table: string) {}
  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    (this.db.inserts[this.table] ??= []).push(...(Array.isArray(p) ? p : [p]));
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
      "i",
    );
    this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string));
    return this;
  }
  or() {
    // No pre-existing edges in these tests → existing-edge lookup matches nothing.
    this.filters.push(() => false);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  private exec(): { data: Row[]; error: null } {
    if (this.op === "insert") {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted = arr.map((p) => ({ id: `id-${++this.db.seq}`, ...p }));
      this.rows().push(...inserted);
      return { data: inserted, error: null };
    }
    let matched = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: matched, error: null };
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);
    return { data: matched, error: null };
  }
  maybeSingle() {
    return Promise.resolve({ data: this.exec().data[0] ?? null, error: null });
  }
  single() {
    const { data } = this.exec();
    return Promise.resolve(
      data[0] ? { data: data[0], error: null } : { data: null, error: { message: "no rows" } },
    );
  }
  then<R1, R2>(
    onfulfilled?: (v: { data: unknown; error: null }) => R1 | PromiseLike<R1>,
    onrejected?: (e: unknown) => R2 | PromiseLike<R2>,
  ) {
    return Promise.resolve(this.exec() as { data: unknown; error: null }).then(onfulfilled, onrejected);
  }
}

const UID = "user-123";

describe("graph writes stamp user_id for service-role callers", () => {
  it("createEntity sets user_id when provided, omits it otherwise", async () => {
    const withUser = new RecordingDB();
    await createEntity(withUser.client, { name: "Acme Inc", entity_type: "company" }, UID);
    expect(withUser.inserts["entities"]?.[0]?.user_id).toBe(UID);

    const noUser = new RecordingDB();
    await createEntity(noUser.client, { name: "Acme Inc", entity_type: "company" });
    expect("user_id" in (noUser.inserts["entities"]?.[0] ?? {})).toBe(false); // → DB default auth.uid()
  });

  it("createRelationship sets user_id when provided", async () => {
    const db = new RecordingDB();
    await createRelationship(
      db.client,
      { source_entity_id: "a", target_entity_id: "b", relationship_type: "works_at" },
      UID,
    );
    expect(db.inserts["entity_relationships"]?.[0]?.user_id).toBe(UID);
  });

  it("ensureEdge sets user_id on the inserted edge when provided", async () => {
    const db = new RecordingDB();
    await ensureEdge(db.client, "a", "b", "mentioned_with", UID);
    expect(db.inserts["entity_relationships"]?.[0]?.user_id).toBe(UID);
  });
});

describe("linkEntitiesForCapture (service-role path)", () => {
  const TEXT = "Call Sam Rivera at Acme Inc about the renewal";

  it("persists entities + edges stamped with the passed userId", async () => {
    const db = new RecordingDB();
    const res = await linkEntitiesForCapture(db.client, {
      text: TEXT,
      table: "tasks",
      recordId: "t1",
      userId: UID,
    });
    expect(res.via).toBe("regex"); // zero-model path
    expect(res.created.length).toBeGreaterThanOrEqual(1);

    const entityInserts = db.inserts["entities"] ?? [];
    expect(entityInserts.length).toBeGreaterThanOrEqual(1);
    // Every node the capture created carries the explicit owner — no reliance on auth.uid().
    for (const row of entityInserts) expect(row.user_id).toBe(UID);

    // The co-mention edge (Sam Rivera ↔ Acme Inc) is owner-stamped too.
    const edgeInserts = db.inserts["entity_relationships"] ?? [];
    expect(edgeInserts.length).toBeGreaterThanOrEqual(1);
    for (const row of edgeInserts) expect(row.user_id).toBe(UID);
  });

  it("preserves web behavior: omits user_id when no userId is passed (RLS default fills it)", async () => {
    const db = new RecordingDB();
    await linkEntitiesForCapture(db.client, { text: TEXT, table: "tasks", recordId: "t1" });

    const entityInserts = db.inserts["entities"] ?? [];
    expect(entityInserts.length).toBeGreaterThanOrEqual(1);
    for (const row of entityInserts) expect("user_id" in row).toBe(false);
  });
});
