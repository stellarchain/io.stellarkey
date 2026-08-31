use private_balance_protocol::{encoding, keys};
use private_balance_test_support::hpke_oracle::hpke_derive_keypair;

#[test]
fn diversified_hpke_keys_match_the_independent_rfc9180_oracle() {
    let raw_seed = [0x11u8; 32];
    let network_id = [0x22u8; 32];
    let realm_id = [0x33u8; 32];
    let pool_id = [0x44u8; 32];
    let account_public_key = [0x66u8; 32];
    let context_hash = encoding::compute_context_hash(1, &network_id, &realm_id, &pool_id);
    let context_field = encoding::compute_context_field(&context_hash);

    let derived = keys::derive_keys_from_seed(
        &raw_seed,
        1,
        &network_id,
        &realm_id,
        &pool_id,
        &account_public_key,
        &context_field,
    );
    let (expected_viewing_root, expected_default_private, expected_default_public) =
        hpke_derive_keys_from_seed(
            &raw_seed,
            1,
            &network_id,
            &realm_id,
            &pool_id,
            &account_public_key,
        );

    assert_eq!(derived.hpke_private_key.as_slice(), expected_viewing_root);
    assert_eq!(derived.hpke_public_key.as_slice(), expected_default_public);
    assert_ne!(
        derived.hpke_private_key.as_slice(),
        expected_default_private
    );
}

fn hpke_derive_keys_from_seed(
    raw_seed: &[u8; 32],
    protocol_version: u16,
    network_id: &[u8; 32],
    realm_id: &[u8; 32],
    pool_id: &[u8; 32],
    account_public_key: &[u8; 32],
) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    use hkdf::Hkdf;
    use sha2::{Digest, Sha512};

    let mut context = Vec::new();
    context.extend_from_slice(&protocol_version.to_be_bytes());
    context.extend_from_slice(network_id);
    context.extend_from_slice(realm_id);
    context.extend_from_slice(pool_id);
    context.extend_from_slice(account_public_key);

    let salt = Sha512::digest([b"SKSB_ROOT_V1".as_slice(), context.as_slice()].concat());
    let hkdf = Hkdf::<Sha512>::new(Some(&salt), raw_seed);
    let mut ikm = [0u8; 32];
    let info = [b"SKSB_HPKE_IKM_V1".as_slice(), context.as_slice()].concat();
    hkdf.expand(&info, &mut ikm).expect("valid HKDF length");
    let (root, _) = hpke_derive_keypair(&ikm);
    let child_hkdf = Hkdf::<Sha512>::new(None, &root);
    let mut child_ikm = [0u8; 32];
    let child_info = [b"SKSB_ADDRESS_KEY_V2".as_slice(), &[0u8; 4]].concat();
    child_hkdf
        .expand(&child_info, &mut child_ikm)
        .expect("valid child HKDF length");
    let (child_private, child_public) = hpke_derive_keypair(&child_ikm);
    child_ikm.fill(0);
    ikm.fill(0);
    (root, child_private, child_public)
}
