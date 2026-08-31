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
        asset: (
            fill(&["record", "assetKind"]),
            [fill(&["record", "assetPayloadFill"]); 32],
        ),
        action_nonce: [fill(&["record", "actionNonceFill"]); 32],
        anchor_root: [fill(&["record", "anchorRootFill"]); 32],
        tree_root_after: [fill(&["record", "treeRootAfterFill"]); 32],
        nullifiers: [[0u8; 32], [0u8; 32]],
        outputs: [OutputPackage::dummy(), OutputPackage::dummy()],
        public_value: 1000,
        deposit_source: Some((0, [fill(&["record", "depositSourcePayloadFill"]); 32])),
        public_recipient: None,
        relayer_fee: 0,
        relayer: None,
    };

    let prior = [fill(&["record", "priorRecordHashFill"]); 32];
    let rh = rec.compute_record_hash(1, &prior);
    assert_eq!(
        hex::encode(rh),
        vector["expectedRecordHash"].as_str().unwrap()
    );
}
