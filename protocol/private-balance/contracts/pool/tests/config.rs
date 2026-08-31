use private_balance_pool::{
    PrivateBalancePool, PrivateBalancePoolClient,
    generated_artifacts::{
        EXPECTED_CIRCUIT_HASH, EXPECTED_POSEIDON2_PARAMETER_HASH, EXPECTED_VERIFICATION_KEY_HASH,
    },
};
use private_balance_protocol::{
    constants::{
        ADDRESS_CHECKSUM_BYTES, ADDRESS_CONTEXT_TAG_BYTES, PAGE_CAPACITY,
        PRIVATE_ADDRESS_ASCII_BYTES, PRIVATE_ADDRESS_PAYLOAD_BYTES, PROTOCOL_VERSION,
        ROOT_WINDOW_LEDGERS, TREE_DEPTH,
    },
    deployment::DeploymentBinding,
    encoding::{compute_context_field, compute_context_hash},
};
use soroban_sdk::{Address, BytesN, Env, address_payload::AddressPayload, testutils::Address as _};

fn payload(address: &Address) -> (u8, [u8; 32]) {
    match AddressPayload::from_address(address).expect("supported address") {
        AddressPayload::AccountIdPublicKeyEd25519(value) => (0, value.to_array()),
        AddressPayload::ContractIdHash(value) => (1, value.to_array()),
    }
}

#[test]
fn constructor_binds_exact_immutable_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    let network_id = env.ledger().network_id();
    let realm_id = BytesN::from_array(&env, &[2; 32]);
    let pool_id =
        AddressPayload::ContractIdHash(BytesN::from_array(&env, &[3; 32])).to_address(&env);
    let guardian = Address::generate(&env);
    let deployment_binding_hash = DeploymentBinding {
        protocol_version: PROTOCOL_VERSION,
        network_id: network_id.to_array(),
        realm_id: realm_id.to_array(),
        pool_id: payload(&pool_id).1,
        guardian: payload(&guardian),
        poseidon2_parameter_hash: EXPECTED_POSEIDON2_PARAMETER_HASH,
        circuit_hash: EXPECTED_CIRCUIT_HASH,
        verification_key_hash: EXPECTED_VERIFICATION_KEY_HASH,
        tree_depth: TREE_DEPTH as u32,
        root_window_ledgers: ROOT_WINDOW_LEDGERS,
        page_capacity: PAGE_CAPACITY as u32,
        private_address_payload_bytes: PRIVATE_ADDRESS_PAYLOAD_BYTES as u32,
        private_address_ascii_bytes: PRIVATE_ADDRESS_ASCII_BYTES as u32,
        address_context_tag_bytes: ADDRESS_CONTEXT_TAG_BYTES as u32,
        address_checksum_bytes: ADDRESS_CHECKSUM_BYTES as u32,
        hpke_kem_id: 0x0020,
        hpke_kdf_id: 0x0001,
        hpke_aead_id: 0x0001,
    }
    .hash()
    .expect("valid deployment binding");

    env.register_at(
        &pool_id,
        PrivateBalancePool,
        (
            PROTOCOL_VERSION as u32,
            &network_id,
            &realm_id,
            &guardian,
            &BytesN::from_array(&env, &EXPECTED_POSEIDON2_PARAMETER_HASH),
            &BytesN::from_array(&env, &EXPECTED_CIRCUIT_HASH),
            &BytesN::from_array(&env, &EXPECTED_VERIFICATION_KEY_HASH),
            TREE_DEPTH as u32,
            ROOT_WINDOW_LEDGERS,
            PAGE_CAPACITY as u32,
            &BytesN::from_array(&env, &deployment_binding_hash),
        ),
    );
    let client = PrivateBalancePoolClient::new(&env, &pool_id);
    let config = client.config();

    assert_eq!(config.protocol_version, PROTOCOL_VERSION as u32);
    assert_eq!(config.network_id, network_id);
    assert_eq!(config.realm_id, realm_id);
    assert_eq!(config.guardian, guardian);
    assert_eq!(
        config.deployment_binding_hash.to_array(),
        deployment_binding_hash
    );
    let expected_context_hash = compute_context_hash(
        PROTOCOL_VERSION,
        &config.network_id.to_array(),
        &config.realm_id.to_array(),
        &payload(&pool_id).1,
    );
    assert_eq!(config.context_hash.to_array(), expected_context_hash);
    assert_eq!(
        config.context_field.to_array(),
        compute_context_field(&expected_context_hash),
    );

    assert!(!client.deposits_paused());
    client.set_deposits_paused(&true);
    assert!(client.deposits_paused());
    assert_eq!(
        client.config(),
        config,
        "pause state must not mutate Config"
    );
}

#[test]
fn constructor_context_is_asset_agnostic() {
    let env = Env::default();
    env.mock_all_auths();
    let network_id = env.ledger().network_id();
    let realm_id = BytesN::from_array(&env, &[2; 32]);
    let pool_id =
        AddressPayload::ContractIdHash(BytesN::from_array(&env, &[3; 32])).to_address(&env);
    let guardian = Address::generate(&env);
    let deployment_binding_hash = DeploymentBinding {
        protocol_version: PROTOCOL_VERSION,
        network_id: network_id.to_array(),
        realm_id: realm_id.to_array(),
        pool_id: payload(&pool_id).1,
        guardian: payload(&guardian),
        poseidon2_parameter_hash: EXPECTED_POSEIDON2_PARAMETER_HASH,
        circuit_hash: EXPECTED_CIRCUIT_HASH,
        verification_key_hash: EXPECTED_VERIFICATION_KEY_HASH,
        tree_depth: TREE_DEPTH as u32,
        root_window_ledgers: ROOT_WINDOW_LEDGERS,
        page_capacity: PAGE_CAPACITY as u32,
        private_address_payload_bytes: PRIVATE_ADDRESS_PAYLOAD_BYTES as u32,
        private_address_ascii_bytes: PRIVATE_ADDRESS_ASCII_BYTES as u32,
        address_context_tag_bytes: ADDRESS_CONTEXT_TAG_BYTES as u32,
        address_checksum_bytes: ADDRESS_CHECKSUM_BYTES as u32,
        hpke_kem_id: 0x0020,
        hpke_kdf_id: 0x0001,
        hpke_aead_id: 0x0001,
    }
    .hash()
    .expect("valid deployment binding");

    env.register_at(
        &pool_id,
        PrivateBalancePool,
        (
            PROTOCOL_VERSION as u32,
            &network_id,
            &realm_id,
            &guardian,
            &BytesN::from_array(&env, &EXPECTED_POSEIDON2_PARAMETER_HASH),
            &BytesN::from_array(&env, &EXPECTED_CIRCUIT_HASH),
            &BytesN::from_array(&env, &EXPECTED_VERIFICATION_KEY_HASH),
            TREE_DEPTH as u32,
            ROOT_WINDOW_LEDGERS,
            PAGE_CAPACITY as u32,
            &BytesN::from_array(&env, &deployment_binding_hash),
        ),
    );

    let config = PrivateBalancePoolClient::new(&env, &pool_id).config();
    assert_eq!(
        config.context_hash.to_array(),
        compute_context_hash(
            PROTOCOL_VERSION,
            &network_id.to_array(),
            &realm_id.to_array(),
            &payload(&pool_id).1,
        ),
    );
    assert_eq!(
        config.deployment_binding_hash.to_array(),
        deployment_binding_hash,
    );
}
