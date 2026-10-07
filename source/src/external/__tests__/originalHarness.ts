/**
 * Differential-test harness: pulls the ORIGINAL functions out of the legacy single-file app and
 * email-review.js (read only) and evaluates them in a node:vm context, so the TypeScript ports can
 * be asserted against the real thing on the same synthetic fixtures.
 *
 * The legacy sources live outside the project (scratchpad clone). Point ORIGINAL_APP_DIR at the
 * folder that holds index.html and email-review.js; when the files are absent the differential
 * tests are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const DEFAULT_DIR =
  "C:\\Users\\Utente\\AppData\\Local\\Temp\\claude\\C--Users-Utente-O-Tacos-gantt-claude\\2466893e-2297-4ff5-8f89-eb6a0ce1a70d\\scratchpad\\orig";

export const ORIGINAL_APP_DIR = process.env.ORIGINAL_APP_DIR || DEFAULT_DIR;
export const originalIndexPath = join(ORIGINAL_APP_DIR, "index.html");
export const originalEmailReviewPath = join(ORIGINAL_APP_DIR, "email-review.js");
export const originalAvailable = existsSync(originalIndexPath) && existsSync(originalEmailReviewPath);

/** Source of `[async] function name(...) {...}` found by brace counting. */
function extractFunction(source: string, name: string): string {
  const match = new RegExp(`^[ \\t]*(async\\s+)?function\\s+${name}\\s*\\(`, "m").exec(source);
  if (!match) throw new Error(`Original function not found: ${name}`);
  const start = match.index;
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

function extractLine(source: string, pattern: RegExp): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`Original line not found: ${pattern}`);
  return match[0];
}

export type FetchStub = (url: string, init?: Record<string, unknown>) => Promise<unknown>;

const BUDGET_FUNCTIONS = [
  "parseCsv", "parseBudgetAmount", "budgetCurrency", "budgetDateLabel", "budgetMonthKey",
  "budgetMonthSortValue", "budgetMonthLabelFromSheetName", "budgetMonthLabelFromName",
  "budgetNumberFromCell", "parseBudgetTotals", "uniqueSortedBudgetValues", "budgetCategoryFromHeader",
  "parseBudgetRows", "budgetTitleFromSheets", "budgetSummaryFromTransactions", "loadBudgetCsvSheets",
  "aggregateBudget", "budgetTodayBalance", "budgetRowsFromWorksheet", "parseBudgetWorkbook"
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OriginalBudget = Record<string, (...args: any[]) => any>;

export function loadOriginalBudget(fetchStub: FetchStub, globals: { XLSX?: unknown } = {}): OriginalBudget {
  const source = readFileSync(originalIndexPath, "utf8");
  const code = [
    extractLine(source, /const budgetSheetNames = \[[^\]]*\];/),
    ...BUDGET_FUNCTIONS.map((name) => extractFunction(source, name)),
    `({ ${BUDGET_FUNCTIONS.join(", ")} })`
  ].join("\n");
  const context = vm.createContext({ fetch: fetchStub, window: { XLSX: globals.XLSX }, Intl, Date, Math, Number, String, Promise, Map, Set, console });
  return vm.runInContext(code, context) as OriginalBudget;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OriginalInfluencer = Record<string, (...args: any[]) => any>;

export function loadOriginalInfluencer(fetchStub: FetchStub): OriginalInfluencer {
  const source = readFileSync(originalIndexPath, "utf8");
  const names = ["parseCsv", "normalizeInfluencerRow", "rowMatchKey", "loadInfluencerRowsFromSheet"];
  const code = [
    extractLine(source, /const influencerCsvUrl = "[^"]*";/),
    ...names.map((name) => extractFunction(source, name)),
    `({ ${names.join(", ")} })`
  ].join("\n");
  const context = vm.createContext({
    fetch: fetchStub,
    window: {},
    // the original tries to load the xlsx library first and falls back to CSV when that throws
    ensureXlsxLoaded: () => Promise.reject(new Error("xlsx not available in the harness")),
    Date, Math, Number, String, Promise, console: { warn() {}, log() {}, error() {} }
  });
  return vm.runInContext(code, context) as OriginalInfluencer;
}

export interface OriginalApprovals {
  sendAction: (action: string, reviewId: string, task?: unknown) => Promise<void>;
  refreshReviews: () => Promise<void>;
  valuesFromCard: (card: unknown) => unknown;
  state: () => { reviews: unknown[]; cachedChoices: unknown; renders: number };
}

export function loadOriginalApprovals(fetchStub: FetchStub, apiUrl: string): OriginalApprovals {
  const source = readFileSync(originalEmailReviewPath, "utf8");
  const code = [
    extractLine(source, /const dateValue = [^\n]*/),
    "let reviews = []; let cachedChoices = { projects: [], statuses: [], members: [] }; let expandedReviewId = \"\"; let renders = 0;",
    `const reviewApiUrl = ${JSON.stringify(apiUrl)};`,
    "function render() { renders += 1; }",
    extractFunction(source, "valuesFromCard"),
    extractFunction(source, "sendAction"),
    extractFunction(source, "refreshReviews"),
    "({ sendAction, refreshReviews, valuesFromCard, state: () => ({ reviews, cachedChoices, renders }) })"
  ].join("\n");
  const context = vm.createContext({ fetch: fetchStub, String, Number, Promise, Error, JSON });
  return vm.runInContext(code, context) as OriginalApprovals;
}

/** Plain-JSON copy, so objects from the vm realm compare equal to host-realm ones. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
