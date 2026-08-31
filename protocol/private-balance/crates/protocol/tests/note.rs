use private_balance_protocol::note::NotePlaintext;

#[test]
fn v2_note_round_trips_diversifier_in_exact_128_byte_layout() {
    let mut owner = [0u8; 32];
    owner[31] = 7;
    let mut rho = [0u8; 32];
    rho[31] = 9;
    let note =
        NotePlaintext::new(5_000_000, [1, 2, 3, 4], owner, rho, "Payment for dinner").unwrap();
    let serialized = note.serialize();
    assert_eq!(serialized.len(), 128);
    assert_eq!(&serialized[12..16], &[1, 2, 3, 4]);
    assert_eq!(NotePlaintext::deserialize(&serialized).unwrap(), note);
}

#[test]
fn v2_note_rejects_nonzero_reserved_tail() {
    let mut owner = [0u8; 32];
    owner[31] = 7;
    let mut rho = [0u8; 32];
    rho[31] = 9;
    let note = NotePlaintext::new(1, [0; 4], owner, rho, "").unwrap();
    let mut serialized = note.serialize();
    serialized[127] = 1;
    assert!(NotePlaintext::deserialize(&serialized).is_err());
}
