import { localProvider } from "@/lib/ai/providers/local";
import { openaiProvider } from "@/lib/ai/providers/openai";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import { regexClassify, regexExtractEntities } from "@/lib/ai/regex";
import type { AIProvider, Classified, ExtractedEntity } from "@/lib/ai/types";

export * from "@/lib/ai/types";

// hybrid: best classification (Anthropic) + free local embeddings.
function hybridProvider(): AIProvider {
  const chat = anthropicProvider();
  const vec = localProvider();
  return {
    name: `hybrid(${chat.name}+${vec.name})`,
    classify: (t) => chat.classify(t),
    extractEntities: (t) => chat.extractEntities(t),
    answer: (q, c) => chat.answer(q, c),
    embed: (t) => vec.embed(t),
    health: async () => {
      const a = await chat.health();
      return { ok: a.ok, model: `${chat.name}/${vec.name}` };
    },
  };
}

export function getProvider(): AIProvider {
  switch ((process.env.AI_PROVIDER ?? "local").toLowerCase()) {
    case "openai":
      return openaiProvider();
    case "anthropic":
      return anthropicProvider();
    case "hybrid":
      return hybridProvider();
    default:
      return localProvider();
  }
}

// Classify with graceful degradation: configured provider → deterministic regex.
// Never throws — a dead/missing model degrades to "review queue", not a crash (P1).
export async function classifyWithFallback(
  text: string,
): Promise<{ result: Classified; via: string }> {
  try {
    const p = getProvider();
    return { result: await p.classify(text), via: p.name };
  } catch {
    return { result: regexClassify(text), via: "regex" };
  }
}

// Entity extraction with graceful degradation: configured provider → deterministic
// regex heuristics. Never throws — graph enrichment is best-effort by design;
// a dead model degrades to "fewer/lower-confidence entities", never a failed capture.
export async function extractEntitiesWithFallback(
  text: string,
): Promise<{ entities: ExtractedEntity[]; via: string }> {
  try {
    const p = getProvider();
    return { entities: await p.extractEntities(text), via: p.name };
  } catch {
    return { entities: regexExtractEntities(text), via: "regex" };
  }
}

export async function embedSafe(texts: string[]): Promise<number[][] | null> {
  try {
    return await getProvider().embed(texts);
  } catch {
    return null;
  }
}
