use crate::{model::ModelContext, native_poseidon2::NativeTreeHashContext};
use private_balance_protocol::{
    action::{Action, ActionKind},
    archive::ArchiveRecord,
    constants::PROTOCOL_VERSION,
    tree::TreeState,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveredPublicActivity {
    pub action_index: u32,
    pub action_kind: ActionKind,
    pub asset: (u8, [u8; 32]),
    pub public_value: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveredPoolState {
    pub tree: TreeState,
    pub nullifiers: HashSet<[u8; 32]>,
    pub action_count: u32,
    pub transcript_head: [u8; 32],
    pub total_public_balance: u64,
    pub asset_public_balances: HashMap<(u8, [u8; 32]), u64>,
    pub activities: Vec<RecoveredPublicActivity>,
}

struct ReplayAccumulator {
    tree: TreeState,
    nullifiers: HashSet<[u8; 32]>,
    transcript_head: [u8; 32],
    total_public_balance: u64,
    asset_public_balances: HashMap<(u8, [u8; 32]), u64>,
    activities: Vec<RecoveredPublicActivity>,
}

pub fn recover_public_transcript(
    context: &ModelContext,
    records: &[ArchiveRecord],
) -> Result<RecoveredPoolState, String> {
    recover_public_transcript_inner(context, records, None)
}

pub fn recover_public_transcript_with_tree_hash_context(
    context: &ModelContext,
    records: &[ArchiveRecord],
    tree_hash_context: &NativeTreeHashContext,
) -> Result<RecoveredPoolState, String> {
    recover_public_transcript_inner(context, records, Some(tree_hash_context))
}

fn recover_public_transcript_inner(
    context: &ModelContext,
    records: &[ArchiveRecord],
    tree_hash_context: Option<&NativeTreeHashContext>,
) -> Result<RecoveredPoolState, String> {
    let mut accumulator = ReplayAccumulator {
        tree: match tree_hash_context {
            Some(context) => context.empty_tree(),
            None => TreeState::new(),
        },
        nullifiers: HashSet::new(),
        transcript_head: context.genesis_record_hash(),
        total_public_balance: 0,
        asset_public_balances: HashMap::new(),
        activities: Vec::with_capacity(records.len()),
    };

    for (index, record) in records.iter().enumerate() {
        replay_record(context, &mut accumulator, record, index, tree_hash_context)?;
    }

    recovered_state(
        accumulator.tree,
        accumulator.nullifiers,
        records.len(),
        accumulator.transcript_head,
        accumulator.total_public_balance,
        accumulator.asset_public_balances,
        accumulator.activities,
    )
}

fn replay_record(
    context: &ModelContext,
    accumulator: &mut ReplayAccumulator,
    record: &ArchiveRecord,
    index: usize,
    tree_hash_context: Option<&NativeTreeHashContext>,
) -> Result<(), String> {
    let action_index = u32::try_from(index).map_err(|_| "Action count exceeds u32".to_string())?;
    if record.action_index != action_index {
        return Err(format!(
            "Non-sequential action index at action {action_index}"
        ));
    }
    let starting_leaf_index = u32::try_from(accumulator.tree.next_leaf_index)
        .map_err(|_| "Starting leaf index exceeds u32".to_string())?;
    if record.starting_leaf_index != starting_leaf_index {
        return Err(format!(
            "Invalid starting leaf index at action {action_index}"
        ));
    }
    let next_transcript_head =
        record.compute_record_hash(PROTOCOL_VERSION, &accumulator.transcript_head);

    let kind = match record.action_kind {
        1 => ActionKind::Deposit,
        2 => ActionKind::PrivateTransfer,
        3 => ActionKind::Withdraw,
        _ => return Err(format!("Invalid action kind at action {action_index}")),
    };
    let current_asset_balance = *accumulator
        .asset_public_balances
        .get(&record.asset)
        .unwrap_or(&0);
    let next_asset_balance = match kind {
        ActionKind::Deposit => {
            if record.public_value == 0 {
                return Err(format!("Zero deposit value at action {action_index}"));
            }
            accumulator
                .asset_public_balances
                .get(&record.asset)
                .copied()
                .unwrap_or(0)
                .checked_add(record.public_value)
                .ok_or_else(|| format!("Public balance overflow at action {action_index}"))?
        }
        ActionKind::PrivateTransfer => {
            if record.public_value != 0 {
                return Err(format!(
                    "Non-zero transfer public value at action {action_index}"
                ));
            }
            accumulator
                .asset_public_balances
                .get(&record.asset)
                .copied()
                .unwrap_or(0)
                .checked_sub(record.relayer_fee)
                .ok_or_else(|| format!("Invalid relayer fee at action {action_index}"))?
        }
        ActionKind::Withdraw => {
            if record.public_value == 0 || record.public_value > current_asset_balance {
                return Err(format!("Invalid withdrawal value at action {action_index}"));
            }
            accumulator
                .asset_public_balances
                .get(&record.asset)
                .copied()
                .unwrap_or(0)
                .checked_sub(record.public_value)
                .and_then(|value| value.checked_sub(record.relayer_fee))
                .ok_or_else(|| {
                    format!("Invalid withdrawal or relayer fee at action {action_index}")
                })?
        }
    };
    let action = Action {
        protocol_version: PROTOCOL_VERSION,
        kind,
        asset: record.asset,
        action_nonce: record.action_nonce,
        anchor_root: record.anchor_root,
        nullifiers: record.nullifiers,
        outputs: record.outputs.clone(),
        public_value: record.public_value,
        deposit_source: record.deposit_source,
        public_recipient: record.public_recipient,
        relayer_fee: record.relayer_fee,
        relayer: record.relayer,
    };
    let _action_field =
        action.compute_action_field(&context.network_id, &context.realm_id, &context.pool_id);

    for nullifier in record.nullifiers {
        if nullifier != [0u8; 32] && !accumulator.nullifiers.insert(nullifier) {
            return Err(format!("Duplicate nullifier at action {action_index}"));
        }
    }

    let root_after = match tree_hash_context {
        Some(context) => context.append_two_commitments(
            &mut accumulator.tree,
            &record.outputs[0].cm,
            &record.outputs[1].cm,
        ),
        None => accumulator
            .tree
            .append_two_commitments(&record.outputs[0].cm, &record.outputs[1].cm),
    }
    .map_err(|error| format!("Tree replay failed at action {action_index}: {error:?}"))?;
    if record.tree_root_after != root_after {
        return Err(format!("Invalid tree root at action {action_index}"));
    }

    accumulator
        .asset_public_balances
        .insert(record.asset, next_asset_balance);
    accumulator.total_public_balance = accumulator
        .asset_public_balances
        .values()
        .try_fold(0_u64, |total, value| total.checked_add(*value))
        .ok_or_else(|| format!("Aggregate public balance overflow at action {action_index}"))?;
    accumulator.activities.push(RecoveredPublicActivity {
        action_index,
        action_kind: kind,
        asset: record.asset,
        public_value: record.public_value,
    });
    accumulator.transcript_head = next_transcript_head;
    Ok(())
}

fn recovered_state(
    tree: TreeState,
    nullifiers: HashSet<[u8; 32]>,
    record_count: usize,
    transcript_head: [u8; 32],
    total_public_balance: u64,
    asset_public_balances: HashMap<(u8, [u8; 32]), u64>,
    activities: Vec<RecoveredPublicActivity>,
) -> Result<RecoveredPoolState, String> {
    Ok(RecoveredPoolState {
        tree,
        nullifiers,
        action_count: u32::try_from(record_count)
            .map_err(|_| "Action count exceeds u32".to_string())?,
        transcript_head,
        total_public_balance,
        asset_public_balances,
        activities,
    })
}
