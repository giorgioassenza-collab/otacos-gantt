import { useCallback, useState } from "react";

/** useState that remembers its value in localStorage (per device). Falls back silently when storage is blocked. */
export function usePref<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* blocked or corrupt */ }
    return initial;
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  }, [key]);
  return [value, set];
}
