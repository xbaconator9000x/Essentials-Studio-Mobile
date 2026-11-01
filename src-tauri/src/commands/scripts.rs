use crate::marshal;
use crate::marshal::types::{RubyString, RubyValue};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;

/// Lightweight script entry for the list (no source).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptEntry {
    pub id: i64,
    pub title: String,
}

/// Full script data for saving.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptData {
    pub id: i64,
    pub title: String,
    pub source: String,
}

// ── Helpers ──────────────────────────────────────────────────────────

fn load_scripts_raw(project_path: &str) -> Result<Vec<RubyValue>, String> {
    let path = PathBuf::from(project_path)
        .join("Data")
        .join("Scripts.rxdata");
    let value = marshal::load_file(&path)
        .map_err(|e| format!("Failed to parse Scripts.rxdata: {}", e))?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| "Scripts.rxdata is not an array".to_string())
}

// A single compressed Ruby script can expand far beyond the size of the
// project ZIP. Bound decoding before allocating the complete source in the
// WebView/editor, and never replace non-UTF-8 Ruby bytes with U+FFFD.
const MAX_SCRIPT_SOURCE_BYTES: u64 = 32 * 1024 * 1024;

fn decompress_zlib_with_limit(data: &[u8], limit: u64) -> Result<String, String> {
    if data.is_empty() {
        return Ok(String::new());
    }
    let decoder = ZlibDecoder::new(data);
    let mut output = Vec::new();
    decoder
        .take(limit.saturating_add(1))
        .read_to_end(&mut output)
        .map_err(|e| format!("Zlib decompression failed: {e}"))?;
    if output.len() as u64 > limit {
        return Err(format!("Ruby script source exceeds {limit} decompressed bytes"));
    }
    String::from_utf8(output).map_err(|_| {
        "Ruby script source is not UTF-8; refusing lossy decoding or save".to_string()
    })
}

fn decompress_zlib(data: &[u8]) -> Result<String, String> {
    decompress_zlib_with_limit(data, MAX_SCRIPT_SOURCE_BYTES)
}

fn compress_zlib(source: &str) -> Result<Vec<u8>, String> {
    if source.len() as u64 > MAX_SCRIPT_SOURCE_BYTES {
        return Err(format!("Ruby script source exceeds {MAX_SCRIPT_SOURCE_BYTES} bytes"));
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(source.as_bytes())
        .map_err(|e| format!("Zlib compression failed: {}", e))?;
    encoder
        .finish()
        .map_err(|e| format!("Zlib compression finish failed: {}", e))
}

/// Extract (id, title) from a script entry RubyValue (a 3-element array).
fn parse_script_entry(entry: &RubyValue) -> Option<(i64, String, &[u8])> {
    let arr = entry.as_array()?;
    if arr.len() < 3 {
        return None;
    }
    let id = match &arr[0] {
        RubyValue::Integer(n) => *n,
        _ => return None,
    };
    let title = match &arr[1] {
        RubyValue::String(s) => s.to_string_lossy(),
        _ => return None,
    };
    let data = match &arr[2] {
        RubyValue::String(s) => s.bytes.as_slice(),
        _ => return None,
    };
    Some((id, title, data))
}

/// Build the lightweight script list (id + title) from the raw scripts array,
/// skipping nil entries and anything that isn't a valid 3-element script entry.
fn script_entries(arr: &[RubyValue]) -> Vec<ScriptEntry> {
    let mut result = Vec::new();
    for entry in arr {
        if let RubyValue::Nil = entry {
            continue;
        }
        if let Some((id, title, _)) = parse_script_entry(entry) {
            result.push(ScriptEntry { id, title });
        }
    }
    result
}

/// Script IDs are editor identity keys. A duplicate can make a load select
/// the wrong source or a delete erase multiple entries. Reject ambiguity
/// before writing any Ruby Marshal data.
fn ensure_unique_script_ids(arr: &[RubyValue]) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in arr {
        if let Some((id, _, _)) = parse_script_entry(entry) {
            // The frontend exposes titles as UTF-8 strings. Lossy decoding of a
            // legacy-encoded title would turn an unchanged save into corruption.
            let parts = entry.as_array().expect("parsed script entry must be an array");
            if let RubyValue::String(raw_title) = &parts[1] {
                if std::str::from_utf8(&raw_title.bytes).is_err() {
                    return Err(format!("Script {id} title is not UTF-8; refusing lossy edit"));
                }
            }
            if !seen.insert(id) {
                return Err(format!("Duplicate original script ID {id}; refusing ambiguous operation"));
            }
        }
    }
    Ok(())
}

fn next_script_id(arr: &[RubyValue]) -> Result<i64, String> {
    let max_id = arr.iter()
        .filter_map(|entry| parse_script_entry(entry).map(|(id, _, _)| id))
        .max().unwrap_or(0);
    max_id.checked_add(1)
        .ok_or_else(|| "Cannot create script: script ID space is exhausted".to_string())
}

// ── Commands ─────────────────────────────────────────────────────────

/// Load the script list (id + title only, no decompression).
#[tauri::command]
pub async fn load_script_list(project_path: String) -> Result<Vec<ScriptEntry>, String> {
    let arr = load_scripts_raw(&project_path)?;
    ensure_unique_script_ids(&arr)?;
    let result = script_entries(&arr);

    eprintln!("[scripts] Loaded {} script entries", result.len());
    Ok(result)
}

/// Load the decompressed source of a single script by ID.
#[tauri::command]
pub async fn load_script_source(
    project_path: String,
    script_id: i64,
) -> Result<String, String> {
    let arr = load_scripts_raw(&project_path)?;
    ensure_unique_script_ids(&arr)?;

    for entry in &arr {
        if let RubyValue::Nil = entry {
            continue;
        }
        if let Some((id, _, data)) = parse_script_entry(entry) {
            if id == script_id {
                let source = decompress_zlib(data)?;
                eprintln!(
                    "[scripts] Loaded script {} ({} bytes decompressed)",
                    script_id,
                    source.len()
                );
                return Ok(source);
            }
        }
    }

    Err(format!("Script with id {} not found", script_id))
}

/// Reconcile the frontend's submitted script entries with the original Marshal
/// array. Save All is NOT a delete command: a partially loaded editor list must
/// never erase omitted scripts, opaque entries, extra tuple fields or nil slots.
/// Explicit deletion is handled separately by delete_script.
fn merge_script_entries(original: &[RubyValue], scripts: &[ScriptData]) -> Result<Vec<RubyValue>, String> {
    ensure_unique_script_ids(original)?;
    let mut submitted = HashMap::new();
    for script in scripts {
        if submitted.insert(script.id, script).is_some() {
            return Err(format!("Duplicate submitted script ID {}", script.id));
        }
    }

    let mut seen_original = HashSet::new();
    let mut merged = Vec::with_capacity(original.len() + scripts.len());
    for entry in original {
        if let Some((id, _, _)) = parse_script_entry(entry) {
            if !seen_original.insert(id) {
                return Err(format!("Duplicate original script ID {id}; refusing destructive save"));
            }
            // A partial editor payload must not delete a script. Only the
            // explicit delete_script command is permitted to remove entries.
            if let Some(script) = submitted.get(&id) {
                let RubyValue::Array(parts) = entry else { unreachable!() };
                let mut parts = parts.clone();
                let (_, old_title, compressed) = parse_script_entry(entry).unwrap();
                if old_title != script.title {
                    parts[1] = RubyValue::String(RubyString::new(script.title.as_bytes().to_vec()));
                }
                // Compare the source, not the compressed representation: zlib may
                // emit different bytes for the same Ruby script. A failed decode
                // aborts the entire save rather than silently replacing the data.
                if decompress_zlib(compressed)? != script.source {
                    parts[2] = RubyValue::String(RubyString::new(compress_zlib(&script.source)?));
                }
                merged.push(RubyValue::Array(parts));
            } else {
                merged.push(entry.clone());
            }
        } else {
            // Preserve unknown/custom Marshal entries and nil slots in place.
            merged.push(entry.clone());
        }
    }
    // New scripts are appended in the order supplied by the editor.
    for script in scripts {
        if !seen_original.contains(&script.id) {
            merged.push(RubyValue::Array(vec![
                RubyValue::Integer(script.id),
                RubyValue::String(RubyString::new(script.title.as_bytes().to_vec())),
                RubyValue::String(RubyString::new(compress_zlib(&script.source)?)),
            ]));
        }
    }
    Ok(merged)
}

/// Save edited script sources without recompressing unrelated Ruby scripts or
/// discarding custom/opaque entries in Scripts.rxdata.
#[tauri::command]
pub async fn save_all_scripts(
    project_path: String,
    scripts: Vec<ScriptData>,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path)
        .join("Data")
        .join("Scripts.rxdata");
    let original = load_scripts_raw(&project_path)?;
    let merged = merge_script_entries(&original, &scripts)?;
    // The original Marshal stream may use bare Ruby 1.8 strings or object
    // references that our generic writer cannot reproduce byte-for-byte.
    // A no-op Save All must therefore never rewrite Scripts.rxdata.
    if merged == original {
        return Ok(());
    }
    marshal::dump_file(&path, &RubyValue::Array(merged))
        .map_err(|e| format!("Failed to save Scripts.rxdata: {}", e))?;
    eprintln!("[scripts] Saved {} scripts to {:?}", scripts.len(), path);
    Ok(())
}

/// Create a new script, inserting it after the given script ID.
/// Returns the updated script list.
#[tauri::command]
pub async fn create_script(
    project_path: String,
    title: String,
    after_id: i64,
) -> Result<Vec<ScriptEntry>, String> {
    let path = PathBuf::from(&project_path)
        .join("Data")
        .join("Scripts.rxdata");
    let mut arr = load_scripts_raw(&project_path)?;
    ensure_unique_script_ids(&arr)?;

    // Generate a unique magic number
    let new_id = next_script_id(&arr)?;

    // Build the new entry (empty source)
    let compressed = compress_zlib("")?;
    let new_entry = RubyValue::Array(vec![
        RubyValue::Integer(new_id),
        RubyValue::String(RubyString::new(title.as_bytes().to_vec())),
        RubyValue::String(RubyString::new(compressed)),
    ]);

    // Find insertion point (after the entry with after_id)
    let mut insert_idx = arr.len(); // default: append at end
    for (i, entry) in arr.iter().enumerate() {
        if let Some((id, _, _)) = parse_script_entry(entry) {
            if id == after_id {
                insert_idx = i + 1;
                break;
            }
        }
    }
    arr.insert(insert_idx, new_entry);

    // Save
    let value = RubyValue::Array(arr.clone());
    marshal::dump_file(&path, &value)
        .map_err(|e| format!("Failed to save Scripts.rxdata: {}", e))?;

    // Return updated list
    let result = script_entries(&arr);

    eprintln!("[scripts] Created script '{}' (id={})", title, new_id);
    Ok(result)
}

/// Delete a script by ID. Returns the updated script list.
#[tauri::command]
pub async fn delete_script(
    project_path: String,
    script_id: i64,
) -> Result<Vec<ScriptEntry>, String> {
    let path = PathBuf::from(&project_path)
        .join("Data")
        .join("Scripts.rxdata");
    let mut arr = load_scripts_raw(&project_path)?;
    ensure_unique_script_ids(&arr)?;

    // Find and remove the script
    let original_len = arr.len();
    arr.retain(|entry| {
        if let Some((id, _, _)) = parse_script_entry(entry) {
            id != script_id
        } else {
            true // keep nil entries
        }
    });

    if arr.len() == original_len {
        return Err(format!("Script with id {} not found", script_id));
    }

    // Save
    let value = RubyValue::Array(arr.clone());
    marshal::dump_file(&path, &value)
        .map_err(|e| format!("Failed to save Scripts.rxdata: {}", e))?;

    // Return updated list
    let result = script_entries(&arr);

    eprintln!("[scripts] Deleted script id={}", script_id);
    Ok(result)
}

#[cfg(test)]
mod fidelity_tests {
    use super::*;

    fn script(id: i64, title: &str, source: &str) -> RubyValue {
        RubyValue::Array(vec![
            RubyValue::Integer(id),
            RubyValue::String(RubyString::new(title.as_bytes().to_vec())),
            RubyValue::String(RubyString::new(compress_zlib(source).unwrap())),
            RubyValue::Symbol("extra_script_metadata".into()),
        ])
    }

    fn source(id: i64, title: &str, source: &str) -> ScriptData {
        ScriptData { id, title: title.into(), source: source.into() }
    }

    #[test]
    fn unchanged_scripts_preserve_marshal_bytes_and_opaque_slots() {
        let original = vec![
            RubyValue::Nil,
            script(11, "Main", "def main\\n  puts :hello\\nend"),
            RubyValue::Hash(vec![(RubyValue::Symbol("custom".into()), RubyValue::Integer(42))]),
            RubyValue::Nil,
            script(12, "Utility", "# Pokémon Essentials\\nmodule Test; end"),
        ];
        let submitted = vec![
            source(11, "Main", "def main\\n  puts :hello\\nend"),
            source(12, "Utility", "# Pokémon Essentials\\nmodule Test; end"),
        ];
        let merged = merge_script_entries(&original, &submitted).unwrap();
        assert_eq!(merged, original);
        let before = marshal::dump(&RubyValue::Array(original)).unwrap();
        let after = marshal::dump(&RubyValue::Array(merged)).unwrap();
        assert_eq!(before, after, "unchanged Scripts.rxdata should remain byte-identical");
        assert_eq!(marshal::load(&after).unwrap(), marshal::load(&before).unwrap());
    }

    #[test]
    fn targeted_script_edit_preserves_other_sources_and_custom_tuple_fields() {
        let original = vec![
            RubyValue::Nil,
            script(11, "Main", "old source"),
            script(12, "Untouched", "unchanged source"),
        ];
        let submitted = vec![
            source(11, "Main renamed", "new source"),
            source(12, "Untouched", "unchanged source"),
            source(13, "Added", "new script"),
        ];
        let merged = merge_script_entries(&original, &submitted).unwrap();
        assert_eq!(merged[2], original[2], "unmodified script must retain its zlib bytes");
        assert_eq!(merged[1].as_array().unwrap()[3], RubyValue::Symbol("extra_script_metadata".into()));
        let encoded = marshal::dump(&RubyValue::Array(merged)).unwrap();
        let decoded = marshal::load(&encoded).unwrap();
        let entries = decoded.as_array().unwrap();
        let (_, title, compressed) = parse_script_entry(&entries[1]).unwrap();
        assert_eq!(title, "Main renamed");
        assert_eq!(decompress_zlib(compressed).unwrap(), "new source");
        assert_eq!(decompress_zlib(parse_script_entry(&entries[3]).unwrap().2).unwrap(), "new script");
    }

    #[test]
    fn refuses_duplicate_ids_and_corrupt_original_zlib() {
        let original = vec![RubyValue::Nil, script(1, "Original", "safe")];
        assert!(merge_script_entries(&original, &[source(1, "A", "a"), source(1, "B", "b")]).is_err());
        let mut duplicated = original.clone();
        duplicated.push(script(1, "Again", "unsafe"));
        assert!(merge_script_entries(&duplicated, &[source(1, "A", "a")]).is_err());
        let corrupt = vec![
            RubyValue::Nil,
            RubyValue::Array(vec![
                RubyValue::Integer(1),
                RubyValue::String(RubyString::new(b"Original".to_vec())),
                RubyValue::String(RubyString::new(b"not-zlib".to_vec())),
            ]),
        ];
        assert!(merge_script_entries(&corrupt, &[source(1, "Original", "safe")]).is_err());
    }
    #[test]
    fn non_utf8_ruby_script_is_rejected_without_replacement_characters() {
        // Ruby XP scripts can contain legacy-encoded bytes. An editor that
        // only accepts UTF-8 must refuse them, not silently rewrite them.
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&[0xff, 0xfe, b'R', b'G', b'S', b'S']).unwrap();
        let compressed = encoder.finish().unwrap();
        let original = vec![RubyValue::Array(vec![
            RubyValue::Integer(7),
            RubyValue::String(RubyString::new(b"Legacy".to_vec())),
            RubyValue::String(RubyString::new(compressed.clone())),
        ])];
        assert!(decompress_zlib(&compressed).unwrap_err().contains("not UTF-8"));
        assert!(merge_script_entries(&original, &[source(7, "Legacy", "replacement")]).is_err());
        assert_eq!(parse_script_entry(&original[0]).unwrap().2, compressed.as_slice());
    }

    #[test]
    fn compressed_script_expansion_and_new_source_are_bounded() {
        let compressed = compress_zlib("012345").unwrap();
        assert_eq!(decompress_zlib_with_limit(&compressed, 6).unwrap(), "012345");
        assert!(decompress_zlib_with_limit(&compressed, 5)
            .unwrap_err().contains("exceeds"));
        let oversized = "x".repeat(MAX_SCRIPT_SOURCE_BYTES as usize + 1);
        assert!(compress_zlib(&oversized).unwrap_err().contains("exceeds"));
    }

    #[test]
    fn duplicate_script_ids_fail_closed_without_touching_opaque_entries() {
        let duplicate = vec![
            RubyValue::Nil,
            script(9, "First", "puts :one"),
            RubyValue::Symbol("opaque".into()),
            script(9, "Second", "puts :two"),
        ];
        assert!(ensure_unique_script_ids(&duplicate).unwrap_err().contains("Duplicate"));
        let unique = vec![RubyValue::Nil, script(9, "First", "puts :one")];
        assert!(ensure_unique_script_ids(&unique).is_ok());
    }

    fn test_project_with_scripts(prefix: &str, entries: Vec<RubyValue>) -> (PathBuf, PathBuf, Vec<u8>) {
        let unique = format!(
            "{prefix}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let data = root.join("Data");
        std::fs::create_dir_all(&data).unwrap();
        let path = data.join("Scripts.rxdata");
        marshal::dump_file(&path, &RubyValue::Array(entries)).unwrap();
        let before = std::fs::read(&path).unwrap();
        (root, path, before)
    }

    #[tokio::test]
    async fn legacy_encoded_script_title_refuses_lossy_save_and_preserves_file() {
        let legacy = RubyValue::Array(vec![
            RubyValue::Integer(7),
            RubyValue::String(RubyString::new(vec![b'L', 0xff, b'g'])),
            RubyValue::String(RubyString::new(compress_zlib("puts :ok").unwrap())),
        ]);
        let (root, path, before) = test_project_with_scripts(
            "essentials-legacy-script-title", vec![RubyValue::Nil, legacy],
        );
        let project = root.to_string_lossy().into_owned();
        assert!(load_script_list(project.clone()).await.unwrap_err().contains("not UTF-8"));
        assert!(load_script_source(project.clone(), 7).await.unwrap_err().contains("not UTF-8"));
        assert!(save_all_scripts(project.clone(), vec![source(7, "L�g", "puts :ok")])
            .await.unwrap_err().contains("not UTF-8"));
        assert!(create_script(project.clone(), "New".into(), 7).await.unwrap_err().contains("not UTF-8"));
        assert!(delete_script(project.clone(), 7).await.unwrap_err().contains("not UTF-8"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn duplicate_ids_refuse_script_delete_and_create_without_writing_file() {
        let (root, path, before) = test_project_with_scripts(
            "essentials-script-guard",
            vec![
                script(5, "First", "puts :one"),
                RubyValue::Nil,
                script(5, "Second", "puts :two"),
            ],
        );
        let project_path = root.to_string_lossy().into_owned();

        let deleted = delete_script(project_path.clone(), 5).await;
        assert!(deleted.unwrap_err().contains("Duplicate original script ID"));
        assert_eq!(std::fs::read(&path).unwrap(), before);

        let created = create_script(project_path.clone(), "New".into(), 5).await;
        assert!(created.unwrap_err().contains("Duplicate original script ID"));
        assert_eq!(std::fs::read(&path).unwrap(), before);

        let loaded = load_script_source(project_path.clone(), 5).await;
        assert!(loaded.unwrap_err().contains("Duplicate original script ID"));
        assert_eq!(std::fs::read(&path).unwrap(), before);

        std::fs::remove_dir_all(&root).unwrap();
    }


    #[test]
    fn partial_script_save_never_deletes_omitted_entries() {
        let original = vec![
            RubyValue::Nil,
            script(11, "Main", "old source"),
            RubyValue::Symbol("opaque_custom_entry".into()),
            script(12, "Other", "keep me"),
            script(13, "Third", "also keep me"),
        ];
        let merged = merge_script_entries(
            &original,
            &[source(11, "Main", "new source")],
        ).unwrap();
        assert_eq!(merged.len(), original.len());
        assert_eq!(merged[0], original[0]);
        assert_eq!(merged[2], original[2]);
        assert_eq!(merged[3], original[3], "omitted script must not be deleted");
        assert_eq!(merged[4], original[4], "omitted script must not be deleted");
        assert_eq!(
            decompress_zlib(parse_script_entry(&merged[1]).unwrap().2).unwrap(),
            "new source"
        );
        assert_eq!(
            merge_script_entries(&original, &[]).unwrap(),
            original,
            "empty Save All payload is a no-op, not a delete-all operation"
        );
    }

    #[tokio::test]
    async fn no_op_save_preserves_bare_string_marshal_stream() {
        // Ruby 1.8 can encode strings without the 'I' wrapper. The Marshal
        // writer now preserves that encoding exactly, but Save All must still
        // avoid rewriting source bytes when nothing has changed.
        let compressed = compress_zlib("puts :ok").unwrap();
        assert!(compressed.len() < 120);
        let mut original_bytes = vec![
            4, 8, b'[', 6, // top-level array with one script
            b'[', 8,       // script tuple with three fields
            b'i', 6,       // script ID 1
            b'"', 9,       // bare title string of length four
        ];
        original_bytes.extend_from_slice(b"Main");
        original_bytes.push(b'"');
        original_bytes.push((compressed.len() + 5) as u8);
        original_bytes.extend_from_slice(&compressed);
        let decoded = marshal::load(&original_bytes).unwrap();
        assert_eq!(marshal::dump(&decoded).unwrap(), original_bytes);

        let (root, path, _) = test_project_with_scripts(
            "essentials-bare-script", vec![script(1, "Main", "puts :ok")],
        );
        std::fs::write(&path, &original_bytes).unwrap();
        let project = root.to_string_lossy().into_owned();
        save_all_scripts(project.clone(), vec![source(1, "Main", "puts :ok")])
            .await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original_bytes);
        save_all_scripts(project, vec![]).await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original_bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn partial_script_save_keeps_other_scripts_on_disk() {
        let (root, path, _) = test_project_with_scripts(
            "essentials-partial-script",
            vec![
                script(1, "Main", "puts :old"),
                script(2, "Untouched", "puts :safe"),
                RubyValue::Symbol("extension_slot".into()),
            ],
        );
        let project = root.to_string_lossy().into_owned();
        save_all_scripts(project.clone(), vec![source(1, "Main", "puts :new")])
            .await.unwrap();
        let decoded = marshal::load_file(&path).unwrap();
        let arr = decoded.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[2], RubyValue::Symbol("extension_slot".into()));
        assert_eq!(
            decompress_zlib(parse_script_entry(&arr[0]).unwrap().2).unwrap(),
            "puts :new"
        );
        assert_eq!(
            decompress_zlib(parse_script_entry(&arr[1]).unwrap().2).unwrap(),
            "puts :safe"
        );
        // Explicit deletion remains available and removes only the selected ID.
        delete_script(project, 2).await.unwrap();
        let deleted = marshal::load_file(&path).unwrap();
        let arr = deleted.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(parse_script_entry(&arr[0]).unwrap().0, 1);
        assert_eq!(arr[1], RubyValue::Symbol("extension_slot".into()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn script_id_overflow_is_rejected_before_serialization() {
        // Ruby Marshal fixnums are narrower than i64; exercise the guard
        // directly rather than trying to serialize an unrepresentable ID.
        let entries = vec![script(i64::MAX, "Last", "puts :last")];
        assert!(next_script_id(&entries).unwrap_err().contains("script ID space is exhausted"));
    }
}
