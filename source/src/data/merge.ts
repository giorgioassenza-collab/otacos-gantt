/**
 * Merge, change stamping, dirty tracking and deletion tombstones.
 * Faithful port of the old app (index.html ~5478-6045 and 5811-5876). Any change here changes how two
 * writers converge on the shared Firestore document: keep it identical to the old app.
 */
import { now } from "./clock";
import {
  applyInfluencerFieldLedger,
  deletedMap,
  deletedSet,
  filterDeleted,
  mergeDeletedIds,
  normalizeData,
  normalizeInfluencerFieldLedger,
  normalizeInfluencerTypeProgressConfig
} from "./normalize";
import { influencerMergeMetadataKeys, influencerTypeProgressFields, settingMergeKeys } from "./starter";
import type {
  BoardData,
  DeletedKind,
  DirtyIds,
  Influencer,
  InfluencerFieldLedger,
  InfluencerTypeProgressConfig,
  PedPost,
  Project,
  Social,
  Status,
  Task,
  TypeProgressField
} from "./types";
import {
  cleanForFirestore,
  collectionById,
  influencerOptionKey,
  itemUpdatedAt,
  slugify,
  stableDataString,
  statusName,
  uniqueStrings
} from "./util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export {
  deletedMap,
  deletedSet,
  filterDeleted,
  mergeDeletedIds,
  normalizeInfluencerFieldLedger,
  normalizeInfluencerTypeProgressConfig,
  applyInfluencerFieldLedger
};

/* ------------------------------------------------------------ stamping */

/** Marks an item as modified now (updatedAt). Returns the item. */
export function touchItem<T extends { updatedAt?: number }>(item: T): T;
export function touchItem<T extends { updatedAt?: number }>(item: T | null | undefined): T | null | undefined;
export function touchItem<T extends { updatedAt?: number }>(item: T | null | undefined): T | null | undefined {
  if (item) item.updatedAt = now();
  return item;
}

function stampChangedItems(items: Loose[] = [], previousItems: Loose[] = []): void {
  const previous = collectionById(previousItems);
  (items || []).forEach((item) => {
    if (!item?.id) return;
    const previousItem = previous.get(item.id);
    if (!previousItem) {
      if (!item.updatedAt) item.updatedAt = item.createdAt || now();
      return;
    }
    if (stableDataString(item) !== stableDataString(previousItem)) {
      touchItem(item);
    }
  });
}

function influencerDataKeys(...rows: Array<Record<string, unknown> | null | undefined>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row || {})))]
    .filter((key) => !influencerMergeMetadataKeys.has(key));
}

function stampChangedInfluencerFields(currentData: Loose = {}, previousData: Loose = {}): void {
  const items = currentData.influencers || [];
  const previousItems = previousData.influencers || [];
  const previous = collectionById<Loose>(previousItems);
  currentData.influencerFieldLedger = mergeInfluencerFieldLedgers(currentData.influencerFieldLedger, previousData.influencerFieldLedger);
  const stampTime = now();
  (items || []).forEach((item: Loose) => {
    if (!item?.id) return;
    const previousItem = previous.get(item.id);
    const previousTime = itemUpdatedAt(previousItem);
    const fieldUpdatedAt: Record<string, number> = { ...(previousItem?.fieldUpdatedAt || {}), ...(item.fieldUpdatedAt || {}) };
    influencerDataKeys(item, previousItem).forEach((key) => {
      if (!fieldUpdatedAt[key] && previousTime) fieldUpdatedAt[key] = previousTime;
      if (!previousItem || stableDataString(item[key]) !== stableDataString(previousItem[key])) {
        fieldUpdatedAt[key] = stampTime;
        currentData.influencerFieldLedger[item.id] = currentData.influencerFieldLedger[item.id] || {};
        currentData.influencerFieldLedger[item.id][key] = { value: cleanForFirestore(item[key] ?? ""), updatedAt: stampTime };
      }
    });
    item.fieldUpdatedAt = fieldUpdatedAt;
    if (!previousItem || influencerDataKeys(item, previousItem).some((key) => Number(fieldUpdatedAt[key] || 0) === stampTime)) {
      item.updatedAt = stampTime;
    }
  });
}

/**
 * Compares `currentData` with `previousData` (the last committed copy) and stamps what changed:
 * settingsUpdatedAt for changed settings, updatedAt for changed tasks/ped posts, per-field timestamps and the
 * field ledger for changed influencer fields. Mutates `currentData`.
 */
export function stampChangedData(currentData: BoardData | null | undefined, previousData: BoardData | null | undefined): void {
  if (!currentData || !previousData) return;
  const stampTime = now();
  const current = currentData as Loose;
  const previous = previousData as Loose;
  current.settingsUpdatedAt = current.settingsUpdatedAt || {};
  settingMergeKeys.forEach((key) => {
    if (stableDataString(current[key]) !== stableDataString(previous[key])) {
      current.settingsUpdatedAt[key] = stampTime;
    }
  });
  stampChangedItems(current.tasks, previous.tasks);
  stampChangedItems(current.pedPosts, previous.pedPosts);
  stampChangedInfluencerFields(current, previous);
}

/* --------------------------------------------------------- dirty tracking */

function changedCollectionIds(currentItems: Loose[] = [], previousItems: Loose[] = []): Set<string> {
  const previous = collectionById(previousItems);
  return new Set((currentItems || [])
    .filter((item) => {
      if (!item?.id) return false;
      const previousItem = previous.get(item.id);
      return !previousItem || stableDataString(item) !== stableDataString(previousItem);
    })
    .map((item) => item.id as string));
}

/** Ids of tasks / ped posts / influencers that differ between the two copies. */
export function dirtyIdsForSave(currentData?: Partial<BoardData> | null, previousData?: Partial<BoardData> | null): DirtyIds {
  const current = (currentData || {}) as Loose;
  const previous = (previousData || {}) as Loose;
  return {
    tasks: changedCollectionIds(current.tasks || [], previous.tasks || []),
    pedPosts: changedCollectionIds(current.pedPosts || [], previous.pedPosts || []),
    influencers: changedCollectionIds(current.influencers || [], previous.influencers || [])
  };
}

/**
 * Re-applies the locally modified items on top of a merged board so a concurrent remote edit cannot overwrite
 * an edit that is being saved. `dirtyIds` may be a partial object (missing kinds are ignored).
 */
export function applyDirtyLocalItems(
  mergedData: unknown,
  localData: Partial<BoardData> | null | undefined,
  dirtyIds: Partial<Record<DeletedKind, Set<string>>> = {}
): BoardData {
  const next: Loose = normalizeData(mergedData);
  const local = (localData || {}) as Loose;
  (["tasks", "pedPosts", "influencers"] as DeletedKind[]).forEach((kind) => {
    const ids = dirtyIds[kind];
    if (!ids?.size) return;
    const localById = collectionById<Loose>(local[kind] || []);
    const seen = new Set<string>();
    next[kind] = (next[kind] || []).map((item: Loose) => {
      if (ids.has(item.id) && localById.has(item.id)) {
        seen.add(item.id);
        return localById.get(item.id);
      }
      return item;
    });
    ids.forEach((id) => {
      if (!seen.has(id) && localById.has(id)) next[kind].push(localById.get(id));
    });
    if (kind === "influencers") {
      const nextById = collectionById<Loose>(next[kind] || []);
      const orderedIds = new Set<string>();
      next[kind] = [
        ...(local[kind] || [])
          .filter((item: Loose) => item?.id && nextById.has(item.id))
          .map((item: Loose) => {
            orderedIds.add(item.id);
            return nextById.get(item.id);
          }),
        ...(next[kind] || []).filter((item: Loose) => item?.id && !orderedIds.has(item.id))
      ];
    }
  });
  return normalizeData(next);
}

/* ------------------------------------------------------------ collections */

export function mergeById<T extends { id?: string; updatedAt?: number; createdAt?: number }>(localItems: T[] = [], remoteItems: T[] = []): T[] {
  const merged = new Map<string, T>();
  remoteItems.forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  localItems.forEach((localItem) => {
    if (!localItem?.id) return;
    const remoteItem = merged.get(localItem.id);
    const localTime = itemUpdatedAt(localItem);
    const remoteTime = itemUpdatedAt(remoteItem);
    if (!remoteItem || localTime > remoteTime || (localTime > 0 && localTime === remoteTime)) {
      merged.set(localItem.id, localItem);
    }
  });
  const remoteOrder = remoteItems.map((item) => item?.id).filter(Boolean) as string[];
  const localOnly = localItems
    .filter((item) => item?.id && !remoteOrder.includes(item.id))
    .map((item) => item.id as string);
  const order = [...remoteOrder, ...localOnly];
  return order.map((id) => merged.get(id)).filter(Boolean) as T[];
}

export function mergeInfluencerRow(localItem?: Influencer, remoteItem?: Influencer): Influencer | undefined {
  if (!localItem) return remoteItem;
  if (!remoteItem) return localItem;
  const merged: Loose = { ...remoteItem };
  const mergedFieldUpdatedAt: Record<string, number> = {};
  influencerDataKeys(localItem, remoteItem).forEach((key) => {
    const localTime = Number(localItem.fieldUpdatedAt?.[key] || itemUpdatedAt(localItem));
    const remoteTime = Number(remoteItem.fieldUpdatedAt?.[key] || itemUpdatedAt(remoteItem));
    if (localTime >= remoteTime) merged[key] = localItem[key];
    mergedFieldUpdatedAt[key] = Math.max(localTime, remoteTime);
  });
  merged.id = localItem.id || remoteItem.id;
  merged.updatedAt = Math.max(itemUpdatedAt(localItem), itemUpdatedAt(remoteItem));
  merged.fieldUpdatedAt = mergedFieldUpdatedAt;
  return merged as Influencer;
}

export function mergeInfluencerFieldLedgers(localLedger: unknown = {}, remoteLedger: unknown = {}): InfluencerFieldLedger {
  const local = normalizeInfluencerFieldLedger(localLedger);
  const remote = normalizeInfluencerFieldLedger(remoteLedger);
  const merged = structuredClone(remote);
  Object.entries(local).forEach(([id, fields]) => {
    merged[id] = merged[id] || {};
    Object.entries(fields).forEach(([key, entry]) => {
      const remoteEntry = merged[id][key];
      if (!remoteEntry || Number(entry.updatedAt || 0) >= Number(remoteEntry.updatedAt || 0)) merged[id][key] = entry;
    });
  });
  return merged;
}

export function mergeInfluencerTypeProgressConfigs(localConfig: unknown = {}, remoteConfig: unknown = {}): InfluencerTypeProgressConfig {
  const local = normalizeInfluencerTypeProgressConfig(localConfig);
  const remote = normalizeInfluencerTypeProgressConfig(remoteConfig);
  const merged = structuredClone(remote);
  Object.entries(local).forEach(([typeKey, fields]) => {
    merged[typeKey] = merged[typeKey] || {};
    (Object.keys(fields) as TypeProgressField[]).forEach((field) => {
      const entry = fields[field]!;
      const remoteEntry = merged[typeKey][field];
      if (!remoteEntry || Number(entry.updatedAt || 0) >= Number(remoteEntry.updatedAt || 0)) merged[typeKey][field] = entry;
    });
  });
  return merged;
}

/** Sets one field of an influencer type's progress configuration, stamped now (port of setInfluencerTypeProgressField). */
export function setInfluencerTypeProgressField(source: BoardData, typeName: string, field: TypeProgressField, value: unknown): void {
  if (!(influencerTypeProgressFields as readonly string[]).includes(field)) return;
  const typeKey = influencerOptionKey(typeName);
  const updatedAt = now();
  source.influencerTypeProgressConfig = normalizeInfluencerTypeProgressConfig(source.influencerTypeProgressConfig);
  source.influencerTypeProgressConfig[typeKey] = source.influencerTypeProgressConfig[typeKey] || {};
  source.influencerTypeProgressConfig[typeKey][field] = { value, updatedAt };
}

export function mergeInfluencersById(localItems: Influencer[] = [], remoteItems: Influencer[] = []): Influencer[] {
  const localById = collectionById(localItems);
  const remoteById = collectionById(remoteItems);
  const merged = new Map<string, Influencer | undefined>();
  new Set([...remoteById.keys(), ...localById.keys()]).forEach((id) => {
    merged.set(id, mergeInfluencerRow(localById.get(id), remoteById.get(id)));
  });
  const localChangedIds = changedCollectionIds(localItems, remoteItems);
  const shouldUseLocalOrder = localChangedIds.size > 0;
  const orderSource = shouldUseLocalOrder ? localItems : remoteItems;
  const orderedIds = new Set<string>();
  return [
    ...orderSource
      .filter((item) => item?.id && merged.has(item.id))
      .map((item) => {
        orderedIds.add(item.id);
        return merged.get(item.id)!;
      }),
    ...[...merged.values()].filter((item): item is Influencer => Boolean(item?.id && !orderedIds.has(item.id)))
  ];
}

/* --------------------------------------------------------------- deletes */

/** Records a tombstone so a stale copy of the item cannot come back through a merge. */
export function markDeleted(data: BoardData, kind: DeletedKind, id: string | undefined | null): void {
  if (!id) return;
  data.deletedIds = data.deletedIds || { tasks: {}, pedPosts: {}, influencers: {} };
  data.deletedIds[kind] = data.deletedIds[kind] || {};
  data.deletedIds[kind][id] = now();
}

/** Deletes a task and the ped posts mirroring it (port of deleteTaskById). */
export function deleteTaskById(data: BoardData, id: string | undefined | null): void {
  if (!id) return;
  markDeleted(data, "tasks", id);
  (data.pedPosts || [])
    .filter((post) => post.sourceTaskId === id)
    .forEach((post) => markDeleted(data, "pedPosts", post.id));
  data.tasks = (data.tasks || []).filter((task) => task.id !== id);
  data.pedPosts = (data.pedPosts || []).filter((post) => post.sourceTaskId !== id);
}

/** Deletes a ped post. A post mirroring a task dismisses the task's automatic PED entry (deletePedPostById). */
export function deletePedPostById(data: BoardData, id: string | undefined | null): void {
  if (!id) return;
  const post = (data.pedPosts || []).find((item) => item.id === id);
  if (post?.sourceTaskId) {
    const task = (data.tasks || []).find((item) => item.id === post.sourceTaskId);
    if (task) {
      task.pedAutoDismissed = true;
      task.pedEnabled = false;
      task.pedDate = "";
      touchItem(task);
    }
  }
  markDeleted(data, "pedPosts", id);
  data.pedPosts = (data.pedPosts || []).filter((item) => item.id !== id);
}

/** Deletes an influencer and its linked "contact" task (deleteInfluencerById). */
export function deleteInfluencerById(data: BoardData, id: string | undefined | null): void {
  if (!id) return;
  const row = (data.influencers || []).find((item) => item.id === id);
  if (row?.contactTaskId) deleteTaskById(data, row.contactTaskId);
  markDeleted(data, "influencers", id);
  data.influencers = (data.influencers || []).filter((item) => item.id !== id);
}

/* ------------------------------------------------------ settings merging */

function settingUpdatedAt(source: Loose, key: string): number {
  return Number(source?.settingsUpdatedAt?.[key] || 0);
}

function mergeSettingsUpdatedAt(localData: Loose = {}, remoteData: Loose = {}): BoardData["settingsUpdatedAt"] {
  return settingMergeKeys.reduce((result, key) => {
    result[key] = Math.max(settingUpdatedAt(localData, key), settingUpdatedAt(remoteData, key));
    return result;
  }, {} as BoardData["settingsUpdatedAt"]);
}

export function mergeStringSettings(localList: string[] = [], remoteList: string[] = [], localTime = 0, remoteTime = 0): string[] {
  return localTime >= remoteTime
    ? uniqueStrings(localList || [], remoteList || [])
    : uniqueStrings(remoteList || [], localList || []);
}

export function mergeStatusSettings(localList: Loose[] = [], remoteList: Loose[] = [], localTime = 0, remoteTime = 0): Status[] {
  const primaryList = localTime >= remoteTime ? localList : remoteList;
  const secondaryList = localTime >= remoteTime ? remoteList : localList;
  const merged = new Map<string, Loose>();
  secondaryList.forEach((status) => {
    const item = typeof status === "string" ? { name: status, color: "#6b7280" } : status;
    const name = statusName(item);
    if (name) merged.set(name.toLowerCase(), { ...item, name });
  });
  primaryList.forEach((status) => {
    const item = typeof status === "string" ? { name: status, color: "#6b7280" } : status;
    const name = statusName(item);
    if (name) merged.set(name.toLowerCase(), { ...merged.get(name.toLowerCase()), ...item, name });
  });
  const orderedKeys: string[] = [];
  primaryList.forEach((status) => {
    const name = statusName(status);
    if (name) orderedKeys.push(name.toLowerCase());
  });
  secondaryList.forEach((status) => {
    const name = statusName(status);
    const key = name.toLowerCase();
    if (name && !orderedKeys.includes(key)) orderedKeys.push(key);
  });
  return orderedKeys.map((key) => merged.get(key)).filter(Boolean);
}

export function mergeProjects(localProjects: Project[] = [], remoteProjects: Project[] = [], localTime = 0, remoteTime = 0): Project[] {
  const primaryProjects = localTime >= remoteTime ? localProjects : remoteProjects;
  const secondaryProjects = localTime >= remoteTime ? remoteProjects : localProjects;
  const merged = new Map<string, Project>();
  secondaryProjects.forEach((project) => {
    if (project?.id) merged.set(project.id, project);
  });
  primaryProjects.forEach((project) => {
    if (project?.id) merged.set(project.id, { ...merged.get(project.id), ...project });
  });
  const order = [
    ...primaryProjects.map((project) => project?.id).filter(Boolean),
    ...secondaryProjects.map((project) => project?.id).filter((id) => id && !primaryProjects.some((project) => project?.id === id))
  ];
  return order.map((id) => merged.get(id)).filter(Boolean) as Project[];
}

function socialId(social: Loose): string {
  return social?.id || slugify(social?.label || social?.name || social);
}

export function mergeSocials(localSocials: Social[] = [], remoteSocials: Social[] = [], localTime = 0, remoteTime = 0): Social[] {
  const primarySocials: Loose[] = localTime >= remoteTime ? localSocials : remoteSocials;
  const secondarySocials: Loose[] = localTime >= remoteTime ? remoteSocials : localSocials;
  const merged = new Map<string, Loose>();
  secondarySocials.forEach((social) => {
    const id = socialId(social);
    if (id) merged.set(id, typeof social === "string" ? { id, label: social, short: social.slice(0, 2).toUpperCase(), color: "#111827" } : { ...social, id });
  });
  primarySocials.forEach((social) => {
    const id = socialId(social);
    if (id) merged.set(id, { ...merged.get(id), ...(typeof social === "string" ? { id, label: social, short: social.slice(0, 2).toUpperCase(), color: "#111827" } : social), id });
  });
  const order = [
    ...primarySocials.map((social) => socialId(social)).filter(Boolean),
    ...secondarySocials
      .map((social) => socialId(social))
      .filter((id) => id && !primarySocials.some((social) => socialId(social) === id))
  ];
  return order.map((id) => merged.get(id)).filter(Boolean) as Social[];
}

export function mergePlainObjectSettings<T extends object>(localObject: T = {} as T, remoteObject: T = {} as T, localTime = 0, remoteTime = 0): T {
  return localTime >= remoteTime
    ? { ...(remoteObject || {}), ...(localObject || {}) }
    : { ...(localObject || {}), ...(remoteObject || {}) };
}

export function mergeInfluencerOptions(localOptions: Loose = {}, remoteOptions: Loose = {}, localTime = 0, remoteTime = 0): BoardData["influencerOptions"] {
  const keys = [...new Set([...Object.keys(remoteOptions || {}), ...Object.keys(localOptions || {})])];
  return keys.reduce((result: Loose, key) => {
    const localList: Loose[] = localOptions[key] || [];
    const remoteList: Loose[] = remoteOptions[key] || [];
    result[key] = mergeStatusSettings(localList, remoteList, localTime, remoteTime);
    if (key === "type") {
      result[key] = result[key].map((item: Loose) => {
        const optionKey = influencerOptionKey(item.name);
        const localItem = localList.find((candidate) => influencerOptionKey(statusName(candidate)) === optionKey);
        const remoteItem = remoteList.find((candidate) => influencerOptionKey(statusName(candidate)) === optionKey);
        const localPreviewTime = Number(localItem?.previewUpdatedAt || 0);
        const remotePreviewTime = Number(remoteItem?.previewUpdatedAt || 0);
        const previewSource = localPreviewTime === remotePreviewTime
          ? (localTime >= remoteTime ? localItem : remoteItem)
          : (localPreviewTime > remotePreviewTime ? localItem : remoteItem);
        return {
          ...item,
          previewVisible: Boolean(previewSource?.previewVisible),
          previewUpdatedAt: Math.max(localPreviewTime, remotePreviewTime)
        };
      });
    }
    return result;
  }, {});
}

export function mergeInfluencerDeletedOptions(localOptions: Loose = {}, remoteOptions: Loose = {}, localTime = 0, remoteTime = 0): BoardData["influencerDeletedOptions"] {
  const primary = localTime >= remoteTime ? localOptions : remoteOptions;
  const secondary = localTime >= remoteTime ? remoteOptions : localOptions;
  const keys = [...new Set([...Object.keys(secondary || {}), ...Object.keys(primary || {})])];
  return keys.reduce((result: Loose, key) => {
    result[key] = localTime === remoteTime
      ? uniqueStrings(primary[key] || [], secondary[key] || [])
      : uniqueStrings(primary[key] || []);
    return result;
  }, {});
}

/* ------------------------------------------------------------- the merge */

/**
 * Three-way-less merge of two copies of the board (per-item last-writer-wins by updatedAt, per-field for
 * influencers, per-setting by settingsUpdatedAt, tombstones win). Neither input is mutated.
 */
export function mergeBoardData(localData: unknown, remoteData: unknown): BoardData {
  const local: Loose = normalizeData(localData);
  const remote: Loose = normalizeData(remoteData);
  const mergedDeletedIds = mergeDeletedIds(local, remote);
  return normalizeData({
    ...remote,
    deletedIds: mergedDeletedIds,
    settingsUpdatedAt: mergeSettingsUpdatedAt(local, remote),
    members: mergeStringSettings(local.members || [], remote.members || [], settingUpdatedAt(local, "members"), settingUpdatedAt(remote, "members")),
    statuses: mergeStatusSettings(local.statuses || [], remote.statuses || [], settingUpdatedAt(local, "statuses"), settingUpdatedAt(remote, "statuses")),
    pedStatuses: mergeStatusSettings(local.pedStatuses || [], remote.pedStatuses || [], settingUpdatedAt(local, "pedStatuses"), settingUpdatedAt(remote, "pedStatuses")),
    creatorStatuses: mergeStatusSettings(local.creatorStatuses || [], remote.creatorStatuses || [], settingUpdatedAt(local, "creatorStatuses"), settingUpdatedAt(remote, "creatorStatuses")),
    labels: mergeStringSettings(local.labels || [], remote.labels || [], settingUpdatedAt(local, "labels"), settingUpdatedAt(remote, "labels")),
    formats: mergeStringSettings(local.formats || [], remote.formats || [], settingUpdatedAt(local, "formats"), settingUpdatedAt(remote, "formats")),
    creatorStores: mergeStringSettings(local.creatorStores || [], remote.creatorStores || [], settingUpdatedAt(local, "creatorStores"), settingUpdatedAt(remote, "creatorStores")),
    projects: mergeProjects(local.projects || [], remote.projects || [], settingUpdatedAt(local, "projects"), settingUpdatedAt(remote, "projects")),
    socials: mergeSocials(local.socials || [], remote.socials || [], settingUpdatedAt(local, "socials"), settingUpdatedAt(remote, "socials")),
    influencerOptions: mergeInfluencerOptions(local.influencerOptions || {}, remote.influencerOptions || {}, settingUpdatedAt(local, "influencerOptions"), settingUpdatedAt(remote, "influencerOptions")),
    influencerPreviewVisibility: mergePlainObjectSettings(local.influencerPreviewVisibility || {}, remote.influencerPreviewVisibility || {}, settingUpdatedAt(local, "influencerPreviewVisibility"), settingUpdatedAt(remote, "influencerPreviewVisibility")),
    influencerDeletedOptions: mergeInfluencerDeletedOptions(local.influencerDeletedOptions || {}, remote.influencerDeletedOptions || {}, settingUpdatedAt(local, "influencerDeletedOptions"), settingUpdatedAt(remote, "influencerDeletedOptions")),
    influencerColumnLabels: mergePlainObjectSettings(local.influencerColumnLabels || {}, remote.influencerColumnLabels || {}, settingUpdatedAt(local, "influencerColumnLabels"), settingUpdatedAt(remote, "influencerColumnLabels")),
    influencerFieldLedger: mergeInfluencerFieldLedgers(local.influencerFieldLedger || {}, remote.influencerFieldLedger || {}),
    influencerTypeProgressConfig: mergeInfluencerTypeProgressConfigs(local.influencerTypeProgressConfig || {}, remote.influencerTypeProgressConfig || {}),
    tasks: filterDeleted(mergeById<Task>(local.tasks, remote.tasks), deletedSet({ deletedIds: mergedDeletedIds }, "tasks")),
    pedPosts: filterDeleted(mergeById<PedPost>(local.pedPosts || [], remote.pedPosts || []), deletedSet({ deletedIds: mergedDeletedIds }, "pedPosts")),
    influencers: filterDeleted(mergeInfluencersById(local.influencers || [], remote.influencers || []), deletedSet({ deletedIds: mergedDeletedIds }, "influencers"))
  });
}
