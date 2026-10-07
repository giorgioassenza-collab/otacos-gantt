/**
 * DEV-ONLY demo backend: an in-memory Firestore persisted to this browser's localStorage under its own key, so the UI
 * can be developed without the real password or the real data. It starts EMPTY (the engine seeds the document with
 * the English starter data: no invented tasks, influencers or people) and accepts any non-empty password.
 *
 * It throws in production builds and, being referenced only behind `import.meta.env.DEV`, is removed from them.
 */
import type { BoardBackend } from "./backend";
import { createMemoryStore } from "./memoryBackend";

export const DEMO_STORAGE_KEY = "otacos-demo-board-v1";

export interface DemoBackendOptions {
  /** Start already signed in (skips the login screen). */
  autoLogin?: boolean;
  /** Override the localStorage key (tests). */
  storageKey?: string;
}

export function createDemoBackend(options: DemoBackendOptions = {}): BoardBackend {
  if (!import.meta.env.DEV) throw new Error("The demo backend is only available in development builds.");
  const key = options.storageKey ?? DEMO_STORAGE_KEY;
  let restored: Record<string, Record<string, unknown>> = {};
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (saved) restored = JSON.parse(saved) as typeof restored;
  } catch {
    restored = {};
  }
  const store = createMemoryStore({
    kind: "demo",
    documents: restored,
    onWrite(documents) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(Object.fromEntries(documents)));
      } catch {
        // storage full or unavailable: the demo just becomes non persistent
      }
    }
  });
  return store.client({ signedIn: Boolean(options.autoLogin) });
}

/** Forget the demo board (next start is empty again). */
export function resetDemoBackend(storageKey: string = DEMO_STORAGE_KEY): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}
