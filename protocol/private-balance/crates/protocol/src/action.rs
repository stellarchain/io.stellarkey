use crate::constants::{DOMAIN_ACTION, DOMAIN_ASSET};
use crate::encoding::{
    encode_address, encode_domain, encode_optional_address, encode_u16_be, encode_u64_be,
};
use crate::encryption::OutputPackage;
use crate::field::field_id;
use crate::field::is_canonical_field;
use alloc::vec::Vec;

pub fn compute_asset_field(asset: (u8, [u8; 32])) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(33);
    encode_address(asset.0, &asset.1, &mut bytes).unwrap();
    field_id(DOMAIN_ASSET, &bytes)
}

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
    pub fn validate_public_shape(&self) -> Result<(), ActionError> {
        const ZERO: [u8; 32] = [0; 32];
        if self.protocol_version != crate::constants::PROTOCOL_VERSION {
            return Err(ActionError::InvalidProtocolVersion);
        }
        if self.asset.0 != 1 || self.asset.1 == ZERO {
            return Err(ActionError::InvalidKind);
        }
        if self.public_value > i64::MAX as u64 || self.relayer_fee > i64::MAX as u64 {
            return Err(ActionError::InvalidPublicValue);
        }
        if !is_canonical_field(&self.anchor_root)
            || self
                .nullifiers
                .iter()
                .any(|field| !is_canonical_field(field))
            || self
                .outputs
                .iter()
                .any(|output| !is_canonical_field(&output.cm))
        {
            return Err(ActionError::NonCanonicalField);
        }
        if self.nullifiers.iter().any(|field| *field == ZERO)
            || self.outputs.iter().any(|output| {
                output.cm == ZERO
                    || output.recipient_envelope == [0; 181]
                    || output.outgoing_envelope == [0; 157]
            })
        {
            return Err(ActionError::InvalidSlots);
        }
        if self.nullifiers[0] == self.nullifiers[1] {
            return Err(ActionError::DuplicateNullifiers);
        }
        if self.outputs[0].cm == self.outputs[1].cm {
            return Err(ActionError::DuplicateOutputs);
        }
        match self.kind {
            ActionKind::Deposit => {
                if self.anchor_root != ZERO
                    || self.public_value == 0
                    || self.deposit_source.is_none()
                    || self.public_recipient.is_some()
                    || self.relayer_fee != 0
                    || self.relayer.is_some()
                {
                    return Err(ActionError::InvalidDepositSource);
                }
            }
            ActionKind::PrivateTransfer => {
                if self.anchor_root == ZERO
                    || self.public_value != 0
                    || self.deposit_source.is_some()
                    || self.public_recipient.is_some()
                    || self.relayer.is_none()
                {
                    return Err(ActionError::InvalidSlots);
                }
            }
            ActionKind::Withdraw => {
                if self.anchor_root == ZERO
                    || self.public_value == 0
                    || self.deposit_source.is_some()
                    || self.public_recipient.is_none()
                    || self.relayer.is_none()
                {
                    return Err(ActionError::InvalidPublicRecipient);
                }
            }
        }
        Ok(())
    }

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

    pub fn compute_asset_field(&self) -> [u8; 32] {
        compute_asset_field(self.asset)
    }

    pub fn compute_public_signals(
        &self,
        context_field: &[u8; 32],
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
    ) -> [[u8; 32]; 11] {
        let asset_field = self.compute_asset_field();
        self.compute_public_signals_with_asset_field(
            context_field,
            network_id,
            realm_id,
            pool_id,
            &asset_field,
        )
    }

    pub fn compute_public_signals_with_asset_field(
        &self,
        context_field: &[u8; 32],
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
        asset_field: &[u8; 32],
    ) -> [[u8; 32]; 11] {
        let action_field = self.compute_action_field(network_id, realm_id, pool_id);

        let mut kind_field = [0u8; 32];
        kind_field[31] = self.kind as u8;

        let mut val_field = [0u8; 32];
        val_field[24..32].copy_from_slice(&self.public_value.to_be_bytes());
        let mut relayer_fee_field = [0u8; 32];
        relayer_fee_field[24..32].copy_from_slice(&self.relayer_fee.to_be_bytes());

        [
            *context_field,
            *asset_field,
            kind_field,
            self.anchor_root,
            val_field,
            relayer_fee_field,
            action_field,
            self.nullifiers[0],
            self.nullifiers[1],
            self.outputs[0].cm,
            self.outputs[1].cm,
        ]
    }
}
