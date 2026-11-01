import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { Game } from "@laycan/engine";

// Exposed for end-to-end checks (determinism across JavaScript engines).
(window as unknown as { laycan: unknown }).laycan = { Game };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
