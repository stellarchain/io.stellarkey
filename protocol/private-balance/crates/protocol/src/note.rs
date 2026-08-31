use crate::constants::{
    DOMAIN_NOTE_COMMITMENT, DOMAIN_NULLIFIER, MEMO_BYTES, NOTE_PLAINTEXT_BYTES, PROTOCOL_VERSION,
};
use crate::field::is_canonical_field;
use crate::poseidon2::p2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotePlaintext {
    pub protocol_version: u16,
    pub flags: u16,
    pub value: u64,
    pub diversifier: [u8; 4],
    pub owner_commitment: [u8; 32],
    pub rho: [u8; 32],
    pub memo_length: u8,
    pub memo: [u8; MEMO_BYTES],
    pub reserved: [u8; 15],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoteError {
    InvalidLength,
    UnsupportedVersion,
    UnsupportedFlags,
    InvalidValue,
    ContextTagMismatch,
    OwnerMismatch,
    NonCanonicalField,
    ZeroRho,
    InvalidMemoLength,
    NonZeroMemoTail,
    NonZeroReserved,
    CommitmentMismatch,
}

impl NotePlaintext {
    pub fn new(
        value: u64,
        diversifier: [u8; 4],
        owner_commitment: [u8; 32],
        rho: [u8; 32],
        memo_str: &str,
    ) -> Result<Self, NoteError> {
        if value == 0 || value > (i64::MAX as u64) {
            return Err(NoteError::InvalidValue);
        }
        if !is_canonical_field(&owner_commitment) || owner_commitment == [0u8; 32] {
            return Err(NoteError::NonCanonicalField);
        }
        if !is_canonical_field(&rho) || rho == [0u8; 32] {
            return Err(NoteError::ZeroRho);
        }
        let memo_bytes = memo_str.as_bytes();
        if memo_bytes.len() > MEMO_BYTES {
            return Err(NoteError::InvalidMemoLength);
        }
        let mut memo = [0u8; MEMO_BYTES];
        memo[..memo_bytes.len()].copy_from_slice(memo_bytes);

        Ok(NotePlaintext {
            protocol_version: PROTOCOL_VERSION,
            flags: 0,
            value,
            diversifier,
            owner_commitment,
            rho,
            memo_length: memo_bytes.len() as u8,
            memo,
            reserved: [0u8; 15],
        })
    }

    pub fn serialize(&self) -> [u8; NOTE_PLAINTEXT_BYTES] {
        let mut out = [0u8; NOTE_PLAINTEXT_BYTES];
        out[0..2].copy_from_slice(&self.protocol_version.to_be_bytes());
        out[2..4].copy_from_slice(&self.flags.to_be_bytes());
        out[4..12].copy_from_slice(&self.value.to_be_bytes());
        out[12..16].copy_from_slice(&self.diversifier);
        out[16..48].copy_from_slice(&self.owner_commitment);
        out[48..80].copy_from_slice(&self.rho);
        out[80] = self.memo_length;
        out[81..113].copy_from_slice(&self.memo);
        out[113..128].copy_from_slice(&self.reserved);
        out
    }

    pub fn deserialize(bytes: &[u8; NOTE_PLAINTEXT_BYTES]) -> Result<Self, NoteError> {
        let protocol_version = u16::from_be_bytes([bytes[0], bytes[1]]);
        if protocol_version != PROTOCOL_VERSION {
            return Err(NoteError::UnsupportedVersion);
        }
        let flags = u16::from_be_bytes([bytes[2], bytes[3]]);
        if flags != 0 {
            return Err(NoteError::UnsupportedFlags);
        }
        let value = u64::from_be_bytes([
            bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
        ]);
        if value == 0 || value > (i64::MAX as u64) {
            return Err(NoteError::InvalidValue);
        }

        let mut diversifier = [0u8; 4];
        diversifier.copy_from_slice(&bytes[12..16]);

        let mut owner_commitment = [0u8; 32];
        owner_commitment.copy_from_slice(&bytes[16..48]);
        if !is_canonical_field(&owner_commitment) || owner_commitment == [0u8; 32] {
            return Err(NoteError::NonCanonicalField);
        }

        let mut rho = [0u8; 32];
        rho.copy_from_slice(&bytes[48..80]);
        if !is_canonical_field(&rho) || rho == [0u8; 32] {
            return Err(NoteError::ZeroRho);
        }

        let memo_length = bytes[80];
        if memo_length as usize > MEMO_BYTES {
            return Err(NoteError::InvalidMemoLength);
        }

        let mut memo = [0u8; MEMO_BYTES];
        memo.copy_from_slice(&bytes[81..113]);
        if memo[memo_length as usize..].iter().any(|byte| *byte != 0) {
            return Err(NoteError::NonZeroMemoTail);
        }

        let mut reserved = [0u8; 15];
        reserved.copy_from_slice(&bytes[113..128]);
        if reserved != [0u8; 15] {
            return Err(NoteError::NonZeroReserved);
        }

        Ok(NotePlaintext {
            protocol_version,
            flags,
            value,
            diversifier,
            owner_commitment,
            rho,
            memo_length,
            memo,
            reserved,
        })
    }
}

pub fn compute_note_commitment(
    context_field: &[u8; 32],
    asset_field: &[u8; 32],
    owner_commitment: &[u8; 32],
    value: u64,
    rho: &[u8; 32],
) -> [u8; 32] {
    let mut val_field = [0u8; 32];
    val_field[24..32].copy_from_slice(&value.to_be_bytes());
    p2(
        DOMAIN_NOTE_COMMITMENT,
        &[
            *context_field,
            *asset_field,
            *owner_commitment,
            val_field,
            *rho,
        ],
    )
}

pub fn compute_nullifier(
    context_field: &[u8; 32],
    nk: &[u8; 32],
    rho: &[u8; 32],
    leaf_index: u32,
    cm: &[u8; 32],
) -> [u8; 32] {
    let mut idx_field = [0u8; 32];
    idx_field[28..32].copy_from_slice(&leaf_index.to_be_bytes());
    p2(
        DOMAIN_NULLIFIER,
        &[*context_field, *nk, *rho, idx_field, *cm],
    )
}
