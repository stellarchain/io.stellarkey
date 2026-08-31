use crate::constants::DOMAIN_DEPLOYMENT_BINDING;
use crate::encoding::{EncodingError, encode_address, encode_domain, encode_u16_be, encode_u32_be};
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeploymentBinding {
    pub protocol_version: u16,
    pub network_id: [u8; 32],
    pub realm_id: [u8; 32],
    pub pool_id: [u8; 32],
    pub guardian: (u8, [u8; 32]),
    pub poseidon2_parameter_hash: [u8; 32],
    pub circuit_hash: [u8; 32],
    pub verification_key_hash: [u8; 32],
    pub tree_depth: u32,
    pub root_window_ledgers: u32,
    pub page_capacity: u32,
    pub private_address_payload_bytes: u32,
    pub private_address_ascii_bytes: u32,
    pub address_context_tag_bytes: u32,
    pub address_checksum_bytes: u32,
    pub hpke_kem_id: u16,
    pub hpke_kdf_id: u16,
    pub hpke_aead_id: u16,
}

impl DeploymentBinding {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, EncodingError> {
        let mut bytes = Vec::new();
        encode_domain(DOMAIN_DEPLOYMENT_BINDING, &mut bytes);
        encode_u16_be(self.protocol_version, &mut bytes);
        bytes.extend_from_slice(&self.network_id);
        bytes.extend_from_slice(&self.realm_id);
        bytes.extend_from_slice(&self.pool_id);
        encode_address(self.guardian.0, &self.guardian.1, &mut bytes)?;
        bytes.extend_from_slice(&self.poseidon2_parameter_hash);
        bytes.extend_from_slice(&self.circuit_hash);
        bytes.extend_from_slice(&self.verification_key_hash);
        encode_u32_be(self.tree_depth, &mut bytes);
        encode_u32_be(self.root_window_ledgers, &mut bytes);
        encode_u32_be(self.page_capacity, &mut bytes);
        encode_u32_be(self.private_address_payload_bytes, &mut bytes);
        encode_u32_be(self.private_address_ascii_bytes, &mut bytes);
        encode_u32_be(self.address_context_tag_bytes, &mut bytes);
        encode_u32_be(self.address_checksum_bytes, &mut bytes);
        encode_u16_be(self.hpke_kem_id, &mut bytes);
        encode_u16_be(self.hpke_kdf_id, &mut bytes);
        encode_u16_be(self.hpke_aead_id, &mut bytes);
        Ok(bytes)
    }

    pub fn hash(&self) -> Result<[u8; 32], EncodingError> {
        Ok(Sha256::digest(self.canonical_bytes()?).into())
    }
}
