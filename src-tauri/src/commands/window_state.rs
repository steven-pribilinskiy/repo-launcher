use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

fn last_activity() -> &'static Mutex<Instant> {
    static CELL: OnceLock<Mutex<Instant>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(Instant::now()))
}

/// Record window activity (shown / focused / resized / moved) so an immediately
/// following spurious blur can be ignored.
pub fn mark_activity() {
    if let Ok(mut guard) = last_activity().lock() {
        *guard = Instant::now();
    }
}

/// True if there was activity within the last `within_ms` — used to suppress the
/// focus-race blur that fires right after showing or while resizing.
pub fn recently_active(within_ms: u64) -> bool {
    last_activity()
        .lock()
        .map(|guard| guard.elapsed().as_millis() < u128::from(within_ms))
        .unwrap_or(false)
}

const DEFAULT_WIDTH: u32 = 760;
const DEFAULT_HEIGHT: u32 = 600;

#[derive(Default, Serialize, Deserialize, Clone, Copy)]
pub struct WindowGeometry {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("window-state.json"))
}

fn read_geometry(app: &AppHandle) -> WindowGeometry {
    state_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_geometry(app: &AppHandle, geom: &WindowGeometry) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(geom) {
        let _ = std::fs::write(path, raw);
    }
}

/// Save the window's current size + position to disk (called when it loses focus,
/// which precedes every hide).
pub fn persist(window: &WebviewWindow) {
    let mut geom = WindowGeometry::default();
    if let Ok(size) = window.outer_size() {
        geom.width = Some(size.width);
        geom.height = Some(size.height);
    }
    if let Ok(pos) = window.outer_position() {
        geom.x = Some(pos.x);
        geom.y = Some(pos.y);
    }
    write_geometry(window.app_handle(), &geom);
}

/// Restore size (always) and position (when remembered), clamping the window onto
/// a visible monitor so it can never be stranded off-screen.
pub fn restore(window: &WebviewWindow, remember_position: bool) {
    let geom = read_geometry(window.app_handle());
    if let (Some(width), Some(height)) = (geom.width, geom.height) {
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
    if remember_position {
        if let (Some(x), Some(y)) = (geom.x, geom.y) {
            let (cx, cy) = clamp_to_monitor(window, x, y);
            let _ = window.set_position(PhysicalPosition::new(cx, cy));
            return;
        }
    }
    let _ = window.center();
}

fn clamp_to_monitor(window: &WebviewWindow, x: i32, y: i32) -> (i32, i32) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return (x, y) };

    let mpos = monitor.position();
    let msize = monitor.size();
    let wsize = window
        .outer_size()
        .unwrap_or(PhysicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    let max_x = (mpos.x + msize.width as i32 - wsize.width as i32).max(mpos.x);
    let max_y = (mpos.y + msize.height as i32 - wsize.height as i32).max(mpos.y);
    (x.clamp(mpos.x, max_x), y.clamp(mpos.y, max_y))
}

/// Forget the saved geometry and return the window to its default size, centered.
#[tauri::command]
pub fn reset_window_geometry(app: AppHandle) -> Result<(), String> {
    if let Some(path) = state_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(PhysicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
        let _ = window.center();
    }
    Ok(())
}
