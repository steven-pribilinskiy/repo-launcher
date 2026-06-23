export type Repo = {
  /** Cache row type: "repo" | "wt" | "dir" | "ws". */
  kind: string;
  path: string;
  distro: string;
};

export type ActionKind = "clipboard" | "exec";

export type ActionDef = {
  id: string;
  label: string;
  /** "Enter" marks the primary action; "" = unbound. */
  hotkey: string;
  enabled: boolean;
  kind: ActionKind;
  template?: string | null;
  program?: string | null;
  args?: string[] | null;
  platforms?: string[] | null;
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
  actions: ActionDef[];
};

export type FuzzyResult = {
  repo: Repo;
  score: number;
  indices: number[];
};

export const SORT_LABELS = ["alpha", "recent", "most-used"] as const;
