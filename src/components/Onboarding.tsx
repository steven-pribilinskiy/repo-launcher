import { useState } from "react";
import { FolderGit2, Keyboard, MousePointerClick, Search } from "lucide-react";
import { api } from "@/lib/api";
import { HotkeyInput } from "@/components/HotkeyInput";
import type { AppConfig } from "@/types";

/** First-launch welcome: suggests the global hotkey and lets the user accept or
 * change it, then marks onboarding complete. */
export function Onboarding({ config, onDone }: { config: AppConfig; onDone: () => void }) {
  const [hotkey, setHotkey] = useState(config.hotkey || "Alt+`");
  const [saving, setSaving] = useState(false);

  const start = async () => {
    setSaving(true);
    try {
      await api.saveConfig({ ...config, hotkey, onboarded: true });
      await api.updateHotkey(hotkey).catch(() => {});
    } finally {
      onDone();
    }
  };

  return (
    <div className="popup-surface relative flex h-full flex-col justify-center gap-5 bg-white/95 px-8 py-6 backdrop-blur-xl dark:bg-zinc-900/95">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <FolderGit2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Repo Launcher</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Jump to any repo from anywhere.</p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          <Keyboard className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          Your shortcut to open it
        </div>
        <HotkeyInput value={hotkey} onChange={setHotkey} />
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          We suggest <kbd className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] dark:bg-zinc-700">Alt+`</kbd>.
          Press it anytime — even over other apps. Click the field above to change it.
        </p>
      </div>

      <ul className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <li className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" /> Type to fuzzy-find any repo
        </li>
        <li className="flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 shrink-0 text-zinc-400" /> Enter copies the path; other
          keys open it in Tabby, Terminal, Explorer…
        </li>
        <li className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 shrink-0 text-zinc-400" /> It lives in your tray — right-click for
          Settings
        </li>
      </ul>

      <button
        type="button"
        onClick={start}
        disabled={saving}
        className="self-start rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        Get started
      </button>
    </div>
  );
}
