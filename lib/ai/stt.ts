import "server-only";

// Speech-to-text adapter (§12.2). Env-gated like everything else in the AI layer:
//   STT_PROVIDER=openai  + OPENAI_API_KEY        → Whisper API
//   STT_PROVIDER=local   + STT_BASE_URL          → any OpenAI-compatible transcription
//                          server on the homelab (faster-whisper-server, whisper.cpp
//                          server, LocalAI). LOCAL_AI_TOKEN is sent as a bearer token
//                          when set, for the homelab tunnel. STT_MODEL overrides the model.
//   STT_PROVIDER=none / unset                    → transcription unavailable (voice
//                          notes park in the review queue)

function sttProvider(): string {
  return (process.env.STT_PROVIDER ?? "none").toLowerCase();
}

export function sttConfigured(): boolean {
  const p = sttProvider();
  if (p === "openai") return !!process.env.OPENAI_API_KEY;
  if (p === "local") return !!process.env.STT_BASE_URL;
  return false;
}

function transcriptionUrl(): string {
  if (sttProvider() !== "local") return "https://api.openai.com/v1/audio/transcriptions";
  // Accept the base with or without a trailing /v1 or slash.
  const base = process.env.STT_BASE_URL!.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${base}/v1/audio/transcriptions`;
}

// Returns the transcript, or null when STT is unconfigured/failed — callers
// fall back to parking the voice note for review. Never throws.
export async function transcribeAudio(
  audio: ArrayBuffer,
  filename = "voice.ogg",
): Promise<string | null> {
  if (!sttConfigured()) return null;
  const local = sttProvider() === "local";
  const token = local ? process.env.LOCAL_AI_TOKEN : process.env.OPENAI_API_KEY;
  try {
    const form = new FormData();
    form.append("file", new Blob([audio]), filename);
    form.append("model", local ? (process.env.STT_MODEL ?? "whisper-1") : "whisper-1");
    const res = await fetch(transcriptionUrl(), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      console.error(`[stt] transcription failed ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    const json = (await res.json()) as { text?: string };
    const text = json.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (e) {
    console.error("[stt] transcription error:", e);
    return null;
  }
}
