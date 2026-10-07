import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApprovalsError, fetchEmailReviews, type ApprovalChoices, type EmailReview } from "../external/approvals";

interface ApprovalsApi {
  reviews: EmailReview[];
  choices: ApprovalChoices;
  loading: boolean;
  /** Last problem, "" when the list loaded fine. */
  error: string;
  refresh: () => Promise<void>;
}

const empty: ApprovalChoices = { projects: [], statuses: [], members: [] };
const Ctx = createContext<ApprovalsApi>({ reviews: [], choices: empty, loading: false, error: "", refresh: async () => {} });
export const useApprovals = () => useContext(Ctx);

const POLL_MS = 5 * 60_000;

/** Loads the "tasks to approve" proposals once signed in, then every few minutes and when the tab becomes visible. */
export function ApprovalsProvider({ children }: { children: ReactNode }) {
  const [reviews, setReviews] = useState<EmailReview[]>([]);
  const [choices, setChoices] = useState<ApprovalChoices>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      const list = await fetchEmailReviews({ signal: controller.signal });
      setReviews(list.reviews);
      setChoices(list.choices);
      setError("");
    } catch (failure) {
      if (failure instanceof ApprovalsError && failure.kind === "aborted") return;
      setError(failure instanceof ApprovalsError ? failure.message : "Could not load the tasks to approve.");
    } finally {
      if (inflight.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); inflight.current?.abort(); };
  }, [refresh]);

  const api = useMemo(() => ({ reviews, choices, loading, error, refresh }), [reviews, choices, loading, error, refresh]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
