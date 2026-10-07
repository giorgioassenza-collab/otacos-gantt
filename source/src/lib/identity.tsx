import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { TEAM } from "./team";

const KEY = "otw2.me";

interface IdentityApi {
  /** Who is using this device right now, "" until they pick. */
  me: string;
  choose: (name: string) => void;
  /** Forget the choice (next screen asks "Who are you?" again). */
  forget: () => void;
}

const Ctx = createContext<IdentityApi | null>(null);

function read(): string {
  try {
    const saved = localStorage.getItem(KEY) ?? "";
    return (TEAM as readonly string[]).includes(saved) ? saved : "";
  } catch {
    return "";
  }
}

/**
 * The whole team shares one password, so "who you are" is a per-device choice made after login. It is only used to
 * personalise the notifications; everybody still sees and can edit everything.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<string>(read);
  const choose = useCallback((name: string) => {
    setMe(name);
    try {
      localStorage.setItem(KEY, name);
      // everybody starts by seeing everyone's work; the per-person filters are opt-in
      localStorage.removeItem("otw2.gantt.who");
      localStorage.removeItem("otw2.ped.who");
    } catch { /* storage blocked: the choice lasts until reload */ }
  }, []);
  const forget = useCallback(() => {
    setMe("");
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);
  const api = useMemo(() => ({ me, choose, forget }), [me, choose, forget]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useIdentity(): IdentityApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIdentity outside IdentityProvider");
  return ctx;
}
