import type { BoardData, PedFormat, Project, Task, PedPost, Social, Status } from "../data/types";
import { dateKey, shiftDateString } from "../data/dates";

export const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" as a local-midnight Date. */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function dayIndex(start: Date, value: string): number {
  const d = parseDate(value);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / DAY_MS);
}

export function dateFromIndex(start: Date, index: number): string {
  return dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

/** The Gantt always shows a rolling window that starts three months back, like the original. */
export function timelineWindow(today: Date, monthsBack = 3, months = 13) {
  const start = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return { start, end, days, months };
}

export function normalizeHour(value: string | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return "11:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function statusColor(statuses: Status[], name: string, fallback = "#d7dde5"): string {
  return statuses.find((item) => item.name === name)?.color ?? fallback;
}

export function projectOf(projects: Project[], id: string): Project | undefined {
  return projects.find((project) => project.id === id);
}

export function socialOf(socials: Social[], id: string): Social | undefined {
  return socials.find((social) => social.id === id);
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return "#17120f";
  const n = parseInt(match[1], 16);
  const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? "#17120f" : "#fffdf8";
}

/** A PED entry as shown on the Gantt and in the PED views: either a Gantt task flagged for PED, or a manual PED post. */
export interface PedItem {
  /** `task-<taskId>` for task backed items, otherwise the PedPost id. */
  id: string;
  taskId?: string;
  postId?: string;
  title: string;
  date: string;
  time: string;
  status: string;
  members: string[];
  social: string[];
  format: PedFormat;
  asset: string;
  copy: string;
  projectId: string;
  project: string;
  color: string;
  source: "Gantt" | "PED";
  commentCount: number;
  subtaskTotal: number;
  subtaskDone: number;
}

const FORMATS: PedFormat[] = ["Video", "Static", "Carousel"];
export function normalizeFormat(value: unknown): PedFormat {
  return FORMATS.includes(value as PedFormat) ? (value as PedFormat) : "Video";
}

export function buildPedItems(data: BoardData): PedItem[] {
  const projects = data.projects;
  const linked: PedItem[] = data.tasks
    .filter((task) => task.pedEnabled && task.pedDate)
    .map((task) => {
      const project = projectOf(projects, task.projectId);
      const post = data.pedPosts.find((p) => p.sourceTaskId === task.id);
      const subtasks = post?.subtasks ?? task.subtasks ?? [];
      return {
        id: `task-${task.id}`,
        taskId: task.id,
        postId: post?.id,
        title: post?.title || task.pedTitle || task.nameEn || task.name,
        date: task.pedDate,
        time: normalizeHour(post?.time || task.pedTime),
        status: post?.status || data.pedStatuses[0]?.name || task.status,
        members: post?.members || task.members || [],
        social: post?.social || task.pedSocial || [],
        format: normalizeFormat(post?.format),
        asset: post?.asset || task.pedAsset || "",
        copy: post?.copy || task.pedCopy || "",
        projectId: task.projectId,
        project: project?.name || "",
        color: project?.color || statusColor(data.statuses, task.status),
        source: "Gantt" as const,
        commentCount: post?.comments?.length ?? 0,
        subtaskTotal: subtasks.length,
        subtaskDone: subtasks.filter((s) => s.done).length
      };
    });
  const manual: PedItem[] = data.pedPosts
    .filter((post) => !post.sourceTaskId)
    .map((post) => {
      const project = projectOf(projects, post.projectId);
      return {
        id: post.id,
        postId: post.id,
        title: post.title,
        date: post.date,
        time: normalizeHour(post.time),
        status: post.status,
        members: post.members,
        social: post.social,
        format: normalizeFormat(post.format),
        asset: post.asset,
        copy: post.copy,
        projectId: post.projectId,
        project: project?.name || "",
        color: project?.color || statusColor(data.pedStatuses, post.status),
        source: "PED" as const,
        commentCount: post.comments?.length ?? 0,
        subtaskTotal: post.subtasks?.length ?? 0,
        subtaskDone: (post.subtasks ?? []).filter((s) => s.done).length
      };
    });
  return [...linked, ...manual];
}

export interface TaskLayout { task: Task; start: string; end: string; startIndex: number; endIndex: number; lane: number }
export interface PedLayout { item: PedItem; index: number; lane: number }

/**
 * Greedy lane packing for one project row: tasks first, then PED posts, so nothing overlaps.
 * Same idea as the original compactGanttRowLayouts, with a fixed one-lane height for PED chips.
 */
export function layoutProjectRow(tasks: Task[], posts: PedItem[], timelineStart: Date) {
  const lanes: number[] = [];
  const taskLayouts: TaskLayout[] = [];
  const pedLayouts: PedLayout[] = [];

  const items = [
    ...tasks.map((task) => ({ type: "task" as const, task, startIndex: dayIndex(timelineStart, task.start), endIndex: dayIndex(timelineStart, task.end || task.start) })),
    ...posts.map((item) => ({ type: "ped" as const, item, startIndex: dayIndex(timelineStart, item.date), endIndex: dayIndex(timelineStart, item.date) }))
  ]
    .filter((entry) => Number.isFinite(entry.startIndex) && Number.isFinite(entry.endIndex))
    .sort((a, b) =>
      a.startIndex - b.startIndex ||
      a.endIndex - b.endIndex ||
      (a.type === b.type ? 0 : a.type === "task" ? -1 : 1) ||
      (a.type === "ped" && b.type === "ped" ? a.item.time.localeCompare(b.item.time) : 0)
    );

  items.forEach((entry) => {
    let lane = lanes.findIndex((lastEnd) => lastEnd < entry.startIndex);
    if (lane < 0) { lane = lanes.length; lanes.push(entry.endIndex); } else { lanes[lane] = entry.endIndex; }
    if (entry.type === "task") {
      taskLayouts.push({ task: entry.task, start: entry.task.start, end: entry.task.end || entry.task.start, startIndex: entry.startIndex, endIndex: entry.endIndex, lane });
    } else {
      pedLayouts.push({ item: entry.item, index: entry.startIndex, lane });
    }
  });
  return { taskLayouts, pedLayouts, laneCount: lanes.length };
}

export function weekdayShort(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short" });
}

export function friendlyDate(value: string, today: string): string {
  if (!value) return "No date";
  if (value === today) return "Today";
  if (value === shiftDateString(today, 1)) return "Tomorrow";
  if (value === shiftDateString(today, -1)) return "Yesterday";
  return parseDate(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function dateRangeLabel(task: Pick<Task, "start" | "end">): string {
  const start = parseDate(task.start);
  if (!task.end || task.end === task.start) return start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const end = parseDate(task.end);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${start.getDate()}–${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export type PostLike = Pick<PedPost, "id">;
