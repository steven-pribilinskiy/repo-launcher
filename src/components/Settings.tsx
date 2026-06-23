import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HotkeyInput } from "@/components/HotkeyInput";
import {
  Check,
  ChevronDown,
  GripVertical,
  MoreVertical,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import { timeAgo } from "@/lib/format";
import type { ActionDef, ActionKind, ActionRole, AppConfig, BuildInfo } from "@/types";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
const labelCls = "text-xs font-medium text-zinc-500 dark:text-zinc-400";
const PLACEHOLDERS = ["{path}", "{wslpath}", "{winpath}", "{name}", "{distro}", "{vscode_uri}"];

type Tab = "general" | "actions" | "updates";

let nextId = 0;
function freshActionId() {
  nextId += 1;
  return `custom-${nextId}`;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [defaults, setDefaults] = useState<AppConfig | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [resetOpen, setResetOpen] = useState(false);
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

  const isDefault = useMemo(
    () => (config && defaults ? JSON.stringify(config) === JSON.stringify(defaults) : true),
    [config, defaults],
  );

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

  const applyDefaults = () => {
    if (!defaults) return;
    dirty.current = true;
    setConfig(defaults);
    applyTheme(defaults.theme);
    api.updateHotkey(defaults.hotkey).catch(() => {});
    setResetOpen(false);
  };

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-5 pt-3 dark:border-zinc-800">
        <div className="flex items-end gap-1">
          {(["general", "actions", "updates"] as Tab[]).map((name) => (
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
          {!isDefault && (
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </button>
          )}
          <button
            type="button"
            onClick={() => getCurrentWindow().hide()}
            className="rounded-md px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "general" && <GeneralTab config={config} distros={distros} patch={patch} />}
        {tab === "updates" && <UpdatesTab config={config} patch={patch} />}
        {tab === "actions" && (
          <ActionsTab actions={config.actions} onChange={(actions) => patch({ actions })} />
        )}
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

function GeneralTab({
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
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-4">
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Global hotkey</span>
        <HotkeyInput value={config.hotkey} onChange={(hotkey) => patch({ hotkey })} />
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
          onChange={(event) => patch({ cache_ttl_seconds: Number(event.target.value) || 0 })}
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
      <Toggle
        className="col-span-2"
        checked={config.remember_position}
        onChange={(value) => patch({ remember_position: value })}
        label="Remember the popup's position between launches"
      />
      <div className="col-span-2">
        <button
          type="button"
          onClick={() => api.resetWindowGeometry()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset size &amp; position
        </button>
      </div>
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
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Toggle
        checked={config.auto_restart_on_update}
        onChange={(value) => patch({ auto_restart_on_update: value })}
        label="Auto-restart when a new version is detected"
      />
      <Toggle
        checked={config.notify_on_update}
        onChange={(value) => patch({ notify_on_update: value })}
        label="Show a system notification after an update"
      />
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

// ── Actions tab (table + drag-and-drop + kebab) ───────────────────────────────

function ActionsTab({
  actions,
  onChange,
}: {
  actions: ActionDef[];
  onChange: (actions: ActionDef[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The kebab menu renders in a portal at fixed viewport coords so it's never
  // clipped by the table's overflow.
  const [kebab, setKebab] = useState<{ index: number; top: number; right: number } | null>(null);

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

  const patchAction = (index: number, changes: Partial<ActionDef>) =>
    onChange(actions.map((action, current) => (current === index ? { ...action, ...changes } : action)));

  const setRole = (index: number, role: ActionRole | null) =>
    onChange(
      actions.map((action, current) => {
        if (current === index) return { ...action, role };
        // A role is unique — clear it from whoever else held it.
        if (role && action.role === role) return { ...action, role: null };
        return action;
      }),
    );

  const removeAction = (index: number) => onChange(actions.filter((_, current) => current !== index));

  const addAction = () =>
    onChange([
      ...actions,
      {
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
      },
    ]);

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...actions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Drag to reorder. Unchecked actions are hidden and their hotkey is ignored.
        </p>
        <button
          type="button"
          onClick={addAction}
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add action
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-[24px_36px_1fr_110px_84px_28px] items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-500">
          <span />
          <span>On</span>
          <span>Action</span>
          <span>Trigger</span>
          <span>Type</span>
          <span />
        </div>
        {actions.map((action, index) => (
          <div key={action.id}>
            <div
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) reorder(dragIndex, index);
                setDragIndex(null);
              }}
              className={`grid grid-cols-[24px_36px_1fr_110px_84px_28px] items-center gap-2 border-b border-zinc-100 px-2 py-1.5 last:border-b-0 dark:border-zinc-800/60 ${
                dragIndex === index ? "opacity-50" : ""
              }`}
            >
              <span className="cursor-grab text-zinc-300 dark:text-zinc-600" title="Drag to reorder">
                <GripVertical className="h-4 w-4" />
              </span>
              <input
                type="checkbox"
                checked={action.enabled}
                onChange={(event) => patchAction(index, { enabled: event.target.checked })}
                className="h-4 w-4 accent-indigo-600"
                title="Enabled"
              />
              <button
                type="button"
                onClick={() => setEditingId(editingId === action.id ? null : action.id)}
                className="flex items-center gap-1.5 truncate text-left text-sm hover:text-indigo-600 dark:hover:text-indigo-400"
                title="Edit details"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
                    editingId === action.id ? "rotate-180" : ""
                  }`}
                />
                <span className="truncate">{action.label || "(unnamed)"}</span>
              </button>
              <TriggerBadge action={action} />
              <span className="text-xs capitalize text-zinc-500 dark:text-zinc-400">{action.kind}</span>
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
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="More"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
            {editingId === action.id && (
              <ActionEditor action={action} onChange={(changes) => patchAction(index, changes)} />
            )}
          </div>
        ))}
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
              Make alternative (Alt+Enter)
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
    action.role === "primary" ? "Enter" : action.role === "alternative" ? "Alt+Enter" : action.hotkey;
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

function ActionEditor({
  action,
  onChange,
}: {
  action: ActionDef;
  onChange: (changes: Partial<ActionDef>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
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
          <option value="exec">Exec (run a program)</option>
        </select>
      </label>
      <div />
      {action.kind === "clipboard" ? (
        <label className="col-span-2 flex flex-col gap-1">
          <span className={labelCls}>Copies (template)</span>
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
    ["WSL distro", "wsl_distro"],
    ["Cache path", "cache_path"],
    ["Rebuild command", "rebuild_command"],
    ["Cache TTL", "cache_ttl_seconds"],
    ["Remember position", "remember_position"],
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

function ResetModal({
  config,
  defaults,
  onConfirm,
  onCancel,
}: {
  config: AppConfig;
  defaults: AppConfig;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fields = useMemo(() => fieldDiffs(config, defaults), [config, defaults]);
  const actions = useMemo(() => actionDiffs(config, defaults), [config, defaults]);
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
            These will change back to their defaults:
          </p>
          {fields.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Settings
              </h3>
              <div className="flex flex-col gap-1.5">
                {fields.map((diff) => (
                  <FieldDiffRow key={diff.label} diff={diff} />
                ))}
              </div>
            </section>
          )}
          {actions.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Actions
              </h3>
              <div className="flex flex-col gap-2">
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
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
