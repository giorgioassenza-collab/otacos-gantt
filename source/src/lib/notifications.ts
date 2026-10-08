import type { BoardData, PedComment, Subtask, Task } from "../data/types";
import { currentDateKey, isDoneStatus, isBlockedStatus, taskDateKey } from "../data/dates";
import { buildPedItems, type PedItem } from "./gantt";
import { isClientPerson, samePerson } from "./team";

/** Mentions older than this are not shown as news. */
export const MENTION_WINDOW_MS = 7 * 86_400_000;

export interface TaskNote { task: Task; subtasks: Subtask[] }
export interface SubtaskNote { task: Task; subtask: Subtask }
export interface MentionNote { comment: PedComment; postId: string; postTitle: string }

export interface Notifications {
  /** Unfinished tasks that are yours, earliest date first. Blocked ones never appear. */
  tasks: TaskNote[];
  /** Unfinished subtasks that are yours inside tasks that are not yours. */
  subtasks: SubtaskNote[];
  /** Posts that are yours, not in their final status, not blocked, dated today or earlier (the future is not news yet). */
  posts: PedItem[];
  /** Comments that tag you and that you have not seen yet. */
  mentions: MentionNote[];
  /** What the badge shows: tasks + loose subtasks + posts + new mentions. Everything listed is counted. */
  count: number;
}

/** Is this task "for" this person? Same rule as the Gantt's Who filter, including the client people. */
export function taskIsFor(task: Task, me: string): boolean {
  if (task.members.some((member) => samePerson(member, me))) return true;
  if (!isClientPerson(me)) return false;
  const needle = me.toLowerCase();
  return task.status.toLowerCase().includes(needle) || String(task.label || "").toLowerCase().includes(needle);
}

const finalPedStatus = (data: BoardData) => data.pedStatuses[data.pedStatuses.length - 1]?.name ?? "";

/**
 * Everything pending for `me`.
 * - Tasks: assigned to you (or, for Giorgia and Alice, tagged with your name), not DONE and not BLOCKED.
 * - Subtasks: assigned to you, not done, inside a task that is not already yours (no double counting).
 * - Posts: you are in Who, the status is not the last PED status (Published) and not blocked, and the date is today or
 *   earlier. Posts that mirror one of your tasks are not counted twice.
 * - Mentions: "@You" in a post comment, newer than `seenAt` and than the 7 day window.
 */
export function computeNotifications(data: BoardData, me: string, seenMentionsAt = 0, now = Date.now(), today = currentDateKey()): Notifications {
  if (!me) return { tasks: [], subtasks: [], posts: [], mentions: [], count: 0 };

  const myTasks = data.tasks.filter((task) => !isDoneStatus(task.status) && !isBlockedStatus(task.status) && taskIsFor(task, me));
  const myTaskIds = new Set(myTasks.map((task) => task.id));
  const tasks: TaskNote[] = myTasks
    .map((task) => ({
      task,
      subtasks: task.subtasks.filter((sub) => !sub.done && sub.members.some((m) => samePerson(m, me)))
    }))
    .sort((a, b) => taskDateKey(a.task).localeCompare(taskDateKey(b.task)) || (a.task.nameEn || a.task.name).localeCompare(b.task.nameEn || b.task.name));

  const subtasks: SubtaskNote[] = data.tasks
    .filter((task) => !isDoneStatus(task.status) && !isBlockedStatus(task.status) && !myTaskIds.has(task.id))
    .flatMap((task) => task.subtasks.filter((sub) => !sub.done && sub.members.some((m) => samePerson(m, me))).map((subtask) => ({ task, subtask })));

  const last = finalPedStatus(data);
  const posts = buildPedItems(data)
    .filter((item) => item.members.some((m) => samePerson(m, me)) && item.status !== last && !isBlockedStatus(item.status) && item.date <= today)
    .filter((item) => !(item.taskId && myTaskIds.has(item.taskId)))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const since = Math.max(seenMentionsAt, now - MENTION_WINDOW_MS);
  const tag = `@${me.toLowerCase()}`;
  const mentions: MentionNote[] = data.pedPosts
    .flatMap((post) => post.comments
      .filter((comment) => comment.createdAt > since && (comment.mentions.some((m) => samePerson(m, me)) || comment.text.toLowerCase().includes(tag)))
      .map((comment) => ({ comment, postId: post.id, postTitle: post.title })))
    .sort((a, b) => b.comment.createdAt - a.comment.createdAt);

  return { tasks, subtasks, posts, mentions, count: tasks.length + subtasks.length + posts.length + mentions.length };
}
