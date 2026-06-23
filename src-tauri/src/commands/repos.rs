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

/// Detect installed WSL distros via `wsl --list --quiet`.
#[tauri::command]
pub fn list_distros() -> Result<Vec<String>, String> {
    let output = Command::new("wsl")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|err| format!("Failed to run wsl: {}", err))?;

    if !output.status.success() {
        return Err(format!(
            "wsl --list failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = decode_wsl_output(&output.stdout);

    let distros: Vec<String> = stdout
        .lines()
        .map(|line| line.trim().trim_matches('\0').to_string())
        .filter(|line| !line.is_empty())
        .filter(|line| !line.to_lowercase().contains("docker"))
        .collect();

    Ok(distros)
}

/// Decode WSL output which may be UTF-16LE on Windows.
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
    };

    if let Ok(config) = load_config(&app) {
        let _ = append_history(&config, &repo.path);
    }

    Ok(result)
}
