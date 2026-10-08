import { describe, expect, it } from "vitest";
import { computeNotifications, taskIsFor } from "./notifications";
import { personKey, samePerson } from "./team";
import { createEnglishStarterData } from "../data/starter";
import type { BoardData, PedPost, Task } from "../data/types";

const NOW = Date.UTC(2026, 9, 7, 10, 0, 0);
const TODAY = "2026-10-09";

function board(): BoardData {
  const data = createEnglishStarterData();
  data.statuses = [{ name: "TO DO", color: "#000" }, { name: "DONE", color: "#0f0" }, { name: "BLOCKED", color: "#f00" }, { name: "Notify Giorgia", color: "#f90" }];
  data.pedStatuses = [{ name: "Draft", color: "#000" }, { name: "Ready", color: "#000" }, { name: "Published", color: "#000" }];
  data.projects = [{ id: "p1", name: "Social", color: "#147bd1" }];
  data.members = ["Giorgio", "Matteo", "Vale M", "Vale V", "Jessica"];
  return data;
}

const task = (id: string, extra: Partial<Task>): Task => ({
  id, projectId: "p1", name: id, nameEn: id, members: [], status: "TO DO", start: "2026-10-08", end: "2026-10-08", info: "", label: "", subtasks: [],
  updatedAt: 1, pedEnabled: false, pedAutoDismissed: false, pedDate: "", pedTime: "11:00", pedTitle: "", pedSocial: [], pedAsset: "", pedAssetItems: [],
  pedCopy: "", creatorStatus: "", creatorStore: "", creatorTime: "10:00", ...extra
});
const post = (id: string, extra: Partial<PedPost>): PedPost => ({
  id, sourceTaskId: "", title: id, projectId: "p1", date: "2026-10-09", time: "12:00", status: "Draft", members: [], format: "Video", social: [], asset: "",
  assetItems: [], copy: "", comments: [], subtasks: [], updatedAt: 1, ...extra
});

describe("person matching", () => {
  it("ignores case, spaces and dots", () => {
    expect(personKey("Vale M.")).toBe(personKey("vale m"));
    expect(samePerson("Vale M", "Vale V")).toBe(false);
    expect(samePerson("", "")).toBe(false);
  });
});

describe("computeNotifications", () => {
  it("counts unfinished tasks assigned to the person, earliest first, and ignores done ones and other people's", () => {
    const data = board();
    data.tasks = [
      task("late", { members: ["Giorgio"], start: "2026-10-12", end: "2026-10-12" }),
      task("soon", { members: ["Giorgio", "Matteo"], start: "2026-10-08", end: "2026-10-08" }),
      task("finished", { members: ["Giorgio"], status: "DONE" }),
      task("others", { members: ["Matteo"] })
    ];
    const n = computeNotifications(data, "Giorgio", 0, NOW);
    expect(n.tasks.map((t) => t.task.id)).toEqual(["soon", "late"]);
    expect(n.count).toBe(2);
  });

  it("leaves out everything blocked: tasks, subtasks inside blocked tasks and blocked posts", () => {
    const data = board();
    data.pedStatuses = [...data.pedStatuses, { name: "BLOCKED", color: "#f00" }];
    data.tasks = [
      task("stuck", { members: ["Jessica"], status: "BLOCKED" }),
      task("hold", { members: ["Matteo"], status: "BLOCKED", subtasks: [{ id: "s1", title: "Waiting", done: false, members: ["Jessica"] }] as never }),
      task("open", { members: ["Jessica"] })
    ];
    data.pedPosts = [post("stuckpost", { members: ["Jessica"], status: "BLOCKED", date: "2026-10-08" })];
    const n = computeNotifications(data, "Jessica", 0, NOW, TODAY);
    expect(n.tasks.map((t) => t.task.id)).toEqual(["open"]);
    expect(n.subtasks).toHaveLength(0);
    expect(n.posts).toHaveLength(0);
    expect(n.count).toBe(1);
  });

  it("shows posts dated today or earlier and none from the future", () => {
    const data = board();
    data.pedPosts = [
      post("past", { members: ["Jessica"], date: "2026-10-01" }),
      post("today", { members: ["Jessica"], date: "2026-10-09" }),
      post("tomorrow", { members: ["Jessica"], date: "2026-10-10" })
    ];
    const n = computeNotifications(data, "Jessica", 0, NOW, TODAY);
    expect(n.posts.map((p) => p.title)).toEqual(["past", "today"]);
    expect(n.count).toBe(2);
  });

  it("finds Giorgia's and Alice's work through the status or label, like the old Who filter", () => {
    const data = board();
    data.tasks = [
      task("g", { status: "Notify Giorgia" }),
      task("a", { label: "Ask OK Alice" }),
      task("x", { members: ["Giorgio"] })
    ];
    expect(computeNotifications(data, "Giorgia", 0, NOW).tasks.map((t) => t.task.id)).toEqual(["g"]);
    expect(computeNotifications(data, "Alice", 0, NOW).tasks.map((t) => t.task.id)).toEqual(["a"]);
    expect(taskIsFor(task("t", { status: "Notify Giorgia" }), "Giorgio")).toBe(false);
  });

  it("counts a subtask only when its task is not already yours", () => {
    const data = board();
    data.tasks = [
      task("mine", { members: ["Matteo"], subtasks: [{ id: "s1", title: "a", members: ["Matteo"], done: false }] }),
      task("theirs", { members: ["Giorgio"], subtasks: [{ id: "s2", title: "b", members: ["Matteo"], done: false }, { id: "s3", title: "c", members: ["Matteo"], done: true }] })
    ];
    const n = computeNotifications(data, "Matteo", 0, NOW);
    expect(n.tasks).toHaveLength(1);
    expect(n.tasks[0].subtasks).toHaveLength(1);
    expect(n.subtasks.map((s) => s.subtask.id)).toEqual(["s2"]);
    expect(n.count).toBe(2);
  });

  it("counts posts that are not Published, and not twice when they mirror one of your tasks", () => {
    const data = board();
    data.tasks = [task("t", { members: ["Vale V"], pedEnabled: true, pedDate: "2026-10-09", pedTime: "12:00" })];
    data.pedPosts = [
      post("mirror", { sourceTaskId: "t", members: ["Vale V"] }),
      post("manual", { members: ["Vale V"] }),
      post("done", { members: ["Vale V"], status: "Published" }),
      post("notmine", { members: ["Jessica"] })
    ];
    const n = computeNotifications(data, "Vale V", 0, NOW, TODAY);
    expect(n.posts.map((p) => p.title)).toEqual(["manual"]);
    expect(n.count).toBe(2); // the task + the manual post
  });

  it("keeps Vale M and Vale V apart", () => {
    const data = board();
    data.tasks = [task("m", { members: ["Vale M"] }), task("v", { members: ["Vale V"] })];
    expect(computeNotifications(data, "Vale M", 0, NOW).tasks.map((t) => t.task.id)).toEqual(["m"]);
  });

  it("shows only new mentions: after the seen time and inside the seven day window", () => {
    const data = board();
    data.pedPosts = [post("p", { comments: [
      { id: "c1", text: "hey @Alice check", mentions: ["Alice"], createdAt: NOW - 1000 },
      { id: "c2", text: "old @Alice", mentions: ["Alice"], createdAt: NOW - 9 * 86_400_000 },
      { id: "c3", text: "for @Matteo", mentions: ["Matteo"], createdAt: NOW - 500 }
    ] })];
    expect(computeNotifications(data, "Alice", 0, NOW).mentions.map((m) => m.comment.id)).toEqual(["c1"]);
    expect(computeNotifications(data, "Alice", NOW, NOW).mentions).toHaveLength(0);
  });

  it("returns nothing without a person", () => {
    expect(computeNotifications(board(), "", 0, NOW).count).toBe(0);
  });
});
