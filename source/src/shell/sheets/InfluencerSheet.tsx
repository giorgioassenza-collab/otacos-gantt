import { useMemo, useRef, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { CheckField, SelectField, TextField } from "../../ui/fields";
import { Notice } from "../../ui/common";
import { Plus, Trash2 } from "../../ui/icons";
import { now } from "../../data/clock";
import { currentDateKey } from "../../data/dates";
import {
  contactProjectId,
  isContactInfluencerStatus,
  moveInfluencerToBottom,
  nextInfluencerSortOrder,
  syncInfluencerContactTask,
  syncInfluencerProgressTasks
} from "../../data/labels";
import { deleteInfluencerById } from "../../data/merge";
import { normalizeInfluencerRow } from "../../data/normalize";
import { stableDataString } from "../../data/util";
import type { Influencer, InfluencerOptionKey } from "../../data/types";
import { OPTION_LABELS, assignableMembers, duplicateOf, optionNames, sortedInfluencers } from "../../views/influencers/helpers";

interface Form {
  name: string;
  city: string;
  target: string;
  type: string;
  status: string;
  where: string;
  when: string;
  ttProfile: string;
  ttLink: string;
  igProfile: string;
  igLink: string;
  output: string;
  price: string;
  contactEnabled: boolean;
  contactDate: string;
  contactMember: string;
  contactProjectId: string;
}

export default function InfluencerSheet({ id }: { id?: string }) {
  const { data } = useBoard();
  const { close } = useUI();
  const existing = id ? data.influencers.find((row) => row.id === id) : undefined;
  if (id && !existing) {
    return (
      <Sheet title="Influencer" onClose={close} footer={<><span className="spacer" /><button type="button" className="btn" onClick={close}>Close</button></>}>
        <SheetBody>
          <Notice tone="error">This influencer no longer exists. It may have been deleted on another device. Close this panel to go back to the list.</Notice>
        </SheetBody>
      </Sheet>
    );
  }
  return <InfluencerEditor existing={existing} />;
}

function InfluencerEditor({ existing }: { existing: Influencer | undefined }) {
  const { data, mutate, sync } = useBoard();
  const { close, open } = useUI();
  const toast = useToast();
  const today = currentDateKey();

  const initial = useMemo<Form>(() => ({
    name: existing?.name ?? "",
    city: existing?.city ?? "",
    target: existing?.target ?? "",
    type: existing?.type ?? "",
    status: existing?.status ?? "",
    where: existing?.where ?? "",
    when: existing?.when ?? "",
    ttProfile: existing?.ttProfile ?? "",
    ttLink: existing?.ttLink ?? "",
    igProfile: existing?.igProfile ?? "",
    igLink: existing?.igLink ?? "",
    output: existing?.output ?? "",
    price: existing?.price ?? "",
    contactEnabled: Boolean(existing?.contactTaskEnabled),
    contactDate: existing?.contactDate || today,
    contactMember: existing?.contactMember ?? "",
    contactProjectId: existing?.contactProjectId || contactProjectId(data)
    // The form is seeded once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const initialJson = useRef(JSON.stringify(initial));
  const [form, setForm] = useState<Form>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<Form>) => setForm((current) => ({ ...current, ...changes }));
  const dirty = JSON.stringify(form) !== initialJson.current;
  const members = useMemo(() => assignableMembers(data), [data.members]);
  const ordered = useMemo(() => sortedInfluencers(data.influencers), [data.influencers]);
  const duplicate = useMemo(() => duplicateOf(ordered, form.name, existing?.id), [ordered, form.name, existing?.id]);

  const canSchedule = isContactInfluencerStatus(form.status);
  const contactOn = form.contactEnabled && canSchedule;
  const nameError = showErrors && !form.name.trim();
  const dateError = showErrors && contactOn && !form.contactDate;
  const memberError = showErrors && contactOn && !form.contactMember;
  const projectError = showErrors && contactOn && !form.contactProjectId;

  const select = (key: InfluencerOptionKey) => (
    <SelectField
      label={OPTION_LABELS[key]}
      value={form[key]}
      placeholder="None"
      onChange={(event) => patch({ [key]: event.target.value } as Partial<Form>)}
      options={optionNames(data, key, form[key])}
    />
  );

  async function save() {
    setShowErrors(true);
    const name = form.name.trim();
    if (!name) return;
    if (contactOn && (!form.contactDate || !form.contactMember || !form.contactProjectId)) return;
    setBusy(true);
    try {
      await mutate((draft) => {
        const rowId = existing?.id ?? `inf${now()}`;
        const previous = draft.influencers.find((item) => item.id === rowId);
        const status = form.status.trim();
        const statusKey = status.toUpperCase();
        const row = normalizeInfluencerRow({
          ...(previous ?? {}),
          id: rowId,
          sortOrder: previous?.sortOrder,
          name,
          city: form.city.trim(),
          target: form.target.trim(),
          type: form.type.trim(),
          ttProfile: form.ttProfile.trim(),
          ttLink: form.ttLink.trim(),
          igProfile: form.igProfile.trim(),
          igLink: form.igLink.trim(),
          output: form.output.trim(),
          price: form.price.trim(),
          status,
          where: form.where.trim(),
          when: form.when.trim(),
          contactTaskEnabled: contactOn,
          contactTaskId: previous?.contactTaskId || "",
          contactDate: form.contactDate,
          contactMember: form.contactMember,
          contactProjectId: form.contactProjectId,
          contactedAt: previous?.contactedAt || "",
          influencerUpdatedAt: today,
          updatedAt: now()
        });
        if (statusKey === "CONTACTED" && String(previous?.status || "").trim().toUpperCase() !== "CONTACTED") row.contactedAt = today;
        if (statusKey !== "CONTACTED") row.contactedAt = "";
        if (!previous) row.sortOrder = nextInfluencerSortOrder(draft, rowId);
        const changed = previous ? stableDataString(row) !== stableDataString(previous) : true;
        const index = draft.influencers.findIndex((item) => item.id === rowId);
        if (index >= 0) draft.influencers[index] = row;
        else draft.influencers.push(row);
        if (changed) moveInfluencerToBottom(draft, rowId);
        const saved = draft.influencers.find((item) => item.id === rowId);
        if (saved) syncInfluencerContactTask(draft, saved);
        syncInfluencerProgressTasks(draft);
      });
      toast.show(existing ? "Influencer saved" : "Influencer added");
      close();
    } catch (error) {
      toast.show(error instanceof Error && error.message ? error.message : "The influencer could not be saved.", { error: true });
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!existing) return;
    const rowId = existing.id;
    mutate((draft) => {
      deleteInfluencerById(draft, rowId);
      syncInfluencerProgressTasks(draft);
    }).catch((error: unknown) => toast.show(error instanceof Error && error.message ? error.message : "The influencer could not be deleted.", { error: true }));
    close();
    toast.show("Influencer deleted", { action: { label: "Undo", run: () => void sync.undo() } });
  }

  return (
    <Sheet
      title={existing ? "Edit influencer" : "New influencer"}
      onClose={close}
      footer={
        <>
          {existing && <button type="button" className="btn btn--danger btn--sm" onClick={remove}><Trash2 />Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>{existing ? "Save" : "Add influencer"}</button>
        </>
      }
    >
      <SheetBody>
        <TextField
          label="Name"
          value={form.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Creator name"
          data-autofocus
          autoComplete="off"
          aria-invalid={nameError}
          hint={nameError ? "Add a name to continue." : undefined}
        />
        {duplicate && <Notice>This name looks like the influencer on row {duplicate.rowNumber} ({duplicate.name}). Check it is not a duplicate.</Notice>}

        <div className="row-2">
          {select("status")}
          {select("type")}
        </div>

        {canSchedule && (
          <fieldset className="subform">
            <legend>Contact task</legend>
            <CheckField label="Schedule a contact task in the Gantt" checked={form.contactEnabled} onChange={(on) => patch({ contactEnabled: on, contactDate: form.contactDate || today, contactProjectId: form.contactProjectId || contactProjectId(data) })} />
            {form.contactEnabled && (
              <>
                <div className="row-2">
                  <TextField label="Contact date" type="date" value={form.contactDate} onChange={(event) => patch({ contactDate: event.target.value })} aria-invalid={dateError} hint={dateError ? "Pick a date." : undefined} />
                  <SelectField
                    label="Who"
                    value={form.contactMember}
                    placeholder="Choose a person"
                    onChange={(event) => patch({ contactMember: event.target.value })}
                    options={members}
                    aria-invalid={memberError}
                    hint={members.length === 0 ? "Add people in Settings first." : memberError ? "Choose who contacts this creator." : undefined}
                  />
                </div>
                <SelectField
                  label="Project"
                  value={form.contactProjectId}
                  placeholder="Choose a project"
                  onChange={(event) => patch({ contactProjectId: event.target.value })}
                  options={data.projects.map((project) => ({ value: project.id, label: project.name }))}
                  aria-invalid={projectError}
                  hint={projectError ? "Choose the Gantt project for the task." : undefined}
                />
              </>
            )}
          </fieldset>
        )}

        <div className="row-2">
          {select("city")}
          {select("target")}
        </div>
        <div className="row-2">
          {select("where")}
          {select("when")}
        </div>

        <fieldset className="subform">
          <legend>Profiles</legend>
          <div className="row-2">
            <TextField label="TikTok profile" value={form.ttProfile} onChange={(event) => patch({ ttProfile: event.target.value })} placeholder="@handle" autoComplete="off" autoCapitalize="none" />
            <TextField label="TikTok link" value={form.ttLink} onChange={(event) => patch({ ttLink: event.target.value })} placeholder="https://" inputMode="url" autoComplete="off" autoCapitalize="none" />
          </div>
          <div className="row-2">
            <TextField label="Instagram profile" value={form.igProfile} onChange={(event) => patch({ igProfile: event.target.value })} placeholder="@handle" autoComplete="off" autoCapitalize="none" />
            <TextField label="Instagram link" value={form.igLink} onChange={(event) => patch({ igLink: event.target.value })} placeholder="https://" inputMode="url" autoComplete="off" autoCapitalize="none" />
          </div>
          <p className="field-hint">Leave a link empty to open the profile from its handle.</p>
        </fieldset>

        <div className="row-2">
          <TextField label="Output" value={form.output} onChange={(event) => patch({ output: event.target.value })} placeholder="e.g. 1 reel, 3 stories" autoComplete="off" />
          <TextField label="Price" value={form.price} onChange={(event) => patch({ price: event.target.value })} placeholder="e.g. 500" autoComplete="off" />
        </div>

        {existing && (
          <fieldset className="subform">
            <legend>Gantt</legend>
            <p className="field-hint">Create a contact task or an in-store video task for this creator.</p>
            <button type="button" className="btn btn--sm" disabled={dirty} onClick={() => open({ kind: "influencerToGantt", influencerId: existing.id })}><Plus />Add to Gantt</button>
            {dirty && <p className="field-hint">Save your changes first.</p>}
          </fieldset>
        )}
      </SheetBody>
    </Sheet>
  );
}
