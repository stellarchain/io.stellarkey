use crate::types::VerificationKey;
use sha2::{Digest, Sha256};

pub const EMBEDDED_VK_BYTES: &[u8] = include_bytes!("verifying_key.bin");
const PUBLIC_SIGNAL_COUNT: usize = 13;
const IC_POINT_COUNT: usize = PUBLIC_SIGNAL_COUNT + 1;
const VK_HEADER_BYTES: usize = 452;
const EMBEDDED_VK_SIZE: usize = VK_HEADER_BYTES + IC_POINT_COUNT * 64;

pub fn get_embedded_vk() -> VerificationKey {
    let bytes = EMBEDDED_VK_BYTES;
    assert_eq!(
        bytes.len(),
        EMBEDDED_VK_SIZE,
        "Invalid embedded verifying key size"
    );

    let mut alpha_g1 = [0u8; 64];
    let mut beta_g2 = [0u8; 128];
    let mut gamma_g2 = [0u8; 128];
    let mut delta_g2 = [0u8; 128];
    let mut gamma_abc = [[0u8; 64]; IC_POINT_COUNT];

    alpha_g1.copy_from_slice(&bytes[0..64]);
    beta_g2.copy_from_slice(&bytes[64..192]);
    gamma_g2.copy_from_slice(&bytes[192..320]);
    delta_g2.copy_from_slice(&bytes[320..448]);

    let ic_len = u32::from_be_bytes(bytes[448..452].try_into().unwrap()) as usize;
    assert_eq!(ic_len, IC_POINT_COUNT, "Unexpected IC point count");

    for (i, point) in gamma_abc.iter_mut().enumerate() {
        let start = 452 + i * 64;
        point.copy_from_slice(&bytes[start..start + 64]);
    }

    VerificationKey {
        alpha_g1,
        beta_g2,
        gamma_g2,
        delta_g2,
        gamma_abc,
    }
}

pub fn get_embedded_vk_hash() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(EMBEDDED_VK_BYTES);
    let out = hasher.finalize();
    let mut h = [0u8; 32];
    h.copy_from_slice(&out);
    h
}
