/**
 * Local history (the "Before change" snapshots behind Undo / History) and its structured diff.
 * Port of normalizeHistory / createHistoryEntry / withHistoryEntry / historySummary / historyChangeLines.
 * History entries live in localStorage only; the Firestore document always stores `history: []`.
 */
import { now, nowDate, random } from "./clock";
import { maxHistoryEntries } from "./starter";
import type { BoardData, HistoryDiffEntry, HistoryDiffKind, HistoryEntry } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/** Keeps only valid entries, newest first, at most maxHistoryEntries. */
export function normalizeHistory(list: unknown): HistoryEntry[] {
  return Array.isArray(list)
    ? (list as HistoryEntry[])
        .filter((entry) => entry && entry.id && entry.savedAt && entry.data)
        .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)))
        .slice(0, maxHistoryEntries)
    : [];
}

/** "12 tasks, 3 PED, 40 influencers" */
export function historySummary(snapshot: Partial<BoardData> | null | undefined): string {
  const item = snapshot || {};
  return `${(item.tasks || []).length} tasks, ${(item.pedPosts || []).length} PED, ${(item.influencers || []).length} influencers`;
}

export function createHistoryEntry(snapshot: BoardData, label = "Before change"): HistoryEntry {
  const savedAt = nowDate().toISOString();
  return {
    id: `h${now()}-${random().toString(16).slice(2)}`,
    savedAt,
    label,
    summary: historySummary(snapshot),
    data: structuredClone(snapshot)
  };
}

/** Adds a snapshot as the newest entry (trimmed to maxHistoryEntries). Returns a new list. */
export function withHistoryEntry(list: HistoryEntry[] | undefined | null, snapshot: BoardData | null | undefined, label?: string): HistoryEntry[] {
  if (!snapshot) return normalizeHistory(list);
  const entry = createHistoryEntry(snapshot, label);
  return normalizeHistory([entry, ...(list || [])]);
}

export function formatHistoryDate(value: string | number | Date, locale = "en-GB"): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  } catch {
    return String(value || "-");
  }
}

/* ----------------------------------------------------------------- diff */

export function itemTitle(item: Loose, fallback = "Item"): string {
  return item?.nameEn || item?.name || item?.title || fallback;
}

export function compactValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

/** "field: before → after" for every listed field whose value differs. */
export function diffFields(before: Loose = {}, after: Loose = {}, fields: string[] = []): string[] {
  return fields
    .filter((field) => JSON.stringify(before[field] ?? "") !== JSON.stringify(after[field] ?? ""))
    .map((field) => `${field}: ${compactValue(before[field])} → ${compactValue(after[field])}`);
}

export function diffCollection(
  beforeItems: Loose[] = [],
  afterItems: Loose[] = [],
  kind: HistoryDiffKind,
  fields: string[],
  nameFallback: string
): HistoryDiffEntry[] {
  const beforeMap = new Map<string, Loose>(beforeItems.map((item) => [item.id, item]));
  const afterMap = new Map<string, Loose>(afterItems.map((item) => [item.id, item]));
  const entries: HistoryDiffEntry[] = [];
  afterMap.forEach((after, id) => {
    if (!beforeMap.has(id)) {
      entries.push({ kind, change: "added", title: itemTitle(after, nameFallback), changes: [] });
      return;
    }
    const before = beforeMap.get(id);
    const changed = diffFields(before, after, fields);
    if (changed.length) entries.push({ kind, change: "changed", title: itemTitle(after, nameFallback), changes: changed });
  });
  beforeMap.forEach((before, id) => {
    if (!afterMap.has(id)) entries.push({ kind, change: "removed", title: itemTitle(before, nameFallback), changes: [] });
  });
  return entries;
}

/** Structured difference between two board snapshots (tasks, PED posts, influencers, projects). */
export function historyChanges(beforeSnapshot?: Partial<BoardData> | null, afterSnapshot?: Partial<BoardData> | null): HistoryDiffEntry[] {
  const before = (beforeSnapshot || {}) as Loose;
  const after = (afterSnapshot || {}) as Loose;
  return [
    ...diffCollection(before.tasks || [], after.tasks || [], "GANTT task", ["name", "nameEn", "projectId", "status", "members", "start", "end", "label", "pedEnabled", "pedDate", "creatorStatus"], "Task"),
    ...diffCollection(before.pedPosts || [], after.pedPosts || [], "PED post", ["title", "projectId", "date", "time", "status", "members", "social", "format", "asset", "copy"], "Post"),
    ...diffCollection(before.influencers || [], after.influencers || [], "Influencer", ["name", "city", "target", "type", "status", "where", "when", "contactDate", "contactMember", "contactProjectId"], "Influencer"),
    ...diffCollection(before.projects || [], after.projects || [], "Project", ["name", "color"], "Project")
  ];
}

/** One line of text per entry, identical wording to the old app ("GANTT task changed: X (status: A → B)"). */
export function formatDiffEntry(entry: HistoryDiffEntry): string {
  if (entry.change === "added") return `${entry.kind} added: ${entry.title}`;
  if (entry.change === "removed") return `${entry.kind} removed: ${entry.title}`;
  return `${entry.kind} changed: ${entry.title} (${entry.changes.slice(0, 3).join("; ")})`;
}

/** The old app's flat list of change lines (historyChangeLines). */
export function historyChangeLines(beforeSnapshot?: Partial<BoardData> | null, afterSnapshot?: Partial<BoardData> | null): string[] {
  return historyChanges(beforeSnapshot, afterSnapshot).map(formatDiffEntry);
}

/**
 * Changes introduced by history entry `index` (entries are newest first): the entry holds the board BEFORE a
 * change, so the "after" is the next newer entry, or the current board for the newest one.
 */
export function historyEntryChanges(history: HistoryEntry[], index: number, current: BoardData): HistoryDiffEntry[] {
  const entry = history[index];
  if (!entry) return [];
  const after = index === 0 ? current : history[index - 1]?.data;
  return historyChanges(entry.data || {}, after || {});
}
