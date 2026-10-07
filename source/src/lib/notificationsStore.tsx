import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useBoard } from "../store";
import { useIdentity } from "./identity";
import { computeNotifications, type Notifications } from "./notifications";
import { personKey } from "./team";

interface NotificationsApi extends Notifications {
  /** Mark the mentions as read (called when the notifications panel closes). */
  markMentionsSeen: () => void;
}

const empty: NotificationsApi = { tasks: [], subtasks: [], posts: [], mentions: [], count: 0, markMentionsSeen: () => {} };
const Ctx = createContext<NotificationsApi>(empty);
export const useNotifications = () => useContext(Ctx);

const seenKey = (me: string) => `otw2.seenMentions.${personKey(me)}`;

function readSeen(me: string): number {
  try { return Number(localStorage.getItem(seenKey(me))) || 0; } catch { return 0; }
}

/** Pending things for the person using this device. Recomputed whenever the board changes. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { data } = useBoard();
  const { me } = useIdentity();
  // `seen` is keyed by person so switching person on a shared device does not hide their mentions
  const [seen, setSeen] = useState<Record<string, number>>({});
  const seenAt = seen[personKey(me)] ?? readSeen(me);

  const markMentionsSeen = useCallback(() => {
    const at = Date.now();
    setSeen((current) => ({ ...current, [personKey(me)]: at }));
    try { localStorage.setItem(seenKey(me), String(at)); } catch { /* ignore */ }
  }, [me]);

  const computed = useMemo(() => computeNotifications(data, me, seenAt), [data, me, seenAt]);
  const api = useMemo(() => ({ ...computed, markMentionsSeen }), [computed, markMentionsSeen]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
