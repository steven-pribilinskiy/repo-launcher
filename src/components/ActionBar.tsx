import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowBigUp,
  CornerDownLeft,
  GripHorizontal,
  List as ListIcon,
  Settings as SettingsIcon,
  Table2,
} from "lucide-react";
import { SORT_LABELS } from "@/types";
import type { ActionDef, ActionGroup } from "@/types";

// Drag the window by any non-button part of the bar (the grip on the left is the
// visible cue). begin_window_move locks the size against FancyZones/aero-snap and
// refreshes the auto-hide timer before the native drag.
function startWindowDrag(event: React.MouseEvent) {
  if (event.button !== 0) return;
  if ((event.target as HTMLElement).closest("button")) return;
  void invoke("begin_window_move").catch(() => {});
  void getCurrentWindow().startDragging();
}

type ActionBarProps = {
  actions: ActionDef[];
  groups: ActionGroup[];
  onRun: (action: ActionDef) => void;
  onCycleSort: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  repoCount: number;
  sortMode: number;
  /** Set when the last sort change couldn't be saved — the order on screen is then
   * not what the control claims, so the control has to say so. */
  sortError: string | null;
  view: "list" | "table";
  onToggleView: () => void;
  /** False when the list is empty — repo-scoped actions are hidden, since there's
   * nothing for them to act on. */
  hasSelection: boolean;
};

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

// A single, uncluttered row (Raycast-style): the primary action on the left, an
// "Actions" affordance that opens the Ctrl+K palette, and view/sort/settings on
// the right. The full per-action hotkey list lives in the palette now.
export function ActionBar({
  actions,
  onRun,
  onCycleSort,
  onOpenSettings,
  onOpenPalette,
  repoCount,
  sortMode,
  sortError,
  view,
  onToggleView,
  hasSelection,
}: ActionBarProps) {
  const enabled = actions.filter((action) => action.enabled);
  const primary =
    enabled.find((action) => action.role === "primary") ??
    enabled.find((action) => action.hotkey === "Enter") ??
    enabled[0];
  // Resolved exactly as the Shift+Enter handler does — no enabled[0] fallback,
  // because an unset alternative means the chord genuinely does nothing and the
  // bar must not advertise it. (`primary` above keeps its older fallback.)
  const alternative =
    enabled.find((action) => action.role === "alternative") ??
    enabled.find((action) => action.hotkey === "Shift+Enter");

  return (
    <div
      onMouseDown={startWindowDrag}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700/50"
    >
      <div className="flex shrink-0 items-center gap-2">
        {hasSelection && primary && (
          <button
            type="button"
            onClick={() => onRun(primary)}
            title={primary.label}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
          >
            <Kbd>
              <CornerDownLeft className="inline h-3 w-3" />
            </Kbd>
            <span className="max-w-[180px] truncate text-[11px] text-zinc-600 dark:text-zinc-300">
              {primary.label}
            </span>
          </button>
        )}

        {hasSelection && alternative && (
          <button
            type="button"
            onClick={() => onRun(alternative)}
            title={alternative.label}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
          >
            <Kbd>
              <span className="inline-flex items-center gap-0.5">
                <ArrowBigUp className="inline h-3 w-3" />
                <CornerDownLeft className="inline h-3 w-3" />
              </span>
            </Kbd>
            <span className="max-w-[180px] truncate text-[11px] text-zinc-600 dark:text-zinc-300">
              {alternative.label}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenPalette}
          title="All actions"
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
        >
          <Kbd>Ctrl+K</Kbd>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Actions</span>
        </button>
      </div>

      {/* Centered drag handle — even gaps between the actions and the right cluster. */}
      <span
        title="Drag to move"
        className="flex cursor-grab items-center px-2 text-zinc-300 active:cursor-grabbing dark:text-zinc-600"
      >
        <GripHorizontal className="h-4 w-4" />
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap text-[11px] text-zinc-400 dark:text-zinc-600">{repoCount} repos</span>
        <button
          type="button"
          onClick={onToggleView}
          title={view === "list" ? "Table view" : "List view"}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
        >
          {view === "list" ? <Table2 className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onCycleSort}
          title={sortError ? `Couldn’t save the sort order: ${sortError}` : "Cycle sort order"}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
        >
          <Kbd>Ctrl+S</Kbd>
          <span className="whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">Sort: {SORT_LABELS[sortMode]}</span>
          {sortError && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings (Ctrl+, / Ctrl+Alt+S)"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
