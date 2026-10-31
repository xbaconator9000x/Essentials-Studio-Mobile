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

#[tauri::command]
pub async fn import_project_archive_from_document(
    app: AppHandle,
    document_uri: String,
) -> Result<String, String> {
    validate_document_uri(&document_uri)?;

    #[cfg(target_os = "android")]
    {
        let import_id = begin_project_archive_import(app.clone()).await?;
        let result = async {
            let path = staging_path(&import_root(&app)?, &import_id)?;
            tauri::async_runtime::spawn_blocking(move || {
                stream_android_document_to_staging(&path, &document_uri)
            })
            .await
            .map_err(|e| format!("Android document import worker failed: {e}"))??;
            finish_project_archive_import(app.clone(), import_id.clone()).await
        }.await;
        if result.is_err() {
            let _ = abort_project_archive_import(app, import_id).await;
        }
        result
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Android document import is only available on Android".into())
    }
}

#[cfg(target_os = "android")]
fn stream_android_document_to_staging(path: &std::path::Path, uri: &str) -> Result<u64, String> {
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
        let input = env.call_method(
            &resolver,
            "openInputStream",
            "(Landroid/net/Uri;)Ljava/io/InputStream;",
            &[JValue::Object(&document)],
        )?.l()?;
        if input.is_null() {
            return Err(io::Error::other("Android document provider returned no input stream").into());
        }

        let read_result = (|| -> Result<u64, Box<dyn std::error::Error>> {
            let file = OpenOptions::new().write(true).truncate(true).open(path)?;
            let mut writer = BoundedDocumentWriter::new(file, MAX_ARCHIVE_BYTES);
            let bytes = env.new_byte_array(DOCUMENT_IMPORT_CHUNK_BYTES as i32)?;
            let mut buffer = [0i8; DOCUMENT_IMPORT_CHUNK_BYTES];
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
                }
                Ok(())
            })();
            let delete_result = env.delete_local_ref(bytes);
            transfer_result?;
            delete_result?;
            let (file, written) = writer.finish()?;
            file.sync_all()?;
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

    transfer(path, uri).map_err(|e| format!("Android document import stream failed: {e}"))
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
        let written = tauri::async_runtime::spawn_blocking(move || {
            write_and_verify_android_document(&path, &document_uri)
        }).await.map_err(|e| format!("Android document worker failed: {e}"))??;
        if written != size {
            return Err("Android document export byte count mismatch".into());
        }
        Ok(written)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (path, document_uri);
        Err("Android document export is only available on Android".into())
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
                if actual[..n].iter().zip(&expected[..n]).any(|(a, b)| *a as u8 != *b) {
                    return Err(io::Error::other("Android document differs from exported ZIP").into());
                }
                verified += n as u64;
            }
            env.delete_local_ref(bytes)?;
            if verified != copied {
                return Err(io::Error::other("Android document is incomplete after write").into());
            }
            Ok(())
        })();
        let close_result = env.call_method(&input, "close", "()V", &[]);
        verify_result?;
        close_result?;
        Ok(copied)
    }

    transfer(path, uri).map_err(|e| format!("Android document write/readback failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{validate_document_uri, BoundedDocumentWriter, DOCUMENT_IMPORT_CHUNK_BYTES};
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
}
