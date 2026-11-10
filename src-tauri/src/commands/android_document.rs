//! Android Storage Access Framework import/export for app-private ZIPs.
//! Never treat a content:// URI as a filesystem path. The picker grants a
//! scoped document URI; ContentResolver streams ZIPs without a WebView Blob.

use std::fs;
use tauri::AppHandle;
use super::project_archive::{
    abort_project_archive_import, begin_project_archive_import, exports_root,
    finish_project_archive_import, import_root, safe_export_id, staging_path, MAX_ARCHIVE_BYTES,
};

#[cfg(any(target_os = "android", test))]
const DOCUMENT_IMPORT_CHUNK_BYTES: usize = 64 * 1024;
#[cfg(target_os = "android")]
const DOCUMENT_IMPORT_PROGRESS_INTERVAL: u64 = 1024 * 1024;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDocumentImportProgress {
    stage: &'static str,
    bytes_read: u64,
}

#[cfg(target_os = "android")]
fn send_import_progress(
    channel: &tauri::ipc::Channel<AndroidDocumentImportProgress>,
    stage: &'static str,
    bytes_read: u64,
) {
    // Progress is informational. A closed frontend channel must not interrupt
    // the bounded copy or change the import's validation/cleanup semantics.
    let _ = channel.send(AndroidDocumentImportProgress { stage, bytes_read });
}

#[cfg(target_os = "android")]
fn trace_android_document_import(stage: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[android-document-import] {stage}");
    #[cfg(not(debug_assertions))]
    let _ = stage;
}

fn validate_document_uri(uri: &str) -> Result<(), String> {
    let authority = uri.strip_prefix("content://")
        .and_then(|tail| tail.split('/').next())
        .unwrap_or("");
    if authority.is_empty() || uri.len() > 4096 || uri.chars().any(char::is_control) {
        return Err("Expected a valid Android document content URI".into());
    }
    Ok(())
}

#[cfg(any(target_os = "android", test))]
struct BoundedDocumentWriter<W> {
    inner: W,
    written: u64,
    limit: u64,
}

#[cfg(any(target_os = "android", test))]
impl<W: std::io::Write> BoundedDocumentWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self { inner, written: 0, limit }
    }

    fn write_chunk(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if bytes.is_empty() || bytes.len() > DOCUMENT_IMPORT_CHUNK_BYTES {
            return Err(std::io::Error::other("Invalid Android document chunk size"));
        }
        let next = self.written.checked_add(bytes.len() as u64)
            .ok_or_else(|| std::io::Error::other("Android document size overflow"))?;
        if next > self.limit {
            return Err(std::io::Error::other("Android document exceeds 512 MiB limit"));
        }
        self.inner.write_all(bytes)?;
        self.written = next;
        Ok(())
    }

    fn finish(mut self) -> std::io::Result<(W, u64)> {
        if self.written == 0 {
            return Err(std::io::Error::other("Android document is empty"));
        }
        self.inner.flush()?;
        Ok((self.inner, self.written))
    }
}

#[cfg(any(target_os = "android", test))]
fn verify_document_readback_chunk(expected: &[u8], actual: &[i8]) -> std::io::Result<()> {
    if expected.len() != actual.len()
        || expected
            .iter()
            .zip(actual)
            .any(|(expected, actual)| *expected != *actual as u8)
    {
        return Err(std::io::Error::other(
            "Android document differs from exported ZIP",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn import_project_archive_from_document(
    app: AppHandle,
    document_uri: String,
    progress: tauri::ipc::Channel<AndroidDocumentImportProgress>,
) -> Result<String, String> {
    validate_document_uri(&document_uri)?;

    #[cfg(target_os = "android")]
    {
        trace_android_document_import("begin");
        send_import_progress(&progress, "reading", 0);
        let import_id = begin_project_archive_import(app.clone()).await?;
        trace_android_document_import("staging stream start");
        let progress_for_worker = progress.clone();
        let result = async {
            let path = staging_path(&import_root(&app)?, &import_id)?;
            let bytes_read = tauri::async_runtime::spawn_blocking(move || {
                stream_android_document_to_staging(&path, &document_uri, &progress_for_worker)
            })
            .await
            .map_err(|e| format!("Android document import worker failed: {e}"))??;
            trace_android_document_import("staging stream complete");
            trace_android_document_import("archive finalization start");
            send_import_progress(&progress, "validating", bytes_read);
            let project_path = finish_project_archive_import(app.clone(), import_id.clone()).await?;
            send_import_progress(&progress, "ready", bytes_read);
            Ok(project_path)
        }
        .await;
        trace_android_document_import(if result.is_ok() {
            "archive finalization complete"
        } else {
            "archive finalization failed"
        });
        if result.is_err() {
            let _ = abort_project_archive_import(app, import_id).await;
        }
        result
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, progress);
        Err("Android document import is only available on Android".into())
    }
}

#[cfg(target_os = "android")]
fn stream_android_document_to_staging(
    path: &std::path::Path,
    uri: &str,
    progress: &tauri::ipc::Channel<AndroidDocumentImportProgress>,
) -> Result<u64, String> {
    use jni::objects::{JObject, JValue};
    use std::fs::OpenOptions;
    use std::io;

    fn transfer(path: &std::path::Path, uri: &str) -> Result<u64, Box<dyn std::error::Error>> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        let android_context = unsafe { JObject::from_raw(context.context().cast()) };
        let resolver = env.call_method(
            &android_context,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?.l()?;
        let uri_string = JObject::from(env.new_string(uri)?);
        let document = env.call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&uri_string)],
        )?.l()?;
        trace_android_document_import("opening provider input stream");
        let input = env.call_method(
            &resolver,
            "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[JValue::Object(&document)],
        )?.l()?;
        if input.is_null() {
            return Err(io::Error::other("Android document provider returned no input stream").into());
        }
        trace_android_document_import("provider input stream opened");

        let read_result = (|| -> Result<u64, Box<dyn std::error::Error>> {
            let file = OpenOptions::new().write(true).truncate(true).open(path)?;
            let mut writer = BoundedDocumentWriter::new(file, MAX_ARCHIVE_BYTES);
            let bytes = env.new_byte_array(DOCUMENT_IMPORT_CHUNK_BYTES as i32)?;
            let mut buffer = [0i8; DOCUMENT_IMPORT_CHUNK_BYTES];
            let mut last_reported_bytes = 0u64;
            let transfer_result = (|| -> Result<(), Box<dyn std::error::Error>> {
                loop {
                    let count = env.call_method(
                        &input,
                        "read",
                        "([B)I",
                        &[JValue::Object(bytes.as_ref())],
                    )?.i()?;
                    if count == -1 {
                        break;
                    }
                    if count <= 0 || count as usize > buffer.len() {
                        return Err(io::Error::other("Invalid Android document stream length").into());
                    }
                    let count = count as usize;
                    env.get_byte_array_region(&bytes, 0, &mut buffer[..count])?;
                    let chunk = buffer[..count].iter().map(|byte| *byte as u8).collect::<Vec<_>>();
                    writer.write_chunk(&chunk)?;
                    if writer.written - last_reported_bytes >= DOCUMENT_IMPORT_PROGRESS_INTERVAL {
                        last_reported_bytes = writer.written;
                        send_import_progress(progress, "reading", writer.written);
                    }
                }
                Ok(())
            })();
            let delete_result = env.delete_local_ref(bytes);
            transfer_result?;
            delete_result?;
            let (file, written) = writer.finish()?;
            file.sync_all()?;
            send_import_progress(progress, "reading", written);
            trace_android_document_import("provider input stream read complete");
            Ok(written)
        })();

        let exception_pending = env.exception_check().unwrap_or(false);
        if exception_pending {
            let _ = env.exception_clear();
        }
        let close_result = env.call_method(&input, "close", "()V", &[]);
        match read_result {
            Err(error) => {
                let _ = close_result;
                Err(error)
            }
            Ok(written) => {
                close_result?;
                Ok(written)
            }
        }
    }

    let result =
        transfer(path, uri).map_err(|e| format!("Android document import stream failed: {e}"));
    #[cfg(debug_assertions)]
    if let Ok(bytes) = result.as_ref() {
        eprintln!("[android-document-import] staged {bytes} bytes");
    }
    result
}

#[tauri::command]
pub async fn save_project_archive_to_document(
    app: AppHandle,
    export_id: String,
    document_uri: String,
) -> Result<u64, String> {
    safe_export_id(&export_id)?;
    validate_document_uri(&document_uri)?;
    let path = exports_root(&app)?.join(format!("{export_id}.zip"));
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size == 0 || size > MAX_ARCHIVE_BYTES {
        return Err("Invalid app-private ZIP export size".into());
    }

    #[cfg(target_os = "android")]
    {
        let expected_size = size;
        let written = tauri::async_runtime::spawn_blocking(move || {
            let written = write_and_verify_android_document(&path, &document_uri)?;
            if written != expected_size {
                let cleanup = delete_android_document(&document_uri);
                return Err(document_failure_message(
                    "Android document export",
                    "byte count mismatch",
                    cleanup,
                ));
            }
            Ok(written)
        })
        .await
        .map_err(|e| format!("Android document worker failed: {e}"))??;
        Ok(written)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (path, document_uri);
        Err("Android document export is only available on Android".into())
    }
}

#[tauri::command]
pub async fn discard_incomplete_project_archive_document(
    export_id: String,
    document_uri: String,
) -> Result<(), String> {
    safe_export_id(&export_id)?;
    validate_document_uri(&document_uri)?;

    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || delete_android_document(&document_uri))
            .await
            .map_err(|e| format!("Android document cleanup worker failed: {e}"))?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = document_uri;
        Err("Android document cleanup is only available on Android".into())
    }
}

#[cfg(target_os = "android")]
fn write_and_verify_android_document(path: &std::path::Path, uri: &str) -> Result<u64, String> {
    use jni::objects::{JObject, JValue};
    use std::fs::File;
    use std::io::{self, Read};

    fn transfer(path: &std::path::Path, uri: &str) -> Result<u64, Box<dyn std::error::Error>> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        // ndk-context holds the application context reference for the lifetime
        // of the Android runtime; it is not a Rust-owned filesystem path.
        let android_context = unsafe { JObject::from_raw(context.context().cast()) };
        let resolver = env.call_method(
            &android_context,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?.l()?;
        let uri_string = JObject::from(env.new_string(uri)?);
        let document = env.call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&uri_string)],
        )?.l()?;
        let mode = JObject::from(env.new_string("wt")?);
        let output = env.call_method(
            &resolver,
            "openOutputStream",
            "(Landroid/net/Uri;Ljava/lang/String;)Ljava/io/OutputStream;",
            &[JValue::Object(&document), JValue::Object(&mode)],
        )?.l()?;
        if output.is_null() {
            return Err(io::Error::other("Android document provider returned no output stream").into());
        }

        // Stream in 64 KiB blocks. Explicitly delete each JNI local reference
        // so large archives cannot exhaust Android's local reference table.
        let mut source = File::open(path)?;
        let mut buffer = [0u8; 64 * 1024];
        let write_result = (|| -> Result<u64, Box<dyn std::error::Error>> {
            let mut copied = 0u64;
            loop {
                let n = source.read(&mut buffer)?;
                if n == 0 { break; }
                let bytes = env.byte_array_from_slice(&buffer[..n])?;
                let write_result = env.call_method(
                    &output, "write", "([BII)V",
                    &[JValue::Object(bytes.as_ref()), JValue::Int(0), JValue::Int(n as i32)],
                );
                let cleanup_result = env.delete_local_ref(bytes);
                write_result?;
                cleanup_result?;
                copied += n as u64;
            }
            env.call_method(&output, "flush", "()V", &[])?;
            Ok(copied)
        })();
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        let close_result = env.call_method(&output, "close", "()V", &[]);
        let copied = write_result?;
        close_result?;

        // Reopen through ContentResolver and compare every byte. Some Android
        // providers have reported a successful write while exposing a 0-byte
        // document; never tell the editor that such an export succeeded.
        let input = env.call_method(
            &resolver, "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[JValue::Object(&document)],
        )?.l()?;
        if input.is_null() {
            return Err(io::Error::other("Android document provider returned no readback stream").into());
        }
        let verify_result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let bytes = env.new_byte_array(64 * 1024)?;
            let mut original = File::open(path)?;
            let mut expected = [0u8; 64 * 1024];
            let mut actual = [0i8; 64 * 1024];
            let mut verified = 0u64;
            loop {
                let n = env.call_method(
                    &input, "read", "([B)I", &[JValue::Object(bytes.as_ref())],
                )?.i()?;
                if n == -1 { break; }
                if n <= 0 || n as usize > actual.len() {
                    return Err(io::Error::other("Invalid Android document readback length").into());
                }
                let n = n as usize;
                env.get_byte_array_region(&bytes, 0, &mut actual[..n])?;
                original.read_exact(&mut expected[..n])?;
                verify_document_readback_chunk(&expected[..n], &actual[..n])?;
                verified += n as u64;
            }
            env.delete_local_ref(bytes)?;
            if verified != copied {
                return Err(io::Error::other("Android document is incomplete after write").into());
            }
            Ok(())
        })();
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        let close_result = env.call_method(&input, "close", "()V", &[]);
        verify_result?;
        close_result?;
        Ok(copied)
    }

    match transfer(path, uri) {
        Ok(written) => Ok(written),
        Err(error) => {
            let cleanup = delete_android_document(uri);
            Err(document_failure_message(
                "Android document write/readback failed",
                &error.to_string(),
                cleanup,
            ))
        }
    }
}

fn document_failure_message(context: &str, failure: &str, cleanup: Result<(), String>) -> String {
    match cleanup {
        Ok(()) => format!("{context}: {failure}; incomplete destination removed"),
        Err(cleanup_error) => {
            format!("{context}: {failure}; incomplete destination cleanup failed: {cleanup_error}")
        }
    }
}

#[cfg(target_os = "android")]
fn delete_android_document(uri: &str) -> Result<(), String> {
    use jni::objects::{JObject, JValue};

    fn delete(uri: &str) -> Result<(), Box<dyn std::error::Error>> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        if env.exception_check()? {
            env.exception_clear()?;
        }
        // ndk-context holds the application context reference for the lifetime
        // of the Android runtime; it is not a Rust-owned filesystem path.
        let android_context = unsafe { JObject::from_raw(context.context().cast()) };
        let resolver = env.call_method(
            &android_context,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )?.l()?;
        let uri_string = JObject::from(env.new_string(uri)?);
        let document = env.call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&uri_string)],
        )?.l()?;
        let selection = JObject::null();
        let selection_args = JObject::null();
        let deleted = env.call_method(
            &resolver,
            "delete",
            "(Landroid/net/Uri;Ljava/lang/String;[Ljava/lang/String;)I",
            &[
                JValue::Object(&document),
                JValue::Object(&selection),
                JValue::Object(&selection_args),
            ],
        )?.i()?;
        if deleted == 0 {
            return Err("document provider did not remove the selected destination".into());
        }
        Ok(())
    }

    delete(uri).map_err(|error| format!("could not delete incomplete Android document: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        document_failure_message, validate_document_uri, AndroidDocumentImportProgress,
        BoundedDocumentWriter,
        verify_document_readback_chunk, DOCUMENT_IMPORT_CHUNK_BYTES,
    };
    use std::io::Cursor;

    #[test]
    fn rejects_unscoped_filesystem_paths_and_invalid_content_uris() {
        for invalid in ["", "/storage/emulated/0/file.zip", "file:///tmp/x", "content://", "content:///x", "content://a\n/x"] {
            assert!(validate_document_uri(invalid).is_err(), "Accepted {invalid:?}");
        }
    }

    #[test]
    fn accepts_document_provider_uris_without_interpreting_as_paths() {
        for valid in [
            "content://com.android.providers.downloads.documents/document/42",
            "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fproject.zip",
        ] {
            assert!(validate_document_uri(valid).is_ok());
        }
    }

    #[test]
    fn document_import_progress_uses_the_frontend_channel_field_names() {
        let progress = AndroidDocumentImportProgress {
            stage: "reading",
            bytes_read: 1024,
        };
        let value = serde_json::to_value(progress).unwrap();
        assert_eq!(value["stage"], "reading");
        assert_eq!(value["bytesRead"], 1024);
    }

    #[test]
    fn bounded_document_writer_streams_chunks_and_rejects_empty_archives() {
        let mut writer = BoundedDocumentWriter::new(Cursor::new(Vec::new()), 8);
        writer.write_chunk(b"first").unwrap();
        writer.write_chunk(b"123").unwrap();
        let (output, written) = writer.finish().unwrap();
        assert_eq!(written, 8);
        assert_eq!(output.into_inner(), b"first123");

        let writer = BoundedDocumentWriter::new(Cursor::new(Vec::new()), 8);
        assert!(writer.finish().unwrap_err().to_string().contains("empty"));
    }

    #[test]
    fn bounded_document_writer_rejects_oversized_chunks_and_total_size() {
        let mut writer = BoundedDocumentWriter::new(Cursor::new(Vec::new()), 8);
        assert!(writer.write_chunk(&vec![0; DOCUMENT_IMPORT_CHUNK_BYTES + 1]).is_err());
        writer.write_chunk(b"12345678").unwrap();
        assert!(writer.write_chunk(b"x").unwrap_err().to_string().contains("limit"));
    }

    #[test]
    fn document_readback_accepts_complete_archive_chunks_and_rejects_partial_or_changed_bytes() {
        let archive = (0..(DOCUMENT_IMPORT_CHUNK_BYTES + 37))
            .map(|index| (index % 256) as u8)
            .collect::<Vec<_>>();
        let mut writer = BoundedDocumentWriter::new(Cursor::new(Vec::new()), archive.len() as u64);
        for chunk in archive.chunks(DOCUMENT_IMPORT_CHUNK_BYTES) {
            writer.write_chunk(chunk).unwrap();
        }
        let (provider_document, written) = writer.finish().unwrap();
        let provider_bytes = provider_document.into_inner();
        assert_eq!(written, archive.len() as u64);
        assert_eq!(provider_bytes, archive);

        for (expected, actual) in archive
            .chunks(DOCUMENT_IMPORT_CHUNK_BYTES)
            .zip(provider_bytes.chunks(DOCUMENT_IMPORT_CHUNK_BYTES))
        {
            let actual = actual.iter().map(|byte| *byte as i8).collect::<Vec<_>>();
            verify_document_readback_chunk(expected, &actual).unwrap();
        }

        let changed = vec![0i8; 8];
        assert!(verify_document_readback_chunk(b"12345678", &changed).is_err());
        assert!(verify_document_readback_chunk(b"12345678", &[49i8]).is_err());
    }

    #[test]
    fn failed_export_reports_whether_the_partial_document_was_removed() {
        assert_eq!(
            document_failure_message("write failed", "provider error", Ok(())),
            "write failed: provider error; incomplete destination removed"
        );
        assert_eq!(
            document_failure_message(
                "write failed",
                "provider error",
                Err("provider denied delete".into()),
            ),
            "write failed: provider error; incomplete destination cleanup failed: provider denied delete"
        );
    }
}
