use std::sync::Mutex;

/// Android launch probe: editing must not depend on desktop audio devices.
/// TODO(android-audio): use a mobile audio backend after reliable project saving.
pub struct AudioHandle;

impl AudioHandle {
    pub fn new() -> Self {
        AudioHandle
    }
}

#[tauri::command]
pub async fn preview_audio(
    _audio: tauri::State<'_, Mutex<AudioHandle>>,
    _project_path: String,
    _asset_type: String,
    _asset_name: String,
    _volume: f32,
) -> Result<(), String> {
    Err("Audio preview is not yet available on Android".to_string())
}

#[tauri::command]
pub async fn stop_audio(_audio: tauri::State<'_, Mutex<AudioHandle>>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn is_audio_playing(_audio: tauri::State<'_, Mutex<AudioHandle>>) -> Result<bool, String> {
    Ok(false)
}
