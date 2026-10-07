import { useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { TextField } from "../../ui/fields";
import { currentDateKey } from "../../data/dates";
import { addPedItemToGantt, addPedItemToPed } from "../../data/labels";
import { normalizeHour } from "../../lib/gantt";

/** Small "pick a date" dialogs: copy a PED post to the Gantt, or send a Gantt task to the editorial plan. */
export default function DateDialog({ kind, id }: { kind: "pedToGantt" | "ganttToPed"; id: string }) {
  const { data, mutate } = useBoard();
  const { close } = useUI();
  const toast = useToast();
  const task = kind === "ganttToPed" ? data.tasks.find((t) => t.id === id) : undefined;
  const post = kind === "pedToGantt" ? data.pedPosts.find((p) => p.id === id) : undefined;
  const [date, setDate] = useState(() => task?.pedDate || task?.start || post?.date || currentDateKey());
  const [time, setTime] = useState(() => normalizeHour(task?.pedTime || "12:00"));

  const toGantt = kind === "pedToGantt";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function submit() {
    if (!valid) return;
    await mutate((draft) => {
      if (toGantt) addPedItemToGantt(draft, "", id, date);
      else addPedItemToPed(draft, id, "", date, time);
    });
    toast.show(toGantt ? "Added to the Gantt" : "Added to the editorial plan");
    close();
  }

  return (
    <Sheet title={toGantt ? "Add to Gantt" : "Add to editorial plan"} onClose={close} dialog footer={
      <>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!valid}>Add</button>
      </>
    }>
      <SheetBody>
        <TextField label={toGantt ? "Gantt date" : "PED date"} type="date" value={date} onChange={(e) => setDate(e.target.value)} data-autofocus />
        {!toGantt && <TextField label="PED time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      </SheetBody>
    </Sheet>
  );
}
