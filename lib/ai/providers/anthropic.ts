import {
  ASK_SYSTEM_PROMPT,
  CLASSIFY_SYSTEM_PROMPT,
  ClassifiedSchema,
  EXTRACT_SYSTEM_PROMPT,
  parseExtraction,
  type AIProvider,
  type Classified,
  type ExtractedEntity,
} from "@/lib/ai/types";

// Anthropic adapter via REST. Best classification quality. Note: Anthropic has no
// embeddings endpoint — embed() throws so the gateway routes embeddings to local/openai.
export function anthropicProvider(): AIProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

  function requireKey(): string {
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    return key;
  }

  return {
    name: `anthropic:${model}`,

    async classify(text: string): Promise<Classified> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": requireKey(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: CLASSIFY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: { text?: string }[] };
      const raw = json.content?.[0]?.text ?? "{}";
      const match = raw.match(/\{[\s\S]*\}/); // tolerate prose around the JSON
      const parsed = JSON.parse(match ? match[0] : "{}") as Record<string, unknown>;
      return ClassifiedSchema.parse({
        kind: parsed.kind,
        title: typeof parsed.title === "string" && parsed.title ? parsed.title : text.slice(0, 120),
        urgency: parsed.urgency,
        priority: parsed.priority,
        due_date: parsed.due_date ?? null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
      });
    },

    async extractEntities(text: string): Promise<ExtractedEntity[]> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": requireKey(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: EXTRACT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: { text?: string }[] };
      const raw = json.content?.[0]?.text ?? "{}";
      const match = raw.match(/\{[\s\S]*\}/); // tolerate prose around the JSON
      return parseExtraction(JSON.parse(match ? match[0] : "{}"));
    },

    async answer(question: string, context: string): Promise<string> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": requireKey(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: ASK_SYSTEM_PROMPT,
          messages: [{ role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: { text?: string }[] };
      const text = json.content?.[0]?.text?.trim();
      if (!text) throw new Error("empty answer");
      return text;
    },

    async embed(): Promise<number[][]> {
      throw new Error("Anthropic has no embeddings API — set AI_PROVIDER=hybrid to use local/openai embeddings");
    },

    async health() {
      return { ok: Boolean(key), model };
    },
  };
}
