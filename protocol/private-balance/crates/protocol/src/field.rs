use num_bigint::BigUint;
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
    for i in 0..32 {
        if bytes[i] < BN254_FR_MODULUS_BYTES[i] {
            return true;
        } else if bytes[i] > BN254_FR_MODULUS_BYTES[i] {
            return false;
        }
    }
    false
}

/// Interprets bytes as an unsigned big-endian integer and reduces modulo BN254 Fr.
pub fn bytes_to_field(bytes: &[u8]) -> [u8; 32] {
    let bi = BigUint::from_bytes_be(bytes);
    let modulus = BigUint::from_bytes_be(&BN254_FR_MODULUS_BYTES);
    let rem = bi % modulus;
    let raw = rem.to_bytes_be();
    let mut out = [0u8; 32];
    let offset = 32 - raw.len();
    out[offset..].copy_from_slice(&raw);
    out
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
    let a_int = BigUint::from_bytes_be(a);
    let b_int = BigUint::from_bytes_be(b);
    let modulus = BigUint::from_bytes_be(&BN254_FR_MODULUS_BYTES);
    let sum = (a_int + b_int) % modulus;
    let raw = sum.to_bytes_be();
    let mut out = [0u8; 32];
    let offset = 32 - raw.len();
    out[offset..].copy_from_slice(&raw);
    out
}
