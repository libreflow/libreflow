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

/// Liste partagée des extensions audio reconnues par LibreFlow.
/// Source unique de vérité côté backend — référencée par les commandes
/// scan/pick locales ET par `watch.rs` (filtrage des événements notify).
pub(crate) const AUDIO_EXTS: &[&str] = &[
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

// ── Types : organisation de fichiers ─────────────────────────────────────────

/// Un déplacement planifié : chemin source → chemin cible.
#[derive(Deserialize)]
pub struct OrganizeMoveEntry {
    pub from: String,
    pub to:   String,
}

/// Résultat d'un déplacement individuel.
#[derive(Serialize)]
pub struct OrganizeMoveResult {
    pub from:  String,
    pub to:    String,
    pub ok:    bool,
    pub error: Option<String>,
}

/// Résultat global de la commande organize_files.
#[derive(Serialize)]
pub struct OrganizeResult {
    pub moves:       Vec<OrganizeMoveResult>,
    pub error_count: usize,
}

// ── Types : détection de lecteurs ─────────────────────────────────────────────

/// Informations sur un volume monté.
#[derive(Serialize, Clone)]
pub struct DriveInfo {
    /// Chemin racine du volume (ex: "C:\\", "/Volumes/USB")
    pub path:  String,
    /// Label du volume (ex: "USB DRIVE", "Macintosh HD")
    pub label: String,
    /// Type de lecteur : "fixed" | "removable" | "network" | "cdrom" | "unknown"
    pub kind:  String,
    /// True si CDROM avec au moins une piste audio (Windows uniquement, sinon false).
    #[serde(default)]
    pub audio_cd: bool,
    /// Nombre de pistes audio (0 si pas un CD audio).
    #[serde(default)]
    pub track_count: u8,
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

    // Rejeter chemins Windows système connus et chemins UNC
    #[cfg(target_os = "windows")]
    {
        // fs::canonicalize() sur Windows ajoute le préfixe \\?\ (extended-length path local).
        // Normaliser avant comparaison pour que les chemins système soient correctement bloqués.
        let check_str: &str = path_str.strip_prefix("\\\\?\\").unwrap_or(&path_str);
        let win_blocked = ["c:\\windows", "c:\\program files", "c:\\program files (x86)"];
        if win_blocked.iter().any(|b| check_str == *b || check_str.starts_with(&format!("{}\\", b))) {
            return false;
        }
        // Bloquer les vrais chemins UNC réseau (\\server\share).
        // Ne PAS bloquer \\?\ qui est le préfixe extended-length pour les chemins locaux.
        if path_str.starts_with("\\\\") && !path_str.starts_with("\\\\?\\") {
            return false;
        }
    }

    // Exiger au moins un composant non-root (depth > 1 sur Unix, > 2 sur Windows)
    if path.components().count() <= 1 { return false; }

    true
}

/// Scan récursif synchrone d'un dossier — retourne tous les fichiers audio trouvés.
///
/// Garde anti-cycle : suit `fs::canonicalize` sur chaque sous-dossier et bail si déjà visité.
/// Refuse les symlinks ET les reparse points Windows (junctions/mount points) car
/// `Path::is_symlink` retourne `false` pour les junctions, ce qui peut faire boucler le scan.
fn scan_dir(dir: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut visited: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    if let Ok(c) = fs::canonicalize(dir) { visited.insert(c); }
    scan_dir_inner(dir, &mut results, &mut visited, 0);
    results
}

const SCAN_MAX_DEPTH: usize = 32;

fn scan_dir_inner(
    dir: &Path,
    results: &mut Vec<PathBuf>,
    visited: &mut std::collections::HashSet<PathBuf>,
    depth: usize,
) {
    if depth >= SCAN_MAX_DEPTH { return; }
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue; };
        let ft = meta.file_type();

        // Reparse points (junctions / mount points sur Windows) ET symlinks classiques.
        #[cfg(target_os = "windows")]
        let is_reparse = {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
            (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        };
        #[cfg(not(target_os = "windows"))]
        let is_reparse = false;

        if ft.is_symlink() || is_reparse {
            continue;
        }

        if ft.is_dir() {
            // Anti-cycle : canonicalize et insert dans `visited`.
            let Ok(canon) = fs::canonicalize(&path) else { continue; };
            if !visited.insert(canon) { continue; }
            scan_dir_inner(&path, results, visited, depth + 1);
        } else if is_audio(&path) {
            results.push(path);
        }
    }
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

    // Retourner le chemin canonique (résolu) pour que les commandes suivantes opèrent sur
    // le même chemin que celui validé par is_safe_dir. Évite une fenêtre TOCTOU sur symlinks.
    let canon_str = canon.to_string_lossy().to_string();
    Ok(Some(OpenFolderResult { folder: canon_str, files }))
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

        // Cap taille image à 10 MB pour éviter qu'un fichier hostile ou un symlink
        // pointant sur un fichier massif n'alloue plusieurs Go en RAM.
        const MAX_COVER_BYTES: u64 = 10 * 1024 * 1024;
        let meta = fs::metadata(&canon_image)
            .map_err(|e| format!("metadata image ({}) : {e}", data.image_path))?;
        if meta.len() > MAX_COVER_BYTES {
            return Err(format!(
                "write_cover: image trop volumineuse ({} octets, max {})",
                meta.len(), MAX_COVER_BYTES
            ));
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
        // Valider les bornes des valeurs ReplayGain avant toute écriture
        if data.gain_db < -51.0 || data.gain_db > 51.0 {
            return Err("gain_db hors limites (-51..+51 dB)".into());
        }
        if data.peak < 0.0 || data.peak > 1.0 {
            return Err("peak hors limites (0..1)".into());
        }

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
    let title = data.title.chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect::<String>();
    let artist = data.artist.chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect::<String>();
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

// ── Commande : organisation de fichiers ──────────────────────────────────────

/// Détecte ERROR_NOT_SAME_DEVICE (Windows: 17, Unix: EXDEV=18).
/// `fs::rename` échoue avec ce code quand source et destination sont sur des volumes différents.
fn is_cross_device_error(e: &std::io::Error) -> bool {
    if let Some(code) = e.raw_os_error() {
        #[cfg(target_os = "windows")]
        return code == 17;
        #[cfg(not(target_os = "windows"))]
        return code == 18;
    }
    false
}

/// Vérifie qu'un chemin d'organize_files vit dans un dossier autorisé.
/// Refuse `..`, chemins système connus, et chemins vides.
fn validate_organize_path(raw: &str) -> Result<(), String> {
    use std::path::Component;
    if raw.is_empty() { return Err("chemin vide".to_string()); }
    let path = Path::new(raw);
    for c in path.components() {
        if matches!(c, Component::ParentDir) {
            return Err(format!("'..' interdit : {}", raw));
        }
    }
    let parent = path.parent().ok_or_else(|| format!("sans parent : {}", raw))?;
    let mut check = parent.to_path_buf();
    let canon = loop {
        if let Ok(c) = fs::canonicalize(&check) { break c; }
        let Some(up) = check.parent() else {
            return Err(format!("aucun ancêtre existant : {}", raw));
        };
        check = up.to_path_buf();
    };
    if !is_safe_dir(&canon) {
        return Err(format!("dossier système refusé : {}", raw));
    }
    Ok(())
}

/// Déplace des fichiers audio vers une arborescence cible.
///
/// En dry_run = true : valide seulement (source existe, destination libre).
/// En dry_run = false : effectue les rename atomiques; rollback sur première erreur.
#[tauri::command]
pub async fn organize_files(
    moves:   Vec<OrganizeMoveEntry>,
    dry_run: bool,
) -> Result<OrganizeResult, String> {
    // Validation préalable : aucun move ne doit pointer hors d'un dossier autorisé.
    for m in &moves {
        validate_organize_path(&m.from).map_err(|e| format!("from: {}", e))?;
        validate_organize_path(&m.to).map_err(|e| format!("to: {}", e))?;
    }
    tokio::task::spawn_blocking(move || {
        let mut results: Vec<OrganizeMoveResult> = Vec::new();
        let mut error_count = 0usize;

        if dry_run {
            for m in &moves {
                let from = Path::new(&m.from);
                let to   = Path::new(&m.to);

                if !from.exists() {
                    results.push(OrganizeMoveResult {
                        from:  m.from.clone(),
                        to:    m.to.clone(),
                        ok:    false,
                        error: Some(format!("Source introuvable : {}", m.from)),
                    });
                    error_count += 1;
                } else if to.exists() {
                    let same = from.canonicalize().ok() == to.canonicalize().ok();
                    if same {
                        results.push(OrganizeMoveResult {
                            from: m.from.clone(), to: m.to.clone(), ok: true, error: None,
                        });
                    } else {
                        results.push(OrganizeMoveResult {
                            from:  m.from.clone(),
                            to:    m.to.clone(),
                            ok:    false,
                            error: Some(format!("Destination occupée : {}", m.to)),
                        });
                        error_count += 1;
                    }
                } else {
                    results.push(OrganizeMoveResult {
                        from: m.from.clone(), to: m.to.clone(), ok: true, error: None,
                    });
                }
            }
        } else {
            // completed: (new_path, original_path) for rollback
            let mut completed: Vec<(String, String)> = Vec::new();

            'outer: for m in &moves {
                let from = Path::new(&m.from);
                let to   = Path::new(&m.to);

                if from == to {
                    results.push(OrganizeMoveResult {
                        from: m.from.clone(), to: m.to.clone(), ok: true, error: None,
                    });
                    continue;
                }

                if let Some(parent) = to.parent() {
                    if !parent.exists() {
                        if let Err(e) = fs::create_dir_all(parent) {
                            error_count += 1;
                            results.push(OrganizeMoveResult {
                                from:  m.from.clone(),
                                to:    m.to.clone(),
                                ok:    false,
                                error: Some(format!("Création dossier échouée : {e}")),
                            });
                            for (done_to, done_from) in completed.iter().rev() {
                                let _ = fs::rename(done_to, done_from);
                            }
                            break 'outer;
                        }
                    }
                }

                // Tentative atomique via fs::rename, fallback copy+remove sur
                // ERROR_NOT_SAME_DEVICE (rename cross-volume échoue sur Windows).
                let move_res = fs::rename(&m.from, &m.to).or_else(|e| {
                    if is_cross_device_error(&e) {
                        fs::copy(&m.from, &m.to)
                            .and_then(|_| fs::remove_file(&m.from))
                            .map_err(|e2| std::io::Error::new(
                                e2.kind(),
                                format!("rename cross-volume fallback: {e2}"),
                            ))
                    } else {
                        Err(e)
                    }
                });
                match move_res {
                    Ok(_) => {
                        completed.push((m.to.clone(), m.from.clone()));
                        results.push(OrganizeMoveResult {
                            from: m.from.clone(), to: m.to.clone(), ok: true, error: None,
                        });
                    }
                    Err(e) => {
                        error_count += 1;
                        results.push(OrganizeMoveResult {
                            from:  m.from.clone(),
                            to:    m.to.clone(),
                            ok:    false,
                            error: Some(e.to_string()),
                        });
                        // Rollback : tracker les échecs au lieu de les avaler
                        // silencieusement, pour que le frontend voie l'état réel.
                        for (done_to, done_from) in completed.iter().rev() {
                            if let Err(re) = fs::rename(done_to, done_from) {
                                error_count += 1;
                                results.push(OrganizeMoveResult {
                                    from:  done_to.clone(),
                                    to:    done_from.clone(),
                                    ok:    false,
                                    error: Some(format!("rollback failed: {re}")),
                                });
                            }
                        }
                        break 'outer;
                    }
                }
            }
        }

        Ok(OrganizeResult { moves: results, error_count })
    })
    .await
    .map_err(|e| format!("organize_files: spawn_blocking: {e}"))?
}

// ── Sauvegarde & Portabilité ──────────────────────────────────────────────────

/// Ouvre un dialog de sauvegarde .libreflow, puis écrit le ZIP avec les données sérialisées.
/// Retourne le chemin du fichier créé, ou None si l'utilisateur annule.
#[tauri::command]
pub fn export_backup(
    app: AppHandle,
    payload: crate::backup::ExportPayload,
) -> Result<Option<String>, String> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("LibreFlow Backup", &["libreflow"])
        .blocking_save_file()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let dest = fp.to_string();
    // is_safe_dir est un filtre général (bloque racines système, C:\Windows, chemins UNC, etc.)
    // et non un filtre restreint aux bibliothèques audio — il est donc approprié ici.
    // fs::canonicalize n'est pas applicable : le fichier n'existe pas encore (dialog de sauvegarde).
    // On vérifie le dossier parent au lieu (il doit exister et être sûr).
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        if !parent.as_os_str().is_empty() {
            let canon_parent = fs::canonicalize(parent)
                .map_err(|e| format!("export_backup: dossier cible invalide — {e}"))?;
            if !is_safe_dir(&canon_parent) {
                return Err(format!("export_backup: dossier cible refusé (chemin système) — {dest}"));
            }
        }
    }
    crate::backup::write_backup_zip(&dest, &payload)?;
    Ok(Some(dest))
}

/// Ouvre un file picker .libreflow, lit le ZIP et retourne les JSON internes.
/// Retourne None si l'utilisateur annule.
#[tauri::command]
pub fn import_backup(app: AppHandle) -> Result<Option<crate::backup::ImportPayload>, String> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("LibreFlow Backup", &["libreflow"])
        .blocking_pick_file()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let src = fp.to_string();
    // is_safe_dir est un filtre général (bloque racines système, C:\Windows, chemins UNC, etc.)
    // et non un filtre restreint aux bibliothèques audio — il est donc approprié ici.
    // Canonicalize résout les symlinks avant lecture pour éviter les path-traversal.
    let src = fs::canonicalize(&src)
        .map_err(|e| format!("import_backup: chemin invalide — {e}"))?
        .to_string_lossy()
        .to_string();
    if let Some(parent) = std::path::Path::new(&src).parent() {
        if !parent.as_os_str().is_empty() && !is_safe_dir(parent) {
            return Err(format!("import_backup: chemin refusé (chemin système) — {src}"));
        }
    }
    let payload = crate::backup::read_backup_zip(&src)?;
    Ok(Some(payload))
}

// ── Commande : liste des volumes montés ───────────────────────────────────────

/// Retourne la liste des volumes montés sur le système.
/// Utilisé par devices.js pour la détection USB (polling).
#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    _list_drives_impl()
}

#[cfg(target_os = "windows")]
fn _list_drives_impl() -> Vec<DriveInfo> {
    use windows::Win32::Storage::FileSystem::{
        GetLogicalDriveStringsW, GetDriveTypeW,
    };
    use windows::core::HSTRING;

    let mut buf = vec![0u16; 256];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
    if len == 0 { return vec![]; }

    let mut drives = vec![];
    let raw = &buf[..len];

    for segment in raw.split(|&c| c == 0) {
        if segment.is_empty() { continue; }
        let drive_str = String::from_utf16_lossy(segment).to_string();
        let hstr = HSTRING::from(drive_str.as_str());
        let dtype = unsafe { GetDriveTypeW(&hstr) };

        let kind = match dtype {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            _ => "unknown",
        }.to_string();

        // Label = lettre de lecteur sans le backslash final (ex: "C:")
        let label = drive_str.trim_end_matches('\\').to_string();

        // For CDROM drives, probe the TOC to determine if this is an audio CD
        let (audio_cd, track_count) = if dtype == 5 {
            match crate::cdaudio::cd_read_toc(drive_str.clone()) {
                Ok(toc) => (!toc.tracks.is_empty(), toc.tracks.len().min(255) as u8),
                Err(_)  => (false, 0), // drive empty, data CD, or read error — silent
            }
        } else {
            (false, 0)
        };

        drives.push(DriveInfo {
            path:  drive_str,
            label,
            kind,
            audio_cd,
            track_count,
        });
    }
    drives
}

#[cfg(target_os = "macos")]
fn _list_drives_impl() -> Vec<DriveInfo> {
    let Ok(dir) = std::fs::read_dir("/Volumes") else { return vec![]; };
    dir.flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() { return None; }
            let label = p.file_name()?.to_string_lossy().to_string();
            if label.starts_with('.') { return None; } // skip hidden (Preboot, etc.)
            Some(DriveInfo {
                path:  p.to_string_lossy().to_string(),
                label,
                kind:  "unknown".to_string(),
                audio_cd: false,
                track_count: 0,
            })
        })
        .collect()
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn _list_drives_impl() -> Vec<DriveInfo> {
    const PSEUDO_FS: &[&str] = &[
        "proc", "sysfs", "devtmpfs", "tmpfs", "cgroup", "cgroup2",
        "debugfs", "securityfs", "pstore", "bpf", "tracefs",
        "hugetlbfs", "mqueue", "fusectl", "devpts", "efivarfs", "overlay",
    ];
    let Ok(content) = std::fs::read_to_string("/proc/mounts") else { return vec![]; };
    content.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 { return None; }
            let mountpoint = parts[1];
            let fstype     = parts[2];
            if PSEUDO_FS.contains(&fstype) { return None; }
            let label = mountpoint.split('/').last().unwrap_or(mountpoint).to_string();
            Some(DriveInfo {
                path:  mountpoint.to_string(),
                label: if label.is_empty() { "/".to_string() } else { label },
                kind:  "unknown".to_string(),
                audio_cd: false,
                track_count: 0,
            })
        })
        .collect()
}

// ── Commande : ouvrir un dossier à un chemin de départ spécifique ─────────────

/// Ouvre un dialog de sélection de dossier pré-navigué à start_path,
/// scanne les fichiers audio et retourne { folder, files }.
/// Identique à open_folder mais avec un répertoire de départ (pour USB).
#[tauri::command]
pub fn open_folder_at(
    app: AppHandle,
    start_path: String,
) -> Result<Option<OpenFolderResult>, String> {
    let Some(folder_path) = app
        .dialog()
        .file()
        .set_directory(&start_path)
        .blocking_pick_folder()
    else {
        return Ok(None); // utilisateur a annulé
    };

    let folder_str = folder_path.to_string();
    let canon = fs::canonicalize(&folder_str)
        .map_err(|e| format!("open_folder_at: canonicalize échoué — {e}"))?;
    if !is_safe_dir(&canon) {
        return Err(format!("open_folder_at: dossier non autorisé — {}", canon.display()));
    }

    let raw_paths = scan_dir(&canon);
    let files: Vec<String> = raw_paths
        .into_par_iter()
        .filter_map(|p| p.to_str().map(String::from))
        .collect();

    Ok(Some(OpenFolderResult { folder: folder_str, files }))
}
