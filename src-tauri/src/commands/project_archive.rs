//! Safe, app-private ZIP ingestion for Essentials / RPG Maker XP projects.
//! Upload is chunked to avoid Android content-URI and large single-IPC payload issues.
//! Original archives are never modified. Editor features use the existing XP backend.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 256 * 1024;
const MAX_UNPACKED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 384 * 1024 * 1024;
const MAX_ENTRIES: usize = 30_000;

fn safe_id(id: &str) -> Result<(), String> {
    if !id.starts_with("import-")
        || id.len() > 90
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid import ID".into());
    }
    Ok(())
}

fn import_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = root.join("imports");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = root.join("projects");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn staging_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    safe_id(id)?;
    Ok(root.join(format!("{id}.zip")))
}

fn unique_id() -> Result<String, String> {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(format!("import-{}-{time}", std::process::id()))
}

#[tauri::command]
pub async fn begin_project_archive_import(app: AppHandle) -> Result<String, String> {
    let root = import_root(&app)?;
    for _ in 0..3 {
        let id = unique_id()?;
        let path = staging_path(&root, &id)?;
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(_) => return Ok(id),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Could not create import: {e}")),
        }
    }
    Err("Unable to allocate a unique import ID".into())
}

#[tauri::command]
pub async fn append_project_archive_chunk(
    app: AppHandle,
    import_id: String,
    chunk_base64: String,
) -> Result<u64, String> {
    // A cap on encoded data also limits temporary memory use before decoding.
    if chunk_base64.len() > (MAX_CHUNK_BYTES * 4 / 3 + 8) {
        return Err("Upload chunk exceeds 256 KiB limit".into());
    }
    let bytes = STANDARD
        .decode(chunk_base64.as_bytes())
        .map_err(|_| "Invalid Base64 archive chunk".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
        return Err("Invalid archive chunk size".into());
    }
    let path = staging_path(&import_root(&app)?, &import_id)?;
    let mut file = OpenOptions::new().append(true).open(&path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size.checked_add(bytes.len() as u64).is_none_or(|sum| sum > MAX_ARCHIVE_BYTES) {
        return Err("Project archive exceeds 512 MiB limit".into());
    }
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(size + bytes.len() as u64)
}

#[tauri::command]
pub async fn abort_project_archive_import(app: AppHandle, import_id: String) -> Result<(), String> {
    let path = staging_path(&import_root(&app)?, &import_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clean_zip_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('\\') || name.contains('\0') || name.contains(':') {
        return Err("Archive contains an invalid filename".into());
    }
    let path = Path::new(name);
    if path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("Archive contains path traversal or an absolute path".into());
    }
    Ok(path.to_path_buf())
}

fn extract_archive(archive_path: &Path, extracted: &Path) -> Result<PathBuf, String> {
    let src = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(src).map_err(|e| format!("Not a valid ZIP: {e}"))?;
    if zip.len() > MAX_ENTRIES {
        return Err("Too many archive entries".into());
    }
    fs::create_dir_all(extracted).map_err(|e| e.to_string())?;
    let mut total_unpacked = 0u64;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let path = clean_zip_path(entry.name())?;
        // Reject symbolic links and other special Unix file types.
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err("Archive contains a symbolic link or special file".into());
            }
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err("Archive entry exceeds size limit".into());
        }
        total_unpacked = total_unpacked
            .checked_add(entry.size())
            .ok_or("Archive size overflow")?;
        if total_unpacked > MAX_UNPACKED_BYTES {
            return Err("Archive expands beyond 2 GiB limit".into());
        }
        let destination = extracted.join(&path);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Never follow or overwrite an existing path, even for duplicate ZIP names.
        let mut dest_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|e| format!("Duplicate or invalid archive entry: {e}"))?;
        let count = io::copy(&mut entry.by_ref().take(MAX_FILE_BYTES + 1), &mut dest_file)
            .map_err(|e| e.to_string())?;
        if count != entry.size() {
            return Err("Incomplete or oversized archive entry".into());
        }
    }

    if extracted.join("Game.rxproj").is_file() {
        return Ok(extracted.to_path_buf());
    }
    let children = fs::read_dir(extracted).map_err(|e| e.to_string())?;
    let mut candidates = children
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("Game.rxproj").is_file());
    let project = candidates.next().ok_or(
        "ZIP does not contain Game.rxproj at the root or inside one project folder",
    )?;
    if candidates.next().is_some() {
        return Err("ZIP contains multiple RPG Maker projects".into());
    }
    Ok(project)
}

fn finish_import(archive_path: PathBuf, imports: PathBuf, projects: PathBuf, id: String) -> Result<String, String> {
    let extracted = imports.join(format!("{id}-extracted"));
    let result = (|| {
        let root = extract_archive(&archive_path, &extracted)?;
        let dest = projects.join(&id);
        fs::rename(&root, &dest).map_err(|e| format!("Could not publish imported project: {e}"))?;
        Ok::<String, String>(dest.to_string_lossy().into_owned())
    })();
    let _ = fs::remove_file(archive_path);
    let _ = fs::remove_dir_all(extracted);
    result
}

#[tauri::command]
pub async fn finish_project_archive_import(
    app: AppHandle,
    import_id: String,
) -> Result<String, String> {
    let imports = import_root(&app)?;
    let projects = projects_root(&app)?;
    let archive_path = staging_path(&imports, &import_id)?;
    tauri::async_runtime::spawn_blocking(move || finish_import(archive_path, imports, projects, import_id))
        .await
        .map_err(|e| format!("Import worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::clean_zip_path;
    #[test]
    fn blocks_absolute_and_traversal_paths() {
        for bad in ["../x", "/root/x", "a/../b", "C:/Users/x", "x\\y", "."] {
            assert!(clean_zip_path(bad).is_err(), "Accepted malicious path {bad}");
        }
    }
    #[test]
    fn allows_normal_project_paths() {
        for good in ["Game.rxproj", "Data/Map001.rxdata", "Graphics/Tilesets/forest.png"] {
            assert!(clean_zip_path(good).is_ok());
        }
    }
}


/// An exported ZIP is always created inside the app sandbox before any user share action.
#[derive(serde::Serialize)]
pub struct ProjectArchiveExport {
    pub export_id: String,
    pub size: u64,
}

fn safe_export_id(id: &str) -> Result<(), String> {
    if id.starts_with("export-")
        && id.len() <= 90
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        Ok(())
    } else {
        Err("Invalid export ID".into())
    }
}

fn exports_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("exports");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn export_zip(project_dir: &Path, target: &Path) -> Result<u64, String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut directories = vec![project_dir.to_path_buf()];
    let mut count = 0usize;
    let mut total_bytes = 0u64;
    while let Some(dir) = directories.pop() {
        let mut entries = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                return Err("Cannot export a project containing symlinks".into());
            }
            if meta.is_dir() {
                directories.push(path);
                continue;
            }
            if !meta.is_file() {
                return Err("Cannot export a project containing special files".into());
            }
            count += 1;
            if count > MAX_ENTRIES || meta.len() > MAX_FILE_BYTES {
                return Err("Export contains too many files or an oversized file".into());
            }
            total_bytes = total_bytes.checked_add(meta.len()).ok_or("Export overflow")?;
            if total_bytes > MAX_UNPACKED_BYTES {
                return Err("Project exceeds maximum export size".into());
            }
            let rel = path.strip_prefix(project_dir).map_err(|e| e.to_string())?;
            let zip_name = rel
                .to_str()
                .ok_or("Cannot export non-Unicode project filename")?
                .replace('\\', "/");
            clean_zip_path(&zip_name)?;
            writer.start_file(zip_name, options).map_err(|e| e.to_string())?;
            let mut source = File::open(path).map_err(|e| e.to_string())?;
            io::copy(&mut source, &mut writer).map_err(|e| e.to_string())?;
        }
    }
    let file = writer.finish().map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_ARCHIVE_BYTES {
        return Err("Exported ZIP exceeds 512 MiB archive limit".into());
    }
    Ok(size)
}

#[tauri::command]
pub async fn begin_project_archive_export(
    app: AppHandle,
    project_path: String,
) -> Result<ProjectArchiveExport, String> {
    let root = projects_root(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let project = PathBuf::from(project_path).canonicalize().map_err(|e| e.to_string())?;
    if !project.starts_with(&root) || project == root || !project.join("Game.rxproj").is_file() {
        return Err("Only imported app-private XP projects can be exported".into());
    }
    let id = unique_id()?.replacen("import-", "export-", 1);
    let target = exports_root(&app)?.join(format!("{id}.zip"));
    let target_copy = target.clone();
    let result = tauri::async_runtime::spawn_blocking(move || export_zip(&project, &target_copy))
        .await
        .map_err(|e| format!("Export worker failed: {e}"))?;
    match result {
        Ok(size) => Ok(ProjectArchiveExport { export_id: id, size }),
        Err(e) => {
            let _ = fs::remove_file(target);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn read_project_archive_export_chunk(
    app: AppHandle,
    export_id: String,
    offset: u64,
) -> Result<String, String> {
    safe_export_id(&export_id)?;
    let path = exports_root(&app)?.join(format!("{export_id}.zip"));
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if offset >= size || size > MAX_ARCHIVE_BYTES {
        return Err("Invalid export offset".into());
    }
    use std::io::Seek;
    file.seek(io::SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(MAX_CHUNK_BYTES);
    file.take(MAX_CHUNK_BYTES as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn discard_project_archive_export(
    app: AppHandle,
    export_id: String,
) -> Result<(), String> {
    safe_export_id(&export_id)?;
    let path = exports_root(&app)?.join(format!("{export_id}.zip"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
