import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;
function lockScroll() {
  scrollLocks += 1;
  if (scrollLocks === 1) document.documentElement.style.overflow = "hidden";
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.documentElement.style.overflow = "";
  };
}

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Renders as a centered dialog instead of a side panel / bottom sheet (confirmations). */
  dialog?: boolean;
  /** Shown as a small label next to the title. */
  headerExtra?: ReactNode;
  /** There are edits that were not saved: closing (X, outside tap, Esc) asks before throwing them away. */
  dirty?: boolean;
}

/**
 * One overlay for every editor: bottom sheet on phones, side panel on larger screens.
 * Traps focus, closes on Esc and on scrim tap, restores focus to the opener.
 */
export function Sheet({ title, onClose, children, footer, wide, dialog, headerExtra, dirty }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [closing, setClosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const dirtyRef = useRef(Boolean(dirty));
  dirtyRef.current = Boolean(dirty);
  const askingRef = useRef(false);
  askingRef.current = asking;

  /** Pointer-initiated closes (X, scrim) play a short exit; Escape and other keyboard closes are instant. */
  const requestClose = useCallback(() => {
    if (closing) return;
    if (dirtyRef.current) { setAsking(true); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { closeRef.current(); return; }
    setClosing(true);
    window.setTimeout(() => closeRef.current(), 150);
  }, [closing]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(".sheet-body " + FOCUSABLE) ?? node;
    first?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // a list item picked up with the keyboard uses Escape to put itself back, not to close the sheet
        if ((event.target as Element | null)?.closest?.('[data-grabbed="true"]')) return;
        // an open menu (e.g. a status list) takes Escape first and closes alone
        if (document.querySelector(".menu")) return;
        event.stopPropagation();
        if (askingRef.current) { setAsking(false); return; } // Esc on the question = keep editing
        if (dirtyRef.current) { setAsking(true); return; }
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      unlock();
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <>
      <div className={`scrim${closing ? " is-closing" : ""}`} onClick={requestClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`${dialog ? "dialog" : "sheet"}${wide ? " sheet--wide" : ""}${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {!dialog && <div className="sheet-grab" aria-hidden="true" />}
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          {headerExtra}
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="Close">
            <X />
          </button>
        </header>
        {children}
        {asking ? (
          <div className="sheet-foot sheet-ask" role="alertdialog" aria-labelledby={`${titleId}-ask`}>
            <p id={`${titleId}-ask`}>Close without saving? Your changes will be lost.</p>
            <button type="button" className="btn" data-autofocus onClick={() => setAsking(false)} autoFocus>Keep editing</button>
            <button type="button" className="btn btn--danger" onClick={() => { dirtyRef.current = false; setAsking(false); closeRef.current(); }}>Discard</button>
          </div>
        ) : footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </>,
    document.body
  );
}

export function SheetBody({ children }: { children: ReactNode }) {
  return <div className="sheet-body">{children}</div>;
}
