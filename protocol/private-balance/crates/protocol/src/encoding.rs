use crate::constants::{DOMAIN_CONTEXT, DOMAIN_CONTEXT_FIELD};
use crate::field::{field_id, is_canonical_field};
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncodingError {
    InvalidLength,
    NonCanonicalField,
    InvalidAddressKind,
    NonZeroAbsentAddress,
    TrailingBytes,
}

pub fn encode_u16_be(val: u16, out: &mut Vec<u8>) {
    out.extend_from_slice(&val.to_be_bytes());
}

pub fn encode_u32_be(val: u32, out: &mut Vec<u8>) {
    out.extend_from_slice(&val.to_be_bytes());
}

pub fn encode_u64_be(val: u64, out: &mut Vec<u8>) {
    out.extend_from_slice(&val.to_be_bytes());
}

pub fn encode_domain(label: &str, out: &mut Vec<u8>) {
    let bytes = label.as_bytes();
    encode_u16_be(bytes.len() as u16, out);
    out.extend_from_slice(bytes);
}

pub fn encode_bytes_var(bytes: &[u8], out: &mut Vec<u8>) {
    encode_u32_be(bytes.len() as u32, out);
    out.extend_from_slice(bytes);
}

pub fn encode_field(field: &[u8; 32], out: &mut Vec<u8>) -> Result<(), EncodingError> {
    if !is_canonical_field(field) {
        return Err(EncodingError::NonCanonicalField);
    }
    out.extend_from_slice(field);
    Ok(())
}

pub fn encode_address(
    kind: u8,
    payload: &[u8; 32],
    out: &mut Vec<u8>,
) -> Result<(), EncodingError> {
    if kind > 1 {
        return Err(EncodingError::InvalidAddressKind);
    }
    out.push(kind);
    out.extend_from_slice(payload);
    Ok(())
}

pub fn encode_optional_address(
    addr: Option<(u8, [u8; 32])>,
    out: &mut Vec<u8>,
) -> Result<(), EncodingError> {
    match addr {
        Some((kind, payload)) => {
            if kind > 1 {
                return Err(EncodingError::InvalidAddressKind);
            }
            out.push(1);
            out.push(kind);
            out.extend_from_slice(&payload);
        }
        None => {
            out.extend_from_slice(&[0u8; 34]);
        }
    }
    Ok(())
}

pub fn decode_u16_be(input: &[u8], cursor: &mut usize) -> Result<u16, EncodingError> {
    if *cursor + 2 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let mut bytes = [0u8; 2];
    bytes.copy_from_slice(&input[*cursor..*cursor + 2]);
    *cursor += 2;
    Ok(u16::from_be_bytes(bytes))
}

pub fn decode_u32_be(input: &[u8], cursor: &mut usize) -> Result<u32, EncodingError> {
    if *cursor + 4 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(&input[*cursor..*cursor + 4]);
    *cursor += 4;
    Ok(u32::from_be_bytes(bytes))
}

pub fn decode_u64_be(input: &[u8], cursor: &mut usize) -> Result<u64, EncodingError> {
    if *cursor + 8 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&input[*cursor..*cursor + 8]);
    *cursor += 8;
    Ok(u64::from_be_bytes(bytes))
}

pub fn decode_field(input: &[u8], cursor: &mut usize) -> Result<[u8; 32], EncodingError> {
    if *cursor + 32 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let mut field = [0u8; 32];
    field.copy_from_slice(&input[*cursor..*cursor + 32]);
    *cursor += 32;
    if !is_canonical_field(&field) {
        return Err(EncodingError::NonCanonicalField);
    }
    Ok(field)
}

pub fn decode_address(input: &[u8], cursor: &mut usize) -> Result<(u8, [u8; 32]), EncodingError> {
    if *cursor + 33 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let kind = input[*cursor];
    *cursor += 1;
    if kind > 1 {
        return Err(EncodingError::InvalidAddressKind);
    }
    let mut payload = [0u8; 32];
    payload.copy_from_slice(&input[*cursor..*cursor + 32]);
    *cursor += 32;
    Ok((kind, payload))
}

pub fn decode_optional_address(
    input: &[u8],
    cursor: &mut usize,
) -> Result<Option<(u8, [u8; 32])>, EncodingError> {
    if *cursor + 34 > input.len() {
        return Err(EncodingError::InvalidLength);
    }
    let present = input[*cursor];
    *cursor += 1;
    if present == 0 {
        // Ensure all remaining 33 bytes are zero
        for b in &input[*cursor..*cursor + 33] {
            if *b != 0 {
                return Err(EncodingError::NonZeroAbsentAddress);
            }
        }
        *cursor += 33;
        Ok(None)
    } else if present == 1 {
        let (kind, payload) = decode_address(input, cursor)?;
        Ok(Some((kind, payload)))
    } else {
        Err(EncodingError::InvalidLength)
    }
}

pub fn hash_network_id(net: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(net);
    h.finalize().into()
}

pub fn hash_realm_id(realm: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(realm);
    h.finalize().into()
}

/// Computes the context hash:
/// SHA-256(canonical("SKSB_CONTEXT_V1", protocolVersion, networkId, realmId, poolId))
pub fn compute_context_hash(
    protocol_version: u16,
    network_id: &[u8; 32],
    realm_id: &[u8; 32],
    pool_id: &[u8; 32],
) -> [u8; 32] {
    let mut buf = Vec::new();
    encode_domain(DOMAIN_CONTEXT, &mut buf);
    encode_u16_be(protocol_version, &mut buf);
    buf.extend_from_slice(network_id);
    buf.extend_from_slice(realm_id);
    buf.extend_from_slice(pool_id);
    let digest = Sha256::digest(&buf);
    digest.into()
}

/// Derives contextField = fieldId("SKSB_CONTEXT_FIELD_V1", contextHash)
pub fn compute_context_field(context_hash: &[u8; 32]) -> [u8; 32] {
    field_id(DOMAIN_CONTEXT_FIELD, context_hash)
}
