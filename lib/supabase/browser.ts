import { createBrowserClient } from "@supabase/ssr";

// Browser client — bound by RLS via the anon key. Safe to use in client components.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
