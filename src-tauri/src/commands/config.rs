use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

/// What a folder action does when triggered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    /// Copy a substituted string to the clipboard.
    Clipboard,
    /// Spawn a program with substituted args.
    Exec,
    /// Launch an agent CLI (resolved from its group's harness) in a terminal.
    Agent,
}

/// A single folder action. The action whose `hotkey` is "Enter" is the primary
/// (default) action. Disabled actions are hidden from the popup and their hotkey
/// is ignored. `template`/`program`/`args` support placeholders substituted at run
/// time: {path}/{wslpath}, {winpath}, {name}, {distro}, {vscode_uri}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub hotkey: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub kind: ActionKind,
    /// "primary" (Enter) or "alternative" (Alt+Enter); independent of `hotkey`.
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    /// Restrict to these OSes ("windows"/"linux"/"macos"). None = all.
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
    /// Group id this action belongs to; None = ungrouped.
    #[serde(default)]
    pub group: Option<String>,
    /// Agent actions: extra flags appended after `{cli} {dangerousFlag}`.
    #[serde(default, rename = "agentFlags")]
    pub agent_flags: Option<String>,
}

/// A header-bearing group of actions. Agent groups carry harness settings that
/// drive how their `Agent`-kind actions are launched.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionGroup {
    pub id: String,
    pub title: String,
    /// "plain" | "agent".
    pub kind: String,
    /// Agent groups: "claude" | "codex" | "gemini".
    #[serde(default)]
    pub harness: Option<String>,
    /// Agent groups: append the harness's dangerous-permissions flag.
    #[serde(default)]
    pub dangerous: Option<bool>,
    /// Agent groups: "wt" | "tabby"; None = use `preferred_terminal`.
    #[serde(default)]
    pub terminal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Global hotkey that summons the popup.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// How stale (seconds) the cache may be before a background rebuild is kicked.
    #[serde(default = "default_ttl")]
    pub cache_ttl_seconds: u64,
    /// Which WSL distro hosts the goto-repo cache (Windows only). None = autodetect.
    #[serde(default)]
    pub wsl_distro: Option<String>,
    /// Cached WSL $HOME for the resolved distro — avoids a slow wsl.exe spawn on
    /// every launch (the VM cold-starts otherwise). Primed once on first launch.
    #[serde(default)]
    pub wsl_home: Option<String>,
    /// Override the full path to the goto-repo cache dir (containing repos.tsv).
    #[serde(default)]
    pub cache_path: Option<String>,
    /// Override the command used to rebuild the cache (program + args).
    #[serde(default)]
    pub rebuild_command: Option<Vec<String>>,
    /// "system" | "light" | "dark".
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Restart automatically when a new version is detected on disk.
    #[serde(default = "default_true")]
    pub auto_restart_on_update: bool,
    /// Show a native OS notification after an update.
    #[serde(default = "default_true")]
    pub notify_on_update: bool,
    /// Remember the popup's last position across launches (size is always kept).
    #[serde(default = "default_true")]
    pub remember_position: bool,
    /// Launch the app automatically when the user logs in. Defaults on.
    #[serde(default = "default_true")]
    pub launch_at_startup: bool,
    /// Popup background see-through, 0–100 (0 = opaque). Defaults opaque.
    #[serde(default)]
    pub transparency: u8,
    /// Whether the first-launch onboarding has been completed.
    #[serde(default)]
    pub onboarded: bool,
    /// One-shot guard: the desktop shortcut has been offered/created once, so it's
    /// never auto-recreated on later launches (the app, not the installer, owns it).
    #[serde(default)]
    pub desktop_shortcut_initialized: bool,
    /// The configurable action registry.
    #[serde(default = "default_actions")]
    pub actions: Vec<ActionDef>,
    /// Action groups (headers + agent-harness settings).
    #[serde(default = "default_groups")]
    pub groups: Vec<ActionGroup>,
    /// Default terminal for agent-harness launches ("wt" | "tabby").
    #[serde(default = "default_terminal")]
    pub preferred_terminal: String,
}

fn default_true() -> bool {
    true
}
fn default_hotkey() -> String {
    "Alt+`".to_string()
}
fn default_ttl() -> u64 {
    300
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_terminal() -> String {
    "wt".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            cache_ttl_seconds: default_ttl(),
            wsl_distro: None,
            wsl_home: None,
            cache_path: None,
            rebuild_command: None,
            theme: default_theme(),
            auto_restart_on_update: true,
            notify_on_update: true,
            remember_position: true,
            launch_at_startup: true,
            transparency: 0,
            onboarded: false,
            desktop_shortcut_initialized: false,
            actions: default_actions(),
            groups: default_groups(),
            preferred_terminal: default_terminal(),
        }
    }
}

// Group ids shared between default_groups() and default_actions().
const GRP_COPY: &str = "grp-copy";
const GRP_TERMINALS: &str = "grp-terminals";
const GRP_EDITORS: &str = "grp-editors";
const GRP_AGENT_CLAUDE: &str = "grp-agent-claude";

fn clipboard(id: &str, label: &str, hotkey: &str, enabled: bool, group: &str, template: &str) -> ActionDef {
    ActionDef {
        id: id.to_string(),
        label: label.to_string(),
        hotkey: hotkey.to_string(),
        enabled,
        kind: ActionKind::Clipboard,
        role: None,
        template: Some(template.to_string()),
        program: None,
        args: None,
        platforms: None,
        group: Some(group.to_string()),
        agent_flags: None,
    }
}

fn exec(id: &str, label: &str, hotkey: &str, enabled: bool, group: &str, program: &str, args: &[&str]) -> ActionDef {
    ActionDef {
        id: id.to_string(),
        label: label.to_string(),
        hotkey: hotkey.to_string(),
        enabled,
        kind: ActionKind::Exec,
        role: None,
        template: None,
        program: Some(program.to_string()),
        args: Some(args.iter().map(|arg| arg.to_string()).collect()),
        platforms: None,
        group: Some(group.to_string()),
        agent_flags: None,
    }
}

fn agent(id: &str, label: &str, hotkey: &str, enabled: bool, group: &str, flags: &str) -> ActionDef {
    ActionDef {
        id: id.to_string(),
        label: label.to_string(),
        hotkey: hotkey.to_string(),
        enabled,
        kind: ActionKind::Agent,
        role: None,
        template: None,
        program: None,
        args: None,
        platforms: None,
        group: Some(group.to_string()),
        agent_flags: Some(flags.to_string()),
    }
}

/// Built-in default action groups. Ids are shared with `default_actions()`.
pub fn default_groups() -> Vec<ActionGroup> {
    vec![
        ActionGroup { id: GRP_COPY.into(), title: "Copy".into(), kind: "plain".into(), harness: None, dangerous: None, terminal: None },
        ActionGroup { id: GRP_TERMINALS.into(), title: "Terminals".into(), kind: "plain".into(), harness: None, dangerous: None, terminal: None },
        ActionGroup { id: GRP_EDITORS.into(), title: "Editors".into(), kind: "plain".into(), harness: None, dangerous: None, terminal: None },
        ActionGroup {
            id: GRP_AGENT_CLAUDE.into(),
            title: "Agent harness: Claude Code".into(),
            kind: "agent".into(),
            harness: Some("claude".into()),
            dangerous: Some(true),
            terminal: None,
        },
    ]
}

/// Built-in default actions, per OS. All editable/removable in settings.
/// Enabled-by-default: the copy actions + the Windows openers + the agent
/// launchers. The editors (VS Code / Cursor / Zed) ship present-but-disabled.
pub fn default_actions() -> Vec<ActionDef> {
    // Primary (Enter) copies the POSIX path (/home/...) — what's pasted most in a
    // WSL workflow. The Windows UNC path is a separate Alt+P action on Windows.
    let mut actions = vec![clipboard("copy-path", "Copy path", "", true, GRP_COPY, "{wslpath}")];
    actions[0].role = Some("primary".to_string());

    #[cfg(target_os = "windows")]
    actions.push(clipboard("copy-win", "Copy Windows path", "Alt+P", true, GRP_COPY, "{winpath}"));

    actions.push(clipboard("copy-name", "Copy folder name", "Alt+N", true, GRP_COPY, "{name}"));

    #[cfg(target_os = "windows")]
    {
        // Tabby isn't on PATH; launch it from its standard per-user install dir via
        // cmd (which expands %LOCALAPPDATA%). `tabby open <dir>` only sets the cwd of
        // the *default* profile, which can't cd into a \\wsl.localhost UNC path — so
        // run a WSL shell explicitly via `tabby run`. The `--` stops Tabby's yargs
        // from treating `-d` as its own --debug flag.
        actions.push(exec(
            "tabby",
            "Open in Tabby",
            "Alt+T",
            true,
            GRP_TERMINALS,
            "cmd",
            &["/c", "start", "", "%LOCALAPPDATA%\\Programs\\Tabby\\Tabby.exe", "run", "--", "wsl.exe", "-d", "{distro}", "--cd", "{wslpath}"],
        ));
        // `-w 0 nt` opens a new TAB in the current Windows Terminal window (or a new
        // window if none). Terminal uses the WSL profile; WSL shell runs wsl directly.
        actions.push(exec(
            "wt",
            "Open in Windows Terminal",
            "Alt+W",
            true,
            GRP_TERMINALS,
            "wt.exe",
            &["-w", "0", "nt", "-p", "{distro}", "-d", "{winpath}"],
        ));
        actions.push(exec("explorer", "Open in explorer.exe", "Alt+E", true, GRP_TERMINALS, "explorer.exe", &["{winpath}"]));
        actions.push(exec(
            "wsl-shell",
            "Open WSL shell here",
            "Alt+S",
            true,
            GRP_TERMINALS,
            "wt.exe",
            &["-w", "0", "nt", "wsl.exe", "-d", "{distro}", "--cd", "{wslpath}"],
        ));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, GRP_EDITORS, "cmd", &["/c", "code", "--folder-uri", "{vscode_uri}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, GRP_EDITORS, "cmd", &["/c", "cursor", "--folder-uri", "{vscode_uri}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, GRP_EDITORS, "cmd", &["/c", "zed", "{winpath}"]));
    }

    #[cfg(target_os = "linux")]
    {
        actions.push(exec("terminal", "Open terminal here", "Alt+W", true, GRP_TERMINALS, "x-terminal-emulator", &["--working-directory", "{path}"]));
        actions.push(exec("files", "Open file manager", "Alt+E", true, GRP_TERMINALS, "xdg-open", &["{path}"]));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, GRP_EDITORS, "code", &["{path}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, GRP_EDITORS, "cursor", &["{path}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, GRP_EDITORS, "zed", &["{path}"]));
    }

    #[cfg(target_os = "macos")]
    {
        actions.push(exec("terminal", "Open terminal here", "Alt+W", true, GRP_TERMINALS, "open", &["-a", "Terminal", "{path}"]));
        actions.push(exec("finder", "Open in Finder", "Alt+E", true, GRP_TERMINALS, "open", &["{path}"]));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, GRP_EDITORS, "code", &["{path}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, GRP_EDITORS, "cursor", &["{path}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, GRP_EDITORS, "zed", &["{path}"]));
    }

    // Agent harness launchers (Claude Code). Run the CLI in a terminal at the repo.
    actions.push(agent("agent-claude", "Claude Code", "Alt+C", true, GRP_AGENT_CLAUDE, ""));
    actions.push(agent("agent-claude-resume", "Claude Code — resume", "Alt+Shift+C", true, GRP_AGENT_CLAUDE, "--resume"));

    actions
}

fn config_path(app: &AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    app_dir.join("config.json")
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app);
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        serde_json::from_str(&content).map_err(|err| err.to_string())
    } else {
        let config = AppConfig::default();
        save_config_to_file(app, &config)?;
        Ok(config)
    }
}

fn save_config_to_file(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(&path, content).map_err(|err| err.to_string())
}

/// Reconcile the OS login-item registration with the desired state. Non-fatal:
/// a failure to register (e.g. locked-down registry) shouldn't break saving the
/// config — the rest of the settings still apply.
pub fn sync_autostart(app: &AppHandle, desired: bool) {
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current == desired {
        return;
    }
    let result = if desired { manager.enable() } else { manager.disable() };
    if let Err(error) = result {
        log::warn!("Failed to {} autostart: {}", if desired { "enable" } else { "disable" }, error);
    }
}

/// Persist a config to disk from non-command Rust (e.g. the startup distro probe).
/// Windows-only: its sole caller is the WSL-distro persistence on Windows startup.
#[cfg(target_os = "windows")]
pub fn persist_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    save_config_to_file(app, config)
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    save_config_to_file(&app, &config)?;
    sync_autostart(&app, config.launch_at_startup);
    Ok(())
}

#[tauri::command]
pub fn reset_config(app: AppHandle) -> Result<AppConfig, String> {
    let config = AppConfig::default();
    save_config_to_file(&app, &config)?;
    sync_autostart(&app, config.launch_at_startup);
    Ok(config)
}

/// The default config, without persisting it — used to preview a reset.
#[tauri::command]
pub fn default_config() -> AppConfig {
    AppConfig::default()
}
