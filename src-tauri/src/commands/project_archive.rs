//! Safe, app-private ZIP ingestion for Essentials / RPG Maker XP projects.
//! Upload is chunked to avoid Android content-URI and large single-IPC payload issues.
//! Original archives are never modified. Editor features use the existing XP backend.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

pub(crate) const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
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

/// Append only at the byte offset acknowledged by the preceding upload.
/// This rejects a replayed chunk after a lost response and an out-of-order
/// chunk rather than silently creating an invalid project archive.
fn append_chunk_at_offset(path: &Path, expected_offset: u64, bytes: &[u8]) -> Result<u64, String> {
    if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
        return Err("Invalid archive chunk size".into());
    }
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size != expected_offset {
        return Err(format!(
            "Archive upload offset mismatch: expected {size}, received {expected_offset}"
        ));
    }
    let next = size
        .checked_add(bytes.len() as u64)
        .ok_or("Project archive size overflow")?;
    if next > MAX_ARCHIVE_BYTES {
        return Err("Project archive exceeds 512 MiB limit".into());
    }
    file.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn append_project_archive_chunk(
    app: AppHandle,
    import_id: String,
    expected_offset: u64,
    chunk_base64: String,
) -> Result<u64, String> {
    // A cap on encoded data also limits temporary memory use before decoding.
    if chunk_base64.len() > (MAX_CHUNK_BYTES * 4 / 3 + 8) {
        return Err("Upload chunk exceeds 256 KiB limit".into());
    }
    let bytes = STANDARD
        .decode(chunk_base64.as_bytes())
        .map_err(|_| "Invalid Base64 archive chunk".to_string())?;
    let path = staging_path(&import_root(&app)?, &import_id)?;
    append_chunk_at_offset(&path, expected_offset, &bytes)
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
    if name.is_empty() || name.contains('\\') || name.contains('\0') || name.contains(':')
        || name.trim_end_matches('/').split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || name.ends_with("//")
    {
        return Err("Archive contains an invalid filename".into());
    }
    let path = Path::new(name);
    if path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("Archive contains path traversal or an absolute path".into());
    }
    Ok(path.to_path_buf())
}

/// zip 2.x indexes files by name and can hide duplicate central-directory
/// entries from ZipArchive::len()/file_names(). Compare its parsed count with
/// the archive's end-of-central-directory count before extraction. ZIP64 counts
/// are not needed because our own limit is 30,000 entries.
fn declared_zip_entry_count(path: &Path) -> Result<usize, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    const MAX_EOCD_SEARCH: u64 = 22 + 65_535;
    let tail_len = size.min(MAX_EOCD_SEARCH) as usize;
    if tail_len < 22 {
        return Err("ZIP archive is too short".into());
    }
    file.seek(SeekFrom::End(-(tail_len as i64))).map_err(|e| e.to_string())?;
    let mut tail = vec![0u8; tail_len];
    file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    for i in (0..=tail_len - 22).rev() {
        if tail[i..i + 4] != [0x50, 0x4b, 0x05, 0x06] {
            continue;
        }
        let read_u16 = |offset: usize| u16::from_le_bytes([tail[i + offset], tail[i + offset + 1]]);
        let comment_len = read_u16(20) as usize;
        if i + 22 + comment_len != tail_len {
            continue;
        }
        if read_u16(4) != 0 || read_u16(6) != 0 || read_u16(8) != read_u16(10) {
            return Err("Multi-disk ZIP archives are not supported".into());
        }
        let entries = read_u16(10);
        if entries == u16::MAX {
            return Err("ZIP64 entry counts are not supported".into());
        }
        return Ok(entries as usize);
    }
    Err("ZIP end-of-central-directory record is missing or invalid".into())
}

/// Preflight the entire archive before creating any files. Android's filesystem
/// is case-sensitive, while most desktop XP projects are reopened on Windows:
/// names that differ only by case, DOS device names, or invalid Windows path
/// components would otherwise be silently merged or become inaccessible.
/// Track implicit parent directories too, to catch file/directory collisions.
fn validate_zip_manifest(zip: &mut ZipArchive<File>) -> Result<(), String> {
    use std::collections::HashMap;
    // lowercase path -> (original spelling, is_directory, explicitly listed)
    let mut paths: HashMap<String, (String, bool, bool)> = HashMap::new();
    let mut total_size = 0u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        clean_zip_path(entry.name())?;
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err("Archive contains a symbolic link or special file".into());
            }
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err("Archive entry exceeds size limit".into());
        }
        total_size = total_size.checked_add(entry.size()).ok_or("Archive size overflow")?;
        if total_size > MAX_UNPACKED_BYTES {
            return Err("Archive expands beyond 2 GiB limit".into());
        }
        let name = entry.name().trim_end_matches('/');
        let components: Vec<&str> = name.split('/').collect();
        for (i, part) in components.iter().enumerate() {
            if part.ends_with('.') || part.ends_with(' ')
                || part.chars().any(|c| c.is_control() || "<>\"|?*".contains(c))
            {
                return Err(format!("ZIP contains a non-portable filename: {name}"));
            }
            let device = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (device.len() == 4
                    && (device.starts_with("COM") || device.starts_with("LPT"))
                    && matches!(device.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(format!("ZIP contains a reserved Windows filename: {name}"));
            }
            let spelling = components[..=i].join("/");
            let key = spelling.to_lowercase();
            let final_component = i + 1 == components.len();
            let is_dir = !final_component || entry.is_dir();
            match paths.get_mut(&key) {
                Some((existing, was_dir, explicit)) => {
                    if existing != &spelling || *was_dir != is_dir {
                        return Err(format!("ZIP contains colliding project paths: {name}"));
                    }
                    if final_component {
                        if *explicit {
                            return Err(format!("ZIP contains duplicate project paths: {name}"));
                        }
                        *explicit = true;
                    }
                }
                None => {
                    paths.insert(key, (spelling, is_dir, final_component));
                }
            }
        }
    }
    Ok(())
}

fn extract_archive(archive_path: &Path, extracted: &Path) -> Result<PathBuf, String> {
    let src = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(src).map_err(|e| format!("Not a valid ZIP: {e}"))?;
    // A duplicate filename may disappear from the ZIP reader's name index.
    // Refuse the archive rather than silently losing one of its entries.
    if zip.len() != declared_zip_entry_count(archive_path)? {
        return Err("ZIP contains duplicate or hidden central-directory entries".into());
    }
    if zip.len() > MAX_ENTRIES {
        return Err("Too many archive entries".into());
    }
    // Refuse non-portable archives before allocating app-private extraction space.
    validate_zip_manifest(&mut zip)?;
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

    discover_project_root(extracted)
}

/// ZIPs created by GitHub or project backup tools may wrap the actual RMXP
/// project in more than one directory (e.g. repository/project/Game.rxproj).
/// Follow only a bounded chain of *single* directories. Never silently discard
/// sibling files or an additional project when the staging tree is removed.
fn discover_project_root(extracted: &Path) -> Result<PathBuf, String> {
    const MAX_WRAPPER_DIRS: usize = 4;
    let mut candidate = extracted.to_path_buf();
    for depth in 0..=MAX_WRAPPER_DIRS {
        if candidate.join("Game.rxproj").is_file() {
            return Ok(candidate);
        }
        if depth == MAX_WRAPPER_DIRS {
            return Err("ZIP project root exceeds four wrapper directories; repackage with Game.rxproj closer to the ZIP root".into());
        }
        let mut entries = fs::read_dir(&candidate).map_err(|e| e.to_string())?;
        let only = entries
            .next()
            .transpose()
            .map_err(|e| e.to_string())?
            .ok_or("ZIP does not contain Game.rxproj in a project directory")?;
        if entries.next().transpose().map_err(|e| e.to_string())?.is_some() {
            return Err(
                "ZIP has files outside its single project folder or multiple RPG Maker projects; repackage the project without unrelated wrapper files".into()
            );
        }
        if !only.file_type().map_err(|e| e.to_string())?.is_dir() {
            return Err("ZIP does not contain Game.rxproj in a project directory".into());
        }
        candidate = only.path();
    }
    unreachable!("bounded wrapper search returns within the loop")
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

/// Remove only an abandoned, directly imported app-private project.
/// Never accept arbitrary project paths or follow a symlink outside the root.
fn discard_imported_project_in(root: &Path, requested: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    // Canonicalizing the requested directory before checking its file type
    // would turn a sibling symlink into the *target* path, potentially
    // deleting a different, active import inside this same projects root.
    let entry = fs::symlink_metadata(requested).map_err(|e| e.to_string())?;
    if entry.file_type().is_symlink() || !entry.is_dir() {
        return Err("Imported project cleanup refuses links and non-directories".into());
    }
    let project = requested.canonicalize().map_err(|e| e.to_string())?;
    if project.parent() != Some(root.as_path()) {
        return Err("Only direct imported app-private projects may be discarded".into());
    }
    let name = project.file_name().and_then(|n| n.to_str())
        .ok_or("Invalid imported project name")?;
    safe_id(name)?;
    if !project.join("Game.rxproj").is_file() {
        return Err("Not an imported RPG Maker XP project".into());
    }
    fs::remove_dir_all(project).map_err(|e| format!("Could not discard failed import: {e}"))
}

/// Called only when frontend preflight rejects a newly imported project.
/// Existing open projects and the user's original ZIP are not touched.
#[tauri::command]
pub async fn discard_failed_project_import(
    app: AppHandle,
    project_path: String,
) -> Result<(), String> {
    discard_imported_project_in(&projects_root(&app)?, Path::new(&project_path))
}

#[cfg(test)]
mod tests {
    use super::{clean_zip_path, BoundedArchiveWriter};
    use std::io::{Cursor, Seek, SeekFrom, Write};

    #[test]
    fn import_rejects_replayed_and_out_of_order_chunks_without_changing_staging() {
        use super::append_chunk_at_offset;
        use std::fs::{self, File};
        let path = std::env::temp_dir().join(format!(
            "essentials-upload-offset-{}-{:?}.zip",
            std::process::id(),
            std::thread::current().id()
        ));
        File::create(&path).unwrap();
        assert_eq!(append_chunk_at_offset(&path, 0, b"first").unwrap(), 5);
        assert!(append_chunk_at_offset(&path, 0, b"replayed").unwrap_err().contains("offset mismatch"));
        assert!(append_chunk_at_offset(&path, 8, b"skipped").unwrap_err().contains("offset mismatch"));
        assert_eq!(fs::read(&path).unwrap(), b"first");
        assert_eq!(append_chunk_at_offset(&path, 5, b"second").unwrap(), 11);
        assert_eq!(fs::read(&path).unwrap(), b"firstsecond");
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn import_rejects_empty_chunks_and_oversized_offsets_without_mutation() {
        use super::append_chunk_at_offset;
        use std::fs::{self, File};
        let path = std::env::temp_dir().join(format!(
            "essentials-upload-bounds-{}-{:?}.zip",
            std::process::id(),
            std::thread::current().id()
        ));
        File::create(&path).unwrap();
        assert!(append_chunk_at_offset(&path, 0, b"").is_err());
        assert!(append_chunk_at_offset(&path, u64::MAX, b"x").is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), 0);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn bounded_export_rejects_crossing_limit_without_writing_partial_bytes() {
        let mut output = BoundedArchiveWriter::new(Cursor::new(Vec::<u8>::new()), 8);
        output.write_all(&[1, 2, 3, 4]).unwrap();
        output.seek(SeekFrom::Start(7)).unwrap();
        assert!(output.write_all(&[5, 6]).is_err());
        assert_eq!(output.into_inner().into_inner(), vec![1, 2, 3, 4]);
    }

    #[test]
    fn bounded_export_allows_exact_limit_and_safe_header_rewrites() {
        let mut output = BoundedArchiveWriter::new(Cursor::new(Vec::<u8>::new()), 8);
        output.write_all(&[1, 2, 3, 4]).unwrap();
        output.seek(SeekFrom::Start(4)).unwrap();
        output.write_all(&[5, 6, 7, 8]).unwrap();
        output.seek(SeekFrom::Start(0)).unwrap();
        output.write_all(&[9, 10]).unwrap();
        assert_eq!(output.into_inner().into_inner(), vec![9, 10, 3, 4, 5, 6, 7, 8]);
    }

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

pub(crate) fn safe_export_id(id: &str) -> Result<(), String> {
    if id.starts_with("export-")
        && id.len() <= 90
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        Ok(())
    } else {
        Err("Invalid export ID".into())
    }
}

pub(crate) fn exports_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("exports");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Bound compressed ZIP bytes as they are written, not only after finish().
/// A poorly compressible project must not consume unbounded app-private disk
/// space before the post-export size check can run.
struct BoundedArchiveWriter<W> {
    inner: W,
    max_len: u64,
}

impl<W> BoundedArchiveWriter<W> {
    fn new(inner: W, max_len: u64) -> Self {
        Self { inner, max_len }
    }

    fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write + Seek> Write for BoundedArchiveWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let offset = self.inner.stream_position()?;
        if offset
            .checked_add(buf.len() as u64)
            .is_none_or(|end| end > self.max_len)
        {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Exported ZIP exceeds 512 MiB archive limit",
            ));
        }
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Seek> Seek for BoundedArchiveWriter<W> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.inner.seek(pos)
    }
}

fn export_zip(project_dir: &Path, target: &Path) -> Result<u64, String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(BoundedArchiveWriter::new(file, MAX_ARCHIVE_BYTES));
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
            // ZIP entries include directories as well as files. Count both
            // to enforce the same entry cap on export that import enforces.
            count += 1;
            if count > MAX_ENTRIES {
                return Err("Export contains too many archive entries".into());
            }
            if meta.is_dir() {
                // Empty directories are part of a project too. Record each
                // directory explicitly rather than dropping it during export.
                let rel = path.strip_prefix(project_dir).map_err(|e| e.to_string())?;
                let zip_name = rel
                    .to_str()
                    .ok_or("Cannot export non-Unicode project directory")?
                    .replace('\\', "/");
                clean_zip_path(&zip_name)?;
                writer
                    .add_directory(format!("{zip_name}/"), options)
                    .map_err(|e| e.to_string())?;
                directories.push(path);
                continue;
            }
            if !meta.is_file() {
                return Err("Cannot export a project containing special files".into());
            }
            if meta.len() > MAX_FILE_BYTES {
                return Err("Export contains an oversized file".into());
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
    let file = writer.finish().map_err(|e| e.to_string())?.into_inner();
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



const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

/// Resolve an image strictly within a previously imported, app-private project.
/// Never expose arbitrary filesystem paths to the Android WebView.
fn private_project_image_path(
    root: &Path,
    requested_project: &Path,
    asset_type: &str,
    asset_name: &str,
) -> Result<(PathBuf, &'static str), String> {
    crate::commands::util::validate_asset_name(asset_name)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let project = requested_project.canonicalize().map_err(|e| e.to_string())?;
    if project == root || !project.starts_with(&root) || !project.join("Game.rxproj").is_file() {
        return Err("Images can only be read from imported app-private projects".into());
    }
    let (base, directory, extensions) = crate::commands::util::asset_dirs(asset_type)
        .ok_or("Unknown asset type")?;
    if base != "Graphics" {
        return Err("Only project graphics can be read as images".into());
    }
    let stem = project.join(base).join(directory).join(asset_name);
    for ext in extensions {
        let candidate = stem.with_extension(ext);
        if !candidate.is_file() {
            continue;
        }
        let resolved = candidate.canonicalize().map_err(|e| e.to_string())?;
        if !resolved.starts_with(&project) {
            return Err("Image resolves outside the private project".into());
        }
        let mime = match *ext {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            _ => return Err("Unsupported image format".into()),
        };
        let size = fs::metadata(&resolved).map_err(|e| e.to_string())?.len();
        if size > MAX_IMAGE_BYTES {
            return Err("Project image exceeds the 32 MiB per-image limit".into());
        }
        return Ok((resolved, mime));
    }
    Err(format!("Project image not found: {asset_type}/{asset_name}"))
}

/// Android's WebView cannot be assumed to resolve desktop asset:// URLs.
/// A scoped data URL avoids broad filesystem permissions and never returns
/// arbitrary file bytes. Desktop continues using its existing asset protocol.
#[tauri::command]
pub async fn read_private_project_image(
    app: AppHandle,
    project_path: String,
    asset_type: String,
    asset_name: String,
) -> Result<String, String> {
    let (path, mime) = private_project_image_path(
        &projects_root(&app)?,
        Path::new(&project_path),
        &asset_type,
        &asset_name,
    )?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod archive_roundtrip_tests {
    use super::{extract_archive, export_zip, finish_import, unique_id};
    use crate::marshal::types::{RubyObject, RubyString, RubyValue};
    use crate::models::{
        EventCommand, EventCondition, EventGraphic, EventPage, MapInfo, MoveRoute, RpgEvent,
        RpgMap,
    };
    use sha2::{Digest, Sha256};
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "essentials-archive-roundtrip-{}",
                unique_id().expect("unique test id")
            ));
            fs::create_dir(&path).expect("create isolated fixture");
            Self(path)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_zip(path: &Path, prefix: &str, extra: Option<&str>) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, bytes) in [
            ("Game.rxproj", b"RPGXP 1.02".as_slice()),
            ("Data/Map001.rxdata", &[0, 255, 128, 3, 4, 0][..]),
            ("Data/Scripts.rxdata", &[4, 8, 1, 255, 0, 23][..]),
            ("PBS/pokemon.txt", b"# keep comment\r\n[TEST]\r\nName = Test\r\n"),
            ("Graphics/Tilesets/Example.png", &[137, 80, 78, 71, 0, 1, 2][..]),
        ] {
            zip.start_file(format!("{prefix}{name}"), options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.add_directory(format!("{prefix}Graphics/Empty/"), options).unwrap();
        if let Some(name) = extra {
            zip.start_file(name, options).unwrap();
            zip.write_all(b"unrelated").unwrap();
        }
        zip.finish().unwrap();
    }

    fn read_zip_file(zip_path: &Path, name: &str) -> Vec<u8> {
        let mut zip = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        let mut contents = Vec::new();
        zip.by_name(name).unwrap().read_to_end(&mut contents).unwrap();
        contents
    }

    fn ruby_string(text: &str) -> RubyValue {
        RubyValue::String(RubyString::with_encoding(text.as_bytes().to_vec(), "UTF-8".into()))
    }

    /// Fully synthetic PNG artwork for the native ZIP fixture. The previous
    /// fixture wrote ASCII placeholder bytes under a .png name, so successful
    /// project opening could not establish whether Android could actually
    /// decode and render a tileset or event character.
    fn synthetic_png(width: u32, height: u32, character: bool) -> Vec<u8> {
        let pixels = image::RgbaImage::from_fn(width, height, |x, y| {
            let x_band = (x / 32) as u8;
            let y_band = (y / 32) as u8;
            if character && (x % 32 < 4 || y % 32 < 4) {
                image::Rgba([0, 0, 0, 0])
            } else {
                image::Rgba([
                    x_band.wrapping_mul(29).wrapping_add(36),
                    y_band.wrapping_mul(27).wrapping_add(51),
                    if character { 186 } else { 88 },
                    255,
                ])
            }
        });
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(pixels)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("encode original synthetic PNG pixels");
        encoded.into_inner()
    }

    #[test]
    fn synthetic_fixture_graphics_decode_and_match_xp_layout() {
        let members = synthetic_rxdata_members();
        for (path, width, height) in [
            ("Graphics/Tilesets/Synthetic.png", 256, 256),
            ("Graphics/Characters/SyntheticGuide.png", 128, 128),
        ] {
            let bytes = &members.iter().find(|(name, _)| name == path)
                .expect("synthetic artwork fixture member").1;
            assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
            let decoded = image::load_from_memory(bytes)
                .expect("synthetic graphics must be valid PNG pixels");
            assert_eq!(decoded.width(), width, "{path} width");
            assert_eq!(decoded.height(), height, "{path} height");
        }
    }

    fn synthetic_rxdata_members() -> Vec<(String, Vec<u8>)> {
        let mut map = RpgMap::new_blank(2, 2, 1);
        map.data.set(1, 0, 1, 48);
        map.data.set(0, 1, 2, 1024);
        map.events.insert(
            7,
            RpgEvent {
                id: 7,
                name: "Synthetic Guide".into(),
                x: 1,
                y: 1,
                pages: vec![EventPage {
                    condition: EventCondition::default(),
                    graphic: EventGraphic {
                        character_name: "SyntheticGuide".into(),
                        ..EventGraphic::default()
                    },
                    move_type: 0,
                    move_speed: 3,
                    move_frequency: 3,
                    move_route: MoveRoute::default(),
                    walk_anime: true,
                    step_anime: false,
                    direction_fix: false,
                    through: false,
                    always_on_top: false,
                    trigger: 0,
                    list: vec![EventCommand {
                        code: 101,
                        indent: 0,
                        parameters: vec![serde_json::Value::String("Synthetic dialogue".into())],
                    }],
                }],
            },
        );
        let mut map_value = map.to_ruby_value();
        let RubyValue::Object(map_object) = &mut map_value else {
            panic!("RPG::Map fixture must serialize as an object")
        };
        map_object
            .instance_vars
            .push(("@plugin_metadata".into(), RubyValue::Symbol("keep-map".into())));
        let events = map_object
            .instance_vars
            .iter_mut()
            .find(|(name, _)| name == "@events")
            .map(|(_, value)| value)
            .expect("map event hash");
        let RubyValue::Hash(events) = events else {
            panic!("RPG::Map @events must serialize as a hash")
        };
        let RubyValue::Object(event) = &mut events[0].1 else {
            panic!("RPG::Event fixture must serialize as an object")
        };
        event
            .instance_vars
            .push(("@plugin_metadata".into(), RubyValue::Symbol("keep-event".into())));

        let map_infos = RubyValue::Hash(vec![(
            RubyValue::Integer(1),
            MapInfo {
                name: "Synthetic Map".into(),
                parent_id: 0,
                order: 1,
                expanded: true,
                scroll_x: 0,
                scroll_y: 0,
            }
            .to_ruby_value(),
        )]);
        let mut system = RubyObject::new("RPG::System".into());
        system
            .instance_vars
            .push(("@edit_map_id".into(), RubyValue::Integer(1)));

        let mut tileset = RubyObject::new("RPG::Tileset".into());
        tileset.instance_vars.extend([
            ("@id".into(), RubyValue::Integer(1)),
            ("@name".into(), ruby_string("Synthetic Tileset")),
            ("@tileset_name".into(), ruby_string("Synthetic")),
            (
                "@autotile_names".into(),
                RubyValue::Array(vec![ruby_string(""); 7]),
            ),
        ]);
        let tilesets = RubyValue::Array(vec![
            RubyValue::Nil,
            RubyValue::Object(tileset),
        ]);

        [
            (
                "Data/MapInfos.rxdata".into(),
                crate::marshal::dump(&map_infos).unwrap(),
            ),
            (
                "Data/System.rxdata".into(),
                crate::marshal::dump(&RubyValue::Object(system)).unwrap(),
            ),
            (
                "Data/Tilesets.rxdata".into(),
                crate::marshal::dump(&tilesets).unwrap(),
            ),
            (
                "Data/Map001.rxdata".into(),
                crate::marshal::dump(&map_value).unwrap(),
            ),
            (
                "Data/Scripts.rxdata".into(),
                crate::marshal::dump(&RubyValue::Array(vec![RubyValue::Nil])).unwrap(),
            ),
        ]
        .into_iter()
        .chain([
            ("Game.rxproj".into(), b"RPGXP 1.02".to_vec()),
            (
                "Game.ini".into(),
                b"[Game]\r\nTitle=Synthetic RMXP\r\n".to_vec(),
            ),
            (
                "PBS/pokemon.txt".into(),
                b"# synthetic PBS\r\n[TEST]\r\nName = Test\r\n".to_vec(),
            ),
            (
                "Graphics/Tilesets/Synthetic.png".into(),
                synthetic_png(256, 256, false),
            ),
            (
                "Graphics/Characters/SyntheticGuide.png".into(),
                synthetic_png(128, 128, true),
            ),
        ])
        .collect()
    }

    fn write_synthetic_project_zip(path: &Path, prefix: &str, malformed_map: bool) {
        let mut writer = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default();
        for (name, mut bytes) in synthetic_rxdata_members() {
            if malformed_map && name == "Data/Map001.rxdata" {
                bytes = b"not a Ruby Marshal stream".to_vec();
            }
            writer
                .start_file(format!("{prefix}{name}"), options)
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer
            .add_directory(format!("{prefix}Graphics/Empty/"), options)
            .unwrap();
        writer.finish().unwrap();
    }

    fn member_sha256(zip_path: &Path, prefix: &str) -> std::collections::BTreeMap<String, String> {
        let mut zip = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        let mut hashes = std::collections::BTreeMap::new();
        for index in 0..zip.len() {
            let mut member = zip.by_index(index).unwrap();
            if member.is_dir() {
                continue;
            }
            let name = member
                .name()
                .strip_prefix(prefix)
                .expect("ZIP member is under expected project root")
                .to_string();
            let mut bytes = Vec::new();
            member.read_to_end(&mut bytes).unwrap();
            hashes.insert(name, format!("{:x}", Sha256::digest(&bytes)));
        }
        hashes
    }

    #[test]
    fn nested_project_import_export_reimport_preserves_bytes_and_empty_directories() {
        let sandbox = Sandbox::new();
        let imports = sandbox.path("imports");
        let projects = sandbox.path("projects");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&projects).unwrap();
        let original = imports.join("import-test.zip");
        sample_zip(&original, "ExampleProject/", None);
        let original_zip_bytes = fs::read(&original).unwrap();
        let retained_original = sandbox.path("original-copy.zip");
        fs::copy(&original, &retained_original).unwrap();

        let imported = finish_import(
            original.clone(), imports.clone(), projects.clone(), "import-test".into()
        ).expect("import project");
        let imported = PathBuf::from(imported);
        assert!(imported.join("Game.rxproj").is_file());
        assert!(imported.join("Graphics/Empty").is_dir());
        assert_eq!(fs::read(imported.join("Data/Map001.rxdata")).unwrap(),
            [0, 255, 128, 3, 4, 0]);
        assert_eq!(fs::read(imported.join("PBS/pokemon.txt")).unwrap(),
            b"# keep comment\r\n[TEST]\r\nName = Test\r\n");

        let exported = sandbox.path("exported.zip");
        assert!(export_zip(&imported, &exported).unwrap() > 0);
        for name in [
            "Game.rxproj", "Data/Map001.rxdata", "Data/Scripts.rxdata",
            "PBS/pokemon.txt", "Graphics/Tilesets/Example.png",
        ] {
            let actual = read_zip_file(&exported, name);
            let expected = fs::read(imported.join(name)).unwrap();
            assert_eq!(actual, expected, "byte mismatch in {name}");
        }
        let zip = ZipArchive::new(File::open(&exported).unwrap()).unwrap();
        assert!(zip.file_names().any(|name| name == "Graphics/Empty/"));

        let reimported_root = sandbox.path("reimported");
        let reimported = extract_archive(&exported, &reimported_root).unwrap();
        assert_eq!(fs::read(reimported.join("Data/Scripts.rxdata")).unwrap(),
            fs::read(imported.join("Data/Scripts.rxdata")).unwrap());
        assert!(reimported.join("Graphics/Empty").is_dir());

        // The caller's original input archive is never modified; finish_import
        // deliberately removes only its app-private staging copy.
        assert_eq!(fs::read(retained_original).unwrap(), original_zip_bytes);
    }

    #[test]
    fn discovers_bounded_multilevel_project_root_without_losing_source_bytes() {
        let sandbox = Sandbox::new();
        let archive = sandbox.path("multi-wrapper.zip");
        sample_zip(&archive, "Repository/Essentials/Shattered/", None);
        let original_zip = fs::read(&archive).unwrap();
        let imported = extract_archive(&archive, &sandbox.path("extracted")).unwrap();
        assert_eq!(imported, sandbox.path("extracted/Repository/Essentials/Shattered"));
        assert_eq!(fs::read(imported.join("PBS/pokemon.txt")).unwrap(),
            b"# keep comment\r\n[TEST]\r\nName = Test\r\n");
        assert_eq!(fs::read(&archive).unwrap(), original_zip);

        let exported = sandbox.path("repacked.zip");
        export_zip(&imported, &exported).unwrap();
        assert_eq!(read_zip_file(&exported, "Data/Scripts.rxdata"),
            read_zip_file(&archive, "Repository/Essentials/Shattered/Data/Scripts.rxdata"));
        assert_eq!(read_zip_file(&exported, "PBS/pokemon.txt"),
            read_zip_file(&archive, "Repository/Essentials/Shattered/PBS/pokemon.txt"));

        // Exercise the actual app-private publication path, not only the ZIP
        // extractor: the returned path must be a direct child of projects/.
        let imports = sandbox.path("imports");
        let projects = sandbox.path("projects");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&projects).unwrap();
        fs::copy(&archive, imports.join("import-multi.zip")).unwrap();
        let published = PathBuf::from(finish_import(
            imports.join("import-multi.zip"), imports.clone(), projects.clone(),
            "import-multi".into(),
        ).unwrap());
        assert_eq!(published, projects.join("import-multi"));
        assert!(published.join("Game.rxproj").is_file());
        assert_eq!(fs::read(published.join("Data/Scripts.rxdata")).unwrap(),
            read_zip_file(&archive, "Repository/Essentials/Shattered/Data/Scripts.rxdata"));
        assert!(!imports.join("import-multi-extracted").exists());
        assert_eq!(fs::read(&archive).unwrap(), original_zip);
    }

    #[test]
    fn wrapped_rxdata_project_opens_edits_and_reads_back_without_losing_source_members() {
        let sandbox = Sandbox::new();
        let source_archive = sandbox.path("original-rxdata.zip");
        let wrapper = "Repository/Essentials/Project/";
        write_synthetic_project_zip(&source_archive, wrapper, false);
        let original_zip_bytes = fs::read(&source_archive).unwrap();
        let original_hashes = member_sha256(&source_archive, wrapper);

        let imports = sandbox.path("imports");
        let projects = sandbox.path("projects");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&projects).unwrap();
        let staged_archive = imports.join("import-rxdata.zip");
        fs::copy(&source_archive, &staged_archive).unwrap();
        let imported = PathBuf::from(
            finish_import(
                staged_archive,
                imports.clone(),
                projects.clone(),
                "import-rxdata".into(),
            )
            .expect("publish valid wrapped project into app-private storage"),
        );
        assert_eq!(imported, projects.join("import-rxdata"));
        assert!(imported.join("Game.rxproj").is_file());
        assert!(imported.join("Graphics/Empty").is_dir());

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let project = crate::commands::project::open_project(
                imported.to_string_lossy().into_owned(),
            )
            .await
            .expect("open imported RXDATA project");
            assert_eq!(project.name, "Synthetic RMXP");
            assert_eq!(project.edit_map_id, 1);
            assert_eq!(project.map_infos.get(&1).unwrap().name, "Synthetic Map");

            let map = crate::commands::project::load_map(project.path.clone(), 1)
                .await
                .expect("load genuine Marshal map");
            assert_eq!((map.width, map.height, map.tileset_id), (2, 2, 1));
            assert_eq!(map.events.len(), 1);
            let tileset = crate::commands::project::load_tileset(project.path.clone(), 1)
                .await
                .expect("load genuine Marshal tileset");
            assert_eq!(tileset.name, "Synthetic Tileset");

            let event =
                crate::commands::project::load_event(project.path.clone(), 1, 7)
                    .await
                    .expect("load genuine Marshal event");
            assert_eq!(event.name, "Synthetic Guide");
            assert_eq!(event.pages[0].list[0].code, 101);
            assert_eq!(
                event.pages[0].list[0].parameters[0],
                serde_json::Value::String("Synthetic dialogue".into())
            );

            // Exercise the actual event-save path, not just read-only parsing.
            let mut edited_event = event;
            edited_event.pages[0].list[0].parameters[0] =
                serde_json::Value::String("Edited dialogue".into());
            crate::commands::project::save_event(
                project.path.clone(), 1, edited_event,
            ).await.expect("save controlled event dialogue edit");
            let saved_event = crate::commands::project::load_event(
                project.path.clone(), 1, 7,
            ).await.expect("reopen edited event");
            assert_eq!(
                saved_event.pages[0].list[0].parameters[0],
                serde_json::Value::String("Edited dialogue".into())
            );

            // Edit one structured PBS field through the production command.
            let mut pbs = crate::commands::pbs::load_pbs_file(
                project.path.clone(), "pokemon.txt".into(),
            ).await.expect("load synthetic PBS");
            pbs[0].fields.iter_mut().find(|field| field.key == "Name")
                .expect("Name field").value = "Edited".into();
            crate::commands::pbs::save_pbs_file(
                project.path.clone(), "pokemon.txt".into(), pbs,
            ).await.expect("save controlled PBS field edit");
            let pbs_readback = crate::commands::pbs::load_pbs_file(
                project.path.clone(), "pokemon.txt".into(),
            ).await.expect("reopen edited PBS");
            assert_eq!(
                pbs_readback[0].fields.iter().find(|field| field.key == "Name")
                    .expect("Name field").value,
                "Edited"
            );

            let mut edited_tiles = map.tiles.clone();
            edited_tiles[4] = 777;
            crate::commands::project::save_map(
                project.path.clone(),
                1,
                edited_tiles.clone(),
                2,
                2,
            )
            .await
            .expect("save one bounded XP tile edit");
            let readback = crate::commands::project::load_map(project.path.clone(), 1)
                .await
                .expect("read edited map back");
            assert_eq!(readback.tiles, edited_tiles);
            let event_readback =
                crate::commands::project::load_event(project.path.clone(), 1, 7)
                    .await
                    .expect("read untouched event back");
            assert_eq!(event_readback.name, "Synthetic Guide");
            assert_eq!(event_readback.pages[0].list[0].code, 101);
            assert_eq!(
                event_readback.pages[0].list[0].parameters[0],
                serde_json::Value::String("Edited dialogue".into())
            );
        });

        let saved_map = crate::marshal::load_file(&imported.join("Data/Map001.rxdata")).unwrap();
        let RubyValue::Object(saved_map) = saved_map else {
            panic!("saved map remains an RPG::Map object")
        };
        assert_eq!(
            saved_map.get("plugin_metadata"),
            Some(&RubyValue::Symbol("keep-map".into()))
        );
        let saved_events = saved_map.get("events").and_then(RubyValue::as_hash).unwrap();
        let RubyValue::Object(saved_event) = &saved_events[0].1 else {
            panic!("saved event remains an RPG::Event object")
        };
        assert_eq!(
            saved_event.get("plugin_metadata"),
            Some(&RubyValue::Symbol("keep-event".into()))
        );

        assert_eq!(
            fs::read(imported.join("PBS/pokemon.txt")).unwrap(),
            b"# synthetic PBS\r\n[TEST]\r\nName = Edited\r\n"
        );
        let exported = sandbox.path("exported-rxdata.zip");
        export_zip(&imported, &exported).unwrap();
        let exported_hashes = member_sha256(&exported, "");
        assert_eq!(original_hashes.keys().collect::<Vec<_>>(), exported_hashes.keys().collect::<Vec<_>>());
        for (name, original_hash) in &original_hashes {
            if name == "Data/Map001.rxdata" || name == "PBS/pokemon.txt" {
                assert_ne!(exported_hashes.get(name), Some(original_hash));
            } else {
                assert_eq!(exported_hashes.get(name), Some(original_hash), "SHA-256 mismatch in {name}");
            }
        }
        // An archive with the expected hashes is not necessarily a project the
        // editor can reopen. Re-extract the exported ZIP and exercise the real
        // project/map/event/PBS readers against that fresh project root.
        let reopened_root = extract_archive(&exported, &sandbox.path("reopened-export"))
            .expect("reimport exported synthetic project ZIP");
        assert!(reopened_root.join("Graphics/Empty").is_dir());
        assert_eq!(
            fs::read(reopened_root.join("Data/Scripts.rxdata")).unwrap(),
            fs::read(imported.join("Data/Scripts.rxdata")).unwrap(),
            "reimport must preserve untouched scripts"
        );
        runtime.block_on(async {
            let reopened_project = crate::commands::project::open_project(
                reopened_root.to_string_lossy().into_owned(),
            )
            .await
            .expect("open project reimported from exported ZIP");
            let reopened_map = crate::commands::project::load_map(
                reopened_project.path.clone(), 1,
            )
            .await
            .expect("load edited map from reimported ZIP");
            assert_eq!(reopened_map.tiles[4], 777);
            let reopened_event = crate::commands::project::load_event(
                reopened_project.path.clone(), 1, 7,
            )
            .await
            .expect("load edited event from reimported ZIP");
            assert_eq!(
                reopened_event.pages[0].list[0].parameters[0],
                serde_json::Value::String("Edited dialogue".into())
            );
            let reopened_pbs = crate::commands::pbs::load_pbs_file(
                reopened_project.path.clone(), "pokemon.txt".into(),
            )
            .await
            .expect("load edited PBS from reimported ZIP");
            assert_eq!(
                reopened_pbs[0].fields.iter().find(|field| field.key == "Name")
                    .expect("Name field").value,
                "Edited"
            );
        });
        let reopened_map = crate::marshal::load_file(
            &reopened_root.join("Data/Map001.rxdata"),
        ).expect("reimported map retains Ruby Marshal");
        let RubyValue::Object(reopened_map) = reopened_map else {
            panic!("reimported map remains RPG::Map")
        };
        assert_eq!(
            reopened_map.get("plugin_metadata"),
            Some(&RubyValue::Symbol("keep-map".into())),
            "reimported map must retain opaque metadata"
        );

        if let Some(directory) = std::env::var_os("PROJECT_ROUNDTRIP_ARTIFACT_DIR") {
            let directory = PathBuf::from(directory);
            fs::create_dir_all(&directory).unwrap();
            fs::copy(&source_archive, directory.join("original.zip")).unwrap();
            fs::copy(&exported, directory.join("exported.zip")).unwrap();
        }
        assert_eq!(fs::read(&source_archive).unwrap(), original_zip_bytes);
        assert!(!imports.join("import-rxdata-extracted").exists());
    }

    #[test]
    fn malformed_rxdata_is_rejected_and_failed_private_import_is_removed() {
        let sandbox = Sandbox::new();
        let imports = sandbox.path("imports");
        let projects = sandbox.path("projects");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&projects).unwrap();
        let archive = sandbox.path("malformed-rxdata.zip");
        write_synthetic_project_zip(&archive, "Repository/Essentials/Project/", true);
        let staged_archive = imports.join("import-malformed.zip");
        fs::copy(&archive, &staged_archive).unwrap();
        let imported = PathBuf::from(
            finish_import(
                staged_archive,
                imports.clone(),
                projects.clone(),
                "import-malformed".into(),
            )
            .expect("ZIP extraction completes before editor preflight"),
        );

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let project = runtime
            .block_on(crate::commands::project::open_project(
                imported.to_string_lossy().into_owned(),
            ))
            .expect("project metadata is readable before invalid initial map rejection");
        let error = runtime
            .block_on(crate::commands::project::load_map(project.path, project.edit_map_id))
            .unwrap_err();
        assert!(error.contains("Failed to parse map"), "{error}");
        super::discard_imported_project_in(&projects, &imported).unwrap();
        assert!(!projects.join("import-malformed").exists());
        assert!(!imports.join("import-malformed-extracted").exists());
    }

    #[test]
    fn rejects_siblings_at_every_wrapper_level_without_publishing_partial_project() {
        for sibling in ["Repository/README.md", "Repository/Essentials/notes.txt"] {
            let sandbox = Sandbox::new();
            let imports = sandbox.path("imports");
            let projects = sandbox.path("projects");
            fs::create_dir_all(&imports).unwrap();
            fs::create_dir_all(&projects).unwrap();
            let archive = imports.join("import-test.zip");
            sample_zip(&archive, "Repository/Essentials/Shattered/", Some(sibling));
            let original = sandbox.path("original-with-sibling.zip");
            fs::copy(&archive, &original).unwrap();
            let original_bytes = fs::read(&original).unwrap();
            let error = finish_import(archive, imports.clone(), projects.clone(), "import-test".into())
                .unwrap_err();
            assert!(error.contains("outside its single project folder"), "{error}");
            assert!(!projects.join("import-test").exists());
            assert!(!imports.join("import-test-extracted").exists());
            assert_eq!(fs::read(&original).unwrap(), original_bytes);
            assert_eq!(read_zip_file(&original, sibling), b"unrelated");
        }
    }

    #[test]
    fn rejects_excessive_wrapper_depth_and_multiple_project_roots() {
        let sandbox = Sandbox::new();
        let deep = sandbox.path("too-deep.zip");
        sample_zip(&deep, "One/Two/Three/Four/Five/", None);
        let error = extract_archive(&deep, &sandbox.path("too-deep-extracted")).unwrap_err();
        assert!(error.contains("four wrapper directories"), "{error}");

        let multi = sandbox.path("multiple-projects.zip");
        let mut zip = ZipWriter::new(File::create(&multi).unwrap());
        for path in ["First/Game.rxproj", "Second/Game.rxproj"] {
            zip.start_file(path, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"RPGXP 1.02").unwrap();
        }
        zip.finish().unwrap();
        let error = extract_archive(&multi, &sandbox.path("multiple-extracted")).unwrap_err();
        assert!(error.contains("multiple RPG Maker projects"), "{error}");
    }

    #[test]
    fn rejects_nested_project_with_unrelated_sibling_instead_of_dropping_it() {
        let sandbox = Sandbox::new();
        let archive = sandbox.path("with-sibling.zip");
        sample_zip(&archive, "ExampleProject/", Some("outside.txt"));
        let output = sandbox.path("extracted");
        let error = extract_archive(&archive, &output).unwrap_err();
        assert!(error.contains("outside its single project folder"), "{error}");
    }


    #[test]
    fn rejects_nonportable_names_and_case_collisions_before_extraction() {
        let sandbox = Sandbox::new();
        for (index, names) in [
            vec!["Game.rxproj", "Data/Map001.rxdata", "data/Map002.rxdata"],
            vec!["Game.rxproj", "Data/CON.txt"],
            vec!["Game.rxproj", "Graphics/Bad?.png"],
            vec!["Game.rxproj", "Data/Map001.rxdata", "Data/map001.rxdata"],
            vec!["Game.rxproj", "Data/./Map001.rxdata"],
            vec!["Game.rxproj", "Data//Map001.rxdata"],
            vec!["Game.rxproj", "Data/Map001.rxdata", "DATA/"],
            vec!["Game.rxproj", "Data", "Data/Map001.rxdata"],
        ].iter().enumerate() {
            let archive = sandbox.path(&format!("invalid-{index}.zip"));
            let mut writer = ZipWriter::new(File::create(&archive).unwrap());
            for name in names {
                if name.ends_with('/') {
                    writer.add_directory(*name, SimpleFileOptions::default()).unwrap();
                } else {
                    writer.start_file(*name, SimpleFileOptions::default()).unwrap();
                    writer.write_all(b"fixture").unwrap();
                }
            }
            writer.finish().unwrap();
            let output = sandbox.path(&format!("output-{index}"));
            let result = extract_archive(&archive, &output);
            assert!(result.is_err(), "accepted nonportable archive {names:?}");
            assert!(!output.exists(), "preflight created files for {names:?}");
        }
    }

    #[test]
    fn portable_mixed_case_project_and_explicit_directories_are_accepted() {
        let sandbox = Sandbox::new();
        let archive = sandbox.path("portable.zip");
        let mut writer = ZipWriter::new(File::create(&archive).unwrap());
        writer.add_directory("Data/", SimpleFileOptions::default()).unwrap();
        for name in ["Game.rxproj", "Data/Map001.rxdata", "Data/Scripts.rxdata"] {
            writer.start_file(name, SimpleFileOptions::default()).unwrap();
            writer.write_all(b"fixture").unwrap();
        }
        writer.finish().unwrap();
        let extracted = extract_archive(&archive, &sandbox.path("portable-project")).unwrap();
        assert_eq!(fs::read(extracted.join("Data/Map001.rxdata")).unwrap(), b"fixture");
    }

    #[test]
    fn failed_import_cleanup_removes_only_the_requested_direct_private_project() {
        use super::discard_imported_project_in;
        let sandbox = Sandbox::new();
        let root = sandbox.path("projects");
        let good = root.join("import-failed");
        let keep = root.join("import-keep");
        let nested = keep.join("import-nested");
        let other = root.join("manually-created");
        let outside = sandbox.path("outside");
        for dir in [&good, &keep, &nested, &other, &outside] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("Game.rxproj"), b"RPGXP 1.02").unwrap();
        }
        fs::write(keep.join("Data.txt"), b"must survive").unwrap();
        assert!(discard_imported_project_in(&root, &outside).is_err());
        assert!(discard_imported_project_in(&root, &nested).is_err());
        assert!(discard_imported_project_in(&root, &other).is_err());
        assert!(discard_imported_project_in(&root, &root).is_err());
        assert!(discard_imported_project_in(&root, &good).is_ok());
        assert!(!good.exists());
        assert_eq!(fs::read(keep.join("Data.txt")).unwrap(), b"must survive");
        assert!(outside.join("Game.rxproj").exists());
    }

    #[cfg(unix)]
    #[test]
    fn failed_import_cleanup_does_not_follow_external_project_symlink() {
        use super::discard_imported_project_in;
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        let root = sandbox.path("projects");
        let outside = sandbox.path("external");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("Game.rxproj"), b"original").unwrap();
        symlink(&outside, root.join("import-link")).unwrap();
        assert!(discard_imported_project_in(&root, &root.join("import-link")).is_err());
        assert_eq!(fs::read(outside.join("Game.rxproj")).unwrap(), b"original");
    }

    #[cfg(unix)]
    #[test]
    fn failed_import_cleanup_rejects_symlink_to_sibling_active_project() {
        use super::discard_imported_project_in;
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        let root = sandbox.path("projects");
        let active = root.join("import-active");
        fs::create_dir_all(&active).unwrap();
        fs::write(active.join("Game.rxproj"), b"original").unwrap();
        fs::write(active.join("Data.txt"), b"must survive").unwrap();
        let alias = root.join("import-failed");
        symlink(&active, &alias).unwrap();
        assert!(discard_imported_project_in(&root, &alias).is_err());
        assert_eq!(fs::read(active.join("Data.txt")).unwrap(), b"must survive");
        assert!(alias.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[test]
    fn private_image_lookup_is_scoped_to_imported_projects() {
        use super::private_project_image_path;
        let sandbox = Sandbox::new();
        let projects = sandbox.path("projects");
        let inside = projects.join("import-test");
        let outside = sandbox.path("external");
        fs::create_dir_all(inside.join("Graphics/Tilesets")).unwrap();
        fs::create_dir_all(outside.join("Graphics/Tilesets")).unwrap();
        fs::write(inside.join("Game.rxproj"), b"project").unwrap();
        fs::write(outside.join("Game.rxproj"), b"outside").unwrap();
        fs::write(inside.join("Graphics/Tilesets/Forest.png"), b"PNG").unwrap();
        fs::write(outside.join("Graphics/Tilesets/Forest.png"), b"PNG").unwrap();

        let (path, mime) = private_project_image_path(&projects, &inside, "tileset", "Forest").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(path, inside.join("Graphics/Tilesets/Forest.png"));
        assert!(private_project_image_path(&projects, &outside, "tileset", "Forest").is_err());
        assert!(private_project_image_path(&projects, &inside, "tileset", "../Forest").is_err());
        assert!(private_project_image_path(&projects, &inside, "bgm", "Forest").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn private_image_lookup_rejects_symlinks_outside_project() {
        use super::private_project_image_path;
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        let projects = sandbox.path("projects");
        let inside = projects.join("import-test");
        fs::create_dir_all(inside.join("Graphics/Tilesets")).unwrap();
        fs::write(inside.join("Game.rxproj"), b"project").unwrap();
        let external = sandbox.path("secret.png");
        fs::write(&external, b"not a game asset").unwrap();
        symlink(&external, inside.join("Graphics/Tilesets/Escape.png")).unwrap();
        assert!(private_project_image_path(&projects, &inside, "tileset", "Escape").is_err());
    }

    #[test]
    fn refuses_traversal_and_duplicate_files() {
        let sandbox = Sandbox::new();
        let traversal = sandbox.path("traversal.zip");
        {
            let mut zip = ZipWriter::new(File::create(&traversal).unwrap());
            zip.start_file("../escape.txt", SimpleFileOptions::default()).unwrap();
            zip.write_all(b"should never escape").unwrap();
            zip.finish().unwrap();
        }
        assert!(extract_archive(&traversal, &sandbox.path("out-traversal")).is_err());
        assert!(!sandbox.path("escape.txt").exists());

        // zip 2.x deliberately refuses to *write* duplicate names. Construct
        // a real duplicate-entry fixture by writing two distinct, equal-length
        // names and changing only the second filename in both ZIP headers.
        // Filenames are not covered by the entry CRC.
        let duplicate = sandbox.path("duplicate.zip");
        {
            let mut zip = ZipWriter::new(File::create(&duplicate).unwrap());
            for name in ["Game.rxproj", "Fake.rxproj"] {
                zip.start_file(name, SimpleFileOptions::default()).unwrap();
                zip.write_all(b"duplicate").unwrap();
            }
            zip.finish().unwrap();
        }
        let mut bytes = fs::read(&duplicate).unwrap();
        let old_name = b"Fake.rxproj";
        let new_name = b"Game.rxproj";
        let offsets: Vec<_> = bytes.windows(old_name.len())
            .enumerate()
            .filter_map(|(offset, window)| (window == old_name).then_some(offset))
            .collect();
        assert_eq!(offsets.len(), 2, "expected local and central ZIP filenames");
        for offset in offsets {
            bytes[offset..offset + old_name.len()].copy_from_slice(new_name);
        }
        fs::write(&duplicate, bytes).unwrap();
        // The ZIP library's name index hides duplicate entries, so check the
        // raw central-directory count instead of trusting file_names()/len().
        assert_eq!(super::declared_zip_entry_count(&duplicate).unwrap(), 2);
        let error = extract_archive(&duplicate, &sandbox.path("out-duplicate")).unwrap_err();
        assert!(error.contains("duplicate or hidden"), "{error}");

        // Also reject a valid ZIP whose file entry is later used as a
        // directory; otherwise extraction could silently drop project data.
        let collision = sandbox.path("file-directory-collision.zip");
        {
            let mut zip = ZipWriter::new(File::create(&collision).unwrap());
            zip.start_file("Data", SimpleFileOptions::default()).unwrap();
            zip.write_all(b"not a directory").unwrap();
            zip.start_file("Data/Map001.rxdata", SimpleFileOptions::default()).unwrap();
            zip.write_all(b"map").unwrap();
            zip.finish().unwrap();
        }
        assert!(extract_archive(&collision, &sandbox.path("out-collision")).is_err());
    }
    #[test]
    fn project_zip_import_open_map_edit_save_export_roundtrip() {
        use crate::marshal::types::RubyObject;
        use crate::marshal::{self, RubyString, RubyValue};
        use crate::models::{MapInfo, RpgMap};
        use flate2::write::ZlibEncoder;
        use flate2::Compression;

        let sandbox = Sandbox::new();
        let project = sandbox.path("xp-fixture");
        fs::create_dir_all(project.join("Data")).unwrap();
        fs::create_dir_all(project.join("PBS")).unwrap();
        fs::create_dir_all(project.join("Graphics/Characters")).unwrap();
        fs::write(project.join("Game.rxproj"), b"RPGXP 1.02").unwrap();
        fs::write(
            project.join("Game.ini"),
            b"[Game]\r\nTitle=Synthetic RMXP Fixture\r\n",
        )
        .unwrap();

        let mut map = RpgMap::new_blank(2, 2, 1);
        for z in 0..3 {
            for y in 0..2 {
                for x in 0..2 {
                    map.data
                        .set(x, y, z, [384, 48, 1024][z as usize] + (y * 2 + x) as i16);
                }
            }
        }
        let mut map_raw = map.to_ruby_value();
        let RubyValue::Object(ref mut obj) = map_raw else {
            panic!("map")
        };
        obj.instance_vars.push((
            "@essentials_custom".into(),
            RubyValue::Symbol("opaque".into()),
        ));
        marshal::dump_file(&project.join("Data/Map001.rxdata"), &map_raw).unwrap();

        let map_infos = RubyValue::Hash(vec![(
            RubyValue::Integer(1),
            MapInfo {
                name: "Synthetic Map".into(),
                parent_id: 0,
                order: 1,
                expanded: true,
                scroll_x: 0,
                scroll_y: 0,
            }
            .to_ruby_value(),
        )]);
        marshal::dump_file(&project.join("Data/MapInfos.rxdata"), &map_infos).unwrap();
        let mut system = RubyObject::new("RPG::System".into());
        system
            .instance_vars
            .push(("@edit_map_id".into(), RubyValue::Integer(1)));
        marshal::dump_file(
            &project.join("Data/System.rxdata"),
            &RubyValue::Object(system),
        )
        .unwrap();
        let mut tileset = RubyObject::new("RPG::Tileset".into());
        tileset.instance_vars.push((
            "@name".into(),
            RubyValue::String(RubyString::new(b"Synthetic Tileset".to_vec())),
        ));
        marshal::dump_file(
            &project.join("Data/Tilesets.rxdata"),
            &RubyValue::Array(vec![RubyValue::Nil, RubyValue::Object(tileset)]),
        )
        .unwrap();

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"def pbFixture; :ok; end\n").unwrap();
        let compressed = encoder.finish().unwrap();
        let scripts = RubyValue::Array(vec![
            RubyValue::Nil,
            RubyValue::Array(vec![
                RubyValue::Integer(1),
                RubyValue::String(RubyString::new(b"Fixture".to_vec())),
                RubyValue::String(RubyString::new(compressed)),
                RubyValue::Integer(991),
            ]),
        ]);
        marshal::dump_file(&project.join("Data/Scripts.rxdata"), &scripts).unwrap();
        fs::write(
            project.join("PBS/pokemon.txt"),
            b"# preserve this comment\r\n[TEST]\r\nName = Example\r\nCustomField = untouched\r\n",
        )
        .unwrap();
        fs::write(
            project.join("Graphics/Characters/NPC.png"),
            [137, 80, 78, 71, 0, 1, 2],
        )
        .unwrap();

        let filenames = [
            "Game.rxproj",
            "Game.ini",
            "Data/Map001.rxdata",
            "Data/MapInfos.rxdata",
            "Data/System.rxdata",
            "Data/Tilesets.rxdata",
            "Data/Scripts.rxdata",
            "PBS/pokemon.txt",
            "Graphics/Characters/NPC.png",
        ];
        let originals: Vec<_> = filenames
            .iter()
            .map(|name| fs::read(project.join(name)).unwrap())
            .collect();

        let archive = sandbox.path("original.zip");
        let mut writer = ZipWriter::new(File::create(&archive).unwrap());
        let options = SimpleFileOptions::default();
        for name in filenames {
            writer
                .start_file(format!("SyntheticXP/{name}"), options)
                .unwrap();
            writer
                .write_all(&fs::read(project.join(name)).unwrap())
                .unwrap();
        }
        writer
            .add_directory("SyntheticXP/Graphics/Empty/", options)
            .unwrap();
        writer.finish().unwrap();
        let original_zip_bytes = fs::read(&archive).unwrap();

        let imports = sandbox.path("imports");
        let projects = sandbox.path("projects");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&projects).unwrap();
        let staged = imports.join("import-fixture.zip");
        fs::copy(&archive, &staged).unwrap();
        let imported = PathBuf::from(
            finish_import(staged, imports, projects.clone(), "import-fixture".into())
                .expect("import nested synthetic XP project"),
        );
        assert_eq!(imported.parent(), Some(projects.as_path()));
        assert!(imported.join("Game.rxproj").is_file());
        assert!(imported.join("Graphics/Empty").is_dir());

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let opened = runtime
            .block_on(crate::commands::project::open_project(
                imported.to_string_lossy().into_owned(),
            ))
            .expect("open imported synthetic RMXP project");
        assert_eq!(opened.name, "Synthetic RMXP Fixture");
        assert_eq!(opened.map_infos.get(&1).unwrap().name, "Synthetic Map");
        assert_eq!(opened.tileset_count, 1);
        assert_eq!(opened.edit_map_id, 1);

        let mut loaded_map = runtime
            .block_on(crate::commands::project::load_map(
                imported.to_string_lossy().into_owned(),
                1,
            ))
            .expect("load genuine-format Map001.rxdata");
        assert_eq!(loaded_map.tiles[0], 384);
        loaded_map.tiles[0] = 385;
        runtime
            .block_on(crate::commands::project::save_map(
                imported.to_string_lossy().into_owned(),
                1,
                loaded_map.tiles,
                loaded_map.width,
                loaded_map.height,
            ))
            .expect("save one controlled map-tile edit");
        let saved_map = runtime
            .block_on(crate::commands::project::load_map(
                imported.to_string_lossy().into_owned(),
                1,
            ))
            .expect("reopen saved map");
        assert_eq!(saved_map.tiles[0], 385);
        assert_eq!(
            &saved_map.tiles[1..],
            &[385, 386, 387, 48, 49, 50, 51, 1024, 1025, 1026, 1027,]
        );

        let reloaded = marshal::load_file(&imported.join("Data/Map001.rxdata")).unwrap();
        assert_eq!(
            reloaded.as_object().unwrap().get("essentials_custom"),
            Some(&RubyValue::Symbol("opaque".into()))
        );
        let reloaded_map = RpgMap::from_ruby_value(&reloaded).unwrap();
        for z in 0..3 {
            for y in 0..2 {
                for x in 0..2 {
                    let expected = if (x, y, z) == (0, 0, 0) {
                        385
                    } else {
                        [384, 48, 1024][z as usize] + (y * 2 + x) as i16
                    };
                    assert_eq!(reloaded_map.data.get(x, y, z), expected);
                }
            }
        }
        assert_eq!(reloaded_map.data.get(0, 0, 0), 385);
        assert_eq!(
            marshal::load_file(&imported.join("Data/Scripts.rxdata")).unwrap(),
            scripts
        );

        let exported = sandbox.path("exported.zip");
        export_zip(&imported, &exported).unwrap();
        for (i, name) in filenames.iter().enumerate() {
            let actual = read_zip_file(&exported, name);
            let expected = if *name == "Data/Map001.rxdata" {
                fs::read(imported.join(name)).unwrap()
            } else {
                originals[i].clone()
            };
            assert_eq!(actual, expected, "archive changed {name}");
        }
        let exported_zip = ZipArchive::new(File::open(&exported).unwrap()).unwrap();
        assert!(exported_zip
            .file_names()
            .any(|name| name == "Graphics/Empty/"));
        assert_eq!(fs::read(&archive).unwrap(), original_zip_bytes);

        // The wrapped fixture above is the sole canonical artifact producer.
        // Multiple parallel Rust tests writing original.zip/exported.zip caused
        // nondeterministic evidence and could pair unrelated ZIPs.
    }

}
