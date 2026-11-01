use super::types::*;
use std::collections::HashMap;
use std::io::{self, Write};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MarshalWriteError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Value too large to serialize: {0}")]
    ValueTooLarge(String),
}

/// Serializes RubyValue back to Ruby Marshal v4.8 binary format.
///
/// Maintains symbol and object caches for deduplication, matching
/// the original Ruby Marshal behavior.
pub struct MarshalWriter<W: Write> {
    writer: W,
    /// Cache of symbols seen so far (for deduplication via `;` references)
    symbols: Vec<String>,
    symbol_index: HashMap<String, usize>,
    /// Object identity tracking. In a full implementation we'd track
    /// object identity, but since we work with cloned values, we skip
    /// object back-references for now and rely on the symbol cache.
    object_count: usize,
}

impl<W: Write> MarshalWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            symbols: Vec::new(),
            symbol_index: HashMap::new(),
            object_count: 0,
        }
    }

    /// Write a complete Marshal stream.
    pub fn write(&mut self, value: &RubyValue) -> Result<(), MarshalWriteError> {
        // Write magic header: version 4.8
        self.write_byte(4)?;
        self.write_byte(8)?;
        self.write_value(value)
    }

    fn write_byte(&mut self, byte: u8) -> Result<(), MarshalWriteError> {
        self.writer.write_all(&[byte])?;
        Ok(())
    }

    fn write_bytes(&mut self, bytes: &[u8]) -> Result<(), MarshalWriteError> {
        self.writer.write_all(bytes)?;
        Ok(())
    }

    /// Write a Ruby Marshal "long" (variable-length integer).
    fn write_long(&mut self, val: i64) -> Result<(), MarshalWriteError> {
        if val == 0 {
            self.write_byte(0)?;
            return Ok(());
        }

        // Shortcut for small positive integers (0..122 stored as 5..127)
        if val > 0 && val < 123 {
            self.write_byte((val + 5) as u8)?;
            return Ok(());
        }

        // Shortcut for small negative integers (-123..0 stored as -128..-5)
        if val < 0 && val > -124 {
            self.write_byte(((val - 5) & 0xFF) as u8)?;
            return Ok(());
        }

        // Multi-byte encoding for positive values
        if val > 0 {
            if val < 0x100 {
                self.write_byte(1)?;
                self.write_byte(val as u8)?;
            } else if val < 0x10000 {
                self.write_byte(2)?;
                self.write_byte(val as u8)?;
                self.write_byte((val >> 8) as u8)?;
            } else if val < 0x1000000 {
                self.write_byte(3)?;
                self.write_byte(val as u8)?;
                self.write_byte((val >> 8) as u8)?;
                self.write_byte((val >> 16) as u8)?;
            } else {
                self.write_byte(4)?;
                self.write_byte(val as u8)?;
                self.write_byte((val >> 8) as u8)?;
                self.write_byte((val >> 16) as u8)?;
                self.write_byte((val >> 24) as u8)?;
            }
            return Ok(());
        }

        // Multi-byte encoding for negative values
        let val = val;
        if val >= -0x80 {
            self.write_byte(0xFF)?; // -1 as i8
            self.write_byte(val as u8)?;
        } else if val >= -0x8000 {
            self.write_byte(0xFE)?; // -2 as i8
            self.write_byte(val as u8)?;
            self.write_byte((val >> 8) as u8)?;
        } else if val >= -0x800000 {
            self.write_byte(0xFD)?; // -3 as i8
            self.write_byte(val as u8)?;
            self.write_byte((val >> 8) as u8)?;
            self.write_byte((val >> 16) as u8)?;
        } else {
            self.write_byte(0xFC)?; // -4 as i8
            self.write_byte(val as u8)?;
            self.write_byte((val >> 8) as u8)?;
            self.write_byte((val >> 16) as u8)?;
            self.write_byte((val >> 24) as u8)?;
        }
        Ok(())
    }

    fn write_value(&mut self, value: &RubyValue) -> Result<(), MarshalWriteError> {
        match value {
            RubyValue::Nil => self.write_byte(b'0'),

            RubyValue::True => self.write_byte(b'T'),

            RubyValue::False => self.write_byte(b'F'),

            RubyValue::Integer(val) => {
                self.write_byte(b'i')?;
                self.write_long(*val)
            }

            RubyValue::Float(val) => {
                self.write_byte(b'f')?;
                let s = if val.is_infinite() && *val > 0.0 {
                    "inf".to_string()
                } else if val.is_infinite() {
                    "-inf".to_string()
                } else if val.is_nan() {
                    "nan".to_string()
                } else {
                    format!("{}", val)
                };
                self.write_raw_string(s.as_bytes())
            }

            RubyValue::String(s) => {
                // Ruby Marshal distinguishes a bare binary string (\"...\"), used by
                // classic RMXP, from an I-wrapped string with an encoding ivar.
                // Never turn a bare string into E=false: Ruby interprets E=false
                // as US-ASCII, not ASCII-8BIT. That can corrupt arbitrary bytes.
                if s.encoding.is_none() {
                    self.write_byte(b'"')?;
                    self.object_count += 1;
                    return self.write_raw_string(&s.bytes);
                }

                self.write_byte(b'I')?;
                self.write_byte(b'"')?;
                self.object_count += 1;
                self.write_raw_string(&s.bytes)?;
                self.write_long(1)?;
                match s.encoding.as_deref() {
                    Some("UTF-8") => {
                        self.write_symbol("E")?;
                        self.write_byte(b'T')?;
                    }
                    Some("US-ASCII") => {
                        self.write_symbol("E")?;
                        self.write_byte(b'F')?;
                    }
                    Some(enc) => {
                        self.write_symbol("encoding")?;
                        self.write_byte(b'"')?;
                        self.write_raw_string(enc.as_bytes())?;
                    }
                    None => unreachable!("bare strings returned above"),
                }
                Ok(())
            }

            RubyValue::Symbol(s) => self.write_symbol(s),

            RubyValue::Array(arr) => {
                self.write_byte(b'[')?;
                self.object_count += 1;
                self.write_long(arr.len() as i64)?;
                for item in arr {
                    self.write_value(item)?;
                }
                Ok(())
            }

            RubyValue::Hash(pairs) => {
                self.write_byte(b'{')?;
                self.object_count += 1;
                self.write_long(pairs.len() as i64)?;
                for (key, val) in pairs {
                    self.write_value(key)?;
                    self.write_value(val)?;
                }
                Ok(())
            }

            RubyValue::Object(obj) => {
                self.write_byte(b'o')?;
                self.object_count += 1;
                self.write_symbol(&obj.class_name)?;
                self.write_long(obj.instance_vars.len() as i64)?;
                for (name, val) in &obj.instance_vars {
                    self.write_symbol(name)?;
                    self.write_value(val)?;
                }
                Ok(())
            }

            RubyValue::UserDefined { class_name, data } => {
                self.write_byte(b'u')?;
                self.write_symbol(class_name)?;
                self.object_count += 1;
                self.write_raw_string(data)
            }

            RubyValue::UserMarshal { class_name, data } => {
                self.write_byte(b'U')?;
                self.write_symbol(class_name)?;
                self.object_count += 1;
                self.write_value(data)
            }

            RubyValue::Regexp { pattern, flags } => {
                self.write_byte(b'/')?;
                self.object_count += 1;
                self.write_raw_string(pattern)?;
                self.write_byte(*flags)
            }

            RubyValue::Struct { name, members } => {
                self.write_byte(b'S')?;
                self.object_count += 1;
                self.write_symbol(name)?;
                self.write_long(members.len() as i64)?;
                for (mem_name, mem_val) in members {
                    self.write_symbol(mem_name)?;
                    self.write_value(mem_val)?;
                }
                Ok(())
            }

            RubyValue::Extended { module_name, object } => {
                self.write_byte(b'e')?;
                self.write_symbol(module_name)?;
                self.write_value(object)
            }

            RubyValue::Class(name) => {
                self.write_byte(b'c')?;
                self.write_raw_string(name.as_bytes())
            }

            RubyValue::Module(name) => {
                self.write_byte(b'm')?;
                self.write_raw_string(name.as_bytes())
            }
        }
    }

    /// Write a symbol, using cache/back-reference when possible.
    fn write_symbol(&mut self, name: &str) -> Result<(), MarshalWriteError> {
        if let Some(&idx) = self.symbol_index.get(name) {
            // Symbol already seen — write back-reference
            self.write_byte(b';')?;
            self.write_long(idx as i64)?;
        } else {
            // New symbol — write full and cache
            let idx = self.symbols.len();
            self.symbols.push(name.to_string());
            self.symbol_index.insert(name.to_string(), idx);
            self.write_byte(b':')?;
            self.write_raw_string(name.as_bytes())?;
        }
        Ok(())
    }

    /// Write a length-prefixed byte sequence.
    fn write_raw_string(&mut self, data: &[u8]) -> Result<(), MarshalWriteError> {
        self.write_long(data.len() as i64)?;
        self.write_bytes(data)
    }
}

/// Convenience function to serialize to a byte vector.
pub fn dump(value: &RubyValue) -> Result<Vec<u8>, MarshalWriteError> {
    let mut buf = Vec::new();
    let mut writer = MarshalWriter::new(&mut buf);
    writer.write(value)?;
    Ok(buf)
}

/// Serialize an XP data file via a same-directory staging file on Android/Unix.
/// A failed write cannot truncate the existing Map, Event or PBS Marshal file.
/// Windows retains legacy replacement behaviour pending a separate Win32 test.
pub fn dump_file(path: &std::path::Path, value: &RubyValue) -> Result<(), MarshalWriteError> {
    let bytes = dump(value)?;
    #[cfg(windows)]
    {
        std::fs::write(path, &bytes)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use std::fs::{self, OpenOptions};
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);

        let parent = path.parent().filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let filename = path.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Marshal destination has no filename")
        })?;
        let (mut staged, staging_path) = loop {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let mut name = std::ffi::OsString::from(".");
            name.push(filename);
            name.push(format!(".{}.{id}.tmp", std::process::id()));
            let candidate = parent.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&candidate) {
                Ok(file) => break (file, candidate),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        };
        let result = (|| -> io::Result<()> {
            staged.write_all(&bytes)?;
            if let Ok(meta) = fs::metadata(path) {
                if meta.is_file() { staged.set_permissions(meta.permissions())?; }
            }
            staged.sync_all()?;
            drop(staged);
            fs::rename(&staging_path, path)?;
            // Sync parent metadata when available; some storage backends deny it.
            if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); }
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(&staging_path); }
        result.map_err(MarshalWriteError::from)
    }
}

#[cfg(test)]
mod file_save_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_root() -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "essentials-marshal-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn saved_map_reopens_without_orphan_staging_files() {
        let dir = test_root();
        let path = dir.join("Map001.rxdata");
        std::fs::write(&path, b"old contents").unwrap();
        let value = RubyValue::Array(vec![
            RubyValue::Integer(384), RubyValue::Integer(48), RubyValue::Integer(1024)
        ]);
        dump_file(&path, &value).unwrap();
        assert_eq!(crate::marshal::load_file(&path).unwrap(), value);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_save_keeps_original_destination_untouched() {
        let dir = test_root();
        let path = dir.join("Map002.rxdata");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("original"), b"preserve me").unwrap();
        assert!(dump_file(&path, &RubyValue::Nil).is_err());
        assert_eq!(std::fs::read(path.join("original")).unwrap(), b"preserve me");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
