/**
 * In-memory fake of the Firestore + Auth slice the sync engine uses. Several clients (engines) can share one
 * MemoryStore, which is how the tests simulate two devices editing the same `boards/default` document.
 *
 * Semantics kept close to Firestore: documents are cloned on every read/write, snapshot listeners fire (asynchronously)
 * for the initial state and after every write, a transaction is atomic and a denied/failed write applies nothing.
 * No fake business data is created: every document starts missing unless the caller seeds it.
 */
import type { BackendUser, BoardBackend, DocSnapshotLike, TransactionLike } from "./backend";

type Doc = Record<string, unknown>;

export interface FakeError extends Error {
  code: string;
}

export function fakeError(code: string, message = code): FakeError {
  const error = new Error(message) as FakeError;
  error.code = code;
  return error;
}

export interface MemoryStoreOptions {
  /** Password accepted by signIn (any non-empty password when undefined). */
  password?: string;
  /** Called after every committed write with the path (used by the demo backend to persist). */
  onWrite?: (documents: ReadonlyMap<string, Doc>) => void;
  /** Initial documents (the demo backend restores its persisted state here). */
  documents?: Record<string, Doc>;
  /** Value stored for serverTimestamp(). */
  timestamp?: () => unknown;
  kind?: "memory" | "demo";
}

export interface MemoryStore {
  /** Create a client (a "device") with its own auth state. */
  client(options?: { signedIn?: boolean }): BoardBackend;
  /** Raw document (cloned) or undefined. */
  read(path: string): Doc | undefined;
  /** Seed/replace a document without going through a client; notifies listeners. */
  write(path: string, data: Doc): void;
  /** Paths whose writes fail with permission-denied. A trailing "*" matches a prefix. */
  denyWrites(...paths: string[]): void;
  allowAllWrites(): void;
  /** Make the next `count` operations of this type fail with the given error. */
  failNext(operation: "getDoc" | "setDoc" | "transaction", error: unknown, count?: number): void;
  /** Number of committed transactions / setDoc calls (for assertions). */
  readonly commits: { transactions: number; setDocs: number };
  /** Pending asynchronous work (snapshot deliveries); await it in tests to settle the store. */
  settle(): Promise<void>;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function snapshotOf(value: Doc | undefined): DocSnapshotLike {
  const copy = clone(value);
  return { exists: () => copy !== undefined, data: () => clone(copy) };
}

export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const documents = new Map<string, Doc>(Object.entries(options.documents || {}).map(([path, data]) => [path, clone(data)]));
  const listeners = new Map<string, Set<(snapshot: DocSnapshotLike) => void>>();
  const deniedPaths: string[] = [];
  const failures: Array<{ operation: string; error: unknown; remaining: number }> = [];
  const commits = { transactions: 0, setDocs: 0 };
  let transactionQueue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const kind = options.kind ?? "memory";
  const timestamp = options.timestamp ?? (() => Date.now());

  const isDenied = (path: string): boolean =>
    deniedPaths.some((pattern) => (pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern));

  function takeFailure(operation: string): unknown | undefined {
    const failure = failures.find((item) => item.operation === operation && item.remaining > 0);
    if (!failure) return undefined;
    failure.remaining -= 1;
    return failure.error;
  }

  function notify(path: string): void {
    const set = listeners.get(path);
    if (!set) return;
    const snapshot = snapshotOf(documents.get(path));
    set.forEach((listener) => {
      pending += 1;
      queueMicrotask(() => {
        try {
          listener(snapshot);
        } finally {
          pending -= 1;
        }
      });
    });
  }

  function applyWrite(path: string, data: Doc, merge: boolean): void {
    const next = clone(data);
    documents.set(path, merge ? { ...(documents.get(path) || {}), ...next } : next);
    options.onWrite?.(documents);
    notify(path);
  }

  function client(clientOptions: { signedIn?: boolean } = {}): BoardBackend {
    let user: BackendUser | null = clientOptions.signedIn ? { email: "team@otacos-workflow.app", isAnonymous: false } : null;
    const authListeners = new Set<(user: BackendUser | null) => void>();
    const emitAuth = () => authListeners.forEach((listener) => listener(user));

    return {
      kind,
      async signIn(email, password) {
        if (!password || (options.password !== undefined && password !== options.password)) {
          throw fakeError("auth/invalid-credential");
        }
        user = { email, isAnonymous: false };
        emitAuth();
      },
      async signOut() {
        user = null;
        emitAuth();
      },
      onAuthStateChanged(listener) {
        authListeners.add(listener);
        pending += 1;
        queueMicrotask(() => {
          pending -= 1;
          if (authListeners.has(listener)) listener(user);
        });
        return () => authListeners.delete(listener);
      },
      async getDoc(path) {
        const failure = takeFailure("getDoc");
        if (failure) throw failure;
        return snapshotOf(documents.get(path));
      },
      async setDoc(path, data, setOptions) {
        const failure = takeFailure("setDoc");
        if (failure) throw failure;
        if (isDenied(path)) throw fakeError("permission-denied");
        applyWrite(path, data, Boolean(setOptions?.merge));
        commits.setDocs += 1;
      },
      onSnapshot(path, onNext) {
        let set = listeners.get(path);
        if (!set) {
          set = new Set();
          listeners.set(path, set);
        }
        const listener = (snapshot: DocSnapshotLike) => onNext(snapshot);
        set.add(listener);
        // Firestore delivers the current state right after subscribing.
        const initial = snapshotOf(documents.get(path));
        pending += 1;
        queueMicrotask(() => {
          pending -= 1;
          if (set!.has(listener)) listener(initial);
        });
        return () => set!.delete(listener);
      },
      runTransaction<T>(updateFn: (transaction: TransactionLike) => Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
          const failure = takeFailure("transaction");
          if (failure) throw failure;
          const writes: Array<{ path: string; data: Doc; merge: boolean }> = [];
          const transaction: TransactionLike = {
            async get(path) {
              return snapshotOf(documents.get(path));
            },
            set(path, data, setOptions) {
              writes.push({ path, data: clone(data), merge: Boolean(setOptions?.merge) });
            }
          };
          const result = await updateFn(transaction);
          // Rules are evaluated at commit time: one denied write fails the whole transaction.
          if (writes.some((write) => isDenied(write.path))) throw fakeError("permission-denied");
          writes.forEach((write) => applyWrite(write.path, write.data, write.merge));
          commits.transactions += 1;
          return result;
        };
        const result = transactionQueue.then(run, run);
        transactionQueue = result.catch(() => undefined);
        return result;
      },
      serverTimestamp: () => timestamp()
    };
  }

  return {
    client,
    read: (path) => clone(documents.get(path)),
    write(path, data) {
      applyWrite(path, data, false);
    },
    denyWrites(...paths) {
      deniedPaths.push(...paths);
    },
    allowAllWrites() {
      deniedPaths.length = 0;
    },
    failNext(operation, error, count = 1) {
      failures.push({ operation, error, remaining: count });
    },
    commits,
    async settle() {
      await transactionQueue;
      for (let i = 0; i < 50 && pending > 0; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };
}
