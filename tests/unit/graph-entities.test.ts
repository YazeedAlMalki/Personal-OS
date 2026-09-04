import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureEdge,
  getGraph,
  linkEntitiesForCapture,
  recomputeImportance,
} from "@/lib/domains/entities";
import { importanceScore } from "@/lib/scoring/graph";

// ---------------------------------------------------------------------------
// Generic in-memory fake of the PostgREST query-builder surface the graph
// domain layer uses (select/insert/update + eq/in/ilike/or/order/limit +
// single/maybeSingle/thenable). Anything unmodeled simply matches nothing —
// assertions below keep the behavior honest.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseEq(expr: string): (r: Row) => boolean {
  const i = expr.indexOf(".eq.");
  const col = expr.slice(0, i);
  const val = expr.slice(i + 4);
  return (r) => r[col] === val;
}

class FakeDB {
  tables: Record<string, Row[]> = {};
  seq = 0;
  from(table: string) {
    return new QB(this, table);
  }
  get client(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

class QB implements PromiseLike<{ data: unknown; error: null }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  private limitN: number | null = null;

  constructor(private db: FakeDB, private table: string) {}

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  select(_cols?: string) {
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
  or(expr: string) {
    const preds = splitTop(expr).map((g) => {
      if (g.startsWith("and(") && g.endsWith(")")) {
        const inner = splitTop(g.slice(4, -1)).map(parseEq);
        return (r: Row) => inner.every((p) => p(r));
      }
      return parseEq(g);
    });
    this.filters.push((r) => preds.some((p) => p(r)));
    return this;
  }
  order(_col?: string, _opts?: unknown) {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private exec(): { data: Row[]; error: null } {
    if (this.op === "insert") {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted = arr.map((p) => ({
        id: `id-${++this.db.seq}`,
        user_id: "u1",
        created_at: new Date().toISOString(),
        ...p,
      }));
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
    const { data } = this.exec();
    return Promise.resolve({ data: data[0] ?? null, error: null });
  }
  single() {
    const { data } = this.exec();
    return data[0]
      ? Promise.resolve({ data: data[0], error: null })
      : Promise.resolve({ data: null, error: { message: "no rows" } });
  }
  then<R1, R2>(
    onfulfilled?: (v: { data: unknown; error: null }) => R1 | PromiseLike<R1>,
    onrejected?: (e: unknown) => R2 | PromiseLike<R2>,
  ) {
    return Promise.resolve(this.exec() as { data: unknown; error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

// No model is reachable in tests, so extractEntitiesWithFallback degrades to the
// deterministic regex extractor — exactly the zero-model production path.

describe("linkEntitiesForCapture", () => {
  it("creates new entities, bumps mentions, mirrors the contact and links the task", async () => {
    const db = new FakeDB();
    db.tables.entities = [
      {
        id: "e-acme",
        user_id: "u1",
        name: "Acme Inc",
        entity_type: "company",
        importance_score: 0,
        metadata: { mention_count: 2, last_mentioned_at: "2026-06-01T00:00:00Z" },
      },
    ];
    db.tables.contacts = [{ id: "c-sam", user_id: "u1", name: "Sam Rivera", entity_id: null }];
    db.tables.tasks = [
      { id: "t1", user_id: "u1", title: "Call Sam Rivera about Acme Inc", related_contact_id: null },
    ];

    const res = await linkEntitiesForCapture(db.client, {
      text: "Call Sam Rivera about Acme Inc",
      table: "tasks",
      recordId: "t1",
    });

    expect(res.via).toBe("regex");
    expect(res.matched).toEqual(["e-acme"]);
    expect(res.created).toHaveLength(1);

    // New person node for Sam Rivera.
    const sam = db.tables.entities.find((e) => e.name === "Sam Rivera");
    expect(sam).toBeDefined();
    expect(sam!.entity_type).toBe("person");
    expect((sam!.metadata as { mention_count: number }).mention_count).toBe(1);

    // Acme existed → mention bumped, not duplicated.
    const acme = db.tables.entities.find((e) => e.id === "e-acme")!;
    expect((acme.metadata as { mention_count: number }).mention_count).toBe(3);
    expect(db.tables.entities.filter((e) => (e.name as string).startsWith("Acme"))).toHaveLength(1);

    // Co-mention edge between the two.
    const edges = db.tables.entity_relationships ?? [];
    expect(edges).toHaveLength(1);
    expect(edges[0]!.relationship_type).toBe("mentioned_with");

    // Contact mirrored into the graph + task linked to the contact.
    expect(db.tables.contacts![0]!.entity_id).toBe(sam!.id);
    expect(db.tables.tasks![0]!.related_contact_id).toBe("c-sam");
  });

  it("never auto-creates from low-confidence guesses", async () => {
    const db = new FakeDB();
    db.tables.entities = [];
    const res = await linkEntitiesForCapture(db.client, {
      text: "fly to Paris next month",
      table: "notes",
      recordId: "n1",
    });
    expect(res.created).toEqual([]); // 'Paris' is location @ 0.5 < 0.6 threshold
    expect(db.tables.entities).toHaveLength(0);
  });
});

describe("ensureEdge", () => {
  it("is idempotent across directions and bumps strength on re-mention", async () => {
    const db = new FakeDB();
    await ensureEdge(db.client, "a", "b");
    await ensureEdge(db.client, "b", "a"); // reversed — must reuse the same edge
    expect(db.tables.entity_relationships).toHaveLength(1);
    expect(Number(db.tables.entity_relationships![0]!.strength)).toBeCloseTo(0.35, 6);
  });

  it("refuses self-loops", async () => {
    const db = new FakeDB();
    await ensureEdge(db.client, "a", "a");
    expect(db.tables.entity_relationships ?? []).toHaveLength(0);
  });
});

describe("getGraph", () => {
  it("returns nodes with degree and drops edges cut by the type filter", async () => {
    const db = new FakeDB();
    db.tables.entities = [
      { id: "p1", name: "Sam", entity_type: "person", importance_score: 50 },
      { id: "c1", name: "Acme", entity_type: "company", importance_score: 80 },
      { id: "t1", name: "Figma", entity_type: "tool", importance_score: 10 },
    ];
    db.tables.entity_relationships = [
      { id: "r1", source_entity_id: "p1", target_entity_id: "c1", relationship_type: "works_at", strength: 0.9 },
      { id: "r2", source_entity_id: "p1", target_entity_id: "t1", relationship_type: "uses", strength: 0.4 },
    ];

    const full = await getGraph(db.client);
    expect(full.nodes).toHaveLength(3);
    expect(full.edges).toHaveLength(2);
    expect(full.nodes.find((n) => n.id === "p1")!.degree).toBe(2);

    // Filtering out tools must also drop the person→tool edge.
    const filtered = await getGraph(db.client, ["person", "company"]);
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(["c1", "p1"]);
    expect(filtered.edges).toHaveLength(1);
    expect(filtered.nodes.find((n) => n.id === "p1")!.degree).toBe(1);
  });
});

describe("recomputeImportance", () => {
  it("writes degree/opportunity/mention-weighted scores and reports updates", async () => {
    const NOW = new Date("2026-06-10T12:00:00Z");
    const db = new FakeDB();
    db.tables.entities = [
      { id: "e1", user_id: "u1", importance_score: 0, metadata: { mention_count: 4, last_mentioned_at: NOW.toISOString() } },
      { id: "e2", user_id: "u1", importance_score: 0, metadata: {} },
    ];
    db.tables.entity_relationships = [
      { id: "r1", user_id: "u1", source_entity_id: "e1", target_entity_id: "e2" },
    ];
    db.tables.opportunities = [
      { id: "o1", user_id: "u1", estimated_value: 50_000, related_company_id: "e1", related_contact_id: null },
    ];
    db.tables.contacts = [];

    const updated = await recomputeImportance(db.client, undefined, NOW);

    const expected1 = importanceScore({
      degree: 1, maxDegree: 1,
      linkedOpportunityValue: 50_000, maxLinkedOpportunityValue: 50_000,
      mentionCount: 4, lastMentionedAt: NOW.toISOString(), now: NOW,
    });
    expect(Number(db.tables.entities![0]!.importance_score)).toBeCloseTo(expected1, 2);
    // e2: degree-only node → exactly 50.
    expect(Number(db.tables.entities![1]!.importance_score)).toBe(50);
    expect(updated).toBe(2);
  });

  it("routes opportunity value through the contact mirror", async () => {
    const NOW = new Date("2026-06-10T12:00:00Z");
    const db = new FakeDB();
    db.tables.entities = [
      { id: "e-sam", user_id: "u1", importance_score: 0, metadata: {} },
    ];
    db.tables.entity_relationships = [];
    db.tables.contacts = [{ id: "c-sam", user_id: "u1", entity_id: "e-sam" }];
    db.tables.opportunities = [
      { id: "o1", user_id: "u1", estimated_value: 30_000, related_company_id: null, related_contact_id: "c-sam" },
    ];

    await recomputeImportance(db.client, undefined, NOW);
    // Only opportunity component applies: 30 of 100.
    expect(Number(db.tables.entities![0]!.importance_score)).toBe(30);
  });
});
