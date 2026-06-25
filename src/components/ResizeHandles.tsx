import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Direction =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

type Handle = { direction: Direction; className: string };

// Thin invisible zones along every edge; the search box and action bar both carry
// more than 6px of padding, so a 6px zone never sits over their controls.
const EDGES: Handle[] = [
  { direction: "North", className: "inset-x-0 top-0 h-1.5 cursor-n-resize" },
  { direction: "South", className: "inset-x-0 bottom-0 h-1.5 cursor-s-resize" },
  { direction: "West", className: "inset-y-0 left-0 w-1.5 cursor-w-resize" },
  { direction: "East", className: "inset-y-0 right-0 w-1.5 cursor-e-resize" },
];

// 12px corner squares layered above the edges so the diagonal cursor wins there.
const CORNERS: Handle[] = [
  { direction: "NorthWest", className: "left-0 top-0 h-3 w-3 cursor-nw-resize" },
  { direction: "NorthEast", className: "right-0 top-0 h-3 w-3 cursor-ne-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-3 w-3 cursor-sw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-3 w-3 cursor-se-resize" },
];

function beginResize(direction: Direction) {
  return (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Mark activity first so the drag-start blur doesn't auto-hide the window.
    void invoke("mark_active").catch(() => {});
    void getCurrentWindow().startResizeDragging(direction);
  };
}

// Overlay that makes the frameless popup resizable from any edge or corner, with a
// visible grip in the bottom-right corner. Mounted as the last child of the popup
// root (which must be `relative`).
export function ResizeHandles() {
  return (
    <>
      {EDGES.map((handle) => (
        <div
          key={handle.direction}
          onMouseDown={beginResize(handle.direction)}
          className={`absolute z-20 ${handle.className}`}
        />
      ))}
      {CORNERS.map((handle) => (
        <div
          key={handle.direction}
          onMouseDown={beginResize(handle.direction)}
          className={`absolute z-30 ${handle.className}`}
        />
      ))}
      <div className="pointer-events-none absolute bottom-0.5 right-0.5 z-30 text-zinc-300 dark:text-zinc-600">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M11 5 L5 11 M11 9 L9 11"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}
