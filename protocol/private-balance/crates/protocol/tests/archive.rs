use private_balance_protocol::archive::*;
use private_balance_protocol::encryption::OutputPackage;
use serde_json::Value;
use std::fs;

#[test]
fn test_archive_record_hash_chain() {
    let vector: Value = serde_json::from_str(
        &fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../vectors/archive-v1.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let fill = |path: &[&str]| -> u8 {
        path.iter()
            .fold(&vector, |value, key| &value[*key])
            .as_u64()
            .unwrap() as u8
    };
    let rec = ArchiveRecord {
        action_index: 0,
        ledger_sequence: 100,
        starting_leaf_index: 0,
        action_kind: 1,
        asset_index: Some(0),
        asset: Some((
            fill(&["record", "assetKind"]),
            [fill(&["record", "assetPayloadFill"]); 32],
        )),
        action_nonce: [fill(&["record", "actionNonceFill"]); 32],
        anchor_root: [fill(&["record", "anchorRootFill"]); 32],
        tree_root_after: [fill(&["record", "treeRootAfterFill"]); 32],
        nullifiers: [[1u8; 32], [2u8; 32]],
        outputs: [
            OutputPackage {
                cm: [3; 32],
                recipient_envelope: [4; 181],
                outgoing_envelope: [5; 157],
            },
            OutputPackage {
                cm: [6; 32],
                recipient_envelope: [7; 181],
                outgoing_envelope: [8; 157],
            },
            OutputPackage {
                cm: [9; 32],
                recipient_envelope: [10; 181],
                outgoing_envelope: [11; 157],
            },
        ],
        public_value: 1000,
        deposit_source: Some((0, [fill(&["record", "depositSourcePayloadFill"]); 32])),
        public_recipient: None,
    };

    let prior = [fill(&["record", "priorRecordHashFill"]); 32];
    let rh = rec.compute_record_hash(2, &prior);
    assert_eq!(
        hex::encode(rh),
        vector["expectedRecordHash"].as_str().unwrap()
    );
}
