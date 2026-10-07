import type { BoardData, Task } from "../../data/types";
import { isPublicationLabel, isVideoInStoreLabel, syncCreatorStatusToGantt } from "../../data/labels";
import { deleteTaskById, touchItem } from "../../data/merge";
import { statusName } from "../../data/util";

export type CreatorKind = "video" | "publication";

/** One entry of the Creator Calendar. Both kinds are backed by the Gantt task of the video shoot (`taskId`). */
export interface CreatorEntry {
  /** Unique per entry: `${taskId}:video` or `${taskId}:publication`. */
  key: string;
  /** Id of the "Video in store" Gantt task (the Creator Calendar item). */
  taskId: string;
  publicationTaskId: string;
  kind: CreatorKind;
  title: string;
  date: string;
  /** "HH:MM" of the shoot. Empty for publications (they have no shoot time). */
  time: string;
  store: string;
  status: string;
  project: string;
  members: string[];
  videoDate: string;
  publicationDate: string;
}

export const KIND_LABEL: Record<CreatorKind, string> = {
  video: "Video in store",
  publication: "Publication"
};

function normalizedName(value: unknown): string {
  return String(value || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
}

/** Same key as the original app: project + normalized creator name. "" when the task has no usable name. */
export function creatorCalendarKey(task: Pick<Task, "projectId" | "nameEn" | "name">): string {
  const name = normalizedName(task.nameEn || task.name);
  return name ? `${task.projectId || ""}::${name}` : "";
}

/** The Publication task linked to a video-in-store task (port of findPublicationTaskFor). */
export function findPublicationTaskFor(tasks: Task[], videoTask: Task): Task | undefined {
  const key = creatorCalendarKey(videoTask);
  if (!key) return undefined;
  return tasks.find((task) => isPublicationLabel(task.label) && creatorCalendarKey(task) === key);
}

export function defaultCreatorStatus(data: Pick<BoardData, "creatorStatuses">): string {
  return data.creatorStatuses?.[0] ? statusName(data.creatorStatuses[0]) : "";
}

/** All entries (shoots and their publications), sorted by date, time and title. */
export function buildCreatorEntries(data: BoardData): CreatorEntry[] {
  const tasks = data.tasks || [];
  const projectName = new Map(data.projects.map((project) => [project.id, project.name]));
  const fallbackStatus = defaultCreatorStatus(data);
  const entries: CreatorEntry[] = [];
  tasks.filter((task) => isVideoInStoreLabel(task.label)).forEach((task) => {
    const publication = findPublicationTaskFor(tasks, task);
    const base = {
      taskId: task.id,
      publicationTaskId: publication?.id || "",
      title: task.nameEn || task.name,
      store: task.creatorStore || "",
      status: task.creatorStatus || fallbackStatus,
      project: projectName.get(task.projectId) || "",
      members: task.members || [],
      videoDate: task.start || "",
      publicationDate: publication?.start || ""
    };
    if (task.start) {
      entries.push({ ...base, key: `${task.id}:video`, kind: "video", date: task.start, time: task.creatorTime || "10:00" });
    }
    if (publication?.start) {
      entries.push({ ...base, key: `${task.id}:publication`, kind: "publication", date: publication.start, time: "" });
    }
  });
  return entries.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99") || a.title.localeCompare(b.title)
  );
}

/** Sets the Creator status of a shoot and mirrors it to the Gantt status (Confirmed -> In progress, Video shot -> DONE). */
export function setCreatorStatus(draft: BoardData, taskId: string, status: string): void {
  const task = draft.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.creatorStatus = status;
  syncCreatorStatusToGantt(draft, task);
  touchItem(task);
}

/** Deletes the shoot task and its linked publication task, like the original context menu. */
export function deleteCreatorItem(draft: BoardData, taskId: string): void {
  const task = draft.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const publication = findPublicationTaskFor(draft.tasks, task);
  deleteTaskById(draft, taskId);
  if (publication) deleteTaskById(draft, publication.id);
}

/** Spoken/tooltip description of an entry. */
export function entryDescription(entry: CreatorEntry): string {
  const parts = [KIND_LABEL[entry.kind], entry.title];
  if (entry.time) parts.push(entry.time);
  if (entry.store) parts.push(entry.store);
  if (entry.status) parts.push(`status ${entry.status}`);
  return parts.join(", ");
}
