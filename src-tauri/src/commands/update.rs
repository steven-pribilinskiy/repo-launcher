use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use super::config::load_config;

const VERSION: &str = env!("CARGO_PKG_VERSION");
// Unix seconds at compile time, embedded by build.rs — not the exe's on-disk
// mtime, which drifts on install/AV-scan/sync without an actual rebuild.
const BUILT_UNIX: &str = env!("REPO_LAUNCHER_BUILT_UNIX");

#[derive(Serialize)]
pub struct BuildInfo {
    pub version: String,
    pub built_unix: u64,
    /// `std::env::consts::OS` — "windows" | "linux" | "macos". The Updates tab
    /// needs it to say which settings apply, and this is already the build-facts
    /// command, so it rides along rather than earning an IPC command of its own.
    pub platform: String,
}

/// Version + build time (embedded at compile time), for the settings footer.
#[tauri::command]
pub fn app_build_info() -> BuildInfo {
    BuildInfo {
        version: VERSION.to_string(),
        built_unix: BUILT_UNIX.parse().unwrap_or(0),
        platform: std::env::consts::OS.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_info_embeds_a_real_compile_time_not_the_zero_fallback() {
        let info = app_build_info();
        assert_eq!(info.version, VERSION);
        // Sanity bound (year 2023+) — catches build.rs failing to set
        // REPO_LAUNCHER_BUILT_UNIX and silently falling back to 0.
        assert!(info.built_unix > 1_700_000_000);
    }

    #[test]
    fn is_newer_compares_numerically_not_lexically() {
        assert!(is_newer("v0.9.13", "0.9.12"));
        assert!(is_newer("0.9.2", "0.9.13") == false, "13 > 2 numerically");
        assert!(is_newer("v0.10.0", "0.9.99"));
        assert!(is_newer("1.0.0", "0.9.13"));
    }

    #[test]
    fn is_newer_is_false_for_same_or_older() {
        assert!(!is_newer("v0.9.12", "0.9.12"));
        assert!(!is_newer("0.9.11", "0.9.12"));
        // A shorter tag is padded with zeros, not treated as greater.
        assert!(!is_newer("v0.9", "0.9.12"));
    }
}

const REPO_SLUG: &str = "steven-pribilinskiy/repo-launcher";

pub fn release_page_url() -> String {
    format!("https://github.com/{REPO_SLUG}/releases/latest")
}

/// What GitHub says the newest published release is. `latest` is None when the
/// check couldn't complete OR when nothing has been released yet — neither of
/// which means "up to date", so `error` carries the reason and the UI can say
/// which of the three it is instead of implying the app is current.
#[derive(Serialize)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub release_url: String,
    pub error: Option<String>,
}

/// Compares the numeric components only (`0.9.13` > `0.9.2` > `0.9`). A
/// pre-release suffix isn't ordered — it compares equal to its release, which is
/// enough to decide whether to point at something newer.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |raw: &str| -> Vec<u64> {
        raw.trim()
            .trim_start_matches('v')
            .split(['.', '-', '+'])
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (latest, current) = (parse(latest), parse(current));
    for index in 0..latest.len().max(current.len()) {
        let left = latest.get(index).copied().unwrap_or(0);
        let right = current.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

/// `Ok(None)` = the repo is readable but has no published release yet — a normal
/// state, not a failure.
///
/// A bare 404 cannot tell that apart from "this repo isn't visible to an
/// unauthenticated client", because GitHub answers 404 for a private repo rather
/// than 403. Reporting the wrong one would render a permanently broken check as
/// the reassuring "nothing released yet", so the two are separated by asking
/// whether the repo itself is readable.
fn fetch_latest_tag() -> Result<Option<String>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("repo-launcher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(format!(
            "https://api.github.com/repos/{REPO_SLUG}/releases/latest"
        ))
        .send()
        .map_err(|err| err.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let repo_visible = client
            .get(format!("https://api.github.com/repos/{REPO_SLUG}"))
            .send()
            .map(|probe| probe.status().is_success())
            .map_err(|err| err.to_string())?;
        return if repo_visible {
            Ok(None)
        } else {
            Err(format!(
                "{REPO_SLUG} isn't readable without signing in, so releases can't be seen from here"
            ))
        };
    }
    if !response.status().is_success() {
        return Err(format!("GitHub returned {}", response.status()));
    }
    let body = response.text().map_err(|err| err.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|err| err.to_string())?;
    Ok(parsed
        .get("tag_name")
        .and_then(|value| value.as_str())
        .map(|tag| tag.to_string()))
}

fn run_update_check() -> UpdateCheck {
    let base = UpdateCheck {
        current: VERSION.to_string(),
        latest: None,
        available: false,
        release_url: release_page_url(),
        error: None,
    };
    match fetch_latest_tag() {
        Ok(Some(tag)) => {
            let available = is_newer(&tag, VERSION);
            UpdateCheck {
                latest: Some(tag.trim_start_matches('v').to_string()),
                available,
                ..base
            }
        }
        Ok(None) => UpdateCheck {
            error: Some("No release has been published yet".into()),
            ..base
        },
        Err(err) => UpdateCheck {
            error: Some(err),
            ..base
        },
    }
}

/// Ask GitHub whether a newer release exists. Async + `spawn_blocking` so the
/// network round trip never runs on the UI thread.
#[tauri::command]
pub async fn check_for_update() -> UpdateCheck {
    tauri::async_runtime::spawn_blocking(run_update_check)
        .await
        .unwrap_or_else(|err| UpdateCheck {
            current: VERSION.to_string(),
            latest: None,
            available: false,
            release_url: release_page_url(),
            error: Some(err.to_string()),
        })
}

/// Delay before the first check, so it stays off the startup path.
const UPDATE_CHECK_DELAY: Duration = Duration::from_secs(20);
/// Gap between checks. This app is a tray launcher that runs for days, so a
/// startup-only check would never see a release published after launch — which is
/// every release, from a running instance's point of view.
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Poll for a newer release for as long as the app runs, notifying once per
/// version. Silent unless something newer is actually published.
pub fn spawn_update_check(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    std::thread::spawn(move || {
        let mut announced: Option<String> = None;
        std::thread::sleep(UPDATE_CHECK_DELAY);
        loop {
            let result = run_update_check();
            match (&result.error, &result.latest) {
                // A failed check is transient (offline, rate limited) — log it and
                // try again next time rather than ending the loop.
                (Some(err), _) => log::info!("update check: {}", err),
                (None, Some(latest)) => {
                    log::info!("update check: latest {} (running {})", latest, VERSION);
                    let notify = load_config(&app)
                        .map(|config| config.notify_on_update)
                        .unwrap_or(true);
                    // Announce a given version once per run: re-notifying every
                    // interval for a version already reported is nagging, not news.
                    if result.available && notify && announced.as_deref() != Some(latest.as_str()) {
                        announced = Some(latest.clone());
                        let _ = app
                            .notification()
                            .builder()
                            .title("Repo Launcher update available")
                            .body(format!(
                                "v{latest} is out — you're on v{VERSION}. Settings → Updates to download."
                            ))
                            .show();
                    }
                }
                (None, None) => {}
            }
            std::thread::sleep(UPDATE_CHECK_INTERVAL);
        }
    });
}

#[derive(Default, Serialize, Deserialize)]
struct UpdateState {
    last_version: Option<String>,
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("state.json"))
}

fn read_state(app: &AppHandle) -> UpdateState {
    state_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state(app: &AppHandle, state: &UpdateState) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, raw);
    }
}

/// On startup: if the running version differs from the one recorded last run, we
/// were updated — show a native notification (when enabled). Always records the
/// current version so the next launch can detect the next update.
pub fn check_and_notify_update(app: &AppHandle) {
    let state = read_state(app);
    let was_updated = matches!(&state.last_version, Some(previous) if previous != VERSION);

    // Record the current version first, so a notification failure can never make
    // us re-notify on the next launch.
    write_state(
        app,
        &UpdateState {
            last_version: Some(VERSION.to_string()),
        },
    );

    if !was_updated {
        return;
    }
    let notify = load_config(app)
        .map(|config| config.notify_on_update)
        .unwrap_or(true);
    if !notify {
        return;
    }

    // Isolate the native-notification call on its own thread: a failing or
    // unavailable notification backend must never crash startup.
    let handle = app.clone();
    std::thread::spawn(move || {
        let _ = handle
            .notification()
            .builder()
            .title("Repo Launcher")
            .body(format!("Updated to v{VERSION}"))
            .show();
    });
}

fn exe_signature(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}

/// Watch the executable on disk; when it changes (a new build/version installed in
/// place), restart into it — unless auto-restart is disabled. The relaunched
/// instance then surfaces the "updated" notification via `check_and_notify_update`.
///
/// On Windows the running .exe is locked and can't be replaced in place, so updates
/// arrive via the installer (which closes and relaunches the app); this watcher is
/// simply a no-op there, and the startup notification still fires after relaunch.
pub fn spawn_restart_watcher(app: AppHandle) {
    // Dev builds are rebuilt and relaunched by `tauri dev`; a restart-on-change
    // watcher would fight it and thrash. Only watch in release builds.
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(baseline) = exe_signature(&exe) else { return };

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let auto = load_config(&app)
            .map(|config| config.auto_restart_on_update)
            .unwrap_or(true);
        if !auto {
            continue;
        }
        if let Some(current) = exe_signature(&exe) {
            if current != baseline {
                app.restart();
            }
        }
    });
}
