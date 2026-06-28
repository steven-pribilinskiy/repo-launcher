import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api } from "@/lib/api";
import { matchHotkey } from "@/lib/hotkey";
import { useRepoStore } from "@/stores/repoStore";
import type { ActionDef, FuzzyResult } from "@/types";

type UseKeyboardNavOptions = {
  results: FuzzyResult[];
  onActionComplete: () => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
};

export function useKeyboardNav({
  results,
  onActionComplete,
  paletteOpen,
  onTogglePalette,
}: UseKeyboardNavOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const config = useRepoStore((state) => state.config);
  const cycleSort = useRepoStore((state) => state.cycleSort);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const hideWindow = useCallback(async () => {
    await getCurrentWindow().hide();
  }, []);

  const runAction = useCallback(
    async (action: ActionDef) => {
      const selected = results[selectedIndex]?.repo;
      if (!selected) return;
      try {
        const text = await api.runAction(action, selected);
        if (typeof text === "string") await writeText(text);
      } catch (error) {
        console.error(`Action ${action.id} failed:`, error);
      }
      await hideWindow();
      onActionComplete();
    },
    [results, selectedIndex, hideWindow, onActionComplete],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ctrl+K toggles the Raycast-style actions palette.
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "KeyK") {
        event.preventDefault();
        onTogglePalette();
        return;
      }
      // While the palette is open it owns the keyboard (its own handler runs).
      if (paletteOpen) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideWindow();
        onActionComplete();
        return;
      }
      // Ctrl+S cycles the shared sort mode (matches goto-repo's picker).
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "KeyS") {
        event.preventDefault();
        void cycleSort();
        return;
      }
      // Ctrl+, / Ctrl+. / Ctrl+Alt+S open Settings.
      const opensSettings =
        (event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key === "," || event.key === ".")) ||
        (event.ctrlKey && event.altKey && !event.metaKey && event.code === "KeyS");
      if (opensSettings) {
        event.preventDefault();
        void api.openSettings();
        return;
      }

      const enabled = (config?.actions ?? []).filter((action) => action.enabled);

      // Enter → primary, Alt+Enter → alternative (role-based, independent of each
      // action's own hotkey). Falls back to a literal Enter/Alt+Enter hotkey for
      // configs predating roles.
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const wantsAlt = event.altKey;
        const role = wantsAlt ? "alternative" : "primary";
        const literal = wantsAlt ? "Alt+Enter" : "Enter";
        const action =
          enabled.find((item) => item.role === role) ??
          enabled.find((item) => item.hotkey === literal);
        if (action) {
          event.preventDefault();
          void runAction(action);
          return;
        }
      }

      for (const action of enabled) {
        if (matchHotkey(action.hotkey, event)) {
          event.preventDefault();
          void runAction(action);
          return;
        }
      }
    },
    [results.length, config, cycleSort, hideWindow, onActionComplete, runAction, paletteOpen, onTogglePalette],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedIndex, setSelectedIndex, runAction };
}
