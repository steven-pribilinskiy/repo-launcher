use std::sync::atomic::{AtomicBool, Ordering};

// True while the user is moving the window via our drag handles. The Win32 subclass
// (Windows only) locks the window size whenever this is set, so FancyZones / aero-snap
// can't resize the popup into a zone mid-drag. Edge-resize never sets this, so resizing
// still works.
static MOVING: AtomicBool = AtomicBool::new(false);

/// Called from JS right before `startDragging()` so the drag guard locks the window
/// size for the duration of the move (and refreshes the auto-hide activity timer).
#[tauri::command]
pub fn begin_window_move() {
    super::window_state::mark_activity();
    MOVING.store(true, Ordering::SeqCst);
    // Safety net: clear the flag even if WM_EXITSIZEMOVE never arrives (e.g. a click
    // that starts no drag) so a later resize is never left locked.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(2000));
        MOVING.store(false, Ordering::SeqCst);
    });
}


/// Install the FancyZones / aero-snap drag guard (tool-window style + size-lock subclass)
/// on the given window. No-op off Windows.
pub fn install_drag_guard(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        if let Ok(handle) = window.hwnd() {
            win::install(handle.0 as isize);
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
mod win {
    use super::{Ordering, MOVING};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, SWP_NOSIZE, WINDOWPOS,
        WM_EXITSIZEMOVE, WM_WINDOWPOSCHANGING, WS_EX_TOOLWINDOW,
    };

    const SUBCLASS_ID: usize = 0xF20E;

    pub fn install(hwnd: isize) {
        let hwnd = hwnd as HWND;
        unsafe {
            set_tool_window(hwnd);
            SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
        }
    }

    // Mark the window as a tool window (FancyZones / aero-snap / Alt+Tab skip these).
    // Only writes when the bit is missing so the hot path stays cheap.
    unsafe fn set_tool_window(hwnd: HWND) {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if ex_style & WS_EX_TOOLWINDOW as isize == 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW as isize);
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        match msg {
            WM_WINDOWPOSCHANGING => {
                // Some shell operations clear the style; reassert so FancyZones keeps
                // skipping us whenever the window is being repositioned.
                set_tool_window(hwnd);
                if MOVING.load(Ordering::SeqCst) {
                    let window_pos = lparam as *mut WINDOWPOS;
                    if !window_pos.is_null() {
                        (*window_pos).flags |= SWP_NOSIZE;
                    }
                }
            }
            WM_EXITSIZEMOVE => {
                // FancyZones / aero-snap call SetWindowPos from a low-level mouse hook
                // AFTER the modal move loop returns; hold the lock briefly to catch it.
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    MOVING.store(false, Ordering::SeqCst);
                });
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}
