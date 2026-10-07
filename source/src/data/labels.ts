/**
 * Creator workflow and cross-view helpers (Gantt <-> PED <-> Influencer).
 *
 * Every function that touches the board takes a BoardData DRAFT as its first argument and mutates it (they are meant
 * to run inside `sync.mutate(draft => ...)`). Nothing here reads the DOM, saves, or renders.
 *
 * Language: matching accepts the legacy Italian labels stored in Firestore ("Pubblicazione", "Contattare"...) and the
 * English ones; tasks generated now carry the ENGLISH names (see labelAliases.ts). `legacyLabels: true` reproduces the
 * old app's Italian output exactly (used by the differential tests).
 */
import { now } from "./clock";
import { currentDateKey } from "./dates";
import { englishLabel, legacyLabel, workflowLabelKey, type WorkflowLabelKey } from "./labelAliases";
import { deletePedPostById, deleteTaskById, touchItem } from "./merge";
import { normalizeHour, normalizePedFormat, normalizePedPost, normalizeTask, validProjectId } from "./normalize";
import { pedFormatOptions } from "./starter";
import type { BoardData, CreatorControls, Influencer, PedPost, Task } from "./types";
import { influencerOptionKey, stableDataString, statusName } from "./util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/* ---------------------------------------------------------------- label tests */

export function isCreatorLabel(label: unknown): boolean {
  return workflowLabelKey(label) === "creator";
}

export function isVideoInStoreLabel(label: unknown): boolean {
  return workflowLabelKey(label) === "video-in-store";
}

/** "Pubblicazione" (legacy) or "Publication". */
export function isPublicationLabel(label: unknown): boolean {
  return workflowLabelKey(label) === "publication";
}

/** Publication tasks feed the PED automatically unless the user dismissed the PED entry. */
export function shouldAutoCreatePedPost(task: { label?: unknown; pedAutoDismissed?: unknown } | null | undefined): boolean {
  return Boolean(task && isPublicationLabel(task.label) && !task.pedAutoDismissed);
}

/* ---------------------------------------------------------------- id helpers */

function allIds(data: BoardData): Set<string> {
  return new Set([
    ...(data.tasks || []).map((task) => task.id),
    ...(data.pedPosts || []).map((post) => post.id)
  ]);
}

/**
 * The old app builds ids from Date.now() (`ped${now}`, `t${now}-copy`...): two items created in the same millisecond
 * got the SAME id and one silently replaced the other in every merge. We keep the old format and only add a numeric
 * suffix when the id is already taken.
 */
function uniqueId(taken: Set<string>, base: string): string {
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  taken.add(id);
  return id;
}

function makeTask(data: BoardData, fields: Loose): Task {
  return normalizeTask(fields, data.creatorStatuses);
}

function makePedPost(data: BoardData, fields: Loose): PedPost {
  return normalizePedPost(fields, data);
}

/* ------------------------------------------------------------ Gantt statuses */

export function ensureStatusExists(data: BoardData, name: string): void {
  if (data.statuses.some((status) => statusName(status) === name)) return;
  data.statuses.push({ name, color: "#f59e0b" });
}

/** Returns the existing status name (case-insensitive match) or adds the status. */
export function ganttStatusByName(data: BoardData, name: string, fallbackColor = "#6b7280"): string {
  const existing = data.statuses.find((status) => statusName(status).toLowerCase() === name.toLowerCase());
  if (existing) return statusName(existing);
  data.statuses.push({ name, color: fallbackColor });
  return name;
}

/** Creator Calendar status "Confirmed" -> Gantt "In progress", "Video shot" -> "DONE". */
export function syncCreatorStatusToGantt(data: BoardData, task: Task): void {
  const value = String(task.creatorStatus || "").trim().toLowerCase();
  if (value === "confirmed") task.status = ganttStatusByName(data, "In progress", "#86efac");
  if (value === "video shot") task.status = ganttStatusByName(data, "DONE", "#d1d5db");
}

export function contactTaskStatus(data: BoardData): string {
  const todo = (data.statuses || []).find((item) => statusName(item).toUpperCase() === "TO DO");
  return todo ? statusName(todo) : data.statuses?.[0] ? statusName(data.statuses[0]) : "TO DO";
}

export function contactProjectId(data: BoardData): string {
  const project = (data.projects || []).find((item) => item.id === "p-customer-care")
    || (data.projects || []).find((item) => String(item.name || "").toLowerCase() === "customer care")
    || (data.projects || [])[0];
  return project ? project.id : "";
}

/* ----------------------------------------------------------- creator workflow */

export interface CreatorGenerationOptions {
  /** Write the old Italian names/labels instead of the English ones. Default false. */
  legacyLabels?: boolean;
}

/**
 * Child tasks of a "creator" task, driven by a plain controls object (checkboxes + dates) instead of the DOM.
 * Same-day tasks come first (contact, ask ok, contract, brief, notify Giorgia), then the dated ones
 * (video in store, send video to Alice, publication). Returns [] when the base task is not a "creator" task.
 */
export function creatorDuplicateTasksFromControls(
  baseTask: Task | Loose,
  createdAt: number,
  controls: CreatorControls,
  options: CreatorGenerationOptions = {}
): Task[] {
  if (!isCreatorLabel(baseTask.label)) return [];
  const text = (key: WorkflowLabelKey): string => (options.legacyLabels ? legacyLabel(key) : englishLabel(key));
  const parentId = baseTask.id || `t${createdAt}`;
  const childTask = (action: string, taskFields: Loose): Task => ({
    ...baseTask,
    ...taskFields,
    id: `${parentId}-creator-${action}`,
    creatorParentId: parentId,
    creatorAction: action,
    createdAt,
    updatedAt: now()
  });
  const sameDayTasks = [
    { action: "contact", checked: controls.contact.checked, label: text("contact") },
    { action: "ask-ok", checked: controls.askOk.checked, label: text("ask-ok-alice") },
    { action: "contract", checked: controls.contract.checked, label: text("contract") },
    { action: "brief", checked: controls.brief.checked, label: text("brief") },
    { action: "giorgia", checked: controls.giorgia.checked, label: text("notify-giorgia"), status: "Notify Giorgia" }
  ]
    .filter((item) => item.checked)
    .map((item) => {
      const name = `${item.label} ${baseTask.name}`;
      return childTask(item.action, {
        name,
        nameEn: name,
        start: baseTask.start,
        end: baseTask.start,
        status: item.status || baseTask.status,
        info: "",
        label: item.label,
        pedEnabled: false,
        pedDate: ""
      });
    });

  const datedTasks: Task[] = [];
  if (controls.video.checked) {
    const videoDate = controls.videoDate.value || baseTask.start;
    datedTasks.push(childTask("video", {
      name: baseTask.name,
      nameEn: baseTask.nameEn,
      start: videoDate,
      end: videoDate,
      info: "",
      label: text("video-in-store"),
      pedEnabled: false,
      pedDate: ""
    }));
  }
  if (controls.sendVideoAlice.checked) {
    const sendVideoAliceDate = controls.sendVideoAliceDate.value || baseTask.start;
    const prefix = text("send-video-alice");
    datedTasks.push(childTask("send-video-alice", {
      name: `${prefix} ${baseTask.name}`,
      nameEn: `${englishLabel("send-video-alice")} ${baseTask.nameEn || baseTask.name}`,
      start: sendVideoAliceDate,
      end: sendVideoAliceDate,
      info: "",
      label: prefix,
      pedEnabled: false,
      pedDate: ""
    }));
  }
  if (controls.publish.checked) {
    const publishDate = controls.publishDate.value || baseTask.start;
    datedTasks.push(childTask("publish", {
      name: baseTask.name,
      nameEn: baseTask.nameEn,
      start: publishDate,
      end: publishDate,
      info: "",
      label: text("publication"),
      pedEnabled: false,
      pedAutoDismissed: false,
      pedDate: ""
    }));
  }
  return [...sameDayTasks, ...datedTasks];
}

/** Inserts generated creator tasks (same id replaces the previous child, keeping its createdAt). */
export function upsertCreatorGeneratedTasks(data: BoardData, generatedTasks: Task[] = []): void {
  data.tasks = data.tasks || [];
  generatedTasks.forEach((generatedTask) => {
    const index = data.tasks.findIndex((task) => task.id === generatedTask.id);
    if (index >= 0) data.tasks[index] = { ...data.tasks[index], ...generatedTask, createdAt: data.tasks[index].createdAt || generatedTask.createdAt };
    else data.tasks.push(generatedTask);
  });
}

/* ------------------------------------------------------------- PED mirroring */

export function linkedPedPostForTask(data: BoardData, taskId: string): PedPost | null {
  return (data.pedPosts || []).find((post) => post.sourceTaskId === taskId) || null;
}

/** Returns the PED post mirroring `task`, creating it when missing. */
export function ensurePedPostForTask(data: BoardData, task: Task | null | undefined, { syncFromTask = false } = {}): PedPost | null {
  if (!task) return null;
  data.pedPosts = data.pedPosts || [];
  let post = linkedPedPostForTask(data, task.id);
  const pedDate = task.pedDate || task.start;
  const pedTime = normalizeHour(task.pedTime || (shouldAutoCreatePedPost(task) ? "12:00" : "11:00"));
  if (!post) {
    const createdAt = now();
    post = makePedPost(data, {
      id: uniqueId(allIds(data), `ped${createdAt}`),
      sourceTaskId: task.id,
      title: task.nameEn || task.name,
      projectId: task.projectId || data.projects[0]?.id || "",
      date: pedDate,
      time: pedTime,
      status: data.pedStatuses[0] ? statusName(data.pedStatuses[0]) : (task.status || ""),
      members: task.members || [],
      social: [],
      format: pedFormatOptions[0],
      asset: "",
      copy: "",
      comments: [],
      subtasks: [],
      createdAt,
      updatedAt: createdAt
    });
    data.pedPosts.push(post);
    return post;
  }
  if (syncFromTask) {
    post.title = post.title || task.nameEn || task.name;
    post.projectId = task.projectId || post.projectId || data.projects[0]?.id || "";
    post.date = pedDate;
    post.time = post.time || pedTime;
    if (!(post.members || []).length) post.members = task.members || [];
    touchItem(post);
  }
  return post;
}

/**
 * Publication tasks always have a PED mirror. Returns true when anything changed.
 * The old app runs it after load and after every roll-over.
 */
export function syncAutomaticPedPostsForTasks(data: BoardData, tasks: Task[] = data.tasks || []): boolean {
  let changed = false;
  (tasks || []).forEach((task) => {
    if (!shouldAutoCreatePedPost(task)) return;
    // Prefer a PED date the user already set over the Start date; fall back to Start only for a task that has
    // never had a PED date at all.
    const expectedDate = task.pedDate || task.start || currentDateKey();
    if (!task.pedEnabled) {
      task.pedEnabled = true;
      changed = true;
    }
    if (task.pedDate !== expectedDate) {
      task.pedDate = expectedDate;
      changed = true;
    }
    if (!task.pedTime) {
      task.pedTime = "12:00";
      changed = true;
    }
    const beforeCount = (data.pedPosts || []).length;
    const post = ensurePedPostForTask(data, task, { syncFromTask: true });
    if ((data.pedPosts || []).length !== beforeCount) changed = true;
    if (post && post.date !== expectedDate) {
      post.date = expectedDate;
      touchItem(post);
      changed = true;
    }
  });
  return changed;
}

/** Deletes the PED mirror of a task (and dismisses the task's automatic PED entry). */
export function removeLinkedPedPostForTask(data: BoardData, taskId: string): void {
  const post = linkedPedPostForTask(data, taskId);
  if (post) deletePedPostById(data, post.id);
}

export function duplicateGanttTask(data: BoardData, task: Task | null | undefined): Task | null {
  if (!task) return null;
  const createdAt = now();
  const duplicate = makeTask(data, {
    ...structuredClone(task),
    id: uniqueId(allIds(data), `t${createdAt}-copy`),
    pedEnabled: false,
    pedAutoDismissed: false,
    pedDate: "",
    pedTime: "12:00",
    createdAt,
    updatedAt: createdAt,
    subtasks: (task.subtasks || []).map((subtask, index) => ({
      ...structuredClone(subtask),
      id: `s${createdAt}-${index}`
    }))
  });
  data.tasks.push(duplicate);
  return duplicate;
}

/* ------------------------------------------------------------- influencers */

export function isConfirmedInfluencer(row: { status?: unknown } | null | undefined): boolean {
  const status = String(row?.status || "").trim().toUpperCase();
  return ["BOOKED", "CONFIRMED", "CONFERMAT"].some((needle) => status.includes(needle));
}

export function isContactedInfluencer(row: { status?: unknown } | null | undefined): boolean {
  const status = String(row?.status || "").trim().toUpperCase();
  return status.includes("CONTACT") || status.includes("CONTATTAT");
}

export function isContactInfluencerStatus(status: unknown): boolean {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "TBC" || normalized === "TO CONTACT";
}

export function influencerTypeIsVisible(type: { name?: string; previewVisible?: boolean } | null | undefined, source: Pick<BoardData, "influencerPreviewVisibility">): boolean {
  const key = influencerOptionKey(type?.name);
  const visibility = source?.influencerPreviewVisibility || {};
  return Object.prototype.hasOwnProperty.call(visibility, key)
    ? Boolean(visibility[key])
    : Boolean(type?.previewVisible);
}

export function influencerProgressCounts(data: BoardData, type: { name: string }): { assigned: number; confirmed: number; contacted: number } {
  const assigned = (data.influencers || []).filter((row) => influencerOptionKey(row.type) === influencerOptionKey(type.name));
  return {
    assigned: assigned.length,
    confirmed: assigned.filter(isConfirmedInfluencer).length,
    contacted: assigned.filter(isContactedInfluencer).length
  };
}

/**
 * Keeps one "INFLUENCER <type> - x/y booked" Gantt task per visible influencer type that has a deadline, a project and
 * a target. Returns true when the board changed. The old app runs it after load, after status edits and every minute.
 */
export function syncInfluencerProgressTasks(data: BoardData): boolean {
  let changed = false;
  const types = data.influencerOptions?.type || [];
  types.forEach((type) => {
    let task: Task | null | undefined = type.progressTaskId ? (data.tasks || []).find((item) => item.id === type.progressTaskId) : null;
    if (!task) task = (data.tasks || []).find((item) => item.influencerProgressTypeKey === influencerOptionKey(type.name));
    const enabled = Boolean(influencerTypeIsVisible(type, data) && type.deadline && type.projectId && Number(type.needed) > 0 && validProjectId(data.projects, type.projectId));
    if (!enabled) {
      if (task) {
        deleteTaskById(data, task.id);
        changed = true;
      }
      if (type.progressTaskId) {
        type.progressTaskId = "";
        changed = true;
      }
      return;
    }
    const counts = influencerProgressCounts(data, type);
    const deadline = type.deadline as string;
    const taskDate = currentDateKey() <= deadline ? currentDateKey() : deadline;
    const taskName = `INFLUENCER ${type.name} — ${counts.confirmed}/${type.needed} booked · ${counts.contacted} contacted`;
    const payload = {
      projectId: type.projectId,
      name: taskName,
      nameEn: taskName,
      members: [],
      status: task?.status || contactTaskStatus(data),
      start: taskDate,
      end: taskDate,
      info: `Deadline ${deadline} · ${counts.assigned} assigned · ${counts.confirmed}/${type.needed} booked · ${counts.contacted} contacted`,
      label: "",
      pedEnabled: false,
      pedDate: "",
      influencerProgressTypeKey: influencerOptionKey(type.name),
      subtasks: []
    };
    if (task) {
      const before = stableDataString(task);
      Object.assign(task, payload);
      if (stableDataString(task) !== before) {
        touchItem(task);
        changed = true;
      }
    } else {
      const createdAt = now();
      task = makeTask(data, { id: uniqueId(allIds(data), `t${createdAt}-influencer-progress`), ...payload, createdAt, updatedAt: createdAt });
      data.tasks.push(task);
      changed = true;
    }
    if (type.progressTaskId !== task.id) {
      type.progressTaskId = task.id;
      changed = true;
    }
  });
  return changed;
}

/** Creates/updates/removes the "TO CONTACT <name>" Gantt task of an influencer row (row must belong to `data`). */
export function syncInfluencerContactTask(data: BoardData, row: Influencer): void {
  const existingId = row.contactTaskId || "";
  const existingTask = existingId ? data.tasks.find((task) => task.id === existingId) : null;
  if (!row.contactTaskEnabled) {
    if (existingTask) deleteTaskById(data, existingId);
    row.contactTaskId = "";
    return;
  }
  if (!row.contactDate || !row.contactMember || !row.name || !row.contactProjectId) return;
  const projectId = row.contactProjectId;
  if (!projectId) return;
  const taskName = `TO CONTACT ${row.name}`;
  const payload = {
    projectId,
    name: taskName,
    nameEn: taskName,
    members: [row.contactMember],
    status: existingTask?.status || contactTaskStatus(data),
    start: row.contactDate,
    end: row.contactDate,
    info: row.ttLink || row.igLink || "",
    label: "",
    pedEnabled: false,
    pedDate: "",
    subtasks: [],
    updatedAt: now()
  };
  if (existingTask) {
    Object.assign(existingTask, payload);
    touchItem(existingTask);
  } else {
    const createdAt = now();
    const task = makeTask(data, { id: uniqueId(allIds(data), `t${createdAt}-influencer-contact`), ...payload, createdAt, updatedAt: createdAt });
    data.tasks.push(task);
    row.contactTaskId = task.id;
  }
  touchItem(row);
}

export interface AddInfluencerToGanttOptions {
  action?: "contact" | "video-store";
  creatorStatus?: string;
  creatorStore?: string;
  creatorTime?: string;
}

/** Adds a "TO CONTACT" or "Video in store" Gantt task for an influencer. Returns the task, or null when inputs are missing. */
export function addInfluencerToGantt(
  data: BoardData,
  influencerId: string,
  projectId: string,
  member: string,
  date: string,
  options: AddInfluencerToGanttOptions & CreatorGenerationOptions = {}
): Task | null {
  const row = (data.influencers || []).find((item) => item.id === influencerId);
  if (!row || !projectId || !member || !date) return null;
  const action = options.action === "video-store" ? "video-store" : "contact";
  const createdAt = now();
  const taskName = action === "video-store"
    ? `Video in store ${row.name || "Influencer"}`
    : `TO CONTACT ${row.name || "Influencer"}`;
  const fields: Loose = {
    id: uniqueId(allIds(data), `t${createdAt}-influencer-gantt`),
    projectId,
    name: taskName,
    nameEn: taskName,
    members: [member],
    status: contactTaskStatus(data),
    start: date,
    end: date,
    info: row.ttLink || row.igLink || row.ttProfile || row.igProfile || "",
    label: action === "video-store" ? "Video in store" : (options.legacyLabels ? legacyLabel("contact") : englishLabel("contact")),
    pedEnabled: false,
    pedDate: "",
    pedTime: "12:00",
    subtasks: [],
    createdAt,
    updatedAt: createdAt
  };
  if (action === "video-store") {
    fields.creatorStatus = options.creatorStatus || ((data.creatorStatuses || [])[0] ? statusName(data.creatorStatuses[0]) : "");
    fields.creatorStore = options.creatorStore || "";
    fields.creatorTime = options.creatorTime || "10:00";
  }
  const task = makeTask(data, fields);
  if (action === "video-store") syncCreatorStatusToGantt(data, task);
  data.tasks.push(task);
  return task;
}

/** Puts an influencer row at the bottom of the table (new sortOrder). */
export function moveInfluencerToBottom(data: BoardData, rowId: string): void {
  data.influencers = data.influencers || [];
  const index = data.influencers.findIndex((item) => item.id === rowId);
  if (index < 0) return;
  const [row] = data.influencers.splice(index, 1);
  row.sortOrder = nextInfluencerSortOrder(data, rowId);
  touchItem(row);
  data.influencers.push(row);
}

export function nextInfluencerSortOrder(data: BoardData, rowId = ""): number {
  const maxSort = Math.max(0, ...(data.influencers || [])
    .filter((item) => item.id !== rowId)
    .map((row) => (Number.isFinite(Number(row?.sortOrder)) ? Number(row.sortOrder) : 0)));
  return maxSort + 1;
}

/**
 * Inline edit of one influencer cell (port of updateInfluencerInlineValue): status changes maintain
 * influencerUpdatedAt/contactedAt, drop the contact task when the status is no longer "to contact", and
 * the row moves to the bottom; the progress tasks are re-synced.
 */
export function setInfluencerField(data: BoardData, rowId: string, key: string, value: string, todayKey = currentDateKey()): void {
  const row = (data.influencers || []).find((item) => item.id === rowId) as Loose;
  if (!row || !key) return;
  const previousValue = row[key] || "";
  const previousStatus = String(row.status || "").trim().toUpperCase();
  row[key] = value;
  if (key === "status") {
    const nextStatus = String(value || "").trim().toUpperCase();
    row.influencerUpdatedAt = todayKey;
    if (nextStatus === "CONTACTED" && previousStatus !== "CONTACTED") row.contactedAt = todayKey;
    if (nextStatus !== "CONTACTED") row.contactedAt = "";
    if (!isContactInfluencerStatus(value) && row.contactTaskEnabled) {
      row.contactTaskEnabled = false;
      syncInfluencerContactTask(data, row);
    }
  }
  if (String(value || "") !== String(previousValue || "")) moveInfluencerToBottom(data, rowId);
  syncInfluencerProgressTasks(data);
}

/* ---------------------------------------------------------------- PED <-> Gantt */

/** The PED post for a context menu action: the linked post of a task (or a virtual one), or a manual post. */
export function pedPostSourceFromContext(data: BoardData, taskId = "", postId = ""): (Partial<PedPost> & { subtasks: PedPost["subtasks"] }) | null {
  if (taskId) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    const linkedPost = linkedPedPostForTask(data, task.id);
    if (linkedPost) return linkedPost;
    return {
      id: "",
      sourceTaskId: task.id,
      title: task.nameEn || task.name || "PED post",
      projectId: task.projectId || data.projects[0]?.id || "",
      date: task.pedDate || task.start || currentDateKey(),
      time: normalizeHour(task.pedTime || "11:00"),
      status: data.pedStatuses[0] ? statusName(data.pedStatuses[0]) : task.status,
      members: task.members || [],
      social: [],
      format: pedFormatOptions[0],
      asset: "",
      assetItems: [],
      copy: "",
      subtasks: task.subtasks || []
    };
  }
  return (data.pedPosts || []).find((item) => item.id === postId) || null;
}

/**
 * "Add to PED" on a Gantt task (no postId): enables the task's PED entry on that date/time and ensures the mirror post.
 * With a postId (or a PED-only item) it creates a COPY of the post on the chosen date/time. Returns false when the
 * date is invalid or the source is missing.
 */
export function addPedItemToPed(data: BoardData, taskId: string, postId: string, selectedDate: string, selectedTime?: string): boolean {
  if (!selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return false;
  if (taskId && !postId) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    task.pedEnabled = true;
    task.pedAutoDismissed = false;
    task.pedDate = selectedDate;
    task.pedTime = normalizeHour(selectedTime || "12:00");
    touchItem(task);
    const post = ensurePedPostForTask(data, task, { syncFromTask: true });
    if (post) {
      post.date = selectedDate;
      post.time = normalizeHour(selectedTime || task.pedTime || "12:00");
      touchItem(post);
    }
    return true;
  }
  const sourcePost = pedPostSourceFromContext(data, taskId, postId);
  if (!sourcePost) return false;
  const createdAt = now();
  data.pedPosts = data.pedPosts || [];
  data.pedPosts.push(makePedPost(data, {
    id: uniqueId(allIds(data), `ped${createdAt}-copy`),
    sourceTaskId: "",
    title: sourcePost.title || "PED post",
    projectId: sourcePost.projectId || data.projects[0]?.id || "",
    date: selectedDate,
    time: normalizeHour(selectedTime || "12:00"),
    status: sourcePost.status || (data.pedStatuses[0] ? statusName(data.pedStatuses[0]) : ""),
    members: structuredClone(sourcePost.members || []),
    social: structuredClone(sourcePost.social || []),
    format: normalizePedFormat(sourcePost.format),
    asset: sourcePost.asset || "",
    copy: sourcePost.copy || "",
    comments: structuredClone(sourcePost.comments || []),
    subtasks: structuredClone(sourcePost.subtasks || []),
    createdAt,
    updatedAt: createdAt
  }));
  return true;
}

/** Duplicates a PED item (a task's PED entry or a manual post) on the same date/time. Returns false when the source is missing. */
export function duplicatePedItem(data: BoardData, taskId = "", postId = ""): boolean {
  const sourcePost = pedPostSourceFromContext(data, taskId, postId);
  if (!sourcePost) return false;
  const createdAt = now();
  data.pedPosts = data.pedPosts || [];
  data.pedPosts.push(makePedPost(data, {
    id: uniqueId(allIds(data), `ped${createdAt}-copy`),
    sourceTaskId: "",
    title: sourcePost.title || "PED post",
    projectId: sourcePost.projectId || data.projects[0]?.id || "",
    date: sourcePost.date || currentDateKey(),
    time: normalizeHour(sourcePost.time || "12:00"),
    status: sourcePost.status || (data.pedStatuses[0] ? statusName(data.pedStatuses[0]) : ""),
    members: structuredClone(sourcePost.members || []),
    social: structuredClone(sourcePost.social || []),
    format: normalizePedFormat(sourcePost.format),
    asset: sourcePost.asset || "",
    assetItems: structuredClone(sourcePost.assetItems || []),
    copy: sourcePost.copy || "",
    comments: structuredClone(sourcePost.comments || []),
    subtasks: structuredClone(sourcePost.subtasks || []),
    createdAt,
    updatedAt: createdAt
  }));
  return true;
}

/**
 * "Add to Gantt" for a PED item: with a taskId it moves that task to the date; with a postId it creates a Gantt task from
 * the post and links the post to it. Returns the moved/created task, or null.
 */
export function addPedItemToGantt(data: BoardData, taskId: string, postId: string, selectedDate: string): Task | null {
  if (!selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return null;
  if (taskId) {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    task.start = selectedDate;
    task.end = selectedDate;
    touchItem(task);
    return task;
  }
  const post = (data.pedPosts || []).find((item) => item.id === postId);
  if (!post) return null;
  const createdAt = now();
  const newTaskId = uniqueId(allIds(data), `t${createdAt}-ped-gantt`);
  const task = makeTask(data, {
    id: newTaskId,
    projectId: post.projectId || (data.projects || [])[0]?.id || "",
    name: post.title || "PED post",
    nameEn: post.title || "PED post",
    members: post.members || [],
    status: data.statuses[0] ? statusName(data.statuses[0]) : "",
    start: selectedDate,
    end: selectedDate,
    info: post.asset || post.copy || "",
    label: "",
    pedEnabled: true,
    pedDate: post.date || selectedDate,
    pedTime: normalizeHour(post.time),
    subtasks: post.subtasks || [],
    createdAt,
    updatedAt: createdAt
  });
  data.tasks.push(task);
  post.sourceTaskId = newTaskId;
  touchItem(post);
  return task;
}
