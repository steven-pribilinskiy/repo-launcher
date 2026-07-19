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

/** Ceiling on a single cache read. The cache can sit behind a WSL UNC share that
 * stalls indefinitely (cold VM, dropped share) — an invoke that never settles
 * would latch `isLoading` and freeze the repo list for the whole process
 * lifetime, so every load is raced against this instead. */
const READ_TIMEOUT_MS = 15_000;

/** A rebuild walks the whole projects tree, so it gets a far longer budget than
 * a plain read — long enough not to fail a healthy scan, short enough to still
 * break a genuine hang. */
const REBUILD_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
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
  /** True once a read has succeeded, so an empty list can be told apart from a
   * load that has never completed. */
  hasLoaded: boolean;

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
  hasLoaded: false,

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  },

  loadRepos: async () => {
    if (get().isLoading || get().isRefreshing) return;
    if (Date.now() - get().lastLoadAt < reloadThrottleMs(get().config)) return;
    set({ isLoading: true, error: null });
    try {
      const [repos, sortMode] = await withTimeout(
        Promise.all([api.readRepos(), api.getSort()]),
        "Reading the repo cache",
        READ_TIMEOUT_MS,
      );
      const distros = new Set(repos.map((repo) => repo.distro));
      set({
        repos,
        sortMode,
        hasLoaded: true,
        multiDistro: distros.size > 1,
        lastLoadAt: Date.now(),
      });
      // Kick a background rebuild if the cache is stale; next open sees it fresh.
      api.maybeRefresh().catch(() => {});
    } catch (error) {
      // Leave lastLoadAt untouched so the next open retries instead of serving a
      // stale list behind the throttle.
      set({ error: String(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  // Explicit refresh (tray menu / palette action): bypasses the throttle above
  // and resets it, so the next popup open doesn't immediately re-read too.
  refresh: async () => {
    set({ isLoading: true, isRefreshing: true, error: null });
    try {
      const repos = await withTimeout(
        api.refreshRepos(),
        "Rebuilding the repo cache",
        REBUILD_TIMEOUT_MS,
      );
      const distros = new Set(repos.map((repo) => repo.distro));
      set({
        repos,
        hasLoaded: true,
        multiDistro: distros.size > 1,
        lastLoadAt: Date.now(),
      });
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isLoading: false, isRefreshing: false });
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
