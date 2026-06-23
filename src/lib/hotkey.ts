type ParsedHotkey = {
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
};

/** Parse a hotkey string like "Alt+P", "Ctrl+Shift+K", or "Enter". */
export function parseHotkey(hotkey: string): ParsedHotkey | null {
  if (!hotkey) return null;
  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const parsed: ParsedHotkey = {
    alt: false,
    ctrl: false,
    shift: false,
    meta: false,
    key: "",
  };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "alt" || lower === "option") parsed.alt = true;
    else if (lower === "ctrl" || lower === "control") parsed.ctrl = true;
    else if (lower === "shift") parsed.shift = true;
    else if (["super", "win", "meta", "cmd", "command"].includes(lower)) parsed.meta = true;
    else parsed.key = part;
  }
  return parsed.key ? parsed : null;
}

/** Does a keyboard event satisfy the given hotkey string? */
export function matchHotkey(hotkey: string, event: KeyboardEvent): boolean {
  const parsed = parseHotkey(hotkey);
  if (!parsed) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.ctrl !== event.ctrlKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.meta !== event.metaKey) return false;

  const { key } = parsed;
  // Letters/digits match by physical code (layout-independent, survives Alt).
  if (/^[a-z]$/i.test(key)) return event.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}`;
  // Named keys (Enter, Space, Escape, Tab, ...).
  return (
    event.key.toLowerCase() === key.toLowerCase() ||
    event.code.toLowerCase() === key.toLowerCase()
  );
}
