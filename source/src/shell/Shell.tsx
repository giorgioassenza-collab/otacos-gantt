import { Suspense, lazy, type ReactNode } from "react";
import { useBoard } from "../store";
import { useUI, type ViewKey } from "../ui/uiContext";
import { useApprovals } from "../lib/approvalsStore";
import { useIdentity } from "../lib/identity";
import { useNotifications } from "../lib/notificationsStore";
import { useMenu } from "../ui/Menu";
import { initials } from "../lib/gantt";
import { Bell, CalendarDays, GanttChart, History, Inbox, LogOut, Settings, Undo2, Users, Video, Wallet, Cloud, CloudOff } from "../ui/icons";

import { ErrorBoundary } from "../ui/ErrorBoundary";
const GanttView = lazy(() => import("../views/gantt/GanttView"));
const PedView = lazy(() => import("../views/ped/PedView"));
const InfluencerView = lazy(() => import("../views/influencers/InfluencerView"));
const CreatorView = lazy(() => import("../views/creators/CreatorView"));
const BudgetView = lazy(() => import("../views/budget/BudgetView"));
const SheetHost = lazy(() => import("./SheetHost"));

const NAV: { key: ViewKey; label: string; title: string; icon: ReactNode }[] = [
  { key: "gantt", label: "Gantt", title: "Gantt", icon: <GanttChart aria-hidden /> },
  { key: "ped", label: "PED", title: "Editorial plan", icon: <CalendarDays aria-hidden /> },
  { key: "influencers", label: "Influencers", title: "Influencers", icon: <Users aria-hidden /> },
  { key: "creators", label: "Creators", title: "Creator calendar", icon: <Video aria-hidden /> },
  { key: "budget", label: "Budget", title: "Budget", icon: <Wallet aria-hidden /> }
];

export function Shell() {
  const { state, sync } = useBoard();
  const { view, go, open } = useUI();
  const current = NAV.find((item) => item.key === view) ?? NAV[0];
  const logo = `${import.meta.env.BASE_URL}otacos-logo.svg`;
  const pendingApprovals = useApprovals().reviews.length;
  const { me, forget } = useIdentity();
  const notes = useNotifications();
  const menu = useMenu();
  const settingsSection = view === "gantt" ? "gantt" : view === "ped" ? "ped" : view === "creators" ? "creators" : "influencers";

  function openProfile(anchor: DOMRect) {
    const compact = window.matchMedia("(max-width: 719px)").matches; // on phones these live here, on larger screens in the side rail
    menu.open(anchor, [
      { key: "switch", label: <>Not {me}? Switch person</>, onSelect: forget },
      ...(compact ? [
        { key: "div1", label: "", divider: true, onSelect: () => {} },
        { key: "approve", label: <>Tasks to approve{pendingApprovals ? ` (${pendingApprovals})` : ""}</>, onSelect: () => open({ kind: "approvals" }) },
        { key: "history", label: "History", onSelect: () => open({ kind: "history" }) },
        { key: "settings", label: "Settings", onSelect: () => open({ kind: "settings", section: settingsSection }) }
      ] : []),
      { key: "div2", label: "", divider: true, onSelect: () => {} },
      { key: "logout", label: "Log out", onSelect: () => void sync.logout() }
    ], "Account");
  }

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <a className="rail-brand" href={`#/${view}`} aria-label="O'Tacos Workflow"><img src={logo} alt="" /></a>
        <div className="rail-nav">
          {NAV.map((item) => (
            <button key={item.key} type="button" className="rail-link" aria-current={view === item.key ? "page" : undefined} onClick={() => go(item.key)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <button type="button" className="rail-foot-btn" onClick={() => open({ kind: "approvals" })}>
            <Inbox aria-hidden /><span className="rail-foot-label">To approve</span>
            {pendingApprovals > 0 && <span className="badge-dot">{pendingApprovals}</span>}
          </button>
          <button type="button" className="rail-foot-btn" onClick={() => open({ kind: "history" })}>
            <History aria-hidden /><span className="rail-foot-label">History</span>
          </button>
          <button type="button" className="rail-foot-btn" onClick={() => open({ kind: "settings", section: settingsSection })}>
            <Settings aria-hidden /><span className="rail-foot-label">Settings</span>
          </button>
          <button type="button" className="rail-foot-btn" onClick={() => void sync.logout()}>
            <LogOut aria-hidden /><span className="rail-foot-label">Log out</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <img className="topbar-logo" src={logo} alt="" />
          <h1 className="topbar-title">{current.title}</h1>
          <span className="sync" data-status={state.syncStatus} title={state.message}>
            <i aria-hidden />
            {state.syncStatus === "offline" ? <CloudOff size={14} aria-hidden /> : <Cloud size={14} aria-hidden />}
            <span className="sr-only">Sync status:</span>
            <span className="sync-text">{state.message}</span>
          </span>
          <button type="button" className="icon-btn" onClick={() => void sync.undo()} disabled={!state.canUndo} aria-label="Undo last change" title="Undo last change"><Undo2 /></button>
          <button type="button" className="icon-btn" onClick={() => open({ kind: "notifications" })} aria-label={notes.count ? `Notifications for you, ${notes.count} to do` : "Notifications for you, nothing waiting"} title="For you">
            <Bell />{notes.count > 0 && <span className="badge-dot">{notes.count > 99 ? "99+" : notes.count}</span>}
          </button>
          <button type="button" className="me-btn" onClick={(event) => openProfile(event.currentTarget.getBoundingClientRect())} aria-haspopup="menu" aria-label={`${me}. Account menu`} title={me}>
            <span className="avatar" aria-hidden="true">{initials(me)}</span>
          </button>
        </header>
        {state.hasUnsyncedChanges && (state.syncStatus === "offline" || state.syncStatus === "error") && (
          <div className="unsynced" role="alert">
            <CloudOff size={16} aria-hidden />
            <span>{state.syncStatus === "offline" ? "Not saved to the shared board yet. Your change is kept on this device and will sync when you are online." : "Not saved to the shared board yet. Retrying automatically."}</span>
            <button type="button" className="btn btn--sm" onClick={() => void sync.retryPendingSave()}>Retry now</button>
          </div>
        )}
        <main className="view" id="main">
          <ErrorBoundary key={view} label="This view" inline>
            <Suspense fallback={<div className="empty"><div className="spinner" role="status" aria-label="Loading" /></div>}>
              {view === "gantt" && <GanttView />}
              {view === "ped" && <PedView />}
              {view === "influencers" && <InfluencerView />}
              {view === "creators" && <CreatorView />}
              {view === "budget" && <BudgetView />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <Suspense fallback={null}><SheetHost /></Suspense>
      {menu.element}
    </div>
  );
}
