// Pure parsing/extraction: no "server-only" import so it's unit-testable
// (matches the health.ts / health-auto-export.ts convention). The Google
// fetch + Supabase write live in finance-sheet-sync.ts instead.
import ExcelJS from "exceljs";
import type { FinanceSnapshotCreate } from "@/lib/security/validation";

// Google Sheets finance auto-pull (architecture §12.6). Deterministic-first
// (P1 — the core never depends on an LLM being configured): scans a workbook
// for labeled rows ("Net Worth", "Total Assets", ...) and reads the adjacent
// numeric cell. No AI call in this file. If the sheet doesn't parse cleanly,
// the caller parks a review_queue item instead of writing a guessed snapshot
// (P3) — nothing here silently invents a number.

export function sheetIngestConfigured(): boolean {
  return (
    !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY &&
    !!process.env.GOOGLE_SHEETS_FINANCE_ID
  );
}

export type SheetTabs = Record<string, (string | number | null)[][]>;

// Every tab, every cell, as plain values — formulas resolved to their last
// computed result. Capped at 500 rows/tab so a huge history tab can't blow
// up memory or the extractor below.
export async function parseAllTabs(xlsx: Buffer): Promise<SheetTabs> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  const tabs: SheetTabs = {};
  wb.worksheets.forEach((ws) => {
    const rows: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const r: (string | number | null)[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        if (v === null || v === undefined) r.push(null);
        else if (typeof v === "number" || typeof v === "string") r.push(v);
        else if (typeof v === "object" && "result" in (v as object)) {
          r.push((v as { result?: number }).result ?? null);
        } else {
          r.push(String(v));
        }
      });
      rows.push(r);
    });
    tabs[ws.name] = rows.slice(0, 500);
  });
  return tabs;
}

// --- 2. Extract (pure, deterministic, unit-testable) ---------------------

export interface FinanceExtraction {
  snapshot: Partial<FinanceSnapshotCreate>;
  confidence: number; // 0..1 — see scoring notes below
  matched: string[]; // which fields were found, for the review-queue reason
  notes: string;
}

type FieldKey =
  | "net_worth"
  | "assets"
  | "liabilities"
  | "income_month_to_date"
  | "expenses_month_to_date"
  | "investment_value"
  | "cash_balance";

// Label patterns, most-specific first so e.g. "Total Assets" doesn't get
// mistaken for a liabilities row. Tune these once the real sheet layout is
// known — this is the one part of the extractor that's sheet-shape-specific.
const FIELD_PATTERNS: Array<[FieldKey, RegExp]> = [
  ["net_worth", /net\s*worth/i],
  ["liabilities", /liabilit/i],
  ["assets", /^(total\s+)?assets?\b/i],
  ["investment_value", /invest(ment)?s?\b/i],
  ["cash_balance", /\bcash\b/i],
  ["income_month_to_date", /\bincome\b/i],
  ["expenses_month_to_date", /\bexpense/i],
];

const CURRENCY_RE = /\b(USD|EUR|SAR|GBP|AED|CAD|AUD)\b/;

function firstNumber(cells: (string | number | null)[]): number | null {
  for (const c of cells) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string") {
      const cleaned = c.replace(/[,$\s]/g, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
    }
  }
  return null;
}

// Prefer a tab that looks like a summary/overview; fall back to scanning
// every tab if none is obviously the summary (some workbooks are one flat
// sheet). Per-category tabs (one tab per account) aren't handled here —
// that needs a real layout to design against; see docs/finance-integration-plan.md.
function pickCandidateTabs(tabs: SheetTabs): string[] {
  const names = Object.keys(tabs);
  const summary = names.filter((n) => /summary|overview|net\s*worth|dashboard/i.test(n));
  return summary.length > 0 ? summary : names;
}

export function extractSnapshotDeterministic(tabs: SheetTabs): FinanceExtraction {
  const found: Partial<Record<FieldKey, number>> = {};
  const matched: string[] = [];
  let currency: string | undefined;

  for (const tabName of pickCandidateTabs(tabs)) {
    const rows = tabs[tabName] ?? [];
    for (const row of rows) {
      const label = row.find((c) => typeof c === "string" && c.trim().length > 0) as string | undefined;
      if (!label) continue;
      if (!currency) {
        const m = label.match(CURRENCY_RE);
        if (m) currency = m[1];
      }
      for (const [field, pattern] of FIELD_PATTERNS) {
        if (field in found) continue; // first match wins across tabs
        if (pattern.test(label)) {
          const labelIdx = row.indexOf(label);
          const value = firstNumber(row.slice(labelIdx + 1));
          if (value !== null) {
            found[field] = value;
            matched.push(field);
          }
          break;
        }
      }
    }
  }

  // Derive net_worth from assets - liabilities if not stated directly.
  if (found.net_worth === undefined && found.assets !== undefined && found.liabilities !== undefined) {
    found.net_worth = round2(found.assets - found.liabilities);
    matched.push("net_worth(derived)");
  }

  // Confidence: start from how much we found, then dock it if the numbers
  // don't reconcile (a strong deterministic-only sanity check, no model).
  let confidence = 0;
  if (found.net_worth !== undefined) confidence += 0.5;
  if (found.assets !== undefined) confidence += 0.15;
  if (found.liabilities !== undefined) confidence += 0.15;
  if (found.cash_balance !== undefined) confidence += 0.05;
  if (found.investment_value !== undefined) confidence += 0.05;
  if (found.income_month_to_date !== undefined) confidence += 0.05;
  if (found.expenses_month_to_date !== undefined) confidence += 0.05;
  confidence = Math.min(1, confidence);

  let notes = "";
  if (
    found.net_worth !== undefined &&
    found.assets !== undefined &&
    found.liabilities !== undefined
  ) {
    const expected = round2(found.assets - found.liabilities);
    const drift = Math.abs(expected - found.net_worth);
    if (drift > Math.max(1, Math.abs(expected) * 0.02)) {
      confidence = Math.min(confidence, 0.4);
      notes = `assets(${found.assets}) - liabilities(${found.liabilities}) = ${expected}, but sheet's net worth reads ${found.net_worth} — flagged, not auto-corrected.`;
    }
  }
  if (found.net_worth === undefined) {
    notes = notes || "No 'net worth' row found and assets/liabilities weren't both present to derive one.";
  }

  return {
    snapshot: {
      net_worth: found.net_worth,
      assets: found.assets,
      liabilities: found.liabilities,
      income_month_to_date: found.income_month_to_date,
      expenses_month_to_date: found.expenses_month_to_date,
      investment_value: found.investment_value,
      cash_balance: found.cash_balance,
      currency: currency ?? "USD",
    },
    confidence,
    matched,
    notes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

