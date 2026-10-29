use crate::marshal;
use crate::models::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Project metadata returned when opening a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub map_infos: HashMap<i64, MapInfo>,
    pub tileset_count: usize,
    pub edit_map_id: i64,
}

/// Map data sent to the frontend for rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapRenderData {
    pub id: i64,
    pub width: i64,
    pub height: i64,
    pub tileset_id: i64,
    /// Flattened tile data: [layer0_tiles..., layer1_tiles..., layer2_tiles...]
    /// Each layer is width*height i16 values in row-major order.
    pub tiles: Vec<i16>,
    pub events: Vec<EventInfo>,
}

/// Lightweight event info for the map editor overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventInfo {
    pub id: i64,
    pub name: String,
    pub x: i64,
    pub y: i64,
    pub page_count: usize,
    pub graphic_name: String,
    pub graphic_direction: i64,
    pub graphic_pattern: i64,
}

/// Tileset info sent to the frontend for the palette.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TilesetRenderInfo {
    pub id: i64,
    pub name: String,
    pub tileset_name: String,
    pub autotile_names: Vec<String>,
    pub passages: Vec<i16>,
    pub priorities: Vec<i16>,
    pub terrain_tags: Vec<i16>,
}

/// Open an RMXP project directory.
///
/// Validates the directory structure, loads MapInfos, System, and Tilesets.
#[tauri::command]
pub async fn open_project(path: String) -> Result<ProjectInfo, String> {
    let project_path = PathBuf::from(&path);

    // Validate project structure
    let rxproj = project_path.join("Game.rxproj");
    if !rxproj.exists() {
        return Err("Not a valid RMXP project: Game.rxproj not found".to_string());
    }

    // Read Game.ini for project name
    let ini_path = project_path.join("Game.ini");
    let name = if ini_path.exists() {
        let ini_content = std::fs::read_to_string(&ini_path)
            .map_err(|e| format!("Failed to read Game.ini: {}", e))?;
        parse_ini_title(&ini_content).unwrap_or_else(|| "Untitled Project".to_string())
    } else {
        "Untitled Project".to_string()
    };

    // Load MapInfos.rxdata
    let map_infos_path = project_path.join("Data").join("MapInfos.rxdata");
    let map_infos = load_map_infos(&map_infos_path)?;

    // Load System.rxdata for edit_map_id
    let system_path = project_path.join("Data").join("System.rxdata");
    let system = load_system(&system_path)?;

    // Count tilesets
    let tilesets_path = project_path.join("Data").join("Tilesets.rxdata");
    let tileset_count = count_tilesets(&tilesets_path).unwrap_or(0);

    eprintln!("[open_project] Loaded: '{}', {} maps, {} tilesets, edit_map_id={}",
        name, map_infos.len(), tileset_count, system.edit_map_id);

    Ok(ProjectInfo {
        name,
        path,
        map_infos,
        tileset_count,
        edit_map_id: system.edit_map_id,
    })
}

/// Load a specific map by ID.
#[tauri::command]
pub async fn load_map(project_path: String, map_id: i64) -> Result<MapRenderData, String> {
    let path = PathBuf::from(&project_path);
    let map_file = path
        .join("Data")
        .join(format!("Map{:03}.rxdata", map_id));

    if !map_file.exists() {
        return Err(format!("Map file not found: Map{:03}.rxdata", map_id));
    }

    eprintln!("[load_map] Loading Map{:03}...", map_id);
    let value = marshal::load_file(&map_file)
        .map_err(|e| {
            eprintln!("[load_map] Marshal parse error for Map{:03}: {}", map_id, e);
            format!("Failed to parse map: {}", e)
        })?;

    eprintln!("[load_map] Parsed Map{:03} OK: {}", map_id, value);

    let map = RpgMap::from_ruby_value(&value)
        .ok_or_else(|| {
            eprintln!("[load_map] Failed to interpret Map{:03} as RPG::Map", map_id);
            "Failed to interpret map data".to_string()
        })?;

    eprintln!("[load_map] Map{:03}: {}x{}, tileset={}, events={}",
        map_id, map.width, map.height, map.tileset_id, map.events.len());

    // Debug: print raw Table info
    eprintln!("[load_map] Table dims: {}x{}x{}, data_len={}, sample={:?}",
        map.data.x_size, map.data.y_size, map.data.z_size,
        map.data.data.len(),
        &map.data.data[..std::cmp::min(20, map.data.data.len())]);

    // RpgMap::from_ruby_value has validated the three XP Table dimensions
    // and element count before allocating. Table storage is already in the
    // exact z/y/x layer order consumed by the frontend.
    let tiles = map.data.data.clone();

    // Debug: count non-zero tiles per layer + tile type distribution
    let layer_size = (map.width * map.height) as usize;
    for z in 0..3 {
        let start = z * layer_size;
        let end = start + layer_size;
        let nonzero = tiles[start..end].iter().filter(|&&t| t > 0).count();
        let autotile_count = tiles[start..end].iter().filter(|&&t| t >= 48 && t < 384).count();
        let regular_count = tiles[start..end].iter().filter(|&&t| t >= 384).count();
        let unknown_count = tiles[start..end].iter().filter(|&&t| t > 0 && t < 48).count();
        eprintln!("[load_map] Layer {}: {}/{} non-zero (autotile={}, regular={}, unknown_1-47={}), sample={:?}",
            z, nonzero, layer_size, autotile_count, regular_count, unknown_count,
            &tiles[start..std::cmp::min(start + 10, end)]);
        if autotile_count > 0 {
            let at_samples: Vec<i16> = tiles[start..end].iter()
                .filter(|&&t| t >= 48 && t < 384)
                .take(20)
                .copied()
                .collect();
            eprintln!("[load_map] Layer {} autotile IDs sample: {:?}", z, at_samples);
        }
    }

    // Extract event info
    let events: Vec<EventInfo> = event_infos(&map);

    Ok(MapRenderData {
        id: map_id,
        width: map.width,
        height: map.height,
        tileset_id: map.tileset_id,
        tiles,
        events,
    })
}

/// Load tileset information for the palette.
#[tauri::command]
pub async fn load_tileset(
    project_path: String,
    tileset_id: i64,
) -> Result<TilesetRenderInfo, String> {
    let path = PathBuf::from(&project_path);
    let tilesets_path = path.join("Data").join("Tilesets.rxdata");

    eprintln!("[load_tileset] Loading tileset {}...", tileset_id);
    let value = marshal::load_file(&tilesets_path)
        .map_err(|e| {
            eprintln!("[load_tileset] Marshal parse error: {}", e);
            format!("Failed to parse Tilesets.rxdata: {}", e)
        })?;

    let arr = value
        .as_array()
        .ok_or_else(|| {
            eprintln!("[load_tileset] Tilesets.rxdata top-level is {}, not array", value);
            "Tilesets.rxdata is not an array".to_string()
        })?;

    // Tilesets array is 1-indexed (index 0 is nil)
    let tileset_value = arr
        .get(tileset_id as usize)
        .ok_or_else(|| format!("Tileset {} not found", tileset_id))?;

    eprintln!("[load_tileset] Tileset {} value: {}", tileset_id, tileset_value);
    let tileset = RpgTileset::from_ruby_value(tileset_value)
        .ok_or_else(|| {
            eprintln!("[load_tileset] Failed to interpret tileset {} as RPG::Tileset", tileset_id);
            "Failed to interpret tileset data".to_string()
        })?;
    eprintln!("[load_tileset] Tileset {}: name='{}', tileset_name='{}', autotiles={:?}",
        tileset_id, tileset.name, tileset.tileset_name, tileset.autotile_names);

    // Convert Table data to flat Vec<i16> for frontend
    let passages: Vec<i16> = (0..tileset.passages.x_size)
        .map(|i| tileset.passages.get(i, 0, 0))
        .collect();
    let priorities: Vec<i16> = (0..tileset.priorities.x_size)
        .map(|i| tileset.priorities.get(i, 0, 0))
        .collect();
    let terrain_tags: Vec<i16> = (0..tileset.terrain_tags.x_size)
        .map(|i| tileset.terrain_tags.get(i, 0, 0))
        .collect();

    Ok(TilesetRenderInfo {
        id: tileset.id,
        name: tileset.name,
        tileset_name: tileset.tileset_name,
        autotile_names: tileset.autotile_names,
        passages,
        priorities,
        terrain_tags,
    })
}

/// Get the file path for any project asset (graphics or audio).
#[tauri::command]
pub async fn get_asset_path(
    project_path: String,
    asset_type: String,
    asset_name: String,
) -> Result<String, String> {
    // asset_name comes from the (untrusted) frontend; reject path traversal.
    crate::commands::util::validate_asset_name(&asset_name)?;
    let project = PathBuf::from(&project_path);

    let (base_dir, dir, extensions) = crate::commands::util::asset_dirs(&asset_type)
        .ok_or_else(|| format!("Unknown asset type: {}", asset_type))?;

    let base_path = project.join(base_dir).join(dir).join(&asset_name);
    eprintln!("[get_asset_path] Looking for {}/{} at base: {:?}", asset_type, asset_name, base_path);

    for ext in extensions {
        let path = base_path.with_extension(ext);
        let exists = path.exists();
        eprintln!("[get_asset_path]   Try {:?} → exists={}", path, exists);
        if exists {
            eprintln!("[get_asset_path] ✓ Found: {:?}", path);
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    // Try without extension (file might already have one)
    if base_path.exists() {
        eprintln!("[get_asset_path] ✓ Found (no ext): {:?}", base_path);
        return Ok(base_path.to_string_lossy().into_owned());
    }

    eprintln!("[get_asset_path] ✗ Not found: {}/{}", asset_type, asset_name);
    Err(format!(
        "Asset not found: {}/{}",
        asset_type, asset_name
    ))
}

/// List all asset filenames in a given asset directory (without extensions).
/// Returns sorted Vec of asset names.
#[tauri::command]
pub async fn list_asset_files(
    project_path: String,
    asset_type: String,
) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&project_path);

    // Determine base directory and subdirectory, plus valid extensions
    let (base_dir, dir, extensions) = crate::commands::util::asset_dirs(&asset_type)
        .ok_or_else(|| format!("Unknown asset type: {}", asset_type))?;

    let dir_path = base.join(base_dir).join(dir);
    if !dir_path.exists() {
        return Ok(Vec::new());
    }

    let mut names: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if extensions.contains(&ext.to_lowercase().as_str()) {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        names.push(stem.to_string());
                    }
                }
            }
        }
    }

    names.sort();
    Ok(names)
}

/// Load the full event data for a specific event on a map.
/// Returns the complete RPG::Event with all pages and commands.
#[tauri::command]
pub async fn load_event(
    project_path: String,
    map_id: i64,
    event_id: i64,
) -> Result<RpgEvent, String> {
    let path = PathBuf::from(&project_path);
    let map_file = path
        .join("Data")
        .join(format!("Map{:03}.rxdata", map_id));

    let value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to parse map: {}", e))?;

    let map = RpgMap::from_ruby_value(&value)
        .ok_or_else(|| "Failed to interpret map data".to_string())?;

    map.events
        .get(&event_id)
        .cloned()
        .ok_or_else(|| format!("Event {} not found on map {}", event_id, map_id))
}

/// Save a modified event back to its map file.
///
/// Receives the full RpgEvent from the frontend and writes it back
/// into the original .rxdata file, replacing the event in the events hash.
#[tauri::command]
pub async fn save_event(
    project_path: String,
    map_id: i64,
    event: RpgEvent,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    let map_file = path
        .join("Data")
        .join(format!("Map{:03}.rxdata", map_id));

    if !map_file.exists() {
        return Err(format!("Map file not found: Map{:03}.rxdata", map_id));
    }

    // Read the original map data
    let mut value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to read map: {}", e))?;

    // Find the @events ivar (a Hash of Integer → RPG::Event) and replace the target event
    let mut found_events_hash = false;
    let mut replaced = false;
    if let marshal::types::RubyValue::Object(ref mut obj) = value {
        for (name, val) in obj.instance_vars.iter_mut() {
            if name == "@events" {
                if let marshal::types::RubyValue::Hash(ref mut pairs) = val {
                    found_events_hash = true;
                    // Find the matching event by ID key
                    for (key, event_val) in pairs.iter_mut() {
                        if let Some(id) = key.as_int() {
                            if id == event.id {
                                *event_val = super::event_merge::preserve_unedited_event_fields(event_val, &event.to_ruby_value());
                                replaced = true;
                                break;
                            }
                        }
                    }
                    // Event id not present yet (e.g. created client-side): insert it
                    // rather than silently dropping the edit.
                    if !replaced {
                        pairs.push((
                            marshal::types::RubyValue::Integer(event.id),
                            event.to_ruby_value(),
                        ));
                    }
                }
                break;
            }
        }
    }

    if !found_events_hash {
        return Err(format!(
            "Could not locate @events hash on Map{:03}; save aborted to avoid corrupting the file",
            map_id
        ));
    }

    // Write back to file
    marshal::dump_file(&map_file, &value)
        .map_err(|e| format!("Failed to save map: {}", e))?;

    Ok(())
}

/// Create a new event on a map at position (x, y).
/// Returns the created event (with auto-assigned ID) and the updated event list.
#[tauri::command]
pub async fn create_event(
    project_path: String,
    map_id: i64,
    x: i64,
    y: i64,
) -> Result<(RpgEvent, Vec<EventInfo>), String> {
    let path = PathBuf::from(&project_path);
    let map_file = path
        .join("Data")
        .join(format!("Map{:03}.rxdata", map_id));

    let mut value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to read map: {}", e))?;

    let map = RpgMap::from_ruby_value(&value)
        .ok_or_else(|| "Failed to interpret map data".to_string())?;

    if x < 0 || y < 0 || x >= map.width || y >= map.height {
        return Err(format!("Event position ({x},{y}) is outside map {}x{}", map.width, map.height));
    }

    // A malformed or exhausted event-ID space must never wrap into another ID.
    let new_id = map.events.keys().max().copied().unwrap_or(0)
        .checked_add(1).filter(|id| *id > 0)
        .ok_or("Cannot allocate a valid event ID")?;

    // Build default event with one blank page
    let new_event = RpgEvent {
        id: new_id,
        name: format!("EV{:03}", new_id),
        x,
        y,
        pages: vec![EventPage {
            condition: EventCondition::default(),
            graphic: EventGraphic::default(),
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
                code: 0,
                indent: 0,
                parameters: vec![],
            }],
        }],
    };

    // Do not report success or write an unchanged map if @events is absent,
    // malformed, or the new ID already exists.
    mutate_event_hash(&mut value, new_id, Some(new_event.to_ruby_value()))?;

    marshal::dump_file(&map_file, &value)
        .map_err(|e| format!("Failed to save map: {}", e))?;

    // Re-read the map to get updated events list for frontend
    let updated_value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to re-read map: {}", e))?;
    let updated_map = RpgMap::from_ruby_value(&updated_value)
        .ok_or_else(|| "Failed to interpret updated map".to_string())?;

    let events: Vec<EventInfo> = event_infos(&updated_map);

    eprintln!("[create_event] Created event {} at ({},{}) on map {}", new_id, x, y, map_id);
    Ok((new_event, events))
}

/// Delete an event from a map. Returns the updated event list.
#[tauri::command]
pub async fn delete_event(
    project_path: String,
    map_id: i64,
    event_id: i64,
) -> Result<Vec<EventInfo>, String> {
    let path = PathBuf::from(&project_path);
    let map_file = path
        .join("Data")
        .join(format!("Map{:03}.rxdata", map_id));

    let mut value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to read map: {}", e))?;

    // Reject missing IDs or malformed hashes instead of claiming deletion.
    mutate_event_hash(&mut value, event_id, None)?;

    marshal::dump_file(&map_file, &value)
        .map_err(|e| format!("Failed to save map: {}", e))?;

    // Re-read to get updated events list
    let updated_value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to re-read map: {}", e))?;
    let updated_map = RpgMap::from_ruby_value(&updated_value)
        .ok_or_else(|| "Failed to interpret updated map".to_string())?;

    let events: Vec<EventInfo> = event_infos(&updated_map);

    eprintln!("[delete_event] Deleted event {} from map {}", event_id, map_id);
    Ok(events)
}

/// Insert or remove a single event in the original Marshal @events hash.
/// Return an error before touching disk if the requested mutation cannot be
/// applied; never silently acknowledge a no-op as a successful edit.
fn mutate_event_hash(
    map: &mut marshal::types::RubyValue,
    event_id: i64,
    replacement: Option<marshal::types::RubyValue>,
) -> Result<(), String> {
    use marshal::types::RubyValue;
    if event_id <= 0 {
        return Err("Event ID must be positive".into());
    }
    let RubyValue::Object(map_object) = map else {
        return Err("Map is not a Ruby object".into());
    };
    if map_object.class_name != "RPG::Map" {
        return Err("Expected an RPG::Map object".into());
    }
    let (_, events) = map_object.instance_vars.iter_mut()
        .find(|(name, _)| name == "@events")
        .ok_or("Map has no @events hash")?;
    let RubyValue::Hash(pairs) = events else {
        return Err("Map @events is not a Ruby hash".into());
    };
    // Ruby Hash data may be malformed or manually edited to contain duplicate
    // serialized keys. Removing only the first match would report success while
    // leaving the event present. Refuse ambiguous mutations without writing.
    let mut matches = pairs.iter().enumerate()
        .filter(|(_, (key, _))| key.as_int() == Some(event_id))
        .map(|(index, _)| index);
    let position = matches.next();
    if matches.next().is_some() {
        return Err(format!("Event {event_id} has duplicate Marshal hash keys"));
    }
    match (replacement, position) {
        (Some(event), None) => pairs.push((RubyValue::Integer(event_id), event)),
        (Some(_), Some(_)) => return Err(format!("Event {event_id} already exists")),
        (None, Some(index)) => { pairs.remove(index); }
        (None, None) => return Err(format!("Event {event_id} does not exist")),
    }
    Ok(())
}

#[cfg(test)]
mod event_mutation_safety_tests {
    use super::*;
    use marshal::types::RubyValue;

    #[test]
    fn insertion_and_deletion_change_only_the_target_event_hash() {
        let mut map = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        let before = map.clone();
        mutate_event_hash(&mut map, 7, Some(RubyValue::Integer(99))).unwrap();
        let events = map.as_object().unwrap().get("events").unwrap().as_hash().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], (RubyValue::Integer(7), RubyValue::Integer(99)));
        assert!(mutate_event_hash(&mut map, 7, Some(RubyValue::Integer(1))).is_err());
        mutate_event_hash(&mut map, 7, None).unwrap();
        assert_eq!(map, before, "unrelated map fields changed");
    }

    #[test]
    fn duplicate_event_keys_reject_deletion_and_insertion_without_mutating_map() {
        let mut map = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        if let RubyValue::Object(ref mut obj) = map {
            let (_, events) = obj.instance_vars.iter_mut()
                .find(|(name, _)| name == "@events").unwrap();
            let RubyValue::Hash(pairs) = events else { panic!("expected event hash") };
            pairs.push((RubyValue::Integer(7), RubyValue::Integer(10)));
            pairs.push((RubyValue::Integer(7), RubyValue::Integer(11)));
        }
        let original = map.clone();
        let delete_error = mutate_event_hash(&mut map, 7, None).unwrap_err();
        assert!(delete_error.contains("duplicate"), "{delete_error}");
        assert_eq!(map, original, "ambiguous delete must not modify map");
        let insert_error = mutate_event_hash(&mut map, 7, Some(RubyValue::Nil)).unwrap_err();
        assert!(insert_error.contains("duplicate"), "{insert_error}");
        assert_eq!(map, original, "ambiguous insert must not modify map");
    }

    #[test]
    fn missing_event_or_corrupt_hash_never_reports_success() {
        let mut map = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        let original = map.clone();
        assert!(mutate_event_hash(&mut map, 1, None).is_err());
        assert!(mutate_event_hash(&mut map, 0, Some(RubyValue::Nil)).is_err());
        assert_eq!(map, original);
        if let RubyValue::Object(ref mut obj) = map {
            let (_, events) = obj.instance_vars.iter_mut()
                .find(|(name, _)| name == "@events").unwrap();
            *events = RubyValue::Nil;
        }
        let corrupt = map.clone();
        assert!(mutate_event_hash(&mut map, 1, Some(RubyValue::Nil)).is_err());
        assert!(mutate_event_hash(&mut map, 1, None).is_err());
        assert_eq!(map, corrupt);
    }
}

/// Apply a targeted edit to the original XP Table without rebuilding the
/// surrounding Ruby object. Never silently change map dimensions or discard
/// unknown trailing bytes from a custom Table payload.
fn replace_map_tile_data(
    value: &mut marshal::types::RubyValue,
    tiles: &[i16],
    width: i64,
    height: i64,
) -> Result<(), String> {
    let (w, h, expected) = crate::models::map::checked_map_tile_dimensions(width, height)
        .ok_or("Map dimensions are invalid or exceed the XP editor cell limit")?;
    let (w, h) = (w as usize, h as usize);
    if tiles.len() != expected {
        return Err(format!("Tile count {} does not match {}x{}x3 = {}",
            tiles.len(), width, height, expected));
    }

    let marshal::types::RubyValue::Object(obj) = value else {
        return Err("Map data is not a Ruby object".into());
    };
    if obj.class_name != "RPG::Map" ||
        obj.get_int("width") != Some(width) ||
        obj.get_int("height") != Some(height) {
        return Err("Map dimensions differ from saved XP map; reload before editing".into());
    }
    let (_, raw) = obj.instance_vars.iter_mut()
        .find(|(name, _)| name == "@data")
        .ok_or("Map has no @data Table")?;
    let marshal::types::RubyValue::UserDefined { class_name, data } = raw else {
        return Err("Map @data is not an XP Table".into());
    };
    if class_name != "Table" {
        return Err("Map @data has an unexpected Ruby class".into());
    }
    let table = Table::from_bytes(data).ok_or("Map Table binary is invalid")?;
    if table.x_size as usize != w ||
        table.y_size as usize != h ||
        table.z_size != 3 ||
        table.data.len() != expected {
        return Err("Map Table dimensions/count disagree with the map header".into());
    }
    // XP Table's i16 cells begin at byte 20 in z/y/x order. Mutating only
    // those cells preserves the original header and any extension payload.
    for (i, tile) in tiles.iter().enumerate() {
        let offset = 20 + i * 2;
        data[offset..offset + 2].copy_from_slice(&tile.to_le_bytes());
    }
    Ok(())
}

/// Save the three tile layers while preserving the original map events,
/// metadata, Ruby instance variables and custom Table extension bytes.
#[tauri::command]
pub async fn save_map(
    project_path: String,
    map_id: i64,
    tiles: Vec<i16>,
    width: i64,
    height: i64,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    let map_file = path.join("Data").join(format!("Map{:03}.rxdata", map_id));
    if !map_file.exists() {
        return Err(format!("Map file not found: Map{:03}.rxdata", map_id));
    }
    let mut value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to read map: {e}"))?;
    replace_map_tile_data(&mut value, &tiles, width, height)?;
    marshal::dump_file(&map_file, &value)
        .map_err(|e| format!("Failed to save map: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod map_tile_fidelity_tests {
    use super::*;

    #[test]
    fn targeted_layer_edit_preserves_custom_map_fields_and_table_extension_bytes() {
        let mut original = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        let marshal::types::RubyValue::Object(ref mut obj) = original else { panic!("map object") };
        obj.instance_vars.push(("@custom".into(), marshal::types::RubyValue::Symbol("keep".into())));
        let (_, raw) = obj.instance_vars.iter_mut().find(|(name, _)| name == "@data").unwrap();
        let marshal::types::RubyValue::UserDefined { data, .. } = raw else { panic!("Table") };
        data.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let mut tiles = vec![0i16; 12];
        tiles[0] = 384;
        tiles[4] = 48;
        tiles[8] = 1024;
        tiles[11] = 2047;
        replace_map_tile_data(&mut original, &tiles, 2, 2).unwrap();
        let reloaded = marshal::load(&marshal::dump(&original).unwrap()).unwrap();
        let obj = reloaded.as_object().unwrap();
        assert_eq!(obj.get("custom"), Some(&marshal::types::RubyValue::Symbol("keep".into())));
        let marshal::types::RubyValue::UserDefined { data, .. } = obj.get("data").unwrap() else { panic!("Table") };
        assert!(data.ends_with(&[0xde, 0xad, 0xbe, 0xef]));
        let map = RpgMap::from_ruby_value(&reloaded).unwrap();
        assert_eq!(map.data.data, tiles);
    }

    #[test]
    fn refuses_dimension_mismatch_or_corrupt_table_without_mutating_map() {
        let original = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        let mut value = original.clone();
        assert!(replace_map_tile_data(&mut value, &[1; 12], 3, 2).is_err());
        assert_eq!(value, original);
        assert!(replace_map_tile_data(&mut value, &[1; 11], 2, 2).is_err());
        assert_eq!(value, original);
        let marshal::types::RubyValue::Object(ref mut obj) = value else { panic!("map") };
        let (_, raw) = obj.instance_vars.iter_mut().find(|(name, _)| name == "@data").unwrap();
        *raw = marshal::types::RubyValue::Nil;
        let damaged = value.clone();
        assert!(replace_map_tile_data(&mut value, &[1; 12], 2, 2).is_err());
        assert_eq!(value, damaged);
    }
}

/// Map properties data for the properties dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapProperties {
    pub id: i64,
    pub name: String,
    pub tileset_id: i64,
    pub width: i64,
    pub height: i64,
    pub autoplay_bgm: bool,
    pub bgm_name: String,
    pub bgm_volume: i64,
    pub bgm_pitch: i64,
    pub autoplay_bgs: bool,
    pub bgs_name: String,
    pub bgs_volume: i64,
    pub bgs_pitch: i64,
    pub encounter_step: i64,
    pub scroll_type: i64,
    pub disable_dashing: bool,
    pub parallax_name: String,
    pub parallax_loop_x: bool,
    pub parallax_loop_y: bool,
    pub parallax_sx: i64,
    pub parallax_sy: i64,
    pub parallax_show: bool,
}

/// Get full map properties for the properties dialog.
#[tauri::command]
pub async fn get_map_properties(
    project_path: String,
    map_id: i64,
) -> Result<MapProperties, String> {
    let path = PathBuf::from(&project_path);
    let map_file = path.join("Data").join(format!("Map{:03}.rxdata", map_id));

    let value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to parse map: {}", e))?;
    let map = RpgMap::from_ruby_value(&value)
        .ok_or_else(|| "Failed to interpret map data".to_string())?;

    // Get map name from MapInfos
    let map_infos_path = path.join("Data").join("MapInfos.rxdata");
    let map_infos = load_map_infos(&map_infos_path)?;
    let name = map_infos.get(&map_id).map(|i| i.name.clone()).unwrap_or_default();

    Ok(MapProperties {
        id: map_id,
        name,
        tileset_id: map.tileset_id,
        width: map.width,
        height: map.height,
        autoplay_bgm: map.autoplay_bgm,
        bgm_name: map.bgm.name.clone(),
        bgm_volume: map.bgm.volume,
        bgm_pitch: map.bgm.pitch,
        autoplay_bgs: map.autoplay_bgs,
        bgs_name: map.bgs.name.clone(),
        bgs_volume: map.bgs.volume,
        bgs_pitch: map.bgs.pitch,
        encounter_step: map.encounter_step,
        scroll_type: map.scroll_type,
        disable_dashing: map.disable_dashing,
        parallax_name: map.parallax_name,
        parallax_loop_x: map.parallax_loop_x,
        parallax_loop_y: map.parallax_loop_y,
        parallax_sx: map.parallax_sx,
        parallax_sy: map.parallax_sy,
        parallax_show: map.parallax_show,
    })
}

/// Save map properties back to .rxdata files.
/// Updates both the map file and MapInfos.rxdata (for name).
#[tauri::command]
pub async fn save_map_properties(
    project_path: String,
    props: MapProperties,
) -> Result<(), String> {
    // Reject invalid dimensions before touching the source RXDATA. Casting a
    // negative dimension to u32 during Table::resize could exhaust memory.
    crate::models::map::checked_map_tile_dimensions(props.width, props.height)
        .ok_or("Map dimensions are invalid or exceed the XP editor cell limit")?;
    let path = PathBuf::from(&project_path);
    let map_file = path.join("Data").join(format!("Map{:03}.rxdata", props.id));

    // Update map file — modify instance variables on the raw RubyValue
    let mut value = marshal::load_file(&map_file)
        .map_err(|e| format!("Failed to read map: {}", e))?;
    // Check both source files before writing either one: a missing MapInfos
    // entry must not leave an edited map behind after reporting an error.
    let map_infos_path = path.join("Data").join("MapInfos.rxdata");
    let mut infos_value = marshal::load_file(&map_infos_path)
        .map_err(|e| format!("Failed to read MapInfos: {}", e))?;
    validate_map_properties_preflight(&value, &infos_value, props.id, props.width, props.height)?;

    if let marshal::types::RubyValue::Object(ref mut obj) = value {
        // Capture the original dimensions BEFORE we overwrite @width/@height below,
        // otherwise the resize check always compares a value against itself.
        let old_width = obj.instance_vars.iter()
            .find(|(n, _)| n == "@width")
            .and_then(|(_, v)| v.as_int())
            .unwrap_or(props.width);
        let old_height = obj.instance_vars.iter()
            .find(|(n, _)| n == "@height")
            .and_then(|(_, v)| v.as_int())
            .unwrap_or(props.height);

        for (name, val) in obj.instance_vars.iter_mut() {
            match name.as_str() {
                "@tileset_id" => *val = marshal::types::RubyValue::Integer(props.tileset_id),
                "@width" => *val = marshal::types::RubyValue::Integer(props.width),
                "@height" => *val = marshal::types::RubyValue::Integer(props.height),
                "@autoplay_bgm" => *val = if props.autoplay_bgm { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                "@bgm" => {
                    let bgm = AudioFile { name: props.bgm_name.clone(), volume: props.bgm_volume, pitch: props.bgm_pitch };
                    *val = bgm.to_ruby_value();
                }
                "@autoplay_bgs" => *val = if props.autoplay_bgs { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                "@bgs" => {
                    let bgs = AudioFile { name: props.bgs_name.clone(), volume: props.bgs_volume, pitch: props.bgs_pitch };
                    *val = bgs.to_ruby_value();
                }
                "@encounter_step" => *val = marshal::types::RubyValue::Integer(props.encounter_step),
                "@scroll_type" => *val = marshal::types::RubyValue::Integer(props.scroll_type),
                "@disable_dashing" => *val = if props.disable_dashing { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                "@parallax_name" => *val = marshal::types::RubyValue::String(marshal::types::RubyString::with_encoding(props.parallax_name.as_bytes().to_vec(), "UTF-8".to_string())),
                "@parallax_loop_x" => *val = if props.parallax_loop_x { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                "@parallax_loop_y" => *val = if props.parallax_loop_y { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                "@parallax_sx" => *val = marshal::types::RubyValue::Integer(props.parallax_sx),
                "@parallax_sy" => *val = marshal::types::RubyValue::Integer(props.parallax_sy),
                "@parallax_show" => *val = if props.parallax_show { marshal::types::RubyValue::True } else { marshal::types::RubyValue::False },
                _ => {}
            }
        }

        // Handle resize — rebuild the Table if dimensions changed from the original.
        if old_width != props.width || old_height != props.height {
            // Find the @data ivar and resize the table
            for (name, val) in obj.instance_vars.iter_mut() {
                if name == "@data" {
                    if let marshal::types::RubyValue::UserDefined { class_name, data } = val {
                        if class_name == "Table" {
                            if let Some(mut table) = Table::from_bytes(data) {
                                // Preserve opaque trailing bytes from custom XP Table
                                // serializers; resizing known cells must not discard them.
                                let table_bytes = 20 + table.data.len() * 2;
                                let extension = data[table_bytes..].to_vec();
                                table.resize(props.width as u32, props.height as u32, 3);
                                let mut resized = table.to_bytes();
                                resized.extend_from_slice(&extension);
                                *data = resized;
                            } else {
                                return Err("Cannot resize malformed XP Table".into());
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    marshal::dump_file(&map_file, &value)
        .map_err(|e| format!("Failed to save map: {}", e))?;

    // MapInfos was already parsed and validated before the map write.
    if let marshal::types::RubyValue::Hash(ref mut pairs) = infos_value {
        for (key, val) in pairs.iter_mut() {
            if let Some(id) = key.as_int() {
                if id == props.id {
                    if let marshal::types::RubyValue::Object(ref mut obj) = val {
                        for (name, v) in obj.instance_vars.iter_mut() {
                            if name == "@name" {
                                *v = marshal::types::RubyValue::String(
                                    marshal::types::RubyString::with_encoding(
                                        props.name.as_bytes().to_vec(),
                                        "UTF-8".to_string(),
                                    ),
                                );
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    marshal::dump_file(&map_infos_path, &infos_value)
        .map_err(|e| format!("Failed to save MapInfos: {}", e))?;

    eprintln!("[save_map_properties] Saved map {} properties", props.id);
    Ok(())
}

/// Reject invalid map/Table and MapInfos sources before the first disk write.
/// Without this check a failed resize can change @width/@height but silently
/// leave the old Table, producing an unplayable XP map.
fn validate_map_properties_preflight(
    map_value: &marshal::types::RubyValue,
    infos_value: &marshal::types::RubyValue,
    map_id: i64,
    new_width: i64,
    new_height: i64,
) -> Result<(), String> {
    use marshal::types::RubyValue;
    if map_id <= 0 {
        return Err("Invalid map ID".into());
    }
    crate::models::map::checked_map_tile_dimensions(new_width, new_height)
        .ok_or("Invalid destination map dimensions")?;
    let map = RpgMap::from_ruby_value(map_value)
        .ok_or("Cannot edit properties of a malformed XP map or Table")?;
    let obj = map_value.as_object().ok_or("Expected RPG::Map object")?;
    for field in ["@width", "@height", "@data"] {
        if !obj.instance_vars.iter().any(|(name, _)| name == field) {
            return Err(format!("Map is missing required {field}"));
        }
    }
    if map.events.values().any(|event| {
        event.x < 0 || event.y < 0 || event.x >= new_width || event.y >= new_height
    }) {
        return Err("Cannot resize map while an event would be outside the new bounds".into());
    }
    let RubyValue::Hash(pairs) = infos_value else {
        return Err("MapInfos is not a Ruby Hash".into());
    };
    let mut matching = pairs.iter().filter(|(key, _)| key.as_int() == Some(map_id));
    let (_, info) = matching.next().ok_or("Map ID is missing from MapInfos")?;
    if matching.next().is_some() {
        return Err("MapInfos contains duplicate map IDs".into());
    }
    let RubyValue::Object(info_obj) = info else {
        return Err("MapInfos entry is not a Ruby object".into());
    };
    if info_obj.class_name != "RPG::MapInfo"
        || !info_obj.instance_vars.iter().any(|(name, value)| {
            name == "@name" && matches!(value, RubyValue::String(_))
        })
    {
        return Err("MapInfos entry lacks a valid map name".into());
    }
    Ok(())
}

#[cfg(test)]
mod map_properties_preflight_tests {
    use super::*;
    use marshal::types::RubyValue;

    fn sources() -> (RubyValue, RubyValue) {
        let map = RpgMap::new_blank(2, 2, 1).to_ruby_value();
        let info = MapInfo {
            name: "Fixture".into(), parent_id: 0, order: 1,
            expanded: true, scroll_x: 0, scroll_y: 0,
        }.to_ruby_value();
        (map, RubyValue::Hash(vec![(RubyValue::Integer(1), info)]))
    }

    #[test]
    fn valid_three_layer_map_and_mapinfos_can_be_edited() {
        let (map, infos) = sources();
        assert!(validate_map_properties_preflight(&map, &infos, 1, 3, 3).is_ok());
    }

    #[test]
    fn rejects_missing_or_duplicate_mapinfos_before_map_mutation() {
        let (map, mut infos) = sources();
        assert!(validate_map_properties_preflight(&map, &RubyValue::Hash(vec![]), 1, 2, 2).is_err());
        let RubyValue::Hash(ref mut pairs) = infos else { panic!("hash") };
        pairs.push(pairs[0].clone());
        assert!(validate_map_properties_preflight(&map, &infos, 1, 2, 2).is_err());
    }

    #[test]
    fn rejects_corrupt_table_and_missing_dimensions_without_touching_sources() {
        let (mut map, infos) = sources();
        let RubyValue::Object(ref mut obj) = map else { panic!("map") };
        let (_, table) = obj.instance_vars.iter_mut().find(|(n, _)| n == "@data").unwrap();
        let RubyValue::UserDefined { ref mut data, .. } = table else { panic!("table") };
        data[12..16].copy_from_slice(&1u32.to_le_bytes());
        let before = map.clone();
        assert!(validate_map_properties_preflight(&map, &infos, 1, 4, 4).is_err());
        assert_eq!(map, before);
        let (mut map, infos) = sources();
        let RubyValue::Object(ref mut obj) = map else { panic!("map") };
        obj.instance_vars.retain(|(name, _)| name != "@width");
        assert!(validate_map_properties_preflight(&map, &infos, 1, 4, 4).is_err());
    }

    fn temp_project() -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "xp-map-properties-{}-{unique}", std::process::id()
        ));
        std::fs::create_dir_all(root.join("Data")).unwrap();
        root
    }

    fn edited_properties() -> MapProperties {
        MapProperties {
            id: 1, name: "Renamed".into(), tileset_id: 1, width: 3, height: 3,
            autoplay_bgm: false, bgm_name: String::new(), bgm_volume: 100,
            bgm_pitch: 100, autoplay_bgs: false, bgs_name: String::new(),
            bgs_volume: 100, bgs_pitch: 100, encounter_step: 30,
            scroll_type: 0, disable_dashing: false, parallax_name: String::new(),
            parallax_loop_x: false, parallax_loop_y: false, parallax_sx: 0,
            parallax_sy: 0, parallax_show: false,
        }
    }

    #[tokio::test]
    async fn malformed_mapinfos_does_not_partially_save_map_properties() {
        let root = temp_project();
        let (map, _) = sources();
        let map_path = root.join("Data/Map001.rxdata");
        marshal::dump_file(&map_path, &map).unwrap();
        marshal::dump_file(&root.join("Data/MapInfos.rxdata"), &RubyValue::Nil).unwrap();
        let before = std::fs::read(&map_path).unwrap();
        let result = save_map_properties(root.to_string_lossy().into_owned(), edited_properties()).await;
        assert!(result.is_err());
        assert_eq!(std::fs::read(&map_path).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn valid_map_property_resize_preserves_layers_and_updates_name() {
        let root = temp_project();
        let (mut map, infos) = sources();
        let RubyValue::Object(ref mut obj) = map else { panic!("map") };
        let (_, raw) = obj.instance_vars.iter_mut().find(|(n, _)| n == "@data").unwrap();
        let RubyValue::UserDefined { data, .. } = raw else { panic!("Table") };
        data.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let map_path = root.join("Data/Map001.rxdata");
        marshal::dump_file(&map_path, &map).unwrap();
        let infos_path = root.join("Data/MapInfos.rxdata");
        marshal::dump_file(&infos_path, &infos).unwrap();
        save_map_properties(root.to_string_lossy().into_owned(), edited_properties())
            .await.unwrap();
        let loaded = marshal::load_file(&map_path).unwrap();
        let resized = RpgMap::from_ruby_value(&loaded).expect("valid resized three-layer Table");
        assert_eq!((resized.width, resized.height, resized.data.z_size), (3, 3, 3));
        assert_eq!(resized.data.get(0, 0, 0), 384);
        let raw_table = loaded.as_object().unwrap().get("data").unwrap();
        let RubyValue::UserDefined { data, .. } = raw_table else { panic!("Table") };
        assert!(data.ends_with(&[0xde, 0xad, 0xbe, 0xef]));
        let updated = load_map_infos(&infos_path).unwrap();
        assert_eq!(updated.get(&1).unwrap().name, "Renamed");
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Create a new blank map. Returns the new map ID and updated map_infos.
#[tauri::command]
pub async fn create_map(
    project_path: String,
    name: String,
    parent_id: i64,
    width: i64,
    height: i64,
    tileset_id: i64,
) -> Result<(i64, HashMap<i64, MapInfo>), String> {
    // A malformed or oversized map must never be allocated or written.
    crate::models::map::checked_map_tile_dimensions(width, height)
        .ok_or("Map dimensions are invalid or exceed the XP editor cell limit")?;
    let path = PathBuf::from(&project_path);
    let map_infos_path = path.join("Data").join("MapInfos.rxdata");

    // Load current map infos to find next available ID
    let mut infos_value = marshal::load_file(&map_infos_path)
        .map_err(|e| format!("Failed to read MapInfos: {}", e))?;

    let current_infos = load_map_infos(&map_infos_path)?;
    let new_id = current_infos.keys().max().copied().unwrap_or(0) + 1;
    let max_order = current_infos.values().map(|i| i.order).max().unwrap_or(0) + 1;

    // Create blank map .rxdata
    let blank_map = RpgMap::new_blank(width, height, tileset_id);
    let map_file = path.join("Data").join(format!("Map{:03}.rxdata", new_id));
    marshal::dump_file(&map_file, &blank_map.to_ruby_value())
        .map_err(|e| format!("Failed to create map file: {}", e))?;

    // Add to MapInfos
    let new_info = MapInfo {
        name: name.clone(),
        parent_id,
        order: max_order,
        expanded: false,
        scroll_x: 0,
        scroll_y: 0,
    };

    if let marshal::types::RubyValue::Hash(ref mut pairs) = infos_value {
        pairs.push((
            marshal::types::RubyValue::Integer(new_id),
            new_info.to_ruby_value(),
        ));
    }

    marshal::dump_file(&map_infos_path, &infos_value)
        .map_err(|e| format!("Failed to save MapInfos: {}", e))?;

    // Return updated map infos
    let updated_infos = load_map_infos(&map_infos_path)?;

    eprintln!("[create_map] Created Map{:03} '{}' ({}x{}, tileset={})",
        new_id, name, width, height, tileset_id);

    Ok((new_id, updated_infos))
}

/// Delete a map — removes the .rxdata file and its MapInfos entry.
/// Also reparents any children to the deleted map's parent.
#[tauri::command]
pub async fn delete_map(
    project_path: String,
    map_id: i64,
) -> Result<HashMap<i64, MapInfo>, String> {
    let path = PathBuf::from(&project_path);
    let map_infos_path = path.join("Data").join("MapInfos.rxdata");

    // Load current infos to find the parent of the deleted map
    let current_infos = load_map_infos(&map_infos_path)?;
    let parent_of_deleted = current_infos.get(&map_id).map(|i| i.parent_id).unwrap_or(0);

    // Remove map file
    let map_file = path.join("Data").join(format!("Map{:03}.rxdata", map_id));
    if map_file.exists() {
        std::fs::remove_file(&map_file)
            .map_err(|e| format!("Failed to delete map file: {}", e))?;
    }

    // Update MapInfos: remove the entry and reparent children
    let mut infos_value = marshal::load_file(&map_infos_path)
        .map_err(|e| format!("Failed to read MapInfos: {}", e))?;

    if let marshal::types::RubyValue::Hash(ref mut pairs) = infos_value {
        // Remove the entry
        pairs.retain(|(key, _)| key.as_int() != Some(map_id));

        // Reparent children
        for (_, val) in pairs.iter_mut() {
            if let marshal::types::RubyValue::Object(ref mut obj) = val {
                for (name, v) in obj.instance_vars.iter_mut() {
                    if name == "@parent_id" {
                        if let marshal::types::RubyValue::Integer(pid) = v {
                            if *pid == map_id {
                                *pid = parent_of_deleted;
                            }
                        }
                    }
                }
            }
        }
    }

    marshal::dump_file(&map_infos_path, &infos_value)
        .map_err(|e| format!("Failed to save MapInfos: {}", e))?;

    let updated_infos = load_map_infos(&map_infos_path)?;
    eprintln!("[delete_map] Deleted Map{:03}", map_id);
    Ok(updated_infos)
}

/// Rename a map in MapInfos.rxdata.
#[tauri::command]
pub async fn rename_map(
    project_path: String,
    map_id: i64,
    new_name: String,
) -> Result<(), String> {
    let path = PathBuf::from(&project_path);
    let map_infos_path = path.join("Data").join("MapInfos.rxdata");

    let mut infos_value = marshal::load_file(&map_infos_path)
        .map_err(|e| format!("Failed to read MapInfos: {}", e))?;

    if let marshal::types::RubyValue::Hash(ref mut pairs) = infos_value {
        for (key, val) in pairs.iter_mut() {
            if key.as_int() == Some(map_id) {
                if let marshal::types::RubyValue::Object(ref mut obj) = val {
                    for (name, v) in obj.instance_vars.iter_mut() {
                        if name == "@name" {
                            *v = marshal::types::RubyValue::String(
                                marshal::types::RubyString::with_encoding(
                                    new_name.as_bytes().to_vec(),
                                    "UTF-8".to_string(),
                                ),
                            );
                        }
                    }
                }
                break;
            }
        }
    }

    marshal::dump_file(&map_infos_path, &infos_value)
        .map_err(|e| format!("Failed to save MapInfos: {}", e))?;

    Ok(())
}

// --- Internal helpers ---

/// Build the lightweight `EventInfo` list for the map editor overlay from a map.
fn event_infos(map: &RpgMap) -> Vec<EventInfo> {
    map.events
        .values()
        .map(|e| {
            let (graphic_name, graphic_dir, graphic_pattern) =
                if let Some(page) = e.pages.first() {
                    (
                        page.graphic.character_name.clone(),
                        page.graphic.direction,
                        page.graphic.pattern,
                    )
                } else {
                    (String::new(), 2, 0)
                };

            EventInfo {
                id: e.id,
                name: e.name.clone(),
                x: e.x,
                y: e.y,
                page_count: e.pages.len(),
                graphic_name,
                graphic_direction: graphic_dir,
                graphic_pattern,
            }
        })
        .collect()
}

fn parse_ini_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("Title=") {
            return Some(line[6..].to_string());
        }
    }
    None
}

fn load_map_infos(path: &Path) -> Result<HashMap<i64, MapInfo>, String> {
    let value = marshal::load_file(path)
        .map_err(|e| format!("Failed to parse MapInfos.rxdata: {}", e))?;

    let pairs = value
        .as_hash()
        .ok_or_else(|| "MapInfos.rxdata is not a hash".to_string())?;

    let mut infos = HashMap::new();
    for (key, val) in pairs {
        if let Some(id) = key.as_int() {
            if let Some(info) = MapInfo::from_ruby_value(val) {
                infos.insert(id, info);
            }
        }
    }

    Ok(infos)
}

fn load_system(path: &Path) -> Result<RpgSystem, String> {
    let value = marshal::load_file(path)
        .map_err(|e| format!("Failed to parse System.rxdata: {}", e))?;

    RpgSystem::from_ruby_value(&value)
        .ok_or_else(|| "Failed to interpret System data".to_string())
}

fn count_tilesets(path: &Path) -> Option<usize> {
    let value = marshal::load_file(path).ok()?;
    let arr = value.as_array()?;
    Some(arr.len().saturating_sub(1)) // First element is nil
}

/// List all tileset names (id → name).
#[tauri::command]
pub async fn list_tileset_names(project_path: String) -> Result<Vec<(i64, String)>, String> {
    let path = PathBuf::from(&project_path);
    let tilesets_path = path.join("Data").join("Tilesets.rxdata");

    let value = marshal::load_file(&tilesets_path)
        .map_err(|e| format!("Failed to parse Tilesets.rxdata: {}", e))?;
    let arr = value
        .as_array()
        .ok_or_else(|| "Tilesets.rxdata is not an array".to_string())?;

    let mut result = Vec::new();
    // Index 0 is nil, tilesets start at index 1
    for (i, item) in arr.iter().enumerate().skip(1) {
        if let marshal::types::RubyValue::Object(ref obj) = item {
            let name = obj
                .get("@name")
                .and_then(|v| v.as_string())
                .unwrap_or_default();
            result.push((i as i64, name));
        }
    }
    Ok(result)
}
