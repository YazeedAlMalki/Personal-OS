import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { buildSnapshot } from "@/lib/chief/snapshot";
import { runChiefOfStaff } from "@/lib/chief";
import {
  persistInsights,
  formatBriefing,
  resolveSingleUserId,
} from "@/lib/chief/persist";
import { runForecasts } from "@/lib/forecast/runner";
import { sendMessage } from "@/lib/integrations/telegram";

// POST /api/cron/briefing — Morning briefing cron job.
// 1. Run Chief of Staff rules + forecasts against the user's data.
// 2. Persist new insights to ai_insights (deduped by day).
// 3. Optionally send a Telegram message with the briefing.
//
// Auth: CRON_SECRET in the Authorization header.
// Schedule: 7am user-local via Vercel Cron, node-cron, or system cron.
//   curl -X POST http://localhost:3000/api/cron/briefing \
//     -H "Authorization: Bearer YOUR_CRON_SECRET"

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretEquals(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Chief of Staff rules.
  const snapshot = await buildSnapshot(supabase, now);
  const ruleInsights = runChiefOfStaff(snapshot);

  // Forecast engine — runs alongside the rules so the morning briefing reflects
  // both rule-based alerts and forward-looking risks. Failures here must not
  // sink the whole briefing.
  let forecastInsights: typeof ruleInsights = [];
  try {
    forecastInsights = await runForecasts(supabase, now);
  } catch (err) {
    console.error("[briefing] forecasts failed:", err);
  }

  const all = [...ruleInsights, ...forecastInsights];

  // Persist (dedupe handled by ai_insights unique index). user_id must be
  // explicit — service-role inserts have no auth.uid().
  const uid = await resolveSingleUserId(supabase);
  if (!uid) return NextResponse.json({ error: "no user found" }, { status: 503 });
  const persistResult = await persistInsights(supabase, all, uid);

  // Send Telegram briefing if configured.
  let telegramSent = false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_USER_ID;
  if (token && token !== "PASTE_BOT_TOKEN_HERE" && chatId && chatId !== "PASTE_YOUR_CHAT_ID_HERE") {
    const text = formatBriefing(all, now);
    try {
      await sendMessage(token, Number(chatId), text);
      telegramSent = true;
    } catch (err) {
      console.error("[briefing] Telegram send failed:", err);
    }
  }

  return NextResponse.json({
    insights: all.length,
    rules: ruleInsights.length,
    forecasts: forecastInsights.length,
    persisted: persistResult,
    telegramSent,
  });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
