use private_balance_protocol::encoding::*;
use private_balance_protocol::keys::*;

#[test]
fn test_key_derivation_deterministic() {
    let raw_seed = [0x11u8; 32];
    let net_id = [0x22u8; 32];
    let realm_id = [0x33u8; 32];
    let pool_id = [0x44u8; 32];
    let pub_key = [0x66u8; 32];

    let context_hash = compute_context_hash(1, &net_id, &realm_id, &pool_id);
    let context_field = compute_context_field(&context_hash);

    let k1 = derive_keys_from_seed(
        &raw_seed,
        1,
        &net_id,
        &realm_id,
        &pool_id,
        &pub_key,
        &context_field,
    );
    let k2 = derive_keys_from_seed(
        &raw_seed,
        1,
        &net_id,
        &realm_id,
        &pool_id,
        &pub_key,
        &context_field,
    );

    assert_eq!(k1.ask, k2.ask);
    assert_eq!(k1.nk, k2.nk);
    assert_eq!(k1.owner_commitment, k2.owner_commitment);
    assert_eq!(k1.hpke_private_key, k2.hpke_private_key);
    assert_eq!(k1.hpke_public_key, k2.hpke_public_key);
    assert_ne!(k1.ask, [0u8; 32]);
    assert_ne!(k1.nk, [0u8; 32]);
    assert_ne!(k1.owner_commitment, [0u8; 32]);

    let vk = k1.to_viewing_key();
    assert_eq!(vk.owner_commitment, k1.owner_commitment);
    assert_eq!(vk.nk, k1.nk);
    assert_eq!(vk.hpke_private_key, k1.hpke_private_key);
    assert_eq!(vk.hpke_public_key, k1.hpke_public_key);
}
