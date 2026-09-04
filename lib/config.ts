import "server-only";
import { z } from "zod";

// Validate server environment once, lazily. Never import this from a client component.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  USER_TIMEZONE: z.string().default("UTC"),
  AI_PROVIDER: z.enum(["local", "anthropic", "openai", "hybrid"]).default("local"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  LOCAL_CHAT_MODEL: z.string().default("llama3.1:8b"),
  LOCAL_EMBED_MODEL: z.string().default("nomic-embed-text"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // §12.2 STT (optional — voice notes park for review when unset)
  STT_PROVIDER: z.enum(["none", "local", "openai"]).default("none"),
  // Phase 3: Telegram (optional — app works without them)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_USER_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // Phase 4: Cron auth
  CRON_SECRET: z.string().optional(),
  // Phase 5: iPhone health ingress
  HEALTHKIT_INGEST_SECRET: z.string().optional(),
  // §12.5 read-only calendar feed (any iCal/ICS URL — Google, Outlook, iCloud)
  CALENDAR_ICS_URL: z.string().url().optional(),
  GOOGLE_CALENDAR_ICAL_URL: z.string().url().optional(),
  // Phase 8: off-site GitHub backup (all optional — backup no-ops if unset)
  GITHUB_BACKUP_TOKEN: z.string().optional(),
  GITHUB_BACKUP_REPO: z.string().optional(),
  GITHUB_BACKUP_BRANCH: z.string().optional(),
  GITHUB_BACKUP_DIR: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Invalid environment variables: " +
        JSON.stringify(parsed.error.flatten().fieldErrors),
    );
  }
  cached = parsed.data;
  return cached;
}

// Embedding dimension MUST match supabase migration memory_chunks.embedding vector(N).
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 768);
