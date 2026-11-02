//! Loopback-only browser development bridge. Never expose this server on a network.
//! Reuses the editor's native Rust project/PBS/Marshal commands; no alternate serializer.
//! A selected, extracted project root is the ONLY accessible project directory.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use essentials_studio_lib::commands::{database, pbs, project, scripts};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_REQUEST: usize = 16 * 1024 * 1024;
const MAX_HEADERS: usize = 16 * 1024;
const MAX_IMAGE: u64 = 32 * 1024 * 1024;

fn required<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(
        args.get(key)
            .cloned()
            .ok_or_else(|| format!("Missing argument: {key}"))?,
    )
    .map_err(|e| format!("Invalid {key}: {e}"))
}

fn serial<T: Serialize>(result: Result<T, String>) -> Result<Value, String> {
    result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

fn inside(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(root.join(relative))
        .map_err(|e| format!("Project file unavailable: {e}"))?;
    if !canonical.starts_with(root) {
        return Err("Project file escapes the selected project root".into());
    }
    Ok(canonical)
}

fn scoped_project(args: &Value, root: &Path) -> Result<String, String> {
    let supplied: String = args
        .get("projectPath")
        .or_else(|| args.get("path"))
        .ok_or("Missing project path")
        .and_then(|v| v.as_str().ok_or("Invalid project path"))?
        .to_owned();
    let actual = fs::canonicalize(&supplied).map_err(|e| e.to_string())?;
    if actual != root {
        return Err("Browser bridge only permits its explicitly selected project root".into());
    }
    Ok(root.to_string_lossy().into_owned())
}

fn map_file(root: &Path, id: i64) -> Result<(), String> {
    if !(1..=999).contains(&id) {
        return Err("Invalid XP map ID".into());
    }
    inside(root, Path::new(&format!("Data/Map{id:03}.rxdata")))?;
    Ok(())
}

fn pbs_file(root: &Path, filename: &str) -> Result<(), String> {
    if filename.is_empty()
        || !filename.ends_with(".txt")
        || !filename[..filename.len() - 4]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Invalid PBS filename".into());
    }
    inside(root, Path::new("PBS").join(filename).as_path())?;
    Ok(())
}

fn image_data(root: &Path, asset_type: &str, name: &str) -> Result<String, String> {
    let asset_dir = match asset_type {
        "tileset" => "Tilesets",
        "autotile" => "Autotiles",
        "character" => "Characters",
        _ => return Err("Unsupported project image type".into()),
    };
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid project image request".into());
    }
    let mut selected = None;
    for (extension, mime) in [
        ("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"),
        ("gif", "image/gif"), ("bmp", "image/bmp"),
    ] {
        let relative = Path::new("Graphics")
            .join(asset_dir)
            .join(format!("{name}.{extension}"));
        if !root.join(&relative).exists() {
            continue;
        }
        let file = inside(root, &relative)?;
        let size = fs::metadata(&file).map_err(|e| e.to_string())?.len();
        if size > MAX_IMAGE {
            return Err("Project image exceeds the 32 MiB limit".into());
        }
        selected = Some((file, mime));
        break;
    }
    let (path, mime) = selected.ok_or("Project image not found")?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

async fn dispatch(command: &str, args: &Value, root: &Path) -> Result<Value, String> {
    if command == "project_root" {
        return Ok(json!(root.to_string_lossy().to_string()));
    }
    let path = scoped_project(args, root)?;
    match command {
        "open_project" => {
            for f in ["Game.rxproj", "Data/MapInfos.rxdata", "Data/System.rxdata", "Data/Tilesets.rxdata"] {
                inside(root, Path::new(f))?;
            }
            serial(project::open_project(path).await)
        }
        "load_map" => {
            let id: i64 = required(args, "mapId")?;
            map_file(root, id)?;
            serial(project::load_map(path, id).await)
        }
        "save_map" => {
            let id: i64 = required(args, "mapId")?;
            map_file(root, id)?;
            serial(project::save_map(
                path, id, required(args, "tiles")?,
                required(args, "width")?, required(args, "height")?,
            ).await)
        }
        "load_tileset" => {
            inside(root, Path::new("Data/Tilesets.rxdata"))?;
            serial(project::load_tileset(path, required(args, "tilesetId")?).await)
        }
        "load_event" => {
            let id: i64 = required(args, "mapId")?;
            map_file(root, id)?;
            serial(project::load_event(path, id, required(args, "eventId")?).await)
        }
        "save_event" => {
            let id: i64 = required(args, "mapId")?;
            map_file(root, id)?;
            serial(project::save_event(path, id, required(args, "event")?).await)
        }
        "get_map_properties" => {
            let id: i64 = required(args, "mapId")?;
            map_file(root, id)?;
            serial(project::get_map_properties(path, id).await)
        }
        "list_tileset_names" => {
            inside(root, Path::new("Data/Tilesets.rxdata"))?;
            serial(project::list_tileset_names(path).await)
        }
        "load_system" => {
            inside(root, Path::new("Data/System.rxdata"))?;
            serial(database::load_system(path).await)
        }
        "load_database" => {
            let filename: String = required(args, "filename")?;
            if filename.contains('/') || filename.contains('\\') || !filename.ends_with(".rxdata") {
                return Err("Invalid database filename".into());
            }
            inside(root, Path::new("Data").join(&filename).as_path())?;
            serial(database::load_database(path, filename).await)
        }
        "load_script_list" => {
            inside(root, Path::new("Data/Scripts.rxdata"))?;
            serial(scripts::load_script_list(path).await)
        }
        "load_script_source" => {
            inside(root, Path::new("Data/Scripts.rxdata"))?;
            serial(scripts::load_script_source(path, required(args, "scriptId")?).await)
        }
        "list_pbs_files" => {
            inside(root, Path::new("PBS"))?;
            serial(pbs::list_pbs_files(path).await)
        }
        "load_pbs_file" => {
            let name: String = required(args, "filename")?;
            pbs_file(root, &name)?;
            serial(pbs::load_pbs_file(path, name).await)
        }
        "save_pbs_file" => {
            let name: String = required(args, "filename")?;
            pbs_file(root, &name)?;
            serial(pbs::save_pbs_file(path, name, required(args, "sections")?).await)
        }
        "read_raw_pbs_file" => {
            let name: String = required(args, "filename")?;
            pbs_file(root, &name)?;
            serial(pbs::read_raw_pbs_file(path, name).await)
        }
        "write_raw_pbs_file" => {
            let name: String = required(args, "filename")?;
            pbs_file(root, &name)?;
            serial(pbs::write_raw_pbs_file(path, name, required(args, "content")?).await)
        }
        "list_asset_files" => {
            let asset_type: String = required(args, "assetType")?;
            if !matches!(asset_type.as_str(), "tileset" | "autotile" | "character") {
                return Err("Unsupported asset directory".into());
            }
            let dir = match asset_type.as_str() { "tileset" => "Tilesets", "autotile" => "Autotiles", _ => "Characters" };
            if root.join("Graphics").join(dir).exists() {
                inside(root, Path::new("Graphics").join(dir).as_path())?;
            }
            serial(project::list_asset_files(path, asset_type).await)
        }
        "read_private_project_image" => {
            let kind: String = required(args, "assetType")?;
            let name: String = required(args, "assetName")?;
            Ok(json!(image_data(root, &kind, &name)?))
        }
        "get_asset_path" => {
            // The browser cannot use native filesystem paths. Return a scoped
            // data URL that existing image controls can render directly.
            let kind: String = required(args, "assetType")?;
            let name: String = required(args, "assetName")?;
            Ok(json!(image_data(root, &kind, &name)?))
        }
        _ => Err(format!(
            "Browser bridge does not support {command}. Use native Tauri for ZIP import/export or other operations."
        )),
    }
}

fn http_response(stream: &mut TcpStream, status: &str, body: Value) {
    let payload = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        payload.len(), payload
    );
    let _ = stream.write_all(response.as_bytes());
}

fn handle(mut stream: TcpStream, token: &str, root: &Path, rt: &tokio::runtime::Runtime) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
    let result: Result<Value, String> = (|| {
        let mut data = Vec::new();
        let mut chunk = [0u8; 8192];
        let header_end = loop {
            let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
            if n == 0 { return Err("Incomplete HTTP request".into()); }
            data.extend_from_slice(&chunk[..n]);
            if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos + 4;
            }
            if data.len() > MAX_HEADERS { return Err("HTTP headers too large".into()); }
        };
        if header_end > MAX_HEADERS { return Err("HTTP headers too large".into()); }
        let headers = std::str::from_utf8(&data[..header_end]).map_err(|e| e.to_string())?;
        let mut lines = headers.split("\r\n");
        if lines.next() != Some("POST /invoke HTTP/1.1") {
            return Err("Only POST /invoke is supported".into());
        }
        let mut authorization = None;
        let mut origin = None;
        let mut content_type = None;
        let mut client = None;
        let mut length = None;
        let mut host = None;
        for line in lines {
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim().to_ascii_lowercase();
                let value = value.trim();
                match key.as_str() {
                    "authorization" => authorization = Some(value),
                    "origin" => origin = Some(value),
                    "content-type" => content_type = Some(value),
                    "x-essentials-client" => client = Some(value),
                    "content-length" => length = value.parse::<usize>().ok(),
                    "host" => host = Some(value),
                    "transfer-encoding" => return Err("Chunked requests are not supported".into()),
                    _ => {}
                }
            }
        }
        if authorization != Some(format!("Bearer {token}").as_str())
            || origin != Some("http://127.0.0.1:5173")
            || host != Some("127.0.0.1:5174")
            || client != Some("browser-dev")
            || content_type != Some("application/json")
        {
            return Err("Browser bridge request failed origin or authentication checks".into());
        }
        let size = length.ok_or("Missing Content-Length")?;
        if size > MAX_REQUEST { return Err("Request exceeds 16 MiB".into()); }
        if data.len() > header_end + size { return Err("Unexpected trailing HTTP bytes".into()); }
        while data.len() - header_end < size {
            let remaining = size - (data.len() - header_end);
            let take = remaining.min(chunk.len());
            let n = stream.read(&mut chunk[..take]).map_err(|e| e.to_string())?;
            if n == 0 { return Err("Truncated request body".into()); }
            data.extend_from_slice(&chunk[..n]);
        }
        let request: Value = serde_json::from_slice(&data[header_end..])
            .map_err(|e| format!("Invalid JSON: {e}"))?;
        let cmd = request.get("command").and_then(Value::as_str).ok_or("Missing command")?;
        let args = request.get("args").unwrap_or(&Value::Null);
        rt.block_on(dispatch(cmd, args, root))
    })();
    match result {
        Ok(value) => http_response(&mut stream, "200 OK", json!({"ok":true,"result":value})),
        Err(error) => http_response(&mut stream, "400 Bad Request", json!({"ok":false,"error":error})),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = env::var("ESSENTIALS_BROWSER_PROJECT_ROOT")
        .map_err(|_| "Set ESSENTIALS_BROWSER_PROJECT_ROOT to an extracted, disposable RMXP project")?;
    let root = fs::canonicalize(root)?;
    if !root.is_dir() { return Err("Project root must be a directory".into()); }
    for file in ["Game.rxproj", "Data/MapInfos.rxdata", "Data/System.rxdata", "Data/Tilesets.rxdata"] {
        inside(&root, Path::new(file))?;
    }
    let token = env::var("ESSENTIALS_BROWSER_TOKEN")
        .map_err(|_| "Missing ephemeral browser token")?;
    if token.len() < 32 { return Err("Browser token is too short".into()); }
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let listener = TcpListener::bind("127.0.0.1:5174")?;
    println!("Browser bridge ready on 127.0.0.1:5174 (selected root only)");
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle(stream, &token, &root, &rt),
            Err(e) => eprintln!("Browser bridge connection error: {e}"),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsupported_commands() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let args = json!({"projectPath":root.to_string_lossy()});
        let result = rt.block_on(dispatch("begin_project_archive_export", &args, &root));
        assert!(result.unwrap_err().contains("does not support"));
    }
    #[test]
    fn only_selected_project_root_is_accepted() {
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let outside = root.parent().unwrap();
        assert!(scoped_project(&json!({ "projectPath": outside.to_string_lossy() }), &root).is_err());
        assert!(scoped_project(&json!({ "projectPath": root.to_string_lossy() }), &root).is_ok());
    }

    #[test]
    fn loopback_http_requires_token_and_exact_origin() {
        use std::net::Shutdown;
        fn request(token: &str, origin: &str) -> String {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
            let worker = std::thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                handle(stream, &"a".repeat(64), &root, &rt);
            });
            let body = r#"{"command":"project_root","args":{}}"#;
            let wire = format!(
                "POST /invoke HTTP/1.1\r\nHost: 127.0.0.1:5174\r\nOrigin: {origin}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nX-Essentials-Client: browser-dev\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            let mut client = TcpStream::connect(address).unwrap();
            client.write_all(wire.as_bytes()).unwrap();
            client.shutdown(Shutdown::Write).unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            worker.join().unwrap();
            response
        }
        assert!(request(&"a".repeat(64), "http://127.0.0.1:5173").contains("\"ok\":true"));
        assert!(request("wrong", "http://127.0.0.1:5173").contains("\"ok\":false"));
        assert!(request(&"a".repeat(64), "http://evil.example").contains("\"ok\":false"));
    }

    #[test]
    fn rejects_invalid_asset_names() {
        let root = std::env::temp_dir();
        assert!(image_data(&root, "Tilesets", "../../secrets").is_err());
        assert!(image_data(&root, "Scripts", "test").is_err());
    }
}
