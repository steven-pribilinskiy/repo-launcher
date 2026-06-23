import { create } from "zustand";
import { api } from "@/lib/api";
import type { AppConfig, Repo } from "@/types";

type RepoStore = {
  repos: Repo[];
  isLoading: boolean;
  error: string | null;
  config: AppConfig | null;
  sortMode: number;
  multiDistro: boolean;

  loadConfig: () => Promise<void>;
  loadRepos: () => Promise<void>;
  refresh: () => Promise<void>;
  cycleSort: () => Promise<void>;
};

export const useRepoStore = create<RepoStore>((set, get) => ({
  repos: [],
  isLoading: false,
  error: null,
  config: null,
  sortMode: 2,
  multiDistro: false,

  loadConfig: async () => {
    try {
      const config = await api.getConfig();
      set({ config });
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  },

  loadRepos: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const [repos, sortMode] = await Promise.all([api.readRepos(), api.getSort()]);
      const distros = new Set(repos.map((repo) => repo.distro));
      set({
        repos,
        sortMode,
        isLoading: false,
        multiDistro: distros.size > 1,
      });
      // Kick a background rebuild if the cache is stale; next open sees it fresh.
      api.maybeRefresh().catch(() => {});
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const repos = await api.refreshRepos();
      const distros = new Set(repos.map((repo) => repo.distro));
      set({ repos, isLoading: false, multiDistro: distros.size > 1 });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  cycleSort: async () => {
    try {
      const repos = await api.cycleSort();
      set({ repos, sortMode: (get().sortMode + 1) % 3 });
    } catch (error) {
      console.error("Failed to cycle sort:", error);
    }
  },
}));
