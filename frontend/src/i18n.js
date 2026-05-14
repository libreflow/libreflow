// LibreFlow — Localisation strings
//
// LANGS is the single source of truth for all UI text.
// i18n(key, ...args) lives in app.js because it reads the app-level `lang` var.
// Import LANGS here when you need direct dict access (e.g. language pickers).

import { toast }        from './ui.js';
import { emit, EVENTS } from './bus.js';
import { applyTheme } from './settings.js';
import { setCrossfade } from './player.js';
import { updateStats } from './renderer.js';
import { get } from './store.js';

export const LANGS = {
  fr: {
    // Nav
    nav_all:        'Tous les titres',
    nav_liked:      'Favoris',
    nav_artists:    'Artistes',
    nav_albums:     'Albums',
    nav_recent:     'Récemment écoutés',
    nav_radio:      'Radio',
    nav_stats:      'Statistiques',
    nav_playlists:  'Playlists',
    sb_group_lib:      'Bibliothèque',
    sb_group_explore:  'Parcourir',
    sb_group_discover: 'Découvrir',
    // Sidebar
    sb_empty:       'Aucune musique importée',
    sb_tracks:      (n) => `<b>${n}</b> titre${n!==1?'s':''}`,
    sb_artists:     (n) => `<b>${n}</b> artiste${n!==1?'s':''}`,
    sb_albums:      (n) => `<b>${n}</b> album${n!==1?'s':''}`,
    n_tracks:       'titres',
    btn_scan:       'Scanner un dossier',
    btn_clear:      'Vider la bibliothèque',
    // Welcome
    wlc_title:      'Bienvenue sur LibreFlow',
    wlc_sub:        'Ton lecteur audio local. Tes musiques, sans streaming, sans pub.',
    wlc_feat1_t:    'Scan & tags auto',
    wlc_feat1_d:    'Dossiers, pochettes et métadonnées extraits automatiquement',
    wlc_feat2_t:    'Playlists & Smart Radio',
    wlc_feat2_d:    'Playlists manuelles, intelligentes et radio par affinité',
    wlc_feat3_t:    'EQ & qualité audio',
    wlc_feat3_d:    'Égaliseur 10 bandes, ReplayGain, crossfade et visualiseur',
    wlc_feat4_t:    'Stats & historique',
    wlc_feat4_d:    "Artistes, albums, genres et calendrier d'écoute",
    wlc_btn:        'Choisir mon dossier Musique',
    wlc_btn_m3u:    'Importer une playlist M3U',
    wlc_hint:       'ou glisse-dépose des fichiers audio dans la fenêtre',
    // Scan
    scan_title:     'Lecture en cours…',
    scan_sub:       'fichiers audio chargés',
    // Library
    lib_all:        'Tous les titres',
    lib_liked:      'Favoris',
    lib_artists:    'Artistes',
    lib_albums:     'Albums',
    lib_genres:     'Genres',
    lib_radio:      'Radio',
    lib_recent:     'Récemment écoutés',
    srch_ph:        'Rechercher…',
    srch_disabled:  'Recherche non disponible',
    sort_az:        'A–Z',
    sort_za:        'Z–A',
    sort_artist:    'Artiste',
    sort_album:     'Album',
    sort_recent:    'Récent',
    sort_count_lbl:    'Titres',
    sort_year_lbl:     'Année',
    sort_btn_artists:  'Trier les artistes',
    sort_btn_genres:   'Trier les genres',
    sort_btn_track_num:'Trié par n° de piste',
    sort_btn_az_ttl:   'Trié A–Z',
    sort_by_track_lbl: '# Piste',
    // Player
    tb_minimize:    'Réduire',
    tb_maximize:    'Agrandir',
    tb_restore:     'Restaurer',
    tb_close:       'Fermer',
    tb_settings:    'Paramètres',
    pc_shuffle:     'Aléatoire [S]',
    pc_prev:        'Précédent [←]',
    pc_next:        'Suivant [→]',
    pc_repeat:      'Répétition [R]',
    pc_play:        'Play/Pause [Espace]',
    // Empty states
    no_results:     'Aucun résultat',
    empty_lib_h:    'Bibliothèque vide',
    empty_lib_s:    'Clique sur « Scanner un dossier »',
    empty_search_h: 'Aucun résultat',
    empty_search_s: 'Essaie un autre terme',
    empty_recent_h: 'Aucun titre écouté',
    empty_recent_s: 'Lance une musique pour commencer',
    empty_liked_h:  'Aucun favori',
    empty_liked_s:  'Clique sur ♥ pour ajouter des titres à tes favoris',
    empty_drill_h:  'Aucun titre trouvé',
    empty_drill_s:  'Cette vue ne contient aucun titre correspondant',
    empty_pl_h:     'Playlist vide',
    empty_pl_s:     "Glisse des titres ici ou fais un clic droit pour les ajouter",
    // Playlist
    pl_empty:           'Aucune playlist',
    pl_empty_s:         'Crée ta première playlist pour organiser ta musique',
    pl_nav_no_match:    'Aucun résultat',
    pl_nav_search:      'Filtrer…',
    pl_section_pinned:  'Épinglées',
    pl_section_recent:  'Récentes',
    pl_section_all:     'Toutes les playlists',
    pl_folder_empty:    'Dossier vide',
    // S157 FIX-6 : clés i18n manquantes (avant : fallbacks hardcodés en français dans playlists.js)
    pl_more:                'Plus d\'actions',
    pl_pin:                 'Épingler',
    pl_unpin:               'Désépingler',
    pl_folder_rename:       'Renommer',
    pl_folder_delete:       'Supprimer le dossier',
    pl_folder_rename_prompt:'Nouveau nom du dossier',
    pl_folder_del_h:        'Supprimer le dossier',
    pl_folder_del_body:     'Les playlists à l\'intérieur seront déplacées au niveau racine.',
    pl_move_to_folder:      'Déplacer vers…',
    pl_remove_from_folder:  'Retirer du dossier',
    t_pl_folder_deleted:    'Dossier supprimé',
    pl_new:             'Nouvelle playlist',
    pl_name_ph:     'Nom de la playlist…',
    pl_create:      'Créer',
    pl_cancel:      'Annuler',
    btn_cancel:     'Annuler',
    // Smart playlist modal
    spl_title:      'Playlist intelligente',
    spl_mode_seed:  'Similarité',
    spl_mode_rules: 'Règles',
    spl_seed_desc:  'Génère une playlist cohérente à partir d\'un titre de base. LibreFlow analyse l\'artiste, le genre et l\'album pour construire une sélection musicalement cohérente.',
    spl_match:      'Correspondre à',
    spl_comb_all:   'toutes les règles (ET)',
    spl_comb_any:   'au moins une (OU)',
    spl_add_rule:   'Ajouter une règle',
    spl_max:        'Titres max',
    spl_all:        'Tous',
    spl_name:       'Nom de la playlist',
    spl_preview_btn:'Aperçu',
    spl_create_btn: 'Créer',
    pl_play_all:    'Tout lire',
    pl_shuffle:     'Aléatoire',
    pl_delete:      'Supprimer',
    pl_modal_h:     'Nouvelle playlist',
    pl_new_dots:    'Nouvelle playlist…',
    pl_add_to:      'Ajouter à une playlist',
    pl_remove:      'Retirer de la playlist',
    pl_rename_title: 'Renommer la playlist',
    pl_rename_btn:   'Renommer',
    pl_cover_pick:   'Choisir une image',
    pl_cover_rm:     'Retirer',
    t_pl_cover_fail: 'Impossible de charger cette image',
    pl_add_to_hd:    'Ajouter à',
    pl_smart_lbl:    'Intelligente',
    pl_regen_btn:    'Régénérer',
    pl_liked_count:  (n) => `${n} favori${n!==1?'s':''}`,
    // S92 — Tri + hero
    pl_sort_label:    'Trier',
    pl_sort_manual:   'Manuel',
    pl_sort_az:       'Titre A→Z',
    pl_sort_za:       'Titre Z→A',
    pl_sort_artist:   'Artiste',
    pl_sort_album:    'Album',
    pl_sort_duration: 'Durée',
    pl_hero_playlist: 'Playlist',
    pl_hero_edit:     'Modifier le cover',
    // Confirmation suppression playlist
    pl_delete_confirm_h:    (name) => `Supprimer « ${name} » ?`,
    pl_delete_confirm_body: (n) => `${n} titre(s) seront retirés de la playlist (les fichiers restent sur le disque).`,
    pl_delete_confirm_btn:  'Supprimer',
    // Toast déplacement dossier
    t_pl_moved_to_folder:     (name) => `Déplacée dans « ${name} »`,
    t_pl_removed_from_folder: 'Retirée du dossier',
    // Context menu — ctxmenu.js
    ctx_new_pl:       'Nouvelle playlist…',
    ctx_like:         'Liker',
    ctx_unlike:       'Retirer des favoris',
    ctx_go_artist:    (name) => `Voir ${name}`,
    ctx_go_album:     (name) => `Voir « ${name} »`,
    ctx_liked_toast:  '♥ Liké',
    ctx_unliked_toast:'♡ Retiré des favoris',
    ctx_write_rg:      'Écrire le gain RG dans les tags',
    t_rg_writing:      'Écriture des tags ReplayGain…',
    t_rg_written:     (name) => `Tags RG écrits dans « ${name} »`,
    t_rg_write_err:   (err)  => `Erreur écriture RG : ${err}`,
    ctx_delete_h:     (name) => `Supprimer « ${name} » ?`,
    ctx_delete_body:  'Le titre sera retiré de la bibliothèque. Le fichier sur le disque ne sera <strong>pas</strong> supprimé.',
    ctx_delete_btn:   'Supprimer',
    ctx_deleted_toast:(name) => `🗑 « ${name} » supprimé`,
    unknown_artist:   'Artiste inconnu',
    // Clear modal
    clear_h:        'Vider la bibliothèque ?',
    clear_body:     'Tous les titres importés, les pochettes et les favoris seront supprimés.<br>Tes fichiers audio sur le disque ne seront <strong>pas</strong> affectés.',
    clear_cancel:   'Annuler',
    clear_confirm:  'Vider quand même',
    // Settings
    settings:             'Paramètres',
    set_language_section: 'Langue / Language',
    set_language_label:   "Langue de l'interface",
    set_language_sub:     "Appliqué immédiatement",
    set_library_section:  'Bibliothèque',
    set_clear_label:      'Vider la bibliothèque',
    set_clear_sub:        'Supprime tous les titres importés',
    set_clear_btn:        'Vider',
    set_about_section:    'À propos',
    set_about_desc:       'Lecteur audio local pour Windows. Aucune donnée envoyée.',
    // Drag
    drag_hint:      'Dépose tes fichiers ici',
    // Toast
    t_scan_in_progress: 'Scan déjà en cours…',
    t_no_audio:     'Aucun fichier audio trouvé',
    t_no_loaded:    'Aucun fichier audio chargé',
    t_not_found:    '⚠ Fichier introuvable — rescannes le dossier',
    t_decode_err:   '⚠ Fichier corrompu — impossible de le lire',
    t_playback_err:   '⚠ Erreur de lecture — passage au suivant',
    t_consec_errors:  '⚠ Trop d\'erreurs consécutives — lecture stoppée',
    t_play_start_err: (msg) => `⚠ Impossible de lire : ${msg}`,
    t_drag_hint:     'Glisse des MP3, FLAC, AAC…',
    t_cleared:       '🗑️ Bibliothèque vidée',
    t_pl_deleted:    'Playlist supprimée',
    t_pl_pinned:     '📌 Playlist épinglée',
    t_pl_unpinned:   'Playlist désépinglée',
    aria_search:    'Rechercher dans la bibliothèque',
    aria_srch_clear:'Effacer la recherche',
    aria_like:      'Ajouter aux favoris',
    aria_pbar:      'Position de lecture',
    aria_vol:       'Volume',
    aria_play:      'Lecture / Pause',
    aria_shuffle:   'Lecture aléatoire',
    aria_prev:      'Titre précédent',
    aria_next:      'Titre suivant',
    a11y_skip_link: 'Aller au contenu principal',
    // ── Aria labels supplémentaires ────────────────────────────
    aria_eq_close:       "Fermer l'égaliseur",
    aria_eq_cats:        'Catégories de presets EQ',
    aria_sel_add_pl:     'Ajouter à une playlist',
    aria_sel_like:       'Liker / Déliker',
    aria_sel_tags:       'Éditer les tags',
    aria_sel_delete:     'Supprimer de la bibliothèque',
    aria_sel_cancel:     'Annuler la sélection',
    aria_album_sort:     'Trier les albums',
    aria_sleep:          'Minuterie sommeil',
    aria_cinema_bg:      "Changer l'arrière-plan du cinéma",
    aria_cinema_fs:      'Basculer en plein écran',
    aria_cinema_close:   'Fermer le mode cinéma',
    aria_cinema_radio:   'Activer la radio intelligente',
    aria_mini_close:     'Fermer le mini-player',
    // ── Aria labels supplémentaires — Pass 4 (i18n) ────────────
    aria_boot_spinner:       'Chargement de LibreFlow…',
    aria_nav_main:           'Navigation principale',
    aria_now_playing_view:   'En cours de lecture',
    aria_player_bar:         'Contrôles de lecture',
    aria_toggle_now_playing: 'Voir la piste en cours',
    aria_sleep_menu:         'Minuterie sommeil',
    aria_pl_cover_pick:      'Choisir une image de couverture',
    aria_smart_seed_search:  'Rechercher un titre de base',
    aria_ctx_menu:           'Actions pour ce titre',
    aria_close_settings:     'Fermer les paramètres',
    aria_queue_panel:        "File d'attente",
    aria_scroll_to_current:  'Aller à la piste en cours',
    aria_close_queue:        "Fermer la file d'attente",
    aria_eq_mode_group:      'Mode EQ',
    aria_repeat:             'Mode répétition',
    aria_theme_green:        'Vert',
    aria_theme_blue:         'Bleu',
    aria_theme_purple:       'Violet',
    aria_theme_red:          'Rouge',
    aria_theme_orange:       'Orange',
    aria_theme_pink:         'Rose',
    aria_theme_cyan:         'Cyan',
    // ── Titles (tooltips) traduits ──────────────────────────────
    t_cinema_fs:         'Plein écran [F]',
    t_cinema_close:      'Fermer [C / Échap]',
    t_cinema_like:       'Favori',
    t_cinema_radio:      'Radio intelligente [R]',
    t_mini_close:        'Fermer [I]',
    t_already_in:   'Déjà dans cette playlist',
    t_removed:      'Retiré de la playlist',
    t_undo:         'Annuler',
    t_undo_done:    'Annulé',
    t_smart_no_seed:    'Aucun titre sélectionné',
    t_smart_seed_first: 'Sélectionne un titre de base d\'abord',
    t_smart_no_match:   'Aucun titre correspondant trouvé',
    t_smart_no_regen:   'Aucun titre trouvé pour régénérer',
    t_smart_pl_created: (name, n) => `Playlist « ${name} » créée (${n} titres)`,
    t_smart_pl_regen:   (n) => `Playlist régénérée (${n} titres)`,
    t_shuffle_on:   '🔀 Aléatoire',
    t_shuffle_off:  'Aléatoire désactivé',
    t_repeat_none:  'Répétition désactivée',
    t_repeat_all:   '🔁 Répéter tout',
    t_repeat_one:   '🔂 Répéter ce titre',
    t_recent_ignores_filter: '🔀 Tri "récent" : la recherche ne filtre pas la navigation',
    t_loaded:       (n) => `${n} titre${n!==1?'s':''} chargés`,
    t_session_restored: (title) => `▶ Session restaurée · ${title}`,
    t_scanned:          (n) => `✅ ${n} nouveau${n!==1?'x':''} titre${n!==1?'s':''}`,
    t_already_imported: 'Tous les fichiers sont déjà dans la bibliothèque',
    t_rg_prompt:        (n) => `${n} nouvelle${n!==1?'s':''} piste${n!==1?'s':''} sans normalisation du volume`,
    t_rg_enable_btn:    'Activer ReplayGain',
    t_short_tracks_skipped: (n) => `${n} piste${n!==1?'s':''} ignorée${n!==1?'s':''} — durée < 20 s`,
    t_recognized:   (n) => `${n} titres reconnus`,
    t_files_added:  (n) => `✅ ${n} fichier${n!==1?'s':''} ajouté${n!==1?'s':''}`,
    t_added_to:     (name) => `✅ Ajouté à « ${name} »`,
    t_pl_created:   (name) => `Playlist « ${name} » créée`,
    t_pl_renamed:   (name) => `Playlist renommée en « ${name} »`,
    t_pl_name_required: 'Donne un nom à ta playlist',
    // Titlebar
    sans_album:     'Sans album',
    recent_count:   (n) => `${n} titre${n!==1?'s':''} récemment écoutés`,
    track_count:    (n) => `${n} titre${n!==1?'s':''}`,
    // Genres
    nav_genres:           'Genres',
    // Settings — sections
    set_theme_section:    'Thème de couleur',
    set_rg_section:       'Normalisation du volume',
    set_crossfade_section:'Fondu enchaîné',
    set_mini_section:     'Mini-player',
    // Settings — visualiseur
    set_viz_section:      'Visualiseur',
    set_viz_label:        'Forme du visualiseur',
    set_viz_sub:          'Apparence de la barre de lecture',
    set_viz_bars:         'Barres',
    set_viz_osc:          'Oscilloscope',
    set_viz_circle:       'Cercle',
    set_viz_toggle_label: 'Visualiseur actif',
    set_viz_toggle_sub:   'Afficher le visualiseur dans la barre de lecture',
    set_viz_on:           'Activé',
    set_viz_off:          'Désactivé',
    // Settings — accent dynamique
    set_dyn_label:        'Accent dynamique',
    set_dyn_sub:          'Suit la couleur de la pochette',
    set_dyn_on:           'Activé',
    set_dyn_off:          'Désactivé',
    // Settings — mode
    set_mode_label:       "Mode d'affichage",
    set_mode_dark:        'Sombre',
    set_mode_light:       'Clair',
    // Settings — replay gain
    set_rg_label:         'Replay Gain',
    set_rg_sub:           'Égalise le volume entre les pistes',
    set_rg_target_sub:    'Volume cible (-23 broadcast → -9 fort)',
    // Settings — crossfade
    set_cf_label:         'Durée du fondu',
    set_cf_sub:           'Transition entre chaque piste',
    // Settings — mini
    set_mini_label:       'Fenêtre flottante',
    set_mini_sub:         "Contrôles visibles sur l'écran",
    set_mini_btn:         'Ouvrir',
    // Settings — library extra
    set_add_folder_label: 'Ajouter un dossier',
    set_add_folder_sub:   'Importer un dossier de musique dans la bibliothèque',
    set_add_folder_btn:   'Parcourir…',
    set_rescan_label:     'Rescanner les tags',
    set_rescan_sub:       'Recharger les métadonnées depuis les fichiers',
    set_rescan_btn:       'Rescanner',
    set_dupes_label:      'Détecter les doublons',
    set_dupes_sub:        'Trouver les titres en double dans la bibliothèque',
    set_dupes_btn:        'Analyser',
    set_watch_label:      'Dossier surveillé',
    set_watch_change_btn: 'Changer…',
    set_interop_label:    'Interopérabilité',
    set_interop_sub:      'Import / export de playlists au format M3U',
    set_export_label:     'Export playlist M3U',
    set_export_sub:       'Exporter la playlist active au format M3U',
    set_export_btn:       'Exporter',
    set_xspf_label:       'Export playlist XSPF',
    set_xspf_sub:         'Format compatible VLC, foobar2000, Strawberry',
    set_xspf_btn:         'Exporter XSPF',
    set_import_label:     'Import playlist M3U',
    set_import_sub:       'Importer une playlist depuis un fichier .m3u',
    set_import_btn:       'Importer',
    // Settings — about
    set_app_name:         'LibreFlow',
    set_app_version:      'v1.0.0',
    // Titlebar tooltips
    tb_mode:              'Thème clair / sombre',
    tb_shortcuts:         'Raccourcis clavier [?]',
    tb_cinema:            'Mode cinéma [C]',
    tb_mini:              'Mini-player [M]',
    // Sidebar playlist section
    sb_smart_pl:          'Playlist intelligente',
    sb_new_pl:            'Nouvelle playlist',
    // Sort & selection
    sort_albums_title:    'Trier les albums',
    sel_cancel:           'Annuler la sélection',
    sel_add_pl:           'Playlist',
    sel_like:             'Liker',
    sel_tags:             'Tags',
    sel_delete:           'Supprimer',
    // Player-right tooltips
    pl_queue_title:       "File d'attente",
    pl_eq_title:          'Égaliseur',
    pl_speed_title:       'Vitesse de lecture [X]',
    spd_label:            (n) => 'Vitesse : ' + n + 'x',
    pl_sleep_title:       'Minuterie sommeil',
    pl_radio_title:       'Radio intelligente',
    // Sleep menu
    sleep_opt_15:         '15 minutes',
    sleep_opt_30:         '30 minutes',
    sleep_opt_45:         '45 minutes',
    sleep_opt_60:         '1 heure',
    sleep_opt_90:         '1 h 30',
    sleep_opt_120:        '2 heures',
    sleep_opt_end:        '⏹ Fin du titre',
    sleep_opt_cancel:     'Annuler',
    sleep_ph:             'min…',
    // Shortcuts panel
    sc_title:             'Raccourcis clavier',
    sc_close:             'Fermer',
    // Dupes
    dupes_title:          'Doublons trouvés',
    dupes_none:           'Aucun doublon trouvé 🎉',
    dupes_keep:           'Garder',
    dupes_delete:         'Supprimer',
    dupes_delete_all:     'Tout supprimer',
    // Watch folder
    watch_disabled:       'Surveillance désactivée',
    // Toast extras
    t_watch_active:       (path) => `👁 Surveillance : ${path}`,
    t_watch_off:          '👁 Surveillance désactivée',
    t_new_files:          (n) => `✅ ${n} nouveau${n!==1?'x':''} fichier${n!==1?'s':''} détecté${n!==1?'s':''}`,
    t_rescan_empty:        '⚠ Aucun titre à rescanner',
    t_rescan_start:        '🔄 Rescan en cours…',
    t_rescan_done:        (n) => `🔄 ${n} titre${n!==1?'s':''} rescanné${n!==1?'s':''}`,
    t_genre_lib_empty:     '⚠ Bibliothèque vide',
    t_genre_all_done:      '✅ Tous les genres sont déjà détectés',
    t_genre_start:         (n, force) => `🎵 ${force ? 'Recalcul' : 'Détection'} genre sur ${n} titre${n!==1?'s':''}…`,
    t_genre_done:          (n) => `🎵 ${n} genre${n!==1?'s':''} détecté${n!==1?'s':''}`,
    t_cinema_bg:           (label) => `🎬 Arrière-plan : ${label}`,
    t_watch_stopped:       '👁 Surveillance désactivée',
    t_update_available:    (v) => `🆕 Mise à jour disponible : v${v}`,
    t_update_install:      'Installer',
    t_update_downloading:  '⬇ Téléchargement en cours…',
    t_update_progress:     (pct) => `⬇ Téléchargement… ${pct}%`,
    t_update_installing:   '⚙ Installation en cours…',
    t_update_error:        (e) => `❌ Erreur de mise à jour : ${e}`,
    t_update_uptodate:     '✅ LibreFlow est à jour',
    t_update_checking:     '🔍 Vérification…',
    t_update_check_btn:    'Vérifier maintenant',
    // Tag editor labels
    te_title:              'Titre',
    te_artist:             'Artiste',
    te_album:              'Album',
    te_genre:              'Genre',
    te_year:               'Année',
    te_track_num:          '#',
    te_hint:               'Entrée pour sauvegarder · Échap pour annuler',
    te_save:               'Sauvegarder',
    te_cancel:             'Annuler',
    t_dupes_deleted:      (n) => `🗑 ${n} doublon${n!==1?'s':''} supprimé${n!==1?'s':''}`,
    t_artwork_retry:      (n) => `Pochettes manquantes : récupération de ${n}…`,
    t_artwork_retry_done: (n) => `🖼 ${n} pochette${n!==1?'s':''} récupérée${n!==1?'s':''}`,
    // Batch tag edit
    t_batch_tag_saving:   'Sauvegarde des tags…',
    t_batch_tag_done:     (n) => `✏ ${n} titre${n!==1?'s':''} mis à jour`,
    t_batch_tag_done_err: (n, f) => `✏ ${n} mis à jour (${f} échec${f!==1?'s':''})`,
    t_batch_tag_none:     'Aucun tag modifié',
    // Sleep timer
    // Context menu
    t_queue_play_next:          '⏭ Lire ensuite',
    t_queue_added_end:          '⏬ Ajouté à la file',
    t_queue_filter_cleared:     '🔍 Recherche effacée pour jouer ce titre',
    t_queue_ended:              'File d\'attente terminée — reprise de la lecture normale',
    t_ctx_copied:          '📋 Copié dans le presse-papiers',
    // Sleep timer
    t_sleep_set:           (m) => `⏱ Extinction dans ${m} min`,
    t_sleep_cancel:        '⏱ Minuterie annulée',
    t_sleep_warn_1min:     '⏱ Extinction dans 1 minute…',
    t_sleep_done:          '⏱ Extinction — bonne nuit !',
    t_sleep_end_track:     '⏱ Arrêt après le titre en cours',
    t_sleep_end_track_done:'⏱ Extinction — bonne nuit !',
    // Queue
    queue_title:          "File d'attente",
    queue_empty:          "File vide",
    // EQ
    eq_title:             'Égaliseur',
    eq_reset:             'Réinitialiser',
    // Shortcuts panel descriptions
    sc_prev:          'Titre précédent',
    sc_next:          'Titre suivant',
    sc_vol_up:        'Volume +',
    sc_vol_down:      'Volume –',
    sc_shuffle:       'Aléatoire',
    sc_repeat:        'Répétition',
    sc_ctx_cinema:    '· Radio en mode cinéma',
    sc_like:          'Ajouter / retirer des favoris',
    sc_search:        'Focuser la recherche',
    sc_cinema:        'Mode cinéma',
    sc_dupes:         'Détecter les doublons',
    sc_viz_cycle:     'Visualiseur (cycle barres → oscilloscope → cercle)',
    sc_speed:         'Vitesse de lecture (cycle)',
    eq_reset_title:   'Remettre à plat (0 dB)',
    eq_mode_simple:   'Simple',
    eq_mode_expert:   'Expert',
    sc_shortcuts_key: 'Afficher cette aide',
    sc_esc:           'Fermer / Vider la recherche',
    sc_fullscreen:    'Plein écran',
    set_rg_target_label: 'Cible',
    aria_rg_target:       'Volume cible ReplayGain',
    // Watch folder
    set_watch_sub:    'Surveiller un dossier pour nouvelles musiques',
    // A11Y — labels non visibles (aria-label)
    nav_home:         'Accueil',
    vol_label:        'Volume',
    pbar_label:       'Position de lecture',
    like_label:       'Ajouter aux favoris',
    unlike_label:     'Retirer des favoris',
    tr_edit_tags:     'Modifier les tags (double-clic)',
    tr_add_to_pl:     'Ajouter à une playlist',
    aria_track_row:   (title, artist, dur) => dur ? `${title}, ${artist}, ${dur}` : `${title}, ${artist}`,
    srch_clear:       'Effacer la recherche',
    theme_green:      'Vert',
    theme_blue:       'Bleu',
    theme_purple:     'Violet',
    theme_red:        'Rouge',
    theme_orange:     'Orange',
    theme_pink:       'Rose',
    theme_cyan:       'Cyan',
    set_cinema_ambient:  'Gradient coloré depuis la pochette',
    set_cinema_spectrum: 'Visualiseur audio plein écran',
    set_cinema_amoled:   'Noir pur — optimal OLED',
    set_lib_tab:             'Bibliothèque',
    set_cinema_section:      'Mode Cinéma',
    set_cinema_bg_label:     'Arrière-plan',
    set_cinema_bg_sub:       'Fond affiché derrière la pochette',
    set_cinema_ambient_label:'Ambient',
    set_cinema_spectrum_label:'Spectre',
    set_genres_label:        'Détecter les genres',
    set_genres_sub:          'Détecte automatiquement les genres manquants',
    set_genres_btn:          'Détecter',
    set_shortcuts_section:   'Raccourcis clavier',
    set_shortcuts_label:     'Aide & raccourcis',
    set_shortcuts_btn:       'Afficher',
    set_reset_section:       'Réinitialisation',
    set_updates_section:     'Mises à jour',
    set_update_auto_label:   'Vérifier les mises à jour au lancement',
    set_update_manual_label: 'Vérifier manuellement',
    set_cache_label:         'Vider les caches',
    set_cache_sub:           "Supprime toutes les données de l'application (bibliothèque, config, playlists, historique) puis redémarre",
    set_cache_btn:           'Vider les caches',
    // Radio
    radio_need_more:      'Ajoute au moins 3 titres pour utiliser la radio',
    radio_restart_title:  'Radio déjà en cours',
    radio_restart_body:   'Veux-tu relancer la radio depuis un nouveau titre de départ ?',
    radio_restart_btn:    'Relancer',
    radio_no_track:       'Aucun titre disponible pour la radio',
    radio_started:        (name) => `📻 Radio lancée depuis « ${name} »`,
    radio_stop_title:     'Arrêter la radio ?',
    radio_stop_body:      (n) => `La file de ${n} titre${n>1?'s':''} sera perdue.`,
    radio_stop_btn:       'Arrêter',
    radio_stopped:        '📻 Radio arrêtée',
    radio_see_queue:      'Voir la file radio',
    radio_start_lbl:      'Lancer la radio',
    radio_stop_lbl:       'Arrêter la radio',
    radio_active_lbl:     'Radio active',
    radio_see_file:       'Voir la file',
    radio_save_lbl:       'Sauvegarder',
    radio_no_seed:        'Aucun titre sélectionné pour la radio',
    radio_regen_need:     'Lance d\'abord un titre pour regénérer la radio',
    radio_regen_done:     (name) => `📻 Radio regénérée depuis « ${name} »`,
    radio_pl_name:        (name) => `📻 Radio – ${name}`,
    radio_pl_saved:       (name, n) => `💾 Playlist « ${name} » créée — ${n} titre${n>1?'s':''}`,
    radio_pl_see:         'Voir →',
    radio_pl_empty:       'Aucun titre à sauvegarder',
    radio_track_nf:       'Titre introuvable dans la bibliothèque',
    radio_empty_title:    'Aucune radio en cours',
    radio_empty_sub:      'Lance une radio depuis un titre pour découvrir de la musique similaire.',
    radio_start_current:  'Lancer depuis le titre en cours',
    radio_header_lbl:     'Radio',
    radio_queue_ct:       (n) => `· ${n} titre${n!==1?'s':''}`,
    radio_regen_btn:      'Regénérer',
    radio_save_btn:       'Sauvegarder',
    radio_seed_lbl:       'Graine radio',
    radio_queue_fill:     'La file se remplira automatiquement après le prochain titre.',
    radio_next_tracks:    'Prochains titres',
    radio_start_need:     'Lance d\'abord un titre pour démarrer la radio',
    radio_play_track:     'Jouer ce titre maintenant',
    radio_remove_track:   'Retirer de la file',
    // Duplicates panel
    t_no_dupes:            '✅ Aucun doublon trouvé !',
    t_remove_dupe_h:       'Retirer ce doublon ?',
    t_remove_dupe_body:    (name) => `« ${name} » sera supprimé de la bibliothèque.`,
    t_delete_btn:          'Supprimer',
    t_dupe_group_head:     (n, name) => `⚠ ${n} versions — ${name}`,
    t_dupe_remove_btn:     'Retirer',
    // M3U / XSPF import / export
    t_m3u_no_export:       'Aucun titre à exporter',
    t_m3u_exported:        '💾 Playlist exportée en M3U',
    t_xspf_exported:       '💾 Playlist exportée en XSPF',
    t_m3u_invalid:         'Playlist M3U vide ou format non reconnu',
    t_m3u_no_tracks:       'Aucun titre trouvé dans cette playlist M3U',
    t_m3u_imported:        (name, n, newN, skip) => skip > 0
      ? `« ${name} » importée · ${n} titre${n!==1?'s':''}${newN?` (${newN} nouveau${newN!==1?'x':''})`:''}· ${skip} introuvable${skip!==1?'s':''}`
      : `« ${name} » importée · ${n} titre${n!==1?'s':''}${newN?` (${newN} nouveau${newN!==1?'x':''})`:''}`,
    // Watch folder
    t_watch_error:         '⚠ Erreur de surveillance du dossier',
    // Tag editor toasts
    te_saved:              '✏️ Tags sauvegardés',
    te_write_fail:         (err) => `⚠️ Tags sauvegardés en mémoire uniquement (${err})`,
    // Selection toasts
    t_sel_added_to_pl:     (n, name) => `${n} titre${n!==1?'s':''} ajouté${n!==1?'s':''} à « ${name} »`,
    t_sel_liked:           (n) => `♥ ${n} titre${n!==1?'s':''} liké${n!==1?'s':''}`,
    t_sel_unliked:         '♡ Likes retirés',
    t_sel_deleted:         (n) => `🗑 ${n} titre${n!==1?'s':''} supprimé${n!==1?'s':''}`,
    t_sel_undo_delete:     'Suppression annulée',
    // Cinema fullscreen
    t_cin_fs_enter:        'Plein écran [F]',
    t_cin_fs_exit:         'Quitter le plein écran [F]',
    // Stats panel
    stats_overview:        'Vue d\'ensemble',
    stats_total_plays:     'Écoutes totales',
    stats_listen_time:     'Temps d\'écoute',
    stats_vs_prev_week:    'vs semaine préc.',
    stats_tracks_artists:  (t, a) => `Titres · ${a} artiste${a!==1?'s':''}`,
    stats_top_artists_month: 'Top artistes ce mois',
    stats_top_tracks:      'Top titres',
    stats_genres:          'Genres',
    stats_genres_hint:     '· cliquer pour explorer',
    stats_goto_artist:     'Voir les titres de cet artiste',
    stats_activity:        (n) => `Activité — ${n} derniers jours`,
    stats_click_day:       '· cliquer sur un jour',
    stats_hm_less:         'Moins',
    stats_hm_more:         'Plus',
    stats_empty_h:         'Aucune statistique',
    stats_empty_s:         'Importe des musiques et écoute-les pour voir tes stats ici.',
    stats_no_history:      (date) => `Aucun historique pour le ${date}`,
    stats_plays:           (n) => `${n} écoute${n!==1?'s':''}`,
    stats_unknown_genre:   'Inconnu',
    // IDB quota error
    err_quota:             'Espace disque insuffisant — données non sauvegardées',
    // IPC tag timeout
    err_tag_timeout:       (n) => `${n} piste${n!==1?'s':''} sans métadonnées (délai dépassé)`,
  },
  en: {
    nav_all:        'All tracks',
    nav_liked:      'Favorites',
    nav_artists:    'Artists',
    nav_albums:     'Albums',
    nav_recent:     'Recently played',
    nav_radio:      'Radio',
    nav_stats:      'Statistics',
    nav_playlists:  'Playlists',
    sb_group_lib:      'Library',
    sb_group_explore:  'Browse',
    sb_group_discover: 'Discover',
    sb_empty:       'No music imported',
    sb_tracks:      (n) => `<b>${n}</b> track${n!==1?'s':''}`,
    sb_artists:     (n) => `<b>${n}</b> artist${n!==1?'s':''}`,
    sb_albums:      (n) => `<b>${n}</b> album${n!==1?'s':''}`,
    n_tracks:       'tracks',
    btn_scan:       'Scan a folder',
    btn_clear:      'Clear library',
    wlc_title:      'Welcome to LibreFlow',
    wlc_sub:        'Your local audio player. Your music, no streaming, no ads.',
    wlc_feat1_t:    'Scan & auto tags',
    wlc_feat1_d:    'Folders, artwork and metadata extracted automatically',
    wlc_feat2_t:    'Playlists & Smart Radio',
    wlc_feat2_d:    'Manual, smart playlists and affinity-based radio',
    wlc_feat3_t:    'EQ & audio quality',
    wlc_feat3_d:    '10-band equalizer, ReplayGain, crossfade and visualizer',
    wlc_feat4_t:    'Stats & history',
    wlc_feat4_d:    'Artists, albums, genres and listening calendar',
    wlc_btn:        'Choose my Music folder',
    wlc_btn_m3u:    'Import an M3U playlist',
    wlc_hint:       'or drag and drop audio files into the window',
    scan_title:     'Loading…',
    scan_sub:       'audio files loaded',
    lib_all:        'All tracks',
    lib_liked:      'Favorites',
    lib_artists:    'Artists',
    lib_albums:     'Albums',
    lib_genres:     'Genres',
    lib_radio:      'Radio',
    lib_recent:     'Recently played',
    srch_ph:        'Search…',
    srch_disabled:  'Search unavailable',
    sort_az:        'A–Z',
    sort_za:        'Z–A',
    sort_artist:    'Artist',
    sort_album:     'Album',
    sort_recent:    'Recent',
    sort_count_lbl:    'Tracks',
    sort_year_lbl:     'Year',
    sort_btn_artists:  'Sort artists',
    sort_btn_genres:   'Sort genres',
    sort_btn_track_num:'Sorted by track number',
    sort_btn_az_ttl:   'Sorted A–Z',
    sort_by_track_lbl: '# Track',
    tb_minimize:    'Minimize',
    tb_maximize:    'Maximize',
    tb_restore:     'Restore',
    tb_close:       'Close',
    tb_settings:    'Settings',
    pc_shuffle:     'Shuffle [S]',
    pc_prev:        'Previous [←]',
    pc_next:        'Next [→]',
    pc_repeat:      'Repeat [R]',
    pc_play:        'Play/Pause [Space]',
    no_results:     'No results',
    empty_lib_h:    'Empty library',
    empty_lib_s:    'Click "Scan a folder" to get started',
    empty_search_h: 'No results',
    empty_search_s: 'Try a different search term',
    empty_recent_h: 'Nothing played yet',
    empty_recent_s: 'Play a track to get started',
    empty_liked_h:  'No favorites yet',
    empty_liked_s:  'Click ♥ on any track to add it to your favorites',
    empty_drill_h:  'No tracks found',
    empty_drill_s:  'This view contains no matching tracks',
    empty_pl_h:     'Empty playlist',
    empty_pl_s:     'Drag tracks here or right-click to add them',
    pl_empty:           'No playlists',
    pl_empty_s:         'Create your first playlist to organize your music',
    pl_nav_no_match:    'No results',
    pl_nav_search:      'Filter…',
    pl_section_pinned:  'Pinned',
    pl_section_recent:  'Recent',
    pl_section_all:     'All playlists',
    pl_folder_empty:    'Empty folder',
    // S157 FIX-6 : missing i18n keys (replaces hardcoded French fallbacks)
    pl_more:                'More actions',
    pl_pin:                 'Pin',
    pl_unpin:               'Unpin',
    pl_folder_rename:       'Rename',
    pl_folder_delete:       'Delete folder',
    pl_folder_rename_prompt:'New folder name',
    pl_folder_del_h:        'Delete folder',
    pl_folder_del_body:     'Playlists inside will be moved to the root level.',
    pl_move_to_folder:      'Move to…',
    pl_remove_from_folder:  'Remove from folder',
    t_pl_folder_deleted:    'Folder deleted',
    pl_new:             'New playlist',
    pl_name_ph:     'Playlist name…',
    pl_create:      'Create',
    pl_cancel:      'Cancel',
    btn_cancel:     'Cancel',
    // Smart playlist modal
    spl_title:      'Smart playlist',
    spl_mode_seed:  'Similarity',
    spl_mode_rules: 'Rules',
    spl_seed_desc:  'Generates a coherent playlist from a seed track. LibreFlow analyses the artist, genre and album to build a musically consistent selection.',
    spl_match:      'Match',
    spl_comb_all:   'all rules (AND)',
    spl_comb_any:   'at least one (OR)',
    spl_add_rule:   'Add a rule',
    spl_max:        'Max tracks',
    spl_all:        'All',
    spl_name:       'Playlist name',
    spl_preview_btn:'Preview',
    spl_create_btn: 'Create',
    pl_play_all:    'Play all',
    pl_shuffle:     'Shuffle',
    pl_delete:      'Delete',
    pl_modal_h:     'New playlist',
    pl_new_dots:    'New playlist…',
    pl_add_to:      'Add to playlist',
    pl_remove:      'Remove from playlist',
    pl_rename_title: 'Rename playlist',
    pl_rename_btn:   'Rename',
    pl_cover_pick:   'Pick an image',
    pl_cover_rm:     'Remove',
    t_pl_cover_fail: 'Could not load this image',
    pl_add_to_hd:    'Add to',
    pl_smart_lbl:    'Smart',
    pl_regen_btn:    'Regenerate',
    pl_liked_count:  (n) => `${n} favorite${n!==1?'s':''}`,
    // S92 — Sort + hero
    pl_sort_label:    'Sort',
    pl_sort_manual:   'Manual',
    pl_sort_az:       'Title A→Z',
    pl_sort_za:       'Title Z→A',
    pl_sort_artist:   'Artist',
    pl_sort_album:    'Album',
    pl_sort_duration: 'Duration',
    pl_hero_playlist: 'Playlist',
    pl_hero_edit:     'Edit cover',
    // Delete playlist confirmation
    pl_delete_confirm_h:    (name) => `Delete "${name}"?`,
    pl_delete_confirm_body: (n) => `${n} track(s) will be removed from the playlist (files stay on disk).`,
    pl_delete_confirm_btn:  'Delete',
    // Folder move toasts
    t_pl_moved_to_folder:     (name) => `Moved to "${name}"`,
    t_pl_removed_from_folder: 'Removed from folder',
    // Context menu — ctxmenu.js
    ctx_new_pl:       'New playlist…',
    ctx_like:         'Like',
    ctx_unlike:       'Remove from favorites',
    ctx_go_artist:    (name) => `Go to ${name}`,
    ctx_go_album:     (name) => `Go to "${name}"`,
    ctx_liked_toast:  '♥ Liked',
    ctx_unliked_toast:'♡ Removed from favorites',
    ctx_write_rg:      'Write RG gain to tags',
    t_rg_writing:      'Writing ReplayGain tags…',
    t_rg_written:     (name) => `RG tags written in "${name}"`,
    t_rg_write_err:   (err)  => `RG write error: ${err}`,
    ctx_delete_h:     (name) => `Delete "${name}"?`,
    ctx_delete_body:  'The track will be removed from the library. The file on disk will <strong>not</strong> be deleted.',
    ctx_delete_btn:   'Delete',
    ctx_deleted_toast:(name) => `🗑 "${name}" deleted`,
    clear_h:        'Clear library?',
    clear_body:     'All imported tracks, artwork and favorites will be deleted.<br>Your audio files on disk will <strong>not</strong> be affected.',
    clear_cancel:   'Cancel',
    clear_confirm:  'Clear anyway',
    settings:             'Settings',
    set_language_section: 'Language / Langue',
    set_language_label:   'Interface language',
    set_language_sub:     'Applied immediately',
    set_library_section:  'Library',
    set_clear_label:      'Clear library',
    set_clear_sub:        'Removes all imported tracks',
    set_clear_btn:        'Clear',
    set_about_section:    'About',
    set_about_desc:       'Local audio player for Windows. No data sent.',
    drag_hint:      'Drop your files here',
    t_scan_in_progress: 'Scan already in progress…',
    t_no_audio:     'No audio files found',
    t_no_loaded:    'No audio files loaded',
    t_not_found:    '⚠ File not found — rescan the folder',
    t_decode_err:   '⚠ Corrupt file — cannot decode',
    t_playback_err:   '⚠ Playback error — skipping to next',
    t_consec_errors:  '⚠ Too many consecutive errors — playback stopped',
    t_play_start_err: (msg) => `⚠ Cannot play: ${msg}`,
    t_drag_hint:     'Drop MP3, FLAC, AAC…',
    t_cleared:       '🗑️ Library cleared',
    t_pl_deleted:    'Playlist deleted',
    t_pl_pinned:     '📌 Playlist pinned',
    t_pl_unpinned:   'Playlist unpinned',
    aria_search:    'Search library',
    aria_srch_clear:'Clear search',
    aria_like:      'Add to favorites',
    aria_pbar:      'Playback position',
    aria_vol:       'Volume',
    aria_play:      'Play / Pause',
    aria_shuffle:   'Shuffle',
    aria_prev:      'Previous track',
    aria_next:      'Next track',
    a11y_skip_link: 'Skip to main content',
    // ── Extra aria labels ───────────────────────────────────────
    aria_eq_close:       'Close equalizer',
    aria_eq_cats:        'EQ preset categories',
    aria_sel_add_pl:     'Add to playlist',
    aria_sel_like:       'Like / Unlike',
    aria_sel_tags:       'Edit tags',
    aria_sel_delete:     'Delete from library',
    aria_sel_cancel:     'Cancel selection',
    aria_album_sort:     'Sort albums',
    aria_sleep:          'Sleep timer',
    aria_cinema_bg:      'Change cinema background',
    aria_cinema_fs:      'Toggle fullscreen',
    aria_cinema_close:   'Close cinema mode',
    aria_cinema_radio:   'Enable smart radio',
    aria_mini_close:     'Close mini player',
    // ── Extra aria labels — Pass 4 (i18n) ──────────────────────
    aria_boot_spinner:       'Loading LibreFlow…',
    aria_nav_main:           'Main navigation',
    aria_now_playing_view:   'Now playing',
    aria_player_bar:         'Playback controls',
    aria_toggle_now_playing: 'View current track',
    aria_sleep_menu:         'Sleep timer',
    aria_pl_cover_pick:      'Choose cover image',
    aria_smart_seed_search:  'Search for a seed track',
    aria_ctx_menu:           'Actions for this track',
    aria_close_settings:     'Close settings',
    aria_queue_panel:        'Queue',
    aria_scroll_to_current:  'Go to current track',
    aria_close_queue:        'Close queue',
    aria_eq_mode_group:      'EQ mode',
    aria_repeat:             'Repeat mode',
    aria_theme_green:        'Green',
    aria_theme_blue:         'Blue',
    aria_theme_purple:       'Purple',
    aria_theme_red:          'Red',
    aria_theme_orange:       'Orange',
    aria_theme_pink:         'Pink',
    aria_theme_cyan:         'Cyan',
    // ── Translated titles (tooltips) ────────────────────────────
    t_cinema_fs:         'Fullscreen [F]',
    t_cinema_close:      'Close [C / Esc]',
    t_cinema_like:       'Favorite',
    t_cinema_radio:      'Smart radio [R]',
    t_mini_close:        'Close [I]',
    t_already_in:   'Already in this playlist',
    t_removed:      'Removed from playlist',
    t_undo:         'Undo',
    t_undo_done:    'Undone',
    t_smart_no_seed:    'No track selected',
    t_smart_seed_first: 'Pick a seed track first',
    t_smart_no_match:   'No matching tracks found',
    t_smart_no_regen:   'No tracks found to regenerate',
    t_smart_pl_created: (name, n) => `Playlist "${name}" created (${n} tracks)`,
    t_smart_pl_regen:   (n) => `Playlist regenerated (${n} tracks)`,
    t_shuffle_on:   '🔀 Shuffle on',
    t_shuffle_off:  'Shuffle off',
    t_repeat_none:  'Repeat off',
    t_repeat_all:   '🔁 Repeat all',
    t_repeat_one:   '🔂 Repeat one',
    t_recent_ignores_filter: '🔀 Sort by recent: search filter doesn\'t apply to navigation',
    t_loaded:       (n) => `${n} track${n!==1?'s':''} loaded`,
    t_session_restored: (title) => `▶ Session restored · ${title}`,
    t_scanned:          (n) => `✅ ${n} new track${n!==1?'s':''}`,
    t_already_imported: 'All files are already in your library',
    t_rg_prompt:        (n) => `${n} new track${n!==1?'s':''} without volume normalization`,
    t_rg_enable_btn:    'Enable ReplayGain',
    t_short_tracks_skipped: (n) => `${n} track${n!==1?'s':''} skipped — duration < 20 s`,
    t_recognized:   (n) => `${n} track${n!==1?'s':''} recognized`,
    t_files_added:  (n) => `✅ ${n} file${n!==1?'s':''} added`,
    t_added_to:     (name) => `✅ Added to "${name}"`,
    t_pl_created:   (name) => `Playlist "${name}" created`,
    t_pl_renamed:   (name) => `Playlist renamed to "${name}"`,
    t_pl_name_required: 'Give your playlist a name',
    unknown_artist: 'Unknown artist',
    sans_album:     'No album',
    recent_count:   (n) => `${n} recently played track${n!==1?'s':''}`,
    track_count:    (n) => `${n} track${n!==1?'s':''}`,
    // Genres
    nav_genres:           'Genres',
    // Settings — sections
    set_theme_section:    'Color theme',
    set_rg_section:       'Volume normalization',
    set_crossfade_section:'Crossfade',
    set_mini_section:     'Mini-player',
    // Settings — visualizer
    set_viz_section:      'Visualizer',
    set_viz_label:        'Visualizer shape',
    set_viz_sub:          'Appearance of the playback bar',
    set_viz_bars:         'Bars',
    set_viz_osc:          'Oscilloscope',
    set_viz_circle:       'Circle',
    set_viz_toggle_label: 'Visualizer active',
    set_viz_toggle_sub:   'Show the visualizer in the playback bar',
    set_viz_on:           'Enabled',
    set_viz_off:          'Disabled',
    // Settings — dynamic accent
    set_dyn_label:        'Dynamic accent',
    set_dyn_sub:          'Follows the album art color',
    set_dyn_on:           'On',
    set_dyn_off:          'Off',
    // Settings — mode
    set_mode_label:       'Display mode',
    set_mode_dark:        'Dark',
    set_mode_light:       'Light',
    // Settings — replay gain
    set_rg_label:         'Replay Gain',
    set_rg_sub:           'Equalizes volume across tracks',
    set_rg_target_sub:    'Target level (-23 broadcast → -9 loud)',
    // Settings — crossfade
    set_cf_label:         'Fade duration',
    set_cf_sub:           'Transition between each track',
    // Settings — mini
    set_mini_label:       'Floating window',
    set_mini_sub:         'Controls visible on screen',
    set_mini_btn:         'Open',
    // Settings — library extra
    set_add_folder_label: 'Add a folder',
    set_add_folder_sub:   'Import a music folder into the library',
    set_add_folder_btn:   'Browse…',
    set_rescan_label:     'Rescan tags',
    set_rescan_sub:       'Reload metadata from files',
    set_rescan_btn:       'Rescan',
    set_dupes_label:      'Detect duplicates',
    set_dupes_sub:        'Find duplicate tracks in the library',
    set_dupes_btn:        'Analyze',
    set_watch_label:      'Watched folder',
    set_watch_change_btn: 'Change…',
    set_interop_label:    'Interoperability',
    set_interop_sub:      'Import / export playlists in M3U format',
    set_export_label:     'Export M3U playlist',
    set_export_sub:       'Export the active playlist to M3U format',
    set_export_btn:       'Export',
    set_xspf_label:       'Export XSPF playlist',
    set_xspf_sub:         'Compatible with VLC, foobar2000, Strawberry',
    set_xspf_btn:         'Export XSPF',
    set_import_label:     'Import M3U playlist',
    set_import_sub:       'Import a playlist from a .m3u file',
    set_import_btn:       'Import',
    // Settings — about
    set_app_name:         'LibreFlow',
    set_app_version:      'v1.0.0',
    // Titlebar tooltips
    tb_mode:              'Light / dark theme',
    tb_shortcuts:         'Keyboard shortcuts [?]',
    tb_cinema:            'Cinema mode [C]',
    tb_mini:              'Mini-player [M]',
    // Sidebar playlist section
    sb_smart_pl:          'Smart playlist',
    sb_new_pl:            'New playlist',
    // Sort & selection
    sort_albums_title:    'Sort albums',
    sel_cancel:           'Cancel selection',
    sel_add_pl:           'Playlist',
    sel_like:             'Like',
    sel_tags:             'Tags',
    sel_delete:           'Delete',
    // Player-right tooltips
    pl_queue_title:       'Queue',
    pl_eq_title:          'Equalizer',
    pl_speed_title:       'Playback speed [X]',
    spd_label:            (n) => 'Speed: ' + n + 'x',
    pl_sleep_title:       'Sleep timer',
    pl_radio_title:       'Smart radio',
    // Sleep menu
    sleep_opt_15:         '15 minutes',
    sleep_opt_30:         '30 minutes',
    sleep_opt_45:         '45 minutes',
    sleep_opt_60:         '1 hour',
    sleep_opt_90:         '1 h 30',
    sleep_opt_120:        '2 hours',
    sleep_opt_end:        '⏹ End of track',
    sleep_opt_cancel:     'Cancel',
    sleep_ph:             'min…',
    // Shortcuts panel
    sc_title:             'Keyboard shortcuts',
    sc_close:             'Close',
    // Dupes
    dupes_title:          'Duplicates found',
    dupes_none:           'No duplicates found 🎉',
    dupes_keep:           'Keep',
    dupes_delete:         'Delete',
    dupes_delete_all:     'Delete all',
    // Watch folder
    watch_disabled:       'Monitoring disabled',
    // Toast extras
    t_watch_active:       (path) => `👁 Watching: ${path}`,
    t_watch_off:          '👁 Watch folder disabled',
    t_new_files:          (n) => `✅ ${n} new file${n!==1?'s':''} detected`,
    t_rescan_empty:        '⚠ No tracks to rescan',
    t_rescan_start:        '🔄 Rescanning…',
    t_rescan_done:        (n) => `🔄 ${n} track${n!==1?'s':''} rescanned`,
    t_genre_lib_empty:     '⚠ Library is empty',
    t_genre_all_done:      '✅ All tracks already have a genre',
    t_genre_start:         (n, force) => `🎵 ${force ? 'Recalculating' : 'Detecting'} genre${n!==1?'s':''} for ${n} track${n!==1?'s':''}…`,
    t_genre_done:          (n) => `🎵 ${n} genre${n!==1?'s':''} detected`,
    t_cinema_bg:           (label) => `🎬 Background: ${label}`,
    t_watch_stopped:       '👁 Watch folder disabled',
    t_update_available:    (v) => `🆕 Update available: v${v}`,
    t_update_install:      'Install',
    t_update_downloading:  '⬇ Downloading…',
    t_update_progress:     (pct) => `⬇ Downloading… ${pct}%`,
    t_update_installing:   '⚙ Installing…',
    t_update_error:        (e) => `❌ Update error: ${e}`,
    t_update_uptodate:     '✅ LibreFlow is up to date',
    t_update_checking:     '🔍 Checking…',
    t_update_check_btn:    'Check now',
    // Tag editor labels
    te_title:              'Title',
    te_artist:             'Artist',
    te_album:              'Album',
    te_genre:              'Genre',
    te_year:               'Year',
    te_track_num:          '#',
    te_hint:               'Enter to save · Esc to cancel',
    te_save:               'Save',
    te_cancel:             'Cancel',
    t_dupes_deleted:      (n) => `🗑 ${n} duplicate${n!==1?'s':''} deleted`,
    t_artwork_retry:      (n) => `Missing artwork: fetching ${n}…`,
    t_artwork_retry_done: (n) => `🖼 ${n} cover${n!==1?'s':''} loaded`,
    // Batch tag edit
    t_batch_tag_saving:   'Saving tags…',
    t_batch_tag_done:     (n) => `✏ ${n} track${n!==1?'s':''} updated`,
    t_batch_tag_done_err: (n, f) => `✏ ${n} updated (${f} failure${f!==1?'s':''})`,
    t_batch_tag_none:     'No tags modified',
    // Sleep timer
    // Context menu
    t_queue_play_next:          '⏭ Play next',
    t_queue_added_end:          '⏬ Added to queue',
    t_queue_filter_cleared:     '🔍 Search cleared to play this track',
    t_queue_ended:              'Queue finished — resuming normal playback',
    t_ctx_copied:          '📋 Copied to clipboard',
    // Sleep timer
    t_sleep_set:           (m) => `⏱ Sleep in ${m} min`,
    t_sleep_cancel:        '⏱ Sleep timer cancelled',
    t_sleep_warn_1min:     '⏱ Shutting down in 1 minute…',
    t_sleep_done:          '⏱ Sleep — good night!',
    t_sleep_end_track:     '⏱ Stopping after current track',
    t_sleep_end_track_done:'⏱ Sleep — good night!',
    // Queue
    queue_title:          'Queue',
    queue_empty:          'Queue is empty',
    // EQ
    eq_title:             'Equalizer',
    eq_reset:             'Reset',
    // Shortcuts panel descriptions
    sc_prev:          'Previous track',
    sc_next:          'Next track',
    sc_vol_up:        'Volume +',
    sc_vol_down:      'Volume –',
    sc_shuffle:       'Shuffle',
    sc_repeat:        'Repeat',
    sc_ctx_cinema:    '· Radio in cinema mode',
    sc_like:          'Add / remove from favorites',
    sc_search:        'Focus search',
    sc_cinema:        'Cinema mode',
    sc_dupes:         'Detect duplicates',
    sc_viz_cycle:     'Visualizer (cycle bars → oscilloscope → circle)',
    sc_speed:         'Playback speed (cycle)',
    eq_reset_title:   'Reset to flat (0 dB)',
    eq_mode_simple:   'Simple',
    eq_mode_expert:   'Expert',
    sc_shortcuts_key: 'Show this help',
    sc_esc:           'Close / Clear search',
    sc_fullscreen:    'Full screen',
    set_rg_target_label: 'Target',
    aria_rg_target:       'ReplayGain target volume',
    // Watch folder
    set_watch_sub:    'Monitor a folder for new music',
    // A11Y — aria-label strings
    nav_home:         'Home',
    vol_label:        'Volume',
    pbar_label:       'Playback position',
    like_label:       'Add to favorites',
    unlike_label:     'Remove from favorites',
    tr_edit_tags:     'Edit tags (double-click)',
    tr_add_to_pl:     'Add to playlist',
    aria_track_row:   (title, artist, dur) => dur ? `${title}, ${artist}, ${dur}` : `${title}, ${artist}`,
    srch_clear:       'Clear search',
    theme_green:      'Green',
    theme_blue:       'Blue',
    theme_purple:     'Purple',
    theme_red:        'Red',
    theme_orange:     'Orange',
    theme_pink:       'Pink',
    theme_cyan:       'Cyan',
    set_cinema_ambient:  'Color gradient from artwork',
    set_cinema_spectrum: 'Full-screen audio visualizer',
    set_cinema_amoled:   'Pure black — optimal for OLED',
    set_lib_tab:             'Library',
    set_cinema_section:      'Cinema Mode',
    set_cinema_bg_label:     'Background',
    set_cinema_bg_sub:       'Backdrop displayed behind the artwork',
    set_cinema_ambient_label:'Ambient',
    set_cinema_spectrum_label:'Spectrum',
    set_genres_label:        'Detect genres',
    set_genres_sub:          'Auto-detect missing genres',
    set_genres_btn:          'Detect',
    set_shortcuts_section:   'Keyboard shortcuts',
    set_shortcuts_label:     'Help & shortcuts',
    set_shortcuts_btn:       'Show',
    set_reset_section:       'Reset',
    set_updates_section:     'Updates',
    set_update_auto_label:   'Check for updates on launch',
    set_update_manual_label: 'Check manually',
    set_cache_label:         'Clear caches',
    set_cache_sub:           'Removes all application data (library, config, playlists, history) and restarts',
    set_cache_btn:           'Clear caches',
    // Radio
    radio_need_more:      'Add at least 3 tracks to use the radio',
    radio_restart_title:  'Radio already active',
    radio_restart_body:   'Do you want to restart the radio from a new seed track?',
    radio_restart_btn:    'Restart',
    radio_no_track:       'No track available for radio',
    radio_started:        (name) => `📻 Radio started from "${name}"`,
    radio_stop_title:     'Stop radio?',
    radio_stop_body:      (n) => `The queue of ${n} track${n>1?'s':''} will be lost.`,
    radio_stop_btn:       'Stop',
    radio_stopped:        '📻 Radio stopped',
    radio_see_queue:      'See radio queue',
    radio_start_lbl:      'Start radio',
    radio_stop_lbl:       'Stop radio',
    radio_active_lbl:     'Radio active',
    radio_see_file:       'See queue',
    radio_save_lbl:       'Save',
    radio_no_seed:        'No track selected for radio',
    radio_regen_need:     'Play a track first to regenerate the radio',
    radio_regen_done:     (name) => `📻 Radio regenerated from "${name}"`,
    radio_pl_name:        (name) => `📻 Radio – ${name}`,
    radio_pl_saved:       (name, n) => `💾 Playlist "${name}" created — ${n} track${n>1?'s':''}`,
    radio_pl_see:         'View →',
    radio_pl_empty:       'No tracks to save',
    radio_track_nf:       'Track not found in library',
    radio_empty_title:    'No radio playing',
    radio_empty_sub:      'Start a radio from a track to discover similar music.',
    radio_start_current:  'Start from current track',
    radio_header_lbl:     'Radio',
    radio_queue_ct:       (n) => `· ${n} track${n!==1?'s':''}`,
    radio_regen_btn:      'Regenerate',
    radio_save_btn:       'Save',
    radio_seed_lbl:       'Radio seed',
    radio_queue_fill:     'The queue will fill automatically after the next track.',
    radio_next_tracks:    'Up next',
    radio_start_need:     'Play a track first to start the radio',
    radio_play_track:     'Play this track now',
    radio_remove_track:   'Remove from queue',
    // Duplicates panel
    t_no_dupes:            '✅ No duplicates found!',
    t_remove_dupe_h:       'Remove this duplicate?',
    t_remove_dupe_body:    (name) => `"${name}" will be removed from the library.`,
    t_delete_btn:          'Delete',
    t_dupe_group_head:     (n, name) => `⚠ ${n} versions — ${name}`,
    t_dupe_remove_btn:     'Remove',
    // M3U / XSPF import / export
    t_m3u_no_export:       'No tracks to export',
    t_m3u_exported:        '💾 Playlist exported as M3U',
    t_xspf_exported:       '💾 Playlist exported as XSPF',
    t_m3u_invalid:         'Empty M3U playlist or unrecognized format',
    t_m3u_no_tracks:       'No tracks found in this M3U playlist',
    t_m3u_imported:        (name, n, newN, skip) => skip > 0
      ? `"${name}" imported · ${n} track${n!==1?'s':''}${newN?` (${newN} new)`:''}· ${skip} not found`
      : `"${name}" imported · ${n} track${n!==1?'s':''}${newN?` (${newN} new)`:''}`,
    // Watch folder
    t_watch_error:         '⚠ Watch folder error',
    // Tag editor toasts
    te_saved:              '✏️ Tags saved',
    te_write_fail:         (err) => `⚠️ Tags saved in memory only (${err})`,
    // Selection toasts
    t_sel_added_to_pl:     (n, name) => `${n} track${n!==1?'s':''} added to "${name}"`,
    t_sel_liked:           (n) => `♥ ${n} track${n!==1?'s':''} liked`,
    t_sel_unliked:         '♡ Likes removed',
    t_sel_deleted:         (n) => `🗑 ${n} track${n!==1?'s':''} deleted`,
    t_sel_undo_delete:     'Deletion undone',
    // Cinema fullscreen
    t_cin_fs_enter:        'Full screen [F]',
    t_cin_fs_exit:         'Exit full screen [F]',
    // Stats panel
    stats_overview:        'Overview',
    stats_total_plays:     'Total plays',
    stats_listen_time:     'Listening time',
    stats_vs_prev_week:    'vs prev. week',
    stats_tracks_artists:  (t, a) => `Tracks · ${a} artist${a!==1?'s':''}`,
    stats_top_artists_month: 'Top artists this month',
    stats_top_tracks:      'Top tracks',
    stats_genres:          'Genres',
    stats_genres_hint:     '· click to explore',
    stats_goto_artist:     'Browse this artist',
    stats_activity:        (n) => `Activity — last ${n} days`,
    stats_click_day:       '· click on a day',
    stats_hm_less:         'Less',
    stats_hm_more:         'More',
    stats_empty_h:         'No statistics yet',
    stats_empty_s:         'Import music and listen to see your stats here.',
    stats_no_history:      (date) => `No history for ${date}`,
    stats_plays:           (n) => `${n} play${n!==1?'s':''}`,
    stats_unknown_genre:   'Unknown',
    // IDB quota error
    err_quota:             'Not enough disk space — data not saved',
    // IPC tag timeout
    err_tag_timeout:       (n) => `${n} track${n!==1?'s':''} missing metadata (timeout)`,
  }
};

// ── Runtime i18n state ───────────────────────────────────────
// `lang` est la locale active. initLang() l'initialise depuis la config au
// démarrage (sans effets de bord). setLang() est réservé aux changements
// utilisateur (sauvegarde + rafraîchissement de l'UI).

let lang = 'fr';

/** Initialise la locale au démarrage, sans side-effects. Appelé depuis boot(). */
export function initLang(l) { lang = l; }

/** Retourne la locale active ('fr' | 'en'). */
export function getLang() { return lang; }

/** Change la locale en live et rafraîchit l'UI. Persister via saveCfg() côté appelant. */
export function setLang(l) {
  if (!LANGS[l]) return;
  lang = l;
  applyLang();
}

/** Traduit une clé. Retourne la valeur FR en fallback. */
export function i18n(key, ...args) {
  const dict = LANGS[lang] || LANGS.fr;
  const val  = dict[key] ?? LANGS.fr[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

/** Applique tous les textes traduits à l'UI.
 *  Lit window.sort, window.displayMode, window.crossfadeDur pour éviter
 *  une dépendance circulaire avec app.js. */
export function applyLang() {
  // ── BCP 47 : mettre à jour l'attribut lang du document ─────
  document.documentElement.lang = lang;

  const setText = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    if (el) el.textContent = i18n(key);
  };
  const setHtml = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    if (el) el.innerHTML = i18n(key);
  };
  const setAttrEl = (id, attr, key) => {
    const el = document.getElementById(id);
    if (el) el[attr] = i18n(key);
  };
  const setBtnText = (sel, key, isId = false) => {
    const el = isId ? document.getElementById(sel) : document.querySelector(sel);
    if (!el) return;
    /** @type {Text | null} */ let last = null;
    el.childNodes.forEach(n => { if (n.nodeType === 3) last = /** @type {Text} */ (n); });
    if (last) last.textContent = ' ' + i18n(key);
    else el.appendChild(document.createTextNode(' ' + i18n(key)));
  };

  // ── data-i18n / data-i18n-title elements ───────────────────
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = i18n(el.dataset.i18nTitle);
  });
  // ── data-i18n-aria : aria-label traduits ───────────────────
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', i18n(el.dataset.i18nAria));
  });
  // ── data-aria-i18n : alias (même effet, deux attributs pour raison historique) ──
  document.querySelectorAll('[data-aria-i18n]').forEach(el => {
    el.setAttribute('aria-label', i18n(el.dataset.ariaI18n));
  });

  // Stats
  updateStats();

  // Sort label
  const SLBLS_I18N = { az: 'sort_az', za: 'sort_za', artist: 'sort_artist', album: 'sort_album', recent: 'sort_recent' };
  setText('sort-lbl', SLBLS_I18N[get('sort')] || 'sort_az', true);

  // Placeholders & titles
  setAttrEl('srch',     'placeholder', i18n('srch_ph'));
  setAttrEl('tbt-min',  'title',       i18n('tb_minimize'));
  setAttrEl('tbt-max',  'title',       i18n('tb_maximize'));
  setAttrEl('pcplay',   'title',       i18n('pc_play'));
  setAttrEl('pc-shuf',  'title',       i18n('pc_shuffle'));
  setAttrEl('pc-rep',   'title',       i18n('pc_repeat'));
  // Sleep menu inputs
  setAttrEl('sleep-custom-input', 'placeholder', i18n('sleep_ph'));

  // Scan view
  setText('.sh',  'scan_title');
  setText('.ss',  'scan_sub');

  // Drag overlay
  setText('.drago-msg', 'drag_hint');

  // Welcome screen
  setText('.wh1',  'wlc_title');
  setText('.wsub', 'wlc_sub');
  setBtnText('.wbtn-scan', 'wlc_btn');
  setBtnText('.wbtn-m3u', 'wlc_btn_m3u');
  setText('.whint', 'wlc_hint');
  const feats = document.querySelectorAll('.wf');
  const featKeys = ['wlc_feat1', 'wlc_feat2', 'wlc_feat3', 'wlc_feat4'];
  feats.forEach((f, i) => {
    const wft = f.querySelector('.wf-t'); if (wft) wft.textContent = i18n(featKeys[i] + '_t');
    const wfd = f.querySelector('.wf-d'); if (wfd) wfd.textContent = i18n(featKeys[i] + '_d');
  });

  // Sidebar buttons
  setBtnText('.btn-scan',  'btn_scan');
  setBtnText('.btn-clear', 'btn_clear');

  // Clear modal
  setText('#modal .modal-h', 'clear_h');
  setHtml('#modal .modal-s', 'clear_body');

  // Modal cancel buttons
  document.querySelectorAll('.mbtn.cancel').forEach(b => b.textContent = i18n('pl_cancel'));

  // Playlist modal
  setAttrEl('pl-modal-inp', 'placeholder', i18n('pl_name_ph'));
  setText('pl-modal-title', 'pl_modal_h', true);

  // Context menu strings
  setText('ctx-add-lbl',    'pl_add_to', true);
  setText('ctx-remove-lbl', 'pl_remove', true);
  const ctxNewPl = document.getElementById('ctx-new-pl-item');
  if (ctxNewPl) {
    /** @type {Text | null} */ let last = null;
    ctxNewPl.childNodes.forEach(n => { if (n.nodeType === 3) last = /** @type {Text} */ (n); });
    if (last) last.textContent = ' ' + i18n('ctx_new_pl');
  }

  // Lang toggle highlight
  const lf = document.getElementById('lang-fr');
  const le = document.getElementById('lang-en');
  if (lf) lf.classList.toggle('on', lang === 'fr');
  if (le) le.classList.toggle('on', lang === 'en');

  // Mode buttons highlight
  const md = document.getElementById('mode-dark-btn');
  const ml = document.getElementById('mode-light-btn');
  if (md) md.style.background = get('displayMode') === 'dark'  ? 'var(--gd)' : '';
  if (ml) ml.style.background = get('displayMode') === 'light' ? 'var(--gd)' : '';

  // Re-render lib if visible
  const vlib = document.getElementById('vlib');
  if (vlib && vlib.classList.contains('on')) emit(EVENTS.RENDER_LIB, {});

  // Apply theme and crossfade
  applyTheme();
  setCrossfade(get('crossfadeDur') || 0);
}
