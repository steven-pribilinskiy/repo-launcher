import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GripVertical, List as ListIcon, Settings as SettingsIcon, Table2 } from "lucide-react";
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
  repoCount: number;
  sortMode: number;
  view: "list" | "table";
  onToggleView: () => void;
};

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

function triggerLabel(action: ActionDef): string {
  if (action.role === "primary") return "Enter";
  if (action.role === "alternative") return "Alt+Enter";
  return action.hotkey || "·";
}

// The bar doubles as the window's drag handle: empty areas (the elements carrying
// data-tauri-drag-region) move the window; the buttons inside stay clickable.
function ChipGrid({ items, onRun }: { items: ActionDef[]; onRun: (action: ActionDef) => void }) {
  return (
    // Columns hug their content (longest title) instead of splitting 50/50.
    <div className="grid grid-cols-[max-content_max-content] gap-x-6 gap-y-0.5">
      {items.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onRun(action)}
          title={action.label}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
        >
          <span className="w-16 shrink-0">
            <Kbd>{triggerLabel(action)}</Kbd>
          </span>
          <span className="whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ActionBar({
  actions,
  groups,
  onRun,
  onCycleSort,
  onOpenSettings,
  repoCount,
  sortMode,
  view,
  onToggleView,
}: ActionBarProps) {
  const enabled = actions.filter((action) => action.enabled);
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const ungrouped = enabled.filter((action) => !action.group || !knownGroupIds.has(action.group));
  const grouped = groups
    .map((group) => ({ group, items: enabled.filter((action) => action.group === group.id) }))
    .filter((section) => section.items.length > 0);

  return (
    <div
      onMouseDown={startWindowDrag}
      className="flex items-start gap-3 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700/50"
    >
      <div
        title="Drag to move"
        className="flex cursor-grab items-center self-stretch text-zinc-300 active:cursor-grabbing dark:text-zinc-600"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex flex-col gap-1.5">
        {ungrouped.length > 0 && <ChipGrid items={ungrouped} onRun={onRun} />}
        {grouped.map(({ group, items }) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
              {group.title}
            </span>
            <ChipGrid items={items} onRun={onRun} />
          </div>
        ))}
      </div>
      <div className="ml-auto flex flex-col items-end gap-1">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{repoCount} repos</span>
        <div className="flex items-center gap-2">
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
            title="Cycle sort order"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
          >
            <Kbd>Ctrl+S</Kbd>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Sort: {SORT_LABELS[sortMode]}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings (Ctrl+, / Ctrl+Alt+S)"
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
        >
          <Kbd>Ctrl+.</Kbd>
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
