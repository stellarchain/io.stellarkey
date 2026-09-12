use num_bigint::BigUint;
use private_balance_protocol::field::{BN254_FR_MODULUS_BYTES, bytes_to_field, field_add};
use rand::{Rng, RngCore, SeedableRng, rngs::StdRng};

fn reference_field(bytes: &[u8]) -> [u8; 32] {
    let modulus = BigUint::from_bytes_be(&BN254_FR_MODULUS_BYTES);
    let raw = (BigUint::from_bytes_be(bytes) % modulus).to_bytes_be();
    let mut output = [0u8; 32];
    output[32 - raw.len()..].copy_from_slice(&raw);
    output
}

#[test]
fn fixed_width_field_arithmetic_matches_biguint_reference() {
    for boundary in [[0u8; 32], BN254_FR_MODULUS_BYTES, [0xff; 32]] {
        assert_eq!(bytes_to_field(&boundary), reference_field(&boundary));
    }

    let mut rng = StdRng::seed_from_u64(0x5354_454c_4c41_524b);
    for _ in 0..10_000 {
        let mut left = [0u8; 32];
        let mut right = [0u8; 32];
        rng.fill_bytes(&mut left);
        rng.fill_bytes(&mut right);
        let length = rng.gen_range(0..=96);
        let mut arbitrary = vec![0u8; length];
        rng.fill_bytes(&mut arbitrary);

        assert_eq!(bytes_to_field(&arbitrary), reference_field(&arbitrary));
        let expected_sum = reference_field(
            &(BigUint::from_bytes_be(&left) + BigUint::from_bytes_be(&right)).to_bytes_be(),
        );
        assert_eq!(field_add(&left, &right), expected_sum);
    }
}
