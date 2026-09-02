use private_balance_protocol::constants::{
    OUTGOING_ENVELOPE_BYTES, OUTGOING_NONCE_BYTES, OUTGOING_PLAINTEXT_BYTES,
};
use private_balance_protocol::encryption::*;

#[test]
fn test_output_package_dummy() {
    let dummy = OutputPackage::dummy();
    assert!(dummy.is_dummy());
    let serialized = dummy.serialize();
    let deserialized = OutputPackage::deserialize(&serialized).unwrap();
    assert_eq!(deserialized, dummy);
}

#[test]
fn test_hpke_info_aad() {
    let context_hash = [0x42u8; 32];
    let info = compute_hpke_info(1, &context_hash);
    assert!(!info.is_empty());

    let cm = [0x55u8; 32];
    let nonce = [0x66u8; 32];
    let aad = compute_hpke_aad(&context_hash, &cm, &nonce, 0);
    assert!(!aad.is_empty());
}

fn outgoing_plaintext(dummy: bool) -> OutgoingPlaintext {
    let mut owner_commitment = [0u8; 32];
    owner_commitment[31] = 5;
    let mut memo = [0u8; 32];
    if !dummy {
        memo[..4].copy_from_slice(b"rent");
    }
    OutgoingPlaintext {
        protocol_version: 1,
        flags: u16::from(dummy),
        value: if dummy { 0 } else { 25 },
        diversifier: [1, 2, 3, 4],
        owner_commitment,
        recipient_hpke_public_key: [6u8; 32],
        memo_length: if dummy { 0 } else { 4 },
        memo,
        reserved: [0u8; 15],
    }
}

#[test]
fn outgoing_envelopes_recover_real_and_dummy_outputs_and_bind_context() {
    let ovk = [1u8; 32];
    let enc_pk = [2u8; 32];
    let binding = [3u8; 32];
    let context = [4u8; 32];
    let asset = [5u8; 32];
    let commitment = [6u8; 32];
    let action_nonce = [7u8; 32];
    let aad =
        compute_outgoing_aad(&binding, &context, &asset, &commitment, &action_nonce, 0).unwrap();

    for (index, plaintext) in [outgoing_plaintext(false), outgoing_plaintext(true)]
        .into_iter()
        .enumerate()
    {
        let encoded = plaintext.serialize().unwrap();
        assert_eq!(encoded.len(), OUTGOING_PLAINTEXT_BYTES);
        assert_eq!(OutgoingPlaintext::deserialize(&encoded).unwrap(), plaintext);
        let envelope =
            seal_outgoing_envelope(&ovk, &enc_pk, &encoded, &aad, &[(8 + index) as u8; 12])
                .unwrap();
        assert_eq!(envelope.len(), OUTGOING_ENVELOPE_BYTES);
        assert_eq!(
            open_outgoing_envelope(&ovk, &enc_pk, &envelope, &aad).unwrap(),
            encoded
        );
    }

    let encoded = outgoing_plaintext(false).serialize().unwrap();
    let envelope = seal_outgoing_envelope(&ovk, &enc_pk, &encoded, &aad, &[10u8; 12]).unwrap();
    let mut changed_ciphertext = envelope;
    changed_ciphertext[OUTGOING_ENVELOPE_BYTES - 1] ^= 1;
    assert!(open_outgoing_envelope(&ovk, &enc_pk, &changed_ciphertext, &aad).is_err());
    assert!(open_outgoing_envelope(&[99u8; 32], &enc_pk, &envelope, &aad).is_err());
    assert!(open_outgoing_envelope(&ovk, &[98u8; 32], &envelope, &aad).is_err());
    for field in 0..6 {
        let mut changed_binding = binding;
        let mut changed_context = context;
        let mut changed_asset = asset;
        let mut changed_commitment = commitment;
        let mut changed_nonce = action_nonce;
        let mut changed_lane = 0;
        match field {
            0 => changed_binding[0] ^= 1,
            1 => changed_context[0] ^= 1,
            2 => changed_asset[0] ^= 1,
            3 => changed_commitment[0] ^= 1,
            4 => changed_nonce[0] ^= 1,
            _ => changed_lane = 1,
        }
        let changed_aad = compute_outgoing_aad(
            &changed_binding,
            &changed_context,
            &changed_asset,
            &changed_commitment,
            &changed_nonce,
            changed_lane,
        )
        .unwrap();
        assert!(open_outgoing_envelope(&ovk, &enc_pk, &envelope, &changed_aad).is_err());
    }
}

#[test]
fn rust_outgoing_ciphertext_matches_the_typescript_vector() {
    let encryption: serde_json::Value =
        serde_json::from_str(include_str!("../../../vectors/encryption-v1.json")).unwrap();
    let keys: serde_json::Value =
        serde_json::from_str(include_str!("../../../vectors/keys-v1.json")).unwrap();
    let bytes = |value: &serde_json::Value| hex::decode(value.as_str().unwrap()).unwrap();
    let array = |value: &serde_json::Value| -> [u8; 32] { bytes(value).try_into().unwrap() };
    let ovk = array(&keys["expected"]["outgoingViewingKey"]);
    let enc_pk = array(&encryption["input"]["ephemeralPublicKey"]);
    let nonce: [u8; OUTGOING_NONCE_BYTES] = bytes(&encryption["input"]["outgoingNonce"])
        .try_into()
        .unwrap();
    let plaintext: [u8; OUTGOING_PLAINTEXT_BYTES] =
        bytes(&encryption["expected"]["outgoingPlaintext"])
            .try_into()
            .unwrap();
    let aad = bytes(&encryption["expected"]["outgoingAad"]);
    let expected: [u8; OUTGOING_ENVELOPE_BYTES] =
        bytes(&encryption["expected"]["outgoingEnvelope"])
            .try_into()
            .unwrap();
    assert_eq!(
        seal_outgoing_envelope(&ovk, &enc_pk, &plaintext, &aad, &nonce).unwrap(),
        expected
    );
    assert_eq!(
        open_outgoing_envelope(&ovk, &enc_pk, &expected, &aad).unwrap(),
        plaintext
    );
}
