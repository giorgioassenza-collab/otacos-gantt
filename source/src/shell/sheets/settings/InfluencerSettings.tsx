import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBoard } from "../../../store";
import { useToast } from "../../../ui/Toast";
import { CheckField, SelectField, TextField } from "../../../ui/fields";
import { Plus, Trash2 } from "../../../ui/icons";
import { now } from "../../../data/clock";
import { currentDateKey } from "../../../data/dates";
import { influencerTypeIsVisible, syncInfluencerProgressTasks } from "../../../data/labels";
import { deleteTaskById, setInfluencerTypeProgressField, touchItem } from "../../../data/merge";
import { normalizeInfluencerDeletedOptions, normalizeInfluencerTypeProgressConfig } from "../../../data/normalize";
import { influencerColumns, legacyInfluencerOptionColors } from "../../../data/starter";
import type { BoardData, InfluencerOption, InfluencerOptionKey, TypeProgressField } from "../../../data/types";
import { influencerOptionKey } from "../../../data/util";
import { OPTION_KEYS, OPTION_LABELS, optionColor, optionTextColor } from "../../../views/influencers/helpers";

type Tab = InfluencerOptionKey | "columns";
const TABS: { key: Tab; label: string }[] = [
  ...OPTION_KEYS.map((key) => ({ key, label: OPTION_LABELS[key] })),
  { key: "columns", label: "Columns" }
];

const DEFAULT_TEXT_COLOR = "#111827";

/** `<input type="color">` only accepts #rrggbb. */
function toHex6(value: string, fallback: string): string {
  const clean = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) return clean.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(clean)) return `#${clean.slice(1).split("").map((char) => char + char).join("")}`.toLowerCase();
  return fallback;
}

/** Colour picker that saves once, when the picker closes (the `change` event), not on every drag. */
function ColorInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handler = () => commitRef.current(element.value);
    element.addEventListener("change", handler);
    return () => element.removeEventListener("change", handler);
  }, []);
  return <input ref={ref} type="color" className="input inf-color" aria-label={label} value={local} onChange={(event) => setLocal(event.target.value)} />;
}

/** Text/number input that saves on blur or Enter. */
function CommitInput({ value, onCommit, label, className, ...rest }: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  className?: string;
  type?: string;
  min?: number;
  step?: number;
  inputMode?: "numeric" | "text";
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return (
    <input
      className={`input ${className ?? ""}`}
      aria-label={label}
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      {...rest}
    />
  );
}

function findOption(options: InfluencerOption[] | undefined, name: string): InfluencerOption | undefined {
  const key = influencerOptionKey(name);
  return (options || []).find((item) => influencerOptionKey(item.name) === key);
}

export default function InfluencerSettings() {
  const { data, mutate, sync } = useBoard();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("status");

  const fail = (error: unknown) => toast.show(error instanceof Error && error.message ? error.message : "The change could not be saved.", { error: true });
  const save = (fn: (draft: BoardData) => void | boolean) => { mutate(fn).catch(fail); };

  return (
    <div className="inf-settings">
      <p className="muted">These lists fill the dropdowns and colors in the Influencers table. Changes are saved as you make them.</p>
      <div className="tabs-inline">
        <div className="segmented" role="tablist" aria-label="Influencer settings">
          {TABS.map((item) => (
            <button key={item.key} type="button" role="tab" id={`inf-tab-${item.key}`} aria-selected={tab === item.key} aria-controls="inf-tabpanel" onClick={() => setTab(item.key)}>{item.label}</button>
          ))}
        </div>
      </div>
      <div id="inf-tabpanel" role="tabpanel" aria-labelledby={`inf-tab-${tab}`} className="inf-settings-panel">
        {tab === "columns" ? <ColumnLabels save={save} /> : <OptionList key={tab} optionKey={tab} save={save} sync={sync} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- column headings */

function ColumnLabels({ save }: { save: (fn: (draft: BoardData) => void | boolean) => void }) {
  const { data } = useBoard();
  return (
    <div className="inf-settings-list">
      <p className="field-hint">Rename the column headings of the Influencers table. Leave a field empty to restore the default.</p>
      {influencerColumns.map((column) => (
        <div key={column.key} className="field">
          <span className="field-label">
            {column.label}
            {column.hidden && <span className="muted"> (link behind the profile cell)</span>}
          </span>
          <CommitInput
            label={`Heading for ${column.label}`}
            value={data.influencerColumnLabels?.[column.key] || column.label}
            onCommit={(next) => save((draft) => {
              draft.influencerColumnLabels = { ...(draft.influencerColumnLabels || {}), [column.key]: next.trim() || column.label };
            })}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ option lists */

function OptionList({ optionKey, save, sync }: {
  optionKey: InfluencerOptionKey;
  save: (fn: (draft: BoardData) => void | boolean) => void;
  sync: ReturnType<typeof useBoard>["sync"];
}) {
  const { data } = useBoard();
  const toast = useToast();
  const items = data.influencerOptions?.[optionKey] || [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    data.influencers.forEach((row) => {
      const key = influencerOptionKey(row[optionKey]);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [data.influencers, optionKey]);

  function rename(oldName: string, rawName: string) {
    const newName = rawName.trim();
    if (!newName || newName === oldName) return;
    if (findOption(items, newName) && influencerOptionKey(newName) !== influencerOptionKey(oldName)) {
      toast.show(`There is already a ${OPTION_LABELS[optionKey].toLowerCase()} called "${newName}".`, { error: true });
      return;
    }
    save((draft) => {
      draft.influencerDeletedOptions = normalizeInfluencerDeletedOptions(draft.influencerDeletedOptions);
      draft.influencerDeletedOptions[optionKey] = (draft.influencerDeletedOptions[optionKey] || []).filter((entry) => influencerOptionKey(entry) !== influencerOptionKey(newName));
      const oldKey = influencerOptionKey(oldName);
      const newKey = influencerOptionKey(newName);
      if (optionKey === "type" && oldKey !== newKey) {
        draft.influencerPreviewVisibility = { ...(draft.influencerPreviewVisibility || {}) };
        if (Object.prototype.hasOwnProperty.call(draft.influencerPreviewVisibility, oldKey)) {
          draft.influencerPreviewVisibility[newKey] = draft.influencerPreviewVisibility[oldKey];
          delete draft.influencerPreviewVisibility[oldKey];
        }
        draft.influencerTypeProgressConfig = normalizeInfluencerTypeProgressConfig(draft.influencerTypeProgressConfig);
        if (draft.influencerTypeProgressConfig[oldKey]) {
          draft.influencerTypeProgressConfig[newKey] = draft.influencerTypeProgressConfig[oldKey];
          delete draft.influencerTypeProgressConfig[oldKey];
        }
      }
      draft.influencerOptions[optionKey] = (draft.influencerOptions[optionKey] || []).map((item) => (influencerOptionKey(item.name) === oldKey ? { ...item, name: newName } : item));
      (draft.influencers || []).forEach((row) => {
        if (influencerOptionKey(row[optionKey]) === oldKey) {
          row[optionKey] = newName;
          touchItem(row);
        }
      });
      syncInfluencerProgressTasks(draft);
    });
  }

  function recolor(name: string, field: "color" | "textColor", value: string) {
    save((draft) => {
      const option = findOption(draft.influencerOptions[optionKey], name);
      if (!option) return false;
      option[field] = value;
    });
  }

  function remove(name: string) {
    const affected = counts.get(influencerOptionKey(name)) || 0;
    save((draft) => {
      const key = influencerOptionKey(name);
      const deleted = findOption(draft.influencerOptions[optionKey], name);
      if (optionKey === "type") {
        if (deleted?.progressTaskId) deleteTaskById(draft, deleted.progressTaskId);
        draft.influencerPreviewVisibility = { ...(draft.influencerPreviewVisibility || {}) };
        delete draft.influencerPreviewVisibility[key];
        draft.influencerTypeProgressConfig = normalizeInfluencerTypeProgressConfig(draft.influencerTypeProgressConfig);
        delete draft.influencerTypeProgressConfig[key];
      }
      // Tombstone, so a later import or normalization does not bring the option back.
      draft.influencerDeletedOptions = normalizeInfluencerDeletedOptions(draft.influencerDeletedOptions);
      if (!draft.influencerDeletedOptions[optionKey].some((entry) => influencerOptionKey(entry) === key)) {
        draft.influencerDeletedOptions[optionKey].push(name);
      }
      draft.influencerOptions[optionKey] = (draft.influencerOptions[optionKey] || []).filter((item) => influencerOptionKey(item.name) !== key);
      (draft.influencers || []).forEach((row) => {
        if (influencerOptionKey(row[optionKey]) === key) {
          row[optionKey] = "";
          touchItem(row);
        }
      });
      syncInfluencerProgressTasks(draft);
    });
    toast.show(
      affected ? `"${name}" deleted and cleared from ${affected} ${affected === 1 ? "influencer" : "influencers"}` : `"${name}" deleted`,
      { action: { label: "Undo", run: () => void sync.undo() } }
    );
  }

  function updateType(name: string, field: TypeProgressField, value: string | boolean | number) {
    save((draft) => {
      const option = findOption(draft.influencerOptions.type, name);
      if (!option) return false;
      if (field === "visible") {
        const visible = Boolean(value);
        draft.influencerPreviewVisibility = { ...(draft.influencerPreviewVisibility || {}), [influencerOptionKey(option.name)]: visible };
        setInfluencerTypeProgressField(draft, option.name, "visible", visible);
        option.previewVisible = visible;
        option.previewUpdatedAt = now();
      } else if (field === "needed") {
        option.needed = Math.max(0, Math.floor(Number(value) || 0));
        setInfluencerTypeProgressField(draft, option.name, "needed", option.needed);
      } else if (field === "deadline") {
        option.deadline = String(value);
        setInfluencerTypeProgressField(draft, option.name, "deadline", option.deadline);
      } else {
        option.projectId = String(value);
        setInfluencerTypeProgressField(draft, option.name, "projectId", option.projectId);
      }
      syncInfluencerProgressTasks(draft);
    });
    if (field === "visible" && value) {
      const option = findOption(items, name);
      if (option && (!option.deadline || !option.projectId || Number(option.needed) < 1)) {
        toast.show("Shown in the table. Set a target, deadline and Gantt project to create its Gantt task.");
      }
    }
  }

  return (
    <div className="inf-settings-list">
      {items.length === 0 && <p className="field-hint">No {OPTION_LABELS[optionKey].toLowerCase()} options yet. Add the first one below.</p>}
      {items.map((item) => {
        const count = counts.get(influencerOptionKey(item.name)) || 0;
        return (
          <div key={item.name} className="inf-opt">
            <div className="inf-opt-main">
              <CommitInput label={`Name of ${item.name}`} value={item.name} onCommit={(next) => rename(item.name, next)} />
              <ColorInput label={`Color of ${item.name}`} value={toHex6(optionColor(data, optionKey, item.name), "#e5e7eb")} onCommit={(value) => recolor(item.name, "color", value)} />
              <ColorInput label={`Font color of ${item.name}`} value={toHex6(optionTextColor(data, optionKey, item.name), DEFAULT_TEXT_COLOR)} onCommit={(value) => recolor(item.name, "textColor", value)} />
              <button type="button" className="icon-btn" aria-label={`Delete ${item.name}`} onClick={() => remove(item.name)}><Trash2 /></button>
            </div>
            <p className="inf-opt-count">
              <span className="inf-chip" style={{ background: optionColor(data, optionKey, item.name), color: optionTextColor(data, optionKey, item.name) }}>{item.name}</span>
              {count} {count === 1 ? "influencer" : "influencers"}
            </p>
            {optionKey === "type" && (
              <div className="inf-type">
                <CheckField
                  label="Show in the staffing progress"
                  checked={influencerTypeIsVisible(item, data)}
                  onChange={(on) => updateType(item.name, "visible", on)}
                />
                <div className="row-2">
                  <div className="field">
                    <span className="field-label">Influencers needed</span>
                    <CommitInput label={`Influencers needed for ${item.name}`} type="number" min={0} step={1} inputMode="numeric" value={String(Math.max(0, Number(item.needed) || 0))} onCommit={(next) => updateType(item.name, "needed", next)} />
                  </div>
                  <div className="field">
                    <span className="field-label">Deadline</span>
                    <input className="input" type="date" aria-label={`Deadline for ${item.name}`} min={currentDateKey()} value={item.deadline || ""} onChange={(event) => updateType(item.name, "deadline", event.target.value)} />
                  </div>
                </div>
                <SelectField
                  label="Gantt project"
                  value={item.projectId || ""}
                  placeholder="None"
                  onChange={(event) => updateType(item.name, "projectId", event.target.value)}
                  options={data.projects.map((project) => ({ value: project.id, label: project.name }))}
                  hint="The Gantt shows a progress task for this type once it has a target, deadline and project."
                />
              </div>
            )}
          </div>
        );
      })}
      <AddOption optionKey={optionKey} items={items} save={save} />
    </div>
  );
}

/* ---------------------------------------------------------------------- add form */

function AddOption({ optionKey, items, save }: { optionKey: InfluencerOptionKey; items: InfluencerOption[]; save: (fn: (draft: BoardData) => void | boolean) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState(legacyInfluencerOptionColors[optionKey] || "#e5e7eb");
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [needed, setNeeded] = useState("0");

  function add() {
    const clean = name.trim();
    if (!clean) return;
    if (findOption(items, clean)) {
      toast.show(`There is already a ${OPTION_LABELS[optionKey].toLowerCase()} called "${clean}".`, { error: true });
      return;
    }
    const target = Math.max(0, Math.floor(Number(needed) || 0));
    save((draft) => {
      draft.influencerOptions = draft.influencerOptions || ({} as BoardData["influencerOptions"]);
      draft.influencerDeletedOptions = normalizeInfluencerDeletedOptions(draft.influencerDeletedOptions);
      draft.influencerDeletedOptions[optionKey] = (draft.influencerDeletedOptions[optionKey] || []).filter((entry) => influencerOptionKey(entry) !== influencerOptionKey(clean));
      draft.influencerOptions[optionKey] = draft.influencerOptions[optionKey] || [];
      if (draft.influencerOptions[optionKey].some((item) => influencerOptionKey(item.name) === influencerOptionKey(clean))) return;
      draft.influencerOptions[optionKey].push({
        name: clean,
        color,
        textColor,
        ...(optionKey === "type" ? { needed: target, previewVisible: false, previewUpdatedAt: 0, deadline: "", projectId: "", progressTaskId: "" } : { needed: 0 })
      });
      if (optionKey === "type") {
        setInfluencerTypeProgressField(draft, clean, "visible", false);
        setInfluencerTypeProgressField(draft, clean, "needed", target);
        setInfluencerTypeProgressField(draft, clean, "deadline", "");
        setInfluencerTypeProgressField(draft, clean, "projectId", "");
      }
    });
    setName("");
    setColor(legacyInfluencerOptionColors[optionKey] || "#e5e7eb");
    setTextColor(DEFAULT_TEXT_COLOR);
    setNeeded("0");
  }

  const label = OPTION_LABELS[optionKey].toLowerCase();
  return (
    <form className="subform inf-add" onSubmit={(event) => { event.preventDefault(); add(); }} aria-label={`Add a ${label}`}>
      <h3 className="subform-title">Add a {label}</h3>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder={`New ${label}`} autoComplete="off" />
      <div className="inf-add-colors">
        <div className="field">
          <span className="field-label">Color</span>
          <input type="color" className="input inf-color" aria-label={`Color of the new ${label}`} value={toHex6(color, "#e5e7eb")} onChange={(event) => setColor(event.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Font color</span>
          <input type="color" className="input inf-color" aria-label={`Font color of the new ${label}`} value={toHex6(textColor, DEFAULT_TEXT_COLOR)} onChange={(event) => setTextColor(event.target.value)} />
        </div>
        {optionKey === "type" && (
          <TextField label="Influencers needed" type="number" min={0} step={1} inputMode="numeric" value={needed} onChange={(event) => setNeeded(event.target.value)} />
        )}
        <span className="inf-chip inf-add-sample" style={{ background: color, color: textColor }}>{name.trim() || `New ${label}`}</span>
      </div>
      <button type="submit" className="btn btn--sm" disabled={!name.trim()}><Plus />Add {label}</button>
    </form>
  );
}
