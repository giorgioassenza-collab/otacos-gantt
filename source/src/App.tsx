import { useEffect } from "react";
import { BoardProvider, useBoard } from "./store";
import { UIProvider } from "./ui/uiContext";
import { ToastProvider } from "./ui/Toast";
import { Login } from "./shell/Login";
import { Shell } from "./shell/Shell";
import { WhoAreYou } from "./shell/WhoAreYou";
import { IdentityProvider, useIdentity } from "./lib/identity";
import { NotificationsProvider } from "./lib/notificationsStore";
import { ApprovalsProvider } from "./lib/approvalsStore";

/** The browser/phone chrome takes the colour of the screen under it: ink for login and "Who are you?", paper for the app. */
function useThemeColor(color: string) {
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  }, [color]);
}

function Gate() {
  const { state } = useBoard();
  const { me, forget } = useIdentity();
  const inApp = state.auth === "signed-in" && state.ready && Boolean(me);
  useThemeColor(inApp ? "#f9f6ec" : "#17120f");
  // a new login always asks "Who are you?" again
  useEffect(() => { if (state.auth === "signed-out") forget(); }, [state.auth, forget]);
  if (state.auth === "unknown") {
    return <div className="splash"><img src={`${import.meta.env.BASE_URL}otacos-logo.svg`} alt="O'Tacos Workflow" /></div>;
  }
  if (state.auth === "signed-out") return <Login />;
  if (!state.ready) {
    return <div className="splash"><img src={`${import.meta.env.BASE_URL}otacos-logo.svg`} alt="Loading O'Tacos Workflow" /></div>;
  }
  if (!me) return <WhoAreYou />;
  return <ApprovalsProvider><NotificationsProvider><Shell /></NotificationsProvider></ApprovalsProvider>;
}

export default function App() {
  return (
    <ToastProvider>
      <BoardProvider>
        <IdentityProvider>
          <UIProvider>
            <Gate />
          </UIProvider>
        </IdentityProvider>
      </BoardProvider>
    </ToastProvider>
  );
}
