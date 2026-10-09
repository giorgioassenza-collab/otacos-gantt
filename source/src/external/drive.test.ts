import { afterEach, describe, expect, it, vi } from "vitest";
import { driveFolderIdOf, driveFolderRequestUrl, driveItemsFromFiles, fetchDriveFolder } from "./drive";

afterEach(() => vi.unstubAllGlobals());

describe("Drive folders", () => {
  it("finds the folder id in the usual link shapes", () => {
    expect(driveFolderIdOf("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderIdOf("https://drive.google.com/folderview?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderIdOf("https://example.com/folders/1AbCdEfGhIjKlMnOp")).toBe("");
  });

  it("asks the Drive API for the folder's files and only talks to google", () => {
    const url = new URL(driveFolderRequestUrl("FOLDER12345"));
    expect(url.hostname).toBe("www.googleapis.com");
    expect(decodeURIComponent(url.searchParams.get("q") ?? "")).toBe("'FOLDER12345' in parents and trashed=false");
    expect(url.searchParams.get("key")).toBeTruthy();
  });

  it("keeps pictures and videos and builds thumbnail urls", () => {
    const items = driveItemsFromFiles([
      { id: "a1", name: "one.jpg", mimeType: "image/jpeg" },
      { id: "b2", name: "two.mp4", mimeType: "video/mp4" },
      { id: "c3", name: "notes.pdf", mimeType: "application/pdf" }
    ]);
    expect(items.map((i) => [i.type, i.label])).toEqual([["image", "one.jpg"], ["video", "two.mp4"]]);
    expect(items[0].src).toContain("thumbnail?id=a1");
  });

  it("reports ok, empty and the reasons for errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: [{ id: "a1", name: "one.jpg", mimeType: "image/jpeg" }] }) }));
    expect(await fetchDriveFolder("F")).toMatchObject({ status: "ok" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: [] }) }));
    expect(await fetchDriveFolder("F")).toEqual({ status: "empty" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    expect(await fetchDriveFolder("F")).toMatchObject({ status: "error", message: expect.stringContaining("not shared") });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchDriveFolder("F")).toMatchObject({ status: "error", message: "Cannot reach Google Drive." });
  });
});

import { driveMediaUrl } from "./drive";
describe("Drive media address", () => {
  it("streams the file itself with the public key", () => {
    const url = new URL(driveMediaUrl("FILE123456"));
    expect(url.pathname).toBe("/drive/v3/files/FILE123456");
    expect(url.searchParams.get("alt")).toBe("media");
    expect(url.searchParams.get("key")).toBeTruthy();
  });
});

describe("mediaRatio", () => {
  it("reads the shape of a video and of a picture from what Drive reports", async () => {
    const { mediaRatio, driveItemsFromFiles } = await import("./drive");
    expect(mediaRatio({ videoMediaMetadata: { width: 1080, height: 1920 } })).toBeCloseTo(0.5625);
    expect(mediaRatio({ imageMediaMetadata: { width: 1122, height: 1402, rotation: 0 } })).toBeCloseTo(0.8);
    expect(mediaRatio({ imageMediaMetadata: { width: 4000, height: 3000, rotation: 90 } })).toBeCloseTo(0.75); // stored sideways
    expect(mediaRatio({})).toBeUndefined();
    const [item] = driveItemsFromFiles([{ id: "abcdefghijk", mimeType: "video/mp4", videoMediaMetadata: { width: 1080, height: 1920 } }]);
    expect(item.ratio).toBeCloseTo(0.5625);
  });
});
