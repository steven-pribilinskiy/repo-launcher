import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import type { ActionDef, ActionKind, AppConfig } from "@/types";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
const labelCls = "text-xs font-medium text-zinc-500 dark:text-zinc-400";
const PLACEHOLDERS = ["{path}", "{wslpath}", "{winpath}", "{name}", "{distro}", "{vscode_uri}"];

let nextId = 0;
function freshActionId() {
  nextId += 1;
  return `custom-${nextId}`;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((loaded) => {
      setConfig(loaded);
      applyTheme(loaded.theme);
    });
    api.listDistros().then(setDistros).catch(() => {});
  }, []);

  const rebuildText = useMemo(
    () => (config?.rebuild_command ?? []).join(" "),
    [config?.rebuild_command],
  );

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-sm text-zinc-500 dark:bg-zinc-900">
        Loading…
      </div>
    );
  }

  const patch = (changes: Partial<AppConfig>) => setConfig({ ...config, ...changes });

  const patchAction = (index: number, changes: Partial<ActionDef>) => {
    const actions = config.actions.map((action, current) =>
      current === index ? { ...action, ...changes } : action,
    );
    patch({ actions });
  };

  const moveAction = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= config.actions.length) return;
    const actions = [...config.actions];
    [actions[index], actions[target]] = [actions[target], actions[index]];
    patch({ actions });
  };

  const removeAction = (index: number) => {
    patch({ actions: config.actions.filter((_, current) => current !== index) });
  };

  const addAction = () => {
    const action: ActionDef = {
      id: freshActionId(),
      label: "New action",
      hotkey: "",
      enabled: true,
      kind: "exec",
      program: "",
      args: [],
      template: null,
      platforms: null,
    };
    patch({ actions: [...config.actions, action] });
  };

  const save = async () => {
    setStatus("Saving…");
    // Drop only trailing blank arg lines (a middle "" can be intentional, e.g.
    // the empty window-title arg in `cmd /c start "" wsl.exe …`).
    const cleaned: AppConfig = {
      ...config,
      actions: config.actions.map((action) => {
        if (action.kind !== "exec" || !action.args) return action;
        const args = [...action.args];
        while (args.length && args[args.length - 1] === "") args.pop();
        return { ...action, args };
      }),
    };
    try {
      await api.saveConfig(cleaned);
      await api.updateHotkey(cleaned.hotkey);
      applyTheme(cleaned.theme);
      setConfig(cleaned);
      setStatus("Saved");
    } catch (error) {
      setStatus(`Error: ${error}`);
    }
  };

  const reset = async () => {
    const defaults = await api.resetConfig();
    setConfig(defaults);
    applyTheme(defaults.theme);
    setStatus("Reset to defaults");
  };

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-base font-semibold">Repo Launcher Settings</h1>
        <div className="flex items-center gap-3">
          {status && <span className="text-xs text-zinc-500 dark:text-zinc-400">{status}</span>}
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => getCurrentWindow().hide()}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">General</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Global hotkey</span>
              <input
                className={inputCls}
                value={config.hotkey}
                onChange={(event) => patch({ hotkey: event.target.value })}
                placeholder="Alt+`"
              />
            </label>
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
              <span className={labelCls}>WSL distro (cache host)</span>
              <input
                className={inputCls}
                list="distros"
                value={config.wsl_distro ?? ""}
                onChange={(event) => patch({ wsl_distro: event.target.value || null })}
                placeholder="auto-detect"
              />
              <datalist id="distros">
                {distros.map((distro) => (
                  <option key={distro} value={distro} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Cache TTL (seconds)</span>
              <input
                type="number"
                className={inputCls}
                value={config.cache_ttl_seconds}
                onChange={(event) =>
                  patch({ cache_ttl_seconds: Number(event.target.value) || 0 })
                }
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className={labelCls}>Cache path override (goto-repo cache dir)</span>
              <input
                className={inputCls}
                value={config.cache_path ?? ""}
                onChange={(event) => patch({ cache_path: event.target.value || null })}
                placeholder="auto (resolved from WSL distro)"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
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
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.auto_restart_on_update}
                onChange={(event) => patch({ auto_restart_on_update: event.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              <span className="text-sm">Auto-restart when a new version is detected</span>
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.notify_on_update}
                onChange={(event) => patch({ notify_on_update: event.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              <span className="text-sm">Show a system notification after an update</span>
            </label>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Actions</h2>
            <button
              type="button"
              onClick={addAction}
              className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add action
            </button>
          </div>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Unchecked actions are hidden from the popup and their hotkey is ignored. The action with
            hotkey <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Enter</code> is the
            primary action. Placeholders: {PLACEHOLDERS.join(" ")}
          </p>

          <div className="flex flex-col gap-2">
            {config.actions.map((action, index) => (
              <ActionRow
                key={action.id}
                action={action}
                isFirst={index === 0}
                isLast={index === config.actions.length - 1}
                onChange={(changes) => patchAction(index, changes)}
                onMoveUp={() => moveAction(index, -1)}
                onMoveDown={() => moveAction(index, 1)}
                onRemove={() => removeAction(index)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type ActionRowProps = {
  action: ActionDef;
  isFirst: boolean;
  isLast: boolean;
  onChange: (changes: Partial<ActionDef>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

function ActionRow({ action, isFirst, isLast, onChange, onMoveUp, onMoveDown, onRemove }: ActionRowProps) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={action.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          className="h-4 w-4 accent-indigo-600"
          title="Enabled"
        />
        <input
          className={`${inputCls} flex-1`}
          value={action.label}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Label"
        />
        <input
          className={`${inputCls} w-28`}
          value={action.hotkey}
          onChange={(event) => onChange({ hotkey: event.target.value })}
          placeholder="Hotkey"
        />
        <select
          className={`${inputCls} w-32`}
          value={action.kind}
          onChange={(event) => onChange({ kind: event.target.value as ActionKind })}
        >
          <option value="clipboard">Clipboard</option>
          <option value="exec">Exec</option>
        </select>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton onClick={onMoveUp} disabled={isFirst} title="Move up">
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={onMoveDown} disabled={isLast} title="Move down">
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton onClick={onRemove} title="Remove">
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="mt-2 pl-7">
        {action.kind === "clipboard" ? (
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Copies (template)</span>
            <input
              className={inputCls}
              value={action.template ?? ""}
              onChange={(event) => onChange({ template: event.target.value })}
              placeholder="{winpath}"
            />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-3">
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
                  onChange({
                    args: event.target.value.split("\n").map((line) => line.trimEnd()),
                  })
                }
                placeholder={"{winpath}"}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {children}
    </button>
  );
}
