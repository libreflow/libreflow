// LibreFlow — Backend Tauri
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod mini;
mod watch;
#[cfg(target_os = "windows")]
mod taskbar;

use tauri::{Emitter, Manager, WindowEvent};
use tauri::Listener;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_window_state::Builder as WindowStateBuilder;

static MINI_CLOSE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(WindowStateBuilder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mini::MiniState(Default::default()))
        .manage(mini::MiniOpenGuard(tokio::sync::Mutex::new(())))
        .manage(watch::WatchState(Default::default()))
        .invoke_handler(tauri::generate_handler![
            commands::open_folder,
            commands::notify_track,
            commands::write_tags,
            commands::pick_image,
            commands::pick_audio_file,
            commands::write_cover,
            commands::write_replaygain_tags,
            commands::win_close,
            commands::win_minimize,
            commands::win_maximize,
            commands::win_set_title,
            commands::taskbar_set_playing,
            commands::taskbar_set_has_tracks,
            mini::mini_toggle,
            mini::mini_close,
            mini::mini_update,
            mini::mini_progress,
            mini::mini_get_state,
            watch::watch_folder_start,
            watch::watch_folder_stop,
            commands::allow_asset_dir,
            commands::check_paths,
            commands::read_audio_props,
            commands::read_tags,
            #[cfg(debug_assertions)]
            commands::open_devtools,
        ])
        .setup(|app| {
            // ── Raccourcis médias ─────────────────────────────────────────
            let shortcuts = [
                ("MediaPlayPause",     "toggle-play"),
                ("MediaNextTrack",     "next"),
                ("MediaPreviousTrack", "prev"),
                ("MediaStop",          "stop"),
            ];
            for (key, cmd) in shortcuts {
                let cmd_str = cmd.to_string();
                let _ = app.global_shortcut().on_shortcut(key, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.emit("media-key", &cmd_str);
                        }
                    }
                });
            }

            // ── Thumbnail toolbar Windows (Prev / Play / Next) ───────────
            #[cfg(target_os = "windows")]
            {
                if let Some(main_win_tb) = app.get_webview_window("main") {
                    taskbar::setup(main_win_tb, app.handle().clone());
                } else {
                    eprintln!("[taskbar] fenêtre main introuvable — thumbnail toolbar désactivée");
                }
            }

            // ── Fusionner les deux on_window_event en un seul ─────────────
            if let Some(main_win) = app.get_webview_window("main") {

            let app_handle = app.handle().clone();
            main_win.on_window_event(move |event| {
                match event {
                    // Fermer le mini quand la fenêtre principale reprend le focus
                    WindowEvent::Focused(true) => {
                        let app = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(main) = app.get_webview_window("main") {
                                let is_minimized = main.is_minimized().unwrap_or(true);
                                if !is_minimized {
                                    if let Some(mini_win) = app.get_webview_window("mini") {
                                        let token = MINI_CLOSE_SEQ
                                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                                            .to_string();
                                        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                                        let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
                                        let tx2 = tx.clone();
                                        let token2 = token.clone();
                                        let eid = app.listen("mini-pos-saved", move |e| {
                                            if e.payload().trim_matches('"') == token2 {
                                                if let Ok(mut g) = tx2.lock() {
                                                    if let Some(s) = g.take() { let _ = s.send(()); }
                                                }
                                            }
                                        });
                                        let _ = mini_win.emit("mini-will-close", &token);
                                        let _ = tokio::time::timeout(
                                            std::time::Duration::from_millis(300),
                                            rx,
                                        ).await;
                                        app.unlisten(eid);
                                        let _ = mini_win.close();
                                    }
                                }
                            }
                        });
                    }
                    // Émettre win-state pour mettre à jour le bouton maximize
                    WindowEvent::Resized(_) => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let state_str = if w.is_maximized().unwrap_or(false) {
                                "maximized"
                            } else if w.is_fullscreen().unwrap_or(false) {
                                "fullscreen"
                            } else {
                                "normal"
                            };
                            let _ = w.emit("win-state", state_str);
                        }
                    }
                    WindowEvent::Destroyed => {
                        #[cfg(target_os = "windows")]
                        taskbar::cleanup();
                    }
                    _ => {}
                }
            });

            } else {
                eprintln!("[setup] fenêtre main introuvable — window events non enregistrés");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("[LibreFlow] Erreur fatale au démarrage : {e}");
            std::process::exit(1);
        });
}
