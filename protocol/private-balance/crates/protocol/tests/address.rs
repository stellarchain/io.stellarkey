use private_balance_protocol::address::{AddressError, PrivateAddress};
use private_balance_protocol::constants::PRIVATE_ADDRESS_ASCII_BYTES;

fn address() -> PrivateAddress {
    let mut owner_commitment = [0u8; 32];
    owner_commitment[31] = 7;
    PrivateAddress {
        diversifier: [1, 2, 3, 4],
        owner_commitment,
        hpke_public_key: [0x22; 32],
    }
}

#[test]
fn bech32m_address_round_trips_with_exact_network_hrp() {
    let expected = address();
    let encoded = expected.encode("tks").unwrap();
    assert_eq!(encoded.len(), PRIVATE_ADDRESS_ASCII_BYTES);
    assert!(encoded.starts_with("tks1"));
    assert_eq!(PrivateAddress::decode(&encoded, "tks").unwrap(), expected);
    assert_eq!(
        PrivateAddress::decode(&encoded, "sks").unwrap_err(),
        AddressError::InvalidPrefix
    );
}

#[test]
fn bech32m_checksum_and_case_mutations_are_rejected() {
    let encoded = address().encode("tks").unwrap();
    let replacement = if encoded.ends_with('q') { 'p' } else { 'q' };
    let mutated = format!("{}{replacement}", &encoded[..encoded.len() - 1]);
    assert_eq!(
        PrivateAddress::decode(&mutated, "tks").unwrap_err(),
        AddressError::ChecksumMismatch
    );
    assert_eq!(
        PrivateAddress::decode(&encoded.to_uppercase(), "tks").unwrap_err(),
        AddressError::InvalidLength,
    );
}

#[test]
fn low_order_x25519_keys_are_rejected() {
    let mut candidate = address();
    candidate.hpke_public_key = [0u8; 32];
    assert_eq!(
        candidate.encode("tks").unwrap_err(),
        AddressError::InvalidHpkeKey
    );
}
