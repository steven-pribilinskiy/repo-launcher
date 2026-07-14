import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchInput } from "@/components/SearchInput";
import { RepoList } from "@/components/RepoList";
import { RepoTable, type TableSort, type TableSortColumn } from "@/components/RepoTable";
import { ActionBar } from "@/components/ActionBar";
import { ActionsPalette } from "@/components/ActionsPalette";
import { ResizeHandles } from "@/components/ResizeHandles";
import { useRepoSearch } from "@/hooks/useRepoSearch";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useRepoStore, reloadThrottleMs } from "@/stores/repoStore";
import { Onboarding } from "@/components/Onboarding";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import { repoName } from "@/lib/utils";
import { SYSTEM_ACTION_REFRESH, type ActionDef, type ActionGroup } from "@/types";

type View = "list" | "table";

// The shared sort mode (0 alpha / 1 recent / 2 most-used) maps 1:1 to a sortable
// table column, so Ctrl+S and the table headers stay in sync both ways.
const COLUMN_BY_SORT_MODE: TableSortColumn[] = ["name", "last_used", "uses", "type"];
const DIR_BY_SORT_MODE: ("asc" | "desc")[] = ["asc", "desc", "desc", "asc"];
const SORT_MODE_BY_COLUMN: Partial<Record<TableSortColumn, number>> = {
  name: 0,
  last_used: 1,
  uses: 2,
  type: 3,
};

const GRP_GENERAL: ActionGroup = { id: "grp-general", title: "General", kind: "plain" };

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
  const [paletteOpen, setPaletteOpen] = useState(false);

  const {
    repos,
    isLoading,
    isRefreshing,
    lastLoadAt,
    multiDistro,
    sortMode,
    config,
    loadConfig,
    loadRepos,
    cycleSort,
    setSort,
  } = useRepoStore();

  const results = useRepoSearch(query, repos);

  // The shared sort mode (cycled by Ctrl+S, set by clicking a table header) is the
  // single source of truth — the backend returns repos already ranked by it.
  const displayResults = results;
  // Reflect the active sort mode in the table headers (and vice versa).
  const tableSort: TableSort = {
    column: COLUMN_BY_SORT_MODE[sortMode] ?? "uses",
    dir: DIR_BY_SORT_MODE[sortMode] ?? "desc",
  };

  const onActionComplete = useCallback(() => {
    setQuery("");
    setPaletteOpen(false);
  }, []);

  const { selectedIndex, setSelectedIndex, runAction } = useKeyboardNav({
    results: displayResults,
    onActionComplete,
    paletteOpen,
    onTogglePalette: () => setPaletteOpen((open) => !open),
    hasQuery: query.length > 0,
    onClearQuery: () => setQuery(""),
  });

  const toggleView = useCallback(() => {
    setView((current) => {
      const next: View = current === "list" ? "table" : "list";
      localStorage.setItem("repo_view", next);
      return next;
    });
  }, []);

  const onSort = useCallback(
    (column: TableSortColumn) => {
      const mode = SORT_MODE_BY_COLUMN[column];
      if (mode !== undefined) void setSort(mode);
    },
    [setSort],
  );

  // Ticks once a second while the palette is open, just to keep the "Refresh
  // repos cache" row's countdown live — no need to re-render for it otherwise.
  const [paletteNow, setPaletteNow] = useState(() => Date.now());
  useEffect(() => {
    if (!paletteOpen) return;
    setPaletteNow(Date.now());
    const id = window.setInterval(() => setPaletteNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [paletteOpen]);

  const refreshAction: ActionDef = useMemo(() => {
    const remainingSec = Math.max(0, Math.ceil((lastLoadAt + reloadThrottleMs(config) - paletteNow) / 1000));
    return {
      id: SYSTEM_ACTION_REFRESH,
      label: isRefreshing ? "Refreshing repos cache…" : "Refresh repos cache",
      hotkey: "",
      enabled: true,
      kind: "system",
      group: GRP_GENERAL.id,
      rightLabel: isRefreshing ? "" : remainingSec > 0 ? `auto in ${remainingSec}s` : "auto now",
    };
  }, [isRefreshing, lastLoadAt, paletteNow, config]);

  // Diagnostics: when the popup mounts and when it first paints, relative to
  // process start — to locate any post-startup UI delay (e.g. after tray Reload).
  useEffect(() => {
    api.logEvent(`popup mounted at ${Math.round(performance.now())} ms`);
    const raf = requestAnimationFrame(() =>
      api.logEvent(`popup first paint at ${Math.round(performance.now())} ms`),
    );
    return () => cancelAnimationFrame(raf);
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
      // Measure the on-screen repaint latency after show: if the webview was
      // suspended while hidden, the next animation frame is delayed — that gap is
      // the "window appears but is unresponsive for a beat".
      const shownAt = performance.now();
      api.logEvent(`window-shown at ${Math.round(shownAt)} ms`);
      requestAnimationFrame(() =>
        api.logEvent(`post-show repaint +${Math.round(performance.now() - shownAt)} ms`),
      );
      setQuery("");
      setPaletteOpen(false);
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
      style={{ ["--surface-alpha" as string]: String(1 - (config?.transparency ?? 0) / 100) }}
      className="popup-surface relative flex h-full flex-col backdrop-blur-xl"
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
        groups={config?.groups ?? []}
        onRun={runAction}
        onCycleSort={cycleSort}
        onOpenSettings={() => api.openSettings()}
        onOpenPalette={() => setPaletteOpen(true)}
        repoCount={displayResults.length}
        sortMode={sortMode}
        view={view}
        onToggleView={toggleView}
      />
      <ResizeHandles />
      {paletteOpen && (
        <ActionsPalette
          actions={[...(config?.actions ?? []).filter((action) => action.enabled), refreshAction]}
          groups={[...(config?.groups ?? []), GRP_GENERAL]}
          repoName={repoName(displayResults[selectedIndex]?.repo.path ?? "")}
          onRun={runAction}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
