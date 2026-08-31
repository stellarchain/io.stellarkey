mod common;

use common::register_pool;
use private_balance_pool::{
    PrivateBalancePoolClient,
    errors::PoolError,
    storage::{DataKey, KnownRoot},
};
use private_balance_protocol::constants::ROOT_WINDOW_LEDGERS;
use soroban_sdk::{BytesN, Env, testutils::Ledger as _};

#[test]
fn expired_root_is_rejected_while_temporary_key_still_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let root = client.tree_state().current_root;
    let key = DataKey::KnownRoot(root.clone());

    let known: KnownRoot = env.as_contract(&fixture.pool_id, || {
        env.storage()
            .temporary()
            .get(&key)
            .expect("constructor root must be retained")
    });
    assert_eq!(known.created_at_ledger, env.ledger().sequence());
    assert_eq!(
        known.valid_until_ledger,
        known.created_at_ledger + ROOT_WINDOW_LEDGERS,
    );

    env.ledger()
        .set_sequence_number(known.valid_until_ledger + 1);
    let retained: Option<KnownRoot> =
        env.as_contract(&fixture.pool_id, || env.storage().temporary().get(&key));
    assert!(
        retained.is_some(),
        "TTL safety margin must keep the key present"
    );

    let result = env.as_contract(&fixture.pool_id, || {
        private_balance_pool::storage::known_root(&env, &BytesN::from_array(&env, &root.to_array()))
    });
    assert_eq!(result, Err(PoolError::RootExpired));
}
