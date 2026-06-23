export type Repo = {
  /** Cache row type: "repo" | "wt" | "dir" | "ws". */
  kind: string;
  path: string;
  distro: string;
};

export type ActionKind = "clipboard" | "exec";

export type ActionRole = "primary" | "alternative";

export type ActionDef = {
  id: string;
  label: string;
  /** The action's own custom hotkey; "" = unbound. */
  hotkey: string;
  enabled: boolean;
  kind: ActionKind;
  /** "primary" fires on Enter, "alternative" on Alt+Enter; independent of hotkey. */
  role?: ActionRole | null;
  template?: string | null;
  program?: string | null;
  args?: string[] | null;
  platforms?: string[] | null;
};

export type BuildInfo = {
  version: string;
  built_unix: number;
};

export type AppConfig = {
  hotkey: string;
  cache_ttl_seconds: number;
  wsl_distro: string | null;
  cache_path: string | null;
  rebuild_command: string[] | null;
  theme: string;
  auto_restart_on_update: boolean;
  notify_on_update: boolean;
  remember_position: boolean;
  onboarded: boolean;
  actions: ActionDef[];
};

export type FuzzyResult = {
  repo: Repo;
  score: number;
  indices: number[];
};

export const SORT_LABELS = ["alpha", "recent", "most-used"] as const;
