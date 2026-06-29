use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

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

/// Debounce toggling: returns false (skip) if called within 250ms of the last
/// allowed toggle, so a held/auto-repeating hotkey doesn't thrash show/hide.
pub fn toggle_allowed() -> bool {
    static LAST: OnceLock<Mutex<Instant>> = OnceLock::new();
    let cell = LAST.get_or_init(|| Mutex::new(Instant::now() - std::time::Duration::from_secs(1)));
    if let Ok(mut guard) = cell.lock() {
        if guard.elapsed().as_millis() < 250 {
            return false;
        }
        *guard = Instant::now();
    }
    true
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
    let scale = window.scale_factor().unwrap_or(1.0);
    let mut geom = WindowGeometry::default();
    // Store LOGICAL units so geometry is DPI-independent: the window keeps its
    // apparent size/place across monitors with different scale factors, and the
    // logical default round-trips exactly (set_size sets the inner size, so a
    // logical save → logical restore is a no-op — no grow loop).
    if let Ok(size) = window.inner_size() {
        let logical = size.to_logical::<f64>(scale);
        geom.width = Some(logical.width.round() as u32);
        geom.height = Some(logical.height.round() as u32);
    }
    if let Ok(pos) = window.outer_position() {
        let logical = pos.to_logical::<f64>(scale);
        geom.x = Some(logical.x.round() as i32);
        geom.y = Some(logical.y.round() as i32);
    }
    write_geometry(window.app_handle(), &geom);
}

/// Restore size (always) and position (when remembered), clamping the window onto
/// a visible monitor so it can never be stranded off-screen.
pub fn restore(window: &WebviewWindow, remember_position: bool) {
    let geom = read_geometry(window.app_handle());
    if let (Some(width), Some(height)) = (geom.width, geom.height) {
        let _ = window.set_size(LogicalSize::new(width, height));
    }
    if remember_position {
        if let (Some(x), Some(y)) = (geom.x, geom.y) {
            let (cx, cy) = clamp_to_monitor(window, x, y);
            let _ = window.set_position(LogicalPosition::new(cx, cy));
            return;
        }
    }
    let _ = window.center();
}

// `x`/`y` are logical; clamp in logical space (monitor/window metrics converted
// via the monitor's scale factor) so the window can never be stranded off-screen.
fn clamp_to_monitor(window: &WebviewWindow, x: i32, y: i32) -> (i32, i32) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return (x, y) };

    let scale = monitor.scale_factor();
    let mpos = monitor.position().to_logical::<i32>(scale);
    let msize = monitor.size().to_logical::<u32>(scale);
    let wsize = window
        .outer_size()
        .map(|size| size.to_logical::<u32>(scale))
        .unwrap_or_else(|_| LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
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
        let _ = window.set_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
        let _ = window.center();
    }
    Ok(())
}

/// Refresh the activity timestamp from JS right before a native drag/resize so the
/// drag-start blur (frameless window) doesn't trigger the focus-loss auto-hide.
#[tauri::command]
pub fn mark_active() {
    mark_activity();
}
