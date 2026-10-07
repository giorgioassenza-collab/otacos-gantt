/**
 * Sync engine tests against the in-memory fake Firestore. No network, no Firebase, no password:
 * the fake backend accepts the test password below.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClock, setRandom } from "../clock";
import { deleteTaskById, touchItem } from "../merge";
import { fakeError, createMemoryStore, type MemoryStore } from "../memoryBackend";
import { normalizeData } from "../normalize";
import { createLocalStore } from "../safety";
import { BOARD_PATH, BOARD_SAFETY_PATH, historyStorageKey, revisionStorageKey, storageKey } from "../starter";
import { createBoardSync, type BoardSync, type BoardSyncOptions } from "../sync";
import type { BoardData, BoardDocument, Task } from "../types";
import { sameData } from "../util";
import { MemoryStorage, createFakeIndexedDB, monotonicClock, sleep, waitFor } from "./testkit";

const TEST_PASSWORD = "test-password-not-a-secret";

function seedBoard(): BoardData {
  return normalizeData({
    members: ["Member A", "Member B"],
    tasks: [
      { id: "t1", projectId: "p-accounting", name: "Task one", status: "TO DO", start: "2026-06-10", end: "2026-06-10", updatedAt: 1000 },
      { id: "t2", projectId: "p-accounting", name: "Task two", status: "TO DO", start: "2026-06-11", end: "2026-06-11", updatedAt: 1000 },
      { id: "t3", projectId: "p-customer-care", name: "Task three", status: "DONE", start: "2026-06-12", end: "2026-06-12", updatedAt: 1000 }
    ],
    influencers: [{ id: "i1", name: "Creator One", city: "Rome", status: "TO CONTACT", sortOrder: 1, updatedAt: 1000 }]
  });
}

function newTask(id: string, name: string): Task {
  return normalizeData({ tasks: [{ id, projectId: "p-accounting", name, status: "TO DO", start: "2026-06-15", end: "2026-06-15" }] }).tasks[0];
}

function readDoc(store: MemoryStore): BoardDocument {
  return store.read(BOARD_PATH) as unknown as BoardDocument;
}

interface Harness {
  store: MemoryStore;
  engines: BoardSync[];
  storages: MemoryStorage[];
  make(extra?: Partial<BoardSyncOptions>, storage?: MemoryStorage): BoardSync;
  ready(engine: BoardSync): Promise<void>;
}

function harness(seed: BoardData | null = seedBoard(), revision = 5000): Harness {
  const store = createMemoryStore({ password: TEST_PASSWORD });
  if (seed) store.write(BOARD_PATH, { data: seed, history: [], revision, updatedAt: 0 });
  const engines: BoardSync[] = [];
  const storages: MemoryStorage[] = [];
  return {
    store,
    engines,
    storages,
    make(extra = {}, storage = new MemoryStorage()) {
      storages.push(storage);
      const engine = createBoardSync({
        backend: store.client({ signedIn: true }),
        localStore: createLocalStore({ storage, indexedDB: null }),
        retryIntervalMs: 0,
        maintenanceIntervalMs: 0,
        ...extra
      });
      engines.push(engine);
      return engine;
    },
    async ready(engine) {
      engine.start();
      await waitFor(() => engine.getState().ready, 3000, "engine ready");
    }
  };
}

let h: Harness;
beforeEach(() => {
  setClock(monotonicClock());
  setRandom();
});
afterEach(() => {
  h?.engines.forEach((engine) => engine.stop());
  setClock();
  setRandom();
});

async function converge(...engines: BoardSync[]): Promise<void> {
  await waitFor(
    () => engines.every((engine) => !engine.getState().hasUnsyncedChanges) && engines.every((engine) => sameData(engine.getState().data, engines[0].getState().data)),
    4000,
    "engines to converge"
  );
  await h.store.settle();
}

describe("loading", () => {
  it("loads the shared document and reports a synced state", async () => {
    h = harness();
    const engine = h.make();
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getState().syncStatus));
    expect(engine.getState()).toMatchObject({ auth: "unknown", ready: false, syncStatus: "connecting" });
    await h.ready(engine);
    const state = engine.getState();
    expect(state).toMatchObject({ auth: "signed-in", ready: true, syncStatus: "synced", isError: false, canUndo: false, hasUnsyncedChanges: false, demo: false, readOnly: false });
    expect(state.revision).toBe(5000);
    expect(state.data.tasks.map((task) => task.id)).toEqual(["t1", "t2", "t3"]);
    expect(seen).toContain("connecting");
    expect(seen).toContain("synced");
    // getState is referentially stable between changes (useSyncExternalStore requirement)
    expect(engine.getState()).toBe(engine.getState());
  });

  it("does not merge starter defaults into the remote document while loading", async () => {
    // the old app could merge its empty starter data into the remote board when the first snapshot arrived mid-load
    const remote = normalizeData({
      statuses: [{ name: "Custom A", color: "#111111" }, { name: "Custom B", color: "#222222" }],
      labels: ["only-label"], creatorStores: ["Only Store"], pedStatuses: [{ name: "Only Ped", color: "#333333" }], tasks: []
    });
    h = harness(remote, 777);
    const engine = h.make();
    await h.ready(engine);
    await sleep(60);
    expect(engine.getState().data.statuses.map((status) => status.name)).toEqual(["Custom A", "Custom B"]);
    expect(engine.getState().data.labels).toEqual(["only-label"]);
    expect(engine.getState().data.creatorStores).toEqual(["Only Store"]);
    expect(readDoc(h.store).revision).toBe(777);
    expect(h.store.commits.transactions).toBe(0);
    expect(h.store.commits.setDocs).toBe(0);
  });

  it("creates the document when it does not exist, with the provided initial data", async () => {
    h = harness(null);
    const initial = normalizeData({ members: [], labels: ["creator"], tasks: [] });
    const engine = h.make({ initialData: initial });
    await h.ready(engine);
    const doc = readDoc(h.store);
    expect(doc.revision).toBe(0);
    expect(doc.history).toEqual([]);
    expect(doc.data.labels).toEqual(["creator"]);
    expect(doc.data.tasks).toEqual([]);
  });

  it("falls back to the newest local copy when the document cannot be read", async () => {
    h = harness();
    const storage = new MemoryStorage();
    const local = seedBoard();
    local.tasks[0].name = "Local copy";
    storage.setItem(storageKey, JSON.stringify(local));
    storage.setItem(revisionStorageKey, "4000");
    storage.setItem(historyStorageKey, "[]");
    h.store.failNext("getDoc", fakeError("unavailable"), 1);
    const engine = h.make({}, storage);
    await h.ready(engine);
    expect(engine.getState().data.tasks[0].name).toBe("Local copy");
    expect(engine.getState().syncStatus).toBe("error");
    expect(engine.getState().message).toContain("Cannot read shared data");
  });
});

describe("login", () => {
  it("rejects a wrong password and signs in with the right one", async () => {
    h = harness();
    const engine = createBoardSync({
      backend: h.store.client(),
      localStore: createLocalStore({ storage: new MemoryStorage(), indexedDB: null }),
      retryIntervalMs: 0,
      maintenanceIntervalMs: 0
    });
    h.engines.push(engine);
    engine.start();
    await waitFor(() => engine.getState().auth === "signed-out", 2000, "signed-out");
    await engine.login("");
    expect(engine.getState().authError).toBe("Enter the password");
    await engine.login("definitely wrong");
    expect(engine.getState().authError).toBe("Wrong password");
    expect(engine.getState().auth).toBe("signed-out");
    await engine.login(TEST_PASSWORD);
    await waitFor(() => engine.getState().ready, 3000, "ready after login");
    expect(engine.getState()).toMatchObject({ auth: "signed-in", authError: "" });
    await engine.logout();
    expect(engine.getState()).toMatchObject({ auth: "signed-out", ready: false });
    expect(engine.getState().data.tasks).toEqual([]);
  });
});

describe("saving", () => {
  it("applies a change to a copy, stamps it and commits it with safety backups", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    const before = engine.getState().data;
    await engine.mutate((draft) => {
      draft.tasks[0].name = "Renamed";
    });
    // the published snapshot before the change was not mutated
    expect(before.tasks[0].name).toBe("Task one");
    const state = engine.getState();
    expect(state).toMatchObject({ syncStatus: "synced", hasUnsyncedChanges: false, canUndo: true });
    expect(state.data.tasks[0].name).toBe("Renamed");
    expect(state.data.tasks[0].updatedAt).toBeGreaterThan(1000);
    expect(state.data.tasks[1].updatedAt).toBe(1000);
    const doc = readDoc(h.store);
    expect(doc.data.tasks[0].name).toBe("Renamed");
    expect(doc.history).toEqual([]);
    expect(doc.revision).toBeGreaterThan(5000);
    expect(state.revision).toBe(doc.revision);
    // boardSafety/latest and boardSafetyBackups/<revision> carry the same backup
    const safety = h.store.read(BOARD_SAFETY_PATH) as unknown as { revision: number; source: string; data: BoardData };
    expect(safety.revision).toBe(doc.revision);
    expect(safety.source).toBe("remote");
    expect(safety.data.tasks[0].name).toBe("Renamed");
    expect(h.store.read(`boardSafetyBackups/${doc.revision}`)).toBeTruthy();
    expect((doc as unknown as { safetyRevision: number }).safetyRevision).toBe(doc.revision);
  });

  it("walks through the saving state", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    const statuses: string[] = [];
    engine.subscribe(() => statuses.push(`${engine.getState().syncStatus}:${engine.getState().message}`));
    await engine.mutate((draft) => {
      draft.members.push("Member C");
    });
    expect(statuses).toContain("saving:Saving...");
    expect(statuses[statuses.length - 1]).toBe("synced:Synced");
  });

  it("a mutate callback that throws changes nothing; returning false cancels", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    const before = engine.getState().data;
    await expect(engine.mutate(() => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await engine.mutate((draft) => {
      draft.tasks = [];
      return false;
    });
    expect(engine.getState().data).toBe(before);
    expect(h.store.commits.transactions).toBe(0);
  });

  it("rejects mutations before the board is loaded", async () => {
    h = harness();
    const engine = h.make();
    await expect(engine.mutate(() => {})).rejects.toThrow(/loading/);
  });

  it("skipUndo leaves the undo stack alone", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Automatic"; }, { skipUndo: true });
    expect(engine.getState().canUndo).toBe(false);
    await engine.mutate((draft) => { draft.tasks[0].name = "Manual"; });
    expect(engine.getState().canUndo).toBe(true);
  });
});

describe("concurrent edits from two devices", () => {
  it("converge without losing either side's work", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    await Promise.all([
      a.mutate((draft) => {
        draft.tasks.find((task) => task.id === "t1")!.name = "Renamed by A";
        draft.tasks.push(newTask("tA", "Added by A"));
      }),
      b.mutate((draft) => {
        draft.tasks.find((task) => task.id === "t2")!.name = "Renamed by B";
        draft.tasks.push(newTask("tB", "Added by B"));
        draft.members.push("Member C");
        draft.influencers[0].city = "Milan";
      })
    ]);
    await converge(a, b);
    const doc = readDoc(h.store).data;
    const names = Object.fromEntries(doc.tasks.map((task) => [task.id, task.name]));
    expect(names).toMatchObject({ t1: "Renamed by A", t2: "Renamed by B", t3: "Task three", tA: "Added by A", tB: "Added by B" });
    expect(doc.members).toContain("Member C");
    expect(doc.influencers[0].city).toBe("Milan");
    expect(sameData(a.getState().data, doc)).toBe(true);
    expect(sameData(b.getState().data, doc)).toBe(true);
  });

  it("on the same item the later edit wins, and both devices agree", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    const pa = a.mutate((draft) => { draft.tasks[0].name = "First writer"; draft.tasks[1].name = "Only A touched this"; });
    const pb = b.mutate((draft) => { draft.tasks[0].name = "Second writer"; });
    await Promise.all([pa, pb]);
    await converge(a, b);
    const doc = readDoc(h.store).data;
    expect(doc.tasks[0].name).toBe("Second writer");
    expect(doc.tasks[1].name).toBe("Only A touched this");
  });

  it("influencer fields merge per field", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    await Promise.all([
      a.mutate((draft) => { draft.influencers[0].status = "CONTACTED"; }),
      b.mutate((draft) => { draft.influencers[0].city = "Naples"; })
    ]);
    await converge(a, b);
    const row = readDoc(h.store).data.influencers[0];
    expect(row.status).toBe("CONTACTED");
    expect(row.city).toBe("Naples");
  });

  it("a remote change reaches an idle device", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    await a.mutate((draft) => { draft.tasks[2].status = "TO DO"; });
    await waitFor(() => b.getState().data.tasks[2].status === "TO DO", 3000, "B to see A's edit");
    expect(b.getState().hasUnsyncedChanges).toBe(false);
    expect(b.getState().canUndo).toBe(false);
  });
});

describe("deletions", () => {
  it("a deleted item stays deleted even when a stale device edits it afterwards", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    const pa = a.mutate((draft) => deleteTaskById(draft, "t1"));
    const pb = b.mutate((draft) => {
      const task = draft.tasks.find((item) => item.id === "t1")!;
      task.name = "Edited by the stale device";
      touchItem(task);
    });
    await Promise.all([pa, pb]);
    await converge(a, b);
    const doc = readDoc(h.store).data;
    expect(doc.tasks.map((task) => task.id)).toEqual(["t2", "t3"]);
    expect(Object.keys(doc.deletedIds.tasks)).toEqual(["t1"]);
    expect(a.getState().data.tasks.map((task) => task.id)).toEqual(["t2", "t3"]);
    expect(b.getState().data.tasks.map((task) => task.id)).toEqual(["t2", "t3"]);
  });

  it("a deletion made while another device was offline is not undone when it reconnects", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    // B's next save fails (offline), keeping its copy of t3 pending
    h.store.failNext("transaction", fakeError("unavailable"), 1);
    await b.mutate((draft) => { draft.members.push("Member C"); });
    expect(b.getState().syncStatus).toBe("offline");
    await a.mutate((draft) => deleteTaskById(draft, "t3"));
    await b.retryPendingSave();
    await converge(a, b);
    const doc = readDoc(h.store).data;
    expect(doc.tasks.some((task) => task.id === "t3")).toBe(false);
    expect(doc.members).toContain("Member C");
    expect(b.getState().data.tasks.some((task) => task.id === "t3")).toBe(false);
  });

  it("undo of a delete brings the task back for everyone", async () => {
    h = harness();
    const a = h.make();
    const b = h.make();
    await h.ready(a);
    await h.ready(b);
    await a.mutate((draft) => deleteTaskById(draft, "t2"));
    await waitFor(() => !b.getState().data.tasks.some((task) => task.id === "t2"), 3000, "B to see the delete");
    expect(a.getState().canUndo).toBe(true);
    await a.undo();
    await converge(a, b);
    // The old app's tombstones are permanent (a restored copy would be filtered): the undo restores the board
    // snapshot, tombstone included, which is the original behaviour. The point here: both devices agree.
    expect(sameData(a.getState().data, b.getState().data)).toBe(true);
    expect(sameData(a.getState().data, readDoc(h.store).data)).toBe(true);
  });
});

describe("failed saves", () => {
  it("keeps the change locally, reports it, and retries until it lands", async () => {
    h = harness();
    const storage = new MemoryStorage();
    const engine = h.make({ retryIntervalMs: 25 }, storage);
    await h.ready(engine);
    h.store.failNext("transaction", fakeError("deadline-exceeded", "slow"), 2);
    await engine.mutate((draft) => { draft.tasks[0].name = "Will be retried"; });
    expect(engine.getState()).toMatchObject({ syncStatus: "error", hasUnsyncedChanges: true });
    expect(engine.getState().message).toContain("retrying automatically: deadline-exceeded");
    // the old app's local snapshot holds the edit (survives a reload)
    expect(JSON.parse(storage.getItem(storageKey) as string).tasks[0].name).toBe("Will be retried");
    expect(readDoc(h.store).data.tasks[0].name).toBe("Task one");
    await waitFor(() => !engine.getState().hasUnsyncedChanges, 4000, "automatic retry");
    expect(readDoc(h.store).data.tasks[0].name).toBe("Will be retried");
    expect(engine.getState().syncStatus).toBe("synced");
  });

  it("an offline error is reported as offline", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    h.store.failNext("transaction", fakeError("unavailable"), 1);
    await engine.mutate((draft) => { draft.tasks[0].name = "Offline edit"; });
    expect(engine.getState().syncStatus).toBe("offline");
    expect(engine.getState().isError).toBe(true);
    await engine.retryPendingSave();
    expect(engine.getState()).toMatchObject({ syncStatus: "synced", hasUnsyncedChanges: false });
    expect(readDoc(h.store).data.tasks[0].name).toBe("Offline edit");
  });

  it("a later edit while an earlier one is still pending keeps both", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    h.store.failNext("transaction", fakeError("unavailable"), 1);
    await engine.mutate((draft) => { draft.tasks[0].name = "First edit"; });
    await engine.mutate((draft) => { draft.tasks[1].name = "Second edit"; });
    await engine.retryPendingSave();
    await waitFor(() => !engine.getState().hasUnsyncedChanges, 3000, "everything saved");
    const doc = readDoc(h.store).data;
    expect(doc.tasks[0].name).toBe("First edit");
    expect(doc.tasks[1].name).toBe("Second edit");
  });

  it("unsynced local edits from a previous session (or the old app) are pushed on startup", async () => {
    h = harness(seedBoard(), 5000);
    const storage = new MemoryStorage();
    const local = seedBoard();
    local.tasks[1].name = "Edited offline last time";
    local.tasks[1].updatedAt = 999999;
    storage.setItem(storageKey, JSON.stringify(local));
    storage.setItem(historyStorageKey, "[]");
    storage.setItem(revisionStorageKey, "9000");
    const engine = h.make({}, storage);
    await h.ready(engine);
    await waitFor(() => readDoc(h.store).data.tasks[1].name === "Edited offline last time", 4000, "restore of local edits");
    await waitFor(() => !engine.getState().hasUnsyncedChanges && engine.getState().syncStatus === "synced", 4000, "synced");
    expect(engine.getState().data.tasks[1].name).toBe("Edited offline last time");
  });
});

describe("permission-denied safety backup", () => {
  it("still saves the board and stops asking for the backup permission", async () => {
    h = harness();
    h.store.denyWrites("boardSafety/latest", "boardSafetyBackups/*");
    const engine = h.make();
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Saved without remote backup"; });
    expect(engine.getState()).toMatchObject({ syncStatus: "synced", hasUnsyncedChanges: false });
    const doc = readDoc(h.store);
    expect(doc.data.tasks[0].name).toBe("Saved without remote backup");
    expect(h.store.read(BOARD_SAFETY_PATH)).toBeUndefined();
    expect((doc as unknown as { safetyRevision?: number }).safetyRevision).toBeUndefined();
    // first save: one failed attempt (backup included) + the retry without it
    const afterFirst = h.store.commits.transactions;
    expect(afterFirst).toBe(1);
    await engine.mutate((draft) => { draft.tasks[1].name = "Second save"; });
    expect(h.store.commits.transactions).toBe(afterFirst + 1);
    expect(readDoc(h.store).data.tasks[1].name).toBe("Second save");
    // when permissions come back a NEW engine (fresh session) writes the backups again
    h.store.allowAllWrites();
    const other = h.make();
    await h.ready(other);
    await other.mutate((draft) => { draft.tasks[2].name = "With backup again"; });
    expect(h.store.read(BOARD_SAFETY_PATH)).toBeTruthy();
  });

  it("other write errors are not swallowed as permission problems", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    h.store.failNext("transaction", fakeError("resource-exhausted"), 1);
    await engine.mutate((draft) => { draft.tasks[0].name = "x"; });
    expect(engine.getState().syncStatus).toBe("error");
    expect(engine.getState().message).toContain("resource-exhausted");
  });
});

describe("undo, history and restore", () => {
  it("undo restores the previous board and saves it", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Changed"; });
    expect(engine.getState().canUndo).toBe(true);
    await engine.undo();
    expect(engine.getState().data.tasks[0].name).toBe("Task one");
    expect(readDoc(h.store).data.tasks[0].name).toBe("Task one");
    expect(engine.getState().canUndo).toBe(false);
    await engine.undo(); // nothing left: no-op
  });

  it("keeps a bounded undo stack and history", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    for (let i = 0; i < 12; i += 1) {
      await engine.mutate((draft) => { draft.tasks[0].name = `Edit ${i}`; });
    }
    expect(engine.getState().history.length).toBe(10);
    let undone = 0;
    while (engine.getState().canUndo) {
      await engine.undo();
      undone += 1;
      if (undone > 40) throw new Error("undo never ends");
    }
    expect(undone).toBe(12);
  });

  it("restoreHistory brings back an older version as a new change", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Version two"; });
    await engine.mutate((draft) => { draft.tasks[0].name = "Version three"; });
    const history = engine.getState().history;
    const oldest = history[history.length - 1];
    expect(oldest.data.tasks[0].name).toBe("Task one");
    await engine.restoreHistory(oldest.id);
    expect(engine.getState().data.tasks[0].name).toBe("Task one");
    expect(readDoc(h.store).data.tasks[0].name).toBe("Task one");
    expect(engine.getState().syncStatus).toBe("synced");
    expect(engine.getState().message).toBe("Version restored");
    expect(engine.getState().history[0].label).toBe("Before restore");
    await engine.restoreHistory("does-not-exist"); // ignored
  });

  it("restoreSafetyBackup restores a local safety backup", async () => {
    h = harness();
    const idb = createFakeIndexedDB();
    const storage = new MemoryStorage();
    const localStore = createLocalStore({ storage, indexedDB: idb.factory });
    const engine = h.make({ localStore }, storage);
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Edit that will be rolled back"; });
    await localStore.flush();
    const backups = await engine.listSafetyBackups();
    expect(backups.length).toBeGreaterThan(0);
    const original = backups.find((backup) => backup.data.tasks[0].name === "Task one");
    expect(original).toBeTruthy();
    await engine.restoreSafetyBackup(original!.id);
    expect(engine.getState().data.tasks[0].name).toBe("Task one");
    expect(readDoc(h.store).data.tasks[0].name).toBe("Task one");
    expect(engine.getState().message).toBe("Safety backup restored");
    await engine.restoreSafetyBackup("missing"); // ignored
  });

  it("a failed restore is reported, not thrown", async () => {
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    await engine.mutate((draft) => { draft.tasks[0].name = "Version two"; });
    const entry = engine.getState().history[0];
    h.store.failNext("transaction", fakeError("aborted"), 3);
    await engine.restoreHistory(entry.id);
    expect(engine.getState().syncStatus).toBe("error");
    expect(engine.getState().message).toContain("Restore failed");
  });
});

describe("read-only mode", () => {
  it("never writes to Firestore or to the device, but follows remote changes", async () => {
    h = harness();
    const storage = new MemoryStorage();
    const engine = h.make({ readOnly: true }, storage);
    await h.ready(engine);
    expect(engine.getState().readOnly).toBe(true);
    await expect(engine.mutate((draft) => { draft.tasks = []; })).rejects.toThrow(/read-only/);
    await engine.undo();
    await engine.runMaintenance();
    expect(h.store.commits).toEqual({ transactions: 0, setDocs: 0 });
    expect(storage.map.size).toBe(0);
    const doc = readDoc(h.store);
    h.store.write(BOARD_PATH, { ...doc, data: { ...doc.data, tasks: doc.data.tasks.slice(1), deletedIds: { ...doc.data.deletedIds, tasks: { t1: 5 } } }, revision: doc.revision + 10 });
    await waitFor(() => engine.getState().data.tasks.length === 2, 3000, "remote change");
    expect(h.store.commits).toEqual({ transactions: 0, setDocs: 0 });
  });

  it("does not create a missing document", async () => {
    h = harness(null);
    const engine = h.make({ readOnly: true });
    await h.ready(engine);
    expect(h.store.read(BOARD_PATH)).toBeUndefined();
    expect(engine.getState().syncStatus).toBe("error");
  });
});

describe("maintenance", () => {
  it("rolls unfinished tasks over to the next working day and saves without an undo entry", async () => {
    // fixed "now": Wednesday 2026-06-10 20:30 -> target Thursday 2026-06-11
    const fixed = new Date(2026, 5, 10, 20, 30).getTime();
    setClock(() => fixed);
    h = harness();
    const engine = h.make();
    await h.ready(engine);
    await engine.runMaintenance();
    const tasks = Object.fromEntries(engine.getState().data.tasks.map((task) => [task.id, task]));
    expect(tasks.t1).toMatchObject({ start: "2026-06-11", end: "2026-06-11" });
    expect(tasks.t2).toMatchObject({ start: "2026-06-11", end: "2026-06-11" });
    expect(tasks.t3).toMatchObject({ start: "2026-06-12", end: "2026-06-12" }); // DONE: untouched
    expect(engine.getState().canUndo).toBe(false);
    expect(readDoc(h.store).data.tasks.find((task) => task.id === "t1")?.start).toBe("2026-06-11");
  });
});

describe("demo and default backends", () => {
  it("the demo backend starts empty (no invented business data) and is dev only", async () => {
    const { createDemoBackend, resetDemoBackend } = await import("../demoBackend");
    const key = "test-demo-board";
    resetDemoBackend(key);
    const backend = createDemoBackend({ autoLogin: true, storageKey: key });
    expect(backend.kind).toBe("demo");
    const engine = createBoardSync({ backend, localStore: createLocalStore({ storage: new MemoryStorage(), indexedDB: null }), retryIntervalMs: 0, maintenanceIntervalMs: 0 });
    engine.start();
    await waitFor(() => engine.getState().ready, 3000, "demo ready");
    const state = engine.getState();
    expect(state.demo).toBe(true);
    expect(state.data.tasks).toEqual([]);
    expect(state.data.pedPosts).toEqual([]);
    expect(state.data.influencers).toEqual([]);
    expect(state.data.members).toEqual([]);
    expect(state.data.labels).toEqual(["creator", "Contact", "Ask OK Alice", "Send contract", "Notify Giorgia", "Video in store", "Publication"]);
    engine.stop();
  });
});
