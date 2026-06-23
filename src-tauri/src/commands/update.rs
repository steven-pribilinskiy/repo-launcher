use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use super::config::load_config;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize)]
pub struct BuildInfo {
    pub version: String,
    /// Unix seconds the executable was built (its on-disk modified time).
    pub built_unix: u64,
}

/// Version + build time (from the executable's mtime), for the settings footer.
#[tauri::command]
pub fn app_build_info() -> BuildInfo {
    let built_unix = std::env::current_exe()
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs())
        .unwrap_or(0);
    BuildInfo {
        version: VERSION.to_string(),
        built_unix,
    }
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
