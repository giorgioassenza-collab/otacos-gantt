import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface ToastItem { id: number; message: string; error?: boolean; leaving?: boolean; action?: { label: string; run: () => void } }
interface ToastApi { show: (message: string, options?: { error?: boolean; action?: ToastItem["action"]; ms?: number }) => void }

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ToastApi["show"]>((message, options = {}) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, message, error: options.error, action: options.action }]);
    const life = options.ms ?? (options.action ? 6000 : 3500);
    // fade out for a moment before removing, so it does not just vanish
    window.setTimeout(() => setItems((current) => current.map((item) => (item.id === id ? { ...item, leaving: true } : item))), life - 150);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), life);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.error ? " toast--error" : ""}${item.leaving ? " is-leaving" : ""}`}>
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="btn"
                onClick={() => { item.action?.run(); setItems((current) => current.filter((t) => t.id !== item.id)); }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
