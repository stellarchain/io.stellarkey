use private_balance_protocol::{
    action::{Action, ActionKind},
    constants::PROTOCOL_VERSION,
    encryption::OutputPackage,
};
use private_balance_test_support::{
    model::{ModelContext, PoolModel},
    native_poseidon2::{NativeTreeHashContext, native_p2},
    recovery::recover_public_transcript_with_tree_hash_context,
};
use rand::{Rng, SeedableRng, rngs::StdRng};

fn field(value: u32) -> [u8; 32] {
    let mut encoded = [0u8; 32];
    encoded[28..].copy_from_slice(&value.to_be_bytes());
    encoded
}

fn output(commitment: u32, envelope_byte: u8) -> OutputPackage {
    OutputPackage {
        cm: field(commitment),
        recipient_envelope: [envelope_byte; 181],
    }
}

fn context() -> ModelContext {
    ModelContext {
        network_id: [1; 32],
        realm_id: [2; 32],
        pool_id: [3; 32],
        context_field: [5; 32],
        deployment_binding_hash: [6; 32],
    }
}

#[test]
#[ignore = "Gate B: run explicitly in release mode"]
fn one_hundred_thousand_seeded_actions_recover_exactly_and_detect_corruption() {
    let tree_hash_context = NativeTreeHashContext::new();
    let mut model = PoolModel::new_with_tree_hash_context(context(), &tree_hash_context);
    let mut rng = StdRng::seed_from_u64(0x5354_454c_4c41_524b);
    let mut action_counts = [0u32; 3];

    for index in 0..100_000u32 {
        let choice = rng.gen_range(0..100u32);
        let kind = if model.total_public_balance == 0 || choice < 20 {
            ActionKind::Deposit
        } else if choice < 85 {
            ActionKind::PrivateTransfer
        } else {
            ActionKind::Withdraw
        };
        let public_value = match kind {
            ActionKind::Deposit => rng.gen_range(1..=100u64),
            ActionKind::PrivateTransfer => 0,
            ActionKind::Withdraw => rng.gen_range(1..=model.total_public_balance.min(100)),
        };
        action_counts[kind as usize - 1] += 1;
        let repeated_commitment = index > 0 && index % 997 == 0;
        let first_commitment = if repeated_commitment {
            42
        } else {
            rng.gen_range(1..=2_000_000_000u32)
        };
        let action = Action {
            protocol_version: PROTOCOL_VERSION,
            kind,
            asset: (1, [4; 32]),
            action_nonce: field(index + 1),
            anchor_root: if kind == ActionKind::Deposit {
                [0; 32]
            } else {
                model.tree.root
            },
            nullifiers: if kind == ActionKind::Deposit {
                [[0; 32]; 2]
            } else {
                [field(index + 1_000_001), [0; 32]]
            },
            outputs: [
                output(first_commitment, 0xa1),
                output(rng.gen_range(1..=2_000_000_000u32), 0xb2),
            ],
            public_value,
            deposit_source: (kind == ActionKind::Deposit).then_some((0, [7; 32])),
            public_recipient: (kind == ActionKind::Withdraw).then_some((0, [8; 32])),
            relayer_fee: 0,
            relayer: (kind != ActionKind::Deposit).then_some((0, [9; 32])),
        };

        model
            .apply_action_with_tree_hash_context(&action, index + 100, &tree_hash_context)
            .expect("canonical model action must apply");
    }

    let recovered = recover_public_transcript_with_tree_hash_context(
        &model.context,
        &model.records,
        &tree_hash_context,
    )
    .expect("canonical transcript must recover");
    assert_eq!(recovered.action_count, 100_000);
    assert!(action_counts.iter().all(|count| *count > 0));
    assert_eq!(recovered.tree, model.tree);
    assert_eq!(recovered.nullifiers, model.nullifiers);
    assert_eq!(recovered.total_public_balance, model.total_public_balance);
    assert_eq!(recovered.activities.len(), model.records.len());
    for (activity, record) in recovered.activities.iter().zip(&model.records) {
        assert_eq!(activity.action_index, record.action_index);
        assert_eq!(activity.action_kind as u8, record.action_kind);
        assert_eq!(activity.asset, record.asset);
        assert_eq!(activity.public_value, record.public_value);
    }
    assert_eq!(recovered.transcript_head, model.transcript_head);

    model.records[50_000].tree_root_after[31] ^= 1;
    let error = recover_public_transcript_with_tree_hash_context(
        &model.context,
        &model.records,
        &tree_hash_context,
    )
    .expect_err("a corrupted mid-history root must fail recovery");
    assert!(error.contains("Invalid tree root at action 50000"));
}

#[test]
fn native_poseidon2_oracle_matches_canonical_protocol_hashes() {
    for value in 0..8u32 {
        assert_eq!(
            native_p2("SKSB_MERKLE_NODE_V1", &[field(value), field(value + 1)]),
            private_balance_protocol::poseidon2::p2(
                "SKSB_MERKLE_NODE_V1",
                &[field(value), field(value + 1)]
            )
        );
    }

    let context = NativeTreeHashContext::new();
    let mut native = context.empty_tree();
    let mut canonical = private_balance_protocol::tree::TreeState::new();
    for value in 1..=8u32 {
        context
            .append_two_commitments(&mut native, &field(value * 2 - 1), &field(value * 2))
            .expect("native append");
        canonical
            .append_two_commitments(&field(value * 2 - 1), &field(value * 2))
            .expect("canonical append");
        assert_eq!(native.root, canonical.root);
        assert_eq!(native.next_leaf_index, canonical.next_leaf_index);
        for level in 0..private_balance_protocol::constants::TREE_DEPTH {
            if (canonical.next_leaf_index >> level) & 1 == 1 {
                assert_eq!(
                    native.frontier[level], canonical.frontier[level],
                    "live frontier subtree differs at level {level}"
                );
            }
        }
    }
}
