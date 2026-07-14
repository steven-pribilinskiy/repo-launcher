import { create } from "zustand";
import { api } from "@/lib/api";
import type { AppConfig, Repo } from "@/types";

/** Fallback throttle (minutes) before config has loaded — mirrors the Rust
 * default in `default_reload_throttle_minutes()`. */
const DEFAULT_RELOAD_THROTTLE_MINUTES = 1;

/** Minimum time between automatic repo-cache reloads triggered by showing the
 * popup (mount + the window-shown listener both fire on every open), resolved
 * from `config.reload_throttle_minutes`. The cache can sit on a
 * network-mounted path (WSL UNC on Windows), so re-reading it on every toggle
 * is wasteful. An explicit refresh bypasses this. */
export function reloadThrottleMs(config: AppConfig | null): number {
  return (config?.reload_throttle_minutes ?? DEFAULT_RELOAD_THROTTLE_MINUTES) * 60_000;
}

type RepoStore = {
  repos: Repo[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  config: AppConfig | null;
  sortMode: number;
  multiDistro: boolean;
  lastLoadAt: number;

  loadConfig: () => Promise<void>;
  loadRepos: () => Promise<void>;
  refresh: () => Promise<void>;
  cycleSort: () => Promise<void>;
  setSort: (mode: number) => Promise<void>;
};

export const useRepoStore = create<RepoStore>((set, get) => ({
  repos: [],
  isLoading: false,
  isRefreshing: false,
  error: null,
  config: null,
  sortMode: 2,
  multiDistro: false,
  lastLoadAt: 0,

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  },

  loadRepos: async () => {
    if (get().isLoading || Date.now() - get().lastLoadAt < reloadThrottleMs(get().config)) return;
    set({ isLoading: true, error: null });
    try {
      const [repos, sortMode] = await Promise.all([api.readRepos(), api.getSort()]);
      const distros = new Set(repos.map((repo) => repo.distro));
      set({
        repos,
        sortMode,
        isLoading: false,
        multiDistro: distros.size > 1,
        lastLoadAt: Date.now(),
      });
      // Kick a background rebuild if the cache is stale; next open sees it fresh.
      api.maybeRefresh().catch(() => {});
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  // Explicit refresh (tray menu / palette action): bypasses the throttle above
  // and resets it, so the next popup open doesn't immediately re-read too.
  refresh: async () => {
    set({ isLoading: true, isRefreshing: true, error: null });
    try {
      const repos = await api.refreshRepos();
      const distros = new Set(repos.map((repo) => repo.distro));
      set({
        repos,
        isLoading: false,
        isRefreshing: false,
        multiDistro: distros.size > 1,
        lastLoadAt: Date.now(),
      });
    } catch (error) {
      set({ error: String(error), isLoading: false, isRefreshing: false });
    }
  },

  cycleSort: async () => {
    try {
      const repos = await api.cycleSort();
      set({ repos, sortMode: (get().sortMode + 1) % 4 });
    } catch (error) {
      console.error("Failed to cycle sort:", error);
    }
  },

  setSort: async (mode: number) => {
    try {
      const repos = await api.setSort(mode);
      set({ repos, sortMode: mode % 4 });
    } catch (error) {
      console.error("Failed to set sort:", error);
    }
  },
}));
