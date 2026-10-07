/**
 * Workflow label aliases.
 *
 * The data stored in Firestore contains the legacy Italian workflow labels ("Contattare", "Pubblicazione"...).
 * The new UI is English only, but stored data is never rewritten, so:
 *  - MATCHING accepts both the legacy Italian and the new English spelling (case/space insensitive);
 *  - DISPLAY always shows English;
 *  - NEWLY GENERATED tasks write the English names.
 */

export type WorkflowLabelKey =
  | "creator"
  | "contact"
  | "ask-ok-alice"
  | "contract"
  | "brief"
  | "notify-giorgia"
  | "video-in-store"
  | "send-video-alice"
  | "publication";

interface LabelDefinition {
  key: WorkflowLabelKey;
  /** What new tasks write and what the UI displays. */
  english: string;
  /** What the old app wrote. */
  legacy: string;
  /** Extra spellings accepted on input (lower case). */
  aliases: string[];
}

export const workflowLabels: readonly LabelDefinition[] = [
  { key: "creator", english: "creator", legacy: "creator", aliases: [] },
  { key: "contact", english: "Contact", legacy: "Contattare", aliases: [] },
  // "Ask Ok" is the label stored in the old starter label list, "Ask Ok Alice" is the one written on tasks.
  { key: "ask-ok-alice", english: "Ask OK Alice", legacy: "Ask Ok Alice", aliases: ["ask ok"] },
  { key: "contract", english: "Send contract", legacy: "Mandare contratto", aliases: [] },
  { key: "brief", english: "Brief", legacy: "Brief", aliases: [] },
  { key: "notify-giorgia", english: "Notify Giorgia", legacy: "Avvisare Giorgia", aliases: [] },
  { key: "video-in-store", english: "Video in store", legacy: "Video in store", aliases: [] },
  { key: "send-video-alice", english: "Send video to Alice", legacy: "Mandare video ad Alice", aliases: [] },
  { key: "publication", english: "Publication", legacy: "Pubblicazione", aliases: [] }
];

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

const keyBySpelling: ReadonlyMap<string, WorkflowLabelKey> = new Map(
  workflowLabels.flatMap((definition) =>
    [definition.english, definition.legacy, ...definition.aliases].map(
      (spelling) => [normalizeText(spelling), definition.key] as const
    )
  )
);

const definitionByKey: ReadonlyMap<WorkflowLabelKey, LabelDefinition> = new Map(
  workflowLabels.map((definition) => [definition.key, definition] as const)
);

/** The workflow key a label (legacy Italian or English spelling) stands for, or null for free labels. */
export function workflowLabelKey(label: unknown): WorkflowLabelKey | null {
  return keyBySpelling.get(normalizeText(label)) ?? null;
}

/**
 * Stable comparison key. Both "Pubblicazione" and "Publication" give "publication"; a free label gives its
 * trimmed lower-case text. Use it to compare labels, never to display them.
 */
export function canonicalLabel(label: unknown): string {
  return workflowLabelKey(label) ?? normalizeText(label);
}

/** English text to show in the UI. Free labels are shown as stored (trimmed). */
export function displayLabel(label: unknown): string {
  const key = workflowLabelKey(label);
  if (key) return definitionByKey.get(key)!.english;
  return String(label || "").trim();
}

/** True when two labels stand for the same thing (legacy Italian and English spellings are equivalent). */
export function labelsMatch(a: unknown, b: unknown): boolean {
  return canonicalLabel(a) === canonicalLabel(b);
}

/** The English name new tasks write for a workflow label. */
export function englishLabel(key: WorkflowLabelKey): string {
  return definitionByKey.get(key)!.english;
}

/** The name the old app wrote for a workflow label (used by the differential tests). */
export function legacyLabel(key: WorkflowLabelKey): string {
  return definitionByKey.get(key)!.legacy;
}

/** A settings label list in display form, with legacy/English duplicates collapsed (first wins). */
export function displayLabelList(labels: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  labels.forEach((label) => {
    const text = displayLabel(label);
    const key = canonicalLabel(label);
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}
