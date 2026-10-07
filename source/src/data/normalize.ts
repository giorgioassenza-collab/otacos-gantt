/**
 * normalizeData and every helper it needs. Faithful port of the old app (index.html ~5700-5900 and 6895-7250).
 *
 * Intentional, backward compatible difference: the old app rebuilds ped posts, influencers, subtasks and comments
 * from a fixed list of fields and silently drops anything else. Here unknown extra fields on those items are carried
 * through (legacy alias keys that the old app consumed, e.g. "NAME" or "link", are still dropped like before), so
 * fields written by a newer writer survive a round trip.
 */
import { now, random } from "./clock";
import { workflowLabelKey } from "./labelAliases";
import { currentDateKey, shiftDateString } from "./dates";
import {
  createRawStarterData,
  defaultCreatorStatusColors,
  defaultPedStatusColors,
  defaultProjects,
  defaultStatusColors,
  influencerColumns,
  influencerMergeMetadataKeys,
  influencerOptionKeys,
  influencerPalette,
  influencerSemanticColors,
  influencerTypeProgressFields,
  legacyInfluencerOptionColors,
  pedEndHour,
  pedFormatOptions,
  pedStartHour,
  settingMergeKeys,
  starterData
} from "./starter";
import type {
  BoardData,
  DeletedIds,
  DeletedKind,
  Influencer,
  InfluencerDeletedOptions,
  InfluencerFieldLedger,
  InfluencerOption,
  InfluencerTypeProgressConfig,
  PedFormat,
  PedPost,
  Project,
  SettingsUpdatedAt,
  Status,
  Task,
  TypeProgressField
} from "./types";
import {
  extraFields,
  influencerOptionKey,
  isClientName,
  normalizeStatusList,
  slugify,
  statusName,
  uniqueStrings
} from "./util";

/** Accepts the legacy Italian ("Pubblicazione") and the English ("Publication") spelling. */
function isPublicationLabelText(label: unknown): boolean {
  return workflowLabelKey(label) === "publication";
}

// The old app is dynamically typed; the normalizer deals with arbitrary stored JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/* ---------------------------------------------------------------- colours */

function normalizeProjectLookup(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function projectIdFromValue(projects: Project[] | undefined, value: unknown): string {
  const rawValue = String(value || "").trim();
  const normalizedValue = normalizeProjectLookup(rawValue);
  if (!rawValue) return "";
  const found = (projects || []).find((project) => {
    return project.id === rawValue || normalizeProjectLookup(project.name) === normalizedValue;
  });
  return found ? found.id : "";
}

export function validProjectId(projects: Project[] | undefined, id: unknown): boolean {
  return Boolean(id && (projects || []).some((project) => project.id === id));
}

export function colorKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function projectColorForName(projects: Project[] | undefined, value: unknown): string {
  const key = colorKey(value);
  if (!key) return "";
  const project = (projects || []).find((item) => colorKey(item.name) === key);
  return project?.color || "";
}

function hexToRgb(hex: unknown): { r: number; g: number; b: number } | null {
  const clean = String(hex || "").replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

/** Black or white, whichever reads better on the given background. */
export function readableTextColor(backgroundColor: unknown): string {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) return "#111827";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.58 ? "#111827" : "#ffffff";
}

export function isDefaultInfluencerTextColor(color: unknown): boolean {
  return !color || String(color).toLowerCase() === "#111827";
}

export function uxInfluencerOptionColor(key: string, value: unknown, index = 0, projects: Project[] = []): string {
  const projectColor = projectColorForName(projects, value);
  if (projectColor) return projectColor;
  const semanticColor = influencerSemanticColors[key]?.[colorKey(value)];
  if (semanticColor) return semanticColor;
  const palette = influencerPalette[key] || ["#eef2f7"];
  return palette[index % palette.length];
}

export function shouldRefreshInfluencerOptionColor(key: string, optionColor: string, expectedColor: string): boolean {
  if (!optionColor) return true;
  if (optionColor.toLowerCase() === expectedColor.toLowerCase()) return false;
  const legacy = legacyInfluencerOptionColors[key];
  return Boolean(legacy && optionColor.toLowerCase() === legacy.toLowerCase());
}

/* ------------------------------------------------------------- small helpers */

export function normalizePedFormat(value: unknown): PedFormat {
  const text = String(value || "").trim().toLowerCase();
  if (text === "video" || text === "reel") return "Video";
  if (text === "carousel" || text === "carosello") return "Carousel";
  if (text === "static" || text === "statica" || text === "post" || text === "story") return "Static";
  return pedFormatOptions[0];
}

/** "HH:MM" clamped to the PED grid (11:00 - 20:xx). */
export function normalizeHour(value: unknown): string {
  const match = String(value || "").match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "11:00";
  const hour = Math.min(pedEndHour, Math.max(pedStartHour, Number(match[1])));
  const minute = match[2] || "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

export function ensureProjectDefaults(projects: Project[]): Project[] {
  defaultProjects.forEach((project) => {
    if (!projects.some((item) => item.id === project.id || item.name.toLowerCase() === project.name.toLowerCase())) {
      projects.push({ ...project });
    }
  });
  return projects;
}

/* ------------------------------------------------------ deletion tombstones */

export function deletedMap(rawData: Loose, kind: DeletedKind): Record<string, number> {
  const source = rawData?.deletedIds?.[kind] || rawData?.deleted?.[kind] || {};
  if (Array.isArray(source)) {
    return source.reduce((result: Record<string, number>, id: string) => {
      if (id) result[id] = now();
      return result;
    }, {});
  }
  return source && typeof source === "object" ? source : {};
}

export function deletedSet(rawData: Loose, kind: DeletedKind): Set<string> {
  return new Set(Object.keys(deletedMap(rawData, kind)));
}

export function mergeDeletedIds(localData: Loose, remoteData: Loose): DeletedIds {
  return (["tasks", "pedPosts", "influencers"] as DeletedKind[]).reduce((result, kind) => {
    result[kind] = { ...deletedMap(remoteData, kind), ...deletedMap(localData, kind) };
    return result;
  }, {} as DeletedIds);
}

export function filterDeleted<T extends { id?: string }>(items: T[] | undefined | null, deletedIds: Set<string>): T[] {
  return (items || []).filter((item) => item?.id && !deletedIds.has(item.id));
}

/* ------------------------------------------------- influencer field ledger */

export function normalizeInfluencerFieldLedger(ledger: Loose = {}): InfluencerFieldLedger {
  return Object.entries(ledger || {}).reduce((result: InfluencerFieldLedger, [id, fields]: [string, Loose]) => {
    if (!id || !fields || typeof fields !== "object") return result;
    const normalizedFields = Object.entries(fields).reduce((fieldResult: Record<string, { value: unknown; updatedAt: number }>, [key, entry]: [string, Loose]) => {
      if (!key || !entry || typeof entry !== "object") return fieldResult;
      fieldResult[key] = { value: entry.value ?? "", updatedAt: Number(entry.updatedAt || 0) };
      return fieldResult;
    }, {});
    if (Object.keys(normalizedFields).length) result[id] = normalizedFields;
    return result;
  }, {});
}

export function applyInfluencerFieldLedger(source: Loose): void {
  const ledger = normalizeInfluencerFieldLedger(source.influencerFieldLedger);
  source.influencerFieldLedger = ledger;
  source.influencers = (source.influencers || []).map((row: Loose) => {
    const fields = ledger[row.id];
    if (!fields) return row;
    const next = { ...row, fieldUpdatedAt: { ...(row.fieldUpdatedAt || {}) } };
    Object.entries(fields).forEach(([key, entry]) => {
      if (influencerMergeMetadataKeys.has(key)) return;
      next[key] = entry.value;
      next.fieldUpdatedAt[key] = Math.max(Number(next.fieldUpdatedAt[key] || 0), Number(entry.updatedAt || 0));
    });
    return next;
  });
}

/* -------------------------------------------------- type progress config */

export function normalizeInfluencerTypeProgressConfig(config: Loose = {}): InfluencerTypeProgressConfig {
  return Object.entries(config || {}).reduce((result: InfluencerTypeProgressConfig, [typeKey, fields]: [string, Loose]) => {
    if (!typeKey || !fields || typeof fields !== "object") return result;
    result[typeKey] = influencerTypeProgressFields.reduce((fieldResult: InfluencerTypeProgressConfig[string], field) => {
      const entry = fields[field];
      if (entry && typeof entry === "object") {
        fieldResult[field] = { value: entry.value ?? (field === "visible" ? false : ""), updatedAt: Number(entry.updatedAt || 0) };
      }
      return fieldResult;
    }, {});
    return result;
  }, {});
}

export function applyInfluencerTypeProgressConfig(source: Loose): void {
  source.influencerTypeProgressConfig = normalizeInfluencerTypeProgressConfig(source.influencerTypeProgressConfig);
  source.influencerPreviewVisibility = { ...(source.influencerPreviewVisibility || {}) };
  (source.influencerOptions?.type || []).forEach((item: Loose) => {
    const typeKey = influencerOptionKey(item.name);
    const config = source.influencerTypeProgressConfig[typeKey] || {};
    const legacyValues: Record<TypeProgressField, unknown> = {
      visible: Object.prototype.hasOwnProperty.call(source.influencerPreviewVisibility, typeKey)
        ? Boolean(source.influencerPreviewVisibility[typeKey])
        : Boolean(item.previewVisible),
      needed: Math.max(0, Number(item.needed) || 0),
      deadline: item.deadline || "",
      projectId: item.projectId || ""
    };
    source.influencerTypeProgressConfig[typeKey] = config;
    influencerTypeProgressFields.forEach((field) => {
      if (!config[field]) config[field] = { value: legacyValues[field], updatedAt: 1 };
    });
    item.previewVisible = Boolean(config.visible.value);
    item.needed = Math.max(0, Number(config.needed.value) || 0);
    item.deadline = String(config.deadline.value || "");
    item.projectId = String(config.projectId.value || "");
    source.influencerPreviewVisibility[typeKey] = item.previewVisible;
  });
}

/* ---------------------------------------------------------- influencers */

export function normalizeInfluencerDeletedOptions(options: Loose = {}): InfluencerDeletedOptions {
  return influencerOptionKeys.reduce((result, key) => {
    result[key] = uniqueStrings(options?.[key] || []);
    return result;
  }, {} as InfluencerDeletedOptions);
}

function applyInfluencerDeletedOptionsToRows(normalized: Loose): void {
  const deletedOptions = normalizeInfluencerDeletedOptions(normalized.influencerDeletedOptions);
  normalized.influencers = (normalized.influencers || []).map((row: Loose) => {
    const next = { ...row };
    Object.keys(deletedOptions).forEach((key) => {
      const deletedNames = new Set((deletedOptions[key] || []).map(influencerOptionKey));
      if (next[key] && deletedNames.has(influencerOptionKey(next[key]))) next[key] = "";
    });
    return next;
  });
}

const influencerKnownKeys = [
  "id", "updatedAt", "fieldUpdatedAt", "sortOrder", "influencerSortOrder", "name", "NAME", "city", "CITY",
  "target", "TARGET", "type", "TYPE", "ttProfile", "TT PROFILE", "igProfile", "IG PROFILE", "ttLink", "TT LINK",
  "igLink", "IG LINK", "output", "OUTPUT", "price", "PRICE", "status", "STATUS", "where", "WHERE", "when", "WHEN",
  "contactTaskEnabled", "contactTaskId", "contactDate", "contactMember", "contactProjectId", "contactedAt",
  "influencerUpdatedAt"
];

export function normalizeInfluencerRow(row: Loose, fallbackSortOrder = 0): Influencer {
  const source = row || {};
  const rawStatus = source.status || source.STATUS || "";
  const sortOrder = Number(source.sortOrder ?? source.influencerSortOrder);
  return {
    ...extraFields(source, influencerKnownKeys),
    id: source.id || `inf${now()}${random()}`,
    updatedAt: Number(source.updatedAt || 0),
    fieldUpdatedAt: { ...(source.fieldUpdatedAt || {}) },
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : fallbackSortOrder,
    name: source.name || source.NAME || "",
    city: source.city || source.CITY || "",
    target: source.target || source.TARGET || "",
    type: source.type || source.TYPE || "",
    ttProfile: source.ttProfile || source["TT PROFILE"] || "",
    igProfile: source.igProfile || source["IG PROFILE"] || "",
    ttLink: source.ttLink || source["TT LINK"] || "",
    igLink: source.igLink || source["IG LINK"] || "",
    output: source.output || source.OUTPUT || "",
    price: source.price || source.PRICE || "",
    status: String(rawStatus).trim().toUpperCase() === "TBC" ? "TO CONTACT" : rawStatus,
    where: source.where || source.WHERE || "",
    when: source.when || source.WHEN || "",
    contactTaskEnabled: Boolean(source.contactTaskEnabled),
    contactTaskId: source.contactTaskId || "",
    contactDate: source.contactDate || "",
    contactMember: source.contactMember || "",
    contactProjectId: source.contactProjectId || "",
    contactedAt: source.contactedAt || "",
    influencerUpdatedAt: source.influencerUpdatedAt || ""
  };
}

export function isInfluencerStatus(row: { status?: unknown }, status: string): boolean {
  return String(row.status || "").trim().toUpperCase() === status;
}

/** CONTACTED for 30+ days becomes "Ghosted". Uses the injectable clock. */
export function applyInfluencerStatusAging(rows: Influencer[]): Influencer[] {
  const todayKey = currentDateKey();
  const ghostThreshold = shiftDateString(todayKey, -30);
  return rows.map((row) => {
    const next = { ...row };
    if (isInfluencerStatus(next, "CONTACTED")) {
      if (!next.influencerUpdatedAt) next.influencerUpdatedAt = todayKey;
      if (!next.contactedAt) next.contactedAt = next.influencerUpdatedAt;
      if (next.influencerUpdatedAt <= ghostThreshold) {
        next.status = "Ghosted";
      }
    }
    return next;
  });
}

export function influencerSortValue(row: { sortOrder?: unknown } | null | undefined): number {
  const value = Number(row?.sortOrder);
  return Number.isFinite(value) ? value : 0;
}

export function normalizeInfluencerOption(option: Loose, fallbackColor = "#eef2f7"): InfluencerOption {
  if (typeof option === "string") return { name: option, color: fallbackColor, textColor: "#111827", needed: 0 };
  return {
    name: option.name || option.label || "",
    color: option.color || fallbackColor,
    textColor: option.textColor || "#111827",
    needed: Math.max(0, Math.floor(Number(option.needed) || 0)),
    previewVisible: Boolean(option.previewVisible),
    previewUpdatedAt: Number(option.previewUpdatedAt || (option.previewVisible ? 1 : 0)),
    deadline: option.deadline || "",
    projectId: option.projectId || "",
    progressTaskId: option.progressTaskId || ""
  };
}

function ensureInfluencerOptionsFromRows(normalized: Loose): void {
  normalized.influencerOptions = normalized.influencerOptions || {};
  normalized.influencerDeletedOptions = normalizeInfluencerDeletedOptions(normalized.influencerDeletedOptions);
  influencerOptionKeys.forEach((key) => {
    const deletedNames = new Set((normalized.influencerDeletedOptions[key] || []).map(influencerOptionKey));
    const existing: Loose[] = (normalized.influencerOptions[key] || [])
      .map((item: Loose) => normalizeInfluencerOption(item, legacyInfluencerOptionColors[key]))
      .filter((item: Loose) => item.name && !deletedNames.has(influencerOptionKey(item.name)));
    const names = new Set(existing.map((item) => influencerOptionKey(item.name)));
    (normalized.influencers || []).forEach((row: Loose) => {
      const rowOptionKey = influencerOptionKey(row[key]);
      if (row[key] && !names.has(rowOptionKey) && !deletedNames.has(rowOptionKey)) {
        const color = uxInfluencerOptionColor(key, row[key], existing.length, normalized.projects);
        existing.push({ name: row[key], color, textColor: readableTextColor(color) });
        names.add(rowOptionKey);
      }
    });
    normalized.influencerOptions[key] = existing.map((item, index) => {
      const color = projectColorForName(normalized.projects, item.name) || item.color;
      const expectedColor = uxInfluencerOptionColor(key, item.name, index, normalized.projects);
      const nextColor = shouldRefreshInfluencerOptionColor(key, item.color, expectedColor) ? expectedColor : color;
      return {
        ...item,
        color: nextColor,
        textColor: isDefaultInfluencerTextColor(item.textColor) ? readableTextColor(nextColor) : item.textColor
      };
    });
  });
  normalized.influencerColumnLabels = normalized.influencerColumnLabels || {};
}

/* ------------------------------------------------------------ normalizeData */

const subtaskKnownKeys = ["id", "title", "members", "done"];
const commentKnownKeys = ["id", "text", "mentions", "createdAt"];
const pedPostKnownKeys = [
  "id", "sourceTaskId", "updatedAt", "title", "projectId", "project", "projectName", "date", "time",
  "status", "members", "format", "social", "asset", "link", "assetItems", "copy", "comments", "subtasks"
];

/** Normalizes one task. Unknown fields are kept. */
export function normalizeTask(task: Loose, creatorStatuses: Status[]): Task {
  const label = task.label || (task.hasHomeLabel ? "Video in store" : "");
  // Accepts the legacy Italian and the English spelling.
  const autoPed = isPublicationLabelText(label);
  const autoPedDismissed = Boolean(task.pedAutoDismissed);
  return {
    ...task,
    nameEn: task.nameEn || "",
    updatedAt: Number(task.updatedAt || task.createdAt || 0),
    end: task.end || task.start || "",
    info: task.info || "",
    label,
    pedAutoDismissed: autoPedDismissed,
    pedEnabled: Boolean(task.pedEnabled) || (autoPed && !autoPedDismissed),
    pedDate: task.pedDate || (autoPed && !autoPedDismissed ? task.start : "") || "",
    pedTime: task.pedTime || (autoPed && !autoPedDismissed ? "12:00" : "11:00"),
    pedTitle: task.pedTitle || "",
    pedSocial: Array.isArray(task.pedSocial) ? task.pedSocial : [],
    pedAsset: task.pedAsset || "",
    pedAssetItems: Array.isArray(task.pedAssetItems) ? task.pedAssetItems : [],
    pedCopy: task.pedCopy || "",
    creatorStatus: task.creatorStatus || (creatorStatuses[0] ? statusName(creatorStatuses[0]) : ""),
    creatorStore: task.creatorStore || "",
    creatorTime: task.creatorTime || "10:00",
    subtasks: (task.subtasks || []).map((subtask: Loose) => ({
      ...extraFields(subtask, subtaskKnownKeys),
      id: subtask.id || `s${now()}${random()}`,
      title: subtask.title || "",
      members: Array.isArray(subtask.members) ? subtask.members : [],
      done: Boolean(subtask.done)
    }))
  };
}

/** Normalizes one PED post against the board's projects and PED statuses. Unknown fields are kept. */
export function normalizePedPost(post: Loose, context: { projects: Project[]; pedStatuses: Status[] }): PedPost {
  return {
    ...extraFields(post, pedPostKnownKeys),
    id: post.id || `ped${now()}${random()}`,
    sourceTaskId: post.sourceTaskId || "",
    updatedAt: Number(post.updatedAt || post.createdAt || 0),
    title: post.title || "Post",
    projectId: validProjectId(context.projects, post.projectId)
      ? post.projectId
      : projectIdFromValue(context.projects, post.project || post.projectName) || context.projects[0]?.id || "",
    date: post.date || "2026-06-16",
    time: normalizeHour(post.time),
    status: post.status || (context.pedStatuses[0] ? statusName(context.pedStatuses[0]) : ""),
    members: Array.isArray(post.members) ? post.members : [],
    format: normalizePedFormat(post.format),
    social: Array.isArray(post.social)
      ? post.social.map((item: string) => item === "tiktok" ? "tiktok" : item === "instagram" ? "instagram" : item)
      : [],
    asset: post.asset || post.link || "",
    assetItems: Array.isArray(post.assetItems) ? post.assetItems : [],
    copy: post.copy || "",
    comments: (post.comments || []).map((comment: Loose) => ({
      ...extraFields(comment, commentKnownKeys),
      id: comment.id || `pc${now()}${random()}`,
      text: comment.text || "",
      mentions: Array.isArray(comment.mentions) ? comment.mentions : [],
      createdAt: Number(comment.createdAt || now())
    })).filter((comment: Loose) => comment.text.trim()),
    subtasks: (post.subtasks || []).map((subtask: Loose) => ({
      ...extraFields(subtask, subtaskKnownKeys),
      id: subtask.id || `ps${now()}${random()}`,
      title: subtask.title || "",
      members: Array.isArray(subtask.members) ? subtask.members : [],
      done: Boolean(subtask.done)
    }))
  };
}

/**
 * Brings any stored board document (old or new, partial or complete) to the canonical BoardData shape.
 * Idempotent: normalizeData(normalizeData(x)) deep-equals normalizeData(x).
 */
export function normalizeData(rawData?: unknown): BoardData {
  const normalized: Loose = structuredClone(rawData || starterData);
  normalized.members = [...new Set<string>(normalized.members || starterData.members)].filter((member) => !isClientName(member));
  normalized.statuses = normalizeStatusList(normalized.statuses, starterData.statuses, defaultStatusColors);
  normalized.pedStatuses = normalizeStatusList(normalized.pedStatuses || normalized.pedStatus, starterData.pedStatuses, defaultPedStatusColors);
  normalized.creatorStatuses = normalizeStatusList(normalized.creatorStatuses, starterData.creatorStatuses, defaultCreatorStatusColors);
  normalized.creatorStores = normalized.creatorStores && normalized.creatorStores.length ? normalized.creatorStores : structuredClone(starterData.creatorStores);
  normalized.labels = [...new Set<string>(normalized.labels || starterData.labels)].filter((label) => String(label).trim().toLowerCase() !== "brief");
  normalized.formats = structuredClone(pedFormatOptions);
  normalized.projects = ensureProjectDefaults(normalized.projects || structuredClone(starterData.projects));
  normalized.settingsUpdatedAt = settingMergeKeys.reduce((result, key) => {
    result[key] = Number(normalized.settingsUpdatedAt?.[key] || 0);
    return result;
  }, {} as SettingsUpdatedAt);
  normalized.deletedIds = mergeDeletedIds(normalized, {});
  const deletedTaskIds = deletedSet(normalized, "tasks");
  const deletedPedPostIds = deletedSet(normalized, "pedPosts");
  const deletedInfluencerIds = deletedSet(normalized, "influencers");
  normalized.socials = (normalized.socials || structuredClone(starterData.socials)).map((social: Loose) => {
    if (typeof social === "string") {
      return { id: slugify(social), label: social, short: social.slice(0, 2).toUpperCase(), color: "#111827" };
    }
    const label = social.label || social.name || "Social";
    return {
      id: social.id || slugify(label),
      label,
      short: (social.short || label.slice(0, 2)).toUpperCase(),
      color: social.color || "#111827"
    };
  });
  normalized.tasks = filterDeleted((normalized.tasks || []).map((task: Loose) => normalizeTask(task, normalized.creatorStatuses)), deletedTaskIds);
  normalized.pedPosts = filterDeleted((normalized.pedPosts || []).map((post: Loose) => normalizePedPost(post, normalized)), deletedPedPostIds);
  normalized.influencers = filterDeleted((normalized.influencers || []).map((row: Loose, index: number) => normalizeInfluencerRow(row, index)).filter((row: Loose) => influencerColumns.some((column) => row[column.key])), deletedInfluencerIds);
  applyInfluencerFieldLedger(normalized);
  normalized.influencers = applyInfluencerStatusAging(normalized.influencers)
    .sort((left, right) => influencerSortValue(left) - influencerSortValue(right));
  normalized.influencerDeletedOptions = normalizeInfluencerDeletedOptions(normalized.influencerDeletedOptions);
  applyInfluencerDeletedOptionsToRows(normalized);
  ensureInfluencerOptionsFromRows(normalized);
  applyInfluencerTypeProgressConfig(normalized);
  normalized.influencerPreviewVisibility = { ...(normalized.influencerPreviewVisibility || {}) };
  (normalized.influencerOptions?.type || []).forEach((item: Loose) => {
    const key = influencerOptionKey(item.name);
    if (!Object.prototype.hasOwnProperty.call(normalized.influencerPreviewVisibility, key)) {
      normalized.influencerPreviewVisibility[key] = Boolean(item.previewVisible);
    }
    item.previewVisible = Boolean(normalized.influencerPreviewVisibility[key]);
  });
  return normalized as BoardData;
}

/** A normalized, deep-cloned starter board. */
export function normalizedStarterData(): BoardData {
  return normalizeData(createRawStarterData());
}
