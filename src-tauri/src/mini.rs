// mini.rs — Mini-player Tauri

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder};

pub struct MiniState(pub tokio::sync::Mutex<Option<Value>>);
pub struct MiniOpenGuard(pub(crate) tokio::sync::Mutex<()>);

#[tauri::command]
pub async fn mini_toggle(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.close().map_err(|e| e.to_string())?;
    } else {
        open_mini(&app).await?;
    }
    Ok(())
}

/// Ouvre le mini-player centré en bas de l'écran.
/// Appelé aussi depuis commands.rs lors de la réduction de la fenêtre principale.
/// Protégé contre le TOCTOU : un mutex tokio sérialise les appels concurrents afin qu'un seul
/// appel puisse passer le check `get_webview_window` et appeler `create_mini_window`.
/// Panique immédiatement si `MiniOpenGuard` n'est pas géré (fail-fast à l'initialisation).
pub async fn open_mini(app: &AppHandle) -> Result<(), String> {
    let guard = app.state::<MiniOpenGuard>();
    let _lock = guard.0.lock().await;
    do_open(app)
}

fn do_open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("mini") {
        if let Err(e) = w.show() {
            eprintln!("[mini:do_open] show failed: {e}");
        }
        if let Err(e) = w.set_focus() {
            eprintln!("[mini:do_open] set_focus failed: {e}");
        }
        return Ok(());
    }
    create_mini_window(app)
}

fn create_mini_window(app: &AppHandle) -> Result<(), String> {
    let mini = WebviewWindowBuilder::new(app, "mini", tauri::WebviewUrl::App("mini.html".into()))
        .title("LibreFlow Mini")
        .inner_size(280.0, 360.0)
        .min_inner_size(220.0, 260.0)
        .max_inner_size(400.0, 520.0)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Positionner en bas de l'écran, centré horizontalement
    if let Ok(Some(monitor)) = mini.current_monitor() {
        let screen_w = monitor.size().width as f64;
        let screen_h = monitor.size().height as f64;
        let scale = monitor.scale_factor();

        // Taille logique du mini (pixels indépendants de la densité)
        let mini_w = 280.0_f64;
        let mini_h = 360.0_f64;
        let margin = 20.0_f64; // marge avec le bord bas de l'écran

        // Centré horizontalement, collé en bas
        let x = ((screen_w / scale) - mini_w) / 2.0 * scale;
        let y = ((screen_h / scale) - mini_h - margin) * scale;

        if let Err(e) = mini.set_position(tauri::PhysicalPosition::new(x as i32, y as i32)) {
            eprintln!("[mini:create] set_position failed: {e}");
        }
    }

    // L'état initial est récupéré par mini.html via invoke('mini_get_state') au chargement.
    // Pas besoin d'émettre depuis ici — évite une race condition si le webview n'est pas prêt.

    Ok(())
}

/// Ferme le mini-player et restaure la fenêtre principale.
/// Appelé depuis mini.html via le bouton fermer.
#[tauri::command]
pub async fn mini_close(app: AppHandle) -> Result<(), String> {
    // Fermer le mini
    if let Some(mini_win) = app.get_webview_window("mini") {
        mini_win.close().map_err(|e| e.to_string())?;
    }
    // Restaurer la fenêtre principale
    if let Some(main_win) = app.get_webview_window("main") {
        if let Err(e) = main_win.unminimize() {
            eprintln!("[mini_close] unminimize failed: {e}");
        }
        // Remettre une taille raisonnable si la fenêtre était minimisée
        // (le plugin window-state restaure la dernière taille connue,
        //  mais après unminimize la fenêtre reste parfois à taille nulle)
        let current = main_win.inner_size().ok();
        let needs_resize = current
            .map(|s| s.width < 400 || s.height < 300)
            .unwrap_or(true);
        if needs_resize {
            if let Err(e) = main_win.set_size(tauri::LogicalSize::new(1100.0_f64, 700.0_f64)) {
                eprintln!("[mini_close] set_size failed: {e}");
            }
            // Centrer sur le moniteur courant
            if let Ok(Some(monitor)) = main_win.current_monitor() {
                let sw = monitor.size().width as f64 / monitor.scale_factor();
                let sh = monitor.size().height as f64 / monitor.scale_factor();
                let x = ((sw - 1100.0) / 2.0 * monitor.scale_factor()) as i32;
                let y = ((sh - 700.0) / 2.0 * monitor.scale_factor()) as i32;
                if let Err(e) = main_win.set_position(tauri::PhysicalPosition::new(x, y)) {
                    eprintln!("[mini_close] set_position failed: {e}");
                }
            }
        }
        if let Err(e) = main_win.set_focus() {
            eprintln!("[mini_close] set_focus failed: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_update(app: AppHandle, data: Value) -> Result<(), String> {
    *app.state::<MiniState>().0.lock().await = Some(data.clone());
    if let Some(win) = app.get_webview_window("mini") {
        if let Err(e) = win.emit("mini-update", &data) {
            eprintln!("[mini_update] emit failed: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_progress(app: AppHandle, data: Value) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        if let Err(e) = win.emit("mini-progress", &data) {
            eprintln!("[mini_progress] emit failed: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_get_state(app: AppHandle) -> Option<Value> {
    app.state::<MiniState>().0.lock().await.clone()
}
