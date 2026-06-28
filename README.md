# repo-launcher

A global-hotkey desktop popup that fuzzy-finds your repos/folders and runs a
configurable action on the selection — copy the path, open a terminal there, open
a file manager, launch an editor, or any custom command you define.

It reuses the [`goto-repo`](../shell-finders) (shell-finders) infrastructure: it reads
the same repo cache and shares the same sort mode and usage history, so the GUI and
the `fr`/`g` shell finder stay in sync. Built with Tauri 2 + React 18 + Rust;
Windows + WSL is the primary target, but the platform seams keep it runnable on
Linux/macOS.

## How it works

- **Repos come from the goto-repo cache** (`~/.cache/goto-repo/repos.tsv`), not a
  fresh scan. On Windows the cache is read from the WSL distro over
  `\\wsl.localhost\<distro>\…`; on Linux/macOS from the native `~/.cache/goto-repo`.
- **Ranking is shared.** The popup honors the shared sort mode
  (`~/.cache/goto-repo/sort`: alpha / recent / most-used) and updates the shared
  usage history (`~/.config/goto-repo/history`) on every action — so frecency is
  the same in the popup and in `fr`/`g`. Press **Ctrl+S** in the popup to cycle sort.
- **Refresh** is delegated to goto-repo (`find-repo --rebuild`): a background
  rebuild runs when the cache is older than the TTL, and the tray "Refresh Repos"
  forces one.

## Actions

Every action is configurable in Settings. Each has an enabled toggle and a hotkey;
disabled actions are hidden from the popup and their hotkey is ignored. Command
strings support placeholders, substituted for the selected folder:

| Placeholder | Meaning |
|---|---|
| `{path}` / `{wslpath}` | POSIX path, e.g. `/home/me/projects/foo` |
| `{winpath}` | OS-native path — `\\wsl.localhost\<distro>\…` on Windows, identical to `{path}` elsewhere |
| `{name}` | folder basename, e.g. `foo` |
| `{distro}` | WSL distro name |
| `{vscode_uri}` | `vscode-remote://wsl+<distro><path>` |

Built-in defaults (Windows), all editable/removable:

| Action | Hotkey | Default |
|---|---|---|
| Copy absolute path | **Enter** (primary) | clipboard `{winpath}` |
| Copy WSL path | Alt+P | clipboard `{wslpath}` |
| Copy folder name | Alt+N | clipboard `{name}` |
| Open in Tabby | Alt+B | `Tabby.exe open {winpath}` |
| Open in Windows Terminal | Alt+T | `wt.exe -p {distro} -d {winpath}` |
| Open in explorer.exe | Alt+E | `explorer.exe {winpath}` |
| Open WSL shell here | Alt+S | `cmd /c start "" wsl.exe -d {distro} --cd {wslpath}` |
| Open in VS Code | Alt+V | *(disabled by default)* `code --folder-uri {vscode_uri}` |
| Open in Cursor | Alt+R | *(disabled by default)* `cursor --folder-uri {vscode_uri}` |
| Open in Zed | Alt+Z | *(disabled by default)* |

The primary action (the one bound to **Enter**) fires when you press Enter on a
selection. Clicking an action in the bottom bar runs it on the highlighted folder.

Add your own with **Add action** in Settings: pick Clipboard (copies a template) or
Exec (runs a program with args, one per line), set a hotkey, done.

### Custom command notes

- Exec actions are `program` + `args` (an args array, not a shell line), so there's
  no shell quoting to get wrong. To run a shell one-liner, use `cmd` / `bash` as the
  program (e.g. program `cmd`, args `/c`, `git -C {wslpath} pull`).
- **Tabby** isn't always on `PATH`. If the Tabby button does nothing, set its full
  path (e.g. `C:\Users\<you>\AppData\Local\Programs\Tabby\Tabby.exe`) in
  Settings → Actions → Open in Tabby → Program.

## Updates

The app watches its own executable on disk. When a new build is installed in place,
it **auto-restarts into it** (toggle: *Auto-restart when a new version is detected*,
on by default). After a version change, the relaunched instance shows a **native OS
notification** that it updated (toggle: *Show a system notification after an update*,
on by default).

On Windows the running `.exe` is locked and can't be replaced in place, so updates
arrive via the installer — which closes and relaunches the app; the "updated"
notification still fires on that relaunch. The in-place auto-restart watcher applies
on Linux/macOS.

## Settings

Open from the tray menu (**Settings**) or the gear in the popup. Configure: the
global hotkey (re-registered live; default **Alt + Backtick** — the key above Tab), theme
(System / Light / Dark), the WSL distro that hosts the cache, an optional cache-path
override, the rebuild command, the cache TTL, **launch at startup** (registers a login
item so the launcher starts automatically when you log in), the update behavior
(auto-restart + notification toggles), and the full action registry
(enable/reorder/edit/add/remove).

Settings persist to the app config dir (`%APPDATA%\com.stevenp.repo-launcher\config.json`
on Windows). The repo list, sort mode, and history are shared with goto-repo.

## Develop

```sh
npm install
npm run tauri dev      # run the app
npm run build          # typecheck + build the frontend
cd src-tauri && cargo test --lib   # unit tests (cache parsing + ranking)
```

## Build

```sh
npm run tauri build    # produces an NSIS installer + MSI on Windows
```
