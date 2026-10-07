/**
 * Pure helpers for the Budget view: category identity, month grouping, date parsing and sorting.
 * No React, no I/O. Everything here derives from the transactions the data module returns;
 * nothing is invented (no total budget, no forecast total).
 */

import { budgetMonthSortValue, type BudgetTransaction } from "../../external/budget";

export const NO_DATE = "No date";
export const ALL_MONTHS = "all";

// ---------------------------------------------------------------------------
// Category identity (fixed order, never cycled; colors follow the entity)

/** Brand category colors from the original app. Chart colors are data colors, so raw hex is allowed here. */
const KNOWN_CATEGORIES = [
  { name: "Influencer", color: "#ff7200" },
  { name: "Media", color: "#17120f" },
  { name: "Events", color: "#ffc233" },
  { name: "Fee", color: "#b1a596" }
] as const;
/** Everything the sheet calls something else folds into one neutral bucket (a 6th hue would fail the validator). */
const OTHER = { name: "Other", color: "#605852" } as const;

const CATEGORY_ORDER: readonly string[] = [...KNOWN_CATEGORIES.map((c) => c.name), OTHER.name];

/**
 * Chart bucket of a raw sheet category. The sheet's GENERAL block is the agency fee (the original
 * relabels it "Fee" on screen), so General and Fee are one bucket.
 */
export function categoryBucket(raw: string): string {
  const text = (raw || "").trim().toLowerCase();
  if (text === "general" || text === "fee") return "Fee";
  const known = KNOWN_CATEGORIES.find((c) => c.name.toLowerCase() === text);
  return known ? known.name : OTHER.name;
}

export function categoryColor(bucket: string): string {
  return KNOWN_CATEGORIES.find((c) => c.name === bucket)?.color ?? OTHER.color;
}

/** Label used in the transactions table: the sheet's own text, with General shown as Fee. */
export function categoryLabel(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "Other";
  return text.toLowerCase() === "general" ? "Fee" : text;
}

export function compareBuckets(a: string, b: string): number {
  return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
}

// ---------------------------------------------------------------------------
// Slices and series

export interface Slice {
  /** Chart bucket name (Influencer, Media, Events, Fee, Other). */
  name: string;
  amount: number;
  count: number;
}

/** Spend per bucket, biggest first. */
export function categorySlices(transactions: readonly BudgetTransaction[]): Slice[] {
  const map = new Map<string, Slice>();
  transactions.forEach((t) => {
    const name = categoryBucket(t.category);
    const slice = map.get(name) ?? { name, amount: 0, count: 0 };
    slice.amount += t.amount || 0;
    slice.count += 1;
    map.set(name, slice);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount || compareBuckets(a.name, b.name));
}

export interface MonthPoint {
  month: string;
  total: number;
  count: number;
  /** Per bucket, in the fixed stacking order. */
  parts: Slice[];
}

/** Months with data, chronological ("No date" last). */
export function monthOptions(transactions: readonly BudgetTransaction[]): string[] {
  const months = [...new Set(transactions.map((t) => t.month).filter(Boolean))];
  return months.sort((a, b) => budgetMonthSortValue(a) - budgetMonthSortValue(b));
}

export function monthSeries(transactions: readonly BudgetTransaction[]): MonthPoint[] {
  return monthOptions(transactions).map((month) => {
    const rows = transactions.filter((t) => t.month === month);
    const parts = categorySlices(rows).sort((a, b) => compareBuckets(a.name, b.name));
    return { month, total: rows.reduce((sum, t) => sum + (t.amount || 0), 0), count: rows.length, parts };
  });
}

/** Buckets present anywhere in the data, in stacking order (the legend). */
export function presentBuckets(transactions: readonly BudgetTransaction[]): string[] {
  return [...new Set(transactions.map((t) => categoryBucket(t.category)))].sort(compareBuckets);
}

export function filterByMonth(transactions: readonly BudgetTransaction[], month: string): BudgetTransaction[] {
  return month === ALL_MONTHS ? [...transactions] : transactions.filter((t) => t.month === month);
}

export function sumAmounts(transactions: readonly BudgetTransaction[]): number {
  return transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
}

/** Month immediately before `month` in the list of months that have data, or null. Neither side may be "No date". */
export function previousMonthWithData(months: readonly string[], month: string): string | null {
  if (month === NO_DATE || month === ALL_MONTHS) return null;
  const dated = months.filter((m) => budgetMonthSortValue(m) < 999999);
  const index = dated.indexOf(month);
  return index > 0 ? dated[index - 1] : null;
}

/** Whole-number percent; "<1%" for a real but tiny share. */
export function percentLabel(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%";
  const pct = (part / whole) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

// ---------------------------------------------------------------------------
// Dates

const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseMonthLabel(label: string): { month: number; year: number } | null {
  const match = String(label || "").match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  return month === undefined ? null : { month, year: Number(match[2]) };
}

function makeDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day, 12);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

/**
 * Reads the sheet's raw date cell. The cell text depends on the sheet locale, so day/month order is
 * decided from the tab's own month when the text is ambiguous (12/08/2026 on an AUG26 tab is 12 August).
 * Returns null when the text cannot be read with confidence: the UI then shows the raw text as written.
 */
export function parseTransactionDate(raw: string, monthLabel = ""): Date | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const ref = parseMonthLabel(monthLabel);

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const numeric = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const dayFirst = makeDate(year, b - 1, a);
    const monthFirst = makeDate(year, a - 1, b);
    if (dayFirst && monthFirst && a !== b) {
      if (!ref) return null;
      const dayFirstFits = dayFirst.getMonth() === ref.month;
      const monthFirstFits = monthFirst.getMonth() === ref.month;
      if (dayFirstFits === monthFirstFits) return null;
      return dayFirstFits ? dayFirst : monthFirst;
    }
    return dayFirst ?? monthFirst;
  }

  const named = text.match(/^(\d{1,2})[\s\-/]*([A-Za-z]{3,9})\.?,?\s*(\d{4})?$/);
  if (named) {
    const month = MONTH_INDEX[named[2].slice(0, 3).toLowerCase()];
    const year = named[3] ? Number(named[3]) : ref?.year;
    if (month === undefined || year === undefined) return null;
    return makeDate(year, month, Number(named[1]));
  }

  if (/\b\d{4}\b/.test(text)) {
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return direct;
  }
  return null;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "12 Aug 2026" when the cell can be read, else the raw cell text, else an em dash placeholder is the caller's job. */
export function formatTransactionDate(raw: string, monthLabel = ""): string {
  const parsed = parseTransactionDate(raw, monthLabel);
  return parsed ? dateFormatter.format(parsed) : String(raw || "").trim();
}

// ---------------------------------------------------------------------------
// Sorting

export type SortKey = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

export interface IndexedTransaction {
  index: number;
  tx: BudgetTransaction;
}

function dateRank(item: IndexedTransaction): [number, number] {
  const parsed = parseTransactionDate(item.tx.date, item.tx.month);
  return [budgetMonthSortValue(item.tx.month), parsed ? parsed.getTime() : Number.NEGATIVE_INFINITY];
}

function compareDates(a: IndexedTransaction, b: IndexedTransaction): number {
  const [monthA, timeA] = dateRank(a);
  const [monthB, timeB] = dateRank(b);
  if (monthA !== monthB) return monthA - monthB;
  if (timeA !== timeB) return timeA === Number.NEGATIVE_INFINITY ? -1 : timeB === Number.NEGATIVE_INFINITY ? 1 : timeA - timeB;
  return a.index - b.index;
}

/**
 * Sorted copy. Rows without a month always come last; undated rows inside a month follow sheet order.
 * Stable: ties fall back to the order in the sheet.
 */
export function sortTransactions(transactions: readonly BudgetTransaction[], key: SortKey): BudgetTransaction[] {
  const items = transactions.map((tx, index) => ({ tx, index }));
  const direction = key.endsWith("desc") ? -1 : 1;
  items.sort((a, b) => {
    const aUndated = a.tx.month === NO_DATE;
    const bUndated = b.tx.month === NO_DATE;
    if (aUndated !== bUndated) return aUndated ? 1 : -1;
    if (key.startsWith("amount")) {
      const diff = (a.tx.amount || 0) - (b.tx.amount || 0);
      return diff !== 0 ? diff * direction : compareDates(a, b) * -1;
    }
    const diff = compareDates(a, b);
    return diff * direction;
  });
  return items.map((item) => item.tx);
}
