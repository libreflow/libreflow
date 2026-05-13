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
use tokio::time::{timeout, Duration};

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
    pub bitrate:      Option<u32>,
    pub sample_rate:  Option<u32>,
    pub channels:     Option<u8>,
    pub bit_depth:    Option<u8>,
    pub file_size:    Option<u64>,  // bytes
    pub duration_secs: Option<f64>,
}

/// Retourne tous les champs utiles d'un fichier audio en un seul passage lofty.
/// Remplace read_file (fichier complet en base64) + JS readTags() + read_audio_props×2 :
/// 3 IPC et jusqu'à 50 Mo de transfert → 1 IPC, transfert limité à la pochette (~200 Ko).
#[derive(Serialize, Default)]
pub struct TrackTags {
    pub title:         Option<String>,
    pub artist:        Option<String>,
    pub album:         Option<String>,
    pub genre:         Option<String>,
    pub year:          Option<u32>,
    pub track:         Option<u32>,
    pub cover_base64:  Option<String>,
    pub cover_mime:    Option<String>,
    pub bitrate:       Option<u32>,
    pub sample_rate:   Option<u32>,
    pub channels:      Option<u8>,
    pub bit_depth:     Option<u8>,
    pub duration_secs: Option<f64>,
    pub file_size:     Option<u64>,
}

// ── Helpers internes ──────────────────────────────────────────────────────────

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Vérifie qu'un chemin n'est pas une racine système dangereuse.
pub(crate) fn is_safe_dir(path: &Path) -> bool {
    use std::path::Component;

    // Rejeter racine Unix bare "/"
    if path == Path::new("/") { return false; }

    // Rejeter les racines de lecteur Windows : C:\, D:\, etc.
    // Un chemin racine Windows = Prefix(C:) + RootDir, sans aucun composant supplémentaire.
    {
        let mut comps = path.components();
        let first  = comps.next();
        let second = comps.next();
        let third  = comps.next();
        if matches!(first, Some(Component::Prefix(_)))
            && matches!(second, Some(Component::RootDir))
            && third.is_none()
        {
            return false;
        }
    }

    // Rejeter chemins Unix système connus
    let blocked = &[
        "/etc", "/usr", "/bin", "/sbin", "/lib", "/boot",
        "/dev", "/proc", "/sys", "/root", "/var/log", "/var/run",
    ];
    let path_str = path.to_string_lossy().to_lowercase();
    if blocked.iter().any(|b| path_str == *b || path_str.starts_with(&format!("{}/", b))) {
        return false;
    }

    // Exiger au moins un composant non-root (depth > 1 sur Unix, > 2 sur Windows)
    if path.components().count() <= 1 { return false; }

    true
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
    let canon = fs::canonicalize(&folder_str)
        .map_err(|e| format!("open_folder: résolution du chemin échouée — {e}"))?;
    if !is_safe_dir(&canon) {
        return Err(format!("open_folder: chemin système refusé — {folder_str}"));
    }

    let raw_paths = scan_dir(&canon);
    let files: Vec<String> = raw_paths
        .into_par_iter()
        .filter_map(|p| p.to_str().map(String::from))
        .collect();

    Ok(Some(OpenFolderResult { folder: folder_str, files }))
}


/// Vérifie une liste de chemins et retourne ceux qui n'existent plus (orphelins).
#[tauri::command]
pub fn check_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_par_iter()
        .filter(|p| !Path::new(p).exists())
        .collect()
}

/// Retourne les propriétés audio d'un fichier (bitrate, sample rate, canaux, bit depth, taille).
/// Async avec spawn_blocking pour éviter de bloquer le thread Tauri sur les gros fichiers.
#[tauri::command]
pub async fn read_audio_props(path: String) -> Option<AudioProps> {
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        if !is_audio(p) { return None; }
        let canon = std::fs::canonicalize(p).ok()?;
        if !is_audio(&canon) { return None; }
        let file_size = std::fs::metadata(&canon).map(|m| m.len()).ok();
        let tagged = Probe::open(&canon)
            .ok()?
            .guess_file_type()
            .ok()?
            .read()
            .ok()?;
        let props = tagged.properties();
        let duration_secs = {
            let d = props.duration().as_secs_f64();
            if d > 0.0 { Some(d) } else { None }
        };
        Some(AudioProps {
            bitrate:      props.overall_bitrate(),
            sample_rate:  props.sample_rate(),
            channels:     props.channels(),
            bit_depth:    props.bit_depth(),
            file_size,
            duration_secs,
        })
    })
    .await
    .unwrap_or(None)
}

/// Autorise l'accès au protocole asset:// pour un dossier donné à l'exécution.
/// Appelé après la sélection d'un dossier de surveillance pour étendre le scope.
#[tauri::command]
pub fn allow_asset_dir(app: AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path);
    if !dir.is_dir() || !is_safe_dir(dir) {
        return Err(format!("allow_asset_dir: chemin refusé — {path}"));
    }
    app.asset_protocol_scope()
        .allow_directory(dir, true)
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

/// Lit les tags audio et les propriétés techniques d'un fichier en un seul passage lofty.
/// Remplace : read_file (fichier complet en base64) + JS readTags() + read_audio_props×2.
/// Gain : 3 IPC et jusqu'à 50 Mo de transfert → 1 IPC, uniquement la pochette (~200 Ko).
/// Un timeout de 8 s protège contre les fichiers corrompus qui bloquent Probe::open().
#[tauri::command]
pub async fn read_tags(path: String) -> Result<Option<TrackTags>, String> {
    let path_clone = path.clone();
    let result = timeout(
        Duration::from_secs(8),
        tokio::task::spawn_blocking(move || {
            let p = Path::new(&path);
            if !is_audio(p) { return None; }
            let canon = std::fs::canonicalize(p).ok()?;
            if !is_audio(&canon) { return None; }
            if let Some(parent) = canon.parent() {
                if !is_safe_dir(parent) { return None; }
            }
            let file_size = std::fs::metadata(&canon).map(|m| m.len()).ok();

            let tagged = Probe::open(&canon)
                .ok()?
                .guess_file_type()
                .ok()?
                .read()
                .ok()?;

            // Extraire les propriétés audio dans un bloc pour libérer l'emprunt avant primary_tag
            let (duration_secs, bitrate, sample_rate, channels, bit_depth) = {
                let props = tagged.properties();
                let d = props.duration().as_secs_f64();
                (
                    if d > 0.0 { Some(d) } else { None },
                    props.overall_bitrate(),
                    props.sample_rate(),
                    props.channels(),
                    props.bit_depth(),
                )
            };

            let (title, artist, album, genre, year, track, cover_base64, cover_mime) =
                tagged.primary_tag()
                    .map(|tag| {
                        let title  = tag.title().map(|s| s.into_owned());
                        let artist = tag.artist().map(|s| s.into_owned());
                        let album  = tag.album().map(|s| s.into_owned());
                        let genre  = tag.genre().map(|s| s.into_owned());
                        let year   = tag.year();
                        let track  = tag.track();
                        // Pochette : CoverFront en priorité, sinon première image disponible.
                        // Limite 2 Mo : évite de transférer des pochettes hi-res en base64.
                        const MAX_COVER: usize = 2 * 1024 * 1024;
                        let (cover_b64, cover_m) = tag.pictures()
                            .iter()
                            .find(|pic| pic.pic_type() == PictureType::CoverFront)
                            .or_else(|| tag.pictures().first())
                            .filter(|pic| pic.data().len() <= MAX_COVER)
                            .map(|pic| {
                                let b64 = general_purpose::STANDARD.encode(pic.data());
                                let mime = match pic.mime_type() {
                                    Some(MimeType::Png)  => "image/png",
                                    Some(MimeType::Gif)  => "image/gif",
                                    Some(MimeType::Bmp)  => "image/bmp",
                                    Some(MimeType::Tiff) => "image/tiff",
                                    _                    => "image/jpeg",
                                };
                                (Some(b64), Some(mime.to_string()))
                            })
                            .unwrap_or((None, None));
                        (title, artist, album, genre, year, track, cover_b64, cover_m)
                    })
                    .unwrap_or_default();

            Some(TrackTags {
                title, artist, album, genre, year, track,
                cover_base64, cover_mime,
                bitrate, sample_rate, channels, bit_depth,
                duration_secs, file_size,
            })
        }),
    )
    .await;

    match result {
        Err(_elapsed) => Err(format!("read_tags timeout: {:?}", path_clone)),
        Ok(Err(join_err)) => Err(format!("read_tags join error: {join_err}")),
        Ok(Ok(inner)) => Ok(inner),
    }
}

/// Écrit les métadonnées textuelles (titre, artiste, album, genre, année, piste)
/// dans un fichier audio via lofty.  Les erreurs sont non-fatales côté JS.
#[tauri::command]
pub async fn write_tags(data: WriteTagsData) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&data.path);
        if !is_audio(path) {
            return Err(format!("write_tags: extension non autorisée — {}", data.path));
        }
        let canon = fs::canonicalize(path)
            .map_err(|e| format!("write_tags: chemin invalide — {e}"))?;
        if !is_audio(&canon) {
            return Err(format!("write_tags: extension non autorisée après résolution — {}", data.path));
        }
        let mut tagged_file = Probe::open(&canon)
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
            .save_to_path(&canon, WriteOptions::default())
            .map_err(|e| format!("save: {e}"))
    })
    .await
    .unwrap_or_else(|e| Err(format!("write_tags: spawn_blocking paniqué — {e}")))
}

/// Écrit une image de pochette dans un fichier audio.
/// `audio_path` = chemin du fichier audio, `image_path` = chemin de l'image source.
#[tauri::command]
pub async fn write_cover(data: WriteCoverData) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let audio_path = Path::new(&data.audio_path);
        if !is_audio(audio_path) {
            return Err(format!("write_cover: audio path non autorisé — {}", data.audio_path));
        }
        let canon_audio = fs::canonicalize(audio_path)
            .map_err(|e| format!("write_cover: chemin audio invalide — {e}"))?;
        if !is_audio(&canon_audio) {
            return Err(format!("write_cover: extension audio non autorisée après résolution — {}", data.audio_path));
        }
        const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif"];
        let image_path_raw = Path::new(&data.image_path);
        let image_ext_raw = image_path_raw
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());
        if !image_ext_raw.as_deref().map(|e| IMAGE_EXTS.contains(&e)).unwrap_or(false) {
            return Err(format!("write_cover: image path non autorisé — {}", data.image_path));
        }
        let canon_image = fs::canonicalize(image_path_raw)
            .map_err(|e| format!("write_cover: chemin image invalide — {e}"))?;
        let canon_image_ext = canon_image
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());
        if !canon_image_ext.as_deref().map(|e| IMAGE_EXTS.contains(&e)).unwrap_or(false) {
            return Err(format!("write_cover: extension image non autorisée après résolution — {}", data.image_path));
        }

        let image_data = fs::read(&canon_image)
            .map_err(|e| format!("Lecture image ({}) : {e}", data.image_path))?;

        // Magic-byte MIME validation — no new crate needed
        let ext = canon_image_ext.as_deref().unwrap_or("");
        let mime_ok = match ext {
            "jpg" | "jpeg" => image_data.starts_with(&[0xFF, 0xD8, 0xFF]),
            "png"          => image_data.starts_with(&[0x89, 0x50, 0x4E, 0x47]),
            "webp"         => image_data.len() >= 12 && &image_data[8..12] == b"WEBP",
            _              => true, // unknown ext — pass through
        };
        if !mime_ok {
            return Err(format!(
                "write_cover: file magic bytes do not match extension {:?}", ext
            ));
        }

        // lofty n'a pas de variant MimeType::Webp — MimeType::Unknown est la représentation correcte.
        let mime = match canon_image_ext.as_deref() {
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

        let mut tagged_file = Probe::open(&canon_audio)
            .map_err(|e| format!("Probe::open: {e}"))?
            .read()
            .map_err(|e| format!("read: {e}"))?;

        {
            let tag = get_or_create_primary_tag(&mut tagged_file)?;
            tag.remove_picture_type(PictureType::CoverFront);
            tag.push_picture(picture);
        }

        tagged_file
            .save_to_path(&canon_audio, WriteOptions::default())
            .map_err(|e| format!("save: {e}"))
    })
    .await
    .unwrap_or_else(|e| Err(format!("write_cover: spawn_blocking paniqué — {e}")))
}

/// Écrit les tags ReplayGain (gain en dB et peak normalisé) dans un fichier audio.
#[tauri::command]
pub async fn write_replaygain_tags(data: WriteReplaygainData) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&data.path);
        if !is_audio(path) {
            return Err(format!("write_replaygain_tags: extension non autorisée — {}", data.path));
        }
        let canon = fs::canonicalize(path)
            .map_err(|e| format!("write_replaygain_tags: chemin invalide — {e}"))?;
        if !is_audio(&canon) {
            return Err(format!("write_replaygain_tags: extension non autorisée après résolution — {}", data.path));
        }
        let mut tagged_file = Probe::open(&canon)
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
            .save_to_path(&canon, WriteOptions::default())
            .map_err(|e| format!("save: {e}"))
    })
    .await
    .unwrap_or_else(|e| Err(format!("write_replaygain_tags: spawn_blocking paniqué — {e}")))
}

// ── Commandes : notifications OS ─────────────────────────────────────────────

/// Envoie une notification OS (nom de la piste + artiste).
/// Silencieuse en cas d'échec — la lecture ne doit pas être bloquée par ça.
#[tauri::command]
pub fn notify_track(app: AppHandle, data: NotifyTrackData) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let title  = data.title.chars().take(100).collect::<String>();
    let artist = data.artist.chars().take(100).collect::<String>();
    app.notification()
        .builder()
        .title(&title)
        .body(&artist)
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
#[cfg(debug_assertions)]
#[tauri::command]
pub fn open_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
}
