/**
 * Influencer import from the second Google Sheet (CSV endpoint only).
 *
 * NOT ported: `rowsFromInfluencerWorkbook` and the `export?format=xlsx` branch of
 * `loadInfluencerRowsFromSheet`. Both need the `xlsx` library, which we deliberately do not add.
 * Consequence: `ttLink` and `igLink` are always "" here. The original only got them from the
 * workbook (the hyperlink target of the TT PROFILE / IG PROFILE cells); the CSV export carries no
 * hyperlinks. The profile handles themselves (ttProfile, igProfile) are still imported.
 *
 * No dependency on src/data: the row type is local and deliberately minimal. The data layer's
 * normalizeInfluencerRow turns these into full rows (ids, sort order, contact fields...).
 */

import { fetchText, looksLikeHtml, FetchFailure, type FetchFailureKind } from "./http";
import { parseCsv } from "./budget";

export const INFLUENCER_SHEET_ID = "1l70YY3at2sBeIO9iET6bypMRxWkgVD8APzsQY7PhR7I";
export const INFLUENCER_SHEET_GID = "429623991";
export const influencerCsvUrl = `https://docs.google.com/spreadsheets/d/${INFLUENCER_SHEET_ID}/export?format=csv&gid=${INFLUENCER_SHEET_GID}`;
export const influencerWorkbookUrl = `https://docs.google.com/spreadsheets/d/${INFLUENCER_SHEET_ID}/export?format=xlsx`;

/** Same keys the original app's normalizeInfluencerRow reads from the sheet. */
export interface InfluencerSheetRow {
  name: string;
  city: string;
  target: string;
  type: string;
  ttProfile: string;
  igProfile: string;
  ttLink: string;
  igLink: string;
  output: string;
  price: string;
  status: string;
  where: string;
  when: string;
}

/** Sheet header (upper-cased) -> row field, as in the original influencerColumns table. */
export const influencerSheetColumns: ReadonlyArray<{ key: keyof InfluencerSheetRow; header: string }> = [
  { key: "name", header: "NAME" },
  { key: "city", header: "CITY" },
  { key: "target", header: "TARGET" },
  { key: "type", header: "TYPE" },
  { key: "ttProfile", header: "TT PROFILE" },
  { key: "igProfile", header: "IG PROFILE" },
  { key: "ttLink", header: "TT LINK" },
  { key: "igLink", header: "IG LINK" },
  { key: "output", header: "OUTPUT" },
  { key: "price", header: "PRICE" },
  { key: "status", header: "STATUS" },
  { key: "where", header: "WHERE" },
  { key: "when", header: "WHEN" }
];

/** Lower-cased "name|city|target|ttProfile|igProfile": identity used to match sheet rows to existing rows. */
export function rowMatchKey(row: Partial<Pick<InfluencerSheetRow, "name" | "city" | "target" | "ttProfile" | "igProfile">>): string {
  return [row.name, row.city, row.target, row.ttProfile, row.igProfile]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

/**
 * Maps a header-keyed record (upper-case headers, as built from the CSV) to an InfluencerSheetRow.
 * Mirrors the field mapping of the original normalizeInfluencerRow, including its one rewrite:
 * a status of "TBC" (any case) becomes "TO CONTACT".
 */
export function influencerRowFromRecord(raw: Record<string, string | undefined>): InfluencerSheetRow {
  const rawStatus = raw["STATUS"] || "";
  return {
    name: raw["NAME"] || "",
    city: raw["CITY"] || "",
    target: raw["TARGET"] || "",
    type: raw["TYPE"] || "",
    ttProfile: raw["TT PROFILE"] || "",
    igProfile: raw["IG PROFILE"] || "",
    ttLink: raw["TT LINK"] || "",
    igLink: raw["IG LINK"] || "",
    output: raw["OUTPUT"] || "",
    price: raw["PRICE"] || "",
    status: String(rawStatus).trim().toUpperCase() === "TBC" ? "TO CONTACT" : rawStatus,
    where: raw["WHERE"] || "",
    when: raw["WHEN"] || ""
  };
}

/**
 * Parses the sheet's CSV text. The header row is the first row containing a "NAME" cell; rows
 * without a name are dropped. Returns [] when there is no header row.
 */
export function rowsFromInfluencerCsv(text: string): InfluencerSheetRow[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const headerIndex = rows.findIndex((row) => row.map((cell) => cell.trim().toUpperCase()).includes("NAME"));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => cell.trim().toUpperCase());
  return rows.slice(headerIndex + 1)
    .map((row) => {
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => { raw[header] = (row[index] || "").trim(); });
      return influencerRowFromRecord(raw);
    })
    .filter((row) => row.name);
}

export type InfluencerLoadErrorKind = FetchFailureKind | "access" | "http";

export interface InfluencerLoadError {
  kind: InfluencerLoadErrorKind;
  message: string;
}

export type InfluencerSheetResult =
  | { status: "loaded"; rows: InfluencerSheetRow[] }
  /** Reachable, but no usable rows (no NAME header, or no named rows). The original returned [] here. */
  | { status: "empty"; reason: string }
  | { status: "failed"; error: InfluencerLoadError };

export interface InfluencerLoadOptions {
  signal?: AbortSignal;
  /** Default 12 000 ms. */
  timeoutMs?: number;
}

/** Fetches the influencer CSV export. Never throws: failures are returned so the UI can say what happened. */
export async function loadInfluencerRowsFromSheet(options: InfluencerLoadOptions = {}): Promise<InfluencerSheetResult> {
  try {
    const response = await fetchText(influencerCsvUrl, {}, { timeoutMs: options.timeoutMs, signal: options.signal });
    if (!response.ok) {
      const access = response.status === 401 || response.status === 403;
      return {
        status: "failed",
        error: {
          kind: access ? "access" : "http",
          message: access
            ? "The influencer sheet is not accessible. Check that it is shared with link access."
            : `Google Sheets returned HTTP ${response.status} for the influencer sheet.`
        }
      };
    }
    if (looksLikeHtml(response.text, response.contentType)) {
      return {
        status: "failed",
        error: { kind: "access", message: "The influencer sheet returned a web page instead of CSV (probably not shared with link access)." }
      };
    }
    const rows = rowsFromInfluencerCsv(response.text);
    if (!rows.length) return { status: "empty", reason: "No influencer rows found in the sheet." };
    return { status: "loaded", rows };
  } catch (error) {
    const failure = error instanceof FetchFailure ? error : new FetchFailure("network", "Network error");
    return { status: "failed", error: { kind: failure.kind, message: failure.message } };
  }
}

export interface ImportInfluencerSeedOptions {
  /** How many influencer rows the board already holds. The import only runs when this is 0. */
  existingCount: number;
  /**
   * Persist the imported rows. The original ran, in order: applyInfluencerStatusAging, the deleted-options
   * filters, ensureInfluencerOptionsFromRows, then saveData(true). That belongs to the data layer, so it is
   * done by this callback.
   */
  save: (rows: InfluencerSheetRow[]) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seam: replaces loadInfluencerRowsFromSheet. */
  load?: (options: InfluencerLoadOptions) => Promise<InfluencerSheetResult>;
}

export type ImportInfluencerSeedResult =
  | { status: "skipped" }
  | { status: "imported"; count: number }
  | { status: "empty"; reason: string }
  | { status: "failed"; error: { kind: InfluencerLoadErrorKind | "save"; message: string } };

/**
 * One-time seed: when the board has no influencers yet, import them from the sheet.
 * Never throws; a failing sheet or save leaves the board untouched (as the original did).
 */
export async function importInfluencerSeedIfNeeded(options: ImportInfluencerSeedOptions): Promise<ImportInfluencerSeedResult> {
  if (options.existingCount > 0) return { status: "skipped" };
  const load = options.load ?? loadInfluencerRowsFromSheet;
  const result = await load({ signal: options.signal, timeoutMs: options.timeoutMs });
  if (result.status === "failed") return result;
  if (result.status === "empty") return result;
  try {
    await options.save(result.rows);
  } catch (error) {
    return {
      status: "failed",
      error: { kind: "save", message: error instanceof Error && error.message ? `Saving the imported influencers failed: ${error.message}` : "Saving the imported influencers failed." }
    };
  }
  return { status: "imported", count: result.rows.length };
}
