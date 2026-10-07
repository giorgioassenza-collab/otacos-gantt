import { useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { SelectField, TextField } from "../../ui/fields";
import { PillRadio } from "../../ui/pills";
import { Notice } from "../../ui/common";
import { Trash2 } from "../../ui/icons";
import { now } from "../../data/clock";
import { englishLabel } from "../../data/labelAliases";
import { syncAutomaticPedPostsForTasks, syncCreatorStatusToGantt } from "../../data/labels";
import { touchItem } from "../../data/merge";
import type { BoardData, Task } from "../../data/types";
import { defaultCreatorStatus, deleteCreatorItem, findPublicationTaskFor } from "../../views/creators/creatorItems";

function uniquePublicationId(draft: BoardData): string {
  const taken = new Set([...draft.tasks.map((task) => task.id), ...draft.pedPosts.map((post) => post.id)]);
  const base = `t${now()}-creator-publish`;
  let id = base;
  let counter = 2;
  while (taken.has(id)) { id = `${base}-${counter}`; counter += 1; }
  return id;
}

/** Edit sheet of a Creator Calendar item. `id` is the Gantt task id of the "Video in store" task. */
export default function CreatorSheet({ id }: { id: string }) {
  const { data, mutate, sync } = useBoard();
  const { close } = useUI();
  const toast = useToast();
  const existing = data.tasks.find((task) => task.id === id);
  const linked = existing ? findPublicationTaskFor(data.tasks, existing) : undefined;

  const initialTitle = existing ? (existing.nameEn || existing.name) : "";
  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(existing?.start ?? "");
  const [publicationDate, setPublicationDate] = useState(linked?.start ?? "");
  const [status, setStatus] = useState(existing ? (existing.creatorStatus || defaultCreatorStatus(data)) : "");
  const [store, setStore] = useState(existing?.creatorStore ?? "");
  const [time, setTime] = useState(existing?.creatorTime || "10:00");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!existing) {
    return (
      <Sheet title="Edit creator item" onClose={close} footer={<><span className="spacer" /><button type="button" className="btn" onClick={close}>Close</button></>}>
        <SheetBody>
          <Notice>This item no longer exists. It may have been deleted on another device.</Notice>
        </SheetBody>
      </Sheet>
    );
  }

  const statusNames = data.creatorStatuses.map((item) => item.name);
  const statusOptions = [...new Set([...statusNames, ...(status ? [status] : [])])]
    .map((name) => ({ value: name, label: name, color: data.creatorStatuses.find((item) => item.name === name)?.color }));
  const storeNames = [...new Set([...data.creatorStores, ...(store ? [store] : [])])];

  const titleError = showErrors && !title.trim();
  const dateError = showErrors && !date;

  async function save() {
    setShowErrors(true);
    const name = title.trim();
    if (!name || !date) return;
    setBusy(true);
    try {
      await mutate((draft) => {
        const target = draft.tasks.find((task) => task.id === id);
        if (!target) return false;
        // Look the publication up BEFORE renaming: the link is the project + name key.
        let publication: Task | undefined = findPublicationTaskFor(draft.tasks, target);
        const renamed = name !== initialTitle;
        if (renamed) { target.name = name; target.nameEn = name; }
        target.start = date;
        target.end = date;
        target.creatorStatus = status;
        target.creatorStore = store;
        target.creatorTime = time || "10:00";
        syncCreatorStatusToGantt(draft, target);
        touchItem(target);

        if (!publication && publicationDate) {
          const createdAt = now();
          const created: Task = {
            ...structuredClone(target),
            id: uniquePublicationId(draft),
            label: englishLabel("publication"),
            info: "",
            subtasks: [],
            pedEnabled: false,
            pedAutoDismissed: false,
            pedDate: "",
            createdAt,
            updatedAt: createdAt
          };
          if (target.creatorParentId) created.creatorAction = "publish"; else delete created.creatorAction;
          draft.tasks.push(created);
          publication = created;
        }
        if (publication) {
          if (renamed) { publication.name = name; publication.nameEn = name; }
          publication.projectId = target.projectId;
          publication.members = [...(target.members || [])];
          publication.status = target.status;
          if (publicationDate && publication.start !== publicationDate) {
            // A PED date that followed the old publication date follows the new one.
            if (!publication.pedDate || publication.pedDate === publication.start) publication.pedDate = publicationDate;
            publication.start = publicationDate;
            publication.end = publicationDate;
          }
          touchItem(publication);
          syncAutomaticPedPostsForTasks(draft, [publication]);
        }
      });
      toast.show("Creator item saved");
      close();
    } catch {
      toast.show("Could not save this item. Check the connection and try again.", { error: true });
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    mutate((draft) => deleteCreatorItem(draft, id)).catch(() => toast.show("Could not delete this item. Try again.", { error: true }));
    close();
    toast.show("Creator item deleted", { action: { label: "Undo", run: () => void sync.undo() } });
  }

  return (
    <Sheet
      title="Edit creator item"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn--danger btn--sm" onClick={remove}><Trash2 />Delete</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>Save</button>
        </>
      }
    >
      <SheetBody>
        <TextField
          label="Name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Creator name" data-autofocus
          aria-invalid={titleError} autoComplete="off" enterKeyHint="done"
          hint={titleError ? "Add a name to continue." : undefined}
        />
        <div className="row-2">
          <TextField
            label="Video in store date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            aria-invalid={dateError} hint={dateError ? "Pick the shoot date." : undefined}
          />
          <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <TextField
          label="Publication date" type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)}
          hint={linked ? "Moves the linked Publication task in the Gantt." : "Pick a date to create the linked Publication task."}
        />
        <PillRadio label="Status" value={status} onChange={setStatus} options={statusOptions} />
        {storeNames.length > 4 ? (
          <SelectField label="Store" value={store} onChange={(e) => setStore(e.target.value)} placeholder="No store" options={storeNames} />
        ) : (
          <PillRadio label="Store" value={store} onChange={setStore} allowEmpty options={storeNames.map((name) => ({ value: name, label: name }))} />
        )}
        {data.creatorStores.length === 0 && <p className="field-hint">Add stores in the Creator settings to pick one here.</p>}
        <p className="field-hint">Status Confirmed sets the Gantt task to In progress, and Video shot sets it to DONE.</p>
      </SheetBody>
    </Sheet>
  );
}
