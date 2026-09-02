use private_balance_protocol::action::*;
use private_balance_protocol::encryption::OutputPackage;
use private_balance_protocol::field::bytes_to_field;

#[test]
fn test_action_canonical_bytes_and_signals() {
    let action = Action {
        protocol_version: 1,
        kind: ActionKind::PrivateTransfer,
        asset: (1, [0x88; 32]),
        action_nonce: [0x11u8; 32],
        anchor_root: bytes_to_field(&[0x22u8; 32]),
        nullifiers: [bytes_to_field(&[0x33u8; 32]), bytes_to_field(&[0x44u8; 32])],
        outputs: [
            OutputPackage {
                cm: bytes_to_field(&[0x11u8; 32]),
                recipient_envelope: [0x55; 181],
                outgoing_envelope: [0x66; 157],
            },
            OutputPackage {
                cm: bytes_to_field(&[0x12u8; 32]),
                recipient_envelope: [0x77; 181],
                outgoing_envelope: [0x88; 157],
            },
        ],
        public_value: 0,
        deposit_source: None,
        public_recipient: None,
        relayer_fee: 25,
        relayer: Some((0, [0x45; 32])),
    };

    let net_id = [0x55u8; 32];
    let realm_id = [0x66u8; 32];
    let pool_id = [0x77u8; 32];
    let context_field = bytes_to_field(&[0x99u8; 32]);

    let signals = action.compute_public_signals(&context_field, &net_id, &realm_id, &pool_id);
    assert_eq!(signals.len(), 11);
    assert_eq!(signals[0], context_field);
    assert_eq!(signals[1], action.compute_asset_field());
    assert_eq!(signals[3], action.anchor_root);
    assert_eq!(&signals[5][24..], &25u64.to_be_bytes());
    assert_ne!(signals[6], [0; 32]);
    assert!(action.validate_public_shape().is_ok());

    let mut zero_lane = action.clone();
    zero_lane.nullifiers[1] = [0; 32];
    assert_eq!(
        zero_lane.validate_public_shape(),
        Err(ActionError::InvalidSlots)
    );
}
