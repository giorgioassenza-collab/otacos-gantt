import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBoard } from "../../../store";
import { useToast } from "../../../ui/Toast";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "../../../ui/icons";
import { touchItem } from "../../../data/merge";

const NEW_STATUS_COLOR = "#dbeafe";

/** Reorder helper: moves the item at `index` by `delta` (returns the same array when it cannot move). */
function moved<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Body of the Creator settings sheet: Creator Calendar statuses (name + color) and stores. */
export default function CreatorSettings() {
  const { data, mutate, sync } = useBoard();
  const toast = useToast();
  const [statusName, setStatusName] = useState("");
  const [statusColor, setStatusColor] = useState(NEW_STATUS_COLOR);
  const [statusError, setStatusError] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeError, setStoreError] = useState("");

  const statuses = data.creatorStatuses;
  const stores = data.creatorStores;

  function run(change: Parameters<typeof mutate>[0]) {
    mutate(change).catch(() => toast.show("Could not save this change. Check the connection and try again.", { error: true }));
  }

  function addStatus(event: FormEvent) {
    event.preventDefault();
    const name = statusName.trim();
    if (!name) { setStatusError("Type a status name first."); return; }
    if (statuses.some((status) => status.name === name)) { setStatusError("That status already exists."); return; }
    setStatusError("");
    run((draft) => { draft.creatorStatuses.push({ name, color: statusColor }); });
    setStatusName("");
  }

  function addStore(event: FormEvent) {
    event.preventDefault();
    const name = storeName.trim();
    if (!name) { setStoreError("Type a store name first."); return; }
    if (stores.includes(name)) { setStoreError("That store already exists."); return; }
    setStoreError("");
    run((draft) => { draft.creatorStores.push(name); });
    setStoreName("");
  }

  function renameStatus(oldName: string, newName: string): boolean {
    if (!newName) return false;
    if (newName === oldName) return true;
    if (statuses.some((status) => status.name === newName)) { toast.show("That status name is already used.", { error: true }); return false; }
    run((draft) => {
      draft.creatorStatuses = draft.creatorStatuses.map((status) => status.name === oldName ? { ...status, name: newName } : status);
      draft.tasks.forEach((task) => { if (task.creatorStatus === oldName) { task.creatorStatus = newName; touchItem(task); } });
    });
    return true;
  }

  function recolorStatus(name: string, color: string) {
    run((draft) => {
      const status = draft.creatorStatuses.find((item) => item.name === name);
      if (status) status.color = color;
    });
  }

  function removeStatus(name: string) {
    run((draft) => {
      draft.creatorStatuses = draft.creatorStatuses.filter((status) => status.name !== name);
      const fallback = draft.creatorStatuses[0]?.name ?? "";
      draft.tasks.forEach((task) => { if (task.creatorStatus === name) { task.creatorStatus = fallback; touchItem(task); } });
    });
    toast.show(`Status "${name}" deleted`, { action: { label: "Undo", run: () => void sync.undo() } });
  }

  function renameStore(oldName: string, newName: string): boolean {
    if (!newName) return false;
    if (newName === oldName) return true;
    if (stores.includes(newName)) { toast.show("That store name is already used.", { error: true }); return false; }
    run((draft) => {
      draft.creatorStores = draft.creatorStores.map((store) => store === oldName ? newName : store);
      draft.tasks.forEach((task) => { if (task.creatorStore === oldName) { task.creatorStore = newName; touchItem(task); } });
    });
    return true;
  }

  function removeStore(name: string) {
    run((draft) => {
      draft.creatorStores = draft.creatorStores.filter((store) => store !== name);
      draft.tasks.forEach((task) => { if (task.creatorStore === name) { task.creatorStore = ""; touchItem(task); } });
    });
    toast.show(`Store "${name}" deleted`, { action: { label: "Undo", run: () => void sync.undo() } });
  }

  return (
    <>
      <section className="cc-set" aria-labelledby="cc-set-statuses">
        <h3 id="cc-set-statuses" className="sheet-section-title">Statuses</h3>
        <p className="field-hint">Shown as colored chips in the Creator calendar. Confirmed sets the Gantt task to In progress, Video shot sets it to DONE.</p>
        {statuses.length === 0 ? (
          <p className="cc-set-empty">No statuses yet. Add the first one below.</p>
        ) : (
          <ul className="cc-set-list">
            {statuses.map((status, index) => (
              <li key={status.name} className="cc-set-row">
                <ColorInput name={status.name} color={status.color} onCommit={(color) => recolorStatus(status.name, color)} />
                <NameInput label={`Status name ${status.name}`} value={status.name} onCommit={(value) => renameStatus(status.name, value)} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Move ${status.name} up`} disabled={index === 0} onClick={() => run((draft) => { draft.creatorStatuses = moved(draft.creatorStatuses, index, -1); })}><ChevronUp /></button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Move ${status.name} down`} disabled={index === statuses.length - 1} onClick={() => run((draft) => { draft.creatorStatuses = moved(draft.creatorStatuses, index, 1); })}><ChevronDown /></button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Delete status ${status.name}`} onClick={() => removeStatus(status.name)}><Trash2 /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="cc-set-add" onSubmit={addStatus} noValidate>
          <input type="color" className="input cc-color" aria-label="New status color" value={statusColor} onChange={(e) => setStatusColor(e.target.value)} />
          <input
            className="input" aria-label="New status name" placeholder="New status" value={statusName} autoComplete="off"
            aria-invalid={Boolean(statusError)} onChange={(e) => { setStatusName(e.target.value); setStatusError(""); }}
          />
          <button type="submit" className="btn btn--sm"><Plus />Add status</button>
        </form>
        {statusError && <p className="cc-set-error" role="alert">{statusError}</p>}
      </section>

      <section className="cc-set" aria-labelledby="cc-set-stores">
        <h3 id="cc-set-stores" className="sheet-section-title">Stores</h3>
        <p className="field-hint">Where the videos are shot. Deleting a store clears it from the items that used it.</p>
        {stores.length === 0 ? (
          <p className="cc-set-empty">No stores yet. Add the first one below.</p>
        ) : (
          <ul className="cc-set-list">
            {stores.map((store, index) => (
              <li key={store} className="cc-set-row cc-set-row--store">
                <NameInput label={`Store name ${store}`} value={store} onCommit={(value) => renameStore(store, value)} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Move ${store} up`} disabled={index === 0} onClick={() => run((draft) => { draft.creatorStores = moved(draft.creatorStores, index, -1); })}><ChevronUp /></button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Move ${store} down`} disabled={index === stores.length - 1} onClick={() => run((draft) => { draft.creatorStores = moved(draft.creatorStores, index, 1); })}><ChevronDown /></button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Delete store ${store}`} onClick={() => removeStore(store)}><Trash2 /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="cc-set-add cc-set-add--store" onSubmit={addStore} noValidate>
          <input
            className="input" aria-label="New store name" placeholder="New store" value={storeName} autoComplete="off"
            aria-invalid={Boolean(storeError)} onChange={(e) => { setStoreName(e.target.value); setStoreError(""); }}
          />
          <button type="submit" className="btn btn--sm"><Plus />Add store</button>
        </form>
        {storeError && <p className="cc-set-error" role="alert">{storeError}</p>}
      </section>
    </>
  );
}

/** Text input that commits on Enter or blur and reverts when the value is empty or already taken. */
function NameInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (!onCommit(next)) setText(value);
  };
  return (
    <input
      className="input input--sm" aria-label={label} value={text} autoComplete="off"
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { setText(value); e.currentTarget.blur(); } }}
    />
  );
}

/** Color picker that saves shortly after the last change instead of on every drag step. */
function ColorInput({ name, color, onCommit }: { name: string; color: string; onCommit: (color: string) => void }) {
  const [text, setText] = useState(color);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setText(color), [color]);
  const schedule = (next: string) => {
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(next), 400);
  };
  return (
    <input
      type="color" className="input cc-color" aria-label={`Color of ${name}`}
      value={/^#[0-9a-f]{6}$/i.test(text) ? text : "#d7dde5"} onChange={(e) => schedule(e.target.value)}
    />
  );
}
