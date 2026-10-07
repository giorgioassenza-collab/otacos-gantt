// SYNTHETIC influencer sheet (see fixtures.ts). fetch is mocked; no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importInfluencerSeedIfNeeded,
  influencerCsvUrl,
  loadInfluencerRowsFromSheet,
  rowMatchKey,
  rowsFromInfluencerCsv,
  type InfluencerSheetRow
} from "../influencerSheet";
import { influencerSheetCsv, toCsv } from "./fixtures";
import { csvResponse, htmlResponse, mockFetch, textStatus } from "./helpers";
import { loadOriginalInfluencer, originalAvailable, plain, type OriginalInfluencer } from "./originalHarness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FIELDS = ["name", "city", "target", "type", "ttProfile", "igProfile", "ttLink", "igLink", "output", "price", "status", "where", "when"];

describe("rowsFromInfluencerCsv", () => {
  const rows = rowsFromInfluencerCsv(influencerSheetCsv);

  it("finds the header row, case-insensitively, and drops rows without a name", () => {
    expect(rows.map((r) => r.name)).toEqual(["Creator A", "Creator B", "Creator C"]);
  });

  it("produces exactly the original field names", () => {
    for (const row of rows) expect(Object.keys(row).sort()).toEqual([...FIELDS].sort());
  });

  it("trims cells, maps TBC to TO CONTACT (any case) and leaves other statuses as written", () => {
    expect(rows[0]).toEqual({
      name: "Creator A", city: "Milano", target: "Food", type: "Micro",
      ttProfile: "@creatora", igProfile: "@creatora_ig", ttLink: "", igLink: "",
      output: "2 reels", price: "€ 500", status: "TO CONTACT", where: "Store 1", when: "June"
    });
    expect(rows[1].name).toBe("Creator B");
    expect(rows[1].status).toBe("contacted");
    expect(rows[2].status).toBe("TO CONTACT");
  });

  it("returns [] without a NAME header or for empty text", () => {
    expect(rowsFromInfluencerCsv("a,b\n1,2")).toEqual([]);
    expect(rowsFromInfluencerCsv("")).toEqual([]);
  });

  it("tolerates short rows and a BOM", () => {
    const csv = "﻿" + toCsv([["NAME", "CITY", "STATUS"], ["X"], ["Y", "Roma"]]);
    expect(rowsFromInfluencerCsv(csv).map((r) => [r.name, r.city, r.status])).toEqual([["X", "", ""], ["Y", "Roma", ""]]);
  });
});

describe("rowMatchKey", () => {
  it("is a trimmed, lower-cased pipe-joined key of the five identity fields", () => {
    expect(rowMatchKey({ name: " Creator A ", city: "MILANO", target: "Food", ttProfile: "@A", igProfile: undefined })).toBe("creator a|milano|food|@a|");
    expect(rowMatchKey({})).toBe("||||");
  });
});

describe("loadInfluencerRowsFromSheet", () => {
  it("requests the CSV export and returns typed rows", async () => {
    const calls = mockFetch(() => csvResponse(influencerSheetCsv));
    const result = await loadInfluencerRowsFromSheet();
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.rows).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(influencerCsvUrl);
    expect(influencerCsvUrl).toBe("https://docs.google.com/spreadsheets/d/1l70YY3at2sBeIO9iET6bypMRxWkgVD8APzsQY7PhR7I/export?format=csv&gid=429623991");
  });

  it("reports empty (reachable, no rows) separately from failures", async () => {
    mockFetch(() => csvResponse("a,b\n1,2"));
    expect((await loadInfluencerRowsFromSheet()).status).toBe("empty");
  });

  it("fails with access on an HTML login page and on 403", async () => {
    mockFetch(() => htmlResponse(200));
    expect(await loadInfluencerRowsFromSheet()).toMatchObject({ status: "failed", error: { kind: "access" } });
    mockFetch(() => textStatus(403));
    expect(await loadInfluencerRowsFromSheet()).toMatchObject({ status: "failed", error: { kind: "access" } });
  });

  it("fails with http / network / timeout", async () => {
    mockFetch(() => textStatus(500));
    expect(await loadInfluencerRowsFromSheet()).toMatchObject({ status: "failed", error: { kind: "http" } });
    mockFetch(() => new TypeError("Failed to fetch"));
    expect(await loadInfluencerRowsFromSheet()).toMatchObject({ status: "failed", error: { kind: "network" } });

    vi.useFakeTimers();
    mockFetch(() => "hang");
    const pending = loadInfluencerRowsFromSheet();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ status: "failed", error: { kind: "timeout" } });
  });
});

describe("importInfluencerSeedIfNeeded", () => {
  const rows: InfluencerSheetRow[] = rowsFromInfluencerCsv(influencerSheetCsv);

  it("skips without touching the network when the board already has influencers", async () => {
    const load = vi.fn();
    const save = vi.fn();
    expect(await importInfluencerSeedIfNeeded({ existingCount: 2, save, load })).toEqual({ status: "skipped" });
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("imports and saves when the board is empty", async () => {
    const save = vi.fn();
    const load = vi.fn(async () => ({ status: "loaded" as const, rows }));
    expect(await importInfluencerSeedIfNeeded({ existingCount: 0, save, load })).toEqual({ status: "imported", count: 3 });
    expect(save).toHaveBeenCalledWith(rows);
  });

  it("does not save when the sheet is empty or failing", async () => {
    const save = vi.fn();
    expect(await importInfluencerSeedIfNeeded({ existingCount: 0, save, load: async () => ({ status: "empty", reason: "none" }) })).toMatchObject({ status: "empty" });
    expect(await importInfluencerSeedIfNeeded({ existingCount: 0, save, load: async () => ({ status: "failed", error: { kind: "network", message: "x" } }) })).toMatchObject({ status: "failed" });
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a failing save instead of throwing", async () => {
    const result = await importInfluencerSeedIfNeeded({
      existingCount: 0,
      save: () => { throw new Error("quota"); },
      load: async () => ({ status: "loaded", rows })
    });
    expect(result).toMatchObject({ status: "failed", error: { kind: "save" } });
  });

  it("uses the real loader by default", async () => {
    mockFetch(() => csvResponse(influencerSheetCsv));
    const save = vi.fn();
    expect(await importInfluencerSeedIfNeeded({ existingCount: 0, save })).toEqual({ status: "imported", count: 3 });
  });
});

// ---------------------------------------------------------------------------
// Differential: run the ORIGINAL loadInfluencerRowsFromSheet (xlsx unavailable -> CSV branch)

describe.skipIf(!originalAvailable)("influencer port vs original", () => {
  it("rowMatchKey and the CSV branch of loadInfluencerRowsFromSheet match", async () => {
    const responses: string[] = [influencerSheetCsv, "no header here\n1,2", toCsv([["NAME", "STATUS", "NAME"], ["A", "tbc", "B"]])];
    for (const csv of responses) {
      const original: OriginalInfluencer = loadOriginalInfluencer(async () => csvResponse(csv));
      const fromOriginal = (await original.loadInfluencerRowsFromSheet()) as Array<Record<string, unknown>>;
      // the original normalises into full rows (ids, contact fields...): compare the shared field set
      const picked = fromOriginal.map((row) => Object.fromEntries(FIELDS.map((field) => [field, row[field]])));
      expect(rowsFromInfluencerCsv(csv)).toEqual(plain(picked));
    }

    const original = loadOriginalInfluencer(async () => csvResponse(""));
    for (const row of [{ name: " A ", city: "X", target: "T", ttProfile: "@T", igProfile: "@I" }, {}, { name: "Z" }]) {
      expect(rowMatchKey(row)).toBe(original.rowMatchKey(row));
    }
  });
});
