import { useEffect, useState, type PointerEvent, type ReactNode } from "react";

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * One tooltip for a chart. Marks spread `bind(content)` onto themselves.
 * Mouse: follows the pointer while hovering. Touch: tap a mark to open, tap anywhere else (or scroll) to close.
 * The tooltip only repeats what the labels and the table view already say; it never gates information.
 */
export function useChartTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const active = tip !== null;

  useEffect(() => {
    if (!active) return;
    const dismiss = (event: Event) => {
      const target = event.target as Element | null;
      if (event.type === "pointerdown" && target?.closest?.("[data-tip]")) return;
      setTip(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [active]);

  function bind(content: ReactNode) {
    const show = (event: PointerEvent) => setTip({ x: event.clientX, y: event.clientY, content });
    return {
      "data-tip": "",
      onPointerEnter: show,
      onPointerMove: show,
      onPointerDown: show,
      onPointerLeave: (event: PointerEvent) => { if (event.pointerType !== "touch") setTip(null); }
    };
  }

  return { bind, node: tip ? <TipBubble tip={tip} /> : null };
}

function TipBubble({ tip }: { tip: Tip }) {
  const width = typeof window === "undefined" ? 1024 : window.innerWidth;
  const half = 120;
  const left = Math.min(Math.max(tip.x, half + 8), width - half - 8);
  const below = tip.y < 120;
  return (
    <div
      className="bud-tip"
      role="presentation"
      style={{ left, top: below ? tip.y + 18 : tip.y - 12, transform: below ? "translateX(-50%)" : "translate(-50%, -100%)" }}
    >
      {tip.content}
    </div>
  );
}
