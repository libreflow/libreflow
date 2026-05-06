// watch.rs — Surveillance native du dossier musique via notify
//
// Remplace le polling setTimeout de watchfolder.js par une surveillance
// événementielle O(0) CPU : le watcher reçoit les événements du système de fichiers
// et émet "watch-new-files" vers le frontend uniquement quand des fichiers audio
// sont créés ou déplacés dans le dossier surveillé.
//
// Avantages vs polling :
//   • Zéro CPU en veille (pas de scan_folder toutes les N secondes)
//   • Détection quasi-immédiate (< 100ms sur NTFS)
//   • Pas de timeout NAS — si le NAS est déconnecté, notify retourne une erreur
//     propre au lieu de hang silencieux

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "aac", "m4a", "ogg", "opus",
    "wav", "wma", "aiff", "ape", "alac",
];

/// État global : watcher actif (ou None si surveillance désactivée).
/// Droppé automatiquement quand on en crée un nouveau ou quand watch_folder_stop est appelé.
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

/// Démarre la surveillance native du dossier `path`.
/// Arrête tout watcher existant avant d'en créer un nouveau.
/// Émet l'événement Tauri `"watch-new-files"` (payload: Vec<String>) sur création de fichier audio.
#[tauri::command]
pub fn watch_folder_start(app: AppHandle, path: String) -> Result<(), String> {
    // Arrêter le watcher précédent (drop = arrêt automatique)
    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().map_err(|e| e.to_string())? = None;
    }

    let app_clone = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };

            // Filtrer : uniquement les créations et renommages (déplacement vers le dossier)
            let is_create = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
            );
            if !is_create { return; }

            let new_files: Vec<String> = event.paths.iter()
                .filter(|p| {
                    p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .filter_map(|p| p.to_str().map(String::from))
                .collect();

            if new_files.is_empty() { return; }

            if let Some(win) = app_clone.get_webview_window("main") {
                let _ = win.emit("watch-new-files", &new_files);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Erreur init watcher : {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Erreur démarrage surveillance : {e}"))?;

    // Stocker pour maintenir le watcher en vie
    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    }

    Ok(())
}

/// Arrête la surveillance (drop du watcher).
#[tauri::command]
pub fn watch_folder_stop(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<WatchState>() {
        *state.0.lock().map_err(|e| e.to_string())? = None;
    }
    Ok(())
}
