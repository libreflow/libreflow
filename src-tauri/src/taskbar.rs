// taskbar.rs — Windows Thumbnail Toolbar (Précédent / Play-Pause / Suivant)

#![cfg(target_os = "windows")]
#![allow(non_snake_case, unsafe_code, clippy::cast_ptr_alignment)]

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use windows::Win32::{
    Foundation::{BOOL, HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
        HDC, HGDIOBJ, RGBQUAD,
    },
    System::{
        Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        },
        Threading::GetCurrentThreadId,
    },
    UI::{
        Controls::{
            ImageList_Create, ImageList_Destroy, ImageList_ReplaceIcon, HIMAGELIST, ILC_COLOR32,
        },
        Shell::{
            DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED,
            THBF_ENABLED, THB_BITMAP, THB_FLAGS, THB_TOOLTIP, THUMBBUTTON, THUMBBUTTONFLAGS,
        },
        WindowsAndMessaging::{
            CreateIconIndirect, DestroyIcon, GetMessageW, PostThreadMessageW,
            RegisterWindowMessageW, HICON, ICONINFO, MSG, WM_COMMAND,
        },
    },
};

// ── Helper : trace de diagnostic (debug builds seulement) ──────────────────
// Les warnings réels (mutex poisonné, échec COM, hwnd manquant) restent en
// eprintln! direct ; ce macro est réservé au tracing happy-path.
#[cfg(debug_assertions)]
macro_rules! dlog { ($($t:tt)*) => { eprintln!($($t)*) } }
#[cfg(not(debug_assertions))]
macro_rules! dlog {
    ($($t:tt)*) => {};
}

// ── Helper : récupère un MutexGuard même si le mutex est poisonné ─────────
// Pattern recommandé : au lieu de paniquer sur le lock suivant un thread panic,
// on récupère la donnée (probablement cohérente) et on continue.
fn lock_recover<T>(m: &'static Mutex<T>) -> std::sync::MutexGuard<'static, T> {
    m.lock().unwrap_or_else(|poison| {
        eprintln!("[taskbar] mutex poisonné — récupération gracieuse");
        poison.into_inner()
    })
}

// ── Identifiants boutons ────────────────────────────────────────────────────
const BTN_PREV: u32 = 0x4001;
const BTN_PLAY: u32 = 0x4002;
const BTN_NEXT: u32 = 0x4003;

const IMG_PREV: u32 = 0;
const IMG_PLAY: u32 = 1;
const IMG_NEXT: u32 = 2;

const SUBCLASS_UID: usize = 0x4C46_0001;
const ICON_SIZE: i32 = 24;

// Messages internes vers le COM thread (WM_USER range 0x0400..0x7FFF)
const CMD_INIT: u32 = 0x0401; // initialiser la toolbar
const CMD_PLAY_STATE: u32 = 0x0402; // wparam = 1 (playing) ou 0 (paused)
const CMD_HAS_TRACKS: u32 = 0x0403; // wparam = 1 (has tracks) ou 0 (empty)
const CMD_TASKBAR_CREATED: u32 = 0x0404; // taskbar redémarré, refaire AddButtons
const CMD_QUIT: u32 = 0x0405; // arrêter le thread COM

// ── État global ─────────────────────────────────────────────────────────────
static MAIN_HWND: Mutex<isize> = Mutex::new(0);
static COM_THREAD_ID: OnceLock<u32> = OnceLock::new();
static TASKBAR_BTN_MSG: OnceLock<u32> = OnceLock::new();
static PLAYING: Mutex<bool> = Mutex::new(false);
static HAS_TRACKS: Mutex<bool> = Mutex::new(false);
static BTN_TX: OnceLock<mpsc::Sender<String>> = OnceLock::new();
#[cfg(debug_assertions)]
static SUBCLASS_CALLS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

// ── COM thread ───────────────────────────────────────────────────────────────
//
// Thread OS dédié (STA). Crée ITaskbarList3 une fois, le garde vivant,
// traite les commandes via PostThreadMessageW → GetMessageW.
//
// Le corps du thread est découpé en quatre sous-fonctions pour rester sous
// 50 lignes chacune :
//   com_init_sta()          — initialise COM STA sur le thread appelant
//   create_taskbar_list3()  — crée et initialise ITaskbarList3
//   rebuild_image_lists()   — reconstruit les deux HIMAGELISTs
//   run_message_loop()      — boucle de messages CMD_*

// ── Sous-fonction 1 : COM STA init ──────────────────────────────────────────

struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) {
        // SAFETY: CoUninitialize est appelé exactement une fois, depuis le même
        // thread STA qui a appelé CoInitializeEx — garanti par la durée de vie du
        // guard (il est créé et droppé sur le COM thread).
        unsafe { CoUninitialize() }
    }
}

/// Initialise COM STA sur le thread appelant.
/// Retourne `Some(ComGuard)` si succès ; `None` si CoInitializeEx échoue
/// (l'appelant peut continuer sans COM si l'appel échoue avec S_FALSE — déjà init).
fn com_init_sta() -> Option<ComGuard> {
    // SAFETY: CoInitializeEx initialise COM sur le thread courant ; l'appel est sûr
    // sans précondition particulière. Le guard appelera CoUninitialize au drop
    // depuis le même thread, respectant la symétrie exigée par COM.
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_ok() {
            dlog!("[taskbar] CoInitializeEx OK (hr={hr:?})");
            Some(ComGuard)
        } else {
            eprintln!("[taskbar] CoInitializeEx ERREUR : {hr:?}");
            None
        }
    }
}

// ── Sous-fonction 2 : créer ITaskbarList3 ───────────────────────────────────

/// Crée et initialise ITaskbarList3. Retourne `None` et loggue en cas d'échec.
/// Doit être appelée depuis un thread STA COM (après `com_init_sta()`).
fn create_taskbar_list3() -> Option<ITaskbarList3> {
    // SAFETY: CoCreateInstance et HrInit sont des appels COM standards.
    // Prérequis : le thread courant est un STA COM (assuré par com_init_sta()).
    // ITaskbarList3 est un objet COM in-process (CLSCTX_ALL) ; sa durée de vie
    // est gérée par le système de comptage de références COM (Drop automatique).
    unsafe {
        match CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL) {
            Err(e) => {
                eprintln!("[taskbar] CoCreateInstance ERREUR : {e:?}");
                None
            }
            Ok(tb3) => {
                dlog!("[taskbar] ITaskbarList3 créé");
                match tb3.HrInit() {
                    Err(e) => {
                        eprintln!("[taskbar] HrInit ERREUR : {e:?}");
                        None
                    }
                    Ok(_) => {
                        dlog!("[taskbar] HrInit OK");
                        Some(tb3)
                    }
                }
            }
        }
    }
}

// ── Sous-fonction 3 : reconstruire les image lists ───────────────────────────

/// Détruit les deux HIMAGELIST précédents (si non NULL) et en construit de nouveaux.
/// Retourne `(il_play_raw, il_pause_raw)` — isize wrapping du handle Win32 (0 = NULL).
/// Appelée sur CMD_INIT et CMD_TASKBAR_CREATED (Windows libère ses listes au restart).
fn rebuild_image_lists(old_play: isize, old_pause: isize) -> (isize, isize) {
    if old_play != 0 {
        // SAFETY: old_play est un HIMAGELIST non-NULL produit par build_image_list() ;
        // on en est propriétaire et on n'y accède plus après ce point.
        unsafe { let _ = ImageList_Destroy(HIMAGELIST(old_play)); }
    }
    if old_pause != 0 {
        // SAFETY: identique à old_play.
        unsafe { let _ = ImageList_Destroy(HIMAGELIST(old_pause)); }
    }
    let il_play_raw  = build_image_list(false).0 as isize;
    let il_pause_raw = build_image_list(true).0  as isize;
    (il_play_raw, il_pause_raw)
}

// ── Sous-fonction 4 : boucle de messages CMD_* ───────────────────────────────

/// Boucle principale du COM thread.  Reçoit les CMD_* via GetMessageW et met à jour
/// la thumbnail toolbar en conséquence.  Retourne quand CMD_QUIT est reçu.
///
/// # Safety
///
/// `tb3` doit être un `ITaskbarList3` valide et initialisé (HrInit succès).
/// `main_hwnd` doit être un handle de fenêtre Win32 valide et vivant pendant
/// toute la durée de la boucle (la fenêtre principale de l'application).
/// Cette fonction doit s'exécuter depuis le thread STA COM du taskbar.
unsafe fn run_message_loop(tb3: &ITaskbarList3, main_hwnd: HWND) {
    let mut playing    = *lock_recover(&PLAYING);
    let mut has_tracks = *lock_recover(&HAS_TRACKS);
    // Deux HIMAGELIST mises en cache : icône play (paused) et icône pause (playing).
    // Le rasterizer (~36K itérations × icône) ne tourne donc qu'au boot / taskbar restart,
    // pas à chaque toggle play/pause.
    let mut il_play_raw:  isize = 0; // playing=false → icône ▶
    let mut il_pause_raw: isize = 0; // playing=true  → icône ⏸
    let mut buttons_added = false;

    loop {
        let mut msg = MSG::default();
        // SAFETY: GetMessageW attend un message destiné au thread courant.
        // HWND(null) = tous les messages de ce thread ; plages 0,0 = tous les msg.
        let ret = unsafe { GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0) };
        // GetMessageW retourne 0 sur WM_QUIT, -1 sur erreur
        match ret.0 {
            0 | -1 => break,
            _ => {}
        }

        match msg.message {
            // ── Initialiser ou réinitialiser la toolbar (ex: taskbar restart) ──
            CMD_INIT | CMD_TASKBAR_CREATED => {
                let _label = if msg.message == CMD_INIT { "CMD_INIT" } else { "CMD_TASKBAR_CREATED" };
                dlog!("[taskbar] {_label} reçu — ThumbBarAddButtons en cours…");
                playing    = *lock_recover(&PLAYING);
                has_tracks = *lock_recover(&HAS_TRACKS);
                // (Re)construire les deux image lists. Sur taskbar restart Windows libère
                // ses HIMAGELIST internes → on doit en fournir des nouvelles.
                (il_play_raw, il_pause_raw) = rebuild_image_lists(il_play_raw, il_pause_raw);
                let cur_il_raw = if playing { il_pause_raw } else { il_play_raw };
                // SAFETY: tb3 et main_hwnd sont valides (cf. contrat Safety de cette fn).
                let ok = unsafe {
                    if cur_il_raw != 0 {
                        let _r = tb3.ThumbBarSetImageList(main_hwnd, HIMAGELIST(cur_il_raw));
                        dlog!("[taskbar] ThumbBarSetImageList = {_r:?}");
                    }
                    let r = tb3.ThumbBarAddButtons(main_hwnd, &mk_buttons(playing, has_tracks));
                    dlog!("[taskbar] ThumbBarAddButtons = {r:?}");
                    r.is_ok()
                };
                buttons_added = ok;
                dlog!("[taskbar] buttons_added = {buttons_added}");
            }

            // ── Mise à jour play/pause ──
            CMD_PLAY_STATE => {
                playing = msg.wParam.0 != 0;
                *lock_recover(&PLAYING) = playing;
                if buttons_added {
                    let cur_il_raw = if playing { il_pause_raw } else { il_play_raw };
                    // SAFETY: tb3 et main_hwnd sont valides (cf. contrat Safety de cette fn).
                    unsafe {
                        if cur_il_raw != 0 {
                            let _ = tb3.ThumbBarSetImageList(main_hwnd, HIMAGELIST(cur_il_raw));
                        }
                        let _ = tb3.ThumbBarUpdateButtons(main_hwnd, &mk_buttons(playing, has_tracks));
                    }
                }
            }

            // ── Mise à jour présence de pistes (enable/disable) ──
            CMD_HAS_TRACKS => {
                has_tracks = msg.wParam.0 != 0;
                *lock_recover(&HAS_TRACKS) = has_tracks;
                if buttons_added {
                    // SAFETY: tb3 et main_hwnd sont valides (cf. contrat Safety de cette fn).
                    unsafe {
                        let _ = tb3.ThumbBarUpdateButtons(main_hwnd, &mk_buttons(playing, has_tracks));
                    }
                }
            }

            // ── Arrêt propre ──
            CMD_QUIT => break,

            // ── Tout autre message : ignorer (pas de fenêtre propre) ──
            _ => {}
        }
    }

    // Libérer les image lists en fin de boucle
    if il_play_raw != 0 {
        // SAFETY: il_play_raw est non-NULL et on en est propriétaire.
        unsafe { let _ = ImageList_Destroy(HIMAGELIST(il_play_raw)); }
    }
    if il_pause_raw != 0 {
        // SAFETY: identique à il_play_raw.
        unsafe { let _ = ImageList_Destroy(HIMAGELIST(il_pause_raw)); }
    }
    // tb3 droppé par l'appelant → ITaskbarList3::Release() automatique
}

// ── Boucle principale du COM thread ─────────────────────────────────────────

fn com_thread_loop(main_hwnd_raw: isize) {
    dlog!("[taskbar] COM thread démarré");
    // Initialiser COM STA sur ce thread (sera uninit à la sortie via guard)
    let _com = com_init_sta();

    // Créer ITaskbarList3 une fois, le garder vivant toute la durée du thread.
    // Si la création échoue, on sort : rien à faire sans ITaskbarList3.
    let Some(tb3) = create_taskbar_list3() else { return };

    // Enregistrer le thread ID après que ITaskbarList3 est prêt, puis s'auto-poster
    // CMD_INIT pour que la boucle de messages déclenche l'initialisation à coup sûr.
    // SAFETY: GetCurrentThreadId n'a pas de précondition.
    let thread_id = unsafe { GetCurrentThreadId() };
    COM_THREAD_ID.set(thread_id).ok();
    dlog!("[taskbar] COM_THREAD_ID = {thread_id}");
    // SAFETY: PostThreadMessageW est sûr ici car thread_id est l'ID du thread courant
    // (vient d'être obtenu) et le message WM_USER est dans la plage réservée privée.
    unsafe { let _ = PostThreadMessageW(thread_id, CMD_INIT, WPARAM(0), LPARAM(0)); }
    dlog!("[taskbar] CMD_INIT posté au COM thread");

    let main_hwnd = HWND(main_hwnd_raw as *mut _);
    // SAFETY: tb3 est initialisé (HrInit succès dans create_taskbar_list3) ;
    // main_hwnd est le handle de la fenêtre principale, valide pour toute la durée
    // de l'application ; on est sur le thread STA COM dédié.
    unsafe { run_message_loop(&tb3, main_hwnd) }
    // tb3 droppé ici → ITaskbarList3::Release() automatique
    // _com droppé ici → CoUninitialize() automatique
}

// ── API publique ─────────────────────────────────────────────────────────────

/// Initialise la thumbnail toolbar. Appelé une seule fois depuis main.rs au setup.
pub fn setup(main_win: tauri::WebviewWindow, app: AppHandle) {
    dlog!("[taskbar] setup() appelé");
    if let Ok(hwnd) = main_win.hwnd() {
        let hwnd_raw = hwnd.0 as isize;
        dlog!("[taskbar] HWND = {hwnd_raw:#x}");
        unsafe { setup_impl(hwnd_raw, app) }
    } else {
        eprintln!("[taskbar] hwnd() introuvable — thumbnail toolbar désactivée");
    }
}

/// Met à jour l'icône Play/Pause.
pub fn update_play_state(playing: bool) {
    *lock_recover(&PLAYING) = playing;
    if let Some(&tid) = COM_THREAD_ID.get() {
        unsafe {
            let _ = PostThreadMessageW(tid, CMD_PLAY_STATE, WPARAM(playing as usize), LPARAM(0));
        }
    }
}

/// Active/désactive les boutons selon la présence de pistes.
pub fn update_has_tracks(has: bool) {
    *lock_recover(&HAS_TRACKS) = has;
    if let Some(&tid) = COM_THREAD_ID.get() {
        unsafe {
            let _ = PostThreadMessageW(tid, CMD_HAS_TRACKS, WPARAM(has as usize), LPARAM(0));
        }
    }
}

/// Arrête proprement le COM thread. Appelé sur WindowEvent::Destroyed.
pub fn cleanup() {
    if let Some(&tid) = COM_THREAD_ID.get() {
        unsafe {
            let _ = PostThreadMessageW(tid, CMD_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

// ── Implémentation ───────────────────────────────────────────────────────────

/// # Safety
///
/// `hwnd_raw` doit être un handle de fenêtre Win32 valide pour la fenêtre `main`,
/// obtenu depuis `WebviewWindow::hwnd()` juste avant l'appel. `setup_impl` doit être
/// appelée une seule fois, depuis le thread du message pump Win32 (le main thread,
/// dans la closure `setup()` de Tauri) : `SetWindowSubclass` doit s'exécuter sur le
/// thread propriétaire de la fenêtre pour intercepter ses messages.
unsafe fn setup_impl(hwnd_raw: isize, app: AppHandle) {
    *lock_recover(&MAIN_HWND) = hwnd_raw;

    // ── Enregistrer le message WM_TASKBARBUTTONCREATED ────────────────────
    let msg_name: Vec<u16> = "TaskbarButtonCreated\0".encode_utf16().collect();
    // SAFETY: msg_name est un buffer UTF-16 NUL-terminé qui vit jusqu'à la fin de
    // l'appel ; RegisterWindowMessageW ne conserve pas le pointeur après retour.
    let tbc_msg = RegisterWindowMessageW(windows::core::PCWSTR(msg_name.as_ptr()));
    if tbc_msg != 0 {
        TASKBAR_BTN_MSG.set(tbc_msg).ok();
    }

    // ── Canal mpsc : boutons cliqués → Tokio → JS ─────────────────────────
    let (tx, mut rx) = mpsc::channel::<String>(8);
    BTN_TX.set(tx).ok();
    let app_for_rx = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(key) = rx.recv().await {
            if let Some(win) = app_for_rx.get_webview_window("main") {
                dlog!("[taskbar] emit media-key '{key}' → main");
                let _ = win.emit("media-key", &key);
            }
        }
    });

    // ── Subclass immédiat ─────────────────────────────────────────────────
    // setup() est appelé depuis la closure setup() de Tauri, qui tourne sur le
    // main thread (le même thread que le message pump Win32). SetWindowSubclass
    // doit être appelé depuis ce thread pour intercepter WM_TASKBARBUTTONCREATED
    // avant qu'il arrive — l'ancienne version différée via on_window_event créait
    // une race condition : le message pouvait arriver avant l'installation.
    let hwnd = HWND(hwnd_raw as *mut _);
    // SAFETY: `hwnd` est le handle valide reçu en paramètre (cf. contrat `# Safety`) ;
    // `subclass_proc` est une `extern "system" fn` à durée de vie statique ; SUBCLASS_UID
    // est l'identifiant unique du subclass. L'appel s'exécute sur le thread propriétaire
    // de la fenêtre, prérequis de SetWindowSubclass.
    let r = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_UID, 0) };
    if r.0 == 0 {
        eprintln!("[taskbar] SetWindowSubclass ERREUR (r=0) — thumbnail toolbar inactive");
    } else {
        dlog!("[taskbar] SetWindowSubclass OK");
    }

    // ── Spawner le COM thread ─────────────────────────────────────────────
    std::thread::spawn(move || {
        com_thread_loop(hwnd_raw);
    });
}

// ── Boutons ──────────────────────────────────────────────────────────────────

fn mk_buttons(playing: bool, has_tracks: bool) -> [THUMBBUTTON; 3] {
    // Sans THBF_NOBACKGROUND : Windows affiche le highlight de survol natif (cercle).
    let nav_flags = if has_tracks {
        THBF_ENABLED
    } else {
        THBF_DISABLED
    };
    let play_flags = if has_tracks {
        THBF_ENABLED
    } else {
        THBF_DISABLED
    };
    let play_tip = if playing { "Pause" } else { "Play" };
    [
        thumb_btn(BTN_PREV, IMG_PREV, "Previous", nav_flags),
        thumb_btn(BTN_PLAY, IMG_PLAY, play_tip, play_flags),
        thumb_btn(BTN_NEXT, IMG_NEXT, "Next", nav_flags),
    ]
}

fn thumb_btn(id: u32, img: u32, tip: &str, flags: THUMBBUTTONFLAGS) -> THUMBBUTTON {
    let wide: Vec<u16> = tip.encode_utf16().collect();
    let mut tb = THUMBBUTTON {
        dwMask: THB_BITMAP | THB_FLAGS | THB_TOOLTIP,
        iId: id,
        iBitmap: img,
        dwFlags: flags,
        ..THUMBBUTTON::default()
    };
    let n = wide.len().min(tb.szTip.len() - 1);
    tb.szTip[..n].copy_from_slice(&wide[..n]);
    tb
}

// ── Image list ───────────────────────────────────────────────────────────────

fn build_image_list(playing: bool) -> HIMAGELIST {
    let icons = [
        make_icon_prev(),
        if playing {
            make_icon_pause()
        } else {
            make_icon_play()
        },
        make_icon_next(),
    ];
    // SAFETY: ImageList_Create est un appel COMCTL32 sans précondition particulière ;
    // il peut échouer (OOM, contexte DPI) et renvoyer un handle NULL.
    let il = unsafe { ImageList_Create(ICON_SIZE, ICON_SIZE, ILC_COLOR32, 3, 0) };
    // Handle NULL : ImageList_ReplaceIcon sur un handle NULL est un comportement
    // indéfini Win32. HIMAGELIST encapsule un isize ; un handle NULL vaut 0.
    // On loggue et on sort tôt — les icônes créées sont libérées avant le retour
    // pour ne pas fuiter de HICON.
    if il.0 == 0 {
        eprintln!("[taskbar] ImageList_Create a renvoyé NULL — image list ignorée");
        for ic in icons {
            // SAFETY: ic provient de make_icon_* (CreateIconIndirect) ; DestroyIcon
            // tolère un HICON invalide, l'appel reste sûr même si la création a échoué.
            unsafe {
                let _ = DestroyIcon(ic);
            }
        }
        return il;
    }
    for ic in icons {
        if !ic.is_invalid() {
            // SAFETY: `il` est non-NULL (vérifié ci-dessus) et `ic` est un HICON
            // valide ; ImageList_ReplaceIcon copie l'icône dans la liste.
            unsafe {
                ImageList_ReplaceIcon(il, -1, ic);
            }
        }
        // SAFETY: l'icône a été copiée par la liste (ou est invalide) ; on libère
        // le HICON local — DestroyIcon tolère un handle invalide.
        unsafe {
            let _ = DestroyIcon(ic);
        }
    }
    il
}

// ── Pure-Rust rasterizer ─────────────────────────────────────────────────────
//
// Point-in-polygon (ray casting) + 8× supersampling → anti-aliased white icon
// on transparent background. No GDI drawing required.
// Output: BGRA bytes (Windows DIB memory layout, top-down).

fn in_poly(x: f32, y: f32, v: &[(f32, f32)]) -> bool {
    if v.is_empty() {
        return false;
    }
    let n = v.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = v[i];
        let (xj, yj) = v[j];
        if ((yi > y) != (yj > y)) && x < ((xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn rasterize(polys: &[&[(f32, f32)]], size: usize) -> Vec<u8> {
    const SS: usize = 8;
    const SS2: f32 = (SS * SS) as f32;
    let mut out = vec![0u8; size * size * 4];
    for row in 0..size {
        for col in 0..size {
            let mut hits = 0u32;
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = col as f32 + (sx as f32 + 0.5) / SS as f32;
                    let y = row as f32 + (sy as f32 + 0.5) / SS as f32;
                    if polys.iter().any(|p| in_poly(x, y, p)) {
                        hits += 1;
                    }
                }
            }
            let a = ((hits as f32 / SS2) * 255.0 + 0.5) as u8;
            let i = (row * size + col) * 4;
            // BGRA: white foreground, alpha = coverage
            out[i] = 255;
            out[i + 1] = 255;
            out[i + 2] = 255;
            out[i + 3] = a;
        }
    }
    out
}

fn bgra_to_hicon(bgra: &[u8], sz: i32) -> HICON {
    unsafe {
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: sz,
                biHeight: -sz, // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                ..Default::default()
            },
            bmiColors: [RGBQUAD::default()],
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let Ok(color_bm) = CreateDIBSection(
            HDC(std::ptr::null_mut()),
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ) else {
            return HICON(std::ptr::null_mut());
        };
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), bgra.len());
        let mask_bm = CreateBitmap(sz, sz, 1, 1, None);
        let ii = ICONINFO {
            fIcon: BOOL(1),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask_bm,
            hbmColor: color_bm,
        };
        let ic = CreateIconIndirect(&ii).unwrap_or(HICON(std::ptr::null_mut()));
        let _ = DeleteObject(HGDIOBJ(color_bm.0));
        let _ = DeleteObject(HGDIOBJ(mask_bm.0));
        ic
    }
}

// ── Icon shapes (24×24 coordinate space) ─────────────────────────────────────
//
//  ⏮  Prev  : left bar (3px) + left-pointing triangle
//  ▶  Play  : right-pointing triangle
//  ⏸  Pause : two vertical bars (5px each, 4px gap)
//  ⏭  Next  : right-pointing triangle + right bar (3px)

fn make_icon_prev() -> HICON {
    let bar: &[(f32, f32)] = &[(3., 3.), (7., 3.), (7., 21.), (3., 21.)];
    let tri: &[(f32, f32)] = &[(21., 3.), (8., 12.), (21., 21.)];
    bgra_to_hicon(&rasterize(&[bar, tri], 24), 24)
}

fn make_icon_play() -> HICON {
    let tri: &[(f32, f32)] = &[(5., 3.), (5., 21.), (20., 12.)];
    bgra_to_hicon(&rasterize(&[tri], 24), 24)
}

fn make_icon_pause() -> HICON {
    let b1: &[(f32, f32)] = &[(5., 3.), (10., 3.), (10., 21.), (5., 21.)];
    let b2: &[(f32, f32)] = &[(14., 3.), (19., 3.), (19., 21.), (14., 21.)];
    bgra_to_hicon(&rasterize(&[b1, b2], 24), 24)
}

fn make_icon_next() -> HICON {
    let tri: &[(f32, f32)] = &[(5., 3.), (5., 21.), (16., 12.)];
    let bar: &[(f32, f32)] = &[(17., 3.), (21., 3.), (21., 21.), (17., 21.)];
    bgra_to_hicon(&rasterize(&[tri, bar], 24), 24)
}

// ── Subclass proc ─────────────────────────────────────────────────────────────
//
// # Safety
//
// `subclass_proc` est enregistrée via `SetWindowSubclass` sur le thread propriétaire
// de la fenêtre. Windows garantit que le callback est invoqué depuis ce même thread
// et uniquement tant que le subclass est actif (entre `SetWindowSubclass` et
// `RemoveWindowSubclass`/`DestroyWindow`). Tous les paramètres (`hwnd`, `wparam`,
// `lparam`) sont fournis par le système et sont valides pour la durée de l'appel.
// `PostThreadMessageW` est sûr car `tid` est obtenu depuis `COM_THREAD_ID` (OnceLock
// écrit par le COM thread avant toute utilisation) et le thread COM tourne tant que
// l'application est ouverte. `DefSubclassProc` est sûr avec les mêmes paramètres
// reçus du système.

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid: usize,
    _data: usize,
) -> LRESULT {
    #[cfg(debug_assertions)]
    {
        let n = SUBCLASS_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if n < 8 {
            dlog!(
                "[taskbar] subclass_proc #{n} msg={msg:#06x} wparam={:#x}",
                wparam.0
            );
        }
    }

    // ── Clics boutons thumbnail ──
    if msg == WM_COMMAND {
        let btn_id = (wparam.0 & 0xFFFF) as u32;
        let key = match btn_id {
            BTN_PREV => Some("prev"),
            BTN_PLAY => Some("toggle-play"),
            BTN_NEXT => Some("next"),
            _ => None,
        };
        if let Some(k) = key {
            dlog!("[taskbar] WM_COMMAND btn={btn_id:#x} → '{k}'");
            if let Some(tx) = BTN_TX.get() {
                let _ = tx.try_send(k.to_string());
            }
            return LRESULT(0);
        }
    }

    // ── Redémarrage taskbar → recréer les boutons ──
    if let Some(&tbc_msg) = TASKBAR_BTN_MSG.get() {
        if tbc_msg != 0 && msg == tbc_msg {
            dlog!("[taskbar] WM_TASKBARBUTTONCREATED → CMD_TASKBAR_CREATED");
            if let Some(&tid) = COM_THREAD_ID.get() {
                let _ = PostThreadMessageW(tid, CMD_TASKBAR_CREATED, WPARAM(0), LPARAM(0));
            }
        }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}
