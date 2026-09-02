use sha2::{Digest, Sha256};

// BN254 Fr scalar field modulus:
// 21888242871839275222246405745257275088548364400416034343698204186575808495617
pub const BN254_FR_MODULUS_HEX: &str =
    "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001";

pub const BN254_FR_MODULUS_BYTES: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Checks if a 32-byte big-endian array is strictly less than the BN254 scalar modulus.
pub fn is_canonical_field(bytes: &[u8; 32]) -> bool {
    for (byte, modulus) in bytes.iter().zip(BN254_FR_MODULUS_BYTES) {
        if *byte < modulus {
            return true;
        } else if *byte > modulus {
            return false;
        }
    }
    false
}

fn greater_than_or_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    for (left_byte, right_byte) in left.iter().zip(right) {
        if left_byte > right_byte {
            return true;
        }
        if left_byte < right_byte {
            return false;
        }
    }
    true
}

fn subtract_assign(value: &mut [u8; 32], subtrahend: &[u8; 32]) {
    let mut borrow = 0i16;
    for index in (0..32).rev() {
        let difference = i16::from(value[index]) - i16::from(subtrahend[index]) - borrow;
        if difference < 0 {
            value[index] = (difference + 256) as u8;
            borrow = 1;
        } else {
            value[index] = difference as u8;
            borrow = 0;
        }
    }
    debug_assert_eq!(borrow, 0);
}

fn reduce_once(value: &mut [u8; 32]) {
    if greater_than_or_equal(value, &BN254_FR_MODULUS_BYTES) {
        subtract_assign(value, &BN254_FR_MODULUS_BYTES);
    }
}

fn double_mod(value: &mut [u8; 32]) {
    let mut carry = 0u16;
    for byte in value.iter_mut().rev() {
        let doubled = u16::from(*byte) * 2 + carry;
        *byte = doubled as u8;
        carry = doubled >> 8;
    }
    debug_assert_eq!(carry, 0);
    reduce_once(value);
}

fn add_bit_mod(value: &mut [u8; 32], bit: u8) {
    if bit == 0 {
        return;
    }
    let mut carry = 1u16;
    for byte in value.iter_mut().rev() {
        let sum = u16::from(*byte) + carry;
        *byte = sum as u8;
        carry = sum >> 8;
        if carry == 0 {
            break;
        }
    }
    debug_assert_eq!(carry, 0);
    reduce_once(value);
}

/// Interprets bytes as an unsigned big-endian integer and reduces modulo BN254 Fr.
pub fn bytes_to_field(bytes: &[u8]) -> [u8; 32] {
    let mut output = [0u8; 32];
    if bytes.len() <= output.len() {
        output[32 - bytes.len()..].copy_from_slice(bytes);
        while greater_than_or_equal(&output, &BN254_FR_MODULUS_BYTES) {
            subtract_assign(&mut output, &BN254_FR_MODULUS_BYTES);
        }
        return output;
    }

    for byte in bytes {
        for bit in (0..8).rev() {
            double_mod(&mut output);
            add_bit_mod(&mut output, (byte >> bit) & 1);
        }
    }
    output
}

/// Derives a field element from a domain label and byte payload:
/// SHA-256(ASCII label || 0x00 || bytes) mod BN254 Fr.
pub fn field_id(label: &str, bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(label.as_bytes());
    hasher.update([0u8]);
    hasher.update(bytes);
    let digest = hasher.finalize();
    bytes_to_field(&digest)
}

/// Adds two field elements modulo BN254 Fr.
pub fn field_add(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let left = bytes_to_field(a);
    let right = bytes_to_field(b);
    let mut output = [0u8; 32];
    let mut carry = 0u16;
    for index in (0..32).rev() {
        let sum = u16::from(left[index]) + u16::from(right[index]) + carry;
        output[index] = sum as u8;
        carry = sum >> 8;
    }
    debug_assert_eq!(carry, 0);
    reduce_once(&mut output);
    output
}
