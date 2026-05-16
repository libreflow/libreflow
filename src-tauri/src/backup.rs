// LibreFlow — backup.rs
// Création et lecture du format d'archive .libreflow (ZIP Deflate).
// Utilisé par les commandes export_backup et import_backup dans commands.rs.
// Ne contient pas de logique Tauri — uniquement I/O pur pour testabilité.

use std::io::{Read, Write};
use zip::write::FileOptions;

/// Données sérialisées envoyées par le frontend lors de l'export.
/// Chaque champ est un JSON sérialisé en String (dall() → JSON.stringify()).
#[derive(serde::Deserialize)]
pub struct ExportPayload {
    pub manifest:  String,
    pub library:   String,
    pub playlists: String,
    pub playlog:   String,
    pub imports:   String,
    pub config:    String,
}

/// Données retournées au frontend lors de l'import.
/// Chaque champ est un JSON brut à parser côté JS.
#[derive(serde::Serialize)]
pub struct ImportPayload {
    pub manifest:  String,
    pub library:   String,
    pub playlists: String,
    pub playlog:   String,
    pub imports:   String,
    pub config:    String,
}

/// Crée un fichier .libreflow (ZIP Deflate) au chemin indiqué.
/// Écrit 6 fichiers JSON dans l'archive : manifest, library, playlists, playlog, imports, config.
///
/// Stratégie atomic : écriture dans un fichier temporaire (.tmp), puis rename atomique
/// vers la destination finale.  Si une étape échoue, le fichier temporaire est supprimé
/// et aucun fichier partiel/corrompu n'est laissé à la destination.
pub fn write_backup_zip(dest_path: &str, payload: &ExportPayload) -> Result<(), String> {
    // Write to temp path first — rename atomically on success to avoid partial files
    let tmp_path = format!("{dest_path}.tmp");

    {
        let file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("backup: création fichier temp échouée — {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let entries = [
            ("manifest.json",  payload.manifest.as_str()),
            ("library.json",   payload.library.as_str()),
            ("playlists.json", payload.playlists.as_str()),
            ("playlog.json",   payload.playlog.as_str()),
            ("imports.json",   payload.imports.as_str()),
            ("config.json",    payload.config.as_str()),
        ];

        for (name, content) in &entries {
            zip.start_file(*name, opts)
                .map_err(|e| format!("backup: ajout '{name}' échoué — {e}"))?;
            zip.write_all(content.as_bytes())
                .map_err(|e| format!("backup: écriture '{name}' échouée — {e}"))?;
        }

        zip.finish()
            .map_err(|e| format!("backup: finalisation ZIP échouée — {e}"))?;
    } // file handle closed here

    // Atomic rename — only happens if ZIP was written successfully
    std::fs::rename(&tmp_path, dest_path)
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path); // cleanup temp on rename failure
            format!("backup: renommage fichier échoué — {e}")
        })?;

    Ok(())
}

/// Helper interne : lit une entrée ZIP par nom et retourne son contenu texte.
fn _read_entry(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<String, String> {
    let mut entry = archive.by_name(name)
        .map_err(|e| format!("backup: entrée '{name}' introuvable dans l'archive — {e}"))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)
        .map_err(|e| format!("backup: lecture '{name}' échouée — {e}"))?;
    Ok(s)
}

/// Lit un fichier .libreflow et retourne les JSON internes.
/// Vérifie que toutes les entrées attendues sont présentes.
pub fn read_backup_zip(src_path: &str) -> Result<ImportPayload, String> {
    let file = std::fs::File::open(src_path)
        .map_err(|e| format!("backup: ouverture échouée — {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("backup: lecture ZIP échouée (fichier corrompu ?) — {e}"))?;

    let manifest  = _read_entry(&mut archive, "manifest.json")?;
    let library   = _read_entry(&mut archive, "library.json")?;
    let playlists = _read_entry(&mut archive, "playlists.json")?;
    let playlog   = _read_entry(&mut archive, "playlog.json")?;
    let imports   = _read_entry(&mut archive, "imports.json")?;
    let config    = _read_entry(&mut archive, "config.json")?;

    Ok(ImportPayload { manifest, library, playlists, playlog, imports, config })
}
