use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// What a folder action does when triggered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    /// Copy a substituted string to the clipboard.
    Clipboard,
    /// Spawn a program with substituted args.
    Exec,
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
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    /// Restrict to these OSes ("windows"/"linux"/"macos"). None = all.
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
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
    /// The configurable action registry.
    #[serde(default = "default_actions")]
    pub actions: Vec<ActionDef>,
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

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            cache_ttl_seconds: default_ttl(),
            wsl_distro: None,
            cache_path: None,
            rebuild_command: None,
            theme: default_theme(),
            auto_restart_on_update: true,
            notify_on_update: true,
            actions: default_actions(),
        }
    }
}

fn clipboard(id: &str, label: &str, hotkey: &str, enabled: bool, template: &str) -> ActionDef {
    ActionDef {
        id: id.to_string(),
        label: label.to_string(),
        hotkey: hotkey.to_string(),
        enabled,
        kind: ActionKind::Clipboard,
        template: Some(template.to_string()),
        program: None,
        args: None,
        platforms: None,
    }
}

fn exec(id: &str, label: &str, hotkey: &str, enabled: bool, program: &str, args: &[&str]) -> ActionDef {
    ActionDef {
        id: id.to_string(),
        label: label.to_string(),
        hotkey: hotkey.to_string(),
        enabled,
        kind: ActionKind::Exec,
        template: None,
        program: Some(program.to_string()),
        args: Some(args.iter().map(|arg| arg.to_string()).collect()),
        platforms: None,
    }
}

/// Built-in default actions, per OS. All editable/removable in settings.
/// Enabled-by-default: the copy actions + the Windows openers. The editors
/// (VS Code / Cursor / Zed) ship present-but-disabled.
pub fn default_actions() -> Vec<ActionDef> {
    let mut actions = vec![
        clipboard("copy-abs", "Copy absolute path", "Enter", true, "{winpath}"),
        clipboard("copy-wsl", "Copy WSL path", "Alt+P", true, "{wslpath}"),
        clipboard("copy-name", "Copy folder name", "Alt+N", true, "{name}"),
    ];

    #[cfg(target_os = "windows")]
    {
        // Tabby's CLI: `Tabby.exe open <directory>` opens a shell there. Tabby.exe
        // may not be on PATH — if the button does nothing, set its full path in
        // Settings → Actions → Open in Tabby → Program.
        actions.push(exec("tabby", "Open in Tabby", "Alt+B", true, "Tabby.exe", &["open", "{winpath}"]));
        actions.push(exec(
            "wt",
            "Open in Windows Terminal",
            "Alt+T",
            true,
            "wt.exe",
            &["-p", "{distro}", "-d", "{winpath}"],
        ));
        actions.push(exec("explorer", "Open in explorer.exe", "Alt+E", true, "explorer.exe", &["{winpath}"]));
        actions.push(exec(
            "wsl-shell",
            "Open WSL shell here",
            "Alt+S",
            true,
            "cmd",
            &["/c", "start", "", "wsl.exe", "-d", "{distro}", "--cd", "{wslpath}"],
        ));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, "cmd", &["/c", "code", "--folder-uri", "{vscode_uri}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, "cmd", &["/c", "cursor", "--folder-uri", "{vscode_uri}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, "cmd", &["/c", "zed", "{winpath}"]));
    }

    #[cfg(target_os = "linux")]
    {
        actions.push(exec("terminal", "Open terminal here", "Alt+T", true, "x-terminal-emulator", &["--working-directory", "{path}"]));
        actions.push(exec("files", "Open file manager", "Alt+E", true, "xdg-open", &["{path}"]));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, "code", &["{path}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, "cursor", &["{path}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, "zed", &["{path}"]));
    }

    #[cfg(target_os = "macos")]
    {
        actions.push(exec("terminal", "Open terminal here", "Alt+T", true, "open", &["-a", "Terminal", "{path}"]));
        actions.push(exec("finder", "Open in Finder", "Alt+E", true, "open", &["{path}"]));
        actions.push(exec("vscode", "Open in VS Code", "Alt+V", false, "code", &["{path}"]));
        actions.push(exec("cursor", "Open in Cursor", "Alt+R", false, "cursor", &["{path}"]));
        actions.push(exec("zed", "Open in Zed", "Alt+Z", false, "zed", &["{path}"]));
    }

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

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    save_config_to_file(&app, &config)
}

#[tauri::command]
pub fn reset_config(app: AppHandle) -> Result<AppConfig, String> {
    let config = AppConfig::default();
    save_config_to_file(&app, &config)?;
    Ok(config)
}
