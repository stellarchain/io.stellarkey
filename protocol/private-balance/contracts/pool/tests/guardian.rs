mod common;

use common::register_pool;
use private_balance_pool::PrivateBalancePoolClient;
use soroban_sdk::Env;

#[test]
fn test_pool_guardian_is_immutable_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let pool_client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let config = pool_client.config();

    assert_eq!(config.guardian, fixture.guardian);
    pool_client.set_deposits_paused(&true);
    assert_eq!(pool_client.config(), config);
}
