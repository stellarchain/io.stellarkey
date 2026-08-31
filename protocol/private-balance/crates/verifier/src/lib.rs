#![no_std]

extern crate alloc;

pub mod types;
pub mod verify;
pub mod vk;

pub use types::{Proof, ProofBytes, VerificationKey};
pub use verify::{verify_groth16_proof, verify_groth16_proof_bytes, verify_groth16_proof_with_vk};
pub use vk::{EMBEDDED_VK_BYTES, get_embedded_vk, get_embedded_vk_hash};
