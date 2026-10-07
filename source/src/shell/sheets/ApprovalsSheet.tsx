import { useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { CheckField, MultiPick, SelectField, TextAreaField, TextField } from "../../ui/fields";
import { EmptyState, Notice } from "../../ui/common";
import { ExternalLink, Inbox } from "../../ui/icons";
import { useApprovals } from "../../lib/approvalsStore";
import { ApprovalsError, approveEmailReview, buildApprovedTask, dismissEmailReview, validateApprovedTask, type EmailReview } from "../../external/approvals";

export default function ApprovalsSheet() {
  const { close } = useUI();
  const { reviews, error, loading, refresh } = useApprovals();
  const [openId, setOpenId] = useState("");
  return (
    <Sheet title="Tasks to approve" onClose={close} wide headerExtra={<button type="button" className="btn btn--sm btn--ghost" onClick={() => void refresh()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>}>
      <SheetBody>
        <p className="field-hint">Emails the assistant turned into task proposals. Check each one, then approve it into the Gantt or dismiss it.</p>
        {error && <Notice tone="error">{error} <button type="button" className="btn btn--sm" onClick={() => void refresh()}>Try again</button></Notice>}
        {!error && !loading && reviews.length === 0 && (
          <EmptyState icon={<Inbox />} title="Nothing to approve">New proposals appear here when emails come in.</EmptyState>
        )}
        <ul className="list-rows">
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewRow review={review} open={openId === review.id} onToggle={() => setOpenId(openId === review.id ? "" : review.id)} />
            </li>
          ))}
        </ul>
      </SheetBody>
    </Sheet>
  );
}

function ReviewRow({ review, open, onToggle }: { review: EmailReview; open: boolean; onToggle: () => void }) {
  const { data } = useBoard();
  const { choices, refresh } = useApprovals();
  const toast = useToast();
  const projects = choices.projects.length ? choices.projects : data.projects.map((p) => ({ value: p.id, label: p.name }));
  const statuses = choices.statuses.length ? choices.statuses : data.statuses.map((s) => ({ value: s.name, label: s.name }));
  const members = choices.members.length ? choices.members : data.members.map((m) => ({ value: m, label: m }));

  const task = review.task ?? {};
  const [name, setName] = useState(task.name ?? review.subject ?? "");
  const [projectId, setProjectId] = useState(task.projectId ?? projects[0]?.value ?? "");
  const [status, setStatus] = useState(task.status ?? statuses[0]?.value ?? "");
  const [who, setWho] = useState<string[]>(task.members ?? []);
  const [start, setStart] = useState(task.start ?? "");
  const [multi, setMulti] = useState(Boolean(task.end && task.end !== task.start));
  const [end, setEnd] = useState(task.end ?? "");
  const [info, setInfo] = useState(task.info ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function run(action: "approve" | "dismiss") {
    setProblem("");
    setBusy(true);
    try {
      if (action === "approve") {
        const approved = buildApprovedTask({ name, projectId, status, members: who.join(", "), start, end: multi ? end : start, info });
        const invalid = validateApprovedTask(approved);
        if (invalid) { setProblem(invalid); return; }
        await approveEmailReview(review.id, approved);
        toast.show("Task approved and added to the Gantt");
      } else {
        await dismissEmailReview(review.id);
        toast.show("Proposal dismissed");
      }
      await refresh();
    } catch (failure) {
      setProblem(failure instanceof ApprovalsError ? failure.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const received = review.receivedAt ? new Date(review.receivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="review">
      <button type="button" className="review-head" aria-expanded={open} onClick={onToggle}>
        <span className="list-row-title">{task.name || review.subject || "Untitled email"}</span>
        <span className="list-row-meta">
          {review.sender && <span>{review.sender}</span>}
          {received && <span>{received}</span>}
          {typeof task.confidence === "number" && <span>{Math.round(task.confidence * 100)}% match</span>}
        </span>
      </button>
      {open && (
        <div className="review-body">
          {review.excerpt && <blockquote className="review-excerpt">{review.excerpt}</blockquote>}
          {review.emailUrl && /^https?:\/\//i.test(review.emailUrl) && <a href={review.emailUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> Open the email</a>}
          <TextField label="Task name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row-2">
            <SelectField label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} options={projects} />
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={statuses} />
          </div>
          <MultiPick label="Who" value={who} onChange={setWho} options={members.map((m) => ({ value: m.value, label: m.label }))} />
          <div className="row-2">
            <TextField label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            {multi && <TextField label="End" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />}
          </div>
          <CheckField label="Runs over several days" checked={multi} onChange={setMulti} />
          <TextAreaField label="Link or notes" value={info} onChange={(e) => setInfo(e.target.value)} rows={2} />
          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="review-actions">
            <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void run("dismiss")}>Dismiss</button>
            <span className="spacer" />
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run("approve")}>{busy ? "Working…" : "Approve"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
