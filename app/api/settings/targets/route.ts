import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { targetsUpdate } from "@/lib/security/validation";

// GET/PATCH the user's profile.targets jsonb. Used by the Health settings UI
// to tune step/sleep/protein goals that drive recovery/activity/nutrition scores.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("targets")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ targets: data?.targets ?? {} });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = targetsUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Merge into existing JSON so partial PATCHes don't blow away other keys.
  const { data: current } = await supabase.from("profiles").select("targets").single();
  const merged = { ...(current?.targets ?? {}), ...parsed.data };

  // RLS scopes profiles to id = auth.uid(), so an unfiltered update only touches
  // this user's row.
  const { data: user } = await supabase.auth.getUser();
  if (!user.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { error } = await supabase
    .from("profiles")
    .update({ targets: merged })
    .eq("id", user.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ targets: merged });
}
