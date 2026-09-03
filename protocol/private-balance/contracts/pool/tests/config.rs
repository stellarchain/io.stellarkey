mod common;

use common::{payload, register_pool};
use private_balance_pool::{AssetStatus, PrivateBalancePoolClient};
use private_balance_protocol::{
    action::compute_asset_field,
    constants::PROTOCOL_VERSION,
    encoding::{compute_context_field, compute_context_hash},
};
use soroban_sdk::Env;

#[test]
fn constructor_binds_one_pool_context_and_an_initial_asset_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let config = client.config();

    assert_eq!(config.protocol_version, u32::from(PROTOCOL_VERSION));
    assert_eq!(config.guardian, fixture.guardian);
    assert_eq!(config.initial_asset_admin, fixture.asset_admin);
    assert_eq!(client.asset_admin(), fixture.asset_admin);
    assert_eq!(client.pending_asset_admin(), None);

    let expected_context_hash = compute_context_hash(
        PROTOCOL_VERSION,
        &config.network_id.to_array(),
        &config.realm_id.to_array(),
        &payload(&fixture.pool_id).1,
    );
    assert_eq!(config.context_hash.to_array(), expected_context_hash);
    assert_eq!(
        config.context_field.to_array(),
        compute_context_field(&expected_context_hash),
    );

    assert_eq!(client.asset_count(), 1);
    let registered = client.asset(&0);
    assert_eq!(registered.index, 0);
    assert_eq!(registered.asset, fixture.asset);
    assert_eq!(registered.status, AssetStatus::Active);
    assert_eq!(
        registered.asset_field.to_array(),
        compute_asset_field(payload(&fixture.asset)),
    );
    assert_eq!(client.asset_index(&fixture.asset), Some(0));
}

#[test]
fn pause_state_does_not_mutate_the_immutable_deployment_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let config = client.config();

    assert!(!client.deposits_paused());
    client.set_deposits_paused(&true);
    assert!(client.deposits_paused());
    assert_eq!(client.config(), config);
}
