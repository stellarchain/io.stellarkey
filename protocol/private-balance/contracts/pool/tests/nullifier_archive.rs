use serde_json::Value;
use sha2::{Digest, Sha256};

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[test]
fn nullifier_archive_gate_binds_controlled_core_replay_to_current_source() {
    let evidence: Value = serde_json::from_str(include_str!("../../../results/archive-gate.json"))
        .expect("valid archive gate evidence");
    assert_eq!(evidence["passed"], true);
    assert!(evidence["network"]["protocolVersion"].as_u64().unwrap() >= 25);
    for check in [
        "nullifierArchivedWithZeroTtl",
        "nullifierAutoRestoreSetExact",
        "nullifierRestoredAsSpent",
        "duplicateRejectedAfterRestore",
    ] {
        assert_eq!(evidence["checks"][check], true, "failed Core gate: {check}");
    }
    assert_eq!(
        evidence["probe"]["sourceHashes"]["poolNullifier"],
        sha256(include_bytes!("../src/nullifier.rs")),
    );
    let nullifier_source = include_str!("../src/nullifier.rs");
    assert!(nullifier_source.contains("extend_ttl(&key, max_ttl, max_ttl)"));
    assert!(!nullifier_source.contains(".remove(&DataKey::Nullifier"));
}
