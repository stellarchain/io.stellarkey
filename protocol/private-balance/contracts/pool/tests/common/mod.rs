use private_balance_pool::{
    PrivateBalancePool,
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
};
use soroban_sdk::{
    Address, Bytes, BytesN, Env,
    address_payload::AddressPayload,
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
};

#[contracttype]
#[derive(Clone)]
enum TokenDataKey {
    Balance(Address),
}

#[contract]
pub struct MockNativeToken;

#[contractimpl]
impl MockNativeToken {
    pub fn balance(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&TokenDataKey::Balance(owner))
            .unwrap_or(0)
    }

    pub fn mint(env: Env, owner: Address, amount: i128) {
        let key = TokenDataKey::Balance(owner);
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(balance + amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0, "negative transfer");
        let from_key = TokenDataKey::Balance(from);
        let to_key = TokenDataKey::Balance(to);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }
}

#[allow(dead_code)]
pub struct PoolFixture {
    pub pool_id: Address,
    pub asset: Address,
    pub guardian: Address,
}

pub fn payload(address: &Address) -> (u8, [u8; 32]) {
    match AddressPayload::from_address(address).expect("supported address") {
        AddressPayload::AccountIdPublicKeyEd25519(value) => (0, value.to_array()),
        AddressPayload::ContractIdHash(value) => (1, value.to_array()),
    }
}

pub fn register_pool(env: &Env) -> PoolFixture {
    env.ledger().set_network_id([
        0xce, 0xe0, 0x30, 0x2d, 0x59, 0x84, 0x4d, 0x32, 0xbd, 0xca, 0x91, 0x5c, 0x82, 0x03, 0xdd,
        0x44, 0xb3, 0x3f, 0xbb, 0x7e, 0xdc, 0x19, 0x05, 0x1e, 0xa3, 0x7a, 0xbe, 0xdf, 0x28, 0xec,
        0xd4, 0x72,
    ]);
    let network_id = env.ledger().network_id();
    let realm_id = BytesN::from_array(env, &[2; 32]);
    let pool_id = AddressPayload::ContractIdHash(BytesN::from_array(env, &[3; 32])).to_address(env);
    let asset = env
        .deployer()
        .with_stellar_asset(Bytes::from_array(env, &[0; 4]))
        .deployed_address();
    env.register_at(&asset, MockNativeToken, ());
    let guardian = Address::generate(env);
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
            &BytesN::from_array(env, &EXPECTED_POSEIDON2_PARAMETER_HASH),
            &BytesN::from_array(env, &EXPECTED_CIRCUIT_HASH),
            &BytesN::from_array(env, &EXPECTED_VERIFICATION_KEY_HASH),
            TREE_DEPTH as u32,
            ROOT_WINDOW_LEDGERS,
            PAGE_CAPACITY as u32,
            &BytesN::from_array(env, &deployment_binding_hash),
        ),
    );

    PoolFixture {
        pool_id,
        asset,
        guardian,
    }
}
