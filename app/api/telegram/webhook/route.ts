import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { runCapturePipeline } from "@/lib/ingestion/pipeline";
import {
  sendMessage,
  escapeHtml,
  getFileUrl,
  extractText,
  contentType,
  isAuthorizedSender,
  type TelegramUpdate,
} from "@/lib/integrations/telegram";
import { sttConfigured, transcribeAudio } from "@/lib/ai/stt";
import { rateLimitResponse } from "@/lib/security/ratelimit";
import { readJsonCapped, INGRESS_MAX_BYTES } from "@/lib/security/http";

// Telegram webhook — alternative ingress for cloud/public-URL deployments.
// Self-host uses long-polling instead (scripts/telegram-poll.ts).
// Auth: x-telegram-bot-api-secret-token header + sender-ID verification.

export async function POST(request: Request) {
  // 0. Rate-limit before the secret check — throttles secret brute-forcing too.
  const limited = rateLimitResponse("telegram:webhook", {
    capacity: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  // 1. Verify webhook secret.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || secret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || !secretEquals(headerSecret, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 2. Parse the update (size-capped — §13 payload cap on unauthenticated ingress).
  const read = await readJsonCapped<TelegramUpdate | null>(request, INGRESS_MAX_BYTES);
  if (!read.ok) return read.response;
  const update = read.body;
  const msg = update?.message;
  if (!msg) return NextResponse.json({ ok: true }); // Telegram sends non-message updates; ignore.

  // 3. Verify sender.
  const userId = process.env.TELEGRAM_USER_ID;
  if (!userId || !isAuthorizedSender(msg, userId)) {
    return NextResponse.json({ ok: true }); // Silent reject — don't leak info.
  }

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const cType = contentType(msg);
  const supabase = createServiceClient();

  // Resolve the app user_id (single-user system).
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
  if (!profile?.id) {
    return NextResponse.json({ error: "no user" }, { status: 500 });
  }

  // 4. Voice → transcribe (when STT is configured) → capture pipeline.
  //    Unconfigured/failed STT degrades to the old behavior: park for review.
  if (cType === "audio") {
    let transcript: string | null = null;
    if (sttConfigured() && msg.voice?.file_id) {
      const fileUrl = await getFileUrl(token, msg.voice.file_id).catch(() => null);
      if (fileUrl) {
        const audio = await fetch(fileUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
        if (audio) transcript = await transcribeAudio(audio);
      }
    }
    if (transcript) {
      const result = await runCapturePipeline({ text: transcript, source: "telegram", supabase, userId: profile.id });
      const reply =
        result.status === "created"
          ? `Heard: “${escapeHtml(transcript.slice(0, 120))}”\n<b>${result.classified.kind}</b> created: ${escapeHtml(result.classified.title)}`
          : result.status === "review"
            ? `Heard: “${escapeHtml(transcript.slice(0, 120))}” — saved for review (confidence ${(result.classified.confidence * 100).toFixed(0)}%).`
            : `Transcribed, but capture failed: ${escapeHtml(result.error)}`;
      await sendMessage(token, msg.chat.id, reply, { reply_to_message_id: msg.message_id });
      return NextResponse.json({ ok: true });
    }
    const text = extractText(msg) ?? `[voice note ${msg.voice?.duration ?? 0}s]`;
    await supabase.from("raw_ingestion_events").insert({
      user_id: profile.id,
      source: "telegram",
      content_type: "audio",
      raw_content: text,
      storage_path: msg.voice?.file_id ?? null,
      processing_status: "needs_review",
      classification: { note: "voice message — awaiting transcription" },
    });
    await sendMessage(
      token,
      msg.chat.id,
      sttConfigured()
        ? "Voice note saved for review — transcription failed."
        : "Voice note saved. Set STT_PROVIDER=openai + OPENAI_API_KEY to enable transcription.",
      { reply_to_message_id: msg.message_id },
    );
    return NextResponse.json({ ok: true });
  }

  // 5. Text → capture pipeline.
  const text = extractText(msg);
  if (!text) {
    // Photo/document without caption — persist for review.
    await supabase.from("raw_ingestion_events").insert({
      user_id: profile.id,
      source: "telegram",
      content_type: cType,
      raw_content: `[${cType}]`,
      storage_path: cType === "photo" ? msg.photo?.[msg.photo.length - 1]?.file_id : msg.document?.file_id,
      processing_status: "needs_review",
    });
    await sendMessage(token, msg.chat.id, "File saved for review.", {
      reply_to_message_id: msg.message_id,
    });
    return NextResponse.json({ ok: true });
  }

  const result = await runCapturePipeline({ text, source: "telegram", supabase, userId: profile.id });

  let reply: string;
  if (result.status === "created") {
    reply = `<b>${result.classified.kind}</b> created: ${escapeHtml(result.classified.title)}`;
  } else if (result.status === "review") {
    reply = `Saved for review (confidence ${(result.classified.confidence * 100).toFixed(0)}%).`;
  } else {
    reply = `Error: ${escapeHtml(result.error)}`;
  }
  await sendMessage(token, msg.chat.id, reply, {
    reply_to_message_id: msg.message_id,
  });

  return NextResponse.json({ ok: true });
}
