import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SearchInput } from "@/components/SearchInput";
import { RepoList } from "@/components/RepoList";
import { ActionBar } from "@/components/ActionBar";
import { useRepoSearch } from "@/hooks/useRepoSearch";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useRepoStore } from "@/stores/repoStore";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";

export default function Popup() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { repos, isLoading, multiDistro, sortMode, config, loadConfig, loadRepos, cycleSort } =
    useRepoStore();

  const results = useRepoSearch(query, repos);

  const onActionComplete = useCallback(() => {
    setQuery("");
  }, []);

  const { selectedIndex, setSelectedIndex, runAction } = useKeyboardNav({
    results,
    onActionComplete,
  });

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

  return (
    <div className="flex h-screen flex-col rounded-xl bg-white/95 backdrop-blur-xl dark:bg-zinc-900/95">
      <SearchInput ref={inputRef} value={query} onChange={setQuery} isLoading={isLoading} />
      <RepoList
        results={results}
        selectedIndex={selectedIndex}
        showDistro={multiDistro}
        onSelect={setSelectedIndex}
      />
      <ActionBar
        actions={config?.actions ?? []}
        onRun={runAction}
        onCycleSort={cycleSort}
        onOpenSettings={() => api.openSettings()}
        repoCount={results.length}
        sortMode={sortMode}
      />
    </div>
  );
}
