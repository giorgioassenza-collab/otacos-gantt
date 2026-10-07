import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BoardData, Project, Task } from "../../data/types";
import { currentDateKey, isDoneStatus, shiftDateString } from "../../data/dates";
import { displayLabel } from "../../data/labelAliases";
import { dateFromIndex, dayIndex, initials, layoutProjectRow, parseDate, timelineWindow, weekdayShort, type PedItem } from "../../lib/gantt";
import { statusColor } from "../../lib/gantt";
import { Camera, Home, ListChecks, CircleAlert, Plus, Video } from "../../ui/icons";

export interface TimelineHandle { scrollToToday: (smooth?: boolean) => void }

interface TimelineProps {
  data: BoardData;
  projects: Project[];
  tasks: Task[];
  pedItems: PedItem[];
  dayWidth: number;
  onOpenTask: (task: Task) => void;
  onOpenPost: (item: PedItem) => void;
  onChangeDates: (taskId: string, start: string, end: string) => void;
  onAdd: (projectId: string, date: string) => void;
  onContext: (task: Task, x: number, y: number) => void;
}

const BAR_MIN_META_WIDTH = 150;

function labelIcon(label: string) {
  const text = displayLabel(label).toLowerCase();
  if (text === "video in store") return <Home aria-label="Video in store" />;
  if (text === "publication") return <Camera aria-label="Publication" />;
  return null;
}

export const Timeline = memo(forwardRef<TimelineHandle, TimelineProps>(function Timeline(props, ref) {
  const { data, projects, tasks, pedItems, dayWidth, onOpenTask, onOpenPost, onChangeDates, onAdd, onContext } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const todayKey = currentDateKey();

  const win = useMemo(() => timelineWindow(parseDate(todayKey)), [todayKey]);
  const months = useMemo(() => {
    const list: { key: string; label: string; days: number; start: number }[] = [];
    let offset = 0;
    for (let i = 0; i < win.months; i += 1) {
      const first = new Date(win.start.getFullYear(), win.start.getMonth() + i, 1);
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      list.push({ key: `${first.getFullYear()}-${first.getMonth()}`, label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), days, start: offset });
      offset += days;
    }
    return list;
  }, [win]);

  const todayIndex = dayIndex(win.start, todayKey);

  const rows = useMemo(() => projects.map((project) => {
    const ptasks = tasks.filter((task) => task.projectId === project.id && task.start && task.end);
    const pposts = pedItems.filter((item) => item.projectId === project.id && item.date);
    const layout = layoutProjectRow(ptasks, pposts, win.start);
    return { project, ...layout };
  }), [projects, tasks, pedItems, win]);

  useImperativeHandle(ref, () => ({
    scrollToToday(smooth = true) {
      const node = scrollRef.current;
      if (!node) return;
      const side = parseFloat(getComputedStyle(node.parentElement as HTMLElement).getPropertyValue("--side")) || 112;
      const target = todayIndex * dayWidth - Math.max(24, (node.clientWidth - side) / 4);
      node.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
    }
  }), [todayIndex, dayWidth]);

  // land on today the first time the timeline appears
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const side = parseFloat(getComputedStyle(node.parentElement as HTMLElement).getPropertyValue("--side")) || 112;
    node.scrollLeft = Math.max(0, todayIndex * dayWidth - Math.max(24, (node.clientWidth - side) / 4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pointer interaction shared by move and both resize handles. Mouse starts after 4px, touch after a 380ms hold. */
  function begin(event: ReactPointerEvent<HTMLElement>, task: Task, mode: "move" | "start" | "end") {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest("button")) return;
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".bar");
    if (!bar) return;
    if (mode !== "move") event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const isTouch = event.pointerType === "touch";
    const baseLeft = bar.offsetLeft;
    const baseWidth = bar.offsetWidth;
    let active = false;
    let delta = 0;
    let timer = 0;

    const blockScroll = (e: TouchEvent) => { if (active) e.preventDefault(); };
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", blockScroll);
    };
    const reset = () => {
      bar.classList.remove("is-dragging");
      bar.style.transform = "";
      bar.style.left = `${baseLeft}px`;
      bar.style.width = `${baseWidth}px`;
    };
    const activate = () => {
      active = true;
      bar.classList.add("is-dragging");
      navigator.vibrate?.(8);
    };
    const apply = () => {
      if (mode === "move") bar.style.transform = `translateX(${delta * dayWidth}px)`;
      if (mode === "start") { bar.style.left = `${baseLeft + delta * dayWidth}px`; bar.style.width = `${baseWidth - delta * dayWidth}px`; }
      if (mode === "end") bar.style.width = `${baseWidth + delta * dayWidth}px`;
    };
    function onMove(e: PointerEvent) {
      const dx = e.clientX - startX;
      if (!active) {
        const moved = Math.hypot(dx, e.clientY - startY);
        if (isTouch) { if (moved > 8) cleanup(); return; }
        if (moved > 4) activate(); else return;
      }
      const length = Math.max(1, dayIndex(parseDate(task.start), task.end || task.start) + 1);
      let next = Math.round(dx / dayWidth);
      if (mode === "start") next = Math.min(next, length - 1);
      if (mode === "end") next = Math.max(next, -(length - 1));
      if (next !== delta) { delta = next; apply(); }
    }
    function onUp() {
      cleanup();
      if (!active) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 250);
      if (delta === 0) { reset(); return; }
      const end = task.end || task.start;
      if (mode === "move") onChangeDates(task.id, shiftDateString(task.start, delta), shiftDateString(end, delta));
      else if (mode === "start") onChangeDates(task.id, shiftDateString(task.start, delta), end);
      else onChangeDates(task.id, task.start, shiftDateString(end, delta));
    }
    function onCancel() { cleanup(); if (active) reset(); }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (isTouch) {
      window.addEventListener("touchmove", blockScroll, { passive: false });
      timer = window.setTimeout(activate, 380);
    }
  }

  function onKey(event: KeyboardEvent<HTMLElement>, task: Task) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task); return; }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onContext(task, rect.left, rect.bottom);
      return;
    }
    const dir = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    event.preventDefault();
    const end = task.end || task.start;
    if (event.altKey) {
      const nextEnd = shiftDateString(end, dir);
      if (nextEnd >= task.start) onChangeDates(task.id, task.start, nextEnd);
    } else if (event.shiftKey) {
      onChangeDates(task.id, shiftDateString(task.start, dir), shiftDateString(end, dir));
    }
  }

  const totalWidth = win.days * dayWidth;

  return (
    <div className="gantt-scroll" ref={scrollRef} tabIndex={-1}>
      <div className="gantt-canvas">
        <div className="gantt-head">
          <div className="gantt-corner">Project</div>
          <div>
            <div className="gantt-months" style={{ width: totalWidth }}>
              {months.map((month) => (
                <div key={month.key} className="gantt-month" style={{ width: month.days * dayWidth }}>
                  <div className="gantt-month-name">{month.label}</div>
                  <div className="gantt-days">
                    {Array.from({ length: month.days }, (_, i) => {
                      const index = month.start + i;
                      const date = new Date(win.start.getFullYear(), win.start.getMonth(), win.start.getDate() + index);
                      const weekday = date.getDay();
                      const isToday = index === todayIndex;
                      return (
                        <div key={i} className={`gantt-day${weekday === 0 || weekday === 6 ? " is-weekend" : ""}${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined}>
                          <span>{weekdayShort(date)}</span>
                          <b>{date.getDate()}</b>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="gantt-body">
          <div className="gantt-bands" style={{ width: totalWidth }} aria-hidden="true">
            {Array.from({ length: win.days }, (_, i) => {
              const weekday = new Date(win.start.getFullYear(), win.start.getMonth(), win.start.getDate() + i).getDay();
              return weekday === 0 || weekday === 6 ? <div key={i} className="gantt-band" style={{ left: i * dayWidth }} /> : null;
            })}
            <div className="gantt-today" style={{ left: todayIndex * dayWidth }} />
          </div>

          {rows.map(({ project, taskLayouts, pedLayouts, laneCount }) => {
            const height = Math.max(64, laneCount * 36 + 14);
            return (
              <div key={project.id} className="gantt-row" style={{ height }}>
                <div className="gantt-label">
                  <span className="gantt-label-dot" style={{ background: project.color }} />
                  <span className="gantt-label-name">{project.name}</span>
                  <button type="button" className="gantt-label-add" aria-label={`Add task to ${project.name}`} onClick={() => onAdd(project.id, todayKey)}><Plus /></button>
                </div>
                <div
                  className="gantt-lanes"
                  style={{ width: totalWidth, height }}
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest(".bar, .ped-chip")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    onAdd(project.id, dateFromIndex(win.start, Math.floor((event.clientX - rect.left) / dayWidth)));
                  }}
                >
                  {taskLayouts.map(({ task, startIndex, endIndex, lane }) => {
                    const width = (endIndex - startIndex + 1) * dayWidth - 4;
                    const done = isDoneStatus(task.status);
                    const subtaskDone = task.subtasks.filter((s) => s.done).length;
                    const style = { left: startIndex * dayWidth + 2, top: 8 + lane * 36, width, "--p": project.color } as CSSProperties;
                    const showMeta = width >= BAR_MIN_META_WIDTH;
                    const icon = labelIcon(task.label);
                    return (
                      <div
                        key={task.id}
                        className={`bar${done ? " is-done" : ""}`}
                        style={style}
                        role="button"
                        tabIndex={0}
                        aria-label={`${task.nameEn || task.name}. ${task.status || "No status"}. ${task.members.join(", ") || "Unassigned"}. Shift and arrow keys move it, Alt and arrow keys change its length.`}
                        title={`${task.nameEn || task.name}\nStatus: ${task.status || "-"}\nWho: ${task.members.join(", ") || "-"}`}
                        onPointerDown={(event) => begin(event, task, "move")}
                        onClick={() => { if (!suppressClick.current) onOpenTask(task); }}
                        onContextMenu={(event) => { event.preventDefault(); onContext(task, event.clientX, event.clientY); }}
                        onKeyDown={(event) => onKey(event, task)}
                      >
                        <span className="bar-handle bar-handle--start" onPointerDown={(event) => begin(event, task, "start")} aria-hidden="true" />
                        <span className="bar-status" style={{ background: statusColor(data.statuses, task.status) }} aria-hidden="true" />
                        <span className="bar-title">{task.nameEn || task.name}</span>
                        <span className="bar-meta">
                          {task.members.length === 0 && <CircleAlert style={{ color: "var(--danger)" }} aria-label="Unassigned" />}
                          {icon}
                          {task.subtasks.length > 0 && showMeta && <><ListChecks aria-hidden />{subtaskDone}/{task.subtasks.length}</>}
                          {showMeta && task.members.slice(0, 2).map((m) => <span key={m} className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{initials(m)}</span>)}
                        </span>
                        <span className="bar-handle bar-handle--end" onPointerDown={(event) => begin(event, task, "end")} aria-hidden="true" />
                      </div>
                    );
                  })}
                  {pedLayouts.map(({ item, index, lane }) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ped-chip"
                      style={{ left: index * dayWidth + 2, top: 8 + lane * 36, width: dayWidth - 4, "--p": item.color } as CSSProperties}
                      onClick={() => onOpenPost(item)}
                      title={`Post ${item.time} · ${item.title}`}
                    >
                      <Video aria-hidden />
                      <span>{item.time} {item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}));
