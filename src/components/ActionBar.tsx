import type { ReactNode } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { SORT_LABELS } from "@/types";
import type { ActionDef } from "@/types";

type ActionBarProps = {
  actions: ActionDef[];
  onRun: (action: ActionDef) => void;
  onCycleSort: () => void;
  onOpenSettings: () => void;
  repoCount: number;
  sortMode: number;
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
export function ActionBar({
  actions,
  onRun,
  onCycleSort,
  onOpenSettings,
  repoCount,
  sortMode,
}: ActionBarProps) {
  const enabled = actions.filter((action) => action.enabled);

  return (
    <div
      data-tauri-drag-region
      className="flex flex-col gap-1.5 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700/50"
    >
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {enabled.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onRun(action)}
            title={action.label}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
          >
            <Kbd>{triggerLabel(action)}</Kbd>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{action.label}</span>
          </button>
        ))}
      </div>
      <div data-tauri-drag-region className="flex items-center justify-end gap-3">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{repoCount} repos</span>
        <button
          type="button"
          onClick={onCycleSort}
          title="Cycle sort order"
          className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
        >
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Sort: {SORT_LABELS[sortMode]}
          </span>
          <Kbd>Ctrl+S</Kbd>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings (Ctrl+,)"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
