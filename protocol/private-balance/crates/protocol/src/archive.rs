use crate::constants::{DOMAIN_ARCHIVE_GENESIS, DOMAIN_ARCHIVE_RECORD};
use crate::encoding::{
    encode_address, encode_domain, encode_optional_address, encode_u16_be, encode_u32_be,
    encode_u64_be,
};
use crate::encryption::OutputPackage;
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveRecord {
    pub action_index: u32,
    pub ledger_sequence: u32,
    pub starting_leaf_index: u32,
    pub action_kind: u8,
    pub asset: (u8, [u8; 32]),
    pub action_nonce: [u8; 32],
    pub anchor_root: [u8; 32],
    pub tree_root_after: [u8; 32],
    pub nullifiers: [[u8; 32]; 2],
    pub outputs: [OutputPackage; 2],
    pub public_value: u64,
    pub deposit_source: Option<(u8, [u8; 32])>,
    pub public_recipient: Option<(u8, [u8; 32])>,
    pub relayer_fee: u64,
    pub relayer: Option<(u8, [u8; 32])>,
}

impl ArchiveRecord {
    pub fn compute_record_hash(
        &self,
        protocol_version: u16,
        prior_record_hash: &[u8; 32],
    ) -> [u8; 32] {
        let mut buf = Vec::new();
        encode_domain(DOMAIN_ARCHIVE_RECORD, &mut buf);
        encode_u16_be(protocol_version, &mut buf);
        encode_u32_be(self.action_index, &mut buf);
        encode_u32_be(self.ledger_sequence, &mut buf);
        encode_u32_be(self.starting_leaf_index, &mut buf);
        buf.push(self.action_kind);
        encode_address(self.asset.0, &self.asset.1, &mut buf).unwrap();
        buf.extend_from_slice(&self.action_nonce);
        buf.extend_from_slice(&self.anchor_root);
        buf.extend_from_slice(&self.tree_root_after);
        buf.extend_from_slice(&self.nullifiers[0]);
        buf.extend_from_slice(&self.nullifiers[1]);
        buf.extend_from_slice(&self.outputs[0].serialize());
        buf.extend_from_slice(&self.outputs[1].serialize());
        encode_u64_be(self.public_value, &mut buf);
        encode_u64_be(self.relayer_fee, &mut buf);
        encode_optional_address(self.relayer, &mut buf).unwrap();
        encode_optional_address(self.deposit_source, &mut buf).unwrap();
        encode_optional_address(self.public_recipient, &mut buf).unwrap();
        buf.extend_from_slice(prior_record_hash);

        Sha256::digest(&buf).into()
    }
}

pub fn compute_genesis_record_hash(
    context_hash: &[u8; 32],
    deployment_binding_hash: &[u8; 32],
) -> [u8; 32] {
    let mut buf = Vec::new();
    encode_domain(DOMAIN_ARCHIVE_GENESIS, &mut buf);
    buf.extend_from_slice(context_hash);
    buf.extend_from_slice(deployment_binding_hash);
    Sha256::digest(&buf).into()
}
