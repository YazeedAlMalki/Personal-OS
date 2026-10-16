import { regexClassify } from "@/lib/ai/regex";
import { ClassifiedSchema, KINDS, type Classified, type Kind } from "@/lib/ai/types";

// Laya (Convai Innovations, Apache 2.0): a non-generative decision model served by
// `laya-serve` on the homelab, reached through homelab/ai_gateway.py. It picks from
// fixed options with calibrated probabilities but writes no text, so it decides
// kind/urgency/priority and regex supplies title + due_date. Opt-in: AI_CLASSIFIER=laya.

const KIND_CRITERIA: Record<Kind, string> = {
  task: "Something the user needs to do: an action, errand, reminder or to-do",
  note: "Neutral information to keep, with no action, feeling or decision",
  journal: "A personal reflection on the user's day, mood, feelings or sleep",
  idea: "A new idea, concept or what-if to explore later",
  opportunity: "A potential deal, client, lead, job or business opening",
  risk: "Something that could go wrong: a threat, exposure or possible loss",
  decision: "A choice the user has made or committed to",
  contact: "Details about a person: who they are or how to reach them",
  learning: "Something to read, study, practice or learn",
  health: "Exercise, food, weight, symptoms, medication or other health data",
  finance: "Money: spending, income, bills, budget, investments or prices",
};

// Score levels are ordinal, lowest first; Laya returns the expected level index.
const URGENCY_LEVELS: Classified["urgency"][] = ["someday", "this_month", "this_week", "today"];
const URGENCY_CRITERIA = [
  "No time pressure; someday or eventually",
  "Should happen within the next month",
  "Should happen within the next few days",
  "Must happen today or right now",
];
const PRIORITY_LEVELS: Classified["priority"][] = ["low", "medium", "high", "urgent"];
const PRIORITY_CRITERIA = [
  "Low importance; fine if it never happens",
  "Normal importance",
  "Important; real cost if it slips",
  "Critical; drop everything",
];

const TIMEOUT_MS = 10_000; // Laya answers in well under a second; anything slower is a dead link.

type Answer = { choice?: unknown; score?: unknown; confidence?: unknown; probabilities?: unknown };

function level<T>(levels: T[], a: Answer | undefined): T {
  if (typeof a?.score !== "number" || !Number.isFinite(a.score)) throw new Error("laya: missing score");
  return levels[Math.min(levels.length - 1, Math.max(0, Math.round(a.score)))]!;
}

function kindConfidence(a: Answer): number {
  if (typeof a.confidence === "number") return a.confidence;
  const p = (a.probabilities as Record<string, unknown> | undefined)?.[a.choice as string];
  if (typeof p === "number") return p;
  throw new Error("laya: missing confidence");
}

export async function layaClassify(text: string, now: Date = new Date()): Promise<Classified> {
  const base = (process.env.LAYA_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.LOCAL_AI_TOKEN) headers.authorization = `Bearer ${process.env.LOCAL_AI_TOKEN}`;

  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      ...(process.env.LAYA_MODEL ? { model: process.env.LAYA_MODEL } : {}),
      state: { capture: text },
      questions: {
        kind: { type: "choice", instructions: "What kind of personal note is this capture?", criteria: KIND_CRITERIA },
        urgency: { type: "score", instructions: "How soon does this need attention?", criteria: URGENCY_CRITERIA },
        priority: { type: "score", instructions: "How important is this?", criteria: PRIORITY_CRITERIA },
      },
    }),
  });
  if (!res.ok) throw new Error(`laya ${res.status}`);
  const body = (await res.json()) as { answers?: Record<string, Answer> } & Record<string, Answer>;
  const answers = body.answers ?? body;
  const kind = answers.kind;
  if (!kind || !(KINDS as readonly unknown[]).includes(kind.choice)) throw new Error("laya: bad kind");

  const fallback = regexClassify(text, now);
  return ClassifiedSchema.parse({
    kind: kind.choice,
    title: fallback.title,
    urgency: level(URGENCY_LEVELS, answers.urgency),
    priority: level(PRIORITY_LEVELS, answers.priority),
    due_date: fallback.due_date,
    confidence: kindConfidence(kind),
  });
}
