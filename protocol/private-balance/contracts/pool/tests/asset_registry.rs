mod common;

use common::register_pool;
use private_balance_pool::{AssetStatus, PoolError, PrivateBalancePoolClient};
use soroban_sdk::{Address, BytesN, Env, address_payload::AddressPayload, testutils::Address as _};

fn contract_address(env: &Env, byte: u8) -> Address {
    AddressPayload::ContractIdHash(BytesN::from_array(env, &[byte; 32])).to_address(env)
}

#[test]
fn registry_indices_are_append_only_and_exit_only_is_reversible() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let second = contract_address(&env, 0x72);

    assert_eq!(client.add_asset(&second), 1);
    assert_eq!(env.auths().len(), 1);
    assert_eq!(env.auths()[0].0, fixture.asset_admin);
    assert_eq!(client.asset_count(), 2);
    assert_eq!(client.asset_index(&second), Some(1));
    assert_eq!(
        client.try_add_asset(&second),
        Err(Ok(PoolError::AssetAlreadyRegistered))
    );

    client.set_asset_status(&1, &AssetStatus::ExitOnly);
    let exit_only = client.asset(&1);
    assert_eq!(exit_only.index, 1);
    assert_eq!(exit_only.asset, second);
    assert_eq!(exit_only.status, AssetStatus::ExitOnly);

    client.set_asset_status(&1, &AssetStatus::Active);
    assert_eq!(client.asset(&1).status, AssetStatus::Active);
    assert_eq!(
        client.asset_count(),
        2,
        "status changes must not reuse indices"
    );
    assert_eq!(client.try_asset(&2), Err(Ok(PoolError::UnknownAsset)));
}

#[test]
fn asset_admin_handoff_requires_proposal_and_acceptance() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let client = PrivateBalancePoolClient::new(&env, &fixture.pool_id);
    let next = Address::generate(&env);

    assert_eq!(
        client.try_accept_asset_admin(),
        Err(Ok(PoolError::NoPendingAssetAdmin))
    );
    client.propose_asset_admin(&next);
    assert_eq!(client.asset_admin(), fixture.asset_admin);
    assert_eq!(client.pending_asset_admin(), Some(next.clone()));

    client.accept_asset_admin();
    assert_eq!(client.asset_admin(), next);
    assert_eq!(client.pending_asset_admin(), None);
    assert_eq!(client.config().initial_asset_admin, fixture.asset_admin);
}
