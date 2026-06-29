import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn, repoName } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { FuzzyResult } from "@/types";

export type TableSortColumn = "name" | "type" | "uses" | "last_used";
export type TableSort = { column: TableSortColumn; dir: "asc" | "desc" };

const GRID = "grid grid-cols-[1fr_4rem_4rem_7rem] gap-2";
// Only Name / Uses / Last used map to the shared sort modes (alpha / most-used /
// recent), so only those are sortable. Type has no shared mode — plain header.
const COLUMNS: { key: TableSortColumn; label: string; align: string; sortable: boolean }[] = [
  { key: "name", label: "Name", align: "justify-start", sortable: true },
  { key: "type", label: "Type", align: "justify-start", sortable: false },
  { key: "uses", label: "Uses", align: "justify-end", sortable: true },
  { key: "last_used", label: "Last used", align: "justify-end", sortable: true },
];

type RepoTableProps = {
  results: FuzzyResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  sort: TableSort | null;
  onSort: (column: TableSortColumn) => void;
};

export function RepoTable({ results, selectedIndex, onSelect, sort, onSort }: RepoTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className={cn(
          GRID,
          "border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700/50",
        )}
      >
        {COLUMNS.map((column) => {
          const active = sort?.column === column.key;
          const base = cn(
            "flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide",
            column.align,
            active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400",
          );
          const arrow = active ? (
            sort.dir === "asc" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )
          ) : null;
          if (!column.sortable) {
            return (
              <span key={column.key} className={base}>
                {column.label}
              </span>
            );
          }
          return (
            <button
              key={column.key}
              type="button"
              onClick={() => onSort(column.key)}
              className={cn(base, "hover:text-zinc-600 dark:hover:text-zinc-300")}
            >
              {column.label}
              {arrow}
            </button>
          );
        })}
      </div>

      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          No repos found
        </div>
      ) : (
        <div ref={parentRef} className="repo-list flex-1 overflow-y-auto">
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const { repo } = results[virtualItem.index];
              const isSelected = virtualItem.index === selectedIndex;
              return (
                <div
                  key={virtualItem.key}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div
                    onClick={() => onSelect(virtualItem.index)}
                    className={cn(
                      GRID,
                      "h-full cursor-pointer items-center px-3 py-1.5",
                      isSelected
                        ? "bg-zinc-200/70 dark:bg-zinc-700/60"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {repoName(repo.path)}
                      </div>
                      <div className="truncate text-xs text-zinc-500">{repo.path}</div>
                    </div>
                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{repo.kind}</div>
                    <div className="text-right text-xs text-zinc-600 dark:text-zinc-300">
                      {repo.uses || "—"}
                    </div>
                    <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                      {repo.last_used ? timeAgo(repo.last_used) : "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
