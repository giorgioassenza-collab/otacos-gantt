import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface ToastItem { id: number; message: string; error?: boolean; action?: { label: string; run: () => void } }
interface ToastApi { show: (message: string, options?: { error?: boolean; action?: ToastItem["action"]; ms?: number }) => void }

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ToastApi["show"]>((message, options = {}) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, message, error: options.error, action: options.action }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), options.ms ?? (options.action ? 6000 : 3500));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.error ? " toast--error" : ""}`}>
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
