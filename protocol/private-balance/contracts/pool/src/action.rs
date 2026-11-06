use crate::{
    errors::PoolError,
    storage::{AssetConfig, PoolConfig},
};
use private_balance_protocol::{
    action::{Action as ProtocolAction, ActionError},
    constants::PROTOCOL_VERSION,
    encryption::OutputPackage as ProtocolOutputPackage,
    field::is_canonical_field,
};
use soroban_sdk::{Address, BytesN, Env, address_payload::AddressPayload, contracttype};

const ZERO_FIELD: [u8; 32] = [0; 32];
const MAX_PUBLIC_VALUE: u64 = i64::MAX as u64;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputPackage {
    pub commitment: BytesN<32>,
    pub recipient_envelope: BytesN<181>,
    pub outgoing_envelope: BytesN<157>,
}

/// The one calldata shape for every shielded action. Protocol V3 publishes no
/// action kind: the settlement legs classify the action (inflow-only is a
/// deposit, outflow-only a withdrawal, both zero an internal transfer) and
/// `appends` selects whether the three commitments enter the tree. Which legs
/// carry value is already visible from the ledger token movement, so these
/// public fields add no information beyond it, while a published kind did.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShieldedAction {
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub nullifier_0: BytesN<32>,
    pub nullifier_1: BytesN<32>,
    pub output_0: OutputPackage,
    pub output_1: OutputPackage,
    pub output_2: OutputPackage,
    pub public_inflow: u64,
    pub public_outflow: u64,
    pub appends: bool,
    pub asset_index: Option<u32>,
    pub deposit_source: Option<Address>,
    pub public_recipient: Option<Address>,
}

pub(crate) fn address_payload(address: &Address) -> Result<(u8, [u8; 32]), PoolError> {
    let payload =
        match AddressPayload::from_address(address).ok_or(PoolError::NoncanonicalEncoding)? {
            AddressPayload::AccountIdPublicKeyEd25519(value) => (0, value.to_array()),
            AddressPayload::ContractIdHash(value) => (1, value.to_array()),
        };
    if payload.1 == ZERO_FIELD {
        return Err(PoolError::NoncanonicalEncoding);
    }
    Ok(payload)
}

pub(crate) fn contract_payload(address: &Address) -> Result<[u8; 32], PoolError> {
    match AddressPayload::from_address(address).ok_or(PoolError::NoncanonicalEncoding)? {
        AddressPayload::ContractIdHash(value) if value.to_array() != ZERO_FIELD => {
            Ok(value.to_array())
        }
        AddressPayload::ContractIdHash(_) | AddressPayload::AccountIdPublicKeyEd25519(_) => {
            Err(PoolError::NoncanonicalEncoding)
        }
    }
}

fn protocol_output(output: &OutputPackage) -> Result<ProtocolOutputPackage, PoolError> {
    let commitment = output.commitment.to_array();
    let recipient_envelope = output.recipient_envelope.to_array();
    let outgoing_envelope = output.outgoing_envelope.to_array();
    if !is_canonical_field(&commitment) {
        return Err(PoolError::NoncanonicalEncoding);
    }
    Ok(ProtocolOutputPackage {
        cm: commitment,
        recipient_envelope,
        outgoing_envelope,
    })
}

fn validate_slots(
    anchor_root: &[u8; 32],
    nullifiers: &[[u8; 32]; 2],
    outputs: &[ProtocolOutputPackage; 3],
) -> Result<(), PoolError> {
    if !is_canonical_field(anchor_root) || !nullifiers.iter().all(is_canonical_field) {
        return Err(PoolError::NoncanonicalEncoding);
    }
    if nullifiers.iter().any(|nullifier| *nullifier == ZERO_FIELD)
        || outputs.iter().any(|output| {
            output.cm == ZERO_FIELD
                || output.recipient_envelope == [0; 181]
                || output.outgoing_envelope == [0; 157]
        })
    {
        return Err(PoolError::InvalidActionShape);
    }
    if outputs[0].cm == outputs[1].cm
        || outputs[0].cm == outputs[2].cm
        || outputs[1].cm == outputs[2].cm
    {
        return Err(PoolError::InvalidCommitment);
    }
    if nullifiers[0] == nullifiers[1] {
        return Err(PoolError::InvalidActionShape);
    }
    Ok(())
}

fn checked_value(value: u64) -> Result<u64, PoolError> {
    if value > MAX_PUBLIC_VALUE {
        return Err(PoolError::InvalidAmount);
    }
    Ok(value)
}

pub(crate) fn from_unified(
    action: &ShieldedAction,
    asset: Option<&AssetConfig>,
) -> Result<ProtocolAction, PoolError> {
    let outputs = [
        protocol_output(&action.output_0)?,
        protocol_output(&action.output_1)?,
        protocol_output(&action.output_2)?,
    ];
    let nullifiers = [action.nullifier_0.to_array(), action.nullifier_1.to_array()];
    let anchor_root = action.anchor_root.to_array();
    let public_inflow = checked_value(action.public_inflow)?;
    let public_outflow = checked_value(action.public_outflow)?;
    if public_inflow > 0 && public_outflow > 0 {
        return Err(PoolError::InvalidAmount);
    }
    validate_slots(&anchor_root, &nullifiers, &outputs)?;
    let asset_payload = match asset {
        Some(value) => Some((1, contract_payload(&value.asset)?)),
        None => None,
    };
    let converted = ProtocolAction {
        protocol_version: PROTOCOL_VERSION,
        asset_index: action.asset_index,
        asset: asset_payload,
        action_nonce: action.action_nonce.to_array(),
        anchor_root,
        nullifiers,
        outputs,
        public_inflow,
        public_outflow,
        appends: action.appends,
        deposit_source: action
            .deposit_source
            .as_ref()
            .map(address_payload)
            .transpose()?,
        public_recipient: action
            .public_recipient
            .as_ref()
            .map(address_payload)
            .transpose()?,
    };
    converted.validate_public_shape().map_err(action_error)?;
    Ok(converted)
}

pub(crate) fn action_error(error: ActionError) -> PoolError {
    match error {
        ActionError::InvalidProtocolVersion => PoolError::UnsupportedProtocol,
        ActionError::InvalidAsset
        | ActionError::InvalidDepositSource
        | ActionError::InvalidPublicRecipient
        | ActionError::InvalidAppends
        | ActionError::InvalidSlots => PoolError::InvalidActionShape,
        ActionError::InvalidPublicValue => PoolError::InvalidAmount,
        ActionError::DuplicateNullifiers | ActionError::DuplicateOutputs => {
            PoolError::InvalidCommitment
        }
        ActionError::NonCanonicalField => PoolError::NoncanonicalEncoding,
    }
}

pub fn public_signals(
    env: &Env,
    config: &PoolConfig,
    action: &ProtocolAction,
) -> Result<[[u8; 32]; 12], PoolError> {
    let pool_id = contract_payload(&env.current_contract_address())?;
    Ok(action.compute_public_signals(
        &config.context_field.to_array(),
        &config.network_id.to_array(),
        &config.realm_id.to_array(),
        &pool_id,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_outputs(env: &Env) -> [OutputPackage; 3] {
        [
            OutputPackage {
                commitment: BytesN::from_array(env, &[4; 32]),
                recipient_envelope: BytesN::from_array(env, &[5; 181]),
                outgoing_envelope: BytesN::from_array(env, &[6; 157]),
            },
            OutputPackage {
                commitment: BytesN::from_array(env, &[7; 32]),
                recipient_envelope: BytesN::from_array(env, &[8; 181]),
                outgoing_envelope: BytesN::from_array(env, &[9; 157]),
            },
            OutputPackage {
                commitment: BytesN::from_array(env, &[10; 32]),
                recipient_envelope: BytesN::from_array(env, &[11; 181]),
                outgoing_envelope: BytesN::from_array(env, &[12; 157]),
            },
        ]
    }

    fn withdrawal_action(env: &Env) -> ShieldedAction {
        let outputs = sample_outputs(env);
        ShieldedAction {
            action_nonce: BytesN::from_array(env, &[0x33; 32]),
            anchor_root: BytesN::from_array(env, &[1; 32]),
            nullifier_0: BytesN::from_array(env, &[2; 32]),
            nullifier_1: BytesN::from_array(env, &[3; 32]),
            output_0: outputs[0].clone(),
            output_1: outputs[1].clone(),
            output_2: outputs[2].clone(),
            public_inflow: 0,
            public_outflow: 1,
            appends: true,
            asset_index: Some(0),
            deposit_source: None,
            public_recipient: Some(
                AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[3; 32]))
                    .to_address(env),
            ),
        }
    }

    #[test]
    fn withdrawal_without_private_change_is_valid() {
        let env = Env::default();
        let asset = AssetConfig {
            index: 0,
            asset: AddressPayload::ContractIdHash(BytesN::from_array(&env, &[5; 32]))
                .to_address(&env),
            asset_field: BytesN::from_array(&env, &[6; 32]),
            status: crate::storage::AssetStatus::Active,
        };
        assert!(from_unified(&withdrawal_action(&env), Some(&asset)).is_ok());
    }

    #[test]
    fn a_non_appending_action_must_settle_value() {
        let env = Env::default();
        let asset = AssetConfig {
            index: 0,
            asset: AddressPayload::ContractIdHash(BytesN::from_array(&env, &[5; 32]))
                .to_address(&env),
            asset_field: BytesN::from_array(&env, &[6; 32]),
            status: crate::storage::AssetStatus::Active,
        };
        let mut action = withdrawal_action(&env);
        action.appends = false;
        action.public_outflow = 0;
        assert!(from_unified(&action, Some(&asset)).is_err());
    }
}
