//! Preserve opaque RPG Maker XP / Pokémon Essentials Marshal extension data
//! when the frontend edits a known event field. The frontend's typed RpgEvent
//! model does not represent every possible Ruby instance variable.
use crate::marshal::types::{RubyObject, RubyValue};
use crate::models::event::RpgEvent;

struct EventOrigins {
    pages: Vec<Option<usize>>,
    commands: Vec<Vec<Option<usize>>>,
}

/// Merge edited, typed event data with the existing raw Marshal value.
/// Recognised fields receive the edited value. Unknown Ruby ivars survive.
/// Array deletions remain deletions; old items cannot reappear implicitly.
pub(crate) fn preserve_unedited_event_fields(original: &RubyValue, edited: &RubyValue) -> Result<RubyValue, String> {
    preserve_unedited_event_fields_inner(original, edited, None, None)
}

pub(crate) fn preserve_event_fields(original: &RubyValue, edited: &RpgEvent) -> Result<RubyValue, String> {
    let origins = EventOrigins {
        pages: edited.pages.iter().map(|page| page.source_index).collect(),
        commands: edited.pages.iter()
            .map(|page| page.list.iter().map(|command| command.source_index).collect())
            .collect(),
    };
    preserve_unedited_event_fields_inner(
        original,
        &edited.to_ruby_value(),
        Some(&origins),
        None,
    )
}

fn preserve_unedited_event_fields_inner(
    original: &RubyValue,
    edited: &RubyValue,
    origins: Option<&EventOrigins>,
    page_index: Option<usize>,
) -> Result<RubyValue, String> {
    if original == edited {
        return Ok(original.clone());
    }
    // A binary or typed value may have been represented as a lossy JSON
    // placeholder. If its JSON representation was not changed by the user,
    // retain the exact original Ruby string/symbol/opaque payload.
    if matches!(original, RubyValue::String(_) | RubyValue::Symbol(_) | RubyValue::UserDefined { .. } | RubyValue::UserMarshal { .. })
        && original.to_json_value() == edited.to_json_value()
    {
        return Ok(original.clone());
    }
    match (original, edited) {
        (RubyValue::Object(previous), RubyValue::Object(current))
            if previous.class_name == current.class_name
                && command_identity_unchanged(previous, current) =>
        {
            let mut result = current.clone();
            for (name, old_value) in &previous.instance_vars {
                if let Some((_, new_value)) = result.instance_vars.iter_mut().find(|(n, _)| n == name) {
                    *new_value = preserve_unedited_event_fields_inner(
                        old_value, new_value, origins, page_index,
                    )?;
                } else {
                    // This is an extension ivar absent from the typed editor.
                    result.instance_vars.push((name.clone(), old_value.clone()));
                }
            }
            Ok(RubyValue::Object(result))
        }
        (RubyValue::Array(previous), RubyValue::Array(current)) => {
            // Event pages and commands can be inserted or reordered. Blindly
            // merging by array index attaches opaque Ruby ivars to a different
            // page/command (potentially changing gameplay behaviour).
            if previous.iter().chain(current.iter()).any(is_event_sequence_item) {
                let record_origins = if previous.iter().chain(current.iter()).any(is_event_page) {
                    origins.map(|all| all.pages.as_slice())
                } else if previous.iter().chain(current.iter()).any(is_event_command) {
                    page_index.and_then(|index| {
                        origins.and_then(|all| all.commands.get(index).map(Vec::as_slice))
                    })
                } else {
                    None
                };
                return merge_event_sequence(previous, current, record_origins, origins, page_index);
            }
            Ok(RubyValue::Array(current.iter().enumerate().map(|(i, item)| {
                previous.get(i)
                    .map(|old| preserve_unedited_event_fields_inner(
                        old,
                        item,
                        origins,
                        if is_event_page(item) { Some(i) } else { page_index },
                    ))
                    .unwrap_or_else(|| Ok(item.clone()))
            }).collect::<Result<Vec<_>, _>>()?))
        }
        _ => Ok(edited.clone()),
    }
}

/// Only these positional collections have the structural identity hazard.
/// Parameters remain positional; they are not event/page records.
fn is_event_sequence_item(value: &RubyValue) -> bool {
    matches!(value, RubyValue::Object(obj) if matches!(
        obj.class_name.as_str(),
        "RPG::Event::Page" | "RPG::EventCommand" | "RPG::MoveCommand"
    ))
}

fn is_event_page(value: &RubyValue) -> bool {
    matches!(value, RubyValue::Object(obj) if obj.class_name == "RPG::Event::Page")
}

fn is_event_command(value: &RubyValue) -> bool {
    matches!(value, RubyValue::Object(obj) if obj.class_name == "RPG::EventCommand")
}

/// Compare the fields actually represented by the typed editor, ignoring
/// unknown ivars on the original. An exact visible match can safely carry
/// its opaque fields to a new position.
fn same_visible_fields(original: &RubyValue, edited: &RubyValue) -> bool {
    match (original, edited) {
        (RubyValue::Object(old), RubyValue::Object(new)) if old.class_name == new.class_name => {
            new.instance_vars.iter().all(|(name, value)| {
                old.instance_vars.iter().find(|(key, _)| key == name)
                    .is_some_and(|(_, old_value)| same_visible_fields(old_value, value))
            })
        }
        (RubyValue::Array(old), RubyValue::Array(new)) => {
            old.len() == new.len()
                && old.iter().zip(new).all(|(a, b)| same_visible_fields(a, b))
        }
        _ => original.to_json_value() == edited.to_json_value(),
    }
}

/// Does the typed editor omit any original Ruby ivars? This includes nested
/// extensions on event pages, routes and commands, not just top-level markers.
fn has_unrepresented_fields(original: &RubyValue, edited: &RubyValue) -> bool {
    match (original, edited) {
        (RubyValue::Object(old), RubyValue::Object(new)) if old.class_name == new.class_name => {
            old.instance_vars.iter().any(|(name, value)| {
                match new.instance_vars.iter().find(|(other, _)| other == name) {
                    Some((_, current)) => has_unrepresented_fields(value, current),
                    None => true,
                }
            })
        }
        (RubyValue::Array(old), RubyValue::Array(new)) => old.iter().zip(new)
            .any(|(a, b)| has_unrepresented_fields(a, b)),
        _ => false,
    }
}

fn same_record_kind(original: &RubyValue, edited: &RubyValue) -> bool {
    matches!((original, edited),
        (RubyValue::Object(old), RubyValue::Object(new))
            if old.class_name == new.class_name && command_identity_unchanged(old, new))
}

fn merge_event_sequence(
    previous: &[RubyValue],
    current: &[RubyValue],
    record_origins: Option<&[Option<usize>]>,
    origins: Option<&EventOrigins>,
    page_index: Option<usize>,
) -> Result<RubyValue, String> {
    // No visible sequence edit: retain original positional identity even if
    // two indistinguishable commands have different opaque extension fields.
    // Otherwise a simple event-name save could reject a valid legacy map.
    if record_origins.is_none()
        && previous.len() == current.len()
        && previous.iter().zip(current).all(|(old, new)| same_visible_fields(old, new))
    {
        return Ok(RubyValue::Array(previous.iter().zip(current)
            .enumerate()
            .map(|(index, (old, new))| preserve_unedited_event_fields_inner(
                old,
                new,
                origins,
                if is_event_page(new) { Some(index) } else { page_index },
            ))
            .collect::<Result<Vec<_>, _>>()?));
    }
    let mut used = vec![false; previous.len()];
    let mut matched = vec![None; current.len()];
    let mut claimed_origins = vec![false; previous.len()];
    // Loaded event commands carry their original list index through frontend
    // edits. New commands have no origin and cannot inherit opaque fields.
    for (new_index, item) in current.iter().enumerate() {
        if let Some(record_origins) = record_origins {
            if let Some(Some(old_index)) = record_origins.get(new_index) {
                if *old_index >= previous.len() {
                    return Err("Invalid event command origin; save aborted".into());
                }
                if claimed_origins[*old_index] {
                    return Err("Duplicate event command origin; save aborted".into());
                }
                claimed_origins[*old_index] = true;
                if same_record_kind(&previous[*old_index], item) {
                    used[*old_index] = true;
                    matched[new_index] = Some(*old_index);
                }
            }
            continue;
        }

        // Without command origins, only unique unchanged records can be
        // matched. Edited/replacement commands are ambiguous and fail closed.
        let candidates: Vec<usize> = previous.iter().enumerate()
            .filter(|(_, old)| same_visible_fields(old, item))
            .map(|(index, _)| index)
            .collect();
        if candidates.len() == 1 {
            let old_index = candidates[0];
            let reverse_count = current.iter()
                .filter(|new| same_visible_fields(&previous[old_index], new))
                .count();
            if reverse_count == 1 {
                used[old_index] = true;
                matched[new_index] = Some(old_index);
            }
        }
    }

    let moved = matched.iter().enumerate()
        .any(|(index, match_index)| match_index.is_some_and(|old| old != index));
    let unmatched_old: Vec<usize> = used.iter().enumerate()
        .filter_map(|(index, matched)| (!matched).then_some(index))
        .collect();
    let unmatched_new: Vec<usize> = matched.iter().enumerate()
        .filter_map(|(index, old)| old.is_none().then_some(index))
        .collect();

    // A replacement without a valid origin must not inherit hidden Marshal
    // fields based on its class, code, or array position.
    if !unmatched_new.is_empty() {
        for &old_index in &unmatched_old {
            if unmatched_new.iter().any(|&new_index| {
                same_record_kind(&previous[old_index], &current[new_index])
                    && has_unrepresented_fields(&previous[old_index], &current[new_index])
            }) {
                return Err("Ambiguous event page/command replacement or reordered edit: opaque Ruby fields cannot be assigned safely; save aborted".into());
            }
        }
    }

    let mut result = Vec::with_capacity(current.len());
    for (index, item) in current.iter().enumerate() {
        let item_page_index = if is_event_page(item) { Some(index) } else { page_index };
        if let Some(old_index) = matched[index] {
            result.push(preserve_unedited_event_fields_inner(
                &previous[old_index], item, origins, item_page_index,
            )?);
        } else if !moved && previous.len() == current.len()
            && index < previous.len() && !used[index]
            && same_record_kind(&previous[index], item)
        {
            result.push(preserve_unedited_event_fields_inner(
                &previous[index], item, origins, item_page_index,
            )?);
        } else {
            result.push(item.clone());
        }
    }
    Ok(RubyValue::Array(result))
}

fn command_identity_unchanged(previous: &RubyObject, current: &RubyObject) -> bool {
    if previous.class_name == "RPG::EventCommand" || previous.class_name == "RPG::MoveCommand" {
        previous.get_int("code") == current.get_int("code")
    } else {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event::RpgEvent;
    use crate::marshal::{dump, load};
    use crate::marshal::types::RubyString;

    fn object(name: &str, attributes: Vec<(&str, RubyValue)>) -> RubyValue {
        RubyValue::Object(RubyObject {
            class_name: name.to_owned(),
            instance_vars: attributes.into_iter()
                .map(|(k, v)| (format!("@{k}"), v))
                .collect(),
        })
    }

    fn original_event() -> RubyValue {
        let command = object("RPG::EventCommand", vec![
            ("code", RubyValue::Integer(355)),
            ("indent", RubyValue::Integer(0)),
            ("parameters", RubyValue::Array(vec![RubyValue::Symbol("custom_script".into())])),
            ("extra_command_ivar", RubyValue::Integer(81)),
        ]);
        let page = object("RPG::Event::Page", vec![
            ("list", RubyValue::Array(vec![command])),
            ("extra_page_ivar", RubyValue::Integer(99)),
        ]);
        object("RPG::Event", vec![
            ("id", RubyValue::Integer(1)),
            ("name", RubyValue::String(RubyString::new(b"Old".to_vec()))),
            ("x", RubyValue::Integer(5)),
            ("y", RubyValue::Integer(6)),
            ("pages", RubyValue::Array(vec![page])),
            ("extra_event_ivar", RubyValue::Integer(42)),
        ])
    }

    #[test]
    fn editing_event_name_preserves_custom_fields_pages_commands_and_ruby_types() {
        let original = original_event();
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.name = "Renamed".into();
        let merged = preserve_event_fields(&original, &edited).unwrap();
        let event = merged.as_object().unwrap();
        assert_eq!(event.get_int("extra_event_ivar"), Some(42));
        assert_eq!(event.get_string("name").unwrap(), "Renamed");
        let pages = event.get("pages").unwrap().as_array().unwrap();
        assert_eq!(pages.len(), 1);
        let page = pages[0].as_object().unwrap();
        assert_eq!(page.get_int("extra_page_ivar"), Some(99));
        let list = page.get("list").unwrap().as_array().unwrap();
        let command = list[0].as_object().unwrap();
        assert_eq!(command.get_int("extra_command_ivar"), Some(81));
        assert_eq!(command.get("parameters").unwrap(), &RubyValue::Array(vec![RubyValue::Symbol("custom_script".into())]));
        let persisted = load(&dump(&merged).unwrap()).unwrap();
        assert_eq!(persisted, merged, "event extension fields lost during Marshal reload");
    }

    #[test]
    fn deleting_event_pages_does_not_restore_removed_pages() {
        let original = original_event();
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages.clear();
        let merged = preserve_event_fields(&original, &edited).unwrap();
        let event = merged.as_object().unwrap();
        assert!(event.get("pages").unwrap().as_array().unwrap().is_empty());
        assert_eq!(event.get_int("extra_event_ivar"), Some(42));
    }

    fn command(code: i64, text: &str, opaque: Option<i64>) -> RubyValue {
        let mut fields = vec![
            ("code", RubyValue::Integer(code)),
            ("indent", RubyValue::Integer(0)),
            ("parameters", RubyValue::Array(vec![
                RubyValue::String(RubyString::new(text.as_bytes().to_vec())),
            ])),
        ];
        if let Some(marker) = opaque {
            fields.push(("extension_marker", RubyValue::Integer(marker)));
        }
        object("RPG::EventCommand", fields)
    }

    fn marker(value: &RubyValue) -> Option<i64> {
        value.as_object().unwrap().get_int("extension_marker")
    }

    fn event_with_commands(commands: Vec<RubyValue>) -> RubyValue {
        let page = object("RPG::Event::Page", vec![
            ("list", RubyValue::Array(commands)),
        ]);
        object("RPG::Event", vec![
            ("id", RubyValue::Integer(1)),
            ("name", RubyValue::String(RubyString::new(b"Test".to_vec()))),
            ("x", RubyValue::Integer(0)),
            ("y", RubyValue::Integer(0)),
            ("pages", RubyValue::Array(vec![page])),
        ])
    }

    #[test]
    fn reordering_commands_keeps_opaque_fields_with_their_original_commands() {
        let original = RubyValue::Array(vec![
            command(101, "first", Some(11)),
            command(101, "second", Some(22)),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "second", None),
            command(101, "first", None),
        ]);
        let merged = preserve_unedited_event_fields(&original, &edited).unwrap();
        let commands = merged.as_array().unwrap();
        assert_eq!(marker(&commands[0]), Some(22));
        assert_eq!(marker(&commands[1]), Some(11));
        assert_eq!(load(&dump(&merged).unwrap()).unwrap(), merged);
    }

    #[test]
    fn inserting_command_does_not_copy_another_commands_opaque_fields() {
        let original = RubyValue::Array(vec![
            command(101, "first", Some(11)),
            command(101, "second", Some(22)),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "new", None),
            command(101, "first", None),
            command(101, "second", None),
        ]);
        let merged = preserve_unedited_event_fields(&original, &edited).unwrap();
        let commands = merged.as_array().unwrap();
        assert_eq!(marker(&commands[0]), None);
        assert_eq!(marker(&commands[1]), Some(11));
        assert_eq!(marker(&commands[2]), Some(22));
    }

    #[test]
    fn editing_command_in_place_still_preserves_extension_fields() {
        let original = event_with_commands(vec![command(355, "old script", Some(42))]);
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[0].parameters[0] = serde_json::json!("new script");
        let merged = preserve_event_fields(&original, &edited).unwrap();
        let page = &merged.as_object().unwrap().get("pages").unwrap().as_array().unwrap()[0];
        let command = &page.as_object().unwrap().get("list").unwrap().as_array().unwrap()[0];
        assert_eq!(marker(command), Some(42));
        let parameters = command.as_object().unwrap().get("parameters").unwrap().as_array().unwrap();
        assert_eq!(parameters[0].as_string().as_deref(), Some("new script"));
    }

    #[test]
    fn replacing_one_of_two_commands_without_origin_rejects_opaque_transfer() {
        let original = RubyValue::Array(vec![
            command(101, "A", Some(11)),
            command(101, "B", Some(22)),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "NEW", None),
            command(101, "B", None),
        ]);
        let result = preserve_unedited_event_fields(&original, &edited);
        assert!(result.is_err(), "replacement without an origin must be rejected");
        assert_eq!(marker(&original.as_array().unwrap()[0]), Some(11));
    }

    #[test]
    fn explicit_command_origin_preserves_opaque_fields_on_edit() {
        let original = event_with_commands(vec![
            command(101, "A", Some(11)),
            command(101, "B", Some(22)),
        ]);
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[0].parameters[0] = serde_json::json!("NEW");
        let merged = preserve_event_fields(&original, &edited).unwrap();
        let event = merged.as_object().unwrap();
        let page = &event.get("pages").unwrap().as_array().unwrap()[0];
        let commands = page.as_object().unwrap().get("list").unwrap().as_array().unwrap();
        assert_eq!(marker(&commands[0]), Some(11));
        assert_eq!(marker(&commands[1]), Some(22));
        let parameters = commands[0].as_object().unwrap()
            .get("parameters").unwrap().as_array().unwrap();
        assert_eq!(parameters[0].as_string().as_deref(), Some("NEW"));
        assert_eq!(load(&dump(&merged).unwrap()).unwrap(), merged);
    }

    #[test]
    fn duplicate_command_origins_are_rejected() {
        let original = event_with_commands(vec![
            command(101, "A", Some(11)),
            command(101, "B", Some(22)),
        ]);
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[1].source_index = Some(0);
        let error = preserve_event_fields(&original, &edited).unwrap_err();
        assert!(error.contains("Duplicate event command origin"), "{error}");
    }

    #[test]
    fn missing_command_origin_cannot_preserve_replaced_unknown_fields() {
        let original = event_with_commands(vec![
            command(101, "A", Some(11)),
            command(101, "B", Some(22)),
        ]);
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[0].source_index = None;
        edited.pages[0].list[0].parameters[0] = serde_json::json!("NEW");
        let error = preserve_event_fields(&original, &edited).unwrap_err();
        assert!(error.contains("Ambiguous event page/command"), "{error}");
    }

    #[test]
    fn moving_a_command_while_editing_it_refuses_to_drop_opaque_fields() {
        let original = RubyValue::Array(vec![
            command(101, "A", Some(11)),
            command(101, "B", Some(22)),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "B", None),
            command(101, "A edited", None),
        ]);
        assert!(preserve_unedited_event_fields(&original, &edited).is_err());
    }

    #[test]
    fn unchanged_duplicate_visible_commands_keep_positional_extensions() {
        let original = RubyValue::Array(vec![
            command(101, "same", Some(11)),
            command(101, "same", Some(22)),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "same", None),
            command(101, "same", None),
        ]);
        let merged = preserve_unedited_event_fields(&original, &edited).unwrap();
        let commands = merged.as_array().unwrap();
        assert_eq!(marker(&commands[0]), Some(11));
        assert_eq!(marker(&commands[1]), Some(22));
    }

    #[test]
    fn editing_a_typed_command_without_opaque_fields_still_succeeds() {
        let original = RubyValue::Array(vec![
            command(101, "A", None),
            command(101, "B", None),
        ]);
        let edited = RubyValue::Array(vec![
            command(101, "A edited", None),
            command(101, "B", None),
        ]);
        let merged = preserve_unedited_event_fields(&original, &edited).unwrap();
        assert_eq!(merged, edited);
    }

    #[test]
    fn changing_command_kind_does_not_transfer_unknown_attributes() {
        let original = original_event();
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[0].code = 111;
        let merged = preserve_event_fields(&original, &edited).unwrap();
        let page = &merged.as_object().unwrap().get("pages").unwrap().as_array().unwrap()[0];
        let command = &page.as_object().unwrap().get("list").unwrap().as_array().unwrap()[0];
        let command = command.as_object().unwrap();
        assert_eq!(command.get_int("code"), Some(111));
        assert!(command.get("extra_command_ivar").is_none());
    }
}
