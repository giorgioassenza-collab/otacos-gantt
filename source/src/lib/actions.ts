import type { BoardData, PedPost, Task } from "../data/types";
import { deleteInfluencerById, deletePedPostById, deleteTaskById, touchItem } from "../data/merge";
import { now } from "../data/clock";
import { shiftDateString } from "../data/dates";
import { ensurePedPostForTask } from "../data/labels";
import { dayIndex, parseDate } from "./gantt";

/** Pure-ish helpers that operate on a draft BoardData inside `mutate`. */

// The data layer owns deletion (tombstones, linked PED posts, dismissed mirrors) so both apps stay consistent.
export const deleteTask = deleteTaskById;
export const deletePedPost = deletePedPostById;
export const deleteInfluencer = deleteInfluencerById;

export function setTaskStatus(draft: BoardData, id: string, status: string): void {
  const task = draft.tasks.find((item) => item.id === id);
  if (!task || task.status === status) return;
  task.status = status;
  touchItem(task);
}

/** Make sure a status name exists in the Gantt status list (the original adds missing ones on the fly). */
export function ensureStatus(draft: BoardData, name: string, color: string): string {
  const existing = draft.statuses.find((status) => status.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.name;
  draft.statuses.push({ name, color });
  return name;
}

/** Move a task so it starts on `start`, keeping its length. PED mirror date follows when the task feeds the PED. */
export function moveTask(draft: BoardData, id: string, start: string, end?: string): void {
  const task = draft.tasks.find((item) => item.id === id);
  if (!task) return;
  const oldEnd = task.end || task.start;
  const length = Math.max(0, dayIndex(parseDate(task.start), oldEnd));
  task.start = start;
  task.end = end ?? shiftDateString(start, length);
  if (task.pedEnabled && task.label && /^(publication|pubblicazione)$/i.test(task.label.trim()) && !task.pedAutoDismissed) {
    task.pedDate = start;
    const post = draft.pedPosts.find((p) => p.sourceTaskId === task.id);
    if (post) { post.date = start; touchItem(post); }
  }
  touchItem(task);
}

export function duplicateTask(draft: BoardData, id: string): Task | null {
  const task = draft.tasks.find((item) => item.id === id);
  if (!task) return null;
  const createdAt = now();
  const copy: Task = {
    ...structuredClone(task),
    id: `t${createdAt}-copy`,
    pedEnabled: false,
    pedAutoDismissed: false,
    pedDate: "",
    pedTime: "12:00",
    createdAt,
    updatedAt: createdAt,
    subtasks: task.subtasks.map((subtask, index) => ({ ...structuredClone(subtask), id: `s${createdAt}-${index}` }))
  };
  draft.tasks.push(copy);
  return copy;
}

export function newTaskId(): string {
  return `t${now()}`;
}

export function newPostId(): string {
  return `ped${now()}`;
}

export function blankTask(draft: BoardData, partial: Partial<Task> = {}): Task {
  const createdAt = now();
  return {
    id: newTaskId(),
    projectId: draft.projects[0]?.id ?? "",
    name: "",
    nameEn: "",
    members: [],
    status: draft.statuses[0]?.name ?? "",
    start: "",
    end: "",
    info: "",
    label: "",
    subtasks: [],
    createdAt,
    updatedAt: createdAt,
    pedEnabled: false,
    pedAutoDismissed: false,
    pedDate: "",
    pedTime: "11:00",
    pedTitle: "",
    pedSocial: [],
    pedAsset: "",
    pedAssetItems: [],
    pedCopy: "",
    creatorStatus: draft.creatorStatuses[0]?.name ?? "",
    creatorStore: "",
    creatorTime: "10:00",
    ...partial
  };
}

export function blankPost(draft: BoardData, partial: Partial<PedPost> = {}): PedPost {
  const createdAt = now();
  return {
    id: newPostId(),
    sourceTaskId: "",
    title: "",
    projectId: draft.projects[0]?.id ?? "",
    date: "",
    time: "11:00",
    status: draft.pedStatuses[0]?.name ?? "",
    members: [],
    format: "Video",
    social: [],
    asset: "",
    assetItems: [],
    copy: "",
    comments: [],
    subtasks: [],
    createdAt,
    updatedAt: createdAt,
    ...partial
  };
}

/** Change the status of a PED entry (manual post, or a post that comes from a Gantt task, which gets its mirror first). */
export function setPedStatus(draft: BoardData, item: { taskId?: string; postId?: string }, status: string): void {
  let post = item.postId ? draft.pedPosts.find((p) => p.id === item.postId) ?? null : null;
  if (!post && item.taskId) {
    const task = draft.tasks.find((t) => t.id === item.taskId);
    post = task ? ensurePedPostForTask(draft, task, { syncFromTask: true }) : null;
  }
  if (!post || post.status === status) return;
  post.status = status;
  touchItem(post);
}

/** Reschedule a PED entry (task-backed or manual). Mirrors the original drag-and-drop behaviour. */
export function movePedItem(draft: BoardData, item: { taskId?: string; postId?: string }, date: string, time: string): void {
  if (item.taskId) {
    const task = draft.tasks.find((t) => t.id === item.taskId);
    if (task) { task.pedDate = date; task.pedTime = time; touchItem(task); }
    const mirror = draft.pedPosts.find((p) => p.sourceTaskId === item.taskId);
    if (mirror) { mirror.date = date; mirror.time = time; touchItem(mirror); }
  } else if (item.postId) {
    const post = draft.pedPosts.find((p) => p.id === item.postId);
    if (post) { post.date = date; post.time = time; touchItem(post); }
  }
}

/**
 * Rename a person everywhere the name is stored: the People list, task and subtask assignees, post and post-subtask
 * assignees, @mentions in comments and the influencer contact person. Renaming onto a name that already exists merges
 * the two people. Every touched item is stamped so the merge keeps the change. Returns how many items changed.
 */
export function renamePerson(draft: BoardData, from: string, to: string): number {
  const target = to.trim();
  if (!target || from === target) return 0;
  let changed = 0;
  const swap = (names: string[]): string[] | null => {
    if (!names.includes(from)) return null;
    return [...new Set(names.map((name) => (name === from ? target : name)))];
  };
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mention = new RegExp(`@${escaped}(?![\\p{L}\\p{N}])`, "giu");

  draft.members = [...new Set(draft.members.map((name) => (name === from ? target : name)))];

  draft.tasks.forEach((task) => {
    let touched = false;
    const members = swap(task.members);
    if (members) { task.members = members; touched = true; }
    task.subtasks.forEach((sub) => { const next = swap(sub.members); if (next) { sub.members = next; touched = true; } });
    if (touched) { touchItem(task); changed += 1; }
  });
  draft.pedPosts.forEach((post) => {
    let touched = false;
    const members = swap(post.members);
    if (members) { post.members = members; touched = true; }
    post.subtasks.forEach((sub) => { const next = swap(sub.members); if (next) { sub.members = next; touched = true; } });
    post.comments.forEach((comment) => {
      const mentions = swap(comment.mentions);
      if (mentions) { comment.mentions = mentions; touched = true; }
      const text = comment.text.replace(mention, `@${target}`);
      if (text !== comment.text) { comment.text = text; touched = true; }
    });
    if (touched) { touchItem(post); changed += 1; }
  });
  draft.influencers.forEach((row) => {
    if (row.contactMember === from) { row.contactMember = target; touchItem(row); changed += 1; }
  });
  return changed;
}
