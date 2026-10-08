import { useMemo, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { CheckField, MultiPick, TextAreaField, TextField } from "../../ui/fields";
import { PillRadio } from "../../ui/pills";
import { Avatars } from "../../ui/common";
import { Copy, ExternalLink, MessageSquare, Plus, Trash2 } from "../../ui/icons";
import type { PedPost } from "../../data/types";
import { currentDateKey } from "../../data/dates";
import { touchItem } from "../../data/merge";
import { now } from "../../data/clock";
import { duplicatePedItem, ensurePedPostForTask } from "../../data/labels";
import { isClientName } from "../../data/util";
import { blankPost, deletePedPost } from "../../lib/actions";
import { assetLinks, isDriveFolder, safeHref } from "../../lib/assets";
import { SocialPreview } from "../../ui/SocialPreview";
import { normalizeFormat, normalizeHour } from "../../lib/gantt";

const FORMATS = ["Video", "Static", "Carousel"] as const;

/** The post sheet opens a manual post, a task mirror post, or `task-<id>` for a Gantt task flagged for the PED that has no post yet. */
export default function PostSheet({ id, defaults }: { id?: string; defaults?: Partial<PedPost> }) {
  const { data, mutate, sync } = useBoard();
  const { close, open } = useUI();
  const toast = useToast();

  const taskId = id?.startsWith("task-") ? id.slice(5) : undefined;
  const linkedTask = taskId ? data.tasks.find((t) => t.id === taskId) : undefined;
  const existing = id
    ? taskId ? data.pedPosts.find((p) => p.sourceTaskId === taskId) : data.pedPosts.find((p) => p.id === id)
    : undefined;
  const isNew = !id;

  const [post, setPost] = useState<PedPost>(() => {
    if (existing) return structuredClone(existing);
    if (linkedTask) {
      return blankPost(data, {
        id: "", sourceTaskId: linkedTask.id, title: linkedTask.pedTitle || linkedTask.nameEn || linkedTask.name, projectId: linkedTask.projectId,
        date: linkedTask.pedDate || linkedTask.start, time: normalizeHour(linkedTask.pedTime), members: linkedTask.members, social: linkedTask.pedSocial,
        asset: linkedTask.pedAsset, copy: linkedTask.pedCopy, subtasks: linkedTask.subtasks
      });
    }
    return blankPost(data, { date: currentDateKey(), ...defaults });
  });
  const [showErrors, setShowErrors] = useState(false);
  const [comment, setComment] = useState("");
  const [subTitle, setSubTitle] = useState("");
  const [subMembers, setSubMembers] = useState<string[]>([]);

  const members = useMemo(() => data.members.filter((m) => !isClientName(m)), [data.members]);
  const patch = (changes: Partial<PedPost>) => setPost((current) => ({ ...current, ...changes }));
  const titleError = showErrors && !post.title.trim();

  /** Run `fn` on the persisted post, creating the task mirror first when needed. */
  function withPost(fn: (target: PedPost, draft: Parameters<Parameters<typeof mutate>[0]>[0]) => void) {
    return mutate((draft) => {
      let target = existing ? draft.pedPosts.find((p) => p.id === existing.id) ?? null : null;
      if (!target && linkedTask) {
        const task = draft.tasks.find((t) => t.id === linkedTask.id);
        target = task ? ensurePedPostForTask(draft, task, { syncFromTask: true }) : null;
      }
      if (target) fn(target, draft);
    });
  }

  async function save() {
    setShowErrors(true);
    if (!post.title.trim() || !post.date || !post.projectId || !post.status) return;
    await mutate((draft) => {
      let target: PedPost | null = null;
      if (existing) target = draft.pedPosts.find((p) => p.id === existing.id) ?? null;
      else if (linkedTask) {
        const task = draft.tasks.find((t) => t.id === linkedTask.id);
        target = task ? ensurePedPostForTask(draft, task, { syncFromTask: true }) : null;
      } else {
        target = { ...post, id: `ped${now()}`, createdAt: now(), updatedAt: now(), sourceTaskId: "" };
        draft.pedPosts.push(target);
      }
      if (!target) return;
      target.title = post.title.trim();
      target.projectId = post.projectId;
      target.date = post.date;
      target.time = normalizeHour(post.time);
      target.status = post.status;
      target.members = post.members;
      target.social = post.social;
      target.format = normalizeFormat(post.format);
      target.asset = post.asset.trim();
      target.copy = post.copy.trim();
      if (target.sourceTaskId) {
        const source = draft.tasks.find((t) => t.id === target!.sourceTaskId);
        if (source) {
          source.projectId = post.projectId;
          source.pedEnabled = true;
          source.pedAutoDismissed = false;
          source.pedDate = post.date;
          source.pedTime = normalizeHour(post.time);
          touchItem(source);
        }
      }
      touchItem(target);
    });
    toast.show(isNew ? "Post added" : "Post saved");
    close();
  }

  function mentionsOf(text: string) {
    const lower = text.toLowerCase();
    return members.filter((name) => lower.includes(`@${name.toLowerCase()}`));
  }

  async function addComment() {
    const text = comment.trim();
    if (!text) return;
    await withPost((target) => {
      target.comments = [...target.comments, { id: `pc${now()}`, text, mentions: mentionsOf(text), createdAt: now() }];
      touchItem(target);
    });
    setComment("");
  }

  async function addSubtask() {
    const text = subTitle.trim();
    if (!text) return;
    await withPost((target) => {
      target.subtasks.push({ id: `ps${now()}`, title: text, members: subMembers, done: false });
      touchItem(target);
    });
    setSubTitle("");
    setSubMembers([]);
  }

  const live = existing ? data.pedPosts.find((p) => p.id === existing.id) : undefined;
  const persisted = Boolean(live);
  const links = assetLinks(post.asset);
  const savedItems = live?.assetItems ?? linkedTask?.pedAssetItems ?? post.assetItems;
  const sorted = [...(live?.comments ?? [])].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <Sheet
      title={isNew ? "New post" : "Edit post"}
      onClose={close}
      wide
      footer={
        <>
          {(existing || linkedTask) && (
            <>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => {
                if (existing) void mutate((draft) => deletePedPost(draft, existing.id));
                else if (linkedTask) void mutate((draft) => { const t = draft.tasks.find((x) => x.id === linkedTask.id); if (t) { t.pedEnabled = false; t.pedAutoDismissed = true; t.pedDate = ""; touchItem(t); } });
                close();
                toast.show("Post removed", { action: { label: "Undo", run: () => void sync.undo() } });
              }}><Trash2 />Remove</button>
              <button type="button" className="btn btn--sm" onClick={() => {
                void mutate((draft) => { duplicatePedItem(draft, linkedTask?.id ?? "", existing?.id ?? ""); });
                toast.show("Post duplicated");
                close();
              }}><Copy />Duplicate</button>
              {!linkedTask && existing && <button type="button" className="btn btn--sm" onClick={() => open({ kind: "pedToGantt", postId: existing.id })}>Add to Gantt</button>}
            </>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn--primary" onClick={() => void save()}>{isNew ? "Add post" : "Save"}</button>
        </>
      }
    >
      <SheetBody>
        <div className="post-layout">
        <aside className="post-preview">
          <SocialPreview
            copy={post.copy}
            socials={data.socials}
            selected={post.social}
            format={post.format}
            asset={post.asset}
            assetItems={savedItems}
            date={post.date}
            onWriteCopy={() => document.querySelector<HTMLTextAreaElement>("[data-copy-field]")?.focus()}
          />
        </aside>
        <div className="post-form">
        <TextField label="Title" value={post.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Post title" data-autofocus aria-invalid={titleError} autoComplete="off" hint={titleError ? "Add a title to continue." : undefined} />
        <PillRadio label="Project" value={post.projectId} onChange={(v) => patch({ projectId: v })} options={data.projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))} />
        <div className="row-2">
          <TextField label="Date" type="date" value={post.date} onChange={(e) => patch({ date: e.target.value })} aria-invalid={showErrors && !post.date} />
          <TextField label="Time" type="time" value={normalizeHour(post.time)} onChange={(e) => patch({ time: e.target.value })} />
        </div>
        <PillRadio label="Status" value={post.status} onChange={(v) => patch({ status: v })} options={data.pedStatuses.map((s) => ({ value: s.name, label: s.name, color: s.color }))} />
        <PillRadio label="Format" value={post.format} onChange={(v) => patch({ format: normalizeFormat(v) })} options={FORMATS.map((f) => ({ value: f, label: f }))} />
        <MultiPick label="Social" value={post.social} onChange={(next) => patch({ social: next })} options={data.socials.map((s) => ({ value: s.id, label: s.label, color: s.color }))} empty="Add social networks in Settings." />
        <MultiPick label="Who" value={post.members} onChange={(next) => patch({ members: next })} options={members.map((m) => ({ value: m, label: m }))} empty="Add people in Settings." />

        <TextAreaField label="Asset links" hint="One link per line: Drive files or folders, images, videos." value={post.asset} onChange={(e) => patch({ asset: e.target.value })} rows={3} placeholder="https://drive.google.com/…" />
        {links.length > 0 && (
          <ul className="asset-links">
            {links.map((link) => {
              const href = safeHref(link);
              return (
                <li key={link}>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> {isDriveFolder(link) ? "Drive folder" : link.replace(/^https?:\/\//, "").slice(0, 60)}</a> : <span>{link}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <TextAreaField label="Copy" data-copy-field value={post.copy} onChange={(e) => patch({ copy: e.target.value })} rows={6} placeholder="Caption, hashtags, notes for the publisher" hint="The preview updates as you type. Hashtags, @mentions and links are coloured like on the network." />

        {(persisted || linkedTask) && (
          <section className="subform" aria-label="Comments">
            <h3 className="subform-title"><MessageSquare size={16} aria-hidden /> Comments {sorted.length > 0 && <span className="muted">{sorted.length}</span>}</h3>
            {sorted.length === 0 && <p className="field-hint">No comments yet. Tag people with @Name.</p>}
            <ul className="comment-list">
              {sorted.map((c) => (
                <li key={c.id}>
                  <time dateTime={new Date(c.createdAt).toISOString()}>{new Date(c.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                  <p>{renderMentions(c.text, members)}</p>
                </li>
              ))}
            </ul>
            {members.length > 0 && (
              <div className="mention-row" aria-label="Tag someone">
                {members.map((m) => <button key={m} type="button" className="chip" onClick={() => setComment((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${m} `)}>@{m}</button>)}
              </div>
            )}
            <div className="subtask-add">
              <input className="input input--sm" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addComment(); } }} placeholder="Write a comment" aria-label="New comment" />
              <button type="button" className="btn btn--sm" onClick={() => void addComment()} disabled={!comment.trim()}><Plus />Post</button>
            </div>
          </section>
        )}

        {(persisted || linkedTask) && (
          <section className="subform" aria-label="Subtasks">
            <h3 className="subform-title">Subtasks {(live?.subtasks.length ?? 0) > 0 && <span className="muted">{live!.subtasks.filter((s) => s.done).length}/{live!.subtasks.length}</span>}</h3>
            <ul className="subtask-list">
              {(live?.subtasks ?? []).map((sub) => (
                <li key={sub.id}>
                  <CheckField label={<span className={sub.done ? "is-done" : ""}>{sub.title}</span>} checked={sub.done} onChange={(done) => void withPost((target) => { const s = target.subtasks.find((x) => x.id === sub.id); if (s) { s.done = done; touchItem(target); } })} />
                  <Avatars names={sub.members} />
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove subtask ${sub.title}`} onClick={() => void withPost((target) => { target.subtasks = target.subtasks.filter((x) => x.id !== sub.id); touchItem(target); })}><Trash2 /></button>
                </li>
              ))}
            </ul>
            <div className="subtask-add">
              <input className="input input--sm" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addSubtask(); } }} placeholder="Add a subtask" aria-label="New subtask" />
              <button type="button" className="btn btn--sm" onClick={() => void addSubtask()} disabled={!subTitle.trim()}><Plus />Add</button>
            </div>
            {members.length > 0 && <MultiPick label="Subtask for" value={subMembers} onChange={setSubMembers} options={members.map((m) => ({ value: m, label: m }))} />}
          </section>
        )}
        </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}

function renderMentions(text: string, names: string[]) {
  if (!names.length) return text;
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(@(?:${escaped.join("|")}))`, "gi"));
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="mention">{part}</mark> : part));
}
