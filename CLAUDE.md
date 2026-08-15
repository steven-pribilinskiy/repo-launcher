# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

repo-launcher is a **Tauri 2 desktop app**: a Rust tray + global-hotkey shell (`src-tauri/`) hosting a
React 18 + TypeScript + Vite 6 + Tailwind v4 webview (`src/`). It's a Spotlight-style popup that
fuzzy-finds folders and runs a configurable action on the selection. Primary target is **Windows + WSL**;
`#[cfg(target_os = …)]` seams keep it runnable on Linux/macOS.

It does **not** own its folder list — the data source is the external **goto-repo / shell-finders**
cache. This app reads that cache and writes back shared state (see Architecture).

## Commands

`make <task>` (Linux/WSL/macOS) and `mise run <task>` (cross-platform, incl. Windows) both wrap the
same npm/cargo commands. Bare `make` lists every task.

- `make dev` / `mise run dev` / `npm run tauri dev` — run the app (compiles the Rust backend; first build is slow).
- `make build` / `npm run build` — `tsc` typecheck + `vite build` (frontend only).
- `make bundle` / `npm run tauri build` — native app + installers → `src-tauri/target/release/bundle/`.
- `make test` — Rust unit tests (`cd src-tauri && cargo test --lib`). Single test: `cd src-tauri && cargo test --lib rank_alpha_sorts_by_path`.
- `make doctor` — check prerequisites; `make setup` — auto-install them (system libs via apt, Rust via rustup, npm deps).

There is **no frontend test suite or linter** configured — the only tests are the Rust `#[cfg(test)]`
modules (cache parsing + ranking in `src-tauri/src/commands/cache.rs`). Windows installers **cannot** be
cross-built from WSL; run `mise run bundle` natively on Windows (needs MSVC C++ Build Tools + WebView2).

## Architecture

**One bundle, two windows.** `src/App.tsx` routes on `getCurrentWindow().label`: `"settings"` →
`<Settings/>`, else `<Popup/>`. Both the frameless always-on-top popup and the decorated settings window
(declared in `src-tauri/tauri.conf.json`) load the same JS bundle.

**Rust backend.** `src-tauri/src/main.rs` owns the tray menu, the global hotkey (re-registerable live via
`update_hotkey`), the window show/hide lifecycle, and the `generate_handler!` IPC registration. Logic
lives in `src-tauri/src/commands/`: `cache.rs` (read + rank the goto-repo cache), `repos.rs` (`Repo`
type, action runner, path conversion), `config.rs` (`AppConfig` + the action registry), `update.rs`
(self-update watcher), `window_state.rs` + `window_drag.rs` (frameless popup geometry / auto-hide).

**The goto-repo cache is the data model (SSOT).** `cache.rs` reads three files from the goto-repo dirs:
`repos.tsv` (folder list, `<type>\t<path>`), `sort` (shared sort mode), `history` (usage log). Ranking
(`rank_by`) mirrors goto-repo's `rank-repos.sh`: `0`=alpha, `1`=recent, `2`=most-used, `3`=type. **Sort
changes and every action write back to the shared `sort`/`history` files**, so frecency stays in sync
with the `fr`/`g` shell finders. Never fork this state into a private store.

**Platform seams** are `#[cfg(target_os = "windows")]` islands, concentrated in `cache.rs` and `repos.rs`.
On Windows the cache lives in WSL and is read over `\\wsl.localhost\<distro>\…` UNC paths; the distro is
resolved from the WSL registry (`Lxss`), never `wsl --list` (which cold-starts the VM — the dominant
startup cost). Distro + `$HOME` are primed once and cached in config. Linux/macOS use native
`~/.cache/goto-repo` + `~/.config/goto-repo`. **Startup latency is a first-class constraint** — don't add
`wsl.exe` spawns on the launch hot path, and keep `creation_flags(0x0800_0000)` (`CREATE_NO_WINDOW`) on
every Windows `Command`.

**Config.** `AppConfig` (config.rs) persists to `app_data_dir()/config.json`
(`%APPDATA%\com.stevenp.repo-launcher\config.json` on Windows). Its `actions`/`groups` registry drives
the popup's action bar. An `ActionDef` has one of four `ActionKind`s: `Clipboard` (returns text the
frontend copies), `Paste` (delivers text into the previously-focused window — see below), `Exec`
(spawns program + args), `Agent` (launches an agent CLI in a terminal at the repo). Command strings use `{path}`/`{wslpath}`, `{winpath}`, `{name}`, `{distro}`, `{vscode_uri}`
placeholders — substituted by `substitute()` in `repos.rs`.

**The paste seam.** `commands/paste.rs` delivers a string into the window that had focus *before* the
popup opened, so `remember_foreground()` must be called BEFORE every `window.show()` — after it, the
foreground is the popup itself and the paste targets us. It is a three-rung ladder: synthesized Unicode
keystrokes (clipboard untouched) → clipboard + Ctrl+V → leave it on the clipboard and log. A rung is
only taken when the one above it was *refused*, detected by `SendInput` accepting fewer events than it
was handed (error 5 = UIPI, an elevated target). Two non-obvious constraints, both of which cost real
time elsewhere: `SendInput` batches are chunked (`CHUNK_UNITS`) because one oversized batch arrives
scrambled, and it rejects an empty buffer outright. Windows-only; other platforms degrade to a copy.

**Frontend data flow.** `src/lib/api.ts` is the entire IPC surface — typed `invoke()` wrappers, one per
Rust command. `src/stores/repoStore.ts` (zustand) is the only state store. Ranking happens in Rust:
`readRepos` / `cycleSort` / `setSort` each return the full re-ranked list.

## Invariants & gotchas

- **Adding an IPC command touches four places:** `#[tauri::command]` fn in a `commands/*` module →
  register it in the `generate_handler!` array in `main.rs` → typed wrapper in `src/lib/api.ts` → types
  in `src/types/index.ts`.
- **`agent_cli()` in `repos.rs` mirrors `AGENT_HARNESSES` in `src/types/index.ts`** (`src/types/index.ts:51`) —
  the CLI binary + dangerous-permissions flag per harness must stay in sync across both.
- **Version lives in three files** — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
  Bump all together (patch for fixes, minor for features).
- **A version bump is NOT a release, and pushing `main` does not ship anything.** The bump only changes
  what the app reports about itself. `.github/workflows/build-windows.yml` publishes a GitHub Release
  **only on a `v*` tag push** (`if: startsWith(github.ref, 'refs/tags/')`); a push to `main` runs the
  same build but leaves the installer as a run *artifact* and skips the release step. `update.rs` asks
  `releases/latest`, so until the tag exists every installed copy correctly reports the previous version
  as newest and offers no update — the work is on `main` and on nobody's machine. Finish a bump with:

  ```bash
  git tag v0.13.0 && git push origin v0.13.0   # the tag is what cuts the release
  ```

  Say "pushed to main" or "released", never "shipped", until that tag exists.
- **Enter/Shift+Enter are ROLE-based, not hotkey-based** — they run whichever enabled action carries
  `role: "primary"` / `"alternative"`, resolved in both `useKeyboardNav.ts` and `ActionBar.tsx`. Change
  one and you must change the other, or the bar advertises a chord that runs something else. One known
  divergence: the bar's `primary` additionally falls back to the first enabled action, which the Enter
  handler does not — so a config with no primary role shows ⏎ against an action Enter won't run.
- **A `#[cfg(target_os = "windows")]` block is INVISIBLE to `make build`/`make test` on WSL** — both
  gates pass while the Windows path is broken, and CI only finds it on the native build. Cross-check it
  with `cargo check --target x86_64-pc-windows-gnu` (the target is installed; the whole crate compiles
  under it), and confirm the check actually covers your block by sabotaging it once.
- **New built-in actions need a `BUILTIN_ACTIONS_REV` bump** (config.rs), or they only ever reach fresh
  installs — an existing `config.json` is never re-seeded from `default_actions()`. The backfill appends
  by id and only adds, so it can't clobber an edited or re-ordered action, and it runs exactly once.
- **Sort mode is a `u8` cycled `% 4`** (0 alpha / 1 recent / 2 most-used / 3 type). Both the Ctrl+S cycle
  and table-header clicks write the shared `sort` file (`cycle_sort` / `set_sort`) so they never diverge.
- **The popup is never closed, only hidden** — `CloseRequested` calls `prevent_close()`; the app exits
  only via the tray Quit. Auto-hide on blur is gated deterministically by an interaction flag
  (`window_drag::is_interacting()`), not a timer. Env flags `REPO_LAUNCHER_NO_AUTOHIDE` /
  `REPO_LAUNCHER_SHOW_ON_START` help on setups without a working tray/hotkey.
- Full-word identifiers only (no single-letter locals) — match the existing style (`left`/`right`,
  `error`, `err` in `map_err`). Never commit `console.*` debug instrumentation.
- Solo-owned personal repo: commit straight to `main`, no PR. Run `make build` + `make test` before pushing.
