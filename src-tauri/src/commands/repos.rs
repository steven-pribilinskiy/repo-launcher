use serde::{Deserialize, Serialize};
use std::process::Command;

use super::cache::append_history;
use super::config::{ActionDef, ActionKind};
use crate::commands::config::load_config;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    /// Cache row type: "repo" | "wt" | "dir" | "ws".
    #[serde(default)]
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub distro: String,
    /// Times this path appears in goto-repo history.
    #[serde(default)]
    pub uses: u64,
    /// Most-recent history timestamp (unix seconds), 0 if never.
    #[serde(default)]
    pub last_used: u64,
}

/// Installed WSL distros, default first. Reads the WSL registry (`Lxss`) rather
/// than `wsl --list`, which cold-starts the WSL VM (~5s) — the registry read is
/// instant and never wakes the VM, so it's safe on the startup hot path.
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn list_distros() -> Result<Vec<String>, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let lxss = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss")
        .map_err(|err| format!("open Lxss registry: {}", err))?;
    let default_guid: String = lxss.get_value("DefaultDistribution").unwrap_or_default();

    let mut default_name: Option<String> = None;
    let mut others: Vec<String> = Vec::new();
    for guid in lxss.enum_keys().flatten() {
        let Ok(sub) = lxss.open_subkey(&guid) else { continue };
        let Ok(name) = sub.get_value::<String, _>("DistributionName") else { continue };
        if name.to_lowercase().contains("docker") {
            continue;
        }
        if guid.eq_ignore_ascii_case(&default_guid) {
            default_name = Some(name);
        } else {
            others.push(name);
        }
    }

    let mut result = Vec::new();
    if let Some(name) = default_name {
        result.push(name);
    }
    result.extend(others);
    if result.is_empty() {
        return Err("no WSL distros found in registry".into());
    }
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn list_distros() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Decode WSL output which may be UTF-16LE on Windows.
#[cfg(target_os = "windows")]
pub fn decode_wsl_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter(|chunk| chunk.len() == 2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else if bytes.iter().any(|&byte| byte == 0) {
        let units: Vec<u16> = bytes
            .chunks(2)
            .filter(|chunk| chunk.len() == 2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

// ── Path conversion helpers ──────────────────────────────────────────────────

/// WSL POSIX path -> Windows path. `/mnt/c/...` becomes `C:\...`; everything else
/// becomes a `\\wsl.localhost\<distro>\...` UNC path.
#[cfg(target_os = "windows")]
fn wsl_to_windows_path(distro: &str, wsl_path: &str) -> String {
    if let Some(rest) = wsl_path.strip_prefix("/mnt/") {
        let mut chars = rest.chars();
        if let Some(drive) = chars.next() {
            let after = &rest[drive.len_utf8()..];
            if drive.is_ascii_alphabetic() && (after.is_empty() || after.starts_with('/')) {
                return format!("{}:{}", drive.to_ascii_uppercase(), after.replace('/', "\\"));
            }
        }
    }
    format!("\\\\wsl.localhost\\{}{}", distro, wsl_path.replace('/', "\\"))
}

fn vscode_uri(distro: &str, wsl_path: &str) -> String {
    format!("vscode-remote://wsl+{}{}", distro, wsl_path)
}

#[cfg(target_os = "windows")]
fn win_path(distro: &str, path: &str) -> String {
    wsl_to_windows_path(distro, path)
}

#[cfg(not(target_os = "windows"))]
fn win_path(_distro: &str, path: &str) -> String {
    path.to_string()
}

fn basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

/// CLI binary + dangerous-permissions flag per agent harness.
/// Mirror of `AGENT_HARNESSES` in src/types/index.ts — keep in sync.
fn agent_cli(harness: &str) -> (&'static str, &'static str) {
    match harness {
        "codex" => ("codex", "--dangerously-bypass-approvals-and-sandbox"),
        "gemini" => ("gemini", "--yolo"),
        _ => ("claude", "--dangerously-skip-permissions"),
    }
}

/// Build the (program, args) that launch `inner` (a shell command) in a terminal
/// at the repo. `inner` already includes the CLI + flags. Windows runs it inside
/// the WSL distro; other OSes run it in a login shell at the path.
#[cfg(target_os = "windows")]
fn build_agent_terminal_cmd(terminal: &str, distro: &str, wslpath: &str, inner: &str) -> (String, Vec<String>) {
    // `exec bash` keeps the tab open after the agent exits.
    let shell_cmd = format!("{}; exec bash", inner);
    let parts: Vec<&str> = match terminal {
        "tabby" => vec![
            "/c", "start", "", "%LOCALAPPDATA%\\Programs\\Tabby\\Tabby.exe", "run", "--",
            "wsl.exe", "-d", distro, "--cd", wslpath, "--", "bash", "-lic", &shell_cmd,
        ],
        _ => vec![
            "-w", "0", "nt", "wsl.exe", "-d", distro, "--cd", wslpath, "--", "bash", "-lic", &shell_cmd,
        ],
    };
    let program = if terminal == "tabby" { "cmd" } else { "wt.exe" };
    (program.to_string(), parts.into_iter().map(String::from).collect())
}

#[cfg(not(target_os = "windows"))]
fn build_agent_terminal_cmd(_terminal: &str, _distro: &str, wslpath: &str, inner: &str) -> (String, Vec<String>) {
    // Best-effort on non-Windows: run in a login shell at the repo path.
    let shell_cmd = format!("cd {} && {}; exec bash", shell_quote(wslpath), inner);
    ("bash".to_string(), vec!["-lic".to_string(), shell_cmd])
}

#[cfg(not(target_os = "windows"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Substitute action placeholders for the selected repo.
fn substitute(template: &str, repo: &Repo) -> String {
    template
        .replace("{winpath}", &win_path(&repo.distro, &repo.path))
        .replace("{wslpath}", &repo.path)
        .replace("{vscode_uri}", &vscode_uri(&repo.distro, &repo.path))
        .replace("{name}", &basename(&repo.path))
        .replace("{distro}", &repo.distro)
        .replace("{path}", &repo.path)
}

// ── Action runner ────────────────────────────────────────────────────────────

/// Run a configured action against the selected repo. Returns Some(text) for
/// Clipboard actions (the frontend writes it to the clipboard); None for Exec.
/// Records usage in the shared goto-repo history regardless.
#[tauri::command]
pub fn run_action(app: AppHandle, action: ActionDef, repo: Repo) -> Result<Option<String>, String> {
    let config = load_config(&app).ok();

    let result = match action.kind {
        ActionKind::Clipboard => {
            let template = action.template.unwrap_or_default();
            Some(substitute(&template, &repo))
        }
        ActionKind::Exec => {
            let program = action
                .program
                .filter(|prog| !prog.trim().is_empty())
                .ok_or("Exec action has no program")?;
            let program = substitute(&program, &repo);
            let args: Vec<String> = action
                .args
                .unwrap_or_default()
                .iter()
                .map(|arg| substitute(arg, &repo))
                .collect();
            Command::new(&program)
                .args(&args)
                .spawn()
                .map_err(|err| format!("Failed to run {}: {}", program, err))?;
            None
        }
        ActionKind::Agent => {
            let config = config.as_ref().ok_or("Failed to load config for agent action")?;
            let group = config
                .groups
                .iter()
                .find(|group| action.group.as_deref() == Some(group.id.as_str()))
                .ok_or("Agent action has no group")?;
            let harness = group.harness.as_deref().unwrap_or("claude");
            let (cli, dangerous_flag) = agent_cli(harness);

            let mut inner = cli.to_string();
            if group.dangerous.unwrap_or(true) {
                inner.push(' ');
                inner.push_str(dangerous_flag);
            }
            if let Some(flags) = action.agent_flags.as_deref() {
                let flags = flags.trim();
                if !flags.is_empty() {
                    inner.push(' ');
                    inner.push_str(flags);
                }
            }

            let terminal = group
                .terminal
                .clone()
                .filter(|term| !term.trim().is_empty())
                .unwrap_or_else(|| config.preferred_terminal.clone());
            let (program, args) = build_agent_terminal_cmd(&terminal, &repo.distro, &repo.path, &inner);
            Command::new(&program)
                .args(&args)
                .spawn()
                .map_err(|err| format!("Failed to launch agent ({}): {}", program, err))?;
            None
        }
    };

    if let Some(config) = &config {
        let _ = append_history(config, &repo.path);
    }

    Ok(result)
}

/// Resolve a path (POSIX or already-Windows) to a Windows path for explorer/start.
#[cfg(target_os = "windows")]
fn resolve_win(app: &AppHandle, path: &str) -> String {
    if path.starts_with('/') {
        let distro = load_config(app)
            .ok()
            .map(|config| super::cache::resolve_distro(&config))
            .unwrap_or_else(|| "Ubuntu".to_string());
        win_path(&distro, path)
    } else {
        path.to_string()
    }
}

/// Open a Data-tab path. `mode`: "file" = launch with the default app, "reveal" =
/// open the folder with the file selected, "folder" = open the folder itself.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String, mode: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let win = resolve_win(&app, &path);
        match mode.as_str() {
            "reveal" | "folder" => {
                // explorer.exe is a GUI app — no console flash.
                let mut cmd = Command::new("explorer.exe");
                if mode == "reveal" {
                    cmd.arg(format!("/select,{}", win));
                } else {
                    cmd.arg(&win);
                }
                cmd.spawn().map_err(|err| format!("Failed to open {}: {}", win, err))?;
            }
            // "file": open with the default app exactly as a double-click does, via
            // ShellExecuteW. Avoids `cmd /c start` (flashes a console + Rust's cmd-arg
            // escaping mishandles some paths, so the file silently didn't open).
            _ => {
                use std::ffi::OsStr;
                use std::os::windows::ffi::OsStrExt;
                let wide = |value: &str| {
                    OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>()
                };
                let verb = wide("open");
                let file = wide(&win);
                let result = unsafe {
                    windows_sys::Win32::UI::Shell::ShellExecuteW(
                        std::ptr::null_mut(),
                        verb.as_ptr(),
                        file.as_ptr(),
                        std::ptr::null(),
                        std::ptr::null(),
                        windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
                    )
                };
                // ShellExecuteW returns a value > 32 on success.
                if (result as isize) <= 32 {
                    return Err(format!("Failed to open {} (ShellExecute {})", win, result as isize));
                }
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &app;
        let target = if mode == "reveal" {
            std::path::Path::new(&path)
                .parent()
                .map(|parent| parent.display().to_string())
                .unwrap_or_else(|| path.clone())
        } else {
            path.clone()
        };
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        Command::new(opener)
            .arg(&target)
            .spawn()
            .map_err(|err| format!("Failed to open {}: {}", target, err))?;
        Ok(())
    }
}
