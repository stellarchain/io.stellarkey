use crate::constants::ADDRESS_DIVERSIFIER_BYTES;
use crate::field::is_canonical_field;
use alloc::string::String;
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

const BASE58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PRIVATE_ADDRESS_FORMAT: u8 = 1;
const MAINNET_PREFIX: &str = "skpay_";
const TESTNET_PREFIX: &str = "tskpay_";
const DEPLOYMENT_TAG_DOMAIN: &[u8] = b"StellarKey private payment address deployment tag v1";
const CHECKSUM_DOMAIN: &[u8] = b"StellarKey private payment address checksum v1";

pub const PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES: usize = 16;
pub const PRIVATE_ADDRESS_PAYLOAD_BYTES: usize = 84;
pub const PRIVATE_ADDRESS_CHECKSUM_BYTES: usize = 4;
pub const PRIVATE_ADDRESS_DECODED_BYTES: usize = 89;
pub const PRIVATE_ADDRESS_MAINNET_ASCII_BYTES: usize = 127;
pub const PRIVATE_ADDRESS_TESTNET_ASCII_BYTES: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivateAddress {
    pub deployment_tag: [u8; PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES],
    pub diversifier: [u8; ADDRESS_DIVERSIFIER_BYTES],
    pub owner_commitment: [u8; 32],
    pub hpke_public_key: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressError {
    InvalidLength,
    InvalidPrefix,
    InvalidCharacter,
    InvalidFormat,
    ChecksumMismatch,
    NonCanonicalOwner,
    ZeroOwner,
    InvalidHpkeKey,
}

const X25519_LOW_ORDER_PUBLIC_KEYS: [[u8; 32]; 7] = [
    [0u8; 32],
    [
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0,
    ],
    [
        0xe0, 0xeb, 0x7a, 0x7c, 0x3b, 0x41, 0xb8, 0xae, 0x16, 0x56, 0xe3, 0xfa, 0xf1, 0x9f, 0xc4,
        0x6a, 0xda, 0x09, 0x8d, 0xeb, 0x9c, 0x32, 0xb1, 0xfd, 0x86, 0x62, 0x05, 0x16, 0x5f, 0x49,
        0xb8, 0x00,
    ],
    [
        0x5f, 0x9c, 0x95, 0xbc, 0xa3, 0x50, 0x8c, 0x24, 0xb1, 0xd0, 0xb1, 0x55, 0x9c, 0x83, 0xef,
        0x5b, 0x04, 0x44, 0x5c, 0xc4, 0x58, 0x1c, 0x8e, 0x86, 0xd8, 0x22, 0x4e, 0xdd, 0xd0, 0x9f,
        0x11, 0x57,
    ],
    [
        0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
    [
        0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
    [
        0xee, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
];

fn invalid_x25519_key(key: &[u8; 32]) -> bool {
    let mut normalized = *key;
    normalized[31] &= 0x7f;
    X25519_LOW_ORDER_PUBLIC_KEYS.contains(&normalized)
}

fn validate_prefix(prefix: &str) -> Result<(), AddressError> {
    if prefix == MAINNET_PREFIX || prefix == TESTNET_PREFIX {
        Ok(())
    } else {
        Err(AddressError::InvalidPrefix)
    }
}

fn expected_ascii_bytes(prefix: &str) -> usize {
    if prefix == TESTNET_PREFIX {
        PRIVATE_ADDRESS_TESTNET_ASCII_BYTES
    } else {
        PRIVATE_ADDRESS_MAINNET_ASCII_BYTES
    }
}

pub fn derive_private_address_deployment_tag(
    deployment_binding_hash: &[u8; 32],
) -> [u8; PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES] {
    let mut hasher = Sha256::new();
    hasher.update(DEPLOYMENT_TAG_DOMAIN);
    hasher.update(deployment_binding_hash);
    let digest = hasher.finalize();
    let mut tag = [0u8; PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES];
    tag.copy_from_slice(&digest[..PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES]);
    tag
}

fn checksum(prefix: &str, body: &[u8]) -> [u8; PRIVATE_ADDRESS_CHECKSUM_BYTES] {
    let mut hasher = Sha256::new();
    hasher.update(CHECKSUM_DOMAIN);
    hasher.update(prefix.as_bytes());
    hasher.update(body);
    let digest = hasher.finalize();
    let mut checksum = [0u8; PRIVATE_ADDRESS_CHECKSUM_BYTES];
    checksum.copy_from_slice(&digest[..PRIVATE_ADDRESS_CHECKSUM_BYTES]);
    checksum
}

fn encode_base58(input: &[u8]) -> String {
    let leading_zeroes = input.iter().take_while(|byte| **byte == 0).count();
    let mut digits: Vec<u8> = Vec::new();
    for byte in input.iter().skip(leading_zeroes) {
        let mut carry = u32::from(*byte);
        for digit in &mut digits {
            carry += u32::from(*digit) << 8;
            *digit = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }

    let mut output = String::with_capacity(leading_zeroes + digits.len());
    for _ in 0..leading_zeroes {
        output.push('1');
    }
    for digit in digits.iter().rev() {
        output.push(BASE58_ALPHABET[*digit as usize] as char);
    }
    output
}

fn base58_value(character: u8) -> Option<u8> {
    BASE58_ALPHABET
        .iter()
        .position(|candidate| *candidate == character)
        .map(|index| index as u8)
}

fn decode_base58(encoded: &str) -> Result<Vec<u8>, AddressError> {
    if encoded.is_empty() {
        return Err(AddressError::InvalidLength);
    }
    let leading_zeroes = encoded.bytes().take_while(|byte| *byte == b'1').count();
    let mut bytes: Vec<u8> = Vec::new();
    for character in encoded.bytes().skip(leading_zeroes) {
        let mut carry = u32::from(base58_value(character).ok_or(AddressError::InvalidCharacter)?);
        for byte in &mut bytes {
            carry += u32::from(*byte) * 58;
            *byte = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }

    let mut decoded = Vec::with_capacity(leading_zeroes + bytes.len());
    decoded.resize(leading_zeroes, 0);
    decoded.extend(bytes.iter().rev());
    if encode_base58(&decoded) != encoded {
        return Err(AddressError::InvalidCharacter);
    }
    Ok(decoded)
}

impl PrivateAddress {
    fn body(&self) -> [u8; PRIVATE_ADDRESS_DECODED_BYTES - PRIVATE_ADDRESS_CHECKSUM_BYTES] {
        let mut body = [0u8; PRIVATE_ADDRESS_DECODED_BYTES - PRIVATE_ADDRESS_CHECKSUM_BYTES];
        body[0] = PRIVATE_ADDRESS_FORMAT;
        body[1..17].copy_from_slice(&self.deployment_tag);
        body[17..21].copy_from_slice(&self.diversifier);
        body[21..53].copy_from_slice(&self.owner_commitment);
        body[53..85].copy_from_slice(&self.hpke_public_key);
        body
    }

    fn validate(&self) -> Result<(), AddressError> {
        if !is_canonical_field(&self.owner_commitment) {
            return Err(AddressError::NonCanonicalOwner);
        }
        if self.owner_commitment == [0u8; 32] {
            return Err(AddressError::ZeroOwner);
        }
        if invalid_x25519_key(&self.hpke_public_key) {
            return Err(AddressError::InvalidHpkeKey);
        }
        Ok(())
    }

    pub fn encode(&self, prefix: &str) -> Result<String, AddressError> {
        validate_prefix(prefix)?;
        self.validate()?;
        let body = self.body();
        let mut decoded = Vec::with_capacity(PRIVATE_ADDRESS_DECODED_BYTES);
        decoded.extend_from_slice(&body);
        decoded.extend_from_slice(&checksum(prefix, &body));
        let encoded = String::from(prefix) + &encode_base58(&decoded);
        if encoded.len() != expected_ascii_bytes(prefix) {
            return Err(AddressError::InvalidLength);
        }
        Ok(encoded)
    }

    pub fn decode(encoded: &str, expected_prefix: &str) -> Result<Self, AddressError> {
        validate_prefix(expected_prefix)?;
        if encoded.len() != expected_ascii_bytes(expected_prefix)
            || !encoded.starts_with(expected_prefix)
        {
            return Err(AddressError::InvalidPrefix);
        }
        let body_text = &encoded[expected_prefix.len()..];
        let decoded = decode_base58(body_text)?;
        if decoded.len() != PRIVATE_ADDRESS_DECODED_BYTES {
            return Err(AddressError::InvalidLength);
        }
        if decoded[0] != PRIVATE_ADDRESS_FORMAT {
            return Err(AddressError::InvalidFormat);
        }
        let checksum_offset = PRIVATE_ADDRESS_DECODED_BYTES - PRIVATE_ADDRESS_CHECKSUM_BYTES;
        if decoded[checksum_offset..] != checksum(expected_prefix, &decoded[..checksum_offset]) {
            return Err(AddressError::ChecksumMismatch);
        }

        let mut deployment_tag = [0u8; PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES];
        deployment_tag.copy_from_slice(&decoded[1..17]);
        let mut diversifier = [0u8; ADDRESS_DIVERSIFIER_BYTES];
        diversifier.copy_from_slice(&decoded[17..21]);
        let mut owner_commitment = [0u8; 32];
        owner_commitment.copy_from_slice(&decoded[21..53]);
        let mut hpke_public_key = [0u8; 32];
        hpke_public_key.copy_from_slice(&decoded[53..85]);
        let address = Self {
            deployment_tag,
            diversifier,
            owner_commitment,
            hpke_public_key,
        };
        address.validate()?;
        Ok(address)
    }
}
