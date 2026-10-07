import { useEffect, useState } from "react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { EmptyState, Notice } from "../../ui/common";
import { History as HistoryIcon } from "../../ui/icons";
import { formatHistoryDate, historyEntryChanges, historySummary } from "../../data/history";
import type { SafetyBackup } from "../../data/types";

/** Two ways back: the recent "before this change" snapshots, and the automatic safety backups. */
export default function HistorySheet() {
  const { close } = useUI();
  const { state, sync } = useBoard();
  const toast = useToast();
  const [tab, setTab] = useState<"recent" | "backups">("recent");
  const [backups, setBackups] = useState<SafetyBackup[] | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "history" | "backup"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab !== "backups" || backups) return;
    let alive = true;
    sync.listSafetyBackups(60).then((list) => { if (alive) setBackups(list); }).catch(() => { if (alive) setBackups([]); });
    return () => { alive = false; };
  }, [tab, backups, sync]);

  async function restore() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "history") await sync.restoreHistory(confirm.id);
      else await sync.restoreSafetyBackup(confirm.id);
      toast.show("Version restored. Undo is available.");
      close();
    } catch {
      toast.show("Could not restore that version. Nothing was changed.", { error: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <Sheet title="History" onClose={close} wide>
      <div className="settings-tabs" role="tablist" aria-label="History">
        <button type="button" role="tab" aria-selected={tab === "recent"} onClick={() => setTab("recent")}>Recent changes</button>
        <button type="button" role="tab" aria-selected={tab === "backups"} onClick={() => setTab("backups")}>Safety backups</button>
      </div>
      <SheetBody>
        {confirm && (
          <Notice tone="info">
            Restore “{confirm.label}”? The board goes back to that version for everyone. You can undo it right after.
            <span className="notice-actions">
              <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore"}</button>
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </span>
          </Notice>
        )}
        {tab === "recent" && (
          state.history.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title="No changes recorded yet">Each time you change the board, the version before it is kept here on this device.</EmptyState>
          ) : (
            <ul className="list-rows">
              {state.history.map((entry, index) => {
                const changes = historyEntryChanges(state.history, index, state.data).slice(0, 4);
                return (
                  <li key={entry.id} className="list-row history-row">
                    <div className="grow">
                      <div className="list-row-title">{formatHistoryDate(entry.savedAt)}</div>
                      <div className="list-row-meta"><span>{entry.summary || historySummary(entry.data)}</span></div>
                      {changes.length > 0 && (
                        <ul className="history-changes">
                          {changes.map((c, i) => <li key={i}><b>{c.kind}</b> {c.change} · {c.title}{c.changes.length ? ` (${c.changes.join("; ")})` : ""}</li>)}
                        </ul>
                      )}
                    </div>
                    <button type="button" className="btn btn--sm" onClick={() => setConfirm({ kind: "history", id: entry.id, label: formatHistoryDate(entry.savedAt) })}>Restore</button>
                  </li>
                );
              })}
            </ul>
          )
        )}
        {tab === "backups" && (
          backups === null ? <div className="spinner" role="status" aria-label="Loading backups" /> :
          backups.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title="No safety backups on this device yet">Backups are written automatically whenever the board is saved.</EmptyState>
          ) : (
            <ul className="list-rows">
              {backups.map((backup) => (
                <li key={backup.id} className="list-row">
                  <div className="grow">
                    <div className="list-row-title">{formatHistoryDate(backup.savedAt)}</div>
                    <div className="list-row-meta"><span>{backup.summary}</span><span>{backup.source}</span></div>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => setConfirm({ kind: "backup", id: backup.id, label: formatHistoryDate(backup.savedAt) })}>Restore</button>
                </li>
              ))}
            </ul>
          )
        )}
      </SheetBody>
    </Sheet>
  );
}
