import { nowDate } from "./clock";

/** Local calendar date as "YYYY-MM-DD" (same as the old app, local time zone). */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date key according to the injectable clock. */
export function currentDateKey(): string {
  return dateKey(nowDate());
}

/** Add (or subtract) calendar days to a "YYYY-MM-DD" string. */
export function shiftDateString(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function dateDiffDays(a: Date, b: Date): number {
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end - start) / 86400000);
}

/** "dd/mm/yyyy" (en-GB) label, "-" when empty, the raw value when unparsable. */
export function formatDateLabel(value: string | undefined | null): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The hour after which "today" counts as finished for the roll-over. */
export const DAY_END_HOUR = 20;

/**
 * Next working day (Mon-Fri). From 20:00 onwards today no longer counts.
 * Port of otNextWorkingDayKey.
 */
export function nextWorkingDayKey(now: Date | number = nowDate()): string {
  const current = typeof now === "number" ? new Date(now) : now;
  const d = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  if (current.getHours() >= DAY_END_HOUR) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return dateKey(d);
}

export function isDoneStatus(status: unknown): boolean {
  return String(status || "").replace(/\s+/g, "").toUpperCase() === "DONE";
}

export function isBlockedStatus(status: unknown): boolean {
  return String(status || "").replace(/\s+/g, "").toUpperCase().includes("BLOCKED");
}

export function taskDateKey(task: { start?: string; end?: string } | null | undefined): string {
  return task?.end || task?.start || "";
}

/** True when the task has a date before today and is not DONE/BLOCKED (the "Backlog" count). */
export function isOverdueTask(task: { start?: string; end?: string; status?: string }): boolean {
  const date = taskDateKey(task);
  if (!date || isDoneStatus(task.status) || isBlockedStatus(task.status)) return false;
  return date < currentDateKey();
}
