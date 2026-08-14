//! Deliver a string into the window that had focus before the popup opened —
//! without going through the clipboard where the OS allows it.
//!
//! The ladder is: type the text as synthesized Unicode keystrokes (clipboard
//! untouched) → clipboard + Ctrl+V → leave it on the clipboard and log. Each rung
//! is only taken when the one above it was refused, so nothing is ever silently
//! dropped.

use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Remember which window owned the foreground, so a later paste can hand focus
/// back to it. Called from the show path, BEFORE the popup takes focus.
#[cfg(target_os = "windows")]
pub fn remember_foreground() {
    let handle = unsafe { win::GetForegroundWindow() } as isize;
    // Our own window can already be foreground on a re-summon; keeping it would
    // make the paste target the popup itself.
    if handle == 0 || is_own_window(handle) {
        return;
    }
    if let Ok(mut guard) = previous_foreground().lock() {
        *guard = handle;
    }
}

#[cfg(not(target_os = "windows"))]
pub fn remember_foreground() {}

#[cfg(target_os = "windows")]
fn previous_foreground() -> &'static std::sync::Mutex<isize> {
    use std::sync::{Mutex, OnceLock};
    static CELL: OnceLock<Mutex<isize>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(0))
}

/// Does this HWND belong to our own process?
#[cfg(target_os = "windows")]
fn is_own_window(handle: isize) -> bool {
    let mut pid: u32 = 0;
    unsafe { win::GetWindowThreadProcessId(handle as *mut _, &mut pid) };
    pid == std::process::id()
}

/// Put `text` into the previously-focused window. Runs off the calling thread —
/// the ladder sleeps (bounded) while focus settles, and a Tauri command must not
/// stall the webview. The popup is hidden first, so there is no UI left to update
/// and the outcome goes to the log.
pub fn deliver(app: &AppHandle, text: String, prefer_direct: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || run_ladder(&app, &text, prefer_direct));
}

#[cfg(target_os = "windows")]
fn run_ladder(app: &AppHandle, text: &str, prefer_direct: bool) {
    if text.is_empty() {
        return;
    }
    if !restore_focus() {
        log::warn!("paste: couldn't restore the previous foreground window; leaving text on the clipboard");
        let _ = app.clipboard().write_text(text.to_string());
        return;
    }
    release_held_shift();

    if prefer_direct {
        match type_unicode(text) {
            Ok(()) => {
                log::info!("paste: typed {} chars directly", text.chars().count());
                return;
            }
            Err(error) => log::warn!("paste: direct typing refused ({}); falling back to clipboard", error),
        }
    }

    if let Err(error) = app.clipboard().write_text(text.to_string()) {
        log::warn!("paste: clipboard write failed: {}", error);
        return;
    }
    match send_ctrl_v() {
        Ok(()) => log::info!("paste: delivered via clipboard + Ctrl+V"),
        // The text is on the clipboard either way — the user can still paste it.
        Err(error) => log::warn!("paste: Ctrl+V refused ({}); text is on the clipboard", error),
    }
}

#[cfg(not(target_os = "windows"))]
fn run_ladder(app: &AppHandle, text: &str, _prefer_direct: bool) {
    // No OS input synthesis without a new dependency (xdotool / AppleScript), so a
    // paste action degrades to a copy here.
    if let Err(error) = app.clipboard().write_text(text.to_string()) {
        log::warn!("paste: clipboard write failed: {}", error);
    }
}

// ── Windows input synthesis ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    pub use windows_sys::Win32::Foundation::GetLastError;
    pub use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VK_CONTROL, VK_LSHIFT, VK_RSHIFT, VK_SHIFT, VK_V,
    };
    pub use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
    };
}

/// Hand the foreground back to the window the popup interrupted, then wait until
/// the OS agrees — keystrokes sent before focus lands go nowhere.
#[cfg(target_os = "windows")]
fn restore_focus() -> bool {
    let target = previous_foreground().lock().map(|guard| *guard).unwrap_or(0);
    // A window that has since closed would otherwise burn the whole poll budget
    // before we conclude what IsWindow answers immediately.
    if target == 0 || unsafe { win::IsWindow(target as *mut _) } == 0 {
        return false;
    }
    // Allowed: we are the foreground process at this point, so we may give it away.
    unsafe { win::SetForegroundWindow(target as *mut _) };
    for _ in 0..FOCUS_POLLS {
        if unsafe { win::GetForegroundWindow() } as isize == target {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(FOCUS_POLL_MS));
    }
    false
}

/// The user is still physically holding Shift from Shift+Enter. Unicode typing
/// ignores modifier state, but a synthesized Ctrl+V under a held Shift arrives as
/// Shift+Ctrl+V — a different command in most terminals.
#[cfg(target_os = "windows")]
fn release_held_shift() {
    if unsafe { win::GetAsyncKeyState(win::VK_SHIFT as i32) } as u16 & 0x8000 == 0 {
        return;
    }
    let inputs = [
        key_input(win::VK_LSHIFT, win::KEYEVENTF_KEYUP),
        key_input(win::VK_RSHIFT, win::KEYEVENTF_KEYUP),
    ];
    let _ = submit(&inputs);
}

/// One keydown/keyup pair per UTF-16 code unit, so surrogate pairs (emoji) and
/// any keyboard layout are handled by the OS rather than by us.
#[cfg(target_os = "windows")]
fn type_unicode(text: &str) -> Result<(), String> {
    let units: Vec<u16> = text.encode_utf16().collect();
    // Chunked deliberately: one oversized SendInput batch is a recorded corruption
    // source, where the tail of the batch arrives scrambled or not at all.
    for chunk in units.chunks(CHUNK_UNITS) {
        let mut inputs = Vec::with_capacity(chunk.len() * 2);
        for &unit in chunk {
            inputs.push(unicode_input(unit, 0));
            inputs.push(unicode_input(unit, win::KEYEVENTF_KEYUP));
        }
        submit(&inputs)?;
        std::thread::sleep(std::time::Duration::from_millis(CHUNK_PAUSE_MS));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_ctrl_v() -> Result<(), String> {
    let inputs = [
        key_input(win::VK_CONTROL, 0),
        key_input(win::VK_V, 0),
        key_input(win::VK_V, win::KEYEVENTF_KEYUP),
        key_input(win::VK_CONTROL, win::KEYEVENTF_KEYUP),
    ];
    submit(&inputs)
}

/// Hand a batch to SendInput and insist every event was accepted. A short return
/// means the target refused us — most often UIPI, where the foreground window
/// belongs to a higher-integrity (elevated) process.
#[cfg(target_os = "windows")]
fn submit(inputs: &[win::INPUT]) -> Result<(), String> {
    // SendInput rejects an empty buffer, and the pointer to one is invalid.
    if inputs.is_empty() {
        return Ok(());
    }
    let sent = unsafe {
        win::SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<win::INPUT>() as i32,
        )
    };
    if sent as usize == inputs.len() {
        return Ok(());
    }
    let code = unsafe { win::GetLastError() };
    Err(match code {
        5 => "access denied — the target window runs elevated".to_string(),
        other => format!("SendInput accepted {}/{} events (error {})", sent, inputs.len(), other),
    })
}

#[cfg(target_os = "windows")]
fn unicode_input(unit: u16, flags: u32) -> win::INPUT {
    win::INPUT {
        r#type: win::INPUT_KEYBOARD,
        Anonymous: win::INPUT_0 {
            ki: win::KEYBDINPUT {
                wVk: 0,
                wScan: unit,
                dwFlags: win::KEYEVENTF_UNICODE | flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
fn key_input(key: u16, flags: u32) -> win::INPUT {
    win::INPUT {
        r#type: win::INPUT_KEYBOARD,
        Anonymous: win::INPUT_0 {
            ki: win::KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
const CHUNK_UNITS: usize = 32;
#[cfg(target_os = "windows")]
const CHUNK_PAUSE_MS: u64 = 2;
#[cfg(target_os = "windows")]
const FOCUS_POLLS: u32 = 40;
#[cfg(target_os = "windows")]
const FOCUS_POLL_MS: u64 = 10;
