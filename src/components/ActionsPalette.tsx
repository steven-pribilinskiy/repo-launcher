import { useEffect, useMemo, useRef, useState } from "react";
import {
  Code,
  Copy,
  CornerDownLeft,
  ExternalLink,
  FolderOpen,
  Sparkles,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ActionDef, ActionGroup } from "@/types";

const UNGROUPED = "Other";

/** A sensible icon per action: agent → spark, clipboard → copy, exec → guessed
 * from the program/label (terminal / file manager / editor), else external. */
function actionIcon(action: ActionDef): LucideIcon {
  if (action.kind === "agent") return Sparkles;
  if (action.kind === "clipboard") return Copy;
  const hay = `${action.label} ${action.program ?? ""}`.toLowerCase();
  if (/(tabby|terminal|\bwsl\b|shell|\bcmd\b|bash|\bwt\b)/.test(hay)) return Terminal;
  if (/(explorer|finder|files|folder|nautilus)/.test(hay)) return FolderOpen;
  if (/(code|cursor|\bzed\b|editor|vim|idea|studio)/.test(hay)) return Code;
  return ExternalLink;
}

/** The trigger split into individual key chips, e.g. "Alt+Shift+C" → [Alt,Shift,C]. */
function triggerKeys(action: ActionDef): string[] {
  if (action.role === "primary") return ["Enter"];
  if (action.role === "alternative") return ["Alt", "Enter"];
  if (!action.hotkey) return [];
  return action.hotkey.split("+").map((part) => part.trim()).filter(Boolean);
}

/** Raycast-style action menu: opened with Ctrl+K, groups every enabled action for
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

  const groupTitles = useMemo(
    () => new Map(groups.map((group) => [group.id, group.title])),
    [groups],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => {
      const title = action.group ? groupTitles.get(action.group) ?? "" : "";
      return action.label.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
    });
  }, [actions, query, groupTitles]);

  // Group the filtered actions (group order, then ungrouped), assigning each a flat
  // index so ↑/↓ navigation and selection stay in sync with the rendered order.
  const { sections, flat } = useMemo(() => {
    const buckets = new Map<string, ActionDef[]>();
    for (const action of filtered) {
      const key = action.group && groupTitles.has(action.group) ? action.group : "__ungrouped__";
      const list = buckets.get(key);
      if (list) list.push(action);
      else buckets.set(key, [action]);
    }
    const built: { title: string; items: { action: ActionDef; index: number }[] }[] = [];
    const flatList: ActionDef[] = [];
    let index = 0;
    const push = (title: string, items: ActionDef[] | undefined) => {
      if (!items?.length) return;
      built.push({ title, items: items.map((action) => ({ action, index: index++ })) });
      flatList.push(...items);
    };
    for (const group of groups) push(group.title, buckets.get(group.id));
    push(UNGROUPED, buckets.get("__ungrouped__"));
    return { sections: built, flat: flatList };
  }, [filtered, groups, groupTitles]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = flat[selected];
      if (action) onRun(action);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery("");
      else onClose();
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
          <div className="relative ml-auto">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Filter actions…"
              className="w-48 rounded-md border border-zinc-300 bg-white py-1 pl-2 pr-7 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                title="Clear"
                aria-label="Clear filter"
                className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div ref={listRef} className="overflow-y-auto py-1">
          {flat.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-zinc-400">No matching actions.</div>
          )}
          {sections.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {section.title}
              </div>
              {section.items.map(({ action, index }) => {
                const Icon = actionIcon(action);
                const keys = triggerKeys(action);
                return (
                  <button
                    key={action.id}
                    type="button"
                    data-index={index}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => onRun(action)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                      index === selected
                        ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100"
                        : "text-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    <span className="truncate">{action.label}</span>
                    {keys.length > 0 && (
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {keys.map((key, position) => (
                          <kbd
                            key={`${key}-${position}`}
                            className="flex h-5 min-w-5 items-center justify-center rounded bg-zinc-200 px-1.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                          >
                            {key === "Enter" ? "↵" : key}
                          </kbd>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
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
