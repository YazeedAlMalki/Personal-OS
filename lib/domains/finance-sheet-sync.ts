import "server-only";
import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeSnapshotCreate } from "@/lib/security/validation";
import { upsertFinanceSnapshot } from "@/lib/domains/finance";
import {
  parseAllTabs,
  extractSnapshotDeterministic,
  sheetIngestConfigured,
} from "@/lib/domains/finance-sheet";

// --- 1. Fetch -----------------------------------------------------------

// Exports the configured Sheet as .xlsx via a read-only service account
// (never "publish to web" — §12.6). Ported from the V1 prototype
// (`Documents/Claude/personal-os/app/api/finance/snapshot/route.ts`), same
// mechanics, no AI step attached.
export async function downloadSheetAsXlsx(): Promise<Buffer> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  const fileId = process.env.GOOGLE_SHEETS_FINANCE_ID;
  if (!email || !key || !fileId) {
    throw new Error("Google Sheets env vars missing (GOOGLE_SERVICE_ACCOUNT_EMAIL/_KEY, GOOGLE_SHEETS_FINANCE_ID)");
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.export(
    { fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// Orchestration: touches env secrets (service-account key) and does the
// Supabase write, so this stays server-only while lib/domains/finance-sheet.ts
// (parsing + the deterministic extractor) stays plain and unit-testable.

// --- 3. Orchestrate --------------------------------------------------------

// Confidence at/above this writes directly to finance_snapshots; below it
// parks a review_queue item instead (mirrors CONFIDENCE_THRESHOLD in
// lib/ingestion/pipeline.ts — same P3 gate, different domain).
export const FINANCE_CONFIDENCE_THRESHOLD = 0.6;

function todayInUserTimezone(): string {
  const tz = process.env.USER_TIMEZONE || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type FinanceSnapshotRunResult =
  | { status: "written"; date: string; confidence: number; matched: string[] }
  | { status: "review"; confidence: number; matched: string[]; notes: string }
  | { status: "not_configured" };

export async function runFinanceSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinanceSnapshotRunResult> {
  if (!sheetIngestConfigured()) return { status: "not_configured" };

  const xlsx = await downloadSheetAsXlsx();
  const tabs = await parseAllTabs(xlsx);
  const extraction = extractSnapshotDeterministic(tabs);
  const date = todayInUserTimezone();

  if (extraction.confidence >= FINANCE_CONFIDENCE_THRESHOLD && extraction.snapshot.net_worth !== undefined) {
    const parsed = financeSnapshotCreate.safeParse({
      date,
      ...extraction.snapshot,
      source: "gsheet",
      notes: extraction.notes || undefined,
    });
    if (parsed.success) {
      await upsertFinanceSnapshot(supabase, parsed.data);
      return { status: "written", date, confidence: extraction.confidence, matched: extraction.matched };
    }
    // Validation failed even though extraction looked confident — treat like
    // low confidence rather than throw (P3: never silently drop, never guess).
  }

  await supabase.from("review_queue").insert({
    user_id: userId,
    proposed_table: "finance_snapshots",
    proposed_record: { date, ...extraction.snapshot, source: "gsheet" },
    reason: "low_confidence_finance_extraction",
    confidence: extraction.confidence,
  });
  return {
    status: "review",
    confidence: extraction.confidence,
    matched: extraction.matched,
    notes: extraction.notes,
  };
}
