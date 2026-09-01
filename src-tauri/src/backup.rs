// LibreFlow — backup.rs
// Création et lecture du format d'archive .libreflow (ZIP Deflate).
// Utilisé par les commandes export_backup et import_backup dans commands.rs.
// Ne contient pas de logique Tauri — uniquement I/O pur pour testabilité.

use std::io::{Read, Write};
use zip::write::SimpleFileOptions;

/// Plafond de taille décompressée total (somme des entrées) pour neutraliser
/// les zip-bombs dans `read_backup_zip`. 50 Mo suffit largement à une lib
/// LibreFlow réaliste (les JSON contiennent des chemins + tags, pas des assets
/// binaires) et fait perdre tout intérêt à un attaquant qui voudrait gonfler
/// la mémoire de l'utilisateur en livrant un .libreflow malicieux.
const MAX_BACKUP_TOTAL_UNCOMPRESSED: u64 = 50 * 1024 * 1024;

/// Données sérialisées envoyées par le frontend lors de l'export.
/// Chaque champ est un JSON sérialisé en String (dall() → JSON.stringify()).
#[derive(serde::Deserialize)]
pub struct ExportPayload {
    pub manifest: String,
    pub library: String,
    pub playlists: String,
    pub playlog: String,
    pub imports: String,
    pub config: String,
}

/// Données retournées au frontend lors de l'import.
/// Chaque champ est un JSON brut à parser côté JS.
#[derive(serde::Serialize)]
pub struct ImportPayload {
    pub manifest: String,
    pub library: String,
    pub playlists: String,
    pub playlog: String,
    pub imports: String,
    pub config: String,
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
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let entries = [
            ("manifest.json", payload.manifest.as_str()),
            ("library.json", payload.library.as_str()),
            ("playlists.json", payload.playlists.as_str()),
            ("playlog.json", payload.playlog.as_str()),
            ("imports.json", payload.imports.as_str()),
            ("config.json", payload.config.as_str()),
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
    std::fs::rename(&tmp_path, dest_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path); // cleanup temp on rename failure
        format!("backup: renommage fichier échoué — {e}")
    })?;

    Ok(())
}

/// Helper interne : lit une entrée ZIP par nom avec cap de taille décompressée.
/// `budget` est décrémenté du nombre d'octets lus ; si une entrée annonce une
/// taille supérieure au budget restant ou en consomme effectivement plus,
/// la lecture est rejetée. Protège contre les zip-bombs même si la taille
/// annoncée dans l'entête ZIP est mensongère (lecture cappée via `Read::take`).
fn read_entry(
    archive: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
    budget: &mut u64,
) -> Result<String, String> {
    let entry = archive
        .by_name(name)
        .map_err(|e| format!("backup: entrée '{name}' introuvable dans l'archive — {e}"))?;
    let declared = entry.size();
    if declared > *budget {
        return Err(format!(
            "backup: entrée '{name}' trop volumineuse ({} octets, budget restant {})",
            declared, *budget
        ));
    }
    // Lit AU PLUS `budget+1` octets — un mensonge de taille (déclarée < réelle)
    // est détecté quand `take` rend des données dépassant le budget.
    // saturating_add évite le wrap-around u64 si budget == u64::MAX.
    let mut s = String::new();
    let n = entry
        .take(budget.saturating_add(1))
        .read_to_string(&mut s)
        .map_err(|e| format!("backup: lecture '{name}' échouée — {e}"))? as u64;
    if n > *budget {
        return Err(format!(
            "backup: entrée '{name}' dépasse le budget décompression (taille déclarée: {})",
            declared
        ));
    }
    *budget -= n;
    Ok(s)
}

/// Lit un fichier .libreflow et retourne les JSON internes.
/// Vérifie que toutes les entrées attendues sont présentes.
pub fn read_backup_zip(src_path: &str) -> Result<ImportPayload, String> {
    let file =
        std::fs::File::open(src_path).map_err(|e| format!("backup: ouverture échouée — {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("backup: lecture ZIP échouée (fichier corrompu ?) — {e}"))?;

    // Budget partagé entre toutes les entrées — protège contre une archive
    // dont la somme totale décompressée dépasse MAX_BACKUP_TOTAL_UNCOMPRESSED,
    // même si chaque entrée prise individuellement reste petite.
    let mut budget = MAX_BACKUP_TOTAL_UNCOMPRESSED;
    let manifest = read_entry(&mut archive, "manifest.json", &mut budget)?;
    let library = read_entry(&mut archive, "library.json", &mut budget)?;
    let playlists = read_entry(&mut archive, "playlists.json", &mut budget)?;
    let playlog = read_entry(&mut archive, "playlog.json", &mut budget)?;
    let imports = read_entry(&mut archive, "imports.json", &mut budget)?;
    let config = read_entry(&mut archive, "config.json", &mut budget)?;

    Ok(ImportPayload {
        manifest,
        library,
        playlists,
        playlog,
        imports,
        config,
    })
}

// ── Tests unitaires ────────────────────────────────────────────────────────────
//
// Portée : le format d'archive .libreflow lui-même (write→read roundtrip) et
// la garde anti zip-bomb de read_entry/read_backup_zip, qui n'avait aucune
// couverture avant cet ajout malgré son rôle de défense contre une archive
// malveillante fournie par l'utilisateur (import_backup ouvre un fichier
// arbitraire choisi via un file picker).
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> ExportPayload {
        ExportPayload {
            manifest: r#"{"version":1}"#.to_string(),
            library: r#"[{"id":"t1"}]"#.to_string(),
            playlists: "[]".to_string(),
            playlog: "[]".to_string(),
            imports: "[]".to_string(),
            config: r#"{"theme":"dark"}"#.to_string(),
        }
    }

    fn tmp_path(name: &str) -> String {
        let dir = std::env::temp_dir().join("libreflow_backup_tests");
        let _ = std::fs::create_dir_all(&dir);
        dir.join(name).to_string_lossy().to_string()
    }

    #[test]
    fn write_then_read_roundtrip_preserves_all_fields() {
        let dest = tmp_path("roundtrip.libreflow");
        let payload = sample_payload();
        write_backup_zip(&dest, &payload).expect("write should succeed");

        let imported = read_backup_zip(&dest).expect("read should succeed");
        assert_eq!(imported.manifest, payload.manifest);
        assert_eq!(imported.library, payload.library);
        assert_eq!(imported.playlists, payload.playlists);
        assert_eq!(imported.playlog, payload.playlog);
        assert_eq!(imported.imports, payload.imports);
        assert_eq!(imported.config, payload.config);

        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn write_backup_zip_leaves_no_tmp_file_on_success() {
        let dest = tmp_path("no_tmp_leftover.libreflow");
        write_backup_zip(&dest, &sample_payload()).expect("write should succeed");
        assert!(std::path::Path::new(&dest).exists());
        assert!(!std::path::Path::new(&format!("{dest}.tmp")).exists());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn read_backup_zip_rejects_missing_file() {
        let dest = tmp_path("does_not_exist.libreflow");
        let _ = std::fs::remove_file(&dest);
        assert!(read_backup_zip(&dest).is_err());
    }

    #[test]
    fn read_backup_zip_rejects_corrupted_archive() {
        let dest = tmp_path("corrupted.libreflow");
        std::fs::write(&dest, b"not a real zip file").unwrap();
        assert!(read_backup_zip(&dest).is_err());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn read_backup_zip_rejects_archive_missing_expected_entry() {
        // Build a ZIP that lacks the expected "manifest.json" entry.
        let dest = tmp_path("missing_entry.libreflow");
        {
            let file = std::fs::File::create(&dest).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("unexpected.json", opts).unwrap();
            zip.write_all(b"{}").unwrap();
            zip.finish().unwrap();
        }
        assert!(read_backup_zip(&dest).is_err());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn read_entry_rejects_declared_size_over_budget() {
        // Entry whose declared size already exceeds the remaining budget must
        // be rejected before any decompression happens.
        let dest = tmp_path("oversized_declared.libreflow");
        let big = "x".repeat(1000);
        {
            let file = std::fs::File::create(&dest).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("manifest.json", opts).unwrap();
            zip.write_all(big.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut budget: u64 = 10; // far smaller than the 1000-byte entry
        let res = read_entry(&mut archive, "manifest.json", &mut budget);
        assert!(res.is_err());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn read_entry_decrements_shared_budget_across_calls() {
        let dest = tmp_path("shared_budget.libreflow");
        {
            let file = std::fs::File::create(&dest).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("a.json", opts).unwrap();
            zip.write_all(b"12345").unwrap(); // 5 bytes
            zip.start_file("b.json", opts).unwrap();
            zip.write_all(b"12345").unwrap(); // 5 bytes
            zip.finish().unwrap();
        }
        let file = std::fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut budget: u64 = 8; // enough for the first entry, not both
        let a = read_entry(&mut archive, "a.json", &mut budget);
        assert!(a.is_ok());
        assert_eq!(budget, 3);
        let b = read_entry(&mut archive, "b.json", &mut budget);
        assert!(b.is_err(), "second entry should exceed the depleted budget");
        let _ = std::fs::remove_file(&dest);
    }
}
