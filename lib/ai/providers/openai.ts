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

// OpenAI adapter via REST (no SDK dependency). Used when AI_PROVIDER=openai/hybrid.
export function openaiProvider(): AIProvider {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  const embedModel = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";

  function requireKey(): string {
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    return key;
  }

  return {
    name: `openai:${model}`,

    async classify(text: string): Promise<Classified> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireKey()}` },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai chat ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return ClassifiedSchema.parse({
        kind: parsed.kind,
        title: typeof parsed.title === "string" && parsed.title ? parsed.title : text.slice(0, 120),
        urgency: parsed.urgency,
        priority: parsed.priority,
        due_date: parsed.due_date ?? null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      });
    },

    async extractEntities(text: string): Promise<ExtractedEntity[]> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireKey()}` },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: EXTRACT_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai chat ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return parseExtraction(JSON.parse(json.choices?.[0]?.message?.content ?? "{}"));
    },

    async embed(texts: string[]): Promise<number[][]> {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireKey()}` },
        body: JSON.stringify({ model: embedModel, input: texts }),
      });
      if (!res.ok) throw new Error(`openai embed ${res.status}`);
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      return (json.data ?? []).map((d) => d.embedding);
    },

    async answer(question: string, context: string): Promise<string> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireKey()}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: ASK_SYSTEM_PROMPT },
            { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai chat ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("empty answer");
      return text;
    },

    async health() {
      try {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { authorization: `Bearer ${requireKey()}` },
        });
        return { ok: r.ok, model };
      } catch {
        return { ok: false, model };
      }
    },
  };
}
