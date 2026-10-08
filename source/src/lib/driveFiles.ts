import { useSyncExternalStore } from "react";
import { fetchDriveFileMeta } from "../external/drive";

/**
 * What kind of file is a Drive file: "image", "video" or "other" (also used when Drive cannot be asked). Asked once per
 * file, a few at a time, remembered on this device for a day. Never written to the shared board data.
 */
export type DriveKind = "image" | "video" | "other";
type Entry = { state: "loading" } | { state: "done"; kind: DriveKind; at: number };

const CACHE_KEY = "otw2.driveFiles.v1";
const TTL_MS = 24 * 3600_000;
const FAILED_RETRY_MS = 5 * 60_000;
const MAX_PARALLEL = 4;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let running = 0;
let version = 0;
let hydrated = false;

const emit = () => { version += 1; listeners.forEach((listener) => listener()); };

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Record<string, { kind: DriveKind; at: number }>;
    Object.entries(saved).forEach(([id, value]) => {
      if (value && ["image", "video"].includes(value.kind) && Date.now() - value.at < TTL_MS) entries.set(id, { state: "done", kind: value.kind, at: value.at });
    });
  } catch { /* no cache */ }
}

function persist() {
  try {
    const out: Record<string, { kind: DriveKind; at: number }> = {};
    entries.forEach((entry, id) => { if (entry.state === "done" && entry.kind !== "other") out[id] = { kind: entry.kind, at: entry.at }; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked */ }
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    running += 1;
    void fetchDriveFileMeta(id).then((result) => {
      const mime = result.status === "ok" ? result.meta.mimeType : "";
      const kind: DriveKind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "other";
      entries.set(id, { state: "done", kind, at: Date.now() });
      if (kind !== "other") persist();
    }).finally(() => { running -= 1; emit(); pump(); });
  }
}

function request(id: string) {
  hydrate();
  const known = entries.get(id);
  if (known?.state === "loading") return;
  if (known?.state === "done" && Date.now() - known.at < (known.kind === "other" ? FAILED_RETRY_MS : TTL_MS)) return;
  entries.set(id, { state: "loading" });
  queue.push(id);
  pump();
}

/** The kind of a Drive file, or "loading" while Drive is being asked. Pass "" for no file. */
export function useDriveKind(fileId: string): DriveKind | "loading" {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => {
      if (!fileId) return "other";
      hydrate();
      const known = entries.get(fileId);
      const stale = !known || (known.state === "done" && Date.now() - known.at >= (known.kind === "other" ? FAILED_RETRY_MS : TTL_MS));
      if (stale) queueMicrotask(() => request(fileId));
      void version;
      return !known || known.state === "loading" ? "loading" : known.kind;
    },
    () => "other"
  );
}
