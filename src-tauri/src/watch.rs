// watch.rs — Surveillance native du dossier musique via notify
//
// Remplace le polling setTimeout de watchfolder.js par une surveillance
// événementielle O(0) CPU : le watcher reçoit les événements du système de fichiers
// et émet "watch-new-files" (création/déplacement) et "watch-modified-files"
// (modification de contenu) vers le frontend pour les fichiers audio uniquement.
//
// Avantages vs polling :
//   • Zéro CPU en veille (pas de scan_folder toutes les N secondes)
//   • Détection quasi-immédiate (< 100ms sur NTFS)
//   • Pas de timeout NAS — si le NAS est déconnecté, notify retourne une erreur
//     propre au lieu de hang silencieux

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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
    // Valider et canonicaliser le chemin avant de démarrer le watcher
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("watch_folder_start: pas un dossier valide — {path}"));
    }
    let canon = std::fs::canonicalize(dir)
        .map_err(|e| format!("watch_folder_start: chemin invalide — {e}"))?;
    if !crate::commands::is_safe_dir(&canon) {
        return Err(format!("watch_folder_start: répertoire système refusé — {path}"));
    }

    // Arrêter le watcher précédent (drop = arrêt automatique)
    let state = app.state::<WatchState>();
    *state.0.lock().map_err(|e| e.to_string())? = None;

    let app_clone = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => { eprintln!("[watch] watcher error: {:?}", e); return; }
            };

            let is_create = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
            );
            let is_modify = matches!(
                event.kind,
                EventKind::Modify(notify::event::ModifyKind::Data(_))
            );

            if !is_create && !is_modify { return; }

            // Filtre audio partagé — même liste AUDIO_EXTS existante
            let audio_paths: Vec<String> = event.paths.iter()
                .filter(|p| {
                    p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .filter_map(|p| p.to_str().map(String::from))
                .collect();

            if audio_paths.is_empty() { return; }

            if let Some(win) = app_clone.get_webview_window("main") {
                if is_create {
                    let _ = win.emit("watch-new-files", &audio_paths);
                }
                if is_modify {
                    let _ = win.emit("watch-modified-files", &audio_paths);
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Erreur init watcher : {e}"))?;

    watcher
        .watch(&canon, RecursiveMode::Recursive)
        .map_err(|e| format!("Erreur démarrage surveillance : {e}"))?;

    // Stocker pour maintenir le watcher en vie
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);

    Ok(())
}

/// Arrête la surveillance (drop du watcher).
#[tauri::command]
pub fn watch_folder_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WatchState>();
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
