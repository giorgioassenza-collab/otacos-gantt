// All fixtures are SYNTHETIC (see fixtures.ts). fetch is always mocked: no real network calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_MISSING_TAB_SENTINEL,
  aggregateBudget,
  budgetCategoryFromHeader,
  budgetCurrency,
  budgetCsvUrl,
  budgetMonthKey,
  budgetMonthLabelFromName,
  budgetMonthLabelFromSheetName,
  budgetMonthSortValue,
  budgetSheetNames,
  budgetSheetNamesFor,
  budgetSummaryFromTransactions,
  budgetTabUrl,
  budgetTitleFromSheets,
  budgetTodayBalance,
  loadBudget,
  loadBudgetFromCsvTabs,
  loadBudgetFromWorkbook,
  budgetFromSheetRows,
  looksLikeZip,
  createBudgetRequest,
  loadBudgetOfficialSummary,
  loadBudgetCsvSheets,
  parseBudgetAmount,
  parseBudgetRows,
  parseBudgetTotals,
  parseBudgetOfficialSummary,
  parseCsv,
  uniqueSortedBudgetValues
} from "../budget";
import { headerOnlyCsv, officialTotalRows, officialTotalTabCsv, liveHeaders0Csv, liveHeaders0NoTitleCsv, monthTabCsv, monthTabRows, secondMonthCsv, summaryTabCsv, toCsv, totalsRows } from "./fixtures";
import { csvResponse, htmlResponse, mockFetch, tabNameOf, textStatus, type Router } from "./helpers";

/** Fast CSV-path options for tests: no real wait before the single retry. */
const FAST = { retryDelayMs: 0 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas, CRLF and blank lines", () => {
    const csv = 'a,"b, ""quoted""",c\r\n\r\n,,\r\nx,y,z';
    expect(parseCsv(csv)).toEqual([["a", 'b, "quoted"', "c"], ["x", "y", "z"]]);
  });

  it("keeps newlines inside quoted cells and returns [] for empty input", () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([["line1\nline2", "b"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("parseBudgetAmount / budgetCurrency", () => {
  it.each([
    ["€ 1.234,50", 1234.5],
    ["€ 1.234", 1.234], // a lone dot is a decimal point, exactly like the original
    ["1,234.56", 1234.56],
    ["1,234", 1234],
    ["1,5", 1.5],
    ["€ 300", 300],
    ["-€ 12,5", -12.5],
    ["", 0],
    ["n/a", 0],
    [undefined, 0],
    [42, 42]
  ])("parses %j as %j", (input, expected) => {
    expect(parseBudgetAmount(input)).toBe(expected);
  });

  it("formats whole euros with the Italian locale", () => {
    expect(budgetCurrency(1234567)).toMatch(/^1\.234\.567\s€$/);
    expect(budgetCurrency(0)).toMatch(/^0\s€$/);
    expect(budgetCurrency(null)).toMatch(/^0\s€$/);
    expect(budgetCurrency(99.6)).toMatch(/^100\s€$/);
    expect(budgetCurrency(5527)).toMatch(/^5\.527\s€$/); // grouped from 4 digits, unlike plain it-IT
  });
});

describe("month helpers", () => {
  it("derives 'Mon YYYY' from tab names, English and Italian", () => {
    expect(budgetMonthLabelFromSheetName("AUG26")).toBe("Aug 2026");
    expect(budgetMonthLabelFromSheetName("JULY26")).toBe("Jul 2026");
    expect(budgetMonthLabelFromSheetName("GIU26")).toBe("Jun 2026");
    expect(budgetMonthLabelFromSheetName("dic25")).toBe("Dec 2025");
    expect(budgetMonthLabelFromSheetName("Current tab")).toBe("");
    expect(budgetMonthLabelFromSheetName("")).toBe("");
  });

  it("budgetMonthKey prefers the tab month, then the date cell, then 'No date'", () => {
    expect(budgetMonthKey("2025-01-15", "AUG26")).toBe("Aug 2026");
    expect(budgetMonthKey("2026-03-15", "Current tab")).toBe("Mar 2026");
    expect(budgetMonthKey("", "Current tab")).toBe("No date");
    expect(budgetMonthKey("not a date", "")).toBe("No date");
  });

  it("sorts months chronologically with unknown values last", () => {
    const months = ["Mar 2026", "No date", "Dec 2025", "Jan 2026", "Jul 2025"];
    expect([...months].sort((a, b) => budgetMonthSortValue(a) - budgetMonthSortValue(b)))
      .toEqual(["Jul 2025", "Dec 2025", "Jan 2026", "Mar 2026", "No date"]);
    expect(budgetMonthSortValue("Sep 2025")).toBe(2025 * 12 + 8);
  });

  it("maps TOTAL-tab row labels to the contract year, leaving unknown labels alone", () => {
    expect(budgetMonthLabelFromName("JULY")).toBe("Jul 2025");
    expect(budgetMonthLabelFromName(" january ")).toBe("Jan 2026");
    expect(budgetMonthLabelFromName("EXTRA")).toBe("EXTRA");
  });

  it("orders months and sheets for the filters", () => {
    const rows = [
      { month: "Mar 2026", sheet: "MAR26" },
      { month: "Dec 2025", sheet: "DEC25" },
      { month: "Dec 2025", sheet: "ZZZ" },
      { month: "No date", sheet: "AUG26" }
    ];
    expect(uniqueSortedBudgetValues(rows, "month")).toEqual(["Dec 2025", "Mar 2026", "No date"]);
    // known tabs follow budgetSheetNames order (AUG26 first, DEC25 later); unknown tabs go last
    expect(uniqueSortedBudgetValues(rows, "sheet")).toEqual(["AUG26", "MAR26", "DEC25", "ZZZ"]);
  });
});

describe("parseBudgetRows (synthetic month tab)", () => {
  const parsed = parseBudgetRows(parseCsv(monthTabCsv), "AUG26");

  it("reads every block with the right category", () => {
    expect(parsed.title).toBe("AUG26");
    const byCategory = (name: string) => parsed.transactions.filter((t) => t.category === name);
    expect(byCategory("Events").map((t) => t.what)).toEqual(['Banner, "large"', "Catering"]);
    expect(byCategory("Influencer").map((t) => t.what)).toEqual(["Reel", "Story"]);
    expect(byCategory("Media").map((t) => t.what)).toEqual(["META", "TIKTOK"]);
    expect(byCategory("General").map((t) => t.what)).toEqual(["Agency fee"]);
    expect(parsed.transactions).toHaveLength(7);
  });

  it("skips total lines, zero amounts and rows without an amount", () => {
    expect(parsed.transactions.some((t) => /totale/i.test(t.what))).toBe(false);
    expect(parsed.transactions.some((t) => t.what === "Empty amount row")).toBe(false);
  });

  it("keeps raw date/why/what, numeric amounts, and the tab month", () => {
    expect(parsed.transactions[0]).toEqual({
      sheet: "AUG26",
      category: "Events",
      date: "2026-08-03",
      why: "Store opening",
      what: 'Banner, "large"',
      amount: 1234.5,
      month: "Aug 2026"
    });
    expect(new Set(parsed.transactions.map((t) => t.month))).toEqual(new Set(["Aug 2026"]));
    expect(parsed.transactions.find((t) => t.what === "Story")?.date).toBe("");
  });

  it("separates the forecast block (what + amount only, zero amounts dropped)", () => {
    expect(parsed.forecast).toEqual([{ what: "Next month media", amount: 3500 }]);
    expect(parsed.transactions.map((t) => t.what)).not.toContain("Next month media");
  });

  it("falls back to the date cell for the month when the tab name has none", () => {
    const current = parseBudgetRows(parseCsv(monthTabCsv), "Current tab");
    expect(current.transactions[0].month).toBe("Aug 2026");
    expect(current.transactions.find((t) => t.what === "Reel")?.month).toBe("Aug 2026");
    expect(current.transactions.find((t) => t.what === "Story")?.month).toBe("No date");
  });

  it("uses the first non-empty cell as the title when no sheet name is given", () => {
    expect(parseBudgetRows([["", "Quarterly"], ["x"]]).title).toBe("Quarterly");
    expect(parseBudgetRows([]).title).toBe("Budget");
  });

  it("returns nothing for a tab without DATE/WHAT headers", () => {
    const empty = parseBudgetRows(parseCsv(summaryTabCsv), "X");
    expect(empty.transactions).toEqual([]);
    expect(empty.forecast).toEqual([]);
  });

  it("a DATE header with an empty fourth cell is still a header when WHY and WHAT follow (relaxed rule)", () => {
    const rows = [
      ["MEDIA", "", "", ""],
      ["DATE", "WHY", "WHAT", "€"],
      ["", "a", "b", "€ 10"],
      ["GENERAL", "", "", ""],
      ["DATE", "WHY", "WHAT", ""], // no amount header, as in the live gviz &headers=0 output
      ["", "fee", "agency", "€ 20"]
    ];
    const result = parseBudgetRows(rows, "MAY26");
    expect(result.transactions.map((t) => [t.category, t.what, t.amount])).toEqual([["Media", "b", 10], ["General", "agency", 20]]);
  });

  it("original rule kept: a DATE cell with an empty fourth cell and no WHY/WHAT after it is not a header", () => {
    const rows = [
      ["MEDIA", "", "", ""],
      ["DATE", "WHY", "WHAT", "€"],
      ["", "a", "b", "€ 10"],
      ["GENERAL", "", "", ""],
      ["DATE", "x", "y", ""],
      ["", "fee", "agency", "€ 20"]
    ];
    const result = parseBudgetRows(rows, "MAY26");
    expect(result.transactions.map((t) => [t.category, t.what, t.amount])).toEqual([["Media", "b", 10], ["Media", "agency", 20]]);
  });

  describe("live gviz &headers=0 shape (synthetic)", () => {
    const parsed = parseBudgetRows(parseCsv(liveHeaders0Csv), "SEP26");
    const rowsOf = (category: string) => parsed.transactions.filter((t) => t.category === category).map((t) => [t.what, t.amount]);

    it("reads blocks whose DATE label and title were dropped by gviz, skipping the totale row", () => {
      expect(rowsOf("Events")).toEqual([["Synth stickers", 99.99]]);
      // INFLUENCER title and DATE label are blank: header is just "" | WHY | WHAT, category from the column order
      expect(rowsOf("Influencer")).toEqual([["Reel", 1200], ["Story", 350.5]]);
      expect(rowsOf("Media")).toEqual([["META", 2000], ["TikTok", 800]]);
      // blank header under the media block (second header in that column) is the GENERAL buffer block
      expect(rowsOf("General")).toEqual([["Agency fee", 500]]);
      expect(parsed.transactions).toHaveLength(6);
      expect(parsed.transactions.some((t) => /totale/i.test(t.what))).toBe(false);
      expect(new Set(parsed.transactions.map((t) => t.month))).toEqual(new Set(["Sep 2026"]));
      expect(parsed.transactions.find((t) => t.what === "Reel")?.date).toBe("01/09/2026");
    });

    it("reads the BUDGET FORECAST block and ignores the stray legend words in its column", () => {
      expect(parsed.forecast).toEqual([{ what: "Synthetic forecast line", amount: 700 }]);
    });

    it("falls back to the fixed column order when every title is missing, and a repeated header is GENERAL", () => {
      const result = parseBudgetRows(parseCsv(liveHeaders0NoTitleCsv), "NOV25");
      expect(result.transactions.map((t) => [t.category, t.what, t.amount])).toEqual([
        ["Events", "Synth item", 10],
        ["Influencer", "Creator C", 20],
        ["Media", "META", 30],
        ["General", "Agency fee", 40]
      ]);
      expect(result.forecast).toEqual([]);
    });

    it("a WHY | WHAT pair is never mistaken for a forecast block", () => {
      const rows = [["", "WHY", "WHAT", "€"], ["", "a", "b", "€ 5"]];
      const result = parseBudgetRows(rows, "X");
      expect(result.forecast).toEqual([]);
      expect(result.transactions.map((t) => t.what)).toEqual(["b"]);
    });
  });

  it("budgetCategoryFromHeader looks up to four rows above, defaults to General", () => {
    const rows = [["INFLUENCER (x)"], [""], [""], ["Custom (note)"], ["DATE"]];
    expect(budgetCategoryFromHeader(rows, 4, 0)).toBe("Custom");
    expect(budgetCategoryFromHeader([["DATE"]], 0, 0)).toBe("General");
    expect(budgetCategoryFromHeader([["INFLUENCER x"], [""], [""], [""], [""], ["DATE"]], 5, 0)).toBe("General"); // five rows up: out of reach
  });
});

describe("totals, aggregates and summary", () => {
  it("parseBudgetTotals reads the TOTAL tab by header names", () => {
    const totals = parseBudgetTotals(totalsRows);
    expect(totals).not.toBeNull();
    expect(totals!.totalExpenses).toBe(390);
    expect(totals!.totalBudget).toBe(90000);
    expect(totals!.remaining).toBe(90000 - 390);
    expect(totals!.monthRows.map((r) => [r.month, r.total])).toEqual([["Jul 2025", 375], ["Jan 2026", 15]]);
    expect(totals!.categoryTotals).toEqual([
      { name: "Media", amount: 110 },
      { name: "Influencer", amount: 200 },
      { name: "Events", amount: 50 },
      { name: "General", amount: 30 }
    ]);
  });

  it("parseBudgetTotals returns null without an EXPENSES header", () => {
    expect(parseBudgetTotals([["a", "b"]])).toBeNull();
    expect(parseBudgetTotals([])).toBeNull();
  });

  it("aggregateBudget sums by key, biggest first, '-' for blanks", () => {
    const items = [
      { category: "A", amount: 10 },
      { category: "B", amount: 30 },
      { category: "A", amount: 25 },
      { category: "", amount: 1 }
    ];
    expect(aggregateBudget(items, "category")).toEqual([
      { name: "A", amount: 35 },
      { name: "B", amount: 30 },
      { name: "-", amount: 1 }
    ]);
  });

  it("budgetSummaryFromTransactions orders months chronologically and computes the remainder", () => {
    const aug = parseBudgetRows(parseCsv(monthTabCsv), "AUG26").transactions;
    const dec = parseBudgetRows(parseCsv(secondMonthCsv), "DEC25").transactions;
    const summary = budgetSummaryFromTransactions(null, [...aug, ...dec]);
    expect(summary.monthRows.map((m) => m.month)).toEqual(["Dec 2025", "Aug 2026"]);
    expect(summary.monthRows[0]).toEqual({ month: "Dec 2025", total: 1000, categories: [{ name: "Influencer", amount: 1000 }] });
    expect(summary.totalSpent).toBe(1000 + 8785.25);
    expect(summary.totalExpenses).toBe(summary.totalSpent);
    expect(summary.remaining).toBe(90000 - summary.totalSpent);
    expect(summary.categoryTotals[0]).toEqual({ name: "Media", amount: 3500.25 });
  });

  it("prefers the official total/remaining cells when a base summary has them, and never goes below zero", () => {
    const tx = parseBudgetRows(parseCsv(monthTabCsv), "AUG26").transactions;
    const official = budgetSummaryFromTransactions({ totalSpentFromTotalCell: 5000, remainingFromTotalCell: 777 }, tx);
    expect(official.totalSpent).toBe(5000);
    expect(official.remaining).toBe(777);
    const over = budgetSummaryFromTransactions({ totalBudget: 100 }, tx);
    expect(over.totalBudget).toBe(100);
    expect(over.remaining).toBe(0);
  });

  it("budgetTodayBalance subtracts July-September spend from the June residual, null without it", () => {
    expect(budgetTodayBalance({ residualAtJune: 1000, extensionJul: 100, julFee: 50, extensionAug: 200, extensionSept: 10, septFee: 5 })).toBe(635);
    expect(budgetTodayBalance({ residualAtJune: 0 })).toBe(0);
    expect(budgetTodayBalance({})).toBeNull();
    expect(budgetTodayBalance(null)).toBeNull();
    expect(budgetTodayBalance({ residualAtJune: null })).toBeNull();
  });

  it("budgetTitleFromSheets summarises the month range", () => {
    expect(budgetTitleFromSheets([])).toBe("Budget");
    expect(budgetTitleFromSheets([{ sheetName: "Current tab", transactions: [] }])).toBe("All tabs (1)");
    expect(budgetTitleFromSheets([{ sheetName: "AUG26" }, { sheetName: "DEC25" }])).toBe("Dec 2025 - Aug 2026 (2 month tabs)");
    expect(budgetTitleFromSheets([{ sheetName: "AUG26" }])).toBe("Aug 2026 (1 month tabs)");
  });
});

// ---------------------------------------------------------------------------
// Loading with a mocked network

/** Mimics gviz: every unknown tab name answers with the sheet's default (summary) tab. */
function gvizRouter(tabs: Record<string, Parameters<typeof csvResponse>[0] | (() => Response) | Error | "hang">, other: Router = () => csvResponse(summaryTabCsv)): Router {
  return (url, init) => {
    const name = tabNameOf(url);
    if (name !== null && name in tabs) {
      const route = tabs[name];
      if (route === "hang" || route instanceof Error) return route;
      return typeof route === "function" ? route() : csvResponse(route);
    }
    return other(url, init);
  };
}

describe("loadBudget", () => {
  it("loads, merges and orders the tabs; reports missing and empty tabs without failing", async () => {
    const calls = mockFetch(gvizRouter({ TOTAL: officialTotalTabCsv, AUG26: monthTabCsv, DEC25: secondMonthCsv, JUL26: headerOnlyCsv, JUN26: "   \n" }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;

    expect(result.data.sheets).toEqual(["AUG26", "DEC25"]);
    expect(result.data.transactions).toHaveLength(7 + 2);
    expect(result.data.forecast).toEqual([{ what: "Next month media", amount: 3500 }]);
    expect(result.data.title).toBe("Dec 2025 - Aug 2026 (2 month tabs)");
    expect(result.data.summary.monthRows.map((m) => m.month)).toEqual(["Dec 2025", "Aug 2026"]);
    expect(result.fallbackUsed).toBe(false);

    const status = Object.fromEntries(result.tabs.map((t) => [t.name, t.status]));
    expect(status.AUG26).toBe("loaded");
    expect(status.DEC25).toBe("loaded");
    expect(status.JUL26).toBe("empty"); // header only
    expect(status.JUN26).toBe("empty"); // blank
    expect(status.JULY26).toBe("missing"); // gviz answered with the default tab
    expect(result.tabs).toHaveLength(budgetSheetNamesFor().length);

    // one request per tab (+ the missing-tab sentinel), correct URL, no-store
    expect(calls).toHaveLength(budgetSheetNamesFor().length + 2);
    expect(calls.find((c) => tabNameOf(c.url) === "AUG26")?.url).toBe(budgetTabUrl("AUG26", 0));
    expect(budgetTabUrl("AUG26", 0)).toBe("https://docs.google.com/spreadsheets/d/10DAdDOdvTOiJWx-a8pP1DwigGyggWM3wDIhEUHFOG-Q/gviz/tq?tqx=out:csv&sheet=AUG26&headers=0");
    expect(calls.every((c) => c.init?.cache === "no-store")).toBe(true);
    expect(calls.some((c) => tabNameOf(c.url) === BUDGET_MISSING_TAB_SENTINEL)).toBe(true);
  });

  it("treats HTTP 404 as a missing tab", async () => {
    mockFetch(gvizRouter({ AUG26: monthTabCsv }, () => textStatus(404)));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.tabs.filter((t) => t.status === "missing")).toHaveLength(budgetSheetNamesFor().length - 1);
  });

  it("is partial when some tabs error, and says which", async () => {
    mockFetch(gvizRouter({ AUG26: monthTabCsv, DEC25: () => textStatus(500), MAR26: new TypeError("Failed to fetch") }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.data.sheets).toEqual(["AUG26"]);
    expect(result.failedTabs.map((t) => [t.name, t.errorKind]).sort()).toEqual([["DEC25", "http"], ["MAR26", "network"]]);
    expect(result.failedTabs.find((t) => t.name === "DEC25")?.reason).toBe("HTTP 500");
  });

  it("flags a tab that returns an HTML login page as an access error, not as empty data", async () => {
    mockFetch(gvizRouter({ AUG26: monthTabCsv, DEC25: () => htmlResponse(200) }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.failedTabs).toEqual([expect.objectContaining({ name: "DEC25", errorKind: "access" })]);
  });

  it("flags HTML even when the content type claims CSV", async () => {
    mockFetch(gvizRouter({ AUG26: () => csvResponse("<!DOCTYPE html><html><body>login</body></html>") }, () => csvResponse(summaryTabCsv)));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    const aug = result.tabs.find((t) => t.name === "AUG26");
    expect(aug).toMatchObject({ status: "error", errorKind: "access" });
  });

  it("is failed (access) when every tab and the fallback return the login page", async () => {
    mockFetch(() => htmlResponse(200));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.error.kind).toBe("access");
    expect(result.error.message).toMatch(/link access/);
    expect(result.tabs.every((t) => t.status === "error")).toBe(true);
  });

  it("is failed (access) on HTTP 403 everywhere", async () => {
    mockFetch(() => textStatus(403));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result).toMatchObject({ status: "failed", error: { kind: "access" } });
  });

  it("is failed (network) when the network is down", async () => {
    mockFetch(() => new TypeError("Failed to fetch"));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result).toMatchObject({ status: "failed", error: { kind: "network" } });
  });

  it("times out a hanging tab after 12 s and keeps the others", async () => {
    vi.useFakeTimers();
    mockFetch(gvizRouter({ AUG26: monthTabCsv, DEC25: "hang" }));
    const pending = loadBudgetFromCsvTabs(undefined, FAST);
    await vi.advanceTimersByTimeAsync(11_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.failedTabs).toEqual([expect.objectContaining({ name: "DEC25", errorKind: "timeout" })]);
    expect(result.data.sheets).toEqual(["AUG26"]);
  });

  it("is failed (timeout) when everything hangs", async () => {
    mockFetch(() => "hang");
    // short per-request timeout: with at most 4 requests in flight every tab waits for its turn
    const result = await loadBudgetFromCsvTabs(undefined, { ...FAST, timeoutMs: 15 });
    expect(result).toMatchObject({ status: "failed", error: { kind: "timeout" } });
  });

  it("falls back to the single 'Current tab' CSV when no month tab produced data", async () => {
    const calls = mockFetch((url) => (url === budgetCsvUrl ? csvResponse(monthTabCsv) : csvResponse(summaryTabCsv)));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.fallbackUsed).toBe(true);
    expect(result.data.title).toBe("Current tab");
    expect(result.data.sheets).toEqual([]);
    expect(result.data.transactions).toHaveLength(7);
    expect(result.data.transactions[0].sheet).toBe("Current tab");
    expect(calls.some((c) => c.url === budgetCsvUrl)).toBe(true);
  });

  it("does not use the fallback when a month tab has data", async () => {
    const calls = mockFetch(gvizRouter({ AUG26: monthTabCsv }));
    await loadBudgetFromCsvTabs(undefined, FAST);
    expect(calls.some((c) => c.url === budgetCsvUrl)).toBe(false);
  });

  it("returns an empty 'loaded' result when the sheet is reachable but holds no budget rows", async () => {
    mockFetch((url) => csvResponse(url === budgetCsvUrl ? headerOnlyCsv : summaryTabCsv));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.transactions).toEqual([]);
    expect(result.data.forecast).toEqual([]);
  });

  it("is failed (http) when nothing parses and the fallback answers with an error", async () => {
    mockFetch((url) => (url === budgetCsvUrl ? textStatus(404) : csvResponse(summaryTabCsv)));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result).toMatchObject({ status: "failed", error: { kind: "http" } });
  });

  it("reports 'aborted' when the caller aborts", async () => {
    const controller = new AbortController();
    mockFetch(() => "hang");
    const pending = loadBudgetFromCsvTabs(controller.signal, FAST);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: "failed", error: { kind: "aborted" } });
  });

  it("works without missing-tab detection and survives a failing sentinel", async () => {
    mockFetch(gvizRouter({ AUG26: monthTabCsv, [BUDGET_MISSING_TAB_SENTINEL]: () => textStatus(500) }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.sheets).toEqual(["AUG26"]);
    // without a sentinel the default tab simply parses to no rows: "empty" instead of "missing"
    expect(result.tabs.find((t) => t.name === "JULY26")?.status).toBe("empty");
  });

  it("copes with a BOM and CRLF line endings", async () => {
    mockFetch(gvizRouter({ AUG26: () => csvResponse("﻿" + monthTabCsv.replace(/\n/g, "\r\n")) }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.transactions).toHaveLength(7);
  });

  it("sends &headers=0 on every gviz URL (tabs and sentinel) by default, and honours an override", async () => {
    const defaults = mockFetch(gvizRouter({ TOTAL: officialTotalTabCsv, AUG26: monthTabCsv }));
    await loadBudgetFromCsvTabs(undefined, FAST);
    expect(defaults).toHaveLength(budgetSheetNamesFor().length + 2);
    expect(defaults.every((c) => c.url.endsWith("&headers=0"))).toBe(true);
    expect(defaults.find((c) => tabNameOf(c.url) === "AUG26")?.url).toBe(budgetTabUrl("AUG26", 0));
    expect(budgetTabUrl("AUG26")).not.toContain("headers=");

    const override = mockFetch(gvizRouter({ TOTAL: officialTotalTabCsv, AUG26: monthTabCsv }));
    await loadBudgetFromCsvTabs(undefined, { ...FAST, gvizHeaders: 2 });
    // the TOTAL tab request always uses headers=0; every month-tab/sentinel request honours the override
    expect(override.filter((c) => tabNameOf(c.url) !== "TOTAL").every((c) => c.url.endsWith("&headers=2"))).toBe(true);
  });

  it("recognises a missing tab through the sentinel with headers=0, and reads a live-shaped tab", async () => {
    const calls = mockFetch(gvizRouter({ SEP26: liveHeaders0Csv, [BUDGET_MISSING_TAB_SENTINEL]: summaryTabCsv }));
    const result = await loadBudgetFromCsvTabs(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.sheets).toEqual(["SEP26"]);
    expect(result.data.transactions).toHaveLength(6);
    expect(result.data.forecast).toEqual([{ what: "Synthetic forecast line", amount: 700 }]);
    expect(result.tabs.find((t) => t.name === "SEP26")?.status).toBe("loaded");
    expect(result.tabs.find((t) => t.name === "AUG26")?.status).toBe("missing"); // default tab == sentinel answer
    expect(calls.some((c) => tabNameOf(c.url) === BUDGET_MISSING_TAB_SENTINEL && c.url.endsWith("&headers=0"))).toBe(true);
  });

  it("loadBudgetCsvSheets exposes the per-tab report and the merged data", async () => {
    mockFetch(gvizRouter({ AUG26: monthTabCsv }));
    const { data, tabs } = await loadBudgetCsvSheets({ detectMissingTabs: false });
    expect(data.sheets).toEqual(["AUG26"]);
    expect(tabs.find((t) => t.name === "AUG26")).toMatchObject({ name: "AUG26", status: "loaded", transactions: 7, forecast: 1 });
    expect(tabs).toHaveLength(budgetSheetNamesFor().length);
  });
});

describe("official summary (TOTAL tab, synthetic)", () => {
  const expected = { totalSpent: 60000, integration: 10000, remaining: 45000.5, totalAvailable: 105000.5, baseBudget: 95000.5 };

  it("reads TOTAL SPENT / INTEGRATION / REMAINING BUDGET by label and derives available and base budget", () => {
    expect(parseBudgetOfficialSummary(officialTotalRows)).toEqual(expected);
    expect(parseBudgetOfficialSummary(parseCsv(officialTotalTabCsv))).toEqual(expected);
  });

  it("ignores month rows, including negative amounts, and TOTAL YEAR", () => {
    const summary = parseBudgetOfficialSummary(officialTotalRows)!;
    expect(summary.remaining).not.toBe(-777.77);
    expect(summary.totalSpent).not.toBe(3800);
    // a month row alone gives nothing
    expect(parseBudgetOfficialSummary(officialTotalRows.slice(0, 4))).toBeNull();
  });

  it("takes the last non-empty cell of the row and accepts a negative remaining budget", () => {
    const rows = [
      ["TOTAL SPENT", "", "", "", "", "EUR 1.000,00", "", ""],
      ["REMAINING BUDGET", "", "", "", "", "-€ 5,25", "", "", "", ""]
    ];
    expect(parseBudgetOfficialSummary(rows)).toEqual({
      totalSpent: 1000, integration: null, remaining: -5.25, totalAvailable: 994.75, baseBudget: null
    });
  });

  it("returns null when none of the rows exist or they hold no amount", () => {
    expect(parseBudgetOfficialSummary([])).toBeNull();
    expect(parseBudgetOfficialSummary([["JULY", "€ 1,00"], ["TOTAL YEAR", "€ 2,00"]])).toBeNull();
    expect(parseBudgetOfficialSummary([["TOTAL SPENT", "", ""], ["REMAINING BUDGET", "n/a"]])).toBeNull();
  });

  it("keeps what is known when only some rows exist", () => {
    expect(parseBudgetOfficialSummary([["REMAINING BUDGET", "", "€ 7,00"]])).toEqual({
      totalSpent: null, integration: null, remaining: 7, totalAvailable: null, baseBudget: null
    });
  });

  it("loadBudgetOfficialSummary fetches TOTAL with headers=0, falling back to TOT", async () => {
    const calls = mockFetch(gvizRouter({ TOTAL: () => textStatus(404), TOT: officialTotalTabCsv }));
    const outcome = await loadBudgetOfficialSummary();
    expect(outcome).toEqual({ status: "ok", summary: expected });
    expect(calls.map((c) => tabNameOf(c.url))).toEqual(["TOTAL", "TOT"]);
    expect(calls.every((c) => c.url.endsWith("&headers=0"))).toBe(true);
  });

  it("loadBudgetOfficialSummary reports missing (reachable, no rows) separately from errors", async () => {
    mockFetch(gvizRouter({})); // every name answers with a summary tab that has no TOTAL SPENT rows
    expect(await loadBudgetOfficialSummary()).toEqual({ status: "missing" });
    mockFetch(gvizRouter({ TOTAL: () => htmlResponse(200), TOT: () => htmlResponse(200) }));
    expect(await loadBudgetOfficialSummary()).toMatchObject({ status: "error", message: expect.stringMatching(/web page/) });
    mockFetch(gvizRouter({ TOTAL: new TypeError("Failed to fetch"), TOT: new TypeError("Failed to fetch") }));
    expect(await loadBudgetOfficialSummary()).toMatchObject({ status: "error", message: expect.stringMatching(/network/i) });
  });

  describe("loadBudget with the official summary", () => {
    it("attaches it to a loaded result", async () => {
      mockFetch(gvizRouter({ TOTAL: officialTotalTabCsv, AUG26: monthTabCsv }));
      const result = await loadBudgetFromCsvTabs(undefined, FAST);
      expect(result.status).toBe("loaded");
      if (result.status !== "loaded") return;
      expect(result.official).toEqual(expected);
      expect(result.officialError).toBeUndefined();
    });

    it.each([
      ["a network error", () => new TypeError("Failed to fetch"), /network/i],
      ["an HTML page", () => htmlResponse(200), /web page/],
      ["HTTP 500", () => textStatus(500), /HTTP 500/]
    ])("a failing TOTAL fetch (%s) leaves the status loaded with official null and officialError set", async (_name, route, message) => {
      const first = route();
      const entry = first instanceof Error ? first : () => route() as Response;
      mockFetch(gvizRouter({ TOTAL: entry, TOT: entry, AUG26: monthTabCsv }));
      const result = await loadBudgetFromCsvTabs(undefined, FAST);
      expect(result.status).toBe("loaded");
      if (result.status !== "loaded") return;
      expect(result.data.transactions).toHaveLength(7);
      expect(result.official).toBeNull();
      expect(result.officialError).toMatch(message);
    });

    it("keeps a partial result partial when TOTAL fails, and never invents an error for a missing TOTAL", async () => {
      mockFetch(gvizRouter({ TOTAL: new TypeError("Failed to fetch"), AUG26: monthTabCsv, DEC25: () => textStatus(500) }));
      const partial = await loadBudgetFromCsvTabs(undefined, FAST);
      expect(partial.status).toBe("partial");
      if (partial.status !== "partial") return;
      expect(partial.official).toBeNull();
      expect(partial.officialError).toBeDefined();

      mockFetch(gvizRouter({ AUG26: monthTabCsv }));
      const missing = await loadBudgetFromCsvTabs(undefined, FAST);
      expect(missing.status).toBe("loaded");
      if (missing.status !== "loaded") return;
      expect(missing.official).toBeNull();
      expect(missing.officialError).toBeUndefined();
    });

    it("a good TOTAL cannot rescue a failed month load, and nothing is attached to a failure", async () => {
      mockFetch((url) => (tabNameOf(url) === "TOTAL" ? csvResponse(officialTotalTabCsv) : new TypeError("Failed to fetch")));
      const result = await loadBudgetFromCsvTabs(undefined, FAST);
      expect(result).toMatchObject({ status: "failed", error: { kind: "network" } });
      expect("official" in result).toBe(false);
    });

    it("aborting cancels both the month tabs and the TOTAL request", async () => {
      const controller = new AbortController();
      const calls = mockFetch(() => "hang");
      const pending = loadBudgetFromCsvTabs(controller.signal, FAST);
      controller.abort();
      expect(await pending).toMatchObject({ status: "failed", error: { kind: "aborted" } });
      expect(calls.length).toBeLessThanOrEqual(4); // everything queued behind the 4 hanging requests was never sent

      const direct = new AbortController();
      mockFetch(() => "hang");
      const outcome = loadBudgetOfficialSummary(direct.signal);
      direct.abort();
      expect(await outcome).toEqual({ status: "error", message: "Cancelled" });
    });
  });
});

describe("budgetSheetNamesFor", () => {
  const names = budgetSheetNamesFor(new Date(2026, 9, 7)); // 7 Oct 2026

  it("covers 14 months back to 3 months ahead, named like the sheet's tabs", () => {
    for (const expected of ["AUG25", "SEP25", "AUG26", "SEP26", "OCT26", "NOV26", "DEC26", "JAN27"]) expect(names).toContain(expected);
    expect(names).not.toContain("FEB27");
    expect(names).not.toContain("OCT24"); // not in the legacy list either
    expect(names.length).toBeLessThan(32);
  });

  it("window size is adjustable", () => {
    expect(budgetSheetNamesFor(new Date(2026, 9, 7), 0, 0).filter((n) => !budgetSheetNames.includes(n))).toEqual(["OCT26"]);
  });

  it("keeps the legacy aliases, without duplicates", () => {
    for (const legacy of budgetSheetNames) expect(names).toContain(legacy);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists the newest month first", () => {
    expect(names[0]).toBe("JAN27");
    expect(names.indexOf("SEP26")).toBeLessThan(names.indexOf("AUG26"));
  });
});

describe("fixtures sanity", () => {
  it("toCsv round-trips through parseCsv", () => {
    expect(parseCsv(toCsv(monthTabRows)).map((r) => r.join("|"))).toEqual(monthTabRows.map((r) => r.join("|")));
  });
});
