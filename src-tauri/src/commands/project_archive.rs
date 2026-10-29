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
    // Publishing only the nested project directory would silently delete any
    // siblings when finish_import cleans the staging directory. Refuse such
    // archives instead of losing unrelated files without warning.
    for sibling in fs::read_dir(extracted).map_err(|e| e.to_string())? {
        let sibling = sibling.map_err(|e| e.to_string())?;
        if sibling.path() != project {
            return Err(
                "ZIP has files outside its single project folder; repackage the project without unrelated top-level files".into()
            );
        }
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


#[cfg(test)]
mod archive_roundtrip_tests {
    use super::{extract_archive, export_zip, finish_import, unique_id};
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
    fn rejects_nested_project_with_unrelated_sibling_instead_of_dropping_it() {
        let sandbox = Sandbox::new();
        let archive = sandbox.path("with-sibling.zip");
        sample_zip(&archive, "ExampleProject/", Some("outside.txt"));
        let output = sandbox.path("extracted");
        let error = extract_archive(&archive, &output).unwrap_err();
        assert!(error.contains("outside its single project folder"), "{error}");
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
        let zip = ZipArchive::new(File::open(&duplicate).unwrap()).unwrap();
        assert_eq!(zip.file_names().filter(|name| *name == "Game.rxproj").count(), 2);
        assert!(extract_archive(&duplicate, &sandbox.path("out-duplicate")).is_err());

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
}
