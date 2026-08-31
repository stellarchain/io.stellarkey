use crate::constants::{DOMAIN_ACTION, DOMAIN_ACTION_BINDING, DOMAIN_ASSET, DOMAIN_RELAYER};
use crate::encoding::{
    encode_address, encode_domain, encode_optional_address, encode_u16_be, encode_u64_be,
};
use crate::encryption::OutputPackage;
use crate::field::field_id;
use crate::poseidon2::p2;
use alloc::vec::Vec;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Deposit = 1,
    PrivateTransfer = 2,
    Withdraw = 3,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub protocol_version: u16,
    pub kind: ActionKind,
    pub asset: (u8, [u8; 32]),
    pub action_nonce: [u8; 32],
    pub anchor_root: [u8; 32],
    pub nullifiers: [[u8; 32]; 2],
    pub outputs: [OutputPackage; 2],
    pub public_value: u64,
    pub deposit_source: Option<(u8, [u8; 32])>,
    pub public_recipient: Option<(u8, [u8; 32])>,
    pub relayer_fee: u64,
    pub relayer: Option<(u8, [u8; 32])>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionError {
    InvalidProtocolVersion,
    InvalidKind,
    InvalidPublicValue,
    InvalidDepositSource,
    InvalidPublicRecipient,
    InvalidSlots,
    DuplicateNullifiers,
    DuplicateOutputs,
    NonCanonicalField,
}

impl Action {
    pub fn serialize_canonical_action_bytes(
        &self,
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        encode_domain(DOMAIN_ACTION, &mut buf);
        encode_u16_be(self.protocol_version, &mut buf);
        buf.extend_from_slice(network_id);
        buf.extend_from_slice(realm_id);
        buf.extend_from_slice(pool_id);
        buf.push(self.kind as u8);
        encode_address(self.asset.0, &self.asset.1, &mut buf).unwrap();
        buf.extend_from_slice(&self.action_nonce);
        buf.extend_from_slice(&self.anchor_root);
        buf.extend_from_slice(&self.nullifiers[0]);
        buf.extend_from_slice(&self.nullifiers[1]);
        buf.extend_from_slice(&self.outputs[0].serialize());
        buf.extend_from_slice(&self.outputs[1].serialize());
        encode_u64_be(self.public_value, &mut buf);
        encode_u64_be(self.relayer_fee, &mut buf);
        encode_optional_address(self.relayer, &mut buf).unwrap();
        encode_optional_address(self.deposit_source, &mut buf).unwrap();
        encode_optional_address(self.public_recipient, &mut buf).unwrap();
        buf
    }

    pub fn compute_action_field(
        &self,
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
    ) -> [u8; 32] {
        let bytes = self.serialize_canonical_action_bytes(network_id, realm_id, pool_id);
        field_id(DOMAIN_ACTION, &bytes)
    }

    pub fn compute_action_binding(context_field: &[u8; 32], action_field: &[u8; 32]) -> [u8; 32] {
        p2(DOMAIN_ACTION_BINDING, &[*context_field, *action_field])
    }

    pub fn compute_relayer_field(&self) -> [u8; 32] {
        let Some((kind, payload)) = self.relayer else {
            return [0; 32];
        };
        let mut bytes = Vec::with_capacity(33);
        encode_address(kind, &payload, &mut bytes).unwrap();
        field_id(DOMAIN_RELAYER, &bytes)
    }

    pub fn compute_asset_field(&self) -> [u8; 32] {
        let mut bytes = Vec::with_capacity(33);
        encode_address(self.asset.0, &self.asset.1, &mut bytes).unwrap();
        field_id(DOMAIN_ASSET, &bytes)
    }

    pub fn compute_public_signals(
        &self,
        context_field: &[u8; 32],
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
    ) -> [[u8; 32]; 13] {
        let asset_field = self.compute_asset_field();
        let action_field = self.compute_action_field(network_id, realm_id, pool_id);
        let action_binding = Self::compute_action_binding(context_field, &action_field);

        let mut kind_field = [0u8; 32];
        kind_field[31] = self.kind as u8;

        let mut val_field = [0u8; 32];
        val_field[24..32].copy_from_slice(&self.public_value.to_be_bytes());
        let mut relayer_fee_field = [0u8; 32];
        relayer_fee_field[24..32].copy_from_slice(&self.relayer_fee.to_be_bytes());
        let relayer_field = self.compute_relayer_field();

        [
            *context_field,
            asset_field,
            kind_field,
            self.anchor_root,
            val_field,
            relayer_fee_field,
            relayer_field,
            action_field,
            action_binding,
            self.nullifiers[0],
            self.nullifiers[1],
            self.outputs[0].cm,
            self.outputs[1].cm,
        ]
    }
}
