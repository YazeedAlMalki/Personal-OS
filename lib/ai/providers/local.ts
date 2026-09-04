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

// Local, zero-cost provider via Ollama (OpenAI-compatible local server also works
// by pointing OLLAMA_BASE_URL at it). Default for the cost-sensitive build.
export function localProvider(): AIProvider {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.LOCAL_CHAT_MODEL ?? "llama3.1:8b";
  const embedModel = process.env.LOCAL_EMBED_MODEL ?? "nomic-embed-text";

  return {
    name: `local:${model}`,

    async classify(text: string): Promise<Classified> {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          format: "json",
          stream: false,
          messages: [
            { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama chat ${res.status}`);
      const json = (await res.json()) as { message?: { content?: string } };
      const parsed = JSON.parse(json.message?.content ?? "{}") as Record<string, unknown>;
      return ClassifiedSchema.parse({
        kind: parsed.kind,
        title: typeof parsed.title === "string" && parsed.title ? parsed.title : text.slice(0, 120),
        urgency: parsed.urgency,
        priority: parsed.priority,
        due_date: parsed.due_date ?? null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      });
    },

    async extractEntities(text: string): Promise<ExtractedEntity[]> {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          format: "json",
          stream: false,
          messages: [
            { role: "system", content: EXTRACT_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama chat ${res.status}`);
      const json = (await res.json()) as { message?: { content?: string } };
      return parseExtraction(JSON.parse(json.message?.content ?? "{}"));
    },

    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (const prompt of texts) {
        const res = await fetch(`${base}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: embedModel, prompt }),
        });
        if (!res.ok) throw new Error(`ollama embed ${res.status}`);
        const j = (await res.json()) as { embedding?: number[] };
        out.push(j.embedding ?? []);
      }
      return out;
    },

    async answer(question: string, context: string): Promise<string> {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "system", content: ASK_SYSTEM_PROMPT },
            { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`ollama chat ${res.status}`);
      const json = (await res.json()) as { message?: { content?: string } };
      const text = json.message?.content?.trim();
      if (!text) throw new Error("empty answer");
      return text;
    },

    async health() {
      try {
        const r = await fetch(`${base}/api/tags`);
        return { ok: r.ok, model };
      } catch {
        return { ok: false, model };
      }
    },
  };
}
