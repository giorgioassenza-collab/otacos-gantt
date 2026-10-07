import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClock, setRandom } from "../clock";
import { createLocalStore, createSafetyBackup, snapshotSafetyScore } from "../safety";
import {
  historyStorageKey, revisionStorageKey, safetyDbName, safetyLatestKey, safetyLocalStorageKey, safetyStoreName, storageKey
} from "../starter";
import { normalizeData } from "../normalize";
import type { BoardData } from "../types";
import { FIXED_NOW } from "./fixtures";
import { MemoryStorage, createFakeIndexedDB } from "./testkit";

const board = (taskCount: number, name = "Task"): BoardData =>
  normalizeData({ tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `t${i}`, name: `${name} ${i}`, start: "2026-06-10" })) });

beforeEach(() => {
  let tick = 0;
  setClock(() => FIXED_NOW + tick++);
  setRandom(() => 0.5);
});
afterEach(() => {
  setClock();
  setRandom();
});

describe("storage keys and record formats are the old app's", () => {
  it("uses the old localStorage and IndexedDB names", () => {
    expect(storageKey).toBe("tacos-gantt-board-data-v5");
    expect(historyStorageKey).toBe("tacos-gantt-board-history-v1");
    expect(revisionStorageKey).toBe("tacos-gantt-board-revision-v1");
    expect(safetyLocalStorageKey).toBe("tacos-gantt-board-safety-latest-v1");
    expect(safetyDbName).toBe("otacos-workflow-safety-v1");
    expect(safetyStoreName).toBe("snapshots");
    expect(safetyLatestKey).toBe("latest");
  });

  it("saveLocalSnapshot writes data, history and revision under those keys", async () => {
    const storage = new MemoryStorage();
    const idb = createFakeIndexedDB();
    const store = createLocalStore({ storage, indexedDB: idb.factory });
    store.saveLocalSnapshot(board(2), [], 1234);
    await store.flush();
    expect(JSON.parse(storage.getItem(storageKey) as string).tasks).toHaveLength(2);
    expect(JSON.parse(storage.getItem(historyStorageKey) as string)).toEqual([]);
    expect(storage.getItem(revisionStorageKey)).toBe("1234");
    // the safety backup record: same shape as the old app's
    const backup = JSON.parse(storage.getItem(safetyLocalStorageKey) as string);
    expect(Object.keys(backup).sort()).toEqual(["data", "history", "id", "revision", "savedAt", "score", "source", "summary"]);
    expect(backup).toMatchObject({ revision: 1234, source: "local", summary: "2 tasks, 0 PED, 0 influencers" });
    expect(backup.id).toMatch(/^1234-\d+-[0-9a-f]+$/);
    // IndexedDB: the backup under its own id AND a copy under "latest"
    const records = idb.databases.get(safetyDbName)?.get(safetyStoreName) as Map<string, { id: string }>;
    expect(records.has(backup.id)).toBe(true);
    expect(records.get(safetyLatestKey)).toMatchObject({ id: safetyLatestKey, revision: 1234 });
  });

  it("reads back what the OLD app left on the device", async () => {
    const storage = new MemoryStorage();
    const idb = createFakeIndexedDB();
    // what the old app wrote
    const legacyData = { tasks: [{ id: "t1", name: "Unsynced edit", start: "2026-06-10", label: "Pubblicazione" }], members: ["Member A"] };
    storage.setItem(storageKey, JSON.stringify(legacyData));
    storage.setItem(historyStorageKey, JSON.stringify([]));
    storage.setItem(revisionStorageKey, "999");
    const store = createLocalStore({ storage, indexedDB: idb.factory });
    const snapshot = store.readLocalSnapshot();
    expect(snapshot?.revision).toBe(999);
    expect(snapshot?.data.tasks[0].name).toBe("Unsynced edit");
    expect(snapshot?.data.tasks[0].label).toBe("Pubblicazione");
  });
});

describe("safety backups", () => {
  it("scores bigger boards higher and handles junk", () => {
    expect(snapshotSafetyScore(board(3))).toBeGreaterThan(snapshotSafetyScore(board(1)));
    expect(snapshotSafetyScore()).toBe(snapshotSafetyScore({}));
    expect(snapshotSafetyScore({ tasks: "x" } as unknown as BoardData)).toBe(snapshotSafetyScore({}));
  });

  it("createSafetyBackup clones and summarizes", () => {
    const source = board(2);
    const backup = createSafetyBackup(source, [], 55, "remote");
    expect(backup).toMatchObject({ revision: 55, source: "remote", summary: "2 tasks, 0 PED, 0 influencers" });
    expect(backup.data).toEqual(source);
    expect(backup.data).not.toBe(source);
    expect(createSafetyBackup(null, [], 0, "save").revision).toBeGreaterThan(0);
  });

  it("lists, de-duplicates and looks up local backups", async () => {
    const storage = new MemoryStorage();
    const store = createLocalStore({ storage, indexedDB: createFakeIndexedDB().factory });
    store.queueSafetyBackup(board(1), [], 10, "save");
    store.queueSafetyBackup(board(2), [], 20, "save");
    store.queueSafetyBackup(board(2), [], 20, "save"); // same key: ignored
    store.queueSafetyBackup(board(3), [], 30, "remote");
    await store.flush();
    const list = await store.readLocalSafetyBackups();
    expect(list.map((entry) => entry.revision)).toEqual([30, 20, 10]);
    expect(list.some((entry) => entry.id === safetyLatestKey)).toBe(false);
    const found = await store.readLocalSafetyBackupById(list[1].id);
    expect(found?.revision).toBe(20);
    expect(await store.readLocalSafetyBackupById("nope")).toBeNull();
    const latest = await store.readLatestLocalSafetyBackup();
    expect(latest?.revision).toBe(30);
  });

  it("works with localStorage only (no IndexedDB)", async () => {
    const storage = new MemoryStorage();
    const store = createLocalStore({ storage, indexedDB: null });
    store.queueSafetyBackup(board(2), [], 77, "save");
    await store.flush();
    expect((await store.readLatestLocalSafetyBackup())?.revision).toBe(77);
    const list = await store.readLocalSafetyBackups();
    expect(list).toHaveLength(1);
    expect((await store.readLocalSafetyBackupById(list[0].id))?.revision).toBe(77);
  });

  it("works with nothing at all", async () => {
    const store = createLocalStore({ storage: null, indexedDB: null });
    store.saveLocalSnapshot(board(1), [], 5);
    await store.flush();
    expect(store.readLocalSnapshot()).toBeNull();
    expect(await store.readLatestLocalSafetyBackup()).toBeNull();
  });

  it("a full localStorage never throws out of saveLocalSnapshot", async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createLocalStore({ storage, indexedDB: null });
    expect(() => store.saveLocalSnapshot(board(1), [], 5)).not.toThrow();
    await store.flush();
  });

  it("custom keys keep a demo store away from the real device data", async () => {
    const storage = new MemoryStorage();
    const store = createLocalStore({ storage, indexedDB: null, keys: { data: "demo-data", history: "demo-history", revision: "demo-rev", safetyLatest: "demo-safety", safetyDb: "demo-db" } });
    store.saveLocalSnapshot(board(1), [], 5);
    await store.flush();
    expect([...storage.map.keys()].sort()).toEqual(["demo-data", "demo-history", "demo-rev", "demo-safety"]);
  });
});

describe("safestStartupSnapshot", () => {
  it("prefers the highest revision, then the richest snapshot", async () => {
    const storage = new MemoryStorage();
    const store = createLocalStore({ storage, indexedDB: null });
    const remote = board(2);
    // nothing local: Firestore wins
    expect((await store.safestStartupSnapshot(remote, 100)).source).toBe("Firestore");

    // newer local snapshot (unsynced edits from an older session or the old app) wins
    storage.setItem(storageKey, JSON.stringify(board(3)));
    storage.setItem(revisionStorageKey, "150");
    expect(await store.safestStartupSnapshot(remote, 100)).toMatchObject({ source: "localStorage", revision: 150 });

    // a newer remote safety copy beats both
    const winner = await store.safestStartupSnapshot(remote, 100, { data: board(4), revision: 200 });
    expect(winner).toMatchObject({ source: "remote safety backup", revision: 200 });
    expect(winner.data.tasks).toHaveLength(4);

    // same revision: more content wins
    storage.setItem(revisionStorageKey, "100");
    const tie = await store.safestStartupSnapshot(remote, 100);
    expect(tie.source).toBe("localStorage");
    expect(tie.data.tasks).toHaveLength(3);
  });
});
