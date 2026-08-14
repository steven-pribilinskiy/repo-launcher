import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HotkeyInput } from "@/components/HotkeyInput";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
  MoreVertical,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import { formatBytes, timeAgo } from "@/lib/format";
import {
  AGENT_HARNESSES,
  type ActionDef,
  type ActionGroup,
  type ActionKind,
  type ActionRole,
  type AgentHarness,
  type AppConfig,
  type BuildInfo,
  type DataInfo,
  type PathStat,
  type TerminalKind,
  type UpdateCheck,
} from "@/types";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
const labelCls = "text-xs font-medium text-zinc-500 dark:text-zinc-400";
const PLACEHOLDERS = ["{path}", "{wslpath}", "{winpath}", "{name}", "{distro}", "{vscode_uri}"];

type Tab = "general" | "actions" | "updates" | "data";
type ResetScope = { general: boolean; actions: boolean };

let nextId = 0;
function freshActionId() {
  nextId += 1;
  return `custom-${nextId}`;
}

let nextGroupId = 0;
function freshGroupId() {
  nextGroupId += 1;
  return `group-${nextGroupId}`;
}

function harnessGroupTitle(harness: AgentHarness): string {
  return `Agent harness: ${AGENT_HARNESSES[harness].label}`;
}

const UNGROUPED_KEY = "__ungrouped__";

/** Why an enabled action won't work yet — or null if it's complete. Drives the
 * inline warnings and the "unfinished" summary next to Close. Disabled actions are
 * intentionally off, so they never count as incomplete. */
function actionIncompleteReason(action: ActionDef): string | null {
  if (!action.enabled) return null;
  const hasTrigger = Boolean(action.role) || Boolean(action.hotkey?.trim());
  if (!hasTrigger) {
    return "No trigger — set a hotkey, or make it primary/alternative, or it won't appear in the popup.";
  }
  if (action.kind === "exec" && !action.program?.trim()) return "No program set.";
  if (hasTemplate(action.kind) && !action.template?.trim()) return "No template set.";
  return null;
}

/** Kinds driven by a `{placeholder}` template rather than a program + args. */
function hasTemplate(kind: ActionKind): boolean {
  return kind === "clipboard" || kind === "paste";
}

function countIncomplete(actions: ActionDef[]): number {
  return actions.reduce((total, action) => total + (actionIncompleteReason(action) ? 1 : 0), 0);
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [defaults, setDefaults] = useState<AppConfig | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [resetOpen, setResetOpen] = useState(false);
  // Which action's editor is open (lifted so the "unfinished" summary can ignore
  // the row you're actively filling in).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    api.getConfig().then((loaded) => {
      setConfig(loaded);
      applyTheme(loaded.theme);
    });
    api.defaultConfig().then(setDefaults).catch(() => {});
    api.listDistros().then(setDistros).catch(() => {});
    api.appBuildInfo().then(setBuild).catch(() => {});
  }, []);

  // Auto-save (debounced) — no Save button. Skips the initial load.
  useEffect(() => {
    if (!config || !dirty.current) return;
    const handle = setTimeout(async () => {
      const cleaned = cleanConfig(config);
      try {
        await api.saveConfig(cleaned);
        await api.updateHotkey(cleaned.hotkey).catch(() => {});
      } catch (error) {
        console.error("Failed to save settings:", error);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [config]);

  // Esc closes the settings window — but first close the reset modal, or blur a
  // focused field, so it only closes when nothing is being edited.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (resetOpen) {
        setResetOpen(false);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
        active.blur();
        return;
      }
      getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetOpen]);

  // Compare ignoring `onboarded` — it's a state flag, not a resettable setting, so
  // a completed onboarding shouldn't make "Reset to defaults" appear.
  const isDefault = useMemo(() => {
    if (!config || !defaults) return true;
    // Ignore onboarding state and the auto-primed WSL distro/home cache — none of
    // those are user preferences, so they shouldn't make "Reset to defaults" appear.
    const strip = (value: AppConfig) =>
      JSON.stringify({
        ...value,
        onboarded: false,
        desktop_shortcut_initialized: false,
        wsl_distro: null,
        wsl_home: null,
      });
    return strip(config) === strip(defaults);
  }, [config, defaults]);

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-sm text-zinc-500 dark:bg-zinc-900">
        Loading…
      </div>
    );
  }

  const patch = (changes: Partial<AppConfig>) => {
    dirty.current = true;
    setConfig({ ...config, ...changes });
  };

  // Don't count the action whose editor is open — a just-added row shouldn't nag
  // before the user has had a chance to give it a hotkey.
  const incompleteCount = countIncomplete(
    config.actions.filter((action) => action.id !== editingActionId),
  );

  const applyDefaults = (scope: ResetScope) => {
    if (!defaults) return;
    dirty.current = true;
    // Keep onboarded so resetting settings doesn't re-trigger the welcome screen.
    const next: AppConfig = { ...config };
    if (scope.general) {
      next.hotkey = defaults.hotkey;
      next.theme = defaults.theme;
      next.wsl_distro = defaults.wsl_distro;
      next.cache_path = defaults.cache_path;
      next.rebuild_command = defaults.rebuild_command;
      next.cache_ttl_seconds = defaults.cache_ttl_seconds;
      next.reload_throttle_minutes = defaults.reload_throttle_minutes;
      next.remember_position = defaults.remember_position;
      next.launch_at_startup = defaults.launch_at_startup;
      next.transparency = defaults.transparency;
      next.auto_restart_on_update = defaults.auto_restart_on_update;
      next.notify_on_update = defaults.notify_on_update;
      next.preferred_terminal = defaults.preferred_terminal;
    }
    if (scope.actions) {
      next.actions = defaults.actions;
      next.groups = defaults.groups;
    }
    setConfig(next);
    if (scope.general) {
      applyTheme(next.theme);
      api.updateHotkey(next.hotkey).catch(() => {});
    }
    setResetOpen(false);
  };

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-5 pt-3 dark:border-zinc-800">
        <div className="flex items-end gap-1">
          {(["general", "actions", "updates", "data"] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded-t-md px-3 py-2 text-sm capitalize ${
                tab === name
                  ? "border-b-2 border-indigo-600 font-medium text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {incompleteCount > 0 && (
            <button
              type="button"
              onClick={() => setTab("actions")}
              title="These actions have no trigger (or no command) and won't appear in the popup. Click to review."
              className="flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {incompleteCount} unfinished
            </button>
          )}
          {!isDefault && (
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "general" && <GeneralTab config={config} patch={patch} />}
        {tab === "updates" && <UpdatesTab config={config} patch={patch} />}
        {tab === "actions" && (
          <ActionsTab
            actions={config.actions}
            groups={config.groups}
            onChange={(changes) => patch(changes)}
            editingId={editingActionId}
            setEditingId={setEditingActionId}
          />
        )}
        {tab === "data" && <DataTab config={config} distros={distros} patch={patch} />}
      </div>

      <footer className="flex items-center justify-end border-t border-zinc-200 px-5 py-2 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {build ? `v${build.version} · built ${timeAgo(build.built_unix)}` : ""}
      </footer>

      {resetOpen && defaults && (
        <ResetModal
          config={config}
          defaults={defaults}
          onConfirm={applyDefaults}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </div>
  );
}

/** Drop trailing blank arg lines (a middle "" can be intentional). */
function cleanConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    actions: config.actions.map((action) => {
      if (action.kind !== "exec" || !action.args) return action;
      const args = [...action.args];
      while (args.length && args[args.length - 1] === "") args.pop();
      return { ...action, args };
    }),
  };
}

// ── General tab ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function GeneralTab({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (changes: Partial<AppConfig>) => void;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Appearance">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Theme</span>
            <select
              className={inputCls}
              value={config.theme}
              onChange={(event) => {
                patch({ theme: event.target.value });
                applyTheme(event.target.value);
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Window transparency</span>
            <div className="flex h-[34px] items-center gap-2">
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={config.transparency}
                onChange={(event) => patch({ transparency: Number(event.target.value) })}
                className="w-full accent-indigo-600"
              />
              <span className="w-16 shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">
                {config.transparency === 0 ? "Opaque" : `${config.transparency}%`}
              </span>
            </div>
          </label>
        </div>
      </Section>

      <Section title="Popup window">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Global hotkey</span>
            <HotkeyInput value={config.hotkey} onChange={(hotkey) => patch({ hotkey })} />
          </label>
        </div>
        <Toggle
          checked={config.remember_position}
          onChange={(value) => patch({ remember_position: value })}
          label="Remember the popup's position between launches"
        />
        <div>
          <button
            type="button"
            onClick={() => api.resetWindowGeometry()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reset size &amp; position
          </button>
        </div>
      </Section>

      <Section title="Startup &amp; integration">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Preferred terminal (agent harness)</span>
            <select
              className={inputCls}
              value={config.preferred_terminal}
              onChange={(event) =>
                patch({ preferred_terminal: event.target.value as TerminalKind })
              }
            >
              <option value="wt">Windows Terminal</option>
              <option value="tabby">Tabby</option>
            </select>
          </label>
        </div>
        <Toggle
          checked={config.launch_at_startup}
          onChange={(value) => patch({ launch_at_startup: value })}
          label="Launch at startup (start automatically when you log in)"
        />
        <DesktopShortcutButton />
      </Section>

      <Section title="Paste to active app">
        <Toggle
          checked={config.paste_without_clipboard}
          onChange={(value) => patch({ paste_without_clipboard: value })}
          label="Paste without the clipboard"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Shift+Enter sends the text straight to the window the popup interrupted, typing it as
          keystrokes so whatever you had copied survives. A window that refuses synthesized input
          (anything running elevated) falls back to clipboard + Ctrl+V, and if that is refused too
          the text is left on the clipboard to paste by hand. Turn this off to always use
          clipboard + Ctrl+V. Windows only — elsewhere a paste action just copies.
        </p>
      </Section>
    </div>
  );
}

/** Everything that decides WHERE the repo cache comes from and how often it is
 * re-read. Lives on the Data tab, next to the files these settings resolve to. */
function CacheSettings({
  config,
  distros,
  patch,
}: {
  config: AppConfig;
  distros: string[];
  patch: (changes: Partial<AppConfig>) => void;
}) {
  const rebuildText = useMemo(
    () => (config.rebuild_command ?? []).join(" "),
    [config.rebuild_command],
  );
  // Keep a configured distro selectable even when it isn't in the detected list,
  // so an unreachable or renamed distro is never silently switched away.
  const distroOptions = useMemo(() => {
    const current = config.wsl_distro ?? "";
    return current && !distros.includes(current) ? [current, ...distros] : distros;
  }, [config.wsl_distro, distros]);

  return (
    <Section title="Cache source">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>WSL distro (cache host)</span>
          <select
            className={inputCls}
            value={config.wsl_distro ?? ""}
            onChange={(event) => patch({ wsl_distro: event.target.value || null })}
          >
            <option value="">Auto-detect</option>
            {distroOptions.map((distro) => (
              <option key={distro} value={distro}>
                {distro}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Cache TTL (seconds)</span>
          <input
            type="number"
            className={inputCls}
            value={config.cache_ttl_seconds}
            onChange={(event) => patch({ cache_ttl_seconds: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Popup reload cache</span>
          <select
            className={inputCls}
            value={config.reload_throttle_minutes}
            onChange={(event) => patch({ reload_throttle_minutes: Number(event.target.value) })}
          >
            <option value={0.5}>30 sec</option>
            <option value={1}>1 min</option>
            <option value={2}>2 min</option>
            <option value={4}>4 min</option>
            <option value={6}>6 min</option>
            <option value={12}>12 min</option>
            <option value={24}>24 min</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Cache path override (goto-repo cache dir)</span>
        <input
          className={inputCls}
          value={config.cache_path ?? ""}
          onChange={(event) => patch({ cache_path: event.target.value || null })}
          placeholder="auto (resolved from WSL distro)"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Rebuild command (space-separated)</span>
        <input
          className={inputCls}
          value={rebuildText}
          onChange={(event) => {
            const parts = event.target.value.trim().split(/\s+/).filter(Boolean);
            patch({ rebuild_command: parts.length ? parts : null });
          }}
          placeholder="auto (wsl.exe -d <distro> -- bash -lc 'find-repo --rebuild')"
        />
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          How the launcher regenerates its repo list — it runs goto-repo's scanner over your
          projects and writes the cache the popup reads. Leave blank to auto-detect; the tray's
          “Refresh Repos” and “Rebuild cache” above run this.
        </span>
      </label>
    </Section>
  );
}

function DesktopShortcutButton() {
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await api.createDesktopShortcut();
            setStatus("done");
          } catch {
            setStatus("error");
          }
          setTimeout(() => setStatus("idle"), 2500);
        }}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Create desktop shortcut
      </button>
      {status === "done" && <span className="text-xs text-emerald-600 dark:text-emerald-400">Created on desktop</span>}
      {status === "error" && <span className="text-xs text-red-600 dark:text-red-400">Couldn’t create it</span>}
    </div>
  );
}

function UpdatesTab({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (changes: Partial<AppConfig>) => void;
}) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = () => {
    setChecking(true);
    api
      .checkForUpdate()
      .then(setCheck)
      .catch((error) =>
        setCheck({
          current: "",
          latest: null,
          available: false,
          release_url: "",
          error: String(error),
        }),
      )
      .finally(() => setChecking(false));
  };

  // Check on open, so the tab answers "am I current?" without being asked.
  useEffect(runCheck, []);

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runCheck}
            disabled={checking}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {check?.available && check.latest && (
            <button
              type="button"
              onClick={() => void api.openUrl(check.release_url)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Download v{check.latest}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {checking
            ? "Asking GitHub for the newest release…"
            : !check
              ? "Not checked yet."
              : check.error
                ? `Couldn’t check: ${check.error}. The version you’re running may not be the newest.`
                : check.available
                  ? `v${check.latest} is available — you’re on v${check.current}. Downloading opens the release page; run the installer to update.`
                  : `You’re on v${check.current}, the newest release.`}
        </p>
      </div>
      <Toggle
        checked={config.notify_on_update}
        onChange={(value) => patch({ notify_on_update: value })}
        label="Notify me when a new version is published, and after updating"
      />
      <Toggle
        checked={config.auto_restart_on_update}
        onChange={(value) => patch({ auto_restart_on_update: value })}
        label="Restart automatically when the app file is replaced (Linux/macOS only — on Windows the installer does the restart)"
      />
      <div className="pt-2">
        <button
          type="button"
          onClick={() => patch({ onboarded: false })}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Show the welcome screen again
        </button>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Appears the next time you open the launcher.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-2 ${className ?? ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-indigo-600"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ── Data tab ──────────────────────────────────────────────────────────────────

// Hover-revealed path actions. For a file: Open file (default app) · Open folder
// (reveal + select the file) · Copy. For a folder: Open folder · Copy. Space is
// reserved (opacity, not display) so revealing them never shifts the layout.
function PathActions({
  path,
  kind,
  exists = true,
}: {
  path: string;
  kind: "file" | "folder";
  exists?: boolean;
}) {
  const btn =
    "rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-200";
  return (
    <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
      {exists && kind === "file" && (
        <button type="button" className={btn} onClick={() => api.openPath(path, "file")}>
          Open file
        </button>
      )}
      {exists && (
        <button
          type="button"
          className={btn}
          onClick={() => api.openPath(path, kind === "file" ? "reveal" : "folder")}
        >
          Open folder
        </button>
      )}
      <button type="button" className={btn} onClick={() => writeText(path)}>
        Copy
      </button>
    </div>
  );
}

function FileCard({ title, stat, extra }: { title: string; stat: PathStat; extra: string }) {
  return (
    <div className="group rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</span>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {stat.exists ? `${formatBytes(stat.size)} · updated ${timeAgo(stat.modified_unix)}` : "missing"}
        </span>
      </div>
      <div className="flex items-start justify-between gap-2">
        <code className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{stat.path}</code>
        <PathActions path={stat.path} kind="file" exists={stat.exists} />
      </div>
      <div className="mt-1 text-xs text-indigo-600 dark:text-indigo-400">{extra}</div>
    </div>
  );
}

function DataTab({
  config,
  distros,
  patch,
}: {
  config: AppConfig;
  distros: string[];
  patch: (changes: Partial<AppConfig>) => void;
}) {
  const [data, setData] = useState<DataInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => api.dataInfo().then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshRepos();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The launcher reads the same goto-repo files as the <code>fr</code>/<code>g</code> shell
          finder — distro <span className="font-medium">{data.distro}</span>.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {refreshing ? "Rebuilding…" : "Rebuild cache"}
        </button>
      </div>

      {data.uses_wsl_fallback && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <p className="font-medium">Reading the cache through wsl.exe</p>
            <p className="mt-1">
              Windows can’t see these files over <code>\\wsl.localhost</code>, so each read runs a
              WSL subprocess instead. Everything works — the popup just opens a little slower. This
              usually means Windows is holding a stale view of the directory; a{" "}
              <code>wsl --shutdown</code> clears it, but it closes every running WSL session first.
            </p>
          </div>
        </div>
      )}

      <CacheSettings config={config} distros={distros} patch={patch} />

      <FileCard title="Repos cache" stat={data.repos_tsv} extra={`${data.repo_count} repos`} />
      <FileCard
        title="Sort"
        stat={data.sort_file}
        extra={`mode ${data.sort_mode} — ${data.sort_label}`}
      />
      <FileCard
        title="Usage history"
        stat={data.history_file}
        extra={`${data.history_entries} entries across ${data.unique_paths} paths`}
      />
      <FileCard
        title="Startup / debug log"
        stat={data.log_file}
        extra={data.log_file.exists ? "Startup timings + warnings land here" : "No log yet"}
      />

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Most used
        </h3>
        <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
          {data.top_used.length === 0 && (
            <span className="px-1 text-xs text-zinc-400">No history yet.</span>
          )}
          {data.top_used.map((entry) => (
            <div
              key={entry.path}
              className="group flex items-center justify-between gap-2 rounded px-1 text-xs hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50"
            >
              <code className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{entry.path}</code>
              <div className="flex shrink-0 items-center gap-2">
                <PathActions path={entry.path} kind="folder" />
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                  {entry.uses}× · {timeAgo(entry.last_unix)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Actions tab (table + drag-and-drop + kebab) ───────────────────────────────

type ActionsChange = { actions?: ActionDef[]; groups?: ActionGroup[] };

function ActionsTab({
  actions,
  groups,
  onChange,
  editingId,
  setEditingId,
}: {
  actions: ActionDef[];
  groups: ActionGroup[];
  onChange: (changes: ActionsChange) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // The kebab menu renders in a portal at fixed viewport coords so it's never
  // clipped by the table's overflow.
  const [kebab, setKebab] = useState<{ index: number; top: number; right: number } | null>(null);

  // Accordion state tracks which keys are EXPANDED (default empty = all collapsed).
  // Tracking "expanded" rather than "collapsed" makes collapsed-by-default robust:
  // it never depends on knowing the group ids at mount time.
  const allKeys = useMemo(() => [...groups.map((group) => group.id), UNGROUPED_KEY], [groups]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const isOpen = (key: string) => expanded.has(key);
  const toggleCollapsed = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  const expandAll = () => setExpanded(new Set(allKeys));
  const collapseAll = () => setExpanded(new Set());

  useEffect(() => {
    if (!kebab) return;
    const close = () => setKebab(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [kebab]);

  const setActions = (next: ActionDef[]) => onChange({ actions: next });
  const setGroups = (next: ActionGroup[]) => onChange({ groups: next });

  const patchAction = (index: number, changes: Partial<ActionDef>) =>
    setActions(actions.map((action, current) => (current === index ? { ...action, ...changes } : action)));

  const setRole = (index: number, role: ActionRole | null) =>
    setActions(
      actions.map((action, current) => {
        if (current === index) return { ...action, role };
        // A role is unique — clear it from whoever else held it.
        if (role && action.role === role) return { ...action, role: null };
        return action;
      }),
    );

  const removeAction = (index: number) => setActions(actions.filter((_, current) => current !== index));

  const newActionForGroup = (group: ActionGroup | null): ActionDef => {
    if (group?.kind === "agent") {
      return {
        id: freshActionId(),
        // Starts as the harness base label; the editor locks that prefix and lets
        // the user add a distinguishing suffix.
        label: AGENT_HARNESSES[(group.harness ?? "claude") as AgentHarness].label,
        hotkey: "",
        enabled: true,
        kind: "agent",
        role: null,
        program: null,
        args: null,
        template: null,
        platforms: null,
        group: group.id,
        agentFlags: "",
      };
    }
    return {
      id: freshActionId(),
      label: "New action",
      hotkey: "",
      enabled: true,
      kind: "exec",
      role: null,
      program: "",
      args: [],
      template: null,
      platforms: null,
      group: group ? group.id : null,
      agentFlags: null,
    };
  };

  const addAction = () => {
    const created = newActionForGroup(null);
    setActions([...actions, created]);
    setEditingId(created.id);
    expand(UNGROUPED_KEY);
  };

  const addActionToGroup = (group: ActionGroup) => {
    const created = newActionForGroup(group);
    setActions([...actions, created]);
    setEditingId(created.id);
    expand(group.id);
  };

  const addPresetGroup = () => {
    const group: ActionGroup = {
      id: freshGroupId(),
      title: harnessGroupTitle("claude"),
      kind: "agent",
      harness: "claude",
      dangerous: true,
      terminal: null,
    };
    onChange({ groups: [...groups, group], actions: [...actions, newActionForGroup(group)] });
    expand(group.id);
  };

  // Switching a group's harness retitles the group AND renames its agent actions
  // that still carry the old harness's default labels (e.g. "Claude Code" ->
  // "Codex", "Claude Code — resume" -> "Codex — resume"), leaving custom labels.
  const setGroupHarness = (id: string, harness: AgentHarness) => {
    const newLabel = AGENT_HARNESSES[harness].label;
    // A label is "default" (and should follow the harness) if it's any harness's
    // base label, or that base + " — resume". Custom labels are left untouched.
    // Includes the legacy short base "Claude" so older "Claude — resume" labels heal.
    const knownBases = new Set([...Object.values(AGENT_HARNESSES).map((meta) => meta.label), "Claude"]);
    const remap = (label: string) => {
      const trimmed = label.trim();
      const withSuffix = trimmed.match(/^(.*?)\s*[—-]\s*(.+)$/);
      if (withSuffix && knownBases.has(withSuffix[1].trim())) {
        return `${newLabel} — ${withSuffix[2].trim()}`;
      }
      if (knownBases.has(trimmed)) return newLabel;
      return label;
    };
    onChange({
      groups: groups.map((candidate) =>
        candidate.id === id ? { ...candidate, harness, title: harnessGroupTitle(harness) } : candidate,
      ),
      actions: actions.map((action) =>
        action.group === id && action.kind === "agent" ? { ...action, label: remap(action.label) } : action,
      ),
    });
  };

  const patchGroup = (id: string, changes: Partial<ActionGroup>) =>
    setGroups(groups.map((group) => (group.id === id ? { ...group, ...changes } : group)));

  const deleteGroup = (id: string) =>
    onChange({ groups: groups.filter((group) => group.id !== id), actions: actions.filter((action) => action.group !== id) });

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...actions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setActions(next);
  };

  const indexed = actions.map((action, index) => ({ action, index }));
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const ungrouped = indexed.filter(({ action }) => !action.group || !knownGroupIds.has(action.group));

  const renderRow = ({ action, index }: { action: ActionDef; index: number }) => {
    // Suppress the warning on the row you're editing — no nagging mid-edit.
    const incomplete = editingId === action.id ? null : actionIncompleteReason(action);
    return (
    <div key={action.id}>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (dragIndex !== null) reorder(dragIndex, index);
          setDragIndex(null);
        }}
        className={`flex items-center gap-2.5 border-b px-2 py-1.5 last:border-b-0 ${
          incomplete
            ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
            : "border-zinc-100 dark:border-zinc-800/60"
        } ${dragIndex === index ? "opacity-50" : ""}`}
      >
        <span
          draggable
          onDragStart={(event) => {
            setDragIndex(index);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
          }}
          onDragEnd={() => setDragIndex(null)}
          className="shrink-0 cursor-grab text-zinc-300 dark:text-zinc-600"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <input
          type="checkbox"
          checked={action.enabled}
          onChange={(event) => patchAction(index, { enabled: event.target.checked })}
          className="h-4 w-4 shrink-0 accent-indigo-600"
          title="Enabled"
        />
        <button
          type="button"
          onClick={() => setEditingId(editingId === action.id ? null : action.id)}
          className="flex min-w-0 max-w-[280px] items-center gap-1.5 truncate text-left text-sm hover:text-indigo-600 dark:hover:text-indigo-400"
          title="Edit details"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
              editingId === action.id ? "rotate-180" : ""
            }`}
          />
          <span className="truncate">{action.label || "(unnamed)"}</span>
          {incomplete && (
            <span title={incomplete} className="shrink-0 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
        <span className="shrink-0">
          <TriggerBadge action={action} />
        </span>
        <span className="shrink-0 text-xs capitalize text-zinc-500 dark:text-zinc-400">{action.kind}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setKebab(
              kebab?.index === index
                ? null
                : { index, top: rect.bottom + 4, right: window.innerWidth - rect.right },
            );
          }}
          className="ml-auto shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="More"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
      {editingId === action.id && (
        <ActionEditor
          action={action}
          group={groups.find((group) => group.id === action.group) ?? null}
          groups={groups}
          onChange={(changes) => patchAction(index, changes)}
        />
      )}
    </div>
    );
  };

  return (
    <div className="max-w-3xl">
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        Drag the handle to reorder within a group. Unchecked actions are hidden and their hotkey is ignored.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={expandAll}
          title="Expand all groups"
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" /> Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title="Collapse all groups"
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ChevronsDownUp className="h-3.5 w-3.5 shrink-0" /> Collapse all
        </button>
        <button
          type="button"
          onClick={addPresetGroup}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" /> Agent group
        </button>
        <button
          type="button"
          onClick={addAction}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" /> Action
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        {groups.map((group) => {
          const items = indexed.filter(({ action }) => action.group === group.id);
          // Hide empty plain groups (e.g. a stale default group from an older
          // config); agent groups always show so they stay configurable.
          if (group.kind !== "agent" && items.length === 0) return null;
          const open = isOpen(group.id);
          const incomplete = items.reduce(
            (total, { action }) =>
              total + (action.id !== editingId && actionIncompleteReason(action) ? 1 : 0),
            0,
          );
          return (
            <div key={group.id}>
              <GroupHeader
                group={group}
                open={open}
                count={items.length}
                incomplete={incomplete}
                onToggle={() => toggleCollapsed(group.id)}
                onAdd={() => addActionToGroup(group)}
                onDelete={() => deleteGroup(group.id)}
                onHarness={(harness) => setGroupHarness(group.id, harness)}
                onDangerous={(dangerous) => patchGroup(group.id, { dangerous })}
                onTerminal={(terminal) => patchGroup(group.id, { terminal })}
              />
              {open && items.map(renderRow)}
            </div>
          );
        })}
        {ungrouped.length > 0 &&
          (() => {
            const open = isOpen(UNGROUPED_KEY);
            const incomplete = ungrouped.reduce(
              (total, { action }) =>
                total + (action.id !== editingId && actionIncompleteReason(action) ? 1 : 0),
              0,
            );
            return (
              <div>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(UNGROUPED_KEY)}
                  className="flex w-full items-center gap-2 border-b border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 text-left hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/60"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Ungrouped
                  </span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{ungrouped.length}</span>
                  {incomplete > 0 && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {incomplete}
                    </span>
                  )}
                </button>
                {open && ungrouped.map(renderRow)}
              </div>
            );
          })()}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        Placeholders: {PLACEHOLDERS.join("  ")}
      </p>

      {kebab &&
        actions[kebab.index] &&
        createPortal(
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
            style={{ top: kebab.top, right: kebab.right }}
            onClick={(event) => event.stopPropagation()}
          >
            <KebabItem
              onClick={() => {
                setRole(kebab.index, "primary");
                setKebab(null);
              }}
              active={actions[kebab.index].role === "primary"}
            >
              Make primary (Enter)
            </KebabItem>
            <KebabItem
              onClick={() => {
                setRole(kebab.index, "alternative");
                setKebab(null);
              }}
              active={actions[kebab.index].role === "alternative"}
            >
              Make alternative (Shift+Enter)
            </KebabItem>
            {actions[kebab.index].role && (
              <KebabItem
                onClick={() => {
                  setRole(kebab.index, null);
                  setKebab(null);
                }}
              >
                Clear role
              </KebabItem>
            )}
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
            <KebabItem
              onClick={() => {
                setEditingId(actions[kebab.index].id);
                setKebab(null);
              }}
            >
              Edit details…
            </KebabItem>
            <KebabItem
              onClick={() => {
                removeAction(kebab.index);
                setKebab(null);
              }}
              danger
            >
              Delete
            </KebabItem>
          </div>,
          document.body,
        )}
    </div>
  );
}

function TriggerBadge({ action }: { action: ActionDef }) {
  const text =
    action.role === "primary" ? "Enter" : action.role === "alternative" ? "Shift+Enter" : action.hotkey;
  if (!text) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
  return (
    <kbd className="w-fit rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
      {text}
    </kbd>
  );
}

function KebabItem({
  children,
  onClick,
  active,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
        danger ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"
      }`}
    >
      {children}
      {active && <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
    </button>
  );
}

const headerSelectCls =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

function GroupHeader({
  group,
  open,
  count,
  incomplete,
  onToggle,
  onAdd,
  onDelete,
  onHarness,
  onDangerous,
  onTerminal,
}: {
  group: ActionGroup;
  open: boolean;
  count: number;
  incomplete: number;
  onToggle: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onHarness: (harness: AgentHarness) => void;
  onDangerous: (dangerous: boolean) => void;
  onTerminal: (terminal: TerminalKind | null) => void;
}) {
  const isAgent = group.kind === "agent";
  const meta = AGENT_HARNESSES[(group.harness ?? "claude") as AgentHarness];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-200 bg-zinc-50/80 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        title={open ? "Collapse" : "Expand"}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {group.title}
        <span className="font-normal normal-case text-zinc-400 dark:text-zinc-500">{count}</span>
      </button>
      {incomplete > 0 && (
        <span
          className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
          title={`${incomplete} action(s) without a trigger won't appear`}
        >
          <AlertTriangle className="h-3 w-3" />
          {incomplete}
        </span>
      )}
      {isAgent && (
        <>
          <select
            className={headerSelectCls}
            value={group.harness ?? "claude"}
            onChange={(event) => onHarness(event.target.value as AgentHarness)}
            title="Agent harness"
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
          </select>
          <label
            className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400"
            title={meta.dangerous}
          >
            <input
              type="checkbox"
              checked={group.dangerous !== false}
              onChange={(event) => onDangerous(event.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Dangerous flag
          </label>
          <select
            className={headerSelectCls}
            value={group.terminal ?? ""}
            onChange={(event) => onTerminal(event.target.value ? (event.target.value as TerminalKind) : null)}
            title="Terminal for this group"
          >
            <option value="">Terminal: default</option>
            <option value="wt">Windows Terminal</option>
            <option value="tabby">Tabby</option>
          </select>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-200"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
        {isAgent && (
          <button
            type="button"
            onClick={onDelete}
            title="Delete group"
            className="rounded p-1 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ActionEditor({
  action,
  group,
  groups,
  onChange,
}: {
  action: ActionDef;
  group: ActionGroup | null;
  groups: ActionGroup[];
  onChange: (changes: Partial<ActionDef>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  if (action.kind === "agent") {
    const meta = AGENT_HARNESSES[(group?.harness ?? "claude") as AgentHarness];
    const dangerous = group?.dangerous !== false;
    const preview = [meta.cli, dangerous ? meta.dangerous : "", action.agentFlags ?? ""]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    // The name is harness-derived: the base label is a locked prefix; only an
    // optional suffix is editable. Renaming the harness rewrites the prefix.
    const harnessLabel = meta.label;
    const suffixMatch = action.label.match(/^(.*?)\s*[—-]\s*(.+)$/);
    const suffix = suffixMatch ? suffixMatch[2].trim() : "";
    const setSuffix = (next: string) =>
      onChange({ label: next.trim() ? `${harnessLabel} — ${next.trim()}` : harnessLabel });
    return (
      <div
        ref={ref}
        className="grid grid-cols-2 gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800/60 dark:bg-zinc-800/30"
      >
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Name (follows the harness)</span>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
              {harnessLabel}
            </span>
            <span className="shrink-0 text-zinc-400">—</span>
            <input
              className={inputCls}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
              placeholder="optional suffix (e.g. plan)"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Custom hotkey</span>
          <HotkeyInput value={action.hotkey} onChange={(hotkey) => onChange({ hotkey })} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className={labelCls}>Extra flags</span>
          <input
            className={inputCls}
            value={action.agentFlags ?? ""}
            onChange={(event) => onChange({ agentFlags: event.target.value })}
            placeholder="--resume --model opus"
          />
        </label>
        <div className="col-span-2 flex flex-col gap-1">
          <span className={labelCls}>Runs (in the group's terminal at the repo)</span>
          <code className="block break-all rounded-md bg-zinc-100 px-2.5 py-1.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {preview}
          </code>
        </div>
      </div>
    );
  }

  const plainGroups = groups.filter((candidate) => candidate.kind !== "agent");
  return (
    <div
      ref={ref}
      className="grid grid-cols-2 gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800/60 dark:bg-zinc-800/30"
    >
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Label</span>
        <input
          className={inputCls}
          value={action.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Custom hotkey</span>
        <HotkeyInput value={action.hotkey} onChange={(hotkey) => onChange({ hotkey })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Type</span>
        <select
          className={inputCls}
          value={action.kind}
          onChange={(event) => onChange({ kind: event.target.value as ActionKind })}
        >
          <option value="clipboard">Clipboard (copy a string)</option>
          <option value="paste">Paste (into the active app)</option>
          <option value="exec">Exec (run a program)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Group</span>
        <select
          className={inputCls}
          value={action.group ?? ""}
          onChange={(event) => onChange({ group: event.target.value || null })}
        >
          <option value="">Ungrouped</option>
          {plainGroups.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      </label>
      {hasTemplate(action.kind) ? (
        <label className="col-span-2 flex flex-col gap-1">
          <span className={labelCls}>
            {action.kind === "paste" ? "Pastes (template)" : "Copies (template)"}
          </span>
          <input
            className={inputCls}
            value={action.template ?? ""}
            onChange={(event) => onChange({ template: event.target.value })}
            placeholder="{winpath}"
          />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Program</span>
            <input
              className={inputCls}
              value={action.program ?? ""}
              onChange={(event) => onChange({ program: event.target.value })}
              placeholder="explorer.exe"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Args (one per line)</span>
            <textarea
              className={`${inputCls} h-[68px] resize-y font-mono text-xs`}
              value={(action.args ?? []).join("\n")}
              onChange={(event) =>
                onChange({ args: event.target.value.split("\n").map((line) => line.trimEnd()) })
              }
              placeholder="{winpath}"
            />
          </label>
        </>
      )}
    </div>
  );
}

// ── Reset-to-defaults confirmation ────────────────────────────────────────────

type FieldDiff = { label: string; from: string; to: string };
type ActionDiff =
  | { kind: "added" | "removed"; label: string }
  | { kind: "modified"; label: string; changes: FieldDiff[] };

function describe(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? value.join(" ") : "—";
  return String(value);
}

function fieldDiffs(config: AppConfig, defaults: AppConfig): FieldDiff[] {
  const fields: [string, keyof AppConfig][] = [
    ["Global hotkey", "hotkey"],
    ["Theme", "theme"],
    ["Preferred terminal", "preferred_terminal"],
    ["WSL distro", "wsl_distro"],
    ["Cache path", "cache_path"],
    ["Rebuild command", "rebuild_command"],
    ["Cache TTL", "cache_ttl_seconds"],
    ["Popup reload cache (min)", "reload_throttle_minutes"],
    ["Remember position", "remember_position"],
    ["Launch at startup", "launch_at_startup"],
    ["Window transparency", "transparency"],
    ["Auto-restart on update", "auto_restart_on_update"],
    ["Notify on update", "notify_on_update"],
  ];
  const diffs: FieldDiff[] = [];
  for (const [label, key] of fields) {
    if (JSON.stringify(config[key]) !== JSON.stringify(defaults[key])) {
      diffs.push({ label, from: describe(config[key]), to: describe(defaults[key]) });
    }
  }
  return diffs;
}

function actionDiffs(config: AppConfig, defaults: AppConfig): ActionDiff[] {
  const current = new Map(config.actions.map((action) => [action.id, action]));
  const target = new Map(defaults.actions.map((action) => [action.id, action]));
  const out: ActionDiff[] = [];

  for (const action of config.actions) {
    if (!target.has(action.id)) out.push({ kind: "removed", label: action.label || action.id });
  }
  for (const action of defaults.actions) {
    if (!current.has(action.id)) out.push({ kind: "added", label: action.label || action.id });
  }

  const compared: [string, keyof ActionDef][] = [
    ["label", "label"],
    ["enabled", "enabled"],
    ["hotkey", "hotkey"],
    ["role", "role"],
    ["type", "kind"],
    ["copies", "template"],
    ["program", "program"],
    ["args", "args"],
  ];
  for (const action of config.actions) {
    const other = target.get(action.id);
    if (!other) continue;
    const changes: FieldDiff[] = [];
    for (const [label, key] of compared) {
      if (JSON.stringify(action[key]) !== JSON.stringify(other[key])) {
        changes.push({ label, from: describe(action[key]), to: describe(other[key]) });
      }
    }
    if (changes.length) out.push({ kind: "modified", label: action.label || action.id, changes });
  }
  return out;
}

function FieldDiffRow({ diff }: { diff: FieldDiff }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-zinc-600 dark:text-zinc-300">{diff.label}</span>
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-zinc-400 line-through dark:text-zinc-500">{diff.from}</span>
        <span className="text-zinc-300 dark:text-zinc-600">→</span>
        <span className="text-emerald-600 dark:text-emerald-400">{diff.to}</span>
      </span>
    </div>
  );
}

function ActionDiffRow({ diff }: { diff: ActionDiff }) {
  if (diff.kind !== "modified") {
    const removing = diff.kind === "removed";
    return (
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            removing
              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          }`}
        >
          {removing ? "Remove" : "Add"}
        </span>
        <span className="text-zinc-600 dark:text-zinc-300">{diff.label}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          Modify
        </span>
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{diff.label}</span>
      </div>
      <div className="flex flex-col gap-0.5 pl-1">
        {diff.changes.map((change) => (
          <div key={change.label} className="flex items-center gap-1.5 text-xs">
            <span className="w-16 shrink-0 capitalize text-zinc-400 dark:text-zinc-500">{change.label}</span>
            <span className="truncate text-zinc-400 line-through dark:text-zinc-500">{change.from}</span>
            <span className="text-zinc-300 dark:text-zinc-600">→</span>
            <span className="truncate text-emerald-600 dark:text-emerald-400">{change.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScopeHeader({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mb-1.5 flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-indigo-600"
      />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
      {note && <span className="text-[11px] normal-case text-zinc-400 dark:text-zinc-500">{note}</span>}
    </label>
  );
}

function ResetModal({
  config,
  defaults,
  onConfirm,
  onCancel,
}: {
  config: AppConfig;
  defaults: AppConfig;
  onConfirm: (scope: ResetScope) => void;
  onCancel: () => void;
}) {
  const fields = useMemo(() => fieldDiffs(config, defaults), [config, defaults]);
  const actions = useMemo(() => actionDiffs(config, defaults), [config, defaults]);
  const [scope, setScope] = useState<ResetScope>({ general: true, actions: true });
  const nothingSelected = !scope.general && !scope.actions;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Reset to defaults?</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto px-5 py-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Choose what to reset. Only the checked sections change back to their defaults:
          </p>
          {fields.length > 0 && (
            <section>
              <ScopeHeader
                title="General settings"
                checked={scope.general}
                onChange={(value) => setScope((current) => ({ ...current, general: value }))}
              />
              <div className={`flex flex-col gap-1.5 ${scope.general ? "" : "opacity-40"}`}>
                {fields.map((diff) => (
                  <FieldDiffRow key={diff.label} diff={diff} />
                ))}
              </div>
            </section>
          )}
          {actions.length > 0 && (
            <section>
              <ScopeHeader
                title="Actions"
                note="(includes groups)"
                checked={scope.actions}
                onChange={(value) => setScope((current) => ({ ...current, actions: value }))}
              />
              <div className={`flex flex-col gap-2 ${scope.actions ? "" : "opacity-40"}`}>
                {actions.map((diff, index) => (
                  <ActionDiffRow key={`${diff.kind}-${diff.label}-${index}`} diff={diff} />
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={nothingSelected}
            onClick={() => onConfirm(scope)}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
