use crate::{
    action::{OutputPackage, address_payload},
    errors::PoolError,
    storage::{self, AssetConfig, PoolConfig},
};
use private_balance_protocol::{
    action::Action,
    archive::{ArchiveRecord as ProtocolArchiveRecord, compute_genesis_record_hash},
    constants::PROTOCOL_VERSION,
    encryption::OutputPackage as ProtocolOutputPackage,
};
use soroban_sdk::{Address, BytesN, Env, contracttype};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveRecord {
    pub action_index: u32,
    pub ledger_sequence: u32,
    pub starting_leaf_index: u32,
    pub action_kind: u32,
    pub asset_index: Option<u32>,
    pub asset: Option<Address>,
    pub action_nonce: BytesN<32>,
    pub anchor_root: BytesN<32>,
    pub tree_root_after: BytesN<32>,
    pub nullifier_0: BytesN<32>,
    pub nullifier_1: BytesN<32>,
    pub output_0: OutputPackage,
    pub output_1: OutputPackage,
    pub output_2: OutputPackage,
    pub public_value: u64,
    pub deposit_source: Option<Address>,
    pub public_recipient: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveMeta {
    pub action_count: u32,
    pub transcript_head: BytesN<32>,
}

fn protocol_output(output: &OutputPackage) -> ProtocolOutputPackage {
    ProtocolOutputPackage {
        cm: output.commitment.to_array(),
        recipient_envelope: output.recipient_envelope.to_array(),
        outgoing_envelope: output.outgoing_envelope.to_array(),
    }
}

fn optional_payload(address: &Option<Address>) -> Result<Option<(u8, [u8; 32])>, PoolError> {
    address.as_ref().map(address_payload).transpose()
}

pub(crate) fn protocol_record(record: &ArchiveRecord) -> Result<ProtocolArchiveRecord, PoolError> {
    Ok(ProtocolArchiveRecord {
        action_index: record.action_index,
        ledger_sequence: record.ledger_sequence,
        starting_leaf_index: record.starting_leaf_index,
        action_kind: u8::try_from(record.action_kind).map_err(|_| PoolError::ArchiveCorrupt)?,
        asset_index: record.asset_index,
        asset: optional_payload(&record.asset)?,
        action_nonce: record.action_nonce.to_array(),
        anchor_root: record.anchor_root.to_array(),
        tree_root_after: record.tree_root_after.to_array(),
        nullifiers: [record.nullifier_0.to_array(), record.nullifier_1.to_array()],
        outputs: [
            protocol_output(&record.output_0),
            protocol_output(&record.output_1),
            protocol_output(&record.output_2),
        ],
        public_value: record.public_value,
        deposit_source: optional_payload(&record.deposit_source)?,
        public_recipient: optional_payload(&record.public_recipient)?,
    })
}

pub fn genesis_record_hash(config: &PoolConfig) -> [u8; 32] {
    compute_genesis_record_hash(
        &config.context_hash.to_array(),
        &config.deployment_binding_hash.to_array(),
    )
}

pub fn append_record(
    env: &Env,
    action: &Action,
    asset: Option<&AssetConfig>,
    signals: &[[u8; 32]; 11],
    starting_leaf_index: u64,
    tree_root_after: &BytesN<32>,
    public_address: Option<&Address>,
) -> Result<ArchiveRecord, PoolError> {
    let mut meta = storage::get_meta(env);
    let action_index = meta.action_count;
    let starting_leaf_index =
        u32::try_from(starting_leaf_index).map_err(|_| PoolError::TreeFull)?;
    if signals[6] != action.nullifiers[0]
        || signals[7] != action.nullifiers[1]
        || signals[8] != action.outputs[0].cm
        || signals[9] != action.outputs[1].cm
        || signals[10] != action.outputs[2].cm
    {
        return Err(PoolError::ArchiveCorrupt);
    }
    let expected_asset = asset
        .map(|value| address_payload(&value.asset))
        .transpose()?;
    if action.asset != expected_asset || action.asset_index != asset.map(|value| value.index) {
        return Err(PoolError::ArchiveCorrupt);
    }

    let (deposit_source, public_recipient) = match action.kind {
        private_balance_protocol::action::ActionKind::Deposit => {
            let source = public_address.ok_or(PoolError::InvalidActionShape)?;
            if action.deposit_source != Some(address_payload(source)?) {
                return Err(PoolError::ArchiveCorrupt);
            }
            (Some(source.clone()), None)
        }
        private_balance_protocol::action::ActionKind::PrivateTransfer => {
            if public_address.is_some() {
                return Err(PoolError::InvalidActionShape);
            }
            (None, None)
        }
        private_balance_protocol::action::ActionKind::Withdraw => {
            let recipient = public_address.ok_or(PoolError::InvalidActionShape)?;
            if action.public_recipient != Some(address_payload(recipient)?) {
                return Err(PoolError::ArchiveCorrupt);
            }
            (None, Some(recipient.clone()))
        }
    };
    let record = ArchiveRecord {
        action_index,
        ledger_sequence: env.ledger().sequence(),
        starting_leaf_index,
        action_kind: action.kind as u32,
        asset_index: asset.map(|value| value.index),
        asset: asset.map(|value| value.asset.clone()),
        action_nonce: BytesN::from_array(env, &action.action_nonce),
        anchor_root: BytesN::from_array(env, &action.anchor_root),
        tree_root_after: tree_root_after.clone(),
        nullifier_0: BytesN::from_array(env, &action.nullifiers[0]),
        nullifier_1: BytesN::from_array(env, &action.nullifiers[1]),
        output_0: OutputPackage {
            commitment: BytesN::from_array(env, &action.outputs[0].cm),
            recipient_envelope: BytesN::from_array(env, &action.outputs[0].recipient_envelope),
            outgoing_envelope: BytesN::from_array(env, &action.outputs[0].outgoing_envelope),
        },
        output_1: OutputPackage {
            commitment: BytesN::from_array(env, &action.outputs[1].cm),
            recipient_envelope: BytesN::from_array(env, &action.outputs[1].recipient_envelope),
            outgoing_envelope: BytesN::from_array(env, &action.outputs[1].outgoing_envelope),
        },
        output_2: OutputPackage {
            commitment: BytesN::from_array(env, &action.outputs[2].cm),
            recipient_envelope: BytesN::from_array(env, &action.outputs[2].recipient_envelope),
            outgoing_envelope: BytesN::from_array(env, &action.outputs[2].outgoing_envelope),
        },
        public_value: action.public_value,
        deposit_source,
        public_recipient,
    };
    let record_hash = protocol_record(&record)?
        .compute_record_hash(PROTOCOL_VERSION, &meta.transcript_head.to_array());

    storage::set_archive_record(env, action_index, &record)?;
    meta.action_count = meta
        .action_count
        .checked_add(1)
        .ok_or(PoolError::ActionCountOverflow)?;
    meta.transcript_head = BytesN::from_array(env, &record_hash);
    storage::set_meta(env, &meta);
    Ok(record)
}
