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
    <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700/50">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {enabled.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onRun(action)}
            title={action.label}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
          >
            <Kbd>{action.hotkey || "·"}</Kbd>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{action.label}</span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{repoCount}</span>
        <button
          type="button"
          onClick={onCycleSort}
          title="Cycle sort (Ctrl+S)"
          className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
        >
          <Kbd>^S</Kbd>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{SORT_LABELS[sortMode]}</span>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
