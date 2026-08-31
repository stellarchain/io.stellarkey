use crate::native_poseidon2::NativeTreeHashContext;
use private_balance_protocol::{
    action::{Action, ActionKind},
    archive::{ArchiveRecord, compute_genesis_record_hash},
    encoding::compute_context_hash,
    tree::TreeState,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContext {
    pub network_id: [u8; 32],
    pub realm_id: [u8; 32],
    pub pool_id: [u8; 32],
    pub context_field: [u8; 32],
    pub deployment_binding_hash: [u8; 32],
}

impl ModelContext {
    pub fn context_hash(&self) -> [u8; 32] {
        compute_context_hash(1, &self.network_id, &self.realm_id, &self.pool_id)
    }

    pub fn genesis_record_hash(&self) -> [u8; 32] {
        compute_genesis_record_hash(&self.context_hash(), &self.deployment_binding_hash)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolModel {
    pub context: ModelContext,
    pub tree: TreeState,
    pub nullifiers: HashSet<[u8; 32]>,
    pub records: Vec<ArchiveRecord>,
    pub transcript_head: [u8; 32],
    pub total_public_balance: u64,
    pub asset_public_balances: HashMap<(u8, [u8; 32]), u64>,
}

impl PoolModel {
    pub fn new(context: ModelContext) -> Self {
        let transcript_head = context.genesis_record_hash();
        PoolModel {
            context,
            tree: TreeState::new(),
            nullifiers: HashSet::new(),
            records: Vec::new(),
            transcript_head,
            total_public_balance: 0,
            asset_public_balances: HashMap::new(),
        }
    }

    pub fn new_with_tree_hash_context(
        context: ModelContext,
        tree_hash_context: &NativeTreeHashContext,
    ) -> Self {
        let transcript_head = context.genesis_record_hash();
        PoolModel {
            context,
            tree: tree_hash_context.empty_tree(),
            nullifiers: HashSet::new(),
            records: Vec::new(),
            transcript_head,
            total_public_balance: 0,
            asset_public_balances: HashMap::new(),
        }
    }

    pub fn apply_action(
        &mut self,
        action: &Action,
        ledger_sequence: u32,
    ) -> Result<ArchiveRecord, String> {
        self.apply_action_inner(action, ledger_sequence, None)
    }

    pub fn apply_action_with_tree_hash_context(
        &mut self,
        action: &Action,
        ledger_sequence: u32,
        tree_hash_context: &NativeTreeHashContext,
    ) -> Result<ArchiveRecord, String> {
        self.apply_action_inner(action, ledger_sequence, Some(tree_hash_context))
    }

    fn apply_action_inner(
        &mut self,
        action: &Action,
        ledger_sequence: u32,
        tree_hash_context: Option<&NativeTreeHashContext>,
    ) -> Result<ArchiveRecord, String> {
        let current_asset_balance = *self.asset_public_balances.get(&action.asset).unwrap_or(&0);
        let next_asset_balance = match action.kind {
            ActionKind::Deposit => {
                if action.public_value == 0 {
                    return Err("Zero deposit value".into());
                }
                current_asset_balance
                    .checked_add(action.public_value)
                    .ok_or_else(|| "Public balance overflow".to_string())?
            }
            ActionKind::PrivateTransfer => {
                if action.public_value != 0 {
                    return Err("Non-zero transfer public value".into());
                }
                current_asset_balance
                    .checked_sub(action.relayer_fee)
                    .ok_or_else(|| "Invalid relayer fee".to_string())?
            }
            ActionKind::Withdraw => {
                if action.public_value == 0 || action.public_value > current_asset_balance {
                    return Err("Invalid withdrawal value".into());
                }
                current_asset_balance
                    .checked_sub(action.public_value)
                    .and_then(|value| value.checked_sub(action.relayer_fee))
                    .ok_or_else(|| "Invalid withdrawal or relayer fee".to_string())?
            }
        };

        let mut next_nullifiers = self.nullifiers.clone();
        for nf in &action.nullifiers {
            if *nf != [0u8; 32] && !next_nullifiers.insert(*nf) {
                return Err("Nullifier already spent".into());
            }
        }

        let starting_leaf_index = u32::try_from(self.tree.next_leaf_index)
            .map_err(|_| "Starting leaf index exceeds u32".to_string())?;
        let mut next_tree = self.tree.clone();
        let root_after = match tree_hash_context {
            Some(context) => context.append_two_commitments(
                &mut next_tree,
                &action.outputs[0].cm,
                &action.outputs[1].cm,
            ),
            None => next_tree.append_two_commitments(&action.outputs[0].cm, &action.outputs[1].cm),
        }
        .map_err(|error| format!("{error:?}"))?;

        let rec = ArchiveRecord {
            action_index: u32::try_from(self.records.len())
                .map_err(|_| "Action count exceeds u32".to_string())?,
            ledger_sequence,
            starting_leaf_index,
            action_kind: action.kind as u8,
            asset: action.asset,
            action_nonce: action.action_nonce,
            anchor_root: action.anchor_root,
            tree_root_after: root_after,
            nullifiers: action.nullifiers,
            outputs: action.outputs.clone(),
            public_value: action.public_value,
            deposit_source: action.deposit_source,
            public_recipient: action.public_recipient,
            relayer_fee: action.relayer_fee,
            relayer: action.relayer,
        };
        let next_transcript_head =
            rec.compute_record_hash(action.protocol_version, &self.transcript_head);

        self.asset_public_balances
            .insert(action.asset, next_asset_balance);
        self.total_public_balance = self
            .asset_public_balances
            .values()
            .try_fold(0_u64, |total, value| total.checked_add(*value))
            .ok_or_else(|| "Aggregate public balance overflow".to_string())?;
        self.nullifiers = next_nullifiers;
        self.tree = next_tree;
        self.transcript_head = next_transcript_head;
        self.records.push(rec.clone());
        Ok(rec)
    }
}
