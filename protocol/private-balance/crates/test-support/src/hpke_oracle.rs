use hpke::{Kem, OpModeR, OpModeS, aead::AesGcm128, kdf::HkdfSha256, kem::X25519HkdfSha256};

pub fn hpke_derive_keypair(ikm: &[u8; 32]) -> (Vec<u8>, Vec<u8>) {
    let (sk, pk) = <X25519HkdfSha256 as Kem>::derive_keypair(ikm);
    use hpke::Serializable;
    (sk.to_bytes().to_vec(), pk.to_bytes().to_vec())
}

pub fn hpke_seal(pk_bytes: &[u8], info: &[u8], aad: &[u8], msg: &[u8]) -> (Vec<u8>, Vec<u8>) {
    use hpke::Deserializable;
    let pk = <X25519HkdfSha256 as Kem>::PublicKey::from_bytes(pk_bytes).expect("valid pk");
    let (enc, mut sender_ctx) =
        hpke::setup_sender::<AesGcm128, HkdfSha256, X25519HkdfSha256>(&OpModeS::Base, &pk, info)
            .expect("sender setup");
    let ct = sender_ctx.seal(msg, aad).expect("seal");
    use hpke::Serializable;
    (enc.to_bytes().to_vec(), ct)
}

pub fn hpke_open(
    sk_bytes: &[u8],
    enc_bytes: &[u8],
    info: &[u8],
    aad: &[u8],
    ct: &[u8],
) -> Result<Vec<u8>, String> {
    use hpke::Deserializable;
    let sk = <X25519HkdfSha256 as Kem>::PrivateKey::from_bytes(sk_bytes)
        .map_err(|e| format!("{:?}", e))?;
    let enc = <X25519HkdfSha256 as Kem>::EncappedKey::from_bytes(enc_bytes)
        .map_err(|e| format!("{:?}", e))?;
    let mut receiver_ctx = hpke::setup_receiver::<AesGcm128, HkdfSha256, X25519HkdfSha256>(
        &OpModeR::Base,
        &sk,
        &enc,
        info,
    )
    .map_err(|e| format!("{:?}", e))?;
    receiver_ctx.open(ct, aad).map_err(|e| format!("{:?}", e))
}
