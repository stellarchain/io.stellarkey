use crate::{errors::PoolError, storage::DataKey};
use soroban_sdk::{BytesN, Env, contracttype};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpentNullifier {
    pub spent_at_action: u32,
    pub spent_at_ledger: u32,
}

pub fn is_spent(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Nullifier(nullifier.clone()))
}

pub(crate) fn require_unspent(env: &Env, nullifier: &BytesN<32>) -> Result<(), PoolError> {
    if is_spent(env, nullifier) {
        return Err(PoolError::NullifierAlreadySpent);
    }
    Ok(())
}

pub(crate) fn mark_spent(env: &Env, nullifier: &BytesN<32>, action_index: u32) {
    let key = DataKey::Nullifier(nullifier.clone());
    let value = SpentNullifier {
        spent_at_action: action_index,
        spent_at_ledger: env.ledger().sequence(),
    };
    env.storage().persistent().set(&key, &value);
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(&key, max_ttl, max_ttl);
}
