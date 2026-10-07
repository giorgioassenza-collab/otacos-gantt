import type {
  BoardData,
  InfluencerOptionKey,
  PedFormat,
  SettingMergeKey
} from "./types";

/* ---------- Storage keys (IDENTICAL to the old app so local edits are never lost) ---------- */
export const storageKey = "tacos-gantt-board-data-v5";
export const historyStorageKey = "tacos-gantt-board-history-v1";
export const revisionStorageKey = "tacos-gantt-board-revision-v1";
export const safetyDbName = "otacos-workflow-safety-v1";
export const safetyStoreName = "snapshots";
export const safetyLatestKey = "latest";
export const safetyLocalStorageKey = "tacos-gantt-board-safety-latest-v1";
export const viewStorageKey = "tacos-gantt-board-active-view-v1";

/** Firestore document paths. */
export const BOARD_PATH = "boards/default";
export const BOARD_SAFETY_PATH = "boardSafety/latest";
export const BOARD_SAFETY_BACKUPS_COLLECTION = "boardSafetyBackups";

/** The shared team account (the password is typed by the user, never stored here). */
export const TEAM_EMAIL = "team@otacos-workflow.app";

export const maxHistoryEntries = 10;
export const maxUndoEntries = 30;

export const pedFormatOptions: PedFormat[] = ["Video", "Static", "Carousel"];
export const pedStartHour = 11;
export const pedEndHour = 20;

export const influencerOptionKeys: InfluencerOptionKey[] = ["city", "target", "type", "status", "where", "when"];

export interface InfluencerColumn {
  key: string;
  label: string;
  hidden?: boolean;
}

export const influencerColumns: InfluencerColumn[] = [
  { key: "name", label: "NAME" },
  { key: "city", label: "CITY" },
  { key: "target", label: "TARGET" },
  { key: "type", label: "TYPE" },
  { key: "ttProfile", label: "TT PROFILE" },
  { key: "igProfile", label: "IG PROFILE" },
  { key: "ttLink", label: "TT LINK", hidden: true },
  { key: "igLink", label: "IG LINK", hidden: true },
  { key: "output", label: "OUTPUT" },
  { key: "price", label: "PRICE" },
  { key: "status", label: "STATUS" },
  { key: "where", label: "WHERE" },
  { key: "when", label: "WHEN" }
];

export const settingMergeKeys: SettingMergeKey[] = [
  "members",
  "statuses",
  "pedStatuses",
  "creatorStatuses",
  "labels",
  "formats",
  "creatorStores",
  "projects",
  "socials",
  "influencerOptions",
  "influencerPreviewVisibility",
  "influencerDeletedOptions",
  "influencerColumnLabels"
];

export const influencerMergeMetadataKeys: ReadonlySet<string> = new Set(["id", "updatedAt", "fieldUpdatedAt"]);
export const influencerTypeProgressFields = ["visible", "needed", "deadline", "projectId"] as const;

export const legacyInfluencerOptionColors: Record<string, string> = {
  city: "#e0f2fe",
  target: "#dcfce7",
  type: "#fef3c7",
  status: "#fee2e2",
  where: "#ede9fe",
  when: "#fce7f3"
};

export const influencerPalette: Record<string, string[]> = {
  city: ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#ede9fe", "#e0f2fe"],
  target: ["#dcfce7", "#dbeafe", "#fef3c7", "#fee2e2", "#ede9fe", "#ccfbf1"],
  type: ["#fef3c7", "#e0f2fe", "#ede9fe", "#dcfce7", "#fee2e2", "#fce7f3"],
  status: ["#fee2e2", "#dbeafe", "#dcfce7", "#e5e7eb", "#fef3c7", "#ede9fe"],
  where: ["#ede9fe", "#dbeafe", "#dcfce7", "#fef3c7", "#fee2e2", "#ccfbf1"],
  when: ["#e0f2fe", "#fef3c7", "#dcfce7", "#fce7f3", "#ede9fe", "#e5e7eb"]
};

export const influencerSemanticColors: Record<string, Record<string, string>> = {
  status: {
    "to contact": "#fee2e2",
    tbc: "#fee2e2",
    contacted: "#dbeafe",
    ghosted: "#e5e7eb",
    approved: "#dcfce7",
    rejected: "#fee2e2",
    pending: "#fef3c7",
    "in progress": "#e0f2fe",
    done: "#dcfce7"
  },
  type: {
    creator: "#ede9fe",
    influencer: "#dbeafe",
    ugc: "#fef3c7",
    ambassador: "#dcfce7",
    vip: "#fce7f3"
  },
  when: {
    now: "#dcfce7",
    soon: "#fef3c7",
    later: "#e0f2fe"
  }
};

export const defaultStatusColors = ["#6b7280", "#147bd1", "#e4572e", "#15a36d", "#7c5cff", "#c98200"];
export const defaultPedStatusColors = ["#0f172a", "#2563eb", "#16a34a", "#f59e0b"];
export const defaultCreatorStatusColors = ["#dbeafe", "#fef3c7", "#dcfce7", "#fee2e2"];

export const defaultProjects = [
  { id: "p-accounting", name: "Accounting", color: "#64748b" },
  { id: "p-customer-care", name: "Customer Care", color: "#0f9f6e" }
];

/**
 * Exactly the old app's starter data. The labels are the legacy Italian ones: this is what the
 * old app writes for a brand new document and what normalizeData falls back to.
 */
export const starterData: BoardData = {
  members: [],
  statuses: [
    { name: "TO DO", color: "#6b7280" },
    { name: "In progress", color: "#147bd1" },
    { name: "DONE", color: "#e4572e" }
  ],
  pedStatuses: [
    { name: "Draft", color: "#0f172a" },
    { name: "Ready", color: "#2563eb" },
    { name: "Published", color: "#16a34a" }
  ],
  creatorStatuses: [
    { name: "Scheduled", color: "#dbeafe" },
    { name: "Waiting", color: "#fef3c7" },
    { name: "Published", color: "#dcfce7" }
  ],
  creatorStores: ["GIGA TACOS"],
  labels: ["creator", "Contattare", "Ask Ok", "Mandare contratto", "Avvisare Giorgia", "Video in store", "Pubblicazione"],
  formats: ["Video", "Static", "Carousel"],
  socials: [
    { id: "instagram", label: "Instagram", short: "IG", color: "#e1306c" },
    { id: "tiktok", label: "TikTok", short: "TT", color: "#111827" }
  ],
  projects: [
    { id: "p-accounting", name: "Accounting", color: "#64748b" },
    { id: "p-customer-care", name: "Customer Care", color: "#0f9f6e" }
  ],
  tasks: [],
  pedPosts: [],
  influencers: [],
  influencerFieldLedger: {},
  influencerTypeProgressConfig: {},
  influencerOptions: { city: [], target: [], type: [], status: [], where: [], when: [] },
  influencerPreviewVisibility: {},
  influencerDeletedOptions: { city: [], target: [], type: [], status: [], where: [], when: [] },
  influencerColumnLabels: {},
  settingsUpdatedAt: {
    members: 0,
    statuses: 0,
    pedStatuses: 0,
    creatorStatuses: 0,
    labels: 0,
    formats: 0,
    creatorStores: 0,
    projects: 0,
    socials: 0,
    influencerOptions: 0,
    influencerPreviewVisibility: 0,
    influencerDeletedOptions: 0,
    influencerColumnLabels: 0
  },
  deletedIds: { tasks: {}, pedPosts: {}, influencers: {} }
};
// NOTE: the old app lists the starter statuses as plain strings and lets normalizeData assign default
// colours by index. The colours above are exactly what that produces, so both forms normalize identically.

/** Deep copy of the legacy starter data. */
export function createRawStarterData(): BoardData {
  return structuredClone(starterData);
}

/** English wording of the workflow labels, for NEW boards only (the demo backend). */
export const englishStarterLabels = [
  "creator",
  "Contact",
  "Ask OK Alice",
  "Send contract",
  "Notify Giorgia",
  "Video in store",
  "Publication"
];

/** Starter data for a brand new board that never touched the legacy Italian wording. */
export function createEnglishStarterData(): BoardData {
  const raw = createRawStarterData();
  raw.labels = [...englishStarterLabels];
  return raw;
}
