import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExport, restoreExport, totalRows, EXPORT_TABLES } from "@/lib/domains/export";

type Row = Record<string, unknown>;

// Minimal in-memory Supabase fake covering exactly the chains export.ts uses:
//   reads:  from(t).select("*").eq("user_id", id).range(a, b)   (awaited)
//   writes: from(t).insert(rows)                                  (awaited)
function makeFakeDb(seed: Record<string, Row[]> = {}) {
  const store: Record<string, Row[]> = {};
  for (const t of EXPORT_TABLES) store[t] = (seed[t] ?? []).map((r) => ({ ...r }));

  function tbl(name: string): Row[] {
    return (store[name] ??= []);
  }

  class Builder {
    private rows: Row[];
    private userId: string | null = null;
    private mode: "select" | "insert" = "select";
    private toInsert: Row[] = [];
    constructor(private name: string) {
      this.rows = tbl(name);
    }
    select() {
      this.mode = "select";
      return this;
    }
    eq(col: string, val: string) {
      if (col === "user_id") this.userId = val;
      return this;
    }
    range(_a: number, _b: number) {
      return this; // tiny dataset — one page returns everything
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    insert(rows: Row | Row[]) {
      this.mode = "insert";
      this.toInsert = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    private exec() {
      if (this.mode === "insert") {
        tbl(this.name).push(...this.toInsert.map((r) => ({ ...r })));
        return { data: null, error: null };
      }
      let rows = this.rows;
      if (this.userId) rows = rows.filter((r) => r.user_id === this.userId);
      return { data: rows.map((r) => ({ ...r })), error: null };
    }
    then<T1 = unknown, T2 = never>(
      onf?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
      onr?: (e: unknown) => T2 | PromiseLike<T2>,
    ): Promise<T1 | T2> {
      return Promise.resolve(this.exec()).then(onf, onr);
    }
  }

  const fake = { from: (name: string) => new Builder(name) } as unknown as SupabaseClient;
  return { fake, store };
}

describe("export / restore round-trip", () => {
  it("exports only the owner's rows", async () => {
    const { fake } = makeFakeDb({
      tasks: [
        { id: "t1", user_id: "u1", title: "mine" },
        { id: "t2", user_id: "u2", title: "theirs" },
      ],
      goals: [{ id: "g1", user_id: "u1", title: "goal" }],
    });
    const file = await buildExport(fake, "u1");
    expect(file.row_counts.tasks).toBe(1);
    expect(file.row_counts.goals).toBe(1);
    expect(file.tables.tasks?.[0]?.id).toBe("t1");
    expect(totalRows(file)).toBe(2);
  });

  it("round-trips: export from one project restores identically into an empty one", async () => {
    const seed = {
      profiles: [{ id: "u1", user_id: "u1", targets: { steps: 10000 } }],
      tasks: [
        { id: "t1", user_id: "u1", title: "a", status: "todo" },
        { id: "t2", user_id: "u1", title: "b", status: "done" },
      ],
      goals: [{ id: "g1", user_id: "u1", title: "ship" }],
      health_daily: [{ id: "h1", user_id: "u1", date: "2026-06-10", steps: 8000 }],
    };
    const src = makeFakeDb(seed);
    const file = await buildExport(src.fake, "u1");

    // Restore into a brand-new empty project under a different auth user.
    const dst = makeFakeDb();
    const result = await restoreExport(dst.fake, "u2", file);

    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(totalRows(file));
    // Every row landed and was re-owned by the importing user.
    expect(dst.store.tasks).toHaveLength(2);
    expect(dst.store.tasks?.every((r) => r.user_id === "u2")).toBe(true);
    expect(dst.store.goals?.[0]?.id).toBe("g1"); // ids preserved → FKs stay intact
    expect(dst.store.health_daily?.[0]?.steps).toBe(8000);
  });

  it("rejects an unsupported export version", async () => {
    const { fake } = makeFakeDb();
    await expect(
      restoreExport(fake, "u2", { version: 99 as 1, exported_at: "", user_id: "u1", row_counts: {}, tables: {} }),
    ).rejects.toThrow(/version/);
  });
});
