import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/gantt.css";
import "./styles/views.css";
import App from "./App";

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
