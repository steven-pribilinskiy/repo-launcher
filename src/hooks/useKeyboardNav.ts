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
};

export function useKeyboardNav({ results, onActionComplete }: UseKeyboardNavOptions) {
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

      for (const action of config?.actions ?? []) {
        if (!action.enabled) continue;
        if (matchHotkey(action.hotkey, event)) {
          event.preventDefault();
          void runAction(action);
          return;
        }
      }
    },
    [results.length, config, cycleSort, hideWindow, onActionComplete, runAction],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedIndex, setSelectedIndex, runAction };
}
