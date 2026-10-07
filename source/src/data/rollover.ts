/**
 * The 20:00 roll-over: unfinished tasks dated before the next working day move to it.
 * Port of otNextWorkingDayKey / otShouldRollOver / otRollOverUnfinished (index.html ~14396-14446).
 */
import { nowDate } from "./clock";
import { isBlockedStatus, isDoneStatus, nextWorkingDayKey } from "./dates";
import { shouldAutoCreatePedPost, syncAutomaticPedPostsForTasks } from "./labels";
import { touchItem } from "./merge";
import type { BoardData, Task } from "./types";

export { nextWorkingDayKey } from "./dates";

/** True when the task is unfinished, not an influencer-progress task, and ends before `target`. */
export function shouldRollOver(task: Task | null | undefined, target: string): boolean {
  if (!task || !task.start) return false;
  if (isDoneStatus(task.status) || isBlockedStatus(task.status)) return false;
  if (String(task.id || "").endsWith("-influencer-progress")) return false;
  return (task.end || task.start) < target;
}

export interface RollOverResult {
  /** The tasks that were moved (already mutated inside `data`). */
  changed: Task[];
  /** The date they were moved to ("YYYY-MM-DD"). */
  target: string;
}

/**
 * Moves unfinished tasks to the next working day. MUTATES `data` (run it inside `sync.mutate`, with skipUndo):
 * a single-day task moves both start and end, a multi-day task only extends its end; automatic PED mirrors follow.
 * Returns {changed: []} when nothing needs to move.
 */
export function rollOverTasks(data: BoardData, now: Date | number = nowDate()): RollOverResult {
  const target = nextWorkingDayKey(now);
  const moving = (data.tasks || []).filter((task) => shouldRollOver(task, target));
  if (!moving.length) return { changed: [], target };
  moving.forEach((task) => {
    const wasSingleDay = !task.end || task.end === task.start;
    if (wasSingleDay) task.start = target;
    task.end = target;
    if (wasSingleDay && shouldAutoCreatePedPost(task)) {
      task.pedEnabled = true;
      task.pedDate = target;
      task.pedTime = task.pedTime || "12:00";
    }
    touchItem(task);
  });
  syncAutomaticPedPostsForTasks(data, moving);
  return { changed: moving, target };
}
