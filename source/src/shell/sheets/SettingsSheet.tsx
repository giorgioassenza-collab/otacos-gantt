import { Suspense, lazy, useState, type FormEvent } from "react";
import { useBoard } from "../../store";
import { useUI, type SettingsSection } from "../../ui/uiContext";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { Plus, Trash2, X } from "../../ui/icons";
import type { BoardData, Status } from "../../data/types";
import { displayLabel } from "../../data/labelAliases";
import { slugify } from "../../data/util";
import { CommitColor, CommitInput } from "../../ui/CommitInput";
import { renamePerson } from "../../lib/actions";
import { TEAM, isClientPerson, samePerson } from "../../lib/team";

const InfluencerSettings = lazy(() => import("./settings/InfluencerSettings"));
const CreatorSettings = lazy(() => import("./settings/CreatorSettings"));

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "gantt", label: "Gantt" },
  { key: "ped", label: "PED" },
  { key: "creators", label: "Creators" },
  { key: "influencers", label: "Influencers" }
];

export default function SettingsSheet({ section }: { section: SettingsSection }) {
  const { close } = useUI();
  const [active, setActive] = useState<SettingsSection>(section);
  return (
    <Sheet title="Settings" onClose={close} wide>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={active === s.key} onClick={() => setActive(s.key)}>{s.label}</button>
        ))}
      </div>
      <SheetBody>
        {active === "gantt" && <GanttSettings />}
        {active === "ped" && <PedSettings />}
        <Suspense fallback={<div className="spinner" role="status" aria-label="Loading" />}>
          {active === "creators" && <CreatorSettings />}
          {active === "influencers" && <InfluencerSettings />}
        </Suspense>
      </SheetBody>
    </Sheet>
  );
}

/* ---------- reusable editors ---------- */

function AddRow({ label, placeholder, onAdd, color }: { label: string; placeholder: string; onAdd: (name: string, color: string) => void; color?: string }) {
  const [name, setName] = useState("");
  const [swatch, setSwatch] = useState(color ?? "#147bd1");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onAdd(clean, swatch);
    setName("");
  };
  return (
    <form className="add-row" onSubmit={submit}>
      <input className="input input--sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} aria-label={label} autoComplete="off" />
      {color !== undefined && <input className="input input--sm color-input" type="color" value={swatch} onChange={(e) => setSwatch(e.target.value)} aria-label={`${label} color`} />}
      <button type="submit" className="btn btn--sm" disabled={!name.trim()}><Plus />Add</button>
    </form>
  );
}

function SettingsGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="sheet-section-title">{title}</h3>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
    </section>
  );
}

function StatusList({ items, usage, onChange }: { items: Status[]; usage: (name: string) => number; onChange: (next: Status[]) => void }) {
  return (
    <ul className="settings-list">
      {items.map((status, index) => {
        const used = usage(status.name);
        return (
          <li key={`${status.name}-${index}`}>
            <CommitColor value={status.color} label={`Color of ${status.name}`} onCommit={(next) => onChange(items.map((s, i) => (i === index ? { ...s, color: next } : s)))} />
            <span className="settings-name">{status.name}</span>
            {used > 0 && <span className="muted settings-use">{used} in use</span>}
            <button type="button" className="icon-btn icon-btn--sm" disabled={used > 0 || items.length <= 1} aria-label={used > 0 ? `${status.name} is in use and cannot be removed` : `Remove ${status.name}`} title={used > 0 ? "In use: move those items to another status first" : "Remove"} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 /></button>
          </li>
        );
      })}
    </ul>
  );
}

function TagList({ items, display, usage, onRemove }: { items: string[]; display?: (value: string) => string; usage?: (value: string) => number; onRemove: (value: string) => void }) {
  if (!items.length) return <p className="field-hint">Nothing here yet.</p>;
  return (
    <div className="tag-list">
      {items.map((item) => {
        const used = usage?.(item) ?? 0;
        return (
          <span key={item} className="tag">
            {display ? display(item) : item}
            <button type="button" className="icon-btn" disabled={used > 0} title={used > 0 ? `In use by ${used}` : "Remove"} aria-label={used > 0 ? `${item} is in use and cannot be removed` : `Remove ${item}`} onClick={() => onRemove(item)}><X /></button>
          </span>
        );
      })}
    </div>
  );
}

/** One-tap fixes so the People list matches the team names used by "Who are you?". */
function TeamNameFixes({ members }: { members: string[] }) {
  const { mutate } = useBoard();
  const fixes = TEAM
    .filter((name) => !isClientPerson(name)) // Giorgia and Alice are clients, not assignees
    .map((name) => ({ name, variant: members.find((m) => m !== name && samePerson(m, name)), present: members.includes(name) }));
  const spelling = fixes.filter((f) => f.variant);
  const missing = fixes.filter((f) => !f.present && !f.variant);
  if (!spelling.length && !missing.length) return null;
  return (
    <div className="notice notice--info team-fixes">
      {spelling.map((f) => (
        <div key={f.name} className="team-fix">
          <span>“{f.variant}” is written differently from the team name “{f.name}”.</span>
          <button type="button" className="btn btn--sm" onClick={() => void mutate((d) => { renamePerson(d, f.variant!, f.name); })}>Use “{f.name}”</button>
        </div>
      ))}
      {missing.map((f) => (
        <div key={f.name} className="team-fix">
          <span>“{f.name}” is not in the list, so nothing can be assigned to them yet.</span>
          <button type="button" className="btn btn--sm" onClick={() => void mutate((d) => { if (!d.members.includes(f.name)) d.members.push(f.name); })}>Add “{f.name}”</button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Gantt ---------- */

function GanttSettings() {
  const { data, mutate } = useBoard();
  const taskUse = (key: "status" | "label") => (value: string) => data.tasks.filter((t) => t[key] === value).length;
  const memberUse = (name: string) => data.tasks.filter((t) => t.members.includes(name)).length + data.pedPosts.filter((p) => p.members.includes(name)).length;
  return (
    <>
      <SettingsGroup title="People" hint="Everyone who can be assigned to tasks and posts. Rename someone and the new name is used everywhere: tasks, subtasks, posts, comments.">
        <TeamNameFixes members={data.members} />
        <ul className="settings-list">
          {data.members.map((name) => {
            const used = memberUse(name);
            return (
              <li key={name}>
                <CommitInput className="input input--sm settings-name-input" value={name} aria-label={`Name of ${name}`}
                  onCommit={(next) => void mutate((d) => { renamePerson(d, name, next); })} />
                {used > 0 && <span className="muted settings-use">{used} in use</span>}
                <button type="button" className="icon-btn icon-btn--sm" disabled={used > 0} title={used > 0 ? `Assigned to ${used} items: rename or reassign first` : "Remove"} aria-label={used > 0 ? `${name} is in use and cannot be removed` : `Remove ${name}`} onClick={() => void mutate((d) => { d.members = d.members.filter((m) => m !== name); })}><Trash2 /></button>
              </li>
            );
          })}
        </ul>
        <AddRow label="New person" placeholder="Add a person" onAdd={(name) => void mutate((d) => { if (!d.members.some((m) => m.toLowerCase() === name.toLowerCase())) d.members.push(name); })} />
      </SettingsGroup>
      <SettingsGroup title="Task statuses">
        <StatusList items={data.statuses} usage={taskUse("status")} onChange={(next) => void mutate((d) => { d.statuses = next; })} />
        <AddRow label="New status" placeholder="Add a status" color="#6b7280" onAdd={(name, color) => void mutate((d) => { if (!d.statuses.some((s) => s.name.toLowerCase() === name.toLowerCase())) d.statuses.push({ name, color }); })} />
      </SettingsGroup>
      <SettingsGroup title="Labels" hint="Shown on tasks. The label “creator” opens the creator workflow in the task editor.">
        <TagList items={data.labels} display={displayLabel} usage={taskUse("label")} onRemove={(label) => void mutate((d) => { d.labels = d.labels.filter((l) => l !== label); })} />
        <AddRow label="New label" placeholder="Add a label" onAdd={(name) => void mutate((d) => { if (!d.labels.some((l) => l.toLowerCase() === name.toLowerCase())) d.labels.push(name); })} />
      </SettingsGroup>
    </>
  );
}

/* ---------- PED ---------- */

function PedSettings() {
  const { data, mutate } = useBoard();
  const pedUse = (name: string) => data.pedPosts.filter((p) => p.status === name).length;
  const socialUse = (id: string) => data.pedPosts.filter((p) => p.social.includes(id)).length + data.tasks.filter((t) => t.pedSocial.includes(id)).length;
  return (
    <>
      <SettingsGroup title="Post statuses">
        <StatusList items={data.pedStatuses} usage={pedUse} onChange={(next) => void mutate((d) => { d.pedStatuses = next; })} />
        <AddRow label="New post status" placeholder="Add a status" color="#2563eb" onAdd={(name, color) => void mutate((d) => { if (!d.pedStatuses.some((s) => s.name.toLowerCase() === name.toLowerCase())) d.pedStatuses.push({ name, color }); })} />
      </SettingsGroup>
      <SettingsGroup title="Social networks">
        <ul className="settings-list">
          {data.socials.map((social) => {
            const used = socialUse(social.id);
            return (
              <li key={social.id}>
                <CommitColor value={social.color} label={`Color of ${social.label}`} onCommit={(next) => void mutate((d) => { const s = d.socials.find((x) => x.id === social.id); if (s) s.color = next; })} />
                <span className="settings-name">{social.label} <span className="muted">({social.short})</span></span>
                {used > 0 && <span className="muted settings-use">{used} in use</span>}
                <button type="button" className="icon-btn icon-btn--sm" disabled={used > 0} aria-label={used > 0 ? `${social.label} is in use and cannot be removed` : `Remove ${social.label}`} onClick={() => void mutate((d) => { d.socials = d.socials.filter((s) => s.id !== social.id); })}><Trash2 /></button>
              </li>
            );
          })}
        </ul>
        <AddRow label="New social network" placeholder="Add a network" color="#111827" onAdd={(name, color) => void mutate((d: BoardData) => { const id = slugify(name); if (!d.socials.some((s) => s.id === id)) d.socials.push({ id, label: name, short: name.slice(0, 2).toUpperCase(), color }); })} />
      </SettingsGroup>
    </>
  );
}
