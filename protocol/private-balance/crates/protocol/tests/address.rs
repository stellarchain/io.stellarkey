use private_balance_protocol::address::{
    AddressError, PRIVATE_ADDRESS_MAINNET_ASCII_BYTES, PRIVATE_ADDRESS_TESTNET_ASCII_BYTES,
    PrivateAddress, derive_private_address_deployment_tag,
};

fn address() -> PrivateAddress {
    let mut owner_commitment = [0u8; 32];
    owner_commitment[31] = 7;
    PrivateAddress {
        deployment_tag: derive_private_address_deployment_tag(&[0x42; 32]),
        diversifier: [1, 2, 3, 4],
        owner_commitment,
        hpke_public_key: [0x22; 32],
    }
}

#[test]
fn base58_address_round_trips_with_exact_network_prefix() {
    let expected = address();
    let testnet = expected.encode("tskpay_").unwrap();
    let mainnet = expected.encode("skpay_").unwrap();
    assert_eq!(testnet.len(), PRIVATE_ADDRESS_TESTNET_ASCII_BYTES);
    assert_eq!(mainnet.len(), PRIVATE_ADDRESS_MAINNET_ASCII_BYTES);
    assert!(testnet.starts_with("tskpay_"));
    assert!(
        !testnet["tskpay_".len()..]
            .bytes()
            .any(|byte| matches!(byte, b'0' | b'O' | b'I' | b'l'))
    );
    assert_eq!(
        PrivateAddress::decode(&testnet, "tskpay_").unwrap(),
        expected
    );
    assert_eq!(
        PrivateAddress::decode(&testnet, "skpay_").unwrap_err(),
        AddressError::InvalidPrefix
    );
}

#[test]
fn checksum_prefix_and_legacy_mutations_are_rejected() {
    let encoded = address().encode("tskpay_").unwrap();
    let replacement = if encoded.ends_with('1') { '2' } else { '1' };
    let mutated = format!("{}{replacement}", &encoded[..encoded.len() - 1]);
    assert_eq!(
        PrivateAddress::decode(&mutated, "tskpay_").unwrap_err(),
        AddressError::ChecksumMismatch
    );
    let prefix_mutated = format!("skpay_{}", &encoded["tskpay_".len()..]);
    assert_eq!(
        PrivateAddress::decode(&prefix_mutated, "skpay_").unwrap_err(),
        AddressError::ChecksumMismatch,
    );
    assert_eq!(
        PrivateAddress::decode(&format!("tks1{}", "q".repeat(166)), "tskpay_").unwrap_err(),
        AddressError::InvalidPrefix,
    );
}

#[test]
fn deployment_tag_binds_full_deployment_hash() {
    let first = derive_private_address_deployment_tag(&[0x42; 32]);
    let mut changed = [0x42; 32];
    changed[31] ^= 1;
    assert_ne!(first, derive_private_address_deployment_tag(&changed));
}

#[test]
fn low_order_x25519_keys_are_rejected() {
    let mut candidate = address();
    candidate.hpke_public_key = [0u8; 32];
    assert_eq!(
        candidate.encode("tskpay_").unwrap_err(),
        AddressError::InvalidHpkeKey
    );
}
