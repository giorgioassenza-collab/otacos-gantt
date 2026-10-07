import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createBoardSync, type BoardSync } from "./data/sync";
import type { BoardData, SyncState } from "./data/types";

interface BoardApi {
  state: SyncState;
  data: BoardData;
  sync: BoardSync;
  /** Apply a change to a copy of the board and save it (optimistic, merged on the server). */
  mutate: BoardSync["mutate"];
}

const BoardContext = createContext<BoardApi | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const sync = useMemo(() => createBoardSync(), []);
  const state = useSyncExternalStore(sync.subscribe, sync.getState, sync.getState);

  useEffect(() => {
    sync.start?.();
    return () => sync.stop?.();
  }, [sync]);

  const api = useMemo<BoardApi>(() => ({ state, data: state.data, sync, mutate: sync.mutate }), [state, sync]);
  return <BoardContext.Provider value={api}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardApi {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard outside BoardProvider");
  return ctx;
}
