import { useCallback, useMemo, useRef, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { useMenu } from "../../ui/Menu";
import { usePref } from "../../lib/usePref";
import { currentDateKey, isDoneStatus, shiftDateString } from "../../data/dates";
import { isClientName } from "../../data/util";
import { touchItem } from "../../data/merge";
import { buildPedItems, type PedItem } from "../../lib/gantt";
import { deleteTask, duplicateTask, ensureStatus, moveTask, setTaskStatus } from "../../lib/actions";
import { Agenda } from "./Agenda";
import { Timeline, type TimelineHandle } from "./Timeline";
import { EmptyState } from "../../ui/common";
import { ChevronLeft, ChevronRight, GanttChart, Plus, ZoomIn, ZoomOut, Settings } from "../../ui/icons";
import type { Task } from "../../data/types";

const ZOOMS = [
  { label: "XS", width: 40 },
  { label: "S", width: 64 },
  { label: "M", width: 96 },
  { label: "L", width: 140 },
  { label: "XL", width: 200 }
];

const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 719px)").matches;

export default function GanttView() {
  const { data, mutate, sync } = useBoard();
  const { open } = useUI();
  const toast = useToast();
  const menu = useMenu();
  const timeline = useRef<TimelineHandle>(null);

  const [mode, setMode] = usePref<"agenda" | "timeline">("otw2.gantt.mode", isNarrow() ? "agenda" : "timeline");
  const [zoom, setZoom] = usePref<number>("otw2.gantt.zoom", isNarrow() ? 1 : 2);
  const [who, setWho] = usePref<string>("otw2.gantt.who", "all");
  const [listKey, setListKey] = useState(0);
  const [agendaFrom, setAgendaFrom] = useState(() => currentDateKey());

  // arrows: the timeline scrolls a week sideways, the agenda moves its first day a week
  const shift = (days: number) => {
    if (mode === "timeline") timeline.current?.scrollByDays(days);
    else setAgendaFrom((from) => shiftDateString(from, days));
  };
  const toToday = () => {
    if (mode === "timeline") timeline.current?.scrollToToday();
    else { setAgendaFrom(currentDateKey()); setListKey((k) => k + 1); }
  };

  const matches = useCallback((task: Task) => {
    if (who === "all") return true;
    if (isClientName(who)) return task.status.toLowerCase().includes(who.toLowerCase());
    return task.members.includes(who);
  }, [who]);

  const tasks = useMemo(() => data.tasks.filter(matches), [data.tasks, matches]);
  const pedItems = useMemo(() => buildPedItems(data).filter((item) => who === "all" || item.members.includes(who)), [data, who]);

  const projects = useMemo(() => {
    if (who === "all") return data.projects;
    const ids = new Set([...tasks.map((t) => t.projectId), ...pedItems.map((p) => p.projectId)]);
    return data.projects.filter((project) => ids.has(project.id));
  }, [data.projects, tasks, pedItems, who]);

  const whoOptions = useMemo(() => {
    const pending = (name: string) => data.tasks.filter((t) => (isClientName(name) ? t.status.toLowerCase().includes(name.toLowerCase()) : t.members.includes(name))).filter((t) => !isDoneStatus(t.status)).length;
    const members = data.members.filter((m) => !isClientName(m));
    const clients = ["Giorgia", "Alice"].filter((c) => pending(c) > 0);
    return [...members, ...clients].map((name) => ({ value: name, label: pending(name) > 0 ? `${name} (${pending(name)})` : name }));
  }, [data]);

  const hasProjects = data.projects.length > 0;

  const openTask = useCallback((task: Task) => open({ kind: "task", id: task.id }), [open]);
  // task-backed items without a PED post yet use their `task-<id>` key; the post sheet creates the mirror on save
  const openPost = useCallback((item: PedItem) => open({ kind: "post", id: item.postId ?? item.id }), [open]);

  const addTask = useCallback((projectId: string, date: string) => {
    open({ kind: "task", defaults: { projectId, start: date, end: date } });
  }, [open]);

  const changeDates = useCallback((taskId: string, start: string, end: string) => {
    void mutate((draft) => { moveTask(draft, taskId, start, end); });
  }, [mutate]);

  function statusMenu(task: Task, anchor: DOMRect) {
    menu.open(anchor, data.statuses.map((status) => ({
      key: status.name,
      label: (<><span className="chip-dot" style={{ color: status.color }} />{status.name}</>),
      checked: task.status === status.name,
      onSelect: () => { void mutate((draft) => setTaskStatus(draft, task.id, status.name)); }
    })), "Set status");
  }

  function contextMenu(task: Task, anchor: DOMRect | { x: number; y: number }) {
    const done = isDoneStatus(task.status);
    menu.open(anchor, [
      { key: "open", label: "Open", onSelect: () => openTask(task) },
      { key: "done", label: done ? "Reopen" : "Mark done", onSelect: () => { void mutate((draft) => { const name = done ? (draft.statuses.find((s) => !isDoneStatus(s.name))?.name ?? "") : ensureStatus(draft, "DONE", "#d1d5db"); setTaskStatus(draft, task.id, name); }); } },
      { key: "today", label: "Move to today", onSelect: () => { const t = currentDateKey(); void mutate((draft) => moveTask(draft, task.id, t)); } },
      { key: "tomorrow", label: "Move to tomorrow", onSelect: () => { const t = shiftDateString(currentDateKey(), 1); void mutate((draft) => moveTask(draft, task.id, t)); } },
      { key: "ped", label: "Add to editorial plan…", onSelect: () => open({ kind: "ganttToPed", taskId: task.id }) },
      { key: "dup", label: "Duplicate", onSelect: () => { void mutate((draft) => { duplicateTask(draft, task.id); }); toast.show("Task duplicated"); } },
      { key: "div", label: "", divider: true, onSelect: () => {} },
      { key: "del", label: "Delete", danger: true, onSelect: () => {
        void mutate((draft) => deleteTask(draft, task.id));
        toast.show("Task deleted", { action: { label: "Undo", run: () => void sync.undo() } });
      } }
    ], "Task actions");
  }

  const dayWidth = ZOOMS[Math.min(zoom, ZOOMS.length - 1)].width;

  return (
    <div className="gantt" style={{ ["--day" as string]: `${dayWidth}px` }}>
      <div className="view-toolbar" role="toolbar" aria-label="Gantt controls">
        <div className="segmented" role="group" aria-label="Move in time">
          <button type="button" aria-label="Back one week" title="Back one week" onClick={() => shift(-7)}><ChevronLeft size={16} /></button>
          <button type="button" onClick={toToday}>Today</button>
          <button type="button" aria-label="Forward one week" title="Forward one week" onClick={() => shift(7)}><ChevronRight size={16} /></button>
        </div>
        <select className="select select--sm select-compact" aria-label="Show tasks for" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Everyone</option>
          {whoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={mode === "agenda"} onClick={() => setMode("agenda")}>Agenda</button>
          <button type="button" aria-pressed={mode === "timeline"} onClick={() => setMode("timeline")}>Timeline</button>
        </div>
        {mode === "timeline" && (
          <div className="segmented" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(Math.max(0, zoom - 1))}><ZoomOut size={16} /></button>
            <button type="button" aria-label={`Zoom ${ZOOMS[zoom].label}`} disabled style={{ minWidth: 34, opacity: 1, color: "var(--ink)" }}>{ZOOMS[zoom].label}</button>
            <button type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))}><ZoomIn size={16} /></button>
          </div>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => open({ kind: "projects" })}><Settings />Projects</button>
        <span className="grow" />
        <button type="button" className="btn btn--primary new-btn" onClick={() => open({ kind: "task", defaults: { start: currentDateKey(), end: currentDateKey() } })} disabled={!hasProjects} aria-label="New task">
          <Plus /><span className="new-label">New task</span>
        </button>
      </div>

      {!hasProjects ? (
        <EmptyState icon={<GanttChart />} title="Start with a project" action={<button type="button" className="btn btn--primary" onClick={() => open({ kind: "projects" })}>Add a project</button>}>
          Projects are the rows of the Gantt. Add one, then add tasks to it.
        </EmptyState>
      ) : mode === "agenda" ? (
        <Agenda
          key={listKey}
          data={data}
          tasks={tasks}
          pedItems={pedItems}
          onOpenTask={openTask}
          onOpenPost={openPost}
          onStatus={statusMenu}
          onContext={(task, anchor) => contextMenu(task, anchor)}
          onAdd={(date) => open({ kind: "task", defaults: { start: date, end: date } })}
          from={agendaFrom}
          onShift={shift}
          onToday={toToday}
        />
      ) : projects.length === 0 ? (
        <EmptyState icon={<GanttChart />} title="Nothing for this person">No tasks are assigned to {who} yet.</EmptyState>
      ) : (
        <Timeline
          ref={timeline}
          data={data}
          projects={projects}
          tasks={tasks}
          pedItems={pedItems}
          dayWidth={dayWidth}
          onOpenTask={openTask}
          onOpenPost={openPost}
          onChangeDates={changeDates}
          onAdd={addTask}
          onContext={(task, x, y) => contextMenu(task, { x, y })}
        />
      )}
      {menu.element}
    </div>
  );
}

// kept so unused-import tooling stays quiet when touchItem is only needed by future actions
void touchItem;
