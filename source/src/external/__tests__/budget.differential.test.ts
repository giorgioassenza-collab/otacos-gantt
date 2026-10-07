// Differential test: the ORIGINAL budget functions (extracted from the legacy index.html, read only)
// run in a node:vm context on the same SYNTHETIC fixtures, and the TypeScript port must match.
// Skipped when the legacy sources are not on this machine (see originalHarness.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as port from "../budget";
import { headerOnlyCsv, liveHeaders0Csv, liveHeaders0NoTitleCsv, monthTabCsv, monthTabRows, secondMonthCsv, summaryTabCsv, toCsv, totalsRows } from "./fixtures";
import { csvResponse, nonExcluded, tabNameOf, textStatus } from "./helpers";
import { loadOriginalBudget, originalAvailable, plain, type FetchStub, type OriginalBudget } from "./originalHarness";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// A gviz-like tab where the header row was swallowed (as seen on the live sheet): block titles and
// DATE merged into one label. Synthetic, only the shape matters.
const gvizMangledCsv = toCsv([
  ["SYNTH - EXPENSES - AUG26 EVENTS DATE", "WHY", "WHAT", "€", "INFLUENCER DATE", "WHY", "WHAT", "€"],
  ["", "", "", "", "", "Creator A", "Reel", "€ 100"],
  ["", "", "totale", "€ 0", "", "", "totale", "€ 100"]
]);

const csvFixtures: Record<string, string> = {
  monthTab: monthTabCsv,
  headerOnly: headerOnlyCsv,
  second: secondMonthCsv,
  summaryTab: summaryTabCsv,
  gvizMangled: gvizMangledCsv,
  empty: "",
  weird: 'a,"b\nc",d\r\n"DATE","WHY","WHAT","€"\r\n2026-01-01,x,y,"€ 5"\r\n'
};

const stub: FetchStub = async (url) => {
  const name = tabNameOf(String(url));
  const map: Record<string, string> = { AUG26: monthTabCsv, DEC25: secondMonthCsv, JUL26: headerOnlyCsv, MAY26: gvizMangledCsv };
  if (name !== null && name in map) return csvResponse(map[name]);
  if (name === "JUN26") return textStatus(500);
  return csvResponse(summaryTabCsv); // gviz default tab
};

describe.skipIf(!originalAvailable)("budget port vs original", () => {
  const original: OriginalBudget = originalAvailable ? loadOriginalBudget(stub) : {};

  it("parseCsv", () => {
    for (const [name, text] of Object.entries(csvFixtures)) {
      expect(port.parseCsv(text), name).toEqual(plain(original.parseCsv(text)));
    }
  });

  it("parseBudgetAmount", () => {
    const samples = ["€ 1.234,50", "1.234", "1,234", "1,234.56", "1.234.567,89", "1,5", "-€ 3,00", "", "x", "12.5.6", "--1", " 7 ", "1,23,456"];
    for (const sample of samples) {
      expect(port.parseBudgetAmount(sample), sample).toBe(original.parseBudgetAmount(sample));
    }
  });

  it("budgetCurrency and budgetDateLabel", () => {
    for (const value of [0, 1, 99.5, 100.5, 1234, 12345.67, 1234567.8, -42, -1234.5, NaN]) {
      // the only intended difference: 4-digit amounts get the thousands separator (the original shows "1234 €")
      const expected = String(original.budgetCurrency(value)).replace(/^(-?)(\d)(\d{3})(?=\D*$)/, "$1$2.$3");
      expect(port.budgetCurrency(value), String(value)).toBe(expected);
    }
    expect(port.budgetCurrency(null)).toBe(original.budgetCurrency(null));
    for (const value of ["", "2026-08-03", "2026-08-03T10:00:00Z", "not a date", "03/08/2026", "Aug 3, 2026"]) {
      expect(port.budgetDateLabel(value), value).toBe(original.budgetDateLabel(value));
    }
  });

  it("month helpers", () => {
    const names = ["AUG26", "JULY26", "JUL26", "JUNE26", "GIU26", "JUN26", "MAY26", "APR26", "MAR26", "FEB26", "GEN26", "JAN26", "DIC25", "DEC25", "NOV25", "OCT25", "SEP25", "AUG25", "JUL25", "Current tab", "", "august26", "XAUG26", "AUG2026", "sett25", "OTT25", "MAG26", "LUG25"];
    for (const name of names) {
      expect(port.budgetMonthLabelFromSheetName(name), name).toBe(original.budgetMonthLabelFromSheetName(name));
      for (const date of ["", "2026-03-15", "garbage"]) {
        expect(port.budgetMonthKey(date, name), `${date}|${name}`).toBe(original.budgetMonthKey(date, name));
      }
    }
    for (const label of ["Mar 2026", "Dec 2025", "No date", "Gen 2026", "dec 2025", "Foo 2026", "", "Jan  2026"]) {
      expect(port.budgetMonthSortValue(label), label).toBe(original.budgetMonthSortValue(label));
    }
    for (const label of ["JULY", "january", " MAY ", "TOTAL", "Z", ""]) {
      expect(port.budgetMonthLabelFromName(label), label).toBe(original.budgetMonthLabelFromName(label));
    }
  });

  it("parseBudgetRows on every fixture and sheet name", () => {
    for (const [name, text] of Object.entries(csvFixtures)) {
      for (const sheetName of ["AUG26", "Current tab", ""]) {
        const rows = port.parseCsv(text);
        expect(nonExcluded(port.parseBudgetRows(rows, sheetName)), `${name}/${sheetName}`).toEqual(plain(original.parseBudgetRows(rows, sheetName)));
      }
    }
    // direct from the structured fixture too
    expect(nonExcluded(port.parseBudgetRows(monthTabRows, "AUG26"))).toEqual(plain(original.parseBudgetRows(monthTabRows, "AUG26")));
  });

  it("parseBudgetTotals", () => {
    expect(port.parseBudgetTotals(totalsRows)).toEqual(plain(original.parseBudgetTotals(totalsRows)));
    expect(port.parseBudgetTotals([["x"]])).toEqual(plain(original.parseBudgetTotals([["x"]])));
    expect(port.parseBudgetTotals(monthTabRows)).toEqual(plain(original.parseBudgetTotals(monthTabRows)));
    const noYearRow = totalsRows.filter((row) => row[0] !== "TOTAL YEAR");
    expect(port.parseBudgetTotals(noYearRow)).toEqual(plain(original.parseBudgetTotals(noYearRow)));
  });

  it("aggregateBudget, budgetSummaryFromTransactions, budgetTodayBalance, uniqueSortedBudgetValues", () => {
    const aug = port.parseBudgetRows(port.parseCsv(monthTabCsv), "AUG26").transactions;
    const dec = port.parseBudgetRows(port.parseCsv(secondMonthCsv), "DEC25").transactions;
    const noDate = port.parseBudgetRows(port.parseCsv(monthTabCsv), "Current tab").transactions;
    const all = [...aug, ...dec, ...noDate];
    for (const key of ["category", "month", "sheet", "why", "date"] as const) {
      expect(port.aggregateBudget(all, key), key).toEqual(plain(original.aggregateBudget(all, key)));
    }
    for (const base of [null, undefined, {}, { totalBudget: 100 }, { totalSpentFromTotalCell: 5000, remainingFromTotalCell: 12 }, { workingBudget: 5, residualAtJune: 10 }]) {
      expect(port.budgetSummaryFromTransactions(base, all)).toEqual(plain(original.budgetSummaryFromTransactions(base, all)));
    }
    expect(port.budgetSummaryFromTransactions(null, [])).toEqual(plain(original.budgetSummaryFromTransactions(null, [])));

    for (const summary of [
      null, {}, { residualAtJune: 1000, extensionJul: 100, julFee: 50, extensionAug: 200, extensionSept: 10, septFee: 5 },
      { residualAtJune: 0 }, { residualAtJune: null, julFee: 1 }, { residualAtJune: NaN }
    ]) {
      expect(port.budgetTodayBalance(summary), JSON.stringify(summary)).toBe(original.budgetTodayBalance(summary));
    }

    expect(port.uniqueSortedBudgetValues(all, "month")).toEqual(plain(original.uniqueSortedBudgetValues(all, "month")));
    expect(port.uniqueSortedBudgetValues(all, "sheet")).toEqual(plain(original.uniqueSortedBudgetValues(all, "sheet")));
    expect(port.uniqueSortedBudgetValues(all, "category")).toEqual(plain(original.uniqueSortedBudgetValues(all, "category")));
  });

  it("title and loadBudgetCsvSheets give the same data over the same (mocked) network", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7)); // the port probes a date-based window of tab names; fix it so the order is stable
    vi.stubGlobal("fetch", vi.fn((url: string) => stub(url)));
    const fromOriginal = plain(await original.loadBudgetCsvSheets());
    const { data } = await port.loadBudgetCsvSheets({ detectMissingTabs: false, retryDelayMs: 0 });
    expect(nonExcluded(data)).toEqual(fromOriginal);
    // JUL26 has no rows, JUN26 errored; the header-swallowed MAY26 still yields rows in the original, and so in the port
    expect(data.sheets).toEqual(["AUG26", "MAY26", "DEC25"]);
  });

  it("relaxed header rule: only adds what the original rule could not see", () => {
    // Live &headers=0 shapes: the original finds no header at all (the DATE label is blank or has no amount header)...
    for (const csv of [liveHeaders0Csv, liveHeaders0NoTitleCsv]) {
      const rows = port.parseCsv(csv);
      expect(plain(original.parseBudgetRows(rows, "SEP26").transactions)).toEqual([]);
      expect(port.parseBudgetRows(rows, "SEP26").transactions.length).toBeGreaterThan(0);
    }
    // ...and where a block still has the original's full header (DATE with an amount cell), the original's
    // transactions are all still produced, unchanged and in order, with the relaxed rule only adding to them.
    const mixed = [
      ["MEDIA", "", "", ""],
      ["DATE", "WHY", "WHAT", "€"],
      ["2026-01-01", "a", "b", "€ 10,00"],
      ["", "", "", ""],
      ["GENERAL", "", "", ""],
      ["DATE", "x", "y", "€"],
      ["2026-01-02", "c", "d", "€ 20,00"]
    ];
    expect(nonExcluded(port.parseBudgetRows(mixed, "JAN26"))).toEqual(plain(original.parseBudgetRows(mixed, "JAN26")));
  });

  it("tab list is identical", () => {
    // budgetSheetNames is a const inside the vm script; the original's sheet ordering is derived from it,
    // so sorting the reversed port list with the original must give the port list back.
    const probe = port.budgetSheetNames.map((sheet) => ({ sheet })).reverse();
    expect(plain(original.uniqueSortedBudgetValues(probe, "sheet"))).toEqual([...port.budgetSheetNames]);
  });
});
