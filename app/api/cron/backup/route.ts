import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { buildExport, totalRows } from "@/lib/domains/export";
import { githubBackupConfig, pushBackup } from "@/lib/integrations/github-backup";

// POST /api/cron/backup — nightly off-site backup. For each user, builds a full
// export and pushes it to the configured private GitHub repo. Also records an
// `exports` bookkeeping row. No-op (200) if GitHub backup isn't configured.
//
// Auth: Bearer ${CRON_SECRET}.
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretEquals(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cfg = githubBackupConfig();
  if (!cfg) {
    return NextResponse.json({ skipped: "GitHub backup not configured" });
  }

  const supabase = createServiceClient();
  const { data: profiles, error } = await supabase.from("profiles").select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const results: { user: string; ok: boolean; rows?: number; commit?: string; error?: string }[] = [];

  for (const p of (profiles ?? []) as { id: string }[]) {
    try {
      const file = await buildExport(supabase, p.id);
      const json = JSON.stringify(file);
      const pushed = await pushBackup(cfg, `${p.id}/${day}.json`, json);
      await supabase.from("exports").insert({
        user_id: p.id,
        kind: "full",
        storage_path: `github:${cfg.repo}/${pushed.path}`,
        row_counts: file.row_counts,
        status: "success",
      });
      results.push({ user: p.id, ok: true, rows: totalRows(file), commit: pushed.commit });
    } catch (e) {
      const message = e instanceof Error ? e.message : "backup failed";
      await supabase.from("exports").insert({
        user_id: p.id,
        kind: "full",
        storage_path: null,
        row_counts: {},
        status: "failed",
      });
      results.push({ user: p.id, ok: false, error: message });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ users: results.length, failed, results }, { status: failed ? 207 : 200 });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
