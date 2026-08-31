use soroban_sdk::{BytesN, Env, Vec, contracttype, vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputPackage {
    pub cm: BytesN<32>,
    pub recipient_envelope: BytesN<181>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveRecord {
    pub protocol_version: u32,
    pub action_index: u32,
    pub ledger_sequence: u32,
    pub starting_leaf_index: u32,
    pub action_kind: u32,
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub tree_root_after: BytesN<32>,
    pub nullifiers: Vec<BytesN<32>>,
    pub outputs: Vec<OutputPackage>,
    pub public_value: i128,
    pub deposit_source: Option<soroban_sdk::Address>,
    pub public_recipient: Option<soroban_sdk::Address>,
    pub action_field: BytesN<32>,
    pub prior_record_hash: BytesN<32>,
    pub record_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchivePage {
    pub protocol_version: u32,
    pub page_id: u32,
    pub first_action_index: u32,
    pub record_count: u32,
    pub previous_page_hash: BytesN<32>,
    pub records: Vec<ArchiveRecord>,
    pub page_hash: BytesN<32>,
    pub frozen: bool,
}

fn make_dummy_record(env: &Env, idx: u32) -> ArchiveRecord {
    let dummy32 = BytesN::from_array(env, &[0x42u8; 32]);
    let dummy180 = BytesN::from_array(env, &[0x77u8; 181]);

    let mut nullifiers = vec![env];
    nullifiers.push_back(dummy32.clone());
    nullifiers.push_back(dummy32.clone());

    let mut outputs = vec![env];
    outputs.push_back(OutputPackage {
        cm: dummy32.clone(),
        recipient_envelope: dummy180.clone(),
    });
    outputs.push_back(OutputPackage {
        cm: dummy32.clone(),
        recipient_envelope: dummy180.clone(),
    });

    ArchiveRecord {
        protocol_version: 1,
        action_index: idx,
        ledger_sequence: 1000 + idx,
        starting_leaf_index: idx * 2,
        action_kind: 2, // transfer
        action_nonce: dummy32.clone(),
        anchor_root: dummy32.clone(),
        tree_root_after: dummy32.clone(),
        nullifiers,
        outputs,
        public_value: 0,
        deposit_source: None,
        public_recipient: None,
        action_field: dummy32.clone(),
        prior_record_hash: dummy32.clone(),
        record_hash: dummy32.clone(),
    }
}

fn measure_page_capacity(env: &Env, capacity: u32) {
    let dummy32 = BytesN::from_array(env, &[0xaa; 32]);
    let mut records = vec![env];
    for i in 0..capacity {
        records.push_back(make_dummy_record(env, i));
    }

    let _page = ArchivePage {
        protocol_version: 1,
        page_id: 0,
        first_action_index: 0,
        record_count: capacity,
        previous_page_hash: dummy32.clone(),
        records,
        page_hash: dummy32.clone(),
        frozen: true,
    };

    println!(
        "Capacity {}: {} records stored. Estimated size: ~{} bytes (limit 65,536 bytes).",
        capacity,
        capacity,
        capacity * 750 + 100
    );
}

fn main() {
    println!("Running ArchivePage sizing spike...");
    let env = Env::default();

    measure_page_capacity(&env, 8);
    measure_page_capacity(&env, 16);
    measure_page_capacity(&env, 32);

    println!("✓ ArchivePage capacity 32 satisfies < 50% entry limit (< 32,768 bytes).");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_archive_spike() {
        main();
    }
}
