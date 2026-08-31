use private_balance_protocol::{
    address::PrivateAddress,
    encoding::{compute_context_field, compute_context_hash},
    keys::derive_keys_from_seed,
};
use rand::{RngCore, SeedableRng, rngs::StdRng};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyAddressCase {
    raw_seed: String,
    network_id: String,
    realm_id: String,
    pool_id: String,
    account_public_key: String,
    context_hash: String,
    context_field: String,
    base_owner_commitment: String,
    diversifier: String,
    ask: String,
    nk: String,
    owner_commitment: String,
    hpke_private_key: String,
    hpke_public_key: String,
    prefix: &'static str,
    address: String,
}

fn random_bytes(rng: &mut StdRng) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    rng.fill_bytes(&mut bytes);
    bytes
}

fn main() {
    let count = env::args()
        .nth(1)
        .map(|value| value.parse::<usize>().expect("count must be an integer"))
        .unwrap_or(1_000);
    assert!((1..=10_000).contains(&count), "count outside test bound");

    let mut rng = StdRng::seed_from_u64(0x5354_454c_4c41_524b);
    let mut cases = Vec::with_capacity(count);
    for index in 0..count {
        let raw_seed = random_bytes(&mut rng);
        let network_id = random_bytes(&mut rng);
        let realm_id = random_bytes(&mut rng);
        let pool_id = random_bytes(&mut rng);
        let account_public_key = random_bytes(&mut rng);
        let context_hash = compute_context_hash(1, &network_id, &realm_id, &pool_id);
        let context_field = compute_context_field(&context_hash);
        let keys = derive_keys_from_seed(
            &raw_seed,
            1,
            &network_id,
            &realm_id,
            &pool_id,
            &account_public_key,
            &context_field,
        );
        let diversifier = [0u8; 4];
        let prefix = if index % 2 == 0 { "tks" } else { "sks" };
        let address = PrivateAddress {
            diversifier,
            owner_commitment: keys.owner_commitment,
            hpke_public_key: keys.hpke_public_key,
        }
        .encode(prefix)
        .expect("derived address must be valid");

        cases.push(KeyAddressCase {
            raw_seed: hex::encode(raw_seed),
            network_id: hex::encode(network_id),
            realm_id: hex::encode(realm_id),
            pool_id: hex::encode(pool_id),
            account_public_key: hex::encode(account_public_key),
            context_hash: hex::encode(context_hash),
            context_field: hex::encode(context_field),
            base_owner_commitment: hex::encode(keys.base_owner_commitment),
            diversifier: hex::encode(diversifier),
            ask: hex::encode(keys.ask),
            nk: hex::encode(keys.nk),
            owner_commitment: hex::encode(keys.owner_commitment),
            hpke_private_key: hex::encode(keys.hpke_private_key),
            hpke_public_key: hex::encode(keys.hpke_public_key),
            prefix,
            address,
        });
    }

    println!(
        "{}",
        serde_json::to_string(&cases).expect("cases must serialize")
    );
}
