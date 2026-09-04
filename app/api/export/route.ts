import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildExport, totalRows } from "@/lib/domains/export";
import { audit } from "@/lib/security/audit";
import { rateLimitResponse } from "@/lib/security/ratelimit";

// GET /api/export — download a full JSON backup of everything you own.
// Runs through the authenticated (RLS-scoped) client, so it can only ever read
// the caller's own rows. Records an `exports` bookkeeping row + an audit entry.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // A full export is heavy — cap at 5/min/user.
  const limited = rateLimitResponse(`export:${user.id}`, { capacity: 5, windowMs: 60_000 });
  if (limited) return limited;

  const file = await buildExport(supabase, user.id);

  await supabase.from("exports").insert({
    kind: "full",
    storage_path: null,
    row_counts: file.row_counts,
    status: "success",
  });
  await audit(supabase, {
    action: "export",
    table_name: "*",
    new_value: { rows: totalRows(file) },
    source: "web",
  });

  const filename = `personal-os-export-${file.exported_at.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(file), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
