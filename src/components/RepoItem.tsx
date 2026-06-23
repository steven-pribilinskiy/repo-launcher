import { cn, repoName } from "@/lib/utils";
import type { FuzzyResult } from "@/types";

type RepoItemProps = {
  result: FuzzyResult;
  isSelected: boolean;
  showDistro: boolean;
  onClick: () => void;
};

export function RepoItem({
  result,
  isSelected,
  showDistro,
  onClick,
}: RepoItemProps) {
  const { repo, indices } = result;
  const name = repoName(repo.path);
  const dir = repo.path.slice(0, repo.path.length - name.length);

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 px-4 py-2 transition-colors",
        isSelected
          ? "bg-zinc-200/70 dark:bg-zinc-700/60"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
      )}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <HighlightedText
              text={name}
              indices={indices}
              offset={dir.length}
            />
          </span>
          {showDistro && (
            <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
              {repo.distro}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-zinc-500">
          <HighlightedText text={repo.path} indices={indices} offset={0} />
        </div>
      </div>
    </div>
  );
}

function HighlightedText({
  text,
  indices,
  offset,
}: {
  text: string;
  indices: number[];
  offset: number;
}) {
  if (indices.length === 0) return <>{text}</>;

  const chars = text.split("");
  const highlightSet = new Set(indices.map((i) => i - offset));

  return (
    <>
      {chars.map((char, index) => (
        <span
          key={index}
          className={highlightSet.has(index) ? "text-blue-600 dark:text-blue-400" : undefined}
        >
          {char}
        </span>
      ))}
    </>
  );
}
