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
            RubyValue::Array(current.iter().enumerate().map(|(i, item)| {
                previous.get(i)
                    .map(|old| preserve_unedited_event_fields(old, item))
                    .unwrap_or_else(|| item.clone())
            }).collect())
        }
        _ => edited.clone(),
    }
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
