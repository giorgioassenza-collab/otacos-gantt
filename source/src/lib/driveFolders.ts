import { useSyncExternalStore } from "react";
import { fetchDriveFolder, type DriveItem } from "../external/drive";

/**
 * Folder contents shared by every card that needs them. Loaded three at a time and never written to the shared board data.
 * What was seen last time is shown at once (so reopening the app is instant) and the folder is read again in the
 * background: at the first use after opening the app and then at most once a minute, so a picture added or deleted in
 * Drive shows up within moments. The cache keeps the last list for 12 hours in case Drive cannot be reached.
 */

type Entry =
  | { state: "loading" }
  | { state: "ready"; items: DriveItem[]; at: number }
  | { state: "none"; message: string; at: number; empty: boolean };

// v2: v1 entries were written before items carried their file id (they produced "thumbnail?id=undefined")
const CACHE_KEY = "otw2.driveFolders.v2";
const TTL_MS = 12 * 3600_000; // how long an old list may still be shown
const FRESH_MS = 60_000; // how long a list is trusted before the folder is read again
const FAILED_RETRY_MS = 5 * 60_000;
const MAX_PARALLEL = 3;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queue: string[] = [];
const inflight = new Set<string>();
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
      // at: 0 = "seen before, not read yet in this session": shown at once, then refreshed
      if (usable && Date.now() - value.at < TTL_MS) entries.set(id, { state: "ready", items: value.items, at: 0 });
    });
  } catch { /* no cache */ }
}

function persist() {
  try {
    const out: Record<string, { items: DriveItem[]; at: number }> = {};
    entries.forEach((entry, id) => { if (entry.state === "ready") out[id] = { items: entry.items, at: entry.at || Date.now() }; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full or blocked */ }
}

async function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    running += 1;
    inflight.add(id);
    void fetchDriveFolder(id).then((result) => {
      const before = entries.get(id);
      const old = before?.state === "ready" ? before : null; // the list shown while this read was under way
      if (result.status === "ok") entries.set(id, { state: "ready", items: result.items, at: Date.now() });
      else if (result.status === "empty") entries.set(id, { state: "none", message: "The folder has no pictures or videos.", at: Date.now(), empty: true });
      else if (old) entries.set(id, { state: "ready", items: old.items, at: Date.now() }); // Drive hiccup: keep what was shown, try again in a minute
      else entries.set(id, { state: "none", message: result.message, at: Date.now(), empty: false });
      persist();
    }).finally(() => { running -= 1; inflight.delete(id); emit(); void pump(); });
  }
}

function request(folderId: string) {
  hydrate();
  const current = entries.get(folderId);
  if (current?.state === "loading") return;
  if (current?.state === "ready" && Date.now() - current.at < FRESH_MS) return;
  if (current?.state === "none" && Date.now() - current.at < (current.empty ? FRESH_MS : FAILED_RETRY_MS)) return;
  if (queue.includes(folderId) || inflight.has(folderId)) return;
  // an old list stays on screen while the folder is read again; only a folder never seen shows the loading state
  if (current?.state !== "ready") entries.set(folderId, { state: "loading" });
  queue.push(folderId);
  void pump();
}

/** Read a folder again now (after files were added to it). */
export function refreshDriveFolder(folderId: string) {
  hydrate();
  const known = entries.get(folderId);
  if (known?.state === "ready") entries.set(folderId, { ...known, at: 0 });
  else entries.delete(folderId);
  request(folderId);
  emit();
}

export interface FolderPreview {
  items: DriveItem[]; loading: boolean; message: string;
  /** True once the folder itself was read (pictures or empty), so copies saved in the post must no longer be shown. */
  read: boolean;
}
const idle: FolderPreview = { items: [], loading: false, message: "", read: false };
const snapshots = new Map<string, { version: number; value: FolderPreview }>();

/** Items of a Drive folder, loading them if needed. Pass "" when there is no folder. */
export function useDriveFolder(folderId: string): FolderPreview {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => {
      if (!folderId) return idle;
      hydrate();
      const known = entries.get(folderId);
      const stale = !known || (known.state === "ready" && Date.now() - known.at >= FRESH_MS) || (known.state === "none" && Date.now() - known.at >= (known.empty ? FRESH_MS : FAILED_RETRY_MS));
      if (stale) queueMicrotask(() => request(folderId));
      const cached = snapshots.get(folderId);
      if (cached && cached.version === version) return cached.value;
      const entry = entries.get(folderId);
      const value: FolderPreview = !entry || entry.state === "loading" ? { items: [], loading: true, message: "", read: false }
        : entry.state === "ready" ? { items: entry.items, loading: false, message: "", read: entry.at > 0 }
        : { items: [], loading: false, message: entry.message, read: entry.empty };
      snapshots.set(folderId, { version, value });
      return value;
    },
    () => idle
  );
}

// back on this tab after a while (maybe after editing the folder in Drive): let the cards check their folders again
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") emit(); });
}
