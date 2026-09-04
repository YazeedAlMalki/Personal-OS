import { z } from "zod";

// The AI gateway contract. Domain/intelligence code NEVER imports a vendor SDK —
// it goes through an AIProvider. Adapters: local (Ollama), openai, anthropic.

export const KINDS = [
  "task",
  "note",
  "journal",
  "idea",
  "opportunity",
  "risk",
  "decision",
  "contact",
  "learning",
  "health",
  "finance",
] as const;
export type Kind = (typeof KINDS)[number];

// Every LLM classification is validated against this before it can touch the DB (P1).
export const ClassifiedSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1).max(300),
  urgency: z.enum(["today", "this_week", "this_month", "someday"]).default("this_week"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  due_date: z.string().date().nullish(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Classified = z.infer<typeof ClassifiedSchema>;

// ---- Phase 6: entity extraction -------------------------------------------

export const ENTITY_TYPES = [
  "person",
  "company",
  "project",
  "organization",
  "tool",
  "location",
  "event",
  "asset",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// Every extracted entity is validated against this before it can touch the DB (P1).
// A malformed/hostile model response can't inject a bad graph node.
export const ExtractedEntitySchema = z.object({
  name: z.string().min(1).max(120),
  entity_type: z.enum(ENTITY_TYPES),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const ExtractionSchema = z.object({
  entities: z.array(ExtractedEntitySchema).max(20).default([]),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface AIProvider {
  readonly name: string;
  classify(text: string): Promise<Classified>;
  extractEntities(text: string): Promise<ExtractedEntity[]>;
  embed(texts: string[]): Promise<number[][]>;
  // RAG answer over retrieved memory (§10 /api/ask). Plain text out.
  answer(question: string, context: string): Promise<string>;
  health(): Promise<{ ok: boolean; model: string }>;
}

export const ASK_SYSTEM_PROMPT = `You answer questions about the user's own personal data (tasks, notes, journal, health, contacts, decisions).
You are given CONTEXT: excerpts retrieved from their private memory store.
Rules:
- Answer from the context. If the context doesn't contain the answer, say so plainly.
- Be concise and specific; quote dates/names from the context where useful.
- Never invent records that aren't in the context.`;

export const CLASSIFY_SYSTEM_PROMPT = `You are a strict classifier for a personal operating system.
Given a short note, output ONLY JSON with these fields:
- kind: one of ${KINDS.join(", ")}
- title: a concise title (<= 120 chars)
- urgency: one of today, this_week, this_month, someday
- priority: one of low, medium, high, urgent
- due_date: an ISO date (YYYY-MM-DD) if one is clearly implied, else null
- confidence: 0..1, how sure you are of the classification
Output JSON only. No prose.`;

export const EXTRACT_SYSTEM_PROMPT = `You extract named entities from a short personal note.
Output ONLY JSON: {"entities":[{"name":"...","entity_type":"...","confidence":0..1}]}
Rules:
- entity_type must be one of: ${ENTITY_TYPES.join(", ")}
- Only real named things (people, companies, projects, organizations, tools, locations, events, assets).
- Use the canonical short name ("Acme", not "the Acme deal").
- NEVER include generic words (tomorrow, meeting, email), pronouns, or the note's author.
- confidence reflects how sure you are this is a real named entity of that type.
- If there are no entities, output {"entities":[]}.
Output JSON only. No prose.`;

// Shared post-parse for provider extract() implementations: validate, dedupe by
// case-insensitive name, drop empties. Never trusts the model (P1).
export function parseExtraction(raw: unknown): ExtractedEntity[] {
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: ExtractedEntity[] = [];
  for (const e of parsed.data.entities) {
    const key = e.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, name: e.name.trim() });
  }
  return out;
}
