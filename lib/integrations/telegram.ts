import "server-only";

// Telegram Bot API helpers. Used by both the webhook route and the long-poller.
// Self-host note (§12.1): long-polling is the default ingress — no public URL needed.

const API = "https://api.telegram.org/bot";

// ---- Types for the subset of the Telegram Bot API we use --------------------

export type TelegramUser = { id: number; first_name?: string; username?: string };
export type TelegramChat = { id: number; type: string };
export type TelegramVoice = { file_id: string; duration: number; mime_type?: string };
export type TelegramPhoto = { file_id: string; width: number; height: number };
export type TelegramDocument = { file_id: string; file_name?: string; mime_type?: string };

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: TelegramVoice;
  photo?: TelegramPhoto[];
  document?: TelegramDocument;
  caption?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

// ---- Bot API calls ----------------------------------------------------------

function url(token: string, method: string): string {
  return `${API}${token}/${method}`;
}

// Escape user-controlled text before interpolating into parse_mode:"HTML"
// messages — unescaped < > & makes Telegram reject the whole sendMessage (400).
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  opts?: { reply_to_message_id?: number; parse_mode?: string },
): Promise<void> {
  const res = await fetch(url(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts?.parse_mode ?? "HTML",
      reply_to_message_id: opts?.reply_to_message_id,
    }),
  });
  // Never swallow a failed POST (V1 bug #3). Reply failures must not crash the
  // webhook (Telegram would retry → duplicate captures), but they must be loud.
  if (!res.ok) {
    console.error(`[telegram] sendMessage failed ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

export async function getUpdates(
  token: string,
  offset: number,
  timeoutSec = 30,
): Promise<TelegramUpdate[]> {
  const res = await fetch(url(token, "getUpdates"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message"],
    }),
  });
  if (!res.ok) throw new Error(`getUpdates ${res.status}`);
  const json = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
  return json.result ?? [];
}

export async function getFileUrl(token: string, fileId: string): Promise<string> {
  const res = await fetch(url(token, "getFile"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) throw new Error(`getFile ${res.status}`);
  const json = (await res.json()) as { result?: { file_path?: string } };
  const path = json.result?.file_path;
  if (!path) throw new Error("no file_path in getFile response");
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const fileUrl = await getFileUrl(token, fileId);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Delete webhook so long-polling works (Telegram rejects getUpdates while a
// webhook is set). Call this once during setup.
export async function deleteWebhook(token: string): Promise<void> {
  await fetch(url(token, "deleteWebhook"), { method: "POST" });
}

// Set webhook for the cloud/public-URL deployment path.
export async function setWebhook(
  token: string,
  webhookUrl: string,
  secret: string,
): Promise<void> {
  await fetch(url(token, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
}

// ---- Message text extraction ------------------------------------------------

/** Extract the text content from a Telegram message (text, caption, or null). */
export function extractText(msg: TelegramMessage): string | null {
  return msg.text ?? msg.caption ?? null;
}

/** Determine the content_type for raw_ingestion_events. */
export function contentType(msg: TelegramMessage): string {
  if (msg.voice) return "audio";
  if (msg.photo && msg.photo.length > 0) return "photo";
  if (msg.document) return "file";
  return "text";
}

// ---- Security: sender verification ------------------------------------------

/** True if the sender matches the configured owner. */
export function isAuthorizedSender(msg: TelegramMessage, allowedId: string): boolean {
  return String(msg.from?.id) === allowedId;
}
