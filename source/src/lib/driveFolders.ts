import { useSyncExternalStore } from "react";
import { fetchDriveFolder, type DriveItem } from "../external/drive";

/**
 * Folder contents shared by every card that needs them. Loaded at most once per folder, three at a time, cached on this
 * device for 12 hours (so reopening the app is instant) and never written to the shared board data.
 */

type Entry =
  | { state: "loading" }
  | { state: "ready"; items: DriveItem[]; at: number }
  | { state: "none"; message: string; at: number };

// v2: v1 entries were written before items carried their file id (they produced "thumbnail?id=undefined")
const CACHE_KEY = "otw2.driveFolders.v2";
const TTL_MS = 12 * 3600_000;
const FAILED_RETRY_MS = 5 * 60_000;
const MAX_PARALLEL = 3;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queue: string[] = [];
let running = 0;
let version = 0;
let hydrated = false;

function emit() { version += 1; listeners.forEach((listener) => listener()); }

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    try { localStorage.removeItem("otw2.driveFolders.v1"); } catch { /* ignore */ }
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Record<string, { items: DriveItem[]; at: number }>;
    Object.entries(saved).forEach(([id, value]) => {
      const usable = value && Array.isArray(value.items) && value.items.length > 0 && value.items.every((item) => item && typeof item.id === "string" && item.id.length > 5);
      if (usable && Date.now() - value.at < TTL_MS) entries.set(id, { state: "ready", items: value.items, at: value.at });
    });
  } catch { /* no cache */ }
}

function persist() {
  try {
    const out: Record<string, { items: DriveItem[]; at: number }> = {};
    entries.forEach((entry, id) => { if (entry.state === "ready") out[id] = { items: entry.items, at: entry.at }; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked */ }
}

async function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    running += 1;
    void fetchDriveFolder(id).then((result) => {
      entries.set(id, result.status === "ok" ? { state: "ready", items: result.items, at: Date.now() } : { state: "none", message: result.status === "error" ? result.message : "The folder has no pictures or videos.", at: Date.now() });
      if (result.status === "ok") persist();
    }).finally(() => { running -= 1; emit(); void pump(); });
  }
}

function request(folderId: string) {
  hydrate();
  const current = entries.get(folderId);
  if (current?.state === "loading") return;
  if (current?.state === "ready" && Date.now() - current.at < TTL_MS) return;
  if (current?.state === "none" && Date.now() - current.at < FAILED_RETRY_MS) return;
  entries.set(folderId, { state: "loading" });
  queue.push(folderId);
  void pump();
}

export interface FolderPreview { items: DriveItem[]; loading: boolean; message: string }
const idle: FolderPreview = { items: [], loading: false, message: "" };
const snapshots = new Map<string, { version: number; value: FolderPreview }>();

/** Items of a Drive folder, loading them if needed. Pass "" when there is no folder. */
export function useDriveFolder(folderId: string): FolderPreview {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => {
      if (!folderId) return idle;
      hydrate();
      const known = entries.get(folderId);
      const stale = !known || (known.state === "ready" && Date.now() - known.at >= TTL_MS) || (known.state === "none" && Date.now() - known.at >= FAILED_RETRY_MS);
      if (stale) queueMicrotask(() => request(folderId));
      const cached = snapshots.get(folderId);
      if (cached && cached.version === version) return cached.value;
      const entry = entries.get(folderId);
      const value: FolderPreview = !entry || entry.state === "loading" ? { items: [], loading: true, message: "" }
        : entry.state === "ready" ? { items: entry.items, loading: false, message: "" }
        : { items: [], loading: false, message: entry.message };
      snapshots.set(folderId, { version, value });
      return value;
    },
    () => idle
  );
}
