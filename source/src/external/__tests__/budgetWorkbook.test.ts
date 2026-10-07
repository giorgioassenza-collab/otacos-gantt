// Workbook-first loading. The workbook is built here with SheetJS from SYNTHETIC rows; fetch is mocked, so no
// request ever reaches Google.
import * as XLSX from "xlsx";
import { buildStyledXlsx, type StyledRow } from "./xlsxBuilder";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetCurrency,
  budgetCsvUrl,
  isRedFill,
  RED_EXCLUSION_TABS,
  budgetFromSheetRows,
  budgetTabUrl,
  budgetTodayBalance,
  budgetWorkbookUrl,
  createBudgetRequest,
  loadBudget,
  loadBudgetFromWorkbook,
  looksLikeZip,
  type BudgetSheetRows
} from "../budget";
import { headerOnlyRows, monthTabCsv, monthTabRows, officialTotalTabCsv, secondMonthRows, summaryTabCsv } from "./fixtures";
import { csvResponse, htmlResponse, mockFetch, nonExcluded, tabNameOf, textStatus, type Router } from "./helpers";
import { loadOriginalBudget, originalAvailable, plain, type OriginalBudget } from "./originalHarness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FAST = { retryDelayMs: 0 };
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** SYNTHETIC TOTAL tab: the original "EXPENSES" layout plus residual / fee rows and the official summary rows. */
const totalTabRows: string[][] = [
  ["", "MEDIA", "INFLUENCER", "EVENTS", "GENERAL", "EXPENSES", "INVOICED", "DELTA"],
  ["JULY", "€ 100,00", "€ 200,00", "€ 50,00", "€ 25,00", "€ 375,00", "", ""],
  ["JANUARY", "€ 10,00", "", "", "€ 5,00", "€ 15,00", "", ""],
  ["TOTAL YEAR", "€ 110,00", "€ 200,00", "€ 50,00", "€ 30,00", "€ 390,00", "", ""],
  ["RESIDUAL AT JUNE", "", "", "", "", "€ 5.000,00", "", ""],
  ["JULY 2026 - EXTENSION", "", "", "", "", "€ 1.000,00", "", ""],
  ["JUL26 FEE", "", "", "", "", "€ 250,00", "", ""],
  ["TOTAL SPENT", "", "", "", "", "€ 60.000,00", "", ""],
  ["INTEGRATION", "", "", "", "", "€ 10.000,00", "", ""],
  ["REMAINING BUDGET", "", "", "", "", "€ 45.000,50", "", ""]
];

function workbookBytes(sheets: Array<[string, unknown[][]]>): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }));
}

/** Month tab with real numeric cells (number format) and a real date cell, as an .xlsx holds them. */
const typedMonthRows: unknown[][] = [
  ["INFLUENCER", "", "", ""],
  ["DATE", "WHY", "WHAT", "€"],
  [new Date(Date.UTC(2026, 9, 5)), "Creator A", "Reel", { t: "n", v: 600, z: '"€ "#,##0.00' }],
  ["", "Creator B", "Story", { t: "n", v: 1234.5, z: '"€ "#,##0.00' }]
];

const syntheticWorkbook = () =>
  workbookBytes([
    ["TOTAL", totalTabRows],
    ["OCT26", typedMonthRows],
    ["AUG26", monthTabRows],
    ["JUL26", headerOnlyRows],
    ["BLANK", []]
  ]);

const xlsxResponse = (bytes: Uint8Array) => new Response(bytes as unknown as BodyInit, { status: 200, headers: { "content-type": XLSX_TYPE } });

/** Workbook answer + CSV fallback answers (gviz style: unknown tab names return the default summary tab). */
function router(workbook: () => Response | Error | "hang", csv: Record<string, string> = {}): Router {
  return (url) => {
    if (url === budgetWorkbookUrl) return workbook();
    const name = tabNameOf(url);
    if (name !== null && name in csv) return csvResponse(csv[name]);
    return csvResponse(summaryTabCsv);
  };
}

describe("looksLikeZip", () => {
  it("recognises the PK signature only", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("<!DOCTYPE html>"))).toBe(false);
    expect(looksLikeZip(new Uint8Array([]))).toBe(false);
  });
});

describe("loadBudgetFromWorkbook / loadBudget (workbook first)", () => {
  it("reads the whole workbook with ONE request: tabs come from SheetNames, TOTAL feeds the summary", async () => {
    const calls = mockFetch(router(() => xlsxResponse(syntheticWorkbook())));
    const result = await loadBudget();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(budgetWorkbookUrl);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;

    expect(result.source).toBe("workbook");
    expect(result.fallbackUsed).toBe(false);
    expect(result.workbookError).toBeUndefined();
    // tabs in workbook order, TOTAL excluded; new months (OCT26) appear without any name list
    expect(result.tabs.map((t) => [t.name, t.status])).toEqual([["OCT26", "loaded"], ["AUG26", "loaded"], ["JUL26", "empty"], ["BLANK", "empty"]]);
    expect(result.data.sheets).toEqual(["OCT26", "AUG26"]);
    expect(result.data.transactions.filter((t) => t.sheet === "OCT26").map((t) => [t.what, t.amount, t.month])).toEqual([
      ["Reel", 600, "Oct 2026"],
      ["Story", 1234.5, "Oct 2026"]
    ]);
    expect(result.data.transactions.find((t) => t.what === "Reel")?.date).not.toBe(""); // a real date cell became text
    expect(result.data.transactions.filter((t) => t.sheet === "AUG26")).toHaveLength(7);
    expect(result.data.forecast).toEqual([{ what: "Next month media", amount: 3500 }]);
    expect(result.official).toEqual({ totalSpent: 60000, integration: 10000, remaining: 45000.5, totalAvailable: 105000.5, baseBudget: 95000.5 });
  });

  it("ports the original summary fields (official remaining cell, residual, fee rows)", async () => {
    mockFetch(router(() => xlsxResponse(syntheticWorkbook())));
    const result = await loadBudget();
    if (result.status !== "loaded") throw new Error("expected loaded");
    const summary = result.data.summary;
    expect(summary.remainingFromTotalCell).toBe(45000.5);
    expect(summary.remaining).toBe(45000.5);
    expect(summary.residualAtJune).toBe(5000);
    expect(summary.extensionJul).toBe(1000);
    expect(summary.julFee).toBe(250);
    expect(budgetTodayBalance(summary)).toBe(5000 - (1000 + 250));
    const fee = result.data.transactions.find((t) => t.category === "Fee");
    expect(fee).toMatchObject({ sheet: "JUL26", amount: 250, month: "Jul 2026", why: "Management fee" });
  });

  it("reports official null (no error) when the workbook has no TOTAL summary rows", async () => {
    mockFetch(router(() => xlsxResponse(workbookBytes([["AUG26", monthTabRows]]))));
    const result = await loadBudget();
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.official).toBeNull();
    expect(result.officialError).toBeUndefined();
  });

  it.each([
    ["an HTML login page", () => htmlResponse(200), "access"],
    ["plain text that is not a workbook", () => new Response("hello", { status: 200 }), "invalid"],
    ["a zip that is not a workbook", () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6]), { status: 200 }), "invalid"],
    ["HTTP 500", () => textStatus(500), "http"],
    ["HTTP 403", () => textStatus(403), "access"],
    ["a network error", () => new TypeError("Failed to fetch"), "network"],
    ["a workbook without budget rows", () => xlsxResponse(workbookBytes([["TOTAL", totalTabRows], ["Notes", [["nothing here"]]]])), "invalid"]
  ])("falls back to the CSV path when the workbook is %s, and says why", async (_label, workbook, kind) => {
    const calls = mockFetch(router(workbook, { AUG26: monthTabCsv, TOTAL: officialTotalTabCsv }));
    const result = await loadBudget(undefined, FAST);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.source).toBe("csv");
    expect(result.workbookError?.kind).toBe(kind);
    expect(result.workbookError?.message).toBeTruthy();
    expect(result.data.sheets).toEqual(["AUG26"]);
    expect(result.official?.remaining).toBe(45000.5);
    expect(calls[0].url).toBe(budgetWorkbookUrl);
    expect(calls.length).toBeGreaterThan(5);
  });

  it("times out a hanging workbook download and falls back", async () => {
    mockFetch(router(() => "hang", { AUG26: monthTabCsv }));
    const result = await loadBudget(undefined, { ...FAST, workbookTimeoutMs: 20 });
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.source).toBe("csv");
    expect(result.workbookError?.kind).toBe("timeout");
  });

  it("abort during the workbook download fails with 'aborted' and does not start the CSV path", async () => {
    const controller = new AbortController();
    const calls = mockFetch(router(() => "hang"));
    const pending = loadBudget(controller.signal, FAST);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: "failed", error: { kind: "aborted" }, workbookError: { kind: "aborted" } });
    expect(calls).toHaveLength(1);
  });

  it("failed everywhere: the result is failed and still carries the workbook reason", async () => {
    mockFetch(() => new TypeError("Failed to fetch"));
    const result = await loadBudget(undefined, FAST);
    expect(result).toMatchObject({ status: "failed", error: { kind: "network" }, workbookError: { kind: "network" } });
  });

  it("skipWorkbook goes straight to the CSV path", async () => {
    const calls = mockFetch(router(() => xlsxResponse(syntheticWorkbook()), { AUG26: monthTabCsv }));
    const result = await loadBudget(undefined, { ...FAST, skipWorkbook: true });
    expect(calls.some((c) => c.url === budgetWorkbookUrl)).toBe(false);
    expect(result).toMatchObject({ status: "loaded", source: "csv" });
  });

  it("loadBudgetFromWorkbook exposes the outcome directly", async () => {
    mockFetch(router(() => xlsxResponse(syntheticWorkbook())));
    const outcome = await loadBudgetFromWorkbook();
    expect(outcome.ok).toBe(true);
    mockFetch(router(() => textStatus(404)));
    expect(await loadBudgetFromWorkbook()).toEqual({ ok: false, error: { kind: "http", message: "HTTP 404" } });
  });
});

describe("polite CSV fallback", () => {
  it("never has more than 4 requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    let total = 0;
    mockFetch(() => {
      inFlight += 1;
      total += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve(csvResponse(summaryTabCsv));
        }, 3)
      );
    });
    await loadBudget(undefined, { ...FAST, skipWorkbook: true });
    expect(total).toBeGreaterThan(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("retries once after an HTTP 429 and keeps the data", async () => {
    const seen: Record<string, number> = {};
    const calls = mockFetch((url) => {
      const name = tabNameOf(url) ?? "?";
      seen[name] = (seen[name] ?? 0) + 1;
      if (name === "AUG26") return seen[name] === 1 ? textStatus(429) : csvResponse(monthTabCsv);
      return csvResponse(summaryTabCsv);
    });
    const result = await loadBudget(undefined, { ...FAST, skipWorkbook: true });
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.data.sheets).toEqual(["AUG26"]);
    expect(calls.filter((c) => tabNameOf(c.url) === "AUG26")).toHaveLength(2);
  });

  it("gives up after the single retry: a persistent 429 is reported as an http error on that tab", async () => {
    mockFetch((url) => (tabNameOf(url) === "AUG26" ? textStatus(429) : tabNameOf(url) === "DEC25" ? csvResponse(monthTabCsv) : csvResponse(summaryTabCsv)));
    const result = await loadBudget(undefined, { ...FAST, skipWorkbook: true });
    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.failedTabs).toEqual([expect.objectContaining({ name: "AUG26", errorKind: "http", reason: "HTTP 429" })]);
  });

  it("also retries once after a network failure (a browser reports Google's CORS-less 429 that way)", async () => {
    let attempts = 0;
    mockFetch((url) => {
      if (tabNameOf(url) === "AUG26") {
        attempts += 1;
        return attempts === 1 ? new TypeError("Failed to fetch") : csvResponse(monthTabCsv);
      }
      return csvResponse(summaryTabCsv);
    });
    const result = await loadBudget(undefined, { ...FAST, skipWorkbook: true });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ status: "loaded", source: "csv" });
  });

  it("waits retryDelayMs before the retry", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    mockFetch(() => (++attempts === 1 ? textStatus(429) : csvResponse("x")));
    const request = createBudgetRequest({ retryDelayMs: 1500 });
    const pending = request(budgetTabUrl("AUG26", 0));
    await vi.advanceTimersByTimeAsync(1499);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(attempts).toBe(2);
  });
});

describe("budgetCurrency groups thousands at 4 digits", () => {
  it("formats 5527 like 114245", () => {
    expect(budgetCurrency(5527)).toMatch(/^5\.527\s€$/);
    expect(budgetCurrency(114245)).toMatch(/^114\.245\s€$/);
    expect(budgetCurrency(999)).toMatch(/^999\s€$/);
    expect(budgetCurrency(-1234)).toMatch(/^-1\.234\s€$/);
  });
});

// ---------------------------------------------------------------------------
// Differential against the original parseBudgetWorkbook, run with the real SheetJS

describe.skipIf(!originalAvailable)("budgetFromSheetRows vs original parseBudgetWorkbook", () => {
  it("returns the same data for the same workbook", () => {
    const original: OriginalBudget = loadOriginalBudget(async () => { throw new Error("no network"); }, { XLSX });
    const bytes = syntheticWorkbook();
    const workbook = XLSX.read(bytes, { type: "array", cellHTML: false, cellFormula: false, cellDates: true });
    const sheets: BudgetSheetRows[] = workbook.SheetNames.map((name) => ({
      name,
      // same extraction as the original budgetRowsFromWorksheet
      rows: plain(original.budgetRowsFromWorksheet(workbook.Sheets[name]))
    }));
    const fromOriginal = plain(original.parseBudgetWorkbook(workbook));
    const { data } = budgetFromSheetRows(sheets);
    expect(nonExcluded(plain(data))).toEqual(fromOriginal);
    expect(data.summary.julFee).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Business rule: red-filled amounts do not count in JUL25 / AUG25 / SEP25 / OCT25

const RED = "EA9999";
const redRows = (): StyledRow[] => [
  ["INFLUENCER"],
  ["DATE", "WHY", "WHAT", "€"],
  ["01/09/2025", "why", "Creator A", { v: 100 }],
  [], // blank row: dropped by the row extraction, must not shift the red marker
  ["02/09/2025", "why", "Creator B", { v: 200, fill: RED }],
  ["03/09/2025", "why", "Creator C", { v: 300.5, fill: RED }],
  ["04/09/2025", "why", "Creator D", { v: 400, fill: "FFFF00" }], // yellow: counted
  ["", "", "totale", { v: 1000 }]
];

describe("red-filled amounts (business rule)", () => {
  const workbook = () => buildStyledXlsx([
    { name: "TOTAL", rows: [], startRow: 1 },
    { name: "SEP25", rows: redRows(), startRow: 2 }, // sheet starts at row 2: indexes must map to real sheet rows
    { name: "MAY26", rows: redRows() }, // same red cells outside the rule's tabs: all counted
    { name: "JUL25", rows: [["MEDIA"], ["DATE", "WHY", "WHAT", "€"], ["05/07/2025", "w", "Only red", { v: 50, fill: "CC4125" }]] }
  ]);

  it("isRedFill matches light and dark reds only", () => {
    for (const rgb of ["EA9999", "ea9999", "CC4125", "FFEA9999", "#E06666", "FF0000"]) expect(isRedFill(rgb), rgb).toBe(true);
    for (const rgb of ["FFFF00", "00FF00", "FFFFFF", "000000", "EA9999AA1", "", undefined, null, "zzzzzz", "980000"]) expect(isRedFill(rgb), String(rgb)).toBe(false);
    expect(RED_EXCLUSION_TABS).toEqual(["JUL25", "AUG25", "SEP25", "OCT25"]);
  });

  it("drops red-filled amounts from the rule's tabs only, and reports them", async () => {
    mockFetch(router(() => xlsxResponse(workbook())));
    const result = await loadBudget();
    if (result.status !== "loaded") throw new Error("expected loaded");
    const { data } = result;

    const sep = data.transactions.filter((t) => t.sheet === "SEP25").map((t) => t.amount);
    expect(sep).toEqual([100, 400]);
    expect(data.transactions.filter((t) => t.sheet === "MAY26").map((t) => t.amount)).toEqual([100, 200, 300.5, 400]);
    expect(data.transactions.some((t) => t.sheet === "JUL25")).toBe(false);

    expect(data.excluded.map((e) => [e.sheet, e.cell, e.amount, e.what, e.reason])).toEqual([
      ["SEP25", "D6", 200, "Creator B", "red"],
      ["SEP25", "D7", 300.5, "Creator C", "red"],
      ["JUL25", "D3", 50, "Only red", "red"]
    ]);
    expect(data.excluded[0]).toMatchObject({ category: "Influencer", month: "Sep 2025", date: "02/09/2025" });
    expect(data.colorsUnavailable).toBe(false);
    // a tab holding only red transactions is still reported as loaded
    expect(result.tabs.find((t) => t.name === "JUL25")).toMatchObject({ status: "loaded", transactions: 0, excluded: 1 });
    expect(result.tabs.find((t) => t.name === "SEP25")).toMatchObject({ status: "loaded", transactions: 2, excluded: 2 });
  });

  it("computes summaries, aggregates and month totals without the excluded amounts", async () => {
    mockFetch(router(() => xlsxResponse(workbook())));
    const result = await loadBudget();
    if (result.status !== "loaded") throw new Error("expected loaded");
    const { summary } = result.data;
    expect(summary.totalSpent).toBe(100 + 400 + (100 + 200 + 300.5 + 400)); // SEP25 kept + MAY26 all
    expect(summary.monthRows.find((m) => m.month === "Sep 2025")?.total).toBe(500);
    expect(summary.monthRows.find((m) => m.month === "Jul 2025")).toBeUndefined();
    expect(summary.categoryTotals.find((c) => c.name === "Influencer")?.amount).toBe(summary.totalSpent);
  });

  it("budgetFromSheetRows takes the markers as given, ignores them outside the rule's tabs", () => {
    const rows = [["INFLUENCER"], ["DATE", "WHY", "WHAT", "€"], ["", "w", "a", "10"], ["", "w", "b", "20"]];
    const colors = { cellAt: (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`, redCells: new Set(["D4"]) };
    const { data } = budgetFromSheetRows([{ name: "OCT25", rows, colors }, { name: "NOV25", rows, colors }]);
    expect(data.transactions.map((t) => [t.sheet, t.amount])).toEqual([["OCT25", 10], ["NOV25", 10], ["NOV25", 20]]);
    expect(data.excluded.map((e) => [e.sheet, e.cell, e.amount])).toEqual([["OCT25", "D4", 20]]);
  });

  it("no colour info (e.g. tabs given without it) excludes nothing and still returns excluded: []", () => {
    const { data } = budgetFromSheetRows([{ name: "SEP25", rows: monthTabRows }]);
    expect(data.excluded).toEqual([]);
    expect(data.colorsUnavailable).toBe(false);
  });

  it("the CSV fallback cannot see colours: colorsUnavailable true, excluded []", async () => {
    mockFetch(router(() => textStatus(500), { AUG26: monthTabCsv }));
    const result = await loadBudget(undefined, FAST);
    if (result.status !== "loaded") throw new Error("expected loaded");
    expect(result.source).toBe("csv");
    expect(result.data.colorsUnavailable).toBe(true);
    expect(result.data.excluded).toEqual([]);
    // also on the single "Current tab" fallback
    mockFetch((url) => (url === budgetCsvUrl ? csvResponse(monthTabCsv) : url === budgetWorkbookUrl ? textStatus(500) : csvResponse(summaryTabCsv)));
    const current = await loadBudget(undefined, FAST);
    if (current.status !== "loaded") throw new Error("expected loaded");
    expect(current.data.colorsUnavailable).toBe(true);
  });
});
