/**
 * Synthetic fixtures for the differential tests. Nothing here is real team data: names are generic
 * ("Creator One", "Member A"...). The shapes deliberately include legacy spellings, missing fields, tombstones in
 * both stored forms, unknown extra fields and the workflow labels the old app stored in Italian.
 */

/** 2026-06-10 10:30 local time (a Wednesday). */
export const FIXED_NOW = new Date(2026, 5, 10, 10, 30, 0).getTime();
/** `m` minutes before FIXED_NOW (smaller = more recent). */
export const T = (m: number): number => FIXED_NOW - m * 60000;

export type Raw = Record<string, unknown>;

export function localDate(y: number, month: number, d: number, h = 0, min = 0): number {
  return new Date(y, month - 1, d, h, min, 0).getTime();
}

/* ---------------------------------------------------------------------------------------------- */
/* 1. A legacy-rich board, as an old writer could have left it in Firestore                       */
/* ---------------------------------------------------------------------------------------------- */
export const legacyBoard: Raw = {
  members: ["Member A", "Member B", "Giorgia", "Member A"],
  statuses: ["TO DO", { name: "In progress", color: "#147bd1" }, "DONE", { name: "Blocked: waiting" }],
  pedStatus: ["Draft", "Ready"],
  creatorStatuses: [{ name: "Scheduled" }, { name: "Confirmed", color: "#bbf7d0" }, "Video shot"],
  creatorStores: ["Store One", "Store Two"],
  labels: ["creator", "Contattare", "Brief", "Pubblicazione", "Video in store", "Contattare", "Mandare video ad Alice"],
  formats: ["whatever"],
  socials: ["Instagram", { name: "TikTok" }, { id: "yt", label: "YouTube", short: "yt", color: "#ff0000" }],
  projects: [
    { id: "p1", name: "Project One", color: "#123456" },
    { id: "p-extra", name: "Project Extra", color: "#654321", owner: "Member A" }
  ],
  tasks: [
    {
      id: "t1", projectId: "p1", name: "Creator Alpha", nameEn: "", members: ["Member A"], status: "TO DO",
      start: "2026-06-08", end: "2026-06-09", label: "creator", info: "link", createdAt: T(3000), updatedAt: T(900)
    },
    {
      id: "t1-creator-contact", creatorParentId: "t1", creatorAction: "contact", projectId: "p1",
      name: "Contattare Creator Alpha", nameEn: "Contattare Creator Alpha", members: ["Member A"], status: "TO DO",
      start: "2026-06-08", end: "2026-06-08", label: "Contattare", createdAt: T(3000), updatedAt: T(800)
    },
    {
      id: "t1-creator-video", creatorParentId: "t1", creatorAction: "video", projectId: "p1", name: "Creator Alpha",
      members: ["Member A"], status: "In progress", start: "2026-06-11", end: "2026-06-11", label: "Video in store",
      creatorStatus: "Confirmed", creatorStore: "Store One", creatorTime: "15:30", updatedAt: T(700)
    },
    {
      id: "t1-creator-publish", creatorParentId: "t1", creatorAction: "publish", projectId: "p1", name: "Creator Alpha",
      nameEn: "Creator Alpha", members: ["Member B"], status: "TO DO", start: "2026-06-12", label: "Pubblicazione",
      createdAt: T(3000)
    },
    { id: "t-home", projectId: "p1", name: "Legacy home flag", hasHomeLabel: true, start: "2026-06-15", status: "DONE", updatedAt: T(60) },
    {
      id: "t-plain", projectId: "unknown-project", name: "Plain task", members: ["Member B"], status: "TO DO",
      start: "2026-06-10", subtasks: [{ id: "s1", title: "First", members: ["Member B"], done: true }, { title: "No id", done: 0 }],
      pedSocial: ["instagram"], pedAssetItems: [{ type: "image", src: "x.png" }], updatedAt: T(30)
    },
    {
      id: "t-dismissed", projectId: "p1", name: "Dismissed publication", status: "TO DO", start: "2026-06-09",
      label: "Pubblicazione", pedAutoDismissed: true, updatedAt: T(40)
    },
    {
      id: "t-extra", projectId: "p-extra", name: "Has unknown fields", status: "TO DO", start: "2026-06-20", end: "2026-06-22",
      futureField: { nested: [1, 2, { three: 3 }] }, anotherField: "kept", influencerProgressTypeKey: "creator", updatedAt: T(20)
    },
    { projectId: "p1", name: "No id: dropped" },
    { id: "tdeleted", projectId: "p1", name: "Tombstoned", start: "2026-06-01", status: "TO DO" }
  ],
  pedPosts: [
    {
      id: "ped1", sourceTaskId: "t1-creator-publish", title: "Creator Alpha", projectId: "p1", date: "2026-06-12", time: "12:00",
      status: "Draft", members: ["Member B"], format: "reel", social: ["instagram", "tiktok", "custom"], link: "https://example.test/asset",
      copy: "Copy text", updatedAt: T(500),
      comments: [
        { id: "c1", text: "Hi @Member A", mentions: ["Member A"], createdAt: T(600) },
        { id: "c2", text: "   ", createdAt: T(590) },
        { text: "No id and no createdAt" }
      ],
      subtasks: [{ title: "Subtask without id" }, { id: "ps9", title: "With id", done: 1, members: ["Member A"] }]
    },
    { id: "ped2", title: "Manual post", project: "project one", date: "2026-06-13", time: "9:30", status: "Ready", format: "carosello", updatedAt: T(400) },
    { id: "ped3", title: "Late slot", projectId: "p1", date: "2026-06-14", time: "21:15", format: "story", social: "not-an-array", assetItems: [{ type: "video", src: "v.mp4" }] },
    { title: "Post without id and date", projectId: "nope" },
    { id: "pdeleted", title: "Tombstoned post", date: "2026-06-01" }
  ],
  influencers: [
    { id: "i1", NAME: "Creator One", STATUS: "TBC", CITY: "Rome", TYPE: "Creator", "TT PROFILE": "@one", sortOrder: 2, updatedAt: T(300) },
    { id: "i2", name: "Creator Two", status: "CONTACTED", influencerUpdatedAt: "2026-04-01", type: "UGC", city: "Milan", sortOrder: 1 },
    { id: "i3", name: "Creator Three", status: "CONTACTED", price: "100", fieldUpdatedAt: { name: T(10) }, where: "Paris", influencerSortOrder: 3 },
    { id: "i4" },
    { id: "i5", name: "Deleted One" },
    { name: "No id row", city: "Rome" }
  ],
  influencerFieldLedger: {
    i1: { name: { value: "Creator One (ledger)", updatedAt: T(5) }, bogus: null, updatedAt: { value: 1, updatedAt: 1 } },
    "": { x: { value: 1, updatedAt: 1 } }
  },
  influencerOptions: {
    city: ["Rome", { name: "Paris", color: "#e0f2fe" }, { label: "Milan" }],
    type: [
      { name: "Creator", needed: 3.7, previewVisible: true, previewUpdatedAt: T(100), deadline: "2026-07-01", projectId: "p1" },
      "UGC"
    ],
    status: ["TO CONTACT", { name: "Ghosted", color: "#e5e7eb", textColor: "#222222" }]
  },
  influencerDeletedOptions: { city: ["Paris"], where: ["paris"] },
  influencerPreviewVisibility: { creator: true },
  influencerTypeProgressConfig: { ugc: { needed: { value: 2, updatedAt: T(30) }, junk: { value: 1 } } },
  influencerColumnLabels: { name: "Creator" },
  settingsUpdatedAt: { members: T(50), labels: T(10) },
  deletedIds: { tasks: ["tdeleted"], pedPosts: { pdeleted: T(100) }, influencers: { i5: T(20) } },
  futureTopLevel: { x: 1, list: ["a", "b"] }
};

/** Minimal inputs for normalizeData. */
export const normalizeInputs: Array<{ name: string; input: unknown }> = [
  { name: "normalize/null", input: null },
  { name: "normalize/empty-object", input: {} },
  { name: "normalize/legacy-rich", input: legacyBoard },
  {
    name: "normalize/pedStatuses-wins-over-legacy-key",
    input: { pedStatuses: [{ name: "Only", color: "#000000" }], pedStatus: ["Ignored"], statuses: [] }
  },
  {
    name: "normalize/unknown-extras-roundtrip",
    input: {
      tasks: [{ id: "x1", name: "Extra task", start: "2026-06-10", brandNewField: { a: [1, 2] } }],
      projects: [{ id: "px", name: "PX", color: "#111111", hidden: true }],
      someFutureCollection: [{ id: "f1" }],
      futureSettings: { enabled: true }
    }
  }
];

/* ---------------------------------------------------------------------------------------------- */
/* 2. Two divergent copies for the merge                                                          */
/* ---------------------------------------------------------------------------------------------- */
const baseTask = (id: string, extra: Raw = {}): Raw => ({
  id, projectId: "p1", name: `Task ${id}`, status: "TO DO", start: "2026-06-10", end: "2026-06-10", members: [], ...extra
});

export const mergeLocal: Raw = {
  members: ["Member A", "Member B"],
  statuses: [{ name: "TO DO", color: "#111111" }, { name: "DONE", color: "#222222" }],
  labels: ["creator", "Contattare", "Local only"],
  creatorStores: ["Store One"],
  projects: [{ id: "p1", name: "Project One (renamed locally)", color: "#123456" }, { id: "p-local", name: "Local Project", color: "#abcdef" }],
  socials: [{ id: "instagram", label: "Instagram", short: "IG", color: "#e1306c" }],
  settingsUpdatedAt: { members: T(5), statuses: T(20), labels: T(50), projects: T(5), influencerOptions: T(10), influencerDeletedOptions: T(10) },
  tasks: [
    baseTask("tA", { name: "tA local older", updatedAt: T(10) }),
    baseTask("tB", { name: "tB local newer", updatedAt: T(2) }),
    baseTask("tC", { name: "tC equal time local wins", updatedAt: T(7) }),
    baseTask("tD", { name: "tD only local", updatedAt: T(1) }),
    baseTask("tF", { name: "tF deleted remotely", updatedAt: T(1) }),
    baseTask("tG", { name: "tG deleted locally", updatedAt: T(1) }),
    baseTask("tH", { name: "tH zero time local" }),
    baseTask("tK", { name: "tK extra local", futureField: "local", updatedAt: T(3) })
  ],
  pedPosts: [
    { id: "pA", title: "pA local", projectId: "p1", date: "2026-06-12", updatedAt: T(4) },
    { id: "pB", title: "pB local older", projectId: "p1", date: "2026-06-12", updatedAt: T(40), comments: [{ id: "c1", text: "local comment", createdAt: T(41) }] },
    { id: "pL", title: "pL only local", projectId: "p1", date: "2026-06-12", updatedAt: T(2) }
  ],
  influencers: [
    { id: "i1", name: "Creator One", status: "CONTACTED", city: "Rome", price: "50", sortOrder: 1, updatedAt: T(3), fieldUpdatedAt: { status: T(3), name: T(100), city: T(100), price: T(100) } },
    { id: "i2", name: "Local Two", city: "Milan", sortOrder: 2, updatedAt: T(8), fieldUpdatedAt: { name: T(8) } },
    { id: "i-local", name: "Only Local", sortOrder: 3, updatedAt: T(1) }
  ],
  influencerFieldLedger: {
    i1: { status: { value: "CONTACTED", updatedAt: T(3) }, city: { value: "Rome", updatedAt: T(100) } }
  },
  influencerOptions: {
    city: [{ name: "Rome", color: "#dbeafe" }],
    type: [
      { name: "Creator", needed: 2, previewVisible: true, previewUpdatedAt: T(5), deadline: "", projectId: "" },
      { name: "UGC", previewVisible: false, previewUpdatedAt: T(90) }
    ]
  },
  influencerDeletedOptions: { city: ["Berlin"], type: [] },
  influencerPreviewVisibility: { creator: true },
  influencerColumnLabels: { name: "Creator (local)" },
  influencerTypeProgressConfig: { creator: { needed: { value: 5, updatedAt: T(5) }, visible: { value: true, updatedAt: T(500) } } },
  deletedIds: { tasks: { tG: T(1) }, pedPosts: {}, influencers: {} },
  localOnlyTopLevel: { keep: true }
};

export const mergeRemote: Raw = {
  members: ["Member A", "Member C"],
  statuses: [{ name: "DONE", color: "#333333" }, { name: "TO DO", color: "#444444" }, { name: "Review", color: "#555555" }],
  labels: ["creator", "Remote only", "Contattare"],
  creatorStores: ["Store One", "Store Remote"],
  projects: [{ id: "p1", name: "Project One", color: "#123456" }, { id: "p-remote", name: "Remote Project", color: "#fedcba" }],
  socials: [{ id: "instagram", label: "Instagram", short: "IG", color: "#e1306c" }, { id: "tiktok", label: "TikTok", short: "TT", color: "#111827" }],
  settingsUpdatedAt: { members: T(15), statuses: T(10), labels: T(50), projects: T(15), influencerOptions: T(10), influencerDeletedOptions: T(10) },
  tasks: [
    baseTask("tA", { name: "tA remote newer", updatedAt: T(5) }),
    baseTask("tB", { name: "tB remote older", updatedAt: T(8) }),
    baseTask("tC", { name: "tC equal time remote loses", updatedAt: T(7) }),
    baseTask("tE", { name: "tE only remote", updatedAt: T(1) }),
    baseTask("tF", { name: "tF deleted remotely (still listed)", updatedAt: T(30) }),
    baseTask("tG", { name: "tG live remote", updatedAt: T(30) }),
    baseTask("tH", { name: "tH zero time remote" }),
    baseTask("tK", { name: "tK extra remote", futureField: "remote", updatedAt: T(30) })
  ],
  pedPosts: [
    { id: "pA", title: "pA remote older", projectId: "p1", date: "2026-06-13", updatedAt: T(30) },
    { id: "pB", title: "pB remote newer", projectId: "p1", date: "2026-06-12", updatedAt: T(6), comments: [{ id: "c2", text: "remote comment", createdAt: T(7) }] },
    { id: "pR", title: "pR only remote", projectId: "p1", date: "2026-06-12", updatedAt: T(3) }
  ],
  influencers: [
    { id: "i1", name: "Creator One", status: "TO CONTACT", city: "Naples", price: "70", sortOrder: 1, updatedAt: T(4), fieldUpdatedAt: { city: T(4), price: T(4), status: T(200), name: T(100) } },
    { id: "i2", name: "Remote Two", city: "Milan", sortOrder: 5, updatedAt: T(2), fieldUpdatedAt: { name: T(2) } },
    { id: "i-remote", name: "Only Remote", sortOrder: 0, updatedAt: T(1) }
  ],
  influencerFieldLedger: {
    i1: { city: { value: "Naples", updatedAt: T(4) }, price: { value: "70", updatedAt: T(4) }, status: { value: "TO CONTACT", updatedAt: T(200) } }
  },
  influencerOptions: {
    city: [{ name: "Rome", color: "#dcfce7" }, { name: "Naples" }],
    type: [
      { name: "Creator", needed: 4, previewVisible: false, previewUpdatedAt: T(50), deadline: "2026-08-01", projectId: "p1" },
      { name: "UGC", previewVisible: true, previewUpdatedAt: T(20) }
    ]
  },
  influencerDeletedOptions: { city: ["Madrid"], type: ["Old"] },
  influencerPreviewVisibility: { creator: false, ugc: true },
  influencerColumnLabels: { name: "Creator (remote)", city: "Town" },
  influencerTypeProgressConfig: { creator: { needed: { value: 3, updatedAt: T(50) }, visible: { value: false, updatedAt: T(5) }, deadline: { value: "2026-08-01", updatedAt: T(50) } } },
  deletedIds: { tasks: { tF: T(2) }, pedPosts: {}, influencers: {} },
  remoteOnlyTopLevel: { keep: "remote" }
};

/** Same time stamps on both sides for every setting (the old app's tie-break). */
export const mergeTieLocal: Raw = {
  members: ["A", "B"], statuses: ["TO DO", "DONE"], labels: ["x", "y"], settingsUpdatedAt: { members: T(5), statuses: T(5), labels: T(5), influencerDeletedOptions: T(5) },
  influencerDeletedOptions: { city: ["a"] }, influencerPreviewVisibility: { a: true }
};
export const mergeTieRemote: Raw = {
  members: ["B", "C"], statuses: ["DONE", "Review"], labels: ["y", "z"], settingsUpdatedAt: { members: T(5), statuses: T(5), labels: T(5), influencerDeletedOptions: T(5) },
  influencerDeletedOptions: { city: ["b"] }, influencerPreviewVisibility: { b: false }
};

/* ---------------------------------------------------------------------------------------------- */
/* 3. stampChangedData: previous (last committed) vs current (edited)                             */
/* ---------------------------------------------------------------------------------------------- */
export const stampPrevious: Raw = {
  members: ["Member A"], labels: ["creator"],
  statuses: [{ name: "TO DO", color: "#6b7280" }, { name: "DONE", color: "#e4572e" }],
  tasks: [baseTask("a", { updatedAt: T(100) }), baseTask("b", { updatedAt: T(100) }), baseTask("c", { createdAt: T(500), updatedAt: T(100) })],
  pedPosts: [{ id: "p1", title: "Post", projectId: "p1", date: "2026-06-12", updatedAt: T(100) }],
  influencers: [
    { id: "i1", name: "Creator One", city: "Rome", status: "TO CONTACT", sortOrder: 1, updatedAt: T(90) },
    { id: "i2", name: "Creator Two", sortOrder: 2, updatedAt: T(80), fieldUpdatedAt: { name: T(70) } }
  ],
  influencerFieldLedger: { i1: { city: { value: "Rome", updatedAt: T(90) } } }
};

export const stampCurrent: Raw = {
  members: ["Member A", "Member B"], labels: ["creator"],
  statuses: [{ name: "TO DO", color: "#6b7280" }, { name: "DONE", color: "#00ff00" }],
  tasks: [
    baseTask("a", { updatedAt: T(100) }),
    baseTask("b", { name: "b edited", updatedAt: T(100) }),
    baseTask("c", { createdAt: T(500), updatedAt: T(100) }),
    baseTask("new-with-created", { createdAt: T(1) }),
    baseTask("new-without-times")
  ],
  pedPosts: [{ id: "p1", title: "Post edited", projectId: "p1", date: "2026-06-12", updatedAt: T(100) }, { id: "p2", title: "New post", projectId: "p1", date: "2026-06-12" }],
  influencers: [
    { id: "i1", name: "Creator One", city: "Milan", status: "TO CONTACT", sortOrder: 1, updatedAt: T(90) },
    { id: "i2", name: "Creator Two", sortOrder: 2, updatedAt: T(80), fieldUpdatedAt: { name: T(70) } },
    { id: "i3", name: "Creator Three", sortOrder: 3 }
  ],
  influencerFieldLedger: { i1: { city: { value: "Rome", updatedAt: T(90) } }, i9: { name: { value: "x", updatedAt: T(1) } } }
};

/* ---------------------------------------------------------------------------------------------- */
/* 4. Creator workflow controls                                                                   */
/* ---------------------------------------------------------------------------------------------- */
export interface ControlsInput {
  contact?: boolean; askOk?: boolean; contract?: boolean; brief?: boolean; giorgia?: boolean;
  video?: boolean; videoDate?: string; sendVideoAlice?: boolean; sendVideoAliceDate?: string; publish?: boolean; publishDate?: string;
}

export function controls(input: ControlsInput = {}): Raw {
  return {
    contact: { checked: Boolean(input.contact) },
    askOk: { checked: Boolean(input.askOk) },
    contract: { checked: Boolean(input.contract) },
    brief: { checked: Boolean(input.brief) },
    giorgia: { checked: Boolean(input.giorgia) },
    video: { checked: Boolean(input.video) },
    videoDate: { value: input.videoDate || "" },
    sendVideoAlice: { checked: Boolean(input.sendVideoAlice) },
    sendVideoAliceDate: { value: input.sendVideoAliceDate || "" },
    publish: { checked: Boolean(input.publish) },
    publishDate: { value: input.publishDate || "" }
  };
}

export const creatorBase: Raw = {
  id: "t-creator", projectId: "p1", name: "Creator Beta", nameEn: "Creator Beta EN", members: ["Member A"], status: "TO DO",
  start: "2026-06-10", end: "2026-06-12", label: "creator", info: "some link", pedEnabled: false, pedDate: ""
};

export const creatorCases: Array<{ name: string; base: Raw; createdAt: number; controls: Raw }> = [
  { name: "creator/all-on", base: creatorBase, createdAt: T(0), controls: controls({ contact: true, askOk: true, contract: true, brief: true, giorgia: true, video: true, videoDate: "2026-06-18", sendVideoAlice: true, sendVideoAliceDate: "2026-06-19", publish: true, publishDate: "2026-06-20" }) },
  { name: "creator/default-dates", base: creatorBase, createdAt: T(0), controls: controls({ video: true, sendVideoAlice: true, publish: true }) },
  { name: "creator/same-day-only", base: creatorBase, createdAt: T(0), controls: controls({ contact: true, brief: true }) },
  { name: "creator/nothing-checked", base: creatorBase, createdAt: T(0), controls: controls() },
  { name: "creator/not-a-creator-task", base: { ...creatorBase, label: "Pubblicazione" }, createdAt: T(0), controls: controls({ contact: true }) },
  { name: "creator/no-id-and-no-nameEn", base: { ...creatorBase, id: "", nameEn: "" }, createdAt: T(15), controls: controls({ contact: true, sendVideoAlice: true, publish: true }) },
  { name: "creator/uppercase-label", base: { ...creatorBase, label: " Creator " }, createdAt: T(0), controls: controls({ giorgia: true }) }
];

/* ---------------------------------------------------------------------------------------------- */
/* 5. Roll-over                                                                                   */
/* ---------------------------------------------------------------------------------------------- */
export const rolloverBoard: Raw = {
  statuses: [{ name: "TO DO", color: "#6b7280" }, { name: "DONE", color: "#e4572e" }, { name: "Blocked", color: "#ff0000" }],
  tasks: [
    baseTask("r-todo-single", { start: "2026-06-08", end: "2026-06-08", updatedAt: T(500) }),
    baseTask("r-todo-multi", { start: "2026-06-05", end: "2026-06-08", updatedAt: T(500) }),
    baseTask("r-done", { start: "2026-06-05", end: "2026-06-05", status: "DONE", updatedAt: T(500) }),
    baseTask("r-done-spaced", { start: "2026-06-05", status: " do ne ", updatedAt: T(500) }),
    baseTask("r-blocked", { start: "2026-06-05", end: "2026-06-05", status: "Blocked by client", updatedAt: T(500) }),
    baseTask("r-no-start", { start: "", end: "" }),
    baseTask("r-progress-influencer-progress", { start: "2026-06-01", end: "2026-06-01" }),
    baseTask("r-future", { start: "2026-06-30", end: "2026-06-30" }),
    baseTask("r-today", { start: "2026-06-10", end: "2026-06-10" }),
    baseTask("r-publication", { start: "2026-06-04", end: "2026-06-04", label: "Pubblicazione", pedTime: "" }),
    baseTask("r-publication-dismissed", { start: "2026-06-04", end: "2026-06-04", label: "Pubblicazione", pedAutoDismissed: true }),
    baseTask("r-no-end", { start: "2026-06-02" })
  ],
  pedPosts: []
};

export const rolloverNows: Array<{ name: string; now: number }> = [
  { name: "wed-10-30", now: localDate(2026, 6, 10, 10, 30) },
  { name: "wed-20-05", now: localDate(2026, 6, 10, 20, 5) },
  { name: "fri-21-00", now: localDate(2026, 6, 12, 21, 0) },
  { name: "sat-09-00", now: localDate(2026, 6, 13, 9, 0) },
  { name: "sun-23-59", now: localDate(2026, 6, 14, 23, 59) },
  { name: "mon-00-00", now: localDate(2026, 6, 15, 0, 0) },
  { name: "year-end-thu-20-00", now: localDate(2026, 12, 31, 20, 0) }
];

/* ---------------------------------------------------------------------------------------------- */
/* 6. Board used by the cross-view helper cases (labels.ts)                                       */
/* ---------------------------------------------------------------------------------------------- */
export const opsBoard: Raw = {
  statuses: [{ name: "TO DO", color: "#6b7280" }, { name: "In progress", color: "#147bd1" }, { name: "DONE", color: "#e4572e" }],
  pedStatuses: [{ name: "Draft", color: "#0f172a" }, { name: "Ready", color: "#2563eb" }],
  creatorStatuses: [{ name: "Scheduled", color: "#dbeafe" }, { name: "Confirmed", color: "#dcfce7" }],
  members: ["Member A", "Member B"],
  projects: [{ id: "p-customer-care", name: "Customer Care", color: "#0f9f6e" }, { id: "p1", name: "Project One", color: "#123456" }],
  tasks: [
    { id: "t-pub", projectId: "p1", name: "Publication task", nameEn: "Publication EN", members: ["Member A"], status: "TO DO", start: "2026-06-12", end: "2026-06-12", label: "Pubblicazione", updatedAt: T(200), subtasks: [{ id: "s1", title: "Sub", done: false }] },
    { id: "t-pub-linked", projectId: "p1", name: "Linked publication", members: [], status: "TO DO", start: "2026-06-13", label: "Pubblicazione", pedDate: "2026-06-14", updatedAt: T(200) },
    { id: "t-plain", projectId: "p1", name: "Plain task", members: ["Member B"], status: "TO DO", start: "2026-06-11", end: "2026-06-11", updatedAt: T(100), info: "plain link" },
    { id: "t-vid", projectId: "p1", name: "Video task", status: "TO DO", start: "2026-06-11", label: "Video in store", creatorStatus: "Confirmed", updatedAt: T(100) },
    { id: "t-contact", projectId: "p-customer-care", name: "TO CONTACT Creator One", status: "In progress", start: "2026-06-09", end: "2026-06-09", members: ["Member A"], updatedAt: T(100) },
    { id: "t-progress-old", projectId: "p1", name: "old progress", status: "DONE", start: "2026-06-01", influencerProgressTypeKey: "ugc", updatedAt: T(100) }
  ],
  pedPosts: [
    { id: "ped-linked", sourceTaskId: "t-pub-linked", title: "Linked publication", projectId: "p1", date: "2026-06-14", time: "12:00", status: "Draft", members: ["Member A"], updatedAt: T(100) },
    { id: "ped-manual", title: "Manual post", projectId: "p1", date: "2026-06-15", time: "14:30", status: "Ready", members: ["Member B"], social: ["instagram"], format: "Carousel", asset: "https://example.test/a", copy: "copy", assetItems: [{ type: "image", src: "i.png", fallback: "", original: "i.png", label: "" }], comments: [{ id: "c1", text: "note", createdAt: T(50) }], subtasks: [{ id: "ps1", title: "do", done: true, members: [] }], updatedAt: T(100) }
  ],
  influencers: [
    { id: "i1", name: "Creator One", city: "Rome", type: "Creator", status: "TO CONTACT", ttLink: "https://tt.example/one", igLink: "", ttProfile: "@one", sortOrder: 1, contactTaskEnabled: true, contactTaskId: "t-contact", contactDate: "2026-06-09", contactMember: "Member A", contactProjectId: "p-customer-care", updatedAt: T(100) },
    { id: "i2", name: "Creator Two", type: "Creator", status: "Booked ✅", sortOrder: 2, updatedAt: T(100) },
    { id: "i3", name: "Creator Three", type: "UGC", status: "CONTACTED", sortOrder: 3, igProfile: "@three", influencerUpdatedAt: "2026-06-05", contactedAt: "2026-06-05", updatedAt: T(100) },
    { id: "i4", name: "Creator Four", type: "Creator", status: "Confermato", sortOrder: 4, updatedAt: T(100) }
  ],
  influencerOptions: {
    type: [
      { name: "Creator", needed: 4, previewVisible: true, deadline: "2026-06-30", projectId: "p1", progressTaskId: "" },
      { name: "UGC", needed: 2, previewVisible: true, deadline: "2026-06-20", projectId: "p1", progressTaskId: "t-progress-old" },
      { name: "VIP", needed: 1, previewVisible: false, deadline: "2026-06-20", projectId: "p1", progressTaskId: "" }
    ],
    status: ["TO CONTACT", "CONTACTED", "Booked ✅"]
  },
  influencerPreviewVisibility: { creator: true, ugc: true, vip: false }
};
