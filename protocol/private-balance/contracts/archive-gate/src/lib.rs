#![no_std]

use soroban_sdk::{BytesN, Env, contract, contracterror, contractimpl, contracttype};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Nullifier(BytesN<32>),
    ArchivePage(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ArchiveGateError {
    NullifierAlreadySpent = 1,
    ArchivePageMissing = 2,
}

#[contract]
pub struct ArchiveGate;

#[contractimpl]
impl ArchiveGate {
    /// Mirrors the pool's replay-critical `has -> reject -> set` sequence.
    /// The controlled gate deliberately leaves this entry at the network's
    /// minimum persistent TTL so current-Core archival can be reached quickly;
    /// the release pool applies the same storage semantics, then extends TTL.
    pub fn spend(env: Env, nullifier: BytesN<32>) -> Result<(), ArchiveGateError> {
        let key = DataKey::Nullifier(nullifier);
        if env.storage().persistent().has(&key) {
            return Err(ArchiveGateError::NullifierAlreadySpent);
        }
        env.storage()
            .persistent()
            .set(&key, &env.ledger().sequence());
        Ok(())
    }

    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    /// Mirrors archive-page persistence. As with `spend`, the gate leaves the
    /// initial entry at minimum TTL and tests the production touch-to-max path
    /// after restoration.
    pub fn write_page(env: Env, page_id: u32, value: BytesN<32>) {
        let key = DataKey::ArchivePage(page_id);
        env.storage().persistent().set(&key, &value);
    }

    pub fn read_page(env: Env, page_id: u32) -> Result<BytesN<32>, ArchiveGateError> {
        env.storage()
            .persistent()
            .get(&DataKey::ArchivePage(page_id))
            .ok_or(ArchiveGateError::ArchivePageMissing)
    }

    pub fn touch_page(env: Env, page_id: u32) -> Result<BytesN<32>, ArchiveGateError> {
        let key = DataKey::ArchivePage(page_id);
        let value = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ArchiveGateError::ArchivePageMissing)?;
        let max_ttl = env.storage().max_ttl();
        env.storage()
            .persistent()
            .extend_ttl(&key, max_ttl, max_ttl);
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::{ArchiveGate, ArchiveGateClient, ArchiveGateError};
    use soroban_sdk::{BytesN, Env};

    #[test]
    fn duplicate_nullifier_is_rejected() {
        let env = Env::default();
        let contract_id = env.register(ArchiveGate, ());
        let client = ArchiveGateClient::new(&env, &contract_id);
        let nullifier = BytesN::from_array(&env, &[7; 32]);

        client.spend(&nullifier);
        assert!(client.is_spent(&nullifier));
        assert_eq!(
            client.try_spend(&nullifier),
            Err(Ok(ArchiveGateError::NullifierAlreadySpent))
        );
    }

    #[test]
    fn archive_page_round_trips_and_touches() {
        let env = Env::default();
        let contract_id = env.register(ArchiveGate, ());
        let client = ArchiveGateClient::new(&env, &contract_id);
        let value = BytesN::from_array(&env, &[9; 32]);

        client.write_page(&3, &value);
        assert_eq!(client.read_page(&3), value);
        assert_eq!(client.touch_page(&3), value);
        assert_eq!(
            client.try_read_page(&4),
            Err(Ok(ArchiveGateError::ArchivePageMissing))
        );
    }
}
