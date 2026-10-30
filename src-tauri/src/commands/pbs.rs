use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PbsSection {
    pub header: String,
    pub fields: Vec<PbsField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PbsField {
    pub key: String,
    pub value: String,
}

fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid PBS filename: path separators not allowed".to_string());
    }
    if !filename.ends_with(".txt") {
        return Err("PBS filename must end with .txt".to_string());
    }
    let stem = &filename[..filename.len() - 4];
    if stem.is_empty() || !stem.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("PBS filename must contain only alphanumeric characters and underscores".to_string());
    }
    Ok(())
}

fn pbs_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join("PBS")
}

/// List all *.txt files present in {project}/PBS/.
#[tauri::command]
pub async fn list_pbs_files(project_path: String) -> Result<Vec<String>, String> {
    let dir = pbs_dir(&project_path);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read PBS directory: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            if name.ends_with(".txt") { Some(name) } else { None }
        })
        .collect();
    files.sort();
    Ok(files)
}

/// Parse a PBS file into sections.
/// - Lines matching `^\[(.+)\]$` → new section header
/// - Lines matching `^(\S[^=]*?)\s*=\s*(.*)$` → key/value field
/// - `#` comment lines and blank lines → skipped
/// - Indented lines in trainers.txt Pokémon sub-entries → key is preserved as-is
#[tauri::command]
pub async fn load_pbs_file(
    project_path: String,
    filename: String,
) -> Result<Vec<PbsSection>, String> {
    validate_filename(&filename)?;
    let path = pbs_dir(&project_path).join(&filename);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {filename}: {e}"))?;

    Ok(parse_pbs_content(&content))
}

/// Parse the editable section/field view without normalizing the source file.
fn parse_pbs_content(content: &str) -> Vec<PbsSection> {
    let mut sections: Vec<PbsSection> = Vec::new();
    let mut current: Option<PbsSection> = None;
    for line in content.lines() {
        let trimmed = line.trim_end();
        if let Some(header) = pbs_header(trimmed) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(PbsSection { header, fields: Vec::new() });
        } else if let Some((key, value, _)) = pbs_field(trimmed) {
            if let Some(section) = current.as_mut() {
                section.fields.push(PbsField { key, value });
            }
        }
    }
    if let Some(section) = current {
        sections.push(section);
    }
    sections
}

fn pbs_header(line: &str) -> Option<String> {
    if !line.starts_with('[') { return None; }
    let close = line.find(']')?;
    let rest = line[close + 1..].trim();
    if !rest.is_empty() && !rest.starts_with('#') { return None; }
    Some(line[1..close].trim().to_string())
}

fn pbs_field(line: &str) -> Option<(String, String, usize)> {
    if line.trim().is_empty() || line.starts_with('#') { return None; }
    let eq = line.find('=')?;
    let key = line[..eq].trim();
    if key.is_empty() { return None; }
    Some((key.to_string(), line[eq + 1..].trim().to_string(), eq))
}

/// Structured edits must never discard comments, blank lines, unknown text,
/// custom field formatting or CRLF. Patch only known value spans in place.
/// Structural changes require the raw PBS editor until a lossless structural
/// merge is implemented; rejecting them is safer than rewriting the file.
fn append_pbs_fields(out: &mut String, new_fields: &[PbsField], newline: &str) {
    for field in new_fields {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(newline);
        }
        out.push_str(&field.key);
        out.push_str(" = ");
        out.push_str(&field.value);
        out.push_str(newline);
    }
}

/// Merge changed values in place and append newly added fields/sections.
/// Deletion/reordering of existing structure is rejected instead of risking
/// loss of opaque lines and comments; raw editing remains available.
fn merge_pbs_existing(original: &str, edited: &[PbsSection]) -> Result<String, String> {
    let parsed = parse_pbs_content(original);
    if parsed.len() > edited.len() || parsed.iter().zip(edited).any(|(old, new)| {
        old.header != new.header || old.fields.len() > new.fields.len()
            || old.fields.iter().zip(&new.fields).any(|(a, b)| a.key != b.key)
    }) {
        return Err("Structured PBS sections/keys were removed or reordered; use the raw PBS editor to preserve comments and unknown data".into());
    }
    if edited.iter().any(|section| section.header.contains(&['\r', '\n', ']'][..])
        || section.fields.iter().any(|field| {
            field.key.contains(&['=', '\r', '\n'][..]) || field.value.contains(&['\r', '\n'][..])
        })) {
        return Err("PBS field/header contains an invalid delimiter or newline".into());
    }
    let newline = if original.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = String::with_capacity(original.len());
    let mut section_index: Option<usize> = None;
    let mut field_index = 0usize;
    for raw_line in original.split_inclusive('\n') {
        let bare = raw_line.trim_end_matches(&['\r', '\n'][..]);
        let trimmed = bare.trim_end();
        if pbs_header(trimmed).is_some() {
            if let Some(previous) = section_index {
                append_pbs_fields(&mut out,
                    &edited[previous].fields[parsed[previous].fields.len()..], newline);
            }
            section_index = Some(section_index.map_or(0, |i| i + 1));
            field_index = 0;
            out.push_str(raw_line);
        } else if let (Some(section), Some((_, old_value, eq))) =
            (section_index, pbs_field(trimmed))
        {
            let new_value = &edited[section].fields[field_index].value;
            field_index += 1;
            if *new_value == old_value {
                out.push_str(raw_line);
                continue;
            }
            // Keep indentation, spacing around '=', trailing spaces and
            // the original line ending; only replace the parsed value.
            let after_equals = &bare[eq + 1..];
            let leading_len = after_equals.len()
                - after_equals.trim_start_matches(&[' ', '\t'][..]).len();
            let trimmed_end = after_equals.trim_end_matches(&[' ', '\t'][..]);
            let trailing = if trimmed_end.len() <= leading_len {
                ""
            } else {
                &after_equals[trimmed_end.len()..]
            };
            out.push_str(&bare[..eq + 1]);
            out.push_str(&after_equals[..leading_len]);
            out.push_str(new_value);
            out.push_str(trailing);
            out.push_str(&raw_line[bare.len()..]);
        } else {
            out.push_str(raw_line);
        }
    }
    if let Some(last) = section_index {
        append_pbs_fields(&mut out, &edited[last].fields[parsed[last].fields.len()..], newline);
    }
    for section in &edited[parsed.len()..] {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(newline);
        }
        out.push('[');
        out.push_str(&section.header);
        out.push(']');
        out.push_str(newline);
        append_pbs_fields(&mut out, &section.fields, newline);
    }
    Ok(out)
}

/// Serialize sections back and write atomically.
#[tauri::command]
pub async fn save_pbs_file(
    project_path: String,
    filename: String,
    sections: Vec<PbsSection>,
) -> Result<(), String> {
    validate_filename(&filename)?;
    let dir = pbs_dir(&project_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create PBS directory: {e}"))?;

    let path = dir.join(&filename);
    let tmp_path = dir.join(format!("{filename}.tmp"));

    let mut out = String::new();
    for (i, section) in sections.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push('[');
        out.push_str(&section.header);
        out.push_str("]\n");
        for field in &section.fields {
            out.push_str(&field.key);
            out.push_str(" = ");
            out.push_str(&field.value);
            out.push('\n');
        }
    }

    if path.exists() {
        let original = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read existing {filename}: {e}"))?;
        out = merge_pbs_existing(&original, &sections)?;
        if out == original {
            return Ok(());
        }
    }

    // The structured UI is not a raw text editor. A newly created file (or
    // appended field/section) can otherwise serialize delimiters and newlines
    // that the parser cannot read back as the requested edit. Reject before
    // touching the file, including for existing projects.
    if parse_pbs_content(&out) != sections {
        return Err("Structured PBS edit cannot be read back losslessly; use the raw PBS editor".into());
    }

    std::fs::write(&tmp_path, &out)
        .map_err(|e| format!("Failed to write {filename}: {e}"))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize {filename}: {e}"))?;

    eprintln!("[pbs] Saved {filename} ({} sections)", sections.len());
    Ok(())
}

/// Check if an asset file exists at the given absolute path.
///
/// NOTE: This probes an arbitrary frontend-supplied path. In practice it is only
/// ever called with paths returned by `get_asset_path` (which are validated and
/// confined to the project), so it is a boolean existence check on already-known
/// paths. If a caller ever needs to probe a frontend-derived name, switch this to
/// take `(project_path, asset_type, asset_name)` and route through
/// `get_asset_path` so traversal validation applies.
#[tauri::command]
pub async fn asset_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

/// Read a PBS file as raw text (for files with non-standard formats like encounters.txt).
#[tauri::command]
pub async fn read_raw_pbs_file(
    project_path: String,
    filename: String,
) -> Result<String, String> {
    validate_filename(&filename)?;
    let path = pbs_dir(&project_path).join(&filename);
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {filename}: {e}"))
}

/// Write raw text to a PBS file (for files with non-standard formats like encounters.txt).
#[tauri::command]
pub async fn write_raw_pbs_file(
    project_path: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    validate_filename(&filename)?;
    let dir = pbs_dir(&project_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create PBS directory: {e}"))?;
    let path = dir.join(&filename);
    let tmp_path = dir.join(format!("{filename}.tmp"));
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write {filename}: {e}"))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize {filename}: {e}"))?;
    eprintln!("[pbs] Wrote raw {filename} ({} bytes)", content.len());
    Ok(())
}


#[cfg(test)]
mod pbs_preservation_tests {
    use super::*;

    #[test]
    fn no_op_and_targeted_edit_preserve_comments_unknown_lines_and_crlf() {
        let original = "# header\r\n[PIKACHU] # section note\r\nName   =  Pikachu  \r\n# preserve me\r\nUnknown directive\r\nTypes=ELECTRIC\r\nCustom = A=B\r\n";
        let mut sections = parse_pbs_content(original);
        assert_eq!(merge_pbs_existing(original, &sections).unwrap(), original);
        sections[0].fields[1].value = "ELECTRIC,FAIRY".into();
        let expected = original.replace("Types=ELECTRIC", "Types=ELECTRIC,FAIRY");
        assert_eq!(merge_pbs_existing(original, &sections).unwrap(), expected);
        assert_eq!(parse_pbs_content(&expected), sections);
    }

    #[test]
    fn structured_save_refuses_dropping_unknown_fields_or_sections() {
        let original = "[ONE]\nKnown = yes\nCustom = keep\n[TWO]\nName = safe\n";
        let mut sections = parse_pbs_content(original);
        sections[0].fields.pop();
        assert!(merge_pbs_existing(original, &sections).unwrap_err().contains("raw PBS editor"));
        let mut sections = parse_pbs_content(original);
        sections.pop();
        assert!(merge_pbs_existing(original, &sections).is_err());
    }

    #[test]
    fn appending_fields_and_sections_keeps_existing_comments_and_line_endings() {
        let original = "# header\r\n[ONE]\r\nName = First\r\n# tail comment\r\n";
        let mut sections = parse_pbs_content(original);
        sections[0].fields.push(PbsField { key: "NewField".into(), value: "value".into() });
        sections.push(PbsSection { header: "TWO".into(), fields: vec![
            PbsField { key: "Name".into(), value: "Second".into() },
        ] });
        let merged = merge_pbs_existing(original, &sections).unwrap();
        assert_eq!(merged, format!("{original}NewField = value\r\n[TWO]\r\nName = Second\r\n"));
        assert_eq!(parse_pbs_content(&merged), sections);
    }

    #[tokio::test]
    async fn structured_save_rejects_unreadable_fields_without_changing_existing_file() {
        let unique = format!("essentials-pbs-roundtrip-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                .unwrap().as_nanos());
        let root = std::env::temp_dir().join(unique);
        let project = root.to_string_lossy().into_owned();
        let valid = vec![PbsSection {
            header: "ONE".into(),
            fields: vec![PbsField { key: "Name".into(), value: "Valid".into() }],
        }];
        save_pbs_file(project.clone(), "pokemon.txt".into(), valid.clone()).await.unwrap();
        let path = root.join("PBS/pokemon.txt");
        let before = std::fs::read(&path).unwrap();
        assert_eq!(load_pbs_file(project.clone(), "pokemon.txt".into()).await.unwrap(), valid);

        let mut bad_key = valid.clone();
        bad_key[0].fields[0].key = "Name=Alias".into();
        assert!(save_pbs_file(project.clone(), "pokemon.txt".into(), bad_key)
            .await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);

        let mut bad_value = valid.clone();
        bad_value[0].fields[0].value = "Valid\nInjected = yes".into();
        assert!(save_pbs_file(project.clone(), "pokemon.txt".into(), bad_value)
            .await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);

        let mut bad_header = valid.clone();
        bad_header[0].header = "ONE]\n[TWO".into();
        assert!(save_pbs_file(project.clone(), "fresh.txt".into(), bad_header)
            .await.unwrap_err().contains("losslessly"));
        assert!(!root.join("PBS/fresh.txt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_newline_injected_values_and_preserves_duplicate_field_order() {
        let original = "[ONE]\nTag = first\nTag = second\n";
        let mut sections = parse_pbs_content(original);
        sections[0].fields[1].value = "changed".into();
        assert_eq!(merge_pbs_existing(original, &sections).unwrap(),
            "[ONE]\nTag = first\nTag = changed\n");
        sections[0].fields[1].value = "changed\nInjected = true".into();
        assert!(merge_pbs_existing(original, &sections).is_err());
    }
}
