import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { restoreExport, type ExportFile } from "@/lib/domains/export";
import { audit } from "@/lib/security/audit";
import { readJsonCapped, IMPORT_MAX_BYTES } from "@/lib/security/http";

// POST /api/import — restore a JSON backup into the caller's account.
// Every row's user_id is remapped to the authenticated user, so a backup can be
// restored under any account. Existing rows with the same id will collide — intended
// for restoring into an empty/fresh project. Runs RLS-scoped (no service role): the
// insert policy guarantees rows can only be written for the caller.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const read = await readJsonCapped<ExportFile | null>(request, IMPORT_MAX_BYTES);
  if (!read.ok) return read.response;
  const file = read.body;
  if (!file || typeof file !== "object" || !("tables" in file) || !("version" in file)) {
    return NextResponse.json({ error: "invalid export file" }, { status: 400 });
  }

  let result;
  try {
    result = await restoreExport(supabase, user.id, file);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "restore failed" },
      { status: 400 },
    );
  }

  await audit(supabase, {
    action: "import",
    table_name: "*",
    new_value: { total: result.total, errors: result.errors.length },
    source: "web",
  });

  const ok = result.errors.length === 0;
  return NextResponse.json(result, { status: ok ? 200 : 207 });
}
