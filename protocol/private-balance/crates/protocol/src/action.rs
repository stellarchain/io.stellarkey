use crate::constants::{DOMAIN_ACTION, DOMAIN_ASSET};
use crate::encoding::{
    encode_address, encode_domain, encode_optional_address, encode_u16_be, encode_u32_be,
    encode_u64_be,
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

/// A uniform shielded action. Protocol V3 publishes no action kind: the two
/// settlement legs classify every action by the only part of it a transparent
/// ledger can see anyway. Inflow-only is a deposit, outflow-only is a
/// withdrawal (with `appends` selecting whether change commitments enter the
/// tree), and two zero legs are an internal transfer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub protocol_version: u16,
    pub asset_index: Option<u32>,
    pub asset: Option<(u8, [u8; 32])>,
    pub action_nonce: [u8; 32],
    pub anchor_root: [u8; 32],
    pub nullifiers: [[u8; 32]; 2],
    pub outputs: [OutputPackage; 3],
    pub public_inflow: u64,
    pub public_outflow: u64,
    pub appends: bool,
    pub deposit_source: Option<(u8, [u8; 32])>,
    pub public_recipient: Option<(u8, [u8; 32])>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionError {
    InvalidProtocolVersion,
    InvalidAsset,
    InvalidPublicValue,
    InvalidDepositSource,
    InvalidPublicRecipient,
    InvalidAppends,
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
        if self.public_inflow > i64::MAX as u64 || self.public_outflow > i64::MAX as u64 {
            return Err(ActionError::InvalidPublicValue);
        }
        if self.public_inflow > 0 && self.public_outflow > 0 {
            return Err(ActionError::InvalidPublicValue);
        }
        if !self.appends && self.public_outflow == 0 {
            // Only a settled spend may skip the append: deposits and transfers
            // exist through their commitments.
            return Err(ActionError::InvalidAppends);
        }
        if self.asset.is_some() != self.asset_index.is_some() {
            return Err(ActionError::InvalidAsset);
        }
        if let Some(asset) = self.asset
            && (asset.0 != 1 || asset.1 == ZERO)
        {
            return Err(ActionError::InvalidAsset);
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
        if self.outputs[0].cm == self.outputs[1].cm
            || self.outputs[0].cm == self.outputs[2].cm
            || self.outputs[1].cm == self.outputs[2].cm
        {
            return Err(ActionError::DuplicateOutputs);
        }
        if self.public_inflow > 0 {
            if self.anchor_root != ZERO
                || self.asset.is_none()
                || self.deposit_source.is_none()
                || self.public_recipient.is_some()
            {
                return Err(ActionError::InvalidDepositSource);
            }
        } else if self.public_outflow > 0 {
            if self.anchor_root == ZERO
                || self.asset.is_none()
                || self.deposit_source.is_some()
                || self.public_recipient.is_none()
            {
                return Err(ActionError::InvalidPublicRecipient);
            }
        } else {
            // Quiet internal transfer: no public endpoints at all.
            if self.anchor_root == ZERO
                || self.asset.is_some()
                || self.deposit_source.is_some()
                || self.public_recipient.is_some()
            {
                return Err(ActionError::InvalidSlots);
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
        buf.push(u8::from(self.appends));
        encode_optional_address(self.asset, &mut buf).unwrap();
        encode_u32_be(self.asset_index.unwrap_or(0), &mut buf);
        buf.extend_from_slice(&self.action_nonce);
        buf.extend_from_slice(&self.anchor_root);
        buf.extend_from_slice(&self.nullifiers[0]);
        buf.extend_from_slice(&self.nullifiers[1]);
        buf.extend_from_slice(&self.outputs[0].serialize());
        buf.extend_from_slice(&self.outputs[1].serialize());
        buf.extend_from_slice(&self.outputs[2].serialize());
        encode_u64_be(self.public_inflow, &mut buf);
        encode_u64_be(self.public_outflow, &mut buf);
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
        self.asset.map(compute_asset_field).unwrap_or([0; 32])
    }

    pub fn compute_public_signals(
        &self,
        context_field: &[u8; 32],
        network_id: &[u8; 32],
        realm_id: &[u8; 32],
        pool_id: &[u8; 32],
    ) -> [[u8; 32]; 12] {
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
    ) -> [[u8; 32]; 12] {
        let action_field = self.compute_action_field(network_id, realm_id, pool_id);

        let mut inflow_field = [0u8; 32];
        inflow_field[24..32].copy_from_slice(&self.public_inflow.to_be_bytes());

        let mut outflow_field = [0u8; 32];
        outflow_field[24..32].copy_from_slice(&self.public_outflow.to_be_bytes());

        let mut appends_field = [0u8; 32];
        appends_field[31] = u8::from(self.appends);

        [
            *context_field,
            *asset_field,
            inflow_field,
            outflow_field,
            appends_field,
            self.anchor_root,
            action_field,
            self.nullifiers[0],
            self.nullifiers[1],
            self.outputs[0].cm,
            self.outputs[1].cm,
            self.outputs[2].cm,
        ]
    }
}
