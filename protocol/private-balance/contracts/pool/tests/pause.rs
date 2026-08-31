mod common;

use common::register_pool;
use private_balance_pool::PrivateBalancePoolClient;
use soroban_sdk::Env;

#[test]
fn test_pool_guardian_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let fixture = register_pool(&env);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);

    assert!(!pool_client.deposits_paused());

    // Guardian pauses deposits
    pool_client.set_deposits_paused(&true);
    assert!(pool_client.deposits_paused());

    // Guardian unpauses deposits
    pool_client.set_deposits_paused(&false);
    assert!(!pool_client.deposits_paused());
}
