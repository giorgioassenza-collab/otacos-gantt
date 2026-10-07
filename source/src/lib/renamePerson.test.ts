import { describe, expect, it } from "vitest";
import { renamePerson } from "./actions";
import { createEnglishStarterData } from "../data/starter";
import type { BoardData } from "../data/types";

function board(): BoardData {
  const data = createEnglishStarterData();
  data.members = ["Giorgio", "Vale M.", "Vale V"];
  data.tasks = [{
    id: "t1", projectId: "p", name: "t", nameEn: "t", members: ["Vale M.", "Giorgio"], status: "TO DO", start: "2026-10-08", end: "2026-10-08", info: "", label: "",
    subtasks: [{ id: "s", title: "s", members: ["Vale M."], done: false }], updatedAt: 1, pedEnabled: false, pedAutoDismissed: false, pedDate: "", pedTime: "11:00",
    pedTitle: "", pedSocial: [], pedAsset: "", pedAssetItems: [], pedCopy: "", creatorStatus: "", creatorStore: "", creatorTime: "10:00"
  }];
  data.pedPosts = [{
    id: "p1", sourceTaskId: "", title: "p", projectId: "p", date: "2026-10-09", time: "12:00", status: "Draft", members: ["Vale M."], format: "Video", social: [], asset: "", assetItems: [],
    copy: "", comments: [{ id: "c", text: "ping @Vale M. and @Vale V", mentions: ["Vale M.", "Vale V"], createdAt: 1 }], subtasks: [], updatedAt: 1
  }];
  return data;
}

describe("renamePerson", () => {
  it("renames the person in the list, tasks, subtasks, posts and mentions, and stamps what it touched", () => {
    const data = board();
    const changed = renamePerson(data, "Vale M.", "Vale M");
    expect(changed).toBe(2);
    expect(data.members).toEqual(["Giorgio", "Vale M", "Vale V"]);
    expect(data.tasks[0].members).toEqual(["Vale M", "Giorgio"]);
    expect(data.tasks[0].subtasks[0].members).toEqual(["Vale M"]);
    expect(data.tasks[0].updatedAt).toBeGreaterThan(1);
    expect(data.pedPosts[0].members).toEqual(["Vale M"]);
    expect(data.pedPosts[0].comments[0].mentions).toEqual(["Vale M", "Vale V"]);
    expect(data.pedPosts[0].comments[0].text).toBe("ping @Vale M and @Vale V");
  });

  it("merges into an existing person without duplicating", () => {
    const data = board();
    data.tasks[0].members = ["Vale M.", "Vale V"];
    renamePerson(data, "Vale M.", "Vale V");
    expect(data.members).toEqual(["Giorgio", "Vale V"]);
    expect(data.tasks[0].members).toEqual(["Vale V"]);
  });

  it("does nothing for an empty or identical name", () => {
    const data = board();
    expect(renamePerson(data, "Vale V", "Vale V")).toBe(0);
    expect(renamePerson(data, "Vale V", "  ")).toBe(0);
  });
});
