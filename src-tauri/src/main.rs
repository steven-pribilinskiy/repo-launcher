// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::cache::{cycle_sort, get_sort, maybe_refresh, read_repos, refresh_repos};
use commands::config::load_config;
use commands::repos::{list_distros, run_action};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let config =
                load_config(&app.handle()).unwrap_or_else(|_| commands::config::AppConfig::default());

            // Notify if we were just updated, then watch for the next update.
            commands::update::check_and_notify_update(&app.handle());
            commands::update::spawn_restart_watcher(app.handle().clone());

            // --- System tray ---
            let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let refresh_item = MenuItemBuilder::with_id("refresh", "Refresh Repos").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &settings_item, &refresh_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Repo Launcher")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => toggle_window(app),
                    "settings" => show_settings(app),
                    "refresh" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("refresh-repos", ());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // --- Main popup window behavior ---
            // REPO_LAUNCHER_NO_AUTOHIDE keeps the popup open when it loses focus;
            // REPO_LAUNCHER_SHOW_ON_START opens it at launch. Both help on
            // environments without a system tray or a working global hotkey.
            let autohide = std::env::var_os("REPO_LAUNCHER_NO_AUTOHIDE").is_none();
            if let Some(window) = app.get_webview_window("main") {
                let handle = window.clone();
                window.on_window_event(move |event| match event {
                    // Save geometry on focus loss (precedes every hide), then hide.
                    WindowEvent::Focused(false) => {
                        commands::window_state::persist(&handle);
                        if autohide {
                            let _ = handle.hide();
                        }
                    }
                    // The popup is never truly closed — closing just hides it; the app
                    // quits only via the tray, so the background launcher stays alive.
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = handle.hide();
                    }
                    _ => {}
                });
                if std::env::var_os("REPO_LAUNCHER_SHOW_ON_START").is_some() {
                    commands::window_state::restore(&window, config.remember_position);
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("window-shown", ());
                }
            }

            // Settings window: closing it just hides it, never quits the app.
            if let Some(settings) = app.get_webview_window("settings") {
                let handle = settings.clone();
                settings.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = handle.hide();
                    }
                });
            }

            // --- Global shortcut ---
            let hotkey = parse_hotkey(&config.hotkey);
            let app_handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, shortcut, event| {
                        if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
                            toggle_window(&app_handle);
                        }
                    })
                    .build(),
            )?;
            // Non-fatal: a hotkey conflict (or no grab on Wayland) shouldn't stop
            // the app — the tray still works.
            if let Err(error) = app.global_shortcut().register(hotkey) {
                eprintln!("Failed to register global hotkey '{}': {}", config.hotkey, error);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_repos,
            refresh_repos,
            maybe_refresh,
            get_sort,
            cycle_sort,
            run_action,
            list_distros,
            open_settings,
            update_hotkey,
            commands::config::get_config,
            commands::config::save_config,
            commands::config::reset_config,
            commands::config::default_config,
            commands::update::app_build_info,
            commands::window_state::reset_window_geometry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let remember = load_config(app).map(|cfg| cfg.remember_position).unwrap_or(true);
            commands::window_state::restore(&window, remember);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("window-shown", ());
        }
    }
}

fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("settings-shown", ());
    }
}

/// Show the settings window (invoked from the popup's gear button). Hides the
/// always-on-top popup first so it doesn't cover the settings window.
#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    show_settings(&app);
}

/// Re-register the global hotkey live after the user changes it in settings.
#[tauri::command]
fn update_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    let shortcut = parse_hotkey(&hotkey);
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    manager
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_window(app);
            }
        })
        .map_err(|err| format!("Failed to register hotkey: {}", err))
}

fn parse_hotkey(hotkey_str: &str) -> Shortcut {
    let parts: Vec<&str> = hotkey_str.split('+').map(|part| part.trim()).collect();

    let mut modifiers = Modifiers::empty();
    let mut key_code = Code::KeyC;

    for part in &parts {
        match part.to_lowercase().as_str() {
            "super" | "win" | "meta" | "cmd" => modifiers |= Modifiers::SUPER,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            other => {
                key_code = match other.to_uppercase().as_str() {
                    "A" => Code::KeyA,
                    "B" => Code::KeyB,
                    "C" => Code::KeyC,
                    "D" => Code::KeyD,
                    "E" => Code::KeyE,
                    "F" => Code::KeyF,
                    "G" => Code::KeyG,
                    "H" => Code::KeyH,
                    "I" => Code::KeyI,
                    "J" => Code::KeyJ,
                    "K" => Code::KeyK,
                    "L" => Code::KeyL,
                    "M" => Code::KeyM,
                    "N" => Code::KeyN,
                    "O" => Code::KeyO,
                    "P" => Code::KeyP,
                    "Q" => Code::KeyQ,
                    "R" => Code::KeyR,
                    "S" => Code::KeyS,
                    "T" => Code::KeyT,
                    "U" => Code::KeyU,
                    "V" => Code::KeyV,
                    "W" => Code::KeyW,
                    "X" => Code::KeyX,
                    "Y" => Code::KeyY,
                    "Z" => Code::KeyZ,
                    "SPACE" => Code::Space,
                    "ESCAPE" | "ESC" => Code::Escape,
                    "BACKQUOTE" | "`" => Code::Backquote,
                    _ => Code::KeyC,
                };
            }
        }
    }

    let mods = if modifiers.is_empty() {
        None
    } else {
        Some(modifiers)
    };

    Shortcut::new(mods, key_code)
}
