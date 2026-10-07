/**
 * Differential tests: the TypeScript port must give the same output as the ORIGINAL functions from the legacy
 * single-file app on the synthetic fixtures in fixtures.ts.
 *
 * The expected values live in golden/golden.json. They are produced by evaluating the original functions in a node:vm
 * sandbox (scratchpad/harness/originalDataHarness.mjs: pinned clock, deterministic Math.random). Regenerate with
 *
 *   UPDATE_GOLDEN=1 npx vitest run src/data/__tests__/differential.test.ts
 *
 * (needs the original app under scratchpad/orig, or ORIGINAL_APP_DIR; ORIGINAL_DATA_HARNESS overrides the harness path).
 * Without UPDATE_GOLDEN the tests only read the committed golden file, so they run anywhere.
 *
 * Intentional, documented divergences (all backward compatible) are neutralised in `canon()`:
 *  - PED posts/influencers keep unknown extra fields (the old app drops them), e.g. `createdAt` on a PED post.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setClock, setRandom } from "../clock";
import { nextWorkingDayKey, currentDateKey, shiftDateString, dateKey } from "../dates";
import { historyChangeLines, historyChanges, historySummary, normalizeHistory, withHistoryEntry, formatDiffEntry } from "../history";
import {
  addInfluencerToGantt, addPedItemToGantt, addPedItemToPed, duplicateGanttTask, duplicatePedItem, ensurePedPostForTask,
  isCreatorLabel, isPublicationLabel, isVideoInStoreLabel, creatorDuplicateTasksFromControls, setInfluencerField,
  shouldAutoCreatePedPost, syncAutomaticPedPostsForTasks, syncCreatorStatusToGantt, syncInfluencerContactTask,
  syncInfluencerProgressTasks, removeLinkedPedPostForTask, isConfirmedInfluencer, isContactedInfluencer
} from "../labels";
import {
  applyDirtyLocalItems, deleteInfluencerById, deletePedPostById, deleteTaskById, dirtyIdsForSave, mergeBoardData,
  stampChangedData, touchItem
} from "../merge";
import { normalizeData, normalizeHour, normalizePedFormat, readableTextColor, uxInfluencerOptionColor } from "../normalize";
import { rollOverTasks } from "../rollover";
import { snapshotSafetyScore } from "../safety";
import type { BoardData, CreatorControls } from "../types";
import { influencerOptionKey, slugify, uniqueStrings } from "../util";
import {
  FIXED_NOW, T, controls, creatorBase, creatorCases, legacyBoard, mergeLocal, mergeRemote, mergeTieLocal,
  mergeTieRemote, normalizeInputs, opsBoard, rolloverBoard, rolloverNows, stampCurrent, stampPrevious
} from "./fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, "golden", "golden.json");
const SCRATCH = "C:\\Users\\Utente\\AppData\\Local\\Temp\\claude\\C--Users-Utente-O-Tacos-gantt-claude\\2466893e-2297-4ff5-8f89-eb6a0ce1a70d\\scratchpad";
const harnessPath = process.env.ORIGINAL_DATA_HARNESS || join(SCRATCH, "harness", "originalDataHarness.mjs");
const update = process.env.UPDATE_GOLDEN === "1";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const json = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const sorted = (set: Set<string> | undefined): string[] => [...(set || [])].sort();
const revive = (ids: Record<string, string[]>): Record<string, Set<string>> =>
  Object.fromEntries(Object.entries(ids).map(([kind, list]) => [kind, new Set(list)]));

/** Normalises a board for comparison: strips the documented divergences. */
function stripDivergences(board: Loose): Loose {
  const copy = clone(board);
  (copy.pedPosts || []).forEach((post: Loose) => { delete post.createdAt; });
  (copy.influencers || []).forEach((row: Loose) => { delete row.createdAt; });
  return copy;
}

interface Harness {
  api: Loose;
  setNow(ms: number): void;
  reseed(): void;
}

/** One case: a name plus how to compute the result with the original and with the port. */
interface Case {
  name: string;
  now?: number;
  orig: (h: Harness) => unknown | Promise<unknown>;
  port: () => unknown | Promise<unknown>;
}

const cases: Case[] = [];
const add = (c: Case): void => { cases.push(c); };

/* ----------------------------------------------------------------- helpers: pure functions */
const sampleStrings = ["", "  ", "Video", "reel", "Reel ", "carosello", "Carousel", "statica", "post", "story", "STATIC", "unknown", null, undefined];
sampleStrings.forEach((value, index) => {
  add({ name: `helper/normalizePedFormat/${index}`, orig: (h) => h.api.normalizePedFormat(value), port: () => normalizePedFormat(value) });
});
["", "9", "9:30", "11", "11:05", "13:45", "20:59", "21:15", "x", "7:7", "007:30", "12:3"].forEach((value) => {
  add({ name: `helper/normalizeHour/${value}`, orig: (h) => h.api.normalizeHour(value), port: () => normalizeHour(value) });
});
["#ffffff", "#000", "#111827", "nope", "", "#fef3c7", "#7c5cff"].forEach((value) => {
  add({ name: `helper/readableTextColor/${value}`, orig: (h) => h.api.readableTextColor(value), port: () => readableTextColor(value) });
});
["Creator ", "  Re-Source  ", "A – B", "Rock ‘n’ Roll", "Caffè", "", "X  -  Y"].forEach((value) => {
  add({ name: `helper/influencerOptionKey/${value}`, orig: (h) => h.api.influencerOptionKey(value), port: () => influencerOptionKey(value) });
  add({ name: `helper/slugify/${value}`, orig: (h) => h.api.slugify(value), port: () => slugify(value) });
});
add({ name: "helper/uniqueStrings", orig: (h) => h.api.uniqueStrings(["a", "A", " b ", "", null], ["B", "c"]), port: () => uniqueStrings(["a", "A", " b ", "", null], ["B", "c"]) });
(["city", "status", "type", "when", "other"] as const).forEach((key) => {
  ["Rome", "to contact", "Creator", "now", "zzz"].forEach((value, index) => {
    add({
      name: `helper/uxColor/${key}/${value}`,
      orig: (h) => h.api.uxInfluencerOptionColor(key, value, index, [{ name: "Creator", color: "#010203" }]),
      port: () => uxInfluencerOptionColor(key, value, index, [{ id: "x", name: "Creator", color: "#010203" }])
    });
  });
});
[
  ["2026-06-10", 1], ["2026-06-30", 1], ["2026-12-31", 1], ["2026-03-01", -1], ["2024-02-28", 2], ["2026-06-10", -30]
].forEach(([value, days]) => {
  add({ name: `date/shiftDateString/${value}/${days}`, orig: (h) => h.api.shiftDateString(value, days), port: () => shiftDateString(value as string, days as number) });
});
add({ name: "date/currentDateKey", orig: (h) => h.api.currentDateKey(), port: () => currentDateKey() });
add({ name: "date/dateKey", orig: (h) => h.api.dateKey(new Date(2026, 0, 5)), port: () => dateKey(new Date(2026, 0, 5)) });
(["Booked ✅", "confermato", "CONFIRMED", "Contacted", "to contact", "Contattato", "ghosted", ""] as const).forEach((status) => {
  add({ name: `helper/status/${status}`, orig: (h) => [h.api.isConfirmedInfluencer({ status }), h.api.isContactedInfluencer({ status }), h.api.isContactInfluencerStatus(status)], port: () => [isConfirmedInfluencer({ status }), isContactedInfluencer({ status }), status.trim().toUpperCase() === "TO CONTACT" || status.trim().toUpperCase() === "TBC"] });
});
([
  "creator", " Creator ", "Pubblicazione", "pubblicazione ", "Video in store", "VIDEO IN STORE", "Contattare", "", undefined
] as const).forEach((label, index) => {
  add({
    name: `labels/legacy-label-tests/${index}`,
    orig: (h) => [h.api.isCreatorLabel(label), h.api.isPublicationLabel(label), h.api.isVideoInStoreLabel(label), h.api.shouldAutoCreatePedPost({ label }), h.api.shouldAutoCreatePedPost({ label, pedAutoDismissed: true })],
    port: () => [isCreatorLabel(label), isPublicationLabel(label), isVideoInStoreLabel(label), shouldAutoCreatePedPost({ label }), shouldAutoCreatePedPost({ label, pedAutoDismissed: true })]
  });
});

/* ---------------------------------------------------------------------------- normalizeData */
normalizeInputs.forEach(({ name, input }) => {
  add({ name, orig: (h) => h.api.normalizeData(clone(input)), port: () => normalizeData(clone(input)) });
});
add({
  name: "normalize/idempotent-on-legacy-rich",
  orig: (h) => h.api.normalizeData(h.api.normalizeData(clone(legacyBoard))),
  port: () => normalizeData(normalizeData(clone(legacyBoard)))
});
// the same board seen at a much later date: the 30 day "Ghosted" ageing depends on the clock
add({ name: "normalize/legacy-rich-later", now: new Date(2027, 0, 20, 9, 0).getTime(), orig: (h) => h.api.normalizeData(clone(legacyBoard)), port: () => normalizeData(clone(legacyBoard)) });

/* ------------------------------------------------------------------------------ merge */
const mergePairs: Array<[string, Loose, Loose]> = [
  ["local-vs-remote", mergeLocal, mergeRemote],
  ["remote-vs-local", mergeRemote, mergeLocal],
  ["tie", mergeTieLocal, mergeTieRemote],
  ["tie-swapped", mergeTieRemote, mergeTieLocal],
  ["empty-vs-remote", {}, mergeRemote],
  ["local-vs-empty", mergeLocal, {}],
  ["null-vs-null", null, null],
  ["legacy-vs-merge-remote", legacyBoard, mergeRemote],
  ["same-board", legacyBoard, legacyBoard]
];
mergePairs.forEach(([label, local, remote]) => {
  add({ name: `merge/${label}`, orig: (h) => h.api.mergeBoardData(clone(local), clone(remote)), port: () => mergeBoardData(clone(local), clone(remote)) });
});
add({
  name: "merge/is-idempotent-and-does-not-mutate-inputs",
  orig: (h) => {
    const local = clone(mergeLocal);
    const remote = clone(mergeRemote);
    const once = h.api.mergeBoardData(local, remote);
    return { once, again: h.api.mergeBoardData(once, remote), localUnchanged: JSON.stringify(local) === JSON.stringify(mergeLocal), remoteUnchanged: JSON.stringify(remote) === JSON.stringify(mergeRemote) };
  },
  port: () => {
    const local = clone(mergeLocal);
    const remote = clone(mergeRemote);
    const once = mergeBoardData(local, remote);
    return { once, again: mergeBoardData(once, remote), localUnchanged: JSON.stringify(local) === JSON.stringify(mergeLocal), remoteUnchanged: JSON.stringify(remote) === JSON.stringify(mergeRemote) };
  }
});

/* ---------------------------------------------------------------------- stamp / dirty / apply */
add({
  name: "stamp/changed-data",
  orig: (h) => { const current = clone(stampCurrent); h.api.stampChangedData(current, clone(stampPrevious)); return current; },
  port: () => { const current = clone(stampCurrent) as unknown as BoardData; stampChangedData(current, clone(stampPrevious) as unknown as BoardData); return current; }
});
add({
  name: "stamp/normalized-inputs",
  orig: (h) => { const current = h.api.normalizeData(clone(stampCurrent)); h.api.stampChangedData(current, h.api.normalizeData(clone(stampPrevious))); return current; },
  port: () => { const current = normalizeData(clone(stampCurrent)); stampChangedData(current, normalizeData(clone(stampPrevious))); return current; }
});
add({
  name: "stamp/no-change",
  orig: (h) => { const current = h.api.normalizeData(clone(stampPrevious)); h.api.stampChangedData(current, h.api.normalizeData(clone(stampPrevious))); return current; },
  port: () => { const current = normalizeData(clone(stampPrevious)); stampChangedData(current, normalizeData(clone(stampPrevious))); return current; }
});
add({
  name: "stamp/missing-previous",
  orig: (h) => { const current = clone(stampCurrent); h.api.stampChangedData(current, null); return current; },
  port: () => { const current = clone(stampCurrent) as unknown as BoardData; stampChangedData(current, null); return current; }
});
add({
  name: "dirty/raw",
  orig: (h) => { const ids = h.api.dirtyIdsForSave(clone(stampCurrent), clone(stampPrevious)); return { tasks: [...ids.tasks].sort(), pedPosts: [...ids.pedPosts].sort(), influencers: [...ids.influencers].sort() }; },
  port: () => { const ids = dirtyIdsForSave(clone(stampCurrent) as Loose, clone(stampPrevious) as Loose); return { tasks: sorted(ids.tasks), pedPosts: sorted(ids.pedPosts), influencers: sorted(ids.influencers) }; }
});
add({
  name: "dirty/empty-args",
  orig: (h) => { const ids = h.api.dirtyIdsForSave(); return { tasks: [...ids.tasks], pedPosts: [...ids.pedPosts], influencers: [...ids.influencers] }; },
  port: () => { const ids = dirtyIdsForSave(); return { tasks: sorted(ids.tasks), pedPosts: sorted(ids.pedPosts), influencers: sorted(ids.influencers) }; }
});
const dirtyVariants: Array<[string, Record<string, string[]>]> = [
  ["all-kinds", { tasks: ["tA", "tD", "tZ-missing"], pedPosts: ["pB", "pL"], influencers: ["i1", "i-local", "i2"] }],
  ["influencers-only", { influencers: ["i-local", "i1"] }],
  ["empty", {}],
  ["empty-sets", { tasks: [], pedPosts: [], influencers: [] }]
];
dirtyVariants.forEach(([label, ids]) => {
  add({
    name: `apply-dirty/${label}`,
    orig: (h) => h.api.applyDirtyLocalItems(clone(mergeRemote), clone(mergeLocal), revive(ids)),
    port: () => applyDirtyLocalItems(clone(mergeRemote), clone(mergeLocal) as Loose, revive(ids))
  });
});
add({
  name: "apply-dirty/after-real-merge",
  orig: (h) => {
    const merged = h.api.mergeBoardData(clone(mergeLocal), clone(mergeRemote));
    return h.api.applyDirtyLocalItems(merged, clone(mergeLocal), revive({ tasks: ["tA", "tB", "tD"], influencers: ["i1"] }));
  },
  port: () => applyDirtyLocalItems(mergeBoardData(clone(mergeLocal), clone(mergeRemote)), clone(mergeLocal) as Loose, revive({ tasks: ["tA", "tB", "tD"], influencers: ["i1"] }))
});

/* ------------------------------------------------------------------------------ creator */
creatorCases.forEach(({ name, base, createdAt, controls: ctl }) => {
  add({
    name,
    orig: (h) => h.api.creatorDuplicateTasksFromControls(clone(base), createdAt, clone(ctl)),
    port: () => creatorDuplicateTasksFromControls(clone(base), createdAt, clone(ctl) as unknown as CreatorControls, { legacyLabels: true })
  });
});

/* ------------------------------------------------------------------------------ roll-over */
rolloverNows.forEach(({ name, now }) => {
  add({
    name: `rollover/${name}`,
    now,
    orig: async (h) => {
      h.api.setData(h.api.normalizeData(clone(rolloverBoard)));
      await h.api.otRollOverUnfinished();
      return { target: h.api.otNextWorkingDayKey(), board: h.api.normalizeData(h.api.getData()) };
    },
    port: () => {
      const data = normalizeData(clone(rolloverBoard));
      rollOverTasks(data, now);
      return { target: nextWorkingDayKey(now), board: normalizeData(data) };
    }
  });
});

/* ---------------------------------------------------------------- cross-view helper ops */
interface OpsCase {
  name: string;
  now?: number;
  /** Applied to the normalized board before the operation (both sides). */
  prepare?: (data: Loose) => void;
  orig: (api: Loose, data: Loose) => unknown | Promise<unknown>;
  port: (data: Loose) => unknown;
}
const ops: OpsCase[] = [];
const op = (c: OpsCase): void => { ops.push(c); };
const byId = (list: Loose[], id: string): Loose => list.find((item) => item.id === id);

op({ name: "duplicateGanttTask/publication", orig: (api, d) => api.duplicateGanttTask(byId(d.tasks, "t-pub")), port: (d) => duplicateGanttTask(d, byId(d.tasks, "t-pub")) });
op({ name: "duplicateGanttTask/plain", orig: (api, d) => api.duplicateGanttTask(byId(d.tasks, "t-plain")), port: (d) => duplicateGanttTask(d, byId(d.tasks, "t-plain")) });
op({ name: "duplicateGanttTask/null", orig: (api) => api.duplicateGanttTask(null), port: (d) => duplicateGanttTask(d, null) });
op({ name: "ensurePedPostForTask/creates", orig: (api, d) => api.ensurePedPostForTask(byId(d.tasks, "t-plain")), port: (d) => ensurePedPostForTask(d, byId(d.tasks, "t-plain")) });
op({ name: "ensurePedPostForTask/sync-existing", orig: (api, d) => api.ensurePedPostForTask(byId(d.tasks, "t-pub-linked"), { syncFromTask: true }), port: (d) => ensurePedPostForTask(d, byId(d.tasks, "t-pub-linked"), { syncFromTask: true }) });
op({ name: "ensurePedPostForTask/existing-untouched", orig: (api, d) => api.ensurePedPostForTask(byId(d.tasks, "t-pub-linked")), port: (d) => ensurePedPostForTask(d, byId(d.tasks, "t-pub-linked")) });
op({ name: "syncAutomaticPedPostsForTasks/all", orig: (api) => api.syncAutomaticPedPostsForTasks(), port: (d) => syncAutomaticPedPostsForTasks(d) });
op({ name: "syncAutomaticPedPostsForTasks/second-run-is-stable", orig: (api) => { api.syncAutomaticPedPostsForTasks(); return api.syncAutomaticPedPostsForTasks(); }, port: (d) => { syncAutomaticPedPostsForTasks(d); return syncAutomaticPedPostsForTasks(d); } });
op({
  name: "syncInfluencerContactTask/update-existing",
  prepare: (d) => { Object.assign(byId(d.influencers, "i1"), { contactDate: "2026-06-16", contactMember: "Member B" }); },
  orig: (api, d) => api.syncInfluencerContactTask(byId(d.influencers, "i1")),
  port: (d) => syncInfluencerContactTask(d, byId(d.influencers, "i1"))
});
op({
  name: "syncInfluencerContactTask/disable-removes-task",
  prepare: (d) => { byId(d.influencers, "i1").contactTaskEnabled = false; },
  orig: (api, d) => api.syncInfluencerContactTask(byId(d.influencers, "i1")),
  port: (d) => syncInfluencerContactTask(d, byId(d.influencers, "i1"))
});
op({
  name: "syncInfluencerContactTask/enable-new",
  prepare: (d) => { Object.assign(byId(d.influencers, "i3"), { contactTaskEnabled: true, contactDate: "2026-06-17", contactMember: "Member A", contactProjectId: "p1", ttLink: "https://tt.example/three" }); },
  orig: (api, d) => api.syncInfluencerContactTask(byId(d.influencers, "i3")),
  port: (d) => syncInfluencerContactTask(d, byId(d.influencers, "i3"))
});
op({
  name: "syncInfluencerContactTask/incomplete-does-nothing",
  prepare: (d) => { Object.assign(byId(d.influencers, "i3"), { contactTaskEnabled: true, contactDate: "2026-06-17" }); },
  orig: (api, d) => api.syncInfluencerContactTask(byId(d.influencers, "i3")),
  port: (d) => syncInfluencerContactTask(d, byId(d.influencers, "i3"))
});
op({ name: "syncInfluencerProgressTasks/default", orig: (api) => api.syncInfluencerProgressTasks(), port: (d) => syncInfluencerProgressTasks(d) });
op({
  name: "syncInfluencerProgressTasks/hide-type-removes-task",
  prepare: (d) => { d.influencerPreviewVisibility.ugc = false; },
  orig: (api) => api.syncInfluencerProgressTasks(),
  port: (d) => syncInfluencerProgressTasks(d)
});
op({
  name: "syncInfluencerProgressTasks/deadline-in-the-past",
  prepare: (d) => { d.influencerOptions.type[0].deadline = "2026-06-01"; },
  orig: (api) => api.syncInfluencerProgressTasks(),
  port: (d) => syncInfluencerProgressTasks(d)
});
op({ name: "syncInfluencerProgressTasks/second-run-is-stable", orig: (api) => { api.syncInfluencerProgressTasks(); return api.syncInfluencerProgressTasks(); }, port: (d) => { syncInfluencerProgressTasks(d); return syncInfluencerProgressTasks(d); } });
op({ name: "addInfluencerToGantt/contact", orig: (api) => api.addInfluencerToGantt("i1", "p1", "Member A", "2026-06-16"), port: (d) => { addInfluencerToGantt(d, "i1", "p1", "Member A", "2026-06-16", { legacyLabels: true }); } });
op({ name: "addInfluencerToGantt/video-store-confirmed", orig: (api) => api.addInfluencerToGantt("i2", "p1", "Member B", "2026-06-18", { action: "video-store", creatorStatus: "Confirmed", creatorStore: "Store One", creatorTime: "16:00" }), port: (d) => { addInfluencerToGantt(d, "i2", "p1", "Member B", "2026-06-18", { action: "video-store", creatorStatus: "Confirmed", creatorStore: "Store One", creatorTime: "16:00", legacyLabels: true }); } });
op({ name: "addInfluencerToGantt/video-store-defaults", orig: (api) => api.addInfluencerToGantt("i2", "p1", "Member B", "2026-06-18", { action: "video-store" }), port: (d) => { addInfluencerToGantt(d, "i2", "p1", "Member B", "2026-06-18", { action: "video-store", legacyLabels: true }); } });
op({ name: "addInfluencerToGantt/missing-member", orig: (api) => api.addInfluencerToGantt("i1", "p1", "", "2026-06-16"), port: (d) => { addInfluencerToGantt(d, "i1", "p1", "", "2026-06-16", { legacyLabels: true }); } });
op({ name: "addPedItemToPed/gantt-task", orig: (api) => api.addPedItemToPed("t-plain", "", "2026-06-16", "13:00"), port: (d) => addPedItemToPed(d, "t-plain", "", "2026-06-16", "13:00") });
op({ name: "addPedItemToPed/gantt-task-default-time", orig: (api) => api.addPedItemToPed("t-pub-linked", "", "2026-06-16", ""), port: (d) => addPedItemToPed(d, "t-pub-linked", "", "2026-06-16", "") });
op({ name: "addPedItemToPed/copy-manual-post", orig: (api) => api.addPedItemToPed("", "ped-manual", "2026-06-17", "15:00"), port: (d) => addPedItemToPed(d, "", "ped-manual", "2026-06-17", "15:00") });
op({ name: "addPedItemToPed/invalid-date", orig: (api) => api.addPedItemToPed("t-plain", "", "16/06/2026", "13:00"), port: (d) => addPedItemToPed(d, "t-plain", "", "16/06/2026", "13:00") });
op({ name: "addPedItemToPed/missing-source", orig: (api) => api.addPedItemToPed("", "nope", "2026-06-17", "15:00"), port: (d) => addPedItemToPed(d, "", "nope", "2026-06-17", "15:00") });
op({ name: "duplicatePedItem/linked-task", orig: (api) => api.duplicatePedItem("t-pub-linked", ""), port: (d) => duplicatePedItem(d, "t-pub-linked", "") });
op({ name: "duplicatePedItem/virtual-from-task", orig: (api) => api.duplicatePedItem("t-plain", ""), port: (d) => duplicatePedItem(d, "t-plain", "") });
op({ name: "duplicatePedItem/manual-post", orig: (api) => api.duplicatePedItem("", "ped-manual"), port: (d) => duplicatePedItem(d, "", "ped-manual") });
op({ name: "duplicatePedItem/missing", orig: (api) => api.duplicatePedItem("", "nope"), port: (d) => duplicatePedItem(d, "", "nope") });
op({ name: "addPedItemToGantt/move-task", orig: (api) => api.addPedItemToGantt("t-plain", "", "2026-06-19"), port: (d) => { addPedItemToGantt(d, "t-plain", "", "2026-06-19"); } });
op({ name: "addPedItemToGantt/post-becomes-task", orig: (api) => api.addPedItemToGantt("", "ped-manual", "2026-06-19"), port: (d) => { addPedItemToGantt(d, "", "ped-manual", "2026-06-19"); } });
op({ name: "addPedItemToGantt/invalid", orig: (api) => api.addPedItemToGantt("", "ped-manual", "nope"), port: (d) => { addPedItemToGantt(d, "", "ped-manual", "nope"); } });
op({ name: "deleteTaskById/with-ped-mirror", orig: (api) => api.deleteTaskById("t-pub-linked"), port: (d) => deleteTaskById(d, "t-pub-linked") });
op({ name: "deletePedPostById/mirror-dismisses-task", orig: (api) => api.deletePedPostById("ped-linked"), port: (d) => deletePedPostById(d, "ped-linked") });
op({ name: "deletePedPostById/manual", orig: (api) => api.deletePedPostById("ped-manual"), port: (d) => deletePedPostById(d, "ped-manual") });
op({ name: "deleteInfluencerById/with-contact-task", orig: (api) => api.deleteInfluencerById("i1"), port: (d) => deleteInfluencerById(d, "i1") });
op({ name: "removeLinkedPedPostForTask", orig: (api) => api.removeLinkedPedPostForTask("t-pub-linked"), port: (d) => removeLinkedPedPostForTask(d, "t-pub-linked") });
op({ name: "syncCreatorStatusToGantt/confirmed", orig: (api, d) => api.syncCreatorStatusToGantt(byId(d.tasks, "t-vid")), port: (d) => syncCreatorStatusToGantt(d, byId(d.tasks, "t-vid")) });
op({
  name: "syncCreatorStatusToGantt/video-shot-adds-status",
  prepare: (d) => { byId(d.tasks, "t-vid").creatorStatus = "Video shot"; d.statuses = d.statuses.filter((s: Loose) => s.name !== "DONE"); },
  orig: (api, d) => api.syncCreatorStatusToGantt(byId(d.tasks, "t-vid")),
  port: (d) => syncCreatorStatusToGantt(d, byId(d.tasks, "t-vid"))
});
op({
  name: "syncCreatorStatusToGantt/other-leaves-status",
  prepare: (d) => { byId(d.tasks, "t-vid").creatorStatus = "Scheduled"; },
  orig: (api, d) => api.syncCreatorStatusToGantt(byId(d.tasks, "t-vid")),
  port: (d) => syncCreatorStatusToGantt(d, byId(d.tasks, "t-vid"))
});
op({ name: "setInfluencerField/status-contacted", orig: (api) => api.updateInfluencerInlineValue("i1", "status", "CONTACTED"), port: (d) => setInfluencerField(d, "i1", "status", "CONTACTED") });
op({ name: "setInfluencerField/status-leaves-to-contact", orig: (api) => api.updateInfluencerInlineValue("i1", "status", "Booked"), port: (d) => setInfluencerField(d, "i1", "status", "Booked") });
op({ name: "setInfluencerField/city", orig: (api) => api.updateInfluencerInlineValue("i2", "city", "Milan"), port: (d) => setInfluencerField(d, "i2", "city", "Milan") });
op({ name: "setInfluencerField/same-value-keeps-order", orig: (api) => api.updateInfluencerInlineValue("i2", "type", "Creator"), port: (d) => setInfluencerField(d, "i2", "type", "Creator") });
op({ name: "setInfluencerField/missing-row", orig: (api) => api.updateInfluencerInlineValue("nope", "status", "x"), port: (d) => setInfluencerField(d, "nope", "status", "x") });
op({ name: "touchItem/stamps-now", orig: (api, d) => api.touchItem(byId(d.tasks, "t-plain")), port: (d) => touchItem(byId(d.tasks, "t-plain")) });

ops.forEach((c) => {
  add({
    name: `ops/${c.name}`,
    now: c.now,
    orig: async (h) => {
      const data = h.api.normalizeData(clone(opsBoard));
      c.prepare?.(data);
      h.api.setData(data);
      const result = await c.orig(h.api, data);
      return { board: h.api.normalizeData(h.api.getData()), result: summarizeResult(result) };
    },
    port: () => {
      const data = normalizeData(clone(opsBoard)) as Loose;
      c.prepare?.(data);
      const result = c.port(data);
      return { board: normalizeData(data), result: summarizeResult(result) };
    }
  });
});

/** Return values: compare booleans/ids only (the old functions return raw objects, the port complete ones). */
function summarizeResult(result: unknown): unknown {
  if (result === undefined || result === null || typeof result === "boolean") return result ?? null;
  if (typeof result === "object" && "id" in (result as object)) return { id: (result as Loose).id };
  return json(result);
}

/* ------------------------------------------------------------------------ history / safety */
const historyAfter = (): Loose => {
  const after = clone(opsBoard) as Loose;
  after.tasks[0].name = "Renamed publication";
  after.tasks[0].status = "DONE";
  after.tasks[0].members = ["Member A", "Member B"];
  after.tasks.pop();
  after.pedPosts = after.pedPosts.slice(1);
  after.pedPosts.push({ id: "ped-new", title: "Brand new" });
  after.influencers.push({ id: "i-new", name: "Newcomer", city: "Rome" });
  after.influencers[0].status = "CONTACTED";
  after.projects[1].color = "#000000";
  after.projects.push({ id: "p-new", name: "New project", color: "#ffffff" });
  after.tasks[1].nameEn = "";
  after.tasks[1].pedEnabled = true;
  return after;
};
add({ name: "history/changeLines", orig: (h) => h.api.historyChangeLines(clone(opsBoard), historyAfter()), port: () => historyChangeLines(clone(opsBoard) as Loose, historyAfter()) });
add({ name: "history/changeLines-empty", orig: (h) => h.api.historyChangeLines(null, undefined), port: () => historyChangeLines(null, undefined) });
add({ name: "history/changeLines-from-empty", orig: (h) => h.api.historyChangeLines({}, historyAfter()), port: () => historyChangeLines({}, historyAfter()) });
add({ name: "history/structured-diff-flattens-to-lines", orig: (h) => h.api.historyChangeLines(clone(opsBoard), historyAfter()), port: () => historyChanges(clone(opsBoard) as Loose, historyAfter()).map(formatDiffEntry) });
add({ name: "history/summary", orig: (h) => h.api.historySummary(h.api.normalizeData(clone(opsBoard))), port: () => historySummary(normalizeData(clone(opsBoard))) });
add({ name: "history/summary-null", orig: (h) => h.api.historySummary(null), port: () => historySummary(null) });
const historyList = (): Loose[] => {
  const base = normalizeData(clone(opsBoard));
  const list: Loose[] = Array.from({ length: 12 }, (_, index) => ({ id: `h${index}`, savedAt: new Date(2026, 5, 1 + index).toISOString(), label: `entry ${index}`, summary: "s", data: base }));
  list.push({ id: "", savedAt: "2026-06-30T00:00:00.000Z", data: base }, { id: "nodata", savedAt: "2026-06-30T00:00:00.000Z" }, null);
  return list;
};
add({ name: "history/normalizeHistory", orig: (h) => h.api.normalizeHistory(historyList()).map((e: Loose) => e.id), port: () => normalizeHistory(historyList()).map((e) => e.id) });
add({ name: "history/normalizeHistory-not-array", orig: (h) => h.api.normalizeHistory("x"), port: () => normalizeHistory("x") });
add({
  name: "history/withHistoryEntry",
  orig: (h) => h.api.withHistoryEntry(historyList(), h.api.normalizeData(clone(opsBoard)), "Before restore").map((e: Loose) => [e.id, e.label, e.summary, e.savedAt]),
  port: () => withHistoryEntry(historyList(), normalizeData(clone(opsBoard)), "Before restore").map((e) => [e.id, e.label, e.summary, e.savedAt])
});
add({ name: "history/withHistoryEntry-no-snapshot", orig: (h) => h.api.withHistoryEntry(historyList(), null).length, port: () => withHistoryEntry(historyList(), null).length });
add({ name: "safety/score-rich", orig: (h) => h.api.snapshotSafetyScore(h.api.normalizeData(clone(legacyBoard))), port: () => snapshotSafetyScore(normalizeData(clone(legacyBoard))) });
add({ name: "safety/score-empty", orig: (h) => [h.api.snapshotSafetyScore(), h.api.snapshotSafetyScore({}), h.api.snapshotSafetyScore({ tasks: "no" })], port: () => [snapshotSafetyScore(), snapshotSafetyScore({}), snapshotSafetyScore({ tasks: "no" } as unknown as Partial<BoardData>)] });

/* -------------------------------------------------------------------------------- runner */
interface GoldenFile { generatedAt: string; results: Record<string, unknown> }

async function loadHarness(): Promise<Harness> {
  const mod = (await import(pathToFileURL(harnessPath).href)) as { loadOriginalData(): Harness };
  return mod.loadOriginalData();
}

let golden: GoldenFile = { generatedAt: "", results: {} };

function pinPort(now: number): void {
  let counter = 0;
  setClock(() => now);
  setRandom(() => {
    counter += 1;
    return counter / 1000;
  });
}

const canon = (value: unknown): unknown => {
  const copy = json(value) as Loose;
  if (copy && typeof copy === "object") {
    const strip = (board: Loose): void => {
      if (!board || typeof board !== "object") return;
      if (Array.isArray(board.pedPosts)) board.pedPosts.forEach((post: Loose) => { delete post.createdAt; });
      if (Array.isArray(board.influencers)) board.influencers.forEach((row: Loose) => { delete row.createdAt; });
    };
    strip(copy);
    strip(copy.board);
    strip(copy.once);
    strip(copy.again);
  }
  return copy;
};

describe("differential: port vs the original functions", () => {
  beforeAll(async () => {
    if (update) {
      const h = await loadHarness();
      const results: Record<string, unknown> = {};
      for (const c of cases) {
        const now = c.now ?? FIXED_NOW;
        h.setNow(now);
        h.reseed();
        results[c.name] = canon(await c.orig(h));
      }
      golden = { generatedAt: "regenerated by UPDATE_GOLDEN=1", results };
      mkdirSync(dirname(goldenPath), { recursive: true });
      writeFileSync(goldenPath, JSON.stringify(golden, null, 1));
    } else {
      if (!existsSync(goldenPath)) throw new Error("golden/golden.json is missing: run with UPDATE_GOLDEN=1 once.");
      golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFile;
    }
  }, 60000);

  afterAll(() => {
    setClock();
    setRandom();
  });

  it("has a golden value for every case", () => {
    const missing = cases.filter((c) => !(c.name in golden.results)).map((c) => c.name);
    expect(missing).toEqual([]);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  cases.forEach((c) => {
    it(c.name, async () => {
      pinPort(c.now ?? FIXED_NOW);
      const actual = canon(await c.port());
      expect(actual).toEqual(golden.results[c.name]);
    });
  });
});

describe("differential: sanity of the fixtures themselves", () => {
  it("fixtures exercise tombstones in both stored forms, extras and legacy labels", () => {
    expect(JSON.stringify(legacyBoard)).toContain("Pubblicazione");
    expect(JSON.stringify(legacyBoard)).toContain("futureField");
    const normalized = normalizeData(clone(legacyBoard));
    expect(normalized.tasks.find((t) => t.id === "tdeleted")).toBeUndefined();
    expect(normalized.pedPosts.find((p) => p.id === "pdeleted")).toBeUndefined();
    expect(normalized.influencers.find((i) => i.id === "i5")).toBeUndefined();
    expect(Object.keys(normalized.deletedIds.tasks)).toContain("tdeleted");
  });
  it("uses T() and controls() consistently", () => {
    expect(T(0)).toBe(FIXED_NOW);
    expect(controls({ contact: true }).contact).toEqual({ checked: true });
    expect(creatorBase.label).toBe("creator");
    expect(mergeLocal).not.toBe(mergeRemote);
    expect(rolloverBoard).toBeTruthy();
  });
});
