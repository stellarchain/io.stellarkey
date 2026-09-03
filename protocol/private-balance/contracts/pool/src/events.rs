use crate::{archive::ArchiveRecord, storage::AssetStatus};
use soroban_sdk::{Address, Env, contractevent};

#[contractevent(topics = ["shielded_action"], data_format = "single-value")]
pub struct ShieldedAction {
    pub record: ArchiveRecord,
}

#[contractevent(topics = ["paused"], data_format = "single-value")]
pub struct DepositsPaused {
    pub paused: bool,
}

#[contractevent(topics = ["asset_added"])]
pub struct AssetAdded {
    pub index: u32,
    pub asset: Address,
}

#[contractevent(topics = ["asset_status"])]
pub struct AssetStatusChanged {
    pub index: u32,
    pub status: AssetStatus,
}

#[contractevent(topics = ["asset_admin_proposed"], data_format = "single-value")]
pub struct AssetAdminProposed {
    pub next: Address,
}

#[contractevent(topics = ["asset_admin_changed"])]
pub struct AssetAdminChanged {
    pub previous: Address,
    pub current: Address,
}

pub fn emit_deposits_paused(env: &Env, paused: bool) {
    DepositsPaused { paused }.publish(env);
}

pub fn emit_shielded_action(env: &Env, record: &ArchiveRecord) {
    ShieldedAction {
        record: record.clone(),
    }
    .publish(env);
}

pub fn emit_asset_added(env: &Env, index: u32, asset: &Address) {
    AssetAdded {
        index,
        asset: asset.clone(),
    }
    .publish(env);
}

pub fn emit_asset_status_changed(env: &Env, index: u32, status: &AssetStatus) {
    AssetStatusChanged {
        index,
        status: status.clone(),
    }
    .publish(env);
}

pub fn emit_asset_admin_proposed(env: &Env, next: &Address) {
    AssetAdminProposed { next: next.clone() }.publish(env);
}

pub fn emit_asset_admin_changed(env: &Env, previous: &Address, current: &Address) {
    AssetAdminChanged {
        previous: previous.clone(),
        current: current.clone(),
    }
    .publish(env);
}
