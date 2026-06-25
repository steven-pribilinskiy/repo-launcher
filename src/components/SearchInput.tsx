import { forwardRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GripVertical, Search, X } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  isLoading: boolean;
};

// The drag handle lives on the right of the search row. begin_window_move locks the
// size against FancyZones/aero-snap and refreshes the auto-hide timer before the drag.
function startMove(event: React.MouseEvent) {
  if (event.button !== 0) return;
  void invoke("begin_window_move").catch(() => {});
  void getCurrentWindow().startDragging();
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, isLoading }, ref) => {
    return (
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700/50">
        <Search className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search repos…"
          autoFocus
          className="w-full bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
          spellCheck={false}
          autoComplete="off"
        />
        {isLoading && (
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
        )}
        {!isLoading && value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Clear search (Esc)"
            aria-label="Clear search"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <div
          onMouseDown={startMove}
          title="Drag to move"
          aria-label="Drag to move window"
          className="flex h-5 w-5 shrink-0 cursor-grab items-center justify-center text-zinc-300 active:cursor-grabbing dark:text-zinc-600"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </div>
    );
  },
);
