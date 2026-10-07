import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClock, setRandom } from "../clock";
import {
  canonicalLabel, displayLabel, displayLabelList, englishLabel, labelsMatch, legacyLabel, workflowLabelKey, workflowLabels
} from "../labelAliases";
import {
  addPedItemToPed, creatorDuplicateTasksFromControls, duplicatePedItem, ensurePedPostForTask, isCreatorLabel,
  isPublicationLabel, isVideoInStoreLabel, shouldAutoCreatePedPost, syncAutomaticPedPostsForTasks
} from "../labels";
import { mergeBoardData } from "../merge";
import { normalizeData } from "../normalize";
import { nextWorkingDayKey, rollOverTasks } from "../rollover";
import type { BoardData, CreatorControls } from "../types";
import { FIXED_NOW, controls, creatorBase, legacyBoard } from "./fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

beforeEach(() => {
  setClock(() => FIXED_NOW);
  let counter = 0;
  setRandom(() => {
    counter += 1;
    return counter / 1000;
  });
});
afterEach(() => {
  setClock();
  setRandom();
});

describe("label aliases (legacy Italian <-> English)", () => {
  it("matches both spellings, ignoring case and spaces", () => {
    ["Pubblicazione", "pubblicazione ", "Publication", " PUBLICATION "].forEach((label) => {
      expect(isPublicationLabel(label)).toBe(true);
      expect(shouldAutoCreatePedPost({ label })).toBe(true);
      expect(canonicalLabel(label)).toBe("publication");
      expect(displayLabel(label)).toBe("Publication");
    });
    expect(isPublicationLabel("Contattare")).toBe(false);
    expect(shouldAutoCreatePedPost({ label: "Publication", pedAutoDismissed: true })).toBe(false);
    expect(isVideoInStoreLabel("video in store")).toBe(true);
    expect(isCreatorLabel(" Creator ")).toBe(true);
  });

  it("maps every legacy workflow label to the agreed English name", () => {
    const expected: Record<string, string> = {
      Contattare: "Contact",
      "Ask Ok Alice": "Ask OK Alice",
      "Ask Ok": "Ask OK Alice",
      "Mandare contratto": "Send contract",
      Brief: "Brief",
      "Avvisare Giorgia": "Notify Giorgia",
      "Mandare video ad Alice": "Send video to Alice",
      Pubblicazione: "Publication",
      "Video in store": "Video in store"
    };
    Object.entries(expected).forEach(([legacy, english]) => {
      expect(displayLabel(legacy)).toBe(english);
      expect(displayLabel(english)).toBe(english);
      expect(labelsMatch(legacy, english)).toBe(true);
    });
  });

  it("leaves free labels alone and exposes both spellings per key", () => {
    expect(displayLabel("  My own label ")).toBe("My own label");
    expect(canonicalLabel("My Own Label")).toBe("my own label");
    expect(workflowLabelKey("nothing")).toBeNull();
    expect(displayLabel(undefined)).toBe("");
    workflowLabels.forEach((definition) => {
      expect(englishLabel(definition.key)).toBe(definition.english);
      expect(legacyLabel(definition.key)).toBe(definition.legacy);
    });
  });

  it("collapses legacy/English duplicates in a settings label list", () => {
    expect(displayLabelList(["creator", "Contattare", "Contact", "Pubblicazione", "Free", "Free"])).toEqual(["creator", "Contact", "Publication", "Free"]);
  });

  it("normalizeData treats an English Publication task like the legacy one (auto PED)", () => {
    const data = normalizeData({ tasks: [{ id: "x", name: "N", start: "2026-06-10", label: "Publication" }] });
    expect(data.tasks[0].pedEnabled).toBe(true);
    expect(data.tasks[0].pedDate).toBe("2026-06-10");
    expect(data.tasks[0].pedTime).toBe("12:00");
    // the stored label itself is never rewritten
    expect(data.tasks[0].label).toBe("Publication");
    const legacy = normalizeData({ tasks: [{ id: "y", name: "N", start: "2026-06-10", label: "Pubblicazione" }] });
    expect(legacy.tasks[0].label).toBe("Pubblicazione");
  });
});

describe("creator workflow generates English tasks", () => {
  it("writes the English names and keeps nameEn populated", () => {
    const all = controls({ contact: true, askOk: true, contract: true, brief: true, giorgia: true, video: true, sendVideoAlice: true, publish: true, videoDate: "2026-06-18", publishDate: "2026-06-20" });
    const tasks = creatorDuplicateTasksFromControls(clone(creatorBase), FIXED_NOW, all as unknown as CreatorControls);
    expect(tasks.map((task) => task.label)).toEqual(["Contact", "Ask OK Alice", "Send contract", "Brief", "Notify Giorgia", "Video in store", "Send video to Alice", "Publication"]);
    expect(tasks.map((task) => task.name)).toEqual([
      "Contact Creator Beta", "Ask OK Alice Creator Beta", "Send contract Creator Beta", "Brief Creator Beta", "Notify Giorgia Creator Beta",
      "Creator Beta", "Send video to Alice Creator Beta", "Creator Beta"
    ]);
    tasks.forEach((task) => {
      expect(task.creatorParentId).toBe("t-creator");
      expect(task.id.startsWith("t-creator-creator-")).toBe(true);
      expect(task.nameEn).toBeTruthy();
    });
    expect(tasks[4].status).toBe("Notify Giorgia");
    expect(tasks[7].start).toBe("2026-06-20");
    // an English "Publication" child is a publication task for the PED automation
    expect(shouldAutoCreatePedPost(tasks[7])).toBe(true);
  });

  it("legacyLabels reproduces the Italian output", () => {
    const tasks = creatorDuplicateTasksFromControls(clone(creatorBase), FIXED_NOW, controls({ contact: true, contract: true, publish: true }) as unknown as CreatorControls, { legacyLabels: true });
    expect(tasks.map((task) => task.label)).toEqual(["Contattare", "Mandare contratto", "Pubblicazione"]);
  });

  it("accepts an English or legacy 'creator' base only", () => {
    expect(creatorDuplicateTasksFromControls({ ...clone(creatorBase), label: "Publication" }, FIXED_NOW, controls({ contact: true }) as unknown as CreatorControls)).toEqual([]);
  });
});

describe("rollover", () => {
  it("moves unfinished tasks to the next working day and keeps PED mirrors in step", () => {
    const data = normalizeData({
      statuses: ["TO DO", "DONE"],
      tasks: [
        { id: "a", name: "A", start: "2026-06-08", end: "2026-06-08", status: "TO DO" },
        { id: "b", name: "B", start: "2026-06-04", end: "2026-06-09", status: "TO DO" },
        { id: "c", name: "C", start: "2026-06-04", end: "2026-06-04", status: "DONE" },
        { id: "p", name: "Pub", start: "2026-06-04", end: "2026-06-04", status: "TO DO", label: "Publication" }
      ]
    });
    const { changed, target } = rollOverTasks(data, new Date(2026, 5, 10, 20, 5));
    expect(target).toBe("2026-06-11");
    expect(changed.map((task) => task.id)).toEqual(["a", "b", "p"]);
    expect(data.tasks.find((task) => task.id === "a")).toMatchObject({ start: "2026-06-11", end: "2026-06-11" });
    // multi-day task only extends its end
    expect(data.tasks.find((task) => task.id === "b")).toMatchObject({ start: "2026-06-04", end: "2026-06-11" });
    expect(data.tasks.find((task) => task.id === "c")).toMatchObject({ start: "2026-06-04", end: "2026-06-04" });
    const publication = data.tasks.find((task) => task.id === "p") as Loose;
    expect(publication.pedDate).toBe("2026-06-11");
    expect(data.pedPosts.find((post) => post.sourceTaskId === "p")?.date).toBe("2026-06-11");
    // nothing left to move on the second run
    expect(rollOverTasks(data, new Date(2026, 5, 10, 20, 5)).changed).toEqual([]);
  });

  it("skips weekends and the evening cut-off", () => {
    expect(nextWorkingDayKey(new Date(2026, 5, 12, 19, 59))).toBe("2026-06-12");
    expect(nextWorkingDayKey(new Date(2026, 5, 12, 20, 0))).toBe("2026-06-15");
    expect(nextWorkingDayKey(new Date(2026, 5, 13, 8, 0))).toBe("2026-06-15");
    expect(nextWorkingDayKey(new Date(2026, 5, 14, 23, 0))).toBe("2026-06-15");
  });
});

describe("ids created in the same millisecond", () => {
  it("never collide (the old app overwrote one item with the other)", () => {
    const data = normalizeData({
      tasks: [
        { id: "t1", name: "One", start: "2026-06-10", label: "Pubblicazione" },
        { id: "t2", name: "Two", start: "2026-06-11", label: "Pubblicazione" }
      ]
    });
    expect(syncAutomaticPedPostsForTasks(data)).toBe(true);
    const ids = data.pedPosts.map((post) => post.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(`ped${FIXED_NOW}`);
    // and a duplicate of a PED item in the same millisecond gets its own id too
    expect(duplicatePedItem(data, "", data.pedPosts[0].id)).toBe(true);
    expect(duplicatePedItem(data, "", data.pedPosts[0].id)).toBe(true);
    const all = data.pedPosts.map((post) => post.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("ensurePedPostForTask is idempotent per task", () => {
    const data = normalizeData({ tasks: [{ id: "t1", name: "One", start: "2026-06-10" }] });
    const first = ensurePedPostForTask(data, data.tasks[0]);
    const second = ensurePedPostForTask(data, data.tasks[0]);
    expect(second?.id).toBe(first?.id);
    expect(data.pedPosts).toHaveLength(1);
    expect(addPedItemToPed(data, "t1", "", "2026-06-11", "14:00")).toBe(true);
    expect(data.pedPosts).toHaveLength(1);
    expect(data.pedPosts[0]).toMatchObject({ date: "2026-06-11", time: "14:00" });
  });
});

describe("unknown fields round-trip", () => {
  const raw = {
    tasks: [{ id: "t1", name: "T", start: "2026-06-10", futureTaskField: { a: 1 }, subtasks: [{ id: "s1", title: "S", futureSubtaskField: "x" }] }],
    pedPosts: [{
      id: "p1", title: "P", date: "2026-06-10", createdAt: 1700000000000, futurePedField: [1, 2, 3],
      comments: [{ id: "c1", text: "hello", futureCommentField: true, createdAt: 5 }], subtasks: [{ id: "s", title: "x", futureSubtaskField: 1 }]
    }],
    influencers: [{ id: "i1", name: "Creator", NAME: "Legacy upper-case key", createdAt: 1700000000000, futureInfluencerField: "kept" }],
    projects: [{ id: "pr", name: "Project", color: "#111111", futureProjectField: 1 }],
    futureTopLevelField: { nested: true }
  };

  it("keeps fields the code does not know about, in every stored item type", () => {
    const data = normalizeData(clone(raw)) as Loose;
    expect(data.tasks[0].futureTaskField).toEqual({ a: 1 });
    expect(data.tasks[0].subtasks[0].futureSubtaskField).toBe("x");
    expect(data.pedPosts[0].futurePedField).toEqual([1, 2, 3]);
    expect(data.pedPosts[0].createdAt).toBe(1700000000000);
    expect(data.pedPosts[0].comments[0].futureCommentField).toBe(true);
    expect(data.pedPosts[0].subtasks[0].futureSubtaskField).toBe(1);
    expect(data.influencers[0].futureInfluencerField).toBe("kept");
    expect(data.influencers[0].createdAt).toBe(1700000000000);
    expect(data.projects.find((project: Loose) => project.id === "pr").futureProjectField).toBe(1);
    expect(data.futureTopLevelField).toEqual({ nested: true });
  });

  it("drops only the legacy alias keys the old app consumed", () => {
    const data = normalizeData(clone(raw)) as Loose;
    expect(data.influencers[0]).not.toHaveProperty("NAME");
    expect(data.influencers[0].name).toBe("Creator");
  });

  it("survives normalize(normalize(x)) and a merge with itself", () => {
    const once = normalizeData(clone(raw));
    expect(normalizeData(clone(once))).toEqual(once);
    const merged = mergeBoardData(clone(once), clone(once)) as Loose;
    expect(merged.tasks[0].futureTaskField).toEqual({ a: 1 });
    expect(merged.pedPosts[0].futurePedField).toEqual([1, 2, 3]);
    expect(merged.influencers[0].futureInfluencerField).toBe("kept");
    expect(merged.futureTopLevelField).toEqual({ nested: true });
  });

  it("legacy board stays valid typed data", () => {
    const data: BoardData = normalizeData(clone(legacyBoard));
    expect(data.tasks.every((task) => typeof task.id === "string" && Array.isArray(task.subtasks))).toBe(true);
    expect(data.formats).toEqual(["Video", "Static", "Carousel"]);
    expect(data.members).not.toContain("Giorgia");
    expect(data.labels).not.toContain("Brief");
  });
});
