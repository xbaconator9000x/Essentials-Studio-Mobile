use serde::{Deserialize, Serialize};

const MAX_TABLE_ELEMENTS: usize = 30_000_000;

/// RMXP Table class — a 1D/2D/3D array of i16 values.
///
/// Used for map tile data (3D: width × height × layers),
/// tileset properties (1D), and other grid-based data.
///
/// Binary serialization format:
///   - 4 bytes: dimension count (1, 2, or 3)
///   - 4 bytes: x_size
///   - 4 bytes: y_size
///   - 4 bytes: z_size
///   - 4 bytes: total element count (x * y * z)
///   - total * 2 bytes: i16 data in column-major order
///
/// Access formula: data[z * (x_size * y_size) + y * x_size + x]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    pub dim_count: u32,
    pub x_size: u32,
    pub y_size: u32,
    pub z_size: u32,
    pub data: Vec<i16>,
}

impl Table {
    /// Create a new empty table with given dimensions.
    pub fn new(x_size: u32, y_size: u32, z_size: u32) -> Self {
        // Widen to usize before multiplying so large dimensions can't overflow u32.
        let total = (x_size as usize)
            .saturating_mul(y_size as usize)
            .saturating_mul(z_size as usize);
        Self {
            dim_count: if z_size > 1 {
                3
            } else if y_size > 1 {
                2
            } else {
                1
            },
            x_size,
            y_size,
            z_size,
            data: vec![0i16; total],
        }
    }

    /// Create a 1D table.
    pub fn new_1d(x_size: u32) -> Self {
        Self::new(x_size, 1, 1)
    }

    /// Create a 2D table.
    pub fn new_2d(x_size: u32, y_size: u32) -> Self {
        Self::new(x_size, y_size, 1)
    }

    /// Create a 3D table (used for map tile data).
    pub fn new_3d(x_size: u32, y_size: u32, z_size: u32) -> Self {
        Self::new(x_size, y_size, z_size)
    }

    /// Get a value at (x, y, z). Returns 0 if out of bounds.
    pub fn get(&self, x: u32, y: u32, z: u32) -> i16 {
        if x >= self.x_size || y >= self.y_size || z >= self.z_size {
            return 0;
        }
        let idx = (z * self.y_size * self.x_size + y * self.x_size + x) as usize;
        self.data.get(idx).copied().unwrap_or(0)
    }

    /// Set a value at (x, y, z). No-op if out of bounds.
    pub fn set(&mut self, x: u32, y: u32, z: u32, value: i16) {
        if x >= self.x_size || y >= self.y_size || z >= self.z_size {
            return;
        }
        let idx = (z * self.y_size * self.x_size + y * self.x_size + x) as usize;
        if idx < self.data.len() {
            self.data[idx] = value;
        }
    }

    /// Deserialize a Table from its binary representation.
    /// Format: 20-byte header + i16 array data.
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 20 {
            return None;
        }

        let dim_count = u32::try_from(read_i32_le(data, 0)).ok()?;
        if !(1..=3).contains(&dim_count) {
            return None;
        }
        let x_size = u32::try_from(read_i32_le(data, 4)).ok()?;
        let y_size = u32::try_from(read_i32_le(data, 8)).ok()?;
        let z_size = u32::try_from(read_i32_le(data, 12)).ok()?;
        if x_size == 0 || y_size == 0 || z_size == 0 {
            return None;
        }

        let inferred_dimensions = if z_size > 1 {
            3
        } else if y_size > 1 {
            2
        } else {
            1
        };
        if dim_count != inferred_dimensions {
            return None;
        }

        let expected_total = (x_size as usize)
            .checked_mul(y_size as usize)?
            .checked_mul(z_size as usize)?;
        if expected_total > MAX_TABLE_ELEMENTS {
            return None;
        }
        let total_raw = read_i32_le(data, 16);
        if total_raw < 0 || total_raw as usize != expected_total {
            return None;
        }
        let total = expected_total;

        let expected_size = total.checked_mul(2).and_then(|v| v.checked_add(20))?;
        if data.len() < expected_size {
            return None;
        }

        let mut table_data = Vec::with_capacity(total);
        for i in 0..total {
            let offset = 20 + i * 2;
            let val = read_i16_le(data, offset);
            table_data.push(val);
        }

        Some(Self {
            dim_count,
            x_size,
            y_size,
            z_size,
            data: table_data,
        })
    }

    /// Serialize the Table to its binary representation.
    pub fn to_bytes(&self) -> Vec<u8> {
        let total = self.data.len();
        let mut bytes = Vec::with_capacity(20 + total * 2);

        // Header
        bytes.extend_from_slice(&(self.dim_count as i32).to_le_bytes());
        bytes.extend_from_slice(&(self.x_size as i32).to_le_bytes());
        bytes.extend_from_slice(&(self.y_size as i32).to_le_bytes());
        bytes.extend_from_slice(&(self.z_size as i32).to_le_bytes());
        bytes.extend_from_slice(&(total as i32).to_le_bytes());

        // Data
        for &val in &self.data {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        bytes
    }

    /// Total number of elements.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Resize the table, preserving existing data where possible.
    pub fn resize(&mut self, new_x: u32, new_y: u32, new_z: u32) {
        let total = (new_x as usize)
            .saturating_mul(new_y as usize)
            .saturating_mul(new_z as usize);
        let mut new_data = vec![0i16; total];

        let copy_x = self.x_size.min(new_x);
        let copy_y = self.y_size.min(new_y);
        let copy_z = self.z_size.min(new_z);

        for z in 0..copy_z {
            for y in 0..copy_y {
                for x in 0..copy_x {
                    let old_idx = (z * self.y_size * self.x_size + y * self.x_size + x) as usize;
                    let new_idx = (z * new_y * new_x + y * new_x + x) as usize;
                    if old_idx < self.data.len() && new_idx < new_data.len() {
                        new_data[new_idx] = self.data[old_idx];
                    }
                }
            }
        }

        self.x_size = new_x;
        self.y_size = new_y;
        self.z_size = new_z;
        self.dim_count = if new_z > 1 {
            3
        } else if new_y > 1 {
            2
        } else {
            1
        };
        self.data = new_data;
    }
}

fn read_i32_le(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

fn read_i16_le(data: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes([data[offset], data[offset + 1]])
}

#[cfg(test)]
mod tests {
    use super::{Table, MAX_TABLE_ELEMENTS};

    #[test]
    fn reads_valid_xp_tables_and_retains_opaque_trailing_bytes() {
        let table = Table::new_3d(2, 3, 3);
        let mut bytes = table.to_bytes();
        bytes.extend_from_slice(b"opaque-extension");

        let decoded = Table::from_bytes(&bytes).expect("valid XP Table prefix");
        assert_eq!(
            (
                decoded.dim_count,
                decoded.x_size,
                decoded.y_size,
                decoded.z_size
            ),
            (3, 2, 3, 3)
        );
        assert_eq!(decoded.data.len(), 18);
    }

    #[test]
    fn rejects_inconsistent_and_oversized_headers_before_allocating_cells() {
        let mut table = Table::new_3d(2, 2, 3).to_bytes();
        table[16..20].copy_from_slice(&11i32.to_le_bytes());
        assert!(Table::from_bytes(&table).is_none());

        let mut table = Table::new_3d(2, 2, 3).to_bytes();
        table[0..4].copy_from_slice(&2i32.to_le_bytes());
        assert!(Table::from_bytes(&table).is_none());

        let mut oversized = [0u8; 20];
        oversized[0..4].copy_from_slice(&1i32.to_le_bytes());
        oversized[4..8].copy_from_slice(&((MAX_TABLE_ELEMENTS as u32) + 1).to_le_bytes());
        oversized[8..12].copy_from_slice(&1i32.to_le_bytes());
        oversized[12..16].copy_from_slice(&1i32.to_le_bytes());
        oversized[16..20].copy_from_slice(&((MAX_TABLE_ELEMENTS as i32) + 1).to_le_bytes());
        assert!(Table::from_bytes(&oversized).is_none());
    }

    #[test]
    fn rejects_negative_or_zero_dimensions() {
        let mut negative = Table::new_1d(4).to_bytes();
        negative[4..8].copy_from_slice(&(-1i32).to_le_bytes());
        assert!(Table::from_bytes(&negative).is_none());

        let mut zero = Table::new_1d(4).to_bytes();
        zero[8..12].copy_from_slice(&0i32.to_le_bytes());
        assert!(Table::from_bytes(&zero).is_none());
    }
}
