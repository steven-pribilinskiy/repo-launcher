import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles.css";

// Window-scoped styling: the popup is a rounded, transparent overlay; the
// settings window is a normal opaque, scrollable window.
document.documentElement.dataset.window = getCurrentWindow().label;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
