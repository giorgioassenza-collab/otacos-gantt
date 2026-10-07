import { useMemo, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { useMenu } from "../../ui/Menu";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { EmptyState, StatusChip } from "../../ui/common";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, Clock, GanttChart, MoreHorizontal, Store, Video } from "../../ui/icons";
import type { BoardData, Status } from "../../data/types";
import { currentDateKey, dateKey, shiftDateString } from "../../data/dates";
import { friendlyDate, parseDate, statusColor } from "../../lib/gantt";
import {
  KIND_LABEL, buildCreatorEntries, deleteCreatorItem, entryDescription, setCreatorStatus,
  type CreatorEntry, type CreatorKind
} from "./creatorItems";

const NO_STORE = "__none__";
const MAX_PER_DAY = 3;
const FALLBACK_COLOR = "#d7dde5";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WIDE_QUERY = "(min-width: 900px)";
function subscribeWide(callback: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);

function monthKeyOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(monthStart: string, delta: number): string {
  const d = parseDate(monthStart);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

function monthLabel(monthStart: string): string {
  return parseDate(monthStart).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Monday-first weeks covering the month, as arrays of date keys. */
function monthWeeks(monthStart: string): string[][] {
  const first = parseDate(monthStart);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const gridStart = shiftDateString(monthStart, -lead);
  return Array.from({ length: weekCount }, (_, week) => Array.from({ length: 7 }, (_, day) => shiftDateString(gridStart, week * 7 + day)));
}

function longDate(date: string): string {
  return parseDate(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function shortDate(date: string): string {
  return parseDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function KindIcon({ kind }: { kind: CreatorKind }) {
  return kind === "video" ? <Video aria-hidden /> : <Camera aria-hidden />;
}

export default function CreatorView() {
  const { data, mutate, sync } = useBoard();
  const { open, go } = useUI();
  const toast = useToast();
  const menu = useMenu();
  const wide = useWide();
  const today = currentDateKey();

  const [month, setMonth] = useState(() => monthKeyOf(today));
  const [storeFilter, setStoreFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pastOpen, setPastOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  const entries = useMemo(() => buildCreatorEntries(data), [data]);
  const statuses = data.creatorStatuses;

  const storeOptions = useMemo(
    () => [...new Set([...data.creatorStores, ...entries.map((entry) => entry.store).filter(Boolean)])],
    [data.creatorStores, entries]
  );
  const statusOptions = useMemo(
    () => [...new Set([...statuses.map((status) => status.name), ...entries.map((entry) => entry.status).filter(Boolean)])],
    [statuses, entries]
  );
  const hasUnstored = entries.some((entry) => !entry.store);

  // A filter that points at a deleted store/status falls back to "all" instead of hiding everything.
  const effectiveStore = storeFilter === "all" || (storeFilter === NO_STORE && hasUnstored) || storeOptions.includes(storeFilter) ? storeFilter : "all";
  const effectiveStatus = statusFilter === "all" || statusOptions.includes(statusFilter) ? statusFilter : "all";
  const filtering = effectiveStore !== "all" || effectiveStatus !== "all";

  const visible = useMemo(
    () => entries.filter((entry) =>
      (effectiveStore === "all" || (effectiveStore === NO_STORE ? !entry.store : entry.store === effectiveStore))
      && (effectiveStatus === "all" || entry.status === effectiveStatus)
    ),
    [entries, effectiveStore, effectiveStatus]
  );

  const colorOf = (status: string) => statusColor(statuses, status, FALLBACK_COLOR);

  function save(change: (draft: BoardData) => void, failure: string) {
    mutate(change).catch(() => toast.show(failure, { error: true }));
  }

  function edit(entry: CreatorEntry) {
    setDayOpen(null);
    open({ kind: "creator", id: entry.taskId });
  }

  function remove(entry: CreatorEntry) {
    save((draft) => deleteCreatorItem(draft, entry.taskId), "Could not delete this item. Check the connection and try again.");
    toast.show("Creator item deleted", { action: { label: "Undo", run: () => void sync.undo() } });
  }

  function statusMenu(entry: CreatorEntry, anchor: DOMRect) {
    menu.open(anchor, statuses.map((status) => ({
      key: status.name,
      label: (<><span className="chip-dot" style={{ color: status.color }} />{status.name}</>),
      checked: entry.status === status.name,
      onSelect: () => save((draft) => setCreatorStatus(draft, entry.taskId, status.name), "Could not change the status. Try again.")
    })), "Set status");
  }

  function actionsMenu(entry: CreatorEntry, anchor: DOMRect | { x: number; y: number }) {
    menu.open(anchor, [
      { key: "modify", label: "Modify", onSelect: () => edit(entry) },
      { key: "delete", label: "Delete", danger: true, onSelect: () => remove(entry) }
    ], "Creator item actions");
  }

  function contextAnchor(event: MouseEvent<HTMLElement>): DOMRect | { x: number; y: number } {
    // The keyboard context-menu key reports 0,0: anchor to the element instead.
    if (event.clientX === 0 && event.clientY === 0) return event.currentTarget.getBoundingClientRect();
    return { x: event.clientX, y: event.clientY };
  }

  function openContext(entry: CreatorEntry, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    actionsMenu(entry, contextAnchor(event));
  }

  const byDate = useMemo(() => {
    const map = new Map<string, CreatorEntry[]>();
    visible.forEach((entry) => {
      const list = map.get(entry.date);
      if (list) list.push(entry); else map.set(entry.date, [entry]);
    });
    return map;
  }, [visible]);

  const hasShoots = entries.length > 0;

  const toolbar = (
    <div className="view-toolbar" role="toolbar" aria-label="Creator calendar controls">
      {wide && (
        <>
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></button>
          <h2 className="cc-month-label" aria-live="polite">{monthLabel(month)}</h2>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></button>
          <button type="button" className="btn btn--sm" onClick={() => setMonth(monthKeyOf(today))}>Today</button>
        </>
      )}
      <select className="select select--sm select-compact" aria-label="Filter by store" value={effectiveStore} onChange={(e) => setStoreFilter(e.target.value)}>
        <option value="all">All stores</option>
        {storeOptions.map((store) => <option key={store} value={store}>{store}</option>)}
        {hasUnstored && <option value={NO_STORE}>No store</option>}
      </select>
      <select className="select select--sm select-compact" aria-label="Filter by status" value={effectiveStatus} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="all">All statuses</option>
        {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      {filtering && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setStoreFilter("all"); setStatusFilter("all"); }}>Clear filters</button>
      )}
    </div>
  );

  if (!hasShoots) {
    return (
      <div className="cc">
        <EmptyState
          icon={<Video />}
          title="No creator shoots yet"
          action={<button type="button" className="btn btn--primary" onClick={() => go("gantt")}><GanttChart />Open the Gantt</button>}
        >
          This calendar is built from Gantt tasks labelled Video in store, together with their linked Publication task. Create them from a task labelled creator (Creator workflow), or add the Video in store label to a task.
        </EmptyState>
      </div>
    );
  }

  const cardProps = { colorOf, statuses, onEdit: edit, onStatus: statusMenu, onActions: actionsMenu, onContext: openContext };

  return (
    <div className="cc">
      {toolbar}
      {visible.length === 0 ? (
        <EmptyState
          icon={<Video />}
          title="Nothing matches these filters"
          action={<button type="button" className="btn" onClick={() => { setStoreFilter("all"); setStatusFilter("all"); }}>Clear filters</button>}
        >
          Try another store or status to see the shoots and publications again.
        </EmptyState>
      ) : wide ? (
        <MonthGrid
          month={month}
          today={today}
          byDate={byDate}
          statuses={statuses}
          colorOf={colorOf}
          onEdit={edit}
          onContext={openContext}
          onMore={setDayOpen}
          inMonthCount={visible.filter((entry) => monthKeyOf(entry.date) === month).length}
          totalCount={visible.length}
        />
      ) : (
        <Agenda
          entries={visible}
          today={today}
          pastOpen={pastOpen}
          onTogglePast={() => setPastOpen((value) => !value)}
          {...cardProps}
        />
      )}

      {dayOpen && (
        <Sheet title={longDate(dayOpen)} onClose={() => setDayOpen(null)}>
          <SheetBody>
            <div className="cc-list">
              {(byDate.get(dayOpen) ?? []).map((entry) => <EntryCard key={entry.key} entry={entry} {...cardProps} />)}
              {(byDate.get(dayOpen) ?? []).length === 0 && <p className="field-hint">Nothing left on this day.</p>}
            </div>
          </SheetBody>
        </Sheet>
      )}
      {menu.element}
    </div>
  );
}

interface CardCallbacks {
  statuses: Status[];
  colorOf: (status: string) => string;
  onEdit: (entry: CreatorEntry) => void;
  onStatus: (entry: CreatorEntry, anchor: DOMRect) => void;
  onActions: (entry: CreatorEntry, anchor: DOMRect) => void;
  onContext: (entry: CreatorEntry, event: MouseEvent<HTMLElement>) => void;
}

/* ------------------------------------------------------------------ month grid (desktop) */

function MonthGrid({ month, today, byDate, statuses, colorOf, onEdit, onContext, onMore, inMonthCount, totalCount }: {
  month: string; today: string; byDate: Map<string, CreatorEntry[]>;
  statuses: Status[];
  colorOf: (status: string) => string;
  onEdit: (entry: CreatorEntry) => void;
  onContext: (entry: CreatorEntry, event: MouseEvent<HTMLElement>) => void;
  onMore: (date: string) => void;
  inMonthCount: number; totalCount: number;
}) {
  const weeks = useMemo(() => monthWeeks(month), [month]);
  return (
    <div className="view-scroll cc-scroll">
      <div className="cc-legend" aria-label="Status colors">
        {statuses.map((status) => (
          <span key={status.name} className="cc-legend-item"><span className="chip-dot" style={{ color: status.color }} />{status.name}</span>
        ))}
      </div>
      {inMonthCount === 0 && (
        <p className="cc-month-note" role="status">
          Nothing scheduled in {monthLabel(month)}. {totalCount} {totalCount === 1 ? "entry is" : "entries are"} in other months.
        </p>
      )}
      <div className="cc-grid" role="group" aria-label={`Creator calendar, ${monthLabel(month)}`}>
        {WEEKDAYS.map((day) => <div key={day} className="cc-weekday" aria-hidden="true">{day}</div>)}
        {weeks.flat().map((date) => {
          const items = byDate.get(date) ?? [];
          const shown = items.length > MAX_PER_DAY ? items.slice(0, MAX_PER_DAY) : items;
          const hidden = items.length - shown.length;
          const outside = monthKeyOf(date) !== month;
          const dayNumber = Number(date.slice(8));
          return (
            <div
              key={date}
              className={`cc-day${outside ? " is-outside" : ""}${date === today ? " is-today" : ""}`}
              role="group"
              aria-label={`${longDate(date)}, ${items.length === 0 ? "nothing scheduled" : `${items.length} ${items.length === 1 ? "entry" : "entries"}`}`}
            >
              <span className="cc-day-num" aria-hidden="true">{dayNumber === 1 ? `${dayNumber} ${parseDate(date).toLocaleDateString("en-GB", { month: "short" })}` : dayNumber}</span>
              <ul className="cc-day-list">
                {shown.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className="cc-entry"
                      style={{ "--c": colorOf(entry.status) } as CSSProperties}
                      title={entryDescription(entry)}
                      aria-label={`${entryDescription(entry)}. Edit`}
                      onClick={() => onEdit(entry)}
                      onContextMenu={(event) => onContext(entry, event)}
                    >
                      <KindIcon kind={entry.kind} />
                      {entry.time && <span className="cc-entry-time">{entry.time}</span>}
                      <span className="cc-entry-name">{entry.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <button type="button" className="cc-more" onClick={() => onMore(date)} aria-label={`Show all ${items.length} entries on ${longDate(date)}`}>+{hidden} more</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ agenda (phones) */

function Agenda({ entries, today, pastOpen, onTogglePast, ...card }: {
  entries: CreatorEntry[]; today: string; pastOpen: boolean; onTogglePast: () => void;
} & CardCallbacks) {
  const { upcoming, past } = useMemo(() => {
    const group = (list: CreatorEntry[]) => {
      const map = new Map<string, CreatorEntry[]>();
      list.forEach((entry) => {
        const bucket = map.get(entry.date);
        if (bucket) bucket.push(entry); else map.set(entry.date, [entry]);
      });
      return [...map.entries()];
    };
    return {
      upcoming: group(entries.filter((entry) => entry.date >= today)),
      past: group(entries.filter((entry) => entry.date < today).reverse())
    };
  }, [entries, today]);
  const pastCount = past.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <div className="view-scroll">
      <div className="cc-agenda">
        {upcoming.length === 0 && (
          <p className="cc-agenda-empty">Nothing coming up{pastCount > 0 ? ". Earlier entries are under Past." : "."}</p>
        )}
        {upcoming.map(([date, list]) => <DayGroup key={date} date={date} today={today} list={list} {...card} />)}
        {pastCount > 0 && (
          <section className="cc-past" aria-label="Past entries">
            <button type="button" className="btn btn--block cc-past-toggle" aria-expanded={pastOpen} onClick={onTogglePast}>
              <ChevronDown aria-hidden style={pastOpen ? { transform: "rotate(180deg)" } : undefined} />Past ({pastCount})
            </button>
            {pastOpen && past.map(([date, list]) => <DayGroup key={date} date={date} today={today} list={list} {...card} />)}
          </section>
        )}
      </div>
    </div>
  );
}

function DayGroup({ date, today, list, ...card }: { date: string; today: string; list: CreatorEntry[] } & CardCallbacks) {
  return (
    <section className={`cc-group${date === today ? " is-today" : ""}`} aria-label={friendlyDate(date, today)}>
      <div className="cc-group-head">
        <h2>{friendlyDate(date, today)}</h2>
        <span className="cc-group-sub">{parseDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
      </div>
      <div className="cc-list">
        {list.map((entry) => <EntryCard key={entry.key} entry={entry} {...card} />)}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ entry card (agenda + day sheet) */

function EntryCard({ entry, statuses, onEdit, onStatus, onActions, onContext }: { entry: CreatorEntry } & CardCallbacks) {
  const related = entry.kind === "video"
    ? (entry.publicationDate ? `Publication ${shortDate(entry.publicationDate)}` : "No publication date")
    : `Video in store ${entry.videoDate ? shortDate(entry.videoDate) : "-"}`;
  return (
    <article className="cc-card" onContextMenu={(event) => onContext(entry, event)}>
      <button type="button" className="cc-card-main" onClick={() => onEdit(entry)} aria-label={`Edit ${entryDescription(entry)}`}>
        <span className="cc-card-title"><KindIcon kind={entry.kind} /><span>{entry.title}</span></span>
        <span className="cc-card-meta">
          <span>{KIND_LABEL[entry.kind]}</span>
          {entry.time && <span className="cc-meta-item"><Clock aria-hidden />{entry.time}</span>}
          <span className="cc-meta-item"><Store aria-hidden />{entry.store || "No store"}</span>
          <span>{related}</span>
        </span>
      </button>
      <div className="cc-card-actions">
        <StatusChip statuses={statuses} name={entry.status} onClick={(event) => onStatus(entry, event.currentTarget.getBoundingClientRect())} />
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label={`Actions for ${entry.title}`}
          aria-haspopup="menu"
          onClick={(event) => onActions(entry, event.currentTarget.getBoundingClientRect())}
        ><MoreHorizontal /></button>
      </div>
    </article>
  );
}
