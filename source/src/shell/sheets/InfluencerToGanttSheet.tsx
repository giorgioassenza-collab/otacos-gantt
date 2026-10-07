import { useMemo, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { SelectField, TextField } from "../../ui/fields";
import { PillRadio } from "../../ui/pills";
import { Notice } from "../../ui/common";
import { currentDateKey } from "../../data/dates";
import { addInfluencerToGantt } from "../../data/labels";
import { assignableMembers } from "../../views/influencers/helpers";

type Action = "contact" | "video-store";

export default function InfluencerToGanttSheet({ influencerId }: { influencerId: string }) {
  const { data } = useBoard();
  const { close } = useUI();
  const row = data.influencers.find((item) => item.id === influencerId);
  if (!row) {
    return (
      <Sheet title="Add to Gantt" onClose={close} footer={<><span className="spacer" /><button type="button" className="btn" onClick={close}>Close</button></>}>
        <SheetBody>
          <Notice tone="error">This influencer no longer exists. It may have been deleted on another device.</Notice>
        </SheetBody>
      </Sheet>
    );
  }
  return <Form influencerId={influencerId} name={row.name} />;
}

function Form({ influencerId, name }: { influencerId: string; name: string }) {
  const { data, mutate } = useBoard();
  const { close, go } = useUI();
  const toast = useToast();
  const members = useMemo(() => assignableMembers(data), [data.members]);

  const [action, setAction] = useState<Action>("contact");
  const [projectId, setProjectId] = useState(() => data.projects[0]?.id ?? "");
  const [who, setWho] = useState(() => members[0] ?? "");
  const [date, setDate] = useState(() => currentDateKey());
  const [creatorStatus, setCreatorStatus] = useState(() => data.creatorStatuses[0]?.name ?? "");
  const [creatorStore, setCreatorStore] = useState(() => data.creatorStores[0] ?? "");
  const [creatorTime, setCreatorTime] = useState("10:00");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const video = action === "video-store";
  const missing = !projectId || !who || !date || (video && (!creatorStatus || !creatorStore || !creatorTime));

  async function submit() {
    setShowErrors(true);
    if (missing) return;
    setBusy(true);
    let added = false;
    try {
      await mutate((draft) => {
        added = Boolean(addInfluencerToGantt(draft, influencerId, projectId, who, date, { action, creatorStatus, creatorStore, creatorTime }));
        return added ? undefined : false;
      });
      if (!added) {
        toast.show("The task could not be created. The influencer may have been removed.", { error: true });
        return;
      }
      toast.show(video ? "In-store video task added to the Gantt" : "Contact task added to the Gantt", { action: { label: "Open Gantt", run: () => go("gantt") } });
      close();
    } catch (error) {
      toast.show(error instanceof Error && error.message ? error.message : "The task could not be saved.", { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Add to Gantt"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <span className="spacer" />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit()}>Add task</button>
        </>
      }
    >
      <SheetBody>
        <p className="muted">Creates a task for <strong>{name || "this influencer"}</strong> on the Gantt.</p>
        <PillRadio
          label="Type"
          value={action}
          onChange={(value) => setAction(value as Action)}
          options={[{ value: "contact", label: "Contact" }, { value: "video-store", label: "In-store video" }]}
        />
        <SelectField
          label="Project"
          value={projectId}
          placeholder="Choose a project"
          onChange={(event) => setProjectId(event.target.value)}
          options={data.projects.map((project) => ({ value: project.id, label: project.name }))}
          aria-invalid={showErrors && !projectId}
          hint={showErrors && !projectId ? "Choose a project." : undefined}
        />
        <SelectField
          label="Who"
          value={who}
          placeholder="Choose a person"
          onChange={(event) => setWho(event.target.value)}
          options={members}
          aria-invalid={showErrors && !who}
          hint={members.length === 0 ? "Add people in Settings first." : showErrors && !who ? "Choose who takes the task." : undefined}
        />
        <TextField label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-invalid={showErrors && !date} hint={showErrors && !date ? "Pick a date." : undefined} />
        {video && (
          <fieldset className="subform">
            <legend>Creator Calendar</legend>
            <SelectField
              label="Status"
              value={creatorStatus}
              placeholder="Choose a status"
              onChange={(event) => setCreatorStatus(event.target.value)}
              options={data.creatorStatuses.map((status) => status.name)}
              aria-invalid={showErrors && !creatorStatus}
            />
            <div className="row-2">
              <SelectField
                label="Store"
                value={creatorStore}
                placeholder="Choose a store"
                onChange={(event) => setCreatorStore(event.target.value)}
                options={data.creatorStores}
                aria-invalid={showErrors && !creatorStore}
                hint={showErrors && !creatorStore ? "Choose the store." : undefined}
              />
              <TextField label="Time" type="time" value={creatorTime} onChange={(event) => setCreatorTime(event.target.value)} aria-invalid={showErrors && !creatorTime} />
            </div>
          </fieldset>
        )}
      </SheetBody>
    </Sheet>
  );
}
