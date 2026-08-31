use crate::constants::{
    ADDRESS_DIVERSIFIER_BYTES, PRIVATE_ADDRESS_ASCII_BYTES, PRIVATE_ADDRESS_PAYLOAD_BYTES,
};
use crate::field::is_canonical_field;
use alloc::string::String;
use alloc::vec::Vec;

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONSTANT: u32 = 0x2bc8_30a3;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivateAddress {
    pub diversifier: [u8; ADDRESS_DIVERSIFIER_BYTES],
    pub owner_commitment: [u8; 32],
    pub hpke_public_key: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressError {
    InvalidLength,
    InvalidPrefix,
    InvalidCharacter,
    InvalidPadding,
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
    if prefix == "tks" || prefix == "sks" {
        Ok(())
    } else {
        Err(AddressError::InvalidPrefix)
    }
}

fn polymod(values: impl IntoIterator<Item = u8>) -> u32 {
    let mut checksum = 1u32;
    for value in values {
        let top = checksum >> 25;
        checksum = ((checksum & 0x01ff_ffff) << 5) ^ u32::from(value);
        if top & 1 != 0 {
            checksum ^= 0x3b6a_57b2;
        }
        if top & 2 != 0 {
            checksum ^= 0x2650_8e6d;
        }
        if top & 4 != 0 {
            checksum ^= 0x1ea1_19fa;
        }
        if top & 8 != 0 {
            checksum ^= 0x3d42_33dd;
        }
        if top & 16 != 0 {
            checksum ^= 0x2a14_62b3;
        }
    }
    checksum
}

fn expand_hrp(hrp: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(hrp.len() * 2 + 1);
    output.extend(hrp.bytes().map(|byte| byte >> 5));
    output.push(0);
    output.extend(hrp.bytes().map(|byte| byte & 31));
    output
}

fn convert_bits(values: &[u8], from: u32, to: u32, pad: bool) -> Result<Vec<u8>, AddressError> {
    let mut accumulator = 0u32;
    let mut bits = 0u32;
    let maximum = (1u32 << to) - 1;
    let max_accumulator = (1u32 << (from + to - 1)) - 1;
    let mut output = Vec::new();
    for value in values {
        if u32::from(*value) >> from != 0 {
            return Err(AddressError::InvalidCharacter);
        }
        accumulator = ((accumulator << from) | u32::from(*value)) & max_accumulator;
        bits += from;
        while bits >= to {
            bits -= to;
            output.push(((accumulator >> bits) & maximum) as u8);
        }
    }
    if pad {
        if bits > 0 {
            output.push(((accumulator << (to - bits)) & maximum) as u8);
        }
    } else if bits >= from || ((accumulator << (to - bits)) & maximum) != 0 {
        return Err(AddressError::InvalidPadding);
    }
    Ok(output)
}

fn charset_value(character: u8) -> Option<u8> {
    CHARSET
        .iter()
        .position(|candidate| *candidate == character)
        .map(|index| index as u8)
}

impl PrivateAddress {
    fn payload(&self) -> [u8; PRIVATE_ADDRESS_PAYLOAD_BYTES] {
        let mut payload = [0u8; PRIVATE_ADDRESS_PAYLOAD_BYTES];
        payload[0..4].copy_from_slice(&self.diversifier);
        payload[4..36].copy_from_slice(&self.owner_commitment);
        payload[36..68].copy_from_slice(&self.hpke_public_key);
        payload
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
        let words = convert_bits(&self.payload(), 8, 5, true)?;
        let mut checksum_input = expand_hrp(prefix);
        checksum_input.extend_from_slice(&words);
        checksum_input.extend_from_slice(&[0u8; 6]);
        let checksum = polymod(checksum_input) ^ BECH32M_CONSTANT;
        let mut output = String::from(prefix);
        output.push('1');
        for word in &words {
            output.push(CHARSET[*word as usize] as char);
        }
        for index in 0..6 {
            output.push(CHARSET[((checksum >> (5 * (5 - index))) & 31) as usize] as char);
        }
        if output.len() != PRIVATE_ADDRESS_ASCII_BYTES {
            return Err(AddressError::InvalidLength);
        }
        Ok(output)
    }

    pub fn decode(encoded: &str, expected_prefix: &str) -> Result<Self, AddressError> {
        validate_prefix(expected_prefix)?;
        if encoded.len() != PRIVATE_ADDRESS_ASCII_BYTES
            || encoded.bytes().any(|byte| byte.is_ascii_uppercase())
        {
            return Err(AddressError::InvalidLength);
        }
        let expected_start = alloc::format!("{expected_prefix}1");
        if !encoded.starts_with(&expected_start) {
            return Err(AddressError::InvalidPrefix);
        }
        let words = encoded.as_bytes()[expected_start.len()..]
            .iter()
            .map(|byte| charset_value(*byte).ok_or(AddressError::InvalidCharacter))
            .collect::<Result<Vec<_>, _>>()?;
        let mut checksum_input = expand_hrp(expected_prefix);
        checksum_input.extend_from_slice(&words);
        if polymod(checksum_input) != BECH32M_CONSTANT {
            return Err(AddressError::ChecksumMismatch);
        }
        let payload = convert_bits(&words[..words.len() - 6], 5, 8, false)?;
        if payload.len() != PRIVATE_ADDRESS_PAYLOAD_BYTES {
            return Err(AddressError::InvalidLength);
        }
        let mut diversifier = [0u8; 4];
        diversifier.copy_from_slice(&payload[0..4]);
        let mut owner_commitment = [0u8; 32];
        owner_commitment.copy_from_slice(&payload[4..36]);
        let mut hpke_public_key = [0u8; 32];
        hpke_public_key.copy_from_slice(&payload[36..68]);
        let address = Self {
            diversifier,
            owner_commitment,
            hpke_public_key,
        };
        address.validate()?;
        Ok(address)
    }
}
