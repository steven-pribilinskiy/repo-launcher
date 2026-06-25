import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchInput } from "@/components/SearchInput";
import { RepoList } from "@/components/RepoList";
import { RepoTable, type TableSort, type TableSortColumn } from "@/components/RepoTable";
import { ActionBar } from "@/components/ActionBar";
import { ResizeHandles } from "@/components/ResizeHandles";
import { useRepoSearch } from "@/hooks/useRepoSearch";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useRepoStore } from "@/stores/repoStore";
import { Onboarding } from "@/components/Onboarding";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import { repoName } from "@/lib/utils";

type View = "list" | "table";

// Keep the caret in the search field no matter where you click. preventDefault on
// mousedown stops buttons / the list / drag handles from taking focus, so typing keeps
// working after any interaction. The input itself (and any text field) is exempt so it
// can focus and select text normally.
function keepSearchFocused(event: React.MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, [contenteditable=true]")) return;
  event.preventDefault();
}

export default function Popup() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>(() =>
    localStorage.getItem("repo_view") === "table" ? "table" : "list",
  );
  const [tableSort, setTableSort] = useState<TableSort | null>(null);

  const { repos, isLoading, multiDistro, sortMode, config, loadConfig, loadRepos, cycleSort } =
    useRepoStore();

  const results = useRepoSearch(query, repos);

  // In table view, an active column sort overrides the goto-repo ranking.
  const displayResults = useMemo(() => {
    if (view !== "table" || !tableSort) return results;
    const { column, dir } = tableSort;
    const sorted = [...results];
    sorted.sort((left, right) => {
      let cmp = 0;
      if (column === "name") cmp = repoName(left.repo.path).localeCompare(repoName(right.repo.path));
      else if (column === "type") cmp = left.repo.kind.localeCompare(right.repo.kind);
      else if (column === "uses") cmp = left.repo.uses - right.repo.uses;
      else cmp = left.repo.last_used - right.repo.last_used;
      return dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [results, view, tableSort]);

  const onActionComplete = useCallback(() => {
    setQuery("");
  }, []);

  const { selectedIndex, setSelectedIndex, runAction } = useKeyboardNav({
    results: displayResults,
    onActionComplete,
  });

  const toggleView = useCallback(() => {
    setView((current) => {
      const next: View = current === "list" ? "table" : "list";
      localStorage.setItem("repo_view", next);
      return next;
    });
  }, []);

  const onSort = useCallback((column: TableSortColumn) => {
    setTableSort((prev) => {
      if (prev?.column === column) return { column, dir: prev.dir === "asc" ? "desc" : "asc" };
      const dir = column === "name" || column === "type" ? "asc" : "desc";
      return { column, dir };
    });
  }, []);

  useEffect(() => {
    loadConfig().then(() => loadRepos());
  }, [loadConfig, loadRepos]);

  useEffect(() => {
    if (config) applyTheme(config.theme);
  }, [config]);

  // Re-summoned: reset, refocus, reload config (hotkey/actions/theme may have changed).
  useEffect(() => {
    const unlisten = listen("window-shown", () => {
      setQuery("");
      inputRef.current?.focus();
      loadConfig();
      loadRepos();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadConfig, loadRepos]);

  // Tray "Refresh Repos" — force a rebuild.
  useEffect(() => {
    const unlisten = listen("refresh-repos", () => {
      useRepoStore.getState().refresh();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keep the search field usable: whenever the window regains focus (after a drag,
  // alt-tab, etc.) put the caret back in the search input.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) inputRef.current?.focus();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (config && !config.onboarded) {
    return <Onboarding config={config} onDone={() => loadConfig()} />;
  }

  return (
    <div
      onMouseDown={keepSearchFocused}
      className="relative flex h-screen flex-col rounded-xl bg-white/95 backdrop-blur-xl dark:bg-zinc-900/95"
    >
      <SearchInput ref={inputRef} value={query} onChange={setQuery} isLoading={isLoading} />
      {view === "table" ? (
        <RepoTable
          results={displayResults}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          sort={tableSort}
          onSort={onSort}
        />
      ) : (
        <RepoList
          results={displayResults}
          selectedIndex={selectedIndex}
          showDistro={multiDistro}
          onSelect={setSelectedIndex}
        />
      )}
      <ActionBar
        actions={config?.actions ?? []}
        onRun={runAction}
        onCycleSort={cycleSort}
        onOpenSettings={() => api.openSettings()}
        repoCount={displayResults.length}
        sortMode={sortMode}
        view={view}
        onToggleView={toggleView}
      />
      <ResizeHandles />
    </div>
  );
}
