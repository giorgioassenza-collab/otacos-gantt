/**
 * Local persistence and safety backups.
 *
 * KEY NAMES AND RECORD FORMATS ARE IDENTICAL TO THE OLD APP: a device that used the old app may hold unsynced
 * local edits in localStorage ("tacos-gantt-board-data-v5", ...) or in the IndexedDB database
 * "otacos-workflow-safety-v1" (object store "snapshots", keyPath "id", indexes "revision" and "savedAt", plus a
 * record with id "latest"). This module reads and writes them exactly like the old app.
 *
 * Storage access is injectable (LocalStoreOptions) so tests can run without a browser.
 */
import { now, nowDate, random } from "./clock";
import { historySummary, normalizeHistory } from "./history";
import { normalizeData } from "./normalize";
import {
  historyStorageKey,
  revisionStorageKey,
  safetyDbName,
  safetyLatestKey,
  safetyLocalStorageKey,
  safetyStoreName,
  starterData,
  storageKey
} from "./starter";
import type { BoardData, HistoryEntry, SafetyBackup } from "./types";
import { cleanForFirestore } from "./util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/** Subset of the Web Storage API used here. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LocalSnapshot {
  data: BoardData;
  history: HistoryEntry[];
  revision: number;
}

export interface StartupCandidate {
  data: BoardData;
  revision: number;
  source: string;
}

/** Score used to prefer the richer of two snapshots with the same revision. */
export function snapshotSafetyScore(snapshot: Partial<BoardData> | null | undefined = {}): number {
  const source = (snapshot || {}) as Loose;
  const tasks: Loose[] = Array.isArray(source.tasks) ? source.tasks : [];
  const pedPosts: Loose[] = Array.isArray(source.pedPosts) ? source.pedPosts : [];
  const influencers: Loose[] = Array.isArray(source.influencers) ? source.influencers : [];
  const textWeight = JSON.stringify([
    pedPosts.map((post) => [post.title, post.asset, post.copy, post.comments]),
    tasks.map((task) => [task.name, task.info, task.pedAsset]),
    influencers.map((influencer) => [influencer.name, influencer.price, influencer.notes])
  ]).length;
  return (tasks.length * 25) + (pedPosts.length * 35) + (influencers.length * 10) + textWeight;
}

/** Builds a backup record (the same shape is stored locally and in boardSafety/*). */
export function createSafetyBackup(
  snapshotData: BoardData | null | undefined,
  history: HistoryEntry[] = [],
  revision: number | undefined = 0,
  source = "save"
): SafetyBackup {
  const cleanData = cleanForFirestore(snapshotData || starterData);
  const safeRevision = Number(revision || now());
  const savedAt = nowDate().toISOString();
  return {
    id: `${safeRevision}-${now()}-${random().toString(16).slice(2)}`,
    revision: safeRevision,
    savedAt,
    source,
    summary: historySummary(cleanData),
    score: snapshotSafetyScore(cleanData),
    data: cleanData,
    history: normalizeHistory(history)
  };
}

export interface LocalStoreOptions {
  /** Defaults to window.localStorage when available. Pass null to disable. */
  storage?: StorageLike | null;
  /** Defaults to window.indexedDB when available. Pass null to disable. */
  indexedDB?: IDBFactory | null;
  /** Override the storage keys (the demo backend uses its own so it never touches real device data). */
  keys?: Partial<{
    data: string;
    history: string;
    revision: string;
    safetyLatest: string;
    safetyDb: string;
  }>;
}

export interface LocalStore {
  saveLocalSnapshot(data: BoardData, history: HistoryEntry[], revision: number): void;
  readLocalSnapshot(): LocalSnapshot | null;
  /** History entries kept in localStorage (read back after a remote update). */
  readStoredHistory(): HistoryEntry[];
  queueSafetyBackup(data: BoardData, history: HistoryEntry[], revision: number, source?: string): void;
  readLatestLocalSafetyBackup(): Promise<SafetyBackup | null>;
  readLocalSafetyBackups(limit?: number): Promise<SafetyBackup[]>;
  readLocalSafetyBackupById(id: string): Promise<SafetyBackup | null>;
  safestStartupSnapshot(remoteData: unknown, remoteRevision: number, remoteSafety?: { data: unknown; revision: number } | null): Promise<StartupCandidate>;
  /** Resolves when every queued safety backup has been written. */
  flush(): Promise<void>;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function defaultIndexedDB(): IDBFactory | null {
  try {
    return typeof indexedDB !== "undefined" ? indexedDB : null;
  } catch {
    return null;
  }
}

export function createLocalStore(options: LocalStoreOptions = {}): LocalStore {
  const storage: StorageLike | null = options.storage === undefined ? defaultStorage() : options.storage;
  const idb: IDBFactory | null = options.indexedDB === undefined ? defaultIndexedDB() : options.indexedDB;
  const keys = {
    data: options.keys?.data ?? storageKey,
    history: options.keys?.history ?? historyStorageKey,
    revision: options.keys?.revision ?? revisionStorageKey,
    safetyLatest: options.keys?.safetyLatest ?? safetyLocalStorageKey,
    safetyDb: options.keys?.safetyDb ?? safetyDbName
  };

  let safetyBackupQueue: Promise<void> = Promise.resolve();
  let lastSafetyBackupKey = "";

  function openSafetyDb(): Promise<IDBDatabase | null> {
    if (!idb) return Promise.resolve(null);
    return new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = idb.open(keys.safetyDb, 1);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(safetyStoreName)) {
          const store = db.createObjectStore(safetyStoreName, { keyPath: "id" });
          store.createIndex("revision", "revision");
          store.createIndex("savedAt", "savedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  async function putSafetyBackup(backup: SafetyBackup): Promise<void> {
    storage?.setItem(keys.safetyLatest, JSON.stringify(backup));
    const db = await openSafetyDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(safetyStoreName, "readwrite");
      const store = transaction.objectStore(safetyStoreName);
      store.put(backup);
      store.put({ ...backup, id: safetyLatestKey });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    db.close();
  }

  function parseStoredBackup(): Loose | null {
    try {
      const saved = storage?.getItem(keys.safetyLatest);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  function queueSafetyBackup(snapshotData: BoardData, history: HistoryEntry[], revision: number, source = "save"): void {
    const cleanData = cleanForFirestore(snapshotData || starterData);
    const key = `${revision || 0}:${source}:${historySummary(cleanData)}:${snapshotSafetyScore(cleanData)}`;
    if (key === lastSafetyBackupKey) return;
    lastSafetyBackupKey = key;
    const backup = createSafetyBackup(cleanData, history, revision, source);
    safetyBackupQueue = safetyBackupQueue
      .catch(() => {})
      .then(() => putSafetyBackup(backup))
      .catch((error) => console.warn("Safety backup failed", error));
  }

  async function readLatestLocalSafetyBackup(): Promise<SafetyBackup | null> {
    const candidates: Loose[] = [];
    const stored = parseStoredBackup();
    if (stored) candidates.push(stored);
    const db = await openSafetyDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const transaction = db.transaction(safetyStoreName, "readonly");
        const request = transaction.objectStore(safetyStoreName).get(safetyLatestKey);
        request.onsuccess = () => {
          if (request.result) candidates.push(request.result);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
      db.close();
    }
    return candidates
      .filter((entry) => entry?.data && Number(entry.revision || 0))
      .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))[0] || null;
  }

  async function readLocalSafetyBackups(limit = 60): Promise<SafetyBackup[]> {
    const backups: Loose[] = [];
    const stored = parseStoredBackup();
    if (stored) backups.push(stored);
    const db = await openSafetyDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const transaction = db.transaction(safetyStoreName, "readonly");
        const request = transaction.objectStore(safetyStoreName).getAll();
        request.onsuccess = () => backups.push(...(request.result || []));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
      db.close();
    }
    const seen = new Set<string>();
    return backups
      .filter((entry) => entry?.id && entry.id !== safetyLatestKey && entry?.data && Number(entry.revision || 0))
      .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))
      .filter((entry) => {
        const key = `${entry.revision}:${entry.summary}:${entry.score}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  async function readLocalSafetyBackupById(id: string): Promise<SafetyBackup | null> {
    if (!id) return null;
    const db = await openSafetyDb();
    if (db) {
      const found = await new Promise<Loose | null>((resolve) => {
        const transaction = db.transaction(safetyStoreName, "readonly");
        const request = transaction.objectStore(safetyStoreName).get(id);
        request.onsuccess = () => resolve(request.result || null);
        transaction.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      });
      db.close();
      if (found?.data) return found;
    }
    const saved = parseStoredBackup();
    if (saved?.id === id && saved?.data) return saved;
    return null;
  }

  function saveLocalSnapshot(snapshotData: BoardData, history: HistoryEntry[], revision: number): void {
    const cleanSnapshot = cleanForFirestore(snapshotData);
    try {
      storage?.setItem(keys.data, JSON.stringify(cleanSnapshot));
      storage?.setItem(keys.history, JSON.stringify(cleanForFirestore(history)));
      storage?.setItem(keys.revision, String(revision || 0));
    } catch (error) {
      // A full localStorage (quota exceeded) must never block the real (Firestore) save:
      // it is only a local backup copy.
      console.warn("Local snapshot backup failed", error);
    }
    queueSafetyBackup(cleanSnapshot, history, revision, "local");
  }

  function readStoredHistory(): HistoryEntry[] {
    try {
      return normalizeHistory(JSON.parse(storage?.getItem(keys.history) || "[]"));
    } catch {
      return [];
    }
  }

  function readLocalSnapshot(): LocalSnapshot | null {
    try {
      const saved = storage?.getItem(keys.data);
      if (!saved) return null;
      return {
        data: normalizeData(JSON.parse(saved)),
        history: normalizeHistory(JSON.parse(storage?.getItem(keys.history) || "[]")),
        revision: Number(storage?.getItem(keys.revision) || 0)
      };
    } catch {
      return null;
    }
  }

  async function safestStartupSnapshot(
    remoteData: unknown,
    remoteRevision: number,
    remoteSafety?: { data: unknown; revision: number } | null
  ): Promise<StartupCandidate> {
    const candidates: StartupCandidate[] = [{
      data: normalizeData(remoteData || starterData),
      revision: Number(remoteRevision || 0),
      source: "Firestore"
    }];
    const localSnapshot = readLocalSnapshot();
    if (localSnapshot?.data) {
      candidates.push({
        data: normalizeData(localSnapshot.data),
        revision: Number(localSnapshot.revision || 0),
        source: "localStorage"
      });
    }
    const localSafety = await readLatestLocalSafetyBackup();
    if (localSafety?.data) {
      candidates.push({
        data: normalizeData(localSafety.data),
        revision: Number(localSafety.revision || 0),
        source: "local safety backup"
      });
    }
    if (remoteSafety?.data) {
      candidates.push({
        data: normalizeData(remoteSafety.data),
        revision: Number(remoteSafety.revision || 0),
        source: "remote safety backup"
      });
    }
    return candidates
      .sort((left, right) => {
        const revisionDelta = Number(right.revision || 0) - Number(left.revision || 0);
        if (revisionDelta) return revisionDelta;
        return snapshotSafetyScore(right.data) - snapshotSafetyScore(left.data);
      })[0];
  }

  return {
    saveLocalSnapshot,
    readLocalSnapshot,
    readStoredHistory,
    queueSafetyBackup,
    readLatestLocalSafetyBackup,
    readLocalSafetyBackups,
    readLocalSafetyBackupById,
    safestStartupSnapshot,
    flush: () => safetyBackupQueue.catch(() => {})
  };
}

/* ------------------------------------------------------------------------------------------------
 * Default store (real localStorage / IndexedDB, real key names) and the old app's function names.
 * ---------------------------------------------------------------------------------------------- */
let defaultStore: LocalStore | null = null;

/** The store bound to the real browser storage with the old app's key names. */
export function getDefaultLocalStore(): LocalStore {
  if (!defaultStore) defaultStore = createLocalStore();
  return defaultStore;
}

export function saveLocalSnapshot(data: BoardData, history: HistoryEntry[], revision: number): void {
  getDefaultLocalStore().saveLocalSnapshot(data, history, revision);
}
export function readLocalSnapshot(): LocalSnapshot | null {
  return getDefaultLocalStore().readLocalSnapshot();
}
export function queueSafetyBackup(data: BoardData, history: HistoryEntry[], revision: number, source = "save"): void {
  getDefaultLocalStore().queueSafetyBackup(data, history, revision, source);
}
export function readLatestLocalSafetyBackup(): Promise<SafetyBackup | null> {
  return getDefaultLocalStore().readLatestLocalSafetyBackup();
}
export function readLocalSafetyBackups(limit = 60): Promise<SafetyBackup[]> {
  return getDefaultLocalStore().readLocalSafetyBackups(limit);
}
export function readLocalSafetyBackupById(id: string): Promise<SafetyBackup | null> {
  return getDefaultLocalStore().readLocalSafetyBackupById(id);
}
export function safestStartupSnapshot(remoteData: unknown, remoteRevision: number, remoteSafety?: { data: unknown; revision: number } | null): Promise<StartupCandidate> {
  return getDefaultLocalStore().safestStartupSnapshot(remoteData, remoteRevision, remoteSafety);
}
