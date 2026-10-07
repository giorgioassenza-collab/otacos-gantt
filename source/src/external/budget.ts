/**
 * Budget data pipeline: a TypeScript port of the original single-file app (parseCsv ... parseBudgetWorkbook,
 * aggregateBudget, budgetTodayBalance), plus a `loadBudget` entry point that reports honest
 * loaded / partial / failed states.
 *
 * Read-only. The sheet is never written to.
 *
 * Primary path: ONE request for the whole workbook (`export?format=xlsx`), parsed with SheetJS (`xlsx`, imported
 * dynamically so only the Budget view loads it). Fallback: one gviz CSV request per tab, throttled (see
 * createBudgetRequest). With CSV data the xlsx-only summary fields (residualAtJune, extension*, *Fee, ...) stay unset
 * and `budgetTodayBalance` returns null.
 */

import { createLimiter, fetchBytes, fetchText, looksLikeHtml, sleep, FetchFailure, type FetchedText, type FetchFailureKind } from "./http";

// ---------------------------------------------------------------------------
// Constants

export const BUDGET_SHEET_ID = "10DAdDOdvTOiJWx-a8pP1DwigGyggWM3wDIhEUHFOG-Q";
export const budgetWorkbookUrl = `https://docs.google.com/spreadsheets/d/${BUDGET_SHEET_ID}/export?format=xlsx`;
export const budgetCsvUrl = `https://docs.google.com/spreadsheets/d/${BUDGET_SHEET_ID}/export?format=csv&gid=43583683`;
export const budgetGvizBaseUrl = `https://docs.google.com/spreadsheets/d/${BUDGET_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;

/** Tab names probed, in display order. Several are aliases (JULY26/JUL26, JUNE26/GIU26/JUN26 ...): most do not exist. */
export const budgetSheetNames: readonly string[] = [
  "AUG26", "JULY26", "JUL26", "JUNE26", "GIU26", "JUN26", "MAY26", "APR26", "MAR26", "FEB26",
  "GEN26", "JAN26", "DIC25", "DEC25", "NOV25", "OCT25", "SEP25", "AUG25", "JUL25"
];

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * CSV-fallback tab names: the legacy list plus every month from `back` (14) months back to `ahead` (3) months ahead named like the sheet's
 * own tabs (AUG26, SEP26, OCT26 ...). New months appear in the sheet without any code change. Names that do not
 * exist are detected as missing and ignored.
 */
export function budgetSheetNamesFor(today: Date = new Date(), back = 14, ahead = 3): string[] {
  const names = new Set<string>();
  for (let offset = ahead; offset >= -back; offset -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    names.add(`${MONTH_ABBR[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`);
  }
  budgetSheetNames.forEach((name) => names.add(name));
  return [...names];
}

/** Total budget used when the sheet summary does not provide one. */
export const DEFAULT_TOTAL_BUDGET = 90000;

/** Per-tab network timeout. */
export const BUDGET_TAB_TIMEOUT_MS = 12_000;

/** A tab name that cannot exist: gviz answers it with the sheet's default tab, which lets us spot fallbacks. */
export const BUDGET_MISSING_TAB_SENTINEL = "__otacos_missing_tab__";

/**
 * gviz CSV URL of one tab. `headers` adds `&headers=N` (number of header rows gviz should assume).
 * Left out by default, like the original. Reason it exists: when gviz guesses a header row it swallows the
 * sheet's real DATE/WHY/WHAT row into column labels, which defeats parseBudgetRows (see loadBudget notes).
 */
export function budgetTabUrl(sheetName: string, headers?: number): string {
  return `${budgetGvizBaseUrl}${encodeURIComponent(sheetName)}${headers === undefined ? "" : `&headers=${headers}`}`;
}

// ---------------------------------------------------------------------------
// Types

export interface BudgetTransaction {
  /** Tab the row came from (e.g. "AUG26"). */
  sheet: string;
  /** Influencer, Media, Events, General (displayed as "Fee"), Fee, or the sheet's own header text. */
  category: string;
  /** Raw date cell as written in the sheet (may be empty). */
  date: string;
  why: string;
  what: string;
  amount: number;
  /** "Mon YYYY" (e.g. "Aug 2026") or "No date". */
  month: string;
}

/** A forecast line. The original only keeps what and amount (no sheet/category/date). */
export interface BudgetForecastItem {
  what: string;
  amount: number;
}

export interface BudgetAggregate {
  name: string;
  amount: number;
}

export interface BudgetMonthRow {
  month: string;
  total: number;
  categories: BudgetAggregate[];
}

export interface BudgetSummary {
  totalBudget: number;
  workingBudget: number;
  totalExpenses: number;
  totalSpent: number;
  remaining: number;
  categoryTotals: BudgetAggregate[];
  monthRows: BudgetMonthRow[];
  /** xlsx-only fields (never set by the CSV pipeline, kept for parity with the original summary shape). */
  totalSpentFromTotalCell?: number | null;
  remainingFromTotalCell?: number | null;
  residualAtJune?: number | null;
  extensionJul?: number | null;
  extensionAug?: number | null;
  extensionSept?: number | null;
  julFee?: number | null;
  augFee?: number | null;
  septFee?: number | null;
  newQuarterBudget?: number | null;
  contractMonthRows?: BudgetMonthRow[];
}

/** A transaction left out of every total because its amount cell is marked red in the sheet (business rule). */
export type BudgetExcludedItem = BudgetTransaction & { cell: string; reason: "red" };

export interface BudgetData {
  title: string;
  transactions: BudgetTransaction[];
  forecast: BudgetForecastItem[];
  /** Tabs that contributed data, in fetch order. */
  sheets: string[];
  /** Summary, aggregates and month/category totals are computed from `transactions` only, never from `excluded`. */
  summary: BudgetSummary;
  /** Red-marked transactions that were dropped (only tabs in RED_EXCLUSION_TABS, only on the workbook path). */
  excluded: BudgetExcludedItem[];
  /** True when the data came from CSV, which carries no cell colours: red-marked amounts could NOT be excluded. */
  colorsUnavailable: boolean;
}

/** Result of parseBudgetRows for one tab. */
export interface ParsedBudgetSheet {
  title: string;
  transactions: BudgetTransaction[];
  forecast: BudgetForecastItem[];
  /** Always [] unless parseBudgetRows was given `excludeAmountCell`. */
  excluded: BudgetExcludedItem[];
}

/** Tabs where red-filled amounts are not counted (business rule). */
export const RED_EXCLUSION_TABS: readonly string[] = ["JUL25", "AUG25", "SEP25", "OCT25"];

/** Light or dark red fill (EA9999, CC4125 ...). Accepts "RRGGBB" or "AARRGGBB"; anything else is not red. */
export function isRedFill(rgb: string | undefined | null): boolean {
  const hex = String(rgb ?? "").trim().replace(/^#/, "");
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return false;
  const tail = hex.slice(-6);
  const r = parseInt(tail.slice(0, 2), 16);
  const g = parseInt(tail.slice(2, 4), 16);
  const b = parseInt(tail.slice(4, 6), 16);
  return r >= 200 && g <= 170 && b <= 170 && r - g >= 50 && r - b >= 50;
}

/** Output of parseBudgetTotals (the TOTAL tab); xlsx-only in practice, see module doc. */
export interface BudgetTotals {
  totalBudget: number;
  workingBudget: number;
  totalExpenses: number;
  totalSpent: number;
  remaining: number;
  categoryTotals: BudgetAggregate[];
  monthRows: Array<{ month: string; categories: BudgetAggregate[]; total: number }>;
}

/** "invalid": the answer was reachable but is not a usable workbook (not a zip, unreadable, no budget rows). */
export type BudgetErrorKind = "access" | "http" | "timeout" | "network" | "aborted" | "invalid";

export interface BudgetLoadError {
  kind: BudgetErrorKind;
  message: string;
}

export type BudgetTabStatus =
  /** Parsed and contributed transactions and/or forecast lines. */
  | "loaded"
  /** Reachable but no budget rows (blank tab, or a tab without the expected headers). */
  | "empty"
  /** The tab does not exist (HTTP 400/404, or gviz answered with its default tab). */
  | "missing"
  /** Could not be read: see errorKind. */
  | "error";

export interface BudgetTabReport {
  name: string;
  status: BudgetTabStatus;
  reason?: string;
  errorKind?: BudgetErrorKind;
  transactions?: number;
  forecast?: number;
  /** Red-marked transactions dropped from this tab. */
  excluded?: number;
}

/** Where the data came from: the whole workbook in one request, or the per-tab CSV fallback. */
export type BudgetSource = "workbook" | "csv";

export type BudgetResult =
  /** Every tab was either read, empty or absent. `data` may legitimately be empty (CSV path only). */
  | { status: "loaded"; source: BudgetSource; data: BudgetData; tabs: BudgetTabReport[]; fallbackUsed: boolean; official?: BudgetOfficialSummary | null; officialError?: string; workbookError?: BudgetLoadError }
  /** Some tabs could not be read (failedTabs) but others produced data. CSV path only. */
  | { status: "partial"; source: BudgetSource; data: BudgetData; failedTabs: BudgetTabReport[]; tabs: BudgetTabReport[]; fallbackUsed: boolean; official?: BudgetOfficialSummary | null; officialError?: string; workbookError?: BudgetLoadError }
  /** Nothing usable and at least one real error (network, access, timeout, HTTP). */
  | { status: "failed"; error: BudgetLoadError; tabs: BudgetTabReport[]; workbookError?: BudgetLoadError };

export type BudgetRows = string[][];

// ---------------------------------------------------------------------------
// CSV and amounts

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseBudgetAmount(value: unknown): number {
  const clean = String(value || "")
    .replace(/[^\d,.\-]/g, "")
    .trim();
  if (!clean) return 0;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized = clean;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = clean.length - lastComma - 1;
    normalized = decimals === 3 ? clean.replace(/,/g, "") : clean.replace(",", ".");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

const eurFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  // it-IT skips the thousands separator below 5 digits ("5527 €" next to "114.245 €"): always group.
  useGrouping: "always"
});

/** Whole-euro, Italian formatting (e.g. "1.234 €"). */
export function budgetCurrency(value: number | null | undefined): string {
  return eurFormatter.format(value || 0);
}

export function budgetDateLabel(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return text;
}

// ---------------------------------------------------------------------------
// Months

const MONTH_LABELS: Record<string, string> = {
  JANUARY: "Jan", GENNAIO: "Jan", GEN: "Jan", JAN: "Jan",
  FEBRUARY: "Feb", FEBBRAIO: "Feb", FEB: "Feb",
  MARCH: "Mar", MARZO: "Mar", MAR: "Mar",
  APRIL: "Apr", APRILE: "Apr", APR: "Apr",
  MAY: "May", MAGGIO: "May", MAG: "May",
  JUNE: "Jun", GIUGNO: "Jun", JUN: "Jun", GIU: "Jun",
  JULY: "Jul", LUGLIO: "Jul", JUL: "Jul", LUG: "Jul",
  AUGUST: "Aug", AGOSTO: "Aug", AUG: "Aug", AGO: "Aug",
  SEPTEMBER: "Sep", SETTEMBRE: "Sep", SEP: "Sep", SET: "Sep",
  OCTOBER: "Oct", OTTOBRE: "Oct", OCT: "Oct", OTT: "Oct",
  NOVEMBER: "Nov", NOVEMBRE: "Nov", NOV: "Nov",
  DECEMBER: "Dec", DICEMBRE: "Dec", DIC: "Dec", DEC: "Dec"
};

const SHEET_MONTH_PATTERN = /\b(JANUARY|JAN|GENNAIO|GEN|FEBRUARY|FEBBRAIO|FEB|MARCH|MARZO|MAR|APRIL|APRILE|APR|MAY|MAGGIO|MAG|JUNE|GIUGNO|JUN|GIU|JULY|LUGLIO|JUL|LUG|AUGUST|AGOSTO|AUG|AGO|SEPTEMBER|SETTEMBRE|SEP|SET|OCTOBER|OTTOBRE|OCT|OTT|NOVEMBER|NOVEMBRE|NOV|DECEMBER|DICEMBRE|DIC|DEC)(\d{2})\b/;

/** "AUG26" / "GIU26" / "july26" -> "Aug 2026"; "" when the text holds no month+year token. */
export function budgetMonthLabelFromSheetName(value: unknown): string {
  const text = String(value || "").toUpperCase();
  const match = text.match(SHEET_MONTH_PATTERN);
  if (!match) return "";
  return `${MONTH_LABELS[match[1]]} 20${match[2]}`;
}

/** Month bucket of a transaction: the tab's own month wins, else the date cell, else "No date". */
export function budgetMonthKey(value: unknown, fallbackTitle = ""): string {
  const titleMonth = budgetMonthLabelFromSheetName(fallbackTitle);
  if (titleMonth) return titleMonth;
  const text = String(value || "").trim();
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return "No date";
}

const SORT_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dic: 11, dec: 11, gen: 0
};

/** Sortable number for "Mon YYYY"; anything else sorts last (999999). */
export function budgetMonthSortValue(monthName: unknown): number {
  const value = String(monthName || "");
  const match = value.match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return 999999;
  return Number(match[2]) * 12 + (SORT_MONTHS[match[1].toLowerCase()] ?? 0);
}

/**
 * Month label for the TOTAL tab's row labels ("JULY", "JANUARY" ...). The original hard-codes the
 * contract year: JULY-DECEMBER are 2025, JANUARY-JUNE are 2026. Unknown labels are returned unchanged.
 */
export function budgetMonthLabelFromName(monthName: unknown): string {
  const normalized = String(monthName || "").trim().toUpperCase();
  const monthMap: Record<string, string> = {
    JANUARY: "Jan 2026",
    FEBRUARY: "Feb 2026",
    MARCH: "Mar 2026",
    APRIL: "Apr 2026",
    MAY: "May 2026",
    JUNE: "Jun 2026",
    JULY: "Jul 2025",
    AUGUST: "Aug 2025",
    SEPTEMBER: "Sep 2025",
    OCTOBER: "Oct 2025",
    NOVEMBER: "Nov 2025",
    DECEMBER: "Dec 2025"
  };
  return monthMap[normalized] || String(monthName ?? "");
}

export function budgetNumberFromCell(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return parseBudgetAmount(value);
}

// ---------------------------------------------------------------------------
// Parsing

/** Parses the TOTAL tab (header row containing "EXPENSES"). Returns null when there is no such header. */
export function parseBudgetTotals(rows: BudgetRows): BudgetTotals | null {
  const headerIndex = rows.findIndex((row) => row.map((cell) => String(cell || "").trim().toUpperCase()).includes("EXPENSES"));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim().toUpperCase());
  const indexes = {
    media: headers.indexOf("MEDIA"),
    influencer: headers.indexOf("INFLUENCER"),
    events: headers.indexOf("EVENTS"),
    general: headers.indexOf("GENERAL"),
    expenses: headers.indexOf("EXPENSES")
  };
  const categoryKeys = [
    { key: "media", label: "Media" },
    { key: "influencer", label: "Influencer" },
    { key: "events", label: "Events" },
    { key: "general", label: "General" }
  ] as const;
  const monthRows: BudgetTotals["monthRows"] = [];
  let totalYearRow: string[] | null | undefined = null;
  rows.slice(headerIndex + 1).forEach((row) => {
    const label = String(row[0] || "").trim();
    if (!label) return;
    if (/^TOTAL YEAR$/i.test(label)) {
      totalYearRow = row;
      return;
    }
    if (/^TOTAL/i.test(label)) return;
    const categories = categoryKeys.map((category) => ({
      name: category.label,
      amount: budgetNumberFromCell(row[indexes[category.key]])
    }));
    const expenses = budgetNumberFromCell(row[indexes.expenses]);
    monthRows.push({
      month: budgetMonthLabelFromName(label),
      categories,
      total: expenses
    });
  });
  if (!totalYearRow) totalYearRow = rows.find((row) => /^TOTAL YEAR$/i.test(String(row[0] || "").trim()));
  const yearRow = totalYearRow as string[] | null | undefined;
  const totalExpenses = budgetNumberFromCell(yearRow?.[indexes.expenses]);
  const totalBudget = DEFAULT_TOTAL_BUDGET;
  const workingBudget = totalBudget;
  const remaining = Math.max(0, totalBudget - totalExpenses);
  const totalSpent = totalExpenses;
  const categoryTotals = categoryKeys
    .map((category) => ({
      name: category.label,
      amount: budgetNumberFromCell(yearRow?.[indexes[category.key]])
    }))
    .filter((category) => category.amount);
  return {
    totalBudget,
    workingBudget,
    totalExpenses,
    totalSpent,
    remaining,
    categoryTotals,
    monthRows
  };
}

/** Distinct, sorted values of a column: months chronologically, sheets in budgetSheetNames order, rest A-Z. */
export function uniqueSortedBudgetValues<T extends object>(rows: readonly T[], key: keyof T & string): string[] {
  const values = [...new Set(rows.map((row) => row[key] as unknown as string).filter(Boolean))];
  if (key === "month") return values.sort((left, right) => budgetMonthSortValue(left) - budgetMonthSortValue(right));
  if (key === "sheet") {
    return values.sort((left, right) => {
      const leftIndex = budgetSheetNames.indexOf(left);
      const rightIndex = budgetSheetNames.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
      return left.localeCompare(right);
    });
  }
  return values.sort((left, right) => left.localeCompare(right));
}

/** Looks up to 4 rows above a DATE header for a block title (GENERAL, MEDIA, INFLUENCER, EVENT...). */
export function budgetCategoryFromHeader(rows: BudgetRows, headerIndex: number, colIndex: number): string {
  for (let rowIndex = headerIndex - 1; rowIndex >= Math.max(0, headerIndex - 4); rowIndex -= 1) {
    const label = String(rows[rowIndex]?.[colIndex] || "").trim();
    if (!label) continue;
    if (/GENERAL/i.test(label)) return "General";
    if (/MEDIA/i.test(label)) return "Media";
    if (/INFLUENCER/i.test(label)) return "Influencer";
    if (/EVENT/i.test(label)) return "Events";
    return label.replace(/\s*\(.*?\)\s*/g, "").trim();
  }
  return "General";
}

/** Block title above a header, only when it is one of the known ones (GENERAL, MEDIA, INFLUENCER, EVENT...). */
function knownBlockTitleAbove(rows: BudgetRows, headerIndex: number, colIndex: number): string | null {
  for (let rowIndex = headerIndex - 1; rowIndex >= Math.max(0, headerIndex - 4); rowIndex -= 1) {
    const label = String(rows[rowIndex]?.[colIndex] || "").trim();
    if (!label) continue;
    if (/GENERAL/i.test(label)) return "General";
    if (/MEDIA/i.test(label)) return "Media";
    if (/INFLUENCER/i.test(label)) return "Influencer";
    if (/EVENT/i.test(label)) return "Events";
    return null;
  }
  return null;
}

/** The sheet's fixed block columns, used only when gviz dropped a block's title cell. */
const BLOCK_CATEGORY_BY_COLUMN: Record<number, string> = { 0: "Events", 4: "Influencer", 8: "Media" };

interface HeaderPoint {
  rowIndex: number;
  colIndex: number;
  category: string;
  forecast?: boolean;
}

/**
 * Parses one month tab. Expected layout (blocks side by side, each 4 columns wide):
 * a DATE | WHY | WHAT | amount header, a block title (EVENTS / INFLUENCER / MEDIA / GENERAL) above it,
 * rows below until the next header in the same column. A WHAT | amount header that is not preceded by
 * a DATE column starts a forecast block. Lines containing "total"/"totale" are skipped.
 */
export interface ParseBudgetRowsOptions {
  /**
   * Called with the row/column index (in `rows`) of a transaction's AMOUNT cell. Return the cell's address (e.g. "L5")
   * to exclude the transaction, or null to keep it. Excluded transactions go to `excluded`, not `transactions`.
   */
  excludeAmountCell?: (rowIndex: number, colIndex: number) => string | null;
}

export function parseBudgetRows(rows: BudgetRows, sheetName = "", options: ParseBudgetRowsOptions = {}): ParsedBudgetSheet {
  const excluded: BudgetExcludedItem[] = [];
  const title = sheetName || rows[0]?.find((cell) => String(cell || "").trim()) || "Budget";
  const transactions: BudgetTransaction[] = [];
  const forecast: BudgetForecastItem[] = [];
  const headerPoints: HeaderPoint[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const label = String(cell || "").trim().toUpperCase();
      const next3 = String(row[colIndex + 3] || "").trim();
      const whyWhat = String(row[colIndex + 1] || "").trim().toUpperCase() === "WHY" && String(row[colIndex + 2] || "").trim().toUpperCase() === "WHAT";
      if (label === "DATE" && (next3 || whyWhat)) {
        headerPoints.push({ rowIndex, colIndex, category: budgetCategoryFromHeader(rows, rowIndex, colIndex) });
      } else if (label === "" && whyWhat) {
        // gviz blanks the DATE label (and often the block title) over a column of real dates: the header is then
        // just "" | WHY | WHAT. Category: known title above, else a second header in the same column is the
        // GENERAL buffer block, else the sheet's fixed column order.
        const category = knownBlockTitleAbove(rows, rowIndex, colIndex)
          ?? (headerPoints.some((point) => point.colIndex === colIndex && !point.forecast) ? "General" : BLOCK_CATEGORY_BY_COLUMN[colIndex] ?? "General");
        headerPoints.push({ rowIndex, colIndex, category });
      }
      if (
        label === "WHAT" && String(row[colIndex + 1] || "").trim() && String(row[colIndex - 2] || "").trim().toUpperCase() !== "DATE"
        && !(String(row[colIndex - 1] || "").trim().toUpperCase() === "WHY" && !String(row[colIndex - 2] || "").trim()) // "" | WHY | WHAT is a blank-DATE transaction header, not a forecast
      ) {
        headerPoints.push({ rowIndex, colIndex, category: "Forecast", forecast: true });
      }
    });
  });

  headerPoints.forEach((header) => {
    const nextHeader = headerPoints
      .filter((candidate) => candidate.colIndex === header.colIndex && candidate.rowIndex > header.rowIndex)
      .sort((left, right) => left.rowIndex - right.rowIndex)[0];
    const stopRow = nextHeader?.rowIndex || rows.length;
    for (let rowIndex = header.rowIndex + 1; rowIndex < stopRow; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (header.forecast) {
        const what = String(row[header.colIndex] || "").trim();
        const amount = parseBudgetAmount(row[header.colIndex + 1]);
        if (what && amount) forecast.push({ what, amount });
        continue;
      }
      const date = String(row[header.colIndex] || "").trim();
      const why = String(row[header.colIndex + 1] || "").trim();
      const what = String(row[header.colIndex + 2] || "").trim();
      const amountCell = String(row[header.colIndex + 3] || "").trim();
      const amount = parseBudgetAmount(amountCell);
      const isTotal = [date, why, what, amountCell].some((value) => /totale|total/i.test(value));
      if (isTotal || !amount || (!date && !why && !what)) continue;
      const transaction: BudgetTransaction = {
        sheet: sheetName || title,
        category: header.category,
        date,
        why,
        what,
        amount,
        month: budgetMonthKey(date, title)
      };
      const cell = options.excludeAmountCell?.(rowIndex, header.colIndex + 3) ?? null;
      if (cell) excluded.push({ ...transaction, cell, reason: "red" });
      else transactions.push(transaction);
    }
  });
  return { title, transactions, forecast, excluded };
}

/** Title shown above the dashboard, e.g. "Jul 2025 - Aug 2026 (14 month tabs)". */
export function budgetTitleFromSheets(
  parsedSheets: ReadonlyArray<{ sheetName?: string; transactions?: ReadonlyArray<{ month: string }> }>
): string {
  const months = parsedSheets
    .flatMap((sheet) => [
      budgetMonthLabelFromSheetName(sheet.sheetName),
      ...((sheet.transactions || []).map((row) => row.month))
    ])
    .filter(Boolean)
    .sort((left, right) => budgetMonthSortValue(left) - budgetMonthSortValue(right));
  if (!months.length) return parsedSheets.length ? `All tabs (${parsedSheets.length})` : "Budget";
  const first = months[0];
  const last = months[months.length - 1];
  return `${first}${last !== first ? ` - ${last}` : ""} (${parsedSheets.length} month tabs)`;
}

/** Sum amounts by `key`, biggest first. Missing keys are grouped under "-". */
export function aggregateBudget<T extends { amount?: number }>(items: readonly T[], key: keyof T & string): BudgetAggregate[] {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const name = (item[key] as unknown as string) || "-";
    totals.set(name, (totals.get(name) || 0) + (item.amount || 0));
  });
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((left, right) => right.amount - left.amount);
}

/** Builds the dashboard summary from the transactions (plus optional xlsx-derived base fields). */
export function budgetSummaryFromTransactions(
  baseSummary: Partial<BudgetSummary> | null | undefined,
  transactions: readonly BudgetTransaction[]
): BudgetSummary {
  const totalBudget = baseSummary?.totalBudget || DEFAULT_TOTAL_BUDGET;
  const categoryTotals = aggregateBudget(transactions, "category");
  const monthTotals = aggregateBudget(transactions, "month")
    .sort((left, right) => budgetMonthSortValue(left.name) - budgetMonthSortValue(right.name));
  const monthRows: BudgetMonthRow[] = monthTotals.map((month) => ({
    month: month.name,
    total: month.amount,
    categories: aggregateBudget(transactions.filter((row) => row.month === month.name), "category")
  }));
  const calculatedSpent = transactions.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalSpent = Number.isFinite(baseSummary?.totalSpentFromTotalCell)
    ? (baseSummary!.totalSpentFromTotalCell as number)
    : calculatedSpent;
  const officialRemaining = Number.isFinite(baseSummary?.remainingFromTotalCell)
    ? (baseSummary!.remainingFromTotalCell as number)
    : null;
  return {
    ...(baseSummary || {}),
    totalBudget,
    workingBudget: baseSummary?.workingBudget || totalBudget,
    totalExpenses: totalSpent,
    totalSpent,
    remaining: officialRemaining ?? Math.max(0, totalBudget - totalSpent),
    categoryTotals,
    monthRows
  };
}

/**
 * Balance "today" for the waterfall: residual at June minus the July-September extension spend and fees.
 * null when the summary has no residualAtJune (always the case for CSV-only data).
 */
export function budgetTodayBalance(summary: Partial<BudgetSummary> | null | undefined): number | null {
  const residual = summary?.residualAtJune;
  if (typeof residual !== "number" || !Number.isFinite(residual)) return null;
  const steps = [
    (summary?.extensionJul || 0) + (summary?.julFee || 0),
    (summary?.extensionAug || 0) + (summary?.augFee || 0),
    (summary?.extensionSept || 0) + (summary?.septFee || 0)
  ];
  return steps.reduce((balance, spend) => balance - spend, residual);
}

// ---------------------------------------------------------------------------
// Loading: shared

function emptyBudgetData(): BudgetData {
  return {
    title: "Budget",
    transactions: [],
    forecast: [],
    sheets: [],
    summary: budgetSummaryFromTransactions(null, []),
    excluded: [],
    colorsUnavailable: false
  };
}

/** A text GET that already applies timeout, signal, concurrency limit and 429 retry. */
export type TextRequest = (url: string) => Promise<FetchedText>;

export interface BudgetLoadOptions {
  signal?: AbortSignal;
  /** Per-request timeout of the CSV path, default 12 000 ms. */
  timeoutMs?: number;
  /** Timeout of the single workbook download, default 30 000 ms. */
  workbookTimeoutMs?: number;
  /** Fetch a nonexistent tab once to recognise gviz's "default tab" answer for missing names. Default true. */
  detectMissingTabs?: boolean;
  /** `&headers=N` on the gviz URLs. Default 0 (stops gviz from swallowing the sheet's header row). */
  gvizHeaders?: number;
  /** CSV path: maximum simultaneous requests, default 4 (Google answers 429 to bursts). */
  concurrency?: number;
  /** CSV path: wait before the single retry of a request that got HTTP 429 or a network failure, default 1500 ms. */
  retryDelayMs?: number;
  /** Skip the workbook and go straight to the CSV path. */
  skipWorkbook?: boolean;
  /** Internal: a prepared request function (shared limiter) used by the CSV path. */
  request?: TextRequest;
}

export const BUDGET_WORKBOOK_TIMEOUT_MS = 30_000;
export const BUDGET_CSV_CONCURRENCY = 4;
export const BUDGET_RETRY_DELAY_MS = 1500;

/** Builds the polite request function of the CSV path: at most `concurrency` in flight, one retry on 429 / network failure. */
export function createBudgetRequest(options: BudgetLoadOptions = {}): TextRequest {
  const limit = createLimiter(options.concurrency ?? BUDGET_CSV_CONCURRENCY);
  const timeoutOptions = { timeoutMs: options.timeoutMs ?? BUDGET_TAB_TIMEOUT_MS, signal: options.signal };
  const attempt = (url: string) => fetchText(url, { cache: "no-store" }, timeoutOptions);
  return (url) => limit(async () => {
    try {
      const first = await attempt(url);
      if (first.status !== 429) return first;
    } catch (error) {
      // Google's 429 carries no CORS headers, so a browser reports it as a plain network failure.
      if (!(error instanceof FetchFailure) || error.kind !== "network") throw error;
    }
    await sleep(options.retryDelayMs ?? BUDGET_RETRY_DELAY_MS, options.signal);
    return attempt(url);
  });
}

function normalizeCsvText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}

function errorKindOf(kind: FetchFailureKind): BudgetErrorKind {
  return kind;
}

const ERROR_PRIORITY: BudgetErrorKind[] = ["access", "timeout", "network", "http", "invalid", "aborted"];

function summarizeFailures(failed: Array<{ errorKind?: BudgetErrorKind }>): BudgetLoadError {
  const kind = ERROR_PRIORITY.find((candidate) => failed.some((tab) => tab.errorKind === candidate)) ?? "network";
  const message: Record<BudgetErrorKind, string> = {
    access: "Cannot read the Budget sheet. Check that the Google Sheet is public with link access.",
    timeout: "The Budget sheet did not answer in time. Check your connection and try again.",
    network: "Cannot reach Google Sheets. Check your connection and try again.",
    http: "Google Sheets returned an error while loading the Budget. Try again in a moment.",
    invalid: "The Budget sheet could not be read. Try again in a moment.",
    aborted: "Loading the Budget was cancelled."
  };
  return { kind, message: message[kind] };
}

// ---------------------------------------------------------------------------
// Official summary (the sheet's TOTAL tab): total spent, integration and remaining budget

/** The figures the team's own TOTAL tab states. Every value is null when its row is missing or blank. */
export interface BudgetOfficialSummary {
  /** Row "TOTAL SPENT". */
  totalSpent: number | null;
  /** Row "INTEGRATION": budget added on top of the base budget. */
  integration: number | null;
  /** Row "REMAINING BUDGET". */
  remaining: number | null;
  /** totalSpent + remaining, when both are known: everything that was available. */
  totalAvailable: number | null;
  /** totalAvailable - integration, when known: the budget before the integration. */
  baseBudget: number | null;
}

const OFFICIAL_ROWS = {
  totalSpent: /^TOTAL SPENT$/i,
  integration: /^INTEGRATION$/i,
  remaining: /^REMAINING BUDGET$/i
} as const;

function lastAmountInRow(row: string[]): number | null {
  for (let index = row.length - 1; index >= 1; index -= 1) {
    const cell = String(row[index] ?? "").trim();
    if (!cell || !/[0-9]/.test(cell)) continue;
    const value = parseBudgetAmount(cell);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** Reads the labelled summary rows. Looked up by label (not by position) so added months do not move them. */
export function parseBudgetOfficialSummary(rows: BudgetRows): BudgetOfficialSummary | null {
  const found: Record<keyof typeof OFFICIAL_ROWS, number | null> = { totalSpent: null, integration: null, remaining: null };
  let any = false;
  (Object.keys(OFFICIAL_ROWS) as (keyof typeof OFFICIAL_ROWS)[]).forEach((key) => {
    const row = rows.find((candidate) => OFFICIAL_ROWS[key].test(String(candidate[0] ?? "").trim()));
    if (!row) return;
    found[key] = lastAmountInRow(row);
    if (found[key] !== null) any = true;
  });
  if (!any) return null;
  const totalAvailable = found.totalSpent !== null && found.remaining !== null ? found.totalSpent + found.remaining : null;
  const baseBudget = totalAvailable !== null && found.integration !== null ? totalAvailable - found.integration : null;
  return { ...found, totalAvailable, baseBudget };
}

export type BudgetOfficialOutcome =
  | { status: "ok"; summary: BudgetOfficialSummary }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * CSV path: fetches the TOTAL tab as CSV. Never throws: the Budget works without it, it just cannot show the
 * remaining budget. `request` lets the caller route it through the shared limiter.
 */
export async function loadBudgetOfficialSummary(
  signal?: AbortSignal,
  timeoutMs = BUDGET_TAB_TIMEOUT_MS,
  request?: TextRequest
): Promise<BudgetOfficialOutcome> {
  const urls = [budgetTabUrl("TOTAL", 0), budgetTabUrl("TOT", 0)];
  const get: TextRequest = request ?? ((url) => fetchText(url, { cache: "no-store" }, { timeoutMs, signal }));
  let lastError = "";
  for (const url of urls) {
    try {
      const response = await get(url);
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      if (looksLikeHtml(response.text, response.contentType)) { lastError = "Received a web page instead of CSV"; continue; }
      const summary = parseBudgetOfficialSummary(parseCsv(response.text.replace(/^﻿/, "")));
      if (summary) return { status: "ok", summary };
    } catch (error) {
      if (signal?.aborted) return { status: "error", message: "Cancelled" };
      lastError = error instanceof FetchFailure ? error.message : "Network error";
    }
  }
  return lastError ? { status: "error", message: lastError } : { status: "missing" };
}

// ---------------------------------------------------------------------------
// Loading: workbook (primary path, one request)

export interface BudgetSheetRows {
  name: string;
  rows: BudgetRows;
  /**
   * Red-fill information for tabs in RED_EXCLUSION_TABS (workbook path). `cellAt` maps an index in `rows` (blank rows
   * were dropped, so it is NOT the sheet row) to the cell address, and `redCells` holds the addresses with a red fill.
   */
  colors?: { cellAt: (rowIndex: number, colIndex: number) => string; redCells: ReadonlySet<string> };
}

export interface BudgetFromSheets {
  data: BudgetData;
  tabs: BudgetTabReport[];
  official: BudgetOfficialSummary | null;
}

const TOTAL_TAB = /^TOT(AL)?$/i;

/**
 * Port of the original parseBudgetWorkbook, working on rows already extracted from each worksheet (so it is
 * testable without SheetJS). Month tabs are every sheet except TOTAL/TOT, in workbook order. The TOTAL tab
 * feeds parseBudgetTotals (the original "EXPENSES" layout, residual and fee rows) and parseBudgetOfficialSummary.
 */
export function budgetFromSheetRows(sheets: readonly BudgetSheetRows[]): BudgetFromSheets {
  const totalSheet = sheets.find((sheet) => TOTAL_TAB.test(String(sheet.name || "").trim()));
  const totalRows = totalSheet?.rows ?? [];
  const summary: (BudgetTotals & Partial<BudgetSummary>) | null = parseBudgetTotals(totalRows);
  // Resolve summary rows by label: adding months or fees moves their addresses.
  const expenseHeader = totalRows.find((row) => row.some((cell) => /^EXPENSES$/i.test(String(cell).trim())));
  const expenseColumn = expenseHeader?.findIndex((cell) => /^EXPENSES$/i.test(String(cell).trim())) ?? -1;
  const readTotal = (label: RegExp): number | null => {
    const row = totalRows.find((candidate) => label.test(String(candidate[0] || "").trim()));
    const value = row?.[expenseColumn];
    return value === undefined || String(value).trim() === "" ? null : budgetNumberFromCell(value);
  };
  if (summary) {
    const totalSpentFromTotalCell = readTotal(/^TOTAL$/i);
    const remainingFromTotalCell = readTotal(/^REMAINING BUDGET$/i);
    if (Number.isFinite(totalSpentFromTotalCell)) summary.totalSpentFromTotalCell = totalSpentFromTotalCell;
    if (Number.isFinite(remainingFromTotalCell)) summary.remainingFromTotalCell = remainingFromTotalCell;
    summary.contractMonthRows = summary.monthRows;
    summary.residualAtJune = readTotal(/^RESIDUAL AT/i);
    summary.extensionJul = readTotal(/^JULY 2026 - EXTENSION$/i);
    summary.extensionAug = readTotal(/^AUG 2026 - EXTENSION$/i);
    summary.extensionSept = readTotal(/^SEPT 2026 - EXTENSION$/i);
    summary.julFee = readTotal(/^JUL26 FEE$/i);
    summary.augFee = readTotal(/^AUG26 FEE$/i);
    summary.septFee = readTotal(/^SEPT26 FEE$/i);
    summary.newQuarterBudget = readTotal(/^MEDIA BUDGET/i);
  }

  const monthSheets = sheets.filter((sheet) => !TOTAL_TAB.test(String(sheet.name || "").trim()));
  const parsedAll = monthSheets.map((sheet) => {
    const colors = RED_EXCLUSION_TABS.includes(String(sheet.name || "").trim().toUpperCase()) ? sheet.colors : undefined;
    const excludeAmountCell = colors
      ? (rowIndex: number, colIndex: number) => {
          const cell = colors.cellAt(rowIndex, colIndex);
          return colors.redCells.has(cell) ? cell : null;
        }
      : undefined;
    return { sheetName: sheet.name, ...parseBudgetRows(sheet.rows, sheet.name, { excludeAmountCell }) };
  });
  const hasRows = (parsed: { transactions: unknown[]; forecast: unknown[]; excluded: unknown[] }) =>
    parsed.transactions.length > 0 || parsed.forecast.length > 0 || parsed.excluded.length > 0;
  const tabs: BudgetTabReport[] = parsedAll.map((parsed) =>
    hasRows(parsed)
      ? {
          name: parsed.sheetName,
          status: "loaded",
          transactions: parsed.transactions.length,
          forecast: parsed.forecast.length,
          ...(parsed.excluded.length ? { excluded: parsed.excluded.length } : {})
        }
      : { name: parsed.sheetName, status: "empty", reason: "No budget rows found in this tab" }
  );
  const parsedSheets = parsedAll.filter(hasRows);
  const feeTransactions: BudgetTransaction[] = [
    { sheetName: "JUL26", amount: summary?.julFee },
    { sheetName: "AUG26", amount: summary?.augFee },
    { sheetName: "SEP26", amount: summary?.septFee }
  ]
    .filter((item): item is { sheetName: string; amount: number } => typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount !== 0)
    .map((item) => ({
      sheet: item.sheetName,
      category: "Fee",
      date: "",
      why: "Management fee",
      what: "Monthly NOku fee (extension)",
      amount: item.amount,
      month: budgetMonthLabelFromSheetName(item.sheetName)
    }));
  const transactions = parsedSheets.flatMap((sheet) => sheet.transactions).concat(feeTransactions);
  return {
    data: {
      title: budgetTitleFromSheets(parsedSheets),
      transactions,
      forecast: parsedSheets.flatMap((sheet) => sheet.forecast),
      sheets: parsedSheets.map((sheet) => sheet.sheetName),
      summary: budgetSummaryFromTransactions(summary, transactions),
      excluded: parsedSheets.flatMap((sheet) => sheet.excluded),
      colorsUnavailable: false
    },
    tabs,
    official: parseBudgetOfficialSummary(totalRows)
  };
}

export type BudgetWorkbookOutcome =
  | { ok: true; data: BudgetData; tabs: BudgetTabReport[]; official: BudgetOfficialSummary | null }
  | { ok: false; error: BudgetLoadError };

/** True when the bytes start with the zip signature "PK" (an .xlsx is a zip). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Primary path: ONE request for the whole workbook, parsed with SheetJS (loaded on demand, so only the Budget view
 * pays for it). Never throws; failures come back as `{ok: false, error}` so the caller can fall back to CSV.
 */
export async function loadBudgetFromWorkbook(signal?: AbortSignal, timeoutMs = BUDGET_WORKBOOK_TIMEOUT_MS): Promise<BudgetWorkbookOutcome> {
  let response;
  try {
    response = await fetchBytes(budgetWorkbookUrl, { cache: "no-store" }, { timeoutMs, signal });
  } catch (error) {
    const failure = error instanceof FetchFailure ? error : new FetchFailure("network", "Network error");
    return { ok: false, error: { kind: errorKindOf(failure.kind), message: failure.message } };
  }
  if (!response.ok) {
    const access = response.status === 401 || response.status === 403;
    return {
      ok: false,
      error: { kind: access ? "access" : "http", message: access ? `HTTP ${response.status}: the sheet is not accessible without signing in` : `HTTP ${response.status}` }
    };
  }
  if (!looksLikeZip(response.bytes)) {
    const head = new TextDecoder().decode(response.bytes.subarray(0, 500));
    return looksLikeHtml(head, response.contentType)
      ? { ok: false, error: { kind: "access", message: "Received a web page instead of the workbook (the sheet is probably not shared with link access)" } }
      : { ok: false, error: { kind: "invalid", message: "The download is not an Excel workbook" } };
  }
  try {
    const XLSX = await import("xlsx");
    // cellStyles: needed to see the red cell fills of the RED_EXCLUSION_TABS
    const workbook = XLSX.read(response.bytes, { type: "array", cellHTML: false, cellFormula: false, cellDates: true, cellStyles: true });
    const sheets: BudgetSheetRows[] = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      if (!sheet || !sheet["!ref"]) return { name, rows: [] };
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      // sheet_to_json(header:1) starts at the range's first row/column; blank rows are dropped below, so remember
      // each kept row's real sheet row to map red markers back to the right parsed row.
      const rows: BudgetRows = [];
      const sheetRowOf: number[] = [];
      XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }).forEach((row, index) => {
        const cells = row.map((cell) => String(cell || "").trim());
        if (!cells.some(Boolean)) return;
        rows.push(cells);
        sheetRowOf.push(range.s.r + index);
      });
      if (!RED_EXCLUSION_TABS.includes(name.trim().toUpperCase())) return { name, rows };
      const redCells = new Set<string>();
      for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) continue;
        const style = (sheet[address] as { s?: { patternType?: string; fgColor?: { rgb?: string } } }).s;
        if (style?.patternType === "solid" && isRedFill(style.fgColor?.rgb)) redCells.add(address);
      }
      return {
        name,
        rows,
        colors: { redCells, cellAt: (rowIndex, colIndex) => XLSX.utils.encode_cell({ r: sheetRowOf[rowIndex], c: range.s.c + colIndex }) }
      };
    });
    const parsed = budgetFromSheetRows(sheets);
    if (!parsed.data.sheets.length) {
      return { ok: false, error: { kind: "invalid", message: "The workbook holds no budget rows" } };
    }
    return { ok: true, ...parsed };
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    return { ok: false, error: { kind: "invalid", message: `Could not read the workbook${detail}` } };
  }
}

// ---------------------------------------------------------------------------
// Loading: CSV per tab (fallback)

interface TabOutcome {
  report: BudgetTabReport;
  sheet?: ParsedBudgetSheet;
}

function classifyTabText(name: string, text: string, contentType: string, sentinelText: string | null): TabOutcome {
  if (looksLikeHtml(text, contentType)) {
    return {
      report: {
        name,
        status: "error",
        errorKind: "access",
        reason: "Received a web page instead of CSV (the sheet is probably not shared with link access)"
      }
    };
  }
  const normalized = normalizeCsvText(text);
  if (!normalized) return { report: { name, status: "empty", reason: "The tab is blank" } };
  if (sentinelText !== null && normalized === sentinelText) {
    return { report: { name, status: "missing", reason: "The tab does not exist (the sheet answered with its default tab)" } };
  }
  const parsed = parseBudgetRows(parseCsv(text.replace(/^﻿/, "")), name);
  if (!parsed.transactions.length && !parsed.forecast.length) {
    return { report: { name, status: "empty", reason: "No budget rows found in this tab" } };
  }
  return {
    report: { name, status: "loaded", transactions: parsed.transactions.length, forecast: parsed.forecast.length },
    sheet: parsed
  };
}

async function fetchBudgetTab(name: string, sentinel: Promise<string | null>, request: TextRequest, options: BudgetLoadOptions): Promise<TabOutcome> {
  try {
    const response = await request(budgetTabUrl(name, options.gvizHeaders ?? 0));
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        return { report: { name, status: "missing", reason: `HTTP ${response.status}` } };
      }
      const access = response.status === 401 || response.status === 403;
      return {
        report: {
          name,
          status: "error",
          errorKind: access ? "access" : "http",
          reason: access ? `HTTP ${response.status}: the sheet is not accessible without signing in` : `HTTP ${response.status}`
        }
      };
    }
    return classifyTabText(name, response.text, response.contentType, await sentinel);
  } catch (error) {
    const failure = error instanceof FetchFailure ? error : new FetchFailure("network", "Network error");
    return { report: { name, status: "error", errorKind: errorKindOf(failure.kind), reason: failure.message } };
  }
}

async function fetchSentinelText(request: TextRequest, options: BudgetLoadOptions): Promise<string | null> {
  if (options.detectMissingTabs === false) return null;
  try {
    const response = await request(budgetTabUrl(BUDGET_MISSING_TAB_SENTINEL, options.gvizHeaders ?? 0));
    if (!response.ok || looksLikeHtml(response.text, response.contentType)) return null;
    const normalized = normalizeCsvText(response.text);
    return normalized || null;
  } catch {
    return null;
  }
}

export interface BudgetCsvSheetsOutcome {
  data: BudgetData;
  tabs: BudgetTabReport[];
}

/** Fetches the month tabs through gviz (politely: limited concurrency) and merges the ones that hold data. */
export async function loadBudgetCsvSheets(options: BudgetLoadOptions = {}): Promise<BudgetCsvSheetsOutcome> {
  const request = options.request ?? createBudgetRequest(options);
  // The sentinel is queued first; a tab only waits for it once it has its own text.
  const sentinel = fetchSentinelText(request, options);
  const tabOutcomes = await Promise.all(budgetSheetNamesFor().map((name) => fetchBudgetTab(name, sentinel, request, options)));
  const tabs = tabOutcomes.map((outcome) => outcome.report);
  const parsedSheets = tabOutcomes.flatMap((outcome) => (outcome.sheet ? [outcome.sheet] : []));
  const transactions = parsedSheets.flatMap((sheet) => sheet.transactions);
  const data: BudgetData = {
    // the original passes { sheetName: sheet.title, ...sheet }
    title: budgetTitleFromSheets(parsedSheets.map((sheet) => ({ sheetName: sheet.title, ...sheet }))),
    transactions,
    forecast: parsedSheets.flatMap((sheet) => sheet.forecast),
    sheets: parsedSheets.map((sheet) => sheet.title),
    summary: budgetSummaryFromTransactions(null, transactions),
    excluded: [],
    colorsUnavailable: true
  };
  return { data, tabs };
}

/**
 * The month tabs through gviz CSV, then (only if no tab produced data) the single "current tab" CSV export as the
 * original did. Missing and empty tabs are normal (the name list holds aliases) and are not failures. A tab that
 * errors (network, timeout, HTTP error, HTML login page) is reported in `failedTabs` / `tabs`.
 */
async function loadBudgetBase(signal: AbortSignal | undefined, options: Omit<BudgetLoadOptions, "signal">, request: TextRequest): Promise<BudgetResult> {
  const loadOptions: BudgetLoadOptions = { ...options, signal, request };
  const { data: tabData, tabs } = await loadBudgetCsvSheets(loadOptions);
  if (signal?.aborted) {
    return { status: "failed", error: { kind: "aborted", message: "Loading the Budget was cancelled." }, tabs };
  }
  const failedTabs = tabs.filter((tab) => tab.status === "error");

  let data = tabData;
  let fallbackUsed = false;
  if (!tabData.transactions.length && !tabData.forecast.length) {
    // Original behaviour: when no month tab produced data, try the "current tab" CSV export.
    try {
      const response = await request(budgetCsvUrl);
      if (!response.ok) throw new FetchFailure("network", `HTTP ${response.status}`);
      if (looksLikeHtml(response.text, response.contentType)) {
        failedTabs.push({ name: "Current tab", status: "error", errorKind: "access", reason: "Received a web page instead of CSV" });
      } else {
        const parsed = parseBudgetRows(parseCsv(response.text.replace(/^﻿/, "")), "Current tab");
        fallbackUsed = true;
        data = {
          title: parsed.title,
          transactions: parsed.transactions,
          forecast: parsed.forecast,
          sheets: [],
          summary: budgetSummaryFromTransactions(null, parsed.transactions),
          excluded: [],
          colorsUnavailable: true
        };
      }
    } catch (error) {
      if (signal?.aborted) {
        return { status: "failed", error: { kind: "aborted", message: "Loading the Budget was cancelled." }, tabs };
      }
      const failure = error instanceof FetchFailure ? error : null;
      const isHttp = failure?.kind === "network" && /^HTTP \d+$/.test(failure.message);
      failedTabs.push({
        name: "Current tab",
        status: "error",
        errorKind: failure ? (isHttp ? "http" : errorKindOf(failure.kind)) : "network",
        reason: failure?.message ?? "Network error"
      });
    }
    if (!fallbackUsed && !failedTabs.length) data = emptyBudgetData();
  }

  const hasData = data.transactions.length > 0 || data.forecast.length > 0;
  if (!hasData && failedTabs.length) {
    return { status: "failed", error: summarizeFailures(failedTabs), tabs };
  }
  if (failedTabs.length) {
    return { status: "partial", source: "csv", data, failedTabs, tabs, fallbackUsed };
  }
  return { status: "loaded", source: "csv", data, tabs, fallbackUsed };
}

/** CSV-per-tab path: the month tabs and the TOTAL tab together. The TOTAL tab only adds figures: its failure never fails the Budget. */
export async function loadBudgetFromCsvTabs(signal?: AbortSignal, options: Omit<BudgetLoadOptions, "signal"> = {}): Promise<BudgetResult> {
  const request = options.request ?? createBudgetRequest({ ...options, signal });
  const [base, official] = await Promise.all([
    loadBudgetBase(signal, options, request),
    loadBudgetOfficialSummary(signal, options.timeoutMs, request)
  ]);
  if (base.status === "failed") return base;
  return {
    ...base,
    official: official.status === "ok" ? official.summary : null,
    ...(official.status === "error" ? { officialError: official.message } : {})
  };
}

// ---------------------------------------------------------------------------
// Loading: entry point

/**
 * Loads the Budget. Primary path: the whole workbook in one request. If that fails for any reason (network, CORS,
 * HTML login page, not a zip, unreadable, no budget rows) the polite CSV-per-tab path is used and the reason is
 * reported as `workbookError`. The TOTAL figures (`official`) come from the workbook or, in the fallback, from the
 * TOTAL tab CSV; they only add to a result and never turn a good load into a failure.
 */
export async function loadBudget(signal?: AbortSignal, options: Omit<BudgetLoadOptions, "signal"> = {}): Promise<BudgetResult> {
  let workbookError: BudgetLoadError | undefined;
  if (!options.skipWorkbook) {
    const workbook = await loadBudgetFromWorkbook(signal, options.workbookTimeoutMs);
    if (workbook.ok) {
      return {
        status: "loaded",
        source: "workbook",
        data: workbook.data,
        tabs: workbook.tabs,
        fallbackUsed: false,
        official: workbook.official
      };
    }
    if (signal?.aborted || workbook.error.kind === "aborted") {
      return { status: "failed", error: { kind: "aborted", message: "Loading the Budget was cancelled." }, tabs: [], workbookError: workbook.error };
    }
    workbookError = workbook.error;
  }
  const csv = await loadBudgetFromCsvTabs(signal, options);
  return workbookError ? { ...csv, workbookError } : csv;
}
