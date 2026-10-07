import type { CSSProperties, ReactNode } from "react";
import type { Status } from "../data/types";
import { initials, readableOn, statusColor } from "../lib/gantt";

export function Avatars({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  return (
    <span className="avatar-stack" title={names.join(", ")} aria-label={`Assigned to ${names.join(", ")}`}>
      {shown.map((name) => <span key={name} className="avatar" aria-hidden="true">{initials(name)}</span>)}
      {names.length > max && <span className="avatar" aria-hidden="true" style={{ background: "var(--ink-3)" }}>+{names.length - max}</span>}
    </span>
  );
}

export function StatusChip({ statuses, name, onClick, as = "button" }: { statuses: Status[]; name: string; onClick?: (event: React.MouseEvent<HTMLElement>) => void; as?: "button" | "span" }) {
  const color = statusColor(statuses, name, "#d7dde5");
  const style: CSSProperties = { background: color, color: readableOn(color) };
  const content = <>{name || "No status"}</>;
  if (as === "span" || !onClick) return <span className="chip" style={style}>{content}</span>;
  return (
    <button type="button" className="chip status-chip" style={style} onClick={(event) => { event.stopPropagation(); onClick(event); }} aria-haspopup="menu" aria-label={`Status: ${name || "none"}. Change status`}>
      {content}
    </button>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`notice notice--${tone}`}>{children}</div>;
}
