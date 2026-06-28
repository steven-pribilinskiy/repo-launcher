import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { api } from "@/lib/api";
import "./styles.css";

// Window-scoped styling: the popup is a rounded, transparent overlay; the
// settings window is a normal opaque, scrollable window.
const windowLabel = getCurrentWindow().label;
document.documentElement.dataset.window = windowLabel;

// Diagnostic: when the JS bundle starts executing, relative to process start.
api.logEvent(`${windowLabel}: js bundle executing at ${Math.round(performance.now())} ms`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
