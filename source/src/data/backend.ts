/**
 * The slice of Firebase the sync engine needs. The default implementation wraps the real Firebase v11 modular SDK
 * (firebaseBackend.ts); tests inject an in-memory fake (memoryBackend.ts); the dev-only demo backend wraps the same fake.
 * Document paths are plain strings: "boards/default", "boardSafety/latest", "boardSafetyBackups/<revision>".
 */

export interface DocSnapshotLike {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

export interface TransactionLike {
  get(path: string): Promise<DocSnapshotLike>;
  set(path: string, data: Record<string, unknown>, options?: { merge?: boolean }): void;
}

export interface BackendUser {
  email?: string | null;
  isAnonymous?: boolean;
}

export type Unsubscribe = () => void;

export interface BoardBackend {
  /** "firebase" in production; "memory" for tests; "demo" for the dev-only demo backend. */
  readonly kind: "firebase" | "memory" | "demo";
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthStateChanged(listener: (user: BackendUser | null) => void): Unsubscribe;
  getDoc(path: string): Promise<DocSnapshotLike>;
  setDoc(path: string, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  onSnapshot(path: string, onNext: (snapshot: DocSnapshotLike) => void, onError: (error: unknown) => void): Unsubscribe;
  runTransaction<T>(updateFn: (transaction: TransactionLike) => Promise<T>): Promise<T>;
  /** Value to store in `updatedAt`. */
  serverTimestamp(): unknown;
}
