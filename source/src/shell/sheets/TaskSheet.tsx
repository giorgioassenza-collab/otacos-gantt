import { useMemo, useRef, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { CheckField, MultiPick, SelectField, TextAreaField, TextField } from "../../ui/fields";
import { PillRadio } from "../../ui/pills";
import { Avatars } from "../../ui/common";
import { Copy, Plus, Trash2 } from "../../ui/icons";
import type { CreatorControls, Task } from "../../data/types";
import { currentDateKey, shiftDateString } from "../../data/dates";
import { displayLabel } from "../../data/labelAliases";
import { touchItem } from "../../data/merge";
import { now } from "../../data/clock";
import { creatorDuplicateTasksFromControls, ensurePedPostForTask, ensureStatusExists, isCreatorLabel, removeLinkedPedPostForTask, shouldAutoCreatePedPost, syncAutomaticPedPostsForTasks, upsertCreatorGeneratedTasks } from "../../data/labels";
import { blankTask, deleteTask, duplicateTask } from "../../lib/actions";
import { parseDate } from "../../lib/gantt";
import { isClientName } from "../../data/util";

const emptyControls = (date: string): CreatorControls => ({
  contact: { checked: false }, askOk: { checked: false }, contract: { checked: false }, brief: { checked: false }, giorgia: { checked: false },
  video: { checked: false }, videoDate: { value: date },
  sendVideoAlice: { checked: false }, sendVideoAliceDate: { value: date },
  publish: { checked: false }, publishDate: { value: date }
});

function nextMonday(from: string): string {
  const d = parseDate(from);
  const add = ((8 - d.getDay()) % 7) || 7;
  return shiftDateString(from, add);
}

export default function TaskSheet({ id, defaults }: { id?: string; defaults?: Partial<Task> }) {
  const { data, mutate, sync } = useBoard();
  const { close, open } = useUI();
  const toast = useToast();
  const existing = id ? data.tasks.find((t) => t.id === id) : undefined;
  const today = currentDateKey();

  const [task, setTask] = useState<Task>(() => existing ? structuredClone(existing) : blankTask(data, { start: today, end: today, ...defaults }));
  const [title, setTitle] = useState(() => existing ? (existing.nameEn || existing.name) : "");
  const [multiDay, setMultiDay] = useState(() => Boolean(task.end && task.end !== task.start));
  const [controls, setControls] = useState<CreatorControls>(() => emptyControls(task.start || today));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const [subMembers, setSubMembers] = useState<string[]>([]);
  // closing with edits that were not saved asks first (a tap outside the sheet used to throw them away silently)
  const draftJson = JSON.stringify({ task, title, multiDay, subTitle });
  const startJson = useRef(draftJson);
  const dirty = draftJson !== startJson.current;

  const members = useMemo(() => data.members.filter((m) => !isClientName(m)), [data.members]);
  const creatorOn = isCreatorLabel(task.label);
  const patch = (changes: Partial<Task>) => setTask((current) => ({ ...current, ...changes }));
  const patchControls = <K extends keyof CreatorControls>(key: K, value: CreatorControls[K]) => setControls((c) => ({ ...c, [key]: value }));

  const titleError = showErrors && !title.trim();
  const dateError = showErrors && !task.start;

  async function save() {
    setShowErrors(true);
    if (!title.trim() || !task.start || !task.projectId || !task.status) return;
    setBusy(true);
    const start = task.start;
    const end = multiDay && task.end >= start ? task.end : start;
    try {
      await mutate((draft) => {
        const name = title.trim();
        let target: Task;
        if (existing) {
          const found = draft.tasks.find((t) => t.id === existing.id);
          if (!found) return;
          target = found;
          const typed = name !== (existing.nameEn || existing.name);
          if (typed) { target.name = name; target.nameEn = name; }
        } else {
          target = { ...task, name, nameEn: name, start, end, updatedAt: now(), createdAt: now() };
          draft.tasks.push(target);
        }
        target.projectId = task.projectId;
        target.status = task.status;
        target.members = task.members;
        target.start = start;
        target.end = end;
        target.label = task.label;
        target.info = task.info.trim();
        target.pedEnabled = task.pedEnabled;
        target.pedDate = task.pedDate || start;
        target.pedTime = task.pedTime || (shouldAutoCreatePedPost(target) ? "12:00" : "11:00");
        if (target.pedEnabled) target.pedAutoDismissed = false;
        touchItem(target);

        if (target.pedEnabled || shouldAutoCreatePedPost(target)) ensurePedPostForTask(draft, target, { syncFromTask: true });
        else removeLinkedPedPostForTask(draft, target.id);

        let generated: Task[] = [];
        if (isCreatorLabel(target.label)) {
          if (controls.giorgia.checked) ensureStatusExists(draft, "Notify Giorgia");
          generated = creatorDuplicateTasksFromControls({ ...target }, now(), controls);
          upsertCreatorGeneratedTasks(draft, generated);
        }
        syncAutomaticPedPostsForTasks(draft, [target, ...generated]);
      });
      toast.show(existing ? "Task saved" : hasWorkflowSteps(controls, creatorOn) ? "Task and workflow steps added" : "Task added");
      close();
    } finally {
      setBusy(false);
    }
  }

  function addSubtask() {
    const text = subTitle.trim();
    if (!text || !existing) return;
    void mutate((draft) => {
      const target = draft.tasks.find((t) => t.id === existing.id);
      if (!target) return;
      target.subtasks.push({ id: `s${now()}`, title: text, members: subMembers, done: false });
      touchItem(target);
    });
    setSubTitle("");
    setSubMembers([]);
  }

  const live = existing ? data.tasks.find((t) => t.id === existing.id) : undefined;

  return (
    <Sheet
      title={existing ? "Edit task" : "New task"}
      onClose={close}
      dirty={dirty}
      footer={
        <>
          {existing && (
            <>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => {
                void mutate((draft) => deleteTask(draft, existing.id));
                close();
                toast.show("Task deleted", { action: { label: "Undo", run: () => void sync.undo() } });
              }}><Trash2 />Delete</button>
              <button type="button" className="btn btn--sm" onClick={() => { void mutate((draft) => { duplicateTask(draft, existing.id); }); toast.show("Task duplicated"); close(); }}><Copy />Duplicate</button>
            </>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>{existing ? "Save" : "Add task"}</button>
        </>
      }
    >
      <SheetBody>
        <TextField
          label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to happen?" data-autofocus
          aria-invalid={titleError} autoComplete="off" enterKeyHint="done"
          hint={titleError ? "Add a title to continue." : undefined}
        />
        <PillRadio label="Project" value={task.projectId} onChange={(v) => patch({ projectId: v })} options={data.projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))} />
        <PillRadio label="Status" value={task.status} onChange={(v) => patch({ status: v })} options={data.statuses.map((s) => ({ value: s.name, label: s.name, color: s.color }))} />
        <MultiPick label="Who" value={task.members} onChange={(next) => patch({ members: next })} options={members.map((m) => ({ value: m, label: m }))} empty="Add people in Settings." />

        <div className="field">
          <span className="field-label">When</span>
          <div className="quick-dates">
            <button type="button" className="chip" data-active={task.start === today} onClick={() => patch({ start: today, end: multiDay && task.end >= today ? task.end : today })}>Today</button>
            <button type="button" className="chip" data-active={task.start === shiftDateString(today, 1)} onClick={() => patch({ start: shiftDateString(today, 1), end: multiDay ? task.end : shiftDateString(today, 1) })}>Tomorrow</button>
            <button type="button" className="chip" data-active={task.start === nextMonday(today)} onClick={() => patch({ start: nextMonday(today), end: multiDay ? task.end : nextMonday(today) })}>Next Monday</button>
          </div>
          <div className="row-2">
            <TextField label="Start" type="date" value={task.start} onChange={(e) => patch({ start: e.target.value, end: !multiDay || task.end < e.target.value ? e.target.value : task.end })} aria-invalid={dateError} />
            {multiDay && <TextField label="End" type="date" min={task.start} value={task.end || task.start} onChange={(e) => patch({ end: e.target.value })} />}
          </div>
          <CheckField label="Runs over several days" checked={multiDay} onChange={(on) => { setMultiDay(on); if (!on) patch({ end: task.start }); }} />
        </div>

        <SelectField
          label="Label" value={task.label} onChange={(e) => patch({ label: e.target.value })} placeholder="No label"
          options={[...new Set([...data.labels, ...(task.label ? [task.label] : [])])].map((l) => ({ value: l, label: displayLabel(l) }))}
        />

        {creatorOn && (
          <fieldset className="subform">
            <legend>Creator workflow</legend>
            <p className="field-hint">Tick the steps to create as their own tasks, linked to this one.</p>
            <CheckField label="Contact" checked={controls.contact.checked} onChange={(v) => patchControls("contact", { checked: v })} />
            <CheckField label="Ask OK Alice" checked={controls.askOk.checked} onChange={(v) => patchControls("askOk", { checked: v })} />
            <CheckField label="Send contract" checked={controls.contract.checked} onChange={(v) => patchControls("contract", { checked: v })} />
            <CheckField label="Brief" checked={controls.brief.checked} onChange={(v) => patchControls("brief", { checked: v })} />
            <CheckField label="Notify Giorgia" checked={controls.giorgia.checked} onChange={(v) => patchControls("giorgia", { checked: v })} />
            <div className="dated-step">
              <CheckField label="Video in store" checked={controls.video.checked} onChange={(v) => patchControls("video", { checked: v })} />
              {controls.video.checked && <input className="input input--sm" type="date" aria-label="Video in store date" value={controls.videoDate.value} onChange={(e) => patchControls("videoDate", { value: e.target.value })} />}
            </div>
            <div className="dated-step">
              <CheckField label="Send video to Alice" checked={controls.sendVideoAlice.checked} onChange={(v) => patchControls("sendVideoAlice", { checked: v })} />
              {controls.sendVideoAlice.checked && <input className="input input--sm" type="date" aria-label="Send video to Alice date" value={controls.sendVideoAliceDate.value} onChange={(e) => patchControls("sendVideoAliceDate", { value: e.target.value })} />}
            </div>
            <div className="dated-step">
              <CheckField label="Publication" checked={controls.publish.checked} onChange={(v) => patchControls("publish", { checked: v })} />
              {controls.publish.checked && <input className="input input--sm" type="date" aria-label="Publication date" value={controls.publishDate.value} onChange={(e) => patchControls("publishDate", { value: e.target.value })} />}
            </div>
          </fieldset>
        )}

        <TextAreaField label="Link or notes" value={task.info} onChange={(e) => patch({ info: e.target.value })} placeholder="Paste a link or add a note" rows={3} />

        <fieldset className="subform">
          <legend>Editorial plan</legend>
          <CheckField label="Show in the editorial plan (PED)" checked={task.pedEnabled} onChange={(on) => patch({ pedEnabled: on, pedDate: task.pedDate || task.start })} />
          {task.pedEnabled && (
            <div className="row-2">
              <TextField label="PED date" type="date" value={task.pedDate || task.start} onChange={(e) => patch({ pedDate: e.target.value })} />
              <TextField label="PED time" type="time" value={task.pedTime} onChange={(e) => patch({ pedTime: e.target.value })} />
            </div>
          )}
          {existing && task.pedEnabled && (
            <button type="button" className="btn btn--sm" onClick={() => open({ kind: "post", id: `task-${existing.id}` })}>Open the post</button>
          )}
        </fieldset>

        {existing && live && (
          <section className="subform" aria-label="Subtasks">
            <h3 className="subform-title">Subtasks {live.subtasks.length > 0 && <span className="muted">{live.subtasks.filter((s) => s.done).length}/{live.subtasks.length}</span>}</h3>
            <ul className="subtask-list">
              {live.subtasks.map((sub) => (
                <li key={sub.id}>
                  <label className="check">
                    <input type="checkbox" checked={sub.done} onChange={(e) => void mutate((draft) => { const t = draft.tasks.find((x) => x.id === live.id); const s = t?.subtasks.find((x) => x.id === sub.id); if (t && s) { s.done = e.target.checked; touchItem(t); } })} />
                    <span className={sub.done ? "is-done" : ""}>{sub.title}</span>
                  </label>
                  <Avatars names={sub.members} />
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove subtask ${sub.title}`} onClick={() => void mutate((draft) => { const t = draft.tasks.find((x) => x.id === live.id); if (t) { t.subtasks = t.subtasks.filter((x) => x.id !== sub.id); touchItem(t); } })}><Trash2 /></button>
                </li>
              ))}
            </ul>
            <div className="subtask-add">
              <input className="input input--sm" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }} placeholder="Add a subtask" aria-label="New subtask" />
              <button type="button" className="btn btn--sm" onClick={addSubtask} disabled={!subTitle.trim()}><Plus />Add</button>
            </div>
            {members.length > 0 && <MultiPick label="Subtask for" value={subMembers} onChange={setSubMembers} options={members.map((m) => ({ value: m, label: m }))} />}
          </section>
        )}
      </SheetBody>
    </Sheet>
  );
}

function hasWorkflowSteps(controls: CreatorControls, creatorOn: boolean): boolean {
  if (!creatorOn) return false;
  return Object.values(controls).some((entry) => "checked" in entry && entry.checked);
}
