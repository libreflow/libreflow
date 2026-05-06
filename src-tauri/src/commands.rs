// commands.rs — Commandes IPC Tauri pour LibreFlow
//
// Toutes les commandes exposées au frontend via invoke().
// Chaque commande correspond à une action native : dialogue fichier, tags audio,
// lecture/écriture FS, contrôle fenêtre, notifications OS, taskbar Windows.

use base64::{engine::general_purpose, Engine as _};
use lofty::{
    config::WriteOptions,
    picture::{MimeType, Picture, PictureType},
    prelude::*,
    probe::Probe,
    tag::{ItemKey, Tag},
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

// ── Constantes ────────────────────────────────────────────────────────────────

const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "aac", "m4a", "ogg", "opus",
    "wav", "wma", "aiff", "ape", "alac",
];

// ── Types de données IPC ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OpenFolderResult {
    pub folder: String,
    pub files:  Vec<String>,
}

#[derive(Deserialize)]
pub struct WriteTagsData {
    pub path:         String,
    pub title:        String,
    pub artist:       String,
    pub album:        String,
    pub genre:        String,
    pub year:         Option<u32>,
    pub track_number: Option<u32>,
}

#[derive(Deserialize)]
pub struct NotifyTrackData {
    pub title:  String,
    pub artist: String,
    #[allow(dead_code)] // reçu depuis le frontend mais non utilisé côté Rust (pas d'icône notif)
    pub art:    Option<String>,
}

#[derive(Deserialize)]
pub struct WriteCoverData {
    pub audio_path: String,
    pub image_path: String,
}

#[derive(Deserialize)]
pub struct WriteReplaygainData {
    pub path:    String,
    pub gain_db: f64,
    pub peak:    f64,
}

#[derive(Serialize)]
pub struct AudioProps {
    pub bitrate:     Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels:    Option<u8>,
    pub bit_depth:   Option<u8>,
}

// ── Helpers internes ──────────────────────────────────────────────────────────

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Scan récursif synchrone d'un dossier — retourne tous les fichiers audio trouvés.
fn scan_dir(dir: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return results; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            results.extend(scan_dir(&path));
        } else if is_audio(&path) {
            results.push(path);
        }
    }
    results
}

/// Retourne ou crée le tag principal d'un TaggedFile.
fn get_or_create_primary_tag(tagged_file: &mut lofty::file::TaggedFile) -> Result<&mut Tag, String> {
    if tagged_file.primary_tag().is_none() {
        let tag_type = tagged_file.primary_tag_type();
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    tagged_file.primary_tag_mut()
        .ok_or_else(|| "Impossible d'accéder au tag principal".to_string())
}

// ── Commandes : fichiers et dossiers ─────────────────────────────────────────

/// Ouvre un dialog de sélection de dossier, scanne les fichiers audio et retourne
/// `{ folder, files }`.  Retourne `null` si l'utilisateur annule.
#[tauri::command]
pub fn open_folder(app: AppHandle) -> Result<Option<OpenFolderResult>, String> {
    let Some(folder_path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };

    let folder_str = folder_path.to_string();
    let dir = PathBuf::from(&folder_str);

    let raw_paths = scan_dir(&dir);
    let files: Vec<String> = raw_paths
        .into_par_iter()
        .filter_map(|p| p.to_str().map(String::from))
        .collect();

    Ok(Some(OpenFolderResult { folder: folder_str, files }))
}

/// Scanne un dossier (chemin explicite) et retourne la liste des fichiers audio.
/// Utilisé pour les re-scans sans dialog.
#[tauri::command]
pub fn scan_folder(path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Pas un dossier valide : {path}"));
    }
    let raw_paths = scan_dir(dir);
    let files = raw_paths
        .into_par_iter()
        .filter_map(|p| p.to_str().map(String::from))
        .collect();
    Ok(files)
}

/// Lit un fichier et retourne son contenu encodé en base64.
/// Utilisé pour charger les fichiers audio afin de lire leurs tags via JS.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("read_file({path}): {e}"))?;
    Ok(general_purpose::STANDARD.encode(&data))
}

/// Vérifie si un fichier existe sur le système de fichiers.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Vérifie une liste de chemins et retourne ceux qui n'existent plus (orphelins).
#[tauri::command]
pub fn check_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_par_iter()
        .filter(|p| !Path::new(p).exists())
        .collect()
}

/// Retourne les propriétés audio d'un fichier (bitrate, sample rate, canaux, bit depth).
#[tauri::command]
pub fn read_audio_props(path: String) -> Result<AudioProps, String> {
    let tagged_file = Probe::open(Path::new(&path))
        .map_err(|e| format!("Probe::open({path}): {e}"))?
        .read()
        .map_err(|e| format!("read({path}): {e}"))?;

    let props = tagged_file.properties();
    Ok(AudioProps {
        bitrate:     props.overall_bitrate(),
        sample_rate: props.sample_rate(),
        channels:    props.channels(),
        bit_depth:   props.bit_depth(),
    })
}

/// Autorise l'accès au protocole asset:// pour un dossier donné à l'exécution.
/// Appelé après la sélection d'un dossier de surveillance pour étendre le scope.
#[tauri::command]
pub fn allow_asset_dir(app: AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(Path::new(&path), true)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Commandes : sélecteurs de fichiers ───────────────────────────────────────

/// Ouvre un sélecteur d'image et retourne le chemin sélectionné (ou null si annulé).
#[tauri::command]
pub fn pick_image(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

/// Ouvre un sélecteur de fichier audio et retourne le chemin (ou null si annulé).
#[tauri::command]
pub fn pick_audio_file(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Audio", AUDIO_EXTS)
        .blocking_pick_file()
        .map(|p| p.to_string())
}

// ── Commandes : tags audio ────────────────────────────────────────────────────

/// Écrit les métadonnées textuelles (titre, artiste, album, genre, année, piste)
/// dans un fichier audio via lofty.  Les erreurs sont non-fatales côté JS.
#[tauri::command]
pub fn write_tags(data: WriteTagsData) -> Result<(), String> {
    let path = Path::new(&data.path);
    let mut tagged_file = Probe::open(path)
        .map_err(|e| format!("Probe::open: {e}"))?
        .read()
        .map_err(|e| format!("read: {e}"))?;

    {
        let tag = get_or_create_primary_tag(&mut tagged_file)?;
        tag.set_title(data.title);
        tag.set_artist(data.artist);
        tag.set_album(data.album);
        tag.set_genre(data.genre);
        if let Some(year) = data.year  { tag.set_year(year); }
        if let Some(track) = data.track_number { tag.set_track(track); }
    }

    tagged_file
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("save: {e}"))
}

/// Écrit une image de pochette dans un fichier audio.
/// `audio_path` = chemin du fichier audio, `image_path` = chemin de l'image source.
#[tauri::command]
pub fn write_cover(data: WriteCoverData) -> Result<(), String> {
    let image_data = fs::read(&data.image_path)
        .map_err(|e| format!("Lecture image ({}) : {e}", data.image_path))?;

    let mime = match Path::new(&data.image_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("png")  => MimeType::Png,
        Some("jpg") | Some("jpeg") => MimeType::Jpeg,
        Some("bmp")  => MimeType::Bmp,
        Some("gif")  => MimeType::Gif,
        Some("tiff") | Some("tif") => MimeType::Tiff,
        _            => MimeType::Unknown("image/webp".into()),
    };

    let picture = Picture::new_unchecked(
        PictureType::CoverFront,
        Some(mime),
        None,
        image_data,
    );

    let audio_path = Path::new(&data.audio_path);
    let mut tagged_file = Probe::open(audio_path)
        .map_err(|e| format!("Probe::open: {e}"))?
        .read()
        .map_err(|e| format!("read: {e}"))?;

    {
        let tag = get_or_create_primary_tag(&mut tagged_file)?;
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(picture);
    }

    tagged_file
        .save_to_path(audio_path, WriteOptions::default())
        .map_err(|e| format!("save: {e}"))
}

/// Écrit les tags ReplayGain (gain en dB et peak normalisé) dans un fichier audio.
#[tauri::command]
pub fn write_replaygain_tags(data: WriteReplaygainData) -> Result<(), String> {
    let path = Path::new(&data.path);
    let mut tagged_file = Probe::open(path)
        .map_err(|e| format!("Probe::open: {e}"))?
        .read()
        .map_err(|e| format!("read: {e}"))?;

    let gain_str = format!("{:+.2} dB", data.gain_db);
    let peak_str = format!("{:.6}", data.peak);

    {
        let tag = get_or_create_primary_tag(&mut tagged_file)?;
        tag.insert_text(ItemKey::ReplayGainTrackGain, gain_str);
        tag.insert_text(ItemKey::ReplayGainTrackPeak, peak_str);
    }

    tagged_file
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("save: {e}"))
}

// ── Commandes : notifications OS ─────────────────────────────────────────────

/// Envoie une notification OS (nom de la piste + artiste).
/// Silencieuse en cas d'échec — la lecture ne doit pas être bloquée par ça.
#[tauri::command]
pub fn notify_track(app: AppHandle, data: NotifyTrackData) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&data.title)
        .body(&data.artist)
        .show()
        .map_err(|e| e.to_string())
}

// ── Commandes : contrôle de fenêtre ──────────────────────────────────────────

/// Ferme la fenêtre principale (et donc l'application).
#[tauri::command]
pub fn win_close(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre main introuvable".to_string())?
        .close()
        .map_err(|e| e.to_string())
}

/// Réduit la fenêtre principale et ouvre le mini-player flottant.
#[tauri::command]
pub async fn win_minimize(app: AppHandle) -> Result<(), String> {
    // Ouvrir le mini-player (guard interne : idempotent si déjà ouvert)
    let _ = crate::mini::open_mini(&app).await;
    // Réduire la fenêtre principale
    app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre main introuvable".to_string())?
        .minimize()
        .map_err(|e| e.to_string())
}

/// Bascule l'état maximisé / normal de la fenêtre principale.
/// Appelé aussi pour passer en plein écran (F11 côté JS).
#[tauri::command]
pub fn win_maximize(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre main introuvable".to_string())?;
    if win.is_maximized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

/// Modifie le titre de la fenêtre principale (ex: "Titre — Artiste | LibreFlow").
#[tauri::command]
pub fn win_set_title(app: AppHandle, title: String) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre main introuvable".to_string())?
        .set_title(&title)
        .map_err(|e| e.to_string())
}

// ── Commandes : thumbnail toolbar Windows ────────────────────────────────────

/// Met à jour l'icône Play / Pause dans la thumbnail toolbar Windows.
#[tauri::command]
pub fn taskbar_set_playing(playing: bool) {
    #[cfg(target_os = "windows")]
    crate::taskbar::update_play_state(playing);
    #[cfg(not(target_os = "windows"))]
    let _ = playing;
}

/// Active ou désactive les boutons Prev/Next/Play de la thumbnail toolbar Windows.
#[tauri::command]
pub fn taskbar_set_has_tracks(has_tracks: bool) {
    #[cfg(target_os = "windows")]
    crate::taskbar::update_has_tracks(has_tracks);
    #[cfg(not(target_os = "windows"))]
    let _ = has_tracks;
}

// ── Commandes : DevTools ──────────────────────────────────────────────────────

/// Ouvre les DevTools du WebView (F12 côté JS).
/// Disponible uniquement en debug (feature "devtools" dans Cargo.toml).
#[tauri::command]
pub fn open_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
}
