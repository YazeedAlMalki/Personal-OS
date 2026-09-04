import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { journalCreate } from "@/lib/security/validation";
import { listJournalEntries, createJournalEntry } from "@/lib/domains/journal";
import { audit } from "@/lib/security/audit";
import { rememberText } from "@/lib/memory";

export async function GET() {
  const supabase = await createClient();
  try {
    const data = await listJournalEntries(supabase);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/journal]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = journalCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createJournalEntry(supabase, parsed.data);
    // Journal is the richest memory corpus — make it searchable (best-effort).
    await rememberText(supabase, {
      text: parsed.data.raw_text,
      sourceType: "journal_entries",
      sourceId: data.id,
    });
    await audit(supabase, {
      action: "insert",
      table_name: "journal_entries",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/journal]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
