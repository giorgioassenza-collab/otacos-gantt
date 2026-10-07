/**
 * Framework-agnostic sync engine for the shared board document `boards/default`.
 *
 * Port of the old app's loadData / onSnapshot handler / saveData / performSaveData / commitBoardData /
 * retryPendingLocalSave / undo / restoreHistoryEntry / restoreSafetyBackup / login. The merge semantics are the
 * old app's (see merge.ts); what changed is only the packaging: state lives in a closure (no globals, no DOM), the
 * Firebase SDK sits behind the `BoardBackend` interface and the result is observable through `subscribe`/`getState`
 * (useSyncExternalStore friendly: methods are closures, they do not need `this`).
 *
 * Intentional differences from the old app (all safe, listed in the hand-off report):
 *  - snapshots that arrive while the initial load is running are held and applied once it finished (the old app could
 *    merge the empty starter data into the remote document during that window);
 *  - `readOnly` mode (nothing is ever written to Firestore or to this device);
 *  - messages are English.
 */
import type { BackendUser, BoardBackend, DocSnapshotLike } from "./backend";
import { createDemoBackend } from "./demoBackend";
import { createFirebaseBackend } from "./firebaseBackend";
import { now } from "./clock";
import { normalizeHistory, withHistoryEntry } from "./history";
import { applyDirtyLocalItems, dirtyIdsForSave, mergeBoardData, stampChangedData } from "./merge";
import { normalizeData } from "./normalize";
import { rollOverTasks, shouldRollOver } from "./rollover";
import { syncAutomaticPedPostsForTasks, syncInfluencerProgressTasks } from "./labels";
import { nextWorkingDayKey } from "./dates";
import { createLocalStore, createSafetyBackup, getDefaultLocalStore, type LocalStore } from "./safety";
import {
  BOARD_PATH,
  BOARD_SAFETY_BACKUPS_COLLECTION,
  BOARD_SAFETY_PATH,
  TEAM_EMAIL,
  createEnglishStarterData,
  createRawStarterData,
  maxUndoEntries
} from "./starter";
import type { BoardData, DirtyIds, HistoryEntry, SafetyBackup, SyncState, SyncStatus } from "./types";
import { cleanForFirestore, sameData } from "./util";

export { createDemoBackend } from "./demoBackend";
export { createFirebaseBackend } from "./firebaseBackend";
export type { BoardBackend } from "./backend";

export interface BoardSyncOptions {
  /** Defaults to the real Firebase backend (or the demo backend in dev when VITE_DEMO_BACKEND=1 / ?demo=1). */
  backend?: BoardBackend;
  /** Defaults to the real localStorage/IndexedDB with the old app's key names. */
  localStore?: LocalStore;
  /** The fixed team account. */
  email?: string;
  /** Never write to Firestore or to this device. Default: VITE_BOARD_READ_ONLY=1 (otherwise false). */
  readOnly?: boolean;
  /** How often unsynced local changes are retried (ms). 0 disables the timer. Default 5000. */
  retryIntervalMs?: number;
  /** How often roll-over / influencer progress run (ms). 0 disables the timer. Default 60000. */
  maintenanceIntervalMs?: number;
  /** Document written when `boards/default` does not exist. Default: the old app's starter data. */
  initialData?: BoardData;
}

export interface MutateOptions {
  /** Do not record an undo/history entry for this change (automatic changes, roll-over...). */
  skipUndo?: boolean;
}

export interface BoardSync {
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
  /** Starts watching authentication; loads the board as soon as the user is signed in. Idempotent. */
  start(): void;
  /** Stops listeners and timers (does not sign out). */
  stop(): void;
  /** Signs in with the fixed team email. Never throws: a failure is reported through state.authError. */
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Applies `fn` to a structuredClone of the current board, stamps the changes and queues the save exactly like the
   * old saveData. Resolves when the save finished (or failed and will be retried). If `fn` returns `false` the change
   * is discarded. Rejects when the board is not loaded yet or the engine is read-only.
   */
  mutate(fn: (draft: BoardData) => void | boolean, opts?: MutateOptions): Promise<void>;
  undo(): Promise<void>;
  restoreHistory(id: string): Promise<void>;
  restoreSafetyBackup(id: string): Promise<void>;
  /** Local safety backups (newest first) for the History panel. */
  listSafetyBackups(limit?: number): Promise<SafetyBackup[]>;
  /** Retry the pending local save now (the engine also does it on a timer and when the browser comes online). */
  retryPendingSave(): Promise<void>;
  /** Run the 20:00 roll-over, the automatic PED mirrors and the influencer progress tasks now. */
  runMaintenance(): Promise<void>;
  /** Resolves when the save queue is empty. */
  whenIdle(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

function errorText(error: unknown, fallback: string): string {
  const source = error as { code?: unknown; message?: unknown } | null | undefined;
  return String(source?.code || source?.message || fallback);
}

function envFlag(name: string): boolean {
  try {
    const value = (import.meta.env as Record<string, unknown>)[name];
    return value === "1" || value === "true" || value === true;
  } catch {
    return false;
  }
}

function resolveDefaultBackend(): BoardBackend {
  if (import.meta.env.DEV) {
    const wantsDemo =
      envFlag("VITE_DEMO_BACKEND") ||
      (typeof location !== "undefined" && /[?&]demo=1(&|$)/.test(location.search));
    if (wantsDemo) return createDemoBackend();
  }
  return createFirebaseBackend();
}

const demoLocalKeys = {
  data: "otacos-demo-board-data",
  history: "otacos-demo-board-history",
  revision: "otacos-demo-board-revision",
  safetyLatest: "otacos-demo-board-safety-latest",
  safetyDb: "otacos-demo-safety"
};

function messageForAuthError(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code || "");
  if (code === "auth/network-request-failed") return "Cannot reach the server. Check your connection and try again.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
  return "Wrong password";
}

export function createBoardSync(options: BoardSyncOptions = {}): BoardSync {
  const backend = options.backend ?? resolveDefaultBackend();
  const demo = backend.kind === "demo";
  const readOnly = options.readOnly ?? envFlag("VITE_BOARD_READ_ONLY");
  const localStore: LocalStore = options.localStore ?? (demo ? createLocalStore({ keys: demoLocalKeys }) : getDefaultLocalStore());
  const email = options.email ?? TEAM_EMAIL;
  const retryIntervalMs = options.retryIntervalMs ?? 5000;
  const maintenanceIntervalMs = options.maintenanceIntervalMs ?? 60000;
  const initialData: BoardData = options.initialData ?? (demo ? createEnglishStarterData() : createRawStarterData());

  /* ------------------------------------------------------------ engine state (the old app's globals) */
  let data: BoardData = normalizeData(createRawStarterData());
  let committedData: BoardData = structuredClone(data);
  let historyEntries: HistoryEntry[] = [];
  let undoStack: BoardData[] = [];
  let dataVersion = 0;
  let appStarted = false;
  /** Bumped on every reset so a load that was in flight when the session ended can notice and give up. */
  let sessionId = 0;
  let loaded = false;
  let heldSnapshot: DocSnapshotLike | null = null;
  let hasBoard = false;
  let unsubscribeBoard: (() => void) | null = null;
  let unsubscribeAuth: (() => void) | null = null;
  let applyingRemoteUpdate = false;
  let suppressRemoteUntil = 0;
  let pendingLocalRevision = 0;
  let pendingLocalData: BoardData | null = null;
  let pendingSaveCommittedAt = 0;
  let hasUnsyncedChanges = false;
  let saveQueue: Promise<void> = Promise.resolve();
  let remoteSafetyBackupUnavailable = false;
  let maintenanceRunning = false;

  let auth: SyncState["auth"] = "unknown";
  let authError = "";
  let syncStatus: SyncStatus = "connecting";
  let message = "Connecting...";
  let isError = false;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  let removeBrowserListeners: (() => void) | null = null;

  /* ---------------------------------------------------------------------------- observable state */
  const listeners = new Set<() => void>();
  let state: SyncState = buildState();

  function buildState(): SyncState {
    return {
      auth,
      ready: loaded,
      syncStatus,
      message,
      isError,
      data,
      history: historyEntries,
      revision: dataVersion,
      canUndo: undoStack.length > 0,
      hasUnsyncedChanges,
      authError,
      demo,
      readOnly
    };
  }

  function publish(): void {
    const next = buildState();
    const keys = Object.keys(next) as Array<keyof SyncState>;
    if (keys.every((key) => next[key] === state[key])) return;
    state = next;
    listeners.forEach((listener) => listener());
  }

  function setStatus(status: SyncStatus, text: string): void {
    syncStatus = status;
    message = text;
    isError = status === "error" || status === "offline";
    if (isError) console.warn("Workflow background sync notice:", text);
    publish();
  }

  function later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  }

  /* ----------------------------------------------------------------------------- local persistence */
  function persistLocal(snapshotData: BoardData, history: HistoryEntry[], revision: number): void {
    if (readOnly) return;
    localStore.saveLocalSnapshot(snapshotData, history, revision);
  }

  /* ------------------------------------------------------------------------------------- loading */
  async function readLatestRemoteSafetyBackup(): Promise<{ data: unknown; revision: number } | null> {
    try {
      const snapshot = await backend.getDoc(BOARD_SAFETY_PATH);
      const backup = snapshot.exists() ? snapshot.data() : null;
      return backup?.data && Number(backup.revision || 0) ? { data: backup.data, revision: Number(backup.revision) } : null;
    } catch (error) {
      console.warn("Remote safety backup read failed", error);
      return null;
    }
  }

  async function bestLocalFallback(): Promise<BoardData> {
    const localSnapshot = localStore.readLocalSnapshot();
    const localSafety = await localStore.readLatestLocalSafetyBackup();
    const bestLocal = [localSnapshot, localSafety]
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.data))
      .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))[0];
    historyEntries = normalizeHistory((bestLocal as { history?: HistoryEntry[] } | undefined)?.history || []);
    dataVersion = bestLocal?.revision || 0;
    return bestLocal?.data ? normalizeData(bestLocal.data) : normalizeData(createRawStarterData());
  }

  class SessionCancelled extends Error {}

  async function loadData(session: number): Promise<BoardData> {
    const stillCurrent = (): void => {
      if (session !== sessionId) throw new SessionCancelled("session ended");
    };
    try {
      hasBoard = true;
      const snapshot = await backend.getDoc(BOARD_PATH);
      stillCurrent();
      if (!snapshot.exists()) {
        if (readOnly) throw Object.assign(new Error("The board document does not exist (read-only mode)."), { code: "not-found" });
        await backend.setDoc(BOARD_PATH, {
          data: structuredClone(initialData),
          history: [],
          revision: 0,
          updatedAt: backend.serverTimestamp()
        });
        stillCurrent();
      }
      unsubscribeBoard?.();
      unsubscribeBoard = backend.onSnapshot(BOARD_PATH, handleRemoteSnapshot, () => {
        setStatus("error", "Sync error: shared data is not up to date");
      });
      setStatus("synced", "Connected");
      if (snapshot.exists()) {
        const snapshotData = snapshot.data() || {};
        const remoteRevision = Number(snapshotData.revision || 0);
        historyEntries = readOnly ? [] : localStore.readStoredHistory();
        const remoteData = normalizeData(snapshotData.data);
        if (!readOnly) {
          const remoteSafety = await readLatestRemoteSafetyBackup();
          stillCurrent();
          const safest = await localStore.safestStartupSnapshot(remoteData, remoteRevision, remoteSafety);
          stillCurrent();
          if (safest?.data && (Number(safest.revision || 0) > remoteRevision || !sameData(safest.data, remoteData))) {
            dataVersion = Number(safest.revision || 0);
            pendingLocalData = cleanForFirestore(safest.data);
            pendingLocalRevision = dataVersion;
            suppressRemoteUntil = now() + 30000;
            persistLocal(pendingLocalData, historyEntries, dataVersion);
            setStatus("saving", `Restoring data from safety copy: ${safest.source}`);
            later(() => void retryPendingLocalSave(), 250);
            return normalizeData(safest.data);
          }
        }
        dataVersion = remoteRevision;
        pendingLocalData = null;
        pendingLocalRevision = 0;
        persistLocal(remoteData, historyEntries, dataVersion);
        return remoteData;
      }
      historyEntries = [];
      return normalizeData(initialData);
    } catch (error) {
      if (error instanceof SessionCancelled) throw error;
      console.error("Firebase load failed", error);
      setStatus("error", `Cannot read shared data: ${errorText(error, "Firebase error")}`);
      return bestLocalFallback();
    }
  }

  /* ---------------------------------------------------------------- remote snapshots (onSnapshot) */
  function handleRemoteSnapshot(remoteSnapshot: DocSnapshotLike): void {
    if (!loaded) {
      heldSnapshot = remoteSnapshot;
      return;
    }
    if (!remoteSnapshot.exists()) return;
    const remoteDoc = remoteSnapshot.data() || {};
    const remote = remoteDoc.data;
    const remoteRevision = Number(remoteDoc.revision || 0);
    if (!remote) return;
    const normalizedRemote = normalizeData(remote);
    if (pendingLocalData && sameData(normalizedRemote, pendingLocalData)) {
      data = normalizedRemote;
      dataVersion = Math.max(dataVersion, remoteRevision);
      committedData = structuredClone(data);
      persistLocal(data, historyEntries, dataVersion);
      pendingLocalData = null;
      pendingLocalRevision = 0;
      pendingSaveCommittedAt = 0;
      hasUnsyncedChanges = false;
      setStatus("synced", "Synced");
      return;
    }
    if (pendingLocalData && pendingLocalRevision && remoteRevision <= pendingLocalRevision) return;
    if (pendingLocalData && !sameData(normalizedRemote, pendingLocalData)) {
      if (readOnly) return;
      const mergedWithPending = mergeBoardData(normalizeData(pendingLocalData), normalizedRemote);
      if (sameData(mergedWithPending, normalizedRemote)) {
        // Everything we had pending is already contained in the remote board: nothing left to write.
        data = normalizedRemote;
        dataVersion = Math.max(dataVersion, remoteRevision);
        committedData = structuredClone(data);
        persistLocal(data, historyEntries, dataVersion);
        pendingLocalData = null;
        pendingLocalRevision = 0;
        pendingSaveCommittedAt = 0;
        hasUnsyncedChanges = false;
        setStatus("synced", "Synced");
        return;
      }
      data = mergedWithPending;
      pendingLocalData = cleanForFirestore(data);
      // The remote board is the new baseline: only what we really changed on top of it gets stamped again. (With the
      // old baseline every item merged in from the remote looked like a local edit and was re-stamped, so two devices
      // saving at the same time re-stamped each other's items forever.)
      committedData = structuredClone(normalizedRemote);
      void saveData(true).catch(() => {});
      return;
    }
    if (remoteRevision <= dataVersion) return;
    if (applyingRemoteUpdate && now() < suppressRemoteUntil && sameData(normalizedRemote, data)) return;
    if (sameData(normalizedRemote, data)) return;
    const mergedRemote = mergeBoardData(data, normalizedRemote);
    const shouldRepairRemote = !sameData(mergedRemote, normalizedRemote);
    dataVersion = Math.max(dataVersion, remoteRevision);
    data = mergedRemote;
    if (!readOnly) historyEntries = localStore.readStoredHistory();
    committedData = structuredClone(data);
    persistLocal(data, historyEntries, dataVersion);
    setStatus("synced", "Synced");
    if (shouldRepairRemote && !pendingLocalData && !readOnly) void saveData(true).catch(() => {});
  }

  /* ------------------------------------------------------------------------------------- saving */
  function saveData(skipUndo = false): Promise<void> {
    hasUnsyncedChanges = true;
    try {
      stampChangedData(data, committedData);
      const dirtyIds = dirtyIdsForSave(data, committedData);
      const localRevision = Math.max(dataVersion + 1, now());
      dataVersion = localRevision;
      const saveSnapshotData = cleanForFirestore(data);
      pendingLocalData = saveSnapshotData;
      pendingLocalRevision = localRevision;
      pendingSaveCommittedAt = 0;
      persistLocal(pendingLocalData, historyEntries, localRevision);
      saveQueue = saveQueue.catch(() => {}).then(() => performSaveData(saveSnapshotData, localRevision, skipUndo, dirtyIds));
      publish();
      return saveQueue;
    } catch (error) {
      // Whatever went wrong (bad data, storage error...), never let it vanish silently.
      console.error("saveData failed before queueing", error);
      setStatus("error", `Save failed: ${(error as Error)?.message || "unknown error"}. Reload the page and try again.`);
      throw error;
    }
  }

  interface Committed {
    data: BoardData;
    history: HistoryEntry[];
    revision: number;
  }

  async function commitBoardData(
    localData: BoardData,
    localHistory: HistoryEntry[],
    revision: number,
    dirtyIds: Partial<DirtyIds> = {},
    includeSafetyBackup: boolean = !remoteSafetyBackupUnavailable
  ): Promise<Committed> {
    if (!hasBoard) {
      return { data: normalizeData(localData), history: normalizeHistory(localHistory), revision };
    }
    try {
      return await backend.runTransaction<Committed>(async (transaction) => {
        let commitData = normalizeData(localData);
        const latestSnapshot = await transaction.get(BOARD_PATH);
        const latestDoc = latestSnapshot.exists() ? latestSnapshot.data() : undefined;
        if (latestDoc?.data) commitData = mergeBoardData(commitData, normalizeData(latestDoc.data));
        commitData = applyDirtyLocalItems(commitData, localData, dirtyIds);
        const commitRevision = Math.max(revision, Number(latestDoc?.revision || 0) + 1, now());
        const safetyBackup = createSafetyBackup(commitData, [], commitRevision, "remote");
        transaction.set(BOARD_PATH, {
          data: cleanForFirestore(commitData),
          history: [],
          revision: commitRevision,
          ...(includeSafetyBackup ? { safetyRevision: commitRevision } : {}),
          updatedAt: backend.serverTimestamp()
        }, { merge: true });
        if (includeSafetyBackup) {
          transaction.set(BOARD_SAFETY_PATH, safetyBackup as unknown as Record<string, unknown>, { merge: false });
          transaction.set(`${BOARD_SAFETY_BACKUPS_COLLECTION}/${commitRevision}`, safetyBackup as unknown as Record<string, unknown>, { merge: false });
        }
        return { data: commitData, history: normalizeHistory(localHistory), revision: commitRevision };
      });
    } catch (error) {
      const code = String((error as { code?: unknown } | null)?.code || "");
      if (includeSafetyBackup && (code === "permission-denied" || code === "firestore/permission-denied")) {
        // Retry the board write under its own rules; optional backup permissions must never prevent task
        // changes from being persisted.
        const committed = await commitBoardData(localData, localHistory, revision, dirtyIds, false);
        remoteSafetyBackupUnavailable = true;
        console.warn("Remote safety backup unavailable; board saved with local backup.");
        return committed;
      }
      throw error;
    }
  }

  function isOfflineError(error: unknown): boolean {
    const code = String((error as { code?: unknown } | null)?.code || "");
    const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    return browserOffline || code === "unavailable" || code === "firestore/unavailable";
  }

  async function performSaveData(saveSnapshotData: BoardData, saveRevision: number, skipUndo = false, dirtyIds: DirtyIds | Record<string, never> = {}): Promise<void> {
    try {
      setStatus("saving", "Saving...");
      const snapshotData = normalizeData(saveSnapshotData || data);
      const snapshotRevision = Number(saveRevision || dataVersion || now());
      const shouldRecordHistory = !skipUndo && committedData && !sameData(committedData, snapshotData);
      if (shouldRecordHistory) {
        undoStack.push(structuredClone(committedData));
        if (undoStack.length > maxUndoEntries) undoStack.shift();
        historyEntries = withHistoryEntry(historyEntries, committedData);
        publish();
      }
      if (hasBoard) {
        const nextRevision = Math.max(snapshotRevision, dataVersion + 1, now());
        suppressRemoteUntil = now() + 1500;
        if (!pendingLocalRevision || pendingLocalRevision <= snapshotRevision || sameData(pendingLocalData, saveSnapshotData)) {
          pendingLocalRevision = nextRevision;
          pendingLocalData = cleanForFirestore(snapshotData);
        }
        persistLocal(pendingLocalData || snapshotData, historyEntries, Math.max(pendingLocalRevision || 0, nextRevision));
        applyingRemoteUpdate = true;
        const hadNewerPendingBeforeCommit = Boolean(pendingLocalData && !sameData(pendingLocalData, snapshotData));
        const committed = await commitBoardData(snapshotData, historyEntries, nextRevision, dirtyIds);
        const committedClean = cleanForFirestore(committed.data);
        const hasNewerPending = hadNewerPendingBeforeCommit || Boolean(pendingLocalData && !sameData(pendingLocalData, snapshotData) && !sameData(pendingLocalData, committedClean));
        if (!hasNewerPending) {
          data = committed.data;
        }
        historyEntries = committed.history;
        dataVersion = Math.max(dataVersion, committed.revision);
        if (!hasNewerPending) {
          persistLocal(cleanForFirestore(data), historyEntries, dataVersion);
          pendingLocalData = null;
          pendingLocalRevision = 0;
          pendingSaveCommittedAt = now();
        }
        later(() => {
          applyingRemoteUpdate = false;
        }, 250);
        if (!hasNewerPending) {
          committedData = structuredClone(data);
          hasUnsyncedChanges = false;
        }
        setStatus("synced", "Synced");
        return;
      }
      persistLocal(snapshotData, historyEntries, dataVersion);
      data = snapshotData;
      committedData = structuredClone(snapshotData);
      hasUnsyncedChanges = false;
      setStatus("offline", "Offline: saved on this device only");
    } catch (error) {
      applyingRemoteUpdate = false;
      hasUnsyncedChanges = true;
      const fallbackRevision = Math.max(dataVersion + 1, now());
      dataVersion = fallbackRevision;
      pendingLocalData = cleanForFirestore(saveSnapshotData || data);
      pendingLocalRevision = fallbackRevision;
      pendingSaveCommittedAt = 0;
      suppressRemoteUntil = now() + 30000;
      persistLocal(pendingLocalData, historyEntries, pendingLocalRevision);
      committedData = structuredClone(normalizeData(pendingLocalData));
      console.error("Firestore save failed", error);
      if (isOfflineError(error)) {
        setStatus("offline", "Offline: changes are kept on this device and will sync automatically");
      } else {
        setStatus("error", `Not synced yet, retrying automatically: ${errorText(error, "Firestore error")}`);
      }
    }
  }

  async function retryPendingLocalSave(): Promise<void> {
    if (readOnly || !hasBoard || !pendingLocalData || applyingRemoteUpdate) return;
    if (pendingSaveCommittedAt && now() - pendingSaveCommittedAt < 30000) return;
    try {
      applyingRemoteUpdate = true;
      const retryData = normalizeData(pendingLocalData);
      const retryRevision = Math.max(pendingLocalRevision || 0, dataVersion + 1, now());
      const committed = await commitBoardData(retryData, historyEntries, retryRevision);
      data = committed.data;
      historyEntries = committed.history;
      dataVersion = committed.revision;
      committedData = structuredClone(data);
      persistLocal(cleanForFirestore(data), historyEntries, dataVersion);
      pendingLocalData = null;
      pendingLocalRevision = 0;
      pendingSaveCommittedAt = now();
      hasUnsyncedChanges = false;
      setStatus("synced", "Synced");
    } catch (error) {
      console.error("Firestore retry failed", error);
      const retryError = String((error as { code?: unknown; message?: unknown } | null)?.code || (error as { message?: unknown } | null)?.message || "");
      // The old app treats any error text containing "22" as "local data too old": discard it and reload remote.
      if (retryError === "22" || retryError.includes("22")) {
        pendingLocalData = null;
        pendingLocalRevision = 0;
        pendingSaveCommittedAt = 0;
        try {
          const snapshot = await backend.getDoc(BOARD_PATH);
          const remoteDoc = snapshot.exists() ? snapshot.data() : undefined;
          if (remoteDoc?.data) {
            dataVersion = Number(remoteDoc.revision || dataVersion || 0);
            data = normalizeData(remoteDoc.data);
            committedData = structuredClone(data);
            persistLocal(data, historyEntries, dataVersion);
          }
        } catch (reloadError) {
          console.error("Firestore reload after retry failed", reloadError);
        }
        setStatus("synced", "Old local data discarded: synced with Firebase");
        return;
      }
      if (isOfflineError(error)) setStatus("offline", "Offline: changes are kept on this device and will sync automatically");
      else setStatus("error", `Retrying save: ${errorText(error, "Firestore error")}`);
    } finally {
      later(() => {
        applyingRemoteUpdate = false;
      }, 250);
    }
  }

  /* ------------------------------------------------------------------------- public operations */
  function assertWritable(): void {
    if (readOnly) throw new Error("The board is open in read-only mode: changes are not saved.");
    if (!loaded) throw new Error("The board is still loading.");
  }

  async function mutate(fn: (draft: BoardData) => void | boolean, opts: MutateOptions = {}): Promise<void> {
    assertWritable();
    const draft = structuredClone(data);
    const result = fn(draft);
    if (result === false) return;
    data = draft;
    return saveData(Boolean(opts.skipUndo));
  }

  async function undo(): Promise<void> {
    if (readOnly) return;
    const previous = undoStack.pop();
    if (!previous) {
      publish();
      return;
    }
    data = normalizeData(previous);
    await saveData(true);
  }

  async function commitRestore(restored: BoardData, label: string, doneMessage: string, failPrefix: string, suppressMs: number): Promise<void> {
    historyEntries = withHistoryEntry(historyEntries, data, label);
    data = restored;
    // The restored items must win the merge against the newer remote copies they replace: stamp what differs from the
    // current board as a local edit and protect it like any other save. (The old app skipped this, so a restore was
    // silently overridden by the newer remote versions of every item changed since.)
    stampChangedData(data, committedData);
    const restoreDirtyIds = dirtyIdsForSave(data, committedData);
    undoStack.push(structuredClone(committedData));
    if (undoStack.length > maxUndoEntries) undoStack.shift();
    publish();
    try {
      if (hasBoard) {
        const nextRevision = Math.max(dataVersion + 1, now());
        dataVersion = nextRevision;
        suppressRemoteUntil = now() + suppressMs;
        pendingLocalRevision = nextRevision;
        pendingLocalData = cleanForFirestore(data);
        persistLocal(pendingLocalData, historyEntries, nextRevision);
        applyingRemoteUpdate = true;
        setStatus("saving", "Saving...");
        const committed = await commitBoardData(pendingLocalData, historyEntries, nextRevision, restoreDirtyIds);
        data = committed.data;
        historyEntries = committed.history;
        dataVersion = committed.revision;
        pendingLocalData = cleanForFirestore(data);
        pendingLocalRevision = dataVersion;
        pendingSaveCommittedAt = now();
        persistLocal(pendingLocalData, historyEntries, dataVersion);
        later(() => {
          applyingRemoteUpdate = false;
        }, 250);
      } else {
        persistLocal(data, historyEntries, dataVersion);
      }
      committedData = structuredClone(data);
      setStatus("synced", doneMessage);
    } catch (error) {
      applyingRemoteUpdate = false;
      pendingLocalData = null;
      pendingLocalRevision = 0;
      pendingSaveCommittedAt = 0;
      console.error(failPrefix, error);
      setStatus("error", `${failPrefix}: ${errorText(error, "unknown error")}`);
    }
  }

  async function restoreHistory(id: string): Promise<void> {
    assertWritable();
    const entry = historyEntries.find((item) => item.id === id);
    if (!entry) return;
    await commitRestore(normalizeData(entry.data), "Before restore", "Version restored", "Restore failed", 1500);
  }

  async function restoreSafetyBackup(id: string): Promise<void> {
    assertWritable();
    const backup = await localStore.readLocalSafetyBackupById(id);
    if (!backup?.data) return;
    await commitRestore(normalizeData(backup.data), "Before safety restore", "Safety backup restored", "Safety restore failed", 30000);
  }

  /** Scheduled runs only happen when the maintenance timer is enabled; an explicit runMaintenance() always runs. */
  function autoMaintenance(): void {
    if (maintenanceIntervalMs > 0) void runMaintenance().catch(() => {});
  }

  /** Roll-over (20:00), automatic PED mirrors and influencer progress tasks. */
  async function runMaintenance(): Promise<void> {
    if (!loaded || readOnly || maintenanceRunning) return;
    maintenanceRunning = true;
    try {
      const target = nextWorkingDayKey(now());
      if ((data.tasks || []).some((task) => shouldRollOver(task, target))) {
        await mutate((draft) => {
          rollOverTasks(draft, now());
        }, { skipUndo: true });
      }
      await mutate((draft) => syncInfluencerProgressTasks(draft), { skipUndo: true });
    } finally {
      maintenanceRunning = false;
    }
  }

  /* ------------------------------------------------------------------------- session lifecycle */
  function startTimers(): void {
    if (retryIntervalMs > 0 && !retryTimer) retryTimer = setInterval(() => void retryPendingLocalSave(), retryIntervalMs);
    if (maintenanceIntervalMs > 0 && !maintenanceTimer) maintenanceTimer = setInterval(() => void runMaintenance().catch(() => {}), maintenanceIntervalMs);
    if (!removeBrowserListeners && typeof window !== "undefined" && typeof document !== "undefined") {
      const onVisible = () => {
        if (!document.hidden) autoMaintenance();
      };
      const onOnline = () => void retryPendingLocalSave();
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", onOnline);
      removeBrowserListeners = () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onOnline);
      };
    }
  }

  function stopSession(): void {
    unsubscribeBoard?.();
    unsubscribeBoard = null;
    if (retryTimer) clearInterval(retryTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    retryTimer = null;
    maintenanceTimer = null;
    removeBrowserListeners?.();
    removeBrowserListeners = null;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    applyingRemoteUpdate = false;
  }

  async function startApp(): Promise<void> {
    if (appStarted) return;
    appStarted = true;
    const session = sessionId;
    auth = "signed-in";
    authError = "";
    setStatus("connecting", "Connecting...");
    try {
      data = await loadData(session);
    } catch (error) {
      if (error instanceof SessionCancelled) return; // signed out / stopped while loading
      throw error;
    }
    let automaticChanged = false;
    if (!readOnly) {
      // Same sequence as the old startApp: mirrors and progress tasks are applied, then the baseline is taken.
      const automaticPedChanged = syncAutomaticPedPostsForTasks(data);
      const automaticInfluencerChanged = syncInfluencerProgressTasks(data);
      automaticChanged = automaticPedChanged || automaticInfluencerChanged;
    }
    committedData = structuredClone(data);
    loaded = true;
    publish();
    if (automaticChanged) await saveData(true).catch(() => {});
    if (heldSnapshot) {
      const held = heldSnapshot;
      heldSnapshot = null;
      handleRemoteSnapshot(held);
    }
    publish();
    if (!readOnly) {
      autoMaintenance();
      void retryPendingLocalSave();
    }
    startTimers();
  }

  function resetSession(): void {
    sessionId += 1;
    stopSession();
    appStarted = false;
    loaded = false;
    heldSnapshot = null;
    hasBoard = false;
    data = normalizeData(createRawStarterData());
    committedData = structuredClone(data);
    historyEntries = [];
    undoStack = [];
    dataVersion = 0;
    pendingLocalData = null;
    pendingLocalRevision = 0;
    pendingSaveCommittedAt = 0;
    hasUnsyncedChanges = false;
    suppressRemoteUntil = 0;
  }

  function onAuth(user: BackendUser | null): void {
    if (user && !user.isAnonymous) {
      void startApp().catch((error) => {
        console.error("Board start failed", error);
        setStatus("error", `Cannot start: ${errorText(error, "unknown error")}`);
      });
      return;
    }
    if (appStarted) resetSession();
    auth = "signed-out";
    syncStatus = "connecting";
    message = "Signed out";
    isError = false;
    publish();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (unsubscribeAuth) return;
      unsubscribeAuth = backend.onAuthStateChanged(onAuth);
    },
    stop() {
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      // Full reset: a later start() (e.g. React StrictMode re-mounting) begins a clean session.
      if (appStarted) resetSession();
      else stopSession();
    },
    async login(password) {
      if (!password) {
        authError = "Enter the password";
        publish();
        return;
      }
      authError = "";
      publish();
      try {
        await backend.signIn(email, password);
        void startApp().catch((error) => {
          console.error("Board start failed", error);
          setStatus("error", `Cannot start: ${errorText(error, "unknown error")}`);
        });
      } catch (error) {
        console.warn("Login failed", (error as { code?: unknown } | null)?.code);
        authError = messageForAuthError(error);
        publish();
      }
    },
    async logout() {
      await backend.signOut();
      // The auth listener resets the session; do it here too for backends that do not emit.
      if (appStarted) resetSession();
      auth = "signed-out";
      message = "Signed out";
      syncStatus = "connecting";
      isError = false;
      publish();
    },
    mutate,
    undo,
    restoreHistory,
    restoreSafetyBackup,
    listSafetyBackups: (limit) => localStore.readLocalSafetyBackups(limit),
    retryPendingSave: retryPendingLocalSave,
    runMaintenance,
    whenIdle: async () => {
      await saveQueue.catch(() => {});
    }
  };
}
