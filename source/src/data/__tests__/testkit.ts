/** Small helpers shared by the data layer tests (no business data in here). */
import type { StorageLike } from "../safety";

export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * A tiny IndexedDB stand-in: just the calls safety.ts makes (open + upgrade, transaction, put/get/getAll,
 * oncomplete). Records are stored by keyPath "id".
 */
export function createFakeIndexedDB(): { factory: IDBFactory; databases: Map<string, Map<string, Map<string, unknown>>> } {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  type AnyFn = ((...args: unknown[]) => void) | null;
  const factory = {
    open(name: string) {
      const request: { result: unknown; error: unknown; onsuccess: AnyFn; onerror: AnyFn; onupgradeneeded: AnyFn; onblocked: AnyFn } = {
        result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null
      };
      setTimeout(() => {
        let stores = databases.get(name);
        const created = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        const storeMap = stores;
        request.result = {
          objectStoreNames: { contains: (store: string) => storeMap.has(store) },
          createObjectStore(store: string) {
            storeMap.set(store, new Map());
            return { createIndex() {} };
          },
          transaction(store: string) {
            const records = storeMap.get(store) as Map<string, unknown>;
            const transaction: { oncomplete: AnyFn; onerror: AnyFn; onabort: AnyFn; objectStore: () => unknown } = {
              oncomplete: null, onerror: null, onabort: null,
              objectStore: () => ({ put, get, getAll })
            };
            let pending = 0;
            const run = (work: () => void) => {
              pending += 1;
              setTimeout(() => {
                work();
                pending -= 1;
                if (pending === 0) setTimeout(() => transaction.oncomplete?.(), 0);
              }, 0);
            };
            const put = (value: { id: string }) => {
              const req: { result: unknown; onsuccess: AnyFn } = { result: undefined, onsuccess: null };
              run(() => {
                records.set(value.id, structuredClone(value));
                req.result = value.id;
                req.onsuccess?.();
              });
              return req;
            };
            const get = (key: string) => {
              const req: { result: unknown; onsuccess: AnyFn } = { result: undefined, onsuccess: null };
              run(() => {
                req.result = records.has(key) ? structuredClone(records.get(key)) : undefined;
                req.onsuccess?.();
              });
              return req;
            };
            const getAll = () => {
              const req: { result: unknown; onsuccess: AnyFn } = { result: undefined, onsuccess: null };
              run(() => {
                req.result = [...records.values()].map((value) => structuredClone(value));
                req.onsuccess?.();
              });
              return req;
            };
            return transaction;
          },
          close() {}
        };
        if (created) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
  return { factory: factory as unknown as IDBFactory, databases };
}

/** A clock that follows real time but never returns the same value twice (stable ordering of edits). */
export function monotonicClock(): () => number {
  let last = 0;
  return () => {
    last = Math.max(last + 1, Date.now());
    return last;
  };
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
