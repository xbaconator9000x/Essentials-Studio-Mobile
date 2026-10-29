//! Independent synthetic RPG Maker XP fidelity fixture. These tests do not
//! substitute for a real Essentials v21.1 project or Android-device roundtrip.
use super::{dump, load, RubyObject, RubyString, RubyValue};
use crate::models::{map::RpgMap, table::Table};

fn object(class: &str, vars: Vec<(&str, RubyValue)>) -> RubyValue {
    RubyValue::Object(RubyObject {
        class_name: class.into(),
        instance_vars: vars.into_iter().map(|(k, v)| (format!("@{k}"), v)).collect(),
    })
}

fn script_page(code: i64, script: &str) -> RubyValue {
    object("RPG::Event::Page", vec![
        ("trigger", RubyValue::Integer(0)),
        ("list", RubyValue::Array(vec![
            object("RPG::EventCommand", vec![
                ("code", RubyValue::Integer(code)),
                ("indent", RubyValue::Integer(0)),
                ("parameters", RubyValue::Array(vec![
                    RubyValue::String(RubyString::new(script.as_bytes().to_vec())),
                ])),
                ("custom_command_field", RubyValue::Symbol("preserve_me".into())),
            ]),
        ])),
        ("custom_page_field", RubyValue::Integer(code + 1000)),
    ])
}

#[test]
fn all_three_xp_layers_and_opaque_map_event_fields_survive_targeted_tile_edit() {
    let mut map = RpgMap::new_blank(3, 2, 1);
    for z in 0..3 {
        for y in 0..2 {
            for x in 0..3 {
                // Cover normal tiles, autotiles, and the upper layer.
                map.data.set(x, y, z, [384, 48, 1024][z as usize] + (y * 3 + x) as i16);
            }
        }
    }
    let mut original = map.to_ruby_value();
    let RubyValue::Object(ref mut obj) = original else { panic!("expected RPG::Map") };
    obj.instance_vars.push((
        "@custom_map_field".into(),
        RubyValue::UserMarshal {
            class_name: "Custom::Metadata".into(),
            data: Box::new(RubyValue::Symbol("keep".into())),
        },
    ));
    let event = object("RPG::Event", vec![
        ("id", RubyValue::Integer(7)),
        ("name", RubyValue::String(RubyString::new(b"NPC".to_vec()))),
        ("x", RubyValue::Integer(1)),
        ("y", RubyValue::Integer(1)),
        ("pages", RubyValue::Array(vec![
            script_page(355, "pbMessage('first page')"),
            script_page(655, "pbMessage('second page')"),
        ])),
        ("custom_event_field", RubyValue::Integer(99)),
    ]);
    let original_events = RubyValue::Hash(vec![(RubyValue::Integer(7), event)]);
    let (_, events) = obj.instance_vars.iter_mut().find(|(k, _)| k == "@events").unwrap();
    *events = original_events.clone();

    // Simulate the actual save_map strategy: load the existing Marshal object,
    // replace only @data, and leave every other field and event page untouched.
    let before = dump(&original).unwrap();
    let mut loaded = load(&before).unwrap();
    let old_map = RpgMap::from_ruby_value(&loaded).unwrap();
    assert_eq!((old_map.width, old_map.height), (3, 2));
    assert_eq!(old_map.events.get(&7).unwrap().pages.len(), 2);
    let mut edited_table = old_map.data.clone();
    edited_table.set(1, 0, 2, 2047);
    let RubyValue::Object(ref mut loaded_obj) = loaded else { panic!("expected RPG::Map") };
    let (_, table_field) = loaded_obj.instance_vars.iter_mut().find(|(k, _)| k == "@data").unwrap();
    *table_field = RubyValue::UserDefined {
        class_name: "Table".into(),
        data: edited_table.to_bytes(),
    };
    let after = dump(&loaded).unwrap();
    let reopened = load(&after).unwrap();
    let reopened_map = RpgMap::from_ruby_value(&reopened).unwrap();
    assert_eq!((reopened_map.data.x_size, reopened_map.data.y_size, reopened_map.data.z_size), (3, 2, 3));
    for z in 0..3 {
        for y in 0..2 {
            for x in 0..3 {
                let expected = if (x, y, z) == (1, 0, 2) {
                    2047
                } else {
                    [384, 48, 1024][z as usize] + (y * 3 + x) as i16
                };
                assert_eq!(reopened_map.data.get(x, y, z), expected, "tile {x},{y},{z}");
            }
        }
    }
    let reopened_obj = reopened.as_object().unwrap();
    let original_obj = original.as_object().unwrap();
    assert_eq!(reopened_obj.get("custom_map_field"), original_obj.get("custom_map_field"));
    assert_eq!(reopened_obj.get("events"), Some(&original_events));
    assert_eq!(reopened_map.events.get(&7).unwrap().pages[0].list[0].code, 355);
    assert_eq!(reopened_map.events.get(&7).unwrap().pages[1].list[0].code, 655);
    assert_eq!(dump(&reopened).unwrap(), after, "reopened Marshal must be byte-stable");
}

#[test]
fn xp_table_binary_encoding_is_exact_for_three_layers() {
    let mut table = Table::new_3d(2, 2, 3);
    for z in 0..3 {
        for y in 0..2 {
            for x in 0..2 {
                table.set(x, y, z, (100 * z + 10 * y + x) as i16);
            }
        }
    }
    let bytes = table.to_bytes();
    assert_eq!(i32::from_le_bytes(bytes[0..4].try_into().unwrap()), 3);
    assert_eq!(i32::from_le_bytes(bytes[16..20].try_into().unwrap()), 12);
    let decoded = Table::from_bytes(&bytes).unwrap();
    assert_eq!(decoded.data, table.data);
    assert_eq!(decoded.to_bytes(), bytes);
}
