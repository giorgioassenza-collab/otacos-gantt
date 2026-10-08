import type { ReactNode } from "react";
import { useBoard } from "../../store";
import { useMenu } from "../../ui/Menu";
import { setPedStatus, setTaskStatus } from "../../lib/actions";
import type { Status } from "../../data/types";
import { useUI } from "../../ui/uiContext";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { EmptyState, StatusChip } from "../../ui/common";
import { CircleAlert, CircleCheck, ListChecks, MessageSquare, Video } from "../../ui/icons";
import { useIdentity } from "../../lib/identity";
import { useNotifications } from "../../lib/notificationsStore";
import { currentDateKey, taskDateKey } from "../../data/dates";
import { friendlyDate, projectOf } from "../../lib/gantt";
import { displayLabel } from "../../data/labelAliases";

/** "For you": everything pending for the person using this device, grouped by what it is. */
export default function NotificationsSheet() {
  const { data, mutate } = useBoard();
  const menu = useMenu();
  const { close, open } = useUI();
  const { me } = useIdentity();
  const notes = useNotifications();
  const today = currentDateKey();

  // reading the panel counts as seeing the mentions: they are marked as read when you leave it, not while you read
  const leave = (next?: Parameters<typeof open>[0]) => { notes.markMentionsSeen(); if (next) open(next); else close(); };

  /** The status chip opens the list of statuses right here, so a row can be settled without opening the whole card. */
  function pickStatus(anchor: DOMRect, statuses: Status[], current: string, apply: (draft: Parameters<Parameters<typeof mutate>[0]>[0], status: string) => void) {
    menu.open(anchor, statuses.map((status) => ({
      key: status.name,
      label: (<><span className="chip-dot" style={{ color: status.color }} />{status.name}</>),
      checked: current === status.name,
      onSelect: () => { void mutate((draft) => apply(draft, status.name)); }
    })), "Set status");
  }

  const nothing = notes.tasks.length + notes.subtasks.length + notes.posts.length + notes.mentions.length === 0;
  const nameFound = [...data.members, "Giorgia", "Alice"].some((m) => m.toLowerCase().replace(/[.\s]/g, "") === me.toLowerCase().replace(/[.\s]/g, ""));

  return (
    <Sheet title={`For you · ${me}`} onClose={() => leave()} wide headerExtra={notes.count > 0 ? <span className="chip" style={{ background: "var(--orange)", borderColor: "transparent" }}>{notes.count} to do</span> : undefined}>
      <SheetBody>
        {nothing && (
          <EmptyState icon={<CircleCheck />} title="You are all caught up">
            Nothing is waiting for you. Tasks, posts and comments that tag you appear here.
            {!nameFound && <> No person called {me} is set up in Settings, so tasks cannot be assigned to this name yet.</>}
          </EmptyState>
        )}

        {notes.tasks.length > 0 && (
          <Group title="Tasks" count={notes.tasks.length}>
            {notes.tasks.map(({ task, subtasks }) => {
              const date = taskDateKey(task);
              const late = date < today;
              const project = projectOf(data.projects, task.projectId);
              return (
                <li key={task.id} className="note-item">
                  <button type="button" className="note-open" onClick={() => leave({ kind: "task", id: task.id })}>
                    <span className="gantt-label-dot" style={{ background: project?.color }} aria-hidden="true" />
                    <span className="note-main">
                      <span className="list-row-title">{task.nameEn || task.name}</span>
                      <span className="list-row-meta">
                        <span className={late ? "note-late" : undefined}>{late && <CircleAlert size={13} aria-hidden />} {friendlyDate(date, today)}</span>
                        {project && <span>{project.name}</span>}
                        {task.label && <span>{displayLabel(task.label)}</span>}
                        {subtasks.length > 0 && <span><ListChecks size={13} aria-hidden /> {subtasks.length} of your subtasks</span>}
                      </span>
                    </span>
                  </button>
                  <StatusChip statuses={data.statuses} name={task.status} onClick={(event) => pickStatus(event.currentTarget.getBoundingClientRect(), data.statuses, task.status, (draft, status) => setTaskStatus(draft, task.id, status))} />
                </li>
              );
            })}
          </Group>
        )}

        {notes.subtasks.length > 0 && (
          <Group title="Subtasks" count={notes.subtasks.length}>
            {notes.subtasks.map(({ task, subtask }) => (
              <li key={subtask.id}>
                <button type="button" className="note-row" onClick={() => leave({ kind: "task", id: task.id })}>
                  <ListChecks className="note-icon" aria-hidden />
                  <span className="note-main">
                    <span className="list-row-title">{subtask.title}</span>
                    <span className="list-row-meta"><span>in {task.nameEn || task.name}</span><span>{friendlyDate(taskDateKey(task), today)}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </Group>
        )}

        {notes.posts.length > 0 && (
          <Group title="Posts" count={notes.posts.length}>
            {notes.posts.map((item) => (
              <li key={item.id} className="note-item">
                <button type="button" className="note-open" onClick={() => leave({ kind: "post", id: item.postId ?? item.id })}>
                  <Video className="note-icon" aria-hidden />
                  <span className="note-main">
                    <span className="list-row-title">{item.title}</span>
                    <span className="list-row-meta"><span>{friendlyDate(item.date, today)} · {item.time}</span><span>{item.format}</span>{item.project && <span>{item.project}</span>}</span>
                  </span>
                </button>
                <StatusChip statuses={data.pedStatuses} name={item.status} onClick={(event) => pickStatus(event.currentTarget.getBoundingClientRect(), data.pedStatuses, item.status, (draft, status) => setPedStatus(draft, item, status))} />
              </li>
            ))}
          </Group>
        )}

        {notes.mentions.length > 0 && (
          <Group title="Mentions" count={notes.mentions.length}>
            {notes.mentions.map(({ comment, postId, postTitle }) => (
              <li key={comment.id}>
                <button type="button" className="note-row" onClick={() => leave({ kind: "post", id: postId })}>
                  <MessageSquare className="note-icon" aria-hidden />
                  <span className="note-main">
                    <span className="list-row-title note-quote">{comment.text}</span>
                    <span className="list-row-meta"><span>on {postTitle}</span><span>{new Date(comment.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </Group>
        )}
      </SheetBody>
      {menu.element}
    </Sheet>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="note-group" aria-label={title}>
      <h3 className="sheet-section-title">{title} <span className="muted">{count}</span></h3>
      <ul className="list-rows">{children}</ul>
    </section>
  );
}

