import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { usePref } from "../../lib/usePref";
import { currentDateKey, shiftDateString } from "../../data/dates";
import { buildPedItems, initials, normalizeHour, parseDate, socialOf, type PedItem } from "../../lib/gantt";
import { movePedItem } from "../../lib/actions";
import { PostMedia } from "../../ui/PostMedia";
import { Avatars, EmptyState, StatusChip } from "../../ui/common";
import { CalendarDays, ChevronLeft, ChevronRight, MessageSquare, Plus, Video, ListChecks } from "../../ui/icons";

const START_HOUR = 11;
const END_HOUR = 20;

function weekStart(date: string): string {
  const d = parseDate(date);
  const shift = (d.getDay() + 6) % 7; // Monday first
  return shiftDateString(date, -shift);
}

function weekLabel(start: string): string {
  const a = parseDate(start);
  const b = parseDate(shiftDateString(start, 6));
  const sameMonth = a.getMonth() === b.getMonth();
  return sameMonth
    ? `${a.getDate()}–${b.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
    : `${a.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${b.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function PedView() {
  const { data, mutate } = useBoard();
  const { open } = useUI();
  const today = currentDateKey();
  const [anchor, setAnchor] = useState(() => weekStart(today));
  const [selected, setSelected] = useState(today);
  const [who, setWho] = usePref<string>("otw2.ped.who", "all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);

  const items = useMemo(() => buildPedItems(data).filter((item) => who === "all" || item.members.includes(who)), [data, who]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDateString(anchor, i)), [anchor]);
  const byDay = useMemo(() => {
    const map = new Map<string, PedItem[]>();
    items.forEach((item) => { if (!map.has(item.date)) map.set(item.date, []); map.get(item.date)!.push(item); });
    map.forEach((list) => list.sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }, [items]);

  const inWeek = (date: string) => date >= anchor && date <= days[6];
  const weekItems = items.filter((i) => inWeek(i.date));
  const hours = useMemo(() => {
    const posted = weekItems.map((i) => parseInt(i.time.slice(0, 2), 10));
    const first = Math.min(START_HOUR, ...posted);
    const last = Math.max(END_HOUR, ...posted);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [weekItems]);

  const go = (days: number) => { setAnchor(shiftDateString(anchor, days)); setSelected(shiftDateString(selected, days)); };
  const goToday = () => { setAnchor(weekStart(today)); setSelected(today); };
  const newPost = (date: string, time = "11:00") => open({ kind: "post", defaults: { date, time } });
  const openItem = (item: PedItem) => open({ kind: "post", id: item.postId ?? item.id });

  const members = data.members;

  function drop(event: DragEvent, date: string, hour: number) {
    event.preventDefault();
    setOverCell(null);
    const id = event.dataTransfer.getData("text/plain");
    const item = items.find((i) => i.id === id);
    setDragId(null);
    if (!item) return;
    const time = `${String(hour).padStart(2, "0")}:${item.time.slice(3, 5) || "00"}`;
    if (item.date === date && parseInt(item.time.slice(0, 2), 10) === hour) return;
    void mutate((draft) => movePedItem(draft, item, date, time));
  }

  const dayItems = byDay.get(selected) ?? [];
  const noPosts = data.pedPosts.length === 0 && !data.tasks.some((t) => t.pedEnabled);

  return (
    <div className="ped">
      <div className="view-toolbar" role="toolbar" aria-label="Editorial plan controls">
        <div className="segmented" role="group" aria-label="Week">
          <button type="button" aria-label="Previous week" onClick={() => go(-7)}><ChevronLeft size={16} /></button>
          <button type="button" onClick={goToday}>Today</button>
          <button type="button" aria-label="Next week" onClick={() => go(7)}><ChevronRight size={16} /></button>
        </div>
        <strong className="ped-week-label">{weekLabel(anchor)}</strong>
        <span className="grow" />
        <select className="select select--sm select-compact" aria-label="Show posts for" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="button" className="btn btn--primary new-btn" onClick={() => newPost(selected)} aria-label="New post"><Plus /><span className="new-label">New post</span></button>
      </div>

      {/* phones and small tablets: a week strip and the selected day as a list */}
      <div className="ped-day" aria-label="Day view">
        <div className="week-strip" role="tablist" aria-label="Days of the week">
          {days.map((date) => {
            const d = parseDate(date);
            const count = byDay.get(date)?.length ?? 0;
            return (
              <button key={date} role="tab" type="button" aria-selected={selected === date} className={`week-day${date === today ? " is-today" : ""}`} onClick={() => setSelected(date)}>
                <span>{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <b>{d.getDate()}</b>
                <i data-count={count > 0} aria-label={count ? `${count} posts` : "No posts"} />
              </button>
            );
          })}
        </div>
        <div className="view-scroll">
          <div className="ped-day-list">
            {dayItems.length === 0 && (
              <EmptyState icon={<CalendarDays />} title="No posts this day" action={<button type="button" className="btn btn--primary" onClick={() => newPost(selected)}><Plus />Add a post</button>}>
                {noPosts ? "Plan posts here, or flag a Gantt task for the editorial plan." : "Nothing is scheduled for this day."}
              </EmptyState>
            )}
            {dayItems.map((item) => <PedCard key={item.id} data={data} item={item} onOpen={openItem} wide />)}
          </div>
        </div>
      </div>

      {/* desktop: week grid by hour */}
      <div className="ped-week view-scroll" aria-label="Week view">
        <div className="ped-grid" style={{ ["--hours" as string]: hours.length }}>
          <div className="ped-corner" />
          {days.map((date) => {
            const d = parseDate(date);
            return (
              <div key={date} className={`ped-colhead${date === today ? " is-today" : ""}`}>
                <span>{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <b>{d.getDate()}</b>
                <span className="ped-colhead-month">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
              </div>
            );
          })}
          {hours.map((hour) => (
            <Row key={hour} hour={hour} days={days} today={today} byDay={byDay} data={data} dragId={dragId} overCell={overCell}
              onOpen={openItem} onNew={newPost} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOverCell(null); }} onOver={setOverCell} onDrop={drop} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ hour, days, today, byDay, data, dragId, overCell, onOpen, onNew, onDragStart, onDragEnd, onOver, onDrop }: {
  hour: number; days: string[]; today: string; byDay: Map<string, PedItem[]>; data: ReturnType<typeof useBoard>["data"];
  dragId: string | null; overCell: string | null;
  onOpen: (item: PedItem) => void; onNew: (date: string, time: string) => void;
  onDragStart: (id: string) => void; onDragEnd: () => void; onOver: (key: string | null) => void; onDrop: (event: DragEvent, date: string, hour: number) => void;
}) {
  const label = `${String(hour).padStart(2, "0")}:00`;
  return (
    <>
      <div className="ped-hour">{label}</div>
      {days.map((date) => {
        const key = `${date}-${hour}`;
        const here = (byDay.get(date) ?? []).filter((item) => parseInt(item.time.slice(0, 2), 10) === hour);
        return (
          <div
            key={key}
            className={`ped-cell${date === today ? " is-today" : ""}${overCell === key ? " is-over" : ""}`}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); onOver(key); } }}
            onDragLeave={() => onOver(null)}
            onDrop={(e) => onDrop(e, date, hour)}
          >
            {here.map((item) => (
              <PedCard key={item.id} data={data} item={item} onOpen={onOpen} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; onDragStart(item.id); }} onDragEnd={onDragEnd} dragging={dragId === item.id} />
            ))}
            <button type="button" className="ped-add" aria-label={`Add a post on ${parseDate(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} at ${label}`} onClick={() => onNew(date, label)}><Plus /></button>
          </div>
        );
      })}
    </>
  );
}

function PedCard({ data, item, onOpen, wide, draggable, onDragStart, onDragEnd, dragging }: {
  data: ReturnType<typeof useBoard>["data"]; item: PedItem; onOpen: (item: PedItem) => void; wide?: boolean; draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void; onDragEnd?: () => void; dragging?: boolean;
}) {
  const style = { "--p": item.color } as CSSProperties;
  // The card is a container, not a button: the media has its own controls (arrows, play) and the text area opens the post.
  return (
    <article
      className={`ped-card${wide ? " is-wide" : ""}${dragging ? " is-dragging" : ""}`}
      style={style}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <PostMedia asset={item.asset} assetItems={item.assetItems} format={item.format} size={wide ? "wide" : "card"} onOpen={() => onOpen(item)} />
      <button type="button" className="ped-card-body" onClick={() => onOpen(item)} aria-label={`${item.time} ${item.title}. ${item.status}. Open post`}>
        <span className="ped-card-top">
          <span className="ped-card-time">{item.time}</span>
          <Video aria-hidden />
          <span className="ped-card-format">{item.format}</span>
        </span>
        <span className="ped-card-title">{item.title}</span>
        {wide && item.copy.trim() && <span className="ped-card-copy">{item.copy}</span>}
        <span className="ped-card-foot">
          {item.social.map((id) => {
            const social = socialOf(data.socials, id);
            return <span key={id} className="social-badge" style={{ background: social?.color ?? "var(--ink)" }}>{social?.short ?? id}</span>;
          })}
          {item.commentCount > 0 && <span className="meta"><MessageSquare aria-hidden />{item.commentCount}</span>}
          {item.subtaskTotal > 0 && <span className="meta"><ListChecks aria-hidden />{item.subtaskDone}/{item.subtaskTotal}</span>}
          {item.members.length > 0 && <Avatars names={item.members} max={2} />}
        </span>
        <StatusChip statuses={data.pedStatuses} name={item.status} as="span" />
      </button>
    </article>
  );
}

void initials; void normalizeHour;
