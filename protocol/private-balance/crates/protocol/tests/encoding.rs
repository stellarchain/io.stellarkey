use private_balance_protocol::encoding::*;
use private_balance_protocol::field::*;

#[test]
fn test_canonical_encoding_roundtrip() {
    let mut buf = Vec::new();
    encode_u16_be(42, &mut buf);
    encode_u32_be(1000, &mut buf);
    encode_u64_be(999999, &mut buf);

    let mut field = [0u8; 32];
    field[31] = 77;
    encode_field(&field, &mut buf).unwrap();

    let mut cursor = 0;
    assert_eq!(decode_u16_be(&buf, &mut cursor).unwrap(), 42);
    assert_eq!(decode_u32_be(&buf, &mut cursor).unwrap(), 1000);
    assert_eq!(decode_u64_be(&buf, &mut cursor).unwrap(), 999999);
    assert_eq!(decode_field(&buf, &mut cursor).unwrap(), field);
    assert_eq!(cursor, buf.len());
}

#[test]
fn test_non_canonical_field_rejection() {
    assert_eq!(
        hex::encode(BN254_FR_MODULUS_BYTES),
        "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001",
        "BN254 Fr must use the scalar-field modulus, not the base-field modulus",
    );
    let mut buf = Vec::new();
    let mut non_canonical = BN254_FR_MODULUS_BYTES;
    // Exactly modulus is not canonical
    assert!(encode_field(&non_canonical, &mut buf).is_err());
    non_canonical[31] += 1;
    assert!(encode_field(&non_canonical, &mut buf).is_err());
}

#[test]
fn test_address_encoding() {
    let mut buf = Vec::new();
    let payload = [0x55u8; 32];
    encode_address(0, &payload, &mut buf).unwrap();
    encode_optional_address(Some((1, payload)), &mut buf).unwrap();
    encode_optional_address(None, &mut buf).unwrap();

    let mut cursor = 0;
    let (k1, p1) = decode_address(&buf, &mut cursor).unwrap();
    assert_eq!(k1, 0);
    assert_eq!(p1, payload);

    let opt1 = decode_optional_address(&buf, &mut cursor).unwrap();
    assert_eq!(opt1, Some((1, payload)));

    let opt2 = decode_optional_address(&buf, &mut cursor).unwrap();
    assert_eq!(opt2, None);
    assert_eq!(cursor, buf.len());
}
