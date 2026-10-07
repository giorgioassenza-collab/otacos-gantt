import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * A reorderable list that behaves like a physical object:
 *  - the row you grab stays glued to the pointer at the spot you grabbed it (1:1, pointer capture);
 *  - the other rows slide out of the way while you drag, so you always see where it will land;
 *  - letting go settles the row into its slot (FLIP, starts from where the row actually is, never from a jump);
 *  - at the ends of the list the row resists instead of stopping dead (rubber band);
 *  - near the top/bottom of the scrolling area the list scrolls by itself;
 *  - from the keyboard: Space picks up, ↑ ↓ moves, Space drops, Esc puts it back. Every step is announced.
 * Only `transform` and `opacity` are animated. With reduced motion the row still follows the pointer but nothing slides.
 */

const EASE = "cubic-bezier(.16, 1, .3, 1)";
const SETTLE_MS = 220;
const LIFT_SCALE = 1.02;
const EDGE = 56;

export interface HandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onBlur: () => void;
  "aria-pressed": boolean;
  "aria-roledescription": string;
  /** Lets the surrounding sheet know that Escape belongs to the drag (cancel) and must not close it. */
  "data-grabbed": boolean;
  style: { touchAction: "none" };
}

interface SortableProps<T> {
  items: T[];
  getKey: (item: T) => string;
  /** Human name of an item for screen reader announcements. */
  getName: (item: T) => string;
  onReorder: (from: number, to: number) => void;
  renderItem: (item: T, ctx: { index: number; handle: HandleProps; lifted: boolean; grabbed: boolean }) => ReactNode;
  label: string;
  className?: string;
}

interface Drag {
  key: string;
  from: number;
  over: number;
  startY: number;
  startScroll: number;
  pointerY: number;
  y: number;
  slots: { top: number; h: number }[];
  gap: number;
  order: string[];
  scroller: HTMLElement | null;
  raf: number;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The further past the end, the less the row follows. */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

export function Sortable<T>({ items, getKey, getName, onReorder, renderItem, label, className }: SortableProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const nodes = useRef(new Map<string, HTMLLIElement>());
  /** offsetTop of every row as of the last commit, or the visual spot right before a drop (for FLIP). */
  const lastTops = useRef(new Map<string, number>());
  const dropped = useRef<{ key: string; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const keyboardStart = useRef<number>(-1);
  const [liftedKey, setLiftedKey] = useState<string | null>(null);
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const keys = items.map(getKey);

  // FLIP: after every reorder, rows glide from where they were to where they are now.
  useLayoutEffect(() => {
    const previous = lastTops.current;
    const next = new Map<string, number>();
    nodes.current.forEach((el, key) => {
      const top = el.offsetTop;
      next.set(key, top);
      const before = previous.get(key);
      if (before === undefined || reducedMotion()) return;
      const delta = before - top;
      const wasDropped = dropped.current?.key === key;
      if (Math.abs(delta) < 1 && !wasDropped) return;
      el.animate(
        [
          { transform: `translateY(${delta}px) scale(${wasDropped ? LIFT_SCALE : 1})` },
          { transform: "translateY(0) scale(1)" }
        ],
        { duration: SETTLE_MS, easing: EASE }
      );
    });
    dropped.current = null;
    lastTops.current = next;
  }, [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // never leave a drag loop running if the list goes away mid-drag
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  const rowNode = (key: string) => nodes.current.get(key);

  function applyDrag(d: Drag) {
    const active = rowNode(d.key);
    if (!active) return;
    const scrolled = (d.scroller?.scrollTop ?? 0) - d.startScroll;
    const raw = d.pointerY - d.startY + scrolled;
    const last = d.slots.length - 1;
    const minY = d.slots[0].top - d.slots[d.from].top;
    const maxY = d.slots[last].top + d.slots[last].h - d.slots[d.from].h - d.slots[d.from].top;
    const dimension = listRef.current?.offsetHeight ?? 300;
    let y = raw;
    if (raw < minY) y = minY - rubberband(minY - raw, dimension);
    if (raw > maxY) y = maxY + rubberband(raw - maxY, dimension);
    d.y = y;
    active.style.transform = `translateY(${y}px) scale(${reducedMotion() ? 1 : LIFT_SCALE})`;

    const center = d.slots[d.from].top + y + d.slots[d.from].h / 2;
    // the slot whose centre is nearest to the dragged row's centre is where it would land
    let over = d.from;
    let best = Infinity;
    d.slots.forEach((slot, i) => {
      const distance = Math.abs(center - (slot.top + slot.h / 2));
      if (distance < best) { best = distance; over = i; }
    });
    d.over = over;

    const shift = d.slots[d.from].h + d.gap;
    d.order.forEach((key, i) => {
      if (i === d.from) return;
      let dy = 0;
      if (d.from < d.over && i > d.from && i <= d.over) dy = -shift;
      else if (d.from > d.over && i < d.from && i >= d.over) dy = shift;
      const el = rowNode(key);
      if (el) el.style.transform = dy ? `translateY(${dy}px)` : "";
    });
  }

  function tick() {
    const d = drag.current;
    if (!d) return;
    if (d.scroller) {
      const rect = d.scroller.getBoundingClientRect();
      const fromTop = d.pointerY - rect.top;
      const fromBottom = rect.bottom - d.pointerY;
      const speed = fromTop < EDGE ? -(EDGE - fromTop) / 4 : fromBottom < EDGE ? (EDGE - fromBottom) / 4 : 0;
      if (speed) d.scroller.scrollTop += Math.max(-14, Math.min(14, speed));
    }
    applyDrag(d);
    d.raf = requestAnimationFrame(tick);
  }

  function clearInline() {
    nodes.current.forEach((el) => { el.style.transform = ""; el.classList.remove("is-shifting"); });
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, key: string) {
    if (drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const index = keys.indexOf(key);
    const row = rowNode(key);
    if (index < 0 || !row || keys.length < 2) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone: keep going without capture */ }
    const slots = keys.map((k) => { const el = rowNode(k)!; return { top: el.offsetTop, h: el.offsetHeight }; });
    const gap = slots.length > 1 ? slots[1].top - (slots[0].top + slots[0].h) : 0;
    const scroller = scrollParent(listRef.current);
    drag.current = {
      key, from: index, over: index, startY: event.clientY, startScroll: scroller?.scrollTop ?? 0, pointerY: event.clientY, y: 0,
      slots, gap, order: [...keys], scroller, raf: 0
    };
    nodes.current.forEach((el, k) => { if (k !== key && !reducedMotion()) el.classList.add("is-shifting"); });
    setLiftedKey(key);
    navigator.vibrate?.(6);
    setAnnouncement(`Picked up ${getName(items[index])}, position ${index + 1} of ${keys.length}.`);
    drag.current.raf = requestAnimationFrame(tick);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    d.pointerY = event.clientY;
    applyDrag(d); // follow the pointer in the same event, not a frame later; the rAF loop only handles auto-scroll
  }

  function finish(commit: boolean) {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    setLiftedKey(null);
    const active = rowNode(d.key);
    const target = commit ? d.over : d.from;

    if (target === d.from) {
      // settle back into the same slot
      if (active && !reducedMotion()) {
        const y = d.y;
        clearInline();
        active.animate(
          [{ transform: `translateY(${y}px) scale(${LIFT_SCALE})` }, { transform: "translateY(0) scale(1)" }],
          { duration: SETTLE_MS, easing: EASE }
        );
      } else clearInline();
      if (commit) setAnnouncement(`Dropped ${getName(items[d.from])} back at position ${d.from + 1}.`);
      return;
    }

    // remember where every row visually is right now, so the re-render glides from there instead of jumping
    const shift = d.slots[d.from].h + d.gap;
    const visual = new Map<string, number>();
    d.order.forEach((key, i) => {
      let dy = 0;
      if (i === d.from) dy = d.y;
      else if (d.from < d.over && i > d.from && i <= d.over) dy = -shift;
      else if (d.from > d.over && i < d.from && i >= d.over) dy = shift;
      visual.set(key, d.slots[i].top + dy);
    });
    lastTops.current = visual;
    dropped.current = { key: d.key, y: d.y };
    clearInline();
    onReorder(d.from, target);
    setAnnouncement(`Dropped ${getName(items[d.from])} at position ${target + 1} of ${keys.length}.`);
    navigator.vibrate?.(4);
  }

  function snapshotTops() {
    const next = new Map<string, number>();
    nodes.current.forEach((el, k) => next.set(k, el.offsetTop));
    lastTops.current = next;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, key: string) {
    const index = keys.indexOf(key);
    if (index < 0) return;
    snapshotTops(); // row heights may have changed since the last reorder
    const name = getName(items[index]);
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbedKey === key) {
        setGrabbedKey(null);
        setAnnouncement(`Dropped ${name} at position ${index + 1} of ${keys.length}.`);
      } else {
        keyboardStart.current = index;
        setGrabbedKey(key);
        setAnnouncement(`Picked up ${name}, position ${index + 1} of ${keys.length}. Use the up and down arrow keys to move, space to drop, escape to cancel.`);
      }
      return;
    }
    if (grabbedKey !== key) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= keys.length) { setAnnouncement(`${name} is already ${to < 0 ? "first" : "last"}.`); return; }
      onReorder(index, to);
      setAnnouncement(`${name} moved to position ${to + 1} of ${keys.length}.`);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (keyboardStart.current >= 0 && keyboardStart.current !== index) onReorder(index, keyboardStart.current);
      setGrabbedKey(null);
      setAnnouncement(`Cancelled. ${name} is back at position ${keyboardStart.current + 1}.`);
    }
  }

  return (
    <>
      <ul ref={listRef} className={`sortable${className ? " " + className : ""}`} aria-label={label}>
        {items.map((item, index) => {
          const key = getKey(item);
          const handle: HandleProps = {
            onPointerDown: (event) => onPointerDown(event, key),
            onPointerMove,
            onPointerUp: () => finish(true),
            onPointerCancel: () => finish(false),
            onKeyDown: (event) => onKeyDown(event, key),
            onBlur: () => { if (grabbedKey === key) setGrabbedKey(null); },
            "aria-pressed": grabbedKey === key,
            "aria-roledescription": "sortable item",
            "data-grabbed": grabbedKey === key,
            style: { touchAction: "none" }
          };
          return (
            <li
              key={key}
              ref={(el) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }}
              className={`sortable-item${liftedKey === key ? " is-lifted" : ""}${grabbedKey === key ? " is-grabbed" : ""}`}
            >
              {renderItem(item, { index, handle, lifted: liftedKey === key, grabbed: grabbedKey === key })}
            </li>
          );
        })}
      </ul>
      <div className="sr-only" role="status" aria-live="assertive">{announcement}</div>
    </>
  );
}
