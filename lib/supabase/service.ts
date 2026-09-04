import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/config";

// Service-role client — BYPASSES RLS. Server-only, trusted contexts only
// (webhooks, cron, export/import). NEVER import into a client component.
// When acting on behalf of a user, always set user_id explicitly.
export function createServiceClient() {
  const env = serverEnv(); // validated once — misconfig fails fast and loud
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
