// taskbar.rs — Windows Thumbnail Toolbar (Précédent / Play-Pause / Suivant)
// v2 : icônes 24×24, leak HIMAGELIST corrigé, état disabled prev/next/play,
//      emit ciblé sur la fenêtre "main" (fix boutons non-fonctionnels).

#![cfg(target_os = "windows")]
#![allow(non_snake_case, unsafe_code, clippy::cast_ptr_alignment)]

use std::sync::{Arc, Mutex, Once, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::mpsc;

use windows::{
    Win32::{
        Foundation::{BOOL, COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{
            CreateBitmap, CreateCompatibleBitmap, CreateCompatibleDC, CreatePen,
            CreateSolidBrush, DeleteDC, DeleteObject, FillRect, GetDC, Polygon,
            ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt,
            HBITMAP, HBRUSH, HDC, HGDIOBJ, HPEN, PS_SOLID, SRCCOPY, STRETCH_BLT_MODE,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize,
                CLSCTX_ALL, COINIT_APARTMENTTHREADED,
            },
            Threading::GetCurrentThreadId,
        },
        UI::{
            Controls::{
                ImageList_Create, ImageList_Destroy, ImageList_ReplaceIcon,
                HIMAGELIST, ILC_COLOR32,
            },
            Shell::{
                DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList,
                THUMBBUTTON, THUMBBUTTONFLAGS, THBF_DISABLED, THBF_ENABLED,
                THB_BITMAP, THB_FLAGS, THB_TOOLTIP,
            },
            WindowsAndMessaging::{
                CreateIconIndirect, DestroyIcon, GetMessageW,
                HICON, ICONINFO, MSG, PostThreadMessageW, RegisterWindowMessageW,
                WM_COMMAND,
            },
        },
    },
};

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
const BTN_PREV:     u32 = 0x4001;
const BTN_PLAY:     u32 = 0x4002;
const BTN_NEXT:     u32 = 0x4003;

const IMG_PREV: u32 = 0;
const IMG_PLAY: u32 = 1;
const IMG_NEXT: u32 = 2;

const SUBCLASS_UID: usize = 0x4C46_0001;
const ICON_SIZE:    i32   = 24;

// Messages internes vers le COM thread (WM_USER range 0x0400..0x7FFF)
const CMD_INIT:            u32 = 0x0401; // initialiser la toolbar
const CMD_PLAY_STATE:      u32 = 0x0402; // wparam = 1 (playing) ou 0 (paused)
const CMD_HAS_TRACKS:      u32 = 0x0403; // wparam = 1 (has tracks) ou 0 (empty)
const CMD_TASKBAR_CREATED: u32 = 0x0404; // taskbar redémarré, refaire AddButtons
const CMD_QUIT:            u32 = 0x0405; // arrêter le thread COM

// ── État global ─────────────────────────────────────────────────────────────
static MAIN_HWND:       Mutex<isize>                   = Mutex::new(0);
static COM_THREAD_ID:   OnceLock<u32>                  = OnceLock::new();
static TASKBAR_BTN_MSG: OnceLock<u32>                  = OnceLock::new();
static PLAYING:         Mutex<bool>                    = Mutex::new(false);
static HAS_TRACKS:      Mutex<bool>                    = Mutex::new(false);
static BTN_TX:          OnceLock<mpsc::Sender<String>> = OnceLock::new();

// ── COM thread ───────────────────────────────────────────────────────────────
//
// Thread OS dédié (STA). Crée ITaskbarList3 une fois, le garde vivant,
// traite les commandes via PostThreadMessageW → GetMessageW.

fn com_thread_loop(main_hwnd_raw: isize) {
    // Initialiser COM STA sur ce thread (sera uninit à la sortie via guard)
    struct ComGuard;
    impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    let _com = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map(|_| ComGuard) };

    // Enregistrer le thread ID pour que les autres threads puissent nous poster
    let thread_id = unsafe { GetCurrentThreadId() };
    COM_THREAD_ID.set(thread_id).ok();

    // Créer ITaskbarList3 une fois, le garder vivant toute la durée du thread
    let tb3 = unsafe {
        let Ok(tb3) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL)
            else { return; };
        if tb3.HrInit().is_err() { return; }
        tb3
    };

    let main_hwnd    = HWND(main_hwnd_raw as *mut _);
    let mut playing    = *lock_recover(&PLAYING);
    let mut has_tracks = *lock_recover(&HAS_TRACKS);
    let mut cur_il_raw: isize = 0; // HIMAGELIST courante (0 = aucune)
    let mut buttons_added = false;

    // Helper local : détruire l'ancienne image list et en stocker une nouvelle
    let mut set_il = |new_il: HIMAGELIST, cur: &mut isize| {
        if *cur != 0 { unsafe { let _ = ImageList_Destroy(HIMAGELIST(*cur)); } }
        *cur = new_il.0;
    };

    // Message loop — reçoit les CMD_* postés via PostThreadMessageW
    loop {
        let mut msg = MSG::default();
        let ret = unsafe { GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0) };
        // GetMessageW retourne 0 sur WM_QUIT, -1 sur erreur
        match ret.0 {
            0 | -1 => break,
            _ => {}
        }

        match msg.message {
            // ── Initialiser ou réinitialiser la toolbar (ex: taskbar restart) ──
            CMD_INIT | CMD_TASKBAR_CREATED => {
                // Relire l'état courant depuis les statics (écrit par update_*)
                playing    = *lock_recover(&PLAYING);
                has_tracks = *lock_recover(&HAS_TRACKS);
                let il = unsafe { build_image_list(playing) };
                set_il(il, &mut cur_il_raw);
                unsafe {
                    if cur_il_raw != 0 {
                        let _ = tb3.ThumbBarSetImageList(main_hwnd, HIMAGELIST(cur_il_raw));
                    }
                    let _ = tb3.ThumbBarAddButtons(main_hwnd, &mk_buttons(playing, has_tracks));
                }
                buttons_added = true;
            }

            // ── Mise à jour play/pause ──
            CMD_PLAY_STATE => {
                playing = msg.wParam.0 != 0;
                *lock_recover(&PLAYING) = playing;
                if buttons_added {
                    let il = unsafe { build_image_list(playing) };
                    set_il(il, &mut cur_il_raw);
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

    // Nettoyer l'image list résiduelle
    if cur_il_raw != 0 {
        unsafe { let _ = ImageList_Destroy(HIMAGELIST(cur_il_raw)); }
    }
    // tb3 droppé ici → ITaskbarList3::Release() automatique
    // _com droppé ici → CoUninitialize() automatique
}

// ── API publique ─────────────────────────────────────────────────────────────

/// Initialise la thumbnail toolbar. Appelé une seule fois depuis main.rs au setup.
pub fn setup(hwnd_raw: isize, app: AppHandle) {
    unsafe { setup_impl(hwnd_raw, app) }
}

/// Met à jour l'icône Play/Pause.
pub fn update_play_state(playing: bool) {
    *lock_recover(&PLAYING) = playing;
    unsafe { refresh_toolbar() }
}

/// Active/désactive les boutons selon la présence de pistes.
pub fn update_has_tracks(has: bool) {
    *lock_recover(&HAS_TRACKS) = has;
    unsafe { refresh_toolbar() }
}

// ── Implémentation ───────────────────────────────────────────────────────────

unsafe fn setup_impl(hwnd_raw: isize, app: AppHandle) {
    let hwnd = HWND(hwnd_raw as *mut _);
    *lock_recover(&MAIN_HWND) = hwnd_raw;

    // Canal mpsc : seul try_send (non-bloquant, sans allocation) sera appelé depuis
    // le Win32 message-loop thread → aucun risque de panique à travers la FFI boundary.
    // Le receiver tourne dans le runtime Tokio et peut appeler win.emit() sans restriction.
    let (tx, mut rx) = mpsc::channel::<String>(8);
    BTN_TX.set(tx).ok();
    let app_for_rx = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(key) = rx.recv().await {
            if let Some(win) = app_for_rx.get_webview_window("main") {
                let _ = win.emit("media-key", key);
            }
        }
    });

    // Sous-classer la fenêtre pour intercepter WM_COMMAND des boutons thumbnail.
    // data = 0 : le subclass_proc n'a plus besoin de l'AppHandle (il utilise BTN_TX).
    let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_UID, 0);

    // Doit être appelé depuis le thread principal STA — ITaskbarList3 est STA-only.
    let _coinit_guard = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map(|_| ComGuard);
    let Ok(tb3) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL)
        else { return; };
    if tb3.HrInit().is_err() { return; }

    let playing    = *lock_recover(&PLAYING);
    let has_tracks = *lock_recover(&HAS_TRACKS);
    let il = build_image_list(playing);
    swap_il(il);
    let _ = tb3.ThumbBarSetImageList(hwnd, cur_il());
    let _ = tb3.ThumbBarAddButtons(hwnd, &mk_buttons(playing, has_tracks));
}

/// Reconstruit l'image list et met à jour les boutons.
/// Doit être appelé depuis le thread principal STA — ITaskbarList3 est STA-only.
unsafe fn refresh_toolbar() {
    let hwnd_raw = *lock_recover(&MAIN_HWND);
    if hwnd_raw == 0 { return; }
    let hwnd = HWND(hwnd_raw as *mut _);

    let playing    = *lock_recover(&PLAYING);
    let has_tracks = *lock_recover(&HAS_TRACKS);

    let _coinit_guard = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map(|_| ComGuard);
    let Ok(tb3) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL)
        else { return; };
    if tb3.HrInit().is_err() { return; }

    let il = build_image_list(playing);
    swap_il(il);                                           // détruit l'ancienne
    let _ = tb3.ThumbBarSetImageList(hwnd, cur_il());
    let _ = tb3.ThumbBarUpdateButtons(hwnd, &mk_buttons(playing, has_tracks));
}

// ── Boutons ──────────────────────────────────────────────────────────────────

fn mk_buttons(playing: bool, has_tracks: bool) -> [THUMBBUTTON; 3] {
    let nav_flags = if has_tracks {
        THBF_ENABLED | THBF_NOBACKGROUND
    } else {
        THBF_DISABLED | THBF_NOBACKGROUND
    };
    let play_flags = if has_tracks {
        THBF_ENABLED | THBF_NOBACKGROUND
    } else {
        THBF_DISABLED | THBF_NOBACKGROUND
    };
    let play_tip = if playing { "Pause" } else { "Play" };
    [
        thumb_btn(BTN_PREV, IMG_PREV, "Previous", nav_flags),
        thumb_btn(BTN_PLAY, IMG_PLAY, play_tip,   play_flags),
        thumb_btn(BTN_NEXT, IMG_NEXT, "Next",      nav_flags),
    ]
}

fn thumb_btn(id: u32, img: u32, tip: &str, flags: THUMBBUTTONFLAGS) -> THUMBBUTTON {
    let wide: Vec<u16> = tip.encode_utf16().collect();
    let mut tb = THUMBBUTTON {
        dwMask:  THB_BITMAP | THB_FLAGS | THB_TOOLTIP,
        iId:     id,
        iBitmap: img,
        dwFlags: flags,
        ..THUMBBUTTON::default()
    };
    let n = wide.len().min(tb.szTip.len() - 1);
    tb.szTip[..n].copy_from_slice(&wide[..n]);
    tb
}

// ── Image list ───────────────────────────────────────────────────────────────

unsafe fn build_image_list(playing: bool) -> HIMAGELIST {
    let icons = [
        make_icon_prev(),
        if playing { make_icon_pause() } else { make_icon_play() },
        make_icon_next(),
    ];
    let il = ImageList_Create(ICON_SIZE, ICON_SIZE, ILC_COLOR32, 3, 0);
    for &ic in &icons {
        if !ic.is_invalid() {
            ImageList_ReplaceIcon(il, -1, ic);
        }
        let _ = DestroyIcon(ic);
    }
    il
}

// ── Icônes GDI 24×24 ─────────────────────────────────────────────────────────
//
// Convention : fond noir (#000000), formes plein blanc (#FFFFFF).
// Les couleurs réelles dans la thumbnail toolbar sont remplacées par Windows
// selon le thème système → le noir devient transparent, le blanc devient
// la couleur de l'icône système (blanc en mode sombre, gris en mode clair).

unsafe fn make_icon<F: Fn(HDC)>(draw_fn: F) -> HICON {
    let s  = ICON_SIZE;      // 24 – taille finale dans l'image list
    let s2 = ICON_SIZE * 2;  // 48 – supersampling 2× pour anti-aliasing

    // Créer les deux DCs + bitmaps avant de relâcher le screen DC
    let hdc_screen = GetDC(HWND(std::ptr::null_mut()));
    let draw_dc  = CreateCompatibleDC(hdc_screen);
    let draw_bm  = CreateCompatibleBitmap(hdc_screen, s2, s2);
    let color_dc = CreateCompatibleDC(hdc_screen);
    let color_bm = CreateCompatibleBitmap(hdc_screen, s, s);
    ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);

    // ── Dessiner à 2× dans draw_dc ────────────────────────────────
    let old_draw_bm = SelectObject(draw_dc, HGDIOBJ(draw_bm.0));

    let black_brush: HBRUSH = CreateSolidBrush(COLORREF(0x0000_0000));
    let full_rect = RECT { left: 0, top: 0, right: s2, bottom: s2 };
    FillRect(draw_dc, &full_rect, black_brush);
    let _ = DeleteObject(HGDIOBJ(black_brush.0));

    let white_pen:   HPEN   = CreatePen(PS_SOLID, 0, COLORREF(0x00FF_FFFF));
    let white_brush: HBRUSH = CreateSolidBrush(COLORREF(0x00FF_FFFF));
    let old_pen  = SelectObject(draw_dc, HGDIOBJ(white_pen.0));
    let old_brsh = SelectObject(draw_dc, HGDIOBJ(white_brush.0));

    draw_fn(draw_dc);

    SelectObject(draw_dc, old_pen);
    SelectObject(draw_dc, old_brsh);
    let _ = DeleteObject(HGDIOBJ(white_pen.0));
    let _ = DeleteObject(HGDIOBJ(white_brush.0));

    // ── Réduire 48×48 → 24×24 avec HALFTONE (anti-aliasing) ──────
    // HALFTONE = 4 : moyenne pondérée des pixels sources → bords lisses
    // SetBrushOrgEx est requis par MSDN après SetStretchBltMode(HALFTONE)
    let old_color_bm = SelectObject(color_dc, HGDIOBJ(color_bm.0));
    SetStretchBltMode(color_dc, STRETCH_BLT_MODE(4));
    let _ = SetBrushOrgEx(color_dc, 0, 0, None);
    let _ = StretchBlt(color_dc, 0, 0, s, s, draw_dc, 0, 0, s2, s2, SRCCOPY);
    SelectObject(color_dc, old_color_bm);
    let _ = DeleteDC(color_dc);

    // Nettoyer le DC de dessin
    SelectObject(draw_dc, old_draw_bm);
    let _ = DeleteObject(HGDIOBJ(draw_bm.0));
    let _ = DeleteDC(draw_dc);

    // ── Créer l'HICON depuis color_bm ─────────────────────────────
    // Masque monochrome tout à zéro = zones opaques partout
    let mask_bm: HBITMAP = CreateBitmap(s, s, 1, 1, None);
    let ii = ICONINFO {
        fIcon:    BOOL(1),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask:  mask_bm,
        hbmColor: color_bm,
    };
    let icon = CreateIconIndirect(&ii).unwrap_or(HICON(std::ptr::null_mut()));
    let _ = DeleteObject(HGDIOBJ(color_bm.0));
    let _ = DeleteObject(HGDIOBJ(mask_bm.0));
    icon
}

// ⏮ Précédent : barre verticale gauche + triangle pointant à gauche
// Coordonnées à 2× (espace 48×48) — downscalé à 24×24 avec HALFTONE
unsafe fn make_icon_prev() -> HICON {
    make_icon(|dc| {
        let bar = [
            POINT { x: 6,  y: 6  }, POINT { x: 12, y: 6  },
            POINT { x: 12, y: 42 }, POINT { x: 6,  y: 42 },
        ];
        let _ = Polygon(dc, &bar);
        let tri = [
            POINT { x: 42, y: 6  },
            POINT { x: 42, y: 42 },
            POINT { x: 14, y: 24 },
        ];
        let _ = Polygon(dc, &tri);
    })
}

// ▶ Lecture : triangle pointant à droite, centré
// Coordonnées à 2× (espace 48×48)
unsafe fn make_icon_play() -> HICON {
    make_icon(|dc| {
        let tri = [
            POINT { x: 7,  y: 6  },
            POINT { x: 7,  y: 42 },
            POINT { x: 41, y: 24 },
        ];
        let _ = Polygon(dc, &tri);
    })
}

// ⏸ Pause : deux barres verticales
// Coordonnées à 2× (espace 48×48)
unsafe fn make_icon_pause() -> HICON {
    make_icon(|dc| {
        let b1 = [
            POINT { x: 8,  y: 6  }, POINT { x: 18, y: 6  },
            POINT { x: 18, y: 42 }, POINT { x: 8,  y: 42 },
        ];
        let _ = Polygon(dc, &b1);
        let b2 = [
            POINT { x: 30, y: 6  }, POINT { x: 40, y: 6  },
            POINT { x: 40, y: 42 }, POINT { x: 30, y: 42 },
        ];
        let _ = Polygon(dc, &b2);
    })
}

// ⏭ Suivant : triangle pointant à droite + barre verticale droite
// Coordonnées à 2× (espace 48×48)
unsafe fn make_icon_next() -> HICON {
    make_icon(|dc| {
        let tri = [
            POINT { x: 6,  y: 6  },
            POINT { x: 6,  y: 42 },
            POINT { x: 34, y: 24 },
        ];
        let _ = Polygon(dc, &tri);
        let bar = [
            POINT { x: 36, y: 6  }, POINT { x: 42, y: 6  },
            POINT { x: 42, y: 42 }, POINT { x: 36, y: 42 },
        ];
        let _ = Polygon(dc, &bar);
    })
}

// ── Subclass proc ─────────────────────────────────────────────────────────────

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_COMMAND {
        let btn_id = (wparam.0 & 0xFFFF) as u32;
        let key = match btn_id {
            BTN_PREV => Some("prev"),
            BTN_PLAY => Some("toggle-play"),
            BTN_NEXT => Some("next"),
            _        => None,
        };
        if let Some(k) = key {
            // try_send est non-bloquant et sans panique → sûr depuis un callback Win32 FFI.
            // Le receiver Tokio (spawné dans setup_impl) appellera win.emit() côté async.
            if let Some(tx) = BTN_TX.get() {
                let _ = tx.try_send(k.to_string());
            }
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
