import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import type { ActionDef, ActionGroup } from "@/types";

function triggerLabel(action: ActionDef): string {
  if (action.role === "primary") return "Enter";
  if (action.role === "alternative") return "Alt+Enter";
  return action.hotkey || "";
}

/** Raycast-style action menu: opened with Ctrl+K, lists every enabled action for
 * the selected repo. Type to filter, ↑/↓ to move, Enter to run, Esc to close. */
export function ActionsPalette({
  actions,
  groups,
  repoName,
  onRun,
  onClose,
}: {
  actions: ActionDef[];
  groups: ActionGroup[];
  repoName: string;
  onRun: (action: ActionDef) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groupTitle = useMemo(() => {
    const map = new Map(groups.map((group) => [group.id, group.title]));
    return (action: ActionDef) => (action.group ? map.get(action.group) ?? "" : "");
  }, [groups]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (action) =>
        action.label.toLowerCase().includes(needle) ||
        groupTitle(action).toLowerCase().includes(needle),
    );
  }, [actions, query, groupTitle]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the active row in view as you arrow through.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = filtered[selected];
      if (action) onRun(action);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-black/30 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto mt-10 flex max-h-[80%] w-[88%] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
            Actions · <span className="text-zinc-600 dark:text-zinc-300">{repoName}</span>
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Filter actions…"
            className="ml-auto w-44 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div ref={listRef} className="overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-zinc-400">No matching actions.</div>
          )}
          {filtered.map((action, index) => {
            const trigger = triggerLabel(action);
            return (
              <button
                key={action.id}
                type="button"
                data-index={index}
                onMouseEnter={() => setSelected(index)}
                onClick={() => onRun(action)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === selected
                    ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                <span className="truncate">{action.label}</span>
                {groupTitle(action) && (
                  <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {groupTitle(action)}
                  </span>
                )}
                {trigger && (
                  <kbd className="ml-auto shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {trigger}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> Run
          </span>
          <span>↑↓ Navigate</span>
          <span className="ml-auto">Esc Close</span>
        </div>
      </div>
    </div>
  );
}
