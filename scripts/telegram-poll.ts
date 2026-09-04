#!/usr/bin/env npx tsx
// Personal OS V2 — Telegram bot (long-polling mode for self-host).
// Run alongside `npm run dev`:   npm run telegram
//
// Persona: Alfred Pennyworth — the loyal, dry-witted butler. All user-facing
// copy is in his voice (addresses the user as "sir" / "Master Yazeed").
//
// Features:
//   - Text capture → classify → Eisenhower scoring → create record or review queue
//   - Photos/documents/voice → capture pipeline (raw preserved)
//   - Capture reply shows quadrant + confidence + reason
//   - Inline keyboard: override quadrant (Do Now / Schedule / Delegate / Drop), review, undo
//   - Quadrant overrides logged to quadrant_corrections (training signal)
//   - /start welcome, /status dashboard, /matrix snapshot, /review queue,
//     /correct last, /briefing on-demand
//   - Sender-gated (only your Telegram account)

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Alfred is the interface; the OS core owns the logic. Capture now runs through
// the canonical `runCapturePipeline` (the same path the web Command Center and
// the Telegram webhook use). The imports below are only for *displaying* results
// the pipeline already computed (priority label, quadrant labels, due hints).
import { urgencyToPriority, type Quadrant } from "@/lib/eisenhower";
import { calendarDaysUntil } from "@/lib/scoring/util";
import { runCapturePipeline, type CaptureResult } from "@/lib/ingestion/pipeline";
import { searchMemory } from "@/lib/memory";
import { getProvider } from "@/lib/ai";

// ---- Config -----------------------------------------------------------------

const API = "https://api.telegram.org/bot";
const token = process.env.TELEGRAM_BOT_TOKEN!;
const allowedUserId = process.env.TELEGRAM_USER_ID!;

if (!token || token === "PASTE_BOT_TOKEN_HERE") {
  console.error("Set TELEGRAM_BOT_TOKEN in .env.local first.");
  process.exit(1);
}
if (!allowedUserId || allowedUserId === "PASTE_YOUR_CHAT_ID_HERE") {
  console.error("Set TELEGRAM_USER_ID in .env.local first.");
  process.exit(1);
}

function sb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ---- Telegram API helpers ---------------------------------------------------

async function tg(method: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function send(chatId: number, text: string, opts?: {
  reply_to?: number;
  inline_keyboard?: unknown[][];
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (opts?.reply_to) body.reply_to_message_id = opts.reply_to;
  if (opts?.inline_keyboard) body.reply_markup = { inline_keyboard: opts.inline_keyboard };
  return tg("sendMessage", body);
}

async function editMessage(chatId: number, messageId: number, text: string, keyboard?: unknown[][]): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  await tg("editMessageText", body);
}

async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: callbackId, text });
}

// ---- User resolution --------------------------------------------------------

let cachedUid: string | null = null;

async function getUid(): Promise<string> {
  if (cachedUid) return cachedUid;
  const s = sb();
  const { data: profile } = await s.from("profiles").select("id").limit(1).single();
  if (profile?.id) { cachedUid = profile.id as string; return cachedUid; }
  const { data: { users } } = await s.auth.admin.listUsers({ page: 1, perPage: 1 });
  cachedUid = users?.[0]?.id ?? null;
  if (!cachedUid) throw new Error("No user — sign up at /signup first.");
  return cachedUid;
}

// ---- Quadrant display helpers ----------------------------------------------

const QUADRANT_META: Record<Quadrant, { emoji: string; label: string }> = {
  do_now: { emoji: "🔴", label: "DO NOW" },
  schedule: { emoji: "📅", label: "SCHEDULE" },
  delegate: { emoji: "👋", label: "DELEGATE" },
  drop: { emoji: "🗑", label: "DROP" },
};

const QUADRANT_ORDER: Quadrant[] = ["do_now", "schedule", "delegate", "drop"];

function isQuadrant(q: string): q is Quadrant {
  return q === "do_now" || q === "schedule" || q === "delegate" || q === "drop";
}

// One button per quadrant; optionally omit the task's current quadrant.
function quadrantButtonsRow(recordId: string, exclude?: Quadrant | null): Array<{ text: string; callback_data: string }> {
  return QUADRANT_ORDER
    .filter((q) => q !== exclude)
    .map((q) => ({ text: `${QUADRANT_META[q].emoji} ${quadrantShort(q)}`, callback_data: `quad:${q}:${recordId}` }));
}

function quadrantShort(q: Quadrant): string {
  return q === "do_now" ? "Do Now" : q === "schedule" ? "Schedule" : q === "delegate" ? "Delegate" : "Drop";
}

// Short human hint about a due date for matrix/correction listings.
function dueHint(due: string | null | undefined, now: Date = new Date()): string {
  const d = calendarDaysUntil(due, now);
  if (d === null) return "";
  if (d < 0) return `overdue ${Math.abs(d)}d`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d}d`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Command registry -------------------------------------------------------
// Every bot command is registered here. main() dispatches through this array;
// setMyCommands and /help both derive from it automatically — no separate list.

interface OSCommand {
  command: string;     // without the leading /
  description: string; // shown in Telegram's command picker
  handle: (chatId: number, args: string, msgId: number) => Promise<void>;
}

// ---- Health log parser ------------------------------------------------------

interface HealthLogEntry {
  sleep_minutes?: number;
  steps?: number;
  weight?: number;               // kg — column is "weight" in health_daily
  resting_heart_rate?: number;
  notes?: string;
}

function parseHealthArgs(raw: string): HealthLogEntry {
  const entry: HealthLogEntry = {};
  const s = raw.toLowerCase();

  // sleep: "7.5h", "7h30m", "8 hours", "7h sleep"
  const sleepM = s.match(/(\d+(?:\.\d+)?)\s*h(?:r|rs|ours?)?\s*(?:(\d+)\s*m(?:in)?)?/);
  if (sleepM) {
    entry.sleep_minutes = Math.round(
      parseFloat(sleepM[1]!) * 60 + (sleepM[2] ? parseInt(sleepM[2]) : 0),
    );
  }

  // steps: "8000steps", "8k steps", "10,000 steps"
  const stepsM = s.match(/(\d[\d,]*)([km])?\s*steps?|steps?\s*[=:]?\s*(\d[\d,]*)([km])?/);
  if (stepsM) {
    const num = (stepsM[1] ?? stepsM[3] ?? "0").replace(/,/g, "");
    const mult = (stepsM[2] === "k" || stepsM[4] === "k") ? 1000 : (stepsM[2] === "m" || stepsM[4] === "m") ? 1_000_000 : 1;
    entry.steps = Math.round(parseFloat(num) * mult);
  }

  // weight: "72.5kg", "160lbs" (→ kg), "weight=72"
  const wKg = s.match(/(\d+(?:\.\d+)?)\s*kg|weight\s*[=:]?\s*(\d+(?:\.\d+)?)/);
  const wLbs = s.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/);
  if (wKg) {
    entry.weight = parseFloat(wKg[1] ?? wKg[2] ?? "0");
  } else if (wLbs) {
    entry.weight = Math.round(parseFloat(wLbs[1]!) * 0.453592 * 10) / 10;
  }

  // heart rate: "65bpm", "rhr 65", "hr=72"
  const hrM = s.match(/(?:rhr|resting\s+hr?|heart\s+rate)\s*[=:]?\s*(\d+)|(\d+)\s*bpm/);
  if (hrM) entry.resting_heart_rate = parseInt(hrM[1] ?? hrM[2] ?? "0");

  // fallback: store the whole thing as a note
  if (!Object.keys(entry).length && raw.trim()) entry.notes = raw.trim();

  return entry;
}

// ---- Capture pipeline -------------------------------------------------------

const KIND_EMOJI: Record<string, string> = {
  task: "✅", opportunity: "💰", risk: "⚠️", decision: "🤔",
  contact: "👤", learning: "📚", idea: "💡", journal: "📓",
  note: "📝", health: "❤️", finance: "💵",
};

// Alfred delegates the entire capture to the OS core — the same
// `runCapturePipeline` the web Command Center and the Telegram webhook use:
// persist raw -> classify via the AI gateway (provider -> regex fallback) ->
// confidence-gate -> route -> Eisenhower score -> graph-link -> memory-embed ->
// audit. This script no longer classifies, routes, or writes records itself; it
// passes a service-role client + the resolved user id, exactly like the webhook.
async function capture(text: string, source: string): Promise<CaptureResult> {
  return runCapturePipeline({ text, source, supabase: sb(), userId: await getUid() });
}

// ---- Reply formatting -------------------------------------------------------

function formatCaptureReply(r: CaptureResult): { text: string; keyboard: unknown[][] } {
  // Error first: the canonical error result carries no `classified`.
  if (r.status === "error") {
    return { text: `❌ My apologies, sir — something went awry: ${r.error}`, keyboard: [] };
  }

  const c = r.classified;
  const emoji = KIND_EMOJI[c.kind] ?? "📝";

  if (r.status === "review") {
    const lines = [
      `🔍 Set aside for your <b>review</b>, sir.`,
      ``,
      `<b>${c.title}</b>`,
      `My best guess: ${c.kind} (${Math.round(c.confidence * 100)}% confidence)`,
      ``,
      `I confess some uncertainty — do glance at the review queue when it suits you.`,
    ];
    return { text: lines.join("\n"), keyboard: [] };
  }

  // r.status === "created"
  const lines = [
    `${emoji} <b>${cap(c.kind)}</b> filed, sir.`,
    ``,
    `<b>${c.title}</b>`,
  ];
  if (c.due_date) lines.push(`📅 Due: ${c.due_date}`);

  // Tasks show the Eisenhower quadrant + reason and offer override buttons.
  if (r.table === "tasks" && r.scored) {
    const qm = QUADRANT_META[r.scored.quadrant];
    lines.push(`🔺 Priority: ${urgencyToPriority(r.scored.urgency)}`);
    lines.push(`📊 ${qm.emoji} <b>${qm.label}</b> (${Math.round(r.scored.confidence * 100)}% confidence)`);
    lines.push(`💡 ${r.scored.reason}`);
    const keyboard = [
      quadrantButtonsRow(r.id),
      [
        { text: "🔄 Review", callback_data: `review:${r.rawId}:${r.table}:${r.id}` },
        { text: "↩️ Undo", callback_data: `undo:${r.table}:${r.id}:${r.rawId}` },
      ],
    ];
    return { text: lines.join("\n"), keyboard };
  }

  // Non-task records keep the urgency quick-set buttons.
  if (c.priority !== "medium") lines.push(`🔺 Priority: ${c.priority}`);
  lines.push(`📊 Confidence: ${Math.round(c.confidence * 100)}%`);
  const keyboard = [
    [
      { text: "🔴 Today", callback_data: `urg:today:${r.table}:${r.id}` },
      { text: "🟡 This week", callback_data: `urg:this_week:${r.table}:${r.id}` },
      { text: "⚪ Someday", callback_data: `urg:someday:${r.table}:${r.id}` },
    ],
    [
      { text: "🔄 Send to review", callback_data: `review:${r.rawId}:${r.table}:${r.id}` },
      { text: "🗑 Undo", callback_data: `undo:${r.table}:${r.id}:${r.rawId}` },
    ],
  ];
  return { text: lines.join("\n"), keyboard };
}

// ---- Bot commands -----------------------------------------------------------

async function handleStart(chatId: number): Promise<void> {
  await send(chatId, [
    `🤵 <b>Alfred, at your service</b>`,
    ``,
    `Good day, Master Yazeed. Send me anything — a task, idea, opportunity, risk, decision — and consider it duly catalogued. The buttons let you override quadrant, mark done, or undo.`,
    ``,
    `<b>Task management:</b>`,
    `/done — open tasks with ✅ Done · 😴 Snooze · 💨 Drop`,
    `/focus — what to work on right now`,
    `/week — overdue + due this week`,
    `/matrix — full Eisenhower matrix`,
    `/correct last — re-classify most recent task`,
    ``,
    `<b>Intelligence:</b>`,
    `/status — dashboard snapshot`,
    `/briefing — Chief of Staff dispatch`,
    `/insights — latest CoS alerts &amp; forecasts`,
    `/ask — search your memory (RAG Q&amp;A)`,
    ``,
    `<b>Modules:</b>`,
    `/goals — active goals + progress`,
    `/pipeline — open opportunities + expected value`,
    `/risks — open risks by severity`,
    `/health — log or view today's health data`,
    `/win — record a victory in your journal`,
    ``,
    `<b>Review:</b>`,
    `/review — items awaiting your judgement`,
    ``,
    `<b>Examples, if I may:</b>`,
    `• "Call Sam tomorrow" → task, due tomorrow`,
    `• "Risk: AWS bill growing" → logged as risk`,
    `• <code>/ask What did I decide about the Acme deal?</code>`,
    `• <code>/health 7.5h 8000steps 72kg</code>`,
    `• <code>/win Closed Series A term sheet</code>`,
  ].join("\n"));
}

async function handleStatus(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();

  const [tasks, reviews, insights, goals] = await Promise.all([
    s.from("tasks").select("id,status,priority", { count: "exact" }).eq("user_id", uid).neq("status", "done"),
    s.from("review_queue").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "open"),
    s.from("ai_insights").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "new"),
    s.from("goals").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "active"),
  ]);

  const openTasks = tasks.count ?? 0;
  const urgentTasks = (tasks.data ?? []).filter(t => t.priority === "urgent").length;
  const highTasks = (tasks.data ?? []).filter(t => t.priority === "high").length;
  const pendingReviews = reviews.count ?? 0;
  const newInsights = insights.count ?? 0;
  const activeGoals = goals.count ?? 0;

  const lines = [
    `📊 <b>The state of affairs</b>`,
    ``,
    `📋 <b>${openTasks}</b> open tasks`,
  ];
  if (urgentTasks > 0) lines.push(`   🔴 ${urgentTasks} urgent`);
  if (highTasks > 0) lines.push(`   🟠 ${highTasks} high priority`);
  lines.push(`🎯 <b>${activeGoals}</b> active goals`);
  if (pendingReviews > 0) lines.push(`🔍 <b>${pendingReviews}</b> items need review`);
  if (newInsights > 0) lines.push(`💡 <b>${newInsights}</b> new insights`);
  if (pendingReviews === 0 && newInsights === 0) lines.push(`✅ Nothing pending, sir. All is in order.`);

  await send(chatId, lines.join("\n"));
}

async function handleReview(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();

  const [queueRes, lowConfRes] = await Promise.all([
    s.from("review_queue")
      .select("id,proposed_table,proposed_record,confidence,created_at")
      .eq("user_id", uid).eq("status", "open")
      .order("created_at", { ascending: false }).limit(5),
    // Low-confidence quadrant assignments Alfred made but the user hasn't ruled on.
    s.from("tasks")
      .select("id,title,quadrant,user_corrected_quadrant,quadrant_confidence,due_date")
      .eq("user_id", uid)
      .not("status", "in", '("done","dropped")')
      .not("quadrant", "is", null)
      .is("user_corrected_quadrant", null)
      .lt("quadrant_confidence", 0.65)
      .order("created_at", { ascending: false }).limit(5),
  ]);

  const queue = queueRes.data ?? [];
  const lowConf = (lowConfRes.data ?? []) as Array<{
    id: string; title: string; quadrant: Quadrant;
    quadrant_confidence: number | null; due_date: string | null;
  }>;

  if (queue.length === 0 && lowConf.length === 0) {
    await send(chatId, "✅ Nothing requires your attention, sir — the queue is clear and every quadrant sits confidently.");
    return;
  }

  // 1. Classification review queue (existing behaviour).
  if (queue.length > 0) {
    const lines = [`🔍 <b>Awaiting your review</b> (${queue.length} item${queue.length > 1 ? "s" : ""})`, ``];
    for (const item of queue) {
      const record = item.proposed_record as Record<string, unknown>;
      const title = (record.title ?? record.summary ?? record.raw_text ?? "Untitled") as string;
      const conf = typeof item.confidence === "number" ? `${Math.round(item.confidence * 100)}%` : "?";
      lines.push(`• <b>${title.slice(0, 60)}</b>`);
      lines.push(`  → ${item.proposed_table} · ${conf} confidence`);
    }
    lines.push(``);
    lines.push(`The dashboard awaits your verdict, sir.`);
    await send(chatId, lines.join("\n"));
  }

  // 2. Low-confidence quadrant assignments — each correctable inline.
  if (lowConf.length > 0) {
    await send(chatId, `⚠️ <b>${lowConf.length} classification${lowConf.length > 1 ? "s" : ""} I'm unsure of</b>, sir — confirm my judgement, or set me right:`);
    for (const t of lowConf) {
      const qm = QUADRANT_META[t.quadrant];
      const conf = typeof t.quadrant_confidence === "number" ? `${Math.round(t.quadrant_confidence * 100)}%` : "?";
      const hint = dueHint(t.due_date);
      const line = `${qm.emoji} <b>${t.title.slice(0, 60)}</b> → ${qm.label} (${conf})${hint ? ` · ${hint}` : ""}`;
      await send(chatId, line, {
        inline_keyboard: [[
          { text: "✅ Keep", callback_data: `keep:${t.id}` },
          ...quadrantButtonsRow(t.id, t.quadrant),
        ]],
      });
    }
  }
}

async function handleMatrix(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("tasks")
    .select("id,title,due_date,quadrant,user_corrected_quadrant,quadrant_confidence")
    .eq("user_id", uid)
    .not("status", "in", '("done","dropped")');

  const tasks = (data ?? []) as Array<{
    id: string; title: string; due_date: string | null;
    quadrant: Quadrant | null; user_corrected_quadrant: Quadrant | null; quadrant_confidence: number | null;
  }>;

  if (tasks.length === 0) {
    await send(chatId, "📊 <b>Your Eisenhower Matrix</b>\n\nNot a single open task, sir. Might I suggest you enjoy the respite?");
    return;
  }

  // Group by effective quadrant (a user override always wins over Alfred's score).
  const groups: Record<Quadrant, typeof tasks> = { do_now: [], schedule: [], delegate: [], drop: [] };
  let unclassified = 0;
  let lowConf = 0;
  for (const t of tasks) {
    const eff = (t.user_corrected_quadrant ?? t.quadrant) as Quadrant | null;
    if (!eff) { unclassified++; continue; }
    groups[eff].push(t);
    if (!t.user_corrected_quadrant && typeof t.quadrant_confidence === "number" && t.quadrant_confidence < 0.65) {
      lowConf++;
    }
  }

  const lines = [`📊 <b>Your Eisenhower Matrix</b>`, ``];
  for (const q of QUADRANT_ORDER) {
    const items = groups[q];
    if (items.length === 0) continue;
    const qm = QUADRANT_META[q];
    lines.push(`${qm.emoji} <b>${qm.label}</b> (${items.length})`);
    for (const t of items.slice(0, 3)) {
      const hint = dueHint(t.due_date);
      lines.push(`• ${t.title.slice(0, 50)}${hint ? ` — ${hint}` : ""}`);
    }
    if (items.length > 3) lines.push(`• + ${items.length - 3} more`);
    lines.push(``);
  }

  if (unclassified > 0) lines.push(`❔ ${unclassified} not yet classified, sir — I lack the signal`);
  if (lowConf > 0) lines.push(`⚠️ ${lowConf} of uncertain placement (low confidence) — worth your eye`);

  const showReviewBtn = lowConf > 0 || unclassified > 0;
  await send(chatId, lines.join("\n").trimEnd(),
    showReviewBtn ? { inline_keyboard: [[{ text: "🔍 Review the uncertain", callback_data: "matrix:review" }]] } : undefined,
  );
}

async function handleCorrectLast(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data: task } = await s
    .from("tasks")
    .select("id,title,quadrant,user_corrected_quadrant,quadrant_confidence")
    .eq("user_id", uid)
    .not("status", "in", '("done","dropped")')
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  if (!task) {
    await send(chatId, "I've nothing recent to amend, sir. Send me something first, then call <code>/correct last</code>.");
    return;
  }

  const eff = (task.user_corrected_quadrant ?? task.quadrant ?? null) as Quadrant | null;
  const conf = typeof task.quadrant_confidence === "number" ? `${Math.round(task.quadrant_confidence * 100)}%` : "?";
  const lines = [`<b>Your most recent matter:</b> ${(task.title as string).slice(0, 80)}`];
  if (eff) {
    const qm = QUADRANT_META[eff];
    lines.push(`I placed it in: ${qm.emoji} <b>${qm.label}</b> (${conf})`);
  } else {
    lines.push(`Not yet classified, sir.`);
  }
  lines.push(``);
  lines.push(`Where would you have it, sir?`);

  await send(chatId, lines.join("\n"), {
    inline_keyboard: [quadrantButtonsRow(task.id as string, eff)],
  });
}

async function handleBriefing(chatId: number): Promise<void> {
  // Trigger the briefing cron endpoint if CRON_SECRET is set.
  const cronSecret = process.env.CRON_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (!cronSecret || cronSecret === "PASTE_RANDOM_SECRET_HERE") {
    await send(chatId, "I shall need CRON_SECRET set in .env.local before I can summon your briefing, sir.");
    return;
  }

  await send(chatId, "⏳ A moment, sir — rousing your Chief of Staff…");

  try {
    const res = await fetch(`${baseUrl}/api/cron/briefing`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cronSecret}` },
    });
    if (!res.ok) {
      await send(chatId, `I'm afraid the briefing eludes me (${res.status}), sir. Might the dev server be asleep?`);
      return;
    }
    // The briefing endpoint sends the Telegram message itself, so we just confirm.
    const data = await res.json() as { insights: number; telegramSent: boolean };
    if (!data.telegramSent) {
      await send(chatId, `The briefing ran (${data.insights} insights), sir, though the Telegram dispatch was skipped. The logs may explain.`);
    }
    // If telegramSent is true, the user already got the briefing message.
  } catch {
    await send(chatId, "I couldn't reach the study, sir. Is `npm run dev` running?");
  }
}

// ---- New Step-3 command handlers --------------------------------------------

// /done — open tasks as a single message; each row gets Done / Snooze / Drop buttons.
async function handleDone(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("tasks")
    .select("id,title,due_date,quadrant,user_corrected_quadrant")
    .eq("user_id", uid)
    .not("status", "in", '("done","dropped")')
    .order("priority_score", { ascending: false })
    .limit(7);

  const tasks = (data ?? []) as Array<{
    id: string; title: string; due_date: string | null;
    quadrant: Quadrant | null; user_corrected_quadrant: Quadrant | null;
  }>;

  if (tasks.length === 0) {
    await send(chatId, "📋 Not a single open task, sir. Quite the achievement — enjoy the respite.");
    return;
  }

  const lines = [`📋 <b>Open tasks</b> — tap a row to action:`];
  const keyboard: unknown[][] = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const eff = (t.user_corrected_quadrant ?? t.quadrant) as Quadrant | null;
    const qe = eff ? QUADRANT_META[eff].emoji : "❔";
    const hint = dueHint(t.due_date);
    lines.push(`${i + 1}. ${qe} <b>${t.title.slice(0, 52)}</b>${hint ? ` — ${hint}` : ""}`);
    keyboard.push([
      { text: `✅ #${i + 1} Done`,   callback_data: `done_task:${t.id}` },
      { text: `😴 Snooze`,           callback_data: `snooze_task:${t.id}` },
      { text: `💨 Drop`,             callback_data: `drop_task:${t.id}` },
    ]);
  }

  await send(chatId, lines.join("\n"), { inline_keyboard: keyboard });
}

// /focus — the single top DO_NOW task with done + snooze buttons.
async function handleFocus(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();

  // Prefer DO_NOW (user-corrected wins); fall back to highest-priority task.
  let { data: task } = await s
    .from("tasks")
    .select("id,title,description,due_date")
    .eq("user_id", uid)
    .not("status", "in", '("done","dropped")')
    .or("user_corrected_quadrant.eq.do_now,quadrant.eq.do_now")
    .order("priority_score", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!task) {
    const { data: fallback } = await s
      .from("tasks")
      .select("id,title,description,due_date")
      .eq("user_id", uid)
      .not("status", "in", '("done","dropped")')
      .order("priority_score", { ascending: false })
      .limit(1)
      .maybeSingle();
    task = fallback;
  }

  if (!task) {
    await send(chatId, "🎯 Nothing on your list, sir. A most enviable state of affairs.");
    return;
  }

  const hint = dueHint(task.due_date as string | null);
  const desc = task.description as string | null;
  const lines = [`🎯 <b>Focus on this now, sir:</b>`, ``, `🔴 <b>${(task.title as string)}</b>`];
  if (hint) lines.push(`📅 ${hint}`);
  if (desc) lines.push(``, (desc as string).slice(0, 220));

  await send(chatId, lines.join("\n"), {
    inline_keyboard: [[
      { text: "✅ Done — well executed", callback_data: `done_task:${task.id}` },
      { text: "😴 Snooze 1 day",        callback_data: `snooze_task:${task.id}` },
    ]],
  });
}

// /week — overdue tasks + tasks due within 7 days, grouped.
async function handleWeek(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const today = new Date().toISOString().split("T")[0]!;
  const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0]!;

  const [overdueRes, soonRes] = await Promise.all([
    s.from("tasks")
      .select("id,title,due_date,quadrant,user_corrected_quadrant")
      .eq("user_id", uid)
      .not("status", "in", '("done","dropped")')
      .not("due_date", "is", null)
      .lt("due_date", today)
      .order("due_date", { ascending: true })
      .limit(5),
    s.from("tasks")
      .select("id,title,due_date,quadrant,user_corrected_quadrant")
      .eq("user_id", uid)
      .not("status", "in", '("done","dropped")')
      .gte("due_date", today)
      .lte("due_date", in7)
      .order("due_date", { ascending: true })
      .limit(10),
  ]);

  type WeekTask = { id: string; title: string; due_date: string | null; quadrant: Quadrant | null; user_corrected_quadrant: Quadrant | null };
  const overdue = (overdueRes.data ?? []) as WeekTask[];
  const soon    = (soonRes.data ?? []) as WeekTask[];

  if (!overdue.length && !soon.length) {
    await send(chatId, "📅 Nothing due this week, sir. Either you're ahead of schedule, or tasks haven't been dated. Do keep me informed.");
    return;
  }

  const lines: string[] = [`📅 <b>Your week, sir</b>`, ``];

  if (overdue.length) {
    lines.push(`🚨 <b>Overdue (${overdue.length})</b>`);
    for (const t of overdue) {
      const q = (t.user_corrected_quadrant ?? t.quadrant) as Quadrant | null;
      lines.push(`• ${q ? QUADRANT_META[q].emoji : "❔"} ${t.title.slice(0, 55)} <i>(${dueHint(t.due_date)})</i>`);
    }
    lines.push(``);
  }

  if (soon.length) {
    lines.push(`📆 <b>Due this week (${soon.length})</b>`);
    for (const t of soon) {
      const q = (t.user_corrected_quadrant ?? t.quadrant) as Quadrant | null;
      lines.push(`• ${q ? QUADRANT_META[q].emoji : "❔"} ${t.title.slice(0, 55)} — <i>${dueHint(t.due_date)}</i>`);
    }
  }

  await send(chatId, lines.join("\n"));
}

// /ask <question> — RAG Q&A over the user's memory store.
async function handleAsk(chatId: number, question: string): Promise<void> {
  if (!question.trim()) {
    await send(chatId, [
      `Usage: <code>/ask What did I decide about the Acme deal?</code>`,
      ``,
      `I shall search everything you've captured and answer from your own records, sir.`,
      `(Requires Ollama or an AI provider configured in .env.local.)`,
    ].join("\n"));
    return;
  }

  await send(chatId, `🔍 <i>Searching your memory, sir…</i>`);

  const uid = await getUid();
  const s = sb();

  try {
    // Pass uid so the service-role client can scope the query (0015 migration).
    const hits = await searchMemory(s, question, 8, uid);

    if (!hits.length) {
      await send(chatId, `I'm afraid your memory holds nothing on that subject yet, sir. Everything you capture is indexed — send me some notes and I shall find them at once.`);
      return;
    }

    const context = hits
      .map((h, i) => `[${i + 1}] (${h.source_type}, ${h.created_at.slice(0, 10)}) ${h.text}`)
      .join("\n");

    const answer = await getProvider().answer(question, context);
    await send(chatId, `🧠 <b>From your records, sir:</b>\n\n${answer}\n\n<i>(${hits.length} source${hits.length > 1 ? "s" : ""} consulted)</i>`);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("embed") || msg.includes("Ollama") || msg.includes("model") || msg.includes("provider")) {
      await send(chatId, `The memory search requires a language model, sir. Might I suggest starting Ollama, or setting <code>AI_PROVIDER=anthropic</code> in .env.local?`);
    } else {
      await send(chatId, `My apologies, sir — the search failed: ${msg.slice(0, 200)}`);
    }
  }
}

// /win <text> — quick journal entry tagged as a win, mood=5.
async function handleWin(chatId: number, args: string): Promise<void> {
  if (!args.trim()) {
    await send(chatId, `Usage: <code>/win Closed the Acme deal</code>\n\nI shall record your victory in the journal at once, sir.`);
    return;
  }

  const uid = await getUid();
  const s = sb();
  const text = args.trim();

  const { error } = await s.from("journal_entries").insert({
    user_id: uid,
    raw_text: text,
    summary: `Win: ${text.slice(0, 120)}`,
    mood: 5,
    themes: ["win"],
  });

  if (error) {
    await send(chatId, `My apologies, sir — I couldn't record that: ${error.message}`);
    return;
  }

  await send(chatId, `🏆 Victory noted, sir: <b>${text.slice(0, 120)}</b>\n\nDuly entered in your journal. Well done, Master Yazeed.`);
}

// /health [args] — log health data, or show today's summary if no args.
// Parse: "7.5h 8000steps 72kg", "sleep=7 steps=8000 weight=72", etc.
async function handleHealth(chatId: number, args: string): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const today = new Date().toISOString().split("T")[0]!;

  if (!args.trim()) {
    const { data } = await s
      .from("health_daily")
      .select("steps,sleep_minutes,weight,resting_heart_rate,recovery_score,activity_score")
      .eq("user_id", uid)
      .eq("date", today)
      .maybeSingle();

    if (!data) {
      await send(chatId, [
        `❤️ <b>Health — ${today}</b>`,
        ``,
        `No data recorded yet today, sir.`,
        ``,
        `Log it: <code>/health 7.5h 8000steps 72kg</code>`,
        `Accepts: sleep hours · steps (k = ×1000) · kg or lbs · bpm`,
      ].join("\n"));
      return;
    }

    type HD = { steps: number | null; sleep_minutes: number | null; weight: number | null; resting_heart_rate: number | null; recovery_score: number | null; activity_score: number | null };
    const d = data as HD;
    const lines = [`❤️ <b>Health — ${today}</b>`, ``];
    if (d.sleep_minutes)      lines.push(`😴 Sleep: ${(d.sleep_minutes / 60).toFixed(1)}h`);
    if (d.steps)              lines.push(`👟 Steps: ${d.steps.toLocaleString()}`);
    if (d.weight)             lines.push(`⚖️ Weight: ${d.weight} kg`);
    if (d.resting_heart_rate) lines.push(`💓 RHR: ${d.resting_heart_rate} bpm`);
    if (d.recovery_score)     lines.push(`🔋 Recovery: ${Math.round(d.recovery_score)}/100`);
    if (d.activity_score)     lines.push(`⚡ Activity: ${Math.round(d.activity_score)}/100`);
    await send(chatId, lines.join("\n"));
    return;
  }

  const entry = parseHealthArgs(args);
  if (!Object.keys(entry).length) {
    await send(chatId, `I couldn't parse that, sir. Try: <code>/health 7.5h 8000steps 72kg</code>`);
    return;
  }

  const { error } = await s.from("health_daily").upsert(
    { user_id: uid, date: today, source: "manual", ...entry },
    { onConflict: "user_id,date" },
  );

  if (error) {
    await send(chatId, `My apologies, sir — couldn't log that: ${error.message}`);
    return;
  }

  const parts = [
    entry.sleep_minutes ? `${(entry.sleep_minutes / 60).toFixed(1)}h sleep` : null,
    entry.steps         ? `${entry.steps.toLocaleString()} steps`            : null,
    entry.weight        ? `${entry.weight} kg`                               : null,
    entry.resting_heart_rate ? `${entry.resting_heart_rate} bpm`             : null,
    entry.notes         ? `"${entry.notes}"`                                 : null,
  ].filter(Boolean);

  await send(chatId, `❤️ Logged, sir: <b>${parts.join(" · ")}</b>\n\nYour health dashboard will reflect the update.`);
}

// /goals — active goals with progress bars and next actions.
async function handleGoals(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("goals")
    .select("id,title,progress_percentage,deadline,next_action")
    .eq("user_id", uid)
    .eq("status", "active")
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(8);

  const goals = (data ?? []) as Array<{
    id: string; title: string; progress_percentage: number;
    deadline: string | null; next_action: string | null;
  }>;

  if (!goals.length) {
    await send(chatId, `🎯 No active goals on the books, sir. To set one, simply tell me: "Goal: launch product by Q3".`);
    return;
  }

  const lines = [`🎯 <b>Active goals (${goals.length})</b>`, ``];
  for (const g of goals) {
    const pct = Math.round(g.progress_percentage ?? 0);
    const filled = Math.round(pct / 10);
    const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
    const hint = g.deadline ? dueHint(g.deadline) : "no deadline";
    lines.push(`<b>${g.title.slice(0, 60)}</b>`);
    lines.push(`${bar} ${pct}% · ${hint}`);
    if (g.next_action) lines.push(`→ ${(g.next_action as string).slice(0, 90)}`);
    lines.push(``);
  }

  await send(chatId, lines.join("\n").trimEnd());
}

// /pipeline — open opportunities ordered by expected value.
async function handlePipeline(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("opportunities")
    .select("id,title,status,expected_value,deadline,next_action")
    .eq("user_id", uid)
    .not("status", "in", '("won","lost","archived")')
    .order("expected_value", { ascending: false })
    .limit(8);

  const opps = (data ?? []) as Array<{
    id: string; title: string; status: string; expected_value: number;
    deadline: string | null; next_action: string | null;
  }>;

  if (!opps.length) {
    await send(chatId, `💰 The pipeline is empty, sir. Try: "Opportunity: consulting retainer with Acme, $50k".`);
    return;
  }

  const totalEV = opps.reduce((sum, o) => sum + (o.expected_value ?? 0), 0);
  const S: Record<string, string> = {
    new:"🆕", researching:"🔎", contacted:"📞", negotiating:"🤝", waiting:"⏳",
  };

  const lines = [
    `💰 <b>Pipeline — ${opps.length} open</b>`,
    `<b>Total EV: $${Math.round(totalEV).toLocaleString()}</b>`,
    ``,
  ];

  for (const o of opps) {
    const hint = o.deadline ? dueHint(o.deadline) : "";
    lines.push(`${S[o.status] ?? "📋"} <b>${o.title.slice(0, 55)}</b>`);
    lines.push(`   EV $${Math.round(o.expected_value ?? 0).toLocaleString()} · ${o.status}${hint ? ` · ${hint}` : ""}`);
    if (o.next_action) lines.push(`   → ${(o.next_action as string).slice(0, 75)}`);
    lines.push(``);
  }

  await send(chatId, lines.join("\n").trimEnd());
}

// /risks — open/mitigating risks ordered by risk score (probability × impact).
async function handleRisks(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("risks")
    .select("id,title,category,risk_score,mitigation_plan,status")
    .eq("user_id", uid)
    .not("status", "in", '("closed","accepted")')
    .order("risk_score", { ascending: false })
    .limit(8);

  const risks = (data ?? []) as Array<{
    id: string; title: string; category: string; risk_score: number;
    mitigation_plan: string | null; status: string;
  }>;

  if (!risks.length) {
    await send(chatId, `✅ No open risks, sir. Either all is well, or nothing has been logged. Try: "Risk: key engineer might leave".`);
    return;
  }

  const sev = (score: number) => score >= 15 ? "🔴" : score >= 8 ? "🟠" : "🟡";

  const lines = [`⚠️ <b>Open risks (${risks.length})</b>`, ``];
  for (const r of risks) {
    lines.push(`${sev(r.risk_score ?? 0)} <b>${r.title.slice(0, 60)}</b>`);
    lines.push(`   Score ${r.risk_score ?? "?"} · ${r.category} · ${r.status}`);
    if (r.mitigation_plan) lines.push(`   Plan: ${(r.mitigation_plan as string).slice(0, 80)}`);
    lines.push(``);
  }

  await send(chatId, lines.join("\n").trimEnd());
}

// /insights — latest CoS alerts, forecasts, and correlations.
async function handleInsights(chatId: number): Promise<void> {
  const uid = await getUid();
  const s = sb();
  const { data } = await s
    .from("ai_insights")
    .select("id,title,description,severity,insight_type,created_at")
    .eq("user_id", uid)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(6);

  const insights = (data ?? []) as Array<{
    id: string; title: string; description: string | null;
    severity: string; insight_type: string; created_at: string;
  }>;

  if (!insights.length) {
    await send(chatId, `💡 No active insights yet, sir. The crons run daily — or summon them now via /briefing.`);
    return;
  }

  const SEV: Record<string, string> = { critical:"🔴", high:"🟠", medium:"🟡", low:"⚪", info:"🔵" };
  const TYPE: Record<string, string> = { chief:"CoS", forecast:"Forecast", correlation:"Correlation" };

  const lines = [`💡 <b>Latest insights (${insights.length})</b>`, ``];
  for (const i of insights) {
    const date = i.created_at.slice(0, 10);
    lines.push(`${SEV[i.severity] ?? "💡"} [${TYPE[i.insight_type] ?? i.insight_type}] <b>${i.title.slice(0, 75)}</b>`);
    if (i.description) lines.push(`   ${(i.description as string).slice(0, 110)}`);
    lines.push(`   <i>${date}</i>`);
    lines.push(``);
  }

  await send(chatId, lines.join("\n").trimEnd(), {
    inline_keyboard: [[{ text: "📋 Full briefing", callback_data: "cmd:briefing" }]],
  });
}

// ---- Command registry (Step 3) ----------------------------------------------
// Single source of truth for every bot command.
// main() dispatches via this array; setMyCommands is derived automatically.

// Helper used by the registry to keep lambda signatures lean.
const _do = (fn: (c: number) => Promise<void>) =>
  (c: number, _a: string, _m: number) => fn(c);

const COMMANDS: OSCommand[] = [
  // ── capture
  { command: "start",    description: "Welcome & command guide",                        handle: _do(handleStart) },
  { command: "help",     description: "Show all commands",                              handle: _do(handleStart) },
  // ── task management
  { command: "done",     description: "Open tasks — mark done, snooze, or drop",       handle: _do(handleDone) },
  { command: "focus",    description: "What to work on right now",                     handle: _do(handleFocus) },
  { command: "week",     description: "Overdue + due in the next 7 days",              handle: _do(handleWeek) },
  { command: "matrix",   description: "Eisenhower matrix snapshot",                   handle: _do(handleMatrix) },
  { command: "correct",  description: "Re-classify last task  (/correct last)",       handle: async (c, a) => {
    if (a.toLowerCase().trim() === "last") await handleCorrectLast(c);
    else await send(c, "Usage: <code>/correct last</code>");
  }},
  // ── intelligence
  { command: "status",   description: "Quick dashboard",                               handle: _do(handleStatus) },
  { command: "briefing", description: "Chief of Staff on-demand briefing",            handle: _do(handleBriefing) },
  { command: "insights", description: "Latest CoS alerts & forecasts",               handle: _do(handleInsights) },
  { command: "ask",      description: "Search your memory — /ask <question>",        handle: async (c, a) => handleAsk(c, a) },
  // ── modules
  { command: "goals",    description: "Active goals with progress bars",              handle: _do(handleGoals) },
  { command: "pipeline", description: "Open opportunities + total EV",               handle: _do(handlePipeline) },
  { command: "risks",    description: "Open risks by severity",                       handle: _do(handleRisks) },
  { command: "health",   description: "Log or view today's health data",              handle: async (c, a) => handleHealth(c, a) },
  { command: "win",      description: "Record a win in your journal",                 handle: async (c, a) => handleWin(c, a) },
  // ── review
  { command: "review",   description: "Review queue + uncertain quadrants",           handle: _do(handleReview) },
];

// ---- Callback query handler -------------------------------------------------

async function handleCallback(callback: Record<string, unknown>): Promise<void> {
  const cbId = callback.id as string;
  const data = callback.data as string;
  const msg = callback.message as Record<string, unknown> | undefined;
  if (!msg) { await answerCallback(cbId); return; }

  const chatId = (msg.chat as { id: number }).id;
  const messageId = msg.message_id as number;
  const uid = await getUid();
  const s = sb();

  // done_task:<taskId> — mark a task done directly from /done or /focus.
  if (data.startsWith("done_task:")) {
    const taskId = data.split(":")[1] ?? "";
    await s.from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", taskId).eq("user_id", uid);
    await answerCallback(cbId, "Marked done, sir ✓");
    const cur = (msg.text as string) ?? "";
    await editMessage(chatId, messageId, `${cur}\n\n✅ <i>Done — well executed, sir.</i>`);
    return;
  }

  // snooze_task:<taskId> — push due_date by 1 day and increment postpone_count.
  if (data.startsWith("snooze_task:")) {
    const taskId = data.split(":")[1] ?? "";
    const { data: task } = await s
      .from("tasks").select("due_date,postpone_count")
      .eq("id", taskId).eq("user_id", uid).single();

    const base = task?.due_date ? new Date(task.due_date as string) : new Date();
    base.setDate(base.getDate() + 1);
    const newDate = base.toISOString().split("T")[0]!;
    const postponeCount = ((task?.postpone_count as number) ?? 0) + 1;

    await s.from("tasks")
      .update({ due_date: newDate, postpone_count: postponeCount })
      .eq("id", taskId).eq("user_id", uid);

    await answerCallback(cbId, `Snoozed to ${newDate} — noted, sir.`);
    const cur = (msg.text as string) ?? "";
    await editMessage(chatId, messageId, `${cur}\n\n😴 <i>Snoozed to ${newDate}, sir.</i>`);
    return;
  }

  // drop_task:<taskId> — ask for confirmation before dropping.
  if (data.startsWith("drop_task:")) {
    const taskId = data.split(":")[1] ?? "";
    const { data: task } = await s.from("tasks").select("title").eq("id", taskId).eq("user_id", uid).maybeSingle();
    const title = ((task?.title as string | undefined) ?? "this task").slice(0, 60);
    await answerCallback(cbId);
    await send(chatId,
      `💨 Drop "<b>${title}</b>", sir? It will be moved to dropped — removed from your active list.\n<i>(The record is kept; you may always revisit it.)</i>`,
      { inline_keyboard: [[
        { text: "Yes, drop it",  callback_data: `confirm_drop:${taskId}` },
        { text: "No, keep it",   callback_data: `cancel_undo` },
      ]]},
    );
    return;
  }

  // confirm_drop:<taskId> — confirmed; mark the task dropped.
  if (data.startsWith("confirm_drop:")) {
    const taskId = data.split(":")[1] ?? "";
    await s.from("tasks")
      .update({ status: "dropped" })
      .eq("id", taskId).eq("user_id", uid);
    await s.from("audit_log").insert({
      user_id: uid, action: "update", table_name: "tasks",
      record_id: taskId, new_value: { status: "dropped" }, source: "telegram",
    });
    await answerCallback(cbId, "Dropped, sir.");
    await editMessage(chatId, messageId, `💨 <i>Dropped, sir. It shan't trouble you further.</i>`);
    return;
  }

  // cmd:<action> — keyboard shortcuts from inline panels (e.g., "Full briefing" button).
  if (data.startsWith("cmd:")) {
    const action = data.slice(4);
    await answerCallback(cbId);
    if (action === "briefing") { await handleBriefing(chatId); return; }
    if (action === "focus")    { await handleFocus(chatId);    return; }
    if (action === "done")     { await handleDone(chatId);     return; }
    return;
  }

  // quad:<toQuadrant>:<recordId> — user overrides the Eisenhower quadrant.
  if (data.startsWith("quad:")) {
    const parts = data.split(":");
    const to = parts[1] ?? "";
    const recordId = parts[2] ?? "";
    if (!isQuadrant(to)) { await answerCallback(cbId); return; }

    // Effective quadrant before this change = user override (if any), else Alfred's.
    const { data: task } = await s
      .from("tasks")
      .select("quadrant, user_corrected_quadrant")
      .eq("id", recordId).eq("user_id", uid).single();
    const from = (task?.user_corrected_quadrant ?? task?.quadrant ?? null) as string | null;

    // Store the user's judgment separately from Alfred's computed quadrant.
    await s.from("tasks")
      .update({ user_corrected_quadrant: to })
      .eq("id", recordId).eq("user_id", uid);

    // Log to the correction history (training signal). from_quadrant is NOT NULL,
    // so only log when a prior quadrant exists and the value actually changed.
    if (from && from !== to) {
      await s.from("quadrant_corrections").insert({
        user_id: uid, task_id: recordId, from_quadrant: from, to_quadrant: to,
      });
    }

    const qm = QUADRANT_META[to];
    await answerCallback(cbId, `Very good, sir — ${qm.label}`);

    // Reflect the change inline and keep buttons (minus the new quadrant) to re-correct.
    const currentText = (msg.text as string) ?? "";
    const newLine = `📊 ${qm.emoji} ${qm.label} (as you wish, sir ✏️)`;
    const updatedText = /📊 .*confidence\)/.test(currentText)
      ? currentText.replace(/📊 .*confidence\)/, newLine)
      : `${currentText}\n${newLine}`;
    await editMessage(chatId, messageId, updatedText, [quadrantButtonsRow(recordId, to)]);
    return;
  }

  // keep:<recordId> — user confirms Alfred's quadrant (clears it from review).
  if (data.startsWith("keep:")) {
    const recordId = data.split(":")[1] ?? "";
    const { data: task } = await s
      .from("tasks")
      .select("quadrant")
      .eq("id", recordId).eq("user_id", uid).single();
    const q = (task?.quadrant ?? null) as string | null;
    if (q) {
      await s.from("tasks")
        .update({ user_corrected_quadrant: q })
        .eq("id", recordId).eq("user_id", uid);
    }
    await answerCallback(cbId, "Quite right, sir ✓");
    const currentText = (msg.text as string) ?? "";
    await editMessage(chatId, messageId, `${currentText}\n✅ Quite right, sir.`);
    return;
  }

  // matrix:review — shortcut button from /matrix into the review flow.
  if (data === "matrix:review") {
    await answerCallback(cbId);
    await handleReview(chatId);
    return;
  }

  // urg:<urgency>:<table>:<recordId>
  if (data.startsWith("urg:")) {
    const parts = data.split(":");
    const urgency = parts[1] ?? "";
    const table = parts[2] ?? "";
    const recordId = parts[3] ?? "";
    const priorityMap: Record<string, string> = {
      today: "urgent", this_week: "high", someday: "low",
    };
    const dueDateMap: Record<string, string | null> = {
      today: new Date().toISOString().split("T")[0] ?? null,
      this_week: null,
      someday: null,
    };

    if (table === "tasks") {
      await s.from("tasks").update({
        priority: priorityMap[urgency] ?? "medium",
        due_date: dueDateMap[urgency] ?? null,
      }).eq("id", recordId).eq("user_id", uid);
    }

    const label = urgency === "today" ? "🔴 Today" : urgency === "this_week" ? "🟡 This week" : "⚪ Someday";
    await answerCallback(cbId, `Very good, sir — ${label}`);

    // Update the message to reflect the change.
    const currentText = (msg.text as string) ?? "";
    const updatedText = currentText.replace(/🔺 Priority: \w+/, `🔺 Priority: ${priorityMap[urgency] ?? "medium"}`);
    await editMessage(chatId, messageId, updatedText || currentText);
    return;
  }

  // review:<rawId>:<table>:<recordId>
  if (data.startsWith("review:")) {
    const rParts = data.split(":");
    const rawId = rParts[1] ?? "";
    const table = rParts[2] ?? "";
    const recordId = rParts[3] ?? "";

    // Delete the created record and move to review queue.
    await s.from(table).delete().eq("id", recordId).eq("user_id", uid);
    await s.from("review_queue").insert({
      user_id: uid, raw_event_id: rawId, proposed_table: table,
      proposed_record: { moved_from: table, original_id: recordId },
      reason: "user_requested_review", confidence: 1,
    });
    await s.from("raw_ingestion_events").update({ processing_status: "needs_review" }).eq("id", rawId);

    await answerCallback(cbId, "Moved to your review queue, sir");
    await editMessage(chatId, messageId, "🔄 Set aside for your review, sir. It awaits at /review, or on your dashboard.");
    return;
  }

  // undo:<table>:<recordId>:<rawId> — ask for confirmation first (destructive action).
  if (data.startsWith("undo:")) {
    const uParts = data.split(":");
    const table = uParts[1] ?? "";
    const recordId = uParts[2] ?? "";
    const rawId = uParts[3] ?? "";

    await answerCallback(cbId);
    await editMessage(chatId, messageId,
      `⚠️ Shall I truly undo that, sir? The ${table.replace(/_/g, " ").replace(/s$/, "")} will be removed.\n\n` +
      `<i>(Your original note is preserved — you may re-capture at any time.)</i>`,
      [
        [
          { text: "Yes, undo it", callback_data: `confirm_undo:${table}:${recordId}:${rawId}` },
          { text: "No, keep it",  callback_data: `cancel_undo` },
        ],
      ],
    );
    return;
  }

  // confirm_undo:<table>:<recordId>:<rawId> — confirmed destructive delete.
  if (data.startsWith("confirm_undo:")) {
    const uParts = data.split(":");
    const table = uParts[1] ?? "";
    const recordId = uParts[2] ?? "";
    const rawId = uParts[3] ?? "";

    await s.from(table).delete().eq("id", recordId).eq("user_id", uid);
    await s.from("raw_ingestion_events")
      .update({ processing_status: "pending", routed_to: null, routed_id: null })
      .eq("id", rawId);
    await s.from("audit_log").insert({
      user_id: uid, action: "delete", table_name: table, record_id: recordId, source: "telegram",
    });

    await answerCallback(cbId, "Undone, sir.");
    await editMessage(chatId, messageId, "🗑 Consider it forgotten, sir. Your original note is kept, naturally — should you change your mind.");
    return;
  }

  // cancel_undo — user thought better of it.
  if (data === "cancel_undo") {
    await answerCallback(cbId, "Very well, sir — it stays.");
    const currentText = (msg.text as string) ?? "";
    await editMessage(chatId, messageId, currentText.split("\n\n")[0] ?? currentText);
    return;
  }

  await answerCallback(cbId);
}

// ---- Main loop --------------------------------------------------------------

async function main() {
  await tg("deleteWebhook");

  // Register bot commands — derived from the COMMANDS registry automatically.
  await tg("setMyCommands", {
    commands: COMMANDS
      .filter(c => c.command !== "help") // /start covers it; avoid duplicate in picker
      .map(c => ({ command: c.command, description: c.description })),
  });

  console.log("[Alfred] At my post. Long-polling started — do send word on Telegram, sir.");
  let offset = 0;

  while (true) {
    try {
      const data = await tg("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
      const updates = (data.result ?? []) as Array<Record<string, unknown>>;

      for (const u of updates) {
        offset = (u.update_id as number) + 1;

        // Handle callback queries (button presses).
        if (u.callback_query) {
          const cb = u.callback_query as Record<string, unknown>;
          const cbFrom = cb.from as { id: number } | undefined;
          if (String(cbFrom?.id) !== allowedUserId) continue;
          try {
            await handleCallback(cb);
          } catch (err) {
            console.error("[Alfred] callback error:", err);
          }
          continue;
        }

        // Handle messages.
        const msg = u.message as Record<string, unknown> | undefined;
        if (!msg) continue;

        const fromId = String((msg.from as { id?: number })?.id ?? "");
        if (fromId !== allowedUserId) {
          console.warn(`[Alfred] rejected sender ${fromId}`);
          continue;
        }

        const chatId = (msg.chat as { id: number }).id;
        const msgId = msg.message_id as number;
        const text = (msg.text ?? msg.caption ?? null) as string | null;

        // Bot commands — dispatched through the COMMANDS registry.
        if (text?.startsWith("/")) {
          const rawCmd = (text.split(" ")[0] ?? "").replace(/@\w+/, "").toLowerCase();
          const args   = text.slice(rawCmd.length).trim();
          const entry  = COMMANDS.find(c => `/${c.command}` === rawCmd);

          if (entry) {
            try {
              await entry.handle(chatId, args, msgId);
            } catch (err) {
              console.error(`[Alfred] command error (${rawCmd}):`, err);
              await send(chatId, `I'm afraid something went awry, sir: ${(err as Error).message ?? "unknown error"}`, { reply_to: msgId });
            }
          } else {
            await send(chatId, `I don't recognise that one, sir. /help lays out my full repertoire.`, { reply_to: msgId });
          }
          continue;
        }

        // Voice notes — persist raw.
        if (msg.voice) {
          try {
            const uid = await getUid();
            const s = sb();
            await s.from("raw_ingestion_events").insert({
              user_id: uid,
              source: "telegram",
              content_type: "audio",
              raw_content: text ?? `[voice ${(msg.voice as { duration?: number }).duration ?? 0}s]`,
              storage_path: (msg.voice as { file_id?: string }).file_id ?? null,
              processing_status: "needs_review",
            });
            await send(chatId, "🎤 Your voice note is kept safe, sir. A dictated message, and I'll file it at once.", { reply_to: msgId });
          } catch (err) {
            await send(chatId, `My apologies, sir — ${(err as Error).message}`, { reply_to: msgId });
          }
          continue;
        }

        // Photos/documents with captions — run caption through pipeline.
        if (!text && (msg.photo || msg.document)) {
          try {
            const uid = await getUid();
            const s = sb();
            const fileId = msg.photo
              ? ((msg.photo as Array<{ file_id: string }>).pop()?.file_id ?? null)
              : ((msg.document as { file_id?: string })?.file_id ?? null);
            await s.from("raw_ingestion_events").insert({
              user_id: uid,
              source: "telegram",
              content_type: msg.photo ? "photo" : "file",
              raw_content: "[no caption]",
              storage_path: fileId,
              processing_status: "needs_review",
            });
            await send(chatId, "📎 Safely stored, sir. A caption next time, and I'll file it properly.", { reply_to: msgId });
          } catch (err) {
            await send(chatId, `My apologies, sir — ${(err as Error).message}`, { reply_to: msgId });
          }
          continue;
        }

        if (!text) continue;

        // Text / captioned media → capture pipeline.
        try {
          const result = await capture(text, "telegram");
          const { text: replyText, keyboard } = formatCaptureReply(result);
          await send(chatId, replyText, {
            reply_to: msgId,
            inline_keyboard: keyboard.length > 0 ? keyboard : undefined,
          });
        } catch (err) {
          console.error("[Alfred] capture error:", err);
          await send(chatId, `❌ My apologies, sir — ${(err as Error).message}`, { reply_to: msgId });
        }
      }
    } catch (err) {
      console.error("[Alfred] poll error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
