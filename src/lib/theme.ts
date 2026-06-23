export type Theme = "system" | "light" | "dark";

let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

/** Apply a theme to the document: "system" follows prefers-color-scheme (and keeps
 * following it live); "light"/"dark" force the choice. */
export function applyTheme(theme: string) {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const setDark = (dark: boolean) => {
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  };

  if (mediaListener) {
    media.removeEventListener("change", mediaListener);
    mediaListener = null;
  }

  if (theme === "light" || theme === "dark") {
    setDark(theme === "dark");
    return;
  }

  setDark(media.matches);
  mediaListener = (event) => setDark(event.matches);
  media.addEventListener("change", mediaListener);
}
