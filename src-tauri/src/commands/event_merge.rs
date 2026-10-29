//! Preserve opaque RPG Maker XP / Pokémon Essentials Marshal extension data
//! when the frontend edits a known event field. The frontend's typed RpgEvent
//! model does not represent every possible Ruby instance variable.
use crate::marshal::types::{RubyObject, RubyValue};

/// Merge edited, typed event data with the existing raw Marshal value.
/// Recognised fields receive the edited value. Unknown Ruby ivars survive.
/// Array deletions remain deletions; old items cannot reappear implicitly.
pub(crate) fn preserve_unedited_event_fields(original: &RubyValue, edited: &RubyValue) -> RubyValue {
    if original == edited {
        return original.clone();
    }
    // A binary or typed value may have been represented as a lossy JSON
    // placeholder. If its JSON representation was not changed by the user,
    // retain the exact original Ruby string/symbol/opaque payload.
    if matches!(original, RubyValue::String(_) | RubyValue::Symbol(_) | RubyValue::UserDefined { .. } | RubyValue::UserMarshal { .. })
        && original.to_json_value() == edited.to_json_value()
    {
        return original.clone();
    }
    match (original, edited) {
        (RubyValue::Object(previous), RubyValue::Object(current))
            if previous.class_name == current.class_name
                && command_identity_unchanged(previous, current) =>
        {
            let mut result = current.clone();
            for (name, old_value) in &previous.instance_vars {
                if let Some((_, new_value)) = result.instance_vars.iter_mut().find(|(n, _)| n == name) {
                    *new_value = preserve_unedited_event_fields(old_value, new_value);
                } else {
                    // This is an extension ivar absent from the typed editor.
                    result.instance_vars.push((name.clone(), old_value.clone()));
                }
            }
            RubyValue::Object(result)
        }
        (RubyValue::Array(previous), RubyValue::Array(current)) => {
            // Event pages and commands can be inserted or reordered. Blindly
            // merging by array index attaches opaque Ruby ivars to a different
            // page/command (potentially changing gameplay behaviour).
            if previous.iter().chain(current.iter()).any(is_event_sequence_item) {
                return merge_event_sequence(previous, current);
            }
            RubyValue::Array(current.iter().enumerate().map(|(i, item)| {
                previous.get(i)
                    .map(|old| preserve_unedited_event_fields(old, item))
                    .unwrap_or_else(|| item.clone())
            }).collect())
        }
        _ => edited.clone(),
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

fn merge_event_sequence(previous: &[RubyValue], current: &[RubyValue]) -> RubyValue {
    let mut used = vec![false; previous.len()];
    let mut matched = vec![None; current.len()];
    // Only transfer opaque fields when there is one unambiguous old record
    // with identical visible content. This also handles page/command moves.
    for (new_index, item) in current.iter().enumerate() {
        let candidates: Vec<usize> = previous.iter().enumerate()
            .filter(|(index, old)| !used[*index] && same_visible_fields(old, item))
            .map(|(index, _)| index)
            .collect();
        if candidates.len() == 1 {
            let old_index = candidates[0];
            used[old_index] = true;
            matched[new_index] = Some(old_index);
        }
    }
    let moved = matched.iter().enumerate()
        .any(|(index, match_index)| match_index.is_some_and(|old| old != index));
    RubyValue::Array(current.iter().enumerate().map(|(index, item)| {
        if let Some(old_index) = matched[index] {
            return preserve_unedited_event_fields(&previous[old_index], item);
        }
        // Preserve extension fields for ordinary in-place edits, but never
        // infer an index identity after a structural insert/delete/reorder.
        if !moved && previous.len() == current.len()
            && index < previous.len() && !used[index]
        {
            return preserve_unedited_event_fields(&previous[index], item);
        }
        item.clone()
    }).collect())
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
        let merged = preserve_unedited_event_fields(&original, &edited.to_ruby_value());
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
        let merged = preserve_unedited_event_fields(&original, &edited.to_ruby_value());
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
        let merged = preserve_unedited_event_fields(&original, &edited);
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
        let merged = preserve_unedited_event_fields(&original, &edited);
        let commands = merged.as_array().unwrap();
        assert_eq!(marker(&commands[0]), None);
        assert_eq!(marker(&commands[1]), Some(11));
        assert_eq!(marker(&commands[2]), Some(22));
    }

    #[test]
    fn editing_command_in_place_still_preserves_extension_fields() {
        let original = RubyValue::Array(vec![command(355, "old script", Some(42))]);
        let edited = RubyValue::Array(vec![command(355, "new script", None)]);
        let merged = preserve_unedited_event_fields(&original, &edited);
        let command = &merged.as_array().unwrap()[0];
        assert_eq!(marker(command), Some(42));
        let parameters = command.as_object().unwrap().get("parameters").unwrap().as_array().unwrap();
        assert_eq!(parameters[0].as_string().as_deref(), Some("new script"));
    }

    #[test]
    fn changing_command_kind_does_not_transfer_unknown_attributes() {
        let original = original_event();
        let mut edited = RpgEvent::from_ruby_value(&original).unwrap();
        edited.pages[0].list[0].code = 111;
        let merged = preserve_unedited_event_fields(&original, &edited.to_ruby_value());
        let page = &merged.as_object().unwrap().get("pages").unwrap().as_array().unwrap()[0];
        let command = &page.as_object().unwrap().get("list").unwrap().as_array().unwrap()[0];
        let command = command.as_object().unwrap();
        assert_eq!(command.get_int("code"), Some(111));
        assert!(command.get("extra_command_ivar").is_none());
    }
}
