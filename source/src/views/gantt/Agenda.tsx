import { useMemo, useState, type CSSProperties } from "react";
import type { BoardData, Task } from "../../data/types";
import { currentDateKey, isBlockedStatus, isDoneStatus, shiftDateString } from "../../data/dates";
import { displayLabel } from "../../data/labelAliases";
import { dateRangeLabel, friendlyDate, parseDate, projectOf, socialOf, type PedItem } from "../../lib/gantt";
import { Avatars, StatusChip } from "../../ui/common";
import { Camera, CircleAlert, ListChecks, MoreHorizontal, Plus, Video, Home, CalendarDays } from "../../ui/icons";

interface AgendaProps {
  data: BoardData;
  tasks: Task[];
  pedItems: PedItem[];
  onOpenTask: (task: Task) => void;
  onOpenPost: (item: PedItem) => void;
  onStatus: (task: Task, anchor: DOMRect) => void;
  onContext: (task: Task, anchor: DOMRect) => void;
  onAdd: (date: string) => void;
}

const PAGE_DAYS = 14;

export function Agenda({ data, tasks, pedItems, onOpenTask, onOpenPost, onStatus, onContext, onAdd }: AgendaProps) {
  const today = currentDateKey();
  const [horizon, setHorizon] = useState(PAGE_DAYS);

  const groups = useMemo(() => {
    const limit = shiftDateString(today, horizon);
    const byDay = new Map<string, { tasks: Task[]; posts: PedItem[] }>();
    const bucket = (date: string) => {
      if (!byDay.has(date)) byDay.set(date, { tasks: [], posts: [] });
      return byDay.get(date)!;
    };
    tasks.forEach((task) => {
      if (!task.start) return;
      const end = task.end || task.start;
      // Unfinished tasks roll over to the next working day by themselves; one that has not been rolled yet
      // (nobody opened the app since) is shown under today. Done or blocked tasks in the past stay on the timeline.
      if (end < today && (isDoneStatus(task.status) || isBlockedStatus(task.status))) return;
      const day = task.start < today ? today : task.start;
      if (day > limit) return;
      bucket(day).tasks.push(task);
    });
    pedItems.forEach((item) => {
      if (!item.date || item.date < today || item.date > limit) return;
      bucket(item.date).posts.push(item);
    });
    bucket(today); // today is always shown
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        tasks: value.tasks.sort((a, b) => Number(isDoneStatus(a.status)) - Number(isDoneStatus(b.status)) || (a.nameEn || a.name).localeCompare(b.nameEn || b.name)),
        posts: value.posts.sort((a, b) => a.time.localeCompare(b.time))
      }));
  }, [tasks, pedItems, today, horizon]);

  const nothingAhead = groups.every((g) => g.tasks.length === 0 && g.posts.length === 0);

  return (
    <div className="view-scroll">
      <div className="agenda">
        {groups.map(({ date, tasks: dayTasks, posts }) => {
          const empty = dayTasks.length === 0 && posts.length === 0;
          return (
            <section key={date} className={`agenda-day${date === today ? " is-today" : ""}`} aria-label={friendlyDate(date, today)}>
              <div className="agenda-day-head">
                <h2>{friendlyDate(date, today)}</h2>
                <span className="agenda-sub">{parseDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`Add task on ${friendlyDate(date, today)}`} onClick={() => onAdd(date)}><Plus /></button>
              </div>
              <div className="agenda-list">
                {empty && <p className="agenda-empty">Nothing planned.</p>}
                {dayTasks.map((task) => (
                  <TaskCard key={task.id} data={data} task={task} onOpen={onOpenTask} onStatus={onStatus} onContext={onContext} showSpan={task.start < date} />
                ))}
                {posts.map((item) => <PostCard key={item.id} data={data} item={item} onOpen={onOpenPost} />)}
              </div>
            </section>
          );
        })}

        {nothingAhead && (
          <div className="empty">
            <div className="empty-mark" aria-hidden="true"><CalendarDays /></div>
            <h3>All clear</h3>
            <p>No tasks or posts in the next {horizon} days. Tap + to add one.</p>
          </div>
        )}

        <button type="button" className="btn btn--block" onClick={() => setHorizon((h) => h + PAGE_DAYS)}>Show the next {PAGE_DAYS} days</button>
      </div>
    </div>
  );
}

export function TaskCard({ data, task, onOpen, onStatus, onContext, showSpan }: {
  data: BoardData; task: Task; showSpan?: boolean;
  onOpen: (task: Task) => void; onStatus: (task: Task, anchor: DOMRect) => void; onContext: (task: Task, anchor: DOMRect) => void;
}) {
  const project = projectOf(data.projects, task.projectId);
  const done = isDoneStatus(task.status);
  const doneCount = task.subtasks.filter((s) => s.done).length;
  const label = displayLabel(task.label);
  const style = { "--p": project?.color ?? "var(--orange)" } as CSSProperties;
  return (
    <div className={`task-card${done ? " is-done" : ""}`} style={style}>
      <span className="task-card-swatch" aria-hidden="true" />
      <button type="button" className="task-card-main" style={{ textAlign: "left" }} onClick={() => onOpen(task)} aria-label={`Open task ${task.nameEn || task.name}`}>
        <span className="task-card-title">{task.nameEn || task.name}</span>
        <span className="task-card-meta">
          {project && <span className="meta-item">{project.name}</span>}
          <span className="meta-item">{showSpan ? `until ${parseDate(task.end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : dateRangeLabel(task)}</span>
          {label && (label.toLowerCase() === "publication" ? <span className="meta-item"><Camera aria-hidden />{label}</span> : label.toLowerCase() === "video in store" ? <span className="meta-item"><Home aria-hidden />{label}</span> : <span className="meta-item">{label}</span>)}
          {task.subtasks.length > 0 && <span className="meta-item"><ListChecks aria-hidden />{doneCount}/{task.subtasks.length}</span>}
          {task.members.length ? <Avatars names={task.members} /> : <span className="card-unassigned"><CircleAlert aria-hidden />Unassigned</span>}
        </span>
      </button>
      <span className="task-card-actions">
        <StatusChip statuses={data.statuses} name={task.status} onClick={(event) => onStatus(task, event.currentTarget.getBoundingClientRect())} />
        <button type="button" className="icon-btn icon-btn--sm" aria-label="More actions" onClick={(event) => onContext(task, event.currentTarget.getBoundingClientRect())}><MoreHorizontal /></button>
      </span>
    </div>
  );
}

export function PostCard({ data, item, onOpen }: { data: BoardData; item: PedItem; onOpen: (item: PedItem) => void }) {
  const style = { "--p": item.color } as CSSProperties;
  return (
    <button type="button" className="task-card post-row" style={style} onClick={() => onOpen(item)} aria-label={`Open post ${item.title}`}>
      <span className="ped-time">{item.time}</span>
      <span className="task-card-main">
        <span className="task-card-title">{item.title}</span>
        <span className="task-card-meta">
          <span className="meta-item"><Video aria-hidden />{item.format}</span>
          {item.social.map((id) => {
            const social = socialOf(data.socials, id);
            return <span key={id} className="chip" style={{ background: social?.color ?? "var(--ink)", color: "#fff", borderColor: "transparent", minHeight: 20, padding: "0 7px" }}>{social?.short ?? id}</span>;
          })}
          {item.project && <span className="meta-item">{item.project}</span>}
          {item.members.length > 0 && <Avatars names={item.members} />}
        </span>
      </span>
      <StatusChip statuses={data.pedStatuses} name={item.status} as="span" />
    </button>
  );
}
