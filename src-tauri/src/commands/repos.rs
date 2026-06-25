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
