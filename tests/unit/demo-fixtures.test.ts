import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDemo, clearDemo, DEMO_TAG, DEMO_TABLES } from "@/lib/demo/fixtures";

type Row = Record<string, unknown>;

// In-memory fake covering exactly the chains fixtures.ts uses:
//   from(t).insert(rows)                        (awaited → { error })
//   from(t).delete().like("title", pattern)     (awaited → { error })
function makeFakeDb() {
  const store: Record<string, Row[]> = {};
  const tbl = (name: string): Row[] => (store[name] ??= []);

  class Builder {
    private mode: "insert" | "delete" = "insert";
    private toInsert: Row[] = [];
    private likePattern: string | null = null;
    constructor(private name: string) {}
    insert(rows: Row | Row[]) {
      this.mode = "insert";
      this.toInsert = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    like(_col: string, pattern: string) {
      this.likePattern = pattern;
      return this;
    }
    private exec() {
      if (this.mode === "insert") {
        tbl(this.name).push(...this.toInsert.map((r) => ({ ...r })));
      } else {
        const prefix = (this.likePattern ?? "").replace(/%$/, "");
        store[this.name] = tbl(this.name).filter(
          (r) => !String(r.title ?? "").startsWith(prefix),
        );
      }
      return { error: null };
    }
    then(resolve: (v: { error: null }) => void) {
      resolve(this.exec());
    }
  }

  return {
    db: { from: (name: string) => new Builder(name) } as unknown as SupabaseClient,
    store,
  };
}

describe("demo fixtures (Phase 8)", () => {
  it("loads tagged rows into every demo table", async () => {
    const { db, store } = makeFakeDb();
    await loadDemo(db);
    for (const table of DEMO_TABLES) {
      expect(store[table]?.length, table).toBeGreaterThan(0);
      for (const row of store[table] ?? []) {
        expect(String(row.title).startsWith(`${DEMO_TAG} `)).toBe(true);
      }
    }
  });

  it("is idempotent — loading twice never duplicates", async () => {
    const { db, store } = makeFakeDb();
    await loadDemo(db);
    const counts = DEMO_TABLES.map((t) => store[t]?.length ?? 0);
    await loadDemo(db);
    expect(DEMO_TABLES.map((t) => store[t]?.length ?? 0)).toEqual(counts);
  });

  it("clear removes only tagged rows", async () => {
    const { db, store } = makeFakeDb();
    // a real (untagged) user row that must survive
    store.tasks = [{ title: "My real task" }];
    await loadDemo(db);
    expect(store.tasks.length).toBeGreaterThan(1);
    await clearDemo(db);
    for (const table of DEMO_TABLES) {
      const remaining = store[table] ?? [];
      expect(remaining.every((r) => !String(r.title).startsWith(DEMO_TAG))).toBe(true);
    }
    expect(store.tasks).toEqual([{ title: "My real task" }]);
  });

  it("fixtures include intelligence triggers (overdue, postponed, unmitigated)", async () => {
    const { db, store } = makeFakeDb();
    await loadDemo(db);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (store.tasks ?? []).some((r) => typeof r.due_date === "string" && r.due_date < today),
    ).toBe(true); // overdue task
    expect((store.tasks ?? []).some((r) => (r.postpone_count as number) >= 3)).toBe(true);
    expect(
      (store.risks ?? []).some(
        (r) => !r.mitigation_plan && (r.probability as number) * (r.impact as number) >= 15,
      ),
    ).toBe(true); // unmitigated high risk
    expect(
      (store.opportunities ?? []).some(
        (r) => !r.next_action && (r.estimated_value as number) >= 10_000,
      ),
    ).toBe(true); // idle high-value opportunity
  });
});
