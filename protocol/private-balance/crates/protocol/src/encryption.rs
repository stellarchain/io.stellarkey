use crate::constants::{
    DOMAIN_HPKE_AAD, DOMAIN_HPKE_INFO, HPKE_ENVELOPE_BYTES, OUTPUT_PACKAGE_BYTES,
};
use crate::encoding::{encode_domain, encode_u16_be};
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputPackage {
    pub cm: [u8; 32],
    pub recipient_envelope: [u8; HPKE_ENVELOPE_BYTES],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncryptionError {
    InvalidLength,
    InvalidDummyPackage,
}

impl OutputPackage {
    pub fn dummy() -> Self {
        OutputPackage {
            cm: [0u8; 32],
            recipient_envelope: [0u8; HPKE_ENVELOPE_BYTES],
        }
    }

    pub fn is_dummy(&self) -> bool {
        self.cm == [0u8; 32] && self.recipient_envelope == [0u8; HPKE_ENVELOPE_BYTES]
    }

    pub fn serialize(&self) -> [u8; OUTPUT_PACKAGE_BYTES] {
        let mut out = [0u8; OUTPUT_PACKAGE_BYTES];
        out[0..32].copy_from_slice(&self.cm);
        out[32..213].copy_from_slice(&self.recipient_envelope);
        out
    }

    pub fn deserialize(bytes: &[u8; OUTPUT_PACKAGE_BYTES]) -> Result<Self, EncryptionError> {
        let mut cm = [0u8; 32];
        cm.copy_from_slice(&bytes[0..32]);

        let mut recipient_envelope = [0u8; HPKE_ENVELOPE_BYTES];
        recipient_envelope.copy_from_slice(&bytes[32..213]);

        if cm == [0u8; 32] && recipient_envelope != [0u8; HPKE_ENVELOPE_BYTES] {
            return Err(EncryptionError::InvalidDummyPackage);
        }

        Ok(OutputPackage {
            cm,
            recipient_envelope,
        })
    }
}

pub fn compute_hpke_info(protocol_version: u16, context_hash: &[u8; 32]) -> Vec<u8> {
    let mut buf = Vec::new();
    encode_domain(DOMAIN_HPKE_INFO, &mut buf);
    encode_u16_be(protocol_version, &mut buf);
    buf.extend_from_slice(context_hash);
    buf
}

pub fn compute_hpke_aad(
    context_hash: &[u8; 32],
    cm: &[u8; 32],
    action_nonce: &[u8; 32],
    output_index: u8,
) -> Vec<u8> {
    let mut buf = Vec::new();
    encode_domain(DOMAIN_HPKE_AAD, &mut buf);
    buf.extend_from_slice(context_hash);
    buf.extend_from_slice(cm);
    buf.extend_from_slice(action_nonce);
    buf.push(output_index);
    buf
}
