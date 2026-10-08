import type { BoardData, PedComment, Subtask, Task } from "../data/types";
import { isDoneStatus, isBlockedStatus, taskDateKey } from "../data/dates";
import { buildPedItems, type PedItem } from "./gantt";
import { isClientPerson, samePerson } from "./team";

/** Mentions older than this are not shown as news. */
export const MENTION_WINDOW_MS = 7 * 86_400_000;

export interface TaskNote { task: Task; blocked: boolean; subtasks: Subtask[] }
export interface SubtaskNote { task: Task; subtask: Subtask; /** The task it sits in is blocked. */ blocked: boolean }
export interface MentionNote { comment: PedComment; postId: string; postTitle: string }

export interface Notifications {
  /** Unfinished tasks that are yours, earliest date first. Blocked ones are listed but flagged. */
  tasks: TaskNote[];
  /** Unfinished subtasks that are yours inside tasks that are not yours. */
  subtasks: SubtaskNote[];
  /** Posts that are yours and not in their final status. */
  posts: PedItem[];
  /** Comments that tag you and that you have not seen yet. */
  mentions: MentionNote[];
  /** What the badge shows: tasks + loose subtasks + posts + new mentions. Anything blocked is listed but never counted. */
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
 * - Tasks: assigned to you (or, for Giorgia and Alice, tagged with your name) and not DONE.
 * - Subtasks: assigned to you, not done, inside a task that is not already yours (no double counting).
 * - Posts: you are in Who and the status is not the last PED status (Published). Posts that mirror one of your tasks
 *   are not counted twice.
 * - Mentions: "@You" in a post comment, newer than `seenAt` and than the 7 day window.
 */
export function computeNotifications(data: BoardData, me: string, seenMentionsAt = 0, now = Date.now()): Notifications {
  if (!me) return { tasks: [], subtasks: [], posts: [], mentions: [], count: 0 };

  const myTasks = data.tasks.filter((task) => !isDoneStatus(task.status) && taskIsFor(task, me));
  const myTaskIds = new Set(myTasks.map((task) => task.id));
  const tasks: TaskNote[] = myTasks
    .map((task) => ({
      task,
      blocked: isBlockedStatus(task.status),
      subtasks: task.subtasks.filter((sub) => !sub.done && sub.members.some((m) => samePerson(m, me)))
    }))
    .sort((a, b) => taskDateKey(a.task).localeCompare(taskDateKey(b.task)) || (a.task.nameEn || a.task.name).localeCompare(b.task.nameEn || b.task.name));

  const subtasks: SubtaskNote[] = data.tasks
    .filter((task) => !isDoneStatus(task.status) && !myTaskIds.has(task.id))
    .flatMap((task) => task.subtasks.filter((sub) => !sub.done && sub.members.some((m) => samePerson(m, me))).map((subtask) => ({ task, subtask, blocked: isBlockedStatus(task.status) })));

  const last = finalPedStatus(data);
  const posts = buildPedItems(data)
    .filter((item) => item.members.some((m) => samePerson(m, me)) && item.status !== last)
    .filter((item) => !(item.taskId && myTaskIds.has(item.taskId)))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const since = Math.max(seenMentionsAt, now - MENTION_WINDOW_MS);
  const tag = `@${me.toLowerCase()}`;
  const mentions: MentionNote[] = data.pedPosts
    .flatMap((post) => post.comments
      .filter((comment) => comment.createdAt > since && (comment.mentions.some((m) => samePerson(m, me)) || comment.text.toLowerCase().includes(tag)))
      .map((comment) => ({ comment, postId: post.id, postTitle: post.title })))
    .sort((a, b) => b.comment.createdAt - a.comment.createdAt);

  const countedTasks = tasks.filter((entry) => !entry.blocked).length;
  const countedSubtasks = subtasks.filter((entry) => !entry.blocked).length;
  const countedPosts = posts.filter((item) => !isBlockedStatus(item.status)).length;
  return { tasks, subtasks, posts, mentions, count: countedTasks + countedSubtasks + countedPosts + mentions.length };
}
