export type Repo = {
  /** Cache row type: "repo" | "wt" | "dir" | "ws". */
  kind: string;
  path: string;
  distro: string;
  uses: number;
  last_used: number;
};

export type ActionKind = "clipboard" | "exec" | "agent" | "paste" | "system";

/** Id of the built-in "Refresh repos cache" system action (synthesized in
 * Popup.tsx for the palette — frontend-only, never persisted to config). */
export const SYSTEM_ACTION_REFRESH = "system-refresh-repos";

export type ActionRole = "primary" | "alternative";

export type AgentHarness = "claude" | "codex" | "gemini";
export type TerminalKind = "wt" | "tabby";
export type GroupKind = "plain" | "agent";

/** A header-bearing group of actions. Agent groups carry harness settings. */
export type ActionGroup = {
  id: string;
  title: string;
  kind: GroupKind;
  /** Agent groups: which CLI harness backs the group's actions. */
  harness?: AgentHarness | null;
  /** Agent groups: append the harness's dangerous-permissions flag. */
  dangerous?: boolean | null;
  /** Agent groups: terminal override; null = use config.preferred_terminal. */
  terminal?: TerminalKind | null;
};

export type ActionDef = {
  id: string;
  label: string;
  /** The action's own custom hotkey; "" = unbound. */
  hotkey: string;
  enabled: boolean;
  kind: ActionKind;
  /** "primary" fires on Enter, "alternative" on Shift+Enter; independent of hotkey. */
  role?: ActionRole | null;
  template?: string | null;
  program?: string | null;
  args?: string[] | null;
  platforms?: string[] | null;
  /** Group id this action belongs to; null/undefined = ungrouped. */
  group?: string | null;
  /** Agent actions: extra flags appended after `{cli} {dangerousFlag}`. */
  agentFlags?: string | null;
  /** "system" actions only: replaces the hotkey chips with plain text (e.g. a
   * countdown). Frontend-only — never persisted or sent to the backend. */
  rightLabel?: string | null;
};

/** Display + command metadata per harness. Mirror of `agent_cli()` in repos.rs. */
export const AGENT_HARNESSES: Record<AgentHarness, { label: string; cli: string; dangerous: string }> = {
  claude: { label: "Claude Code", cli: "claude", dangerous: "--dangerously-skip-permissions" },
  codex: { label: "Codex", cli: "codex", dangerous: "--dangerously-bypass-approvals-and-sandbox" },
  gemini: { label: "Gemini", cli: "gemini", dangerous: "--yolo" },
};

export type BuildInfo = {
  version: string;
  built_unix: number;
};

export type UpdateCheck = {
  current: string;
  /** Newest published release, or null when the check failed or nothing is
   * released yet — neither of which means "up to date"; see `error`. */
  latest: string | null;
  available: boolean;
  release_url: string;
  /** Why the check couldn't answer, when it couldn't. */
  error: string | null;
};

export type PathStat = {
  path: string;
  exists: boolean;
  size: number;
  modified_unix: number;
};

export type TopUsed = {
  path: string;
  uses: number;
  last_unix: number;
};

export type DataInfo = {
  distro: string;
  cache_dir: string;
  config_dir: string;
  repos_tsv: PathStat;
  sort_file: PathStat;
  history_file: PathStat;
  log_file: PathStat;
  repo_count: number;
  sort_mode: number;
  sort_label: string;
  unique_paths: number;
  history_entries: number;
  /** True when the cache is being read through wsl.exe because the direct UNC
   * path is unreadable — working, but a subprocess per read. */
  uses_wsl_fallback: boolean;
  top_used: TopUsed[];
};

export type AppConfig = {
  hotkey: string;
  cache_ttl_seconds: number;
  /** Minutes the popup reuses its in-memory repo list before re-reading the
   * cache on show (0.5–24). Independent of `cache_ttl_seconds`. */
  reload_throttle_minutes: number;
  wsl_distro: string | null;
  wsl_home: string | null;
  cache_path: string | null;
  rebuild_command: string[] | null;
  theme: string;
  auto_restart_on_update: boolean;
  notify_on_update: boolean;
  remember_position: boolean;
  launch_at_startup: boolean;
  transparency: number;
  onboarded: boolean;
  desktop_shortcut_initialized: boolean;
  actions: ActionDef[];
  groups: ActionGroup[];
  /** Default terminal for agent-harness launches ("wt" | "tabby"). */
  preferred_terminal: TerminalKind;
  /** Paste actions type their text as keystrokes, leaving the clipboard alone.
   * Off = always clipboard + Ctrl+V. Windows only; elsewhere a paste is a copy. */
  paste_without_clipboard: boolean;
  /** Which generation of built-in actions this config has seen — drives the
   * one-shot backfill in the Rust `load_config`. Never edited from the UI. */
  builtin_actions_rev: number;
};

export type FuzzyResult = {
  repo: Repo;
  score: number;
  indices: number[];
};

export const SORT_LABELS = ["alpha", "recent", "most-used", "type"] as const;
