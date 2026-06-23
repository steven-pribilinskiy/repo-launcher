import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RepoItem } from "./RepoItem";
import type { FuzzyResult } from "@/types";

type RepoListProps = {
  results: FuzzyResult[];
  selectedIndex: number;
  showDistro: boolean;
  onSelect: (index: number) => void;
};

export function RepoList({
  results,
  selectedIndex,
  showDistro,
  onSelect,
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

  if (results.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-sm text-zinc-500">
        No repos found
      </div>
    );
  }

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
