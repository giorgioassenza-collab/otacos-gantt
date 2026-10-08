import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/gantt.css";
import "./styles/views.css";
import App from "./App";
import { reloadOnce } from "./ui/ErrorBoundary";

// A new version was published while this page was open and its lazy files are gone: reload once to pick it up.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnce()) event.preventDefault();
});

// Development only: `?demo=1&seed=1` fills the local demo board with synthetic content (never Firebase).
if (import.meta.env.DEV && new URLSearchParams(location.search).get("seed") === "1") {
  const { seedDemoBoard } = await import("./dev/seed");
  seedDemoBoard(true);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
