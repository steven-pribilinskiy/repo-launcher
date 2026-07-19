import { AlertTriangle, RefreshCw, SearchX } from "lucide-react";

type EmptyStateProps = {
  query: string;
  error: string | null;
  hasLoaded: boolean;
  isRefreshing: boolean;
  /** Repos currently in memory, before the query filter. */
  totalRepos: number;
  onRefresh: () => void;
};

/**
 * The single empty view for the popup. An empty list has several very different
 * causes — the cache failed to load, the cache is genuinely empty, or the query
 * simply matched nothing — and collapsing them into one "No repos found" hides
 * real breakage behind what reads like a normal search miss. Each case names its
 * cause and offers the action that resolves it.
 */
export function EmptyState({
  query,
  error,
  hasLoaded,
  isRefreshing,
  totalRepos,
  onRefresh,
}: EmptyStateProps) {
  const refreshButton = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      className="mt-3 inline-flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200/60 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
    >
      <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
      {isRefreshing ? "Rebuilding cache…" : "Rebuild cache"}
    </button>
  );

  if (error) {
    return (
      <Frame>
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <p className="mt-2 font-medium text-zinc-600 dark:text-zinc-300">Couldn’t read the repo cache</p>
        <p className="mt-1 max-w-[90%] break-words text-xs text-zinc-500">{error}</p>
        {refreshButton}
      </Frame>
    );
  }

  if (!hasLoaded) {
    return (
      <Frame>
        <p className="text-zinc-500">Loading repos…</p>
      </Frame>
    );
  }

  if (totalRepos === 0) {
    return (
      <Frame>
        <SearchX className="h-5 w-5 text-zinc-400" />
        <p className="mt-2 font-medium text-zinc-600 dark:text-zinc-300">The repo cache is empty</p>
        <p className="mt-1 text-xs text-zinc-500">Rebuild it to scan your projects folder.</p>
        {refreshButton}
      </Frame>
    );
  }

  return (
    <Frame>
      <SearchX className="h-5 w-5 text-zinc-400" />
      <p className="mt-2 font-medium text-zinc-600 dark:text-zinc-300">
        No repos match {query ? <span className="text-zinc-500">“{query}”</span> : "your search"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Searched {totalRepos.toLocaleString()} cached repos. Created it recently? It may not be
        cached yet.
      </p>
      {refreshButton}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center text-sm">
      {children}
    </div>
  );
}
