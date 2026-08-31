use crate::{errors::PoolError, storage::PoolConfig};
use private_balance_protocol::{
    action::{Action as ProtocolAction, ActionKind},
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
}

impl OutputPackage {
    pub fn dummy(env: &Env) -> Self {
        Self {
            commitment: BytesN::from_array(env, &ZERO_FIELD),
            recipient_envelope: BytesN::from_array(env, &[0; 181]),
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositAction {
    pub asset: Address,
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub nullifier_0: BytesN<32>,
    pub nullifier_1: BytesN<32>,
    pub output_0: OutputPackage,
    pub output_1: OutputPackage,
    pub public_value: u64,
    pub deposit_source: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferAction {
    pub asset: Address,
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub nullifier_0: BytesN<32>,
    pub nullifier_1: BytesN<32>,
    pub output_0: OutputPackage,
    pub output_1: OutputPackage,
    pub public_value: u64,
    pub relayer_fee: u64,
    pub relayer: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawAction {
    pub asset: Address,
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub nullifier_0: BytesN<32>,
    pub nullifier_1: BytesN<32>,
    pub output_0: OutputPackage,
    pub output_1: OutputPackage,
    pub public_value: u64,
    pub public_recipient: Address,
    pub relayer_fee: u64,
    pub relayer: Address,
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
    if !is_canonical_field(&commitment) {
        return Err(PoolError::NoncanonicalEncoding);
    }
    if commitment == ZERO_FIELD && recipient_envelope != [0; 181] {
        return Err(PoolError::InvalidCommitment);
    }
    Ok(ProtocolOutputPackage {
        cm: commitment,
        recipient_envelope,
    })
}

fn validate_slots(
    anchor_root: &[u8; 32],
    nullifiers: &[[u8; 32]; 2],
    outputs: &[ProtocolOutputPackage; 2],
    is_deposit: bool,
    require_output: bool,
) -> Result<(), PoolError> {
    if !is_canonical_field(anchor_root) || !nullifiers.iter().all(is_canonical_field) {
        return Err(PoolError::NoncanonicalEncoding);
    }
    if require_output && outputs[0].cm == ZERO_FIELD {
        return Err(PoolError::InvalidActionShape);
    }
    if outputs[1].cm != ZERO_FIELD && outputs[0].cm == outputs[1].cm {
        return Err(PoolError::InvalidCommitment);
    }

    if is_deposit {
        if *anchor_root != ZERO_FIELD || *nullifiers != [ZERO_FIELD; 2] {
            return Err(PoolError::InvalidActionShape);
        }
    } else {
        if *anchor_root == ZERO_FIELD || nullifiers[0] == ZERO_FIELD {
            return Err(PoolError::InvalidActionShape);
        }
        if nullifiers[1] != ZERO_FIELD && nullifiers[0] == nullifiers[1] {
            return Err(PoolError::InvalidActionShape);
        }
    }
    Ok(())
}

fn checked_value(value: u64, must_be_zero: bool) -> Result<u64, PoolError> {
    if value > MAX_PUBLIC_VALUE || (must_be_zero && value != 0) || (!must_be_zero && value == 0) {
        return Err(PoolError::InvalidAmount);
    }
    Ok(value)
}

fn checked_relayer_fee(value: u64) -> Result<u64, PoolError> {
    if value > MAX_PUBLIC_VALUE {
        return Err(PoolError::InvalidAmount);
    }
    Ok(value)
}

pub(crate) fn from_deposit(action: &DepositAction) -> Result<ProtocolAction, PoolError> {
    let outputs = [
        protocol_output(&action.output_0)?,
        protocol_output(&action.output_1)?,
    ];
    let nullifiers = [action.nullifier_0.to_array(), action.nullifier_1.to_array()];
    let anchor_root = action.anchor_root.to_array();
    validate_slots(&anchor_root, &nullifiers, &outputs, true, true)?;
    Ok(ProtocolAction {
        protocol_version: PROTOCOL_VERSION,
        kind: ActionKind::Deposit,
        asset: (1, contract_payload(&action.asset)?),
        action_nonce: action.action_nonce.to_array(),
        anchor_root,
        nullifiers,
        outputs,
        public_value: checked_value(action.public_value, false)?,
        deposit_source: Some(address_payload(&action.deposit_source)?),
        public_recipient: None,
        relayer_fee: 0,
        relayer: None,
    })
}

pub(crate) fn from_transfer(action: &TransferAction) -> Result<ProtocolAction, PoolError> {
    let outputs = [
        protocol_output(&action.output_0)?,
        protocol_output(&action.output_1)?,
    ];
    let nullifiers = [action.nullifier_0.to_array(), action.nullifier_1.to_array()];
    let anchor_root = action.anchor_root.to_array();
    validate_slots(&anchor_root, &nullifiers, &outputs, false, true)?;
    Ok(ProtocolAction {
        protocol_version: PROTOCOL_VERSION,
        kind: ActionKind::PrivateTransfer,
        asset: (1, contract_payload(&action.asset)?),
        action_nonce: action.action_nonce.to_array(),
        anchor_root,
        nullifiers,
        outputs,
        public_value: checked_value(action.public_value, true)?,
        deposit_source: None,
        public_recipient: None,
        relayer_fee: checked_relayer_fee(action.relayer_fee)?,
        relayer: Some(address_payload(&action.relayer)?),
    })
}

pub(crate) fn from_withdraw(action: &WithdrawAction) -> Result<ProtocolAction, PoolError> {
    let outputs = [
        protocol_output(&action.output_0)?,
        protocol_output(&action.output_1)?,
    ];
    let nullifiers = [action.nullifier_0.to_array(), action.nullifier_1.to_array()];
    let anchor_root = action.anchor_root.to_array();
    validate_slots(&anchor_root, &nullifiers, &outputs, false, false)?;
    Ok(ProtocolAction {
        protocol_version: PROTOCOL_VERSION,
        kind: ActionKind::Withdraw,
        asset: (1, contract_payload(&action.asset)?),
        action_nonce: action.action_nonce.to_array(),
        anchor_root,
        nullifiers,
        outputs,
        public_value: checked_value(action.public_value, false)?,
        deposit_source: None,
        public_recipient: Some(address_payload(&action.public_recipient)?),
        relayer_fee: checked_relayer_fee(action.relayer_fee)?,
        relayer: Some(address_payload(&action.relayer)?),
    })
}

pub fn public_signals(
    env: &Env,
    config: &PoolConfig,
    action: &ProtocolAction,
) -> Result<[[u8; 32]; 13], PoolError> {
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

    #[test]
    fn full_withdrawal_without_private_change_is_valid() {
        let env = Env::default();
        let action = WithdrawAction {
            asset: AddressPayload::ContractIdHash(BytesN::from_array(&env, &[5; 32]))
                .to_address(&env),
            action_nonce: BytesN::from_array(&env, &[0x33; 32]),
            anchor_root: BytesN::from_array(&env, &[1; 32]),
            nullifier_0: BytesN::from_array(&env, &[2; 32]),
            nullifier_1: BytesN::from_array(&env, &[0; 32]),
            output_0: OutputPackage::dummy(&env),
            output_1: OutputPackage::dummy(&env),
            public_value: 1,
            public_recipient: AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(
                &env, &[3; 32],
            ))
            .to_address(&env),
            relayer_fee: 0,
            relayer: AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &[4; 32]))
                .to_address(&env),
        };

        assert!(from_withdraw(&action).is_ok());
    }
}
