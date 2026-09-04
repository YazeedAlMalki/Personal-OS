import { describe, it, expect } from "vitest";
import { extractSnapshotDeterministic, type SheetTabs } from "@/lib/domains/finance-sheet";

describe("extractSnapshotDeterministic", () => {
  it("reads a clean Summary tab", () => {
    const tabs: SheetTabs = {
      Summary: [
        ["Personal Net Worth", null],
        ["Net Worth", 125000, "USD"],
        ["Total Assets", 160000],
        ["Total Liabilities", 35000],
        ["Cash", 20000],
        ["Investments", 90000],
        ["Income (MTD)", 8000],
        ["Expenses (MTD)", 4200],
      ],
      History: [["2026-01-01", 100000], ["2026-02-01", 110000]],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.snapshot.net_worth).toBe(125000);
    expect(result.snapshot.assets).toBe(160000);
    expect(result.snapshot.liabilities).toBe(35000);
    expect(result.snapshot.cash_balance).toBe(20000);
    expect(result.snapshot.investment_value).toBe(90000);
    expect(result.snapshot.income_month_to_date).toBe(8000);
    expect(result.snapshot.expenses_month_to_date).toBe(4200);
    expect(result.snapshot.currency).toBe("USD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("derives net worth from assets minus liabilities when not stated directly", () => {
    const tabs: SheetTabs = {
      Overview: [
        ["Total Assets", 50000],
        ["Total Liabilities", 10000],
      ],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.snapshot.net_worth).toBe(40000);
    expect(result.matched).toContain("net_worth(derived)");
  });

  it("flags low confidence when assets/liabilities don't reconcile with the stated net worth", () => {
    const tabs: SheetTabs = {
      Summary: [
        ["Net Worth", 999999],
        ["Total Assets", 50000],
        ["Total Liabilities", 10000],
      ],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.notes).toMatch(/flagged/i);
  });

  it("returns low confidence and no net worth on an unrecognizable sheet", () => {
    const tabs: SheetTabs = {
      Sheet1: [
        ["Random column A", "Random column B"],
        ["foo", 1],
        ["bar", 2],
      ],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.snapshot.net_worth).toBeUndefined();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("prefers a tab that looks like a summary over a per-category tab", () => {
    const tabs: SheetTabs = {
      Brokerage: [["Total Liabilities", 999]], // decoy — wrong tab, would poison the read
      Summary: [
        ["Net Worth", 75000],
        ["Total Assets", 80000],
        ["Total Liabilities", 5000],
      ],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.snapshot.net_worth).toBe(75000);
    expect(result.snapshot.liabilities).toBe(5000);
  });

  it("parses currency-formatted strings", () => {
    const tabs: SheetTabs = {
      Summary: [
        ["Net Worth", "$125,000.50"],
        ["Total Assets", "160,000"],
      ],
    };
    const result = extractSnapshotDeterministic(tabs);
    expect(result.snapshot.net_worth).toBe(125000.5);
    expect(result.snapshot.assets).toBe(160000);
  });
});
