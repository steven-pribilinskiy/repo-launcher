import { useState } from "react";
import { X } from "lucide-react";

// event.code → key name in the format consumed by lib/hotkey.ts and Rust parse_hotkey.
const NAMED: Record<string, string> = {
  Enter: "Enter",
  Space: "Space",
  Escape: "Escape",
  Tab: "Tab",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta", "OS"];

function chordFromEvent(event: React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(event.key)) return null; // wait for a non-modifier key
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  let main: string;
  if (/^Key[A-Z]$/.test(event.code)) main = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) main = event.code.slice(5);
  else main = NAMED[event.code] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);

  parts.push(main);
  return parts.join("+");
}

type HotkeyInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/** A key-capture control: focus it and press a chord (e.g. Alt+P) to record it. */
export function HotkeyInput({ value, onChange, placeholder = "Click, then press keys…" }: HotkeyInputProps) {
  const [recording, setRecording] = useState(false);

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (event.key === "Tab") return; // let focus move away
          event.preventDefault();
          if (event.key === "Escape") {
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            onChange("");
            return;
          }
          const chord = chordFromEvent(event);
          if (chord) onChange(chord);
        }}
        className={`flex h-[34px] w-full items-center rounded-md border bg-white px-2.5 text-left text-sm outline-none dark:bg-zinc-800 ${
          recording
            ? "border-indigo-500 ring-1 ring-indigo-500"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        {recording ? (
          <span className="text-zinc-400 dark:text-zinc-500">Press keys…</span>
        ) : value ? (
          <kbd className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {value}
          </kbd>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">{placeholder}</span>
        )}
      </button>
      {value && !recording && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear"
          aria-label="Clear hotkey"
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
