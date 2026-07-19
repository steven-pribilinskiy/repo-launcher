import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RepoItem } from "./RepoItem";
import type { FuzzyResult } from "@/types";

type RepoListProps = {
  results: FuzzyResult[];
  selectedIndex: number;
  showDistro: boolean;
  onSelect: (index: number) => void;
  /** Rendered in place of the rows when there are none. */
  emptyState: React.ReactNode;
};

export function RepoList({
  results,
  selectedIndex,
  showDistro,
  onSelect,
  emptyState,
}: RepoListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  // Scroll selected item into view
  useEffect(() => {
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  if (results.length === 0) return <>{emptyState}</>;

  return (
    <div ref={parentRef} className="repo-list flex-1 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            className="absolute left-0 top-0 w-full"
            style={{
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <RepoItem
              result={results[virtualItem.index]}
              isSelected={virtualItem.index === selectedIndex}
              showDistro={showDistro}
              onClick={() => onSelect(virtualItem.index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
