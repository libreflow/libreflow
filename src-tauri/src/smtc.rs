// smtc.rs — Contrôles médias système via souvlaki (SMTC Windows / MPRIS Linux)
//
// Architecture : souvlaki::MediaControls n'est pas Send (pointeurs WinRT bruts).
// Il vit donc dans un thread dédié qui consomme un canal mpsc ; les commandes
// Tauri (`smtc_metadata`, `smtc_playback`) ne font que pousser dans le canal.
//
// Les boutons de l'overlay média / écran de verrouillage sont réémis vers le
// frontend sur l'event `media-key` EXISTANT (mêmes payloads que les raccourcis
// globaux de main.rs : play / pause / toggle-play / next / prev / stop) — le
// listener de app.js sert les deux sources. La position absolue (scrub depuis
// l'overlay) part sur `smtc-seek` (f64 secondes).
//
// Pochette : SMTC veut une URI, pas des octets. Le thread extrait l'image via
// lofty (contenu non fiable — cap 8 Mo) et l'écrit dans un fichier temporaire
// à nom rotatif (Windows cache la vignette par URI : réécrire le même nom
// laisserait une vignette périmée).

use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use lofty::{picture::PictureType, prelude::*, probe::Probe};
use serde::Deserialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::is_safe_dir;

/// Cap pochette : aligné sur read_tags (lofty parse du contenu non fiable).
const MAX_COVER: usize = 8 * 1024 * 1024;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtcMeta {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Chemin du fichier audio — utilisé uniquement pour extraire la pochette.
    pub path: Option<String>,
    pub duration_secs: Option<f64>,
}

pub enum SmtcCmd {
    Meta(Box<SmtcMeta>),
    Playback { playing: bool, position_secs: f64 },
    Clear,
}

/// `None` tant que setup() n'a pas démarré le thread (ou s'il a échoué).
pub struct SmtcState(pub Mutex<Option<SyncSender<SmtcCmd>>>);

// ── Commandes IPC ─────────────────────────────────────────────────────────────

fn send_cmd(state: &tauri::State<SmtcState>, cmd: SmtcCmd) -> Result<(), String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "smtc: état empoisonné".to_string())?;
    match guard.as_ref() {
        Some(tx) => tx
            .send(cmd)
            .map_err(|_| "smtc: thread médias arrêté".to_string()),
        None => Err("smtc: contrôles médias indisponibles".to_string()),
    }
}

/// Métadonnées de la piste courante. `meta: null` efface l'overlay (stop).
#[tauri::command]
pub fn smtc_metadata(state: tauri::State<SmtcState>, meta: Option<SmtcMeta>) -> Result<(), String> {
    match meta {
        Some(m) => send_cmd(&state, SmtcCmd::Meta(Box::new(m))),
        None => send_cmd(&state, SmtcCmd::Clear),
    }
}

/// État lecture/pause + position courante (secondes).
#[tauri::command]
pub fn smtc_playback(
    state: tauri::State<SmtcState>,
    playing: bool,
    position_secs: f64,
) -> Result<(), String> {
    let position_secs = if position_secs.is_finite() {
        position_secs.max(0.0)
    } else {
        0.0
    };
    send_cmd(
        &state,
        SmtcCmd::Playback {
            playing,
            position_secs,
        },
    )
}

// ── Setup (appelé depuis main.rs .setup()) ───────────────────────────────────

pub fn setup(app: &tauri::App) {
    // HWND requis par SMTC sous Windows. Les pointeurs bruts ne sont pas Send :
    // on transporte la valeur en isize et on la reconstruit dans le thread.
    #[cfg(target_os = "windows")]
    let hwnd_raw: Option<isize> = match app.get_webview_window("main") {
        Some(win) => match win.hwnd() {
            Ok(h) => Some(h.0 as isize),
            Err(e) => {
                log::warn!("[smtc] hwnd introuvable — contrôles médias désactivés : {e}");
                None
            }
        },
        None => {
            log::warn!("[smtc] fenêtre main introuvable — contrôles médias désactivés");
            None
        }
    };
    #[cfg(target_os = "windows")]
    if hwnd_raw.is_none() {
        app.manage(SmtcState(Mutex::new(None)));
        return;
    }

    let (tx, rx) = sync_channel::<SmtcCmd>(8);
    let handle = app.handle().clone();
    // État enregistré AVANT le spawn : SmtcState disponible dès le retour de setup(),
    // avant tout appel de commande IPC possible (ordering documenté par Tauri).
    app.manage(SmtcState(Mutex::new(Some(tx))));

    std::thread::spawn(move || {
        let config = PlatformConfig {
            dbus_name: "libreflow",
            display_name: "LibreFlow",
            #[cfg(target_os = "windows")]
            hwnd: hwnd_raw.map(|h| h as *mut std::ffi::c_void),
            #[cfg(not(target_os = "windows"))]
            hwnd: None,
        };
        let mut controls = match MediaControls::new(config) {
            Ok(c) => c,
            Err(e) => {
                log::error!(
                    "[smtc] MediaControls::new a échoué — contrôles médias désactivés : {e:?}"
                );
                return; // le Sender mourra → les commandes IPC renverront Err
            }
        };
        let evt_handle = handle.clone();
        if let Err(e) = controls.attach(move |event| dispatch_event(&evt_handle, event)) {
            log::error!("[smtc] attach a échoué — contrôles médias désactivés : {e:?}");
            return;
        }

        let mut cover_seq: u64 = 0;
        let mut prev_cover: Option<PathBuf> = None;
        let mut has_meta = false; // pas d'overlay vide au boot : playback ignoré avant la 1re piste
                                  // Boucle de service : vit aussi longtemps que le Sender côté state.
        while let Ok(cmd) = rx.recv() {
            let res = match cmd {
                SmtcCmd::Meta(m) => {
                    has_meta = true;
                    // Cap à 256 caractères — prévient l'overflow SMTC/MPRIS sur
                    // des tags arbitrairement longs fournis via IPC (Security H-2).
                    let title: String = m.title.chars().take(256).collect();
                    let artist: String = m.artist.chars().take(256).collect();
                    let album: String = m.album.chars().take(256).collect();
                    // try_from : from_secs_f64 panique si d déborde u64
                    // (f64 fini mais énorme via IPC) — thread SMTC mort.
                    let duration = m
                        .duration_secs
                        .filter(|d| d.is_finite() && *d > 0.0)
                        .and_then(|d| Duration::try_from_secs_f64(d).ok());
                    let cover = m
                        .path
                        .as_deref()
                        .and_then(|p| extract_cover(p, &mut cover_seq));
                    let r1 = controls.set_metadata(MediaMetadata {
                        title: Some(&title),
                        artist: Some(&artist),
                        album: Some(&album),
                        cover_url: cover.as_ref().map(|(url, _)| url.as_str()),
                        duration,
                    });
                    // souvlaki 0.8 on Windows can fail to mask file:// URIs
                    // (UNABLE_TO_MASK_PATH / HRESULT 0x800700A1). Retry without
                    // cover so metadata still reaches SMTC.
                    let r = if r1.is_err() && cover.is_some() {
                        controls.set_metadata(MediaMetadata {
                            title: Some(&title),
                            artist: Some(&artist),
                            album: Some(&album),
                            cover_url: None,
                            duration,
                        })
                    } else {
                        r1
                    };
                    // Nettoyage APRÈS set_metadata : SMTC référence l'ancienne
                    // URI jusqu'à la bascule (extension possiblement différente).
                    if let Some(old) = prev_cover.take() {
                        drop(std::fs::remove_file(old)); // best-effort, non fatal
                    }
                    prev_cover = cover.map(|(_, p)| p);
                    r
                }
                SmtcCmd::Playback {
                    playing,
                    position_secs,
                } => {
                    if !has_meta {
                        continue;
                    }
                    // try_from : même garde anti-panic que duration ci-dessus.
                    // position_secs est déjà fini et ≥0 (filtré dans smtc_playback),
                    // mais peut déborder u64 pour des valeurs énormes → log + repli 0.
                    let position_dur = Duration::try_from_secs_f64(position_secs)
                        .unwrap_or_else(|_| {
                            log::warn!("[smtc] position_secs {position_secs} déborde Duration → 0");
                            Duration::ZERO
                        });
                    let progress = Some(MediaPosition(position_dur));
                    controls.set_playback(if playing {
                        MediaPlayback::Playing { progress }
                    } else {
                        MediaPlayback::Paused { progress }
                    })
                }
                SmtcCmd::Clear => {
                    has_meta = false;
                    let r = controls
                        .set_metadata(MediaMetadata::default())
                        .and_then(|_| controls.set_playback(MediaPlayback::Stopped));
                    // Nettoyage APRÈS set_metadata : SMTC a basculé vers l'état vide.
                    if let Some(old) = prev_cover.take() {
                        drop(std::fs::remove_file(old)); // best-effort, non fatal
                    }
                    r
                }
            };
            if let Err(e) = res {
                log::warn!("[smtc] mise à jour SMTC échouée : {e:?}");
            }
        }
        // Sender dropped (app quit) → nettoyer le dernier fichier temp pochette.
        if let Some(old) = prev_cover {
            let _ = std::fs::remove_file(old);
        }
    });
}

// ── Événements OS → frontend ──────────────────────────────────────────────────

fn dispatch_event(app: &AppHandle, event: MediaControlEvent) {
    let key = match event {
        MediaControlEvent::Play => Some("play"),
        MediaControlEvent::Pause => Some("pause"),
        MediaControlEvent::Toggle => Some("toggle-play"),
        MediaControlEvent::Next => Some("next"),
        MediaControlEvent::Previous => Some("prev"),
        MediaControlEvent::Stop => Some("stop"),
        MediaControlEvent::SetPosition(pos) => {
            if let Some(win) = app.get_webview_window("main") {
                if let Err(e) = win.emit("smtc-seek", pos.0.as_secs_f64()) {
                    log::warn!("[smtc] emit smtc-seek failed: {e}");
                }
            }
            None
        }
        MediaControlEvent::Seek(dir) => {
            // Saut OS d'intervalle fixe (SMTC ~10s, MPRIS ~5s) — on émet 10s par défaut.
            let delta = match dir {
                SeekDirection::Forward => 10.0_f64,
                SeekDirection::Backward => -10.0_f64,
            };
            if let Some(win) = app.get_webview_window("main") {
                if let Err(e) = win.emit("smtc-seek-by", delta) {
                    log::warn!("[smtc] emit smtc-seek-by (Seek) failed: {e}");
                }
            }
            None
        }
        MediaControlEvent::SeekBy(dir, duration) => {
            let delta = duration.as_secs_f64()
                * if matches!(dir, SeekDirection::Forward) {
                    1.0
                } else {
                    -1.0
                };
            if let Some(win) = app.get_webview_window("main") {
                if let Err(e) = win.emit("smtc-seek-by", delta) {
                    log::warn!("[smtc] emit smtc-seek-by failed: {e}");
                }
            }
            None
        }
        _ => None, // SetVolume / OpenUri / Raise / Quit — hors périmètre
    };
    if let Some(k) = key {
        if let Some(win) = app.get_webview_window("main") {
            if let Err(e) = win.emit("media-key", k) {
                log::warn!("[smtc] emit media-key failed: {e}");
            }
        }
    }
}

// ── Pochette → fichier temporaire ─────────────────────────────────────────────

/// Extrait la pochette du fichier audio et l'écrit dans %TEMP% sous un nom
/// rotatif (Windows cache la vignette par URI). Retourne (URI file:///…,
/// chemin du fichier temp) ou None — non fatal, l'overlay s'affiche sans
/// vignette. Le nettoyage de l'ancien fichier appartient à l'appelant.
fn extract_cover(path: &str, seq: &mut u64) -> Option<(String, PathBuf)> {
    if path.contains('\0') {
        return None;
    }
    let canon = Path::new(path).canonicalize().ok()?;
    if !canon.is_file() || !is_safe_dir(canon.parent()?) {
        return None;
    }
    let tagged = Probe::open(&canon)
        .ok()?
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;
    let tag = tagged.primary_tag()?;
    let pic = tag
        .pictures()
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first())
        .filter(|p| !p.data().is_empty() && p.data().len() <= MAX_COVER)?;

    let ext = match pic.mime_type() {
        Some(lofty::picture::MimeType::Png) => "png",
        Some(lofty::picture::MimeType::Gif) => "gif",
        Some(lofty::picture::MimeType::Bmp) => "bmp",
        _ => "jpg",
    };
    *seq += 1;
    let dest = std::env::temp_dir().join(format!("libreflow_smtc_{}.{ext}", *seq % 4));
    if std::fs::write(&dest, pic.data()).is_err() {
        let _ = std::fs::remove_file(&dest);
        return None;
    }
    // Encodage URI complet : %TEMP% peut contenir caractères spéciaux dans le
    // nom d'utilisateur (parenthèses, +, &, =, …). '%' encodé EN PREMIER pour
    // éviter le double-encodage. Les séparateurs de chemin '/' et ':' (lettre
    // de lecteur Windows) sont RFC-3986 path-safe et ne sont pas encodés.
    let mut slug = dest.display().to_string().replace('\\', "/");
    for (raw, enc) in [
        ("%", "%25"), // en premier — évite double-encodage
        (" ", "%20"),
        ("#", "%23"),
        ("?", "%3F"),
        ("+", "%2B"),
        ("&", "%26"),
        ("=", "%3D"),
        ("(", "%28"),
        (")", "%29"),
        ("[", "%5B"),
        ("]", "%5D"),
        ("@", "%40"),
        ("!", "%21"),
        ("$", "%24"),
        (",", "%2C"),
        (";", "%3B"),
        ("'", "%27"),
        ("^", "%5E"),
        ("`", "%60"),
        ("{", "%7B"),
        ("}", "%7D"),
        ("|", "%7C"),
    ] {
        slug = slug.replace(raw, enc);
    }
    let url = format!("file:///{slug}");
    Some((url, dest))
}
