/**
 * DEV ONLY. Fills the *demo* backend (browser localStorage, never Firebase) with clearly synthetic content so the UI can
 * be looked at with data in it. Loaded only from main.tsx behind `import.meta.env.DEV` and `?demo=1&seed=1`, so it is
 * not part of production builds. Nothing here is real O'Tacos data.
 */
import { DEMO_STORAGE_KEY } from "../data/demoBackend";
import { dateKey, shiftDateString } from "../data/dates";

export function seedDemoBoard(force = false): void {
  if (!force && localStorage.getItem(DEMO_STORAGE_KEY)) return;
  const today = dateKey(new Date());
  const d = (offset: number) => shiftDateString(today, offset);
  const t = Date.now();
  let n = 0;
  const task = (name: string, projectId: string, status: string, start: number, end: number, members: string[], extra: Record<string, unknown> = {}) => ({
    id: `t${t}-${n++}`, projectId, name, nameEn: name, members, status, start: d(start), end: d(end), info: "", label: "", subtasks: [],
    pedEnabled: false, pedDate: "", pedTime: "11:00", createdAt: t, updatedAt: t, ...extra
  });
  const post = (title: string, projectId: string, offset: number, time: string, status: string, social: string[], format: string, members: string[]) => ({
    id: `ped${t}-${n++}`, sourceTaskId: "", title, projectId, date: d(offset), time, status, members, social, format, asset: "", assetItems: [], copy: "Demo caption", comments: title === "New menu reveal" ? [{ id: `c${t}`, text: "@Matteo can you check the caption?", mentions: ["Matteo"], createdAt: t }] : [], subtasks: [], createdAt: t, updatedAt: t
  });
  const inf = (name: string, city: string, type: string, status: string, price: string) => ({ id: `inf${t}-${n++}`, name, city, type, status, price, target: "", where: "", when: "", ttProfile: `@${name.toLowerCase().replace(/ /g, "")}`, igProfile: "", ttLink: "", igLink: "", output: "1 reel", updatedAt: t, fieldUpdatedAt: {}, sortOrder: n });
  const data = {
    members: ["Giorgio", "Matteo", "Vale M", "Vale V", "Jessica"],
    statuses: [{ name: "TO DO", color: "#6b7280" }, { name: "In progress", color: "#147bd1" }, { name: "BLOCKED", color: "#e4572e" }, { name: "Notify Giorgia", color: "#f59e0b" }, { name: "DONE", color: "#15a36d" }],
    pedStatuses: [{ name: "Draft", color: "#6b7280" }, { name: "Ready", color: "#2563eb" }, { name: "Published", color: "#16a34a" }],
    creatorStatuses: [{ name: "Scheduled", color: "#dbeafe" }, { name: "Waiting", color: "#fef3c7" }, { name: "Published", color: "#dcfce7" }],
    creatorStores: ["Demo Store A", "Demo Store B"],
    labels: ["creator", "Video in store", "Publication"],
    socials: [{ id: "instagram", label: "Instagram", short: "IG", color: "#e1306c" }, { id: "tiktok", label: "TikTok", short: "TT", color: "#111827" }],
    projects: [{ id: "p-demo-social", name: "Demo Social", color: "#147bd1" }, { id: "p-demo-events", name: "Demo Events", color: "#7c5cff" }, { id: "p-customer-care", name: "Customer Care", color: "#0f9f6e" }, { id: "p-accounting", name: "Accounting", color: "#64748b" }],
    tasks: [
      task("Draft the autumn campaign brief", "p-demo-social", "In progress", -1, 2, ["Giorgio"]),
      task("Book creator for store opening", "p-demo-events", "TO DO", 0, 0, ["Matteo"], { label: "creator" }),
      task("Review influencer shortlist", "p-demo-social", "TO DO", 1, 3, ["Giorgio", "Vale M"]),
      task("Order printed menus", "p-demo-events", "BLOCKED", 2, 2, []),
      task("Reply to customer feedback", "p-customer-care", "TO DO", 0, 0, ["Vale M"]),
      task("Monthly invoices", "p-accounting", "TO DO", -3, -2, ["Matteo"]),
      task("Update opening hours on maps", "p-customer-care", "DONE", -4, -4, ["Vale M"]),
      task("Publish teaser reel", "p-demo-social", "In progress", 4, 4, ["Giorgio"], { label: "Publication", pedEnabled: true, pedDate: d(4), pedTime: "12:00", pedSocial: ["instagram", "tiktok"] }),
      task("Approve the menu photos", "p-demo-social", "Notify Giorgia", 1, 1, [], { label: "Notify Giorgia" }),
      task("Review contract draft", "p-demo-events", "TO DO", 0, 1, ["Vale V", "Jessica"], { subtasks: [{ id: "s-demo-1", title: "Check payment terms", members: ["Jessica"], done: false }] }),
      task("Photo shoot planning", "p-demo-events", "TO DO", 6, 9, ["Matteo", "Giorgio"]),
      task("Demo Creator One", "p-demo-social", "In progress", 2, 2, ["Matteo"], { label: "Video in store", creatorStatus: "Scheduled", creatorStore: "Demo Store A", creatorTime: "10:00" }),
      task("Demo Creator One", "p-demo-social", "TO DO", 5, 5, ["Matteo"], { label: "Publication", pedEnabled: true, pedDate: d(5), pedTime: "12:00" }),
      task("Demo Creator Two", "p-demo-social", "TO DO", 9, 9, ["Giorgio"], { label: "Video in store", creatorStatus: "Waiting", creatorStore: "Demo Store B", creatorTime: "15:30" })
    ],
    pedPosts: [
      post("New menu reveal", "p-demo-social", 0, "12:00", "Ready", ["instagram"], "Video", ["Giorgio"]),
      post("Behind the counter", "p-demo-social", 0, "18:00", "Draft", ["tiktok"], "Video", ["Matteo"]),
      { ...post("Weekend special", "p-demo-social", 2, "11:00", "Draft", ["instagram", "tiktok"], "Carousel", ["Giorgio"]), asset: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv", assetItems: [{ type: "image", src: "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='#ff7200'/><circle cx='160' cy='100' r='50' fill='#17120f'/></svg>"), fallback: "", original: "", label: "Synthetic" }, { type: "image", src: "x", fallback: "", original: "", label: "" }] },
      { ...post("Counter video", "p-demo-social", 1, "15:00", "Draft", ["tiktok"], "Video", ["Matteo"]), asset: "https://example.com/clip.mp4" },
      { ...post("Folder without thumbnails", "p-demo-events", 1, "17:00", "Draft", ["instagram"], "Carousel", ["Vale M"]), asset: "https://drive.google.com/drive/folders/1Dg_bgRkdzoaUD8vSb4XuPaHN6ZxHZEf_" },
      post("Store opening recap", "p-demo-events", 3, "13:00", "Draft", ["instagram"], "Static", ["Vale M"])
    ],
    influencers: [
      inf("Demo Creator One", "Milan", "Creator", "BOOKED", "EUR 300"),
      inf("Demo Creator Two", "Milan", "Creator", "TO CONTACT", "EUR 450"),
      inf("Demo Foodie Three", "Rome", "Creator", "CONTACTED", "EUR 200"),
      inf("Demo Reviewer Four", "Rome", "Creator", "TO CONTACT", "")
    ],
    influencerOptions: { city: [{ name: "Milan", color: "#e0f2fe", textColor: "#111827", needed: 0 }], target: [], type: [{ name: "Creator", color: "#fef3c7", textColor: "#111827", needed: 3 }], status: [{ name: "TO CONTACT", color: "#fee2e2", textColor: "#111827", needed: 0 }, { name: "BOOKED", color: "#dcfce7", textColor: "#111827", needed: 0 }], where: [], when: [] }
  };
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ "boards/default": { data, history: [], revision: t } }));
}
