import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEntitiesWithFallback } from "@/lib/ai";
import type { EntityType, ExtractedEntity } from "@/lib/ai/types";
import type {
  EntityDetail,
  EntityNeighbor,
  EntityRelationshipRow,
  EntityRow,
  GraphEdge,
  GraphNode,
  GraphPayload,
} from "@/lib/db/graph-types";
import { importanceScore } from "@/lib/scoring/graph";

// Graph domain layer (Phase 6). All writes run under the caller's RLS-scoped
// client (user_id defaults to auth.uid()); the cron uses the service client
// with an explicit userId filter.

// Below this confidence an extracted name may still MATCH an existing entity,
// but will never CREATE a new one (P3: weak guesses don't spawn junk nodes).
export const ENTITY_AUTOCREATE_THRESHOLD = 0.6;
const CO_MENTION_TYPE = "mentioned_with";
const CO_MENTION_BASE_STRENGTH = 0.3;
const CO_MENTION_BUMP = 0.05;

// ---- CRUD ------------------------------------------------------------------

export async function listEntities(
  supabase: SupabaseClient,
  type?: EntityType,
): Promise<EntityRow[]> {
  let q = supabase.from("entities").select("*").order("importance_score", { ascending: false });
  if (type) q = q.eq("entity_type", type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EntityRow[];
}

export async function createEntity(
  supabase: SupabaseClient,
  input: { name: string; entity_type: EntityType; description?: string | null; metadata?: Record<string, unknown> },
  userId?: string,
): Promise<EntityRow> {
  const { data, error } = await supabase
    .from("entities")
    .insert({
      name: input.name,
      entity_type: input.entity_type,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
      // Service-role callers (Telegram/webhook) have no auth.uid(); stamp the owner
      // explicitly. RLS callers omit it → the column default (auth.uid()) fills it.
      ...(userId ? { user_id: userId } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as EntityRow;
}

export async function createRelationship(
  supabase: SupabaseClient,
  input: {
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    strength?: number | null;
    notes?: string | null;
  },
  userId?: string,
): Promise<EntityRelationshipRow> {
  const { data, error } = await supabase
    .from("entity_relationships")
    .insert({
      source_entity_id: input.source_entity_id,
      target_entity_id: input.target_entity_id,
      relationship_type: input.relationship_type,
      strength: input.strength ?? null,
      notes: input.notes ?? null,
      // See createEntity: explicit owner for service-role callers; RLS omits it.
      ...(userId ? { user_id: userId } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as EntityRelationshipRow;
}

// ---- Resolution & mentions ---------------------------------------------------

// Exact (case-insensitive) match first, then prefix/substring fuzzy match.
// Mirrors the trgm index strategy without needing an RPC.
export async function findEntityByName(
  supabase: SupabaseClient,
  name: string,
): Promise<EntityRow | null> {
  const exact = await supabase
    .from("entities")
    .select("*")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (exact.data) return exact.data as EntityRow;
  const fuzzy = await supabase
    .from("entities")
    .select("*")
    .ilike("name", `%${name}%`)
    .order("importance_score", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (fuzzy.data as EntityRow | null) ?? null;
}

// Bump mention counters kept in metadata jsonb (no schema change needed).
export async function recordMention(
  supabase: SupabaseClient,
  entity: EntityRow,
  now: Date = new Date(),
): Promise<void> {
  const metadata = {
    ...(entity.metadata ?? {}),
    mention_count: ((entity.metadata?.mention_count as number | undefined) ?? 0) + 1,
    last_mentioned_at: now.toISOString(),
  };
  await supabase.from("entities").update({ metadata }).eq("id", entity.id);
}

// Idempotent edge: reuse an existing edge in either direction (bumping its
// strength slightly), otherwise create one.
export async function ensureEdge(
  supabase: SupabaseClient,
  aId: string,
  bId: string,
  relationship_type: string = CO_MENTION_TYPE,
  userId?: string,
): Promise<void> {
  if (aId === bId) return;
  const { data: existing } = await supabase
    .from("entity_relationships")
    .select("id, strength")
    .eq("relationship_type", relationship_type)
    .or(
      `and(source_entity_id.eq.${aId},target_entity_id.eq.${bId}),` +
        `and(source_entity_id.eq.${bId},target_entity_id.eq.${aId})`,
    )
    .limit(1)
    .maybeSingle();
  if (existing) {
    const strength = Math.min(1, (Number(existing.strength) || CO_MENTION_BASE_STRENGTH) + CO_MENTION_BUMP);
    await supabase.from("entity_relationships").update({ strength }).eq("id", existing.id);
    return;
  }
  await supabase.from("entity_relationships").insert({
    source_entity_id: aId,
    target_entity_id: bId,
    relationship_type,
    strength: CO_MENTION_BASE_STRENGTH,
    // Explicit owner for service-role callers; RLS callers omit → auth.uid() default.
    ...(userId ? { user_id: userId } : {}),
  });
}

// A person entity and a CRM contact with the same name mirror each other via
// contacts.entity_id (architecture §5.5).
async function mirrorContact(
  supabase: SupabaseClient,
  entity: EntityRow,
): Promise<{ id: string } | null> {
  if (entity.entity_type !== "person") return null;
  const { data: byEntity } = await supabase
    .from("contacts")
    .select("id")
    .eq("entity_id", entity.id)
    .limit(1)
    .maybeSingle();
  if (byEntity) return byEntity as { id: string };
  const { data: byName } = await supabase
    .from("contacts")
    .select("id, entity_id")
    .ilike("name", entity.name)
    .limit(1)
    .maybeSingle();
  if (byName) {
    if (!byName.entity_id) {
      await supabase.from("contacts").update({ entity_id: entity.id }).eq("id", byName.id);
    }
    return { id: byName.id as string };
  }
  return null;
}

// ---- Pipeline hook -----------------------------------------------------------

export type CaptureLinkResult = {
  via: string;
  matched: string[]; // entity ids that already existed
  created: string[]; // entity ids created by this capture
};

// Called by the capture pipeline AFTER the structured row is written. Best-effort:
// the caller wraps this in try/catch — graph enrichment must never break capture.
export async function linkEntitiesForCapture(
  supabase: SupabaseClient,
  opts: { text: string; table: string; recordId: string; now?: Date; userId?: string },
): Promise<CaptureLinkResult> {
  const now = opts.now ?? new Date();
  const { entities: extracted, via } = await extractEntitiesWithFallback(opts.text);
  const matched: string[] = [];
  const created: string[] = [];
  const resolved: EntityRow[] = [];

  for (const e of extracted.slice(0, 8)) {
    const existing = await findEntityByName(supabase, e.name);
    if (existing) {
      await recordMention(supabase, existing, now);
      matched.push(existing.id);
      resolved.push(existing);
      continue;
    }
    if (e.confidence >= ENTITY_AUTOCREATE_THRESHOLD) {
      const row = await createEntity(supabase, {
        name: e.name,
        entity_type: e.entity_type,
        metadata: { mention_count: 1, last_mentioned_at: now.toISOString(), source: "capture" },
      }, opts.userId);
      created.push(row.id);
      resolved.push(row);
    }
    // else: low-confidence + unknown → skipped (propose-new-entity is a review
    // concern, not an auto-write — P3).
  }

  // Co-mention edges between everything that appeared in the same capture.
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      if (a && b) await ensureEdge(supabase, a.id, b.id, CO_MENTION_TYPE, opts.userId);
    }
  }

  // Link the captured record to the graph via the contact mirror.
  const firstPerson = resolved.find((r) => r.entity_type === "person");
  const firstCompany = resolved.find((r) => r.entity_type === "company");
  if (firstPerson && (opts.table === "tasks" || opts.table === "opportunities")) {
    const contact = await mirrorContact(supabase, firstPerson);
    if (contact) {
      const { data: rec } = await supabase
        .from(opts.table)
        .select("id, related_contact_id")
        .eq("id", opts.recordId)
        .maybeSingle();
      if (rec && !rec.related_contact_id) {
        await supabase
          .from(opts.table)
          .update({ related_contact_id: contact.id })
          .eq("id", opts.recordId);
      }
    }
  }
  if (firstCompany && opts.table === "opportunities") {
    const { data: rec } = await supabase
      .from("opportunities")
      .select("id, related_company_id")
      .eq("id", opts.recordId)
      .maybeSingle();
    if (rec && !rec.related_company_id) {
      await supabase
        .from("opportunities")
        .update({ related_company_id: firstCompany.id })
        .eq("id", opts.recordId);
    }
  }

  return { via, matched, created };
}

// ---- Graph payloads ------------------------------------------------------------

export async function getGraph(
  supabase: SupabaseClient,
  types?: EntityType[],
): Promise<GraphPayload> {
  let nodeQuery = supabase
    .from("entities")
    .select("id, name, entity_type, importance_score");
  if (types && types.length > 0) nodeQuery = nodeQuery.in("entity_type", types);
  const [{ data: ents, error: e1 }, { data: rels, error: e2 }] = await Promise.all([
    nodeQuery,
    supabase
      .from("entity_relationships")
      .select("id, source_entity_id, target_entity_id, relationship_type, strength"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const nodeIds = new Set((ents ?? []).map((n) => n.id as string));
  const degree = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const r of rels ?? []) {
    const s = r.source_entity_id as string;
    const t = r.target_entity_id as string;
    if (!nodeIds.has(s) || !nodeIds.has(t)) continue; // respect type filter
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
    edges.push({
      id: r.id as string,
      source: s,
      target: t,
      relationship_type: r.relationship_type as string,
      strength: r.strength === null ? null : Number(r.strength),
    });
  }
  const nodes: GraphNode[] = (ents ?? []).map((n) => ({
    id: n.id as string,
    name: n.name as string,
    entity_type: n.entity_type as EntityType,
    importance_score: Number(n.importance_score) || 0,
    degree: degree.get(n.id as string) ?? 0,
  }));
  return { nodes, edges };
}

// Everything connected to one node: neighbors, the mirrored contact, linked
// tasks and opportunities. This powers the click-a-node side panel (the Phase 6
// "done when" gate).
export async function getEntityDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<EntityDetail | null> {
  const { data: entity, error } = await supabase
    .from("entities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!entity) return null;

  const { data: rels } = await supabase
    .from("entity_relationships")
    .select("id, source_entity_id, target_entity_id, relationship_type, strength")
    .or(`source_entity_id.eq.${id},target_entity_id.eq.${id}`);

  const neighborIds = Array.from(
    new Set(
      (rels ?? []).map((r) =>
        (r.source_entity_id as string) === id
          ? (r.target_entity_id as string)
          : (r.source_entity_id as string),
      ),
    ),
  );
  const { data: neighborRows } = neighborIds.length
    ? await supabase
        .from("entities")
        .select("id, name, entity_type, importance_score")
        .in("id", neighborIds)
    : { data: [] as Array<Record<string, unknown>> };
  const byId = new Map((neighborRows ?? []).map((n) => [n.id as string, n]));

  const neighbors: EntityNeighbor[] = (rels ?? [])
    .map((r) => {
      const out = (r.source_entity_id as string) === id;
      const other = byId.get(out ? (r.target_entity_id as string) : (r.source_entity_id as string));
      if (!other) return null;
      return {
        relationship_id: r.id as string,
        relationship_type: r.relationship_type as string,
        strength: r.strength === null ? null : Number(r.strength),
        direction: out ? "out" : "in",
        entity: {
          id: other.id as string,
          name: other.name as string,
          entity_type: other.entity_type as EntityType,
          importance_score: Number(other.importance_score) || 0,
        },
      } satisfies EntityNeighbor;
    })
    .filter((n): n is EntityNeighbor => n !== null);

  // Contact mirror (person nodes).
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, company, role, email, last_contacted_at")
    .eq("entity_id", id)
    .limit(1)
    .maybeSingle();

  // Linked tasks/opportunities: via the contact for people, via
  // related_company_id for companies.
  let tasks: EntityDetail["tasks"] = [];
  let opportunities: EntityDetail["opportunities"] = [];
  if (contact) {
    const [t, o] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, due_date")
        .eq("related_contact_id", contact.id)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("opportunities")
        .select("id, title, status, estimated_value")
        .eq("related_contact_id", contact.id)
        .limit(20),
    ]);
    tasks = (t.data ?? []) as EntityDetail["tasks"];
    opportunities = (o.data ?? []) as EntityDetail["opportunities"];
  }
  if ((entity.entity_type as string) === "company") {
    const { data: companyOpps } = await supabase
      .from("opportunities")
      .select("id, title, status, estimated_value")
      .eq("related_company_id", id)
      .limit(20);
    const seen = new Set(opportunities.map((o) => o.id));
    for (const o of (companyOpps ?? []) as EntityDetail["opportunities"]) {
      if (!seen.has(o.id)) opportunities.push(o);
    }
  }

  return { entity: entity as EntityRow, neighbors, contact: contact ?? null, tasks, opportunities };
}

// ---- Importance recompute (nightly cron + after capture) -----------------------

// Recomputes importance_score for every entity (optionally scoped to one user —
// required when called with the service client, which bypasses RLS).
export async function recomputeImportance(
  supabase: SupabaseClient,
  userId?: string,
  now: Date = new Date(),
): Promise<number> {
  const entsQ = supabase.from("entities").select("id, importance_score, metadata");
  const relsQ = supabase
    .from("entity_relationships")
    .select("source_entity_id, target_entity_id");
  const oppsQ = supabase
    .from("opportunities")
    .select("estimated_value, related_company_id, related_contact_id");
  const contactsQ = supabase.from("contacts").select("id, entity_id");

  const [ents, rels, opps, contacts] = await Promise.all([
    userId ? entsQ.eq("user_id", userId) : entsQ,
    userId ? relsQ.eq("user_id", userId) : relsQ,
    userId ? oppsQ.eq("user_id", userId) : oppsQ,
    userId ? contactsQ.eq("user_id", userId) : contactsQ,
  ]);
  if (ents.error) throw ents.error;

  const degree = new Map<string, number>();
  for (const r of rels.data ?? []) {
    degree.set(r.source_entity_id, (degree.get(r.source_entity_id) ?? 0) + 1);
    degree.set(r.target_entity_id, (degree.get(r.target_entity_id) ?? 0) + 1);
  }

  const contactToEntity = new Map<string, string>();
  for (const c of contacts.data ?? []) {
    if (c.entity_id) contactToEntity.set(c.id as string, c.entity_id as string);
  }
  const oppValue = new Map<string, number>();
  const add = (entityId: string | undefined, v: number) => {
    if (!entityId || v <= 0) return;
    oppValue.set(entityId, (oppValue.get(entityId) ?? 0) + v);
  };
  for (const o of opps.data ?? []) {
    const v = Number(o.estimated_value) || 0;
    add(o.related_company_id as string | undefined, v);
    add(contactToEntity.get(o.related_contact_id as string), v);
  }

  const maxDegree = Math.max(0, ...degree.values());
  const maxOpp = Math.max(0, ...oppValue.values());

  let updated = 0;
  for (const e of ents.data ?? []) {
    const meta = (e.metadata ?? {}) as { mention_count?: number; last_mentioned_at?: string };
    const score = importanceScore({
      degree: degree.get(e.id as string) ?? 0,
      maxDegree,
      linkedOpportunityValue: oppValue.get(e.id as string) ?? 0,
      maxLinkedOpportunityValue: maxOpp,
      mentionCount: meta.mention_count ?? 0,
      lastMentionedAt: meta.last_mentioned_at ?? null,
      now,
    });
    if (Math.abs(score - (Number(e.importance_score) || 0)) >= 0.01) {
      const { error } = await supabase
        .from("entities")
        .update({ importance_score: score })
        .eq("id", e.id);
      if (!error) updated++;
    }
  }
  return updated;
}

// Distinct user_ids that own entities — used by the nightly cron (service role).
export async function listUsersWithEntities(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("entities").select("user_id");
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
}
