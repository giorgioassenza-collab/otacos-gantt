import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Task, PedPost } from "../data/types";

export type ViewKey = "gantt" | "ped" | "influencers" | "creators" | "budget";
export const VIEWS: ViewKey[] = ["gantt", "ped", "influencers", "creators", "budget"];

export type SettingsSection = "gantt" | "ped" | "creators" | "influencers";

export type SheetState =
  | { kind: "task"; id?: string; defaults?: Partial<Task> }
  | { kind: "post"; id?: string; defaults?: Partial<PedPost> }
  | { kind: "influencer"; id?: string }
  | { kind: "creator"; id: string }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "projects" }
  | { kind: "history" }
  | { kind: "approvals" }
  | { kind: "notifications" }
  | { kind: "pedToGantt"; postId: string }
  | { kind: "ganttToPed"; taskId: string }
  | { kind: "influencerToGantt"; influencerId: string }
  | null;

interface UIApi {
  view: ViewKey;
  go: (view: ViewKey) => void;
  sheet: SheetState;
  open: (sheet: Exclude<SheetState, null>) => void;
  close: () => void;
}

const UIContext = createContext<UIApi | null>(null);
export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI outside UIProvider");
  return ctx;
};

const VIEW_STORAGE_KEY = "otw2.view";

function viewFromHash(): ViewKey | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return (VIEWS as string[]).includes(hash) ? (hash as ViewKey) : null;
}

function readSavedView(): ViewKey {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved && (VIEWS as string[]).includes(saved)) return saved as ViewKey;
  } catch { /* storage may be blocked */ }
  return "gantt";
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewKey>(() => viewFromHash() ?? readSavedView());
  const [sheet, setSheet] = useState<SheetState>(null);

  useEffect(() => {
    const onHash = () => { const next = viewFromHash(); if (next) setView(next); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: ViewKey) => {
    setView(next);
    setSheet(null);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* ignore */ }
    if (window.location.hash !== `#/${next}`) window.history.replaceState(null, "", `#/${next}`);
  }, []);

  const api = useMemo<UIApi>(() => ({ view, go, sheet, open: (next) => setSheet(next), close: () => setSheet(null) }), [view, go, sheet]);
  return <UIContext.Provider value={api}>{children}</UIContext.Provider>;
}
