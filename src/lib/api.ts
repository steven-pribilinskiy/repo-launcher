import { invoke } from "@tauri-apps/api/core";
import type { ActionDef, AppConfig, BuildInfo, DataInfo, Repo } from "@/types";

export const api = {
  /** Read the goto-repo cache, ranked by the shared sort mode. */
  readRepos: () => invoke<Repo[]>("read_repos"),

  /** Rebuild the cache (blocking, via goto-repo) then return it ranked. */
  refreshRepos: () => invoke<Repo[]>("refresh_repos"),

  /** Kick a background rebuild if the cache is older than the TTL. */
  maybeRefresh: () => invoke<void>("maybe_refresh"),

  /** Current sort mode (0 alpha / 1 recent / 2 most-used). */
  getSort: () => invoke<number>("get_sort"),

  /** Cycle the shared sort mode and return the re-ranked repos. */
  cycleSort: () => invoke<Repo[]>("cycle_sort"),

  /** Run an action on a repo. Returns clipboard text for Clipboard actions. */
  runAction: (action: ActionDef, repo: Repo) =>
    invoke<string | null>("run_action", { action, repo }),

  listDistros: () => invoke<string[]>("list_distros"),

  openSettings: () => invoke<void>("open_settings"),

  updateHotkey: (hotkey: string) => invoke<void>("update_hotkey", { hotkey }),

  getConfig: () => invoke<AppConfig>("get_config"),

  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),

  resetConfig: () => invoke<AppConfig>("reset_config"),

  defaultConfig: () => invoke<AppConfig>("default_config"),

  appBuildInfo: () => invoke<BuildInfo>("app_build_info"),

  dataInfo: () => invoke<DataInfo>("data_info"),

  resetWindowGeometry: () => invoke<void>("reset_window_geometry"),

  /** Open a path: "file" = default app, "reveal" = folder with file selected,
   * "folder" = open the folder. */
  openPath: (path: string, mode: "file" | "reveal" | "folder") =>
    invoke<void>("open_path", { path, mode }),

  /** Write a timing/diagnostic line into the unified log (file + stdout). */
  logEvent: (message: string) => invoke<void>("log_event", { message }).catch(() => {}),
};
