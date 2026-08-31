use crate::constants::{
    DOMAIN_ADDRESS_KEY, DOMAIN_ASK, DOMAIN_DIVERSIFIED_OWNER, DOMAIN_HPKE_IKM, DOMAIN_NK,
    DOMAIN_OWNER, DOMAIN_ROOT,
};
use crate::field::bytes_to_field;
use crate::poseidon2::p2;
use alloc::vec::Vec;
use hkdf::Hkdf;
use hpke::{Kem, Serializable, kem::X25519HkdfSha256};
use sha2::{Digest, Sha512};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExpandedSpendingKey {
    pub ask: [u8; 32],
    pub nk: [u8; 32],
    pub base_owner_commitment: [u8; 32],
    pub owner_commitment: [u8; 32],
    pub hpke_private_key: [u8; 32],
    pub hpke_public_key: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FullViewingKey {
    pub base_owner_commitment: [u8; 32],
    pub owner_commitment: [u8; 32],
    pub nk: [u8; 32],
    pub hpke_private_key: [u8; 32],
    pub hpke_public_key: [u8; 32],
}

pub fn derive_diversified_address_keys(
    base_owner_commitment: &[u8; 32],
    incoming_viewing_key: &[u8; 32],
    diversifier: &[u8; 4],
) -> ([u8; 32], [u8; 32], [u8; 32]) {
    let mut diversifier_field = [0u8; 32];
    diversifier_field[28..32].copy_from_slice(diversifier);
    let owner_commitment = p2(
        DOMAIN_DIVERSIFIED_OWNER,
        &[*base_owner_commitment, diversifier_field],
    );
    let hk = Hkdf::<Sha512>::new(None, incoming_viewing_key);
    let mut info = Vec::new();
    info.extend_from_slice(DOMAIN_ADDRESS_KEY.as_bytes());
    info.extend_from_slice(diversifier);
    let mut child_ikm = [0u8; 32];
    hk.expand(&info, &mut child_ikm)
        .expect("HKDF expand diversified address key");
    let (child_private, child_public) = X25519HkdfSha256::derive_keypair(&child_ikm);
    child_ikm.fill(0);
    let mut private_key = [0u8; 32];
    private_key.copy_from_slice(child_private.to_bytes().as_slice());
    let mut public_key = [0u8; 32];
    public_key.copy_from_slice(child_public.to_bytes().as_slice());
    (owner_commitment, private_key, public_key)
}

#[allow(clippy::too_many_arguments)]
pub fn derive_keys_from_seed(
    raw_stellar_seed: &[u8; 32],
    protocol_version: u16,
    network_id: &[u8; 32],
    realm_id: &[u8; 32],
    pool_id: &[u8; 32],
    account_public_key_bytes: &[u8; 32],
    context_field: &[u8; 32],
) -> ExpandedSpendingKey {
    let mut context = Vec::new();
    context.extend_from_slice(&protocol_version.to_be_bytes());
    context.extend_from_slice(network_id);
    context.extend_from_slice(realm_id);
    context.extend_from_slice(pool_id);
    context.extend_from_slice(account_public_key_bytes);

    let mut salt_hasher = Sha512::new();
    salt_hasher.update(DOMAIN_ROOT.as_bytes());
    salt_hasher.update(&context);
    let salt = salt_hasher.finalize();

    let hk = Hkdf::<Sha512>::new(Some(&salt), raw_stellar_seed);

    // Derive ask with zero regeneration if needed
    let mut counter: u8 = 0;
    let ask = loop {
        let mut info = Vec::new();
        info.extend_from_slice(DOMAIN_ASK.as_bytes());
        info.extend_from_slice(&context);
        if counter > 0 {
            info.push(counter);
        }
        let mut ask_raw = [0u8; 64];
        hk.expand(&info, &mut ask_raw).expect("HKDF expand ask");
        let candidate = bytes_to_field(&ask_raw);
        if candidate != [0u8; 32] {
            break candidate;
        }
        counter += 1;
    };

    // Derive nk with zero regeneration if needed
    let mut counter: u8 = 0;
    let nk = loop {
        let mut info = Vec::new();
        info.extend_from_slice(DOMAIN_NK.as_bytes());
        info.extend_from_slice(&context);
        if counter > 0 {
            info.push(counter);
        }
        let mut nk_raw = [0u8; 64];
        hk.expand(&info, &mut nk_raw).expect("HKDF expand nk");
        let candidate = bytes_to_field(&nk_raw);
        if candidate != [0u8; 32] {
            break candidate;
        }
        counter += 1;
    };

    // Derive hpkeIkm (32 bytes)
    let mut hpke_info = Vec::new();
    hpke_info.extend_from_slice(DOMAIN_HPKE_IKM.as_bytes());
    hpke_info.extend_from_slice(&context);
    let mut hpke_ikm = [0u8; 32];
    hk.expand(&hpke_info, &mut hpke_ikm)
        .expect("HKDF expand hpke_ikm");
    let (hpke_private, _hpke_public) = X25519HkdfSha256::derive_keypair(&hpke_ikm);
    hpke_ikm.fill(0);
    let mut incoming_viewing_key = [0u8; 32];
    incoming_viewing_key.copy_from_slice(hpke_private.to_bytes().as_slice());

    let base_owner_commitment = p2(DOMAIN_OWNER, &[*context_field, ask, nk]);
    let (owner_commitment, mut default_private_key, hpke_public_key) =
        derive_diversified_address_keys(&base_owner_commitment, &incoming_viewing_key, &[0u8; 4]);
    default_private_key.fill(0);

    ExpandedSpendingKey {
        ask,
        nk,
        base_owner_commitment,
        owner_commitment,
        hpke_private_key: incoming_viewing_key,
        hpke_public_key,
    }
}

impl ExpandedSpendingKey {
    pub fn to_viewing_key(&self) -> FullViewingKey {
        FullViewingKey {
            base_owner_commitment: self.base_owner_commitment,
            owner_commitment: self.owner_commitment,
            nk: self.nk,
            hpke_private_key: self.hpke_private_key,
            hpke_public_key: self.hpke_public_key,
        }
    }
}
