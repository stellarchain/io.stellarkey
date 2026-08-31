use crate::archive::ArchiveRecord;
use soroban_sdk::{Env, contractevent};

#[contractevent(topics = ["shielded_action"], data_format = "single-value")]
pub struct ShieldedAction {
    pub record: ArchiveRecord,
}

#[contractevent(topics = ["paused"], data_format = "single-value")]
pub struct DepositsPaused {
    pub paused: bool,
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
