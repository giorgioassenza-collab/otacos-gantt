import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  checked?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface MenuProps {
  /** Viewport point or anchor element rect to open at. */
  anchor: { x: number; y: number } | DOMRect;
  items: MenuItem[];
  onClose: () => void;
  label?: string;
}

/** Small popover menu used for status pickers, context menus and overflow menus. */
export function Menu({ anchor, items, onClose, label }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const ax = "width" in anchor ? anchor.left : anchor.x;
    const ay = "height" in anchor ? anchor.bottom + 4 : anchor.y;
    const left = Math.max(8, Math.min(ax, window.innerWidth - rect.width - 8));
    let top = ay;
    if (top + rect.height > window.innerHeight - 8) {
      const above = "height" in anchor ? anchor.top - rect.height - 4 : ay - rect.height;
      top = Math.max(8, above);
    }
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("button");
    first?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }}>
      {items.map((item) =>
        item.divider ? (
          <hr key={item.key} />
        ) : (
          <button
            key={item.key}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            style={item.danger ? { color: "var(--danger)" } : undefined}
            onClick={() => { item.onSelect(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

/** Hook to open a Menu from a button click or a context-menu / long-press point. */
export function useMenu() {
  const [state, setState] = useState<{ anchor: { x: number; y: number } | DOMRect; items: MenuItem[]; label?: string } | null>(null);
  return {
    open: (anchor: { x: number; y: number } | DOMRect, items: MenuItem[], label?: string) => setState({ anchor, items, label }),
    close: () => setState(null),
    element: state ? <Menu anchor={state.anchor} items={state.items} label={state.label} onClose={() => setState(null)} /> : null
  };
}
