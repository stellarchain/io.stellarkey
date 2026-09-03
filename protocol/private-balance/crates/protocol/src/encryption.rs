use crate::constants::{
    DOMAIN_HPKE_AAD, DOMAIN_HPKE_INFO, DOMAIN_OUTGOING_AAD, DOMAIN_OUTGOING_KEY,
    DOMAIN_OUTGOING_VIEW_TAG, HPKE_ENVELOPE_BYTES, OUTGOING_ENVELOPE_BYTES, OUTGOING_NONCE_BYTES,
    OUTGOING_PLAINTEXT_BYTES, OUTPUT_PACKAGE_BYTES, PROTOCOL_VERSION,
};
use crate::encoding::{encode_domain, encode_u16_be};
use crate::field::is_canonical_field;
use alloc::vec::Vec;
use hkdf::Hkdf;
use hpke::{
    aead::AesGcm128,
    danger::streaming_enc::{
        AeadKey, AeadNonce, ExporterSecret, create_receiver_context, create_sender_context,
    },
    kdf::HkdfSha256,
    kem::X25519HkdfSha256,
};
use sha2::Sha256;

const OUTGOING_DUMMY_FLAG: u16 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutgoingPlaintext {
    pub protocol_version: u16,
    pub flags: u16,
    pub value: u64,
    pub diversifier: [u8; 4],
    pub owner_commitment: [u8; 32],
    pub recipient_hpke_public_key: [u8; 32],
    pub memo_length: u8,
    pub memo: [u8; 32],
    pub asset_index: u32,
    pub reserved: [u8; 11],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputPackage {
    pub cm: [u8; 32],
    pub recipient_envelope: [u8; HPKE_ENVELOPE_BYTES],
    pub outgoing_envelope: [u8; OUTGOING_ENVELOPE_BYTES],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncryptionError {
    InvalidLength,
    InvalidPlaintext,
    InvalidOutputIndex,
    SealFailed,
    OpenFailed,
}

impl OutgoingPlaintext {
    fn validate(&self) -> Result<(), EncryptionError> {
        if self.protocol_version != PROTOCOL_VERSION
            || (self.flags != 0 && self.flags != OUTGOING_DUMMY_FLAG)
            || (self.flags == OUTGOING_DUMMY_FLAG && self.value != 0)
            || (self.flags == 0 && (self.value == 0 || self.value > i64::MAX as u64))
            || !is_canonical_field(&self.owner_commitment)
            || self.owner_commitment == [0u8; 32]
            || self.recipient_hpke_public_key == [0u8; 32]
            || self.memo_length as usize > self.memo.len()
            || self.memo[self.memo_length as usize..]
                .iter()
                .any(|byte| *byte != 0)
            || (self.flags == OUTGOING_DUMMY_FLAG && self.memo_length != 0)
            || self.reserved != [0u8; 11]
        {
            return Err(EncryptionError::InvalidPlaintext);
        }
        Ok(())
    }

    pub fn serialize(&self) -> Result<[u8; OUTGOING_PLAINTEXT_BYTES], EncryptionError> {
        self.validate()?;
        let mut output = [0u8; OUTGOING_PLAINTEXT_BYTES];
        output[0..2].copy_from_slice(&self.protocol_version.to_be_bytes());
        output[2..4].copy_from_slice(&self.flags.to_be_bytes());
        output[4..12].copy_from_slice(&self.value.to_be_bytes());
        output[12..16].copy_from_slice(&self.diversifier);
        output[16..48].copy_from_slice(&self.owner_commitment);
        output[48..80].copy_from_slice(&self.recipient_hpke_public_key);
        output[80] = self.memo_length;
        output[81..113].copy_from_slice(&self.memo);
        output[113..117].copy_from_slice(&self.asset_index.to_be_bytes());
        output[117..128].copy_from_slice(&self.reserved);
        Ok(output)
    }

    pub fn deserialize(bytes: &[u8; OUTGOING_PLAINTEXT_BYTES]) -> Result<Self, EncryptionError> {
        let mut diversifier = [0u8; 4];
        diversifier.copy_from_slice(&bytes[12..16]);
        let mut owner_commitment = [0u8; 32];
        owner_commitment.copy_from_slice(&bytes[16..48]);
        let mut recipient_hpke_public_key = [0u8; 32];
        recipient_hpke_public_key.copy_from_slice(&bytes[48..80]);
        let mut memo = [0u8; 32];
        memo.copy_from_slice(&bytes[81..113]);
        let asset_index = u32::from_be_bytes(bytes[113..117].try_into().unwrap());
        let mut reserved = [0u8; 11];
        reserved.copy_from_slice(&bytes[117..128]);
        let plaintext = Self {
            protocol_version: u16::from_be_bytes([bytes[0], bytes[1]]),
            flags: u16::from_be_bytes([bytes[2], bytes[3]]),
            value: u64::from_be_bytes(bytes[4..12].try_into().unwrap()),
            diversifier,
            owner_commitment,
            recipient_hpke_public_key,
            memo_length: bytes[80],
            memo,
            asset_index,
            reserved,
        };
        plaintext.validate()?;
        Ok(plaintext)
    }
}

impl OutputPackage {
    pub fn serialize(&self) -> [u8; OUTPUT_PACKAGE_BYTES] {
        let mut out = [0u8; OUTPUT_PACKAGE_BYTES];
        out[0..32].copy_from_slice(&self.cm);
        out[32..213].copy_from_slice(&self.recipient_envelope);
        out[213..370].copy_from_slice(&self.outgoing_envelope);
        out
    }

    pub fn deserialize(bytes: &[u8; OUTPUT_PACKAGE_BYTES]) -> Result<Self, EncryptionError> {
        let mut cm = [0u8; 32];
        cm.copy_from_slice(&bytes[0..32]);

        let mut recipient_envelope = [0u8; HPKE_ENVELOPE_BYTES];
        recipient_envelope.copy_from_slice(&bytes[32..213]);
        let mut outgoing_envelope = [0u8; OUTGOING_ENVELOPE_BYTES];
        outgoing_envelope.copy_from_slice(&bytes[213..370]);

        Ok(OutputPackage {
            cm,
            recipient_envelope,
            outgoing_envelope,
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

pub fn compute_outgoing_aad(
    deployment_binding_hash: &[u8; 32],
    context_hash: &[u8; 32],
    asset_field: &[u8; 32],
    cm: &[u8; 32],
    action_nonce: &[u8; 32],
    output_index: u8,
) -> Result<Vec<u8>, EncryptionError> {
    if output_index > 2 {
        return Err(EncryptionError::InvalidOutputIndex);
    }
    let mut output = Vec::new();
    encode_domain(DOMAIN_OUTGOING_AAD, &mut output);
    output.extend_from_slice(deployment_binding_hash);
    output.extend_from_slice(context_hash);
    output.extend_from_slice(asset_field);
    output.extend_from_slice(cm);
    output.extend_from_slice(action_nonce);
    output.push(output_index);
    Ok(output)
}

fn derive_outgoing_material(
    outgoing_viewing_key: &[u8; 32],
    domain: &str,
    ephemeral_public_key: &[u8; 32],
    aad: &[u8],
    output: &mut [u8],
) {
    let hk = Hkdf::<Sha256>::new(None, outgoing_viewing_key);
    let mut info = Vec::new();
    info.extend_from_slice(domain.as_bytes());
    info.extend_from_slice(ephemeral_public_key);
    info.extend_from_slice(aad);
    hk.expand(&info, output)
        .expect("bounded outgoing HKDF expansion");
}

pub fn seal_outgoing_envelope(
    outgoing_viewing_key: &[u8; 32],
    ephemeral_public_key: &[u8; 32],
    plaintext: &[u8; OUTGOING_PLAINTEXT_BYTES],
    aad: &[u8],
    nonce: &[u8; OUTGOING_NONCE_BYTES],
) -> Result<[u8; OUTGOING_ENVELOPE_BYTES], EncryptionError> {
    let mut key_bytes = [0u8; 16];
    derive_outgoing_material(
        outgoing_viewing_key,
        DOMAIN_OUTGOING_KEY,
        ephemeral_public_key,
        aad,
        &mut key_bytes,
    );
    let mut view_tag = [0u8; 1];
    derive_outgoing_material(
        outgoing_viewing_key,
        DOMAIN_OUTGOING_VIEW_TAG,
        ephemeral_public_key,
        aad,
        &mut view_tag,
    );

    let mut key = AeadKey::<AesGcm128>::default();
    key.0.as_mut_slice().copy_from_slice(&key_bytes);
    key_bytes.fill(0);
    let mut base_nonce = AeadNonce::<AesGcm128>::default();
    base_nonce.0.as_mut_slice().copy_from_slice(nonce);
    let exporter_secret = ExporterSecret::<HkdfSha256>::default();
    let mut sender = create_sender_context::<AesGcm128, HkdfSha256, X25519HkdfSha256>(
        &key,
        base_nonce,
        exporter_secret,
    );
    let ciphertext = sender
        .seal(plaintext, aad)
        .map_err(|_| EncryptionError::SealFailed)?;
    if ciphertext.len() != OUTGOING_PLAINTEXT_BYTES + 16 {
        return Err(EncryptionError::SealFailed);
    }
    let mut envelope = [0u8; OUTGOING_ENVELOPE_BYTES];
    envelope[0] = view_tag[0];
    envelope[1..13].copy_from_slice(nonce);
    envelope[13..].copy_from_slice(&ciphertext);
    Ok(envelope)
}

pub fn open_outgoing_envelope(
    outgoing_viewing_key: &[u8; 32],
    ephemeral_public_key: &[u8; 32],
    envelope: &[u8; OUTGOING_ENVELOPE_BYTES],
    aad: &[u8],
) -> Result<[u8; OUTGOING_PLAINTEXT_BYTES], EncryptionError> {
    let mut expected_view_tag = [0u8; 1];
    derive_outgoing_material(
        outgoing_viewing_key,
        DOMAIN_OUTGOING_VIEW_TAG,
        ephemeral_public_key,
        aad,
        &mut expected_view_tag,
    );
    if envelope[0] != expected_view_tag[0] {
        return Err(EncryptionError::OpenFailed);
    }

    let mut key_bytes = [0u8; 16];
    derive_outgoing_material(
        outgoing_viewing_key,
        DOMAIN_OUTGOING_KEY,
        ephemeral_public_key,
        aad,
        &mut key_bytes,
    );
    let mut key = AeadKey::<AesGcm128>::default();
    key.0.as_mut_slice().copy_from_slice(&key_bytes);
    key_bytes.fill(0);
    let mut base_nonce = AeadNonce::<AesGcm128>::default();
    base_nonce
        .0
        .as_mut_slice()
        .copy_from_slice(&envelope[1..13]);
    let exporter_secret = ExporterSecret::<HkdfSha256>::default();
    let mut receiver = create_receiver_context::<AesGcm128, HkdfSha256, X25519HkdfSha256>(
        &key,
        base_nonce,
        exporter_secret,
    );
    let plaintext = receiver
        .open(&envelope[13..], aad)
        .map_err(|_| EncryptionError::OpenFailed)?;
    plaintext
        .try_into()
        .map_err(|_| EncryptionError::OpenFailed)
}
