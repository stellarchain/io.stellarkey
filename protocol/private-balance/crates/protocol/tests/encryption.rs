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
